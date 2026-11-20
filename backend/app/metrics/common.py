"""Shared filter semantics for every metric.

ONE definition of "which projects are in scope", applied identically by every
dashboard query and every drilldown. If a KPI card and its drilldown table both
build their WHERE clause from `scope_sql()`, they cannot disagree about which
records count.

Date semantics (documented on every dashboard):
  * as_of           Reporting date. Every status (late, overdue, open, achieved)
                    is evaluated against it. Defaults to the extract date.
  * lookahead_days  Horizon for "upcoming" metrics (deadlines, capacity weeks).
  * trend_weeks     Window for trend charts (completions, burndown, turnaround).
  * capacity_weeks  Capacity horizon (weeks from the reporting week).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from fastapi import Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import DEMO_AS_OF


@dataclass
class Filters:
    as_of: date = DEMO_AS_OF
    portfolio_ids: list[int] = field(default_factory=list)
    client_ids: list[int] = field(default_factory=list)
    disciplines: list[str] = field(default_factory=list)
    pm_ids: list[int] = field(default_factory=list)
    lookahead_days: int = 28
    trend_weeks: int = 26
    capacity_weeks: int = 10

    @property
    def lookahead_end(self) -> date:
        return self.as_of + timedelta(days=self.lookahead_days)

    @property
    def trend_start(self) -> date:
        return self.as_of - timedelta(weeks=self.trend_weeks)

    def key(self) -> tuple:
        return (self.as_of, tuple(self.portfolio_ids), tuple(self.client_ids), tuple(self.disciplines),
                tuple(self.pm_ids), self.lookahead_days, self.trend_weeks, self.capacity_weeks)


def _ints(v: Optional[str]) -> list[int]:
    return [int(x) for x in (v or "").split(",") if x.strip().isdigit()]


def _strs(v: Optional[str]) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def filters_dep(
    as_of: Optional[date] = Query(None, description="Reporting date; defaults to the extract date"),
    portfolios: Optional[str] = Query(None, description="Comma-separated portfolio ids"),
    clients: Optional[str] = Query(None),
    disciplines: Optional[str] = Query(None),
    pms: Optional[str] = Query(None),
    lookahead_days: int = Query(28, ge=7, le=120),
    trend_weeks: int = Query(26, ge=4, le=78),
    weeks: int = Query(10, ge=4, le=16, description="Capacity horizon in weeks"),
) -> Filters:
    return Filters(as_of=as_of or DEMO_AS_OF, portfolio_ids=_ints(portfolios), client_ids=_ints(clients),
                   disciplines=_strs(disciplines), pm_ids=_ints(pms), lookahead_days=lookahead_days,
                   trend_weeks=trend_weeks, capacity_weeks=weeks)


def scope_sql(f: Filters, alias: str = "pp") -> tuple[str, dict]:
    """SQL predicate selecting in-scope projects (portfolio_projects rows).

    Discipline filter at PROJECT level means "has this discipline in scope";
    row-level tables (work items, deliverables, assignments) additionally
    filter their own discipline column via `discipline_sql()`.
    """
    parts, params = ["TRUE"], {}
    if f.portfolio_ids:
        parts.append(f"{alias}.portfolio_id = ANY(:f_portfolios)")
        params["f_portfolios"] = f.portfolio_ids
    if f.client_ids:
        parts.append(f"{alias}.portfolio_id IN (SELECT id FROM projects WHERE client_id = ANY(:f_clients))")
        params["f_clients"] = f.client_ids
    if f.pm_ids:
        parts.append(f"{alias}.pm_user_id = ANY(:f_pms)")
        params["f_pms"] = f.pm_ids
    if f.disciplines:
        parts.append(f"EXISTS (SELECT 1 FROM project_disciplines pd WHERE pd.portfolio_project_id = {alias}.id "
                     f"AND pd.discipline = ANY(:f_disciplines))")
        params["f_disciplines"] = f.disciplines
    return " AND ".join(parts), params


def portfolio_scope_sql(f: Filters, alias: str = "pf") -> tuple[str, dict]:
    """Predicate for portfolio-grain tables (meetings, actions, COs attach to the
    portfolio in production). A portfolio is in scope if any of its projects is."""
    inner, params = scope_sql(f, "pp")
    if inner == "TRUE":
        return "TRUE", {}
    return f"{alias}.id IN (SELECT pp.portfolio_id FROM portfolio_projects pp WHERE {inner})", params


def discipline_sql(f: Filters, col: str) -> tuple[str, dict]:
    if not f.disciplines:
        return "TRUE", {}
    return f"{col} = ANY(:f_disciplines)", {"f_disciplines": f.disciplines}


def q(db: Session, sql: str, params: dict | None = None) -> list[dict]:
    return [dict(r._mapping) for r in db.execute(text(sql), params or {})]


def scalar(db: Session, sql: str, params: dict | None = None):
    return db.execute(text(sql), params or {}).scalar()


def pct(n, d) -> Optional[float]:
    return None if not d else round(100.0 * n / d, 1)
