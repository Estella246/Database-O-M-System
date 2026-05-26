from __future__ import annotations

from datetime import datetime

import psycopg
from psycopg.errors import UndefinedTable

from fastapi import APIRouter, HTTPException

from config import _LEAVE_SCHEMA_HINT, _LEAVE_APP_NO_LOCK, LEAVE_APPLICATION_TYPES
from database import db_conn
from leave_duty_effect import (
    apply_approved_leave_to_duty_rosters,
    restore_duty_after_leave_deleted,
    sync_leave_duty_status,
)
from whitelist_policy import whitelist_delete_allowed
from models import LeaveApproverWhitelistPutPayload, LeaveApplicationCreatePayload, LeaveActionPayload
from utils import dedupe_preserve_str as _dedupe_preserve_str, parse_iso_dt as _parse_iso_dt

router = APIRouter(prefix="/api/leave", tags=["leave"])


def _get_user_role(conn, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), False


def _require_duty_calendar_admin(conn: psycopg.Connection, operator_id: str) -> None:
    role, _ = _get_user_role(conn, operator_id.strip() or "")
    if role != "管理员":
        raise HTTPException(status_code=403, detail="仅管理员可编辑值班日历")


def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute("SELECT user_name FROM user_account WHERE account = %s", (acc,)).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _allocate_leave_application_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    prefix = f"QJ{ymd}"
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (_LEAVE_APP_NO_LOCK,))
    row = conn.execute(
        """
        SELECT COALESCE(MAX(CAST(RIGHT(application_no, 3) AS INT)), 0) AS mx
        FROM leave_application
        WHERE application_no LIKE %s AND LENGTH(application_no) = 13
        """,
        (prefix + "%",),
    ).fetchone()
    n = int(row["mx"] or 0) + 1
    if n > 999:
        raise HTTPException(status_code=500, detail="当日请假申请编号已满")
    return f"{prefix}{n:03d}"


