"""工单关闭时间工具单测。"""
from __future__ import annotations

from utils.ticket_closed_at import closed_at_iso


def test_closed_at_iso_none():
    assert closed_at_iso(None) is None


def test_closed_at_iso_datetime():
    from datetime import datetime, timezone

    dt = datetime(2026, 4, 1, 8, 30, tzinfo=timezone.utc)
    assert closed_at_iso(dt) == dt.isoformat()
