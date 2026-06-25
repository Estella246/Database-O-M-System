"""SSO authentication router - validate SSO cookies and return user info."""
import logging

from fastapi import APIRouter, Request, HTTPException
import httpx
import os

from database import db_conn
from sso_config import SSO_PROFILE_URL, SSO_LOGIN_URL, SSO_COOKIE_DOMAIN, SSO_COOKIE_NAMES, SKIP_SSO_AUTH
from session_cache import (
    get_cached_session,
    set_cached_session,
    invalidate_session,
    clear_all_sessions,
    get_cache_stats,
)

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

    Uses session cache to avoid repeated SSO verification:
    - Cache hit: Return cached user info (fast, ~10ms)
    - Cache miss: Verify with SSO, query DB, cache result (slow, ~100-500ms)
    """
    # Development mode: return mock user without SSO validation
    if SKIP_SSO_AUTH:
        # Check cache first for dev mode session
        cached_entry = get_cached_session("dev_mode", "dev_mode")
        if cached_entry is not None:
            return {
                "success": True,
                "sso_user": cached_entry.sso_user,
                "local_user": cached_entry.local_user,
                "w3Account": cached_entry.w3_account,
            }

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

        sso_user = {
            "lname": DEV_USER_NAME,
            "userName": DEV_USER_ACCOUNT,
            "email": f"{DEV_USER_ACCOUNT}@dev.local",
        }

        if row:
            local_user = {
                "account": row["account"],
                "user_name": row["user_name"],
                "role_code": row["role_code"],
                "group_name": row.get("group_name", ""),
            }
            # Cache dev mode session
            set_cached_session(
                "dev_mode",
                "dev_mode",
                sso_user,
                local_user,
                DEV_USER_ACCOUNT,
                is_dev_mode=True
            )
            return {
                "success": True,
                "sso_user": sso_user,
                "local_user": local_user,
                "w3Account": DEV_USER_ACCOUNT,
            }

        # Dev user not in database, return mock response with admin role
        local_user = {
            "account": DEV_USER_ACCOUNT,
            "user_name": DEV_USER_NAME,
            "role_code": "admin",
            "group_name": "开发组",
        }
        set_cached_session(
            "dev_mode",
            "dev_mode",
            sso_user,
            local_user,
            DEV_USER_ACCOUNT,
            is_dev_mode=True
        )
        return {
            "success": True,
            "sso_user": sso_user,
            "local_user": local_user,
            "w3Account": DEV_USER_ACCOUNT,
        }

    # Production mode: validate SSO cookie
    # Check if user info already in request state (from AuthMiddleware cache hit)
    if hasattr(request.state, "sso_user") and hasattr(request.state, "local_user"):
        return {
            "success": True,
            "sso_user": request.state.sso_user,
            "local_user": request.state.local_user,
            "w3Account": request.state.w3_account,
        }

    # Extract SSO cookies for cache lookup
    cookies = request.cookies
    hwssot = cookies.get("hwssot", "")
    login_sid = cookies.get("login_sid", "")

    # Check session cache first
    cached_entry = get_cached_session(hwssot, login_sid)
    if cached_entry is not None:
        return {
            "success": True,
            "sso_user": cached_entry.sso_user,
            "local_user": cached_entry.local_user,
            "w3Account": cached_entry.w3_account,
        }

    # Cache miss - need to verify with SSO
    # Build cookie string from all cookies
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

    # Check if user is registered in local system (case-insensitive match)
    w3_account = sso_data.get("w3Account", "").strip()
    if not w3_account:
        return "No login user found."

    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT account, user_name, role_code, group_name, is_active
            FROM user_account
            WHERE LOWER(account) = LOWER(%s)
            """,
            (w3_account,)
        ).fetchone()

    if not row:
        raise HTTPException(status_code=403, detail="用户未注册，无法完成登录")

    if not row.get("is_active", True):
        raise HTTPException(status_code=403, detail="用户已禁用，无法完成登录")

    # Build user info — use DB-stored account as canonical identifier
    # to ensure consistent casing throughout the system
    w3_account = row["account"]
    sso_user = {
        "lname": sso_data.get("lname", ""),
        "userName": sso_data.get("userName", ""),
        "email": sso_data.get("email", ""),
    }
    local_user = {
        "account": row["account"],
        "user_name": row["user_name"],
        "role_code": row["role_code"],
        "group_name": row.get("group_name", ""),
    }

    # Update session cache
    set_cached_session(hwssot, login_sid, sso_user, local_user, w3_account)

    # Return combined user info
    return {
        "success": True,
        "sso_user": sso_user,
        "local_user": local_user,
        "w3Account": w3_account,
    }


@router.get("/health")
async def auth_health():
    """Health check for auth module."""
    return {"status": "ok", "sso_login_url": SSO_LOGIN_URL}


@router.get("/cache-stats")
async def get_auth_cache_stats():
    """Get session cache statistics.

    Returns cache hit rate, entry count, and configuration.
    Useful for monitoring cache effectiveness.
    """
    return get_cache_stats()


@router.post("/cache-clear")
async def clear_auth_cache():
    """Clear all cached sessions.

    Useful for:
    - Emergency cache reset
    - After batch user updates
    - Testing purposes
    """
    count = clear_all_sessions()
    return {"success": True, "cleared_count": count}