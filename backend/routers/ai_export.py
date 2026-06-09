from __future__ import annotations

import json
import logging
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException

from config import _AI_EXPORT_SCHEMA_HINT
from database import db_conn
from models import AiExportTaskCreatePayload
from whitelist_policy import whitelist_permission_level, whitelist_field_levels

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-export", tags=["ai-export"])


def _ai_export_table_ready(conn: psycopg.Connection) -> bool:
    """Check if ai_export_task table exists."""
    r = conn.execute("SELECT to_regclass('public.ai_export_task') AS name").fetchone()
    return bool(r and r.get("name"))


def _require_ai_export_enabled(conn: psycopg.Connection, operator_id: str) -> None:
    """Check ai_export whitelist permission — raise 403 if hidden."""
    wl = whitelist_field_levels(conn, operator_id)
    if whitelist_permission_level(wl, "ai_export") == "hidden":
        raise HTTPException(status_code=403, detail="无数据智析权限")


def _check_table_ready(conn: psycopg.Connection) -> None:
    """Raise 503 with schema hint if ai_export tables not migrated."""
    if not _ai_export_table_ready(conn):
        raise HTTPException(status_code=503, detail=_AI_EXPORT_SCHEMA_HINT)


def _values_json_as_dict(raw: Any) -> dict[str, Any]:
    """Parse ticket_node_data.values_json into dict — handles dict or JSON string."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


def _build_query_sql(source_config: dict, original_columns: list[str]) -> tuple[str, list[Any]]:
    """Build SQL to query ticket data based on source_config.

    Returns (sql, params) tuple.

    Strategy:
    - Query ticket + ticket_node_data across all nodes
    - Flatten values_json from all node instances into a single row per ticket
    - Filter by template_code and time_range
    - Only extract columns listed in original_columns
    """
    from config import SCHEMA_TEMPLATE_CODE

    template_code = str(source_config.get("template_code") or "").strip() or SCHEMA_TEMPLATE_CODE
    time_range = source_config.get("time_range") or {}

    where_parts = ["wt.template_code = %s"]
    params: list[Any] = [template_code]

    time_from = str(time_range.get("from") or "").strip()
    time_to = str(time_range.get("to") or "").strip()
    if time_from:
        where_parts.append("DATE(timezone('Asia/Shanghai', t.created_at)) >= %s")
        params.append(time_from)
    if time_to:
        where_parts.append("DATE(timezone('Asia/Shanghai', t.created_at)) <= %s")
        params.append(time_to)

    # Additional filters from source_config
    filters = source_config.get("filters") or {}
    if isinstance(filters, dict):
        for fk, fv in filters.items():
            if fk and fv:
                where_parts.append("t.ticket_no != ''")  # placeholder for future filter support

    where_sql = " AND ".join(where_parts)

    # Query tickets with their node data
    # For each ticket, collect all values_json from all nodes, merge them,
    # then extract only the requested original_columns
    sql = f"""
    SELECT
      t.id AS ticket_id,
      t.ticket_no,
      t.created_at AS ticket_created_at,
      t.status AS ticket_status
    FROM ticket t
    JOIN workflow_template wt ON wt.id = t.template_id
    WHERE {where_sql}
    ORDER BY t.created_at DESC, t.id DESC
    """

    return sql, params


def _fetch_ticket_data_and_write_rows(
    conn: psycopg.Connection,
    task_id: int,
    source_config: dict,
    original_columns: list[str],
) -> int:
    """Query ticket data, flatten node fields, write rows into ai_export_row.

    Returns total_rows written.
    """
    from config import SCHEMA_TEMPLATE_CODE

    template_code = str(source_config.get("template_code") or "").strip() or SCHEMA_TEMPLATE_CODE

    query_sql, query_params = _build_query_sql(source_config, original_columns)
    ticket_rows = conn.execute(query_sql, tuple(query_params)).fetchall()

    if not ticket_rows:
        return 0

    ticket_ids = [int(r["ticket_id"]) for r in ticket_rows]

    # Fetch all node data for these tickets
    nd_rows = conn.execute(
        """
        SELECT tnd.ticket_id, tnd.values_json, tnd.created_at,
               COALESCE(tnd.schema_snapshot->>'node_key', '') AS node_key
        FROM ticket_node_data tnd
        WHERE tnd.ticket_id = ANY(%s)
        ORDER BY tnd.ticket_id, tnd.created_at ASC
        """,
        (ticket_ids,),
    ).fetchall()

    # Group node data by ticket_id, flatten values per ticket
    by_ticket: dict[int, list[dict[str, Any]]] = {}
    for nr in nd_rows:
        tid = int(nr["ticket_id"])
        by_ticket.setdefault(tid, []).append(nr)

    # Build flattened original_data per ticket, only including requested columns
    row_index = 0
    for t_row in ticket_rows:
        tid = int(t_row["ticket_id"])
        node_data_list = by_ticket.get(tid, [])

        # Merge all values_json across nodes (last value wins per key, like _list_field_snapshot)
        merged: dict[str, Any] = {}
        # Sort by created_at ascending — last value takes precedence
        sorted_nodes = sorted(node_data_list, key=lambda r: r["created_at"] or "")
        for nd in sorted_nodes:
            v = _values_json_as_dict(nd.get("values_json"))
            for key in original_columns:
                val = v.get(key)
                if val is not None and str(val).strip() != "":
                    merged[key] = val

        # Always include ticket_no and basic ticket info
        merged["ticket_no"] = str(t_row["ticket_no"] or "")
        if "created_at" in original_columns and t_row.get("ticket_created_at"):
            created_at = t_row["ticket_created_at"]
            merged["created_at"] = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)

        # Write row — only if at least ticket_no exists
        if merged.get("ticket_no"):
            conn.execute(
                """
                INSERT INTO ai_export_row (task_id, row_index, original_data)
                VALUES (%s, %s, %s::jsonb)
                """,
                (task_id, row_index, json.dumps(merged, ensure_ascii=False, default=str)),
            )
            row_index += 1

    return row_index


# ── POST /tasks — Create task (query DB + write rows) ──


@router.post("/tasks")
def create_ai_export_task(payload: AiExportTaskCreatePayload) -> dict[str, Any]:
    """Create an AI Export task: query ticket data and write to ai_export_row."""
    op = payload.operator_id.strip() or "demo_001"
    source_config = payload.source_config or {}
    original_columns = payload.original_columns or []

    with db_conn() as conn:
        _check_table_ready(conn)
        _require_ai_export_enabled(conn, op)

        # Create task record
        row = conn.execute(
            """
            INSERT INTO ai_export_task
              (creator_id, status, source_config, original_columns, total_rows, rule_description)
            VALUES (%s, 'draft', %s::jsonb, %s::jsonb, 0, '')
            RETURNING id, status, total_rows
            """,
            (
                op,
                json.dumps(source_config, ensure_ascii=False),
                json.dumps(original_columns, ensure_ascii=False),
            ),
        ).fetchone()
        task_id = int(row["id"])

        # Query ticket data and write rows
        total_rows = _fetch_ticket_data_and_write_rows(conn, task_id, source_config, original_columns)

        # Update task with total_rows
        conn.execute(
            "UPDATE ai_export_task SET total_rows = %s, updated_at = NOW() WHERE id = %s",
            (total_rows, task_id),
        )
        conn.commit()

    return {"task_id": task_id, "status": "draft", "total_rows": total_rows}


# ── GET /tasks — List current user tasks (lightweight) ──


@router.get("/tasks")
def list_ai_export_tasks(
    operator_id: str = "demo_001",
    page: int = 1,
    size: int = 20,
    status: str = "",
) -> dict[str, Any]:
    """List current user's AI Export tasks — lightweight fields only."""
    op = operator_id.strip() or "demo_001"
    page = max(1, page)
    size = max(1, min(100, size))

    with db_conn() as conn:
        _check_table_ready(conn)
        _require_ai_export_enabled(conn, op)

        where_parts = ["t.creator_id = %s"]
        params: list[Any] = [op]
        if status.strip():
            where_parts.append("t.status = %s")
            params.append(status.strip())

        where_sql = " AND ".join(where_parts)

        # Total count
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM ai_export_task t WHERE {where_sql}",
            tuple(params),
        ).fetchone()["cnt"]

        # Lightweight select — no transform_rules / report_html
        offset = (page - 1) * size
        rows = conn.execute(
            f"""
            SELECT
              t.id AS task_id,
              t.status,
              t.total_rows,
              t.created_at,
              t.excel_downloaded_at,
              t.report_status,
              COALESCE(ua.user_name, t.creator_id) AS creator_display_name
            FROM ai_export_task t
            LEFT JOIN user_account ua ON ua.account = t.creator_id
            WHERE {where_sql}
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params + [size, offset]),
        ).fetchall()

    items = [dict(r) for r in rows]
    return {"items": items, "total": total, "page": page, "size": size}


# ── GET /tasks/{task_id} — Get task detail ──


@router.get("/tasks/{task_id:int}")
def get_ai_export_task(task_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    """Get task detail — all fields except report_html."""
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)
        _require_ai_export_enabled(conn, op)

        row = conn.execute(
            """
            SELECT
              id, creator_id, status, source_config, original_columns,
              transform_rules, rule_description, total_rows, processed_rows,
              preview_done, error_message, excel_downloaded_at,
              report_status, report_prompt, created_at, updated_at
            FROM ai_export_task
            WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(row["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可查看")

    return dict(row)


# ── DELETE /tasks/{task_id} — Delete task and data ──


@router.delete("/tasks/{task_id:int}")
def delete_ai_export_task(task_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    """Delete task and all associated rows (CASCADE)."""
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)
        _require_ai_export_enabled(conn, op)

        existing = conn.execute(
            "SELECT id, creator_id FROM ai_export_task WHERE id = %s",
            (task_id,),
        ).fetchone()

        if not existing:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可删除")

        # CASCADE will delete ai_export_row automatically
        conn.execute("DELETE FROM ai_export_task WHERE id = %s", (task_id,))
        conn.commit()

    return {"ok": True}