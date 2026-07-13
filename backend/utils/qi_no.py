"""质量改进编号分配：ZLGJ-YYYYMMDD-NNN（每天独立，3 位序号）。"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
from fastapi import HTTPException

_QI_ADVISORY_LOCK_KEY = 58_290_431  # 与 _REQUIREMENT_NO_LOCK(58_290_413) 等区分
_CHINA_TZ = ZoneInfo("Asia/Shanghai")


def _current_date_str() -> str:
    return datetime.now(_CHINA_TZ).strftime("%Y%m%d")


def allocate_qi_no(conn: psycopg.Connection) -> str:
    """分配 QI-YYYYMMDD-NNN 编号。每天独立从 001 开始，3 位序号（001-999）。

    并发安全：pg_advisory_xact_lock 串行化分配。
    """
    date_str = _current_date_str()
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (_QI_ADVISORY_LOCK_KEY,))

    # 确保 (QI, date) 行存在
    conn.execute(
        """
        INSERT INTO qi_no_seq (seq_key, year_part, last_suffix)
        VALUES ('QI', %s, 0)
        ON CONFLICT (seq_key, year_part) DO NOTHING
        """,
        (date_str,),
    )

    row = conn.execute(
        "SELECT last_suffix FROM qi_no_seq WHERE seq_key = 'QI' AND year_part = %s FOR UPDATE",
        (date_str,),
    ).fetchone()
    suffix = int(str(row["last_suffix"]) or "0") if row else 0

    # 递增寻找未占用的编号（正常一次命中；防御性循环应对历史脏数据）
    for _ in range(999):
        suffix = suffix % 999 + 1  # 1..999 循环
        candidate = f"ZLGJ-{date_str}-{suffix:03d}"
        exists = conn.execute(
            "SELECT 1 FROM qi_request WHERE qi_no = %s", (candidate,)
        ).fetchone()
        if not exists:
            conn.execute(
                "UPDATE qi_no_seq SET last_suffix = %s WHERE seq_key = 'QI' AND year_part = %s",
                (suffix, date_str),
            )
            return candidate

    raise HTTPException(status_code=500, detail="QI 编号空间耗尽（当日已达 999 上限）")
