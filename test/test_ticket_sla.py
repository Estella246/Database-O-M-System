"""SLA：终点 − 建单 − 挂起累计。"""
from datetime import datetime, timezone

from utils.ticket_sla import format_ticket_sla_dhm, sla_elapsed_seconds


def test_sla_excludes_completed_suspend_interval():
    """12:00 建单 → 13:00 挂起 → 14:00 解除 → 15:00 关单 = 2h。"""
    created = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    closed = datetime(2026, 1, 1, 15, 0, tzinfo=timezone.utc)
    now = datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)
    assert sla_elapsed_seconds(
        created,
        status="closed",
        closed_at=closed,
        sla_paused_seconds=3600,
        now=now,
    ) == 7200
    assert (
        format_ticket_sla_dhm(
            created, closed, "closed", sla_paused_seconds=3600, now=now
        )
        == "0天2时0分"
    )


def test_sla_while_suspended_freezes_at_suspend_point():
    """挂起中：12:00 建单、13:00 挂起，13:30 仍显示 1h。"""
    created = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    suspended = datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc)
    now = datetime(2026, 1, 1, 13, 30, tzinfo=timezone.utc)
    assert sla_elapsed_seconds(
        created,
        status="suspended",
        suspended_at=suspended,
        sla_paused_seconds=0,
        now=now,
    ) == 3600
    assert (
        format_ticket_sla_dhm(
            created,
            None,
            "suspended",
            suspended_at=suspended,
            sla_paused_seconds=0,
            now=now,
        )
        == "0天1时0分"
    )


def test_sla_open_after_resume_continues_excluding_pause():
    """14:30（已解除挂起 1h）：从 12:00 起有效 SLA = 1.5h。"""
    created = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    now = datetime(2026, 1, 1, 14, 30, tzinfo=timezone.utc)
    assert sla_elapsed_seconds(
        created,
        status="open",
        sla_paused_seconds=3600,
        now=now,
    ) == 5400
