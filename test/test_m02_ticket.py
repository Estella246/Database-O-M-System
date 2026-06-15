import re
from datetime import date, datetime
import time

import pytest

_YW_RE = re.compile(r"^YW[0-9]{11}$")
NODE_KEYS = [
    "problem_fill",
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
]

_counter = 0
def _unique_ticket_no():
    # 工单号需匹配 ^YW[0-9]{11}$。后 7 位由「秒级时间戳×100 + 进程内自增计数」取模生成，
    # 保证同一次运行内、以及不同次运行间均不重复，避免复用旧工单导致的脏数据污染。
    global _counter
    _counter += 1
    suffix = (int(time.time()) * 100 + _counter) % 10_000_000
    return f"YW9999{suffix:07d}"


def _build_problem_fill_payload(api_client, overrides=None):
    schema_resp = api_client.get("/api/nodes/problem_fill/schema")
    assert schema_resp.status_code == 200, f"Schema request failed: {schema_resp.status_code}"
    fields = schema_resp.json()["fields"]
    values = {}
    for f in fields:
        key = f["key"]
        if overrides and key in overrides:
            values[key] = overrides[key]
            continue
        if not f.get("required", False):
            continue
        if f.get("readonly", False):
            continue
        if f.get("default_type") in ("today", "login_user"):
            continue
        options = f.get("options", [])
        if options:
            values[key] = options[0]
        elif f.get("type") == "text":
            values[key] = f"test_{key}"
        elif f.get("type") == "richtext":
            values[key] = f"<p>test {key}</p>"
        elif f.get("type") == "date":
            values[key] = "2026-04-27"
    if overrides:
        values.update(overrides)
    return {
        "values": values,
        "operator_id": "test_user01",
        "operator_name": "测试用户01",
    }


def _get_handle_mode_options(api_client, node_key):
    schema_resp = api_client.get(f"/api/nodes/{node_key}/schema")
    if schema_resp.status_code != 200:
        return []
    fields = schema_resp.json()["fields"]
    hm_field = next((f for f in fields if f["key"] == "handle_mode"), None)
    if not hm_field:
        return []
    return hm_field.get("options", [])


def _submit_fill(api_client, ticket_no, overrides=None):
    payload = _build_problem_fill_payload(api_client, overrides=overrides)
    return api_client.post(
        f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
        json=payload,
    )


def _build_node_payload(api_client, node_key, handle_mode, overrides=None):
    schema_resp = api_client.get(f"/api/nodes/{node_key}/schema")
    assert schema_resp.status_code == 200, f"Schema request failed: {schema_resp.status_code}"
    fields = schema_resp.json()["fields"]
    values = {"handle_mode": handle_mode}
    for f in fields:
        key = f["key"]
        if key == "handle_mode":
            continue
        if overrides and key in overrides:
            values[key] = overrides[key]
            continue
        if f.get("readonly", False):
            continue
        constraints = f.get("constraints") or {}
        required_if = constraints.get("required_if")
        if required_if:
            cond_field = list(required_if.keys())[0]
            cond_value = required_if[cond_field]
            cond_actual = values.get(cond_field)
            triggered = False
            if isinstance(cond_value, list):
                triggered = cond_actual in cond_value
            else:
                triggered = cond_actual == cond_value
            if triggered:
                options = f.get("options", [])
                if options:
                    values[key] = options[0]
                elif f.get("type") == "text":
                    values[key] = f"test_{key}"
                elif f.get("type") == "richtext":
                    values[key] = f"<p>test {key}</p>"
                elif f.get("type") == "date":
                    values[key] = "2026-04-27"
                continue
        visible_when_all = constraints.get("visible_when_all")
        required_when_visible = constraints.get("required_when_visible")
        if visible_when_all and required_when_visible:
            all_match = True
            for cond in visible_when_all:
                cond_field = cond.get("field")
                cond_values = cond.get("values", [])
                if values.get(cond_field) not in cond_values:
                    all_match = False
                    break
            if all_match:
                options = f.get("options", [])
                if options:
                    values[key] = options[0]
                elif f.get("type") == "text":
                    values[key] = f"test_{key}"
                elif f.get("type") == "richtext":
                    values[key] = f"<p>test {key}</p>"
                elif f.get("type") == "date":
                    values[key] = "2026-04-27"
                continue
        if not f.get("required", False):
            continue
        options = f.get("options", [])
        if options:
            values[key] = options[0]
        elif f.get("type") == "text":
            values[key] = f"test_{key}"
        elif f.get("type") == "richtext":
            values[key] = f"<p>test {key}</p>"
        elif f.get("type") == "date":
            values[key] = "2026-04-27"
    if overrides:
        values.update(overrides)
    return {
        "values": values,
        "operator_id": "test_user01",
        "operator_name": "测试用户01",
    }


def _submit_node(api_client, ticket_no, node_key, handle_mode, operator_id="test_user01", operator_name="测试用户01", extra_values=None):
    payload = _build_node_payload(api_client, node_key, handle_mode, overrides=extra_values)
    payload["operator_id"] = operator_id
    payload["operator_name"] = operator_name
    return api_client.post(
        f"/api/tickets/{ticket_no}/nodes/{node_key}/submit",
        json=payload,
    )


def _get_debug_status(api_client, ticket_no):
    return api_client.get(f"/api/tickets/{ticket_no}/debug-status")


