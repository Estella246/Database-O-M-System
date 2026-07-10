"""灌入 M14 种子数据后对比报告与工作台数量。"""
from __future__ import annotations

import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "test"))
sys.path.insert(0, os.path.dirname(__file__))

import psycopg
from psycopg.rows import dict_row

import test_m14_monthly_report as m14
from verify_report_workbench_count import report_count, workbench_count

YM = m14._IMP_YM
PREFIX = m14._IMP_PREFIX
KNOWN = "是（已知质量问题）"
NEW = "是（新发现质量问题）"


def _cleanup(conn) -> None:
    conn.execute(
        "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
        (f"{PREFIX}%",),
    )
    conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{PREFIX}%",))


def _seed(conn) -> None:
    from ticket_list_snapshot import refresh_ticket_list_snapshot

    _cleanup(conn)
    m14._imp_seed_ticket(
        conn, f"{PREFIX}1", component="内核问题", quality=KNOWN,
        issue_type="coredump", intro_module="SQL引擎/优化器/代价估算",
        dts="DTS-1", root_cause_category="代码缺陷", event_level="事故",
        location="北京", gauss_version="V2",
        issue_desc="<p>core 了</p>", root_cause="<p>空指针</p>", kernel_upgrade="否",
    )
    m14._imp_seed_ticket(
        conn, f"{PREFIX}2", component="内核问题", quality=NEW,
        issue_type="coredump", intro_module="SQL引擎/执行器",
        dts="DTS-2", root_cause_category="设计缺陷", event_level="一般问题",
        location="上海", gauss_version="V2",
        issue_desc="再次 core", root_cause="并发竞争", kernel_upgrade="否",
    )
    m14._imp_seed_ticket(
        conn, f"{PREFIX}3", component="内核问题", quality=KNOWN,
        issue_type="满", intro_module="存储引擎/空间管理",
        dts="DTS-3", root_cause_category="容量规划", event_level="P1-P3事件",
        location="广州", gauss_version="V3",
        issue_desc="磁盘满", root_cause="未回收", kernel_upgrade="否",
    )
    t4 = m14._imp_seed_ticket(
        conn, f"{PREFIX}4", component="内核问题", quality=KNOWN,
        issue_type="慢", intro_module="SQL引擎/优化器/统计信息",
        dts="DTS-4", root_cause_category="统计信息缺失", event_level="管理升级预警",
        location="深圳", gauss_version="V3",
        issue_desc="查询慢", root_cause="计划差", kernel_upgrade="否",
    )
    m14._imp_insert_node(
        conn, t4, m14._N_OPS_CLOSURE, {"is_quality_issue": "否"},
        m14._imp_t0() + timedelta(hours=6),
    )
    m14._imp_seed_ticket(
        conn, f"{PREFIX}5", component="内核问题", quality=KNOWN,
        issue_type="集群状态异常", intro_module="管控/升级模块",
        dts="DTS-5", root_cause_category="升级流程", event_level="已管理升级",
        location="杭州", gauss_version="V3",
        issue_desc="升级后异常", root_cause="脚本缺陷", kernel_upgrade="是",
    )
    m14._imp_seed_ticket(
        conn, f"{PREFIX}6", component="管控问题", quality=KNOWN,
        issue_type="coredump", intro_module="管控/A",
        dts="DTS-6", root_cause_category="代码缺陷", event_level="事故",
        location="成都", gauss_version="V2",
        issue_desc="x", root_cause="y", kernel_upgrade="否",
    )
    m14._imp_seed_ticket(
        conn, f"{PREFIX}7", component="内核问题", quality="否",
        issue_type="满", intro_module="存储引擎/空间管理",
        dts="DTS-7", root_cause_category="容量规划", event_level="事故",
        location="武汉", gauss_version="V2",
        issue_desc="x", root_cause="y", kernel_upgrade="否",
    )
    m14._imp_seed_ticket(
        conn, f"{PREFIX}8", component="内核问题", quality=KNOWN,
        issue_type="coredump", intro_module="SQL引擎/优化器/代价估算",
        dts="DTS-1", root_cause_category="代码缺陷", event_level="事故",
        location="北京2", gauss_version="V2",
        issue_desc="core 了2", root_cause="空指针2", kernel_upgrade="否",
    )
    rows = conn.execute(
        "SELECT id FROM ticket WHERE ticket_no LIKE %s ORDER BY id",
        (f"{PREFIX}%",),
    ).fetchall()
    for row in rows:
        refresh_ticket_list_snapshot(conn, int(row["id"]))
    conn.commit()


def main() -> int:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL 未设置")
        return 1

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        _seed(conn)
        wb = workbench_count(conn, ym=YM)
        rp = report_count(conn, ym=YM)
        ok = wb == rp
        print(f"[{'OK' if ok else 'MISMATCH'}] ym={YM}  workbench={wb}  report={rp}  (expected 5)")
        _cleanup(conn)
        conn.commit()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
