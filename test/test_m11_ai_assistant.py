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

    def test_e_m11_list_conversations_item_structure(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "结构验证会话",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        list_resp = api_client.get("/api/ai/conversations", params={"operator_id": "test_admin"})
        assert list_resp.status_code == 200
        items = list_resp.json()["items"]
        if items:
            item = items[0]
            assert "id" in item
            assert "title" in item
            assert "created_at" in item

    def test_e_m11_create_conversation_item_structure(self, api_client):
        resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "创建结构验证",
        })
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        item = resp.json()["item"]
        assert "id" in item
        assert "title" in item
        assert "created_at" in item
        assert "updated_at" in item

    def test_e_m11_list_only_own_conversations(self, api_client):
        api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "管理员会话",
        })
        api_client.post("/api/ai/conversations", json={
            "operator_id": "test_user01",
            "title": "普通用户会话",
        })
        admin_resp = api_client.get("/api/ai/conversations", params={"operator_id": "test_admin"})
        user_resp = api_client.get("/api/ai/conversations", params={"operator_id": "test_user01"})
        if admin_resp.status_code != 200 or user_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        admin_titles = [c["title"] for c in admin_resp.json()["items"]]
        user_titles = [c["title"] for c in user_resp.json()["items"]]
        assert "普通用户会话" not in admin_titles
        assert "管理员会话" not in user_titles


