"""工作台 HCS 列表快照：分页、搜索、facets、回退开关。"""
from __future__ import annotations

from pathlib import Path

import pytest

from config import SCHEMA_TEMPLATE_CODE, TICKET_LIST_SNAPSHOT_ENABLED

ROOT = Path(__file__).resolve().parents[1]
TICKETS_ROUTER_SRC = (ROOT / "backend" / "routers" / "tickets.py").read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def _ensure_snapshot_table(api_client):
    """测试库须已执行 0079 迁移；若无快照表则跳过本模块。"""
    from ticket_list_snapshot import refresh_all_hcs_snapshots

    try:
        refresh_all_hcs_snapshots(batch_size=0)
    except Exception as exc:
        pytest.skip(f"ticket_list_snapshot unavailable: {exc}")


class TestTicketListSnapshot:
    def test_snapshot_paged_list(self, api_client):
        resp = api_client.get(
            "/api/tickets",
            params={
                "operator_id": "test_user01",
                "template_code": SCHEMA_TEMPLATE_CODE,
                "page": 1,
                "page_size": 5,
                "tab": "all",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("list_mode") == "snapshot"
        assert "total" in body
        assert body.get("page") == 1
        assert isinstance(body.get("items"), list)
        assert len(body["items"]) <= 5

    def test_snapshot_page_size_up_to_200(self, api_client):
        resp = api_client.get(
            "/api/tickets",
            params={
                "operator_id": "test_user01",
                "template_code": SCHEMA_TEMPLATE_CODE,
                "page": 1,
                "page_size": 200,
                "tab": "all",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("page_size") == 200
        assert len(body.get("items") or []) <= 200

    def test_snapshot_search(self, api_client):
        base = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "template_code": SCHEMA_TEMPLATE_CODE, "page": 1, "page_size": 50},
        )
        assert base.status_code == 200
        items = base.json().get("items") or []
        if not items:
            pytest.skip("no hcs tickets")
        oid = items[0]["orderId"]
        resp = api_client.get(
            "/api/tickets",
            params={
                "operator_id": "test_user01",
                "template_code": SCHEMA_TEMPLATE_CODE,
                "page": 1,
                "page_size": 20,
                "q": oid[:6],
            },
        )
        assert resp.status_code == 200
        found = [x for x in resp.json().get("items", []) if x.get("orderId") == oid]
        assert found, f"search should find {oid}"

    def test_snapshot_facets(self, api_client):
        resp = api_client.get(
            "/api/tickets/facets",
            params={
                "operator_id": "test_user01",
                "template_code": SCHEMA_TEMPLATE_CODE,
                "column": "severity",
                "tab": "all",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("list_mode") == "snapshot"
        assert isinstance(body.get("values"), list)

    def test_snapshot_facets_whitelist_column(self, api_client):
        resp = api_client.get(
            "/api/tickets/facets",
            params={
                "operator_id": "test_user01",
                "template_code": SCHEMA_TEMPLATE_CODE,
                "column": "handle_mode",
                "tab": "all",
            },
        )
        assert resp.status_code == 200
        assert resp.json().get("column") == "handle_mode"
        assert isinstance(resp.json().get("values"), list)

    def test_legacy_fallback_when_page_zero(self, api_client):
        resp = api_client.get(
            "/api/tickets",
            params={"operator_id": "test_user01", "template_code": SCHEMA_TEMPLATE_CODE, "page": 0},
        )
        assert resp.status_code == 400
        assert "page=0" in str(resp.json().get("detail") or "")

    @pytest.mark.parametrize("tab", ["pending_close", "audit_close", "handled"])
    def test_home_workbench_snapshot_tabs(self, api_client, tab):
        resp = api_client.get(
            "/api/tickets",
            params={
                "operator_id": "test_user01",
                "operator_name": "测试用户",
                "template_code": SCHEMA_TEMPLATE_CODE,
                "page": 1,
                "page_size": 20,
                "tab": tab,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("list_mode") == "snapshot"
        assert isinstance(body.get("items"), list)

    @pytest.mark.skipif(not TICKET_LIST_SNAPSHOT_ENABLED, reason="snapshot disabled")
    def test_rebuild_endpoint_batch(self, api_client):
        resp = api_client.post(
            "/api/tickets/snapshot/rebuild",
            json={
                "operator_id": "test_user01",
                "after_ticket_id": 0,
                "batch_size": 5,
            },
        )
        if resp.status_code == 403:
            pytest.skip("测试账号无 workbench_snapshot_rebuild 权限")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is True
        assert "has_more" in body
        assert "done_cumulative" in body
        assert isinstance(body.get("logs"), list)

    @pytest.mark.skipif(not TICKET_LIST_SNAPSHOT_ENABLED, reason="snapshot disabled")
    def test_rebuild_endpoint_full_loop(self, api_client):
        after = 0
        total = 0
        done = 0
        while True:
            resp = api_client.post(
                "/api/tickets/snapshot/rebuild",
                json={
                    "operator_id": "test_user01",
                    "after_ticket_id": after,
                    "batch_size": 20,
                },
            )
            if resp.status_code == 403:
                pytest.skip("测试账号无 workbench_snapshot_rebuild 权限")
            assert resp.status_code == 200
            body = resp.json()
            assert body.get("ok") is True
            total = int(body.get("total") or total)
            done = int(body.get("done_cumulative") or done)
            if not body.get("has_more"):
                break
            after = int(body.get("next_after_ticket_id") or 0)
            assert after > 0
        assert done == total

    def test_submit_skips_snapshot_when_table_missing(self):
        """未执行 0079 时 submit 不应因快照表缺失而 500。"""
        block = TICKETS_ROUTER_SRC.split("refresh_ticket_list_snapshot(conn, int(ticket", 1)[-1]
        assert "except UndefinedTable:" in block
        assert "ticket_list_snapshot missing on submit" in block

