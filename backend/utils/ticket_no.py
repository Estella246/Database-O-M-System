from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
from fastapi import HTTPException

_YW_TICKET_NO_RE = re.compile(r"^YW[0-9]{11}$")
_HPM_TICKET_NO_RE = re.compile(r"^HPM[0-9]{11}$")
_YW_ADVISORY_LOCK_KEY1 = 4_829_031
_YW_ADVISORY_LOCK_KEY2 = 90_210
_CHINA_TZ = ZoneInfo("Asia/Shanghai")


def _parse_ticket_suffix(row: object | None) -> int:
    if not row:
        return -1
    try:
        return int(str(row["suf"] or ""))
    except ValueError:
        return -1


def _last_yw_ticket_suffix(conn: psycopg.Connection) -> int:
    row = conn.execute(
        """
        SELECT SUBSTRING(ticket_no FROM 11 FOR 3) AS suf
        FROM ticket
        WHERE ticket_no ~ '^YW[0-9]{11}$'
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()
    return _parse_ticket_suffix(row)


def _last_hpm_ticket_suffix(conn: psycopg.Connection) -> int:
    row = conn.execute(
        """
        SELECT SUBSTRING(ticket_no FROM 12 FOR 3) AS suf
        FROM ticket
        WHERE ticket_no ~ '^HPM[0-9]{11}$'
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()
    return _parse_ticket_suffix(row)


def _allocate_ticket_no_global(
    conn: psycopg.Connection,
    prefix: str,
    last_suffix_fn,
    *,
    exhausted_detail: str,
) -> str:
    start = (last_suffix_fn(conn) + 1) % 1000
    for i in range(1000):
        n = (start + i) % 1000
        candidate = prefix + f"{n:03d}"
        exists = conn.execute(
            "SELECT 1 FROM ticket WHERE ticket_no = %s",
            (candidate,),
        ).fetchone()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail=exhausted_detail)


def allocate_yw_ticket_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    return _allocate_ticket_no_global(
        conn,
        f"YW{ymd}",
        _last_yw_ticket_suffix,
        exhausted_detail="ticket_no space exhausted (YW…000–999)",
    )


def allocate_hpm_ticket_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    return _allocate_ticket_no_global(
        conn,
        f"HPM{ymd}",
        _last_hpm_ticket_suffix,
        exhausted_detail="ticket_no space exhausted (HPM…000–999)",
    )