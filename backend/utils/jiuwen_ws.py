"""JiuwenSwarm WebChannel WebSocket client (session.switch / chat.send / history.get)."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
import uuid
import urllib.parse
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Optional, Union

import httpx

OnDeltaCallback = Callable[[str], Union[Awaitable[None], None]]
OnReasoningCallback = Callable[[str], Union[Awaitable[None], None]]
OnAskUserCallback = Callable[[dict[str, Any]], Union[Awaitable[None], None]]
OnFileCallback = Callable[[list[dict[str, Any]]], Union[Awaitable[None], None]]
OnToolCallCallback = Callable[[dict[str, Any]], Union[Awaitable[None], None]]
OnToolResultCallback = Callable[[dict[str, Any]], Union[Awaitable[None], None]]

logger = logging.getLogger(__name__)


def absolute_jiuwen_url(url: str, base_url: str = "") -> str:
    """把九问相对下载路径拼成可给浏览器访问的绝对 URL。"""
    raw = str(url or "").strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        return raw
    if not raw.startswith("/"):
        raw = "/" + raw
    return base + raw


def normalize_file_items(
    files: Any, *, base_url: str = ""
) -> list[dict[str, Any]]:
    """Normalize chat.file payload files for SSE/UI."""
    if not isinstance(files, list):
        return []
    out: list[dict[str, Any]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("filename") or "").strip()
        download_url = absolute_jiuwen_url(
            str(item.get("download_url") or item.get("url") or "").strip(),
            base_url,
        )
        download_token = str(item.get("download_token") or "").strip()
        if not download_url and download_token:
            download_url = absolute_jiuwen_url(
                f"/file-api/download?token={download_token}", base_url
            )
        if not name and not download_url:
            continue
        entry: dict[str, Any] = {
            "name": name or "download",
            "download_url": download_url,
        }
        if download_token:
            entry["download_token"] = download_token
        path = str(item.get("path") or "").strip()
        if path:
            entry["path"] = path
        mime = str(item.get("mime_type") or item.get("mimeType") or "").strip()
        if mime:
            entry["mime_type"] = mime
        size = item.get("size")
        if isinstance(size, (int, float)) and size >= 0:
            entry["size"] = int(size)
        out.append(entry)
    return out


def merge_file_items(
    existing: list[dict[str, Any]] | None,
    incoming: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """按 path / token / download_url / name 去重合并，后到的刷新下载链。"""
    merged: list[dict[str, Any]] = []
    index: dict[str, int] = {}

    def _identity(f: dict[str, Any]) -> str:
        path = str(f.get("path") or "").strip()
        if path:
            return f"path:{path}"
        token = str(f.get("download_token") or "").strip()
        if not token:
            url = str(f.get("download_url") or "")
            if "token=" in url:
                token = url.split("token=", 1)[-1].split("&", 1)[0].strip()
        if token:
            return f"token:{token}"
        url = str(f.get("download_url") or "").strip()
        if url:
            return f"url:{url.split('?', 1)[0]}"
        return f"name:{str(f.get('name') or '').strip().lower()}"

    for src in (existing or []) + (incoming or []):
        if not isinstance(src, dict):
            continue
        key = _identity(src)
        if key in index:
            merged[index[key]] = {**merged[index[key]], **src}
        else:
            index[key] = len(merged)
            merged.append(dict(src))
    return merged


def materialize_history_messages(
    items: list[dict[str, Any]], *, base_url: str = ""
) -> list[dict[str, Any]]:
    """把九问历史折成 UI 消息，并按 chat.final 重建已完成工作区。"""
    out: list[dict[str, Any]] = []
    pending_files: list[dict[str, Any]] = []
    pending_deltas: list[str] = []
    pending_reasoning: list[str] = []
    pending_tools: list[dict[str, Any]] = []

    def _normalized_text(value: str) -> str:
        return " ".join(str(value or "").split())

    def _streamed_work(final_content: str) -> str:
        streamed = "".join(pending_deltas).strip()
        final_text = str(final_content or "").strip()
        if not streamed or _normalized_text(streamed) == _normalized_text(final_text):
            return ""
        suffix_at = streamed.rfind(final_text) if final_text else -1
        if suffix_at >= 0 and not streamed[suffix_at + len(final_text) :].strip():
            return streamed[:suffix_at].strip()
        return streamed

    def _clear_turn_buffers() -> None:
        pending_deltas.clear()
        pending_reasoning.clear()
        pending_tools.clear()

    def _upsert_history_tool(tool: dict[str, Any], *, result: bool = False) -> None:
        tid = str(tool.get("tool_call_id") or tool.get("id") or "").strip()
        name = str(tool.get("tool_name") or tool.get("name") or "unknown").strip()
        idx = next(
            (
                i
                for i, item in enumerate(pending_tools)
                if (tid and str(item.get("id") or "") == tid)
            ),
            -1,
        )
        if result:
            success = bool(tool.get("success", True)) and not bool(tool.get("timed_out"))
            patch = {
                "id": tid or name,
                "name": name,
                "status": "timeout" if tool.get("timed_out") else ("completed" if success else "error"),
                "success": success,
                "result": str(tool.get("result") or ""),
            }
        else:
            patch = {
                "id": tid or name,
                "name": name,
                "arguments": tool.get("arguments") if isinstance(tool.get("arguments"), dict) else {},
                "status": "pending",
            }
        if idx >= 0:
            pending_tools[idx] = {**pending_tools[idx], **patch}
        else:
            pending_tools.append(patch)

    def _flush_pending() -> None:
        nonlocal pending_files
        if not pending_files:
            return
        out.append(
            {
                "role": "assistant",
                "content": "",
                "created_at": "",
                "files": pending_files,
            }
        )
        pending_files = []

    for raw in items:
        if not isinstance(raw, dict):
            continue
        role = str(raw.get("role") or "assistant").strip() or "assistant"
        content = str(raw.get("content") or "")
        created_at = raw.get("created_at") or ""
        files = normalize_file_items(raw.get("files"), base_url=base_url)
        content_stripped = content.strip()
        event_type = str(raw.get("event_type") or "").strip().lower()
        reasoning = str(raw.get("reasoning") or "").strip()

        if role == "assistant" and event_type == "chat.delta":
            if content:
                pending_deltas.append(content)
            if reasoning:
                pending_reasoning.append(reasoning)
            if files:
                pending_files = merge_file_items(pending_files, files)
            continue

        if role == "assistant" and event_type == "chat.reasoning":
            reasoning_text = reasoning or content_stripped
            if reasoning_text:
                pending_reasoning.append(reasoning_text)
            continue

        if role == "assistant" and event_type == "chat.tool_call":
            tool = raw.get("tool_call") if isinstance(raw.get("tool_call"), dict) else {}
            if tool:
                _upsert_history_tool(tool)
            continue

        if role == "assistant" and event_type == "chat.tool_result":
            tool = raw.get("tool_result") if isinstance(raw.get("tool_result"), dict) else {}
            if tool:
                _upsert_history_tool(tool, result=True)
            continue

        if role == "assistant" and event_type == "chat.final":
            entry: dict[str, Any] = {
                "role": "assistant",
                "content": content,
                "final_content": content,
                "created_at": created_at,
            }
            work_content = _streamed_work(content)
            if work_content:
                entry["work_content"] = work_content
            reasoning_text = "\n\n".join(p for p in pending_reasoning if p).strip()
            if reasoning or reasoning_text:
                entry["reasoning"] = reasoning or reasoning_text
            if pending_tools:
                entry["tools"] = [dict(tool) for tool in pending_tools]
            bundled = merge_file_items(pending_files, files)
            pending_files = []
            if bundled:
                entry["files"] = bundled
            if content_stripped or bundled or work_content or entry.get("reasoning"):
                out.append(entry)
            _clear_turn_buffers()
            continue

        if role == "assistant" and files and not content_stripped:
            pending_files = merge_file_items(pending_files, files)
            continue

        if role == "assistant":
            entry: dict[str, Any] = {
                "role": "assistant",
                "content": content,
                "created_at": created_at,
            }
            bundled = merge_file_items(pending_files, files)
            pending_files = []
            if bundled:
                entry["files"] = bundled
            if reasoning:
                entry["reasoning"] = reasoning
            if pending_tools:
                entry["tools"] = [dict(tool) for tool in pending_tools]
                pending_tools.clear()
            if content_stripped or bundled:
                out.append(entry)
            continue

        _clear_turn_buffers()
        _flush_pending()
        if role == "user" and content_stripped:
            out.append(
                {
                    "role": "user",
                    "content": content,
                    "created_at": created_at,
                }
            )
        elif content_stripped:
            entry = {
                "role": role,
                "content": content,
                "created_at": created_at,
            }
            if files:
                entry["files"] = files
            out.append(entry)

    _flush_pending()
    return out


def is_history_stream_done(payload: dict[str, Any] | None) -> bool:
    """history.message 结束帧：status/content=done，且没有实际消息正文。"""
    raw = payload if isinstance(payload, dict) else {}
    status = str(raw.get("status") or "").strip().lower()
    content_raw = raw.get("content")
    status_done = status == "done" or (
        isinstance(content_raw, str) and content_raw.strip().lower() == "done"
    )
    if not status_done:
        return False
    nested = raw.get("message") if isinstance(raw.get("message"), dict) else None
    if nested:
        return False
    if str(raw.get("role") or raw.get("speaker") or "").strip():
        return False
    if isinstance(content_raw, str) and content_raw.strip() and content_raw.strip().lower() != "done":
        return False
    return True


def history_item_from_event_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """取出 history.message 里的消息；内层缺 role 时回退外层。"""
    raw = payload if isinstance(payload, dict) else {}
    nested = raw.get("message") if isinstance(raw.get("message"), dict) else None
    item = nested if nested else raw
    if not isinstance(item, dict):
        return None
    if nested and not str(item.get("role") or item.get("speaker") or "").strip():
        outer_role = raw.get("role") or raw.get("speaker")
        if outer_role:
            item = {**item, "role": outer_role}
    return item


def normalize_ask_user_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize chat.ask_user_question payload for SSE/UI."""
    raw = payload if isinstance(payload, dict) else {}
    request_id = str(raw.get("request_id") or "").strip()
    questions_in = raw.get("questions") if isinstance(raw.get("questions"), list) else []
    questions: list[dict[str, Any]] = []
    for item in questions_in[:4]:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        if not question:
            continue
        options_in = item.get("options") if isinstance(item.get("options"), list) else []
        options: list[dict[str, Any]] = []
        for opt in options_in:
            if not isinstance(opt, dict):
                continue
            label = str(opt.get("label") or opt.get("value") or "").strip()
            if not label:
                continue
            entry: dict[str, Any] = {
                "label": label,
                "description": str(opt.get("description") or "").strip(),
            }
            value = opt.get("value")
            if isinstance(value, str) and value.strip():
                entry["value"] = value.strip()
            preview = opt.get("preview")
            if isinstance(preview, str) and preview.strip():
                entry["preview"] = preview
            options.append(entry)
        questions.append(
            {
                "question": question,
                "header": str(item.get("header") or "Question").strip() or "Question",
                "options": options,
                "multi_select": bool(item.get("multi_select")),
            }
        )
    if not request_id or not questions:
        return None
    out: dict[str, Any] = {
        "request_id": request_id,
        "questions": questions,
        "source": str(raw.get("source") or "ask_user_interrupt").strip()
        or "ask_user_interrupt",
    }
    for key in (
        "approval_schema",
        "plan_approval_kind",
        "plan_content",
        "plan_language",
    ):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()
    evo = raw.get("evolution_meta") or raw.get("_evolution_meta")
    if isinstance(evo, dict):
        out["evolution_meta"] = evo
    return out


