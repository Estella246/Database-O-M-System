"""质量改进流程核心逻辑：阶段流转、打回、校验、责任人继承。

供 routers/qi.py 调用，不直接挂路由。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from fastapi import HTTPException

from qi_config import (
    QI_CLOSURE_METHOD_PREFIX,
    QI_HANDLE_MODE_ROUTE,
    QI_PROGRESS_STAGES,
    QI_REJECT_HANDLE_MODES,
    QI_STAGE_FIELDS,
    QI_STAGE_KEYS,
)

_CHINA_TZ = ZoneInfo("Asia/Shanghai")


def _now() -> datetime:
    return datetime.now(_CHINA_TZ)


# ---- 人员展示名规范化（姓名 账号） ----
def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute(
        "SELECT user_name FROM user_account WHERE account = %s", (acc,)
    ).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


# ---- 必填校验（含条件必填联动） ----
def _effective_required(field: dict, values: dict[str, Any]) -> bool:
    """字段是否当前必填：基础 required + required_when 条件满足。"""
    if not field.get("required", False):
        cond = field.get("required_when")
        if not cond:
            return False
        return all(str(values.get(k)) == str(v) for k, v in cond.items())
    return True


def validate_stage_values(stage_key: str, values: dict[str, Any]) -> None:
    """校验阶段字段值：必填（含条件必填）、枚举合法。"""
    fields = QI_STAGE_FIELDS.get(stage_key, [])
    for f in fields:
        key = f["key"]
        val = values.get(key)
        val_str = str(val).strip() if val is not None else ""
        if _effective_required(f, values) and not val_str:
            raise HTTPException(status_code=400, detail=f"缺少必填字段：{f['label']}")
        # 枚举值校验（有值时）
        options = f.get("options")
        if options and val_str and val_str not in options:
            raise HTTPException(status_code=400, detail=f"{f['label']} 取值非法：{val_str}")


# ---- 阶段流转方向解析 ----
def resolve_next_stage(stage_key: str, handle_mode: str) -> str:
    """根据当前阶段与处理方式，解析下一阶段（'__closed__' 表示终态关闭）。"""
    route = QI_HANDLE_MODE_ROUTE.get(stage_key, {})
    if handle_mode not in route:
        raise HTTPException(
            status_code=400,
            detail=f"阶段 {stage_key} 不支持处理方式：{handle_mode}",
        )
    return route[handle_mode]


def is_reject_handle(handle_mode: str) -> bool:
    return handle_mode in QI_REJECT_HANDLE_MODES


# ---- 闭环单号校验（分析阶段接纳时） ----
def _validate_closure_ticket_no(conn: psycopg.Connection, closure_method: str, ticket_no: str) -> None:
    """校验问题单号/需求单号格式正确且单据真实存在。"""
    no = str(ticket_no or "").strip()
    if not no:
        raise HTTPException(status_code=400, detail="接纳时需填写问题单号/需求单号")
    # 存在性校验：在 ticket 表中查该单号（运维工单/需求单均落 ticket 表）
    exists = conn.execute(
        "SELECT 1 FROM ticket WHERE ticket_no = %s", (no,)
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=400, detail=f"闭环单号不存在于系统：{no}")


def build_closure_no(closure_method: str, closure_ticket_no: str) -> str:
    """根据闭环方法拼接闭环单号前缀（PC-问题单 / RC-需求）。"""
    prefix = QI_CLOSURE_METHOD_PREFIX.get(closure_method, "")
    return f"{prefix}-{closure_ticket_no}" if prefix else str(closure_ticket_no or "")


# ---- 提出阶段字段写入主表（便于列表查询） ----
def propose_values_to_request(values: dict[str, Any]) -> dict[str, str]:
    """从提出阶段 values 提取落在 qi_request 主表的字段（跳过空值，避免隐藏/冻结字段覆盖已有数据）。"""
    out: dict[str, str] = {}
    for k in ("category", "title", "related_ticket_no", "description", "expected_goal",
              "priority", "domain", "module_feature", "planned_version", "reviewer"):
        v = values.get(k)
        if v is not None and str(v).strip():
            out[k] = str(v).strip()
    return out


# ---- 阶段实例查询 ----
def get_active_stage(conn: psycopg.Connection, request_id: int, stage_key: str) -> dict | None:
    """取该阶段最新一行（sequence 最大）。"""
    row = conn.execute(
        """
        SELECT id, request_id, stage_key, sequence, status, responsible,
               started_at, completed_at
        FROM qi_stage
        WHERE request_id = %s AND stage_key = %s
        ORDER BY sequence DESC LIMIT 1
        """,
        (request_id, stage_key),
    ).fetchone()
    if not row:
        return None
    return {
        "id": int(row["id"]), "request_id": int(row["request_id"]),
        "stage_key": str(row["stage_key"]), "sequence": int(row["sequence"]),
        "status": str(row["status"]), "responsible": str(row["responsible"] or ""),
        "started_at": row["started_at"], "completed_at": row["completed_at"],
    }


def get_request_dict(conn: psycopg.Connection, request_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM qi_request WHERE id = %s", (request_id,)
    ).fetchone()
    return dict(row) if row else None


# ---- 责任人继承 ----
def _latest_responsible(conn: psycopg.Connection, request_id: int) -> str:
    """取最新责任人：优先分析阶段（分析时可重新指定），回退评审阶段。"""
    row = conn.execute(
        """
        SELECT sd.values_json->>'responsible' AS resp
        FROM qi_stage_data sd
        JOIN qi_stage s ON s.id = sd.stage_id
        WHERE sd.request_id = %s AND sd.stage_key IN ('analysis', 'review')
          AND sd.draft = FALSE AND sd.values_json->>'responsible' <> ''
        ORDER BY sd.created_at DESC LIMIT 1
        """,
        (request_id,),
    ).fetchone()
    return str(row["resp"] or "").strip() if row else ""
