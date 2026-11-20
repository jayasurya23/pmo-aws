"""Project delivery and schedule health (Dashboard B) and the executive roll-up
(Dashboard A). Both read the schedule computation in metrics/schedule.py, so a
project is "behind" on exactly one rule everywhere.

GRAINS
  deliverable         one register row (project x discipline x stage)
  overdue deliverable planned_issue_date < as_of and not issued as of as_of;
                      projects on client hold are excluded (shown separately)
  blocked work        one work package with status 'blocked' (client-hold blocks excluded)
  variance            business days planned -> actual issue, issued deliverables
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.bizdays import business_days_between, monday_of
from app.metrics import actions as A
from app.metrics import schedule as S
from app.metrics.common import Filters, q, scope_sql

UPCOMING_STATUSES = ("on_track", "at_risk", "projected_late", "no_data", "no_plan")


def overdue_deliverables(db: Session, f: Filters) -> list[dict]:
    where, params = scope_sql(f)
    disc = "AND d.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    rows = q(db, f"""
        SELECT d.id, d.doc_number, d.title, d.discipline, d.stage, d.status, d.source_status_label,
               d.planned_issue_date, d.actual_issue_date, pp.id AS project_id, pp.name AS project_name,
               pf.name AS portfolio_name, c.name AS client_name, u.name AS pm_name, d.source_extracted_at,
               w.status AS monday_status, w.external_item_id
        FROM engineering_deliverables d
        JOIN portfolio_projects pp ON pp.id = d.portfolio_project_id
        JOIN projects pf ON pf.id = pp.portfolio_id JOIN clients c ON c.id = pf.client_id
        LEFT JOIN users u ON u.id = pp.pm_user_id
        LEFT JOIN work_items w ON w.portfolio_project_id = d.portfolio_project_id
             AND w.discipline = d.discipline AND w.stage = d.stage
        WHERE d.planned_issue_date < :as_of
          AND (d.actual_issue_date IS NULL OR d.actual_issue_date > :as_of)
          AND pp.lifecycle <> 'on_hold' AND {where} {disc}
        ORDER BY d.planned_issue_date""", {**params, "as_of": f.as_of})
    for r in rows:
        r["days_overdue_bd"] = business_days_between(r["planned_issue_date"], f.as_of)
        r["sources_disagree"] = r["monday_status"] == "done"
    return rows


def blocked_items(db: Session, f: Filters) -> list[dict]:
    where, params = scope_sql(f)
    disc = "AND w.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    rows = q(db, f"""
        SELECT w.id, w.name, w.discipline, w.stage, w.blocked_reason, w.blocked_since, w.expected_unblock_date,
               w.due_date, w.percent_complete, w.planned_hours, w.external_item_id, r.name AS assignee,
               pp.id AS project_id, pp.name AS project_name, pf.name AS portfolio_name, c.name AS client_name,
               m.planned_date AS milestone_planned
        FROM work_items w
        JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
        JOIN projects pf ON pf.id = pp.portfolio_id JOIN clients c ON c.id = pf.client_id
        LEFT JOIN timeline_resources r ON r.id = w.assignee_resource_id
        LEFT JOIN milestones m ON m.portfolio_project_id = w.portfolio_project_id AND m.stage = w.stage
        WHERE w.status = 'blocked' AND pp.lifecycle <> 'on_hold' AND {where} {disc}
        ORDER BY w.blocked_since NULLS LAST""", params)
    for r in rows:
        r["days_blocked_bd"] = business_days_between(r["blocked_since"], f.as_of) if r["blocked_since"] else None
        r["vendor_dependency"] = bool(r["blocked_reason"] and "vendor" in r["blocked_reason"].lower())
    return rows


def _milestone_out(m: dict) -> dict:
    keep = ("id", "project_id", "project_name", "portfolio_id", "portfolio_name", "client_name", "pm_name",
            "technology", "stage", "seq", "baseline_date", "planned_date", "actual_date", "forecast_date",
            "status", "slip_bd", "variance_bd", "days_late_bd", "revision_count", "last_revision_reason",
            "work_items", "open_items", "blocked_items", "basis")
    out = {k: m.get(k) for k in keep}
    out["status_label"] = S.STATUS_LABEL[m["status"]]
    return out


def milestone_rows(sched: dict, f: Filters, which: str) -> list[dict]:
    ms = sched["milestones"]
    if which == "late_milestones":
        sel = [m for m in ms if m["status"] == "late"]
    elif which == "projected_late_milestones":
        sel = [m for m in ms if m["status"] == "projected_late"]
    elif which == "at_risk_milestones":
        sel = [m for m in ms if m["status"] == "at_risk"]
    elif which == "upcoming_milestones":
        sel = [m for m in ms if m["actual_date"] is None and m["status"] in UPCOMING_STATUSES
               and m["planned_date"] and f.as_of <= m["planned_date"] <= f.lookahead_end]
    elif which == "ifp_milestones":
        sel = [m for m in ms if m["stage"] == "IFP" and m["planned_date"]
               and f.as_of - timedelta(days=30) <= m["planned_date"] <= f.as_of + timedelta(days=120)]
    else:
        raise KeyError(which)
    return [_milestone_out(m) for m in sorted(sel, key=lambda m: (m["planned_date"] or date.max, m["project_name"]))]


def project_rows(sched: dict, which: str) -> list[dict]:
    want = {"active_projects": None, "projects_on_track": "on_track", "projects_at_risk": "at_risk",
            "projects_behind": "behind", "projects_unknown": "unknown", "projects_on_hold": "on_hold"}[which]
    ps = sched["projects"]
    if which == "active_projects":
        sel = [p for p in ps if p["lifecycle"] == "active"]
    else:
        sel = [p for p in ps if p["health"] == want]
    keep = ("id", "name", "portfolio_id", "portfolio_name", "client_name", "pm_name", "technology", "lifecycle",
            "health", "health_label", "next_milestone", "next_planned", "next_forecast", "next_status",
            "late_milestones", "worst_slip_bd", "revisions", "size_mw", "state")
    sev = {"behind": 0, "at_risk": 1, "unknown": 2, "on_track": 3}
    return [{k: p.get(k) for k in keep}
            for p in sorted(sel, key=lambda p: (sev.get(p["health"], 9), -(p["worst_slip_bd"] or 0), p["name"]))]


def completion_trend(ms: list[dict], f: Filters) -> list[dict]:
    """Milestones achieved per month inside the trend window, on time vs late."""
    trend = defaultdict(lambda: {"on_time": 0, "late": 0})
    for m in ms:
        if m["actual_date"] and f.trend_start <= m["actual_date"] <= f.as_of:
            trend[m["actual_date"].strftime("%Y-%m")]["on_time" if m["status"] == "complete_on_time" else "late"] += 1
    return [{"month": k, **v, "on_time_pct": round(100 * v["on_time"] / (v["on_time"] + v["late"]))}
            for k, v in sorted(trend.items())]


def delivery_dashboard(db: Session, f: Filters, sched: dict) -> dict:
    ms = sched["milestones"]
    od = overdue_deliverables(db, f)
    bl = blocked_items(db, f)
    t0 = f.trend_start
    trend_rows = completion_trend(ms, f)
    # Planned vs actual (completed in window) for the scatter: one point per milestone.
    scatter = [{"project": m["project_name"], "project_id": m["project_id"], "stage": m["stage"],
                "planned": m["planned_date"].isoformat(), "actual": m["actual_date"].isoformat(),
                "variance_bd": m["variance_bd"]}
               for m in ms if m["actual_date"] and t0 <= m["actual_date"] <= f.as_of]
    # Schedule variance by discipline (issued deliverables in window) + current overdue.
    where, params = scope_sql(f)
    disc = "AND d.discipline = ANY(:f_disciplines)" if f.disciplines else ""
    issued = q(db, f"""
        SELECT d.discipline, d.planned_issue_date, d.actual_issue_date
        FROM engineering_deliverables d JOIN portfolio_projects pp ON pp.id = d.portfolio_project_id
        WHERE d.status = 'issued' AND d.actual_issue_date BETWEEN :t0 AND :as_of AND {where} {disc}""",
                {**params, "t0": t0, "as_of": f.as_of})
    var = defaultdict(list)
    for r in issued:
        var[r["discipline"]].append(business_days_between(r["planned_issue_date"], r["actual_issue_date"]))
    od_by_disc = Counter(r["discipline"] for r in od)
    variance = []
    for d in sorted(set(var) | set(od_by_disc)):
        v = sorted(var.get(d, []))
        variance.append({"discipline": d, "issued": len(v), "late_pct": round(100 * sum(1 for x in v if x > 0) / len(v)) if v else None,
                         "avg_variance_bd": round(sum(v) / len(v), 1) if v else None,
                         "p80_variance_bd": v[int(0.8 * (len(v) - 1))] if v else None, "overdue_now": od_by_disc.get(d, 0)})
    # Milestones due per week ahead, stacked by projected status.
    wk0 = monday_of(f.as_of)
    ahead = defaultdict(Counter)
    for m in ms:
        if m["actual_date"] is None and m["planned_date"] and f.as_of <= m["planned_date"] <= wk0 + timedelta(weeks=12):
            ahead[monday_of(m["planned_date"]).isoformat()][m["status"]] += 1
    ahead_rows = [{"week": k, **{s: v.get(s, 0) for s in ("on_track", "at_risk", "projected_late", "no_data")}}
                  for k, v in sorted(ahead.items())]
    slip_by_project = sorted([{"project": p["name"], "project_id": p["id"], "health": p["health"],
                               "worst_slip_bd": p["worst_slip_bd"], "late_milestones": p["late_milestones"]}
                              for p in sched["projects"] if p["lifecycle"] == "active" and (p["worst_slip_bd"] or p["late_milestones"])],
                             key=lambda r: -(r["worst_slip_bd"] or 0))[:15]
    blocked_reasons = Counter((r["blocked_reason"] or "(none given)") for r in bl).most_common(10)
    ifp = milestone_rows(sched, f, "ifp_milestones")
    return {
        "kpis": {
            "late_milestones": sum(1 for m in ms if m["status"] == "late"),
            "projected_late_milestones": sum(1 for m in ms if m["status"] == "projected_late"),
            "at_risk_milestones": sum(1 for m in ms if m["status"] == "at_risk"),
            "upcoming_milestones": len(milestone_rows(sched, f, "upcoming_milestones")),
            "overdue_deliverables": len(od), "blocked_work_items": len(bl),
            "overdue_deliverables_conflict": sum(1 for r in od if r["sources_disagree"]),
            "on_time_pct_window": round(100 * sum(1 for m in ms if m["status"] == "complete_on_time" and m["actual_date"] and m["actual_date"] >= t0)
                                        / max(1, sum(1 for m in ms if m["actual_date"] and m["actual_date"] >= t0 and m["actual_date"] <= f.as_of))),
        },
        "at_risk_projects": [p for p in project_rows(sched, "active_projects") if p["health"] in ("behind", "at_risk")][:25],
        "completion_trend": trend_rows, "scatter": scatter, "variance_by_discipline": variance,
        "milestones_ahead": ahead_rows, "slip_by_project": slip_by_project,
        "blocked": bl[:30], "blocked_reasons": [{"reason": r, "n": n} for r, n in blocked_reasons],
        "overdue_deliverables": od[:30], "ifp": ifp,
        "rule": S.__doc__,
    }


def executive_dashboard(db: Session, f: Filters, sched: dict) -> dict:
    ps, ms = sched["projects"], sched["milestones"]
    act = A.dashboard(db, f)
    od = overdue_deliverables(db, f)
    health = Counter(p["health"] for p in ps)
    active = [p for p in ps if p["lifecycle"] == "active"]
    by_disc = defaultdict(Counter)
    where, params = scope_sql(f)
    for r in q(db, f"""SELECT pd.portfolio_project_id AS pid, pd.discipline FROM project_disciplines pd
                       JOIN portfolio_projects pp ON pp.id = pd.portfolio_project_id WHERE {where}""", params):
        by_disc[r["discipline"]][r["pid"]] += 1
    hp = {p["id"]: p["health"] for p in active}
    disc_rows = []
    for d in ("Electrical", "Civil", "Structural"):
        if f.disciplines and d not in f.disciplines:
            continue
        pids = [pid for pid in by_disc[d] if pid in hp]
        c = Counter(hp[pid] for pid in pids)
        disc_rows.append({"discipline": d, "active": len(pids), "on_track": c["on_track"], "at_risk": c["at_risk"],
                          "behind": c["behind"], "unknown": c["unknown"]})
    port = defaultdict(lambda: {"active": 0, "behind": 0, "at_risk": 0, "late_milestones": 0, "projected_late": 0})
    names = {}
    for p in active:
        r = port[p["portfolio_id"]]
        names[p["portfolio_id"]] = (p["portfolio_name"], p["client_name"])
        r["active"] += 1
        r["behind"] += p["health"] == "behind"
        r["at_risk"] += p["health"] == "at_risk"
    for m in ms:
        if m["portfolio_id"] in port:
            port[m["portfolio_id"]]["late_milestones"] += m["status"] == "late"
            port[m["portfolio_id"]]["projected_late"] += m["status"] == "projected_late"
    od_actions = {r["portfolio_id"]: r for r in act["by_portfolio"]}
    port_rows = [{"portfolio_id": k, "portfolio": names[k][0], "client": names[k][1], **v,
                  "overdue_actions": od_actions.get(k, {}).get("overdue", 0),
                  "risk_score": v["behind"] * 3 + v["at_risk"] * 2 + v["late_milestones"] + v["projected_late"]}
                 for k, v in port.items()]
    port_rows.sort(key=lambda r: (-r["risk_score"], r["portfolio"]))
    # Weekly late-milestone trend, restated on current plans (labelled as such).
    wk0 = monday_of(f.trend_start)
    late_trend = []
    wk = wk0
    while wk <= f.as_of:
        end = min(wk + timedelta(days=6), f.as_of)
        n = sum(1 for m in ms if m["planned_date"] and m["planned_date"] < end
                and (m["actual_date"] is None or m["actual_date"] > end) and m["status"] != "on_hold")
        done = sum(1 for m in ms if m["actual_date"] and wk <= m["actual_date"] <= end)
        late_trend.append({"week_start": wk.isoformat(), "late_open": n, "achieved": done})
        wk += timedelta(days=7)
    upcoming = milestone_rows(sched, f, "upcoming_milestones")
    return {
        "kpis": {
            "active_projects": len(active),
            "projects_on_track": health["on_track"], "projects_at_risk": health["at_risk"],
            "projects_behind": health["behind"], "projects_unknown": health["unknown"],
            "projects_on_hold": health["on_hold"], "projects_complete": health["complete"],
            "projects_upcoming": health["upcoming"],
            "late_milestones": sum(1 for m in ms if m["status"] == "late"),
            "upcoming_milestones": len(upcoming),
            "projected_late_milestones": sum(1 for m in ms if m["status"] == "projected_late"),
            "open_actions": act["kpis"]["open_actions"], "overdue_actions": act["kpis"]["overdue_actions"],
            "overdue_deliverables": len(od),
        },
        "health": [{"health": h, "label": S.HEALTH_LABEL[h], "count": health.get(h, 0)}
                   for h in ("on_track", "at_risk", "behind", "unknown", "on_hold", "upcoming", "complete")],
        "by_discipline": disc_rows, "portfolio_risk": port_rows[:15], "upcoming": upcoming[:40],
        "action_trend": act["burndown"], "late_trend": late_trend,
        "milestone_trend": completion_trend(ms, f),
    }