def _as_record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _parse_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except Exception:
            return {"_raw": raw}
        if isinstance(parsed, dict):
            return parsed
        return {"_raw": parsed}
    return {}


def _resolve_tool_call_id(
    payload: dict[str, Any], fallback: dict[str, Any] | None = None
) -> str:
    for src in (payload, fallback or {}):
        for key in ("id", "tool_call_id", "toolCallId"):
            val = src.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return ""


def normalize_tool_call_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize chat.tool_call payload for SSE/UI（对齐九问 Web toolEventNormalizer）。"""
    raw = payload if isinstance(payload, dict) else {}
    tool_call = _as_record(raw.get("tool_call")) or raw
    tool_id = _resolve_tool_call_id(tool_call, raw) or f"tool-{int(time.time() * 1000)}"
    name = (
        str(tool_call.get("name") or "").strip()
        or str(raw.get("tool_name") or "").strip()
        or "unknown"
    )
    out: dict[str, Any] = {
        "id": tool_id,
        "name": name,
        "arguments": _parse_tool_arguments(tool_call.get("arguments")),
    }
    description = tool_call.get("description")
    if isinstance(description, str) and description.strip():
        out["description"] = description.strip()
    formatted_args = tool_call.get("formatted_args")
    if isinstance(formatted_args, str) and formatted_args.strip():
        out["formatted_args"] = formatted_args.strip()
    display_name = str(
        tool_call.get("display_name") or tool_call.get("displayName") or ""
    ).strip()
    if display_name:
        out["display_name"] = display_name
    return out


def normalize_tool_result_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize chat.tool_result payload for SSE/UI。"""
    raw = payload if isinstance(payload, dict) else {}
    tool_result = _as_record(raw.get("tool_result")) or raw
    raw_output = _as_record(tool_result.get("raw_output")) or _as_record(
        tool_result.get("rawOutput")
    )
    raw_output_result = ""
    if isinstance(raw_output, dict) and isinstance(raw_output.get("result"), str):
        raw_output_result = raw_output.get("result") or ""
    result = (
        raw_output_result
        or (tool_result.get("result") if isinstance(tool_result.get("result"), str) else "")
        or (str(tool_result.get("data")) if tool_result.get("data") is not None else "")
        or (tool_result.get("error") if isinstance(tool_result.get("error"), str) else "")
        or ""
    )
    status = str(tool_result.get("status") or "").strip().lower()
    timed_out = status in {"timeout", "timed_out"}
    status_failed = timed_out or status in {"error", "failed", "failure"}
    if isinstance(tool_result.get("success"), bool):
        success = bool(tool_result.get("success")) and not timed_out
    elif status:
        success = not status_failed
    else:
        success = True
    tool_name = (
        str(tool_result.get("tool_name") or "").strip()
        or str(tool_result.get("name") or "").strip()
        or "unknown"
    )
    tool_call_id = _resolve_tool_call_id(tool_result, raw)
    if not tool_call_id and not result and tool_name == "unknown":
        return None
    out: dict[str, Any] = {
        "tool_name": tool_name,
        "result": str(result or ""),
        "success": success,
    }
    if tool_call_id:
        out["tool_call_id"] = tool_call_id
    if timed_out:
        out["timed_out"] = True
    summary = tool_result.get("summary")
    if isinstance(summary, str) and summary.strip():
        out["summary"] = summary.strip()
    elif not success:
        out["summary"] = "❌"
    return out


async def _emit_callback(
    callback: Callable[..., Union[Awaitable[None], None]] | None, *args: Any
) -> None:
    if not callback:
        return
    try:
        maybe = callback(*args)
        if asyncio.iscoroutine(maybe) or asyncio.isfuture(maybe):
            await maybe
    except Exception:
        logger.exception("jiuwen callback failed")

# 与九问 Web 前端主对话一致；agent.fast/plan 在服务端也会归一到 agent。
_DEFAULT_CHAT_MODE = "agent"
_SESSION_CREATE_MAX_ATTEMPTS = 3


def _normalize_jiuwen_mode(mode: str) -> str:
    raw = str(mode or "").strip() or _DEFAULT_CHAT_MODE
    if raw.startswith("agent."):
        return "agent"
    return raw


def _is_session_conflict_error(exc: BaseException) -> bool:
    code = str(getattr(exc, "code", "") or "").upper()
    msg = str(exc or "").lower()
    return code in {"ALREADY_EXISTS", "CONFLICT"} or "already exists" in msg


def format_exception_chain(exc: BaseException, *, limit: int = 8) -> str:
    """Flatten exception cause/context for archived logs."""
    parts: list[str] = []
    cur: BaseException | None = exc
    seen: set[int] = set()
    while cur is not None and id(cur) not in seen and len(parts) < limit:
        seen.add(id(cur))
        bits = [f"{type(cur).__name__}: {cur}"]
        errno = getattr(cur, "errno", None)
        if errno is not None:
            bits.append(f"errno={errno}")
        strerror = getattr(cur, "strerror", None)
        if strerror:
            bits.append(f"strerror={strerror!r}")
        parts.append(" ".join(bits))
        nxt = cur.__cause__
        if nxt is None and not getattr(cur, "__suppress_context__", False):
            nxt = cur.__context__
        cur = nxt
    return " | caused by: ".join(parts)


