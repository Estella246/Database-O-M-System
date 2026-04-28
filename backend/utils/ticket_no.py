from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
from fastapi import HTTPException

_YW_TICKET_NO_RE = re.compile(r"^YW[0-9]{11}$")
_YW_ADVISORY_LOCK_KEY1 = 4_829_031
_YW_ADVISORY_LOCK_KEY2 = 90_210
_CHINA_TZ = ZoneInfo("Asia/Shanghai")


def allocate_yw_ticket_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    prefix = f"YW{ymd}"
    rows = conn.execute(
        """
        SELECT SUBSTRING(ticket_no FROM 11 FOR 3) AS suf
        FROM ticket
        WHERE ticket_no LIKE %s AND CHAR_LENGTH(ticket_no) = 13
        """,
        (prefix + "%",),
    ).fetchall()
    used: set[int] = set()
    for r in rows:
        try:
            used.add(int(str(r["suf"] or "")))
        except ValueError:
            pass
    for n in range(1000):
        if n not in used:
            return prefix + f"{n:03d}"
    raise HTTPException(status_code=500, detail="daily ticket_no space exhausted (YW…000–999)")