"""历史数据「迁入」功能测试：老平台 GaussDB 工单 → 新平台工单。

本地验证依赖：后端运行中（api_client 指向 BASE_URL）。迁入接口读取的老库由后端
LEGACY_DATABASE_URL 决定（未配置则回退 DATABASE_URL）。本测试把 4 条已知夹具单
（id 1001-1004）以「建表 IF NOT EXISTS + INSERT」方式灌入该老库——不 DROP 表，避免
清掉 gen_legacy_orders.py 生成的 1 万条演示数据（其 instance.id 用高位段 200001+，
parse/task 主键 1.. 连续，因此本夹具的 parse/task 主键用 900000+ 避免冲突）。

迁移调用统一传 batch_size=4 / max_total=4：迁移按 instance.id 升序处理，最低的 4 条
恰为夹具单 1001-1004，因此绝不会触碰高位段的演示数据。
"""
import json
import os

import psycopg
import pytest
from psycopg.rows import dict_row

LEGACY_IDS = (1001, 1002, 1003, 1004)
OPERATOR = "demo_001"

LEGACY_PROCESS_IDS = {
    1001: "YW20251103001",
    1002: "YW20251021002",
    1003: "YW20251201003",
    1004: "YW20250915004",
    1005: "YW20250810005",
    1006: "YW20250701006",
}

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
      process_id VARCHAR(64),
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
      current_work_flow_node_id BIGINT,
      current_work_flow_node_name VARCHAR(128),
      next_work_flow_node_id BIGINT,
      next_work_flow_node_name VARCHAR(128),
      next_assignee VARCHAR(128),
      next_assignee_id VARCHAR(64),
      creator_name VARCHAR(128),
      creator_id VARCHAR(64),
      create_time TIMESTAMP,
      status VARCHAR(32),
      instance_process_id VARCHAR(64),
      deleted VARCHAR(8) DEFAULT '0'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS t_work_flow_node (
      id BIGINT PRIMARY KEY,
      node_name VARCHAR(128),
      deleted VARCHAR(8) DEFAULT '0'
    )
    """,
    "CREATE TABLE IF NOT EXISTS t_work_flow_task_parse (\n"
    "  id BIGINT PRIMARY KEY,\n  instance_id BIGINT,\n"
    + ",\n".join(f"  column{i} VARCHAR(2000)" for i in range(1, 65))
    + "\n)",
    "ALTER TABLE t_work_flow_task ADD COLUMN IF NOT EXISTS current_work_flow_node_id BIGINT",
    "ALTER TABLE t_work_flow_task ADD COLUMN IF NOT EXISTS next_work_flow_node_id BIGINT",
    "ALTER TABLE t_work_flow_task ADD COLUMN IF NOT EXISTS form_data TEXT",
]

_LEGACY_NODE_ROWS = [
    (1, "问题填写"),
    (2, "问题审核"),
    (3, "运维分析"),
    (4, "开发分析"),
    (5, "开发闭环"),
    (6, "运维闭环"),
    (7, "审核关闭"),
]

# (id, info, cur_node, assignee, assignee_id, status, desc, severity, process_id, creator_name, creator_id, create, update, deleted)
_INSTANCES = [
    (1001, "HCS问题处理", "运维分析", "李潇雨", "l00002", "进行中",
     "农行生产环境实例频繁重启", "严重", "YW20251103001", "申宇", "s00001",
     "2025-11-03 09:12:00", "2025-11-04 10:00:00", "0"),
    (1002, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
     "建行备份任务超时导致告警", "一般", "YW20251021002", "董海俊", "d00004",
     "2025-10-21 14:30:00", "2025-10-28 18:20:00", "0"),
    (1003, "HCS问题处理", "开发分析", "宋康", "s00007", "暂停",
     "内核出现 coredump，疑似并发场景", "致命", "YW20251201003", "刘宗超", "l00005",
     "2025-12-01 08:05:00", "2025-12-02 11:40:00", "0"),
    (1004, "HCS问题处理", "问题审核", "李长军", "l00003", "进行中",
     "已废弃的测试单据", "一般", "YW20250915004", "申宇", "s00001",
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
        "column17": "已定位并修复，正常关闭", "column19": "截断前缀",
        "column22": "是",
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

_FORM_ISSUE_TRACK_FULL = json.dumps(
    [
        {
            "cnFieldName": "问题进展跟踪",
            "tipInfo": "",
            "fieldValue": (
                '<p>截断前缀</p><p>第二行进展</p>'
                '<img src="data:image/png;base64,iVBORw0KGgo=" />'
            ),
        }
    ],
    ensure_ascii=False,
)

# task 主键用 900000+；末列为 form_data（可为 None）
_TASKS = [
    (900010, 1001, "问题填写", "问题审核", "李长军", "l00003", "申宇", "s00001", "2025-11-03 09:12:00", "提交", "YW20251103001", None),
    (900011, 1001, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-11-03 15:40:00", "提交", "YW20251103001", None),
    (900020, 1002, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-10-21 14:30:00", "提交", "YW20251021002", None),
    (900021, 1002, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-10-22 09:00:00", "提交", "YW20251021002", None),
    (900022, 1002, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-10-23 16:10:00", "提交", "YW20251021002", _FORM_ISSUE_TRACK_FULL),
    (900023, 1002, "开发分析", "开发闭环", "李博闻", "l00008", "宋康", "s00007", "2025-10-25 10:20:00", "提交", "YW20251021002", None),
    (900024, 1002, "开发闭环", "运维闭环", "李潇雨", "l00002", "李博闻", "l00008", "2025-10-27 11:00:00", "提交", "YW20251021002", None),
    (900025, 1002, "运维闭环", "审核关闭", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-10-28 17:00:00", "提交", "YW20251021002", None),
    (900026, 1002, "审核关闭", "", "", "", "徐齐刚", "x00006", "2025-10-28 18:20:00", "关闭", "YW20251021002", None),
    (900030, 1003, "问题填写", "问题审核", "李长军", "l00003", "刘宗超", "l00005", "2025-12-01 08:05:00", "提交", "YW20251201003", None),
    (900031, 1003, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-12-01 13:25:00", "提交", "YW20251201003", None),
    (900032, 1003, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-12-02 11:40:00", "提交", "YW20251201003", None),
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
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES "
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
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
                "create_time, status, instance_process_id, form_data) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
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
        assert no in LEGACY_PROCESS_IDS.values()


def test_migrate_legacy_candidates(api_client, legacy_mock_seeded):
    resp = api_client.get(
        "/api/tickets/migrate-legacy/candidates",
        params={"operator_id": OPERATOR, "limit": 50},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    pids = {it["process_id"] for it in data.get("items", [])}
    assert "YW20251103001" in pids
    assert "YW20251021002" in pids


def test_migrate_legacy_candidates_search(api_client, legacy_mock_seeded):
    resp = api_client.get(
        "/api/tickets/migrate-legacy/candidates",
        params={"operator_id": OPERATOR, "search": "YW20251103001"},
    )
    assert resp.status_code == 200, resp.text
    items = resp.json().get("items", [])
    assert len(items) >= 1
    assert all("YW20251103001" in it["process_id"] for it in items)

    resp_status = api_client.get(
        "/api/tickets/migrate-legacy/candidates",
        params={"operator_id": OPERATOR, "search": "关闭", "limit": 50},
    )
    assert resp_status.status_code == 200, resp_status.text
    status_data = resp_status.json()
    status_items = status_data.get("items", [])
    assert len(status_items) >= 1
    assert any("关闭" in str(it.get("status") or "") for it in status_items)
    assert status_data.get("truncated") is False


def test_migrate_legacy_candidates_search_returns_all_matches(api_client, legacy_mock_seeded):
    resp_limited = api_client.get(
        "/api/tickets/migrate-legacy/candidates",
        params={"operator_id": OPERATOR, "limit": 2},
    )
    assert resp_limited.status_code == 200, resp_limited.text
    limited = resp_limited.json()
    assert len(limited["items"]) == 2
    assert limited["truncated"] is True

    resp_search = api_client.get(
        "/api/tickets/migrate-legacy/candidates",
        params={"operator_id": OPERATOR, "search": "YW", "limit": 2},
    )
    assert resp_search.status_code == 200, resp_search.text
    search_data = resp_search.json()
    assert len(search_data["items"]) > 2
    assert search_data["truncated"] is False


def test_migrate_single_process_id(api_client, legacy_mock_seeded):
    body = {"operator_id": OPERATOR, "process_ids": ["YW20251103001"]}
    resp = api_client.post("/api/tickets/migrate-legacy", json=body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["migrated"] == 1, data
    assert data["ticket_nos"] == ["YW20251103001"]


def test_migrate_form_data_richtext_with_image(api_client, legacy_mock_seeded):
    """form_data 含完整富文本与图片时，应优先于被截断的 parse.column19。"""
    resp = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251021002"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["migrated"] == 1, resp.json()

    data_resp = api_client.get(
        "/api/tickets/YW20251021002/nodes/ops_analysis/data",
        params={"operator_id": OPERATOR},
    )
    assert data_resp.status_code == 200, data_resp.text
    values = data_resp.json().get("values") or {}
    track = str(values.get("issue_track") or "")
    assert "<img" in track.lower()
    assert "第二行进展" in track


def test_delete_migrated_tickets(api_client, legacy_mock_seeded):
    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001", "YW20251021002"]},
    )
    count_resp = api_client.get(
        "/api/tickets/migrate-legacy/migrated-count",
        params={"operator_id": OPERATOR},
    )
    assert count_resp.status_code == 200, count_resp.text
    assert count_resp.json()["count"] >= 2

    del_one = api_client.post(
        "/api/tickets/migrate-legacy/delete-migrated",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001"]},
    )
    assert del_one.status_code == 200, del_one.text
    assert del_one.json()["deleted"] == 1, del_one.json()
    assert del_one.json()["ticket_nos"] == ["YW20251103001"]

    del_rest = api_client.post(
        "/api/tickets/migrate-legacy/delete-migrated",
        json={"operator_id": OPERATOR, "limit": 500, "after_legacy_instance_id": 0},
    )
    assert del_rest.status_code == 200, del_rest.text
    assert del_rest.json()["deleted"] >= 1, del_rest.json()

    count_after = api_client.get(
        "/api/tickets/migrate-legacy/migrated-count",
        params={"operator_id": OPERATOR},
    )
    assert count_after.status_code == 200
    assert count_after.json()["count"] == 0

    assert _find_item(api_client, "YW20251103001") is None
    assert _find_item(api_client, "YW20251021002") is None


def test_repair_legacy_ticket_no_and_stage(api_client, legacy_mock_seeded):
    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001"]},
    )
    import os
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("DATABASE_URL")
    assert dsn
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.execute(
            "UPDATE ticket SET ticket_no = %s, status = %s WHERE legacy_instance_id = %s",
            ("WRONG_NO", "open", 1001),
        )
        conn.commit()

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001"]},
    )
    assert repair.status_code == 200, repair.text
    data = repair.json()
    assert data["repaired"] == 1, data
    assert "YW20251103001" in data["ticket_nos"]

    item = _find_item(api_client, "YW20251103001")
    assert item is not None
    assert item["status"] == "进行中"
    assert item["currentStage"] == "运维分析"


def test_repair_legacy_updates_stage_when_ticket_no_conflict(api_client, legacy_mock_seeded):
    """目标 process_id 被占用时先挪走占用方，再改回老库流程 ID。"""
    import os
    import psycopg
    from psycopg.rows import dict_row

    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001", "YW20251021002"]},
    )
    dsn = os.getenv("DATABASE_URL")
    assert dsn
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        row1001 = conn.execute(
            "SELECT id FROM ticket WHERE legacy_instance_id = %s", (1001,)
        ).fetchone()
        assert row1001
        conn.execute(
            """
            UPDATE ticket SET ticket_no = %s, status = %s, current_node_id = (
              SELECT id FROM workflow_node WHERE node_key = 'problem_fill' LIMIT 1
            )
            WHERE legacy_instance_id = %s
            """,
            ("WRONG_NO", "open", 1001),
        )
        conn.execute(
            "UPDATE ticket SET ticket_no = %s WHERE legacy_instance_id = %s",
            ("YW20251103001", 1002),
        )
        conn.commit()

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001"]},
    )
    assert repair.status_code == 200, repair.text
    data = repair.json()
    assert data["repaired"] == 1, data
    assert data.get("ticket_no_displaced") == 1, data
    assert data["failed"] == 0, data

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        row1001 = conn.execute(
            "SELECT ticket_no, status FROM ticket WHERE legacy_instance_id = %s", (1001,)
        ).fetchone()
        row1002 = conn.execute(
            "SELECT ticket_no FROM ticket WHERE legacy_instance_id = %s", (1002,)
        ).fetchone()
        assert row1001["ticket_no"] == "YW20251103001"
        assert row1001["status"] == "进行中"
        assert row1002["ticket_no"] == "YW20251021002"

    item = _find_item(api_client, "YW20251103001")
    assert item is not None
    assert item["currentStage"] == "运维分析"


def test_repair_rebuild_workflow_restores_full_node_history(api_client, legacy_mock_seeded):
    """重建流转须从老库 task 拉全字段，否则会把工单历史删成单条 processing。"""
    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251021002"]},
    )
    no = "YW20251021002"
    logs_before = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    assert len(logs_before) >= 6, logs_before

    dsn = _new_dsn()
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        row = conn.execute(
            "SELECT id FROM ticket WHERE legacy_instance_id = %s", (1002,)
        ).fetchone()
        assert row
        ticket_id = int(row["id"])
        conn.execute("DELETE FROM ticket_flow_log WHERE ticket_id = %s", (ticket_id,))
        conn.execute(
            "DELETE FROM ticket_node_data WHERE ticket_id = %s",
            (ticket_id,),
        )
        conn.execute(
            "DELETE FROM ticket_node_instance WHERE ticket_id = %s",
            (ticket_id,),
        )
        node_id = conn.execute(
            "SELECT id FROM workflow_node WHERE node_key = 'ops_analysis' LIMIT 1"
        ).fetchone()["id"]
        conn.execute(
            """
            INSERT INTO ticket_node_instance
              (ticket_id, node_id, handler_id, handler_name, action_status, started_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            """,
            (ticket_id, node_id, "l00002", "李潇雨", "processing"),
        )
        conn.commit()

    corrupted = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    assert len(corrupted) <= 1, corrupted

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": ["YW20251021002"],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    data = repair.json()
    assert data["repaired"] == 1, data
    assert data["failed"] == 0, data

    logs_after = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    assert len(logs_after) >= 6, logs_after
    to_nodes = [li["to"] for li in logs_after]
    assert "问题审核" in to_nodes
    assert "审核关闭" in to_nodes


def test_rebuild_workflow_preserves_node_data_when_legacy_parse_missing(
    api_client, legacy_mock_seeded
):
    """重建流转时若老库 parse 缺失，须保留新平台已落库的节点字段，不能只剩空流转日志。"""
    no = "YW20251103001"
    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [no]},
    )
    before = api_client.get(
        f"/api/tickets/{no}/nodes/problem_fill/data",
        params={"operator_id": OPERATOR},
    )
    assert before.status_code == 200, before.text
    expected = before.json()["values"]
    assert expected.get("location") == "农行"
    assert expected.get("severity") == "严重"

    with psycopg.connect(_legacy_dsn(), row_factory=dict_row) as legacy_conn:
        legacy_conn.execute(
            "DELETE FROM t_work_flow_task_parse WHERE instance_id = %s",
            (1001,),
        )
        legacy_conn.commit()

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [no],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    assert repair.json()["failed"] == 0, repair.json()

    after = api_client.get(
        f"/api/tickets/{no}/nodes/problem_fill/data",
        params={"operator_id": OPERATOR},
    )
    assert after.status_code == 200, after.text
    vals = after.json()["values"]
    assert vals.get("location") == expected.get("location")
    assert vals.get("severity") == expected.get("severity")
    assert vals.get("ecare_ticket_no") == expected.get("ecare_ticket_no")

    logs = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    assert len(logs) >= 2, logs


def test_backfill_placeholder_title_restores_issue_desc_from_legacy(
    api_client, legacy_mock_seeded
):
    """title 为 Order YW… 且节点字段被清空时，补全应从老库 instance/parse 恢复。"""
    no = "YW20251103001"
    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [no]},
    )

    with psycopg.connect(_new_dsn(), row_factory=dict_row) as conn:
        row = conn.execute(
            "SELECT id FROM ticket WHERE ticket_no = %s", (no,)
        ).fetchone()
        assert row
        ticket_id = int(row["id"])
        conn.execute(
            "UPDATE ticket SET title = %s WHERE id = %s",
            (f"Order {no}", ticket_id),
        )
        conn.execute(
            """
            UPDATE ticket_node_data
            SET values_json = (values_json - 'issue_desc' - 'location' - 'severity')
            WHERE ticket_id = %s
            """,
            (ticket_id,),
        )
        conn.commit()

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [no],
            "backfill_fields_from_legacy": True,
            "backfill_placeholder_only": True,
        },
    )
    assert repair.status_code == 200, repair.text
    body = repair.json()
    assert body["failed"] == 0, body
    assert body.get("fields_backfilled", 0) >= 1, body

    pf = api_client.get(
        f"/api/tickets/{no}/nodes/problem_fill/data",
        params={"operator_id": OPERATOR},
    )
    assert pf.status_code == 200, pf.text
    vals = pf.json()["values"]
    assert "农行" in str(vals.get("issue_desc") or "")
    assert vals.get("location") == "农行"
    assert vals.get("severity") == "严重"

    item = _find_item(api_client, no)
    assert item is not None
    assert "Order YW" not in str(item.get("description") or "")


def test_repair_legacy_batch_cursor(api_client, legacy_mock_seeded):
    api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": ["YW20251103001", "YW20251021002"]},
    )
    first = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={"operator_id": OPERATOR, "limit": 1, "after_legacy_instance_id": 0},
    )
    assert first.status_code == 200, first.text
    data = first.json()
    assert data.get("processed") == 1, data
    assert data.get("has_more") is True, data
    assert data.get("next_after_legacy_instance_id"), data

    second = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "limit": 1,
            "after_legacy_instance_id": data["next_after_legacy_instance_id"],
        },
    )
    assert second.status_code == 200, second.text
    rest = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "limit": 100,
            "after_legacy_instance_id": second.json()["next_after_legacy_instance_id"],
        },
    )
    assert rest.status_code == 200, rest.text
    assert rest.json().get("has_more") is False, rest.json()


def test_migrate_is_idempotent(api_client, legacy_mock_seeded):
    first = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    assert first["migrated"] == 3
    second = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    assert second["migrated"] == 0, second
    assert second["skipped_existing"] == 3, second


def test_migrate_legacy_batch_cursor(api_client, legacy_mock_seeded):
    """迁入全部时可按 max_total + after_legacy_instance_id 分批续跑。"""
    first = api_client.post(
        "/api/tickets/migrate-legacy",
        json={
            "operator_id": OPERATOR,
            "batch_size": 1,
            "max_total": 1,
            "after_legacy_instance_id": 0,
            "refresh_snapshot": False,
        },
    )
    assert first.status_code == 200, first.text
    data = first.json()
    assert data["processed"] == 1, data
    assert data["migrated"] == 1, data
    assert data.get("has_more") is True, data
    assert data.get("next_after_legacy_instance_id") == 1001, data

    second = api_client.post(
        "/api/tickets/migrate-legacy",
        json={
            "operator_id": OPERATOR,
            "batch_size": 1,
            "max_total": 1,
            "after_legacy_instance_id": data["next_after_legacy_instance_id"],
            "refresh_snapshot": False,
        },
    )
    assert second.status_code == 200, second.text
    data2 = second.json()
    assert data2["processed"] == 1, data2
    assert data2["migrated"] == 1, data2
    assert data2.get("has_more") is True, data2
    assert data2.get("next_after_legacy_instance_id") == 1002, data2


def test_migrate_legacy_max_total_zero(api_client, legacy_mock_seeded):
    """max_total=0 时不处理任何实例（供前端仅 refresh_snapshot 时占位）。"""
    resp = api_client.post(
        "/api/tickets/migrate-legacy",
        json={
            "operator_id": OPERATOR,
            "max_total": 0,
            "refresh_snapshot": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("processed") == 0, body
    assert body.get("migrated") == 0, body
    assert "ticket_nos" not in body
    full = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY)
    assert full.status_code == 200, full.text
    full_body = full.json()
    assert full_body["migrated"] == 3, full_body
    assert "ticket_nos" not in full_body
    if full_body.get("migrated"):
        assert "ticket_nos_count" in full_body


def test_migrated_open_ticket_fields_and_stage(api_client, legacy_mock_seeded):
    data = api_client.post("/api/tickets/migrate-legacy", json=MIGRATE_BODY).json()
    # 迁移顺序按 instance.id 升序：[1001, 1002, 1003]
    no_1001 = data["ticket_nos"][0]

    item = _find_item(api_client, no_1001)
    assert item is not None, "迁入的进行中工单未出现在工作台列表"
    assert item["status"] == "进行中"
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
    assert item["status"] == "关闭"
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
    "工行容灾切换演练超时", "一般", "YW20250810005", "申宇", "s00001",
    "2025-08-10 09:00:00", "2025-08-15 18:00:00", "0",
)
# (pk, iid, cur, nxt, nxt_name, nxt_id, cr_name, cr_id, time, status, process_id)；creator 恒为发起人
_REG_TASKS = [
    (901050, 1005, "问题填写", "问题审核", "李长军", "l00003", "申宇", "s00001", "2025-08-10 09:00:00", "提交", "YW20250810005"),
    (901051, 1005, "问题审核", "运维分析", "李潇雨", "l00002", "申宇", "s00001", "2025-08-11 09:00:00", "提交", "YW20250810005"),
    (901052, 1005, "运维分析", "开发分析", "宋康", "s00007", "申宇", "s00001", "2025-08-12 09:00:00", "提交", "YW20250810005"),
    (901053, 1005, "开发分析", "开发闭环", "李博闻", "l00008", "申宇", "s00001", "2025-08-13 09:00:00", "提交", "YW20250810005"),
    (901054, 1005, "开发闭环", "运维闭环", "李潇雨", "l00002", "申宇", "s00001", "2025-08-14 09:00:00", "提交", "YW20250810005"),
    (901055, 1005, "运维闭环", "审核关闭", "徐齐刚", "x00006", "申宇", "s00001", "2025-08-15 09:00:00", "提交", "YW20250810005"),
    (901056, 1005, "审核关闭", "", "", "", "申宇", "s00001", "2025-08-15 18:00:00", "关闭", "YW20250810005"),
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
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _REG_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
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


# —— 回归：老库无 t_work_flow_task 流转记录（兜底分支）——
# 源库没有逐阶段处理人时，不臆造中间阶段：只还原「问题填写(提单人) + 当前/末节点
# (当前处理人)」，中间阶段不显示、不计入运维效率。
_NOTASK_ID = 1006
_NOTASK_INSTANCE = (
    1006, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
    "招行存储扩容后 IO 抖动", "一般", "YW20250701006", "申宇", "s00001",
    "2025-07-01 09:00:00", "2025-07-05 18:00:00", "0",
)


@pytest.fixture()
def legacy_no_task_seeded():
    """灌入一条「无任何 t_work_flow_task 流转记录」的已关闭工单。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute("DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s", (_NOTASK_ID,))
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_NOTASK_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_NOTASK_ID,))
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _NOTASK_INSTANCE,
            )
            # 故意不插入任何 t_work_flow_task 记录
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrated_no_task_only_shows_known_stages(api_client, legacy_no_task_seeded):
    """无流转记录时只显示问题填写+审核关闭，不臆造中间阶段、不塌缩成提单人。"""
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "batch_size": 1, "max_total": 1},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]

    logs = api_client.get(f"/api/tickets/{no}/logs")
    assert logs.status_code == 200
    items = logs.json()["items"]
    nodes = {li["from"] for li in items} | {li["to"] for li in items}

    # 只保留确知的两段
    assert "问题填写" in nodes
    assert "审核关闭" in nodes
    # 中间阶段一律不显示
    for mid in ("问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环"):
        assert mid not in nodes, f"无流转工单不应臆造中间阶段「{mid}」：{nodes}"

    # 处理人：问题填写=提单人申宇，审核关闭=当前处理人徐齐刚（不塌缩成提单人）
    actor_by_from = {li["from"]: li["actor"] for li in items}
    assert "申宇" in actor_by_from.get("问题填写", "")
    assert "徐齐刚" in actor_by_from.get("审核关闭", "")


