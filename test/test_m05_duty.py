class TestDutyCalendar:
    def test_tc_m05_001_get_duty_calendar(self, api_client):
        resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert "kernel" in body
        assert "control" in body
        assert "public_cloud" in body

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

    def test_e_m05_get_calendar_year_month_in_response(self, api_client):
        resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 5})
        assert resp.status_code == 200
        body = resp.json()
        assert body["year"] == 2026
        assert body["month"] == 5

    def test_e_m05_put_calendar_control_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "control",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-15": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m05_put_calendar_public_cloud_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "public_cloud",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-16": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        get_resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert get_resp.status_code == 200
        assert "2026-04-16" in get_resp.json()["public_cloud"]

    def test_e_m05_put_calendar_empty_days(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {},
        })
        assert resp.status_code == 200

    def test_e_m05_put_calendar_multiple_shifts_per_day(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {
                "2026-04-20": [
                    {"account": "test_admin", "user_name": "测试管理员", "shift": "full"},
                    {"account": "test_user01", "user_name": "测试用户01", "shift": "night"},
                ],
            },
        })
        assert resp.status_code == 200

    def test_e_m05_put_calendar_replaces_previous(self, api_client, ensure_test_users):
        api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-25": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        resp2 = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-26": [{"account": "test_user01", "user_name": "测试用户01", "shift": "full"}]},
        })
        assert resp2.status_code == 200
        get_resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert get_resp.status_code == 200
        kernel = get_resp.json()["kernel"]
        assert "2026-04-26" in kernel

    def test_e_m05_get_calendar_invalid_month(self, api_client):
        resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 13})
        assert resp.status_code == 500

    def test_e_m05_get_calendar_invalid_year(self, api_client):
        resp = api_client.get("/api/duty/calendar", params={"year": 1999, "month": 4})
        assert resp.status_code == 200


class TestHolidayConfig:
    def test_e_m05_get_holiday_config(self, api_client):
        resp = api_client.get("/api/duty/holidays", params={"year": 2026, "month": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert "year" in body
        assert "month" in body
        assert "days" in body

    def test_e_m05_put_holiday_config(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/holidays", json={
            "operator_id": "test_admin",
            "year": 2026,
            "month": 4,
            "days": {
                "2026-04-05": "weekend_holiday",
                "2026-04-06": "weekend_holiday",
                "2026-04-11": "workday",
            },
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m05_put_holiday_non_admin(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/holidays", json={
            "operator_id": "test_user01",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-05": "weekend_holiday"},
        })
        assert resp.status_code == 403

    def test_e_m05_put_holiday_wrong_month_date(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/holidays", json={
            "operator_id": "test_admin",
            "year": 2026,
            "month": 4,
            "days": {"2026-05-01": "holiday"},
        })
        assert resp.status_code == 400

    def test_e_m05_put_holiday_empty_days(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/holidays", json={
            "operator_id": "test_admin",
            "year": 2026,
            "month": 4,
            "days": {},
        })
        assert resp.status_code == 200

    def test_e_m05_put_holiday_replaces_previous(self, api_client, ensure_test_users):
        api_client.put("/api/duty/holidays", json={
            "operator_id": "test_admin",
            "year": 2026,
            "month": 5,
            "days": {"2026-05-01": "holiday"},
        })
        api_client.put("/api/duty/holidays", json={
            "operator_id": "test_admin",
            "year": 2026,
            "month": 5,
            "days": {"2026-05-02": "workday"},
        })
        get_resp = api_client.get("/api/duty/holidays", params={"year": 2026, "month": 5})
        assert get_resp.status_code == 200
        days = get_resp.json()["days"]
        assert "2026-05-02" in days

    def test_e_m05_get_holiday_year_month_in_response(self, api_client):
        resp = api_client.get("/api/duty/holidays", params={"year": 2026, "month": 6})
        assert resp.status_code == 200
        body = resp.json()
        assert body["year"] == 2026
        assert body["month"] == 6


