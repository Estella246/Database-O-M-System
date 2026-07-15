"""工作台 HCS 工单列表快照：写入 refresh、分页列表、列 facets 查询。"""
from __future__ import annotations

import gc
import json
import logging
import re
from datetime import date, datetime
from typing import Any, Callable

import psycopg
from psycopg.errors import UndefinedTable

from config import (
    SCHEMA_TEMPLATE_CODE,
    SNAPSHOT_REFRESH_BATCH_SIZE,
    TICKET_LIST_SNAPSHOT_ENABLED,
    TICKET_STATS_DAILY_ENABLED,
)
from routers.tickets import WHITELIST_LIST_COLUMN_KEYS
from database import db_conn
from utils.ticket_status import (
    sql_ticket_list_current_stage,
    sql_ticket_status_is_closed,
    ticket_status_is_closed,
)
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


def _operator_submitted_sql(alias: str = "tls") -> str:
    return f"""
      EXISTS (
        SELECT 1 FROM ticket_node_data tnd
        WHERE tnd.ticket_id = {alias}.ticket_id
          AND tnd.created_by = %(operator_id)s
      )
    """


def _home_pending_close_sql(alias: str = "tls") -> str:
    """我的主页「待关单」：未终态关闭且本人曾在任意节点提交过。"""
    return f"""
      NOT ({sql_ticket_status_is_closed(f"{alias}.status")})
      AND {_operator_submitted_sql(alias)}
    """


def _home_audit_close_sql(alias: str = "tls") -> str:
    """我的主页「待审核关闭」：当前在 audit_close 且处理人为本人。"""
    return f"""
      {alias}.node_key = 'audit_close'
      AND NOT ({sql_ticket_status_is_closed(f"{alias}.status")})
      AND {_pending_handler_sql(alias)}
    """


def _home_handled_sql(alias: str = "tls") -> str:
    """我的主页 / 工作台「曾处理」：本人曾在任意节点提交过（含已关闭）。"""
    return _operator_submitted_sql(alias)


