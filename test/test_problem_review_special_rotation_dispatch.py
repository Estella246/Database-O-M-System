"""问题审核「提交专项轮值表」派单规则。"""
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
    _resolve_problem_review_special_rotation_handler,
)


class TestProblemReviewSpecialRotationDispatch:
    def test_workday_day_dispatches_to_special_roster(self):
        ticket_no = "YW99990625001"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("specialSlowSql",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("specialSlowSql", 0, "slowsql_test01", "慢SQL测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 25, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_review_special_rotation_handler(
                    conn,
                    ticket_no,
                    "problem_review",
                    {"issue_type_judge": "慢SQL（SQL调优）"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("specialSlowSql",),
            ).fetchone()

        assert handler == "慢SQL测试01 slowsql_test01"
        rule = row["last_dispatch_rule"]
        assert rule["roster_kind"] == "specialSlowSql"
        assert rule["rule_type"] == "submit_special_rotation"
        assert rule["routing_window"] == "workday_day"
        assert rule["issue_type_judge"] == "慢SQL（SQL调优）"

    def test_workday_night_returns_empty_for_self_fallback(self):
        ticket_no = "YW99990625002"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("specialPerf",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("specialPerf", 0, "perf_test01", "性能测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 25, 19, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_review_special_rotation_handler(
                    conn,
                    ticket_no,
                    "problem_review",
                    {"issue_type_judge": "整体性能"},
                )

        assert handler == ""

    def test_workday_day_control_issue_dispatches_to_control_rotation(self):
        ticket_no = "YW99990625004"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("controlRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("controlRotation", 0, "ctrl_rot_test01", "管控轮值01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 25, 11, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_review_special_rotation_handler(
                    conn,
                    ticket_no,
                    "problem_review",
                    {"issue_type_judge": "管控问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("controlRotation",),
            ).fetchone()

        assert handler == "管控轮值01 ctrl_rot_test01"
        assert row["last_dispatch_rule"]["roster_kind"] == "controlRotation"
        assert row["last_dispatch_rule"]["issue_type_judge"] == "管控问题"
