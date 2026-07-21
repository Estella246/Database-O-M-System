"""工单列表/导出 SLA：终点 − 建单 − 挂起累计（含当前挂起段）。"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from utils.ticket_status import ticket_status_is_closed, ticket_status_is_temporary_suspended


def _as_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return None


def sla_elapsed_seconds(
    created_at: Any,
    *,
    status: str,
    closed_at: Any = None,
    suspended_at: Any = None,
    sla_paused_seconds: int = 0,
    now: datetime | None = None,
) -> int | None:
    """返回有效 SLA 秒数；无可靠建单时间时返回 None。"""
    start = _as_dt(created_at)
    if start is None:
        return None
    now_dt = now or datetime.now(timezone.utc)
    if ticket_status_is_closed(status):
        end = _as_dt(closed_at) or now_dt
    else:
        end = now_dt
    paused = max(0, int(sla_paused_seconds or 0))
    if ticket_status_is_temporary_suspended(status):
        sus = _as_dt(suspended_at)
        if sus is not None:
            paused += max(0, int((end - sus).total_seconds()))
    return max(0, int((end - start).total_seconds()) - paused)


def format_sla_dhm_seconds(delta_sec: int | None) -> str:
    if delta_sec is None:
        return "--"
    minutes_total = int(delta_sec // 60)
    days = minutes_total // (60 * 24)
    hours = (minutes_total % (60 * 24)) // 60
    minutes = minutes_total % 60
    return f"{days}天{hours}时{minutes}分"


def format_ticket_sla_dhm(
    created_at: Any,
    closed_at: Any,
    status: str,
    *,
    suspended_at: Any = None,
    sla_paused_seconds: int = 0,
    now: datetime | None = None,
) -> str:
    return format_sla_dhm_seconds(
        sla_elapsed_seconds(
            created_at,
            status=status,
            closed_at=closed_at,
            suspended_at=suspended_at,
            sla_paused_seconds=sla_paused_seconds,
            now=now,
        )
    )


def fetch_ticket_sla_pause_by_id(conn: Any, ticket_ids: list[int]) -> dict[int, dict[str, Any]]:
    """返回 {ticket_id: {suspended_at, sla_paused_seconds}}。"""
    if not ticket_ids:
        return {}
    rows = conn.execute(
        """
        SELECT id,
               suspended_at,
               COALESCE(sla_paused_seconds, 0) AS sla_paused_seconds
        FROM ticket
        WHERE id = ANY(%s)
        """,
        (ticket_ids,),
    ).fetchall()
    return {
        int(r["id"]): {
            "suspended_at": r["suspended_at"],
            "sla_paused_seconds": int(r["sla_paused_seconds"] or 0),
        }
        for r in rows
    }
