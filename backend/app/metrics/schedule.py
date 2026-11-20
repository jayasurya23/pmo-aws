"""Schedule health: milestone status, rules-based projection, project health.

GRAIN
  milestone status  - one row per milestone (project x stage), as of the reporting date
  project health    - one row per project, as of the reporting date

MILESTONE STATUS RULE (evaluated in this order)
  complete_on_time  actual_date <= planned_date
  complete_late     actual_date >  planned_date
  on_hold           project is on client hold (excluded from late / at-risk counts)
  no_plan           no planned date (unknown, never "on track")
  late              not achieved and planned_date < as_of   (ALREADY late)
  no_data           future, and no work packages exist to project from
  projected_late    future, projection more than 5 business days after planned
  at_risk           future, projection 3-5 business days after planned; OR due
                    within 10 business days with an upstream work package
                    blocked, overdue or in an unknown status
  on_track          otherwise (a projected slip of up to 2 business days is
                    inside tolerance - schedule reviews do not chase one-day noise)

PROJECTION (illustrative, rules-based — NOT a statistical forecast)
  For each open work package of the milestone's stage:
    remaining hours  = planned_hours x (1 - % complete)
    daily rate       = 8 h x the Timeline utilisation booked for it (0.5 if unstaffed)
    start            = as_of if started; if blocked, its expected unblock date or
                       as_of + 5 business days; if not started, the later of its
                       planned start and the previous stage's projected finish
                       for the same discipline
    finish           = start + remaining hours / daily rate (business days);
                       a package that has not slipped its start keeps its due date
  milestone projection = latest package finish + 3 business days (QC + issue),
  never earlier than the planned date. Every input is shown on the drilldown.

PROJECT HEALTH
  behind    any milestone late
  at_risk   any milestone projected_late or at_risk
  unknown   next open milestone has no plan or no work data
  on_track  otherwise (active projects only); complete / upcoming / on_hold pass through
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session

from app.bizdays import add_business_days, business_days_between
from app.metrics.common import Filters, q, scope_sql

QC_LAG_BD = 3
BLOCKED_DEFAULT_BD = 5
AT_RISK_WINDOW_BD = 10
TOLERANCE_BD = 2          # projected slip inside this band is "on track"
PROJECTED_LATE_BD = 5     # projected slip beyond this is "projected late"
UNSTAFFED_UTIL = 0.5
STAGE_ORDER = {"30%": 1, "60%": 2, "90%": 3, "IFP": 4, "IFC": 5}

STATUS_LABEL = {
    "complete_on_time": "Done on time", "complete_late": "Done late", "late": "Late",
    "projected_late": "Projected late", "at_risk": "At risk", "on_track": "On track",
    "on_hold": "On hold", "no_plan": "No plan", "no_data": "No work data",
}
HEALTH_LABEL = {"behind": "Behind", "at_risk": "At risk", "on_track": "On track", "unknown": "Unknown",
                "complete": "Complete", "upcoming": "Not started", "on_hold": "On hold"}


def _project_rows(db: Session, f: Filters) -> list[dict]:
    where, params = scope_sql(f)
    return q(db, f"""
        SELECT pp.id, pp.name, pp.technology, pp.lifecycle, pp.state, pp.size_mw, pp.kickoff_date,
               pp.portfolio_id, pf.name AS portfolio_name, pf.project_number, c.id AS client_id,
               c.name AS client_name, pp.pm_user_id, u.name AS pm_name
        FROM portfolio_projects pp
        JOIN projects pf ON pf.id = pp.portfolio_id
        JOIN clients c ON c.id = pf.client_id
        LEFT JOIN users u ON u.id = pp.pm_user_id
        WHERE {where}
        ORDER BY pp.id""", params)


def compute(db: Session, f: Filters) -> dict:
    """Returns {'projects': [...], 'milestones': [...]} with status and projection."""
    projects = _project_rows(db, f)
    if not projects:
        return {"projects": [], "milestones": []}
    ids = [p["id"] for p in projects]
    ms_rows = q(db, """
        SELECT m.id, m.portfolio_project_id AS project_id, m.stage, m.seq, m.baseline_date, m.planned_date,
               m.actual_date, m.revision_count, m.last_revision_reason
        FROM milestones m WHERE m.portfolio_project_id = ANY(:ids)
        ORDER BY m.portfolio_project_id, m.seq""", {"ids": ids})
    # One utilisation per work item: SUM over its bookings (a split package has
    # several bars). LEFT JOIN + GROUP BY keeps one row per work item.
    wi_rows = q(db, """
        SELECT w.id, w.portfolio_project_id AS project_id, w.discipline, w.stage, w.status, w.planned_start,
               w.due_date, w.actual_start, w.completed_date, w.planned_hours, w.percent_complete,
               w.blocked_reason, w.blocked_since, w.expected_unblock_date, w.assignee_resource_id,
               r.name AS assignee_name,
               COALESCE(SUM(a.utilization) FILTER (WHERE a.resource_id IS NOT NULL), 0) AS util
        FROM work_items w
        LEFT JOIN timeline_resources r ON r.id = w.assignee_resource_id
        LEFT JOIN timeline_assignments a ON a.work_item_id = w.id
        WHERE w.portfolio_project_id = ANY(:ids)
        GROUP BY w.id, r.name""", {"ids": ids})
    as_of = f.as_of
    wis: dict[tuple, list] = defaultdict(list)
    for w in wi_rows:
        wis[(w["project_id"], w["stage"])].append(w)
    proj = {p["id"]: p for p in projects}
    ms_by_proj: dict[int, list] = defaultdict(list)
    for m in ms_rows:
        ms_by_proj[m["project_id"]].append(m)

    out_ms = []
    for pid, mlist in ms_by_proj.items():
        p = proj[pid]
        prev_finish: dict[str, date] = {}
        for m in sorted(mlist, key=lambda x: x["seq"]):
            items = wis.get((pid, m["stage"]), [])
            m.update(_classify(m, items, p, prev_finish, as_of))
            m.update({"project_name": p["name"], "portfolio_id": p["portfolio_id"],
                      "portfolio_name": p["portfolio_name"], "client_name": p["client_name"],
                      "pm_name": p["pm_name"], "technology": p["technology"]})
            out_ms.append(m)

    # Project health from its milestones.
    by_p: dict[int, list] = defaultdict(list)
    for m in out_ms:
        by_p[m["project_id"]].append(m)
    for p in projects:
        mlist = sorted(by_p.get(p["id"], []), key=lambda x: x["seq"])
        p["health"] = _health(p, mlist)
        p["health_label"] = HEALTH_LABEL[p["health"]]
        nxt = next((m for m in mlist if m["actual_date"] is None), None)
        p["next_milestone"] = nxt["stage"] if nxt else None
        p["next_planned"] = nxt["planned_date"] if nxt else None
        p["next_forecast"] = nxt.get("forecast_date") if nxt else None
        p["next_status"] = nxt["status"] if nxt else None
        p["late_milestones"] = sum(1 for m in mlist if m["status"] == "late")
        p["worst_slip_bd"] = max([m.get("slip_bd") or 0 for m in mlist] + [0])
        p["revisions"] = sum(m["revision_count"] for m in mlist)
    return {"projects": projects, "milestones": out_ms}


def _d(x: date) -> str:
    return f"{x.day} {x:%b}"


def _item_finish(w: dict, prev_finish: dict, as_of: date) -> tuple[date | None, str]:
    """Projected finish for one work package, plus a short basis string."""
    if w["status"] in ("done", "cancelled"):
        return w["completed_date"], "complete"
    util = float(w["util"] or 0) or UNSTAFFED_UTIL
    hours = float(w["planned_hours"] or 0)
    pct_done = float(w["percent_complete"] or 0)
    remaining_bd = math.ceil(max(0.0, hours * (1 - pct_done)) / (8.0 * util)) if hours else 0
    staffed = "" if w["util"] else " (no one booked yet, so 50% is assumed)"
    left = f"{remaining_bd} working days of effort left at {util:.0%} booked{staffed}"
    if w["status"] == "blocked":
        start = w["expected_unblock_date"] or add_business_days(as_of, BLOCKED_DEFAULT_BD)
        basis = (f"blocked until {_d(start)}" + ("" if w["expected_unblock_date"] else " (no date given, so 5 business days assumed)")
                 + f"; then {left}")
        return add_business_days(start, remaining_bd), basis
    if w["status"] in ("in_progress", "in_review", "unknown"):
        fin = add_business_days(as_of, max(remaining_bd, 1 if w["status"] == "in_review" else remaining_bd))
        due = w["due_date"]
        if due and fin <= due:
            return due, f"{left}; fits before its due date"
        return fin, left
    # not started
    planned_start = w["planned_start"] or as_of
    upstream = prev_finish.get(w["discipline"])
    start = max(d for d in (planned_start, as_of, add_business_days(upstream, 1) if upstream else None) if d)
    due = w["due_date"]
    if start <= planned_start and due:
        return due, "not started; the plan still holds"
    total_bd = math.ceil(hours / (8.0 * util)) if hours else 0
    fin = add_business_days(start, total_bd)
    if due and fin < due:
        fin = due
    return fin, f"cannot start until {_d(start)} (waiting on earlier work); {total_bd} working days of effort at {util:.0%} booked{staffed}"


def _classify(m: dict, items: list[dict], p: dict, prev_finish: dict, as_of: date) -> dict:
    planned, actual = m["planned_date"], m["actual_date"]
    res = {"status": None, "forecast_date": None, "slip_bd": None, "variance_bd": None,
           "days_late_bd": None, "basis": [], "work_items": len(items),
           "blocked_items": sum(1 for w in items if w["status"] == "blocked"),
           "open_items": sum(1 for w in items if w["status"] not in ("done", "cancelled"))}
    finishes = []
    for w in sorted(items, key=lambda x: x["discipline"]):
        fin, basis = _item_finish(w, prev_finish, as_of)
        if fin:
            finishes.append(fin)
            prev_finish[w["discipline"]] = fin
        if w["status"] not in ("done", "cancelled"):
            res["basis"].append(f"{w['discipline']}: {basis}" + (f", finishing {_d(fin)}" if fin else ""))
    if actual is not None:
        res["status"] = "complete_on_time" if actual <= planned else "complete_late"
        res["variance_bd"] = business_days_between(planned, actual)
        return res
    if p["lifecycle"] == "on_hold":
        res["status"] = "on_hold"
        return res
    if planned is None:
        res["status"] = "no_plan"
        return res
    projection = None
    if finishes:
        projection = max(planned, add_business_days(max(finishes), QC_LAG_BD))
        res["forecast_date"] = projection
        res["slip_bd"] = max(0, business_days_between(planned, projection))
    if planned < as_of:
        res["status"] = "late"
        res["days_late_bd"] = business_days_between(planned, as_of)
        return res
    if not items:
        res["status"] = "no_data"
        return res
    slip = res["slip_bd"] or 0
    if slip > PROJECTED_LATE_BD:
        res["status"] = "projected_late"
        return res
    if slip > TOLERANCE_BD:
        res["status"] = "at_risk"
        return res
    near = business_days_between(as_of, planned) <= AT_RISK_WINDOW_BD
    trouble = any(w["status"] in ("blocked", "unknown") or (w["status"] not in ("done", "cancelled")
                  and w["due_date"] and w["due_date"] < as_of) for w in items)
    res["status"] = "at_risk" if near and trouble else "on_track"
    return res


def _health(p: dict, mlist: list[dict]) -> str:
    if p["lifecycle"] in ("complete", "upcoming", "on_hold"):
        return p["lifecycle"]
    statuses = {m["status"] for m in mlist}
    if "late" in statuses:
        return "behind"
    if statuses & {"projected_late", "at_risk"}:
        return "at_risk"
    nxt = next((m for m in mlist if m["actual_date"] is None), None)
    if nxt is None or nxt["status"] in ("no_plan", "no_data"):
        return "unknown"
    return "on_track"
