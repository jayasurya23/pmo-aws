"""Portfolio and commercial operations.

These are ENGINEERING-SERVICES records: proposals Castillo sends to clients and
change orders to those contracts. They are not supplier purchase orders — the
firm designs; its clients and their EPCs buy the equipment.

GRAINS
  proposal          one proposal (current stage = proposals.status)
  turnaround        one proposal that has a 'submitted' event: business days from
                    creation to the FIRST submitted event (proposal360 override_log).
                    No submitted event -> unknown, excluded, and counted.
  change order      one CO; backlog = draft + pending; approval cycle = business
                    days from submitted to approved (approved COs with both stamps)
  delivery workload one open work package, by discipline and month of due date
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.bizdays import business_days_between
from app.metrics.common import Filters, q, scope_sql

ET = "America/New_York"
STAGES = ["draft", "submitted", "open", "bid", "won", "closed"]
STAGE_LABEL = {"draft": "Draft", "submitted": "Submitted", "open": "Open (client review)", "bid": "Bid",
               "won": "Won (awarded)", "closed": "Closed (not awarded)"}


def _median(xs):
    xs = sorted(xs)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else round((xs[n // 2 - 1] + xs[n // 2]) / 2, 1)


def _p80(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.8 * (len(xs) - 1))))] if xs else None


def _client_clause(f: Filters, alias="p") -> tuple[str, dict]:
    if f.client_ids:
        return f"{alias}.client_id = ANY(:f_clients)", {"f_clients": f.client_ids}
    if f.portfolio_ids:
        return f"{alias}.client_id IN (SELECT client_id FROM projects WHERE id = ANY(:f_portfolios))", {"f_portfolios": f.portfolio_ids}
    return "TRUE", {}


def proposal_rows(db: Session, f: Filters) -> list[dict]:
    where, params = _client_clause(f)
    rows = q(db, f"""
        SELECT p.id, p.job_number, p.title, p.status, p.technology, p.mwdc, p.fee_total, c.name AS client_name,
               u.name AS owner_name, (p.created_at AT TIME ZONE '{ET}')::date AS created_d,
               (SELECT MIN(e.at) FROM proposal_stage_events e WHERE e.proposal_id = p.id AND e.to_status = 'submitted') AS submitted_at
        FROM proposals p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.owner_user_id
        WHERE (p.created_at AT TIME ZONE '{ET}')::date <= :as_of AND {where}
        ORDER BY p.created_at DESC""", {**params, "as_of": f.as_of})
    for r in rows:
        sd = r["submitted_at"].astimezone(ZoneInfo(ET)).date() if r["submitted_at"] else None
        r["submitted_d"] = sd
        r["turnaround_bd"] = business_days_between(r["created_d"], sd) if sd else None
        r["age_bd"] = business_days_between(r["created_d"], f.as_of)
        r.pop("submitted_at")
    return rows


def co_rows(db: Session, f: Filters) -> list[dict]:
    where, params = scope_sql(f, "pp")
    rows = q(db, f"""
        SELECT co.id, co.co_number, co.title, co.status, co.rate_type, co.total_amount, co.schedule_impact_days,
               co.request_date, (co.submitted_at AT TIME ZONE '{ET}')::date AS submitted_d,
               (co.approved_at AT TIME ZONE '{ET}')::date AS approved_d,
               pp.id AS project_id, pp.name AS project_name, pf.name AS portfolio_name, c.name AS client_name
        FROM change_orders co
        JOIN portfolio_projects pp ON pp.id = co.portfolio_project_id
        JOIN projects pf ON pf.id = pp.portfolio_id JOIN clients c ON c.id = pf.client_id
        WHERE co.request_date <= :as_of AND {where}
        ORDER BY co.request_date DESC""", {**params, "as_of": f.as_of})
    for r in rows:
        r["approval_bd"] = business_days_between(r["submitted_d"], r["approved_d"]) if r["submitted_d"] and r["approved_d"] else None
        r["pending_bd"] = business_days_between(r["submitted_d"], f.as_of) if r["status"] == "pending" and r["submitted_d"] else None
        r["draft_bd"] = business_days_between(r["request_date"], f.as_of) if r["status"] == "draft" else None
    return rows


def dashboard(db: Session, f: Filters, schedule: dict) -> dict:
    props = proposal_rows(db, f)
    by_stage = []
    for st in STAGES:
        sel = [p for p in props if p["status"] == st]
        fees = [p["fee_total"] for p in sel if p["fee_total"] is not None]
        by_stage.append({"stage": st, "label": STAGE_LABEL[st], "count": len(sel), "fee_total": round(sum(fees)),
                         "fee_unknown": len(sel) - len(fees)})
    # Turnaround by month of creation, inside the trend window.
    t0 = f.trend_start
    months = defaultdict(list)
    for p in props:
        if p["turnaround_bd"] is not None and p["created_d"] >= t0:
            months[p["created_d"].strftime("%Y-%m")].append(p["turnaround_bd"])
    turnaround = [{"month": m, "median_bd": _median(v), "p80_bd": _p80(v), "n": len(v)} for m, v in sorted(months.items())]
    known = [p["turnaround_bd"] for p in props if p["turnaround_bd"] is not None and p["created_d"] >= t0]
    unknown_ta = sum(1 for p in props if p["created_d"] >= t0 and p["status"] in ("open", "bid", "won", "closed")
                     and p["turnaround_bd"] is None)

    cos = co_rows(db, f)
    backlog = [c for c in cos if c["status"] in ("draft", "pending")]
    approved = [c for c in cos if c["status"] == "approved"]
    cycle = [c["approval_bd"] for c in approved if c["approval_bd"] is not None]
    aging = defaultdict(lambda: {"count": 0, "value": 0.0})
    for c in backlog:
        age = c["pending_bd"] if c["status"] == "pending" else c["draft_bd"]
        b = "0-5" if age <= 5 else "6-10" if age <= 10 else "11-20" if age <= 20 else "20+"
        aging[(c["status"], b)]["count"] += 1
        aging[(c["status"], b)]["value"] += c["total_amount"] or 0
    aging_rows = [{"status": s, "bucket": b, **v} for (s, b), v in aging.items()]
    approved_by_month = defaultdict(lambda: {"count": 0, "value": 0.0})
    for c in approved:
        if c["approved_d"] and c["approved_d"] >= t0:
            m = c["approved_d"].strftime("%Y-%m")
            approved_by_month[m]["count"] += 1
            approved_by_month[m]["value"] += c["total_amount"] or 0
    # Scope change per project: approved COs + schedule revisions.
    rev = defaultdict(int)
    for m in schedule["milestones"]:
        rev[m["project_id"]] = max(rev[m["project_id"]], m["revision_count"])
    scope = defaultdict(lambda: {"approved_cos": 0, "co_value": 0.0, "impact_bd": 0})
    names = {p["id"]: p for p in schedule["projects"]}
    for c in approved:
        s = scope[c["project_id"]]
        s["approved_cos"] += 1
        s["co_value"] += c["total_amount"] or 0
        s["impact_bd"] += c["schedule_impact_days"] or 0
    scope_rows = []
    for pid, s in scope.items():
        if pid in names:
            scope_rows.append({"project_id": pid, "project": names[pid]["name"], "portfolio": names[pid]["portfolio_name"],
                               "health": names[pid]["health_label"], "milestone_revisions": rev.get(pid, 0), **s})
    scope_rows.sort(key=lambda r: (-r["impact_bd"], -r["co_value"]))

    # Delivery workload: open work packages by discipline x month due (next 6 months).
    where, params = scope_sql(f, "pp")
    disc = "AND w.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    workload = q(db, f"""
        SELECT w.discipline, to_char(date_trunc('month', w.due_date), 'YYYY-MM') AS month,
               COUNT(*) AS packages,
               ROUND(SUM(w.planned_hours * (1 - COALESCE(w.percent_complete, 0)))::numeric, 0) AS remaining_hours
        FROM work_items w JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
        WHERE w.status NOT IN ('done','cancelled') AND pp.lifecycle <> 'on_hold'
          AND w.due_date BETWEEN date_trunc('month', CAST(:as_of AS date)) AND CAST(:as_of AS date) + 183
          AND {where} {disc}
        GROUP BY 1, 2 ORDER BY 2, 1""", {**params, "as_of": f.as_of})
    for r in workload:
        r["remaining_hours"] = float(r["remaining_hours"] or 0)

    bottlenecks = (
        [{"kind": "Change order pending approval", "ref": f"CO-{c['co_number']}", "title": c["title"],
          "where": f"{c['project_name']} ({c['client_name']})", "age_bd": c["pending_bd"], "value": c["total_amount"],
          "project_id": c["project_id"]} for c in backlog if c["status"] == "pending" and (c["pending_bd"] or 0) > 10]
        + [{"kind": "Proposal still in draft", "ref": p["job_number"] or f"#{p['id']}", "title": p["title"],
            "where": p["client_name"], "age_bd": p["age_bd"], "value": p["fee_total"], "project_id": None}
           for p in props if p["status"] == "draft" and p["age_bd"] > 15]
    )
    bottlenecks.sort(key=lambda r: -(r["age_bd"] or 0))
    return {
        "kpis": {
            "proposals_open_pipeline": sum(1 for p in props if p["status"] in ("draft", "submitted", "open", "bid")),
            "proposals_won_window": sum(1 for p in props if p["status"] == "won" and p["created_d"] >= t0),
            "turnaround_median_bd": _median(known), "turnaround_p80_bd": _p80(known),
            "turnaround_unknown": unknown_ta, "turnaround_n": len(known),
            "co_backlog_count": len(backlog), "co_backlog_value": round(sum(c["total_amount"] or 0 for c in backlog)),
            "co_pending_count": sum(1 for c in backlog if c["status"] == "pending"),
            "co_approval_median_bd": _median(cycle),
            "co_approved_missing_ts": sum(1 for c in approved if c["approval_bd"] is None),
            "projects_with_scope_change": len(scope_rows),
        },
        "by_stage": by_stage, "turnaround": turnaround, "co_aging": aging_rows,
        "co_approved_by_month": [{"month": m, **v} for m, v in sorted(approved_by_month.items())],
        "scope_changes": scope_rows[:20], "workload": workload, "bottlenecks": bottlenecks[:15],
    }
