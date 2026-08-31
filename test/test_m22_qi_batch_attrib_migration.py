"""M22 迁移 0130（QI 工单闭环批量提交归属修复）测试。

场景种子（直插 DB，TEST-ATTRIB-% 前缀，跑完清理）：
  R1 错置单：creator=test_user01，但 propose submitted 日志 operator=admin、
     propose 非草稿 stage_data.created_by=admin（模拟修复前的闭环批量提交）
  R2 正常单：operator==creator（本人提交，不得被改）
  R3 转单单：同 R1 另有 transferred 日志（合法差异，必须排除）

覆盖：修复正确性 / 排除 transferred 与正常单 / 幂等重跑 / 回滚往返 / DENSE 演示数据零误伤。
运行：PYTEST_SKIP_AUTO_MIGRATE=1 + DATABASE_URL + TEST_API_BASE_URL 照常（不依赖后端进程）。
"""
import os

import psycopg
import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION_FILE = os.path.join(REPO, "db/migrations/0130_qi_batch_submit_attribution_fix.sql")
ROLLBACK_FILE = os.path.join(REPO, "scripts/sql/rollback_0130_qi_batch_attribution.sql")
PREFIX = "TEST-ATTRIB-"


def _dsn():
    return os.environ["DATABASE_URL"]


def _run_script(dsn, path):
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(sql)  # 文件自带 BEGIN/COMMIT，autocommit 连接整段下发


def _seed(conn):
    """三张单：R1 错置 / R2 正常 / R3 转单排除。返回 {tag: request_id}。"""
    conn.execute(f"DELETE FROM qi_request WHERE qi_no LIKE '{PREFIX}%'")
    ids = {}
    spec = [
        # (tag, creator_id, creator_name, log_operator, log_op_name, extra_transferred)
        ("R1", "test_user01", "测试用户01 test_user01", "admin", "管理员 admin", False),
        ("R2", "admin", "管理员 admin", "admin", "管理员 admin", False),
        ("R3", "test_user01", "测试用户01 test_user01", "admin", "管理员 admin", True),
    ]
    for tag, creator_id, creator_name, log_op, log_name, transferred in spec:
        row = conn.execute(
            """INSERT INTO qi_request
               (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                related_ticket_no, current_stage, current_status, creator_id, creator_name)
               VALUES (%s, '特性加固', %s, %s, 'd', 'g', '中', '测试用户02 test_user02',
                       'YW99993527930', 'review', 'in_progress', %s, %s)
               RETURNING id""",
            (f"{PREFIX}{tag}", creator_name, f"归属修复{tag}", creator_id, creator_name),
        ).fetchone()
        rid = int(row[0])
        conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status) "
            "VALUES (%s, 'propose', 1, 'completed'), (%s, 'review', 2, 'pending')",
            (rid, rid))
        sid = conn.execute(
            "SELECT id FROM qi_stage WHERE request_id=%s AND stage_key='propose'", (rid,)
        ).fetchone()[0]
        # 创建行（created_by=creator，draft=TRUE）+ 批量提交行（created_by=闭环操作人）
        conn.execute(
            """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
               VALUES (%s, %s, 'propose', %s::jsonb, TRUE, %s),
                      (%s, %s, 'propose', %s::jsonb, FALSE, %s)""",
            (sid, rid, '{"title": "t"}', creator_id,
             sid, rid, '{"title": "t"}', log_op))
        conn.execute(
            """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage,
                                        operator_id, operator_name, comment)
               VALUES (%s, 'submitted', 'propose', 'review', %s, %s, ''),
                      (%s, 'created', '', 'propose', %s, %s, '')""",
            (rid, log_op, log_name, rid, creator_id, creator_name))
        if transferred:
            conn.execute(
                """INSERT INTO qi_flow_log (request_id, action, from_stage, to_stage,
                                            operator_id, operator_name, comment)
                   VALUES (%s, 'transferred', 'propose', 'propose', 'admin', '管理员 admin', '转单')""",
                (rid,))
        ids[tag] = rid
    return ids


