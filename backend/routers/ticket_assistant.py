"""提单助手：本库会话 + 九问 WebSocket BFF + 转人工建单。"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from psycopg.types.json import Jsonb

from config import JIUWEN_ENABLED, JIUWEN_TIMEOUT_SECONDS, JIUWEN_WS_URL
from database import db_conn
from models.ticket import SubmitPayload
from models.ticket_assistant import (
    TicketAssistantChatPayload,
    TicketAssistantCreatePayload,
    TicketAssistantTransferPayload,
)
from routers.tickets import (
    AMEND_EXCLUDED_FLOW_KEYS,
    SCHEMA_TEMPLATE_CODE,
    _load_schema,
    submit_node_data,
)
from utils.jiuwen_ws import (
    JiuwenWsError,
    build_form_context_message,
    jiuwen_chat,
    jiuwen_create_and_chat,
    jiuwen_history,
    jiuwen_list_models,
    make_jiuwen_session_id,
)
from whitelist_policy import ticket_assistant_transfer_allowed, whitelist_field_levels

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ticket-assistant", tags=["ticket-assistant"])

_SCHEMA_HINT = "请在数据库执行 db/migrations/0112_ticket_assistant_session.sql"
_TAG_RE = re.compile(r"<[^>]+>")


def _table_ready(conn) -> bool:
    row = conn.execute(
        """
        SELECT 1 AS ok
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ticket_assistant_session'
        LIMIT 1
        """
    ).fetchone()
    return bool(row)


def _require_table(conn) -> None:
    if not _table_ready(conn):
        raise HTTPException(status_code=503, detail=_SCHEMA_HINT)


def _strip_html(text: str) -> str:
    s = str(text or "")
    s = s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    s = _TAG_RE.sub("", s)
    return " ".join(s.split())


def _title_from_form(form_values: dict[str, Any]) -> str:
    for key in ("issue_desc", "problem_desc", "description"):
        raw = form_values.get(key)
        if raw is None:
            continue
        text = _strip_html(str(raw)).strip()
        if text:
            return text[:80]
    loc = str(form_values.get("location") or "").strip()
    if loc:
        return f"局点：{loc}"[:80]
    return "未命名会话"


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    if not row:
        return {}
    out = dict(row)
    fv = out.get("form_values")
    if fv is not None and not isinstance(fv, dict):
        try:
            out["form_values"] = dict(fv)
        except Exception:
            out["form_values"] = {}
    for key in ("created_at", "updated_at"):
        if out.get(key) is not None:
            out[key] = out[key].isoformat() if hasattr(out[key], "isoformat") else str(out[key])
    return out


def _get_owned_session(conn, session_id: int, operator_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT id, creator_id, creator_name, form_values, title, jiuwen_session_id,
               status, ticket_no, created_at, updated_at
        FROM ticket_assistant_session
        WHERE id = %s
        """,
        (session_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="会话不存在")
    if str(row.get("creator_id") or "") != operator_id:
        raise HTTPException(status_code=403, detail="无权访问该会话")
    return row


def _require_jiuwen_enabled() -> None:
    if not JIUWEN_ENABLED:
        raise HTTPException(status_code=503, detail="九问未启用（JIUWEN_ENABLED=0）")
    if not JIUWEN_WS_URL:
        raise HTTPException(status_code=503, detail="九问未配置（JIUWEN_WS_URL 为空）")


def _sanitize_form_values_for_submit(conn, form_values: dict[str, Any]) -> dict[str, Any]:
    """只保留 problem_fill schema 字段；去掉流转字段与 _ 前缀内部键（如 _preview_messages）。"""
    raw = form_values if isinstance(form_values, dict) else {}
    fields = _load_schema(conn, "problem_fill", SCHEMA_TEMPLATE_CODE)
    allowed = {str(f.get("key") or "") for f in fields if f.get("key")}
    out: dict[str, Any] = {}
    for key, value in raw.items():
        k = str(key or "")
        if not k or k.startswith("_"):
            continue
        if k in AMEND_EXCLUDED_FLOW_KEYS:
            continue
        if k not in allowed:
            continue
        out[k] = value
    return out


def _http_detail_as_text(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict):
        errors = detail.get("errors")
        if isinstance(errors, list) and errors:
            return "；".join(str(e) for e in errors if str(e).strip())
        msg = detail.get("message")
        if msg:
            return str(msg)
    if isinstance(detail, list):
        parts = []
        for item in detail:
            if isinstance(item, dict):
                parts.append(str(item.get("msg") or item.get("message") or item))
            else:
                parts.append(str(item))
        return "；".join(p for p in parts if p)
    return str(detail or "")