def make_jiuwen_session_id() -> str:
    """Web convention: sess_<hex_ms>_<6hex>."""
    ms = int(time.time() * 1000)
    return f"sess_{ms:x}_{secrets.token_hex(3)}"


# AgentServer 在请求缺 sid 时的兜底值；Web session.create 不得返回这些。
_INVALID_JIUWEN_SESSION_IDS = frozenset({"", "default", "new"})


def resolve_jiuwen_created_session_id(payload: dict[str, Any] | None) -> str:
    """从 session.create 回包取出服务端分配的 session_id。

    兼容扁平字段与偶发嵌套 ``result``；占位/兜底值（default/new）视为无效。
    """
    if not isinstance(payload, dict):
        return ""
    candidates: list[Any] = [
        payload.get("session_id"),
        payload.get("sessionId"),
    ]
    nested = payload.get("result")
    if isinstance(nested, dict):
        candidates.extend(
            [nested.get("session_id"), nested.get("sessionId")]
        )
    # 优先合法 id；若只有非法值则返回第一个非空（供调用方报错与日志）
    first_nonempty = ""
    for raw in candidates:
        sid = str(raw or "").strip()
        if not sid:
            continue
        if not first_nonempty:
            first_nonempty = sid
        if sid.lower() not in _INVALID_JIUWEN_SESSION_IDS:
            return sid
    return first_nonempty


