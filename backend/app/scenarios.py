"""Two traceable decision scenarios (synthetic demonstrations, not historical events).

Each `apply` writes the decision a manager could take into the same tables the
pipeline loads, recording every changed value in scenario_log so `reset`
restores the exact previous state. Dashboards recompute from those records; no
number is hard-coded.

S1  Engineering capacity bottleneck. Four solar projects all look
    "on track" on the schedule view, but every one of their Dec-Jan design packages
    sits on the same three senior electrical engineers (130-150% booked, one of them
    with PTO mid-December, holidays on top). Decision: the Electrical lead takes one
    IFC package, a contract electrical engineer (two-week onboarding) takes half of one
    90% package, and one IFP is re-sequenced by five business days with the client.

S2  Late deliverable before the next milestone. Cedar Hollow's Structural 90% package
    has been blocked since 2 Nov waiting on the client's geotechnical report; the 90%
    milestone (13 Nov) is already late and the projection pushes IFC (18 Dec) out.
    Decision: proceed on an assumed pile design with a hold point, add a second
    structural engineer, assign the orphaned action and escalate the client action.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import models as M
from app.bizdays import add_business_days
from app.metrics import capacity as C
from app.metrics import schedule as S
from app.metrics.common import Filters

UTC = timezone.utc
S1_PROJECTS = ["Thornapple Solar", "Silverleaf Solar", "Marten Ridge Solar", "Bluestem Solar"]
S1_ENGINEERS = ["Priya Raman", "Marcus Ojo", "Elena Ruiz"]
S2_PROJECT = "Cedar Hollow Solar"

INFO = {
    "s1": {"title": "Four projects look on track, but three engineers are overloaded",
           "dashboard": "/capacity", "projects": S1_PROJECTS,
           "steps": [
               "Overview: all four solar projects show On track, with no late or projected-late milestone.",
               "Team capacity, Electrical: the team as a whole has room, but its three senior electrical engineers (Priya Raman, Marcus Ojo and Elena Ruiz) are booked above 110% of their available hours for weeks at a time, Marcus through his PTO week.",
               "Projects competing for the same people (under More detail): all four projects' remaining packages sit on these three people.",
               "Decision: the Electrical lead covers Bluestem IFC; a contract electrical engineer (from 7 Dec) takes half of the Silverleaf and Marten Ridge 90% packages; Thornapple IFP moves 5 business days, agreed with the client.",
               "Measure: the seniors' peak load, their weeks over 110%, and how many milestones stay on track.",
           ]},
    "s2": {"title": "One blocked package puts Cedar Hollow's next milestone at risk",
           "dashboard": "/delivery", "projects": [S2_PROJECT],
           "steps": [
               "Schedule: Cedar Hollow's 90% milestone is late (planned 13 Nov) and IFC (18 Dec) is projected late.",
               "The project page: Structural 90% has been blocked since 2 Nov, awaiting the client's geotechnical report, and its deliverable is overdue.",
               "Action items: the client's geotech action is overdue, and 'Confirm pile design approach if geotech delayed' has no owner.",
               "Decision: proceed on an assumed pile design (checked when the report arrives), add a second structural engineer for 90% and IFC, give the orphaned action an owner, and escalate the client's action.",
               "Measure: IFC's projected slip, blocked packages and actions with no owner; then the 90% issue date once it is issued.",
           ]},
}


def _log_change(changes, table, row_id, column, old):
    changes.append({"op": "update", "table": table, "id": row_id, "column": column,
                    "old": old.isoformat() if hasattr(old, "isoformat") else old})


def _set(obj, column, value, changes, table):
    old = getattr(obj, column)
    if old != value:
        _log_change(changes, table, obj.id, column, old)
        setattr(obj, column, value)


def _applied(db, key) -> M.ScenarioLog | None:
    last = db.scalars(select(M.ScenarioLog).where(M.ScenarioLog.scenario_key == key)
                      .order_by(M.ScenarioLog.id.desc())).first()
    return last if last and last.action == "apply" else None


def _wi(db, project, discipline, stage) -> M.WorkItem:
    return db.scalars(select(M.WorkItem).join(M.PortfolioProject).where(
        M.PortfolioProject.name == project, M.WorkItem.discipline == discipline, M.WorkItem.stage == stage)).one()


def _booking(db, wi_id) -> M.TimelineAssignment:
    return db.scalars(select(M.TimelineAssignment).where(M.TimelineAssignment.work_item_id == wi_id)
                      .order_by(M.TimelineAssignment.id)).first()


def apply(db: Session, key: str, as_of) -> dict:
    if _applied(db, key):
        return {"status": "already_applied"}
    before = json.loads(json.dumps(metrics(db, key, as_of), default=str))
    changes: list[dict] = []
    now = datetime(as_of.year, as_of.month, as_of.day, 15, 0, tzinfo=UTC)
    if key == "s1":
        lead = db.scalars(select(M.TimelineResource).where(M.TimelineResource.discipline == "Electrical",
                                                           M.TimelineResource.seniority == "lead")).first()
        contractor = db.scalars(select(M.TimelineResource).where(M.TimelineResource.name == "Contract Electrical Engineer")).one()
        start = add_business_days(as_of, 11)  # two-week onboarding
        _set(contractor, "active", True, changes, "timeline_resources")
        _set(contractor, "available_from", start, changes, "timeline_resources")
        # (a) lead covers Bluestem IFC
        wi = _wi(db, S1_PROJECTS[3], "Electrical", "IFC")
        b = _booking(db, wi.id)
        _set(b, "resource_id", lead.id, changes, "timeline_assignments")
        _set(wi, "assignee_resource_id", lead.id, changes, "work_items")
        # (b) contractor takes half of the two heaviest 90% packages (Silverleaf: Marcus, Marten Ridge: Elena)
        for proj in (S1_PROJECTS[1], S1_PROJECTS[2]):
            wi = _wi(db, proj, "Electrical", "90%")
            b = _booking(db, wi.id)
            half = round(b.utilization / 2, 2)
            _set(b, "utilization", half, changes, "timeline_assignments")
            nb = M.TimelineAssignment(timeline_project_id=b.timeline_project_id, resource_id=contractor.id,
                                      discipline="Electrical", milestone="90%", start_date=max(start, b.start_date),
                                      end_date=b.end_date, utilization=half, origin="scenario", work_item_id=wi.id)
            db.add(nb)
            db.flush()
            changes.append({"op": "insert", "table": "timeline_assignments", "id": nb.id})
        # (c) Thornapple IFP re-sequenced +5 business days (client agreed)
        ms = db.scalars(select(M.Milestone).join(M.PortfolioProject).where(
            M.PortfolioProject.name == S1_PROJECTS[0], M.Milestone.stage == "IFP")).one()
        _set(ms, "planned_date", add_business_days(ms.planned_date, 5), changes, "milestones")
        _set(ms, "revision_count", ms.revision_count + 1, changes, "milestones")
        _set(ms, "last_revision_reason", "Re-sequenced +5 business days with client to relieve senior electrical capacity (S1 decision)",
             changes, "milestones")
        wi = _wi(db, S1_PROJECTS[0], "Electrical", "IFP")
        b = _booking(db, wi.id)
        _set(b, "start_date", add_business_days(b.start_date, 5), changes, "timeline_assignments")
        _set(b, "end_date", add_business_days(b.end_date, 5), changes, "timeline_assignments")
        _set(wi, "due_date", add_business_days(wi.due_date, 5), changes, "work_items")
        d = db.scalars(select(M.EngineeringDeliverable).where(
            M.EngineeringDeliverable.portfolio_project_id == ms.portfolio_project_id,
            M.EngineeringDeliverable.stage == "IFP", M.EngineeringDeliverable.discipline == "Electrical")).one()
        _set(d, "planned_issue_date", add_business_days(d.planned_issue_date, 5), changes, "engineering_deliverables")
    elif key == "s2":
        lead = db.scalars(select(M.TimelineResource).where(M.TimelineResource.discipline == "Structural",
                                                           M.TimelineResource.seniority == "lead")).first()
        # second structural engineer: the least-booked senior/mid in the next three weeks
        cap = C.compute(db, Filters(as_of=as_of, disciplines=["Structural"]), n_weeks=4)
        helper = min((p for p in cap["people"] if p["seniority"] in ("senior", "mid") and p["id"] != lead.id),
                     key=lambda p: (sum(p["load"][:3]), p["id"]))
        w90 = _wi(db, S2_PROJECT, "Structural", "90%")
        _set(w90, "status", "in_progress", changes, "work_items")
        _set(w90, "source_status_label", "WIP", changes, "work_items")
        _set(w90, "blocked_reason", None, changes, "work_items")
        _set(w90, "blocked_since", None, changes, "work_items")
        ev = M.WorkItemEvent(work_item_id=w90.id, at=now, field="status", old_value="Blocked", new_value="WIP",
                             source="pm_decision", note="Proceeding on assumed pile design; hold point on receipt of geotech report")
        db.add(ev)
        wifc = _wi(db, S2_PROJECT, "Structural", "IFC")
        for wi, s, e in ((w90, add_business_days(as_of, 1), add_business_days(as_of, 10)),
                         (wifc, add_business_days(as_of, 6), add_business_days(as_of, 16))):
            tp = db.scalars(select(M.TimelineProject).where(M.TimelineProject.portfolio_project_id == wi.portfolio_project_id)).one()
            nb = M.TimelineAssignment(timeline_project_id=tp.id, resource_id=helper["id"], discipline="Structural",
                                      milestone=wi.stage, start_date=s, end_date=e, utilization=0.6, origin="scenario",
                                      work_item_id=wi.id)
            db.add(nb)
            db.flush()
            changes.append({"op": "insert", "table": "timeline_assignments", "id": nb.id})
        db.flush()
        changes.append({"op": "insert", "table": "work_item_events", "id": ev.id})
        acts = db.scalars(select(M.ActionItem).join(M.PortfolioProject, M.ActionItem.portfolio_project_id == M.PortfolioProject.id)
                          .where(M.PortfolioProject.name == S2_PROJECT, M.ActionItem.status.in_(("open", "pending")))).all()
        for a in acts:
            if a.text.startswith("Confirm structural pile design"):
                _set(a, "owner", lead.name, changes, "action_items")
                _set(a, "owner_user_id", lead.user_id, changes, "action_items")
                _set(a, "resolved_owner_user_id", lead.user_id, changes, "action_items")
                _set(a, "owner_type", "internal", changes, "action_items")
                _set(a, "owner_basis", "owner_user_id", changes, "action_items")
                _set(a, "due_date", add_business_days(as_of, 2), changes, "action_items")
            elif a.text.startswith("Provide geotechnical report"):
                _set(a, "due_date", add_business_days(as_of, 3), changes, "action_items")
                _set(a, "text", a.text + " [escalated to client PM]", changes, "action_items")
    else:
        raise KeyError(key)
    db.flush()
    db.add(M.ScenarioLog(scenario_key=key, action="apply", changes={"changes": changes, "before": before}))
    db.commit()
    return {"status": "applied", "changes": len(changes)}


_TABLES = {"timeline_resources": M.TimelineResource, "timeline_assignments": M.TimelineAssignment,
           "work_items": M.WorkItem, "milestones": M.Milestone, "engineering_deliverables": M.EngineeringDeliverable,
           "action_items": M.ActionItem, "work_item_events": M.WorkItemEvent}
_DATE_COLS = {"available_from", "start_date", "end_date", "planned_date", "due_date", "planned_issue_date", "blocked_since"}


def reset(db: Session, key: str) -> dict:
    log = _applied(db, key)
    if not log:
        return {"status": "not_applied"}
    from datetime import date as _date
    for ch in reversed(log.changes["changes"]):
        model = _TABLES[ch["table"]]
        if ch["op"] == "insert":
            obj = db.get(model, ch["id"])
            if obj is not None:
                db.delete(obj)
        else:
            obj = db.get(model, ch["id"])
            val = ch["old"]
            if ch["column"] in _DATE_COLS and isinstance(val, str):
                val = _date.fromisoformat(val)
            setattr(obj, ch["column"], val)
    db.add(M.ScenarioLog(scenario_key=key, action="reset", changes={"reverted": len(log.changes["changes"])}))
    db.commit()
    return {"status": "reset"}


def metrics(db: Session, key: str, as_of) -> dict:
    f = Filters(as_of=as_of)
    if key == "s1":
        cap = C.compute(db, Filters(as_of=as_of, disciplines=["Electrical"]), n_weeks=10)
        seniors = [p for p in cap["people"] if p["name"] in S1_ENGINEERS]
        sched = S.compute(db, f)
        proj = [p for p in sched["projects"] if p["name"] in S1_PROJECTS]
        ms = [m for m in sched["milestones"] if m["project_name"] in S1_PROJECTS and m["actual_date"] is None]
        return {
            "seniors": [{"name": p["name"], "peak_pct": p["peak_pct"], "over_weeks": len(p["over_weeks"]) + len(p["pto_conflict_weeks"]),
                         "pct_of_available": p["pct_of_available"]} for p in seniors],
            "weeks": cap["weeks"],
            "senior_peak_pct": max([p["peak_pct"] for p in seniors] + [0]),
            "senior_over_person_weeks": sum(len(p["over_weeks"]) + len(p["pto_conflict_weeks"]) for p in seniors),
            "team_over_person_weeks": sum(len(p["over_weeks"]) + len(p["pto_conflict_weeks"]) for p in cap["people"]),
            "projects": [{"name": p["name"], "health": p["health_label"], "next": p["next_milestone"],
                          "planned": p["next_planned"], "forecast": p["next_forecast"]} for p in proj],
            "open_milestones": [{"project": m["project_name"], "stage": m["stage"], "planned": m["planned_date"],
                                 "status": S.STATUS_LABEL[m["status"]], "revisions": m["revision_count"]} for m in ms],
        }
    if key == "s2":
        sched = S.compute(db, f)
        ms = [m for m in sched["milestones"] if m["project_name"] == S2_PROJECT]
        p = next(p for p in sched["projects"] if p["name"] == S2_PROJECT)
        blocked = db.execute(text("""SELECT COUNT(*) FROM work_items w JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
                                     WHERE pp.name = :n AND w.status = 'blocked'"""), {"n": S2_PROJECT}).scalar()
        unassigned = db.execute(text("""SELECT COUNT(*) FROM action_items a JOIN portfolio_projects pp ON pp.id = a.portfolio_project_id
                                        WHERE pp.name = :n AND a.status IN ('open','pending') AND a.owner_type IN ('unassigned','unresolved')"""),
                                {"n": S2_PROJECT}).scalar()
        ifc = next(m for m in ms if m["stage"] == "IFC")
        m90 = next(m for m in ms if m["stage"] == "90%")
        return {"project_id": p["id"], "health": p["health_label"],
                "milestones": [{"stage": m["stage"], "planned": m["planned_date"], "actual": m["actual_date"],
                                "forecast": m["forecast_date"], "status": S.STATUS_LABEL[m["status"]],
                                "slip_bd": m["slip_bd"], "basis": m["basis"]} for m in ms],
                "ifc_status": S.STATUS_LABEL[ifc["status"]], "ifc_slip_bd": ifc["slip_bd"],
                "ifc_forecast": ifc["forecast_date"], "m90_forecast": m90["forecast_date"],
                "blocked_packages": blocked, "unassigned_actions": unassigned}
    raise KeyError(key)


def summary(db: Session, key: str, as_of) -> dict:
    log = _applied(db, key)
    return {"key": key, **INFO[key], "applied": bool(log),
            "before": log.changes.get("before") if log else None, "current": metrics(db, key, as_of)}
