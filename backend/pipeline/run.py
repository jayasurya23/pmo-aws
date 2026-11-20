"""Run the whole demo pipeline.

    python -m pipeline.run --reset            # generate extracts, rebuild schema, load everything
    python -m pipeline.run --reset --seed 7   # a different (still deterministic) world

Order matters and mirrors real dependencies:
  master (identity) -> Monday portfolio board (job numbers) -> Timeline resources
  -> manual crosswalk -> Monday work board -> Timeline assignments (need work items)
  -> deliverable register (needs work items for cross-source checks; derives
     milestone actuals) -> minutes/actions -> Graph calendar (needs rosters)
  -> proposal360 -> change orders -> KPI snapshot
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from app import netguard
from app.config import DEMO_AS_OF, DEMO_SEED, SOURCES_DIR
from app.db import engine, session_scope
from app.models import Base, DqRule, StatusMap, SourceSystem, SyncRun
from pipeline.emit import write_extracts
from pipeline.load import Loader
from pipeline.rules import DQ_RULES, SOURCE_SYSTEMS, STATUS_MAP
from pipeline.world import generate

UTC = timezone.utc


def seed_config(db):
    for key, name, kind, sor, prod, cadence, sla in SOURCE_SYSTEMS:
        db.add(SourceSystem(key=key, name=name, kind=kind, system_of_record_for=sor,
                            production_equivalent=prod, refresh_cadence=cadence, freshness_sla_hours=sla))
    for code, name, sev, ent, action, desc, why in DQ_RULES:
        db.add(DqRule(code=code, name=name, severity=sev, entity_type=ent, action=action,
                      description=desc, why_it_matters=why))
    for src, mapping in STATUS_MAP.items():
        for k, v in mapping.items():
            db.add(StatusMap(source_key=src, label_key=k, example_label=k, normalized_status=v))
    db.flush()


def simulate_history(db, as_of: date, seed: int, actual_counts: dict[str, int]):
    """Summary rows for the 13 days BEFORE this run, so freshness and success-rate
    charts have a history. Flagged is_simulated_history and labelled in the UI.
    No staged records exist for these runs."""
    rng = random.Random(seed + 99)
    cadence = {"pmo360_master": [11], "monday_portfolio_board": [11], "monday_work_board": [11, 15, 19, 23],
               "deliverable_register": [11], "timeline_capacity": [11], "meeting_minutes": [11],
               "graph_calendar": [11, 14, 17, 20], "proposal360": [11], "change_orders": [11]}
    failures = {
        ("monday_work_board", 6, 15): "HTTP 429 from Monday API (complexity budget exhausted); retried next cycle.",
        ("graph_calendar", 9, 14): "401 from Microsoft Graph: delegated token expired; refreshed on next run.",
        ("deliverable_register", 1, 11): "Schema drift: missing ['Actual Issue']; found ['Issued On'].",
    }
    for src, hours in cadence.items():
        for day in range(13, 0, -1):
            d = as_of - timedelta(days=day)
            for h in hours:
                started = datetime(d.year, d.month, d.day, h, rng.randint(0, 9), tzinfo=UTC)
                if src == "deliverable_register" and day == 2:
                    continue  # the real run for this file is executed below
                msg = failures.get((src, day, h))
                n = actual_counts.get(src, 0)
                extracted = max(0, int(n * (1 - day * 0.002)) + rng.randint(-3, 3))
                db.add(SyncRun(source_key=src, started_at=started, finished_at=started + timedelta(seconds=rng.randint(15, 90)),
                               extracted_at=None if msg else started - timedelta(minutes=1),
                               status="failed" if msg else "success",
                               rows_extracted=0 if msg else extracted, rows_loaded=0 if msg else extracted,
                               rows_rejected=0, rows_flagged=0, message=msg, is_simulated_history=True))


def run(seed: int, as_of: date, reset: bool, out_dir: str = SOURCES_DIR, quiet: bool = False) -> dict:
    netguard.install()
    t0 = time.time()
    world = generate(seed, as_of)
    manifest = write_extracts(world, out_dir, seed)
    if reset:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"))
        Base.metadata.create_all(engine)
    with session_scope() as db:
        seed_config(db)
        L = Loader(db, out_dir, as_of)
        L.load_master()
        L.load_portfolio_board()
        L.load_timeline_base()
        L.load_crosswalk()
        L.load_work_board()
        L.load_assignments()
        reg_old = f"deliverable_register_{(as_of - timedelta(days=2)).isoformat()}.csv"
        reg_new = f"deliverable_register_{as_of.isoformat()}.csv"
        L.load_register(reg_old, run_started=datetime(as_of.year, as_of.month, as_of.day, 11, 5, tzinfo=UTC) - timedelta(days=2))
        L.load_register(reg_new, run_started=L.clock + timedelta(minutes=1))
        L.load_meetings()
        L.load_calendar()
        L.load_proposals()
        L.load_change_orders()
        counts = {}
        for k, v in L.summary.items():
            counts[k.split("#")[0]] = max(counts.get(k.split("#")[0], 0), v["extracted"])
        simulate_history(db, as_of, seed, counts)
        db.flush()
        from app.metrics.snapshot import write_kpi_snapshot
        write_kpi_snapshot(db, as_of)
    with engine.begin() as conn:
        # Source ids were loaded explicitly; advance every id sequence past them so
        # later inserts (scenario decisions, new exceptions) cannot collide.
        for (tbl,) in conn.execute(text("""SELECT table_name FROM information_schema.columns
                                            WHERE table_schema = 'public' AND column_name = 'id'
                                              AND column_default LIKE 'nextval%'""")):
            conn.execute(text(f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), "
                              f"GREATEST(COALESCE((SELECT MAX(id) FROM {tbl}), 0), 1))"))
        conn.execute(text("ANALYZE"))
    if not quiet:
        print(f"Pipeline finished in {time.time() - t0:.1f}s (seed={seed}, as_of={as_of})")
        for k, v in L.summary.items():
            print(f"  {k:<28} {v['status']:<8} extracted={v['extracted']:<5} loaded={v['loaded']:<5} "
                  f"rejected={v['rejected']:<4} flagged={v['flagged']:<4} {v['message'] or ''}")
    return {"manifest": manifest, "summary": L.summary}


def main(argv=None):
    ap = argparse.ArgumentParser(description="PMO 360 demo pipeline (synthetic data only)")
    ap.add_argument("--reset", action="store_true", help="drop and rebuild the demo schema first")
    ap.add_argument("--seed", type=int, default=DEMO_SEED)
    ap.add_argument("--as-of", type=date.fromisoformat, default=DEMO_AS_OF)
    args = ap.parse_args(argv)
    if not args.reset:
        print("Refusing to load into an existing schema without --reset (the demo pipeline is full-refresh).")
        return 2
    run(args.seed, args.as_of, reset=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
