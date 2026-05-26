"""请假审批通过后置灰轮值/局点值班；请假结束后自动恢复当值。"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any, TypeVar

import psycopg
from psycopg.errors import UndefinedTable

_T = TypeVar("_T")


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


def _restore_accounts_to_active(
    conn: psycopg.Connection,
    accounts: set[str],
    *,
    updated_by: str,
) -> dict[str, int]:
    op = str(updated_by or "system").strip() or "system"
    rotation_updated = 0
    site_oncall_updated = 0
    restored_accounts = 0
    for acc in sorted(accounts):
        if not acc:
            continue
        still = conn.execute(
            "SELECT 1 FROM leave_duty_suspend WHERE applicant_account = %s LIMIT 1",
            (acc,),
        ).fetchone()
        if still:
            continue
        rot_rows = conn.execute(
            """
            UPDATE duty_rotation_entry
            SET status = 'active',
                updated_by = %s,
                updated_at = NOW()
            WHERE account = %s AND status IS DISTINCT FROM 'active'
            RETURNING roster_kind, position
            """,
            (op, acc),
        ).fetchall()
        site_rows = conn.execute(
            """
            UPDATE duty_site_oncall_row
            SET status = 'active',
                updated_by = %s,
                updated_at = NOW()
            WHERE account = %s AND status IS DISTINCT FROM 'active'
            RETURNING position
            """,
            (op, acc),
        ).fetchall()
        if rot_rows or site_rows:
            restored_accounts += 1
        rotation_updated += len(rot_rows)
        site_oncall_updated += len(site_rows)
    return {
        "restored_accounts": restored_accounts,
        "rotation_updated": rotation_updated,
        "site_oncall_updated": site_oncall_updated,
    }


def restore_expired_leave_duty_status(
    conn: psycopg.Connection,
    *,
    updated_by: str = "system",
) -> dict[str, int]:
    """
    删除已到期请假挂起记录，并在该账号无其它未到期请假时将轮值/局点值班恢复为 active。
    仅处理曾登记在 leave_duty_suspend 的账号，不误恢复纯手动置灰人员。
    """
    empty = {
        "restored_accounts": 0,
        "rotation_updated": 0,
        "site_oncall_updated": 0,
    }

    def _delete_expired() -> list:
        return conn.execute(
            """
            DELETE FROM leave_duty_suspend
            WHERE span_end <= NOW()
            RETURNING applicant_account
            """
        ).fetchall()

    expired = _run_optional_duty_sql(conn, _delete_expired)
    if expired is None:
        return empty
    accounts = {
        str(r.get("applicant_account") or "").strip()
        for r in expired
        if str(r.get("applicant_account") or "").strip()
    }
    if not accounts:
        return empty
    return _restore_accounts_to_active(conn, accounts, updated_by=updated_by)


def apply_approved_leave_to_duty_rosters(
    conn: psycopg.Connection,
    applicant_account: str,
    *,
    updated_by: str = "system",
    leave_application_id: int | None = None,
    span_end: datetime | None = None,
) -> dict[str, Any]:
    """
    将申请人在全部轮值表、局点值班表中的当值状态置为 inactive（置灰）。
    不影响内核/管控值班日历、RL 值班表。
    """
    acc = str(applicant_account or "").strip()
    if not acc:
        return {"rotation_updated": 0, "site_oncall_updated": 0}
    op = str(updated_by or "system").strip() or "system"
    empty = {"rotation_updated": 0, "site_oncall_updated": 0}

    def _gray_out() -> tuple[int, int]:
        rot_rows = conn.execute(
            """
            UPDATE duty_rotation_entry
            SET status = 'inactive',
                updated_by = %s,
                updated_at = NOW()
            WHERE account = %s AND status IS DISTINCT FROM 'inactive'
            RETURNING roster_kind, position
            """,
            (op, acc),
        ).fetchall()
        site_rows = conn.execute(
            """
            UPDATE duty_site_oncall_row
            SET status = 'inactive',
                updated_by = %s,
                updated_at = NOW()
            WHERE account = %s AND status IS DISTINCT FROM 'inactive'
            RETURNING position
            """,
            (op, acc),
        ).fetchall()
        if leave_application_id is not None and span_end is not None:
            record_leave_duty_suspend(conn, int(leave_application_id), acc, span_end)
        return len(rot_rows), len(site_rows)

    counts = _run_optional_duty_sql(conn, _gray_out)
    if counts is None:
        return empty
    rotation_updated, site_oncall_updated = counts
    out: dict[str, Any] = {
        "rotation_updated": rotation_updated,
        "site_oncall_updated": site_oncall_updated,
    }
    if leave_application_id is not None and span_end is not None:
        restored = restore_expired_leave_duty_status(conn, updated_by=op)
        out["restored"] = restored
    return out


def sync_leave_duty_status(conn: psycopg.Connection, *, updated_by: str = "system") -> dict[str, int]:
    """读值班数据或派单前调用：处理已到期请假并恢复当值。"""
    return restore_expired_leave_duty_status(conn, updated_by=updated_by)


def restore_duty_after_leave_deleted(
    conn: psycopg.Connection,
    applicant_account: str,
    *,
    updated_by: str = "system",
) -> dict[str, int]:
    """删除请假单后：若该申请人无其它未到期挂起记录，恢复轮值/局点值班为 active。"""
    acc = str(applicant_account or "").strip()
    if not acc:
        return {"restored_accounts": 0, "rotation_updated": 0, "site_oncall_updated": 0}
    return _restore_accounts_to_active(conn, {acc}, updated_by=updated_by)
