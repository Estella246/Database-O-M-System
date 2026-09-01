"""统计图表：服务端按时间范围聚合，避免前端拉全量工单。"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable

from config import SCHEMA_TEMPLATE_CODE, TICKET_LIST_SNAPSHOT_ENABLED
from database import db_conn
from utils.date_helpers import parse_ymd
from utils.module_cascade_path import normalize_module_cascade_path
from utils.ticket_status import ticket_status_is_closed

logger = logging.getLogger(__name__)

_STATS_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ACCOUNT_LIKE_RE = re.compile(r"^[a-zA-Z]\d{6,}$")
_SPC_VER_RE = re.compile(r"SPC|\.B\d", re.I)
_CORE_C_VER_RE = re.compile(r"^\d+\.\d+\.(?:\d+|RC\d+)", re.I)
# C 版本：VxxxRxxxCxx（如 V500R001C00）
_VRC_C_VER_RE = re.compile(r"V\d+R\d+C\d+", re.I)
# C 版本：x.y.z（505.2.1）或 x.y.RCz（503.0.RC3、505.2.RC1）；更长串（.Bnnn / .SPC）取该 C
_DOT_C_VER_RE = re.compile(r"(?<![\d.])(\d+\.\d+\.(?:RC\d+|\d+))(?!\d)", re.I)
_DOT_C_RC_NORM_RE = re.compile(r"rc(\d+)", re.I)
# 匹配完整内核版本串中的 R 线主版本，如「GaussDB Kernel 506.0.0.SPC0100」→ 506
_R_LINE_NUM_RE = re.compile(r"(?<!\d)(503|505|506|507)(?!\d)")

WORKFLOW_NODES = ("问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭")
LABOR_STACK_STAGES = ("问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭")
LABOR_PIE_STAGES = WORKFLOW_NODES + ("关闭", "暂时挂起")
LABOR_FLOW_COMMANDO = "流转至责任田"
LABOR_FLOW_INDEPENDENT = "独立闭环"
# 与主页透传率一致：当前仍停在早期节点时不计入流转详细占比（不看是否关单）
_LABOR_FLOW_STAGE_TO_NODE_KEY = {
    "问题填写": "problem_fill",
    "问题审核": "problem_review",
    "运维分析": "ops_analysis",
    "开发分析": "dev_analysis",
    "开发闭环": "dev_closure",
    "运维闭环": "ops_closure",
    "审核关闭": "audit_close",
    "已关闭": "audit_close",
    "关闭": "audit_close",
}
# 各阶段人员滞留：按节点实例历史统计（一单可计多阶段）
_LABOR_STACK_NODE_KEYS = (
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
)
# 保存/补录会另插 completed 实例（起止几乎同时），不计入滞留次数与平均小时
_LABOR_EXCLUDE_SAVE_AMEND_SQL = """
              AND NOT EXISTS (
                SELECT 1
                FROM ticket_node_data tnd
                WHERE tnd.ticket_node_instance_id = tni.id
                  AND (
                    COALESCE((tnd.schema_snapshot->>'draft')::boolean, false)
                    OR COALESCE((tnd.schema_snapshot->>'amended')::boolean, false)
                  )
              )
