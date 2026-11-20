"""Business-day arithmetic (Mon–Fri, US federal holidays observed).

PMO 360 keeps the same rule in frontend/src/lib/businessDays.ts and the
proposal scheduler (weekends off, holidays from a calendar). The demo inlines
the 2025–2027 holiday list so it has no extra dependency.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

HOLIDAYS = {
    # 2025
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 5, 26), date(2025, 6, 19),
    date(2025, 7, 4), date(2025, 9, 1), date(2025, 11, 27), date(2025, 11, 28),
    date(2025, 12, 25),
    # 2026
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 5, 25), date(2026, 6, 19),
    date(2026, 7, 3), date(2026, 9, 7), date(2026, 11, 26), date(2026, 11, 27),
    date(2026, 12, 25),
    # 2027
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 5, 31), date(2027, 6, 18),
    date(2027, 7, 5), date(2027, 9, 6), date(2027, 11, 25), date(2027, 11, 26),
    date(2027, 12, 24),
}


def is_business_day(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def add_business_days(d: date, n: int) -> date:
    """Move n business days from d (n may be negative). n == 0 rolls a
    non-business day forward to the next business day."""
    step = 1 if n >= 0 else -1
    if n == 0:
        while not is_business_day(d):
            d += timedelta(days=1)
        return d
    remaining = abs(n)
    while remaining:
        d += timedelta(days=step)
        if is_business_day(d):
            remaining -= 1
    return d


@lru_cache(maxsize=100_000)
def business_days_between(a: date, b: date) -> int:
    """Signed count of business days from a to b, excluding a, including b.
    business_days_between(d, d) == 0. Used for schedule variance so a slip over
    a weekend is not reported as two days late."""
    if a == b:
        return 0
    sign = 1
    if b < a:
        a, b, sign = b, a, -1
    n = 0
    d = a
    while d < b:
        d += timedelta(days=1)
        if is_business_day(d):
            n += 1
    return sign * n


def workdays_in_week_overlap(start: date, end: date, week_monday: date) -> int:
    """Mon–Fri days where [start, end] overlaps the work week beginning
    week_monday. Same rule as PMO 360 api/timeline.py::_workdays_overlap
    (which counts weekdays; holidays are handled there as time off)."""
    w_end = week_monday + timedelta(days=4)
    lo = max(start, week_monday)
    hi = min(end, w_end)
    if lo > hi:
        return 0
    cnt = 0
    d = lo
    while d <= hi:
        if d.weekday() < 5:
            cnt += 1
        d += timedelta(days=1)
    return cnt


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())