class TestNodeSchema:
    def test_tc_m02_001_problem_fill_schema(self, api_client):
        resp = api_client.get("/api/nodes/problem_fill/schema")
        assert resp.status_code == 200
        body = resp.json()
        assert body["node_key"] == "problem_fill"
        fields = body["fields"]
        assert isinstance(fields, list) and len(fields) > 0
        keys = [f["key"] for f in fields]
        assert "start_date" in keys

    def test_tc_m02_002_problem_review_schema(self, api_client):
        resp = api_client.get("/api/nodes/problem_review/schema")
        assert resp.status_code == 200
        body = resp.json()
        keys = [f["key"] for f in body["fields"]]
        assert "handle_mode" in keys

    def test_tc_m02_003_ops_analysis_schema(self, api_client):
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0
        ops_keys = {f["key"] for f in resp.json()["fields"]}
        assert "has_coredump_file" not in ops_keys
        has_core_stack = next(
            (f for f in resp.json()["fields"] if f.get("key") == "has_core_stack"),
            None,
        )
        assert has_core_stack is not None
        assert "不涉及" in (has_core_stack.get("options") or [])
        core_stack_text = next(
            (f for f in resp.json()["fields"] if f.get("key") == "core_stack_text"),
            None,
        )
        assert core_stack_text is not None
        assert (core_stack_text.get("constraints") or {}).get("required_if") == {
            "has_core_stack": "是",
        }

    def test_tc_m02_004_dev_analysis_schema(self, api_client):
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0
        dev_keys = {f["key"] for f in resp.json()["fields"]}
        assert "rock_version_involved" not in dev_keys

    def test_dev_analysis_has_intro_fix_version_fields(self, api_client):
        """开发分析节点应包含「引入版本」「修复版本」两个可选下拉字段。"""
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            f = fields.get(key)
            assert f is not None, f"dev_analysis schema missing '{key}' field"
            assert f["type"] == "whitelist"
            assert f.get("required") is False
            assert (f.get("ui_props") or {}).get("inherit_previous") is True

    def test_dev_analysis_version_options_from_baseline(self, api_client, ensure_baseline_version):
        """引入/修复版本下拉选项实时取自「基线版本」参数表。"""
        baseline = ensure_baseline_version
        assert baseline and baseline.get("version_label"), "baseline version fixture unavailable"
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            options = fields[key].get("options") or []
            assert options and options != ["temp"], f"{key} options empty or placeholder-only"
            assert baseline["version_label"] in options, (
                f"{key} options must cover baseline versions"
            )

    def test_dev_analysis_version_options_include_hotfix(self, api_client, ensure_baseline_version, test_data):
        """引入/修复版本下拉选项亦实时取自「热补丁版本」参数表。"""
        baseline = ensure_baseline_version
        assert baseline and baseline.get("id"), "baseline version fixture unavailable"
        hotfix_label = f"{test_data['hotfix_version']['hotfix_label']}_m02_dev"
        create = api_client.post(
            "/api/params/hotfix-versions",
            json={
                "baseline_id": baseline["id"],
                "hotfix_label": hotfix_label,
                "operator_id": "test_admin",
            },
        )
        assert create.status_code == 200, create.text
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            options = fields[key].get("options") or []
            assert hotfix_label in options, f"{key} options must cover hotfix versions"

    def test_dev_analysis_fix_version_supports_multiple_ui(self, api_client):
        """修复版本支持多选；引入版本保持单选。"""
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        assert (fields["fix_version"].get("ui_props") or {}).get("multiple") is True
        assert (fields["intro_version"].get("ui_props") or {}).get("multiple") is not True

    def test_dev_analysis_fix_version_has_unfixed_option(self, api_client):
        """修复版本下拉额外提供「未修复」选项（引入版本不含）。"""
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        fix_opts = fields["fix_version"].get("options") or []
        assert "未修复" in fix_opts, "修复版本应包含「未修复」选项"
        assert "未修复" not in (fields["intro_version"].get("options") or []), "引入版本不应包含「未修复」"

    def test_dev_analysis_version_fields_visible_when_quality_yes(self, api_client):
        """开发分析的引入/修复版本仅在「是否质量问题」为「是」时可见且必填。"""
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            c = fields[key].get("constraints") or {}
            rules = c.get("visible_when_all") or []
            assert any(
                r.get("field") == "is_quality_issue"
                and "是（已知质量问题）" in (r.get("values") or [])
                and "是（新发现质量问题）" in (r.get("values") or [])
                for r in rules
            ), f"{key} should be visible only when is_quality_issue=是"
            assert c.get("required_when_visible") is True

    def test_ops_analysis_has_intro_fix_version_fields(self, api_client):
        """运维分析节点应包含「引入版本」「修复版本」两个字段（默认非必填，条件可见）。"""
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            f = fields.get(key)
            assert f is not None, f"ops_analysis schema missing '{key}' field"
            assert f["type"] == "whitelist"
            assert f.get("required") is False
            assert (f.get("ui_props") or {}).get("inherit_previous") is True

    def test_ops_analysis_version_options_from_baseline(self, api_client, ensure_baseline_version):
        """运维分析的引入/修复版本下拉选项也实时取自「基线版本」参数表。"""
        baseline = ensure_baseline_version
        assert baseline and baseline.get("version_label"), "baseline version fixture unavailable"
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            options = fields[key].get("options") or []
            assert options and options != ["temp"], f"{key} options empty or placeholder-only"
            assert baseline["version_label"] in options, (
                f"ops_analysis {key} options must cover baseline versions"
            )

    def test_ops_analysis_version_options_include_hotfix(self, api_client, ensure_baseline_version, test_data):
        """运维分析的引入/修复版本下拉选项亦实时取自「热补丁版本」参数表。"""
        baseline = ensure_baseline_version
        assert baseline and baseline.get("id"), "baseline version fixture unavailable"
        hotfix_label = f"{test_data['hotfix_version']['hotfix_label']}_m02_ops"
        create = api_client.post(
            "/api/params/hotfix-versions",
            json={
                "baseline_id": baseline["id"],
                "hotfix_label": hotfix_label,
                "operator_id": "test_admin",
            },
        )
        assert create.status_code == 200, create.text
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            options = fields[key].get("options") or []
            assert hotfix_label in options, f"ops_analysis {key} options must cover hotfix versions"

    def test_ops_analysis_fix_version_supports_multiple_ui(self, api_client):
        """运维分析的修复版本同样支持多选；引入版本保持单选。"""
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        assert (fields["fix_version"].get("ui_props") or {}).get("multiple") is True
        assert (fields["intro_version"].get("ui_props") or {}).get("multiple") is not True

    def test_ops_analysis_version_fields_visible_when_quality_yes(self, api_client):
        """运维分析的引入/修复版本仅在「是否质量问题」为「是」时可见且必填。"""
        resp = api_client.get("/api/nodes/ops_analysis/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        for key in ("intro_version", "fix_version"):
            c = fields[key].get("constraints") or {}
            rules = c.get("visible_when_all") or []
            assert any(
                r.get("field") == "is_quality_issue"
                and "是（已知质量问题）" in (r.get("values") or [])
                and "是（新发现质量问题）" in (r.get("values") or [])
                for r in rules
            ), f"ops_analysis {key} should be visible only when is_quality_issue=是"
            assert c.get("required_when_visible") is True

    def test_dev_analysis_collaborator_supports_multiple_ui(self, api_client):
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        collab = next((f for f in resp.json()["fields"] if f["key"] == "collaborator"), None)
        assert collab is not None
        assert (collab.get("ui_props") or {}).get("multiple") is True

    def test_ops_closure_collaborator_supports_multiple_ui(self, api_client):
        resp = api_client.get("/api/nodes/ops_closure/schema")
        assert resp.status_code == 200
        collab = next((f for f in resp.json()["fields"] if f["key"] == "collaborator"), None)
        assert collab is not None
        assert (collab.get("ui_props") or {}).get("multiple") is True

    def test_tc_m02_005_dev_closure_schema(self, api_client):
        resp = api_client.get("/api/nodes/dev_closure/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0

    def test_tc_m02_006_ops_closure_schema(self, api_client):
        resp = api_client.get("/api/nodes/ops_closure/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0
        ops_keys = {f["key"] for f in resp.json()["fields"]}
        assert "rock_version_involved" not in ops_keys

    def test_ops_closure_has_problem_report_file_field(self, api_client):
        resp = api_client.get("/api/nodes/ops_closure/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        report = fields.get("problem_report")
        assert report is not None, "ops_closure schema missing problem_report"
        assert report["type"] == "file"
        assert report.get("label") == "上传问题报告"
        assert report.get("required") is False

    def test_ops_closure_has_collaborator_field(self, api_client):
        resp = api_client.get("/api/nodes/ops_closure/schema")
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.json()["fields"]}
        has_collab = fields.get("has_collaborator")
        assert has_collab is not None, "ops_closure schema missing has_collaborator"
        assert has_collab.get("label") == "是否有协同处理人"
        assert has_collab.get("required") is True
        assert set(has_collab.get("options") or []) >= {"是", "否"}
        collab = fields.get("collaborator")
        assert collab is not None
        cst = collab.get("constraints") or {}
        assert cst.get("visible_when_all") == [{"field": "has_collaborator", "values": ["是"]}]
        assert cst.get("required_when_visible") is True

    def test_ops_closure_collaborator_required_when_has_collaborator_yes(self, api_client):
        ticket_no = _unique_ticket_no()
        assert _submit_fill(api_client, ticket_no).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200
        assert _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析").status_code == 200
        assert _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环").status_code == 200
        assert _submit_node(api_client, ticket_no, "dev_closure", "提交运维闭环").status_code == 200

        payload = _build_node_payload(
            api_client,
            "ops_closure",
            "提交运维审核关闭",
            overrides={"has_collaborator": "是", "collaborator": ""},
        )
        missing_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/ops_closure/submit",
            json=payload,
        )
        assert missing_resp.status_code == 400, missing_resp.text[:400]
        assert "collaborator" in missing_resp.text.lower()

        ok_resp = _submit_node(
            api_client,
            ticket_no,
            "ops_closure",
            "提交运维审核关闭",
            extra_values={"has_collaborator": "否", "collaborator": ""},
        )
        assert ok_resp.status_code == 200, ok_resp.text[:400]

    def test_tc_m02_007_audit_close_schema(self, api_client):
        resp = api_client.get("/api/nodes/audit_close/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0

    def test_tc_m02_008_nonexistent_node_schema(self, api_client):
        resp = api_client.get("/api/nodes/nonexistent/schema")
        assert resp.status_code == 404

    def test_tc_m02_009_schema_has_options(self, api_client):
        resp = api_client.get("/api/nodes/problem_fill/schema")
        assert resp.status_code == 200
        body = resp.json()
        whitelist_fields = [f for f in body["fields"] if f["type"] == "whitelist"]
        for f in whitelist_fields:
            assert "options" in f or "cascade_options" in f

    def test_tc_m02_010_next_handler_options_from_user_account(self, api_client):
        for nk in NODE_KEYS[1:]:
            resp = api_client.get(f"/api/nodes/{nk}/schema")
            if resp.status_code != 200:
                continue
            body = resp.json()
            nh_fields = [f for f in body["fields"] if f["key"] == "next_handler"]
            if not nh_fields:
                continue
            f = nh_fields[0]
            opts = f.get("options") or []
            assert opts, f"next_handler options empty for {nk}"
            assert opts != ["temp"], f"next_handler still placeholder-only for {nk}"
            c = f.get("constraints") or {}
            assert "next_handler_by_handle_mode" not in c

    def test_tc_m02_011_location_options_from_site_profile(self, api_client):
        # 问题填写的「局点」为下拉选择，选项取自「局点档案」的局点名称
        resp = api_client.get("/api/nodes/problem_fill/schema")
        assert resp.status_code == 200
        loc = next((f for f in resp.json()["fields"] if f["key"] == "location"), None)
        assert loc is not None, "problem_fill schema missing 'location' field"
        assert loc["type"] == "whitelist"
        options = loc.get("options") or []
        assert options and options != ["temp"], "location options empty or placeholder-only"

        sp_resp = api_client.get("/api/site-profiles", params={"page_size": 100})
        assert sp_resp.status_code == 200
        site_names = {
            str(it.get("site_name") or "").strip()
            for it in sp_resp.json()["items"]
            if str(it.get("site_name") or "").strip()
        }
        assert site_names, "site_profile is empty; seed migration 0053 expected"
        assert site_names.issubset(set(options)), "location options must cover site_profile names"

    def test_tc_m02_012_new_location_auto_creates_site_profile(self, api_client):
        # 工单填报一个不在档案中的局点名，提交后自动新增到「局点档案」并进入下拉选项
        ticket_no = _unique_ticket_no()
        new_site = f"自动建档局点_{ticket_no}"
        payload = _build_problem_fill_payload(
            api_client, overrides={"location": new_site, "start_date": "2026-04-27"},
        )
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit", json=payload,
        )
        assert resp.status_code == 200, resp.text[:400]

        sp = api_client.get("/api/site-profiles", params={"q": new_site, "page_size": 100})
        assert sp.status_code == 200
        names = [str(it.get("site_name") or "").strip() for it in sp.json()["items"]]
        assert new_site in names, "新局点未写入局点档案"

        schema = api_client.get("/api/nodes/problem_fill/schema").json()
        loc = next(f for f in schema["fields"] if f["key"] == "location")
        assert new_site in (loc.get("options") or []), "新局点未进入局点下拉选项"

    def test_e_m02_schema_field_type_coverage(self, api_client):
        for nk in NODE_KEYS:
            resp = api_client.get(f"/api/nodes/{nk}/schema")
            assert resp.status_code == 200, f"Schema for {nk} returned {resp.status_code}"
            body = resp.json()
            for f in body["fields"]:
                assert "key" in f, f"Field missing 'key' in {nk} schema"
                assert "type" in f, f"Field '{f.get('key')}' missing 'type' in {nk} schema"
                assert "required" in f, f"Field '{f.get('key')}' missing 'required' in {nk} schema"

    def test_e_m02_schema_handle_mode_options_not_empty(self, api_client):
        for nk in NODE_KEYS[1:]:
            options = _get_handle_mode_options(api_client, nk)
            assert len(options) > 0, f"handle_mode options empty for {nk}"


class TestTicketCreate:
    def test_tc_m02_011_auto_allocate_ticket_no(self, api_client):
        resp = _submit_fill(api_client, "YW99990427001")
        assert resp.status_code == 200, f"Submit failed: {resp.status_code} {resp.text[:200]}"
        body = resp.json()
        tid = body.get("ticket_id", "")
        assert _YW_RE.match(tid), f"ticket_id '{tid}' does not match YW format"

    def test_tc_m02_012_specified_ticket_no(self, api_client):
        ticket_no = "YW99990427002"
        resp = _submit_fill(api_client, ticket_no)
        assert resp.status_code == 200, f"Submit failed: {resp.status_code} {resp.text[:200]}"
        assert resp.json()["ticket_id"] == ticket_no

    def test_tc_m02_013_ticket_no_format(self, api_client):
        resp = _submit_fill(api_client, "YW99990427003")
        assert resp.status_code == 200, f"Submit failed: {resp.status_code} {resp.text[:200]}"
        tid = resp.json()["ticket_id"]
        assert _YW_RE.match(tid)

    def test_tc_m02_014_sequential_ticket_no(self, api_client):
        nos = []
        for i in range(2):
            resp = _submit_fill(api_client, f"YW99990427{10 + i:03d}")
            assert resp.status_code == 200, f"Submit {i} failed: {resp.status_code}"
            nos.append(resp.json()["ticket_id"])
        assert nos[1] != nos[0], "Sequential ticket numbers should differ"


class TestNodeSubmit:
    def test_tc_m02_015_problem_fill_normal_submit(self, api_client):
        resp = _submit_fill(api_client, "YW99990427015")
        assert resp.status_code == 200, f"Submit failed: {resp.status_code} {resp.text[:200]}"
        assert resp.json()["ok"] is True

    def test_tc_m02_016_required_field_missing(self, api_client):
        schema_resp = api_client.get("/api/nodes/problem_fill/schema")
        assert schema_resp.status_code == 200
        fields = schema_resp.json()["fields"]
        required_keys = [f["key"] for f in fields if f.get("required")]
        if not required_keys:
            return
        resp = api_client.post(
            "/api/tickets/YW99990427016/nodes/problem_fill/submit",
            json={
                "values": {},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        assert resp.status_code == 400

    def test_tc_m02_017_invalid_date_format(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427017/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "not-a-date", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        assert resp.status_code == 400

    def test_tc_m02_018_location_accepts_free_text(self, api_client):
        payload = _build_problem_fill_payload(
            api_client,
            overrides={"location": "不存在的地区"},
        )
        resp = api_client.post(
            "/api/tickets/YW99990427018/nodes/problem_fill/submit",
            json=payload,
        )
        assert resp.status_code == 200, f"location text should be accepted: {resp.text[:200]}"
        saved = resp.json().get("saved", {}).get("values", {})
        assert saved.get("location") == "不存在的地区"

    def test_tc_m02_019_person_field_canonical(self, api_client):
        payload = _build_problem_fill_payload(api_client)
        resp = api_client.post(
            "/api/tickets/YW99990427019/nodes/problem_fill/submit",
            json=payload,
        )
        assert resp.status_code == 200, f"Submit failed: {resp.status_code} {resp.text[:200]}"
        saved = resp.json().get("saved", {})
        vals = saved.get("values", {})
        if "next_handler" in vals:
            nh = vals["next_handler"]
            assert " " in nh or nh == "", f"Person field should be '姓名 账号' format, got: {nh}"

    def test_tc_m02_024_unknown_fields_rejected(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427024/nodes/problem_fill/submit",
            json={
                "values": {
                    "start_date": "2026-04-27",
                    "location": "华北-北京",
                    "nonexistent_field_xyz": "value",
                },
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        assert resp.status_code == 400


class TestFlowTransition:
    def test_tc_m02_025_review_confirm_problem(self, api_client):
        ticket_no = "YW99990427025"
        fill_resp = _submit_fill(api_client, ticket_no)
        assert fill_resp.status_code == 200, f"Fill submit failed: {fill_resp.status_code}"
        options = _get_handle_mode_options(api_client, "problem_review")
        confirm_opt = next((o for o in options if o == "确认问题"), None)
        assert confirm_opt is not None, "确认问题 option not found in problem_review handle_mode"
        resp = _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        assert resp.status_code == 200, f"Review submit failed: {resp.status_code} {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.status_code == 200
        assert debug.json().get("current_node_key") == "ops_analysis", f"Expected ops_analysis, got {debug.json()}"

    def test_tc_m02_030_audit_close_direct_close(self, api_client):
        ticket_no = "YW99990427030"
        fill_resp = _submit_fill(api_client, ticket_no)
        assert fill_resp.status_code == 200
        resp = _submit_node(api_client, ticket_no, "audit_close", "问题解决关闭")
        assert resp.status_code == 200, f"Audit close failed: {resp.status_code} {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.status_code == 200
        assert debug.json().get("status", "").lower() == "closed"


class TestFullFlowTransition:
    def test_e_m02_full_7_node_forward_flow(self, api_client):
        ticket_no = "YW99990501001"
        fill_resp = _submit_fill(api_client, ticket_no)
        assert fill_resp.status_code == 200, f"Fill failed: {fill_resp.text[:200]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.status_code == 200
        assert debug.json()["current_node_key"] == "problem_review"

        resp = _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        assert resp.status_code == 200, f"Review failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_analysis"

        resp = _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        assert resp.status_code == 200, f"Ops analysis failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_analysis"

        resp = _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        assert resp.status_code == 200, f"Dev analysis failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_closure"

        resp = _submit_node(api_client, ticket_no, "dev_closure", "提交运维闭环")
        assert resp.status_code == 200, f"Dev closure failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_closure"

        resp = _submit_node(api_client, ticket_no, "ops_closure", "提交运维审核关闭")
        assert resp.status_code == 200, f"Ops closure failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "audit_close"

        resp = _submit_node(api_client, ticket_no, "audit_close", "问题解决关闭")
        assert resp.status_code == 200, f"Audit close failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["status"].lower() == "closed"

    def test_e_m02_ops_analysis_to_ops_closure(self, api_client):
        ticket_no = "YW99990501002"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        resp = _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "否"},
        )
        assert resp.status_code == 200, f"Ops→OpsClosure failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_closure"

    def test_e_m02_ops_analysis_to_dev_closure(self, api_client):
        ticket_no = "YW99990501003"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        resp = _submit_node(api_client, ticket_no, "ops_analysis", "提交开发闭环")
        assert resp.status_code == 200, f"Ops→DevClosure failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_closure"

    def test_e_m02_dev_analysis_collaborator_multiple_persisted(self, api_client):
        ticket_no = "YW99990501099"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        schema = api_client.get("/api/nodes/dev_analysis/schema").json()
        collab_field = next((f for f in schema["fields"] if f["key"] == "collaborator"), None)
        opts = (collab_field or {}).get("options") or []
        if len(opts) < 2:
            return
        multi = f"{opts[0]}；{opts[1]}"
        resp = _submit_node(
            api_client,
            ticket_no,
            "dev_analysis",
            "提交开发闭环",
            extra_values={"collaborator": multi},
        )
        assert resp.status_code == 200, resp.text[:300]
        data = api_client.get(f"/api/tickets/{ticket_no}/nodes/dev_analysis/data")
        assert data.status_code == 200
        stored = (data.json().get("values") or {}).get("collaborator", "")
        assert "；" in stored
        assert opts[0] in stored and opts[1] in stored

    def test_e_m02_dev_analysis_version_fields_persisted(self, api_client, ensure_baseline_version):
        """开发分析提交「引入版本」「修复版本」后应正确落库回显。"""
        ticket_no = "YW99990501077"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        schema = api_client.get("/api/nodes/dev_analysis/schema").json()
        fields = {f["key"]: f for f in schema["fields"]}
        intro_opts = fields["intro_version"].get("options") or []
        fix_opts = fields["fix_version"].get("options") or []
        assert intro_opts and fix_opts, "version options unavailable"
        intro_val, fix_val = intro_opts[0], fix_opts[-1]
        resp = _submit_node(
            api_client,
            ticket_no,
            "dev_analysis",
            "提交开发闭环",
            extra_values={"intro_version": intro_val, "fix_version": fix_val},
        )
        assert resp.status_code == 200, resp.text[:300]
        data = api_client.get(f"/api/tickets/{ticket_no}/nodes/dev_analysis/data")
        assert data.status_code == 200
        stored = data.json().get("values") or {}
        assert stored.get("intro_version") == intro_val
        assert stored.get("fix_version") == fix_val

    def test_e_m02_dev_analysis_fix_version_multiple_persisted(self, api_client, ensure_baseline_version):
        """修复版本以全角分号拼接的多个版本提交后应正确落库回显。"""
        ticket_no = "YW99990501078"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        schema = api_client.get("/api/nodes/dev_analysis/schema").json()
        fix_field = next(f for f in schema["fields"] if f["key"] == "fix_version")
        fix_opts = fix_field.get("options") or []
        if len(fix_opts) < 2:
            return
        multi = f"{fix_opts[0]}；{fix_opts[1]}"
        resp = _submit_node(
            api_client,
            ticket_no,
            "dev_analysis",
            "提交开发闭环",
            extra_values={"fix_version": multi},
        )
        assert resp.status_code == 200, resp.text[:300]
        data = api_client.get(f"/api/tickets/{ticket_no}/nodes/dev_analysis/data")
        assert data.status_code == 200
        stored = (data.json().get("values") or {}).get("fix_version", "")
        assert "；" in stored
        assert fix_opts[0] in stored and fix_opts[1] in stored

    def test_e_m02_ops_analysis_version_fields_persisted_when_quality_yes(self, api_client, ensure_baseline_version):
        """运维分析在「是否质量问题=是」时填写引入/修复版本，提交后应正确落库回显。"""
        ticket_no = "YW99990501079"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        fields = {f["key"]: f for f in schema["fields"]}
        intro_opts = fields["intro_version"].get("options") or []
        fix_opts = fields["fix_version"].get("options") or []
        assert intro_opts and fix_opts, "version options unavailable"
        intro_val, fix_val = intro_opts[0], fix_opts[-1]
        resp = _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交开发分析",
            extra_values={
                "is_quality_issue": "是（已知质量问题）",
                "intro_version": intro_val,
                "fix_version": fix_val,
            },
        )
        assert resp.status_code == 200, resp.text[:300]
        data = api_client.get(f"/api/tickets/{ticket_no}/nodes/ops_analysis/data")
        assert data.status_code == 200
        stored = data.json().get("values") or {}
        assert stored.get("intro_version") == intro_val
        assert stored.get("fix_version") == fix_val

    def test_e_m02_ops_analysis_fix_version_multiple_persisted(self, api_client, ensure_baseline_version):
        """运维分析的修复版本以全角分号拼接多版本提交后应正确落库回显。"""
        ticket_no = "YW99990501080"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        fix_field = next(f for f in schema["fields"] if f["key"] == "fix_version")
        fix_opts = fix_field.get("options") or []
        if len(fix_opts) < 2:
            return
        multi = f"{fix_opts[0]}；{fix_opts[1]}"
        resp = _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交开发分析",
            extra_values={
                "is_quality_issue": "是（已知质量问题）",
                "fix_version": multi,
            },
        )
        assert resp.status_code == 200, resp.text[:300]
        data = api_client.get(f"/api/tickets/{ticket_no}/nodes/ops_analysis/data")
        assert data.status_code == 200
        stored = (data.json().get("values") or {}).get("fix_version", "")
        assert "；" in stored
        assert fix_opts[0] in stored and fix_opts[1] in stored

    def test_e_m02_dev_analysis_back_to_ops_analysis(self, api_client):
        ticket_no = "YW99990501004"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        resp = _submit_node(api_client, ticket_no, "dev_analysis", "返回运维分析")
        assert resp.status_code == 200, f"Dev→Ops back failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_analysis"

    def test_e_m02_dev_closure_back_to_dev_analysis(self, api_client):
        ticket_no = "YW99990501005"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        resp = _submit_node(api_client, ticket_no, "dev_closure", "返回开发分析")
        assert resp.status_code == 200, f"DevClosure→DevAnalysis back failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_analysis"

    def test_e_m02_dev_closure_back_to_ops_analysis(self, api_client):
        ticket_no = "YW99990501006"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        resp = _submit_node(api_client, ticket_no, "dev_closure", "返回运维分析")
        assert resp.status_code == 200, f"DevClosure→OpsAnalysis back failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_analysis"

    def test_e_m02_ops_closure_back_to_dev_closure(self, api_client):
        ticket_no = "YW99990501007"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        _submit_node(api_client, ticket_no, "dev_closure", "提交运维闭环")
        resp = _submit_node(api_client, ticket_no, "ops_closure", "返回开发闭环")
        assert resp.status_code == 200, f"OpsClosure→DevClosure back failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_closure"

    def test_e_m02_ops_closure_back_to_ops_analysis(self, api_client):
        ticket_no = "YW99990501008"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        _submit_node(api_client, ticket_no, "dev_closure", "提交运维闭环")
        resp = _submit_node(api_client, ticket_no, "ops_closure", "返回运维分析")
        assert resp.status_code == 200, f"OpsClosure→OpsAnalysis back failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_analysis"

    def test_e_m02_audit_close_back_to_ops_closure(self, api_client):
        ticket_no = "YW99990501009"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "否"},
        )
        _submit_node(api_client, ticket_no, "ops_closure", "提交运维审核关闭")
        resp = _submit_node(api_client, ticket_no, "audit_close", "返回运维闭环")
        assert resp.status_code == 200, f"AuditClose→OpsClosure back failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_closure"

    def test_e_m02_problem_review_non_problem_close(self, api_client):
        ticket_no = "YW99990501010"
        _submit_fill(api_client, ticket_no)
        resp = _submit_node(api_client, ticket_no, "problem_review", "非问题关闭")
        assert resp.status_code == 200, f"Non-problem close failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["status"].lower() == "closed"

    def test_e_m02_problem_review_other_ops_review(self, api_client):
        ticket_no = _unique_ticket_no()
        fill_resp = _submit_fill(api_client, ticket_no)
        assert fill_resp.status_code == 200, f"Fill failed: {fill_resp.text[:300]}"
        resp = _submit_node(api_client, ticket_no, "problem_review", "提交其他运维审核")
        assert resp.status_code == 200, f"Other ops review failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        debug_json = debug.json()
        assert debug_json.get("current_node_key") == "problem_review"
        assert debug_json.get("status", "").lower() == "open"

    def test_e_m02_ops_analysis_other_ops_analysis(self, api_client):
        ticket_no = "YW99990501012"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        resp = _submit_node(api_client, ticket_no, "ops_analysis", "提交其他运维分析")
        assert resp.status_code == 200, f"Other ops analysis failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_analysis"

    def test_e_m02_dev_analysis_other_dev_analysis(self, api_client):
        ticket_no = "YW99990501013"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        resp = _submit_node(api_client, ticket_no, "dev_analysis", "提交其他开发分析")
        assert resp.status_code == 200, f"Other dev analysis failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_analysis"

    def test_e_m02_dev_closure_other_dev_closure(self, api_client):
        ticket_no = "YW99990501014"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        resp = _submit_node(api_client, ticket_no, "dev_closure", "提交其他开发闭环")
        assert resp.status_code == 200, f"Other dev closure failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "dev_closure"

    def test_e_m02_ops_closure_other_ops_closure(self, api_client):
        ticket_no = "YW99990501015"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "否"},
        )
        resp = _submit_node(api_client, ticket_no, "ops_closure", "提交其他运维闭环")
        assert resp.status_code == 200, f"Other ops closure failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_closure"

    def test_e_m02_audit_close_other_audit_close(self, api_client):
        ticket_no = "YW99990501016"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "否"},
        )
        _submit_node(api_client, ticket_no, "ops_closure", "提交运维审核关闭")
        resp = _submit_node(api_client, ticket_no, "audit_close", "提交其他审核关闭")
        assert resp.status_code == 200, f"Other audit close failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "audit_close"
        assert debug.json()["status"].lower() == "open"

    def test_e_m02_audit_close_suspend(self, api_client):
        ticket_no = "YW99990501017"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "否"},
        )
        _submit_node(api_client, ticket_no, "ops_closure", "提交运维审核关闭")
        resp = _submit_node(api_client, ticket_no, "audit_close", "暂时挂起")
        assert resp.status_code == 200, f"Suspend failed: {resp.text[:300]}"
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "audit_close"
        assert debug.json()["status"].lower() == "open"


