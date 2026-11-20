"""Schedule rules, determinism, scenarios, network isolation and confidentiality."""
import hashlib
import os
import re
import socket
from datetime import date
from pathlib import Path

import pytest

from app.bizdays import add_business_days, business_days_between
from app.metrics.schedule import _classify

AS_OF = date(2026, 11, 20)
P = {"lifecycle": "active"}


def ms(planned, actual=None):
    return {"planned_date": planned, "actual_date": actual, "baseline_date": planned}


def wi(**kw):
    base = {"discipline": "Civil", "status": "in_progress", "planned_hours": 80, "percent_complete": 0.5, "util": 0.5,
            "due_date": add_business_days(AS_OF, 10), "planned_start": add_business_days(AS_OF, -10),
            "expected_unblock_date": None, "completed_date": None}
    base.update(kw)
    return base


# ---------------------------------------------------------------- schedule rule
def test_complete_on_time_and_late():
    assert _classify(ms(date(2026, 10, 1), date(2026, 10, 1)), [], P, {}, AS_OF)["status"] == "complete_on_time"
    r = _classify(ms(date(2026, 10, 1), date(2026, 10, 6)), [], P, {}, AS_OF)
    assert r["status"] == "complete_late" and r["variance_bd"] == 3


def test_already_late_is_not_a_projection():
    r = _classify(ms(date(2026, 11, 13)), [wi(due_date=date(2026, 11, 10))], P, {}, AS_OF)
    assert r["status"] == "late" and r["days_late_bd"] == business_days_between(date(2026, 11, 13), AS_OF)


def test_future_on_plan_is_on_track_not_overdue():
    planned = add_business_days(AS_OF, 20)
    r = _classify(ms(planned), [wi(due_date=add_business_days(planned, -3), percent_complete=0.6)], P, {}, AS_OF)
    assert r["status"] == "on_track"


def test_blocked_package_pushes_projection():
    planned = add_business_days(AS_OF, 12)
    r = _classify(ms(planned), [wi(status="blocked", due_date=add_business_days(planned, -3), percent_complete=0.2)], P, {}, AS_OF)
    assert r["status"] == "projected_late" and r["slip_bd"] > 5
    assert any("5 business days assumed" in b for b in r["basis"])


def test_tolerance_band():
    """A projected slip of <= 2 business days is on track; 3-5 at risk."""
    planned = add_business_days(AS_OF, 30)
    on = _classify(ms(planned), [wi(due_date=add_business_days(planned, -3), percent_complete=0.0, util=0.25,
                                    planned_hours=8 * 0.25 * 26)], P, {}, AS_OF)
    assert on["slip_bd"] <= 2 and on["status"] == "on_track"


def test_on_hold_and_no_data():
    assert _classify(ms(add_business_days(AS_OF, 10)), [], {"lifecycle": "on_hold"}, {}, AS_OF)["status"] == "on_hold"
    assert _classify(ms(add_business_days(AS_OF, 10)), [], P, {}, AS_OF)["status"] == "no_data"
    assert _classify(ms(None), [], P, {}, AS_OF)["status"] == "no_plan"


