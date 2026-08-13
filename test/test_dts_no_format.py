"""dts_no 格式校验单元测试（无需数据库）。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from utils.dts_no import dts_no_format_error, is_valid_dts_no
from utils.validators import validate_one


@pytest.mark.parametrize(
    "value",
    [
        "DTS2026082612345",
        "DTS20260826xxxxx",
        "BUG2026082612345",
        "BUG20260826xxxxx",
        "AR.SR.IR.20240101",
        "AR.SR.IR",
        "SR.IR.abc",
        "SR.IR",
        "IR123",
        "IR",
        "RR999",
        "RR",
        "  DTS20260826xxxxx  ",
    ],
)
def test_is_valid_dts_no_accepts(value):
    assert is_valid_dts_no(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "DTS202608261234",  # 总长 15
        "DTS20260826123456",  # 总长 17
        "dts2026082612345",  # 小写
        "DTS-2026082612345",  # 总长 17
        "XYZ2026082612345",
        "AR.SR",
        "SR",
        "R",
        "random",
    ],
)
def test_is_valid_dts_no_rejects(value):
    assert is_valid_dts_no(value) is False


def test_validate_one_dts_no_empty_optional():
    field = {"key": "dts_no", "type": "text", "required": False}
    assert validate_one(field, "") is None


def test_validate_one_dts_no_empty_required():
    field = {"key": "dts_no", "type": "text", "required": True}
    assert validate_one(field, "") == "dts_no is required"


def test_validate_one_dts_no_invalid():
    field = {"key": "dts_no", "type": "text", "required": False}
    assert validate_one(field, "DTS-001") == dts_no_format_error()


def test_validate_one_dts_no_ok():
    field = {"key": "dts_no", "type": "text", "required": False}
    assert validate_one(field, "DTS20260826xxxxx") is None
    assert validate_one(field, "IR20240101") is None
