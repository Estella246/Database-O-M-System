from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone, date
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable

from fastapi import APIRouter, HTTPException, Request

from database import db_conn
from utils import parse_ymd as _parse_ymd
from utils.api_guard import require_whitelist
from utils.operator_auth import resolve_operator_id

_MAJOR_PROBLEM_SCHEMA_HINT = "请在数据库执行 db/migrations/0036_major_problem.sql"
_MAJOR_PROBLEM_CONFIG_SCHEMA_HINT = "请在数据库执行 db/migrations/0037_major_problem_config.sql"

MAJOR_PROBLEM_STATUSES = ["待处理", "处理中", "已解决", "已关闭"]

MAJOR_PROBLEM_TYPES = [
    "性能问题",
    "可用性问题",
    "安全问题",
    "存储问题",
    "网络问题",
    "兼容性问题",
    "备份问题",
    "监控问题",
]

ROOT_CAUSE_CATEGORIES = [
    "数据库优化",
    "配置错误",
    "代码缺陷",
    "存储管理",
    "网络配置",
    "版本管理",
    "权限管理",
    "监控配置",
    "资源配置",
    "其他",
]

FEATURE_CATEGORIES = [
    "查询性能",
    "高可用",
    "安全防护",
    "日志管理",
    "数据同步",
    "兼容性",
    "数据备份",
    "告警机制",
    "数据导入",
    "集群管理",
    "其他",
]

IMPACT_CATEGORIES = [
    "性能影响",
    "业务中断",
    "安全风险",
    "数据丢失风险",
    "同步延迟",
    "功能受限",
    "备份失败",
    "响应延迟",
    "资源占用",
    "服务中断",
    "其他",
]

router = APIRouter(prefix="/api/major-problems", tags=["major-problems"])


def _bind_major_view(request: Request, claimed: str, conn) -> str:
    op = resolve_operator_id(request, claimed)
    require_whitelist(conn, op, "major_problem_list", "无重大问题查看权限")
    return op


def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute("SELECT user_name FROM user_account WHERE account = %s", (acc,)).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _allocate_problem_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    prefix = f"MP{ymd}"
    row = conn.execute(
        """
        SELECT COALESCE(MAX(CAST(RIGHT(problem_no, 3) AS INT)), 0) AS mx
        FROM major_problem
        WHERE problem_no LIKE %s AND LENGTH(problem_no) = 13
        """,
        (prefix + "%",),
    ).fetchone()
    n = int(row["mx"] or 0) + 1
    if n > 999:
        raise HTTPException(status_code=500, detail="当日问题编号已满")
    return f"{prefix}{n:03d}"


