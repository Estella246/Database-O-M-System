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


def _today_ymd() -> str:
    return datetime.now(_CHINA_TZ).strftime("%Y%m%d")


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


def _allocate_ticket_no_legacy(
    conn: psycopg.Connection,
    prefix: str,
    last_suffix_fn,
    *,
    exhausted_detail: str,
) -> str:
    """迁移 0089 未执行时回退：从 ticket 表推断 last_suffix。"""
    start = (last_suffix_fn(conn) + 1) % 1000
    for i in range(1000):
        n = (start + i) % 1000
        candidate = prefix + f"{n:03d}"
        if not _ticket_no_taken(conn, candidate):
            return candidate
    raise HTTPException(status_code=500, detail=exhausted_detail)


def _global_seq_table_exists(conn: psycopg.Connection) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ticket_global_seq'
        LIMIT 1
        """
    ).fetchone()
    return bool(row)


def _ensure_global_seq_row(conn: psycopg.Connection, seq_key: str) -> None:
    conn.execute(
        """
        INSERT INTO ticket_global_seq (seq_key, last_suffix)
        VALUES (%s, -1)
        ON CONFLICT (seq_key) DO NOTHING
        """,
        (seq_key,),
    )


def _read_global_suffix(conn: psycopg.Connection, seq_key: str) -> int:
    _ensure_global_seq_row(conn, seq_key)
    row = conn.execute(
        """
        SELECT last_suffix
        FROM ticket_global_seq
        WHERE seq_key = %s
        FOR UPDATE
        """,
        (seq_key,),
    ).fetchone()
    if not row:
        return -1
    try:
        return int(row["last_suffix"])
    except (TypeError, ValueError):
        return -1


def _write_global_suffix(conn: psycopg.Connection, seq_key: str, suffix: int) -> None:
    conn.execute(
        """
        UPDATE ticket_global_seq
        SET last_suffix = %s
        WHERE seq_key = %s
        """,
        (suffix, seq_key),
    )


def _ticket_no_taken(conn: psycopg.Connection, ticket_no: str) -> bool:
    return bool(
        conn.execute(
            "SELECT 1 FROM ticket WHERE ticket_no = %s",
            (ticket_no,),
        ).fetchone()
    )


def _allocate_ticket_no_with_global_seq(
    conn: psycopg.Connection,
    seq_key: str,
    prefix: str,
    *,
    exhausted_detail: str,
) -> str:
    """
    维护全局序号 a（000–999）：YW/HPM + 当天日期 + a。
    任何情况不重置 a；仅当 a 从 999 递增时回绕为 000。
    若拼接单号已存在，则 a+=1（mod 1000）再试，直至找到未占用号。
    """
    if not _global_seq_table_exists(conn):
        if seq_key == "HPM":
            return _allocate_ticket_no_legacy(conn, prefix, _last_hpm_ticket_suffix, exhausted_detail=exhausted_detail)
        return _allocate_ticket_no_legacy(conn, prefix, _last_yw_ticket_suffix, exhausted_detail=exhausted_detail)

    a = _read_global_suffix(conn, seq_key)
    for _ in range(1000):
        a = (a + 1) % 1000
        candidate = prefix + f"{a:03d}"
        if not _ticket_no_taken(conn, candidate):
            _write_global_suffix(conn, seq_key, a)
            return candidate
    raise HTTPException(status_code=500, detail=exhausted_detail)


def bump_global_suffix_at_least(conn: psycopg.Connection, seq_key: str, suffix: int) -> None:
    """指定单号落库成功后，将全局 a 推进到不低于该三位后缀（同日内单调递增）。"""
    if suffix < 0 or suffix > 999 or not _global_seq_table_exists(conn):
        return
    current = _read_global_suffix(conn, seq_key)
    if suffix > current:
        _write_global_suffix(conn, seq_key, suffix)


def allocate_yw_ticket_no(conn: psycopg.Connection) -> str:
    ymd = _today_ymd()
    return _allocate_ticket_no_with_global_seq(
        conn,
        "YW",
        f"YW{ymd}",
        exhausted_detail="ticket_no space exhausted (YW…000–999)",
    )


def allocate_hpm_ticket_no(conn: psycopg.Connection) -> str:
    ymd = _today_ymd()
    return _allocate_ticket_no_with_global_seq(
        conn,
        "HPM",
        f"HPM{ymd}",
        exhausted_detail="ticket_no space exhausted (HPM…000–999)",
    )


def parse_yw_suffix(ticket_no: str) -> int | None:
    no = str(ticket_no or "").strip()
    if not _YW_TICKET_NO_RE.match(no):
        return None
    try:
        return int(no[10:13])
    except ValueError:
        return None


def parse_hpm_suffix(ticket_no: str) -> int | None:
    no = str(ticket_no or "").strip()
    if not _HPM_TICKET_NO_RE.match(no):
        return None
    try:
        return int(no[11:14])
    except ValueError:
        return None
