from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List

import requests

from config import (
    WELINK_APP_ID,
    WELINK_APP_SECRET,
    WELINK_HIS_APP_ID,
    WELINK_HIS_STATIC_TOKEN,
    WELINK_DYNAMIC_TOKEN_URL,
    WELINK_CREATE_GROUP_URL,
    WELINK_CARD_MESSAGE_URL,
)

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 10


@dataclass
class WelinkGroupCreateRequest:
    group_name: str = ""
    manifesto: str = ""
    invite_list: List[str] = field(default_factory=list)
    message: str = ""
    group_desc: str = ""
    title: str = ""


_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _format_date() -> str:
    dt = datetime.now(timezone.utc)
    day_name = _DAYS[dt.weekday()]
    month_name = _MONTHS[dt.month - 1]
    return f"{day_name} {dt.day}, {month_name} {dt.year} {dt.hour:02d}:{dt.minute:02d}:{dt.second:02d} GMT"


def _compute_esdk_sign(date: str) -> str:
    sign = f"{WELINK_APP_ID}SEQ{WELINK_APP_SECRET}SEQ{date}"
    sign_hash = hashlib.sha256(sign.encode("utf-8")).hexdigest()
    return base64.b64encode(sign_hash.encode("utf-8")).decode("utf-8")


def _get_dynamic_token() -> str:
    logger.debug("Requesting Welink dynamic token")
    requests_body = {
        "appId": WELINK_HIS_APP_ID,
        "credential": base64.b64encode(
            WELINK_HIS_STATIC_TOKEN.encode("utf-8")
        ).decode("utf-8"),
    }
    try:
        response = requests.post(
            WELINK_DYNAMIC_TOKEN_URL, json=requests_body,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        res = response.json()
        token = res.get("result", "")
        if not token:
            logger.error(f"Dynamic token response missing result: {res}")
            raise RuntimeError("Welink dynamic token is empty or missing")
        logger.debug("Welink dynamic token acquired")
        return token
    except RuntimeError:
        raise
    except Exception as e:
        logger.error(f"Failed to get Welink dynamic token: {e}")
        raise RuntimeError(f"Failed to get Welink dynamic token: {e}") from e


def _build_request_headers() -> dict:
    date = _format_date()
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": _get_dynamic_token(),
        "requestdate": date,
        "esdkSign": _compute_esdk_sign(date),
    }


def _execute_create(
    group_name: str,
    owner: str,
    invite_list: List[str],
    manifesto: str,
    group_desc: str,
) -> str:
    logger.info(f"Creating Welink group: name={group_name}, owner={owner}")
    request_body = {
        "appId": WELINK_APP_ID,
        "groupName": group_name,
        "owner": owner,
        "groupType": "0",
        "isSync": "1",
        "inviteList": invite_list,
        "manifesto": manifesto,
        "groupDesc": group_desc,
    }
    headers = _build_request_headers()

    try:
        response = requests.post(
            WELINK_CREATE_GROUP_URL,
            headers=headers,
            json=request_body,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        res = response.json()
        if res.get("resultCode") != "0":
            logger.error(f"Welink create group API returned error: {res}")
            raise RuntimeError(f"Create group failed: {res.get('resultCode', '')}")
        result = res.get("result")
        if isinstance(result, str):
            parsed = json.loads(result)
            group_id = parsed.get("groupId", "")
        elif isinstance(result, dict):
            group_id = result.get("groupId", "")
        else:
            logger.error(f"Welink create group result is unexpected type: {type(result)}, value: {result}")
            raise RuntimeError(f"Create group failed: unexpected result format")
        if not group_id:
            logger.error(f"Welink create group result missing groupId: {res}")
            raise RuntimeError("Create group failed: groupId is empty")
        logger.info(f"Welink group created: groupId={group_id}")
        return group_id
    except RuntimeError:
        raise
    except Exception as e:
        logger.error(f"Error creating Welink group: {e}")
        raise RuntimeError(f"Create group failed: {e}") from e


def _set_join_flag(group_id: str) -> None:
    logger.info(f"Setting Welink join flag for group: {group_id}")
    request_body = {
        "groupID": group_id,
        "appID": WELINK_APP_ID,
        "joinFlag": "0",
    }
    headers = _build_request_headers()

    try:
        response = requests.put(
            WELINK_CREATE_GROUP_URL,
            json=request_body,
            headers=headers,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        res = response.json()
        if res.get("resultCode") != "0":
            logger.error(f"Set join flag failed for group {group_id}, response: {res}")
        else:
            logger.info(f"Join flag set successfully for group: {group_id}")
    except Exception as e:
        logger.error(f"Set join flag failed for group {group_id}, exception: {e}")


def _send_card(group_id: str, card_msg: str, title: str) -> None:
    logger.info(f"Sending Welink card message to group: {group_id}, title={title}")
    card = {
        "linkUrl": "",
        "title": title if title else "",
        "digests": card_msg,
        "enableForward": "true",
    }
    request_body = {
        "appID": WELINK_APP_ID,
        "groupID": group_id,
        "card": card,
    }
    headers = _build_request_headers()

    try:
        response = requests.post(
            WELINK_CARD_MESSAGE_URL,
            json=request_body,
            headers=headers,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        res = response.json()
        if res.get("resultCode") != "0":
            logger.error(f"Send card message failed for group {group_id}, response: {res}")
        else:
            logger.info(f"Card message sent successfully to group: {group_id}")
    except Exception as e:
        logger.error(f"Send card message failed for group {group_id}, exception: {e}")


def create_group_and_send_message(
    req: WelinkGroupCreateRequest,
    owner: str,
) -> str:
    logger.info(f"Welink create_group_and_send_message: group_name={req.group_name}, owner={owner}")
    group_id = _execute_create(
        group_name=req.group_name,
        owner=owner,
        invite_list=req.invite_list,
        manifesto=req.manifesto,
        group_desc=req.group_desc,
    )
    _set_join_flag(group_id)
    _send_card(group_id, req.message, req.title)
    logger.info(f"Welink group flow completed: groupId={group_id}")
    return group_id