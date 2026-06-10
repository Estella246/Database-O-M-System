"""工单导出：服务端按批查询并生成 Excel/CSV，避免浏览器承载大批量数据。"""
from __future__ import annotations

import csv
import json
import re
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from io import BytesIO, StringIO
from typing import Any, Callable

import psycopg
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

from config import SCHEMA_TEMPLATE_CODE, PERSON_VALUE_FIELD_KEYS
from database import db_conn
from ticket_export_fields import (
    EXPORT_BATCH_SIZE,
    EXPORT_FIELDS_BY_NODE,
    MAX_EXPORT_TICKETS,
    NODE_LABELS,
    NODE_ORDER,
)
from utils.ticket_closed_at import closed_at_iso, fetch_ticket_closed_at_by_id
from utils.ticket_status import ticket_status_is_closed

_IMG_TAG_RE = re.compile(r"<img[^>]*>", re.I)
_FIGURE_TAG_RE = re.compile(r"<figure[^>]*>.*?</figure>", re.I | re.S)


def build_export_columns(selected_fields: dict[str, Any]) -> list[dict[str, Any]]:
    columns: list[dict[str, Any]] = []
    for node_key in NODE_ORDER:
        node_label = NODE_LABELS.get(node_key, node_key)
        fields = EXPORT_FIELDS_BY_NODE.get(node_key) or []
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
    text = _IMG_TAG_RE.sub("", html or "")
    text = _FIGURE_TAG_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _format_sla_dhm(created_at: Any, closed_at: Any, status: str, *, now: datetime | None = None) -> str:
    if not created_at:
        return "--"
    if hasattr(created_at, "timestamp"):
        start = created_at
    else:
        return "--"
    if ticket_status_is_closed(status):
        end = closed_at if closed_at else (now or datetime.now(timezone.utc))
    else:
        end = now or datetime.now(timezone.utc)
    if hasattr(end, "timestamp"):
        delta_sec = max(0.0, (end - start).total_seconds())
    else:
        return "--"
    minutes_total = int(delta_sec // 60)
    days = minutes_total // (60 * 24)
    hours = (minutes_total % (60 * 24)) // 60
    minutes = minutes_total % 60
    return f"{days}天{hours}时{minutes}分"


def _format_cell_value(raw: Any, col: dict[str, Any]) -> str:
    value = "" if raw is None else str(raw)
    if col.get("stripImages") and value:
        value = _strip_images_from_html(value)
    if col.get("type") == "date" and value:
        value = value[:10]
    return value


def fetch_export_items_for_nos(
    conn: psycopg.Connection,
    ticket_nos: list[str],
    *,
    normalize_person_fn: Callable[[str, str], str],
) -> list[dict[str, Any]]:
    if not ticket_nos:
        return []
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
    ticket_closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ticket_ids)

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

    now_utc = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []
    for tid in ticket_ids:
        ticket_no = ticket_no_by_id.get(tid, "")
        created_at = ticket_created_at_by_id.get(tid)
        closed_at = ticket_closed_at_by_id.get(tid)
        status = ticket_status_by_id.get(tid, "open")
        items.append(
            {
                "ticket_no": ticket_no,
                "nodes": by_ticket_node.get(tid, {}),
                "created_at": created_at,
                "closed_at": closed_at,
                "status": status,
                "creator_name": ticket_creator_by_id.get(tid, ""),
            }
        )
    return items


def _fetch_snapshot_system_fields(
    conn: psycopg.Connection, ticket_nos: list[str]
) -> dict[str, dict[str, str]]:
    if not ticket_nos:
        return {}
    rows = conn.execute(
        """
        SELECT tls.ticket_id, tls.ticket_no, tls.current_stage, tls.current_handler,
               tls.creator_name, tls.status, tls.created_at
        FROM ticket_list_snapshot tls
        WHERE tls.ticket_no = ANY(%s)
        """,
        (ticket_nos,),
    ).fetchall()
    ids = [int(r["ticket_id"]) for r in rows if r.get("ticket_id") is not None]
    closed_map = fetch_ticket_closed_at_by_id(conn, ids) if ids else {}
    now_utc = datetime.now(timezone.utc)
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        ticket_no = str(r.get("ticket_no") or "")
        if not ticket_no:
            continue
        tid = int(r.get("ticket_id") or 0)
        status = str(r.get("status") or "open")
        created_at = r.get("created_at")
        closed_at = closed_map.get(tid) if tid else None
        handler = "" if ticket_status_is_closed(status) else str(r.get("current_handler") or "")
        out[ticket_no] = {
            "processId": ticket_no,
            "currentStage": str(r.get("current_stage") or "-"),
            "currentHandler": handler,
            "slaTime": _format_sla_dhm(created_at, closed_at, status, now=now_utc),
            "creatorName": str(r.get("creator_name") or ""),
        }
    return out


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
        ),
        "creatorName": system_fields.get("creatorName") or str(item.get("creator_name") or ""),
    }


