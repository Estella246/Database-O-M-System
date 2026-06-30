"""长耗时 HTTP 请求：周期性输出 keepalive，避免网关 proxy_read_timeout 断开连接。"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from config import MIGRATE_LEGACY_KEEPALIVE_INTERVAL_SECONDS

STREAM_KEEPALIVE_HEADER = "X-Stream-Keepalive"


def wants_stream_keepalive(request: Request) -> bool:
    return request.headers.get(STREAM_KEEPALIVE_HEADER, "").strip() == "1"


async def maybe_stream_json_response(
    request: Request,
    work: Callable[[], dict[str, Any]],
) -> dict[str, Any] | StreamingResponse:
    """同步 work 返回 dict；若请求头要求 keepalive 且耗时较长，则流式输出。"""
    if not wants_stream_keepalive(request):
        return work()

    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(None, work)
    interval = max(1, int(MIGRATE_LEGACY_KEEPALIVE_INTERVAL_SECONDS))

    done, _ = await asyncio.wait({asyncio.wrap_future(fut)}, timeout=0.05)
    if done:
        return fut.result()

    async def generate():
        while True:
            done, _ = await asyncio.wait({asyncio.wrap_future(fut)}, timeout=interval)
            if done:
                try:
                    result = fut.result()
                except HTTPException as exc:
                    payload = {"ok": False, "detail": exc.detail}
                    yield json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    return
                except Exception as exc:  # noqa: BLE001
                    payload = {"ok": False, "detail": str(exc)}
                    yield json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    return
                yield json.dumps(result, ensure_ascii=False).encode("utf-8")
                return
            yield b"\n"

    return StreamingResponse(generate(), media_type="application/json")
