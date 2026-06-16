"""工单 status 判定：兼容新平台三态与迁入后的老平台中文状态。"""
from __future__ import annotations

from typing import Any

# 「问题审核关闭」是老库节点名/在审阶段状态，表示停在审核关闭节点待终态关闭，非终态。
LEGACY_AUDIT_CLOSE_PENDING_STATUS = "问题审核关闭"

LEGACY_CLOSED_STATUSES: frozenset[str] = frozenset(
    {"关闭", "完成", "非问题关闭", "已关闭"}
)

# 迁入流转日志 action=close：仅老库 status 为「关闭」「非问题关闭」时写入（非问题审核关闭等中间态）。
LEGACY_CLOSE_FLOW_LOG_STATUSES: frozenset[str] = frozenset({"关闭", "非问题关闭"})


def ticket_status_is_audit_close_pending(status: Any) -> bool:
    """老库 status=问题审核关闭：工单停在审核关闭节点，尚未终态关闭。"""
    return str(status or "").strip() == LEGACY_AUDIT_CLOSE_PENDING_STATUS


def ticket_status_is_closed(status: Any) -> bool:
    s = str(status or "").strip()
    if s.lower() == "closed":
        return True
    return s in LEGACY_CLOSED_STATUSES


def ticket_status_writes_close_flow_log(status: Any) -> bool:
    """迁入/重建时是否应在审核关闭节点写入 flow_log.close。"""
    s = str(status or "").strip()
    if s.lower() == "closed":
        return True
    return s in LEGACY_CLOSE_FLOW_LOG_STATUSES


def sql_ticket_status_is_closed(status_expr: str = "t.status") -> str:
    """返回 SQL 布尔表达式：给定 status 列是否为终态（closed 或老库中文关闭态）。"""
    quoted = ", ".join(f"'{s}'" for s in sorted(LEGACY_CLOSED_STATUSES))
    return (
        f"(LOWER(TRIM(COALESCE({status_expr}, ''))) = 'closed' "
        f"OR TRIM(COALESCE({status_expr}, '')) IN ({quoted}))"
    )