@router.get("/config")
def get_config_list(request: Request, operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            _bind_major_view(request, operator_id, conn)
            rows = conn.execute(
                """
                SELECT id, field_key, field_label, field_type, field_options,
                       is_required, is_active, sort_order, created_at, updated_at
                FROM major_problem_config
                WHERE is_active = TRUE
                ORDER BY sort_order ASC, id ASC
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"配置表未就绪：{_MAJOR_PROBLEM_CONFIG_SCHEMA_HINT}") from exc

    return {"items": rows, "total": len(rows)}


@router.get("/config/all")
def get_all_config_list(request: Request, operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            _bind_major_view(request, operator_id, conn)
            rows = conn.execute(
                """
                SELECT id, field_key, field_label, field_type, field_options,
                       is_required, is_active, sort_order, created_at, updated_at
                FROM major_problem_config
                ORDER BY sort_order ASC, id ASC
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"配置表未就绪：{_MAJOR_PROBLEM_CONFIG_SCHEMA_HINT}") from exc

    return {"items": rows, "total": len(rows)}


@router.post("/config")
def create_config(payload: dict, request: Request) -> dict:
    operator_id = resolve_operator_id(request, payload.get("operator_id", ""))
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")

    field_key = str(payload.get("field_key", "")).strip()
    field_label = str(payload.get("field_label", "")).strip()
    field_type = str(payload.get("field_type", "text")).strip()
    field_options = payload.get("field_options", [])
    is_required = bool(payload.get("is_required", False))
    is_active = bool(payload.get("is_active", True))
    sort_order = int(payload.get("sort_order", 0) or 0)

    if not field_key:
        raise HTTPException(status_code=400, detail="字段key不能为空")
    if not field_label:
        raise HTTPException(status_code=400, detail="字段标签不能为空")
    if field_type not in ["text", "select", "multiselect", "checkbox", "date", "number"]:
        raise HTTPException(status_code=400, detail="无效字段类型")

    try:
        with db_conn() as conn:
            existing = conn.execute(
                "SELECT id FROM major_problem_config WHERE field_key = %s",
                (field_key,),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail=f"字段key已存在: {field_key}")

            conn.execute(
                """
                INSERT INTO major_problem_config (
                    field_key, field_label, field_type, field_options,
                    is_required, is_active, sort_order
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    field_key,
                    field_label,
                    field_type,
                    json.dumps(field_options),
                    is_required,
                    is_active,
                    sort_order,
                ),
            )
            row = conn.execute(
                """
                SELECT id, field_key, field_label, field_type, field_options,
                       is_required, is_active, sort_order, created_at, updated_at
                FROM major_problem_config
                WHERE field_key = %s
                """,
                (field_key,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"配置表未就绪：{_MAJOR_PROBLEM_CONFIG_SCHEMA_HINT}") from exc

    return row


@router.patch("/config/{config_id}")
def update_config(config_id: int, payload: dict, request: Request) -> dict:
    operator_id = resolve_operator_id(request, payload.get("operator_id", ""))
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")

    try:
        with db_conn() as conn:
            existing = conn.execute(
                "SELECT id FROM major_problem_config WHERE id = %s",
                (config_id,),
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="配置记录不存在")

            updates: list[str] = []
            values: list = []

            if "field_label" in payload:
                updates.append("field_label = %s")
                values.append(str(payload.get("field_label", "")).strip())
            if "field_type" in payload:
                ft = str(payload.get("field_type", "")).strip()
                if ft not in ["text", "select", "multiselect", "checkbox", "date", "number"]:
                    raise HTTPException(status_code=400, detail="无效字段类型")
                updates.append("field_type = %s")
                values.append(ft)
            if "field_options" in payload:
                updates.append("field_options = %s")
                values.append(json.dumps(payload.get("field_options", [])))
            if "is_required" in payload:
                updates.append("is_required = %s")
                values.append(bool(payload.get("is_required")))
            if "is_active" in payload:
                updates.append("is_active = %s")
                values.append(bool(payload.get("is_active")))
            if "sort_order" in payload:
                updates.append("sort_order = %s")
                values.append(int(payload.get("sort_order", 0) or 0))

            if not updates:
                raise HTTPException(status_code=400, detail="无更新字段")

            values.append(config_id)
            conn.execute(
                f"UPDATE major_problem_config SET {', '.join(updates)} WHERE id = %s",
                tuple(values),
            )
            row = conn.execute(
                """
                SELECT id, field_key, field_label, field_type, field_options,
                       is_required, is_active, sort_order, created_at, updated_at
                FROM major_problem_config
                WHERE id = %s
                """,
                (config_id,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"配置表未就绪：{_MAJOR_PROBLEM_CONFIG_SCHEMA_HINT}") from exc

    return row


@router.delete("/config/{config_id}")
def delete_config(config_id: int, request: Request, operator_id: str = "demo_001") -> dict:
    operator_id = resolve_operator_id(request, operator_id)
    try:
        with db_conn() as conn:
            existing = conn.execute(
                "SELECT id FROM major_problem_config WHERE id = %s",
                (config_id,),
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="配置记录不存在")
            conn.execute("DELETE FROM major_problem_config WHERE id = %s", (config_id,))
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"配置表未就绪：{_MAJOR_PROBLEM_CONFIG_SCHEMA_HINT}") from exc

    return {"id": config_id, "deleted": True}


@router.get("")
def list_major_problems(
    request: Request,
    operator_id: str = "demo_001",
    period: str = "all",
    start_date: str = "",
    end_date: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 10,
) -> dict:
    qq = str(q or "").strip()
    pg = max(1, page)
    ps = max(1, min(100, page_size))
    offset = (pg - 1) * ps

    today = datetime.now().date()
    if period == "day":
        start_dt = today
        end_dt = today
    elif period == "week":
        start_dt = today - timedelta(days=7)
        end_dt = today
    elif period == "month":
        start_dt = today - timedelta(days=30)
        end_dt = today
    elif period == "custom":
        start_dt = _parse_ymd(start_date, "start_date") if start_date else today - timedelta(days=30)
        end_dt = _parse_ymd(end_date, "end_date") if end_date else today
        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt
    else:
        start_dt = None
        end_dt = None

    try:
        with db_conn() as conn:
            _bind_major_view(request, operator_id, conn)
            where_parts: list[str] = ["1=1"]
            params: list = []

            if start_dt:
                where_parts.append("report_date >= %s")
                params.append(start_dt)
            if end_dt:
                where_parts.append("report_date <= %s")
                params.append(end_dt)

            if qq:
                pat = f"%{qq}%"
                where_parts.append(
                    """
                    (
                      m.problem_no ILIKE %s OR m.ops_order_no ILIKE %s
                      OR m.site_name ILIKE %s OR m.problem_type ILIKE %s
                      OR m.description ILIKE %s OR m.root_cause ILIKE %s
                      OR m.solution ILIKE %s OR m.dts_bug_no ILIKE %s
                    )
                    """
                )
                params.extend([pat] * 8)

            wh = " AND ".join(where_parts)
            count_row = conn.execute(f"SELECT COUNT(*) AS cnt FROM major_problem m WHERE {wh}", tuple(params)).fetchone()
            total = int(count_row["cnt"] or 0)

            rows = conn.execute(
                f"""
                SELECT
                  m.id, m.report_date, m.ops_order_no, m.problem_no,
                  m.site_name, m.problem_type, m.description,
                  m.root_cause, m.solution, m.root_cause_category,
                  m.feature_category, m.impact_category, m.kernel_version,
                  m.dts_bug_no, m.status, m.creator_id, m.creator_name,
                  m.created_at, m.updated_at, m.custom_fields
                FROM major_problem m
                WHERE {wh}
                ORDER BY m.report_date DESC, m.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [ps, offset]),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_PROBLEM_SCHEMA_HINT}") from exc

    return {"items": rows, "total": total, "page": pg, "page_size": ps}


