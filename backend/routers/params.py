from __future__ import annotations

import psycopg
from psycopg.errors import UndefinedTable

from fastapi import APIRouter, HTTPException

from config import (
    _DUTY_FIELD_SCHEMA_HINT,
    _VERSION_SCHEMA_HINT,
    _GROUP_TEMPLATE_SCHEMA_HINT,
    _GROUP_TEMPLATE_KIND_ORDER,
    _ISSUE_ROOT_CAUSE_SCHEMA_HINT,
    _DUTY_FIELD_MAX_DEPTH,
    _DUTY_FIELD_MAX_NODES,
)
from issue_root_cause_params import (
    load_issue_type_labels,
    load_issue_root_cause_map,
    normalize_issue_root_cause_payload,
    sync_issue_type_option_items,
    build_issue_root_cause_response,
)

_AI_SCHEMA_HINT = "请在数据库执行 db/migrations/0031_ai_assistant.sql"

from database import db_conn
from models import (
    DutyFieldTreePutPayload,
    DutyFieldNodeInput,
    BaselineVersionCreatePayload,
    BaselineVersionPatchPayload,
    HotfixVersionCreatePayload,
    HotfixVersionPatchPayload,
    GroupTemplatePutPayload,
    IssueRootCausePutPayload,
    LlmConfigPutPayload,
    LlmTestPayload,
)

router = APIRouter(prefix="/api/params", tags=["params"])


def _get_user_role(conn, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), False


def _require_duty_calendar_admin(conn: psycopg.Connection, operator_id: str) -> None:
    role, _ = _get_user_role(conn, operator_id.strip() or "")
    if role != "管理员":
        raise HTTPException(status_code=403, detail="仅管理员可编辑值班日历")


def _validate_duty_field_tree(nodes: list[DutyFieldNodeInput], depth: int = 0) -> int:
    if depth > _DUTY_FIELD_MAX_DEPTH:
        raise HTTPException(status_code=400, detail=f"树深度超过 {_DUTY_FIELD_MAX_DEPTH} 层")
    total = 0
    for node in nodes:
        total += 1
        if total > _DUTY_FIELD_MAX_NODES:
            raise HTTPException(status_code=400, detail=f"节点总数超过 {_DUTY_FIELD_MAX_NODES}")
        if not str(node.label or "").strip():
            raise HTTPException(status_code=400, detail="节点 label 不能为空")
        if node.children:
            total += _validate_duty_field_tree(node.children, depth + 1)
    return total


def _duty_field_insert_tree(
    conn: psycopg.Connection,
    parent_id: int | None,
    nodes: list[DutyFieldNodeInput],
    op: str,
    depth: int,
) -> None:
    for i, node in enumerate(nodes):
        row = conn.execute(
            """
            INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING id
            """,
            (parent_id, str(node.label or "").strip(), i, op),
        ).fetchone()
        new_id = int(row["id"])
        if node.children:
            _duty_field_insert_tree(conn, new_id, node.children, op, depth + 1)


def _duty_field_rows_to_tree(rows: list) -> list[dict]:
    by_parent: dict[int | None, list[dict]] = {}
    for r in rows:
        pid = r.get("parent_id")
        by_parent.setdefault(pid, []).append({
            "id": r["id"],
            "label": str(r["label"] or ""),
            "sort_order": r.get("sort_order") or 0,
            "children": [],
        })
    def build(pid: int | None) -> list[dict]:
        nodes = by_parent.get(pid, [])
        for n in nodes:
            n["children"] = build(n["id"])
        return nodes
    return build(None)


def _merge_group_template_list(rows: list) -> list[dict]:
    by_kind: dict[str, dict] = {}
    for r in rows:
        k = str(r.get("problem_kind") or "").strip()
        if k not in by_kind:
            by_kind[k] = {
                "problem_kind": k,
                "group_name_tpl": "",
                "group_notice_tpl": "",
                "group_members_tpl": "",
                "first_report_tpl": "",
                "updated_by": "",
                "updated_at": "",
            }
        by_kind[k]["group_name_tpl"] = str(r.get("group_name_tpl") or "")
        by_kind[k]["group_notice_tpl"] = str(r.get("group_notice_tpl") or "")
        by_kind[k]["group_members_tpl"] = str(r.get("group_members_tpl") or "")
        by_kind[k]["first_report_tpl"] = str(r.get("first_report_tpl") or "")
        by_kind[k]["updated_by"] = str(r.get("updated_by") or "")
        by_kind[k]["updated_at"] = str(r.get("updated_at") or "")
    return [by_kind.get(k, {"problem_kind": k}) for k in _GROUP_TEMPLATE_KIND_ORDER]


