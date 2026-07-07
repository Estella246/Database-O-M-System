#!/usr/bin/env python3
"""按快照 event_level 回填重大问题表。用法：python scripts/backfill_major_issue.py"""
from __future__ import annotations

import logging
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from utils.logging_config import setup_logging  # noqa: E402
from routers.major_issue import backfill_all_major_issues  # noqa: E402

logger = logging.getLogger(__name__)


def main() -> int:
    setup_logging()
    logger.info("major_issue backfill cli start")
    summary = backfill_all_major_issues()
    logger.info("major_issue backfill cli done summary=%s", summary)
    print(f"回填完成：{summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