@router.get("/export")
def export_major_problems(
    request: Request,
    operator_id: str = "demo_001",
    period: str = "all",
    start_date: str = "",
    end_date: str = "",
    q: str = "",
    format: str = "json",
) -> dict:
    qq = str(q or "").strip()

    today = datetime.now().date()
    if period == "day":
        start_dt = today
        end_dt = today
    elif period == "week":
        start_dt = today - timedelta(days=7)
        end_dt = today
    elif period == "month":
        start_dt = today - timedelta(days=30)
        end_dt = today
    elif period == "custom":
        start_dt = _parse_ymd(start_date, "start_date") if start_date else today - timedelta(days=30)
        end_dt = _parse_ymd(end_date, "end_date") if end_date else today
        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt
    else:
        start_dt = None
        end_dt = None

    try:
        with db_conn() as conn:
            _bind_major_view(request, operator_id, conn)
            where_parts: list[str] = ["1=1"]
            params: list = []

            if start_dt:
                where_parts.append("report_date >= %s")
                params.append(start_dt)
            if end_dt:
                where_parts.append("report_date <= %s")
                params.append(end_dt)

            if qq:
                pat = f"%{qq}%"
                where_parts.append(
                    """
                    (
                      m.problem_no ILIKE %s OR m.ops_order_no ILIKE %s
                      OR m.site_name ILIKE %s OR m.problem_type ILIKE %s
                      OR m.description ILIKE %s OR m.root_cause ILIKE %s
                      OR m.solution ILIKE %s OR m.dts_bug_no ILIKE %s
                    )
                    """
                )
                params.extend([pat] * 8)

            wh = " AND ".join(where_parts)
            rows = conn.execute(
                f"""
                SELECT
                  m.id, m.report_date, m.ops_order_no, m.problem_no,
                  m.site_name, m.problem_type, m.description,
                  m.root_cause, m.solution, m.root_cause_category,
                  m.feature_category, m.impact_category, m.kernel_version,
                  m.dts_bug_no, m.status, m.creator_id, m.creator_name,
                  m.created_at, m.updated_at, m.custom_fields
                FROM major_problem m
                WHERE {wh}
                ORDER BY m.report_date DESC, m.created_at DESC
                """,
                tuple(params),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_PROBLEM_SCHEMA_HINT}") from exc

    return {"items": rows, "total": len(rows), "format": format}


