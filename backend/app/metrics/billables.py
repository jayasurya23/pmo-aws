"""Billables: what the firm can invoice, when, and what the schedule puts at risk.

Engineering design is billed by milestone: when a design stage (30/60/90/IFP/IFC)
is issued, its share of the fee becomes billable. This view values each
milestone at its planned engineering hours x a blended rate, so billing follows
the same milestone statuses the Schedule dashboard uses.

GRAINS
  milestone value   one milestone; value = SUM(planned hours of its work packages,
                    in the filtered disciplines) x BLENDED_RATE. Any package with
                    no planned hours makes the milestone's value UNKNOWN (counted,
                    never zero).
  billed            milestone achieved (actual_date) -> billable in that month
  overdue           planned date passed, not achieved (status 'late')
  upcoming          planned in the next 6 months, split by projected status
  change orders     draft or pending COs: scope not billable until approved

[DEMO] The rate is a demonstration blended rate, not a real price list.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.metrics import commercial as CM
from app.metrics.common import Filters, q

BLENDED_RATE = 200.0  # $/h, demonstration value
HORIZON_DAYS = 183
UPCOMING = ("on_track", "at_risk", "projected_late")


def _month(d: date) -> str:
    return d.strftime("%Y-%m")


def _months(start: date, n: int) -> list[str]:
    out, y, m = [], start.year, start.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def milestone_values(db: Session, f: Filters, schedule: dict) -> list[dict]:
    ids = [p["id"] for p in schedule["projects"]]
    if not ids:
        return []
    disc = "AND w.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    hours = {(r["pid"], r["stage"]): r for r in q(db, f"""
        SELECT w.portfolio_project_id AS pid, w.stage, SUM(w.planned_hours) AS h,
               COUNT(*) AS n, COUNT(w.planned_hours) AS known
        FROM work_items w WHERE w.portfolio_project_id = ANY(:ids) AND w.status <> 'cancelled' {disc}
        GROUP BY 1, 2""", {"ids": ids, "f_disciplines": f.disciplines})}
    out = []
    for m in schedule["milestones"]:
        h = hours.get((m["project_id"], m["stage"]))
        if not h:
            continue  # no work in the filtered disciplines for this milestone
        known = h["known"] == h["n"]
        out.append({
            "project_id": m["project_id"], "project_name": m["project_name"], "client_name": m["client_name"],
            "portfolio_name": m["portfolio_name"], "stage": m["stage"], "status": m["status"],
            "planned_date": m["planned_date"], "forecast_date": m.get("forecast_date"), "actual_date": m["actual_date"],
            "slip_bd": m.get("slip_bd"), "hours": float(h["h"]) if known else None,
            "value": round(float(h["h"]) * BLENDED_RATE) if known else None,
        })
    return out


def dashboard(db: Session, f: Filters, schedule: dict) -> dict:
    as_of = f.as_of
    rows = milestone_values(db, f, schedule)
    end = as_of + timedelta(days=HORIZON_DAYS)
    past_start = date(as_of.year - (1 if as_of.month <= 6 else 0), (as_of.month - 7) % 12 + 1, 1)
    months = _months(past_start, 13)  # six months back, this month, six ahead
    by_month = {m: {"month": m, "billed": 0, "on_track": 0, "at_risk": 0, "projected_late": 0} for m in months}

    billed_6m = upcoming_90 = upcoming_6m = overdue = at_risk = 0
    unknown = 0
    at_risk_rows, by_client = [], defaultdict(lambda: {"billed": 0, "upcoming": 0, "at_risk": 0})
    for r in rows:
        if r["status"] in ("on_hold", "no_plan"):
            continue
        if r["value"] is None:
            unknown += 1
            continue
        v = r["value"]
        c = by_client[r["client_name"]]
        if r["actual_date"] is not None:
            mk = _month(r["actual_date"])
            if mk in by_month and r["actual_date"] <= as_of:
                by_month[mk]["billed"] += v
            if as_of - timedelta(days=HORIZON_DAYS) < r["actual_date"] <= as_of:
                billed_6m += v
                c["billed"] += v
            continue
        if r["status"] == "late":
            overdue += v
            c["at_risk"] += v
            at_risk_rows.append(r)
            continue
        if r["status"] in UPCOMING and r["planned_date"] and as_of <= r["planned_date"] <= end:
            upcoming_6m += v
            c["upcoming"] += v
            if r["planned_date"] <= as_of + timedelta(days=90):
                upcoming_90 += v
            mk = _month(r["planned_date"])
            if mk in by_month:
                by_month[mk][r["status"]] += v
            if r["status"] != "on_track":
                at_risk += v
                c["at_risk"] += v
                at_risk_rows.append(r)

    order = {"late": 0, "projected_late": 1, "at_risk": 2}
    at_risk_rows.sort(key=lambda r: (order.get(r["status"], 3), -(r["value"] or 0)))
    cos = CM.co_rows(db, f)
    backlog = [c for c in cos if c["status"] in ("draft", "pending")]
    co_value = round(sum(c["total_amount"] or 0 for c in backlog))
    clients = sorted(({"client": k, **v} for k, v in by_client.items()), key=lambda r: -(r["at_risk"] + r["upcoming"]))
    return {
        "rate": BLENDED_RATE,
        "kpis": {
            "billed_6m": billed_6m, "billable_90d": upcoming_90, "billable_6m": upcoming_6m,
            "overdue_value": overdue, "at_risk_value": at_risk, "co_waiting_value": co_value,
            "co_waiting_count": len(backlog), "unknown_milestones": unknown,
        },
        "by_month": list(by_month.values()),
        "current_month": _month(as_of),
        "at_risk": [{k: r[k] for k in ("project_id", "project_name", "client_name", "stage", "status", "planned_date",
                                        "forecast_date", "slip_bd", "value")} for r in at_risk_rows[:12]],
        "at_risk_count": len(at_risk_rows),
        "by_client": clients[:10],
        "co_waiting": sorted(({"id": c["id"], "co_number": c["co_number"], "title": c["title"], "status": c["status"],
                               "project_id": c["project_id"], "project_name": c["project_name"],
                               "value": c["total_amount"], "waiting_bd": c["pending_bd"] if c["status"] == "pending" else c["draft_bd"]}
                              for c in backlog), key=lambda r: -(r["value"] or 0))[:10],
    }
