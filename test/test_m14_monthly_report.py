"""M14 现网重大问题月度分析报告接口测试。

覆盖：
- GET /api/monthly-report/{ym}        载入或自动初始化草稿
- PUT /api/monthly-report/{ym}/sections   分段保存（5 个段）
- POST /api/monthly-report/{ym}/archive   归档
- DELETE /api/monthly-report/{ym}/archive 取消归档
- DELETE /api/monthly-report/{ym}         草稿可删，归档不可删
- GET /api/monthly-report                 列表，可按 status 过滤
- 月份格式校验
- 已归档状态下编辑被拒绝
"""
from __future__ import annotations

import pytest


def _ym(year: int, month: int) -> str:
    return f"{year:04d}{month:02d}"


@pytest.fixture(scope="module")
def fresh_ym(api_client):
    """选取一个不易冲突的月份并清理后重新创建。"""
    candidates = ["209901", "209902", "209903"]
    chosen = None
    for ym in candidates:
        try:
            api_client.delete(f"/api/monthly-report/{ym}/archive")
        except Exception:
            pass
        api_client.delete(f"/api/monthly-report/{ym}")
        chosen = ym
        break
    yield chosen
    api_client.delete(f"/api/monthly-report/{chosen}/archive")
    api_client.delete(f"/api/monthly-report/{chosen}")


class TestMonthlyReportLoad:
    def test_tc_m14_001_get_initializes_draft(self, api_client, fresh_ym):
        resp = api_client.get(f"/api/monthly-report/{fresh_ym}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["report_month"] == fresh_ym
        assert body["status"] == "draft"
        # 5 段 JSON 字段都存在
        for col in ("section_overview", "section_insight", "section_major", "section_improve", "section_links"):
            assert col in body

    def test_tc_m14_002_get_idempotent(self, api_client, fresh_ym):
        a = api_client.get(f"/api/monthly-report/{fresh_ym}").json()
        b = api_client.get(f"/api/monthly-report/{fresh_ym}").json()
        assert a["report_month"] == b["report_month"]
        assert a["created_at"] == b["created_at"]

    def test_tc_m14_003_invalid_month_format(self, api_client):
        for bad in ("20260", "2026-04", "abcdef", "202613"):
            resp = api_client.get(f"/api/monthly-report/{bad}")
            assert resp.status_code == 400, bad


class TestMonthlyReportSectionSave:
    def test_tc_m14_010_save_overview(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "overview",
            "data": {
                "major_events": "test-events",
                "problem_analysis": "test-analysis",
                "risk_modules": "test-risk",
                "quality_feedback": "test-feedback",
            },
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["section_overview"]["major_events"] == "test-events"

    def test_tc_m14_011_save_insight_with_charts(self, api_client, fresh_ym):
        payload = {
            "section": "insight",
            "data": {
                "kpi": {"total_count": 100, "known_count": 60, "new_count": 40, "pansh_count": 20, "pansh_total": 80},
                "known_ratio": [{"name": "已知", "value": 60}, {"name": "新发现", "value": 40}],
                "pansh_ratio": [{"name": "磐石", "value": 20}, {"name": "非磐石", "value": 60}],
                "impact_categories": [{"name": "性能", "value": 30}],
                "top_modules": [{"name": "SQL", "value": 25}],
                "top1_breakdown": [{"name": "子项A", "value": 10}],
                "top2_breakdown": [{"name": "子项A", "value": 8}],
            },
        }
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json=payload)
        assert resp.status_code == 200
        assert resp.json()["section_insight"]["kpi"]["total_count"] == 100

    def test_tc_m14_012_save_major_5_types(self, api_client, fresh_ym):
        types = {
            "fatal": [{"序号": "1", "DTS单号": "DTS001"}],
            "severe": [],
            "normal": [],
            "escalation": [{"序号": "1", "备注": "升级到P0"}],
            "incident": [],
        }
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "major", "data": {"types": types},
        })
        assert resp.status_code == 200
        body = resp.json()["section_major"]
        assert body["types"]["fatal"][0]["DTS单号"] == "DTS001"
        assert body["types"]["escalation"][0]["备注"] == "升级到P0"

    def test_tc_m14_013_save_improve(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "improve",
            "data": {
                "module_distribution": [{"name": "SQL", "value": 12}],
                "sql_items": [{"name": "执行计划稳定性", "value": 6}],
                "storage_items": [{"name": "压缩", "value": 3}],
                "new_requests": [{"序号": "1", "模块": "SQL", "改进诉求": "优化器", "提出人": "张三", "状态": "待评估"}],
            },
        })
        assert resp.status_code == 200
        assert resp.json()["section_improve"]["new_requests"][0]["模块"] == "SQL"

    def test_tc_m14_014_save_links(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "links",
            "data": {"items": [{"name": "在线明细", "url": "http://example.com/sheet/1"}]},
        })
        assert resp.status_code == 200
        assert resp.json()["section_links"]["items"][0]["url"] == "http://example.com/sheet/1"

    def test_tc_m14_015_unknown_section_rejected(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "bogus", "data": {},
        })
        assert resp.status_code == 400