"""
_LABOR_NODE_KEY_TO_STACK_STAGE = {
    "problem_review": "问题审核",
    "ops_analysis": "运维分析",
    "dev_analysis": "开发分析",
    "dev_closure": "开发闭环",
    "ops_closure": "运维闭环",
    "audit_close": "审核关闭",
}
OWNERSHIP_R_LINES = ("503", "505", "506", "507", "V5R001", "V5R002")
_OWNERSHIP_UNKNOWN_VERSION = "未知版本"
_OWNERSHIP_MODULE_NOT_FILLED = "未填写"
# TOP高发模块问题趋势：按二级模块总数量取前 N 条折线
_OWNERSHIP_L2_MODULE_TREND_LIMIT = 10
# 与工单「问题组件=管控问题」责任田一级根对齐（frontend CONTROL_COMPONENT_DUTY_L1_LABELS）
_CONTROL_DUTY_L1_LABELS = ("管控问题", "管控")


def _unique_l1_labels(seq: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in seq or []:
        lab = str(raw or "").strip()
        if not lab or lab == _OWNERSHIP_MODULE_NOT_FILLED or lab in seen:
            continue
        seen.add(lab)
        out.append(lab)
    return out


def _filter_duty_l1_labels_by_component(labels: list[str], component: str) -> list[str]:
    labs = _unique_l1_labels(labels)
    if str(component or "").strip().lower() != "control":
        return labs
    for preferred in _CONTROL_DUTY_L1_LABELS:
        matched = [x for x in labs if x == preferred]
        if matched:
            return matched
    return []


def load_duty_field_l1_labels(conn: psycopg.Connection | None, component: str = "all") -> list[str]:
    """参数配置-责任田模块的一级根节点（parent_id IS NULL）。"""
    if conn is None:
        return []
    try:
        rows = conn.execute(
            """
            SELECT label FROM duty_field_node
            WHERE parent_id IS NULL
            ORDER BY sort_order, id
            """
        ).fetchall()
    except UndefinedTable:
        return []
    labels = [str(r.get("label") or "").strip() for r in rows]
    return _filter_duty_l1_labels_by_component(labels, component)


def _l1_labels_from_module_rows(rows: list[dict[str, Any]], kind: str = "intro") -> list[str]:
    return _unique_l1_labels([_parse_module_levels(_module_path(t, kind))[0] for t in rows or []])


def _l1_labels_from_slices(
    daily_slices: list[dict[str, Any]], segment_key: str, l2_field: str
) -> list[str]:
    seq: list[str] = []
    for sl in daily_slices or []:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        for path in (seg.get(l2_field) or {}):
            path_s = str(path or "")
            seq.append(path_s.split("/")[0] if path_s else "")
    return _unique_l1_labels(seq)


def _resolve_l1_bar_labels(
    explicit: list[str] | None,
    *,
    from_rows: list[str] | None = None,
    from_slices: list[str] | None = None,
) -> list[str]:
    if explicit is not None:
        return _unique_l1_labels(explicit)
    return _unique_l1_labels([*(from_rows or []), *(from_slices or [])])


def _ownership_l1_bar_slots(l1_labels: list[str] | None = None) -> list[tuple[str, str]]:
    """质量问题TOP高发模块：(key, 一级模块名)；label 为空表示全部一级。key 即责任田一级名称。"""
    slots: list[tuple[str, str]] = [("all", "")]
    seen = {"all"}
    for lab in l1_labels or []:
        name = str(lab or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        slots.append((name, name))
    return slots


def _l1_module_options(l1_labels: list[str] | None) -> list[dict[str, str]]:
    return [{"key": name, "label": name} for name, _ in _ownership_l1_bar_slots(l1_labels)[1:]]

# 复合维度键分隔符（勿用 \\0：PostgreSQL jsonb 禁止 NUL）
METRICS_COMPOUND_SEP = "\x1f"


def metrics_compound_key(left: str, right: str) -> str:
    return f"{left}{METRICS_COMPOUND_SEP}{right}"


def split_metrics_compound_key(raw: str) -> tuple[str, str] | None:
    s = str(raw or "")
    if METRICS_COMPOUND_SEP in s:
        a, b = s.split(METRICS_COMPOUND_SEP, 1)
        return a, b
    if "\x00" in s:
        a, b = s.split("\x00", 1)
        return a, b
    return None

DOER_STAGE_KEYS = (
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
)
DOER_STAGE_NAMES = {
    "problem_review": "问题审核",
    "ops_analysis": "运维分析",
    "dev_analysis": "开发分析",
    "dev_closure": "开发闭环",
    "ops_closure": "运维闭环",
    "audit_close": "审核关闭",
}

DOER_CATEGORY_PRIORITY = {
    "doer_resolved": 5,
    "doer_helped": 4,
    "doer_no_help": 3,
    "no_doer": 2,
    "urgent_hard": 2,
    "not_filled": 1,
    "unknown": 0,
}


def _normalize_person_name(raw: str) -> str:
    base = str(raw or "").strip()
    if not base:
        return ""
    compact = re.sub(r"[()（）]", " ", base)
    compact = re.sub(r"\s+", " ", compact).strip()
    if not compact:
        return ""
    tokens = compact.split()
    non_account = [t for t in tokens if not _ACCOUNT_LIKE_RE.match(t)]
    if non_account and len(non_account) != len(tokens):
        return " ".join(non_account)
    without_suffix = re.sub(r"[\s·_-]*[a-zA-Z]\d{6,}$", "", compact, flags=re.I).strip()
    return without_suffix or compact


def _find_admin_user(raw: str, admin_users: list[dict[str, Any]]) -> dict[str, Any] | None:
    name = str(raw or "").strip()
    if not name:
        return None
    normalized = _normalize_person_name(name)
    for u in admin_users:
        user_name = str(u.get("user_name") or "").strip()
        account = str(u.get("account") or "").strip()
        if user_name == name or account == name:
            return u
        if _normalize_person_name(user_name) == normalized or account == normalized:
            return u
    return None


def _ticket_group(ticket: dict[str, Any], admin_users: list[dict[str, Any]]) -> str:
    handler = str(ticket.get("currentHandler") or ticket.get("assignee") or "").strip()
    creator = str(ticket.get("creatorName") or "").strip()
    for cand in (handler, creator):
        if not cand:
            continue
        hit = _find_admin_user(cand, admin_users)
        if hit and str(hit.get("group_name") or "").strip():
            return str(hit.get("group_name") or "").strip()
    return "未分组"


def _person_product_line(raw: str, admin_users: list[dict[str, Any]]) -> str:
    hit = _find_admin_user(raw, admin_users)
    return str(hit.get("product_line") or "").strip() if hit else ""


def _stats_day(ticket: dict[str, Any]) -> str:
    s = str(ticket.get("startDate") or "").strip()
    if _STATS_DAY_RE.match(s):
        return s
    created = ticket.get("createdAt") or ticket.get("created_at") or ""
    if isinstance(created, datetime):
        return created.astimezone(timezone.utc).strftime("%Y-%m-%d")
    s = str(created).strip()
    return s[:10] if len(s) >= 10 else ""


def _ticket_stage(ticket: dict[str, Any]) -> str:
    st = str(ticket.get("status") or "").strip().lower()
    if st == "closed" or ticket_status_is_closed(ticket.get("status")):
        return "关闭"
    if st == "suspended":
        return "暂时挂起"
    return str(ticket.get("currentStage") or ticket.get("node") or "").strip() or "问题审核"


def _labor_person_stack_stage(ticket: dict[str, Any]) -> str:
    """回退口径：无节点实例时用当前阶段；已关闭计入「审核关闭」。"""
    stage = _ticket_stage(ticket)
    if stage in ("关闭", "已关闭"):
        return "审核关闭"
    return stage


def _merge_closed_into_audit_close_person_stages(
    by_person_stage: dict[str, dict[str, int]],
) -> dict[str, dict[str, int]]:
    """日汇总历史切片可能仍带「关闭」键，读出时并入「审核关闭」。"""
    out: dict[str, dict[str, int]] = {}
    for person, stages in (by_person_stage or {}).items():
        merged: dict[str, int] = {}
        for stage, cnt in (stages or {}).items():
            key = "审核关闭" if str(stage) in ("关闭", "已关闭") else str(stage)
            merged[key] = int(merged.get(key) or 0) + int(cnt or 0)
        out[person] = merged
    return out


def _aware_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _instance_dwell_hours(
    started_at: datetime | None, ended_at: datetime | None, *, now_utc: datetime
) -> float | None:
    st = _aware_utc(started_at)
    if not st:
        return None
    et = _aware_utc(ended_at) or now_utc
    return max(0.0, (et - st).total_seconds() / 3600.0)


def fetch_labor_person_stage_counts(
    conn: psycopg.Connection, ticket_ids: list[int]
) -> dict[str, dict[str, int]]:
    """各阶段人员滞留次数：按 ticket_node_instance 历史。

    - 处理人在某阶段有实例即 +1（关单与否均计）
    - 同一工单可在多个阶段各计 1（甚至同阶段多次实例多次计）
    - 不含保存/补录实例（schema_snapshot.draft / amended）
    """
    ids = [int(x) for x in ticket_ids if x is not None]
    if not ids:
        return {}
    try:
        rows = conn.execute(
            f"""
            SELECT wn.node_key, tni.handler_name
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.ticket_id = ANY(%s)
              AND wn.node_key = ANY(%s)
            {_LABOR_EXCLUDE_SAVE_AMEND_SQL}
            """,
            (ids, list(_LABOR_STACK_NODE_KEYS)),
        ).fetchall()
    except UndefinedTable:
        return {}
    out: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in rows:
        stage = _LABOR_NODE_KEY_TO_STACK_STAGE.get(str(r.get("node_key") or "").strip())
        if not stage:
            continue
        person = _normalize_person_name(str(r.get("handler_name") or "").strip()) or "未分配"
        out[person][stage] += 1
    return {p: dict(stages) for p, stages in out.items()}


def fetch_labor_person_stage_hours(
    conn: psycopg.Connection, ticket_ids: list[int]
) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """节点实例历史滞留小时。

    Returns:
        (by_person_stage_hours, by_stage_hours)
        - 人×阶段：供「各阶段人员平均滞留」
        - 阶段：供「各阶段问题平均滞留」（走过即计；未结束用当前时间；关单仍计）
        - 同一工单可贡献多个阶段
        - 不含保存/补录实例（schema_snapshot.draft / amended）
    """
    ids = [int(x) for x in ticket_ids if x is not None]
    empty_stages = {s: 0.0 for s in LABOR_STACK_STAGES}
    if not ids:
        return {}, empty_stages
    try:
        rows = conn.execute(
            f"""
            SELECT wn.node_key, tni.handler_name, tni.started_at, tni.ended_at
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.ticket_id = ANY(%s)
              AND wn.node_key = ANY(%s)
            {_LABOR_EXCLUDE_SAVE_AMEND_SQL}
            """,
            (ids, list(_LABOR_STACK_NODE_KEYS)),
        ).fetchall()
    except UndefinedTable:
        return {}, empty_stages

    now_utc = datetime.now(timezone.utc)
    person_sum: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    person_cnt: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    stage_sum: dict[str, float] = defaultdict(float)
    stage_cnt: dict[str, int] = defaultdict(int)

    for r in rows:
        stage = _LABOR_NODE_KEY_TO_STACK_STAGE.get(str(r.get("node_key") or "").strip())
        if not stage:
            continue
        hours = _instance_dwell_hours(r.get("started_at"), r.get("ended_at"), now_utc=now_utc)
        if hours is None:
            continue
        person = _normalize_person_name(str(r.get("handler_name") or "").strip()) or "未分配"
        person_sum[person][stage] += hours
        person_cnt[person][stage] += 1
        stage_sum[stage] += hours
        stage_cnt[stage] += 1

    by_person: dict[str, dict[str, float]] = {}
    for person, stages in person_sum.items():
        by_person[person] = {
            st: round(stages[st] / person_cnt[person][st])
            for st in stages
            if person_cnt[person][st] > 0
        }
    by_stage = {
        s: round(stage_sum[s] / stage_cnt[s]) if stage_cnt[s] > 0 else 0.0 for s in LABOR_STACK_STAGES
    }
    return by_person, by_stage


def fetch_labor_person_stage_counts_by_ticket(
    conn: psycopg.Connection, ticket_ids: list[int]
) -> dict[int, dict[str, dict[str, int]]]:
    """单票维度的人员×阶段次数，供日汇总写入。不含保存/补录实例。"""
    dwell = fetch_labor_dwell_accumulators_by_ticket(conn, ticket_ids)
    out: dict[int, dict[str, dict[str, int]]] = {}
    for tid, acc in dwell.items():
        person_stages: dict[str, dict[str, int]] = {}
        for person, stages in (acc.get("by_person_stage") or {}).items():
            st_map = {
                st: int(b.get("cnt") or 0) + int(b.get("cnt_open") or 0)
                for st, b in (stages or {}).items()
            }
            st_map = {st: c for st, c in st_map.items() if c > 0}
            if st_map:
                person_stages[person] = st_map
        if person_stages:
            out[int(tid)] = person_stages
    return out


def _empty_dwell_bucket() -> dict[str, float | int]:
    return {"sum_h": 0.0, "cnt": 0, "sum_start_ms": 0.0, "cnt_open": 0}


def _add_instance_to_dwell_bucket(
    bucket: dict[str, float | int],
    started_at: datetime | None,
    ended_at: datetime | None,
) -> None:
    """已结束计入 sum_h/cnt；未结束计入 sum_start_ms/cnt_open（读时用当前时间还原）。"""
    st = _aware_utc(started_at)
    if not st:
        return
    et = _aware_utc(ended_at)
    if et is None:
        bucket["cnt_open"] = int(bucket.get("cnt_open") or 0) + 1
        bucket["sum_start_ms"] = float(bucket.get("sum_start_ms") or 0.0) + st.timestamp() * 1000.0
        return
    hours = max(0.0, (et - st).total_seconds() / 3600.0)
    bucket["sum_h"] = float(bucket.get("sum_h") or 0.0) + hours
    bucket["cnt"] = int(bucket.get("cnt") or 0) + 1


def avg_hours_from_dwell_bucket(bucket: dict[str, Any] | None, *, now_ms: float) -> float:
    """由日汇总滞留累加器还原平均小时（未结束实例按 now_ms 计）。"""
    b = bucket or {}
    cnt = int(b.get("cnt") or 0)
    cnt_open = int(b.get("cnt_open") or 0)
    total_cnt = cnt + cnt_open
    if total_cnt <= 0:
        return 0.0
    open_h = 0.0
    if cnt_open > 0:
        open_h = max(
            0.0,
            (float(cnt_open) * float(now_ms) - float(b.get("sum_start_ms") or 0.0)) / 3600000.0,
        )
    total_h = float(b.get("sum_h") or 0.0) + open_h
    return round(total_h / total_cnt)


def merge_dwell_bucket_maps(
    dst: dict[str, dict[str, float | int]], src: dict[str, Any] | None
) -> None:
    for key, bucket in (src or {}).items():
        ob = dst.setdefault(str(key), _empty_dwell_bucket())
        ob["sum_h"] = float(ob.get("sum_h") or 0.0) + float((bucket or {}).get("sum_h") or 0.0)
        ob["cnt"] = int(ob.get("cnt") or 0) + int((bucket or {}).get("cnt") or 0)
        ob["sum_start_ms"] = float(ob.get("sum_start_ms") or 0.0) + float(
            (bucket or {}).get("sum_start_ms") or 0.0
        )
        ob["cnt_open"] = int(ob.get("cnt_open") or 0) + int((bucket or {}).get("cnt_open") or 0)


def fetch_labor_dwell_accumulators_by_ticket(
    conn: psycopg.Connection, ticket_ids: list[int]
) -> dict[int, dict[str, Any]]:
    """单票滞留累加器，供日汇总写入。

    Returns:
        {ticket_id: {"by_person_stage": {person: {stage: bucket}}, "by_stage": {stage: bucket}}}
        bucket = {sum_h, cnt, sum_start_ms, cnt_open}；不含保存/补录。
    """
    ids = [int(x) for x in ticket_ids if x is not None]
    if not ids:
        return {}
    try:
        rows = conn.execute(
            f"""
            SELECT tni.ticket_id, wn.node_key, tni.handler_name, tni.started_at, tni.ended_at
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.ticket_id = ANY(%s)
              AND wn.node_key = ANY(%s)
            {_LABOR_EXCLUDE_SAVE_AMEND_SQL}
            """,
            (ids, list(_LABOR_STACK_NODE_KEYS)),
        ).fetchall()
    except UndefinedTable:
        return {}

    out: dict[int, dict[str, Any]] = {}
    for r in rows:
        stage = _LABOR_NODE_KEY_TO_STACK_STAGE.get(str(r.get("node_key") or "").strip())
        if not stage:
            continue
        tid = int(r["ticket_id"])
        person = _normalize_person_name(str(r.get("handler_name") or "").strip()) or "未分配"
        acc = out.setdefault(
            tid,
            {"by_person_stage": {}, "by_stage": {}},
        )
        person_stages: dict[str, dict[str, float | int]] = acc["by_person_stage"]
        by_stage: dict[str, dict[str, float | int]] = acc["by_stage"]
        pb = person_stages.setdefault(person, {}).setdefault(stage, _empty_dwell_bucket())
        sb = by_stage.setdefault(stage, _empty_dwell_bucket())
        _add_instance_to_dwell_bucket(pb, r.get("started_at"), r.get("ended_at"))
        _add_instance_to_dwell_bucket(sb, r.get("started_at"), r.get("ended_at"))
    return out


def _is_open(ticket: dict[str, Any]) -> bool:
    return str(ticket.get("status") or "").strip().lower() != "closed" and not ticket_status_is_closed(
        ticket.get("status")
    )


def _quality_value(ticket: dict[str, Any]) -> str:
    raw = str(ticket.get("isQualityIssue") or ticket.get("is_quality_issue") or "").strip()
    if not raw:
        return ""
    if "新发现" in raw:
        return "new"
    if "已知" in raw:
        return "known"
    if raw == "否":
        return "no"
    if raw == "是":
        return "known"
    return ""


def _is_quality_severity(ticket: dict[str, Any]) -> bool:
    sev = str(ticket.get("severity") or "").strip()
    return sev in ("严重", "致命")


def _ticket_component(ticket: dict[str, Any]) -> str:
    raw = str(ticket.get("component") or ticket.get("problemComponent") or "").strip()
    if "内核" in raw:
        return "kernel"
    if "管控" in raw:
        return "control"
    desc = str(ticket.get("description") or "")
    if "内核" in desc:
        return "kernel"
    if "管控" in desc:
        return "control"
    return "all"


def _ticket_version(ticket: dict[str, Any]) -> str:
    """内核版本（gauss_version）；无有效取值时返回「未知版本」，不参与版本类图表。"""
    raw = ticket.get("gauss_version")
    if raw is None:
        raw = ticket.get("gaussVersion")
    gauss = str(raw or "").strip()
    return gauss if gauss else _OWNERSHIP_UNKNOWN_VERSION


def _module_path(ticket: dict[str, Any], kind: str) -> str:
    key = "issue_owner_module" if kind == "owner" else "issue_intro_module"
    return normalize_module_cascade_path(ticket.get(key))


def _parse_module_levels(path: str) -> tuple[str, str, str]:
    s = str(path or "").strip()
    if not s:
        return (_OWNERSHIP_MODULE_NOT_FILLED, _OWNERSHIP_MODULE_NOT_FILLED, _OWNERSHIP_MODULE_NOT_FILLED)
    parts = [p.strip() for p in s.split("/") if p.strip()]
    return (
        parts[0] if parts else _OWNERSHIP_MODULE_NOT_FILLED,
        parts[1] if len(parts) >= 2 else _OWNERSHIP_MODULE_NOT_FILLED,
        parts[2] if len(parts) >= 3 else _OWNERSHIP_MODULE_NOT_FILLED,
    )


def _module_path_parts(path: str) -> list[str]:
    return [p.strip() for p in str(path or "").split("/") if p.strip()]


def _sunburst_module_parts(path: str) -> list[str]:
    """旭日图只统计实际填写的模块层级，跳过「未填写」占位。"""
    return [p for p in _module_path_parts(path) if p != _OWNERSHIP_MODULE_NOT_FILLED]


def _drop_unknown_version_counts(counts: dict[str, int]) -> dict[str, int]:
    """去掉「未知版本」，并丢弃数量 ≤0 的项（不进入按版本透视等图表）。"""
    return {
        k: int(v)
        for k, v in counts.items()
        if k != _OWNERSHIP_UNKNOWN_VERSION and int(v or 0) > 0
    }


def _r_of_version(v: str) -> str:
    """从具体内核版本归到 R 线。如「GaussDB Kernel 506.x」→ 506；无法识别则空串（不计入）。"""
    s = str(v or "").strip()
    if not s or s == _OWNERSHIP_UNKNOWN_VERSION:
        return ""
    if "V500R001" in s:
        return "V5R001"
    if "V500R002" in s:
        return "V5R002"
    m = _R_LINE_NUM_RE.search(s)
    if m:
        return m.group(1)
    return ""


def _c_of_version(v: str) -> str:
    """从具体版本归到 C 版本。

    - VxxxRxxxCxx（如 V500R001C00、V500R002C10）
    - x.y.z（如 505.2.1；更长串如 505.2.1.B021 / 505.1.0.SPC1 取前三段）
    - x.y.RCz（如 503.0.RC3、505.2.RC1；B 版本 503.0.RC3.B013 → 503.0.RC3）
    无法识别则空串（不计入）。
    """
    s = str(v or "").strip()
    if not s or s == _OWNERSHIP_UNKNOWN_VERSION:
        return ""
    m = _VRC_C_VER_RE.search(s)
    if m:
        return m.group(0).upper()
    m = _DOT_C_VER_RE.search(s)
    if m:
        return _DOT_C_RC_NORM_RE.sub(lambda x: f"RC{x.group(1)}", m.group(1))
    return ""


def _by_c_version_time_from_rows(
    rows: list[dict[str, Any]], time_labels: list[str], precision: str
) -> dict[str, list[int]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    for t in rows:
        c_ver = _c_of_version(_ticket_version(t))
        if not c_ver:
            continue
        groups[c_ver].append(t)
        counts[c_ver] += 1
    counts = _drop_unknown_version_counts(counts)
    keys = sorted(counts.keys(), key=lambda k: (-counts[k], k))
    return {
        ver: _series_for_rows(groups.get(ver) or [], time_labels, precision) for ver in keys
    }


def _finalize_c_version_time(
    by_c_version_time: dict[str, list[int]], time_labels: list[str]
) -> dict[str, list[int]]:
    totals = {k: sum(int(n or 0) for n in (pts or [])) for k, pts in by_c_version_time.items()}
    chart = _drop_unknown_version_counts(totals)
    keys = sorted(chart.keys(), key=lambda k: (-chart[k], k))
    empty = [0] * len(time_labels)
    return {ver: list(by_c_version_time.get(ver) or empty) for ver in keys}


def _ownership_version_time_maps_from_rows(
    rows: list[dict[str, Any]], time_labels: list[str], precision: str
) -> tuple[dict[str, list[int]], dict[str, list[int]], dict[str, list[int]]]:
    """B / C / R 版本 × 时间序列（排除未知版本、数量为 0 的 B/C）。"""
    by_version = _drop_unknown_version_counts(_count_by(rows, _ticket_version))
    versions = sorted(by_version.keys(), key=lambda k: (-by_version[k], k))
    by_version_time = {
        ver: _series_for_rows([t for t in rows if _ticket_version(t) == ver], time_labels, precision)
        for ver in versions
    }
    by_c_version_time = _by_c_version_time_from_rows(rows, time_labels, precision)
    by_r_version_time = {
        name: _series_for_rows(
            [t for t in rows if _r_of_version(_ticket_version(t)) == name],
            time_labels,
            precision,
        )
        for name in OWNERSHIP_R_LINES
    }
    return by_version_time, by_c_version_time, by_r_version_time


def _is_spc_version(ver: str) -> bool:
    return bool(_SPC_VER_RE.search(str(ver or "")))


def _is_core_c_version(ver: str) -> bool:
    s = str(ver or "").strip()
    if not s or _is_spc_version(s):
        return False
    return bool(_CORE_C_VER_RE.match(s))


def _normalize_problem_stage_label(raw: str) -> str:
    """饼图问题阶段：历史环境类取值与空占位归运维阶段。

    日汇总 ``by_biz_env`` 空值键为「未知环境」（旧业务环境占位，未回填时仍在），
    不是问题阶段选项，不能改写成「未知阶段」。
    """
    s = str(raw or "").strip()
    if not s or s in ("未知环境", "未知阶段"):
        return "运维阶段"
    if "生产环境" in s or "已投产" in s:
        return "运维阶段"
    return s


def _ticket_problem_stage(ticket: dict[str, Any]) -> str:
    """问题填写「问题阶段*」（biz_env）；空值与历史环境类取值归运维阶段。"""
    raw = str(ticket.get("bizEnv") or ticket.get("biz_env") or "").strip()
    return _normalize_problem_stage_label(raw)


def _ticket_problem_env(ticket: dict[str, Any]) -> str:
    """问题填写「问题环境*」（problem_env）；空值归入未知环境。"""
    return str(ticket.get("problem_env") or ticket.get("problemEnv") or "").strip() or "未知环境"


def _ticket_product_line(ticket: dict[str, Any]) -> str:
    """问题填写「产品线*」（product_line）；空值归入未知产品线。"""
    return str(ticket.get("product_line") or ticket.get("productLine") or "").strip() or "未知产品线"


def _ticket_issue_type(ticket: dict[str, Any]) -> str:
    """运维分析「问题类型*」（issue_type）；空值归入未知类型。"""
    return str(ticket.get("issue_type") or ticket.get("issueType") or "").strip() or "未知类型"


def _ticket_intro_l2(ticket: dict[str, Any]) -> str:
    """问题模块二级（如 SQL/慢/计划不优 → 慢）。"""
    return _parse_module_levels(_module_path(ticket, "intro"))[1]


def _issue_type_time_from_rows(
    rows: list[dict[str, Any]], time_labels: list[str], precision: str
) -> dict[str, list[int]]:
    """质量问题按问题类型 × 时间序列，按数量降序。"""
    counts = _count_by(rows, _ticket_issue_type)
    keys = sorted(counts.keys(), key=lambda k: (-counts[k], k))
    return {
        key: _series_for_rows(
            [t for t in rows if _ticket_issue_type(t) == key], time_labels, precision
        )
        for key in keys
    }


def _l2_module_time_from_rows(
    rows: list[dict[str, Any]],
    time_labels: list[str],
    precision: str,
    limit: int = _OWNERSHIP_L2_MODULE_TREND_LIMIT,
) -> dict[str, list[int]]:
    """质量问题按问题模块二级 × 时间序列，按总数量取前 N。"""
    counts = _count_by(rows, _ticket_intro_l2)
    keys = sorted(counts.keys(), key=lambda k: (-counts[k], k))[: max(0, int(limit))]
    return {
        key: _series_for_rows(
            [t for t in rows if _ticket_intro_l2(t) == key], time_labels, precision
        )
        for key in keys
    }


def _issue_type_time_from_slices(
    daily_slices: list[dict[str, Any]],
    segment_key: str,
    time_labels: list[str],
    precision: str,
) -> dict[str, list[int]]:
    """日汇总质量问题按问题类型 × 时间序列，按数量降序。"""
    idx = {lab: i for i, lab in enumerate(time_labels)}
    by_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        ymd = str(sl.get("stats_day") or "")
        lab = _bucket_label(ymd, precision)
        i = idx.get(lab)
        if i is None:
            continue
        for itype, cnt in (seg.get("by_issue_type") or {}).items():
            n = int(cnt)
            if n <= 0:
                continue
            by_time[str(itype)][i] += n
    totals = _sum_slice_maps(daily_slices, segment_key, "by_issue_type")
    keys = sorted(totals.keys(), key=lambda k: (-int(totals.get(k) or 0), k))
    return {key: by_time.get(key, [0] * len(time_labels)) for key in keys}


def _l2_module_time_from_slices(
    daily_slices: list[dict[str, Any]],
    segment_key: str,
    time_labels: list[str],
    precision: str,
    limit: int = _OWNERSHIP_L2_MODULE_TREND_LIMIT,
) -> dict[str, list[int]]:
    """日汇总质量问题按问题模块二级 × 时间序列，按总数量取前 N。"""
    idx = {lab: i for i, lab in enumerate(time_labels)}
    by_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        ymd = str(sl.get("stats_day") or "")
        lab = _bucket_label(ymd, precision)
        i = idx.get(lab)
        if i is None:
            continue
        for path, cnt in (seg.get("module_intro_l2") or {}).items():
            n = int(cnt)
            if n <= 0:
                continue
            l2 = _module_l2_from_compound(str(path))
            by_time[l2][i] += n
    totals = {k: sum(v) for k, v in by_time.items()}
    keys = sorted(totals.keys(), key=lambda k: (-int(totals.get(k) or 0), k))[: max(0, int(limit))]
    return {key: by_time.get(key, [0] * len(time_labels)) for key in keys}


def _stage_counts_for_pie(by_env: dict[str, int]) -> dict[str, int]:
    """日汇总 by_biz_env 出阶段饼：空占位「未知环境」与历史环境类取值归运维阶段。"""
    out: dict[str, int] = {}
    for raw, cnt in (by_env or {}).items():
        label = _normalize_problem_stage_label(str(raw))
        out[label] = out.get(label, 0) + int(cnt)
    return out


def _count_by(rows: list[dict[str, Any]], key_fn) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for t in rows:
        out[str(key_fn(t))] += 1
    return dict(out)


def _top_entries(counts: dict[str, int], limit: int | None = 10) -> list[dict[str, Any]]:
    items = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    if limit is not None:
        items = items[:limit]
    return [{"name": k, "value": v} for k, v in items]


def _dedupe_dts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for t in rows:
        dts = str(t.get("dts_no") or "").strip()
        if dts:
            if dts in seen:
                continue
            seen.add(dts)
        out.append(t)
    return out


def _build_l1_bars_from_rows(
    rows: list[dict[str, Any]], l1_labels: list[str] | None = None
) -> tuple[dict[str, dict[str, list[dict[str, Any]]]], list[str]]:
    """质量问题TOP高发模块：按二级模块计数（全部一级 + 各责任田一级），不截断 TopN。"""
    labels = _resolve_l1_bar_labels(
        l1_labels,
        from_rows=_unique_l1_labels(
            _l1_labels_from_module_rows(rows, "intro") + _l1_labels_from_module_rows(rows, "owner")
        ),
    )
    l1_bars: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for kind in ("intro", "owner"):
        l1_bars[kind] = {}
        for key, label in _ownership_l1_bar_slots(labels):
            for dedup in (False, True):
                scoped = rows
                if label:
                    scoped = [t for t in scoped if _parse_module_levels(_module_path(t, kind))[0] == label]
                if dedup:
                    scoped = _dedupe_dts(scoped)
                counts = _count_by(scoped, lambda t, k=kind: _parse_module_levels(_module_path(t, k))[1])
                l1_bars[kind][f"{key}_{'dedup' if dedup else 'raw'}"] = _top_entries(counts, None)
    return l1_bars, labels


def _build_time_labels(start: date, end: date, precision: str) -> list[str]:
    labels: list[str] = []
    if precision == "day":
        d = start
        guard = 0
        while d <= end and guard < 400:
            labels.append(f"{d.month}/{d.day}")
            d = date.fromordinal(d.toordinal() + 1)
            guard += 1
    elif precision == "month":
        d = date(start.year, start.month, 1)
        end_m = date(end.year, end.month, 1)
        while d <= end_m:
            labels.append(f"{d.year}-{d.month:02d}")
            if d.month == 12:
                d = date(d.year + 1, 1, 1)
            else:
                d = date(d.year, d.month + 1, 1)
    elif precision == "quarter":
        q_start_month = ((start.month - 1) // 3) * 3 + 1
        d = date(start.year, q_start_month, 1)
        guard = 0
        while d <= end and guard < 80:
            q = (d.month - 1) // 3 + 1
            labels.append(f"{d.year}Q{q}")
            if d.month >= 10:
                d = date(d.year + 1, 1, 1)
            else:
                d = date(d.year, d.month + 3, 1)
            guard += 1
    else:
        y = start.year
        while y <= end.year:
            labels.append(str(y))
            y += 1
    return labels or ["—"]


def _bucket_label(ymd: str, precision: str) -> str:
    if not _STATS_DAY_RE.match(ymd):
        return "—"
    y, m, d = int(ymd[:4]), int(ymd[5:7]), int(ymd[8:10])
    if precision == "day":
        return f"{m}/{d}"
    if precision == "month":
        return f"{y}-{m:02d}"
    if precision == "quarter":
        return f"{y}Q{(m - 1) // 3 + 1}"
    return str(y)


def _series_for_rows(rows: list[dict[str, Any]], labels: list[str], precision: str) -> list[int]:
    idx = {lab: i for i, lab in enumerate(labels)}
    out = [0] * len(labels)
    for t in rows:
        lab = _bucket_label(_stats_day(t), precision)
        i = idx.get(lab)
        if i is not None:
            out[i] += 1
    return out


def _sunburst_branch_count(l3_map: dict[str, int]) -> int:
    return sum(l3_map.values())


def _sunburst_l3_nodes(l3_map: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {"name": l3, "value": v}
        for l3, v in sorted(l3_map.items(), key=lambda x: -x[1])
        if l3 != "__leaf__"
    ]


def _sunburst_l2_nodes(l2_map: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    for l2, l3_map in sorted(l2_map.items(), key=lambda x: -_sunburst_branch_count(x[1])):
        if l2 == "__leaf__":
            continue
        l3_children = _sunburst_l3_nodes(l3_map)
        leaf_at_l2 = int(l3_map.get("__leaf__") or 0)
        if l3_children:
            children.append({"name": l2, "children": l3_children})
        elif leaf_at_l2:
            children.append({"name": l2, "value": leaf_at_l2})
    return children


def _build_sunburst(rows: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    l1_map: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for t in rows:
        parts = _sunburst_module_parts(_module_path(t, kind))
        if not parts:
            continue
        if len(parts) == 1:
            l1_map[parts[0]]["__leaf__"]["__leaf__"] += 1
        elif len(parts) == 2:
            l1_map[parts[0]][parts[1]]["__leaf__"] += 1
        else:
            l1_map[parts[0]][parts[1]][parts[2]] += 1

    result: list[dict[str, Any]] = []
    for l1, l2_map in sorted(l1_map.items(), key=lambda x: -sum(_sunburst_branch_count(v) for v in x[1].values())):
        leaf_l1 = int((l2_map.get("__leaf__") or {}).get("__leaf__") or 0)
        children = _sunburst_l2_nodes(l2_map)
        if children:
            result.append({"name": l1, "children": children})
        elif leaf_l1:
            result.append({"name": l1, "value": leaf_l1})
    return result


def _load_admin_users(conn: psycopg.Connection) -> list[dict[str, Any]]:
    try:
        rows = conn.execute(
            "SELECT account, user_name, group_name, product_line FROM user_account"
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _snapshot_table_ready(conn: psycopg.Connection) -> bool:
    if not TICKET_LIST_SNAPSHOT_ENABLED:
        return False
    try:
        r = conn.execute("SELECT to_regclass('public.ticket_list_snapshot') AS name").fetchone()
        return bool(r and r.get("name"))
    except Exception:
        return False


def _row_from_snapshot(r: dict[str, Any]) -> dict[str, Any]:
    extra = r.get("extra_fields") or {}
    if not isinstance(extra, dict):
        extra = {}
    created = r.get("created_at")
    created_iso = created.isoformat() if hasattr(created, "isoformat") else str(created or "")
    order_id = str(r.get("ticket_no") or "")
    ticket_id = r.get("ticket_id")
    row = {
        "ticketId": int(ticket_id) if ticket_id is not None else None,
        "orderId": order_id,
        "processId": order_id,
        "status": str(r.get("status") or "open"),
        "creatorName": str(r.get("creator_name") or ""),
        "creatorId": str(r.get("creator_id") or ""),
        "currentStage": str(r.get("current_stage") or ""),
        "currentHandler": str(r.get("current_handler") or ""),
        "assignee": str(r.get("current_handler") or ""),
        "startDate": str(r.get("start_date") or ""),
        "location": str(r.get("location") or ""),
        "bizEnv": str(r.get("biz_env") or ""),
        "severity": str(r.get("severity") or "一般"),
        "isQualityIssue": str(r.get("is_quality_issue") or ""),
        "description": str(r.get("description_plain") or "")[:200],
        "createdAt": created_iso,
        **{k: str(v or "") for k, v in extra.items()},
    }
    return row


def _ticket_collaborator_names(ticket: dict[str, Any]) -> list[str]:
    """从工单协同处理人字段解析规范化姓名（同人去重）。"""
    from utils.person_display import parse_multi_person_parts

    raw = str(ticket.get("collaborator") or "").strip()
    out: list[str] = []
    seen: set[str] = set()
    for part in parse_multi_person_parts(raw):
        name = _normalize_person_name(part)
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _fetch_ticket_submit_operator_names(
    conn: psycopg.Connection, ticket_ids: list[int]
) -> dict[int, list[str]]:
    """批量取各工单曾 submit/jump_submit 的操作者规范化姓名（同人同单去重）。"""
    ids = [int(x) for x in ticket_ids if x is not None]
    if not ids:
        return {}
    rows = conn.execute(
        """
        SELECT ticket_id, operator_name, operator_id
        FROM ticket_flow_log
        WHERE ticket_id = ANY(%s)
          AND action_type IN ('submit', 'jump_submit')
        """,
        (ids,),
    ).fetchall()
    by_tid: dict[int, list[str]] = defaultdict(list)
    seen: dict[int, set[str]] = defaultdict(set)
    for r in rows:
        tid = int(r["ticket_id"])
        raw = str(r.get("operator_name") or "").strip() or str(r.get("operator_id") or "").strip()
        name = _normalize_person_name(raw)
        if not name or name in seen[tid]:
            continue
        seen[tid].add(name)
        by_tid[tid].append(name)
    return dict(by_tid)


def enrich_labor_submitters(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    """为行级聚合写入 `_laborSubmitters`（就地修改）。"""
    ids = [int(r["ticketId"]) for r in rows if r.get("ticketId") is not None]
    mapping = _fetch_ticket_submit_operator_names(conn, ids)
    for r in rows:
        tid = r.get("ticketId")
        if tid is None:
            continue
        r["_laborSubmitters"] = list(mapping.get(int(tid), []))


def flow_flags_from_last_ops_dest(to_node_key: Any) -> tuple[bool, bool]:
    """由运维分析最后一次 submit/jump_submit 的去向得到 (has_commando, has_independent)。"""
    nk = str(to_node_key or "").strip()
    if nk == "dev_analysis":
        return True, False
    if nk in ("dev_closure", "ops_closure"):
        return False, True
    return False, False


def resolve_labor_flow_key(
    *,
    status: Any = None,
    current_stage: str = "",
    node_key: str = "",
    has_commando: bool = False,
    has_independent: bool = False,
) -> str:
    """问题流转详细占比归类，口径对齐主页透传率。

    透传/独立闭环看运维分析最后一次提交去向（见 flow_flags_from_last_ops_dest），
    不看历史上是否走过开发分析。是否关单不参与排除——仅看当前节点是否仍在早期节点。
    """
    from config import HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS

    _ = status  # 不看是否关单；参数保留兼容调用方
    nk = str(node_key or "").strip()
    if not nk:
        nk = _LABOR_FLOW_STAGE_TO_NODE_KEY.get(str(current_stage or "").strip(), "")
    if nk in HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS:
        return ""
    if has_commando:
        return LABOR_FLOW_COMMANDO
    if has_independent:
        return LABOR_FLOW_INDEPENDENT
    return ""


def _fetch_ticket_flow_passthrough_flags(
    conn: psycopg.Connection, ticket_ids: list[int]
) -> dict[int, tuple[bool, bool, str, str]]:
    """批量取流转透传标记：ticket_id → (has_commando, has_independent, node_key, ops_anchor_name)。

    归类看运维分析最后一次 submit/jump_submit 的去向；ops_anchor_name 为该次操作人（姓名优先）。
    """
    ids = [int(x) for x in ticket_ids if x is not None]
    if not ids:
        return {}
    rows = conn.execute(
        """
        SELECT
          t.id AS ticket_id,
          COALESCE(wn.node_key, '') AS node_key,
          (
            SELECT twn.node_key
            FROM ticket_flow_log fl
            JOIN workflow_node fwn ON fwn.id = fl.from_node_id AND fwn.node_key = 'ops_analysis'
            JOIN workflow_node twn ON twn.id = fl.to_node_id
            WHERE fl.ticket_id = t.id
              AND fl.action_type IN ('submit', 'jump_submit')
            ORDER BY fl.created_at DESC, fl.id DESC
            LIMIT 1
          ) AS last_ops_to_node,
          (
            SELECT COALESCE(
              NULLIF(BTRIM(fl.operator_name), ''),
              NULLIF(BTRIM(fl.operator_id), ''),
              ''
            )
            FROM ticket_flow_log fl
            JOIN workflow_node fwn ON fwn.id = fl.from_node_id AND fwn.node_key = 'ops_analysis'
            WHERE fl.ticket_id = t.id
              AND fl.action_type IN ('submit', 'jump_submit')
            ORDER BY fl.created_at DESC, fl.id DESC
            LIMIT 1
          ) AS ops_anchor_name
        FROM ticket t
        LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
        WHERE t.id = ANY(%s)
        """,
        (ids,),
    ).fetchall()
    out: dict[int, tuple[bool, bool, str, str]] = {}
    for r in rows:
        has_c, has_i = flow_flags_from_last_ops_dest(r.get("last_ops_to_node"))
        out[int(r["ticket_id"])] = (
            has_c,
            has_i,
            str(r.get("node_key") or "").strip(),
            str(r.get("ops_anchor_name") or "").strip(),
        )
    return out


def enrich_labor_flow_passthrough(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    """为行级聚合写入 `_laborFlowKey` / `_laborFlowPerson`（就地修改）。"""
    ids = [int(r["ticketId"]) for r in rows if r.get("ticketId") is not None]
    flags = _fetch_ticket_flow_passthrough_flags(conn, ids)
    for r in rows:
        tid = r.get("ticketId")
        if tid is None:
            r["_laborFlowKey"] = ""
            r["_laborFlowPerson"] = ""
            continue
        has_c, has_i, nk, ops_name = flags.get(int(tid), (False, False, "", ""))
        r["_laborFlowKey"] = resolve_labor_flow_key(
            status=r.get("status"),
            current_stage=str(r.get("currentStage") or ""),
            node_key=nk or str(r.get("nodeKey") or ""),
            has_commando=has_c,
            has_independent=has_i,
        )
        r["_laborFlowPerson"] = _normalize_person_name(ops_name) if ops_name else ""


def _labor_input_people(ticket: dict[str, Any], *, include_collab: bool) -> list[str]:
    """人力投入统计归属人：提交经手人；可选并入协同处理人。同人同单最多计 1。"""
    submitters = ticket.get("_laborSubmitters")
    if submitters is None:
        # 未 enrichment 时回退旧口径（单测 / 兼容）
        raw = str(
            ticket.get("currentHandler") or ticket.get("assignee") or ticket.get("creatorName") or ""
        ).strip()
        name = _normalize_person_name(raw) or "未分配"
        people = [name]
    else:
        people = []
        seen: set[str] = set()
        for raw in submitters:
            name = _normalize_person_name(str(raw).strip()) if str(raw).strip() else ""
            if not name:
                name = str(raw).strip()
            if not name or name in seen:
                continue
            seen.add(name)
            people.append(name)
        if not people:
            raw = str(
                ticket.get("currentHandler") or ticket.get("assignee") or ticket.get("creatorName") or ""
            ).strip()
            people = [_normalize_person_name(raw) or "未分配"]
    if include_collab:
        seen = set(people)
        for c in _ticket_collaborator_names(ticket):
            if c not in seen:
                seen.add(c)
                people.append(c)
    return people


def fetch_stats_tickets(
    conn: psycopg.Connection,
    operator_id: str,
    start_date: date,
    end_date: date,
    *,
    only_self: bool,
) -> list[dict[str, Any]]:
    """按 stats_day 落在 [start_date, end_date] 的 HCS 工单。"""
    if _snapshot_table_ready(conn):
        params: list[Any] = [only_self, operator_id, SCHEMA_TEMPLATE_CODE, start_date, end_date]
        sql = """
            SELECT tls.ticket_id, tls.ticket_no, tls.status, tls.creator_name, tls.creator_id,
                   tls.current_stage, tls.current_handler, tls.start_date, tls.location,
                   tls.biz_env, tls.severity, tls.is_quality_issue, tls.description_plain,
                   tls.extra_fields, tls.created_at
            FROM ticket_list_snapshot tls
            WHERE (%s = FALSE OR tls.creator_id = %s)
              AND tls.template_code = %s
              AND COALESCE(
                CASE WHEN tls.start_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN tls.start_date::date ELSE NULL END,
                DATE(timezone('Asia/Shanghai', tls.created_at))
              ) BETWEEN %s AND %s
        """
        try:
            rows = conn.execute(sql, tuple(params)).fetchall()
            return [_row_from_snapshot(dict(r)) for r in rows]
        except UndefinedTable:
            pass

    logger.warning(
        "stats fetch: ticket_list_snapshot unavailable, skip legacy full list (avoid OOM)"
    )
    return []


def _filter_ownership_rows(
    rows: list[dict[str, Any]], quality: str, component: str
) -> list[dict[str, Any]]:
    scoped = rows
    if component != "all":
        scoped = [t for t in scoped if _ticket_component(t) == component]
    if quality == "all":
        return scoped
    out: list[dict[str, Any]] = []
    for t in scoped:
        v = _quality_value(t)
        if not v:
            continue
        if quality == "yes" and v in ("known", "new"):
            out.append(t)
        elif quality in ("known", "new", "no") and v == quality:
            out.append(t)
    return out


def build_ownership_payload(
    rows: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
    l1_labels: list[str] | None = None,
) -> dict[str, Any]:
    all_rows = _filter_ownership_rows(rows, quality, component)
    time_labels = _build_time_labels(start_date, end_date, precision)
    trend_rows = [t for t in all_rows if _quality_value(t)]
    quality_yes_rows = [t for t in all_rows if _quality_value(t) in ("known", "new")]
    known_rows = [t for t in trend_rows if _quality_value(t) == "known"]
    new_rows = [t for t in trend_rows if _quality_value(t) == "new"]

    by_version = _count_by(all_rows, _ticket_version)
    by_version_chart = _drop_unknown_version_counts(by_version)
    # 按版本透视：时间窗内全部有效版本（已排除「未知版本」），按数量降序
    versions = sorted(by_version_chart.keys(), key=lambda k: (-by_version_chart[k], k))
    versions_for_series = versions

    by_env = _count_by(all_rows, lambda t: str(t.get("bizEnv") or "").strip() or "未知环境")
    by_problem_stage = _count_by(all_rows, _ticket_problem_stage)
    by_problem_env = _count_by(all_rows, _ticket_problem_env)
    by_product_line = _count_by(all_rows, _ticket_product_line)
    by_product_line_quality = _count_by(quality_yes_rows, _ticket_product_line)

    by_site = _count_by(all_rows, lambda t: str(t.get("location") or "").strip() or "未知局点")
    by_site_quality = _count_by(
        quality_yes_rows, lambda t: str(t.get("location") or "").strip() or "未知局点"
    )
    by_site_inst: dict[str, set[str]] = defaultdict(set)
    for t in all_rows:
        site = str(t.get("location") or "").strip() or "未知局点"
        pid = str(t.get("processId") or t.get("orderId") or "").strip()
        if pid:
            by_site_inst[site].add(pid)

    core_bars = _top_entries(
        _count_by([t for t in all_rows if _is_core_c_version(_ticket_version(t))], _ticket_version), 10
    )

    # 质量问题TOP高发模块：仅「是（已知/新发现质量问题）」；一级来自责任田模块
    l1_bars, resolved_l1_labels = _build_l1_bars_from_rows(quality_yes_rows, l1_labels)

    version_cat_rows = list(by_env.keys())[:8]
    version_cat_cols = versions
    version_cat_cells: list[list[int]] = []
    for er in version_cat_rows:
        row_cells = []
        for col in version_cat_cols:
            row_cells.append(
                sum(
                    1
                    for t in all_rows
                    if (str(t.get("bizEnv") or "").strip() or "未知环境") == er and _ticket_version(t) == col
                )
            )
        version_cat_cells.append(row_cells)

    q_by_version_time, q_by_c_version_time, q_by_r_version_time = _ownership_version_time_maps_from_rows(
        quality_yes_rows, time_labels, precision
    )
    by_issue_type_time = _issue_type_time_from_rows(quality_yes_rows, time_labels, precision)
    by_l2_module_time = _l2_module_time_from_rows(quality_yes_rows, time_labels, precision)

    return {
        "time_labels": time_labels,
        "precision": precision,
        "trend": {
            "total": _series_for_rows(all_rows, time_labels, precision),
            "quality_yes": _series_for_rows(quality_yes_rows, time_labels, precision),
            "known": _series_for_rows(known_rows, time_labels, precision),
            "new": _series_for_rows(new_rows, time_labels, precision),
        },
        "by_version_time": {
            ver: _series_for_rows([t for t in all_rows if _ticket_version(t) == ver], time_labels, precision)
            for ver in versions_for_series
        },
        "by_r_version_time": {
            name: _series_for_rows([t for t in all_rows if _r_of_version(_ticket_version(t)) == name], time_labels, precision)
            for name in OWNERSHIP_R_LINES
        },
        "by_c_version_time": _by_c_version_time_from_rows(all_rows, time_labels, precision),
        "by_version_time_quality": q_by_version_time,
        "by_c_version_time_quality": q_by_c_version_time,
        "by_r_version_time_quality": q_by_r_version_time,
        "by_issue_type_time": by_issue_type_time,
        "by_l2_module_time": by_l2_module_time,
        "sunburst": {
            "intro": _build_sunburst(all_rows, "intro"),
            "owner": _build_sunburst(all_rows, "owner"),
        },
        "l1_bars": l1_bars,
        "l1_module_options": _l1_module_options(resolved_l1_labels),
        "top_site": _top_entries(by_site, 20),
        "top_site_quality": _top_entries(by_site_quality, 20),
        "top_inst_site": _top_entries({k: len(v) for k, v in by_site_inst.items()}, 20),
        "top_ver": _top_entries(by_version_chart, 20),
        "top_inst_ver": _top_entries(
            _count_by([t for t in all_rows if _is_open(t)], _ticket_version), 20
        ),
        "core_bars": core_bars,
        "version_category_table": {
            "rows": version_cat_rows,
            "cols": version_cat_cols,
            "cells": version_cat_cells,
        },
        "stage_pie": _top_entries(by_problem_stage, None),
        "env_pie": _top_entries(by_problem_env, None),
        "source_pie": _top_entries(by_product_line, None),
        "quality_source_pie": _top_entries(by_product_line_quality, None),
    }


def build_labor_payload(
    rows: list[dict[str, Any]],
    admin_users: list[dict[str, Any]],
    product_line: str,
    *,
    include_collab: bool = False,
    person_stage_counts: dict[str, dict[str, int]] | None = None,
    person_stage_hours: dict[str, dict[str, float]] | None = None,
    stage_hours: dict[str, float] | None = None,
) -> dict[str, Any]:
    """人力投入聚合。

    `by_person` / `by_group_person`（人力投入统计图）：按提交经手人计票，
    同人同单最多 +1；`include_collab=True` 时并入协同处理人。
    `by_person_stage`（各阶段人员滞留次数）：优先用节点实例历史
    （`person_stage_counts`）；缺省时回退当前阶段（关闭→审核关闭）。
    `dwell.by_person_stage_hours`（各阶段人员平均滞留）：优先用节点实例
    平均小时；缺省时回退「当前阶段 + 建单时长」。
    `dwell.by_stage_hours`（各阶段问题平均滞留）：优先用节点实例阶段平均小时
    （走过即计）；缺省时回退「当前阶段 + 建单时长」。
    其余滞留/阶段类图仍按当前处理人（关单回落创建人）口径。
    """

    def owner_person(t: dict[str, Any]) -> str:
        raw = str(t.get("currentHandler") or t.get("assignee") or t.get("creatorName") or "").strip()
        return _normalize_person_name(raw) or "未分配"

    pl = str(product_line or "").strip()

    # 滞留/阶段类图：按当前归属人产品线筛工单（与历史行为一致）
    chart_rows = rows
    if pl:
        chart_rows = [t for t in rows if _person_product_line(owner_person(t), admin_users) == pl]

    groups = sorted({_ticket_group(t, admin_users) for t in chart_rows}, key=lambda x: x)
    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    # 人力投入统计：在时间范围内全部工单上按经手人计票，再按人员产品线筛柱
    by_person: dict[str, int] = defaultdict(int)
    by_group_person: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in rows:
        people = _labor_input_people(t, include_collab=include_collab)
        if pl:
            people = [p for p in people if _person_product_line(p, admin_users) == pl]
        for p in people:
            by_person[p] += 1
            by_group_person[_ticket_group({"currentHandler": p, "creatorName": p}, admin_users)][p] += 1

    open_rows = [t for t in chart_rows if _is_open(t)]
    by_person_open = _count_by(open_rows, owner_person)
    by_stage_open = _count_by(open_rows, _ticket_stage)

    by_group_stage_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_person_stage_open_acc: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in open_rows:
        stage = _ticket_stage(t)
        by_group_stage_open[_ticket_group(t, admin_users)][stage] += 1
        by_person_stage_open_acc[owner_person(t)][stage] += 1
    by_person_stage_open = {p: dict(v) for p, v in by_person_stage_open_acc.items()}

    by_stage_all = _count_by(chart_rows, _ticket_stage)
    by_person_current_stage_acc: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in chart_rows:
        by_person_current_stage_acc[owner_person(t)][_ticket_stage(t)] += 1
    by_person_current_stage = {p: dict(v) for p, v in by_person_current_stage_acc.items()}

    if stage_hours is not None:
        dwell_by_stage = {s: float(stage_hours.get(s) or 0.0) for s in LABOR_STACK_STAGES}
    else:
        dwell_by_stage = {}
        for stage in LABOR_STACK_STAGES:
            stage_rows = [t for t in chart_rows if _ticket_stage(t) == stage]
            if not stage_rows:
                dwell_by_stage[stage] = 0.0
                continue
            total_h = 0.0
            for t in stage_rows:
                created = t.get("createdAt") or ""
                try:
                    if isinstance(created, str) and created:
                        ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() * 1000
                    else:
                        ts = now_ms
                except ValueError:
                    ts = now_ms
                total_h += max(0.0, (now_ms - ts) / 3600000.0)
            dwell_by_stage[stage] = round(total_h / len(stage_rows))

    if person_stage_hours is not None:
        by_person_stage_hours = {
            str(p): {str(st): float(h) for st, h in (stages or {}).items()}
            for p, stages in person_stage_hours.items()
        }
        if pl:
            by_person_stage_hours = {
                p: v
                for p, v in by_person_stage_hours.items()
                if _person_product_line(p, admin_users) == pl
            }
    else:
        # 回退：当前归属人 × 当前阶段，值为建单至今小时（与旧 by_stage_hours 同口径）
        by_person_stage_hours_acc: dict[str, dict[str, list[float]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for t in chart_rows:
            stage = _labor_person_stack_stage(t)
            if stage not in LABOR_STACK_STAGES:
                continue
            created = t.get("createdAt") or ""
            try:
                if isinstance(created, str) and created:
                    ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() * 1000
                else:
                    ts = now_ms
            except ValueError:
                ts = now_ms
            by_person_stage_hours_acc[owner_person(t)][stage].append(
                max(0.0, (now_ms - ts) / 3600000.0)
            )
        by_person_stage_hours = {
            p: {st: round(sum(vals) / len(vals)) for st, vals in stages.items() if vals}
            for p, stages in by_person_stage_hours_acc.items()
        }

    if person_stage_counts is not None:
        by_person_stage = {
            str(p): {str(st): int(c) for st, c in (stages or {}).items()}
            for p, stages in person_stage_counts.items()
        }
        if pl:
            by_person_stage = {
                p: v
                for p, v in by_person_stage.items()
                if _person_product_line(p, admin_users) == pl
            }
    else:
        by_person_stage_acc: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for t in chart_rows:
            by_person_stage_acc[owner_person(t)][_labor_person_stack_stage(t)] += 1
        by_person_stage = {p: dict(v) for p, v in by_person_stage_acc.items()}

    by_person_flow: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in chart_rows:
        p = owner_person(t)
        g = _ticket_group(t, admin_users)
        if _is_open(t):
            by_group_person_open[g][p] += 1
    for t in rows:
        flow_key = str(t.get("_laborFlowKey") or "").strip()
        if flow_key not in (LABOR_FLOW_COMMANDO, LABOR_FLOW_INDEPENDENT):
            continue
        # 流转详细占比归属：运维分析最后提交人
        flow_person_raw = str(t.get("_laborFlowPerson") or "").strip()
        flow_person = _normalize_person_name(flow_person_raw) if flow_person_raw else ""
        if not flow_person:
            continue
        if pl and _person_product_line(flow_person, admin_users) != pl:
            continue
        by_person_flow[flow_person][flow_key] += 1

    return {
        "groups": groups,
        "stages": list(LABOR_STACK_STAGES),
        "pie_stages": list(LABOR_PIE_STAGES),
        "counts": {
            "by_person": dict(by_person),
            "by_person_open": by_person_open,
            "by_stage_open": dict(by_stage_open),
            "by_group_stage_open": {g: dict(v) for g, v in by_group_stage_open.items()},
            "by_stage_all": by_stage_all,
            "by_person_current_stage": by_person_current_stage,
            "by_person_stage": {p: dict(v) for p, v in by_person_stage.items()},
            "by_person_stage_open": by_person_stage_open,
            "by_person_flow": {p: dict(v) for p, v in by_person_flow.items()},
            "by_group_person": {g: dict(v) for g, v in by_group_person.items()},
            "by_group_person_open": {g: dict(v) for g, v in by_group_person_open.items()},
        },
        "dwell": {
            "by_stage_hours": dwell_by_stage,
            "by_person_stage_hours": {
                p: dict(v) for p, v in by_person_stage_hours.items()
            },
        },
    }


def _classify_single_phase_doer(vals: dict[str, Any] | None) -> str:
    if not vals:
        return "not_filled"
    val = str(vals.get("use_doer_assist") or "")
    mapping = {
        "使用Doer，问题定位/解决": "doer_resolved",
        "使用Doer，仅提供思路/辅助提效": "doer_helped",
        "使用Doer，无帮助": "doer_no_help",
        "未使用Doer": "no_doer",
        "紧急疑难工单": "urgent_hard",
    }
    if val in mapping:
        return mapping[val]
    if not val:
        return "not_filled"
    return "unknown"


def _classify_doer_multi(nodes: dict[str, Any], include_ops: bool, include_dev: bool) -> str:
    cats: list[str] = []
    if include_ops:
        cats.append(_classify_single_phase_doer(nodes.get("ops_analysis")))
    if include_dev:
        cats.append(_classify_single_phase_doer(nodes.get("dev_analysis")))
    if not cats:
        return "unknown"
    best = "unknown"
    best_p = -1
    for cat in cats:
        p = DOER_CATEGORY_PRIORITY.get(cat, 0)
        if p > best_p:
            best_p = p
            best = cat
    return best


def _is_consult_ticket(nodes: dict[str, Any]) -> bool:
    ops = nodes.get("ops_analysis") or {}
    dev = nodes.get("dev_analysis") or {}
    return str(ops.get("is_consult_issue") or "") == "是" or str(dev.get("is_consult_issue") or "") == "是"


def _consult_efficiency_block(items: list[dict[str, Any]], *, consult: bool) -> dict[str, Any]:
    filtered = [it for it in items if _is_consult_ticket(it.get("nodes") or {}) == consult]
    used: list[dict[str, Any]] = []
    not_used: list[dict[str, Any]] = []
    for it in filtered:
        cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            used.append(it)
        elif cat == "no_doer":
            not_used.append(it)

    stages = [DOER_STAGE_NAMES[k] for k in DOER_STAGE_KEYS]

    def avg_hours(tickets: list[dict[str, Any]], node_key: str) -> float:
        hours = [
            float((t.get("instances") or {}).get(node_key, {}).get("hours") or 0)
            for t in tickets
            if float((t.get("instances") or {}).get(node_key, {}).get("hours") or 0) > 0
        ]
        if not hours:
            return 0.0
        return sum(hours) / len(hours)

    avg_used = [round(avg_hours(used, k), 2) for k in DOER_STAGE_KEYS]
    avg_no = [round(avg_hours(not_used, k), 2) for k in DOER_STAGE_KEYS]
    gains = [
        round(((avg_no[i] - avg_used[i]) / avg_no[i]) * 100) if avg_no[i] else 0 for i in range(len(stages))
    ]
    valid_gains = [g for g in gains if g > 0]
    avg_gain = round(sum(valid_gains) / len(valid_gains)) if valid_gains else 0
    max_gain = max(gains) if gains else 0
    max_stage = stages[gains.index(max_gain)] if max_gain else ""

    return {
        "stages": stages,
        "stageKeys": list(DOER_STAGE_KEYS),
        "avgHoursUsedDoer": avg_used,
        "avgHoursNoDoer": avg_no,
        "efficiencyGains": gains,
        "avgEfficiencyGain": avg_gain,
        "maxGainStage": max_stage,
        "maxGainValue": max_gain,
        "usedDoerCount": len(used),
        "noDoerCount": len(not_used),
        "totalConsultCount": len(filtered) if consult else 0,
        "totalNonConsultCount": len(filtered) if not consult else 0,
    }


def _fetch_doer_items(conn: psycopg.Connection, ticket_ids: list[int]) -> list[dict[str, Any]]:
    from routers.tickets import SCHEMA_TEMPLATE_CODE, PERSON_VALUE_FIELD_KEYS, _normalize_person_field_value
    from utils.ticket_closed_at import closed_at_iso, fetch_ticket_closed_at_by_id

    if not ticket_ids:
        return []

    node_data_rows = conn.execute(
        """
        SELECT tnd.ticket_id, wn.node_key, tnd.values_json
        FROM ticket_node_data tnd
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE tnd.ticket_id = ANY(%s) AND wt.template_code = %s
        ORDER BY tnd.ticket_id, wn.node_key, tnd.created_at DESC
        """,
        (ticket_ids, SCHEMA_TEMPLATE_CODE),
    ).fetchall()

    by_ticket_node: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    for ndr in node_data_rows:
        tid = int(ndr["ticket_id"])
        nk = str(ndr["node_key"])
        if nk in by_ticket_node[tid]:
            continue
        raw_vals = ndr["values_json"]
        vals = dict(raw_vals) if isinstance(raw_vals, dict) else {}
        for pk in PERSON_VALUE_FIELD_KEYS:
            if pk in vals and isinstance(vals[pk], str):
                vals[pk] = _normalize_person_field_value(pk, vals[pk])
        by_ticket_node[tid][nk] = vals

    instance_rows = conn.execute(
        """
        SELECT tni.ticket_id, wn.node_key, tni.started_at, tni.ended_at
        FROM ticket_node_instance tni
        JOIN workflow_node wn ON wn.id = tni.node_id
        WHERE tni.ticket_id = ANY(%s) AND wn.node_key = ANY(%s)
        """,
        (ticket_ids, list(DOER_STAGE_KEYS)),
    ).fetchall()

    now_utc = datetime.now(timezone.utc)
    by_ticket_instance: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    for ir in instance_rows:
        tid = int(ir["ticket_id"])
        nk = str(ir["node_key"])
        st = ir["started_at"]
        et = ir["ended_at"] or now_utc
        if st:
            hours = max(0.0, (et - st).total_seconds() / 3600.0)
            by_ticket_instance[tid][nk] = {"hours": round(hours, 2)}

    closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ticket_ids)
    meta_rows = conn.execute(
        "SELECT id, ticket_no, created_at FROM ticket WHERE id = ANY(%s)",
        (ticket_ids,),
    ).fetchall()
    meta_by_id = {int(r["id"]): r for r in meta_rows}

    items: list[dict[str, Any]] = []
    for tid in ticket_ids:
        meta = meta_by_id.get(tid)
        if not meta:
            continue
        created = meta["created_at"]
        closed = closed_at_by_id.get(tid)
        items.append(
            {
                "ticket_no": str(meta["ticket_no"]),
                "nodes": by_ticket_node.get(tid, {}),
                "instances": by_ticket_instance.get(tid, {}),
                "created_at": created.isoformat() if hasattr(created, "isoformat") else str(created or ""),
                "closed_at": closed_at_iso(closed),
            }
        )
    return items


def build_doer_payload(
    conn: psycopg.Connection,
    rows: list[dict[str, Any]],
    include_ops: bool,
    include_dev: bool,
) -> dict[str, Any]:
    ticket_nos = [str(t.get("orderId") or "") for t in rows if t.get("orderId")]
    if not ticket_nos:
        empty_slices = [
            {"label": "问题定位/解决", "value": 0},
            {"label": "思路/辅助提效", "value": 0},
            {"label": "无帮助", "value": 0},
            {"label": "未使用Doer", "value": 0},
            {"label": "紧急疑难工单", "value": 0},
            {"label": "未填写", "value": 0},
        ]
        return {
            "total": 0,
            "doerResolved": 0,
            "doerHelped": 0,
            "doerNoHelp": 0,
            "noDoer": 0,
            "urgentHard": 0,
            "notFilled": 0,
            "unknown": 0,
            "usedDoer": 0,
            "effective": 0,
            "filledTotal": 0,
            "includeOps": include_ops,
            "includeDev": include_dev,
            "usageSlices": empty_slices,
            "effectivenessSlices": [
                {"label": "有效(定位/解决+辅助提效)", "value": 0},
                {"label": "无帮助", "value": 0},
            ],
            "consultEfficiency": _consult_efficiency_block([], consult=True),
            "nonConsultEfficiency": _consult_efficiency_block([], consult=False),
            "dailyClosed": {"labels": [], "values": [], "totalCount": 0, "avgDuration": 0},
            "dailyDoerUsage": {"labels": [], "barValues": [], "lineValues": [], "totalUsedDoer": 0, "totalTickets": 0, "avgPct": 0},
            "dailyConsult": {"labels": [], "barValues": [], "lineValues": [], "totalConsult": 0, "totalTickets": 0, "avgPct": 0},
            "monthlyConsult": {"labels": [], "barValues": [], "lineValues": []},
            "dailyDoerEffectiveness": {"labels": [], "barValues": [], "lineValues": [], "avgRate": 0},
        }

    id_rows = conn.execute(
        "SELECT id, ticket_no FROM ticket WHERE ticket_no = ANY(%s)",
        (ticket_nos,),
    ).fetchall()
    ticket_ids = [int(r["id"]) for r in id_rows]
    items = _fetch_doer_items(conn, ticket_ids)

    counts = defaultdict(int)
    for it in items:
        counts[_classify_doer_multi(it.get("nodes") or {}, include_ops, include_dev)] += 1

    doer_resolved = counts["doer_resolved"]
    doer_helped = counts["doer_helped"]
    doer_no_help = counts["doer_no_help"]
    no_doer = counts["no_doer"]
    urgent_hard = counts["urgent_hard"]
    not_filled = counts["not_filled"]
    unknown = counts["unknown"]
    total = len(items)
    used_doer = doer_resolved + doer_helped + doer_no_help
    effective = doer_resolved + doer_helped
    filled_total = used_doer + no_doer + urgent_hard

    # daily closed avg duration
    closed = [it for it in items if it.get("closed_at") and it.get("created_at")]
    by_closed: dict[str, list[float]] = defaultdict(list)
    for it in closed:
        try:
            c0 = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00"))
            c1 = datetime.fromisoformat(str(it["closed_at"]).replace("Z", "+00:00"))
            hours = (c1 - c0).total_seconds() / 3600.0
            ymd = c1.astimezone(timezone.utc).strftime("%Y-%m-%d")
            by_closed[ymd].append(hours)
        except ValueError:
            continue
    sorted_closed_dates = sorted(by_closed.keys())
    daily_closed_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_closed_dates]
    daily_closed_values = [
        round(sum(by_closed[d]) / len(by_closed[d]), 1) if by_closed[d] else 0 for d in sorted_closed_dates
    ]
    total_dur = sum(h for vals in by_closed.values() for h in vals)
    avg_dur = round(total_dur / len(closed), 1) if closed else 0

    # daily doer usage
    by_created: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "usedDoer": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            ymd = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            continue
        by_created[ymd]["total"] += 1
        cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            by_created[ymd]["usedDoer"] += 1
    sorted_created = sorted(by_created.keys())
    daily_doer_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_created]
    daily_doer_bars = [by_created[d]["usedDoer"] for d in sorted_created]
    daily_doer_lines = [
        round(by_created[d]["usedDoer"] / by_created[d]["total"] * 100) if by_created[d]["total"] else 0
        for d in sorted_created
    ]
    tot_used = sum(daily_doer_bars)
    tot_tix = sum(by_created[d]["total"] for d in sorted_created)

    # daily consult
    by_consult_day: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "consult": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            ymd = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            continue
        by_consult_day[ymd]["total"] += 1
        if _is_consult_ticket(it.get("nodes") or {}):
            by_consult_day[ymd]["consult"] += 1
    sorted_consult = sorted(by_consult_day.keys())
    daily_consult_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_consult]
    daily_consult_bars = [by_consult_day[d]["consult"] for d in sorted_consult]
    daily_consult_lines = [
        round(by_consult_day[d]["consult"] / by_consult_day[d]["total"] * 100)
        if by_consult_day[d]["total"]
        else 0
        for d in sorted_consult
    ]

    tot_consult = sum(daily_consult_bars)
    tot_consult_tix = sum(by_consult_day[d]["total"] for d in sorted_consult)
    avg_consult_pct = round(tot_consult / tot_consult_tix * 100) if tot_consult_tix else 0

    # monthly consult
    by_month: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "consult": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            dt = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00"))
            ym = dt.strftime("%Y-%m")
        except ValueError:
            continue
        by_month[ym]["total"] += 1
        if _is_consult_ticket(it.get("nodes") or {}):
            by_month[ym]["consult"] += 1
    sorted_months = sorted(by_month.keys())
    monthly_labels = sorted_months
    monthly_bars = [by_month[m]["consult"] for m in sorted_months]
    monthly_lines = [
        round(by_month[m]["consult"] / by_month[m]["total"] * 100) if by_month[m]["total"] else 0
        for m in sorted_months
    ]

    # daily doer effectiveness
    by_eff: dict[str, dict[str, int]] = defaultdict(lambda: {"used": 0, "effective": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            ymd = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            continue
        cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            by_eff[ymd]["used"] += 1
            if cat in ("doer_resolved", "doer_helped"):
                by_eff[ymd]["effective"] += 1
    sorted_eff = sorted(by_eff.keys())
    eff_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_eff]
    eff_bars = [by_eff[d]["effective"] for d in sorted_eff]
    eff_lines = [
        round(by_eff[d]["effective"] / by_eff[d]["used"] * 100) if by_eff[d]["used"] else 0 for d in sorted_eff
    ]
    avg_rate = round(sum(eff_bars) / tot_used * 100) if tot_used else 0

    consult_block = _consult_efficiency_block(items, consult=True)
    non_consult_block = _consult_efficiency_block(items, consult=False)

    return {
        "total": total,
        "doerResolved": doer_resolved,
        "doerHelped": doer_helped,
        "doerNoHelp": doer_no_help,
        "noDoer": no_doer,
        "urgentHard": urgent_hard,
        "notFilled": not_filled,
        "unknown": unknown,
        "usedDoer": used_doer,
        "effective": effective,
        "filledTotal": filled_total,
        "includeOps": include_ops,
        "includeDev": include_dev,
        "usageSlices": [
            {"label": "问题定位/解决", "value": doer_resolved},
            {"label": "思路/辅助提效", "value": doer_helped},
            {"label": "无帮助", "value": doer_no_help},
            {"label": "未使用Doer", "value": no_doer},
            {"label": "紧急疑难工单", "value": urgent_hard},
            {"label": "未填写", "value": not_filled},
        ],
        "effectivenessSlices": [
            {"label": "有效(定位/解决+辅助提效)", "value": effective},
            {"label": "无帮助", "value": doer_no_help},
        ],
        "consultEfficiency": consult_block,
        "nonConsultEfficiency": non_consult_block,
        "dailyClosed": {
            "labels": daily_closed_labels,
            "values": daily_closed_values,
            "totalCount": len(closed),
            "avgDuration": avg_dur,
        },
        "dailyDoerUsage": {
            "labels": daily_doer_labels,
            "barValues": daily_doer_bars,
            "lineValues": daily_doer_lines,
            "totalUsedDoer": tot_used,
            "totalTickets": tot_tix,
            "avgPct": round(tot_used / tot_tix * 100) if tot_tix else 0,
        },
        "dailyConsult": {
            "labels": daily_consult_labels,
            "barValues": daily_consult_bars,
            "lineValues": daily_consult_lines,
            "totalConsult": tot_consult,
            "totalTickets": tot_consult_tix,
            "avgPct": avg_consult_pct,
        },
        "monthlyConsult": {
            "labels": monthly_labels,
            "barValues": monthly_bars,
            "lineValues": monthly_lines,
            "totalConsult": sum(monthly_bars),
            "totalTickets": sum(by_month[m]["total"] for m in sorted_months),
            "avgPct": round(sum(monthly_bars) / sum(by_month[m]["total"] for m in sorted_months) * 100)
            if sorted_months and sum(by_month[m]["total"] for m in sorted_months)
            else 0,
        },
        "dailyDoerEffectiveness": {
            "labels": eff_labels,
            "barValues": eff_bars,
            "lineValues": eff_lines,
            "totalUsedDoer": tot_used,
            "totalEffective": sum(eff_bars),
            "avgRate": avg_rate,
            "avgPct": avg_rate,
        },
    }


def _ownership_segment_key(quality: str, component: str) -> str:
    q = str(quality or "all").strip().lower()
    c = str(component or "all").strip().lower()
    if q not in ("known", "new", "no", "yes"):
        q = "all"
    if c not in ("kernel", "control"):
        c = "all"
    return f"{q}_{c}"


def _ownership_payload_empty(payload: dict[str, Any]) -> bool:
    """问题归属 payload 是否无任何可展示计数（趋势 / 旭日图为空）。"""
    trend_total = sum(payload.get("trend", {}).get("total") or [])
    sun = payload.get("sunburst") or {}
    has_sun = bool(sun.get("intro") or sun.get("owner"))
    return trend_total <= 0 and not has_sun


def _daily_slices_missing_ownership_field(
    daily_slices: list[dict[str, Any]], segment_key: str, field: str
) -> bool:
    """旧日汇总缺某 ownership 计数字典：有工单的切片缺该键则视为不完整。"""
    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        if int(seg.get("total") or 0) > 0 and not (seg.get(field) or {}):
            return True
    return False


def _daily_slices_missing_problem_env(
    daily_slices: list[dict[str, Any]], segment_key: str
) -> bool:
    """旧日汇总无 by_problem_env：有工单的切片缺该键则视为不完整。"""
    return _daily_slices_missing_ownership_field(daily_slices, segment_key, "by_problem_env")


def _daily_slices_missing_product_line(
    daily_slices: list[dict[str, Any]], segment_key: str
) -> bool:
    """旧日汇总无 by_product_line：有工单的切片缺该键则视为不完整。"""
    return _daily_slices_missing_ownership_field(daily_slices, segment_key, "by_product_line")


def _daily_slices_missing_issue_type(
    daily_slices: list[dict[str, Any]], segment_key: str
) -> bool:
    """旧日汇总无 by_issue_type：有工单的切片缺该键则视为不完整。"""
    return _daily_slices_missing_ownership_field(daily_slices, segment_key, "by_issue_type")


def _patch_ownership_pies_from_rows(
    payload: dict[str, Any],
    rows: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
    *,
    patch_stage: bool = False,
    patch_env: bool = True,
    patch_source: bool = False,
) -> dict[str, Any]:
    """日汇总缺阶段/环境/产品线饼图时，用快照行级聚合补齐。"""
    if not rows or (not patch_stage and not patch_env and not patch_source):
        return payload
    row_payload = build_ownership_payload(rows, start_date, end_date, precision, quality, component)
    if patch_stage:
        payload["stage_pie"] = row_payload.get("stage_pie") or []
    if patch_env:
        payload["env_pie"] = row_payload.get("env_pie") or []
    if patch_source:
        payload["source_pie"] = row_payload.get("source_pie") or []
        payload["quality_source_pie"] = row_payload.get("quality_source_pie") or []
    return payload


def _ownership_l1_bars_empty(l1_bars: dict[str, Any] | None) -> bool:
    """质量问题TOP高发模块柱图是否全空（任一组有数据即视为非空）。"""
    if not l1_bars:
        return True
    for kind in l1_bars.values():
        if not isinstance(kind, dict):
            continue
        for entries in kind.values():
            if entries:
                return False
    return True


def _patch_l1_bars_from_rows(
    payload: dict[str, Any],
    rows: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
    l1_labels: list[str] | None = None,
) -> dict[str, Any]:
    """日汇总 l1_bars 缺失或全空时，用快照行级聚合补齐（与 build_ownership_payload 口径一致）。"""
    if not rows:
        return payload
    if l1_labels is None:
        l1_labels = [
            str(x.get("key") or "").strip()
            for x in (payload.get("l1_module_options") or [])
            if str(x.get("key") or "").strip()
        ] or None
    row_payload = build_ownership_payload(
        rows, start_date, end_date, precision, quality, component, l1_labels=l1_labels
    )
    row_l1 = row_payload.get("l1_bars") or {}
    cur = payload.get("l1_bars") or {}
    merged: dict[str, dict[str, list[dict[str, Any]]]] = {"intro": {}, "owner": {}}
    for kind in ("intro", "owner"):
        keys = set((cur.get(kind) or {}).keys()) | set((row_l1.get(kind) or {}).keys())
        for key in keys:
            cur_entries = (cur.get(kind) or {}).get(key) or []
            row_entries = (row_l1.get(kind) or {}).get(key) or []
            merged[kind][key] = cur_entries if cur_entries else row_entries
    payload["l1_bars"] = merged
    if not payload.get("l1_module_options"):
        payload["l1_module_options"] = row_payload.get("l1_module_options") or []
    return payload


def _ownership_scoped_charts_empty(payload: dict[str, Any]) -> bool:
    """质量问题筛选所涉图表（版本/模块/来源/R/CORE）是否全空。"""
    sun = payload.get("sunburst") or {}
    if sun.get("intro") or sun.get("owner"):
        return False
    l1 = payload.get("l1_bars") or {}
    for kind in l1.values():
        if isinstance(kind, dict) and kind:
            return False
    bvt = payload.get("by_version_time") or {}
    if any(sum(v or []) for v in bvt.values()):
        return False
    rvt = payload.get("by_r_version_time") or {}
    if any(sum(v or []) for v in rvt.values()):
        return False
    if payload.get("core_bars"):
        return False
    vcat = payload.get("version_category_table") or {}
    if vcat.get("cells"):
        return False
    return True


def _ownership_quality_version_time_empty(payload: dict[str, Any]) -> bool:
    """质量问题版本趋势是否无有效计数。"""
    bvt = payload.get("by_version_time_quality") or {}
    return not any(sum(int(n or 0) for n in (pts or [])) > 0 for pts in bvt.values())


def _ownership_issue_type_time_empty(payload: dict[str, Any]) -> bool:
    """TOP类型问题趋势是否无有效计数。"""
    b = payload.get("by_issue_type_time") or {}
    return not any(sum(int(n or 0) for n in (pts or [])) > 0 for pts in b.values())


def _ownership_l2_module_time_empty(payload: dict[str, Any]) -> bool:
    """TOP高发模块问题趋势是否无有效计数。"""
    b = payload.get("by_l2_module_time") or {}
    return not any(sum(int(n or 0) for n in (pts or [])) > 0 for pts in b.values())


def _patch_quality_version_time_from_rows(
    payload: dict[str, Any],
    rows: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
) -> dict[str, Any]:
    """旧日汇总缺 yes_* 分段或问题类型/二级模块时，用行级聚合补齐质量问题版本趋势、类型趋势、模块趋势、来源分布与 TOP 局点。"""
    if not rows:
        return payload
    row_payload = build_ownership_payload(rows, start_date, end_date, precision, quality, component)
    payload["by_version_time_quality"] = row_payload.get("by_version_time_quality") or {}
    payload["by_c_version_time_quality"] = row_payload.get("by_c_version_time_quality") or {}
    payload["by_r_version_time_quality"] = row_payload.get("by_r_version_time_quality") or {}
    payload["by_issue_type_time"] = row_payload.get("by_issue_type_time") or {}
    payload["by_l2_module_time"] = row_payload.get("by_l2_module_time") or {}
    payload["quality_source_pie"] = row_payload.get("quality_source_pie") or []
    payload["top_site_quality"] = row_payload.get("top_site_quality") or []
    return payload


def _build_ownership_payload_resolved(
    conn: psycopg.Connection,
    op: str,
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
    *,
    only_self: bool,
    use_daily: bool,
    daily: dict[str, Any] | None,
    row_fallback: bool,
) -> dict[str, Any]:
    q = str(quality or "all")
    c = str(component or "all")
    l1_labels = load_duty_field_l1_labels(conn, c) or None
    if use_daily and daily is not None:
        slices = daily["daily_slices"]
        payload = build_ownership_payload_from_daily_slices(
            slices, start_date, end_date, precision, q, c, l1_labels=l1_labels
        )
        need_fb = row_fallback and (
            (_ownership_payload_empty(payload) and (q != "all" or c != "all"))
            or (q != "all" and _ownership_scoped_charts_empty(payload))
        )
        rows: list[dict[str, Any]] | None = None
        if need_fb:
            rows = fetch_stats_tickets(conn, op, start_date, end_date, only_self=only_self)
            filtered = _filter_ownership_rows(rows, q, c)
            if filtered:
                payload = build_ownership_payload(
                    rows, start_date, end_date, precision, q, c, l1_labels=l1_labels
                )
        else:
            if _ownership_l1_bars_empty(payload.get("l1_bars") or {}):
                rows = fetch_stats_tickets(conn, op, start_date, end_date, only_self=only_self)
                payload = _patch_l1_bars_from_rows(
                    payload, rows, start_date, end_date, precision, q, c, l1_labels=l1_labels
                )
            sk = _ownership_segment_key(q, c)
            miss_env = _daily_slices_missing_problem_env(slices, sk)
            miss_source = _daily_slices_missing_product_line(slices, sk)
            if miss_env or miss_source:
                if rows is None:
                    rows = fetch_stats_tickets(conn, op, start_date, end_date, only_self=only_self)
                payload = _patch_ownership_pies_from_rows(
                    payload,
                    rows,
                    start_date,
                    end_date,
                    precision,
                    q,
                    c,
                    patch_env=miss_env,
                    patch_source=miss_source,
                )
        sk_yes = _ownership_segment_key("yes", c)
        miss_issue_type = _daily_slices_missing_issue_type(slices, sk_yes)
        if (
            sum(int(n or 0) for n in (payload.get("trend") or {}).get("quality_yes") or []) > 0
            and (
                _ownership_quality_version_time_empty(payload)
                or _ownership_issue_type_time_empty(payload)
                or _ownership_l2_module_time_empty(payload)
                or miss_issue_type
            )
        ):
            if rows is None:
                rows = fetch_stats_tickets(conn, op, start_date, end_date, only_self=only_self)
            payload = _patch_quality_version_time_from_rows(
                payload, rows, start_date, end_date, precision, q, c
            )
        return payload
    rows = fetch_stats_tickets(conn, op, start_date, end_date, only_self=only_self)
    return build_ownership_payload(rows, start_date, end_date, precision, q, c, l1_labels=l1_labels)


def _sum_slice_maps(slices: list[dict[str, Any]], segment_key: str, field: str) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for sl in slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        src = seg.get(field) or {}
        if isinstance(src, dict):
            for k, v in src.items():
                if isinstance(v, (int, float)):
                    out[str(k)] += int(v)
    return dict(out)


def _ownership_version_time_maps_from_slices(
    daily_slices: list[dict[str, Any]],
    segment_key: str,
    time_labels: list[str],
    precision: str,
) -> tuple[dict[str, list[int]], dict[str, list[int]], dict[str, list[int]]]:
    """日汇总 B / C / R 版本 × 时间序列（与 by_version_time 口径一致）。"""
    idx = {lab: i for i, lab in enumerate(time_labels)}
    by_version_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    by_c_version_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    by_r_version_time: dict[str, list[int]] = {name: [0] * len(time_labels) for name in OWNERSHIP_R_LINES}
    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        ymd = str(sl.get("stats_day") or "")
        lab = _bucket_label(ymd, precision)
        i = idx.get(lab)
        if i is None:
            continue
        for ver, cnt in (seg.get("by_version") or {}).items():
            n = int(cnt)
            if n <= 0:
                continue
            ver_s = str(ver)
            by_version_time[ver_s][i] += n
            c_ver = _c_of_version(ver_s)
            if c_ver:
                by_c_version_time[c_ver][i] += n
        for r_ver, cnt in (seg.get("by_r_version") or {}).items():
            if r_ver in by_r_version_time:
                by_r_version_time[r_ver][i] += int(cnt)
    by_version_chart = _drop_unknown_version_counts(_sum_slice_maps(daily_slices, segment_key, "by_version"))
    versions = sorted(by_version_chart.keys(), key=lambda k: (-by_version_chart[k], k))
    by_version_out = {ver: by_version_time.get(ver, [0] * len(time_labels)) for ver in versions}
    return by_version_out, _finalize_c_version_time(by_c_version_time, time_labels), by_r_version_time


def _module_l2_from_compound(path: str) -> str:
    parts = [p.strip() for p in str(path or "").split("/") if p.strip()]
    return parts[1] if len(parts) >= 2 else "未填写"


def _l1_label_matches_path(path_s: str, l1_label: str) -> bool:
    """一级模块筛选：label 为空表示全部一级。"""
    if not str(l1_label or "").strip():
        return True
    got = path_s.split("/")[0] if path_s else _OWNERSHIP_MODULE_NOT_FILLED
    return got == l1_label


def _aggregate_l1_l2_counts_from_slices(
    daily_slices: list[dict[str, Any]],
    segment_key: str,
    l1_label: str,
    *,
    dedup: bool,
    l2_field: str,
    no_dts_field: str,
    dts_path_field: str,
) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    if dedup:
        seen_dts: set[str] = set()
        for sl in daily_slices:
            seg = (sl.get("ownership") or {}).get(segment_key) or {}
            for path, cnt in (seg.get(no_dts_field) or {}).items():
                path_s = str(path)
                if not _l1_label_matches_path(path_s, l1_label):
                    continue
                counts[_module_l2_from_compound(path_s)] += int(cnt)
            for dts, path in (seg.get(dts_path_field) or {}).items():
                dts_s = str(dts).strip()
                if not dts_s or dts_s in seen_dts:
                    continue
                path_s = str(path)
                if not _l1_label_matches_path(path_s, l1_label):
                    continue
                seen_dts.add(dts_s)
                counts[_module_l2_from_compound(path_s)] += 1
        if not counts:
            for sl in daily_slices:
                seg = (sl.get("ownership") or {}).get(segment_key) or {}
                for path, cnt in (seg.get(l2_field) or {}).items():
                    path_s = str(path)
                    if not _l1_label_matches_path(path_s, l1_label):
                        continue
                    counts[_module_l2_from_compound(path_s)] += int(cnt)
        return dict(counts)

    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        for path, cnt in (seg.get(l2_field) or {}).items():
            path_s = str(path)
            if not _l1_label_matches_path(path_s, l1_label):
                continue
            counts[_module_l2_from_compound(path_s)] += int(cnt)
    return dict(counts)


def build_ownership_payload_from_daily_slices(
    daily_slices: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
    l1_labels: list[str] | None = None,
) -> dict[str, Any]:
    sk = _ownership_segment_key(quality, component)
    sk_yes = _ownership_segment_key("yes", component)
    time_labels = _build_time_labels(start_date, end_date, precision)
    idx = {lab: i for i, lab in enumerate(time_labels)}
    trend_total = [0] * len(time_labels)
    trend_quality_yes = [0] * len(time_labels)
    trend_known = [0] * len(time_labels)
    trend_new = [0] * len(time_labels)

    by_version_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    by_r_version_time: dict[str, list[int]] = {name: [0] * len(time_labels) for name in OWNERSHIP_R_LINES}
    by_c_version_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))

    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(sk) or {}
        ymd = str(sl.get("stats_day") or "")
        lab = _bucket_label(ymd, precision)
        i = idx.get(lab)
        if i is None:
            continue
        trend_total[i] += int(seg.get("total") or 0)
        trend_quality_yes[i] += int(seg.get("trend_quality_yes") or 0)
        trend_known[i] += int(seg.get("trend_known") or 0)
        trend_new[i] += int(seg.get("trend_new") or 0)
        for ver, cnt in (seg.get("by_version") or {}).items():
            n = int(cnt)
            if n <= 0:
                continue
            ver_s = str(ver)
            by_version_time[ver_s][i] += n
            c_ver = _c_of_version(ver_s)
            if c_ver:
                by_c_version_time[c_ver][i] += n
        for r_ver, cnt in (seg.get("by_r_version") or {}).items():
            if r_ver in by_r_version_time:
                by_r_version_time[r_ver][i] += int(cnt)

    by_version = _sum_slice_maps(daily_slices, sk, "by_version")
    by_version_chart = _drop_unknown_version_counts(by_version)
    # 按版本透视：时间窗内全部有效版本（已排除「未知版本」），按数量降序
    versions = sorted(by_version_chart.keys(), key=lambda k: (-by_version_chart[k], k))
    versions_for_series = versions
    by_env = _sum_slice_maps(daily_slices, sk, "by_biz_env")
    by_problem_stage = _stage_counts_for_pie(by_env)
    by_problem_env = _sum_slice_maps(daily_slices, sk, "by_problem_env")
    by_product_line = _sum_slice_maps(daily_slices, sk, "by_product_line")
    by_site = _sum_slice_maps(daily_slices, sk, "by_site")
    by_site_inst = _sum_slice_maps(daily_slices, sk, "by_site_proc")

    core_bars = _top_entries(_sum_slice_maps(daily_slices, sk, "core_by_version"), 10)

    resolved_l1_labels = _resolve_l1_bar_labels(
        l1_labels,
        from_slices=_unique_l1_labels(
            _l1_labels_from_slices(daily_slices, sk_yes, "module_intro_l2")
            + _l1_labels_from_slices(daily_slices, sk_yes, "module_owner_l2")
        ),
    )
    l1_bars: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for kind, l2_field, no_dts_field, dts_path_field in (
        ("intro", "module_intro_l2", "dts_dedup_intro_l2", "dts_intro_path"),
        ("owner", "module_owner_l2", "dts_dedup_owner_l2", "dts_owner_path"),
    ):
        l1_bars[kind] = {}
        for key, label in _ownership_l1_bar_slots(resolved_l1_labels):
            for dedup in (False, True):
                counts = _aggregate_l1_l2_counts_from_slices(
                    daily_slices,
                    sk_yes,
                    label,
                    dedup=dedup,
                    l2_field=l2_field,
                    no_dts_field=no_dts_field,
                    dts_path_field=dts_path_field,
                )
                # 质量问题TOP高发模块：二级模块全量（按数量降序），不截断 TopN
                l1_bars[kind][f"{key}_{'dedup' if dedup else 'raw'}"] = _top_entries(counts, None)

    version_env = _sum_slice_maps(daily_slices, sk, "version_env")
    version_cat_rows: list[str] = []
    version_cat_cols = versions
    env_ver_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for compound, cnt in version_env.items():
        parts = split_metrics_compound_key(compound)
        if parts:
            env_ver_counts[parts[0]][parts[1]] += int(cnt)
    version_cat_rows = list(env_ver_counts.keys())[:8]
    version_cat_cells = [
        [env_ver_counts.get(er, {}).get(col, 0) for col in version_cat_cols] for er in version_cat_rows
    ]

    def _sunburst_from_l3(field: str) -> list[dict[str, Any]]:
        l3_map = _sum_slice_maps(daily_slices, sk, field)
        l1_map: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
        for path, cnt in l3_map.items():
            parts = _sunburst_module_parts(str(path))
            if not parts:
                continue
            if len(parts) == 1:
                l1_map[parts[0]]["__leaf__"]["__leaf__"] += int(cnt)
            elif len(parts) == 2:
                l1_map[parts[0]][parts[1]]["__leaf__"] += int(cnt)
            else:
                l1_map[parts[0]][parts[1]][parts[2]] += int(cnt)
        result: list[dict[str, Any]] = []
        for l1, l2_map in sorted(l1_map.items(), key=lambda x: -sum(_sunburst_branch_count(v) for v in x[1].values())):
            leaf_l1 = int((l2_map.get("__leaf__") or {}).get("__leaf__") or 0)
            children = _sunburst_l2_nodes(l2_map)
            if children:
                result.append({"name": l1, "children": children})
            elif leaf_l1:
                result.append({"name": l1, "value": leaf_l1})
        return result

    by_product_line_quality = _sum_slice_maps(daily_slices, sk_yes, "by_product_line")
    by_site_quality = _sum_slice_maps(daily_slices, sk_yes, "by_site")
    q_by_version_time, q_by_c_version_time, q_by_r_version_time = _ownership_version_time_maps_from_slices(
        daily_slices, sk_yes, time_labels, precision
    )
    by_issue_type_time = _issue_type_time_from_slices(daily_slices, sk_yes, time_labels, precision)
    by_l2_module_time = _l2_module_time_from_slices(daily_slices, sk_yes, time_labels, precision)

    return {
        "time_labels": time_labels,
        "precision": precision,
        "trend": {
            "total": trend_total,
            "quality_yes": trend_quality_yes,
            "known": trend_known,
            "new": trend_new,
        },
        "by_version_time": {
            ver: by_version_time.get(ver, [0] * len(time_labels)) for ver in versions_for_series
        },
        "by_r_version_time": by_r_version_time,
        "by_c_version_time": _finalize_c_version_time(by_c_version_time, time_labels),
        "by_version_time_quality": q_by_version_time,
        "by_c_version_time_quality": q_by_c_version_time,
        "by_r_version_time_quality": q_by_r_version_time,
        "by_issue_type_time": by_issue_type_time,
        "by_l2_module_time": by_l2_module_time,
        "sunburst": {
            "intro": _sunburst_from_l3("module_intro_l3"),
            "owner": _sunburst_from_l3("module_owner_l3"),
        },
        "l1_bars": l1_bars,
        "l1_module_options": _l1_module_options(resolved_l1_labels),
        "top_site": _top_entries(by_site, 20),
        "top_site_quality": _top_entries(by_site_quality, 20),
        "top_inst_site": _top_entries(by_site_inst, 20),
        "top_ver": _top_entries(by_version_chart, 20),
        "top_inst_ver": _top_entries(_sum_slice_maps(daily_slices, sk, "open_by_version"), 20),
        "core_bars": core_bars,
        "version_category_table": {
            "rows": version_cat_rows,
            "cols": version_cat_cols,
            "cells": version_cat_cells,
        },
        "stage_pie": _top_entries(by_problem_stage, None),
        "env_pie": _top_entries(by_problem_env, None),
        "source_pie": _top_entries(by_product_line, None),
        "quality_source_pie": _top_entries(by_product_line_quality, None),
    }


def _merge_labor_from_slices(daily_slices: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {
        "by_person": {},
        "by_person_submit": {},
        "by_person_collab": {},
        "by_person_open": {},
        "by_stage_open": {},
        "by_group_stage_open": {},
        "by_stage_all": {},
        "by_person_stage": {},
        "by_person_current_stage": {},
        "by_person_stage_open": {},
        "by_person_flow": {},
        "by_group_person": {},
        "by_group_person_open": {},
        "open_dwell": {},
        "open_dwell_stack": {},
        "dwell_by_person_stage": {},
        "dwell_by_stage": {},
    }
    for sl in daily_slices:
        lab = sl.get("labor") or {}
        # 旧日汇总无 by_person_submit 时，用 by_person 顶替，避免与新字段混并丢数
        if not (lab.get("by_person_submit") or {}) and (lab.get("by_person") or {}):
            lab = {**lab, "by_person_submit": dict(lab.get("by_person") or {})}
        for k in (
            "by_person",
            "by_person_submit",
            "by_person_collab",
            "by_person_open",
            "by_stage_open",
            "by_stage_all",
        ):
            for pk, v in (lab.get(k) or {}).items():
                merged[k][pk] = int(merged[k].get(pk, 0)) + int(v)
        for person, stages in (lab.get("by_person_stage") or {}).items():
            ps = merged["by_person_stage"].setdefault(person, {})
            for st, v in stages.items():
                ps[st] = int(ps.get(st, 0)) + int(v)
        for person, stages in (lab.get("by_person_current_stage") or {}).items():
            ps = merged.setdefault("by_person_current_stage", {}).setdefault(person, {})
            for st, v in stages.items():
                ps[st] = int(ps.get(st, 0)) + int(v)
        for person, stages in (lab.get("by_person_stage_open") or {}).items():
            ps = merged.setdefault("by_person_stage_open", {}).setdefault(person, {})
            for st, v in stages.items():
                ps[st] = int(ps.get(st, 0)) + int(v)
        for person, flows in (lab.get("by_person_flow") or {}).items():
            pf = merged["by_person_flow"].setdefault(person, {})
            for fk, v in flows.items():
                # 兼容旧日汇总键名「流转至尖刀连」
                key = LABOR_FLOW_COMMANDO if str(fk) == "流转至尖刀连" else str(fk)
                pf[key] = int(pf.get(key, 0)) + int(v)
        for stage, bucket in (lab.get("open_dwell") or {}).items():
            ob = merged["open_dwell"].setdefault(stage, {"count": 0, "sum_created_ms": 0.0})
            ob["count"] += int(bucket.get("count") or 0)
            ob["sum_created_ms"] += float(bucket.get("sum_created_ms") or 0)
        for stage, bucket in (lab.get("open_dwell_stack") or {}).items():
            ob = merged["open_dwell_stack"].setdefault(stage, {"count": 0, "sum_created_ms": 0.0})
            ob["count"] += int(bucket.get("count") or 0)
            ob["sum_created_ms"] += float(bucket.get("sum_created_ms") or 0)
        for person, stages in (lab.get("dwell_by_person_stage") or {}).items():
            ps = merged["dwell_by_person_stage"].setdefault(str(person), {})
            merge_dwell_bucket_maps(ps, stages)
        merge_dwell_bucket_maps(merged["dwell_by_stage"], lab.get("dwell_by_stage"))
    return merged


def build_labor_payload_from_daily_slices(
    daily_slices: list[dict[str, Any]],
    admin_users: list[dict[str, Any]],
    product_line: str,
    *,
    include_collab: bool = False,
) -> dict[str, Any]:
    merged = _merge_labor_from_slices(daily_slices)

    # 人力投入统计：优先用提交经手人（合并时已对旧切片回填）
    by_person_input: dict[str, int] = dict(merged.get("by_person_submit") or merged.get("by_person") or {})
    if include_collab:
        for p, c in (merged.get("by_person_collab") or {}).items():
            by_person_input[p] = int(by_person_input.get(p, 0)) + int(c)

    pl = str(product_line or "").strip()
    if pl:
        by_person_input = {
            p: c for p, c in by_person_input.items() if _person_product_line(p, admin_users) == pl
        }

    groups_set: set[str] = set()
    for person in by_person_input.keys():
        fake_ticket = {"currentHandler": person, "creatorName": person}
        groups_set.add(_ticket_group(fake_ticket, admin_users))
    for person in (merged.get("by_person_open") or {}).keys():
        fake_ticket = {"currentHandler": person, "creatorName": person}
        groups_set.add(_ticket_group(fake_ticket, admin_users))
    groups = sorted(groups_set)

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    has_instance_dwell = bool(merged.get("dwell_by_stage") or merged.get("dwell_by_person_stage"))
    if has_instance_dwell:
        dwell_by_stage = {
            stage: avg_hours_from_dwell_bucket(merged["dwell_by_stage"].get(stage), now_ms=now_ms)
            for stage in LABOR_STACK_STAGES
        }
        by_person_stage_hours: dict[str, dict[str, float]] = {}
        for person, stages in (merged.get("dwell_by_person_stage") or {}).items():
            if pl and _person_product_line(person, admin_users) != pl:
                continue
            by_person_stage_hours[person] = {
                str(st): avg_hours_from_dwell_bucket(bucket, now_ms=now_ms)
                for st, bucket in (stages or {}).items()
            }
    else:
        # 旧日汇总无实例滞留累加器时，回退未闭环建单时长口径（仅阶段柱）
        dwell_by_stage = {}
        for stage in LABOR_STACK_STAGES:
            bucket = merged["open_dwell_stack"].get(stage) or {"count": 0, "sum_created_ms": 0.0}
            cnt = int(bucket.get("count") or 0)
            if cnt <= 0:
                dwell_by_stage[stage] = 0.0
                continue
            avg_ms = now_ms - float(bucket.get("sum_created_ms") or 0) / cnt
            dwell_by_stage[stage] = round(max(0.0, avg_ms) / 3600000.0)
        by_person_stage_hours = {}

    by_group_stage_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for person, cnt in by_person_input.items():
        g = _ticket_group({"currentHandler": person, "creatorName": person}, admin_users)
        by_group_person[g][person] += int(cnt)
    for person, cnt in merged["by_person_open"].items():
        if pl and _person_product_line(person, admin_users) != pl:
            continue
        g = _ticket_group({"currentHandler": person, "creatorName": person}, admin_users)
        by_group_person_open[g][person] += int(cnt)
    for person, stages in merged.get("by_person_stage_open", {}).items():
        if pl and _person_product_line(person, admin_users) != pl:
            continue
        g = _ticket_group({"currentHandler": person, "creatorName": person}, admin_users)
        for st, v in stages.items():
            by_group_stage_open[g][st] += int(v)

    by_person_stage_all = _merge_closed_into_audit_close_person_stages(merged["by_person_stage"])
    by_person_stage_open_all = {
        str(p): {str(st): int(c) for st, c in (stages or {}).items() if int(c or 0) > 0}
        for p, stages in (merged.get("by_person_stage_open") or {}).items()
    }
    by_person_stage_open_all = {p: st for p, st in by_person_stage_open_all.items() if st}
    if pl:
        by_person_open = {
            p: c
            for p, c in merged["by_person_open"].items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_stage = {
            p: v
            for p, v in by_person_stage_all.items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_stage_open = {
            p: v
            for p, v in by_person_stage_open_all.items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_flow = {
            p: v
            for p, v in merged["by_person_flow"].items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_current_stage = {
            p: v
            for p, v in (merged.get("by_person_current_stage") or {}).items()
            if _person_product_line(p, admin_users) == pl
        }
    else:
        by_person_open = merged["by_person_open"]
        by_person_stage = by_person_stage_all
        by_person_stage_open = by_person_stage_open_all
        by_person_flow = merged["by_person_flow"]
        by_person_current_stage = merged.get("by_person_current_stage") or {}

    return {
        "groups": groups,
        "stages": list(LABOR_STACK_STAGES),
        "pie_stages": list(LABOR_PIE_STAGES),
        "counts": {
            "by_person": by_person_input,
            "by_person_open": by_person_open,
            "by_stage_open": dict(merged["by_stage_open"]),
            "by_group_stage_open": {g: dict(v) for g, v in by_group_stage_open.items()},
            "by_stage_all": merged["by_stage_all"],
            "by_person_current_stage": {p: dict(v) for p, v in by_person_current_stage.items()},
            "by_person_stage": {p: dict(v) for p, v in by_person_stage.items()},
            "by_person_stage_open": {p: dict(v) for p, v in by_person_stage_open.items()},
            "by_person_flow": {p: dict(v) for p, v in by_person_flow.items()},
            "by_group_person": {g: dict(v) for g, v in by_group_person.items()},
            "by_group_person_open": {g: dict(v) for g, v in by_group_person_open.items()},
        },
        "dwell": {
            "by_stage_hours": dwell_by_stage,
            "by_person_stage_hours": {
                p: dict(v) for p, v in by_person_stage_hours.items()
            },
        },
    }


def build_doer_payload_from_daily_slices(
    daily_slices: list[dict[str, Any]],
    include_ops: bool,
    include_dev: bool,
) -> dict[str, Any]:
    empty_slices = [
        {"label": "问题定位/解决", "value": 0},
        {"label": "思路/辅助提效", "value": 0},
        {"label": "无帮助", "value": 0},
        {"label": "未使用Doer", "value": 0},
        {"label": "紧急疑难工单", "value": 0},
        {"label": "未填写", "value": 0},
    ]
    if not daily_slices:
        return {
            "total": 0,
            "doerResolved": 0,
            "doerHelped": 0,
            "doerNoHelp": 0,
            "noDoer": 0,
            "urgentHard": 0,
            "notFilled": 0,
            "unknown": 0,
            "usedDoer": 0,
            "effective": 0,
            "filledTotal": 0,
            "includeOps": include_ops,
            "includeDev": include_dev,
            "usageSlices": empty_slices,
            "effectivenessSlices": [
                {"label": "有效(定位/解决+辅助提效)", "value": 0},
                {"label": "无帮助", "value": 0},
            ],
            "consultEfficiency": _consult_efficiency_block([], consult=True),
            "nonConsultEfficiency": _consult_efficiency_block([], consult=False),
            "dailyClosed": {"labels": [], "values": [], "totalCount": 0, "avgDuration": 0},
            "dailyDoerUsage": {
                "labels": [],
                "barValues": [],
                "lineValues": [],
                "totalUsedDoer": 0,
                "totalTickets": 0,
                "avgPct": 0,
            },
            "dailyConsult": {"labels": [], "barValues": [], "lineValues": [], "totalConsult": 0, "totalTickets": 0, "avgPct": 0},
            "monthlyConsult": {"labels": [], "barValues": [], "lineValues": []},
            "dailyDoerEffectiveness": {"labels": [], "barValues": [], "lineValues": [], "avgRate": 0},
        }

    counts = defaultdict(int)
    by_created: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_consult_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_month: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_closed: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "sum_hours": 0.0})
    by_eff: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    consult_eff_merged: dict[str, Any] = defaultdict(float)
    non_consult_eff_merged: dict[str, Any] = defaultdict(float)
    total = 0

    for sl in daily_slices:
        doer = sl.get("doer") or {}
        if include_ops and include_dev:
            cat_src = doer.get("by_category") or {}
        elif include_ops:
            cat_src = doer.get("by_ops_category") or {}
        else:
            cat_src = doer.get("by_dev_category") or {}
        for cat, cnt in cat_src.items():
            counts[str(cat)] += int(cnt)
            total += int(cnt)
        for day, bucket in (doer.get("by_created_day") or {}).items():
            for k, v in bucket.items():
                by_created[str(day)][str(k)] += int(v) if isinstance(v, int) else 0
        for day, bucket in (doer.get("by_closed_day") or {}).items():
            by_closed[str(day)]["count"] += int(bucket.get("count") or 0)
            by_closed[str(day)]["sum_hours"] += float(bucket.get("sum_hours") or 0)
        for ym, bucket in (doer.get("by_created_month") or {}).items():
            for k, v in bucket.items():
                by_month[str(ym)][str(k)] += int(v)
        for k, v in (doer.get("consult_eff") or {}).items():
            if isinstance(v, (int, float)):
                consult_eff_merged[k] += v
        for k, v in (doer.get("non_consult_eff") or {}).items():
            if isinstance(v, (int, float)):
                non_consult_eff_merged[k] += v
        for day, bucket in (doer.get("by_created_day") or {}).items():
            by_consult_day[str(day)]["total"] += int(bucket.get("total") or 0)
            by_consult_day[str(day)]["consult"] += int(bucket.get("consult") or 0)
            if int(bucket.get("used_for_eff") or 0):
                by_eff[str(day)]["used"] += int(bucket.get("used_for_eff") or 0)
                by_eff[str(day)]["effective"] += int(bucket.get("effective") or 0)

    doer_resolved = counts["doer_resolved"]
    doer_helped = counts["doer_helped"]
    doer_no_help = counts["doer_no_help"]
    no_doer = counts["no_doer"]
    urgent_hard = counts["urgent_hard"]
    not_filled = counts["not_filled"]
    unknown = counts["unknown"]
    used_doer = doer_resolved + doer_helped + doer_no_help
    effective = doer_resolved + doer_helped

    sorted_closed = sorted(by_closed.keys())
    daily_closed_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_closed]
    daily_closed_values = [
        round(by_closed[d]["sum_hours"] / by_closed[d]["count"], 1) if by_closed[d]["count"] else 0
        for d in sorted_closed
    ]
    closed_count = sum(int(by_closed[d]["count"]) for d in sorted_closed)
    total_dur = sum(by_closed[d]["sum_hours"] for d in sorted_closed)
    avg_dur = round(total_dur / closed_count, 1) if closed_count else 0

    sorted_created = sorted(by_created.keys())
    daily_doer_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_created]
    daily_doer_bars = [int(by_created[d].get("used_doer", 0)) for d in sorted_created]
    daily_doer_lines = [
        round(by_created[d]["used_doer"] / by_created[d]["total"] * 100) if by_created[d].get("total") else 0
        for d in sorted_created
    ]
    tot_used = sum(daily_doer_bars)
    tot_tix = sum(int(by_created[d].get("total", 0)) for d in sorted_created)

    sorted_consult = sorted(by_consult_day.keys())
    daily_consult_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_consult]
    daily_consult_bars = [int(by_consult_day[d].get("consult", 0)) for d in sorted_consult]
    daily_consult_lines = [
        round(by_consult_day[d]["consult"] / by_consult_day[d]["total"] * 100)
        if by_consult_day[d].get("total")
        else 0
        for d in sorted_consult
    ]
    tot_consult = sum(daily_consult_bars)
    tot_consult_tix = sum(int(by_consult_day[d].get("total", 0)) for d in sorted_consult)

    sorted_months = sorted(by_month.keys())
    monthly_bars = [int(by_month[m].get("consult", 0)) for m in sorted_months]
    monthly_lines = [
        round(by_month[m]["consult"] / by_month[m]["total"] * 100) if by_month[m].get("total") else 0
        for m in sorted_months
    ]

    sorted_eff = sorted(by_eff.keys())
    eff_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_eff]
    eff_bars = [int(by_eff[d].get("effective", 0)) for d in sorted_eff]
    eff_lines = [
        round(by_eff[d]["effective"] / by_eff[d]["used"] * 100) if by_eff[d].get("used") else 0 for d in sorted_eff
    ]
    avg_rate = round(sum(eff_bars) / tot_used * 100) if tot_used else 0

    def _eff_block_from_merged(merged: dict[str, Any], *, consult: bool) -> dict[str, Any]:
        stages = [DOER_STAGE_NAMES[k] for k in DOER_STAGE_KEYS]
        total_key = "consult_total" if consult else "non_consult_total"
        filtered_total = int(merged.get(total_key) or 0)
        avg_used = []
        avg_no = []
        for nk in DOER_STAGE_KEYS:
            used_h = float(merged.get(f"hours_used_{nk}") or 0)
            used_c = int(merged.get(f"count_used_{nk}") or 0)
            no_h = float(merged.get(f"hours_no_{nk}") or 0)
            no_c = int(merged.get(f"count_no_{nk}") or 0)
            avg_used.append(round(used_h / used_c, 2) if used_c else 0.0)
            avg_no.append(round(no_h / no_c, 2) if no_c else 0.0)
        gains = [
            round(((avg_no[i] - avg_used[i]) / avg_no[i]) * 100) if avg_no[i] else 0 for i in range(len(stages))
        ]
        valid_gains = [g for g in gains if g > 0]
        avg_gain = round(sum(valid_gains) / len(valid_gains)) if valid_gains else 0
        max_gain = max(gains) if gains else 0
        max_stage = stages[gains.index(max_gain)] if max_gain else ""
        used_count = sum(int(merged.get(f"count_used_{nk}") or 0) for nk in DOER_STAGE_KEYS)
        no_count = sum(int(merged.get(f"count_no_{nk}") or 0) for nk in DOER_STAGE_KEYS)
        return {
            "stages": stages,
            "stageKeys": list(DOER_STAGE_KEYS),
            "avgHoursUsedDoer": avg_used,
            "avgHoursNoDoer": avg_no,
            "efficiencyGains": gains,
            "avgEfficiencyGain": avg_gain,
            "maxGainStage": max_stage,
            "maxGainValue": max_gain,
            "usedDoerCount": used_count,
            "noDoerCount": no_count,
            "totalConsultCount": filtered_total if consult else 0,
            "totalNonConsultCount": filtered_total if not consult else 0,
        }

    return {
        "total": total,
        "doerResolved": doer_resolved,
        "doerHelped": doer_helped,
        "doerNoHelp": doer_no_help,
        "noDoer": no_doer,
        "urgentHard": urgent_hard,
        "notFilled": not_filled,
        "unknown": unknown,
        "usedDoer": used_doer,
        "effective": effective,
        "filledTotal": used_doer + no_doer + urgent_hard,
        "includeOps": include_ops,
        "includeDev": include_dev,
        "usageSlices": [
            {"label": "问题定位/解决", "value": doer_resolved},
            {"label": "思路/辅助提效", "value": doer_helped},
            {"label": "无帮助", "value": doer_no_help},
            {"label": "未使用Doer", "value": no_doer},
            {"label": "紧急疑难工单", "value": urgent_hard},
            {"label": "未填写", "value": not_filled},
        ],
        "effectivenessSlices": [
            {"label": "有效(定位/解决+辅助提效)", "value": effective},
            {"label": "无帮助", "value": doer_no_help},
        ],
        "consultEfficiency": _eff_block_from_merged(dict(consult_eff_merged), consult=True),
        "nonConsultEfficiency": _eff_block_from_merged(dict(non_consult_eff_merged), consult=False),
        "dailyClosed": {
            "labels": daily_closed_labels,
            "values": daily_closed_values,
            "totalCount": closed_count,
            "avgDuration": avg_dur,
        },
        "dailyDoerUsage": {
            "labels": daily_doer_labels,
            "barValues": daily_doer_bars,
            "lineValues": daily_doer_lines,
            "totalUsedDoer": tot_used,
            "totalTickets": tot_tix,
            "avgPct": round(tot_used / tot_tix * 100) if tot_tix else 0,
        },
        "dailyConsult": {
            "labels": daily_consult_labels,
            "barValues": daily_consult_bars,
            "lineValues": daily_consult_lines,
            "totalConsult": tot_consult,
            "totalTickets": tot_consult_tix,
            "avgPct": round(tot_consult / tot_consult_tix * 100) if tot_consult_tix else 0,
        },
        "monthlyConsult": {
            "labels": sorted_months,
            "barValues": monthly_bars,
            "lineValues": monthly_lines,
            "totalConsult": sum(monthly_bars),
            "totalTickets": sum(int(by_month[m].get("total", 0)) for m in sorted_months),
            "avgPct": round(sum(monthly_bars) / sum(int(by_month[m].get("total", 0)) for m in sorted_months) * 100)
            if sorted_months and sum(int(by_month[m].get("total", 0)) for m in sorted_months)
            else 0,
        },
        "dailyDoerEffectiveness": {
            "labels": eff_labels,
            "barValues": eff_bars,
            "lineValues": eff_lines,
            "totalUsedDoer": tot_used,
            "totalEffective": sum(eff_bars),
            "avgRate": avg_rate,
            "avgPct": avg_rate,
        },
    }


def get_stats_charts(
    operator_id: str,
    view: str,
    start_date: str,
    end_date: str,
    *,
    product_line: str = "",
    precision: str = "month",
    quality: str = "all",
    component: str = "all",
    include_ops: bool = True,
    include_dev: bool = True,
    include_collab: bool = False,
) -> dict[str, Any]:
    from routers.tickets import _get_whitelist_flags

    op = str(operator_id or "").strip() or "demo_001"
    sd = parse_ymd(start_date, "start_date")
    ed = parse_ymd(end_date, "end_date")
    if sd > ed:
        sd, ed = ed, sd
    view = str(view or "").strip().lower()
    if view not in ("labor", "ownership", "doer"):
        raise ValueError("view 须为 labor、ownership 或 doer")
    if precision not in ("day", "month", "quarter", "year"):
        raise ValueError("precision 须为 day、month、quarter 或 year")
    include_collab = bool(include_collab)

    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, op)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        admin_users = _load_admin_users(conn)

        from ticket_stats_daily import fetch_merged_daily_metrics, stats_daily_enabled

        daily = None
        use_daily = False
        if stats_daily_enabled():
            daily = fetch_merged_daily_metrics(conn, sd, ed, only_self=only_self, operator_id=op)
            if daily is not None and daily.get("daily_slices") is not None:
                if daily["daily_slices"]:
                    use_daily = True
                else:
                    has_rollup = conn.execute(
                        "SELECT 1 FROM ticket_stats_daily WHERE template_code = %s LIMIT 1",
                        (SCHEMA_TEMPLATE_CODE,),
                    ).fetchone()
                    use_daily = bool(has_rollup)

        quality_scoped: dict[str, Any] | None = None
        if use_daily and daily is not None:
            slices = daily["daily_slices"]
            ticket_count = int(daily.get("ticket_count") or 0)
            if view == "labor":
                # 流转详细占比已写入日汇总 labor.by_person_flow（见 compute_ticket_metrics）；
                # 滞留次数/小时写入 labor.by_person_stage / dwell_by_*，勿再全扫节点实例。
                # 归类改为「运维分析最后一次提交去向」后须跑 scripts/backfill_ticket_stats_daily.py。
                pl = str(product_line or "").strip()
                payload = build_labor_payload_from_daily_slices(
                    slices,
                    admin_users,
                    pl,
                    include_collab=include_collab,
                )
            elif view == "ownership":
                c = str(component or "all")
                q = str(quality or "all")
                # 主 payload 始终为全量质量问题（不受 quality 筛选）；仅部分图表读 quality_scoped。
                payload = _build_ownership_payload_resolved(
                    conn,
                    op,
                    sd,
                    ed,
                    precision,
                    "all",
                    c,
                    only_self=only_self,
                    use_daily=True,
                    daily=daily,
                    row_fallback=False,
                )
                if q != "all":
                    quality_scoped = _build_ownership_payload_resolved(
                        conn,
                        op,
                        sd,
                        ed,
                        precision,
                        q,
                        c,
                        only_self=only_self,
                        use_daily=True,
                        daily=daily,
                        row_fallback=True,
                    )
            else:
                payload = build_doer_payload_from_daily_slices(slices, include_ops, include_dev)
        else:
            rows = fetch_stats_tickets(conn, op, sd, ed, only_self=only_self)
            ticket_count = len(rows)
            if view == "labor":
                enrich_labor_submitters(conn, rows)
                enrich_labor_flow_passthrough(conn, rows)
                pl = str(product_line or "").strip()
                ids = [int(r["ticketId"]) for r in rows if r.get("ticketId") is not None]
                person_stage = fetch_labor_person_stage_counts(conn, ids)
                person_hours, stage_hours = fetch_labor_person_stage_hours(conn, ids)
                payload = build_labor_payload(
                    rows,
                    admin_users,
                    pl,
                    include_collab=include_collab,
                    person_stage_counts=person_stage,
                    person_stage_hours=person_hours,
                    stage_hours=stage_hours,
                )
            elif view == "ownership":
                c = str(component or "all")
                q = str(quality or "all")
                l1_labels = load_duty_field_l1_labels(conn, c) or None
                payload = build_ownership_payload(rows, sd, ed, precision, "all", c, l1_labels=l1_labels)
                if q != "all":
                    quality_scoped = build_ownership_payload(rows, sd, ed, precision, q, c, l1_labels=l1_labels)
            else:
                payload = build_doer_payload(conn, rows, include_ops, include_dev)

    out: dict[str, Any] = {
        "view": view,
        "range": {"start_date": sd.isoformat(), "end_date": ed.isoformat()},
        "ticket_count": ticket_count,
        "payload": payload,
    }
    if view == "ownership" and quality_scoped is not None:
        out["quality_scoped"] = quality_scoped
    return out
