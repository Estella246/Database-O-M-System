"""历史数据「迁入」功能测试：老平台 GaussDB 工单 → 新平台工单。

本地验证依赖：后端运行中（api_client 指向 BASE_URL）。迁入接口读取的老库由后端
LEGACY_DATABASE_URL 决定（未配置则回退 DATABASE_URL）。本测试把 4 条已知夹具单
（id 1001-1004）以「建表 IF NOT EXISTS + INSERT」方式灌入该老库——不 DROP 表，避免
清掉 gen_legacy_orders.py 生成的 1 万条演示数据（其 instance.id 用高位段 200001+，
parse/task 主键 1.. 连续，因此本夹具的 parse/task 主键用 900000+ 避免冲突）。

迁移调用统一传 batch_size=4 / max_total=4：迁移按 instance.id 升序处理，最低的 4 条
恰为夹具单 1001-1004，因此绝不会触碰高位段的演示数据。
"""
import os

import psycopg
import pytest
from psycopg.rows import dict_row

LEGACY_IDS = (1001, 1002, 1003, 1004)
OPERATOR = "demo_001"

# 限制迁移范围：仅处理最低的 4 条夹具单
MIGRATE_BODY = {"operator_id": OPERATOR, "batch_size": 4, "max_total": 4}

_CREATE_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS t_work_flow_instance (
      id BIGINT PRIMARY KEY,
      work_flow_info_name VARCHAR(128),
      current_work_flow_node_name VARCHAR(128),
      current_assignee VARCHAR(128),
      current_assignee_id VARCHAR(64),
      status VARCHAR(32),
      description VARCHAR(2000),
      issue_severity VARCHAR(32),
      creator_name VARCHAR(128),
      creator_id VARCHAR(64),
      create_time TIMESTAMP,
      update_time TIMESTAMP,
      deleted VARCHAR(8) DEFAULT '0'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS t_work_flow_task (
      id BIGINT PRIMARY KEY,
      work_flow_instance_id BIGINT,
      current_work_flow_node_name VARCHAR(128),
      next_work_flow_node_name VARCHAR(128),
      next_assignee VARCHAR(128),
      next_assignee_id VARCHAR(64),
      creator_name VARCHAR(128),
      creator_id VARCHAR(64),
      create_time TIMESTAMP,
      status VARCHAR(32),
      deleted VARCHAR(8) DEFAULT '0'
    )
    """,
    "CREATE TABLE IF NOT EXISTS t_work_flow_task_parse (\n"
    "  id BIGINT PRIMARY KEY,\n  instance_id BIGINT,\n"
    + ",\n".join(f"  column{i} VARCHAR(2000)" for i in range(1, 65))
    + "\n)",
]

# (id, info, cur_node, assignee, assignee_id, status, desc, severity, creator_name, creator_id, create, update, deleted)
_INSTANCES = [
    (1001, "HCS问题处理", "运维分析", "李潇雨", "l00002", "进行中",
     "农行生产环境实例频繁重启", "严重", "申宇", "s00001",
     "2025-11-03 09:12:00", "2025-11-04 10:00:00", "0"),
    (1002, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
     "建行备份任务超时导致告警", "一般", "董海俊", "d00004",
     "2025-10-21 14:30:00", "2025-10-28 18:20:00", "0"),
    (1003, "HCS问题处理", "开发分析", "宋康", "s00007", "暂停",
     "内核出现 coredump，疑似并发场景", "致命", "刘宗超", "l00005",
     "2025-12-01 08:05:00", "2025-12-02 11:40:00", "0"),
    (1004, "HCS问题处理", "问题审核", "李长军", "l00003", "进行中",
     "已废弃的测试单据", "一般", "申宇", "s00001",
     "2025-09-15 10:00:00", "2025-09-15 10:30:00", "1"),
]

# parse 主键用 900000+ 避免与生成数据冲突；(pk, instance_id, {col: val})
_PARSES = [
    (900001, 1001, {
        "column1": "2025-11-03", "column2": "农行", "column3": "公有云",
        "column4": "生产环境（运维）", "column8": "农行生产环境实例频繁重启，疑似内存泄漏",
        "column9": "ERROR: out of memory", "column10": "严重", "column11": "内核类",
        "column50": "内核问题", "column53": "eCare-AH-20251103", "column54": "l00002 李潇雨",
    }),
    (900002, 1002, {
        "column1": "2025-10-21", "column2": "建行", "column4": "生产环境（运维）",
        "column8": "建行备份任务超时导致告警", "column10": "一般",
        "column17": "已定位并修复，正常关闭", "column22": "是",
        "column31": "备份调度线程被长事务阻塞", "column60": "中",
    }),
    (900003, 1003, {
        "column1": "2025-12-01", "column2": "建行", "column3": "公有云",
        "column4": "生产环境（影响业务）", "column8": "内核出现 coredump，疑似并发场景",
        "column9": "SIGSEGV in xact_commit", "column10": "致命", "column11": "内核类",
        "column23": "DTS2025120100099", "column50": "内核问题",
        "column53": "eCare-CCB-20251201", "column54": "s00007 宋康",
    }),
]

# task 主键用 900000+；(pk, instance_id, cur, nxt, nxt_name, nxt_id, cr_name, cr_id, time, status)
_TASKS = [
    (900010, 1001, "问题填写", "问题审核", "李长军", "l00003", "申宇", "s00001", "2025-11-03 09:12:00", "提交"),
    (900011, 1001, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-11-03 15:40:00", "提交"),
    (900020, 1002, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-10-21 14:30:00", "提交"),
    (900021, 1002, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-10-22 09:00:00", "提交"),
    (900022, 1002, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-10-23 16:10:00", "提交"),
    (900023, 1002, "开发分析", "开发闭环", "李博闻", "l00008", "宋康", "s00007", "2025-10-25 10:20:00", "提交"),
    (900024, 1002, "开发闭环", "运维闭环", "李潇雨", "l00002", "李博闻", "l00008", "2025-10-27 11:00:00", "提交"),
    (900025, 1002, "运维闭环", "审核关闭", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-10-28 17:00:00", "提交"),
    (900026, 1002, "审核关闭", "", "", "", "徐齐刚", "x00006", "2025-10-28 18:20:00", "关闭"),
    (900030, 1003, "问题填写", "问题审核", "李长军", "l00003", "刘宗超", "l00005", "2025-12-01 08:05:00", "提交"),
    (900031, 1003, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-12-01 13:25:00", "提交"),
    (900032, 1003, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-12-02 11:40:00", "提交"),
]


def _legacy_dsn() -> str:
    dsn = os.getenv("LEGACY_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("未设置 LEGACY_DATABASE_URL / DATABASE_URL，跳过迁入测试")
    return dsn


def _new_dsn() -> str:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("未设置 DATABASE_URL，跳过迁入测试")
    return dsn


def _clean_fixture(legacy_conn, new_conn) -> None:
    legacy_conn.execute("DELETE FROM t_work_flow_task WHERE work_flow_instance_id = ANY(%s)", (list(LEGACY_IDS),))
    legacy_conn.execute("DELETE FROM t_work_flow_task_parse WHERE instance_id = ANY(%s)", (list(LEGACY_IDS),))
    legacy_conn.execute("DELETE FROM t_work_flow_instance WHERE id = ANY(%s)", (list(LEGACY_IDS),))
    legacy_conn.commit()
    new_conn.execute("DELETE FROM ticket WHERE legacy_instance_id = ANY(%s)", (list(LEGACY_IDS),))
    new_conn.commit()


@pytest.fixture()
def legacy_mock_seeded():
    """灌入 4 条已知夹具单（不 DROP 表），并清理上次迁入产生的工单，保证可重复运行。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)
    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean_fixture(legacy, new)

        with legacy.cursor() as cur:
            cur.executemany(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, creator_name, "
                "creator_id, create_time, update_time, deleted) VALUES "
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _INSTANCES,
            )
            for pk, iid, cols in _PARSES:
                names = ", ".join(["id", "instance_id"] + list(cols.keys()))
                ph = ", ".join(["%s"] * (2 + len(cols)))
                cur.execute(
                    f"INSERT INTO t_work_flow_task_parse ({names}) VALUES ({ph})",
                    [pk, iid] + list(cols.values()),
                )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean_fixture(legacy, new)
        legacy.close()
        new.close()