def _public_model_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Strip secrets from Jiuwen models.list entries before returning to UI."""
    return {
        "model_name": str(entry.get("model_name") or ""),
        "alias": str(entry.get("alias") or ""),
        "model_provider": str(entry.get("model_provider") or ""),
        "is_default": bool(entry.get("is_default")),
        "origin_index": entry.get("origin_index"),
        "temperature": entry.get("temperature"),
        "reasoning_level": entry.get("reasoning_level"),
        "context_window_tokens": entry.get("context_window_tokens"),
    }


@router.get("/models")
async def list_models(operator_id: str = "demo_001") -> dict[str, Any]:
    """Proxy Jiuwen models.list (configured default models for main chat)."""
    op = (operator_id or "").strip() or "demo_001"
    _require_jiuwen_enabled()
    try:
        raw = await jiuwen_list_models(
            ws_url=JIUWEN_WS_URL,
            user_id=op,
            timeout_seconds=min(30, JIUWEN_TIMEOUT_SECONDS),
        )
    except JiuwenWsError as exc:
        raise HTTPException(status_code=502, detail=f"拉取九问模型失败: {exc}") from exc
    models_in = raw.get("models") if isinstance(raw.get("models"), list) else []
    models = [_public_model_entry(m) for m in models_in if isinstance(m, dict)]
    active = str(raw.get("active_model") or "").strip()
    if not active and models:
        # Prefer first is_default, else first entry (Jiuwen: list[0] = 主对话默认)
        for m in models:
            if m.get("is_default"):
                active = str(m.get("alias") or m.get("model_name") or "")
                break
        if not active:
            first = models[0]
            active = str(first.get("alias") or first.get("model_name") or "")
    return {"items": models, "active_model": active}


@router.get("/sessions")
def list_sessions(operator_id: str = "demo_001") -> dict[str, Any]:
    op = (operator_id or "").strip() or "demo_001"
    with db_conn() as conn:
        _require_table(conn)
        rows = conn.execute(
            """
            SELECT id, title, status, ticket_no, jiuwen_session_id, created_at, updated_at
            FROM ticket_assistant_session
            WHERE creator_id = %s AND status <> 'abandoned'
            ORDER BY updated_at DESC, id DESC
            """,
            (op,),
        ).fetchall()
    return {"items": [_serialize_row(r) for r in rows]}


@router.get("/sessions/{session_id:int}")
def get_session(session_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = (operator_id or "").strip() or "demo_001"
    with db_conn() as conn:
        _require_table(conn)
        row = _get_owned_session(conn, session_id, op)
    return {"item": _serialize_row(row)}


@router.post("/sessions")
async def create_session(payload: TicketAssistantCreatePayload) -> dict[str, Any]:
    op = (payload.operator_id or "").strip() or "demo_001"
    op_name = (payload.operator_name or "").strip()
    model_name = str(payload.model_name or "").strip()
    raw_form = dict(payload.form_values or {})
    initial_message = str(payload.initial_message or "").strip()

    with db_conn() as conn:
        _require_table(conn)
        form_values = _sanitize_form_values_for_submit(conn, raw_form) if raw_form else {}
        if form_values:
            title = _title_from_form(form_values)
            first_msg = build_form_context_message(
                form_values, operator_id=op, operator_name=op_name
            )
        elif initial_message:
            title = _strip_html(initial_message).strip()[:80] or "未命名会话"
            first_msg = initial_message
            form_values = {}
        else:
            raise HTTPException(
                status_code=400,
                detail="请提供 form_values 或 initial_message",
            )

        jiuwen_sid = make_jiuwen_session_id()
        row = conn.execute(
            """
            INSERT INTO ticket_assistant_session
              (creator_id, creator_name, form_values, title, jiuwen_session_id, status)
            VALUES (%s, %s, %s, %s, %s, 'chatting')
            RETURNING id, creator_id, creator_name, form_values, title, jiuwen_session_id,
                      status, ticket_no, created_at, updated_at
            """,
            (op, op_name, Jsonb(form_values), title, jiuwen_sid),
        ).fetchone()
        conn.commit()
        local_id = int(row["id"])

    reply = ""
    jiuwen_error = ""
    try:
        _require_jiuwen_enabled()
        result = await jiuwen_create_and_chat(
            ws_url=JIUWEN_WS_URL,
            user_id=op,
            session_id=jiuwen_sid,
            content=first_msg,
            title=title,
            model_name=model_name,
            timeout_seconds=JIUWEN_TIMEOUT_SECONDS,
        )
        reply = str(result.get("reply") or "").strip()
        returned_sid = str(result.get("session_id") or "").strip()
        if returned_sid and returned_sid != jiuwen_sid:
            jiuwen_sid = returned_sid
            with db_conn() as conn:
                conn.execute(
                    """
                    UPDATE ticket_assistant_session
                    SET jiuwen_session_id = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (jiuwen_sid, local_id),
                )
                conn.commit()
    except HTTPException:
        with db_conn() as conn:
            conn.execute("DELETE FROM ticket_assistant_session WHERE id = %s", (local_id,))
            conn.commit()
        raise
    except JiuwenWsError as exc:
        jiuwen_error = str(exc)
        logger.warning("ticket_assistant create jiuwen failed id=%s: %s", local_id, exc)
        with db_conn() as conn:
            conn.execute("DELETE FROM ticket_assistant_session WHERE id = %s", (local_id,))
            conn.commit()
        raise HTTPException(status_code=502, detail=f"九问开聊失败: {jiuwen_error}") from exc
    except Exception as exc:
        logger.exception("ticket_assistant create unexpected id=%s", local_id)
        with db_conn() as conn:
            conn.execute("DELETE FROM ticket_assistant_session WHERE id = %s", (local_id,))
            conn.commit()
        raise HTTPException(status_code=502, detail=f"九问开聊失败: {exc}") from exc

    with db_conn() as conn:
        row = _get_owned_session(conn, local_id, op)
        conn.execute(
            "UPDATE ticket_assistant_session SET updated_at = NOW() WHERE id = %s",
            (local_id,),
        )
        conn.commit()

    return {
        "item": _serialize_row(row),
        "reply": reply,
        "messages": [
            {"role": "user", "content": first_msg, "created_at": ""},
            *([{"role": "assistant", "content": reply, "created_at": ""}] if reply else []),
        ],
    }


