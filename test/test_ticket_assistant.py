"""提单助手：九问 BFF 单元测试 + 进程内 API（可 mock 九问）。"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("SKIP_SSO_AUTH", "1")


@pytest.fixture(scope="module")
def ta_client():
    from fastapi.testclient import TestClient
    from app import app

    with TestClient(app) as client:
        yield client


def _build_problem_fill_form_values(client, overrides=None) -> dict:
    """按 problem_fill schema 拼齐必填，供转人工正式建单。"""
    schema_resp = client.get("/api/nodes/problem_fill/schema")
    assert schema_resp.status_code == 200, schema_resp.text[:300]
    fields = schema_resp.json()["fields"]
    values: dict = {}
    for f in fields:
        key = f["key"]
        if overrides and key in overrides:
            values[key] = overrides[key]
            continue
        if not f.get("required", False):
            continue
        if f.get("readonly", False):
            continue
        if f.get("default_type") in ("today", "login_user"):
            continue
        options = f.get("options") or []
        if options:
            values[key] = options[0]
        elif f.get("type") == "text":
            values[key] = f"test_{key}"
        elif f.get("type") == "richtext":
            values[key] = f"<p>test {key}</p>"
        elif f.get("type") == "date":
            values[key] = "2026-08-04"
    if overrides:
        values.update(overrides)
    return values


class TestJiuwenWsHelpers:
    def test_make_jiuwen_session_id_format(self):
        from utils.jiuwen_ws import make_jiuwen_session_id

        sid = make_jiuwen_session_id()
        assert sid.startswith("sess_")
        assert len(sid.split("_")) == 3

    def test_build_form_context_message(self):
        from utils.jiuwen_ws import build_form_context_message

        text = build_form_context_message(
            {
                "issue_desc": "<p>PVC 挂载失败</p>",
                "location": "某局点",
                "severity": "严重",
            },
            operator_id="zhangsan",
            operator_name="张三",
        )
        assert "PVC 挂载失败" in text
        assert "某局点" in text
        assert "严重" in text
        assert "张三" in text

    def test_normalize_history_item(self):
        from utils.jiuwen_ws import JiuwenWsClient

        item = JiuwenWsClient._normalize_history_item(
            {"role": "ai", "content": "hello", "created_at": "t"}
        )
        assert item["role"] == "assistant"
        assert item["content"] == "hello"

    def test_format_exception_chain_includes_cause(self):
        from utils.jiuwen_ws import format_exception_chain

        root = OSError(110, "Connection timed out")
        wrapped = RuntimeError("无法连接九问")
        wrapped.__cause__ = root
        text = format_exception_chain(wrapped)
        assert "RuntimeError" in text
        assert "OSError" in text
        assert "110" in text


class TestTicketAssistantApiInProcess:
    def test_list_sessions(self, ta_client):
        resp = ta_client.get(
            "/api/ticket-assistant/sessions",
            params={"operator_id": "test_admin"},
        )
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()

    def test_create_requires_form_or_initial_message(self, ta_client):
        resp = ta_client.post(
            "/api/ticket-assistant/sessions",
            json={"operator_id": "test_admin", "form_values": {}, "initial_message": ""},
        )
        assert resp.status_code in (400, 503)
        if resp.status_code == 400:
            assert "form_values" in str(resp.json().get("detail", "")) or "initial_message" in str(
                resp.json().get("detail", "")
            )

    def test_create_with_initial_message(self, ta_client):
        async def fake_create_and_chat(**kwargs):
            assert "纯对话首条" in str(kwargs.get("content") or "")
            return {
                "session_id": kwargs["session_id"],
                "reply": "纯对话模拟回复",
                "messages": [],
            }

        with patch(
            "routers.ticket_assistant.jiuwen_create_and_chat",
            new=AsyncMock(side_effect=fake_create_and_chat),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            resp = ta_client.post(
                "/api/ticket-assistant/sessions",
                json={
                    "operator_id": "test_admin",
                    "operator_name": "测试管理员",
                    "form_values": {},
                    "initial_message": "纯对话首条：如何排查 PVC？",
                },
            )
        if resp.status_code == 503 and "0112" in str(resp.json().get("detail", "")):
            pytest.skip("迁移 0112 未应用")
        assert resp.status_code == 200, resp.text[:800]
        body = resp.json()
        assert body["item"]["status"] == "chatting"
        assert not body["item"].get("form_values")
        assert "纯对话模拟回复" in body.get("reply", "")
        assert "纯对话" in str(body["item"].get("title") or "")

    def test_jiuwen_disabled_returns_503(self, ta_client):
        with patch("routers.ticket_assistant.JIUWEN_ENABLED", False):
            resp = ta_client.post(
                "/api/ticket-assistant/sessions",
                json={
                    "operator_id": "test_admin",
                    "form_values": {"issue_desc": "disabled"},
                },
            )
        if resp.status_code == 503 and "0112" in str(resp.json().get("detail", "")):
            pytest.skip("迁移 0112 未应用")
        assert resp.status_code == 503

    def test_create_session_with_mocked_jiuwen(self, ta_client):
        async def fake_create_and_chat(**kwargs):
            return {
                "session_id": kwargs["session_id"],
                "reply": "这是九问模拟回复",
                "messages": [],
            }

        with patch(
            "routers.ticket_assistant.jiuwen_create_and_chat",
            new=AsyncMock(side_effect=fake_create_and_chat),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            resp = ta_client.post(
                "/api/ticket-assistant/sessions",
                json={
                    "operator_id": "test_admin",
                    "operator_name": "测试管理员",
                    "form_values": {
                        "issue_desc": "提单助手联调问题描述",
                        "location": "测试局点",
                        "severity": "一般",
                        "start_date": "2026-08-04",
                        "biz_env": "生产",
                        "next_handler": "审核人 test_reviewer",
                    },
                },
            )
        if resp.status_code == 503 and "0112" in str(resp.json().get("detail", "")):
            pytest.skip("迁移 0112 未应用")
        assert resp.status_code == 200, resp.text[:800]
        body = resp.json()
        assert body["item"]["status"] == "chatting"
        assert body["item"]["jiuwen_session_id"].startswith("sess_")
        assert "九问模拟回复" in body.get("reply", "")

        sid = body["item"]["id"]
        detail = ta_client.get(
            f"/api/ticket-assistant/sessions/{sid}",
            params={"operator_id": "test_admin"},
        )
        assert detail.status_code == 200
        assert detail.json()["item"]["form_values"]["location"] == "测试局点"

        forbidden = ta_client.get(
            f"/api/ticket-assistant/sessions/{sid}",
            params={"operator_id": "other_user"},
        )
        assert forbidden.status_code == 403

    def test_list_models_strips_secrets(self, ta_client):
        async def fake_list_models(**kwargs):
            return {
                "models": [
                    {
                        "model_name": "gpt-test",
                        "alias": "主对话",
                        "api_key": "secret-should-not-leak",
                        "api_base": "https://example.test/v1",
                        "model_provider": "openai",
                        "is_default": True,
                    }
                ],
                "active_model": "gpt-test",
            }

        with patch(
            "routers.ticket_assistant.jiuwen_list_models",
            new=AsyncMock(side_effect=fake_list_models),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            resp = ta_client.get(
                "/api/ticket-assistant/models",
                params={"operator_id": "test_admin"},
            )
        assert resp.status_code == 200, resp.text[:500]
        body = resp.json()
        assert body["active_model"] in ("gpt-test", "主对话")
        assert body["items"][0]["model_name"] == "gpt-test"
        assert "api_key" not in body["items"][0]
        assert "secret" not in resp.text

    def test_chat_with_mocked_jiuwen(self, ta_client):
        async def fake_create_and_chat(**kwargs):
            return {"session_id": kwargs["session_id"], "reply": "首答", "messages": []}

        async def fake_chat(**kwargs):
            return {"session_id": kwargs["session_id"], "reply": f"回复:{kwargs['content']}", "messages": []}

        with patch(
            "routers.ticket_assistant.jiuwen_create_and_chat",
            new=AsyncMock(side_effect=fake_create_and_chat),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            create_resp = ta_client.post(
                "/api/ticket-assistant/sessions",
                json={
                    "operator_id": "test_admin",
                    "operator_name": "测试管理员",
                    "form_values": {"issue_desc": "续聊测试", "severity": "一般"},
                },
            )
        if create_resp.status_code == 503:
            pytest.skip("迁移 0112 未应用或服务不可用")
        assert create_resp.status_code == 200, create_resp.text[:800]
        sid = create_resp.json()["item"]["id"]

        with patch(
            "routers.ticket_assistant.jiuwen_chat",
            new=AsyncMock(side_effect=fake_chat),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            chat_resp = ta_client.post(
                f"/api/ticket-assistant/sessions/{sid}/chat",
                json={"operator_id": "test_admin", "content": "下一步怎么查？"},
            )
        assert chat_resp.status_code == 200, chat_resp.text[:800]
        assert "下一步怎么查" in chat_resp.json().get("reply", "")

    def test_transfer_denied_without_permission(self, ta_client):
        async def fake_create_and_chat(**kwargs):
            return {"session_id": kwargs["session_id"], "reply": "ok", "messages": []}

        with patch(
            "routers.ticket_assistant.jiuwen_create_and_chat",
            new=AsyncMock(side_effect=fake_create_and_chat),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            create_resp = ta_client.post(
                "/api/ticket-assistant/sessions",
                json={
                    "operator_id": "test_admin",
                    "operator_name": "测试管理员",
                    "initial_message": "无权转人工会话",
                },
            )
        if create_resp.status_code == 503 and "0112" in str(
            create_resp.json().get("detail", "")
        ):
            pytest.skip("迁移 0112 未应用")
        assert create_resp.status_code == 200, create_resp.text[:800]
        sid = create_resp.json()["item"]["id"]

        with patch(
            "routers.ticket_assistant.ticket_assistant_transfer_allowed",
            return_value=False,
        ):
            transfer = ta_client.post(
                f"/api/ticket-assistant/sessions/{sid}/transfer",
                json={"operator_id": "test_admin", "operator_name": "测试管理员"},
            )
        assert transfer.status_code == 403

    def test_transfer_creates_ticket(self, ta_client):
        async def fake_create_and_chat(**kwargs):
            return {"session_id": kwargs["session_id"], "reply": "ok", "messages": []}

        form_values = _build_problem_fill_form_values(
            ta_client,
            overrides={
                "issue_desc": "<p>转人工建单测试</p>",
                "start_date": "2026-08-04",
            },
        )
        # problem_fill schema 不含 next_handler；写入 values 会被判 unknown fields
        form_values.pop("next_handler", None)
        assert form_values.get("issue_desc")
        assert form_values.get("severity")

        with patch(
            "routers.ticket_assistant.jiuwen_create_and_chat",
            new=AsyncMock(side_effect=fake_create_and_chat),
        ), patch("routers.ticket_assistant.JIUWEN_ENABLED", True), patch(
            "routers.ticket_assistant.JIUWEN_WS_URL", "ws://example.test/ws"
        ):
            create_resp = ta_client.post(
                "/api/ticket-assistant/sessions",
                json={
                    "operator_id": "test_admin",
                    "operator_name": "测试管理员",
                    "form_values": {
                        **form_values,
                        # 脏字段：创建/转人工均应剥离，不得导致建单失败
                        "next_handler": "审核人 reviewer01",
                        "handle_mode": "提交审核",
                        "_preview_messages": [{"role": "assistant", "content": "预览"}],
                    },
                },
            )
        if create_resp.status_code == 503 and "0112" in str(
            create_resp.json().get("detail", "")
        ):
            pytest.skip("迁移 0112 未应用")
        assert create_resp.status_code == 200, create_resp.text[:800]
        sid = create_resp.json()["item"]["id"]
        stored = create_resp.json()["item"].get("form_values") or {}
        assert "next_handler" not in stored
        assert "_preview_messages" not in stored

        with patch(
            "routers.ticket_assistant.ticket_assistant_transfer_allowed",
            return_value=True,
        ):
            transfer = ta_client.post(
                f"/api/ticket-assistant/sessions/{sid}/transfer",
                json={
                    "operator_id": "test_admin",
                    "operator_name": "测试管理员",
                    "next_node_key": "problem_review",
                },
            )
        assert transfer.status_code == 200, transfer.text[:800]
        body = transfer.json()
        assert body.get("ok") is True
        ticket_no = str(body.get("ticket_no") or "")
        assert ticket_no.startswith("YW")

        detail = ta_client.get(
            f"/api/ticket-assistant/sessions/{sid}",
            params={"operator_id": "test_admin"},
        )
        assert detail.status_code == 200
        assert detail.json()["item"]["status"] == "transferred"
        assert detail.json()["item"]["ticket_no"] == ticket_no

        # 正式工单须落库：problem_fill 节点提交信息可读，且 ticket / ticket_node_data 有行
        data_resp = ta_client.get(f"/api/tickets/{ticket_no}/nodes/problem_fill/data")
        assert data_resp.status_code == 200, data_resp.text[:500]
        saved = data_resp.json().get("values") or {}
        assert isinstance(saved, dict)
        assert "转人工建单测试" in str(saved.get("issue_desc") or "")
        for key in ("severity", "location", "biz_env", "component", "product_line"):
            if key not in form_values:
                continue
            expected = str(form_values[key]).strip()
            actual = str(saved.get(key) or "").strip()
            assert actual, f"落库缺少 {key}"
            assert expected == actual or expected in actual or actual in expected, (
                f"{key}: expected={expected!r} actual={actual!r}"
            )
        # 流转侧会补下一步处理人（不在 problem_fill schema 字段集中）
        assert str(saved.get("next_handler") or "").strip()

        import json

        from database import db_conn

        with db_conn() as conn:
            row = conn.execute(
                "SELECT ticket_no, status FROM ticket WHERE ticket_no = %s",
                (ticket_no,),
            ).fetchone()
            assert row is not None, f"ticket 表无单号 {ticket_no}"
            tnd = conn.execute(
                """
                SELECT tnd.values_json
                FROM ticket_node_data tnd
                JOIN ticket t ON t.id = tnd.ticket_id
                JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
                JOIN workflow_node wn ON wn.id = tni.node_id
                WHERE t.ticket_no = %s AND wn.node_key = 'problem_fill'
                ORDER BY tnd.created_at DESC
                LIMIT 1
                """,
                (ticket_no,),
            ).fetchone()
            assert tnd is not None, "ticket_node_data 无 problem_fill 提交记录"
            values_json = tnd["values_json"]
            if isinstance(values_json, str):
                values_json = json.loads(values_json)
            assert isinstance(values_json, dict)
            assert "转人工建单测试" in str(values_json.get("issue_desc") or "")