def _mask_api_key(val: str) -> str:
    if not val or len(val) < 8:
        return "****"
    return val[:4] + "****" + val[-4:]


def _load_system_llm_config(conn: psycopg.Connection) -> dict[str, str]:
    rows = conn.execute("SELECT key, value FROM param_llm_config").fetchall()
    return {str(r["key"]): str(r["value"] or "") for r in rows}


def _resolve_llm_config(conn: psycopg.Connection, account: str) -> dict:
    system_cfg = _load_system_llm_config(conn)
    try:
        user_row = conn.execute("SELECT * FROM ai_user_llm_config WHERE account = %s", (account,)).fetchone()
    except UndefinedTable:
        user_row = None
    result: dict = {
        "llm_api_base_url": system_cfg.get("llm_api_base_url", ""),
        "llm_api_key": system_cfg.get("llm_api_key", ""),
        "llm_model": system_cfg.get("llm_model", "gpt-4o"),
        "llm_max_tokens": int(system_cfg.get("llm_max_tokens") or 4096),
        "llm_temperature": float(system_cfg.get("llm_temperature") or 0.7),
        "llm_system_prompt": system_cfg.get("llm_system_prompt", ""),
        "llm_query_timeout": int(system_cfg.get("llm_query_timeout") or 60),
        "llm_max_react_rounds": int(system_cfg.get("llm_max_react_rounds") or 5),
        "llm_max_result_rows": int(system_cfg.get("llm_max_result_rows") or 100),
        "llm_context_max_token": int(system_cfg.get("llm_context_max_token") or 8000),
    }
    if user_row:
        for f in ("api_base_url", "api_key", "model", "max_tokens", "temperature", "system_prompt", "query_timeout", "max_react_rounds", "max_result_rows", "context_max_token"):
            v = user_row.get(f)
            if v is not None:
                key = f"llm_{f}" if not f.startswith("llm_") else f
                if f in ("max_tokens", "query_timeout", "max_react_rounds", "max_result_rows", "context_max_token"):
                    result[key] = int(v)
                elif f == "temperature":
                    result[key] = float(v)
                else:
                    result[key] = str(v)
    return result


async def _call_llm(api_base_url: str, api_key: str, model: str, messages: list, max_tokens: int, temperature: float) -> str:
    import httpx
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{api_base_url}/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return str(data.get("choices", [{}])[0].get("message", {}).get("content", "") or "")


@router.get("/duty-field/tree")
def get_duty_field_tree(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, parent_id, label, sort_order
                FROM duty_field_node
                ORDER BY parent_id NULLS FIRST, sort_order, id
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"nodes": _duty_field_rows_to_tree(rows)}


@router.put("/duty-field/tree")
def put_duty_field_tree(payload: DutyFieldTreePutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    nodes = list(payload.nodes or [])
    if nodes:
        _validate_duty_field_tree(nodes)
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute("TRUNCATE TABLE duty_field_node RESTART IDENTITY CASCADE")
            if nodes:
                _duty_field_insert_tree(conn, None, nodes, op, 0)
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"ok": True}


