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
HOME_PERSONAL_SLA_STAGE_KEYS: tuple[str, ...] = (
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
)
HOME_PERSONAL_STAGE_NAME_BY_KEY: dict[str, str] = {
    "problem_fill": "问题填写",
    "problem_review": "问题审核",
    "ops_analysis": "运维分析",
    "dev_analysis": "开发分析",
    "dev_closure": "开发闭环",
    "ops_closure": "运维闭环",
    "audit_close": "审核关闭",
}
HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS: frozenset[str] = frozenset(
    {"problem_fill", "problem_review", "ops_analysis"}
)

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


class HolidayConfigPutPayload(BaseModel):
    operator_id: str = "admin"
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    days: dict[str, str] = Field(default_factory=dict)


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


class RequirementCreatePayload(BaseModel):
    operator_id: str
    title: str
    description: str
    proposer: str
    assignee: str
    related_issues: list[str] = Field(default_factory=list)
    external_req_no: str = ""
    planned_version: str = ""
    planned_date: Optional[str] = None
    priority: int = 5
    category: str = "其他"
    value: str = "质量加固"
    remark: str = ""


class RequirementPatchPayload(BaseModel):
    operator_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    proposer: Optional[str] = None
    assignee: Optional[str] = None
    related_issues: Optional[list[str]] = None
    external_req_no: Optional[str] = None
    planned_version: Optional[str] = None
    planned_date: Optional[str] = None
    priority: Optional[int] = None
    category: Optional[str] = None
    value: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[str] = None
    comment: str = ""


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
_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE: dict[str, str] = {
    "慢SQL（SQL调优）": "specialSlowSql",
    "整体性能": "specialPerf",
    "升级": "specialUpgrade",
    "扩容": "specialScale",
    "备份恢复": "specialBackup",
    "容灾": "specialDr",
    "SQL引擎-其他问题": "kernelRotation",
    "存储引擎-其他问题": "kernelRotation",
    "管控问题": "controlRotation",
    "其他": "kernelRotation",
}
_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED: dict[str, str] = {
    "慢sqlsql调优": "specialSlowSql",
    "整体性能": "specialPerf",
    "升级": "specialUpgrade",
    "扩容": "specialScale",
    "备份恢复": "specialBackup",
    "容灾": "specialDr",
    "sql引擎-其他问题": "kernelRotation",
    "存储引擎-其他问题": "kernelRotation",
    "管控问题": "controlRotation",
    "其他": "kernelRotation",
}
_COMPONENT_TO_KIND: dict[str, str] = {
    "内核问题": "kernel",
    "管控问题": "control",
}
_DUTY_STATUS_ON: frozenset[str] = frozenset({"active", "当值"})
_DUTY_EXTRAS_SCHEMA_HINT = "请在数据库执行 db/migrations/0017_duty_roster_extended.sql"
_HOLIDAY_SCHEMA_HINT = "请在数据库执行 db/migrations/0029_ticket_flow_dispatch_rules.sql"
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
_VERSION_BASELINE_OPTION_SET_CODES: frozenset[str] = frozenset({"OS_GAUSS_VERSION", "OS_UPGRADE_BASELINE"})
_DUTY_FIELD_PATH_SEP = "/"
_LEAVE_APP_NO_LOCK = 58_290_412
_REQUIREMENT_NO_LOCK = 58_290_413
_REQUIREMENT_SCHEMA_HINT = "请在数据库执行 db/migrations/0028_requirement_management.sql"
REQUIREMENT_STATUSES: tuple[str, ...] = ("待分析", "待RAT决策", "开发中", "已经落地")
REQUIREMENT_CATEGORIES: tuple[str, ...] = ("管控需求", "内核需求", "管控和内核需求", "其他")
REQUIREMENT_VALUES: tuple[str, ...] = ("质量加固", "性能提升", "竞争力提升", "定位能力提升", "恢复能力提升", "感知能力提升")
REQUIREMENT_STATUS_FORWARD: dict[str, str] = {
    "待分析": "待RAT决策",
    "待RAT决策": "开发中",
    "开发中": "已经落地",
}
REQUIREMENT_STATUS_BACKWARD: dict[str, str] = {
    "待RAT决策": "待分析",
    "开发中": "待RAT决策",
    "已经落地": "开发中",
}
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
_CHINA_TZ = ZoneInfo("Asia/Shanghai")


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