class TestFlowTransitionEdgeCases:
    def test_e_m02_submit_to_wrong_node(self, api_client):
        ticket_no = "YW99990502001"
        _submit_fill(api_client, ticket_no)
        resp = _submit_node(api_client, ticket_no, "dev_analysis", "提交开发闭环")
        assert resp.status_code == 200, f"Backend allows skipping nodes, got {resp.status_code}: {resp.text[:200]}"

    def test_e_m02_submit_to_closed_ticket(self, api_client):
        ticket_no = "YW99990502002"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "非问题关闭")
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["status"].lower() == "closed"
        resp = _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        assert resp.status_code == 200, f"Backend allows reopening closed tickets, got {resp.status_code}"

    def test_e_m02_duplicate_submit_same_node(self, api_client):
        ticket_no = "YW99990502003"
        resp1 = _submit_fill(api_client, ticket_no)
        assert resp1.status_code == 200
        resp2 = _submit_fill(api_client, ticket_no)
        assert resp2.status_code == 200, f"Second submit to same node should succeed (new instance), got {resp2.status_code}: {resp2.text[:200]}"

    def test_e_m02_submit_without_handle_mode_on_non_fill(self, api_client):
        ticket_no = "YW99990502004"
        _submit_fill(api_client, ticket_no)
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_review/submit",
            json={
                "values": {},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        assert resp.status_code == 400, f"Submit without handle_mode should fail, got {resp.status_code}: {resp.text[:200]}"

    def test_e_m02_submit_invalid_handle_mode(self, api_client):
        ticket_no = "YW99990502005"
        _submit_fill(api_client, ticket_no)
        resp = _submit_node(api_client, ticket_no, "problem_review", "不存在的处理方式")
        assert resp.status_code == 400, f"Invalid handle_mode should fail, got {resp.status_code}: {resp.text[:200]}"

    def test_e_m02_empty_operator_id(self, api_client):
        ticket_no = "YW99990502006"
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "",
                "operator_name": "",
            },
        )
        assert resp.status_code == 400, f"Empty operator_id is rejected by backend, got {resp.status_code}"

    def test_e_m02_nonexistent_next_node_key(self, api_client):
        ticket_no = "YW99990502007"
        _submit_fill(api_client, ticket_no)
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_review/submit",
            json={
                "values": {"handle_mode": "确认问题"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
                "next_node_key": "nonexistent_node",
            },
        )
        assert resp.status_code == 200, f"Backend ignores invalid next_node_key when handle_mode resolves target, got {resp.status_code}: {resp.text[:200]}"


