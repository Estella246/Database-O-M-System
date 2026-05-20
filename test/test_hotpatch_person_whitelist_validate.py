"""热补丁人员类白名单：库内为 temp /「姓名+工号」占位时，提交真实人员串须通过校验（与前端 adminUsers 注入一致）。"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from routers.tickets import _validate_one


def test_hp_person_fields_accept_real_value_when_options_are_name_id_placeholder():
    for fk in ("hp_de", "hp_se", "hp_pl", "hp_xm"):
        field = {
            "key": fk,
            "type": "whitelist",
            "required": True,
            "options": ["姓名+工号"],
        }
        assert _validate_one(field, "张三 l30030745", {}) is None


def test_next_handler_accepts_real_person_when_options_only_temp():
    field = {
        "key": "next_handler",
        "type": "whitelist",
        "required": True,
        "options": ["temp"],
        "constraints": {},
    }
    assert _validate_one(field, "李四 l40040040", {"handle_mode": "提交热补丁CCB"}) is None


def test_next_handler_accepts_any_user_when_options_from_user_account():
    field = {
        "key": "next_handler",
        "type": "whitelist",
        "required": True,
        "options": ["张三 l111", "王五 l999"],
        "constraints": {},
    }
    assert _validate_one(field, "张三 l111", {"handle_mode": "确认问题"}) is None
    assert _validate_one(field, "王五 l999", {"handle_mode": "确认问题"}) is None


def test_non_person_whitelist_still_strict():
    field = {"key": "severity", "type": "whitelist", "required": True, "options": ["一般", "严重"]}
    assert _validate_one(field, "一般", {}) is None
    assert _validate_one(field, "致命", {}) is not None
