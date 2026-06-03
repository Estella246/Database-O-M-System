"""M13 oncall 评议接口测试。

覆盖：
- /api/oncall-eva/config 公共规则
- /api/oncall-eva/scores 综合得分
- 加分项：申报、查询、审批（含优秀拉满）、撤回
- 红黑事件：录入、查询、删除、权限校验
"""
import os
from calendar import monthrange
from datetime import datetime, timedelta, timezone

import pytest


# admin 用户由 0010_add_rbac_tables.sql 默认 seed (account=admin, is_pl=true)
ADMIN_OP = "admin"
USER_OP = "test_user01"

# 0001_init_workflow_schema.sql 的固定节点 id（template_id=1）
NODE_PROBLEM_FILL = 1
NODE_PROBLEM_REVIEW = 2
NODE_OPS_ANALYSIS = 3
NODE_DEV_ANALYSIS = 4
NODE_DEV_CLOSURE = 5
NODE_OPS_CLOSURE = 6
NODE_AUDIT_CLOSE = 7


def _now_period():
    n = datetime.utcnow()
    return n.year, n.month


@pytest.fixture(scope="module", autouse=True)
def _ensure_user_for_oncall(api_client):
    api_client.post("/api/admin/users/bulk", json={
        "items": [
            {"account": ADMIN_OP, "user_name": "管理员", "role_code": "admin", "group_name": "platform", "is_active": True},
            {"account": USER_OP, "user_name": "测试用户01", "role_code": "普通人员", "group_name": "测试组", "is_active": True},
        ],
        "operator_id": "admin",
    })
    yield


class TestOncallConfig:
    def test_tc_m13_001_get_config(self, api_client):
        resp = api_client.get("/api/oncall-eva/config")
        assert resp.status_code == 200
        body = resp.json()
        assert body["sla"]["weight"] == 0.35
        assert body["closure"]["weight"] == 0.30
        assert body["ticket"]["full_score"] == 20
        assert body["extra"]["cap"] == 15
        assert body["event"]["single_limit"] == 5
        cats = {c["key"] for c in body["extra"]["categories"]}
        assert {"efficiency", "enablement", "knowledge", "public", "travel"}.issubset(cats)


class TestOncallScores:
    def test_tc_m13_010_scores_basic(self, api_client):
        y, m = _now_period()
        resp = api_client.get("/api/oncall-eva/scores", params={"year": y, "month": m, "operator_id": ADMIN_OP})
        assert resp.status_code == 200
        body = resp.json()
        assert body["period"]["year"] == y
        assert body["period"]["month"] == m
        assert "items" in body
        assert "team" in body

    def test_tc_m13_011_scores_invalid_month(self, api_client):
        resp = api_client.get("/api/oncall-eva/scores", params={"year": 2026, "month": 13})
        assert resp.status_code == 400


