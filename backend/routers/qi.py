"""质量改进（Quality Improvement）5 阶段工作流路由。

/api/qi —— 与旧 /api/requirements 并存（方案 B）。
权限复用 requirement_list/create/import/export 四个白名单键。
"""

from __future__ import annotations

import json
import urllib.parse
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, Alignment, Border, Side

from config import _QI_SCHEMA_HINT
from database import db_conn
from models import (
    QiCreatePayload,
    QiPatchPayload,
    QiSubmitPayload,
    QiSavePayload,
    QiProgressItemPayload,
    QiExportPayload,
    QiMigrateLegacyPayload,
    QiTransferPayload,
)
from qi_config import (
    QI_CATEGORIES,
    QI_PROGRESS_STAGES,
    QI_STAGE_FIELDS,
    QI_STAGE_KEYS,
    QI_STAGE_NAMES_CN,
)
from qi_flow import (
    _display_name_account,
    _latest_responsible,
    build_closure_no,
    get_active_stage,
    get_request_dict,
    is_reject_handle,
    propose_values_to_request,
    resolve_next_stage,
    validate_stage_values,
)
from utils.qi_no import allocate_qi_no
from utils.logging_config import audit_log
from whitelist_policy import whitelist_field_levels, whitelist_permission_level

router = APIRouter(prefix="/api/qi", tags=["quality-improvement"])

# person 类型字段 → 对应白名单表（仅表名，不含 schema）
_PERSON_WHITELIST_TABLE: dict[str, str] = {
    "reviewer": "qi_reviewer_candidates",
    "responsible": "qi_analyst_candidates",
}


def _schema_error() -> HTTPException:
    return HTTPException(status_code=503, detail=f"质量改进表未就绪：{_QI_SCHEMA_HINT}")


def _validate_ticket_no_exists(ticket_no: str) -> None:
    """校验运维系统单号在 ticket 表中存在。"""
    no = str(ticket_no or "").strip()
    if not no:
        return
    try:
        with db_conn() as conn:
            exists = conn.execute(
                "SELECT 1 FROM ticket WHERE ticket_no = %s", (no,)
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=400, detail=f"关联运维系统单号不存在：{no}")
    except UndefinedTable:
        pass  # ticket 表可能未就绪，跳过校验


def _require_view(conn: psycopg.Connection, op: str) -> None:
    wl = whitelist_field_levels(conn, op)
    if whitelist_permission_level(wl, "requirement_list") == "hidden":
        raise HTTPException(status_code=403, detail="无质量改进查看权限")


def _require_edit(conn: psycopg.Connection, op: str) -> None:
    wl = whitelist_field_levels(conn, op)
    if whitelist_permission_level(wl, "requirement_create") == "hidden":
        raise HTTPException(status_code=403, detail="无质量改进编辑权限")


def _verify_current_handler(conn: psycopg.Connection, req_id: int, stage_key: str, op: str, values: dict | None = None) -> None:
    """校验操作人有权操作此阶段。当前阶段→验处理人；已完成阶段→验最后提交人。"""
    req = conn.execute("SELECT proposer, reviewer, current_stage FROM qi_request WHERE id=%s", (req_id,)).fetchone()
    if not req:
        raise HTTPException(status_code=404, detail="质量改进单不存在")
    current_stage = str(req["current_stage"])
    op_acc = str(op or "").strip()
    if not op_acc:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    # 当前阶段：验处理人
    if stage_key == current_stage:
        if current_stage in ("analysis", "closure"):
            resp = conn.execute(
                "SELECT responsible FROM qi_stage WHERE request_id=%s AND responsible<>'' ORDER BY id DESC LIMIT 1",
                (req_id,),
            ).fetchone()
            handler = str((resp["responsible"] if resp else "") or "")
        elif current_stage == "review":
            handler = str(req["reviewer"] or "")
        elif current_stage == "acceptance":
            # 验收阶段：优先取 qi_stage.responsible（转单后），无则回落提出人
            resp = conn.execute(
                "SELECT responsible FROM qi_stage WHERE request_id=%s AND stage_key='acceptance' AND responsible<>'' ORDER BY id DESC LIMIT 1",
                (req_id,),
            ).fetchone()
            handler = str((resp["responsible"] if resp else "") or "") or str(req["proposer"] or "")
        else:
            handler = str(req["proposer"] or "")
        handler_account = handler.split()[-1].strip() if " " in handler else handler.strip()
        if handler_account and op_acc != handler_account and op_acc not in handler.split():
            raise HTTPException(status_code=403, detail=f"仅当前处理人可提交，当前处理人: {handler or '(无)'}")
        return
    # 已完成阶段（amend）：流程已走过后即锁定，不可再修改
    from qi_config import QI_STAGE_ORDER
    cur_order = QI_STAGE_ORDER.get(current_stage, 99)
    edit_order = QI_STAGE_ORDER.get(stage_key, -1)
    if cur_order > edit_order + 1:
        raise HTTPException(status_code=403, detail="该阶段审核已完成，不可再修改")
    # 字段级锁定：下游阶段已用到的字段不可再改
    _FROZEN_FIELDS = {
        "propose": {"reviewer": "review"},           # 评审人 — 评审阶段已用
        "review": {"responsible": "analysis"},        # 责任人 — 分析阶段已用
    }
    frozen = _FROZEN_FIELDS.get(stage_key, {})
    if values:
        for fk, dep_stage in frozen.items():
            dep_order = QI_STAGE_ORDER.get(dep_stage, -1)
            if cur_order >= dep_order and values.get(fk):
                raise HTTPException(status_code=403,
                    detail=f"字段「{fk}」已被后续阶段使用，不可再修改")
    # 验最后提交人
    sd = conn.execute(
        "SELECT created_by FROM qi_stage_data WHERE request_id=%s AND stage_key=%s AND draft=FALSE ORDER BY created_at DESC LIMIT 1",
        (req_id, stage_key),
    ).fetchone()
    last_submitter = str((sd["created_by"] if sd else "") or "")


# ---- 阶段中文展示（列表/详情用） ----
def _stage_cn(stage: str) -> str:
    return QI_STAGE_NAMES_CN.get(stage, stage)


