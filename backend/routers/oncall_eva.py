"""oncall 评议路由：

设计要点（与 oncall-eva.md 对应）：
- 配置项常量化，通过 GET /api/oncall-eva/config 返回，前后端共享口径
- SLA / 独立闭环率 / 工单量 三项指标基于 ticket / ticket_flow_log 实时计算
- 加分项 / 红黑事件落库（oncall_eva_extra / oncall_eva_event）
- 综合得分 = SLA(35) + 独立闭环(30) + 工单量(20) + 加分(<=15) + 红黑事件附加
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from calendar import monthrange
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Query

from config import ONCALL_EVA_SCORES_CACHE_SECONDS
from database import db_conn
from models import (
    OncallExtraCreatePayload,
    OncallExtraReviewPayload,
    OncallEventCreatePayload,
)

_ONCALL_SCHEMA_HINT = "请在数据库执行 db/migrations/0035_oncall_evaluation.sql"
_DEV_NODE_KEYS = ("dev_analysis", "dev_closure")
# 运维效率三项指标的判定依据（按组分流，规格 v2）：
# - 评议两类人，按 user_account.group_name 分流：ONCALL（运维组）/ R&D（研发组）。
# - 当月工单基准（三项共用）：以「提单月」(ticket.created_at) 归月；工单只要流转中到达过
#   开发闭环/运维闭环/审核关闭任一节点即算「闭环」，不再要求 action_type='close' 或 status 关闭。
# - 归属人：ONCALL=运维分析阶段最后一次提交人；R&D=开发分析阶段最后一次提交人。
# - 独立闭环（非独立条件）：ONCALL=走过 运维分析→开发分析；
#   R&D=开发分析节点 collaborator 字段非空，或 开发分析阶段有多个不同人处理。
# - SLA：ONCALL=问题审核+运维分析+开发分析+运维闭环 四段停留相加；R&D=仅开发分析阶段停留。
GROUP_ONCALL = "ONCALL"
GROUP_RND = "R&D"
_OPS_ANALYSIS_NODE_KEY = "ops_analysis"
_DEV_ANALYSIS_NODE_KEY = "dev_analysis"
_COLLABORATOR_FIELD_KEY = "collaborator"
# 工单「到达即闭环」的判定节点（命中任一即计入当月）。
_CLOSURE_REACH_NODE_KEYS = ("dev_closure", "ops_closure", "audit_close")
# SLA 阶段：ONCALL 四段累加，R&D 仅开发分析。
_ONCALL_SLA_STAGE_NODE_KEYS = ("problem_review", "ops_analysis", "dev_analysis", "ops_closure")
_RND_SLA_STAGE_NODE_KEYS = ("dev_analysis",)

# 评议规则常量（与 oncall-eva.md 一致）
SLA_TIERS: list[dict[str, float | None]] = [
    {"max_hours": 24, "score": 100},
    {"max_hours": 48, "score": 80},
    {"max_hours": 72, "score": 60},
    {"max_hours": None, "score": 30},
]
SLA_WEIGHT = 0.35
CLOSURE_TIERS = {"high": 90.0, "low": 70.0, "high_score": 100.0, "low_score": 60.0}
CLOSURE_WEIGHT = 0.30
TICKET_THRESHOLD_RATIO = 0.8
TICKET_FULL_SCORE = 20
# 质量分（SLA / 独立闭环）按个人工单数缩放的置信因子下限：
# vol_factor = clamp(工单数 / 团队基准(人均×0.8), 下限, 1.0)。
# 工单少则质量分按比例打折、达基准满分；下限避免「1 单」被压到接近 0。
VOL_CONFIDENCE_FLOOR = 0.3
EXTRA_CAP = 15
EXTRA_CATEGORY_LIMIT = 20  # 单项上限
EXTRA_CATEGORIES = {
    "efficiency": {"label": "效率提升", "per_item": 5},
    "enablement": {"label": "赋能", "per_item": 4},
    "knowledge": {"label": "知识沉淀", "per_item": 4},
    "public": {"label": "公共事务", "per_item": 4},
    "travel": {"label": "出差现场", "per_item": 4},
    "other": {"label": "其他", "per_item": 3},
}
EVENT_SINGLE_LIMIT = 5
ALLOWED_REVIEW_STATUS = {"approved", "rejected"}
ALLOWED_EXTRA_STATUS = {"pending", "approved", "rejected", "withdrawn"}

router = APIRouter(prefix="/api/oncall-eva", tags=["oncall-eva"])

logger = logging.getLogger(__name__)

# (year, month, group_name, dept_key) -> (monotonic_ts, payload)
_scores_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}


def _scores_cache_key(year: int, month: int, group_name: str, dept_set: set[str]) -> tuple[Any, ...]:
    return (year, month, str(group_name or "").strip(), tuple(sorted(dept_set)))


def _scores_cache_get(key: tuple[Any, ...]) -> dict[str, Any] | None:
    if ONCALL_EVA_SCORES_CACHE_SECONDS <= 0:
        return None
    entry = _scores_cache.get(key)
    if not entry:
        return None
    ts, payload = entry
    if time.monotonic() - ts > ONCALL_EVA_SCORES_CACHE_SECONDS:
        _scores_cache.pop(key, None)
        return None
    return payload


def _scores_cache_set(key: tuple[Any, ...], payload: dict[str, Any]) -> None:
    if ONCALL_EVA_SCORES_CACHE_SECONDS <= 0:
        return
    _scores_cache[key] = (time.monotonic(), payload)


def _scores_cache_invalidate_period(year: int, month: int) -> None:
    prefix = (year, month)
    for k in list(_scores_cache.keys()):
        if k[0:2] == prefix:
            _scores_cache.pop(k, None)


def _user_display(conn: psycopg.Connection, account: str) -> tuple[str, str]:
    acc = (account or "").strip()
    if not acc:
        return "", ""
    row = conn.execute(
        "SELECT user_name, role_code FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    if not row:
        return acc, ""
    return acc, str(row.get("user_name") or "")


_ADMIN_ROLE_CODES = {"admin", "管理员", "PL"}


def _is_admin(conn: psycopg.Connection, account: str) -> bool:
    acc = (account or "").strip()
    if not acc:
        return False
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    if not row:
        return False
    role = str(row.get("role_code") or "")
    return role in _ADMIN_ROLE_CODES


def _validate_period(year: int, month: int) -> tuple[int, int]:
    if year < 2000 or year > 2100:
        raise HTTPException(status_code=400, detail="year 越界")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month 越界")
    return year, month


def _period_range(year: int, month: int) -> tuple[datetime, datetime]:
    days = monthrange(year, month)[1]
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year, month, days, 23, 59, 59, tzinfo=timezone.utc)
    return start, end


def _sla_score_from_avg(avg_hours: float | None) -> float:
    if avg_hours is None:
        return 0.0
    for tier in SLA_TIERS:
        cap = tier["max_hours"]
        if cap is None or avg_hours <= cap:
            return float(tier["score"])
    return 30.0


def _closure_score(rate_pct: float | None) -> float:
    if rate_pct is None:
        return 0.0
    if rate_pct >= CLOSURE_TIERS["high"]:
        return CLOSURE_TIERS["high_score"]
    if rate_pct < CLOSURE_TIERS["low"]:
        return CLOSURE_TIERS["low_score"]
    span_pct = CLOSURE_TIERS["high"] - CLOSURE_TIERS["low"]
    span_score = CLOSURE_TIERS["high_score"] - CLOSURE_TIERS["low_score"]
    return CLOSURE_TIERS["low_score"] + (rate_pct - CLOSURE_TIERS["low"]) / span_pct * span_score


# 当月工单基准（三项共用）：提单月 + 到达过任一闭环节点。
_CLOSED_IN_PERIOD_CTE = """
        closed_in_period AS (
            SELECT t.id AS ticket_id
            FROM ticket t
            WHERE t.created_at BETWEEN %(period_start)s AND %(period_end)s
              AND EXISTS (
                  SELECT 1 FROM ticket_flow_log fl
                  JOIN workflow_node wn ON wn.id = fl.to_node_id
                  WHERE fl.ticket_id = t.id AND wn.node_key = ANY(%(closure_keys)s)
              )
        )"""

# 各阶段停留时长：相邻流转时间差归属到 from_node，按 sla_keys 选取累加。
_STAGE_HOURS_CTE = """
        stage_hours AS (
            SELECT l.ticket_id,
                   SUM(CASE WHEN wn.node_key = ANY(%(sla_keys)s) AND l.prev_at IS NOT NULL
                            THEN EXTRACT(EPOCH FROM (l.created_at - l.prev_at)) / 3600.0
                            ELSE 0 END) AS sla_hours
            FROM (
                SELECT fl.ticket_id, fl.from_node_id, fl.created_at,
                       LAG(fl.created_at) OVER (
                           PARTITION BY fl.ticket_id ORDER BY fl.created_at, fl.id
                       ) AS prev_at
                FROM ticket_flow_log fl
                JOIN closed_in_period c ON c.ticket_id = fl.ticket_id
            ) l
            LEFT JOIN workflow_node wn ON wn.id = l.from_node_id
            GROUP BY l.ticket_id
        )"""

# ONCALL：归属=运维分析最后提交人；非独立=之后进过开发分析；SLA=四段累加。
_ONCALL_METRIC_SQL = f"""
        WITH {_CLOSED_IN_PERIOD_CTE},
        anchor_handler AS (
            SELECT DISTINCT ON (fl.ticket_id)
                fl.ticket_id, fl.operator_id, fl.operator_name, fl.created_at AS anchor_at
            FROM ticket_flow_log fl
            JOIN closed_in_period c ON c.ticket_id = fl.ticket_id
            JOIN workflow_node wn ON wn.id = fl.from_node_id AND wn.node_key = %(anchor_key)s
            WHERE fl.action_type IN ('submit', 'jump_submit')
            ORDER BY fl.ticket_id, fl.created_at DESC, fl.id DESC
        ),
        non_indep AS (
            SELECT ah.ticket_id,
                   BOOL_OR(tn.node_key = %(dev_key)s AND fl.created_at >= ah.anchor_at) AS non_indep
            FROM anchor_handler ah
            JOIN ticket_flow_log fl ON fl.ticket_id = ah.ticket_id
            LEFT JOIN workflow_node tn ON tn.id = fl.to_node_id
            GROUP BY ah.ticket_id
        ),
        {_STAGE_HOURS_CTE}
        SELECT
            ah.operator_id AS account,
            COALESCE(MAX(ah.operator_name), '') AS user_name,
            COUNT(*) AS total_tickets,
            SUM(COALESCE(sh.sla_hours, 0)) AS sum_hours,
            SUM(CASE WHEN COALESCE(ni.non_indep, FALSE) THEN 1 ELSE 0 END) AS non_indep_tickets
        FROM anchor_handler ah
        LEFT JOIN non_indep ni ON ni.ticket_id = ah.ticket_id
        LEFT JOIN stage_hours sh ON sh.ticket_id = ah.ticket_id
        WHERE ah.operator_id IS NOT NULL AND ah.operator_id <> ''
        GROUP BY ah.operator_id
