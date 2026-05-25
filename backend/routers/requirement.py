from __future__ import annotations

import json
import re
import urllib.parse
from datetime import datetime, timedelta, timezone, date
from io import BytesIO
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side

from config import (
    _REQUIREMENT_NO_LOCK,
    REQUIREMENT_STATUSES,
    REQUIREMENT_CATEGORIES,
    REQUIREMENT_VALUES,
    REQUIREMENT_STATUS_FORWARD,
    REQUIREMENT_STATUS_BACKWARD,
)
from database import db_conn
from models import RequirementCreatePayload, RequirementPatchPayload, RequirementExportPayload
from utils import parse_ymd as _parse_ymd
from whitelist_policy import whitelist_permission_level, whitelist_field_levels

_REQUIREMENT_SCHEMA_HINT = "请在数据库执行 db/migrations/0024_requirement.sql"

router = APIRouter(prefix="/api/requirements", tags=["requirements"])


def _get_user_role(conn, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        "SELECT role_code, is_pl FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), bool(row.get("is_pl") or False)


def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute("SELECT user_name FROM user_account WHERE account = %s", (acc,)).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _allocate_requirement_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    prefix = f"RQ{ymd}"
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (_REQUIREMENT_NO_LOCK,))
    row = conn.execute(
        """
        SELECT COALESCE(MAX(CAST(RIGHT(requirement_no, 3) AS INT)), 0) AS mx
        FROM requirement
        WHERE requirement_no LIKE %s AND LENGTH(requirement_no) = 13
        """,
        (prefix + "%",),
    ).fetchone()
    n = int(row["mx"] or 0) + 1
    if n > 999:
        raise HTTPException(status_code=500, detail="当日需求编号已满")
    return f"{prefix}{n:03d}"