class TestAiConversationPatch:
    def test_e_m11_patch_conversation_title(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "原标题",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/ai/conversations/{conv_id}", json={
            "operator_id": "test_admin",
            "title": "修改后的标题",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m11_patch_conversation_empty_title(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "空标题测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/ai/conversations/{conv_id}", json={
            "operator_id": "test_admin",
            "title": "",
        })
        assert resp.status_code == 400

    def test_e_m11_patch_conversation_not_owner(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "编辑权限测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/ai/conversations/{conv_id}", json={
            "operator_id": "other_user",
            "title": "非法修改",
        })
        assert resp.status_code == 403

    def test_e_m11_patch_conversation_not_found(self, api_client):
        resp = api_client.patch("/api/ai/conversations/999999", json={
            "operator_id": "test_admin",
            "title": "不存在",
        })
        assert resp.status_code in (404, 503)

    def test_e_m11_patch_deleted_conversation(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "已删除会话",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        api_client.delete(f"/api/ai/conversations/{conv_id}", params={"operator_id": "test_admin"})
        resp = api_client.patch(f"/api/ai/conversations/{conv_id}", json={
            "operator_id": "test_admin",
            "title": "修改已删除",
        })
        assert resp.status_code == 404


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

    def test_e_m11_list_messages_structure(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "消息结构测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.get(f"/api/ai/conversations/{conv_id}/messages", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert "total" in body
        assert "page" in body
        assert "page_size" in body

    def test_e_m11_list_messages_pagination(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "分页测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.get(f"/api/ai/conversations/{conv_id}/messages", params={
            "operator_id": "test_admin",
            "page": 1,
            "page_size": 10,
        })
        assert resp.status_code == 200
        assert resp.json()["page"] == 1
        assert resp.json()["page_size"] == 10

    def test_e_m11_list_messages_deleted_conversation(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "已删除消息测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        api_client.delete(f"/api/ai/conversations/{conv_id}", params={"operator_id": "test_admin"})
        resp = api_client.get(f"/api/ai/conversations/{conv_id}/messages", params={"operator_id": "test_admin"})
        assert resp.status_code == 404


class TestAiChat:
    def test_e_m11_chat_endpoint_exists(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "聊天测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.post(f"/api/ai/conversations/{conv_id}/chat", json={
            "operator_id": "test_admin",
            "content": "测试消息",
        })
        assert resp.status_code in (200, 400, 503)

    def test_e_m11_chat_not_owner(self, api_client):
        create_resp = api_client.post("/api/ai/conversations", json={
            "operator_id": "test_admin",
            "title": "聊天权限测试",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        conv_id = create_resp.json()["item"]["id"]
        resp = api_client.post(f"/api/ai/conversations/{conv_id}/chat", json={
            "operator_id": "other_user",
            "content": "非法消息",
        })
        assert resp.status_code in (400, 403, 503)


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

    def test_e_m11_create_template_item_structure(self, api_client):
        resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "结构验证问题？",
        })
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        item = resp.json()["item"]
        assert "id" in item
        assert "question" in item
        assert "is_preset" in item
        assert "creator_id" in item
        assert "sort_order" in item

    def test_e_m11_patch_template_question(self, api_client):
        create_resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "原始问题？",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        tpl_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/ai/quick-templates/{tpl_id}", json={
            "operator_id": "test_admin",
            "question": "修改后的问题？",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m11_patch_template_empty_question(self, api_client):
        create_resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "空问题测试？",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        tpl_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/ai/quick-templates/{tpl_id}", json={
            "operator_id": "test_admin",
            "question": "",
        })
        assert resp.status_code == 400

    def test_e_m11_patch_template_not_owner(self, api_client):
        create_resp = api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "编辑权限测试？",
        })
        if create_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        tpl_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/ai/quick-templates/{tpl_id}", json={
            "operator_id": "other_user",
            "question": "非法修改？",
        })
        assert resp.status_code == 403

    def test_e_m11_patch_template_not_found(self, api_client):
        resp = api_client.patch("/api/ai/quick-templates/999999", json={
            "operator_id": "test_admin",
            "question": "不存在？",
        })
        assert resp.status_code in (404, 503)

    def test_e_m11_list_templates_only_own(self, api_client):
        api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_admin",
            "question": "管理员模板？",
        })
        api_client.post("/api/ai/quick-templates", json={
            "operator_id": "test_user01",
            "question": "用户模板？",
        })
        admin_resp = api_client.get("/api/ai/quick-templates", params={"operator_id": "test_admin"})
        user_resp = api_client.get("/api/ai/quick-templates", params={"operator_id": "test_user01"})
        if admin_resp.status_code != 200 or user_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        admin_qs = [t["question"] for t in admin_resp.json()["items"] if not t.get("is_preset")]
        user_qs = [t["question"] for t in user_resp.json()["items"] if not t.get("is_preset")]
        assert "用户模板？" not in admin_qs
        assert "管理员模板？" not in user_qs

    def test_e_m11_delete_template_not_found(self, api_client):
        resp = api_client.delete("/api/ai/quick-templates/999999", params={"operator_id": "test_admin"})
        assert resp.status_code in (404, 503)


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

    def test_e_m11_get_llm_config_item_structure(self, api_client):
        resp = api_client.get("/api/params/llm-config", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "key" in item
            assert "value" in item
            assert "value_type" in item
            assert "description" in item

    def test_e_m11_get_llm_config_api_key_masked(self, api_client):
        resp = api_client.get("/api/params/llm-config", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        items = resp.json()["items"]
        api_key_item = next((i for i in items if i["key"] == "llm_api_key"), None)
        if api_key_item:
            val = api_key_item["value"]
            if val:
                assert "****" in val, "API key should be masked"

    def test_e_m11_put_llm_config_returns_updated_items(self, api_client):
        resp = api_client.put("/api/params/llm-config", json={
            "operator_id": "test_admin",
            "items": [
                {"key": "llm_enabled", "value": "false", "value_type": "bool", "description": "全局开关"},
            ],
        })
        if resp.status_code == 200:
            body = resp.json()
            assert body["ok"] is True
            assert "items" in body

    def test_e_m11_test_llm_config_endpoint(self, api_client):
        resp = api_client.post("/api/params/llm-config/test", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            body = resp.json()
            assert "ok" in body

    def test_e_m11_test_my_llm_config_endpoint(self, api_client):
        resp = api_client.post("/api/ai/my-llm-config/test", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code in (200, 400, 503)
        if resp.status_code == 200:
            body = resp.json()
            assert "ok" in body
        if resp.status_code == 400:
            body = resp.json()
            assert "detail" in body or "未配置 API Key" in str(body)


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

    def test_e_m11_get_my_llm_config_structure(self, api_client):
        resp = api_client.get("/api/ai/my-llm-config", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        data = resp.json()
        assert "effective" in data
        assert "user_override" in data
        assert "system_default" in data
        assert isinstance(data["effective"], dict)
        assert isinstance(data["system_default"], dict)

    def test_e_m11_put_my_llm_config_override_model(self, api_client):
        resp = api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
            "model": "gpt-4o-mini",
        })
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        assert resp.json()["ok"] is True
        get_resp = api_client.get("/api/ai/my-llm-config", params={"operator_id": "test_admin"})
        if get_resp.status_code == 200:
            effective = get_resp.json()["effective"]
            assert effective.get("model") == "gpt-4o-mini"

    def test_e_m11_clear_my_llm_config_restores_default(self, api_client):
        api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
            "model": "custom-model",
        })
        clear_resp = api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
        })
        if clear_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        get_resp = api_client.get("/api/ai/my-llm-config", params={"operator_id": "test_admin"})
        if get_resp.status_code == 200:
            user_override = get_resp.json()["user_override"]
            assert user_override is None or user_override.get("model") is None