def is_valid_jiuwen_session_id(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    return bool(sid) and sid.lower() not in _INVALID_JIUWEN_SESSION_IDS


def build_form_context_message(
    form_values: dict[str, Any],
    *,
    operator_id: str = "",
    operator_name: str = "",
) -> str:
    """Build first-turn user message from problem-fill form values."""
    values = form_values if isinstance(form_values, dict) else {}
    labels = [
        ("issue_desc", "问题描述"),
        ("problem_desc", "问题描述"),
        ("description", "问题描述"),
        ("location", "局点"),
        ("severity", "问题严重性"),
        ("biz_env", "问题阶段"),
        ("component", "问题组件"),
        ("product_line", "产品线"),
        ("start_date", "起始日期"),
        ("ecare_ticket_no", "eCare单号"),
        ("hcs_owner", "提单人"),
    ]
    lines: list[str] = ["【运维提单助手】用户提交了问题信息，请基于知识库协助排查与解答。"]
    if operator_name or operator_id:
        who = " ".join(x for x in (operator_name.strip(), operator_id.strip()) if x)
        if who:
            lines.append(f"提单人：{who}")
    seen_desc = False
    for key, label in labels:
        raw = values.get(key)
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        if key in ("issue_desc", "problem_desc", "description"):
            if seen_desc:
                continue
            seen_desc = True
            # strip simple tags for chat context
            text = (
                text.replace("<br>", "\n")
                .replace("<br/>", "\n")
                .replace("<br />", "\n")
            )
            for tag in ("</p>", "</div>", "</li>"):
                text = text.replace(tag, "\n")
            while "<" in text and ">" in text:
                a = text.find("<")
                b = text.find(">", a)
                if a < 0 or b < 0:
                    break
                text = text[:a] + text[b + 1 :]
            text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
        lines.append(f"{label}：{text}")
    if len(lines) == 1:
        lines.append("（表单无有效字段，请等待用户补充问题描述）")
    return "\n".join(lines)


class JiuwenWsError(RuntimeError):
    def __init__(self, message: str, *, code: str = "JIUWEN_ERROR"):
        super().__init__(message)
        self.code = code


def _cookie_pairs_from_set_cookie(resp: httpx.Response) -> list[str]:
    """Extract name=value pairs from Set-Cookie headers."""
    raw_list: list[str] = []
    get_list = getattr(resp.headers, "get_list", None)
    if callable(get_list):
        raw_list = list(get_list("set-cookie") or [])
    else:
        single = resp.headers.get("set-cookie")
        if single:
            raw_list = [single]
    pairs: list[str] = []
    for item in raw_list:
        part = str(item or "").split(";", 1)[0].strip()
        if part and "=" in part:
            pairs.append(part)
    return pairs


def build_jiuwen_cookie_header(token: str, *, set_cookie_pairs: list[str] | None = None) -> str:
    """Build Cookie header for WS upgrade.

    部署侧鉴权：websockets.connect(..., additional_headers={"Cookie": f"jap_session={TOKEN}"})
    ADMIN_TOKEN 只用于 POST /admin/token 换用户 TOKEN；握手必须带 jap_session Cookie。
    """
    pairs: list[str] = []
    seen: set[str] = set()

    def _add(pair: str) -> None:
        name = pair.split("=", 1)[0].strip().lower()
        if not name or name in seen:
            return
        seen.add(name)
        pairs.append(pair)

    tok = str(token or "").strip()
    if tok:
        _add(f"jap_session={tok}")
    # 若 /admin/token 本身 Set-Cookie，一并带上（不覆盖 jap_session）
    for pair in set_cookie_pairs or []:
        _add(pair)
    return "; ".join(pairs)


async def fetch_jiuwen_user_token(
    *,
    base_url: str,
    admin_token: str,
    uid: str,
    timeout_seconds: float = 10.0,
) -> tuple[str, str]:
    """POST {base}/admin/token → (user JWT, Cookie header)。

    ADMIN_TOKEN 仅用于本接口鉴权；返回的用户 token 需以 Cookie 交给后续 /ws。
    """
    base = str(base_url or "").strip().rstrip("/")
    admin = str(admin_token or "").strip()
    user = str(uid or "").strip()
    if not base:
        raise JiuwenWsError("JIUWEN_BASE_URL 未配置", code="NOT_CONFIGURED")
    if not admin:
        raise JiuwenWsError("JIUWEN_ADMIN_TOKEN 未配置", code="NOT_CONFIGURED")
    if not user:
        raise JiuwenWsError("九问 uid 为空", code="AUTH")
    url = f"{base}/admin/token"
    try:
        # trust_env=False：避免本机 HTTP_PROXY 把内网九问打到错误出口
        async with httpx.AsyncClient(timeout=timeout_seconds, trust_env=False) as client:
            resp = await client.post(
                url,
                json={"uid": user},
                headers={"Authorization": f"Bearer {admin}"},
            )
    except httpx.RequestError as exc:
        raise JiuwenWsError(f"九问换票失败: {exc}", code="AUTH_UNREACHABLE") from exc
    if resp.status_code != 200:
        detail = (resp.text or "").strip()[:300]
        raise JiuwenWsError(
            f"九问换票失败 HTTP {resp.status_code}" + (f": {detail}" if detail else ""),
            code="AUTH",
        )
    try:
        payload = resp.json()
    except Exception as exc:
        raise JiuwenWsError("九问换票响应非 JSON", code="AUTH") from exc
    token = ""
    if isinstance(payload, dict):
        token = str(payload.get("token") or payload.get("access_token") or "").strip()
    set_pairs = _cookie_pairs_from_set_cookie(resp)
    if not token and set_pairs:
        # 有的实现只 Set-Cookie、body 无 token
        for pair in set_pairs:
            name, _, value = pair.partition("=")
            if name.strip().lower() in ("jap_session", "token", "access_token") and value:
                token = value.strip()
                break
    if not token:
        raise JiuwenWsError("九问换票响应缺少 token", code="AUTH")
    cookie_header = build_jiuwen_cookie_header(token, set_cookie_pairs=set_pairs)
    return token, cookie_header


class JiuwenWsClient:
    """One-shot: connect → connection.ack → RPC → processing_status/history.done → close."""

    def __init__(
        self,
        ws_url: str,
        *,
        user_id: str = "",
        base_url: str = "",
        admin_token: str = "",
        auth_token: str = "",
        cookie_header: str = "",
        timeout_seconds: float = 60.0,
    ):
        self.ws_url = str(ws_url or "").strip()
        self.user_id = str(user_id or "").strip()
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.admin_token = str(admin_token or "").strip()
        self.auth_token = str(auth_token or "").strip()
        self.cookie_header = str(cookie_header or "").strip()
        self.timeout_seconds = float(timeout_seconds)

    def _connect_url(self) -> str:
        if not self.ws_url:
            raise JiuwenWsError("JIUWEN_WS_URL 未配置", code="NOT_CONFIGURED")
        url = self.ws_url
        if self.user_id:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}user_id={urllib.parse.quote(self.user_id)}"
        return url

    async def _ensure_auth_token(self) -> None:
        if self.auth_token and self.cookie_header:
            return
        if not self.admin_token:
            raise JiuwenWsError(
                "JIUWEN_ADMIN_TOKEN 未配置：九问 WS 需要先 admin/token 换票并带 Cookie",
                code="NOT_CONFIGURED",
            )
        if not self.user_id:
            raise JiuwenWsError("九问 uid 为空，无法换票", code="AUTH")
        token, cookie = await fetch_jiuwen_user_token(
            base_url=self.base_url,
            admin_token=self.admin_token,
            uid=self.user_id,
            timeout_seconds=min(10.0, self.timeout_seconds),
        )
        self.auth_token = token
        self.cookie_header = cookie
        logger.info(
            "jiuwen admin/token ok uid=%s token_len=%s has_cookie=%s",
            self.user_id,
            len(self.auth_token),
            bool(self.cookie_header),
        )

    def _log_failure(
        self,
        *,
        stage: str,
        url: str,
        methods: list[str],
        open_timeout: float,
        elapsed_ms: float,
        exc: BaseException,
    ) -> None:
        code = getattr(exc, "code", "") or type(exc).__name__
        logger.error(
            "jiuwen ws %s failed url=%s user_id=%s methods=%s "
            "timeout_seconds=%s open_timeout=%s elapsed_ms=%.0f code=%s error=%s chain=%s",
            stage,
            url,
            self.user_id or "-",
            ",".join(methods) or "-",
            self.timeout_seconds,
            open_timeout,
            elapsed_ms,
            code,
            exc,
            format_exception_chain(exc),
            exc_info=exc,
        )

    @staticmethod
    def _build_session_create_params(
        *,
        title: str = "",
        mode: str = _DEFAULT_CHAT_MODE,
        model_name: str = "",
        minimal: bool = False,
    ) -> dict[str, Any]:
        """对齐九问 Web 前端 createConversationSession 的建会话参数。"""
        params: dict[str, Any] = {
            # 官方前端用 UUID；与 create_token 幂等缓存对齐
            "create_token": str(uuid.uuid4()),
            "mode": _normalize_jiuwen_mode(mode),
            "is_swarm": False,
        }
        if not minimal:
            params["work_mode"] = "work"
            base = (title or "提单助手").strip()[:80] or "提单助手"
            # 标题加短后缀，避免与脏会话/重名路径冲突
            params["title"] = f"{base} · {secrets.token_hex(3)}"
        model = str(model_name or "").strip()
        if model:
            params["model_name"] = model
        return params

    async def create_session_and_chat(
        self,
        *,
        content: str,
        title: str = "",
        mode: str = _DEFAULT_CHAT_MODE,
        model_name: str = "",
        session_id: str = "",
        on_delta: OnDeltaCallback | None = None,
        on_reasoning: OnReasoningCallback | None = None,
        on_ask_user: OnAskUserCallback | None = None,
        on_file: OnFileCallback | None = None,
        on_tool_call: OnToolCallCallback | None = None,
        on_tool_result: OnToolResultCallback | None = None,
    ) -> dict[str, Any]:
        """开聊：session.switch（客户端分配 sid）+ chat.send。

        对齐联调/测试脚本路径。Web 产品页新建虽用 session.create，但当前环境
        create 易返回 ALREADY_EXISTS；session.switch 接受显式 session_id，可稳定
        开出新会话。``title`` 仅作日志，switch 协议不携带标题。
        """
        _ = title
        chat_mode = _normalize_jiuwen_mode(mode)
        model = str(model_name or "").strip()
        # 允许调用方传入合法 sid；否则按 Web 约定生成 sess_*，禁止 default/new
        server_sid = str(session_id or "").strip()
        if not is_valid_jiuwen_session_id(server_sid):
            server_sid = make_jiuwen_session_id()

        switch_params: dict[str, Any] = {
            "session_id": server_sid,
            "mode": chat_mode,
            "work_mode": "work",
        }
        chat_params: dict[str, Any] = {
            "session_id": server_sid,
            "content": content,
            "query": content,
            "mode": chat_mode,
        }
        if model:
            switch_params["model_name"] = model
            chat_params["model_name"] = model

        logger.info(
            "jiuwen open chat via session.switch session_id=%s user_id=%s mode=%s",
            server_sid,
            self.user_id or "-",
            chat_mode,
        )
        result = await self._run(
            [
                ("session.switch", switch_params, False),
                ("chat.send", chat_params, True),
            ],
            wait_chat=True,
            session_id=server_sid,
            on_delta=on_delta,
            on_reasoning=on_reasoning,
            on_ask_user=on_ask_user,
            on_file=on_file,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
        )
        returned = str(result.get("session_id") or server_sid).strip()
        if is_valid_jiuwen_session_id(returned):
            server_sid = returned
        return {
            "session_id": server_sid,
            "reply": result.get("reply") or "",
            "messages": result.get("messages") or [],
            "create_payload": result.get("rpc_payload") or {},
            "rpc_payload": result.get("rpc_payload") or {},
            "ask_user": result.get("ask_user"),
            "files": result.get("files") or [],
            "tools": result.get("tools") or [],
        }

    async def chat(
        self,
        *,
        session_id: str,
        content: str,
        mode: str = _DEFAULT_CHAT_MODE,
        model_name: str = "",
        on_delta: OnDeltaCallback | None = None,
        on_reasoning: OnReasoningCallback | None = None,
        on_ask_user: OnAskUserCallback | None = None,
        on_file: OnFileCallback | None = None,
        on_tool_call: OnToolCallCallback | None = None,
        on_tool_result: OnToolResultCallback | None = None,
        extra_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        sid = str(session_id or "").strip()
        if not is_valid_jiuwen_session_id(sid):
            raise JiuwenWsError(
                f"chat.send 需要合法服务端 session_id，收到: {sid or '(empty)'}",
                code="AUTH",
            )
        chat_params: dict[str, Any] = {
            "session_id": sid,
            "content": content,
            "query": content,
            "mode": _normalize_jiuwen_mode(mode),
        }
        model = str(model_name or "").strip()
        if model:
            chat_params["model_name"] = model
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                if key in ("session_id", "content", "query", "mode", "model_name"):
                    continue
                chat_params[key] = value
        return await self._run(
            [("chat.send", chat_params, True)],
            wait_chat=True,
            session_id=sid,
            on_delta=on_delta,
            on_reasoning=on_reasoning,
            on_ask_user=on_ask_user,
            on_file=on_file,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
        )

    async def answer_ask_user(
        self,
        *,
        session_id: str,
        request_id: str,
        answers: list[dict[str, Any]],
        source: str = "ask_user_interrupt",
        mode: str = _DEFAULT_CHAT_MODE,
        model_name: str = "",
        on_delta: OnDeltaCallback | None = None,
        on_reasoning: OnReasoningCallback | None = None,
        on_ask_user: OnAskUserCallback | None = None,
        on_file: OnFileCallback | None = None,
        on_tool_call: OnToolCallCallback | None = None,
        on_tool_result: OnToolResultCallback | None = None,
        extra_params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Resume an ask_user / permission interrupt via chat.send(request_id+answers)."""
        rid = str(request_id or "").strip()
        if not rid:
            raise JiuwenWsError("ask_user 缺少 request_id", code="INVALID_ARGUMENT")
        src = str(source or "ask_user_interrupt").strip() or "ask_user_interrupt"
        answer_list = [a for a in (answers or []) if isinstance(a, dict)]
        if not answer_list:
            raise JiuwenWsError("ask_user 缺少 answers", code="INVALID_ARGUMENT")
        extra: dict[str, Any] = {
            "request_id": rid,
            "answers": answer_list,
            "source": src,
        }
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                if key in ("request_id", "answers", "source"):
                    continue
                extra[key] = value
        # 九问约定：resume 时 query/content 为空，靠 request_id+answers 续跑
        return await self.chat(
            session_id=session_id,
            content="",
            mode=mode,
            model_name=model_name,
            on_delta=on_delta,
            on_reasoning=on_reasoning,
            on_ask_user=on_ask_user,
            on_file=on_file,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
            extra_params=extra,
        )

    async def interrupt(
        self,
        *,
        session_id: str,
        intent: str = "cancel",
        mode: str = "agent",
    ) -> dict[str, Any]:
        """chat.interrupt：pause / cancel / resume / supplement（提单助手主要用 cancel）。"""
        sid = str(session_id or "").strip()
        if not is_valid_jiuwen_session_id(sid):
            raise JiuwenWsError(
                f"chat.interrupt 需要合法服务端 session_id，收到: {sid or '(empty)'}",
                code="AUTH",
            )
        intent_norm = str(intent or "cancel").strip().lower() or "cancel"
        if intent_norm not in {"pause", "cancel", "resume", "supplement"}:
            raise JiuwenWsError(
                f"chat.interrupt 不支持的 intent: {intent_norm}",
                code="INVALID_ARGUMENT",
            )
        result = await self._run(
            [
                (
                    "chat.interrupt",
                    {
                        "session_id": sid,
                        "intent": intent_norm,
                        "mode": _normalize_jiuwen_mode(mode),
                    },
                    False,
                )
            ],
            session_id=sid,
        )
        payload = result.get("rpc_payload") if isinstance(result.get("rpc_payload"), dict) else {}
        return {
            "session_id": sid,
            "intent": intent_norm,
            "payload": payload,
        }

    async def list_models(self) -> dict[str, Any]:
        """models.list → {models, active_model}."""
        result = await self._run([("models.list", {}, False)])
        payload = result.get("rpc_payload") if isinstance(result.get("rpc_payload"), dict) else {}
        models = payload.get("models") if isinstance(payload.get("models"), list) else []
        return {
            "models": models,
            "active_model": str(payload.get("active_model") or ""),
        }

    async def history(
        self,
        *,
        session_id: str,
        page_idx: int = 1,
    ) -> list[dict[str, Any]]:
        sid = str(session_id or "").strip()
        if not is_valid_jiuwen_session_id(sid):
            raise JiuwenWsError(
                f"history.get 需要合法服务端 session_id，收到: {sid or '(empty)'}",
                code="AUTH",
            )
        result = await self._run(
            [
                (
                    "history.get",
                    {"session_id": sid, "page_idx": max(1, int(page_idx))},
                    True,
                ),
            ],
            collect_history=True,
            session_id=sid,
        )
        return list(result.get("messages") or [])

    async def _run(
        self,
        calls: list[tuple[str, dict[str, Any], bool]],
        *,
        wait_chat: bool = False,
        collect_history: bool = False,
        session_id: str = "",
        adopt_session_from_create: bool = False,
        on_delta: OnDeltaCallback | None = None,
        on_reasoning: OnReasoningCallback | None = None,
        on_ask_user: OnAskUserCallback | None = None,
        on_file: OnFileCallback | None = None,
        on_tool_call: OnToolCallCallback | None = None,
        on_tool_result: OnToolResultCallback | None = None,
    ) -> dict[str, Any]:
        try:
            import websockets
            from websockets.exceptions import ConnectionClosed
        except ImportError as exc:
            raise JiuwenWsError("缺少 websockets 依赖，请安装后重试", code="DEPENDENCY") from exc

        url = self._connect_url()
        timeout = self.timeout_seconds
        open_timeout = min(15.0, timeout)
        ack_timeout = min(15.0, timeout)
        methods = [str(m) for m, _p, _s in calls]
        started = time.monotonic()
        reply_parts: list[str] = []
        reasoning_parts: list[str] = []
        reply_final = ""
        history_messages: list[dict[str, Any]] = []
        history_done = asyncio.Event()
        chat_done = asyncio.Event()
        ack_done = asyncio.Event()
        pending: dict[str, asyncio.Future] = {}
        create_payload: dict[str, Any] = {}
        active_session_id = str(session_id or "").strip()
        chat_error: list[BaseException] = []
        ack_received = False
        final_delta_emitted = False
        ask_user_payload: dict[str, Any] | None = None
        collected_files: list[dict[str, Any]] = []
        collected_tools: list[dict[str, Any]] = []
        tool_index: dict[str, int] = {}

        def _sid_match(sid: str) -> bool:
            if not active_session_id:
                return True
            if not sid:
                return True
            return sid == active_session_id

        async def _emit_delta(text: str) -> None:
            if not text:
                return
            await _emit_callback(on_delta, text)

        def _upsert_tool_call(tool_call: dict[str, Any]) -> None:
            tid = str(tool_call.get("id") or "").strip()
            if not tid:
                return
            entry = {
                "id": tid,
                "name": str(tool_call.get("name") or "unknown"),
                "arguments": tool_call.get("arguments")
                if isinstance(tool_call.get("arguments"), dict)
                else {},
                "status": "pending",
            }
            for key in ("description", "formatted_args", "display_name"):
                if tool_call.get(key):
                    entry[key] = tool_call[key]
            if tid in tool_index:
                prev = collected_tools[tool_index[tid]]
                collected_tools[tool_index[tid]] = {**prev, **entry}
            else:
                tool_index[tid] = len(collected_tools)
                collected_tools.append(entry)

        def _upsert_tool_result(tool_result: dict[str, Any]) -> None:
            tid = str(tool_result.get("tool_call_id") or "").strip()
            success = bool(tool_result.get("success", True))
            timed_out = bool(tool_result.get("timed_out"))
            status = "timeout" if timed_out else ("error" if not success else "completed")
            patch = {
                "status": status,
                "success": success,
                "result": str(tool_result.get("result") or ""),
                "tool_name": str(tool_result.get("tool_name") or "").strip(),
            }
            if timed_out:
                patch["timed_out"] = True
            if tool_result.get("summary"):
                patch["summary"] = tool_result["summary"]
            if tid and tid in tool_index:
                prev = collected_tools[tool_index[tid]]
                if not patch["tool_name"]:
                    patch["tool_name"] = prev.get("name") or "unknown"
                collected_tools[tool_index[tid]] = {**prev, **patch}
                return
            # 结果先于 call 到达：补一条占位
            entry = {
                "id": tid or f"tool-result-{len(collected_tools)+1}",
                "name": patch["tool_name"] or "unknown",
                "arguments": {},
                **patch,
            }
            if tid:
                tool_index[tid] = len(collected_tools)
            collected_tools.append(entry)

        async def reader(ws):
            nonlocal reply_final, ack_received, final_delta_emitted, ask_user_payload
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    mtype = str(msg.get("type") or "")
                    if mtype == "res":
                        req_id = str(msg.get("id") or "")
                        fut = pending.get(req_id)
                        if fut and not fut.done():
                            fut.set_result(msg)
                        continue
                    if mtype != "event":
                        continue
                    event = str(msg.get("event") or msg.get("event_type") or "").strip()
                    # legacy aliases from webClient LEGACY_EVENT_MAP
                    if event == "connection_ack":
                        event = "connection.ack"
                    elif event == "content_chunk":
                        event = "chat.delta"
                    elif event == "content":
                        event = "chat.final"
                    elif event == "processing_status":
                        event = "chat.processing_status"
                    elif event == "file_content":
                        event = "chat.file"
                    elif event == "tool_call":
                        event = "chat.tool_call"
                    elif event == "tool_result":
                        event = "chat.tool_result"
                    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
                    # some frames put event_type inside payload
                    if not event and payload.get("event_type"):
                        event = str(payload.get("event_type") or "").strip()
                        if event == "file_content":
                            event = "chat.file"
                    sid = str(payload.get("session_id") or payload.get("sessionId") or "")

                    if event == "connection.ack":
                        ack_received = True
                        ack_done.set()
                        continue

                    if event == "chat.delta" and wait_chat and _sid_match(sid):
                        delta = (
                            payload.get("delta")
                            or payload.get("content")
                            or payload.get("text")
                            or ""
                        )
                        if delta:
                            text = str(delta)
                            reply_parts.append(text)
                            await _emit_delta(text)
                    elif event == "chat.reasoning" and wait_chat and _sid_match(sid):
                        reasoning = (
                            payload.get("reasoning_content")
                            or payload.get("reasoning")
                            or payload.get("content")
                            or payload.get("text")
                            or payload.get("delta")
                            or ""
                        )
                        if reasoning:
                            text = str(reasoning)
                            current_reasoning = "".join(reasoning_parts)
                            if text.startswith(current_reasoning):
                                reasoning_parts[:] = [text]
                            elif not current_reasoning.endswith(text):
                                reasoning_parts.append(text)
                            await _emit_callback(on_reasoning, text)
                    elif event == "chat.final" and wait_chat and _sid_match(sid):
                        # 内容结束标记；真正收尾看 processing_status(false)
                        content = (
                            payload.get("content")
                            or payload.get("text")
                            or payload.get("reply")
                            or "".join(reply_parts)
                        )
                        reply_final = str(content or "")
                        # 仅 final、无 delta 时补推一次，便于 SSE 端尽早展示
                        if reply_final and not reply_parts and not final_delta_emitted:
                            final_delta_emitted = True
                            await _emit_delta(reply_final)
                    elif event == "chat.file" and wait_chat and _sid_match(sid):
                        files = normalize_file_items(
                            payload.get("files"), base_url=self.base_url
                        )
                        if files:
                            collected_files[:] = merge_file_items(collected_files, files)
                            await _emit_callback(on_file, files)
                            logger.info(
                                "jiuwen chat.file session_id=%s files=%s",
                                sid or active_session_id or "-",
                                [f.get("name") for f in files],
                            )
                    elif event == "chat.ask_user_question" and wait_chat and _sid_match(sid):
                        # Agent 弹出 ask usr / 权限确认：本轮停在等待用户选择
                        normalized = normalize_ask_user_payload(payload)
                        if normalized:
                            ask_user_payload = normalized
                            await _emit_callback(on_ask_user, normalized)
                            logger.info(
                                "jiuwen ask_user_question session_id=%s request_id=%s "
                                "source=%s questions=%s",
                                sid or active_session_id or "-",
                                normalized.get("request_id"),
                                normalized.get("source"),
                                len(normalized.get("questions") or []),
                            )
                            chat_done.set()
                    elif event == "chat.tool_call" and wait_chat and _sid_match(sid):
                        normalized = normalize_tool_call_payload(payload)
                        if normalized:
                            _upsert_tool_call(normalized)
                            await _emit_callback(on_tool_call, normalized)
                    elif event == "chat.tool_result" and wait_chat and _sid_match(sid):
                        normalized = normalize_tool_result_payload(payload)
                        if normalized:
                            _upsert_tool_result(normalized)
                            await _emit_callback(on_tool_result, normalized)
                    elif event == "chat.processing_status" and wait_chat and _sid_match(sid):
                        is_processing = payload.get("is_processing")
                        is_complete = payload.get("is_complete")
                        if is_processing is False or is_complete is True:
                            chat_done.set()
                    elif event == "chat.error" and wait_chat and _sid_match(sid):
                        err = str(
                            payload.get("error") or payload.get("message") or "九问对话失败"
                        )
                        logger.error(
                            "jiuwen ws chat.error url=%s user_id=%s session_id=%s error=%s payload=%s",
                            url,
                            self.user_id or "-",
                            sid or active_session_id or "-",
                            err,
                            json.dumps(payload, ensure_ascii=False)[:800],
                        )
                        if not chat_done.is_set():
                            fut_err = JiuwenWsError(err, code="CHAT_ERROR")
                            chat_error.append(fut_err)
                            for f in pending.values():
                                if not f.done():
                                    f.set_exception(fut_err)
                            chat_done.set()
                    elif event == "history.message" and collect_history and _sid_match(sid):
                        if is_history_stream_done(payload):
                            history_done.set()
                            continue
                        item = history_item_from_event_payload(payload)
                        if isinstance(item, dict):
                            history_messages.append(
                                self._normalize_history_item(
                                    item, base_url=self.base_url
                                )
                            )
            except ConnectionClosed as closed_exc:
                logger.warning(
                    "jiuwen ws connection closed during read url=%s user_id=%s code=%s reason=%s",
                    url,
                    self.user_id or "-",
                    getattr(closed_exc, "code", "-"),
                    getattr(closed_exc, "reason", "") or closed_exc,
                )
            finally:
                ack_done.set()
                chat_done.set()
                history_done.set()
                for f in pending.values():
                    if not f.done():
                        f.set_exception(JiuwenWsError("九问连接已关闭", code="CONNECTION_CLOSED"))

        try:
            await self._ensure_auth_token()
        except JiuwenWsError as exc:
            self._log_failure(
                stage="auth",
                url=url,
                methods=methods,
                open_timeout=open_timeout,
                elapsed_ms=(time.monotonic() - started) * 1000,
                exc=exc,
            )
            raise

        url = self._connect_url()
        headers: dict[str, str] = {}
        if self.user_id:
            headers["X-User-Id"] = self.user_id
        if self.cookie_header:
            headers["Cookie"] = self.cookie_header
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        connect_kwargs: dict[str, Any] = {
            "open_timeout": open_timeout,
            "max_size": 8 * 1024 * 1024,
        }
        if headers:
            connect_kwargs["additional_headers"] = headers

        last_rpc_payload: dict[str, Any] = {}
        logger.info(
            "jiuwen ws connecting url=%s user_id=%s has_token=%s has_cookie=%s methods=%s "
            "timeout_seconds=%s open_timeout=%s",
            url,
            self.user_id or "-",
            bool(self.auth_token),
            bool(self.cookie_header),
            ",".join(methods) or "-",
            timeout,
            open_timeout,
        )
        try:
            try:
                ws_cm = websockets.connect(url, **connect_kwargs)
            except TypeError:
                connect_kwargs.pop("additional_headers", None)
                if headers:
                    connect_kwargs["extra_headers"] = headers
                try:
                    ws_cm = websockets.connect(url, **connect_kwargs)
                except TypeError:
                    connect_kwargs.pop("extra_headers", None)
                    ws_cm = websockets.connect(url, **connect_kwargs)
            async with ws_cm as ws:
                logger.info(
                    "jiuwen ws connected url=%s user_id=%s has_token=%s has_cookie=%s elapsed_ms=%.0f",
                    url,
                    self.user_id or "-",
                    bool(self.auth_token),
                    bool(self.cookie_header),
                    (time.monotonic() - started) * 1000,
                )
                reader_task = asyncio.create_task(reader(ws))
                try:
                    try:
                        await asyncio.wait_for(ack_done.wait(), timeout=ack_timeout)
                    except asyncio.TimeoutError as exc:
                        raise JiuwenWsError(
                            "等待 connection.ack 超时", code="TIMEOUT"
                        ) from exc
                    if not ack_received:
                        raise JiuwenWsError(
                            "连接已关闭，未收到 connection.ack",
                            code="CONNECTION_CLOSED",
                        )
                    logger.info(
                        "jiuwen ws connection.ack ok user_id=%s elapsed_ms=%.0f",
                        self.user_id or "-",
                        (time.monotonic() - started) * 1000,
                    )

                    for method, params, _is_stream in calls:
                        send_params = dict(params or {})
                        if method == "session.create":
                            # Web 通道剥离/拒绝客户端 session_id，只认 create_token
                            send_params.pop("session_id", None)
                            send_params.pop("sessionId", None)
                            if not str(send_params.get("create_token") or "").strip():
                                send_params["create_token"] = secrets.token_hex(16)
                        elif method in ("chat.send", "history.get"):
                            if adopt_session_from_create and active_session_id:
                                send_params["session_id"] = active_session_id
                            elif not str(send_params.get("session_id") or "").strip():
                                if active_session_id:
                                    send_params["session_id"] = active_session_id
                                else:
                                    raise JiuwenWsError(
                                        f"{method} 缺少服务端 session_id",
                                        code="AUTH",
                                    )

                        req_id = f"req_{secrets.token_hex(8)}"
                        fut: asyncio.Future = asyncio.get_running_loop().create_future()
                        pending[req_id] = fut
                        is_stream = bool(
                            method in ("chat.send", "history.get") or _is_stream
                        )
                        envelope = {
                            "type": "req",
                            "id": req_id,
                            "method": method,
                            "params": send_params,
                            "is_stream": is_stream,
                        }
                        logger.info(
                            "jiuwen ws req send method=%s req_id=%s user_id=%s "
                            "active_session_id=%s params_session_id=%s create_token=%s",
                            method,
                            req_id,
                            self.user_id or "-",
                            active_session_id or "-",
                            str(send_params.get("session_id") or "").strip() or "-",
                            (str(send_params.get("create_token") or "").strip()[:12] + "…")
                            if str(send_params.get("create_token") or "").strip()
                            else "-",
                        )
                        await ws.send(json.dumps(envelope, ensure_ascii=False))
                        try:
                            res = await asyncio.wait_for(fut, timeout=timeout)
                        except asyncio.TimeoutError as exc:
                            raise JiuwenWsError(
                                f"九问请求超时: {method}", code="TIMEOUT"
                            ) from exc
                        finally:
                            pending.pop(req_id, None)
                        if not res.get("ok", True):
                            err = str(res.get("error") or f"{method} failed")
                            code = str(res.get("code") or "RPC_ERROR")
                            res_payload = (
                                res.get("payload")
                                if isinstance(res.get("payload"), dict)
                                else {}
                            )
                            err_sid = resolve_jiuwen_created_session_id(res_payload) or str(
                                send_params.get("session_id")
                                or active_session_id
                                or ""
                            ).strip()
                            res_preview = json.dumps(res, ensure_ascii=False)[:1600]
                            logger.error(
                                "jiuwen ws rpc failed method=%s req_id=%s user_id=%s "
                                "session_id=%s active_session_id=%s code=%s error=%s res=%s",
                                method,
                                req_id,
                                self.user_id or "-",
                                err_sid or "-",
                                active_session_id or "-",
                                code,
                                err,
                                res_preview,
                            )
                            create_token = str(
                                send_params.get("create_token") or ""
                            ).strip()
                            detail = err
                            extras: list[str] = []
                            if err_sid:
                                extras.append(f"session_id={err_sid}")
                            elif active_session_id:
                                extras.append(
                                    f"active_session_id={active_session_id}"
                                )
                            if create_token:
                                extras.append(f"create_token={create_token[:16]}…")
                            extras.append(f"method={method}")
                            if extras:
                                detail = f"{err} ({', '.join(extras)})"
                            raise JiuwenWsError(detail, code=code)
                        if isinstance(res.get("payload"), dict):
                            last_rpc_payload = dict(res["payload"])
                        if method == "session.create":
                            create_payload = (
                                dict(res["payload"])
                                if isinstance(res.get("payload"), dict)
                                else {}
                            )
                            server_sid = resolve_jiuwen_created_session_id(
                                create_payload
                            )
                            if not is_valid_jiuwen_session_id(server_sid):
                                payload_preview = json.dumps(
                                    create_payload, ensure_ascii=False
                                )[:1200]
                                logger.error(
                                    "jiuwen session.create returned invalid "
                                    "session_id=%r user_id=%s payload=%s",
                                    server_sid or "",
                                    self.user_id or "-",
                                    payload_preview,
                                )
                                raise JiuwenWsError(
                                    "session.create 返回非法 session_id="
                                    f"{server_sid or '(empty)'}（不能是 default/new）；"
                                    f"payload={payload_preview}",
                                    code="RPC_ERROR",
                                )
                            active_session_id = server_sid
                            logger.info(
                                "jiuwen session.create ok session_id=%s user_id=%s",
                                active_session_id,
                                self.user_id or "-",
                            )
                        if method == "history.get":
                            # 本地 ack 只有 accepted；消息在 history.message 流里
                            try:
                                await asyncio.wait_for(
                                    history_done.wait(),
                                    timeout=min(20.0, timeout),
                                )
                            except asyncio.TimeoutError:
                                logger.warning(
                                    "jiuwen history.get wait status=done timeout "
                                    "session_id=%s got_messages=%s",
                                    active_session_id or "-",
                                    len(history_messages),
                                )
                    if wait_chat:
                        try:
                            await asyncio.wait_for(chat_done.wait(), timeout=timeout)
                        except asyncio.TimeoutError as exc:
                            if reply_parts or reply_final:
                                if not reply_final:
                                    reply_final = "".join(reply_parts)
                                logger.warning(
                                    "jiuwen wait processing_status timeout; "
                                    "using partial reply session_id=%s",
                                    active_session_id or "-",
                                )
                            else:
                                raise JiuwenWsError(
                                    "等待九问回复超时（未收到 processing_status=false）",
                                    code="TIMEOUT",
                                ) from exc
                        if chat_error:
                            raise chat_error[0]
                finally:
                    reader_task.cancel()
                    try:
                        await reader_task
                    except asyncio.CancelledError:
                        pass
        except JiuwenWsError as exc:
            self._log_failure(
                stage="rpc",
                url=url,
                methods=methods,
                open_timeout=open_timeout,
                elapsed_ms=(time.monotonic() - started) * 1000,
                exc=exc,
            )
            raise
        except TypeError as exc:
            self._log_failure(
                stage="connect_kwargs",
                url=url,
                methods=methods,
                open_timeout=open_timeout,
                elapsed_ms=(time.monotonic() - started) * 1000,
                exc=exc,
            )
            raise
        except Exception as exc:
            wrapped = JiuwenWsError(f"无法连接九问: {exc}", code="UNREACHABLE")
            wrapped.__cause__ = exc
            self._log_failure(
                stage="connect",
                url=url,
                methods=methods,
                open_timeout=open_timeout,
                elapsed_ms=(time.monotonic() - started) * 1000,
                exc=wrapped,
            )
            raise wrapped from exc

        out: dict[str, Any] = {
            "session_id": str(
                active_session_id
                or create_payload.get("session_id")
                or create_payload.get("sessionId")
                or ""
            ),
            "reply": reply_final or "".join(reply_parts),
            "messages": history_messages,
            "create_payload": create_payload,
            "rpc_payload": last_rpc_payload,
            "ask_user": ask_user_payload,
            "files": collected_files,
            "tools": collected_tools,
            "reasoning": "".join(reasoning_parts),
        }
        return out

    @staticmethod
    def _normalize_history_item(
        payload: dict[str, Any], *, base_url: str = ""
    ) -> dict[str, Any]:
        item = payload
        nested = payload.get("message")
        if isinstance(nested, dict):
            item = nested
        role = str(item.get("role") or item.get("speaker") or "").strip().lower()
        if role in ("assistant", "ai", "bot", "agent"):
            role = "assistant"
        elif role in ("user", "human"):
            role = "user"
        elif role in ("system",):
            role = "system"
        else:
            role = role or "assistant"
        content = (
            item.get("content")
            or item.get("text")
            or item.get("query")
            or ""
        )
        # 勿把外层 payload.message(dict) 再当 content
        if not content and not isinstance(payload.get("message"), dict):
            content = payload.get("message") or ""
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    parts.append(str(block.get("text") or block.get("content") or ""))
                else:
                    parts.append(str(block))
            content = "\n".join(p for p in parts if p)
        elif isinstance(content, dict):
            content = str(content.get("text") or content.get("content") or "")
        created_at = item.get("created_at") or item.get("timestamp") or item.get("time") or ""
        files = normalize_file_items(
            item.get("files") or payload.get("files"), base_url=base_url
        )
        event_type = str(item.get("event_type") or payload.get("event_type") or "").strip()
        reasoning = str(
            item.get("reasoning_content")
            or item.get("reasoning")
            or payload.get("reasoning_content")
            or payload.get("reasoning")
            or ""
        )
        out_item: dict[str, Any] = {
            "role": role,
            "content": str(content or ""),
            "created_at": created_at,
        }
        if event_type:
            out_item["event_type"] = event_type
        if files:
            out_item["files"] = files
        if reasoning:
            out_item["reasoning"] = reasoning
        if event_type == "chat.tool_call":
            tool_call = normalize_tool_call_payload(item)
            if tool_call:
                out_item["tool_call"] = tool_call
        elif event_type == "chat.tool_result":
            tool_result = normalize_tool_result_payload(item)
            if tool_result:
                out_item["tool_result"] = tool_result
        return out_item


async def jiuwen_create_and_chat(
    *,
    ws_url: str,
    user_id: str,
    content: str,
    title: str = "",
    model_name: str = "",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
    session_id: str = "",
    on_delta: OnDeltaCallback | None = None,
    on_reasoning: OnReasoningCallback | None = None,
    on_ask_user: OnAskUserCallback | None = None,
    on_file: OnFileCallback | None = None,
    on_tool_call: OnToolCallCallback | None = None,
    on_tool_result: OnToolResultCallback | None = None,
) -> dict[str, Any]:
    client = JiuwenWsClient(
        ws_url,
        user_id=user_id,
        base_url=base_url,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    return await client.create_session_and_chat(
        content=content,
        title=title,
        model_name=model_name,
        session_id=session_id,
        on_delta=on_delta,
        on_reasoning=on_reasoning,
        on_ask_user=on_ask_user,
        on_file=on_file,
        on_tool_call=on_tool_call,
        on_tool_result=on_tool_result,
    )


async def jiuwen_chat(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    content: str,
    model_name: str = "",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
    on_delta: OnDeltaCallback | None = None,
    on_reasoning: OnReasoningCallback | None = None,
    on_ask_user: OnAskUserCallback | None = None,
    on_file: OnFileCallback | None = None,
    on_tool_call: OnToolCallCallback | None = None,
    on_tool_result: OnToolResultCallback | None = None,
) -> dict[str, Any]:
    client = JiuwenWsClient(
        ws_url,
        user_id=user_id,
        base_url=base_url,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    return await client.chat(
        session_id=session_id,
        content=content,
        model_name=model_name,
        on_delta=on_delta,
        on_reasoning=on_reasoning,
        on_ask_user=on_ask_user,
        on_file=on_file,
        on_tool_call=on_tool_call,
        on_tool_result=on_tool_result,
    )


async def jiuwen_answer_ask_user(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    request_id: str,
    answers: list[dict[str, Any]],
    source: str = "ask_user_interrupt",
    model_name: str = "",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
    on_delta: OnDeltaCallback | None = None,
    on_reasoning: OnReasoningCallback | None = None,
    on_ask_user: OnAskUserCallback | None = None,
    on_file: OnFileCallback | None = None,
    on_tool_call: OnToolCallCallback | None = None,
    on_tool_result: OnToolResultCallback | None = None,
    extra_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    client = JiuwenWsClient(
        ws_url,
        user_id=user_id,
        base_url=base_url,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    return await client.answer_ask_user(
        session_id=session_id,
        request_id=request_id,
        answers=answers,
        source=source,
        model_name=model_name,
        on_delta=on_delta,
        on_reasoning=on_reasoning,
        on_ask_user=on_ask_user,
        on_file=on_file,
        on_tool_call=on_tool_call,
        on_tool_result=on_tool_result,
        extra_params=extra_params,
    )


async def _iter_jiuwen_chat_events(
    work: Callable[
        [
            OnDeltaCallback,
            OnReasoningCallback,
            OnAskUserCallback,
            OnFileCallback,
            OnToolCallCallback,
            OnToolResultCallback,
        ],
        Awaitable[dict[str, Any]],
    ],
) -> AsyncIterator[dict[str, Any]]:
    """Run jiuwen chat work and yield chat timeline events for the SSE BFF."""
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def on_delta(delta: str) -> None:
        await queue.put({"type": "delta", "delta": str(delta or "")})

    async def on_reasoning(content: str) -> None:
        await queue.put({"type": "reasoning", "content": str(content or "")})

    async def on_ask_user(payload: dict[str, Any]) -> None:
        await queue.put({"type": "ask_user", **dict(payload or {})})

    async def on_file(files: list[dict[str, Any]]) -> None:
        await queue.put({"type": "file", "files": list(files or [])})

    async def on_tool_call(payload: dict[str, Any]) -> None:
        await queue.put({"type": "tool_call", "tool_call": dict(payload or {})})

    async def on_tool_result(payload: dict[str, Any]) -> None:
        await queue.put({"type": "tool_result", "tool_result": dict(payload or {})})

    async def runner() -> None:
        try:
            result = await work(
                on_delta,
                on_reasoning,
                on_ask_user,
                on_file,
                on_tool_call,
                on_tool_result,
            )
            done_ev: dict[str, Any] = {
                "type": "done",
                "reply": str(result.get("reply") or ""),
                "session_id": str(result.get("session_id") or ""),
            }
            ask = result.get("ask_user")
            if isinstance(ask, dict) and ask:
                done_ev["ask_user"] = ask
            files = result.get("files")
            if isinstance(files, list) and files:
                done_ev["files"] = files
            tools = result.get("tools")
            if isinstance(tools, list) and tools:
                done_ev["tools"] = tools
            reasoning = str(result.get("reasoning") or "")
            if reasoning:
                done_ev["reasoning"] = reasoning
            await queue.put(done_ev)
        except JiuwenWsError as exc:
            await queue.put(
                {
                    "type": "error",
                    "error": str(exc),
                    "code": str(getattr(exc, "code", "") or ""),
                }
            )
        except Exception as exc:  # noqa: BLE001
            await queue.put({"type": "error", "error": str(exc), "code": "UNEXPECTED"})
        finally:
            await queue.put(None)

    task = asyncio.create_task(runner())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


async def jiuwen_create_and_chat_stream(
    *,
    ws_url: str,
    user_id: str,
    content: str,
    title: str = "",
    model_name: str = "",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
    session_id: str = "",
) -> AsyncIterator[dict[str, Any]]:
    async def work(
        on_delta: OnDeltaCallback,
        on_reasoning: OnReasoningCallback,
        on_ask_user: OnAskUserCallback,
        on_file: OnFileCallback,
        on_tool_call: OnToolCallCallback,
        on_tool_result: OnToolResultCallback,
    ) -> dict[str, Any]:
        return await jiuwen_create_and_chat(
            ws_url=ws_url,
            user_id=user_id,
            content=content,
            title=title,
            model_name=model_name,
            base_url=base_url,
            admin_token=admin_token,
            timeout_seconds=timeout_seconds,
            session_id=session_id,
            on_delta=on_delta,
            on_reasoning=on_reasoning,
            on_ask_user=on_ask_user,
            on_file=on_file,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
        )

    async for ev in _iter_jiuwen_chat_events(work):
        yield ev


async def jiuwen_chat_stream(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    content: str,
    model_name: str = "",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[dict[str, Any]]:
    async def work(
        on_delta: OnDeltaCallback,
        on_reasoning: OnReasoningCallback,
        on_ask_user: OnAskUserCallback,
        on_file: OnFileCallback,
        on_tool_call: OnToolCallCallback,
        on_tool_result: OnToolResultCallback,
    ) -> dict[str, Any]:
        return await jiuwen_chat(
            ws_url=ws_url,
            user_id=user_id,
            session_id=session_id,
            content=content,
            model_name=model_name,
            base_url=base_url,
            admin_token=admin_token,
            timeout_seconds=timeout_seconds,
            on_delta=on_delta,
            on_reasoning=on_reasoning,
            on_ask_user=on_ask_user,
            on_file=on_file,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
        )

    async for ev in _iter_jiuwen_chat_events(work):
        yield ev


async def jiuwen_answer_ask_user_stream(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    request_id: str,
    answers: list[dict[str, Any]],
    source: str = "ask_user_interrupt",
    model_name: str = "",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
    extra_params: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    async def work(
        on_delta: OnDeltaCallback,
        on_reasoning: OnReasoningCallback,
        on_ask_user: OnAskUserCallback,
        on_file: OnFileCallback,
        on_tool_call: OnToolCallCallback,
        on_tool_result: OnToolResultCallback,
    ) -> dict[str, Any]:
        return await jiuwen_answer_ask_user(
            ws_url=ws_url,
            user_id=user_id,
            session_id=session_id,
            request_id=request_id,
            answers=answers,
            source=source,
            model_name=model_name,
            base_url=base_url,
            admin_token=admin_token,
            timeout_seconds=timeout_seconds,
            on_delta=on_delta,
            on_reasoning=on_reasoning,
            on_ask_user=on_ask_user,
            on_file=on_file,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
            extra_params=extra_params,
        )

    async for ev in _iter_jiuwen_chat_events(work):
        yield ev


async def jiuwen_interrupt(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    intent: str = "cancel",
    mode: str = "agent",
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    client = JiuwenWsClient(
        ws_url,
        user_id=user_id,
        base_url=base_url,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    return await client.interrupt(
        session_id=session_id,
        intent=intent,
        mode=mode,
    )


async def jiuwen_list_models(
    *,
    ws_url: str,
    user_id: str,
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    client = JiuwenWsClient(
        ws_url,
        user_id=user_id,
        base_url=base_url,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    return await client.list_models()


async def jiuwen_history(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    page_idx: int = 1,
    base_url: str = "",
    admin_token: str = "",
    timeout_seconds: float = 60.0,
) -> list[dict[str, Any]]:
    client = JiuwenWsClient(
        ws_url,
        user_id=user_id,
        base_url=base_url,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    return await client.history(session_id=session_id, page_idx=page_idx)
