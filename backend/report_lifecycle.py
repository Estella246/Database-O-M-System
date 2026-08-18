"""月度报告与改进报告共用的草稿/归档生命周期。

两类报告表（monthly_report / improvement_report）列结构同形：
report_month 唯一 / title / status(draft|archived) / archived_at / section_* JSONB / 时间戳。
本模块以 ReportSpec 参数化差异（表名/标签/默认标题后缀/段列映射/迁移提示），
生命周期操作（取或初始化/分段保存/归档/取消归档/列表/删除）唯一实现，
两路由只做薄委托——行为漂移（如 409/404 语义、JSONB 落库方式）在此收敛。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import HTTPException

from database import db_conn

_MONTH_RE = re.compile(r"^[0-9]{6}$")


@dataclass(frozen=True)
class ReportSpec:
    """一类报告的差异参数；section key → 表列名的映射由各路由的前端契约决定。"""

    table: str                        # monthly_report / improvement_report
    label: str                        # 「月度报告」/「改进报告」（错误提示用）
    default_title_suffix: str         # 默认标题 = f"{ym}{suffix}"（月报 / 改进报告）
    section_cols: dict[str, str]      # section key → section_* 列名
    schema_hint: str                  # 表未就绪时提示执行的迁移脚本


def validate_month(ym: str) -> str:
    s = (ym or "").strip()
    if not _MONTH_RE.match(s):
        raise HTTPException(status_code=400, detail="report_month 格式应为 YYYYMM (如 202608)")
    year = int(s[:4])
    month = int(s[4:])
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="report_month 月份取值非法")
    if year < 2000 or year > 2999:
        raise HTTPException(status_code=400, detail="report_month 年份取值非法")
    return s


def row_to_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.astimezone(timezone.utc).isoformat()
        else:
            out[key] = value
    return out


def wrap_schema_error(spec: ReportSpec, exc: psycopg.Error) -> HTTPException:
    return HTTPException(
        status_code=500, detail=f"{spec.label}表未就绪：{exc.__class__.__name__}. {spec.schema_hint}"
    )


def default_title(spec: ReportSpec, ym: str) -> str:
    return f"{ym}{spec.default_title_suffix}"


def ensure_report(conn: psycopg.Connection, spec: ReportSpec, ym: str) -> dict[str, Any]:
    """按月取报告行；不存在则插入空骨架草稿（并发下 ON CONFLICT DO NOTHING 兜底）。"""
    row = conn.execute(
        f"SELECT * FROM {spec.table} WHERE report_month = %s", (ym,),
    ).fetchone()
    if row is not None:
        return row_to_dict(row)  # type: ignore[return-value]
    conn.execute(
        f"""
        INSERT INTO {spec.table} (report_month, title, status)
        VALUES (%s, %s, 'draft')
        ON CONFLICT (report_month) DO NOTHING
        """,
        (ym, default_title(spec, ym)),
    )
    row = conn.execute(
        f"SELECT * FROM {spec.table} WHERE report_month = %s", (ym,),
    ).fetchone()
    return row_to_dict(row)  # type: ignore[return-value]


def get_or_init(spec: ReportSpec, ym: str) -> dict[str, Any]:
    try:
        with db_conn() as conn:
            data = ensure_report(conn, spec, ym)
            conn.commit()
            return data
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise wrap_schema_error(spec, exc)


def update_section(spec: ReportSpec, ym: str, section: str, data: Any) -> dict[str, Any]:
    section = (section or "").strip()
    col = spec.section_cols.get(section)
    if not col:
        raise HTTPException(status_code=400, detail=f"未知 section：{section}")
    try:
        with db_conn() as conn:
            ensure_report(conn, spec, ym)
            row = conn.execute(
                f"SELECT status FROM {spec.table} WHERE report_month = %s", (ym,),
            ).fetchone()
            if row and row.get("status") == "archived":
                raise HTTPException(status_code=409, detail="报告已归档，无法编辑；请先取消归档")
            data_json = json.dumps(data or {}, ensure_ascii=False)
            conn.execute(
                f"UPDATE {spec.table} SET {col} = %s::jsonb WHERE report_month = %s",
                (data_json, ym),
            )
            conn.commit()
            row = conn.execute(
                f"SELECT * FROM {spec.table} WHERE report_month = %s", (ym,),
            ).fetchone()
            return row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise wrap_schema_error(spec, exc)


def archive(spec: ReportSpec, ym: str, title: str) -> dict[str, Any]:
    try:
        with db_conn() as conn:
            ensure_report(conn, spec, ym)
            t = (title or "").strip() or default_title(spec, ym)
            conn.execute(
                f"""
                UPDATE {spec.table}
                   SET status = 'archived', archived_at = NOW(), title = %s
                 WHERE report_month = %s
                """,
                (t, ym),
            )
            conn.commit()
            row = conn.execute(
                f"SELECT * FROM {spec.table} WHERE report_month = %s", (ym,),
            ).fetchone()
            return row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise wrap_schema_error(spec, exc)


def unarchive(spec: ReportSpec, ym: str) -> dict[str, Any]:
    try:
        with db_conn() as conn:
            row = conn.execute(
                f"SELECT id FROM {spec.table} WHERE report_month = %s", (ym,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="报告不存在")
            conn.execute(
                f"UPDATE {spec.table} SET status='draft', archived_at=NULL WHERE report_month=%s",
                (ym,),
            )
            conn.commit()
            row = conn.execute(
                f"SELECT * FROM {spec.table} WHERE report_month = %s", (ym,),
            ).fetchone()
            return row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise wrap_schema_error(spec, exc)


def list_reports(spec: ReportSpec, status: str) -> dict[str, Any]:
    status = (status or "").strip()
    if status and status not in ("draft", "archived"):
        raise HTTPException(status_code=400, detail="status 只能是 draft 或 archived")
    try:
        with db_conn() as conn:
            sql = f"""
                SELECT report_month, title, status, archived_at, created_at, updated_at
                  FROM {spec.table}
            """
            args: list[Any] = []
            if status:
                sql += " WHERE status = %s"
                args.append(status)
            sql += " ORDER BY report_month DESC"
            rows = conn.execute(sql, tuple(args)).fetchall()
            return {"items": [row_to_dict(r) for r in rows]}
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise wrap_schema_error(spec, exc)


def delete(spec: ReportSpec, ym: str) -> dict[str, Any]:
    try:
        with db_conn() as conn:
            row = conn.execute(
                f"SELECT status FROM {spec.table} WHERE report_month=%s", (ym,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="报告不存在")
            if row.get("status") == "archived":
                raise HTTPException(status_code=409, detail="已归档报告不可删除，请先取消归档")
            conn.execute(f"DELETE FROM {spec.table} WHERE report_month=%s", (ym,))
            conn.commit()
            return {"deleted": ym}
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise wrap_schema_error(spec, exc)
