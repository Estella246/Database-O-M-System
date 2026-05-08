from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import httpx

from routers import health_router, permission_router, user_router, duty_router, leave_router, params_router, requirement_router, ai_router, nodes_router, tickets_router, home_router, skill_router, upload_router, richtext_media_router, auth_router
from sso_config import SSO_PROFILE_URL, AUTH_WHITELIST_PREFIXES, AUTH_STATIC_PREFIXES, SKIP_SSO_AUTH


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware to validate SSO session for API requests."""

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
        cookie_string = request.headers.get("cookie", "")

        if not cookie_string:
            return JSONResponse(
                status_code=401,
                content={"detail": "No cookie"}
            )

        # Check if SSO cookies exist
        if "JESESSIONID" not in cookie_string and "login_sid" not in cookie_string:
            return JSONResponse(
                status_code=401,
                content={"detail": "No SSO session cookie"}
            )

        # Validate with SSO service
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    SSO_PROFILE_URL,
                    headers={"Cookie": cookie_string}
                )
        except httpx.RequestError:
            return JSONResponse(
                status_code=503,
                content={"detail": "SSO service unavailable"}
            )

        if response.status_code != 200:
            return JSONResponse(
                status_code=401,
                content={"detail": "Session invalid or expired"}
            )

        data = response.json()
        if not data.get("success", False):
            return JSONResponse(
                status_code=401,
                content={"detail": data.get("error", "Session invalid")}
            )

        # Inject user info into request state for downstream routes
        request.state.sso_user = data

        return await call_next(request)


app = FastAPI(title="运维工单后端", version="0.2.0")

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
app.include_router(ai_router)
app.include_router(nodes_router)
app.include_router(tickets_router)
app.include_router(home_router)
app.include_router(skill_router)
app.include_router(upload_router)
app.include_router(richtext_media_router)


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

    @app.get("/")
    def spa_index() -> FileResponse:
        return FileResponse(index)

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
            return FileResponse(candidate)
        return FileResponse(index)


_register_frontend_spa()