@router.get("")
def list_requirements(
    operator_id: str = "demo_001",
    scope: str = "all",
    status: str = "",
    priority: str = "",
    category: str = "",
    value: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    op = operator_id.strip() or "demo_001"
    sc = (scope or "all").strip().lower()
    if sc not in ("all", "mine", "assigned"):
        raise HTTPException(status_code=400, detail="scope 须为 all、mine 或 assigned")
    qq = str(q or "").strip()
    status_list = [s.strip() for s in status.split(",") if s.strip()] if status else []
    priority_list = [p.strip() for p in priority.split(",") if p.strip()] if priority else []
    category_list = [c.strip() for c in category.split(",") if c.strip()] if category else []
    value_list = [v.strip() for v in value.split(",") if v.strip()] if value else []
    pg = max(1, page)
    ps = max(1, min(10000, page_size))
    offset = (pg - 1) * ps
    try:
        with db_conn() as conn:
            where_parts: list[str] = ["1=1"]
            params: list = []
            if sc == "mine":
                where_parts.append("r.creator_id = %s")
                params.append(op)
            elif sc == "assigned":
                where_parts.append("r.assignee LIKE %s")
                params.append(f"%{op}%")
            if status_list:
                ph = ",".join(["%s"] * len(status_list))
                where_parts.append(f"r.status IN ({ph})")
                params.extend(status_list)
            if priority_list:
                ph = ",".join(["%s"] * len(priority_list))
                where_parts.append(f"r.priority IN ({ph})")
                params.extend([int(p) for p in priority_list if p.isdigit()])
            if category_list:
                ph = ",".join(["%s"] * len(category_list))
                where_parts.append(f"r.category IN ({ph})")
                params.extend(category_list)
            if value_list:
                ph = ",".join(["%s"] * len(value_list))
                where_parts.append(f"r.value IN ({ph})")
                params.extend(value_list)
            if qq:
                pat = f"%{qq}%"
                where_parts.append(
                    """
                    (
                      r.title ILIKE %s OR r.description ILIKE %s
                      OR r.proposer ILIKE %s OR r.assignee ILIKE %s
                      OR r.external_req_no ILIKE %s OR r.remark ILIKE %s
                      OR r.requirement_no ILIKE %s OR r.category ILIKE %s OR r.value ILIKE %s
                    )
                    """
                )
                params.extend([pat] * 9)
            wh = " AND ".join(where_parts)
            count_row = conn.execute(f"SELECT COUNT(*) AS cnt FROM requirement r WHERE {wh}", tuple(params)).fetchone()
            total = int(count_row["cnt"] or 0)
            rows = conn.execute(
                f"""
                SELECT
                  r.id, r.requirement_no, r.title, r.description,
                  r.proposer, r.assignee, r.related_issues,
                  r.external_req_no, r.planned_version, r.planned_date,
                  r.priority, r.category, r.value, r.remark, r.status,
                  r.creator_id, r.creator_name,
                  r.created_at, r.updated_at
                FROM requirement r
                WHERE {wh}
                ORDER BY r.priority ASC, r.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [ps, offset]),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {"items": rows, "total": total, "page": pg, "page_size": ps}


@router.get("/analytics")
def analytics_requirements(
    operator_id: str = "demo_001",
    start_date: str = "",
    end_date: str = "",
    precision: str = "week",
) -> dict:
    _ = operator_id.strip() or "demo_001"
    today = datetime.now().date()
    ed = _parse_ymd(end_date, "end_date") if end_date else today
    sd = _parse_ymd(start_date, "start_date") if start_date else today - timedelta(days=90)
    if sd > ed:
        sd, ed = ed, sd
    prec = (precision or "week").strip().lower()
    if prec not in ("week", "month"):
        raise HTTPException(status_code=400, detail="precision 须为 week 或 month")
    start_dt = datetime(sd.year, sd.month, sd.day, tzinfo=timezone.utc)
    end_dt_exclusive = datetime(ed.year, ed.month, ed.day, tzinfo=timezone.utc) + timedelta(days=1)
    try:
        with db_conn() as conn:
            kpi_row = conn.execute(
                "SELECT COUNT(*) AS total, COALESCE(AVG(priority),0) AS avg_priority FROM requirement WHERE created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            total = int(kpi_row["total"] or 0)
            avg_priority = round(float(kpi_row["avg_priority"] or 0), 1)
            status_rows = conn.execute(
                "SELECT status, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY status ORDER BY status",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            by_status: dict[str, int] = {}
            for r in status_rows:
                by_status[str(r["status"])] = int(r["cnt"])
            all_statuses = ["待分析", "待RAT决策", "开发中", "已经落地"]
            status_labels = all_statuses
            status_values = [by_status.get(s, 0) for s in all_statuses]
            in_progress = by_status.get("待分析", 0) + by_status.get("待RAT决策", 0) + by_status.get("开发中", 0)
            landed = by_status.get("已经落地", 0)
            on_time_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM requirement WHERE status = '已经落地' AND planned_date IS NOT NULL AND updated_at::date <= planned_date AND created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            landed_with_plan_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM requirement WHERE status = '已经落地' AND planned_date IS NOT NULL AND created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            on_time_count = int(on_time_row["cnt"] or 0)
            landed_with_plan = int(landed_with_plan_row["cnt"] or 0)
            on_time_rate = round(on_time_count / landed_with_plan, 2) if landed_with_plan > 0 else None
            overdue_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM requirement WHERE status != '已经落地' AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE AND created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            overdue_count = int(overdue_row["cnt"] or 0)
            prio_rows = conn.execute(
                "SELECT priority, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY priority ORDER BY priority",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            prio_map: dict[int, int] = {}
            for r in prio_rows:
                prio_map[int(r["priority"])] = int(r["cnt"])
            urgent_count = sum(prio_map.get(p, 0) for p in range(1, 4))
            high_count = sum(prio_map.get(p, 0) for p in range(4, 7))
            low_count = sum(prio_map.get(p, 0) for p in range(7, 11))
            priority_groups = [
                {"label": "紧急(P1-3)", "count": urgent_count, "items": [prio_map.get(p, 0) for p in range(1, 4)]},
                {"label": "高(P4-6)", "count": high_count, "items": [prio_map.get(p, 0) for p in range(4, 7)]},
                {"label": "低(P7-10)", "count": low_count, "items": [prio_map.get(p, 0) for p in range(7, 11)]},
            ]
            category_rows = conn.execute(
                "SELECT category, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY category ORDER BY category",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            category_labels = list(REQUIREMENT_CATEGORIES)
            category_map = {str(r["category"]): int(r["cnt"]) for r in category_rows}
            category_values = [category_map.get(c, 0) for c in category_labels]
            value_rows = conn.execute(
                "SELECT value, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY value ORDER BY value",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            value_labels = list(REQUIREMENT_VALUES)
            value_map = {str(r["value"]): int(r["cnt"]) for r in value_rows}
            value_values = [value_map.get(v, 0) for v in value_labels]
            trunc = "week" if prec == "week" else "month"
            fmt = "YYYY\"W\"IW" if prec == "week" else "YYYY-MM"
            trend_created_rows = conn.execute(
                f"SELECT to_char(date_trunc(%s, created_at), %s) AS label, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY label ORDER BY MIN(created_at)",
                (trunc, fmt, start_dt, end_dt_exclusive),
            ).fetchall()
            trend_changed_rows = conn.execute(
                f"SELECT to_char(date_trunc(%s, rl.created_at), %s) AS label, COUNT(DISTINCT rl.requirement_id) AS cnt FROM requirement_log rl WHERE rl.action = 'status_changed' AND rl.created_at >= %s AND rl.created_at < %s GROUP BY label ORDER BY MIN(rl.created_at)",
                (trunc, fmt, start_dt, end_dt_exclusive),
            ).fetchall()
            trend_landed_rows = conn.execute(
                f"SELECT to_char(date_trunc(%s, rl.created_at), %s) AS label, COUNT(DISTINCT rl.requirement_id) AS cnt FROM requirement_log rl WHERE rl.action = 'status_changed' AND rl.to_status = '已经落地' AND rl.created_at >= %s AND rl.created_at < %s GROUP BY label ORDER BY MIN(rl.created_at)",
                (trunc, fmt, start_dt, end_dt_exclusive),
            ).fetchall()
            all_labels_set: set[str] = set()
            for r in trend_created_rows:
                all_labels_set.add(str(r["label"]))
            for r in trend_changed_rows:
                all_labels_set.add(str(r["label"]))
            for r in trend_landed_rows:
                all_labels_set.add(str(r["label"]))
            all_labels = sorted(all_labels_set)
            created_map = {str(r["label"]): int(r["cnt"]) for r in trend_created_rows}
            changed_map = {str(r["label"]): int(r["cnt"]) for r in trend_changed_rows}
            landed_map = {str(r["label"]): int(r["cnt"]) for r in trend_landed_rows}
            proposer_rows = conn.execute(
                "SELECT proposer, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY proposer ORDER BY cnt DESC LIMIT 10",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            assignee_rows = conn.execute(
                "SELECT assignee, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY assignee ORDER BY cnt DESC LIMIT 10",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            version_rows = conn.execute(
                "SELECT planned_version, status, COUNT(*) AS cnt FROM requirement WHERE planned_version != '' AND created_at >= %s AND created_at < %s GROUP BY planned_version, status ORDER BY planned_version",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            version_map: dict[str, dict[str, int]] = {}
            for r in version_rows:
                v = str(r["planned_version"])
                s = str(r["status"])
                if v not in version_map:
                    version_map[v] = {}
                version_map[v][s] = int(r["cnt"])
            by_version = []
            for v in sorted(version_map.keys()):
                vm = version_map[v]
                v_total = sum(vm.values())
                v_landed = vm.get("已经落地", 0)
                v_overdue_row = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM requirement WHERE planned_version = %s AND status != '已经落地' AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE",
                    (v,),
                ).fetchone()
                v_overdue = int(v_overdue_row["cnt"] or 0)
                by_version.append({"version": v, "total": v_total, "landed": v_landed, "overdue": v_overdue, "by_status": vm})
            overdue_detail_rows = conn.execute(
                "SELECT requirement_no, title, planned_date, status FROM requirement WHERE status != '已经落地' AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE AND created_at >= %s AND created_at < %s ORDER BY planned_date ASC LIMIT 20",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            overdue_details = [
                {"requirement_no": str(r["requirement_no"]), "title": str(r["title"]), "planned_date": str(r["planned_date"])[:10] if r["planned_date"] else "", "status": str(r["status"])}
                for r in overdue_detail_rows
            ]
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {
        "kpi": {
            "total": total,
            "by_status": by_status,
            "avg_priority": avg_priority,
            "on_time_rate": on_time_rate,
            "overdue_count": overdue_count,
            "in_progress": in_progress,
            "landed": landed,
        },
        "status_distribution": {"labels": status_labels, "values": status_values},
        "priority_distribution": {"groups": priority_groups},
        "category_distribution": {"labels": category_labels, "values": category_values},
        "value_distribution": {"labels": value_labels, "values": value_values},
        "trend": {
            "labels": all_labels,
            "created": [created_map.get(l, 0) for l in all_labels],
            "status_changed": [changed_map.get(l, 0) for l in all_labels],
            "landed": [landed_map.get(l, 0) for l in all_labels],
        },
        "person_load": {
            "top_proposers": [{"name": str(r["proposer"]), "count": int(r["cnt"])} for r in proposer_rows],
            "top_assignees": [{"name": str(r["assignee"]), "count": int(r["cnt"])} for r in assignee_rows],
        },
        "version_plan": {"by_version": by_version, "overdue_details": overdue_details},
    }


@router.post("")
def create_requirement(payload: RequirementCreatePayload) -> dict:
    op = payload.operator_id.strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="需求标题不能为空")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="详细描述不能为空")
    if not payload.proposer.strip():
        raise HTTPException(status_code=400, detail="需求提出人不能为空")
    if not payload.assignee.strip():
        raise HTTPException(status_code=400, detail="当前责任人不能为空")
    if payload.priority < 1 or payload.priority > 10:
        raise HTTPException(status_code=400, detail="优先级须为 1-10")
    cat = payload.category.strip() or "其他"
    if cat not in REQUIREMENT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"无效需求分类: {cat}")
    val = payload.value.strip() or "质量加固"
    if val not in REQUIREMENT_VALUES:
        raise HTTPException(status_code=400, detail=f"无效需求价值: {val}")
    related = [str(x or "").strip() for x in payload.related_issues if str(x or "").strip()]
    planned_date_val = None
    if payload.planned_date:
        try:
            planned_date_val = datetime.strptime(payload.planned_date.strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="计划落地日期格式无效，应为 YYYY-MM-DD") from exc
    try:
        with db_conn() as conn:
            creator_disp = _display_name_account(conn, op)
            req_no = _allocate_requirement_no(conn)
            row = conn.execute(
                """
                INSERT INTO requirement (
                  requirement_no, title, description, proposer, assignee,
                  related_issues, external_req_no, planned_version, planned_date,
                  priority, category, value, remark, status, creator_id, creator_name
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    req_no,
                    payload.title.strip(),
                    payload.description.strip(),
                    payload.proposer.strip(),
                    payload.assignee.strip(),
                    psycopg.types.json.Jsonb(related),
                    payload.external_req_no.strip(),
                    payload.planned_version.strip(),
                    planned_date_val,
                    payload.priority,
                    cat,
                    val,
                    payload.remark.strip(),
                    "待分析",
                    op,
                    creator_disp,
                ),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="写入需求失败")
            req_id = int(row["id"])
            conn.execute(
                """
                INSERT INTO requirement_log (requirement_id, action, to_status, operator_id, operator_name, comment)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (req_id, "created", "待分析", op, creator_disp, ""),
            )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return dict(row)


@router.get("/{req_id:int}")
def get_requirement(req_id: int, operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM requirement WHERE id = %s", (req_id,)).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    if not row:
        raise HTTPException(status_code=404, detail="需求不存在")
    return dict(row)


@router.patch("/{req_id:int}")
def patch_requirement(req_id: int, payload: RequirementPatchPayload) -> dict:
    op = payload.operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM requirement WHERE id = %s FOR UPDATE", (req_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="需求不存在")
            old = dict(row)
            updates: dict[str, Any] = {}
            changed: dict[str, list] = {}
            simple_fields = {
                "title": payload.title,
                "description": payload.description,
                "proposer": payload.proposer,
                "assignee": payload.assignee,
                "external_req_no": payload.external_req_no,
                "planned_version": payload.planned_version,
                "remark": payload.remark,
            }
            for field, val in simple_fields.items():
                if val is not None:
                    new_val = str(val).strip()
                    old_val = str(old.get(field, "") or "").strip()
                    if new_val != old_val:
                        updates[field] = new_val
                        changed[field] = [old_val, new_val]
            if payload.category is not None:
                new_cat = payload.category.strip()
                if new_cat not in REQUIREMENT_CATEGORIES:
                    raise HTTPException(status_code=400, detail=f"无效需求分类: {new_cat}")
                old_cat = str(old.get("category", "") or "").strip()
                if new_cat != old_cat:
                    updates["category"] = new_cat
                    changed["category"] = [old_cat, new_cat]
            if payload.value is not None:
                new_val = payload.value.strip()
                if new_val not in REQUIREMENT_VALUES:
                    raise HTTPException(status_code=400, detail=f"无效需求价值: {new_val}")
                old_val = str(old.get("value", "") or "").strip()
                if new_val != old_val:
                    updates["value"] = new_val
                    changed["value"] = [old_val, new_val]
            if payload.priority is not None:
                if payload.priority < 1 or payload.priority > 10:
                    raise HTTPException(status_code=400, detail="优先级须为 1-10")
                if payload.priority != old["priority"]:
                    updates["priority"] = payload.priority
                    changed["priority"] = [old["priority"], payload.priority]
            if payload.related_issues is not None:
                new_issues = [str(x or "").strip() for x in payload.related_issues if str(x or "").strip()]
                old_issues = old.get("related_issues") or []
                if isinstance(old_issues, str):
                    old_issues = json.loads(old_issues)
                if new_issues != old_issues:
                    updates["related_issues"] = psycopg.types.json.Jsonb(new_issues)
                    changed["related_issues"] = [old_issues, new_issues]
            if payload.planned_date is not None:
                pd_val = None
                if payload.planned_date.strip():
                    try:
                        pd_val = datetime.strptime(payload.planned_date.strip(), "%Y-%m-%d").date()
                    except ValueError as exc:
                        raise HTTPException(status_code=400, detail="计划落地日期格式无效") from exc
                old_pd = old.get("planned_date")
                if pd_val != old_pd:
                    updates["planned_date"] = pd_val
                    changed["planned_date"] = [str(old_pd or ""), str(pd_val or "")]
            from_status = None
            to_status = None
            if payload.status is not None:
                new_status = payload.status.strip()
                old_status = str(old.get("status", "") or "").strip()
                if new_status != old_status:
                    if new_status not in REQUIREMENT_STATUSES:
                        raise HTTPException(status_code=400, detail=f"无效状态: {new_status}")
                    forward = REQUIREMENT_STATUS_FORWARD.get(old_status)
                    backward = REQUIREMENT_STATUS_BACKWARD.get(old_status)
                    if new_status != forward and new_status != backward:
                        raise HTTPException(
                            status_code=400,
                            detail=f"不允许从「{old_status}」变更为「{new_status}」，仅允许正向流转或回退一步",
                        )
                    updates["status"] = new_status
                    from_status = old_status
                    to_status = new_status
            if not updates:
                conn.rollback()
                return dict(old)
            set_parts = [f"{k} = %s" for k in updates]
            set_parts.append("updated_at = NOW()")
            vals = list(updates.values())
            vals.append(req_id)
            conn.execute(
                f"UPDATE requirement SET {', '.join(set_parts)} WHERE id = %s",
                tuple(vals),
            )
            operator_disp = _display_name_account(conn, op)
            action = "status_changed" if to_status else "updated"
            conn.execute(
                """
                INSERT INTO requirement_log (requirement_id, action, from_status, to_status, changed_fields, operator_id, operator_name, comment)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                """,
                (
                    req_id,
                    action,
                    from_status,
                    to_status,
                    psycopg.types.json.Jsonb(changed) if changed else None,
                    op,
                    operator_disp,
                    payload.comment.strip(),
                ),
            )
            conn.commit()
            new_row = conn.execute("SELECT * FROM requirement WHERE id = %s", (req_id,)).fetchone()
            return dict(new_row)
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc


@router.get("/{req_id:int}/logs")
def get_requirement_logs(req_id: int, operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, action, from_status, to_status, changed_fields, comment,
                       operator_id, operator_name, created_at
                FROM requirement_log
                WHERE requirement_id = %s
                ORDER BY created_at DESC
                """,
                (req_id,),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {"items": rows}


@router.delete("/{req_id:int}")
def delete_requirement(req_id: int, operator_id: str = "demo_001") -> dict:
    op = operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM requirement WHERE id = %s FOR UPDATE", (req_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="需求不存在")
            if str(row["status"] or "").strip() != "待分析":
                raise HTTPException(status_code=400, detail="仅「待分析」状态的需求可删除")
            if str(row["creator_id"] or "").strip() != op:
                raise HTTPException(status_code=403, detail="仅创建人可删除需求")
            conn.execute("DELETE FROM requirement WHERE id = %s", (req_id,))
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {"ok": True}


@router.post("/export")
def export_requirements(payload: RequirementExportPayload) -> StreamingResponse:
    """导出需求为 Excel 文件。"""
    op = payload.operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_export") == "hidden":
                raise HTTPException(status_code=403, detail="无导出权限")
            rows = conn.execute(
                """
                SELECT
                  requirement_no, title, description, proposer, assignee,
                  related_issues, external_req_no, planned_version, planned_date,
                  priority, category, value, remark, status,
                  creator_name, created_at, updated_at
                FROM requirement
                ORDER BY priority ASC, created_at DESC
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc

    wb = Workbook()
    ws = wb.active
    ws.title = "需求导出"

    headers = [
        "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
        "关联问题", "需求单号", "计划落地版本", "计划落地日期",
        "优先级", "需求分类", "需求价值", "状态", "备注",
        "创建人", "创建时间", "更新时间"
    ]
    header_font = Font(bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin")
    )

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.alignment = header_alignment
        cell.border = thin_border

    for row_idx, row in enumerate(rows, start=2):
        related = row.get("related_issues") or []
        if isinstance(related, str):
            try:
                related = json.loads(related)
            except (json.JSONDecodeError, TypeError):
                related = []
        related_str = ", ".join(str(x) for x in related) if related else ""

        planned_date_val = row.get("planned_date")
        if planned_date_val:
            planned_date_str = str(planned_date_val)[:10]
        else:
            planned_date_str = ""

        created_at_val = row.get("created_at")
        created_at_str = created_at_val.strftime("%Y-%m-%d %H:%M:%S") if created_at_val else ""

        updated_at_val = row.get("updated_at")
        updated_at_str = updated_at_val.strftime("%Y-%m-%d %H:%M:%S") if updated_at_val else ""

        values = [
            str(row.get("requirement_no") or ""),
            str(row.get("title") or ""),
            str(row.get("description") or ""),
            str(row.get("proposer") or ""),
            str(row.get("assignee") or ""),
            related_str,
            str(row.get("external_req_no") or ""),
            str(row.get("planned_version") or ""),
            planned_date_str,
            int(row.get("priority") or 0),
            str(row.get("category") or ""),
            str(row.get("value") or ""),
            str(row.get("status") or ""),
            str(row.get("remark") or ""),
            str(row.get("creator_name") or ""),
            created_at_str,
            updated_at_str,
        ]

        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.border = thin_border

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    today = datetime.now().strftime("%Y-%m-%d")
    filename = f"requirements_export_{op}_{today}.xlsx"
    # URL-encoded filename for Chinese support (RFC 5987)
    filename_utf8 = f"需求导出_{op}_{today}.xlsx"
    encoded_filename = urllib.parse.quote(filename_utf8, safe="")

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_filename}"
        }
    )


@router.get("/import-template")
def get_import_template(operator_id: str = "demo_001") -> StreamingResponse:
    """下载需求导入模板 Excel 文件。"""
    op = operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_import") == "hidden":
                raise HTTPException(status_code=403, detail="无导入权限")
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc

    wb = Workbook()
    ws = wb.active
    ws.title = "需求导入模板"

    headers = [
        "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
        "关联问题", "需求单号", "计划落地版本", "计划落地日期",
        "优先级", "需求分类", "需求价值", "状态", "备注"
    ]

    header_font = Font(bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin")
    )

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.alignment = header_alignment
        cell.border = thin_border

    example_values = [
        "", "示例需求标题", "示例需求详细描述内容", "张三 zhangsan", "李四 lisi",
        "YW20260525001,DTS-001", "EXT-2026-001", "V8.2.0", "2026-06-30",
        3, "管控需求", "性能提升", "", "示例备注信息"
    ]

    for col_idx, value in enumerate(example_values, start=1):
        cell = ws.cell(row=2, column=col_idx, value=value)
        cell.border = thin_border

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = "requirement_import_template.xlsx"
    filename_utf8 = "需求导入模板.xlsx"
    encoded_filename = urllib.parse.quote(filename_utf8, safe="")

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_filename}"
        }
    )


_REQ_NO_PATTERN = re.compile(r"^RQ\d{8}\d{3}$")  # RQYYYYMMDDnnn


def _validate_req_no_format(req_no: str) -> bool:
    """校验需求编号格式是否合法。"""
    return bool(_REQ_NO_PATTERN.match(str(req_no or "").strip()))


def _check_status_transition(old_status: str, new_status: str) -> tuple[bool, str]:
    """检查状态流转是否合法。返回 (是否合法, 错误消息)。"""
    if not new_status or new_status == old_status:
        return True, ""
    forward = REQUIREMENT_STATUS_FORWARD.get(old_status)
    backward = REQUIREMENT_STATUS_BACKWARD.get(old_status)
    if new_status == forward or new_status == backward:
        return True, ""
    return False, f"不允许从「{old_status}」流转至「{new_status}」，仅允许正向流转或回退一步"


def _parse_excel_import(file_content: bytes) -> tuple[list[dict], list[dict]]:
    """解析Excel导入文件，返回 (数据行列表, 错误列表)。"""
    from openpyxl import load_workbook

    wb = load_workbook(BytesIO(file_content))
    ws = wb.active

    rows = []
    errors = []

    # 获取表头映射
    headers = {}
    for col in range(1, ws.max_column + 1):
        header_val = ws.cell(row=1, column=col).value
        if header_val:
            headers[str(header_val).strip()] = col

    expected_headers = [
        "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
        "关联问题", "需求单号", "计划落地版本", "计划落地日期",
        "优先级", "需求分类", "需求价值", "状态", "备注"
    ]
    for h in expected_headers:
        if h not in headers:
            errors.append({"row": 1, "field": "表头", "message": f"缺少必填列：{h}"})

    if errors:
        return [], errors

    # 从第3行开始解析（跳过表头和示例行）
    for row_idx in range(3, ws.max_row + 1):
        row_data = {}
        for h, col in headers.items():
            val = ws.cell(row=row_idx, column=col).value
            row_data[h] = val if val is not None else ""

        # 跳过空行（标题为空）
        if not str(row_data.get("需求标题", "")).strip():
            continue

        row_data["_row_idx"] = row_idx
        rows.append(row_data)

    return rows, errors


@router.post("/import")
async def import_requirements(
    file: UploadFile = File(...),
    operator_id: str = Form(...),
) -> dict:
    """批量导入需求。"""
    op = operator_id.strip() or "demo_001"

    # 权限检查
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_import") == "hidden":
                raise HTTPException(status_code=403, detail="无导入权限")
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc

    # 文件格式检查
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式文件")

    # 解析Excel
    try:
        content = await file.read()
        rows, parse_errors = _parse_excel_import(content)
        if parse_errors:
            raise HTTPException(
                status_code=400,
                detail=json.dumps({"success": False, "error_type": "validation_failed", "errors": parse_errors})
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail="文件无法解析，请检查文件格式") from e

    if not rows:
        return {"success": True, "total": 0, "created": 0, "updated": 0, "message": "导入成功，共0条需求"}

    # 全量校验
    validation_errors = []
    existing_reqs = {}  # requirement_no -> row data from DB

    try:
        with db_conn() as conn:
            # 预加载所有已有需求编号（用于冲突检测）
            all_req_nos = conn.execute("SELECT id, requirement_no, status FROM requirement").fetchall()
            for r in all_req_nos:
                req_no = str(r["requirement_no"] or "").strip()
                if req_no:
                    existing_reqs[req_no] = {"id": r["id"], "status": str(r["status"] or "")}

            operator_disp = _display_name_account(conn, op)

            # 校验每行数据
            for row_data in rows:
                row_idx = row_data["_row_idx"]

                # 必填字段校验
                title = str(row_data.get("需求标题", "")).strip()
                if not title:
                    validation_errors.append({"row": row_idx, "field": "需求标题", "message": "必填字段不能为空"})

                desc = str(row_data.get("详细描述", "")).strip()
                if not desc:
                    validation_errors.append({"row": row_idx, "field": "详细描述", "message": "必填字段不能为空"})

                proposer = str(row_data.get("需求提出人", "")).strip()
                if not proposer:
                    validation_errors.append({"row": row_idx, "field": "需求提出人", "message": "必填字段不能为空"})

                assignee = str(row_data.get("当前责任人", "")).strip()
                if not assignee:
                    validation_errors.append({"row": row_idx, "field": "当前责任人", "message": "必填字段不能为空"})

                # 优先级校验（宽松：无效值用默认值5）
                priority_raw = row_data.get("优先级", 5)
                try:
                    priority = int(priority_raw) if priority_raw else 5
                    if priority < 1 or priority > 10:
                        priority = 5
                except (ValueError, TypeError):
                    priority = 5

                # 需求分类校验（宽松：无效值用默认值"其他"）
                category = str(row_data.get("需求分类", "")).strip() or "其他"
                if category not in REQUIREMENT_CATEGORIES:
                    category = "其他"

                # 需求价值校验（宽松：无效值用默认值"质量加固"）
                req_value = str(row_data.get("需求价值", "")).strip() or "质量加固"
                if req_value not in REQUIREMENT_VALUES:
                    req_value = "质量加固"

                # 计划落地日期校验
                planned_date_raw = str(row_data.get("计划落地日期", "")).strip()
                planned_date_val = None
                if planned_date_raw:
                    try:
                        planned_date_val = datetime.strptime(planned_date_raw, "%Y-%m-%d").date()
                    except ValueError:
                        validation_errors.append({"row": row_idx, "field": "计划落地日期", "message": "日期格式错误，应为YYYY-MM-DD"})

                # 需求编号校验
                req_no = str(row_data.get("需求编号", "")).strip()
                is_update = False
                existing_id = None
                existing_status = None

                if req_no:
                    if not _validate_req_no_format(req_no):
                        validation_errors.append({"row": row_idx, "field": "需求编号", "message": "需求编号格式错误，应为RQ+8位日期+3位序号"})
                    elif req_no in existing_reqs:
                        is_update = True
                        existing_id = existing_reqs[req_no]["id"]
                        existing_status = existing_reqs[req_no]["status"]

                # 状态校验（仅更新模式需要检查流转约束）
                status_raw = str(row_data.get("状态", "")).strip()
                if status_raw and status_raw not in REQUIREMENT_STATUSES:
                    validation_errors.append({"row": row_idx, "field": "状态", "message": f"无效状态值：{status_raw}"})

                if is_update and existing_status:
                    # 已经落地的需求不允许更新
                    if existing_status == "已经落地":
                        validation_errors.append({"row": row_idx, "field": "状态", "message": "已经落地的需求不可通过导入变更"})
                    elif status_raw:
                        valid, err_msg = _check_status_transition(existing_status, status_raw)
                        if not valid:
                            validation_errors.append({"row": row_idx, "field": "状态", "message": err_msg})

                # 保存校验后的数据
                row_data["_validated"] = {
                    "title": title,
                    "description": desc,
                    "proposer": proposer,
                    "assignee": assignee,
                    "priority": priority,
                    "category": category,
                    "value": req_value,
                    "planned_date": planned_date_val,
                    "status": status_raw if status_raw in REQUIREMENT_STATUSES else "",
                    "is_update": is_update,
                    "existing_id": existing_id,
                    "existing_status": existing_status,
                }
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc

    if validation_errors:
        raise HTTPException(
            status_code=400,
            detail=json.dumps({"success": False, "error_type": "validation_failed", "errors": validation_errors})
        )

    # 执行导入（事务）
    created_count = 0
    updated_count = 0

    try:
        with db_conn() as conn:
            for row_data in rows:
                v = row_data["_validated"]

                # 关联问题解析（逗号分隔）
                related_raw = str(row_data.get("关联问题", "")).strip()
                related_issues = [x.strip() for x in related_raw.split(",") if x.strip()] if related_raw else []

                # 其他可选字段
                external_req_no = str(row_data.get("需求单号", "")).strip()
                planned_version = str(row_data.get("计划落地版本", "")).strip()
                remark = str(row_data.get("备注", "")).strip()

                if v["is_update"]:
                    # 更新模式
                    req_id = v["existing_id"]
                    old_row = conn.execute("SELECT * FROM requirement WHERE id = %s FOR UPDATE", (req_id,)).fetchone()
                    old = dict(old_row)

                    updates: dict[str, Any] = {}
                    changed: dict[str, list] = {}

                    simple_fields = {
                        "title": v["title"], "description": v["description"],
                        "proposer": v["proposer"], "assignee": v["assignee"],
                        "external_req_no": external_req_no, "planned_version": planned_version,
                        "remark": remark,
                    }
                    for field, new_val in simple_fields.items():
                        old_val = str(old.get(field, "") or "").strip()
                        if new_val != old_val:
                            updates[field] = new_val
                            changed[field] = [old_val, new_val]

                    if v["category"] != str(old.get("category", "") or "").strip():
                        updates["category"] = v["category"]
                        changed["category"] = [str(old.get("category", "")), v["category"]]
                    if v["value"] != str(old.get("value", "") or "").strip():
                        updates["value"] = v["value"]
                        changed["value"] = [str(old.get("value", "")), v["value"]]
                    if v["priority"] != old["priority"]:
                        updates["priority"] = v["priority"]
                        changed["priority"] = [old["priority"], v["priority"]]

                    if related_issues != (old.get("related_issues") or []):
                        updates["related_issues"] = psycopg.types.json.Jsonb(related_issues)
                        changed["related_issues"] = [old.get("related_issues") or [], related_issues]

                    if v["planned_date"] != old.get("planned_date"):
                        updates["planned_date"] = v["planned_date"]
                        changed["planned_date"] = [str(old.get("planned_date") or ""), str(v["planned_date"] or "")]

                    from_status = None
                    to_status = None
                    if v["status"]:
                        old_status = str(old.get("status", "") or "").strip()
                        if v["status"] != old_status:
                            updates["status"] = v["status"]
                            from_status = old_status
                            to_status = v["status"]

                    if updates:
                        set_parts = [f"{k} = %s" for k in updates]
                        set_parts.append("updated_at = NOW()")
                        vals = list(updates.values())
                        vals.append(req_id)
                        conn.execute(
                            f"UPDATE requirement SET {', '.join(set_parts)} WHERE id = %s",
                            tuple(vals),
                        )
                        action = "status_changed" if to_status else "updated"
                        conn.execute(
                            """
                            INSERT INTO requirement_log (requirement_id, action, from_status, to_status, changed_fields, operator_id, operator_name, comment)
                            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                            """,
                            (req_id, action, from_status, to_status, psycopg.types.json.Jsonb(changed) if changed else None, op, operator_disp, ""),
                        )
                        updated_count += 1
                else:
                    # 新增模式
                    req_no_final = str(row_data.get("需求编号", "")).strip()
                    if not req_no_final:
                        req_no_final = _allocate_requirement_no(conn)

                    status_final = v["status"] or "待分析"

                    conn.execute(
                        """
                        INSERT INTO requirement (
                          requirement_no, title, description, proposer, assignee,
                          related_issues, external_req_no, planned_version, planned_date,
                          priority, category, value, remark, status, creator_id, creator_name
                        )
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            req_no_final, v["title"], v["description"], v["proposer"], v["assignee"],
                            psycopg.types.json.Jsonb(related_issues), external_req_no, planned_version, v["planned_date"],
                            v["priority"], v["category"], v["value"], remark, status_final, op, operator_disp,
                        ),
                    )
                    # 获取新增的ID用于写日志
                    new_row = conn.execute(
                        "SELECT id FROM requirement WHERE requirement_no = %s",
                        (req_no_final,),
                    ).fetchone()
                    if new_row:
                        conn.execute(
                            """
                            INSERT INTO requirement_log (requirement_id, action, to_status, operator_id, operator_name, comment)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            """,
                            (new_row["id"], "created", status_final, op, operator_disp, ""),
                        )
                    created_count += 1

            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"导入失败：{str(e)}") from e

    total = created_count + updated_count
    return {
        "success": True,
        "total": total,
        "created": created_count,
        "updated": updated_count,
        "message": f"成功导入{total}条需求（新增{created_count}条，更新{updated_count}条）"
    }