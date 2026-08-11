"""工单节点继承字段合并（与详情页 GET .../nodes/{key}/data 口径一致）。"""
from __future__ import annotations

import json
from typing import Any

import psycopg

from config import SCHEMA_TEMPLATE_CODE


def values_json_as_dict(raw: Any) -> dict[str, Any]:
    """ticket_node_data.values_json：驱动可能返回 dict 或 JSON 字符串。"""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


def _fill_missing_keys_from_previous_nodes(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    keys: list[str],
    values: dict[str, Any],
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, Any]:
    """从当前及更早节点的落库数据中，补齐 values 里为空的键。"""
    pending = [k for k in keys if k and (k not in values or values.get(k) in (None, ""))]
    if not pending:
        return values

    node_row = conn.execute(
        """
        SELECT wn.node_order
        FROM workflow_node wn
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s
          AND wn.node_key = %s
        LIMIT 1
        """,
        (template_code, node_key),
    ).fetchone()
    if not node_row or node_row.get("node_order") is None:
        return values

    rows = conn.execute(
        """
        SELECT tnd.values_json
        FROM ticket t
        JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE t.ticket_no = %s
          AND wt.template_code = %s
          AND wn.node_order <= %s
        ORDER BY wn.node_order DESC, tnd.created_at DESC, tnd.id DESC
        """,
        (ticket_no, template_code, int(node_row["node_order"])),
    ).fetchall()

    out = dict(values)
    unresolved = set(pending)
    for row in rows:
        raw = values_json_as_dict(row.get("values_json"))
        if not raw:
            continue
        for key in tuple(unresolved):
            v = raw.get(key)
            if v in (None, ""):
                continue
            out[key] = v
            unresolved.discard(key)
        if not unresolved:
            break

    return out


def _constraint_context_keys(fields: list[dict[str, Any]]) -> list[str]:
    """收集 required_if / visible_when / optional_when 依赖的外键（可能不在本节点表单）。"""
    needed: set[str] = set()
    for f in fields:
        c = f.get("constraints") or {}
        if not isinstance(c, dict):
            continue
        ri = c.get("required_if")
        if isinstance(ri, dict):
            needed.update(str(k) for k in ri.keys() if str(k).strip())
        for rule_key in ("visible_when_all", "optional_when_all", "optional_when_any"):
            rules = c.get(rule_key)
            if not isinstance(rules, list):
                continue
            for rule in rules:
                if not isinstance(rule, dict):
                    continue
                dep = str(rule.get("field") or "").strip()
                if dep:
                    needed.add(dep)
    return sorted(needed)


def merge_inherited_previous_values(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    fields: list[dict[str, Any]],
    values: dict[str, Any],
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, Any]:
    inheritable_keys = [
        str(f.get("key") or "")
        for f in fields
        if isinstance(f.get("ui_props"), dict)
        and bool((f.get("ui_props") or {}).get("inherit_previous"))
        and str(f.get("key") or "").strip()
    ]
    out = values
    if inheritable_keys:
        out = _fill_missing_keys_from_previous_nodes(
            conn, ticket_no, node_key, inheritable_keys, out, template_code=template_code
        )
    # 跨节点条件必填/显隐：把依赖字段（如运维分析的 issue_type）补进校验上下文
    ctx_keys = _constraint_context_keys(fields)
    if ctx_keys:
        out = _fill_missing_keys_from_previous_nodes(
            conn, ticket_no, node_key, ctx_keys, out, template_code=template_code
        )
    return out