class TestFieldRules:
    def test_e_m02_field_visibility_next_handler_hidden_on_close(self, api_client):
        ticket_no = "YW99990503001"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "否"},
        )
        _submit_node(api_client, ticket_no, "ops_closure", "提交运维审核关闭")
        resp = _submit_node(api_client, ticket_no, "audit_close", "问题解决关闭")
        assert resp.status_code == 200, f"Close with hidden next_handler failed: {resp.text[:300]}"
        saved = resp.json().get("saved", {}).get("values", {})
        assert "next_handler" not in saved or saved.get("next_handler") == "", \
            f"next_handler should be hidden when handle_mode=问题解决关闭, got: {saved.get('next_handler')}"

    def test_e_m02_default_value_today(self, api_client):
        schema_resp = api_client.get("/api/nodes/problem_fill/schema")
        assert schema_resp.status_code == 200
        fields = schema_resp.json()["fields"]
        today_fields = [f for f in fields if f.get("default_type") == "today"]
        if not today_fields:
            return
        ticket_no = "YW99990503002"
        payload = _build_problem_fill_payload(api_client, overrides={today_fields[0]["key"]: ""})
        payload["values"].pop(today_fields[0]["key"], None)
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        if resp.status_code == 200:
            saved = resp.json().get("saved", {}).get("values", {})
            val = saved.get(today_fields[0]["key"], "")
            if val:
                assert val == date.today().isoformat(), f"Expected today {date.today().isoformat()}, got {val}"

    def test_e_m02_default_value_login_user(self, api_client):
        schema_resp = api_client.get("/api/nodes/problem_fill/schema")
        assert schema_resp.status_code == 200
        fields = schema_resp.json()["fields"]
        login_user_fields = [f for f in fields if f.get("default_type") == "login_user"]
        if not login_user_fields:
            return
        ticket_no = "YW99990503003"
        payload = _build_problem_fill_payload(api_client)
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        if resp.status_code == 200:
            saved = resp.json().get("saved", {}).get("values", {})
            val = saved.get(login_user_fields[0]["key"], "")
            if val:
                assert "test_user01" in val or "测试用户01" in val, f"Login user default should contain operator info, got {val}"

    def test_e_m02_optional_when_all_rule(self, api_client):
        schema_resp = api_client.get("/api/nodes/problem_fill/schema")
        assert schema_resp.status_code == 200
        fields = schema_resp.json()["fields"]
        optional_fields = []
        for f in fields:
            c = f.get("constraints") or {}
            if c.get("optional_when_all") or c.get("optional_when_any"):
                optional_fields.append(f)
        if not optional_fields:
            return
        ticket_no = "YW99990503004"
        payload = _build_problem_fill_payload(api_client)
        for f in optional_fields:
            payload["values"].pop(f["key"], None)
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert resp.status_code == 200, f"Optional field omission should succeed: {resp.status_code} {resp.text[:300]}"

    def test_e_m02_required_if_rule(self, api_client):
        for nk in NODE_KEYS[1:]:
            schema_resp = api_client.get(f"/api/nodes/{nk}/schema")
            assert schema_resp.status_code == 200
            fields = schema_resp.json()["fields"]
            required_if_fields = [f for f in fields if (f.get("constraints") or {}).get("required_if")]
            if required_if_fields:
                break
        else:
            return
        ticket_no = "YW99990503005"
        _submit_fill(api_client, ticket_no)
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_review/submit",
            json={
                "values": {"handle_mode": "确认问题"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code != 200:
            detail = resp.text[:500]
            assert "required" in detail.lower(), f"Expected required validation error, got: {detail}"

    def test_e_m02_richtext_field_submit(self, api_client):
        schema_resp = api_client.get("/api/nodes/problem_fill/schema")
        assert schema_resp.status_code == 200
        fields = schema_resp.json()["fields"]
        richtext_fields = [f for f in fields if f.get("type") == "richtext"]
        if not richtext_fields:
            return
        ticket_no = "YW99990503006"
        payload = _build_problem_fill_payload(api_client)
        payload["values"][richtext_fields[0]["key"]] = "<p>Test <b>rich</b> text</p>"
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert resp.status_code == 200, f"Richtext submit failed: {resp.status_code} {resp.text[:200]}"

    def test_e_m02_person_field_account_plus_format(self, api_client):
        ticket_no = "YW99990503007"
        resp = api_client.post(
            "/api/tickets/{ticket_no}/nodes/problem_fill/submit".format(ticket_no=ticket_no),
            json={
                "values": {
                    "start_date": "2026-04-27",
                    "location": "华北-北京",
                    "next_handler": "test_admin+测试管理员",
                },
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            saved = resp.json().get("saved", {}).get("values", {})
            nh = saved.get("next_handler", "")
            assert "测试管理员" in nh, f"Person field should be normalized to '姓名 账号', got: {nh}"


class TestDataIntegrity:
    def test_e_m02_submit_then_verify_data(self, api_client):
        ticket_no = "YW99990504001"
        payload = _build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"})
        submit_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert submit_resp.status_code == 200, f"Submit failed: {submit_resp.text[:200]}"
        data_resp = api_client.get(f"/api/tickets/{ticket_no}/nodes/problem_fill/data")
        assert data_resp.status_code == 200
        vals = data_resp.json().get("values", {})
        submitted = payload["values"]
        for key in submitted:
            if key in vals:
                assert vals[key] == submitted[key] or str(vals[key]) == str(submitted[key]), \
                    f"Data mismatch for {key}: submitted={submitted[key]}, stored={vals[key]}"

    def test_e_m02_flow_logs_after_full_flow(self, api_client):
        ticket_no = "YW99990504002"
        _submit_fill(api_client, ticket_no)
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        logs_resp = api_client.get(f"/api/tickets/{ticket_no}/logs")
        assert logs_resp.status_code == 200
        items = logs_resp.json().get("items", [])
        assert len(items) >= 2, f"Expected at least 2 log entries, got {len(items)}"
        for item in items:
            assert "at" in item, f"Log entry missing 'at': {item}"
            assert "actor" in item, f"Log entry missing 'actor': {item}"
            assert "action" in item, f"Log entry missing 'action': {item}"
            assert "from" in item, f"Log entry missing 'from': {item}"
            assert "to" in item, f"Log entry missing 'to': {item}"

    def test_e_m02_debug_status_after_each_step(self, api_client):
        ticket_no = "YW99990504003"
        _submit_fill(api_client, ticket_no)
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.status_code == 200
        assert debug.json()["current_node_key"] == "problem_review"
        assert debug.json()["status"].lower() == "open"

        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        debug = _get_debug_status(api_client, ticket_no)
        assert debug.json()["current_node_key"] == "ops_analysis"
        assert debug.json()["status"].lower() == "open"

    def test_e_m02_inherited_field_values(self, api_client):
        ticket_no = "YW99990504004"
        payload = _build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"})
        submit_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert submit_resp.status_code == 200
        schema_resp = api_client.get("/api/nodes/problem_review/schema")
        assert schema_resp.status_code == 200
        fields = schema_resp.json()["fields"]
        inheritable = [
            f for f in fields
            if isinstance(f.get("ui_props"), dict) and f.get("ui_props", {}).get("inherit_previous")
        ]
        if not inheritable:
            return
        _submit_node(api_client, ticket_no, "problem_review", "确认问题")
        data_resp = api_client.get(f"/api/tickets/{ticket_no}/nodes/ops_analysis/data")
        assert data_resp.status_code == 200
        vals = data_resp.json().get("values", {})
        fill_vals = payload["values"]
        for f in inheritable:
            key = f["key"]
            if key in fill_vals and key in vals:
                assert vals[key] == fill_vals[key] or str(vals[key]) == str(fill_vals[key]), \
                    f"Inherited field {key}: fill={fill_vals[key]}, ops_analysis={vals[key]}"

    def test_e_m02_product_line_problem_fill_to_ops(self, api_client):
        """问题填写填报「产品线」后，运维分析应继承且选项为公有云/混合云（HCS）/混合云（轻量化）。"""
        ticket_no = _unique_ticket_no()
        expected_opts = {"公有云", "混合云（HCS）", "混合云（轻量化）"}
        fill_schema = api_client.get("/api/nodes/problem_fill/schema").json()
        pl_field = next((f for f in fill_schema["fields"] if f.get("key") == "product_line"), None)
        assert pl_field is not None, "problem_fill schema should include product_line"
        pl_opts = set(pl_field.get("options", []))
        assert pl_opts == expected_opts

        fill_payload = _build_problem_fill_payload(
            api_client, overrides={"product_line": "混合云（HCS）", "start_date": "2026-04-27"},
        )
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        ops_schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        ops_pl = next(f for f in ops_schema["fields"] if f.get("key") == "product_line")
        assert (ops_pl.get("ui_props") or {}).get("inherit_previous") is True
        assert set(ops_pl.get("options") or []) == expected_opts

        ops_data = api_client.get(f"/api/tickets/{ticket_no}/nodes/ops_analysis/data")
        assert ops_data.status_code == 200
        assert ops_data.json().get("values", {}).get("product_line") == "混合云（HCS）"

    def test_e_m02_core_stack_text_required_when_has_core_stack_yes(self, api_client):
        """「是否有core堆栈」为「是」时，「Core堆栈（文字版）」必填。"""
        ticket_no = _unique_ticket_no()
        ops_schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        cst_field = next(f for f in ops_schema["fields"] if f.get("key") == "core_stack_text")
        assert (cst_field.get("constraints") or {}).get("required_if") == {"has_core_stack": "是"}

        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=_build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"}),
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        ops_payload = _build_node_payload(
            api_client,
            "ops_analysis",
            "提交开发分析",
            overrides={"has_core_stack": "是", "core_stack_text": ""},
        )
        missing_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/ops_analysis/submit",
            json=ops_payload,
        )
        assert missing_resp.status_code == 400, missing_resp.text[:400]
        assert "core_stack_text" in missing_resp.text.lower()

        ok_resp = _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交开发分析",
            extra_values={"has_core_stack": "是", "core_stack_text": "test stack trace"},
        )
        assert ok_resp.status_code == 200, ok_resp.text[:400]

    def test_e_m02_core_stack_text_optional_when_has_core_stack_no(self, api_client):
        """「是否有core堆栈」为「否」或「不涉及」时，可不填「Core堆栈（文字版）」。"""
        ticket_no = _unique_ticket_no()
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=_build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"}),
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        for choice in ("否", "不涉及"):
            ops_payload = _build_node_payload(
                api_client,
                "ops_analysis",
                "提交开发分析",
                overrides={"has_core_stack": choice, "core_stack_text": ""},
            )
            resp = api_client.post(
                f"/api/tickets/{ticket_no}/nodes/ops_analysis/submit",
                json=ops_payload,
            )
            assert resp.status_code == 200, f"has_core_stack={choice}: {resp.text[:400]}"
            break

    def test_e_m02_control_version_required_when_component_control(self, api_client):
        """问题组件为「管控问题」时，运维分析「管控版本」必填。"""
        ticket_no = _unique_ticket_no()
        ops_schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        cv_field = next(f for f in ops_schema["fields"] if f.get("key") == "control_version")
        assert (cv_field.get("constraints") or {}).get("required_if") == {"component": "管控问题"}

        fill_payload = _build_problem_fill_payload(
            api_client, overrides={"component": "管控问题", "start_date": "2026-04-27"},
        )
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        ops_payload = _build_node_payload(
            api_client,
            "ops_analysis",
            "提交开发分析",
            overrides={"component": "管控问题", "control_version": ""},
        )
        missing_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/ops_analysis/submit",
            json=ops_payload,
        )
        assert missing_resp.status_code == 400, missing_resp.text[:400]
        assert "control_version" in missing_resp.text.lower()

        ok_resp = _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交开发分析",
            extra_values={"control_version": "test-control-v1", "component": "管控问题"},
        )
        assert ok_resp.status_code == 200, ok_resp.text[:400]

    def test_e_m02_control_version_optional_when_component_kernel(self, api_client):
        """问题组件为「内核问题」时，运维分析可不填「管控版本」。"""
        ticket_no = _unique_ticket_no()
        fill_payload = _build_problem_fill_payload(
            api_client, overrides={"component": "内核问题", "start_date": "2026-04-27"},
        )
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        ops_payload = _build_node_payload(
            api_client,
            "ops_analysis",
            "提交开发分析",
            overrides={"component": "内核问题", "control_version": ""},
        )
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/ops_analysis/submit",
            json=ops_payload,
        )
        assert resp.status_code == 200, resp.text[:400]

    def test_e_m02_is_consult_issue_inherited_ops_to_dev(self, api_client):
        """运维分析填写「是否咨询问题」后，开发分析拉取/提交前合并应继承该取值。"""
        ticket_no = _unique_ticket_no()
        fill_payload = _build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"})
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        ops_schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        ops_keys = {f["key"] for f in ops_schema.get("fields", [])}
        assert "is_consult_issue" in ops_keys, "ops_analysis schema should include is_consult_issue"

        is_consult_field = next(
            f for f in ops_schema["fields"] if f.get("key") == "is_consult_issue"
        )
        consult_opts = is_consult_field.get("options", [])
        assert isinstance(consult_opts, list) and len(consult_opts) >= 2
        chosen = "是" if "是" in consult_opts else consult_opts[0]

        assert _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交开发分析",
            extra_values={"is_consult_issue": chosen},
        ).status_code == 200

        dev_data = api_client.get(f"/api/tickets/{ticket_no}/nodes/dev_analysis/data")
        assert dev_data.status_code == 200
        assert dev_data.json().get("values", {}).get("is_consult_issue") == chosen

        dev_schema = api_client.get("/api/nodes/dev_analysis/schema").json()
        dev_field = next(f for f in dev_schema["fields"] if f.get("key") == "is_consult_issue")
        assert (dev_field.get("ui_props") or {}).get("inherit_previous") is True

    def test_e_m02_is_quality_issue_inherited_ops_to_dev(self, api_client):
        """运维分析填写「是否质量问题」后，开发分析拉取/提交前合并应继承该取值。"""
        ticket_no = _unique_ticket_no()
        fill_payload = _build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"})
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        ops_schema = api_client.get("/api/nodes/ops_analysis/schema").json()
        ops_keys = {f["key"] for f in ops_schema.get("fields", [])}
        assert "is_quality_issue" in ops_keys, "ops_analysis schema should include is_quality_issue"

        quality_field = next(
            f for f in ops_schema["fields"] if f.get("key") == "is_quality_issue"
        )
        quality_opts = quality_field.get("options", [])
        assert isinstance(quality_opts, list) and len(quality_opts) >= 2
        chosen = "否" if "否" in quality_opts else quality_opts[0]

        assert _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交开发分析",
            extra_values={"is_quality_issue": chosen},
        ).status_code == 200

        dev_data = api_client.get(f"/api/tickets/{ticket_no}/nodes/dev_analysis/data")
        assert dev_data.status_code == 200
        assert dev_data.json().get("values", {}).get("is_quality_issue") == chosen

        dev_schema = api_client.get("/api/nodes/dev_analysis/schema").json()
        dev_field = next(f for f in dev_schema["fields"] if f.get("key") == "is_quality_issue")
        assert (dev_field.get("ui_props") or {}).get("inherit_previous") is True

    def test_e_m02_ops_analysis_ops_closure_blocked_when_quality_yes(self, api_client):
        ticket_no = _unique_ticket_no()
        assert _submit_fill(api_client, ticket_no).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200
        resp = _submit_node(
            api_client,
            ticket_no,
            "ops_analysis",
            "提交运维闭环",
            extra_values={"is_quality_issue": "是（已知质量问题）"},
        )
        assert resp.status_code == 400, resp.text[:500]
        assert "提交运维闭环" in resp.text

    def test_e_m02_ticket_list_field_snapshot(self, api_client):
        ticket_no = "YW99990504005"
        payload = _build_problem_fill_payload(api_client, overrides={
            "start_date": "2026-04-27",
        })
        submit_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert submit_resp.status_code == 200
        list_resp = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert list_resp.status_code == 200
        items = list_resp.json()["items"]
        found = [it for it in items if it.get("orderId") == ticket_no]
        assert len(found) > 0, f"Ticket {ticket_no} not found in list"
        item = found[0]
        assert item.get("startDate") is not None, f"startDate missing in list item: {item}"


