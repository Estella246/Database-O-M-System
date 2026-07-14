from __future__ import annotations
from typing import Any
import logging
import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException, Query
from config import (
    SCHEMA_TEMPLATE_CODE,
    _DUTY_FIELD_OPTION_SET_CODES,
    _VERSION_BASELINE_OPTION_SET_CODES,
    _SITE_PROFILE_OPTION_SET_CODES,
    _FIX_VERSION_FIELD_KEY,
    _FIX_VERSION_UNFIXED_OPTION,
    PERSON_VALUE_FIELD_KEYS,
)
from database import db_conn
from utils import dedupe_preserve_str as _dedupe_preserve_str
from utils.person_options import resolve_person_field_options
from issue_root_cause_params import load_issue_root_cause_map, attach_issue_root_cause_to_field
from version_option_labels import fill_version_baseline_option_map

router = APIRouter(prefix="/api/nodes", tags=["nodes"])
logger = logging.getLogger(__name__)


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
    from collections import defaultdict
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
    from config import _DUTY_FIELD_PATH_SEP
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


@router.get("/{node_key}/schema")
def get_node_schema(
    node_key: str,
    template_code: str = Query(
        SCHEMA_TEMPLATE_CODE,
        description="流程模板编码，热补丁表单传 HOTPATCH",
    ),
    ticket_id: str | None = Query(
        None,
        description="工单号；查看已有工单时传入，用于复活已退役但旧单仍存的 dfx_gap 字段",
    ),
) -> dict[str, Any]:
    tpl = str(template_code or "").strip() or SCHEMA_TEMPLATE_CODE
    try:
        with db_conn() as conn:
            fields = _load_schema(conn, node_key, tpl)
            # 退役字段 dfx_gap：仅对已存值的旧单按工单复活（新单不传 ticket_id → 不复活）
            if ticket_id:
                from utils.dfx_gap import revive_dfx_gap_for_ticket

                revived = revive_dfx_gap_for_ticket(conn, ticket_id, node_key, tpl)
                if revived and not any(f.get("key") == "dfx_gap" for f in fields):
                    fields.append(revived)
        return {"node_key": node_key, "fields": fields}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "get_node_schema failed node=%s template=%s",
            node_key,
            tpl,
        )
        raise HTTPException(status_code=500, detail=f"节点 schema 加载失败：{exc}") from exc