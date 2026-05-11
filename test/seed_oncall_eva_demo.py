"""为 oncall 评议页面构造 10 条演示数据。

使用方式：
    backend/.venv/bin/python test/seed_oncall_eva_demo.py [year] [month]
未传入年月则默认使用当前自然月。

数据策略（10 人覆盖典型分布）：
  oeva_t01  SLA<24h、闭环>=90%、量大            → 顶部
  oeva_t02  SLA<24h、闭环 80%、量中
  oeva_t03  SLA<48h、闭环 75%、量中
  oeva_t04  SLA<48h、闭环>=90%、量中、加分高
  oeva_t05  SLA<72h、闭环 65%、量小
  oeva_t06  SLA>72h、闭环 60%、量小
  oeva_t07  SLA<24h、闭环 100%、量大、红事件
  oeva_t08  SLA<48h、闭环 95%、量小、黑事件
  oeva_t09  SLA<72h、闭环 85%、量中、加分中
  oeva_t10  无工单（仅占位，演示空数据形态）
"""
from __future__ import annotations

import os
import sys
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(ROOT / "backend" / ".env")

import psycopg
from psycopg.rows import dict_row


DEMO_PREFIX = "oeva_t"
TEMPLATE_ID = 1

# 模板节点常量（来自 0001_init_workflow_schema.sql）
NODE_OPS_ANALYSIS = 3
NODE_DEV_ANALYSIS = 4
NODE_DEV_CLOSURE = 5
NODE_OPS_CLOSURE = 6
NODE_AUDIT_CLOSE = 7

# 10 人画像。tickets 项是一组 (sla_hours, flowed_to_dev) 的元组
PROFILES = [
    {
        "account": "oeva_t01", "user_name": "甲组-王亮", "group_name": "甲组",
        "tickets": [(8, False), (10, False), (14, False), (18, False), (22, False),
                    (12, False), (16, False), (20, False), (8, True), (24, False)],  # 1/10 → 90%
        "extras": [("efficiency", 5, True), ("knowledge", 4, False)],
        "events": [],
    },
    {
        "account": "oeva_t02", "user_name": "甲组-赵敏", "group_name": "甲组",
        "tickets": [(6, False), (12, False), (16, False), (20, False), (10, True), (18, True)],  # 2/6 → 67%? 调成 8 张
        "extras": [("public", 3, False)],
        "events": [],
    },
    {
        "account": "oeva_t03", "user_name": "乙组-周岩", "group_name": "乙组",
        "tickets": [(28, False), (36, False), (42, False), (32, False), (40, True), (24, True), (30, False), (44, False)],  # 2/8 → 75%
        "extras": [],
        "events": [],
    },
    {
        "account": "oeva_t04", "user_name": "乙组-钱悦", "group_name": "乙组",
        "tickets": [(30, False), (35, False), (40, False), (28, False), (42, False), (32, True), (38, False), (44, False)],  # 1/8 → 87.5%
        "extras": [("efficiency", 5, True), ("efficiency", 4, False),
                   ("enablement", 4, False), ("knowledge", 4, True)],
        "events": [],
    },
    {
        "account": "oeva_t05", "user_name": "乙组-孙朗", "group_name": "乙组",
        "tickets": [(50, True), (60, False), (66, True), (54, False), (70, False)],  # 2/5 → 60%? 调成 4/5
        "extras": [],
        "events": [],
    },
    {
        "account": "oeva_t06", "user_name": "丙组-吴琳", "group_name": "丙组",
        "tickets": [(80, True), (96, False), (108, True), (84, False)],  # 2/4 → 50%
        "extras": [],
        "events": [],
    },
    {
        "account": "oeva_t07", "user_name": "丙组-郑昊", "group_name": "丙组",
        "tickets": [(8, False), (12, False), (10, False), (14, False), (16, False),
                    (20, False), (18, False), (22, False), (9, False), (15, False), (11, False)],  # 0/11 → 100%
        "extras": [("travel", 4, False)],
        "events": [("red", 5, "重大故障应急处置（同事提名）")],
    },
    {
        "account": "oeva_t08", "user_name": "甲组-冯佳", "group_name": "甲组",
        "tickets": [(28, False), (36, False), (32, False), (40, False), (44, True), (30, False)],  # 1/6 → 83%? 调成 5/6
        "extras": [("knowledge", 4, False)],
        "events": [("black", 3, "未及时跟进客户反馈，导致投诉")],
    },
    {
        "account": "oeva_t09", "user_name": "丙组-蒋宇", "group_name": "丙组",
        "tickets": [(48, False), (60, False), (54, False), (66, True), (50, False), (64, False), (58, False)],  # 1/7 → 86%
        "extras": [("public", 4, False), ("other", 3, False)],
        "events": [],
    },
    {
        "account": "oeva_t10", "user_name": "丁组-韩雪", "group_name": "丁组",
        "tickets": [],  # 空数据演示
        "extras": [],
        "events": [],
    },
]


