from __future__ import annotations

import logging
import os
import re
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from database import db_conn
from utils.minio_storage import minio_config, presigned_download_url, upload_bytes
from utils.ops_tool_zip import find_skill_md_in_zip, make_skill_md_excerpt
from whitelist_policy import whitelist_field_levels, whitelist_permission_level

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ops-tool-plaza", tags=["ops-tool-plaza"])

_USAGE_MD_MAX_LEN = 20000
_SCHEMA_HINT = "请在数据库执行 db/migrations/0097_ops_tool_plaza.sql 与 0098_ops_tool_usage_md.sql"
_MAX_SKILL_ZIP_BYTES = 20 * 1024 * 1024
_MAX_TOOL_ZIP_BYTES = 50 * 1024 * 1024
_CATEGORY_MAX_LEN = 64
_TITLE_MAX_LEN = 128


def _schema_error(exc: UndefinedTable) -> HTTPException:
    return HTTPException(status_code=503, detail=f"运维工具广场表未就绪：{_SCHEMA_HINT}")


def _minio_not_configured_detail() -> str:
    return "MinIO 未配置，请设置 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET"


def _require_list_access(conn: psycopg.Connection, operator_id: str) -> None:
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "tool_plaza_list") == "hidden":
        raise HTTPException(status_code=403, detail="无运维工具广场查看权限")


def _require_publish_access(conn: psycopg.Connection, operator_id: str) -> None:
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "tool_plaza_publish") == "hidden":
        raise HTTPException(status_code=403, detail="无运维工具广场发布权限")


def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute("SELECT user_name FROM user_account WHERE account = %s", (acc,)).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _normalize_category(raw: str) -> str:
    cat = re.sub(r"\s+", " ", str(raw or "").strip())
    if not cat:
        raise HTTPException(status_code=400, detail="请填写或选择分类")
    if len(cat) > _CATEGORY_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"分类不能超过 {_CATEGORY_MAX_LEN} 个字符")
    return cat


def _normalize_title(raw: str) -> str:
    title = str(raw or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="请填写标题")
    if len(title) > _TITLE_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"标题不能超过 {_TITLE_MAX_LEN} 个字符")
    return title


def _normalize_usage_md(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="请填写使用方式")
    if len(text) > _USAGE_MD_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"使用方式不能超过 {_USAGE_MD_MAX_LEN} 个字符")
    return text


def _item_row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "item_type": str(row["item_type"] or ""),
        "title": str(row["title"] or ""),
        "category": str(row["category"] or ""),
        "file_name": str(row["file_name"] or ""),
        "file_size": int(row["file_size"] or 0),
        "skill_md_excerpt": str(row["skill_md_excerpt"] or ""),
        "usage_md_excerpt": str(row["usage_md_excerpt"] or ""),
        "download_count": int(row["download_count"] or 0),
        "publisher_id": str(row["publisher_id"] or ""),
        "publisher_name": str(row["publisher_name"] or ""),
        "created_at": row["created_at"].isoformat() if row["created_at"] else "",
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else "",
    }


def _item_detail_to_dict(row: Any) -> dict[str, Any]:
    d = _item_row_to_dict(row)
    d["skill_md_content"] = str(row["skill_md_content"] or "") if row["item_type"] == "skill" else ""
    d["usage_md"] = str(row["usage_md"] or "")
    return d


