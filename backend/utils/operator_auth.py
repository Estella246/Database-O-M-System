"""从 SSO 会话解析当前操作人，避免客户端伪造 operator_id 绕过白名单。"""
from __future__ import annotations

from fastapi import HTTPException, Request

from sso_config import SKIP_SSO_AUTH


def resolve_operator_id(request: Request | None, claimed: str | None = "") -> str:
    """权限与数据范围一律以登录人为准。

    - 中间件已写入 ``request.state.local_user`` / ``w3_account`` 时，忽略请求里的账号。
    - ``SKIP_SSO_AUTH``（测试/本地）且没有会话时，才回退到请求参数。
    """
    claimed = str(claimed or "").strip()
    if request is not None:
        local = getattr(request.state, "local_user", None) or {}
        account = ""
        if isinstance(local, dict):
            account = str(local.get("account") or "").strip()
        if not account:
            account = str(getattr(request.state, "w3_account", None) or "").strip()
        if account:
            return account
    if SKIP_SSO_AUTH:
        return claimed or "demo_001"
    raise HTTPException(status_code=401, detail="未登录")
