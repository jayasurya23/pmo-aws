-- =====================================================================
-- PMO 360 — read-only adoption and outcome queries for the case study
-- =====================================================================
-- Purpose: replace every [CONFIRM] placeholder in the case-study documents
-- with a REAL number from production, without exporting any record.
--
-- * SELECT-only. Aggregates only: no names, clients, projects or text leave
--   the database. Review the output before sharing it with anyone.
-- * Written against PMO 360's production schema (backend/db/models.py).
--   Run with a read-only role, e.g. in a transaction you roll back:
--       BEGIN READ ONLY;  \i production_metrics.sql  ROLLBACK;
-- * Dates: change the two literals below to the window you will quote.
-- =====================================================================

\set since '''2026-05-21'''
\set until '''2026-11-20'''

-- Q1. Scale at a point in time (who/what the system covers)
SELECT (SELECT COUNT(*) FROM clients)                         AS clients,
       (SELECT COUNT(*) FROM projects)                        AS portfolios,
       (SELECT COUNT(*) FROM portfolio_projects)              AS sub_projects,
       (SELECT COUNT(*) FROM users WHERE is_active)           AS active_user_accounts,
       (SELECT COUNT(*) FROM timeline_resources WHERE active) AS timeline_resources;

-- Q2. Adoption: distinct people active per month (last_seen_at is bumped on every
-- authenticated request; previous_last_seen_at preserves the prior visit).
SELECT date_trunc('month', last_seen_at)::date AS month, COUNT(*) AS users_seen_that_month
FROM users WHERE last_seen_at >= :since::date GROUP BY 1 ORDER BY 1;
-- Who used it, by role-like grouping (department / title are filled from Entra):
SELECT COALESCE(department, '(none)') AS department, COUNT(*) AS users,
       COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '30 days') AS active_last_30d
FROM users WHERE is_active GROUP BY 1 ORDER BY 2 DESC;

-- Q3. Usage volume: meetings captured and actions tracked per month
SELECT date_trunc('month', meeting_date)::date AS month, COUNT(*) AS meetings_captured,
       COUNT(*) FILTER (WHERE stage = 'sent') AS minutes_sent
FROM meetings WHERE meeting_date BETWEEN :since::date AND :until::date GROUP BY 1 ORDER BY 1;

SELECT date_trunc('month', created_at)::date AS month, COUNT(*) AS actions_raised,
       COUNT(*) FILTER (WHERE status = 'completed') AS since_completed
FROM action_items WHERE created_at BETWEEN :since::date AND :until::date GROUP BY 1 ORDER BY 1;

-- Q4. Documents produced by the system (minutes PDFs, Word, Excel action logs, agendas)
SELECT kind, COUNT(*) AS generated, COUNT(*) FILTER (WHERE NOT is_draft) AS finalized
FROM generated_documents WHERE created_at BETWEEN :since::date AND :until::date GROUP BY 1 ORDER BY 2 DESC;

-- Q5. Accountability outcome: overdue share of open actions, month by month
-- (open at month end, due before month end). A falling line is a real outcome.
WITH m AS (SELECT generate_series(date_trunc('month', :since::date), :until::date, interval '1 month')::date AS m0)
SELECT m0 AS month,
       COUNT(*) FILTER (WHERE a.created_at < m0 + interval '1 month'
                          AND (a.status IN ('open','pending')
                               OR COALESCE(a.last_status_change, a.updated_at, a.created_at) >= m0 + interval '1 month')) AS open_at_month_end,
       COUNT(*) FILTER (WHERE a.created_at < m0 + interval '1 month'
                          AND (a.status IN ('open','pending')
                               OR COALESCE(a.last_status_change, a.updated_at, a.created_at) >= m0 + interval '1 month')
                          AND a.due_date < (m0 + interval '1 month')::date) AS overdue_at_month_end
FROM m CROSS JOIN action_items a GROUP BY m0 ORDER BY m0;

-- Q6. Close-out speed: median days from raised to completed, by month raised
SELECT date_trunc('month', created_at)::date AS month_raised,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM
           COALESCE(last_status_change, updated_at) - created_at) / 86400.0) AS median_days_to_close,
       COUNT(*) AS completed
FROM action_items WHERE status = 'completed' AND created_at >= :since::date GROUP BY 1 ORDER BY 1;

-- Q7. Data-quality improvement: share of actions with a canonical owner link
-- (owner_user_id) by month raised. The owner picker shipped late June 2026; a step
-- change here is evidence that fixing data entry changed data quality.
SELECT date_trunc('month', created_at)::date AS month_raised, COUNT(*) AS actions,
       ROUND(100.0 * COUNT(*) FILTER (WHERE owner_user_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_with_linked_owner,
       ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(TRIM(owner), '') = '' AND owner_user_id IS NULL) / NULLIF(COUNT(*), 0), 1) AS pct_no_owner
FROM action_items WHERE created_at >= :since::date GROUP BY 1 ORDER BY 1;

-- Q8. Capacity planning use: Timeline bookings and how far ahead they are planned
SELECT COUNT(*) AS bookings, COUNT(DISTINCT resource_id) AS people_booked,
       COUNT(*) FILTER (WHERE resource_id IS NULL) AS unstaffed_bookings,
       COUNT(*) FILTER (WHERE origin = 'proposal') AS created_from_proposals,
       MAX(end_date) AS furthest_booking
FROM timeline_assignments;

-- Q9. Commercial workflow: change orders and approval cycle time
SELECT status, COUNT(*) AS change_orders, ROUND(SUM(total_amount)::numeric, -3) AS total_value_rounded
FROM change_orders GROUP BY 1 ORDER BY 1;
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM responded_at - requested_at) / 86400.0)
         AS median_days_request_to_decision, COUNT(*) AS decided_requests
FROM co_approval_requests WHERE status IN ('approved','rejected') AND responded_at IS NOT NULL;

-- Q10. Proposals and portfolio linkage
SELECT COUNT(*) AS proposals, COUNT(*) FILTER (WHERE portfolio_id IS NOT NULL) AS linked_to_a_portfolio,
       (SELECT COUNT(*) FROM proposal_versions) AS proposal_versions
FROM proposals;

-- Q11. Job-number coverage after the Monday backfill
SELECT COUNT(*) AS portfolios, COUNT(*) FILTER (WHERE project_number IS NOT NULL) AS with_job_number
FROM projects;
