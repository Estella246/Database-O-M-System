"""SSO authentication router - validate SSO cookies and return user info."""
from fastapi import APIRouter, Request, HTTPException
import httpx
import os

from database import db_conn
from sso_config import SSO_PROFILE_URL, SSO_LOGIN_URL, SSO_COOKIE_DOMAIN, SSO_COOKIE_NAMES

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
async def get_sso_config():
    """Return SSO configuration for frontend use."""
    return {
        "login_url": SSO_LOGIN_URL,
        "cookie_domain": SSO_COOKIE_DOMAIN,
        "cookie_names": SSO_COOKIE_NAMES,
    }


@router.get("/me")
async def get_current_user(request: Request):
    """Validate SSO cookie and return current user info.

    Calls SSO /account/profile endpoint to validate session.
    Then checks if user exists in local user_account table.
    Returns user info if valid, 401 if invalid or user not registered.
    """
    cookie_string = request.headers.get("cookie", "")

    if not cookie_string:
        raise HTTPException(status_code=401, detail="No cookie")

    # Check if SSO cookies exist
    if "JESESSIONID" not in cookie_string and "login_sid" not in cookie_string:
        raise HTTPException(status_code=401, detail="No SSO session cookie")

    # Validate with SSO service
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                SSO_PROFILE_URL,
                headers={"Cookie": cookie_string}
            )
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="SSO service unavailable")

    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Session invalid or expired")

    sso_data = response.json()
    if not sso_data.get("success", False):
        raise HTTPException(status_code=401, detail=sso_data.get("error", "Session invalid"))

    # Check if user is registered in local system
    w3_account = sso_data.get("w3Account", "")
    if not w3_account:
        raise HTTPException(status_code=401, detail="No w3Account in SSO response")

    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT account, user_name, role_code, group_name, is_active
            FROM user_account
            WHERE account = %s
            """,
            (w3_account,)
        ).fetchone()

    if not row:
        raise HTTPException(status_code=403, detail="用户未注册，无法完成登录")

    if not row.get("is_active", True):
        raise HTTPException(status_code=403, detail="用户已禁用，无法完成登录")

    # Return combined user info
    return {
        "success": True,
        "sso_user": {
            "lname": sso_data.get("lname", ""),
            "userName": sso_data.get("userName", ""),
            "email": sso_data.get("email", ""),
        },
        "local_user": {
            "account": row["account"],
            "user_name": row["user_name"],
            "role_code": row["role_code"],
            "group_name": row.get("group_name", ""),
        },
        "w3Account": w3_account,
    }


@router.get("/health")
async def auth_health():
    """Health check for auth module."""
    return {"status": "ok", "sso_login_url": SSO_LOGIN_URL}