# ====================================================================
# 列表
# ====================================================================
@router.get("")
def list_qi(
    operator_id: str = "demo_001",
    scope: str = "all",
    stage: str = "",
    status: str = "",
    priority: str = "",
    category: str = "",
    q: str = "",
    handler: str = "",
    related_ticket_no: str = "",
    domain: str = "",
    module_feature: str = "",
    proposer: str = "",
    overdue: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    op = str(operator_id or "").strip() or "demo_001"
    sc = (scope or "all").strip().lower()
    if sc not in ("all", "mine", "handled"):
        raise HTTPException(status_code=400, detail="scope 须为 all / mine / handled")
    qq = str(q or "").strip()
    stage_list = [s.strip() for s in stage.split(",") if s.strip()] if stage else []
    status_list = [s.strip() for s in status.split(",") if s.strip()] if status else []
    prio_list = [p.strip() for p in priority.split(",") if p.strip()] if priority else []
    cat_list = [c.strip() for c in category.split(",") if c.strip()] if category else []
    pg = max(1, page)
    ps = max(1, min(10000, page_size))
    offset = (pg - 1) * ps
    try:
        with db_conn() as conn:
            _require_view(conn, op)
            where = ["1=1"]
            params: list = []
            if sc == "mine":
                # 我提出的：实际提交到评审阶段的人（flow_log: submitted, propose→review），
                # 或我创建的草稿（工单里暂存的改进建议，未提交评审）
                where.append("""(
                    EXISTS (
                        SELECT 1 FROM qi_flow_log fl
                        WHERE fl.request_id = r.id AND fl.action = 'submitted' AND fl.from_stage = 'propose'
                        AND fl.operator_id = %s
                    )
                    OR (current_status = 'draft' AND creator_id = %s)
                    OR (current_stage = 'propose' AND (proposer ILIKE %s OR proposer ILIKE %s))
                )""")
                params.extend([op, op, f"%{op}%", f"% {op}%"])
            elif sc == "handled":
                # 我处理的：我是提出人(提出阶段)/评审人/责任人/验收人
                where.append("""(
                    (current_stage = 'propose' AND (proposer ILIKE %s OR proposer ILIKE %s))
                    OR (current_stage = 'review' AND (reviewer ILIKE %s OR reviewer ILIKE %s))
                    OR (current_stage IN ('analysis','closure') AND EXISTS (
                        SELECT 1 FROM qi_stage s WHERE s.request_id=r.id AND s.responsible<>''
                        AND (s.responsible ILIKE %s OR s.responsible ILIKE %s)
                        ORDER BY s.id DESC LIMIT 1))
                    OR (current_stage = 'acceptance' AND EXISTS (
                        SELECT 1 FROM qi_stage s WHERE s.request_id=r.id AND s.stage_key='acceptance'
                        AND s.responsible<>'' AND (s.responsible ILIKE %s OR s.responsible ILIKE %s)
                        ORDER BY s.id DESC LIMIT 1))
                    OR (current_stage = 'acceptance' AND NOT EXISTS (
                        SELECT 1 FROM qi_stage s WHERE s.request_id=r.id AND s.stage_key='acceptance' AND s.responsible<>'')
                        AND (proposer ILIKE %s OR proposer ILIKE %s))
                )""")
                params.extend([f"%{op}%", f"% {op}%", f"%{op}%", f"% {op}%", f"%{op}%", f"% {op}%", f"%{op}%", f"% {op}%", f"%{op}%", f"% {op}%"])
            if stage_list:
                where.append(f"current_stage IN ({','.join(['%s']*len(stage_list))})")
                params.extend(stage_list)
            if status_list:
                where.append(f"current_status IN ({','.join(['%s']*len(status_list))})")
                params.extend(status_list)
            else:
                if sc == "handled":
                    where.append("current_status NOT IN ('draft', 'closed')")  # 我处理的：只看待处理（排除草稿和已关闭）
                elif sc != "mine":
                    where.append("current_status != 'draft'")  # all 默认排除草稿；mine 保留草稿
            if prio_list:
                where.append(f"priority IN ({','.join(['%s']*len(prio_list))})")
                params.extend(prio_list)
            if cat_list:
                where.append(f"category IN ({','.join(['%s']*len(cat_list))})")
                params.extend(cat_list)
            dv = str(domain or "").strip()
            if dv:
                where.append("domain ILIKE %s")
                params.append(f"%{dv}%")
            mv = str(module_feature or "").strip()
            if mv:
                where.append("module_feature ILIKE %s")
                params.append(f"%{mv}%")
            pv = str(proposer or "").strip()
            if pv:
                where.append("proposer ILIKE %s")
                params.append(f"%{pv}%")
            h_acc = str(handler or "").strip()
            if h_acc:
                where.append(
                    "((current_stage IN ('analysis','closure') AND EXISTS ("
                    " SELECT 1 FROM qi_stage s WHERE s.request_id=r.id AND s.responsible<>'' "
                    " AND (s.responsible ILIKE %s OR s.responsible ILIKE %s) ORDER BY s.id DESC LIMIT 1))"
                    " OR (current_stage='review' AND (reviewer ILIKE %s OR reviewer ILIKE %s))"
                    " OR (current_stage='acceptance' AND creator_id = %s)"
                    " OR (current_stage='propose' AND creator_id = %s))"
                )
                params.extend([f"%{h_acc}%", f"% {h_acc}%", f"%{h_acc}%", f"% {h_acc}%", h_acc, h_acc])
            tno = str(related_ticket_no or "").strip()
            if tno:
                where.append("related_ticket_no = %s")
                params.append(tno)
            if qq:
                like = f"%{qq}%"
                where.append(
                    "(qi_no ILIKE %s OR title ILIKE %s OR proposer ILIKE %s"
                    " OR related_ticket_no ILIKE %s OR category ILIKE %s"
                    " OR domain ILIKE %s OR module_feature ILIKE %s)"
                )
                params.extend([like] * 7)
            where_sql = " AND ".join(where)
            # is_overdue 为计算字段（依赖 started_at/SLA），不能进 WHERE；命中时全量取回后在 Python 端过滤
            _ov = str(overdue or "").strip().lower()
            ov_filter = _ov in ("true", "1", "yes", "false", "0", "no")
            ov_want_overdue = _ov in ("true", "1", "yes")
            limit_sql = "" if ov_filter else "\n                LIMIT %s OFFSET %s"
            limit_params: list = [] if ov_filter else [ps, offset]
            total = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM qi_request r WHERE {where_sql}", tuple(params)
            ).fetchone()["cnt"]
            rows = conn.execute(
                f"""
                SELECT r.id, r.qi_no, r.category, r.title, r.proposer, r.priority, r.domain, r.module_feature, r.description, r.related_ticket_no,
                       r.current_stage, r.current_status,
                       r.creator_id, r.creator_name, r.created_at, r.updated_at,
                       clsd.sla_time,
                       curst.started_at,
                       CASE WHEN r.current_status = 'closed' THEN NULL
                            ELSE GREATEST(0, EXTRACT(DAY FROM (NOW() - curst.started_at)))::int
                       END AS stagnant_days,
                       COALESCE(
                         CASE r.current_stage
                           WHEN 'analysis' THEN resp.responsible
                           WHEN 'closure'  THEN resp.responsible
                           WHEN 'acceptance' THEN r.proposer
                           WHEN 'review' THEN r.reviewer
                           WHEN 'propose' THEN r.proposer
                           ELSE ''
                         END, ''
                       ) AS current_handler
                FROM qi_request r
                LEFT JOIN LATERAL (
                  SELECT s.responsible
                  FROM qi_stage s
                  WHERE s.request_id = r.id AND s.responsible <> ''
                  ORDER BY s.id DESC LIMIT 1
                ) resp ON TRUE
                LEFT JOIN LATERAL (
                  SELECT s2.started_at
                  FROM qi_stage s2
                  WHERE s2.request_id = r.id AND s2.stage_key = r.current_stage
                  ORDER BY s2.id DESC LIMIT 1
                ) curst ON TRUE
                LEFT JOIN LATERAL (
                  SELECT sd2.values_json->>'sla_time' AS sla_time
                  FROM qi_stage_data sd2
                  JOIN qi_stage s2 ON s2.id = sd2.stage_id
                  WHERE sd2.request_id = r.id AND sd2.stage_key = 'closure'
                  ORDER BY sd2.draft ASC, sd2.created_at DESC LIMIT 1
                ) clsd ON TRUE
                WHERE {where_sql}
                ORDER BY CASE r.priority WHEN '高' THEN 1 WHEN '中' THEN 2 WHEN '低' THEN 3 ELSE 9 END,
                         r.created_at DESC, r.id DESC
                {limit_sql}
                """,
                tuple(params) + tuple(limit_params),
            ).fetchall()
    except UndefinedTable:
        raise _schema_error()
    items = []
    _sla_map = _load_stage_sla(conn)
    for r in rows:
        sla = str(r["sla_time"] or "") if r.get("sla_time") else ""
        overdue = _compute_overdue(_sla_map, r["current_stage"], r["current_status"], r["started_at"], sla)
        items.append({
            "id": r["id"], "qi_no": r["qi_no"],
            "is_overdue": overdue,
            "title": r["title"], "description": str(r["description"] or ""),
            "category": str(r["category"] or ""),
            "proposer": r["proposer"], "priority": r["priority"],
            "domain": str(r["domain"] or ""), "module_feature": str(r["module_feature"] or ""),
            "current_stage": r["current_stage"],
            "current_stage_cn": _stage_cn(r["current_stage"]),
            "current_status": r["current_status"],
            "current_handler": str(r["current_handler"] or ""),
            "stagnant_days": int(r["stagnant_days"]) if r.get("stagnant_days") is not None else None,
            "sla_time": sla,
            "related_ticket_no": str(r["related_ticket_no"] or ""),
            "creator_id": r["creator_id"], "creator_name": r["creator_name"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        })
    if ov_filter:
        items = [it for it in items if bool(it["is_overdue"]) == ov_want_overdue]
        total = len(items)
        items = items[offset:offset + ps]
    return {"items": items, "total": int(total or 0), "page": pg, "page_size": ps}


@router.get("/filter-options")
def qi_filter_options(operator_id: str = "demo_001") -> dict:
    """列表筛选项：去重的领域 / 模块&特性 / 提出人（供列筛选下拉）。"""
    op = str(operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_view(conn, op)
            domains = [str(r["v"]) for r in conn.execute(
                "SELECT DISTINCT domain AS v FROM qi_request WHERE domain <> '' ORDER BY domain"
            ).fetchall()]
            module_features = [str(r["v"]) for r in conn.execute(
                "SELECT DISTINCT module_feature AS v FROM qi_request WHERE module_feature <> '' ORDER BY module_feature"
            ).fetchall()]
            proposers = [str(r["v"]) for r in conn.execute(
                "SELECT DISTINCT proposer AS v FROM qi_request WHERE proposer <> '' ORDER BY proposer"
            ).fetchall()]
    except UndefinedTable:
        raise _schema_error()
    return {"domains": domains, "module_features": module_features, "proposers": proposers}


# ====================================================================
# 创建（提出阶段）
# ====================================================================
@router.post("")
def create_qi(payload: QiCreatePayload) -> dict:
    op = str(payload.operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="诉求标题不能为空")
    if not payload.related_ticket_no.strip():
        raise HTTPException(status_code=400, detail="关联运维系统单号不能为空")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="诉求描述不能为空")
    # 关联运维系统单号存在性校验
    _validate_ticket_no_exists(payload.related_ticket_no.strip())
    is_draft = bool(payload.draft)
    if not payload.reviewer.strip():
        raise HTTPException(status_code=400, detail="下一步处理人不能为空")
    _reviewer_account = ""
    if payload.reviewer.strip():
        _reviewer_account = payload.reviewer.strip().split()[-1] if " " in payload.reviewer.strip() else payload.reviewer.strip()
    category = payload.category.strip() or "质量加固和改进"
    priority = payload.priority.strip() or "中"
    if priority not in ("高", "中", "低"):
        raise HTTPException(status_code=400, detail="无效优先级")
    if category not in QI_CATEGORIES:
        raise HTTPException(status_code=400, detail="无效分类")
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            # 评审人存在性 + 白名单校验（草稿也校验，确保存的就是合法处理人）
            if not conn.execute("SELECT 1 FROM user_account WHERE account = %s", (_reviewer_account,)).fetchone():
                raise HTTPException(status_code=400, detail=f"评审人不是系统用户：{_reviewer_account}")
            if not conn.execute("SELECT 1 FROM qi_reviewer_candidates WHERE account = %s", (_reviewer_account,)).fetchone():
                raise HTTPException(status_code=400, detail=f"评审人不在白名单中：{_reviewer_account}")
            creator_disp = _display_name_account(conn, op)
            # 草稿使用临时占位编号（正式提交时替换为 QI-YYYY-NNN）
            qi_no = f"DRAFT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}" if is_draft else allocate_qi_no(conn)
            reviewer_val = payload.reviewer.strip()
            stage_val = "propose" if is_draft else "review"
            status_val = "draft" if is_draft else "in_progress"
            row = conn.execute(
                """
                INSERT INTO qi_request (
                    qi_no, category, proposer, title, related_ticket_no, description,
                    expected_goal, priority, domain, module_feature, planned_version,
                    reviewer, current_stage, current_status, creator_id, creator_name
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
                """,
                (qi_no, category, creator_disp, payload.title.strip(),
                 payload.related_ticket_no.strip(), payload.description.strip(),
                 payload.expected_goal.strip(), priority,
                 payload.domain.strip(), payload.module_feature.strip(),
                 payload.planned_version.strip(), reviewer_val, stage_val, status_val, op, creator_disp),
            ).fetchone()
            req_id = int(row["id"])
            # 提出阶段实例 + 数据
            stage = conn.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status)
                   VALUES (%s,'propose',1,'completed') RETURNING id""",
                (req_id,),
            ).fetchone()
            stage_id = int(stage["id"])
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
                   VALUES (%s,%s,'propose',%s::jsonb,%s)""",
                (stage_id, req_id, json.dumps(propose_values_to_request({
                    "category": payload.category, "title": payload.title,
                    "related_ticket_no": payload.related_ticket_no, "description": payload.description,
                    "expected_goal": payload.expected_goal, "priority": payload.priority,
                    "domain": payload.domain, "module_feature": payload.module_feature,
                    "planned_version": payload.planned_version, "reviewer": reviewer_val,
                }), ensure_ascii=False), op),
            )
            if not is_draft:
                conn.execute(
                    """INSERT INTO qi_stage (request_id, stage_key, sequence, status)
                       VALUES (%s,'review',1,'pending')""",
                    (req_id,),
                )
                conn.execute(
                    """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment)
                       VALUES (%s,'submitted','propose','review',%s,%s,'')""",
                    (req_id, op, creator_disp),
                )
            conn.commit()
            audit_log("qi.created", qi_no=qi_no, operator=op, draft=is_draft)
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"id": req_id, "qi_no": qi_no, "current_stage": stage_val, "current_status": status_val}