def _collaborated_sql(alias: str = "tls") -> str:
    """工作台「曾协同」：协同处理人字段含本人（多人分隔串子串匹配）。"""
    return f"""
      TRIM(COALESCE({alias}.extra_fields->>'collaborator', '')) <> ''
      AND (
        {alias}.extra_fields->>'collaborator' = %(operator_id)s
        OR (%(operator_name)s <> '' AND {alias}.extra_fields->>'collaborator' = %(operator_name)s)
        OR {alias}.extra_fields->>'collaborator' ILIKE '%%' || %(operator_id)s || '%%'
        OR (%(operator_name)s <> '' AND {alias}.extra_fields->>'collaborator' ILIKE '%%' || %(operator_name)s || '%%')
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


def _snapshot_search_parts(
    *,
    order_id: str,
    creator_id: str,
    creator_name: str,
    current_stage: str,
    handler_display: str,
    desc_plain: str,
    location: str,
    biz_env: str,
    sev: str,
    start_date: str,
    all_fields: dict[str, Any],
    extra_fields: dict[str, str],
    t: Any,
) -> list[str]:
    """拼装 search_text 片段；富文本按 richtext_search_text_max_len 单独加长（如 issue_track 1000）。"""
    item_for_search: dict[str, Any] = {
        "orderId": order_id,
        "processId": order_id,
        "currentStage": current_stage,
        "currentHandler": handler_display,
        "startDate": start_date,
        "severity": sev,
        "location": location,
        "bizEnv": biz_env,
        "creatorName": creator_name,
        "description": desc_plain,
        **extra_fields,
    }
    for key in all_fields:
        if key in t.RICHTEXT_COLUMN_KEYS:
            item_for_search[key] = t._strip_html_list_preview(
                str(all_fields[key] or ""), t.richtext_search_text_max_len(key)
            )

    search_parts: list[str] = [
        order_id,
        creator_id,
        creator_name,
        current_stage,
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
    search_key_set = set(SEARCH_TEXT_KEYS)
    for k, v in extra_fields.items():
        if k not in search_key_set and str(v).strip():
            search_parts.append(str(v))
    return search_parts


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
          t.current_node_id,
          COALESCE(t.status, 'open') AS status,
          COALESCE(t.creator_name, '') AS creator_name,
          COALESCE(t.creator_id, '') AS creator_id,
          COALESCE(wn.node_key, '') AS node_key,
          wtt.template_code,
          {sql_ticket_list_current_stage("t.status", "wn.node_name", "wn.node_key")} AS current_stage,
          t.created_at AS ticket_created_at,
          COALESCE(t.title, '') AS ticket_title
        FROM ticket t
        JOIN workflow_template wtt ON wtt.id = t.template_id
        LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
        WHERE t.id = %s
        """,
        (ticket_id,),
    ).fetchone()
    if not row or str(row.get("template_code") or "") != SCHEMA_TEMPLATE_CODE:
        conn.execute("DELETE FROM ticket_list_snapshot WHERE ticket_id = %s", (ticket_id,))
        if TICKET_STATS_DAILY_ENABLED:
            from ticket_stats_daily import remove_ticket_stats

            remove_ticket_stats(conn, ticket_id)
        return

    nd_rows = conn.execute(
        """
        SELECT tnd.values_json, tnd.created_at,
               COALESCE(tnd.schema_snapshot->>'node_key', '') AS node_key,
               COALESCE(tnd.schema_snapshot->>'amended', '') AS amended,
               COALESCE(tnd.schema_snapshot->>'draft', '') AS draft
        FROM ticket_node_data tnd
        WHERE tnd.ticket_id = %s
        ORDER BY tnd.created_at ASC
        """,
        (ticket_id,),
    ).fetchall()
    node_rows = [
        {
            "values_json": r["values_json"],
            "created_at": r["created_at"],
            "node_key": r["node_key"],
            "amended": r["amended"],
            "draft": r.get("draft"),
        }
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
        cur_nid = row.get("current_node_id")
        if cur_nid is not None:
            handler_display = t._resolve_ticket_open_handler_display(conn, ticket_id, int(cur_nid))
        else:
            handler_display = str(snap.get("_last_submit_next_handler") or "").strip()
        if not handler_display:
            handler_display = str(row.get("creator_name") or "").strip()
        if not handler_display:
            handler_display = str(row.get("creator_id") or "").strip()

    all_fields = snap.get("_all_fields") or {}
    extra_fields: dict[str, str] = {}
    for k, v in all_fields.items():
        if k in t.RICHTEXT_COLUMN_KEYS:
            extra_fields[k] = t._strip_html_list_preview(
                str(v or ""), t.SNAPSHOT_EXTRA_FIELDS_RICHTEXT_MAX
            )
        else:
            extra_fields[k] = str(v or "").strip()

    fields_by_node = snap.get("_fields_by_node") or {}
    if not isinstance(fields_by_node, dict):
        fields_by_node = {}
    else:
        fields_by_node = {str(nk): dict(fv) for nk, fv in fields_by_node.items() if isinstance(fv, dict)}

    # 问题审核→审核关闭：各阶段最新提交人（仅记录该阶段最近一次 submit/jump_submit）
    stage_handlers = t._resolve_stage_handlers_map(conn, ticket_id)
    for nk in t.STAGE_HANDLER_NODE_KEYS:
        display = str(stage_handlers.get(nk) or "").strip()
        if not display:
            continue
        bucket = fields_by_node.setdefault(nk, {})
        bucket[t.STAGE_HANDLER_FIELD_KEY] = display
    # 重大问题兼容：extra_fields 同步阶段处理人（列表优先读 fields_by_node.*.stage_handler）
    if stage_handlers.get("ops_analysis"):
        extra_fields["ops_analyst"] = stage_handlers["ops_analysis"]
    if stage_handlers.get("dev_analysis"):
        extra_fields["dev_analyst"] = stage_handlers["dev_analysis"]

    order_id = str(row["ticket_no"])
    search_parts = _snapshot_search_parts(
        order_id=order_id,
        creator_id=str(row.get("creator_id") or ""),
        creator_name=str(row["creator_name"] or ""),
        current_stage=str(row["current_stage"] or "-"),
        handler_display=handler_display,
        desc_plain=desc_plain,
        location=location,
        biz_env=biz_env,
        sev=sev,
        start_date=start_date,
        all_fields=all_fields,
        extra_fields=extra_fields,
        t=t,
    )
    for nk in t.STAGE_HANDLER_NODE_KEYS:
        sh = str((fields_by_node.get(nk) or {}).get(t.STAGE_HANDLER_FIELD_KEY) or "").strip()
        if sh:
            search_parts.append(sh)
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
    if TICKET_LIST_SNAPSHOT_ENABLED and TICKET_STATS_DAILY_ENABLED:
        from ticket_stats_daily import refresh_ticket_stats

        refresh_ticket_stats(conn, ticket_id)


def _effective_snapshot_refresh_batch_size(batch_size: int) -> int:
    """batch_size<=0 曾表示「全部处理后再 commit」，易 OOM；统一改为分批 commit。"""
    if batch_size > 0:
        return max(1, min(int(batch_size), 500))
    return SNAPSHOT_REFRESH_BATCH_SIZE


def refresh_hcs_snapshots_by_ticket_ids(
    conn: psycopg.Connection,
    ticket_ids: list[int],
    *,
    commit_every: int | None = None,
) -> int:
    """刷新指定 HCS 工单列表快照；分批 commit 释放内存。"""
    ids = [int(x) for x in ticket_ids if x is not None]
    if not ids:
        return 0
    step = _effective_snapshot_refresh_batch_size(commit_every or SNAPSHOT_REFRESH_BATCH_SIZE)
    refreshed = 0
    for tid in ids:
        refresh_ticket_list_snapshot(conn, tid)
        refreshed += 1
        if refreshed % step == 0:
            conn.commit()
    if refreshed % step != 0:
        conn.commit()
    return refreshed


def refresh_hcs_snapshots_by_ticket_nos(
    conn: psycopg.Connection,
    ticket_nos: list[str],
    *,
    batch_size: int = 50,
) -> dict[str, Any]:
    """按 ticket_no 列表重建 HCS 快照（工作台勾选/当前筛选）。未找到的单号计入 skipped_not_found。"""
    logs: list[str] = []
    seen: set[str] = set()
    nos: list[str] = []
    for raw in ticket_nos or []:
        no = str(raw or "").strip()
        if not no or no in seen:
            continue
        seen.add(no)
        nos.append(no)
    if not nos:
        logs.append("未指定 ticket_nos，跳过")
        return {
            "ok": True,
            "processed": 0,
            "refreshed": 0,
            "done_cumulative": 0,
            "total": 0,
            "has_more": False,
            "next_after_ticket_id": 0,
            "skipped_not_found": 0,
            "logs": logs,
            "list_mode": "by_ticket_nos",
        }

    rows = conn.execute(
        """
        SELECT t.id, t.ticket_no
        FROM ticket t
        JOIN workflow_template wtt ON wtt.id = t.template_id
        WHERE wtt.template_code = %s AND t.ticket_no = ANY(%s)
        ORDER BY t.id
        """,
        (SCHEMA_TEMPLATE_CODE, nos),
    ).fetchall()
    found_nos = {str(r["ticket_no"]) for r in rows}
    skipped = sorted(set(nos) - found_nos)
    ids = [int(r["id"]) for r in rows]
    logs.append(f"按 ticket_nos 重建：请求 {len(nos)}，命中 HCS {len(ids)}，未找到 {len(skipped)}")
    refreshed = refresh_hcs_snapshots_by_ticket_ids(conn, ids, commit_every=batch_size)
    if skipped:
        logger.warning("snapshot rebuild by ticket_nos not found: %s", skipped[:20])
    return {
        "ok": True,
        "processed": refreshed,
        "refreshed": refreshed,
        "done_cumulative": refreshed,
        "total": len(ids),
        "has_more": False,
        "next_after_ticket_id": 0,
        "skipped_not_found": len(skipped),
        "logs": logs,
        "list_mode": "by_ticket_nos",
    }


def _count_hcs_tickets(conn: psycopg.Connection) -> int:
    total_row = conn.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM ticket t
        JOIN workflow_template wtt ON wtt.id = t.template_id
        WHERE wtt.template_code = %s
        """,
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    return int((total_row or {}).get("cnt") or 0)


def _count_hcs_tickets_up_to(conn: psycopg.Connection, ticket_id: int) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM ticket t
        JOIN workflow_template wtt ON wtt.id = t.template_id
        WHERE wtt.template_code = %s AND t.id <= %s
        """,
        (SCHEMA_TEMPLATE_CODE, int(ticket_id)),
    ).fetchone()
    return int((row or {}).get("cnt") or 0)


