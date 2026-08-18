"""接口白名单：与前端「不展示」对齐，hidden 时 403。"""
from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException

from whitelist_policy import whitelist_delete_allowed


def require_whitelist(
    conn,
    operator_id: str,
    field_key: str,
    detail: str = "无权限",
) -> None:
    """``whitelistAllows(field_key, readonly)`` 的后端对应：非 hidden 才放行。"""
    if not whitelist_delete_allowed(conn, operator_id, field_key):
        raise HTTPException(status_code=403, detail=detail)


def require_whitelist_any(
    conn,
    operator_id: str,
    field_keys: Iterable[str],
    detail: str = "无权限",
) -> None:
    """任一键非 hidden 即放行。"""
    keys = [str(k).strip() for k in field_keys if str(k).strip()]
    if any(whitelist_delete_allowed(conn, operator_id, key) for key in keys):
        return
    raise HTTPException(status_code=403, detail=detail)
