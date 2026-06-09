from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

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
from utils.xiaoluban_message import send_message

logger = logging.getLogger(__name__)

_ACCOUNT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]+$")


def _extract_chinese_name(handler_display: str) -> str:
    s = str(handler_display or "").strip()
    if not s:
        return ""
    # Canonical format: "Name Account" — split by last space, account at end
    parts = s.rsplit(" ", 1)
    if len(parts) == 2 and _ACCOUNT_RE.match(parts[1]):
        return parts[0]
    # Raw format: "Account Name" or "Account+Name"
    m = _PERSON_ACCOUNT_SPACE.match(s)
    if m:
        return m.group(2).strip()
    m = _PERSON_ACCOUNT_PLUS.match(s)
    if m:
        return m.group(2).strip()
    return s


def format_reminder_message(chinese_name: str, severity: str) -> str:
    return f"@{chinese_name} 你有一条{severity}级别现网问题未处理，请及时确认！"


def _get_entered_at(conn, ticket_id: int, pr_node_id: int) -> datetime | None:
    row = conn.execute(
        """
        SELECT created_at
        FROM ticket_flow_log
        WHERE ticket_id = %s AND to_node_id = %s
        ORDER BY created_at DESC LIMIT 1
        """,
        (ticket_id, pr_node_id),
    ).fetchone()
    return row["created_at"] if row else None


def _get_current_handler(conn, ticket_id: int) -> str:
    row = conn.execute(
        """
        SELECT values_json->>'next_handler' AS next_handler
        FROM ticket_node_data
        WHERE ticket_id = %s AND values_json ? 'next_handler'
        ORDER BY created_at DESC LIMIT 1
        """,
        (ticket_id,),
    ).fetchone()
    return str(row["next_handler"] or "").strip() if row else ""


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
    conn.execute(
        """
        DELETE FROM ticket_reminder_log
        WHERE ticket_no NOT IN (
            SELECT t.ticket_no
            FROM ticket t
            JOIN workflow_node wn ON wn.id = t.current_node_id AND wn.node_key = 'problem_review'
            WHERE t.status != 'closed'
        )
        """,
    )


def check_and_send_reminders() -> None:
    try:
        with db_conn() as conn:
            # Get problem_review node id for HCS template
            node_row = conn.execute(
                """
                SELECT wn.id
                FROM workflow_node wn
                JOIN workflow_template wt ON wt.id = wn.template_id
                WHERE wn.node_key = 'problem_review' AND wt.template_code = %s
                """,
                (SCHEMA_TEMPLATE_CODE,),
            ).fetchone()
            if not node_row:
                return
            pr_node_id = node_row["id"]

            # Find tickets currently at problem_review (not closed, HCS)
            tickets = conn.execute(
                """
                SELECT t.id, t.ticket_no
                FROM ticket t
                JOIN workflow_node wn ON wn.id = t.current_node_id AND wn.node_key = 'problem_review'
                JOIN workflow_template wt ON wt.id = t.template_id AND wt.template_code = %s
                WHERE t.status != 'closed'
                """,
                (SCHEMA_TEMPLATE_CODE,),
            ).fetchall()

            now_utc = datetime.now(timezone.utc)

            for ticket in tickets:
                ticket_id = int(ticket["id"])
                ticket_no = str(ticket["ticket_no"])
                try:
                    entered_at = _get_entered_at(conn, ticket_id, pr_node_id)
                    if not entered_at:
                        continue

                    handler_display = _get_current_handler(conn, ticket_id)
                    if not handler_display:
                        continue

                    chinese_name = _extract_chinese_name(handler_display)
                    if not chinese_name:
                        continue

                    severity = _get_severity(conn, ticket_no)
                    if not severity or severity not in REMINDER_SEVERITY_MAX_COUNT:
                        continue

                    max_count = REMINDER_SEVERITY_MAX_COUNT[severity]

                    log_entry = _get_reminder_log(conn, ticket_no)
                    reminder_count = log_entry.get("reminder_count", 0) if log_entry else 0
                    stored_entered_at = log_entry.get("entered_at") if log_entry else None

                    # Reset count if ticket re-entered problem_review (new round)
                    if log_entry and stored_entered_at and entered_at != stored_entered_at:
                        reminder_count = 0

                    elapsed_minutes = (now_utc - entered_at).total_seconds() / 60
                    next_milestone = (reminder_count + 1) * REMINDER_INTERVAL_MINUTES

                    if elapsed_minutes >= next_milestone and reminder_count < max_count:
                        message = format_reminder_message(chinese_name, severity)
                        if send_message(
                            message,
                            XIAOLUBAN_GROUP_CHAT_ID,
                            context=f"reminder ticket_no={ticket_no} severity={severity}",
                        ):
                            _upsert_reminder_log(
                                conn, ticket_no, severity, entered_at,
                                reminder_count + 1, now_utc,
                            )
                            audit_log(
                                "ticket.reminder.sent",
                                ticket_no=ticket_no,
                                count=reminder_count + 1,
                                severity=severity,
                                handler=chinese_name,
                            )
                except Exception:
                    logger.exception("reminder error ticket_no=%s", ticket_no)

            _cleanup_stale_reminders(conn)
            conn.commit()
    except Exception:
        logger.exception("reminder check failed")