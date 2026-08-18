import os

import psycopg
import pytest


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

    def test_e_m07_put_tree_research_flag_ignored(self, api_client, ensure_test_users):
        """research_flag 已废弃（在研责任田改独立表）：载荷中出现该字段应被忽略且不报错。"""
        tree_nodes = [
            {"label": "在研领域A", "research_flag": True, "children": [
                {"label": "在研模块A1", "owner": "张三 zhangsan", "research_flag": True, "children": []},
                {"label": "在研模块A2", "owner": "李四 lisi", "children": []},
            ]},
            {"label": "在研叶子领域B", "research_flag": True, "children": []},
        ]
        put_resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": tree_nodes,
        })
        assert put_resp.status_code == 200, put_resp.text
        get_resp = api_client.get("/api/params/duty-field/tree")
        assert get_resp.status_code == 200
        nodes = get_resp.json()["nodes"]
        root_a = next(n for n in nodes if n["label"] == "在研领域A")
        assert "research_flag" not in root_a, "树节点不应再返回 research_flag 字段"
        a1 = next(c for c in root_a["children"] if c["label"] == "在研模块A1")
        assert a1.get("owner") == "张三 zhangsan", "忽略 research_flag 不应影响责任人持久化"

    def test_e_m07_put_tree_l2_owner_persisted(self, api_client, ensure_test_users):
        """二级模块（一级下的第二层）责任人应落库并读回；一级/三级忽略 owner。"""
        tree_nodes = [
            {
                "label": "存储引擎",
                "owner": "不应保存的一级",
                "children": [
                    {
                        "label": "段页管理",
                        "owner": "张三 zhangsan",
                        "children": [
                            {"label": "空闲空间管理", "owner": "不应保存的三级", "children": []},
                        ],
                    },
                ],
            },
        ]
        put_resp = api_client.put("/api/params/duty-field/tree", json={
            "operator_id": "test_admin",
            "nodes": tree_nodes,
        })
        assert put_resp.status_code == 200
        get_resp = api_client.get("/api/params/duty-field/tree")
        assert get_resp.status_code == 200
        nodes = get_resp.json()["nodes"]
        root = next(n for n in nodes if n["label"] == "存储引擎")
        assert root.get("owner", "") == ""
        l2 = next(c for c in root["children"] if c["label"] == "段页管理")
        assert l2.get("owner") == "张三 zhangsan"
        l3 = next(c for c in l2["children"] if c["label"] == "空闲空间管理")
        assert l3.get("owner", "") == ""

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