class TestOncallExtras:
    def test_tc_m13_020_create_extra_self(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "efficiency",
            "description": "自动化告警工具",
            "declared_score": 5,
            "evidence_url": "http://example.com/pr/1",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"

    def test_tc_m13_021_create_extra_invalid_category(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "not-real",
            "description": "x",
            "declared_score": 1,
        })
        assert resp.status_code == 400

    def test_tc_m13_022_create_extra_empty_description(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "knowledge",
            "description": "",
            "declared_score": 1,
        })
        assert resp.status_code == 400

    def test_tc_m13_023_create_extra_for_other_user_forbidden(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "account": ADMIN_OP,  # 普通用户为他人申报
            "period_year": y,
            "period_month": m,
            "category": "knowledge",
            "description": "代他人申报",
            "declared_score": 1,
        })
        assert resp.status_code == 403

    def test_tc_m13_024_list_extras_filter_status(self, api_client):
        y, m = _now_period()
        resp = api_client.get("/api/oncall-eva/extras", params={"year": y, "month": m, "status": "pending"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        for it in items:
            assert it["status"] == "pending"

    def test_tc_m13_025_review_approve_normal(self, api_client):
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "efficiency",
            "description": "审批用例-普通通过",
            "declared_score": 3,
        })
        assert create.status_code == 200
        eid = create.json()["id"]
        resp = api_client.patch(f"/api/oncall-eva/extras/{eid}", json={
            "operator_id": ADMIN_OP,
            "status": "approved",
            "is_excellent": False,
            "review_comment": "ok",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "approved"

    def test_tc_m13_026_review_approve_excellent_caps_to_per_item(self, api_client):
        # 申报分数=2，标记优秀，efficiency 单项满分=5，预期最终落到 5
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "efficiency",
            "description": "审批用例-优秀拉满",
            "declared_score": 2,
        })
        eid = create.json()["id"]
        resp = api_client.patch(f"/api/oncall-eva/extras/{eid}", json={
            "operator_id": ADMIN_OP,
            "status": "approved",
            "is_excellent": True,
        })
        assert resp.status_code == 200
        # 反查 score 汇总，确认 efficiency 单项加分至少 5
        scores = api_client.get("/api/oncall-eva/scores", params={"year": y, "month": m}).json()
        mine = next((x for x in scores["items"] if x["account"] == USER_OP), None)
        assert mine is not None
        eff = mine["extras"]["by_category"]["efficiency"]
        assert any(it.get("is_excellent") and it["score"] == 5 for it in eff["items"])

    def test_tc_m13_027_review_status_must_be_pending(self, api_client):
        # 复审已 approved 的应当 400
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "knowledge",
            "description": "复审失败用例",
            "declared_score": 2,
        }).json()
        api_client.patch(f"/api/oncall-eva/extras/{create['id']}", json={
            "operator_id": ADMIN_OP,
            "status": "approved",
        })
        resp = api_client.patch(f"/api/oncall-eva/extras/{create['id']}", json={
            "operator_id": ADMIN_OP,
            "status": "rejected",
        })
        assert resp.status_code == 400

    def test_tc_m13_028_review_invalid_status(self, api_client):
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "knowledge",
            "description": "非法状态",
            "declared_score": 1,
        }).json()
        resp = api_client.patch(f"/api/oncall-eva/extras/{create['id']}", json={
            "operator_id": ADMIN_OP,
            "status": "weird",
        })
        assert resp.status_code == 400

    def test_tc_m13_029_review_requires_admin(self, api_client):
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "knowledge",
            "description": "权限校验",
            "declared_score": 1,
        }).json()
        resp = api_client.patch(f"/api/oncall-eva/extras/{create['id']}", json={
            "operator_id": USER_OP,
            "status": "approved",
        })
        assert resp.status_code == 403

    def test_tc_m13_030_withdraw_self_pending(self, api_client):
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/extras", json={
            "operator_id": USER_OP,
            "period_year": y,
            "period_month": m,
            "category": "public",
            "description": "撤回用例",
            "declared_score": 2,
        }).json()
        resp = api_client.delete(f"/api/oncall-eva/extras/{create['id']}", params={"operator_id": USER_OP})
        assert resp.status_code == 200


class TestOncallEvents:
    def test_tc_m13_040_create_event_admin(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/events", json={
            "operator_id": ADMIN_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "kind": "red",
            "score": 3,
            "summary": "关键时刻挽回事故",
            "evidence_url": "http://example.com/incident/1",
        })
        assert resp.status_code == 200
        assert resp.json()["id"] > 0

    def test_tc_m13_041_create_event_score_out_of_range(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/events", json={
            "operator_id": ADMIN_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "kind": "red",
            "score": 6,
            "summary": "x",
        })
        assert resp.status_code == 400

    def test_tc_m13_042_create_event_invalid_kind(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/events", json={
            "operator_id": ADMIN_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "kind": "neutral",
            "score": 1,
            "summary": "x",
        })
        assert resp.status_code == 400

    def test_tc_m13_043_create_event_requires_admin(self, api_client):
        y, m = _now_period()
        resp = api_client.post("/api/oncall-eva/events", json={
            "operator_id": USER_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "kind": "red",
            "score": 1,
            "summary": "x",
        })
        assert resp.status_code == 403

    def test_tc_m13_044_list_events(self, api_client):
        y, m = _now_period()
        resp = api_client.get("/api/oncall-eva/events", params={"year": y, "month": m})
        assert resp.status_code == 200
        assert "items" in resp.json()

    def test_tc_m13_045_list_events_filter_kind(self, api_client):
        y, m = _now_period()
        resp = api_client.get("/api/oncall-eva/events", params={"year": y, "month": m, "kind": "red"})
        assert resp.status_code == 200
        for it in resp.json()["items"]:
            assert it["kind"] == "red"

    def test_tc_m13_046_delete_event(self, api_client):
        y, m = _now_period()
        create = api_client.post("/api/oncall-eva/events", json={
            "operator_id": ADMIN_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "kind": "black",
            "score": 1,
            "summary": "删除用例",
        }).json()
        resp = api_client.delete(f"/api/oncall-eva/events/{create['id']}", params={"operator_id": ADMIN_OP})
        assert resp.status_code == 200
        miss = api_client.delete(f"/api/oncall-eva/events/{create['id']}", params={"operator_id": ADMIN_OP})
        assert miss.status_code == 404