def _find_item(api_client, ticket_no):
    resp = api_client.get(
        "/api/tickets",
        params={"operator_id": OPERATOR, "template_code": "HCS_INCIDENT"},
    )
    assert resp.status_code == 200
    for it in resp.json().get("items", []):
        if str(it.get("orderId")) == str(ticket_no):
            return it
    return None


def test_migrate_creates_tickets_and_skips_deleted(api_client, legacy_mock_seeded):
    resp = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    # 1001/1002/1003 迁入；1004 deleted=1 跳过
    assert data["migrated"] == 3, data
    assert data["skipped_deleted"] == 1, data
    assert data["failed"] == 0, data
    assert len(data["ticket_nos"]) == 3
    for no in data["ticket_nos"]:
        assert no.startswith("YW") and len(no) == 13


def test_migrate_is_idempotent(api_client, legacy_mock_seeded):
    first = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    assert first["migrated"] == 3
    second = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    assert second["migrated"] == 0, second
    assert second["skipped_existing"] == 3, second


def test_migrated_open_ticket_fields_and_stage(api_client, legacy_mock_seeded):
    data = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    # 迁移顺序按 instance.id 升序：[1001, 1002, 1003]
    no_1001 = data["ticket_nos"][0]

    item = _find_item(api_client, no_1001)
    assert item is not None, "迁入的进行中工单未出现在工作台列表"
    assert item["status"] == "open"
    assert item["currentStage"] == "运维分析"
    assert "李潇雨" in item["currentHandler"]
    assert item["severity"] == "严重"
    assert "农行" in item["location"]
    assert "重启" in item["description"]

    # problem_fill 节点字段按解析列正确落位
    pf = api_client.get(
        f"/api/tickets/{no_1001}/nodes/problem_fill/data",
        params={"operator_id": OPERATOR},
    )
    assert pf.status_code == 200
    vals = pf.json()["values"]
    assert vals.get("location") == "农行"
    assert vals.get("severity") == "严重"
    assert vals.get("ecare_ticket_no") == "eCare-AH-20251103"


