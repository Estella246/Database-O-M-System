from __future__ import annotations

import json
import time
from typing import Any

import httpx
import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException

from database import db_conn
from models import (
    SkillCreatePayload,
    SkillPatchPayload,
    SkillTestPayload,
    SkillAnalyzePayload,
    SkillBatchAnalyzePayload,
)

_SKILL_SCHEMA_HINT = "请在数据库执行 db/migrations/0033_ticket_analysis_skill.sql"

router = APIRouter(prefix="/api/stats", tags=["skill"])


def _skill_table_ready(conn: psycopg.Connection) -> bool:
    r = conn.execute("SELECT to_regclass('public.ticket_analysis_skill') AS name").fetchone()
    return bool(r and r.get("name"))


def _require_skill_admin(conn: psycopg.Connection, operator_id: str) -> None:
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row or str(row.get("role_code") or "") != "管理员":
        raise HTTPException(status_code=403, detail="仅管理员可操作 Skill")


def _mask_api_key(val: str) -> str:
    s = str(val or "").strip()
    if len(s) <= 8:
        return "****" if s else ""
    return s[:4] + "****" + s[-4:]


async def _call_llm_for_skill(
    api_base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
) -> tuple[str, int, int]:
    url = f"{str(api_base_url).rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"LLM API 错误 ({resp.status_code}): {resp.text[:500]}",
            )
        data = resp.json()
        content = str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
        usage = data.get("usage", {})
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        return content, prompt_tokens, completion_tokens


def _build_ticket_input(ticket_no: str, conn: psycopg.Connection, input_fields: dict[str, Any] | None) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM ticket WHERE ticket_no = %s",
        (ticket_no,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"工单 {ticket_no} 不存在")
    ticket_data = dict(row)
    fields_list = (input_fields or {}).get("fields", ["ticket_no"])
    result: dict[str, Any] = {}
    for f in fields_list:
        if f in ticket_data:
            result[f] = ticket_data[f]
    if (input_fields or {}).get("include_flow_log"):
        logs = conn.execute(
            "SELECT * FROM ticket_flow_log WHERE ticket_no = %s ORDER BY created_at ASC",
            (ticket_no,),
        ).fetchall()
        result["flow_history"] = [dict(log) for log in logs]
    return result


def _interpolate_prompt(template: str, ticket_data: dict[str, Any]) -> str:
    result = template
    for key, val in ticket_data.items():
        placeholder = "{" + key + "}"
        if placeholder in result:
            str_val = json.dumps(val, ensure_ascii=False) if isinstance(val, (dict, list)) else str(val or "")
            result = result.replace(placeholder, str_val)
    return result


@router.get("/skills")
def list_skills(
    q: str = "",
    operator_id: str = "demo_001",
) -> dict[str, Any]:
    _ = operator_id
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        conditions: list[str] = []
        params: list = []
        if q:
            conditions.append("name ILIKE %s")
            params.append(f"%{q}%")
        where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""
        rows = conn.execute(
            f"""
            SELECT id, name, description, api_base_url, api_key, model,
                   max_tokens, temperature, system_prompt, analysis_prompt_template,
                   input_fields, output_format, is_enabled, is_builtin, sort_order,
                   creator_id, creator_name, created_at, updated_by, updated_at
            FROM ticket_analysis_skill
            {where_clause}
            ORDER BY sort_order, id
            """,
            params,
        ).fetchall()
    items = []
    for r in rows:
        item = dict(r)
        if item.get("api_key"):
            item["api_key"] = _mask_api_key(str(item["api_key"]))
        items.append(item)
    return {"items": items}


