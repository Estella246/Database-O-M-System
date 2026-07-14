"""DFX 能力 GAP (dfx_gap) 字段退役支持。

dfx_gap 在 dev_analysis/dev_closure/ops_closure/audit_close 已退役（is_active=FALSE）：
新单 schema 不再包含它。但旧单（任一节点已存非空 dfx_gap 值）仍需渲染/继承/编辑该字段，
故在按工单加载 schema 时，若该工单已存 dfx_gap 值，则把 dfx_gap 字段定义补回（忽略 is_active）。
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.errors import UndefinedTable

DFX_GAP_FIELD_KEY = "dfx_gap"
_DFX_GAP_NODES = frozenset({"dev_analysis", "dev_closure", "ops_closure", "audit_close"})


def _ticket_has_dfx_gap_value(conn: psycopg.Connection, ticket_id: int) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM ticket_node_data
        WHERE ticket_id = %s
          AND values_json->>'dfx_gap' IS NOT NULL
          AND btrim(values_json->>'dfx_gap') <> ''
        LIMIT 1
        """,
        (ticket_id,),
    ).fetchone()
    return row is not None


def revive_dfx_gap_for_ticket(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    template_code: str,
) -> dict[str, Any] | None:
    """若该工单已存非空 dfx_gap（旧单），返回本节点 dfx_gap 字段定义；否则返回 None（新单不复活）。

    - 仅对 dfx_gap 所在的 4 个节点生效。
    - 忽略 is_active（已退役），但 required 强制为 FALSE。
    - 任何 DB 异常（表未就绪等）均降级为 None，绝不阻断 schema 加载。
    """
    if node_key not in _DFX_GAP_NODES or not str(ticket_no or "").strip():
        return None
    try:
        tid_row = conn.execute(
            "SELECT id FROM ticket WHERE ticket_no = %s", (str(ticket_no).strip(),)
        ).fetchone()
        if not tid_row:
            return None
        ticket_id = int(tid_row["id"])
        if not _ticket_has_dfx_gap_value(conn, ticket_id):
            return None
        row = conn.execute(
            """
            SELECT
              nfd.field_key AS key,
              nfd.field_name AS label,
              nfd.required,
              nfd.read_only AS readonly,
              nfd.field_type AS type,
              nfd.default_type,
              nfd.default_value,
              nfd.constraints_json AS constraints,
              nfd.ui_props_json AS ui_props
            FROM node_field_def nfd
            JOIN workflow_node wn ON wn.id = nfd.node_id
            JOIN workflow_template wt ON wt.id = wn.template_id
            WHERE wt.template_code = %s AND wn.node_key = %s AND nfd.field_key = 'dfx_gap'
            LIMIT 1
            """,
            (template_code, node_key),
        ).fetchone()
    except UndefinedTable:
        return None
    if not row:
        return None
    d = dict(row)
    c = d.get("constraints")
    d["constraints"] = c if isinstance(c, dict) else {}
    up = d.get("ui_props")
    d["ui_props"] = up if isinstance(up, dict) else {}
    d["required"] = False  # 退役字段不强制必填
    return d
