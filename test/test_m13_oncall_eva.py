"""M13 oncall 评议接口测试。

覆盖：
- /api/oncall-eva/config 公共规则
- /api/oncall-eva/scores 综合得分
- 加分项：申报、查询、审批（含优秀拉满）、撤回
- 红黑事件：录入、查询、删除、权限校验
"""
from datetime import datetime

import pytest


# admin 用户由 0010_add_rbac_tables.sql 默认 seed (account=admin, is_pl=true)
ADMIN_OP = "admin"
USER_OP = "test_user01"


def _now_period():
    n = datetime.utcnow()
    return n.year, n.month


@pytest.fixture(scope="module", autouse=True)
def _ensure_user_for_oncall(api_client):
    api_client.post("/api/admin/users/bulk", json={
        "items": [
            {"account": ADMIN_OP, "user_name": "管理员", "role_code": "admin", "group_name": "platform", "is_pl": True, "is_active": True},
            {"account": USER_OP, "user_name": "测试用户01", "role_code": "普通人员", "group_name": "测试组", "is_pl": False, "is_active": True},
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
