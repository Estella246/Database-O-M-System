from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from utils.ticket_no import _CHINA_TZ


def duty_month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def parse_last_accept_at(raw: Any) -> datetime:
    txt = str(raw or "").strip()
    if not txt:
        return datetime(1970, 1, 1, tzinfo=_CHINA_TZ)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(txt, fmt)
            return dt.replace(tzinfo=_CHINA_TZ)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(txt)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=_CHINA_TZ)
        return dt.astimezone(_CHINA_TZ)
    except ValueError:
        return datetime(1970, 1, 1, tzinfo=_CHINA_TZ)


def parse_iso_dt(s: str) -> datetime:
    txt = str(s or "").strip()
    if not txt:
        raise ValueError("empty datetime string")
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(txt, fmt)
            return dt.replace(tzinfo=_CHINA_TZ)
        except ValueError:
            continue
    raise ValueError(f"cannot parse datetime: {s}")


def parse_ymd(s: str, field_name: str) -> date:
    txt = str(s or "").strip()
    if not txt:
        raise ValueError(f"{field_name} is empty")
    try:
        return date.fromisoformat(txt)
    except ValueError:
        raise ValueError(f"{field_name} must be YYYY-MM-DD")


def to_utc_start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=ZoneInfo("UTC"))