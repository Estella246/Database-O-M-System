"""工单服务端导出 API。"""
from __future__ import annotations

import csv
import io

import pytest

from ticket_export import build_export_columns, _format_cell_value
from ticket_export_fields import MAX_EXPORT_TICKETS
from test_m02_ticket import _build_problem_fill_payload, _submit_node, _unique_ticket_no


class TestTicketExport:
    def test_build_export_columns_requires_fields(self):
        cols = build_export_columns({"problem_fill": ["start_date", "location"]})
        assert len(cols) == 2
        labels = {c["fullLabel"] for c in cols}
        assert "问题填写-起始日期" in labels
        assert "问题填写-局点" in labels

    def test_build_export_columns_issue_type_judge_label(self):
        cols = build_export_columns({"problem_review": ["issue_type_judge"]})
        assert len(cols) == 1
        assert cols[0]["label"] == "专项轮值表"
        assert cols[0]["fullLabel"] == "问题审核-专项轮值表"

    def test_export_file_selected_requires_ticket_nos(self, api_client):
        resp = api_client.post(
            "/api/tickets/export-file",
            json={
                "operator_id": "test_user01",
                "format": "xlsx",
                "range": "selected",
                "ticket_nos": [],
                "selected_fields": {"problem_fill": ["start_date"]},
            },
        )
        if resp.status_code == 405:
            pytest.skip("后端未加载 export-file 路由，请重启 uvicorn 后重试")
        assert resp.status_code == 400

    def test_export_file_selected_xlsx(self, api_client):
        list_resp = api_client.get(
            "/api/tickets",
            params={
                "operator_id": "test_user01",
                "template_code": "HCS_INCIDENT",
                "page": 1,
                "page_size": 1,
                "tab": "all",
            },
        )
        assert list_resp.status_code == 200
        items = list_resp.json().get("items") or []
        if not items:
            pytest.skip("no hcs tickets")
        ticket_no = items[0]["orderId"]
        resp = api_client.post(
            "/api/tickets/export-file",
            json={
                "operator_id": "test_user01",
                "format": "xlsx",
                "range": "selected",
                "ticket_nos": [ticket_no],
                "selected_fields": {
                    "system": ["processId", "currentStage"],
                    "problem_fill": ["start_date", "location"],
                },
                "filename_prefix": "test_export",
            },
        )
        if resp.status_code == 405:
            pytest.skip("后端未加载 export-file 路由，请重启 uvicorn 后重试")
        assert resp.status_code == 200, resp.text[:300]
        assert "spreadsheetml" in resp.headers.get("content-type", "")
        assert len(resp.content) > 100

    def test_export_file_all_list_query(self, api_client):
        resp = api_client.post(
            "/api/tickets/export-file",
            json={
                "operator_id": "test_user01",
                "format": "csv",
                "range": "all",
                "list_query": {"tab": "all", "q": "", "column_filters": {}},
                "selected_fields": {"system": ["processId"]},
                "filename_prefix": "test_export_all",
            },
        )
        if resp.status_code == 405:
            pytest.skip("后端未加载 export-file 路由，请重启 uvicorn 后重试")
        if resp.status_code == 503:
            pytest.skip("snapshot table unavailable")
        assert resp.status_code == 200, resp.text[:300]
        assert "text/csv" in resp.headers.get("content-type", "")
        body = resp.content.decode("utf-8-sig")
        assert "系统字段-流程ID" in body.splitlines()[0]

    def test_export_file_max_limit_guard(self):
        assert MAX_EXPORT_TICKETS == 50_000

    def test_export_data_includes_inherited_ops_analysis_fields(self, api_client):
        """问题填写的产品线经继承后，运维分析导出列应非空（与详情页一致）。"""
        ticket_no = _unique_ticket_no()
        product_line = "混合云（HCS）"
        fill_payload = _build_problem_fill_payload(
            api_client, overrides={"product_line": product_line, "start_date": "2026-04-27"}
        )
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        data_resp = api_client.post(
            "/api/tickets/export-data",
            json={"ticket_nos": [ticket_no], "operator_id": "test_user01"},
        )
        assert data_resp.status_code == 200, data_resp.text[:300]
        items = data_resp.json().get("items") or []
        assert len(items) == 1
        ops_vals = (items[0].get("nodes") or {}).get("ops_analysis") or {}
        assert ops_vals.get("product_line") == product_line

    def test_export_file_includes_inherited_ops_analysis_fields(self, api_client):
        ticket_no = _unique_ticket_no()
        product_line = "混合云（HCS）"
        fill_payload = _build_problem_fill_payload(
            api_client, overrides={"product_line": product_line, "start_date": "2026-04-27"}
        )
        assert api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        ).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200

        resp = api_client.post(
            "/api/tickets/export-file",
            json={
                "operator_id": "test_user01",
                "format": "csv",
                "range": "selected",
                "ticket_nos": [ticket_no],
                "selected_fields": {"ops_analysis": ["product_line"]},
                "filename_prefix": "test_inherited_export",
            },
        )
        if resp.status_code == 405:
            pytest.skip("后端未加载 export-file 路由，请重启 uvicorn 后重试")
        assert resp.status_code == 200, resp.text[:300]
        body = resp.content.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(body)))
        assert rows[0] == ["运维分析-产品线"]
        assert rows[1] == [product_line]

    def test_export_richtext_strips_html_to_plain_text(self):
        col = {"stripImages": True, "type": "richtext"}
        html = (
            '<p><span style="font-family: SimSun; font-size: 14px;">'
            "数据库</span> <b>hang</b></p>"
            '<img src="data:image/png;base64,xxx">'
        )
        plain = _format_cell_value(html, col)
        assert "<" not in plain
        assert "font-family" not in plain
        assert "数据库 hang" == plain
