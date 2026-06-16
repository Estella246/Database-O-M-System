"""工单号碰撞：create_intent + 全局序号 a 重取号。"""

from __future__ import annotations

import re

from test_m02_ticket import (
    _YW_RE,
    _build_node_payload,
    _build_problem_fill_payload,
    _submit_fill,
    _submit_node,
    _unique_ticket_no,
)

_HPM_RE = re.compile(r"^HPM[0-9]{11}$")


class TestAllocateTicketNo:
    def test_allocate_yw_ticket_no(self, api_client):
        resp = api_client.post("/api/tickets/allocate-no", json={"template_code": "HCS_INCIDENT"})
        assert resp.status_code == 200, resp.text[:200]
        no = resp.json().get("ticket_no", "")
        assert _YW_RE.match(no), no

    def test_allocate_hpm_ticket_no(self, api_client):
        resp = api_client.post("/api/tickets/allocate-no", json={"template_code": "HOTPATCH"})
        assert resp.status_code == 200, resp.text[:200]
        no = resp.json().get("ticket_no", "")
        assert _HPM_RE.match(no), no


class TestTicketNoCreateCollision:
    def test_problem_fill_after_ops_start_reallocates_new_ticket(self, api_client):
        """单号已占用且 create_intent 时，按全局 a 重新取号建单。"""
        ticket_no = _unique_ticket_no()
        ops_payload = _build_node_payload(
            api_client,
            "ops_analysis",
            "提交开发分析",
            overrides={"start_date": "2026-04-27", "location": "华北-北京"},
        )
        first = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/ops_analysis/submit",
            json=ops_payload,
        )
        assert first.status_code == 200, first.text[:400]
        assert first.json()["ticket_id"] == ticket_no

        fill_payload = _build_problem_fill_payload(api_client)
        fill_payload["create_intent"] = True
        second = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=fill_payload,
        )
        assert second.status_code == 200, second.text[:400]
        new_no = second.json()["ticket_id"]
        assert new_no != ticket_no, "单号已存在时应重新取号"
        assert _YW_RE.match(new_no), new_no

        new_logs = api_client.get(f"/api/tickets/{new_no}/logs").json().get("items") or []
        assert any(r.get("from") == "问题填写" for r in new_logs)

    def test_problem_fill_on_normal_ticket_still_same_no(self, api_client):
        ticket_no = _unique_ticket_no()
        assert _submit_fill(api_client, ticket_no).status_code == 200
        resp = api_client.post(
            f"/api/tickets/{ticket_no}/nodes/problem_fill/submit",
            json=_build_problem_fill_payload(api_client, overrides={"start_date": "2026-04-28"}),
        )
        assert resp.status_code == 200, resp.text[:300]
        assert resp.json()["ticket_id"] == ticket_no

    def test_submit_after_problem_review_chain_uses_same_no(self, api_client):
        ticket_no = _unique_ticket_no()
        assert _submit_fill(api_client, ticket_no).status_code == 200
        assert _submit_node(api_client, ticket_no, "problem_review", "确认问题").status_code == 200
        resp = _submit_node(api_client, ticket_no, "ops_analysis", "提交开发分析")
        assert resp.status_code == 200, resp.text[:400]
        assert resp.json()["ticket_id"] == ticket_no
