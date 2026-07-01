"""与前端白名单对齐：从 role_permission_policy 读取 __whitelist__ 策略。"""
from __future__ import annotations

import psycopg

WHITELIST_NODE_KEY = "__whitelist__"

# 与 frontend/modules/constants/permission.js PERMISSION_DEFAULT_HIDDEN_KEYS 一致
_PERMISSION_DEFAULT_HIDDEN_KEYS = frozenset(
    {
        "ai_assistant",
        "ai_assistant_template_edit",
        "ai_assistant_config",
        "ai_export",
        "ai_export_template",
        "oncall_eva",
        "oncall_eva_review",
        "monthly_report",
        "requirement_export",
    }
)


def whitelist_permission_level(wl: dict[str, str], key: str) -> str:
    """与前端 getWhitelistLevel 一致：未配置时多数为 readonly，少数键默认为 hidden。"""
    raw = str(wl.get(key) or "").strip()
    if raw in ("hidden", "readonly", "editable"):
        return raw
    if key in _PERMISSION_DEFAULT_HIDDEN_KEYS:
        return "hidden"
    return "readonly"


def _wlv(wl: dict[str, str], key: str) -> str:
    return whitelist_permission_level(wl, key)


def _whitelist_levels_for_role_pl(
    conn: psycopg.Connection, role_code: str, is_pl: bool
) -> dict[str, str]:
    rows = conn.execute(
        """
        SELECT field_key, permission_level
        FROM role_permission_policy
        WHERE role_code = %s AND is_pl = %s AND node_key = %s
        """,
        (role_code, is_pl, WHITELIST_NODE_KEY),
    ).fetchall()
    out: dict[str, str] = {}
    for r in rows:
        fk = str(r.get("field_key") or "").strip()
        if not fk:
            continue
        out[fk] = str(r.get("permission_level") or "hidden").strip() or "hidden"
    return out


def whitelist_field_levels(conn: psycopg.Connection, operator_id: str) -> dict[str, str]:
    acc = str(operator_id or "").strip() or "demo_001"
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    if not row or not str(row.get("role_code") or "").strip():
        return {}
    return whitelist_field_levels_effective(conn, str(row["role_code"]), False)


def whitelist_field_levels_effective(
    conn: psycopg.Connection, role_code: str, is_pl: bool
) -> dict[str, str]:
    """合并 is_pl 维度：权限策略「配置白名单」仅写入 is_pl=false；PL 用户未单独配置时回落到该基线。"""
    base = _whitelist_levels_for_role_pl(conn, role_code, False)
    if not is_pl:
        return base
    overlay = _whitelist_levels_for_role_pl(conn, role_code, True)
    return {**base, **overlay}


def whitelist_delete_allowed(conn: psycopg.Connection, operator_id: str, field_key: str) -> bool:
    """与前端 whitelistAllows(field, readonly) 及补丁删权限一致：非 hidden 即允许。"""
    wl = whitelist_field_levels(conn, operator_id)
    return whitelist_permission_level(wl, field_key) != "hidden"


def leave_application_all_only_self_applicant(wl: dict[str, str]) -> bool:
    """与前端 leave_application_all editable = 仅本人申请；兼容历史 field_key。"""
    return (
        _wlv(wl, "leave_application_all") == "editable"
        or _wlv(wl, "leave_application_all_only_self") == "editable"
        or _wlv(wl, "leave_application_scope_self") == "editable"
    )


def duty_roster_edit_rl_only(wl: dict[str, str]) -> bool:
    """与前端 duty_roster_edit editable = 仅 RL 值班表相关编辑按钮。"""
    return _wlv(wl, "duty_roster_edit") == "editable"


def tool_plaza_edit_all_items(wl: dict[str, str]) -> bool:
    """与前端 tool_plaza_edit editable = 可编辑/删除所有内容。"""
    return _wlv(wl, "tool_plaza_edit") == "editable"


def tool_plaza_can_edit_item(wl: dict[str, str], operator_id: str, publisher_id: str) -> bool:
    """与前端 tool_plaza_edit：hidden 不可；editable 全部；readonly 仅发布人本人。"""
    level = _wlv(wl, "tool_plaza_edit")
    if level == "hidden":
        return False
    if level == "editable":
        return True
    op = str(operator_id or "").strip()
    pub = str(publisher_id or "").strip()
    return bool(op and pub and op == pub)


def ticket_list_only_self_created(wl: dict[str, str]) -> bool:
    """与前端 permission.js：ticket_list editable = 仅本人创建；兼容历史 field_key。"""
    return (
        _wlv(wl, "ticket_list") == "editable"
        or _wlv(wl, "ticket_list_only_self_created") == "editable"
        or _wlv(wl, "ticket_list_scope_self") == "editable"
    )


def ticket_detail_only_problem_fill(wl: dict[str, str]) -> bool:
    """与前端 ticket_detail_passed_nodes === hidden；兼容旧 scope / 测试用键。"""
    return (
        _wlv(wl, "ticket_detail_passed_nodes") == "hidden"
        or _wlv(wl, "ticket_detail_only_problem_fill") == "editable"
        or _wlv(wl, "ticket_detail_scope_problem_fill") == "editable"
    )


def ticket_api_whitelist_flags(conn: psycopg.Connection, operator_id: str) -> dict[str, bool]:
    wl = whitelist_field_levels(conn, operator_id)
    return {
        "ticket_list_only_self_created": ticket_list_only_self_created(wl),
        "ticket_detail_only_problem_fill": ticket_detail_only_problem_fill(wl),
        "leave_application_all_only_self_applicant": leave_application_all_only_self_applicant(wl),
    }
