"""Write headline KPIs at the end of each pipeline run (kpi_snapshots), so the
values a leader saw on a given morning can be reproduced later."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.models import KpiSnapshot


def write_kpi_snapshot(db: Session, as_of: date) -> dict:
    from app.metrics import capacity as C
    from app.metrics import delivery as D
    from app.metrics import schedule as S
    from app.metrics.common import Filters

    f = Filters(as_of=as_of)
    sched = S.compute(db, f)
    ex = D.executive_dashboard(db, f, sched)["kpis"]
    cap = C.compute(db, f)["totals"]
    values = {**ex, "overallocated_people": cap["overallocated_people"], "utilisation_pct": cap["utilisation_pct"]}
    for k, v in values.items():
        db.add(KpiSnapshot(as_of=as_of, metric_key=k, value=v))
    return values
