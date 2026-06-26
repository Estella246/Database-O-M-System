"""请假审批通过后按时间段置灰轮值/局点值班；仅在请假窗口内 inactive，窗口外恢复当值。"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any, TypeVar

import psycopg
from psycopg.errors import UndefinedTable

_T = TypeVar("_T")

_EMPTY_STATS = {
    "restored_accounts": 0,
    "grayed_accounts": 0,
    "rotation_updated": 0,
    "site_oncall_updated": 0,
}


def _run_optional_duty_sql(conn: psycopg.Connection, fn: Callable[[], _T]) -> _T | None:
    """在 savepoint 内执行可选值班 SQL；表未迁移时回滚 savepoint，不污染外层事务。"""
    try:
        with conn.transaction():
            return fn()
    except UndefinedTable:
        return None


def record_leave_duty_suspend(
    conn: psycopg.Connection,
    leave_application_id: int,
    applicant_account: str,
    span_end: datetime,
) -> None:
    """登记已同意请假单（便于追踪；实际置灰/恢复按 leave_time_segment 窗口计算）。"""
    acc = str(applicant_account or "").strip()
    if not acc or not leave_application_id or span_end is None:
        return

    def _insert() -> None:
        conn.execute(
            """
            INSERT INTO leave_duty_suspend (leave_application_id, applicant_account, span_end)
            VALUES (%s, %s, %s)
            ON CONFLICT (leave_application_id) DO UPDATE SET
              applicant_account = EXCLUDED.applicant_account,
              span_end = EXCLUDED.span_end
            """,
            (int(leave_application_id), acc, span_end),
        )

    _run_optional_duty_sql(conn, _insert)


def _accounts_with_approved_leave(conn: psycopg.Connection) -> set[str]:
    rows = conn.execute(
        """
        SELECT DISTINCT applicant_account AS account
        FROM leave_application
        WHERE status = '同意申请'
        """
    ).fetchall()
    return {
        str(r.get("account") or "").strip()
        for r in rows
        if str(r.get("account") or "").strip()
    }


def _account_has_approved_leave(conn: psycopg.Connection, account: str) -> bool:
    acc = str(account or "").strip()
    if not acc:
        return False
    row = conn.execute(
        """
        SELECT 1
        FROM leave_application
        WHERE applicant_account = %s AND status = '同意申请'
        LIMIT 1
        """,
        (acc,),
    ).fetchone()
    return bool(row)


def _account_in_approved_leave_window(conn: psycopg.Connection, account: str) -> bool:
    acc = str(account or "").strip()
    if not acc:
        return False
    row = conn.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM leave_application a
            INNER JOIN leave_time_segment s ON s.leave_application_id = a.id
            WHERE a.applicant_account = %s
              AND a.status = '同意申请'
              AND s.start_at <= NOW()
              AND s.end_at > NOW()
        ) AS on_leave
        """,
        (acc,),
    ).fetchone()
    return bool(row and row.get("on_leave"))


def _apply_target_status_for_account(
    conn: psycopg.Connection,
    account: str,
    target_status: str,
    *,
    updated_by: str,
) -> tuple[int, int]:
    acc = str(account or "").strip()
    op = str(updated_by or "system").strip() or "system"
    if not acc or target_status not in ("active", "inactive"):
        return 0, 0
    rot_rows = conn.execute(
        """
        UPDATE duty_rotation_entry
        SET status = %s,
            updated_by = %s,
            updated_at = NOW()
        WHERE account = %s AND status IS DISTINCT FROM %s
        RETURNING roster_kind, position
        """,
        (target_status, op, acc, target_status),
    ).fetchall()
    site_rows = conn.execute(
        """
        UPDATE duty_site_oncall_row
        SET status = %s,
            updated_by = %s,
            updated_at = NOW()
        WHERE account = %s AND status IS DISTINCT FROM %s
        RETURNING position
        """,
        (target_status, op, acc, target_status),
    ).fetchall()
    return len(rot_rows), len(site_rows)


