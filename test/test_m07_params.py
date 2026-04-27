class TestDutyFieldTree:
    def test_tc_m07_001_get_duty_field_tree(self, api_client):
        resp = api_client.get("/api/params/duty-field/tree")
        assert resp.status_code == 200
        assert "nodes" in resp.json()

    def test_tc_m07_002_put_duty_field_tree(self, api_client, test_data, ensure_test_users):
        data = test_data["duty_field_tree"]
        resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": data["nodes"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m07_003_put_duty_field_tree_empty_label(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": [{"label": "", "children": []}],
        })
        assert resp.status_code == 400


class TestBaselineVersion:
    def test_tc_m07_005_list_baseline_versions(self, api_client):
        resp = api_client.get("/api/params/baseline-versions")
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m07_006_create_baseline_version(self, api_client, test_data, ensure_test_users):
        data = test_data["baseline_version"]
        resp = api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_admin",
            "version_label": f"{data['version_label']}_new",
            "commit_hash": data["commit_hash"],
        })
        assert resp.status_code == 200
        assert "item" in resp.json()

    def test_tc_m07_007_create_baseline_empty_label(self, api_client, ensure_test_users):
        resp = api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_admin",
            "version_label": "",
        })
        assert resp.status_code == 400

    def test_tc_m07_008_patch_baseline_version(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        row_id = ensure_baseline_version["id"]
        resp = api_client.patch(f"/api/params/baseline-versions/{row_id}", json={
            "operator_id": "test_admin",
            "version_label": f"{ensure_baseline_version['version_label']}_patched",
        })
        assert resp.status_code == 200
        assert resp.json()["item"]["version_label"].endswith("_patched")

    def test_tc_m07_009_delete_baseline_version(self, api_client, ensure_test_users):
        create_resp = api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_admin",
            "version_label": "V_Test_Delete_Target",
        })
        if create_resp.status_code != 200:
            return
        row_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/params/baseline-versions/{row_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m07_010_delete_baseline_with_hotfix(self, api_client, ensure_test_users):
        create_bl = api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_admin",
            "version_label": "V_Test_With_Hotfix",
        })
        if create_bl.status_code != 200:
            return
        bl_id = create_bl.json()["item"]["id"]
        api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_Ref_Test",
        })
        resp = api_client.delete(f"/api/params/baseline-versions/{bl_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 409

    def test_tc_m07_011_search_baseline_versions(self, api_client):
        resp = api_client.get("/api/params/baseline-versions", params={"q": "Test"})
        assert resp.status_code == 200
        assert "items" in resp.json()


class TestHotfixVersion:
    def test_tc_m07_012_list_hotfix_versions(self, api_client):
        resp = api_client.get("/api/params/hotfix-versions")
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m07_013_create_hotfix_version(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_Test_Create_001",
        })
        assert resp.status_code == 200
        assert "item" in resp.json()

    def test_tc_m07_014_create_hotfix_nonexistent_baseline(self, api_client, ensure_test_users):
        resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": 999999,
            "hotfix_label": "HF_NoBaseline",
        })
        assert resp.status_code == 400

    def test_tc_m07_015_patch_hotfix_version(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        create_resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_Patch_Test",
        })
        if create_resp.status_code != 200:
            return
        row_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/params/hotfix-versions/{row_id}", json={
            "operator_id": "test_admin",
            "hotfix_label": "HF_Patch_Test_Updated",
        })
        assert resp.status_code == 200

    def test_tc_m07_016_delete_hotfix_version(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        create_resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_Delete_Target",
        })
        if create_resp.status_code != 200:
            return
        row_id = create_resp.json()["item"]["id"]
        resp = api_client.delete(f"/api/params/hotfix-versions/{row_id}", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestGroupTemplate:
    def test_tc_m07_017_list_group_templates(self, api_client):
        resp = api_client.get("/api/params/group-templates")
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m07_018_put_group_templates(self, api_client, test_data, ensure_test_users):
        resp = api_client.put("/api/params/group-templates", json={
            "operator_id": "test_admin",
            "items": test_data["group_templates"],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_tc_m07_019_put_group_templates_incomplete_kinds(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/group-templates", json={
            "operator_id": "test_admin",
            "items": [
                {"problem_kind": "major", "group_name_tpl": "仅重大"},
            ],
        })
        assert resp.status_code == 400
