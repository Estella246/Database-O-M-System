"""工单白名单字段提交校验：仅校验必填与字符串类型，不限制取值必须在选项列表内。"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from routers.tickets import _validate_one


def test_whitelist_person_field_accepts_any_non_empty_string():
    for fk in ("hp_de", "next_handler", "collaborator"):
        field = {
            "key": fk,
            "type": "whitelist",
            "required": True,
            "options": ["temp"],
        }
        assert _validate_one(field, "张三 l30030745", {}) is None


def test_whitelist_non_person_field_accepts_value_not_in_options():
    field = {
        "key": "root_cause_category",
        "type": "whitelist",
        "required": True,
        "options": ["配置类", "代码类"],
    }
    assert _validate_one(field, "自定义根因", {}) is None


def test_whitelist_cascade_field_accepts_custom_path():
    field = {
        "key": "issue_intro_module",
        "type": "whitelist",
        "required": True,
        "cascade_options": [{"label": "a", "children": [{"label": "b", "children": []}]}],
    }
    assert _validate_one(field, "x/y/z", {}) is None


def test_whitelist_still_requires_value_when_required():
    field = {"key": "severity", "type": "whitelist", "required": True, "options": ["一般", "严重"]}
    assert _validate_one(field, "", {}) == "severity is required"
    assert _validate_one(field, None, {}) == "severity is required"
