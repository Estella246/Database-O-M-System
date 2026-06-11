#!/usr/bin/env python3
"""回填统计图表日汇总预聚合。依赖 ticket_list_snapshot 已就绪。用法：python scripts/backfill_ticket_stats_daily.py"""
from __future__ import annotations

import logging
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from utils.logging_config import setup_logging  # noqa: E402
from ticket_stats_daily import refresh_all_hcs_stats  # noqa: E402

logger = logging.getLogger(__name__)


def main() -> int:
    setup_logging()
    logger.info("stats daily backfill cli start")
    summary = refresh_all_hcs_stats()
    logger.info("stats daily backfill cli done summary=%s", summary)
    print(f"回填完成：{summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