def _parse_last_accept_at(raw: Any) -> datetime:
    txt = str(raw or "").strip()
    if not txt:
        return datetime(1970, 1, 1, tzinfo=_CHINA_TZ)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(txt, fmt)
            return dt.replace(tzinfo=_CHINA_TZ)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(txt)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=_CHINA_TZ)
        return dt.astimezone(_CHINA_TZ)
    except ValueError:
        return datetime(1970, 1, 1, tzinfo=_CHINA_TZ)


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


def _parse_ymd(s: str, field_name: str) -> date:
    raw = str(s or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"{field_name} 不能为空")
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} 格式无效，应为 YYYY-MM-DD") from exc


def _to_utc_start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


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


@app.get("/api/duty/holidays")
def get_holiday_config(year: int, month: int, operator_id: str = "demo_001") -> dict[str, Any]:
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


@app.put("/api/duty/holidays")
def put_holiday_config(payload: HolidayConfigPutPayload) -> dict[str, Any]:
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
            if st not in ("active", "inactive", "当值", "非当值"):
                raise HTTPException(status_code=400, detail="status 须为 active/inactive 或 当值/非当值")


def _normalize_duty_status(raw: Any) -> str:
    st = str(raw or "active").strip()
    if st in ("active", "当值"):
        return "active"
    if st in ("inactive", "非当值"):
        return "inactive"
    raise HTTPException(status_code=400, detail="status 须为 active/inactive 或 当值/非当值")


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
                            _normalize_duty_status(slot.get("status")),
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


