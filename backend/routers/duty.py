from __future__ import annotations

from datetime import date

import psycopg
from psycopg.errors import UndefinedTable

from fastapi import APIRouter, HTTPException

from config import (
    DUTY_ROTATION_ROSTER_KINDS,
    _DUTY_EXTRAS_SCHEMA_HINT,
    _HOLIDAY_SCHEMA_HINT,
)
from database import db_conn
from models import (
    DutyCalendarPutPayload,
    DutyRotationPutPayload,
    DutySiteOnCallPutPayload,
    DutyRlOnCallPutPayload,
    HolidayConfigPutPayload,
)
from utils import duty_month_bounds as _duty_month_bounds
from leave_duty_effect import sync_leave_duty_status

router = APIRouter(prefix="/api/duty", tags=["duty"])


def _get_user_role(conn, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        "SELECT role_code, is_pl FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), bool(row.get("is_pl") or False)


def _require_duty_calendar_admin(conn: psycopg.Connection, operator_id: str) -> None:
    role, _ = _get_user_role(conn, operator_id.strip() or "")
    if role != "管理员":
        raise HTTPException(status_code=403, detail="仅管理员可编辑值班日历")


def _normalize_day_type(v) -> str:
    raw = str(v or "").strip()
    if raw in ("workday", "工作日"):
        return "workday"
    if raw in ("weekend_holiday", "周末节假日"):
        return "weekend_holiday"
    raise HTTPException(status_code=400, detail="day_type 仅允许 workday(工作日) 或 weekend_holiday(周末节假日)")


def _normalize_duty_status(raw) -> str:
    st = str(raw or "active").strip()
    if st in ("active", "当值"):
        return "active"
    if st in ("inactive", "非当值"):
        return "inactive"
    raise HTTPException(status_code=400, detail="status 须为 active/inactive 或 当值/非当值")


def _validate_duty_rotation_put_lists(lists: dict) -> None:
    unknown = set(lists.keys()) - set(DUTY_ROTATION_ROSTER_KINDS)
    if unknown:
        raise HTTPException(status_code=400, detail=f"未知 roster_kind: {sorted(unknown)}")
    for kind in DUTY_ROTATION_ROSTER_KINDS:
        items = lists.get(kind)
        if items is None:
            continue
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail=f"{kind} 须为数组")
        for slot in items:
            if not isinstance(slot, dict):
                raise HTTPException(status_code=400, detail="轮值项格式无效")
            acc = str(slot.get("account") or "").strip()
            if not acc:
                raise HTTPException(status_code=400, detail=f"{kind} 中存在空的 account")
            st = str(slot.get("status") or "active").strip()
            if st not in ("active", "inactive", "当值", "非当值"):
                raise HTTPException(status_code=400, detail="status 须为 active/inactive 或 当值/非当值")


@router.get("/calendar")
def get_duty_calendar(year: int, month: int, operator_id: str = "demo_001") -> dict:
    _ = operator_id
    start, end = _duty_month_bounds(year, month)
    out_kernel: dict[str, list[dict[str, str]]] = {}
    out_control: dict[str, list[dict[str, str]]] = {}
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT table_kind, duty_date, account, user_name, shift
                FROM duty_calendar_assignment
                WHERE duty_date >= %s AND duty_date < %s
                ORDER BY table_kind, duty_date, id
                """,
                (start, end),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(
            status_code=503,
            detail="值班日历表未创建，请在数据库执行 db/migrations/0016_duty_calendar_assignment.sql",
        ) from exc
    for row in rows:
        raw_d = row["duty_date"]
        if isinstance(raw_d, date):
            dk = raw_d.isoformat()
        else:
            dk = str(raw_d)[:10]
        item = {
            "account": str(row["account"] or ""),
            "user_name": str(row["user_name"] or ""),
            "shift": str(row["shift"] or "full"),
        }
        kind = str(row["table_kind"] or "")
        if kind == "kernel":
            out_kernel.setdefault(dk, []).append(item)
        elif kind == "control":
            out_control.setdefault(dk, []).append(item)
    return {"year": year, "month": month, "kernel": out_kernel, "control": out_control}


@router.put("/calendar")
def put_duty_calendar(payload: DutyCalendarPutPayload) -> dict:
    kind = payload.kind.strip()
    if kind not in ("kernel", "control"):
        raise HTTPException(status_code=400, detail="kind 须为 kernel 或 control")
    start, end = _duty_month_bounds(payload.year, payload.month)
    op = payload.operator_id.strip() or "admin"
    prefix = f"{payload.year}-{payload.month:02d}-"
    for dk in payload.days.keys():
        if not isinstance(dk, str) or not dk.startswith(prefix):
            raise HTTPException(status_code=400, detail=f"日期键须属于当月: {dk}")
        for slot in payload.days[dk]:
            if not isinstance(slot, dict):
                raise HTTPException(status_code=400, detail="班次项格式无效")
            sh = str(slot.get("shift") or "full")
            if sh not in ("full", "night"):
                raise HTTPException(status_code=400, detail="shift 须为 full 或 night")
            acc = str(slot.get("account") or "").strip()
            if not acc:
                raise HTTPException(status_code=400, detail="account 不能为空")
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute(
                """
                DELETE FROM duty_calendar_assignment
                WHERE table_kind = %s AND duty_date >= %s AND duty_date < %s
                """,
                (kind, start, end),
            )
            for dk, slots in payload.days.items():
                for slot in slots:
                    if not isinstance(slot, dict):
                        continue
                    conn.execute(
                        """
                        INSERT INTO duty_calendar_assignment (
                          table_kind, duty_date, account, user_name, shift, updated_by, updated_at
                        )
                        VALUES (%s, %s::date, %s, %s, %s, %s, NOW())
                        """,
                        (
                            kind,
                            dk,
                            str(slot.get("account") or "").strip(),
                            str(slot.get("user_name") or "").strip(),
                            str(slot.get("shift") or "full"),
                            op,
                        ),
                    )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(
            status_code=503,
            detail="值班日历表未创建，请在数据库执行 db/migrations/0016_duty_calendar_assignment.sql",
        ) from exc
    return {"ok": True, "kind": kind, "year": payload.year, "month": payload.month}


@router.get("/holidays")
def get_holiday_config(year: int, month: int, operator_id: str = "demo_001") -> dict:
    _ = operator_id
    start, end = _duty_month_bounds(year, month)
    out: dict[str, str] = {}
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT holiday_date, day_type
                FROM holiday_day_config
                WHERE holiday_date >= %s AND holiday_date < %s
                ORDER BY holiday_date
                """,
                (start, end),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"节假日配置表未就绪：{_HOLIDAY_SCHEMA_HINT}") from exc
    for row in rows:
        raw_d = row.get("holiday_date")
        dk = raw_d.isoformat() if isinstance(raw_d, date) else str(raw_d)[:10]
        out[dk] = _normalize_day_type(row.get("day_type"))
    return {"year": year, "month": month, "days": out}