class TestOncallScoresAggregation:
    def test_tc_m13_050_event_affects_scores(self, api_client):
        y, m = _now_period()
        # 录入红事件 +2
        api_client.post("/api/oncall-eva/events", json={
            "operator_id": ADMIN_OP,
            "account": USER_OP,
            "period_year": y,
            "period_month": m,
            "kind": "red",
            "score": 2,
            "summary": "贡献度评议-加分",
        })
        scores = api_client.get("/api/oncall-eva/scores", params={"year": y, "month": m}).json()
        mine = next((x for x in scores["items"] if x["account"] == USER_OP), None)
        assert mine is not None
        # 总分必然 >= event_net
        assert mine["total_score"] >= mine["event_net"]
        # event_net 至少包含我们刚录入的 2 分
        assert mine["events"]["red_total"] >= 2


# 运维效率三项指标判定依据（独立闭环率 / SLA / 工单数量）
# 用一个无其它数据的远期月份做隔离，直连数据库灌入带多阶段、多处理人的流转记录。
_EFF_PREFIX = "oeva_eff_"
_EFF_YEAR = 2099
_EFF_MONTH = 3


def _eff_period_t0():
    return datetime(_EFF_YEAR, _EFF_MONTH, 10, 0, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="class")
def seed_ops_efficiency():
    """灌入两张工单：
    - 工单A：problem_review→ops_analysis(ops_a)→ops_closure→关闭，无开发分析 → 独立闭环
    - 工单B：problem_review→ops_analysis(ops_a)→dev_analysis→ops_closure→关闭 → 非独立闭环
    两张工单的 ops_analysis 处理人均为 ops_a，但问题审核/运维闭环由他人处理，
    用于验证三项指标均归属到「运维分析阶段的最后一个人」。
    """
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过运维效率判定依据测试")

    t0 = _eff_period_t0()
    H = timedelta(hours=1)
    # (from_node, to_node, action, operator, created_at)
    tickets = {
        f"{_EFF_PREFIX}A": [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "eff_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "eff_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_OPS_CLOSURE, "submit", "eff_ops_a", t0 + 3 * H),
            (NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "eff_closer", t0 + 6 * H),
        ],
        f"{_EFF_PREFIX}B": [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "eff_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "eff_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "eff_ops_a", t0 + 2 * H),
            (NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", "eff_dev_x", t0 + 5 * H),
            (NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "eff_closer", t0 + 9 * H),
        ],
    }
    users = {
        "eff_filler": "填单员", "eff_reviewer": "审核员",
        "eff_ops_a": "运维甲", "eff_dev_x": "开发乙", "eff_closer": "闭环员",
    }

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        # 清理可能残留
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_EFF_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_EFF_PREFIX}%",))
        for acc, name in users.items():
            conn.execute(
                """
                INSERT INTO user_account (account, user_name, role_code, group_name, is_active)
                VALUES (%s, %s, '普通人员', 'ONCALL', TRUE)
                ON CONFLICT (account) DO UPDATE SET is_active = TRUE, group_name = 'ONCALL'
                """,
                (acc, name),
            )
        for ticket_no, logs in tickets.items():
            closed_at = logs[-1][4]
            conn.execute(
                """
                INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at)
                VALUES (%s, 1, %s, 'closed', 'eff_filler', '填单员', %s, %s)
                RETURNING id
                """,
                (ticket_no, f"运维效率测试 {ticket_no}", logs[0][4], closed_at),
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
            (f"{_EFF_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_EFF_PREFIX}%",))
        conn.execute("DELETE FROM user_account WHERE account LIKE %s", ("eff_%",))
        conn.commit()


