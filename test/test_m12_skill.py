import pytest


class TestSkillList:
    def test_tc_m12_001_list_skills(self, api_client):
        resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()

    def test_tc_m12_003_list_skills_search(self, api_client):
        resp = api_client.get("/api/stats/skills", params={
            "q": "根因",
            "operator_id": "test_admin",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            items = resp.json()["items"]
            for item in items:
                assert "根因" in item["name"]

    def test_e_m12_list_skills_item_structure(self, api_client):
        resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "id" in item
            assert "name" in item
            assert "model" in item
            assert "is_enabled" in item
            assert "is_builtin" in item

    def test_e_m12_list_skills_api_key_masked(self, api_client):
        resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = resp.json()["items"]
        for item in items:
            if item.get("api_key"):
                assert "****" in item["api_key"]


class TestSkillGet:
    def test_tc_m12_004_get_skill(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        resp = api_client.get(f"/api/stats/skills/{skill_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["item"]["id"] == skill_id

    def test_tc_m12_005_get_skill_not_found(self, api_client):
        resp = api_client.get("/api/stats/skills/999999", params={"operator_id": "test_admin"})
        assert resp.status_code in (404, 503)

    def test_e_m12_get_skill_item_structure(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        resp = api_client.get(f"/api/stats/skills/{skill_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        item = resp.json()["item"]
        assert "id" in item
        assert "name" in item
        assert "description" in item
        assert "api_base_url" in item
        assert "api_key" in item
        assert "model" in item
        assert "max_tokens" in item
        assert "temperature" in item
        assert "system_prompt" in item
        assert "analysis_prompt_template" in item
        assert "is_enabled" in item
        assert "is_builtin" in item
        assert "created_at" in item


class TestSkillCreate:
    def test_tc_m12_006_create_skill_minimal(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "测试Skill",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "test-key-12345",
            "analysis_prompt_template": "请分析工单",
        })
        assert resp.status_code in (200, 403, 503)
        if resp.status_code == 200:
            assert "item" in resp.json()
            assert resp.json()["item"]["name"] == "测试Skill"

    def test_tc_m12_007_create_skill_empty_name(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "test-key",
            "analysis_prompt_template": "请分析工单",
        })
        assert resp.status_code in (400, 403, 503)

    def test_tc_m12_008_create_skill_empty_api_url(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "无API地址",
            "api_base_url": "",
            "api_key": "test-key",
            "analysis_prompt_template": "请分析工单",
        })
        assert resp.status_code in (400, 403, 503)

    def test_tc_m12_009_create_skill_empty_api_key(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "无API Key",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "",
            "analysis_prompt_template": "请分析工单",
        })
        assert resp.status_code in (400, 403, 503)

    def test_tc_m12_010_create_skill_empty_template(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "无模板",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "test-key",
            "analysis_prompt_template": "",
        })
        assert resp.status_code in (400, 403, 503)

    def test_tc_m12_012_create_skill_non_admin(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_user01",
            "name": "非管理员创建",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "test-key",
            "analysis_prompt_template": "请分析工单",
        })
        assert resp.status_code in (403, 503)

    def test_e_m12_create_skill_full_fields(self, api_client):
        resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "operator_name": "测试管理员",
            "name": "完整字段Skill",
            "description": "这是一个完整字段测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "test-full-fields-key",
            "model": "gpt-4o",
            "max_tokens": 2048,
            "temperature": 0.5,
            "system_prompt": "你是一个专业的分析助手",
            "analysis_prompt_template": "分析工单: {ticket_no}",
            "input_fields": {"fields": ["ticket_no", "severity"]},
            "output_format": {"type": "structured"},
            "is_enabled": True,
        })
        assert resp.status_code in (200, 403, 503)
        if resp.status_code == 200:
            item = resp.json()["item"]
            assert item["name"] == "完整字段Skill"
            assert item["model"] == "gpt-4o"
            assert item["max_tokens"] == 2048
            assert item["temperature"] == 0.5


