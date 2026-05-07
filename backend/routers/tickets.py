from __future__ import annotations
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any
import psycopg
from psycopg.errors import UniqueViolation, UndefinedTable
from fastapi import APIRouter, HTTPException, Query
from config import (
    SCHEMA_TEMPLATE_CODE,
    SCHEMA_NODE_KEY,
    DIRECT_CLOSE_HANDLE_MODES,
    HANDLE_MODE_ROUTE,
    PERSON_VALUE_FIELD_KEYS,
    _DUTY_FIELD_OPTION_SET_CODES,
    _VERSION_BASELINE_OPTION_SET_CODES,
    _DUTY_FIELD_PATH_SEP,
    _COMPONENT_TO_KIND,
    _DUTY_STATUS_ON,
    _HOLIDAY_SCHEMA_HINT,
)
from database import db_conn
from models import SubmitPayload
from utils import (
    _YW_TICKET_NO_RE,
    _YW_ADVISORY_LOCK_KEY1,
    _YW_ADVISORY_LOCK_KEY2,
    _CHINA_TZ,
    allocate_yw_ticket_no as _allocate_yw_ticket_no,
    dedupe_preserve_str as _dedupe_preserve_str,
    canonical_person_display as _canonical_person_display,
    field_visible as _field_visible,
    matches_required_if as _base_matches_required_if,
    optional_when_all_matches as _base_optional_when_all_matches,
    optional_when_any_matches as _base_optional_when_any_matches,
    effective_required as _base_effective_required,
    validate_one as _base_validate_one,
    parse_ymd as _parse_ymd,
    to_utc_start as _to_utc_start,
)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_LIST_CREATED_YMD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _optional_list_created_ymd(raw: str) -> date | None:
    """列表接口创建日筛选：仅接受 YYYY-MM-DD；非法或空返回 None（忽略该条件）。"""
    t = str(raw or "").strip()
    if not t or not _LIST_CREATED_YMD_RE.match(t):
        return None
    try:
        return datetime.strptime(t, "%Y-%m-%d").date()
    except ValueError:
        return None


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
    newest = sorted_rows[0]
    nv = newest.get("values_json")
    nv = nv if isinstance(nv, dict) else {}
    nh = str(nv.get("next_handler") or "").strip()
    if nh:
        out["_last_submit_next_handler"] = nh
    return out


def _quality_scope_matches(scope: str, raw_value: str) -> bool:
    if scope == "all":
        return True
    val = str(raw_value or "").strip().lower()
    is_quality = val in ("true", "yes", "1", "是", "质量")
    if scope == "quality":
        return is_quality
    return not is_quality


def _get_whitelist_flags(conn: psycopg.Connection, operator_id: str) -> dict[str, bool]:
    try:
        rows = conn.execute(
            """
            SELECT flag_key, flag_value
            FROM permission_whitelist_flag
            WHERE account = %s
            """,
            (operator_id,),
        ).fetchall()
    except UndefinedTable:
        conn.rollback()
        return {}
    return {str(r["flag_key"]): bool(r["flag_value"]) for r in rows}


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
    s = str(raw or "").strip()
    if not s:
        return ""
    parts = [p.strip() for p in re.split(r"\s*/\s*", s) if p.strip()]
    return _DUTY_FIELD_PATH_SEP.join(parts)


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


def _normalize_component(v: Any) -> str:
    comp = str(v or "").strip()
    if comp not in _COMPONENT_TO_KIND:
        raise HTTPException(status_code=400, detail="问题组件仅允许内核问题/管控问题")
    return comp


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
        raw = str(row.get("day_type") or "").strip()
        if raw in ("workday", "工作日"):
            return "workday"
        if raw in ("weekend_holiday", "周末节假日"):
            return "weekend_holiday"
    return "weekend_holiday" if d.weekday() >= 5 else "workday"


def _routing_window(conn: psycopg.Connection, now_cn: datetime) -> tuple[str, date, str]:
    from datetime import time, timedelta
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
    from utils import parse_last_accept_at as _parse_last_accept_at
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
    from utils import parse_last_accept_at as _parse_last_accept_at
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
    from config import _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE, _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED
    from utils import parse_last_accept_at as _parse_last_accept_at
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


