"""SSO authentication router - validate SSO cookies and return user info."""
import logging

from fastapi import APIRouter, Request, HTTPException
import httpx
import os

from database import db_conn
from sso_config import SSO_PROFILE_URL, SSO_LOGIN_URL, SSO_COOKIE_DOMAIN, SSO_COOKIE_NAMES, SKIP_SSO_AUTH

logger = logging.getLogger(__name__)

# Development mode mock user (when SKIP_SSO_AUTH=1)
DEV_USER_ACCOUNT = os.getenv("DEV_USER_ACCOUNT", "dev_admin")
DEV_USER_NAME = os.getenv("DEV_USER_NAME", "开发管理员")

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
async def get_sso_config():
    """Return SSO configuration for frontend use.

    Returns:
        login_url: URL for user login redirect (frontend uses this)
        profile_url: URL for backend cookie validation
        cookie_domain: Domain for SSO cookies
        cookie_names: Cookie names to check/clear
        skip_auth: Whether SSO auth is skipped (development mode)
    """
    return {
        "login_url": SSO_LOGIN_URL,
        "profile_url": SSO_PROFILE_URL,
        "cookie_domain": SSO_COOKIE_DOMAIN,
        "cookie_names": SSO_COOKIE_NAMES,
        "skip_auth": SKIP_SSO_AUTH,
    }


@router.get("/me")
async def get_current_user(request: Request):
    """Validate SSO cookie and return current user info.

    Calls SSO /account/profile endpoint to validate session.
    Then checks if user exists in local user_account table.
    Returns user info if valid, 401 if invalid or user not registered.

    In development mode (SKIP_SSO_AUTH=1), returns a mock dev user.
    """
    # Development mode: return mock user without SSO validation
    if SKIP_SSO_AUTH:
        # Try to find dev user in database first
        with db_conn() as conn:
            row = conn.execute(
                """
                SELECT account, user_name, role_code, group_name, is_active
                FROM user_account
                WHERE account = %s
                """,
                (DEV_USER_ACCOUNT,)
            ).fetchone()

        if row:
            return {
                "success": True,
                "sso_user": {
                    "lname": row["user_name"],
                    "userName": DEV_USER_ACCOUNT,
                    "email": f"{DEV_USER_ACCOUNT}@dev.local",
                },
                "local_user": {
                    "account": row["account"],
                    "user_name": row["user_name"],
                    "role_code": row["role_code"],
                    "group_name": row.get("group_name", ""),
                },
                "w3Account": DEV_USER_ACCOUNT,
            }

        # Dev user not in database, return mock response with admin role
        return {
            "success": True,
            "sso_user": {
                "lname": DEV_USER_NAME,
                "userName": DEV_USER_ACCOUNT,
                "email": f"{DEV_USER_ACCOUNT}@dev.local",
            },
            "local_user": {
                "account": DEV_USER_ACCOUNT,
                "user_name": DEV_USER_NAME,
                "role_code": "admin",
                "group_name": "开发组",
            },
            "w3Account": DEV_USER_ACCOUNT,
        }

    # Production mode: validate SSO cookie
    # Build cookie string from all cookies (Java-style: name=value;name=value;)
    cookies = request.cookies
    cookie_string = ""
    for name, value in cookies.items():
        cookie_string += f"{name}={value};"

    logger.debug("Cookie string: %s", cookie_string)

    if not cookie_string:
        raise HTTPException(status_code=401, detail="No cookie")

    # Validate with SSO service
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                SSO_PROFILE_URL,
                headers={"Cookie": cookie_string}
            )
            logger.debug("SSO response status: %s, body: %s", response.status_code, response.text)
    except httpx.RequestError as e:
        logger.error("SSO request error: %s", e)
        raise HTTPException(status_code=503, detail="SSO service unavailable")

    # Handle response - could be text string or JSON
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        sso_data = response.json()
    else:
        text = response.text.strip()
        if text == "No login user found.":
            raise HTTPException(status_code=401, detail="No login user found.")
        logger.warning("Unexpected SSO response: %s", text)
        raise HTTPException(status_code=401, detail="Invalid SSO response")

    # Check if user is registered in local system
    w3_account = sso_data.get("w3Account", "")
    if not w3_account:
        return "No login user found."

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