from __future__ import annotations
import json
import logging
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any
import psycopg
from psycopg.errors import UniqueViolation, UndefinedTable
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from config import (
    SCHEMA_TEMPLATE_CODE,
    SCHEMA_NODE_KEY,
    DIRECT_CLOSE_HANDLE_MODES,
    HANDLE_MODE_ROUTE,
    TICKET_LIST_SNAPSHOT_ENABLED,
    OPS_ANALYSIS_EXCLUDED_HANDLE_MODE_WHEN_QUALITY_YES,
    DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES,
    DEV_CLOSURE_DEFAULT_NEXT_HANDLER_FROM_NODE,
    ops_analysis_excludes_ops_closure,
    PERSON_VALUE_FIELD_KEYS,
    MULTI_PERSON_FIELD_KEYS,
    _DUTY_FIELD_OPTION_SET_CODES,
    _VERSION_BASELINE_OPTION_SET_CODES,
    _SITE_PROFILE_OPTION_SET_CODES,
    _FIX_VERSION_FIELD_KEY,
    _FIX_VERSION_UNFIXED_OPTION,
    _DUTY_FIELD_PATH_SEP,
    _COMPONENT_TO_KIND,
    _DUTY_STATUS_ON,
    _HOLIDAY_SCHEMA_HINT,
    NOTIFY_ON_ARRIVAL_NODE_KEYS,
    DOER_TICKET_DETAIL_API_KEY,
)
from database import db_conn
from routers.major_issue import maybe_sync_major_issue_after_ticket_field_change
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
from models import (
    AllocateTicketNoPayload,
    SubmitPayload,
    TicketsBulkDeletePayload,
    TicketSnapshotListQuery,
    TicketFacetsQuery,
)
from utils.person_options import resolve_person_field_options
from utils.ticket_status import (
    sql_ticket_list_current_stage,
    sql_ticket_status_is_closed,
    ticket_status_is_closed,
)
from utils.ticket_closed_at import closed_at_iso, fetch_ticket_closed_at_by_id
from utils.xiaoluban_message import (
    extract_account_from_person_display,
    send_ticket_notification,
    send_group_notification,
)
from utils.logging_config import audit_log, operator_log_label
from issue_root_cause_params import load_issue_root_cause_map, attach_issue_root_cause_to_field
from version_option_labels import fill_version_baseline_option_map
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
    canonical_multi_person_display as _canonical_multi_person_display,
    field_visible as _field_visible,
    matches_required_if as _base_matches_required_if,
    optional_when_all_matches as _base_optional_when_all_matches,
    optional_when_any_matches as _base_optional_when_any_matches,
    effective_required as _base_effective_required,
    parse_ymd as _parse_ymd,
    to_utc_start as _to_utc_start,
)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_LIST_CREATED_YMD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

logger = logging.getLogger(__name__)

# 已走过节点补录（amend）不得落库、不得参与当前处理人解析的流转字段
AMEND_EXCLUDED_FLOW_KEYS: frozenset[str] = frozenset(
    {
        "handle_mode",
        "next_handler",
        "close_reason",
        "issue_type_judge",
    }
)


def _node_data_row_is_amend(row: dict[str, Any]) -> bool:
    if str(row.get("amended") or "").strip().lower() in ("true", "1", "yes"):
        return True
    snap = row.get("schema_snapshot")
    if isinstance(snap, dict) and snap.get("amended"):
        return True
    return False


def _node_data_row_is_draft(row: dict[str, Any]) -> bool:
    if str(row.get("draft") or "").strip().lower() in ("true", "1", "yes"):
        return True
    snap = row.get("schema_snapshot")
    if isinstance(snap, dict) and snap.get("draft"):
        return True
    return False


def _node_data_row_is_non_flow_submit(row: dict[str, Any]) -> bool:
    return _node_data_row_is_amend(row) or _node_data_row_is_draft(row)


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
    "error_text", "issue_track", "has_core_stack",
    "core_stack_text", "is_consult_issue", "use_doer_assist", "doer_no_help_reason",
    "intro_version", "fix_version",
    # dev_analysis
    "front_pass_through", "version_pass_through", "is_quality_issue",
    "dts_no", "version_pass_reason", "is_consult_issue",
    "collaborator", "workaround", "root_cause", "dfx_gap", "error_archive_text",
    # intro_version / fix_version 同上（运维分析、开发分析共用 key）
    # dev_closure
    "warning_needed", "impact_level", "sla_analysis",
    # ops_closure
    "fault_recovery_involved", "fault_to_recovery_duration",
    "has_collaborator", "output_problem_report",
    # 不含 problem_report（文件上传，不进列表快照）
    # audit_close (字段已在其他节点定义)
}

# 与 frontend/modules/constants/export-fields.js 中 type=whitelist 的字段对齐
WHITELIST_LIST_COLUMN_KEYS: frozenset[str] = frozenset({
    "biz_env", "severity", "component", "product_line",
    "handle_mode", "issue_type_judge", "next_handler",
    "issue_intro_module", "issue_owner_module", "issue_type",
    "root_cause_category", "event_level", "customer_voice",
    "gauss_version", "deploy_mode", "kernel_upgrade_involved",
    "upgrade_baseline_version", "upgrade_status", "has_core_stack",
    "is_consult_issue", "is_quality_issue", "use_doer_assist",
    "intro_version", "fix_version", "front_pass_through",
    "version_pass_through", "collaborator", "warning_needed",
    "impact_level", "fault_recovery_involved",
    "has_collaborator", "output_problem_report",
})

# richtext 类型字段（需要去除 HTML 标签截断显示）
RICHTEXT_COLUMN_KEYS: set[str] = {
    "issue_desc", "issue_track", "workaround", "root_cause", "dfx_gap", "sla_analysis",
} | set(HOTPATCH_RICHTEXT_COLUMN_KEYS)

# 列表快照：富文本去 HTML 后的长度上限（纯文本）
SNAPSHOT_EXTRA_FIELDS_RICHTEXT_MAX = 200
SNAPSHOT_FIELDS_BY_NODE_RICHTEXT_MAX = 500
DEFAULT_SNAPSHOT_MERGE_RICHTEXT_MAX = 500
# 合并进 _all_fields 的上限（须 >= 对应 search_text 上限）
RICHTEXT_SNAPSHOT_MERGE_MAX_LEN: dict[str, int] = {"issue_track": 1000}
# 写入 ticket_list_snapshot.search_text 的富文本上限（列表预览仍 200）
DEFAULT_RICHTEXT_SEARCH_TEXT_MAX = 500
RICHTEXT_SEARCH_TEXT_MAX_LEN: dict[str, int] = {"issue_track": 1000}

# 列表列选择与 _fields_by_node 快照：HCS + 热补丁字段并集
LIST_COLUMN_FIELD_KEYS: set[str] = ALL_LIST_COLUMN_KEYS | set(HOTPATCH_LIST_COLUMN_KEYS)


def richtext_snapshot_merge_max_len(field_key: str) -> int:
    return RICHTEXT_SNAPSHOT_MERGE_MAX_LEN.get(field_key, DEFAULT_SNAPSHOT_MERGE_RICHTEXT_MAX)


def richtext_search_text_max_len(field_key: str) -> int:
    return RICHTEXT_SEARCH_TEXT_MAX_LEN.get(field_key, DEFAULT_RICHTEXT_SEARCH_TEXT_MAX)


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
                if key in RICHTEXT_COLUMN_KEYS:
                    val = _strip_html_list_preview(str(val), richtext_snapshot_merge_max_len(key))
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
                if key in RICHTEXT_COLUMN_KEYS:
                    val = _strip_html_list_preview(str(val), SNAPSHOT_FIELDS_BY_NODE_RICHTEXT_MAX)
                fields_by_node[node_key][key] = val

    # 问题描述：与继承字段一致，按节点提交顺序取最后一次非空（issue_desc / problem_desc / description）
    desc_raw = ""
    for row in sorted_rows:
        v = _values_json_as_dict(row.get("values_json"))
        for dk in ("issue_desc", "problem_desc", "description"):
            s = str(v.get(dk) or "").strip()
            if s:
                desc_raw = s
                break
    out["_description_raw"] = desc_raw

    # next_handler：从时间倒序找「最近一条非空 next_handler」。
    # 仅看最新一条会在末条无 next_handler（如关闭节点）时丢失更早的待办处理人。
    nh = ""
    for row in reversed(sorted_rows):
        if _node_data_row_is_non_flow_submit(row):
            continue
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
    from whitelist_policy import ticket_api_whitelist_flags

    return ticket_api_whitelist_flags(conn, operator_id)


_WHITELIST_NODE_KEY = "__whitelist__"


def _workbench_delete_allowed(conn: psycopg.Connection, operator_id: str) -> bool:
    from whitelist_policy import whitelist_delete_allowed

    return whitelist_delete_allowed(conn, operator_id, "workbench_delete")


def _workbench_migrate_allowed(conn: psycopg.Connection, operator_id: str) -> bool:
    from whitelist_policy import whitelist_delete_allowed

    return whitelist_delete_allowed(conn, operator_id, "workbench_migrate")


def _workbench_snapshot_rebuild_allowed(conn: psycopg.Connection, operator_id: str) -> bool:
    from whitelist_policy import whitelist_delete_allowed

    return whitelist_delete_allowed(conn, operator_id, "workbench_snapshot_rebuild")


def _check_workbench_export_permission(conn: psycopg.Connection, operator_id: str) -> None:
    from whitelist_policy import whitelist_field_levels, whitelist_permission_level

    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "workbench_export") == "hidden":
        raise HTTPException(status_code=403, detail="无导出权限")


def _patch_manage_delete_allowed(conn: psycopg.Connection, operator_id: str) -> bool:
    from whitelist_policy import whitelist_delete_allowed

    return whitelist_delete_allowed(conn, operator_id, "patch_manage_delete")


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
        option_map.update(fill_version_baseline_option_map(conn, external_codes))
    if external_codes & _SITE_PROFILE_OPTION_SET_CODES:
        try:
            site_rows = conn.execute(
                """
                SELECT site_name
                FROM site_profile
                WHERE site_name <> ''
                ORDER BY site_name
                """
            ).fetchall()
            site_names = _dedupe_preserve_str(
                [str(r.get("site_name") or "").strip() for r in site_rows if str(r.get("site_name") or "").strip()]
            )
        except UndefinedTable:
            site_names = []
        for code in external_codes & _SITE_PROFILE_OPTION_SET_CODES:
            option_map[code] = site_names

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
    issue_root_cause_map: dict[str, list[str]] = {}
    if node_key == "ops_analysis":
        try:
            issue_root_cause_map = load_issue_root_cause_map(conn)
        except Exception:
            issue_root_cause_map = {}

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
            if str(row["key"]) == _FIX_VERSION_FIELD_KEY:
                options = [_FIX_VERSION_UNFIXED_OPTION] + [o for o in options if o != _FIX_VERSION_UNFIXED_OPTION]
            field["options"] = options if options else ["temp"]
        else:
            cdict = field.get("constraints") or {}
            st_opts = cdict.get("static_options")
            if row["type"] == "whitelist" and isinstance(st_opts, list) and st_opts:
                field["options"] = [str(x) for x in st_opts]
        if issue_root_cause_map:
            attach_issue_root_cause_to_field(field, issue_root_cause_map)
        fields.append(field)

    return fields


def _duty_field_rows_to_tree(rows: list[Any]) -> list[dict[str, Any]]:
    by_parent: dict[Any, list[Any]] = defaultdict(list)
    for r in rows:
        by_parent[r["parent_id"]].append(r)
    for k in list(by_parent.keys()):
        by_parent[k].sort(key=lambda x: (int(x["sort_order"] or 0), int(x["id"] or 0)))

    def build(pid: Any, visiting: set[int] | None = None) -> list[dict[str, Any]]:
        visiting = visiting or set()
        out: list[dict[str, Any]] = []
        for r in by_parent.get(pid, []):
            rid = int(r["id"])
            if rid in visiting:
                continue
            visiting.add(rid)
            out.append(
                {
                    "id": rid,
                    "label": str(r["label"] or ""),
                    "children": build(rid, visiting),
                }
            )
            visiting.discard(rid)
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
    from utils.ticket_inherited_values import merge_inherited_previous_values

    return merge_inherited_previous_values(
        conn, ticket_no, node_key, fields, values, template_code=template_code
    )


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


def _normalize_person_field_value(field_key: str, raw: str) -> str:
    if field_key in MULTI_PERSON_FIELD_KEYS:
        return _canonical_multi_person_display(raw)
    return _canonical_person_display(raw)


def _apply_default(
    field: dict[str, Any],
    incoming: dict[str, Any],
    login_user: str,
    *,
    apply_login_user: bool = True,
) -> Any:
    key = field["key"]
    if key in incoming and incoming[key] not in (None, ""):
        return incoming[key]
    if field.get("default_type") == "today":
        return date.today().isoformat()
    if field.get("default_type") == "login_user":
        # 已有工单（含迁入缺提单人）勿用当前操作人填空；仅新建单套用
        if not apply_login_user:
            return incoming.get(key) if key in incoming else ""
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
        if not isinstance(value, str):
            return f"{key} must be string option"
        return None

    if field_type == "file":
        if not isinstance(value, str):
            return f"{key} must be file json string"
        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            return f"{key} must be valid file json"
        if not isinstance(payload, dict) or not str(payload.get("url") or "").strip():
            return f"{key} must include url"
        return None

    return f"{key} has unsupported field type {field_type}"


