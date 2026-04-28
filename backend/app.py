from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv()

import httpx
import psycopg
from psycopg.errors import UniqueViolation, UndefinedTable
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from psycopg.rows import dict_row

from config import (
    SCHEMA_NODE_KEY,
    SCHEMA_TEMPLATE_CODE,
    DIRECT_CLOSE_HANDLE_MODES,
    HANDLE_MODE_ROUTE,
    HOME_PERSONAL_SLA_STAGE_KEYS,
    HOME_PERSONAL_STAGE_NAME_BY_KEY,
    HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS,
    DUTY_ROTATION_ROSTER_KINDS,
    _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE,
    _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED,
    _COMPONENT_TO_KIND,
    _DUTY_STATUS_ON,
    _DUTY_EXTRAS_SCHEMA_HINT,
    _HOLIDAY_SCHEMA_HINT,
    _LEAVE_SCHEMA_HINT,
    _DUTY_FIELD_SCHEMA_HINT,
    _VERSION_SCHEMA_HINT,
    _GROUP_TEMPLATE_SCHEMA_HINT,
    _GROUP_TEMPLATE_KIND_ORDER,
    _GROUP_TEMPLATE_DEFAULTS,
    _DUTY_FIELD_MAX_DEPTH,
    _DUTY_FIELD_MAX_NODES,
    _DUTY_FIELD_OPTION_SET_CODES,
    _VERSION_BASELINE_OPTION_SET_CODES,
    _DUTY_FIELD_PATH_SEP,
    _LEAVE_APP_NO_LOCK,
    _REQUIREMENT_NO_LOCK,
    _REQUIREMENT_SCHEMA_HINT,
    REQUIREMENT_STATUSES,
    REQUIREMENT_CATEGORIES,
    REQUIREMENT_VALUES,
    REQUIREMENT_STATUS_FORWARD,
    REQUIREMENT_STATUS_BACKWARD,
    LEAVE_APPLICATION_TYPES,
    PERSON_VALUE_FIELD_KEYS,
    _PERSON_ACCOUNT_SPACE,
    _PERSON_ACCOUNT_PLUS,
)
from database import db_conn, DB_DSN
from utils import (
    _YW_TICKET_NO_RE,
    _YW_ADVISORY_LOCK_KEY1,
    _YW_ADVISORY_LOCK_KEY2,
    _CHINA_TZ,
    allocate_yw_ticket_no as _allocate_yw_ticket_no,
    dedupe_preserve_str as _dedupe_preserve_str,
    canonical_person_display as _canonical_person_display,
    field_visible as _base_field_visible,
    matches_required_if as _base_matches_required_if,
    optional_when_all_matches as _base_optional_when_all_matches,
    optional_when_any_matches as _base_optional_when_any_matches,
    effective_required as _base_effective_required,
    validate_one as _base_validate_one,
    duty_month_bounds as _duty_month_bounds,
    parse_last_accept_at as _parse_last_accept_at,
    parse_iso_dt as _parse_iso_dt,
    parse_ymd as _parse_ymd,
    to_utc_start as _to_utc_start,
)
from models import (
    SubmitPayload,
    PermissionPolicyItem,
    PermissionPolicyBulkPayload,
    UserAccountItem,
    UserAccountBulkPayload,
    DutyCalendarPutPayload,
    DutyRotationPutPayload,
    DutySiteOnCallPutPayload,
    DutyRlOnCallPutPayload,
    HolidayConfigPutPayload,
    LeaveTimeSegmentIn,
    LeaveApplicationCreatePayload,
    LeaveActionPayload,
    LeaveApproverWhitelistPutPayload,
    RequirementCreatePayload,
    RequirementPatchPayload,
    DutyFieldNodeInput,
    DutyFieldTreePutPayload,
    BaselineVersionCreatePayload,
    BaselineVersionPatchPayload,
    HotfixVersionCreatePayload,
    HotfixVersionPatchPayload,
    GroupTemplateItemIn,
    GroupTemplatePutPayload,
    AiConversationCreatePayload,
    AiConversationPatchPayload,
    AiChatPayload,
    AiQuickTemplateCreatePayload,
    AiQuickTemplatePatchPayload,
    LlmConfigPutPayload,
    AiUserLlmConfigPutPayload,
    LlmTestPayload,
)
from routers import health_router, permission_router, user_router, duty_router, leave_router, params_router, requirement_router

app = FastAPI(title="运维工单后端", version="0.2.0")

