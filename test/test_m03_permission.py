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
