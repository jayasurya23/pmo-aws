"""Meeting and action-item accountability. GRAIN: one action item.

Definitions are production PMO 360's (api/dashboard.py::get_my_work), evaluated
point-in-time at the reporting date:
  open        status open/pending at as_of (created on/before as_of, and not
              closed on/before as_of). Close date = COALESCE(last_status_change,
              updated_at, created_at) — the production burndown rule.
  overdue     open AND due_date STRICTLY before as_of (due today is due, not late)
  due_soon    open AND as_of <= due_date <= as_of + 6 (never overlaps overdue)
  no_due_date open AND due_date IS NULL — not overdue, reported separately
  unassigned  open AND owner resolves to nobody (blank/TBD or unrecognised text)
  external    open AND owned by a client/vendor contact (demo refinement: the
              production Lead dashboard folds these into "no clear owner")
Each action is counted once however many names its owner field lists.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.bizdays import add_business_days, monday_of
from app.metrics.common import Filters, pct, q, scope_sql

ET = "America/New_York"


def _base(f: Filters) -> tuple[str, dict]:
    pscope, params = scope_sql(f, "pp")
    pscope_pf, _ = scope_sql(f, "pp2")
    sql = f"""
    WITH a AS (
        SELECT ai.id, ai.text, ai.status, ai.due_date, ai.owner, ai.owner_type, ai.owner_basis,
               ai.resolved_owner_user_id, ai.project_id AS portfolio_id, ai.portfolio_project_id AS project_id,
               ai.originating_meeting_id, ai.closed_in_meeting_id,
               pf.name AS portfolio_name, pp.name AS project_name, c.name AS client_name,
               u.name AS owner_name, m.meeting_date, m.title AS meeting_title,
               (ai.created_at AT TIME ZONE '{ET}')::date AS created_d,
               (COALESCE(ai.last_status_change, ai.updated_at, ai.created_at) AT TIME ZONE '{ET}')::date AS closed_d
        FROM action_items ai
        JOIN projects pf ON pf.id = ai.project_id
        JOIN clients c ON c.id = pf.client_id
        JOIN meetings m ON m.id = ai.originating_meeting_id
        LEFT JOIN portfolio_projects pp ON pp.id = ai.portfolio_project_id
        LEFT JOIN users u ON u.id = ai.resolved_owner_user_id
        WHERE (ai.portfolio_project_id IS NOT NULL AND {pscope})
           OR (ai.portfolio_project_id IS NULL AND ai.project_id IN
               (SELECT pp2.portfolio_id FROM portfolio_projects pp2 WHERE {pscope_pf}))
    ), s AS (
        SELECT a.*,
               (a.created_d <= :as_of AND (a.status IN ('open','pending') OR a.closed_d > :as_of)) AS is_open,
               (:as_of - a.created_d) AS age_days
        FROM a
    )"""
    return sql, {**params, "as_of": f.as_of}


METRIC_WHERE = {
    "open_actions": "is_open",
    "overdue_actions": "is_open AND due_date < :as_of",
    "due_soon_actions": "is_open AND due_date BETWEEN :as_of AND CAST(:as_of AS date) + 6",
    "no_due_date_actions": "is_open AND due_date IS NULL",
    "unassigned_actions": "is_open AND owner_type IN ('unassigned','unresolved')",
    "external_actions": "is_open AND owner_type = 'external'",
    "aged_60_actions": "is_open AND age_days > 60",
}


def count(db: Session, f: Filters, metric: str) -> int:
    base, params = _base(f)
    return q(db, f"{base} SELECT COUNT(*) AS n FROM s WHERE {METRIC_WHERE[metric]}", params)[0]["n"]


def rows(db: Session, f: Filters, metric: str, extra_where: str = "TRUE", extra: dict | None = None) -> list[dict]:
    base, params = _base(f)
    return q(db, f"""{base}
        SELECT id, text, status, due_date, owner, owner_type, owner_name, portfolio_id, portfolio_name, project_id,
               project_name, client_name, originating_meeting_id, meeting_date, meeting_title, created_d AS raised_on,
               age_days, CASE WHEN due_date < :as_of THEN :as_of - due_date END AS days_overdue
        FROM s WHERE {METRIC_WHERE[metric]} AND {extra_where}
        ORDER BY due_date NULLS LAST, id""", {**params, **(extra or {})})


def dashboard(db: Session, f: Filters) -> dict:
    base, params = _base(f)
    k = q(db, f"""{base}
        SELECT COUNT(*) FILTER (WHERE {METRIC_WHERE['open_actions']}) AS open_actions,
               COUNT(*) FILTER (WHERE {METRIC_WHERE['overdue_actions']}) AS overdue_actions,
               COUNT(*) FILTER (WHERE {METRIC_WHERE['due_soon_actions']}) AS due_soon_actions,
               COUNT(*) FILTER (WHERE {METRIC_WHERE['no_due_date_actions']}) AS no_due_date_actions,
               COUNT(*) FILTER (WHERE {METRIC_WHERE['unassigned_actions']}) AS unassigned_actions,
               COUNT(*) FILTER (WHERE {METRIC_WHERE['external_actions']}) AS external_actions,
               COUNT(*) FILTER (WHERE {METRIC_WHERE['aged_60_actions']}) AS aged_60_actions,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY age_days) FILTER (WHERE is_open) AS median_age_days
        FROM s""", params)[0]
    k["median_age_days"] = None if k["median_age_days"] is None else round(float(k["median_age_days"]))

    aging = q(db, f"""{base}
        SELECT bucket, COUNT(*) AS n, COUNT(*) FILTER (WHERE due_date < :as_of) AS overdue FROM (
          SELECT *, CASE WHEN age_days <= 7 THEN '0-7' WHEN age_days <= 14 THEN '8-14'
                         WHEN age_days <= 30 THEN '15-30' WHEN age_days <= 60 THEN '31-60' ELSE '60+' END AS bucket
          FROM s WHERE is_open) x
        GROUP BY bucket""", params)
    order = ["0-7", "8-14", "15-30", "31-60", "60+"]
    aging = sorted(aging, key=lambda r: order.index(r["bucket"]))

    by_owner = q(db, f"""{base}
        SELECT CASE WHEN owner_type = 'internal' THEN COALESCE(owner_name, owner)
                    WHEN owner_type = 'external' THEN 'Client / external'
                    ELSE 'Unassigned / unresolved' END AS owner_label,
               owner_type,
               COUNT(*) AS open, COUNT(*) FILTER (WHERE due_date < :as_of) AS overdue
        FROM s WHERE is_open GROUP BY 1, 2 ORDER BY overdue DESC, open DESC, owner_label LIMIT 16""", params)

    by_portfolio = q(db, f"""{base}
        SELECT portfolio_id, portfolio_name, client_name, COUNT(*) AS open,
               COUNT(*) FILTER (WHERE due_date < :as_of) AS overdue,
               COUNT(*) FILTER (WHERE owner_type IN ('unassigned','unresolved')) AS unassigned
        FROM s WHERE is_open GROUP BY 1, 2, 3 ORDER BY overdue DESC, open DESC LIMIT 12""", params)

    t0 = monday_of(f.trend_start)
    burndown = q(db, f"""{base}
        SELECT wk::date AS week_start,
               COUNT(*) FILTER (WHERE created_d <= wk::date + 6 AND (status IN ('open','pending') OR closed_d > wk::date + 6)) AS open_at_end,
               COUNT(*) FILTER (WHERE created_d <= wk::date + 6 AND (status IN ('open','pending') OR closed_d > wk::date + 6)
                                AND due_date < wk::date + 6) AS overdue_at_end,
               COUNT(*) FILTER (WHERE status = 'completed' AND closed_d BETWEEN wk::date AND wk::date + 6) AS completed,
               COUNT(*) FILTER (WHERE created_d BETWEEN wk::date AND wk::date + 6) AS raised
        FROM generate_series(CAST(:t0 AS date), CAST(:as_of AS date), interval '7 day') wk CROSS JOIN s
        GROUP BY wk ORDER BY wk""", {**params, "t0": t0})

    close = q(db, f"""{base}
        SELECT COUNT(*) FILTER (WHERE closed_d <= due_date) AS on_time, COUNT(*) AS closed_with_due
        FROM s WHERE status = 'completed' AND due_date IS NOT NULL AND closed_d BETWEEN :t0 AND :as_of""",
              {**params, "t0": f.as_of - timedelta(days=90)})[0]

    minutes = minutes_capture(db, f)
    owner_mix = q(db, f"""{base} SELECT owner_type, COUNT(*) AS n FROM s WHERE is_open GROUP BY 1 ORDER BY 2 DESC""", params)
    return {"kpis": k, "aging": aging, "by_owner": by_owner, "by_portfolio": by_portfolio, "burndown": burndown,
            "on_time_close": {**close, "rate_pct": pct(close["on_time"], close["closed_with_due"]), "window_days": 90},
            "minutes": minutes, "owner_mix": owner_mix}


def minutes_capture(db: Session, f: Filters) -> dict:
    """Of the portfolio meetings on the calendar in the last 8 weeks (up to 2
    business days ago), how many have minutes captured in PMO 360?
    GRAIN: one matched calendar event."""
    where, params = scope_sql(f, "pp")
    cutoff = add_business_days(f.as_of, -2)
    rows_ = q(db, f"""
        SELECT date_trunc('week', ce.start_at AT TIME ZONE '{ET}')::date AS week_start,
               COUNT(*) AS expected,
               COUNT(m.id) AS captured
        FROM calendar_events ce
        LEFT JOIN meetings m ON m.graph_event_id = ce.graph_event_id
        WHERE ce.match_method IN ('attendee','subject')
          AND (ce.start_at AT TIME ZONE '{ET}')::date BETWEEN :t0 AND :cutoff
          AND ce.matched_project_id IN (SELECT pp.portfolio_id FROM portfolio_projects pp WHERE {where})
        GROUP BY 1 ORDER BY 1""", {**params, "t0": f.as_of - timedelta(weeks=8), "cutoff": cutoff})
    exp = sum(r["expected"] for r in rows_)
    cap = sum(r["captured"] for r in rows_)
    return {"expected": exp, "captured": cap, "rate_pct": pct(cap, exp), "by_week": rows_}


def missing_minutes_rows(db: Session, f: Filters) -> list[dict]:
    where, params = scope_sql(f, "pp")
    return q(db, f"""
        SELECT ce.id, ce.subject, (ce.start_at AT TIME ZONE '{ET}')::date AS meeting_date, ce.match_method,
               pf.id AS portfolio_id, pf.name AS portfolio_name, c.name AS client_name, ce.organizer_email
        FROM calendar_events ce
        JOIN projects pf ON pf.id = ce.matched_project_id
        JOIN clients c ON c.id = pf.client_id
        LEFT JOIN meetings m ON m.graph_event_id = ce.graph_event_id
        WHERE m.id IS NULL AND ce.match_method IN ('attendee','subject')
          AND (ce.start_at AT TIME ZONE '{ET}')::date BETWEEN :t0 AND :cutoff
          AND ce.matched_project_id IN (SELECT pp.portfolio_id FROM portfolio_projects pp WHERE {where})
        ORDER BY meeting_date DESC""", {**params, "t0": f.as_of - timedelta(weeks=8),
                                       "cutoff": add_business_days(f.as_of, -2)})
