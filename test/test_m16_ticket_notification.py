import pytest
from unittest.mock import patch, MagicMock

from utils.xiaoluban_message import (
    send_message,
    extract_account_from_person_display,
    format_ticket_notification_message,
    send_ticket_notification,
    format_group_notification_message,
    send_group_notification,
    format_leave_segments_summary,
    format_leave_notification_message,
    build_leave_approval_link,
    build_ticket_link,
    send_leave_application_notification,
    format_leave_approval_result_message,
    send_leave_approval_result_notification,
)
from config import XIAOLUBAN_GROUP_CHAT_ID


class TestExtractAccountFromPersonDisplay:
    def test_canonical_format(self):
        assert extract_account_from_person_display("李潇雨 l30030745") == "l30030745"

    def test_pure_account(self):
        assert extract_account_from_person_display("l30030745") == "l30030745"

    def test_empty_string(self):
        assert extract_account_from_person_display("") == ""

    def test_name_only(self):
        assert extract_account_from_person_display("李潇雨") == ""

    def test_multi_word_name(self):
        assert extract_account_from_person_display("张 三 l30030746") == "l30030746"

    def test_none_input(self):
        assert extract_account_from_person_display(None) == ""

    def test_account_with_dots_and_underscores(self):
        assert extract_account_from_person_display("某人 a.b_c123") == "a.b_c123"


class TestFormatTicketNotificationMessage:
    def test_complete_fields(self):
        msg = format_ticket_notification_message(
            ticket_no="YW20260521001",
            node_name_cn="问题审核",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            component="内核问题",
            ticket_link="https://ops.example.com/tickets/YW20260521001",
            issue_desc="数据库连接超时",
        )
        assert "YW20260521001" in msg
        assert "问题审核" in msg
        assert "2026-05-21" in msg
        assert "严重" in msg
        assert "华北-北京" in msg
        assert "内核问题" in msg
        assert "问题描述：数据库连接超时" in msg
        assert "工单链接：https://ops.example.com/tickets/YW20260521001" in msg

    def test_empty_fields(self):
        msg = format_ticket_notification_message(
            ticket_no="YW20260521001",
            node_name_cn="运维分析",
            start_date="",
            severity="",
            location="",
            component="",
            ticket_link="/tickets/YW20260521001",
            issue_desc="",
        )
        assert "YW20260521001" in msg
        assert "运维分析" in msg
        assert "工单链接：/tickets/YW20260521001" in msg
        assert "问题描述" not in msg

    def test_truncate_long_issue_desc(self):
        long_desc = "A" * 150
        msg = format_ticket_notification_message(
            ticket_no="YW20260521001",
            node_name_cn="问题审核",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            component="内核问题",
            ticket_link="/tickets/YW20260521001",
            issue_desc=long_desc,
        )
        desc_line = [l for l in msg.split("\n") if l.startswith("问题描述：")][0]
        desc_value = desc_line.replace("问题描述：", "")
        assert len(desc_value) == 103  # 100 chars + "..."

    def test_html_tags_stripped_from_issue_desc(self):
        msg = format_ticket_notification_message(
            ticket_no="YW20260521001",
            node_name_cn="问题审核",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            component="内核问题",
            ticket_link="/tickets/YW20260521001",
            issue_desc="<p>数据库<strong>异常</strong>中断</p>",
        )
        assert "<p>" not in msg
        assert "<strong>" not in msg
        assert "数据库 异常 中断" in msg


class TestBuildTicketLink:
    def test_without_base_url(self):
        with patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", ""):
            assert build_ticket_link("YW20260521001") == "/tickets/YW20260521001"

    def test_with_base_url(self):
        with patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", "https://ops.example.com/"):
            assert build_ticket_link("YW20260521001") == "https://ops.example.com/tickets/YW20260521001"


