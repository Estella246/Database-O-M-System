"""在研版本试点：问题填写提交后问题审核处理人派单规则。"""
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
    _is_research_version_pilot_issue,
    _resolve_problem_fill_handler,
)


class TestResearchVersionPilotDetection:
    def test_is_research_version_pilot_by_biz_env(self):
        assert _is_research_version_pilot_issue({"biz_env": "在研版本试点"}) is True
        assert _is_research_version_pilot_issue({"biz_env": "POC阶段"}) is False
        assert _is_research_version_pilot_issue({"biz_env": ""}) is False


class TestResearchVersionFillDispatch:
    def test_workday_day_uses_research_version_rotation(self):
        ticket_no = "YW99990621001"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("researchVersionRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("researchVersionRotation", 0, "rv_test01", "在研测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 21, 10, 30, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {"biz_env": "在研版本试点", "component": "内核问题"},
                )
            conn.commit()

            row = conn.execute(
                """
                SELECT last_dispatch_rule
                FROM duty_rotation_entry
                WHERE roster_kind = %s AND position = 0
                """,
                ("researchVersionRotation",),
            ).fetchone()

        assert handler == "在研测试01 rv_test01"
        rule = row["last_dispatch_rule"]
        assert rule["roster_kind"] == "researchVersionRotation"
        assert rule["biz_env"] == "在研版本试点"
        assert rule["window"] == "workday_day"

    def test_poc_stage_takes_priority_over_research_version_pilot(self):
        ticket_no = "YW99990621002"
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

            fixed_now = datetime(2026, 6, 21, 10, 0, tzinfo=_CHINA_TZ)
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
        assert row["last_dispatch_rule"]["roster_kind"] == "pocRotation"

    def test_research_version_pilot_takes_priority_over_public_cloud(self):
        ticket_no = "YW99990621003"
        with db_conn() as conn:
            conn.execute(
                "DELETE FROM duty_rotation_entry WHERE roster_kind = %s",
                ("researchVersionRotation",),
            )
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("researchVersionRotation", 0, "rv_test01", "在研测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 21, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {
                        "product_line": "公有云",
                        "biz_env": "在研版本试点",
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
                ("researchVersionRotation",),
            ).fetchone()

        assert handler == "在研测试01 rv_test01"
        assert row["last_dispatch_rule"]["roster_kind"] == "researchVersionRotation"

    def test_research_version_pilot_takes_priority_over_poc_and_public_cloud(self):
        """问题阶段为在研版本试点时，即使同时填 POC/公有云相关字段也不改走 POC/公有云表。"""
        ticket_no = "YW99990621004"
        with db_conn() as conn:
            for kind in ("researchVersionRotation", "pocRotation", "publicCloudRotation"):
                conn.execute("DELETE FROM duty_rotation_entry WHERE roster_kind = %s", (kind,))
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                ("researchVersionRotation", 0, "rv_test01", "在研测试01", "active", "", "pytest"),
            )
            conn.commit()

            fixed_now = datetime(2026, 6, 21, 10, 0, tzinfo=_CHINA_TZ)
            with patch("routers.tickets.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_now
                handler = _resolve_problem_fill_handler(
                    conn,
                    ticket_no,
                    "problem_fill",
                    {
                        "product_line": "公有云",
                        "biz_env": "在研版本试点",
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
                ("researchVersionRotation",),
            ).fetchone()

        assert handler == "在研测试01 rv_test01"
        assert row["last_dispatch_rule"]["roster_kind"] == "researchVersionRotation"
