"""Can we staff what we are bidding? Monthly demand against capacity, by discipline.

GRAINS
  capacity   active, non-placeholder engineers x business days in the month x 8 h
             x BILLABLE_SHARE (time left for project work after overhead, training
             and leave; holidays removed)
  sold       remaining hours of open work packages, spread evenly over the business
             days between today (or the planned start) and the due date
  proposals  open proposals (draft, submitted, client review, bid), if all were won:
             estimated hours by discipline from the proposal's size and type, using
             the same hours-per-package basis as the plan, spread over five months
             from the proposal's expected start

[DEMO] Proposal hour estimates are a rule of thumb, shown as such on screen.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.bizdays import business_days_between, is_business_day
from app.metrics.common import Filters, q
from pipeline.world import BASE_HOURS, ELECTRICAL_SCOPE, HOURS_SCALE

DISCIPLINES = ["Electrical", "Civil", "Structural"]
OPEN = ("draft", "submitted", "open", "bid")
SPREAD_MONTHS = 5
BILLABLE_SHARE = 0.8


def _month_starts(as_of: date, n: int) -> list[date]:
    out, y, m = [], as_of.year, as_of.month
    for _ in range(n):
        out.append(date(y, m, 1))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def _bdays(a: date, b: date) -> list[date]:
    out, d = [], a
    while d <= b:
        if is_business_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def proposal_hours(mwdc: float | None, tech: str | None) -> dict[str, float]:
    size = min(1.6, max(0.6, ((mwdc or 50) / 50) ** 0.3))
    out = {}
    for disc in DISCIPLINES:
        stages = dict(BASE_HOURS[disc])
        stages.pop("IFP", None)  # equipment-purchase packages are not in every scope
        scope = ELECTRICAL_SCOPE.get(tech or "", 1.0) if disc == "Electrical" else 1.0
        out[disc] = round(sum(stages.values()) * HOURS_SCALE * size * scope)
    return out


def compute(db: Session, f: Filters, n_months: int = 6) -> dict:
    as_of = f.as_of
    nxt = (as_of.replace(day=28) + timedelta(days=4)).replace(day=1)  # from next month: this month is mostly committed
    months = _month_starts(nxt, n_months)
    keys = [m.strftime("%Y-%m") for m in months]
    end = (months[-1].replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    first = months[0]

    heads = {r["discipline"]: r["n"] for r in q(db, """
        SELECT discipline, COUNT(*) AS n FROM timeline_resources
        WHERE active AND NOT is_placeholder AND discipline = ANY(:d) GROUP BY 1""", {"d": DISCIPLINES})}
    cap = {d: {k: 0.0 for k in keys} for d in DISCIPLINES}
    for day in _bdays(first, end):
        k = day.strftime("%Y-%m")
        for d in DISCIPLINES:
            cap[d][k] += 8.0 * heads.get(d, 0) * BILLABLE_SHARE

    sold = {d: {k: 0.0 for k in keys} for d in DISCIPLINES}
    for w in q(db, """
        SELECT w.discipline, w.planned_start, w.due_date, w.planned_hours, COALESCE(w.percent_complete, 0) AS pct
        FROM work_items w JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
        WHERE w.status NOT IN ('done','cancelled') AND pp.lifecycle IN ('active','upcoming')
          AND w.planned_hours IS NOT NULL AND w.discipline = ANY(:d)""", {"d": DISCIPLINES}):
        rem = float(w["planned_hours"]) * (1 - float(w["pct"]))
        a = max(as_of, w["planned_start"] or as_of)
        b = max(a + timedelta(days=7), w["due_date"] or a)
        days = _bdays(a, b)
        for day in days:
            k = day.strftime("%Y-%m")
            if k in sold[w["discipline"]]:
                sold[w["discipline"]][k] += rem / len(days)

    props = q(db, """
        SELECT p.id, p.job_number, p.title, p.status, p.technology, p.mwdc, p.expected_start, c.name AS client_name
        FROM proposals p JOIN clients c ON c.id = p.client_id
        WHERE p.status = ANY(:s) AND p.expected_start IS NOT NULL ORDER BY p.expected_start""", {"s": list(OPEN)})
    bid = {d: {k: 0.0 for k in keys} for d in DISCIPLINES}
    plist = []
    for p in props:
        hrs = proposal_hours(p["mwdc"], p["technology"])
        start = p["expected_start"]
        span = _bdays(start, start + timedelta(days=30 * SPREAD_MONTHS))
        for d in DISCIPLINES:
            for day in span:
                k = day.strftime("%Y-%m")
                if k in bid[d]:
                    bid[d][k] += hrs[d] / len(span)
        plist.append({**{k: p[k] for k in ("id", "job_number", "title", "status", "client_name", "mwdc")},
                      "expected_start": start, "hours": hrs})

    rows = []
    for d in DISCIPLINES:
        for k in keys:
            c = cap[d][k]
            rows.append({"discipline": d, "month": k, "capacity": round(c), "sold": round(sold[d][k]), "proposals": round(bid[d][k]),
                         "sold_pct": round(100 * sold[d][k] / c) if c else None,
                         "total_pct": round(100 * (sold[d][k] + bid[d][k]) / c) if c else None})
    peak = max(rows, key=lambda r: r["total_pct"] or 0)
    return {"months": keys, "rows": rows, "peak": peak, "headcount": heads, "proposals": plist,
            "spread_months": SPREAD_MONTHS, "billable_share": BILLABLE_SHARE}
