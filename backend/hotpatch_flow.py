"""热补丁工单：模板识别、下一节点解析、并行段汇合逻辑。"""

from __future__ import annotations

import json
from typing import Any

import psycopg

from hotpatch_config import (
    HOTPATCH_CLOSE_HANDLE_MODES,
    HOTPATCH_HANDLE_MODE_ROUTE,
    HOTPATCH_PARALLEL_ANALYSIS_GATES,
    HOTPATCH_PARALLEL_ANALYSIS_MERGE,
    HOTPATCH_PARALLEL_SELF_KEYS,
    HOTPATCH_PARALLEL_SELF_MERGE,
    HOTPATCH_TEMPLATE_CODE,
)


def template_code_for_ticket(conn: psycopg.Connection, ticket_internal_id: int) -> str:
    row = conn.execute(
        """
        SELECT COALESCE(wt.template_code, '') AS template_code
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        WHERE t.id = %s
        """,
        (ticket_internal_id,),
    ).fetchone()
    return str((row or {}).get("template_code") or "")


def load_flow_context(conn: psycopg.Connection, ticket_internal_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT flow_context FROM ticket WHERE id = %s",
        (ticket_internal_id,),
    ).fetchone()
    raw = (row or {}).get("flow_context")
    if raw is None:
        return None
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def save_flow_context(conn: psycopg.Connection, ticket_internal_id: int, ctx: dict[str, Any] | None) -> None:
    conn.execute(
        "UPDATE ticket SET flow_context = %s::jsonb, updated_at = NOW() WHERE id = %s",
        (psycopg.types.json.Jsonb(ctx or {}), ticket_internal_id),
    )


def _has_completed_node(conn: psycopg.Connection, ticket_internal_id: int, node_key: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM ticket_node_instance tni
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE tni.ticket_id = %s AND wt.template_code = %s AND wn.node_key = %s
        LIMIT 1
        """,
        (ticket_internal_id, HOTPATCH_TEMPLATE_CODE, node_key),
    ).fetchone()
    return row is not None


def _other_parallel_analysis_entry(conn: psycopg.Connection, ticket_internal_id: int, just_done: str) -> str:
    if just_done == "hp_dev_analysis":
        if not _has_completed_node(conn, ticket_internal_id, "hp_assign_test"):
            return "hp_assign_test"
        return "hp_test_analysis"
    if just_done == "hp_test_analysis":
        if not _has_completed_node(conn, ticket_internal_id, "hp_assign_dev"):
            return "hp_assign_dev"
        return "hp_dev_analysis"
    return HOTPATCH_PARALLEL_ANALYSIS_MERGE


def resolve_hotpatch_next_node_key(node_key: str, handle_mode: str) -> str:
    route = HOTPATCH_HANDLE_MODE_ROUTE.get(node_key, {})
    mode = str(handle_mode or "").strip()
    if "__default__" in route and mode not in route:
        return str(route.get("__default__") or "")
    return str(route.get(mode, "") or "")


def adjust_hotpatch_submit(
    conn: psycopg.Connection,
    ticket_internal_id: int,
    node_key: str,
    handle_mode: str,
    nominal_next: str,
) -> tuple[str, dict[str, Any] | None, bool]:
    """返回 (effective_next_node_key, flow_context 更新或 None 表示删除该列语义用空对象, should_close)。"""
    mode = str(handle_mode or "").strip()
    fc = load_flow_context(conn, ticket_internal_id) or {}

    if mode in HOTPATCH_CLOSE_HANDLE_MODES:
        return nominal_next, fc or None, True

    # 计划制定后进入并行开发/测试分析段
    if node_key == "hp_plan" and mode == "提交指定开发/指定测试":
        fc = dict(fc)
        fc["p1"] = {"merge": HOTPATCH_PARALLEL_ANALYSIS_MERGE, "done": []}
        save_flow_context(conn, ticket_internal_id, fc)
        return "hp_assign_dev", fc, False

    # 并行段一：开发/测试分析均完成「提交热补丁串讲」后才进入串讲
    if node_key in HOTPATCH_PARALLEL_ANALYSIS_GATES and mode == "提交热补丁串讲":
        p1 = fc.get("p1") if isinstance(fc.get("p1"), dict) else None
        if not p1:
            return nominal_next, fc or None, False
        done = list(p1.get("done") or [])
        if node_key not in done:
            done.append(node_key)
        need = {"hp_dev_analysis", "hp_test_analysis"}
        done_set = set(done)
        if need <= done_set:
            fc2 = dict(fc)
            fc2.pop("p1", None)
            save_flow_context(conn, ticket_internal_id, fc2)
            return HOTPATCH_PARALLEL_ANALYSIS_MERGE, fc2 or None, False
        fc2 = dict(fc)
        fc2["p1"] = {**p1, "done": done}
        save_flow_context(conn, ticket_internal_id, fc2)
        nxt = _other_parallel_analysis_entry(conn, ticket_internal_id, node_key)
        return nxt, fc2, False

    # 串讲后进入四自检并行段
    if node_key == "hp_walkthrough" and mode == "提交自检":
        fc2 = dict(fc)
        fc2["p2"] = {"merge": HOTPATCH_PARALLEL_SELF_MERGE, "done": []}
        save_flow_context(conn, ticket_internal_id, fc2)
        return "hp_pm_check", fc2, False

    if node_key in HOTPATCH_PARALLEL_SELF_KEYS and mode == "提交转测发起":
        p2 = fc.get("p2") if isinstance(fc.get("p2"), dict) else None
        if not p2:
            return nominal_next, fc or None, False
        done = list(p2.get("done") or [])
        if node_key not in done:
            done.append(node_key)
        need = set(HOTPATCH_PARALLEL_SELF_KEYS)
        done_set = set(done)
        if need <= done_set:
            fc3 = dict(fc)
            fc3.pop("p2", None)
            save_flow_context(conn, ticket_internal_id, fc3)
            return HOTPATCH_PARALLEL_SELF_MERGE, fc3 or None, False
        fc3 = dict(fc)
        fc3["p2"] = {**p2, "done": done}
        save_flow_context(conn, ticket_internal_id, fc3)
        order = list(HOTPATCH_PARALLEL_SELF_KEYS)
        for nk in order:
            if nk not in done_set:
                return nk, fc3, False
        return HOTPATCH_PARALLEL_SELF_MERGE, fc3, False

    return nominal_next, fc or None, False