class TestSendTicketNotification:
    def test_notification_sent_successfully(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            result = send_ticket_notification(
                ticket_no="YW20260521001",
                next_node_key="problem_review",
                next_handler="李潇雨 l30030745",
                problem_fill_values={
                    "start_date": "2026-05-21",
                    "severity": "严重",
                    "location": "华北-北京",
                    "component": "内核问题",
                    "issue_desc": "数据库连接超时",
                },
            )
            assert result is True
            assert captured_payload["receiver"] == "l30030745"
            assert "YW20260521001" in captured_payload["content"]
            assert "问题审核" in captured_payload["content"]
            assert "数据库连接超时" in captured_payload["content"]
            assert "/tickets/YW20260521001" in captured_payload["content"]

    def test_notification_skipped_when_no_account(self):
        with patch("utils.xiaoluban_message.requests.post") as mock_post:
            result = send_ticket_notification(
                ticket_no="YW20260521001",
                next_node_key="problem_review",
                next_handler="李潇雨",
                problem_fill_values={},
            )
            assert result is False
            mock_post.assert_not_called()

    def test_notification_failure_does_not_block(self):
        with patch("utils.xiaoluban_message.requests.post", side_effect=Exception("network error")):
            result = send_ticket_notification(
                ticket_no="YW20260521001",
                next_node_key="ops_analysis",
                next_handler="李长军 l30030800",
                problem_fill_values={
                    "start_date": "2026-05-21",
                    "severity": "一般",
                    "location": "华南-广州",
                    "component": "管控问题",
                },
            )
            assert result is False

    def test_node_name_from_mapping(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            send_ticket_notification(
                ticket_no="YW20260521001",
                next_node_key="dev_analysis",
                next_handler="某人 l30030999",
                problem_fill_values={},
            )
            assert "开发分析" in captured_payload["content"]

    def test_unknown_node_key_uses_key_as_name(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            send_ticket_notification(
                ticket_no="YW20260521001",
                next_node_key="unknown_node",
                next_handler="某人 l30030999",
                problem_fill_values={},
            )
            assert "unknown_node" in captured_payload["content"]


class TestFormatGroupNotificationMessage:
    def test_complete_fields_with_ecare_and_desc(self):
        msg = format_group_notification_message(
            ticket_no="YW20260521001",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            biz_env="生产环境",
            product_line="公有云",
            component="内核问题",
            ecare_ticket_no="ECARE-001",
            issue_desc="数据库连接超时",
        )
        assert msg == "\n".join([
            "流程ID：YW20260521001",
            "起始日期：2026-05-21",
            "局点：华北-北京",
            "问题阶段：生产环境",
            "产品线：公有云",
            "问题严重性：严重",
            "问题组件：内核问题",
            "eCare单号：ECARE-001",
            "问题描述：数据库连接超时",
        ])

    def test_truncate_long_issue_desc(self):
        long_desc = "A" * 150
        msg = format_group_notification_message(
            ticket_no="YW20260521001",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            biz_env="生产环境",
            product_line="公有云",
            component="内核问题",
            ecare_ticket_no="ECARE-001",
            issue_desc=long_desc,
        )
        desc_line = [l for l in msg.split("\n") if l.startswith("问题描述：")][0]
        desc_value = desc_line.replace("问题描述：", "")
        assert len(desc_value) == 103  # 100 chars + "..."

    def test_html_tags_stripped_from_issue_desc(self):
        msg = format_group_notification_message(
            ticket_no="YW20260521001",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            biz_env="生产环境",
            product_line="公有云",
            component="内核问题",
            ecare_ticket_no="ECARE-001",
            issue_desc="<p>数据库<strong>异常</strong>中断</p>",
        )
        assert "<p>" not in msg
        assert "<strong>" not in msg
        assert "数据库 异常 中断" in msg

    def test_empty_optional_fields_still_shown(self):
        msg = format_group_notification_message(
            ticket_no="YW20260521001",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            biz_env="",
            product_line="",
            component="内核问题",
            ecare_ticket_no="",
            issue_desc="",
        )
        assert "流程ID：YW20260521001" in msg
        assert "问题阶段：" in msg
        assert "产品线：" in msg
        assert "eCare单号：" in msg
        assert "问题描述：" in msg
        assert "工单链接" not in msg
        assert "当前节点" not in msg


class TestSendGroupNotification:
    def test_group_notification_sent_successfully(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            result = send_group_notification(
                ticket_no="YW20260521001",
                problem_fill_values={
                    "start_date": "2026-05-21",
                    "severity": "严重",
                    "location": "华北-北京",
                    "biz_env": "生产环境",
                    "product_line": "公有云",
                    "component": "内核问题",
                    "ecare_ticket_no": "ECARE-001",
                    "issue_desc": "数据库异常",
                },
            )
            assert result is True
            assert captured_payload["receiver"] == XIAOLUBAN_GROUP_CHAT_ID
            assert "流程ID：YW20260521001" in captured_payload["content"]
            assert "问题阶段：生产环境" in captured_payload["content"]
            assert "产品线：公有云" in captured_payload["content"]
            assert "ECARE-001" in captured_payload["content"]
            assert "数据库异常" in captured_payload["content"]

    def test_group_notification_failure_does_not_block(self):
        with patch("utils.xiaoluban_message.requests.post", side_effect=Exception("network error")):
            result = send_group_notification(
                ticket_no="YW20260521001",
                problem_fill_values={},
            )
            assert result is False

    def test_group_notification_uses_config_chat_id(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            send_group_notification(
                ticket_no="YW20260521001",
                problem_fill_values={},
            )
            assert captured_payload["receiver"] == XIAOLUBAN_GROUP_CHAT_ID

    def test_group_notification_with_missing_optional_fields(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            result = send_group_notification(
                ticket_no="YW20260521001",
                problem_fill_values={
                    "start_date": "2026-05-21",
                    "severity": "一般",
                },
            )
            assert result is True
            assert "流程ID：YW20260521001" in captured_payload["content"]
            assert "eCare单号：" in captured_payload["content"]
            assert "问题描述：" in captured_payload["content"]


class TestLeaveNotificationMessage:
    def test_format_leave_segments_summary(self):
        summary = format_leave_segments_summary([
            {
                "start_at": "2026-04-10T09:00:00+08:00",
                "end_at": "2026-04-10T18:00:00+08:00",
                "reason": "功能测试请假",
            }
        ])
        assert "2026-04-10" in summary
        assert "功能测试请假" in summary
        assert "~" in summary

    def test_format_leave_notification_message(self):
        msg = format_leave_notification_message(
            applicant_display="测试用户 test_user01",
            application_type="请假/调休",
            segments_summary="2026-04-10 09:00:00 ~ 2026-04-10 18:00:00，功能测试请假",
            approval_link="https://ops.example.com/leave-application?id=12",
        )
        assert "您有一条请假申请待办，请及时审批" in msg
        assert "申请人：测试用户 test_user01" in msg
        assert "申请类型：请假/调休" in msg
        assert "时间段及申请事由：" in msg
        assert "审批链接：https://ops.example.com/leave-application?id=12" in msg

    def test_build_leave_approval_link_without_base_url(self):
        with patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", ""):
            assert build_leave_approval_link(7) == "/leave-application?id=7"

    def test_build_leave_approval_link_with_base_url(self):
        with patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", "https://ops.example.com/"):
            assert build_leave_approval_link(7) == "https://ops.example.com/leave-application?id=7"

    def test_send_leave_notification_to_approver_and_cc(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured: list[dict] = []

        def capture_post(url, json=None, headers=None, **kwargs):
            captured.append(json)
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            results = send_leave_application_notification(
                app_id=12,
                applicant_display="测试用户 test_user01",
                application_type="请假/调休",
                segments=[
                    {
                        "start_at": "2026-04-10T09:00:00+08:00",
                        "end_at": "2026-04-10T18:00:00+08:00",
                        "reason": "功能测试请假",
                    }
                ],
                approver_account="test_admin",
                cc_accounts=["test_user02", "test_admin"],
            )
        assert results == {"test_admin": True, "test_user02": True}
        assert len(captured) == 2
        receivers = {item["receiver"] for item in captured}
        assert receivers == {"test_admin", "test_user02"}
        assert all("您有一条请假申请待办" in item["content"] for item in captured)
        assert all("/leave-application?id=12" in item["content"] for item in captured)

    def test_format_leave_approval_result_message(self):
        msg = format_leave_approval_result_message(
            application_no="QJ20260410001",
            approval_result="同意申请",
            approver_display="管理员 test_admin",
            comment="",
            application_type="请假/调休",
            segments_summary="2026-04-10 09:00:00 ~ 2026-04-10 18:00:00，功能测试请假",
            detail_link="https://ops.example.com/leave-application?id=12",
        )
        assert "【请假审批结果】您的请假申请已审批" in msg
        assert "申请编号：QJ20260410001" in msg
        assert "审批结果：同意申请" in msg
        assert "审批人：管理员 test_admin" in msg
        assert "审批意见：" not in msg
        assert "详情链接：https://ops.example.com/leave-application?id=12" in msg

        msg_reject = format_leave_approval_result_message(
            application_no="QJ20260410002",
            approval_result="拒绝申请",
            approver_display="管理员 test_admin",
            comment="时段冲突",
            application_type="请假/调休",
            segments_summary="2026-04-10 09:00:00 ~ 2026-04-10 18:00:00",
            detail_link="/leave-application?id=13",
        )
        assert "审批结果：拒绝申请" in msg_reject
        assert "审批意见：时段冲突" in msg_reject

    def test_send_leave_approval_result_notification(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured: list[dict] = []

        def capture_post(url, json=None, headers=None, **kwargs):
            captured.append(json)
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            ok = send_leave_approval_result_notification(
                app_id=12,
                application_no="QJ20260410001",
                approval_result="同意申请",
                approver_display="管理员 test_admin",
                comment="",
                application_type="请假/调休",
                segments=[
                    {
                        "start_at": "2026-04-10T09:00:00+08:00",
                        "end_at": "2026-04-10T18:00:00+08:00",
                        "reason": "功能测试请假",
                    }
                ],
                applicant_account="test_user01",
            )
        assert ok is True
        assert len(captured) == 1
        assert captured[0]["receiver"] == "test_user01"
        assert "【请假审批结果】" in captured[0]["content"]
        assert "/leave-application?id=12" in captured[0]["content"]