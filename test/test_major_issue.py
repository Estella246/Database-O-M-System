"""重大问题（工单驱动）接口测试。

覆盖：
- 惰性同步：最新 event_level 命中阈值即流入；未命中或降级后移出
- 不依赖运维分析 submit；problem_fill 保存即可判定
- 状态与工单流转无关；审核关闭不自动关闭
- 仅管理员/运维组长可置「关闭」
- 快照字段、进展、列表过滤、写权限
"""
import os
from datetime import datetime, timedelta, timezone

import pytest


ADMIN_OP = "admin"

# 0001_init_workflow_schema.sql 固定节点 id（template_id=1）
NODE_PROBLEM_FILL = 1
NODE_PROBLEM_REVIEW = 2
NODE_OPS_ANALYSIS = 3
NODE_DEV_ANALYSIS = 4
NODE_OPS_CLOSURE = 6
NODE_AUDIT_CLOSE = 7

_PREFIX = "mi_seed_"
_NO_WRITE_ROLE = "mi_no_write_role"
_NO_WRITE_USER = "mi_nowrite"
_OPS_LEAD_ROLE = "运维组长"
_OPS_LEAD_USER = "mi_ops_lead"


def _t0():
    return datetime(2099, 3, 10, 0, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module", autouse=True)
def _ensure_users(api_client):
    api_client.post("/api/admin/users/bulk", json={
        "items": [
            {"account": ADMIN_OP, "user_name": "管理员", "role_code": "admin", "group_name": "platform", "is_active": True},
            {"account": "mi_ops_a", "user_name": "运维甲", "role_code": "普通人员", "group_name": "测试组", "is_active": True},
            {"account": "mi_dev_x", "user_name": "开发乙", "role_code": "普通人员", "group_name": "测试组", "is_active": True},
            {"account": _NO_WRITE_USER, "user_name": "只读用户", "role_code": _NO_WRITE_ROLE, "group_name": "测试组", "is_active": True},
            {"account": _OPS_LEAD_USER, "user_name": "运维组长甲", "role_code": _OPS_LEAD_ROLE, "group_name": "测试组", "is_active": True},
        ],
        "operator_id": "admin",
    })
    # 将 major_problem_create 对该角色置 hidden，验证写权限拒绝
    api_client.post("/api/admin/permissions/bulk", json={
        "operator_id": "admin",
        "items": [{
            "role_code": _NO_WRITE_ROLE,
            "is_pl": False,
            "node_key": "__whitelist__",
            "field_key": "major_problem_create",
            "permission_level": "hidden",
        }],
    })
    yield


def _insert_node(conn, tid, node_id, values, created_at):
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


def _flow(conn, tid, fr, to, action, op, name, ts):
    conn.execute(
        """
        INSERT INTO ticket_flow_log
          (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, '', %s)
        """,
        (tid, fr, to, action, op, name, ts),
    )


def _seed_ticket_list_snapshot(
    conn,
    tid: int,
    ticket_no: str,
    t0,
    *,
    event_level: str,
    location: str,
    issue_desc: str,
    ops_analyst: str = "",
    dev_analyst: str = "",
) -> None:
    from psycopg.types.json import Json

    start = t0.strftime("%Y-%m-%d")
    extra = {"event_level": event_level, "ops_analyst": ops_analyst, "dev_analyst": dev_analyst}
    conn.execute(
        """
        INSERT INTO ticket_list_snapshot (
            ticket_id, ticket_no, template_code, status, creator_id, creator_name,
            created_at, start_date, location, description_plain, extra_fields
        ) VALUES (
            %s, %s, 'HCS_INCIDENT', 'processing', 'seed', '填单',
            %s, %s, %s, %s, %s::jsonb
        )
        ON CONFLICT (ticket_id) DO UPDATE SET
            start_date = EXCLUDED.start_date,
            location = EXCLUDED.location,
            description_plain = EXCLUDED.description_plain,
            extra_fields = EXCLUDED.extra_fields,
            updated_at = NOW()
        """,
        (tid, ticket_no, t0, start, location, issue_desc, Json(extra)),
    )


def _seed_ticket(conn, ticket_no, event_level, location, issue_desc, with_dev, reach_audit=True, with_ops_flow=True):
    t0 = _t0()
    H = timedelta(hours=1)
    ticket_status = "closed" if reach_audit else "processing"
    conn.execute(
        """
        INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at)
        VALUES (%s, 1, %s, %s, 'seed', '填单', %s, %s)
        """,
        (ticket_no, f"重大问题测试 {ticket_no}", ticket_status, t0, t0 + 9 * H),
    )
    tid = conn.execute(
        "SELECT currval(pg_get_serial_sequence('ticket','id')) AS id"
    ).fetchone()["id"]

    _insert_node(conn, tid, NODE_PROBLEM_FILL, {"location": location, "issue_desc": issue_desc}, t0)
    _insert_node(conn, tid, NODE_OPS_ANALYSIS, {"event_level": event_level}, t0 + 2 * H)

    if with_ops_flow:
        # 运维分析阶段最后提交人 = mi_ops_a，时间 = 通报日期来源（有 submit 时优先）
        if with_dev:
            _flow(conn, tid, NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", "mi_ops_a", "运维甲", t0 + 2 * H)
            _flow(conn, tid, NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", "mi_dev_x", "开发乙", t0 + 5 * H)
        else:
            _flow(conn, tid, NODE_OPS_ANALYSIS, NODE_OPS_CLOSURE, "submit", "mi_ops_a", "运维甲", t0 + 2 * H)
    if reach_audit and with_ops_flow:
        _flow(conn, tid, NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", "mi_closer", "闭环", t0 + 9 * H)

    ops_name = "运维甲" if with_ops_flow else ""
    dev_name = "开发乙" if with_dev and with_ops_flow else ""
    _seed_ticket_list_snapshot(
        conn,
        tid,
        ticket_no,
        t0,
        event_level=event_level,
        location=location,
        issue_desc=issue_desc,
        ops_analyst=ops_name,
        dev_analyst=dev_name,
    )
    return tid


@pytest.fixture(scope="class")
def seed_major_issue():
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过重大问题判定测试")

    def _cleanup(conn):
        conn.execute(
            "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
            (f"{_PREFIX}%",),
        )
        conn.execute("DELETE FROM ticket_list_snapshot WHERE ticket_no LIKE %s", (f"{_PREFIX}%",))
        conn.execute("DELETE FROM major_issue WHERE ticket_no LIKE %s", (f"{_PREFIX}%",))
        conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{_PREFIX}%",))

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _cleanup(conn)
        # A：事故（命中）+ 经开发分析 + 已到审核关闭
        _seed_ticket(conn, f"{_PREFIX}A", "事故", "北京局点", "数据库主备异常", with_dev=True, reach_audit=True)
        # B：P1-P3事件（命中）+ 无开发分析 + 停在运维闭环
        _seed_ticket(conn, f"{_PREFIX}B", "P1-P3事件", "上海局点", "查询超时", with_dev=False, reach_audit=False)
        # C：一般问题（不命中）；D：P4事件（不命中）
        _seed_ticket(conn, f"{_PREFIX}C", "一般问题", "广州局点", "轻微告警", with_dev=False)
        _seed_ticket(conn, f"{_PREFIX}D", "P4事件", "深圳局点", "提示信息", with_dev=False)
        # E：仅 problem_fill/ops 节点数据命中，无运维分析 submit
        _seed_ticket(
            conn, f"{_PREFIX}E", "管理升级预警", "成都局点", "仅保存未提交",
            with_dev=False, with_ops_flow=False,
        )
        conn.commit()

    yield

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _cleanup(conn)
        conn.commit()


def _sync_prefix_tickets(prefix: str = _PREFIX) -> None:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        return
    import psycopg
    from psycopg.rows import dict_row
    from routers.major_issue import sync_major_issue_for_ticket

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        rows = conn.execute(
            "SELECT id FROM ticket WHERE ticket_no LIKE %s",
            (f"{prefix}%",),
        ).fetchall()
        for row in rows:
            sync_major_issue_for_ticket(conn, int(row["id"]))
        conn.commit()


def _list(api_client, **params):
    force = bool(params.pop("force_sync", False))
    p = {"operator_id": ADMIN_OP, "q": _PREFIX, "page_size": 100}
    p.update(params)
    if force or p.get("q", _PREFIX).startswith(_PREFIX):
        _sync_prefix_tickets(_PREFIX)
    resp = api_client.get("/api/major-issues", params=p)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _find(api_client, ticket_no, **params):
    for it in _list(api_client, **params)["items"]:
        if it["ticket_no"] == ticket_no:
            return it
    return None


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssueSync:
    def test_tc_mi_080_only_qualifying_flow_in(self, api_client):
        items = _list(api_client)["items"]
        nos = {it["ticket_no"] for it in items}
        assert f"{_PREFIX}A" in nos
        assert f"{_PREFIX}B" in nos
        assert f"{_PREFIX}E" in nos  # 无 ops submit，仅最新 event_level 命中
        assert f"{_PREFIX}C" not in nos  # 一般问题
        assert f"{_PREFIX}D" not in nos  # P4事件

    def test_tc_mi_081_snapshot_fields(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        assert a is not None
        assert a["site_name"] == "北京局点"
        assert a["event_level"] == "事故"
        assert a["description"] == "数据库主备异常"
        assert a["ops_analyst"] == "运维甲"
        assert a["dev_analyst"] == "开发乙"
        assert a["report_date"] == "2099-03-10"
        b = _find(api_client, f"{_PREFIX}B")
        assert b["dev_analyst"] == ""  # 无开发分析

    def test_tc_mi_082_sync_idempotent_keeps_status(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        # 改状态为关闭
        r = api_client.patch(f"/api/major-issues/{a['id']}", json={"operator_id": ADMIN_OP, "status": "关闭"})
        assert r.status_code == 200
        # 再次拉取（触发同步），数量稳定、状态保留
        first = _list(api_client)
        again = _list(api_client)
        assert first["total"] == again["total"] == 3
        a2 = _find(api_client, f"{_PREFIX}A")
        assert a2["status"] == "关闭"
        # 恢复
        api_client.patch(f"/api/major-issues/{a['id']}", json={"operator_id": ADMIN_OP, "status": "进行中"})


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssueStatusIndependent:
    def test_tc_mi_082a_audit_close_does_not_auto_close(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        assert a is not None
        assert a["status"] == "进行中"
        b = _find(api_client, f"{_PREFIX}B")
        assert b["status"] == "进行中"

    def test_tc_mi_082b_manual_status_persists_after_sync(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        r = api_client.patch(f"/api/major-issues/{a['id']}", json={"operator_id": ADMIN_OP, "status": "挂起"})
        assert r.status_code == 200
        a2 = _find(api_client, f"{_PREFIX}A")
        assert a2["status"] == "挂起"
        api_client.patch(f"/api/major-issues/{a['id']}", json={"operator_id": ADMIN_OP, "status": "进行中"})

    def test_tc_mi_082c_downgrade_removes_from_list(self, api_client):
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.getenv("DATABASE_URL")
        e = _find(api_client, f"{_PREFIX}E")
        assert e is not None
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            tid = conn.execute(
                "SELECT id FROM ticket WHERE ticket_no = %s", (f"{_PREFIX}E",)
            ).fetchone()["id"]
            _insert_node(conn, tid, NODE_OPS_ANALYSIS, {"event_level": "一般问题"}, _t0() + timedelta(hours=10))
            conn.execute(
                """
                UPDATE ticket_list_snapshot
                SET extra_fields = jsonb_set(extra_fields, '{event_level}', %s::jsonb, true),
                    updated_at = NOW()
                WHERE ticket_id = %s
                """,
                ('"一般问题"', tid),
            )
            conn.commit()
        assert _find(api_client, f"{_PREFIX}E", force_sync=True) is None


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssueClosePermission:
    def test_tc_mi_089a_close_requires_admin_or_ops_lead(self, api_client):
        b = _find(api_client, f"{_PREFIX}B")
        r = api_client.patch(f"/api/major-issues/{b['id']}", json={
            "operator_id": "mi_ops_a", "status": "关闭",
        })
        assert r.status_code == 403
        r2 = api_client.patch(f"/api/major-issues/{b['id']}", json={
            "operator_id": _OPS_LEAD_USER, "status": "关闭",
        })
        assert r2.status_code == 200
        assert r2.json()["status"] == "关闭"
        api_client.patch(f"/api/major-issues/{b['id']}", json={
            "operator_id": ADMIN_OP, "status": "进行中",
        })


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssueStatus:
    def test_tc_mi_083_status_transitions(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        for st in ("挂起", "关闭", "进行中"):
            r = api_client.patch(f"/api/major-issues/{a['id']}", json={"operator_id": ADMIN_OP, "status": st})
            assert r.status_code == 200
            assert r.json()["status"] == st

    def test_tc_mi_084_status_invalid(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        r = api_client.patch(f"/api/major-issues/{a['id']}", json={"operator_id": ADMIN_OP, "status": "已完成"})
        assert r.status_code == 400


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssueProgress:
    def test_tc_mi_085_same_day_overwrite(self, api_client):
        # 同一天再次提交进展：覆盖当天历史，而非追加
        a = _find(api_client, f"{_PREFIX}A")
        r1 = api_client.post(f"/api/major-issues/{a['id']}/progress", json={
            "operator_id": ADMIN_OP, "content": "第一次进展", "risk_measure": "限流",
        })
        assert r1.status_code == 200
        r2 = api_client.post(f"/api/major-issues/{a['id']}/progress", json={
            "operator_id": ADMIN_OP, "content": "第二次进展", "risk_measure": "扩容",
        })
        assert r2.status_code == 200
        lst = api_client.get(f"/api/major-issues/{a['id']}/progress", params={"operator_id": ADMIN_OP}).json()
        assert lst["total"] == 1  # 当天只保留一条
        assert lst["items"][0]["content"] == "第二次进展"
        assert lst["items"][0]["risk_measure"] == "扩容"
        a2 = _find(api_client, f"{_PREFIX}A")
        assert a2["progress_count"] == 1
        assert a2["latest_progress_content"] == "第二次进展"
        assert a2["latest_progress_risk"] == "扩容"

    def test_tc_mi_085b_multi_day_listing(self, api_client):
        # 跨天进展：列表按天倒序，最新天在前，最新进展取最近一天
        import psycopg
        from psycopg.rows import dict_row

        dsn = os.getenv("DATABASE_URL")
        b = _find(api_client, f"{_PREFIX}B")
        with psycopg.connect(dsn, row_factory=dict_row) as conn:
            conn.execute("DELETE FROM major_issue_progress WHERE major_issue_id=%s", (b["id"],))
            for ts, txt in (("2099-03-11 09:00:00+08", "第一天进展"), ("2099-03-12 09:00:00+08", "第二天进展")):
                conn.execute(
                    "INSERT INTO major_issue_progress (major_issue_id, progress_at, content) VALUES (%s, %s, %s)",
                    (b["id"], ts, txt),
                )
            conn.commit()
        lst = api_client.get(f"/api/major-issues/{b['id']}/progress", params={"operator_id": ADMIN_OP}).json()
        assert [p["content"] for p in lst["items"]] == ["第二天进展", "第一天进展"]
        b2 = _find(api_client, f"{_PREFIX}B")
        assert b2["progress_count"] == 2
        assert b2["latest_progress_content"] == "第二天进展"

    def test_tc_mi_086_content_required(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        r = api_client.post(f"/api/major-issues/{a['id']}/progress", json={"operator_id": ADMIN_OP, "content": "  "})
        assert r.status_code == 400


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssueFilter:
    def test_tc_mi_087_filter_status(self, api_client):
        b = _find(api_client, f"{_PREFIX}B")
        api_client.patch(f"/api/major-issues/{b['id']}", json={"operator_id": ADMIN_OP, "status": "挂起"})
        items = _list(api_client, status="挂起")["items"]
        nos = {it["ticket_no"] for it in items}
        assert f"{_PREFIX}B" in nos
        for it in items:
            assert it["status"] == "挂起"
        api_client.patch(f"/api/major-issues/{b['id']}", json={"operator_id": ADMIN_OP, "status": "进行中"})

    def test_tc_mi_088_filter_q(self, api_client):
        items = _list(api_client, q="上海局点")["items"]
        nos = {it["ticket_no"] for it in items}
        assert f"{_PREFIX}B" in nos
        assert f"{_PREFIX}A" not in nos


@pytest.mark.usefixtures("seed_major_issue")
class TestMajorIssuePermission:
    def test_tc_mi_089_write_denied_without_permission(self, api_client):
        a = _find(api_client, f"{_PREFIX}A")
        r = api_client.post(f"/api/major-issues/{a['id']}/progress", json={
            "operator_id": _NO_WRITE_USER, "content": "无权进展",
        })
        assert r.status_code == 403
        r2 = api_client.patch(f"/api/major-issues/{a['id']}", json={
            "operator_id": _NO_WRITE_USER, "status": "挂起",
        })
        assert r2.status_code == 403