# ====================================================================
# 候选人白名单（评审人 / 分析人）—— 须在参数化路由之前定义
# ====================================================================
@router.get("/candidates/reviewer")
def get_reviewer_candidates(operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            rows = conn.execute("SELECT ua.account,ua.user_name FROM qi_reviewer_candidates rc JOIN user_account ua ON ua.account=rc.account WHERE ua.is_active ORDER BY ua.user_name").fetchall()
    except UndefinedTable:
        return {"candidates": []}
    return {"candidates": [{"account":r["account"],"user_name":r["user_name"],"display":f"{r['user_name']} {r['account']}".strip()} for r in rows]}

@router.post("/candidates/reviewer")
def set_reviewer_candidates(payload: dict) -> dict:
    op = str(payload.get("operator_id","system")).strip()
    accounts = list(set(str(a).strip() for a in (payload.get("accounts") or []) if str(a).strip()))
    if not accounts: raise HTTPException(status_code=400, detail="候选名单不能为空")
    try:
        with db_conn() as conn:
            conn.execute("DELETE FROM qi_reviewer_candidates WHERE account NOT IN (SELECT unnest(%s::varchar[]))", (accounts,))
            existing = {r["account"] for r in conn.execute("SELECT account FROM qi_reviewer_candidates").fetchall()}
            for a in accounts:
                if a not in existing: conn.execute("INSERT INTO qi_reviewer_candidates (account,updated_by) VALUES (%s,%s) ON CONFLICT DO NOTHING", (a,op))
            conn.commit()
    except UndefinedTable: raise _schema_error()
    return {"ok":True,"count":len(accounts)}

@router.get("/candidates/analyst")
def get_analyst_candidates(operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            rows = conn.execute("SELECT ua.account,ua.user_name FROM qi_analyst_candidates ac JOIN user_account ua ON ua.account=ac.account WHERE ua.is_active ORDER BY ua.user_name").fetchall()
    except UndefinedTable:
        return {"candidates": []}
    return {"candidates": [{"account":r["account"],"user_name":r["user_name"],"display":f"{r['user_name']} {r['account']}".strip()} for r in rows]}

@router.post("/candidates/analyst")
def set_analyst_candidates(payload: dict) -> dict:
    op = str(payload.get("operator_id","system")).strip()
    accounts = list(set(str(a).strip() for a in (payload.get("accounts") or []) if str(a).strip()))
    if not accounts: raise HTTPException(status_code=400, detail="候选名单不能为空")
    try:
        with db_conn() as conn:
            conn.execute("DELETE FROM qi_analyst_candidates WHERE account NOT IN (SELECT unnest(%s::varchar[]))", (accounts,))
            existing = {r["account"] for r in conn.execute("SELECT account FROM qi_analyst_candidates").fetchall()}
            for a in accounts:
                if a not in existing: conn.execute("INSERT INTO qi_analyst_candidates (account,updated_by) VALUES (%s,%s) ON CONFLICT DO NOTHING", (a,op))
            conn.commit()
    except UndefinedTable: raise _schema_error()
    return {"ok":True,"count":len(accounts)}


# ====================================================================
# 详情（聚合所有阶段 + 字段 + 进展子项 + 日志）
# ====================================================================
@router.get("/{req_id:int}")
def get_qi(req_id: int, operator_id: str = "demo_001") -> dict:
    op = str(operator_id or "").strip() or "demo_001"
    can_submit_draft = False
    try:
        with db_conn() as conn:
            _require_view(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            # 阶段 + 字段值（每阶段最新一行）
            stages = []
            for sk in QI_STAGE_KEYS:
                st = get_active_stage(conn, req_id, sk)
                if not st:
                    continue
                # 取该阶段最新一条非草稿数据（无则取草稿）
                sd = conn.execute(
                    """
                    SELECT id, values_json, amended, draft, created_by, created_at
                    FROM qi_stage_data
                    WHERE stage_id = %s
                    ORDER BY draft ASC, created_at DESC LIMIT 1
                    """,
                    (st["id"],),
                ).fetchone()
                raw = sd["values_json"] if sd else None
                values = dict(raw) if isinstance(raw, dict) else (json.loads(raw) if raw else {})
                # 打回重进时 stage_data 为空，从上一实例回填表单值
                if not values:
                    prev_sd = conn.execute(
                        """SELECT sd2.values_json FROM qi_stage_data sd2
                           JOIN qi_stage s2 ON s2.id = sd2.stage_id
                           WHERE s2.request_id = %s AND s2.stage_key = %s AND sd2.stage_id != %s
                           ORDER BY s2.sequence DESC LIMIT 1""",
                        (req_id, sk, st["id"]),
                    ).fetchone()
                    if prev_sd:
                        raw2 = prev_sd["values_json"]
                        values = dict(raw2) if isinstance(raw2, dict) else (json.loads(raw2) if raw2 else {})
                # propose 阶段字段存主表，stage_data 可能为空（打回重进实例无数据）→ 从主表回填，保证打回后表单回显
                if sk == "propose":
                    values.update({
                        "title": str(req.get("title") or ""),
                        "related_ticket_no": str(req.get("related_ticket_no") or ""),
                        "description": str(req.get("description") or ""),
                        "reviewer": str(req.get("reviewer") or ""),
                        "category": str(req.get("category") or ""),
                        "priority": str(req.get("priority") or ""),
                        "domain": str(req.get("domain") or ""),
                        "module_feature": str(req.get("module_feature") or ""),
                        "planned_version": str(req.get("planned_version") or ""),
                    })
                # 闭环单号：从闭环阶段自身取值拼前缀展示
                if sk == "closure" and not values.get("closure_no"):
                    cm = values.get("closure_method", "")
                    ct = values.get("closure_ticket_no", "")
                    if cm and ct:
                        values["closure_no"] = build_closure_no(str(cm), str(ct))
                last_submitter = str(sd["created_by"] or "").strip() if sd else ""
                stages.append({
                    "stage_key": sk, "stage_cn": _stage_cn(sk),
                    "sequence": st["sequence"], "status": st["status"],
                    "responsible": st["responsible"], "values": values,
                    "last_submitter": last_submitter,
                    "completed_at": st["completed_at"].isoformat() if st["completed_at"] else None,
                })
            # 进展子项
            progress = conn.execute(
                """SELECT id, stage_key, seq, content, submitter_id, submitter_name, created_at
                   FROM qi_progress_item WHERE request_id = %s ORDER BY created_at""",
                (req_id,),
            ).fetchall()
            progress_items = [{
                "id": p["id"], "stage_key": p["stage_key"], "seq": p["seq"],
                "content": p["content"], "submitter_id": p["submitter_id"],
                "submitter_name": p["submitter_name"],
                "created_at": p["created_at"].isoformat() if p["created_at"] else None,
            } for p in progress]
            # 流转日志
            logs = conn.execute(
                """SELECT id, action, from_stage, to_stage, changed_fields, operator_id, operator_name, comment, created_at
                   FROM qi_flow_log WHERE request_id = %s ORDER BY created_at DESC LIMIT 200""",
                (req_id,),
            ).fetchall()
            log_items = [{
                "id": l["id"], "action": l["action"], "from_stage": l["from_stage"],
                "to_stage": l["to_stage"],
                "changed_fields": dict(l["changed_fields"]) if isinstance(l["changed_fields"], dict) else None,
                "operator_id": l["operator_id"], "operator_name": l["operator_name"],
                "comment": l["comment"],
                "created_at": l["created_at"].isoformat() if l["created_at"] else None,
            } for l in logs]
            # 草稿可提交性：关联工单已到审核关闭或已关闭
            if req.get("current_status") == "draft":
                tno = str(req.get("related_ticket_no") or "").strip()
                if tno:
                    ticket = conn.execute(
                        "SELECT wn.node_key, t.status FROM ticket t"
                        " JOIN workflow_node wn ON wn.id = t.current_node_id"
                        " WHERE t.ticket_no = %s", (tno,)
                    ).fetchone()
                    if ticket and (ticket["node_key"] == "audit_close" or ticket["status"] == "closed"):
                        can_submit_draft = True
    except UndefinedTable:
        raise _schema_error()
    req["current_stage_cn"] = _stage_cn(req["current_stage"])
    return {"request": _serialize_request(req), "stages": stages,
            "progress_items": progress_items, "logs": log_items,
            "can_submit_draft": can_submit_draft}


def _latest_analysis_values(conn: psycopg.Connection, request_id: int) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT sd.values_json
        FROM qi_stage_data sd
        JOIN qi_stage s ON s.id = sd.stage_id
        WHERE sd.request_id = %s AND sd.stage_key = 'analysis' AND sd.draft = FALSE
        ORDER BY sd.created_at DESC LIMIT 1
        """,
        (request_id,),
    ).fetchone()
    raw = row["values_json"] if row else None
    return dict(raw) if isinstance(raw, dict) else (json.loads(raw) if raw else {})


def _serialize_request(req: dict) -> dict:
    out = dict(req)
    for k in ("created_at", "updated_at"):
        if out.get(k) and isinstance(out[k], datetime):
            out[k] = out[k].isoformat()
    if "id" in out:
        out["id"] = int(out["id"])
    return out


# ====================================================================
# 小鲁班消息通知辅助
# ====================================================================

def _qi_current_handler_display(conn, req_id: int, stage_key: str, req: dict) -> str:
    """获取某阶段的当前处理人（display name），与列表 current_handler 逻辑一致。"""
    if stage_key == "propose":
        return str(req.get("proposer") or "")
    if stage_key == "review":
        return str(req.get("reviewer") or "")
    if stage_key in ("analysis", "closure", "acceptance"):
        row = conn.execute(
            "SELECT responsible FROM qi_stage WHERE request_id=%s AND responsible<>'' ORDER BY id DESC LIMIT 1",
            (req_id,),
        ).fetchone()
        if row and row["responsible"]:
            return str(row["responsible"])
        return str(req.get("proposer") or "")
    return ""


def _notify_qi_handler(conn, req_id: int, stage_key: str, previous_handler_display: str, override_handler: str = ""):
    """发送小鲁班消息通知下一步处理人（失败不影响流转）。"""
    try:
        from xiaoluban_message import send_qi_notification
        req = get_request_dict(conn, req_id)
        if not req:
            return
        handler = override_handler or _qi_current_handler_display(conn, req_id, stage_key, req)
        if not handler:
            return
        stage_cn = QI_STAGE_NAMES_CN.get(stage_key, stage_key)
        send_qi_notification(req, handler, previous_handler_display, stage_cn)
    except Exception:
        pass


# ====================================================================
# 阶段流转提交
# ====================================================================
@router.post("/{req_id:int}/submit")
def submit_qi(req_id: int, payload: QiSubmitPayload) -> dict:
    op = str(payload.operator_id or "").strip()
    stage_key = str(payload.stage_key or "").strip()
    handle_mode = str(payload.handle_mode or "").strip()
    values = payload.values or {}
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if stage_key not in QI_STAGE_KEYS:
        raise HTTPException(status_code=400, detail="无效阶段")
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            if req["current_status"] == "closed":
                raise HTTPException(status_code=400, detail="已关闭的质量改进单不可操作")
            if req["current_status"] == "draft" and stage_key == "propose":
                if payload.batch:
                    pass  # 工单闭环批量提交：始终允许
                else:
                    tno = str(req.get("related_ticket_no") or "").strip()
                    if not tno:
                        raise HTTPException(status_code=400, detail="草稿无关联工单，无法提交")
                    ticket = conn.execute(
                        "SELECT wn.node_key, t.status FROM ticket t"
                        " JOIN workflow_node wn ON wn.id = t.current_node_id"
                        " WHERE t.ticket_no = %s", (tno,)
                    ).fetchone()
                    if not ticket:
                        raise HTTPException(status_code=400, detail=f"关联运维系统单号不存在：{tno}")
                    if ticket["node_key"] != "audit_close" and ticket["status"] != "closed":
                        raise HTTPException(status_code=400,
                            detail="关联工单尚未走到审核关闭/关闭状态，草稿不可提交")
            if req["current_stage"] != stage_key:
                raise HTTPException(status_code=400, detail=f"当前阶段为 {req['current_stage']}，与提交阶段 {stage_key} 不符")
            # 提交人必须是当前阶段的处理人
            _verify_current_handler(conn, req_id, stage_key, op, values)
            operator_disp = _display_name_account(conn, op)
            reject = is_reject_handle(handle_mode)
            # 校验：打回也需校验对应字段（不通过理由/不接纳理由/验收结论等）
            validate_stage_values(stage_key, values)
            # propose 阶段：关联运维系统单号存在性校验
            if stage_key == "propose":
                tno = str(values.get("related_ticket_no") or req.get("related_ticket_no", "")).strip()
                if tno:
                    t_exists = conn.execute("SELECT 1 FROM ticket WHERE ticket_no = %s", (tno,)).fetchone()
                    if not t_exists:
                        raise HTTPException(status_code=400, detail=f"关联运维系统单号不存在：{tno}")
            # person 字段存在性校验：值格式「姓名 账号」，账号必须在 user_account 存在
            for pf in QI_STAGE_FIELDS.get(stage_key, []):
                if pf.get("type") != "person":
                    continue
                pv = str(values.get(pf["key"]) or "").strip()
                if not pv:
                    continue
                account = pv.split()[-1] if " " in pv else pv
                exists = conn.execute(
                    "SELECT 1 FROM user_account WHERE account = %s", (account,)
                ).fetchone()
                if not exists:
                    raise HTTPException(status_code=400, detail=f"{pf['label']} 不是系统用户：{account}")
                wl_table = _PERSON_WHITELIST_TABLE.get(pf["key"])
                if wl_table:
                    wl_ok = conn.execute(
                        f"SELECT 1 FROM {wl_table} WHERE account = %s", (account,)
                    ).fetchone()
                    if not wl_ok:
                        raise HTTPException(status_code=400, detail=f"{pf['label']} 不在白名单中：{account}")
            # 闭环阶段：闭环单号校验
            if stage_key == "closure" and str(values.get("closure_method", "")).strip():
                from qi_flow import _validate_closure_ticket_no
                _validate_closure_ticket_no(conn, str(values.get("closure_method", "")), str(values.get("closure_ticket_no", "")))

            next_stage = resolve_next_stage(stage_key, handle_mode)
            # 关闭当前阶段实例
            st = get_active_stage(conn, req_id, stage_key)
            conn.execute(
                "UPDATE qi_stage SET status=%s, completed_at=NOW() WHERE id=%s",
                ("rejected" if reject else "completed", st["id"]),
            )
            # 落库当前阶段数据
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
                   VALUES (%s,%s,%s,%s::jsonb,FALSE,%s)""",
                (st["id"], req_id, stage_key, json.dumps(values, ensure_ascii=False), op),
            )
            # propose 阶段：同步主表字段（打回重提/草稿激活时落回 qi_request）
            if stage_key == "propose":
                upd = propose_values_to_request(values)
                # 草稿激活：替换临时占位编号为正式 QI 编号
                current_no = str(req.get("qi_no", "")).strip()
                if not current_no or current_no.startswith("DRAFT-"):
                    qi_no = allocate_qi_no(conn)
                    upd["qi_no"] = qi_no
                if upd:
                    sets = ", ".join(f"{k}=%s" for k in upd)
                    conn.execute(
                        f"UPDATE qi_request SET {sets}, updated_at=NOW() WHERE id=%s",
                        tuple(upd.values()) + (req_id,),
                    )
            action = "rejected" if reject else "submitted"
            # 更新主单状态
            if next_stage == "__closed__":
                conn.execute(
                    "UPDATE qi_request SET current_status='closed', updated_at=NOW() WHERE id=%s",
                    (req_id,),
                )
                conn.execute(
                    """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment)
                       VALUES (%s,'closed',%s,'',%s,%s,%s)""",
                    (req_id, stage_key, op, operator_disp, payload.comment),
                )
            elif reject:
                conn.execute(
                    "UPDATE qi_request SET current_stage=%s, current_status='in_progress', updated_at=NOW() WHERE id=%s",
                    (next_stage, req_id),
                )
                # 打回目标阶段 sequence+1；责任人从最近一次继承（避免打回后处理人丢失）
                responsible = ""
                if next_stage in ("analysis", "closure"):
                    responsible = _latest_responsible(conn, req_id)
                conn.execute(
                    """INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible)
                       SELECT %s, %s, COALESCE(MAX(sequence),0)+1, 'pending', %s
                       FROM qi_stage WHERE request_id=%s AND stage_key=%s""",
                    (req_id, next_stage, responsible, req_id, next_stage),
                )
                conn.execute(
                    """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment)
                       VALUES (%s,'rejected',%s,%s,%s,%s,%s)""",
                    (req_id, stage_key, next_stage, op, operator_disp, payload.comment),
                )
            else:
                # 正向流转：创建下一阶段实例（pending），责任人继承，sequence 递增
                responsible = ""
                if next_stage in ("analysis", "closure"):
                    responsible = _latest_responsible(conn, req_id)
                conn.execute(
                    """INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible)
                       SELECT %s, %s, COALESCE(MAX(sequence),0)+1, 'pending', %s
                       FROM qi_stage WHERE request_id=%s AND stage_key=%s""",
                    (req_id, next_stage, responsible, req_id, next_stage),
                )
                conn.execute(
                    "UPDATE qi_request SET current_stage=%s, current_status='in_progress', updated_at=NOW() WHERE id=%s",
                    (next_stage, req_id),
                )
                conn.execute(
                    """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment)
                       VALUES (%s,'submitted',%s,%s,%s,%s,%s)""",
                    (req_id, stage_key, next_stage, op, operator_disp, payload.comment),
                )
            conn.commit()
            audit_log("qi.submit", id=req_id, **{"from": stage_key, "to": next_stage, "op": op})
            # 小鲁班消息通知下一步处理人（关闭/打回也通知）
            if next_stage != "__closed__":
                _notify_qi_handler(conn, req_id, next_stage, operator_disp)
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True, "current_stage": next_stage if next_stage != "__closed__" else stage_key,
            "current_status": "closed" if next_stage == "__closed__" else "in_progress"}


# ====================================================================
# 阶段草稿保存（不流转，跳过必填）
# ====================================================================
@router.post("/{req_id:int}/save")
def save_qi(req_id: int, payload: QiSavePayload) -> dict:
    op = str(payload.operator_id or "").strip()
    stage_key = str(payload.stage_key or "").strip()
    values = payload.values or {}
    if stage_key not in QI_STAGE_KEYS:
        raise HTTPException(status_code=400, detail="无效阶段")
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            if req["current_status"] == "closed":
                raise HTTPException(status_code=400, detail="已关闭的质量改进单不可操作")
            _verify_current_handler(conn, req_id, stage_key, op, values)
            # 提出阶段草稿同步主表字段
            if stage_key == "propose":
                tno = str(values.get("related_ticket_no") or req.get("related_ticket_no", "")).strip()
                if tno:
                    t_exists = conn.execute("SELECT 1 FROM ticket WHERE ticket_no = %s", (tno,)).fetchone()
                    if not t_exists:
                        raise HTTPException(status_code=400, detail=f"关联运维系统单号不存在：{tno}")
                upd = {k: v for k, v in propose_values_to_request(values).items()}
                if upd:
                    sets = ", ".join(f"{k}=%s" for k in upd)
                    conn.execute(
                        f"UPDATE qi_request SET {sets}, updated_at=NOW() WHERE id=%s",
                        tuple(upd.values()) + (req_id,),
                    )
            st = get_active_stage(conn, req_id, stage_key)
            if not st:
                raise HTTPException(status_code=400, detail=f"阶段 {stage_key} 尚未进入，无法保存草稿")
            # 修订(阶段≠当前阶段)：存为非草稿(amended=TRUE)，否则详情读 draft ASC 时会优先取原提交行、忽略修订
            is_amend = stage_key != req["current_stage"]
            conn.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, amended, created_by)
                   VALUES (%s,%s,%s,%s::jsonb,%s,%s,%s)""",
                (st["id"], req_id, stage_key, json.dumps(values, ensure_ascii=False),
                 not is_amend, is_amend, op),
            )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True, "saved": True, "stage": stage_key}


# ====================================================================
# 编辑提出阶段主表字段（评审完成前可改）
# ====================================================================
@router.patch("/{req_id:int}")
def patch_qi(req_id: int, payload: QiPatchPayload) -> dict:
    op = str(payload.operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            # 仅提出阶段（评审完成前）可编辑主表
            if req["current_stage"] not in ("propose", "review"):
                raise HTTPException(status_code=400, detail="评审完成后不可编辑提出信息")
            if str(req["creator_id"]).strip() != op:
                raise HTTPException(status_code=403, detail="仅提出人可编辑")
            updates: dict[str, str] = {}
            changed: dict[str, list] = {}
            field_map = {
                "category": (payload.category, QI_CATEGORIES),
                "priority": (payload.priority, ("高", "中", "低")),
                "title": (payload.title, None),
                "related_ticket_no": (payload.related_ticket_no, None),
                "description": (payload.description, None),
                "expected_goal": (payload.expected_goal, None),
                "domain": (payload.domain, None),
                "module_feature": (payload.module_feature, None),
                "planned_version": (payload.planned_version, None),
                "reviewer": (payload.reviewer, None),
            }
            for k, (val, allowed) in field_map.items():
                if val is None:
                    continue
                nv = str(val).strip()
                if allowed and nv and nv not in allowed:
                    raise HTTPException(status_code=400, detail=f"{k} 取值非法：{nv}")
                ov = str(req.get(k, "") or "").strip()
                if nv != ov:
                    updates[k] = nv
                    changed[k] = [ov, nv]
            if not updates:
                return {"ok": True, "updated": False}
            # 关联运维系统单号存在性校验
            if "related_ticket_no" in updates:
                _validate_ticket_no_exists(updates["related_ticket_no"])
            sets = ", ".join(f"{k}=%s" for k in updates) + ", updated_at=NOW()"
            conn.execute(f"UPDATE qi_request SET {sets} WHERE id=%s", tuple(updates.values()) + (req_id,))
            operator_disp = _display_name_account(conn, op)
            conn.execute(
                """INSERT INTO qi_flow_log (request_id, action, changed_fields, operator_id, operator_name, comment)
                   VALUES (%s,'updated',%s::jsonb,%s,%s,'')""",
                (req_id, json.dumps(changed, ensure_ascii=False), op, operator_disp),
            )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True, "updated": True}


# ====================================================================
# 删除（仅创建人，仅 draft/初始状态）
# ====================================================================
@router.delete("/{req_id:int}")
def delete_qi(req_id: int, operator_id: str = "demo_001") -> dict:
    op = str(operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            if str(req["creator_id"]).strip() != op:
                raise HTTPException(status_code=403, detail="仅提出人可删除")
            # 仅提出阶段可删除（已提交评审后不可删）
            if req["current_stage"] != "propose":
                raise HTTPException(status_code=400, detail="已提交评审，不可删除")
            conn.execute("DELETE FROM qi_request WHERE id=%s", (req_id,))
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"deleted": req_id}


# ====================================================================
# 转单（全阶段）
# ====================================================================
@router.post("/{req_id:int}/transfer")
def transfer_qi(req_id: int, payload: QiTransferPayload) -> dict:
    """当前处理人将单子转给其他人。不改阶段/状态，仅更新处理人 + 日志。"""
    op = str(payload.operator_id or "").strip() or "demo_001"
    transfer_to = str(payload.transfer_to or "").strip()
    if not transfer_to:
        raise HTTPException(status_code=400, detail="transfer_to 不能为空")
    # 解析工号
    to_account = transfer_to.split()[-1].strip() if " " in transfer_to else transfer_to.strip()
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            if req["current_status"] == "closed":
                raise HTTPException(status_code=400, detail="已关闭的质量改进单不可操作")
            stage = str(req["current_stage"])
            # 仅当前处理人可转
            _verify_current_handler(conn, req_id, stage, op)
            # 校验目标人：user_account 存在 + 活跃
            ua = conn.execute(
                "SELECT account, user_name FROM user_account WHERE LOWER(account) = LOWER(%s) AND is_active = TRUE",
                (to_account,),
            ).fetchone()
            if not ua:
                raise HTTPException(status_code=400, detail=f"转单目标人不是有效用户：{to_account}")
            to_disp = f"{ua['user_name']} {ua['account']}"
            # 白名单校验：review → reviewer 候选，analysis/closure → analyst 候选，propose/acceptance 无白名单
            wl_table = _PERSON_WHITELIST_TABLE.get({
                "review": "reviewer",
                "analysis": "responsible",
                "closure": "responsible",
            }.get(stage, ""), "")
            if wl_table:
                in_wl = conn.execute(
                    f"SELECT 1 FROM {wl_table} WHERE account = %s", (ua["account"],)
                ).fetchone()
                if not in_wl:
                    raise HTTPException(status_code=403, detail=f"转单目标人不在{('评审人' if stage == 'review' else '分析人')}白名单中：{to_disp}")
            # 取旧处理人（用于日志）
            if stage in ("analysis", "closure"):
                old_row = conn.execute(
                    "SELECT responsible FROM qi_stage WHERE request_id=%s AND responsible<>'' ORDER BY id DESC LIMIT 1",
                    (req_id,),
                ).fetchone()
                old_handler = str(old_row["responsible"] if old_row else "")
            elif stage == "review":
                old_handler = str(req.get("reviewer") or "")
            elif stage == "acceptance":
                old_resp = conn.execute(
                    "SELECT responsible FROM qi_stage WHERE request_id=%s AND stage_key='acceptance' AND responsible<>'' ORDER BY id DESC LIMIT 1",
                    (req_id,),
                ).fetchone()
                old_handler = str((old_resp["responsible"] if old_resp else "") or "") or str(req.get("proposer") or "")
            else:
                old_handler = str(req.get("proposer") or "")
            # 更新处理人
            if stage == "acceptance":
                # 验收阶段转单写入 qi_stage.responsible，不改 proposer（提出人不变）
                conn.execute(
                    "UPDATE qi_stage SET responsible=%s WHERE id=(SELECT id FROM qi_stage WHERE request_id=%s AND stage_key='acceptance' ORDER BY id DESC LIMIT 1)",
                    (to_disp, req_id),
                )
            elif stage == "propose":
                conn.execute(
                    "UPDATE qi_request SET proposer=%s, updated_at=NOW() WHERE id=%s",
                    (to_disp, req_id),
                )
            elif stage == "review":
                conn.execute(
                    "UPDATE qi_request SET reviewer=%s, updated_at=NOW() WHERE id=%s",
                    (to_disp, req_id),
                )
            else:  # analysis / closure
                conn.execute(
                    "UPDATE qi_stage SET responsible=%s WHERE id=(SELECT id FROM qi_stage WHERE request_id=%s ORDER BY id DESC LIMIT 1)",
                    (to_disp, req_id),
                )
                # 同步 stage_data values_json
                sd = conn.execute(
                    "SELECT id, values_json FROM qi_stage_data WHERE request_id=%s AND stage_key=%s AND draft=FALSE ORDER BY created_at DESC LIMIT 1",
                    (req_id, stage),
                ).fetchone()
                if sd:
                    conn.execute(
                        "UPDATE qi_stage_data SET values_json = values_json || %s::jsonb WHERE id=%s",
                        (json.dumps({"responsible": to_disp}, ensure_ascii=False), sd["id"]),
                    )
            # 日志
            op_disp = _display_name_account(conn, op)
            conn.execute(
                """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment, changed_fields)
                   VALUES (%s, 'transferred', %s, %s, %s, %s, %s, %s)""",
                (req_id, stage, stage, op, op_disp,
                 f"转单：{old_handler or '(无)'} → {to_disp}",
                 json.dumps({"handler": [old_handler, to_disp]}, ensure_ascii=False)),
            )
            conn.commit()
            audit_log("qi.transferred", req_id=req_id, stage=stage, operator=op, to=to_account)
            # 小鲁班消息通知转单目标人
            _notify_qi_handler(conn, req_id, stage, op_disp, override_handler=to_disp)
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True, "stage": stage, "new_handler": to_disp}


# ====================================================================
# 流转日志
# ====================================================================
@router.get("/{req_id:int}/logs")
def get_qi_logs(req_id: int, operator_id: str = "demo_001") -> dict:
    op = str(operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_view(conn, op)
            logs = conn.execute(
                """SELECT id, action, from_stage, to_stage, changed_fields, operator_id, operator_name, comment, created_at
                   FROM qi_flow_log WHERE request_id=%s ORDER BY created_at DESC LIMIT 500""",
                (req_id,),
            ).fetchall()
    except UndefinedTable:
        raise _schema_error()
    items = [{
        "id": l["id"], "action": l["action"], "from_stage": l["from_stage"],
        "to_stage": l["to_stage"],
        "changed_fields": dict(l["changed_fields"]) if isinstance(l["changed_fields"], dict) else None,
        "operator_id": l["operator_id"], "operator_name": l["operator_name"],
        "comment": l["comment"],
        "created_at": l["created_at"].isoformat() if l["created_at"] else None,
    } for l in logs]
    return {"items": items}


# ====================================================================
# 进展子项 CRUD（仅 analysis/closure）
# ====================================================================
@router.post("/{req_id:int}/progress-items")
def add_progress_item(req_id: int, payload: QiProgressItemPayload) -> dict:
    op = str(payload.operator_id or "").strip()
    content = str(payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="进展说明不能为空")
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            req = get_request_dict(conn, req_id)
            if not req:
                raise HTTPException(status_code=404, detail="质量改进单不存在")
            if req["current_stage"] not in QI_PROGRESS_STAGES:
                raise HTTPException(status_code=400, detail="当前阶段不支持进展子项")
            st = get_active_stage(conn, req_id, req["current_stage"])
            seq_row = conn.execute(
                "SELECT COALESCE(MAX(seq),0)+1 AS next_seq FROM qi_progress_item WHERE stage_id=%s",
                (st["id"],),
            ).fetchone()
            seq = int(seq_row["next_seq"])
            submitter_disp = _display_name_account(conn, op)
            row = conn.execute(
                """INSERT INTO qi_progress_item (request_id, stage_id, stage_key, seq, content, submitter_id, submitter_name)
                   VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (req_id, st["id"], req["current_stage"], seq, content, op, submitter_disp),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"id": int(row["id"]), "seq": seq}


