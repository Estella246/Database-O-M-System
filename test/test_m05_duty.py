def _hide_duty_roster_edit_for_role(api_client, role_code: str) -> None:
    api_client.post("/api/admin/permissions/bulk", json={
        "items": [{
            "role_code": role_code,
            "is_pl": False,
            "node_key": "__whitelist__",
            "field_key": "duty_roster_edit",
            "permission_level": "hidden",
        }],
        "operator_id": "test_admin",
    })


def _allow_duty_roster_edit_for_role(api_client, role_code: str) -> None:
    api_client.post("/api/admin/permissions/bulk", json={
        "items": [{
            "role_code": role_code,
            "is_pl": False,
            "node_key": "__whitelist__",
            "field_key": "duty_roster_edit",
            "permission_level": "readonly",
        }],
        "operator_id": "test_admin",
    })


def _allow_duty_rl_roster_edit_for_role(api_client, role_code: str) -> None:
    api_client.post("/api/admin/permissions/bulk", json={
        "items": [{
            "role_code": role_code,
            "is_pl": False,
            "node_key": "__whitelist__",
            "field_key": "duty_roster_edit",
            "permission_level": "editable",
        }],
        "operator_id": "test_admin",
    })


class TestDutyCalendar:
    def test_tc_m05_001_get_duty_calendar(self, api_client):
        resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert "kernel" in body
        assert "control" in body
        assert "public_cloud" in body
        assert "poc" in body
        assert "research_version" in body

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

    def test_tc_m05_004b_put_duty_calendar_whitelist_readonly(self, api_client, ensure_test_users):
        _allow_duty_roster_edit_for_role(api_client, "普通人员")
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_user01",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-01": [{"account": "test_user01", "user_name": "测试用户01", "shift": "full"}]},
        })
        assert resp.status_code == 200

    def test_tc_m05_004_put_duty_calendar_no_edit_permission(self, api_client, ensure_test_users):
        _hide_duty_roster_edit_for_role(api_client, "普通人员")
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_user01",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-02": [{"account": "test_user01", "user_name": "测试用户01", "shift": "full"}]},
        })
        assert resp.status_code == 403

    def test_tc_m05_004c_put_duty_calendar_rl_only_edit_forbidden(self, api_client, ensure_test_users):
        _allow_duty_rl_roster_edit_for_role(api_client, "普通人员")
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_user01",
            "kind": "kernel",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-02": [{"account": "test_user01", "user_name": "测试用户01", "shift": "full"}]},
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

    def test_e_m05_put_calendar_poc_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "poc",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-17": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        get_resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert get_resp.status_code == 200
        assert "2026-04-17" in get_resp.json()["poc"]

    def test_e_m05_put_calendar_research_version_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "research_version",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-18": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        get_resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        assert get_resp.status_code == 200
        assert "2026-04-18" in get_resp.json()["research_version"]

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

    def test_e_m05_put_holiday_no_edit_permission(self, api_client, ensure_test_users):
        _hide_duty_roster_edit_for_role(api_client, "普通人员")
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

    def test_e_m05_put_rotation_no_edit_permission(self, api_client, ensure_test_users):
        _hide_duty_roster_edit_for_role(api_client, "普通人员")
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

    def test_put_rotation_preserves_server_last_accept_at(self, api_client, ensure_test_users):
        from database import db_conn

        acct = "rot_preserve_la01"
        ts = "2026-06-25 10:30:00"
        ticket_no = "YW99990625001"
        with db_conn() as conn:
            conn.execute("DELETE FROM duty_rotation_entry WHERE account = %s", (acct,))
            conn.execute(
                """
                INSERT INTO duty_rotation_entry (
                  roster_kind, position, account, user_name, status, last_accept_at,
                  last_dispatch_ticket_no, updated_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                ("kernelRotation", 0, acct, "保留测试", "active", ts, ticket_no, "pytest"),
            )
            conn.commit()

        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {
                "kernelRotation": [
                    {
                        "account": acct,
                        "user_name": "保留测试",
                        "status": "inactive",
                        "last_accept_at": "",
                    },
                ],
            },
        })
        assert resp.status_code == 200
        get_resp = api_client.get("/api/duty/rotation")
        rows = get_resp.json().get("kernelRotation", [])
        hit = next((r for r in rows if r.get("account") == acct), None)
        assert hit is not None
        assert hit.get("last_accept_at") == ts
        assert hit.get("status") == "inactive"

    def test_e_m05_put_rotation_poc_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {
                "pocRotation": [
                    {"account": "test_admin", "user_name": "测试管理员", "status": "active"},
                ],
            },
        })
        assert resp.status_code == 200
        get_resp = api_client.get("/api/duty/rotation")
        assert get_resp.status_code == 200
        rows = get_resp.json().get("pocRotation", [])
        assert any(r.get("account") == "test_admin" for r in rows)

    def test_e_m05_put_rotation_research_version_kind(self, api_client, ensure_test_users):
        resp = api_client.put("/api/duty/rotation", json={
            "operator_id": "test_admin",
            "lists": {
                "researchVersionRotation": [
                    {"account": "test_admin", "user_name": "测试管理员", "status": "active"},
                ],
            },
        })
        assert resp.status_code == 200
        get_resp = api_client.get("/api/duty/rotation")
        assert get_resp.status_code == 200
        rows = get_resp.json().get("researchVersionRotation", [])
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
            "pocRotation",
            "researchVersionRotation",
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

    def test_e_m05_put_site_oncall_no_edit_permission(self, api_client, ensure_test_users):
        _hide_duty_roster_edit_for_role(api_client, "普通人员")
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

    def test_e_m05_put_rl_oncall_whitelist_readonly(self, api_client, ensure_test_users):
        _allow_duty_roster_edit_for_role(api_client, "普通人员")
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
        assert resp.status_code == 200

    def test_e_m05_put_rl_oncall_no_edit_permission(self, api_client, ensure_test_users):
        _hide_duty_roster_edit_for_role(api_client, "普通人员")
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_user01",
            "rows": [
                {
                    "duty_date": "2026-04-04",
                    "primary": {"account": "test_user01", "user_name": "测试用户01", "phone": "13800000004"},
                    "backup": {},
                },
            ],
        })
        assert resp.status_code == 403

    def test_e_m05_put_rl_oncall_whitelist_rl_only_edit(self, api_client, ensure_test_users):
        _allow_duty_rl_roster_edit_for_role(api_client, "普通人员")
        resp = api_client.put("/api/duty/rl-oncall", json={
            "operator_id": "test_user01",
            "rows": [
                {
                    "duty_date": "2026-04-05",
                    "primary": {"account": "test_user01", "user_name": "测试用户01", "phone": "13800000004"},
                    "backup": {},
                },
            ],
        })
        assert resp.status_code == 200

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


def _build_duty_calendar_import_xlsx(rows, *, date_values=None, data_start_row=3):
    """rows: list of (date, account, user_name, shift) starting at data_start_row.

    date_values: optional parallel list of raw cell values for the date column
    (e.g. Excel serial numbers) used instead of the date string in each row.
    """
    import io

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    headers = ["日期", "账号", "姓名", "班次"]
    for col_idx, header in enumerate(headers, start=1):
        ws.cell(row=1, column=col_idx, value=header)
    if data_start_row >= 3:
        example = ["2026-04-01", "", "（示例，请填写真实账号）", "全天"]
        for col_idx, value in enumerate(example, start=1):
            ws.cell(row=2, column=col_idx, value=value)
    for i, row in enumerate(rows, start=data_start_row):
        for col_idx, value in enumerate(row, start=1):
            if col_idx == 1 and date_values is not None:
                value = date_values[i - data_start_row]
            ws.cell(row=i, column=col_idx, value=value)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


class TestDutyCalendarImport:
    def test_m05_calendar_import_success(self, api_client, ensure_test_users):
        content = _build_duty_calendar_import_xlsx([
            ("2026-04-03", "test_admin", "测试管理员", "全天"),
            ("2026-04-04", "test_user01", "测试用户01", "晚班"),
        ])
        files = {"file": ("import.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": "2026",
            "month": "4",
        }
        resp = api_client.post("/api/duty/calendar/import", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["total"] == 2
        get_resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        kernel = get_resp.json()["kernel"]
        assert "2026-04-03" in kernel
        assert "2026-04-04" in kernel

    def test_m05_calendar_import_unknown_account_on_row2_fails(self, api_client, ensure_test_users):
        import json

        content = _build_duty_calendar_import_xlsx(
            [("2026-04-05", "no_such_user_xyz", "不存在", "全天")],
            data_start_row=2,
        )
        files = {"file": ("import.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": "2026",
            "month": "4",
        }
        resp = api_client.post("/api/duty/calendar/import", files=files, data=data)
        assert resp.status_code == 400
        detail = json.loads(resp.json()["detail"])
        assert detail["errors"][0]["row"] == 2
        assert "no_such_user_xyz" in detail["errors"][0]["message"]

    def test_m05_calendar_import_unknown_account_fails(self, api_client, ensure_test_users):
        content = _build_duty_calendar_import_xlsx([
            ("2026-04-05", "no_such_user_xyz", "不存在", "全天"),
        ])
        files = {"file": ("import.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": "2026",
            "month": "4",
        }
        resp = api_client.post("/api/duty/calendar/import", files=files, data=data)
        assert resp.status_code == 400

    def test_m05_calendar_import_no_permission(self, api_client, ensure_test_users):
        _hide_duty_roster_edit_for_role(api_client, "普通人员")
        content = _build_duty_calendar_import_xlsx([
            ("2026-04-06", "test_user01", "测试用户01", "全天"),
        ])
        files = {"file": ("import.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "operator_id": "test_user01",
            "kind": "kernel",
            "year": "2026",
            "month": "4",
        }
        resp = api_client.post("/api/duty/calendar/import", files=files, data=data)
        assert resp.status_code == 403

    def test_m05_calendar_import_excel_serial_date(self, api_client, ensure_test_users):
        from datetime import datetime

        from openpyxl.utils.datetime import to_excel

        serial = to_excel(datetime(2026, 4, 9))
        content = _build_duty_calendar_import_xlsx(
            [("2026-04-09", "test_admin", "测试管理员", "全天")],
            date_values=[serial],
        )
        files = {"file": ("import.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "operator_id": "test_admin",
            "kind": "kernel",
            "year": "2026",
            "month": "4",
        }
        resp = api_client.post("/api/duty/calendar/import", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["total"] == 1

    def test_m05_calendar_import_overwrites_month(self, api_client, ensure_test_users):
        api_client.put("/api/duty/calendar", json={
            "operator_id": "test_admin",
            "kind": "control",
            "year": 2026,
            "month": 4,
            "days": {"2026-04-07": [{"account": "test_admin", "user_name": "测试管理员", "shift": "full"}]},
        })
        content = _build_duty_calendar_import_xlsx([
            ("2026-04-08", "test_user01", "测试用户01", "全天"),
        ])
        files = {"file": ("import.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "operator_id": "test_admin",
            "kind": "control",
            "year": "2026",
            "month": "4",
        }
        resp = api_client.post("/api/duty/calendar/import", files=files, data=data)
        assert resp.status_code == 200
        get_resp = api_client.get("/api/duty/calendar", params={"year": 2026, "month": 4})
        control = get_resp.json()["control"]
        assert "2026-04-07" not in control
        assert "2026-04-08" in control