def _period_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    last = monthrange(year, month)[1]
    start = datetime(year, month, 5, 9, 0, 0, tzinfo=timezone.utc)  # 留出闭环时间余量
    end = datetime(year, month, last, 23, 0, 0, tzinfo=timezone.utc)
    return start, end


def cleanup(conn: psycopg.Connection) -> None:
    """清理上次种子数据，确保脚本可重复执行。"""
    conn.execute(
        "DELETE FROM ticket_flow_log WHERE ticket_id IN (SELECT id FROM ticket WHERE ticket_no LIKE %s)",
        (f"{DEMO_PREFIX}-%",),
    )
    conn.execute("DELETE FROM ticket WHERE ticket_no LIKE %s", (f"{DEMO_PREFIX}-%",))
    conn.execute("DELETE FROM oncall_eva_extra WHERE account LIKE %s", (f"{DEMO_PREFIX}%",))
    conn.execute("DELETE FROM oncall_eva_event WHERE account LIKE %s", (f"{DEMO_PREFIX}%",))
    conn.execute("DELETE FROM user_account WHERE account LIKE %s", (f"{DEMO_PREFIX}%",))
    conn.commit()


def seed_users(conn: psycopg.Connection) -> None:
    for p in PROFILES:
        conn.execute(
            """
            INSERT INTO user_account (account, user_name, role_code, group_name, is_pl, is_active)
            VALUES (%s, %s, '普通人员', %s, FALSE, TRUE)
            ON CONFLICT (account) DO UPDATE SET
              user_name = EXCLUDED.user_name,
              group_name = EXCLUDED.group_name,
              is_active = TRUE
            """,
            (p["account"], p["user_name"], p["group_name"]),
        )
    conn.commit()