@router.patch("/{req_id:int}/progress-items/{item_id:int}")
def update_progress_item(req_id: int, item_id: int, payload: QiProgressItemPayload) -> dict:
    op = str(payload.operator_id or "").strip()
    content = str(payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="进展说明不能为空")
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            row = conn.execute(
                "SELECT stage_id FROM qi_progress_item WHERE id=%s AND request_id=%s",
                (item_id, req_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="进展子项不存在")
            conn.execute(
                "UPDATE qi_progress_item SET content=%s WHERE id=%s",
                (content, item_id),
            )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True}


# ====================================================================
# 阶段超期配置
# ====================================================================
def _load_stage_sla(_conn=None) -> dict[str, int]:
    """从 DB 读阶段超期配置（propose/review/acceptance）；analysis/closure 无 SLA。
    独立连接，避免与调用方的查询连接冲突。"""
    try:
        with db_conn() as c:
            rows = c.execute("SELECT stage_key, sla_hours FROM qi_stage_sla_config").fetchall()
            return {str(r["stage_key"]): int(r["sla_hours"]) for r in rows}
    except UndefinedTable:
        from qi_config import QI_STAGE_SLA_HOURS
        return dict(QI_STAGE_SLA_HOURS)


def _compute_overdue(sla_map, current_stage, current_status, started_at, sla_time_str):
    """统一超期计算：closure 用用户填 sla_time；其余可配阶段用 started_at + sla_hours；草稿/关闭/analysis 不超期。
    sla_map 由调用方预先加载（避免循环内重复查 DB）。"""
    if current_status in ("draft", "closed"):
        return False
    if current_stage == "analysis":
        return False
    now = datetime.now(timezone.utc)
    if current_stage == "closure":
        sla = str(sla_time_str or "").strip()
        if not sla:
            return False
        try:
            sla_dt = datetime.strptime(sla[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            return now > sla_dt
        except ValueError:
            return False
    # 可配阶段：started_at + sla_hours
    hours = sla_map.get(current_stage, 0) if sla_map else 0
    if not hours or not started_at:
        return False
    try:
        started = started_at if started_at.tzinfo else started_at.replace(tzinfo=timezone.utc)
        elapsed_hours = (now - started).total_seconds() / 3600
        return elapsed_hours > hours
    except Exception:
        return False


@router.get("/config/stage-sla")
def get_stage_sla_config(operator_id: str = "demo_001") -> dict:
    """返回各阶段超期配置（propose/review/acceptance 小时数）。"""
    try:
        with db_conn() as conn:
            sla_map = _load_stage_sla(conn)
    except UndefinedTable:
        sla_map = {}
    return {"stage_sla": sla_map}


@router.post("/config/stage-sla")
def set_stage_sla_config(payload: dict) -> dict:
    """接收 {stage_sla: {propose: 24, review: 48, acceptance: 48}}，全量更新。"""
    stage_sla = payload.get("stage_sla") or {}
    try:
        with db_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS qi_stage_sla_config (
                    stage_key  VARCHAR(16) PRIMARY KEY,
                    sla_hours  INT NOT NULL DEFAULT 0
                )
            """)
            conn.execute("DELETE FROM qi_stage_sla_config")
            for sk, hrs in stage_sla.items():
                sk_str = str(sk).strip()
                if sk_str:
                    try:
                        hrs_int = int(hrs)
                    except (ValueError, TypeError):
                        continue
                    conn.execute(
                        "INSERT INTO qi_stage_sla_config (stage_key, sla_hours) VALUES (%s,%s) ON CONFLICT (stage_key) DO UPDATE SET sla_hours=%s",
                        (sk_str, hrs_int, hrs_int),
                    )
            conn.commit()
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True}

@router.delete("/{req_id:int}/progress-items/{item_id:int}")
def delete_progress_item(req_id: int, item_id: int, operator_id: str = "demo_001") -> dict:
    op = str(operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_edit(conn, op)
            row = conn.execute(
                "SELECT submitter_id FROM qi_progress_item WHERE id=%s AND request_id=%s",
                (item_id, req_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="进展子项不存在")
            conn.execute("DELETE FROM qi_progress_item WHERE id=%s", (item_id,))
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable:
        raise _schema_error()
    return {"deleted": item_id}


# ====================================================================
# 分析看板
# ====================================================================
@router.get("/analytics")
def qi_analytics(
    operator_id: str = "demo_001",
    start_date: str = "",
    end_date: str = "",
    stages: str = "",
) -> dict:
    """质量改进分析看板：阶段分布 / 阶段耗时 / 耗时Top / 转化漏斗 / 超时统计。"""
    from qi_config import QI_STAGE_SLA_HOURS
    op = str(operator_id or "").strip() or "demo_001"
    today = datetime.now().date()
    # 默认不做时间过滤（全量统计）；仅当前端显式传日期时才加窗口
    ed = _parse_ymd(end_date) if end_date else _parse_ymd("2099-12-31")
    sd = _parse_ymd(start_date) if start_date else _parse_ymd("2000-01-01")
    if sd > ed:
        sd, ed = ed, sd
    start_dt = datetime(sd.year, sd.month, sd.day, tzinfo=timezone.utc)
    end_dt = datetime(ed.year, ed.month, ed.day, tzinfo=timezone.utc) + timedelta(days=1)
    try:
        with db_conn() as conn:
            _require_view(conn, op)
            win = "created_at >= %s AND created_at < %s"
            # 阶段多选筛选（仅作用于 领域/模块/用户 维度，不影响 KPI/阶段分布/耗时Top）
            stages_param = [s.strip() for s in str(stages or "").split(",") if s.strip()]
            stages_param = [s for s in stages_param if s in QI_STAGE_KEYS]
            stage_clause = " AND current_stage = ANY(%s)" if stages_param else ""
            r_stage_clause = " AND r.current_stage = ANY(%s)" if stages_param else ""
            swin_params = (start_dt, end_dt, stages_param) if stages_param else (start_dt, end_dt)
            total = int(conn.execute(
                f"SELECT COUNT(*) AS cnt FROM qi_request WHERE {win}", (start_dt, end_dt)
            ).fetchone()["cnt"] or 0)
            # 阶段分布（当前所在阶段）
            stage_rows = conn.execute(
                f"SELECT current_stage AS k, COUNT(*) AS c FROM qi_request WHERE {win} GROUP BY current_stage",
                (start_dt, end_dt),
            ).fetchall()
            stage_map = {str(r["k"]): int(r["c"]) for r in stage_rows}
            # 超时统计：用统一的 _compute_overdue 逻辑
            overtime = 0
            in_progress = 0
            stuck_rows = conn.execute(
                f"""SELECT r.id, r.current_stage, s.started_at,
                           clsd.sla_time
                    FROM qi_request r
                    JOIN qi_stage s ON s.request_id = r.id AND s.stage_key = r.current_stage
                    LEFT JOIN LATERAL (
                      SELECT sd2.values_json->>'sla_time' AS sla_time
                      FROM qi_stage_data sd2
                      JOIN qi_stage s2 ON s2.id = sd2.stage_id
                      WHERE sd2.request_id = r.id AND sd2.stage_key = 'closure'
                      ORDER BY sd2.draft ASC, sd2.created_at DESC LIMIT 1
                    ) clsd ON TRUE
                    WHERE r.current_status = 'in_progress' AND {win.replace('created_at', 'r.created_at')}""",
                (start_dt, end_dt),
            ).fetchall()
            _sla_map = _load_stage_sla(conn)
            for r in stuck_rows:
                in_progress += 1
                sla_time = str(r["sla_time"] or "") if r.get("sla_time") else ""
                if _compute_overdue(_sla_map, r["current_stage"], "in_progress", r["started_at"], sla_time):
                    overtime += 1
            # 改进类型分布
            cat_values = []
            for cat in QI_CATEGORIES:
                c = conn.execute(f"SELECT COUNT(*) AS cnt FROM qi_request WHERE category=%s AND {win}", (cat, start_dt, end_dt)).fetchone()["cnt"]
                cat_values.append(int(c or 0))
            # 领域分布
            domain_rows = conn.execute(
                f"""SELECT COALESCE(NULLIF(domain,''),'未分类') AS k, COUNT(*) AS c
                    FROM qi_request WHERE {win}{stage_clause} GROUP BY COALESCE(NULLIF(domain,''),'未分类') ORDER BY c DESC""",
                swin_params,
            ).fetchall()
            domain_labels = [str(r["k"]) for r in domain_rows]
            domain_values = [int(r["c"]) for r in domain_rows]
            # 模块&特性分布
            module_rows = conn.execute(
                f"""SELECT COALESCE(NULLIF(module_feature,''),'未分类') AS k, COUNT(*) AS c
                    FROM qi_request WHERE {win}{stage_clause} GROUP BY COALESCE(NULLIF(module_feature,''),'未分类') ORDER BY c DESC LIMIT 15""",
                swin_params,
            ).fetchall()
            module_labels = [str(r["k"]) for r in module_rows]
            module_values = [int(r["c"]) for r in module_rows]
            # 领域×模块 分布（供「模块&特性」按领域筛选）
            domain_module_rows = conn.execute(
                f"""SELECT COALESCE(NULLIF(domain,''),'未分类') AS d,
                           COALESCE(NULLIF(module_feature,''),'未分类') AS m,
                           COUNT(*) AS c
                    FROM qi_request WHERE {win}{stage_clause}
                    GROUP BY d, m ORDER BY c DESC""",
                swin_params,
            ).fetchall()
            # 领域×用户 矩阵（提交数）
            r2w = win.replace("created_at", "r.created_at")
            user_domain_rows = conn.execute(
                f"""SELECT COALESCE(NULLIF(r.domain,''),'未分类') AS d,
                           COALESCE(NULLIF(SPLIT_PART(r.proposer,' ',1),''), '未知') AS u,
                           COUNT(*) AS c
                    FROM qi_request r WHERE {r2w}{r_stage_clause}
                    GROUP BY d, u ORDER BY d, c DESC""",
                swin_params,
            ).fetchall()
            # 领域×用户 矩阵（接纳数：analysis 阶段 accept=是）
            user_accept_rows = conn.execute(
                f"""SELECT COALESCE(NULLIF(r.domain,''),'未分类') AS d,
                           COALESCE(NULLIF(SPLIT_PART(r.proposer,' ',1),''), '未知') AS u,
                           COUNT(*) AS c
                    FROM qi_request r
                    WHERE {r2w}{r_stage_clause} AND EXISTS (
                        SELECT 1 FROM qi_stage_data sd
                        JOIN qi_stage s ON s.id = sd.stage_id
                        WHERE sd.request_id = r.id AND sd.stage_key = 'analysis'
                          AND sd.draft = FALSE
                          AND sd.values_json->>'accept' = '是'
                    )
                    GROUP BY d, u ORDER BY d, c DESC""",
                swin_params,
            ).fetchall()
    except UndefinedTable:
        raise _schema_error()
    return {
        "kpi": {"total": total, "in_progress": in_progress, "overtime": overtime},
        "stage_distribution": {"labels": [_stage_cn(s) for s in QI_STAGE_KEYS],
                               "values": [stage_map.get(s, 0) for s in QI_STAGE_KEYS]},
        "category_distribution": {"labels": list(QI_CATEGORIES),
                                  "values": cat_values},
        "overtime_rate": round(overtime / in_progress * 100, 1) if in_progress else 0,
        "domain_distribution": {"labels": domain_labels, "values": domain_values},
        "module_distribution": {"labels": module_labels, "values": module_values},
        "domain_module_distribution": [{"domain": str(r["d"]), "module": str(r["m"]), "count": int(r["c"])} for r in domain_module_rows],
        "user_domain_submission": [{"domain": str(r["d"]), "user": str(r["u"]), "count": int(r["c"])} for r in user_domain_rows],
        "user_domain_acceptance": [{"domain": str(r["d"]), "user": str(r["u"]), "count": int(r["c"])} for r in user_accept_rows],
    }


def _parse_ymd(s: str):
    from datetime import date as _date
    try:
        return datetime.strptime(str(s).strip()[:10], "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        return None


# ====================================================================
# 导入导出（Excel）
# ====================================================================
_QI_IMPORT_COLUMNS: list[tuple[str, str]] = [
    ("诉求编号", "qi_no"), ("分类", "category"), ("诉求标题", "title"),
    ("关联运维单号", "related_ticket_no"), ("提出人", "proposer"),
    ("所属领域", "domain"), ("模块&特性", "module_feature"),
    ("诉求描述", "description"), ("改进诉求", "expected_goal"),
    ("优先级", "priority"), ("计划版本", "planned_version"), ("评审人", "reviewer"),
]


def _excel_header(ws, headers):
    f = Font(bold=True)
    a = Alignment(horizontal="center", vertical="center")
    b = Border(left=Side(style="thin"), right=Side(style="thin"),
               top=Side(style="thin"), bottom=Side(style="thin"))
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font, c.alignment, c.border = f, a, b
    return b


@router.post("/export")
def export_qi(payload: QiExportPayload) -> StreamingResponse:
    op = str(payload.operator_id or "").strip() or "demo_001"
    cols = ", ".join(f for _, f in _QI_IMPORT_COLUMNS)
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_export") == "hidden":
                raise HTTPException(status_code=403, detail="无导出权限")
            rows = conn.execute(
                f"""SELECT {cols} FROM qi_request
                    ORDER BY CASE priority WHEN '高' THEN 1 WHEN '中' THEN 2 WHEN '低' THEN 3 ELSE 9 END,
                             created_at DESC"""
            ).fetchall()
    except UndefinedTable:
        raise _schema_error()
    wb = Workbook()
    ws = wb.active
    ws.title = "质量改进导出"
    headers = [n for n, _ in _QI_IMPORT_COLUMNS]
    border = _excel_header(ws, headers)
    for ri, row in enumerate(rows, start=2):
        for ci, (_, f) in enumerate(_QI_IMPORT_COLUMNS, start=1):
            c = ws.cell(row=ri, column=ci, value=str(row[f] or ""))
            c.border = border
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    today = datetime.now().strftime("%Y-%m-%d")
    fn = f"qi_export_{op}_{today}.xlsx"
    enc = urllib.parse.quote(f"质量改进导出_{op}_{today}.xlsx", safe="")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{fn}\"; filename*=UTF-8''{enc}"},
    )


@router.get("/import-template")
def qi_import_template(operator_id: str = "demo_001") -> StreamingResponse:
    op = str(operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_import") == "hidden":
                raise HTTPException(status_code=403, detail="无导入权限")
    except UndefinedTable:
        raise _schema_error()
    wb = Workbook()
    ws = wb.active
    ws.title = "质量改进导入模板"
    headers = [n for n, _ in _QI_IMPORT_COLUMNS]
    border = _excel_header(ws, headers)
    example = ["", "质量加固和改进", "磁盘满改进", "YW20260627001", "张三 zhangsan",
               "存储引擎", "空间管理", "回收站未回收", "增加自动回收", "高", "V8.2.0", "李四 lisi"]
    for ci, v in enumerate(example, start=1):
        c = ws.cell(row=2, column=ci, value=v)
        c.border = border
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    enc = urllib.parse.quote("质量改进导入模板.xlsx", safe="")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"qi_template.xlsx\"; filename*=UTF-8''{enc}"},
    )


@router.post("/import")
async def import_qi(file: UploadFile = File(...), operator_id: str = Form(...)) -> dict:
    """批量导入质量改进。诉求编号为空=新增；填已有编号=更新提出阶段字段。"""
    op = str(operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_import") == "hidden":
                raise HTTPException(status_code=403, detail="无导入权限")
    except UndefinedTable:
        raise _schema_error()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式文件")
    content = await file.read()
    try:
        wb = load_workbook(BytesIO(content))
        ws = wb.active
        headers: dict[str, int] = {}
        for col in range(1, ws.max_column + 1):
            v = ws.cell(row=1, column=col).value
            if v:
                headers[str(v).strip()] = col
        expected = [n for n, _ in _QI_IMPORT_COLUMNS]
        for h in expected:
            if h not in headers:
                raise HTTPException(status_code=400, detail=f"缺少必填列：{h}")
        rows = []
        for ri in range(2, ws.max_row + 1):
            rd = {h: ws.cell(row=ri, column=c).value for h, c in headers.items()}
            if not str(rd.get("改进诉求", "")).strip():
                continue
            rd["_row"] = ri
            rows.append(rd)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件无法解析：{e}")
    if not rows:
        return {"success": True, "total": 0, "created": 0, "updated": 0, "message": "导入0条"}
    created = updated = 0
    try:
        with db_conn() as conn:
            op_disp = _display_name_account(conn, op)
            for rd in rows:
                qi_no = str(rd.get("诉求编号", "")).strip()
                field_vals = {f: str(rd.get(n, "")).strip() for n, f in _QI_IMPORT_COLUMNS}
                if qi_no:
                    ex = conn.execute(
                        "SELECT id FROM qi_request WHERE qi_no=%s", (qi_no,)
                    ).fetchone()
                    if ex:
                        upd = {k: v for k, v in field_vals.items()
                               if k != "qi_no" and v is not None}
                        sets = ", ".join(f"{k}=%s" for k in upd) + ", updated_at=NOW()"
                        conn.execute(f"UPDATE qi_request SET {sets} WHERE id=%s",
                                     tuple(upd.values()) + (ex["id"],))
                        updated += 1
                        continue
                new_no = allocate_qi_no(conn)
                conn.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, title, related_ticket_no, proposer, domain,
                        module_feature, description, expected_goal, priority,
                        planned_version, reviewer, current_stage, current_status,
                        creator_id, creator_name)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'propose','draft',%s,%s)""",
                    (new_no, field_vals.get("category", "") or "质量加固和改进",
                     field_vals.get("title", ""), field_vals.get("related_ticket_no", ""),
                     field_vals.get("proposer", "") or op_disp, field_vals.get("domain", ""),
                     field_vals.get("module_feature", ""), field_vals.get("description", ""),
                     field_vals.get("expected_goal", ""),
                     field_vals.get("priority", "") or "中", field_vals.get("planned_version", ""),
                     field_vals.get("reviewer", ""), op, op_disp),
                )
                created += 1
            conn.commit()
    except UndefinedTable:
        raise _schema_error()
    total = created + updated
    return {"success": True, "total": total, "created": created, "updated": updated,
            "message": f"成功导入{total}条（新增{created}，更新{updated}）"}


# ====================================================================
# 旧 requirement → 新 qi 数据迁移
# ====================================================================
def _clip(v, n: int) -> str:
    """裁剪到 varchar 列上限，避免旧库超长值导致 INSERT 失败。"""
    s = str(v if v is not None else "")
    return s if len(s) <= n else s[:n]


def _qi_priority_coerce(v) -> str:
    """归一化优先级到 qi_request.chk_qi_priority 允许的 {高,中,低}。"""
    return v if str(v).strip() in ("高", "中", "低") else "中"


@router.post("/migrate-legacy")
def migrate_legacy(payload: QiMigrateLegacyPayload) -> dict:
    """将旧 requirement 表数据迁移到 qi_request（方案 B 存量搬迁）。幂等。"""
    op = str(payload.operator_id or "").strip() or "demo_001"
    try:
        with db_conn() as conn:
            # 迁移属于「质量改进配置」页能力，与该页同锁 params_qi_candidates，不再单独隔离到 requirement_create
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "params_qi_candidates") == "hidden":
                raise HTTPException(status_code=403, detail="无质量改进配置权限")
            op_disp = _display_name_account(conn, op)
            legacy = conn.execute(
                "SELECT * FROM requirement ORDER BY id"
            ).fetchall()
            migrated = skipped = 0
            for lr in legacy:
                old_no = str(lr["requirement_no"] or "").strip()
                # 仅迁移 5 个字段：问题描述→title、改进诉求→description、分类、优先级、提出人
                # （reviewer 默认=提出人；关联单号/领域/模块/计划版本等不再迁移，留默认空）
                title = str(lr["description"] or "")  # title 为 TEXT，无需裁剪
                # 提出人=创建人，保持与 creator_name 一致（含工号），避免迁移后身份校验不通过需手动改
                creator_id = _clip(lr["creator_id"] or op, 64)
                creator_name = _clip(lr["creator_name"] or op_disp, 128)
                proposer = creator_name
                # 幂等去重：用与写入一致的 (title, proposer, created_at)
                dup = conn.execute(
                    "SELECT 1 FROM qi_request WHERE title=%s AND proposer=%s AND created_at=%s",
                    (title, proposer, lr["created_at"]),
                ).fetchone()
                if dup and not payload.force:
                    skipped += 1
                    continue
                new_no = allocate_qi_no(conn)
                cat = _clip(lr["category"], 64)
                desc_val = str(lr["improvement"] or "")  # 改进诉求 → description（TEXT）
                priority = _qi_priority_coerce(lr["priority"])
                reviewer = proposer  # 默认评审人=提出人
                # 停在提出阶段（propose），不自动进评审；由用户手动提交评审
                stage, status = "propose", "in_progress"
                conn.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, title, description, expected_goal, priority, proposer, reviewer,
                        current_stage, current_status, creator_id, creator_name, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (new_no, cat, title, desc_val, "", priority, proposer, reviewer,
                     stage, status, creator_id, creator_name, lr["created_at"]),
                )
                # 创建 propose 阶段实例（停在提出阶段，不建 review）
                req_row = conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (new_no,)).fetchone()
                req_id = int(req_row["id"])
                propose_stage = conn.execute(
                    """INSERT INTO qi_stage (request_id, stage_key, sequence, status)
                       VALUES (%s,'propose',1,'completed') RETURNING id""", (req_id,)
                ).fetchone()
                conn.execute(
                    """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
                       VALUES (%s,%s,'propose',%s::jsonb,%s)""",
                    (int(propose_stage["id"]), req_id,
                     json.dumps({"category": cat,
                                 "title": title,
                                 "description": desc_val,
                                 "priority": priority,
                                 "reviewer": reviewer},
                                ensure_ascii=False), op),
                )
                conn.execute(
                    """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage, operator_id, operator_name, comment)
                       SELECT id, 'migrated', 'propose', 'propose', %s, %s, %s FROM qi_request WHERE qi_no=%s""",
                    (op, op_disp, f"迁移自 requirement#{old_no}（停在提出阶段）", new_no),
                )
                migrated += 1
            conn.commit()
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True, "migrated": migrated, "skipped": skipped,
            "total": migrated + skipped}


