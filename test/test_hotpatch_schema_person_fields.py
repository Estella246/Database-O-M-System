"""热补丁诉求填写：运维人员、开发责任人为文本字段（迁移 0037），可填「姓名+工号」等。"""

import pytest


def test_hotpatch_demand_fill_ops_and_dev_owner_fields_are_text(api_client):
    r = api_client.get("/api/nodes/hp_demand_fill/schema", params={"template_code": "HOTPATCH"})
    if r.status_code == 404:
        pytest.skip("HOTPATCH 流程未部署或库中无该节点 schema")
    assert r.status_code == 200, r.text
    by_key = {f["key"]: f for f in r.json().get("fields", [])}
    for key in ("运维人员", "开发责任人"):
        assert key in by_key, f"missing field {key}"
        assert by_key[key]["type"] == "text", f"{key} expected text, got {by_key[key]!r}"
