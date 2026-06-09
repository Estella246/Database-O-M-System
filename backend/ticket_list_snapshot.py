"""工作台 HCS 工单列表快照：写入 refresh、分页列表、列 facets 查询。"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from typing import Any, Callable

import psycopg
from psycopg.errors import UndefinedTable

from config import SCHEMA_TEMPLATE_CODE, TICKET_LIST_SNAPSHOT_ENABLED
from routers.tickets import WHITELIST_LIST_COLUMN_KEYS
from database import db_conn
from utils.ticket_status import sql_ticket_status_is_closed, ticket_status_is_closed
from utils.ticket_closed_at import closed_at_iso, fetch_ticket_closed_at_by_id

logger = logging.getLogger(__name__)

_EMPTY_FACET = "（空）"
_LIST_CREATED_YMD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SEARCH_TEXT_KEYS: tuple[str, ...] = (
    "orderId",
    "processId",
    "currentStage",
    "currentHandler",
    "startDate",
    "severity",
    "location",
    "bizEnv",
    "creatorName",
    "description",
    "status",
    "start_date",
    "biz_env",
    "component",
    "product_line",
    "hcs_version",
    "hcs_mode",
    "ecare_ticket_no",
    "hcs_owner",
    "issue_desc",
    "handle_mode",
    "issue_type_judge",
    "next_handler",
    "close_reason",
    "issue_intro_module",
    "issue_owner_module",
    "issue_type",
    "root_cause_category",
    "event_level",
    "customer_voice",
    "gauss_version",
    "deploy_mode",
    "kernel_upgrade_involved",
    "kernel_upgrade_time",
    "upgrade_baseline_version",
    "control_version",
    "upgrade_status",
    "error_text",
    "issue_track",
    "has_core_stack",
    "core_stack_text",
    "is_consult_issue",
    "use_doer_assist",
    "doer_no_help_reason",
    "front_pass_through",
    "version_pass_through",
    "is_quality_issue",
    "dts_no",
    "version_pass_reason",
    "collaborator",
    "workaround",
    "root_cause",
    "dfx_gap",
    "error_archive_text",
    "warning_needed",
    "impact_level",
    "sla_analysis",
    "fault_recovery_involved",
    "fault_to_recovery_duration",
)

_SNAPSHOT_COLUMN_FILTERS: dict[str, tuple[str, str]] = {
    "currentStage": ("col", "current_stage"),
    "severity": ("col", "severity"),
    "location": ("col", "location"),
    "bizEnv": ("col", "biz_env"),
    "biz_env": ("col", "biz_env"),
    "currentHandler": ("col", "current_handler"),
    "creatorName": ("col", "creator_name"),
}


def _build_filter_col_to_spec() -> dict[str, tuple[str, str]]:
    spec = dict(_SNAPSHOT_COLUMN_FILTERS)
    for key in WHITELIST_LIST_COLUMN_KEYS:
        if key not in spec:
            spec[key] = ("extra", key)
    return spec


FILTER_COL_TO_SPEC: dict[str, tuple[str, str]] = _build_filter_col_to_spec()
FACET_COL_MAP: dict[str, tuple[str, str]] = dict(FILTER_COL_TO_SPEC)


def snapshot_list_enabled() -> bool:
    return bool(TICKET_LIST_SNAPSHOT_ENABLED)


def _optional_list_created_ymd(raw: str) -> date | None:
    t = str(raw or "").strip()
    if not t or not _LIST_CREATED_YMD_RE.match(t):
        return None
    try:
        return datetime.strptime(t, "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_column_filters(raw: str) -> dict[str, list[str]]:
    if not str(raw or "").strip():
        return {}
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(obj, dict):
        return {}
    out: dict[str, list[str]] = {}
    for k, v in obj.items():
        key = str(k or "").strip()
        if not key:
            continue
        if isinstance(v, list):
            vals = [str(x) for x in v]
        else:
            vals = [str(v)]
        out[key] = vals
    return out


def _pending_handler_sql(alias: str = "tls") -> str:
    return f"""
      LOWER(TRIM(COALESCE({alias}.status, ''))) <> 'closed'
      AND TRIM(COALESCE({alias}.current_handler, '')) <> ''
      AND (
        {alias}.current_handler = %(operator_id)s
        OR (%(operator_name)s <> '' AND {alias}.current_handler = %(operator_name)s)
        OR {alias}.current_handler ILIKE '%%' || %(operator_id)s || '%%'
        OR (%(operator_name)s <> '' AND {alias}.current_handler ILIKE '%%' || %(operator_name)s || '%%')
      )
    """


def _creator_matches_sql(alias: str = "tls") -> str:
    return f"""
      (
        {alias}.creator_id = %(operator_id)s
        OR (%(operator_name)s <> '' AND {alias}.creator_name = %(operator_name)s)
        OR (%(operator_name)s <> '' AND {alias}.creator_name ILIKE '%%' || %(operator_name)s || '%%')
        OR {alias}.creator_name = %(operator_id)s
        OR {alias}.creator_name ILIKE '%%' || %(operator_id)s || '%%'
      )
    """


def _build_filter_clauses(
    column_filters: dict[str, list[str]],
    *,
    exclude_col: str | None = None,
) -> tuple[list[str], dict[str, Any]]:
    clauses: list[str] = []
    extra_params: dict[str, Any] = {}
    idx = 0
    for col_key, picked in column_filters.items():
        if exclude_col and col_key == exclude_col:
            continue
        if not picked:
            continue
        spec = FILTER_COL_TO_SPEC.get(col_key)
        if not spec:
            continue
        kind, field = spec
        include_empty = _EMPTY_FACET in picked
        vals = [v for v in picked if v != _EMPTY_FACET]
        pname = f"filter_vals_{idx}"
        idx += 1
        extra_params[pname] = vals
        if kind == "col":
            expr = f"tls.{field}"
        else:
            expr = f"tls.extra_fields->>'{field}'"
        if include_empty and vals:
            clauses.append(f"(({expr} = ANY(%({pname})s)) OR TRIM(COALESCE({expr}, '')) = '')")
        elif include_empty:
            clauses.append(f"TRIM(COALESCE({expr}, '')) = ''")
        elif vals:
            clauses.append(f"{expr} = ANY(%({pname})s)")
    return clauses, extra_params


def _build_search_text(parts: list[str]) -> str:
    return " ".join(p for p in (str(x or "").strip().lower() for x in parts) if p)


def _ticket_helpers():
    from routers import tickets as t

    return t


def refresh_ticket_list_snapshot(conn: psycopg.Connection, ticket_id: int) -> None:
    t = _ticket_helpers()
    row = conn.execute(
        f"""
        SELECT
          t.id,
          t.ticket_no,
          COALESCE(t.status, 'open') AS status,
          COALESCE(t.creator_name, '') AS creator_name,
          COALESCE(t.creator_id, '') AS creator_id,
          COALESCE(wn.node_key, '') AS node_key,
          wtt.template_code,
          CASE
            WHEN {sql_ticket_status_is_closed("t.status")} THEN '已关闭'
            ELSE COALESCE(NULLIF(TRIM(wn.node_name), ''), NULLIF(TRIM(wn.node_key), ''), '-')
          END AS current_stage,
          CASE
            WHEN {sql_ticket_status_is_closed("t.status")} THEN ''
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
        WHERE t.id = %s
        """,
        (ticket_id,),
    ).fetchone()
    if not row or str(row.get("template_code") or "") != SCHEMA_TEMPLATE_CODE:
        conn.execute("DELETE FROM ticket_list_snapshot WHERE ticket_id = %s", (ticket_id,))
        return

    nd_rows = conn.execute(
        """
        SELECT tnd.values_json, tnd.created_at,
               COALESCE(tnd.schema_snapshot->>'node_key', '') AS node_key
        FROM ticket_node_data tnd
        WHERE tnd.ticket_id = %s
        ORDER BY tnd.created_at ASC
        """,
        (ticket_id,),
    ).fetchall()
    node_rows = [
        {"values_json": r["values_json"], "created_at": r["created_at"], "node_key": r["node_key"]}
        for r in nd_rows
    ]
    snap = t._list_field_snapshot(node_rows)

    created = row["ticket_created_at"]
    if hasattr(created, "strftime"):
        created_day = created.strftime("%Y-%m-%d")
    else:
        created_day = str(created)[:10]
    start_date = str(snap.get("start_date") or snap.get("fill_date") or "").strip() or created_day
    location = str(snap.get("location") or "").strip()
    biz_env = str(snap.get("biz_env") or "").strip()
    is_quality_issue = str(snap.get("is_quality_issue") or "").strip()
    sev = t._severity_from_values({k: snap.get(k) for k in ("severity", "priority")})
    if not sev:
        sev = "一般"
    desc_raw = str(snap.get("_description_raw") or "").strip()
    desc_plain = t._strip_html_list_preview(desc_raw) if desc_raw else ""
    title_fallback = str(row.get("ticket_title") or "").strip()
    if not desc_plain and title_fallback:
        desc_plain = title_fallback
    if not desc_plain:
        desc_plain = "--"

    if ticket_status_is_closed(row["status"]):
        handler_display = ""
    else:
        handler_display = str(snap.get("_last_submit_next_handler") or "").strip()
        if not handler_display:
            handler_display = str(row["current_handler"] or "").strip()
        if not handler_display:
            handler_display = str(row.get("creator_name") or "").strip()
        if not handler_display:
            handler_display = str(row.get("creator_id") or "").strip()

    all_fields = snap.get("_all_fields") or {}
    extra_fields: dict[str, str] = {}
    for k, v in all_fields.items():
        if k in t.RICHTEXT_COLUMN_KEYS:
            extra_fields[k] = t._strip_html_list_preview(str(v or ""), 200)
        else:
            extra_fields[k] = str(v or "").strip()

    fields_by_node = snap.get("_fields_by_node") or {}
    order_id = str(row["ticket_no"])
    item_for_search: dict[str, Any] = {
        "orderId": order_id,
        "processId": order_id,
        "currentStage": str(row["current_stage"] or "-"),
        "currentHandler": handler_display,
        "startDate": start_date,
        "severity": sev,
        "location": location,
        "bizEnv": biz_env,
        "creatorName": str(row["creator_name"] or ""),
        "description": desc_plain,
        "status": str(row["status"] or "open"),
        **extra_fields,
    }
    search_parts: list[str] = [
        order_id,
        str(row.get("creator_id") or ""),
        str(row.get("creator_name") or ""),
        str(row["current_stage"] or ""),
        handler_display,
        desc_plain,
        location,
        biz_env,
        sev,
        start_date,
    ]
    for key in SEARCH_TEXT_KEYS:
        val = item_for_search.get(key)
        if val is not None and str(val).strip():
            search_parts.append(str(val))
    for v in extra_fields.values():
        if str(v).strip():
            search_parts.append(str(v))
    search_text = _build_search_text(search_parts)

    conn.execute(
        """
        INSERT INTO ticket_list_snapshot (
          ticket_id, ticket_no, template_code, status, creator_id, creator_name,
          created_at, node_key, current_stage, start_date, location, biz_env,
          severity, description_plain, current_handler, is_quality_issue,
          extra_fields, fields_by_node, search_text, updated_at
        ) VALUES (
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s,
          %s::jsonb, %s::jsonb, %s, NOW()
        )
        ON CONFLICT (ticket_id) DO UPDATE SET
          ticket_no = EXCLUDED.ticket_no,
          template_code = EXCLUDED.template_code,
          status = EXCLUDED.status,
          creator_id = EXCLUDED.creator_id,
          creator_name = EXCLUDED.creator_name,
          created_at = EXCLUDED.created_at,
          node_key = EXCLUDED.node_key,
          current_stage = EXCLUDED.current_stage,
          start_date = EXCLUDED.start_date,
          location = EXCLUDED.location,
          biz_env = EXCLUDED.biz_env,
          severity = EXCLUDED.severity,
          description_plain = EXCLUDED.description_plain,
          current_handler = EXCLUDED.current_handler,
          is_quality_issue = EXCLUDED.is_quality_issue,
          extra_fields = EXCLUDED.extra_fields,
          fields_by_node = EXCLUDED.fields_by_node,
          search_text = EXCLUDED.search_text,
          updated_at = NOW()
        """,
        (
            ticket_id,
            order_id,
            SCHEMA_TEMPLATE_CODE,
            str(row["status"] or "open"),
            str(row.get("creator_id") or ""),
            str(row.get("creator_name") or ""),
            row["ticket_created_at"],
            str(row["node_key"] or ""),
            str(row["current_stage"] or "-"),
            start_date,
            location,
            biz_env,
            sev,
            desc_plain,
            handler_display,
            is_quality_issue,
            psycopg.types.json.Jsonb(extra_fields),
            psycopg.types.json.Jsonb(fields_by_node),
            search_text,
        ),
    )


def refresh_all_hcs_snapshots(batch_size: int = 500) -> dict[str, int]:
    done = 0
    ids: list[int] = []
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.id
            FROM ticket t
            JOIN workflow_template wtt ON wtt.id = t.template_id
            WHERE wtt.template_code = %s
            ORDER BY t.id
            """,
            (SCHEMA_TEMPLATE_CODE,),
        ).fetchall()
        ids = [int(r["id"]) for r in rows]
    total = len(ids)
    if total == 0:
        logger.info("snapshot backfill skip: no HCS tickets")
        return {"refreshed": 0, "total": 0}

    progress_step = max(1, min(100, total // 10)) if total > 100 else max(1, total)
    logger.info(
        "snapshot backfill start total=%s batch_commit=%s progress_step=%s",
        total,
        batch_size if batch_size > 0 else "all_at_end",
        progress_step,
    )

    with db_conn() as conn:
        for tid in ids:
            refresh_ticket_list_snapshot(conn, tid)
            done += 1
            if done == 1 or done == total or done % progress_step == 0:
                logger.info("snapshot backfill progress done=%s total=%s", done, total)
            if batch_size > 0 and done % batch_size == 0:
                conn.commit()
                logger.info("snapshot backfill batch committed done=%s total=%s", done, total)
        conn.commit()

    logger.info("snapshot backfill done refreshed=%s total=%s", done, total)
    return {"refreshed": done, "total": total}


def _snapshot_row_to_item(
    row: dict[str, Any],
    *,
    operator_submitted: bool,
    closed_at: Any = None,
) -> dict[str, Any]:
    created_raw = row.get("created_at")
    if created_raw is not None and hasattr(created_raw, "isoformat"):
        created_at_str = created_raw.isoformat()
    else:
        created_at_str = str(created_raw or "")
    extra = row.get("extra_fields") if isinstance(row.get("extra_fields"), dict) else {}
    fields_by_node = row.get("fields_by_node") if isinstance(row.get("fields_by_node"), dict) else {}
    order_id = str(row.get("ticket_no") or "")
    status = str(row.get("status") or "open")
    handler = str(row.get("current_handler") or "")
    if status.lower() == "closed":
        handler = ""
    return {
        "orderId": order_id,
        "status": status,
        "node_key": str(row.get("node_key") or ""),
        "templateCode": SCHEMA_TEMPLATE_CODE,
        "processId": order_id,
        "currentStage": str(row.get("current_stage") or "-"),
        "startDate": str(row.get("start_date") or ""),
        "location": str(row.get("location") or ""),
        "bizEnv": str(row.get("biz_env") or ""),
        "isQualityIssue": str(row.get("is_quality_issue") or ""),
        "is_quality_issue": str(row.get("is_quality_issue") or ""),
        "currentHandler": handler,
        "severity": str(row.get("severity") or "一般"),
        "description": str(row.get("description_plain") or "--"),
        "node": str(row.get("current_stage") or "-"),
        "assignee": handler,
        "creatorName": str(row.get("creator_name") or ""),
        "creatorId": str(row.get("creator_id") or ""),
        "createdAt": created_at_str,
        "closedAt": closed_at_iso(closed_at),
        "operatorSubmitted": operator_submitted,
        **extra,
        "_fieldsByNode": fields_by_node,
    }


def _base_where(
    *,
    only_self: bool,
    exact_no: str,
    cf: date | None,
    ct: date | None,
    kw: str,
    tab: str,
    column_filters: dict[str, list[str]],
    exclude_filter_col: str | None = None,
) -> tuple[str, dict[str, Any]]:
    clauses = [
        "tls.template_code = %(template_code)s",
        "(%(only_self)s = FALSE OR tls.creator_id = %(operator_id)s)",
    ]
    params: dict[str, Any] = {
        "template_code": SCHEMA_TEMPLATE_CODE,
        "only_self": only_self,
        "operator_id": "",
        "operator_name": "",
    }
    if exact_no:
        clauses.append("tls.ticket_no = %(exact_no)s")
        params["exact_no"] = exact_no
    if cf is not None:
        clauses.append("DATE(timezone('Asia/Shanghai', tls.created_at)) >= %(created_from)s")
        params["created_from"] = cf
    if ct is not None:
        clauses.append("DATE(timezone('Asia/Shanghai', tls.created_at)) <= %(created_to)s")
        params["created_to"] = ct
    if kw:
        clauses.append("tls.search_text ILIKE %(search_pat)s")
        params["search_pat"] = f"%{kw}%"
    tab_norm = str(tab or "all").strip().lower()
    if tab_norm == "pending":
        clauses.append(_pending_handler_sql())
    elif tab_norm == "created":
        clauses.append(_creator_matches_sql())
    filter_clauses, filter_params = _build_filter_clauses(
        column_filters, exclude_col=exclude_filter_col
    )
    clauses.extend(filter_clauses)
    params.update(filter_params)
    return " AND ".join(clauses), params


def list_tickets_hcs_from_snapshot(
    *,
    operator_id: str,
    operator_name: str = "",
    q: str = "",
    ticket_no: str = "",
    created_from: str = "",
    created_to: str = "",
    tab: str = "all",
    page: int = 1,
    page_size: int = 20,
    column_filters_json: str = "",
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
) -> dict[str, Any]:
    kw = (q or "").strip().lower()
    exact_no = str(ticket_no or "").strip()
    t = _ticket_helpers()
    if exact_no and not (t._YW_TICKET_NO_RE.match(exact_no) or t._HPM_TICKET_NO_RE.match(exact_no)):
        exact_no = ""
    cf = _optional_list_created_ymd(created_from)
    ct = _optional_list_created_ymd(created_to)
    page = max(1, int(page or 1))
    page_size = min(100, max(1, int(page_size or 20)))
    column_filters = _parse_column_filters(column_filters_json)

    with db_conn() as conn:
        try:
            conn.execute("SELECT 1 FROM ticket_list_snapshot LIMIT 1").fetchone()
        except UndefinedTable:
            conn.rollback()
            raise RuntimeError("ticket_list_snapshot table missing; run migration 0079")

        flags = get_whitelist_flags_fn(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        where_sql, params = _base_where(
            only_self=only_self,
            exact_no=exact_no,
            cf=cf,
            ct=ct,
            kw=kw,
            tab=tab,
            column_filters=column_filters,
        )
        params["operator_id"] = operator_id
        params["operator_name"] = str(operator_name or "").strip()

        total_row = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM ticket_list_snapshot tls WHERE {where_sql}",
            params,
        ).fetchone()
        total = int((total_row or {}).get("cnt") or 0)
        offset = (page - 1) * page_size
        rows = conn.execute(
            f"""
            SELECT tls.*
            FROM ticket_list_snapshot tls
            WHERE {where_sql}
            ORDER BY tls.created_at DESC, tls.ticket_id DESC
            LIMIT %(limit)s OFFSET %(offset)s
            """,
            {**params, "limit": page_size, "offset": offset},
        ).fetchall()

        ids = [int(r["ticket_id"]) for r in rows]
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
            ticket_closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ids)
        else:
            ticket_closed_at_by_id = {}

        items = [
            _snapshot_row_to_item(
                dict(r),
                operator_submitted=int(r["ticket_id"]) in submitted_ids,
                closed_at=ticket_closed_at_by_id.get(int(r["ticket_id"])),
            )
            for r in rows
        ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "list_mode": "snapshot",
    }


def list_tickets_hcs_facets(
    *,
    operator_id: str,
    operator_name: str = "",
    column: str,
    q: str = "",
    created_from: str = "",
    created_to: str = "",
    tab: str = "all",
    column_filters_json: str = "",
    prefix: str = "",
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
    limit: int = 2000,
) -> dict[str, Any]:
    col_key = str(column or "").strip()
    spec = FACET_COL_MAP.get(col_key)
    if not spec:
        raise ValueError(f"unsupported facet column: {column}")
    kind, field = spec
    kw = (q or "").strip().lower()
    cf = _optional_list_created_ymd(created_from)
    ct = _optional_list_created_ymd(created_to)
    column_filters = _parse_column_filters(column_filters_json)
    limit = min(5000, max(1, int(limit or 2000)))
    prefix_low = str(prefix or "").strip().lower()

    with db_conn() as conn:
        flags = get_whitelist_flags_fn(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        where_sql, params = _base_where(
            only_self=only_self,
            exact_no="",
            cf=cf,
            ct=ct,
            kw=kw,
            tab=tab,
            column_filters=column_filters,
            exclude_filter_col=col_key,
        )
        params["operator_id"] = operator_id
        params["operator_name"] = str(operator_name or "").strip()

        if kind == "col":
            val_expr = f"tls.{field}"
        else:
            val_expr = f"tls.extra_fields->>'{field}'"

        prefix_clause = ""
        if prefix_low:
            prefix_clause = f"AND LOWER(COALESCE({val_expr}, '')) LIKE %(prefix_pat)s"
            params["prefix_pat"] = f"{prefix_low}%"

        sql = f"""
            SELECT DISTINCT
              CASE
                WHEN TRIM(COALESCE({val_expr}, '')) = '' THEN '{_EMPTY_FACET}'
                ELSE TRIM({val_expr})
              END AS display_value
            FROM ticket_list_snapshot tls
            WHERE {where_sql}
            {prefix_clause}
            ORDER BY display_value
            LIMIT %(facet_limit)s
        """
        params["facet_limit"] = limit
        rows = conn.execute(sql, params).fetchall()
    values = [str(r["display_value"]) for r in rows if r.get("display_value") is not None]
    return {"column": col_key, "values": values, "list_mode": "snapshot"}