@pytest.mark.usefixtures("seed_ops_efficiency")
class TestOncallEfficiencyMetrics:
    def _metric(self, api_client, account):
        scores = api_client.get(
            "/api/oncall-eva/scores", params={"year": _EFF_YEAR, "month": _EFF_MONTH}
        ).json()
        row = next((x for x in scores["items"] if x["account"] == account), None)
        return row

    def test_tc_m13_060_attribute_to_ops_analysis_handler(self, api_client):
        # 两张工单的工单数量、SLA、独立闭环率均归属到运维分析阶段最后一个人 eff_ops_a
        m = self._metric(api_client, "eff_ops_a")
        assert m is not None
        assert m["metrics"]["ticket_count"] == 2

    def test_tc_m13_061_other_stage_handlers_not_counted(self, api_client):
        # 仅处理问题审核 / 运维闭环 的人不计入运维效率工单数量
        for acc in ("eff_reviewer", "eff_closer", "eff_dev_x"):
            m = self._metric(api_client, acc)
            cnt = 0 if m is None else int(m["metrics"]["ticket_count"] or 0)
            assert cnt == 0, f"{acc} 不应计入运维分析归属，实际 {cnt}"

    def test_tc_m13_062_independent_closure_rate(self, api_client):
        # 工单A 无开发分析→独立闭环；工单B 经开发分析→非独立。2 张中 1 张独立 → 50%
        m = self._metric(api_client, "eff_ops_a")
        assert m["metrics"]["dev_ticket_count"] == 1
        assert abs(m["metrics"]["independent_closure_rate"] - 50.0) < 1e-6

    def test_tc_m13_063_sla_sums_four_stages(self, api_client):
        # 工单A SLA = 问题审核1h + 运维分析2h + 运维闭环3h = 6h（审核关闭停留不计）
        # 工单B SLA = 问题审核1h + 运维分析1h + 开发分析3h + 运维闭环4h = 9h
        # 平均 = (6 + 9) / 2 = 7.5h
        m = self._metric(api_client, "eff_ops_a")
        assert abs(m["metrics"]["sla_avg_hours"] - 7.5) < 1e-6


class TestOncallGroups:
    def test_tc_m13_070_list_groups(self, api_client):
        resp = api_client.get("/api/oncall-eva/groups")
        assert resp.status_code == 200
        groups = resp.json().get("groups")
        assert isinstance(groups, list)


@pytest.mark.usefixtures("seed_ops_efficiency")
class TestOncallGroupFilter:
    def test_tc_m13_071_seeded_group_in_options(self, api_client):
        groups = api_client.get("/api/oncall-eva/groups").json()["groups"]
        assert "ONCALL" in groups

    def test_tc_m13_072_scores_filtered_by_group(self, api_client):
        resp = api_client.get(
            "/api/oncall-eva/scores",
            params={"year": _EFF_YEAR, "month": _EFF_MONTH, "group_name": "ONCALL"},
        )
        assert resp.status_code == 200
        accs = {i["account"] for i in resp.json()["items"]}
        # 本组的运维分析归属人应在；非本组成员（admin/platform、test_user01/测试组）不应出现
        assert "eff_ops_a" in accs
        assert "admin" not in accs
        assert "test_user01" not in accs

    def test_tc_m13_073_no_group_includes_others(self, api_client):
        resp = api_client.get(
            "/api/oncall-eva/scores",
            params={"year": _EFF_YEAR, "month": _EFF_MONTH},
        )
        assert resp.status_code == 200
        accs = {i["account"] for i in resp.json()["items"]}
        # 不传组别时返回全部成员（至少包含本组成员），不被组别过滤限制
        assert "eff_ops_a" in accs


# —— R&D 组运维效率（规格 v2）：归属=开发分析最后处理人；SLA=仅开发分析停留；
#    非独立=开发分析协助人非空 或 开发分析有多个不同处理人 ——
_RND_PREFIX = "oeva_rnd_"
_RND_YEAR = 2099
_RND_MONTH = 4