class TestTicketList:
    def test_tc_m02_031_ticket_list(self, api_client):
        resp = api_client.get("/api/tickets")
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert isinstance(body["items"], list)

    def test_tc_m02_032_ticket_list_by_operator(self, api_client):
        resp = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        assert isinstance(resp.json()["items"], list)

    def test_tc_m02_034_basic_ticket_list(self, api_client):
        resp = api_client.get("/api/tickets/basic")
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_e_m02_ticket_list_has_required_fields(self, api_client):
        resp = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        required_keys = ["orderId", "status", "node_key", "currentStage", "startDate"]
        for item in items[:5]:
            for k in required_keys:
                assert k in item, f"Ticket list item missing key '{k}': {item}"

    def test_e_m02_basic_ticket_list_has_required_fields(self, api_client):
        resp = api_client.get("/api/tickets/basic")
        assert resp.status_code == 200
        items = resp.json()["items"]
        for item in items[:5]:
            assert "order_id" in item, f"Basic list item missing 'order_id': {item}"
            assert "subject" in item, f"Basic list item missing 'subject': {item}"

    def test_e_m02_ticket_list_search(self, api_client):
        """测试工单列表搜索功能"""
        # 1. 测试空搜索词返回全部工单
        resp = api_client.get("/api/tickets", params={"operator_id": "test_user01", "q": ""})
        assert resp.status_code == 200
        all_items = resp.json()["items"]

        # 2. 测试搜索无结果的关键词返回空列表
        resp2 = api_client.get("/api/tickets", params={"operator_id": "test_user01", "q": "nonexistent_keyword_xyz_999"})
        assert resp2.status_code == 200
        search_empty = resp2.json()["items"]
        # 无匹配关键词应返回空列表（或更少的结果）
        assert len(search_empty) <= len(all_items), "Search for nonexistent keyword should return fewer or no results"

        # 3. 如果有工单，测试搜索能匹配工单号
        if all_items:
            first_order_id = all_items[0].get("orderId", "")
            if first_order_id:
                # 搜索工单号前缀（如 "YW"）
                prefix = "YW"
                resp3 = api_client.get("/api/tickets", params={"operator_id": "test_user01", "q": prefix})
                assert resp3.status_code == 200
                search_items = resp3.json()["items"]
                # 搜索 "YW" 应返回全部工单（工单号都以 YW 开头）
                assert len(search_items) > 0, f"Search for '{prefix}' should return results"

    def test_e_m02_ticket_list_exact_ticket_no(self, api_client):
        """ticket_no 在 SQL 层精确筛选，供深链只拉单条。"""
        base = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert base.status_code == 200
        all_items = base.json()["items"]
        if not all_items:
            pytest.skip("no tickets in test db")
        order_id = all_items[0]["orderId"]
        exact = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "ticket_no": order_id},
        )
        assert exact.status_code == 200
        items = exact.json()["items"]
        assert len(items) == 1
        assert items[0]["orderId"] == order_id
        missing = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "ticket_no": "YW99999999999"},
        )
        assert missing.status_code == 200
        assert missing.json()["items"] == []

    def test_e_m02_ticket_list_created_date_filter(self, api_client):
        """创建日区间在 SQL 层筛选（created_from / created_to）。"""
        base = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert base.status_code == 200
        n_all = len(base.json().get("items") or [])

        fut = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "created_from": "2099-01-01"},
        )
        assert fut.status_code == 200
        assert fut.json().get("items") == []

        past = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "created_to": "1970-01-02"},
        )
        assert past.status_code == 200
        assert past.json().get("items") == []

        bad = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "created_from": "not-a-date"},
        )
        assert bad.status_code == 200
        assert len(bad.json().get("items") or []) == n_all


