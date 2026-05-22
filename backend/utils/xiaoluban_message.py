from __future__ import annotations

import logging
import re

import requests

from config import XIAOLUBAN_MESSAGE_URL, XIAOLUBAN_MESSAGE_SEND_TOKEN, NOTIFY_NODE_NAME_CN, XIAOLUBAN_GROUP_CHAT_ID

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


def _strip_html_and_truncate(text: str, max_len: int = 100) -> str:
    t = _HTML_TAG_RE.sub(" ", text or "")
    t = " ".join(t.split()).strip()
    if len(t) > max_len:
        return t[:max_len] + "..."
    return t


_ACCOUNT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]+$")
_HTML_TAG_RE = re.compile(r"<[^>]+>")


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


def format_group_notification_message(
    ticket_no: str,
    node_name_cn: str,
    start_date: str,
    severity: str,
    location: str,
    component: str,
    ecare_ticket_no: str = "",
    issue_desc: str = "",
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
    ]
    if ecare_ticket_no:
        lines.append(f"eCare单号：{ecare_ticket_no}")
    truncated_desc = _strip_html_and_truncate(issue_desc, 100)
    if truncated_desc:
        lines.append(f"问题描述：{truncated_desc}")
    lines.append("")
    lines.append("请登录系统及时处理")
    return "\n".join(lines)


def send_group_notification(
    ticket_no: str,
    next_node_key: str,
    problem_fill_values: dict,
) -> bool:
    node_name_cn = NOTIFY_NODE_NAME_CN.get(next_node_key, next_node_key)
    start_date = str(problem_fill_values.get("start_date") or "").strip()
    severity = str(problem_fill_values.get("severity") or "").strip()
    location = str(problem_fill_values.get("location") or "").strip()
    component = str(problem_fill_values.get("component") or "").strip()
    ecare_ticket_no = str(problem_fill_values.get("ecare_ticket_no") or "").strip()
    issue_desc = str(problem_fill_values.get("issue_desc") or "").strip()
    content = format_group_notification_message(
        ticket_no, node_name_cn, start_date, severity, location, component,
        ecare_ticket_no, issue_desc,
    )
    return send_message(content, XIAOLUBAN_GROUP_CHAT_ID)