def refresh_hcs_snapshots_batch(
    conn: psycopg.Connection,
    *,
    after_ticket_id: int = 0,
    batch_size: int = 50,
) -> dict[str, Any]:
    """按 ticket.id 游标分批重建 HCS 列表快照（单批 commit，供 HTTP/CLI 循环调用）。"""
    logs: list[str] = []
    step = _effective_snapshot_refresh_batch_size(batch_size)
    after_ticket_id = max(0, int(after_ticket_id or 0))

    total = _count_hcs_tickets(conn)
    if total == 0:
        logs.append("无 HCS 工单，跳过快照重建")
        logger.info("snapshot backfill skip: no HCS tickets")
        return {
            "ok": True,
            "processed": 0,
            "refreshed": 0,
            "done_cumulative": 0,
            "total": 0,
            "has_more": False,
            "next_after_ticket_id": 0,
            "logs": logs,
        }

    if after_ticket_id == 0:
        logs.append(f"待重建 HCS 工单共 {total} 条，batch_size={step}")

    rows = conn.execute(
        """
        SELECT t.id
        FROM ticket t
        JOIN workflow_template wtt ON wtt.id = t.template_id
        WHERE wtt.template_code = %s AND t.id > %s
        ORDER BY t.id
        LIMIT %s
        """,
        (SCHEMA_TEMPLATE_CODE, after_ticket_id, step),
    ).fetchall()

    processed = 0
    last_id = after_ticket_id
    for row in rows:
        tid = int(row["id"])
        refresh_ticket_list_snapshot(conn, tid)
        processed += 1
        last_id = tid

    conn.commit()
    gc.collect()

    has_more = False
    if last_id > after_ticket_id:
        more = conn.execute(
            """
            SELECT 1
            FROM ticket t
            JOIN workflow_template wtt ON wtt.id = t.template_id
            WHERE wtt.template_code = %s AND t.id > %s
            LIMIT 1
            """,
            (SCHEMA_TEMPLATE_CODE, last_id),
        ).fetchone()
        has_more = bool(more)
        done_cumulative = _count_hcs_tickets_up_to(conn, last_id)
    else:
        done_cumulative = _count_hcs_tickets_up_to(conn, after_ticket_id) if after_ticket_id else 0

    logs.append(
        f"本批处理 {processed} 条（after_ticket_id={after_ticket_id}），累计 {done_cumulative}/{total}"
    )
    if not has_more:
        logs.append(f"重建完成：共刷新 {done_cumulative} 条 HCS 工单快照")
        logger.info("snapshot backfill done refreshed=%s total=%s", done_cumulative, total)
    else:
        logger.info(
            "snapshot backfill batch done processed=%s cumulative=%s total=%s next_after=%s",
            processed,
            done_cumulative,
            total,
            last_id,
        )

    return {
        "ok": True,
        "processed": processed,
        "refreshed": processed,
        "done_cumulative": done_cumulative,
        "total": total,
        "has_more": has_more,
        "next_after_ticket_id": last_id if has_more else 0,
        "logs": logs,
    }