class TestResearchDutyField:
    """在研责任田两层模型：田目录（GET/PUT 全量替换，带 id）+ 节点关联（PUT /binding 单槽位 upsert）。

    目录只管名称/责任人（名称目录内唯一）；「领域/模块」关联在 binding 接口按槽位维护，
    不同槽位可绑同一田（统计按田合并），field_id=None 解除关联（田保留）。
    """

    ENDPOINT = "/api/params/research-duty-field"
    BINDING_ENDPOINT = "/api/params/research-duty-field/binding"

    def _get_items(self, api_client):
        resp = api_client.get(self.ENDPOINT)
        assert resp.status_code == 200, resp.text
        return resp.json().get("items") or []

    def _put(self, api_client, items, operator="test_admin"):
        return api_client.put(self.ENDPOINT, json={"operator_id": operator, "items": items})

    def _put_binding(self, api_client, domain, module, field_id, operator="test_admin"):
        return api_client.put(self.BINDING_ENDPOINT, json={
            "operator_id": operator, "domain": domain, "module": module, "field_id": field_id,
        })

    def _restore(self, api_client, original):
        """按快照重建：目录全量替换（不带 id 重建）+ 逐槽位恢复关联。

        不带 id 提交会删光旧目录再按序插入（id 换新，名称/顺序/关联等价），对徽标/统计无影响。
        """
        self._put(api_client, [{"name": it["name"], "owner": it.get("owner", "")} for it in original])
        for it in original:
            for sc in it.get("scopes") or []:
                cur = self._get_items(api_client)
                hit = next((x for x in cur if x["name"] == it["name"]), None)
                if hit:
                    self._put_binding(api_client, sc["domain"], sc["module"], hit["id"])

    # ---------- GET ----------

    def test_tc_m07_research_duty_field_get(self, api_client):
        resp = api_client.get(self.ENDPOINT)
        assert resp.status_code == 200
        assert "items" in resp.json()
        items = resp.json()["items"]
        assert isinstance(items, list)
        for it in items:
            assert set(("id", "name", "owner", "scopes")) <= set(it.keys()), it
            assert isinstance(it["scopes"], list)
            for sc in it["scopes"]:
                assert set(("domain", "module")) <= set(sc.keys()), sc

    # ---------- PUT 田目录 ----------

    def test_tc_m07_research_duty_field_put_roundtrip(self, api_client, ensure_test_users):
        original = self._get_items(api_client)
        try:
            items = [
                {"name": "内核在研田", "owner": "张三 zhangsan"},
                {"name": "公有云在研田", "owner": "李四 lisi"},
            ]
            put_resp = self._put(api_client, items)
            assert put_resp.status_code == 200, put_resp.text
            assert put_resp.json().get("ok") is True
            readback = self._get_items(api_client)
            assert len(readback) == 2
            # sort_order = 提交顺序；新田 id 由库分配；目录新建田尚无关联
            assert readback[0]["name"] == "内核在研田"
            assert readback[0]["owner"] == "张三 zhangsan"
            assert isinstance(readback[0]["id"], int)
            assert readback[0]["scopes"] == []
            assert readback[1]["name"] == "公有云在研田"
            assert readback[1]["scopes"] == []
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_id_semantics(self, api_client, ensure_test_users):
        """带 id 全量替换：有 id=更新（保 id 保关联）、无 id=新增、缺失 id=删除（级联删关联）。"""
        original = self._get_items(api_client)
        try:
            self._put(api_client, [
                {"name": "id语义田A", "owner": "张三 zhangsan"},
                {"name": "id语义田B", "owner": "李四 lisi"},
            ])
            rows = self._get_items(api_client)
            a_id, b_id = rows[0]["id"], rows[1]["id"]
            # A 绑模块槽位、B 绑整领域槽位
            r1 = self._put_binding(api_client, "id语义领域", "模块M", a_id)
            assert r1.status_code == 200, r1.text
            r2 = self._put_binding(api_client, "id语义领域", "", b_id)
            assert r2.status_code == 200, r2.text

            # 提交 [A(改责任人), C(新)]：B 缺失 → 删除且关联级联清空；A 更新保留 id 与关联
            resp = self._put(api_client, [
                {"id": a_id, "name": "id语义田A改", "owner": "王五 wangwu"},
                {"name": "id语义田C", "owner": "赵六 zhaoliu"},
            ])
            assert resp.status_code == 200, resp.text
            readback = self._get_items(api_client)
            assert [x["name"] for x in readback] == ["id语义田A改", "id语义田C"]
            a_row = readback[0]
            assert a_row["id"] == a_id, "更新应保留原 id"
            assert a_row["owner"] == "王五 wangwu"
            assert a_row["scopes"] == [{"domain": "id语义领域", "module": "模块M"}], "更新不应丢关联"
            assert readback[1]["scopes"] == []
            # B 的槽位关联随田级联删除：整领域槽位现为空
            check = self._put_binding(api_client, "id语义领域", "", None)
            assert check.status_code == 200, "B 删除后整领域槽位应无残留关联（解除为幂等 no-op）"
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_empty_list(self, api_client, ensure_test_users):
        original = self._get_items(api_client)
        try:
            put_resp = self._put(api_client, [])
            assert put_resp.status_code == 200, put_resp.text
            assert self._get_items(api_client) == []
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_empty_name_rejected(self, api_client, ensure_test_users):
        original = self._get_items(api_client)
        try:
            resp = self._put(api_client, [{"name": "  ", "owner": "x"}])
            assert resp.status_code == 400
            assert "名称" in resp.json().get("detail", "")
            # 校验失败不应改动既有数据
            assert self._get_items(api_client) == original
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_duplicate_name_rejected(self, api_client, ensure_test_users):
        """目录内名称唯一（树弹窗按名称下拉，重名无法区分）；不同槽位/不同田可同名关联不受影响。"""
        original = self._get_items(api_client)
        try:
            resp = self._put(api_client, [
                {"name": "重名田", "owner": "x"},
                {"name": "重名田", "owner": "y"},
            ])
            assert resp.status_code == 400
            assert "名称重复" in resp.json().get("detail", "")
            assert self._get_items(api_client) == original
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_duplicate_id_rejected(self, api_client, ensure_test_users):
        original = self._get_items(api_client)
        try:
            resp = self._put(api_client, [
                {"name": "id重复田A", "owner": "x"},
                {"name": "id重复田B", "owner": "y"},
            ])
            assert resp.status_code == 200, resp.text
            new_id = self._get_items(api_client)[0]["id"]
            resp2 = self._put(api_client, [
                {"id": new_id, "name": "id重复田A", "owner": "x"},
                {"id": new_id, "name": "id重复田B", "owner": "y"},
            ])
            assert resp2.status_code == 400
            assert "id 重复" in resp2.json().get("detail", "")
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_missing_id_rejected(self, api_client, ensure_test_users):
        original = self._get_items(api_client)
        try:
            resp = self._put(api_client, [{"id": 99999999, "name": "不存在田", "owner": "x"}])
            assert resp.status_code == 400
            assert "条目不存在" in resp.json().get("detail", "")
            assert self._get_items(api_client) == original
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_too_long_rejected(self, api_client, ensure_test_users):
        """列宽 VARCHAR(256)（责任树节点 label 允许 512）：超长必须 400，不能落库时 500。"""
        original = self._get_items(api_client)
        try:
            for field, label in (("name", "名称"), ("owner", "责任人")):
                row = {"name": "超长田", "owner": "x"}
                row[field] = "长" * 257
                resp = self._put(api_client, [row])
                assert resp.status_code == 400, f"{field} 超长应 400: {resp.status_code} {resp.text}"
                assert label in resp.json().get("detail", ""), f"{field} 超长报错应指明字段: {resp.text}"
            # 校验失败不应改动既有数据
            assert self._get_items(api_client) == original
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_put_hidden_role_rejected(self, api_client, ensure_test_users):
        """普通人员默认 readonly=可写；显式 hidden 后 PUT 403 且不清数据（测试内插删行，不依赖库内状态）。"""
        dsn = os.environ.get("DATABASE_URL") or ""
        if not dsn:
            pytest.skip("需要 DATABASE_URL 直连数据库以临时插删白名单行")
        original = self._get_items(api_client)
        # 记住既有行（0119 曾为含 params_config 的角色回填 readonly），结束时按原样恢复
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT permission_level FROM role_permission_policy
                       WHERE role_code='普通人员' AND is_pl=false AND node_key='__whitelist__'
                         AND field_key='params_research_duty_field'""")
                row = cur.fetchone()
        prev_level = row[0] if row else None
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO role_permission_policy
                           (role_code, is_pl, node_key, field_key, permission_level, updated_by)
                           VALUES ('普通人员', false, '__whitelist__', 'params_research_duty_field', 'hidden', 'pytest')
                           ON CONFLICT (role_code, is_pl, node_key, field_key)
                           DO UPDATE SET permission_level = 'hidden'""")
                conn.commit()
            resp = self._put(api_client, [{"name": "越权田", "owner": "x"}], operator="test_user01")
            assert resp.status_code == 403
            assert "在研责任田" in resp.json().get("detail", "")
            # 403 先于写库：数据保持原样
            assert self._get_items(api_client) == original
        finally:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    if prev_level is None:
                        cur.execute(
                            """DELETE FROM role_permission_policy
                               WHERE role_code='普通人员' AND is_pl=false AND node_key='__whitelist__'
                                 AND field_key='params_research_duty_field'""")
                    else:
                        cur.execute(
                            """UPDATE role_permission_policy SET permission_level = %s
                               WHERE role_code='普通人员' AND is_pl=false AND node_key='__whitelist__'
                                 AND field_key='params_research_duty_field'""",
                            (prev_level,))
                conn.commit()
            self._restore(api_client, original)

    # ---------- PUT /binding 节点关联 ----------

    def test_tc_m07_research_duty_field_binding_roundtrip(self, api_client, ensure_test_users):
        """单槽位 upsert：绑定 → 换绑（同槽位移动）→ 多模块共田 → 解除（田保留）→ 再解除（幂等）。"""
        original = self._get_items(api_client)
        try:
            self._put(api_client, [
                {"name": "绑定田一", "owner": "张三 zhangsan"},
                {"name": "绑定田二", "owner": "李四 lisi"},
            ])
            rows = self._get_items(api_client)
            f1, f2 = rows[0]["id"], rows[1]["id"]

            # 绑定
            resp = self._put_binding(api_client, "绑定领域", "模块甲", f1)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["绑定田一"]["scopes"] == [{"domain": "绑定领域", "module": "模块甲"}]

            # 换绑：同槽位移到另一田
            resp = self._put_binding(api_client, "绑定领域", "模块甲", f2)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["绑定田一"]["scopes"] == []
            assert items["绑定田二"]["scopes"] == [{"domain": "绑定领域", "module": "模块甲"}]

            # 多模块共田：另一模块槽位也绑到田二
            resp = self._put_binding(api_client, "绑定领域", "模块乙", f2)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["绑定田二"]["scopes"] == [
                {"domain": "绑定领域", "module": "模块甲"},
                {"domain": "绑定领域", "module": "模块乙"},
            ]

            # 解除其中一个槽位：田与另一槽位保留
            resp = self._put_binding(api_client, "绑定领域", "模块甲", None)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["绑定田二"]["scopes"] == [{"domain": "绑定领域", "module": "模块乙"}]

            # 解除不存在的槽位：幂等 no-op
            resp = self._put_binding(api_client, "绑定领域", "模块丙", None)
            assert resp.status_code == 200, resp.text

            # 整领域槽位（module 空）与模块槽位互不冲突
            resp = self._put_binding(api_client, "绑定领域", "", f1)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["绑定田一"]["scopes"] == [{"domain": "绑定领域", "module": ""}]
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_binding_validations(self, api_client, ensure_test_users):
        original = self._get_items(api_client)
        try:
            self._put(api_client, [{"name": "校验田", "owner": "x"}])
            f_id = self._get_items(api_client)[0]["id"]

            # field_id 不在目录
            resp = self._put_binding(api_client, "校验领域", "模块", 99999999)
            assert resp.status_code == 400
            assert "在研责任田不存在" in resp.json().get("detail", "")

            # domain 为空
            resp = self._put_binding(api_client, "  ", "模块", f_id)
            assert resp.status_code == 400
            assert "领域" in resp.json().get("detail", "")

            # 超长（领域/模块）
            for which in ("domain", "module"):
                payload = {"operator_id": "test_admin", "domain": "校验领域", "module": "模块", "field_id": f_id}
                payload[which] = "长" * 257
                resp = api_client.put(self.BINDING_ENDPOINT, json=payload)
                assert resp.status_code == 400, f"{which} 超长应 400: {resp.status_code} {resp.text}"

            # 校验失败不应产生任何关联
            items = {x["name"]: x for x in self._get_items(api_client)}
            assert items["校验田"]["scopes"] == []
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_binding_deep_module_path(self, api_client, ensure_test_users):
        """三级以下节点槽位契约：module 为多段路径（二级起标签按 / 连接，如「模块/特性/子项」）。

        责任田树任意层级都可配在研（前端放开深度门后），binding 接口对多段 module 的
        绑定/回读/换绑/解除须与单段模块行为一致（BTRIM 槽位唯一键同样适用）。
        """
        original = self._get_items(api_client)
        try:
            self._put(api_client, [{"name": "深路径田", "owner": "王五 wangwu"}])
            f_id = self._get_items(api_client)[0]["id"]

            deep_module = "E2E研模块A1/E2E研特性X/E2E研子项Y"
            resp = self._put_binding(api_client, "E2E研领域A", deep_module, f_id)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["深路径田"]["scopes"] == [{"domain": "E2E研领域A", "module": deep_module}]

            # 深路径槽位与同前缀浅槽位互不冲突（各占一个 BTRIM 唯一键）
            resp = self._put_binding(api_client, "E2E研领域A", "E2E研模块A1", f_id)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["深路径田"]["scopes"] == [
                {"domain": "E2E研领域A", "module": deep_module},
                {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            ]

            # 解除深路径槽位仅移除该槽位
            resp = self._put_binding(api_client, "E2E研领域A", deep_module, None)
            assert resp.status_code == 200, resp.text
            items = {x["name"]: x for x in resp.json()["items"]}
            assert items["深路径田"]["scopes"] == [{"domain": "E2E研领域A", "module": "E2E研模块A1"}]
        finally:
            self._restore(api_client, original)

    def test_tc_m07_research_duty_field_binding_hidden_role_rejected(self, api_client, ensure_test_users):
        dsn = os.environ.get("DATABASE_URL") or ""
        if not dsn:
            pytest.skip("需要 DATABASE_URL 直连数据库以临时插删白名单行")
        original = self._get_items(api_client)
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT permission_level FROM role_permission_policy
                       WHERE role_code='普通人员' AND is_pl=false AND node_key='__whitelist__'
                         AND field_key='params_research_duty_field'""")
                row = cur.fetchone()
        prev_level = row[0] if row else None
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO role_permission_policy
                           (role_code, is_pl, node_key, field_key, permission_level, updated_by)
                           VALUES ('普通人员', false, '__whitelist__', 'params_research_duty_field', 'hidden', 'pytest')
                           ON CONFLICT (role_code, is_pl, node_key, field_key)
                           DO UPDATE SET permission_level = 'hidden'""")
                conn.commit()
            resp = self._put_binding(api_client, "越权领域", "模块", None, operator="test_user01")
            assert resp.status_code == 403
            assert "在研责任田" in resp.json().get("detail", "")
            assert self._get_items(api_client) == original
        finally:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    if prev_level is None:
                        cur.execute(
                            """DELETE FROM role_permission_policy
                               WHERE role_code='普通人员' AND is_pl=false AND node_key='__whitelist__'
                                 AND field_key='params_research_duty_field'""")
                    else:
                        cur.execute(
                            """UPDATE role_permission_policy SET permission_level = %s
                               WHERE role_code='普通人员' AND is_pl=false AND node_key='__whitelist__'
                                 AND field_key='params_research_duty_field'""",
                            (prev_level,))
                conn.commit()
            self._restore(api_client, original)

    # ---------- 表未就绪 ----------

    def test_tc_m07_research_duty_field_missing_table_503(self, api_client, ensure_test_users):
        """表未就绪（未按序执行 0119+0123）时：GET/PUT 目录、PUT binding 与分析接口均 503 并提示迁移脚本。"""
        dsn = os.environ.get("DATABASE_URL") or ""
        if not dsn:
            pytest.skip("需要 DATABASE_URL 直连数据库以临时重建表")
        original = self._get_items(api_client)
        ddl = """DROP TABLE IF EXISTS research_duty_field_binding;
            DROP TABLE IF EXISTS research_duty_field;
            CREATE TABLE research_duty_field (
            id BIGSERIAL PRIMARY KEY,
            name VARCHAR(256) NOT NULL,
            owner VARCHAR(256) NOT NULL DEFAULT '',
            sort_order INT NOT NULL DEFAULT 0,
            updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE research_duty_field_binding (
            id BIGSERIAL PRIMARY KEY,
            field_id BIGINT NOT NULL REFERENCES research_duty_field(id) ON DELETE CASCADE,
            domain VARCHAR(256) NOT NULL DEFAULT '',
            module VARCHAR(256) NOT NULL DEFAULT '',
            updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX idx_research_duty_field_binding_dom_mod
            ON research_duty_field_binding (BTRIM(domain), BTRIM(module));"""
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("DROP TABLE IF EXISTS research_duty_field_binding")
                    cur.execute("DROP TABLE IF EXISTS research_duty_field")
                conn.commit()
            get_resp = api_client.get(self.ENDPOINT)
            assert get_resp.status_code == 503, get_resp.text
            detail = get_resp.json().get("detail", "")
            assert "0119_research_duty_field" in detail, detail
            assert "0123_research_duty_field_binding" in detail, detail
            put_resp = self._put(api_client, [{"name": "x", "owner": ""}])
            assert put_resp.status_code == 503, put_resp.text
            bind_resp = self._put_binding(api_client, "领域", "模块", None)
            assert bind_resp.status_code == 503, bind_resp.text
            ana_resp = api_client.get("/api/qi/analytics", params={"operator_id": "admin"})
            assert ana_resp.status_code == 503, ana_resp.text
            assert "在研责任田表未就绪" in ana_resp.json().get("detail", "")
        finally:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(ddl)
                conn.commit()
            self._restore(api_client, original)
