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


def whitelist_field_levels(conn: psycopg.Connection, operator_id: str) -> dict[str, str]:
    acc = str(operator_id or "").strip() or "demo_001"
    row = conn.execute(
        "SELECT role_code, is_pl FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    if not row or not str(row.get("role_code") or "").strip():
        return {}
    rows = conn.execute(
        """
        SELECT field_key, permission_level
        FROM role_permission_policy
        WHERE role_code = %s AND is_pl = %s AND node_key = %s
        """,
        (str(row["role_code"]), bool(row.get("is_pl")), WHITELIST_NODE_KEY),
    ).fetchall()
    out: dict[str, str] = {}
    for r in rows:
        fk = str(r.get("field_key") or "").strip()
        if not fk:
            continue
        out[fk] = str(r.get("permission_level") or "hidden").strip() or "hidden"
    return out


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
    }
