import importlib.util
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_HOME_ROUTER = Path(__file__).resolve().parent.parent / "backend" / "routers" / "home.py"
_HOME_SPEC = importlib.util.spec_from_file_location("home_router_test", _HOME_ROUTER)
_HOME_MOD = importlib.util.module_from_spec(_HOME_SPEC)
assert _HOME_SPEC.loader is not None
_HOME_SPEC.loader.exec_module(_HOME_MOD)
_quality_issue_kind = _HOME_MOD._quality_issue_kind
_quality_scope_matches = _HOME_MOD._quality_scope_matches

NODE_PROBLEM_FILL = 1
NODE_PROBLEM_REVIEW = 2
NODE_OPS_ANALYSIS = 3
NODE_DEV_ANALYSIS = 4
NODE_OPS_CLOSURE = 6
NODE_AUDIT_CLOSE = 7

_HOME_PT_PREFIX = "home_pt_"
_HOME_PT_YEAR = 2099
_HOME_PT_MONTH = 4


def _home_pt_period_t0():
    return datetime(_HOME_PT_YEAR, _HOME_PT_MONTH, 10, 0, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="class")
def seed_home_passthrough_stats():
    """两张工单归属同一运维分析处理人：A 独立闭环，B 流转至责任田。"""
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过主页透传率测试")

    t0 = _home_pt_period_t0()
    H = timedelta(hours=1)
    tickets = {
        f"{_HOME_PT_PREFIX}A": [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "home_pt_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "home_pt_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_OPS_CLOSURE, "submit", "home_pt_ops", t0 + 3 * H),
            (NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "home_pt_closer", t0 + 6 * H),
        ],
        f"{_HOME_PT_PREFIX}B": [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "home_pt_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "home_pt_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "home_pt_ops", t0 + 2 * H),
            (NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", "home_pt_dev", t0 + 5 * H),
            (NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "home_pt_closer", t0 + 9 * H),
        ],
    }
    users = {
        "home_pt_filler": "填单员",
        "home_pt_reviewer": "审核员",
        "home_pt_ops": "运维甲",
        "home_pt_dev": "开发乙",
        "home_pt_closer": "闭环员",
    }

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_HOME_PT_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_HOME_PT_PREFIX}%",))
        for acc, name in users.items():
            conn.execute(
                """
                INSERT INTO user_account (account, user_name, role_code, group_name, is_active)
                VALUES (%s, %s, '普通人员', 'ONCALL', TRUE)
                ON CONFLICT (account) DO UPDATE SET is_active = TRUE
                """,
                (acc, name),
            )
        for ticket_no, logs in tickets.items():
            closed_at = logs[-1][4]
            conn.execute(
                """
                INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at)
                VALUES (%s, 1, %s, 'closed', 'home_pt_filler', '填单员', %s, %s)
                """,
                (ticket_no, f"主页透传率测试 {ticket_no}", logs[0][4], closed_at),
            )
            tid = conn.execute(
                "SELECT currval(pg_get_serial_sequence('ticket','id')) AS id"
            ).fetchone()["id"]
            for fr, to, action, op, ts in logs:
                conn.execute(
                    """
                    INSERT INTO ticket_flow_log
                      (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, '', %s)
                    """,
                    (tid, fr, to, action, op, users.get(op, op), ts),
                )
        conn.commit()

    yield

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_HOME_PT_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_HOME_PT_PREFIX}%",))
        conn.execute("DELETE FROM user_account WHERE account LIKE %s", ("home_pt_%",))
        conn.commit()


class TestHomePersonalQualityScope:
    def test_quality_issue_kind_recognizes_whitelist_values(self):
        assert _quality_issue_kind("是（已知质量问题）") == "quality"
        assert _quality_issue_kind("是（新发现质量问题）") == "quality"
        assert _quality_issue_kind("否") == "non_quality"

    def test_quality_scope_matches(self):
        assert _quality_scope_matches("all", "是（已知质量问题）")
        assert _quality_scope_matches("quality", "是（已知质量问题）")
        assert not _quality_scope_matches("non_quality", "是（已知质量问题）")
        assert _quality_scope_matches("non_quality", "否")
        assert not _quality_scope_matches("quality", "否")