@pytest.fixture(scope="module", autouse=True)
def migrated_env():
    """播种 → 跑迁移 → 供各用例断言；结束后清理种子与备份行。"""
    dsn = _dsn()
    with psycopg.connect(dsn) as conn:
        # 备份表在迁移未跑过的库上尚不存在，存在才清理上次残留
        if conn.execute("SELECT to_regclass('qi_batch_attrib_fix_0130')").fetchone()[0]:
            conn.execute(f"DELETE FROM qi_batch_attrib_fix_0130 WHERE request_id IN "
                         f"(SELECT id FROM qi_request WHERE qi_no LIKE '{PREFIX}%')")
        ids = _seed(conn)
        conn.commit()
        # DENSE 关联行快照（迁移前），供零误伤断言
        dense_before = conn.execute(
            """SELECT count(*), COALESCE(sum(hasnum), 0) FROM (
                 SELECT 1 AS hasnum FROM qi_stage_data sd
                 JOIN qi_request r ON r.id = sd.request_id WHERE r.qi_no LIKE 'DENSE-%'
                 UNION ALL
                 SELECT 1 FROM qi_flow_log fl
                 JOIN qi_request r ON r.id = fl.request_id WHERE r.qi_no LIKE 'DENSE-%'
               ) x""").fetchone()
        dense_rows = int(dense_before[0])
    _run_script(dsn, MIGRATION_FILE)
    yield {"dsn": dsn, "ids": ids, "dense_rows": dense_rows}
    with psycopg.connect(dsn) as conn:
        conn.execute(f"DELETE FROM qi_request WHERE qi_no LIKE '{PREFIX}%'")
        conn.execute(f"DELETE FROM qi_batch_attrib_fix_0130 WHERE request_id IN "
                     f"({','.join(str(i) for i in ids.values())})")
        conn.commit()


def test_m22_001_fixes_flow_log_and_stage_data(migrated_env):
    """R1：flow_log 操作人归还创建人（comment 留原操作人备注），stage_data.created_by 归位。"""
    with psycopg.connect(migrated_env["dsn"]) as conn:
        rid = migrated_env["ids"]["R1"]
        log = conn.execute(
            "SELECT operator_id, operator_name, comment FROM qi_flow_log "
            "WHERE request_id=%s AND action='submitted' AND from_stage='propose'", (rid,)
        ).fetchone()
        assert log[0] == "test_user01", f"operator_id 应归还创建人，实际 {log[0]}"
        assert log[1] == "测试用户01 test_user01"
        assert "归属修复" in log[2] and "管理员 admin" in log[2] and "admin" in log[2], log[2]
        stage = conn.execute(
            "SELECT created_by FROM qi_stage_data sd "
            "JOIN qi_request r ON r.id = sd.request_id "
            "WHERE sd.request_id=%s AND sd.stage_key='propose' AND sd.draft=FALSE", (rid,)
        ).fetchone()
        assert stage[0] == "test_user01", f"created_by 应归位创建人，实际 {stage[0]}"


def test_m22_002_excludes_transferred_and_normal(migrated_env):
    """R2（本人提交）与 R3（有转单记录）不得被修改，备份表不含它们的行。"""
    with psycopg.connect(migrated_env["dsn"]) as conn:
        for tag in ("R2", "R3"):
            rid = migrated_env["ids"][tag]
            log = conn.execute(
                "SELECT operator_id, operator_name, comment FROM qi_flow_log "
                "WHERE request_id=%s AND action='submitted' AND from_stage='propose'", (rid,)
            ).fetchone()
            assert log[0] == "admin" and log[1] == "管理员 admin", f"{tag} 不应被改写"
            assert "归属修复" not in (log[2] or "")
            stage = conn.execute(
                "SELECT created_by FROM qi_stage_data "
                "WHERE request_id=%s AND stage_key='propose' AND draft=FALSE", (rid,)
            ).fetchone()
            assert stage[0] == "admin", f"{tag} stage_data 不应被改写"
            n = conn.execute(
                "SELECT count(*) FROM qi_batch_attrib_fix_0130 WHERE request_id=%s", (rid,)
            ).fetchone()[0]
            assert n == 0, f"{tag} 不应进备份表"


