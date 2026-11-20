"""PMO 360 operations-analytics demo API (synthetic data only).

Mirrors production PMO 360's shape — FastAPI routers per domain over a
PostgreSQL database — without production auth: there is one fixed demo
identity and no tokens. See docs/ARCHITECTURE.md for how production protects
access (Entra ID JWT validation + per-module permission flags).
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sqlalchemy.orm import Session

from app import netguard, scenarios
from app.config import CORS_ORIGINS, DEMO_AS_OF, DEMO_LABEL
from app.db import get_db
from app.metrics import actions as A
from app.metrics import capacity as C
from app.metrics import commercial as CM
from app.metrics import delivery as D
from app.metrics import drill as DR
from app.metrics import quality as Q
from app.metrics import schedule as S
from app.metrics.catalog import CATALOG
from app.metrics.common import Filters, filters_dep, q
from app.metrics.project import project_detail


class _Encoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (date, datetime)):
            return o.isoformat()
        if hasattr(o, "__float__"):
            return float(o)
        return super().default(o)


class DemoJSON(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(content, cls=_Encoder, separators=(",", ":")).encode()


app = FastAPI(title="PMO 360 - Operations Analytics Demo", version="1.0.0", default_response_class=DemoJSON,
              description=f"{DEMO_LABEL}. Every record is synthetic; no production system is reachable.")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _guard():
    netguard.install()


@app.middleware("http")
async def _label(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Data-Classification"] = "synthetic-demo"
    return resp


# --------------------------------------------------------------------------- meta
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    return {"ok": True, "database": q(db, "SELECT current_database() AS db")[0]["db"], "label": DEMO_LABEL}


@app.get("/api/meta")
def meta(db: Session = Depends(get_db)):
    f = Filters()
    return {
        "label": DEMO_LABEL, "as_of": DEMO_AS_OF, "report_time": Q.report_time(f),
        "portfolios": q(db, """SELECT pf.id, pf.name, pf.project_number, c.id AS client_id, c.name AS client_name
                               FROM projects pf JOIN clients c ON c.id = pf.client_id ORDER BY c.name, pf.name"""),
        "clients": q(db, "SELECT id, name FROM clients ORDER BY name"),
        "pms": q(db, """SELECT DISTINCT u.id, u.name FROM users u JOIN portfolio_projects pp ON pp.pm_user_id = u.id
                        ORDER BY u.name"""),
        "disciplines": ["Electrical", "Civil", "Structural", "Substation", "Battery Storage"],
        "freshness": Q.freshness(db, f),
        "counts": q(db, """SELECT (SELECT COUNT(*) FROM clients) AS clients, (SELECT COUNT(*) FROM projects) AS portfolios,
                                  (SELECT COUNT(*) FROM portfolio_projects) AS projects,
                                  (SELECT COUNT(*) FROM work_items) AS work_items,
                                  (SELECT COUNT(*) FROM engineering_deliverables) AS deliverables,
                                  (SELECT COUNT(*) FROM milestones) AS milestones,
                                  (SELECT COUNT(*) FROM users) AS people,
                                  (SELECT COUNT(*) FROM meetings) AS meetings,
                                  (SELECT COUNT(*) FROM action_items) AS action_items,
                                  (SELECT COUNT(*) FROM raw_records) AS staged_records""")[0],
    }


@app.get("/api/meta/definitions")
def definitions():
    return {"metrics": CATALOG, "schedule_rule": S.__doc__, "capacity_assumptions": C.ASSUMPTIONS}


# --------------------------------------------------------------------------- dashboards
@app.get("/api/executive")
def executive(f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    return D.executive_dashboard(db, f, S.compute(db, f))


@app.get("/api/delivery")
def delivery(f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    return D.delivery_dashboard(db, f, S.compute(db, f))


@app.get("/api/capacity")
def capacity(f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    out = C.compute(db, f)
    out["hours"] = C.hours_variance(db, f)
    return out


@app.get("/api/actions")
def actions_dash(f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    return A.dashboard(db, f)


@app.get("/api/commercial")
def commercial(f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    return CM.dashboard(db, f, S.compute(db, f))


@app.get("/api/quality")
def quality(f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    return Q.dashboard(db, f)


@app.get("/api/quality/exceptions")
def quality_exceptions(rule: Optional[str] = None, source: Optional[str] = None, severity: Optional[str] = None,
                       q_: Optional[str] = Query(None, alias="q"), page: int = Query(1, ge=1),
                       page_size: int = Query(25, ge=1, le=200), db: Session = Depends(get_db)):
    return Q.exceptions(db, rule, source, severity, q_, page, page_size)


@app.get("/api/quality/raw/{raw_id}")
def raw_record(raw_id: int, db: Session = Depends(get_db)):
    rows = q(db, """SELECT rr.id, rr.source_key, rr.entity_type, rr.external_id, rr.payload, rr.record_hash,
                           rr.load_status, rr.core_table, rr.core_id, r.started_at, r.extract_file
                    FROM raw_records rr JOIN sync_runs r ON r.id = rr.sync_run_id WHERE rr.id = :id""", {"id": raw_id})
    if not rows:
        raise HTTPException(404, "Raw record not found")
    return rows[0]


@app.get("/api/pipeline/runs")
def pipeline_runs(source: Optional[str] = None, limit: int = Query(60, le=500), db: Session = Depends(get_db)):
    return q(db, f"""SELECT id, source_key, started_at, finished_at, extracted_at, status, rows_extracted, rows_loaded,
                            rows_rejected, rows_flagged, message, is_simulated_history, extract_file
                     FROM sync_runs {"WHERE source_key = :s" if source else ""}
                     ORDER BY started_at DESC LIMIT :lim""", {"s": source, "lim": limit})


@app.get("/api/pipeline/status-map")
def status_map(db: Session = Depends(get_db)):
    return {"status_map": q(db, "SELECT source_key, label_key, normalized_status FROM status_map ORDER BY 1, 3, 2"),
            "id_map": q(db, """SELECT source_key, match_method, entity_type, external_key, internal_id, note
                               FROM id_map WHERE match_method = 'manual' ORDER BY 1"""),
            "rules": q(db, "SELECT * FROM dq_rules ORDER BY severity, code")}


# --------------------------------------------------------------------------- drilldown
@app.get("/api/drill/{metric}")
def drill(metric: str, request: Request, f: Filters = Depends(filters_dep), page: int = Query(1, ge=1),
          page_size: int = Query(25, ge=1, le=500), q_: Optional[str] = Query(None, alias="q"),
          fmt: str = Query("json", alias="format"), db: Session = Depends(get_db)):
    if metric not in DR.METRICS:
        raise HTTPException(404, f"Unknown metric {metric!r}")
    facets = {k[6:]: v for k, v in request.query_params.items() if k.startswith("facet_")}
    rows = DR.apply_facets(DR.get_rows(db, f, metric), facets, q_)
    if fmt == "csv":
        return PlainTextResponse(DR.to_csv(rows), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{metric}_{f.as_of}.csv"'})
    start = (page - 1) * page_size
    return {"metric": metric, "definition": CATALOG.get(metric), "total": len(rows), "page": page,
            "page_size": page_size, "rows": rows[start:start + page_size]}


@app.get("/api/projects/{project_id}")
def project(project_id: int, f: Filters = Depends(filters_dep), db: Session = Depends(get_db)):
    out = project_detail(db, project_id, f)
    if out is None:
        raise HTTPException(404, "Project not found")
    return out


@app.get("/api/projects")
def project_search(q_: Optional[str] = Query(None, alias="q"), limit: int = Query(15, le=50), db: Session = Depends(get_db)):
    return q(db, """SELECT pp.id, pp.name, pf.name AS portfolio_name, c.name AS client_name, pp.lifecycle
                    FROM portfolio_projects pp JOIN projects pf ON pf.id = pp.portfolio_id JOIN clients c ON c.id = pf.client_id
                    WHERE CAST(:s AS text) IS NULL OR pp.name ILIKE CAST(:s AS text) OR pf.name ILIKE CAST(:s AS text)
                       OR c.name ILIKE CAST(:s AS text) OR pf.project_number ILIKE CAST(:s AS text)
                    ORDER BY pp.name LIMIT :lim""", {"s": f"%{q_}%" if q_ else None, "lim": limit})


# --------------------------------------------------------------------------- scenarios
@app.get("/api/scenarios")
def scenario_list(db: Session = Depends(get_db)):
    return [scenarios.summary(db, k, DEMO_AS_OF) for k in ("s1", "s2")]


@app.post("/api/scenarios/{key}/apply")
def scenario_apply(key: str, db: Session = Depends(get_db)):
    if key not in scenarios.INFO:
        raise HTTPException(404)
    res = scenarios.apply(db, key, DEMO_AS_OF)
    return {**res, **scenarios.summary(db, key, DEMO_AS_OF)}


@app.post("/api/scenarios/{key}/reset")
def scenario_reset(key: str, db: Session = Depends(get_db)):
    if key not in scenarios.INFO:
        raise HTTPException(404)
    res = scenarios.reset(db, key)
    return {**res, **scenarios.summary(db, key, DEMO_AS_OF)}