class TestPersonalStats:
    def test_home_order_heatmap(self, api_client):
        resp = api_client.get("/api/home/order-heatmap", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        body = resp.json()
        assert "counts" in body
        assert isinstance(body["counts"], dict)
        assert body.get("window_days") == 365

    def test_tc_m08_001_get_personal_stats(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert "workload" in body
        assert "sla" in body
        assert "passthrough" in body

    def test_tc_m08_002_invalid_date_format(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "invalid",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 400

    def test_tc_m08_003_invalid_quality_scope(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
            "quality_scope": "invalid",
        })
        assert resp.status_code == 400

    def test_tc_m08_004_swapped_dates(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-30",
            "end_date": "2026-04-01",
        })
        assert resp.status_code == 200

    def test_e_m08_workload_structure(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        workload = resp.json()["workload"]
        assert isinstance(workload, dict)

    def test_e_m08_sla_structure(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        sla = resp.json()["sla"]
        assert isinstance(sla, dict)

    def test_e_m08_passthrough_structure(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        passthrough = resp.json()["passthrough"]
        assert isinstance(passthrough, dict)

    def test_e_m08_different_operators(self, api_client):
        resp1 = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_admin",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        resp2 = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp1.status_code == 200
        assert resp2.status_code == 200

    def test_e_m08_missing_operator_id(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200

    def test_e_m08_missing_dates(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
        })
        assert resp.status_code in (200, 400)

    def test_e_m08_same_start_end_date(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-15",
            "end_date": "2026-04-15",
        })
        assert resp.status_code == 200

    def test_e_m08_wide_date_range(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2025-01-01",
            "end_date": "2026-12-31",
        })
        assert resp.status_code == 200

    def test_e_m08_nonexistent_operator(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "nonexistent_user_xyz",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200


@pytest.mark.usefixtures("seed_home_passthrough_stats")
class TestHomePersonalPassthroughStats:
    def _passthrough(self, api_client, operator_id: str):
        resp = api_client.get(
            "/api/home/personal-stats",
            params={
                "operator_id": operator_id,
                "start_date": f"{_HOME_PT_YEAR}-{_HOME_PT_MONTH:02d}-01",
                "end_date": f"{_HOME_PT_YEAR}-{_HOME_PT_MONTH:02d}-30",
            },
        )
        assert resp.status_code == 200
        return resp.json()["passthrough"]

    def test_tc_m08_passthrough_scoped_to_ops_analysis_handler(self, api_client):
        pt = self._passthrough(api_client, "home_pt_ops")
        assert pt["independent_closure_count"] == 1
        assert pt["commando_count"] == 1

    def test_tc_m08_passthrough_excludes_other_handlers(self, api_client):
        pt = self._passthrough(api_client, "home_pt_reviewer")
        assert pt["independent_closure_count"] == 0
        assert pt["commando_count"] == 0

    def test_tc_m08_passthrough_quality_scope(self, api_client):
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过主页透传率测试")

        ticket_no = f"{_HOME_PT_PREFIX}Q"
        t0 = _home_pt_period_t0()
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            conn.execute(
                "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no = %s)",
                (ticket_no,),
            )
            conn.execute("DELETE FROM ticket WHERE ticket_no = %s", (ticket_no,))
            row = conn.execute(
                """
                INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at)
                VALUES (%s, 1, %s, 'closed', 'home_pt_filler', '填单员', %s, %s)
                RETURNING id
                """,
                (ticket_no, "主页透传率质量筛选", t0, t0 + timedelta(hours=6)),
            ).fetchone()
            tid = row["id"]
            conn.execute(
                """
                INSERT INTO ticket_flow_log
                  (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
                VALUES
                  (%s, %s, %s, 'submit', 'home_pt_filler', '填单员', '', %s),
                  (%s, %s, %s, 'submit', 'home_pt_reviewer', '审核员', '', %s),
                  (%s, %s, %s, 'submit', 'home_pt_ops', '运维甲', '', %s),
                  (%s, %s, %s, 'close', 'home_pt_closer', '闭环员', '', %s)
                """,
                (
                    tid, NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, t0,
                    tid, NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, t0 + timedelta(hours=1),
                    tid, NODE_OPS_ANALYSIS, NODE_OPS_CLOSURE, t0 + timedelta(hours=3),
                    tid, NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, t0 + timedelta(hours=6),
                ),
            )
            tni_row = conn.execute(
                """
                INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, status, started_at, ended_at)
                VALUES (%s, %s, 'home_pt_ops', '运维甲', 'completed', %s, %s)
                RETURNING id
                """,
                (tid, NODE_OPS_ANALYSIS, t0 + timedelta(hours=2), t0 + timedelta(hours=3)),
            ).fetchone()
            tni_id = tni_row["id"]
            conn.execute(
                """
                INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, created_at)
                VALUES (%s, %s, %s::jsonb, %s)
                """,
                (
                    tid,
                    tni_id,
                    '{"is_quality_issue":"是（已知质量问题）"}',
                    t0 + timedelta(hours=3),
                ),
            )
            conn.commit()

        try:
            params = {
                "operator_id": "home_pt_ops",
                "start_date": f"{_HOME_PT_YEAR}-{_HOME_PT_MONTH:02d}-01",
                "end_date": f"{_HOME_PT_YEAR}-{_HOME_PT_MONTH:02d}-30",
            }
            all_pt = api_client.get("/api/home/personal-stats", params={**params, "quality_scope": "all"}).json()["passthrough"]
            quality_pt = api_client.get(
                "/api/home/personal-stats", params={**params, "quality_scope": "quality"}
            ).json()["passthrough"]
            non_quality_pt = api_client.get(
                "/api/home/personal-stats", params={**params, "quality_scope": "non_quality"}
            ).json()["passthrough"]
            assert all_pt["independent_closure_count"] >= 2
            assert quality_pt["independent_closure_count"] >= 1
            assert non_quality_pt["independent_closure_count"] == 0
            assert non_quality_pt["commando_count"] == 0
        finally:
            with psycopg.connect(dsn, row_factory=dict_row) as conn:
                conn.execute(
                    "DELETE FROM ticket_node_data WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no = %s)",
                    (ticket_no,),
                )
                conn.execute(
                    "DELETE FROM ticket_node_instance WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no = %s)",
                    (ticket_no,),
                )
                conn.execute(
                    "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no = %s)",
                    (ticket_no,),
                )
                conn.execute("DELETE FROM ticket WHERE ticket_no = %s", (ticket_no,))
                conn.commit()


class TestTicketListStats:
    def test_e_m08_ticket_list_endpoint(self, api_client):
        resp = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body

    def test_e_m08_ticket_basic_list_endpoint(self, api_client):
        resp = api_client.get("/api/tickets/basic")
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert isinstance(body["items"], list)

    def test_e_m08_ticket_basic_item_structure(self, api_client):
        resp = api_client.get("/api/tickets/basic")
        assert resp.status_code == 200
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "order_id" in item
            assert "subject" in item
            assert "node_key" in item
            assert "node_name" in item
            assert "creator_name" in item
            assert "created_date" in item
            assert "assignee" in item