"""

# R&D：归属=开发分析最后提交人；非独立=开发分析协助人非空 或 开发分析有多个不同处理人；SLA=仅开发分析停留。
_RND_METRIC_SQL = f"""
        WITH {_CLOSED_IN_PERIOD_CTE},
        anchor_handler AS (
            SELECT DISTINCT ON (fl.ticket_id)
                fl.ticket_id, fl.operator_id, fl.operator_name
            FROM ticket_flow_log fl
            JOIN closed_in_period c ON c.ticket_id = fl.ticket_id
            JOIN workflow_node wn ON wn.id = fl.from_node_id AND wn.node_key = %(anchor_key)s
            WHERE fl.action_type IN ('submit', 'jump_submit')
            ORDER BY fl.ticket_id, fl.created_at DESC, fl.id DESC
        ),
        dev_multi AS (
            SELECT fl.ticket_id, COUNT(DISTINCT fl.operator_id) AS dev_op_cnt
            FROM ticket_flow_log fl
            JOIN closed_in_period c ON c.ticket_id = fl.ticket_id
            JOIN workflow_node wn ON wn.id = fl.from_node_id AND wn.node_key = %(anchor_key)s
            WHERE fl.action_type IN ('submit', 'jump_submit')
            GROUP BY fl.ticket_id
        ),
        dev_collab AS (
            SELECT tnd.ticket_id,
                   BOOL_OR(COALESCE(TRIM(tnd.values_json ->> %(collab_key)s), '') <> '') AS has_collab
            FROM ticket_node_data tnd
            JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
            JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = %(anchor_key)s
            JOIN closed_in_period c ON c.ticket_id = tnd.ticket_id
            GROUP BY tnd.ticket_id
        ),
        {_STAGE_HOURS_CTE}
        SELECT
            ah.operator_id AS account,
            COALESCE(MAX(ah.operator_name), '') AS user_name,
            COUNT(*) AS total_tickets,
            SUM(COALESCE(sh.sla_hours, 0)) AS sum_hours,
            SUM(CASE WHEN COALESCE(dm.dev_op_cnt, 0) > 1 OR COALESCE(dc.has_collab, FALSE)
                     THEN 1 ELSE 0 END) AS non_indep_tickets
        FROM anchor_handler ah
        LEFT JOIN dev_multi dm ON dm.ticket_id = ah.ticket_id
        LEFT JOIN dev_collab dc ON dc.ticket_id = ah.ticket_id
        LEFT JOIN stage_hours sh ON sh.ticket_id = ah.ticket_id
        WHERE ah.operator_id IS NOT NULL AND ah.operator_id <> ''
        GROUP BY ah.operator_id
