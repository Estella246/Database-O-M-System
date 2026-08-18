"""M21 改进报告（质量改进月度总结）接口测试。

覆盖：
- 草稿 CRUD：get_or_init 自动建骨架 / 分段保存 / 归档-取消归档 / 列表筛选 / 删除（含归档态 409）
- 四个只读聚合导入端点：overview（一句话+详细进展模板数字）、overall（KPI+4图）、
  domain（按责任田树二级模块）、monthly_new（本月新增表格行）
- 超期口径：started_at + SLA 小时；超期判定时点落月

数据隔离：本地 DENSE 演示数据全部落在 2026-07/08，本文件统一用 202506（2025 年 6 月）
作为报告月——YTD/月窗口均不含任何演示数据，聚合数字只由本文件种子决定。
依赖：后端需以 SKIP_SSO_AUTH=1 启动，TEST_API_BASE_URL 指向其端口。
"""
import json
import os
from datetime import datetime, timezone

import pytest

OP = "admin"

YM = "202506"
DOMAIN = "IR测试领域"
MODULE = "IR模块X"
RF_NAME = "IR测试田"
# 共田合并用例的独占命名（树/田/关联一并清理）
SH_DOMAIN = "IR共田领域"
SH_MODULE_1 = "IR共田模块一"
SH_MODULE_2 = "IR共田模块二"
SH_RF_NAME = "IR共田测试田"

# 迁移 0122 种子：propose=24/review=48/analysis=72/closure=336/acceptance=48
DEFAULT_SLA = {"propose": 24, "review": 48, "analysis": 72, "closure": 336, "acceptance": 48}

BASE = "/api/improvement-report"
# C2 后全部端点按 operator_id 校验 improvement_report 白名单：admin（OP）0121 已种 editable；test_user01 未种（hidden）作 403 反例
OPQ = f"operator_id={OP}"


# =====================================================================
# 种子工具
# =====================================================================
def _db():
    import psycopg
    dsn = os.environ["DATABASE_URL"]
    return psycopg.connect(dsn)


def _cleanup_all():
    """清掉本文件的报告/树/责任田/关联/诉求种子（幂等；删田级联清关联）。"""
    with _db() as conn:
        conn.execute("DELETE FROM improvement_report WHERE report_month=%s", (YM,))
        conn.execute("DELETE FROM research_duty_field WHERE name IN (%s,%s)", (RF_NAME, SH_RF_NAME))
        conn.execute(
            "DELETE FROM duty_field_node WHERE label IN (%s,%s,%s,%s,%s)",
            (DOMAIN, MODULE, SH_DOMAIN, SH_MODULE_1, SH_MODULE_2),
        )
        conn.execute("DELETE FROM qi_request WHERE qi_no LIKE 'TEST-IR-%'")
        conn.commit()


def _seed_request(conn, qi_no, *, created_at, stage, status, module_feature=MODULE,
                  domain=DOMAIN, category="质量加固和改进", priority="高", proposer="张三 zhangsan",
                  reviewer="赵六 test_zhao6"):
    """直插一条 qi_request（返回 id）。created_at 为 aware UTC。"""
    row = conn.execute(
        """INSERT INTO qi_request
           (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
            priority, domain, module_feature, reviewer, current_stage, current_status,
            creator_id, creator_name, created_at)
           VALUES (%s, %s, %s, %s, 'IR-REL-1', %s, '目标', %s, %s, %s, %s, %s, %s,
                   'admin', '管理员 admin', %s)
           RETURNING id""",
        (qi_no, category, proposer, f"{qi_no}标题", "<p>背景</p><p>建议</p>",
         priority, domain, module_feature, reviewer, stage, status, created_at),
    ).fetchone()
    return int(row[0])


def _seed_stage(conn, rid, stage_key, *, started_at=None, completed_at=None,
                status="completed", responsible=""):
    """直插一条 qi_stage 实例（started_at 非空约束：缺省给 1 小时前）。"""
    from datetime import timedelta
    if started_at is None:
        started_at = datetime.now(timezone.utc) - timedelta(hours=1)
    sid = int(conn.execute(
        """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at,
                                 completed_at, responsible)
           VALUES (%s, %s, 1, %s, %s, %s, %s) RETURNING id""",
        (rid, stage_key, status, started_at, completed_at, responsible),
    ).fetchone()[0])
    return sid


