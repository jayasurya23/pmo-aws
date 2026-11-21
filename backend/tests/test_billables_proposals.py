"""Billables and proposal tracker: totals reconcile with their own detail rows
and with an independent SQL count."""
from sqlalchemy import text

from app.metrics import billables as BL


def test_billables_month_buckets_add_up(client):
    b = client.get("/api/billables").json()
    k = b["kpis"]
    future = sum(m["on_track"] + m["at_risk"] + m["projected_late"] for m in b["by_month"])
    assert future == k["billable_6m"]
    at_risk_future = sum(m["at_risk"] + m["projected_late"] for m in b["by_month"])
    assert at_risk_future == k["at_risk_value"]
    assert k["billable_90d"] <= k["billable_6m"]


def test_billable_value_is_hours_times_rate(client, db):
    b = client.get("/api/billables").json()
    row = b["at_risk"][0]
    hours = db.execute(text("""SELECT SUM(planned_hours) FROM work_items
                               WHERE portfolio_project_id = :p AND stage = :s AND status <> 'cancelled'"""),
                       {"p": row["project_id"], "s": row["stage"]}).scalar()
    assert row["value"] == round(float(hours) * BL.BLENDED_RATE)


def test_billables_discipline_filter_is_a_subset(client):
    allk = client.get("/api/billables").json()["kpis"]
    parts = [client.get(f"/api/billables?disciplines={d}").json()["kpis"] for d in ("Electrical", "Civil", "Structural")]
    # Every work package belongs to exactly one discipline, so the parts add up to the whole.
    for key in ("billed_6m", "billable_6m"):
        assert sum(p[key] for p in parts) == allk[key]


def test_proposal_tracker_counts(client, db):
    p = client.get("/api/proposals").json()
    by_stage = {s["stage"]: s["count"] for s in p["by_stage"]}
    sql = dict(db.execute(text("SELECT status, COUNT(*) FROM proposals WHERE created_at::date <= '2026-11-20' GROUP BY status")).all())
    assert by_stage == {k: sql.get(k, 0) for k in by_stage}
    assert p["kpis"]["open_count"] == sum(by_stage[s] for s in ("draft", "submitted", "open", "bid"))
    assert len(p["proposals"]) == sum(by_stage.values())
    assert p["kpis"]["stuck_count"] == sum(1 for r in p["proposals"] if r["stuck"])