"""


def _rows_to_metrics(rows: list[dict]) -> dict[str, dict[str, Any]]:
    """统一把指标查询结果行转成 {account: metric}。dev_ticket_count = 非独立闭环单数。"""
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        acc = str(r.get("account") or "").strip()
        if not acc:
            continue
        cnt = int(r.get("total_tickets") or 0)
        hours = float(r.get("sum_hours") or 0)
        non_indep = int(r.get("non_indep_tickets") or 0)
        out[acc] = {
            "account": acc,
            "user_name": str(r.get("user_name") or ""),
            "ticket_count": cnt,
            "sla_avg_hours": hours / cnt if cnt > 0 else None,
            "independent_closure_rate": (cnt - non_indep) / cnt * 100 if cnt > 0 else None,
            "dev_ticket_count": non_indep,
        }
    return out


def _build_ticket_metrics(conn: psycopg.Connection, year: int, month: int) -> dict[str, dict[str, dict[str, Any]]]:
    """按组分别汇总运维效率三项指标，返回 {group_name: {account: metric}}（规格 v2）。"""
    period_start, period_end = _period_range(year, month)
    base = {
        "period_start": period_start,
        "period_end": period_end,
        "closure_keys": list(_CLOSURE_REACH_NODE_KEYS),
    }
    oncall_rows = conn.execute(
        _ONCALL_METRIC_SQL,
        {**base, "anchor_key": _OPS_ANALYSIS_NODE_KEY, "dev_key": _DEV_ANALYSIS_NODE_KEY,
         "sla_keys": list(_ONCALL_SLA_STAGE_NODE_KEYS)},
    ).fetchall()
    rnd_rows = conn.execute(
        _RND_METRIC_SQL,
        {**base, "anchor_key": _DEV_ANALYSIS_NODE_KEY, "collab_key": _COLLABORATOR_FIELD_KEY,
         "sla_keys": list(_RND_SLA_STAGE_NODE_KEYS)},
    ).fetchall()
    return {
        GROUP_ONCALL: _rows_to_metrics(oncall_rows),
        GROUP_RND: _rows_to_metrics(rnd_rows),
    }


def _aggregate_extras(rows: list[dict]) -> dict[str, Any]:
    """聚合一个账号的所有加分项条目，按规则计算最终得分。"""
    by_category: dict[str, dict[str, Any]] = {}
    for cat in EXTRA_CATEGORIES:
        by_category[cat] = {"approved_count": 0, "raw_score": 0.0, "capped_score": 0.0, "items": []}
    for r in rows:
        cat = str(r.get("category") or "")
        if cat not in by_category:
            cat = "other"
        score = float(r.get("declared_score") or 0)
        is_excellent = bool(r.get("is_excellent") or False)
        per_item_cap = float(EXTRA_CATEGORIES[cat]["per_item"])
        item_score = min(score, per_item_cap)
        if is_excellent:
            item_score = per_item_cap
        by_category[cat]["approved_count"] += 1
        by_category[cat]["raw_score"] += item_score
        by_category[cat]["items"].append({
            "id": r.get("id"),
            "description": str(r.get("description") or ""),
            "evidence_url": str(r.get("evidence_url") or ""),
            "score": item_score,
            "is_excellent": is_excellent,
        })
    total = 0.0
    for cat, info in by_category.items():
        capped = min(info["raw_score"], float(EXTRA_CATEGORY_LIMIT))
        info["capped_score"] = capped
        total += capped
    final_score = min(total, float(EXTRA_CAP))
    return {"by_category": by_category, "final_score": round(final_score, 2)}


def _aggregate_events(rows: list[dict]) -> dict[str, Any]:
    red_total = 0.0
    black_total = 0.0
    items: list[dict[str, Any]] = []
    for r in rows:
        kind = str(r.get("kind") or "")
        score = float(r.get("score") or 0)
        score = max(0.0, min(score, float(EVENT_SINGLE_LIMIT)))
        if kind == "red":
            red_total += score
        elif kind == "black":
            black_total += score
        items.append({
            "id": r.get("id"),
            "kind": kind,
            "score": score,
            "summary": str(r.get("summary") or ""),
            "evidence_url": str(r.get("evidence_url") or ""),
            "recorder_name": str(r.get("recorder_name") or ""),
        })
    return {
        "red_total": red_total,
        "black_total": black_total,
        "net_score": round(red_total - black_total, 2),
        "items": items,
    }


def _volume_confidence(cnt: int, baseline: float) -> float:
    """个人工单数置信因子：clamp(工单数/基准, 下限, 1.0)；基准<=0 时不惩罚（=1）。"""
    if baseline <= 0:
        return 1.0
    return max(VOL_CONFIDENCE_FLOOR, min(1.0, cnt / baseline))


def _person_score(metric: dict[str, Any], extra: dict[str, Any], event: dict[str, Any], baseline: float) -> dict[str, Any]:
    cnt = int(metric.get("ticket_count") or 0)
    # 质量分（SLA / 独立闭环）按个人工单数置信因子缩放：工单少则按比例打折，达基准满分。
    vol_factor = _volume_confidence(cnt, baseline)
    sla_avg = metric.get("sla_avg_hours")
    sla_base = _sla_score_from_avg(sla_avg)
    sla_score = round(sla_base * SLA_WEIGHT * vol_factor, 2)
    closure_score_raw = _closure_score(metric.get("independent_closure_rate"))
    closure_score = round(closure_score_raw * CLOSURE_WEIGHT * vol_factor, 2)
    if baseline <= 0:
        ticket_score = TICKET_FULL_SCORE if cnt > 0 else 0
    else:
        ratio = min(1.0, cnt / baseline)
        ticket_score = round(TICKET_FULL_SCORE * ratio, 2)
    extra_score = float(extra.get("final_score") or 0)
    event_net = float(event.get("net_score") or 0)
    total = round(sla_score + closure_score + ticket_score + extra_score + event_net, 2)
    return {
        "sla_score": sla_score,
        "sla_base": sla_base,
        "closure_score": closure_score,
        "closure_base": round(closure_score_raw, 2),
        "ticket_score": ticket_score,
        "ticket_threshold": baseline,
        "vol_factor": round(vol_factor, 4),
        "extra_score": extra_score,
        "event_net": event_net,
        "total_score": total,
    }


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {
        "sla": {"weight": SLA_WEIGHT, "tiers": SLA_TIERS},
        "closure": {"weight": CLOSURE_WEIGHT, "thresholds": CLOSURE_TIERS},
        "ticket": {"full_score": TICKET_FULL_SCORE, "threshold_ratio": TICKET_THRESHOLD_RATIO},
        "extra": {
            "cap": EXTRA_CAP,
            "category_limit": EXTRA_CATEGORY_LIMIT,
            "categories": [
                {"key": k, "label": v["label"], "per_item": v["per_item"]}
                for k, v in EXTRA_CATEGORIES.items()
            ],
        },
        "event": {"single_limit": EVENT_SINGLE_LIMIT},
        "volume": {"floor": VOL_CONFIDENCE_FLOOR, "basis": "team_baseline_x0.8"},
        "dev_node_keys": list(_DEV_NODE_KEYS),
    }


@router.get("/groups")
def list_groups() -> dict[str, Any]:
    """评议组别下拉选项：取自 user_account.group_name 的去重非空值。"""
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT group_name FROM user_account "
            "WHERE is_active = TRUE AND COALESCE(group_name, '') <> '' "
            "ORDER BY group_name"
        ).fetchall()
    return {"groups": [str(r.get("group_name") or "") for r in rows]}


@router.get("/departments")
def list_departments(group_name: str = "") -> dict[str, Any]:
    """部门下拉选项：取自 user_account.min_dept 的去重非空值。

    传 group_name 时仅返回该组内出现过的部门（部门是组内细分，如 ONCALL 下设若干部门）。
    """
    grp = str(group_name or "").strip()
    with db_conn() as conn:
        if grp:
            rows = conn.execute(
                "SELECT DISTINCT min_dept FROM user_account "
                "WHERE is_active = TRUE AND COALESCE(min_dept, '') <> '' AND group_name = %s "
                "ORDER BY min_dept",
                (grp,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT min_dept FROM user_account "
                "WHERE is_active = TRUE AND COALESCE(min_dept, '') <> '' "
                "ORDER BY min_dept"
            ).fetchall()
    return {"departments": [str(r.get("min_dept") or "") for r in rows]}


def _compute_scores_payload(
    conn: psycopg.Connection,
    *,
    year: int,
    month: int,
    group_name: str,
    dept_set: set[str],
) -> dict[str, Any]:
    metrics_by_group = _build_ticket_metrics(conn, year, month)
    user_rows = conn.execute(
        "SELECT account, user_name, role_code, group_name, min_dept FROM user_account WHERE is_active = TRUE"
    ).fetchall()
    people = [r for r in user_rows if (not group_name or str(r.get("group_name") or "") == group_name)]
    people = [r for r in people if (not dept_set or str(r.get("min_dept") or "") in dept_set)]
    people = [r for r in people if str(r.get("role_code") or "") not in ("admin",)]
    extra_rows = conn.execute(
        """
        SELECT account, id, category, declared_score, is_excellent, description, evidence_url
        FROM oncall_eva_extra
        WHERE period_year = %s AND period_month = %s AND status = 'approved'
        """,
        (year, month),
    ).fetchall()
    event_rows = conn.execute(
        """
        SELECT account, id, kind, score, summary, evidence_url, recorder_name
        FROM oncall_eva_event
        WHERE period_year = %s AND period_month = %s
        """,
        (year, month),
    ).fetchall()

    extras_by_acc: dict[str, list[dict]] = {}
    for r in extra_rows:
        extras_by_acc.setdefault(str(r.get("account") or ""), []).append(r)
    events_by_acc: dict[str, list[dict]] = {}
    for r in event_rows:
        events_by_acc.setdefault(str(r.get("account") or ""), []).append(r)

    def _metric_for(acc: str, grp: str) -> dict[str, Any]:
        return (metrics_by_group.get(grp, {}) or {}).get(acc) or {
            "account": acc, "user_name": "", "ticket_count": 0,
            "sla_avg_hours": None, "independent_closure_rate": None, "dev_ticket_count": 0,
        }

    group_summary: dict[str, dict[str, Any]] = {}
    baseline_by_group: dict[str, float] = {}
    for grp in (GROUP_ONCALL, GROUP_RND):
        gp = [p for p in people if str(p.get("group_name") or "") == grp]
        g_total = sum(int(_metric_for(str(p.get("account") or ""), grp)["ticket_count"] or 0) for p in gp)
        g_base = round((g_total / max(1, len(gp))) * TICKET_THRESHOLD_RATIO, 2)
        baseline_by_group[grp] = g_base
        group_summary[grp] = {"headcount": len(gp), "total_tickets": g_total, "ticket_threshold": g_base}

    items: list[dict[str, Any]] = []
    for p in people:
        acc = str(p.get("account") or "")
        grp = str(p.get("group_name") or "")
        metric = _metric_for(acc, grp)
        baseline = baseline_by_group.get(grp, 0.0)
        extra = _aggregate_extras(extras_by_acc.get(acc) or [])
        event = _aggregate_events(events_by_acc.get(acc) or [])
        score = _person_score(metric, extra, event, baseline)
        items.append({
            "account": acc,
            "user_name": str(p.get("user_name") or "") or metric.get("user_name") or acc,
            "group_name": grp,
            "metrics": metric,
            "extras": extra,
            "events": event,
            **score,
        })
    items.sort(key=lambda x: x["total_score"], reverse=True)

    total_tickets = sum(int(i["metrics"].get("ticket_count") or 0) for i in items)
    headcount = len(people)
    if group_name in baseline_by_group:
        top_threshold = baseline_by_group[group_name]
    else:
        top_threshold = round((total_tickets / max(1, headcount)) * TICKET_THRESHOLD_RATIO, 2)
    return {
        "period": {"year": year, "month": month},
        "team": {
            "headcount": headcount,
            "total_tickets": total_tickets,
            "ticket_threshold": top_threshold,
            "avg_total_score": round(sum(i["total_score"] for i in items) / max(1, len(items)), 2),
            "groups": group_summary,
        },
        "items": items,
    }


@router.get("/scores")
def list_scores(
    year: int,
    month: int,
    operator_id: str = "",
    group_name: str = "",
    min_dept: list[str] | None = Query(default=None),
    force_refresh: bool = False,
) -> dict[str, Any]:
    _validate_period(year, month)
    dept_set = {str(d).strip() for d in (min_dept or []) if str(d).strip()}
    cache_key = _scores_cache_key(year, month, group_name, dept_set)
    if not force_refresh:
        cached = _scores_cache_get(cache_key)
        if cached is not None:
            return cached

    t0 = time.perf_counter()
    try:
        with db_conn() as conn:
            payload = _compute_scores_payload(
                conn, year=year, month=month, group_name=group_name, dept_set=dept_set,
            )
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)

    _scores_cache_set(cache_key, payload)
    logger.info(
        "oncall_eva scores computed year=%s month=%s group=%r depts=%s items=%s elapsed_ms=%.0f cached_ttl_s=%s",
        year,
        month,
        group_name or "",
        len(dept_set),
        len(payload.get("items") or []),
        (time.perf_counter() - t0) * 1000,
        ONCALL_EVA_SCORES_CACHE_SECONDS,
    )
    return payload


@router.get("/extras")
def list_extras(
    year: int,
    month: int,
    operator_id: str = "",
    account: str = "",
    status: str = "",
) -> dict[str, Any]:
    _validate_period(year, month)
    where = ["period_year = %s", "period_month = %s"]
    params: list[Any] = [year, month]
    if account:
        where.append("account = %s")
        params.append(account)
    if status:
        sts = [s.strip() for s in status.split(",") if s.strip()]
        invalid = [s for s in sts if s not in ALLOWED_EXTRA_STATUS]
        if invalid:
            raise HTTPException(status_code=400, detail=f"非法 status: {invalid}")
        if sts:
            placeholder = ",".join(["%s"] * len(sts))
            where.append(f"status IN ({placeholder})")
            params.extend(sts)
    sql = f"""
        SELECT id, account, user_name, period_year, period_month, category, description,
               evidence_url, declared_score, status, reviewer_id, reviewer_name,
               review_comment, reviewed_at, is_excellent, submitted_at
        FROM oncall_eva_extra
        WHERE {' AND '.join(where)}
        ORDER BY submitted_at DESC, id DESC
        """
    try:
        with db_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    return {"items": [_serialize_extra(r) for r in rows]}


@router.post("/extras")
def create_extra(payload: OncallExtraCreatePayload) -> dict[str, Any]:
    op = (payload.operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 必填")
    target_account = (payload.account or "").strip() or op
    if target_account != op:
        # 仅本人可申报
        with db_conn() as conn:
            if not _is_admin(conn, op):
                raise HTTPException(status_code=403, detail="仅本人可申报加分项")
    _validate_period(payload.period_year, payload.period_month)
    if payload.category not in EXTRA_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"非法 category: {payload.category}")
    description = (payload.description or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="description 必填")
    score = float(payload.declared_score or 0)
    per_item_cap = EXTRA_CATEGORIES[payload.category]["per_item"]
    if score < 0:
        raise HTTPException(status_code=400, detail="declared_score 不能为负")
    if score > per_item_cap * 2:
        raise HTTPException(status_code=400, detail=f"declared_score 不可超过 {per_item_cap * 2}")
    try:
        with db_conn() as conn:
            _, user_name = _user_display(conn, target_account)
            row = conn.execute(
                """
                INSERT INTO oncall_eva_extra (
                    account, user_name, period_year, period_month, category,
                    description, evidence_url, declared_score, status
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
                RETURNING id, submitted_at
                """,
                (
                    target_account,
                    user_name,
                    payload.period_year,
                    payload.period_month,
                    payload.category,
                    description,
                    (payload.evidence_url or "").strip(),
                    score,
                ),
            ).fetchone()
            conn.commit()
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    _scores_cache_invalidate_period(payload.period_year, payload.period_month)
    return {"id": row["id"], "status": "pending", "submitted_at": row["submitted_at"].isoformat()}


@router.patch("/extras/{extra_id}")
def review_extra(extra_id: int, payload: OncallExtraReviewPayload) -> dict[str, Any]:
    op = (payload.operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 必填")
    if payload.status not in ALLOWED_REVIEW_STATUS:
        raise HTTPException(status_code=400, detail="status 必须为 approved 或 rejected")
    period_year = 0
    period_month = 0
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT id, account, status, category, period_year, period_month FROM oncall_eva_extra WHERE id = %s",
                (extra_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="加分项不存在")
            if str(row.get("status")) != "pending":
                raise HTTPException(status_code=400, detail="仅 pending 加分项可审批")
            if not _is_admin(conn, op):
                raise HTTPException(status_code=403, detail="仅 admin 或 PL 可审批")
            _, reviewer_name = _user_display(conn, op)
            score_value = payload.declared_score
            if score_value is not None and score_value < 0:
                raise HTTPException(status_code=400, detail="declared_score 不能为负")
            if score_value is None:
                conn.execute(
                    """
                    UPDATE oncall_eva_extra
                    SET status = %s, reviewer_id = %s, reviewer_name = %s,
                        review_comment = %s, is_excellent = %s, reviewed_at = NOW()
                    WHERE id = %s
                    """,
                    (payload.status, op, reviewer_name, payload.review_comment or "", payload.is_excellent, extra_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE oncall_eva_extra
                    SET status = %s, reviewer_id = %s, reviewer_name = %s,
                        review_comment = %s, is_excellent = %s, declared_score = %s, reviewed_at = NOW()
                    WHERE id = %s
                    """,
                    (payload.status, op, reviewer_name, payload.review_comment or "", payload.is_excellent, float(score_value), extra_id),
                )
            conn.commit()
            period_year = int(row.get("period_year") or 0)
            period_month = int(row.get("period_month") or 0)
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    if period_year and period_month:
        _scores_cache_invalidate_period(period_year, period_month)
    return {"id": extra_id, "status": payload.status}


