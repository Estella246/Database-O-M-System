from __future__ import annotations

import json
import logging
import re
import urllib.parse
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side

from config import _AI_EXPORT_SCHEMA_HINT
from config import (
    AI_EXPORT_MAX_CONCURRENT_TASKS,
    AI_EXPORT_BATCH_SIZE,
    AI_EXPORT_MAX_LLM_CALLS,
    ECHARTS_JS_PATH,
)
from database import db_conn
from models import (
    AiExportTaskCreatePayload,
    AiExportTranslateRulesPayload,
    AiExportStartProcessingPayload,
    AiExportCancelPayload,
    AiExportGenerateReportPayload,
    AiExportQueryByDescriptionPayload,
    AiExportPreviewRowsPayload,
    TransformRules,
)
from routers.ai import _resolve_llm_config, _load_system_llm_config
from routers.ai import _get_schema_info, _build_db_schema_text, _AI_READONLY_SQL_RE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-export", tags=["ai-export"])

# ── Global state for background processing ──
_cancelled_tasks: set[int] = set()

# ── Field mapping: original column key → Chinese display name ──
AI_EXPORT_COLUMNS = {
    "ticket_no": "工单号",
    "severity": "严重性",
    "问题描述": "问题描述",
    "问题组件": "问题组件",
    "局点": "局点",
    "created_at": "创建时间",
    "closed_at": "关闭时间",
    "问题阶段": "问题阶段",
    "产品线": "产品线",
    "ecare_ticket_no": "eCare单号",
    "dts_no": "DTS单号",
    "component": "问题组件",
    "location": "局点",
    "start_date": "起始日期",
    "issue_desc": "问题描述",
    "event_level": "事件级别",
    "currentStage": "当前阶段",
    "currentHandler": "当前处理人",
    "creatorName": "创建人",
    "processId": "流程ID",
}


def _ai_export_table_ready(conn: psycopg.Connection) -> bool:
    """Check if ai_export_task table exists."""
    r = conn.execute("SELECT to_regclass('public.ai_export_task') AS name").fetchone()
    return bool(r and r.get("name"))


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


def _build_query_sql(source_config: dict, original_columns: list[str],
                     where_sql: str = "") -> tuple[str, list[Any]]:
    """Build SQL to query ticket data based on source_config or LLM-generated WHERE.

    Returns (sql, params) tuple.

    Strategy:
    - Query ticket + ticket_node_data across all nodes
    - Flatten values_json from all node instances into a single row per ticket
    - When where_sql is provided (LLM-generated), use it directly (already validated)
    - When where_sql is empty, use original template_code + time_range logic
    - Select system fields needed by AI_EXPORT_SYSTEM_FIELD_INJECTORS
    """
    from config import SCHEMA_TEMPLATE_CODE

    template_code = str(source_config.get("template_code") or "").strip() or SCHEMA_TEMPLATE_CODE

    # ── System field JOINs ──
    # These are needed for: currentStage, currentHandler, closed_at, creatorName
    select_extra = """
      t.creator_name,
      wn.node_name AS current_node_name,
      wn.node_key AS current_node_key,
      cur_hand.handler_name AS current_handler_name,
      close_log.created_at AS ticket_closed_at"""

    join_extra = """
    LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
    LEFT JOIN ticket_node_instance cur_hand ON cur_hand.ticket_id = t.id
      AND cur_hand.node_id = t.current_node_id
      AND cur_hand.action_status IN ('pending', 'processing')
      AND cur_hand.id = (
        SELECT MIN(ch2.id) FROM ticket_node_instance ch2
        WHERE ch2.ticket_id = t.id AND ch2.node_id = t.current_node_id
          AND ch2.action_status IN ('pending', 'processing')
      )
    LEFT JOIN ticket_flow_log close_log ON close_log.ticket_id = t.id
      AND close_log.action_type = 'close'
      AND close_log.id = (
        SELECT MAX(cl2.id) FROM ticket_flow_log cl2
        WHERE cl2.ticket_id = t.id AND cl2.action_type = 'close'
      )"""

    # ── WHERE clause ──
    if where_sql:
        # LLM-generated WHERE — already validated by _validate_llm_where()
        # If WHERE references tnd (ticket_node_data), split into EXISTS subquery
        # to avoid referencing a table not in the FROM/JOIN clause.
        uses_tnd = bool(re.search(r'\btnd\b', where_sql, re.I))
        if uses_tnd:
            ticket_conditions, tnd_conditions = _split_where_conditions(where_sql)
            # Escape literal % for psycopg parameterized query
            ticket_conditions = _psycopg_escape_literal_percent(ticket_conditions)
            tnd_conditions = _psycopg_escape_literal_percent(tnd_conditions)
            exists_clause = f"AND EXISTS (SELECT 1 FROM ticket_node_data tnd WHERE tnd.ticket_id = t.id AND {tnd_conditions})"
            sql = f"""
            SELECT
              t.id AS ticket_id,
              t.ticket_no,
              t.status AS ticket_status,
              t.created_at AS ticket_created_at,
              t.updated_at AS ticket_updated_at,
              t.creator_id,
              {select_extra}
            FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            {join_extra}
            {ticket_conditions}
            AND wt.template_code = %s
            {exists_clause}
            ORDER BY t.created_at DESC, t.id DESC
            """
            params: list[Any] = [template_code]
        else:
            # Escape literal % for psycopg parameterized query
            escaped_where = _psycopg_escape_literal_percent(where_sql)
            sql = f"""
            SELECT
              t.id AS ticket_id,
              t.ticket_no,
              t.status AS ticket_status,
              t.created_at AS ticket_created_at,
              t.updated_at AS ticket_updated_at,
              t.creator_id,
              {select_extra}
            FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            {join_extra}
            {escaped_where} AND wt.template_code = %s
            ORDER BY t.created_at DESC, t.id DESC
            """
            params: list[Any] = [template_code]
    else:
        # Original template_code + time_range logic (backward compatible)
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

        # NOTE: filters is legacy dead code — removed t.ticket_no != '' placeholder

        where_clause = " AND ".join(where_parts)

        sql = f"""
        SELECT
          t.id AS ticket_id,
          t.ticket_no,
          t.status AS ticket_status,
          t.created_at AS ticket_created_at,
          t.updated_at AS ticket_updated_at,
          t.creator_id,
          {select_extra}
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        {join_extra}
        WHERE {where_clause}
        ORDER BY t.created_at DESC, t.id DESC
        """
        params = params

    return sql, params


def _fetch_ticket_data_and_write_rows(
    conn: psycopg.Connection,
    task_id: int,
    source_config: dict,
    original_columns: list[str],
    where_sql: str = "",
) -> int:
    """Query ticket data, flatten node fields, write rows into ai_export_row.

    Returns total_rows written.
    """
    from config import SCHEMA_TEMPLATE_CODE

    template_code = str(source_config.get("template_code") or "").strip() or SCHEMA_TEMPLATE_CODE

    query_sql, query_params = _build_query_sql(source_config, original_columns, where_sql)
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

    # ── System field injectors ──
    # Map system field key to a lambda that extracts from ticket row
    AI_EXPORT_SYSTEM_FIELD_INJECTORS: dict[str, Any] = {
        "processId": lambda row: str(row.get("ticket_id") or ""),
        "currentStage": lambda row: row.get("current_node_name"),
        "currentHandler": lambda row: row.get("current_handler_name"),
        "creatorName": lambda row: row.get("creator_name"),
        "closed_at": lambda row: row.get("ticket_closed_at"),
        "created_at": lambda row: row.get("ticket_created_at"),
        # slaTime: complex SLA calc, Phase 2 leaves empty
    }

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

        # ── Always include ticket_no ──
        merged["ticket_no"] = str(t_row["ticket_no"] or "")

        # ── Inject system fields ──
        for sys_key, injector in AI_EXPORT_SYSTEM_FIELD_INJECTORS.items():
            if sys_key in original_columns:
                val = injector(t_row)
                if val is not None and str(val).strip() != "":
                    merged[sys_key] = val if isinstance(val, str) else (
                        val.isoformat() if hasattr(val, "isoformat") else str(val)
                    )

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
    natural_description = payload.natural_description.strip()
    where_sql = payload.where_sql.strip()

    with db_conn() as conn:
        _check_table_ready(conn)

        # Create task record (include natural_description + where_sql)
        row = conn.execute(
            """
            INSERT INTO ai_export_task
              (creator_id, status, source_config, original_columns, total_rows,
               rule_description, natural_description, where_sql)
            VALUES (%s, 'draft', %s::jsonb, %s::jsonb, 0, '', %s, %s)
            RETURNING id, status, total_rows
            """,
            (
                op,
                json.dumps(source_config, ensure_ascii=False),
                json.dumps(original_columns, ensure_ascii=False),
                natural_description,
                where_sql,
            ),
        ).fetchone()
        task_id = int(row["id"])

        # Query ticket data and write rows (pass where_sql for LLM-generated queries)
        total_rows = _fetch_ticket_data_and_write_rows(
            conn, task_id, source_config, original_columns, where_sql
        )

        # Update task with total_rows
        conn.execute(
            "UPDATE ai_export_task SET total_rows = %s, updated_at = NOW() WHERE id = %s",
            (total_rows, task_id),
        )
        conn.commit()

    return {"task_id": task_id, "status": "draft", "total_rows": total_rows}


# ── LLM WHERE generation — query-by-description ──


