"""SSO authentication router - validate SSO cookies and return user info."""
from fastapi import APIRouter, Request, HTTPException
import httpx
import os

from database import db_conn
from sso_config import SSO_PROFILE_URL, SSO_LOGIN_URL, SSO_COOKIE_DOMAIN, SSO_COOKIE_NAMES

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
async def get_sso_config():
    """Return SSO configuration for frontend use.

    Returns:
        login_url: URL for user login redirect (frontend uses this)
        profile_url: URL for backend cookie validation
        cookie_domain: Domain for SSO cookies
        cookie_names: Cookie names to check/clear
    """
    return {
        "login_url": SSO_LOGIN_URL,
        "profile_url": SSO_PROFILE_URL,
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
    # Build cookie string from all cookies (Java-style: name=value;name=value;)
    cookies = request.cookies
    cookie_string = ""
    for name, value in cookies.items():
        cookie_string += f"{name}={value};"

    print(f"[SSO Auth] Cookie string: {cookie_string}")

    if not cookie_string:
        raise HTTPException(status_code=401, detail="No cookie")

    # Validate with SSO service
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                SSO_PROFILE_URL,
                headers={"Cookie": cookie_string}
            )
            print(f"[SSO Auth] Response status: {response.status_code}")
            print(f"[SSO Auth] Response body: {response.text}")
    except httpx.RequestError as e:
        print(f"[SSO Auth] Request error: {e}")
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