def refresh_all_hcs_snapshots(batch_size: int = 500) -> dict[str, int]:
    """CLI 全量重建：内部循环 refresh_hcs_snapshots_batch 直至完成。"""
    commit_every = _effective_snapshot_refresh_batch_size(batch_size)
    after = 0
    total = 0
    done = 0
    logger.info("snapshot backfill start batch_commit=%s", commit_every)
    while True:
        with db_conn() as conn:
            summary = refresh_hcs_snapshots_batch(
                conn, after_ticket_id=after, batch_size=commit_every
            )
        total = int(summary.get("total") or 0)
        done = int(summary.get("done_cumulative") or 0)
        if not summary.get("has_more"):
            break
        after = int(summary.get("next_after_ticket_id") or 0)
        if not after:
            break
        if done == 1 or done == total or done % max(1, min(100, total // 10 if total > 100 else total)) == 0:
            logger.info("snapshot backfill progress done=%s total=%s", done, total)

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
    elif tab_norm == "pending_close":
        clauses.append(_home_pending_close_sql())
    elif tab_norm == "audit_close":
        clauses.append(_home_audit_close_sql())
    elif tab_norm == "handled":
        clauses.append(_home_handled_sql())
    elif tab_norm == "collaborated":
        clauses.append(_collaborated_sql())
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
    page_size = min(200, max(1, int(page_size or 20)))
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


def list_hcs_export_ticket_nos(
    *,
    operator_id: str,
    operator_name: str = "",
    q: str = "",
    created_from: str = "",
    created_to: str = "",
    tab: str = "all",
    column_filters_json: str = "",
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
    max_rows: int = 50_000,
) -> list[str]:
    """按工作台当前筛选条件拉取全部工单号（服务端导出用，不分页）。"""
    kw = (q or "").strip().lower()
    cf = _optional_list_created_ymd(created_from)
    ct = _optional_list_created_ymd(created_to)
    column_filters = _parse_column_filters(column_filters_json)
    max_rows = min(50_000, max(1, int(max_rows or 50_000)))

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
            exact_no="",
            cf=cf,
            ct=ct,
            kw=kw,
            tab=tab,
            column_filters=column_filters,
        )
        params["operator_id"] = operator_id
        params["operator_name"] = str(operator_name or "").strip()
        rows = conn.execute(
            f"""
            SELECT tls.ticket_no
            FROM ticket_list_snapshot tls
            WHERE {where_sql}
            ORDER BY tls.created_at DESC, tls.ticket_id DESC
            LIMIT %(limit)s
            """,
            {**params, "limit": max_rows},
        ).fetchall()
    return [str(r.get("ticket_no") or "").strip() for r in rows if str(r.get("ticket_no") or "").strip()]


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
            params["prefix_pat"] = f"%{prefix_low}%"

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
