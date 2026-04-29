from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from routers import health_router, permission_router, user_router, duty_router, leave_router, params_router, requirement_router, ai_router, nodes_router, tickets_router, home_router, upload_router

app = FastAPI(title="运维工单后端", version="0.2.0")

app.include_router(health_router)
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
app.include_router(upload_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