def _normalize_issue_type_judge_key(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    if not s:
        return ""
    s = s.replace("（", "(").replace("）", ")")
    s = re.sub(r"\s+", "", s)
    s = s.replace("(", "").replace(")", "")
    return s


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


@router.get("/basic")
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


@router.get("")
def list_tickets(
    operator_id: str = "demo_001",
    q: str = "",
    created_from: str = Query("", description="创建日起始 YYYY-MM-DD（含），按 Asia/Shanghai 日历日"),
    created_to: str = Query("", description="创建日结束 YYYY-MM-DD（含），按 Asia/Shanghai 日历日"),
) -> dict[str, Any]:
    """获取工单列表，支持搜索关键词 q（匹配全部文本字段）；可选按建单时间 created_at 筛选。"""
    kw = (q or "").strip().lower()
    cf = _optional_list_created_ymd(created_from)
    ct = _optional_list_created_ymd(created_to)

    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        where_sql = "(%s = FALSE OR t.creator_id = %s)"
        sql_params = [only_self, operator_id]
        # 与业务常用口径一致：created_at 转 Asia/Shanghai 的日历日再与区间比较
        if cf is not None:
            where_sql += " AND (DATE(timezone('Asia/Shanghai', t.created_at)) >= %s)"
            sql_params.append(cf)
        if ct is not None:
            where_sql += " AND (DATE(timezone('Asia/Shanghai', t.created_at)) <= %s)"
            sql_params.append(ct)
        rows = conn.execute(
            f"""
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
            WHERE {where_sql}
            ORDER BY t.created_at DESC, t.id DESC
            """,
            tuple(sql_params),
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
                # 保存 snap 用于搜索匹配全部节点字段
                "_snap": snap,
            }
        )
    # 搜索过滤：匹配全部文本字段（87个字段）
    if kw:
        # 从各节点的 values_json 中提取的全部可搜索字段 keys
        ALL_SEARCH_KEYS = [
            # 系统字段 / 列表基础字段
            "orderId", "processId", "currentStage", "currentHandler", "startDate",
            "severity", "location", "bizEnv", "creatorName", "description", "status",
            # problem_fill 字段
            "start_date", "location", "biz_env", "severity", "component",
            "hcs_version", "hcs_mode", "ecare_ticket_no", "hcs_owner", "issue_desc",
            # problem_review 字段
            "handle_mode", "issue_type_judge", "next_handler", "close_reason",
            # ops_analysis 字段
            "issue_intro_module", "issue_owner_module", "issue_type", "product_line",
            "root_cause_category", "event_level", "customer_voice", "gauss_version",
            "deploy_mode", "kernel_upgrade_involved", "kernel_upgrade_time",
            "upgrade_baseline_version", "control_version", "upgrade_status",
            "error_text", "issue_track", "has_coredump_file", "has_core_stack",
            "core_stack_text", "use_doer_assist", "doer_no_help_reason",
            # dev_analysis 字段
            "front_pass_through", "version_pass_through", "is_quality_issue",
            "dts_no", "version_pass_reason", "is_consult_issue", "rock_version_involved",
            "collaborator", "workaround", "root_cause", "dfx_gap", "error_archive_text",
            # dev_closure 字段
            "warning_needed", "impact_level", "sla_analysis",
            # ops_closure 字段
            "fault_recovery_involved", "fault_to_recovery_duration",
            # audit_close 字段
            # 以上字段在 snap 中已包含
        ]
        items = [
            item for item in items
            if any(
                kw in str(item.get(key) or "").lower()
                or kw in str(item.get("_snap", {}).get(key) or "").lower()
                for key in ALL_SEARCH_KEYS
            )
        ]
    # 移除临时的 _snap 字段
    for item in items:
        item.pop("_snap", None)
    return {"items": items}


@router.get("/{ticket_id}/nodes/{node_key}/data")
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


@router.get("/{ticket_id}/logs")
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


