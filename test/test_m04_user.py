class TestUserList:
    def test_tc_m04_001_list_users(self, api_client):
        resp = api_client.get("/api/admin/users")
        assert resp.status_code == 200
        assert "items" in resp.json()
        assert isinstance(resp.json()["items"], list)

    def test_e_m04_list_users_item_structure(self, api_client, ensure_test_users):
        resp = api_client.get("/api/admin/users")
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) > 0, "Should have at least one user"
        item = items[0]
        assert "account" in item
        assert "user_name" in item
        assert "role_code" in item
        assert "group_name" in item
        assert "email" in item
        assert "contact_phone" in item
        assert "product_line" in item
        assert "expert_domain" in item
        assert "min_dept" in item
        assert "remark" in item
        assert "is_active" in item
        assert "is_pl" not in item

    def test_e_m04_list_users_contains_test_users(self, api_client, ensure_test_users):
        resp = api_client.get("/api/admin/users")
        assert resp.status_code == 200
        accounts = [u["account"] for u in resp.json()["items"]]
        assert "test_admin" in accounts, "test_admin should exist"
        assert "test_user01" in accounts, "test_user01 should exist"
        assert "test_user02" in accounts, "test_user02 should exist"

    def test_e_m04_list_users_sorted_by_account(self, api_client, ensure_test_users):
        resp = api_client.get("/api/admin/users")
        assert resp.status_code == 200
        accounts = [u["account"] for u in resp.json()["items"]]
        assert accounts == sorted(accounts), "Users should be sorted by account"


class TestUserBulkUpsert:
    def test_tc_m04_002_bulk_upsert_users(self, api_client, test_data):
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": test_data["users"],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m04_003_upsert_existing_user(self, api_client):
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_user01",
                "user_name": "测试用户01_更新",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "user01@test.local",
                "contact_phone": "13900000001",
                "product_line": "公有云",
                "expert_domain": "SQL引擎",
                "min_dept": "运维一组",
                "remark": "测试备注",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        list_resp = api_client.get("/api/admin/users")
        items = list_resp.json()["items"]
        target = next((u for u in items if u["account"] == "test_user01"), None)
        if target:
            assert target["user_name"] == "测试用户01_更新"
            assert target["email"] == "user01@test.local"
            assert target["min_dept"] == "运维一组"
            assert target["expert_domain"] == "SQL引擎"

    def test_e_m04_upsert_new_user(self, api_client):
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_new_user_001",
                "user_name": "新建测试用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        list_resp = api_client.get("/api/admin/users")
        accounts = [u["account"] for u in list_resp.json()["items"]]
        assert "test_new_user_001" in accounts

    def test_e_m04_upsert_multiple_users(self, api_client):
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [
                {
                    "account": "test_bulk_001",
                    "user_name": "批量用户1",
                    "role_code": "普通人员",
                    "group_name": "测试组",
                    "email": "",
                    "contact_phone": "",
                    "product_line": "",
                    "min_dept": "",
                    "remark": "",
                    "is_active": True,
                },
                {
                    "account": "test_bulk_002",
                    "user_name": "批量用户2",
                    "role_code": "管理员",
                    "group_name": "测试组",
                    "email": "bulk2@test.local",
                    "contact_phone": "13700000002",
                    "product_line": "混合云（轻量化）",
                    "min_dept": "管理组",
                    "remark": "",
                    "is_active": True,
                },
            ],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        list_resp = api_client.get("/api/admin/users")
        accounts = [u["account"] for u in list_resp.json()["items"]]
        assert "test_bulk_001" in accounts
        assert "test_bulk_002" in accounts

    def test_e_m04_upsert_change_role(self, api_client):
        api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_role_change",
                "user_name": "角色变更用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_role_change",
                "user_name": "角色变更用户",
                "role_code": "管理员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        list_resp = api_client.get("/api/admin/users")
        target = next((u for u in list_resp.json()["items"] if u["account"] == "test_role_change"), None)
        assert target is not None
        assert target["role_code"] == "管理员"

    def test_e_m04_upsert_toggle_active(self, api_client):
        api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_toggle_active",
                "user_name": "活跃切换用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_toggle_active",
                "user_name": "活跃切换用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": False,
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        list_resp = api_client.get("/api/admin/users")
        target = next((u for u in list_resp.json()["items"] if u["account"] == "test_toggle_active"), None)
        assert target is not None
        assert target["is_active"] is False

    def test_e_m04_upsert_empty_items(self, api_client):
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestUserDelete:
    def test_tc_m04_004_delete_user(self, api_client):
        api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_delete_user",
                "user_name": "待删除用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        resp = api_client.delete("/api/admin/users", params={"account": "test_delete_user"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m04_delete_nonexistent_user(self, api_client):
        resp = api_client.delete("/api/admin/users", params={"account": "nonexistent_user_xyz"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_e_m04_delete_then_verify_absent(self, api_client):
        api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_delete_verify",
                "user_name": "删除验证用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        del_resp = api_client.delete("/api/admin/users", params={"account": "test_delete_verify"})
        assert del_resp.status_code == 200
        list_resp = api_client.get("/api/admin/users")
        accounts = [u["account"] for u in list_resp.json()["items"]]
        assert "test_delete_verify" not in accounts, "Deleted user should not appear in list"

    def test_e_m04_recreate_after_delete(self, api_client):
        api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_recreate_user",
                "user_name": "重新创建用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "email": "",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        api_client.delete("/api/admin/users", params={"account": "test_recreate_user"})
        resp = api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_recreate_user",
                "user_name": "重新创建用户V2",
                "role_code": "管理员",
                "group_name": "新测试组",
                "email": "recreate@test.local",
                "contact_phone": "",
                "product_line": "",
                "min_dept": "",
                "remark": "重建",
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        assert resp.status_code == 200
        list_resp = api_client.get("/api/admin/users")
        target = next((u for u in list_resp.json()["items"] if u["account"] == "test_recreate_user"), None)
        assert target is not None
        assert target["user_name"] == "重新创建用户V2"
        assert target["remark"] == "重建"
