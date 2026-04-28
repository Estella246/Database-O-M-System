from __future__ import annotations
import json
import re
from datetime import datetime
from typing import Any
import httpx
import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException
from config import _AI_SCHEMA_HINT
from database import db_conn
from models import (
    AiConversationCreatePayload,
    AiConversationPatchPayload,
    AiChatPayload,
    AiQuickTemplateCreatePayload,
    AiQuickTemplatePatchPayload,
    AiUserLlmConfigPutPayload,
)

_AI_READONLY_SQL_RE = re.compile(r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b", re.IGNORECASE)
_AI_SCHEMA_CACHE: list[dict[str, Any]] = []
_AI_SCHEMA_CACHE_AT: float = 0.0
_AI_SCHEMA_CACHE_TTL = 600.0

_DEFAULT_AI_SYSTEM_PROMPT = """你是一个数据库运维工单系统的智能助手。用户会用自然语言提问，你需要通过查询数据库来回答问题。

你可以使用工具 `db_query` 来执行只读 SQL 查询。

当前系统的业务说明：
- 这是一个运维工单系统，工单流程节点：问题填写→问题审核→运维分析→开发分析→开发闭环→运维闭环→审核关闭
- 工单号格式：YW + YYYYMMDD + 三位序号
- 严重性分为：致命、严重、一般
- 系统还包含值班管理、请假申请、需求管理等模块

查询数据库时请注意：
1. 只能执行 SELECT 查询，严禁修改数据
2. 优先查询最近的数据，注意时间范围
3. 查询结果如果为空，说明没有匹配的数据
4. 如果 SQL 执行出错，请修正后重试
5. 尽量给出精确的数字和具体信息，而不是模糊的描述
6. 如果需要展示趋势或分布，可以返回 chart_config 字段来生成 ECharts 图表配置

回答格式要求：
- 请使用 Markdown 格式回答，支持标题、列表、加粗、代码块、表格等语法
- 数字和关键信息使用 **加粗** 标注
- SQL 语句使用 ```sql 代码块
- 多条数据对比时使用 Markdown 表格
"""

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _ai_table_ready(conn: psycopg.Connection) -> bool:
    r = conn.execute("SELECT to_regclass('public.ai_conversation') AS name").fetchone()
    return bool(r and r.get("name"))


def _require_ai_enabled(conn: psycopg.Connection, operator_id: str) -> dict[str, Any]:
    if not _ai_table_ready(conn):
        raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
    config = _load_system_llm_config(conn)
    if str(config.get("llm_enabled", "false")).lower() != "true":
        raise HTTPException(status_code=400, detail="智能助手未启用，请联系管理员在参数配置→大模型配置中启用")
    return config


def _load_system_llm_config(conn: psycopg.Connection) -> dict[str, str]:
    try:
        rows = conn.execute("SELECT key, value FROM param_llm_config").fetchall()
    except UndefinedTable:
        return {}
    return {str(r["key"]): str(r["value"]) for r in rows}


def _resolve_llm_config(conn: psycopg.Connection, account: str) -> dict[str, Any]:
    system_config = _load_system_llm_config(conn)
    result: dict[str, Any] = {}
    type_map: dict[str, type] = {"int": int, "float": float, "bool": str, "string": str}
    for k, v in system_config.items():
        result[k] = v
    try:
        user_row = conn.execute(
            "SELECT * FROM ai_user_llm_config WHERE account = %s",
            (account,),
        ).fetchone()
    except UndefinedTable:
        user_row = None
    if user_row:
        field_map = {
            "api_base_url": "llm_api_base_url",
            "api_key": "llm_api_key",
            "model": "llm_model",
            "max_tokens": "llm_max_tokens",
            "temperature": "llm_temperature",
            "system_prompt": "llm_system_prompt",
            "query_timeout": "llm_query_timeout",
            "max_react_rounds": "llm_max_react_rounds",
            "max_result_rows": "llm_max_result_rows",
            "context_max_token": "llm_context_max_token",
        }
        for u_field, s_key in field_map.items():
            val = user_row.get(u_field)
            if val is not None:
                result[s_key] = str(val) if not isinstance(val, str) else val
    return result


def _mask_api_key(val: str) -> str:
    s = str(val or "").strip()
    if len(s) <= 8:
        return "****" if s else ""
    return s[:4] + "****" + s[-4:]


def _refresh_schema_cache(conn: psycopg.Connection) -> list[dict[str, Any]]:
    global _AI_SCHEMA_CACHE, _AI_SCHEMA_CACHE_AT
    allowed_prefixes = (
        "ticket", "ticket_node_", "workflow_", "option_", "user_account",
        "duty_", "param_", "requirement", "leave_", "handle_mode_",
        "ai_conversation", "ai_message", "ai_quick_template", "ai_user_llm_config",
        "holiday_config",
    )
    rows = conn.execute(
        """
        SELECT table_name, obj_description((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass) AS table_comment
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    ).fetchall()
    tables = []
    for r in rows:
        tname = str(r["table_name"] or "")
        if not any(tname.startswith(p) for p in allowed_prefixes):
            continue
        col_rows = conn.execute(
            """
            SELECT column_name, data_type, col_description((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass, ordinal_position) AS col_comment
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (tname,),
        ).fetchall()
        columns = []
        for cr in col_rows:
            columns.append({
                "name": str(cr["column_name"] or ""),
                "type": str(cr["data_type"] or ""),
                "comment": str(cr["col_comment"] or ""),
            })
        tables.append({
            "table": tname,
            "comment": str(r["table_comment"] or ""),
            "columns": columns,
        })
    _AI_SCHEMA_CACHE = tables
    _AI_SCHEMA_CACHE_AT = datetime.now().timestamp()
    return tables


def _get_schema_info(conn: psycopg.Connection) -> list[dict[str, Any]]:
    global _AI_SCHEMA_CACHE, _AI_SCHEMA_CACHE_AT
    now = datetime.now().timestamp()
    if _AI_SCHEMA_CACHE and (now - _AI_SCHEMA_CACHE_AT) < _AI_SCHEMA_CACHE_TTL:
        return _AI_SCHEMA_CACHE
    return _refresh_schema_cache(conn)


def _build_db_schema_text(schema_info: list[dict[str, Any]]) -> str:
    lines = []
    for t in schema_info:
        comment = f"  -- {t['comment']}" if t.get("comment") else ""
        lines.append(f"表 {t['table']}{comment}")
        for c in t.get("columns", []):
            cc = f"  -- {c['comment']}" if c.get("comment") else ""
            lines.append(f"  {c['name']} {c['type']}{cc}")
        lines.append("")
    return "\n".join(lines)


def _validate_readonly_sql(sql: str) -> str:
    s = str(sql or "").strip()
    if not s:
        raise ValueError("SQL 不能为空")
    if _AI_READONLY_SQL_RE.search(s):
        raise ValueError("仅允许 SELECT 查询，禁止修改操作")
    if not s.upper().startswith("SELECT"):
        raise ValueError("仅允许 SELECT 查询")
    return s


def _estimate_tokens(messages: list[dict[str, str]]) -> int:
    total = 0
    for m in messages:
        total += 4
        for k, v in m.items():
            total += len(v) // 3 + 1
    return total


async def _compress_messages_if_needed(
    messages: list[dict[str, str]],
    context_max_token: int,
    api_base_url: str,
    api_key: str,
    model: str,
    temperature: float,
) -> list[dict[str, str]]:
    threshold = int(context_max_token * 0.5)
    estimated = _estimate_tokens(messages)
    if estimated < threshold:
        return messages

    if len(messages) <= 2:
        return messages

    system_msg = messages[0] if messages[0].get("role") == "system" else None
    conversation = messages[1:] if system_msg else messages[:]

    if len(conversation) <= 2:
        return messages

    keep_recent = max(2, len(conversation) // 4)
    older = conversation[:-keep_recent]
    recent = conversation[-keep_recent:]

    older_text = "\n".join(f"[{m.get('role', 'user')}]: {m.get('content', '')}" for m in older)
    compress_prompt = (
        "请将以下多轮对话历史压缩为简洁的摘要，保留关键信息、数据、结论和上下文，"
        "去除冗余和重复内容。压缩后的摘要应能让后续对话无缝继续。\n\n"
        f"--- 对话历史 ---\n{older_text}\n--- 结束 ---\n\n"
        "请输出压缩后的摘要："
    )

    try:
        summary, _, _ = await _call_llm(
            api_base_url, api_key, model,
            [{"role": "system", "content": "你是一个对话摘要助手，负责将冗长的对话历史压缩为简洁摘要。"},
             {"role": "user", "content": compress_prompt}],
            1024, temperature,
        )
        summary = summary.strip()
    except Exception:
        summary = older_text[-2000:] if len(older_text) > 2000 else older_text

    compressed_msg = {
        "role": "system",
        "content": f"[对话历史摘要]\n{summary}",
    }

    result = []
    if system_msg:
        result.append(system_msg)
    result.append(compressed_msg)
    result.extend(recent)
    return result


def _execute_ai_query(conn: psycopg.Connection, sql: str, timeout_secs: int, max_rows: int) -> list[dict[str, Any]]:
    clean_sql = _validate_readonly_sql(sql)
    limit_sql = clean_sql
    if "LIMIT" not in clean_sql.upper():
        limit_sql = f"{clean_sql} LIMIT {max_rows}"
    conn.execute("SET TRANSACTION READ ONLY")
    conn.execute(f"SET statement_timeout = '{int(timeout_secs)}s'")
    rows = conn.execute(limit_sql).fetchall()
    return [dict(r) for r in rows]


def _build_react_messages(
    conversation_messages: list[dict[str, Any]],
    system_prompt: str,
    schema_text: str,
) -> list[dict[str, str]]:
    tool_desc = '{"sql": "你的SQL语句"}'
    full_system = (
        f"{system_prompt}\n\n"
        f"以下是当前数据库的表结构信息：\n\n{schema_text}\n\n"
        f"你可以使用以下工具：\n"
        f"- db_query: 执行只读SQL查询数据库，参数为 {tool_desc}\n\n"
        f"请按 ReAct 格式思考和行动。当你需要查询数据库时，使用如下格式：\n"
        f"Thought: 你的思考过程\n"
        f"Action: db_query\n"
        f"Action Input: {tool_desc}\n\n"
        f"当你已经获得足够信息可以回答用户时，使用如下格式：\n"
        f"Thought: 你的思考过程\n"
        f"Final Answer: 你的最终回答"
    )
    messages = [{"role": "system", "content": full_system}]
    for m in conversation_messages:
        role = str(m.get("role") or "")
        content = str(m.get("content") or "")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": content})
    return messages


def _parse_react_response(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {"thought": "", "action": None, "action_input": None, "final_answer": None}
    thought_match = re.search(r"Thought:\s*(.+?)(?=\n(?:Action|Final Answer)|$)", text, re.DOTALL)
    if thought_match:
        result["thought"] = thought_match.group(1).strip()
    action_match = re.search(r"Action:\s*(.+?)(?=\n|$)", text)
    if action_match:
        result["action"] = action_match.group(1).strip()
    ai_match = re.search(r"Action Input:\s*(.+?)(?=\n(?:Thought|Final Answer|Action)|$)", text, re.DOTALL)
    if ai_match:
        raw = ai_match.group(1).strip()
        try:
            result["action_input"] = json.loads(raw)
        except json.JSONDecodeError:
            result["action_input"] = {"sql": raw}
    fa_match = re.search(r"Final Answer:\s*(.+?)$", text, re.DOTALL)
    if fa_match:
        result["final_answer"] = fa_match.group(1).strip()
    if not result["action"] and not result["final_answer"] and not result["thought"]:
        result["final_answer"] = text.strip()
    return result


async def _call_llm_stream(api_base_url: str, api_key: str, model: str, messages: list[dict[str, str]], max_tokens: int, temperature: float):
    url = f"{str(api_base_url).rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise HTTPException(status_code=502, detail=f"LLM API 错误 ({resp.status_code}): {body.decode('utf-8', errors='replace')[:500]}")
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue


async def _call_llm(api_base_url: str, api_key: str, model: str, messages: list[dict[str, str]], max_tokens: int, temperature: float) -> tuple[str, int, int]:
    url = f"{str(api_base_url).rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"LLM API 错误 ({resp.status_code}): {resp.text[:500]}")
        data = resp.json()
        content = str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
        usage = data.get("usage", {})
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        return content, prompt_tokens, completion_tokens


@router.get("/conversations")
def list_ai_conversations(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        rows = conn.execute(
            """
            SELECT id, title, total_tokens, created_at, updated_at
            FROM ai_conversation
            WHERE creator_id = %s AND is_deleted = FALSE
            ORDER BY updated_at DESC, id DESC
            """,
            (op,),
        ).fetchall()
    return {"items": rows}


@router.post("/conversations")
def create_ai_conversation(payload: AiConversationCreatePayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    title = str(payload.title or "").strip() or "新对话"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        row = conn.execute(
            """
            INSERT INTO ai_conversation (title, creator_id, creator_name)
            VALUES (%s, %s, %s)
            RETURNING id, title, total_tokens, created_at, updated_at
            """,
            (title[:256], op, ""),
        ).fetchone()
        conn.commit()
    return {"item": row}


@router.patch("/conversations/{conv_id:int}")
def patch_ai_conversation(conv_id: int, payload: AiConversationPatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    title = str(payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute(
            "SELECT id, creator_id FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可编辑")
        conn.execute(
            "UPDATE ai_conversation SET title = %s, updated_at = NOW() WHERE id = %s",
            (title[:256], conv_id),
        )
        conn.commit()
    return {"ok": True}


@router.delete("/conversations/{conv_id:int}")
def delete_ai_conversation(conv_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute(
            "SELECT id, creator_id FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可删除")
        conn.execute(
            "UPDATE ai_conversation SET is_deleted = TRUE, updated_at = NOW() WHERE id = %s",
            (conv_id,),
        )
        conn.commit()
    return {"ok": True}


@router.get("/conversations/{conv_id:int}/messages")
def list_ai_messages(conv_id: int, operator_id: str = "demo_001", page: int = 1, page_size: int = 50) -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        conv = conn.execute(
            "SELECT id, creator_id FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not conv:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(conv["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="无权访问")
        total = conn.execute(
            "SELECT COUNT(*) AS cnt FROM ai_message WHERE conversation_id = %s",
            (conv_id,),
        ).fetchone()["cnt"]
        offset = max(0, (page - 1) * page_size)
        rows = conn.execute(
            """
            SELECT id, role, content, react_steps, sql_query, query_result, chart_config,
                   prompt_tokens, completion_tokens, created_at
            FROM ai_message
            WHERE conversation_id = %s
            ORDER BY created_at ASC, id ASC
            LIMIT %s OFFSET %s
            """,
            (conv_id, page_size, offset),
        ).fetchall()
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@router.post("/conversations/{conv_id:int}/chat")
async def chat_ai_conversation(conv_id: int, payload: AiChatPayload):
    import asyncio

    op = payload.operator_id.strip() or "demo_001"
    content = str(payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息不能为空")

    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        config = _require_ai_enabled(conn, op)
        conv = conn.execute(
            "SELECT id, creator_id, title FROM ai_conversation WHERE id = %s AND is_deleted = FALSE",
            (conv_id,),
        ).fetchone()
        if not conv:
            raise HTTPException(status_code=404, detail="会话不存在")
        if str(conv["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="无权访问")
        resolved = _resolve_llm_config(conn, op)
        schema_info = _get_schema_info(conn)
        conn.execute(
            "INSERT INTO ai_message (conversation_id, role, content) VALUES (%s, %s, %s)",
            (conv_id, "user", content),
        )
        if str(conv["title"] or "").strip() in ("", "新对话"):
            conn.execute(
                "UPDATE ai_conversation SET title = %s, updated_at = NOW() WHERE id = %s",
                (content[:256], conv_id),
            )
        conn.commit()
        prev_messages = conn.execute(
            """
            SELECT role, content FROM ai_message
            WHERE conversation_id = %s
            ORDER BY created_at ASC, id ASC
            """,
            (conv_id,),
        ).fetchall()

    api_base_url = str(resolved.get("llm_api_base_url", ""))
    api_key = str(resolved.get("llm_api_key", ""))
    model = str(resolved.get("llm_model", "gpt-4o"))
    try:
        max_tokens = int(resolved.get("llm_max_tokens", 4096))
    except (ValueError, TypeError):
        max_tokens = 4096
    try:
        temperature = float(resolved.get("llm_temperature", 0.0))
    except (ValueError, TypeError):
        temperature = 0.0
    system_prompt = str(resolved.get("llm_system_prompt", "")).strip()
    if not system_prompt:
        system_prompt = _DEFAULT_AI_SYSTEM_PROMPT
    try:
        query_timeout = int(resolved.get("llm_query_timeout", 30))
    except (ValueError, TypeError):
        query_timeout = 30
    try:
        max_react_rounds = int(resolved.get("llm_max_react_rounds", 5))
    except (ValueError, TypeError):
        max_react_rounds = 5
    try:
        max_result_rows = int(resolved.get("llm_max_result_rows", 200))
    except (ValueError, TypeError):
        max_result_rows = 200
    try:
        context_max_token = int(resolved.get("llm_context_max_token", 128000))
    except (ValueError, TypeError):
        context_max_token = 128000

    if not api_key:
        raise HTTPException(status_code=400, detail="未配置大模型 API Key，请在参数配置→大模型配置中配置，或在智能助手中配置个人模型")

    schema_text = _build_db_schema_text(schema_info)
    messages = _build_react_messages(list(prev_messages), system_prompt, schema_text)

    messages = await _compress_messages_if_needed(messages, context_max_token, api_base_url, api_key, model, temperature)

    react_steps: list[dict[str, Any]] = []
    last_sql: str | None = None
    last_query_result: list[dict[str, Any]] | None = None
    final_answer = ""
    total_prompt_tokens = 0
    total_completion_tokens = 0

    for round_i in range(max_react_rounds):
        try:
            llm_text, round_prompt_tokens, round_completion_tokens = await _call_llm(api_base_url, api_key, model, messages, max_tokens, temperature)
            total_prompt_tokens += round_prompt_tokens
            total_completion_tokens += round_completion_tokens
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"大模型调用失败：{str(exc)[:300]}")

        parsed = _parse_react_response(llm_text)

        if parsed.get("thought"):
            react_steps.append({"thought": parsed["thought"]})

        if parsed.get("final_answer"):
            final_answer = parsed["final_answer"]
            break

        if parsed.get("action") and parsed.get("action_input"):
            action = str(parsed["action"]).strip()
            action_input = parsed["action_input"]
            sql = ""
            if action == "db_query" and isinstance(action_input, dict):
                sql = str(action_input.get("sql", "")).strip()

            if not sql:
                messages.append({"role": "assistant", "content": llm_text})
                messages.append({"role": "user", "content": "Action Input 中缺少有效的 SQL 查询，请重新生成。"})
                continue

            step: dict[str, Any] = {"thought": parsed.get("thought", ""), "action": action, "sql": sql}
            try:
                with db_conn() as qconn:
                    result = _execute_ai_query(qconn, sql, query_timeout, max_result_rows)
                step["observation"] = result
                last_sql = sql
                last_query_result = result
            except Exception as exc:
                err_msg = str(exc)[:500]
                step["observation"] = f"SQL 执行错误：{err_msg}"
            react_steps.append(step)

            obs_text = json.dumps(step.get("observation"), ensure_ascii=False, default=str) if not isinstance(step.get("observation"), str) else step["observation"]
            messages.append({"role": "assistant", "content": llm_text})
            messages.append({"role": "user", "content": f"Observation: {obs_text}"})
        else:
            final_answer = llm_text
            break
    else:
        if not final_answer:
            final_answer = "抱歉，经过多轮推理仍未能得出完整答案，请尝试更具体地描述您的问题。"

    with db_conn() as conn:
        conn.execute(
            """
            INSERT INTO ai_message (conversation_id, role, content, react_steps, sql_query, query_result, prompt_tokens, completion_tokens)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (conv_id, "assistant", final_answer, json.dumps(react_steps, ensure_ascii=False, default=str) if react_steps else None, last_sql, json.dumps(last_query_result, ensure_ascii=False, default=str) if last_query_result else None, total_prompt_tokens, total_completion_tokens),
        )
        conn.execute(
            "UPDATE ai_conversation SET total_tokens = total_tokens + %s, updated_at = NOW() WHERE id = %s",
            (total_prompt_tokens + total_completion_tokens, conv_id),
        )
        conn.commit()

    return {"role": "assistant", "content": final_answer, "react_steps": react_steps, "sql_query": last_sql, "query_result": last_query_result, "prompt_tokens": total_prompt_tokens, "completion_tokens": total_completion_tokens, "total_tokens": total_prompt_tokens + total_completion_tokens}


@router.get("/quick-templates")
def list_ai_quick_templates(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        rows = conn.execute(
            """
            SELECT id, question, is_preset, creator_id, sort_order, created_at
            FROM ai_quick_template
            WHERE is_preset = TRUE OR creator_id = %s
            ORDER BY is_preset DESC, sort_order, id
            """,
            (op,),
        ).fetchall()
    return {"items": rows}


@router.post("/quick-templates")
def create_ai_quick_template(payload: AiQuickTemplateCreatePayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    question = str(payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        sort_row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ai_quick_template WHERE creator_id = %s AND is_preset = FALSE",
            (op,),
        ).fetchone()
        sort_order = int(sort_row["n"]) if sort_row else 0
        row = conn.execute(
            """
            INSERT INTO ai_quick_template (question, is_preset, creator_id, sort_order)
            VALUES (%s, FALSE, %s, %s)
            RETURNING id, question, is_preset, creator_id, sort_order, created_at
            """,
            (question, op, sort_order),
        ).fetchone()
        conn.commit()
    return {"item": row}


@router.patch("/quick-templates/{tpl_id:int}")
def patch_ai_quick_template(tpl_id: int, payload: AiQuickTemplatePatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    question = str(payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute("SELECT * FROM ai_quick_template WHERE id = %s", (tpl_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="模板不存在")
        if bool(existing["is_preset"]):
            raise HTTPException(status_code=400, detail="预设模板不可编辑")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可编辑")
        conn.execute(
            "UPDATE ai_quick_template SET question = %s WHERE id = %s",
            (question, tpl_id),
        )
        conn.commit()
    return {"ok": True}


@router.delete("/quick-templates/{tpl_id:int}")
def delete_ai_quick_template(tpl_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        existing = conn.execute("SELECT * FROM ai_quick_template WHERE id = %s", (tpl_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="模板不存在")
        if bool(existing["is_preset"]):
            raise HTTPException(status_code=400, detail="预设模板不可删除")
        if str(existing["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建人可删除")
        conn.execute("DELETE FROM ai_quick_template WHERE id = %s", (tpl_id,))
        conn.commit()
    return {"ok": True}


@router.get("/my-llm-config")
def get_my_llm_config(operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        try:
            system_config = _load_system_llm_config(conn)
        except UndefinedTable:
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        try:
            user_row = conn.execute("SELECT * FROM ai_user_llm_config WHERE account = %s", (op,)).fetchone()
        except UndefinedTable:
            user_row = None
    user_override: dict[str, Any] = {}
    has_user_config = user_row is not None
    if user_row:
        for f in ("api_base_url", "api_key", "model", "max_tokens", "temperature", "system_prompt", "query_timeout", "max_react_rounds", "max_result_rows", "context_max_token"):
            v = user_row.get(f)
            if v is not None:
                user_override[f] = v
    if "api_key" in user_override:
        user_override["api_key"] = _mask_api_key(str(user_override["api_key"]))
    system_default = {}
    key_map = {
        "llm_api_base_url": "api_base_url",
        "llm_api_key": "api_key",
        "llm_model": "model",
        "llm_max_tokens": "max_tokens",
        "llm_temperature": "temperature",
        "llm_system_prompt": "system_prompt",
        "llm_query_timeout": "query_timeout",
        "llm_max_react_rounds": "max_react_rounds",
        "llm_max_result_rows": "max_result_rows",
        "llm_context_max_token": "context_max_token",
    }
    for sk, uk in key_map.items():
        sv = system_config.get(sk, "")
        if uk == "api_key":
            sv = _mask_api_key(sv)
        system_default[uk] = sv
    effective = {}
    for uk in key_map.values():
        if uk in user_override and user_override[uk] not in (None, "", "****"):
            effective[uk] = user_override[uk]
        else:
            effective[uk] = system_default.get(uk, "")
    return {"effective": effective, "user_override": user_override, "system_default": system_default, "has_user_config": has_user_config}


@router.put("/my-llm-config")
def put_my_llm_config(payload: AiUserLlmConfigPutPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    fields: dict[str, Any] = {}
    if payload.api_base_url is not None:
        fields["api_base_url"] = str(payload.api_base_url).strip() or None
    if payload.api_key is not None:
        ak = str(payload.api_key).strip()
        if "****" in ak:
            pass
        else:
            fields["api_key"] = ak or None
    if payload.model is not None:
        fields["model"] = str(payload.model).strip() or None
    if payload.max_tokens is not None:
        fields["max_tokens"] = payload.max_tokens
    if payload.temperature is not None:
        fields["temperature"] = payload.temperature
    if payload.system_prompt is not None:
        fields["system_prompt"] = str(payload.system_prompt).strip() or None
    if payload.query_timeout is not None:
        fields["query_timeout"] = payload.query_timeout
    if payload.max_react_rounds is not None:
        fields["max_react_rounds"] = payload.max_react_rounds
    if payload.max_result_rows is not None:
        fields["max_result_rows"] = payload.max_result_rows
    if payload.context_max_token is not None:
        fields["context_max_token"] = payload.context_max_token

    all_null = all(v is None for v in fields.values())
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        if all_null:
            conn.execute("DELETE FROM ai_user_llm_config WHERE account = %s", (op,))
            conn.commit()
            return {"ok": True, "cleared": True}
        existing = conn.execute("SELECT account FROM ai_user_llm_config WHERE account = %s", (op,)).fetchone()
        if existing:
            set_parts = []
            values = []
            for k, v in fields.items():
                set_parts.append(f"{k} = %s")
                values.append(v)
            set_parts.append("updated_at = NOW()")
            values.append(op)
            conn.execute(
                f"UPDATE ai_user_llm_config SET {', '.join(set_parts)} WHERE account = %s",
                values,
            )
        else:
            cols = ["account"]
            vals = [op]
            for k, v in fields.items():
                cols.append(k)
                vals.append(v)
            col_names = ", ".join(cols)
            placeholders_list = ", ".join(["%s"] * len(cols))
            conn.execute(
                f"INSERT INTO ai_user_llm_config ({col_names}) VALUES ({placeholders_list})",
                vals,
            )
        conn.commit()
    return {"ok": True}


@router.post("/my-llm-config/test")
def test_my_llm_config(payload: AiUserLlmConfigPutPayload) -> dict[str, Any]:
    import httpx as _httpx

    op = payload.operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        resolved = _resolve_llm_config(conn, op)
    api_base_url = str(payload.api_base_url or resolved.get("llm_api_base_url", "")).strip()
    api_key = str(payload.api_key or resolved.get("llm_api_key", "")).strip()
    model = str(payload.model or resolved.get("llm_model", "gpt-4o")).strip()
    if "****" in api_key:
        api_key = str(resolved.get("llm_api_key", "")).strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置 API Key")
    url = f"{api_base_url.rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    test_payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 10,
    }
    try:
        with _httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json=test_payload, headers=headers)
            if resp.status_code != 200:
                return {"ok": False, "status": resp.status_code, "error": resp.text[:500]}
            return {"ok": True, "status": resp.status_code}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:500]}


@router.post("/refresh-schema")
def refresh_schema(operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        if not _ai_table_ready(conn):
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
        tables = _refresh_schema_cache(conn)
    return {"ok": True, "table_count": len(tables)}