@router.post("/sessions/{session_id:int}/chat")
async def chat_session(session_id: int, payload: TicketAssistantChatPayload) -> dict[str, Any]:
    op = (payload.operator_id or "").strip() or "demo_001"
    content = str(payload.content or "").strip()
    model_name = str(payload.model_name or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息不能为空")

    with db_conn() as conn:
        _require_table(conn)
        row = _get_owned_session(conn, session_id, op)
        if str(row.get("status") or "") != "chatting":
            raise HTTPException(status_code=400, detail="会话已结束，无法继续对话")
        jiuwen_sid = str(row.get("jiuwen_session_id") or "").strip()
        if not jiuwen_sid:
            raise HTTPException(status_code=400, detail="会话未绑定九问 session")
        if jiuwen_sid.startswith("demo_"):
            raise HTTPException(
                status_code=400,
                detail="本地预览会话不可续聊，请新建正式会话",
            )

    _require_jiuwen_enabled()
    try:
        result = await jiuwen_chat(
            ws_url=JIUWEN_WS_URL,
            user_id=op,
            session_id=jiuwen_sid,
            content=content,
            model_name=model_name,
            timeout_seconds=JIUWEN_TIMEOUT_SECONDS,
        )
    except JiuwenWsError as exc:
        raise HTTPException(status_code=502, detail=f"九问对话失败: {exc}") from exc

    reply = str(result.get("reply") or "").strip()
    with db_conn() as conn:
        conn.execute(
            "UPDATE ticket_assistant_session SET updated_at = NOW() WHERE id = %s",
            (session_id,),
        )
        conn.commit()

    return {
        "ok": True,
        "reply": reply,
        "messages": [
            {"role": "user", "content": content, "created_at": ""},
            *([{"role": "assistant", "content": reply, "created_at": ""}] if reply else []),
        ],
    }


@router.get("/sessions/{session_id:int}/messages")
async def list_messages(session_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = (operator_id or "").strip() or "demo_001"
    with db_conn() as conn:
        _require_table(conn)
        row = _get_owned_session(conn, session_id, op)
        jiuwen_sid = str(row.get("jiuwen_session_id") or "").strip()
        form_values = row.get("form_values") if isinstance(row.get("form_values"), dict) else {}

    # 本地预览会话（jiuwen_session_id 以 demo_ 开头）：直接读 form_values._preview_messages
    if jiuwen_sid.startswith("demo_"):
        preview = form_values.get("_preview_messages")
        items = preview if isinstance(preview, list) else []
        return {
            "items": [
                {
                    "role": str(m.get("role") or "assistant"),
                    "content": str(m.get("content") or ""),
                    "created_at": str(m.get("created_at") or ""),
                }
                for m in items
                if isinstance(m, dict) and str(m.get("content") or "").strip()
            ]
        }

    if not jiuwen_sid:
        return {"items": []}

    if not JIUWEN_ENABLED or not JIUWEN_WS_URL:
        return {"items": [], "warning": "九问未启用，无法拉取历史"}

    try:
        items = await jiuwen_history(
            ws_url=JIUWEN_WS_URL,
            user_id=op,
            session_id=jiuwen_sid,
            page_idx=1,
            timeout_seconds=min(30, JIUWEN_TIMEOUT_SECONDS),
        )
    except JiuwenWsError as exc:
        logger.warning("ticket_assistant history failed id=%s: %s", session_id, exc)
        raise HTTPException(status_code=502, detail=f"拉取九问历史失败: {exc}") from exc

    # history.get page 1 = newest; present chronological for UI
    normalized = [m for m in items if str(m.get("content") or "").strip()]
    return {"items": list(reversed(normalized)) if normalized else normalized}


@router.post("/sessions/{session_id:int}/transfer")
def transfer_session(session_id: int, payload: TicketAssistantTransferPayload) -> dict[str, Any]:
    op = (payload.operator_id or "").strip() or "demo_001"
    op_name = (payload.operator_name or "").strip() or "Demo User"

    with db_conn() as conn:
        _require_table(conn)
        wl = whitelist_field_levels(conn, op)
        if not ticket_assistant_transfer_allowed(wl):
            raise HTTPException(status_code=403, detail="当前权限不支持转人工")
        row = _get_owned_session(conn, session_id, op)
        if str(row.get("status") or "") == "transferred" and str(row.get("ticket_no") or "").strip():
            return {
                "ok": True,
                "ticket_no": str(row["ticket_no"]),
                "next_handler": "",
                "already_transferred": True,
            }
        if str(row.get("status") or "") != "chatting":
            raise HTTPException(status_code=400, detail="当前会话状态不可转人工")
        raw_form = row.get("form_values") if isinstance(row.get("form_values"), dict) else {}
        form_values = _sanitize_form_values_for_submit(conn, raw_form)
        if not form_values:
            raise HTTPException(status_code=400, detail="会话无表单数据，无法建单")

    draft_id = f"draft-{uuid.uuid4()}"
    next_node = str(payload.next_node_key or "problem_review").strip() or "problem_review"
    submit_payload = SubmitPayload(
        values=dict(form_values),
        operator_id=op,
        operator_name=op_name,
        next_node_key=next_node,
        create_intent=True,
        save_only=False,
    )
    try:
        result = submit_node_data(draft_id, "problem_fill", submit_payload)
    except HTTPException as exc:
        text = _http_detail_as_text(exc.detail)
        if text and text != exc.detail:
            raise HTTPException(status_code=exc.status_code, detail=text) from exc
        raise
    except Exception as exc:
        logger.exception("ticket_assistant transfer submit failed id=%s", session_id)
        raise HTTPException(status_code=500, detail=f"建单失败: {exc}") from exc

    ticket_no = str(result.get("ticket_id") or "").strip()
    if not ticket_no:
        raise HTTPException(status_code=500, detail="建单成功但未返回单号")

    saved_values = result.get("saved", {}).get("values") if isinstance(result.get("saved"), dict) else {}
    if not isinstance(saved_values, dict):
        saved_values = {}
    next_handler = str(saved_values.get("next_handler") or form_values.get("next_handler") or "").strip()

    with db_conn() as conn:
        conn.execute(
            """
            UPDATE ticket_assistant_session
            SET status = 'transferred', ticket_no = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (ticket_no, session_id),
        )
        conn.commit()
        row = _get_owned_session(conn, session_id, op)

    return {
        "ok": True,
        "ticket_no": ticket_no,
        "next_handler": next_handler,
        "item": _serialize_row(row),
        "submit": result,
    }
