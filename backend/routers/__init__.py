from __future__ import annotations

from routers.health import router as health_router
from routers.auth import router as auth_router
from routers.permission import router as permission_router
from routers.user import router as user_router
from routers.duty import router as duty_router
from routers.leave import router as leave_router
from routers.params import router as params_router
from routers.requirement import router as requirement_router
from routers.qi import router as qi_router
from routers.major_problem import router as major_problem_router
from routers.major_issue import router as major_issue_router
from routers.site_profile import router as site_profile_router
from routers.ai import router as ai_router
from routers.nodes import router as nodes_router
from routers.tickets import router as tickets_router
from routers.home import router as home_router
from routers.richtext_media import router as richtext_media_router
from routers.oncall_eva import router as oncall_eva_router
from routers.monthly_report import router as monthly_report_router
from routers.xiaoluban import router as xiaoluban_router
from routers.welink import router as welink_router
from routers.stats_charts import router as stats_charts_router
from routers.ai_export import router as ai_export_router
from routers.ops_tool_plaza import router as ops_tool_plaza_router
from routers.ticket_assistant import router as ticket_assistant_router

__all__ = [
    "health_router",
    "auth_router",
    "permission_router",
    "user_router",
    "duty_router",
    "leave_router",
    "params_router",
    "requirement_router",
    "qi_router",
    "major_problem_router",
    "major_issue_router",
    "site_profile_router",
    "ai_router",
    "nodes_router",
    "tickets_router",
    "home_router",
    "richtext_media_router",
    "oncall_eva_router",
    "monthly_report_router",
    "xiaoluban_router",
    "welink_router",
    "stats_charts_router",
    "ai_export_router",
    "ops_tool_plaza_router",
    "ticket_assistant_router",
]