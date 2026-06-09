from __future__ import annotations

import json
import logging
import urllib.parse
from datetime import datetime
from io import BytesIO
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
)
from database import db_conn
from models import (
    AiExportTaskCreatePayload,
    AiExportTranslateRulesPayload,
    AiExportStartProcessingPayload,
    AiExportCancelPayload,
    TransformRules,
)
from whitelist_policy import whitelist_permission_level, whitelist_field_levels
from routers.ai import _resolve_llm_config, _load_system_llm_config

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
        _require_ai_export_enabled(conn, op)

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
        _require_ai_export_enabled(conn, op)

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
        _require_ai_export_enabled(conn, op)

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
        _require_ai_export_enabled(conn, op)

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
        _require_ai_export_enabled(conn, op)

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
        _require_ai_export_enabled(conn, op)

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
    ws.title = "数据智析导出"

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
    filename_utf8 = f"数据智析_{creator_id}_{today}.xlsx"
    encoded_filename = urllib.parse.quote(filename_utf8, safe="")

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )