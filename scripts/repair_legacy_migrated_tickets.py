#!/usr/bin/env python3
"""修复已迁历史工单的流程 ID / 状态 / 当前节点（从老库回填）。

用法：
  python scripts/repair_legacy_migrated_tickets.py
  python scripts/repair_legacy_migrated_tickets.py --process-id YW20260501313
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from legacy_migration import legacy_conn, repair_legacy_migrated_tickets, _normalize_process_ids  # noqa: E402
from database import db_conn  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="修复已迁历史工单的流程 ID 与当前阶段")
    parser.add_argument(
        "--process-id",
        action="append",
        dest="process_ids",
        default=[],
        help="仅修复指定流程 ID（可重复传入）；不传则修复全部已迁工单",
    )
    args = parser.parse_args()
    process_ids = _normalize_process_ids(args.process_ids)

    with db_conn() as conn, legacy_conn() as lconn:
        summary = repair_legacy_migrated_tickets(
            conn,
            lconn,
            process_ids=process_ids if process_ids else None,
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
