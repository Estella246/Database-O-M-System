"""轮值表派单命中时，跨轮值表同步最近接单时间（不涉及值班表）。"""
from __future__ import annotations

import os
from datetime import datetime
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="requires DATABASE_URL",
)

from database import db_conn
from routers.tickets import (
    _CHINA_TZ,
    _ROTATION_LAST_ACCEPT_RESET,
    _pick_rotation_handler,
    _reset_all_rotation_last_accept_for_account,
    _resolve_problem_fill_handler,
    _sync_all_rotation_last_accept_now_for_account,
)


class TestRotationLastAcceptSync:
    def test_pick_rotation_syncs_last_accept_across_roster_kinds(self):
        ticket_no = "YW99990604001"
        account = "sync_rot_test01"
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
                    "kernelRotation", 0, account, "同步测试01", "active", "", "pytest",
                    "controlRotation", 0, account, "同步测试01", "active", "", "pytest",
                ),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 4, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _pick_rotation_handler(
                    conn,
                    "kernelRotation",
                    ticket_no,
                    "problem_fill",
                    {"roster_kind": "kernelRotation"},
                )
            conn.commit()

            rows = conn.execute(
                """
                SELECT roster_kind, last_accept_at, last_dispatch_ticket_no
                FROM duty_rotation_entry
                WHERE account = %s
                ORDER BY roster_kind
                """,
                (account,),
            ).fetchall()

        assert handler == "同步测试01 sync_rot_test01"
        assert len(rows) == 2
        expected_ts = "2026-06-04 10:00:00"
        for row in rows:
            assert str(row["last_accept_at"]) == expected_ts
        hit_row = next(r for r in rows if r["roster_kind"] == "kernelRotation")
        other_row = next(r for r in rows if r["roster_kind"] == "controlRotation")
        assert hit_row["last_dispatch_ticket_no"] == ticket_no
        assert other_row["last_dispatch_ticket_no"] in (None, "")

    def test_pick_rotation_does_not_touch_calendar_assignment(self):
        ticket_no = "YW99990604002"
        account = "sync_rot_test02"
        duty_date = datetime(2026, 6, 4, 10, 0, tzinfo=_CHINA_TZ).date()
        with db_conn() as conn:
            conn.execute("DELETE FROM duty_rotation_entry WHERE account = %s", (account,))
            conn.execute(
                """
                DELETE FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date = %s AND shift = %s AND account = %s
                """,
                ("kernel", duty_date, "night", account),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("kernelRotation", 0, account, "同步测试02", "active", "", "pytest"),
            )
            conn.execute(
                """
                INSERT INTO duty_calendar_assignment (
                  table_kind, duty_date, shift, account, user_name, last_accept_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                ("kernel", duty_date, "night", account, "同步测试02", "2020-01-01 00:00:00"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 4, 10, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                _pick_rotation_handler(
                    conn,
                    "kernelRotation",
                    ticket_no,
                    "problem_fill",
                    {"roster_kind": "kernelRotation"},
                )
            conn.commit()

            cal = conn.execute(
                """
                SELECT last_accept_at
                FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date = %s AND shift = %s AND account = %s
                """,
                ("kernel", duty_date, "night", account),
            ).fetchone()

        assert str(cal["last_accept_at"]) == "2020-01-01 00:00:00"

    def test_problem_fill_dispatch_syncs_special_and_kernel_rotation(self):
        ticket_no = "YW99990604003"
        account = "sync_rot_test03"
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
                    "kernelRotation", 0, account, "同步测试03", "active", "", "pytest",
                    "specialSlowSql", 0, account, "同步测试03", "active", "", "pytest",
                ),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 4, 11, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"component": "内核问题"},
                )
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
        assert all(str(r["last_accept_at"]) == "2026-06-04 11:00:00" for r in rows)

    def test_reset_all_rotation_last_accept_for_account(self):
        account = "sync_rot_reset01"
        with db_conn() as conn:
            conn.execute("DELETE FROM duty_rotation_entry WHERE account = %s", (account,))
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES
                  (%s, %s, %s, %s, %s, %s, %s),
                  (%s, %s, %s, %s, %s, %s, %s),
                  (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "kernelRotation", 0, account, "重置测试01", "active", "2026-06-04 10:00:00", "pytest",
                    "controlRotation", 0, account, "重置测试01", "active", "2026-06-04 11:00:00", "pytest",
                    "specialSlowSql", 0, account, "重置测试01", "active", "2026-06-04 12:00:00", "pytest",
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

        assert len(rows) == 3
        assert _ROTATION_LAST_ACCEPT_RESET == "2000-01-01 00:00:00"
        assert all(str(r["last_accept_at"]) == _ROTATION_LAST_ACCEPT_RESET for r in rows)

    def test_sync_all_rotation_last_accept_now_for_account(self):
        account = "sync_rot_now01"
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
                    "kernelRotation", 0, account, "同步测试04", "active", "", "pytest",
                    "publicCloudRotation", 0, account, "同步测试04", "active", "", "pytest",
                ),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 4, 14, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                ts = _sync_all_rotation_last_accept_now_for_account(conn, account)
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

        assert ts == "2026-06-04 14:30:00"
        assert len(rows) == 2
        assert all(str(r["last_accept_at"]) == "2026-06-04 14:30:00" for r in rows)
