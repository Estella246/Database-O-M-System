"""长耗时 HTTP keepalive 流式响应测试。"""
from __future__ import annotations

import json
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from utils.long_request_stream import STREAM_KEEPALIVE_HEADER, maybe_stream_json_response

app = FastAPI()


@app.post("/slow")
async def slow(request: Request) -> dict:
    def work() -> dict:
        time.sleep(0.12)
        return {"ok": True, "done": True}

    return await maybe_stream_json_response(request, work)


@app.post("/fast-error")
async def fast_error(request: Request) -> dict:
    def work() -> dict:
        raise HTTPException(status_code=403, detail="无权限")

    return await maybe_stream_json_response(request, work)


client = TestClient(app)


def test_stream_keepalive_returns_json():
    resp = client.post("/slow", headers={STREAM_KEEPALIVE_HEADER: "1"})
    assert resp.status_code == 200
    data = json.loads(resp.text.strip())
    assert data == {"ok": True, "done": True}


def test_without_keepalive_header_returns_json():
    resp = client.post("/slow")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "done": True}


def test_fast_http_exception_without_stream():
    resp = client.post("/fast-error")
    assert resp.status_code == 403


def test_fast_http_exception_with_stream():
    resp = client.post("/fast-error", headers={STREAM_KEEPALIVE_HEADER: "1"})
    assert resp.status_code == 403
