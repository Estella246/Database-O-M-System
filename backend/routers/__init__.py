from __future__ import annotations

from routers.health import router as health_router
from routers.permission import router as permission_router
from routers.user import router as user_router
from routers.duty import router as duty_router

__all__ = [
    "health_router",
    "permission_router",
    "user_router",
    "duty_router",
]