"""公有云问题：问题填写提交后问题审核处理人派单规则。"""
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
    _is_public_cloud_issue,
    _resolve_problem_fill_handler,
)


class TestPublicCloudIssueDetection:
    def test_is_public_cloud_by_product_line(self):
        assert _is_public_cloud_issue({"product_line": "公有云"}) is True
        assert _is_public_cloud_issue({"product_line": "混合云（HCS）"}) is False
        assert _is_public_cloud_issue({"product_line": ""}) is False


class TestPublicCloudFillDispatch:
    def test_workday_day_uses_public_cloud_rotation(self):
        ticket_no = "YW99990520001"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("publicCloudRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("publicCloudRotation", 0, "pc_test01", "公有云测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 5, 20, 10, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"product_line": "公有云", "component": "内核问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("publicCloudRotation",),
            ).fetchone()

        assert handler == "公有云测试01 pc_test01"
        rule = row["last_dispatch_rule"]
        assert rule["roster_kind"] == "publicCloudRotation"
        assert rule["product_line"] == "公有云"
        assert rule["window"] == "workday_day"
        assert rule["target_node"] == "problem_review"

    def test_workday_night_uses_public_cloud_oncall_calendar(self):
        ticket_no = "YW99990520002"
        duty_date = datetime(2026, 5, 20, 19, 0, tzinfo=_CHINA_TZ).date()
        with db_conn() as conn:
            conn.execute(
                """
                DELETE FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date = %s AND shift = %s
                """,
                ("public_cloud", duty_date, "night"),
            )
            conn.execute(
                """
                INSERT INTO duty_calendar_assignment (
                  table_kind, duty_date, shift, account, user_name, last_accept_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                ("public_cloud", duty_date, "night", "pc_night01", "公有云夜班01", ""),
            )
            conn.commit()

            fixed_now = datetime(2026, 5, 20, 19, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"product_line": "公有云", "component": "管控问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date = %s AND shift = %s
                LIMIT 1
                """,
                ("public_cloud", duty_date, "night"),
            ).fetchone()

        assert handler == "公有云夜班01 pc_night01"
        rule = row["last_dispatch_rule"]
        assert rule["table_kind"] == "public_cloud"
        assert rule["shift"] == "night"
        assert rule["window"] == "workday_night"

    def test_non_public_cloud_still_uses_component_rotation(self):
        ticket_no = "YW99990520003"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("kernelRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("kernelRotation", 0, "kern_test01", "内核测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 5, 20, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"product_line": "混合云（HCS）", "component": "内核问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("kernelRotation",),
            ).fetchone()

        assert handler == "内核测试01 kern_test01"
        assert row["last_dispatch_rule"]["roster_kind"] == "kernelRotation"
        assert "product_line" not in row["last_dispatch_rule"]