_WHERE_GENERATION_SYSTEM_PROMPT = """你是一个数据库运维工单系统的查询助手。用户会用自然语言描述想查询的工单数据，
你需要根据描述和下面的数据库表结构，生成一条 WHERE 子句（不含 SELECT/FROM/JOIN）。

注意：
- 只生成 WHERE 子句，以 "WHERE" 开头
- **重要：用户提到的任何中文字段名，必须先在下方的"对照表"中查找对应的英文 key，
  绝不能凭猜测使用 ticket 表字段。例如"起始日期"对应 start_date（在 values_json 中），不是 t.created_at**
- ticket 表只有 6 个字段可引用：ticket_no, severity, status, creator_id, creator_name, created_at
  其中 created_at 是工单创建时间（系统自动生成），仅当用户明确说"创建时间/创建日期"时才使用
- 其他所有业务字段都在 ticket_node_data.values_json 中，使用 tnd.values_json->>'key' 提取
  表别名必须使用 tnd（对应 ticket_node_data 表）
- values_json 中的日期字段（start_date, kernel_upgrade_time 等）存为字符串格式 'YYYY-MM-DD'，
  做日期范围比较时用 (tnd.values_json->>'start_date')::date
- 不要生成完整的 SELECT 语句，不要引入 JOIN
- 严重性的可选值为：致命、严重、一般、提示
- status 的可选值为：open、suspended、closed
- 字符串值使用单引号

**返回格式**：必须是 JSON 对象，包含两个字段：
- "where_sql": WHERE 子句字符串（以 "WHERE" 开头）
- "natural_summary": 对 WHERE 子句的人类可读中文摘要，用自然语言描述筛选条件

natural_summary 示例：
- WHERE severity = '严重' → "严重性为严重的工单"
- WHERE (tnd.values_json->>'start_date')::date >= '2026-06-01' → "起始日期在2026年6月的工单"
- WHERE t.created_at >= '2026-05-01' AND tnd.values_json->>'location' LIKE '%%华为云%%' → "创建时间在2026年5月以后且局点包含华为云的工单"

**中文字段名 → values_json 英文 key 对照表**（必须优先使用此表）：
  起始日期 → start_date          局点 → location             问题阶段 → biz_env
  问题严重性 → severity           问题组件 → component        产品线 → product_line
  eCare单号 → ecare_ticket_no    提单人 → hcs_owner          问题描述 → issue_desc
  处理方式 → handle_mode         专项轮值表 → issue_type_judge
  下一步处理人 → next_handler    关闭原因 → close_reason     问题引入模块 → issue_intro_module
  问题归属模块 → issue_owner_module  问题类型 → issue_type   根因分类 → root_cause_category
  事件级别 → event_level         客户声音 → customer_voice   内核版本 → gauss_version
  部署形态 → deploy_mode         是否涉及内核升级 → kernel_upgrade_involved
  内核升级时间 → kernel_upgrade_time   升级前基线版本 → upgrade_baseline_version
  管控版本 → control_version     升级状态 → upgrade_status   报错信息 → error_text
  问题进展跟踪 → issue_track     是否有core堆栈 → has_core_stack
  Core堆栈文字版 → core_stack_text    是否咨询问题 → is_consult_issue
  是否质量问题 → is_quality_issue    是否使用Doer辅助 → use_doer_assist
  使用Doer无帮助原因 → doer_no_help_reason   引入版本 → intro_version
  修复版本 → fix_version         是否前端透传 → front_pass_through
  是否透传至版本 → version_pass_through      DTS单号 → dts_no
  版本透传原因分析 → version_pass_reason    协同处理人 → collaborator
  规避措施恢复方法 → workaround   问题根因 → root_cause     DFX能力GAP → dfx_gap
  报错信息归档 → error_archive_text   是否需要预警 → warning_needed
  业务影响程度 → impact_level    SLA分析 → sla_analysis
  是否涉及故障恢复 → fault_recovery_involved  故障到恢复用时 → fault_to_recovery_duration
  上传问题报告 → problem_report

**示例**：
  用户："起始日期在6月份的工单"
  正确：{{"where_sql": "WHERE (tnd.values_json->>'start_date')::date >= '2026-06-01' AND (tnd.values_json->>'start_date')::date < '2026-07-01'", "natural_summary": "起始日期在2026年6月的工单"}}
  错误：{{"where_sql": "WHERE DATE(timezone('Asia/Shanghai', t.created_at)) ...", ...}} ← created_at 是创建时间，不是起始日期！

  用户："最近一周创建的工单"
  正确：{{"where_sql": "WHERE DATE(timezone('Asia/Shanghai', t.created_at)) >= CURRENT_DATE - INTERVAL '7 days'", "natural_summary": "最近一周创建的工单"}}

数据库表结构：
{schema_text}"""


# ── Allowed prefixes for schema filtering (only ticket/workflow related tables) ──

_AI_EXPORT_SCHEMA_ALLOWED_PREFIXES = ("ticket", "ticket_node_", "workflow_", "option_")


def _validate_llm_where(where_sql: str) -> str:
    """Validate LLM-generated WHERE subclause.

    Checks:
    1. Must start with WHERE
    2. No DML/DDL keywords (reuse _AI_READONLY_SQL_RE)
    3. No subqueries
    4. No JOIN
    """
    w = where_sql.strip()

    if not w.upper().startswith("WHERE"):
        raise ValueError("生成的条件必须以 WHERE 开头")

    if _AI_READONLY_SQL_RE.search(w):
        raise ValueError("生成的条件包含禁止的 SQL 关键词")

    if re.search(r'\(\s*SELECT\b', w, re.I):
        raise ValueError("不允许子查询")

    if re.search(r'\bJOIN\b', w, re.I):
        raise ValueError("不允许在条件中引入 JOIN")

    return w


def _split_where_conditions(where_sql: str) -> tuple[str, str]:
    """Split LLM WHERE clause into ticket conditions and tnd conditions.

    WHERE clause format: WHERE <condition1> AND <condition2> AND ...
    Parts containing tnd. → tnd_conditions; rest → ticket_conditions.
    """
    w = where_sql.strip()
    if w.upper().startswith("WHERE"):
        w = w[5:].strip()

    parts = re.split(r'\bAND\b', w, flags=re.I)
    ticket_parts = []
    tnd_parts = []
    for part in parts:
        part = part.strip()
        if re.search(r'\btnd\b', part, re.I):
            tnd_parts.append(part)
        else:
            ticket_parts.append(part)

    ticket_where = "WHERE " + " AND ".join(ticket_parts) if ticket_parts else "WHERE TRUE"
    tnd_where = " AND ".join(tnd_parts) if tnd_parts else "TRUE"
    return ticket_where, tnd_where


def _psycopg_escape_literal_percent(sql: str) -> str:
    """Escape literal '%' in SQL for psycopg parameterized queries.

    psycopg treats '%' as a placeholder prefix (like %s). Any literal '%'
    in the SQL that is NOT a valid placeholder (%s, %b, %t) must be doubled
    to '%%' so psycopg passes it through as a single '%' to PostgreSQL.

    This is needed when LLM-generated WHERE contains LIKE '%xxx%' or other
    literal percent signs.
    """
    # Replace % that are NOT valid psycopg placeholders with %%
    # Valid placeholders: %s, %b, %t
    result = []
    i = 0
    while i < len(sql):
        if sql[i] == '%' and i + 1 < len(sql):
            next_char = sql[i + 1]
            if next_char in ('s', 'b', 't'):
                # Valid placeholder — keep as-is
                result.append(sql[i:i + 2])
                i += 2
            else:
                # Literal % — escape to %%
                result.append('%%')
                i += 1
        else:
            result.append(sql[i])
            i += 1
    return ''.join(result)


def _count_matching_tickets(conn: psycopg.Connection, where_sql: str, template_code: str) -> int:
    """Count matching tickets using EXISTS subquery to avoid JOIN row inflation."""

    uses_tnd = bool(re.search(r'\btnd\b', where_sql, re.I))

    if uses_tnd:
        ticket_conditions, tnd_conditions = _split_where_conditions(where_sql)
        # Escape literal % for psycopg parameterized query
        ticket_conditions = _psycopg_escape_literal_percent(ticket_conditions)
        tnd_conditions = _psycopg_escape_literal_percent(tnd_conditions)
        count_sql = f"""
            SELECT COUNT(*) AS cnt FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            {ticket_conditions}
            AND wt.template_code = %s
            AND EXISTS (SELECT 1 FROM ticket_node_data tnd
                        WHERE tnd.ticket_id = t.id AND {tnd_conditions})
        """
    else:
        # Escape literal % for psycopg parameterized query
        escaped_where = _psycopg_escape_literal_percent(where_sql)
        count_sql = f"""
            SELECT COUNT(*) AS cnt FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            {escaped_where} AND wt.template_code = %s
        """

    conn.execute("SET TRANSACTION READ ONLY")
    conn.execute("SET statement_timeout = '30s'")
    count = conn.execute(count_sql, (template_code,)).fetchone()["cnt"]
    return int(count)


