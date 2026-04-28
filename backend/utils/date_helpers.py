from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException

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
    raw = str(s or "").strip().replace("Z", "+00:00")
    if not raw:
        raise HTTPException(status_code=400, detail="时间不能为空")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"时间格式无效: {s}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_ymd(s: str, field_name: str) -> date:
    raw = str(s or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"{field_name} 不能为空")
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} 格式无效，应为 YYYY-MM-DD") from exc


def to_utc_start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)