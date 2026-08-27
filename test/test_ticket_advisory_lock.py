"""建单咨询锁：取号后须释放，避免并发 submit 互相阻塞导致网关 504。"""

from __future__ import annotations

import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app import app
from database import db_conn
from utils.ticket_no import _YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2


def _build_problem_fill_payload(client: TestClient) -> dict:
    schema_resp = client.get("/api/nodes/problem_fill/schema")
    assert schema_resp.status_code == 200, schema_resp.text[:200]
    fields = schema_resp.json()["fields"]
    values: dict[str, str] = {}
    for f in fields:
        key = f["key"]
        if not f.get("required", False):
            continue
        if f.get("readonly", False):
            continue
        if f.get("default_type") in ("today", "login_user"):
            continue
        options = f.get("options", [])
        if options:
            if key == "biz_env" and "运维阶段" in options:
                values[key] = "运维阶段"
            elif key == "problem_env" and "生产环境" in options:
                values[key] = "生产环境"
            else:
                values[key] = options[0]
        elif f.get("type") == "text":
            values[key] = f"test_{key}"
        elif f.get("type") == "richtext":
            values[key] = f"<p>test {key}</p>"
        elif f.get("type") == "date":
            values[key] = "2026-04-27"
    pl = str(values.get("product_line") or "").strip()
    if "ecare_ticket_no" in values:
        values["ecare_ticket_no"] = "12345678901234" if pl == "公有云" else "12345678"
    return {
        "values": values,
        "operator_id": "test_user01",
        "operator_name": "测试用户01",
        "create_intent": True,
    }


@pytest.fixture
def inproc_client() -> TestClient:
    return TestClient(app)


def test_concurrent_draft_submit_not_blocked_by_slow_peer(inproc_client: TestClient, monkeypatch) -> None:
    """一笔 submit 在取号后的慢路径上等待时，另一笔 draft 建单应能尽快完成。"""
    import routers.tickets as tickets_mod

    peer_past_allocate = threading.Event()
    allow_peer_finish = threading.Event()

    orig_refresh = tickets_mod._refresh_ticket_list_snapshot_after_commit
    refresh_calls = {"n": 0}

    def slow_refresh(ticket: dict) -> None:
        refresh_calls["n"] += 1
        if refresh_calls["n"] == 1:
            peer_past_allocate.set()
            assert allow_peer_finish.wait(timeout=30), "test peer did not finish in time"
        return orig_refresh(ticket)

    monkeypatch.setattr(tickets_mod, "_refresh_ticket_list_snapshot_after_commit", slow_refresh)

    payload = _build_problem_fill_payload(inproc_client)
    draft_slow = f"draft-{uuid.uuid4()}"
    result: dict[str, object] = {"status": None, "elapsed": None, "error": None}

    def slow_submit() -> None:
        try:
            inproc_client.post(
                f"/api/tickets/{draft_slow}/nodes/problem_fill/submit",
                json=payload,
            )
        finally:
            allow_peer_finish.set()

    worker = threading.Thread(target=slow_submit, daemon=True)
    worker.start()
    assert peer_past_allocate.wait(timeout=30), "slow submit never passed ticket allocation"

    draft_fast = f"draft-{uuid.uuid4()}"
    t0 = time.time()
    resp = inproc_client.post(
        f"/api/tickets/{draft_fast}/nodes/problem_fill/submit",
        json=payload,
    )
    elapsed = time.time() - t0
    result["status"] = resp.status_code
    result["elapsed"] = elapsed

    allow_peer_finish.set()
    worker.join(timeout=30)

    assert resp.status_code == 200, resp.text[:300]
    assert elapsed < 10, f"concurrent draft submit blocked too long ({elapsed:.1f}s)"


def test_get_or_create_ticket_releases_session_advisory_lock() -> None:
    """取号完成后应释放会话咨询锁，同连接可再次获取同一把锁。"""
    from routers.tickets import _get_or_create_ticket

    with db_conn() as conn:
        _get_or_create_ticket(
            conn,
            f"draft-{uuid.uuid4()}",
            "test_user01",
            "测试用户01",
            "problem_fill",
            create_intent=True,
        )
        conn.rollback()

        acquired = conn.execute(
            "SELECT pg_try_advisory_lock(%s, %s) AS ok",
            (_YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2),
        ).fetchone()
        assert acquired and acquired.get("ok") is True
        conn.execute(
            "SELECT pg_advisory_unlock(%s, %s)",
            (_YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2),
        )
