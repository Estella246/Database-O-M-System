"""请假审批通过后置灰轮值/局点值班；请假结束后自动恢复当值。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable


def record_leave_duty_suspend(
    conn: psycopg.Connection,
    leave_application_id: int,
    applicant_account: str,
    span_end: datetime,
) -> None:
    acc = str(applicant_account or "").strip()
    if not acc or not leave_application_id or span_end is None:
        return
    try:
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
    except UndefinedTable:
        pass


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
            RETURNING id
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
    try:
        expired = conn.execute(
            """
            DELETE FROM leave_duty_suspend
            WHERE span_end <= NOW()
            RETURNING applicant_account
            """
        ).fetchall()
    except UndefinedTable:
        return {
            "restored_accounts": 0,
            "rotation_updated": 0,
            "site_oncall_updated": 0,
        }
    accounts = {
        str(r.get("applicant_account") or "").strip()
        for r in expired
        if str(r.get("applicant_account") or "").strip()
    }
    if not accounts:
        return {
            "restored_accounts": 0,
            "rotation_updated": 0,
            "site_oncall_updated": 0,
        }
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
    rotation_updated = 0
    site_oncall_updated = 0
    try:
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
        rotation_updated = len(rot_rows)
        site_rows = conn.execute(
            """
            UPDATE duty_site_oncall_row
            SET status = 'inactive',
                updated_by = %s,
                updated_at = NOW()
            WHERE account = %s AND status IS DISTINCT FROM 'inactive'
            RETURNING id
            """,
            (op, acc),
        ).fetchall()
        site_oncall_updated = len(site_rows)
        if leave_application_id is not None and span_end is not None:
            record_leave_duty_suspend(conn, int(leave_application_id), acc, span_end)
    except UndefinedTable:
        return {"rotation_updated": 0, "site_oncall_updated": 0}
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
