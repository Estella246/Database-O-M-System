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


class TestRequirementAnalytics:
    def _seed_requirements(self, api_client):
        ids = []
        specs = [
            {"proposer": "提出人A", "assignee": "责任人X", "priority": 1, "planned_version": "V8.2.0", "planned_date": "2026-07-01"},
            {"proposer": "提出人A", "assignee": "责任人Y", "priority": 2, "planned_version": "V8.2.0", "planned_date": "2026-08-01"},
            {"proposer": "提出人B", "assignee": "责任人X", "priority": 5, "planned_version": "V8.3.0", "planned_date": "2026-09-01"},
            {"proposer": "提出人C", "assignee": "责任人Z", "priority": 8, "planned_version": "V8.3.0"},
            {"proposer": "提出人D", "assignee": "责任人X", "priority": 3, "planned_version": "", "planned_date": "2020-01-01"},
        ]
        for s in specs:
            payload = {
                "operator_id": "test_admin",
                "title": f"分析测试需求-{s['proposer']}-{s['priority']}",
                "description": "分析测试描述",
                "proposer": s["proposer"],
                "assignee": s["assignee"],
                "priority": s["priority"],
                "planned_version": s.get("planned_version", ""),
                "planned_date": s.get("planned_date", ""),
            }
            resp = api_client.post("/api/requirements", json=payload)
            assert resp.status_code == 200
            ids.append(resp.json()["id"])
        r3 = api_client.patch(f"/api/requirements/{ids[2]}", json={"operator_id": "test_admin", "status": "待RAT决策"})
        assert r3.status_code == 200
        r3b = api_client.patch(f"/api/requirements/{ids[2]}", json={"operator_id": "test_admin", "status": "开发中"})
        assert r3b.status_code == 200
        r4 = api_client.patch(f"/api/requirements/{ids[3]}", json={"operator_id": "test_admin", "status": "待RAT决策"})
        assert r4.status_code == 200
        r4b = api_client.patch(f"/api/requirements/{ids[3]}", json={"operator_id": "test_admin", "status": "开发中"})
        assert r4b.status_code == 200
        return ids

    def test_tc_m10_037_analytics_basic(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        body = resp.json()
        assert "kpi" in body
        assert "status_distribution" in body
        assert "priority_distribution" in body
        assert "trend" in body
        assert "person_load" in body
        assert "version_plan" in body

    def test_tc_m10_038_analytics_kpi(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        kpi = resp.json()["kpi"]
        assert kpi["total"] >= 5
        assert kpi["in_progress"] >= 3
        assert "avg_priority" in kpi
        assert "overdue_count" in kpi

    def test_tc_m10_039_analytics_status_distribution(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        sd = resp.json()["status_distribution"]
        assert "labels" in sd
        assert "values" in sd
        assert len(sd["labels"]) == 4
        assert len(sd["values"]) == 4

    def test_tc_m10_040_analytics_priority_distribution(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        pd = resp.json()["priority_distribution"]
        groups = pd["groups"]
        assert len(groups) == 3
        assert groups[0]["label"] == "紧急(P1-3)"
        assert groups[1]["label"] == "高(P4-6)"
        assert groups[2]["label"] == "低(P7-10)"

    def test_tc_m10_041_analytics_trend(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        tr = resp.json()["trend"]
        assert "labels" in tr
        assert "created" in tr
        assert "status_changed" in tr
        assert "landed" in tr
        assert len(tr["created"]) == len(tr["labels"])

    def test_tc_m10_042_analytics_person_load(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        pl = resp.json()["person_load"]
        assert len(pl["top_proposers"]) > 0
        assert len(pl["top_assignees"]) > 0
        assert pl["top_proposers"][0]["count"] >= 2

    def test_tc_m10_043_analytics_version_plan(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        vp = resp.json()["version_plan"]
        versions = [v["version"] for v in vp["by_version"]]
        assert "V8.2.0" in versions
        assert "V8.3.0" in versions

    def test_tc_m10_044_analytics_precision_month(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "month"})
        assert resp.status_code == 200
        tr = resp.json()["trend"]
        for label in tr["labels"]:
            assert "-" in label

    def test_tc_m10_045_analytics_invalid_precision(self, api_client):
        resp = api_client.get("/api/requirements/analytics", params={"precision": "day"})
        assert resp.status_code == 400

    def test_tc_m10_046_analytics_date_range(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "precision": "month",
        })
        assert resp.status_code == 200
        assert resp.json()["kpi"]["total"] >= 5

    def test_tc_m10_047_analytics_overdue_details(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        vp = resp.json()["version_plan"]
        overdue = vp["overdue_details"]
        assert isinstance(overdue, list)

    def test_tc_m10_048_analytics_on_time_rate(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        kpi = resp.json()["kpi"]
        assert "on_time_rate" in kpi


class TestRequirementValue:
    def test_tc_m10_058_create_with_value(self, api_client):
        resp = self._create_requirement(api_client, value="性能提升")
        assert resp.status_code == 200
        body = resp.json()
        assert body["value"] == "性能提升"

    def test_tc_m10_059_create_default_value(self, api_client):
        payload = {
            "operator_id": "test_admin",
            "title": "默认价值测试",
            "description": "默认价值描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        }
        resp = api_client.post("/api/requirements", json=payload)
        assert resp.status_code == 200
        assert resp.json()["value"] == "质量加固"

    def test_tc_m10_060_create_invalid_value(self, api_client):
        resp = self._create_requirement(api_client, value="无效价值")
        assert resp.status_code == 400

    def test_tc_m10_061_update_value(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "value": "竞争力提升",
        })
        assert resp.status_code == 200
        assert resp.json()["value"] == "竞争力提升"

    def test_tc_m10_062_update_invalid_value(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "value": "不存在价值",
        })
        assert resp.status_code == 400

    def test_tc_m10_063_list_filter_by_value(self, api_client):
        self._create_requirement(api_client, value="性能提升", title="性能需求A")
        self._create_requirement(api_client, value="感知能力提升", title="感知需求B")
        resp = api_client.get("/api/requirements", params={
            "scope": "all",
            "value": "性能提升",
        })
        assert resp.status_code == 200
        items = resp.json()["items"]
        for it in items:
            assert it["value"] == "性能提升"

    def test_tc_m10_064_search_by_value_keyword(self, api_client):
        self._create_requirement(api_client, value="恢复能力提升", title="搜索价值测试")
        resp = api_client.get("/api/requirements", params={
            "scope": "all",
            "q": "恢复能力",
        })
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert any(it["value"] == "恢复能力提升" for it in items)

    def test_tc_m10_065_value_change_logged(self, api_client):
        req_id = self._create(api_client)
        api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "value": "定位能力提升",
        })
        log_resp = api_client.get(f"/api/requirements/{req_id}/logs")
        assert log_resp.status_code == 200
        items = log_resp.json()["items"]
        update_logs = [l for l in items if l["action"] == "updated"]
        assert len(update_logs) >= 1
        changed = update_logs[0].get("changed_fields") or {}
        assert "value" in changed

    def test_tc_m10_066_analytics_value_distribution(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        body = resp.json()
        assert "value_distribution" in body
        vd = body["value_distribution"]
        assert "labels" in vd
        assert "values" in vd
        assert len(vd["labels"]) == 6
        assert len(vd["values"]) == 6

    @staticmethod
    def _create_requirement(api_client, operator_id="test_admin", **overrides):
        payload = {
            "operator_id": operator_id,
            "title": "价值测试需求标题",
            "description": "价值测试需求详细描述",
            "proposer": "张三 zhangsan",
            "assignee": "李四 lisi",
            "related_issues": [],
            "external_req_no": "",
            "planned_version": "",
            "priority": 5,
            "remark": "",
        }
        payload.update(overrides)
        return api_client.post("/api/requirements", json=payload)

    @staticmethod
    def _create(api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "价值编辑测试需求",
            "description": "价值编辑测试描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        assert resp.status_code == 200
        return resp.json()["id"]

    @staticmethod
    def _seed_requirements(api_client):
        specs = [
            {"proposer": "提出人A", "assignee": "责任人X", "priority": 1, "value": "质量加固"},
            {"proposer": "提出人B", "assignee": "责任人Y", "priority": 2, "value": "性能提升"},
            {"proposer": "提出人C", "assignee": "责任人Z", "priority": 3, "value": "竞争力提升"},
        ]
        for s in specs:
            payload = {
                "operator_id": "test_admin",
                "title": f"价值分析测试需求-{s['proposer']}",
                "description": "价值分析测试描述",
                "proposer": s["proposer"],
                "assignee": s["assignee"],
                "priority": s["priority"],
                "value": s["value"],
            }
            resp = api_client.post("/api/requirements", json=payload)
            assert resp.status_code == 200


class TestRequirementCategory:
    def test_tc_m10_049_create_with_category(self, api_client):
        resp = self._create_requirement(api_client, category="管控需求")
        assert resp.status_code == 200
        body = resp.json()
        assert body["category"] == "管控需求"

    def test_tc_m10_050_create_default_category(self, api_client):
        payload = {
            "operator_id": "test_admin",
            "title": "默认分类测试",
            "description": "默认分类描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        }
        resp = api_client.post("/api/requirements", json=payload)
        assert resp.status_code == 200
        assert resp.json()["category"] == "其他"

    def test_tc_m10_051_create_invalid_category(self, api_client):
        resp = self._create_requirement(api_client, category="无效分类")
        assert resp.status_code == 400

    def test_tc_m10_052_update_category(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "category": "内核需求",
        })
        assert resp.status_code == 200
        assert resp.json()["category"] == "内核需求"

    def test_tc_m10_053_update_invalid_category(self, api_client):
        req_id = self._create(api_client)
        resp = api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "category": "不存在分类",
        })
        assert resp.status_code == 400

    def test_tc_m10_054_list_filter_by_category(self, api_client):
        self._create_requirement(api_client, category="管控需求", title="管控需求A")
        self._create_requirement(api_client, category="内核需求", title="内核需求B")
        resp = api_client.get("/api/requirements", params={
            "scope": "all",
            "category": "管控需求",
        })
        assert resp.status_code == 200
        items = resp.json()["items"]
        for it in items:
            assert it["category"] == "管控需求"

    def test_tc_m10_055_search_by_category_keyword(self, api_client):
        self._create_requirement(api_client, category="管控和内核需求", title="搜索分类测试")
        resp = api_client.get("/api/requirements", params={
            "scope": "all",
            "q": "管控和内核",
        })
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert any(it["category"] == "管控和内核需求" for it in items)

    def test_tc_m10_056_category_change_logged(self, api_client):
        req_id = self._create(api_client)
        api_client.patch(f"/api/requirements/{req_id}", json={
            "operator_id": "test_admin",
            "category": "管控需求",
        })
        log_resp = api_client.get(f"/api/requirements/{req_id}/logs")
        assert log_resp.status_code == 200
        items = log_resp.json()["items"]
        update_logs = [l for l in items if l["action"] == "updated"]
        assert len(update_logs) >= 1
        changed = update_logs[0].get("changed_fields") or {}
        assert "category" in changed

    def test_tc_m10_057_analytics_category_distribution(self, api_client):
        self._seed_requirements(api_client)
        resp = api_client.get("/api/requirements/analytics", params={"precision": "week"})
        assert resp.status_code == 200
        body = resp.json()
        assert "category_distribution" in body
        cd = body["category_distribution"]
        assert "labels" in cd
        assert "values" in cd
        assert len(cd["labels"]) == 4
        assert len(cd["values"]) == 4

    @staticmethod
    def _create_requirement(api_client, operator_id="test_admin", **overrides):
        payload = {
            "operator_id": operator_id,
            "title": "分类测试需求标题",
            "description": "分类测试需求详细描述",
            "proposer": "张三 zhangsan",
            "assignee": "李四 lisi",
            "related_issues": [],
            "external_req_no": "",
            "planned_version": "",
            "priority": 5,
            "remark": "",
        }
        payload.update(overrides)
        return api_client.post("/api/requirements", json=payload)

    @staticmethod
    def _create(api_client):
        resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "分类编辑测试需求",
            "description": "分类编辑测试描述",
            "proposer": "张三",
            "assignee": "李四",
            "priority": 5,
        })
        assert resp.status_code == 200
        return resp.json()["id"]

    @staticmethod
    def _seed_requirements(api_client):
        specs = [
            {"proposer": "提出人A", "assignee": "责任人X", "priority": 1, "category": "管控需求"},
            {"proposer": "提出人B", "assignee": "责任人Y", "priority": 2, "category": "内核需求"},
            {"proposer": "提出人C", "assignee": "责任人Z", "priority": 3, "category": "管控和内核需求"},
        ]
        for s in specs:
            payload = {
                "operator_id": "test_admin",
                "title": f"分类分析测试需求-{s['proposer']}",
                "description": "分类分析测试描述",
                "proposer": s["proposer"],
                "assignee": s["assignee"],
                "priority": s["priority"],
                "category": s["category"],
            }
            resp = api_client.post("/api/requirements", json=payload)
            assert resp.status_code == 200