@router.put("/holidays")
def put_holiday_config(payload: HolidayConfigPutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    start, end = _duty_month_bounds(payload.year, payload.month)
    prefix = f"{payload.year}-{payload.month:02d}-"
    normalized_days: dict[str, str] = {}
    for dk, day_type in payload.days.items():
        if not isinstance(dk, str) or not dk.startswith(prefix):
            raise HTTPException(status_code=400, detail=f"日期键须属于当月: {dk}")
        normalized_days[dk] = _normalize_day_type(day_type)
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute(
                """
                DELETE FROM holiday_day_config
                WHERE holiday_date >= %s AND holiday_date < %s
                """,
                (start, end),
            )
            for dk, day_type in normalized_days.items():
                conn.execute(
                    """
                    INSERT INTO holiday_day_config (holiday_date, day_type, updated_by, updated_at)
                    VALUES (%s::date, %s, %s, NOW())
                    """,
                    (dk, day_type, op),
                )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"节假日配置表未就绪：{_HOLIDAY_SCHEMA_HINT}") from exc
    return {"ok": True, "year": payload.year, "month": payload.month}


@router.get("/rotation")
def get_duty_rotation(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    out: dict[str, list[dict[str, str]]] = {k: [] for k in DUTY_ROTATION_ROSTER_KINDS}
    try:
        with db_conn() as conn:
            sync_leave_duty_status(conn)
            conn.commit()
            rows = conn.execute(
                """
                SELECT roster_kind, position, account, user_name, status, last_accept_at
                FROM duty_rotation_entry
                ORDER BY roster_kind, position
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"轮值表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    for row in rows:
        kind = str(row["roster_kind"] or "")
        if kind not in out:
            continue
        out[kind].append(
            {
                "account": str(row["account"] or ""),
                "user_name": str(row["user_name"] or ""),
                "status": str(row["status"] or "active"),
                "last_accept_at": str(row["last_accept_at"] or ""),
            }
        )
    return out


@router.put("/rotation")
def put_duty_rotation(payload: DutyRotationPutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    lists = payload.lists if isinstance(payload.lists, dict) else {}
    _validate_duty_rotation_put_lists(lists)
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute("DELETE FROM duty_rotation_entry")
            for kind in DUTY_ROTATION_ROSTER_KINDS:
                items = lists.get(kind) or []
                for pos, slot in enumerate(items):
                    if not isinstance(slot, dict):
                        continue
                    conn.execute(
                        """
                        INSERT INTO duty_rotation_entry (
                          roster_kind, position, account, user_name, status, last_accept_at, updated_by, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        (
                            kind,
                            pos,
                            str(slot.get("account") or "").strip(),
                            str(slot.get("user_name") or "").strip(),
                            _normalize_duty_status(slot.get("status")),
                            str(slot.get("last_accept_at") or "").strip()[:64],
                            op,
                        ),
                    )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"轮值表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    return {"ok": True}


@router.get("/site-oncall")
def get_duty_site_oncall(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    rows_out: list[dict[str, str]] = []
    try:
        with db_conn() as conn:
            sync_leave_duty_status(conn)
            conn.commit()
            rows = conn.execute(
                """
                SELECT position, site_name, account, user_name, status, last_accept_at
                FROM duty_site_oncall_row
                ORDER BY position
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点值班表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    for row in rows:
        rows_out.append(
            {
                "site_name": str(row["site_name"] or ""),
                "account": str(row["account"] or ""),
                "user_name": str(row["user_name"] or ""),
                "status": str(row["status"] or "active"),
                "last_accept_at": str(row["last_accept_at"] or ""),
            }
        )
    return {"rows": rows_out}


@router.put("/site-oncall")
def put_duty_site_oncall(payload: DutySiteOnCallPutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    for i, row in enumerate(payload.rows):
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail="行格式无效")
        site = str(row.get("site_name") or "").strip()
        acc = str(row.get("account") or "").strip()
        if not site or not acc:
            raise HTTPException(status_code=400, detail=f"第 {i + 1} 行须含 site_name 与 account")
        st = str(row.get("status") or "active").strip()
        _normalize_duty_status(st)
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute("DELETE FROM duty_site_oncall_row")
            for pos, row in enumerate(payload.rows):
                if not isinstance(row, dict):
                    continue
                conn.execute(
                    """
                    INSERT INTO duty_site_oncall_row (
                      position, site_name, account, user_name, status, last_accept_at, updated_by, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    """,
                    (
                        pos,
                        str(row.get("site_name") or "").strip(),
                        str(row.get("account") or "").strip(),
                        str(row.get("user_name") or "").strip(),
                        _normalize_duty_status(row.get("status")),
                        str(row.get("last_accept_at") or "").strip()[:64],
                        op,
                    ),
                )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点值班表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    return {"ok": True, "count": len(payload.rows)}


@router.get("/rl-oncall")
def get_duty_rl_oncall(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    rows_out: list[dict] = []
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT duty_date, primary_account, primary_user_name, primary_phone,
                       backup_account, backup_user_name, backup_phone
                FROM duty_rl_oncall_row
                ORDER BY duty_date DESC
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"RL 值班表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    for row in rows:
        raw_d = row["duty_date"]
        dk = raw_d.isoformat() if isinstance(raw_d, date) else str(raw_d)[:10]
        rows_out.append(
            {
                "duty_date": dk,
                "primary": {
                    "account": str(row["primary_account"] or ""),
                    "user_name": str(row["primary_user_name"] or ""),
                    "phone": str(row["primary_phone"] or ""),
                },
                "backup": {
                    "account": str(row["backup_account"] or ""),
                    "user_name": str(row["backup_user_name"] or ""),
                    "phone": str(row["backup_phone"] or ""),
                },
            }
        )
    return {"rows": rows_out}


@router.put("/rl-oncall")
def put_duty_rl_oncall(payload: DutyRlOnCallPutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    seen_dates: set[str] = set()
    for i, row in enumerate(payload.rows):
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail="行格式无效")
        dk = str(row.get("duty_date") or "").strip()[:10]
        if not dk or len(dk) != 10:
            raise HTTPException(status_code=400, detail=f"第 {i + 1} 行 duty_date 无效")
        if dk in seen_dates:
            raise HTTPException(status_code=400, detail=f"重复日期: {dk}")
        seen_dates.add(dk)
        pri = row.get("primary") if isinstance(row.get("primary"), dict) else {}
        bak = row.get("backup") if isinstance(row.get("backup"), dict) else {}
        pa = str(pri.get("account") or "").strip()
        pp = str(pri.get("phone") or "").strip()
        if not pa or not pp:
            raise HTTPException(status_code=400, detail=f"日期 {dk} 的主值班须填写 account 与 phone")
        ba = str(bak.get("account") or "").strip()
        bp = str(bak.get("phone") or "").strip()
        if ba and not bp:
            raise HTTPException(status_code=400, detail=f"日期 {dk} 的备值班已选人须填写 phone")
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute("DELETE FROM duty_rl_oncall_row")
            for row in payload.rows:
                if not isinstance(row, dict):
                    continue
                dk = str(row.get("duty_date") or "").strip()[:10]
                pri = row.get("primary") if isinstance(row.get("primary"), dict) else {}
                bak = row.get("backup") if isinstance(row.get("backup"), dict) else {}
                conn.execute(
                    """
                    INSERT INTO duty_rl_oncall_row (
                      duty_date,
                      primary_account, primary_user_name, primary_phone,
                      backup_account, backup_user_name, backup_phone,
                      updated_by, updated_at
                    )
                    VALUES (%s::date, %s, %s, %s, %s, %s, %s, %s, NOW())
                    """,
                    (
                        dk,
                        str(pri.get("account") or "").strip(),
                        str(pri.get("user_name") or "").strip(),
                        str(pri.get("phone") or "").strip()[:32],
                        str(bak.get("account") or "").strip(),
                        str(bak.get("user_name") or "").strip(),
                        str(bak.get("phone") or "").strip()[:32],
                        op,
                    ),
                )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"RL 值班表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    return {"ok": True, "count": len(payload.rows)}