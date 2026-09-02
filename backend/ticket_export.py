"""工单导出：服务端按批查询并流式生成 Excel/CSV，避免浏览器与进程内存承载大批量数据。"""
from __future__ import annotations

import csv
import json
import os
import re
import tempfile
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from io import StringIO
from typing import Any, Callable, Iterator

import psycopg
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font
from starlette.background import BackgroundTask

from config import SCHEMA_TEMPLATE_CODE, PERSON_VALUE_FIELD_KEYS
from database import db_conn
from hotpatch_config import HOTPATCH_TEMPLATE_CODE
from hotpatch_export_fields import (
    HOTPATCH_EXPORT_FIELDS_BY_NODE,
    HOTPATCH_NODE_LABELS,
    HOTPATCH_NODE_ORDER,
)
from ticket_export_fields import (
    EXPORT_BATCH_SIZE,
    EXPORT_FIELDS_BY_NODE,
    MAX_EXPORT_TICKETS,
    NODE_LABELS,
    NODE_ORDER,
)
from utils.ticket_closed_at import closed_at_iso, fetch_ticket_closed_at_by_id
from utils.ticket_inherited_values import merge_inherited_previous_values
from utils.ticket_sla import fetch_ticket_sla_pause_by_id, format_ticket_sla_dhm
from utils.ticket_status import sql_ticket_list_current_stage, ticket_status_is_closed

_IMG_TAG_RE = re.compile(r"<img[^>]*>", re.I)
# 导出单元格上限：避免报错/堆栈等长文本把 CSV 拆成多物理行
_EXPORT_CELL_MAX_LEN = 2000


def normalize_export_template_code(raw: Any) -> str:
    code = str(raw or "").strip()
    if code == HOTPATCH_TEMPLATE_CODE:
        return HOTPATCH_TEMPLATE_CODE
    return SCHEMA_TEMPLATE_CODE


def payload_export_template_code(payload: dict[str, Any] | None) -> str:
    body = payload if isinstance(payload, dict) else {}
    raw = str(body.get("template_code") or "").strip()
    if not raw:
        list_query = body.get("list_query")
        if isinstance(list_query, dict):
            raw = str(list_query.get("template_code") or "").strip()
    return normalize_export_template_code(raw)


def _export_field_catalog(
    template_code: str,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, str], list[str]]:
    if template_code == HOTPATCH_TEMPLATE_CODE:
        return HOTPATCH_EXPORT_FIELDS_BY_NODE, HOTPATCH_NODE_LABELS, HOTPATCH_NODE_ORDER
    return EXPORT_FIELDS_BY_NODE, NODE_LABELS, NODE_ORDER


