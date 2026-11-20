"""Monday.com extraction — ADAPTED from production PMO 360
`backend/scripts/sync_projects_from_monday.py`.

Kept from production, deliberately:
  * READ-ONLY: `MondayClient.post` refuses any query containing "mutation".
  * Columns are resolved BY TITLE, never by id (ids are regenerated when a
    column is recreated).
  * `items_page` / `next_items_page` cursor pagination, 100 items per page.
  * board_relation and mirror columns return text=None; the value lives in
    `display_value`, so both are unwrapped.
  * `norm()` — case, punctuation and spacing removed, NOTHING looser. Fuzzy
    matching starts guessing, and a wrong mapping silently files work against
    another client's project.
  * Exact matches only; ambiguous / orphan / unnumbered are reported, never
    auto-created.

Changed for the demo:
  * The HTTP transport is replaced by `LocalMondayTransport`, which answers the
    same GraphQL calls from a synthetic board file. There is no code path to
    api.monday.com in this repository, and app/netguard.py blocks it anyway.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict


class MondayError(RuntimeError):
    pass


def norm(s: str | None) -> str:
    """Production rule, unchanged. 'Beloit II' and 'beloit ii' collide;
    'Highland South (1 & 2)' and 'Highland South 1' must NOT."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


class LocalMondayTransport:
    """Serves a synthetic board export through Monday's GraphQL response shape."""

    PAGE = 100

    def __init__(self, board_file: str):
        with open(board_file, encoding="utf-8") as f:
            data = json.load(f)
        self.board = data["board"]
        self.items = data["items"]
        self.calls = 0

    def __call__(self, query: str, variables: dict) -> dict:
        self.calls += 1
        q = " ".join(query.split())
        if "columns" in q and "items_page" not in q:
            return {"boards": [{"columns": [{"id": c["id"], "title": c["title"]} for c in self.board["columns"]]}]}
        if "next_items_page" in q:
            start = int(variables["cu"])
            return {"next_items_page": self._page(start, variables.get("c"))}
        if "items_page" in q:
            return {"boards": [{"items_page": self._page(0, variables.get("c"))}]}
        raise MondayError(f"Local transport does not understand query: {q[:80]}")

    def _page(self, start: int, cols):
        chunk = self.items[start:start + self.PAGE]
        out = []
        for it in chunk:
            cv = [c for c in it["column_values"] if not cols or c["id"] in cols]
            out.append({**it, "column_values": cv})
        nxt = start + self.PAGE
        return {"cursor": str(nxt) if nxt < len(self.items) else None, "items": out}


class MondayClient:
    def __init__(self, transport):
        self.transport = transport

    def post(self, query: str, variables: dict | None = None) -> dict:
        # Production tripwire, kept verbatim in spirit: this integration reads only.
        if "mutation" in query.lower():
            raise MondayError("Read-only against Monday; refusing to send a mutation.")
        return self.transport(query, variables or {})

    def fetch_items(self, board: str, titles: dict[str, str]) -> tuple[list[dict], int]:
        """Every item on the board, with the wanted columns keyed by our names.
        Returns (rows, pages_fetched)."""
        meta = self.post("query($i:[ID!]){boards(ids:$i){columns{id title}}}", {"i": [board]})
        boards = meta.get("boards") or []
        if not boards:
            raise MondayError(f"Board {board} not found, or the token cannot see it.")
        by_title = {c["title"].strip().lower(): c["id"] for c in boards[0]["columns"]}
        wanted = {}
        for key, title in titles.items():
            cid = by_title.get(title.lower())
            if not cid:
                raise MondayError(f"No column titled {title!r} on board {board}. Present: {sorted(by_title)}")
            wanted[key] = cid
        rev = {v: k for k, v in wanted.items()}
        fields = ("items{id name url updated_at group{title} updates{created_at body} "
                  "column_values(ids:$c){id text value ... on BoardRelationValue { display_value } "
                  "... on MirrorValue { display_value }}}")
        data = self.post(f"query($i:[ID!],$c:[String!]){{boards(ids:$i){{items_page(limit:100){{cursor {fields}}}}}}}",
                         {"i": [board], "c": list(wanted.values())})
        page = data["boards"][0]["items_page"]
        items, cursor, pages = list(page["items"]), page["cursor"], 1
        while cursor:
            data = self.post(f"query($cu:String!,$c:[String!]){{next_items_page(cursor:$cu,limit:100){{cursor {fields}}}}}",
                             {"cu": cursor, "c": list(wanted.values())})
            page = data["next_items_page"]
            items += page["items"]
            cursor = page["cursor"]
            pages += 1
        rows = []
        for it in items:
            row = {"item_id": str(it["id"]), "name": (it.get("name") or "").strip(), "url": it.get("url"),
                   "updated_at": it.get("updated_at"), "group": (it.get("group") or {}).get("title"),
                   "updates": it.get("updates") or [], "_raw": it}
            for cv in it["column_values"]:
                key = rev.get(cv["id"])
                if key:
                    text = cv.get("text")
                    if text is None:
                        text = cv.get("display_value")
                    row[key] = (text.strip() if isinstance(text, str) else text) or None
                    row[key + "__value"] = cv.get("value")
            rows.append(row)
        return rows, pages


def match_portfolios(rows: list[dict], portfolios: list[dict], sub_names: dict[str, list[str]]):
    """Production `match()` logic: split the Portfolio board into what can be
    written and what a human must decide."""
    ours: dict[str, list[dict]] = defaultdict(list)
    for p in portfolios:
        ours[norm(p["name"])].append(p)
    theirs: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        theirs[norm(r["name"])].append(r)
    res = {"exact": [], "ambiguous": [], "sub_only": [], "orphan": [], "unnumbered": []}
    for key, group in theirs.items():
        if not key:
            continue
        if len(group) > 1:
            res["ambiguous"].append(("monday", group))
            continue
        row = group[0]
        ourside = ours.get(key, [])
        if len(ourside) > 1:
            res["ambiguous"].append(("pmo", [row] + ourside))
        elif len(ourside) == 1:
            (res["exact"] if row.get("number") else res["unnumbered"]).append((ourside[0], row))
        elif key in sub_names:
            res["sub_only"].append((row, sub_names[key]))
        else:
            res["orphan"].append(row)
    return res