def _call_llm_for_where_generation(
    llm_config: dict[str, Any],
    description: str,
    schema_text: str,
) -> tuple[str, str]:
    """Call LLM to generate WHERE subclause from natural language description.

    Returns (where_sql, natural_summary) tuple.
    where_sql starts with "WHERE".
    natural_summary is a human-readable Chinese summary of the conditions.
    """
    url = (llm_config.get("llm_api_base_url", "") or "").rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + (llm_config.get("llm_api_key", "") or ""),
        "Content-Type": "application/json",
    }
    system_prompt = _WHERE_GENERATION_SYSTEM_PROMPT.format(schema_text=schema_text)
    body = {
        "model": llm_config.get("llm_model", "") or "",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": description},
        ],
        "temperature": 0.1,
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"LLM WHERE 生成调用失败: HTTP {resp.status_code}",
        )

    resp_json = resp.json()
    content = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")
    content = content.strip()
    # Strip markdown code block wrappers if present
    if content.startswith("```"):
        first_newline = content.index("\n") if "\n" in content else len(content)
        content = content[first_newline + 1:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()

    # Try to parse as JSON — LLM should return {"where_sql": "...", "natural_summary": "..."}
    import json as _json
    try:
        result = _json.loads(content)
        where_sql = str(result.get("where_sql", content)).strip()
        natural_summary = str(result.get("natural_summary", "")).strip()
    except (_json.JSONDecodeError, KeyError):
        # LLM returned plain WHERE text (not JSON)
        where_sql = content
        natural_summary = ""

    return where_sql, natural_summary


@router.post("/query-by-description")
def query_by_description(payload: AiExportQueryByDescriptionPayload) -> dict[str, Any]:
    """Generate WHERE clause from natural language description + count matching tickets.

    Does NOT create a task — only returns the WHERE clause and match count for user review.
    """
    op = payload.operator_id.strip() or "demo_001"
    description = payload.description.strip()
    template_code = payload.template_code.strip()

    if not description:
        raise HTTPException(status_code=400, detail="查询描述不能为空")

    from config import SCHEMA_TEMPLATE_CODE
    template_code = template_code or SCHEMA_TEMPLATE_CODE

    with db_conn() as conn:
        _check_table_ready(conn)

        # 1. Get LLM config
        llm_config = _resolve_llm_config(conn, op)
        if not llm_config.get("llm_enabled"):
            raise HTTPException(status_code=503, detail="LLM 服务未启用")

        # 2. Get filtered schema info (only ticket/workflow related tables)
        schema_info = _get_schema_info(conn)
        filtered_schema = [
            t for t in schema_info
            if any(t["table"].startswith(p) for p in _AI_EXPORT_SCHEMA_ALLOWED_PREFIXES)
        ]
        schema_text = _build_db_schema_text(filtered_schema)

        # 3. Call LLM to generate WHERE + natural_summary
        where_sql, natural_summary = _call_llm_for_where_generation(llm_config, description, schema_text)

        # 4. Validate the WHERE clause
        try:
            where_sql = _validate_llm_where(where_sql)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"生成的查询条件无效: {e}")

        # 5. Execute COUNT query (READ ONLY transaction for safety)
        conn.execute("SET TRANSACTION READ ONLY")
        try:
            match_count = _count_matching_tickets(conn, where_sql, template_code)
        except Exception as e:
            # If the WHERE clause causes a SQL execution error, report it to the user
            raise HTTPException(
                status_code=400,
                detail=f"生成的查询条件执行失败，请修改描述重试: {str(e)[:200]}",
            )

    return {
        "where_sql": where_sql,
        "match_count": match_count,
        "natural_description": description,
        "natural_summary": natural_summary,
    }


# ── Preview rows — lightweight data preview without creating task ──


def _get_all_field_keys() -> list[str]:
    """Get all 92 field keys from the export-fields structure.

    This includes system fields + all node fields, using English keys
    that directly match values_json storage.
    """
    # System field keys
    system_keys = ["processId", "currentStage", "currentHandler", "slaTime", "creatorName",
                   "closed_at", "created_at"]
    # Node field keys (from EXPORT_FIELDS_BY_NODE equivalent)
    node_keys = [
        # problem_fill
        "start_date", "location", "biz_env", "severity", "component",
        "product_line", "ecare_ticket_no", "hcs_owner", "issue_desc",
        # problem_review
        "handle_mode", "issue_type_judge", "next_handler", "close_reason",
        # ops_analysis (30 fields)
        "issue_type", "root_cause_category", "customer_voice", "gauss_version",
        "deploy_mode", "kernel_upgrade_involved", "kernel_upgrade_time",
        "upgrade_baseline_version", "control_version", "upgrade_status",
        "error_text", "issue_track", "has_core_stack", "core_stack_text",
        "is_consult_issue", "is_quality_issue", "use_doer_assist",
        "doer_no_help_reason",
        "issue_intro_module", "issue_owner_module", "front_pass_through",
        "version_pass_through", "dts_no", "version_pass_reason",
        "collaborator", "workaround", "root_cause", "dfx_gap",
        # dev_analysis
        "error_archive_text", "warning_needed", "impact_level",
        "sla_analysis", "fault_recovery_involved", "fault_to_recovery_duration",
        "problem_report", "intro_version", "fix_version",
        # ops_closure — intro/fix_version 与开发分析共用 key，继承开发分析取值
        "dts_no", "version_pass_reason", "collaborator", "workaround",
        "root_cause", "dfx_gap", "error_archive_text", "warning_needed",
        "impact_level", "sla_analysis", "fault_recovery_involved",
        "fault_to_recovery_duration", "problem_report",
        # audit_close
        "close_reason",
    ]
    # Combine + deduplicate (some keys appear in multiple nodes)
    all_keys = list(dict.fromkeys(system_keys + node_keys))
    return all_keys


