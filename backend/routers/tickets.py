from __future__ import annotations
import json
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
from hotpatch_config import HOTPATCH_TEMPLATE_CODE
from hotpatch_list_columns import HOTPATCH_LIST_COLUMN_KEYS, HOTPATCH_RICHTEXT_COLUMN_KEYS
from hotpatch_flow import (
    adjust_hotpatch_submit,
    ensure_hotpatch_frontier,
    hotpatch_frontier_handlers_display,
    hotpatch_frontier_stage_labels,
    load_flow_context,
    resolve_hotpatch_next_node_key,
    sync_hotpatch_frontier_after_submit,
    template_code_for_ticket,
)
from models import SubmitPayload, TicketsBulkDeletePayload
from utils.person_options import (
    person_whitelist_options_are_placeholder_only as _person_whitelist_options_are_placeholder_only,
    resolve_person_field_options,
)
from utils import (
    _YW_TICKET_NO_RE,
    _HPM_TICKET_NO_RE,
    _YW_ADVISORY_LOCK_KEY1,
    _YW_ADVISORY_LOCK_KEY2,
    _CHINA_TZ,
    allocate_yw_ticket_no as _allocate_yw_ticket_no,
    allocate_hpm_ticket_no as _allocate_hpm_ticket_no,
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


def _values_json_as_dict(raw: Any) -> dict[str, Any]:
    """ticket_node_data.values_json：驱动可能返回 dict 或 JSON 字符串。"""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


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


# 所有可选列字段（用于工作台列选择功能）
# 从 frontend/modules/constants/export-fields.js EXPORT_FIELDS_BY_NODE 提取
ALL_LIST_COLUMN_KEYS: set[str] = {
    # problem_fill
    "start_date", "location", "biz_env", "severity", "component", "product_line",
    "ecare_ticket_no", "hcs_owner", "issue_desc",
    # problem_review
    "handle_mode", "issue_type_judge", "next_handler", "close_reason",
    # ops_analysis
    "issue_intro_module", "issue_owner_module", "issue_type", "product_line",
    "root_cause_category", "event_level", "customer_voice", "gauss_version",
    "deploy_mode", "kernel_upgrade_involved", "kernel_upgrade_time",
    "upgrade_baseline_version", "control_version", "upgrade_status",
    "error_text", "issue_track", "has_coredump_file", "has_core_stack",
    "core_stack_text", "is_consult_issue", "use_doer_assist", "doer_no_help_reason",
    # dev_analysis
    "front_pass_through", "version_pass_through", "is_quality_issue",
    "dts_no", "version_pass_reason", "is_consult_issue", "rock_version_involved",
    "collaborator", "workaround", "root_cause", "dfx_gap", "error_archive_text",
    # dev_closure
    "warning_needed", "impact_level", "sla_analysis",
    # ops_closure
    "fault_recovery_involved", "fault_to_recovery_duration",
    # audit_close (字段已在其他节点定义)
}

# richtext 类型字段（需要去除 HTML 标签截断显示）
RICHTEXT_COLUMN_KEYS: set[str] = {
    "issue_desc", "issue_track", "workaround", "root_cause", "dfx_gap", "sla_analysis",
} | set(HOTPATCH_RICHTEXT_COLUMN_KEYS)

# 列表列选择与 _fields_by_node 快照：HCS + 热补丁字段并集
LIST_COLUMN_FIELD_KEYS: set[str] = ALL_LIST_COLUMN_KEYS | set(HOTPATCH_LIST_COLUMN_KEYS)


def _list_field_snapshot(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """提取工单列表所需字段快照。

    返回包含：
    - 基础 scalar_keys 字段（用于列表默认列）
    - _description_raw（问题描述）
    - _last_submit_next_handler（当前处理人）
    - _all_fields（所有可选列字段，用于列选择功能，继承规则）
    - _fields_by_node（按节点分开的字段值，用于同 key 不同节点显示）
    """
    if not rows:
        return {}

    # 按 created_at 升序排列（用于字段继承规则：最后出现的节点为准）
    sorted_rows = sorted(rows, key=lambda r: r["created_at"])

    # 基础字段（保持原有逻辑）
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
        v = _values_json_as_dict(row.get("values_json"))
        for key in scalar_keys:
            val = v.get(key)
            if val is None:
                continue
            s = str(val).strip()
            if s:
                out[key] = s  # 直接覆盖，取最后出现的值（符合字段继承规则）

    # 扩展：提取所有可选列字段（继承规则：最后出现的节点为准）
    # 遍历所有行，每个字段取最后出现的值
    all_field_values: dict[str, Any] = {}
    for row in sorted_rows:
        v = _values_json_as_dict(row.get("values_json"))
        for key in LIST_COLUMN_FIELD_KEYS:
            val = v.get(key)
            if val is not None and val != "":
                all_field_values[key] = val

    # 新增：按节点分开的字段值（用于同 key 不同节点显示）
    fields_by_node: dict[str, dict[str, Any]] = {}
    for row in sorted_rows:
        v = _values_json_as_dict(row.get("values_json"))
        node_key = str(row.get("node_key") or "")
        if not node_key:
            continue
        if node_key not in fields_by_node:
            fields_by_node[node_key] = {}
        for key in LIST_COLUMN_FIELD_KEYS:
            val = v.get(key)
            if val is not None and val != "":
                fields_by_node[node_key][key] = val

    # description 提取（保持原有逻辑）
    desc_raw = ""
    for row in sorted_rows:
        v = _values_json_as_dict(row.get("values_json"))
        for dk in ("issue_desc", "problem_desc", "description"):
            s = str(v.get(dk) or "").strip()
            if s:
                desc_raw = s
                break
        if desc_raw:
            break
    out["_description_raw"] = desc_raw

    # next_handler：从时间倒序找「最近一条非空 next_handler」。
    # 仅看最新一条会在末条无 next_handler（如关闭节点）时丢失更早的待办处理人。
    nh = ""
    for row in reversed(sorted_rows):
        nv = _values_json_as_dict(row.get("values_json"))
        cand = str(nv.get("next_handler") or "").strip()
        if cand:
            nh = cand
            break
    if nh:
        out["_last_submit_next_handler"] = nh

    # 将所有字段值存入 _all_fields
    out["_all_fields"] = all_field_values
    # 将按节点分开的字段值存入 _fields_by_node
    out["_fields_by_node"] = fields_by_node

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


_WHITELIST_NODE_KEY = "__whitelist__"


def _role_field_permission_level(conn: psycopg.Connection, operator_id: str, field_key: str) -> str:
    acc = str(operator_id or "").strip() or "demo_001"
    row = conn.execute(
        "SELECT role_code, is_pl FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    if not row or not str(row.get("role_code") or "").strip():
        return "hidden"
    pr = conn.execute(
        """
        SELECT permission_level
        FROM role_permission_policy
        WHERE role_code = %s AND is_pl = %s AND node_key = %s AND field_key = %s
        LIMIT 1
        """,
        (str(row["role_code"]), bool(row.get("is_pl")), _WHITELIST_NODE_KEY, field_key),
    ).fetchone()
    return str((pr or {}).get("permission_level") or "").strip() or "hidden"


def _workbench_delete_allowed(conn: psycopg.Connection, operator_id: str) -> bool:
    """与前端 workbench_delete 白名单对齐：显式 hidden 则拒绝；未配置则允许（前端缺省为 readonly）。"""
    return _role_field_permission_level(conn, operator_id, "workbench_delete") != "hidden"


def _patch_manage_delete_allowed(conn: psycopg.Connection, operator_id: str) -> bool:
    """补丁管理批量删：显式 hidden 拒绝；库中无该行时与前端 getWhitelistLevel 缺省只读一致，允许删除。"""
    acc = str(operator_id or "").strip() or "demo_001"
    row = conn.execute(
        "SELECT role_code, is_pl FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    if not row or not str(row.get("role_code") or "").strip():
        return False
    pr = conn.execute(
        """
        SELECT permission_level
        FROM role_permission_policy
        WHERE role_code = %s AND is_pl = %s AND node_key = %s AND field_key = %s
        LIMIT 1
        """,
        (str(row["role_code"]), bool(row.get("is_pl")), _WHITELIST_NODE_KEY, "patch_manage_delete"),
    ).fetchone()
    if pr is None:
        return True
    return str((pr or {}).get("permission_level") or "").strip() != "hidden"


def _load_schema(conn: psycopg.Connection, node_key: str, template_code: str = SCHEMA_TEMPLATE_CODE) -> list[dict[str, Any]]:
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
        (template_code, node_key),
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

    user_person_options_cache: list[str] | None = None

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
            options, user_person_options_cache = resolve_person_field_options(
                conn,
                str(row["key"]),
                st,
                options,
                user_person_options_cache,
            )
            field["options"] = options if options else ["temp"]
        else:
            cdict = field.get("constraints") or {}
            st_opts = cdict.get("static_options")
            if row["type"] == "whitelist" and isinstance(st_opts, list) and st_opts:
                field["options"] = [str(x) for x in st_opts]
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
    template_code: str = SCHEMA_TEMPLATE_CODE,
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

    pending = [k for k in inheritable_keys if k not in values or values.get(k) in (None, "")]
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
        (template_code, node_key),
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
        (ticket_no, template_code, int(node_row["node_order"])),
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


def _validate_one(field: dict[str, Any], value: Any, ctx_values: dict[str, Any] | None = None) -> str | None:
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
            if _person_whitelist_options_are_placeholder_only(options):
                return None
            allowed = {_canonical_person_display(str(o)) for o in options}
            if _canonical_person_display(value) in allowed:
                return None
            return f"{key} must be one of {options}"
        if value in options:
            return None
        return f"{key} must be one of {options}"

    return f"{key} has unsupported field type {field_type}"


def _get_or_create_ticket(
    conn: psycopg.Connection,
    ticket_no: str,
    operator_id: str,
    operator_name: str,
    initial_node_key: str = SCHEMA_NODE_KEY,
    template_code: str | None = None,
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

    tmpl_code = str(template_code or "").strip() or SCHEMA_TEMPLATE_CODE
    tmpl = conn.execute(
        "SELECT id FROM workflow_template WHERE template_code = %s",
        (tmpl_code,),
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

    is_hotpatch_tpl = tmpl_code == HOTPATCH_TEMPLATE_CODE
    final_no = str(ticket_no or "").strip()
    if is_hotpatch_tpl:
        if not (_HPM_TICKET_NO_RE.match(final_no) or _YW_TICKET_NO_RE.match(final_no)):
            final_no = _allocate_hpm_ticket_no(conn)
    elif not _YW_TICKET_NO_RE.match(final_no):
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
            final_no = _allocate_hpm_ticket_no(conn) if is_hotpatch_tpl else _allocate_yw_ticket_no(conn)
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
    from leave_duty_effect import sync_leave_duty_status
    from utils import parse_last_accept_at as _parse_last_accept_at

    sync_leave_duty_status(conn)
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
    template_code: str = Query(
        SCHEMA_TEMPLATE_CODE,
        description="流程模板编码，如 HCS_INCIDENT、HOTPATCH；工作台默认 HCS_INCIDENT",
    ),
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
        tpl = str(template_code or "").strip() or SCHEMA_TEMPLATE_CODE
        sql_params_tpl = list(sql_params) + [tpl]
        rows = conn.execute(
            f"""
            SELECT
              t.id AS ticket_internal_id,
              t.ticket_no AS order_id,
              COALESCE(t.status, 'open') AS status,
              COALESCE(t.creator_name, '') AS creator_name,
              COALESCE(t.creator_id, '') AS creator_id,
              COALESCE(wn.node_key, '') AS node_key,
              COALESCE(wtt.template_code, '') AS template_code,
              t.flow_context AS flow_context,
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
            JOIN workflow_template wtt ON wtt.id = t.template_id
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(
                (
                  SELECT NULLIF(TRIM(tni.handler_name), '')
                  FROM ticket_node_instance tni
                  WHERE tni.ticket_id = t.id AND tni.node_id = t.current_node_id
                  ORDER BY tni.id DESC
                  LIMIT 1
                ),
                (
                  SELECT NULLIF(TRIM(tni2.handler_name), '')
                  FROM ticket_node_instance tni2
                  WHERE tni2.ticket_id = t.id
                  ORDER BY tni2.id DESC
                  LIMIT 1
                )
              ) AS handler_name
            ) cur_hand ON TRUE
            WHERE {where_sql} AND wtt.template_code = %s
            ORDER BY t.created_at DESC, t.id DESC
            """,
            tuple(sql_params_tpl),
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
                SELECT tnd.ticket_id, tnd.values_json, tnd.created_at,
                       COALESCE(tnd.schema_snapshot->>'node_key', '') AS node_key
                FROM ticket_node_data tnd
                WHERE tnd.ticket_id = ANY(%s)
                ORDER BY tnd.ticket_id, tnd.created_at ASC
                """,
                (ids,),
            ).fetchall()
            for nr in nd_rows:
                tid = int(nr["ticket_id"])
                by_ticket[tid].append(
                    {"values_json": nr["values_json"], "created_at": nr["created_at"], "node_key": nr["node_key"]}
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
            start_date = (
                str(snap.get("start_date") or snap.get("fill_date") or "").strip() or created_day
            )
            location = str(snap.get("location") or "").strip()
            biz_env = str(snap.get("biz_env") or "").strip()
            is_quality_issue = str(snap.get("is_quality_issue") or "").strip()
            # 列表「流程 ID」与 ticket_no 一致；勿用节点 JSON 里的 process_flow_id 等盖住单号（热补丁常见 YW 占位）。
            process_id = str(row["order_id"])
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
                if not handler_display:
                    # 库内仅有 creator_id、姓名为空时，列表「当前处理人」与待处理匹配依赖账号
                    handler_display = str(row.get("creator_id") or "").strip()
            display_stage = str(row["current_stage"] or "-")
            hotpatch_frontier_keys: list[str] | None = None
            hotpatch_parallel_handlers: dict[str, str] = {}
            if str(row.get("template_code") or "") == HOTPATCH_TEMPLATE_CODE and status_lower != "closed":
                ensure_hotpatch_frontier(conn, tid)
                fc_live = load_flow_context(conn, tid) or {}
                ph_live = fc_live.get("parallel_handlers") if isinstance(fc_live.get("parallel_handlers"), dict) else {}
                hotpatch_parallel_handlers = {str(k): str(v) for k, v in ph_live.items() if str(k).strip()}
                fr_live = fc_live.get("frontier") if isinstance(fc_live.get("frontier"), list) else []
                if len(fr_live) > 1:
                    lbl = hotpatch_frontier_stage_labels(fr_live)
                    if lbl:
                        display_stage = lbl
                    hb = hotpatch_frontier_handlers_display(fc_live, snap.get("_fields_by_node") or {}, fr_live)
                    if hb:
                        handler_display = hb
                    hotpatch_frontier_keys = fr_live
                elif len(fr_live) == 1:
                    hotpatch_frontier_keys = fr_live
            created_raw = row["ticket_created_at"]
            if created_raw is not None and hasattr(created_raw, "isoformat"):
                created_at_str = created_raw.isoformat()
            else:
                created_at_str = str(created_raw or "")
    
            # 获取所有可选列字段值
            all_fields = snap.get("_all_fields") or {}
            # 构建扩展字段字典（richtext 字段需要去除 HTML 标签截断）
            extra_fields: dict[str, Any] = {}
            for k, v in all_fields.items():
                if k in RICHTEXT_COLUMN_KEYS:
                    extra_fields[k] = _strip_html_list_preview(str(v or ""), 200)
                else:
                    extra_fields[k] = str(v or "").strip()
    
            item_body: dict[str, Any] = {
                    "orderId": str(row["order_id"]),
                    "status": str(row["status"] or "open"),
                    "node_key": str(row["node_key"] or ""),
                    "templateCode": str(row.get("template_code") or ""),
                    "processId": process_id,
                    "currentStage": display_stage,
                    "startDate": start_date,
                    "location": location,
                    "bizEnv": biz_env,
                    "isQualityIssue": is_quality_issue,
                    "is_quality_issue": is_quality_issue,
                    "currentHandler": handler_display,
                    "severity": sev,
                    "description": desc_plain,
                    "node": display_stage,
                    "assignee": handler_display,
                    "creatorName": str(row["creator_name"] or ""),
                    "creatorId": str(row["creator_id"] or ""),
                    "createdAt": created_at_str,
                    "operatorSubmitted": tid in submitted_ids,
                    # 扩展字段（用于列选择功能）
                    **extra_fields,
                    # 保存 snap 用于搜索匹配全部节点字段
                    "_snap": snap,
                    # 按节点分开的字段值（用于同 key 不同节点显示）
                    "_fieldsByNode": snap.get("_fields_by_node") or {},
            }
            if hotpatch_frontier_keys is not None:
                item_body["hotpatchFrontierKeys"] = hotpatch_frontier_keys
            if str(row.get("template_code") or "") == HOTPATCH_TEMPLATE_CODE and status_lower != "closed":
                item_body["hotpatchParallelHandlers"] = hotpatch_parallel_handlers
            items.append(item_body)
        # 搜索过滤：匹配全部文本字段（87个字段）
        if kw:
            # 从各节点的 values_json 中提取的全部可搜索字段 keys
            ALL_SEARCH_KEYS = [
                # 系统字段 / 列表基础字段
                "orderId", "processId", "currentStage", "currentHandler", "startDate",
                "severity", "location", "bizEnv", "creatorName", "description", "status",
                # problem_fill 字段
                "start_date", "location", "biz_env", "severity", "component", "product_line",
                "hcs_version", "hcs_mode", "ecare_ticket_no", "hcs_owner", "issue_desc",
                # problem_review 字段
                "handle_mode", "issue_type_judge", "next_handler", "close_reason",
                # ops_analysis 字段
                "issue_intro_module", "issue_owner_module", "issue_type", "product_line",
                "root_cause_category", "event_level", "customer_voice", "gauss_version",
                "deploy_mode", "kernel_upgrade_involved", "kernel_upgrade_time",
                "upgrade_baseline_version", "control_version", "upgrade_status",
                "error_text", "issue_track", "has_coredump_file", "has_core_stack",
                "core_stack_text", "is_consult_issue", "use_doer_assist", "doer_no_help_reason",
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


@router.post("/bulk-delete")
def bulk_delete_tickets(payload: TicketsBulkDeletePayload) -> dict[str, Any]:
    """从数据库删除工单（子表 ON DELETE CASCADE）。HOTPATCH 须 patch_manage_delete 非 hidden，HCS_INCIDENT 须 workbench_delete 非 hidden；可选仅删本人创建。"""
    op = str(payload.operator_id or "").strip() or "demo_001"
    raw_nos = [str(x or "").strip() for x in (payload.ticket_nos or []) if str(x or "").strip()]
    if not raw_nos:
        raise HTTPException(status_code=400, detail="ticket_nos 不能为空")
    # 去重且保持稳定顺序
    seen: set[str] = set()
    nos: list[str] = []
    for n in raw_nos:
        if n in seen:
            continue
        seen.add(n)
        nos.append(n)
    tpl = str(payload.template_code or "").strip() or SCHEMA_TEMPLATE_CODE
    with db_conn() as conn:
        if tpl == HOTPATCH_TEMPLATE_CODE:
            if not _patch_manage_delete_allowed(conn, op):
                raise HTTPException(status_code=403, detail="无删除权限（patch_manage_delete）")
        else:
            if not _workbench_delete_allowed(conn, op):
                raise HTTPException(status_code=403, detail="无删除权限（workbench_delete）")
        flags = _get_whitelist_flags(conn, op)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        present_rows = conn.execute(
            "SELECT ticket_no FROM ticket WHERE ticket_no = ANY(%s)",
            (nos,),
        ).fetchall()
        in_db = {str(r["ticket_no"]) for r in present_rows}
        absent = [n for n in nos if n not in in_db]
        cur = conn.execute(
            """
            DELETE FROM ticket t
            USING workflow_template wtt
            WHERE t.template_id = wtt.id
              AND t.ticket_no = ANY(%s)
              AND wtt.template_code = %s
              AND (%s = FALSE OR t.creator_id = %s)
            RETURNING t.ticket_no
            """,
            (nos, tpl, only_self, op),
        )
        deleted_rows = cur.fetchall()
        conn.commit()
    deleted = [str(r["ticket_no"]) for r in deleted_rows]
    return {"ok": True, "deleted": deleted, "absent": absent}


@router.get("/{ticket_id}/nodes/{node_key}/data")
def get_node_data(ticket_id: str, node_key: str, operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
            raise HTTPException(status_code=403, detail="仅可查看问题填写节点")
        tid_row = conn.execute("SELECT t.id FROM ticket t WHERE t.ticket_no = %s", (ticket_id,)).fetchone()
        if not tid_row:
            raise HTTPException(status_code=404, detail="ticket not found")
        tmpl = template_code_for_ticket(conn, int(tid_row["id"]))
        fields = _load_schema(conn, node_key, tmpl)
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
        values = _merge_inherited_previous_values(conn, ticket_id, node_key, fields, values, template_code=tmpl)
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
            SELECT t.id, t.ticket_no, t.status, t.current_node_id, t.flow_context,
                   wn.node_key, wn.node_name,
                   COALESCE(wt.template_code, '') AS template_code
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            JOIN workflow_template wt ON wt.id = t.template_id
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
    fc = row.get("flow_context")
    if hasattr(fc, "data"):
        fc = fc.data
    return {
        "ticket_id": ticket_id,
        "ticket_internal_id": row["id"],
        "status": row["status"],
        "template_code": str(row.get("template_code") or ""),
        "flow_context": fc if isinstance(fc, dict) else None,
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
        exists_row = conn.execute("SELECT id FROM ticket WHERE ticket_no = %s", (ticket_id,)).fetchone()
        if exists_row:
            tmpl_code = template_code_for_ticket(conn, int(exists_row["id"]))
        else:
            tc = str(payload.template_code or "").strip()
            tmpl_code = HOTPATCH_TEMPLATE_CODE if tc == HOTPATCH_TEMPLATE_CODE else SCHEMA_TEMPLATE_CODE
        fields = _load_schema(conn, node_key, tmpl_code)

        login_user = _canonical_person_display(f"{payload.operator_id} {payload.operator_name}")
        resolved: dict[str, Any] = dict(payload.values)
        for field in fields:
            key = field["key"]
            v = _apply_default(field, resolved, login_user)
            if key in payload.values and payload.values[key] not in (None, ""):
                v = payload.values[key]
            resolved[key] = v

        resolved = _merge_inherited_previous_values(conn, ticket_id, node_key, fields, resolved, template_code=tmpl_code)

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
            err = _validate_one(field_for_val, value, resolved)
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
        create_tpl: str | None = None
        if not exists_row and str(payload.template_code or "").strip() == HOTPATCH_TEMPLATE_CODE:
            create_tpl = HOTPATCH_TEMPLATE_CODE
        ticket = _get_or_create_ticket(
            conn, ticket_id, payload.operator_id, payload.operator_name, node_key, template_code=create_tpl
        )
        tmpl_code = template_code_for_ticket(conn, int(ticket["id"]))
        if tmpl_code == HOTPATCH_TEMPLATE_CODE:
            ensure_hotpatch_frontier(conn, int(ticket["id"]))
            fc_guard = load_flow_context(conn, int(ticket["id"])) or {}
            fr_guard = fc_guard.get("frontier") if isinstance(fc_guard.get("frontier"), list) else []
            if fr_guard and node_key not in fr_guard:
                raise HTTPException(status_code=403, detail="当前工单并行待办不包含该节点，无法从此节点提交")
        node = conn.execute(
            """
            SELECT wn.id
            FROM workflow_node wn
            JOIN workflow_template wt ON wt.id = wn.template_id
            WHERE wt.template_code = %s AND wn.node_key = %s
            """,
            (tmpl_code, node_key),
        ).fetchone()
        if not node:
            raise HTTPException(status_code=500, detail="workflow node missing")
        next_node = None
        hp_close_extra = False
        handle_mode = str(values.get("handle_mode") or resolved.get("handle_mode") or "").strip()
        if tmpl_code == HOTPATCH_TEMPLATE_CODE:
            expected_next_node_key = resolve_hotpatch_next_node_key(node_key, handle_mode)
        else:
            expected_next_node_key = _resolve_next_node_key(node_key, handle_mode)
        next_node_key = expected_next_node_key or str(payload.next_node_key or "").strip()
        if tmpl_code == HOTPATCH_TEMPLATE_CODE:
            seed_next = next_node_key or expected_next_node_key or ""
            next_node_key, _, hp_close_extra = adjust_hotpatch_submit(
                conn, int(ticket["id"]), node_key, handle_mode, seed_next, submit_values=values
            )
        if next_node_key:
            next_node = conn.execute(
                """
                SELECT wn.id
                FROM workflow_node wn
                JOIN workflow_template wt ON wt.id = wn.template_id
                WHERE wt.template_code = %s AND wn.node_key = %s
                LIMIT 1
                """,
                (tmpl_code, next_node_key),
            ).fetchone()
            if not next_node:
                raise HTTPException(status_code=400, detail=f"invalid next_node_key: {next_node_key}")
        if not expected_next_node_key and node_key not in ("problem_fill",):
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
        should_close = handle_mode in DIRECT_CLOSE_HANDLE_MODES or hp_close_extra
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
        hp_frontier_keys: list[str] = []
        hp_frontier_labels = ""
        if tmpl_code == HOTPATCH_TEMPLATE_CODE:
            fc_sync = load_flow_context(conn, int(ticket["id"])) or {}
            fc_sync = sync_hotpatch_frontier_after_submit(
                conn,
                int(ticket["id"]),
                fc_sync,
                node_key,
                handle_mode,
                str(next_node_key or ""),
                bool(should_close),
            )
            hp_frontier_keys = fc_sync.get("frontier") if isinstance(fc_sync.get("frontier"), list) else []
            hp_frontier_labels = hotpatch_frontier_stage_labels(hp_frontier_keys) if hp_frontier_keys else ""
        conn.commit()

        out: dict[str, Any] = {
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
        if tmpl_code == HOTPATCH_TEMPLATE_CODE:
            out["hotpatch_frontier_keys"] = hp_frontier_keys
            out["hotpatch_frontier_stage_labels"] = hp_frontier_labels
        return out


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
        # export-data API 用于导出指定工单的详细数据
        # 不应用工单列表权限过滤（ticket_list_only_self_created）
        # 因为用户已经通过列表 API 能看到这些工单，有权查看其详细数据
        # 查询工单基础信息
        rows = conn.execute(
            """
            SELECT t.id AS ticket_internal_id, t.ticket_no, t.creator_id, t.creator_name,
                   COALESCE(t.status, 'open') AS status, t.created_at
            FROM ticket t
            WHERE t.ticket_no = ANY(%s)
            ORDER BY t.created_at DESC
            """,
            (ticket_nos,),
        ).fetchall()
        if not rows:
            return {"items": []}

        ticket_ids = [int(r["ticket_internal_id"]) for r in rows]
        ticket_no_by_id = {int(r["ticket_internal_id"]): str(r["ticket_no"]) for r in rows}
        ticket_created_at_by_id = {int(r["ticket_internal_id"]): r["created_at"] for r in rows}

        # 查询工单关闭时间（从flow_log获取action_type='close'的记录）
        close_rows = conn.execute(
            """
            SELECT tfl.ticket_id, tfl.created_at AS closed_at
            FROM ticket_flow_log tfl
            WHERE tfl.ticket_id = ANY(%s) AND tfl.action_type = 'close'
            ORDER BY tfl.created_at DESC
            """,
            (ticket_ids,),
        ).fetchall()

        # 每个工单只取最后一次关闭时间（可能有多次关闭操作）
        ticket_closed_at_by_id = {}
        for cr in close_rows:
            tid = int(cr["ticket_id"])
            if tid not in ticket_closed_at_by_id:
                ticket_closed_at_by_id[tid] = cr["closed_at"]

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

        # 查询各阶段滞留时间数据（用于Doer效率统计）
        # 阶段节点key列表（不含problem_fill）
        stage_node_keys = [
            "problem_review", "ops_analysis", "dev_analysis",
            "dev_closure", "ops_closure", "audit_close"
        ]
        instance_rows = conn.execute(
            """
            SELECT tni.ticket_id, wn.node_key, tni.started_at, tni.ended_at
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.ticket_id = ANY(%s)
              AND wn.node_key = ANY(%s)
            ORDER BY tni.ticket_id, wn.node_key
            """,
            (ticket_ids, stage_node_keys),
        ).fetchall()

        # 计算滞留时间并按工单+节点聚合
        now_utc = datetime.now(timezone.utc)
        by_ticket_instance: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
        for ir in instance_rows:
            tid = int(ir["ticket_id"])
            nk = str(ir["node_key"])
            st = ir["started_at"]
            et = ir["ended_at"] if ir["ended_at"] else now_utc
            if st:
                hours = max(0.0, (et - st).total_seconds() / 3600.0)
                by_ticket_instance[tid][nk] = {
                    "started_at": st.isoformat() if st else None,
                    "ended_at": et.isoformat() if et else None,
                    "hours": round(hours, 2),
                }

        # 组装返回数据
        items = []
        for tid in ticket_ids:
            ticket_no = ticket_no_by_id.get(tid, "")
            nodes_data = by_ticket_node.get(tid, {})
            instances_data = by_ticket_instance.get(tid, {})
            created_at = ticket_created_at_by_id.get(tid)
            closed_at = ticket_closed_at_by_id.get(tid)
            items.append({
                "ticket_no": ticket_no,
                "nodes": nodes_data,
                "instances": instances_data,
                "created_at": created_at.isoformat() if created_at else None,
                "closed_at": closed_at.isoformat() if closed_at else None,
            })

    return {"items": items}