"""Data quality and integration health. GRAINS: one sync run; one exception;
one staged source record.

Freshness = reporting time - extracted_at of the source's LAST SUCCESSFUL run,
compared with that source's SLA. A failed run never refreshes freshness: the
dashboards keep showing the last good data, labelled with its age.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.metrics.common import Filters, pct, q

UTC = timezone.utc

# Which dashboard numbers each rule can distort — shown next to every exception.
AFFECTS = {
    "SCHEMA_DRIFT": ["Overdue deliverables", "Milestone actual dates"],
    "MISSING_PROJECT_REF": ["Planned vs actual hours", "Milestone projections"],
    "DUPLICATE_EXTERNAL_RECORD": ["Workload hours (prevented double count)"],
    "UNMAPPED_STATUS": ["Blocked / in-progress counts", "Projections"],
    "MISSING_DUE_DATE": ["Overdue work (excluded, counted)"],
    "DATE_ORDER_INVALID": ["Cycle time"],
    "ACTUAL_HOURS_MISSING": ["Planned vs actual hours (excluded, counted)"],
    "REGISTER_UNMATCHED_PROJECT": ["None (rejected before load)"],
    "REGISTER_DUPLICATE": ["Deliverable counts (prevented double count)"],
    "STATUS_CONFLICT": ["Overdue deliverables", "Milestone status"],
    "MILESTONE_MISSING_DELIVERABLE": ["Milestone actual dates"],
    "JOB_NUMBER_CONFLICT": ["Project identification"],
    "MONDAY_AMBIGUOUS_NAME": ["Job numbers"], "MONDAY_ORPHAN": ["Job numbers"],
    "MONDAY_UNNUMBERED": ["Job numbers"], "MONDAY_SUB_ONLY_MATCH": ["Job numbers"],
    "PROJECT_MISSING_PM": ["Per-PM views"],
    "INACTIVE_RESOURCE_BOOKING": ["Unstaffed demand", "Capacity"],
    "ACTION_OWNER_UNRESOLVED": ["Unassigned actions", "Actions by owner"],
    "CALENDAR_UNMATCHED": ["Minutes capture rate"],
    "INVALID_JOB_NUMBER": ["Proposal-to-project linkage"],
    "PROPOSAL_MISSING_SUBMITTED": ["Proposal turnaround (excluded, counted)"],
    "CO_APPROVED_NO_TIMESTAMP": ["CO approval cycle time (excluded, counted)"],
    "DATE_UNPARSEABLE": ["Deliverable dates"],
}


def report_time(f: Filters) -> datetime:
    """The pipeline's reference 'now': 06:30 ET on the reporting date."""
    return datetime(f.as_of.year, f.as_of.month, f.as_of.day, 11, 30, tzinfo=UTC)


def freshness(db: Session, f: Filters) -> list[dict]:
    now = report_time(f)
    rows = q(db, """
        SELECT s.key, s.name, s.kind, s.system_of_record_for, s.production_equivalent, s.refresh_cadence,
               s.freshness_sla_hours,
               (SELECT MAX(r.extracted_at) FROM sync_runs r WHERE r.source_key = s.key AND r.status = 'success'
                  AND r.started_at <= :now) AS last_success_extract,
               (SELECT MAX(r.finished_at) FROM sync_runs r WHERE r.source_key = s.key AND r.status = 'success'
                  AND r.started_at <= :now) AS last_success_run,
               (SELECT r.status FROM sync_runs r WHERE r.source_key = s.key AND r.started_at <= :now
                  ORDER BY r.started_at DESC LIMIT 1) AS last_status,
               (SELECT r.message FROM sync_runs r WHERE r.source_key = s.key AND r.started_at <= :now
                  ORDER BY r.started_at DESC LIMIT 1) AS last_message,
               (SELECT COUNT(*) FROM sync_runs r WHERE r.source_key = s.key AND r.started_at > :now - interval '14 days'
                  AND r.started_at <= :now) AS runs_14d,
               (SELECT COUNT(*) FROM sync_runs r WHERE r.source_key = s.key AND r.started_at > :now - interval '14 days'
                  AND r.started_at <= :now AND r.status = 'success') AS success_14d,
               (SELECT COUNT(*) FROM dq_exceptions e WHERE e.source_key = s.key AND e.status = 'open') AS open_exceptions
        FROM source_systems s ORDER BY s.key""", {"now": now})
    for r in rows:
        ext = r["last_success_extract"]
        r["age_hours"] = round((now - ext).total_seconds() / 3600, 1) if ext else None
        sla = r["freshness_sla_hours"]
        r["freshness"] = ("unknown" if ext is None else "fresh" if r["age_hours"] <= sla
                          else "stale" if r["age_hours"] <= 2 * sla else "critical")
        r["success_rate_pct"] = pct(r["success_14d"], r["runs_14d"])
    return rows


def dashboard(db: Session, f: Filters) -> dict:
    fresh = freshness(db, f)
    by_rule = q(db, """
        SELECT r.code, r.name, r.severity, r.action, r.description, r.why_it_matters,
               COUNT(e.id) FILTER (WHERE e.status = 'open') AS open,
               COUNT(DISTINCT e.source_key) AS sources
        FROM dq_rules r LEFT JOIN dq_exceptions e ON e.rule_code = r.code
        GROUP BY r.code ORDER BY open DESC, r.code""")
    for r in by_rule:
        r["affects"] = AFFECTS.get(r["code"], [])
    by_source = q(db, """
        SELECT e.source_key, e.severity, COUNT(*) AS n FROM dq_exceptions e WHERE e.status = 'open'
        GROUP BY 1, 2 ORDER BY 1""")
    # Latest real (non-simulated) run per source: staged -> loaded/flagged/rejected.
    funnel = q(db, """
        SELECT DISTINCT ON (r.source_key) r.source_key, r.id AS run_id, r.status, r.started_at, r.extracted_at,
               r.rows_extracted, r.rows_loaded, r.rows_rejected, r.rows_flagged, r.message, r.extract_file
        FROM sync_runs r WHERE NOT r.is_simulated_history
        ORDER BY r.source_key, r.started_at DESC""")
    history = q(db, """
        SELECT r.source_key, (r.started_at AT TIME ZONE 'America/New_York')::date AS day,
               COUNT(*) AS runs, COUNT(*) FILTER (WHERE r.status = 'success') AS ok,
               COUNT(*) FILTER (WHERE r.status = 'failed') AS failed,
               BOOL_OR(r.is_simulated_history) AS simulated
        FROM sync_runs r WHERE r.started_at > :now - interval '14 days' AND r.started_at <= :now
        GROUP BY 1, 2 ORDER BY 1, 2""", {"now": report_time(f)})
    matches = q(db, """SELECT match_method, COUNT(*) AS n FROM calendar_events GROUP BY 1 ORDER BY 2 DESC""")
    idmap = q(db, """SELECT source_key, match_method, COUNT(*) AS n FROM id_map GROUP BY 1, 2 ORDER BY 1, 2""")
    staged = q(db, """SELECT source_key, load_status, COUNT(*) AS n FROM raw_records GROUP BY 1, 2 ORDER BY 1, 2""")
    totals = q(db, """
        SELECT COUNT(*) FILTER (WHERE status = 'open') AS open,
               COUNT(*) FILTER (WHERE status = 'open' AND severity = 'error') AS errors,
               COUNT(*) FILTER (WHERE status = 'open' AND severity = 'warning') AS warnings,
               COUNT(*) FILTER (WHERE status = 'open' AND severity = 'info') AS info
        FROM dq_exceptions""")[0]
    rec = q(db, """SELECT COUNT(*) AS staged,
                          COUNT(*) FILTER (WHERE load_status IN ('loaded','flagged')) AS loaded,
                          COUNT(*) FILTER (WHERE load_status IN ('rejected','duplicate')) AS rejected
                   FROM raw_records""")[0]
    return {
        "report_time": report_time(f).isoformat(),
        "kpis": {**totals, **rec,
                 "stale_sources": sum(1 for s in fresh if s["freshness"] in ("stale", "critical")),
                 "failed_last_run": sum(1 for s in fresh if s["last_status"] == "failed"),
                 "load_rate_pct": pct(rec["loaded"], rec["staged"])},
        "freshness": fresh, "by_rule": by_rule, "by_source": by_source, "funnel": funnel,
        "history": history, "calendar_matches": matches, "id_map": idmap, "staged": staged,
    }


def exceptions(db: Session, rule: str | None, source: str | None, severity: str | None, search: str | None,
               page: int, page_size: int) -> dict:
    where, params = ["e.status = 'open'"], {}
    if rule:
        where.append("e.rule_code = :rule"); params["rule"] = rule
    if source:
        where.append("e.source_key = :source"); params["source"] = source
    if severity:
        where.append("e.severity = :severity"); params["severity"] = severity
    if search:
        where.append("(e.detail ILIKE :s OR e.external_id ILIKE :s)"); params["s"] = f"%{search}%"
    w = " AND ".join(where)
    total = q(db, f"SELECT COUNT(*) AS n FROM dq_exceptions e WHERE {w}", params)[0]["n"]
    rows = q(db, f"""
        SELECT e.id, e.rule_code, r.name AS rule_name, e.severity, e.source_key, e.external_id, e.entity_type,
               e.entity_id, e.portfolio_project_id AS project_id, pp.name AS project_name, e.detail, e.detected_at,
               e.raw_record_id, rr.load_status
        FROM dq_exceptions e JOIN dq_rules r ON r.code = e.rule_code
        LEFT JOIN portfolio_projects pp ON pp.id = e.portfolio_project_id
        LEFT JOIN raw_records rr ON rr.id = e.raw_record_id
        WHERE {w} ORDER BY CASE e.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, e.id
        LIMIT :lim OFFSET :off""", {**params, "lim": page_size, "off": (page - 1) * page_size})
    return {"total": total, "page": page, "page_size": page_size, "rows": rows}
