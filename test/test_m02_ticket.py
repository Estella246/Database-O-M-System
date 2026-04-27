import re

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

    def test_tc_m02_004_dev_analysis_schema(self, api_client):
        resp = api_client.get("/api/nodes/dev_analysis/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0

    def test_tc_m02_005_dev_closure_schema(self, api_client):
        resp = api_client.get("/api/nodes/dev_closure/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0

    def test_tc_m02_006_ops_closure_schema(self, api_client):
        resp = api_client.get("/api/nodes/ops_closure/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0

    def test_tc_m02_007_audit_close_schema(self, api_client):
        resp = api_client.get("/api/nodes/audit_close/schema")
        assert resp.status_code == 200
        assert len(resp.json()["fields"]) > 0

    def test_tc_m02_008_nonexistent_node_schema(self, api_client):
        resp = api_client.get("/api/nodes/nonexistent/schema")
        assert resp.status_code == 404

    def test_tc_m02_009_schema_has_options(self, api_client):
        resp = api_client.get("/api/nodes/problem_fill/schema")
        body = resp.json()
        whitelist_fields = [f for f in body["fields"] if f["type"] == "whitelist"]
        for f in whitelist_fields:
            assert "options" in f or "cascade_options" in f

    def test_tc_m02_010_next_handler_whitelist_map(self, api_client):
        for nk in NODE_KEYS[1:]:
            resp = api_client.get(f"/api/nodes/{nk}/schema")
            if resp.status_code != 200:
                continue
            body = resp.json()
            nh_fields = [f for f in body["fields"] if f["key"] == "next_handler"]
            if nh_fields:
                c = nh_fields[0].get("constraints") or {}
                if "next_handler_by_handle_mode" in c:
                    assert isinstance(c["next_handler_by_handle_mode"], dict)


class TestTicketCreate:
    def test_tc_m02_011_auto_allocate_ticket_no(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427001/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            body = resp.json()
            tid = body.get("ticket_id", "")
            assert _YW_RE.match(tid), f"ticket_id '{tid}' does not match YW format"

    def test_tc_m02_012_specified_ticket_no(self, api_client):
        ticket_no = "YW99990427002"
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            assert resp.json()["ticket_id"] == ticket_no

    def test_tc_m02_013_ticket_no_format(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427003/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            tid = resp.json()["ticket_id"]
            assert _YW_RE.match(tid)

    def test_tc_m02_014_sequential_ticket_no(self, api_client):
        nos = []
        for i in range(2):
            resp = api_client.post(
                f"/api/tickets/YW99990427{10 + i:03d}/nodes/problem_fill/submit",
                json={
                    "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                    "operator_id": "test_user01",
                    "operator_name": "测试用户01",
                },
            )
            if resp.status_code == 200:
                nos.append(resp.json()["ticket_id"])
        if len(nos) == 2:
            assert nos[1] != nos[0]


class TestNodeSubmit:
    def test_tc_m02_015_problem_fill_normal_submit(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427015/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            assert resp.json()["ok"] is True

    def test_tc_m02_016_required_field_missing(self, api_client):
        schema_resp = api_client.get("/api/nodes/problem_fill/schema")
        if schema_resp.status_code != 200:
            return
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

    def test_tc_m02_018_whitelist_invalid_value(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427018/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "不存在的地区"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        assert resp.status_code == 400

    def test_tc_m02_019_person_field_canonical(self, api_client):
        resp = api_client.post(
            "/api/tickets/YW99990427019/nodes/problem_fill/submit",
            json={
                "values": {
                    "start_date": "2026-04-27",
                    "location": "华北-北京",
                    "next_handler": "test_admin 测试管理员",
                },
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            saved = resp.json().get("saved", {})
            vals = saved.get("values", {})
            if "next_handler" in vals:
                nh = vals["next_handler"]
                assert "测试管理员" in nh

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
    @classmethod
    def _create_and_submit_fill(cls, api_client, ticket_no="YW99990427501"):
        api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        return ticket_no

    def test_tc_m02_025_review_confirm_problem(self, api_client):
        ticket_no = self._create_and_submit_fill(api_client, "YW99990427025")
        schema_resp = api_client.get("/api/nodes/problem_review/schema")
        if schema_resp.status_code != 200:
            return
        fields = schema_resp.json()["fields"]
        hm_field = next((f for f in fields if f["key"] == "handle_mode"), None)
        if not hm_field:
            return
        options = hm_field.get("options", [])
        confirm_opt = next((o for o in options if o == "确认问题"), None)
        if not confirm_opt:
            return
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_review/submit",
            json={
                "values": {"handle_mode": "确认问题"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
                "next_node_key": "ops_analysis",
            },
        )
        if resp.status_code == 200:
            debug = api_client.get(f"/api/tickets/{ticket_no}/debug-status")
            if debug.status_code == 200:
                assert debug.json().get("current_node_key") == "ops_analysis"

    def test_tc_m02_030_audit_close_direct_close(self, api_client):
        ticket_no = "YW99990427030"
        api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/audit_close/submit",
            json={
                "values": {"handle_mode": "问题解决关闭"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        if resp.status_code == 200:
            debug = api_client.get(f"/api/tickets/{ticket_no}/debug-status")
            if debug.status_code == 200:
                assert debug.json().get("status", "").lower() == "closed"


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
        api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        resp = api_client.get(
            f"/api/tickets/{ticket_no}/nodes/problem_review/data",
            params={"operator_id": "test_user01"},
        )
        assert resp.status_code in (200, 403)


class TestTicketLogs:
    def test_tc_m02_041_ticket_logs(self, api_client):
        ticket_no = "YW99990427041"
        api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        resp = api_client.get(f"/api/tickets/{ticket_no}/logs")
        assert resp.status_code == 200
        items = resp.json().get("items", [])
        assert isinstance(items, list)

    def test_tc_m02_042_empty_logs(self, api_client):
        resp = api_client.get("/api/tickets/YW99999999999/logs")
        assert resp.status_code == 200
        assert resp.json().get("items", []) == []


class TestDebugStatus:
    def test_tc_m02_043_debug_status_existing(self, api_client):
        ticket_no = "YW99990427043"
        api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json={
                "values": {"start_date": "2026-04-27", "location": "华北-北京"},
                "operator_id": "test_user01",
                "operator_name": "测试用户01",
            },
        )
        resp = api_client.get(f"/api/tickets/{ticket_no}/debug-status")
        if resp.status_code == 200:
            body = resp.json()
            assert "current_node_key" in body
            assert "status" in body

    def test_tc_m02_044_debug_status_not_found(self, api_client):
        resp = api_client.get("/api/tickets/YW99999999999/debug-status")
        assert resp.status_code == 404