def build_export_columns(
    selected_fields: dict[str, Any],
    *,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> list[dict[str, Any]]:
    fields_by_node, node_labels, node_order = _export_field_catalog(
        normalize_export_template_code(template_code)
    )
    columns: list[dict[str, Any]] = []
    for node_key in node_order:
        node_label = node_labels.get(node_key, node_key)
        fields = fields_by_node.get(node_key) or []
        selected_keys = selected_fields.get(node_key) or []
        if not isinstance(selected_keys, list):
            continue
        for field_key in selected_keys:
            field_def = next((f for f in fields if f.get("key") == field_key), None)
            if not field_def:
                continue
            columns.append(
                {
                    "nodeKey": node_key,
                    "fieldKey": field_key,
                    "label": field_def.get("label", field_key),
                    "fullLabel": f"{node_label}-{field_def.get('label', field_key)}",
                    "type": field_def.get("type", "text"),
                    "stripImages": bool(field_def.get("stripImages")),
                }
            )
    return columns


def _strip_images_from_html(html: str) -> str:
    """富文本 HTML 转纯文本（导出用：去除标签、图片、样式，仅保留文字）。"""
    text = str(html or "")
    text = _IMG_TAG_RE.sub(" ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return re.sub(r"\s+", " ", text).strip()


def _format_sla_dhm(
    created_at: Any,
    closed_at: Any,
    status: str,
    *,
    suspended_at: Any = None,
    sla_paused_seconds: int = 0,
    now: datetime | None = None,
) -> str:
    return format_ticket_sla_dhm(
        created_at,
        closed_at,
        status,
        suspended_at=suspended_at,
        sla_paused_seconds=sla_paused_seconds,
        now=now,
    )


def _format_cell_value(raw: Any, col: dict[str, Any]) -> str:
    value = "" if raw is None else str(raw)
    if col.get("stripImages") and value:
        value = _strip_images_from_html(value)
    if col.get("type") == "date" and value:
        return value[:10]
    # 压成单行并截断，避免 CSV 中换行导致「导 N 条却出现多于 N+1 行」
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) > _EXPORT_CELL_MAX_LEN:
        return value[:_EXPORT_CELL_MAX_LEN] + "…"
    return value


_STREAM_CHUNK_BYTES = 64 * 1024


def _load_merge_schema_fields(
    conn: psycopg.Connection, node_key: str, template_code: str = SCHEMA_TEMPLATE_CODE
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT nfd.field_key AS key, nfd.ui_props_json AS ui_props
        FROM node_field_def nfd
        JOIN workflow_node wn ON wn.id = nfd.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s
          AND wn.node_key = %s
          AND nfd.is_active = TRUE
        ORDER BY nfd.sort_order
        """,
        (template_code, node_key),
    ).fetchall()
    return [{"key": r["key"], "ui_props": r["ui_props"] or {}} for r in rows]


def _build_schema_cache(
    conn: psycopg.Connection,
    node_keys: list[str],
    *,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, list[dict[str, Any]]]:
    cache: dict[str, list[dict[str, Any]]] = {}
    for nk in node_keys:
        if nk == "system":
            continue
        cache[nk] = _load_merge_schema_fields(conn, nk, template_code)
    return cache


def enrich_export_nodes_with_inherited_values(
    conn: psycopg.Connection,
    ticket_no: str,
    nodes: dict[str, dict[str, Any]],
    node_keys: list[str],
    *,
    template_code: str = SCHEMA_TEMPLATE_CODE,
    schema_cache: dict[str, list[dict[str, Any]]] | None = None,
) -> None:
    """导出前合并继承字段（慢路径：按单查 ticket_node_data）。无快照回退时使用。"""
    for nk in node_keys:
        if nk == "system":
            continue
        if schema_cache is not None:
            fields = schema_cache.get(nk)
            if fields is None:
                fields = _load_merge_schema_fields(conn, nk, template_code)
                schema_cache[nk] = fields
        else:
            fields = _load_merge_schema_fields(conn, nk, template_code)
        if not fields:
            continue
        current = dict(nodes.get(nk) or {})
        nodes[nk] = merge_inherited_previous_values(
            conn, ticket_no, nk, fields, current, template_code=template_code
        )


def enrich_export_nodes_with_snapshot_inheritance(
    nodes: dict[str, dict[str, Any]],
    node_keys: list[str],
    schema_cache: dict[str, list[dict[str, Any]]],
    *,
    node_order: list[str] | None = None,
) -> None:
    """在快照 fields_by_node 上内存合并 inherit_previous，避免逐单 SQL。"""
    order = [nk for nk in (node_order or NODE_ORDER) if nk != "system"]
    order_idx = {nk: i for i, nk in enumerate(order)}
    for nk in node_keys:
        if nk == "system" or nk not in order_idx:
            continue
        fields = schema_cache.get(nk) or []
        inheritable = [
            str(f.get("key") or "")
            for f in fields
            if isinstance(f.get("ui_props"), dict)
            and bool((f.get("ui_props") or {}).get("inherit_previous"))
            and str(f.get("key") or "").strip()
        ]
        if not inheritable:
            continue
        current = dict(nodes.get(nk) or {})
        pending = [k for k in inheritable if k not in current or current.get(k) in (None, "")]
        if not pending:
            nodes[nk] = current
            continue
        for earlier in reversed(order[: order_idx[nk]]):
            earlier_vals = nodes.get(earlier) or {}
            if not isinstance(earlier_vals, dict):
                continue
            for k in list(pending):
                val = earlier_vals.get(k)
                if val is not None and val != "":
                    current[k] = val
                    pending.remove(k)
            if not pending:
                break
        nodes[nk] = current


def fetch_export_items_for_nos(
    conn: psycopg.Connection,
    ticket_nos: list[str],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str] | None = None,
    schema_cache: dict[str, list[dict[str, Any]]] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> list[dict[str, Any]]:
    """无快照回退：从 ticket_node_data 重建导出行（含继承字段 SQL 合并）。"""
    if not ticket_nos:
        return []
    tpl = normalize_export_template_code(template_code)
    _, _, node_order = _export_field_catalog(tpl)
    rows = conn.execute(
        f"""
        SELECT t.id AS ticket_internal_id, t.ticket_no, t.creator_id, t.creator_name,
               COALESCE(t.status, 'open') AS status, t.created_at,
               {sql_ticket_list_current_stage("t.status", "wn.node_name", "wn.node_key")} AS current_stage
        FROM ticket t
        JOIN workflow_template wtt ON wtt.id = t.template_id
        LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
        WHERE t.ticket_no = ANY(%s) AND wtt.template_code = %s
        ORDER BY t.created_at DESC
        """,
        (ticket_nos, tpl),
    ).fetchall()
    if not rows:
        return []

    ticket_ids = [int(r["ticket_internal_id"]) for r in rows]
    ticket_no_by_id = {int(r["ticket_internal_id"]): str(r["ticket_no"]) for r in rows}
    ticket_created_at_by_id = {int(r["ticket_internal_id"]): r["created_at"] for r in rows}
    ticket_creator_by_id = {
        int(r["ticket_internal_id"]): str(r.get("creator_name") or "")
        for r in rows
    }
    ticket_status_by_id = {
        int(r["ticket_internal_id"]): str(r.get("status") or "open")
        for r in rows
    }
    ticket_stage_by_id = {
        int(r["ticket_internal_id"]): str(r.get("current_stage") or "")
        for r in rows
    }
    ticket_closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ticket_ids)
    ticket_sla_pause_by_id = fetch_ticket_sla_pause_by_id(conn, ticket_ids)

    handler_by_id: dict[int, str] = {}
    if ticket_ids:
        handler_rows = conn.execute(
            """
            SELECT tni.ticket_id, tni.handler_name
            FROM ticket_node_instance tni
            JOIN ticket t ON t.id = tni.ticket_id AND t.current_node_id = tni.node_id
            WHERE tni.ticket_id = ANY(%s)
            ORDER BY tni.ticket_id, tni.id DESC
            """,
            (ticket_ids,),
        ).fetchall()
        for hr in handler_rows:
            tid = int(hr["ticket_id"])
            if tid not in handler_by_id:
                handler_by_id[tid] = str(hr.get("handler_name") or "").strip()

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
        (ticket_ids, tpl),
    ).fetchall()

    by_ticket_node: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    for ndr in node_data_rows:
        tid = int(ndr["ticket_id"])
        nk = str(ndr["node_key"])
        if nk not in by_ticket_node[tid]:
            raw_vals = ndr["values_json"]
            vals = dict(raw_vals) if isinstance(raw_vals, dict) else {}
            for pk in PERSON_VALUE_FIELD_KEYS:
                if pk in vals and isinstance(vals[pk], str):
                    vals[pk] = normalize_person_fn(pk, vals[pk])
            by_ticket_node[tid][nk] = vals

    node_keys = export_node_keys or [nk for nk in node_order if nk != "system"]
    items: list[dict[str, Any]] = []
    for tid in ticket_ids:
        ticket_no = ticket_no_by_id.get(tid, "")
        created_at = ticket_created_at_by_id.get(tid)
        closed_at = ticket_closed_at_by_id.get(tid)
        pause = ticket_sla_pause_by_id.get(tid) or {}
        suspended_at = pause.get("suspended_at")
        sla_paused_seconds = int(pause.get("sla_paused_seconds") or 0)
        status = ticket_status_by_id.get(tid, "open")
        nodes = dict(by_ticket_node.get(tid, {}))
        enrich_export_nodes_with_inherited_values(
            conn,
            ticket_no,
            nodes,
            node_keys,
            template_code=tpl,
            schema_cache=schema_cache,
        )
        current_handler = ""
        if not ticket_status_is_closed(status):
            current_handler = handler_by_id.get(tid) or ""
        items.append(
            {
                "ticket_no": ticket_no,
                "nodes": nodes,
                "created_at": created_at,
                "closed_at": closed_at,
                "suspended_at": suspended_at,
                "sla_paused_seconds": sla_paused_seconds,
                "status": status,
                "creator_name": ticket_creator_by_id.get(tid, ""),
                "current_stage": ticket_stage_by_id.get(tid, ""),
                "current_handler": current_handler,
            }
        )
    return items


def _attach_system_fields(item: dict[str, Any], system_fields: dict[str, str]) -> None:
    nodes = item.setdefault("nodes", {})
    nodes["system"] = {
        "processId": system_fields.get("processId") or item.get("ticket_no") or "",
        "currentStage": system_fields.get("currentStage") or "",
        "currentHandler": system_fields.get("currentHandler") or "",
        "slaTime": system_fields.get("slaTime") or _format_sla_dhm(
            item.get("created_at"),
            item.get("closed_at"),
            str(item.get("status") or "open"),
            suspended_at=item.get("suspended_at"),
            sla_paused_seconds=int(item.get("sla_paused_seconds") or 0),
        ),
        "creatorName": system_fields.get("creatorName") or str(item.get("creator_name") or ""),
    }


def _system_fields_from_snapshot_row(
    row: dict[str, Any],
    *,
    closed_at: Any = None,
    suspended_at: Any = None,
    sla_paused_seconds: int = 0,
    now: datetime | None = None,
) -> dict[str, str]:
    ticket_no = str(row.get("ticket_no") or "")
    status = str(row.get("status") or "open")
    created_at = row.get("created_at")
    handler = "" if ticket_status_is_closed(status) else str(row.get("current_handler") or "")
    return {
        "processId": ticket_no,
        "currentStage": str(row.get("current_stage") or "-"),
        "currentHandler": handler,
        "slaTime": _format_sla_dhm(
            created_at,
            closed_at,
            status,
            suspended_at=suspended_at,
            sla_paused_seconds=sla_paused_seconds,
            now=now,
        ),
        "creatorName": str(row.get("creator_name") or ""),
    }


def fetch_export_items_from_snapshot(
    conn: psycopg.Connection,
    ticket_nos: list[str],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str] | None = None,
    schema_cache: dict[str, list[dict[str, Any]]] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> list[dict[str, Any]]:
    """从 ticket_list_snapshot.fields_by_node 组装导出项；缺快照的单回退慢路径。"""
    if not ticket_nos:
        return []
    tpl = normalize_export_template_code(template_code)
    _, _, node_order = _export_field_catalog(tpl)
    node_keys = export_node_keys or [nk for nk in node_order if nk != "system"]
    if schema_cache is None:
        schema_cache = _build_schema_cache(conn, node_keys, template_code=tpl)

    now_utc = datetime.now(timezone.utc)
    if tpl == HOTPATCH_TEMPLATE_CODE:
        items = fetch_export_items_for_nos(
            conn,
            ticket_nos,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=node_keys,
            schema_cache=schema_cache,
            template_code=tpl,
        )
        for item in items:
            _attach_system_fields(
                item,
                {
                    "processId": str(item.get("ticket_no") or ""),
                    "currentStage": str(item.get("current_stage") or ""),
                    "currentHandler": str(item.get("current_handler") or ""),
                    "slaTime": _format_sla_dhm(
                        item.get("created_at"),
                        item.get("closed_at"),
                        str(item.get("status") or "open"),
                        suspended_at=item.get("suspended_at"),
                        sla_paused_seconds=int(item.get("sla_paused_seconds") or 0),
                        now=now_utc,
                    ),
                    "creatorName": str(item.get("creator_name") or ""),
                },
            )
        return items

    rows = conn.execute(
        """
        SELECT tls.ticket_id, tls.ticket_no, tls.status, tls.creator_name, tls.created_at,
               tls.current_stage, tls.current_handler, tls.fields_by_node
        FROM ticket_list_snapshot tls
        WHERE tls.ticket_no = ANY(%s)
        ORDER BY tls.created_at DESC, tls.ticket_id DESC
        """,
        (ticket_nos,),
    ).fetchall()

    found_nos = {str(r.get("ticket_no") or "") for r in rows if r.get("ticket_no")}
    missing = [n for n in ticket_nos if n not in found_nos]

    ticket_ids = [int(r["ticket_id"]) for r in rows if r.get("ticket_id") is not None]
    closed_map = fetch_ticket_closed_at_by_id(conn, ticket_ids) if ticket_ids else {}
    pause_map = fetch_ticket_sla_pause_by_id(conn, ticket_ids) if ticket_ids else {}
    now_utc = datetime.now(timezone.utc)

    items: list[dict[str, Any]] = []
    for r in rows:
        ticket_no = str(r.get("ticket_no") or "")
        if not ticket_no:
            continue
        tid = int(r.get("ticket_id") or 0)
        fbn_raw = r.get("fields_by_node")
        fbn = fbn_raw if isinstance(fbn_raw, dict) else {}
        nodes: dict[str, dict[str, Any]] = {
            str(nk): dict(fv) for nk, fv in fbn.items() if isinstance(fv, dict)
        }
        enrich_export_nodes_with_snapshot_inheritance(
            nodes, node_keys, schema_cache, node_order=node_order
        )
        status = str(r.get("status") or "open")
        created_at = r.get("created_at")
        closed_at = closed_map.get(tid) if tid else None
        pause = pause_map.get(tid) or {}
        suspended_at = pause.get("suspended_at")
        sla_paused_seconds = int(pause.get("sla_paused_seconds") or 0)
        item: dict[str, Any] = {
            "ticket_no": ticket_no,
            "nodes": nodes,
            "created_at": created_at,
            "closed_at": closed_at,
            "suspended_at": suspended_at,
            "sla_paused_seconds": sla_paused_seconds,
            "status": status,
            "creator_name": str(r.get("creator_name") or ""),
        }
        _attach_system_fields(
            item,
            _system_fields_from_snapshot_row(
                r,
                closed_at=closed_at,
                suspended_at=suspended_at,
                sla_paused_seconds=sla_paused_seconds,
                now=now_utc,
            ),
        )
        items.append(item)

    if missing:
        legacy = fetch_export_items_for_nos(
            conn,
            missing,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=node_keys,
            schema_cache=schema_cache,
            template_code=tpl,
        )
        for item in legacy:
            _attach_system_fields(
                item,
                {
                    "processId": str(item.get("ticket_no") or ""),
                    "currentStage": str(item.get("current_stage") or ""),
                    "currentHandler": str(item.get("current_handler") or ""),
                    "slaTime": _format_sla_dhm(
                        item.get("created_at"),
                        item.get("closed_at"),
                        str(item.get("status") or "open"),
                        suspended_at=item.get("suspended_at"),
                        sla_paused_seconds=int(item.get("sla_paused_seconds") or 0),
                        now=now_utc,
                    ),
                    "creatorName": str(item.get("creator_name") or ""),
                },
            )
            items.append(item)

        def _created_sort_key(it: dict[str, Any]) -> datetime:
            ca = it.get("created_at")
            if ca is None:
                return datetime.min.replace(tzinfo=timezone.utc)
            if getattr(ca, "tzinfo", None) is None:
                return ca.replace(tzinfo=timezone.utc)
            return ca

        items.sort(key=_created_sort_key, reverse=True)
    return items


def _item_to_row(item: dict[str, Any], columns: list[dict[str, Any]]) -> list[str]:
    row: list[str] = []
    nodes = item.get("nodes") or {}
    for col in columns:
        node_data = nodes.get(col["nodeKey"]) or {}
        raw = node_data.get(col["fieldKey"], "")
        row.append(_format_cell_value(raw, col))
    return row


def _iter_export_row_batches(
    conn: psycopg.Connection,
    ticket_nos: list[str],
    columns: list[dict[str, Any]],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str],
    schema_cache: dict[str, list[dict[str, Any]]],
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> Iterator[list[list[str]]]:
    """按批从列表快照查询并产出格式化行，每批处理完即释放中间对象。"""
    for i in range(0, len(ticket_nos), EXPORT_BATCH_SIZE):
        batch = ticket_nos[i : i + EXPORT_BATCH_SIZE]
        items = fetch_export_items_from_snapshot(
            conn,
            batch,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=export_node_keys,
            schema_cache=schema_cache,
            template_code=template_code,
        )
        rows: list[list[str]] = []
        for item in items:
            rows.append(_item_to_row(item, columns))
        yield rows


def _csv_bytes_stream(
    headers: list[str],
    ticket_nos: list[str],
    columns: list[dict[str, Any]],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str],
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> Iterator[bytes]:
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    yield ("\ufeff" + buf.getvalue()).encode("utf-8")
    buf.seek(0)
    buf.truncate(0)
    tpl = normalize_export_template_code(template_code)

    with db_conn() as conn:
        schema_cache = _build_schema_cache(conn, export_node_keys, template_code=tpl)
        for rows in _iter_export_row_batches(
            conn,
            ticket_nos,
            columns,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=export_node_keys,
            schema_cache=schema_cache,
            template_code=tpl,
        ):
            for row in rows:
                writer.writerow(row)
            chunk = buf.getvalue()
            if chunk:
                yield chunk.encode("utf-8")
            buf.seek(0)
            buf.truncate(0)


def _write_xlsx_to_path(
    path: str,
    headers: list[str],
    ticket_nos: list[str],
    columns: list[dict[str, Any]],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str],
    on_progress: Callable[[int], None] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> None:
    """write_only 模式写入指定路径，避免整表驻留内存。"""
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("工单数据")
    header_font = Font(bold=True)
    header_cells: list[WriteOnlyCell] = []
    for header in headers:
        cell = WriteOnlyCell(ws, value=header)
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        header_cells.append(cell)
    ws.append(header_cells)
    tpl = normalize_export_template_code(template_code)

    processed = 0
    with db_conn() as conn:
        schema_cache = _build_schema_cache(conn, export_node_keys, template_code=tpl)
        for rows in _iter_export_row_batches(
            conn,
            ticket_nos,
            columns,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=export_node_keys,
            schema_cache=schema_cache,
            template_code=tpl,
        ):
            for row in rows:
                ws.append(row)
            processed += len(rows)
            if on_progress:
                on_progress(processed)

    wb.save(path)


def _write_csv_to_path(
    path: str,
    headers: list[str],
    ticket_nos: list[str],
    columns: list[dict[str, Any]],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str],
    on_progress: Callable[[int], None] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> None:
    processed = 0
    tpl = normalize_export_template_code(template_code)
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        with db_conn() as conn:
            schema_cache = _build_schema_cache(conn, export_node_keys, template_code=tpl)
            for rows in _iter_export_row_batches(
                conn,
                ticket_nos,
                columns,
                normalize_person_fn=normalize_person_fn,
                export_node_keys=export_node_keys,
                schema_cache=schema_cache,
                template_code=tpl,
            ):
                for row in rows:
                    writer.writerow(row)
                processed += len(rows)
                if on_progress:
                    on_progress(processed)


def write_export_file_to_path(
    path: str,
    export_format: str,
    headers: list[str],
    ticket_nos: list[str],
    columns: list[dict[str, Any]],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str],
    on_progress: Callable[[int], None] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> None:
    fmt = str(export_format or "csv").strip().lower()
    if fmt == "csv":
        _write_csv_to_path(
            path,
            headers,
            ticket_nos,
            columns,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=export_node_keys,
            on_progress=on_progress,
            template_code=template_code,
        )
        return
    if fmt != "xlsx":
        raise ValueError(f"unsupported export format: {fmt}")
    _write_xlsx_to_path(
        path,
        headers,
        ticket_nos,
        columns,
        normalize_person_fn=normalize_person_fn,
        export_node_keys=export_node_keys,
        on_progress=on_progress,
        template_code=template_code,
    )


def _write_xlsx_to_temp_path(
    headers: list[str],
    ticket_nos: list[str],
    columns: list[dict[str, Any]],
    *,
    normalize_person_fn: Callable[[str, str], str],
    export_node_keys: list[str],
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> str:
    """write_only 模式写入临时文件，避免整表驻留内存。"""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
    path = tmp.name
    tmp.close()
    _write_xlsx_to_path(
        path,
        headers,
        ticket_nos,
        columns,
        normalize_person_fn=normalize_person_fn,
        export_node_keys=export_node_keys,
        template_code=template_code,
    )
    return path


def _file_chunk_iterator(path: str, chunk_size: int = _STREAM_CHUNK_BYTES) -> Iterator[bytes]:
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            yield chunk


def _remove_temp_file(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _parse_export_created_ymd(raw: str) -> Any:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def list_hotpatch_export_ticket_nos(
    *,
    operator_id: str,
    q: str = "",
    created_from: str = "",
    created_to: str = "",
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
    max_rows: int = 50_000,
) -> list[str]:
    """补丁管理无列表快照：按模板从 ticket 表取单号（仅自建/日期筛选）。"""
    max_rows = min(50_000, max(1, int(max_rows or 50_000)))
    cf = _parse_export_created_ymd(created_from)
    ct = _parse_export_created_ymd(created_to)
    kw = (q or "").strip()
    with db_conn() as conn:
        flags = get_whitelist_flags_fn(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        clauses = ["wtt.template_code = %s", "(%s = FALSE OR t.creator_id = %s)"]
        params: list[Any] = [HOTPATCH_TEMPLATE_CODE, only_self, operator_id]
        if cf is not None:
            clauses.append("DATE(timezone('Asia/Shanghai', t.created_at)) >= %s")
            params.append(cf)
        if ct is not None:
            clauses.append("DATE(timezone('Asia/Shanghai', t.created_at)) <= %s")
            params.append(ct)
        if kw:
            clauses.append("(t.ticket_no ILIKE %s OR COALESCE(t.title, '') ILIKE %s)")
            like = f"%{kw}%"
            params.extend([like, like])
        params.append(max_rows)
        rows = conn.execute(
            f"""
            SELECT t.ticket_no
            FROM ticket t
            JOIN workflow_template wtt ON wtt.id = t.template_id
            WHERE {" AND ".join(clauses)}
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT %s
            """,
            tuple(params),
        ).fetchall()
    return [str(r.get("ticket_no") or "").strip() for r in rows if str(r.get("ticket_no") or "").strip()]


def _resolve_ticket_nos(
    payload: dict[str, Any],
    *,
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
) -> list[str]:
    export_range = str(payload.get("range") or "selected").strip().lower()
    template_code = payload_export_template_code(payload)
    if export_range == "selected":
        raw = payload.get("ticket_nos") or []
        if not isinstance(raw, list):
            raise HTTPException(status_code=400, detail="ticket_nos 须为数组")
        nos = [str(x or "").strip() for x in raw if str(x or "").strip()]
        if not nos:
            raise HTTPException(status_code=400, detail="当前无选中工单")
        return nos
    if export_range != "all":
        raise HTTPException(status_code=400, detail="range 须为 selected 或 all")

    list_query = payload.get("list_query") or {}
    if not isinstance(list_query, dict):
        list_query = {}

    if template_code == HOTPATCH_TEMPLATE_CODE:
        raw = payload.get("ticket_nos") or []
        if isinstance(raw, list):
            nos = [str(x or "").strip() for x in raw if str(x or "").strip()]
            if nos:
                return nos
        return list_hotpatch_export_ticket_nos(
            operator_id=str(payload.get("operator_id") or "demo_001").strip(),
            q=str(list_query.get("q") or "").strip(),
            created_from=str(list_query.get("created_from") or "").strip(),
            created_to=str(list_query.get("created_to") or "").strip(),
            get_whitelist_flags_fn=get_whitelist_flags_fn,
            max_rows=MAX_EXPORT_TICKETS,
        )

    from ticket_list_snapshot import list_hcs_export_ticket_nos

    operator_id = str(payload.get("operator_id") or "demo_001").strip()
    operator_name = str(payload.get("operator_name") or "").strip()
    column_filters = list_query.get("column_filters") or {}
    column_filters_json = json.dumps(column_filters, ensure_ascii=False) if column_filters else ""
    return list_hcs_export_ticket_nos(
        operator_id=operator_id,
        operator_name=operator_name,
        q=str(list_query.get("q") or "").strip(),
        created_from=str(list_query.get("created_from") or "").strip(),
        created_to=str(list_query.get("created_to") or "").strip(),
        tab=str(list_query.get("tab") or "all").strip(),
        column_filters_json=column_filters_json,
        get_whitelist_flags_fn=get_whitelist_flags_fn,
        max_rows=MAX_EXPORT_TICKETS,
    )


def restrict_ticket_nos_to_template(
    conn: psycopg.Connection, nos: list[str], template_code: str
) -> list[str]:
    """仅保留指定流程模板的单号，避免补丁导出混入工作台工单（或相反）。"""
    tpl = normalize_export_template_code(template_code)
    if not nos:
        return nos
    rows = conn.execute(
        """
        SELECT t.ticket_no
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        WHERE t.ticket_no = ANY(%s) AND wt.template_code = %s
        """,
        (nos, tpl),
    ).fetchall()
    keep = {str(r["ticket_no"]) for r in rows}
    return [n for n in nos if n in keep]


def export_tickets_file(
    payload: dict[str, Any],
    *,
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
    normalize_person_fn: Callable[[str, str], str],
    check_export_permission_fn: Callable[[psycopg.Connection, str], None],
) -> StreamingResponse:
    operator_id = str(payload.get("operator_id") or "demo_001").strip()
    export_format = str(payload.get("format") or "csv").strip().lower()
    if export_format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format 须为 xlsx 或 csv")

    selected_fields = payload.get("selected_fields") or {}
    if not isinstance(selected_fields, dict):
        raise HTTPException(status_code=400, detail="selected_fields 须为对象")
    template_code = payload_export_template_code(payload)
    columns = build_export_columns(selected_fields, template_code=template_code)
    if not columns:
        raise HTTPException(status_code=400, detail="请至少选择一个导出字段")

    with db_conn() as conn:
        check_export_permission_fn(conn, operator_id)
        ticket_nos = _resolve_ticket_nos(payload, get_whitelist_flags_fn=get_whitelist_flags_fn)
        ticket_nos = restrict_ticket_nos_to_template(conn, ticket_nos, template_code)

    if len(ticket_nos) > MAX_EXPORT_TICKETS:
        raise HTTPException(
            status_code=400,
            detail=f"导出条数超过上限 {MAX_EXPORT_TICKETS}，请缩小筛选范围",
        )
    if not ticket_nos:
        raise HTTPException(status_code=400, detail="无可导出的工单数据")

    headers = [c["fullLabel"] for c in columns]
    export_node_keys = list(dict.fromkeys(c["nodeKey"] for c in columns if c.get("nodeKey")))
    today = datetime.now().strftime("%Y-%m-%d")
    filename_prefix = str(payload.get("filename_prefix") or "").strip() or f"{operator_id}_{today}"
    extension = "csv" if export_format == "csv" else "xlsx"
    filename = f"{filename_prefix}.{extension}"
    encoded_filename = urllib.parse.quote(filename, safe="")

    disposition = (
        f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}'
    )

    if export_format == "csv":
        return StreamingResponse(
            _csv_bytes_stream(
                headers,
                ticket_nos,
                columns,
                normalize_person_fn=normalize_person_fn,
                export_node_keys=export_node_keys,
                template_code=template_code,
            ),
            media_type="text/csv;charset=utf-8",
            headers={"Content-Disposition": disposition},
        )

    temp_path = _write_xlsx_to_temp_path(
        headers,
        ticket_nos,
        columns,
        normalize_person_fn=normalize_person_fn,
        export_node_keys=export_node_keys,
        template_code=template_code,
    )
    return StreamingResponse(
        _file_chunk_iterator(temp_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disposition},
        background=BackgroundTask(_remove_temp_file, temp_path),
    )
