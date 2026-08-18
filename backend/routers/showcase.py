from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from psycopg.errors import UndefinedColumn, UndefinedTable
from pydantic import BaseModel

from database import db_conn
from utils.minio_storage import delete_object
from utils.api_guard import require_whitelist
from utils.operator_auth import resolve_operator_id
from whitelist_policy import whitelist_delete_allowed


router = APIRouter(prefix="/api/showcase", tags=["showcase"])

_TITLE_MAX_LEN = 160
_DETAIL_MAX_LEN = 100_000
_IMAGE_URL_MAX_LEN = 2_000
_SCHEMA_HINT = "请先执行 db/migrations/0116_showcase_item.sql 与 0119_showcase_item_event_date.sql"
_EVENT_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ShowcaseCreateRequest(BaseModel):
    operator_id: str = "demo_001"
    title: str
    event_date: str
    detail_html: str
    image_url: str
    image_object_name: str = ""


def _schema_error() -> HTTPException:
    return HTTPException(status_code=503, detail=f"展示效果数据表未就绪：{_SCHEMA_HINT}")


def _item_to_dict(row: Any) -> dict[str, Any]:
    event_date = row["event_date"]
    if isinstance(event_date, datetime):
        event_date_value = event_date.date().isoformat()
    elif isinstance(event_date, date):
        event_date_value = event_date.isoformat()
    else:
        event_date_value = str(event_date or "")
    return {
        "id": int(row["id"]),
        "title": str(row["title"] or ""),
        "event_date": event_date_value,
        "detail_html": str(row["detail_html"] or ""),
        "image_url": str(row["image_url"] or ""),
        "image_object_name": str(row["image_object_name"] or ""),
        "created_by": str(row["created_by"] or ""),
        "created_at": row["created_at"].isoformat() if row["created_at"] else "",
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else "",
    }


def _normalize_title(raw: str) -> str:
    title = str(raw or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="请填写标题")
    if len(title) > _TITLE_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"标题不能超过 {_TITLE_MAX_LEN} 个字符")
    return title


def _normalize_detail(raw: str) -> str:
    detail = str(raw or "").strip()
    if not detail:
        raise HTTPException(status_code=400, detail="请填写正文")
    if len(detail) > _DETAIL_MAX_LEN:
        raise HTTPException(status_code=400, detail="正文内容过长")
    plain = re.sub(r"<[^>]*>", "", detail).replace("&nbsp;", " ").strip()
    if not plain and not re.search(r"<img\b", detail, flags=re.IGNORECASE):
        raise HTTPException(status_code=400, detail="请填写正文")
    return detail


def _normalize_image_url(raw: str) -> str:
    url = str(raw or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="请上传展示图片")
    if len(url) > _IMAGE_URL_MAX_LEN:
        raise HTTPException(status_code=400, detail="图片地址过长")
    if not (url.startswith("http://") or url.startswith("https://") or url.startswith("/")):
        raise HTTPException(status_code=400, detail="图片地址格式不正确")
    return url


def _normalize_event_date(raw: str) -> date:
    text = str(raw or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="请填写时间")
    if not _EVENT_DATE_RE.match(text):
        raise HTTPException(status_code=400, detail="时间格式须为年月日（YYYY-MM-DD）")
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="时间格式不正确") from exc


@router.get("")
def list_showcase_items(request: Request, operator_id: str = "demo_001") -> dict[str, Any]:
    try:
        with db_conn() as conn:
            op = resolve_operator_id(request, operator_id)
            require_whitelist(conn, op, "showcase_page", "无 GaussDB 大事件权限")
            rows = conn.execute(
                """
                SELECT id, title, event_date, detail_html, image_url, image_object_name,
                       created_by, created_at, updated_at
                FROM showcase_item
                ORDER BY event_date ASC, id ASC
                """
            ).fetchall()
    except (UndefinedTable, UndefinedColumn) as exc:
        raise _schema_error() from exc
    return {"items": [_item_to_dict(row) for row in rows]}


@router.post("", status_code=201)
def create_showcase_item(body: ShowcaseCreateRequest, request: Request) -> dict[str, Any]:
    title = _normalize_title(body.title)
    event_date = _normalize_event_date(body.event_date)
    detail_html = _normalize_detail(body.detail_html)
    image_url = _normalize_image_url(body.image_url)
    operator_id = resolve_operator_id(request, body.operator_id)
    object_name = str(body.image_object_name or "").strip()
    try:
        with db_conn() as conn:
            require_whitelist(conn, operator_id, "showcase_add", "无新增展示权限")
            row = conn.execute(
                """
                INSERT INTO showcase_item (
                  title, event_date, detail_html, image_url, image_object_name, created_by
                ) VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, title, event_date, detail_html, image_url, image_object_name,
                          created_by, created_at, updated_at
                """,
                (title, event_date, detail_html, image_url, object_name, operator_id),
            ).fetchone()
    except (UndefinedTable, UndefinedColumn) as exc:
        raise _schema_error() from exc
    return {"ok": True, "item": _item_to_dict(row)}


@router.delete("/{item_id}")
def delete_showcase_item(item_id: int, request: Request, operator_id: str = "demo_001") -> dict[str, Any]:
    try:
        with db_conn() as conn:
            operator_id = resolve_operator_id(request, operator_id)
            if not whitelist_delete_allowed(conn, operator_id, "showcase_add"):
                raise HTTPException(status_code=403, detail="无 GaussDB 大事件删除权限")
            row = conn.execute(
                "SELECT id, image_object_name FROM showcase_item WHERE id = %s",
                (item_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="展示内容不存在")
            conn.execute("DELETE FROM showcase_item WHERE id = %s", (item_id,))
            conn.commit()
    except UndefinedTable as exc:
        raise _schema_error() from exc

    delete_object(object_name=str(row["image_object_name"] or ""))
    return {"ok": True, "id": item_id}