def _rnd_t0():
    return datetime(_RND_YEAR, _RND_MONTH, 10, 0, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="class")
def seed_rnd_efficiency():
    """灌入 3 张工单验证 R&D 口径：
    - R1：开发分析仅 rnd_dev、无协助人、走到审核关闭(closed) → 独立
    - R2：开发分析先后 rnd_dev / rnd_dev2 两人、只走到运维闭环(open，不要求关闭) → 非独立(多人)
    - R3：开发分析仅 rnd_dev、但协助人字段非空 → 非独立(协助人)
    归属：R1/R3→rnd_dev，R2→rnd_dev2（开发分析最后提交人）。
    """
    import json
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过 R&D 运维效率测试")

    t0 = _rnd_t0()
    H = timedelta(hours=1)
    # (from_node, to_node, action, operator, created_at)
    tickets = {
        f"{_RND_PREFIX}R1": ("closed", [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "rnd_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "rnd_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "rnd_ops", t0 + 2 * H),
            (NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", "rnd_dev", t0 + 5 * H),
            (NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "rnd_closer", t0 + 9 * H),
        ], None),
        f"{_RND_PREFIX}R2": ("open", [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "rnd_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "rnd_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "rnd_ops", t0 + 2 * H),
            (NODE_DEV_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "rnd_dev", t0 + 4 * H),
            (NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", "rnd_dev2", t0 + 6 * H),
        ], None),
        f"{_RND_PREFIX}R3": ("closed", [
            (NODE_PROBLEM_FILL, NODE_PROBLEM_REVIEW, "submit", "rnd_filler", t0),
            (NODE_PROBLEM_REVIEW, NODE_OPS_ANALYSIS, "submit", "rnd_reviewer", t0 + 1 * H),
            (NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "rnd_ops", t0 + 2 * H),
            (NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", "rnd_dev", t0 + 5 * H),
            (NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "rnd_closer", t0 + 9 * H),
        ], "协助人甲"),  # 开发分析节点协助人非空
    }
    users_rnd = {"rnd_dev": "研发甲", "rnd_dev2": "研发乙"}
    users_other = {"rnd_filler": "填单员R", "rnd_reviewer": "审核员R", "rnd_ops": "运维R", "rnd_closer": "闭环员R"}

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_RND_PREFIX}%",),
        )
        conn.execute(
            "DELETE FROM ticket_node_data WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_RND_PREFIX}%",),
        )
        conn.execute(
            "DELETE FROM ticket_node_instance WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_RND_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_RND_PREFIX}%",))
        for acc, name in users_rnd.items():
            conn.execute(
                "INSERT INTO user_account (account, user_name, role_code, group_name, is_active) "
                "VALUES (%s, %s, '普通人员', 'R&D', TRUE) "
                "ON CONFLICT (account) DO UPDATE SET is_active = TRUE, group_name = 'R&D'",
                (acc, name),
            )
        for acc, name in users_other.items():
            conn.execute(
                "INSERT INTO user_account (account, user_name, role_code, group_name, is_active) "
                "VALUES (%s, %s, '普通人员', 'misc_rnd', TRUE) "
                "ON CONFLICT (account) DO UPDATE SET is_active = TRUE, group_name = 'misc_rnd'",
                (acc, name),
            )
        for ticket_no, (status, logs, collab) in tickets.items():
            conn.execute(
                "INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at) "
                "VALUES (%s, 1, %s, %s, 'rnd_filler', '填单员R', %s, %s)",
                (ticket_no, f"R&D效率测试 {ticket_no}", status, logs[0][4], logs[-1][4]),
            )
            tid = conn.execute(
                "SELECT currval(pg_get_serial_sequence('ticket','id')) AS id"
            ).fetchone()["id"]
            for fr, to, action, op, ts in logs:
                name = users_rnd.get(op) or users_other.get(op) or op
                conn.execute(
                    "INSERT INTO ticket_flow_log (ticket_id, from_node_id, to_node_id, action_type, "
                    "operator_id, operator_name, comment, created_at) VALUES (%s, %s, %s, %s, %s, %s, '', %s)",
                    (tid, fr, to, action, op, name, ts),
                )
            if collab is not None:
                conn.execute(
                    "INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, "
                    "action_status, started_at, ended_at) VALUES (%s, %s, 'rnd_dev', '研发甲', 'completed', %s, %s) "
                    "RETURNING id",
                    (tid, NODE_DEV_ANALYSIS, t0 + 2 * H, t0 + 5 * H),
                )
                niid = conn.execute("SELECT currval(pg_get_serial_sequence('ticket_node_instance','id')) AS id").fetchone()["id"]
                conn.execute(
                    "INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, "
                    "schema_snapshot, created_by, created_at) VALUES (%s, %s, %s::jsonb, '{}'::jsonb, 'rnd_dev', %s)",
                    (tid, niid, json.dumps({"collaborator": collab}), t0 + 5 * H),
                )
        conn.commit()

    yield

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.execute(
            "DELETE FROM ticket_node_data WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_RND_PREFIX}%",),
        )
        conn.execute(
            "DELETE FROM ticket_node_instance WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_RND_PREFIX}%",),
        )
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_RND_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_RND_PREFIX}%",))
        conn.execute("DELETE FROM user_account WHERE account LIKE %s", ("rnd_%",))
        conn.commit()