# ====================================================================
# 领域 → 模块&特性 配置
# ====================================================================
@router.get("/config/domain")
def get_domain_config(operator_id: str = "demo_001") -> dict:
    """返回 [{name: 领域名, modules: [模块名...]}] 列表。"""
    try:
        with db_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS qi_domain_module (
                    domain VARCHAR(128) NOT NULL,
                    module VARCHAR(256) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (domain, module)
                )
            """)
            conn.commit()
            rows = conn.execute(
                "SELECT domain, module FROM qi_domain_module ORDER BY domain, sort_order, module"
            ).fetchall()
    except UndefinedTable:
        return {"domains": []}
    result: dict[str, list[str]] = {}
    for r in rows:
        d = str(r["domain"])
        m = str(r["module"])
        result.setdefault(d, []).append(m)
    return {"domains": [{"name": k, "modules": v} for k, v in result.items()]}


@router.post("/config/domain")
def set_domain_config(payload: dict) -> dict:
    """接收 {domains: [{name, modules}]}，全量替换。"""
    op = str(payload.get("operator_id", "system")).strip()
    domains = payload.get("domains") or []
    if not isinstance(domains, list):
        raise HTTPException(status_code=400, detail="domains 须为数组")
    try:
        with db_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS qi_domain_module (
                    domain VARCHAR(128) NOT NULL,
                    module VARCHAR(256) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (domain, module)
                )
            """)
            conn.execute("DELETE FROM qi_domain_module")
            for i, d in enumerate(domains):
                dn = str(d.get("name", "")).strip()
                if not dn:
                    continue
                mods = d.get("modules") or []
                for j, m in enumerate(mods):
                    mn = str(m).strip()
                    if mn:
                        conn.execute(
                            "INSERT INTO qi_domain_module (domain, module, sort_order) VALUES (%s,%s,%s)",
                            (dn, mn, j),
                        )
            conn.commit()
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True, "count": len(domains)}