def _get_or_create_ticket(
    conn: psycopg.Connection,
    ticket_no: str,
    operator_id: str,
    operator_name: str,
    initial_node_key: str = SCHEMA_NODE_KEY,
    template_code: str | None = None,
    create_intent: bool = False,
) -> dict[str, Any]:
    requested_no = str(ticket_no or "").strip()
    tmpl_code = str(template_code or "").strip() or SCHEMA_TEMPLATE_CODE

    existing = conn.execute(
        """
        SELECT t.id, t.ticket_no, t.current_node_id, COALESCE(t.status, 'open') AS status
        FROM ticket t
        WHERE t.ticket_no = %s
        """,
        (requested_no,),
    ).fetchone()
    if existing and not create_intent:
        return existing

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

    # 会话级咨询锁：仅在取号/INSERT 期间互斥，取完即释放，避免整段 submit 阻塞其它建单导致网关 504。
    conn.execute(
        "SELECT pg_advisory_lock(%s, %s)",
        (_YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2),
    )
    try:
        if not create_intent:
            again = conn.execute(
                """
                SELECT t.id, t.ticket_no, t.current_node_id, COALESCE(t.status, 'open') AS status
                FROM ticket t
                WHERE t.ticket_no = %s
                """,
                (requested_no,),
            ).fetchone()
            if again:
                return again

        is_hotpatch_tpl = tmpl_code == HOTPATCH_TEMPLATE_CODE
        from utils.ticket_no import bump_global_suffix_at_least, parse_hpm_suffix, parse_yw_suffix

        if existing and create_intent:
            final_no = _allocate_hpm_ticket_no(conn) if is_hotpatch_tpl else _allocate_yw_ticket_no(conn)
        elif is_hotpatch_tpl:
            if not (_HPM_TICKET_NO_RE.match(requested_no) or _YW_TICKET_NO_RE.match(requested_no)):
                final_no = _allocate_hpm_ticket_no(conn)
            elif _ticket_no_taken_helper(conn, requested_no):
                final_no = _allocate_hpm_ticket_no(conn)
            else:
                final_no = requested_no
        elif not _YW_TICKET_NO_RE.match(requested_no):
            final_no = _allocate_yw_ticket_no(conn)
        elif _ticket_no_taken_helper(conn, requested_no):
            final_no = _allocate_yw_ticket_no(conn)
        else:
            final_no = requested_no

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
                suf = parse_hpm_suffix(final_no) if is_hotpatch_tpl else parse_yw_suffix(final_no)
                if suf is not None:
                    bump_global_suffix_at_least(conn, "HPM" if is_hotpatch_tpl else "YW", suf)
                return created
            except UniqueViolation:
                conn.execute("ROLLBACK TO SAVEPOINT yw_ticket_ins")
                final_no = _allocate_hpm_ticket_no(conn) if is_hotpatch_tpl else _allocate_yw_ticket_no(conn)
        raise HTTPException(status_code=500, detail="failed to allocate ticket_no")
    finally:
        conn.execute(
            "SELECT pg_advisory_unlock(%s, %s)",
            (_YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2),
        )