def _preview_query_rows(
    conn: psycopg.Connection,
    where_sql: str,
    template_code: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Preview first N rows without writing to ai_export_row.

    Uses same extraction logic as _fetch_ticket_data_and_write_rows.
    Returns full-field rows — frontend filters columns for display.
    """
    from config import SCHEMA_TEMPLATE_CODE
    template_code = template_code or SCHEMA_TEMPLATE_CODE
    source_config = {"template_code": template_code}

    all_field_keys = _get_all_field_keys()

    query_sql, query_params = _build_query_sql(source_config, all_field_keys, where_sql)
    ticket_rows = conn.execute(query_sql, tuple(query_params)).fetchall()

    if not ticket_rows:
        return []

    ticket_ids = [int(r["ticket_id"]) for r in ticket_rows]

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

    by_ticket: dict[int, list[dict[str, Any]]] = {}
    for nr in nd_rows:
        tid = int(nr["ticket_id"])
        by_ticket.setdefault(tid, []).append(nr)

    AI_EXPORT_SYSTEM_FIELD_INJECTORS: dict[str, Any] = {
        "processId": lambda row: str(row.get("ticket_id") or ""),
        "currentStage": lambda row: row.get("current_node_name"),
        "currentHandler": lambda row: row.get("current_handler_name"),
        "creatorName": lambda row: row.get("creator_name"),
        "closed_at": lambda row: row.get("ticket_closed_at"),
        "created_at": lambda row: row.get("ticket_created_at"),
    }

    preview_rows = []
    for t_row in ticket_rows:
        tid = int(t_row["ticket_id"])
        node_data_list = by_ticket.get(tid, [])

        merged: dict[str, Any] = {}
        sorted_nodes = sorted(node_data_list, key=lambda r: r["created_at"] or "")
        for nd in sorted_nodes:
            v = _values_json_as_dict(nd.get("values_json"))
            for key in all_field_keys:
                val = v.get(key)
                if val is not None and str(val).strip() != "":
                    merged[key] = val

        merged["ticket_no"] = str(t_row["ticket_no"] or "")

        for sys_key, injector in AI_EXPORT_SYSTEM_FIELD_INJECTORS.items():
            val = injector(t_row)
            if val is not None and str(val).strip() != "":
                merged[sys_key] = val if isinstance(val, str) else (
                    val.isoformat() if hasattr(val, "isoformat") else str(val)
                )

        if merged.get("ticket_no"):
            preview_rows.append(merged)

    return preview_rows


@router.post("/preview-rows")
def preview_rows(payload: AiExportPreviewRowsPayload) -> dict[str, Any]:
    """Preview first 20 rows of data matching the WHERE clause.

    Returns full-field rows — frontend filters display columns based on user's field selection.
    """
    op = payload.operator_id.strip() or "demo_001"
    where_sql = payload.where_sql.strip()
    template_code = payload.template_code.strip()

    if not where_sql:
        raise HTTPException(status_code=400, detail="查询条件不能为空")

    # Validate the WHERE clause again for safety
    try:
        validated = _validate_llm_where(where_sql)
        where_sql = validated
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"查询条件无效: {e}")

    from config import SCHEMA_TEMPLATE_CODE
    template_code = template_code or SCHEMA_TEMPLATE_CODE

    with db_conn() as conn:
        _check_table_ready(conn)

        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute("SET statement_timeout = '30s'")

        # Get match count
        match_count = _count_matching_tickets(conn, where_sql, template_code)

        # Get preview rows
        preview_rows = _preview_query_rows(conn, where_sql, template_code)

    return {
        "preview_rows": preview_rows,
        "match_count": match_count,
    }


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
              t.natural_description,
              t.natural_summary,
              t.rule_description,
              t.report_prompt,
              COALESCE(ua.user_name, t.creator_id) AS creator_display_name
            FROM ai_export_task t
            LEFT JOIN user_account ua ON ua.account = t.creator_id
            WHERE {where_sql}
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params + [size, offset]),
        ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        d["query_description"] = d.get("natural_description", "")
        d["query_summary"] = d.get("natural_summary", "")
        rule_desc = d.get("rule_description", "")
        d["rule_summary"] = rule_desc[:80] if rule_desc else ""
        items.append(d)
    return {"items": items, "total": total, "page": page, "size": size}


# ── GET /tasks/{task_id} — Get task detail ──


@router.get("/tasks/{task_id:int}")
def get_ai_export_task(task_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    """Get task detail — all fields except report_html."""
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        row = conn.execute(
            """
            SELECT
              id, creator_id, status, source_config, original_columns,
              transform_rules, rule_description, total_rows, processed_rows,
              preview_done, error_message, excel_downloaded_at,
              report_status, report_prompt, created_at, updated_at,
              natural_description, where_sql
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


# ── Rule translation + Preview helpers ──


_RULE_TRANSLATION_SYSTEM_PROMPT = """你是一个数据清洗规则翻译助手。用户会描述他们想要对数据做哪些清洗操作，
你需要将描述翻译为结构化的规则 JSON。

规则类型有三种：
1. mapping：值映射，指定 source_column、mapping 表、target_column、value_range
   - source_column: 要映射的原始列名
   - mapping: 映射字典，键为原始值，值为目标值
   - target_column: 映射后的新列名
   - value_range: 目标列的合法取值列表
2. llm_reasoning：需要 LLM 推理判断，指定 source_columns、reasoning_instruction、target_column、value_range
   - source_columns: 用于推理的原始列名列表
   - reasoning_instruction: 推理判断的说明
   - target_column: 推理结果的新列名
   - value_range: 推理结果的合法取值列表
3. computed：数值计算，指定 source_columns、expression、target_column、params
   - source_columns: 用于计算的原始列名列表
   - expression: 计算表达式类型（目前支持 date_diff_days：计算两个日期之间的天数差）
   - target_column: 计算结果的新列名
   - params: 计算参数（可选）

请严格按照以下 JSON schema 输出：
{
  "transform_rules": [
    {
      "type": "mapping" | "llm_reasoning" | "computed",
      "target_column": "新列名",
      "source_column": "原始列名" (mapping 必填),
      "mapping": {"原始值": "目标值"} (mapping 必填),
      "value_range": ["合法取值1", "合法取值2"] (mapping/llm_reasoning 必填),
      "source_columns": ["原始列名1", "原始列名2"] (llm_reasoning/computed 必填),
      "reasoning_instruction": "推理说明" (llm_reasoning 必填),
      "expression": "date_diff_days" (computed 必填),
      "params": {} (computed 可选)
    }
  ]
}

注意：
- mapping 类型的 mapping 字典中，未列出的原始值映射结果为空（不要补充"未知"之类的默认值）
- llm_reasoning 类型的 reasoning_instruction 应明确描述推理逻辑
- computed 类型目前仅支持 date_diff_days 表达式，用于计算两个日期字段之间的天数差
- target_column 不能重复
- 所有引用的原始列名必须在用户提供的原始字段列表中存在
"""


def _call_llm_for_rule_translation(
    llm_config: dict[str, Any],
    original_columns: list[str],
    rule_description: str,
) -> dict[str, Any]:
    """Call LLM to translate natural language rule description into structured transform_rules JSON."""
    url = (llm_config.get("llm_api_base_url", "") or "").rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + (llm_config.get("llm_api_key", "") or ""),
        "Content-Type": "application/json",
    }
    user_prompt = f"原始字段有：{', '.join(original_columns)}\n用户描述：{rule_description}"
    body = {
        "model": llm_config.get("llm_model", "") or "",
        "messages": [
            {"role": "system", "content": _RULE_TRANSLATION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"LLM 规则翻译调用失败: HTTP {resp.status_code}",
        )

    resp_json = resp.json()
    content = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")
    # Strip markdown code block wrappers if present
    content = content.strip()
    if content.startswith("```"):
        first_newline = content.index("\n") if "\n" in content else len(content)
        content = content[first_newline + 1:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"LLM 返回的规则 JSON 解析失败: {e}",
        )

    return parsed


def _validate_transform_rules(
    rules_json: dict[str, Any],
    original_columns: list[str],
) -> list[str]:
    """Validate transform_rules JSON with Pydantic model + extra constraints.

    Returns list of validation error messages (empty = valid).
    """
    errors: list[str] = []

    # Pydantic structural validation
    try:
        model = TransformRules(**rules_json)
    except Exception as e:
        errors.append(f"规则 JSON 结构校验失败: {e}")
        return errors

    target_columns_seen: set[str] = set()

    for rule in model.transform_rules:
        r = rule.model_dump()
        t = r.get("type", "")
        tc = r.get("target_column", "")

        # Check target_column uniqueness
        if tc in target_columns_seen:
            errors.append(f"target_column '{tc}' 重复")
        target_columns_seen.add(tc)

        if t == "mapping":
            if not r.get("source_column"):
                errors.append(f"mapping 规则 '{tc}' 缺少 source_column")
            if not r.get("mapping"):
                errors.append(f"mapping 规则 '{tc}' 缺少 mapping")
            if not r.get("value_range"):
                errors.append(f"mapping 规则 '{tc}' 缺少 value_range")
            if r.get("source_column") and r["source_column"] not in original_columns:
                errors.append(f"mapping 规则 '{tc}' 的 source_column '{r['source_column']}' 不在原始列中")

        elif t == "llm_reasoning":
            if not r.get("source_columns"):
                errors.append(f"llm_reasoning 规则 '{tc}' 缺少 source_columns")
            if not r.get("reasoning_instruction"):
                errors.append(f"llm_reasoning 规则 '{tc}' 缺少 reasoning_instruction")
            if not r.get("value_range"):
                errors.append(f"llm_reasoning 规则 '{tc}' 缺少 value_range")
            if r.get("source_columns"):
                for sc in r["source_columns"]:
                    if sc not in original_columns:
                        errors.append(f"llm_reasoning 规则 '{tc}' 的 source_columns 包含不存在的列 '{sc}'")

        elif t == "computed":
            if not r.get("source_columns"):
                errors.append(f"computed 规则 '{tc}' 缺少 source_columns")
            if not r.get("expression"):
                errors.append(f"computed 规则 '{tc}' 缺少 expression")
            if r.get("source_columns"):
                for sc in r["source_columns"]:
                    if sc not in original_columns:
                        errors.append(f"computed 规则 '{tc}' 的 source_columns 包含不存在的列 '{sc}'")

    return errors


def _apply_mapping_rule(row_data: dict[str, Any], rule: dict[str, Any]) -> str:
    """Apply mapping rule: dict lookup. Unmatched values return empty string."""
    source_column = rule.get("source_column", "")
    mapping = rule.get("mapping") or {}
    raw_value = str(row_data.get(source_column, "") or "")
    return mapping.get(raw_value, "")


def _apply_computed_rule(row_data: dict[str, Any], rule: dict[str, Any]) -> str:
    """Apply computed rule. Currently only supports date_diff_days.

    Returns empty string if any source date is missing or invalid.
    """
    expression = rule.get("expression", "")
    source_columns = rule.get("source_columns") or []

    if expression == "date_diff_days" and len(source_columns) >= 2:
        date_str_1 = str(row_data.get(source_columns[0], "") or "").strip()
        date_str_2 = str(row_data.get(source_columns[1], "") or "").strip()

        if not date_str_1 or not date_str_2:
            return ""

        try:
            dt1 = datetime.fromisoformat(date_str_1.replace("Z", "+00:00"))
            dt2 = datetime.fromisoformat(date_str_2.replace("Z", "+00:00"))
            diff = abs((dt2 - dt1).days)
            return str(diff)
        except (ValueError, TypeError):
            return ""

    return ""


_PREVIEW_REASONING_SYSTEM_PROMPT = """你是一个数据分类助手。根据以下规则对每行数据进行判断。

规则：判断"{target_column}"，取值范围：{value_range}。
{reasoning_instruction}

返回格式要求：
请严格按照以下 JSON 数组格式返回结果：
[{{"row_index": 0, "{target_column}": "判断结果"}}, ...]

注意：
- 每行数据都必须有对应的返回结果
- 判断结果必须在取值范围内，不在范围内的结果置为空字符串
- 只返回 JSON 数组，不要包含任何其他文字"""


def _call_llm_for_preview_reasoning(
    llm_config: dict[str, Any],
    rows: list[dict[str, Any]],
    rule: dict[str, Any],
) -> dict[int, str]:
    """Call LLM to reason on preview rows for a single llm_reasoning rule.

    Returns dict mapping row_index -> derived value.
    """
    target_column = rule.get("target_column", "")
    value_range = rule.get("value_range") or []
    reasoning_instruction = rule.get("reasoning_instruction", "")
    source_columns = rule.get("source_columns") or []

    system_prompt = _PREVIEW_REASONING_SYSTEM_PROMPT.format(
        target_column=target_column,
        value_range=json.dumps(value_range, ensure_ascii=False),
        reasoning_instruction=reasoning_instruction,
    )

    # Build user prompt with rows data
    rows_for_llm = []
    for row in rows:
        item: dict[str, Any] = {"row_index": row.get("row_index", 0)}
        for sc in source_columns:
            item[sc] = str(row.get("original_data", {}).get(sc, "") or "")
        rows_for_llm.append(item)

    user_prompt = (
        f"请对以下数据逐行判断{target_column}，以 JSON 数组格式返回：\n"
        + json.dumps(rows_for_llm, ensure_ascii=False)
    )

    url = (llm_config.get("llm_api_base_url", "") or "").rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + (llm_config.get("llm_api_key", "") or ""),
        "Content-Type": "application/json",
    }
    body = {
        "model": llm_config.get("llm_model", "") or "",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        logger.warning("LLM preview reasoning call failed: HTTP %d", resp.status_code)
        return {}

    resp_json = resp.json()
    content = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")
    content = content.strip()
    if content.startswith("```"):
        first_newline = content.index("\n") if "\n" in content else len(content)
        content = content[first_newline + 1:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

    try:
        results = json.loads(content)
    except json.JSONDecodeError:
        logger.warning("LLM preview reasoning returned invalid JSON")
        return {}

    if not isinstance(results, list):
        logger.warning("LLM preview reasoning returned non-array JSON")
        return {}

    # Map row_index -> value, validate value_range
    derived: dict[int, str] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        ri = item.get("row_index")
        val = str(item.get(target_column, "") or "")
        if val and value_range and val not in value_range:
            val = ""  # Out of range -> empty
        if ri is not None:
            derived[int(ri)] = val

    return derived


def _apply_rules_to_preview_rows(
    conn: psycopg.Connection,
    task_id: int,
    rules_json: list[dict[str, Any]],
    original_columns: list[str],
    llm_config: dict[str, Any],
) -> list[dict[str, Any]]:
    """Apply transform rules to first 20 rows and write derived_data.

    Returns list of preview rows (original_data + derived_data merged).
    """
    # Read first 20 rows
    preview_rows = conn.execute(
        """
        SELECT row_index, original_data
        FROM ai_export_row
        WHERE task_id = %s
        ORDER BY row_index
        LIMIT 20
        """,
        (task_id,),
    ).fetchall()

    if not preview_rows:
        return []

    rows_data = [dict(r) for r in preview_rows]

    # Separate rules by type for batch processing
    mapping_rules = [r for r in rules_json if r.get("type") == "mapping"]
    computed_rules = [r for r in rules_json if r.get("type") == "computed"]
    llm_reasoning_rules = [r for r in rules_json if r.get("type") == "llm_reasoning"]

    # Apply mapping + computed rules row by row
    derived_data_map: dict[int, dict[str, str]] = {}
    for row in rows_data:
        ri = row["row_index"]
        od = row["original_data"] if isinstance(row["original_data"], dict) else {}
        derived: dict[str, str] = {}

        for rule in mapping_rules:
            derived[rule["target_column"]] = _apply_mapping_rule(od, rule)

        for rule in computed_rules:
            derived[rule["target_column"]] = _apply_computed_rule(od, rule)

        derived_data_map[ri] = derived

    # Apply llm_reasoning rules via LLM calls (one call per rule for all 20 rows)
    for rule in llm_reasoning_rules:
        llm_results = _call_llm_for_preview_reasoning(llm_config, rows_data, rule)
        tc = rule.get("target_column", "")
        for ri, val in llm_results.items():
            if ri in derived_data_map:
                derived_data_map[ri][tc] = val
            else:
                derived_data_map[ri] = {tc: val}

    # Write derived_data back to rows
    for ri, derived in derived_data_map.items():
        conn.execute(
            """
            UPDATE ai_export_row
            SET derived_data = %s::jsonb
            WHERE task_id = %s AND row_index = %s
            """,
            (json.dumps(derived, ensure_ascii=False, default=str), task_id, ri),
        )

    # Build preview result: merge original_data + derived_data
    result_rows = []
    for row in rows_data:
        ri = row["row_index"]
        od = row["original_data"] if isinstance(row["original_data"], dict) else {}
        dd = derived_data_map.get(ri, {})
        merged = {**od, **dd}
        merged["row_index"] = ri
        result_rows.append(merged)

    return result_rows


# ── POST /tasks/{task_id}/translate-rules — Translate rules + preview ──


@router.post("/tasks/{task_id:int}/translate-rules")
def translate_ai_export_rules(
    task_id: int,
    payload: AiExportTranslateRulesPayload,
) -> dict[str, Any]:
    """Translate natural language rule description into structured transform_rules,
    validate with Pydantic, apply to first 20 rows for preview."""
    op = payload.operator_id.strip() or "demo_001"
    rule_description = payload.rule_description.strip()

    if not rule_description:
        raise HTTPException(status_code=400, detail="规则描述不能为空")

    with db_conn() as conn:
        _check_table_ready(conn)

        # Check task status must be draft
        task = conn.execute(
            "SELECT id, status, original_columns, creator_id FROM ai_export_task WHERE id = %s",
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可操作")

        if str(task["status"]) != "draft":
            raise HTTPException(status_code=400, detail="仅 draft 状态任务可翻译规则，当前状态: " + str(task["status"]))

        original_columns = task["original_columns"] if isinstance(task["original_columns"], list) else []

        # Resolve LLM config
        llm_config = _resolve_llm_config(conn, op)
        if not llm_config.get("llm_api_key") or not llm_config.get("llm_api_base_url"):
            raise HTTPException(status_code=400, detail="LLM 配置不完整，请联系管理员配置 API Key 和 Base URL")

        # Call LLM for rule translation
        rules_json = _call_llm_for_rule_translation(llm_config, original_columns, rule_description)

        # Validate rules
        validation_errors = _validate_transform_rules(rules_json, original_columns)

        if validation_errors:
            # Task stays draft, return errors
            conn.commit()
            return {
                "task_id": task_id,
                "status": "draft",
                "transform_rules": [],
                "preview_rows": [],
                "validation_errors": validation_errors,
            }

        # Validation passed — save rules to task
        rules_list = rules_json.get("transform_rules", [])
        conn.execute(
            """
            UPDATE ai_export_task
            SET transform_rules = %s::jsonb,
                rule_description = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (json.dumps(rules_list, ensure_ascii=False, default=str), rule_description, task_id),
        )

        # Apply rules to first 20 rows for preview
        preview_rows = _apply_rules_to_preview_rows(
            conn, task_id, rules_list, original_columns, llm_config,
        )

        # Update task status to preview + preview_done
        conn.execute(
            """
            UPDATE ai_export_task
            SET status = 'preview',
                preview_done = TRUE,
                updated_at = NOW()
            WHERE id = %s
            """,
            (task_id,),
        )
        conn.commit()

    return {
        "task_id": task_id,
        "status": "preview",
        "transform_rules": rules_list,
        "preview_rows": preview_rows,
        "validation_errors": [],
    }


# ── GET /tasks/{task_id}/preview — Get preview data ──


@router.get("/tasks/{task_id:int}/preview")
def get_ai_export_preview(
    task_id: int,
    operator_id: str = "demo_001",
) -> dict[str, Any]:
    """Get preview data (first 20 rows with original_data + derived_data merged).
    Only available when task status >= preview."""
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            "SELECT id, status, creator_id FROM ai_export_task WHERE id = %s",
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可查看")

        # Status must be preview, processing, or ready
        valid_statuses = ("preview", "processing", "ready")
        if str(task["status"]) not in valid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"预览仅在 preview/processing/ready 状态可用，当前状态: {task['status']}",
            )

        rows = conn.execute(
            """
            SELECT row_index, original_data, derived_data
            FROM ai_export_row
            WHERE task_id = %s
            ORDER BY row_index
            LIMIT 20
            """,
            (task_id,),
        ).fetchall()

    # Merge original_data + derived_data for each row
    preview_rows = []
    for r in rows:
        od = r["original_data"] if isinstance(r["original_data"], dict) else {}
        dd = r["derived_data"] if isinstance(r["derived_data"], dict) else {}
        merged = {**od, **dd}
        merged["row_index"] = r["row_index"]
        preview_rows.append(merged)

    return {"task_id": task_id, "preview_rows": preview_rows}


# ── Full processing (background task) ──


_FULL_PROCESSING_SYSTEM_PROMPT = """你是一个数据分类助手。根据以下规则对每行数据进行判断。

规则：判断"{target_column}"，取值范围：{value_range}。
{reasoning_instruction}

返回格式要求：
请严格按照以下 JSON 数组格式返回结果：
[{{"row_index": 0, "{target_column}": "判断结果"}}, ...]

注意：
- 每行数据都必须有对应的返回结果
- 判断结果必须在取值范围内，不在范围内的结果置为空字符串
- 只返回 JSON 数组，不要包含任何其他文字"""


def _run_full_processing(task_id: int) -> None:
    """Background task: apply transform rules to all rows.

    Runs in APScheduler background thread. Uses synchronous db_conn and httpx.
    """
    try:
        with db_conn() as conn:
            # Read task metadata
            task = conn.execute(
                """
                SELECT id, creator_id, status, transform_rules, original_columns
                FROM ai_export_task WHERE id = %s
                """,
                (task_id,),
            ).fetchone()

            if not task or str(task["status"]) != "processing":
                logger.warning("Task %s not in processing state, skipping", task_id)
                return

            rules_json = task["transform_rules"] if isinstance(task["transform_rules"], list) else []
            original_columns = task["original_columns"] if isinstance(task["original_columns"], list) else []

            # Resolve LLM config
            llm_config = _resolve_llm_config(conn, str(task["creator_id"]))

        # Read all rows
        all_rows: list[dict[str, Any]] = []
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, row_index, original_data
                FROM ai_export_row
                WHERE task_id = %s
                ORDER BY row_index
                """,
                (task_id,),
            ).fetchall()
            all_rows = [dict(r) for r in rows]

        if not all_rows:
            with db_conn() as conn:
                conn.execute(
                    """
                    UPDATE ai_export_task SET status = 'ready', updated_at = NOW()
                    WHERE id = %s
                    """,
                    (task_id,),
                )
                conn.commit()
            _cancelled_tasks.discard(task_id)
            return

        total_rows = len(all_rows)

        # Separate rules by type
        mapping_rules = [r for r in rules_json if r.get("type") == "mapping"]
        computed_rules = [r for r in rules_json if r.get("type") == "computed"]
        llm_reasoning_rules = [r for r in rules_json if r.get("type") == "llm_reasoning"]

        # ── Phase 1: Apply mapping + computed rules to ALL rows ──
        derived_data_map: dict[int, dict[str, str]] = {}
        for row in all_rows:
            ri = row["row_index"]
            od = row["original_data"] if isinstance(row["original_data"], dict) else {}
            derived: dict[str, str] = {}

            for rule in mapping_rules:
                derived[rule["target_column"]] = _apply_mapping_rule(od, rule)

            for rule in computed_rules:
                derived[rule["target_column"]] = _apply_computed_rule(od, rule)

            derived_data_map[ri] = derived

        # Batch UPDATE derived_data for mapping/computed results
        with db_conn() as conn:
            for ri, derived in derived_data_map.items():
                conn.execute(
                    """
                    UPDATE ai_export_row
                    SET derived_data = %s::jsonb
                    WHERE task_id = %s AND row_index = %s
                    """,
                    (json.dumps(derived, ensure_ascii=False, default=str), task_id, ri),
                )
            conn.execute(
                """
                UPDATE ai_export_task SET processed_rows = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (total_rows, task_id),
            )
            conn.commit()

        # ── Phase 2: Apply llm_reasoning rules in batches ──
        llm_call_count = 0

        for rule in llm_reasoning_rules:
            target_column = rule.get("target_column", "")
            value_range = rule.get("value_range") or []
            reasoning_instruction = rule.get("reasoning_instruction", "")
            source_columns = rule.get("source_columns") or []

            system_prompt = _FULL_PROCESSING_SYSTEM_PROMPT.format(
                target_column=target_column,
                value_range=json.dumps(value_range, ensure_ascii=False),
                reasoning_instruction=reasoning_instruction,
            )

            # Split rows into batches
            batch_size = AI_EXPORT_BATCH_SIZE
            for batch_start in range(0, total_rows, batch_size):
                # Check cancellation
                if task_id in _cancelled_tasks:
                    logger.info("Task %s cancelled, stopping LLM processing", task_id)
                    with db_conn() as conn:
                        current_processed = conn.execute(
                            "SELECT processed_rows FROM ai_export_task WHERE id = %s",
                            (task_id,),
                        ).fetchone()
                        processed_rows = int(current_processed["processed_rows"]) if current_processed else 0
                        conn.execute(
                            """
                            UPDATE ai_export_task
                            SET status = 'ready', updated_at = NOW()
                            WHERE id = %s
                            """,
                            (task_id,),
                        )
                        conn.commit()
                    _cancelled_tasks.discard(task_id)
                    return

                # Check max LLM calls
                llm_call_count += 1
                if llm_call_count > AI_EXPORT_MAX_LLM_CALLS:
                    logger.warning(
                        "Task %s reached max LLM calls (%d), stopping",
                        task_id, AI_EXPORT_MAX_LLM_CALLS,
                    )
                    with db_conn() as conn:
                        conn.execute(
                            """
                            UPDATE ai_export_task
                            SET status = 'error',
                                error_message = '达到最大 LLM 调用次数限制',
                                updated_at = NOW()
                            WHERE id = %s
                            """,
                            (task_id,),
                        )
                        conn.commit()
                    _cancelled_tasks.discard(task_id)
                    return

                batch_end = min(batch_start + batch_size, total_rows)
                batch_rows = all_rows[batch_start:batch_end]

                # Build user prompt for this batch
                rows_for_llm: list[dict[str, Any]] = []
                for row in batch_rows:
                    item: dict[str, Any] = {"row_index": row["row_index"]}
                    od = row["original_data"] if isinstance(row["original_data"], dict) else {}
                    for sc in source_columns:
                        item[sc] = str(od.get(sc, "") or "")
                    rows_for_llm.append(item)

                user_prompt = (
                    f"请对以下数据逐行判断{target_column}，以 JSON 数组格式返回：\n"
                    + json.dumps(rows_for_llm, ensure_ascii=False)
                )

                url = (llm_config.get("llm_api_base_url", "") or "").rstrip("/") + "/chat/completions"
                headers = {
                    "Authorization": "Bearer " + (llm_config.get("llm_api_key", "") or ""),
                    "Content-Type": "application/json",
                }
                body = {
                    "model": llm_config.get("llm_model", "") or "",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                }

                # Call LLM (synchronous, as we're in a background thread)
                try:
                    with httpx.Client(timeout=120) as client:
                        resp = client.post(url, headers=headers, json=body)
                except (httpx.RequestError, httpx.TimeoutException) as e:
                    logger.warning(
                        "Task %s batch %d-%d LLM call failed: %s",
                        task_id, batch_start, batch_end, e,
                    )
                    # This batch failed — skip, continue next batch
                    continue

                if resp.status_code != 200:
                    logger.warning(
                        "Task %s batch %d-%d LLM returned HTTP %d",
                        task_id, batch_start, batch_end, resp.status_code,
                    )
                    continue

                resp_json = resp.json()
                content = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")
                content = content.strip()
                if content.startswith("```"):
                    first_newline = content.index("\n") if "\n" in content else len(content)
                    content = content[first_newline + 1:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()

                try:
                    results = json.loads(content)
                except json.JSONDecodeError:
                    logger.warning(
                        "Task %s batch %d-%d LLM returned invalid JSON",
                        task_id, batch_start, batch_end,
                    )
                    continue

                if not isinstance(results, list):
                    logger.warning(
                        "Task %s batch %d-%d LLM returned non-array",
                        task_id, batch_start, batch_end,
                    )
                    continue

                # Parse LLM results: row_index -> value
                batch_derived: dict[int, str] = {}
                expected_indices = {row["row_index"] for row in batch_rows}

                for item in results:
                    if not isinstance(item, dict):
                        continue
                    ri = item.get("row_index")
                    val = str(item.get(target_column, "") or "")
                    if val and value_range and val not in value_range:
                        val = ""  # Out of range -> empty
                    if ri is not None:
                        batch_derived[int(ri)] = val

                # Merge llm results into existing derived_data and write to DB
                with db_conn() as conn:
                    for row in batch_rows:
                        ri = row["row_index"]
                        # Merge with previously computed derived_data
                        existing_derived = derived_data_map.get(ri, {})
                        llm_val = batch_derived.get(ri, "")  # Missing row -> empty
                        existing_derived[target_column] = llm_val
                        derived_data_map[ri] = existing_derived

                        conn.execute(
                            """
                            UPDATE ai_export_row
                            SET derived_data = %s::jsonb
                            WHERE task_id = %s AND row_index = %s
                            """,
                            (json.dumps(existing_derived, ensure_ascii=False, default=str), task_id, ri),
                        )

                    # Update processed_rows
                    processed_so_far = min(batch_end, total_rows)
                    conn.execute(
                        """
                        UPDATE ai_export_task
                        SET processed_rows = %s, updated_at = NOW()
                        WHERE id = %s
                        """,
                        (processed_so_far, task_id),
                    )
                    conn.commit()

        # ── All processing complete ──
        with db_conn() as conn:
            conn.execute(
                """
                UPDATE ai_export_task
                SET status = 'ready', error_message = '', updated_at = NOW()
                WHERE id = %s
                """,
                (task_id,),
            )
            conn.commit()

        _cancelled_tasks.discard(task_id)
        logger.info("Task %s full processing completed", task_id)

    except Exception as e:
        logger.error("Task %s full processing failed: %s", task_id, e, exc_info=True)
        try:
            with db_conn() as conn:
                conn.execute(
                    """
                    UPDATE ai_export_task
                    SET status = 'error',
                        error_message = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (str(e)[:500], task_id),
                )
                conn.commit()
        except Exception:
            logger.error("Task %s: failed to update error status", task_id)
        _cancelled_tasks.discard(task_id)


# ── POST /tasks/{task_id}/start-processing — Start full processing ──


@router.post("/tasks/{task_id:int}/start-processing")
def start_ai_export_processing(
    task_id: int,
    payload: AiExportStartProcessingPayload,
) -> dict[str, Any]:
    """Start full processing for a task (status must be 'preview')."""
    op = payload.operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, status, creator_id, total_rows
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可操作")

        if str(task["status"]) != "preview":
            raise HTTPException(
                status_code=400,
                detail=f"仅 preview 状态任务可启动全量处理，当前状态: {task['status']}",
            )

        # Check global concurrent processing limit
        processing_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM ai_export_task WHERE status = 'processing'"
        ).fetchone()["cnt"]

        if int(processing_count) >= AI_EXPORT_MAX_CONCURRENT_TASKS:
            conn.commit()
            return {
                "task_id": task_id,
                "status": "queued",
                "message": f"当前有 {processing_count} 个任务正在处理，请稍后再试",
            }

        # Reset processed_rows and set status to processing
        conn.execute(
            """
            UPDATE ai_export_task
            SET status = 'processing',
                processed_rows = 0,
                error_message = '',
                updated_at = NOW()
            WHERE id = %s
            """,
            (task_id,),
        )
        conn.commit()

    # Schedule background processing via app-level APScheduler
    from app import _scheduler
    _scheduler.add_job(_run_full_processing, "date", args=[task_id])

    return {"task_id": task_id, "status": "processing"}


# ── GET /tasks/{task_id}/progress — Get processing progress ──


@router.get("/tasks/{task_id:int}/progress")
def get_ai_export_progress(
    task_id: int,
    operator_id: str = "demo_001",
) -> dict[str, Any]:
    """Get processing progress for a task."""
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, status, creator_id, total_rows, processed_rows, error_message
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可查看")

    return {
        "status": str(task["status"]),
        "total_rows": int(task["total_rows"]),
        "processed_rows": int(task["processed_rows"]),
        "error_message": str(task["error_message"]),
    }


# ── POST /tasks/{task_id}/cancel — Cancel processing ──


@router.post("/tasks/{task_id:int}/cancel")
def cancel_ai_export_processing(
    task_id: int,
    payload: AiExportCancelPayload,
) -> dict[str, Any]:
    """Cancel a processing task. Already-processed rows remain available."""
    op = payload.operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, status, creator_id, total_rows, processed_rows
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可操作")

        if str(task["status"]) != "processing":
            raise HTTPException(
                status_code=400,
                detail=f"仅 processing 状态任务可取消，当前状态: {task['status']}",
            )

        # Mark task as cancelled — status becomes 'ready'
        processed_rows = int(task["processed_rows"])
        total_rows = int(task["total_rows"])

        conn.execute(
            """
            UPDATE ai_export_task
            SET status = 'ready', updated_at = NOW()
            WHERE id = %s
            """,
            (task_id,),
        )
        conn.commit()

    # Signal background processing to stop
    _cancelled_tasks.add(task_id)

    return {
        "task_id": task_id,
        "status": "ready",
        "processed_rows": processed_rows,
        "total_rows": total_rows,
        "cancelled": True,
    }


# ── GET /tasks/{task_id}/preview-excel — Preview Excel as HTML ──


@router.get("/tasks/{task_id:int}/preview-excel")
def preview_ai_export_excel(
    task_id: int,
    operator_id: str = "demo_001",
) -> StreamingResponse:
    """Preview processed data as HTML table in a new browser tab.

    Only available when task status == 'ready'. Shows first 100 rows.
    """
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, creator_id, status, original_columns, transform_rules, total_rows
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可预览")

        if str(task["status"]) != "ready":
            raise HTTPException(
                status_code=400,
                detail=f"仅 ready 状态任务可预览 Excel，当前状态: {task['status']}",
            )

        original_columns = task["original_columns"] if isinstance(task["original_columns"], list) else []
        transform_rules = task["transform_rules"] if isinstance(task["transform_rules"], list) else []
        total_rows = int(task["total_rows"] or 0)

        rows = conn.execute(
            """
            SELECT row_index, original_data, derived_data
            FROM ai_export_row
            WHERE task_id = %s
            ORDER BY row_index
            LIMIT 100
            """,
            (task_id,),
        ).fetchall()

    # Build headers
    headers: list[str] = []
    for col in original_columns:
        headers.append(AI_EXPORT_COLUMNS.get(col, col))
    for rule in transform_rules:
        headers.append(str(rule.get("target_column", "")))

    # Build data rows
    data_rows: list[list[str]] = []
    for r in rows:
        od = r["original_data"] if isinstance(r["original_data"], dict) else {}
        dd = r["derived_data"] if isinstance(r["derived_data"], dict) else {}
        merged = {**od, **dd}
        row_values: list[str] = []
        for col in original_columns:
            row_values.append(str(merged.get(col, "")))
        for rule in transform_rules:
            tc = str(rule.get("target_column", ""))
            row_values.append(str(merged.get(tc, "")))
        data_rows.append(row_values)

    # Build HTML page
    header_cells = "".join(f"<th>{h}</th>" for h in headers)
    body_rows = ""
    for row_vals in data_rows:
        body_rows += "<tr>" + "".join(f"<td>{v}</td>" for v in row_vals) + "</tr>\n"

    showing = len(data_rows)
    info_text = f"显示前 {showing} 行 / 共 {total_rows} 行"

    html_content = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Excel 预览 - #{task_id}</title>
<style>
  body {{ font-family: -apple-system, 'Microsoft YaHei', sans-serif; padding: 16px; max-width: 1200px; }}
  h2 {{ color: #6b5b3e; margin-bottom: 8px; }}
  .info {{ color: #8a847c; font-size: 13px; margin-bottom: 12px; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 13px; }}
  th {{ background: #f5f0e6; font-weight: 600; padding: 6px 10px; border: 1px solid #d6cebf; white-space: nowrap; }}
  td {{ padding: 6px 10px; border: 1px solid #d6cebf; }}
  .download-link {{ display: inline-block; margin-top: 16px; padding: 8px 20px;
    background: #c9a06a; color: #fff; border-radius: 4px; text-decoration: none; font-size: 14px; }}
  .download-link:hover {{ background: #b08a50; }}
</style></head><body>
<h2>Excel 预览</h2>
<p class="info">{info_text}</p>
<table><thead><tr>{header_cells}</tr></thead><tbody>{body_rows}</tbody></table>
<a class="download-link" href="/api/ai-export/tasks/{task_id}/download?operator_id={op}">下载完整 Excel</a>
</body></html>"""

    return StreamingResponse(iter([html_content]), media_type="text/html")


# ── GET /tasks/{task_id}/download — Download Excel ──


@router.get("/tasks/{task_id:int}/download")
def download_ai_export_excel(
    task_id: int,
    operator_id: str = "demo_001",
) -> StreamingResponse:
    """Download processed data as Excel (.xlsx) file.

    Only available when task status == 'ready'.
    Records excel_downloaded_at timestamp after successful download.
    """
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, creator_id, status, original_columns, transform_rules
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可下载")

        if str(task["status"]) != "ready":
            raise HTTPException(
                status_code=400,
                detail=f"仅 ready 状态任务可下载 Excel，当前状态: {task['status']}",
            )

        original_columns = task["original_columns"] if isinstance(task["original_columns"], list) else []
        transform_rules = task["transform_rules"] if isinstance(task["transform_rules"], list) else []
        creator_id = str(task["creator_id"])

        # Read all rows
        rows = conn.execute(
            """
            SELECT row_index, original_data, derived_data
            FROM ai_export_row
            WHERE task_id = %s
            ORDER BY row_index
            """,
            (task_id,),
        ).fetchall()

        # Record download timestamp
        conn.execute(
            """
            UPDATE ai_export_task
            SET excel_downloaded_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (task_id,),
        )
        conn.commit()

    # Build header row: original columns (mapped to Chinese) + derived columns (target_column names)
    headers: list[str] = []
    for col in original_columns:
        headers.append(AI_EXPORT_COLUMNS.get(col, col))
    for rule in transform_rules:
        headers.append(str(rule.get("target_column", "")))

    # Build data rows: merge original_data + derived_data, in header column order
    data_rows: list[list[str]] = []
    for r in rows:
        od = r["original_data"] if isinstance(r["original_data"], dict) else {}
        dd = r["derived_data"] if isinstance(r["derived_data"], dict) else {}
        merged = {**od, **dd}

        row_values: list[str] = []
        for col in original_columns:
            row_values.append(str(merged.get(col, "") or ""))
        for rule in transform_rules:
            tc = str(rule.get("target_column", ""))
            row_values.append(str(merged.get(tc, "") or ""))
        data_rows.append(row_values)

    # Generate xlsx with openpyxl (same pattern as requirement export)
    wb = Workbook()
    ws = wb.active
    ws.title = "深度分析导出"

    header_font = Font(bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.alignment = header_alignment
        cell.border = thin_border

    for row_idx, values in enumerate(data_rows, start=2):
        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.border = thin_border

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    today = datetime.now().strftime("%Y-%m-%d")
    filename_utf8 = f"深度分析_{creator_id}_{today}.xlsx"
    encoded_filename = urllib.parse.quote(filename_utf8, safe="")

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


# ── Report generation helpers ──

_echarts_js_cache: str | None = None


def _load_echarts_js() -> str:
    """Load and cache ECharts min.js content for inline injection into report HTML."""
    global _echarts_js_cache
    if _echarts_js_cache is None:
        path = Path(ECHARTS_JS_PATH)
        if path.is_file():
            _echarts_js_cache = path.read_text(encoding="utf-8")
        else:
            _echarts_js_cache = ""
    return _echarts_js_cache


def _aggregate_data(
    rows: list[dict[str, Any]],
    original_columns: list[str],
    transform_rules: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate statistics from full dataset for report generation.

    Returns structured JSON with:
    - Per-column value distributions (frequency counts)
    - TOP 10 values per column
    - Numeric column min/max/avg
    - Date column monthly trends
    - total_rows
    """
    total_rows = len(rows)
    if total_rows == 0:
        return {"total_rows": 0}

    # Determine all column names (original + derived)
    derived_columns = [str(r.get("target_column", "")) for r in transform_rules]
    all_columns = list(original_columns) + derived_columns

    result: dict[str, Any] = {"total_rows": total_rows}

    # Collect per-column frequency distributions
    col_freq: dict[str, dict[str, int]] = {}
    col_numeric_values: dict[str, list[float]] = {}
    col_date_values: dict[str, dict[str, int]] = {}  # YYYY-MM -> count

    for row in rows:
        od = row.get("original_data") if isinstance(row.get("original_data"), dict) else {}
        dd = row.get("derived_data") if isinstance(row.get("derived_data"), dict) else {}
        merged = {**od, **dd}

        for col in all_columns:
            val = merged.get(col)
            if val is None:
                continue
            val_str = str(val).strip()
            if not val_str:
                continue

            # Frequency distribution
            col_freq.setdefault(col, {})
            col_freq[col][val_str] = col_freq[col].get(val_str, 0) + 1

            # Numeric column detection: try to parse as float
            try:
                float_val = float(val_str)
                col_numeric_values.setdefault(col, []).append(float_val)
            except (ValueError, TypeError):
                pass

            # Date column detection: try to parse as date (YYYY-MM or YYYY-MM-DD patterns)
            date_match = re.match(r"^(\d{4}-\d{2})", val_str)
            if date_match:
                month_key = date_match.group(1)
                col_date_values.setdefault(col, {})
                col_date_values[col][month_key] = col_date_values[col].get(month_key, 0) + 1

    # Build distribution results
    for col in all_columns:
        freq = col_freq.get(col, {})
        if not freq:
            continue

        # Sort by frequency descending, take TOP 10
        sorted_freq = sorted(freq.items(), key=lambda x: x[1], reverse=True)
        top10 = sorted_freq[:10]

        # Full distribution
        result[f"{col}_distribution"] = dict(sorted_freq)
        result[f"{col}_top10"] = [{k: v} for k, v in top10]

    # Numeric statistics
    for col, values in col_numeric_values.items():
        if len(values) >= 2:
            result[f"{col}_stats"] = {
                "min": min(values),
                "max": max(values),
                "avg": round(sum(values) / len(values), 2),
                "count": len(values),
            }
        elif len(values) == 1:
            result[f"{col}_stats"] = {
                "min": values[0],
                "max": values[0],
                "avg": values[0],
                "count": 1,
            }

    # Monthly trends for date columns
    for col, month_counts in col_date_values.items():
        sorted_months = sorted(month_counts.items())
        result[f"{col}_monthly_trend"] = [{k: v} for k, v in sorted_months]

    return result


def _sanitize_report_html(html: str) -> str:
    """Post-process LLM-generated HTML: inject ECharts JS and remove dangerous elements.

    1. Replace <!-- ECHARTS_JS_PLACEHOLDER --> with inline ECharts JS
    2. Remove dangerous tags (iframe/object/embed/form/input)
    3. Remove external URL script/link tags
    """
    # Inject ECharts JS
    echarts_js = _load_echarts_js()
    if echarts_js:
        html = html.replace(
            "<!-- ECHARTS_JS_PLACEHOLDER -->",
            f"<script>{echarts_js}</script>",
        )

    # Remove dangerous tags — strip entire element including content
    for tag in ("iframe", "object", "embed", "form", "input"):
        html = re.sub(
            rf"<{tag}[^>]*>.*?</{tag}>",
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )
        # Self-closing variants (e.g. <input ... />)
        html = re.sub(
            rf"<{tag}[^>]*/?>",
            "",
            html,
            flags=re.IGNORECASE,
        )

    # Remove script/link tags with external URLs
    # Match <script src="http..."> or <link href="http..."> and remove them
    html = re.sub(
        r'<script[^>]*\ssrc\s*=\s*["\'](?:https?://|//)[^"\']*["\'][^>]*>.*?</script>',
        "",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    html = re.sub(
        r'<link[^>]*\shref\s*=\s*["\'](?:https?://|//)[^"\']*["\'][^>]*/?>',
        "",
        html,
        flags=re.IGNORECASE,
    )

    return html


_REPORT_GENERATION_SYSTEM_PROMPT = """你是一个数据报告生成助手。你将收到一组聚合统计数据和用户的报告要求。
你需要生成一个完整的、自包含的 HTML 文档作为分析报告。

HTML 文档要求：
1. 必须是完整的自包含 HTML 文档（<!DOCTYPE html> 开始，</html> 结束）
2. 内联所有 CSS 样式（<style> 标签内）
3. 使用 ECharts 绘制图表——在 <head> 中使用占位符 <!-- ECHARTS_JS_PLACEHOLDER -->
   后端会自动将 ECharts 库 JS 内联替换此占位符，你不需要输出 ECharts JS 源码
4. 每个 ECharts 图表使用 <div id="chart-N" style="width:...;height:...;"></div> 容器
5. 图表初始化脚本放在 <script> 标签内，使用 DOMContentLoaded 事件
6. 表格使用 <table> 标签，带基本样式（边框、对齐）
7. 报告布局由用户的提示词决定——你需要根据提示词安排标题、图表、表格的位置和排列
8. 所有文字内容使用中文
9. 报告顶部必须有标题区域，包含报告名称和生成日期
10. 不允许任何外部资源引用（CDN、外部 CSS/JS、图片 URL等），系统完全离线"""


def _call_llm_for_report_generation(
    llm_config: dict[str, Any],
    aggregated_data: dict[str, Any],
    report_prompt: str,
) -> str:
    """Call LLM to generate a complete self-contained HTML report.

    Returns the raw HTML string from LLM (before sanitization).
    """
    url = (llm_config.get("llm_api_base_url", "") or "").rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": "Bearer " + (llm_config.get("llm_api_key", "") or ""),
        "Content-Type": "application/json",
    }

    # Build messages
    aggregated_json = json.dumps(aggregated_data, ensure_ascii=False, indent=2)
    user_prompt = f"聚合统计数据：\n{aggregated_json}\n\n用户要求：{report_prompt}"

    body = {
        "model": llm_config.get("llm_model", "") or "",
        "messages": [
            {"role": "system", "content": _REPORT_GENERATION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.5,
    }

    with httpx.Client(timeout=180) as client:
        resp = client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"LLM 报告生成调用失败: HTTP {resp.status_code}",
        )

    resp_json = resp.json()
    content = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")

    # Strip markdown code block wrappers if present
    content = content.strip()
    if content.startswith("```"):
        first_newline = content.index("\n") if "\n" in content else len(content)
        content = content[first_newline + 1:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

    return content


# ── POST /tasks/{task_id}/generate-report — Generate analysis report ──


@router.post("/tasks/{task_id:int}/generate-report")
def generate_ai_export_report(
    task_id: int,
    payload: AiExportGenerateReportPayload,
) -> dict[str, Any]:
    """Generate an analysis report HTML from aggregated data + user prompt via LLM.

    Only available when task status == 'ready'.
    Returns 409 if report_status is already 'generating'.
    The actual LLM call runs in APScheduler background thread — endpoint returns immediately.
    """
    op = payload.operator_id.strip() or "demo_001"
    report_prompt = payload.report_prompt.strip()

    if not report_prompt:
        raise HTTPException(status_code=400, detail="报告提示词不能为空")

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, creator_id, status, report_status
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可操作")

        if str(task["status"]) != "ready":
            raise HTTPException(
                status_code=400,
                detail=f"仅 ready 状态任务可生成报告，当前状态: {task['status']}",
            )

        if str(task["report_status"]) == "generating":
            raise HTTPException(
                status_code=409,
                detail="报告正在生成中，请稍后再试",
            )

        # Immediately set report_status to 'generating' and save report_prompt
        conn.execute(
            """
            UPDATE ai_export_task
            SET report_status = 'generating',
                report_prompt = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (report_prompt, task_id),
        )
        conn.commit()

    # Schedule background report generation via APScheduler
    from app import _scheduler
    _scheduler.add_job(_run_report_generation, "date", args=[task_id, op])

    return {"task_id": task_id, "report_status": "generating", "ok": True}


def _run_report_generation(task_id: int, operator_id: str) -> None:
    """Background task: generate report HTML via LLM.

    Runs in APScheduler background thread. Uses synchronous db_conn and httpx.
    Any exception resets report_status to 'none' and records error_message.
    """
    logger.info("Report generation started for task %s", task_id)

    try:
        with db_conn() as conn:
            task = conn.execute(
                """
                SELECT id, creator_id, status, report_status, report_prompt,
                       original_columns, transform_rules
                FROM ai_export_task WHERE id = %s
                """,
                (task_id,),
            ).fetchone()

            if not task or str(task["status"]) != "ready":
                logger.warning("Task %s not in ready state, skipping report generation", task_id)
                return

            if str(task["report_status"]) != "generating":
                logger.warning("Task %s report_status not 'generating', skipping", task_id)
                return

            report_prompt = str(task["report_prompt"] or "")
            original_columns = task["original_columns"] if isinstance(task["original_columns"], list) else []
            transform_rules = task["transform_rules"] if isinstance(task["transform_rules"], list) else []

            llm_config = _resolve_llm_config(conn, operator_id)

        if not llm_config.get("llm_api_key") or not llm_config.get("llm_api_base_url"):
            logger.error("Task %s: LLM config incomplete", task_id)
            with db_conn() as conn:
                conn.execute(
                    """
                    UPDATE ai_export_task
                    SET report_status = 'none',
                        error_message = 'LLM 配置不完整，请联系管理员配置 API Key 和 Base URL',
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (task_id,),
                )
                conn.commit()
            return

        # Read all rows for aggregation
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT row_index, original_data, derived_data
                FROM ai_export_row
                WHERE task_id = %s
                ORDER BY row_index
                """,
                (task_id,),
            ).fetchall()

        # Aggregate data for LLM
        aggregated_data = _aggregate_data(rows, original_columns, transform_rules)

        # Call LLM for report generation
        raw_html = _call_llm_for_report_generation(llm_config, aggregated_data, report_prompt)

        # Sanitize HTML
        report_html = _sanitize_report_html(raw_html)

        # Save HTML and set report_status to 'done'
        with db_conn() as conn:
            conn.execute(
                """
                UPDATE ai_export_task
                SET report_html = %s,
                    report_status = 'done',
                    error_message = '',
                    updated_at = NOW()
                WHERE id = %s
                """,
                (report_html, task_id),
            )
            conn.commit()

        logger.info("Task %s report generation completed", task_id)

    except Exception as e:
        logger.error("Task %s report generation failed: %s", task_id, e, exc_info=True)
        # Reset report_status on ANY failure
        try:
            with db_conn() as conn:
                conn.execute(
                    """
                    UPDATE ai_export_task
                    SET report_status = 'none',
                        error_message = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (str(e)[:500], task_id),
                )
                conn.commit()
        except Exception:
            logger.error("Task %s: failed to reset report_status after error", task_id)


def _recover_stuck_generating_reports() -> None:
    """Recover tasks stuck in report_status='generating' for more than 10 minutes."""
    try:
        with db_conn() as conn:
            stuck = conn.execute(
                """
                SELECT id FROM ai_export_task
                WHERE report_status = 'generating'
                  AND updated_at < NOW() - INTERVAL '10 minutes'
                """,
            ).fetchall()
            for row in stuck:
                task_id = row["id"]
                logger.warning("Recovering stuck report generation for task %s", task_id)
                conn.execute(
                    """
                    UPDATE ai_export_task
                    SET report_status = 'none',
                        error_message = '报告生成超时，已自动回退',
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (task_id,),
                )
            if stuck:
                conn.commit()
                logger.info("Recovered %d stuck report tasks", len(stuck))
    except Exception as e:
        logger.error("Failed to recover stuck report tasks: %s", e)


# ── GET /tasks/{task_id}/report-html — Get report HTML content ──


@router.get("/tasks/{task_id:int}/report-html")
def get_ai_export_report_html(
    task_id: int,
    operator_id: str = "demo_001",
) -> StreamingResponse:
    """Get report HTML content (Content-Type: text/html).

    Only available when report_status == 'done'.
    """
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, creator_id, report_status, report_html
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可查看")

        if str(task["report_status"]) != "done":
            raise HTTPException(
                status_code=400,
                detail=f"报告尚未生成完成，当前状态: {task['report_status']}",
            )

        report_html = str(task["report_html"])

    return StreamingResponse(
        iter([report_html]),
        media_type="text/html",
    )


# ── GET /tasks/{task_id}/report-download — Download report HTML file ──


@router.get("/tasks/{task_id:int}/report-download")
def download_ai_export_report(
    task_id: int,
    operator_id: str = "demo_001",
) -> StreamingResponse:
    """Download report HTML file as attachment.

    Only available when report_status == 'done'.
    The downloaded HTML is fully self-contained (inline ECharts JS + CSS).
    """
    op = operator_id.strip() or "demo_001"

    with db_conn() as conn:
        _check_table_ready(conn)

        task = conn.execute(
            """
            SELECT id, creator_id, report_status, report_html
            FROM ai_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可下载")

        if str(task["report_status"]) != "done":
            raise HTTPException(
                status_code=400,
                detail=f"报告尚未生成完成，当前状态: {task['report_status']}",
            )

        report_html = str(task["report_html"])
        creator_id = str(task["creator_id"])

    today = datetime.now().strftime("%Y-%m-%d")
    filename_utf8 = f"分析报告_{creator_id}_{today}.html"
    encoded_filename = urllib.parse.quote(filename_utf8, safe="")

    return StreamingResponse(
        iter([report_html]),
        media_type="text/html",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


