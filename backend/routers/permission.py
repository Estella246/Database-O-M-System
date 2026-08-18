from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from database import db_conn
from models import PermissionPolicyBulkPayload
from utils.api_guard import require_whitelist
from utils.logging_config import audit_log
from utils.operator_auth import resolve_operator_id

router = APIRouter(prefix="/api", tags=["permissions"])

_PROTECTED_ROLE_CODES = frozenset({"管理员"})


def _get_user_role(conn, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), False


def _get_whitelist_flags(conn, operator_id: str) -> dict[str, bool]:
    role_code, is_pl = _get_user_role(conn, operator_id)
    if not role_code:
        return {
            "ticket_create": False,
            "ticket_list_all": False,
            "ticket_detail_all": False,
            "ticket_list_only_self_created": False,
            "ticket_detail_only_problem_fill": False,
            "leave_application_all_only_self_applicant": False,
        }
    rows = conn.execute(
        """
        SELECT node_key, field_key, permission_level
        FROM role_permission_policy
        WHERE role_code = %s AND is_pl = %s
        """,
        (role_code, is_pl),
    ).fetchall()
    level_by_key: dict[str, str] = {}
    for r in rows:
        nk = str(r.get("node_key") or "")
        fk = str(r.get("field_key") or "")
        level_by_key[f"{nk}:{fk}"] = str(r.get("permission_level") or "hidden")
    return {
        "ticket_create": level_by_key.get("ticket_create") == "editable",
        "ticket_list_all": level_by_key.get("ticket_list_scope_all") == "editable",
        "ticket_detail_all": level_by_key.get("ticket_detail_scope_all") == "editable",
        "ticket_list_only_self_created": level_by_key.get("ticket_list_scope_self") == "editable",
        "ticket_detail_only_problem_fill": level_by_key.get("ticket_detail_scope_problem_fill") == "editable",
        "leave_application_all_only_self_applicant": level_by_key.get("leave_application_all") == "editable",
    }


@router.get("/permissions/effective")
def get_effective_permissions(
    request: Request, operator_id: str = "demo_001"
) -> dict[str, Any]:
    operator_id = resolve_operator_id(request, operator_id)
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
    return {"operator_id": operator_id, "flags": flags}


@router.get("/admin/permissions")
def list_permission_policies(
    request: Request, operator_id: str = Query("demo_001")
) -> dict[str, Any]:
    resolve_operator_id(request, operator_id)
    with db_conn() as conn:
        # 全员启动要拉策略算菜单，与 GET /admin/users 一样不按 admin_permissions 拦截。
        rows = conn.execute(
            """
            SELECT role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at
            FROM role_permission_policy
            ORDER BY role_code, is_pl DESC, node_key, field_key
            """
        ).fetchall()
    return {"items": rows}


@router.post("/admin/permissions/bulk")
def upsert_permission_policies(
    payload: PermissionPolicyBulkPayload, request: Request
) -> dict[str, Any]:
    allowed = {"hidden", "readonly", "editable"}
    operator = resolve_operator_id(request, payload.operator_id)
    with db_conn() as conn:
        require_whitelist(conn, operator, "admin_permissions_whitelist", "无配置白名单权限")
        for item in payload.items:
            if item.permission_level not in allowed:
                raise HTTPException(status_code=400, detail=f"invalid permission_level: {item.permission_level}")
            conn.execute(
                """
                INSERT INTO role_permission_policy (
                  role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (role_code, is_pl, node_key, field_key)
                DO UPDATE SET
                  permission_level = EXCLUDED.permission_level,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = NOW()
                """,
                (
                    item.role_code.strip(),
                    item.is_pl,
                    item.node_key.strip(),
                    item.field_key.strip(),
                    item.permission_level.strip(),
                    operator,
                ),
            )
        conn.commit()
    audit_log("admin.permissions.bulk", operator=operator, count=len(payload.items))
    return {"ok": True, "count": len(payload.items)}


@router.delete("/admin/permissions/group")
def delete_permission_group(
    request: Request, role_code: str, operator_id: str = Query("demo_001")
) -> dict[str, Any]:
    code = (role_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="role_code required")
    if code in _PROTECTED_ROLE_CODES:
        raise HTTPException(status_code=403, detail="内置权限组不可删除")
    op = resolve_operator_id(request, operator_id)
    with db_conn() as conn:
        require_whitelist(conn, op, "admin_permissions_delete", "无删除权限组权限")
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM user_account WHERE role_code = %s",
            (code,),
        ).fetchone()
        user_count = int(row["c"] or 0) if row else 0
        if user_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"仍有 {user_count} 名用户使用该权限组，请先调整用户角色",
            )
        conn.execute(
            "DELETE FROM role_permission_policy WHERE role_code = %s",
            (code,),
        )
        conn.commit()
    audit_log("admin.permissions.delete_group", role_code=code)
    return {"ok": True, "role_code": code}


@router.delete("/admin/permissions")
def delete_permission_policy(
    request: Request,
    role_code: str,
    is_pl: bool,
    node_key: str,
    field_key: str,
    operator_id: str = Query("demo_001"),
) -> dict[str, Any]:
    op = resolve_operator_id(request, operator_id)
    with db_conn() as conn:
        require_whitelist(conn, op, "admin_permissions_whitelist", "无配置白名单权限")
        conn.execute(
            """
            DELETE FROM role_permission_policy
            WHERE role_code = %s AND is_pl = %s AND node_key = %s AND field_key = %s
            """,
            (role_code, is_pl, node_key, field_key),
        )
        conn.commit()
    audit_log(
        "admin.permissions.delete",
        role_code=role_code,
        is_pl=is_pl,
        node_key=node_key,
        field_key=field_key,
    )
    return {"ok": True}