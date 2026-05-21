from __future__ import annotations

import logging
import re

import requests

from config import XIAOLUBAN_MESSAGE_URL, XIAOLUBAN_MESSAGE_SEND_TOKEN, NOTIFY_NODE_NAME_CN

logger = logging.getLogger(__name__)


def send_message(content: str, receiver: str) -> bool:
    payload = {
        "content": content,
        "receiver": receiver,
        "auth": XIAOLUBAN_MESSAGE_SEND_TOKEN,
    }
    headers = {"Content-Type": "application/json"}
    try:
        res = requests.post(XIAOLUBAN_MESSAGE_URL, json=payload, headers=headers)
        if res.status_code == 200:
            try:
                if res.json().get("status") == "ok":
                    return True
            except ValueError:
                pass
        return False
    except Exception as e:
        logger.warning(f"xiaoluban message unexpected error: {e}")
        return False


_ACCOUNT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]+$")


def extract_account_from_person_display(person_display: str) -> str:
    s = str(person_display or "").strip()
    if not s:
        return ""
    parts = s.rsplit(" ", 1)
    if len(parts) == 2 and _ACCOUNT_RE.match(parts[1]):
        return parts[1]
    if _ACCOUNT_RE.match(s):
        return s
    return ""


def format_ticket_notification_message(
    ticket_no: str,
    node_name_cn: str,
    start_date: str,
    severity: str,
    location: str,
    component: str,
) -> str:
    lines = [
        "【工单通知】您有新的工单待处理",
        "",
        f"工单号：{ticket_no}",
        f"当前节点：{node_name_cn}",
        f"起始日期：{start_date}",
        f"问题严重性：{severity}",
        f"局点：{location}",
        f"问题组件：{component}",
        "",
        "请登录系统及时处理",
    ]
    return "\n".join(lines)


def send_ticket_notification(
    ticket_no: str,
    next_node_key: str,
    next_handler: str,
    problem_fill_values: dict,
) -> bool:
    node_name_cn = NOTIFY_NODE_NAME_CN.get(next_node_key, next_node_key)
    receiver = extract_account_from_person_display(next_handler)
    if not receiver:
        logger.warning(
            f"xiaoluban notification: cannot extract account from handler "
            f"'{next_handler}' for ticket {ticket_no}"
        )
        return False
    start_date = str(problem_fill_values.get("start_date") or "").strip()
    severity = str(problem_fill_values.get("severity") or "").strip()
    location = str(problem_fill_values.get("location") or "").strip()
    component = str(problem_fill_values.get("component") or "").strip()
    content = format_ticket_notification_message(
        ticket_no, node_name_cn, start_date, severity, location, component
    )
    return send_message(content, receiver)