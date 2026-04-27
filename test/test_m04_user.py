class TestUserList:
    def test_tc_m04_001_list_users(self, api_client):
        resp = api_client.get("/api/admin/users")
        assert resp.status_code == 200
        assert "items" in resp.json()
        assert isinstance(resp.json()["items"], list)


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
                "is_pl": False,
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


class TestUserDelete:
    def test_tc_m04_004_delete_user(self, api_client):
        api_client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": "test_delete_user",
                "user_name": "待删除用户",
                "role_code": "普通人员",
                "group_name": "测试组",
                "is_pl": False,
                "is_active": True,
            }],
            "operator_id": "test_admin",
        })
        resp = api_client.delete("/api/admin/users", params={"account": "test_delete_user"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
