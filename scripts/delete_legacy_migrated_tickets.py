#!/usr/bin/env python3
"""删除新平台中历史迁入工单（ticket.legacy_instance_id IS NOT NULL）。

用法（推荐用 backend 虚拟环境，会自动读 backend/.env）：
  backend/.venv/bin/python scripts/delete_legacy_migrated_tickets.py --dry-run
  backend/.venv/bin/python scripts/delete_legacy_migrated_tickets.py
  backend/.venv/bin/python scripts/delete_legacy_migrated_tickets.py --process-id YW20260501313
  backend/.venv/bin/python scripts/delete_legacy_migrated_tickets.py --batch-size 100
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from urllib.parse import urlparse

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))
from load_backend_env import load_backend_env  # noqa: E402

load_backend_env()

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from legacy_migration import (  # noqa: E402
    count_legacy_migrated_tickets,
    delete_legacy_migrated_tickets,
    _normalize_process_ids,
)
from database import DB_DSN, db_conn  # noqa: E402
from utils.logging_config import setup_logging  # noqa: E402

logger = logging.getLogger(__name__)


def _dsn_label(dsn: str) -> str:
    try:
        p = urlparse(dsn)
        db = (p.path or "").lstrip("/") or "?"
        host = p.hostname or "?"
        port = f":{p.port}" if p.port else ""
        return f"{host}{port}/{db}"
    except Exception:  # noqa: BLE001
        return "?"


def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(description="删除历史迁入工单")
    parser.add_argument(
        "--process-id",
        action="append",
        dest="process_ids",
        default=[],
        help="仅删除指定流程 ID（可重复传入）",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="分批删除每批条数（1–500，默认 100）",
    )
    parser.add_argument(
        "--after-legacy-instance-id",
        type=int,
        default=0,
        help="仅处理 legacy_instance_id 大于此值的工单（分批续跑用）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅统计将删除的条数，不实际删除",
    )
    parser.add_argument(
        "--refresh-snapshot",
        action="store_true",
        help="删除完成后重建 HCS 列表快照",
    )
    args = parser.parse_args()

    process_ids = _normalize_process_ids(args.process_ids) or None
    batch_size = max(1, min(int(args.batch_size), 500))
    after_id = max(0, int(args.after_legacy_instance_id))
    dry_run = bool(args.dry_run)

    logger.info(
        "delete script env new_db=%s dry_run=%s process_ids=%s",
        _dsn_label(DB_DSN),
        dry_run,
        process_ids if process_ids else "all",
    )

    totals = {
        "deleted": 0,
        "skipped_not_found": 0,
        "processed": 0,
        "ticket_nos": [],
    }

    try:
        with db_conn() as conn:
            total_count = count_legacy_migrated_tickets(conn)
            print(f"当前已迁工单总数：{total_count}")
            if dry_run:
                print("（dry-run 模式，不实际删除）")

            delete_all = not process_ids
            while True:
                summary = delete_legacy_migrated_tickets(
                    conn,
                    process_ids=process_ids,
                    limit=batch_size if delete_all else None,
                    after_legacy_instance_id=after_id,
                    dry_run=dry_run,
                )
                totals["deleted"] += int(summary.get("deleted") or 0)
                totals["skipped_not_found"] += int(summary.get("skipped_not_found") or 0)
                totals["processed"] += int(summary.get("processed") or 0)
                nos = summary.get("ticket_nos") or []
                if isinstance(nos, list):
                    totals["ticket_nos"].extend(nos)

                if not delete_all or not summary.get("has_more"):
                    break
                after_id = int(summary.get("next_after_legacy_instance_id") or after_id)
                if not after_id:
                    break

            if args.refresh_snapshot and not dry_run and totals["deleted"]:
                from ticket_list_snapshot import refresh_all_hcs_snapshots

                snap = refresh_all_hcs_snapshots()
                totals["snapshot_refreshed"] = snap.get("refreshed")
                totals["snapshot_total"] = snap.get("total")
    except Exception as exc:
        logger.exception("delete script failed new_db=%s", _dsn_label(DB_DSN))
        print(f"删除失败：{exc}", file=sys.stderr)
        return 1

    print(json.dumps(totals, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