class TestDutyRotation:
    def test_tc_m05_006_get_duty_rotation(self, api_client):
        resp = api_client.get("/api/duty/rotation")
        assert resp.status_code == 200
        body = resp.json()
        assert "kernelRotation" in body
        assert "controlRotation" in body
        assert "publicCloudRotation" in body

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

    def test_e_m05_put_rotation_non_admin(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_user01",
            "lists": {"kernelRotation": [{"account": "test_user01", "user_name": "测试用户01", "status": "active"}]},
        })
        assert resp.status_code == 403

    def test_e_m05_put_rotation_invalid_status(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {"kernelRotation": [{"account": "test_admin", "user_name": "测试管理员", "status": "invalid_status"}]},
        })
        assert resp.status_code == 400

    def test_e_m05_put_rotation_empty_lists(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {},
        })
        assert resp.status_code == 200

    def test_e_m05_put_rotation_public_cloud_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {
                "publicCloudRotation": [
                    {"account": "test_admin", "user_name": "测试管理员", "status": "active"},
                ],
            },
        })
        assert resp.status_code == 200
        get_resp = api_client.get("/api/duty/rotation")
        assert get_resp.status_code == 200
        rows = get_resp.json().get("publicCloudRotation", [])
        assert any(r.get("account") == "test_admin" for r in rows)

    def test_e_m05_put_rotation_special_kinds(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {
                "specialSlowSql": [{"account": "test_admin", "user_name": "测试管理员", "status": "active"}],
                "specialPerf": [{"account": "test_user01", "user_name": "测试用户01", "status": "active"}],
            },
        })
        assert resp.status_code == 200

    def test_e_m05_get_rotation_returns_all_kinds(self, api_client):
        resp = api_client.get("/api/duty/rotation")
        assert resp.status_code == 200
        body = resp.json()
        expected_kinds = [
            "kernelRotation",
            "controlRotation",
            "publicCloudRotation",
            "specialSlowSql",
            "specialPerf",
            "specialUpgrade",
            "specialScale",
            "specialBackup",
            "specialDr",
        ]
        for kind in expected_kinds:
            assert kind in body, f"Rotation response missing kind: {kind}"


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

    def test_e_m05_put_site_oncall_non_admin(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/site-oncall", json={
            "operator_id": "test_user01",
            "rows": [{"site_name": "北京", "account": "test_user01", "user_name": "测试用户01", "status": "active"}],
        })
        assert resp.status_code == 403

    def test_e_m05_put_site_oncall_empty_rows(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/site-oncall", json={
            "operator_id": "test_admin",
            "rows": [],
        })
        assert resp.status_code == 200

    def test_e_m05_put_site_oncall_multiple_sites(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/site-oncall", json={
            "operator_id": "test_admin",
            "rows": [
                {"site_name": "北京局点", "account": "test_admin", "user_name": "测试管理员", "status": "active"},
                {"site_name": "上海局点", "account": "test_user01", "user_name": "测试用户01", "status": "active"},
            ],
        })
        assert resp.status_code == 200


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

    def test_e_m05_put_rl_oncall_non_admin(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_user01",
            "rows": [
                {
                    "duty_date": "2026-04-03",
                    "primary": {"account": "test_user01", "user_name": "测试用户01", "phone": "13800000004"},
                    "backup": {},
                },
            ],
        })
        assert resp.status_code == 403

    def test_e_m05_put_rl_oncall_empty_rows(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_admin",
            "rows": [],
        })
        assert resp.status_code == 200

    def test_e_m05_put_rl_oncall_with_backup(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_admin",
            "rows": [
                {
                    "duty_date": "2026-04-10",
                    "primary": {"account": "test_admin", "user_name": "测试管理员", "phone": "13800000001"},
                    "backup": {"account": "test_user01", "user_name": "测试用户01", "phone": "13800000002"},
                },
            ],
        })
        assert resp.status_code == 200

    def test_e_m05_put_rl_oncall_missing_date(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_admin",
            "rows": [
                {
                    "primary": {"account": "test_admin", "user_name": "测试管理员", "phone": "13800000001"},
                    "backup": {},
                },
            ],
        })
        assert resp.status_code == 400
