"""工单 status 判定：兼容新平台三态与迁入后的老平台中文状态。"""
from __future__ import annotations

from typing import Any

LEGACY_CLOSED_STATUSES: frozenset[str] = frozenset(
    {"关闭", "完成", "非问题关闭", "已关闭", "问题审核关闭"}
)


def ticket_status_is_closed(status: Any) -> bool:
    s = str(status or "").strip()
    if s.lower() == "closed":
        return True
    return s in LEGACY_CLOSED_STATUSES


def sql_ticket_status_is_closed(status_expr: str = "t.status") -> str:
    """返回 SQL 布尔表达式：给定 status 列是否为终态（closed 或老库中文关闭态）。"""
    quoted = ", ".join(f"'{s}'" for s in sorted(LEGACY_CLOSED_STATUSES))
    return (
        f"(LOWER(TRIM(COALESCE({status_expr}, ''))) = 'closed' "
        f"OR TRIM(COALESCE({status_expr}, '')) IN ({quoted}))"
    )