class TestAiSchemaRefresh:
    def test_tc_m11_050_refresh_schema(self, api_client):
        resp = api_client.post("/api/ai/refresh-schema", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "table_count" in resp.json()

    def test_e_m11_refresh_schema_returns_table_count(self, api_client):
        resp = api_client.post("/api/ai/refresh-schema", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("AI schema not ready")
        body = resp.json()
        assert "table_count" in body
        assert isinstance(body["table_count"], int)
        assert body["table_count"] >= 0


class TestContextMaxToken:
    def test_tc_m11_060_system_config_has_context_max_token(self, api_client):
        resp = api_client.get("/api/params/llm-config", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            keys = [it["key"] for it in resp.json()["items"]]
            assert "llm_context_max_token" in keys

    def test_tc_m11_061_put_system_context_max_token(self, api_client):
        resp = api_client.put("/api/params/llm-config", json={
            "operator_id": "test_admin",
            "items": [
                {"key": "llm_context_max_token", "value": "64000", "value_type": "int", "description": "上下文最大Token长度"},
            ],
        })
        assert resp.status_code in (200, 403, 503)
        if resp.status_code == 200:
            items = resp.json()["items"]
            found = next((it for it in items if it["key"] == "llm_context_max_token"), None)
            assert found is not None
            assert found["value"] == "64000"

    def test_tc_m11_062_user_config_context_max_token(self, api_client):
        resp = api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
            "context_max_token": 32000,
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["ok"] is True

    def test_tc_m11_063_user_config_includes_context_max_token(self, api_client):
        resp = api_client.get("/api/ai/my-llm-config", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            data = resp.json()
            assert "context_max_token" in data.get("system_default", {})

    def test_tc_m11_064_restore_system_context_max_token(self, api_client):
        resp = api_client.put("/api/params/llm-config", json={
            "operator_id": "test_admin",
            "items": [
                {"key": "llm_context_max_token", "value": "128000", "value_type": "int", "description": "上下文最大Token长度"},
            ],
        })
        assert resp.status_code in (200, 403, 503)

    def test_e_m11_user_override_context_max_token_effective(self, api_client):
        put_resp = api_client.put("/api/ai/my-llm-config", json={
            "operator_id": "test_admin",
            "context_max_token": 16000,
        })
        if put_resp.status_code != 200:
            pytest.skip("AI schema not ready")
        get_resp = api_client.get("/api/ai/my-llm-config", params={"operator_id": "test_admin"})
        if get_resp.status_code == 200:
            effective = get_resp.json()["effective"]
            assert effective.get("context_max_token") == 16000
