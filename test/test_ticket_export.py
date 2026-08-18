"""工单服务端导出 API。"""
from __future__ import annotations

import csv
import io

import pytest

from ticket_export import (
    build_export_columns,
    enrich_export_nodes_with_snapshot_inheritance,
    _csv_bytes_stream,
    _format_cell_value,
    _file_chunk_iterator,
    _remove_temp_file,
)
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

    def test_snapshot_inheritance_fills_ops_analysis_from_problem_fill(self):
        """快照路径：运维分析空 inherit 字段从问题填写内存回填。"""
        nodes = {
            "problem_fill": {"product_line": "混合云（HCS）", "location": "局点A"},
            "ops_analysis": {"location": ""},
        }
        schema_cache = {
            "ops_analysis": [
                {"key": "product_line", "ui_props": {"inherit_previous": True}},
                {"key": "location", "ui_props": {"inherit_previous": True}},
                {"key": "issue_type", "ui_props": {}},
            ]
        }
        enrich_export_nodes_with_snapshot_inheritance(
            nodes, ["ops_analysis"], schema_cache
        )
        assert nodes["ops_analysis"]["product_line"] == "混合云（HCS）"
        assert nodes["ops_analysis"]["location"] == "局点A"

    def test_export_data_includes_inherited_ops_analysis_fields(self, api_client):
        """问题填写的产品线经快照继承后，运维分析导出列应非空。"""
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

    def test_format_cell_value_flattens_newlines_and_truncates(self):
        col = {"type": "text"}
        plain = _format_cell_value("line1\r\nline2\nline3", col)
        assert plain == "line1 line2 line3"
        assert "\n" not in plain
        long_val = "甲" * 2500
        truncated = _format_cell_value(long_val, col)
        assert truncated.endswith("…")
        assert len(truncated) == 2001  # 2000 chars + ellipsis

    def test_csv_stream_yields_header_then_chunks(self, monkeypatch):
        """CSV 导出应分块 yield，而非一次性缓冲整文件。"""
        batches = [[["YW001", "局点A"]], [["YW002", "局点B"]]]
        columns = [
            {"nodeKey": "system", "fieldKey": "processId", "fullLabel": "流程ID", "type": "text"},
            {"nodeKey": "problem_fill", "fieldKey": "location", "fullLabel": "局点", "type": "text"},
        ]

        class FakeConn:
            pass

        def fake_db_conn():
            class Ctx:
                def __enter__(self):
                    return FakeConn()

                def __exit__(self, *args):
                    return False

            return Ctx()

        def fake_schema_cache(conn, node_keys, **kwargs):
            return {}

        def fake_iter_batches(conn, ticket_nos, cols, **kwargs):
            yield from batches

        monkeypatch.setattr("ticket_export._iter_export_row_batches", fake_iter_batches)
        monkeypatch.setattr("ticket_export.db_conn", fake_db_conn)
        monkeypatch.setattr("ticket_export._build_schema_cache", fake_schema_cache)

        chunks = list(
            _csv_bytes_stream(
                ["流程ID", "局点"],
                ["YW001", "YW002"],
                columns,
                normalize_person_fn=lambda k, v: v,
                export_node_keys=["system", "problem_fill"],
            )
        )
        assert len(chunks) >= 2
        body = b"".join(chunks).decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(body)))
        assert rows[0] == ["流程ID", "局点"]
        assert ["YW001", "局点A"] in rows
        assert ["YW002", "局点B"] in rows

    def test_file_chunk_iterator_reads_in_parts(self, tmp_path):
        path = tmp_path / "sample.bin"
        path.write_bytes(b"a" * 100 + b"b" * 50)
        chunks = list(_file_chunk_iterator(str(path), chunk_size=40))
        assert b"".join(chunks) == path.read_bytes()
        _remove_temp_file(str(path))
        assert not path.exists()

    def test_export_denied_without_workbench_export_permission(self, api_client):
        """workbench_export=hidden 时，前端藏按钮；后端导出接口须同样 403。"""
        role = "wb_export_hidden_role"
        user = "wb_export_hidden_user"
        api_client.post(
            "/api/admin/users/bulk",
            json={
                "items": [
                    {
                        "account": user,
                        "user_name": "导出无权限",
                        "role_code": role,
                        "group_name": "测试组",
                        "is_active": True,
                    }
                ],
                "operator_id": "admin",
            },
        )
        api_client.post(
            "/api/admin/permissions/bulk",
            json={
                "operator_id": "admin",
                "items": [
                    {
                        "role_code": role,
                        "is_pl": False,
                        "node_key": "__whitelist__",
                        "field_key": "workbench_export",
                        "permission_level": "hidden",
                    }
                ],
            },
        )
        denied_payload = {
            "operator_id": user,
            "format": "csv",
            "range": "selected",
            "ticket_nos": ["YW20260402001"],
            "selected_fields": {"system": ["processId"]},
        }
        data_resp = api_client.post(
            "/api/tickets/export-data",
            json={"ticket_nos": ["YW20260402001"], "operator_id": user},
        )
        assert data_resp.status_code == 403, data_resp.text[:300]
        assert "无导出权限" in (data_resp.json().get("detail") or "")

        file_resp = api_client.post("/api/tickets/export-file", json=denied_payload)
        if file_resp.status_code == 405:
            pytest.skip("后端未加载 export-file 路由，请重启 uvicorn 后重试")
        assert file_resp.status_code == 403, file_resp.text[:300]

        task_resp = api_client.post("/api/tickets/export-tasks", json=denied_payload)
        if task_resp.status_code in (404, 405, 503):
            pytest.skip("后端未加载 export-tasks 或任务表未迁移")
        assert task_resp.status_code == 403, task_resp.text[:300]

        progress_resp = api_client.get(
            "/api/tickets/export-tasks/1/progress",
            params={"operator_id": user},
        )
        if progress_resp.status_code not in (404, 405, 503):
            assert progress_resp.status_code == 403, progress_resp.text[:300]