def test_migrated_closed_ticket_has_full_node_history(api_client, legacy_mock_seeded):
    data = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    no_1002 = data["ticket_nos"][1]

    item = _find_item(api_client, no_1002)
    assert item is not None
    assert item["status"] == "closed"
    assert item["currentStage"] == "已关闭"

    # 完整节点历史：7 个节点的流转日志
    logs = api_client.get(f"/api/tickets/{no_1002}/logs")
    assert logs.status_code == 200
    log_items = logs.json()["items"]
    assert len(log_items) >= 6, log_items
    to_nodes = [li["to"] for li in log_items]
    assert "问题审核" in to_nodes
    assert "审核关闭" in to_nodes


# —— 回归：真实老库 t_work_flow_task.creator_id 恒为工单发起人 ——
# 老库每条流转任务的 creator_id 都是发起人，不能当各节点处理人；处理人应取上一条
# 任务的 next_assignee 还原。此夹具单的 creator 全部为 s00001 申宇（发起人）。
_REG_ID = 1005
_REG_INSTANCE = (
    1005, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
    "工行容灾切换演练超时", "一般", "申宇", "s00001",
    "2025-08-10 09:00:00", "2025-08-15 18:00:00", "0",
)
# (pk, iid, cur, nxt, nxt_name, nxt_id, cr_name, cr_id, time, status)；creator 恒为发起人
_REG_TASKS = [
    (901050, 1005, "问题填写", "问题审核", "李长军", "l00003", "申宇", "s00001", "2025-08-10 09:00:00", "提交"),
    (901051, 1005, "问题审核", "运维分析", "李潇雨", "l00002", "申宇", "s00001", "2025-08-11 09:00:00", "提交"),
    (901052, 1005, "运维分析", "开发分析", "宋康", "s00007", "申宇", "s00001", "2025-08-12 09:00:00", "提交"),
    (901053, 1005, "开发分析", "开发闭环", "李博闻", "l00008", "申宇", "s00001", "2025-08-13 09:00:00", "提交"),
    (901054, 1005, "开发闭环", "运维闭环", "李潇雨", "l00002", "申宇", "s00001", "2025-08-14 09:00:00", "提交"),
    (901055, 1005, "运维闭环", "审核关闭", "徐齐刚", "x00006", "申宇", "s00001", "2025-08-15 09:00:00", "提交"),
    (901056, 1005, "审核关闭", "", "", "", "申宇", "s00001", "2025-08-15 18:00:00", "关闭"),
]
# 各节点期望处理人：问题填写=发起人，其余=上一条任务的 next_assignee
_REG_EXPECTED = {
    "问题填写": "申宇",
    "问题审核": "李长军",
    "运维分析": "李潇雨",
    "开发分析": "宋康",
    "开发闭环": "李博闻",
    "运维闭环": "李潇雨",
    "审核关闭": "徐齐刚",
}


@pytest.fixture()
def legacy_creator_is_originator_seeded():
    """灌入一条 creator_id 恒为发起人的已关闭工单（复现真实老库语义）。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute("DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s", (_REG_ID,))
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_REG_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_REG_ID,))
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, creator_name, "
                "creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _REG_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _REG_TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrated_node_handlers_not_collapsed_to_originator(
    api_client, legacy_creator_is_originator_seeded
):
    """各节点处理人应按 next_assignee 还原，不能都塌缩成问题填写人。"""
    # 1005 是当前最低 id 的夹具单，max_total=1 仅处理它，不触碰演示数据
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "batch_size": 1, "max_total": 1},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]

    logs = api_client.get(f"/api/tickets/{no}/logs")
    assert logs.status_code == 200
    # from_node -> actor（该节点处理人）
    actor_by_from = {li["from"]: li["actor"] for li in logs.json()["items"]}

    for node_name, expected in _REG_EXPECTED.items():
        actor = actor_by_from.get(node_name)
        assert actor is not None, f"缺少节点 {node_name} 的流转日志：{actor_by_from}"
        assert expected in actor, f"节点 {node_name} 处理人应为 {expected}，实际 {actor}"

    # 关键回归点：不能所有阶段处理人都塌缩成发起人「申宇」
    non_fill_actors = [a for n, a in actor_by_from.items() if n != "问题填写"]
    assert any("申宇" not in a for a in non_fill_actors), (
        f"各阶段处理人疑似全部塌缩为问题填写人：{actor_by_from}"
    )
