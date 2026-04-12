from __future__ import annotations

import os
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

import psycopg
from psycopg.errors import UniqueViolation, UndefinedTable
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from psycopg.rows import dict_row


DB_DSN = os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")
SCHEMA_NODE_KEY = "problem_fill"
SCHEMA_TEMPLATE_CODE = "HCS_INCIDENT"
DIRECT_CLOSE_HANDLE_MODES = {"问题解决关闭", "非问题关闭"}
HANDLE_MODE_ROUTE: dict[str, dict[str, str]] = {
    "problem_review": {
        "确认问题": "ops_analysis",
        "提交其他运维审核": "problem_review",
        "非问题关闭": "problem_review",
    },
    "ops_analysis": {
        "提交开发分析": "dev_analysis",
        "提交开发闭环": "dev_closure",
        "提交运维闭环": "ops_closure",
        "提交其他运维分析": "ops_analysis",
    },
    "dev_analysis": {
        "提交开发闭环": "dev_closure",
        "提交其他开发分析": "dev_analysis",
        "返回运维分析": "ops_analysis",
    },
    "dev_closure": {
        "提交运维闭环": "ops_closure",
        "提交其他开发闭环": "dev_closure",
        "返回开发分析": "dev_analysis",
        "返回运维分析": "ops_analysis",
    },
    "ops_closure": {
        "提交运维审核关闭": "audit_close",
        "提交其他运维闭环": "ops_closure",
        "返回开发闭环": "dev_closure",
        "返回运维分析": "ops_analysis",
    },
    "audit_close": {
        "问题解决关闭": "audit_close",
        "提交其他审核关闭": "audit_close",
        "返回运维闭环": "ops_closure",
        "暂时挂起": "audit_close",
    },
}

