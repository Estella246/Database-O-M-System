"""工单关闭时间：取 ticket_flow_log 中最后一次 action_type='close' 的记录。"""
from __future__ import annotations

from typing import Any


def fetch_ticket_closed_at_by_id(conn: Any, ticket_ids: list[int]) -> dict[int, Any]:
    if not ticket_ids:
        return {}
    close_rows = conn.execute(
        """
        SELECT DISTINCT ON (tfl.ticket_id)
               tfl.ticket_id, tfl.created_at AS closed_at
        FROM ticket_flow_log tfl
        WHERE tfl.ticket_id = ANY(%s) AND tfl.action_type = 'close'
        ORDER BY tfl.ticket_id, tfl.created_at DESC, tfl.id DESC
        """,
        (ticket_ids,),
    ).fetchall()
    return {int(r["ticket_id"]): r["closed_at"] for r in close_rows}


def closed_at_iso(closed_at: Any) -> str | None:
    if closed_at is None:
        return None
    if hasattr(closed_at, "isoformat"):
        return closed_at.isoformat()
    s = str(closed_at).strip()
    return s or None
