#!/usr/bin/env python3
"""回填工作台 HCS 工单列表快照。用法：python scripts/backfill_ticket_list_snapshot.py"""
from __future__ import annotations

import logging
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from utils.logging_config import setup_logging  # noqa: E402
from ticket_list_snapshot import refresh_all_hcs_snapshots  # noqa: E402

logger = logging.getLogger(__name__)


def main() -> int:
    setup_logging()
    logger.info("snapshot backfill cli start")
    summary = refresh_all_hcs_snapshots()
    logger.info("snapshot backfill cli done summary=%s", summary)
    print(f"回填完成：{summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
