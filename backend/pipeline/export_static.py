"""Export the API's responses to static JSON so the React app can be hosted
without a server (GitHub Pages, any static host).

    python -m pipeline.export_static --out ../frontend/public/static-data

The snapshot covers what the hosted site lets a visitor do: every dashboard and
drilldown for "all disciplines" and for each single discipline, every project
page, the data-quality exceptions with their raw payloads, and each scenario
before and after its decision. Everything is computed by the same API code the
live app uses; the static site only reads these files. Run the pipeline first.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import date, datetime

from fastapi.testclient import TestClient

from app.main import app
from app.metrics.drill import METRICS
from app.scenarios import INFO as SCENARIOS

KEYS = list(SCENARIOS)

VARIANTS = ["all", "Electrical", "Civil", "Structural"]
DASHBOARDS = ["executive", "delivery", "capacity", "actions", "commercial", "proposals", "billables"]
SHARDS = 8


def slug(v: str) -> str:
    return v.lower().replace(" ", "-")


def _default(o):
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    raise TypeError(type(o))


def export(out: str) -> dict:
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    c = TestClient(app)
    sizes: dict[str, int] = {}

    def get(path):
        r = c.get(path)
        assert r.status_code == 200, (path, r.status_code, r.text[:200])
        return r.json()

    def put(name, obj):
        p = os.path.join(out, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"), default=_default)
        sizes[name] = os.path.getsize(p)

    for k in KEYS:
        c.post(f"/api/scenarios/{k}/reset")
    put("meta.json", get("/api/meta"))
    put("definitions.json", get("/api/meta/definitions"))
    put("status_map.json", get("/api/pipeline/status-map"))
    put("quality.json", get("/api/quality"))

    exc, page = [], 1
    while True:
        r = get(f"/api/quality/exceptions?page={page}&page_size=200")
        exc += r["rows"]
        if page * 200 >= r["total"]:
            break
        page += 1
    put("exceptions.json", exc)
    put("raw.json", {str(e["raw_record_id"]): get(f"/api/quality/raw/{e['raw_record_id']}")
                     for e in exc if e["raw_record_id"]})

    for v in VARIANTS:
        qs = "" if v == "all" else f"?disciplines={v}"
        for d in DASHBOARDS:
            put(f"{d}_{slug(v)}.json", get(f"/api/{d}{qs}"))
        sep = "&" if qs else "?"
        put(f"drill_{slug(v)}.json", {m: get(f"/api/drill/{m}{qs}{sep}page_size=500")["rows"] for m in METRICS})

    from app.db import SessionLocal
    from sqlalchemy import text
    with SessionLocal() as db:
        rows = [dict(r._mapping) for r in db.execute(text("""
            SELECT pp.id, pp.name, pf.name AS portfolio_name, c.name AS client_name, pp.lifecycle, pf.project_number
            FROM portfolio_projects pp JOIN projects pf ON pf.id = pp.portfolio_id JOIN clients c ON c.id = pf.client_id
            ORDER BY pp.name"""))]
    put("projects_index.json", rows)
    shards: dict[int, dict] = {}
    for r in rows:  # 8 shards of ~550 KB, loaded on demand by project id
        shards.setdefault(r["id"] % SHARDS, {})[str(r["id"])] = get(f"/api/projects/{r['id']}")
    for i, shard in shards.items():
        put(f"projects_{i}.json", shard)

    # Each decision is applied on its own, as a visitor applies it on the site.
    scen = {}
    before = {s["key"]: s for s in get("/api/scenarios")}
    for k in KEYS:
        c.post(f"/api/scenarios/{k}/apply")
        after = next(s for s in get("/api/scenarios") if s["key"] == k)
        c.post(f"/api/scenarios/{k}/reset")
        scen[k] = {"before": before[k], "applied": after}
    put("scenarios.json", scen)
    put("manifest.json", {"exported_at": datetime.now().isoformat(timespec="seconds"),
                          "variants": VARIANTS, "files": len(sizes) + 1})
    return sizes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "static-data"))
    args = ap.parse_args()
    sizes = export(os.path.abspath(args.out))
    total = sum(sizes.values())
    print(f"Exported {len(sizes)} files, {total / 1e6:.1f} MB to {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
