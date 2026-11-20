"""Ingest -> validate -> normalise -> load, one function per source.

Every source follows the same contract:
  1. open a SyncRun (what was extracted, when, from which file)
  2. stage every record as received in raw_records (JSONB + sha256)
  3. resolve identifiers (exact rules only; manual crosswalk; else exception)
  4. de-duplicate on the natural key
  5. validate fields; map labels through status_map; normalise dates/timezones
  6. load core rows, linking each staged record to the core row it produced
  7. record every problem as a dq_exceptions row, and close the SyncRun

Two rules hold throughout: missing values stay NULL (unknown), never zero or
"on time"; and nothing ambiguous is guessed — it becomes an exception a person
can resolve, visible on the Data Quality dashboard.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app import models as M
from pipeline.monday import LocalMondayTransport, MondayClient, match_portfolios, norm
from pipeline.rules import DQ_RULES, STAGE_MAP, STATUS_MAP

UTC = timezone.utc
ET = ZoneInfo("America/New_York")
INTERNAL_EMAIL_DOMAINS = {"pmo360-demo.example"}
REGISTER_COLUMNS = ["Register Row", "Job Number", "Project", "Discipline", "Milestone", "Document No.",
                    "Title", "Planned Issue", "Actual Issue", "Status", "Rev"]
JOB_NUMBER_SHAPE = re.compile(r"^\d{3,4}-\d{3}$")
WORK_BOARD_TITLES = {
    "project": "Project", "job": "Job #", "discipline": "Discipline", "stage": "Stage", "owner": "Owner",
    "status": "Status", "priority": "Priority", "timeline": "Timeline", "start": "Start Date",
    "completed": "Completed", "planned_hours": "Planned Hrs", "actual_hours": "Actual Hrs",
    "pct": "% Complete", "blocked_reason": "Blocked Reason", "blocked_since": "Blocked Since",
    "expected_unblock": "Expected Unblock", "depends_on": "Depends On",
}
SEVERITY = {r[0]: r[2] for r in DQ_RULES}


# ---------------------------------------------------------------------------- parsing helpers
def parse_ts(value) -> datetime | None:
    """Monday/Graph timestamps arrive as '...Z', '...-05:00' or '... +00:00'.
    All are normalised to aware UTC. A naive value is assumed UTC."""
    if not value:
        return None
    s = str(value).strip().replace(" ", "T", 1)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def parse_date(value) -> tuple[date | None, bool]:
    """Returns (date, ok). Accepts ISO, M/D/YYYY and DD-Mon-YYYY. Blank -> (None, True)."""
    if value is None or str(value).strip() == "":
        return None, True
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date(), True
        except ValueError:
            continue
    return None, False


def label_key(label: str | None) -> str:
    return " ".join((label or "").strip().lower().split())


def to_float(v) -> float | None:
    if v is None or str(v).strip() == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _hash(payload) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


# ---------------------------------------------------------------------------- loader
class Loader:
    def __init__(self, db: Session, src_dir: str, as_of: date):
        self.db = db
        self.src = src_dir
        self.as_of = as_of
        self.clock = datetime(as_of.year, as_of.month, as_of.day, 11, 0, tzinfo=UTC)  # 06:00 ET
        self.status_map = {src: dict(m) for src, m in STATUS_MAP.items()}
        self.summary: dict[str, dict] = {}

    # ---- run bookkeeping
    def start_run(self, source_key: str, extract_file: str, extracted_at, started_at=None) -> M.SyncRun:
        self.clock += timedelta(minutes=1)
        run = M.SyncRun(source_key=source_key, started_at=started_at or self.clock,
                        extracted_at=parse_ts(extracted_at) if isinstance(extracted_at, str) else extracted_at,
                        status="running", extract_file=extract_file)
        self.db.add(run)
        self.db.flush()
        return run

    def finish_run(self, run: M.SyncRun, status: str, message: str | None = None):
        self.db.flush()  # session uses autoflush=False: push pending load_status updates first
        q = select(M.RawRecord.load_status).where(M.RawRecord.sync_run_id == run.id)
        statuses = [r[0] for r in self.db.execute(q)]
        run.rows_extracted = len(statuses) if statuses else run.rows_extracted
        run.rows_loaded = sum(1 for s in statuses if s in ("loaded", "flagged"))
        run.rows_rejected = sum(1 for s in statuses if s in ("rejected", "duplicate"))
        run.rows_flagged = sum(1 for s in statuses if s == "flagged")
        run.status = status
        run.message = message
        run.finished_at = run.started_at + timedelta(seconds=20 + run.rows_extracted // 40)
        self.summary[f"{run.source_key}#{run.id}"] = {
            "status": status, "extracted": run.rows_extracted, "loaded": run.rows_loaded,
            "rejected": run.rows_rejected, "flagged": run.rows_flagged, "message": message}

    def stage(self, run, entity_type: str, external_id, payload) -> M.RawRecord:
        rr = M.RawRecord(sync_run_id=run.id, source_key=run.source_key, entity_type=entity_type,
                         external_id=None if external_id is None else str(external_id),
                         payload=json.loads(json.dumps(payload, default=str)), record_hash=_hash(payload),
                         load_status="pending")
        self.db.add(rr)
        return rr

    def exc(self, run, rule: str, detail: str, *, raw=None, entity_type=None, entity_id=None,
            external_id=None, project_id=None):
        self.db.add(M.DqException(
            sync_run_id=run.id if run else None, rule_code=rule, source_key=run.source_key if run else "pipeline",
            external_id=None if external_id is None else str(external_id), raw_record_id=raw.id if raw is not None else None,
            entity_type=entity_type, entity_id=entity_id, portfolio_project_id=project_id,
            severity=SEVERITY[rule], detail=detail, detected_at=run.started_at if run else self.clock))

    def _read_json(self, name):
        with open(os.path.join(self.src, name), encoding="utf-8") as f:
            return json.load(f)

    # ======================================================================== 1. PMO 360 master
    def load_master(self):
        data = self._read_json("pmo360_master.json")
        run = self.start_run("pmo360_master", "pmo360_master.json", data["extracted_at"])
        db = self.db
        for u in data["users"]:
            rr = self.stage(run, "user", u["id"], u)
            db.add(M.User(**u))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "users", u["id"]
        for c in data["clients"]:
            rr = self.stage(run, "client", c["id"], c)
            db.add(M.Client(**c))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "clients", c["id"]
        db.flush()
        for p in data["portfolios"]:
            rr = self.stage(run, "portfolio", p["id"], p)
            db.add(M.Project(**p))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "projects", p["id"]
        db.flush()
        for m in data["project_members"]:
            db.add(M.ProjectMember(**m))
        self.contacts = data["client_contacts"]
        for p in data["portfolio_projects"]:
            rr = self.stage(run, "portfolio_project", p["id"], p)
            row = {k: p[k] for k in ("id", "portfolio_id", "name", "location", "state", "size_mw",
                                     "technology", "pm_user_id", "lifecycle")}
            row["kickoff_date"] = parse_date(p["kickoff_date"])[0]
            db.add(M.PortfolioProject(**row))
            rr.core_table, rr.core_id = "portfolio_projects", p["id"]
            rr.load_status = "loaded"
            if p["pm_user_id"] is None:
                rr.load_status = "flagged"
                db.flush()
                self.exc(run, "PROJECT_MISSING_PM", f"Project '{p['name']}' has no project manager in the master.",
                         raw=rr, entity_type="project", entity_id=p["id"], project_id=p["id"])
        db.flush()
        for p in data["portfolio_projects"]:
            for d in p["disciplines"]:
                db.add(M.ProjectDiscipline(portfolio_project_id=p["id"], discipline=d))
        for m in data["milestones"]:
            rr = self.stage(run, "milestone", f"{m['portfolio_project_id']}:{m['stage']}", m)
            ms = M.Milestone(portfolio_project_id=m["portfolio_project_id"], stage=m["stage"], seq=m["seq"],
                             baseline_date=parse_date(m["baseline_date"])[0],
                             planned_date=parse_date(m["planned_date"])[0],
                             revision_count=m["revision_count"], last_revision_reason=m["last_revision_reason"])
            db.add(ms)
            db.flush()
            rr.load_status, rr.core_table, rr.core_id = "loaded", "milestones", ms.id
        self.finish_run(run, "success")
        self.projects = {p.id: p for p in db.scalars(select(M.PortfolioProject))}
        self.project_by_norm: dict[str, list[int]] = defaultdict(list)
        for p in self.projects.values():
            self.project_by_norm[norm(p.name)].append(p.id)

    # ======================================================================== 2. Monday Portfolio board
    def load_portfolio_board(self):
        db = self.db
        client = MondayClient(LocalMondayTransport(os.path.join(self.src, "monday_portfolio_board.json")))
        run = self.start_run("monday_portfolio_board", "monday_portfolio_board.json", self.clock - timedelta(minutes=5))
        rows, pages = client.fetch_items("9000000001", {"number": "Project ID", "client": "Client Name"})
        raw = {}
        for r in rows:
            raw[r["item_id"]] = self.stage(run, "portfolio_item", r["item_id"], r["_raw"])
        db.flush()
        portfolios = [{"id": p.id, "name": p.name, "project_number": p.project_number}
                      for p in db.scalars(select(M.Project))]
        sub_names: dict[str, list[str]] = defaultdict(list)
        for sp in self.projects.values():
            sub_names[norm(sp.name)].append(str(sp.portfolio_id))
        res = match_portfolios(rows, portfolios, sub_names)
        written = 0
        for p, row in res["exact"]:
            rr = raw[row["item_id"]]
            rr.core_table, rr.core_id = "projects", p["id"]
            db.add(M.IdMap(source_key="monday_portfolio_board", external_key=row["item_id"], entity_type="portfolio",
                           internal_id=p["id"], match_method="exact"))
            if not p["project_number"]:
                db.execute(update(M.Project).where(M.Project.id == p["id"]).values(project_number=row["number"]))
                rr.load_status = "loaded"
                written += 1
            elif p["project_number"] != row["number"]:
                rr.load_status = "flagged"
                self.exc(run, "JOB_NUMBER_CONFLICT",
                         f"Portfolio '{p['name']}': PMO 360 has {p['project_number']!r}, Monday has {row['number']!r}. Not overwritten.",
                         raw=rr, entity_type="portfolio", entity_id=p["id"], external_id=row["item_id"])
            else:
                rr.load_status = "loaded"
        for side, group in res["ambiguous"]:
            items = group if side == "monday" else group[:1]
            for row in items:
                raw[row["item_id"]].load_status = "rejected"
                self.exc(run, "MONDAY_AMBIGUOUS_NAME",
                         f"Monday name '{row['name']}' appears {len(group)} times; no exact one-to-one match.",
                         raw=raw[row["item_id"]], entity_type="portfolio", external_id=row["item_id"])
        for row, parents in res["sub_only"]:
            raw[row["item_id"]].load_status = "rejected"
            self.exc(run, "MONDAY_SUB_ONLY_MATCH", f"'{row['name']}' matches a project, not a portfolio. Job number not written.",
                     raw=raw[row["item_id"]], entity_type="portfolio", external_id=row["item_id"])
        for row in res["orphan"]:
            raw[row["item_id"]].load_status = "rejected"
            self.exc(run, "MONDAY_ORPHAN", f"'{row['name']}' ({row.get('number') or 'no number'}) is in Monday but not in PMO 360.",
                     raw=raw[row["item_id"]], entity_type="portfolio", external_id=row["item_id"])
        for p, row in res["unnumbered"]:
            raw[row["item_id"]].load_status = "flagged"
            self.exc(run, "MONDAY_UNNUMBERED", f"'{p['name']}' matched exactly but Monday has no job number.",
                     raw=raw[row["item_id"]], entity_type="portfolio", entity_id=p["id"], external_id=row["item_id"])
        self.finish_run(run, "success", f"{len(rows)} items over {pages} page(s); {written} job number(s) backfilled.")

    # ======================================================================== 3. Timeline (resources, time off)
    def load_timeline_base(self):
        data = self._read_json("timeline_board.json")
        self.timeline = data
        run = self.start_run("timeline_capacity", "timeline_board.json", data["extracted_at"])
        self.timeline_run = run
        db = self.db
        for r in data["resources"]:
            rr = self.stage(run, "resource", r["id"], r)
            row = dict(r)
            row["available_from"] = parse_date(r["available_from"])[0]
            db.add(M.TimelineResource(**row))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "timeline_resources", r["id"]
        for p in data["projects"]:
            rr = self.stage(run, "timeline_project", p["id"], p)
            db.add(M.TimelineProject(**p))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "timeline_projects", p["id"]
        db.flush()
        for t in data["timeoff"]:
            rr = self.stage(run, "timeoff", t["id"], t)
            db.add(M.TimelineTimeOff(id=t["id"], resource_id=t["resource_id"], reason=t["reason"],
                                     start_date=parse_date(t["start_date"])[0], end_date=parse_date(t["end_date"])[0]))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "timeline_timeoff", t["id"]
        db.flush()
        self.resources = {r.id: r for r in db.scalars(select(M.TimelineResource))}
        self.resource_by_name = {r.name.lower(): r.id for r in self.resources.values()}

    def load_crosswalk(self):
        path = os.path.join(self.src, "id_crosswalk_manual.csv")
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                self.db.add(M.IdMap(source_key=row["source_key"], external_key=row["external_key"],
                                    entity_type=row["entity_type"], internal_id=int(row["internal_id"]),
                                    match_method="manual", note=row["note"]))
        self.db.flush()
        self.manual_links = {(m.source_key, m.external_key): m.internal_id
                             for m in self.db.scalars(select(M.IdMap).where(M.IdMap.match_method == "manual"))}

    # ======================================================================== 4. Monday work board
    def resolve_project(self, source_key: str, linked_id: str | None, name: str | None):
        """(project_id, method, reason). Order: confirmed manual link on the
        relation's linked item id -> exact normalised name -> exception."""
        if linked_id and (source_key, linked_id) in self.manual_links:
            return self.manual_links[(source_key, linked_id)], "manual", None
        hits = self.project_by_norm.get(norm(name), [])
        if len(hits) == 1:
            return hits[0], "exact", None
        if len(hits) > 1:
            return None, None, f"'{name}' matches {len(hits)} projects"
        return None, None, f"'{name or '(blank)'}' matches no PMO 360 project"

    def load_work_board(self):
        db = self.db
        transport = LocalMondayTransport(os.path.join(self.src, "monday_work_board.json"))
        client = MondayClient(transport)
        run = self.start_run("monday_work_board", "monday_work_board.json", self.clock - timedelta(minutes=2))
        rows, pages = client.fetch_items("9000000002", WORK_BOARD_TITLES)
        staged = []
        for r in rows:
            rr = self.stage(run, "work_item", r["item_id"], r["_raw"])
            staged.append((r, rr))
        db.flush()

        # -- resolve project + natural key
        candidates: dict[tuple, list] = defaultdict(list)
        for r, rr in staged:
            linked = None
            if r.get("project__value"):
                linked = str(json.loads(r["project__value"])["linkedPulseIds"][0]["linkedPulseId"])
            pid, method, why = self.resolve_project("monday_work_board", linked, r.get("project"))
            if pid is None:
                rr.load_status = "rejected"
                self.exc(run, "MISSING_PROJECT_REF", f"Item '{r['name']}': {why}; no confirmed manual link.",
                         raw=rr, entity_type="work_item", external_id=r["item_id"])
                continue
            stage = STAGE_MAP.get(label_key(r.get("stage")))
            r["_pid"], r["_method"], r["_stage"], r["_updated"] = pid, method, stage, parse_ts(r.get("updated_at"))
            if method == "manual":
                rr.core_table = "work_items"  # provenance noted below
            candidates[(pid, r.get("discipline"), stage)].append((r, rr))

        # -- de-duplicate: keep the most recently updated record per natural key
        kept = []
        for key, group in candidates.items():
            group.sort(key=lambda x: (x[0]["_updated"], x[0]["item_id"]), reverse=True)
            kept.append(group[0])
            for r, rr in group[1:]:
                rr.load_status = "duplicate"
                self.exc(run, "DUPLICATE_EXTERNAL_RECORD",
                         f"Item {r['item_id']} duplicates item {group[0][0]['item_id']} "
                         f"({self.projects[key[0]].name} / {key[1]} / {key[2]}); kept the most recently updated.",
                         raw=rr, entity_type="work_item", external_id=r["item_id"], project_id=key[0])

        # -- validate + load
        ext_to_core: dict[str, int] = {}
        pending_deps = []
        for r, rr in kept:
            flags = []
            mapped = self.status_map["monday_work_board"].get(label_key(r.get("status")))
            if mapped is None:
                mapped = "unknown"
                flags.append(("UNMAPPED_STATUS", f"Status label {r.get('status')!r} is not in the status map; loaded as 'unknown'."))
            tl = r.get("timeline__value")
            planned_start = due = None
            if tl:
                tlv = json.loads(tl)
                planned_start, due = parse_date(tlv.get("from"))[0], parse_date(tlv.get("to"))[0]
            if due is None and mapped not in ("done", "cancelled"):
                flags.append(("MISSING_DUE_DATE", "Open work package has no due date (Timeline column blank)."))
            start, completed = parse_date(r.get("start"))[0], parse_date(r.get("completed"))[0]
            if start and completed and start > completed:
                flags.append(("DATE_ORDER_INVALID", f"Start {start} is after completion {completed}."))
            actual_hours = to_float(r.get("actual_hours"))
            if mapped == "done" and actual_hours is None:
                flags.append(("ACTUAL_HOURS_MISSING", "Completed with no actual hours reported; kept as unknown, not zero."))
            owner = (r.get("owner") or "").strip()
            assignee = self.resource_by_name.get(owner.lower()) if owner else None
            pct = to_float(r.get("pct"))
            wi = M.WorkItem(
                portfolio_project_id=r["_pid"], discipline=r.get("discipline"), stage=r["_stage"], name=r["name"],
                external_item_id=r["item_id"], assignee_resource_id=assignee, status=mapped,
                source_status_label=r.get("status"), priority=r.get("priority"), planned_start=planned_start,
                due_date=due, actual_start=start, completed_date=completed,
                planned_hours=to_float(r.get("planned_hours")), actual_hours=actual_hours,
                percent_complete=None if pct is None else pct / 100.0,
                blocked_reason=r.get("blocked_reason"), blocked_since=parse_date(r.get("blocked_since"))[0],
                expected_unblock_date=parse_date(r.get("expected_unblock"))[0], source_updated_at=r["_updated"])
            db.add(wi)
            db.flush()
            ext_to_core[r["item_id"]] = wi.id
            if r.get("depends_on__value"):
                pending_deps.append((wi, str(json.loads(r["depends_on__value"])["linkedPulseIds"][0]["linkedPulseId"])))
            rr.core_table, rr.core_id = "work_items", wi.id
            rr.load_status = "flagged" if flags else "loaded"
            for rule, detail in flags:
                self.exc(run, rule, f"{r['name']}: {detail}", raw=rr, entity_type="work_item", entity_id=wi.id,
                         external_id=r["item_id"], project_id=r["_pid"])
            for u in r["updates"]:
                m = re.match(r"(\w+) changed from (.+) to (.+)", u.get("body") or "")
                if not m:
                    continue
                old = None if m.group(2) == "blank" else m.group(2)
                db.add(M.WorkItemEvent(work_item_id=wi.id, at=parse_ts(u["created_at"]), field=m.group(1),
                                       old_value=old, new_value=m.group(3)))
        for wi, ext in pending_deps:
            wi.depends_on_work_item_id = ext_to_core.get(ext)
        self.work_item_ext = ext_to_core
        self.finish_run(run, "success", f"{len(rows)} items over {pages} page(s) via GraphQL cursor pagination.")

    # ======================================================================== 5. Timeline assignments
    def load_assignments(self):
        db, run = self.db, self.timeline_run
        for a in self.timeline["assignments"]:
            rr = self.stage(run, "assignment", a["id"], a)
            wi = self.work_item_ext.get(str(9_100_000_000 + a["work_item_id"])) if a.get("work_item_id") else None
            row = M.TimelineAssignment(id=a["id"], timeline_project_id=a["timeline_project_id"],
                                       resource_id=a["resource_id"], discipline=a["discipline"],
                                       milestone=a["milestone"], start_date=parse_date(a["start_date"])[0],
                                       end_date=parse_date(a["end_date"])[0], utilization=a["utilization"],
                                       status=a["status"], origin=a["origin"], work_item_id=wi)
            db.add(row)
            rr.core_table, rr.core_id, rr.load_status = "timeline_assignments", a["id"], "loaded"
            res = self.resources.get(a["resource_id"]) if a["resource_id"] else None
            if res is not None and not res.active and not res.is_placeholder:
                rr.load_status = "flagged"
                db.flush()
                tp = next(p for p in self.timeline["projects"] if p["id"] == a["timeline_project_id"])
                self.exc(run, "INACTIVE_RESOURCE_BOOKING",
                         f"{res.name} (inactive) holds the {a['discipline']} {a['milestone']} booking on {tp['name']} "
                         f"({a['start_date']} to {a['end_date']}).", raw=rr, entity_type="assignment",
                         entity_id=a["id"], project_id=tp["portfolio_project_id"])
        self.finish_run(run, "success")

    # ======================================================================== 6. Deliverable register
    def load_register(self, filename: str, run_started: datetime):
        db = self.db
        file_date = date.fromisoformat(filename.split("_")[-1].replace(".csv", ""))
        extracted = datetime(file_date.year, file_date.month, file_date.day, 11, 0, tzinfo=UTC)
        run = self.start_run("deliverable_register", filename, extracted, started_at=run_started)
        with open(os.path.join(self.src, filename), newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
            missing = [c for c in REGISTER_COLUMNS if c not in header]
            if missing:
                extra = [c for c in header if c not in REGISTER_COLUMNS]
                rows = list(reader)
                run.rows_extracted = len(rows)
                self.exc(run, "SCHEMA_DRIFT",
                         f"{filename}: expected column(s) {missing} not found (unexpected: {extra}). "
                         f"File refused; {len(rows)} rows not loaded; last good register data retained.",
                         entity_type="file", external_id=filename)
                self.finish_run(run, "failed", f"Schema drift: missing {missing}; found {extra}.")
                return False
            rows = list(reader)
        # Fresh load replaces the previous register snapshot (full-extract source).
        db.query(M.EngineeringDeliverable).delete()
        staged = [(r, self.stage(run, "deliverable", r["Register Row"], r)) for r in rows]
        db.flush()
        by_key: dict[tuple, list] = defaultdict(list)
        for r, rr in staged:
            pid, method, why = self.resolve_project("deliverable_register", None, r["Project"])
            if pid is None:
                rr.load_status = "rejected"
                self.exc(run, "REGISTER_UNMATCHED_PROJECT", f"Row {r['Register Row']} ({r['Document No.']}): {why}.",
                         raw=rr, entity_type="deliverable", external_id=r["Register Row"])
                continue
            stage = STAGE_MAP.get(label_key(r["Milestone"]))
            by_key[(pid, r["Discipline"], stage)].append((r, rr))
        wi_status = {(w.portfolio_project_id, w.discipline, w.stage): w
                     for w in db.scalars(select(M.WorkItem))}
        for key, group in by_key.items():
            group.sort(key=lambda x: x[0]["Register Row"], reverse=True)
            r, rr = group[0]
            for dr, drr in group[1:]:
                drr.load_status = "duplicate"
                self.exc(run, "REGISTER_DUPLICATE", f"Row {dr['Register Row']} duplicates row {r['Register Row']} "
                         f"({dr['Document No.']}); kept the later row.", raw=drr, entity_type="deliverable",
                         external_id=dr["Register Row"], project_id=key[0])
            flags = []
            planned, ok1 = parse_date(r["Planned Issue"])
            actual, ok2 = parse_date(r["Actual Issue"])
            for ok, col in ((ok1, "Planned Issue"), (ok2, "Actual Issue")):
                if not ok:
                    flags.append(("DATE_UNPARSEABLE", f"{col} value {r[col]!r} not recognised; stored as unknown."))
            status = self.status_map["deliverable_register"].get(label_key(r["Status"]))
            if status is None:
                status = "unknown"
                flags.append(("UNMAPPED_STATUS", f"Register status {r['Status']!r} not in the status map."))
            wi = wi_status.get(key)
            if wi is not None and wi.status == "done" and status != "issued" and planned and planned < self.as_of:
                flags.append(("STATUS_CONFLICT",
                              f"Monday shows {wi.discipline} {wi.stage} done (item {wi.external_item_id}) but the register "
                              f"shows '{r['Status']}' with no issue date; planned issue was {planned}."))
            d = M.EngineeringDeliverable(portfolio_project_id=key[0], discipline=key[1], stage=key[2],
                                         doc_number=r["Document No."], title=r["Title"], planned_issue_date=planned,
                                         actual_issue_date=actual, status=status, source_status_label=r["Status"],
                                         revision=r["Rev"], register_row_id=r["Register Row"],
                                         source_extracted_at=extracted)
            db.add(d)
            db.flush()
            rr.core_table, rr.core_id = "engineering_deliverables", d.id
            rr.load_status = "flagged" if flags else "loaded"
            for rule, detail in flags:
                self.exc(run, rule, f"{r['Document No.']}: {detail}", raw=rr, entity_type="deliverable",
                         entity_id=d.id, external_id=r["Register Row"], project_id=key[0])
        self.finish_run(run, "success")
        self.derive_milestone_actuals(run)
        return True

    def derive_milestone_actuals(self, run):
        """A milestone is achieved on the issue date of its LAST required
        deliverable — and only when every required discipline has issued."""
        db = self.db
        required: dict[int, list[str]] = defaultdict(list)
        for pd in db.scalars(select(M.ProjectDiscipline)):
            required[pd.portfolio_project_id].append(pd.discipline)
        dels: dict[tuple, dict] = defaultdict(dict)
        for d in db.scalars(select(M.EngineeringDeliverable)):
            dels[(d.portfolio_project_id, d.stage)][d.discipline] = d
        for m in db.scalars(select(M.Milestone)):
            need = [x for x in required[m.portfolio_project_id]
                    if m.stage != "IFP" or x in ("Electrical", "Substation", "Battery Storage")]
            have = dels.get((m.portfolio_project_id, m.stage), {})
            missing = [x for x in need if x not in have]
            if missing:
                m.actual_date = None
                self.exc(run, "MILESTONE_MISSING_DELIVERABLE",
                         f"{self.projects[m.portfolio_project_id].name} {m.stage}: no register row for {', '.join(missing)}.",
                         entity_type="milestone", entity_id=m.id, project_id=m.portfolio_project_id)
                continue
            dates = [have[x].actual_issue_date for x in need]
            m.actual_date = max(dates) if all(d is not None and have[x].status == "issued" for x, d in zip(need, dates)) else None

    # ======================================================================== 7. Meetings and actions
    def load_meetings(self):
        db = self.db
        data = self._read_json("meetings_actions.json")
        run = self.start_run("meeting_minutes", "meetings_actions.json", data["extracted_at"])
        self.roster = data["project_attendees"]
        for m in data["meetings"]:
            rr = self.stage(run, "meeting", m["id"], m)
            db.add(M.Meeting(id=m["id"], project_id=m["project_id"], portfolio_project_id=m["portfolio_project_id"],
                             meeting_date=parse_date(m["meeting_date"])[0], title=m["title"], stage=m["stage"],
                             graph_event_id=m["graph_event_id"], created_at=parse_ts(m["created_at"])))
            rr.load_status, rr.core_table, rr.core_id = "loaded", "meetings", m["id"]
        db.flush()
        users = list(db.scalars(select(M.User)))
        team = defaultdict(set)  # portfolio -> users who work on it (PMs, members, booked engineers)
        for pid, uid in db.execute(text("""
                SELECT pp.portfolio_id, pp.pm_user_id FROM portfolio_projects pp WHERE pp.pm_user_id IS NOT NULL
                UNION SELECT pm.project_id, pm.user_id FROM project_members pm
                UNION SELECT pp.portfolio_id, r.user_id FROM timeline_assignments a
                      JOIN timeline_projects tp ON tp.id = a.timeline_project_id
                      JOIN portfolio_projects pp ON pp.id = tp.portfolio_project_id
                      JOIN timeline_resources r ON r.id = a.resource_id WHERE r.user_id IS NOT NULL""")):
            team[pid].add(uid)
        resolver = OwnerResolver(users, team)
        for a in data["action_items"]:
            rr = self.stage(run, "action_item", a["id"], a)
            otype, basis, uid = resolver.resolve(a["owner"], a["owner_user_id"], a["owner_is_external"], a["project_id"])
            db.add(M.ActionItem(
                id=a["id"], project_id=a["project_id"], portfolio_project_id=a["portfolio_project_id"],
                originating_meeting_id=a["originating_meeting_id"], closed_in_meeting_id=a["closed_in_meeting_id"],
                text=a["text"], owner=a["owner"], owner_user_id=a["owner_user_id"],
                owner_is_external=a["owner_is_external"], owner_type=otype, owner_basis=basis,
                resolved_owner_user_id=uid, due_date=parse_date(a["due_date"])[0], status=a["status"],
                last_status_change=parse_ts(a["last_status_change"]), created_at=parse_ts(a["created_at"]),
                updated_at=parse_ts(a["updated_at"])))
            rr.core_table, rr.core_id = "action_items", a["id"]
            rr.load_status = "loaded"
            if otype == "unresolved":
                rr.load_status = "flagged"
                db.flush()
                self.exc(run, "ACTION_OWNER_UNRESOLVED", f"Action #{a['id']}: owner {a['owner']!r} does not resolve to a person.",
                         raw=rr, entity_type="action_item", entity_id=a["id"], project_id=a["portfolio_project_id"])
        self.finish_run(run, "success", "Minutes captured in PMO 360 (production: AI-parsed, PM-reviewed before save).")

    # ======================================================================== 8. Graph calendar
    def load_calendar(self):
        """Production matching order (api/calendar.py): manual link -> CLIENT
        attendee email (internal colleagues never indexed; first-seen wins) ->
        subject contains a portfolio name (longest first) or client name."""
        db = self.db
        data = self._read_json("graph_calendar_events.json")
        run = self.start_run("graph_calendar", "graph_calendar_events.json", self.clock - timedelta(minutes=1))
        email_index: dict[str, int] = {}
        for r in self.roster:
            e = (r["email"] or "").strip().lower()
            if e and not _is_internal(e) and e not in email_index:
                email_index[e] = r["project_id"]
        clients = {c.id: c.name.lower() for c in db.scalars(select(M.Client))}
        names = sorted([(p.id, p.name.lower(), clients.get(p.client_id)) for p in db.scalars(select(M.Project))],
                       key=lambda x: len(x[1]), reverse=True)
        for ev in data["value"]:
            rr = self.stage(run, "calendar_event", ev["id"], ev)
            start = _graph_start(ev["start"])
            attendees = [a["emailAddress"]["address"].lower() for a in ev.get("attendees", [])]
            external = [a for a in attendees if not _is_internal(a)]
            matched, method = None, None
            for a in external:
                if a in email_index:
                    matched, method = email_index[a], "attendee"
                    break
            if matched is None and ev.get("subject"):
                subj = ev["subject"].lower()
                for pid, pname, cname in names:
                    if (pname and pname in subj) or (cname and cname in subj):
                        matched, method = pid, "subject"
                        break
            if matched is None:
                method = "internal" if not external else "unmatched"
            ce = M.CalendarEvent(graph_event_id=ev["id"], subject=ev.get("subject"), start_at=start,
                                 organizer_email=ev["organizer"]["emailAddress"]["address"],
                                 attendee_emails=attendees, matched_project_id=matched, match_method=method)
            db.add(ce)
            db.flush()
            rr.core_table, rr.core_id = "calendar_events", ce.id
            rr.load_status = "flagged" if method == "unmatched" else "loaded"
            if method == "unmatched":
                self.exc(run, "CALENDAR_UNMATCHED", f"'{ev.get('subject')}' on {start.date()} has external attendees "
                         f"({', '.join(external[:2])}) but matched no portfolio.", raw=rr, entity_type="calendar_event",
                         entity_id=ce.id, external_id=ev["id"])
        self.finish_run(run, "success")

    # ======================================================================== 9. proposal360
    def load_proposals(self):
        db = self.db
        data = self._read_json("proposal360_export.json")
        run = self.start_run("proposal360", "proposal360_export.json", data["extracted_at"])
        events: dict[int, list] = defaultdict(list)
        for e in data["override_log"]:
            events[e["proposal_id"]].append(e)
        for p in data["proposals"]:
            rr = self.stage(run, "proposal", p["id"], {**p, "override_log": events[p["id"]]})
            db.add(M.Proposal(id=p["id"], job_number=p["job_number"], revision=p["revision"], title=p["title"],
                              client_id=p["client_id"], technology=p["technology"], mwdc=p["mwdc"], status=p["status"],
                              owner_user_id=p["owner_user_id"], fee_total=p["fee_total"],
                              created_at=parse_ts(p["created_at"]), portfolio_project_id=p["portfolio_project_id"]))
            db.flush()
            for e in events[p["id"]]:
                db.add(M.ProposalStageEvent(proposal_id=p["id"], from_status=e["old_value"], to_status=e["new_value"],
                                            at=parse_ts(e["at"]), user_id=e["user_id"]))
            rr.core_table, rr.core_id, rr.load_status = "proposals", p["id"], "loaded"
            if p["job_number"] and not JOB_NUMBER_SHAPE.match(p["job_number"]):
                rr.load_status = "flagged"
                self.exc(run, "INVALID_JOB_NUMBER", f"Proposal #{p['id']}: job number {p['job_number']!r} fails the shape check.",
                         raw=rr, entity_type="proposal", entity_id=p["id"])
            reached_later = p["status"] in ("open", "bid", "won", "closed")
            if reached_later and not any(e["new_value"] == "submitted" for e in events[p["id"]]):
                rr.load_status = "flagged"
                self.exc(run, "PROPOSAL_MISSING_SUBMITTED", f"Proposal #{p['id']} is '{p['status']}' with no submitted event; "
                         "turnaround unknown.", raw=rr, entity_type="proposal", entity_id=p["id"])
        self.finish_run(run, "success")

    # ======================================================================== 10. Change orders
    def load_change_orders(self):
        db = self.db
        data = self._read_json("change_orders.json")
        run = self.start_run("change_orders", "change_orders.json", data["extracted_at"])
        for c in data["change_orders"]:
            rr = self.stage(run, "change_order", c["id"], c)
            db.add(M.ChangeOrder(id=c["id"], project_id=c["project_id"], portfolio_project_id=c["portfolio_project_id"],
                                 co_number=c["co_number"], title=c["title"], rate_type=c["rate_type"], status=c["status"],
                                 request_date=parse_date(c["request_date"])[0], submitted_at=parse_ts(c["submitted_at"]),
                                 approved_at=parse_ts(c["approved_at"]), total_amount=c["total_amount"],
                                 schedule_impact_days=c["schedule_impact_days"]))
            rr.core_table, rr.core_id, rr.load_status = "change_orders", c["id"], "loaded"
            if c["status"] == "approved" and not c["approved_at"]:
                rr.load_status = "flagged"
                db.flush()
                self.exc(run, "CO_APPROVED_NO_TIMESTAMP", f"CO-{c['co_number']} ('{c['title']}') is approved with no approval timestamp.",
                         raw=rr, entity_type="change_order", entity_id=c["id"], project_id=c["portfolio_project_id"])
        self.finish_run(run, "success")


# ---------------------------------------------------------------------------- owner resolution
class OwnerResolver:
    """Who owns an action item? Production records owners as free text for most
    of the app's life (an owner picker capped at 200 users silently failed
    against 500), so ownership must be resolved by rule. Strongest first:

      owner_user_id set               -> internal (canonical)
      'Client - ...' / external flag  -> external (a client or vendor owns it)
      blank / 'TBD'                   -> unassigned
      exact full name                 -> internal
      first name, then initials       -> internal, but ONLY if unique among the people
                                         who work on that portfolio (its PMs, members
                                         and engineers booked on its projects)
      anything else                   -> unresolved (reported, counted with unassigned)

    Scoping short forms to the portfolio's team is what makes "PR" or "Priya"
    resolvable at all: company-wide, both are ambiguous. Production's substring
    rule attributes an ambiguous name to EVERY match; the demo refuses to guess.
    Production's Lead dashboard also counts client-owned actions as "no clear
    owner"; separating external owners is a demo refinement.
    """

    def __init__(self, users, team: dict[int, set[int]]):
        self.users = {u.id: u for u in users}
        self.by_full = {u.name.lower(): u.id for u in users}
        self.team = team
        self._cache: dict[int, tuple[dict, dict]] = {}

    def _short_forms(self, portfolio_id):
        if portfolio_id not in self._cache:
            firsts, inits = defaultdict(list), defaultdict(list)
            for uid in sorted(self.team.get(portfolio_id, ())):
                parts = self.users[uid].name.split()
                firsts[parts[0].lower()].append(uid)
                inits[(parts[0][0] + parts[-1][0]).lower()].append(uid)
            self._cache[portfolio_id] = ({k: v[0] for k, v in firsts.items() if len(v) == 1},
                                         {k: v[0] for k, v in inits.items() if len(v) == 1})
        return self._cache[portfolio_id]

    def resolve(self, owner, owner_user_id, external, portfolio_id):
        if owner_user_id:
            return "internal", "owner_user_id", owner_user_id
        text_ = (owner or "").strip()
        if external or text_.lower().startswith("client"):
            return "external", "external", None
        if not text_ or text_.upper() in ("TBD", "TBA", "?"):
            return "unassigned", "none", None
        t = text_.lower()
        if t in self.by_full:
            return "internal", "full_name", self.by_full[t]
        firsts, inits = self._short_forms(portfolio_id)
        if t in firsts:
            return "internal", "first_name", firsts[t]
        if t in inits:
            return "internal", "initials", inits[t]
        return "unresolved", "none", None


def _is_internal(email: str) -> bool:
    at = email.rfind("@")
    return at != -1 and email[at + 1:].strip().lower() in INTERNAL_EMAIL_DOMAINS


_WINDOWS_TZ = {"Eastern Standard Time": "America/New_York", "UTC": "UTC"}


def _graph_start(start: dict) -> datetime:
    """Graph returns {dateTime, timeZone}; the zone may be a Windows name."""
    naive = datetime.fromisoformat(start["dateTime"][:19])
    tz = ZoneInfo(_WINDOWS_TZ.get(start.get("timeZone", "UTC"), "UTC"))
    return naive.replace(tzinfo=tz).astimezone(UTC)