@router.get("/config/closure-progress")
def get_closure_progress_config(operator_id: str = "demo_001") -> dict:
    """返回 {需求闭环: [阶段...], 问题单闭环: [阶段...]}。"""
    try:
        with db_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS qi_closure_progress (
                    closure_method VARCHAR(64) NOT NULL,
                    stage_name VARCHAR(128) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (closure_method, stage_name)
                )
            """)
            conn.commit()
            rows = conn.execute(
                "SELECT closure_method, stage_name FROM qi_closure_progress ORDER BY closure_method, sort_order"
            ).fetchall()
    except UndefinedTable:
        return {"progress": {}}
    result: dict[str, list[str]] = {}
    for r in rows:
        result.setdefault(str(r["closure_method"]), []).append(str(r["stage_name"]))
    return {"progress": result}


@router.post("/config/closure-progress")
def set_closure_progress_config(payload: dict) -> dict:
    """接收 {progress: {需求闭环: [阶段...], 问题单闭环: [阶段...]}}，全量替换。"""
    progress = payload.get("progress") or {}
    try:
        with db_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS qi_closure_progress (
                    closure_method VARCHAR(64) NOT NULL,
                    stage_name VARCHAR(128) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (closure_method, stage_name)
                )
            """)
            conn.execute("DELETE FROM qi_closure_progress")
            for method, stages in progress.items():
                if not isinstance(stages, list):
                    continue
                for j, s in enumerate(stages):
                    sn = str(s).strip()
                    if sn:
                        conn.execute(
                            "INSERT INTO qi_closure_progress (closure_method, stage_name, sort_order) VALUES (%s,%s,%s)",
                            (str(method), sn, j),
                        )
            conn.commit()
    except UndefinedTable:
        raise _schema_error()
    return {"ok": True}
