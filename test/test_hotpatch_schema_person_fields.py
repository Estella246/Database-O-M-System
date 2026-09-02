"""热补丁诉求填写：运维人员、开发责任人为文本字段（迁移 0037），可填「姓名+工号」等。"""

import pytest


def test_hotpatch_demand_fill_ops_and_dev_owner_fields_are_text(api_client):
    r = api_client.get("/api/nodes/hp_demand_fill/schema", params={"template_code": "HOTPATCH"})
    if r.status_code == 404:
        pytest.skip("HOTPATCH 流程未部署或库中无该节点 schema")
    assert r.status_code == 200, r.text
    fields = r.json().get("fields", [])
    by_key = {f["key"]: f for f in fields}
    for key in ("运维人员", "开发责任人"):
        assert key in by_key, f"missing field {key}"
        assert by_key[key]["type"] == "text", f"{key} expected text, got {by_key[key]!r}"


def test_hotpatch_demand_fill_site_attach_is_file_field(api_client):
    r = api_client.get("/api/nodes/hp_demand_fill/schema", params={"template_code": "HOTPATCH"})
    if r.status_code == 404:
        pytest.skip("HOTPATCH 流程未部署或库中无该节点 schema")
    assert r.status_code == 200, r.text
    fields = {f["key"]: f for f in r.json().get("fields", [])}
    attach = fields.get("局点信息附件")
    assert attach is not None, "hp_demand_fill schema missing 局点信息附件"
    assert attach["type"] == "file", f"局点信息附件 expected file, got {attach!r}"
    assert attach.get("label") == "局点信息附件"
    assert attach.get("required") is True


def test_hotpatch_demand_fill_has_flow_fields_at_top(api_client):
    r = api_client.get("/api/nodes/hp_demand_fill/schema", params={"template_code": "HOTPATCH"})
    if r.status_code == 404:
        pytest.skip("HOTPATCH 流程未部署或库中无该节点 schema")
    assert r.status_code == 200, r.text
    fields = r.json().get("fields", [])
    keys = [f["key"] for f in fields]
    assert keys[:2] == ["handle_mode", "next_handler"], f"expected flow fields first, got {keys[:4]}"
    hm = next(f for f in fields if f["key"] == "handle_mode")
    assert "提交开发人员" in (hm.get("options") or [])
