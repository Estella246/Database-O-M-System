from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import httpx

from routers import health_router, permission_router, user_router, duty_router, leave_router, params_router, requirement_router, major_problem_router, major_issue_router, site_profile_router, ai_router, nodes_router, tickets_router, home_router, upload_router, richtext_media_router, auth_router, oncall_eva_router, monthly_report_router, xiaoluban_router, welink_router
from sso_config import SSO_PROFILE_URL, AUTH_WHITELIST_PREFIXES, AUTH_STATIC_PREFIXES, SKIP_SSO_AUTH
from session_cache import init_session_cache, get_cached_session, set_cached_session, get_session_cache

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware to validate SSO session for API requests.

    Uses session cache to avoid repeated SSO verification for each request.
    Cache hit: Skip SSO call, use cached user info (response time ~10ms).
    Cache miss: Verify with SSO, query local user, update cache (response time ~100-500ms).
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip all auth checks if SKIP_SSO_AUTH is enabled (for testing/development)
        if SKIP_SSO_AUTH:
            return await call_next(request)

        # Skip auth for whitelisted paths
        for prefix in AUTH_WHITELIST_PREFIXES:
            if path == prefix or path.startswith(prefix + "/"):
                return await call_next(request)

        # Skip auth for static resources (frontend SPA handling)
        # Static files are served by the SPA fallback route
        if not path.startswith("/api/"):
            # Check if it's a frontend static resource path
            for prefix in AUTH_STATIC_PREFIXES:
                if path == prefix or path.startswith(prefix):
                    return await call_next(request)
            # Other non-API paths (SPA routes) also skip auth check at middleware level
            # Frontend will handle login redirect
            return await call_next(request)

        # API requests require authentication
        cookies = request.cookies
        hwssot = cookies.get("hwssot", "")
        login_sid = cookies.get("login_sid", "")

        if not hwssot and not login_sid:
            return JSONResponse(
                status_code=401,
                content={"detail": "No cookie"}
            )

        # Step 1: Check session cache
        cached_entry = get_cached_session(hwssot, login_sid)
        if cached_entry is not None:
            # Cache hit - use cached user info
            request.state.sso_user = cached_entry.sso_user
            request.state.local_user = cached_entry.local_user
            request.state.w3_account = cached_entry.w3_account
            return await call_next(request)

        # Step 2: Cache miss - verify with SSO service
        # Build cookie string from all cookies (Java-style: name=value;name=value;)
        cookie_string = ""
        for name, value in cookies.items():
            cookie_string += f"{name}={value};"

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    SSO_PROFILE_URL,
                    headers={"Cookie": cookie_string}
                )
        except httpx.RequestError as e:
            logger.error("SSO service unavailable: %s", e)
            return JSONResponse(
                status_code=503,
                content={"detail": "SSO service unavailable"}
            )

        # Handle response - could be text string or JSON
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            sso_data = response.json()
        else:
            text = response.text.strip()
            if text == "No login user found.":
                logger.warning("SSO session invalid or expired for path: %s", path)
                return JSONResponse(
                    status_code=401,
                    content={"detail": "No login user found."}
                )
            # If not the expected string, treat as unexpected response
            logger.warning("Unexpected SSO response for path: %s", path)
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid SSO response"}
            )

        # Extract w3Account from SSO data
        w3_account = sso_data.get("w3Account", "")
        if not w3_account:
            return JSONResponse(
                status_code=401,
                content={"detail": "No login user found."}
            )

        # Step 3: Query local user from database
        from database import db_conn
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
            return JSONResponse(
                status_code=403,
                content={"detail": "用户未注册，无法完成登录"}
            )

        if not row.get("is_active", True):
            return JSONResponse(
                status_code=403,
                content={"detail": "用户已禁用，无法完成登录"}
            )

        # Build user info
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

        # Step 4: Update session cache
        set_cached_session(hwssot, login_sid, sso_user, local_user, w3_account)

        # Inject user info into request state
        request.state.sso_user = sso_user
        request.state.local_user = local_user
        request.state.w3_account = w3_account

        return await call_next(request)


app = FastAPI(title="运维工单后端", version="0.2.0")


from apscheduler.schedulers.background import BackgroundScheduler
from config import REMINDER_CHECK_INTERVAL_SECONDS
from utils.ticket_reminder import check_and_send_reminders

_scheduler = BackgroundScheduler()


@app.on_event("startup")
async def startup_event():
    """Initialize session cache and start reminder scheduler on app startup."""
    cache = init_session_cache()
    logger.info(
        "Session cache initialized: maxsize=%d, ttl=%ds, enabled=%s",
        cache._maxsize,
        cache._ttl,
        cache.is_enabled()
    )
    _scheduler.add_job(
        check_and_send_reminders, "interval",
        seconds=REMINDER_CHECK_INTERVAL_SECONDS,
    )
    _scheduler.start()
    logger.info("Reminder scheduler started (interval=%ds)", REMINDER_CHECK_INTERVAL_SECONDS)


@app.on_event("shutdown")
async def shutdown_event():
    _scheduler.shutdown()
    logger.info("Reminder scheduler stopped")


# Add auth middleware first (executed last in request chain)
app.add_middleware(AuthMiddleware)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(permission_router)
app.include_router(user_router)
app.include_router(duty_router)
app.include_router(leave_router)
app.include_router(params_router)
app.include_router(requirement_router)
app.include_router(major_problem_router)
app.include_router(major_issue_router)
app.include_router(site_profile_router)
app.include_router(ai_router)
app.include_router(nodes_router)
app.include_router(tickets_router)
app.include_router(home_router)
app.include_router(upload_router)
app.include_router(richtext_media_router)
app.include_router(oncall_eva_router)
app.include_router(monthly_report_router)
app.include_router(xiaoluban_router)
app.include_router(welink_router)


def _register_frontend_spa() -> None:
    """Serve static frontend + SPA fallback so /tickets/... and /admin/... refresh works.

    Enabled by default when frontend/index.html exists. API-only deployments: SERVE_FRONTEND=0.
    """
    if os.getenv("SERVE_FRONTEND", "").strip() == "0":
        return
    root = Path(__file__).resolve().parent.parent / "frontend"
    index = root / "index.html"
    if not index.is_file():
        return

    # 前端为免构建的 ES Module,no-cache 让浏览器每次向服务端校验(配合 ETag 命中即 304),
    # 避免改动前端代码后浏览器仍沿用启发式缓存的旧文件。
    no_cache = {"Cache-Control": "no-cache"}

    @app.get("/")
    def spa_index() -> FileResponse:
        return FileResponse(index, headers=no_cache)

    @app.get("/{spa_path:path}")
    def spa_fallback(spa_path: str) -> FileResponse:
        if "\x00" in spa_path:
            raise HTTPException(status_code=400, detail="invalid path")
        base = root.resolve()
        candidate = (root / spa_path).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            raise HTTPException(status_code=404, detail="not found")
        if candidate.is_file():
            return FileResponse(candidate, headers=no_cache)
        return FileResponse(index, headers=no_cache)


_register_frontend_spa()