def _seed_data(conn, stage_key, rid, sid, values):
    conn.execute(
        """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
           VALUES (%s, %s, %s, %s::jsonb, FALSE, 'admin')""",
        (sid, rid, stage_key, json.dumps(values, ensure_ascii=False)),
    )


@pytest.fixture(scope="module", autouse=True)
def _qi_baseline(api_client):
    """全模块前置：默认五阶段 SLA + 解决版本种子（聚合超期口径依赖）。"""
    _cleanup_all()
    api_client.post("/api/qi/config/stage-sla", json={"stage_sla": dict(DEFAULT_SLA)})
    yield
    _cleanup_all()


@pytest.fixture(autouse=True)
def _report_guard():
    """每个用例前后清掉 YM 报告行（聚合只读端点不落库，但 CRUD 用例会写）。"""
    with _db() as conn:
        conn.execute("DELETE FROM improvement_report WHERE report_month=%s", (YM,))
        conn.commit()
    yield
    with _db() as conn:
        conn.execute("DELETE FROM improvement_report WHERE report_month=%s", (YM,))
        conn.commit()


@pytest.fixture()
def seed_full(api_client):
    """聚合测试数据集：2025-06 内 6 单 + 1 草稿。

    A1 06-05 闭环落 507.0，验收完成 06-20（本月闭环）   closed/acceptance
    A2 06-10 闭环落 507.1，验收完成 07-05（非本月闭环） closed/acceptance
    B1 06-02 确认(analysis)在途，started 06-01 → 06-04 超期（本月新增超期）
    B2 06-08 确认在途，started 1h 前 → 不超期
    C1 06-03 实施在途，started 06-01 → 06-15 超期（本月新增超期）；已接纳
    D1 06-15 评审在途，started 1h 前 → 不超期
    DR 06-25 草稿 → 一律排除
    责任田超期率 = (B1+C1 超期)/(B1+B2+C1 在途) = 2/3 ≈ 67%
    """
    june = lambda day, hour=0: datetime(2025, 6, day, hour, tzinfo=timezone.utc)  # noqa: E731
    with _db() as conn:
        # 责任田树：IR测试领域 / IR模块X（二级模块）
        root = int(conn.execute(
            "INSERT INTO duty_field_node (label, sort_order) VALUES (%s, 9998) RETURNING id",
            (DOMAIN,),
        ).fetchone()[0])
        conn.execute(
            "INSERT INTO duty_field_node (parent_id, label, sort_order) VALUES (%s, %s, 9999)",
            (root, MODULE),
        )
        # 在研责任田：田目录 + 模块关联（两层模型）
        rf_id = int(conn.execute(
            "INSERT INTO research_duty_field (name, owner, sort_order) VALUES (%s,%s,9997) RETURNING id",
            (RF_NAME, "责任田主 rftest"),
        ).fetchone()[0])
        conn.execute(
            "INSERT INTO research_duty_field_binding (field_id, domain, module) VALUES (%s,%s,%s)",
            (rf_id, DOMAIN, MODULE),
        )

        # A1：已闭环（accept_version=507.0，验收完成落在 6 月）
        a1 = _seed_request(conn, "TEST-IR-A1", created_at=june(5), stage="acceptance",
                           status="closed", proposer="张三 zhangsan")
        s = _seed_stage(conn, a1, "analysis", responsible="李四 lisi")
        _seed_data(conn, "analysis", a1, s, {"accept": "是"})
        s = _seed_stage(conn, a1, "closure", responsible="王五 wangwu")
        _seed_data(conn, "closure", a1, s, {"accept_version": "507.0"})
        _seed_stage(conn, a1, "acceptance", completed_at=june(20), responsible="张三 zhangsan")

        # A2：已闭环（accept_version=507.1，验收完成落在 7 月 → 不计入本月闭环）
        a2 = _seed_request(conn, "TEST-IR-A2", created_at=june(10), stage="acceptance",
                           status="closed", proposer="李四 lisi")
        s = _seed_stage(conn, a2, "analysis")
        _seed_data(conn, "analysis", a2, s, {"accept": "是"})
        s = _seed_stage(conn, a2, "closure")
        _seed_data(conn, "closure", a2, s, {"accept_version": "507.1"})
        _seed_stage(conn, a2, "acceptance",
                    completed_at=datetime(2025, 7, 5, tzinfo=timezone.utc))

        # B1：确认阶段在途，started 06-01 00:00 → 超期时点 06-04（72h）
        b1 = _seed_request(conn, "TEST-IR-B1", created_at=june(2), stage="analysis",
                           status="in_progress", category="性能优化", proposer="王五 wangwu")
        _seed_stage(conn, b1, "analysis", started_at=june(1), status="in_progress",
                    responsible="李四 lisi")

        # B2：确认阶段在途，started 1 小时前（<72h）→ 不超期
        b2 = _seed_request(conn, "TEST-IR-B2", created_at=june(8), stage="analysis",
                           status="in_progress", proposer="王五 wangwu")
        _seed_stage(conn, b2, "analysis", status="in_progress", responsible="李四 lisi")

        # C1：实施阶段在途，started 06-01 → 超期时点 06-15（336h）；已接纳
        c1 = _seed_request(conn, "TEST-IR-C1", created_at=june(3), stage="closure",
                           status="in_progress", proposer="张三 zhangsan")
        s = _seed_stage(conn, c1, "analysis", responsible="王五 wangwu")
        _seed_data(conn, "analysis", c1, s, {"accept": "是"})
        _seed_stage(conn, c1, "closure", started_at=june(1), status="in_progress",
                    responsible="王五 wangwu")

        # D1：评审在途，started_at 1 小时前（<48h SLA）→ 不超期
        _seed_request(conn, "TEST-IR-D1", created_at=june(15), stage="review",
                      status="in_progress", category="可靠性", proposer="赵六 test_zhao6")
        rid_d1 = int(conn.execute(
            "SELECT id FROM qi_request WHERE qi_no='TEST-IR-D1'").fetchone()[0])
        _seed_stage(conn, rid_d1, "review", status="in_progress")

        # 草稿：一律排除
        _seed_request(conn, "TEST-IR-DR", created_at=june(25), stage="propose",
                      status="draft")
        conn.commit()
    yield
    _cleanup_all()


