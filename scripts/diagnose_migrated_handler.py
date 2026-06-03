"""按运维单号定位「迁入工单各阶段处理人都成了提单人」的根因（只读，不改库）。

用法：
    backend/.venv/bin/python scripts/diagnose_migrated_handler.py YW20251103001

依赖环境变量：
    DATABASE_URL          新平台库（必填）
    LEGACY_DATABASE_URL   老平台库（缺省回退 DATABASE_URL）

脚本会并排打印「新平台流转日志/节点处理人」与「老库 instance + task 流转」，
并自动判定命中了哪条迁移路径，给出结论。
"""
from __future__ import annotations

import os
import sys

import psycopg
from psycopg.rows import dict_row

# 只读硬保险：会话强制只读 + 语句超时，杜绝任何写库、避免在生产跑出慢查询。
_READONLY_OPTS = "-c default_transaction_read_only=on -c statement_timeout=15000"


def _connect(dsn: str) -> psycopg.Connection:
    return psycopg.connect(dsn, row_factory=dict_row, autocommit=True, options=_READONLY_OPTS)


def _fmt(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if dt else "-"


def main(ticket_no: str) -> None:
    new_dsn = os.getenv("DATABASE_URL")
    legacy_dsn = os.getenv("LEGACY_DATABASE_URL") or new_dsn
    if not new_dsn:
        sys.exit("未设置 DATABASE_URL")

    new = _connect(new_dsn)

    t = new.execute(
        "SELECT id, ticket_no, legacy_instance_id, status, creator_id, creator_name, created_at "
        "FROM ticket WHERE ticket_no = %s",
        (ticket_no,),
    ).fetchone()
    if not t:
        sys.exit(f"新平台未找到工单 {ticket_no}")

    creator = f"{t['creator_id']} {t['creator_name']}".strip()
    print(f"\n=== 新平台工单 {t['ticket_no']} ===")
    print(f"legacy_instance_id={t['legacy_instance_id']}  状态={t['status']}  "
          f"提单人={creator}  迁入时间={_fmt(t['created_at'])}")

    print("\n-- 节点处理人（ticket_node_instance）--")
    insts = new.execute(
        "SELECT wn.node_name, ni.handler_id, ni.handler_name, ni.action_status, ni.started_at "
        "FROM ticket_node_instance ni JOIN workflow_node wn ON wn.id = ni.node_id "
        "WHERE ni.ticket_id = %s ORDER BY ni.started_at, ni.id",
        (t["id"],),
    ).fetchall()
    for r in insts:
        print(f"  {_fmt(r['started_at'])}  {r['node_name']:<8} 处理人={r['handler_id']} {r['handler_name']}  ({r['action_status']})")

    print("\n-- 流转日志（ticket_flow_log）--")
    logs = new.execute(
        "SELECT fn.node_name AS from_n, tn.node_name AS to_n, fl.action_type, "
        "fl.operator_id, fl.operator_name, fl.created_at "
        "FROM ticket_flow_log fl "
        "LEFT JOIN workflow_node fn ON fn.id = fl.from_node_id "
        "LEFT JOIN workflow_node tn ON tn.id = fl.to_node_id "
        "WHERE fl.ticket_id = %s ORDER BY fl.created_at, fl.id",
        (t["id"],),
    ).fetchall()
    op_set = set()
    for r in logs:
        op = f"{r['operator_id']} {r['operator_name']}".strip()
        op_set.add(op)
        print(f"  {_fmt(r['created_at'])}  {r['from_n'] or '-':<8} → {r['to_n'] or '-':<8} "
              f"[{r['action_type']}] 处理人={op}")

    # ---- 老库侧 ----
    legacy = _connect(legacy_dsn)
    iid = t["legacy_instance_id"]
    print(f"\n=== 老库实例 {iid} ===")
    inst = legacy.execute(
        "SELECT creator_id, creator_name, current_work_flow_node_name, "
        "current_assignee, current_assignee_id, status, deleted "
        "FROM t_work_flow_instance WHERE id = %s",
        (iid,),
    ).fetchone()
    if inst:
        print(f"提单人={inst['creator_id']} {inst['creator_name']}  当前节点={inst['current_work_flow_node_name']}  "
              f"当前处理人={inst['current_assignee_id']} {inst['current_assignee']}  状态={inst['status']}  deleted={inst['deleted']}")
    else:
        print("！老库未找到该实例（库/表不对，或 legacy_instance_id 失配）")

    tasks = legacy.execute(
        "SELECT current_work_flow_node_name AS cur, next_work_flow_node_name AS nxt, "
        "next_assignee, next_assignee_id, creator_name, creator_id, create_time, "
        "COALESCE(deleted,'<null>') AS deleted "
        "FROM t_work_flow_task WHERE work_flow_instance_id = %s "
        "ORDER BY create_time, id",
        (iid,),
    ).fetchall()
    print(f"\n-- 流转任务 t_work_flow_task（共 {len(tasks)} 行）--")
    na_nonempty = 0
    for r in tasks:
        na = f"{r['next_assignee_id']} {r['next_assignee']}".strip()
        if na:
            na_nonempty += 1
        print(f"  {_fmt(r['create_time'])}  {r['cur']:<8} → {r['nxt'] or '-':<8} "
              f"next_assignee=[{na}]  记录creator=[{r['creator_id']} {r['creator_name']}]  deleted={r['deleted']}")

    # ---- 自动判定 ----
    print("\n=== 判定 ===")
    all_ops_eq_creator = bool(op_set) and all(creator.split()[0] in o for o in op_set if o)
    if not tasks:
        print("命中【兜底分支②】：老库该实例无流转任务 → 迁移把每个阶段都填成提单人。")
        print("  → 需修复 legacy_migration.py 的 no-tasks 分支（当前未覆盖）；或确认 task 外键列名/deleted 取值。")
    elif na_nonempty <= len(tasks) // 2:
        print(f"任务有 {len(tasks)} 行，但 next_assignee 多为空（非空仅 {na_nonempty} 行）。")
        print("  → 用 next_assignee 还原处理人的假设在此数据不成立，需换字段（例如下一行的当前处理人/别的列）。")
    else:
        print("任务存在且 next_assignee 正常 → 应走【分支①】，我的修复对此有效。")
        if all_ops_eq_creator:
            print(f"  但新库流转日志处理人仍全为提单人 → 这是【存量脏数据】：迁入时间={_fmt(t['created_at'])}，")
            print("    在修复部署之前迁的。删除该工单后重迁即可纠正（legacy_instance_id 唯一索引保证幂等）。")
        else:
            print("  且新库处理人已多样 → 该单已正确，无需处理。")

    new.close()
    legacy.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法：python scripts/diagnose_migrated_handler.py <运维单号 如 YW20251103001>")
    main(sys.argv[1])
