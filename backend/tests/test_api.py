"""Every endpoint responds, labels itself as synthetic, and supports the
self-service features the UI relies on (pagination, search, CSV)."""
import pytest

ENDPOINTS = ["/api/health", "/api/meta", "/api/meta/definitions", "/api/executive", "/api/delivery", "/api/capacity",
             "/api/actions", "/api/commercial", "/api/quality", "/api/quality/exceptions", "/api/pipeline/runs",
             "/api/pipeline/status-map", "/api/scenarios", "/api/projects?q=Cedar"]


@pytest.mark.parametrize("url", ENDPOINTS)
def test_endpoint_ok_and_labelled(client, url):
    r = client.get(url)
    assert r.status_code == 200, r.text[:300]
    assert r.headers["X-Data-Classification"] == "synthetic-demo"


def test_every_drill_metric_responds(client):
    from app.metrics.drill import METRICS
    for m in METRICS:
        r = client.get(f"/api/drill/{m}?page_size=5")
        assert r.status_code == 200, (m, r.text[:200])


def test_drill_pagination_search_and_csv(client):
    full = client.get("/api/drill/open_actions?page_size=500").json()
    p2 = client.get("/api/drill/open_actions?page=2&page_size=10").json()
    assert p2["rows"] == full["rows"][10:20]
    s = client.get("/api/drill/open_actions?page_size=500&q=geotechnical").json()
    assert 0 < s["total"] < full["total"]
    csv = client.get("/api/drill/open_actions?format=csv")
    assert csv.headers["content-type"].startswith("text/csv")
    assert len(csv.text.strip().splitlines()) == full["total"] + 1


def test_project_drilldown(client):
    pid = client.get("/api/projects?q=Cedar Hollow").json()[0]["id"]
    d = client.get(f"/api/projects/{pid}").json()
    assert d["project"]["health"] == "behind"
    stages = {m["stage"]: m for m in d["milestones"]}
    assert stages["90%"]["status"] == "late" and stages["IFC"]["status"] == "projected_late"
    assert any(w["status"] == "blocked" and w["history"] for w in d["work_items"])


def test_raw_payload_reachable_from_exception(client):
    ex = client.get("/api/quality/exceptions?rule=DUPLICATE_EXTERNAL_RECORD").json()["rows"][0]
    raw = client.get(f"/api/quality/raw/{ex['raw_record_id']}").json()
    assert raw["load_status"] == "duplicate" and raw["payload"]["id"] == ex["external_id"]


def test_definitions_cover_kpis(client):
    defs = client.get("/api/meta/definitions").json()["metrics"]
    for k in ["active_projects", "late_milestones", "projected_late_milestones", "overdue_actions",
              "overallocated_people", "proposal_turnaround", "source_freshness"]:
        assert k in defs and defs[k]["grain"] and defs[k]["origin"] in ("production", "adapted", "demo")


def test_static_export_matches_api(client, tmp_path):
    """The hosted (static) site shows exactly what the API computes."""
    import json
    from pipeline.export_static import export
    sizes = export(str(tmp_path / "static"))
    d = tmp_path / "static"
    assert {"meta.json", "executive_all.json", "drill_all.json", "scenarios.json", "projects_index.json"} <= set(sizes)
    ex = json.loads((d / "executive_all.json").read_text())
    assert ex["kpis"] == client.get("/api/executive").json()["kpis"]
    drill = json.loads((d / "drill_substation.json").read_text())
    assert len(drill["overdue_actions"]) == client.get("/api/drill/overdue_actions?disciplines=Substation&page_size=1").json()["total"]
    scen = json.loads((d / "scenarios.json").read_text())
    assert not scen["s1"]["before"]["applied"] and scen["s1"]["applied"]["applied"]
    idx = json.loads((d / "projects_index.json").read_text())
    shards = {}
    for i in range(8):
        shards.update(json.loads((d / f"projects_{i}.json").read_text()))
    assert len(shards) == len(idx)
