from __future__ import annotations

import logging
import re
from datetime import datetime

import requests

from config import (
    APP_PUBLIC_BASE_URL,
    XIAOLUBAN_LINK_BASE_URL,
    XIAOLUBAN_MESSAGE_URL,
    XIAOLUBAN_MESSAGE_SEND_TOKEN,
    NOTIFY_NODE_NAME_CN,
    XIAOLUBAN_GROUP_CHAT_ID,
)

logger = logging.getLogger(__name__)


def _is_send_response_ok(res: requests.Response) -> bool:
    if res.status_code != 200:
        return False
    try:
        data = res.json()
    except ValueError:
        return False
    if not isinstance(data, dict):
        return False
    status = data.get("status")
    if isinstance(status, str) and status.lower() == "ok":
        return True
    if data.get("success") is True:
        return True
    return False


def send_message(content: str, receiver: str, *, context: str = "") -> bool:
    receiver = str(receiver or "").strip()
    ctx_suffix = f" {context}" if context else ""
    if not receiver:
        logger.warning("xiaoluban send skipped: empty receiver%s", ctx_suffix)
        return False

    payload = {
        "content": content,
        "receiver": receiver,
        "auth": XIAOLUBAN_MESSAGE_SEND_TOKEN,
    }
    headers = {"Content-Type": "application/json"}
    try:
        res = requests.post(XIAOLUBAN_MESSAGE_URL, json=payload, headers=headers, timeout=15)
        if _is_send_response_ok(res):
            return True
        return False
    except requests.RequestException:
        return False
    except Exception as e:
        logger.warning(
            "xiaoluban send unexpected error: %s receiver=%s%s",
            e,
            receiver,
            ctx_suffix,
        )
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


def _xiaoluban_link_base() -> str:
    return str(APP_PUBLIC_BASE_URL or XIAOLUBAN_LINK_BASE_URL).strip().rstrip("/")


def build_ticket_link(ticket_no: str) -> str:
    path = f"/tickets/{str(ticket_no or '').strip()}"
    return f"{_xiaoluban_link_base()}{path}"


def format_ticket_notification_message(
    ticket_no: str,
    node_name_cn: str,
    start_date: str,
    severity: str,
    location: str,
    component: str,
    ticket_link: str,
    issue_desc: str = "",
    ecare_ticket_no: str = "",
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
        f"eCare单号：{ecare_ticket_no}",
    ]
    truncated_desc = _strip_html_and_truncate(issue_desc, 100)
    if truncated_desc:
        lines.append(f"问题描述：{truncated_desc}")
    lines.append("")
    lines.append(f"工单链接：{ticket_link}")
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
    ecare_ticket_no = str(problem_fill_values.get("ecare_ticket_no") or "").strip()
    issue_desc = str(problem_fill_values.get("issue_desc") or "").strip()
    ticket_link = build_ticket_link(ticket_no)
    content = format_ticket_notification_message(
        ticket_no, node_name_cn, start_date, severity, location, component, ticket_link,
        issue_desc, ecare_ticket_no=ecare_ticket_no,
    )
    return send_message(content, receiver)


def format_group_notification_message(
    ticket_no: str,
    start_date: str,
    location: str,
    biz_env: str,
    product_line: str,
    severity: str,
    component: str,
    ecare_ticket_no: str = "",
    issue_desc: str = "",
    ops_handler: str = "",
) -> str:
    truncated_desc = _strip_html_and_truncate(issue_desc, 100)
    lines = [
        f"【流程ID】{ticket_no}",
        f"【起始日期】{start_date}",
        f"【局点】{location}",
        f"【问题阶段】{biz_env}",
        f"【产品线】{product_line}",
        f"【问题严重性】{severity}",
        f"【问题组件】{component}",
        f"【eCare单号】{ecare_ticket_no}",
        f"【问题描述】{truncated_desc}",
        f"【问题确认人】{ops_handler}",
    ]
    return "\n".join(lines)


def send_group_notification(
    ticket_no: str,
    problem_fill_values: dict,
    ops_handler: str = "",
) -> bool:
    start_date = str(problem_fill_values.get("start_date") or "").strip()
    severity = str(problem_fill_values.get("severity") or "").strip()
    location = str(problem_fill_values.get("location") or "").strip()
    component = str(problem_fill_values.get("component") or "").strip()
    biz_env = str(problem_fill_values.get("biz_env") or "").strip()
    product_line = str(problem_fill_values.get("product_line") or "").strip()
    ecare_ticket_no = str(problem_fill_values.get("ecare_ticket_no") or "").strip()
    issue_desc = str(problem_fill_values.get("issue_desc") or "").strip()
    content = format_group_notification_message(
        ticket_no, start_date, location, biz_env, product_line, severity, component,
        ecare_ticket_no, issue_desc, ops_handler=str(ops_handler or "").strip(),
    )
    return send_message(content, XIAOLUBAN_GROUP_CHAT_ID)


def _format_leave_segment_display(iso_str: str) -> str:
    s = str(iso_str or "").strip()
    if not s:
        return "—"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return s
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def format_leave_segments_summary(segments: list[dict]) -> str:
    lines: list[str] = []
    for seg in segments:
        start = _format_leave_segment_display(str(seg.get("start_at") or ""))
        end = _format_leave_segment_display(str(seg.get("end_at") or ""))
        reason = str(seg.get("reason") or "").strip()
        line = f"{start} ~ {end}"
        if reason:
            line += f"，{reason}"
        lines.append(line)
    return "\n".join(lines) if lines else "—"


