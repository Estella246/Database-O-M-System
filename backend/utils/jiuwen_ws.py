"""JiuwenSwarm WebChannel WebSocket client (session.create / chat.send / history.get)."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
import urllib.parse
from typing import Any, Optional

logger = logging.getLogger(__name__)


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


class JiuwenWsClient:
    """One-shot connection: connect → RPC → wait for chat.final / history → close."""

    def __init__(
        self,
        ws_url: str,
        *,
        user_id: str = "",
        timeout_seconds: float = 60.0,
    ):
        self.ws_url = str(ws_url or "").strip()
        self.user_id = str(user_id or "").strip()
        self.timeout_seconds = float(timeout_seconds)

    def _connect_url(self) -> str:
        if not self.ws_url:
            raise JiuwenWsError("JIUWEN_WS_URL 未配置", code="NOT_CONFIGURED")
        if not self.user_id:
            return self.ws_url
        sep = "&" if "?" in self.ws_url else "?"
        return f"{self.ws_url}{sep}user_id={urllib.parse.quote(self.user_id)}"

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

    async def create_session_and_chat(
        self,
        *,
        session_id: str,
        content: str,
        title: str = "",
        mode: str = "agent.fast",
        model_name: str = "",
    ) -> dict[str, Any]:
        """session.create + chat.send; return {session_id, reply}."""
        create_params: dict[str, Any] = {
            "session_id": session_id,
            "title": (title or "提单助手")[:200],
            "mode": mode,
            "work_mode": "work",
            "create_token": secrets.token_hex(16),
        }
        chat_params: dict[str, Any] = {
            "session_id": session_id,
            "content": content,
            "query": content,
            "mode": mode,
        }
        model = str(model_name or "").strip()
        if model:
            create_params["model_name"] = model
            chat_params["model_name"] = model
        return await self._run(
            [
                ("session.create", create_params, False),
                ("chat.send", chat_params, True),
            ],
            wait_chat_final_for_session=session_id,
        )

    async def chat(
        self,
        *,
        session_id: str,
        content: str,
        mode: str = "agent.fast",
        model_name: str = "",
    ) -> dict[str, Any]:
        chat_params: dict[str, Any] = {
            "session_id": session_id,
            "content": content,
            "query": content,
            "mode": mode,
        }
        model = str(model_name or "").strip()
        if model:
            chat_params["model_name"] = model
        return await self._run(
            [
                ("chat.send", chat_params, True),
            ],
            wait_chat_final_for_session=session_id,
        )

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
        result = await self._run(
            [
                (
                    "history.get",
                    {"session_id": session_id, "page_idx": max(1, int(page_idx))},
                    False,
                ),
            ],
            collect_history_for_session=session_id,
        )
        return list(result.get("messages") or [])

    async def _run(
        self,
        calls: list[tuple[str, dict[str, Any], bool]],
        *,
        wait_chat_final_for_session: str = "",
        collect_history_for_session: str = "",
    ) -> dict[str, Any]:
        try:
            import websockets
            from websockets.exceptions import ConnectionClosed
        except ImportError as exc:
            raise JiuwenWsError("缺少 websockets 依赖，请安装后重试", code="DEPENDENCY") from exc

        url = self._connect_url()
        timeout = self.timeout_seconds
        open_timeout = min(15.0, timeout)
        methods = [str(m) for m, _p, _s in calls]
        started = time.monotonic()
        reply_parts: list[str] = []
        reply_final = ""
        history_messages: list[dict[str, Any]] = []
        history_done = asyncio.Event()
        chat_done = asyncio.Event()
        pending: dict[str, asyncio.Future] = {}
        create_payload: dict[str, Any] = {}

        async def reader(ws):
            nonlocal reply_final
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
                    event = str(msg.get("event") or msg.get("event_type") or "")
                    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
                    sid = str(payload.get("session_id") or "")
                    if event == "chat.delta" and (
                        not wait_chat_final_for_session or sid == wait_chat_final_for_session
                    ):
                        delta = payload.get("delta") or payload.get("content") or payload.get("text") or ""
                        if delta:
                            reply_parts.append(str(delta))
                    elif event == "chat.final" and (
                        not wait_chat_final_for_session or sid == wait_chat_final_for_session
                    ):
                        content = (
                            payload.get("content")
                            or payload.get("text")
                            or payload.get("reply")
                            or "".join(reply_parts)
                        )
                        reply_final = str(content or "")
                        chat_done.set()
                    elif event == "chat.error" and (
                        not wait_chat_final_for_session or sid == wait_chat_final_for_session
                    ):
                        err = str(payload.get("error") or payload.get("message") or "九问对话失败")
                        logger.error(
                            "jiuwen ws chat.error url=%s user_id=%s session_id=%s error=%s payload=%s",
                            url,
                            self.user_id or "-",
                            sid or wait_chat_final_for_session or "-",
                            err,
                            json.dumps(payload, ensure_ascii=False)[:800],
                        )
                        if not chat_done.is_set():
                            fut_err = JiuwenWsError(err, code="CHAT_ERROR")
                            for f in pending.values():
                                if not f.done():
                                    f.set_exception(fut_err)
                            chat_done.set()
                    elif event == "history.message" and (
                        not collect_history_for_session or sid == collect_history_for_session
                    ):
                        history_messages.append(self._normalize_history_item(payload))
                    elif event in ("history.done", "history.end", "history.complete") and (
                        not collect_history_for_session or sid == collect_history_for_session
                    ):
                        history_done.set()
            except ConnectionClosed as closed_exc:
                logger.warning(
                    "jiuwen ws connection closed during read url=%s user_id=%s code=%s reason=%s",
                    url,
                    self.user_id or "-",
                    getattr(closed_exc, "code", "-"),
                    getattr(closed_exc, "reason", "") or closed_exc,
                )
            finally:
                chat_done.set()
                history_done.set()
                for f in pending.values():
                    if not f.done():
                        f.set_exception(JiuwenWsError("九问连接已关闭", code="CONNECTION_CLOSED"))

        connect_kwargs: dict[str, Any] = {
            "open_timeout": open_timeout,
            "max_size": 8 * 1024 * 1024,
        }
        if self.user_id:
            connect_kwargs["additional_headers"] = {"X-User-Id": self.user_id}

        last_rpc_payload: dict[str, Any] = {}
        logger.info(
            "jiuwen ws connecting url=%s user_id=%s methods=%s "
            "timeout_seconds=%s open_timeout=%s",
            url,
            self.user_id or "-",
            ",".join(methods) or "-",
            timeout,
            open_timeout,
        )
        try:
            try:
                ws_cm = websockets.connect(url, **connect_kwargs)
            except TypeError:
                connect_kwargs.pop("additional_headers", None)
                if self.user_id:
                    connect_kwargs["extra_headers"] = {"X-User-Id": self.user_id}
                try:
                    ws_cm = websockets.connect(url, **connect_kwargs)
                except TypeError:
                    connect_kwargs.pop("extra_headers", None)
                    ws_cm = websockets.connect(url, **connect_kwargs)
            async with ws_cm as ws:
                logger.info(
                    "jiuwen ws connected url=%s user_id=%s elapsed_ms=%.0f",
                    url,
                    self.user_id or "-",
                    (time.monotonic() - started) * 1000,
                )
                reader_task = asyncio.create_task(reader(ws))
                try:
                    for method, params, _is_stream in calls:
                        req_id = f"req_{secrets.token_hex(8)}"
                        fut: asyncio.Future = asyncio.get_running_loop().create_future()
                        pending[req_id] = fut
                        envelope = {
                            "type": "req",
                            "id": req_id,
                            "method": method,
                            "params": params,
                            "is_stream": bool(method == "chat.send"),
                        }
                        await ws.send(json.dumps(envelope, ensure_ascii=False))
                        try:
                            res = await asyncio.wait_for(fut, timeout=timeout)
                        except asyncio.TimeoutError as exc:
                            raise JiuwenWsError(f"九问请求超时: {method}", code="TIMEOUT") from exc
                        finally:
                            pending.pop(req_id, None)
                        if not res.get("ok", True):
                            err = str(res.get("error") or f"{method} failed")
                            code = str(res.get("code") or "RPC_ERROR")
                            raise JiuwenWsError(err, code=code)
                        if isinstance(res.get("payload"), dict):
                            last_rpc_payload = dict(res["payload"])
                        if method == "session.create" and isinstance(res.get("payload"), dict):
                            create_payload = dict(res["payload"])
                        if method == "history.get":
                            payload = res.get("payload") if isinstance(res.get("payload"), dict) else {}
                            items = payload.get("messages") or payload.get("records") or []
                            if isinstance(items, list) and items:
                                history_messages.extend(
                                    self._normalize_history_item(x) for x in items if isinstance(x, dict)
                                )
                                history_done.set()
                            else:
                                try:
                                    await asyncio.wait_for(history_done.wait(), timeout=min(20.0, timeout))
                                except asyncio.TimeoutError:
                                    pass
                    if wait_chat_final_for_session:
                        try:
                            await asyncio.wait_for(chat_done.wait(), timeout=timeout)
                        except asyncio.TimeoutError as exc:
                            if reply_parts and not reply_final:
                                reply_final = "".join(reply_parts)
                            else:
                                raise JiuwenWsError("等待九问回复超时", code="TIMEOUT") from exc
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
            # older websockets may not accept additional_headers
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
            "session_id": str(create_payload.get("session_id") or wait_chat_final_for_session or ""),
            "reply": reply_final or "".join(reply_parts),
            "messages": history_messages,
            "create_payload": create_payload,
            "rpc_payload": last_rpc_payload,
        }
        return out

    @staticmethod
    def _normalize_history_item(payload: dict[str, Any]) -> dict[str, Any]:
        role = str(payload.get("role") or payload.get("speaker") or "").strip().lower()
        if role in ("assistant", "ai", "bot", "agent"):
            role = "assistant"
        elif role in ("user", "human"):
            role = "user"
        elif role in ("system",):
            role = "system"
        else:
            role = role or "assistant"
        content = (
            payload.get("content")
            or payload.get("text")
            or payload.get("message")
            or payload.get("query")
            or ""
        )
        if isinstance(content, list):
            # structured content blocks
            parts = []
            for block in content:
                if isinstance(block, dict):
                    parts.append(str(block.get("text") or block.get("content") or ""))
                else:
                    parts.append(str(block))
            content = "\n".join(p for p in parts if p)
        created_at = payload.get("created_at") or payload.get("timestamp") or payload.get("time") or ""
        return {
            "role": role,
            "content": str(content or ""),
            "created_at": created_at,
        }


async def jiuwen_create_and_chat(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    content: str,
    title: str = "",
    model_name: str = "",
    timeout_seconds: float = 60.0,
) -> dict[str, Any]:
    client = JiuwenWsClient(ws_url, user_id=user_id, timeout_seconds=timeout_seconds)
    return await client.create_session_and_chat(
        session_id=session_id,
        content=content,
        title=title,
        model_name=model_name,
    )


async def jiuwen_chat(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    content: str,
    model_name: str = "",
    timeout_seconds: float = 60.0,
) -> dict[str, Any]:
    client = JiuwenWsClient(ws_url, user_id=user_id, timeout_seconds=timeout_seconds)
    return await client.chat(
        session_id=session_id, content=content, model_name=model_name
    )


async def jiuwen_list_models(
    *,
    ws_url: str,
    user_id: str,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    client = JiuwenWsClient(ws_url, user_id=user_id, timeout_seconds=timeout_seconds)
    return await client.list_models()


async def jiuwen_history(
    *,
    ws_url: str,
    user_id: str,
    session_id: str,
    page_idx: int = 1,
    timeout_seconds: float = 60.0,
) -> list[dict[str, Any]]:
    client = JiuwenWsClient(ws_url, user_id=user_id, timeout_seconds=timeout_seconds)
    return await client.history(session_id=session_id, page_idx=page_idx)
