from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config import _PERSON_ACCOUNT_SPACE
from database import db_conn
from utils.WelinkHelper import WelinkGroupCreateRequest, create_group_and_send_message
from utils.api_guard import require_whitelist
from utils.logging_config import operator_log_label
from utils.operator_auth import resolve_operator_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/welink", tags=["welink"])

_WAR_ROOM_TITLE = "WarRoom已拉起，请按规范刷新进展"
_GENERAL_TITLE = "请按规范刷新进展"
_WAR_ROOM_KINDS = frozenset({"major", "urgent", "itr"})

_ACCOUNT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]+$")


def _parse_invite_list(raw_members: str) -> list[str]:
    accounts: list[str] = []
    for segment in (raw_members or "").split(","):
        segment = segment.strip()
        if not segment:
            continue
        match = _PERSON_ACCOUNT_SPACE.match(segment)
        if match:
            accounts.append(match.group(1))
        elif _ACCOUNT_RE.match(segment):
            accounts.append(segment)
    return accounts


def _resolve_title(problem_kind: str) -> str:
    if problem_kind in _WAR_ROOM_KINDS:
        return _WAR_ROOM_TITLE
    return _GENERAL_TITLE


class WelinkCreateGroupRequest(BaseModel):
    problem_kind: str
    group_name: str
    manifesto: str
    group_members: str
    message: str
    operator_id: str


@router.post("/create-group")
async def api_create_group(req: WelinkCreateGroupRequest, request: Request) -> dict:
    owner = resolve_operator_id(request, req.operator_id)
    if not owner:
        raise HTTPException(status_code=400, detail="无法获取群主账号")
    with db_conn() as conn:
        require_whitelist(conn, owner, "workbench_group", "无拉群权限")

    invite_list = _parse_invite_list(req.group_members)
    title = _resolve_title(req.problem_kind)

    welink_req = WelinkGroupCreateRequest(
        group_name=req.group_name,
        manifesto=req.manifesto,
        invite_list=invite_list,
        message=req.message,
        group_desc="",
        title=title,
    )

    try:
        group_id = create_group_and_send_message(welink_req, owner)
        logger.info(
            "Welink group created via API: group_id=%s, kind=%s, operator=%s",
            group_id,
            req.problem_kind,
            operator_log_label(owner),
        )
        return {"ok": True, "group_id": group_id}
    except RuntimeError as e:
        logger.error(f"Welink create group failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e