def seed_tickets(conn: psycopg.Connection, year: int, month: int) -> None:
    period_start, _ = _period_bounds(year, month)
    seq = 0
    for p in PROFILES:
        for sla_hours, flowed_to_dev in p["tickets"]:
            seq += 1
            ticket_no = f"{DEMO_PREFIX}-{year:04d}{month:02d}-{seq:04d}"
            # 创建时间随机分布在月初的 1~5 天里
            created_at = period_start + timedelta(hours=(seq * 7) % 96)
            closed_at = created_at + timedelta(hours=sla_hours)
            conn.execute(
                """
                INSERT INTO ticket (ticket_no, template_id, title, status, creator_id, creator_name, created_at, updated_at)
                VALUES (%s, %s, %s, 'closed', %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    ticket_no, TEMPLATE_ID, f"演示工单 {ticket_no}",
                    p["account"], p["user_name"], created_at, closed_at,
                ),
            )
            ticket_id = conn.execute("SELECT currval(pg_get_serial_sequence('ticket','id')) AS id").fetchone()["id"]

            # 流转链路：ops_analysis → (可选 dev_analysis) → ops_closure → 关闭
            mid_ts = created_at + timedelta(hours=sla_hours / 3)
            late_ts = created_at + timedelta(hours=sla_hours * 2 / 3)
            log_rows = [
                (ticket_id, None, NODE_OPS_ANALYSIS, "submit", p["account"], p["user_name"], created_at),
            ]
            if flowed_to_dev:
                log_rows.append(
                    (ticket_id, NODE_OPS_ANALYSIS, NODE_DEV_ANALYSIS, "submit", p["account"], p["user_name"], mid_ts)
                )
                log_rows.append(
                    (ticket_id, NODE_DEV_ANALYSIS, NODE_OPS_CLOSURE, "submit", p["account"], p["user_name"], late_ts)
                )
            else:
                log_rows.append(
                    (ticket_id, NODE_OPS_ANALYSIS, NODE_OPS_CLOSURE, "submit", p["account"], p["user_name"], late_ts)
                )
            log_rows.append(
                (ticket_id, NODE_OPS_CLOSURE, NODE_AUDIT_CLOSE, "close", p["account"], p["user_name"], closed_at)
            )
            for row in log_rows:
                conn.execute(
                    """
                    INSERT INTO ticket_flow_log
                      (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, '', %s)
                    """,
                    row,
                )
    conn.commit()


def seed_extras(conn: psycopg.Connection, year: int, month: int) -> None:
    for p in PROFILES:
        for category, score, is_excellent in p["extras"]:
            conn.execute(
                """
                INSERT INTO oncall_eva_extra
                  (account, user_name, period_year, period_month, category, description,
                   evidence_url, declared_score, status, reviewer_id, reviewer_name,
                   review_comment, reviewed_at, is_excellent)
                VALUES (%s, %s, %s, %s, %s, %s, '', %s, 'approved', 'admin', '管理员',
                        '已审核', NOW(), %s)
                """,
                (
                    p["account"], p["user_name"], year, month, category,
                    f"{p['user_name']} 的 {category} 加分项",
                    score, is_excellent,
                ),
            )
    conn.commit()


def seed_events(conn: psycopg.Connection, year: int, month: int) -> None:
    for p in PROFILES:
        for kind, score, summary in p["events"]:
            conn.execute(
                """
                INSERT INTO oncall_eva_event
                  (account, user_name, period_year, period_month, kind, score, summary,
                   evidence_url, recorder_id, recorder_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, '', 'admin', '管理员')
                """,
                (p["account"], p["user_name"], year, month, kind, score, summary),
            )
    conn.commit()


def main() -> None:
    now = datetime.now(timezone.utc)
    year = int(sys.argv[1]) if len(sys.argv) > 1 else now.year
    month = int(sys.argv[2]) if len(sys.argv) > 2 else now.month

    dsn = os.environ["DATABASE_URL"]
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        cleanup(conn)
        seed_users(conn)
        seed_tickets(conn, year, month)
        seed_extras(conn, year, month)
        seed_events(conn, year, month)

        cnt_user = conn.execute("SELECT COUNT(*) AS c FROM user_account WHERE account LIKE %s", (f"{DEMO_PREFIX}%",)).fetchone()["c"]
        cnt_ticket = conn.execute("SELECT COUNT(*) AS c FROM ticket WHERE ticket_no LIKE %s", (f"{DEMO_PREFIX}-%",)).fetchone()["c"]
        cnt_extra = conn.execute("SELECT COUNT(*) AS c FROM oncall_eva_extra WHERE account LIKE %s", (f"{DEMO_PREFIX}%",)).fetchone()["c"]
        cnt_event = conn.execute("SELECT COUNT(*) AS c FROM oncall_eva_event WHERE account LIKE %s", (f"{DEMO_PREFIX}%",)).fetchone()["c"]
        print(f"[seed] period={year}-{month:02d}  users={cnt_user}  tickets={cnt_ticket}  extras={cnt_extra}  events={cnt_event}")


if __name__ == "__main__":
    main()
