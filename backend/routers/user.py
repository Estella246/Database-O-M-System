from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from database import db_conn
from models import UserAccountBulkPayload, UserAccountItem
from utils.logging_config import audit_log

router = APIRouter(prefix="/api/admin", tags=["users"])

_USER_SELECT = """
    SELECT id, account, user_name, role_code, group_name,
           email, contact_phone, product_line, expert_domain, min_dept, remark,
           is_active, updated_by, updated_at
    FROM user_account
"""


def _resolve_operator(request: Request, payload_operator: str) -> str:
    """优先用 SSO/本地登录账号（工号），再回落到请求体 operator_id。"""
    local = getattr(request.state, "local_user", None) or {}
    if isinstance(local, dict):
        acc = str(local.get("account") or "").strip()
        if acc:
            return acc
    w3 = str(getattr(request.state, "w3_account", None) or "").strip()
    if w3:
        return w3
    return str(payload_operator or "").strip() or "admin"


def _upsert_one(conn, item: UserAccountItem, operator: str) -> dict[str, Any] | None:
    account = item.account.strip()
    if not account:
        return None
    orig = (item.original_account or "").strip() or account
    fields = (
        account,
        item.user_name.strip(),
        item.role_code.strip(),
        item.group_name.strip(),
        item.email.strip(),
        item.contact_phone.strip(),
        item.product_line.strip(),
        item.expert_domain.strip(),
        item.min_dept.strip(),
        item.remark.strip(),
        item.is_active,
        operator,
    )
    returning = """
            RETURNING id, account, user_name, role_code, group_name,
                      email, contact_phone, product_line, expert_domain, min_dept, remark,
                      is_active, updated_by, updated_at
    """
    if orig.lower() != account.lower():
        # 改账号：先更新原行主键，再写其余字段（避免整表误插）
        moved = conn.execute(
            f"""
            UPDATE user_account SET
              account = %s,
              user_name = %s,
              role_code = %s,
              group_name = %s,
              email = %s,
              contact_phone = %s,
              product_line = %s,
              expert_domain = %s,
              min_dept = %s,
              remark = %s,
              is_active = %s,
              updated_by = %s,
              updated_at = NOW()
            WHERE LOWER(account) = LOWER(%s)
            {returning}
            """,
            (*fields, orig),
        ).fetchone()
        if moved:
            return moved
        # 原账号已不存在则按新账号 upsert
    row = conn.execute(
        f"""
        INSERT INTO user_account (
          account, user_name, role_code, group_name,
          email, contact_phone, product_line, expert_domain, min_dept, remark,
          is_active, updated_by, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (account)
        DO UPDATE SET
          user_name = EXCLUDED.user_name,
          role_code = EXCLUDED.role_code,
          group_name = EXCLUDED.group_name,
          email = EXCLUDED.email,
          contact_phone = EXCLUDED.contact_phone,
          product_line = EXCLUDED.product_line,
          expert_domain = EXCLUDED.expert_domain,
          min_dept = EXCLUDED.min_dept,
          remark = EXCLUDED.remark,
          is_active = EXCLUDED.is_active,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        {returning}
        """,
        fields,
    ).fetchone()
    return row


@router.get("/users")
def list_users() -> dict[str, Any]:
    with db_conn() as conn:
        # id 递增分配：新插入行 id 更大；按 id DESC 让最新加人排在列表最前
        rows = conn.execute(f"{_USER_SELECT} ORDER BY id DESC").fetchall()
    return {"items": rows}


@router.post("/users/bulk")
def upsert_users(payload: UserAccountBulkPayload, request: Request) -> dict[str, Any]:
    operator = _resolve_operator(request, payload.operator_id)
    updated: list[dict[str, Any]] = []
    with db_conn() as conn:
        for item in payload.items:
            row = _upsert_one(conn, item, operator)
            if row:
                updated.append(row)
        conn.commit()
    audit_log("admin.users.bulk", operator=operator, count=len(updated))
    return {"ok": True, "count": len(updated), "updated_by": operator, "items": updated}


@router.delete("/users")
def delete_user(account: str) -> dict[str, Any]:
    target = (account or "").strip()
    with db_conn() as conn:
        conn.execute("DELETE FROM user_account WHERE LOWER(account) = LOWER(%s)", (target,))
        conn.commit()
    audit_log("admin.users.delete", account=target)
    return {"ok": True}
