from __future__ import annotations

from typing import Any

import psycopg
from psycopg.errors import UndefinedTable

from fastapi import APIRouter, HTTPException

from database import db_conn
from utils import parse_ymd as _parse_ymd
from whitelist_policy import whitelist_field_levels, whitelist_permission_level

_SCHEMA_HINT = "请在数据库执行 db/migrations/0053_site_profile.sql"

# (字段key, 类型) —— 顺序即列表/导出的列顺序，共 28 个业务字段
SITE_PROFILE_FIELDS: list[tuple[str, str]] = [
    ("site_name", "text"),
    ("profile_type", "text"),
    ("product_component", "text"),
    ("onsite_contract", "text"),
    ("industry", "text"),
    ("region", "text"),
    ("representative_office", "text"),
    ("stage", "text"),
    ("tags", "text"),
    ("delivery_method", "text"),
    ("report_date", "date"),
    ("report_nature", "text"),
    ("ops_personnel", "text"),
    ("kernel_delivery", "text"),
    ("kernel_maintenance", "text"),
    ("service_support", "text"),
    ("tech_lead", "text"),
    ("da", "text"),
    ("sa", "text"),
    ("td", "text"),
    ("account_manager", "text"),
    ("project_manager", "text"),
    ("service_manager", "text"),
    ("software_revenue", "text"),
    ("service_revenue", "text"),
    ("confirm_receipt_time", "date"),
    ("risk_description", "text"),
    ("dtrb_conclusion", "text"),
]

_FIELD_KEYS = [k for k, _ in SITE_PROFILE_FIELDS]
_FIELD_TYPES = dict(SITE_PROFILE_FIELDS)
_SELECT_COLS = (
    "id, "
    + ", ".join(_FIELD_KEYS)
    + ", creator_id, creator_name, created_at, updated_at"
)

# 关键词搜索覆盖的文本字段
_SEARCH_FIELDS = [
    "site_name", "profile_type", "product_component", "industry", "region",
    "representative_office", "stage", "tags", "ops_personnel", "account_manager",
    "project_manager", "service_manager", "risk_description", "dtrb_conclusion",
]

router = APIRouter(prefix="/api/site-profiles", tags=["site-profiles"])


def _require_list_access(conn: psycopg.Connection, operator_id: str) -> None:
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "site_profile_list") == "hidden":
        raise HTTPException(status_code=403, detail="无局点档案查看权限")


def _require_create_access(conn: psycopg.Connection, operator_id: str) -> None:
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "site_profile_create") == "hidden":
        raise HTTPException(status_code=403, detail="无局点档案编辑权限")


def _require_export_access(conn: psycopg.Connection, operator_id: str) -> None:
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "site_profile_export") == "hidden":
        raise HTTPException(status_code=403, detail="无局点档案导出权限")


def _require_import_access(conn: psycopg.Connection, operator_id: str) -> None:
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "site_profile_import") == "hidden":
        raise HTTPException(status_code=403, detail="无局点档案导入权限")


def _coerce_field(key: str, raw: Any):
    """按字段类型转换 payload 值；日期字段空值返回 None。"""
    if _FIELD_TYPES[key] == "date":
        s = str(raw or "").strip()
        return _parse_ymd(s, key) if s else None
    return str(raw or "").strip()


