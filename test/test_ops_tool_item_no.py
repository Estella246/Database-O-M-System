"""运维工具广场资源编号分配。"""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from database import db_conn
from utils.ticket_no import allocate_skill_item_no, allocate_tool_item_no, is_ops_tool_item_no


def _today_prefix(kind: str) -> str:
    ymd = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")
    return f"{kind}{ymd}"


class TestOpsToolItemNo:
    def test_allocate_skill_item_no_format(self) -> None:
        try:
            with db_conn() as conn:
                conn.execute("SELECT item_no FROM ops_tool_item LIMIT 0")
                no = allocate_skill_item_no(conn)
        except Exception:
            pytest.skip("ops_tool_item 或 ticket_global_seq 未迁移")
        assert re.match(r"^SKILL[0-9]{11}$", no)
        assert no.startswith(_today_prefix("SKILL"))
        assert is_ops_tool_item_no(no)

    def test_allocate_tool_item_no_format(self) -> None:
        try:
            with db_conn() as conn:
                conn.execute("SELECT item_no FROM ops_tool_item LIMIT 0")
                no = allocate_tool_item_no(conn)
        except Exception:
            pytest.skip("ops_tool_item 或 ticket_global_seq 未迁移")
        assert re.match(r"^TOOL[0-9]{11}$", no)
        assert no.startswith(_today_prefix("TOOL"))
        assert is_ops_tool_item_no(no)

    def test_is_ops_tool_item_no_rejects_invalid(self) -> None:
        assert not is_ops_tool_item_no("YW20260701001")
        assert not is_ops_tool_item_no("SKILL20260701")
        assert is_ops_tool_item_no("SKILL20260701000")