class TestMonthlyReportArchive:
    def test_tc_m14_020_archive(self, api_client, fresh_ym):
        resp = api_client.post(f"/api/monthly-report/{fresh_ym}/archive", json={"title": ""})
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "archived"
        assert body["archived_at"] is not None
        assert body["title"]  # 默认填 "{ym}月报"

    def test_tc_m14_021_archived_section_not_editable(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "overview", "data": {"major_events": "x"},
        })
        assert resp.status_code == 409

    def test_tc_m14_022_archived_cannot_delete(self, api_client, fresh_ym):
        resp = api_client.delete(f"/api/monthly-report/{fresh_ym}")
        assert resp.status_code == 409

    def test_tc_m14_023_unarchive(self, api_client, fresh_ym):
        resp = api_client.delete(f"/api/monthly-report/{fresh_ym}/archive")
        assert resp.status_code == 200
        assert resp.json()["status"] == "draft"
        # 解除归档后重新可保存
        resp2 = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "overview", "data": {"major_events": "after-unarchive"},
        })
        assert resp2.status_code == 200


class TestMonthlyReportList:
    def test_tc_m14_030_list_contains_current(self, api_client, fresh_ym):
        # 重新归档以验证 status 过滤
        api_client.post(f"/api/monthly-report/{fresh_ym}/archive", json={"title": ""})
        resp = api_client.get("/api/monthly-report?status=archived")
        assert resp.status_code == 200
        items = resp.json()["items"]
        months = [it["report_month"] for it in items]
        assert fresh_ym in months

    def test_tc_m14_031_list_status_invalid(self, api_client):
        resp = api_client.get("/api/monthly-report?status=foo")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 导入：从本月工单聚合计算 问题透视 / 重大问题
# ---------------------------------------------------------------------------

import os
from datetime import datetime, timedelta, timezone

# 0001_init_workflow_schema.sql 固定节点 id（template_id=1，HCS_INCIDENT）
_N_PROBLEM_FILL = 1
_N_OPS_ANALYSIS = 3
_N_DEV_ANALYSIS = 4

_IMP_YM = "209907"  # Asia/Shanghai 归月用的未来月，避免与真实/其它测试数据冲突
_IMP_PREFIX = "mr_imp_"


def _imp_t0():
    # 15 日 UTC，加 8h 仍落在 2099-07，确保 Asia/Shanghai 归月为 209907
    return datetime(2099, 7, 15, 0, 0, 0, tzinfo=timezone.utc)


def _imp_insert_node(conn, tid, node_id, values, created_at):
    from psycopg.types.json import Json
    conn.execute(
        """
        INSERT INTO ticket_node_instance (ticket_id, node_id, action_status, started_at, created_at)
        VALUES (%s, %s, 'completed', %s, %s)
        """,
        (tid, node_id, created_at, created_at),
    )
    iid = conn.execute(
        "SELECT currval(pg_get_serial_sequence('ticket_node_instance','id')) AS id"
    ).fetchone()["id"]
    conn.execute(
        """
        INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, created_by, created_at)
        VALUES (%s, %s, %s, 'seed', %s)
        """,
        (tid, iid, Json(values), created_at),
    )


