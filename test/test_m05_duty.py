class TestDutyCalendar:
    def test_tc_m05_001_get_duty_calendar(self, api_client):
        resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert "kernel" in body
        assert "control" in body

    def test_tc_m05_002_put_duty_calendar_kernel(self, api_client, test_data, ensure_test_users):
        data = test_data["duty_calendar"]
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": data["kind"],
            "year": data["year"],
            "month": data["month"],
            "days": data["days"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m05_003_put_duty_calendar_invalid_kind(self, api_client):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "invalid",
            "year": 2026,
            "month": 4,
            "days": {},
        })
        assert resp.status_code == 400

    def test_tc_m05_004_put_duty_calendar_non_admin(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_user01",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-01": [{"account": "test_user01", "user_name": "测试用户01", "shift": "full"}]},
        })
        assert resp.status_code == 403

    def test_tc_m05_005_put_duty_calendar_wrong_month_date(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-05-01": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        assert resp.status_code == 400


class TestDutyRotation:
    def test_tc_m05_006_get_duty_rotation(self, api_client):
        resp = api_client.get("/api/duty/rotation")
        assert resp.status_code == 200
        body = resp.json()
        assert "kernelRotation" in body
        assert "controlRotation" in body

    def test_tc_m05_007_put_duty_rotation(self, api_client, test_data, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": test_data["rotation"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m05_008_put_duty_rotation_unknown_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {"unknownKind": [{"account": "test_admin", "user_name": "测试管理员", "status": "active"}]},
        })
        assert resp.status_code == 400

    def test_tc_m05_009_put_duty_rotation_empty_account(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {"kernelRotation": [{"account": "", "user_name": "", "status": "active"}]},
        })
        assert resp.status_code == 400


class TestDutySiteOncall:
    def test_tc_m05_010_get_site_oncall(self, api_client):
        resp = api_client.get("/api/duty/site-oncall")
        assert resp.status_code == 200
        assert "rows" in resp.json()

    def test_tc_m05_011_put_site_oncall(self, api_client, test_data, ensure_test_users):
        resp = api_client.put("/api/duty/site-oncall", json={
            "operator_id": "test_admin",
            "rows": test_data["site_oncall"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m05_012_put_site_oncall_missing_site(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/site-oncall", json={
            "operator_id": "test_admin",
            "rows": [{"account": "test_admin", "user_name": "测试管理员", "status": "active"}],
        })
        assert resp.status_code == 400


class TestDutyRlOncall:
    def test_tc_m05_013_get_rl_oncall(self, api_client):
        resp = api_client.get("/api/duty/rl-oncall")
        assert resp.status_code == 200
        assert "rows" in resp.json()

    def test_tc_m05_014_put_rl_oncall(self, api_client, test_data, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_admin",
            "rows": test_data["rl_oncall"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m05_015_put_rl_oncall_duplicate_date(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_admin",
            "rows": [
                {
                    "duty_date": "2026-04-01",
                    "primary": {"account": "test_admin", "user_name": "测试管理员", "phone": "13800000001"},
                    "backup": {"account": "test_user01", "user_name": "测试用户01", "phone": "13800000002"},
                },
                {
                    "duty_date": "2026-04-01",
                    "primary": {"account": "test_user02", "user_name": "测试用户02", "phone": "13800000003"},
                    "backup": {},
                },
            ],
        })
        assert resp.status_code == 400

    def test_tc_m05_016_put_rl_oncall_missing_phone(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_admin",
            "rows": [
                {
                    "duty_date": "2026-04-02",
                    "primary": {"account": "test_admin", "user_name": "测试管理员", "phone": ""},
                    "backup": {},
                },
            ],
        })
        assert resp.status_code == 400
