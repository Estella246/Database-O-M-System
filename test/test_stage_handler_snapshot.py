"""列表快照各阶段「处理人」= 该阶段最新 submit 人。"""
from __future__ import annotations

from pathlib import Path

import pytest

from config import SCHEMA_TEMPLATE_CODE
from ticket_export_fields import EXPORT_FIELDS_BY_NODE, NODE_ORDER

ROOT = Path(__file__).resolve().parents[1]
FE_EXPORT_FIELDS = (ROOT / "frontend" / "modules" / "constants" / "export-fields.js").read_text(
    encoding="utf-8"
)

STAGE_HANDLER_NODES = (
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
)


def test_export_fields_include_stage_handler_fe_and_be():
    for nk in STAGE_HANDLER_NODES:
        fields = EXPORT_FIELDS_BY_NODE.get(nk) or []
        assert fields and fields[0]["key"] == "stage_handler"
        assert fields[0]["label"] == "处理人"
        keys = {f["key"] for f in fields}
        assert "next_handler" not in keys
        if nk == "problem_review":
            assert "handle_mode" in keys
        else:
            assert "handle_mode" not in keys
    assert 'key: "stage_handler"' in FE_EXPORT_FIELDS
    # 问题填写 / 系统字段不挂阶段处理人
    assert not any(f["key"] == "stage_handler" for f in EXPORT_FIELDS_BY_NODE.get("problem_fill") or [])
    assert not any(f["key"] == "stage_handler" for f in EXPORT_FIELDS_BY_NODE.get("system") or [])
    assert NODE_ORDER[0] == "system"


def test_resolve_stage_handlers_map_latest_submitter(api_client):
    from database import db_conn
    from routers.tickets import (
        STAGE_HANDLER_FIELD_KEY,
        _resolve_stage_handlers_map,
    )
    from ticket_list_snapshot import refresh_ticket_list_snapshot

    # 找一张已走过运维分析的 HCS 单
    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT t.id, t.ticket_no
            FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            JOIN ticket_flow_log fl ON fl.ticket_id = t.id
            JOIN workflow_node wn ON wn.id = fl.from_node_id AND wn.node_key = 'ops_analysis'
            WHERE wt.template_code = %s
              AND fl.action_type IN ('submit', 'jump_submit')
            ORDER BY t.id DESC
            LIMIT 1
            """,
            (SCHEMA_TEMPLATE_CODE,),
        ).fetchone()
        if not row:
            pytest.skip("no ticket with ops_analysis submit")
        tid = int(row["id"])
        handlers = _resolve_stage_handlers_map(conn, tid)
        assert "ops_analysis" in handlers
        assert str(handlers["ops_analysis"]).strip()

        refresh_ticket_list_snapshot(conn, tid)
        snap = conn.execute(
            """
            SELECT fields_by_node, extra_fields
            FROM ticket_list_snapshot WHERE ticket_id = %s
            """,
            (tid,),
        ).fetchone()
        assert snap
        fbn = snap["fields_by_node"] if isinstance(snap["fields_by_node"], dict) else {}
        ops = fbn.get("ops_analysis") if isinstance(fbn.get("ops_analysis"), dict) else {}
        assert ops.get(STAGE_HANDLER_FIELD_KEY) == handlers["ops_analysis"]
        extra = snap["extra_fields"] if isinstance(snap["extra_fields"], dict) else {}
        assert extra.get("ops_analyst") == handlers["ops_analysis"]
        if handlers.get("dev_analysis"):
            assert extra.get("dev_analyst") == handlers["dev_analysis"]


def test_stage_handler_filter_col_keys_in_snapshot_spec():
    """列筛选 / facets 支持各阶段处理人（nodeKey:stage_handler → fields_by_node）。"""
    from ticket_list_snapshot import (
        FACET_COL_MAP,
        FILTER_COL_TO_SPEC,
        _snapshot_filter_value_expr,
    )

    for nk in STAGE_HANDLER_NODES:
        col_key = f"{nk}:stage_handler"
        assert FILTER_COL_TO_SPEC.get(col_key) == ("fbn", nk)
        assert FACET_COL_MAP.get(col_key) == ("fbn", nk)
        expr = _snapshot_filter_value_expr("fbn", nk)
        assert f"fields_by_node->'{nk}'->>'stage_handler'" in expr


def test_stage_handler_facets_and_filter(api_client):
    """facets / 列表 column_filters 可按运维分析-处理人筛选。"""
    from database import db_conn
    from ticket_list_snapshot import refresh_ticket_list_snapshot

    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT t.id, t.ticket_no
            FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            JOIN ticket_flow_log fl ON fl.ticket_id = t.id
            JOIN workflow_node wn ON wn.id = fl.from_node_id AND wn.node_key = 'ops_analysis'
            WHERE wt.template_code = %s
              AND fl.action_type IN ('submit', 'jump_submit')
            ORDER BY t.id DESC
            LIMIT 1
            """,
            (SCHEMA_TEMPLATE_CODE,),
        ).fetchone()
        if not row:
            pytest.skip("no ticket with ops_analysis submit")
        tid = int(row["id"])
        ticket_no = str(row["ticket_no"])
        refresh_ticket_list_snapshot(conn, tid)
        snap = conn.execute(
            """
            SELECT fields_by_node FROM ticket_list_snapshot WHERE ticket_id = %s
            """,
            (tid,),
        ).fetchone()
        fbn = snap["fields_by_node"] if isinstance(snap["fields_by_node"], dict) else {}
        ops = fbn.get("ops_analysis") if isinstance(fbn.get("ops_analysis"), dict) else {}
        handler = str(ops.get("stage_handler") or "").strip()
        if not handler:
            pytest.skip("snapshot missing ops_analysis stage_handler")

    col = "ops_analysis:stage_handler"
    facets = api_client.post(
        "/api/tickets/facets/query",
        json={
            "operator_id": "test_user01",
            "template_code": SCHEMA_TEMPLATE_CODE,
            "column": col,
            "tab": "all",
            "column_filters": {},
        },
    )
    assert facets.status_code == 200, facets.text
    values = facets.json().get("values") or []
    assert handler in values

    listed = api_client.post(
        "/api/tickets/query",
        json={
            "operator_id": "test_user01",
            "operator_name": "测试用户",
            "template_code": SCHEMA_TEMPLATE_CODE,
            "page": 1,
            "page_size": 50,
            "tab": "all",
            "column_filters": {col: [handler]},
        },
    )
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body.get("list_mode") == "snapshot"
    nos = {str(it.get("orderId") or it.get("processId") or "") for it in (body.get("items") or [])}
    assert ticket_no in nos