# —— 回归：运维闭环已提交审核关闭、停在审核关闭待终态（status=问题审核关闭）——
_AUDIT_PENDING_ID = 1007
_AUDIT_PENDING_PROCESS_ID = "YW20250601007"
_AUDIT_PENDING_INSTANCE = (
    1007, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "问题审核关闭",
    "中行容灾演练后待审核关闭", "一般", _AUDIT_PENDING_PROCESS_ID, "董海俊", "d00004",
    "2025-06-01 10:00:00", "2025-06-05 16:00:00", "0",
)
_AUDIT_PENDING_TASKS = [
    (901070, 1007, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-06-01 10:00:00", "提交", _AUDIT_PENDING_PROCESS_ID),
    (901071, 1007, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-06-02 09:00:00", "提交", _AUDIT_PENDING_PROCESS_ID),
    (901072, 1007, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-06-03 09:00:00", "提交", _AUDIT_PENDING_PROCESS_ID),
    (901073, 1007, "开发分析", "开发闭环", "李博闻", "l00008", "宋康", "s00007", "2025-06-04 09:00:00", "提交", _AUDIT_PENDING_PROCESS_ID),
    (901074, 1007, "开发闭环", "运维闭环", "李潇雨", "l00002", "李博闻", "l00008", "2025-06-04 14:00:00", "提交", _AUDIT_PENDING_PROCESS_ID),
    (901075, 1007, "运维闭环", "审核关闭", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-06-05 16:00:00", "提交", _AUDIT_PENDING_PROCESS_ID),
]


@pytest.fixture()
def legacy_audit_close_pending_seeded():
    """运维闭环已提交审核关闭，实例停在审核关闭、状态为问题审核关闭（非终态）。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute("DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s", (_AUDIT_PENDING_ID,))
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_AUDIT_PENDING_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_AUDIT_PENDING_ID,))
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _AUDIT_PENDING_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _AUDIT_PENDING_TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrated_audit_close_pending_ops_submit_not_close(
    api_client, legacy_audit_close_pending_seeded
):
    """status=问题审核关闭 时不得当作终态；运维闭环→审核关闭 应为 submit。"""
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_AUDIT_PENDING_PROCESS_ID]},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]

    item = _find_item(api_client, no)
    assert item is not None
    assert item["status"] == "问题审核关闭"
    assert item["currentStage"] == "审核关闭"
    assert "徐齐刚" in item["currentHandler"]
    assert not item.get("closedAt")

    logs = api_client.get(f"/api/tickets/{no}/logs")
    assert logs.status_code == 200
    items = logs.json()["items"]
    ops_submit = [
        li for li in items
        if li.get("from") == "运维闭环" and li.get("to") == "审核关闭"
    ]
    assert ops_submit, f"缺少运维闭环→审核关闭提交日志：{items}"
    assert ops_submit[-1].get("action") != "close"
    bad_close = [
        li for li in items
        if li.get("from") == "运维闭环"
        and li.get("to") == "运维闭环"
        and li.get("action") == "close"
    ]
    assert not bad_close, f"不应在运维闭环记 close：{bad_close}"


# —— 回归：status=暂时挂起（实例 current 为空，末条 task 在审核关闭挂起）——
_TEMP_SUSPENDED_ID = 1016
_TEMP_SUSPENDED_PID = "YW20250601016"
_TEMP_SUSPENDED_INSTANCE = (
    _TEMP_SUSPENDED_ID, "HCS问题处理", "", "徐齐刚", "x00006", "暂时挂起",
    "审核关闭节点暂时挂起", "一般", _TEMP_SUSPENDED_PID, "董海俊", "d00004",
    "2025-06-01 10:00:00", "2025-06-05 18:00:00", "0",
)
_TEMP_SUSPENDED_TASKS = [
    (901160, _TEMP_SUSPENDED_ID, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-06-01 10:00:00", "提交", _TEMP_SUSPENDED_PID),
    (901161, _TEMP_SUSPENDED_ID, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-06-02 09:00:00", "提交", _TEMP_SUSPENDED_PID),
    (901162, _TEMP_SUSPENDED_ID, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-06-03 09:00:00", "提交", _TEMP_SUSPENDED_PID),
    (901163, _TEMP_SUSPENDED_ID, "开发分析", "开发闭环", "李博闻", "l00008", "宋康", "s00007", "2025-06-04 09:00:00", "提交", _TEMP_SUSPENDED_PID),
    (901164, _TEMP_SUSPENDED_ID, "开发闭环", "运维闭环", "李潇雨", "l00002", "李博闻", "l00008", "2025-06-04 14:00:00", "提交", _TEMP_SUSPENDED_PID),
    (901165, _TEMP_SUSPENDED_ID, "运维闭环", "审核关闭", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-06-05 16:00:00", "提交", _TEMP_SUSPENDED_PID),
    (901166, _TEMP_SUSPENDED_ID, "审核关闭", "", "", "", "徐齐刚", "x00006", "2025-06-05 18:00:00", "暂时挂起", _TEMP_SUSPENDED_PID),
]


@pytest.fixture()
def legacy_temporary_suspended_seeded():
    """status=暂时挂起，实例 current 节点名为空，末条 task 为审核关闭挂起。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_TEMP_SUSPENDED_ID,),
        )
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_TEMP_SUSPENDED_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_TEMP_SUSPENDED_ID,))
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _TEMP_SUSPENDED_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _TEMP_SUSPENDED_TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrated_temporary_suspended_stage_and_handler(
    api_client, legacy_temporary_suspended_seeded
):
    """status=暂时挂起 迁入后当前阶段为暂时挂起，处理人为 current_assignee。"""
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_TEMP_SUSPENDED_PID]},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]

    item = _find_item(api_client, no)
    assert item is not None
    assert item["status"] == "暂时挂起"
    assert item["currentStage"] == "暂时挂起"
    assert "徐齐刚" in item["currentHandler"]

    debug = api_client.get(f"/api/tickets/{no}/debug-status")
    assert debug.status_code == 200
    assert debug.json()["current_node_key"] == "audit_close"


