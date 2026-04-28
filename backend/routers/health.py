from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from database import db_conn

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    with db_conn() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}