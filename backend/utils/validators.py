from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from utils.dts_no import dts_no_format_error, is_valid_dts_no
from utils.ecare_ticket_no import ecare_ticket_no_format_error, is_valid_ecare_ticket_no

# 表单值中的流转访问上下文（不落库）；与前端 requirement.js 一致
FLOW_VISIT_CONTEXT_KEY = "__flow_visited"
_FLOW_VISIT_ALIASES: dict[str, frozenset[str]] = {
    "ops_closure": frozenset({"ops_closure", "运维闭环"}),
    "运维闭环": frozenset({"ops_closure", "运维闭环"}),
}


def flow_visited_contains(visited: Any, required: Any) -> bool:
    """required 中每一项都须在流转日志 token 中出现（node_key / 中文名别名互通）。"""
    if not isinstance(required, list) or not required:
        return True
    tokens: set[str] = set()
    if isinstance(visited, (list, tuple, set)):
        tokens = {str(x).strip() for x in visited if str(x).strip() and str(x).strip() != "-"}
    elif isinstance(visited, str) and visited.strip() and visited.strip() != "-":
        tokens = {visited.strip()}
    for need in required:
        n = str(need or "").strip()
        if not n:
            continue
        candidates = set(_FLOW_VISIT_ALIASES.get(n, frozenset({n})))
        candidates.add(n)
        if not (tokens & candidates):
            return False
    return True


def field_visible(field: dict[str, Any], values: dict[str, Any]) -> bool:
    if field.get("key") == "next_handler" and str(values.get("handle_mode") or "") == "问题解决关闭":
        return False
    c = field.get("constraints") or {}
    rules = c.get("visible_when_all")
    if rules:
        for rule in rules:
            dep = rule.get("field")
            allowed = rule.get("values") or []
            if values.get(dep) not in allowed:
                return False
    need = c.get("visible_when_flow_visited")
    if isinstance(need, list) and need:
        if not flow_visited_contains(values.get(FLOW_VISIT_CONTEXT_KEY), need):
            return False
    return True


def matches_required_if(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    ri = constraints.get("required_if")
    if not ri:
        return False
    for dep_key, expected in ri.items():
        actual = values.get(dep_key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        else:
            if actual != expected:
                return False
    return True


def optional_when_all_matches(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    rules = constraints.get("optional_when_all")
    if not rules:
        return False
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) not in allowed:
            return False
    return True


def optional_when_any_matches(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    rules = constraints.get("optional_when_any")
    if not rules:
        return False
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) in allowed:
            return True
    return False


def effective_required(field: dict[str, Any], values: dict[str, Any]) -> bool:
    c = field.get("constraints") or {}
    if not field_visible(field, values):
        return False
    if optional_when_any_matches(c, values) or optional_when_all_matches(c, values):
        return False
    if c.get("required_when_visible"):
        return True
    if c.get("required_if"):
        return matches_required_if(c, values)
    return bool(field.get("required", False))


def validate_one(
    field: dict[str, Any],
    value: Any,
    ctx_values: dict[str, Any] | None = None,
    *_args: Any,
    **_kwargs: Any,
) -> str | None:
    key = field["key"]
    field_type = field["type"]
    required = bool(field.get("required", False))

    if value in ("", None):
        return f"{key} is required" if required else None

    if field_type in ("text", "richtext"):
        if not isinstance(value, str):
            return f"{key} must be string"
        if key == "dts_no" and str(value).strip() and not is_valid_dts_no(value):
            return dts_no_format_error(key)
        if key == "ecare_ticket_no" and str(value).strip():
            pl = ""
            if isinstance(ctx_values, dict):
                pl = str(ctx_values.get("product_line") or "").strip()
            if not is_valid_ecare_ticket_no(value, pl):
                return ecare_ticket_no_format_error(pl)
        return None

    if field_type == "date":
        if not isinstance(value, str):
            return f"{key} must be date string"
        try:
            date.fromisoformat(value)
        except ValueError:
            return f"{key} must be YYYY-MM-DD"
        return None

    if field_type == "datetime":
        if not isinstance(value, str):
            return f"{key} must be datetime string"
        try:
            datetime.fromisoformat(value)
        except ValueError:
            return f"{key} must be ISO datetime"
        return None

    if field_type == "whitelist":
        if not isinstance(value, str):
            return f"{key} must be string option"
        return None

    if field_type == "file":
        if not isinstance(value, str):
            return f"{key} must be file json string"
        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            return f"{key} must be valid file json"
        if not isinstance(payload, dict) or not str(payload.get("url") or "").strip():
            return f"{key} must include url"
        return None

    return f"{key} has unsupported field type {field_type}"