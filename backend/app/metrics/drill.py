"""Drilldown registry: metric key -> the rows behind the number.

Contract enforced by tests/test_reconciliation.py: for every metric here, the
KPI shown on a dashboard equals len(rows(metric)) for the same filters.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.metrics import actions as A
from app.metrics import capacity as C
from app.metrics import commercial as CM
from app.metrics import delivery as D
from app.metrics import schedule as S
from app.metrics.common import Filters

SCHEDULE_PROJECT = {"active_projects", "projects_on_track", "projects_at_risk", "projects_behind",
                    "projects_unknown", "projects_on_hold"}
SCHEDULE_MILESTONE = {"late_milestones", "projected_late_milestones", "at_risk_milestones",
                      "upcoming_milestones", "ifp_milestones"}


def get_rows(db: Session, f: Filters, metric: str) -> list[dict]:
    if metric in SCHEDULE_PROJECT:
        return D.project_rows(S.compute(db, f), metric)
    if metric in SCHEDULE_MILESTONE:
        return D.milestone_rows(S.compute(db, f), f, metric)
    if metric == "overdue_deliverables":
        return D.overdue_deliverables(db, f)
    if metric == "blocked_work_items":
        return D.blocked_items(db, f)
    if metric in A.METRIC_WHERE:
        return A.rows(db, f, metric)
    if metric == "missing_minutes":
        return A.missing_minutes_rows(db, f)
    if metric == "overallocated_people":
        cap = C.compute(db, f)
        return [{k: p[k] for k in ("id", "name", "discipline", "title", "seniority", "peak_pct",
                                   "booked_during_timeoff")} | {"over_weeks": [cap["weeks"][i] for i in p["over_weeks"]],
                                              "pto_conflict_weeks": [cap["weeks"][i] for i in p["pto_conflict_weeks"]]}
                for p in cap["people"] if p["is_overallocated"]]
    if metric == "unstaffed_bookings":
        return C.compute(db, f)["unstaffed_bookings"]
    if metric == "competing_projects":
        return C.compute(db, f)["competing"]
    if metric == "co_backlog":
        return [r for r in CM.co_rows(db, f) if r["status"] in ("draft", "pending")]
    if metric == "proposals_pipeline":
        return [r for r in CM.proposal_rows(db, f) if r["status"] in ("draft", "submitted", "open", "bid")]
    raise KeyError(metric)


METRICS = sorted(SCHEDULE_PROJECT | SCHEDULE_MILESTONE | set(A.METRIC_WHERE) | {
    "overdue_deliverables", "blocked_work_items", "missing_minutes", "overallocated_people",
    "unstaffed_bookings", "competing_projects", "co_backlog", "proposals_pipeline"})


def apply_facets(rows: list[dict], facets: dict[str, str], search: str | None) -> list[dict]:
    out = rows
    for k, v in facets.items():
        out = [r for r in out if str(r.get(k)) == v]
    if search:
        s = search.lower()
        out = [r for r in out if any(isinstance(v, str) and s in v.lower() for v in r.values())]
    return out


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    if not rows:
        return ""
    cols = [k for k in rows[0].keys() if k != "basis"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: (v.isoformat() if isinstance(v, (date, datetime)) else v) for k, v in r.items() if k in cols})
    return buf.getvalue()
