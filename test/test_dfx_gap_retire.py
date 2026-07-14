import os

import psycopg

from e2e_api import require_ticket_order_id, unique_e2e_tag


def test_dfx_gap_retired_for_new_revived_for_old(api_client):
    """dfx_gap 退役：新单 schema 不含；已存 dfx_gap 值的旧单按 ticket_id 复活（且不强制必填）。"""
    # 1) 新单（不传 ticket_id）：dev_analysis schema 不应含已退役的 dfx_gap
    fields = api_client.get("/api/nodes/dev_analysis/schema").json()["fields"]
    assert "dfx_gap" not in {f["key"] for f in fields}, "退役后 dev_analysis 新单 schema 不应含 dfx_gap"

    # 2) 造一张"旧单"：建单后把 dfx_gap 注入其已存节点数据（模拟退役前已填写）
    order_id = require_ticket_order_id(api_client, unique_e2e_tag())
    dsn = os.environ["DATABASE_URL"]
    with psycopg.connect(dsn) as conn:
        conn.execute(
            """
            UPDATE ticket_node_data
            SET values_json = values_json || '{"dfx_gap":"历史DFX能力GAP内容"}'::jsonb
            WHERE ticket_id = (SELECT id FROM ticket WHERE ticket_no = %s)
            """,
            (order_id,),
        )
        conn.commit()

    # 3) 旧单（带 ticket_id）：dev_analysis schema 应复活 dfx_gap
    fields_old = api_client.get(
        "/api/nodes/dev_analysis/schema", params={"ticket_id": order_id}
    ).json()["fields"]
    assert "dfx_gap" in {f["key"] for f in fields_old}, "已存 dfx_gap 的旧单应复活该字段"

    # 4) 旧单但请求非 dfx_gap 节点（problem_fill）：不应复活
    fields_pf = api_client.get(
        "/api/nodes/problem_fill/schema", params={"ticket_id": order_id}
    ).json()["fields"]
    assert "dfx_gap" not in {f["key"] for f in fields_pf}, "problem_fill 非 dfx_gap 节点不应复活"

    # 5) 复活的 dfx_gap 不强制必填（旧单编辑不卡校验）
    dfx_field = next(f for f in fields_old if f["key"] == "dfx_gap")
    assert dfx_field["required"] is False, "复活的 dfx_gap 应取消必填"