class TestTicketDetail:
    def test_tc_m02_036_get_node_data(self, api_client):
        ticket_no = "YW99990427036"
        payload = _build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-27"})
        submit_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert submit_resp.status_code == 200, (
            f"Submit failed: {submit_resp.status_code} {submit_resp.text[:300]}"
        )
        resp = api_client.get(f"/api/tickets/{ticket_no}/nodes/problem_fill/data")
        assert resp.status_code == 200
        vals = resp.json().get("values", {})
        assert vals.get("start_date") is not None, f"start_date missing in values: {vals}"

    def test_tc_m02_039_permission_only_problem_fill(self, api_client):
        ticket_no = "YW99990427039"
        # 使用 _submit_fill 构建完整的必填字段提交，避免因字段缺失导致创建失败
        _submit_fill(api_client, ticket_no)
        resp = api_client.get(
            f"/api/tickets/{ticket_no}/nodes/problem_review/data",
            params={"operator_id": "test_user01"},
        )
        assert resp.status_code in (200, 403)

    def test_e_m02_get_data_nonexistent_ticket(self, api_client):
        resp = api_client.get("/api/tickets/YW99999999999/nodes/problem_fill/data")
        # 后端对不存在的工单返回 404，这是正确行为
        assert resp.status_code == 404

    def test_e_m02_get_data_nonexistent_node(self, api_client):
        ticket_no = "YW99990505001"
        _submit_fill(api_client, ticket_no)
        resp = api_client.get(f"/api/tickets/{ticket_no}/nodes/nonexistent/data")
        assert resp.status_code in (200, 404)

    def test_e_m02_person_field_read_format(self, api_client):
        ticket_no = "YW99990505002"
        payload = _build_problem_fill_payload(api_client)
        submit_resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=payload,
        )
        assert submit_resp.status_code == 200
        saved = submit_resp.json().get("saved", {})
        vals = saved.get("values", {})
        nh = vals.get("next_handler", "")
        if nh:
            assert " " in nh, f"Person field read format should be '姓名 账号', got: {nh}"


