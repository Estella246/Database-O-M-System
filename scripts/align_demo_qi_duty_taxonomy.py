#!/usr/bin/env python3
"""演示数据领域/模块对齐责任田树（m02 夹具树，测试还原后的稳定态）。

背景：本地库 qi_request 演示数据使用合成标签（领域01..52 / 模块01..08，另有 18 条
SQL引擎 杂项模块），与责任田树二级模块（SQL引擎/CBB、SQL引擎/驱动、管控问题/管控子模块）
无交集；改进报告「三、质量改进领域分析」按设计以树为骨架聚合（m21 契约），导致该段全空。

本脚本把演示行的 domain/module_feature 确定性重映射到树taxonomy 下（只动这两列，
阶段/类型/人/日期不变），幂等可重跑；跑前把受影响行的旧值导出到 /tmp TSV 备份。

用法（在 backend 环境 variables 加载后，或先 source backend/.env）：
    python scripts/align_demo_qi_duty_taxonomy.py            # 执行（默认先备份）
    python scripts/align_demo_qi_duty_taxonomy.py --dry-run  # 只看将影响的行数
    python scripts/align_demo_qi_duty_taxonomy.py --restore /tmp/qi_tax_backup_xxx.tsv
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

# ---- 映射表（与 m02 夹具树 test/test_data.json duty_field_tree 对齐）----
# 二级模块（改进报告第三段骨架）：SQL引擎/CBB、SQL引擎/驱动、管控问题/管控子模块
MODULE_PATHS = {
    "SQL引擎": [
        "CBB", "CBB/语法兼容", "CBB/执行器",
        "驱动", "驱动/JDBC", "驱动/ODBC", "驱动/JDBC/连接池", "驱动/ODBC/游标",
    ],
    "管控问题": [
        "管控子模块", "管控子模块/管控叶子", "管控子模块/配额管理",
        "管控子模块/权限管控", "管控子模块/审计策略", "管控子模块/租户隔离",
        "管控子模块/管控叶子/限流", "管控子模块/备份策略",
    ],
}
# 领域NN（NN=01..52）→ 按数字奇偶分配到两个树根域
def map_domain(label: str) -> str | None:
    digits = label[2:] if label.startswith("领域") else ""
    if not digits.isdigit():
        return None
    return "SQL引擎" if int(digits) % 2 == 0 else "管控问题"

# 模块NN（NN=01..60）→ 按序号对 8 条路径取模轮转（确定性、均匀分布）
def map_module(domain: str, label: str) -> str | None:
    digits = label[2:] if label.startswith("模块") else ""
    if not digits.isdigit():
        return None
    paths = MODULE_PATHS.get(domain) or []
    if not paths:
        return None
    return paths[(int(digits) - 1) % len(paths)]

# 存量 SQL引擎 杂项模块就近归位
MISC_MODULE_MAP = {
    "JDBC接口": "驱动/JDBC",
    "ODBC": "驱动/ODBC",
    "备份恢复": "CBB/备份恢复",
    "主备切换": "CBB/主备切换",
    "测试模块": "CBB/测试模块",
}


def affected_rows(conn) -> list[dict]:
    """将被重映射的行：合成领域行 + 未落在树 taxonomy 的存量杂项行。"""
    return conn.execute(
        """SELECT id, domain, module_feature FROM qi_request
           WHERE domain LIKE '领域%%'
              OR (domain = 'SQL引擎' AND module_feature = ANY(%s))""",
        (list(MISC_MODULE_MAP),),
    ).fetchall()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="只统计将影响的行，不改动")
    ap.add_argument("--backup-dir", default="/tmp", help="备份 TSV 输出目录（默认 /tmp）")
    ap.add_argument("--restore", metavar="TSV", help="从备份 TSV 恢复 id→(domain, module_feature)")
    args = ap.parse_args()

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        print("缺少 DATABASE_URL（先 source backend/.env）", file=sys.stderr)
        return 2

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        if args.restore:
            with open(args.restore, encoding="utf-8") as f:
                rows = [line.rstrip("\n").split("\t") for line in f if line.strip()]
            with conn.transaction():
                for rid, dom, mod in rows:
                    conn.execute(
                        "UPDATE qi_request SET domain=%s, module_feature=%s WHERE id=%s",
                        (dom, mod, int(rid)),
                    )
            print(f"已从 {args.restore} 恢复 {len(rows)} 行")
            return 0

        rows = affected_rows(conn)
        syn = [r for r in rows if r["domain"].startswith("领域")]
        misc = [r for r in rows if not r["domain"].startswith("领域")]
        print(f"待重映射：合成领域行 {len(syn)}，SQL引擎杂项行 {len(misc)}")
        if args.dry_run or not rows:
            return 0

        # 备份旧值（id \t domain \t module_feature）
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = os.path.join(args.backup_dir, f"qi_tax_backup_{stamp}.tsv")
        with open(backup, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(f"{r['id']}\t{r['domain']}\t{r['module_feature']}\n")
        print(f"已备份旧值 → {backup}")

        plan: list[tuple[int, str, str]] = []
        for r in rows:
            if r["domain"].startswith("领域"):
                dom = map_domain(r["domain"])
                mod = map_module(dom, r["module_feature"]) if dom else None
            else:
                dom = "SQL引擎"
                mod = MISC_MODULE_MAP.get(r["module_feature"])
            if not dom or not mod:
                print(f"跳过无法映射的行 id={r['id']} {r['domain']}/{r['module_feature']}", file=sys.stderr)
                continue
            plan.append((int(r["id"]), dom, mod))

        with conn.transaction():
            for rid, dom, mod in plan:
                conn.execute(
                    "UPDATE qi_request SET domain=%s, module_feature=%s WHERE id=%s",
                    (dom, mod, rid),
                )
        print(f"已重映射 {len(plan)} 行")

        # 后验：按改进报告口径复算三个二级模块的窗口计数（YTD 2026 至下月首日）
        checks = conn.execute(
            """SELECT CASE
                     WHEN domain='SQL引擎' AND (module_feature='CBB' OR module_feature LIKE 'CBB/%') THEN 'SQL引擎/CBB'
                     WHEN domain='SQL引擎' AND (module_feature='驱动' OR module_feature LIKE '驱动/%') THEN 'SQL引擎/驱动'
                     WHEN domain='管控问题' THEN '管控问题/管控子模块'
                     ELSE '其它' END AS m,
                    COUNT(*) AS c
               FROM qi_request
               WHERE current_status != 'draft' AND created_at >= '2026-01-01' AND created_at < '2026-09-01'
               GROUP BY 1 ORDER BY 1"""
        ).fetchall()
        print("窗口内按二级模块计数：", {r["m"]: r["c"] for r in checks})
        leftovers = conn.execute(
            "SELECT COUNT(*) AS c FROM qi_request WHERE domain LIKE '领域%'"
        ).fetchone()["c"]
        print(f"剩余合成领域行：{leftovers}（应为 0）")
        return 0 if leftovers == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
