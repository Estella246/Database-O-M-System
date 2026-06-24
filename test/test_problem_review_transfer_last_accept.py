"""问题审核转办时轮值表接单时间公平性同步。"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="requires DATABASE_URL",
)

from database import db_conn
from config import SCHEMA_TEMPLATE_CODE
from routers.tickets import (
    _CHINA_TZ,
    _ROTATION_LAST_ACCEPT_RESET,
    _maybe_sync_problem_review_transfer_rotation_fairness,
    _reset_all_rotation_last_accept_for_account,
    _sync_all_rotation_last_accept_now_for_account,
    _ticket_arrived_workday_day,
)


def _ensure_workflow_nodes(conn) -> tuple[int, int]:
    fill = conn.execute(
        """
        SELECT wn.id
        FROM workflow_node wn
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s AND wn.node_key = 'problem_fill'
        LIMIT 1
        """,
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    review = conn.execute(
        """
        SELECT wn.id
        FROM workflow_node wn
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s AND wn.node_key = 'problem_review'
        LIMIT 1
        """,
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    assert fill and review
    return int(fill["id"]), int(review["id"])


def _seed_ticket_with_problem_review_entry(
    conn,
    *,
    ticket_no: str,
    entered_at: datetime,
    current_handler_name: str,
    current_handler_id: str,
) -> int:
    fill_node_id, review_node_id = _ensure_workflow_nodes(conn)
    conn.execute(
        """
        DELETE FROM ticket_flow_log
        WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no = %s)
        """,
        (ticket_no,),
    )
    conn.execute(
        """
        DELETE FROM ticket_node_instance
        WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no = %s)
        """,
        (ticket_no,),
    )
    conn.execute("DELETE FROM ticket WHERE ticket_no = %s", (ticket_no,))
    ticket = conn.execute(
        """
        INSERT INTO ticket (ticket_no, template_id, title, current_node_id, status, creator_id, creator_name)
        VALUES (%s, 1, %s, %s, 'open', %s, %s)
        RETURNING id
        """,
        (ticket_no, ticket_no, review_node_id, current_handler_id, current_handler_name),
    ).fetchone()
    ticket_id = int(ticket["id"])
    conn.execute(
        """
        INSERT INTO ticket_flow_log (
          ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at
        ) VALUES (%s, %s, %s, 'submit', %s, %s, '', %s)
        """,
        (ticket_id, fill_node_id, review_node_id, current_handler_id, current_handler_name, entered_at),
    )
    conn.execute(
        """
        INSERT INTO ticket_node_instance (
          ticket_id, node_id, handler_id, handler_name, action_status
        ) VALUES (%s, %s, %s, %s, 'processing')
        """,
        (ticket_id, review_node_id, current_handler_id, current_handler_name),
    )
    return ticket_id


class TestProblemReviewTransferLastAccept:
    def test_reset_all_rotation_last_accept_for_account(self):
        account = "pr_transfer_reset01"
        with db_conn() as conn:
            conn.execute("DELETE FROM duty_rotation_entry WHERE account = %s", (account,))
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES
                  (%s, %s, %s, %s, %s, %s, %s),
                  (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "kernelRotation", 0, account, "转出测试01", "active", "2026-06-04 10:00:00", "pytest",
                    "controlRotation", 0, account, "转出测试01", "active", "2026-06-04 11:00:00", "pytest",
                ),
            )
            conn.commit()

            _reset_all_rotation_last_accept_for_account(conn, account)
            conn.commit()

            rows = conn.execute(
                """
                SELECT roster_kind, last_accept_at
                FROM duty_rotation_entry
                WHERE account = %s
                ORDER BY roster_kind
                """,
                (account,),
            ).fetchall()

        assert len(rows) == 2
        assert all(str(r["last_accept_at"]) == _ROTATION_LAST_ACCEPT_RESET for r in rows)

    def test_sync_all_rotation_last_accept_now_for_account(self):
        account = "pr_transfer_now01"
        with db_conn() as conn:
            conn.execute("DELETE FROM duty_rotation_entry WHERE account = %s", (account,))
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES
                  (%s, %s, %s, %s, %s, %s, %s),
                  (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "kernelRotation", 0, account, "接手测试01", "active", "", "pytest",
                    "specialSlowSql", 0, account, "接手测试01", "active", "", "pytest",
                ),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 24, 10, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                ts = _sync_all_rotation_last_accept_now_for_account(conn, account)
            conn.commit()

            rows = conn.execute(
                """
                SELECT last_accept_at
                FROM duty_rotation_entry
                WHERE account = %s
                """,
                (account,),
            ).fetchall()

        assert ts == "2026-06-24 10:30:00"
        assert all(str(r["last_accept_at"]) == "2026-06-24 10:30:00" for r in rows)

    def test_maybe_sync_on_workday_day_transfer_to_other(self):
        ticket_no = "YW99990624001"
        from_account = "pr_transfer_from01"
        to_account = "pr_transfer_to01"
        entered_at = datetime(2026, 6, 24, 2, 0, tzinfo=timezone.utc)
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE account IN (%s, %s)",
                (from_account, to_account),
            )
            for acct, name, ts in (
                (from_account, "转出A", "2026-06-24 09:00:00"),
                (to_account, "接手B", "2026-06-24 08:00:00"),
            ):
                conn.execute(
                    """
                    INSERT INTO duty_rotation_entry (
                      roster_kind, position, account, user_name, status, last_accept_at, updated_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    ("kernelRotation", 0, acct, name, "active", ts, "pytest"),
                )
            _, review_node_id = _ensure_workflow_nodes(conn)
            ticket_id = _seed_ticket_with_problem_review_entry(
                conn,
                ticket_no=ticket_no,
                entered_at=entered_at,
                current_handler_name=f"转出A {from_account}",
                current_handler_id=from_account,
            )
            conn.commit()

            assert _ticket_arrived_workday_day(conn, ticket_id) is True

            fixed_now = datetime(2026, 6, 24, 11, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                _maybe_sync_problem_review_transfer_rotation_fairness(
                    conn,
                    ticket_internal_id=ticket_id,
                    current_node_id=review_node_id,
                    handle_mode="提交其他运维审核",
                    next_handler_display=f"接手B {to_account}",
                )
            conn.commit()

            from_row = conn.execute(
                "SELECT last_accept_at FROM duty_rotation_entry WHERE account = %s",
                (from_account,),
            ).fetchone()
            to_row = conn.execute(
                "SELECT last_accept_at FROM duty_rotation_entry WHERE account = %s",
                (to_account,),
            ).fetchone()

        assert str(from_row["last_accept_at"]) == _ROTATION_LAST_ACCEPT_RESET
        assert str(to_row["last_accept_at"]) == "2026-06-24 11:00:00"

    def test_maybe_sync_skips_when_same_person(self):
        ticket_no = "YW99990624002"
        account = "pr_transfer_same01"
        entered_at = datetime(2026, 6, 24, 2, 0, tzinfo=timezone.utc)
        with db_conn() as conn:
            conn.execute("DELETE FROM duty_rotation_entry WHERE account = %s", (account,))
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("kernelRotation", 0, account, "同人", "active", "2026-06-24 09:00:00", "pytest"),
            )
            _, review_node_id = _ensure_workflow_nodes(conn)
            ticket_id = _seed_ticket_with_problem_review_entry(
                conn,
                ticket_no=ticket_no,
                entered_at=entered_at,
                current_handler_name=f"同人 {account}",
                current_handler_id=account,
            )
            conn.commit()

            _maybe_sync_problem_review_transfer_rotation_fairness(
                conn,
                ticket_internal_id=ticket_id,
                current_node_id=review_node_id,
                handle_mode="提交专项轮值表",
                next_handler_display=f"同人 {account}",
            )
            conn.commit()

            row = conn.execute(
                "SELECT last_accept_at FROM duty_rotation_entry WHERE account = %s",
                (account,),
            ).fetchone()

        assert str(row["last_accept_at"]) == "2026-06-24 09:00:00"

    def test_maybe_sync_skips_when_ticket_arrived_workday_night(self):
        ticket_no = "YW99990624003"
        from_account = "pr_transfer_night_from"
        to_account = "pr_transfer_night_to"
        entered_at = datetime(2026, 6, 24, 12, 0, tzinfo=timezone.utc)
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE account IN (%s, %s)",
                (from_account, to_account),
            )
            for acct, name, ts in (
                (from_account, "夜单转出", "2026-06-24 19:00:00"),
                (to_account, "夜单接手", "2026-06-24 18:00:00"),
            ):
                conn.execute(
                    """
                    INSERT INTO duty_rotation_entry (
                      roster_kind, position, account, user_name, status, last_accept_at, updated_by
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    ("kernelRotation", 0, acct, name, "active", ts, "pytest"),
                )
            _, review_node_id = _ensure_workflow_nodes(conn)
            ticket_id = _seed_ticket_with_problem_review_entry(
                conn,
                ticket_no=ticket_no,
                entered_at=entered_at,
                current_handler_name=f"夜单转出 {from_account}",
                current_handler_id=from_account,
            )
            conn.commit()

            assert _ticket_arrived_workday_day(conn, ticket_id) is False

            _maybe_sync_problem_review_transfer_rotation_fairness(
                conn,
                ticket_internal_id=ticket_id,
                current_node_id=review_node_id,
                handle_mode="提交其他运维审核",
                next_handler_display=f"夜单接手 {to_account}",
            )
            conn.commit()

            rows = conn.execute(
                """
                SELECT account, last_accept_at
                FROM duty_rotation_entry
                WHERE account IN (%s, %s)
                ORDER BY account
                """,
                (from_account, to_account),
            ).fetchall()

        assert str(rows[0]["last_accept_at"]) == "2026-06-24 19:00:00"
        assert str(rows[1]["last_accept_at"]) == "2026-06-24 18:00:00"