# ---------------------------------------------------------------- determinism
def _hash_dir(d):
    h = hashlib.sha256()
    for f in sorted(Path(d).iterdir()):
        h.update(f.name.encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def test_generator_is_deterministic(tmp_path):
    from pipeline.emit import write_extracts
    from pipeline.world import generate
    a, b = tmp_path / "a", tmp_path / "b"
    write_extracts(generate(360, AS_OF), str(a), 360)
    write_extracts(generate(360, AS_OF), str(b), 360)
    assert _hash_dir(a) == _hash_dir(b)
    c = tmp_path / "c"
    write_extracts(generate(7, AS_OF), str(c), 7)
    assert _hash_dir(a) != _hash_dir(c)


# ---------------------------------------------------------------- scenarios
def _snapshot(client):
    cap = client.get("/api/capacity").json()["totals"]
    ex = client.get("/api/executive").json()["kpis"]
    return cap, ex


def test_scenario_1_reduces_overallocation_and_resets(client):
    before = _snapshot(client)
    r = client.post("/api/scenarios/s1/apply").json()
    assert r["status"] == "applied"
    assert r["current"]["senior_over_person_weeks"] < r["before"]["senior_over_person_weeks"]
    assert r["current"]["senior_peak_pct"] < r["before"]["senior_peak_pct"]
    client.post("/api/scenarios/s1/reset")
    assert _snapshot(client) == before


def test_scenario_2_protects_ifc_and_resets(client):
    before = _snapshot(client)
    r = client.post("/api/scenarios/s2/apply").json()
    assert r["before"]["ifc_status"] == "Projected late"
    assert r["current"]["ifc_slip_bd"] < r["before"]["ifc_slip_bd"]
    assert r["current"]["blocked_packages"] == 0 and r["current"]["unassigned_actions"] < r["before"]["unassigned_actions"]
    assert any(m["stage"] == "90%" and m["status"] == "Late" for m in r["current"]["milestones"])  # history not rewritten
    client.post("/api/scenarios/s2/reset")
    assert _snapshot(client) == before


# ---------------------------------------------------------------- network isolation
def test_network_guard_blocks_production_hosts():
    from app import netguard
    netguard.install()
    for host in ("api.monday.com", "graph.microsoft.com", "api.openai.com", "8.8.8.8"):
        with pytest.raises(netguard.ExternalNetworkBlocked):
            socket.create_connection((host, 443), timeout=2)


def test_pipeline_ran_with_guard_installed(pipeline_result):
    from app import netguard
    assert netguard._installed  # pipeline.run installs it before touching anything


ROOT = Path(__file__).resolve().parents[2]
CODE_DIRS = [ROOT / "backend" / "app", ROOT / "backend" / "pipeline", ROOT / "frontend" / "src"]


def _files(dirs, exts=(".py", ".ts", ".tsx", ".json", ".csv", ".md", ".css", ".html", ".yml", ".yaml", ".env", ".example")):
    for d in dirs:
        if not d.exists():
            continue
        for f in d.rglob("*"):
            if f.is_file() and (f.suffix in exts or f.name.endswith(".example")) and "node_modules" not in f.parts:
                yield f


def test_no_http_client_in_runtime_code():
    """The demo has no code path that could call an external API."""
    for f in _files(CODE_DIRS[:2], (".py",)):
        src = f.read_text()
        assert not re.search(r"^\s*(import|from)\s+(requests|httpx|urllib3|aiohttp)\b", src, re.M), f
        assert "urlopen(" not in src, f


# ---------------------------------------------------------------- confidentiality
def test_no_confidential_strings_in_repo_or_generated_data(sources_dir):
    """Hashed denylist (pipeline/denylist.py): real client/project/people names,
    production board and app ids, the owner's address. Scans code, docs,
    case-study files and every generated source extract."""
    from pipeline.denylist import find_denied
    dirs = CODE_DIRS + [ROOT / "backend" / "tests", ROOT / "docs", ROOT / "case-study", ROOT / "tools", Path(sources_dir)]
    files = list(_files([d for d in dirs if d.is_dir()])) + [f for f in (ROOT / "README.md", ROOT / "docker-compose.yml") if f.exists()]
    hits = [(str(f), h) for f in files for h in find_denied(f.read_text(errors="ignore"))]
    assert not hits, hits


def test_all_generated_emails_use_reserved_domain(db):
    from sqlalchemy import text
    emails = [r[0] for r in db.execute(text("SELECT email FROM users"))]
    assert emails and all(e.endswith(".example") for e in emails)


def test_no_secrets_in_env_templates():
    for f in [ROOT / ".env.example", ROOT / "backend" / ".env.example"]:
        if f.exists():
            src = f.read_text()
            assert "MONDAY_API_TOKEN" not in src and "CLIENT_SECRET" not in src and "OPENAI" not in src
