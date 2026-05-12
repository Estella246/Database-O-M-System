"""热补丁工单：模板识别、下一节点解析、并行段汇合逻辑。"""

from __future__ import annotations

import json
from typing import Any

import psycopg

from utils import canonical_person_display

from hotpatch_config import (
    HOTPATCH_CLOSE_HANDLE_MODES,
    HOTPATCH_HANDLE_MODE_ROUTE,
    HOTPATCH_NODE_NAME_CN,
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


HOTPATCH_FRONTIER_SORT_ORDER: tuple[str, ...] = (
    "hp_assign_dev",
    "hp_assign_test",
    "hp_dev_analysis",
    "hp_test_analysis",
    "hp_walkthrough",
    "hp_pm_check",
    "hp_de_check",
    "hp_tse_check",
    "hp_eng_check",
    "hp_transfer_start",
    "hp_transfer_confirm",
    "hp_test_verify",
    "hp_bu_conclusion",
    "hp_review_publish",
)


def sort_hotpatch_frontier_keys(keys: list[str]) -> list[str]:
    rank = {k: i for i, k in enumerate(HOTPATCH_FRONTIER_SORT_ORDER)}
    uniq: list[str] = []
    seen: set[str] = set()
    for k in keys:
        ks = str(k or "").strip()
        if not ks or ks in seen:
            continue
        seen.add(ks)
        uniq.append(ks)
    uniq.sort(key=lambda x: rank.get(x, 999))
    return uniq


def _has_submit_with_mode(
    conn: psycopg.Connection, ticket_internal_id: int, node_key: str, handle_mode: str
) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM ticket_node_data tnd
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE tnd.ticket_id = %s
          AND wt.template_code = %s
          AND wn.node_key = %s
          AND COALESCE(tnd.values_json->>'handle_mode', '') = %s
        LIMIT 1
        """,
        (ticket_internal_id, HOTPATCH_TEMPLATE_CODE, node_key, handle_mode),
    ).fetchone()
    return row is not None


def infer_hotpatch_frontier(conn: psycopg.Connection, ticket_internal_id: int, fc: dict[str, Any]) -> list[str]:
    """无 frontier 或需纠偏时，根据 p1/p2 与已提交记录推断并行前端节点（读侧/回填）。"""
    if not isinstance(fc.get("p1"), dict):
        if isinstance(fc.get("p2"), dict):
            p2 = fc["p2"]
            done = set(p2.get("done") or []) if isinstance(p2, dict) else set()
            return sort_hotpatch_frontier_keys([k for k in HOTPATCH_PARALLEL_SELF_KEYS if k not in done])
        return []
    p1 = fc["p1"]
    done_analysis = set(p1.get("done") or []) if isinstance(p1, dict) else set()
    if HOTPATCH_PARALLEL_ANALYSIS_GATES <= done_analysis:
        return []
    fr: list[str] = []
    if "hp_dev_analysis" not in done_analysis:
        if not _has_submit_with_mode(conn, ticket_internal_id, "hp_assign_dev", "提交开发分析"):
            fr.append("hp_assign_dev")
        else:
            fr.append("hp_dev_analysis")
    if "hp_test_analysis" not in done_analysis:
        if not _has_submit_with_mode(conn, ticket_internal_id, "hp_assign_test", "提交测试分析"):
            fr.append("hp_assign_test")
        else:
            fr.append("hp_test_analysis")
    return sort_hotpatch_frontier_keys(fr)


def ensure_hotpatch_frontier(conn: psycopg.Connection, ticket_internal_id: int) -> None:
    fc = load_flow_context(conn, ticket_internal_id) or {}
    if not isinstance(fc.get("p1"), dict) and not isinstance(fc.get("p2"), dict):
        return
    if isinstance(fc.get("frontier"), list) and len(fc["frontier"]) > 0:
        return
    inferred = infer_hotpatch_frontier(conn, ticket_internal_id, fc)
    if not inferred:
        return
    fc2 = dict(fc)
    fc2["frontier"] = inferred
    save_flow_context(conn, ticket_internal_id, fc2)


def sync_hotpatch_frontier_after_submit(
    conn: psycopg.Connection,
    ticket_internal_id: int,
    fc: dict[str, Any],
    submitted_node_key: str,
    handle_mode: str,
    next_node_key: str,
    should_close: bool,
) -> dict[str, Any]:
    """提交成功后刷新 flow_context.frontier（与并行汇合状态一致）。"""
    fc_out = dict(fc)
    mode = str(handle_mode or "").strip()
    nxt = str(next_node_key or "").strip()
    sub = str(submitted_node_key or "").strip()

    if should_close:
        fc_out.pop("frontier", None)
        fc_out.pop("parallel_handlers", None)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    has_wave = isinstance(fc_out.get("p1"), dict) or isinstance(fc_out.get("p2"), dict)
    has_frontier = isinstance(fc_out.get("frontier"), list) and len(fc_out.get("frontier") or []) > 0
    if not has_wave and not has_frontier:
        return fc_out

    fr0 = list(fc_out.get("frontier") or []) if isinstance(fc_out.get("frontier"), list) else []

    # 串讲后四自检并行
    if sub == "hp_walkthrough" and mode == "提交自检" and isinstance(fc_out.get("p2"), dict):
        fc_out["frontier"] = sort_hotpatch_frontier_keys(list(HOTPATCH_PARALLEL_SELF_KEYS))
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    # 四自检 → 转测发起汇合
    if sub in HOTPATCH_PARALLEL_SELF_KEYS and mode == "提交转测发起":
        p2 = fc_out.get("p2") if isinstance(fc_out.get("p2"), dict) else {}
        done = set(p2.get("done") or []) if isinstance(p2, dict) else set()
        # 最后一笔提交时 adjust_hotpatch_submit 已 pop 掉 p2 并重载 flow_context，done 不可再依赖 p2
        if nxt == HOTPATCH_PARALLEL_SELF_MERGE:
            fc_out["frontier"] = [HOTPATCH_PARALLEL_SELF_MERGE]
        else:
            fc_out["frontier"] = sort_hotpatch_frontier_keys([k for k in HOTPATCH_PARALLEL_SELF_KEYS if k not in done])
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    # 开发/测试分析 → 串讲汇合
    if sub in HOTPATCH_PARALLEL_ANALYSIS_GATES and mode == "提交热补丁串讲":
        if nxt == HOTPATCH_PARALLEL_ANALYSIS_MERGE:
            fc_out["frontier"] = [HOTPATCH_PARALLEL_ANALYSIS_MERGE]
            fc_out.pop("parallel_handlers", None)
        else:
            fr = [x for x in fr0 if x != sub]
            if nxt and nxt not in fr:
                fr.append(nxt)
            fc_out["frontier"] = sort_hotpatch_frontier_keys(fr)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    if sub == "hp_assign_dev" and mode == "提交开发分析" and nxt == "hp_dev_analysis":
        fr = [x for x in fr0 if x != "hp_assign_dev"]
        fr.append("hp_dev_analysis")
        fc_out["frontier"] = sort_hotpatch_frontier_keys(fr)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    if sub == "hp_assign_test" and mode == "提交测试分析" and nxt == "hp_test_analysis":
        fr = [x for x in fr0 if x != "hp_assign_test"]
        fr.append("hp_test_analysis")
        fc_out["frontier"] = sort_hotpatch_frontier_keys(fr)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    if sub == "hp_dev_analysis" and mode == "返回指定开发" and nxt == "hp_assign_dev":
        fr = [x for x in fr0 if x != "hp_dev_analysis"]
        fr.append("hp_assign_dev")
        fc_out["frontier"] = sort_hotpatch_frontier_keys(fr)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    if sub == "hp_test_analysis" and mode == "返回指定测试" and nxt == "hp_assign_test":
        fr = [x for x in fr0 if x != "hp_test_analysis"]
        fr.append("hp_assign_test")
        fc_out["frontier"] = sort_hotpatch_frontier_keys(fr)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    # 离开并行段（p1/p2 均已无）后的串行：仅跟踪当前库内下一节点
    if "p1" not in fc_out and "p2" not in fc_out:
        if nxt:
            fc_out["frontier"] = [nxt]
            if nxt not in ("hp_assign_dev", "hp_assign_test", "hp_dev_analysis", "hp_test_analysis"):
                fc_out.pop("parallel_handlers", None)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    # 并行段内其它流转（如转交留在本节点）：保持 frontier 含本节点
    if isinstance(fc_out.get("p1"), dict) and fr0:
        fc_out["frontier"] = sort_hotpatch_frontier_keys(fr0)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    if isinstance(fc_out.get("p2"), dict) and fr0:
        fc_out["frontier"] = sort_hotpatch_frontier_keys(fr0)
        save_flow_context(conn, ticket_internal_id, fc_out)
        return fc_out

    if nxt:
        fc_out["frontier"] = [nxt]
        save_flow_context(conn, ticket_internal_id, fc_out)
    return fc_out


def hotpatch_frontier_stage_labels(frontier: list[str] | None) -> str:
    if not frontier:
        return ""
    parts = [HOTPATCH_NODE_NAME_CN.get(k, k) for k in frontier]
    return "，".join(parts)


def hotpatch_frontier_handlers_display(
    fc: dict[str, Any] | None, fields_by_node: dict[str, Any] | None, frontier: list[str] | None
) -> str:
    """列表「当前处理人」：并行时合并各活跃分支待办人。"""
    if not frontier:
        return ""
    ph = fc.get("parallel_handlers") if isinstance(fc, dict) else None
    ph = ph if isinstance(ph, dict) else {}
    fbn = fields_by_node if isinstance(fields_by_node, dict) else {}
    plan = fbn.get("hp_plan") if isinstance(fbn.get("hp_plan"), dict) else {}
    out: list[str] = []
    seen: set[str] = set()
    for nk in frontier:
        h = ""
        if nk in ph:
            h = str(ph.get(nk) or "").strip()
        elif nk in ("hp_assign_dev", "hp_dev_analysis"):
            h = str(plan.get("开发人员") or "").strip()
        elif nk in ("hp_assign_test", "hp_test_analysis"):
            h = str(plan.get("测试人员") or "").strip()
        if not h:
            continue
        h2 = canonical_person_display(h)
        if h2 and h2 not in seen:
            seen.add(h2)
            out.append(h2)
    return "，".join(out)


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
    submit_values: dict[str, Any] | None = None,
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
        ph: dict[str, str] = {}
        sv = submit_values if isinstance(submit_values, dict) else {}
        dv = str(sv.get("开发人员") or "").strip()
        tv = str(sv.get("测试人员") or "").strip()
        if dv:
            ph["hp_assign_dev"] = canonical_person_display(dv)
        if tv:
            ph["hp_assign_test"] = canonical_person_display(tv)
        fc["parallel_handlers"] = ph
        fc["frontier"] = ["hp_assign_dev", "hp_assign_test"]
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
