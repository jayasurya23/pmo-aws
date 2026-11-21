"""Proposal tracker: every proposal, its stage, and how long it has been there.

Stages are proposal360's vocabulary: draft -> submitted -> open (client review)
-> bid -> won / closed. Stage times come from the append-only stage events.

GRAINS
  proposal        one proposal; current stage = proposals.status
  days in stage   business days since the proposal's last stage event (or its
                  creation if it has none)
  time per stage  business days between consecutive stage events, per stage left
  win rate        won / (won + closed), for proposals created in the trend window
"""
from __future__ import annotations

from collections import defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.bizdays import business_days_between
from app.metrics import commercial as CM
from app.metrics.common import Filters, q

ET = ZoneInfo("America/New_York")
OPEN = ("draft", "submitted", "open", "bid")
STUCK_BD = {"draft": 15, "submitted": 10, "open": 45, "bid": 30}  # business days a stage normally takes, at most


def dashboard(db: Session, f: Filters) -> dict:
    props = CM.proposal_rows(db, f)
    ids = [p["id"] for p in props]
    events = defaultdict(list)
    if ids:
        for e in q(db, """SELECT proposal_id, from_status, to_status, at FROM proposal_stage_events
                          WHERE proposal_id = ANY(:ids) ORDER BY proposal_id, at""", {"ids": ids}):
            d = e["at"].astimezone(ET).date()
            if d <= f.as_of:
                events[e["proposal_id"]].append((e["from_status"], e["to_status"], d))
    per_stage = defaultdict(list)
    for p in props:
        ev = events.get(p["id"], [])
        since = ev[-1][2] if ev else p["created_d"]
        p["stage_since"] = since
        p["days_in_stage"] = business_days_between(since, f.as_of)
        p["stuck"] = p["status"] in OPEN and p["days_in_stage"] > STUCK_BD[p["status"]]
        prev_status, prev_d = "draft", p["created_d"]
        for frm, to, d in ev:
            per_stage[frm or prev_status].append(business_days_between(prev_d, d))
            prev_status, prev_d = to, d

    t0 = f.trend_start
    recent = [p for p in props if p["created_d"] >= t0]
    won = sum(1 for p in recent if p["status"] == "won")
    lost = sum(1 for p in recent if p["status"] == "closed")
    open_ = [p for p in props if p["status"] in OPEN]
    fees = [p["fee_total"] for p in open_ if p["fee_total"] is not None]
    known_ta = [p["turnaround_bd"] for p in recent if p["turnaround_bd"] is not None]

    by_stage = []
    for st in CM.STAGES:
        sel = [p for p in props if p["status"] == st]
        fv = [p["fee_total"] for p in sel if p["fee_total"] is not None]
        by_stage.append({"stage": st, "label": CM.STAGE_LABEL[st], "count": len(sel), "fee_total": round(sum(fv)),
                         "fee_unknown": len(sel) - len(fv), "stuck": sum(1 for p in sel if p["stuck"])})
    created = defaultdict(lambda: {"won": 0, "closed": 0, "open": 0})
    for p in recent:
        k = "won" if p["status"] == "won" else "closed" if p["status"] == "closed" else "open"
        created[p["created_d"].strftime("%Y-%m")][k] += 1
    stage_time = [{"stage": st, "label": CM.STAGE_LABEL[st], "median_bd": CM._median(per_stage[st]), "n": len(per_stage[st])}
                  for st in OPEN if per_stage.get(st)]
    keep = ("id", "job_number", "title", "status", "technology", "mwdc", "fee_total", "client_name", "owner_name",
            "created_d", "stage_since", "days_in_stage", "stuck", "turnaround_bd")
    return {
        "kpis": {
            "open_count": len(open_), "open_fee": round(sum(fees)), "open_fee_unknown": len(open_) - len(fees),
            "win_rate_pct": round(100 * won / (won + lost)) if won + lost else None, "won": won, "lost": lost,
            "turnaround_median_bd": CM._median(known_ta), "stuck_count": sum(1 for p in open_ if p["stuck"]),
        },
        "stuck_after_bd": STUCK_BD,
        "by_stage": by_stage,
        "stage_time": stage_time,
        "created_by_month": [{"month": m, **v} for m, v in sorted(created.items())],
        "proposals": [{k: p[k] for k in keep} for p in props],
    }