def test_rebuild_workflow_temporary_suspended(
    api_client, legacy_temporary_suspended_seeded
):
    """重建流转：暂时挂起单不得落成问题填写。"""
    mig = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_TEMP_SUSPENDED_PID]},
    )
    assert mig.status_code == 200, mig.text
    no = mig.json()["ticket_nos"][0]

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [_TEMP_SUSPENDED_PID],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    assert repair.json()["repaired"] == 1, repair.json()

    item = _find_item(api_client, no)
    assert item is not None
    assert item["currentStage"] == "暂时挂起"
    assert "徐齐刚" in item["currentHandler"]
    assert item["currentStage"] != "问题填写"

    debug = api_client.get(f"/api/tickets/{no}/debug-status")
    assert debug.status_code == 200
    assert debug.json()["current_node_key"] == "audit_close"


# —— 回归：老库节点名误存「问题审核」（status=问题审核关闭，运维闭环→问题审核）——
_AUDIT_MISNAMED_ID = 1013
_AUDIT_MISNAMED_PID = "YW20250601013"
_AUDIT_MISNAMED_INSTANCE = (
    1013, "HCS问题处理", "问题审核", "徐齐刚", "x00006", "问题审核关闭",
    "运维闭环后节点名误存问题审核", "一般", _AUDIT_MISNAMED_PID, "董海俊", "d00004",
    "2025-06-01 10:00:00", "2025-06-05 16:00:00", "0",
)
_AUDIT_MISNAMED_TASKS = [
    (901130, 1013, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-06-01 10:00:00", "提交", _AUDIT_MISNAMED_PID),
    (901131, 1013, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-06-02 09:00:00", "提交", _AUDIT_MISNAMED_PID),
    (901132, 1013, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-06-03 09:00:00", "提交", _AUDIT_MISNAMED_PID),
    (901133, 1013, "开发分析", "开发闭环", "李博闻", "l00008", "宋康", "s00007", "2025-06-04 09:00:00", "提交", _AUDIT_MISNAMED_PID),
    (901134, 1013, "开发闭环", "运维闭环", "李潇雨", "l00002", "李博闻", "l00008", "2025-06-04 14:00:00", "提交", _AUDIT_MISNAMED_PID),
    (901135, 1013, "运维人员闭环", "问题审核", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-06-05 16:00:00", "提交", _AUDIT_MISNAMED_PID),
]


@pytest.fixture()
def legacy_audit_close_misnamed_node_seeded():
    """实例 current 与末条 task next 均误存「问题审核」，status=问题审核关闭。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_AUDIT_MISNAMED_ID,),
        )
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_AUDIT_MISNAMED_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_AUDIT_MISNAMED_ID,))
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _AUDIT_MISNAMED_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _AUDIT_MISNAMED_TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_rebuild_workflow_ops_to_misnamed_audit_close_not_problem_review(
    api_client, legacy_audit_close_misnamed_node_seeded
):
    """运维闭环→问题审核（误存）+ status=问题审核关闭 不得落成 problem_review。"""
    mig = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_AUDIT_MISNAMED_PID]},
    )
    assert mig.status_code == 200, mig.text
    assert mig.json()["migrated"] == 1, mig.json()
    no = mig.json()["ticket_nos"][0]

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [_AUDIT_MISNAMED_PID],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    assert repair.json()["failed"] == 0, repair.json()

    item = _find_item(api_client, no)
    assert item is not None
    assert item["status"] == "问题审核关闭"
    assert item["currentStage"] == "审核关闭"
    assert "徐齐刚" in item["currentHandler"]

    logs = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    ops_submit = [
        li for li in logs
        if li.get("from") in ("运维闭环", "运维人员闭环") and li.get("to") == "审核关闭"
    ]
    assert ops_submit, f"末条应为运维闭环→审核关闭：{logs}"
    bad = [li for li in logs if li.get("from") in ("运维闭环", "运维人员闭环") and li.get("to") == "问题审核"]
    assert not bad, f"不应出现运维闭环→问题审核：{bad}"


# —— 回归：status=进行中 但节点名误存「问题审核」（末条 task 为运维闭环）——
_AUDIT_MISNAMED_OPEN_ID = 1014
_AUDIT_MISNAMED_OPEN_PID = "YW20250601014"
_AUDIT_MISNAMED_OPEN_INSTANCE = (
    1014, "HCS问题处理", "问题审核", "徐齐刚", "x00006", "进行中",
    "status进行中节点名误存", "一般", _AUDIT_MISNAMED_OPEN_PID, "董海俊", "d00004",
    "2025-06-01 10:00:00", "2025-06-05 16:00:00", "0",
)


@pytest.fixture()
def legacy_audit_close_misnamed_open_status_seeded():
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_AUDIT_MISNAMED_OPEN_ID,),
        )
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_AUDIT_MISNAMED_OPEN_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_AUDIT_MISNAMED_OPEN_ID,))
        new.commit()

    open_tasks = [
        (901140, 1014, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-06-01 10:00:00", "提交", _AUDIT_MISNAMED_OPEN_PID),
        (901141, 1014, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-06-02 09:00:00", "提交", _AUDIT_MISNAMED_OPEN_PID),
        (901142, 1014, "运维分析", "开发分析", "宋康", "s00007", "李潇雨", "l00002", "2025-06-03 09:00:00", "提交", _AUDIT_MISNAMED_OPEN_PID),
        (901143, 1014, "开发分析", "开发闭环", "李博闻", "l00008", "宋康", "s00007", "2025-06-04 09:00:00", "提交", _AUDIT_MISNAMED_OPEN_PID),
        (901144, 1014, "开发闭环", "运维闭环", "李潇雨", "l00002", "李博闻", "l00008", "2025-06-04 14:00:00", "提交", _AUDIT_MISNAMED_OPEN_PID),
        (901145, 1014, "运维人员闭环", "问题审核", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-06-05 16:00:00", "提交", _AUDIT_MISNAMED_OPEN_PID),
    ]

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _AUDIT_MISNAMED_OPEN_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                open_tasks,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrate_open_status_misnamed_audit_close_stage(
    api_client, legacy_audit_close_misnamed_open_status_seeded
):
    """status=进行中 且末条 task 为运维闭环时，current 不得仍为问题审核。"""
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_AUDIT_MISNAMED_OPEN_PID]},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]
    item = _find_item(api_client, no)
    assert item is not None
    assert item["status"] == "进行中"
    assert item["currentStage"] == "审核关闭"


# —— 回归：终态 status=关闭 但 task 末条为运维闭环→审核关闭（实例 current=审核关闭）——
_CLOSED_OPS_TO_AUDIT_ID = 1008
_CLOSED_OPS_TO_AUDIT_PID = "YW20250810008"
_CLOSED_OPS_TO_AUDIT_INSTANCE = (
    1008, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
    "已提交审核关闭待终态", "一般", _CLOSED_OPS_TO_AUDIT_PID, "董海俊", "d00004",
    "2025-08-20 10:00:00", "2025-08-22 18:00:00", "0",
)
_CLOSED_OPS_TO_AUDIT_TASKS = [
    (901080, 1008, "问题填写", "问题审核", "李长军", "l00003", "董海俊", "d00004", "2025-08-20 10:00:00", "提交", _CLOSED_OPS_TO_AUDIT_PID),
    (901081, 1008, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-08-21 09:00:00", "提交", _CLOSED_OPS_TO_AUDIT_PID),
    (901082, 1008, "运维分析", "运维闭环", "李潇雨", "l00002", "李潇雨", "l00002", "2025-08-22 09:00:00", "提交", _CLOSED_OPS_TO_AUDIT_PID),
    (901083, 1008, "运维闭环", "审核关闭", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-08-22 17:00:00", "提交", _CLOSED_OPS_TO_AUDIT_PID),
]


@pytest.fixture()
def legacy_closed_ops_submit_audit_seeded():
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_CLOSED_OPS_TO_AUDIT_ID,),
        )
        legacy.execute(
            "DELETE FROM t_work_flow_instance WHERE id = %s", (_CLOSED_OPS_TO_AUDIT_ID,)
        )
        legacy.commit()
        new.execute(
            "DELETE FROM ticket WHERE legacy_instance_id = %s", (_CLOSED_OPS_TO_AUDIT_ID,)
        )
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _CLOSED_OPS_TO_AUDIT_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _CLOSED_OPS_TO_AUDIT_TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrated_closed_ops_submit_audit_not_ops_close(
    api_client, legacy_closed_ops_submit_audit_seeded
):
    """末条 task 为运维闭环→审核关闭时，不得记运维闭环→运维闭环 close。"""
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_CLOSED_OPS_TO_AUDIT_PID]},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]

    item = _find_item(api_client, no)
    assert item is not None
    assert item["status"] == "关闭"
    assert item["currentStage"] == "已关闭"

    logs = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    ops_submit = [
        li for li in logs
        if li.get("from") == "运维闭环" and li.get("to") == "审核关闭"
    ]
    assert ops_submit, f"应有运维闭环→审核关闭 submit：{logs}"
    assert ops_submit[-1].get("action") == "submit"
    bad_close = [
        li for li in logs
        if li.get("from") == "运维闭环"
        and li.get("to") == "运维闭环"
        and li.get("action") == "close"
    ]
    assert not bad_close, bad_close


# —— 回归：status 原样保留「非问题关闭」——
_NON_ISSUE_CLOSE_ID = 1009
_NON_ISSUE_CLOSE_PID = "YW20250810009"
_NON_ISSUE_CLOSE_INSTANCE = (
    1009, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "非问题关闭",
    "判定为非问题关闭", "一般", _NON_ISSUE_CLOSE_PID, "申宇", "s00001",
    "2025-08-25 10:00:00", "2025-08-26 18:00:00", "0",
)
_NON_ISSUE_CLOSE_TASKS = [
    (901090, 1009, "问题填写", "问题审核", "李长军", "l00003", "申宇", "s00001", "2025-08-25 10:00:00", "提交", _NON_ISSUE_CLOSE_PID),
    (901091, 1009, "问题审核", "运维分析", "李潇雨", "l00002", "李长军", "l00003", "2025-08-25 14:00:00", "提交", _NON_ISSUE_CLOSE_PID),
    (901092, 1009, "运维分析", "运维闭环", "李潇雨", "l00002", "李潇雨", "l00002", "2025-08-26 09:00:00", "提交", _NON_ISSUE_CLOSE_PID),
    (901093, 1009, "运维闭环", "审核关闭", "徐齐刚", "x00006", "李潇雨", "l00002", "2025-08-26 16:00:00", "提交", _NON_ISSUE_CLOSE_PID),
    (901094, 1009, "审核关闭", "", "", "", "徐齐刚", "x00006", "2025-08-26 18:00:00", "非问题关闭", _NON_ISSUE_CLOSE_PID),
]


@pytest.fixture()
def legacy_non_issue_close_seeded():
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_NON_ISSUE_CLOSE_ID,),
        )
        legacy.execute(
            "DELETE FROM t_work_flow_instance WHERE id = %s", (_NON_ISSUE_CLOSE_ID,)
        )
        legacy.commit()
        new.execute(
            "DELETE FROM ticket WHERE legacy_instance_id = %s", (_NON_ISSUE_CLOSE_ID,)
        )
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _NON_ISSUE_CLOSE_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _NON_ISSUE_CLOSE_TASKS,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrated_status_keeps_non_issue_close_literal(
    api_client, legacy_non_issue_close_seeded
):
    """老库 status=非问题关闭 须原样写入，不得改成关闭或其它文案。"""
    data = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_NON_ISSUE_CLOSE_PID]},
    ).json()
    assert data["migrated"] == 1, data
    no = data["ticket_nos"][0]

    item = _find_item(api_client, no)
    assert item is not None
    assert item["status"] == "非问题关闭"
    assert item["currentStage"] == "已关闭"

    logs = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    audit_close = [
        li for li in logs
        if li.get("from") == "审核关闭"
        and li.get("to") == "审核关闭"
        and li.get("action") == "close"
    ]
    assert audit_close, f"非问题关闭应在审核关闭记 close：{logs}"


# —— 回归：末次关闭 task 的 current_work_flow_node_name 误存为「关闭」时重建流转可映射 ——
_CLOSE_TASK_NAME_ID = 1010
_CLOSE_TASK_NAME_PID = "YW20250810010"
_CLOSE_TASK_NAME_INSTANCE = (
    _CLOSE_TASK_NAME_ID, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
    "末次关闭节点名误存为关闭", "一般", _CLOSE_TASK_NAME_PID, "申宇", "s00001",
    "2025-08-27 10:00:00", "2025-08-27 18:00:00", "0",
)


@pytest.fixture()
def legacy_close_task_node_name_seeded():
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_CLOSE_TASK_NAME_ID,),
        )
        legacy.execute(
            "DELETE FROM t_work_flow_instance WHERE id = %s", (_CLOSE_TASK_NAME_ID,)
        )
        legacy.commit()
        new.execute(
            "DELETE FROM ticket WHERE legacy_instance_id = %s", (_CLOSE_TASK_NAME_ID,)
        )
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.executemany(
                "INSERT INTO t_work_flow_node (id, node_name) VALUES (%s, %s) "
                "ON CONFLICT (id) DO UPDATE SET node_name = EXCLUDED.node_name",
                _LEGACY_NODE_ROWS,
            )
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _CLOSE_TASK_NAME_INSTANCE,
            )
            cur.execute(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "next_work_flow_node_name, next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    901100, _CLOSE_TASK_NAME_ID, "关闭", "", "", "",
                    "徐齐刚", "x00006", "2025-08-27 18:00:00", "关闭", _CLOSE_TASK_NAME_PID,
                ),
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_rebuild_workflow_maps_close_action_node_name(
    api_client, legacy_close_task_node_name_seeded
):
    """仅 1 条 task 且 current_work_flow_node_name=关闭 时，重建流转应映射到审核关闭而非中止。"""
    mig = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_CLOSE_TASK_NAME_PID]},
    )
    assert mig.status_code == 200, mig.text
    assert mig.json()["migrated"] == 1, mig.json()

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [_CLOSE_TASK_NAME_PID],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    data = repair.json()
    assert data["failed"] == 0, data
    assert data["repaired"] == 1, data

    logs = api_client.get(f"/api/tickets/{_CLOSE_TASK_NAME_PID}/logs").json()["items"]
    audit_close = [
        li for li in logs
        if li.get("from") == "审核关闭"
        and li.get("to") == "审核关闭"
        and li.get("action") == "close"
    ]
    assert audit_close, f"关闭 task 应映射为审核关闭 close 日志：{logs}"


# —— 回归：task 仅有 node_id、节点名为空时重建流转可映射 ——
_NODE_ID_ONLY_ID = 1011
_NODE_ID_ONLY_PID = "YW20250810011"
_NODE_ID_ONLY_INSTANCE = (
    _NODE_ID_ONLY_ID, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
    "task 仅带 node_id", "一般", _NODE_ID_ONLY_PID, "申宇", "s00001",
    "2025-08-28 10:00:00", "2025-08-28 18:00:00", "0",
)


@pytest.fixture()
def legacy_task_node_id_only_seeded():
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_NODE_ID_ONLY_ID,),
        )
        legacy.execute(
            "DELETE FROM t_work_flow_instance WHERE id = %s", (_NODE_ID_ONLY_ID,)
        )
        legacy.commit()
        new.execute(
            "DELETE FROM ticket WHERE legacy_instance_id = %s", (_NODE_ID_ONLY_ID,)
        )
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.executemany(
                "INSERT INTO t_work_flow_node (id, node_name) VALUES (%s, %s) "
                "ON CONFLICT (id) DO UPDATE SET node_name = EXCLUDED.node_name",
                _LEGACY_NODE_ROWS,
            )
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _NODE_ID_ONLY_INSTANCE,
            )
            cur.execute(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_id, "
                "current_work_flow_node_name, next_work_flow_node_id, next_work_flow_node_name, "
                "next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    901110, _NODE_ID_ONLY_ID, 7, "", None, "",
                    "", "", "徐齐刚", "x00006",
                    "2025-08-28 18:00:00", "关闭", _NODE_ID_ONLY_PID,
                ),
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_rebuild_workflow_maps_task_node_id_without_name(
    api_client, legacy_task_node_id_only_seeded
):
    """task 节点名为空但带 node_id=7 时，重建流转应映射到审核关闭。"""
    mig = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_NODE_ID_ONLY_PID]},
    )
    assert mig.status_code == 200, mig.text
    assert mig.json()["migrated"] == 1, mig.json()

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [_NODE_ID_ONLY_PID],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    data = repair.json()
    assert data["failed"] == 0, data
    assert data["repaired"] == 1, data


# —— 回归：更老流程首节点「BU人员填写」(node_id=8) 映射为问题填写 ——
_BU_FILL_ID = 1012
_BU_FILL_PID = "YW20250810012"
_BU_FILL_INSTANCE = (
    _BU_FILL_ID, "HCS问题处理", "审核关闭", "徐齐刚", "x00006", "关闭",
    "更老首节点 BU人员填写", "一般", _BU_FILL_PID, "申宇", "s00001",
    "2025-08-29 10:00:00", "2025-08-29 18:00:00", "0",
)


@pytest.fixture()
def legacy_bu_fill_node_seeded():
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_BU_FILL_ID,),
        )
        legacy.execute("DELETE FROM t_work_flow_instance WHERE id = %s", (_BU_FILL_ID,))
        legacy.commit()
        new.execute("DELETE FROM ticket WHERE legacy_instance_id = %s", (_BU_FILL_ID,))
        new.commit()

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.executemany(
                "INSERT INTO t_work_flow_node (id, node_name) VALUES (%s, %s) "
                "ON CONFLICT (id) DO UPDATE SET node_name = EXCLUDED.node_name",
                _LEGACY_NODE_ROWS + [(8, "BU人员填写")],
            )
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _BU_FILL_INSTANCE,
            )
            cur.execute(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "current_work_flow_node_id, next_work_flow_node_name, next_work_flow_node_id, "
                "next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    901120, _BU_FILL_ID, "BU人员填写", 8, "问题审核", 2,
                    "李长军", "l00003", "申宇", "s00001",
                    "2025-08-29 10:00:00", "提交", _BU_FILL_PID,
                ),
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def test_migrate_maps_bu_fill_node_to_problem_fill(
    api_client, legacy_bu_fill_node_seeded
):
    """更老库首节点「BU人员填写」(node_id=8) 应映射为新平台「问题填写」。"""
    mig = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_BU_FILL_PID]},
    )
    assert mig.status_code == 200, mig.text
    assert mig.json()["migrated"] == 1, mig.json()
    no = mig.json()["ticket_nos"][0]

    logs = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    fill_logs = [li for li in logs if li.get("from") == "问题填写"]
    assert fill_logs, f"应有问题填写节点流转：{logs}"


# —— 回归：开发分析→开发闭环 next 误存（node_id=问题审核 或 node_name=问题审核）——
_DEV_NEXT_MISNAMED_ID = 1015
_DEV_NEXT_MISNAMED_PID = "YW20250601015"
_DEV_NEXT_MISNAMED_INSTANCE = (
    _DEV_NEXT_MISNAMED_ID, "HCS问题处理", "开发人员闭环", "李博闻", "l00008", "进行中",
    "开发分析提交后 next 误存", "一般", _DEV_NEXT_MISNAMED_PID, "董海俊", "d00004",
    "2025-06-01 10:00:00", "2025-06-04 14:00:00", "0",
)


@pytest.fixture()
def legacy_dev_analysis_next_misnamed_seeded():
    """末条 task 为开发分析→开发闭环，但 next 的 node_id 或 node_name 误存为问题审核。"""
    legacy = psycopg.connect(_legacy_dsn(), row_factory=dict_row)
    new = psycopg.connect(_new_dsn(), row_factory=dict_row)

    def _clean():
        legacy.execute(
            "DELETE FROM t_work_flow_task WHERE work_flow_instance_id = %s",
            (_DEV_NEXT_MISNAMED_ID,),
        )
        legacy.execute(
            "DELETE FROM t_work_flow_instance WHERE id = %s", (_DEV_NEXT_MISNAMED_ID,)
        )
        legacy.commit()
        new.execute(
            "DELETE FROM ticket WHERE legacy_instance_id = %s", (_DEV_NEXT_MISNAMED_ID,)
        )
        new.commit()

    tasks = [
        (901150, 1015, "问题填写", 1, "问题审核", 2, "李长军", "l00003", "董海俊", "d00004", "2025-06-01 10:00:00", "提交", _DEV_NEXT_MISNAMED_PID),
        (901151, 1015, "问题审核", 2, "运维分析", 3, "李潇雨", "l00002", "李长军", "l00003", "2025-06-02 09:00:00", "提交", _DEV_NEXT_MISNAMED_PID),
        (901152, 1015, "运维分析", 3, "开发分析", 4, "宋康", "s00007", "李潇雨", "l00002", "2025-06-03 09:00:00", "提交", _DEV_NEXT_MISNAMED_PID),
        # next 节点名正确、node_id 误为 2（问题审核）
        (901153, 1015, "开发人员分析", 4, "开发人员闭环", 2, "李博闻", "l00008", "宋康", "s00007", "2025-06-04 09:00:00", "提交", _DEV_NEXT_MISNAMED_PID),
    ]

    try:
        for ddl in _CREATE_TABLES:
            legacy.execute(ddl)
        legacy.commit()
        _clean()
        with legacy.cursor() as cur:
            cur.executemany(
                "INSERT INTO t_work_flow_node (id, node_name) VALUES (%s, %s) "
                "ON CONFLICT (id) DO UPDATE SET node_name = EXCLUDED.node_name",
                _LEGACY_NODE_ROWS,
            )
            cur.execute(
                "INSERT INTO t_work_flow_instance (id, work_flow_info_name, current_work_flow_node_name, "
                "current_assignee, current_assignee_id, status, description, issue_severity, process_id, "
                "creator_name, creator_id, create_time, update_time, deleted) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                _DEV_NEXT_MISNAMED_INSTANCE,
            )
            cur.executemany(
                "INSERT INTO t_work_flow_task (id, work_flow_instance_id, current_work_flow_node_name, "
                "current_work_flow_node_id, next_work_flow_node_name, next_work_flow_node_id, "
                "next_assignee, next_assignee_id, creator_name, creator_id, "
                "create_time, status, instance_process_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                tasks,
            )
        legacy.commit()
        yield
    finally:
        _clean()
        legacy.close()
        new.close()


def _mock_node_meta():
    return {
        key: {"id": idx + 1, "order": idx + 1}
        for idx, key in enumerate(
            (
                "problem_fill",
                "problem_review",
                "ops_analysis",
                "dev_analysis",
                "dev_closure",
                "ops_closure",
                "audit_close",
            )
        )
    }


def test_legacy_next_node_corrects_dev_analysis_misnamed_review_unit():
    """单元：开发分析 next 误存问题审核时须纠正为开发闭环（迁入/重建共用逻辑）。"""
    from backend.legacy_migration import (
        _legacy_instance_current_node_key,
        _legacy_task_next_node_key,
    )

    meta = _mock_node_meta()
    # node_name 正确、node_id 误为 2
    task_name_ok = {
        "next_work_flow_node_name": "开发人员闭环",
        "next_work_flow_node_id": 2,
    }
    assert (
        _legacy_task_next_node_key(
            task_name_ok, meta, from_node_key="dev_analysis"
        )
        == "dev_closure"
    )
    # node_name 误为问题审核、node_id 正确
    task_id_ok = {
        "next_work_flow_node_name": "问题审核",
        "next_work_flow_node_id": 5,
    }
    assert (
        _legacy_task_next_node_key(
            task_id_ok, meta, from_node_key="dev_analysis"
        )
        == "dev_closure"
    )
    # 两者均误存
    task_both_bad = {
        "next_work_flow_node_name": "问题审核",
        "next_work_flow_node_id": 2,
    }
    assert (
        _legacy_task_next_node_key(
            task_both_bad, meta, from_node_key="dev_analysis"
        )
        == "dev_closure"
    )
    # 运维闭环→问题审核 仍须纠正为审核关闭（原回归）
    assert (
        _legacy_task_next_node_key(
            {"next_work_flow_node_name": "问题审核", "next_work_flow_node_id": 2},
            meta,
            from_node_key="ops_closure",
        )
        == "audit_close"
    )

    tasks = [
        {
            "current_work_flow_node_name": "开发人员分析",
            "current_work_flow_node_id": 4,
            "next_work_flow_node_name": "开发人员闭环",
            "next_work_flow_node_id": 2,
        }
    ]
    inst = {
        "status": "进行中",
        "current_work_flow_node_name": "开发人员闭环",
        "current_work_flow_node_id": 2,
    }
    assert (
        _legacy_instance_current_node_key(
            inst, meta, tasks=tasks
        )
        == "dev_closure"
    )


def test_legacy_temporary_suspended_forces_audit_close_unit():
    """status=暂时挂起 时当前节点须为 audit_close，不得取末条 task 的源节点。"""
    from backend.legacy_migration import _legacy_instance_current_node_key

    meta = _mock_node_meta()
    inst = {
        "status": "暂时挂起",
        "current_work_flow_node_name": "",
        "current_work_flow_node_id": None,
    }
    tasks = [
        {
            "current_work_flow_node_name": "运维闭环",
            "current_work_flow_node_id": 6,
            "next_work_flow_node_name": "审核关闭",
            "next_work_flow_node_id": 7,
            "status": "提交",
        },
    ]
    assert _legacy_instance_current_node_key(inst, meta, tasks=tasks) == "audit_close"


def test_resolve_effective_current_key_temporary_suspended_unit():
    from backend.legacy_migration import _resolve_effective_current_key

    meta = _mock_node_meta()
    seq = [
        {
            "node_key": "problem_fill",
            "action_status": "processing",
        }
    ]
    assert (
        _resolve_effective_current_key("暂时挂起", seq, "problem_fill", meta)
        == "audit_close"
    )


def test_migrate_dev_analysis_next_misnamed_maps_to_dev_closure(
    api_client, legacy_dev_analysis_next_misnamed_seeded
):
    """迁入/重建：末条开发分析→开发闭环（next 误存）不得落成开发分析→问题审核。"""
    mig = api_client.post(
        "/api/tickets/migrate-legacy",
        json={"operator_id": OPERATOR, "process_ids": [_DEV_NEXT_MISNAMED_PID]},
    )
    assert mig.status_code == 200, mig.text
    assert mig.json()["migrated"] == 1, mig.json()
    no = mig.json()["ticket_nos"][0]

    item = _find_item(api_client, no)
    assert item is not None
    assert item["currentStage"] == "开发闭环"

    logs = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    dev_submit = [
        li for li in logs
        if li.get("from") in ("开发分析", "开发人员分析")
        and li.get("to") in ("开发闭环", "开发人员闭环")
    ]
    assert dev_submit, f"应有开发分析→开发闭环：{logs}"
    bad = [
        li for li in logs
        if li.get("from") in ("开发分析", "开发人员分析")
        and li.get("to") == "问题审核"
    ]
    assert not bad, f"不应出现开发分析→问题审核：{bad}"

    repair = api_client.post(
        "/api/tickets/migrate-legacy/repair",
        json={
            "operator_id": OPERATOR,
            "process_ids": [_DEV_NEXT_MISNAMED_PID],
            "rebuild_workflow": True,
        },
    )
    assert repair.status_code == 200, repair.text
    assert repair.json()["failed"] == 0, repair.json()

    logs2 = api_client.get(f"/api/tickets/{no}/logs").json()["items"]
    bad2 = [
        li for li in logs2
        if li.get("from") in ("开发分析", "开发人员分析")
        and li.get("to") == "问题审核"
    ]
    assert not bad2, f"重建流转后仍出现开发分析→问题审核：{bad2}"
