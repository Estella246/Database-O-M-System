from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Query

from database import db_conn
from models import UserAccountBulkPayload, UserAccountItem
from utils.api_guard import require_whitelist
from utils.logging_config import audit_log
from utils.operator_auth import resolve_operator_id
from whitelist_policy import whitelist_delete_allowed

router = APIRouter(prefix="/api/admin", tags=["users"])

_USER_SELECT = """
    SELECT id, account, user_name, role_code, group_name,
           email, contact_phone, product_line, expert_domain, min_dept, remark,
           is_active, updated_by, updated_at
    FROM user_account
"""


def _resolve_operator(request: Request, payload_operator: str) -> str:
    """优先用 SSO 登录账号，测试环境回退请求参数。"""
    return resolve_operator_id(request, payload_operator)


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


_PUBLIC_USER_FIELDS = (
    "id",
    "account",
    "user_name",
    "role_code",
    "group_name",
    "product_line",
    "expert_domain",
    "min_dept",
    "contact_phone",
    "is_active",
)


@router.get("/users")
def list_users(request: Request, operator_id: str = Query("")) -> dict[str, Any]:
    """登录即可拉人员选项；无 admin_users 时去掉邮箱/备注。电话保留，供 RL 值班表选人自动带出。"""
    op = resolve_operator_id(request, operator_id)
    with db_conn() as conn:
        can_admin = whitelist_delete_allowed(conn, op, "admin_users")
        rows = conn.execute(f"{_USER_SELECT} ORDER BY id DESC").fetchall()
    items = [dict(r) for r in rows]
    if not can_admin:
        items = [{k: row.get(k) for k in _PUBLIC_USER_FIELDS} for row in items]
    return {"items": items}


@router.post("/users/bulk")
def upsert_users(payload: UserAccountBulkPayload, request: Request) -> dict[str, Any]:
    operator = _resolve_operator(request, payload.operator_id)
    updated: list[dict[str, Any]] = []
    with db_conn() as conn:
        require_whitelist(conn, operator, "admin_users_edit", "无用户编辑权限")
        for item in payload.items:
            row = _upsert_one(conn, item, operator)
            if row:
                updated.append(row)
        conn.commit()
    audit_log("admin.users.bulk", operator=operator, count=len(updated))
    return {"ok": True, "count": len(updated), "updated_by": operator, "items": updated}


@router.delete("/users")
def delete_user(
    request: Request, account: str, operator_id: str = Query("")
) -> dict[str, Any]:
    op = resolve_operator_id(request, operator_id)
    target = (account or "").strip()
    with db_conn() as conn:
        require_whitelist(conn, op, "admin_users_edit", "无用户编辑权限")
        conn.execute("DELETE FROM user_account WHERE LOWER(account) = LOWER(%s)", (target,))
        conn.commit()
    audit_log("admin.users.delete", operator=op, account=target)
    return {"ok": True}