def build_leave_approval_link(app_id: int) -> str:
    path = f"/leave-application?id={int(app_id)}"
    return f"{_xiaoluban_link_base()}{path}"


def format_leave_notification_message(
    applicant_display: str,
    application_type: str,
    segments_summary: str,
    approval_link: str,
) -> str:
    lines = [
        "您有一条请假申请待办，请及时审批：",
        "",
        f"申请人：{applicant_display}",
        f"申请类型：{application_type}",
        "时间段及申请事由：",
        segments_summary,
        f"审批链接：{approval_link}",
    ]
    return "\n".join(lines)


def send_leave_application_notification(
    app_id: int,
    applicant_display: str,
    application_type: str,
    segments: list[dict],
    approver_account: str,
    cc_accounts: list[str],
) -> dict[str, bool]:
    segments_summary = format_leave_segments_summary(segments)
    approval_link = build_leave_approval_link(app_id)
    content = format_leave_notification_message(
        applicant_display,
        application_type,
        segments_summary,
        approval_link,
    )
    receivers: list[str] = []
    seen: set[str] = set()
    for acc in [str(approver_account or "").strip(), *(str(x or "").strip() for x in cc_accounts)]:
        if not acc or acc in seen:
            continue
        seen.add(acc)
        receivers.append(acc)
    return {acc: send_message(content, acc) for acc in receivers}


def format_leave_approval_result_message(
    application_no: str,
    approval_result: str,
    approver_display: str,
    comment: str,
    application_type: str,
    segments_summary: str,
    detail_link: str,
) -> str:
    lines = [
        "【请假审批结果】您的请假申请已审批",
        "",
        f"申请编号：{application_no}",
        f"审批结果：{approval_result}",
        f"审批人：{approver_display}",
    ]
    if str(comment or "").strip():
        lines.append(f"审批意见：{comment.strip()}")
    lines.extend([
        f"申请类型：{application_type}",
        "时间段及申请事由：",
        segments_summary,
        f"详情链接：{detail_link}",
    ])
    return "\n".join(lines)


def send_leave_approval_result_notification(
    app_id: int,
    application_no: str,
    approval_result: str,
    approver_display: str,
    comment: str,
    application_type: str,
    segments: list[dict],
    applicant_account: str,
) -> bool:
    receiver = str(applicant_account or "").strip()
    if not receiver:
        logger.warning(
            f"xiaoluban leave approval result notification: missing applicant account "
            f"for application {app_id}"
        )
        return False
    segments_summary = format_leave_segments_summary(segments)
    detail_link = build_leave_approval_link(app_id)
    content = format_leave_approval_result_message(
        application_no,
        approval_result,
        approver_display,
        comment,
        application_type,
        segments_summary,
        detail_link,
    )
    return send_message(content, receiver)


# ====================================================================
# 质量改进（QI）通知
# ====================================================================

def build_qi_link(qi_no: str) -> str:
    path = f"/qi/{str(qi_no or '').strip()}"
    return f"{_xiaoluban_link_base()}{path}"


def format_qi_notification_message(
    qi_no: str,
    title: str,
    category: str,
    priority: str,
    domain: str,
    module_feature: str,
    proposer: str,
    related_ticket_no: str,
    current_stage_cn: str,
    created_at_str: str,
    description: str,
    previous_handler: str,
    qi_link: str,
) -> str:
    desc_short = _strip_html_and_truncate(description, 100)
    lines = [
        "【质量改进通知】您有新的质量改进项待处理",
        "",
        f"改进编号：{qi_no}",
        f"改进标题：{title}",
        f"分类：{category}",
        f"优先级：{priority}",
        f"领域：{domain}",
        f"模块&特性：{module_feature}",
        f"提出人：{proposer}",
        f"关联运维系统单号：{related_ticket_no}",
        f"当前阶段：{current_stage_cn}",
        f"创建时间：{created_at_str}",
    ]
    if desc_short:
        lines.append(f"详细描述：{desc_short}")
    if previous_handler:
        lines.append(f"上一步处理人：{previous_handler}")
    lines.append("")
    lines.append(f"详情链接：{qi_link}")
    return "\n".join(lines)


def send_qi_notification(
    req: dict,
    next_handler_display: str,
    previous_handler_display: str = "",
    stage_cn: str = "",
) -> bool:
    receiver = extract_account_from_person_display(next_handler_display)
    if not receiver:
        logger.warning(
            f"xiaoluban QI notification: cannot extract account from handler "
            f"'{next_handler_display}' for QI {req.get('qi_no', '')}"
        )
        return False
    qi_no = str(req.get("qi_no") or "")
    created_at_raw = str(req.get("created_at") or "")
    created_at_str = created_at_raw[:10] if created_at_raw else ""
    qi_link = build_qi_link(qi_no)
    content = format_qi_notification_message(
        qi_no=qi_no,
        title=str(req.get("title") or ""),
        category=str(req.get("category") or ""),
        priority=str(req.get("priority") or ""),
        domain=str(req.get("domain") or ""),
        module_feature=str(req.get("module_feature") or ""),
        proposer=str(req.get("proposer") or ""),
        related_ticket_no=str(req.get("related_ticket_no") or ""),
        current_stage_cn=stage_cn or str(req.get("current_stage") or ""),
        created_at_str=created_at_str,
        description=str(req.get("description") or ""),
        previous_handler=previous_handler_display,
        qi_link=qi_link,
    )
    return send_message(content, receiver)