def _imp_seed_ticket(conn, ticket_no, *, component, quality, issue_type, intro_module,
                     dts, root_cause_category, event_level, location, gauss_version,
                     issue_desc, root_cause, kernel_upgrade):
    t0 = _imp_t0()
    H = timedelta(hours=1)
    conn.execute(
        """
        INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at)
        VALUES (%s, 1, %s, 'closed', 'seed', '填单', %s, %s)
        """,
        (ticket_no, f"导入测试 {ticket_no}", t0, t0 + 5 * H),
    )
    tid = conn.execute("SELECT currval(pg_get_serial_sequence('ticket','id')) AS id").fetchone()["id"]
    # 问题填写
    _imp_insert_node(conn, tid, _N_PROBLEM_FILL, {"location": location}, t0)
    # 运维分析：承载大部分字段
    _imp_insert_node(conn, tid, _N_OPS_ANALYSIS, {
        "component": component, "issue_type": issue_type, "issue_intro_module": intro_module,
        "root_cause_category": root_cause_category, "event_level": event_level,
        "location": location, "gauss_version": gauss_version, "issue_desc": issue_desc,
        "kernel_upgrade_involved": kernel_upgrade,
    }, t0 + 2 * H)
    # 开发分析：是否质量问题 / DTS / 问题根因（流程后出现，取这里的值）
    _imp_insert_node(conn, tid, _N_DEV_ANALYSIS, {
        "is_quality_issue": quality, "dts_no": dts, "root_cause": root_cause,
    }, t0 + 4 * H)
    return tid


@pytest.fixture(scope="class")
def seed_import_tickets():
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过导入聚合测试")

    KNOWN = "是（已知质量问题）"
    NEW = "是（新发现质量问题）"

    def _cleanup(conn):
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_IMP_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_IMP_PREFIX}%",))

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _cleanup(conn)
        # T1 coredump 已知 事故   引入 SQL引擎/优化器/代价估算  根因分类=代码缺陷
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}1", component="内核问题", quality=KNOWN,
                         issue_type="coredump", intro_module="SQL引擎/优化器/代价估算",
                         dts="DTS-1", root_cause_category="代码缺陷", event_level="事故",
                         location="北京", gauss_version="V2",
                         issue_desc="<p>core 了</p>", root_cause="<p>空指针</p>", kernel_upgrade="否")
        # T2 coredump 新发现 一般问题(非重大) 引入 SQL引擎/执行器  根因=设计缺陷
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}2", component="内核问题", quality=NEW,
                         issue_type="coredump", intro_module="SQL引擎/执行器",
                         dts="DTS-2", root_cause_category="设计缺陷", event_level="一般问题",
                         location="上海", gauss_version="V2",
                         issue_desc="再次 core", root_cause="并发竞争", kernel_upgrade="否")
        # T3 满 已知 P1-P3事件 引入 存储引擎/空间管理 根因=容量规划
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}3", component="内核问题", quality=KNOWN,
                         issue_type="满", intro_module="存储引擎/空间管理",
                         dts="DTS-3", root_cause_category="容量规划", event_level="P1-P3事件",
                         location="广州", gauss_version="V3",
                         issue_desc="磁盘满", root_cause="未回收", kernel_upgrade="否")
        # T4 慢 已知 管理升级预警 引入 SQL引擎/优化器/统计信息
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}4", component="内核问题", quality=KNOWN,
                         issue_type="慢", intro_module="SQL引擎/优化器/统计信息",
                         dts="DTS-4", root_cause_category="统计信息缺失", event_level="管理升级预警",
                         location="深圳", gauss_version="V3",
                         issue_desc="查询慢", root_cause="计划差", kernel_upgrade="否")
        # T5 集群状态异常(未命中类型) 已知 已管理升级 涉及内核升级=是 → 升级组
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}5", component="内核问题", quality=KNOWN,
                         issue_type="集群状态异常", intro_module="管控/升级模块",
                         dts="DTS-5", root_cause_category="升级流程", event_level="已管理升级",
                         location="杭州", gauss_version="V3",
                         issue_desc="升级后异常", root_cause="脚本缺陷", kernel_upgrade="是")
        # T6 非内核（管控问题）→ 不计入
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}6", component="管控问题", quality=KNOWN,
                         issue_type="coredump", intro_module="管控/A",
                         dts="DTS-6", root_cause_category="代码缺陷", event_level="事故",
                         location="成都", gauss_version="V2",
                         issue_desc="x", root_cause="y", kernel_upgrade="否")
        # T7 内核但非质量问题 → 不计入
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}7", component="内核问题", quality="否",
                         issue_type="满", intro_module="存储引擎/空间管理",
                         dts="DTS-7", root_cause_category="容量规划", event_level="事故",
                         location="武汉", gauss_version="V2",
                         issue_desc="x", root_cause="y", kernel_upgrade="否")
        # T8 coredump 已知 事故 与 T1 同 DTS-1（验证去重 / 重大问题不去重）
        _imp_seed_ticket(conn, f"{_IMP_PREFIX}8", component="内核问题", quality=KNOWN,
                         issue_type="coredump", intro_module="SQL引擎/优化器/代价估算",
                         dts="DTS-1", root_cause_category="代码缺陷", event_level="事故",
                         location="北京2", gauss_version="V2",
                         issue_desc="core 了2", root_cause="空指针2", kernel_upgrade="否")
        conn.commit()
    yield
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _cleanup(conn)
        conn.commit()


