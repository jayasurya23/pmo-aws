"""Single-project drilldown: everything behind a project's health in one call."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.metrics import schedule as S
from app.metrics.common import Filters, q


def project_detail(db: Session, project_id: int, f: Filters) -> dict | None:
    base = q(db, "SELECT portfolio_id FROM portfolio_projects WHERE id = :id", {"id": project_id})
    if not base:
        return None
    pf = Filters(as_of=f.as_of, portfolio_ids=[base[0]["portfolio_id"]])
    sched = S.compute(db, pf)
    proj = next(p for p in sched["projects"] if p["id"] == project_id)
    ms = [m for m in sched["milestones"] if m["project_id"] == project_id]
    for m in ms:
        m["status_label"] = S.STATUS_LABEL[m["status"]]
    p = {"id": project_id}
    work = q(db, """
        SELECT w.id, w.name, w.discipline, w.stage, w.status, w.source_status_label, w.priority, w.planned_start,
               w.due_date, w.actual_start, w.completed_date, w.planned_hours, w.actual_hours, w.percent_complete,
               w.blocked_reason, w.blocked_since, w.expected_unblock_date, w.external_item_id, w.source_updated_at,
               r.name AS assignee, dep.name AS depends_on
        FROM work_items w LEFT JOIN timeline_resources r ON r.id = w.assignee_resource_id
        LEFT JOIN work_items dep ON dep.id = w.depends_on_work_item_id
        WHERE w.portfolio_project_id = :id
        ORDER BY CASE w.stage WHEN '30%' THEN 1 WHEN '60%' THEN 2 WHEN '90%' THEN 3 WHEN 'IFP' THEN 4 ELSE 5 END,
                 w.discipline""", {"id": project_id})
    events = q(db, """
        SELECT e.work_item_id, e.at, e.field, e.old_value, e.new_value, e.source, e.note
        FROM work_item_events e JOIN work_items w ON w.id = e.work_item_id
        WHERE w.portfolio_project_id = :id ORDER BY e.at""", {"id": project_id})
    by_item: dict[int, list] = {}
    for e in events:
        by_item.setdefault(e["work_item_id"], []).append(e)
    for w in work:
        w["history"] = by_item.get(w["id"], [])
    deliverables = q(db, """
        SELECT id, doc_number, title, discipline, stage, status, source_status_label, planned_issue_date,
               actual_issue_date, revision, register_row_id
        FROM engineering_deliverables WHERE portfolio_project_id = :id
        ORDER BY planned_issue_date, discipline""", {"id": project_id})
    actions = q(db, """
        SELECT ai.id, ai.text, ai.status, ai.due_date, ai.owner, ai.owner_type, u.name AS owner_name,
               m.meeting_date, m.title AS meeting_title
        FROM action_items ai JOIN meetings m ON m.id = ai.originating_meeting_id
        LEFT JOIN users u ON u.id = ai.resolved_owner_user_id
        WHERE ai.portfolio_project_id = :id ORDER BY m.meeting_date DESC, ai.id""", {"id": project_id})
    bookings = q(db, """
        SELECT a.id, a.discipline, a.milestone, a.start_date, a.end_date, a.utilization, a.origin,
               r.name AS resource, r.active AS resource_active, r.seniority
        FROM timeline_assignments a JOIN timeline_projects tp ON tp.id = a.timeline_project_id
        LEFT JOIN timeline_resources r ON r.id = a.resource_id
        WHERE tp.portfolio_project_id = :id ORDER BY a.start_date""", {"id": project_id})
    cos = q(db, """SELECT id, co_number, title, status, request_date, approved_at, total_amount, schedule_impact_days
                   FROM change_orders WHERE portfolio_project_id = :id ORDER BY request_date""", {"id": project_id})
    exc = q(db, """SELECT e.id, e.rule_code, e.severity, e.source_key, e.detail, e.external_id
                   FROM dq_exceptions e WHERE e.portfolio_project_id = :id AND e.status = 'open'
                   ORDER BY e.severity, e.id""", {"id": project_id})
    keep = ("id", "name", "technology", "lifecycle", "state", "size_mw", "kickoff_date", "portfolio_id",
            "portfolio_name", "project_number", "client_name", "pm_name", "health", "health_label",
            "next_milestone", "next_planned", "next_forecast", "next_status", "late_milestones", "worst_slip_bd", "revisions")
    p.update({k: proj.get(k) for k in keep})
    return {"project": p, "milestones": ms, "work_items": work, "deliverables": deliverables, "actions": actions,
            "bookings": bookings, "change_orders": cos, "exceptions": exc, "rule": S.__doc__}