@router.post("/skills")
def create_skill(payload: SkillCreatePayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    op_name = payload.operator_name.strip() or ""
    name = str(payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Skill 名称不能为空")
    api_base_url = str(payload.api_base_url or "").strip()
    if not api_base_url:
        raise HTTPException(status_code=400, detail="API 地址不能为空")
    api_key = str(payload.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 不能为空")
    template = str(payload.analysis_prompt_template or "").strip()
    if not template:
        raise HTTPException(status_code=400, detail="分析提示词模板不能为空")
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        _require_skill_admin(conn, op)
        sort_row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ticket_analysis_skill"
        ).fetchone()
        sort_order = int(sort_row["n"]) if sort_row else 0
        row = conn.execute(
            """
            INSERT INTO ticket_analysis_skill (
                name, description, api_base_url, api_key, model,
                max_tokens, temperature, system_prompt, analysis_prompt_template,
                input_fields, output_format, is_enabled, is_builtin, sort_order,
                creator_id, creator_name, updated_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s, %s, %s, %s)
            RETURNING id, name, description, api_base_url, api_key, model,
                      max_tokens, temperature, system_prompt, analysis_prompt_template,
                      input_fields, output_format, is_enabled, is_builtin, sort_order,
                      creator_id, creator_name, created_at, updated_by, updated_at
            """,
            (
                name[:128],
                str(payload.description or ""),
                api_base_url,
                api_key,
                str(payload.model or "gpt-4o")[:128],
                payload.max_tokens,
                payload.temperature,
                str(payload.system_prompt or ""),
                template,
                json.dumps(payload.input_fields) if payload.input_fields else None,
                json.dumps(payload.output_format) if payload.output_format else None,
                payload.is_enabled,
                sort_order,
                op,
                op_name,
                op,
            ),
        ).fetchone()
        conn.commit()
    item = dict(row)
    if item.get("api_key"):
        item["api_key"] = _mask_api_key(str(item["api_key"]))
    return {"item": item}


@router.get("/skills/{skill_id:int}")
def get_skill(skill_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        row = conn.execute(
            """
            SELECT id, name, description, api_base_url, api_key, model,
                   max_tokens, temperature, system_prompt, analysis_prompt_template,
                   input_fields, output_format, is_enabled, is_builtin, sort_order,
                   creator_id, creator_name, created_at, updated_by, updated_at
            FROM ticket_analysis_skill
            WHERE id = %s
            """,
            (skill_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Skill 不存在")
    item = dict(row)
    if item.get("api_key"):
        item["api_key"] = _mask_api_key(str(item["api_key"]))
    return {"item": item}


@router.patch("/skills/{skill_id:int}")
def patch_skill(skill_id: int, payload: SkillPatchPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    fields: list[str] = []
    vals: list = []
    if payload.name is not None:
        name = str(payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Skill 名称不能为空")
        fields.append("name = %s")
        vals.append(name[:128])
    if payload.description is not None:
        fields.append("description = %s")
        vals.append(str(payload.description or ""))
    if payload.api_base_url is not None:
        api_base_url = str(payload.api_base_url or "").strip()
        if not api_base_url:
            raise HTTPException(status_code=400, detail="API 地址不能为空")
        fields.append("api_base_url = %s")
        vals.append(api_base_url)
    if payload.api_key is not None:
        ak = str(payload.api_key or "").strip()
        if "****" in ak:
            pass
        else:
            if not ak:
                raise HTTPException(status_code=400, detail="API Key 不能为空")
            fields.append("api_key = %s")
            vals.append(ak)
    if payload.model is not None:
        fields.append("model = %s")
        vals.append(str(payload.model or "gpt-4o")[:128])
    if payload.max_tokens is not None:
        fields.append("max_tokens = %s")
        vals.append(payload.max_tokens)
    if payload.temperature is not None:
        fields.append("temperature = %s")
        vals.append(payload.temperature)
    if payload.system_prompt is not None:
        fields.append("system_prompt = %s")
        vals.append(str(payload.system_prompt or ""))
    if payload.analysis_prompt_template is not None:
        template = str(payload.analysis_prompt_template or "").strip()
        if not template:
            raise HTTPException(status_code=400, detail="分析提示词模板不能为空")
        fields.append("analysis_prompt_template = %s")
        vals.append(template)
    if payload.input_fields is not None:
        fields.append("input_fields = %s")
        vals.append(json.dumps(payload.input_fields))
    if payload.output_format is not None:
        fields.append("output_format = %s")
        vals.append(json.dumps(payload.output_format))
    if payload.is_enabled is not None:
        fields.append("is_enabled = %s")
        vals.append(payload.is_enabled)
    if payload.sort_order is not None:
        fields.append("sort_order = %s")
        vals.append(payload.sort_order)
    if not fields:
        raise HTTPException(status_code=400, detail="无更新字段")
    fields.append("updated_by = %s")
    vals.append(op)
    fields.append("updated_at = NOW()")
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        _require_skill_admin(conn, op)
        existing = conn.execute(
            "SELECT id FROM ticket_analysis_skill WHERE id = %s",
            (skill_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        conn.execute(
            f"UPDATE ticket_analysis_skill SET {', '.join(fields)} WHERE id = %s",
            vals + [skill_id],
        )
        row = conn.execute(
            """
            SELECT id, name, description, api_base_url, api_key, model,
                   max_tokens, temperature, system_prompt, analysis_prompt_template,
                   input_fields, output_format, is_enabled, is_builtin, sort_order,
                   creator_id, creator_name, created_at, updated_by, updated_at
            FROM ticket_analysis_skill WHERE id = %s
            """,
            (skill_id,),
        ).fetchone()
        conn.commit()
    item = dict(row)
    if item.get("api_key"):
        item["api_key"] = _mask_api_key(str(item["api_key"]))
    return {"item": item}


@router.delete("/skills/{skill_id:int}")
def delete_skill(skill_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        _require_skill_admin(conn, op)
        existing = conn.execute(
            "SELECT id FROM ticket_analysis_skill WHERE id = %s",
            (skill_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        conn.execute("DELETE FROM ticket_analysis_skill WHERE id = %s", (skill_id,))
        conn.commit()
    return {"ok": True}


@router.post("/skills/{skill_id:int}/test")
async def test_skill(skill_id: int, payload: SkillTestPayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    _ = op
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        row = conn.execute(
            "SELECT api_base_url, api_key, model, max_tokens, temperature, system_prompt FROM ticket_analysis_skill WHERE id = %s",
            (skill_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Skill 不存在")
    api_base_url = str(row.get("api_base_url") or "")
    api_key = str(row.get("api_key") or "")
    model = str(row.get("model") or "gpt-4o")
    max_tokens = int(row.get("max_tokens") or 16)
    temperature = float(row.get("temperature") or 0.0)
    system_prompt = str(row.get("system_prompt") or "")
    if not api_key:
        return {"ok": False, "detail": "API Key 未配置"}
    try:
        content, _, _ = await _call_llm_for_skill(
            api_base_url, api_key, model,
            system_prompt or "你是一个测试助手。",
            "请回复 OK",
            max_tokens,
            temperature,
        )
        return {"ok": True, "detail": f"连通成功，模型回复：{content[:100]}"}
    except Exception as exc:
        return {"ok": False, "detail": f"连通失败：{str(exc)[:300]}"}


@router.post("/skills/{skill_id:int}/analyze")
async def analyze_ticket(skill_id: int, payload: SkillAnalyzePayload) -> dict[str, Any]:
    op = payload.operator_id.strip() or "demo_001"
    op_name = payload.operator_name.strip() or ""
    ticket_no = str(payload.ticket_no or "").strip()
    if not ticket_no:
        raise HTTPException(status_code=400, detail="工单编号不能为空")
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        skill_row = conn.execute(
            """
            SELECT id, name, api_base_url, api_key, model, max_tokens, temperature,
                   system_prompt, analysis_prompt_template, input_fields, output_format, is_enabled
            FROM ticket_analysis_skill WHERE id = %s
            """,
            (skill_id,),
        ).fetchone()
        if not skill_row:
            raise HTTPException(status_code=404, detail="Skill 不存在")
        if not bool(skill_row.get("is_enabled")):
            raise HTTPException(status_code=400, detail="Skill 已禁用")
        ticket_input = _build_ticket_input(ticket_no, conn, skill_row.get("input_fields"))
    api_base_url = str(skill_row.get("api_base_url") or "")
    api_key = str(skill_row.get("api_key") or "")
    model = str(skill_row.get("model") or "gpt-4o")
    max_tokens = int(skill_row.get("max_tokens") or 4096)
    temperature = float(skill_row.get("temperature") or 0.3)
    system_prompt = str(skill_row.get("system_prompt") or "")
    template = str(skill_row.get("analysis_prompt_template") or "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Skill 未配置 API Key")
    user_prompt = _interpolate_prompt(template, ticket_input)
    if payload.custom_input:
        for k, v in payload.custom_input.items():
            placeholder = "{" + k + "}"
            if placeholder in user_prompt:
                user_prompt = user_prompt.replace(placeholder, str(v))
    start_time = time.time()
    try:
        content, prompt_tokens, completion_tokens = await _call_llm_for_skill(
            api_base_url, api_key, model,
            system_prompt, user_prompt,
            max_tokens, temperature,
        )
        duration_ms = int((time.time() - start_time) * 1000)
        with db_conn() as conn:
            conn.execute(
                """
                INSERT INTO ticket_analysis_log (
                    skill_id, ticket_no, input_data, output_result,
                    prompt_tokens, completion_tokens, analysis_duration_ms,
                    status, operator_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    skill_id,
                    ticket_no,
                    json.dumps(ticket_input, ensure_ascii=False),
                    content,
                    prompt_tokens,
                    completion_tokens,
                    duration_ms,
                    "success",
                    op,
                ),
            )
            conn.commit()
        return {
            "result": content,
            "ticket_no": ticket_no,
            "skill_id": skill_id,
            "skill_name": skill_row.get("name"),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "duration_ms": duration_ms,
        }
    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(exc)[:500]
        with db_conn() as conn:
            conn.execute(
                """
                INSERT INTO ticket_analysis_log (
                    skill_id, ticket_no, input_data,
                    prompt_tokens, completion_tokens, analysis_duration_ms,
                    status, error_message, operator_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    skill_id,
                    ticket_no,
                    json.dumps(ticket_input, ensure_ascii=False),
                    0,
                    0,
                    duration_ms,
                    "failed",
                    error_msg,
                    op,
                ),
            )
            conn.commit()
        raise HTTPException(status_code=502, detail=f"分析失败：{error_msg}")


@router.get("/skills/{skill_id:int}/logs")
def get_skill_logs(
    skill_id: int,
    ticket_no: str = "",
    operator_id: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        conditions: list[str] = ["skill_id = %s"]
        params: list = [skill_id]
        if ticket_no:
            conditions.append("ticket_no = %s")
            params.append(ticket_no)
        if operator_id:
            conditions.append("operator_id = %s")
            params.append(operator_id)
        where_clause = "WHERE " + " AND ".join(conditions)
        total_row = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM ticket_analysis_log {where_clause}",
            params,
        ).fetchone()
        total = int(total_row["cnt"]) if total_row else 0
        offset = max(0, (page - 1) * page_size)
        rows = conn.execute(
            f"""
            SELECT id, skill_id, ticket_no, input_data, output_result, output_structured,
                   prompt_tokens, completion_tokens, analysis_duration_ms, status,
                   error_message, operator_id, created_at
            FROM ticket_analysis_log
            {where_clause}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            params + [page_size, offset],
        ).fetchall()
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/tickets/{ticket_no}/analysis")
def get_ticket_analysis(ticket_no: str, operator_id: str = "demo_001") -> dict[str, Any]:
    _ = operator_id
    with db_conn() as conn:
        if not _skill_table_ready(conn):
            raise HTTPException(status_code=503, detail=_SKILL_SCHEMA_HINT)
        rows = conn.execute(
            """
            SELECT l.id, l.skill_id, s.name AS skill_name,
                   l.input_data, l.output_result, l.output_structured,
                   l.prompt_tokens, l.completion_tokens, l.analysis_duration_ms,
                   l.status, l.error_message, l.operator_id, l.created_at
            FROM ticket_analysis_log l
            JOIN ticket_analysis_skill s ON s.id = l.skill_id
            WHERE l.ticket_no = %s
            ORDER BY l.created_at DESC
            """,
            (ticket_no,),
        ).fetchall()
    return {"items": rows}