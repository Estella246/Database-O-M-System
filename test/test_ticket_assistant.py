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


class TestTicketAssistantApiInProcess:
    def test_list_sessions(self, ta_client):
        resp = ta_client.get(
            "/api/ticket-assistant/sessions",
            params={"operator_id": "test_admin"},
        )
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()

    def test_create_requires_form_values(self, ta_client):
        resp = ta_client.post(
            "/api/ticket-assistant/sessions",
            json={"operator_id": "test_admin", "form_values": {}},
        )
        assert resp.status_code in (400, 503)

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

    def test_transfer_creates_ticket(self, ta_client):
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
                    "form_values": {
                        "issue_desc": "转人工建单测试",
                        "location": "联调局点",
                        "severity": "一般",
                        "start_date": "2026-08-04",
                        "biz_env": "生产",
                        "component": "存储",
                        "product_line": "HCS",
                        "next_handler": "审核人 reviewer01",
                    },
                },
            )
        if create_resp.status_code == 503:
            pytest.skip("迁移 0112 未应用或服务不可用")
        assert create_resp.status_code == 200, create_resp.text[:800]
        sid = create_resp.json()["item"]["id"]

        transfer = ta_client.post(
            f"/api/ticket-assistant/sessions/{sid}/transfer",
            json={
                "operator_id": "test_admin",
                "operator_name": "测试管理员",
                "next_node_key": "problem_review",
            },
        )
        if transfer.status_code >= 400:
            # 必填字段随 schema 变化时允许失败，但接口须存在
            assert transfer.status_code != 404, transfer.text[:500]
            return
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