@router.get("/baseline-versions")
def list_baseline_versions(q: str = "", operator_id: str = "demo_001") -> dict:
    _ = operator_id
    qv = (q or "").strip()
    try:
        with db_conn() as conn:
            if qv:
                like = f"%{qv}%"
                rows = conn.execute(
                    """
                    SELECT id, version_label, commit_hash, sort_order, updated_at
                    FROM param_baseline_version
                    WHERE version_label ILIKE %s OR commit_hash ILIKE %s
                    ORDER BY sort_order, id
                    """,
                    (like, like),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, version_label, commit_hash, sort_order, updated_at
                    FROM param_baseline_version
                    ORDER BY sort_order, id
                    """
                ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    return {"items": rows}


@router.post("/baseline-versions")
def create_baseline_version(payload: BaselineVersionCreatePayload) -> dict:
    lab = str(payload.version_label or "").strip()
    if not lab:
        raise HTTPException(status_code=400, detail="版本不能为空")
    ch = str(payload.commit_hash or "").strip()[:128]
    op = payload.operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            sort_order = payload.sort_order
            if sort_order is None:
                row = conn.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM param_baseline_version"
                ).fetchone()
                sort_order = int(row["n"]) if row else 0
            row = conn.execute(
                """
                INSERT INTO param_baseline_version (version_label, commit_hash, sort_order, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                RETURNING id, version_label, commit_hash, sort_order, updated_at
                """,
                (lab[:256], ch, int(sort_order), op),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    return {"item": row}


@router.patch("/baseline-versions/{row_id:int}")
def patch_baseline_version(row_id: int, payload: BaselineVersionPatchPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    fields: list[str] = []
    vals: list = []
    if payload.version_label is not None:
        lab = str(payload.version_label or "").strip()
        if not lab:
            raise HTTPException(status_code=400, detail="版本不能为空")
        fields.append("version_label = %s")
        vals.append(lab[:256])
    if payload.commit_hash is not None:
        fields.append("commit_hash = %s")
        vals.append(str(payload.commit_hash or "").strip()[:128])
    if payload.sort_order is not None:
        fields.append("sort_order = %s")
        vals.append(int(payload.sort_order))
    if not fields:
        raise HTTPException(status_code=400, detail="无更新字段")
    fields.append("updated_by = %s")
    vals.append(op)
    fields.append("updated_at = NOW()")
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            conn.execute(
                f"UPDATE param_baseline_version SET {', '.join(fields)} WHERE id = %s",
                vals + [row_id],
            )
            row = conn.execute(
                """
                SELECT id, version_label, commit_hash, sort_order, updated_at
                FROM param_baseline_version WHERE id = %s
                """,
                (row_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"item": row}


@router.delete("/baseline-versions/{row_id:int}")
def delete_baseline_version(row_id: int, operator_id: str = "admin") -> dict:
    op = operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            n = conn.execute(
                "SELECT COUNT(*) AS c FROM param_hotfix_version WHERE baseline_id = %s",
                (row_id,),
            ).fetchone()
            if n and int(n["c"] or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="该基线仍被热补丁引用，请先删除或调整相关热补丁记录",
                )
            cur = conn.execute("DELETE FROM param_baseline_version WHERE id = %s RETURNING id", (row_id,))
            deleted = cur.fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"ok": True}


@router.get("/hotfix-versions")
def list_hotfix_versions(q: str = "", operator_id: str = "demo_001") -> dict:
    _ = operator_id
    qv = (q or "").strip()
    try:
        with db_conn() as conn:
            if qv:
                like = f"%{qv}%"
                rows = conn.execute(
                    """
                    SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                           b.version_label AS baseline_version_label,
                           b.commit_hash AS baseline_commit_hash
                    FROM param_hotfix_version h
                    JOIN param_baseline_version b ON b.id = h.baseline_id
                    WHERE h.hotfix_label ILIKE %s
                       OR b.version_label ILIKE %s
                       OR b.commit_hash ILIKE %s
                    ORDER BY h.sort_order, h.id
                    """,
                    (like, like, like),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                           b.version_label AS baseline_version_label,
                           b.commit_hash AS baseline_commit_hash
                    FROM param_hotfix_version h
                    JOIN param_baseline_version b ON b.id = h.baseline_id
                    ORDER BY h.sort_order, h.id
                    """
                ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    return {"items": rows}


@router.post("/hotfix-versions")
def create_hotfix_version(payload: HotfixVersionCreatePayload) -> dict:
    hf = str(payload.hotfix_label or "").strip()
    if not hf:
        raise HTTPException(status_code=400, detail="热补丁版本不能为空")
    bid = int(payload.baseline_id)
    op = payload.operator_id.strip() or "admin"
    full = None
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            exists = conn.execute(
                "SELECT 1 FROM param_baseline_version WHERE id = %s",
                (bid,),
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=400, detail="基线版本不存在")
            sort_order = payload.sort_order
            if sort_order is None:
                row = conn.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM param_hotfix_version"
                ).fetchone()
                sort_order = int(row["n"]) if row else 0
            ins = conn.execute(
                """
                INSERT INTO param_hotfix_version (baseline_id, hotfix_label, sort_order, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                RETURNING id
                """,
                (bid, hf[:256], int(sort_order), op),
            ).fetchone()
            if not ins:
                raise HTTPException(status_code=500, detail="写入热补丁失败")
            new_id = int(ins["id"])
            full = conn.execute(
                """
                SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                       b.version_label AS baseline_version_label,
                       b.commit_hash AS baseline_commit_hash
                FROM param_hotfix_version h
                JOIN param_baseline_version b ON b.id = h.baseline_id
                WHERE h.id = %s
                """,
                (new_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not full:
        raise HTTPException(status_code=500, detail="读取新建热补丁失败")
    return {"item": full}


@router.patch("/hotfix-versions/{row_id:int}")
def patch_hotfix_version(row_id: int, payload: HotfixVersionPatchPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    fields: list[str] = []
    vals: list = []
    if payload.baseline_id is not None:
        fields.append("baseline_id = %s")
        vals.append(int(payload.baseline_id))
    if payload.hotfix_label is not None:
        hf = str(payload.hotfix_label or "").strip()
        if not hf:
            raise HTTPException(status_code=400, detail="热补丁版本不能为空")
        fields.append("hotfix_label = %s")
        vals.append(hf[:256])
    if payload.sort_order is not None:
        fields.append("sort_order = %s")
        vals.append(int(payload.sort_order))
    if not fields:
        raise HTTPException(status_code=400, detail="无更新字段")
    fields.append("updated_by = %s")
    vals.append(op)
    fields.append("updated_at = NOW()")
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            if payload.baseline_id is not None:
                exists = conn.execute(
                    "SELECT 1 FROM param_baseline_version WHERE id = %s",
                    (int(payload.baseline_id),),
                ).fetchone()
                if not exists:
                    raise HTTPException(status_code=400, detail="基线版本不存在")
            conn.execute(
                f"UPDATE param_hotfix_version SET {', '.join(fields)} WHERE id = %s",
                vals + [row_id],
            )
            full = conn.execute(
                """
                SELECT h.id, h.baseline_id, h.hotfix_label, h.sort_order, h.updated_at,
                       b.version_label AS baseline_version_label,
                       b.commit_hash AS baseline_commit_hash
                FROM param_hotfix_version h
                JOIN param_baseline_version b ON b.id = h.baseline_id
                WHERE h.id = %s
                """,
                (row_id,),
            ).fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not full:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"item": full}


@router.delete("/hotfix-versions/{row_id:int}")
def delete_hotfix_version(row_id: int, operator_id: str = "admin") -> dict:
    op = operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            cur = conn.execute("DELETE FROM param_hotfix_version WHERE id = %s RETURNING id", (row_id,))
            deleted = cur.fetchone()
            conn.commit()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_VERSION_SCHEMA_HINT) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"ok": True}


@router.get("/group-templates")
def list_group_templates(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl,
                       first_report_tpl, updated_by, updated_at
                FROM param_group_template
                """
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_GROUP_TEMPLATE_SCHEMA_HINT) from exc
    return {"items": _merge_group_template_list(rows)}


@router.put("/group-templates")
def put_group_templates(payload: GroupTemplatePutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    items = list(payload.items or [])
    kinds_in = {str(x.problem_kind or "").strip() for x in items}
    if kinds_in != set(_GROUP_TEMPLATE_KIND_ORDER):
        raise HTTPException(
            status_code=400,
            detail=f"须一次性提交四种问题类型：{', '.join(_GROUP_TEMPLATE_KIND_ORDER)}",
        )
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            for it in items:
                k = str(it.problem_kind or "").strip()
                if k not in _GROUP_TEMPLATE_KIND_ORDER:
                    raise HTTPException(status_code=400, detail=f"未知问题类型：{k}")
                conn.execute(
                    """
                    INSERT INTO param_group_template (
                      problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl,
                      first_report_tpl, updated_by, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (problem_kind) DO UPDATE SET
                      group_name_tpl = EXCLUDED.group_name_tpl,
                      group_notice_tpl = EXCLUDED.group_notice_tpl,
                      group_members_tpl = EXCLUDED.group_members_tpl,
                      first_report_tpl = EXCLUDED.first_report_tpl,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = NOW()
                    """,
                    (
                        k,
                        str(it.group_name_tpl or ""),
                        str(it.group_notice_tpl or ""),
                        str(it.group_members_tpl or ""),
                        str(it.first_report_tpl or ""),
                        op,
                    ),
                )
            conn.commit()
            rows = conn.execute(
                """
                SELECT problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl,
                       first_report_tpl, updated_by, updated_at
                FROM param_group_template
                """
            ).fetchall()
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_GROUP_TEMPLATE_SCHEMA_HINT) from exc
    return {"ok": True, "items": _merge_group_template_list(rows)}


@router.get("/issue-root-cause")
def list_issue_root_cause(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            issue_types = load_issue_type_labels(conn)
            mapping = load_issue_root_cause_map(conn)
            items = [{"issue_type": it, "categories": list(mapping.get(it, []))} for it in issue_types]
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_ISSUE_ROOT_CAUSE_SCHEMA_HINT) from exc
    return {"issue_types": issue_types, "items": items}


@router.put("/issue-root-cause")
def put_issue_root_cause(payload: IssueRootCausePutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    try:
        with db_conn() as conn:
            _require_duty_calendar_admin(conn, op)
            normalized = normalize_issue_root_cause_payload(payload.items or [])
            type_labels = [t for t, _ in normalized]
            sync_issue_type_option_items(conn, type_labels)
            conn.execute("DELETE FROM param_issue_root_cause_map")
            for issue_type, categories in normalized:
                for i, cat in enumerate(categories):
                    conn.execute(
                        """
                        INSERT INTO param_issue_root_cause_map (
                          issue_type, root_cause_category, sort_order, updated_by, updated_at
                        )
                        VALUES (%s, %s, %s, %s, NOW())
                        """,
                        (issue_type, cat, i, op),
                    )
            conn.commit()
            resp_body = build_issue_root_cause_response(conn, normalized)
    except HTTPException:
        raise
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=_ISSUE_ROOT_CAUSE_SCHEMA_HINT) from exc
    return {"ok": True, **resp_body}


@router.get("/llm-config")
def get_llm_config(operator_id: str = "demo_001") -> dict:
    op = operator_id.strip() or "demo_001"
    with db_conn() as conn:
        try:
            rows = conn.execute("SELECT key, value, value_type, description, updated_by, updated_at FROM param_llm_config ORDER BY key").fetchall()
        except UndefinedTable:
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
    items = []
    for r in rows:
        item = dict(r)
        if str(r["key"]) == "llm_api_key":
            item["value"] = _mask_api_key(str(r["value"]))
        items.append(item)
    return {"items": items}


@router.put("/llm-config")
def put_llm_config(payload: LlmConfigPutPayload) -> dict:
    op = payload.operator_id.strip() or "admin"
    items = payload.items or []
    with db_conn() as conn:
        role, _ = _get_user_role(conn, op)
        if role != "管理员":
            raise HTTPException(status_code=403, detail="仅管理员可配置系统大模型")
        for it in items:
            key = str(it.get("key") or "").strip()
            val = str(it.get("value") or "").strip()
            if not key:
                continue
            if key == "llm_enabled" and val not in ("true", "false"):
                raise HTTPException(status_code=400, detail="llm_enabled 仅允许 true/false")
            if key == "llm_api_key":
                if val and "****" in val:
                    continue
            conn.execute(
                """
                INSERT INTO param_llm_config (key, value, value_type, description, updated_by, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                """,
                (key, val, str(it.get("value_type") or "string"), str(it.get("description") or ""), op),
            )
        conn.commit()
        rows = conn.execute("SELECT key, value, value_type, description, updated_by, updated_at FROM param_llm_config ORDER BY key").fetchall()
    result_items = []
    for r in rows:
        item = dict(r)
        if str(r["key"]) == "llm_api_key":
            item["value"] = _mask_api_key(str(r["value"]))
        result_items.append(item)
    return {"ok": True, "items": result_items}


@router.post("/llm-config/test")
async def test_llm_config(payload: LlmTestPayload) -> dict:
    op = payload.operator_id.strip() or "demo_001"
    with db_conn() as conn:
        try:
            resolved = _resolve_llm_config(conn, op)
        except UndefinedTable:
            raise HTTPException(status_code=503, detail=_AI_SCHEMA_HINT)
    api_base_url = str(resolved.get("llm_api_base_url", ""))
    api_key = str(resolved.get("llm_api_key", ""))
    model = str(resolved.get("llm_model", "gpt-4o"))
    if not api_key:
        return {"ok": False, "detail": "API Key 未配置"}
    try:
        resp_text = await _call_llm(api_base_url, api_key, model, [{"role": "user", "content": "Hi, reply with OK"}], 16, 0.0)
        return {"ok": True, "detail": f"连通成功，模型回复：{resp_text[:100]}"}
    except Exception as exc:
        return {"ok": False, "detail": f"连通失败：{str(exc)[:300]}"}