class TestRequirementCreate:
    def _create_requirement(self, api_client, operator_id="test_admin", **overrides):
        payload = {
            "operator_id": operator_id,
            "title": "测试需求标题",
            "description": "测试需求详细描述",
            "proposer": "张三 zhangsan",
            "assignee": "李四 lisi",
            "related_issues": ["DTS-001", "TK-002"],
            "external_req_no": "EXT-2026-001",
            "planned_version": "V8.2.0",
            "planned_date": "2026-06-30",
            "priority": 3,
            "remark": "测试备注",
        }
        payload.update(overrides)
        return api_client.post("/api/requirements", json=payload)

    def test_tc_m10_001_create_requirement(self, api_client):
        resp = self._create_requirement(api_client)
        assert resp.status_code == 200
        body = resp.json()
        assert body["requirement_no"].startswith("RQ")
        assert body["status"] == "待分析"
        assert body["title"] == "测试需求标题"
        assert body["priority"] == 3

    def test_tc_m10_002_requirement_no_format(self, api_client):
        resp = self._create_requirement(api_client)
        assert resp.status_code == 200
        app_no = resp.json()["requirement_no"]
        assert app_no.startswith("RQ")
        assert len(app_no) == 13

    def test_tc_m10_003_empty_title(self, api_client):
        resp = self._create_requirement(api_client, title="")
        assert resp.status_code == 400

    def test_tc_m10_004_empty_description(self, api_client):
        resp = self._create_requirement(api_client, description="")
        assert resp.status_code == 400

    def test_tc_m10_005_empty_proposer(self, api_client):
        resp = self._create_requirement(api_client, proposer="")
        assert resp.status_code == 400

    def test_tc_m10_006_empty_assignee(self, api_client):
        resp = self._create_requirement(api_client, assignee="")
        assert resp.status_code == 400

    def test_tc_m10_007_invalid_priority_low(self, api_client):
        resp = self._create_requirement(api_client, priority=0)
        assert resp.status_code == 400

    def test_tc_m10_008_invalid_priority_high(self, api_client):
        resp = self._create_requirement(api_client, priority=11)
        assert resp.status_code == 400

    def test_tc_m10_009_empty_operator_id(self, api_client):
        resp = self._create_requirement(api_client, operator_id="")
        assert resp.status_code == 400

    def test_tc_m10_010_optional_fields_default(self, api_client):
        payload = {
            "operator_id": "test_admin",
            "title": "仅必填字段",
            "description": "仅必填描述",
            "proposer": "王五 wangwu",
            "assignee": "赵六 zhaoliu",
            "priority": 5,
        }
        resp = api_client.post("/api/requirements", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["external_req_no"] == ""
        assert body["planned_version"] == ""
        assert body["remark"] == ""
        assert body["related_issues"] == []

    def test_tc_m10_011_invalid_planned_date(self, api_client):
        resp = self._create_requirement(api_client, planned_date="not-a-date")
        assert resp.status_code == 400


class TestRequirementList:
    def test_tc_m10_012_list_all(self, api_client):
        resp = api_client.get("/api/requirements", params={"scope": "all"})
        assert resp.status_code == 200
        assert "items" in resp.json()
        assert "total" in resp.json()

    def test_tc_m10_013_list_mine(self, api_client):
        resp = api_client.get("/api/requirements", params={
            "scope": "mine",
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200

    def test_tc_m10_014_list_assigned(self, api_client):
        resp = api_client.get("/api/requirements", params={
            "scope": "assigned",
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200

    def test_tc_m10_015_invalid_scope(self, api_client):
        resp = api_client.get("/api/requirements", params={"scope": "invalid"})
        assert resp.status_code == 400

    def test_tc_m10_016_search(self, api_client):
        resp = api_client.get("/api/requirements", params={
            "scope": "all",
            "q": "测试需求标题",
        })
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m10_017_pagination(self, api_client):
        resp = api_client.get("/api/requirements", params={
            "scope": "all",
            "page": 1,
            "page_size": 5,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["page"] == 1
        assert body["page_size"] == 5


class TestRequirementDetail:
    def test_tc_m10_018_get_detail(self, api_client):
        create_resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "详情测试需求",
            "description": "详情测试描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        assert create_resp.status_code == 200
        req_id = create_resp.json()["id"]
        resp = api_client.get(f"/api/requirements/{req_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == req_id

    def test_tc_m10_019_nonexistent_requirement(self, api_client):
        resp = api_client.get("/api/requirements/999999")
        assert resp.status_code == 404


class TestRequirementPatch:
    def _create(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "编辑测试需求",
            "description": "编辑测试描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        assert resp.status_code == 200
        return resp.json()["id"]

    def test_tc_m10_020_update_title(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "title": "更新后的标题",
        })
        assert resp.status_code == 200
        assert resp.json()["title"] == "更新后的标题"

    def test_tc_m10_021_update_priority(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "priority": 1,
        })
        assert resp.status_code == 200
        assert resp.json()["priority"] == 1

    def test_tc_m10_022_invalid_priority(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "priority": 15,
        })
        assert resp.status_code == 400

    def test_tc_m10_023_forward_status(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "待RAT决策",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "待RAT决策"

    def test_tc_m10_024_backward_status(self, api_client):
        req_id = self._create(api_client)
        api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "待RAT决策",
        })
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "待分析",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "待分析"

    def test_tc_m10_025_invalid_status_jump(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "已经落地",
        })
        assert resp.status_code == 400

    def test_tc_m10_026_invalid_status_value(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "无效状态",
        })
        assert resp.status_code == 400

    def test_tc_m10_027_update_related_issues(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "related_issues": ["DTS-100", "TK-200"],
        })
        assert resp.status_code == 200
        assert resp.json()["related_issues"] == ["DTS-100", "TK-200"]

    def test_tc_m10_028_update_planned_date(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "planned_date": "2026-08-15",
        })
        assert resp.status_code == 200

    def test_tc_m10_029_patch_nonexistent(self, api_client):
        resp = api_client.patch("/api/requirements/999999", json={
            "operator_id": "test_admin",
            "title": "不存在",
        })
        assert resp.status_code == 404


class TestRequirementLogs:
    def test_tc_m10_030_get_logs(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "日志测试需求",
            "description": "日志测试描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        assert resp.status_code == 200
        req_id = resp.json()["id"]
        log_resp = api_client.get(f"/api/requirements/{req_id}/logs")
        assert log_resp.status_code == 200
        items = log_resp.json()["items"]
        assert len(items) >= 1
        assert items[0]["action"] == "created"

    def test_tc_m10_031_status_change_log(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "状态日志测试",
            "description": "状态日志描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        req_id = resp.json()["id"]
        api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "待RAT决策",
        })
        log_resp = api_client.get(f"/api/requirements/{req_id}/logs")
        assert log_resp.status_code == 200
        items = log_resp.json()["items"]
        status_logs = [l for l in items if l["action"] == "status_changed"]
        assert len(status_logs) >= 1
        assert status_logs[0]["from_status"] == "待分析"
        assert status_logs[0]["to_status"] == "待RAT决策"


class TestRequirementDelete:
    def test_tc_m10_032_delete_pending_analysis(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "删除测试需求",
            "description": "删除测试描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        req_id = resp.json()["id"]
        del_resp = api_client.delete(f"/api/requirements/{req_id}", params={
            "operator_id": "test_admin",
        })
        assert del_resp.status_code == 200
        assert del_resp.json()["ok"] is True

    def test_tc_m10_033_delete_non_pending_status(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "不可删除测试",
            "description": "不可删除描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        req_id = resp.json()["id"]
        api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "待RAT决策",
        })
        del_resp = api_client.delete(f"/api/requirements/{req_id}", params={
            "operator_id": "test_admin",
        })
        assert del_resp.status_code == 400

    def test_tc_m10_034_delete_nonexistent(self, api_client):
        del_resp = api_client.delete("/api/requirements/999999", params={
            "operator_id": "test_admin",
        })
        assert del_resp.status_code == 404

    def test_tc_m10_035_delete_non_creator(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "非创建人删除测试",
            "description": "非创建人删除描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        req_id = resp.json()["id"]
        del_resp = api_client.delete(f"/api/requirements/{req_id}", params={
            "operator_id": "other_user",
        })
        assert del_resp.status_code == 403


class TestRequirementFullFlow:
    def test_tc_m10_036_full_status_flow(self, api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "完整流程测试",
            "description": "完整流程描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 2,
        })
        assert resp.status_code == 200
        req_id = resp.json()["id"]
        assert resp.json()["status"] == "待分析"

        r2 = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "待RAT决策",
        })
        assert r2.status_code == 200
        assert r2.json()["status"] == "待RAT决策"

        r3 = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "开发中",
        })
        assert r3.status_code == 200
        assert r3.json()["status"] == "开发中"

        r4 = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "status": "已经落地",
        })
        assert r4.status_code == 200
        assert r4.json()["status"] == "已经落地"

        log_resp = api_client.get(f"/api/requirements/{req_id}/logs")
        items = log_resp.json()["items"]
        status_logs = [l for l in items if l["action"] == "status_changed"]
        assert len(status_logs) == 3
