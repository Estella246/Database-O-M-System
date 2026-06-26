class TestApproverWhitelist:
    def test_tc_m06_001_get_approver_whitelist(self, api_client):
        resp = api_client.get("/api/leave/approver-whitelist")
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m06_002_put_approver_whitelist(self, api_client, test_data, ensure_test_users):
        resp = api_client.put("/api/leave/approver-whitelist", json={
            "operator_id": "test_admin",
            "accounts": test_data["leave_approver_whitelist"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m06_003_whitelist_nonexistent_account(self, api_client, ensure_test_users):
        resp = api_client.put("/api/leave/approver-whitelist", json={
            "operator_id": "test_admin",
            "accounts": ["nonexistent_account_xyz"],
        })
        assert resp.status_code == 400

    def test_e_m06_put_whitelist_empty_accounts(self, api_client, ensure_test_users):
        resp = api_client.put("/api/leave/approver-whitelist", json={
            "operator_id": "test_admin",
            "accounts": [],
        })
        assert resp.status_code == 200

    def test_e_m06_put_whitelist_multiple_accounts(self, api_client, ensure_test_users):
        resp = api_client.put("/api/leave/approver-whitelist", json={
            "operator_id": "test_admin",
            "accounts": ["test_admin", "test_user01"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m06_get_whitelist_after_put(self, api_client, ensure_test_users):
        api_client.put("/api/leave/approver-whitelist", json={
            "operator_id": "test_admin",
            "accounts": ["test_admin"],
        })
        resp = api_client.get("/api/leave/approver-whitelist")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert isinstance(items, list)


class TestLeaveApplicationCreate:
    def test_tc_m06_004_create_leave_application(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert "application_no" in body

    def test_tc_m06_005_application_no_format(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        resp = api_client.post("/api/leave/applications", json=data)
        if resp.status_code == 200:
            app_no = resp.json().get("application_no", "")
            assert app_no.startswith("QJ")
            assert len(app_no) == 13

    def test_tc_m06_006_approver_not_in_whitelist(self, api_client, test_data, ensure_test_users):
        data = dict(test_data["leave_application"])
        data["approver_account"] = "test_user02"
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 400

    def test_tc_m06_007_invalid_application_type(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["application_type"] = "无效类型"
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 400

    def test_tc_m06_008_empty_segments(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["segments"] = []
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 400

    def test_tc_m06_009_end_before_start(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["segments"] = [
            {"start_at": "2026-04-10T18:00:00+08:00", "end_at": "2026-04-10T09:00:00+08:00", "reason": "时间倒置"}
        ]
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 400

    def test_e_m06_create_application_returns_id(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert isinstance(body["id"], int)

    def test_e_m06_create_application_multiple_segments(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["segments"] = [
            {"start_at": "2026-04-10T09:00:00+08:00", "end_at": "2026-04-10T12:00:00+08:00", "reason": "上午请假"},
            {"start_at": "2026-04-11T09:00:00+08:00", "end_at": "2026-04-11T18:00:00+08:00", "reason": "全天请假"},
        ]
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 200

    def test_e_m06_create_application_with_cc(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["cc_accounts"] = ["test_user02", "test_admin"]
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 200

    def test_e_m06_create_application_empty_cc(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["cc_accounts"] = []
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 200

    def test_e_m06_create_application_missing_operator(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["operator_id"] = ""
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 400

    def test_e_m06_create_application_with_applicant_account(self, api_client, test_data, ensure_approver_whitelist, ensure_test_users):
        data = dict(test_data["leave_application"])
        data["applicant_account"] = "test_user02"
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 200
        app_id = resp.json()["id"]
        detail = api_client.get(f"/api/leave/applications/{app_id}")
        assert detail.status_code == 200
        app = detail.json()["application"]
        assert app["applicant_account"] == "test_user02"

    def test_e_m06_create_application_invalid_applicant(self, api_client, test_data, ensure_approver_whitelist):
        data = dict(test_data["leave_application"])
        data["applicant_account"] = "not_a_real_user_xyz"
        resp = api_client.post("/api/leave/applications", json=data)
        assert resp.status_code == 400


class TestLeaveApplicationList:
    def test_tc_m06_010_list_all(self, api_client):
        resp = api_client.get("/api/leave/applications", params={"scope": "all"})
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m06_011_list_todo(self, api_client):
        resp = api_client.get("/api/leave/applications", params={
            "scope": "todo",
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        items = resp.json()["items"]
        for it in items:
            assert it.get("status") == "审批中"

    def test_tc_m06_012_list_pending_approval(self, api_client):
        resp = api_client.get("/api/leave/applications", params={
            "scope": "pending_approval",
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200

    def test_tc_m06_013_list_with_search(self, api_client):
        resp = api_client.get("/api/leave/applications", params={
            "scope": "all",
            "q": "功能测试",
        })
        assert resp.status_code == 200

    def test_e_m06_list_invalid_scope(self, api_client):
        resp = api_client.get("/api/leave/applications", params={"scope": "invalid_scope"})
        assert resp.status_code == 400

    def test_e_m06_list_returns_items_list(self, api_client):
        resp = api_client.get("/api/leave/applications", params={"scope": "all"})
        assert resp.status_code == 200
        assert isinstance(resp.json()["items"], list)

    def test_e_m06_list_pagination_meta(self, api_client):
        resp = api_client.get(
            "/api/leave/applications",
            params={"scope": "all", "page": 1, "page_size": 10},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "total" in body
        assert body["page"] == 1
        assert body["page_size"] == 10
        assert isinstance(body["items"], list)
        assert len(body["items"]) <= 10

    def test_e_m06_list_pagination_page_size_clamped(self, api_client):
        resp = api_client.get(
            "/api/leave/applications",
            params={"scope": "all", "page": 1, "page_size": 500},
        )
        assert resp.status_code == 200
        assert resp.json()["page_size"] == 100

    def test_e_m06_list_all_only_self_applicant_when_whitelist_editable(
        self, api_client, test_data, ensure_approver_whitelist
    ):
        api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "leave_application_all",
                "permission_level": "editable",
            }],
            "operator_id": "test_admin",
        })
        marker = "whitelist_only_self_applicant_marker"
        data = dict(test_data["leave_application"])
        data["operator_id"] = "test_user01"
        data["segments"] = [{
            "start_at": "2026-05-20T09:00:00+08:00",
            "end_at": "2026-05-20T18:00:00+08:00",
            "reason": marker,
        }]
        create_resp = api_client.post("/api/leave/applications", json=data)
        assert create_resp.status_code == 200
        app_id = create_resp.json()["id"]

        other_resp = api_client.get(
            "/api/leave/applications",
            params={"scope": "all", "operator_id": "test_user02", "q": marker, "page_size": 100},
        )
        assert other_resp.status_code == 200
        other_ids = [it["id"] for it in other_resp.json()["items"]]
        assert app_id not in other_ids

        self_resp = api_client.get(
            "/api/leave/applications",
            params={"scope": "all", "operator_id": "test_user01", "q": marker, "page_size": 100},
        )
        assert self_resp.status_code == 200
        self_ids = [it["id"] for it in self_resp.json()["items"]]
        assert app_id in self_ids


class TestLeaveApplicationDetail:
    def test_tc_m06_014_get_application_detail(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        resp = api_client.get(f"/api/leave/applications/{app_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert "application" in body
        assert "segments" in body
        assert "logs" in body

    def test_tc_m06_015_nonexistent_application(self, api_client):
        resp = api_client.get("/api/leave/applications/999999")
        assert resp.status_code == 404

    def test_e_m06_detail_application_structure(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        resp = api_client.get(f"/api/leave/applications/{app_id}")
        assert resp.status_code == 200
        app = resp.json()["application"]
        assert "id" in app
        assert "status" in app
        assert "applicant_account" in app

    def test_e_m06_detail_segments_structure(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        resp = api_client.get(f"/api/leave/applications/{app_id}")
        assert resp.status_code == 200
        segments = resp.json()["segments"]
        assert isinstance(segments, list)
        if segments:
            seg = segments[0]
            assert "start_at" in seg
            assert "end_at" in seg
            assert "reason" in seg

    def test_e_m06_detail_logs_structure(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        resp = api_client.get(f"/api/leave/applications/{app_id}")
        assert resp.status_code == 200
        logs = resp.json()["logs"]
        assert isinstance(logs, list)
        if logs:
            log = logs[0]
            assert "action" in log
            assert "operator_account" in log


class TestLeaveDutyAutoRestore:
    @staticmethod
    def _ensure_applicant(api_client, test_data: dict) -> str:
        import uuid

        applicant = f"leave_duty_{uuid.uuid4().hex[:8]}"
        resp = api_client.post(
            "/api/admin/users/bulk",
            json={
                "items": [{
                    "account": applicant,
                    "user_name": "请假值班测",
                    "role_code": "普通人员",
                    "group_name": "测试组",
                    "email": f"{applicant}@test.local",
                    "is_active": True,
                }],
                "operator_id": "test_admin",
            },
        )
        assert resp.status_code == 200, f"创建测试用户失败: {resp.text}"
        return applicant

    @staticmethod
    def _leave_data(test_data: dict, applicant: str, segments: list) -> dict:
        data = dict(test_data["leave_application"])
        data["applicant_account"] = applicant
        data["segments"] = segments
        return data

    @staticmethod
    def _seed_rotation_active(api_client, applicant: str) -> None:
        api_client.put(
            "/api/duty/rotation",
            json={
                "operator_id": "test_admin",
                "lists": {
                    "kernelRotation": [
                        {"account": applicant, "user_name": "请假值班测", "status": "active"}
                    ],
                    "controlRotation": [],
                    "specialSlowSql": [],
                    "specialPerf": [],
                    "specialUpgrade": [],
                    "specialScale": [],
                    "specialBackup": [],
                    "specialDr": [],
                },
            },
        )

    def test_tc_m06_024_expired_leave_restores_duty_active_on_rotation_get(
        self, api_client, test_data, ensure_approver_whitelist, ensure_test_users
    ):
        """已结束请假段：轮值状态应自动恢复为 active。"""
        import pytest
        from datetime import datetime, timedelta, timezone

        health_resp = api_client.get("/api/duty/rotation")
        if health_resp.status_code == 503 and "轮值表未就绪" in health_resp.json().get("detail", ""):
            pytest.skip("duty_rotation_entry 表未迁移")

        applicant = self._ensure_applicant(api_client, test_data)
        self._seed_rotation_active(api_client, applicant)
        now = datetime.now(timezone.utc)
        data = self._leave_data(
            test_data,
            applicant,
            [
                {
                    "start_at": (now - timedelta(hours=10)).strftime("%Y-%m-%dT%H:00:00+00:00"),
                    "end_at": (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00+00:00"),
                    "reason": "已结束请假自动恢复",
                }
            ],
        )
        create_resp = api_client.post("/api/leave/applications", json=data)
        assert create_resp.status_code == 200, f"创建请假申请失败: {create_resp.text}"
        app_id = create_resp.json().get("id")
        agree_resp = api_client.post(
            f"/api/leave/applications/{app_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        )
        assert agree_resp.status_code == 200, f"审批失败: {agree_resp.text}"
        rot = api_client.get("/api/duty/rotation").json()
        kern = [r for r in rot.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern, f"轮值表中未找到 {applicant}"
        assert kern[0].get("status") == "active", f"请假结束后状态应为 active，实际为 {kern[0].get('status')}"

    def test_tc_m06_025_future_leave_stays_active_until_window_starts(
        self, api_client, test_data, ensure_approver_whitelist, ensure_test_users
    ):
        """未开始的已同意请假：审批后仍保持当值，窗口开始后才置灰。"""
        from datetime import datetime, timedelta, timezone

        applicant = self._ensure_applicant(api_client, test_data)
        self._seed_rotation_active(api_client, applicant)
        now = datetime.now(timezone.utc)
        data = self._leave_data(
            test_data,
            applicant,
            [
                {
                    "start_at": (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00+00:00"),
                    "end_at": (now + timedelta(hours=9)).strftime("%Y-%m-%dT%H:00:00+00:00"),
                    "reason": "未开始请假保持当值",
                }
            ],
        )
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        agree_resp = api_client.post(
            f"/api/leave/applications/{app_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        )
        assert agree_resp.status_code == 200
        rot = api_client.get("/api/duty/rotation").json()
        kern = [r for r in rot.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern and kern[0].get("status") == "active"

    def test_tc_m06_026_gap_between_two_approved_leaves_restores_active(
        self, api_client, test_data, ensure_approver_whitelist, ensure_test_users
    ):
        """两段已同意请假之间的空档应恢复当值。"""
        from datetime import datetime, timedelta, timezone

        applicant = self._ensure_applicant(api_client, test_data)
        self._seed_rotation_active(api_client, applicant)
        now = datetime.now(timezone.utc)
        first = self._leave_data(
            test_data,
            applicant,
            [
                {
                    "start_at": (now - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "end_at": (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "reason": "第一段已结束",
                }
            ],
        )
        second = self._leave_data(
            test_data,
            applicant,
            [
                {
                    "start_at": (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "end_at": (now + timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "reason": "第二段未开始",
                }
            ],
        )
        first_id = api_client.post("/api/leave/applications", json=first).json().get("id")
        second_id = api_client.post("/api/leave/applications", json=second).json().get("id")
        assert first_id and second_id
        assert api_client.post(
            f"/api/leave/applications/{first_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        ).status_code == 200
        assert api_client.post(
            f"/api/leave/applications/{second_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        ).status_code == 200
        rot = api_client.get("/api/duty/rotation").json()
        kern = [r for r in rot.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern and kern[0].get("status") == "active"

    def test_tc_m06_027_current_leave_window_sets_inactive(
        self, api_client, test_data, ensure_approver_whitelist, ensure_test_users
    ):
        """当前时刻落在已同意请假窗口内时应置灰。"""
        from datetime import datetime, timedelta, timezone

        applicant = self._ensure_applicant(api_client, test_data)
        self._seed_rotation_active(api_client, applicant)
        now = datetime.now(timezone.utc)
        data = self._leave_data(
            test_data,
            applicant,
            [
                {
                    "start_at": (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "end_at": (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "reason": "进行中请假置灰",
                }
            ],
        )
        app_id = api_client.post("/api/leave/applications", json=data).json().get("id")
        assert app_id
        assert api_client.post(
            f"/api/leave/applications/{app_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        ).status_code == 200
        rot = api_client.get("/api/duty/rotation").json()
        kern = [r for r in rot.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern and kern[0].get("status") == "inactive"


class TestLeaveApplicationAction:
    def _create_application(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        resp = api_client.post("/api/leave/applications", json=data)
        if resp.status_code == 200:
            return resp.json().get("id")
        return None

    def test_tc_m06_016_agree_application(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "同意申请"

    def test_tc_m06_017_reject_application(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "reject",
            "comment": "测试拒绝原因",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "拒绝申请"

    def test_tc_m06_018_reject_without_comment(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "reject",
            "comment": "",
        })
        assert resp.status_code == 400

    def test_tc_m06_019_cancel_application(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "cancel",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "已取消"

    def test_tc_m06_020_invalid_action(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "invalid",
        })
        assert resp.status_code == 400

    def test_tc_m06_021_non_handler_action(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_user02",
            "action": "agree",
        })
        assert resp.status_code == 403

    def test_tc_m06_022_action_on_non_pending(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        assert resp.status_code == 400

    def test_e_m06_action_on_nonexistent_application(self, api_client):
        resp = api_client.post("/api/leave/applications/999999/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        assert resp.status_code == 404

    def test_e_m06_cancel_then_agree_fails(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "cancel",
        })
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        assert resp.status_code == 400

    def test_e_m06_reject_then_agree_fails(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "reject",
            "comment": "拒绝",
        })
        resp = api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        assert resp.status_code == 400

    def test_tc_m06_023_agree_sets_rotation_and_site_oncall_inactive_during_leave_window(
        self, api_client, test_data, ensure_approver_whitelist, ensure_test_users
    ):
        from datetime import datetime, timedelta, timezone

        applicant = TestLeaveDutyAutoRestore._ensure_applicant(api_client, test_data)
        TestLeaveDutyAutoRestore._seed_rotation_active(api_client, applicant)
        api_client.put(
            "/api/duty/site-oncall",
            json={
                "operator_id": "test_admin",
                "rows": [
                    {
                        "site_name": "请假测试局点",
                        "account": applicant,
                        "user_name": "请假值班测",
                        "status": "active",
                    }
                ],
            },
        )
        now = datetime.now(timezone.utc)
        data = dict(test_data["leave_application"])
        data["applicant_account"] = applicant
        data["segments"] = [
            {
                "start_at": (now - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "end_at": (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "reason": "进行中请假置灰",
            }
        ]
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        resp = api_client.post(
            f"/api/leave/applications/{app_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("duty_effect", {}).get("rotation_updated", 0) >= 1
        assert body.get("duty_effect", {}).get("site_oncall_updated", 0) >= 1
        rot = api_client.get("/api/duty/rotation").json()
        kern = [r for r in rot.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern and kern[0].get("status") == "inactive"
        site = api_client.get("/api/duty/site-oncall").json()
        site_rows = [r for r in site.get("rows", []) if r.get("account") == applicant]
        assert site_rows and site_rows[0].get("status") == "inactive"

    def test_e_m06_agree_creates_log(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        if app_id is None:
            return
        api_client.post(f"/api/leave/applications/{app_id}/action", json={
            "operator_id": "test_admin",
            "action": "agree",
        })
        detail_resp = api_client.get(f"/api/leave/applications/{app_id}")
        if detail_resp.status_code == 200:
            logs = detail_resp.json()["logs"]
            agree_logs = [l for l in logs if l.get("action") == "同意申请"]
            assert len(agree_logs) >= 1


class TestLeaveApplicationDelete:
    def _create_application(self, api_client, test_data, ensure_approver_whitelist):
        data = test_data["leave_application"]
        resp = api_client.post("/api/leave/applications", json=data)
        if resp.status_code == 200:
            return resp.json().get("id")
        return None

    def test_tc_m06_024_delete_leave_application(self, api_client, test_data, ensure_approver_whitelist):
        app_id = self._create_application(api_client, test_data, ensure_approver_whitelist)
        assert app_id is not None
        resp = api_client.delete(
            f"/api/leave/applications/{app_id}",
            params={"operator_id": "test_admin"},
        )
        assert resp.status_code == 200
        assert resp.json().get("ok") is True
        detail = api_client.get(f"/api/leave/applications/{app_id}")
        assert detail.status_code == 404

    def test_tc_m06_025_delete_nonexistent_application(self, api_client):
        resp = api_client.delete(
            "/api/leave/applications/999999",
            params={"operator_id": "test_admin"},
        )
        assert resp.status_code == 404

    def test_e_m06_delete_approved_restores_duty_when_no_other_suspend(
        self, api_client, test_data, ensure_approver_whitelist, ensure_test_users
    ):
        from datetime import datetime, timedelta, timezone

        applicant = TestLeaveDutyAutoRestore._ensure_applicant(api_client, test_data)
        TestLeaveDutyAutoRestore._seed_rotation_active(api_client, applicant)
        now = datetime.now(timezone.utc)
        data = dict(test_data["leave_application"])
        data["applicant_account"] = applicant
        data["segments"] = [
            {
                "start_at": (now - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "end_at": (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "reason": "删除后恢复当值",
            }
        ]
        create_resp = api_client.post("/api/leave/applications", json=data)
        if create_resp.status_code != 200:
            return
        app_id = create_resp.json().get("id")
        agree_resp = api_client.post(
            f"/api/leave/applications/{app_id}/action",
            json={"operator_id": "test_admin", "action": "agree"},
        )
        assert agree_resp.status_code == 200
        rot_mid = api_client.get("/api/duty/rotation").json()
        kern_mid = [r for r in rot_mid.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern_mid and kern_mid[0].get("status") == "inactive"
        del_resp = api_client.delete(
            f"/api/leave/applications/{app_id}",
            params={"operator_id": "test_admin"},
        )
        assert del_resp.status_code == 200
        rot = api_client.get("/api/duty/rotation").json()
        kern = [r for r in rot.get("kernelRotation", []) if r.get("account") == applicant]
        assert kern and kern[0].get("status") == "active"