def _by_name(items):
    return {it["name"]: it["value"] for it in items}


@pytest.mark.usefixtures("seed_import_tickets")
class TestMonthlyReportImportInsight:
    def test_tc_m14_040_kpi(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/insight").json()
        kpi = body["kpi"]
        # 内核质量问题：T1,T2,T3,T4,T5,T8 = 6（T6 非内核、T7 非质量被排除）
        assert kpi["total_count"] == 6
        assert kpi["known_count"] == 5   # 仅 T2 为新发现
        assert kpi["new_count"] == 1
        assert kpi["pansh_count"] == 0 and kpi["pansh_total"] == 0

    def test_tc_m14_041_impact_categories_dedup_by_dts(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/insight").json()
        m = _by_name(body["impact_categories"])
        # coredump: T1,T8 同 DTS-1 去重 + T2 DTS-2 = 2
        assert m["coredump"] == 2
        assert m["满"] == 1
        assert m["慢"] == 1
        assert m["集群状态异常"] == 1
        assert m["数据不一致"] == 0 and m["hang"] == 0
        # 仅这 6 种类型
        assert set(m.keys()) == {"coredump", "数据不一致", "慢", "满", "hang", "集群状态异常"}

    def test_tc_m14_042_top_modules_second_level(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/insight").json()
        m = _by_name(body["top_modules"])
        # 第二层子模块：优化器(T1/T8 DTS-1 去重, T4 DTS-4)=2；执行器=1；空间管理=1；升级模块=1
        assert m["优化器"] == 2
        assert m["执行器"] == 1
        assert m["空间管理"] == 1
        assert m["升级模块"] == 1

    def test_tc_m14_043_top1_coredump_top2_full_root_cause(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/insight").json()
        t1 = _by_name(body["top1_breakdown"])  # coredump 根因
        assert t1["代码缺陷"] == 1   # T1,T8 同 DTS-1 去重
        assert t1["设计缺陷"] == 1   # T2
        t2 = _by_name(body["top2_breakdown"])  # 满 根因
        assert t2["容量规划"] == 1   # T3


@pytest.mark.usefixtures("seed_import_tickets")
class TestMonthlyReportImportMajor:
    def test_tc_m14_050_grouping(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/major").json()
        types = body["types"]
        # T1,T8 → coredump（不去重，2 行）；T3 → 满；T4 → hang_slow；T5 → 升级
        # T2 事件级别非重大被排除；T6 非内核；T7 非质量
        assert len(types["coredump"]) == 2
        assert len(types["consistency"]) == 0
        assert len(types["full"]) == 1
        assert len(types["hang_slow"]) == 1
        assert len(types["escalation"]) == 1

    def test_tc_m14_051_row_field_mapping(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/major").json()
        row = body["types"]["full"][0]  # T3
        assert row["局点"] == "广州"
        assert row["版本"] == "V3"
        assert row["问题编号"] == "DTS-3"
        assert row["问题描述"] == "磁盘满"
        assert row["根因/进展"] == "未回收"
        assert row["问题影响"] == "P1-P3事件"
        assert row["问题领域"] == "存储引擎"      # 引入模块第一层
        assert row["模块/特性"] == "空间管理"     # 引入模块第二层及以后
        assert row["责任XM"] == ""

    def test_tc_m14_052_escalation_richtext_stripped(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/major").json()
        row = body["types"]["escalation"][0]  # T5
        assert row["问题领域"] == "管控"
        assert row["模块/特性"] == "升级模块"
        # 富文本 issue_desc/ root_cause 已去标签（T1 那类 <p>）：此处验证纯文本无标签残留
        cd = body["types"]["coredump"][0]
        assert "<" not in cd["问题描述"] and "<" not in cd["根因/进展"]
