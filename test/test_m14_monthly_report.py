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


ADMIN_OP = "test_admin"


@pytest.fixture(scope="module", autouse=True)
def _ensure_monthly_report_access(api_client, ensure_test_users):
    api_client.post("/api/admin/permissions/bulk", json={
        "items": [
            {
                "role_code": "管理员",
                "is_pl": False,
                "node_key": "__whitelist__",
                "field_key": "monthly_report",
                "permission_level": "editable",
            }
        ],
        "operator_id": ADMIN_OP,
    })
    orig_get = api_client.get
    orig_put = api_client.put
    orig_post = api_client.post
    orig_delete = api_client.delete

    def _with_op(params):
        out = dict(params or {})
        out.setdefault("operator_id", ADMIN_OP)
        return out

    def _with_op_body(body):
        if not isinstance(body, dict):
            return {"operator_id": ADMIN_OP}
        out = dict(body)
        out.setdefault("operator_id", ADMIN_OP)
        return out

    def get(path, params=None, **kwargs):
        path = str(path)
        extra = dict(params or {})
        if path.startswith("/api/monthly-report"):
            extra.setdefault("operator_id", ADMIN_OP)
            if "?" in path:
                from urllib.parse import parse_qsl
                base, qs = path.split("?", 1)
                merged = dict(parse_qsl(qs, keep_blank_values=True))
                for key, val in extra.items():
                    merged.setdefault(key, val)
                path = base
                extra = merged
        return orig_get(path, params=extra if extra else params, **kwargs)

    def put(path, json=None, **kwargs):
        if str(path).startswith("/api/monthly-report"):
            json = _with_op_body(json)
        return orig_put(path, json=json, **kwargs)

    def post(path, json=None, **kwargs):
        if str(path).startswith("/api/monthly-report"):
            json = _with_op_body(json)
        return orig_post(path, json=json, **kwargs)

    def delete(path, params=None, json=None, **kwargs):
        if str(path).startswith("/api/monthly-report"):
            params = _with_op(params)
        return orig_delete(path, params=params, json=json, **kwargs)

    api_client.get = get
    api_client.put = put
    api_client.post = post
    api_client.delete = delete
    try:
        yield
    finally:
        api_client.get = orig_get
        api_client.put = orig_put
        api_client.post = orig_post
        api_client.delete = orig_delete


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
                "records": [{"关联工单": "YW1", "QI编号": "QI-1", "改进标题": "慢查询", "分类": "特性加固", "领域": "SQL", "提出人": "张三"}],
            },
        })
        assert resp.status_code == 200
        assert resp.json()["section_improve"]["records"][0]["领域"] == "SQL"

    def test_tc_m14_014_save_links(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "links",
            "data": {"content": "本月问题详情补充说明"},
        })
        assert resp.status_code == 200
        assert resp.json()["section_links"]["content"] == "本月问题详情补充说明"

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
        resp = api_client.get("/api/monthly-report", params={"status": "archived"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        months = [it["report_month"] for it in items]
        assert fresh_ym in months

    def test_tc_m14_031_list_status_invalid(self, api_client):
        resp = api_client.get("/api/monthly-report", params={"status": "foo"})
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
_N_OPS_CLOSURE = 6

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
        t4 = _imp_seed_ticket(conn, f"{_IMP_PREFIX}4", component="内核问题", quality=KNOWN,
                              issue_type="慢", intro_module="SQL引擎/优化器/统计信息",
                              dts="DTS-4", root_cause_category="统计信息缺失", event_level="管理升级预警",
                              location="深圳", gauss_version="V3",
                              issue_desc="查询慢", root_cause="计划差", kernel_upgrade="否")
        # T4 后续闭环节点改回「否」：快照当前值应为否，与工作台列筛选一致（不计入）。
        _imp_insert_node(conn, t4, _N_OPS_CLOSURE, {"is_quality_issue": "否"},
                         _imp_t0() + timedelta(hours=6))
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
        try:
            from ticket_list_snapshot import refresh_ticket_list_snapshot

            rows = conn.execute(
                "SELECT id FROM ticket WHERE ticket_no LIKE %s ORDER BY id",
                (f"{_IMP_PREFIX}%",),
            ).fetchall()
            for row in rows:
                refresh_ticket_list_snapshot(conn, int(row["id"]))
        except Exception as exc:
            pytest.skip(f"ticket_list_snapshot 不可用，跳过导入聚合测试: {exc}")
        conn.commit()
    yield
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _cleanup(conn)
        conn.commit()


def _by_name(items):
    return {it["name"]: it["value"] for it in items}


def test_snapshot_fields_match_workbench_extra_fields():
    """导入聚合读 extra_fields，is_quality_issue 无粘性。"""
    from routers.monthly_report import _fields_from_snapshot_row, _is_kernel_quality

    row = {
        "ticket_no": "YW001",
        "location": "北京",
        "extra_fields": {
            "component": "内核问题",
            "is_quality_issue": "否",
            "issue_type": "慢",
        },
    }
    fields = _fields_from_snapshot_row(row)
    assert fields["component"] == "内核问题"
    assert fields["is_quality_issue"] == "否"
    assert not _is_kernel_quality(fields)

    row["extra_fields"]["is_quality_issue"] = "是（已知质量问题）"
    fields = _fields_from_snapshot_row(row)
    assert _is_kernel_quality(fields)


def _import_insight_body():
    from database import db_conn
    from routers.monthly_report import _compute_insight

    with db_conn() as conn:
        return _compute_insight(conn, _IMP_YM)


def _import_major_body():
    from database import db_conn
    from routers.monthly_report import _compute_major

    with db_conn() as conn:
        return _compute_major(conn, _IMP_YM)


@pytest.mark.usefixtures("seed_import_tickets")
class TestMonthlyReportImportInsight:
    def test_tc_m14_040_kpi(self):
        kpi = _import_insight_body()["kpi"]
        # 内核质量问题：T1,T2,T3,T5,T8 = 5（T4 闭环节点改否、T6 非内核、T7 非质量被排除）
        assert kpi["total_count"] == 5
        assert kpi["known_count"] == 4   # 仅 T2 为新发现
        assert kpi["new_count"] == 1
        assert kpi["pansh_count"] == 0 and kpi["pansh_total"] == 0

    def test_tc_m14_041_impact_categories_dedup_by_dts(self):
        m = _by_name(_import_insight_body()["impact_categories"])
        # coredump: T1,T8 同 DTS-1 去重 + T2 DTS-2 = 2
        assert m["coredump"] == 2
        assert m["满"] == 1
        assert m["慢"] == 0
        assert m["集群状态异常"] == 1
        assert m["数据不一致"] == 0 and m["hang"] == 0
        # 仅这 6 种类型
        assert set(m.keys()) == {"coredump", "数据不一致", "慢", "满", "hang", "集群状态异常"}

    def test_tc_m14_042_top_modules_second_level(self):
        m = _by_name(_import_insight_body()["top_modules"])
        # 第二层子模块：优化器(T1/T8 DTS-1 去重)=1；执行器=1；空间管理=1；升级模块=1
        assert m["优化器"] == 1
        assert m["执行器"] == 1
        assert m["空间管理"] == 1
        assert m["升级模块"] == 1

    def test_tc_m14_043_top1_coredump_top2_full_root_cause(self):
        body = _import_insight_body()
        t1 = _by_name(body["top1_breakdown"])  # coredump 根因
        assert t1["代码缺陷"] == 1   # T1,T8 同 DTS-1 去重
        assert t1["设计缺陷"] == 1   # T2
        t2 = _by_name(body["top2_breakdown"])  # 满 根因
        assert t2["容量规划"] == 1   # T3


@pytest.mark.usefixtures("seed_import_tickets")
class TestMonthlyReportImportMajor:
    def test_tc_m14_050_grouping(self):
        types = _import_major_body()["types"]
        # T4 快照为否不计入：T1,T2,T8 → coredump（不去重，3 行）；T3 → 满；
        # T5（集群状态异常+内核升级=是）→ 升级。T6 非内核；T7 非质量。
        assert len(types["coredump"]) == 3
        assert len(types["consistency"]) == 0
        assert len(types["full"]) == 1
        assert len(types["hang_slow"]) == 0
        assert len(types["escalation"]) == 1

    def test_tc_m14_051_row_field_mapping(self):
        body = _import_major_body()
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

    def test_tc_m14_052_escalation_richtext_stripped(self):
        body = _import_major_body()
        row = body["types"]["escalation"][0]  # T5
        assert row["问题领域"] == "管控"
        assert row["模块/特性"] == "升级模块"
        # 富文本 issue_desc/ root_cause 已去标签（T1 那类 <p>）：此处验证纯文本无标签残留
        cd = body["types"]["coredump"][0]
        assert "<" not in cd["问题描述"] and "<" not in cd["根因/进展"]


# ---------------------------------------------------------------------------
# 改进诉求导入：来自「质量改进」(qi_request) 本月数据
# ---------------------------------------------------------------------------

_IMP_QI_PREFIX = "QI-2099-"


@pytest.fixture(scope="class")
def seed_improve_qi_requests():
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过改进诉求导入测试")
    t0 = _imp_t0()  # 2099-07-15 → Asia/Shanghai 209907
    t_other = datetime(2099, 3, 10, 4, 0, 0, tzinfo=timezone.utc)  # Asia/Shanghai 209903

    def _cleanup(conn):
        conn.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (f"{_IMP_QI_PREFIX}%",))

    # (编号, 领域, 模块&特性, 标题, 描述, 改进目标, 提出人, created_at, related_ticket, category, stage, status)
    rows = [
        (f"{_IMP_QI_PREFIX}001", "SQL引擎", "优化器/统计信息", "慢查询", "desc1", "改进统计信息", "张三 zhangsan", t0, "YW209907001", "特性加固", "review", "in_progress"),
        (f"{_IMP_QI_PREFIX}002", "SQL内核", "执行器", "算子慢", "desc2", "算子优化", "李四 lisi", t0, "YW209907002", "特性加固", "analysis", "in_progress"),
        (f"{_IMP_QI_PREFIX}003", "存储引擎", "空间管理", "磁盘满", "desc3", "自动回收", "王五 wangwu", t0, "YW209907003", "特性加固", "closure", "in_progress"),
        (f"{_IMP_QI_PREFIX}004", "网络", "协议栈", "丢包", "desc4", "重传优化", "赵六 zhaoliu", t0, "YW209907004", "快速恢复", "propose", "in_progress"),
        (f"{_IMP_QI_PREFIX}005", "缓存", "淘汰策略", "命中率低", "desc5", "LRU优化", "孙七 sunqi", t_other, "YW209903001", "资料", "review", "in_progress"),
    ]
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        try:
            conn.execute("SELECT 1 FROM qi_request LIMIT 1")
        except Exception:
            pytest.skip("qi_request 表未就绪，跳过 QI 导入测试")
        _cleanup(conn)
        for no, domain, mf, title, desc, goal, proposer, created_at, ticket, cat, stage, status in rows:
            conn.execute(
                """
                INSERT INTO qi_request
                  (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                   priority, domain, module_feature, reviewer, current_stage, current_status,
                   creator_id, creator_name, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, '中', %s, %s, %s, %s, %s, 'seed', 'seed', %s, %s)
                """,
                (no, cat, proposer, title, ticket, desc, goal, domain, mf, proposer, stage, status, created_at, created_at),
            )
        conn.commit()
    yield
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _cleanup(conn)
        conn.commit()


@pytest.mark.usefixtures("seed_improve_qi_requests")
class TestMonthlyReportImportImprove:
    def test_tc_m14_060_domain_distribution_全量(self, api_client):
        # 领域占比/SQL/存储 取全部非草稿质量改进（不限月份），故只断言包含种子的领域
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/improve?operator_id={ADMIN_OP}").json()
        m = _by_name(body["module_distribution"])
        assert m.get("SQL内核", 0) >= 1 and m.get("网络", 0) >= 1 and m.get("存储引擎", 0) >= 1

    def test_tc_m14_061_sql_and_storage_by_module_feature(self, api_client):
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/improve?operator_id={ADMIN_OP}").json()
        sql = _by_name(body["sql_items"])     # domain 含 SQL → 按 module_feature（全量）
        assert sql.get("执行器", 0) >= 1 and sql.get("优化器/统计信息", 0) >= 1
        storage = _by_name(body["storage_items"])  # domain 含 存储 → 按 module_feature（全量）
        assert storage.get("空间管理", 0) >= 1

    def test_tc_m14_062_records_month_only(self, api_client):
        # 本月质量改进记录表按 created_at（Asia/Shanghai）筛本月（209907）→ 只有前 4 条；
        # 第 5 条提出时间在 2099-03，应被排除
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/improve?operator_id={ADMIN_OP}").json()
        records = body["records"]
        assert len(records) == 4
        assert all(r["QI编号"] != f"{_IMP_QI_PREFIX}005" for r in records)
        items = {r["QI编号"]: r for r in records}
        r1 = items[f"{_IMP_QI_PREFIX}001"]
        assert r1["关联工单"] == "YW209907001"
        assert r1["改进标题"] == "慢查询"
        assert r1["分类"] == "特性加固"
        assert r1["领域"] == "SQL引擎"
        assert "当前阶段" not in r1
        assert r1["提出人"] == "张三 zhangsan"
        assert int(r1["_qi_id"]) > 0

    def test_tc_m14_063_sql_storage_top10(self, api_client):
        # SQL / 存储领域改进导入结果最多 10 条（按 count 降序）
        body = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/improve?operator_id={ADMIN_OP}").json()
        assert len(body["sql_items"]) <= 10
        assert len(body["storage_items"]) <= 10
        sql_vals = [it["value"] for it in body["sql_items"]]
        storage_vals = [it["value"] for it in body["storage_items"]]
        assert sql_vals == sorted(sql_vals, reverse=True)
        assert storage_vals == sorted(storage_vals, reverse=True)

    def test_tc_m14_064_links_import_unsupported(self, api_client):
        resp = api_client.get(f"/api/monthly-report/{_IMP_YM}/import/links?operator_id={ADMIN_OP}")
        assert resp.status_code == 400