def _display_name(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute(
        "SELECT user_name FROM user_account WHERE account = %s", (acc,)
    ).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _build_search_where(q: str) -> tuple[str, list]:
    qq = str(q or "").strip()
    if not qq:
        return "1=1", []
    pat = f"%{qq}%"
    clause = "(" + " OR ".join(f"{f} ILIKE %s" for f in _SEARCH_FIELDS) + ")"
    return clause, [pat] * len(_SEARCH_FIELDS)


@router.get("")
def list_site_profiles(
    operator_id: str = "demo_001",
    q: str = "",
    page: int = 1,
    page_size: int = 10,
) -> dict:
    _ = operator_id.strip() or "demo_001"
    pg = max(1, page)
    ps = max(1, min(100, page_size))
    offset = (pg - 1) * ps
    where, params = _build_search_where(q)

    try:
        with db_conn() as conn:
            _require_list_access(conn, operator_id)
            count_row = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM site_profile WHERE {where}",
                tuple(params),
            ).fetchone()
            total = int(count_row["cnt"] or 0)
            rows = conn.execute(
                f"""
                SELECT {_SELECT_COLS}
                FROM site_profile
                WHERE {where}
                ORDER BY created_at DESC, id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [ps, offset]),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    return {"items": rows, "total": total, "page": pg, "page_size": ps}


@router.get("/export")
def export_site_profiles(operator_id: str = "demo_001", q: str = "") -> dict:
    _ = operator_id.strip() or "demo_001"
    where, params = _build_search_where(q)

    try:
        with db_conn() as conn:
            _require_export_access(conn, operator_id)
            rows = conn.execute(
                f"""
                SELECT {_SELECT_COLS}
                FROM site_profile
                WHERE {where}
                ORDER BY created_at DESC, id DESC
                """,
                tuple(params),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    return {"items": rows, "total": len(rows)}


@router.get("/{profile_id}")
def get_site_profile(profile_id: int, operator_id: str = "demo_001") -> dict:
    _ = operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_list_access(conn, operator_id)
            row = conn.execute(
                f"SELECT {_SELECT_COLS} FROM site_profile WHERE id = %s",
                (profile_id,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    if not row:
        raise HTTPException(status_code=404, detail="局点档案不存在")
    return row


@router.post("")
def create_site_profile(payload: dict) -> dict:
    operator_id = str(payload.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if not str(payload.get("site_name", "")).strip():
        raise HTTPException(status_code=400, detail="局点名称不能为空")

    values = {k: _coerce_field(k, payload.get(k)) for k in _FIELD_KEYS}

    try:
        with db_conn() as conn:
            _require_create_access(conn, operator_id)
            creator_name = _display_name(conn, operator_id) or operator_id
            cols = _FIELD_KEYS + ["creator_id", "creator_name"]
            placeholders = ", ".join(["%s"] * len(cols))
            params = [values[k] for k in _FIELD_KEYS] + [operator_id, creator_name]
            new_id = conn.execute(
                f"INSERT INTO site_profile ({', '.join(cols)}) VALUES ({placeholders}) RETURNING id",
                tuple(params),
            ).fetchone()["id"]
            row = conn.execute(
                f"SELECT {_SELECT_COLS} FROM site_profile WHERE id = %s",
                (new_id,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    return row


@router.patch("/{profile_id}")
def update_site_profile(profile_id: int, payload: dict) -> dict:
    operator_id = str(payload.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if "site_name" in payload and not str(payload.get("site_name", "")).strip():
        raise HTTPException(status_code=400, detail="局点名称不能为空")

    updates: list[str] = []
    params: list = []
    for key in _FIELD_KEYS:
        if key in payload:
            updates.append(f"{key} = %s")
            params.append(_coerce_field(key, payload.get(key)))
    if not updates:
        raise HTTPException(status_code=400, detail="无更新字段")

    try:
        with db_conn() as conn:
            _require_create_access(conn, operator_id)
            existing = conn.execute(
                "SELECT id FROM site_profile WHERE id = %s", (profile_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="局点档案不存在")
            conn.execute(
                f"UPDATE site_profile SET {', '.join(updates)} WHERE id = %s",
                tuple(params + [profile_id]),
            )
            row = conn.execute(
                f"SELECT {_SELECT_COLS} FROM site_profile WHERE id = %s",
                (profile_id,),
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    return row


@router.post("/bulk-delete")
def bulk_delete_site_profiles(payload: dict) -> dict:
    operator_id = str(payload.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    raw_ids = payload.get("profile_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(status_code=400, detail="profile_ids 不能为空")
    ids: list[int] = []
    seen: set[int] = set()
    for raw in raw_ids:
        try:
            pid = int(raw)
        except (TypeError, ValueError):
            continue
        if pid <= 0 or pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)
    if not ids:
        raise HTTPException(status_code=400, detail="profile_ids 无有效 ID")

    try:
        with db_conn() as conn:
            _require_create_access(conn, operator_id)
            present_rows = conn.execute(
                "SELECT id FROM site_profile WHERE id = ANY(%s)",
                (ids,),
            ).fetchall()
            in_db = {int(r["id"]) for r in present_rows}
            absent = [pid for pid in ids if pid not in in_db]
            cur = conn.execute(
                "DELETE FROM site_profile WHERE id = ANY(%s) RETURNING id",
                (list(in_db),),
            )
            deleted_rows = cur.fetchall()
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    deleted = [int(r["id"]) for r in deleted_rows]
    return {"ok": True, "deleted": deleted, "absent": absent}


@router.delete("/{profile_id}")
def delete_site_profile(profile_id: int, operator_id: str = "demo_001") -> dict:
    op = operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            _require_create_access(conn, op)
            existing = conn.execute(
                "SELECT id FROM site_profile WHERE id = %s", (profile_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="局点档案不存在")
            conn.execute("DELETE FROM site_profile WHERE id = %s", (profile_id,))
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    return {"id": profile_id, "deleted": True}


@router.post("/import")
def import_site_profiles(payload: dict) -> dict:
    """批量导入局点档案。payload.items 为前端解析后的行数组。"""
    operator_id = str(payload.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="导入数据为空")

    rows_values: list[list] = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail=f"第 {idx + 1} 行格式错误")
        if not str(item.get("site_name", "")).strip():
            raise HTTPException(status_code=400, detail=f"第 {idx + 1} 行局点名称不能为空")
        rows_values.append([_coerce_field(k, item.get(k)) for k in _FIELD_KEYS])

    try:
        with db_conn() as conn:
            _require_import_access(conn, operator_id)
            creator_name = _display_name(conn, operator_id) or operator_id
            cols = _FIELD_KEYS + ["creator_id", "creator_name"]
            placeholders = ", ".join(["%s"] * len(cols))
            with conn.cursor() as cur:
                cur.executemany(
                    f"INSERT INTO site_profile ({', '.join(cols)}) VALUES ({placeholders})",
                    [tuple(vals + [operator_id, creator_name]) for vals in rows_values],
                )
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点档案表未就绪：{_SCHEMA_HINT}") from exc

    return {"imported": len(rows_values)}