@pytest.mark.usefixtures("seed_rnd_efficiency")
class TestRndEfficiencyMetrics:
    def _metric(self, api_client, account):
        scores = api_client.get(
            "/api/oncall-eva/scores", params={"year": _RND_YEAR, "month": _RND_MONTH}
        ).json()
        return next((x for x in scores["items"] if x["account"] == account), None)

    def test_tc_m13_080_attribute_to_dev_analysis_handler(self, api_client):
        # 归属到开发分析最后提交人：rnd_dev 得 R1+R3=2 单，rnd_dev2 得 R2=1 单
        assert self._metric(api_client, "rnd_dev")["metrics"]["ticket_count"] == 2
        assert self._metric(api_client, "rnd_dev2")["metrics"]["ticket_count"] == 1

    def test_tc_m13_081_upstream_handlers_not_counted_as_rnd(self, api_client):
        # 运维分析处理人 rnd_ops（misc 组）不应作为 R&D 归属计入
        m = self._metric(api_client, "rnd_ops")
        cnt = 0 if m is None else int(m["metrics"]["ticket_count"] or 0)
        assert cnt == 0

    def test_tc_m13_082_independent_closure_collab_and_multidev(self, api_client):
        # rnd_dev：R1 独立 + R3 协助人非空(非独立) → 50%
        m = self._metric(api_client, "rnd_dev")
        assert m["metrics"]["dev_ticket_count"] == 1
        assert abs(m["metrics"]["independent_closure_rate"] - 50.0) < 1e-6
        # rnd_dev2：R2 开发分析多人(非独立) → 0%
        m2 = self._metric(api_client, "rnd_dev2")
        assert m2["metrics"]["dev_ticket_count"] == 1
        assert abs(m2["metrics"]["independent_closure_rate"] - 0.0) < 1e-6

    def test_tc_m13_083_sla_only_dev_analysis_stage(self, api_client):
        # R&D SLA 仅算开发分析停留：rnd_dev R1=3h、R3=3h → 平均 3h；rnd_dev2 R2 开发分析 2h+2h=4h
        assert abs(self._metric(api_client, "rnd_dev")["metrics"]["sla_avg_hours"] - 3.0) < 1e-6
        assert abs(self._metric(api_client, "rnd_dev2")["metrics"]["sla_avg_hours"] - 4.0) < 1e-6

    def test_tc_m13_084_reached_ops_closure_counts_without_close(self, api_client):
        # R2 未关闭(status open)、只走到运维闭环，也应计入（到了就算，不要求关闭）
        assert self._metric(api_client, "rnd_dev2")["metrics"]["ticket_count"] == 1

    def test_tc_m13_085_group_breakdown_present(self, api_client):
        scores = api_client.get(
            "/api/oncall-eva/scores", params={"year": _RND_YEAR, "month": _RND_MONTH}
        ).json()
        groups = scores["team"].get("groups") or {}
        assert "R&D" in groups
        assert groups["R&D"]["total_tickets"] == 3  # R1+R2+R3 各归一人，组内合计 3
