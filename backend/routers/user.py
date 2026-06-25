from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from database import db_conn
from models import UserAccountBulkPayload
from utils.logging_config import audit_log

router = APIRouter(prefix="/api/admin", tags=["users"])


@router.get("/users")
def list_users() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT account, user_name, role_code, group_name,
                   email, contact_phone, product_line, expert_domain, min_dept, remark,
                   is_active, updated_by, updated_at
            FROM user_account
            ORDER BY account
            """
        ).fetchall()
    return {"items": rows}


@router.post("/users/bulk")
def upsert_users(payload: UserAccountBulkPayload) -> dict[str, Any]:
    with db_conn() as conn:
        for item in payload.items:
            conn.execute(
                """
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
                """,
                (
                    item.account.strip(),
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
                    payload.operator_id.strip() or "admin",
                ),
            )
        conn.commit()
    operator = payload.operator_id.strip() or "admin"
    audit_log("admin.users.bulk", operator=operator, count=len(payload.items))
    return {"ok": True, "count": len(payload.items)}


@router.delete("/users")
def delete_user(account: str) -> dict[str, Any]:
    target = (account or "").strip()
    with db_conn() as conn:
        conn.execute("DELETE FROM user_account WHERE LOWER(account) = LOWER(%s)", (target,))
        conn.commit()
    audit_log("admin.users.delete", account=target)
    return {"ok": True}