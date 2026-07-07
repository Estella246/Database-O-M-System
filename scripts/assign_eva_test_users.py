#!/usr/bin/env python3
"""将工单测试处理人（PERSONS）批量写入 user_account 并分配 ONCALL / R&D 组别。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from generate_test_tickets import PERSONS  # noqa: E402

import psycopg
from dotenv import load_dotenv

GROUP_ONCALL = "ONCALL"
GROUP_RND = "R&D"


def assign_eva_groups(conn: psycopg.Connection) -> dict[str, int]:
    mid = (len(PERSONS) + 1) // 2
    oncall_n = 0
    rnd_n = 0
    for i, (account, user_name) in enumerate(PERSONS):
        group = GROUP_ONCALL if i < mid else GROUP_RND
        conn.execute(
            """
            INSERT INTO user_account (
              account, user_name, role_code, group_name, is_active, updated_by, updated_at
            ) VALUES (%s, %s, %s, %s, TRUE, 'assign_eva_test_users', NOW())
            ON CONFLICT (account) DO UPDATE SET
              user_name = EXCLUDED.user_name,
              role_code = EXCLUDED.role_code,
              group_name = EXCLUDED.group_name,
              is_active = TRUE,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()
            """,
            (account, user_name, "普通人员", group),
        )
        if group == GROUP_ONCALL:
            oncall_n += 1
        else:
            rnd_n += 1
    conn.commit()
    return {"oncall": oncall_n, "rnd": rnd_n, "total": len(PERSONS)}


def main() -> int:
    load_dotenv(ROOT / "backend" / ".env", override=True)
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        print("DATABASE_URL 未配置", file=sys.stderr)
        return 1
    with psycopg.connect(dsn) as conn:
        summary = assign_eva_groups(conn)
    print(f"已分配 {summary['total']} 名测试用户: ONCALL={summary['oncall']}, R&D={summary['rnd']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
