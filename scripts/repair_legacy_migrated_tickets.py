#!/usr/bin/env python3
"""修复已迁历史工单的流程 ID / 状态 / 当前节点（从老库回填）。

用法（推荐用 backend 虚拟环境，会自动读 backend/.env）：
  backend/.venv/bin/python scripts/repair_legacy_migrated_tickets.py
  backend/.venv/bin/python scripts/repair_legacy_migrated_tickets.py --process-id YW20260501313

若手动 activate，请确保已加载与后端相同的 LEGACY_DATABASE_URL（见 backend/.env）。
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# 必须在 import database / legacy_migration 之前加载 .env（二者在 import 时读环境变量）
_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))
from load_backend_env import load_backend_env  # noqa: E402

load_backend_env()

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from legacy_migration import (  # noqa: E402
    get_legacy_dsn,
    legacy_conn,
    repair_legacy_migrated_tickets,
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
        user = p.username or "?"
        return f"{user}@{host}{port}/{db}"
    except Exception:  # noqa: BLE001
        return "<invalid-dsn>"


def main() -> None:
    setup_logging()
    logger.info(
        "repair script env new_db=%s legacy_db=%s",
        _dsn_label(DB_DSN),
        _dsn_label(get_legacy_dsn()),
    )
    parser = argparse.ArgumentParser(description="修复已迁历史工单的流程 ID 与当前阶段")
    parser.add_argument(
        "--process-id",
        action="append",
        dest="process_ids",
        default=[],
        help="仅修复指定流程 ID（可重复传入）；不传则修复全部已迁工单",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="每批处理的已迁工单数（默认 200）；0 表示不分批一次处理全部",
    )
    parser.add_argument(
        "--after-legacy-instance-id",
        type=int,
        default=0,
        help="仅处理 legacy_instance_id 大于此值的工单（分批续跑用）",
    )
    args = parser.parse_args()
    process_ids = _normalize_process_ids(args.process_ids)
    batch_size = max(0, int(args.batch_size))
    after_id = max(0, int(args.after_legacy_instance_id))

    totals: dict[str, Any] = {
        "repaired": 0,
        "skipped_unchanged": 0,
        "skipped_not_found": 0,
        "failed": 0,
        "processed": 0,
        "ticket_nos": [],
        "errors": [],
    }
    while True:
        try:
            with db_conn() as conn, legacy_conn() as lconn:
                summary = repair_legacy_migrated_tickets(
                    conn,
                    lconn,
                    process_ids=process_ids if process_ids else None,
                    limit=None if batch_size == 0 else batch_size,
                    after_legacy_instance_id=after_id,
                )
        except Exception as exc:
            logger.exception(
                "repair script failed new_db=%s legacy_db=%s",
                _dsn_label(DB_DSN),
                _dsn_label(get_legacy_dsn()),
            )
            hint = (
                "若报 t_work_flow_instance 不存在：请确认 backend/.env 中 LEGACY_DATABASE_URL "
                "与前端/后端一致（演示库多为 …/legacy_orders）。"
            )
            print(hint, file=sys.stderr)
            raise SystemExit(1) from exc
        for key in ("repaired", "skipped_unchanged", "skipped_not_found", "failed", "processed"):
            totals[key] += int(summary.get(key) or 0)
        totals["ticket_nos"].extend(summary.get("ticket_nos") or [])
        if summary.get("errors"):
            totals["errors"].extend(summary["errors"])
        if not summary.get("has_more") or batch_size == 0:
            totals["has_more"] = False
            break
        after_id = int(summary.get("next_after_legacy_instance_id") or after_id)
        if not after_id:
            break
        totals["has_more"] = True
        totals["next_after_legacy_instance_id"] = after_id
    print(json.dumps(totals, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
