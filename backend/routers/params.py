from __future__ import annotations

import psycopg
from psycopg.errors import UndefinedTable, UndefinedColumn

from fastapi import APIRouter, HTTPException, Request

from config import (
    _DUTY_FIELD_SCHEMA_HINT,
    _VERSION_SCHEMA_HINT,
    _GROUP_TEMPLATE_SCHEMA_HINT,
    _GROUP_TEMPLATE_KIND_ORDER,
    _ISSUE_ROOT_CAUSE_SCHEMA_HINT,
    _RESEARCH_DUTY_FIELD_SCHEMA_HINT,
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
from utils.person_display import (
    MULTI_PERSON_DELIMITER,
    parse_person_parts_lenient,
)
from models import (
    DutyFieldTreePutPayload,
    DutyFieldNodeInput,
    ResearchDutyFieldPutPayload,
    ResearchDutyFieldBindingPayload,
    BaselineVersionCreatePayload,
    BaselineVersionPatchPayload,
    HotfixVersionCreatePayload,
    HotfixVersionPatchPayload,
    GroupTemplatePutPayload,
    IssueRootCausePutPayload,
    LlmConfigPutPayload,
    LlmTestPayload,
)
from whitelist_policy import whitelist_field_levels, whitelist_permission_level
from utils.api_guard import require_whitelist, require_whitelist_any
from utils.operator_auth import resolve_operator_id

router = APIRouter(prefix="/api/params", tags=["params"])


def _get_user_role(conn, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), False


def _require_params_whitelist(
    conn: psycopg.Connection, operator_id: str, field_key: str, detail: str
) -> None:
    """与前端 whitelistAllows(field_key, 'readonly') 一致：策略为「展示」即可写。"""
    wl = whitelist_field_levels(conn, operator_id.strip() or "")
    if whitelist_permission_level(wl, field_key) == "hidden":
        raise HTTPException(status_code=403, detail=detail)


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
        # depth 1 = 二级模块，仅该层持久化责任人
        owner = str(node.owner or "").strip() if depth == 1 else ""
        row = conn.execute(
            """
            INSERT INTO duty_field_node (parent_id, label, owner, sort_order, updated_by, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            RETURNING id
            """,
            (parent_id, str(node.label or "").strip(), owner, i, op),
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
            "owner": str(r.get("owner") or ""),
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
                SELECT id, parent_id, label, owner, sort_order
                FROM duty_field_node
                ORDER BY parent_id NULLS FIRST, sort_order, id
                """
            ).fetchall()
    except (UndefinedTable, UndefinedColumn) as exc:
        raise HTTPException(status_code=503, detail=_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"nodes": _duty_field_rows_to_tree(rows)}


@router.put("/duty-field/tree")
def put_duty_field_tree(payload: DutyFieldTreePutPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
    nodes = list(payload.nodes or [])
    if nodes:
        _validate_duty_field_tree(nodes)
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_duty_field_edit", "无责任田模块编辑权限")
            conn.execute("TRUNCATE TABLE duty_field_node RESTART IDENTITY CASCADE")
            if nodes:
                _duty_field_insert_tree(conn, None, nodes, op, 0)
            conn.commit()
    except HTTPException:
        raise
    except (UndefinedTable, UndefinedColumn) as exc:
        raise HTTPException(status_code=503, detail=_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"ok": True}


def _load_research_duty_fields(conn: psycopg.Connection) -> list[dict]:
    """目录田（名称/责任人）+ 各自关联列表；田按 sort_order，关联按 binding.id。"""
    fields = conn.execute(
        "SELECT id, name, owner FROM research_duty_field ORDER BY sort_order, id"
    ).fetchall()
    bindings = conn.execute(
        "SELECT field_id, domain, module FROM research_duty_field_binding ORDER BY id"
    ).fetchall()
    scopes_by_field: dict[int, list[dict]] = {}
    for b in bindings:
        scopes_by_field.setdefault(int(b["field_id"]), []).append(
            {"domain": str(b["domain"] or ""), "module": str(b["module"] or "")}
        )
    return [
        {
            "id": int(f["id"]),
            "name": str(f["name"] or ""),
            "owner": str(f["owner"] or ""),
            "scopes": scopes_by_field.get(int(f["id"]), []),
        }
        for f in fields
    ]


@router.get("/research-duty-field")
def list_research_duty_fields(operator_id: str = "demo_001") -> dict:
    _ = operator_id
    try:
        with db_conn() as conn:
            items = _load_research_duty_fields(conn)
    except (UndefinedTable, UndefinedColumn) as exc:
        raise HTTPException(status_code=503, detail=_RESEARCH_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"items": items}


@router.put("/research-duty-field")
def put_research_duty_fields(payload: ResearchDutyFieldPutPayload) -> dict:
    """目录维护（带 id 的全量替换）：有 id=更新（须存在），无 id=新增，库里有而 payload 缺的 id=删除（级联删其关联）。

    只管名称/责任人；「领域/模块」关联在 /research-duty-field/binding 单槽位维护（树上节点配置）。
    责任人支持多人（「；」分隔，保存时对历史遗留分隔符宽容归一为「；」并去重保序），
    每个责任人须为系统用户（人兜底归桶按账号匹配，见 qi_research_field.match_owner_bucket）。
    """
    op = payload.operator_id.strip() or "admin"
    items = list(payload.items or [])
    seen_names: set[str] = set()
    seen_ids: set[int] = set()
    owner_norms: list[str] = []
    owner_parts: list[str] = []
    for it in items:
        name = str(it.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="在研责任田名称不能为空")
        # 目录内名称唯一：树节点弹窗按名称下拉选择，重名无法区分
        if name in seen_names:
            raise HTTPException(status_code=400, detail=f"在研责任田名称重复：{name}")
        seen_names.add(name)
        if it.id is not None:
            if it.id in seen_ids:
                raise HTTPException(status_code=400, detail=f"在研责任田条目 id 重复：{it.id}")
            seen_ids.add(int(it.id))
        # 多人责任人规范化：宽容拆历史分隔符（；;，,、）→ 逐段 canonical → 去重保序 → 统一「；」拼接
        parts = parse_person_parts_lenient(str(it.owner or ""))
        for p in parts:
            if " " not in p:
                raise HTTPException(status_code=400, detail=f"在研责任田责任人格式须为「姓名 账号」：{p}")
        owner_norm = MULTI_PERSON_DELIMITER.join(parts)
        owner_norms.append(owner_norm)
        owner_parts.extend(parts)
        # 表列均为 VARCHAR(256)（责任树节点 label 却允许 512）：超长必须 400 而不是落库时 500
        # 长度按规范化后的值校验（历史遗留分隔符可能更长）
        for value, label in ((name, "名称"), (owner_norm, "责任人")):
            if len(value) > 256:
                raise HTTPException(status_code=400, detail=f"在研责任田{label}长度不能超过 256 字符")
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_research_duty_field", "无在研责任田编辑权限")
            existing_ids = {int(r["id"]) for r in conn.execute("SELECT id FROM research_duty_field").fetchall()}
            missing = seen_ids - existing_ids
            if missing:
                raise HTTPException(status_code=400, detail=f"在研责任田条目不存在：{sorted(missing)[0]}")
            # 责任人存在性（须为系统用户）：段内任一词元是系统账号即通过。不能只看「末段取账号」
            # ——canonical 对 ASCII 姓名+账号会换序（对合），末段可能是姓名而非账号而误拒真实用户
            token_to_part = {t: p for p in owner_parts for t in p.split()}
            if token_to_part:
                found = {
                    str(r["account"]).strip()
                    for r in conn.execute(
                        "SELECT account FROM user_account WHERE account = ANY(%s)",
                        (list(token_to_part),),
                    ).fetchall()
                }
                for p in owner_parts:
                    if not (set(p.split()) & found):
                        raise HTTPException(
                            status_code=400,
                            detail=f"在研责任田责任人不存在：{p}（须为系统用户，多人用「；」分隔）",
                        )
            for gone_id in existing_ids - seen_ids:
                conn.execute("DELETE FROM research_duty_field WHERE id=%s", (gone_id,))
            for i, it in enumerate(items):
                name = str(it.name or "").strip()
                owner = owner_norms[i]
                if it.id is not None:
                    conn.execute(
                        """UPDATE research_duty_field
                           SET name=%s, owner=%s, sort_order=%s, updated_by=%s, updated_at=NOW()
                           WHERE id=%s""",
                        (name, owner, i, op, int(it.id)),
                    )
                else:
                    conn.execute(
                        """INSERT INTO research_duty_field (name, owner, sort_order, updated_by, updated_at)
                           VALUES (%s, %s, %s, %s, NOW())""",
                        (name, owner, i, op),
                    )
            conn.commit()
            resp_items = _load_research_duty_fields(conn)
    except HTTPException:
        raise
    except (UndefinedTable, UndefinedColumn) as exc:
        raise HTTPException(status_code=503, detail=_RESEARCH_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"ok": True, "items": resp_items}


@router.put("/research-duty-field/binding")
def put_research_duty_field_binding(payload: ResearchDutyFieldBindingPayload) -> dict:
    """单槽位（领域/模块，模块空=整领域）关联 upsert：把该槽位绑到目录中的某个田。

    field_id=None 表示解除该槽位关联（田保留在目录）。不同槽位可绑同一个田（统计按田合并）。
    级联（全量写入）：cascade_slots 为前端按责任田树枚举的全部下级槽位，绑定/换绑时同事务
    一并 upsert 为同一田（下级原有绑定被覆盖）；解除仅动自身槽位，不级联。
    """
    op = payload.operator_id.strip() or "admin"
    domain = payload.domain.strip()
    module = payload.module.strip()
    if not domain:
        raise HTTPException(status_code=400, detail="在研责任田关联需指定领域")
    for value, label in ((domain, "领域"), (module, "模块")):
        if len(value) > 256:
            raise HTTPException(status_code=400, detail=f"在研责任田关联{label}长度不能超过 256 字符")
    # 级联槽位校验：领域须与主槽位一致、模块非空（下级节点必有模块路径）；与主槽位重复/列表内重复的去重
    cascade: list[tuple[str, str]] = []
    if payload.field_id is not None:
        seen: set[tuple[str, str]] = set()
        for slot in payload.cascade_slots or []:
            slot_domain = slot.domain.strip()
            slot_module = slot.module.strip()
            if not slot_domain or slot_domain != domain:
                raise HTTPException(status_code=400, detail="级联槽位领域需与主槽位一致")
            if not slot_module:
                raise HTTPException(status_code=400, detail="级联槽位模块不能为空")
            if len(slot_module) > 256:
                raise HTTPException(status_code=400, detail="级联槽位模块长度不能超过 256 字符")
            key = (slot_domain, slot_module)
            if key == (domain, module) or key in seen:
                continue
            seen.add(key)
            cascade.append(key)
        if len(cascade) > 1000:
            raise HTTPException(status_code=400, detail="级联槽位数量不能超过 1000")

    def _upsert_slot(conn, slot_domain: str, slot_module: str) -> None:
        """单槽位 upsert：field_id=None 删行，否则按 BTRIM 唯一键 UPDATE 或 INSERT。
        不用 ON CONFLICT 表达式推断（唯一索引建在 BTRIM 表达式上，GaussDB 兼容保守写法）。"""
        cur = conn.execute(
            "SELECT id FROM research_duty_field_binding WHERE BTRIM(domain)=%s AND BTRIM(module)=%s",
            (slot_domain, slot_module),
        ).fetchone()
        if payload.field_id is None:
            if cur:
                conn.execute("DELETE FROM research_duty_field_binding WHERE id=%s", (int(cur["id"]),))
        elif cur:
            conn.execute(
                """UPDATE research_duty_field_binding
                   SET field_id=%s, updated_by=%s, updated_at=NOW() WHERE id=%s""",
                (int(payload.field_id), op, int(cur["id"])),
            )
        else:
            conn.execute(
                """INSERT INTO research_duty_field_binding (field_id, domain, module, updated_by)
                   VALUES (%s, %s, %s, %s)""",
                (int(payload.field_id), slot_domain, slot_module, op),
            )

    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_research_duty_field", "无在研责任田编辑权限")
            if payload.field_id is not None:
                hit = conn.execute(
                    "SELECT id FROM research_duty_field WHERE id=%s", (int(payload.field_id),)
                ).fetchone()
                if not hit:
                    raise HTTPException(status_code=400, detail=f"在研责任田不存在：{payload.field_id}")
            # 自身槽位 + 级联下级槽位：同一事务内原子完成
            _upsert_slot(conn, domain, module)
            for slot_domain, slot_module in cascade:
                _upsert_slot(conn, slot_domain, slot_module)
            conn.commit()
            resp_items = _load_research_duty_fields(conn)
    except HTTPException:
        raise
    except (UndefinedTable, UndefinedColumn) as exc:
        raise HTTPException(status_code=503, detail=_RESEARCH_DUTY_FIELD_SCHEMA_HINT) from exc
    return {"ok": True, "items": resp_items}


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
def create_baseline_version(payload: BaselineVersionCreatePayload, request: Request) -> dict:
    lab = str(payload.version_label or "").strip()
    if not lab:
        raise HTTPException(status_code=400, detail="版本不能为空")
    ch = str(payload.commit_hash or "").strip()[:128]
    op = resolve_operator_id(request, payload.operator_id)
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_version_edit", "无版本模块编辑权限")
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
def patch_baseline_version(row_id: int, payload: BaselineVersionPatchPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
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
            _require_params_whitelist(conn, op, "params_version_edit", "无版本模块编辑权限")
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
def delete_baseline_version(row_id: int, request: Request, operator_id: str = "admin") -> dict:
    op = resolve_operator_id(request, operator_id)
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_version_edit", "无版本模块编辑权限")
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
def create_hotfix_version(payload: HotfixVersionCreatePayload, request: Request) -> dict:
    hf = str(payload.hotfix_label or "").strip()
    if not hf:
        raise HTTPException(status_code=400, detail="热补丁版本不能为空")
    bid = int(payload.baseline_id)
    op = resolve_operator_id(request, payload.operator_id)
    full = None
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_version_edit", "无版本模块编辑权限")
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
def patch_hotfix_version(row_id: int, payload: HotfixVersionPatchPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
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
            _require_params_whitelist(conn, op, "params_version_edit", "无版本模块编辑权限")
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
def delete_hotfix_version(row_id: int, request: Request, operator_id: str = "admin") -> dict:
    op = resolve_operator_id(request, operator_id)
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_version_edit", "无版本模块编辑权限")
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
def list_group_templates(request: Request, operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            op = resolve_operator_id(request, operator_id)
            require_whitelist_any(
                conn,
                op,
                ("workbench_group", "params_group_template_edit"),
                "无拉群模版查看权限",
            )
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
def put_group_templates(payload: GroupTemplatePutPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
    items = list(payload.items or [])
    kinds_in = {str(x.problem_kind or "").strip() for x in items}
    if kinds_in != set(_GROUP_TEMPLATE_KIND_ORDER):
        raise HTTPException(
            status_code=400,
            detail=f"须一次性提交四种问题类型：{', '.join(_GROUP_TEMPLATE_KIND_ORDER)}",
        )
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_group_template_edit", "无拉群模版编辑权限")
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
def put_issue_root_cause(payload: IssueRootCausePutPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
    try:
        with db_conn() as conn:
            _require_params_whitelist(conn, op, "params_issue_root_cause", "无问题根因编辑权限")
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
def get_llm_config(request: Request, operator_id: str = "demo_001") -> dict:
    op = resolve_operator_id(request, operator_id)
    with db_conn() as conn:
        require_whitelist(conn, op, "params_llm_config", "无大模型配置权限")
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
def put_llm_config(payload: LlmConfigPutPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
    items = payload.items or []
    with db_conn() as conn:
        require_whitelist(conn, op, "params_llm_config", "无大模型配置权限")
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
async def test_llm_config(payload: LlmTestPayload, request: Request) -> dict:
    op = resolve_operator_id(request, payload.operator_id)
    with db_conn() as conn:
        require_whitelist(conn, op, "params_llm_config", "无大模型配置权限")
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