app.include_router(health_router)
app.include_router(permission_router)
app.include_router(user_router)
app.include_router(duty_router)
app.include_router(leave_router)
app.include_router(params_router)
app.include_router(requirement_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_schema(conn: psycopg.Connection, node_key: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT
          nfd.field_key AS key,
          nfd.field_name AS label,
          nfd.required,
          nfd.read_only AS readonly,
          nfd.field_type AS type,
          nfd.default_type,
          nfd.default_value,
          nfd.constraints_json AS constraints,
          nfd.ui_props_json AS ui_props,
          os.set_code AS option_set_code,
          os.source_type AS option_source_type
        FROM node_field_def nfd
        JOIN workflow_node wn ON wn.id = nfd.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        LEFT JOIN option_set os ON os.id = nfd.option_set_id
        WHERE wt.template_code = %s
          AND wn.node_key = %s
          AND nfd.is_active = TRUE
        ORDER BY nfd.sort_order
        """,
        (SCHEMA_TEMPLATE_CODE, node_key),
    ).fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Schema not found.")

    option_map: dict[str, list[str]] = {}
    option_codes = {r["option_set_code"] for r in rows if r["option_set_code"]}
    external_codes = {
        str(r["option_set_code"] or "")
        for r in rows
        if str(r.get("option_source_type") or "").strip() == "external_api" and r.get("option_set_code")
    }
    if option_codes:
        option_rows = conn.execute(
            """
            SELECT os.set_code, oi.option_value
            FROM option_set os
            JOIN option_item oi ON oi.option_set_id = os.id
            WHERE os.set_code = ANY(%s) AND oi.is_active = TRUE
            ORDER BY os.set_code, oi.sort_order
            """,
            (list(option_codes),),
        ).fetchall()
        for row in option_rows:
            option_map.setdefault(row["set_code"], []).append(row["option_value"])
    if external_codes & _VERSION_BASELINE_OPTION_SET_CODES:
        try:
            baseline_rows = conn.execute(
                """
                SELECT version_label
                FROM param_baseline_version
                ORDER BY sort_order, id
                """
            ).fetchall()
            labels = _dedupe_preserve_str(
                [str(r.get("version_label") or "").strip() for r in baseline_rows if str(r.get("version_label") or "").strip()]
            )
        except UndefinedTable:
            labels = []
        for code in external_codes & _VERSION_BASELINE_OPTION_SET_CODES:
            option_map[code] = labels

    duty_tree_public: list[dict[str, Any]] = []
    need_duty_cascade = any(
        str(r.get("option_set_code") or "") in _DUTY_FIELD_OPTION_SET_CODES
        and str(r.get("option_source_type") or "").strip() == "external_api"
        for r in rows
    )
    if need_duty_cascade:
        try:
            dr = conn.execute(
                """
                SELECT id, parent_id, label, sort_order
                FROM duty_field_node
                ORDER BY parent_id NULLS FIRST, sort_order, id
                """
            ).fetchall()
            duty_tree_public = _duty_field_tree_public(_duty_field_rows_to_tree(dr))
        except UndefinedTable:
            duty_tree_public = []

    next_handler_map: dict[str, list[str]] = {}
    map_table = conn.execute(
        "SELECT to_regclass('public.handle_mode_next_handler_whitelist') AS name"
    ).fetchone()
    if map_table and map_table.get("name"):
        map_rows = conn.execute(
            """
            SELECT handle_mode, handler_value
            FROM handle_mode_next_handler_whitelist
            WHERE node_key = %s AND is_active = TRUE
            ORDER BY handle_mode, sort_order, id
            """,
            (node_key,),
        ).fetchall()
        for row in map_rows:
            next_handler_map.setdefault(str(row["handle_mode"]), []).append(
                _canonical_person_display(str(row["handler_value"]))
            )
        for mode, lst in list(next_handler_map.items()):
            next_handler_map[mode] = _dedupe_preserve_str(lst)

    fields: list[dict[str, Any]] = []
    for row in rows:
        field = {
            "key": row["key"],
            "label": row["label"],
            "required": row["required"],
            "readonly": row["readonly"],
            "type": row["type"],
            "default_type": row["default_type"],
            "default_value": row["default_value"],
        }
        c = row.get("constraints")
        if isinstance(c, dict):
            field["constraints"] = c
        else:
            field["constraints"] = {}
        if row["key"] == "next_handler" and next_handler_map:
            field["constraints"]["next_handler_by_handle_mode"] = next_handler_map
        up = row.get("ui_props")
        if isinstance(up, dict):
            field["ui_props"] = up
        code = str(row["option_set_code"] or "")
        st = str(row.get("option_source_type") or "").strip()
        if code in _DUTY_FIELD_OPTION_SET_CODES and st == "external_api":
            field["cascade_options"] = duty_tree_public
            paths = _duty_field_allowed_path_strings(duty_tree_public)
            field["options"] = paths
        elif code:
            options = list(option_map.get(code, []))
            if row["key"] in PERSON_VALUE_FIELD_KEYS and options and options != ["temp"]:
                options = _dedupe_preserve_str([_canonical_person_display(str(o)) for o in options])
            field["options"] = options if options else ["temp"]
        fields.append(field)

    return fields


def _merge_inherited_previous_values(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    fields: list[dict[str, Any]],
    values: dict[str, Any],
) -> dict[str, Any]:
    inheritable_keys = [
        str(f.get("key") or "")
        for f in fields
        if isinstance(f.get("ui_props"), dict)
        and bool((f.get("ui_props") or {}).get("inherit_previous"))
        and str(f.get("key") or "").strip()
    ]
    if not inheritable_keys:
        return values

    # 已有值（即使为空串）视为用户已明确输入，不再覆写。
    pending = [k for k in inheritable_keys if k not in values]
    if not pending:
        return values

    node_row = conn.execute(
        """
        SELECT wn.node_order
        FROM workflow_node wn
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s
          AND wn.node_key = %s
        LIMIT 1
        """,
        (SCHEMA_TEMPLATE_CODE, node_key),
    ).fetchone()
    if not node_row:
        return values

    rows = conn.execute(
        """
        SELECT tnd.values_json
        FROM ticket t
        JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE t.ticket_no = %s
          AND wt.template_code = %s
          AND wn.node_order <= %s
        ORDER BY wn.node_order DESC, tnd.created_at DESC, tnd.id DESC
        """,
        (ticket_no, SCHEMA_TEMPLATE_CODE, int(node_row["node_order"])),
    ).fetchall()

    out = dict(values)
    unresolved = set(pending)
    for row in rows:
        raw = row.get("values_json")
        if not isinstance(raw, dict):
            continue
        for key in tuple(unresolved):
            v = raw.get(key)
            if v in (None, ""):
                continue
            out[key] = v
            unresolved.discard(key)
        if not unresolved:
            break

    return out


def _field_visible(field: dict[str, Any], values: dict[str, Any]) -> bool:
    if field.get("key") == "next_handler" and str(values.get("handle_mode") or "") == "问题解决关闭":
        return False
    c = field.get("constraints") or {}
    rules = c.get("visible_when_all")
    if not rules:
        return True
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) not in allowed:
            return False
    return True


def _effective_required(field: dict[str, Any], values: dict[str, Any]) -> bool:
    c = field.get("constraints") or {}
    if not _field_visible(field, values):
        return False
    if _base_optional_when_any_matches(c, values) or _base_optional_when_all_matches(c, values):
        return False
    if c.get("required_when_visible"):
        return True
    if c.get("required_if"):
        return _base_matches_required_if(c, values)
    return bool(field.get("required", False))


def _apply_default(field: dict[str, Any], incoming: dict[str, Any], login_user: str) -> Any:
    key = field["key"]
    if key in incoming and incoming[key] not in (None, ""):
        return incoming[key]
    if field.get("default_type") == "today":
        return date.today().isoformat()
    if field.get("default_type") == "login_user":
        return login_user
    return field.get("default_value")


def _validate_one(field: dict[str, Any], value: Any) -> str | None:
    key = field["key"]
    field_type = field["type"]
    required = bool(field.get("required", False))

    if value in ("", None):
        return f"{key} is required" if required else None

    if field_type in ("text", "richtext"):
        if not isinstance(value, str):
            return f"{key} must be string"
        return None

    if field_type == "date":
        if not isinstance(value, str):
            return f"{key} must be date string"
        try:
            date.fromisoformat(value)
        except ValueError:
            return f"{key} must be YYYY-MM-DD"
        return None

    if field_type == "datetime":
        if not isinstance(value, str):
            return f"{key} must be datetime string"
        try:
            datetime.fromisoformat(value)
        except ValueError:
            return f"{key} must be ISO datetime"
        return None

    if field_type == "whitelist":
        co = field.get("cascade_options")
        if isinstance(co, list):
            if not isinstance(value, str):
                return f"{key} must be string option"
            allowed = {_normalize_duty_path_value(p) for p in _duty_field_allowed_path_strings(co)}
            nv = _normalize_duty_path_value(value)
            if nv in allowed:
                return None
            return f"{key} 须为责任田模块中已配置的路径（多级用 / 连接，如 a/b/c）"
        options = field.get("options", [])
        if not isinstance(value, str):
            return f"{key} must be string option"
        if key in PERSON_VALUE_FIELD_KEYS:
            allowed = {_canonical_person_display(str(o)) for o in options}
            if _canonical_person_display(value) in allowed:
                return None
            return f"{key} must be one of {options}"
        if value in options:
            return None
        return f"{key} must be one of {options}"

    return f"{key} has unsupported field type {field_type}"


def _get_or_create_ticket(
    conn: psycopg.Connection, ticket_no: str, operator_id: str, operator_name: str, initial_node_key: str = SCHEMA_NODE_KEY
) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT t.id, t.ticket_no, t.current_node_id, COALESCE(t.status, 'open') AS status
        FROM ticket t
        WHERE t.ticket_no = %s
        """,
        (ticket_no,),
    ).fetchone()
    if row:
        return row

    tmpl = conn.execute(
        "SELECT id FROM workflow_template WHERE template_code = %s",
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    if not tmpl:
        raise HTTPException(status_code=500, detail="workflow template missing")

    node = conn.execute(
        """
        SELECT id
        FROM workflow_node
        WHERE template_id = %s AND node_key = %s
        """,
        (tmpl["id"], initial_node_key),
    ).fetchone()
    if not node:
        raise HTTPException(status_code=500, detail=f"workflow node missing: {initial_node_key}")

    conn.execute(
        "SELECT pg_advisory_xact_lock(%s, %s)",
        (_YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2),
    )
    again = conn.execute(
        """
        SELECT t.id, t.ticket_no, t.current_node_id, COALESCE(t.status, 'open') AS status
        FROM ticket t
        WHERE t.ticket_no = %s
        """,
        (ticket_no,),
    ).fetchone()
    if again:
        return again

    final_no = str(ticket_no or "").strip()
    if not _YW_TICKET_NO_RE.match(final_no):
        final_no = _allocate_yw_ticket_no(conn)

    for _ in range(1000):
        try:
            conn.execute("SAVEPOINT yw_ticket_ins")
            created = conn.execute(
                """
                INSERT INTO ticket (ticket_no, template_id, title, current_node_id, status, creator_id, creator_name)
                VALUES (%s, %s, %s, %s, 'open', %s, %s)
                RETURNING id, ticket_no, current_node_id, status
                """,
                (final_no, tmpl["id"], f"Order {final_no}", node["id"], operator_id, operator_name),
            ).fetchone()
            conn.execute("RELEASE SAVEPOINT yw_ticket_ins")
            return created
        except UniqueViolation:
            conn.execute("ROLLBACK TO SAVEPOINT yw_ticket_ins")
            final_no = _allocate_yw_ticket_no(conn)
    raise HTTPException(status_code=500, detail="failed to allocate ticket_no")


def _resolve_next_node_key(node_key: str, handle_mode: str) -> str:
    mode = str(handle_mode or "").strip()
    if mode in DIRECT_CLOSE_HANDLE_MODES:
        return node_key
    if mode.startswith("提交其他"):
        return node_key
    if node_key == "problem_fill":
        return "problem_review"
    route = HANDLE_MODE_ROUTE.get(node_key, {})
    return str(route.get(mode, "") or "")


def _get_user_role(conn: psycopg.Connection, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        """
        SELECT role_code, is_pl
        FROM user_account
        WHERE account = %s
        """,
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), bool(row["is_pl"])


def _require_duty_calendar_admin(conn: psycopg.Connection, operator_id: str) -> None:
    role, _ = _get_user_role(conn, operator_id.strip() or "")
    if role != "管理员":
        raise HTTPException(status_code=403, detail="仅管理员可编辑值班日历")


def _normalize_component(v: Any) -> str:
    comp = str(v or "").strip()
    if comp not in _COMPONENT_TO_KIND:
        raise HTTPException(status_code=400, detail="问题组件仅允许“内核问题/管控问题”")
    return comp


def _normalize_day_type(v: Any) -> str:
    raw = str(v or "").strip()
    if raw in ("workday", "工作日"):
        return "workday"
    if raw in ("weekend_holiday", "周末节假日"):
        return "weekend_holiday"
    raise HTTPException(status_code=400, detail="day_type 仅允许 workday(工作日) 或 weekend_holiday(周末节假日)")


def _normalize_issue_type_judge_key(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    if not s:
        return ""
    s = s.replace("（", "(").replace("）", ")")
    s = re.sub(r"\s+", "", s)
    s = s.replace("(", "").replace(")", "")
    return s


def _day_type_for_date(conn: psycopg.Connection, d: date) -> str:
    try:
        row = conn.execute(
            """
            SELECT day_type
            FROM holiday_day_config
            WHERE holiday_date = %s
            """,
            (d,),
        ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"节假日配置表未就绪：{_HOLIDAY_SCHEMA_HINT}") from exc
    if row and str(row.get("day_type") or "").strip():
        return _normalize_day_type(row["day_type"])
    return "weekend_holiday" if d.weekday() >= 5 else "workday"


def _routing_window(conn: psycopg.Connection, now_cn: datetime) -> tuple[str, date, str]:
    tm = now_cn.time()
    today = now_cn.date()
    if time(9, 0) <= tm <= time(18, 0):
        day_type = _day_type_for_date(conn, today)
        if day_type == "workday":
            return ("workday_day", today, "")
        return ("holiday_full", today, "full")
    if tm > time(18, 0):
        day_type = _day_type_for_date(conn, today)
        if day_type == "workday":
            return ("workday_night", today, "night")
        return ("holiday_full", today, "full")
    prev = today - timedelta(days=1)
    prev_type = _day_type_for_date(conn, prev)
    if prev_type == "workday":
        return ("workday_night", prev, "night")
    return ("holiday_full", prev, "full")


def _pick_rotation_handler(
    conn: psycopg.Connection, roster_kind: str, ticket_no: str, node_key: str, rule_detail: dict[str, Any]
) -> str:
    rows = conn.execute(
        """
        SELECT roster_kind, position, account, user_name, status, last_accept_at
        FROM duty_rotation_entry
        WHERE roster_kind = %s
        ORDER BY position
        """,
        (roster_kind,),
    ).fetchall()
    candidates = [r for r in rows if str(r.get("status") or "").strip() in _DUTY_STATUS_ON]
    if not candidates:
        return ""
    selected = min(candidates, key=lambda r: (_parse_last_accept_at(r.get("last_accept_at")), int(r.get("position") or 0)))
    now_cn = datetime.now(_CHINA_TZ)
    now_txt = now_cn.strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        """
        UPDATE duty_rotation_entry
        SET last_accept_at = %s,
            last_dispatch_at = NOW(),
            last_dispatch_ticket_no = %s,
            last_dispatch_node_key = %s,
            last_dispatch_rule = %s::jsonb,
            updated_at = NOW()
        WHERE roster_kind = %s AND position = %s
        """,
        (
            now_txt,
            ticket_no,
            node_key,
            psycopg.types.json.Jsonb(rule_detail),
            str(selected.get("roster_kind") or ""),
            int(selected.get("position") or 0),
        ),
    )
    return _canonical_person_display(f"{selected.get('account') or ''} {selected.get('user_name') or ''}")


def _pick_calendar_handler(
    conn: psycopg.Connection, table_kind: str, duty_date: date, shift: str, ticket_no: str, node_key: str, rule_detail: dict[str, Any]
) -> str:
    rows = conn.execute(
        """
        SELECT id, account, user_name, last_accept_at
        FROM duty_calendar_assignment
        WHERE table_kind = %s AND duty_date = %s AND shift = %s
        ORDER BY id
        """,
        (table_kind, duty_date, shift),
    ).fetchall()
    if not rows:
        return ""
    selected = min(rows, key=lambda r: (_parse_last_accept_at(r.get("last_accept_at")), int(r.get("id") or 0)))
    now_cn = datetime.now(_CHINA_TZ)
    now_txt = now_cn.strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        """
        UPDATE duty_calendar_assignment
        SET last_accept_at = %s,
            last_dispatch_at = NOW(),
            last_dispatch_ticket_no = %s,
            last_dispatch_node_key = %s,
            last_dispatch_rule = %s::jsonb,
            updated_at = NOW()
        WHERE id = %s
        """,
        (now_txt, ticket_no, node_key, psycopg.types.json.Jsonb(rule_detail), int(selected.get("id") or 0)),
    )
    return _canonical_person_display(f"{selected.get('account') or ''} {selected.get('user_name') or ''}")


def _resolve_problem_fill_handler(conn: psycopg.Connection, ticket_no: str, node_key: str, values: dict[str, Any]) -> str:
    component = _normalize_component(values.get("component"))
    now_cn = datetime.now(_CHINA_TZ)
    win, duty_date, shift = _routing_window(conn, now_cn)
    kind = _COMPONENT_TO_KIND[component]
    if win == "workday_day":
        roster_kind = "kernelRotation" if kind == "kernel" else "controlRotation"
        detail = {
            "rule_stage": "problem_fill",
            "window": win,
            "component": component,
            "source_table": "duty_rotation_entry",
            "roster_kind": roster_kind,
        }
        return _pick_rotation_handler(conn, roster_kind, ticket_no, node_key, detail)
    detail = {
        "rule_stage": "problem_fill",
        "window": win,
        "component": component,
        "source_table": "duty_calendar_assignment",
        "table_kind": kind,
        "duty_date": duty_date.isoformat(),
        "shift": shift,
    }
    return _pick_calendar_handler(conn, kind, duty_date, shift, ticket_no, node_key, detail)


def _resolve_problem_review_other_ops_handler(
    conn: psycopg.Connection, ticket_no: str, node_key: str, values: dict[str, Any]
) -> str:
    issue_type = str(values.get("issue_type_judge") or "").strip()
    roster_kind = _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE.get(issue_type, "")
    if not roster_kind:
        norm_key = _normalize_issue_type_judge_key(issue_type)
        roster_kind = _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED.get(norm_key, "")
    if not roster_kind:
        return ""
    detail = {
        "rule_stage": "problem_review",
        "rule_type": "submit_other_ops_review",
        "issue_type_judge": issue_type,
        "source_table": "duty_rotation_entry",
        "roster_kind": roster_kind,
    }
    return _pick_rotation_handler(conn, roster_kind, ticket_no, node_key, detail)


def _current_node_handler_display(conn: psycopg.Connection, ticket_internal_id: int, current_node_id: int) -> str:
    row = conn.execute(
        """
        SELECT handler_name
        FROM ticket_node_instance
        WHERE ticket_id = %s AND node_id = %s
        ORDER BY id DESC
        LIMIT 1
        """,
        (ticket_internal_id, current_node_id),
    ).fetchone()
    return _canonical_person_display(str((row or {}).get("handler_name") or ""))


def _group_template_row_dict(r: Any) -> dict[str, Any]:
    return {
        "problem_kind": str(r["problem_kind"] or ""),
        "group_name_tpl": str(r.get("group_name_tpl") or ""),
        "group_notice_tpl": str(r.get("group_notice_tpl") or ""),
        "group_members_tpl": str(r.get("group_members_tpl") or ""),
        "first_report_tpl": str(r.get("first_report_tpl") or ""),
        "updated_by": str(r.get("updated_by") or ""),
        "updated_at": r.get("updated_at"),
    }


def _merge_group_template_list(rows: list[Any]) -> list[dict[str, Any]]:
    by_kind = {str(r["problem_kind"] or ""): r for r in rows if str(r.get("problem_kind") or "")}
    out: list[dict[str, Any]] = []
    for k in _GROUP_TEMPLATE_KIND_ORDER:
        if k in by_kind:
            out.append(_group_template_row_dict(by_kind[k]))
        else:
            d = _GROUP_TEMPLATE_DEFAULTS.get(k, {})
            out.append(
                {
                    "problem_kind": k,
                    "group_name_tpl": d.get("group_name_tpl", ""),
                    "group_notice_tpl": d.get("group_notice_tpl", ""),
                    "group_members_tpl": d.get("group_members_tpl", ""),
                    "first_report_tpl": d.get("first_report_tpl", ""),
                    "updated_by": "system",
                    "updated_at": None,
                }
            )
    return out


def _validate_duty_field_tree(nodes: list[DutyFieldNodeInput], depth: int = 0) -> int:
    if depth > _DUTY_FIELD_MAX_DEPTH:
        raise HTTPException(status_code=400, detail=f"层级过深（上限 {_DUTY_FIELD_MAX_DEPTH}）")
    total = 0
    for n in nodes:
        if not str(n.label or "").strip():
            raise HTTPException(status_code=400, detail="存在未填写名称的节点，请补全或删除后再保存")
        total += 1
        total += _validate_duty_field_tree(n.children, depth + 1)
    if total > _DUTY_FIELD_MAX_NODES:
        raise HTTPException(status_code=400, detail=f"节点总数超过上限 {_DUTY_FIELD_MAX_NODES}")
    return total


def _duty_field_insert_tree(
    conn: psycopg.Connection,
    parent_id: int | None,
    nodes: list[DutyFieldNodeInput],
    operator_id: str,
    sort_base: int = 0,
) -> None:
    op = operator_id.strip() or "admin"
    for i, n in enumerate(nodes):
        lab = str(n.label or "").strip()[:512]
        row = conn.execute(
            """
            INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING id
            """,
            (parent_id, lab, sort_base + i, op),
        ).fetchone()
        if not row:
            continue
        cid = int(row["id"])
        if n.children:
            _duty_field_insert_tree(conn, cid, n.children, op, 0)


def _duty_field_rows_to_tree(rows: list[Any]) -> list[dict[str, Any]]:
    by_parent: dict[Any, list[Any]] = defaultdict(list)
    for r in rows:
        by_parent[r["parent_id"]].append(r)
    for k in list(by_parent.keys()):
        by_parent[k].sort(key=lambda x: (int(x["sort_order"] or 0), int(x["id"] or 0)))

    def build(pid: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for r in by_parent.get(pid, []):
            rid = int(r["id"])
            out.append(
                {
                    "id": rid,
                    "label": str(r["label"] or ""),
                    "children": build(rid),
                }
            )
        return out

    return build(None)


def _duty_field_tree_public(nodes: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        lab = str(n.get("label") or "").strip()
        raw_ch = n.get("children")
        ch: list[dict[str, Any]] = []
        if isinstance(raw_ch, list):
            ch = _duty_field_tree_public(raw_ch)
        out.append({"label": lab, "children": ch})
    return out


def _duty_field_allowed_path_strings(nodes: list[Any], prefix: list[str] | None = None) -> list[str]:
    prefix = prefix or []
    paths: list[str] = []
    if not isinstance(nodes, list):
        return paths
    sep = _DUTY_FIELD_PATH_SEP
    for n in nodes:
        if not isinstance(n, dict):
            continue
        lab = str(n.get("label") or "").strip()
        if not lab:
            continue
        parts = prefix + [lab]
        paths.append(sep.join(parts))
        ch = n.get("children")
        if isinstance(ch, list) and ch:
            paths.extend(_duty_field_allowed_path_strings(ch, parts))
    return paths


def _normalize_duty_path_value(raw: Any) -> str:
    """多级路径统一为 a/b/c（兼容历史「a / b」等写法）。"""
    s = str(raw or "").strip()
    if not s:
        return ""
    parts = [p.strip() for p in re.split(r"\s*/\s*", s) if p.strip()]
    return _DUTY_FIELD_PATH_SEP.join(parts)


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


def _allocate_requirement_no(conn: psycopg.Connection) -> str:
    ymd = datetime.now().strftime("%Y%m%d")
    prefix = f"RQ{ymd}"
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (_REQUIREMENT_NO_LOCK,))
    row = conn.execute(
        """
        SELECT COALESCE(MAX(CAST(RIGHT(requirement_no, 3) AS INT)), 0) AS mx
        FROM requirement
        WHERE requirement_no LIKE %s AND LENGTH(requirement_no) = 13
        """,
        (prefix + "%",),
    ).fetchone()
    n = int(row["mx"] or 0) + 1
    if n > 999:
        raise HTTPException(status_code=500, detail="当日需求编号已满")
    return f"{prefix}{n:03d}"


def _quality_scope_matches(scope: str, raw_value: str) -> bool:
    sc = str(scope or "all").strip().lower()
    if sc == "all":
        return True
    v = str(raw_value or "").strip().lower()
    if not v:
        return False if sc in {"quality", "non_quality"} else True
    quality_tokens = ("是", "质量", "yes", "true", "1")
    non_quality_tokens = ("否", "非质量", "no", "false", "0")
    is_quality = any(tok in v for tok in quality_tokens) and not any(tok in v for tok in non_quality_tokens)
    if sc == "quality":
        return is_quality
    if sc == "non_quality":
        return not is_quality
    return True


def _get_whitelist_flags(conn: psycopg.Connection, operator_id: str) -> dict[str, bool]:
    role_code, is_pl = _get_user_role(conn, operator_id)
    if not role_code:
        return {
            "ticket_list_only_self_created": False,
            "ticket_detail_only_problem_fill": False,
        }
    rows = conn.execute(
        """
        SELECT field_key, permission_level
        FROM role_permission_policy
        WHERE role_code = %s
          AND node_key = '__whitelist__'
          AND (is_pl = %s OR is_pl = FALSE)
        ORDER BY is_pl DESC, field_key
        """,
        (role_code, is_pl),
    ).fetchall()
    level_by_key: dict[str, str] = {}
    for row in rows:
        k = str(row["field_key"] or "")
        if not k or k in level_by_key:
            continue
        level_by_key[k] = str(row["permission_level"] or "hidden")
    return {
        "ticket_list_only_self_created": level_by_key.get("ticket_list_scope_self") == "editable",
        "ticket_detail_only_problem_fill": level_by_key.get("ticket_detail_scope_problem_fill") == "editable",
    }


@app.get("/api/tickets/basic")
def list_tickets_basic() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT
              t.ticket_no AS order_id,
              COALESCE(NULLIF(t.title, ''), t.ticket_no) AS subject,
              COALESCE(wn.node_key, '') AS node_key,
              COALESCE(wn.node_name, wn.node_key, '') AS node_name,
              COALESCE(t.creator_name, '') AS creator_name,
              TO_CHAR(t.created_at, 'YYYY-MM-DD') AS created_date,
              COALESCE(last_i.handler_name, t.creator_name, '') AS assignee
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT tni.handler_name
              FROM ticket_node_instance tni
              WHERE tni.ticket_id = t.id
              ORDER BY tni.id DESC
              LIMIT 1
            ) last_i ON TRUE
            ORDER BY t.created_at DESC, t.id DESC
            """
        ).fetchall()
    return {"items": rows}


@app.get("/api/nodes/{node_key}/schema")
def get_node_schema(node_key: str) -> dict[str, Any]:
    with db_conn() as conn:
        fields = _load_schema(conn, node_key)
    return {"node_key": node_key, "fields": fields}


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html_list_preview(text: str, max_len: int = 2000) -> str:
    t = _HTML_TAG_RE.sub(" ", text or "")
    t = " ".join(t.split()).strip()
    if len(t) > max_len:
        return t[:max_len] + "…"
    return t


def _severity_from_values(vals: dict[str, Any]) -> str:
    raw = str(vals.get("severity") or "").strip()
    if raw in ("一般", "严重", "致命"):
        return raw
    pr = str(vals.get("priority") or "").strip().lower()
    if pr == "urgent":
        return "致命"
    if pr == "high":
        return "严重"
    if pr in ("low", "medium"):
        return "一般"
    return ""


def _list_field_snapshot(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """From all ticket_node_data rows (any order), take latest non-empty per scalar + latest row with any description."""
    if not rows:
        return {}
    sorted_rows = sorted(rows, key=lambda r: r["created_at"], reverse=True)
    scalar_keys = (
        "start_date",
        "location",
        "biz_env",
        "process_flow_id",
        "flow_id",
        "hcs_flow_id",
        "is_quality_issue",
        "isQualityIssue",
        "severity",
        "priority",
    )
    out: dict[str, Any] = {}
    for row in sorted_rows:
        raw = row.get("values_json")
        v = raw if isinstance(raw, dict) else {}
        for key in scalar_keys:
            if key in out and out[key] is not None:
                continue
            val = v.get(key)
            if val is None:
                continue
            s = str(val).strip()
            if s:
                out[key] = s
    desc_raw = ""
    for row in sorted_rows:
        raw = row.get("values_json")
        v = raw if isinstance(raw, dict) else {}
        for dk in ("issue_desc", "problem_desc", "description"):
            s = str(v.get(dk) or "").strip()
            if s:
                desc_raw = s
                break
        if desc_raw:
            break
    out["_description_raw"] = desc_raw
    # 当前待办人：最后一次「提交」保存的 next_handler 指向下一节点，即 ticket.current_node_id 的处理人。
    # ticket_node_instance.node_id 是来源节点，待办时常无 node_id=current 的行，不能仅靠 cur_hand。
    newest = sorted_rows[0]
    nv = newest.get("values_json")
    nv = nv if isinstance(nv, dict) else {}
    nh = str(nv.get("next_handler") or "").strip()
    if nh:
        out["_last_submit_next_handler"] = nh
    return out


@app.get("/api/tickets")
def list_tickets(operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        rows = conn.execute(
            """
            SELECT
              t.id AS ticket_internal_id,
              t.ticket_no AS order_id,
              COALESCE(t.status, 'open') AS status,
              COALESCE(t.creator_name, '') AS creator_name,
              COALESCE(t.creator_id, '') AS creator_id,
              COALESCE(wn.node_key, '') AS node_key,
              CASE
                WHEN LOWER(TRIM(COALESCE(t.status, ''))) = 'closed' THEN '已关闭'
                ELSE COALESCE(NULLIF(TRIM(wn.node_name), ''), NULLIF(TRIM(wn.node_key), ''), '-')
              END AS current_stage,
              CASE
                WHEN LOWER(TRIM(COALESCE(t.status, ''))) = 'closed' THEN ''
                ELSE COALESCE(NULLIF(TRIM(cur_hand.handler_name), ''), '')
              END AS current_handler,
              t.created_at AS ticket_created_at,
              COALESCE(t.title, '') AS ticket_title
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT tni.handler_name
              FROM ticket_node_instance tni
              WHERE tni.ticket_id = t.id AND tni.node_id = t.current_node_id
              ORDER BY tni.id DESC
              LIMIT 1
            ) cur_hand ON TRUE
            WHERE (%s = FALSE OR t.creator_id = %s)
            ORDER BY t.created_at DESC, t.id DESC
            """,
            (only_self, operator_id),
        ).fetchall()
        ids = [int(r["ticket_internal_id"]) for r in rows]
        by_ticket: dict[int, list[dict[str, Any]]] = defaultdict(list)
        submitted_ids: set[int] = set()
        if ids:
            sub_rows = conn.execute(
                """
                SELECT DISTINCT ticket_id
                FROM ticket_node_data
                WHERE ticket_id = ANY(%s) AND created_by = %s
                """,
                (ids, operator_id),
            ).fetchall()
            submitted_ids = {int(r["ticket_id"]) for r in sub_rows}
            nd_rows = conn.execute(
                """
                SELECT ticket_id, values_json, created_at
                FROM ticket_node_data
                WHERE ticket_id = ANY(%s)
                ORDER BY ticket_id, created_at ASC
                """,
                (ids,),
            ).fetchall()
            for nr in nd_rows:
                tid = int(nr["ticket_id"])
                by_ticket[tid].append(
                    {"values_json": nr["values_json"], "created_at": nr["created_at"]}
                )
    items = []
    for row in rows:
        tid = int(row["ticket_internal_id"])
        snap = _list_field_snapshot(by_ticket.get(tid, []))
        created = row["ticket_created_at"]
        if hasattr(created, "strftime"):
            created_day = created.strftime("%Y-%m-%d")
        else:
            created_day = str(created)[:10]
        start_date = str(snap.get("start_date") or "").strip() or created_day
        location = str(snap.get("location") or "").strip()
        biz_env = str(snap.get("biz_env") or "").strip()
        is_quality_issue = str(snap.get("is_quality_issue") or "").strip()
        process_id = (
            str(snap.get("process_flow_id") or "").strip()
            or str(snap.get("flow_id") or "").strip()
            or str(snap.get("hcs_flow_id") or "").strip()
            or str(row["order_id"])
        )
        sev = _severity_from_values({k: snap.get(k) for k in ("severity", "priority")})
        if not sev:
            sev = "一般"
        desc_raw = str(snap.get("_description_raw") or "").strip()
        desc_plain = _strip_html_list_preview(desc_raw) if desc_raw else ""
        title_fallback = str(row.get("ticket_title") or "").strip()
        if not desc_plain and title_fallback:
            desc_plain = title_fallback
        if not desc_plain:
            desc_plain = "--"
        status_lower = str(row["status"] or "open").strip().lower()
        if status_lower == "closed":
            handler_display = ""
        else:
            # current_handler 可能是“当前节点最近一次提交人”，并不等于流转目标处理人；
            # 对首页/列表展示，优先显示上次提交计算出的 next_handler。
            handler_display = str(snap.get("_last_submit_next_handler") or "").strip()
            if not handler_display:
                handler_display = str(row["current_handler"] or "").strip()
            if not handler_display:
                handler_display = str(row.get("creator_name") or "").strip()
        created_raw = row["ticket_created_at"]
        if created_raw is not None and hasattr(created_raw, "isoformat"):
            created_at_str = created_raw.isoformat()
        else:
            created_at_str = str(created_raw or "")
        items.append(
            {
                "orderId": str(row["order_id"]),
                "status": str(row["status"] or "open"),
                "node_key": str(row["node_key"] or ""),
                "processId": process_id,
                "currentStage": str(row["current_stage"] or "-"),
                "startDate": start_date,
                "location": location,
                "bizEnv": biz_env,
                "isQualityIssue": is_quality_issue,
                "is_quality_issue": is_quality_issue,
                "currentHandler": handler_display,
                "severity": sev,
                "description": desc_plain,
                "node": str(row["current_stage"] or "-"),
                "assignee": handler_display,
                "creatorName": str(row["creator_name"] or ""),
                "creatorId": str(row["creator_id"] or ""),
                "createdAt": created_at_str,
                "operatorSubmitted": tid in submitted_ids,
            }
        )
    return {"items": items}


@app.get("/api/home/personal-stats")
def get_home_personal_stats(
    operator_id: str = "demo_001",
    start_date: str = "",
    end_date: str = "",
    quality_scope: str = "all",
) -> dict[str, Any]:
    op = str(operator_id or "").strip() or "demo_001"
    sd = _parse_ymd(start_date, "start_date")
    ed = _parse_ymd(end_date, "end_date")
    if sd > ed:
        sd, ed = ed, sd
    sc = str(quality_scope or "all").strip().lower()
    if sc not in ("all", "quality", "non_quality"):
        raise HTTPException(status_code=400, detail="quality_scope 须为 all、quality 或 non_quality")

    start_dt = _to_utc_start(sd)
    end_dt_exclusive = _to_utc_start(ed) + date.resolution
    end_ts = end_dt_exclusive.timestamp()
    span_secs = max(end_ts - start_dt.timestamp(), 1.0)

    points = 12
    labels: list[str] = []
    workload_values = [0 for _ in range(points)]
    for i in range(points):
        ts = start_dt.timestamp() + (i / max(points - 1, 1)) * (end_ts - start_dt.timestamp())
        labels.append(datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%m/%d"))

    sla_sum_by_stage = {k: 0.0 for k in HOME_PERSONAL_SLA_STAGE_KEYS}
    sla_count_by_stage = {k: 0 for k in HOME_PERSONAL_SLA_STAGE_KEYS}
    passthrough_independent = 0
    passthrough_commando = 0

    with db_conn() as conn:
        workload_rows = conn.execute(
            """
            SELECT tfl.created_at
            FROM ticket_flow_log tfl
            WHERE tfl.operator_id = %s
              AND tfl.action_type IN ('submit', 'jump_submit')
              AND tfl.created_at >= %s
              AND tfl.created_at < %s
            ORDER BY tfl.created_at ASC
            """,
            (op, start_dt, end_dt_exclusive),
        ).fetchall()
        for row in workload_rows:
            ts = row["created_at"]
            if not ts:
                continue
            ts_ms = ts.timestamp()
            idx = int(((ts_ms - start_dt.timestamp()) / span_secs) * points)
            if idx < 0:
                idx = 0
            elif idx >= points:
                idx = points - 1
            workload_values[idx] += 1

        sla_rows = conn.execute(
            """
            SELECT wn.node_key, tni.started_at, tni.ended_at
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.handler_id = %s
              AND wn.node_key = ANY(%s)
              AND tni.started_at >= %s
              AND tni.started_at < %s
            """,
            (op, list(HOME_PERSONAL_SLA_STAGE_KEYS), start_dt, end_dt_exclusive),
        ).fetchall()
        now_utc = datetime.now(timezone.utc)
        for row in sla_rows:
            stage_key = str(row["node_key"] or "").strip()
            if stage_key not in sla_sum_by_stage:
                continue
            st = row["started_at"]
            if not st:
                continue
            et = row["ended_at"] if row["ended_at"] else now_utc
            hours = max(0.0, (et - st).total_seconds() / 3600.0)
            sla_sum_by_stage[stage_key] += hours
            sla_count_by_stage[stage_key] += 1

        passthrough_rows = conn.execute(
            """
            SELECT
              t.id,
              t.status,
              COALESCE(cur.node_key, '') AS current_node_key,
              COALESCE(latest.values_json->>'is_quality_issue', '') AS is_quality_issue,
              EXISTS (
                SELECT 1
                FROM ticket_flow_log tf1
                JOIN workflow_node f1 ON f1.id = tf1.from_node_id
                JOIN workflow_node t1 ON t1.id = tf1.to_node_id
                WHERE tf1.ticket_id = t.id
                  AND tf1.action_type IN ('submit', 'jump_submit')
                  AND f1.node_key = 'ops_analysis'
                  AND t1.node_key IN ('dev_closure', 'ops_closure')
              ) AS has_independent_closure,
              EXISTS (
                SELECT 1
                FROM ticket_flow_log tf2
                JOIN workflow_node f2 ON f2.id = tf2.from_node_id
                JOIN workflow_node t2 ON t2.id = tf2.to_node_id
                WHERE tf2.ticket_id = t.id
                  AND tf2.action_type IN ('submit', 'jump_submit')
                  AND f2.node_key IN ('ops_analysis', 'ops_closure')
                  AND t2.node_key = 'dev_analysis'
              ) AS has_commando
            FROM ticket t
            LEFT JOIN workflow_node cur ON cur.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT tnd.values_json
              FROM ticket_node_data tnd
              WHERE tnd.ticket_id = t.id
              ORDER BY tnd.created_at DESC, tnd.id DESC
              LIMIT 1
            ) latest ON TRUE
            WHERE t.created_at >= %s
              AND t.created_at < %s
            """,
            (start_dt, end_dt_exclusive),
        ).fetchall()
        for row in passthrough_rows:
            curr_key = str(row["current_node_key"] or "").strip()
            is_closed = str(row["status"] or "").strip().lower() == "closed"
            if (not is_closed) and curr_key in HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS:
                continue
            if not _quality_scope_matches(sc, str(row["is_quality_issue"] or "")):
                continue
            has_independent = bool(row["has_independent_closure"])
            has_commando = bool(row["has_commando"])
            if has_commando:
                passthrough_commando += 1
            elif has_independent:
                passthrough_independent += 1

    stage_labels = [HOME_PERSONAL_STAGE_NAME_BY_KEY[k] for k in HOME_PERSONAL_SLA_STAGE_KEYS]
    stage_values = [
        int(round(sla_sum_by_stage[k] / sla_count_by_stage[k])) if sla_count_by_stage[k] > 0 else 0
        for k in HOME_PERSONAL_SLA_STAGE_KEYS
    ]
    return {
        "workload": {"labels": labels, "values": workload_values},
        "sla": {"stages": stage_labels, "values": stage_values},
        "passthrough": {
            "independent_closure_count": passthrough_independent,
            "commando_count": passthrough_commando,
        },
    }


@app.get("/api/tickets/{ticket_id}/nodes/{node_key}/data")
def get_node_data(ticket_id: str, node_key: str, operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
            raise HTTPException(status_code=403, detail="仅可查看问题填写节点")
        fields = _load_schema(conn, node_key)
        row = conn.execute(
            """
            SELECT tnd.values_json
            FROM ticket t
            JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
            JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE t.ticket_no = %s AND wn.node_key = %s
            ORDER BY tnd.created_at DESC
            LIMIT 1
            """,
            (ticket_id, node_key),
        ).fetchone()
        raw_vals = row["values_json"] if row else {}
        values = dict(raw_vals) if isinstance(raw_vals, dict) else {}
        values = _merge_inherited_previous_values(conn, ticket_id, node_key, fields, values)
        for pk in PERSON_VALUE_FIELD_KEYS:
            if pk in values and isinstance(values[pk], str):
                values[pk] = _canonical_person_display(values[pk])
    return {"ticket_id": ticket_id, "node_key": node_key, "values": values}


@app.get("/api/tickets/{ticket_id}/logs")
def get_ticket_logs(ticket_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        flow_rows = conn.execute(
            """
            SELECT
              tfl.created_at,
              tfl.operator_name,
              tfl.action_type,
              fn.node_name AS from_node_name,
              tn.node_name AS to_node_name,
              COALESCE(nd.next_handler, '') AS next_handler
            FROM ticket_flow_log tfl
            JOIN ticket t ON t.id = tfl.ticket_id
            LEFT JOIN workflow_node fn ON fn.id = tfl.from_node_id
            LEFT JOIN workflow_node tn ON tn.id = tfl.to_node_id
            LEFT JOIN LATERAL (
              SELECT tnd.values_json ->> 'next_handler' AS next_handler
              FROM ticket_node_data tnd
              JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
              WHERE tnd.ticket_id = tfl.ticket_id
                AND tni.node_id = tfl.from_node_id
                AND tnd.created_at <= tfl.created_at
              ORDER BY tnd.created_at DESC, tnd.id DESC
              LIMIT 1
            ) nd ON TRUE
            WHERE t.ticket_no = %s
            ORDER BY tfl.created_at ASC, tfl.id ASC
            """,
            (ticket_id,),
        ).fetchall()
        if flow_rows:
            items = [
                {
                    "at": row["created_at"].strftime("%Y-%m-%d %H:%M"),
                    "actor": str(row["operator_name"] or "-"),
                    "action": str(row["action_type"] or "submit"),
                    "from": str(row["from_node_name"] or "-"),
                    "to": str(row["to_node_name"] or "-"),
                    "next_handler": _canonical_person_display(str(row["next_handler"] or "").strip()) or "-",
                }
                for row in flow_rows
            ]
            return {"ticket_id": ticket_id, "items": items}

        fallback_rows = conn.execute(
            """
            SELECT
              tni.created_at,
              tni.handler_name,
              tni.action_status,
              wn.node_name
            FROM ticket_node_instance tni
            JOIN ticket t ON t.id = tni.ticket_id
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE t.ticket_no = %s
            ORDER BY tni.created_at ASC, tni.id ASC
            """,
            (ticket_id,),
        ).fetchall()
    if not fallback_rows:
        return {"ticket_id": ticket_id, "items": []}
    items = []
    prev_node = "-"
    for idx, row in enumerate(fallback_rows):
        curr = str(row["node_name"] or "-")
        next_handler = "-"
        if idx + 1 < len(fallback_rows):
            next_handler = _canonical_person_display(str(fallback_rows[idx + 1]["handler_name"] or "").strip()) or "-"
        items.append(
            {
                "at": row["created_at"].strftime("%Y-%m-%d %H:%M"),
                "actor": str(row["handler_name"] or "-"),
                "action": str(row["action_status"] or "completed"),
                "from": prev_node,
                "to": curr,
                "next_handler": next_handler,
            }
        )
        prev_node = curr
    return {"ticket_id": ticket_id, "items": items}


@app.get("/api/tickets/{ticket_id}/debug-status")
def get_ticket_debug_status(ticket_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT
              t.ticket_no AS ticket_id,
              COALESCE(t.status, 'open') AS status,
              COALESCE(wn.node_key, '') AS current_node_key,
              COALESCE(wn.node_name, '') AS current_node_name,
              COALESCE(last_submit.submit_node_key, '') AS last_submit_node_key,
              COALESCE(last_submit.handle_mode, '') AS last_handle_mode,
              COALESCE(last_submit.next_node_key, '') AS last_next_node_key,
              TO_CHAR(last_submit.created_at, 'YYYY-MM-DD HH24:MI:SS') AS last_submit_at
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT
                wn2.node_key AS submit_node_key,
                COALESCE(tnd.values_json->>'handle_mode', '') AS handle_mode,
                COALESCE(wf_to.node_key, '') AS next_node_key,
                tnd.created_at
              FROM ticket_node_data tnd
              JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
              JOIN workflow_node wn2 ON wn2.id = tni.node_id
              LEFT JOIN ticket_flow_log tfl
                ON tfl.ticket_id = t.id
               AND tfl.from_node_id = tni.node_id
               AND tfl.action_type = 'submit'
              LEFT JOIN workflow_node wf_to ON wf_to.id = tfl.to_node_id
              WHERE tnd.ticket_id = t.id
              ORDER BY tnd.created_at DESC
              LIMIT 1
            ) last_submit ON TRUE
            WHERE t.ticket_no = %s
            LIMIT 1
            """,
            (ticket_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="ticket not found")
    return dict(row)