@router.get("/approver-whitelist")
def get_leave_approver_whitelist(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT w.account, w.user_name, w.updated_at
                FROM leave_approver_whitelist w
                ORDER BY w.account
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假审批白名单表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    return {"items": rows}


@router.put("/approver-whitelist")
def put_leave_approver_whitelist(payload: LeaveApproverWhitelistPutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    accounts = _dedupe_preserve_str([str(a or "").strip() for a in payload.accounts if str(a or "").strip()])
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute("DELETE FROM leave_approver_whitelist")
            for acc in accounts:
                row = conn.execute(
                    "SELECT user_name FROM user_account WHERE account = %s",
                    (acc,),
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=400, detail=f"账号不在用户表: {acc}")
                conn.execute(
                    """
                    INSERT INTO leave_approver_whitelist (account, user_name, updated_by, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    """,
                    (acc, str(row["user_name"] or "").strip(), op),
                )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假审批白名单表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    return {"ok": True, "count": len(accounts)}


@router.get("/applications")
def list_leave_applications(
    operator_id: str = "demo_001",
    scope: str = "all",
    q: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    op = operator_id.strip() or "demo_001"
    sc = (scope or "all").strip().lower()
    if sc not in ("all", "todo", "pending_approval"):
        raise HTTPException(status_code=400, detail="scope 须为 all、todo 或 pending_approval")
    qq = str(q or "").strip()
    pg = max(1, page)
    ps = max(1, min(100, page_size))
    offset = (pg - 1) * ps
    try:
        with db_conn() as conn:
            sync_leave_duty_status(conn)
            conn.commit()
            where_parts: list[str] = ["1=1"]
            params: list = []
            if sc == "todo":
                where_parts.append("a.current_handler_account = %s AND a.status = %s")
                params.extend([op, "审批中"])
            elif sc == "pending_approval":
                where_parts.append(
                    """
                    (
                      (a.current_handler_account = %s AND a.status = %s)
                      OR (a.applicant_account = %s AND a.status IN ('待提交', '审批中'))
                    )
                    """
                )
                params.extend([op, "审批中", op])
            if qq:
                pat = f"%{qq}%"
                where_parts.append(
                    """
                    (
                      CAST(a.id AS TEXT) ILIKE %s
                      OR a.application_no ILIKE %s OR a.status ILIKE %s OR a.application_type ILIKE %s
                      OR a.applicant_display ILIKE %s OR a.approver_display ILIKE %s
                      OR COALESCE(a.current_handler_account, '') ILIKE %s
                      OR COALESCE(uh.user_name, '') ILIKE %s
                      OR EXISTS (
                        SELECT 1 FROM leave_time_segment s
                        WHERE s.leave_application_id = a.id AND (
                          s.reason ILIKE %s
                          OR CAST(s.duration_hours AS TEXT) ILIKE %s
                          OR TO_CHAR(s.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                          OR TO_CHAR(s.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ILIKE %s
                        )
                      )
                    )
                    """
                )
                params.extend([pat, pat, pat, pat, pat, pat, pat, pat, pat, pat, pat, pat])
            wh = " AND ".join(where_parts)
            count_row = conn.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM leave_application a
                LEFT JOIN user_account uh ON uh.account = a.current_handler_account
                WHERE {wh}
                """,
                tuple(params),
            ).fetchone()
            total = int(count_row["cnt"] or 0)
            sql = f"""
                SELECT
                  a.id,
                  a.application_no,
                  a.status,
                  a.application_type,
                  a.applicant_account,
                  a.applicant_display,
                  a.approver_account,
                  a.approver_display,
                  a.cc_accounts,
                  a.current_handler_account,
                  uh.user_name AS current_handler_user_name,
                  a.created_at,
                  a.submitted_at,
                  (SELECT MIN(s.start_at) FROM leave_time_segment s WHERE s.leave_application_id = a.id) AS span_start,
                  (SELECT MAX(s.end_at) FROM leave_time_segment s WHERE s.leave_application_id = a.id) AS span_end,
                  (SELECT COALESCE(SUM(s.duration_hours), 0) FROM leave_time_segment s WHERE s.leave_application_id = a.id) AS total_hours,
                  (SELECT STRING_AGG(s.reason, '；' ORDER BY s.seq) FROM leave_time_segment s WHERE s.leave_application_id = a.id) AS reasons_concat
                FROM leave_application a
                LEFT JOIN user_account uh ON uh.account = a.current_handler_account
                WHERE {wh}
                ORDER BY a.created_at DESC
                LIMIT %s OFFSET %s
            """
            rows = conn.execute(sql, tuple(params + [ps, offset])).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    out: list[dict] = []
    for r in rows:
        rowd = dict(r)
        ch_un = str(rowd.pop("current_handler_user_name", "") or "").strip()
        ch_acc = str(rowd.get("current_handler_account") or "").strip()
        cur_disp = f"{ch_un} {ch_acc}".strip() if ch_un and ch_acc else ch_acc
        rowd["current_handler_display"] = cur_disp
        out.append(rowd)
    return {"items": out, "total": total, "page": pg, "page_size": ps}


@router.post("/applications")
def create_leave_application(payload: LeaveApplicationCreatePayload) -> dict:
    op = payload.operator_id.strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if payload.application_type not in LEAVE_APPLICATION_TYPES:
        raise HTTPException(status_code=400, detail="申请类型无效")
    if not payload.segments:
        raise HTTPException(status_code=400, detail="至少填写一条时间段")
    approver = str(payload.approver_account or "").strip()
    if not approver:
        raise HTTPException(status_code=400, detail="审批人不能为空")
    cc_list = _dedupe_preserve_str([str(x or "").strip() for x in payload.cc_accounts if str(x or "").strip()])
    try:
        with db_conn() as conn:
            w = conn.execute(
                "SELECT 1 FROM leave_approver_whitelist WHERE account = %s",
                (approver,),
            ).fetchone()
            if not w:
                raise HTTPException(status_code=400, detail="审批人须在白名单内")
            applicant_disp = _display_name_account(conn, op)
            approver_disp = _display_name_account(conn, approver)
            for c in cc_list:
                if not conn.execute("SELECT 1 FROM user_account WHERE account = %s", (c,)).fetchone():
                    raise HTTPException(status_code=400, detail=f"抄送人账号不存在: {c}")
            app_no = _allocate_leave_application_no(conn)
            row = conn.execute(
                """
                INSERT INTO leave_application (
                  application_no, status, application_type,
                  applicant_account, applicant_display,
                  approver_account, approver_display,
                  cc_accounts, current_handler_account, submitted_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, NOW(), NOW())
                RETURNING id
                """,
                (
                    app_no,
                    "审批中",
                    payload.application_type.strip(),
                    op,
                    applicant_disp,
                    approver,
                    approver_disp,
                    psycopg.types.json.Jsonb(cc_list),
                    approver,
                ),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="写入申请失败")
            app_id = int(row["id"])
            for i, seg in enumerate(payload.segments):
                sdt = _parse_iso_dt(seg.start_at)
                edt = _parse_iso_dt(seg.end_at)
                if edt <= sdt:
                    raise HTTPException(status_code=400, detail="结束时间须晚于开始时间")
                dh = (edt - sdt).total_seconds() / 3600.0
                conn.execute(
                    """
                    INSERT INTO leave_time_segment (
                      leave_application_id, seq, start_at, end_at, duration_hours, reason
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        app_id,
                        i,
                        sdt,
                        edt,
                        dh,
                        str(seg.reason or "").strip(),
                    ),
                )
            conn.execute(
                """
                INSERT INTO leave_application_log (
                  leave_application_id, step_label, operator_account, operator_display, action, comment, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    app_id,
                    "提交",
                    op,
                    applicant_disp,
                    "提交申请",
                    "",
                ),
            )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    return {"ok": True, "id": app_id, "application_no": app_no}


@router.get("/applications/{app_id}")
def get_leave_application(app_id: int, operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            a = conn.execute(
                "SELECT * FROM leave_application WHERE id = %s",
                (app_id,),
            ).fetchone()
            if not a:
                raise HTTPException(status_code=404, detail="申请不存在")
            segs = conn.execute(
                """
                SELECT id, seq, start_at, end_at, duration_hours, reason
                FROM leave_time_segment WHERE leave_application_id = %s ORDER BY seq
                """,
                (app_id,),
            ).fetchall()
            logs = conn.execute(
                """
                SELECT id, step_label, operator_account, operator_display, action, comment, created_at
                FROM leave_application_log WHERE leave_application_id = %s ORDER BY id ASC
                """,
                (app_id,),
            ).fetchall()
            cc_raw = a.get("cc_accounts")
            cc_accounts: list = cc_raw if isinstance(cc_raw, list) else []
            cc_disp: list[dict[str, str]] = []
            for acc in cc_accounts:
                ac = str(acc or "").strip()
                if not ac:
                    continue
                cc_disp.append({"account": ac, "display": _display_name_account(conn, ac)})
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    return {
        "application": dict(a),
        "segments": segs,
        "logs": logs,
        "cc_displays": cc_disp,
    }


@router.delete("/applications/{app_id}")
def delete_leave_application(app_id: int, operator_id: str = "demo_001") -> dict:
    op = str(operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    duty_effect: dict = {}
    try:
        with db_conn() as conn:
            if not whitelist_delete_allowed(conn, op, "leave_delete"):
                raise HTTPException(status_code=403, detail="无删除权限（leave_delete）")
            a = conn.execute(
                "SELECT id, applicant_account, status FROM leave_application WHERE id = %s FOR UPDATE",
                (app_id,),
            ).fetchone()
            if not a:
                raise HTTPException(status_code=404, detail="申请不存在")
            applicant = str(a["applicant_account"] or "").strip()
            conn.execute("DELETE FROM leave_application WHERE id = %s", (app_id,))
            duty_effect = restore_duty_after_leave_deleted(conn, applicant, updated_by=op)
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    return {"ok": True, "id": app_id, "duty_effect": duty_effect}


@router.post("/applications/{app_id}/action")
def leave_application_action(app_id: int, payload: LeaveActionPayload) -> dict:
    act = str(payload.action or "").strip().lower()
    if act not in ("agree", "reject", "cancel"):
        raise HTTPException(status_code=400, detail="action 须为 agree / reject / cancel")
    op = str(payload.operator_id or "").strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    comment = str(payload.comment or "").strip()
    if act == "reject" and not comment:
        raise HTTPException(status_code=400, detail="拒绝时须填写审批意见")
    action_zh = {"agree": "同意申请", "reject": "拒绝申请", "cancel": "取消"}[act]
    new_status = {"agree": "同意申请", "reject": "拒绝申请", "cancel": "已取消"}[act]
    duty_effect: dict = {}
    try:
        with db_conn() as conn:
            a = conn.execute(
                "SELECT * FROM leave_application WHERE id = %s FOR UPDATE",
                (app_id,),
            ).fetchone()
            if not a:
                raise HTTPException(status_code=404, detail="申请不存在")
            if str(a["status"] or "") != "审批中":
                raise HTTPException(status_code=400, detail="仅审批中的申请可操作")
            if str(a["current_handler_account"] or "").strip() != op:
                raise HTTPException(status_code=403, detail="仅当前处理人可操作")
            op_disp = _display_name_account(conn, op)
            conn.execute(
                """
                UPDATE leave_application
                SET status = %s, current_handler_account = NULL, updated_at = NOW()
                WHERE id = %s
                """,
                (new_status, app_id),
            )
            conn.execute(
                """
                INSERT INTO leave_application_log (
                  leave_application_id, step_label, operator_account, operator_display, action, comment, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    app_id,
                    "审批",
                    op,
                    op_disp,
                    action_zh,
                    comment,
                ),
            )
            duty_effect = sync_leave_duty_status(conn, updated_by=op)
            if act == "agree":
                span_row = conn.execute(
                    """
                    SELECT MAX(end_at) AS span_end
                    FROM leave_time_segment
                    WHERE leave_application_id = %s
                    """,
                    (app_id,),
                ).fetchone()
                span_end = span_row.get("span_end") if span_row else None
                agree_effect = apply_approved_leave_to_duty_rosters(
                    conn,
                    str(a["applicant_account"] or ""),
                    updated_by=op,
                    leave_application_id=app_id,
                    span_end=span_end,
                )
                duty_effect = {**duty_effect, **agree_effect}
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    out: dict = {"ok": True, "status": new_status, "duty_effect": duty_effect}
    return out