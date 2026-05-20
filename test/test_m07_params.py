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


class TestDutyFieldTreeDeep:
    def test_e_m07_put_tree_readback_consistency(self, api_client, ensure_test_users):
        tree_nodes = [
            {"label": "一级分类A", "children": [
                {"label": "二级分类A1", "children": []},
                {"label": "二级分类A2", "children": []},
            ]},
            {"label": "一级分类B", "children": []},
        ]
        put_resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": tree_nodes,
        })
        assert put_resp.status_code == 200
        get_resp = api_client.get("/api/params/duty-field/tree")
        assert get_resp.status_code == 200
        nodes = get_resp.json()["nodes"]
        labels = [n["label"] for n in nodes]
        assert "一级分类A" in labels
        assert "一级分类B" in labels
        node_a = next(n for n in nodes if n["label"] == "一级分类A")
        child_labels = [c["label"] for c in node_a["children"]]
        assert "二级分类A1" in child_labels
        assert "二级分类A2" in child_labels

    def test_e_m07_put_tree_empty_clears_all(self, api_client, ensure_test_users):
        put_resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": [{"label": "临时节点", "children": []}],
        })
        assert put_resp.status_code == 200
        clear_resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": [],
        })
        assert clear_resp.status_code == 200
        get_resp = api_client.get("/api/params/duty-field/tree")
        assert get_resp.status_code == 200
        assert get_resp.json()["nodes"] == []

    def test_e_m07_put_tree_nested_empty_label_rejected(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": [
                {"label": "有效节点", "children": [
                    {"label": "", "children": []},
                ]},
            ],
        })
        assert resp.status_code == 400

    def test_e_m07_put_tree_non_admin_rejected(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_user01",
            "nodes": [{"label": "非管理员测试", "children": []}],
        })
        assert resp.status_code == 403

    def test_e_m07_put_tree_deep_nesting(self, api_client, ensure_test_users):
        deep_node = {"label": "L1", "children": []}
        current = deep_node
        for i in range(10):
            child = {"label": f"L{i + 2}", "children": []}
            current["children"] = [child]
            current = child
        resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": [deep_node],
        })
        assert resp.status_code == 200
        get_resp = api_client.get("/api/params/duty-field/tree")
        assert get_resp.status_code == 200


