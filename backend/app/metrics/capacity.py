"""Resource capacity — a port of production PMO 360 `api/timeline.py::get_board`.

GRAIN: resource x week (Monday-start work weeks).

Production formulas (kept):
  load(r, w)          = SUM over r's bookings of utilisation x overlapping workdays / 5
  availability(r, w)  = 1 - blocked workdays / 5, where blocked days are time off and,
                        for placeholders, every workday before `available_from`

Demo refinements (documented, deliberate):
  * Expressed in HOURS: utilisation x 8 h x overlapping working days, so planned and
    actual hours share an axis. Weekly capacity is 40 h.
  * Company holidays remove a day from BOTH booked and available hours. Production
    counts booked weekdays through a holiday while the holiday reduces availability,
    which makes every holiday week look over-allocated. PTO still reduces only
    availability: work booked during someone's PTO is a real conflict.
  * allocated % of available = booked hours / available hours.
  * over-allocated = SUSTAINED: above 110% of available in 2+ weeks of the horizon, or
    work booked beyond the available hours in a PTO week (< 2 working days available;
    a percentage of one day is not meaningful, so those weeks are judged in hours). Single-week spikes are shown on the heatmap but
    are normal and get absorbed; sustained over-allocation is what needs a decision.

ILLUSTRATIVE, NOT PREDICTIVE: "forecast workload" is the work already booked on
the Timeline for coming weeks. It is exactly as good as the bookings.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.bizdays import HOLIDAYS, monday_of
from app.metrics.common import Filters, q, scope_sql

OVER_THRESHOLD = 1.10
SUSTAINED_WEEKS = 2
HOURS_PER_WEEK = 40.0

ASSUMPTIONS = [
    "Capacity = 8 hours per working day (40 h per normal week). Company holidays remove the day from both capacity and bookings; PTO reduces capacity only.",
    "Booked hours = each booking's share of a person's time x 8 h x the working days it covers.",
    "Over-allocated = more than 110% of available hours in 2 or more weeks, or work booked beyond the hours left in a PTO week. One-week spikes show on the heatmap only.",
    "Unstaffed hours = bookings with no person, or held by someone who has left.",
    "Forward weeks show booked work only. This is a plan, not a statistical forecast; it is as accurate as the bookings.",
    "Planned vs actual hours use completed work packages; packages with no actual hours reported are left out and counted.",
]


def weeks_from(as_of: date, n: int) -> list[date]:
    start = monday_of(as_of)
    return [start + timedelta(days=7 * i) for i in range(n)]


def compute(db: Session, f: Filters, n_weeks: int | None = None) -> dict:
    n_weeks = n_weeks or f.capacity_weeks
    weeks = weeks_from(f.as_of, n_weeks)
    w_start, w_end = weeks[0], weeks[-1] + timedelta(days=4)
    where, params = scope_sql(f)
    disc_clause = "AND r.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    resources = q(db, f"""
        SELECT r.id, r.name, r.discipline, r.title, r.seniority, r.is_placeholder, r.active,
               r.available_from, r.weekly_capacity_hours
        FROM timeline_resources r
        WHERE (r.active OR r.is_placeholder = FALSE) {disc_clause}
        ORDER BY r.discipline, r.seniority, r.name""", params)
    # Bookings overlapping the window. Project scope applies to the BOOKING, so a
    # portfolio filter shows how much of each person that portfolio consumes.
    bookings = q(db, f"""
        SELECT a.id, a.resource_id, a.discipline, a.milestone, a.start_date, a.end_date, a.utilization,
               a.work_item_id, tp.portfolio_project_id AS project_id, pp.name AS project_name,
               pf.name AS portfolio_name, r.active AS resource_active, r.is_placeholder
        FROM timeline_assignments a
        JOIN timeline_projects tp ON tp.id = a.timeline_project_id
        JOIN portfolio_projects pp ON pp.id = tp.portfolio_project_id
        JOIN projects pf ON pf.id = pp.portfolio_id
        LEFT JOIN timeline_resources r ON r.id = a.resource_id
        WHERE a.start_date <= :w_end AND a.end_date >= :w_start AND {where}
        {"AND a.discipline = ANY(:f_disciplines)" if f.disciplines else ""}""",
                 {**params, "w_start": w_start, "w_end": w_end})
    timeoff = q(db, """SELECT resource_id, start_date, end_date, reason FROM timeline_timeoff
                       WHERE start_date <= :w_end AND end_date >= :w_start""", {"w_start": w_start, "w_end": w_end})

    res_by_id = {r["id"]: r for r in resources}
    holidays = set(HOLIDAYS)
    for t in timeoff:
        if (t["reason"] or "").lower() == "holiday":
            d = t["start_date"]
            while d <= t["end_date"]:
                holidays.add(d)
                d += timedelta(days=1)

    def wdays(s_, e_, wk) -> int:
        lo, hi = max(s_, wk), min(e_, wk + timedelta(days=4))
        n, d = 0, lo
        while d <= hi:
            if d.weekday() < 5 and d not in holidays:
                n += 1
            d += timedelta(days=1)
        return n

    week_days = [wdays(wk, wk + timedelta(days=4), wk) for wk in weeks]
    booked = defaultdict(lambda: [0.0] * len(weeks))
    unstaffed = [0.0] * len(weeks)
    unstaffed_rows = []
    per_week_projects = defaultdict(lambda: defaultdict(set))
    for b in bookings:
        staffed = b["resource_id"] is not None and b["resource_active"] and b["resource_id"] in res_by_id
        for i, wk in enumerate(weeks):
            wd = wdays(b["start_date"], b["end_date"], wk)
            if not wd:
                continue
            h = float(b["utilization"]) * 8.0 * wd
            if staffed:
                booked[b["resource_id"]][i] += h
                per_week_projects[b["resource_id"]][i].add(b["project_id"])
            else:
                unstaffed[i] += h
        if not staffed:
            unstaffed_rows.append(b)
    off_days = defaultdict(lambda: [0] * len(weeks))
    for t in timeoff:
        if (t["reason"] or "").lower() == "holiday":
            continue
        for i, wk in enumerate(weeks):
            off_days[t["resource_id"]][i] += wdays(t["start_date"], t["end_date"], wk)
    for r in resources:
        if r["available_from"]:
            cutoff = r["available_from"] - timedelta(days=1)
            for i, wk in enumerate(weeks):
                if cutoff >= wk:
                    off_days[r["id"]][i] += wdays(wk, cutoff, wk)

    people = []
    for r in resources:
        if not r["active"]:
            continue  # left the company (their bookings count as unstaffed) or an unactivated placeholder
        cap_h = float(r["weekly_capacity_hours"] or HOURS_PER_WEEK)
        per_day = cap_h / 5.0
        bh = [round(x, 1) for x in booked[r["id"]]]
        ah = [round(per_day * max(0, week_days[i] - off_days[r["id"]][i]), 1) for i in range(len(weeks))]
        # A % of one available day is meaningless: weeks with < 2 days available are
        # "PTO weeks" and are judged on hours (booked beyond what is available).
        short = [a < 2 * per_day for a in ah]
        pct_av = [None if sh else round(100 * h / a) for h, a, sh in zip(bh, ah, short)]
        pto_conflict = [sh and h > a + 4 for h, a, sh in zip(bh, ah, short)]
        over_weeks = [i for i, (h, a, sh) in enumerate(zip(bh, ah, short)) if not sh and h > a * OVER_THRESHOLD]
        people.append({
            "id": r["id"], "name": r["name"], "discipline": r["discipline"], "title": r["title"],
            "seniority": r["seniority"], "is_placeholder": r["is_placeholder"],
            "load": [round(h / cap_h, 3) for h in bh], "availability": [round(a / cap_h, 3) for a in ah],
            "pct_of_available": pct_av, "allocated_hours": bh, "available_hours": ah,
            "over_weeks": over_weeks, "pto_conflict_weeks": [i for i, x in enumerate(pto_conflict) if x],
            "is_overallocated": len(over_weeks) >= SUSTAINED_WEEKS or any(pto_conflict),
            "peak_pct": max([p for p in pct_av if p is not None] + [0]),
            "booked_during_timeoff": any(pto_conflict),
            "projects_by_week": [sorted(per_week_projects[r["id"]][i]) for i in range(len(weeks))],
        })

    # Discipline roll-up (sum of people) for the capacity-vs-allocation chart.
    by_disc = defaultdict(lambda: {"available_hours": [0.0] * len(weeks), "allocated_hours": [0.0] * len(weeks)})
    for p in people:
        d = by_disc[p["discipline"]]
        for i in range(len(weeks)):
            d["available_hours"][i] += p["available_hours"][i]
            d["allocated_hours"][i] += p["allocated_hours"][i]
    tot_av = sum(sum(p["available_hours"]) for p in people)
    tot_al = sum(sum(p["allocated_hours"]) for p in people)

    # Projects competing for over-allocated people in their peak weeks.
    proj_names = {b["project_id"]: (b["project_name"], b["portfolio_name"]) for b in bookings}
    competing = []
    for p in people:
        if not p["is_overallocated"]:
            continue
        hot = sorted(set(p["over_weeks"]) | set(p["pto_conflict_weeks"]))
        pids = sorted({pid for i in hot for pid in p["projects_by_week"][i]})
        for pid in pids:
            weeks_hit = [weeks[i].isoformat() for i in hot if pid in p["projects_by_week"][i]]
            competing.append({"resource_id": p["id"], "resource": p["name"], "discipline": p["discipline"],
                              "project_id": pid, "project": proj_names.get(pid, ("?", ""))[0],
                              "portfolio": proj_names.get(pid, ("?", ""))[1], "weeks": weeks_hit,
                              "peak_pct": p["peak_pct"]})

    return {
        "weeks": [w.isoformat() for w in weeks],
        "people": people,
        "by_discipline": {k: {kk: [round(x, 1) for x in vv] for kk, vv in v.items()} for k, v in sorted(by_disc.items())},
        "unstaffed_hours": [round(x, 1) for x in unstaffed],
        "working_days": week_days,
        "unstaffed_bookings": [{**b, "start_date": b["start_date"].isoformat(), "end_date": b["end_date"].isoformat()}
                               for b in unstaffed_rows],
        "totals": {
            "available_hours": round(tot_av), "allocated_hours": round(tot_al),
            "utilisation_pct": round(100 * tot_al / tot_av, 1) if tot_av else None,
            "people": len(people), "overallocated_people": sum(1 for p in people if p["is_overallocated"]),
            "booked_during_timeoff": sum(1 for p in people if p["booked_during_timeoff"]),
            "unstaffed_hours": round(sum(unstaffed)),
        },
        "competing": competing,
        "project_names": {str(k): v[0] for k, v in proj_names.items()},
        "assumptions": ASSUMPTIONS,
    }


def hours_variance(db: Session, f: Filters) -> dict:
    """Planned vs actual hours on completed work packages, completed in the trend
    window. GRAIN: one work package. Packages with unknown actual hours are
    excluded from the sums and reported as a count."""
    where, params = scope_sql(f)
    disc = "AND w.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    rows = q(db, f"""
        SELECT w.discipline,
               COUNT(*) AS completed,
               COUNT(*) FILTER (WHERE w.actual_hours IS NOT NULL AND w.planned_hours IS NOT NULL) AS with_actuals,
               COUNT(*) FILTER (WHERE w.actual_hours IS NULL) AS actual_unknown,
               SUM(w.planned_hours) FILTER (WHERE w.actual_hours IS NOT NULL) AS planned_h,
               SUM(w.actual_hours) FILTER (WHERE w.actual_hours IS NOT NULL) AS actual_h
        FROM work_items w JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
        WHERE w.status = 'done' AND w.completed_date BETWEEN :t0 AND :as_of AND {where} {disc}
        GROUP BY w.discipline ORDER BY w.discipline""", {**params, "t0": f.trend_start, "as_of": f.as_of})
    for r in rows:
        r["planned_h"] = round(float(r["planned_h"] or 0), 1)
        r["actual_h"] = round(float(r["actual_h"] or 0), 1)
        r["variance_pct"] = round(100 * (r["actual_h"] - r["planned_h"]) / r["planned_h"], 1) if r["planned_h"] else None
    by_stage = q(db, f"""
        SELECT w.stage, SUM(w.planned_hours) AS planned_h, SUM(w.actual_hours) AS actual_h, COUNT(*) AS n
        FROM work_items w JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
        WHERE w.status = 'done' AND w.actual_hours IS NOT NULL AND w.completed_date BETWEEN :t0 AND :as_of
              AND {where} {disc}
        GROUP BY w.stage""", {**params, "t0": f.trend_start, "as_of": f.as_of})
    order = {"30%": 1, "60%": 2, "90%": 3, "IFP": 4, "IFC": 5}
    by_stage.sort(key=lambda r: order.get(r["stage"], 9))
    for r in by_stage:
        r["planned_h"], r["actual_h"] = round(float(r["planned_h"]), 1), round(float(r["actual_h"]), 1)
    return {"by_discipline": rows, "by_stage": by_stage}
