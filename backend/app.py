from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv()

import httpx
import psycopg
from psycopg.errors import UniqueViolation, UndefinedTable
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from psycopg.rows import dict_row

from config import (
    SCHEMA_NODE_KEY,
    SCHEMA_TEMPLATE_CODE,
    DIRECT_CLOSE_HANDLE_MODES,
    HANDLE_MODE_ROUTE,
    HOME_PERSONAL_SLA_STAGE_KEYS,
    HOME_PERSONAL_STAGE_NAME_BY_KEY,
    HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS,
    DUTY_ROTATION_ROSTER_KINDS,
    _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE,
    _ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED,
    _COMPONENT_TO_KIND,
    _DUTY_STATUS_ON,
    _DUTY_EXTRAS_SCHEMA_HINT,
    _HOLIDAY_SCHEMA_HINT,
    _LEAVE_SCHEMA_HINT,
    _DUTY_FIELD_SCHEMA_HINT,
    _VERSION_SCHEMA_HINT,
    _GROUP_TEMPLATE_SCHEMA_HINT,
    _GROUP_TEMPLATE_KIND_ORDER,
    _GROUP_TEMPLATE_DEFAULTS,
    _DUTY_FIELD_MAX_DEPTH,
    _DUTY_FIELD_MAX_NODES,
    _DUTY_FIELD_OPTION_SET_CODES,
    _VERSION_BASELINE_OPTION_SET_CODES,
    _DUTY_FIELD_PATH_SEP,
    _LEAVE_APP_NO_LOCK,
    _REQUIREMENT_NO_LOCK,
    _REQUIREMENT_SCHEMA_HINT,
    REQUIREMENT_STATUSES,
    REQUIREMENT_CATEGORIES,
    REQUIREMENT_VALUES,
    REQUIREMENT_STATUS_FORWARD,
    REQUIREMENT_STATUS_BACKWARD,
    LEAVE_APPLICATION_TYPES,
    PERSON_VALUE_FIELD_KEYS,
    _PERSON_ACCOUNT_SPACE,
    _PERSON_ACCOUNT_PLUS,
)
from database import db_conn, DB_DSN
from utils import (
    _YW_TICKET_NO_RE,
    _YW_ADVISORY_LOCK_KEY1,
    _YW_ADVISORY_LOCK_KEY2,
    _CHINA_TZ,
    allocate_yw_ticket_no as _allocate_yw_ticket_no,
    dedupe_preserve_str as _dedupe_preserve_str,
    canonical_person_display as _canonical_person_display,
    field_visible as _base_field_visible,
    matches_required_if as _base_matches_required_if,
    optional_when_all_matches as _base_optional_when_all_matches,
    optional_when_any_matches as _base_optional_when_any_matches,
    effective_required as _base_effective_required,
    validate_one as _base_validate_one,
    duty_month_bounds as _duty_month_bounds,
    parse_last_accept_at as _parse_last_accept_at,
    parse_iso_dt as _parse_iso_dt,
    parse_ymd as _parse_ymd,
    to_utc_start as _to_utc_start,
)
from models import (
    SubmitPayload,
    PermissionPolicyItem,
    PermissionPolicyBulkPayload,
    UserAccountItem,
    UserAccountBulkPayload,
    DutyCalendarPutPayload,
    DutyRotationPutPayload,
    DutySiteOnCallPutPayload,
    DutyRlOnCallPutPayload,
    HolidayConfigPutPayload,
    LeaveTimeSegmentIn,
    LeaveApplicationCreatePayload,
    LeaveActionPayload,
    LeaveApproverWhitelistPutPayload,
    RequirementCreatePayload,
    RequirementPatchPayload,
    DutyFieldNodeInput,
    DutyFieldTreePutPayload,
    BaselineVersionCreatePayload,
    BaselineVersionPatchPayload,
    HotfixVersionCreatePayload,
    HotfixVersionPatchPayload,
    GroupTemplateItemIn,
    GroupTemplatePutPayload,
    AiConversationCreatePayload,
    AiConversationPatchPayload,
    AiChatPayload,
    AiQuickTemplateCreatePayload,
    AiQuickTemplatePatchPayload,
    LlmConfigPutPayload,
    AiUserLlmConfigPutPayload,
    LlmTestPayload,
)
from routers import health_router, permission_router, user_router, duty_router, leave_router, params_router, requirement_router, ai_router, nodes_router, tickets_router, home_router

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
