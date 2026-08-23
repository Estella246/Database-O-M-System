"""质量改进月度总结报告（改进报告）路由：

- GET    /api/improvement-report/{ym}           获取或初始化指定月份草稿（不存在自动创建空骨架）
- GET    /api/improvement-report/{ym}/import/{section}  从质量改进数据聚合计算指定段（只读不落库）
- PUT    /api/improvement-report/{ym}/sections  分段保存（覆盖式）
- POST   /api/improvement-report/{ym}/archive   归档（status=archived，archived_at=now）
- DELETE /api/improvement-report/{ym}/archive   取消归档（回到 draft）
- GET    /api/improvement-report                列表（按 status 过滤，按月降序）
- DELETE /api/improvement-report/{ym}           删除（仅 draft）

报告内容四段以 JSONB 存储，section key 与前端约定一致：
  overview（整体概况）/ overall（质量改进整体分析）/ domain（质量改进领域分析）/ monthly_new（本月新增改进诉求）

口径说明（与 /api/qi/analytics 保持一致，窗口例外）：
- 窗口：一句话进展与整体分析 = 所选年 1 月 1 日至所选月末（YTD）；详细进展与本月新增表 = 所选月。
- 统计一律排除草稿（current_status != 'draft'）。
- 已接纳 = 确认(analysis)阶段非草稿数据 accept=是；已确认 = accept 有结论（是/否）；
  已实施闭环 = 验收通过关单（current_status='closed' AND current_stage='acceptance'）。
- 超期：统一「started_at + SLA 小时」（qi_stage_sla_config 全阶段可配；实施不再用单上填的 sla_time）。
- 「团队/责任田」分组 = 在研责任田（目录 research_duty_field + 关联 research_duty_field_binding，
  多模块可共田、按田合并统计；模块槽位恒优先、整领域槽位兜底）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Query

from database import db_conn
import report_lifecycle
from models import ImprovementReportArchivePayload, ImprovementReportSectionPutPayload
from qi_research_field import (
    match_research_bucket,
    module_window_counts,
    research_field_buckets,
    research_scope_text,
)
from routers.qi import (
    _compute_overdue,
    _html_to_text,
    _load_stage_sla,
    _stage_cn,
    _HANDLER_CASE_SQL,
)
from whitelist_policy import whitelist_field_levels, whitelist_permission_level

_SCHEMA_HINT = "请在数据库执行 db/migrations/0120_improvement_report.sql"
# 生命周期（取或初始化/分段保存/归档/取消归档/列表/删除）委托 report_lifecycle，差异由 _SPEC 参数化
_SPEC = report_lifecycle.ReportSpec(
    table="improvement_report",
    label="改进报告",
    default_title_suffix="改进报告",
    section_cols={
        "overview": "section_overview",
        "overall": "section_overall",
        "domain": "section_domain",
        "monthly_new": "section_monthly_new",
    },
    schema_hint=_SCHEMA_HINT,
)
_validate_month = report_lifecycle.validate_month

router = APIRouter(prefix="/api/improvement-report", tags=["improvement-report"])


# ---------- 月份与窗口 ----------
def _windows(ym: str) -> tuple[datetime, datetime, datetime]:
    """返回 (ytd_start, month_start, month_end)，均为 UTC 时刻（与 /api/qi/analytics 窗口一致）。"""
    year, month = int(ym[:4]), int(ym[4:])
    ytd_start = datetime(year, 1, 1, tzinfo=timezone.utc)
    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = datetime(year + (month == 12), (month % 12) + 1, 1, tzinfo=timezone.utc)
    return ytd_start, month_start, month_end


def _kv_sorted(counts: dict[str, int]) -> list[dict[str, Any]]:
    return sorted(
        [{"name": k, "value": v} for k, v in counts.items() if v],
        key=lambda d: d["value"], reverse=True,
    )


def _pct(numer: int, denom: int) -> int:
    return round(numer / denom * 100) if denom else 0


# ---------- 聚合公共件 ----------
_OVERDUE_STAGES = ("analysis", "closure")


def _inflight_rows(conn: psycopg.Connection, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """窗口内在途单（含当前阶段最新实例 started_at / 阶段处理人），供超期与超期率计算。"""
    rows = conn.execute(
        f"""SELECT r.id, r.domain, r.module_feature, r.current_stage,
                   s.started_at,
                   {_HANDLER_CASE} AS handler
            FROM qi_request r
            JOIN LATERAL (
              -- 阶段打回重入会给同一 stage_key 插多条 qi_stage；只取最新一条实例
              SELECT s.started_at FROM qi_stage s
              WHERE s.request_id = r.id AND s.stage_key = r.current_stage
              ORDER BY s.id DESC LIMIT 1
            ) s ON TRUE
            LEFT JOIN LATERAL (
              SELECT resp.responsible FROM qi_stage resp
              WHERE resp.request_id = r.id AND resp.responsible <> ''
              ORDER BY resp.id DESC LIMIT 1
            ) resp ON TRUE
            WHERE r.current_status = 'in_progress'
              AND r.created_at >= %s AND r.created_at < %s""",
        (start, end),
    ).fetchall()
    return [dict(r) for r in rows]


# 与 /api/qi/analytics handler_stage_distribution 同口径的当前处理人表达式
# （规则唯一事实源见 routers/qi.py _HANDLER_CASE_SQL，此处仅做报告侧包裹）
_HANDLER_CASE = f"COALESCE(NULLIF({_HANDLER_CASE_SQL}, ''), '未知')"


def _overdue_flags(rows: list[dict[str, Any]], now: datetime | None = None, *, conn: psycopg.Connection | None = None):
    """给在途单列表补 overdue / overdue_at（超期判定时点=started_at+SLA 小时）。
    conn 传入时复用调用方连接加载 SLA 配置，省一次额外握手。"""
    sla_map = _load_stage_sla(conn)
    now = now or datetime.now(timezone.utc)
    for r in rows:
        stage = str(r.get("current_stage") or "")
        hours = sla_map.get(stage, 0)
        started = r.get("started_at")
        r["overdue"] = _compute_overdue(sla_map, stage, "in_progress", started)
        r["overdue_at"] = None
        if hours and started is not None:
            try:
                st = started if started.tzinfo else started.replace(tzinfo=timezone.utc)
                r["overdue_at"] = st + timedelta(hours=hours)
            except Exception:
                r["overdue_at"] = None
    return rows


# ---------- 一、整体概况（overview） ----------
def _compute_overview(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    ytd_start, month_start, month_end = _windows(ym)
    yy, mm = int(ym[:4]), int(ym[4:])

    # ---- YTD 累计 ----
    base = "current_status != 'draft' AND created_at >= %s AND created_at < %s"
    total = int(conn.execute(
        f"SELECT COUNT(*) AS c FROM qi_request WHERE {base}", (ytd_start, month_end),
    ).fetchone()["c"] or 0)
    accepted = int(conn.execute(
        f"""SELECT COUNT(*) AS c FROM qi_request r
            WHERE r.current_status != 'draft' AND r.created_at >= %s AND r.created_at < %s
              AND EXISTS (
                SELECT 1 FROM qi_stage_data sd JOIN qi_stage s ON s.id = sd.stage_id
                WHERE sd.request_id = r.id AND sd.stage_key = 'analysis'
                  AND sd.draft = FALSE AND sd.values_json->>'accept' = '是')""",
        (ytd_start, month_end),
    ).fetchone()["c"] or 0)
    # 已实施闭环：按解决版本分组（版本取 closure 阶段最新非草稿数据）
    version_rows = conn.execute(
        f"""SELECT COALESCE(NULLIF(cvd.v,''),'未填写') AS v, COUNT(*) AS c
            FROM qi_request r
            LEFT JOIN LATERAL (
              SELECT sd.values_json->>'accept_version' AS v
              FROM qi_stage_data sd JOIN qi_stage s ON s.id = sd.stage_id
              WHERE sd.request_id = r.id AND sd.stage_key = 'closure' AND sd.draft = FALSE
              ORDER BY sd.created_at DESC LIMIT 1
            ) cvd ON TRUE
            WHERE r.current_status = 'closed' AND r.current_stage = 'acceptance'
              AND r.created_at >= %s AND r.created_at < %s
            GROUP BY v ORDER BY c DESC""",
        (ytd_start, month_end),
    ).fetchall()
    by_version = [{"name": str(r["v"]), "value": int(r["c"])} for r in version_rows]
    closed_done = sum(x["value"] for x in by_version)

    # YTD 在途超期（按在研责任田分组）
    rf_buckets = research_field_buckets(conn)
    inflight = _overdue_flags(_inflight_rows(conn, ytd_start, month_end))
    overdue = 0
    overdue_by_field: dict[str, int] = {}
    for r in inflight:
        if not r["overdue"]:
            continue
        overdue += 1
        bi = match_research_bucket(rf_buckets, str(r["domain"] or ""), str(r["module_feature"] or ""))
        if bi >= 0:
            name = rf_buckets[bi]["name"]
            overdue_by_field[name] = overdue_by_field.get(name, 0) + 1

    # ---- 所选月详细 ----
    mbase = "current_status != 'draft' AND created_at >= %s AND created_at < %s"
    cat_rows = conn.execute(
        f"SELECT category AS k, COUNT(*) AS c FROM qi_request WHERE {mbase} GROUP BY k ORDER BY c DESC",
        (month_start, month_end),
    ).fetchall()
    new_by_category = [{"name": str(r["k"] or "未分类"), "value": int(r["c"])} for r in cat_rows]
    new_count = sum(x["value"] for x in new_by_category)
    mod_rows = conn.execute(
        f"""SELECT COALESCE(NULLIF(domain,''),'未分类') || '/' || COALESCE(NULLIF(module_feature,''),'未分类') AS k,
                   COUNT(*) AS c
            FROM qi_request WHERE {mbase} GROUP BY k ORDER BY c DESC LIMIT 5""",
        (month_start, month_end),
    ).fetchall()
    top_modules = [{"name": str(r["k"]), "value": int(r["c"])} for r in mod_rows]

    # 本月新增闭环：验收通过关单且最终验收完成时间落在本月
    closed_rows = conn.execute(
        f"""SELECT r.domain, r.module_feature
            FROM qi_request r
            JOIN LATERAL (
              SELECT s.completed_at FROM qi_stage s
              WHERE s.request_id = r.id AND s.stage_key = 'acceptance'
              ORDER BY s.id DESC LIMIT 1
            ) s ON TRUE
            WHERE r.current_status = 'closed' AND r.current_stage = 'acceptance'
              AND s.completed_at >= %s AND s.completed_at < %s
              AND r.created_at >= %s AND r.created_at < %s""",
        (month_start, month_end, ytd_start, month_end),
    ).fetchall()
    closed_by_field: dict[str, int] = {}
    for r in closed_rows:
        bi = match_research_bucket(rf_buckets, str(r["domain"] or ""), str(r["module_feature"] or ""))
        if bi >= 0:
            name = rf_buckets[bi]["name"]
            closed_by_field[name] = closed_by_field.get(name, 0) + 1

    # 本月新增超期：在途超期单中超期判定时点落在本月
    overdue_new_by_field: dict[str, int] = {}
    overdue_new = 0
    for r in inflight:
        at = r.get("overdue_at")
        if not r["overdue"] or at is None:
            continue
        if month_start <= at < month_end:
            overdue_new += 1
            bi = match_research_bucket(rf_buckets, str(r["domain"] or ""), str(r["module_feature"] or ""))
            if bi >= 0:
                name = rf_buckets[bi]["name"]
                overdue_new_by_field[name] = overdue_new_by_field.get(name, 0) + 1

    # ---- 模板拼句 ----
    ver_txt = "、".join(f"{x['name']}版本{x['value']}条" for x in by_version) or "暂无版本落地"
    od_txt = "、".join(f"{k}{v}条" for k, v in sorted(overdue_by_field.items(), key=lambda kv: -kv[1])) or "无集中责任田"
    one_line = (
        f"{yy}年累计识别现网改进诉求{total}条，其中{accepted}条已接纳，{closed_done}条已实施闭环"
        f"（已落地在{ver_txt}），{overdue}条超期，其中{od_txt}"
    )
    cat_txt = "、".join(f"{x['name']}类型{x['value']}条" for x in new_by_category) or "无新增"
    mod_txt = "、".join(f"{x['name']}" for x in top_modules[:3]) or "暂无集中模块"
    clo_txt = "、".join(f"责任田{k}有{v}条" for k, v in sorted(closed_by_field.items(), key=lambda kv: -kv[1])) or "无闭环"
    odn_txt = "、".join(f"责任田{k}有{v}条" for k, v in sorted(overdue_new_by_field.items(), key=lambda kv: -kv[1])) or "无超期"
    detail = (
        f"{yy}年{mm}月，1）新增改进诉求{new_count}条，其中{cat_txt}，模块主要集中在{mod_txt}。"
        f"2）新增闭环诉求{len(closed_rows)}条，其中{clo_txt}。"
        f"3）新增超期诉求{overdue_new}条，其中{odn_txt}。"
    )
    return {
        "one_line": one_line,
        "detail": detail,
        "ytd": {"total": total, "accepted": accepted, "closed_done": closed_done,
                "by_version": by_version, "overdue": overdue,
                "overdue_by_field": _kv_sorted(overdue_by_field)},
        "month": {"label": f"{yy}年{mm}月", "new_count": new_count, "new_by_category": new_by_category,
                  "top_modules": top_modules, "closed_count": len(closed_rows),
                  "closed_by_field": _kv_sorted(closed_by_field),
                  "overdue_new": overdue_new, "overdue_new_by_field": _kv_sorted(overdue_new_by_field)},
    }


# ---------- 二、质量改进整体分析（overall） ----------


def _rf_rates(
    conn: psycopg.Connection,
    start: datetime,
    end: datetime,
    *,
    buckets: list[dict[str, Any]] | None = None,
    inflight: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """在研责任田三率（窗口内）：接纳率=已接纳/已确认、闭环率=已闭环/已接纳、
    超期率=（确认+实施在途超期）/（确认+实施在途总量）。
    buckets/inflight 可由调用方传入复用（同一窗口在 overall/domain 段已取过，
    避免重查询双 LATERAL 在途单与责任田桶重复执行）。"""
    rf_buckets = buckets if buckets is not None else research_field_buckets(conn)
    stats = [
        {"total": 0, "analyzed": 0, "accepted": 0, "closed_done": 0,
         "analysis_total": 0, "analysis_overdue": 0, "closure_total": 0, "closure_overdue": 0}
        for _ in rf_buckets
    ]
    rows = module_window_counts(conn, start, end)
    for r in rows:
        bi = match_research_bucket(rf_buckets, str(r["domain"] or ""), str(r["module_feature"] or ""))
        if bi < 0:
            continue
        s = stats[bi]
        s["total"] += int(r["total"])
        s["analyzed"] += int(r["analyzed"])
        s["accepted"] += int(r["accepted"])
        s["closed_done"] += int(r["closed_done"])
    if inflight is None:
        inflight = _overdue_flags(_inflight_rows(conn, start, end), conn=conn)
    for r in inflight:
        stage = str(r.get("current_stage") or "")
        if stage not in _OVERDUE_STAGES:
            continue
        bi = match_research_bucket(rf_buckets, str(r["domain"] or ""), str(r["module_feature"] or ""))
        if bi < 0:
            continue
        s = stats[bi]
        if stage == "analysis":
            s["analysis_total"] += 1
            s["analysis_overdue"] += 1 if r["overdue"] else 0
        else:
            s["closure_total"] += 1
            s["closure_overdue"] += 1 if r["overdue"] else 0
    out = []
    for b, s in zip(rf_buckets, stats):
        od = s["analysis_overdue"] + s["closure_overdue"]
        tot = s["analysis_total"] + s["closure_total"]
        out.append({
            "name": b["name"], "owner": b["owner"], "domain": research_scope_text(b), "module": "",
            **s,
            "accept_rate": _pct(s["accepted"], s["analyzed"]),
            "closure_rate": _pct(s["closed_done"], s["accepted"]),
            "overdue_rate": _pct(od, tot),
        })
    return out


def _compute_overall(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    ytd_start, month_start, month_end = _windows(ym)
    base = "current_status != 'draft' AND created_at >= %s AND created_at < %s"
    total = int(conn.execute(
        f"SELECT COUNT(*) AS c FROM qi_request WHERE {base}", (ytd_start, month_end),
    ).fetchone()["c"] or 0)
    analyzed = int(conn.execute(
        f"""SELECT COUNT(*) AS c FROM qi_request r
            WHERE r.current_status != 'draft' AND r.created_at >= %s AND r.created_at < %s
              AND EXISTS (
                SELECT 1 FROM qi_stage_data sd JOIN qi_stage s ON s.id = sd.stage_id
                WHERE sd.request_id = r.id AND sd.stage_key = 'analysis'
                  AND sd.draft = FALSE AND sd.values_json->>'accept' IN ('是','否'))""",
        (ytd_start, month_end),
    ).fetchone()["c"] or 0)
    accepted = int(conn.execute(
        f"""SELECT COUNT(*) AS c FROM qi_request r
            WHERE r.current_status != 'draft' AND r.created_at >= %s AND r.created_at < %s
              AND EXISTS (
                SELECT 1 FROM qi_stage_data sd JOIN qi_stage s ON s.id = sd.stage_id
                WHERE sd.request_id = r.id AND sd.stage_key = 'analysis'
                  AND sd.draft = FALSE AND sd.values_json->>'accept' = '是')""",
        (ytd_start, month_end),
    ).fetchone()["c"] or 0)
    closed_done = int(conn.execute(
        f"""SELECT COUNT(*) AS c FROM qi_request r
            WHERE r.current_status != 'draft' AND r.created_at >= %s AND r.created_at < %s
              AND r.current_status = 'closed' AND r.current_stage = 'acceptance'""",
        (ytd_start, month_end),
    ).fetchone()["c"] or 0)
    inflight = _overdue_flags(_inflight_rows(conn, ytd_start, month_end), conn=conn)
    in_progress = len(inflight)
    overdue = sum(1 for r in inflight if r["overdue"])
    month_new = int(conn.execute(
        f"SELECT COUNT(*) AS c FROM qi_request WHERE {base}", (month_start, month_end),
    ).fetchone()["c"] or 0)

    accept_rate = _pct(accepted, analyzed)
    closure_rate = _pct(closed_done, accepted)
    overdue_rate = round(overdue / in_progress * 100, 1) if in_progress else 0
    summary = (
        f"整体接纳率{accept_rate}%（{accepted}/{analyzed}），闭环率{closure_rate}%（{closed_done}/{accepted}），"
        f"超期率{overdue_rate}%（{overdue}/{in_progress}）"
    )

    # 领域饼与第三段一/二级序列共用同一份 领域×模块 计数行（保证两段领域口径一致）
    domain_counts: dict[str, int] = {}
    for r in _domain_module_rows(conn, ym):
        k = str(r["domain"])
        domain_counts[k] = domain_counts.get(k, 0) + int(r["c"])
    stage_rows = conn.execute(
        f"SELECT current_stage AS k, COUNT(*) AS c FROM qi_request WHERE {base} GROUP BY k",
        (ytd_start, month_end),
    ).fetchall()
    stage_map = {str(r["k"]): int(r["c"]) for r in stage_rows}
    from qi_config import QI_STAGE_KEYS
    rf_buckets = research_field_buckets(conn)
    rf = _rf_rates(conn, ytd_start, month_end, inflight=inflight, buckets=rf_buckets)
    return {
        "kpi": {
            "summary": summary,
            "total": total, "in_progress": in_progress, "overdue": overdue,
            "analyzed": analyzed, "accepted": accepted, "closed_done": closed_done,
            "accept_rate": accept_rate, "closure_rate": closure_rate,
            "month_new": month_new, "overdue_rate": overdue_rate,
        },
        "domain_pie": _kv_sorted(domain_counts),
        "stage_pie": [{"name": _stage_cn(s), "value": stage_map.get(s, 0)} for s in QI_STAGE_KEYS],
        "rf_accept_rate": [{"name": x["name"], "value": x["accept_rate"]} for x in rf if x["analyzed"] > 0],
        "rf_overdue_rate": [
            {"name": x["name"], "value": x["overdue_rate"]}
            for x in rf if (x["analysis_total"] + x["closure_total"]) > 0
        ],
        "research_field_stats": rf,
    }


# ---------- 三、质量改进领域分析（domain） ----------
def _domain_module_rows(conn: psycopg.Connection, ym: str) -> list[Any]:
    """YTD 非草稿单的 领域×模块 计数行（空领域归「未分类」）。
    第二段领域饼与第三段一/二级序列共用本查询，两段领域口径始终一致。"""
    ytd_start, _, month_end = _windows(ym)
    return conn.execute(
        """SELECT COALESCE(NULLIF(domain,''),'未分类') AS domain, module_feature, COUNT(*) AS c
            FROM qi_request
            WHERE current_status != 'draft' AND created_at >= %s AND created_at < %s
            GROUP BY domain, module_feature""",
        (ytd_start, month_end),
    ).fetchall()


def _compute_domain(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    """模块&特性分布（从领域算起，与统计页粒度口径一致）：一级=领域本身，
    二级=领域/模块路径首段（多段路径取首段）；空模块以「领域/未分类」伪段呈现，
    与统计页口径一致（统计页将空模块 COALESCE 为「未分类」）。
    数据窗口 = YTD（与整体分析一致）；按数值降序，柱图与饼图共用同一序列。"""
    l1: dict[str, int] = {}
    l2: dict[str, int] = {}
    for r in _domain_module_rows(conn, ym):
        domain = str(r["domain"])
        segs = [s for s in str(r["module_feature"] or "").split("/") if s.strip()]
        l1[domain] = l1.get(domain, 0) + int(r["c"])
        key2 = "/".join([domain, *(segs[:1] or ["未分类"])])
        l2[key2] = l2.get(key2, 0) + int(r["c"])
    return {"level1": _kv_sorted(l1), "level2": _kv_sorted(l2)}


# ---------- 四、本月新增改进诉求（monthly_new） ----------
def _compute_monthly_new(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    _, month_start, month_end = _windows(ym)
    rows = conn.execute(
        f"""SELECT qi_no, title, description, priority, domain, proposer
            FROM qi_request
            WHERE current_status != 'draft' AND created_at >= %s AND created_at < %s
            ORDER BY id""",
        (month_start, month_end),
    ).fetchall()
    return {
        "rows": [{
            "qi_no": str(r["qi_no"] or ""),
            "title": str(r["title"] or ""),
            "description": _html_to_text(str(r["description"] or "")),
            "priority": str(r["priority"] or ""),
            "domain": str(r["domain"] or ""),
            "proposer": str(r["proposer"] or ""),
        } for r in rows],
    }


# ---------- 路由（生命周期委托 report_lifecycle，差异由 _SPEC 参数化） ----------
def _require_visible(operator_id: str) -> None:
    """改进报告默认隐藏（PERMISSION_DEFAULT_HIDDEN_KEYS）：白名单 hidden 时深链/全部接口 403。

    与前端 whitelistAllows("improvement_report", "readonly") 同口径；operator_id 缺省按默认策略（fail-closed）。
    """
    with db_conn() as conn:
        wl = whitelist_field_levels(conn, (operator_id or "").strip())
    if whitelist_permission_level(wl, "improvement_report") == "hidden":
        raise HTTPException(status_code=403, detail="无改进报告权限（improvement_report 隐藏）")


@router.get("/{ym}")
def get_or_init_report(
    ym: str, operator_id: str = Query("", description="操作者账号（白名单校验）")
) -> dict[str, Any]:
    _require_visible(operator_id)
    return report_lifecycle.get_or_init(_SPEC, _validate_month(ym))


@router.get("/{ym}/import/{section}")
def import_section(
    ym: str, section: str, operator_id: str = Query("", description="操作者账号（白名单校验）")
) -> dict[str, Any]:
    """从质量改进数据聚合计算指定段（只读，不落库）。返回结构与前端段数据一致。"""
    _require_visible(operator_id)
    ym = _validate_month(ym)
    section = (section or "").strip()
    try:
        with db_conn() as conn:
            if section == "overview":
                return _compute_overview(conn, ym)
            if section == "overall":
                return _compute_overall(conn, ym)
            if section == "domain":
                return _compute_domain(conn, ym)
            if section == "monthly_new":
                return _compute_monthly_new(conn, ym)
            raise HTTPException(status_code=400, detail=f"该段不支持导入：{section}")
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise report_lifecycle.wrap_schema_error(_SPEC, exc)


@router.put("/{ym}/sections")
def update_section(
    ym: str, payload: ImprovementReportSectionPutPayload, operator_id: str = Query("", description="操作者账号（白名单校验）")
) -> dict[str, Any]:
    _require_visible(operator_id)
    return report_lifecycle.update_section(
        _SPEC, _validate_month(ym), payload.section, payload.data
    )


@router.post("/{ym}/archive")
def archive_report(
    ym: str, payload: ImprovementReportArchivePayload, operator_id: str = Query("", description="操作者账号（白名单校验）")
) -> dict[str, Any]:
    _require_visible(operator_id)
    return report_lifecycle.archive(_SPEC, _validate_month(ym), payload.title)


@router.delete("/{ym}/archive")
def unarchive_report(
    ym: str, operator_id: str = Query("", description="操作者账号（白名单校验）")
) -> dict[str, Any]:
    _require_visible(operator_id)
    return report_lifecycle.unarchive(_SPEC, _validate_month(ym))


@router.get("")
def list_reports(
    status: str = Query("", description="draft / archived / 空=全部"),
    operator_id: str = Query("", description="操作者账号（白名单校验）"),
) -> dict[str, Any]:
    _require_visible(operator_id)
    return report_lifecycle.list_reports(_SPEC, status)


@router.delete("/{ym}")
def delete_report(
    ym: str, operator_id: str = Query("", description="操作者账号（白名单校验）")
) -> dict[str, Any]:
    _require_visible(operator_id)
    return report_lifecycle.delete(_SPEC, _validate_month(ym))