@router.get("/{ticket_id}/debug-status")
def get_ticket_debug_status(ticket_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT t.id, t.ticket_no, t.status, t.current_node_id,
                   wn.node_key, wn.node_name
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            WHERE t.ticket_no = %s
            """,
            (ticket_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ticket not found")
        instances = conn.execute(
            """
            SELECT tni.id, tni.node_id, wn.node_key, wn.node_name,
                   tni.handler_id, tni.handler_name, tni.action_status,
                   tni.started_at, tni.ended_at
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.ticket_id = %s
            ORDER BY tni.id ASC
            """,
            (row["id"],),
        ).fetchall()
    return {
        "ticket_id": ticket_id,
        "ticket_internal_id": row["id"],
        "status": row["status"],
        "current_node_key": row["node_key"],
        "current_node_name": row["node_name"],
        "instances": [
            {
                "id": inst["id"],
                "node_key": inst["node_key"],
                "node_name": inst["node_name"],
                "handler_id": inst["handler_id"],
                "handler_name": inst["handler_name"],
                "action_status": inst["action_status"],
                "started_at": str(inst["started_at"] or ""),
                "ended_at": str(inst["ended_at"] or ""),
            }
            for inst in instances
        ],
    }


@router.post("/{ticket_id}/nodes/{node_key}/submit")
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


@router.post("/export-data")
def get_tickets_export_data(payload: dict[str, Any]) -> dict[str, Any]:
    """
    批量获取工单导出数据。
    传入工单编号列表，返回每个工单所有节点的数据。
    payload: { "ticket_nos": ["YW20260402001", ...], "operator_id": "xxx" }
    返回: { "items": [{ "ticket_no": "...", "nodes": { node_key: { field_key: value } } }] }
    """
    ticket_nos = payload.get("ticket_nos") or []
    operator_id = str(payload.get("operator_id") or "demo_001")
    if not ticket_nos or not isinstance(ticket_nos, list):
        return {"items": []}

    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        # 查询工单基础信息
        rows = conn.execute(
            """
            SELECT t.id AS ticket_internal_id, t.ticket_no, t.creator_id, t.creator_name,
                   COALESCE(t.status, 'open') AS status
            FROM ticket t
            WHERE t.ticket_no = ANY(%s)
            ORDER BY t.created_at DESC
            """,
            (ticket_nos,),
        ).fetchall()
        # 权限过滤：仅自己创建
        if only_self:
            rows = [r for r in rows if str(r["creator_id"] or "") == operator_id]
        if not rows:
            return {"items": []}

        ticket_ids = [int(r["ticket_internal_id"]) for r in rows]
        ticket_no_by_id = {int(r["ticket_internal_id"]): str(r["ticket_no"]) for r in rows}

        # 查询所有节点的数据
        node_data_rows = conn.execute(
            """
            SELECT tnd.ticket_id, wn.node_key, tnd.values_json, tnd.created_at
            FROM ticket_node_data tnd
            JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
            JOIN workflow_node wn ON wn.id = tni.node_id
            JOIN workflow_template wt ON wt.id = wn.template_id
            WHERE tnd.ticket_id = ANY(%s) AND wt.template_code = %s
            ORDER BY tnd.ticket_id, wn.node_key, tnd.created_at DESC
            """,
            (ticket_ids, SCHEMA_TEMPLATE_CODE),
        ).fetchall()

        # 按工单+节点聚合，取最新一条数据
        by_ticket_node: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
        for ndr in node_data_rows:
            tid = int(ndr["ticket_id"])
            nk = str(ndr["node_key"])
            if nk not in by_ticket_node[tid]:
                # 取最新一条
                raw_vals = ndr["values_json"]
                vals = dict(raw_vals) if isinstance(raw_vals, dict) else {}
                # 规范化人员字段
                for pk in PERSON_VALUE_FIELD_KEYS:
                    if pk in vals and isinstance(vals[pk], str):
                        vals[pk] = _canonical_person_display(vals[pk])
                by_ticket_node[tid][nk] = vals

        # 组装返回数据
        items = []
        for tid in ticket_ids:
            ticket_no = ticket_no_by_id.get(tid, "")
            nodes_data = by_ticket_node.get(tid, {})
            items.append({
                "ticket_no": ticket_no,
                "nodes": nodes_data,
            })

    return {"items": items}