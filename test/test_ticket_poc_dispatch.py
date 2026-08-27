"""POC 阶段问题：问题填写提交后问题审核处理人派单规则。"""
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
    _is_poc_stage_issue,
    _resolve_problem_fill_handler,
)


class TestPocStageIssueDetection:
    def test_is_poc_stage_by_biz_env(self):
        assert _is_poc_stage_issue({"biz_env": "POC阶段"}) is True
        assert _is_poc_stage_issue({"biz_env": "运维阶段"}) is False
        assert _is_poc_stage_issue({"biz_env": "生产环境"}) is False
        assert _is_poc_stage_issue({"biz_env": ""}) is False


class TestPocFillDispatch:
    def test_workday_day_uses_poc_rotation(self):
        ticket_no = "YW99990620001"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("pocRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("pocRotation", 0, "poc_test01", "POC测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 20, 10, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"biz_env": "POC阶段", "component": "内核问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("pocRotation",),
            ).fetchone()

        assert handler == "POC测试01 poc_test01"
        rule = row["last_dispatch_rule"]
        assert rule["roster_kind"] == "pocRotation"
        assert rule["biz_env"] == "POC阶段"
        assert rule["window"] == "workday_day"
        assert rule["target_node"] == "problem_review"

    def test_workday_night_uses_poc_oncall_calendar(self):
        ticket_no = "YW99990620002"
        duty_date = datetime(2026, 6, 20, 19, 0, tzinfo=_CHINA_TZ).date()
        with db_conn() as conn:
            conn.execute(
                """
                DELETE FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date = %s AND shift = %s
                """,
                ("poc", duty_date, "night"),
            )
            conn.execute(
                """
                INSERT INTO duty_calendar_assignment (
                  table_kind, duty_date, shift, account, user_name, last_accept_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                ("poc", duty_date, "night", "poc_night01", "POC夜班01", ""),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 20, 19, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"biz_env": "POC阶段", "component": "管控问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date = %s AND shift = %s
                LIMIT 1
                """,
                ("poc", duty_date, "night"),
            ).fetchone()

        assert handler == "POC夜班01 poc_night01"
        rule = row["last_dispatch_rule"]
        assert rule["table_kind"] == "poc"
        assert rule["shift"] == "night"
        assert rule["window"] == "workday_night"

    def test_non_poc_stage_still_uses_component_rotation(self):
        ticket_no = "YW99990620003"
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

            fixed_now = datetime(2026, 6, 20, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"biz_env": "运维阶段", "problem_env": "生产环境", "component": "内核问题"},
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
        assert "biz_env" not in row["last_dispatch_rule"]

    def test_poc_stage_takes_priority_over_public_cloud(self):
        ticket_no = "YW99990620004"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("pocRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("pocRotation", 0, "poc_test01", "POC测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 20, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {
                        "product_line": "公有云",
                        "biz_env": "POC阶段",
                        "component": "内核问题",
                    },
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("pocRotation",),
            ).fetchone()

        assert handler == "POC测试01 poc_test01"
        assert row["last_dispatch_rule"]["roster_kind"] == "pocRotation"
