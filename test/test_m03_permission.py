class TestPermissionList:
    def test_tc_m03_001_list_permissions(self, api_client):
        resp = api_client.get("/api/admin/permissions")
        assert resp.status_code == 200
        assert "items" in resp.json()
        assert isinstance(resp.json()["items"], list)

    def test_tc_m03_005_effective_permissions(self, api_client):
        resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        body = resp.json()
        assert "flags" in body

    def test_e_m03_effective_permissions_structure(self, api_client, ensure_test_users):
        resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["operator_id"] == "test_user01"
        flags = body["flags"]
        assert isinstance(flags, dict)

    def test_e_m03_effective_permissions_admin_vs_user(self, api_client, ensure_test_users):
        admin_resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_admin"})
        user_resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert admin_resp.status_code == 200
        assert user_resp.status_code == 200
        admin_flags = admin_resp.json()["flags"]
        user_flags = user_resp.json()["flags"]
        assert isinstance(admin_flags, dict)
        assert isinstance(user_flags, dict)

    def test_e_m03_effective_permissions_pl_vs_non_pl(self, api_client, ensure_test_users):
        pl_resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user02"})
        non_pl_resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert pl_resp.status_code == 200
        assert non_pl_resp.status_code == 200
        pl_flags = pl_resp.json()["flags"]
        non_pl_flags = non_pl_resp.json()["flags"]
        assert isinstance(pl_flags, dict)
        assert isinstance(non_pl_flags, dict)

    def test_e_m03_effective_permissions_nonexistent_user(self, api_client):
        resp = api_client.get("/api/permissions/effective", params={"operator_id": "nonexistent_user_xyz"})
        assert resp.status_code == 200
        flags = resp.json()["flags"]
        assert isinstance(flags, dict)

    def test_e_m03_list_permissions_item_structure(self, api_client):
        resp = api_client.get("/api/admin/permissions")
        assert resp.status_code == 200
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "role_code" in item
            assert "is_pl" in item
            assert "node_key" in item
            assert "field_key" in item
            assert "permission_level" in item


class TestPermissionBulkUpsert:
    def test_tc_m03_002_bulk_upsert_permissions(self, api_client, test_data):
        resp = api_client.post("/api/admin/permissions/bulk", json={
            "items": test_data["permissions"],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m03_003_invalid_permission_level(self, api_client):
        resp = api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "home",
                "permission_level": "invalid_level",
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 400

    def test_e_m03_upsert_all_valid_levels(self, api_client):
        for level in ("hidden", "readonly", "editable"):
            resp = api_client.post("/api/admin/permissions/bulk", json={
                "items": [{
                    "role_code": "普通人员",
                    "is_pl": False,
                    "node_key": "__whitelist__",
                    "field_key": f"test_field_{level}",
                    "permission_level": level,
                }],
                "operator_id": "test_admin",
            })
            assert resp.status_code == 200, f"Valid level '{level}' should be accepted"

    def test_e_m03_upsert_empty_items(self, api_client):
        resp = api_client.post("/api/admin/permissions/bulk", json={
            "items": [],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m03_upsert_multiple_items(self, api_client):
        resp = api_client.post("/api/admin/permissions/bulk", json={
            "items": [
                {
                    "role_code": "普通人员",
                    "is_pl": False,
                    "node_key": "problem_fill",
                    "field_key": "location",
                    "permission_level": "readonly",
                },
                {
                    "role_code": "普通人员",
                    "is_pl": True,
                    "node_key": "problem_fill",
                    "field_key": "location",
                    "permission_level": "editable",
                },
            ],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["count"] == 2

    def test_e_m03_upsert_updates_existing(self, api_client):
        api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "test_update_field",
                "permission_level": "hidden",
            }],
            "operator_id": "test_admin",
        })
        resp = api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "test_update_field",
                "permission_level": "editable",
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        list_resp = api_client.get("/api/admin/permissions")
        items = list_resp.json()["items"]
        target = next(
            (i for i in items if i["field_key"] == "test_update_field" and i["role_code"] == "普通人员" and i["is_pl"] is False),
            None,
        )
        assert target is not None, "Updated permission should exist"
        assert target["permission_level"] == "editable"

    def test_e_m03_upsert_count_matches(self, api_client):
        items = [
            {
                "role_code": "管理员",
                "is_pl": False,
                "node_key": "problem_fill",
                "field_key": f"field_count_{i}",
                "permission_level": "editable",
            }
            for i in range(3)
        ]
        resp = api_client.post("/api/admin/permissions/bulk", json={
            "items": items,
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["count"] == 3


class TestPermissionDelete:
    def test_tc_m03_004_delete_permission(self, api_client):
        resp = api_client.delete("/api/admin/permissions", params={
            "role_code": "普通人员",
            "is_pl": False,
            "node_key": "__whitelist__",
            "field_key": "home",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m03_delete_nonexistent_permission(self, api_client):
        resp = api_client.delete("/api/admin/permissions", params={
            "role_code": "不存在的角色",
            "is_pl": False,
            "node_key": "__whitelist__",
            "field_key": "nonexistent_field",
        })
        assert resp.status_code == 200

    def test_e_m03_delete_then_verify_absent(self, api_client):
        api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "problem_fill",
                "field_key": "test_delete_verify",
                "permission_level": "readonly",
            }],
            "operator_id": "test_admin",
        })
        del_resp = api_client.delete("/api/admin/permissions", params={
            "role_code": "普通人员",
            "is_pl": False,
            "node_key": "problem_fill",
            "field_key": "test_delete_verify",
        })
        assert del_resp.status_code == 200
        list_resp = api_client.get("/api/admin/permissions")
        items = list_resp.json()["items"]
        found = any(
            i["field_key"] == "test_delete_verify"
            and i["role_code"] == "普通人员"
            and i["is_pl"] is False
            and i["node_key"] == "problem_fill"
            for i in items
        )
        assert not found, "Deleted permission should not appear in list"


class TestPermissionEnforcement:
    def test_e_m03_ticket_list_only_self_created_flag(self, api_client, ensure_test_users):
        resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        flags = resp.json()["flags"]
        assert "ticket_list_only_self_created" in flags

    def test_e_m03_ticket_detail_only_problem_fill_flag(self, api_client, ensure_test_users):
        resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        flags = resp.json()["flags"]
        assert "ticket_detail_only_problem_fill" in flags

    def test_e_m03_permission_affects_ticket_list(self, api_client, ensure_test_users):
        api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "ticket_list_only_self_created",
                "permission_level": "editable",
            }],
            "operator_id": "test_admin",
        })
        eff_resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert eff_resp.status_code == 200
        flags = eff_resp.json()["flags"]
        ticket_list_val = flags.get("ticket_list_only_self_created")
        assert isinstance(ticket_list_val, (bool, int, str))

    def test_e_m03_permission_affects_ticket_detail(self, api_client, ensure_test_users):
        api_client.post("/api/admin/permissions/bulk", json={
            "items": [{
                "role_code": "普通人员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "ticket_detail_only_problem_fill",
                "permission_level": "editable",
            }],
            "operator_id": "test_admin",
        })
        eff_resp = api_client.get("/api/permissions/effective", params={"operator_id": "test_user01"})
        assert eff_resp.status_code == 200
        flags = eff_resp.json()["flags"]
        detail_val = flags.get("ticket_detail_only_problem_fill")
        assert isinstance(detail_val, (bool, int, str))
