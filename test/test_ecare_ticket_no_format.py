"""ecare_ticket_no 格式校验单元测试（无需数据库）。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from utils.ecare_ticket_no import (
    ECARE_TICKET_NO_FORMAT_HINT,
    ecare_ticket_no_format_error,
    is_valid_ecare_ticket_no,
    sample_ecare_ticket_no,
)
from utils.validators import validate_one


@pytest.mark.parametrize(
    "value",
    [
        "12345678",
        "31234567",
        "10000000",
        "39999999",
        " 12345678 ",
    ],
)
def test_default_ecare_accepts(value):
    assert is_valid_ecare_ticket_no(value) is True
    assert is_valid_ecare_ticket_no(value, "混合云（HCS）") is True


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "22345678",
        "02345678",
        "1234567",
        "123456789",
        "1234567890",
        "12345678901234",
        "TS123",
        "sjgd001",
        "ECARE-001",
        "abc",
    ],
)
def test_default_ecare_rejects(value):
    assert is_valid_ecare_ticket_no(value) is False
    assert is_valid_ecare_ticket_no(value, "混合云（轻量化）") is False


@pytest.mark.parametrize(
    "value",
    [
        "12345678901234",
        "00000000000000",
        "1234567890",
        "0000000000",
        "TS",
        "TS-abc",
        "TSanything",
        "sjgd",
        "sjgd001",
        "sjgd-xyz",
        "  TS123  ",
    ],
)
def test_public_cloud_ecare_accepts(value):
    assert is_valid_ecare_ticket_no(value, "公有云") is True


@pytest.mark.parametrize(
    "value",
    [
        "",
        "12345678",
        "31234567",
        "123456789",
        "12345678901",
        "123456789012345",
        "ts123",
        "Ts123",
        "SJGD001",
        "sjGD001",
        "ECARE-001",
    ],
)
def test_public_cloud_ecare_rejects(value):
    assert is_valid_ecare_ticket_no(value, "公有云") is False


def test_validate_one_ecare_empty_optional():
    field = {"key": "ecare_ticket_no", "type": "text", "required": False}
    assert validate_one(field, "") is None


def test_validate_one_ecare_empty_required():
    field = {"key": "ecare_ticket_no", "type": "text", "required": True}
    assert validate_one(field, "") == "ecare_ticket_no is required"


def test_validate_one_ecare_invalid_default():
    field = {"key": "ecare_ticket_no", "type": "text", "required": True}
    assert validate_one(field, "ECARE-001", {"product_line": "混合云（HCS）"}) == ECARE_TICKET_NO_FORMAT_HINT


def test_validate_one_ecare_invalid_public_cloud():
    field = {"key": "ecare_ticket_no", "type": "text", "required": True}
    assert (
        validate_one(field, "12345678", {"product_line": "公有云"})
        == ECARE_TICKET_NO_FORMAT_HINT
    )


def test_validate_one_ecare_ok():
    field = {"key": "ecare_ticket_no", "type": "text", "required": True}
    assert validate_one(field, "12345678", {"product_line": "混合云（HCS）"}) is None
    assert validate_one(field, "TS123", {"product_line": "公有云"}) is None


def test_format_error_and_sample():
    assert ecare_ticket_no_format_error() == ECARE_TICKET_NO_FORMAT_HINT
    assert ecare_ticket_no_format_error("公有云") == ECARE_TICKET_NO_FORMAT_HINT
    assert is_valid_ecare_ticket_no(sample_ecare_ticket_no()) is True
    assert is_valid_ecare_ticket_no(sample_ecare_ticket_no("公有云"), "公有云") is True