app = FastAPI(title="运维工单后端", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SubmitPayload(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    next_node_key: Optional[str] = None


class PermissionPolicyItem(BaseModel):
    role_code: str
    is_pl: bool = False
    node_key: str
    field_key: str
    permission_level: str


class PermissionPolicyBulkPayload(BaseModel):
    items: list[PermissionPolicyItem] = Field(default_factory=list)
    operator_id: str = "admin"


class UserAccountItem(BaseModel):
    account: str
    user_name: str
    role_code: str
    group_name: str
    is_pl: bool = False
    is_active: bool = True


class UserAccountBulkPayload(BaseModel):
    items: list[UserAccountItem] = Field(default_factory=list)
    operator_id: str = "admin"


class DutyCalendarPutPayload(BaseModel):
    """替换某类值班表在指定自然月内的全部排班（内核 / 管控月历）。"""

    operator_id: str = "admin"
    kind: str = Field(..., description="kernel 或 control")
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    days: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class DutyRotationPutPayload(BaseModel):
    """替换全部轮值表条目（内核/管控/各专项），按 kind 分桶。"""

    operator_id: str = "admin"
    lists: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class DutySiteOnCallPutPayload(BaseModel):
    operator_id: str = "admin"
    rows: list[dict[str, Any]] = Field(default_factory=list)


class DutyRlOnCallPutPayload(BaseModel):
    operator_id: str = "admin"
    rows: list[dict[str, Any]] = Field(default_factory=list)


class LeaveTimeSegmentIn(BaseModel):
    start_at: str
    end_at: str
    reason: str = ""


class LeaveApplicationCreatePayload(BaseModel):
    operator_id: str
    application_type: str
    segments: list[LeaveTimeSegmentIn] = Field(default_factory=list)
    approver_account: str
    cc_accounts: list[str] = Field(default_factory=list)


class LeaveActionPayload(BaseModel):
    operator_id: str
    action: str
    comment: str = ""


class LeaveApproverWhitelistPutPayload(BaseModel):
    operator_id: str = "admin"
    accounts: list[str] = Field(default_factory=list)


class DutyFieldNodeInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    label: str = ""
    children: list["DutyFieldNodeInput"] = Field(default_factory=list)


DutyFieldNodeInput.model_rebuild()


class DutyFieldTreePutPayload(BaseModel):
    operator_id: str = "admin"
    nodes: list[DutyFieldNodeInput] = Field(default_factory=list)


class BaselineVersionCreatePayload(BaseModel):
    operator_id: str = "admin"
    version_label: str
    commit_hash: str = ""
    sort_order: Optional[int] = None


class BaselineVersionPatchPayload(BaseModel):
    operator_id: str = "admin"
    version_label: Optional[str] = None
    commit_hash: Optional[str] = None
    sort_order: Optional[int] = None


class HotfixVersionCreatePayload(BaseModel):
    operator_id: str = "admin"
    baseline_id: int
    hotfix_label: str
    sort_order: Optional[int] = None


class HotfixVersionPatchPayload(BaseModel):
    operator_id: str = "admin"
    baseline_id: Optional[int] = None
    hotfix_label: Optional[str] = None
    sort_order: Optional[int] = None


class GroupTemplateItemIn(BaseModel):
    problem_kind: str
    group_name_tpl: str = ""
    group_notice_tpl: str = ""
    group_members_tpl: str = ""
    first_report_tpl: str = ""


class GroupTemplatePutPayload(BaseModel):
    operator_id: str = "admin"
    items: list[GroupTemplateItemIn] = Field(default_factory=list)


DUTY_ROTATION_ROSTER_KINDS: tuple[str, ...] = (
    "kernelRotation",
    "controlRotation",
    "specialSlowSql",
    "specialPerf",
    "specialUpgrade",
    "specialScale",
    "specialBackup",
    "specialDr",
)
_DUTY_EXTRAS_SCHEMA_HINT = "请在数据库执行 db/migrations/0017_duty_roster_extended.sql"
_LEAVE_SCHEMA_HINT = "请在数据库执行 db/migrations/0018_leave_application.sql"
_DUTY_FIELD_SCHEMA_HINT = "请在数据库执行 db/migrations/0019_duty_field_node.sql"
_VERSION_SCHEMA_HINT = "请在数据库执行 db/migrations/0020_param_release_version.sql"
_GROUP_TEMPLATE_SCHEMA_HINT = "请在数据库执行 db/migrations/0022_param_group_template.sql"
_GROUP_TEMPLATE_KIND_ORDER: tuple[str, ...] = ("major", "urgent", "itr", "general")
_GROUP_TEMPLATE_DEFAULTS: dict[str, dict[str, str]] = {
    "major": {
        "group_name_tpl": "【GaussDB内部】【XX 重大问题】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
    "urgent": {
        "group_name_tpl": "【GaussDB内部】【XX 紧急问题】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
    "itr": {
        "group_name_tpl": "【GaussDB内部】【ITR 管理升级】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
    "general": {
        "group_name_tpl": "【GaussDB内部】【一般问题】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
}
_DUTY_FIELD_MAX_DEPTH = 32
_DUTY_FIELD_MAX_NODES = 4000
_DUTY_FIELD_OPTION_SET_CODES: frozenset[str] = frozenset({"OS_RESPONSIBILITY_INTRO", "OS_RESPONSIBILITY_OWNER"})
_DUTY_FIELD_PATH_SEP = "/"
_LEAVE_APP_NO_LOCK = 58_290_412
LEAVE_APPLICATION_TYPES: frozenset[str] = frozenset(
    {
        "重大问题公关",
        "特性开发",
        "外出公干",
        "请假/调休",
        "在途",
    }
)


PERSON_VALUE_FIELD_KEYS = frozenset({"next_handler", "collaborator", "hcs_owner"})
_PERSON_ACCOUNT_SPACE = re.compile(r"^([A-Za-z][A-Za-z0-9_.-]*)\s+(.+)$")
_PERSON_ACCOUNT_PLUS = re.compile(r"^([A-Za-z0-9_.-]+)\+(.+)$")


def _dedupe_preserve_str(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _canonical_person_display(raw: str) -> str:
    """人员展示/落库统一为「姓名 账号」：支持「账号 姓名」或「账号+姓名」。"""
    s = str(raw or "").strip()
    if not s:
        return ""
    m = _PERSON_ACCOUNT_SPACE.match(s)
    if m:
        return f"{m.group(2).strip()} {m.group(1)}".strip()
    m2 = _PERSON_ACCOUNT_PLUS.match(s)
    if m2:
        return f"{m2.group(2).strip()} {m2.group(1)}".strip()
    return s


def db_conn() -> psycopg.Connection:
    return psycopg.connect(DB_DSN, row_factory=dict_row)


# 流程 / 工单号：YW + YYYYMMDD + 三位序号 000–999（见 .cursor/rules/process-flow-id-format.mdc）
_YW_TICKET_NO_RE = re.compile(r"^YW[0-9]{11}$")
_YW_ADVISORY_LOCK_KEY1 = 4_829_031
_YW_ADVISORY_LOCK_KEY2 = 90_210


def _allocate_yw_ticket_no(conn: psycopg.Connection) -> str:
    """Next available YW{YYYYMMDD}{nnn} for today (nnn first gap in 000–999, then next free)."""
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


def _matches_required_if(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    ri = constraints.get("required_if")
    if not ri:
        return False
    for dep_key, expected in ri.items():
        actual = values.get(dep_key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        else:
            if actual != expected:
                return False
    return True


def _optional_when_all_matches(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    rules = constraints.get("optional_when_all")
    if not rules:
        return False
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) not in allowed:
            return False
    return True


def _optional_when_any_matches(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    rules = constraints.get("optional_when_any")
    if not rules:
        return False
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) in allowed:
            return True
    return False


def _effective_required(field: dict[str, Any], values: dict[str, Any]) -> bool:
    c = field.get("constraints") or {}
    if not _field_visible(field, values):
        return False
    if _optional_when_any_matches(c, values) or _optional_when_all_matches(c, values):
        return False
    if c.get("required_when_visible"):
        return True
    if c.get("required_if"):
        return _matches_required_if(c, values)
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


def _duty_month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def _require_duty_calendar_admin(conn: psycopg.Connection, operator_id: str) -> None:
    role, _ = _get_user_role(conn, operator_id.strip() or "")
    if role != "管理员":
        raise HTTPException(status_code=403, detail="仅管理员可编辑值班日历")


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


def _parse_iso_dt(s: str) -> datetime:
    raw = str(s or "").strip().replace("Z", "+00:00")
    if not raw:
        raise HTTPException(status_code=400, detail="时间不能为空")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"时间格式无效: {s}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


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


@app.get("/health")
def health() -> dict[str, str]:
    with db_conn() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


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


@app.get("/api/permissions/effective")
def get_effective_permissions(operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
    return {"operator_id": operator_id, "flags": flags}


@app.get("/api/admin/permissions")
def list_permission_policies() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at
            FROM role_permission_policy
            ORDER BY role_code, is_pl DESC, node_key, field_key
            """
        ).fetchall()
    return {"items": rows}


@app.post("/api/admin/permissions/bulk")
def upsert_permission_policies(payload: PermissionPolicyBulkPayload) -> dict[str, Any]:
    allowed = {"hidden", "readonly", "editable"}
    with db_conn() as conn:
        for item in payload.items:
            if item.permission_level not in allowed:
                raise HTTPException(status_code=400, detail=f"invalid permission_level: {item.permission_level}")
            conn.execute(
                """
                INSERT INTO role_permission_policy (
                  role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (role_code, is_pl, node_key, field_key)
                DO UPDATE SET
                  permission_level = EXCLUDED.permission_level,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = NOW()
                """,
                (
                    item.role_code.strip(),
                    item.is_pl,
                    item.node_key.strip(),
                    item.field_key.strip(),
                    item.permission_level.strip(),
                    payload.operator_id.strip() or "admin",
                ),
            )
        conn.commit()
    return {"ok": True, "count": len(payload.items)}


@app.get("/api/duty/calendar")
def get_duty_calendar(year: int, month: int, operator_id: str = "demo_001") -> dict[str, Any]:
    """按月读取内核 / 管控值班日历（所有可登录用户可读）。"""
    _ = operator_id  # 预留与权限审计扩展
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


@app.put("/api/duty/calendar")
def put_duty_calendar(payload: DutyCalendarPutPayload) -> dict[str, Any]:
    """替换某 kind 在指定年月的全部日期排班（仅管理员）。"""
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


def _validate_duty_rotation_put_lists(lists: dict[str, Any]) -> None:
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
            if st not in ("active", "inactive"):
                raise HTTPException(status_code=400, detail="status 须为 active 或 inactive")


@app.get("/api/duty/rotation")
def get_duty_rotation(operator_id: str = "demo_001") -> dict[str, Any]:
    """读取全部轮值表（各 kind 一条有序列表）。"""
    _ = operator_id
    out: dict[str, list[dict[str, str]]] = {k: [] for k in DUTY_ROTATION_ROSTER_KINDS}
    try:
        with db_conn() as conn:
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


@app.put("/api/duty/rotation")
def put_duty_rotation(payload: DutyRotationPutPayload) -> dict[str, Any]:
    """全量替换轮值表（仅管理员）。"""
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
                            str(slot.get("status") or "active").strip(),
                            str(slot.get("last_accept_at") or "").strip()[:64],
                            op,
                        ),
                    )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"轮值表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    return {"ok": True}


@app.get("/api/duty/site-oncall")
def get_duty_site_oncall(operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    rows_out: list[dict[str, str]] = []
    try:
        with db_conn() as conn:
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


@app.put("/api/duty/site-oncall")
def put_duty_site_oncall(payload: DutySiteOnCallPutPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "admin"
    for i, row in enumerate(payload.rows):
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail="行格式无效")
        site = str(row.get("site_name") or "").strip()
        acc = str(row.get("account") or "").strip()
        if not site or not acc:
            raise HTTPException(status_code=400, detail=f"第 {i + 1} 行须含 site_name 与 account")
        st = str(row.get("status") or "active").strip()
        if st not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="status 须为 active 或 inactive")
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
                        str(row.get("status") or "active").strip(),
                        str(row.get("last_accept_at") or "").strip()[:64],
                        op,
                    ),
                )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"局点值班表未就绪：{_DUTY_EXTRAS_SCHEMA_HINT}") from exc
    return {"ok": True, "count": len(payload.rows)}


@app.get("/api/duty/rl-oncall")
def get_duty_rl_oncall(operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    rows_out: list[dict[str, Any]] = []
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


@app.put("/api/duty/rl-oncall")
def put_duty_rl_oncall(payload: DutyRlOnCallPutPayload) -> dict[str, Any]:
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


@app.get("/api/leave/approver-whitelist")
def get_leave_approver_whitelist(operator_id: str = "demo_001") -> dict[str, Any]:
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


@app.put("/api/leave/approver-whitelist")
def put_leave_approver_whitelist(payload: LeaveApproverWhitelistPutPayload) -> dict[str, Any]:
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


@app.get("/api/leave/applications")
def list_leave_applications(
    operator_id: str = "demo_001",
    scope: str = "all",
    q: str = "",
) -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    sc = (scope or "all").strip().lower()
    if sc not in ("all", "todo", "pending_approval"):
        raise HTTPException(status_code=400, detail="scope 须为 all、todo 或 pending_approval")
    qq = str(q or "").strip()
    try:
        with db_conn() as conn:
            where_parts: list[str] = ["1=1"]
            params: list[Any] = []
            if sc == "todo":
                where_parts.append("a.current_handler_account = %s AND a.status = %s")
                params.extend([op, "审批中"])
            elif sc == "pending_approval":
                # 我的主页「待审批」：待我审批（同「我的待办」）或本人发起且尚未结案（待提交 / 审批中）
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
            """
            rows = conn.execute(sql, tuple(params)).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    out: list[dict[str, Any]] = []
    for r in rows:
        rowd = dict(r)
        ch_un = str(rowd.pop("current_handler_user_name", "") or "").strip()
        ch_acc = str(rowd.get("current_handler_account") or "").strip()
        cur_disp = f"{ch_un} {ch_acc}".strip() if ch_un and ch_acc else ch_acc
        rowd["current_handler_display"] = cur_disp
        out.append(rowd)
    return {"items": out}


@app.post("/api/leave/applications")
def create_leave_application(payload: LeaveApplicationCreatePayload) -> dict[str, Any]:
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


@app.get("/api/leave/applications/{app_id}")
def get_leave_application(app_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
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
            cc_accounts: list[Any] = cc_raw if isinstance(cc_raw, list) else []
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


@app.post("/api/leave/applications/{app_id}/action")
def leave_application_action(app_id: int, payload: LeaveActionPayload) -> dict[str, Any]:
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
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"请假申请表未就绪：{_LEAVE_SCHEMA_HINT}") from exc
    return {"ok": True, "status": new_status}


@app.get("/api/params/duty-field/tree")
def get_duty_field_tree(operator_id: str = "demo_001") -> dict[str, Any]:
    """读取责任田多级分类（全树）；任意登录账号可查。"""
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, parent_id, label, sort_order
                FROM duty_field_node
                ORDER BY parent_id NULLS FIRST, sort_order, id
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"nodes": _duty_field_rows_to_tree(rows)}


@app.put("/api/params/duty-field/tree")
def put_duty_field_tree(payload: DutyFieldTreePutPayload) -> dict[str, Any]:
    """整树替换写入责任田分类（仅管理员）。"""
    op = payload.operator_id.strip() or "admin"
    nodes = list(payload.nodes or [])
    if nodes:
        _validate_duty_field_tree(nodes)
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute("TRUNCATE TABLE duty_field_node RESTART IDENTITY CASCADE")
            if nodes:
                _duty_field_insert_tree(conn, None, nodes, op, 0)
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"ok": True}


@app.get("/api/params/baseline-versions")
def list_baseline_versions(q: str = "", operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    qv = (q or "").strip()
    try:
        with db_conn() as conn:
            if qv:
                like = f"%{qv}%"
                rows = conn.execute(
                    """
                    SELECT id, version_label, commit_hash, sort_order, updated_at
                    FROM param_baseline_version
                    WHERE version_label ILIKE %s OR commit_hash ILIKE %s
                    ORDER BY sort_order, id
                    """,
                    (like, like),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, version_label, commit_hash, sort_order, updated_at
                    FROM param_baseline_version
                    ORDER BY sort_order, id
                    """
                ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    return {"items": rows}


@app.post("/api/params/baseline-versions")
def create_baseline_version(payload: BaselineVersionCreatePayload) -> dict[str, Any]:
    lab = str(payload.version_label or "").strip()
    if not lab:
        raise HTTPException(status_code=400, detail="版本不能为空")
    ch = str(payload.commit_hash or "").strip()[:128]
    op = payload.operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            sort_order = payload.sort_order
            if sort_order is None:
                row = conn.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM param_baseline_version"
                ).fetchone()
                sort_order = int(row["n"]) if row else 0
            row = conn.execute(
                """
                INSERT INTO param_baseline_version (version_label, commit_hash, sort_order, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                RETURNING id, version_label, commit_hash, sort_order, updated_at
                """,
                (lab[:256], ch, int(sort_order), op),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    return {"item": row}


@app.patch("/api/params/baseline-versions/{row_id:int}")
def patch_baseline_version(row_id: int, payload: BaselineVersionPatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "admin"
    fields: list[str] = []
    vals: list[Any] = []
    if payload.version_label is not None:
        lab = str(payload.version_label or "").strip()
        if not lab:
            raise HTTPException(status_code=400, detail="版本不能为空")
        fields.append("version_label = %s")
        vals.append(lab[:256])
    if payload.commit_hash is not None:
        fields.append("commit_hash = %s")
        vals.append(str(payload.commit_hash or "").strip()[:128])
    if payload.sort_order is not None:
        fields.append("sort_order = %s")
        vals.append(int(payload.sort_order))
    if not fields:
        raise HTTPException(status_code=400, detail="无更新字段")
    fields.append("updated_by = %s")
    vals.append(op)
    fields.append("updated_at = NOW()")
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute(
                f"UPDATE param_baseline_version SET {', '.join(fields)} WHERE id = %s",
                vals + [row_id],
            )
            row = conn.execute(
                """
                SELECT id, version_label, commit_hash, sort_order, updated_at
                FROM param_baseline_version WHERE id = %s
                """,
                (row_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"item": row}


@app.delete("/api/params/baseline-versions/{row_id:int}")
def delete_baseline_version(row_id: int, operator_id: str = "admin") -> dict[str, Any]:
    op = operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            n = conn.execute(
                "SELECT COUNT(*) AS c FROM param_hotfix_version WHERE baseline_id = %s",
                (row_id,),
            ).fetchone()
            if n and int(n["c"] or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="该基线仍被热补丁引用，请先删除或调整相关热补丁记录",
                )
            cur = conn.execute("DELETE FROM param_baseline_version WHERE id = %s RETURNING id", (row_id,))
            deleted = cur.fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"ok": True}


@app.get("/api/params/hotfix-versions")
def list_hotfix_versions(q: str = "", operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    qv = (q or "").strip()
    try:
        with db_conn() as conn:
            if qv:
                like = f"%{qv}%"
                rows = conn.execute(
                    """
                    SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                           b.version_label AS baseline_version_label,
                           b.commit_hash AS baseline_commit_hash
                    FROM param_hotfix_version h
                    JOIN param_baseline_version b ON b.id = h.baseline_id
                    WHERE h.hotfix_label ILIKE %s
                       OR b.version_label ILIKE %s
                       OR b.commit_hash ILIKE %s
                    ORDER BY h.sort_order, h.id
                    """,
                    (like, like, like),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                           b.version_label AS baseline_version_label,
                           b.commit_hash AS baseline_commit_hash
                    FROM param_hotfix_version h
                    JOIN param_baseline_version b ON b.id = h.baseline_id
                    ORDER BY h.sort_order, h.id
                    """
                ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    return {"items": rows}


@app.post("/api/params/hotfix-versions")
def create_hotfix_version(payload: HotfixVersionCreatePayload) -> dict[str, Any]:
    hf = str(payload.hotfix_label or "").strip()
    if not hf:
        raise HTTPException(status_code=400, detail="热补丁版本不能为空")
    bid = int(payload.baseline_id)
    op = payload.operator_id.strip() or "admin"
    full: Any = None
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            exists = conn.execute(
                "SELECT 1 FROM param_baseline_version WHERE id = %s",
                (bid,),
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=400, detail="基线版本不存在")
            sort_order = payload.sort_order
            if sort_order is None:
                row = conn.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM param_hotfix_version"
                ).fetchone()
                sort_order = int(row["n"]) if row else 0
            ins = conn.execute(
                """
                INSERT INTO param_hotfix_version (baseline_id, hotfix_label, sort_order, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                RETURNING id
                """,
                (bid, hf[:256], int(sort_order), op),
            ).fetchone()
            if not ins:
                raise HTTPException(status_code=500, detail="写入热补丁失败")
            new_id = int(ins["id"])
            full = conn.execute(
                """
                SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                       b.version_label AS baseline_version_label,
                       b.commit_hash AS baseline_commit_hash
                FROM param_hotfix_version h
                JOIN param_baseline_version b ON b.id = h.baseline_id
                WHERE h.id = %s
                """,
                (new_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not full:
        raise HTTPException(status_code=500, detail="读取新建热补丁失败")
    return {"item": full}


@app.patch("/api/params/hotfix-versions/{row_id:int}")
def patch_hotfix_version(row_id: int, payload: HotfixVersionPatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "admin"
    fields: list[str] = []
    vals: list[Any] = []
    if payload.baseline_id is not None:
        fields.append("baseline_id = %s")
        vals.append(int(payload.baseline_id))
    if payload.hotfix_label is not None:
        hf = str(payload.hotfix_label or "").strip()
        if not hf:
            raise HTTPException(status_code=400, detail="热补丁版本不能为空")
        fields.append("hotfix_label = %s")
        vals.append(hf[:256])
    if payload.sort_order is not None:
        fields.append("sort_order = %s")
        vals.append(int(payload.sort_order))
    if not fields:
        raise HTTPException(status_code=400, detail="无更新字段")
    fields.append("updated_by = %s")
    vals.append(op)
    fields.append("updated_at = NOW()")
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            if payload.baseline_id is not None:
                exists = conn.execute(
                    "SELECT 1 FROM param_baseline_version WHERE id = %s",
                    (int(payload.baseline_id),),
                ).fetchone()
                if not exists:
                    raise HTTPException(status_code=400, detail="基线版本不存在")
            conn.execute(
                f"UPDATE param_hotfix_version SET {', '.join(fields)} WHERE id = %s",
                vals + [row_id],
            )
            full = conn.execute(
                """
                SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                       b.version_label AS baseline_version_label,
                       b.commit_hash AS baseline_commit_hash
                FROM param_hotfix_version h
                JOIN param_baseline_version b ON b.id = h.baseline_id
                WHERE h.id = %s
                """,
                (row_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not full:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"item": full}


@app.delete("/api/params/hotfix-versions/{row_id:int}")
def delete_hotfix_version(row_id: int, operator_id: str = "admin") -> dict[str, Any]:
    op = operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            cur = conn.execute("DELETE FROM param_hotfix_version WHERE id = %s RETURNING id", (row_id,))
            deleted = cur.fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"ok": True}


@app.get("/api/params/group-templates")
def list_group_templates(operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl,
                       first_report_tpl, updated_by, updated_at
                FROM param_group_template
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_GROUP_TEMPLATE_SCHEMA_HINT) from exc
    return {"items": _merge_group_template_list(rows)}


@app.put("/api/params/group-templates")
def put_group_templates(payload: GroupTemplatePutPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "admin"
    items = list(payload.items or [])
    kinds_in = {str(x.problem_kind or "").strip() for x in items}
    if kinds_in != set(_GROUP_TEMPLATE_KIND_ORDER):
        raise HTTPException(
            status_code=400,
            detail=f"须一次性提交四种问题类型：{', '.join(_GROUP_TEMPLATE_KIND_ORDER)}",
        )
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            for it in items:
                k = str(it.problem_kind or "").strip()
                if k not in _GROUP_TEMPLATE_KIND_ORDER:
                    raise HTTPException(status_code=400, detail=f"未知问题类型：{k}")
                conn.execute(
                    """
                    INSERT INTO param_group_template (
                      problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl,
                      first_report_tpl, updated_by, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (problem_kind) DO UPDATE SET
                      group_name_tpl = EXCLUDED.group_name_tpl,
                      group_notice_tpl = EXCLUDED.group_notice_tpl,
                      group_members_tpl = EXCLUDED.group_members_tpl,
                      first_report_tpl = EXCLUDED.first_report_tpl,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = NOW()
                    """,
                    (
                        k,
                        str(it.group_name_tpl or ""),
                        str(it.group_notice_tpl or ""),
                        str(it.group_members_tpl or ""),
                        str(it.first_report_tpl or ""),
                        op,
                    ),
                )
            conn.commit()
            rows = conn.execute(
                """
                SELECT problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl,
                       first_report_tpl, updated_by, updated_at
                FROM param_group_template
                """
            ).fetchall()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_GROUP_TEMPLATE_SCHEMA_HINT) from exc
    return {"ok": True, "items": _merge_group_template_list(rows)}


@app.get("/api/admin/users")
def list_users() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at
            FROM user_account
            ORDER BY account
            """
        ).fetchall()
    return {"items": rows}


@app.post("/api/admin/users/bulk")
def upsert_users(payload: UserAccountBulkPayload) -> dict[str, Any]:
    with db_conn() as conn:
        for item in payload.items:
            conn.execute(
                """
                INSERT INTO user_account (
                  account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (account)
                DO UPDATE SET
                  user_name = EXCLUDED.user_name,
                  role_code = EXCLUDED.role_code,
                  group_name = EXCLUDED.group_name,
                  is_pl = EXCLUDED.is_pl,
                  is_active = EXCLUDED.is_active,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = NOW()
                """,
                (
                    item.account.strip(),
                    item.user_name.strip(),
                    item.role_code.strip(),
                    item.group_name.strip(),
                    item.is_pl,
                    item.is_active,
                    payload.operator_id.strip() or "admin",
                ),
            )
        conn.commit()
    return {"ok": True, "count": len(payload.items)}


@app.delete("/api/admin/permissions")
def delete_permission_policy(role_code: str, is_pl: bool, node_key: str, field_key: str) -> dict[str, Any]:
    with db_conn() as conn:
        conn.execute(
            """
            DELETE FROM role_permission_policy
            WHERE role_code = %s AND is_pl = %s AND node_key = %s AND field_key = %s
            """,
            (role_code, is_pl, node_key, field_key),
        )
        conn.commit()
    return {"ok": True}


@app.delete("/api/admin/users")
def delete_user(account: str) -> dict[str, Any]:
    with db_conn() as conn:
        conn.execute("DELETE FROM user_account WHERE account = %s", (account,))
        conn.commit()
    return {"ok": True}


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
            handler_display = str(row["current_handler"] or "").strip()
            if not handler_display:
                handler_display = str(snap.get("_last_submit_next_handler") or "").strip()
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


@app.get("/api/tickets/{ticket_id}/nodes/{node_key}/data")
def get_node_data(ticket_id: str, node_key: str, operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
            raise HTTPException(status_code=403, detail="仅可查看问题填写节点")
        _ = _load_schema(conn, node_key)
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
              tn.node_name AS to_node_name
            FROM ticket_flow_log tfl
            JOIN ticket t ON t.id = tfl.ticket_id
            LEFT JOIN workflow_node fn ON fn.id = tfl.from_node_id
            LEFT JOIN workflow_node tn ON tn.id = tfl.to_node_id
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
    for row in fallback_rows:
        curr = str(row["node_name"] or "-")
        items.append(
            {
                "at": row["created_at"].strftime("%Y-%m-%d %H:%M"),
                "actor": str(row["handler_name"] or "-"),
                "action": str(row["action_status"] or "completed"),
                "from": prev_node,
                "to": curr,
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

        submitter_display = _canonical_person_display(f"{payload.operator_id} {payload.operator_name}")
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
