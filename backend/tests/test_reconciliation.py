"""Every dashboard number must reconcile with the records behind it.

Three-way check per KPI:
  1. the value the dashboard endpoint returns
  2. the row count of the drilldown for the same filters
  3. an INDEPENDENT count written directly against the core tables here,
     deliberately not reusing the metrics code
"""
import pytest
from sqlalchemy import text

from app.config import DEMO_AS_OF

AS_OF = DEMO_AS_OF


def drill_total(client, metric, qs=""):
    r = client.get(f"/api/drill/{metric}?page_size=1{qs}")
    assert r.status_code == 200, r.text
    return r.json()["total"]


def sql(db, q, **p):
    return db.execute(text(q), {"as_of": AS_OF, **p}).scalar()


EXEC_KPIS = ["active_projects", "projects_on_track", "projects_at_risk", "projects_behind", "projects_on_hold",
             "late_milestones", "upcoming_milestones", "projected_late_milestones", "open_actions",
             "overdue_actions", "overdue_deliverables"]


@pytest.mark.parametrize("metric", EXEC_KPIS)
def test_executive_kpi_equals_drilldown(client, metric):
    kpis = client.get("/api/executive").json()["kpis"]
    assert kpis[metric] == drill_total(client, metric), metric


@pytest.mark.parametrize("metric", ["open_actions", "overdue_actions", "due_soon_actions", "no_due_date_actions",
                                    "unassigned_actions", "external_actions", "aged_60_actions"])
def test_action_kpis_equal_drilldown(client, metric):
    kpis = client.get("/api/actions").json()["kpis"]
    assert kpis[metric] == drill_total(client, metric)


@pytest.mark.parametrize("metric", ["late_milestones", "projected_late_milestones", "at_risk_milestones",
                                    "overdue_deliverables", "blocked_work_items"])
def test_delivery_kpis_equal_drilldown(client, metric):
    kpis = client.get("/api/delivery").json()["kpis"]
    assert kpis[metric] == drill_total(client, metric)


def test_capacity_overallocated_equals_drilldown(client):
    assert client.get("/api/capacity").json()["totals"]["overallocated_people"] == drill_total(client, "overallocated_people")


def test_co_backlog_equals_drilldown(client):
    assert client.get("/api/commercial").json()["kpis"]["co_backlog_count"] == drill_total(client, "co_backlog")


# ---------------------------------------------------------------- independent SQL
def test_active_projects_independent(client, db):
    expected = sql(db, "SELECT COUNT(*) FROM portfolio_projects WHERE lifecycle = 'active'")
    assert client.get("/api/executive").json()["kpis"]["active_projects"] == expected


def test_open_and_overdue_actions_independent(client, db):
    # as_of is the extract date, so "open at as_of" equals the current status.
    open_ = sql(db, "SELECT COUNT(*) FROM action_items WHERE status IN ('open','pending')")
    overdue = sql(db, "SELECT COUNT(*) FROM action_items WHERE status IN ('open','pending') AND due_date < :as_of")
    no_due = sql(db, "SELECT COUNT(*) FROM action_items WHERE status IN ('open','pending') AND due_date IS NULL")
    k = client.get("/api/actions").json()["kpis"]
    assert (k["open_actions"], k["overdue_actions"], k["no_due_date_actions"]) == (open_, overdue, no_due)


def test_overdue_is_strictly_before_today(client, db):
    """Production rule: an action due TODAY is due, not overdue."""
    due_today = sql(db, "SELECT COUNT(*) FROM action_items WHERE status IN ('open','pending') AND due_date = :as_of")
    rows = client.get("/api/drill/overdue_actions?page_size=500").json()["rows"]
    assert all(r["due_date"] < AS_OF.isoformat() for r in rows)
    soon = client.get("/api/drill/due_soon_actions?page_size=500").json()["rows"]
    assert sum(1 for r in soon if r["due_date"] == AS_OF.isoformat()) == due_today


def test_late_milestones_independent(client, db):
    expected = sql(db, """SELECT COUNT(*) FROM milestones m JOIN portfolio_projects pp ON pp.id = m.portfolio_project_id
                          WHERE m.actual_date IS NULL AND m.planned_date < :as_of AND pp.lifecycle <> 'on_hold'""")
    assert client.get("/api/delivery").json()["kpis"]["late_milestones"] == expected


def test_overdue_deliverables_independent(client, db):
    expected = sql(db, """SELECT COUNT(*) FROM engineering_deliverables d JOIN portfolio_projects pp ON pp.id = d.portfolio_project_id
                          WHERE d.planned_issue_date < :as_of AND (d.actual_issue_date IS NULL OR d.actual_issue_date > :as_of)
                            AND pp.lifecycle <> 'on_hold'""")
    assert client.get("/api/delivery").json()["kpis"]["overdue_deliverables"] == expected


def test_blocked_work_independent(client, db):
    expected = sql(db, """SELECT COUNT(*) FROM work_items w JOIN portfolio_projects pp ON pp.id = w.portfolio_project_id
                          WHERE w.status = 'blocked' AND pp.lifecycle <> 'on_hold'""")
    assert client.get("/api/delivery").json()["kpis"]["blocked_work_items"] == expected


def test_health_buckets_partition_projects(client, db):
    """Every project lands in exactly one health bucket."""
    health = {h["health"]: h["count"] for h in client.get("/api/executive").json()["health"]}
    assert sum(health.values()) == sql(db, "SELECT COUNT(*) FROM portfolio_projects")
    k = client.get("/api/executive").json()["kpis"]
    assert k["projects_on_track"] + k["projects_at_risk"] + k["projects_behind"] + k["projects_unknown"] == k["active_projects"]


def test_hours_variance_excludes_unknown_actuals(client, db):
    hrs = client.get("/api/capacity").json()["hours"]["by_discipline"]
    for r in hrs:
        assert r["with_actuals"] + r["actual_unknown"] == r["completed"]
        exp = sql(db, """SELECT COALESCE(SUM(planned_hours), 0) FROM work_items w
                         WHERE w.status = 'done' AND w.actual_hours IS NOT NULL AND w.discipline = :d
                           AND w.completed_date BETWEEN CAST(:as_of AS date) - 182 AND :as_of""", d=r["discipline"])
        assert round(float(exp), 1) == r["planned_h"]


# ---------------------------------------------------------------- filters
def test_portfolio_filter_partitions_active_projects(client, db):
    """Summing a KPI over every client equals the unfiltered KPI: filters neither drop nor duplicate rows."""
    total = client.get("/api/executive").json()["kpis"]["active_projects"]
    clients = [c["id"] for c in client.get("/api/meta").json()["clients"]]
    s = sum(client.get(f"/api/executive?clients={c}").json()["kpis"]["active_projects"] for c in clients)
    assert s == total


def test_discipline_filter_is_subset(client):
    allp = {r["id"] for r in client.get("/api/drill/active_projects?page_size=500").json()["rows"]}
    sub = {r["id"] for r in client.get("/api/drill/active_projects?page_size=500&disciplines=Substation").json()["rows"]}
    assert sub and sub < allp


def test_filtered_kpi_matches_filtered_drilldown(client):
    qs = "&disciplines=Structural&lookahead_days=56"
    k = client.get(f"/api/delivery?{qs[1:]}").json()["kpis"]
    assert k["upcoming_milestones"] == drill_total(client, "upcoming_milestones", qs)
    assert k["blocked_work_items"] == drill_total(client, "blocked_work_items", qs)