# =====================================================================
# 草稿 CRUD
# =====================================================================
class TestImprovementReportCrud:
    def test_get_or_init_creates_skeleton(self, api_client):
        r = api_client.get(f"{BASE}/{YM}?{OPQ}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["report_month"] == YM
        assert d["status"] == "draft"
        assert d["title"] == f"{YM}改进报告"
        for k in ("section_overview", "section_overall", "section_domain", "section_monthly_new"):
            assert d[k] == {}, f"{k} 应为空对象"
        assert d["archived_at"] is None
        # 幂等：再取还是同一行
        d2 = api_client.get(f"{BASE}/{YM}?{OPQ}").json()
        assert d2["id"] == d["id"]

    def test_invalid_month_rejected(self, api_client):
        for bad in ("2026-13", "abcd", "2026080", "26-08"):
            r = api_client.get(f"{BASE}/{bad}?{OPQ}")
            assert r.status_code == 400, f"{bad} 应 400: {r.text}"

    def test_hidden_operator_forbidden_all_endpoints(self, api_client):
        """C2：improvement_report 默认隐藏，白名单 hidden/未配置的 operator 全端点 403（含深链直连）。"""
        hidden_q = "operator_id=test_user01"   # 0121 未种 → hidden
        no_auth_q = "operator_id="             # 缺省按默认策略，fail-closed
        for q in (hidden_q, no_auth_q):
            assert api_client.get(f"{BASE}/{YM}?{q}").status_code == 403
            assert api_client.get(f"{BASE}/{YM}/import/overview?{q}").status_code == 403
            assert api_client.put(f"{BASE}/{YM}/sections?{q}", json={"section": "overview", "data": {}}).status_code == 403
            assert api_client.post(f"{BASE}/{YM}/archive?{q}", json={"title": "x"}).status_code == 403
            assert api_client.delete(f"{BASE}/{YM}/archive?{q}").status_code == 403
            assert api_client.get(f"{BASE}?{q}").status_code == 403
            assert api_client.delete(f"{BASE}/{YM}?{q}").status_code == 403

    def test_update_section_roundtrip_all_four(self, api_client):
        payloads = {
            "overview": {"one_line": "一句话", "detail": "详细"},
            "overall": {"kpi": {"total": 1}, "domain_pie": []},
            "domain": {"modules": [{"module": "M"}]},
            "monthly_new": {"rows": [{"qi_no": "X"}]},
        }
        for section, data in payloads.items():
            r = api_client.put(f"{BASE}/{YM}/sections?{OPQ}", json={"section": section, "data": data})
            assert r.status_code == 200, r.text
        d = api_client.get(f"{BASE}/{YM}?{OPQ}").json()
        for section, data in payloads.items():
            assert d[f"section_{section}"] == data, f"{section} 保存后应可读回"

    def test_update_section_unknown_rejected(self, api_client):
        r = api_client.put(f"{BASE}/{YM}/sections?{OPQ}", json={"section": "nope", "data": {}})
        assert r.status_code == 400

    def test_archive_blocks_edit_and_delete(self, api_client):
        api_client.put(f"{BASE}/{YM}/sections?{OPQ}",
                       json={"section": "overview", "data": {"one_line": "x"}})
        # 归档（自定义标题）
        r = api_client.post(f"{BASE}/{YM}/archive?{OPQ}", json={"title": "自定义标题"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "archived"
        assert d["title"] == "自定义标题"
        assert d["archived_at"]
        # 归档后：改段 409、删报告 409
        r = api_client.put(f"{BASE}/{YM}/sections?{OPQ}",
                           json={"section": "overview", "data": {"one_line": "y"}})
        assert r.status_code == 409, r.text
        r = api_client.delete(f"{BASE}/{YM}?{OPQ}")
        assert r.status_code == 409, r.text
        # 取消归档后可改可删
        r = api_client.delete(f"{BASE}/{YM}/archive?{OPQ}")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "draft"
        assert r.json()["archived_at"] is None
        r = api_client.put(f"{BASE}/{YM}/sections?{OPQ}",
                           json={"section": "overview", "data": {"one_line": "y"}})
        assert r.status_code == 200, r.text

    def test_unarchive_not_found(self, api_client):
        r = api_client.delete(f"{BASE}/202512/archive?{OPQ}")
        assert r.status_code == 404, r.text

    def test_list_and_status_filter(self, api_client):
        api_client.get(f"{BASE}/{YM}?{OPQ}")  # 建 draft
        r = api_client.get(f"{BASE}?{OPQ}")
        assert r.status_code == 200, r.text
        months = [x["report_month"] for x in r.json()["items"]]
        assert YM in months
        # draft 筛选含 YM；archived 筛选不含
        assert YM in [x["report_month"] for x in api_client.get(BASE, params={"operator_id": OP, "status": "draft"}).json()["items"]]
        assert YM not in [x["report_month"] for x in api_client.get(BASE, params={"operator_id": OP, "status": "archived"}).json()["items"]]
        r = api_client.get(BASE, params={"operator_id": OP, "status": "bogus"})
        assert r.status_code == 400

    def test_delete_report(self, api_client):
        api_client.get(f"{BASE}/{YM}?{OPQ}")
        r = api_client.delete(f"{BASE}/{YM}?{OPQ}")
        assert r.status_code == 200, r.text
        d = api_client.get(f"{BASE}/{YM}?{OPQ}").json()
        assert d["section_overview"] == {}  # 删除后再取是重建的空骨架
        months = [x["report_month"] for x in api_client.get(f"{BASE}?{OPQ}").json()["items"]]
        assert YM not in months or api_client.get(f"{BASE}/{YM}?{OPQ}").json()["section_overview"] == {}

    def test_import_unknown_section_rejected(self, api_client):
        r = api_client.get(f"{BASE}/{YM}/import/nope?{OPQ}")
        assert r.status_code == 400, r.text


# =====================================================================
# 聚合导入：一、整体概况
# =====================================================================
class TestImportOverview:
    def test_overview_numbers(self, api_client, seed_full):
        r = api_client.get(f"{BASE}/{YM}/import/overview?{OPQ}")
        assert r.status_code == 200, r.text
        d = r.json()
        ytd = d["ytd"]
        # YTD：总数 6（草稿排除）、接纳 3（A1/A2/C1）、闭环 2（A1/A2，版本各 1）
        assert ytd["total"] == 6, f"total: {ytd}"
        assert ytd["accepted"] == 3, f"accepted: {ytd}"
        assert ytd["closed_done"] == 2, f"closed_done: {ytd}"
        assert {x["name"]: x["value"] for x in ytd["by_version"]} == {"507.0": 1, "507.1": 1}, \
            f"by_version: {ytd['by_version']}"
        # 超期：B1(确认)+C1(实施) = 2，全部归 IR测试田；B2/D1 未超期不计
        assert ytd["overdue"] == 2, f"overdue: {ytd}"
        assert ytd["overdue_by_field"] == [{"name": RF_NAME, "value": 2}], \
            f"overdue_by_field: {ytd['overdue_by_field']}"
        # 一句话模板包含关键数字
        assert "累计识别现网改进诉求6条" in d["one_line"], d["one_line"]
        assert "3条已接纳" in d["one_line"]
        assert "2条已实施闭环" in d["one_line"]
        assert "507.0版本1条" in d["one_line"]
        assert "2条超期" in d["one_line"]
        assert RF_NAME in d["one_line"]

        m = d["month"]
        assert m["label"] == "2025年6月"
        assert m["new_count"] == 6, f"new_count: {m}"
        cats = {x["name"]: x["value"] for x in m["new_by_category"]}
        assert cats.get("质量加固和改进") == 4 and cats.get("性能优化") == 1 and cats.get("可靠性") == 1, cats
        assert m["top_modules"][0]["name"].startswith(f"{DOMAIN}/{MODULE}"), m["top_modules"]
        # 本月闭环：A1（验收完成 6/20）→ IR测试田 1 条；A2 落 7 月不计
        assert m["closed_count"] == 1, f"closed_count: {m}"
        assert m["closed_by_field"] == [{"name": RF_NAME, "value": 1}], m["closed_by_field"]
        # 本月新增超期：B1（06-04）+ C1（06-15）→ 2 条归田
        assert m["overdue_new"] == 2, f"overdue_new: {m}"
        assert m["overdue_new_by_field"] == [{"name": RF_NAME, "value": 2}], m["overdue_new_by_field"]
        # 详细进展模板
        assert "2025年6月" in d["detail"]
        assert "新增改进诉求6条" in d["detail"]
        assert f"责任田{RF_NAME}有1条" in d["detail"], d["detail"]

    def test_overview_empty_month(self, api_client):
        """无数据的月份：零值 + 模板兜底文案。"""
        r = api_client.get(f"{BASE}/202503/import/overview?{OPQ}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ytd"]["total"] == 0 and d["ytd"]["accepted"] == 0 and d["ytd"]["overdue"] == 0
        assert d["ytd"]["by_version"] == []
        assert d["month"]["new_count"] == 0
        assert "累计识别现网改进诉求0条" in d["one_line"]

    def test_overview_closed_count_counts_unbucketed(self, api_client, seed_full):
        """C5：月度「新增闭环诉求N条」与 YTD closed_done 同源（全量当月闭环数）——
        桶外（责任田未关联领域）的闭环单计入 closed_count/详细进展 N，但不进 closed_by_field。"""
        june = lambda day, hour=0: datetime(2025, 6, day, hour, tzinfo=timezone.utc)  # noqa: E731
        with _db() as conn:
            # 桶外闭环单：领域不在任何责任田关联里，验收完成落 6 月
            ub = _seed_request(conn, "TEST-IR-UB1", created_at=june(12), stage="acceptance",
                               status="closed", domain="IR桶外领域", module_feature="IR桶外模块")
            s = _seed_stage(conn, ub, "analysis", responsible="李四 lisi")
            _seed_data(conn, "analysis", ub, s, {"accept": "是"})
            s = _seed_stage(conn, ub, "closure", responsible="王五 wangwu")
            _seed_data(conn, "closure", ub, s, {"accept_version": "508.0"})
            _seed_stage(conn, ub, "acceptance", completed_at=june(18), responsible="张三 zhangsan")
            conn.commit()
        r = api_client.get(f"{BASE}/{YM}/import/overview?{OPQ}")
        assert r.status_code == 200, r.text
        d = r.json()
        m = d["month"]
        # A1（桶内 6/20）+ UB1（桶外 6/18）→ 全量口径 2；桶内分布仍只有 IR测试田 1
        assert m["closed_count"] == 2, f"closed_count 应为全量当月闭环数: {m}"
        assert m["closed_by_field"] == [{"name": RF_NAME, "value": 1}], m["closed_by_field"]
        assert "新增闭环诉求2条" in d["detail"], d["detail"]
        # YTD 同源：closed_done 也含桶外单（A1+A2+UB1 = 3）
        assert d["ytd"]["closed_done"] == 3, d["ytd"]


# =====================================================================
# 聚合导入：二、质量改进整体分析
# =====================================================================
class TestImportOverall:
    def test_overall_kpi_and_charts(self, api_client, seed_full):
        r = api_client.get(f"{BASE}/{YM}/import/overall?{OPQ}")
        assert r.status_code == 200, r.text
        d = r.json()
        k = d["kpi"]
        assert k["total"] == 6 and k["analyzed"] == 3 and k["accepted"] == 3
        assert k["closed_done"] == 2 and k["in_progress"] == 4 and k["overdue"] == 2
        assert k["month_new"] == 6
        assert k["accept_rate"] == 100, k
        assert k["closure_rate"] == 67, k          # round(2/3*100)
        assert k["overdue_rate"] == 50.0, k        # round(2/4*100, 1)
        assert "整体接纳率100%" in k["summary"] and "闭环率67%" in k["summary"]
        # 领域饼：只有 IR测试领域 6 条
        assert d["domain_pie"] == [{"name": DOMAIN, "value": 6}], d["domain_pie"]
        # 阶段饼：确认2/实施1/验收2/评审1/提出0
        stage = {x["name"]: x["value"] for x in d["stage_pie"]}
        assert stage.get("确认") == 2 and stage.get("实施") == 1
        assert stage.get("验收") == 2 and stage.get("评审") == 1 and stage.get("提出") == 0, stage
        # 责任田接纳率/超期率图：IR测试田 100% / 67%（(1+1)/(2+1) 四舍五入）
        assert d["rf_accept_rate"] == [{"name": RF_NAME, "value": 100}], d["rf_accept_rate"]
        assert d["rf_overdue_rate"] == [{"name": RF_NAME, "value": 67}], d["rf_overdue_rate"]
        # research_field_stats 原始桶（两层模型：一行=一田，domain=关联合并文本）
        rf = {x["name"]: x for x in d["research_field_stats"]}
        st = rf[RF_NAME]
        assert st["domain"] == f"{DOMAIN}/{MODULE}" and st["module"] == "", st
        assert (st["analysis_total"], st["analysis_overdue"], st["closure_total"], st["closure_overdue"]) == (2, 1, 1, 1), st
        assert st["overdue_rate"] == 67 and st["accept_rate"] == 100


# =====================================================================
# 聚合导入：三、质量改进领域分析
# =====================================================================
class TestImportDomain:
    def test_domain_modules(self, api_client, seed_full):
        r = api_client.get(f"{BASE}/{YM}/import/domain?{OPQ}")
        assert r.status_code == 200, r.text
        mods = {m["module"]: m for m in r.json()["modules"]}
        assert MODULE in mods, f"二级模块 {MODULE} 应输出: {list(mods)}"
        m = mods[MODULE]
        assert m["domain"] == DOMAIN
        assert m["total"] == 6, m
        stage = {x["name"]: x["value"] for x in m["stage_pie"]}
        # 阶段名中文（与第二段 stage_pie 的 _stage_cn 口径一致）
        assert stage.get("确认") == 2 and stage.get("实施") == 1 and stage.get("评审") == 1, stage
        cats = {x["name"]: x["value"] for x in m["category_pie"]}
        assert cats.get("质量加固和改进") == 4
        # 用户提交（取「姓名 账号」的姓名）：张三2/李四1/王五2/赵六1
        subs = {x["name"]: x["value"] for x in m["user_submission"]}
        assert subs == {"张三": 2, "李四": 1, "王五": 2, "赵六": 1}, subs
        # 接纳率：张三 2 提 2 接 100%、李四 1/1 100%
        acc = {x["name"]: x["value"] for x in m["user_accept_rate"]}
        assert acc.get("张三") == 100 and acc.get("李四") == 100, acc
        # 每人待处理：B1/B2 确认→李四×2、C1 实施→王五、D1 评审→赵六
        pend = {x["name"]: x["value"] for x in m["handler_pending"]}
        assert pend == {"李四": 2, "王五": 1, "赵六": 1}, pend
        # 模块三率：接纳率 100%（3/3）、闭环率 67%（2/3）、超期率 67%（(1+1)/(2+1)）
        assert m["rf"]["name"] == RF_NAME, m["rf"]
        assert m["rf"]["accept_rate"] == 100 and m["rf"]["closure_rate"] == 67
        assert m["rf"]["overdue_rate"] == 67, m["rf"]
        # 输出覆盖当前树的全部二级模块（m07 树整替测试可能把存量树换成 L1/L2，
        # 故从 DB 实时取期望集），且非本测试种子模块计数为 0（2025 窗口隔离）
        with _db() as conn:
            tree_mods = [(str(r[0]), str(r[1])) for r in conn.execute(
                """SELECT p.label AS domain, c.label AS module
                   FROM duty_field_node c JOIN duty_field_node p ON p.id = c.parent_id
                   WHERE p.parent_id IS NULL"""
            ).fetchall()]
        assert (DOMAIN, MODULE) in tree_mods, "种子二级模块应在树里"
        out_set = set((m["domain"], m["module"]) for m in mods.values())
        assert out_set == set(tree_mods), f"输出应等于树的全部二级模块: {set(tree_mods) ^ out_set}"
        for m in mods.values():
            if (m["domain"], m["module"]) != (DOMAIN, MODULE):
                assert m["total"] == 0, f"{m['domain']}/{m['module']} 应为 0: {m}"


# =====================================================================
# 聚合导入：多模块共田（不同责任田模块对应同一在研责任田，统计按田合并）
# =====================================================================
class TestImportSharedField:
    def test_shared_field_merged_by_field(self, api_client):
        """两个模块槽位绑同一田：by_field/率图/原始桶均按田合并，领域页两模块行都指向该田。"""
        june = lambda day, hour=0: datetime(2025, 6, day, hour, tzinfo=timezone.utc)  # noqa: E731
        _cleanup_all()
        with _db() as conn:
            # 树：IR共田领域 / 模块一 + 模块二
            root = int(conn.execute(
                "INSERT INTO duty_field_node (label, sort_order) VALUES (%s, 9996) RETURNING id",
                (SH_DOMAIN,),
            ).fetchone()[0])
            for i, mod in enumerate((SH_MODULE_1, SH_MODULE_2)):
                conn.execute(
                    "INSERT INTO duty_field_node (parent_id, label, sort_order) VALUES (%s,%s,%s)",
                    (root, mod, 9995 - i),
                )
            # 一个田绑两个模块槽位
            fid = int(conn.execute(
                "INSERT INTO research_duty_field (name, owner, sort_order) VALUES (%s,%s,9994) RETURNING id",
                (SH_RF_NAME, "共田主 sftest"),
            ).fetchone()[0])
            for mod in (SH_MODULE_1, SH_MODULE_2):
                conn.execute(
                    "INSERT INTO research_duty_field_binding (field_id, domain, module) VALUES (%s,%s,%s)",
                    (fid, SH_DOMAIN, mod),
                )

            # R1（模块一）：已闭环，验收完成 6/20 → 本月闭环 1、接纳 1
            r1 = _seed_request(conn, "TEST-IR-S1", created_at=june(5), stage="acceptance",
                               status="closed", domain=SH_DOMAIN, module_feature=SH_MODULE_1)
            s = _seed_stage(conn, r1, "analysis", responsible="李四 lisi")
            _seed_data(conn, "analysis", r1, s, {"accept": "是"})
            s = _seed_stage(conn, r1, "closure", responsible="王五 wangwu")
            _seed_data(conn, "closure", r1, s, {"accept_version": "507.0"})
            _seed_stage(conn, r1, "acceptance", completed_at=june(20), responsible="张三 zhangsan")

            # R2（模块二）：确认在途，started 06-01 → 06-04 超期（72h）
            r2 = _seed_request(conn, "TEST-IR-S2", created_at=june(2), stage="analysis",
                               status="in_progress", domain=SH_DOMAIN, module_feature=SH_MODULE_2)
            _seed_stage(conn, r2, "analysis", started_at=june(1), status="in_progress",
                        responsible="李四 lisi")

            # R3（模块一）：实施在途不超期（started 1h 前）、已接纳 → 闭环分母 1
            r3 = _seed_request(conn, "TEST-IR-S3", created_at=june(3), stage="closure",
                               status="in_progress", domain=SH_DOMAIN, module_feature=SH_MODULE_1)
            s = _seed_stage(conn, r3, "analysis", responsible="王五 wangwu")
            _seed_data(conn, "analysis", r3, s, {"accept": "是"})
            _seed_stage(conn, r3, "closure", status="in_progress", responsible="王五 wangwu")
            conn.commit()

        try:
            ov = api_client.get(f"{BASE}/{YM}/import/overview?{OPQ}").json()
            m = ov["month"]
            assert m["closed_count"] == 1, m
            assert m["closed_by_field"] == [{"name": SH_RF_NAME, "value": 1}], m["closed_by_field"]
            assert m["overdue_new"] == 1, m
            assert m["overdue_new_by_field"] == [{"name": SH_RF_NAME, "value": 1}], m["overdue_new_by_field"]
            assert ov["ytd"]["overdue_by_field"] == [{"name": SH_RF_NAME, "value": 1}], ov["ytd"]

            al = api_client.get(f"{BASE}/{YM}/import/overall?{OPQ}").json()
            # 单田合并：接纳率 2/2=100%、超期率 (1+0)/(1+1)=50
            assert al["rf_accept_rate"] == [{"name": SH_RF_NAME, "value": 100}], al["rf_accept_rate"]
            assert al["rf_overdue_rate"] == [{"name": SH_RF_NAME, "value": 50}], al["rf_overdue_rate"]
            st = {x["name"]: x for x in al["research_field_stats"]}[SH_RF_NAME]
            assert st["domain"] == f"{SH_DOMAIN}/{SH_MODULE_1}、{SH_DOMAIN}/{SH_MODULE_2}", st
            assert st["module"] == "", st
            assert (st["analysis_total"], st["analysis_overdue"], st["closure_total"], st["closure_overdue"]) == (1, 1, 1, 0), st

            # 领域页：两个模块行各自计数，rf 都指向同一个田
            dm = api_client.get(f"{BASE}/{YM}/import/domain?{OPQ}").json()
            mods = {mm["module"]: mm for mm in dm["modules"]}
            assert mods[SH_MODULE_1]["total"] == 2 and mods[SH_MODULE_2]["total"] == 1, mods
            assert mods[SH_MODULE_1]["rf"]["name"] == SH_RF_NAME, mods[SH_MODULE_1]["rf"]
            assert mods[SH_MODULE_2]["rf"]["name"] == SH_RF_NAME, mods[SH_MODULE_2]["rf"]
        finally:
            _cleanup_all()


# =====================================================================
# 聚合导入：四、本月新增改进诉求
# =====================================================================
class TestImportMonthlyNew:
    def test_monthly_new_rows(self, api_client, seed_full):
        r = api_client.get(f"{BASE}/{YM}/import/monthly_new?{OPQ}")
        assert r.status_code == 200, r.text
        rows = r.json()["rows"]
        nos = [x["qi_no"] for x in rows]
        # 6 单按 id 升序；草稿 TEST-IR-DR 不在
        assert nos == ["TEST-IR-A1", "TEST-IR-A2", "TEST-IR-B1", "TEST-IR-B2", "TEST-IR-C1", "TEST-IR-D1"], nos
        a1 = rows[0]
        assert a1["title"] == "TEST-IR-A1标题"
        assert a1["description"] == "背景\n建议", f"HTML 应转纯文本: {a1['description']!r}"
        assert a1["priority"] == "高" and a1["domain"] == DOMAIN
        assert a1["proposer"] == "张三 zhangsan"
        # 列集合 = 需求 6 列
        assert set(a1.keys()) == {"qi_no", "title", "description", "priority", "domain", "proposer"}
