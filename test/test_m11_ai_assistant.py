import pytest


class TestAiConversations:
    def test_tc_m11_001_list_conversations(self, api_client):
        resp = api_client.get("/api/ai/conversations", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()

    def test_tc_m11_002_create_conversation(self, api_client):
        resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "测试会话",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "item" in resp.json()
            assert resp.json()["item"]["title"] == "测试会话"

    def test_tc_m11_003_create_conversation_empty_title(self, api_client):
        resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["item"]["title"] == "新对话"

    def test_tc_m11_004_delete_conversation(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "待删除会话",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/ai/conversations/{conv_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m11_005_delete_conversation_not_owner(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "所有权测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/ai/conversations/{conv_id}", params={"operator_id": "other_user"})
        assert resp.status_code == 403

    def test_tc_m11_006_delete_conversation_not_found(self, api_client):
        resp = api_client.delete("/api/ai/conversations/999999", params={"operator_id": "test_admin"})
        assert resp.status_code in (404, 503)


class TestAiMessages:
    def test_tc_m11_010_list_messages(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "消息测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.get(f"/api/ai/conversations/{conv_id}/messages", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m11_011_list_messages_not_owner(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "消息权限测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.get(f"/api/ai/conversations/{conv_id}/messages", params={"operator_id": "other_user"})
        assert resp.status_code == 403


class TestAiQuickTemplates:
    def test_tc_m11_020_list_quick_templates(self, api_client):
        resp = api_client.get("/api/ai/quick-templates", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()

    def test_tc_m11_021_create_quick_template(self, api_client):
        resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "测试自定义快捷问题？",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "item" in resp.json()
            assert resp.json()["item"]["is_preset"] is False

    def test_tc_m11_022_create_quick_template_empty(self, api_client):
        resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "",
        })
        assert resp.status_code in (400, 503)

    def test_tc_m11_023_delete_custom_template(self, api_client):
        create_resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "待删除快捷问题？",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        tpl_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/ai/quick-templates/{tpl_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m11_024_delete_preset_template_forbidden(self, api_client):
        resp = api_client.delete("/api/ai/quick-templates/1", params={"operator_id": "test_admin"})
        assert resp.status_code in (400, 503)

    def test_tc_m11_025_delete_template_not_owner(self, api_client):
        create_resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "所有权测试问题？",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        tpl_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/ai/quick-templates/{tpl_id}", params={"operator_id": "other_user"})
        assert resp.status_code == 403


class TestLlmConfig:
    def test_tc_m11_030_get_llm_config(self, api_client):
        resp = api_client.get("/api/params/llm-config", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()
            for item in resp.json()["items"]:
                if item["key"] == "llm_api_key":
                    assert "****" in item["value"] or item["value"] == ""

    def test_tc_m11_031_put_llm_config_admin(self, api_client):
        resp = api_client.put("/api/params/llm-config", json={
            "operator_id": "test_admin",
            "items": [
                {"key": "llm_enabled", "value": "false", "value_type": "bool", "description": "全局开关"},
            ],
        })
        assert resp.status_code in (200, 403, 503)

    def test_tc_m11_032_put_llm_config_non_admin(self, api_client):
        resp = api_client.put("/api/params/llm-config", json={
            "operator_id": "test_user",
            "items": [
                {"key": "llm_enabled", "value": "true", "value_type": "bool", "description": "全局开关"},
            ],
        })
        assert resp.status_code in (403, 503)

    def test_tc_m11_033_put_llm_config_invalid_enabled(self, api_client):
        resp = api_client.put("/api/params/llm-config", json={
            "operator_id": "test_admin",
            "items": [
                {"key": "llm_enabled", "value": "yes", "value_type": "bool", "description": "全局开关"},
            ],
        })
        assert resp.status_code in (400, 403, 503)


class TestUserLlmConfig:
    def test_tc_m11_040_get_my_llm_config(self, api_client):
        resp = api_client.get("/api/ai/my-llm-config", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            data = resp.json()
            assert "effective" in data
            assert "user_override" in data
            assert "system_default" in data

    def test_tc_m11_041_put_my_llm_config(self, api_client):
        resp = api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
            "model": "test-model",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["ok"] is True

    def test_tc_m11_042_clear_my_llm_config(self, api_client):
        resp = api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["ok"] is True


class TestAiSchemaRefresh:
    def test_tc_m11_050_refresh_schema(self, api_client):
        resp = api_client.post("/api/ai/refresh-schema", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "table_count" in resp.json()
