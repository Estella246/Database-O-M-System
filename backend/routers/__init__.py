from __future__ import annotations

from routers.health import router as health_router
from routers.auth import router as auth_router
from routers.permission import router as permission_router
from routers.user import router as user_router
from routers.duty import router as duty_router
from routers.leave import router as leave_router
from routers.params import router as params_router
from routers.requirement import router as requirement_router
from routers.ai import router as ai_router
from routers.nodes import router as nodes_router
from routers.tickets import router as tickets_router
from routers.home import router as home_router
from routers.skill import router as skill_router
from routers.upload import router as upload_router
from routers.richtext_media import router as richtext_media_router

__all__ = [
    "health_router",
    "auth_router",
    "permission_router",
    "user_router",
    "duty_router",
    "leave_router",
    "params_router",
    "requirement_router",
    "ai_router",
    "nodes_router",
    "tickets_router",
    "home_router",
    "skill_router",
    "upload_router",
    "richtext_media_router",
]