def _item_to_row(item: dict[str, Any], columns: list[dict[str, Any]]) -> list[str]:
    row: list[str] = []
    nodes = item.get("nodes") or {}
    for col in columns:
        node_data = nodes.get(col["nodeKey"]) or {}
        raw = node_data.get(col["fieldKey"], "")
        row.append(_format_cell_value(raw, col))
    return row


def _resolve_ticket_nos(
    payload: dict[str, Any],
    *,
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
) -> list[str]:
    export_range = str(payload.get("range") or "selected").strip().lower()
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


def export_tickets_file(
    payload: dict[str, Any],
    *,
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
    normalize_person_fn: Callable[[str, str], str],
    check_export_permission_fn: Callable[[psycopg.Connection, str], None],
) -> StreamingResponse:
    operator_id = str(payload.get("operator_id") or "demo_001").strip()
    export_format = str(payload.get("format") or "xlsx").strip().lower()
    if export_format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format 须为 xlsx 或 csv")

    selected_fields = payload.get("selected_fields") or {}
    if not isinstance(selected_fields, dict):
        raise HTTPException(status_code=400, detail="selected_fields 须为对象")
    columns = build_export_columns(selected_fields)
    if not columns:
        raise HTTPException(status_code=400, detail="请至少选择一个导出字段")

    with db_conn() as conn:
        check_export_permission_fn(conn, operator_id)
        ticket_nos = _resolve_ticket_nos(payload, get_whitelist_flags_fn=get_whitelist_flags_fn)

    if len(ticket_nos) > MAX_EXPORT_TICKETS:
        raise HTTPException(
            status_code=400,
            detail=f"导出条数超过上限 {MAX_EXPORT_TICKETS}，请缩小筛选范围",
        )
    if not ticket_nos:
        raise HTTPException(status_code=400, detail="无可导出的工单数据")

    headers = [c["fullLabel"] for c in columns]
    today = datetime.now().strftime("%Y-%m-%d")
    filename_prefix = str(payload.get("filename_prefix") or "").strip() or f"{operator_id}_{today}"
    extension = "csv" if export_format == "csv" else "xlsx"
    filename = f"{filename_prefix}.{extension}"
    encoded_filename = urllib.parse.quote(filename, safe="")

    if export_format == "csv":
        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(headers)
        with db_conn() as conn:
            for i in range(0, len(ticket_nos), EXPORT_BATCH_SIZE):
                batch = ticket_nos[i : i + EXPORT_BATCH_SIZE]
                items = fetch_export_items_for_nos(
                    conn, batch, normalize_person_fn=normalize_person_fn
                )
                system_map = _fetch_snapshot_system_fields(conn, batch)
                for item in items:
                    ticket_no = str(item.get("ticket_no") or "")
                    sys_fields = system_map.get(ticket_no) or {}
                    _attach_system_fields(item, sys_fields)
                    writer.writerow(_item_to_row(item, columns))
        payload_bytes = ("\ufeff" + buf.getvalue()).encode("utf-8")
        media_type = "text/csv;charset=utf-8"
        return StreamingResponse(
            BytesIO(payload_bytes),
            media_type=media_type,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}'
                )
            },
        )

    wb = Workbook()
    ws = wb.active
    ws.title = "工单数据"
    header_font = Font(bold=True)
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )
    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border

    row_idx = 2
    with db_conn() as conn:
        for i in range(0, len(ticket_nos), EXPORT_BATCH_SIZE):
            batch = ticket_nos[i : i + EXPORT_BATCH_SIZE]
            items = fetch_export_items_for_nos(
                conn, batch, normalize_person_fn=normalize_person_fn
            )
            system_map = _fetch_snapshot_system_fields(conn, batch)
            for item in items:
                ticket_no = str(item.get("ticket_no") or "")
                sys_fields = system_map.get(ticket_no) or {}
                _attach_system_fields(item, sys_fields)
                values = _item_to_row(item, columns)
                for col_idx, value in enumerate(values, start=1):
                    cell = ws.cell(row=row_idx, column=col_idx, value=value)
                    cell.border = thin_border
                row_idx += 1

    for col_idx, col in enumerate(columns, start=1):
        width = min(50, max(12, len(col["fullLabel"]) + 4))
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    out = BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}'
            )
        },
    )