@router.get("/{problem_id}")
def get_major_problem(problem_id: int, request: Request, operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            _bind_major_view(request, operator_id, conn)
            row = conn.execute(
                """
                SELECT
                  m.id, m.report_date, m.ops_order_no, m.problem_no,
                  m.site_name, m.problem_type, m.description,
                  m.root_cause, m.solution, m.root_cause_category,
                  m.feature_category, m.impact_category, m.kernel_version,
                  m.dts_bug_no, m.status, m.creator_id, m.creator_name,
                  m.created_at, m.updated_at, m.custom_fields
                FROM major_problem m
                WHERE m.id = %s
                """,
                (problem_id,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_PROBLEM_SCHEMA_HINT}") from exc

    if not row:
        raise HTTPException(status_code=404, detail="重大问题记录不存在")

    return row


@router.post("")
def create_major_problem(payload: dict, request: Request) -> dict:
    operator_id = resolve_operator_id(request, payload.get("operator_id", ""))
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")

    report_date_str = str(payload.get("report_date", "")).strip()
    if not report_date_str:
        raise HTTPException(status_code=400, detail="通报日期不能为空")
    report_date = _parse_ymd(report_date_str, "report_date")

    ops_order_no = str(payload.get("ops_order_no", "")).strip()
    site_name = str(payload.get("site_name", "")).strip()
    problem_type = str(payload.get("problem_type", "")).strip()
    description = str(payload.get("description", "")).strip()
    root_cause = str(payload.get("root_cause", "")).strip()
    solution = str(payload.get("solution", "")).strip()
    root_cause_category = str(payload.get("root_cause_category", "")).strip()
    feature_category = str(payload.get("feature_category", "")).strip()
    impact_category = str(payload.get("impact_category", "")).strip()
    kernel_version = str(payload.get("kernel_version", "")).strip()
    dts_bug_no = str(payload.get("dts_bug_no", "")).strip()
    status = str(payload.get("status", "待处理")).strip()
    custom_fields = payload.get("custom_fields", {})

    if status not in MAJOR_PROBLEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"无效状态: {status}")

    try:
        with db_conn() as conn:
            creator_name = _display_name_account(conn, operator_id)
            if not creator_name:
                creator_name = operator_id
            problem_no = _allocate_problem_no(conn)
            conn.execute(
                """
                INSERT INTO major_problem (
                  report_date, ops_order_no, problem_no, site_name,
                  problem_type, description, root_cause, solution,
                  root_cause_category, feature_category, impact_category,
                  kernel_version, dts_bug_no, status, creator_id, creator_name,
                  custom_fields
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    report_date,
                    ops_order_no,
                    problem_no,
                    site_name,
                    problem_type,
                    description,
                    root_cause,
                    solution,
                    root_cause_category,
                    feature_category,
                    impact_category,
                    kernel_version,
                    dts_bug_no,
                    status,
                    operator_id,
                    creator_name,
                    json.dumps(custom_fields),
                ),
            )
            row = conn.execute(
                """
                SELECT
                  m.id, m.report_date, m.ops_order_no, m.problem_no,
                  m.site_name, m.problem_type, m.description,
                  m.root_cause, m.solution, m.root_cause_category,
                  m.feature_category, m.impact_category, m.kernel_version,
                  m.dts_bug_no, m.status, m.creator_id, m.creator_name,
                  m.created_at, m.updated_at, m.custom_fields
                FROM major_problem m
                WHERE m.problem_no = %s
                """,
                (problem_no,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_PROBLEM_SCHEMA_HINT}") from exc

    return row


@router.patch("/{problem_id}")
def update_major_problem(problem_id: int, payload: dict, request: Request) -> dict:
    operator_id = resolve_operator_id(request, payload.get("operator_id", ""))
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")

    try:
        with db_conn() as conn:
            existing = conn.execute(
                "SELECT id, status FROM major_problem WHERE id = %s",
                (problem_id,),
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="重大问题记录不存在")

            updates: list[str] = []
            values: list = []

            if "report_date" in payload:
                rd = str(payload.get("report_date", "")).strip()
                if rd:
                    updates.append("report_date = %s")
                    values.append(_parse_ymd(rd, "report_date"))
            if "ops_order_no" in payload:
                updates.append("ops_order_no = %s")
                values.append(str(payload.get("ops_order_no", "")).strip())
            if "site_name" in payload:
                updates.append("site_name = %s")
                values.append(str(payload.get("site_name", "")).strip())
            if "problem_type" in payload:
                updates.append("problem_type = %s")
                values.append(str(payload.get("problem_type", "")).strip())
            if "description" in payload:
                updates.append("description = %s")
                values.append(str(payload.get("description", "")).strip())
            if "root_cause" in payload:
                updates.append("root_cause = %s")
                values.append(str(payload.get("root_cause", "")).strip())
            if "solution" in payload:
                updates.append("solution = %s")
                values.append(str(payload.get("solution", "")).strip())
            if "root_cause_category" in payload:
                updates.append("root_cause_category = %s")
                values.append(str(payload.get("root_cause_category", "")).strip())
            if "feature_category" in payload:
                updates.append("feature_category = %s")
                values.append(str(payload.get("feature_category", "")).strip())
            if "impact_category" in payload:
                updates.append("impact_category = %s")
                values.append(str(payload.get("impact_category", "")).strip())
            if "kernel_version" in payload:
                updates.append("kernel_version = %s")
                values.append(str(payload.get("kernel_version", "")).strip())
            if "dts_bug_no" in payload:
                updates.append("dts_bug_no = %s")
                values.append(str(payload.get("dts_bug_no", "")).strip())
            if "status" in payload:
                st = str(payload.get("status", "")).strip()
                if st not in MAJOR_PROBLEM_STATUSES:
                    raise HTTPException(status_code=400, detail=f"无效状态: {st}")
                updates.append("status = %s")
                values.append(st)
            if "custom_fields" in payload:
                updates.append("custom_fields = %s")
                values.append(json.dumps(payload.get("custom_fields", {})))

            if not updates:
                raise HTTPException(status_code=400, detail="无更新字段")

            values.append(problem_id)
            conn.execute(
                f"UPDATE major_problem SET {', '.join(updates)} WHERE id = %s",
                tuple(values),
            )
            row = conn.execute(
                """
                SELECT
                  m.id, m.report_date, m.ops_order_no, m.problem_no,
                  m.site_name, m.problem_type, m.description,
                  m.root_cause, m.solution, m.root_cause_category,
                  m.feature_category, m.impact_category, m.kernel_version,
                  m.dts_bug_no, m.status, m.creator_id, m.creator_name,
                  m.created_at, m.updated_at, m.custom_fields
                FROM major_problem m
                WHERE m.id = %s
                """,
                (problem_id,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_PROBLEM_SCHEMA_HINT}") from exc

    return row


@router.delete("/{problem_id}")
def delete_major_problem(problem_id: int, request: Request, operator_id: str = "demo_001") -> dict:
    operator_id = resolve_operator_id(request, operator_id)
    try:
        with db_conn() as conn:
            existing = conn.execute(
                "SELECT id FROM major_problem WHERE id = %s",
                (problem_id,),
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="重大问题记录不存在")
            conn.execute("DELETE FROM major_problem WHERE id = %s", (problem_id,))
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_PROBLEM_SCHEMA_HINT}") from exc

    return {"id": problem_id, "deleted": True}