def test_m22_003_idempotent_rerun(migrated_env):
    """第二次执行迁移：0 行命中，数据与备份表均不变。"""
    with psycopg.connect(migrated_env["dsn"]) as conn:
        rid = migrated_env["ids"]["R1"]
        before = conn.execute(
            "SELECT (SELECT operator_id||'|'||comment FROM qi_flow_log "
            "  WHERE request_id=%s AND action='submitted' AND from_stage='propose'), "
            " (SELECT count(*) FROM qi_batch_attrib_fix_0130)", (rid,)).fetchone()
    _run_script(migrated_env["dsn"], MIGRATION_FILE)
    with psycopg.connect(migrated_env["dsn"]) as conn:
        after = conn.execute(
            "SELECT (SELECT operator_id||'|'||comment FROM qi_flow_log "
            "  WHERE request_id=%s AND action='submitted' AND from_stage='propose'), "
            " (SELECT count(*) FROM qi_batch_attrib_fix_0130)", (rid,)).fetchone()
        assert before == after, f"重跑不应改变任何数据：{before} -> {after}"


def test_m22_004_backup_and_rollback_roundtrip(migrated_env):
    """回滚脚本按备份表还原原值；再次执行迁移又可修复（往返一致），
    且 comment 前缀跨回滚/重放不叠加（幂等闸门）。"""
    dsn = migrated_env["dsn"]
    rid = migrated_env["ids"]["R1"]
    # 护栏：回滚脚本是全局的（按备份表全量还原）——备份表若存在非本测试种子行，
    # 执行会把真实已修复数据也还原掉，必须先大声失败而非静默破坏
    with psycopg.connect(dsn) as conn:
        others = conn.execute(
            "SELECT count(*) FROM qi_batch_attrib_fix_0130 "
            "WHERE request_id <> ALL(%s)", (list(migrated_env["ids"].values()),)
        ).fetchone()[0]
        assert others == 0, f"备份表存在 {others} 行非测试数据，禁止在此库执行全局回滚"
    _run_script(dsn, ROLLBACK_FILE)
    with psycopg.connect(dsn) as conn:
        log = conn.execute(
            "SELECT operator_id FROM qi_flow_log "
            "WHERE request_id=%s AND action='submitted' AND from_stage='propose'", (rid,)
        ).fetchone()
        stage = conn.execute(
            "SELECT created_by FROM qi_stage_data "
            "WHERE request_id=%s AND stage_key='propose' AND draft=FALSE", (rid,)
        ).fetchone()
        assert log[0] == "admin", "回滚后 operator 应还原为闭环操作人"
        assert stage[0] == "admin", "回滚后 created_by 应还原为闭环操作人"
    _run_script(dsn, MIGRATION_FILE)
    with psycopg.connect(dsn) as conn:
        log = conn.execute(
            "SELECT operator_id, comment FROM qi_flow_log "
            "WHERE request_id=%s AND action='submitted' AND from_stage='propose'", (rid,)
        ).fetchone()
        assert log[0] == "test_user01", "重放迁移应再次修复归属"
        assert log[1].count("工单闭环批量提交归属修复") == 1, \
            f"回滚(保留comment)后重放不应叠加前缀: {log[1]}"


def test_m22_005_local_dense_untouched(migrated_env):
    """本地 DENSE 演示数据零误伤：迁移前后 DENSE 关联 stage_data/flow_log 行数不变。"""
    with psycopg.connect(migrated_env["dsn"]) as conn:
        dense_after = conn.execute(
            """SELECT count(*) FROM (
                 SELECT 1 FROM qi_stage_data sd
                 JOIN qi_request r ON r.id = sd.request_id WHERE r.qi_no LIKE 'DENSE-%'
                 UNION ALL
                 SELECT 1 FROM qi_flow_log fl
                 JOIN qi_request r ON r.id = fl.request_id WHERE r.qi_no LIKE 'DENSE-%'
               ) x""").fetchone()
        assert int(dense_after[0]) == migrated_env["dense_rows"], \
            f"DENSE 关联行数变化：{migrated_env['dense_rows']} -> {dense_after[0]}"
