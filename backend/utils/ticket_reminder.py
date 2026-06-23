"""问题审核催办定时任务。

调度入口：app 启动时注册 APScheduler 间隔任务，调用 check_and_send_reminders。

单轮流程：
1. 扫描 HCS 模板下当前停在「问题审核」且未终态关闭的工单
2. 逐单收集 SLA 起点、处理人、严重性、已催办次数，判定是否应发送
3. 发送成功后写入 ticket_reminder_log 并记 audit 日志
4. 清理已离开问题审核节点的 ticket_reminder_log 残留

SLA 规则（REMINDER_INTERVAL_MINUTES=15）：
- 一般：15 分钟后 1 次
- 严重：15 / 30 / 45 分钟各 1 次
- 致命：每 15 分钟 1 次，上限 10 次

不计入 SLA 起点：comment=历史数据迁入 的流转（存量迁入重建日志）。
过期不补发：从未催办且已超过该严重性 SLA 窗口 + 1 个间隔。
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from config import (
    SCHEMA_TEMPLATE_CODE,
    REMINDER_INTERVAL_MINUTES,
    REMINDER_SEVERITY_MAX_COUNT,
    XIAOLUBAN_GROUP_CHAT_ID,
    _PERSON_ACCOUNT_SPACE,
    _PERSON_ACCOUNT_PLUS,
)
from database import db_conn
from utils.logging_config import audit_log
from utils.ticket_status import sql_ticket_status_is_closed
from utils.xiaoluban_message import send_message

logger = logging.getLogger(__name__)

# 与 legacy_migration 写入 ticket_flow_log.comment 一致；迁入重建的流转不计入催办 SLA。
LEGACY_MIGRATION_FLOW_COMMENT = "历史数据迁入"

_ACCOUNT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]+$")


@dataclass(frozen=True)
class _ReminderCandidate:
    ticket_id: int
    ticket_no: str
    entered_at: datetime
    chinese_name: str
    severity: str
    reminder_count: int


@dataclass(frozen=True)
class _ReminderDecision:
    should_send: bool
    reminder_count: int


def _extract_chinese_name(handler_display: str) -> str:
    s = str(handler_display or "").strip()
    if not s:
        return ""
    parts = s.rsplit(" ", 1)
    if len(parts) == 2 and _ACCOUNT_RE.match(parts[1]):
        return parts[0]
    m = _PERSON_ACCOUNT_SPACE.match(s)
    if m:
        return m.group(2).strip()
    m = _PERSON_ACCOUNT_PLUS.match(s)
    if m:
        return m.group(2).strip()
    return s


def format_reminder_message(chinese_name: str, severity: str) -> str:
    return f"@{chinese_name} 你有一条{severity}级别现网问题未处理，请及时确认！"


def _max_reminder_elapsed_minutes(severity: str) -> int:
    max_count = REMINDER_SEVERITY_MAX_COUNT.get(severity, 0)
    return max_count * REMINDER_INTERVAL_MINUTES


def _effective_reminder_count(
    log_entry: dict[str, Any] | None,
    entered_at: datetime,
) -> int:
    """取有效催办次数；若工单重新进入问题审核则归零。"""
    if not log_entry:
        return 0
    stored_entered_at = log_entry.get("entered_at")
    if stored_entered_at and entered_at != stored_entered_at:
        return 0
    return int(log_entry.get("reminder_count") or 0)


def _evaluate_reminder(
    *,
    severity: str,
    reminder_count: int,
    elapsed_minutes: float,
) -> _ReminderDecision | None:
    """判定是否发送催办；严重性不在配置内时返回 None。"""
    if severity not in REMINDER_SEVERITY_MAX_COUNT:
        return None

    max_count = REMINDER_SEVERITY_MAX_COUNT[severity]
    stale_skip_after = _max_reminder_elapsed_minutes(severity) + REMINDER_INTERVAL_MINUTES
    if reminder_count == 0 and elapsed_minutes > stale_skip_after:
        return _ReminderDecision(should_send=False, reminder_count=reminder_count)

    next_milestone = (reminder_count + 1) * REMINDER_INTERVAL_MINUTES
    should_send = elapsed_minutes >= next_milestone and reminder_count < max_count
    return _ReminderDecision(should_send=should_send, reminder_count=reminder_count)


def _get_problem_review_node_id(conn) -> int | None:
    row = conn.execute(
        """
        SELECT wn.id
        FROM workflow_node wn
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wn.node_key = 'problem_review' AND wt.template_code = %s
        """,
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    return int(row["id"]) if row else None


def _list_problem_review_tickets(conn) -> list[dict[str, Any]]:
    closed_expr = sql_ticket_status_is_closed("t.status")
    return conn.execute(
        f"""
        SELECT t.id, t.ticket_no
        FROM ticket t
        JOIN workflow_node wn ON wn.id = t.current_node_id AND wn.node_key = 'problem_review'
        JOIN workflow_template wt ON wt.id = t.template_id AND wt.template_code = %s
        WHERE NOT ({closed_expr})
        """,
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchall()


def _get_entered_at(conn, ticket_id: int, pr_node_id: int) -> datetime | None:
    row = conn.execute(
        """
        SELECT created_at
        FROM ticket_flow_log
        WHERE ticket_id = %s AND to_node_id = %s
          AND COALESCE(comment, '') <> %s
        ORDER BY created_at DESC LIMIT 1
        """,
        (ticket_id, pr_node_id, LEGACY_MIGRATION_FLOW_COMMENT),
    ).fetchone()
    return row["created_at"] if row else None


def _get_current_handler(conn, ticket_id: int) -> str:
    row = conn.execute(
        """
        SELECT current_node_id
        FROM ticket
        WHERE id = %s
        """,
        (ticket_id,),
    ).fetchone()
    if not row or row.get("current_node_id") is None:
        return ""
    from routers.tickets import _resolve_ticket_open_handler_display

    return _resolve_ticket_open_handler_display(conn, ticket_id, int(row["current_node_id"]))


def _get_severity(conn, ticket_no: str) -> str:
    row = conn.execute(
        """
        SELECT tnd.values_json->>'severity' AS severity
        FROM ticket t
        JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
        JOIN workflow_template wt ON wt.id = wn.template_id AND wt.template_code = %s
        WHERE t.ticket_no = %s
        ORDER BY tnd.created_at DESC LIMIT 1
        """,
        (SCHEMA_TEMPLATE_CODE, ticket_no),
    ).fetchone()
    return str(row["severity"] or "").strip() if row else ""


def _get_reminder_log(conn, ticket_no: str) -> dict | None:
    row = conn.execute(
        """
        SELECT severity, entered_at, reminder_count, last_reminded_at
        FROM ticket_reminder_log
        WHERE ticket_no = %s
        """,
        (ticket_no,),
    ).fetchone()
    return dict(row) if row else None


def _upsert_reminder_log(
    conn,
    ticket_no: str,
    severity: str,
    entered_at: datetime,
    reminder_count: int,
    last_reminded_at: datetime,
) -> None:
    existing = conn.execute(
        "SELECT id FROM ticket_reminder_log WHERE ticket_no = %s",
        (ticket_no,),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE ticket_reminder_log
            SET severity = %s, entered_at = %s, reminder_count = %s, last_reminded_at = %s
            WHERE ticket_no = %s
            """,
            (severity, entered_at, reminder_count, last_reminded_at, ticket_no),
        )
    else:
        conn.execute(
            """
            INSERT INTO ticket_reminder_log (ticket_no, severity, entered_at, reminder_count, last_reminded_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (ticket_no, severity, entered_at, reminder_count, last_reminded_at),
        )


def _cleanup_stale_reminders(conn) -> None:
    closed_expr = sql_ticket_status_is_closed("t.status")
    conn.execute(
        f"""
        DELETE FROM ticket_reminder_log
        WHERE ticket_no NOT IN (
            SELECT t.ticket_no
            FROM ticket t
            JOIN workflow_node wn ON wn.id = t.current_node_id AND wn.node_key = 'problem_review'
            WHERE NOT ({closed_expr})
        )
        """,
    )


def _build_reminder_candidate(
    conn,
    ticket: dict[str, Any],
    *,
    pr_node_id: int,
    now_utc: datetime,
) -> _ReminderCandidate | None:
    ticket_id = int(ticket["id"])
    ticket_no = str(ticket["ticket_no"])

    entered_at = _get_entered_at(conn, ticket_id, pr_node_id)
    if not entered_at:
        return None

    handler_display = _get_current_handler(conn, ticket_id)
    if not handler_display:
        return None

    chinese_name = _extract_chinese_name(handler_display)
    if not chinese_name:
        return None

    severity = _get_severity(conn, ticket_no)
    if not severity:
        return None

    log_entry = _get_reminder_log(conn, ticket_no)
    reminder_count = _effective_reminder_count(log_entry, entered_at)
    elapsed_minutes = (now_utc - entered_at).total_seconds() / 60
    decision = _evaluate_reminder(
        severity=severity,
        reminder_count=reminder_count,
        elapsed_minutes=elapsed_minutes,
    )
    if decision is None or not decision.should_send:
        return None

    return _ReminderCandidate(
        ticket_id=ticket_id,
        ticket_no=ticket_no,
        entered_at=entered_at,
        chinese_name=chinese_name,
        severity=severity,
        reminder_count=decision.reminder_count,
    )


def _send_reminder(conn, candidate: _ReminderCandidate, now_utc: datetime) -> None:
    message = format_reminder_message(candidate.chinese_name, candidate.severity)
    next_count = candidate.reminder_count + 1
    if not send_message(
        message,
        XIAOLUBAN_GROUP_CHAT_ID,
        context=f"reminder ticket_no={candidate.ticket_no} severity={candidate.severity}",
    ):
        return

    _upsert_reminder_log(
        conn,
        candidate.ticket_no,
        candidate.severity,
        candidate.entered_at,
        next_count,
        now_utc,
    )
    audit_log(
        "ticket.reminder.sent",
        ticket_no=candidate.ticket_no,
        count=next_count,
        severity=candidate.severity,
        handler=candidate.chinese_name,
    )


def _process_ticket(
    conn,
    ticket: dict[str, Any],
    *,
    pr_node_id: int,
    now_utc: datetime,
) -> None:
    ticket_no = str(ticket.get("ticket_no") or "")
    try:
        candidate = _build_reminder_candidate(
            conn, ticket, pr_node_id=pr_node_id, now_utc=now_utc,
        )
        if candidate is None:
            return
        _send_reminder(conn, candidate, now_utc)
    except Exception:
        logger.exception("reminder error ticket_no=%s", ticket_no)


def check_and_send_reminders() -> None:
    try:
        with db_conn() as conn:
            pr_node_id = _get_problem_review_node_id(conn)
            if pr_node_id is None:
                return

            now_utc = datetime.now(timezone.utc)
            for ticket in _list_problem_review_tickets(conn):
                _process_ticket(conn, ticket, pr_node_id=pr_node_id, now_utc=now_utc)

            _cleanup_stale_reminders(conn)
            conn.commit()
    except Exception:
        logger.exception("reminder check failed")
