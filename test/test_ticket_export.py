"""工单服务端导出 API。"""
from __future__ import annotations

import pytest

from ticket_export import build_export_columns
from ticket_export_fields import MAX_EXPORT_TICKETS


class TestTicketExport:
    def test_build_export_columns_requires_fields(self):
        cols = build_export_columns({"problem_fill": ["start_date", "location"]})
        assert len(cols) == 2
        labels = {c["fullLabel"] for c in cols}
        assert "问题填写-起始日期" in labels
        assert "问题填写-局点" in labels

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