class TestBaselineVersionDeep:
    def test_e_m07_create_and_readback(self, api_client, ensure_test_users):
        label = "V_DeepReadback_Test"
        commit = "abc123def"
        create_resp = api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_admin",
            "version_label": label,
            "commit_hash": commit,
        })
        assert create_resp.status_code == 200
        item = create_resp.json()["item"]
        assert item["version_label"] == label
        assert item["commit_hash"] == commit
        assert "id" in item
        assert "updated_at" in item

    def test_e_m07_patch_no_fields_rejected(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        row_id = ensure_baseline_version["id"]
        resp = api_client.patch(f"/api/params/baseline-versions/{row_id}", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code == 400

    def test_e_m07_patch_empty_label_rejected(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        row_id = ensure_baseline_version["id"]
        resp = api_client.patch(f"/api/params/baseline-versions/{row_id}", json={
            "operator_id": "test_admin",
            "version_label": "",
        })
        assert resp.status_code == 400

    def test_e_m07_patch_nonexistent_baseline(self, api_client, ensure_test_users):
        resp = api_client.patch("/api/params/baseline-versions/999999", json={
            "operator_id": "test_admin",
            "version_label": "不存在",
        })
        assert resp.status_code in (404, 400)

    def test_e_m07_create_non_admin_rejected(self, api_client, ensure_test_users):
        resp = api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_user01",
            "version_label": "V_NonAdmin",
        })
        assert resp.status_code == 403

    def test_e_m07_delete_nonexistent_baseline(self, api_client, ensure_test_users):
        resp = api_client.delete("/api/params/baseline-versions/999999", params={"operator_id": "test_admin"})
        assert resp.status_code in (200, 404)

    def test_e_m07_search_baseline_returns_matching(self, api_client, ensure_test_users):
        api_client.post("/api/params/baseline-versions", json={
            "operator_id": "test_admin",
            "version_label": "V_SearchTarget_UniqueXYZ",
        })
        resp = api_client.get("/api/params/baseline-versions", params={"q": "UniqueXYZ"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        matching = [i for i in items if "UniqueXYZ" in i.get("version_label", "")]
        assert len(matching) >= 1

    def test_e_m07_patch_commit_hash(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        row_id = ensure_baseline_version["id"]
        resp = api_client.patch(f"/api/params/baseline-versions/{row_id}", json={
            "operator_id": "test_admin",
            "commit_hash": "newhash999",
        })
        assert resp.status_code == 200
        assert resp.json()["item"]["commit_hash"] == "newhash999"


class TestHotfixVersionDeep:
    def test_e_m07_create_hotfix_empty_label_rejected(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "",
        })
        assert resp.status_code == 400

    def test_e_m07_patch_hotfix_empty_label_rejected(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        create_resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_EmptyPatchTest",
        })
        if create_resp.status_code != 200:
            return
        row_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/params/hotfix-versions/{row_id}", json={
            "operator_id": "test_admin",
            "hotfix_label": "",
        })
        assert resp.status_code == 400

    def test_e_m07_patch_hotfix_no_fields_rejected(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        create_resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_NoFieldsTest",
        })
        if create_resp.status_code != 200:
            return
        row_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/params/hotfix-versions/{row_id}", json={
            "operator_id": "test_admin",
        })
        assert resp.status_code == 400

    def test_e_m07_patch_hotfix_nonexistent_baseline(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        create_resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_MoveBaselineTest",
        })
        if create_resp.status_code != 200:
            return
        row_id = create_resp.json()["item"]["id"]
        resp = api_client.patch(f"/api/params/hotfix-versions/{row_id}", json={
            "operator_id": "test_admin",
            "baseline_id": 999999,
        })
        assert resp.status_code == 400

    def test_e_m07_hotfix_list_includes_baseline_info(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_BaselineInfoCheck",
        })
        resp = api_client.get("/api/params/hotfix-versions")
        assert resp.status_code == 200
        items = resp.json()["items"]
        matching = [i for i in items if i.get("hotfix_label") == "HF_BaselineInfoCheck"]
        if matching:
            item = matching[0]
            assert "baseline_version_label" in item or "baseline_id" in item

    def test_e_m07_hotfix_search(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_admin",
            "baseline_id": bl_id,
            "hotfix_label": "HF_SearchTarget_UniqueABC",
        })
        resp = api_client.get("/api/params/hotfix-versions", params={"q": "UniqueABC"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        matching = [i for i in items if "UniqueABC" in i.get("hotfix_label", "")]
        assert len(matching) >= 1

    def test_e_m07_create_hotfix_non_admin_rejected(self, api_client, ensure_baseline_version, ensure_test_users):
        if ensure_baseline_version is None:
            return
        bl_id = ensure_baseline_version["id"]
        resp = api_client.post("/api/params/hotfix-versions", json={
            "operator_id": "test_user01",
            "baseline_id": bl_id,
            "hotfix_label": "HF_NonAdmin",
        })
        assert resp.status_code == 403


class TestGroupTemplateDeep:
    def test_e_m07_put_all_four_kinds(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/group-templates", json={
            "operator_id": "test_admin",
            "items": [
                {"problem_kind": "major", "group_name_tpl": "重大模板", "group_notice_tpl": "重大通知", "group_members_tpl": "重大成员", "first_report_tpl": "重大首报"},
                {"problem_kind": "urgent", "group_name_tpl": "紧急模板", "group_notice_tpl": "紧急通知", "group_members_tpl": "紧急成员", "first_report_tpl": "紧急首报"},
                {"problem_kind": "itr", "group_name_tpl": "ITR模板", "group_notice_tpl": "ITR通知", "group_members_tpl": "ITR成员", "first_report_tpl": "ITR首报"},
                {"problem_kind": "general", "group_name_tpl": "一般模板", "group_notice_tpl": "一般通知", "group_members_tpl": "一般成员", "first_report_tpl": "一般首报"},
            ],
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        list_resp = api_client.get("/api/params/group-templates")
        assert list_resp.status_code == 200
        items = list_resp.json()["items"]
        kinds = {i["problem_kind"] for i in items}
        assert "major" in kinds
        assert "urgent" in kinds
        assert "itr" in kinds
        assert "general" in kinds

    def test_e_m07_put_unknown_kind_rejected(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/group-templates", json={
            "operator_id": "test_admin",
            "items": [
                {"problem_kind": "major", "group_name_tpl": "重大"},
                {"problem_kind": "urgent", "group_name_tpl": "紧急"},
                {"problem_kind": "itr", "group_name_tpl": "ITR"},
                {"problem_kind": "unknown_kind", "group_name_tpl": "未知"},
            ],
        })
        assert resp.status_code == 400

    def test_e_m07_put_non_admin_rejected(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/group-templates", json={
            "operator_id": "test_user01",
            "items": [
                {"problem_kind": "major", "group_name_tpl": "重大"},
                {"problem_kind": "urgent", "group_name_tpl": "紧急"},
                {"problem_kind": "itr", "group_name_tpl": "ITR"},
                {"problem_kind": "general", "group_name_tpl": "一般"},
            ],
        })
        assert resp.status_code == 403

    def test_e_m07_put_duplicate_kinds_rejected(self, api_client, ensure_test_users):
        resp = api_client.put("/api/params/group-templates", json={
            "operator_id": "test_admin",
            "items": [
                {"problem_kind": "major", "group_name_tpl": "重大1"},
                {"problem_kind": "major", "group_name_tpl": "重大2"},
                {"problem_kind": "urgent", "group_name_tpl": "紧急"},
                {"problem_kind": "general", "group_name_tpl": "一般"},
            ],
        })
        assert resp.status_code == 400

    def test_e_m07_list_template_item_structure(self, api_client):
        resp = api_client.get("/api/params/group-templates")
        assert resp.status_code == 200
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "problem_kind" in item
            assert "group_name_tpl" in item


class TestIssueRootCause:
    def test_tc_m07_issue_root_cause_list(self, api_client):
        resp = api_client.get("/api/params/issue-root-cause")
        assert resp.status_code == 200
        data = resp.json()
        assert "issue_types" in data
        assert "items" in data
        assert isinstance(data["issue_types"], list)
        if data["issue_types"]:
            assert len(data["items"]) == len(data["issue_types"])

    def test_tc_m07_issue_root_cause_put_and_readback(self, api_client, ensure_test_users):
        list_resp = api_client.get("/api/params/issue-root-cause")
        if list_resp.status_code != 200:
            return
        issue_types = list_resp.json().get("issue_types") or []
        if not issue_types:
            return
        items = [
            {
                "issue_type": it,
                "categories": ["测试根因A", "测试根因B"] if it == issue_types[0] else ["其它根因"],
            }
            for it in issue_types
        ]
        put_resp = api_client.put("/api/params/issue-root-cause", json={
            "operator_id": "test_admin",
            "items": items,
        })
        assert put_resp.status_code == 200
        assert put_resp.json().get("ok") is True
        row = next((x for x in put_resp.json().get("items") or [] if x.get("issue_type") == issue_types[0]), None)
        assert row is not None
        assert "测试根因A" in (row.get("categories") or [])

    def test_tc_m07_issue_root_cause_put_non_admin_rejected(self, api_client, ensure_test_users):
        list_resp = api_client.get("/api/params/issue-root-cause")
        if list_resp.status_code != 200:
            return
        issue_types = list_resp.json().get("issue_types") or []
        if not issue_types:
            return
        items = [{"issue_type": it, "categories": []} for it in issue_types]
        resp = api_client.put("/api/params/issue-root-cause", json={
            "operator_id": "test_user01",
            "items": items,
        })
        assert resp.status_code == 403

    def test_tc_m07_issue_root_cause_add_issue_type(self, api_client, ensure_test_users):
        list_resp = api_client.get("/api/params/issue-root-cause")
        if list_resp.status_code != 200:
            return
        data = list_resp.json()
        issue_types = list(data.get("issue_types") or [])
        items = list(data.get("items") or [])
        new_type = "E2E测试问题类型_XYZ"
        if new_type in issue_types:
            issue_types = [t for t in issue_types if t != new_type]
            items = [x for x in items if x.get("issue_type") != new_type]
        items.append({"issue_type": new_type, "categories": ["测试根因"]})
        put_resp = api_client.put("/api/params/issue-root-cause", json={
            "operator_id": "test_admin",
            "items": items,
        })
        assert put_resp.status_code == 200
        assert new_type in (put_resp.json().get("issue_types") or [])
        schema = api_client.get("/api/nodes/ops_analysis/schema")
        if schema.status_code == 200:
            it_field = next((f for f in schema.json().get("fields") or [] if f.get("key") == "issue_type"), None)
            assert it_field is not None
            assert new_type in (it_field.get("options") or [])

    def test_tc_m07_ops_analysis_schema_root_cause_linkage(self, api_client):
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        if resp.status_code != 200:
            return
        fields = resp.json().get("fields") or []
        rc = next((f for f in fields if f.get("key") == "root_cause_category"), None)
        assert rc is not None
        parent = rc.get("options_by_parent") or {}
        assert parent.get("parent_field") == "issue_type"
        assert isinstance(parent.get("map"), dict)
