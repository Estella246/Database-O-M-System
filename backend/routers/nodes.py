from __future__ import annotations
from typing import Any
import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException
from config import (
    SCHEMA_TEMPLATE_CODE,
    _DUTY_FIELD_OPTION_SET_CODES,
    _VERSION_BASELINE_OPTION_SET_CODES,
    PERSON_VALUE_FIELD_KEYS,
)
from database import db_conn
from utils import (
    dedupe_preserve_str as _dedupe_preserve_str,
    canonical_person_display as _canonical_person_display,
)

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


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
    from collections import defaultdict
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
def get_node_schema(node_key: str) -> dict[str, Any]:
    with db_conn() as conn:
        fields = _load_schema(conn, node_key)
    return {"node_key": node_key, "fields": fields}