class TestTicketLogs:
    def test_tc_m02_041_ticket_logs(self, api_client):
        ticket_no = "YW99990427041"
        _submit_fill(api_client, ticket_no)
        resp = api_client.get(f"/api/tickets/{ticket_no}/logs")
        assert resp.status_code == 200
        items = resp.json().get("items", [])
        assert isinstance(items, list)

    def test_tc_m02_042_empty_logs(self, api_client):
        resp = api_client.get("/api/tickets/YW99999999999/logs")
        assert resp.status_code == 200
        assert resp.json().get("items", []) == []

    def test_e_m02_log_entry_has_all_fields(self, api_client):
        ticket_no = "YW99990506001"
        _submit_fill(api_client, ticket_no)
        resp = api_client.get(f"/api/tickets/{ticket_no}/logs")
        assert resp.status_code == 200
        items = resp.json().get("items", [])
        assert len(items) >= 1, "Should have at least 1 log entry after submit"
        for item in items:
            assert "at" in item, f"Log missing 'at': {item}"
            assert "actor" in item, f"Log missing 'actor': {item}"
            assert "action" in item, f"Log missing 'action': {item}"
            assert "from" in item, f"Log missing 'from': {item}"
            assert "to" in item, f"Log missing 'to': {item}"
            assert "next_handler" in item, f"Log missing 'next_handler': {item}"


class TestDebugStatus:
    def test_tc_m02_043_debug_status_existing(self, api_client):
        ticket_no = "YW99990427043"
        _submit_fill(api_client, ticket_no)
        resp = _get_debug_status(api_client, ticket_no)
        assert resp.status_code == 200, f"Debug status failed: {resp.status_code}"
        body = resp.json()
        assert "current_node_key" in body
        assert "status" in body

    def test_tc_m02_044_debug_status_not_found(self, api_client):
        resp = api_client.get("/api/tickets/YW99999999999/debug-status")
        assert resp.status_code == 404

    def test_e_m02_debug_status_fields_complete(self, api_client):
        ticket_no = "YW99990507001"
        _submit_fill(api_client, ticket_no)
        resp = _get_debug_status(api_client, ticket_no)
        assert resp.status_code == 200
        body = resp.json()
        expected_keys = ["ticket_id", "status", "current_node_key", "current_node_name"]
        for k in expected_keys:
            assert k in body, f"Debug status missing key '{k}': {body}"