def _ticket_no_taken_helper(conn: psycopg.Connection, ticket_no: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM ticket WHERE ticket_no = %s", (ticket_no,)).fetchone())


def _refresh_ticket_list_snapshot_after_commit(ticket: dict[str, Any]) -> None:
    if not TICKET_LIST_SNAPSHOT_ENABLED:
        return
    try:
        with db_conn() as snap_conn:
            from ticket_list_snapshot import refresh_ticket_list_snapshot

            refresh_ticket_list_snapshot(snap_conn, int(ticket["id"]))
            snap_conn.commit()
    except UndefinedTable:
        logger.warning(
            "ticket_list_snapshot missing on submit ticket=%s; run migration 0079",
            ticket.get("ticket_no"),
        )


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


_PRODUCT_LINE_PUBLIC_CLOUD = "公有云"
_COMPONENT_KERNEL = "内核问题"
_BIZ_ENV_POC = "POC阶段"
_BIZ_ENV_RESEARCH_VERSION_PILOT = "在研版本试点"


def _normalize_product_line(v: Any) -> str:
    return str(v or "").strip()


def _normalize_biz_env(v: Any) -> str:
    return str(v or "").strip()


def _is_public_cloud_issue(values: dict[str, Any]) -> bool:
    return _normalize_product_line(values.get("product_line")) == _PRODUCT_LINE_PUBLIC_CLOUD


def _is_poc_stage_issue(values: dict[str, Any]) -> bool:
    return _normalize_biz_env(values.get("biz_env")) == _BIZ_ENV_POC


def _is_research_version_pilot_issue(values: dict[str, Any]) -> bool:
    return _normalize_biz_env(values.get("biz_env")) == _BIZ_ENV_RESEARCH_VERSION_PILOT


def _normalize_component(v: Any) -> str:
    comp = str(v or "").strip()
    if comp not in _COMPONENT_TO_KIND:
        raise HTTPException(status_code=400, detail="问题组件仅允许内核问题/管控问题")
    return comp


def _query_problem_fill_values(conn, ticket_no: str, template_code: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT tnd.values_json
        FROM ticket t
        JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE t.ticket_no = %s AND wn.node_key = 'problem_fill' AND wt.template_code = %s
        ORDER BY tnd.created_at DESC
        LIMIT 1
        """,
        (ticket_no, template_code),
    ).fetchone()
    if row and isinstance(row.get("values_json"), dict):
        return row["values_json"]
    return {}


def _query_latest_node_values(conn, ticket_no: str, node_key: str, template_code: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT tnd.values_json
        FROM ticket t
        JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE t.ticket_no = %s AND wn.node_key = %s AND wt.template_code = %s
        ORDER BY tnd.created_at DESC
        LIMIT 1
        """,
        (ticket_no, node_key, template_code),
    ).fetchone()
    return _values_json_as_dict(row["values_json"] if row else None)


def _ticket_node_allows_flow_submit(
    conn: psycopg.Connection,
    ticket: dict[str, Any],
    node_key: str,
    tmpl_code: str,
) -> bool:
    """仅当前节点（或热补丁并行 frontier）允许走流转提交。"""
    cur_row = conn.execute(
        "SELECT node_key FROM workflow_node WHERE id = %s",
        (ticket["current_node_id"],),
    ).fetchone()
    current_key = str(cur_row["node_key"] or "").strip() if cur_row else ""
    if node_key == current_key:
        return True
    if tmpl_code == HOTPATCH_TEMPLATE_CODE:
        fc = load_flow_context(conn, int(ticket["id"])) or {}
        frontier = fc.get("frontier") if isinstance(fc.get("frontier"), list) else []
        if node_key in frontier:
            return True
    return False


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


_ROTATION_LAST_ACCEPT_RESET = "2000-01-01 00:00:00"


def _set_all_rotation_last_accept_for_account(
    conn: psycopg.Connection, account: str, last_accept_at: str
) -> None:
    acct = str(account or "").strip()
    if not acct:
        return
    conn.execute(
        """
        UPDATE duty_rotation_entry
        SET last_accept_at = %s,
            updated_at = NOW()
        WHERE BTRIM(account) = %s
        """,
        (str(last_accept_at or "").strip(), acct),
    )


def _reset_all_rotation_last_accept_for_account(conn: psycopg.Connection, account: str) -> None:
    _set_all_rotation_last_accept_for_account(conn, account, _ROTATION_LAST_ACCEPT_RESET)


def _sync_all_rotation_last_accept_now_for_account(conn: psycopg.Connection, account: str) -> str:
    now_txt = datetime.now(_CHINA_TZ).strftime("%Y-%m-%d %H:%M:%S")
    _set_all_rotation_last_accept_for_account(conn, account, now_txt)
    return now_txt


def _ticket_arrived_at_cn(conn: psycopg.Connection, ticket_internal_id: int) -> datetime:
    row = conn.execute(
        """
        SELECT MIN(tfl.created_at) AS entered_at
        FROM ticket_flow_log tfl
        JOIN workflow_node wn ON wn.id = tfl.to_node_id
        WHERE tfl.ticket_id = %s AND wn.node_key = 'problem_review'
        """,
        (ticket_internal_id,),
    ).fetchone()
    entered_at = (row or {}).get("entered_at")
    if entered_at:
        if isinstance(entered_at, datetime):
            if entered_at.tzinfo is None:
                return entered_at.replace(tzinfo=timezone.utc).astimezone(_CHINA_TZ)
            return entered_at.astimezone(_CHINA_TZ)
    created_row = conn.execute(
        "SELECT created_at FROM ticket WHERE id = %s",
        (ticket_internal_id,),
    ).fetchone()
    created_at = (created_row or {}).get("created_at")
    if isinstance(created_at, datetime):
        if created_at.tzinfo is None:
            return created_at.replace(tzinfo=timezone.utc).astimezone(_CHINA_TZ)
        return created_at.astimezone(_CHINA_TZ)
    return datetime.now(_CHINA_TZ)


def _ticket_arrived_workday_day(conn: psycopg.Connection, ticket_internal_id: int) -> bool:
    arrived_cn = _ticket_arrived_at_cn(conn, ticket_internal_id)
    win, _, _ = _routing_window(conn, arrived_cn)
    return win == "workday_day"


def _maybe_sync_problem_review_transfer_rotation_fairness(
    conn: psycopg.Connection,
    *,
    ticket_internal_id: int,
    current_node_id: int,
    handle_mode: str,
    next_handler_display: str,
) -> None:
    """问题审核同节点转办：工作日白班到单的工单转给他人时，同步轮值表接单时间。"""
    if handle_mode not in ("提交其他运维审核", "提交专项轮值表"):
        return
    next_display = _canonical_person_display(str(next_handler_display or "").strip())
    if not next_display:
        return
    current_handler = _resolve_ticket_open_handler_display(conn, ticket_internal_id, current_node_id)
    current_account = extract_account_from_person_display(current_handler)
    next_account = extract_account_from_person_display(next_display)
    if not current_account or not next_account or current_account == next_account:
        return
    if not _ticket_arrived_workday_day(conn, ticket_internal_id):
        return
    _reset_all_rotation_last_accept_for_account(conn, current_account)
    _sync_all_rotation_last_accept_now_for_account(conn, next_account)


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
    roster = str(selected.get("roster_kind") or "")
    pos = int(selected.get("position") or 0)
    account = str(selected.get("account") or "").strip()
    conn.execute(
        """
        UPDATE duty_rotation_entry
        SET last_accept_at = %s,
            updated_at = NOW()
        WHERE roster_kind = %s AND position = %s
        """,
        (now_txt, roster, pos),
    )
    if account:
        _set_all_rotation_last_accept_for_account(conn, account, now_txt)
    conn.execute(
        """
        UPDATE duty_rotation_entry
        SET last_dispatch_at = NOW(),
            last_dispatch_ticket_no = %s,
            last_dispatch_node_key = %s,
            last_dispatch_rule = %s::jsonb,
            updated_at = NOW()
        WHERE roster_kind = %s AND position = %s
        """,
        (
            ticket_no,
            node_key,
            psycopg.types.json.Jsonb(rule_detail),
            roster,
            pos,
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


def _resolve_public_cloud_fill_handler(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    values: dict[str, Any],
    win: str,
    duty_date: date,
    shift: str,
) -> str:
    product_line = _normalize_product_line(values.get("product_line"))
    if win == "workday_day":
        roster_kind = "publicCloudRotation"
        detail = {
            "rule_stage": "problem_fill",
            "target_node": "problem_review",
            "window": win,
            "product_line": product_line,
            "source_table": "duty_rotation_entry",
            "roster_kind": roster_kind,
        }
        return _pick_rotation_handler(conn, roster_kind, ticket_no, node_key, detail)
    detail = {
        "rule_stage": "problem_fill",
        "target_node": "problem_review",
        "window": win,
        "product_line": product_line,
        "source_table": "duty_calendar_assignment",
        "table_kind": "public_cloud",
        "duty_date": duty_date.isoformat(),
        "shift": shift,
    }
    return _pick_calendar_handler(conn, "public_cloud", duty_date, shift, ticket_no, node_key, detail)


def _resolve_poc_fill_handler(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    values: dict[str, Any],
    win: str,
    duty_date: date,
    shift: str,
) -> str:
    biz_env = _normalize_biz_env(values.get("biz_env"))
    if win == "workday_day":
        roster_kind = "pocRotation"
        detail = {
            "rule_stage": "problem_fill",
            "target_node": "problem_review",
            "window": win,
            "biz_env": biz_env,
            "source_table": "duty_rotation_entry",
            "roster_kind": roster_kind,
        }
        return _pick_rotation_handler(conn, roster_kind, ticket_no, node_key, detail)
    detail = {
        "rule_stage": "problem_fill",
        "target_node": "problem_review",
        "window": win,
        "biz_env": biz_env,
        "source_table": "duty_calendar_assignment",
        "table_kind": "poc",
        "duty_date": duty_date.isoformat(),
        "shift": shift,
    }
    return _pick_calendar_handler(conn, "poc", duty_date, shift, ticket_no, node_key, detail)


def _resolve_research_version_fill_handler(
    conn: psycopg.Connection,
    ticket_no: str,
    node_key: str,
    values: dict[str, Any],
    win: str,
    duty_date: date,
    shift: str,
) -> str:
    biz_env = _normalize_biz_env(values.get("biz_env"))
    if win == "workday_day":
        roster_kind = "researchVersionRotation"
        detail = {
            "rule_stage": "problem_fill",
            "target_node": "problem_review",
            "window": win,
            "biz_env": biz_env,
            "source_table": "duty_rotation_entry",
            "roster_kind": roster_kind,
        }
        return _pick_rotation_handler(conn, roster_kind, ticket_no, node_key, detail)
    detail = {
        "rule_stage": "problem_fill",
        "target_node": "problem_review",
        "window": win,
        "biz_env": biz_env,
        "source_table": "duty_calendar_assignment",
        "table_kind": "research_version",
        "duty_date": duty_date.isoformat(),
        "shift": shift,
    }
    return _pick_calendar_handler(conn, "research_version", duty_date, shift, ticket_no, node_key, detail)


def _resolve_problem_fill_handler(conn: psycopg.Connection, ticket_no: str, node_key: str, values: dict[str, Any]) -> str:
    now_cn = datetime.now(_CHINA_TZ)
    win, duty_date, shift = _routing_window(conn, now_cn)
    if _is_research_version_pilot_issue(values):
        return _resolve_research_version_fill_handler(conn, ticket_no, node_key, values, win, duty_date, shift)
    if _is_poc_stage_issue(values):
        return _resolve_poc_fill_handler(conn, ticket_no, node_key, values, win, duty_date, shift)
    if _is_public_cloud_issue(values):
        return _resolve_public_cloud_fill_handler(conn, ticket_no, node_key, values, win, duty_date, shift)
    component = _normalize_component(values.get("component"))
    kind = _COMPONENT_TO_KIND[component]
    if win == "workday_day":
        roster_kind = "kernelRotation" if kind == "kernel" else "controlRotation"
        detail = {
            "rule_stage": "problem_fill",
            "target_node": "problem_review",
            "window": win,
            "component": component,
            "source_table": "duty_rotation_entry",
            "roster_kind": roster_kind,
        }
        return _pick_rotation_handler(conn, roster_kind, ticket_no, node_key, detail)
    detail = {
        "rule_stage": "problem_fill",
        "target_node": "problem_review",
        "window": win,
        "component": component,
        "source_table": "duty_calendar_assignment",
        "table_kind": kind,
        "duty_date": duty_date.isoformat(),
        "shift": shift,
    }
    return _pick_calendar_handler(conn, kind, duty_date, shift, ticket_no, node_key, detail)


def _resolve_problem_review_special_rotation_handler(
    conn: psycopg.Connection, ticket_no: str, node_key: str, values: dict[str, Any]
) -> str:
    from config import (
        SPECIAL_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE,
        SPECIAL_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED,
    )

    now_cn = datetime.now(_CHINA_TZ)
    win, _, _ = _routing_window(conn, now_cn)
    if win != "workday_day":
        return ""
    issue_type = str(values.get("issue_type_judge") or "").strip()
    roster_kind = SPECIAL_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE.get(issue_type, "")
    if not roster_kind:
        norm_key = _normalize_issue_type_judge_key(issue_type)
        roster_kind = SPECIAL_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED.get(norm_key, "")
    if not roster_kind:
        return ""
    detail = {
        "rule_stage": "problem_review",
        "rule_type": "submit_special_rotation",
        "issue_type_judge": issue_type,
        "routing_window": win,
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


def _resolve_last_node_submitter_display(
    conn: psycopg.Connection, ticket_internal_id: int, from_node_key: str
) -> str:
    """某节点最后一次 submit/jump_submit 的操作人展示名（与运维效率归属口径一致）。"""
    row = conn.execute(
        """
        SELECT fl.operator_name
        FROM ticket_flow_log fl
        JOIN workflow_node wn ON wn.id = fl.from_node_id AND wn.node_key = %s
        WHERE fl.ticket_id = %s
          AND fl.action_type IN ('submit', 'jump_submit')
        ORDER BY fl.created_at DESC, fl.id DESC
        LIMIT 1
        """,
        (from_node_key, ticket_internal_id),
    ).fetchone()
    return _canonical_person_display(str((row or {}).get("operator_name") or ""))


def _dev_closure_default_next_handler(conn: psycopg.Connection, ticket_internal_id: int, handle_mode: str) -> str:
    """开发闭环选「提交运维闭环」或「返回运维分析」时，默认下一步处理人 = 运维分析最后提交人。"""
    if str(handle_mode or "").strip() not in DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES:
        return ""
    return _resolve_last_node_submitter_display(
        conn, ticket_internal_id, DEV_CLOSURE_DEFAULT_NEXT_HANDLER_FROM_NODE
    )


def _dev_closure_suggested_next_handler_by_handle_mode(
    conn: psycopg.Connection, ticket_internal_id: int
) -> dict[str, str]:
    """开发闭环各处理方式对应的默认下一步处理人（同一建议人映射到多种处理方式）。"""
    suggested = _resolve_last_node_submitter_display(
        conn, ticket_internal_id, DEV_CLOSURE_DEFAULT_NEXT_HANDLER_FROM_NODE
    )
    if not suggested:
        return {}
    return {mode: suggested for mode in sorted(DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES)}


def _resolve_ticket_current_handler_from_inbound_flow(
    conn: psycopg.Connection, ticket_internal_id: int, current_node_id: int
) -> str:
    """最近一次 submit 流转到当前节点时，来源节点提交数据中的 next_handler。"""
    row = conn.execute(
        """
        SELECT nd.values_json->>'next_handler' AS next_handler
        FROM ticket_flow_log tfl
        LEFT JOIN LATERAL (
            SELECT tnd.values_json
            FROM ticket_node_data tnd
            JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
            WHERE tnd.ticket_id = tfl.ticket_id
              AND tni.node_id = tfl.from_node_id
              AND tnd.created_at <= tfl.created_at
            ORDER BY tnd.created_at DESC, tnd.id DESC
            LIMIT 1
        ) nd ON TRUE
        WHERE tfl.ticket_id = %s
          AND tfl.to_node_id = %s
          AND tfl.action_type = 'submit'
        ORDER BY tfl.created_at DESC, tfl.id DESC
        LIMIT 1
        """,
        (ticket_internal_id, current_node_id),
    ).fetchone()
    return _canonical_person_display(str((row or {}).get("next_handler") or ""))


def _resolve_ticket_open_handler_display(
    conn: psycopg.Connection, ticket_internal_id: int, current_node_id: int
) -> str:
    """未关闭工单的当前待办处理人（与列表「当前处理人」列一致）。"""
    proc = conn.execute(
        """
        SELECT handler_name
        FROM ticket_node_instance
        WHERE ticket_id = %s AND node_id = %s AND action_status = 'processing'
        ORDER BY id DESC
        LIMIT 1
        """,
        (ticket_internal_id, current_node_id),
    ).fetchone()
    handler = _canonical_person_display(str((proc or {}).get("handler_name") or ""))
    if handler:
        return handler

    handler = _resolve_ticket_current_handler_from_inbound_flow(conn, ticket_internal_id, current_node_id)
    if handler:
        return handler

    row = conn.execute(
        """
        SELECT values_json->>'next_handler' AS next_handler
        FROM ticket_node_data
        WHERE ticket_id = %s
          AND NULLIF(TRIM(values_json->>'next_handler'), '') IS NOT NULL
          AND COALESCE(schema_snapshot->>'amended', '') NOT IN ('true', '1', 'yes')
          AND COALESCE(schema_snapshot->>'draft', '') NOT IN ('true', '1', 'yes')
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (ticket_internal_id,),
    ).fetchone()
    handler = _canonical_person_display(str((row or {}).get("next_handler") or ""))
    if handler:
        return handler

    return _current_node_handler_display(conn, ticket_internal_id, current_node_id)


def _resolve_ticket_current_handler_display(
    conn: psycopg.Connection, ticket_internal_id: int, current_node_id: int
) -> str:
    return _resolve_ticket_open_handler_display(conn, ticket_internal_id, current_node_id)


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


def _run_ticket_facets(
    *,
    operator_id: str,
    operator_name: str,
    column: str,
    q: str,
    created_from: str,
    created_to: str,
    tab: str,
    column_filters_json: str,
    prefix: str,
    template_code: str,
) -> dict[str, Any]:
    """工作台 HCS 列筛选下拉：全量 distinct（白名单 + 页签 + 搜索 + 其它列筛选后）。"""
    tpl = str(template_code or "").strip() or SCHEMA_TEMPLATE_CODE
    if tpl != SCHEMA_TEMPLATE_CODE:
        raise HTTPException(status_code=400, detail="facets 仅支持 HCS_INCIDENT 工作台")
    if not TICKET_LIST_SNAPSHOT_ENABLED:
        raise HTTPException(status_code=503, detail="列表快照未启用，请设置 TICKET_LIST_SNAPSHOT_ENABLED=1")
    from ticket_list_snapshot import list_tickets_hcs_facets

    try:
        return list_tickets_hcs_facets(
            operator_id=operator_id,
            operator_name=operator_name,
            column=column,
            q=q,
            created_from=created_from,
            created_to=created_to,
            tab=tab,
            column_filters_json=column_filters_json,
            prefix=prefix,
            get_whitelist_flags_fn=_get_whitelist_flags,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/facets")
def list_ticket_facets(
    operator_id: str = "demo_001",
    operator_name: str = Query("", description="当前操作人姓名，待处理页签匹配用"),
    column: str = Query(..., description="列 key，如 location、currentStage"),
    q: str = "",
    created_from: str = Query(""),
    created_to: str = Query(""),
    tab: str = Query(
        "all",
        description="all|pending|created|pending_close|audit_close|handled|collaborated",
    ),
    column_filters: str = Query("", description="列筛选 JSON，与列表接口一致"),
    prefix: str = Query("", description="弹层内模糊搜索关键词，缩小 distinct 结果"),
    template_code: str = Query(SCHEMA_TEMPLATE_CODE),
) -> dict[str, Any]:
    return _run_ticket_facets(
        operator_id=operator_id,
        operator_name=operator_name,
        column=column,
        q=q,
        created_from=created_from,
        created_to=created_to,
        tab=tab,
        column_filters_json=column_filters,
        prefix=prefix,
        template_code=template_code,
    )


@router.post("/facets/query")
def query_ticket_facets(payload: TicketFacetsQuery) -> dict[str, Any]:
    """与 GET /facets 相同；column_filters 走 JSON body，避免筛选项过多时 query 过长。"""
    column_filters_json = (
        json.dumps(payload.column_filters, ensure_ascii=False) if payload.column_filters else ""
    )
    return _run_ticket_facets(
        operator_id=payload.operator_id,
        operator_name=payload.operator_name,
        column=payload.column,
        q=payload.q,
        created_from=payload.created_from,
        created_to=payload.created_to,
        tab=payload.tab,
        column_filters_json=column_filters_json,
        prefix=payload.prefix,
        template_code=payload.template_code,
    )


def _run_hcs_snapshot_list(
    *,
    operator_id: str,
    operator_name: str,
    q: str,
    ticket_no: str,
    created_from: str,
    created_to: str,
    tab: str,
    page: int,
    page_size: int,
    column_filters_json: str,
) -> dict[str, Any]:
    from ticket_list_snapshot import list_tickets_hcs_from_snapshot

    try:
        return list_tickets_hcs_from_snapshot(
            operator_id=operator_id,
            operator_name=operator_name,
            q=q,
            ticket_no=ticket_no,
            created_from=created_from,
            created_to=created_to,
            tab=tab,
            page=page if page >= 1 else 1,
            page_size=page_size,
            column_filters_json=column_filters_json,
            get_whitelist_flags_fn=_get_whitelist_flags,
        )
    except RuntimeError as exc:
        logger.warning("HCS snapshot list unavailable: %s", exc)
        exact_no_early = str(ticket_no or "").strip()
        if page >= 1 and not exact_no_early:
            raise HTTPException(
                status_code=503,
                detail="列表快照不可用，已拒绝回落全量 legacy 列表（避免 OOM）；请修复快照表或执行重建",
            ) from exc
        raise


@router.post("/query")
def query_tickets_snapshot(payload: TicketSnapshotListQuery) -> dict[str, Any]:
    """与 GET /api/tickets 快照分页相同；column_filters 走 JSON body，避免筛选项过多时 query 过长。"""
    tpl = str(payload.template_code or "").strip() or SCHEMA_TEMPLATE_CODE
    if tpl != SCHEMA_TEMPLATE_CODE:
        raise HTTPException(status_code=400, detail="POST /query 仅支持 HCS_INCIDENT 快照列表")
    if not TICKET_LIST_SNAPSHOT_ENABLED:
        raise HTTPException(status_code=503, detail="列表快照未启用，请设置 TICKET_LIST_SNAPSHOT_ENABLED=1")
    page = max(1, int(payload.page or 1))
    column_filters_json = (
        json.dumps(payload.column_filters, ensure_ascii=False) if payload.column_filters else ""
    )
    return _run_hcs_snapshot_list(
        operator_id=payload.operator_id,
        operator_name=payload.operator_name,
        q=payload.q,
        ticket_no=payload.ticket_no,
        created_from=payload.created_from,
        created_to=payload.created_to,
        tab=payload.tab,
        page=page,
        page_size=payload.page_size,
        column_filters_json=column_filters_json,
    )


@router.get("")
def list_tickets(
    operator_id: str = "demo_001",
    operator_name: str = Query("", description="当前操作人姓名，待处理页签匹配用"),
    q: str = "",
    ticket_no: str = Query("", description="精确工单号（SQL 层只查该单，供深链详情预载）"),
    created_from: str = Query("", description="创建日起始 YYYY-MM-DD（含），按 Asia/Shanghai 日历日"),
    created_to: str = Query("", description="创建日结束 YYYY-MM-DD（含），按 Asia/Shanghai 日历日"),
    template_code: str = Query(
        SCHEMA_TEMPLATE_CODE,
        description="流程模板编码，如 HCS_INCIDENT、HOTPATCH；工作台默认 HCS_INCIDENT",
    ),
    page: int = Query(0, ge=0, description="服务端分页页码（≥1 启用 HCS 快照列表；0 为 legacy 全量）"),
    page_size: int = Query(20, ge=1, le=200, description="每页条数"),
    tab: str = Query(
        "all",
        description="工作台/主页页签：all|pending|created|pending_close|audit_close|handled|collaborated",
    ),
    column_filters: str = Query("", description='列筛选 JSON，如 {"location":["北京"]}'),
) -> dict[str, Any]:
    """获取工单列表，支持搜索关键词 q（匹配全部文本字段）；可选按建单时间 created_at 筛选。"""
    tpl = str(template_code or "").strip() or SCHEMA_TEMPLATE_CODE
    exact_no_early = str(ticket_no or "").strip()
    use_hcs_snapshot = (
        TICKET_LIST_SNAPSHOT_ENABLED
        and tpl == SCHEMA_TEMPLATE_CODE
        and (page >= 1 or bool(exact_no_early))
    )
    if use_hcs_snapshot:
        try:
            return _run_hcs_snapshot_list(
                operator_id=operator_id,
                operator_name=operator_name,
                q=q,
                ticket_no=ticket_no,
                created_from=created_from,
                created_to=created_to,
                tab=tab,
                page=page if page >= 1 else 1,
                page_size=page_size,
                column_filters_json=column_filters,
            )
        except HTTPException:
            raise
        except RuntimeError:
            # _run_hcs_snapshot_list 在 page>=1 且无 ticket_no 时已转 503；深链单条允许回落 legacy
            pass

    if page >= 1 and tpl == SCHEMA_TEMPLATE_CODE and not exact_no_early:
        raise HTTPException(
            status_code=400,
            detail="HCS 列表须使用 page>=1 的快照分页；禁止 page=0 全量 legacy 拉取",
        )

    return _list_tickets_legacy(
        operator_id=operator_id,
        q=q,
        ticket_no=ticket_no,
        created_from=created_from,
        created_to=created_to,
        template_code=template_code,
    )


def _list_tickets_legacy(
    operator_id: str = "demo_001",
    q: str = "",
    ticket_no: str = "",
    created_from: str = "",
    created_to: str = "",
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, Any]:
    """获取工单列表，支持搜索关键词 q（匹配全部文本字段）；可选按建单时间 created_at 筛选。"""
    kw = (q or "").strip().lower()
    exact_no = str(ticket_no or "").strip()
    if exact_no and not (_YW_TICKET_NO_RE.match(exact_no) or _HPM_TICKET_NO_RE.match(exact_no)):
        exact_no = ""
    cf = _optional_list_created_ymd(created_from)
    ct = _optional_list_created_ymd(created_to)

    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        where_sql = "(%s = FALSE OR t.creator_id = %s)"
        sql_params = [only_self, operator_id]
        if exact_no:
            where_sql += " AND t.ticket_no = %s"
            sql_params.append(exact_no)
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
              t.current_node_id AS current_node_id,
              COALESCE(t.status, 'open') AS status,
              COALESCE(t.creator_name, '') AS creator_name,
              COALESCE(t.creator_id, '') AS creator_id,
              COALESCE(wn.node_key, '') AS node_key,
              COALESCE(wtt.template_code, '') AS template_code,
              t.flow_context AS flow_context,
              {sql_ticket_list_current_stage("t.status", "wn.node_name", "wn.node_key")} AS current_stage,
              t.created_at AS ticket_created_at,
              COALESCE(t.title, '') AS ticket_title
            FROM ticket t
            JOIN workflow_template wtt ON wtt.id = t.template_id
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            WHERE {where_sql} AND wtt.template_code = %s
            ORDER BY t.created_at DESC, t.id DESC
            """,
            tuple(sql_params_tpl),
        ).fetchall()
        ids = [int(r["ticket_internal_id"]) for r in rows]
        by_ticket: dict[int, list[dict[str, Any]]] = defaultdict(list)
        submitted_ids: set[int] = set()
        ticket_closed_at_by_id: dict[int, Any] = {}
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
            ticket_closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ids)
            nd_rows = conn.execute(
                """
                SELECT tnd.ticket_id, tnd.values_json, tnd.created_at,
                       COALESCE(tnd.schema_snapshot->>'node_key', '') AS node_key,
                       COALESCE(tnd.schema_snapshot->>'amended', '') AS amended,
                       tnd.schema_snapshot AS schema_snapshot
                FROM ticket_node_data tnd
                WHERE tnd.ticket_id = ANY(%s)
                ORDER BY tnd.ticket_id, tnd.created_at ASC
                """,
                (ids,),
            ).fetchall()
            for nr in nd_rows:
                tid = int(nr["ticket_id"])
                by_ticket[tid].append(
                    {
                        "values_json": nr["values_json"],
                        "created_at": nr["created_at"],
                        "node_key": nr["node_key"],
                        "amended": nr["amended"],
                        "schema_snapshot": nr["schema_snapshot"],
                    }
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
            if ticket_status_is_closed(row["status"]):
                handler_display = ""
            else:
                cur_nid = row.get("current_node_id")
                if cur_nid is not None:
                    handler_display = _resolve_ticket_open_handler_display(conn, tid, int(cur_nid))
                else:
                    handler_display = str(snap.get("_last_submit_next_handler") or "").strip()
                if not handler_display:
                    handler_display = str(row.get("creator_name") or "").strip()
                if not handler_display:
                    # 库内仅有 creator_id、姓名为空时，列表「当前处理人」与待处理匹配依赖账号
                    handler_display = str(row.get("creator_id") or "").strip()
            display_stage = str(row["current_stage"] or "-")
            hotpatch_frontier_keys: list[str] | None = None
            hotpatch_parallel_handlers: dict[str, str] = {}
            if str(row.get("template_code") or "") == HOTPATCH_TEMPLATE_CODE and not ticket_status_is_closed(row["status"]):
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
            closed_at_str = closed_at_iso(ticket_closed_at_by_id.get(tid))

            # 获取所有可选列字段值
            all_fields = snap.get("_all_fields") or {}
            # 构建扩展字段字典（richtext 字段需要去除 HTML 标签截断）
            extra_fields: dict[str, Any] = {}
            for k, v in all_fields.items():
                if k in RICHTEXT_COLUMN_KEYS:
                    extra_fields[k] = _strip_html_list_preview(
                        str(v or ""), SNAPSHOT_EXTRA_FIELDS_RICHTEXT_MAX
                    )
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
                    "closedAt": closed_at_str,
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
            if str(row.get("template_code") or "") == HOTPATCH_TEMPLATE_CODE and not ticket_status_is_closed(row["status"]):
                item_body["hotpatchParallelHandlers"] = hotpatch_parallel_handlers
            items.append(item_body)
        # 搜索过滤：匹配全部文本字段（87个字段）；精确 ticket_no 已在 SQL 层筛选
        if kw and not exact_no:
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
                "error_text", "issue_track", "has_core_stack",
                "core_stack_text", "is_consult_issue", "use_doer_assist", "doer_no_help_reason",
                # dev_analysis 字段
                "front_pass_through", "version_pass_through", "is_quality_issue",
                "dts_no", "version_pass_reason", "is_consult_issue",
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
        return {"items": items, "list_mode": "legacy"}


@router.post("/snapshot/rebuild")
def rebuild_ticket_list_snapshots(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """运维：分批重建 HCS 列表快照（需已执行迁移 0079）。权限见 workbench_snapshot_rebuild。

    请求体 JSON：operator_id、after_ticket_id（游标，默认 0）、batch_size（默认 50，最大 500）；
    可选 ticket_nos（字符串数组）：仅重建指定单号（工作台勾选/当前筛选），此时忽略 after_ticket_id。
    全量重建时前端循环调用直至 has_more=false；CLI 脚本仍一次性跑完全量。
    """
    if not TICKET_LIST_SNAPSHOT_ENABLED:
        raise HTTPException(status_code=503, detail="TICKET_LIST_SNAPSHOT_ENABLED=0，跳过快照重建")
    body = payload if isinstance(payload, dict) else {}
    op = str(body.get("operator_id") or "demo_001").strip() or "demo_001"
    op_log = operator_log_label(op)
    try:
        after_ticket_id = max(0, int(body.get("after_ticket_id") or 0))
    except (TypeError, ValueError):
        after_ticket_id = 0
    try:
        batch_size = int(body.get("batch_size") or 50)
    except (TypeError, ValueError):
        batch_size = 50
    batch_size = max(1, min(batch_size, 500))

    raw_nos = body.get("ticket_nos")
    ticket_nos: list[str] | None = None
    if raw_nos is not None:
        if not isinstance(raw_nos, list):
            raise HTTPException(status_code=400, detail="ticket_nos 须为数组")
        ticket_nos = [str(x or "").strip() for x in raw_nos if str(x or "").strip()]
        if not ticket_nos:
            raise HTTPException(status_code=400, detail="ticket_nos 不能为空")
        if len(ticket_nos) > 500:
            raise HTTPException(status_code=400, detail="ticket_nos 单次最多 500 条")

    with db_conn() as conn:
        if not _workbench_snapshot_rebuild_allowed(conn, op):
            raise HTTPException(status_code=403, detail="无重建列表快照权限（workbench_snapshot_rebuild）")
        try:
            if ticket_nos is not None:
                from ticket_list_snapshot import refresh_hcs_snapshots_by_ticket_nos

                logger.info(
                    "snapshot rebuild api by_ticket_nos operator=%s count=%s batch_size=%s",
                    op_log,
                    len(ticket_nos),
                    batch_size,
                )
                summary = refresh_hcs_snapshots_by_ticket_nos(
                    conn,
                    ticket_nos,
                    batch_size=batch_size,
                )
            else:
                from ticket_list_snapshot import refresh_hcs_snapshots_batch

                logger.info(
                    "snapshot rebuild api batch operator=%s after_ticket_id=%s batch_size=%s",
                    op_log,
                    after_ticket_id,
                    batch_size,
                )
                summary = refresh_hcs_snapshots_batch(
                    conn,
                    after_ticket_id=after_ticket_id,
                    batch_size=batch_size,
                )
        except UndefinedTable as exc:
            logger.warning("snapshot rebuild api failed operator=%s reason=missing_table", op_log)
            raise HTTPException(
                status_code=503,
                detail="ticket_list_snapshot 表不存在，请先执行迁移 0079",
            ) from exc

    if not summary.get("has_more"):
        audit_log(
            "ticket.snapshot_rebuild",
            operator=op,
            refreshed=summary.get("done_cumulative"),
            total=summary.get("total"),
            by_ticket_nos=ticket_nos is not None,
            skipped_not_found=summary.get("skipped_not_found"),
        )
        logger.info(
            "snapshot rebuild api done operator=%s refreshed=%s total=%s by_ticket_nos=%s skipped=%s",
            op_log,
            summary.get("done_cumulative"),
            summary.get("total"),
            ticket_nos is not None,
            summary.get("skipped_not_found"),
        )
    else:
        logger.info(
            "snapshot rebuild api batch done operator=%s processed=%s cumulative=%s total=%s has_more=%s",
            op_log,
            summary.get("processed"),
            summary.get("done_cumulative"),
            summary.get("total"),
            summary.get("has_more"),
        )
    return summary


@router.post("/allocate-no")
def allocate_ticket_no(payload: AllocateTicketNoPayload) -> dict[str, str]:
    """脚本/工具预取流程号（服务端全局序号）；工作台创建弹窗在首次 submit 时取号。落库仍受咨询锁与碰撞重分配保护。"""
    tc = str(payload.template_code or SCHEMA_TEMPLATE_CODE).strip()
    with db_conn() as conn:
        conn.execute(
            "SELECT pg_advisory_xact_lock(%s, %s)",
            (_YW_ADVISORY_LOCK_KEY1, _YW_ADVISORY_LOCK_KEY2),
        )
        if tc == HOTPATCH_TEMPLATE_CODE:
            ticket_no = _allocate_hpm_ticket_no(conn)
        else:
            ticket_no = _allocate_yw_ticket_no(conn)
        conn.commit()
    return {"ticket_no": ticket_no}


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


@router.get("/migrate-legacy/candidates")
def list_migrate_legacy_candidates(
    operator_id: str = "demo_001",
    search: str = "",
    limit: int = 500,
) -> dict[str, Any]:
    """列出老库可迁入工单（按 process_id），供迁入弹窗选择。"""
    from legacy_migration import legacy_conn, list_legacy_migration_candidates

    op = str(operator_id or "").strip() or "demo_001"
    op_log = operator_log_label(op)
    logger.info(
        "migrate_legacy_candidates request operator=%s search=%r limit=%s",
        op_log,
        search,
        limit,
    )
    with db_conn() as conn:
        if not _workbench_migrate_allowed(conn, op):
            logger.warning("migrate_legacy_candidates denied operator=%s reason=no_permission", op_log)
            raise HTTPException(status_code=403, detail="无迁入权限（workbench_migrate）")
        try:
            with legacy_conn() as lconn:
                data = list_legacy_migration_candidates(
                    lconn, conn, limit=limit, search=search.strip()
                )
        except UndefinedTable as exc:
            logger.error("migrate_legacy_candidates failed operator=%s reason=legacy_tables_missing", op_log)
            raise HTTPException(
                status_code=400,
                detail="未找到老平台工单表（t_work_flow_instance 等），请确认 LEGACY_DATABASE_URL",
            ) from exc
        except psycopg.OperationalError as exc:
            logger.error(
                "migrate_legacy_candidates failed operator=%s reason=legacy_db_unreachable detail=%s",
                op_log,
                exc,
            )
            raise HTTPException(status_code=400, detail=f"无法连接老库：{exc}") from exc
    logger.info(
        "migrate_legacy_candidates ok operator=%s total=%s truncated=%s",
        op_log,
        data.get("total"),
        data.get("truncated"),
    )
    return {"ok": True, **data}


def _migrate_legacy_sync(payload: dict[str, Any]) -> dict[str, Any]:
    """从老平台（GaussDB）迁入历史工单到新平台。

    后端直连 LEGACY_DATABASE_URL（本地默认回退当前库，读模拟老表），按 instance.id
    游标分批读取、分批提交；以 ticket.legacy_instance_id 幂等，重复迁入跳过已迁实例。
    可选 process_ids：仅迁入指定流程 ID；不传则迁入全部。
    权限见 workbench_migrate（非 hidden）。
    """
    from legacy_migration import (
        legacy_conn,
        migrate_legacy_tickets,
        _legacy_summary_for_audit,
        _legacy_summary_for_response,
        _normalize_process_ids,
    )
    from config import MIGRATE_LEGACY_DEFAULT_CAP_BATCH

    op = str(payload.get("operator_id") or "").strip() or "demo_001"
    op_log = operator_log_label(op)
    try:
        batch_size = int(payload.get("batch_size") or 200)
    except (TypeError, ValueError):
        batch_size = 200
    batch_size = max(1, min(batch_size, 1000))
    raw_max = payload.get("max_total")
    max_total = None
    if raw_max not in (None, ""):
        try:
            max_total = max(0, int(raw_max))
        except (TypeError, ValueError):
            max_total = None
    process_ids = _normalize_process_ids(payload.get("process_ids"))
    refresh_snapshot = bool(payload.get("refresh_snapshot"))
    if (
        MIGRATE_LEGACY_DEFAULT_CAP_BATCH
        and not process_ids
        and max_total is None
        and not refresh_snapshot
    ):
        max_total = batch_size
        logger.info(
            "migrate_legacy apply default max_total=%s (prevent single-request full legacy scan)",
            max_total,
        )
    try:
        after_legacy_instance_id = max(0, int(payload.get("after_legacy_instance_id") or 0))
    except (TypeError, ValueError):
        after_legacy_instance_id = 0

    logger.info(
        "migrate_legacy request operator=%s batch_size=%s max_total=%s "
        "after_legacy_instance_id=%s refresh_snapshot=%s process_ids=%s",
        op_log,
        batch_size,
        max_total,
        after_legacy_instance_id,
        refresh_snapshot,
        process_ids if process_ids else "all",
    )
    with db_conn() as conn:
        if not _workbench_migrate_allowed(conn, op):
            logger.warning("migrate_legacy denied operator=%s reason=no_permission", op_log)
            raise HTTPException(status_code=403, detail="无迁入权限（workbench_migrate）")
        try:
            with legacy_conn() as lconn:
                summary = migrate_legacy_tickets(
                    conn,
                    lconn,
                    batch_size=batch_size,
                    max_total=max_total if not process_ids else None,
                    after_legacy_instance_id=after_legacy_instance_id,
                    process_ids=process_ids if process_ids else None,
                )
        except UndefinedTable as exc:
            conn.rollback()
            logger.error("migrate_legacy failed operator=%s reason=legacy_tables_missing", op_log)
            raise HTTPException(
                status_code=400,
                detail="未找到老平台工单表（t_work_flow_instance 等），请确认 LEGACY_DATABASE_URL 指向老库或已灌入模拟数据",
            ) from exc
        except psycopg.OperationalError as exc:
            logger.error(
                "migrate_legacy failed operator=%s reason=legacy_db_unreachable detail=%s",
                op_log,
                exc,
            )
            raise HTTPException(status_code=400, detail=f"无法连接老库：{exc}") from exc
        if refresh_snapshot and TICKET_LIST_SNAPSHOT_ENABLED:
            from ticket_list_snapshot import refresh_all_hcs_snapshots

            logger.info(
                "migrate_legacy snapshot rebuild start operator=%s has_more=%s",
                op_log,
                summary.get("has_more"),
            )
            try:
                snap = refresh_all_hcs_snapshots()
                logger.info(
                    "migrate_legacy snapshot rebuild done operator=%s refreshed=%s total=%s",
                    op_log,
                    snap.get("refreshed"),
                    snap.get("total"),
                )
            except Exception as exc:
                logger.exception(
                    "migrate_legacy snapshot rebuild failed operator=%s detail=%s",
                    op_log,
                    exc,
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"迁入已完成但列表快照重建失败：{exc}",
                ) from exc
    audit_log("ticket.migrate_legacy", operator=op, **_legacy_summary_for_audit(summary))
    logger.info(
        "migrate_legacy response operator=%s processed=%s migrated=%s skipped_existing=%s "
        "failed=%s has_more=%s next_after=%s",
        op_log,
        summary.get("processed"),
        summary.get("migrated"),
        summary.get("skipped_existing"),
        summary.get("failed"),
        summary.get("has_more"),
        summary.get("next_after_legacy_instance_id"),
    )
    return {"ok": True, **_legacy_summary_for_response(summary)}


@router.post("/migrate-legacy", response_model=None)
async def migrate_legacy(request: Request, payload: dict[str, Any]) -> dict[str, Any] | StreamingResponse:
    """从老平台（GaussDB）迁入历史工单到新平台。

    后端直连 LEGACY_DATABASE_URL（本地默认回退当前库，读模拟老表），按 instance.id
    游标分批读取、分批提交；以 ticket.legacy_instance_id 幂等，重复迁入跳过已迁实例。
    可选 process_ids：仅迁入指定流程 ID；不传则迁入全部。
    权限见 workbench_migrate（非 hidden）。
    请求头 X-Stream-Keepalive: 1 时流式 keepalive，避免网关超时。
    """
    from utils.long_request_stream import maybe_stream_json_response

    return await maybe_stream_json_response(request, lambda: _migrate_legacy_sync(payload))


def _repair_migrate_legacy_sync(payload: dict[str, Any]) -> dict[str, Any]:
    """按老库修复已迁工单。默认仅校正流程 ID / status / 当前节点；rebuild_workflow=true 时重建流转。"""
    from legacy_migration import (
        legacy_conn,
        repair_legacy_migrated_tickets,
        _legacy_summary_for_audit,
        _normalize_process_ids,
    )

    op = str(payload.get("operator_id") or "").strip() or "demo_001"
    op_log = operator_log_label(op)
    process_ids = _normalize_process_ids(payload.get("process_ids"))
    raw_limit = payload.get("limit")
    limit: int | None = None
    if raw_limit not in (None, ""):
        try:
            limit = max(1, min(int(raw_limit), 500))
        except (TypeError, ValueError):
            limit = None
    try:
        after_legacy_instance_id = max(0, int(payload.get("after_legacy_instance_id") or 0))
    except (TypeError, ValueError):
        after_legacy_instance_id = 0

    rebuild_workflow = bool(payload.get("rebuild_workflow"))
    backfill_fields_from_legacy = bool(payload.get("backfill_fields_from_legacy"))
    backfill_placeholder_only = payload.get("backfill_placeholder_only")
    if backfill_placeholder_only is None:
        backfill_placeholder_only = True
    else:
        backfill_placeholder_only = bool(backfill_placeholder_only)
    logger.info(
        "migrate_legacy_repair request operator=%s limit=%s after_legacy_instance_id=%s "
        "process_ids=%s rebuild_workflow=%s backfill_fields=%s",
        op_log,
        limit,
        after_legacy_instance_id,
        process_ids if process_ids else "all",
        rebuild_workflow,
        backfill_fields_from_legacy,
    )
    with db_conn() as conn:
        if not _workbench_migrate_allowed(conn, op):
            logger.warning("migrate_legacy_repair denied operator=%s reason=no_permission", op_log)
            raise HTTPException(status_code=403, detail="无迁入权限（workbench_migrate）")
        try:
            with legacy_conn() as lconn:
                summary = repair_legacy_migrated_tickets(
                    conn,
                    lconn,
                    process_ids=process_ids if process_ids else None,
                    limit=limit,
                    after_legacy_instance_id=after_legacy_instance_id,
                    rebuild_workflow=rebuild_workflow,
                    backfill_fields_from_legacy=backfill_fields_from_legacy,
                    backfill_placeholder_only=backfill_placeholder_only,
                )
        except UndefinedTable as exc:
            conn.rollback()
            logger.error("migrate_legacy_repair failed operator=%s reason=legacy_tables_missing", op_log)
            raise HTTPException(
                status_code=400,
                detail="未找到老平台工单表，请确认 LEGACY_DATABASE_URL",
            ) from exc
        except psycopg.OperationalError as exc:
            logger.error(
                "migrate_legacy_repair failed operator=%s reason=legacy_db_unreachable detail=%s",
                op_log,
                exc,
            )
            raise HTTPException(status_code=400, detail=f"无法连接老库：{exc}") from exc
        except Exception as exc:
            logger.exception(
                "migrate_legacy_repair unexpected error operator=%s limit=%s after=%s",
                op_log,
                limit,
                after_legacy_instance_id,
            )
            raise HTTPException(status_code=500, detail=f"修复失败：{exc}") from exc
    audit_log("ticket.migrate_legacy_repair", operator=op, **_legacy_summary_for_audit(summary))
    logger.info(
        "migrate_legacy_repair response operator=%s processed=%s repaired=%s "
        "skipped_unchanged=%s failed=%s has_more=%s",
        op_log,
        summary.get("processed"),
        summary.get("repaired"),
        summary.get("skipped_unchanged"),
        summary.get("failed"),
        summary.get("has_more"),
    )
    return {"ok": True, **summary}


@router.post("/migrate-legacy/repair", response_model=None)
async def repair_migrate_legacy(request: Request, payload: dict[str, Any]) -> dict[str, Any] | StreamingResponse:
    """按老库修复已迁工单。默认仅校正流程 ID / status / 当前节点；rebuild_workflow=true 时重建流转。"""
    from utils.long_request_stream import maybe_stream_json_response

    return await maybe_stream_json_response(request, lambda: _repair_migrate_legacy_sync(payload))


def _delete_migrate_legacy_migrated_sync(payload: dict[str, Any]) -> dict[str, Any]:
    """删除历史迁入工单（legacy_instance_id IS NOT NULL）。权限同 workbench_migrate。"""
    from legacy_migration import (
        delete_legacy_migrated_tickets,
        _legacy_summary_for_audit,
        _normalize_process_ids,
    )

    op = str(payload.get("operator_id") or "").strip() or "demo_001"
    op_log = operator_log_label(op)
    process_ids = _normalize_process_ids(payload.get("process_ids"))
    raw_limit = payload.get("limit")
    limit: int | None = None
    if raw_limit not in (None, ""):
        try:
            limit = max(1, min(int(raw_limit), 500))
        except (TypeError, ValueError):
            limit = None
    try:
        after_legacy_instance_id = max(0, int(payload.get("after_legacy_instance_id") or 0))
    except (TypeError, ValueError):
        after_legacy_instance_id = 0
    dry_run = bool(payload.get("dry_run"))
    refresh_snapshot = bool(payload.get("refresh_snapshot"))

    logger.info(
        "migrate_legacy_delete request operator=%s limit=%s after_legacy_instance_id=%s "
        "process_ids=%s dry_run=%s refresh_snapshot=%s",
        op_log,
        limit,
        after_legacy_instance_id,
        process_ids if process_ids else "all",
        dry_run,
        refresh_snapshot,
    )
    with db_conn() as conn:
        if not _workbench_migrate_allowed(conn, op):
            logger.warning("migrate_legacy_delete denied operator=%s reason=no_permission", op_log)
            raise HTTPException(status_code=403, detail="无迁入权限（workbench_migrate）")
        summary = delete_legacy_migrated_tickets(
            conn,
            process_ids=process_ids if process_ids else None,
            limit=limit,
            after_legacy_instance_id=after_legacy_instance_id,
            dry_run=dry_run,
        )
        if refresh_snapshot and TICKET_LIST_SNAPSHOT_ENABLED and not dry_run and summary.get("deleted"):
            from ticket_list_snapshot import refresh_all_hcs_snapshots

            try:
                snap = refresh_all_hcs_snapshots()
                summary["snapshot_refreshed"] = snap.get("refreshed")
                summary["snapshot_total"] = snap.get("total")
            except Exception as exc:
                logger.exception(
                    "migrate_legacy_delete snapshot rebuild failed operator=%s detail=%s",
                    op_log,
                    exc,
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"删除完成但列表快照重建失败：{exc}",
                ) from exc
    if not dry_run:
        audit_log("ticket.migrate_legacy_delete", operator=op, **_legacy_summary_for_audit(summary))
    logger.info(
        "migrate_legacy_delete response operator=%s deleted=%s skipped_not_found=%s "
        "has_more=%s dry_run=%s",
        op_log,
        summary.get("deleted"),
        summary.get("skipped_not_found"),
        summary.get("has_more"),
        dry_run,
    )
    return {"ok": True, **summary}


@router.get("/migrate-legacy/migrated-count")
def count_migrate_legacy_migrated(operator_id: str = "demo_001") -> dict[str, Any]:
    """统计新平台中已迁入工单数量（legacy_instance_id IS NOT NULL）。"""
    from legacy_migration import count_legacy_migrated_tickets

    op = str(operator_id or "").strip() or "demo_001"
    with db_conn() as conn:
        if not _workbench_migrate_allowed(conn, op):
            raise HTTPException(status_code=403, detail="无迁入权限（workbench_migrate）")
        count = count_legacy_migrated_tickets(conn)
    return {"ok": True, "count": count}


@router.post("/migrate-legacy/delete-migrated", response_model=None)
async def delete_migrate_legacy_migrated(
    request: Request, payload: dict[str, Any]
) -> dict[str, Any] | StreamingResponse:
    """删除历史迁入工单（legacy_instance_id IS NOT NULL）。权限同 workbench_migrate。"""
    from utils.long_request_stream import maybe_stream_json_response

    return await maybe_stream_json_response(request, lambda: _delete_migrate_legacy_migrated_sync(payload))


@router.get("/{ticket_id}/nodes/{node_key}/data")
def get_node_data(ticket_id: str, node_key: str, operator_id: str = "demo_001") -> dict[str, Any]:
    op_log = operator_log_label(operator_id)
    try:
        with db_conn() as conn:
            flags = _get_whitelist_flags(conn, operator_id)
            if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
                logger.warning(
                    "get_node_data denied ticket=%s node=%s operator=%s reason=only_problem_fill",
                    ticket_id,
                    node_key,
                    op_log,
                )
                raise HTTPException(status_code=403, detail="仅可查看问题填写节点")
            tid_row = conn.execute("SELECT t.id FROM ticket t WHERE t.ticket_no = %s", (ticket_id,)).fetchone()
            if not tid_row:
                logger.warning(
                    "get_node_data not found ticket=%s node=%s operator=%s",
                    ticket_id,
                    node_key,
                    op_log,
                )
                raise HTTPException(status_code=404, detail="ticket not found")
            tmpl = template_code_for_ticket(conn, int(tid_row["id"]))
            if not str(tmpl or "").strip():
                tmpl = SCHEMA_TEMPLATE_CODE
            fields = _load_schema(conn, node_key, tmpl)
            # 退役字段 dfx_gap：该工单若已存 dfx_gap（旧单），复活字段定义以便继承/渲染/编辑
            from utils.dfx_gap import revive_dfx_gap_for_ticket

            _dfx_revived = revive_dfx_gap_for_ticket(conn, ticket_id, node_key, tmpl)
            if _dfx_revived and not any(f.get("key") == "dfx_gap" for f in fields):
                fields.append(_dfx_revived)
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
            values = _values_json_as_dict(row["values_json"] if row else None)
            values = _merge_inherited_previous_values(conn, ticket_id, node_key, fields, values, template_code=tmpl)
            for pk in PERSON_VALUE_FIELD_KEYS:
                if pk in values and isinstance(values[pk], str):
                    values[pk] = _normalize_person_field_value(pk, values[pk])
            meta: dict[str, Any] = {}
            if node_key == "dev_closure":
                suggested_map = _dev_closure_suggested_next_handler_by_handle_mode(
                    conn, int(tid_row["id"])
                )
                if suggested_map:
                    meta["suggested_next_handler_by_handle_mode"] = suggested_map
            out: dict[str, Any] = {"ticket_id": ticket_id, "node_key": node_key, "values": values}
            if meta:
                out["meta"] = meta
            return out
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "get_node_data failed ticket=%s node=%s operator=%s",
            ticket_id,
            node_key,
            op_log,
        )
        raise HTTPException(status_code=500, detail=f"节点数据加载失败：{exc}") from exc


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
        # 退役字段 dfx_gap：与 get_node_schema/get_node_data 同源复活，否则旧单（已存 dfx_gap）
        # 在前端按复活 schema 渲染并提交时，会被这里的 active-only 校验判为 unknown fields
        from utils.dfx_gap import revive_dfx_gap_for_ticket

        _dfx_revived = revive_dfx_gap_for_ticket(conn, ticket_id, node_key, tmpl_code)
        if _dfx_revived and not any(f.get("key") == "dfx_gap" for f in fields):
            fields.append(_dfx_revived)

        allow_flow_submit = True
        prev_vals_for_amend: dict[str, Any] = {}
        if exists_row:
            ticket_preview = conn.execute(
                """
                SELECT id, ticket_no, current_node_id, status
                FROM ticket
                WHERE ticket_no = %s
                """,
                (ticket_id,),
            ).fetchone()
            allow_flow_submit = _ticket_node_allows_flow_submit(conn, ticket_preview, node_key, tmpl_code)
            if not allow_flow_submit or payload.save_only:
                prev_vals_for_amend = _query_latest_node_values(conn, ticket_id, node_key, tmpl_code)

        persist_without_flow = payload.save_only or not allow_flow_submit

        login_user = _canonical_person_display(f"{payload.operator_id} {payload.operator_name}")
        resolved: dict[str, Any] = dict(payload.values)
        if persist_without_flow and prev_vals_for_amend:
            merged = dict(prev_vals_for_amend)
            merged.update(resolved)
            resolved = merged
        # 已存在工单提交时不把空的 login_user 字段（提单人）填成当前打开人
        apply_login_user_default = not bool(exists_row)
        for field in fields:
            key = field["key"]
            v = _apply_default(
                field, resolved, login_user, apply_login_user=apply_login_user_default
            )
            if key in payload.values and payload.values[key] not in (None, ""):
                v = payload.values[key]
            resolved[key] = v

        resolved = _merge_inherited_previous_values(conn, ticket_id, node_key, fields, resolved, template_code=tmpl_code)

        for pk in PERSON_VALUE_FIELD_KEYS:
            if pk in resolved and isinstance(resolved[pk], str):
                resolved[pk] = _normalize_person_field_value(pk, resolved[pk])

        # 开发闭环「提交运维闭环」/「返回运维分析」：下一步处理人为空时，默认带出运维分析最后提交人（须在必填校验前）
        if (
            not persist_without_flow
            and node_key == "dev_closure"
            and exists_row
            and not str(resolved.get("next_handler") or "").strip()
        ):
            suggested_nh = _dev_closure_default_next_handler(
                conn,
                int(exists_row["id"]),
                str(resolved.get("handle_mode") or "").strip(),
            )
            if suggested_nh:
                resolved["next_handler"] = suggested_nh

        values: dict[str, Any] = {}
        errors: list[str] = []

        for field in fields:
            key = field["key"]
            value = resolved[key]
            if not _field_visible(field, resolved):
                continue
            req = False if persist_without_flow else _effective_required(field, resolved)
            field_for_val = {**field, "required": req}
            err = _validate_one(field_for_val, value, resolved)
            if err:
                errors.append(err)
            else:
                values[key] = value

        unknown_keys = set(payload.values.keys()) - {f["key"] for f in fields}
        if unknown_keys:
            errors.append(f"unknown fields: {sorted(unknown_keys)}")

        if not persist_without_flow and node_key == "ops_analysis":
            hm = str(values.get("handle_mode") or resolved.get("handle_mode") or "").strip()
            if (
                hm == OPS_ANALYSIS_EXCLUDED_HANDLE_MODE_WHEN_QUALITY_YES
                and ops_analysis_excludes_ops_closure(str(resolved.get("is_quality_issue") or ""))
            ):
                errors.append(
                    "质量问题为「是」时，处理方式不可选择「提交运维闭环」"
                )

        if node_key == "problem_fill" and _is_public_cloud_issue(resolved):
            comp = str(resolved.get("component") or "").strip()
            if comp and comp != _COMPONENT_KERNEL:
                errors.append("产品线为公有云时，问题组件仅允许内核问题")

        if errors:
            raise HTTPException(status_code=400, detail={"message": "Validation failed", "errors": errors})

        if payload.save_only and not exists_row:
            raise HTTPException(status_code=404, detail="ticket not found")

        submitter_display = _canonical_person_display(f"{payload.operator_id} {payload.operator_name}")
        create_tpl: str | None = None
        if not exists_row and str(payload.template_code or "").strip() == HOTPATCH_TEMPLATE_CODE:
            create_tpl = HOTPATCH_TEMPLATE_CODE
        ticket = _get_or_create_ticket(
            conn,
            ticket_id,
            payload.operator_id,
            payload.operator_name,
            node_key,
            template_code=create_tpl,
            create_intent=bool(payload.create_intent),
        )
        tmpl_code = template_code_for_ticket(conn, int(ticket["id"]))
        if exists_row:
            allow_flow_submit = _ticket_node_allows_flow_submit(conn, ticket, node_key, tmpl_code)
        if tmpl_code == HOTPATCH_TEMPLATE_CODE:
            ensure_hotpatch_frontier(conn, int(ticket["id"]))
            if allow_flow_submit:
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

        if persist_without_flow:
            if not allow_flow_submit:
                for flow_key in AMEND_EXCLUDED_FLOW_KEYS:
                    values.pop(flow_key, None)
                is_amend = True
                is_draft = False
            else:
                is_amend = False
                is_draft = True
            instance = conn.execute(
                """
                INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, action_status)
                VALUES (%s, %s, %s, %s, 'completed')
                RETURNING id
                """,
                (ticket["id"], node["id"], payload.operator_id, submitter_display),
            ).fetchone()
            schema_snapshot: dict[str, Any] = {"node_key": node_key, "fields": fields}
            if is_amend:
                schema_snapshot["amended"] = True
            if is_draft:
                schema_snapshot["draft"] = True
            conn.execute(
                """
                INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, schema_snapshot, created_by)
                VALUES (%s, %s, %s::jsonb, %s::jsonb, %s)
                """,
                (
                    ticket["id"],
                    instance["id"],
                    psycopg.types.json.Jsonb(values),
                    psycopg.types.json.Jsonb(schema_snapshot),
                    payload.operator_id,
                ),
            )
            from ticket_list_snapshot import refresh_ticket_list_snapshot

            refresh_ticket_list_snapshot(conn, int(ticket["id"]))
            maybe_sync_major_issue_after_ticket_field_change(conn, int(ticket["id"]), node_key)
            conn.commit()
            _refresh_ticket_list_snapshot_after_commit(ticket)
            return {
                "ok": True,
                "ticket_id": str(ticket["ticket_no"]),
                "node_key": node_key,
                "amended": is_amend,
                "draft": is_draft,
                "saved": {
                    "values": values,
                    "updated_at": datetime.now().isoformat(),
                    "operator_id": payload.operator_id,
                    "operator_name": submitter_display,
                },
            }

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
            manual_next = str(values.get("next_handler") or "").strip()
            auto_next_handler = _canonical_person_display(manual_next) if manual_next else submitter_display
        elif node_key == "problem_review" and handle_mode == "提交专项轮值表":
            auto_next_handler = _resolve_problem_review_special_rotation_handler(
                conn, str(ticket["ticket_no"]), node_key, values
            )
            if not auto_next_handler:
                auto_next_handler = submitter_display
        elif node_key == "problem_review" and handle_mode == "确认问题":
            auto_next_handler = _current_node_handler_display(conn, int(ticket["id"]), int(ticket["current_node_id"]))
            if not auto_next_handler:
                auto_next_handler = submitter_display

        if auto_next_handler:
            values["next_handler"] = _canonical_person_display(auto_next_handler)

        if node_key == "problem_review" and handle_mode in ("提交其他运维审核", "提交专项轮值表"):
            _maybe_sync_problem_review_transfer_rotation_fairness(
                conn,
                ticket_internal_id=int(ticket["id"]),
                current_node_id=int(ticket["current_node_id"]),
                handle_mode=handle_mode,
                next_handler_display=str(values.get("next_handler") or ""),
            )

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
        should_close = handle_mode in DIRECT_CLOSE_HANDLE_MODES or hp_close_extra
        flow_action_type = (
            "close"
            if should_close and int(next_node["id"]) == int(node["id"])
            else "submit"
        )
        flow_comment = str(handle_mode or "").strip() if flow_action_type == "close" else ""
        conn.execute(
            """
            INSERT INTO ticket_flow_log (
              ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                ticket["id"],
                node["id"],
                next_node["id"],
                flow_action_type,
                payload.operator_id,
                submitter_display,
                flow_comment,
            ),
        )
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
        next_handler_display = str(values.get("next_handler") or "").strip()
        if not should_close and next_handler_display:
            next_handler_account = extract_account_from_person_display(next_handler_display) or ""
            conn.execute(
                """
                INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, action_status)
                VALUES (%s, %s, %s, %s, 'processing')
                """,
                (
                    ticket["id"],
                    next_node["id"],
                    next_handler_account,
                    _canonical_person_display(next_handler_display),
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
        from ticket_list_snapshot import refresh_ticket_list_snapshot

        refresh_ticket_list_snapshot(conn, int(ticket["id"]))
        maybe_sync_major_issue_after_ticket_field_change(conn, int(ticket["id"]), node_key)
        conn.commit()
        _refresh_ticket_list_snapshot_after_commit(ticket)

        audit_log(
            "ticket.flow",
            ticket_no=str(ticket["ticket_no"]),
            from_node=node_key,
            to_node=next_node_key or node_key,
            operator=payload.operator_id,
            handle_mode=handle_mode,
        )
        if next_status == "closed":
            audit_log(
                "ticket.close",
                ticket_no=str(ticket["ticket_no"]),
                from_node=node_key,
                operator=payload.operator_id,
                handle_mode=handle_mode,
            )

        # --- 小鲁班通知：工单到达目标节点时推送消息给处理人 ---
        # 问题审核「确认问题」仅发群通知，不再给下一处理人发私信
        skip_handler_notify = node_key == "problem_review" and handle_mode == "确认问题"
        if (
            tmpl_code == SCHEMA_TEMPLATE_CODE
            and not should_close
            and not skip_handler_notify
            and next_node_key in NOTIFY_ON_ARRIVAL_NODE_KEYS
            and str(values.get("next_handler") or "").strip()
        ):
            try:
                fill_vals = _query_problem_fill_values(conn, str(ticket["ticket_no"]), tmpl_code)
                send_ticket_notification(
                    ticket_no=str(ticket["ticket_no"]),
                    next_node_key=next_node_key,
                    next_handler=str(values.get("next_handler") or ""),
                    problem_fill_values=fill_vals,
                )
            except Exception as e:
                logger.error(
                    f"xiaoluban notification failed for ticket "
                    f"{ticket['ticket_no']} -> {next_node_key}: {e}"
                )

        # --- 小鲁班群通知：问题审核「确认问题」提交后推送群消息 ---
        if (
            tmpl_code == SCHEMA_TEMPLATE_CODE
            and not should_close
            and node_key == "problem_review"
            and handle_mode == "确认问题"
        ):
            try:
                fill_vals = _query_problem_fill_values(conn, str(ticket["ticket_no"]), tmpl_code)
                # 确认问题的 next_handler 即为审核阶段当前处理人（本人）
                send_group_notification(
                    ticket_no=str(ticket["ticket_no"]),
                    problem_fill_values=fill_vals,
                    ops_handler=str(values.get("next_handler") or "").strip(),
                )
            except Exception as e:
                logger.error(
                    f"xiaoluban group notification failed for ticket "
                    f"{ticket['ticket_no']} -> {next_node_key}: {e}"
                )

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

        ticket_closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ticket_ids)

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
                        vals[pk] = _normalize_person_field_value(pk, vals[pk])
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

        from ticket_export import enrich_export_nodes_with_inherited_values
        from ticket_export_fields import NODE_ORDER

        export_node_keys = [nk for nk in NODE_ORDER if nk != "system"]

        # 组装返回数据
        items = []
        for tid in ticket_ids:
            ticket_no = ticket_no_by_id.get(tid, "")
            nodes_data = dict(by_ticket_node.get(tid, {}))
            enrich_export_nodes_with_inherited_values(
                conn, ticket_no, nodes_data, export_node_keys
            )
            instances_data = by_ticket_instance.get(tid, {})
            created_at = ticket_created_at_by_id.get(tid)
            closed_at = ticket_closed_at_by_id.get(tid)
            items.append({
                "ticket_no": ticket_no,
                "nodes": nodes_data,
                "instances": instances_data,
                "created_at": created_at.isoformat() if created_at else None,
                "closed_at": closed_at_iso(closed_at),
            })

    return {"items": items}


@router.post("/export-file")
def export_tickets_file(payload: dict[str, Any]) -> StreamingResponse:
    """
    同步生成工单导出文件（兼容旧调用）。大批量请用 /export-tasks 异步任务。
    payload: {
      operator_id, operator_name, format, range, ticket_nos, selected_fields,
      filename_prefix, list_query: { tab, q, created_from, created_to, column_filters }
    }
    """
    from ticket_export import export_tickets_file as _export_tickets_file

    return _export_tickets_file(
        payload,
        get_whitelist_flags_fn=_get_whitelist_flags,
        normalize_person_fn=_normalize_person_field_value,
        check_export_permission_fn=_check_workbench_export_permission,
    )


@router.post("/export-tasks")
def create_export_task(payload: dict[str, Any]) -> dict[str, Any]:
    """
    创建异步导出任务：立即返回 task_id，后台生成文件后通过 progress/download 取结果。
    避免大批量导出时反向代理 504。
    """
    from ticket_export_task import create_ticket_export_task

    return create_ticket_export_task(
        payload,
        get_whitelist_flags_fn=_get_whitelist_flags,
        check_export_permission_fn=_check_workbench_export_permission,
    )


@router.get("/export-tasks/{task_id:int}/progress")
def get_export_task_progress(
    task_id: int,
    operator_id: str = Query("demo_001"),
) -> dict[str, Any]:
    from ticket_export_task import get_ticket_export_progress

    return get_ticket_export_progress(task_id, operator_id)


@router.get("/export-tasks/{task_id:int}/download")
def download_export_task_file(
    task_id: int,
    operator_id: str = Query("demo_001"),
) -> StreamingResponse:
    from ticket_export_task import download_ticket_export_file

    return download_ticket_export_file(task_id, operator_id)


@router.post("/export-tasks/{task_id:int}/cancel")
def cancel_export_task(
    task_id: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """取消异步导出：立刻停后台任务并删除临时文件。"""
    from ticket_export_task import cancel_ticket_export_task

    body = payload or {}
    operator_id = str(body.get("operator_id") or "demo_001")
    return cancel_ticket_export_task(task_id, operator_id)


@router.get("/doer/{ticket_id}")
def get_ticket_detail_4_doer(ticket_id: str, request: Request) -> dict[str, Any]:
    """Doer 系统专用工单详情查询接口，使用 API Key 鉴权。"""
    tid = str(ticket_id or "").strip()
    if not tid or not (_YW_TICKET_NO_RE.match(tid) or _HPM_TICKET_NO_RE.match(tid)):
        return {"success": True, "ticket": None}

    api_key = request.headers.get("X-Ticket-Key", "").strip()
    if not DOER_TICKET_DETAIL_API_KEY:
        return {"success": False, "detail": "API Key 未配置"}
    if not api_key:
        return {"success": False, "detail": "缺少 API Key"}
    if api_key != DOER_TICKET_DETAIL_API_KEY:
        return {"success": False, "detail": "无效的 API Key"}

    try:
        with db_conn() as conn:
            ticket_row = conn.execute(
                """
                SELECT t.id, t.ticket_no, t.template_id, t.title, t.current_node_id,
                       COALESCE(t.status, 'open') AS status, t.creator_id, t.creator_name,
                       t.created_at, t.updated_at, t.legacy_instance_id, t.flow_context
                FROM ticket t
                WHERE t.ticket_no = %s
                """,
                (tid,),
            ).fetchone()
            if not ticket_row:
                logger.warning("get_ticket_detail not_found ticket=%s", tid)
                return {"success": True, "ticket": None}

            template_row = conn.execute(
                "SELECT id, template_code, template_name, version FROM workflow_template WHERE id = %s",
                (ticket_row["template_id"],),
            ).fetchone()
            if not template_row:
                logger.warning(
                    "get_ticket_detail template_missing ticket=%s template_id=%s",
                    tid,
                    ticket_row["template_id"],
                )
            template_ok = bool(template_row)

            current_node_row = None
            if ticket_row.get("current_node_id"):
                current_node_row = conn.execute(
                    """
                    SELECT wn.id, wn.node_key, wn.node_name, wn.node_order, wn.is_terminal
                    FROM workflow_node wn
                    WHERE wn.id = %s
                    """,
                    (ticket_row["current_node_id"],),
                ).fetchone()

            node_instance_rows = conn.execute(
                """
                SELECT tni.id, tni.node_id, wn.node_key, wn.node_name, wn.node_order,
                       tni.handler_id, tni.handler_name, tni.action_status,
                       tni.started_at, tni.ended_at, tni.created_at
                FROM ticket_node_instance tni
                JOIN workflow_node wn ON wn.id = tni.node_id
                WHERE tni.ticket_id = %s
                ORDER BY wn.node_order, tni.created_at
                """,
                (ticket_row["id"],),
            ).fetchall()

            node_data_rows = conn.execute(
                """
                SELECT tnd.ticket_node_instance_id, tnd.values_json, tnd.schema_snapshot,
                       tnd.created_by, tnd.created_at
                FROM ticket_node_data tnd
                WHERE tnd.ticket_id = %s
                ORDER BY tnd.created_at
                """,
                (ticket_row["id"],),
            ).fetchall()

            data_by_instance: dict[int, list[dict[str, Any]]] = defaultdict(list)
            for ndr in node_data_rows:
                inst_id = int(ndr.get("ticket_node_instance_id") or 0)
                data_by_instance[inst_id].append({
                    "values_json": ndr.get("values_json"),
                    "schema_snapshot": ndr.get("schema_snapshot"),
                    "created_by": ndr.get("created_by"),
                    "created_at": ndr.get("created_at"),
                })

            node_instances: list[dict[str, Any]] = []
            handler_accounts: set[str] = set()
            for nir in node_instance_rows:
                inst_id = int(nir.get("id") or 0)
                handler_acc = str(nir.get("handler_id") or "").strip()
                if handler_acc:
                    handler_accounts.add(handler_acc)
                latest_data = None
                inst_data_list = data_by_instance.get(inst_id, [])
                if inst_data_list:
                    latest_data = inst_data_list[-1]
                vals_json = {}
                if latest_data and isinstance(latest_data.get("values_json"), dict):
                    vals_json = dict(latest_data["values_json"])
                node_instances.append({
                    "instance": {
                        "id": inst_id,
                        "node_id": int(nir.get("node_id") or 0),
                        "node_key": str(nir.get("node_key") or ""),
                        "node_name": str(nir.get("node_name") or ""),
                        "node_order": int(nir.get("node_order") or 0),
                        "handler_id": handler_acc,
                        "handler_name": str(nir.get("handler_name") or ""),
                        "action_status": str(nir.get("action_status") or ""),
                        "started_at": str(nir.get("started_at") or ""),
                        "ended_at": str(nir.get("ended_at") or ""),
                    },
                    "data": vals_json,
                })

            flow_log_rows = conn.execute(
                """
                SELECT tfl.id, tfl.from_node_id, tfl.to_node_id, tfl.action_type,
                       tfl.operator_id, tfl.operator_name, tfl.comment, tfl.created_at,
                       fn.node_key AS from_node_key, fn.node_name AS from_node_name,
                       tn.node_key AS to_node_key, tn.node_name AS to_node_name
                FROM ticket_flow_log tfl
                LEFT JOIN workflow_node fn ON fn.id = tfl.from_node_id
                LEFT JOIN workflow_node tn ON tn.id = tfl.to_node_id
                WHERE tfl.ticket_id = %s
                ORDER BY tfl.created_at ASC, tfl.id ASC
                """,
                (ticket_row["id"],),
            ).fetchall()

            flow_logs: list[dict[str, Any]] = []
            for flr in flow_log_rows:
                operator_acc = str(flr.get("operator_id") or "").strip()
                if operator_acc:
                    handler_accounts.add(operator_acc)
                next_handler_display = ""
                inst_id_for_flow = None
                for ni in node_instances:
                    if ni["instance"].get("node_id") == flr.get("from_node_id"):
                        inst_id_for_flow = ni["instance"].get("id")
                        break
                if inst_id_for_flow and data_by_instance.get(inst_id_for_flow):
                    latest_nd = data_by_instance[inst_id_for_flow][-1]
                    if isinstance(latest_nd.get("values_json"), dict):
                        next_handler_display = str(latest_nd["values_json"].get("next_handler") or "").strip()
                flow_logs.append({
                    "id": int(flr.get("id") or 0),
                    "action_type": str(flr.get("action_type") or ""),
                    "from_node_key": str(flr.get("from_node_key") or ""),
                    "from_node_name": str(flr.get("from_node_name") or ""),
                    "to_node_key": str(flr.get("to_node_key") or ""),
                    "to_node_name": str(flr.get("to_node_name") or ""),
                    "operator_id": operator_acc,
                    "operator_name": str(flr.get("operator_name") or ""),
                    "comment": str(flr.get("comment") or ""),
                    "created_at": str(flr.get("created_at") or ""),
                    "next_handler": _canonical_person_display(next_handler_display),
                })

            snapshot_row = None
            try:
                snapshot_row = conn.execute(
                    """
                    SELECT ticket_id, ticket_no, status, creator_id, creator_name, created_at,
                           node_key, current_stage, start_date, location, biz_env, severity,
                           description_plain, current_handler, is_quality_issue,
                           extra_fields, fields_by_node
                    FROM ticket_list_snapshot
                    WHERE ticket_no = %s
                    """,
                    (tid,),
                ).fetchone()
            except UndefinedTable:
                conn.rollback()
                logger.warning("get_ticket_detail snapshot_table_missing ticket=%s", tid)

            if snapshot_row:
                ch = str(snapshot_row.get("current_handler") or "").strip()
                if ch:
                    ch_acc = extract_account_from_person_display(ch)
                    if ch_acc:
                        handler_accounts.add(ch_acc)

            creator_acc = str(ticket_row.get("creator_id") or "").strip()
            if creator_acc:
                handler_accounts.add(creator_acc)

            reminder_row = None
            try:
                reminder_row = conn.execute(
                    """
                    SELECT id, ticket_no, severity, entered_at, reminder_count, last_reminded_at
                    FROM ticket_reminder_log
                    WHERE ticket_no = %s
                    """,
                    (tid,),
                ).fetchone()
            except UndefinedTable:
                conn.rollback()

            major_issue_row = None
            major_issue_progress: list[dict[str, Any]] = []
            try:
                major_issue_row = conn.execute(
                    """
                    SELECT id, ticket_no, report_date, site_name, event_level, description,
                           ops_analyst, dev_analyst, status, created_at
                    FROM major_issue
                    WHERE ticket_no = %s
                    """,
                    (tid,),
                ).fetchone()
                if major_issue_row:
                    ops_acc = extract_account_from_person_display(str(major_issue_row.get("ops_analyst") or ""))
                    dev_acc = extract_account_from_person_display(str(major_issue_row.get("dev_analyst") or ""))
                    if ops_acc:
                        handler_accounts.add(ops_acc)
                    if dev_acc:
                        handler_accounts.add(dev_acc)
                    progress_rows = conn.execute(
                        """
                        SELECT id, major_issue_id, progress_at, content, risk_measure,
                               creator_id, creator_name, created_at
                        FROM major_issue_progress
                        WHERE major_issue_id = %s
                        ORDER BY progress_at DESC
                        """,
                        (major_issue_row["id"],),
                    ).fetchall()
                    for pr in progress_rows:
                        major_issue_progress.append({
                            "id": int(pr.get("id") or 0),
                            "progress_at": str(pr.get("progress_at") or ""),
                            "content": str(pr.get("content") or ""),
                            "risk_measure": str(pr.get("risk_measure") or ""),
                            "creator_id": str(pr.get("creator_id") or ""),
                            "creator_name": str(pr.get("creator_name") or ""),
                        })
            except UndefinedTable:
                conn.rollback()

            handlers: list[dict[str, Any]] = []
            if handler_accounts:
                handler_rows = conn.execute(
                    """
                    SELECT account, user_name, role_code, group_name, email, contact_phone,
                           product_line, expert_domain, min_dept, is_active
                    FROM user_account
                    WHERE account = ANY(%s)
                    """,
                    (list(handler_accounts),),
                ).fetchall()
                for hr in handler_rows:
                    handlers.append({
                        "account": str(hr.get("account") or ""),
                        "user_name": str(hr.get("user_name") or ""),
                        "role_code": str(hr.get("role_code") or ""),
                        "group_name": str(hr.get("group_name") or ""),
                        "email": str(hr.get("email") or ""),
                        "contact_phone": str(hr.get("contact_phone") or ""),
                        "product_line": str(hr.get("product_line") or ""),
                        "expert_domain": str(hr.get("expert_domain") or ""),
                        "min_dept": str(hr.get("min_dept") or ""),
                        "is_active": bool(hr.get("is_active", True)),
                    })

            site_profile_row = None
            location_name = ""
            if snapshot_row and isinstance(snapshot_row.get("extra_fields"), dict):
                location_name = str(snapshot_row["extra_fields"].get("location") or "").strip()
            elif snapshot_row:
                location_name = str(snapshot_row.get("location") or "").strip()
            if not location_name:
                for ni in node_instances:
                    if ni["instance"].get("node_key") == "problem_fill":
                        location_name = str(ni["data"].get("location") or "").strip()
                        break
            if location_name:
                try:
                    site_profile_row = conn.execute(
                        """
                        SELECT id, site_name, profile_type, product_component, onsite_contract,
                               industry, region, representative_office, stage, tags, delivery_method,
                               report_date, report_nature, ops_personnel, kernel_delivery,
                               kernel_maintenance, service_support, tech_lead, da, sa, td,
                               account_manager, project_manager, service_manager,
                               software_revenue, service_revenue, confirm_receipt_time,
                               risk_description, dtrb_conclusion
                        FROM site_profile
                        WHERE site_name = %s
                        LIMIT 1
                        """,
                        (location_name,),
                    ).fetchone()
                except UndefinedTable:
                    conn.rollback()

            response: dict[str, Any] = {
                "ticket": {
                    "id": int(ticket_row.get("id") or 0),
                    "ticket_no": str(ticket_row.get("ticket_no") or ""),
                    "template_id": int(ticket_row.get("template_id") or 0),
                    "title": str(ticket_row.get("title") or ""),
                    "current_node_id": int(ticket_row.get("current_node_id") or 0) if ticket_row.get("current_node_id") else None,
                    "status": str(ticket_row.get("status") or "open"),
                    "creator_id": str(ticket_row.get("creator_id") or ""),
                    "creator_name": str(ticket_row.get("creator_name") or ""),
                    "created_at": str(ticket_row.get("created_at") or ""),
                    "updated_at": str(ticket_row.get("updated_at") or ""),
                    "legacy_instance_id": ticket_row.get("legacy_instance_id"),
                    "flow_context": ticket_row.get("flow_context"),
                },
                "template": {},
                "current_node": None,
                "node_instances": node_instances,
                "flow_logs": flow_logs,
                "snapshot": None,
                "major_issue": None,
                "reminder": None,
                "handlers": handlers,
                "site_profile": None,
            }

            if template_ok:
                response["template"] = {
                    "id": int(template_row.get("id") or 0),
                    "template_code": str(template_row.get("template_code") or ""),
                    "template_name": str(template_row.get("template_name") or ""),
                    "version": int(template_row.get("version") or 1),
                }

            if current_node_row:
                response["current_node"] = {
                    "id": int(current_node_row.get("id") or 0),
                    "node_key": str(current_node_row.get("node_key") or ""),
                    "node_name": str(current_node_row.get("node_name") or ""),
                    "node_order": int(current_node_row.get("node_order") or 0),
                    "is_terminal": bool(current_node_row.get("is_terminal", False)),
                }

            if snapshot_row:
                extra_fields = snapshot_row.get("extra_fields") if isinstance(snapshot_row.get("extra_fields"), dict) else {}
                fields_by_node = snapshot_row.get("fields_by_node") if isinstance(snapshot_row.get("fields_by_node"), dict) else {}
                response["snapshot"] = {
                    "ticket_id": int(snapshot_row.get("ticket_id") or 0),
                    "ticket_no": str(snapshot_row.get("ticket_no") or ""),
                    "status": str(snapshot_row.get("status") or "open"),
                    "creator_id": str(snapshot_row.get("creator_id") or ""),
                    "creator_name": str(snapshot_row.get("creator_name") or ""),
                    "created_at": str(snapshot_row.get("created_at") or ""),
                    "node_key": str(snapshot_row.get("node_key") or ""),
                    "current_stage": str(snapshot_row.get("current_stage") or ""),
                    "start_date": str(snapshot_row.get("start_date") or ""),
                    "location": str(snapshot_row.get("location") or ""),
                    "biz_env": str(snapshot_row.get("biz_env") or ""),
                    "severity": str(snapshot_row.get("severity") or "一般"),
                    "description_plain": str(snapshot_row.get("description_plain") or ""),
                    "current_handler": str(snapshot_row.get("current_handler") or ""),
                    "is_quality_issue": str(snapshot_row.get("is_quality_issue") or ""),
                    "extra_fields": extra_fields,
                    "fields_by_node": fields_by_node,
                }

            if major_issue_row:
                response["major_issue"] = {
                    "issue": {
                        "id": int(major_issue_row.get("id") or 0),
                        "ticket_no": str(major_issue_row.get("ticket_no") or ""),
                        "report_date": str(major_issue_row.get("report_date") or ""),
                        "site_name": str(major_issue_row.get("site_name") or ""),
                        "event_level": str(major_issue_row.get("event_level") or ""),
                        "description": str(major_issue_row.get("description") or ""),
                        "ops_analyst": str(major_issue_row.get("ops_analyst") or ""),
                        "dev_analyst": str(major_issue_row.get("dev_analyst") or ""),
                        "status": str(major_issue_row.get("status") or "进行中"),
                        "created_at": str(major_issue_row.get("created_at") or ""),
                    },
                    "progress": major_issue_progress,
                }

            if reminder_row:
                response["reminder"] = {
                    "id": int(reminder_row.get("id") or 0),
                    "ticket_no": str(reminder_row.get("ticket_no") or ""),
                    "severity": str(reminder_row.get("severity") or ""),
                    "entered_at": str(reminder_row.get("entered_at") or ""),
                    "reminder_count": int(reminder_row.get("reminder_count") or 0),
                    "last_reminded_at": str(reminder_row.get("last_reminded_at") or ""),
                }

            if site_profile_row:
                response["site_profile"] = {
                    "id": int(site_profile_row.get("id") or 0),
                    "site_name": str(site_profile_row.get("site_name") or ""),
                    "profile_type": str(site_profile_row.get("profile_type") or ""),
                    "product_component": str(site_profile_row.get("product_component") or ""),
                    "onsite_contract": str(site_profile_row.get("onsite_contract") or ""),
                    "industry": str(site_profile_row.get("industry") or ""),
                    "region": str(site_profile_row.get("region") or ""),
                    "representative_office": str(site_profile_row.get("representative_office") or ""),
                    "stage": str(site_profile_row.get("stage") or ""),
                    "tags": str(site_profile_row.get("tags") or ""),
                    "delivery_method": str(site_profile_row.get("delivery_method") or ""),
                    "report_date": str(site_profile_row.get("report_date") or ""),
                    "report_nature": str(site_profile_row.get("report_nature") or ""),
                    "ops_personnel": str(site_profile_row.get("ops_personnel") or ""),
                    "kernel_delivery": str(site_profile_row.get("kernel_delivery") or ""),
                    "kernel_maintenance": str(site_profile_row.get("kernel_maintenance") or ""),
                    "service_support": str(site_profile_row.get("service_support") or ""),
                    "tech_lead": str(site_profile_row.get("tech_lead") or ""),
                    "da": str(site_profile_row.get("da") or ""),
                    "sa": str(site_profile_row.get("sa") or ""),
                    "td": str(site_profile_row.get("td") or ""),
                    "account_manager": str(site_profile_row.get("account_manager") or ""),
                    "project_manager": str(site_profile_row.get("project_manager") or ""),
                    "service_manager": str(site_profile_row.get("service_manager") or ""),
                    "software_revenue": str(site_profile_row.get("software_revenue") or ""),
                    "service_revenue": str(site_profile_row.get("service_revenue") or ""),
                    "confirm_receipt_time": str(site_profile_row.get("confirm_receipt_time") or ""),
                    "risk_description": str(site_profile_row.get("risk_description") or ""),
                    "dtrb_conclusion": str(site_profile_row.get("dtrb_conclusion") or ""),
                }

            return {"success": True, "ticket": response}

    except UndefinedTable as exc:
        logger.error("get_ticket_detail table_missing ticket=%s", tid)
        return {"success": False, "detail": "数据库表未就绪，请执行迁移文件"}
    except psycopg.OperationalError as exc:
        logger.error("get_ticket_detail db_unreachable ticket=%s detail=%s", tid, exc)
        return {"success": False, "detail": "数据库服务不可用"}
    except Exception as exc:
        logger.exception("get_ticket_detail unexpected_error ticket=%s", tid)
        return {"success": False, "detail": f"内部服务错误: {type(exc).__name__}"}