class TestSkillPatch:
    def test_tc_m12_013_patch_skill_name(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "原名Skill",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "patch-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/stats/skills/{skill_id}", json={
            "operator_id": "test_admin",
            "name": "修改后名称",
        })
        assert resp.status_code == 200
        assert resp.json()["item"]["name"] == "修改后名称"

    def test_tc_m12_014_patch_skill_empty_name(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "空名测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "patch-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/stats/skills/{skill_id}", json={
            "operator_id": "test_admin",
            "name": "",
        })
        assert resp.status_code == 400

    def test_tc_m12_015_patch_skill_no_fields(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "无字段测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "patch-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/stats/skills/{skill_id}", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code == 400

    def test_tc_m12_016_patch_skill_not_found(self, api_client):
        resp = api_client.patch("/api/stats/skills/999999", json={
            "operator_id": "test_admin",
            "name": "不存在",
        })
        assert resp.status_code in (404, 503)

    def test_tc_m12_017_patch_skill_non_admin(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "非管理员编辑测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "patch-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/stats/skills/{skill_id}", json={
            "operator_id": "test_user01",
            "name": "非法修改",
        })
        assert resp.status_code == 403

    def test_e_m12_patch_skill_template(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "模板修改测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "patch-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/stats/skills/{skill_id}", json={
            "operator_id": "test_admin",
            "analysis_prompt_template": "分析工单: {ticket_no}",
        })
        assert resp.status_code == 200
        assert "ticket_no" in resp.json()["item"]["analysis_prompt_template"]

    def test_e_m12_patch_skill_enabled(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "启用禁用测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "patch-test-key",
            "analysis_prompt_template": "请分析",
            "is_enabled": True,
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/stats/skills/{skill_id}", json={
            "operator_id": "test_admin",
            "is_enabled": False,
        })
        assert resp.status_code == 200
        assert resp.json()["item"]["is_enabled"] is False


class TestSkillDelete:
    def test_tc_m12_018_delete_skill(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "待删除Skill",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "delete-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/stats/skills/{skill_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m12_019_delete_skill_not_found(self, api_client):
        resp = api_client.delete("/api/stats/skills/999999", params={"operator_id": "test_admin"})
        assert resp.status_code in (404, 503)

    def test_tc_m12_020_delete_skill_non_admin(self, api_client):
        create_resp = api_client.post("/api/stats/skills", json={
            "operator_id": "test_admin",
            "name": "非管理员删除测试",
            "api_base_url": "https://api.example.com/v1",
            "api_key": "delete-test-key",
            "analysis_prompt_template": "请分析",
        })
        if create_resp.status_code != 200:
            pytest.skip("Skill schema not ready or no permission")
        skill_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/stats/skills/{skill_id}", params={"operator_id": "test_user01"})
        assert resp.status_code == 403

    def test_tc_m12_021_delete_builtin_skill(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        builtin = [s for s in items if s.get("is_builtin")]
        if not builtin:
            pytest.skip("No builtin skill available")
        skill_id = builtin[0]["id"]
        resp = api_client.delete(f"/api/stats/skills/{skill_id}", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 400)


class TestSkillTest:
    def test_tc_m12_022_test_skill(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        resp = api_client.post(f"/api/stats/skills/{skill_id}/test", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "ok" in resp.json()

    def test_tc_m12_023_test_skill_not_found(self, api_client):
        resp = api_client.post("/api/stats/skills/999999/test", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code in (404, 503)

    def test_e_m12_test_skill_result_structure(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        resp = api_client.post(f"/api/stats/skills/{skill_id}/test", json={
            "operator_id": "test_admin",
        })
        if resp.status_code != 200:
            pytest.skip("Test request failed")
        result = resp.json()
        assert "ok" in result
        assert "detail" in result


class TestSkillLogs:
    def test_tc_m12_024_get_skill_logs(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        resp = api_client.get(f"/api/stats/skills/{skill_id}/logs", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()
            assert "total" in resp.json()

    def test_tc_m12_025_get_skill_logs_pagination(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        resp = api_client.get(f"/api/stats/skills/{skill_id}/logs", params={
            "operator_id": "test_admin",
            "page": 1,
            "page_size": 10,
        })
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert resp.json()["page"] == 1
            assert resp.json()["page_size"] == 10

    def test_e_m12_get_skill_logs_item_structure(self, api_client):
        list_resp = api_client.get("/api/stats/skills", params={"operator_id": "test_admin"})
        if list_resp.status_code != 200:
            pytest.skip("Skill schema not ready")
        items = list_resp.json()["items"]
        if not items:
            pytest.skip("No skill available")
        skill_id = items[0]["id"]
        logs_resp = api_client.get(f"/api/stats/skills/{skill_id}/logs", params={"operator_id": "test_admin"})
        if logs_resp.status_code != 200:
            pytest.skip("Logs request failed")
        logs = logs_resp.json()["items"]
        if logs:
            log = logs[0]
            assert "id" in log
            assert "skill_id" in log
            assert "ticket_no" in log
            assert "created_at" in log


class TestTicketAnalysis:
    def test_tc_m12_026_get_ticket_analysis(self, api_client):
        resp = api_client.get("/api/stats/tickets/YW20260402001/analysis", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 503)
        if resp.status_code == 200:
            assert "items" in resp.json()

    def test_e_m12_get_ticket_analysis_item_structure(self, api_client):
        resp = api_client.get("/api/stats/tickets/YW20260402001/analysis", params={"operator_id": "test_admin"})
        if resp.status_code != 200:
            pytest.skip("Schema not ready")
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "id" in item
            assert "skill_id" in item
            assert "skill_name" in item
            assert "status" in item
            assert "created_at" in item