def _sync_leave_duty_for_accounts(
    conn: psycopg.Connection,
    accounts: set[str] | None,
    *,
    updated_by: str,
) -> dict[str, int]:
    op = str(updated_by or "system").strip() or "system"
    approved = _accounts_with_approved_leave(conn)
    if accounts is None:
        targets = approved
    else:
        targets = {str(a or "").strip() for a in accounts if str(a or "").strip()} & approved
    restored_accounts = 0
    grayed_accounts = 0
    rotation_updated = 0
    site_oncall_updated = 0
    for acc in sorted(targets):
        on_leave = _account_in_approved_leave_window(conn, acc)
        target = "inactive" if on_leave else "active"
        rot_n, site_n = _apply_target_status_for_account(conn, acc, target, updated_by=op)
        rotation_updated += rot_n
        site_oncall_updated += site_n
        if rot_n or site_n:
            if target == "active":
                restored_accounts += 1
            else:
                grayed_accounts += 1
    return {
        "restored_accounts": restored_accounts,
        "grayed_accounts": grayed_accounts,
        "rotation_updated": rotation_updated,
        "site_oncall_updated": site_oncall_updated,
    }


def sync_leave_duty_status(conn: psycopg.Connection, *, updated_by: str = "system") -> dict[str, int]:
    """读值班数据或派单前调用：按当前时刻是否在已同意请假窗口内同步当值/置灰。"""
    result = _run_optional_duty_sql(
        conn,
        lambda: _sync_leave_duty_for_accounts(conn, None, updated_by=updated_by),
    )
    return result if result is not None else dict(_EMPTY_STATS)


def apply_approved_leave_to_duty_rosters(
    conn: psycopg.Connection,
    applicant_account: str,
    *,
    updated_by: str = "system",
    leave_application_id: int | None = None,
    span_end: datetime | None = None,
) -> dict[str, Any]:
    """
    审批同意后立即按时间段同步轮值/局点值班状态（仅请假窗口内置灰）。
    不影响内核/管控值班日历、RL 值班表。
    """
    acc = str(applicant_account or "").strip()
    if not acc:
        return {"rotation_updated": 0, "site_oncall_updated": 0}
    if leave_application_id is not None and span_end is not None:
        record_leave_duty_suspend(conn, int(leave_application_id), acc, span_end)

    def _apply() -> dict[str, Any]:
        synced = _sync_leave_duty_for_accounts(conn, {acc}, updated_by=updated_by)
        return {
            "rotation_updated": synced["rotation_updated"],
            "site_oncall_updated": synced["site_oncall_updated"],
            "restored": {
                "restored_accounts": synced["restored_accounts"],
                "rotation_updated": synced["rotation_updated"],
                "site_oncall_updated": synced["site_oncall_updated"],
            },
            "grayed_accounts": synced["grayed_accounts"],
        }

    result = _run_optional_duty_sql(conn, _apply)
    if result is None:
        return {"rotation_updated": 0, "site_oncall_updated": 0}
    return result


def restore_duty_after_leave_deleted(
    conn: psycopg.Connection,
    applicant_account: str,
    *,
    updated_by: str = "system",
) -> dict[str, int]:
    """删除请假单后：按剩余已同意请假窗口同步；若无剩余则恢复当值。"""
    acc = str(applicant_account or "").strip()
    if not acc:
        return {"restored_accounts": 0, "rotation_updated": 0, "site_oncall_updated": 0}

    def _restore() -> dict[str, int]:
        if _account_has_approved_leave(conn, acc):
            return _sync_leave_duty_for_accounts(conn, {acc}, updated_by=updated_by)
        rot_n, site_n = _apply_target_status_for_account(conn, acc, "active", updated_by=updated_by)
        return {
            "restored_accounts": 1 if (rot_n or site_n) else 0,
            "grayed_accounts": 0,
            "rotation_updated": rot_n,
            "site_oncall_updated": site_n,
        }

    result = _run_optional_duty_sql(conn, _restore)
    if result is None:
        return {"restored_accounts": 0, "rotation_updated": 0, "site_oncall_updated": 0}
    return result