@router.delete("/extras/{extra_id}")
def withdraw_extra(extra_id: int, operator_id: str = "") -> dict[str, Any]:
    op = (operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 必填")
    period_year = 0
    period_month = 0
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT id, account, status, period_year, period_month FROM oncall_eva_extra WHERE id = %s",
                (extra_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="加分项不存在")
            is_self = str(row.get("account")) == op
            is_admin = _is_admin(conn, op)
            if not (is_self or is_admin):
                raise HTTPException(status_code=403, detail="无权撤回")
            if str(row.get("status")) != "pending" and not is_admin:
                raise HTTPException(status_code=400, detail="仅 pending 加分项可撤回")
            conn.execute("UPDATE oncall_eva_extra SET status = 'withdrawn' WHERE id = %s", (extra_id,))
            conn.commit()
            period_year = int(row.get("period_year") or 0)
            period_month = int(row.get("period_month") or 0)
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    if period_year and period_month:
        _scores_cache_invalidate_period(period_year, period_month)
    return {"id": extra_id, "status": "withdrawn"}


@router.get("/events")
def list_events(year: int, month: int, account: str = "", kind: str = "") -> dict[str, Any]:
    _validate_period(year, month)
    where = ["period_year = %s", "period_month = %s"]
    params: list[Any] = [year, month]
    if account:
        where.append("account = %s")
        params.append(account)
    if kind:
        if kind not in ("red", "black"):
            raise HTTPException(status_code=400, detail="kind 必须为 red 或 black")
        where.append("kind = %s")
        params.append(kind)
    sql = f"""
        SELECT id, account, user_name, period_year, period_month, kind, score,
               summary, evidence_url, recorder_id, recorder_name, recorded_at
        FROM oncall_eva_event
        WHERE {' AND '.join(where)}
        ORDER BY recorded_at DESC, id DESC
        """
    try:
        with db_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    return {"items": [_serialize_event(r) for r in rows]}


@router.post("/events")
def create_event(payload: OncallEventCreatePayload) -> dict[str, Any]:
    op = (payload.operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 必填")
    _validate_period(payload.period_year, payload.period_month)
    if payload.kind not in ("red", "black"):
        raise HTTPException(status_code=400, detail="kind 必须为 red 或 black")
    if payload.score < 0 or payload.score > EVENT_SINGLE_LIMIT:
        raise HTTPException(status_code=400, detail=f"score 必须在 0 ~ {EVENT_SINGLE_LIMIT}")
    summary = (payload.summary or "").strip()
    if not summary:
        raise HTTPException(status_code=400, detail="summary 必填")
    target = (payload.account or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="account 必填")
    try:
        with db_conn() as conn:
            if not _is_admin(conn, op):
                raise HTTPException(status_code=403, detail="仅 admin 或 PL 可录入红黑事件")
            _, target_name = _user_display(conn, target)
            _, recorder_name = _user_display(conn, op)
            row = conn.execute(
                """
                INSERT INTO oncall_eva_event (
                    account, user_name, period_year, period_month, kind,
                    score, summary, evidence_url, recorder_id, recorder_name
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, recorded_at
                """,
                (
                    target,
                    target_name,
                    payload.period_year,
                    payload.period_month,
                    payload.kind,
                    float(payload.score),
                    summary,
                    (payload.evidence_url or "").strip(),
                    op,
                    recorder_name,
                ),
            ).fetchone()
            conn.commit()
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    _scores_cache_invalidate_period(payload.period_year, payload.period_month)
    return {"id": row["id"], "recorded_at": row["recorded_at"].isoformat()}


@router.delete("/events/{event_id}")
def delete_event(event_id: int, operator_id: str = "") -> dict[str, Any]:
    op = (operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 必填")
    try:
        with db_conn() as conn:
            if not _is_admin(conn, op):
                raise HTTPException(status_code=403, detail="仅 admin 或 PL 可删除")
            row = conn.execute(
                "SELECT period_year, period_month FROM oncall_eva_event WHERE id = %s",
                (event_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="事件不存在")
            conn.execute("DELETE FROM oncall_eva_event WHERE id = %s", (event_id,))
            conn.commit()
            period_year = int(row.get("period_year") or 0)
            period_month = int(row.get("period_month") or 0)
    except psycopg.errors.UndefinedTable:
        raise HTTPException(status_code=500, detail=_ONCALL_SCHEMA_HINT)
    if period_year and period_month:
        _scores_cache_invalidate_period(period_year, period_month)
    return {"id": event_id}


def _serialize_extra(row: dict) -> dict[str, Any]:
    return {
        "id": int(row.get("id") or 0),
        "account": str(row.get("account") or ""),
        "user_name": str(row.get("user_name") or ""),
        "period_year": int(row.get("period_year") or 0),
        "period_month": int(row.get("period_month") or 0),
        "category": str(row.get("category") or ""),
        "description": str(row.get("description") or ""),
        "evidence_url": str(row.get("evidence_url") or ""),
        "declared_score": float(row.get("declared_score") or 0),
        "status": str(row.get("status") or ""),
        "reviewer_id": str(row.get("reviewer_id") or ""),
        "reviewer_name": str(row.get("reviewer_name") or ""),
        "review_comment": str(row.get("review_comment") or ""),
        "reviewed_at": row.get("reviewed_at").isoformat() if row.get("reviewed_at") else "",
        "is_excellent": bool(row.get("is_excellent") or False),
        "submitted_at": row.get("submitted_at").isoformat() if row.get("submitted_at") else "",
    }


def _serialize_event(row: dict) -> dict[str, Any]:
    return {
        "id": int(row.get("id") or 0),
        "account": str(row.get("account") or ""),
        "user_name": str(row.get("user_name") or ""),
        "period_year": int(row.get("period_year") or 0),
        "period_month": int(row.get("period_month") or 0),
        "kind": str(row.get("kind") or ""),
        "score": float(row.get("score") or 0),
        "summary": str(row.get("summary") or ""),
        "evidence_url": str(row.get("evidence_url") or ""),
        "recorder_id": str(row.get("recorder_id") or ""),
        "recorder_name": str(row.get("recorder_name") or ""),
        "recorded_at": row.get("recorded_at").isoformat() if row.get("recorded_at") else "",
    }
