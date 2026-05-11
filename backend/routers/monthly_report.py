"""现网重大问题月度分析报告路由：

- GET    /api/monthly-report/{ym}           获取或初始化指定月份草稿（不存在自动创建空骨架）
- PUT    /api/monthly-report/{ym}/sections  分段保存（覆盖式）
- POST   /api/monthly-report/{ym}/archive   归档（status=archived，archived_at=now）
- DELETE /api/monthly-report/{ym}/archive   取消归档（回到 draft）
- GET    /api/monthly-report                列表（按 status 过滤，archived 默认按月降序）

报告内容五段以 JSONB 存储，section key 与前端约定一致：
  overview / insight / major / improve / links
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Query

from database import db_conn
from models import MonthlyReportSectionPutPayload, MonthlyReportArchivePayload

_SCHEMA_HINT = "请在数据库执行 db/migrations/0036_monthly_report.sql"
_MONTH_RE = re.compile(r"^[0-9]{6}$")
_SECTION_COLS = {
    "overview": "section_overview",
    "insight": "section_insight",
    "major": "section_major",
    "improve": "section_improve",
    "links": "section_links",
}

router = APIRouter(prefix="/api/monthly-report", tags=["monthly-report"])


def _validate_month(ym: str) -> str:
    s = (ym or "").strip()
    if not _MONTH_RE.match(s):
        raise HTTPException(status_code=400, detail="report_month 格式应为 YYYYMM (如 202604)")
    year = int(s[:4])
    month = int(s[4:])
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="report_month 月份取值非法")
    if year < 2000 or year > 2999:
        raise HTTPException(status_code=400, detail="report_month 年份取值非法")
    return s


def _row_to_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.astimezone(timezone.utc).isoformat()
        else:
            out[key] = value
    return out


def _ensure_report(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM monthly_report WHERE report_month = %s",
        (ym,),
    ).fetchone()
    if row is not None:
        return _row_to_dict(row)  # type: ignore[return-value]
    conn.execute(
        """
        INSERT INTO monthly_report (report_month, title, status)
        VALUES (%s, %s, 'draft')
        ON CONFLICT (report_month) DO NOTHING
        """,
        (ym, f"{ym}月报"),
    )
    row = conn.execute(
        "SELECT * FROM monthly_report WHERE report_month = %s",
        (ym,),
    ).fetchone()
    return _row_to_dict(row)  # type: ignore[return-value]


def _wrap_schema_error(exc: psycopg.Error) -> HTTPException:
    return HTTPException(status_code=500, detail=f"月度报告表未就绪：{exc.__class__.__name__}. {_SCHEMA_HINT}")


@router.get("/{ym}")
def get_or_init_report(ym: str) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            data = _ensure_report(conn, ym)
            conn.commit()
            return data
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.put("/{ym}/sections")
def update_section(ym: str, payload: MonthlyReportSectionPutPayload) -> dict[str, Any]:
    ym = _validate_month(ym)
    section = (payload.section or "").strip()
    col = _SECTION_COLS.get(section)
    if not col:
        raise HTTPException(status_code=400, detail=f"未知 section：{section}")
    try:
        with db_conn() as conn:
            _ensure_report(conn, ym)
            row = conn.execute(
                "SELECT status FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            if row and row.get("status") == "archived":
                raise HTTPException(status_code=409, detail="报告已归档，无法编辑；请先取消归档")
            data_json = json.dumps(payload.data or {}, ensure_ascii=False)
            conn.execute(
                f"UPDATE monthly_report SET {col} = %s::jsonb WHERE report_month = %s",
                (data_json, ym),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            return _row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.post("/{ym}/archive")
def archive_report(ym: str, payload: MonthlyReportArchivePayload) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            _ensure_report(conn, ym)
            title = (payload.title or "").strip() or f"{ym}月报"
            conn.execute(
                """
                UPDATE monthly_report
                   SET status = 'archived', archived_at = NOW(), title = %s
                 WHERE report_month = %s
                """,
                (title, ym),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            return _row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.delete("/{ym}/archive")
def unarchive_report(ym: str) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT id FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="报告不存在")
            conn.execute(
                "UPDATE monthly_report SET status='draft', archived_at=NULL WHERE report_month=%s",
                (ym,),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            return _row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.get("")
def list_reports(status: str = Query("", description="draft / archived / 空=全部")) -> dict[str, Any]:
    status = (status or "").strip()
    if status and status not in ("draft", "archived"):
        raise HTTPException(status_code=400, detail="status 只能是 draft 或 archived")
    try:
        with db_conn() as conn:
            sql = """
                SELECT report_month, title, status, archived_at, created_at, updated_at
                  FROM monthly_report
            """
            args: list[Any] = []
            if status:
                sql += " WHERE status = %s"
                args.append(status)
            sql += " ORDER BY report_month DESC"
            rows = conn.execute(sql, tuple(args)).fetchall()
            return {"items": [_row_to_dict(r) for r in rows]}
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.delete("/{ym}")
def delete_report(ym: str) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT status FROM monthly_report WHERE report_month=%s",
                (ym,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="报告不存在")
            if row.get("status") == "archived":
                raise HTTPException(status_code=409, detail="已归档报告不可删除，请先取消归档")
            conn.execute("DELETE FROM monthly_report WHERE report_month=%s", (ym,))
            conn.commit()
            return {"deleted": ym}
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)