@app.get("/api/requirements")
def list_requirements(
    operator_id: str = "demo_001",
    scope: str = "all",
    status: str = "",
    priority: str = "",
    category: str = "",
    value: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    sc = (scope or "all").strip().lower()
    if sc not in ("all", "mine", "assigned"):
        raise HTTPException(status_code=400, detail="scope 须为 all、mine 或 assigned")
    qq = str(q or "").strip()
    status_list = [s.strip() for s in status.split(",") if s.strip()] if status else []
    priority_list = [p.strip() for p in priority.split(",") if p.strip()] if priority else []
    category_list = [c.strip() for c in category.split(",") if c.strip()] if category else []
    value_list = [v.strip() for v in value.split(",") if v.strip()] if value else []
    pg = max(1, page)
    ps = max(1, min(10000, page_size))
    offset = (pg - 1) * ps
    try:
        with db_conn() as conn:
            where_parts: list[str] = ["1=1"]
            params: list[Any] = []
            if sc == "mine":
                where_parts.append("r.creator_id = %s")
                params.append(op)
            elif sc == "assigned":
                where_parts.append("r.assignee LIKE %s")
                params.append(f"%{op}%")
            if status_list:
                ph = ",".join(["%s"] * len(status_list))
                where_parts.append(f"r.status IN ({ph})")
                params.extend(status_list)
            if priority_list:
                ph = ",".join(["%s"] * len(priority_list))
                where_parts.append(f"r.priority IN ({ph})")
                params.extend([int(p) for p in priority_list if p.isdigit()])
            if category_list:
                ph = ",".join(["%s"] * len(category_list))
                where_parts.append(f"r.category IN ({ph})")
                params.extend(category_list)
            if value_list:
                ph = ",".join(["%s"] * len(value_list))
                where_parts.append(f"r.value IN ({ph})")
                params.extend(value_list)
            if qq:
                pat = f"%{qq}%"
                where_parts.append(
                    """
                    (
                      r.title ILIKE %s OR r.description ILIKE %s
                      OR r.proposer ILIKE %s OR r.assignee ILIKE %s
                      OR r.external_req_no ILIKE %s OR r.remark ILIKE %s
                      OR r.requirement_no ILIKE %s OR r.category ILIKE %s OR r.value ILIKE %s
                    )
                    """
                )
                params.extend([pat] * 9)
            wh = " AND ".join(where_parts)
            count_row = conn.execute(f"SELECT COUNT(*) AS cnt FROM requirement r WHERE {wh}", tuple(params)).fetchone()
            total = int(count_row["cnt"] or 0)
            rows = conn.execute(
                f"""
                SELECT
                  r.id, r.requirement_no, r.title, r.description,
                  r.proposer, r.assignee, r.related_issues,
                  r.external_req_no, r.planned_version, r.planned_date,
                  r.priority, r.category, r.value, r.remark, r.status,
                  r.creator_id, r.creator_name,
                  r.created_at, r.updated_at
                FROM requirement r
                WHERE {wh}
                ORDER BY r.priority ASC, r.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [ps, offset]),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {"items": rows, "total": total, "page": pg, "page_size": ps}


@app.get("/api/requirements/analytics")
def analytics_requirements(
    operator_id: str = "demo_001",
    start_date: str = "",
    end_date: str = "",
    precision: str = "week",
) -> dict[str, Any]:
    _ = operator_id.strip() or "demo_001"
    today = datetime.now().date()
    ed = _parse_ymd(end_date, "end_date") if end_date else today
    sd = _parse_ymd(start_date, "start_date") if start_date else today - timedelta(days=90)
    if sd > ed:
        sd, ed = ed, sd
    prec = (precision or "week").strip().lower()
    if prec not in ("week", "month"):
        raise HTTPException(status_code=400, detail="precision 须为 week 或 month")
    start_dt = datetime(sd.year, sd.month, sd.day, tzinfo=timezone.utc)
    end_dt_exclusive = datetime(ed.year, ed.month, ed.day, tzinfo=timezone.utc) + timedelta(days=1)
    try:
        with db_conn() as conn:
            kpi_row = conn.execute(
                "SELECT COUNT(*) AS total, COALESCE(AVG(priority),0) AS avg_priority FROM requirement WHERE created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            total = int(kpi_row["total"] or 0)
            avg_priority = round(float(kpi_row["avg_priority"] or 0), 1)
            status_rows = conn.execute(
                "SELECT status, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY status ORDER BY status",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            by_status: dict[str, int] = {}
            for r in status_rows:
                by_status[str(r["status"])] = int(r["cnt"])
            all_statuses = ["待分析", "待RAT决策", "开发中", "已经落地"]
            status_labels = all_statuses
            status_values = [by_status.get(s, 0) for s in all_statuses]
            in_progress = by_status.get("待分析", 0) + by_status.get("待RAT决策", 0) + by_status.get("开发中", 0)
            landed = by_status.get("已经落地", 0)
            on_time_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM requirement WHERE status = '已经落地' AND planned_date IS NOT NULL AND updated_at::date <= planned_date AND created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            landed_with_plan_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM requirement WHERE status = '已经落地' AND planned_date IS NOT NULL AND created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            on_time_count = int(on_time_row["cnt"] or 0)
            landed_with_plan = int(landed_with_plan_row["cnt"] or 0)
            on_time_rate = round(on_time_count / landed_with_plan, 2) if landed_with_plan > 0 else None
            overdue_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM requirement WHERE status != '已经落地' AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE AND created_at >= %s AND created_at < %s",
                (start_dt, end_dt_exclusive),
            ).fetchone()
            overdue_count = int(overdue_row["cnt"] or 0)
            prio_rows = conn.execute(
                "SELECT priority, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY priority ORDER BY priority",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            prio_map: dict[int, int] = {}
            for r in prio_rows:
                prio_map[int(r["priority"])] = int(r["cnt"])
            urgent_count = sum(prio_map.get(p, 0) for p in range(1, 4))
            high_count = sum(prio_map.get(p, 0) for p in range(4, 7))
            low_count = sum(prio_map.get(p, 0) for p in range(7, 11))
            priority_groups = [
                {"label": "紧急(P1-3)", "count": urgent_count, "items": [prio_map.get(p, 0) for p in range(1, 4)]},
                {"label": "高(P4-6)", "count": high_count, "items": [prio_map.get(p, 0) for p in range(4, 7)]},
                {"label": "低(P7-10)", "count": low_count, "items": [prio_map.get(p, 0) for p in range(7, 11)]},
            ]
            category_rows = conn.execute(
                "SELECT category, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY category ORDER BY category",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            category_labels = list(REQUIREMENT_CATEGORIES)
            category_map = {str(r["category"]): int(r["cnt"]) for r in category_rows}
            category_values = [category_map.get(c, 0) for c in category_labels]
            value_rows = conn.execute(
                "SELECT value, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY value ORDER BY value",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            value_labels = list(REQUIREMENT_VALUES)
            value_map = {str(r["value"]): int(r["cnt"]) for r in value_rows}
            value_values = [value_map.get(v, 0) for v in value_labels]
            trunc = "week" if prec == "week" else "month"
            fmt = "YYYY\"W\"IW" if prec == "week" else "YYYY-MM"
            trend_created_rows = conn.execute(
                f"SELECT to_char(date_trunc(%s, created_at), %s) AS label, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY label ORDER BY MIN(created_at)",
                (trunc, fmt, start_dt, end_dt_exclusive),
            ).fetchall()
            trend_changed_rows = conn.execute(
                f"SELECT to_char(date_trunc(%s, rl.created_at), %s) AS label, COUNT(DISTINCT rl.requirement_id) AS cnt FROM requirement_log rl WHERE rl.action = 'status_changed' AND rl.created_at >= %s AND rl.created_at < %s GROUP BY label ORDER BY MIN(rl.created_at)",
                (trunc, fmt, start_dt, end_dt_exclusive),
            ).fetchall()
            trend_landed_rows = conn.execute(
                f"SELECT to_char(date_trunc(%s, rl.created_at), %s) AS label, COUNT(DISTINCT rl.requirement_id) AS cnt FROM requirement_log rl WHERE rl.action = 'status_changed' AND rl.to_status = '已经落地' AND rl.created_at >= %s AND rl.created_at < %s GROUP BY label ORDER BY MIN(rl.created_at)",
                (trunc, fmt, start_dt, end_dt_exclusive),
            ).fetchall()
            all_labels_set: set[str] = set()
            for r in trend_created_rows:
                all_labels_set.add(str(r["label"]))
            for r in trend_changed_rows:
                all_labels_set.add(str(r["label"]))
            for r in trend_landed_rows:
                all_labels_set.add(str(r["label"]))
            all_labels = sorted(all_labels_set)
            created_map = {str(r["label"]): int(r["cnt"]) for r in trend_created_rows}
            changed_map = {str(r["label"]): int(r["cnt"]) for r in trend_changed_rows}
            landed_map = {str(r["label"]): int(r["cnt"]) for r in trend_landed_rows}
            proposer_rows = conn.execute(
                "SELECT proposer, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY proposer ORDER BY cnt DESC LIMIT 10",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            assignee_rows = conn.execute(
                "SELECT assignee, COUNT(*) AS cnt FROM requirement WHERE created_at >= %s AND created_at < %s GROUP BY assignee ORDER BY cnt DESC LIMIT 10",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            version_rows = conn.execute(
                "SELECT planned_version, status, COUNT(*) AS cnt FROM requirement WHERE planned_version != '' AND created_at >= %s AND created_at < %s GROUP BY planned_version, status ORDER BY planned_version",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            version_map: dict[str, dict[str, int]] = {}
            for r in version_rows:
                v = str(r["planned_version"])
                s = str(r["status"])
                if v not in version_map:
                    version_map[v] = {}
                version_map[v][s] = int(r["cnt"])
            by_version = []
            for v in sorted(version_map.keys()):
                vm = version_map[v]
                v_total = sum(vm.values())
                v_landed = vm.get("已经落地", 0)
                v_overdue_row = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM requirement WHERE planned_version = %s AND status != '已经落地' AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE",
                    (v,),
                ).fetchone()
                v_overdue = int(v_overdue_row["cnt"] or 0)
                by_version.append({"version": v, "total": v_total, "landed": v_landed, "overdue": v_overdue, "by_status": vm})
            overdue_detail_rows = conn.execute(
                "SELECT requirement_no, title, planned_date, status FROM requirement WHERE status != '已经落地' AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE AND created_at >= %s AND created_at < %s ORDER BY planned_date ASC LIMIT 20",
                (start_dt, end_dt_exclusive),
            ).fetchall()
            overdue_details = [
                {"requirement_no": str(r["requirement_no"]), "title": str(r["title"]), "planned_date": str(r["planned_date"])[:10] if r["planned_date"] else "", "status": str(r["status"])}
                for r in overdue_detail_rows
            ]
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {
        "kpi": {
            "total": total,
            "by_status": by_status,
            "avg_priority": avg_priority,
            "on_time_rate": on_time_rate,
            "overdue_count": overdue_count,
            "in_progress": in_progress,
            "landed": landed,
        },
        "status_distribution": {"labels": status_labels, "values": status_values},
        "priority_distribution": {"groups": priority_groups},
        "category_distribution": {"labels": category_labels, "values": category_values},
        "value_distribution": {"labels": value_labels, "values": value_values},
        "trend": {
            "labels": all_labels,
            "created": [created_map.get(l, 0) for l in all_labels],
            "status_changed": [changed_map.get(l, 0) for l in all_labels],
            "landed": [landed_map.get(l, 0) for l in all_labels],
        },
        "person_load": {
            "top_proposers": [{"name": str(r["proposer"]), "count": int(r["cnt"])} for r in proposer_rows],
            "top_assignees": [{"name": str(r["assignee"]), "count": int(r["cnt"])} for r in assignee_rows],
        },
        "version_plan": {"by_version": by_version, "overdue_details": overdue_details},
    }


@app.post("/api/requirements")
def create_requirement(payload: RequirementCreatePayload) -> dict[str, Any]:
    op = payload.operator_id.strip()
    if not op:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="需求标题不能为空")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="详细描述不能为空")
    if not payload.proposer.strip():
        raise HTTPException(status_code=400, detail="需求提出人不能为空")
    if not payload.assignee.strip():
        raise HTTPException(status_code=400, detail="当前责任人不能为空")
    if payload.priority < 1 or payload.priority > 10:
        raise HTTPException(status_code=400, detail="优先级须为 1-10")
    cat = payload.category.strip() or "其他"
    if cat not in REQUIREMENT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"无效需求分类: {cat}")
    val = payload.value.strip() or "质量加固"
    if val not in REQUIREMENT_VALUES:
        raise HTTPException(status_code=400, detail=f"无效需求价值: {val}")
    related = [str(x or "").strip() for x in payload.related_issues if str(x or "").strip()]
    planned_date_val = None
    if payload.planned_date:
        try:
            planned_date_val = datetime.strptime(payload.planned_date.strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="计划落地日期格式无效，应为 YYYY-MM-DD") from exc
    try:
        with db_conn() as conn:
            creator_disp = _display_name_account(conn, op)
            req_no = _allocate_requirement_no(conn)
            row = conn.execute(
                """
                INSERT INTO requirement (
                  requirement_no, title, description, proposer, assignee,
                  related_issues, external_req_no, planned_version, planned_date,
                  priority, category, value, remark, status, creator_id, creator_name
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    req_no,
                    payload.title.strip(),
                    payload.description.strip(),
                    payload.proposer.strip(),
                    payload.assignee.strip(),
                    psycopg.types.json.Jsonb(related),
                    payload.external_req_no.strip(),
                    payload.planned_version.strip(),
                    planned_date_val,
                    payload.priority,
                    cat,
                    val,
                    payload.remark.strip(),
                    "待分析",
                    op,
                    creator_disp,
                ),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="写入需求失败")
            req_id = int(row["id"])
            conn.execute(
                """
                INSERT INTO requirement_log (requirement_id, action, to_status, operator_id, operator_name, comment)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (req_id, "created", "待分析", op, creator_disp, ""),
            )
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return dict(row)


@app.get("/api/requirements/{req_id:int}")
def get_requirement(req_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM requirement WHERE id = %s", (req_id,)).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    if not row:
        raise HTTPException(status_code=404, detail="需求不存在")
    return dict(row)


@app.patch("/api/requirements/{req_id:int}")
def patch_requirement(req_id: int, payload: RequirementPatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM requirement WHERE id = %s FOR UPDATE", (req_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="需求不存在")
            old = dict(row)
            updates: dict[str, Any] = {}
            changed: dict[str, list[Any]] = {}
            simple_fields = {
                "title": payload.title,
                "description": payload.description,
                "proposer": payload.proposer,
                "assignee": payload.assignee,
                "external_req_no": payload.external_req_no,
                "planned_version": payload.planned_version,
                "remark": payload.remark,
            }
            for field, val in simple_fields.items():
                if val is not None:
                    new_val = str(val).strip()
                    old_val = str(old.get(field, "") or "").strip()
                    if new_val != old_val:
                        updates[field] = new_val
                        changed[field] = [old_val, new_val]
            if payload.category is not None:
                new_cat = payload.category.strip()
                if new_cat not in REQUIREMENT_CATEGORIES:
                    raise HTTPException(status_code=400, detail=f"无效需求分类: {new_cat}")
                old_cat = str(old.get("category", "") or "").strip()
                if new_cat != old_cat:
                    updates["category"] = new_cat
                    changed["category"] = [old_cat, new_cat]
            if payload.value is not None:
                new_val = payload.value.strip()
                if new_val not in REQUIREMENT_VALUES:
                    raise HTTPException(status_code=400, detail=f"无效需求价值: {new_val}")
                old_val = str(old.get("value", "") or "").strip()
                if new_val != old_val:
                    updates["value"] = new_val
                    changed["value"] = [old_val, new_val]
            if payload.priority is not None:
                if payload.priority < 1 or payload.priority > 10:
                    raise HTTPException(status_code=400, detail="优先级须为 1-10")
                if payload.priority != old["priority"]:
                    updates["priority"] = payload.priority
                    changed["priority"] = [old["priority"], payload.priority]
            if payload.related_issues is not None:
                new_issues = [str(x or "").strip() for x in payload.related_issues if str(x or "").strip()]
                old_issues = old.get("related_issues") or []
                if isinstance(old_issues, str):
                    import json as _json
                    old_issues = _json.loads(old_issues)
                if new_issues != old_issues:
                    updates["related_issues"] = psycopg.types.json.Jsonb(new_issues)
                    changed["related_issues"] = [old_issues, new_issues]
            if payload.planned_date is not None:
                pd_val = None
                if payload.planned_date.strip():
                    try:
                        pd_val = datetime.strptime(payload.planned_date.strip(), "%Y-%m-%d").date()
                    except ValueError as exc:
                        raise HTTPException(status_code=400, detail="计划落地日期格式无效") from exc
                old_pd = old.get("planned_date")
                if pd_val != old_pd:
                    updates["planned_date"] = pd_val
                    changed["planned_date"] = [str(old_pd or ""), str(pd_val or "")]
            from_status = None
            to_status = None
            if payload.status is not None:
                new_status = payload.status.strip()
                old_status = str(old.get("status", "") or "").strip()
                if new_status != old_status:
                    if new_status not in REQUIREMENT_STATUSES:
                        raise HTTPException(status_code=400, detail=f"无效状态: {new_status}")
                    forward = REQUIREMENT_STATUS_FORWARD.get(old_status)
                    backward = REQUIREMENT_STATUS_BACKWARD.get(old_status)
                    if new_status != forward and new_status != backward:
                        raise HTTPException(
                            status_code=400,
                            detail=f"不允许从「{old_status}」变更为「{new_status}」，仅允许正向流转或回退一步",
                        )
                    updates["status"] = new_status
                    from_status = old_status
                    to_status = new_status
            if not updates:
                conn.rollback()
                return dict(old)
            set_parts = [f"{k} = %s" for k in updates]
            set_parts.append("updated_at = NOW()")
            vals = list(updates.values())
            vals.append(req_id)
            conn.execute(
                f"UPDATE requirement SET {', '.join(set_parts)} WHERE id = %s",
                tuple(vals),
            )
            operator_disp = _display_name_account(conn, op)
            action = "status_changed" if to_status else "updated"
            conn.execute(
                """
                INSERT INTO requirement_log (requirement_id, action, from_status, to_status, changed_fields, operator_id, operator_name, comment)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                """,
                (
                    req_id,
                    action,
                    from_status,
                    to_status,
                    psycopg.types.json.Jsonb(changed) if changed else None,
                    op,
                    operator_disp,
                    payload.comment.strip(),
                ),
            )
            conn.commit()
            new_row = conn.execute("SELECT * FROM requirement WHERE id = %s", (req_id,)).fetchone()
            return dict(new_row)
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc


@app.get("/api/requirements/{req_id:int}/logs")
def get_requirement_logs(req_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, action, from_status, to_status, changed_fields, comment,
                       operator_id, operator_name, created_at
                FROM requirement_log
                WHERE requirement_id = %s
                ORDER BY created_at DESC
                """,
                (req_id,),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {"items": rows}


@app.delete("/api/requirements/{req_id:int}")
def delete_requirement(req_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT * FROM requirement WHERE id = %s FOR UPDATE", (req_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="需求不存在")
            if str(row["status"] or "").strip() != "待分析":
                raise HTTPException(status_code=400, detail="仅「待分析」状态的需求可删除")
            if str(row["creator_id"] or "").strip() != op:
                raise HTTPException(status_code=403, detail="仅创建人可删除需求")
            conn.execute("DELETE FROM requirement WHERE id = %s", (req_id,))
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    return {"ok": True}


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
"""


class AiConversationCreatePayload(BaseModel):
    operator_id: str = "demo_001"
    title: str = "新对话"


class AiConversationPatchPayload(BaseModel):
    operator_id: str = "demo_001"
    title: str


class AiChatPayload(BaseModel):
    operator_id: str = "demo_001"
    content: str


class AiQuickTemplateCreatePayload(BaseModel):
    operator_id: str = "demo_001"
    question: str


class AiQuickTemplatePatchPayload(BaseModel):
    operator_id: str = "demo_001"
    question: str


class LlmConfigPutPayload(BaseModel):
    operator_id: str = "admin"
    items: list[dict[str, str]] = Field(default_factory=list)


class AiUserLlmConfigPutPayload(BaseModel):
    operator_id: str = "demo_001"
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    query_timeout: Optional[int] = None
    max_react_rounds: Optional[int] = None
    max_result_rows: Optional[int] = None


class LlmTestPayload(BaseModel):
    operator_id: str = "demo_001"


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


async def _call_llm(api_base_url: str, api_key: str, model: str, messages: list[dict[str, str]], max_tokens: int, temperature: float) -> str:
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
        return str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


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

    if not api_key:
        raise HTTPException(status_code=400, detail="未配置大模型 API Key，请在参数配置→大模型配置中配置，或在智能助手中配置个人模型")

    schema_text = _build_db_schema_text(schema_info)
    messages = _build_react_messages(list(prev_messages), system_prompt, schema_text)

    react_steps: list[dict[str, Any]] = []
    last_sql: str | None = None
    last_query_result: list[dict[str, Any]] | None = None
    final_answer = ""
    total_prompt_tokens = 0
    total_completion_tokens = 0

    for round_i in range(max_react_rounds):
        try:
            llm_text = await _call_llm(api_base_url, api_key, model, messages, max_tokens, temperature)
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

    return {"role": "assistant", "content": final_answer, "react_steps": react_steps, "sql_query": last_sql, "query_result": last_query_result}


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


@app.get("/api/params/llm-config")
def get_llm_config(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        try:
            rows = conn.execute("SELECT key, value, value_type, description, updated_by, updated_at FROM param_llm_config ORDER BY key").fetchall()
        except UndefinedTable:
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
    items = []
    for r in rows:
        item = dict(r)
        if str(r["key"]) == "llm_api_key":
            item["value"] = _mask_api_key(str(r["value"]))
        items.append(item)
    return {"items": items}


@app.put("/api/params/llm-config")
def put_llm_config(payload: LlmConfigPutPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "admin"
    items = payload.items or []
    with db_conn() as conn:
        role, _ = _get_user_role(conn, op)
        if role != "管理员":
            raise HTTPException(status_code=403, detail="仅管理员可配置系统大模型")
        for it in items:
            key = str(it.get("key") or "").strip()
            val = str(it.get("value") or "").strip()
            if not key:
                continue
            if key == "llm_enabled" and val not in ("true", "false"):
                raise HTTPException(status_code=400, detail="llm_enabled 仅允许 true/false")
            if key == "llm_api_key":
                if val and "****" in val:
                    continue
            conn.execute(
                """
                INSERT INTO param_llm_config (key, value, value_type, description, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                """,
                (key, val, str(it.get("value_type") or "string"), str(it.get("description") or ""), op),
            )
        conn.commit()
        rows = conn.execute("SELECT key, value, value_type, description, updated_by, updated_at FROM param_llm_config ORDER BY key").fetchall()
    result_items = []
    for r in rows:
        item = dict(r)
        if str(r["key"]) == "llm_api_key":
            item["value"] = _mask_api_key(str(r["value"]))
        result_items.append(item)
    return {"ok": True, "items": result_items}


@app.post("/api/params/llm-config/test")
async def test_llm_config(payload: LlmTestPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    with db_conn() as conn:
        try:
            resolved = _resolve_llm_config(conn, op)
        except UndefinedTable:
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
    api_base_url = str(resolved.get("llm_api_base_url", ""))
    api_key = str(resolved.get("llm_api_key", ""))
    model = str(resolved.get("llm_model", "gpt-4o"))
    if not api_key:
        return {"ok": False, "detail": "API Key 未配置"}
    try:
        resp_text = await _call_llm(api_base_url, api_key, model, [{"role": "user", "content": "Hi, reply with OK"}], 16, 0.0)
        return {"ok": True, "detail": f"连通成功，模型回复：{resp_text[:100]}"}
    except Exception as exc:
        return {"ok": False, "detail": f"连通失败：{str(exc)[:300]}"}


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
        for f in ("api_base_url", "api_key", "model", "max_tokens", "temperature", "system_prompt", "query_timeout", "max_react_rounds", "max_result_rows"):
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