@router.get("/categories")
def list_categories(operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        _require_list_access(conn, operator_id)
        try:
            rows = conn.execute(
                """
                SELECT DISTINCT category
                FROM ops_tool_item
                WHERE category <> ''
                ORDER BY category
                """
            ).fetchall()
        except UndefinedTable as e:
            raise _schema_error(e) from e
    return {"items": [str(r["category"]) for r in rows]}


@router.get("/items")
def list_items(
    operator_id: str = "demo_001",
    item_type: str = "",
    category: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    page = max(1, int(page or 1))
    page_size = min(100, max(1, int(page_size or 20)))
    offset = (page - 1) * page_size

    clauses = ["1=1"]
    params: list[Any] = []

    it = str(item_type or "").strip().lower()
    if it in ("skill", "tool"):
        clauses.append("item_type = %s")
        params.append(it)

    cat = str(category or "").strip()
    if cat:
        clauses.append("category = %s")
        params.append(cat)

    kw = str(q or "").strip()
    if kw:
        clauses.append(
            "(title ILIKE %s OR category ILIKE %s OR skill_md_excerpt ILIKE %s "
            "OR usage_md_excerpt ILIKE %s OR publisher_name ILIKE %s)"
        )
        like = f"%{kw}%"
        params.extend([like, like, like, like, like])

    where_sql = " AND ".join(clauses)

    with db_conn() as conn:
        _require_list_access(conn, operator_id)
        try:
            total_row = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM ops_tool_item WHERE {where_sql}",
                params,
            ).fetchone()
            total = int(total_row["cnt"] or 0) if total_row else 0
            rows = conn.execute(
                f"""
                SELECT id, item_type, title, category, file_name, file_size,
                       skill_md_excerpt, usage_md_excerpt, download_count, publisher_id, publisher_name,
                       created_at, updated_at
                FROM ops_tool_item
                WHERE {where_sql}
                ORDER BY download_count DESC, created_at DESC
                LIMIT %s OFFSET %s
                """,
                [*params, page_size, offset],
            ).fetchall()
        except UndefinedTable as e:
            raise _schema_error(e) from e

    return {
        "items": [_item_row_to_dict(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/items/{item_id}")
def get_item(item_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        _require_list_access(conn, operator_id)
        try:
            row = conn.execute(
                """
                SELECT id, item_type, title, category, file_name, file_size, object_name,
                       skill_md_content, skill_md_excerpt, usage_md, usage_md_excerpt,
                       download_count, publisher_id, publisher_name, created_at, updated_at
                FROM ops_tool_item
                WHERE id = %s
                """,
                (item_id,),
            ).fetchone()
        except UndefinedTable as e:
            raise _schema_error(e) from e
    if not row:
        raise HTTPException(status_code=404, detail="资源不存在")
    return _item_detail_to_dict(row)


@router.post("/items")
async def publish_item(
    operator_id: str = "demo_001",
    item_type: str = Form(...),
    title: str = Form(...),
    category: str = Form(...),
    usage_md: str = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    it = str(item_type or "").strip().lower()
    if it not in ("skill", "tool"):
        raise HTTPException(status_code=400, detail="类型须为 skill 或 tool")

    norm_title = _normalize_title(title)
    norm_category = _normalize_category(category)
    norm_usage_md = _normalize_usage_md(usage_md)
    usage_md_excerpt = make_skill_md_excerpt(norm_usage_md)

    file_name = os.path.basename(str(file.filename or "file.zip").strip()) or "file.zip"
    if not file_name.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 .zip 文件")

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="空文件")

    max_bytes = _MAX_SKILL_ZIP_BYTES if it == "skill" else _MAX_TOOL_ZIP_BYTES
    if len(body) > max_bytes:
        raise HTTPException(status_code=400, detail=f"文件大小不能超过 {max_bytes // (1024 * 1024)}MB")

    if not minio_config():
        raise HTTPException(status_code=503, detail=_minio_not_configured_detail())

    skill_md_content: str | None = None
    skill_md_excerpt: str | None = None
    if it == "skill":
        skill_md_content = find_skill_md_in_zip(body)
        if not skill_md_content or not skill_md_content.strip():
            raise HTTPException(status_code=400, detail="zip 中未找到 SKILL.md，请上传包含 SKILL.md 的文件夹压缩包")
        skill_md_excerpt = make_skill_md_excerpt(skill_md_content)

    try:
        uploaded = upload_bytes(
            body=body,
            content_type="application/zip",
            object_prefix=f"ops-tool-plaza/{it}",
            ext=".zip",
        )
    except ValueError as e:
        if str(e).startswith("MINIO_NOT_CONFIGURED"):
            raise HTTPException(status_code=503, detail=_minio_not_configured_detail()) from e
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("ops tool plaza upload failed: %s", e)
        raise HTTPException(status_code=502, detail="文件上传失败") from e

    with db_conn() as conn:
        _require_publish_access(conn, operator_id)
        publisher_name = _display_name_account(conn, operator_id)
        try:
            row = conn.execute(
                """
                INSERT INTO ops_tool_item (
                  item_type, title, category, file_name, object_name, file_size,
                  skill_md_content, skill_md_excerpt, usage_md, usage_md_excerpt,
                  publisher_id, publisher_name
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, item_type, title, category, file_name, file_size,
                          skill_md_excerpt, usage_md_excerpt, download_count, publisher_id, publisher_name,
                          created_at, updated_at
                """,
                (
                    it,
                    norm_title,
                    norm_category,
                    file_name,
                    uploaded["object_name"],
                    len(body),
                    skill_md_content,
                    skill_md_excerpt,
                    norm_usage_md,
                    usage_md_excerpt,
                    operator_id,
                    publisher_name,
                ),
            ).fetchone()
            conn.commit()
        except UndefinedTable as e:
            raise _schema_error(e) from e

    logger.info(
        "ops tool plaza published: id=%s type=%s title=%s object=%s",
        row["id"],
        it,
        norm_title,
        uploaded["object_name"],
    )
    return _item_row_to_dict(row)


@router.post("/items/{item_id}/download")
def download_item(item_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        _require_list_access(conn, operator_id)
        try:
            row = conn.execute(
                """
                SELECT id, object_name, file_name, download_count
                FROM ops_tool_item
                WHERE id = %s
                """,
                (item_id,),
            ).fetchone()
        except UndefinedTable as e:
            raise _schema_error(e) from e

        if not row:
            raise HTTPException(status_code=404, detail="资源不存在")

        dedup = conn.execute(
            """
            SELECT 1
            FROM ops_tool_download_log
            WHERE item_id = %s AND operator_id = %s
              AND created_at > NOW() - INTERVAL '24 hours'
            LIMIT 1
            """,
            (item_id, operator_id),
        ).fetchone()

        new_count = int(row["download_count"] or 0)
        if not dedup:
            conn.execute(
                "UPDATE ops_tool_item SET download_count = download_count + 1 WHERE id = %s",
                (item_id,),
            )
            conn.execute(
                "INSERT INTO ops_tool_download_log (item_id, operator_id) VALUES (%s, %s)",
                (item_id, operator_id),
            )
            new_count += 1
        conn.commit()

    if not minio_config():
        raise HTTPException(status_code=503, detail=_minio_not_configured_detail())

    try:
        url = presigned_download_url(object_name=str(row["object_name"]))
    except ValueError as e:
        if str(e).startswith("MINIO_NOT_CONFIGURED"):
            raise HTTPException(status_code=503, detail=_minio_not_configured_detail()) from e
        raise
    except Exception as e:
        logger.exception("ops tool plaza presign failed: %s", e)
        raise HTTPException(status_code=502, detail="生成下载链接失败") from e

    return {
        "ok": True,
        "url": url,
        "file_name": str(row["file_name"] or "download.zip"),
        "download_count": new_count,
    }