@app.post("/api/tickets/{ticket_id}/nodes/{node_key}/submit")
def submit_node_data(ticket_id: str, node_key: str, payload: SubmitPayload) -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, payload.operator_id)
        if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
            raise HTTPException(status_code=403, detail="仅可处理问题填写节点")
        fields = _load_schema(conn, node_key)

        login_user = _canonical_person_display(f"{payload.operator_id} {payload.operator_name}")
        resolved: dict[str, Any] = dict(payload.values)
        for field in fields:
            key = field["key"]
            v = _apply_default(field, resolved, login_user)
            if key in payload.values and payload.values[key] not in (None, ""):
                v = payload.values[key]
            resolved[key] = v

        for pk in PERSON_VALUE_FIELD_KEYS:
            if pk in resolved and isinstance(resolved[pk], str):
                resolved[pk] = _canonical_person_display(resolved[pk])

        values: dict[str, Any] = {}
        errors: list[str] = []

        for field in fields:
            key = field["key"]
            value = resolved[key]
            if not _field_visible(field, resolved):
                continue
            req = _effective_required(field, resolved)
            field_for_val = {**field, "required": req}
            err = _validate_one(field_for_val, value)
            if err:
                errors.append(err)
            else:
                values[key] = value

        unknown_keys = set(payload.values.keys()) - {f["key"] for f in fields}
        if unknown_keys:
            errors.append(f"unknown fields: {sorted(unknown_keys)}")

        if errors:
            raise HTTPException(status_code=400, detail={"message": "Validation failed", "errors": errors})

        submitter_display = _canonical_person_display(f"{payload.operator_id} {payload.operator_name}")
        ticket = _get_or_create_ticket(conn, ticket_id, payload.operator_id, payload.operator_name, node_key)
        node = conn.execute(
            """
            SELECT wn.id
            FROM workflow_node wn
            JOIN workflow_template wt ON wt.id = wn.template_id
            WHERE wt.template_code = %s AND wn.node_key = %s
            """,
            (SCHEMA_TEMPLATE_CODE, node_key),
        ).fetchone()
        if not node:
            raise HTTPException(status_code=500, detail="workflow node missing")
        next_node = None
        handle_mode = str(values.get("handle_mode") or resolved.get("handle_mode") or "").strip()
        expected_next_node_key = _resolve_next_node_key(node_key, handle_mode)
        next_node_key = expected_next_node_key or str(payload.next_node_key or "").strip()
        if next_node_key:
            next_node = conn.execute(
                """
                SELECT wn.id
                FROM workflow_node wn
                JOIN workflow_template wt ON wt.id = wn.template_id
                WHERE wt.template_code = %s AND wn.node_key = %s
                LIMIT 1
                """,
                (SCHEMA_TEMPLATE_CODE, next_node_key),
            ).fetchone()
            if not next_node:
                raise HTTPException(status_code=400, detail=f"invalid next_node_key: {next_node_key}")
        if not expected_next_node_key and node_key != "problem_fill":
            raise HTTPException(status_code=400, detail="未匹配到流转目标，请检查处理方式")
        if not next_node:
            next_node = node

        auto_next_handler = ""
        if node_key == "problem_fill":
            auto_next_handler = _resolve_problem_fill_handler(conn, str(ticket["ticket_no"]), node_key, values)
            if not auto_next_handler:
                auto_next_handler = submitter_display
        elif node_key == "problem_review" and handle_mode == "提交其他运维审核":
            auto_next_handler = _resolve_problem_review_other_ops_handler(conn, str(ticket["ticket_no"]), node_key, values)
            if not auto_next_handler:
                auto_next_handler = submitter_display
        elif node_key == "problem_review" and handle_mode == "确认问题":
            auto_next_handler = _current_node_handler_display(conn, int(ticket["id"]), int(ticket["current_node_id"]))
            if not auto_next_handler:
                auto_next_handler = submitter_display

        if auto_next_handler:
            values["next_handler"] = _canonical_person_display(auto_next_handler)

        instance = conn.execute(
            """
            INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, action_status)
            VALUES (%s, %s, %s, %s, 'completed')
            RETURNING id
            """,
            (ticket["id"], node["id"], payload.operator_id, submitter_display),
        ).fetchone()

        schema_snapshot = {"node_key": node_key, "fields": fields}
        conn.execute(
            """
            INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, schema_snapshot, created_by)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s)
            """,
            (ticket["id"], instance["id"], psycopg.types.json.Jsonb(values), psycopg.types.json.Jsonb(schema_snapshot), payload.operator_id),
        )
        conn.execute(
            """
            INSERT INTO ticket_flow_log (
              ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment
            )
            VALUES (%s, %s, %s, 'submit', %s, %s, %s)
            """,
            (
                ticket["id"],
                node["id"],
                next_node["id"],
                payload.operator_id,
                submitter_display,
                "",
            ),
        )
        should_close = handle_mode in DIRECT_CLOSE_HANDLE_MODES
        prev_status = str(ticket.get("status") or "open").strip().lower()
        next_status = "closed" if (should_close or prev_status == "closed") else "open"
        conn.execute(
            """
            UPDATE ticket
            SET current_node_id = %s,
                status = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                next_node["id"],
                next_status,
                ticket["id"],
            ),
        )
        conn.commit()

    return {
        "ok": True,
        "ticket_id": str(ticket["ticket_no"]),
        "node_key": node_key,
        "saved": {
            "values": values,
            "updated_at": datetime.now().isoformat(),
            "operator_id": payload.operator_id,
            "operator_name": submitter_display,
        },
    }


_AI_SCHEMA_HINT = "请在数据库执行 db/migrations/0031_ai_assistant.sql"
_AI_READONLY_SQL_RE = re.compile(r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b", re.IGNORECASE)
_AI_SCHEMA_CACHE: list[dict[str, Any]] = []
_AI_SCHEMA_CACHE_AT: float = 0.0
_AI_SCHEMA_CACHE_TTL = 600.0

_DEFAULT_AI_SYSTEM_PROMPT = """你是一个数据库运维工单系统的智能助手。用户会用自然语言提问，你需要通过查询数据库来回答问题。

你可以使用工具 `db_query` 来执行只读 SQL 查询。

当前系统的业务说明：
- 这是一个运维工单系统，工单流程节点：问题填写→问题审核→运维分析→开发分析→开发闭环→运维闭环→审核关闭
- 工单号格式：YW + YYYYMMDD + 三位序号
- 严重性分为：致命、严重、一般
- 系统还包含值班管理、请假申请、需求管理等模块

查询数据库时请注意：
1. 只能执行 SELECT 查询，严禁修改数据
2. 优先查询最近的数据，注意时间范围
3. 查询结果如果为空，说明没有匹配的数据
4. 如果 SQL 执行出错，请修正后重试
5. 尽量给出精确的数字和具体信息，而不是模糊的描述
6. 如果需要展示趋势或分布，可以返回 chart_config 字段来生成 ECharts 图表配置

回答格式要求：
- 请使用 Markdown 格式回答，支持标题、列表、加粗、代码块、表格等语法
- 数字和关键信息使用 **加粗** 标注
- SQL 语句使用 ```sql 代码块
- 多条数据对比时使用 Markdown 表格
"""


def _ai_table_ready(conn: psycopg.Connection) -> bool:
    r = conn.execute("SELECT to_regclass('public.ai_conversation') AS name").fetchone()
    return bool(r and r.get("name"))


def _require_ai_enabled(conn: psycopg.Connection, operator_id: str) -> dict[str, Any]:
    if not _ai_table_ready(conn):
        raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
    config = _load_system_llm_config(conn)
    if str(config.get("llm_enabled", "false")).lower() != "true":
        raise HTTPException(status_code=400, detail="智能助手未启用，请联系管理员在参数配置→大模型配置中启用")
    return config


def _load_system_llm_config(conn: psycopg.Connection) -> dict[str, str]:
    try:
        rows = conn.execute("SELECT key, value FROM param_llm_config").fetchall()
    except UndefinedTable:
        return {}
    return {str(r["key"]): str(r["value"]) for r in rows}


def _resolve_llm_config(conn: psycopg.Connection, account: str) -> dict[str, Any]:
    system_config = _load_system_llm_config(conn)
    result: dict[str, Any] = {}
    type_map: dict[str, type] = {"int": int, "float": float, "bool": str, "string": str}
    for k, v in system_config.items():
        result[k] = v
    try:
        user_row = conn.execute(
            "SELECT * FROM ai_user_llm_config WHERE account = %s",
            (account,),
        ).fetchone()
    except UndefinedTable:
        user_row = None
    if user_row:
        field_map = {
            "api_base_url": "llm_api_base_url",
            "api_key": "llm_api_key",
            "model": "llm_model",
            "max_tokens": "llm_max_tokens",
            "temperature": "llm_temperature",
            "system_prompt": "llm_system_prompt",
            "query_timeout": "llm_query_timeout",
            "max_react_rounds": "llm_max_react_rounds",
            "max_result_rows": "llm_max_result_rows",
            "context_max_token": "llm_context_max_token",
        }
        for u_field, s_key in field_map.items():
            val = user_row.get(u_field)
            if val is not None:
                result[s_key] = str(val) if not isinstance(val, str) else val
    return result


def _mask_api_key(val: str) -> str:
    s = str(val or "").strip()
    if len(s) <= 8:
        return "****" if s else ""
    return s[:4] + "****" + s[-4:]


def _refresh_schema_cache(conn: psycopg.Connection) -> list[dict[str, Any]]:
    global _AI_SCHEMA_CACHE, _AI_SCHEMA_CACHE_AT
    allowed_prefixes = (
        "ticket", "ticket_node_", "workflow_", "option_", "user_account",
        "duty_", "param_", "requirement", "leave_", "handle_mode_",
        "ai_conversation", "ai_message", "ai_quick_template", "ai_user_llm_config",
        "holiday_config",
    )
    rows = conn.execute(
        """
        SELECT table_name, obj_description((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass) AS table_comment
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    ).fetchall()
    tables = []
    for r in rows:
        tname = str(r["table_name"] or "")
        if not any(tname.startswith(p) for p in allowed_prefixes):
            continue
        col_rows = conn.execute(
            """
            SELECT column_name, data_type, col_description((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass, ordinal_position) AS col_comment
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (tname,),
        ).fetchall()
        columns = []
        for cr in col_rows:
            columns.append({
                "name": str(cr["column_name"] or ""),
                "type": str(cr["data_type"] or ""),
                "comment": str(cr["col_comment"] or ""),
            })
        tables.append({
            "table": tname,
            "comment": str(r["table_comment"] or ""),
            "columns": columns,
        })
    _AI_SCHEMA_CACHE = tables
    _AI_SCHEMA_CACHE_AT = datetime.now().timestamp()
    return tables


def _get_schema_info(conn: psycopg.Connection) -> list[dict[str, Any]]:
    global _AI_SCHEMA_CACHE, _AI_SCHEMA_CACHE_AT
    now = datetime.now().timestamp()
    if _AI_SCHEMA_CACHE and (now - _AI_SCHEMA_CACHE_AT) < _AI_SCHEMA_CACHE_TTL:
        return _AI_SCHEMA_CACHE
    return _refresh_schema_cache(conn)


def _build_db_schema_text(schema_info: list[dict[str, Any]]) -> str:
    lines = []
    for t in schema_info:
        comment = f"  -- {t['comment']}" if t.get("comment") else ""
        lines.append(f"表 {t['table']}{comment}")
        for c in t.get("columns", []):
            cc = f"  -- {c['comment']}" if c.get("comment") else ""
            lines.append(f"  {c['name']} {c['type']}{cc}")
        lines.append("")
    return "\n".join(lines)


def _validate_readonly_sql(sql: str) -> str:
    s = str(sql or "").strip()
    if not s:
        raise ValueError("SQL 不能为空")
    if _AI_READONLY_SQL_RE.search(s):
        raise ValueError("仅允许 SELECT 查询，禁止修改操作")
    if not s.upper().startswith("SELECT"):
        raise ValueError("仅允许 SELECT 查询")
    return s


def _estimate_tokens(messages: list[dict[str, str]]) -> int:
    total = 0
    for m in messages:
        total += 4
        for k, v in m.items():
            total += len(v) // 3 + 1
    return total


async def _compress_messages_if_needed(
    messages: list[dict[str, str]],
    context_max_token: int,
    api_base_url: str,
    api_key: str,
    model: str,
    temperature: float,
) -> list[dict[str, str]]:
    threshold = int(context_max_token * 0.5)
    estimated = _estimate_tokens(messages)
    if estimated < threshold:
        return messages

    if len(messages) <= 2:
        return messages

    system_msg = messages[0] if messages[0].get("role") == "system" else None
    conversation = messages[1:] if system_msg else messages[:]

    if len(conversation) <= 2:
        return messages

    keep_recent = max(2, len(conversation) // 4)
    older = conversation[:-keep_recent]
    recent = conversation[-keep_recent:]

    older_text = "\n".join(f"[{m.get('role', 'user')}]: {m.get('content', '')}" for m in older)
    compress_prompt = (
        "请将以下多轮对话历史压缩为简洁的摘要，保留关键信息、数据、结论和上下文，"
        "去除冗余和重复内容。压缩后的摘要应能让后续对话无缝继续。\n\n"
        f"--- 对话历史 ---\n{older_text}\n--- 结束 ---\n\n"
        "请输出压缩后的摘要："
    )

    try:
        summary, _, _ = await _call_llm(
            api_base_url, api_key, model,
            [{"role": "system", "content": "你是一个对话摘要助手，负责将冗长的对话历史压缩为简洁摘要。"},
             {"role": "user", "content": compress_prompt}],
            1024, temperature,
        )
        summary = summary.strip()
    except Exception:
        summary = older_text[-2000:] if len(older_text) > 2000 else older_text

    compressed_msg = {
        "role": "system",
        "content": f"[对话历史摘要]\n{summary}",
    }

    result = []
    if system_msg:
        result.append(system_msg)
    result.append(compressed_msg)
    result.extend(recent)
    return result


def _execute_ai_query(conn: psycopg.Connection, sql: str, timeout_secs: int, max_rows: int) -> list[dict[str, Any]]:
    clean_sql = _validate_readonly_sql(sql)
    limit_sql = clean_sql
    if "LIMIT" not in clean_sql.upper():
        limit_sql = f"{clean_sql} LIMIT {max_rows}"
    conn.execute("SET TRANSACTION READ ONLY")
    conn.execute(f"SET statement_timeout = '{int(timeout_secs)}s'")
    rows = conn.execute(limit_sql).fetchall()
    return [dict(r) for r in rows]


def _build_react_messages(
    conversation_messages: list[dict[str, Any]],
    system_prompt: str,
    schema_text: str,
) -> list[dict[str, str]]:
    tool_desc = '{"sql": "你的SQL语句"}'
    full_system = (
        f"{system_prompt}\n\n"
        f"以下是当前数据库的表结构信息：\n\n{schema_text}\n\n"
        f"你可以使用以下工具：\n"
        f"- db_query: 执行只读SQL查询数据库，参数为 {tool_desc}\n\n"
        f"请按 ReAct 格式思考和行动。当你需要查询数据库时，使用如下格式：\n"
        f"Thought: 你的思考过程\n"
        f"Action: db_query\n"
        f"Action Input: {tool_desc}\n\n"
        f"当你已经获得足够信息可以回答用户时，使用如下格式：\n"
        f"Thought: 你的思考过程\n"
        f"Final Answer: 你的最终回答"
    )
    messages = [{"role": "system", "content": full_system}]
    for m in conversation_messages:
        role = str(m.get("role") or "")
        content = str(m.get("content") or "")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": content})
    return messages


def _parse_react_response(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {"thought": "", "action": None, "action_input": None, "final_answer": None}
    thought_match = re.search(r"Thought:\s*(.+?)(?=\n(?:Action|Final Answer)|$)", text, re.DOTALL)
    if thought_match:
        result["thought"] = thought_match.group(1).strip()
    action_match = re.search(r"Action:\s*(.+?)(?=\n|$)", text)
    if action_match:
        result["action"] = action_match.group(1).strip()
    ai_match = re.search(r"Action Input:\s*(.+?)(?=\n(?:Thought|Final Answer|Action)|$)", text, re.DOTALL)
    if ai_match:
        raw = ai_match.group(1).strip()
        try:
            result["action_input"] = json.loads(raw)
        except json.JSONDecodeError:
            result["action_input"] = {"sql": raw}
    fa_match = re.search(r"Final Answer:\s*(.+?)$", text, re.DOTALL)
    if fa_match:
        result["final_answer"] = fa_match.group(1).strip()
    if not result["action"] and not result["final_answer"] and not result["thought"]:
        result["final_answer"] = text.strip()
    return result


async def _call_llm_stream(api_base_url: str, api_key: str, model: str, messages: list[dict[str, str]], max_tokens: int, temperature: float):
    url = f"{str(api_base_url).rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise HTTPException(status_code=502, detail=f"LLM API 错误 ({resp.status_code}): {body.decode('utf-8', errors='replace')[:500]}")
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue


async def _call_llm(api_base_url: str, api_key: str, model: str, messages: list[dict[str, str]], max_tokens: int, temperature: float) -> tuple[str, int, int]:
    url = f"{str(api_base_url).rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"LLM API 错误 ({resp.status_code}): {resp.text[:500]}")
        data = resp.json()
        content = str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
        usage = data.get("usage", {})
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        return content, prompt_tokens, completion_tokens


@app.get("/api/ai/conversations")
def list_ai_conversations(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        rows = conn.execute(
            """
            SELECT id, title, total_tokens, created_at, updated_at
            FROM ai_conversation
            WHERE creator_id = %s AND is_deleted = FALSE
            ORDER BY updated_at DESC, id DESC
            """,
            (op,),
        ).fetchall()
    return {"items": rows}


@app.post("/api/ai/conversations")
def create_ai_conversation(payload: AiConversationCreatePayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    title = str(payload.title or "").strip() or "新对话"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        row = conn.execute(
            """
            INSERT INTO ai_conversation (title, creator_id, creator_name)
            VALUES (%s, %s, %s)
            RETURNING id, title, total_tokens, created_at, updated_at
            """,
            (title[:256], op, ""),
        ).fetchone()
        conn.commit()
    return {"item": row}


@app.patch("/api/ai/conversations/{conv_id:int}")
def patch_ai_conversation(conv_id: int, payload: AiConversationPatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    title = str(payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute(
            "SELECT id, creator_id FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可编辑")
        conn.execute(
            "UPDATE ai_conversation SET title = %s, updated_at = NOW() WHERE id = %s",
            (title[:256], conv_id),
        )
        conn.commit()
    return {"ok": True}


@app.delete("/api/ai/conversations/{conv_id:int}")
def delete_ai_conversation(conv_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute(
            "SELECT id, creator_id FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可删除")
        conn.execute(
            "UPDATE ai_conversation SET is_deleted = TRUE, updated_at = NOW() WHERE id = %s",
            (conv_id,),
        )
        conn.commit()
    return {"ok": True}


@app.get("/api/ai/conversations/{conv_id:int}/messages")
def list_ai_messages(conv_id: int, operator_id: str = "demo_001", page: int = 1, page_size: int = 50) -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        conv = conn.execute(
            "SELECT id, creator_id FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not conv:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(conv["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="无权访问")
        total = conn.execute(
            "SELECT COUNT(*) AS cnt FROM ai_message WHERE conversation_id = %s",
            (conv_id,),
        ).fetchone()["cnt"]
        offset = max(0, (page - 1) * page_size)
        rows = conn.execute(
            """
            SELECT id, role, content, react_steps, sql_query, query_result, chart_config,
                   prompt_tokens, completion_tokens, created_at
            FROM ai_message
            WHERE conversation_id = %s
            ORDER BY created_at ASC, id ASC
            LIMIT %s OFFSET %s
            """,
            (conv_id, page_size, offset),
        ).fetchall()
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@app.post("/api/ai/conversations/{conv_id:int}/chat")
async def chat_ai_conversation(conv_id: int, payload: AiChatPayload):
    import asyncio

    op = payload.operator_id.strip() or "demo_001"
    content = str(payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息不能为空")

    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        config = _require_ai_enabled(conn, op)
        conv = conn.execute(
            "SELECT id, creator_id, title FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not conv:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(conv["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="无权访问")
        resolved = _resolve_llm_config(conn, op)
        schema_info = _get_schema_info(conn)
        conn.execute(
            "INSERT INTO ai_message (conversation_id, role, content) VALUES (%s, %s, %s)",
            (conv_id, "user", content),
        )
        if str(conv["title"] or "").strip() in ("", "新对话"):
            conn.execute(
                "UPDATE ai_conversation SET title = %s, updated_at = NOW() WHERE id = %s",
                (content[:256], conv_id),
            )
        conn.commit()
        prev_messages = conn.execute(
            """
            SELECT role, content FROM ai_message
            WHERE conversation_id = %s
            ORDER BY created_at ASC, id ASC
            """,
            (conv_id,),
        ).fetchall()

    api_base_url = str(resolved.get("llm_api_base_url", ""))
    api_key = str(resolved.get("llm_api_key", ""))
    model = str(resolved.get("llm_model", "gpt-4o"))
    try:
        max_tokens = int(resolved.get("llm_max_tokens", 4096))
    except (ValueError, TypeError):
        max_tokens = 4096
    try:
        temperature = float(resolved.get("llm_temperature", 0.0))
    except (ValueError, TypeError):
        temperature = 0.0
    system_prompt = str(resolved.get("llm_system_prompt", "")).strip()
    if not system_prompt:
        system_prompt = _DEFAULT_AI_SYSTEM_PROMPT
    try:
        query_timeout = int(resolved.get("llm_query_timeout", 30))
    except (ValueError, TypeError):
        query_timeout = 30
    try:
        max_react_rounds = int(resolved.get("llm_max_react_rounds", 5))
    except (ValueError, TypeError):
        max_react_rounds = 5
    try:
        max_result_rows = int(resolved.get("llm_max_result_rows", 200))
    except (ValueError, TypeError):
        max_result_rows = 200
    try:
        context_max_token = int(resolved.get("llm_context_max_token", 128000))
    except (ValueError, TypeError):
        context_max_token = 128000

    if not api_key:
        raise HTTPException(status_code=400, detail="未配置大模型 API Key，请在参数配置→大模型配置中配置，或在智能助手中配置个人模型")

    schema_text = _build_db_schema_text(schema_info)
    messages = _build_react_messages(list(prev_messages), system_prompt, schema_text)

    messages = await _compress_messages_if_needed(messages, context_max_token, api_base_url, api_key, model, temperature)

    react_steps: list[dict[str, Any]] = []
    last_sql: str | None = None
    last_query_result: list[dict[str, Any]] | None = None
    final_answer = ""
    total_prompt_tokens = 0
    total_completion_tokens = 0

    for round_i in range(max_react_rounds):
        try:
            llm_text, round_prompt_tokens, round_completion_tokens = await _call_llm(api_base_url, api_key, model, messages, max_tokens, temperature)
            total_prompt_tokens += round_prompt_tokens
            total_completion_tokens += round_completion_tokens
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"大模型调用失败：{str(exc)[:300]}")

        parsed = _parse_react_response(llm_text)

        if parsed.get("thought"):
            react_steps.append({"thought": parsed["thought"]})

        if parsed.get("final_answer"):
            final_answer = parsed["final_answer"]
            break

        if parsed.get("action") and parsed.get("action_input"):
            action = str(parsed["action"]).strip()
            action_input = parsed["action_input"]
            sql = ""
            if action == "db_query" and isinstance(action_input, dict):
                sql = str(action_input.get("sql", "")).strip()

            if not sql:
                messages.append({"role": "assistant", "content": llm_text})
                messages.append({"role": "user", "content": "Action Input 中缺少有效的 SQL 查询，请重新生成。"})
                continue

            step: dict[str, Any] = {"thought": parsed.get("thought", ""), "action": action, "sql": sql}
            try:
                with db_conn() as qconn:
                    result = _execute_ai_query(qconn, sql, query_timeout, max_result_rows)
                step["observation"] = result
                last_sql = sql
                last_query_result = result
            except Exception as exc:
                err_msg = str(exc)[:500]
                step["observation"] = f"SQL 执行错误：{err_msg}"
            react_steps.append(step)

            obs_text = json.dumps(step.get("observation"), ensure_ascii=False, default=str) if not isinstance(step.get("observation"), str) else step["observation"]
            messages.append({"role": "assistant", "content": llm_text})
            messages.append({"role": "user", "content": f"Observation: {obs_text}"})
        else:
            final_answer = llm_text
            break
    else:
        if not final_answer:
            final_answer = "抱歉，经过多轮推理仍未能得出完整答案，请尝试更具体地描述您的问题。"

    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO ai_message (conversation_id, role, content, react_steps, sql_query, query_result, prompt_tokens, completion_tokens)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (conv_id, "assistant", final_answer, json.dumps(react_steps, ensure_ascii=False, default=str) if react_steps else None, last_sql, json.dumps(last_query_result, ensure_ascii=False, default=str) if last_query_result else None, total_prompt_tokens, total_completion_tokens),
        )
        conn.execute(
            "UPDATE ai_conversation SET total_tokens = total_tokens + %s, updated_at = NOW() WHERE id = %s",
            (total_prompt_tokens + total_completion_tokens, conv_id),
        )
        conn.commit()

    return {"role": "assistant", "content": final_answer, "react_steps": react_steps, "sql_query": last_sql, "query_result": last_query_result, "prompt_tokens": total_prompt_tokens, "completion_tokens": total_completion_tokens, "total_tokens": total_prompt_tokens + total_completion_tokens}


@app.get("/api/ai/quick-templates")
def list_ai_quick_templates(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        rows = conn.execute(
            """
            SELECT id, question, is_preset, creator_id, sort_order, created_at
            FROM ai_quick_template
            WHERE is_preset = TRUE OR creator_id = %s
            ORDER BY is_preset DESC, sort_order, id
            """,
            (op,),
        ).fetchall()
    return {"items": rows}


@app.post("/api/ai/quick-templates")
def create_ai_quick_template(payload: AiQuickTemplateCreatePayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    question = str(payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        sort_row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ai_quick_template WHERE creator_id = %s AND is_preset = FALSE",
            (op,),
        ).fetchone()
        sort_order = int(sort_row["n"]) if sort_row else 0
        row = conn.execute(
            """
            INSERT INTO ai_quick_template (question, is_preset, creator_id, sort_order)
            VALUES (%s, FALSE, %s, %s)
            RETURNING id, question, is_preset, creator_id, sort_order, created_at
            """,
            (question, op, sort_order),
        ).fetchone()
        conn.commit()
    return {"item": row}


@app.patch("/api/ai/quick-templates/{tpl_id:int}")
def patch_ai_quick_template(tpl_id: int, payload: AiQuickTemplatePatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    question = str(payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute("SELECT * FROM ai_quick_template WHERE id = %s", (tpl_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="模板不存在")
        if bool(existing["is_preset"]):
            raise HTTPException(status_code=400, detail="预设模板不可编辑")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可编辑")
        conn.execute(
            "UPDATE ai_quick_template SET question = %s WHERE id = %s",
            (question, tpl_id),
        )
        conn.commit()
    return {"ok": True}


@app.delete("/api/ai/quick-templates/{tpl_id:int}")
def delete_ai_quick_template(tpl_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute("SELECT * FROM ai_quick_template WHERE id = %s", (tpl_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="模板不存在")
        if bool(existing["is_preset"]):
            raise HTTPException(status_code=400, detail="预设模板不可删除")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可删除")
        conn.execute("DELETE FROM ai_quick_template WHERE id = %s", (tpl_id,))
        conn.commit()
    return {"ok": True}


@app.get("/api/ai/my-llm-config")
def get_my_llm_config(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        try:
            system_config = _load_system_llm_config(conn)
        except UndefinedTable:
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        try:
            user_row = conn.execute("SELECT * FROM ai_user_llm_config WHERE account = %s", (op,)).fetchone()
        except UndefinedTable:
            user_row = None
    user_override: dict[str, Any] = {}
    has_user_config = user_row is not None
    if user_row:
        for f in ("api_base_url", "api_key", "model", "max_tokens", "temperature", "system_prompt", "query_timeout", "max_react_rounds", "max_result_rows", "context_max_token"):
            v = user_row.get(f)
            if v is not None:
                user_override[f] = v
    if "api_key" in user_override:
        user_override["api_key"] = _mask_api_key(str(user_override["api_key"]))
    system_default = {}
    key_map = {
        "llm_api_base_url": "api_base_url",
        "llm_api_key": "api_key",
        "llm_model": "model",
        "llm_max_tokens": "max_tokens",
        "llm_temperature": "temperature",
        "llm_system_prompt": "system_prompt",
        "llm_query_timeout": "query_timeout",
        "llm_max_react_rounds": "max_react_rounds",
        "llm_max_result_rows": "max_result_rows",
        "llm_context_max_token": "context_max_token",
    }
    for sk, uk in key_map.items():
        sv = system_config.get(sk, "")
        if uk == "api_key":
            sv = _mask_api_key(sv)
        system_default[uk] = sv
    effective = {}
    for uk in key_map.values():
        if uk in user_override and user_override[uk] not in (None, "", "****"):
            effective[uk] = user_override[uk]
        else:
            effective[uk] = system_default.get(uk, "")
    return {"effective": effective, "user_override": user_override, "system_default": system_default, "has_user_config": has_user_config}


@app.put("/api/ai/my-llm-config")
def put_my_llm_config(payload: AiUserLlmConfigPutPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    fields: dict[str, Any] = {}
    if payload.api_base_url is not None:
        fields["api_base_url"] = str(payload.api_base_url).strip() or None
    if payload.api_key is not None:
        ak = str(payload.api_key).strip()
        if "****" in ak:
            pass
        else:
            fields["api_key"] = ak or None
    if payload.model is not None:
        fields["model"] = str(payload.model).strip() or None
    if payload.max_tokens is not None:
        fields["max_tokens"] = payload.max_tokens
    if payload.temperature is not None:
        fields["temperature"] = payload.temperature
    if payload.system_prompt is not None:
        fields["system_prompt"] = str(payload.system_prompt).strip() or None
    if payload.query_timeout is not None:
        fields["query_timeout"] = payload.query_timeout
    if payload.max_react_rounds is not None:
        fields["max_react_rounds"] = payload.max_react_rounds
    if payload.max_result_rows is not None:
        fields["max_result_rows"] = payload.max_result_rows
    if payload.context_max_token is not None:
        fields["context_max_token"] = payload.context_max_token

    all_null = all(v is None for v in fields.values())
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        if all_null:
            conn.execute("DELETE FROM ai_user_llm_config WHERE account = %s", (op,))
            conn.commit()
            return {"ok": True, "cleared": True}
        existing = conn.execute("SELECT account FROM ai_user_llm_config WHERE account = %s", (op,)).fetchone()
        if existing:
            set_parts = []
            values = []
            for k, v in fields.items():
                set_parts.append(f"{k} = %s")
                values.append(v)
            set_parts.append("updated_at = NOW()")
            values.append(op)
            conn.execute(
                f"UPDATE ai_user_llm_config SET {', '.join(set_parts)} WHERE account = %s",
                values,
            )
        else:
            cols = ["account"]
            vals = [op]
            for k, v in fields.items():
                cols.append(k)
                vals.append(v)
            col_names = ", ".join(cols)
            placeholders_list = ", ".join(["%s"] * len(cols))
            conn.execute(
                f"INSERT INTO ai_user_llm_config ({col_names}, updated_at) VALUES ({placeholders_list}, NOW())",
                vals,
            )
        conn.commit()
    return {"ok": True}


@app.post("/api/ai/my-llm-config/test")
async def test_my_llm_config(payload: LlmTestPayload) -> dict[str, Any]:
    return await test_llm_config(payload)


@app.post("/api/ai/refresh-schema")
def refresh_schema(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        tables = _refresh_schema_cache(conn)
    return {"ok": True, "table_count": len(tables)}


def _register_frontend_spa() -> None:
    """Serve static frontend + SPA fallback so /tickets/... and /admin/... refresh works.

    Enabled by default when frontend/index.html exists. API-only deployments: SERVE_FRONTEND=0.
    """
    if os.getenv("SERVE_FRONTEND", "").strip() == "0":
        return
    root = Path(__file__).resolve().parent.parent / "frontend"
    index = root / "index.html"
    if not index.is_file():
        return

    @app.get("/")
    def spa_index() -> FileResponse:
        return FileResponse(index)

    @app.get("/{spa_path:path}")
    def spa_fallback(spa_path: str) -> FileResponse:
        base = root.resolve()
        candidate = (root / spa_path).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            raise HTTPException(status_code=404, detail="not found")
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


_register_frontend_spa()
