"""问题填写「改进建议」字段：选填，流转日志出现过运维闭环才可见。"""
from __future__ import annotations

from utils.validators import FLOW_VISIT_CONTEXT_KEY, field_visible, flow_visited_contains


FIELD = {
    "key": "improvement_suggestion",
    "type": "richtext",
    "required": False,
    "constraints": {"visible_when_flow_visited": ["ops_closure"]},
}


def test_flow_visited_contains_aliases():
    assert flow_visited_contains(["运维闭环"], ["ops_closure"]) is True
    assert flow_visited_contains(["ops_closure"], ["运维闭环"]) is True
    assert flow_visited_contains(["问题填写", "问题审核"], ["ops_closure"]) is False
    assert flow_visited_contains([], ["ops_closure"]) is False
    assert flow_visited_contains(["运维闭环"], []) is True


def test_improvement_suggestion_hidden_without_ops_closure():
    assert field_visible(FIELD, {}) is False
    assert field_visible(FIELD, {FLOW_VISIT_CONTEXT_KEY: ["问题填写"]}) is False


def test_improvement_suggestion_visible_when_ops_closure_in_flow():
    assert field_visible(FIELD, {FLOW_VISIT_CONTEXT_KEY: ["运维闭环"]}) is True
    assert field_visible(FIELD, {FLOW_VISIT_CONTEXT_KEY: ["ops_closure", "审核关闭"]}) is True
