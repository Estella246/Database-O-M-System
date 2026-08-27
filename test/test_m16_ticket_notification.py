import pytest
from unittest.mock import patch, MagicMock

from utils.xiaoluban_message import (
    send_message,
    extract_account_from_person_display,
    format_ticket_notification_message,
    send_ticket_notification,
    format_group_notification_message,
    send_group_notification,
    format_ops_closure_creator_notification_message,
    send_ops_closure_creator_notification,
    format_leave_segments_summary,
    format_leave_notification_message,
    build_leave_approval_link,
    build_ticket_link,
    send_leave_application_notification,
    format_leave_approval_result_message,
    send_leave_approval_result_notification,
)
from config import XIAOLUBAN_GROUP_CHAT_ID, XIAOLUBAN_LINK_BASE_URL

_DEFAULT_XIAOLUBAN_LINK_BASE = XIAOLUBAN_LINK_BASE_URL


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
        assert "eCare单号：" in msg
        assert "问题描述：数据库连接超时" in msg
        assert "工单链接：https://ops.example.com/tickets/YW20260521001" in msg

    def test_includes_ecare_ticket_no(self):
        msg = format_ticket_notification_message(
            ticket_no="YW20260521001",
            node_name_cn="问题审核",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            component="内核问题",
            ticket_link="https://ops.example.com/tickets/YW20260521001",
            issue_desc="数据库连接超时",
            ecare_ticket_no="ECARE-001",
        )
        assert "eCare单号：ECARE-001" in msg
        lines = msg.split("\n")
        assert lines.index("eCare单号：ECARE-001") == lines.index("问题组件：内核问题") + 1

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
        assert "eCare单号：" in msg
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
    def test_default_base_url(self):
        with patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", ""):
            assert (
                build_ticket_link("YW20260521001")
                == f"{_DEFAULT_XIAOLUBAN_LINK_BASE}/tickets/YW20260521001"
            )

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
                    "ecare_ticket_no": "ECARE-001",
                    "issue_desc": "数据库连接超时",
                },
            )
            assert result is True
            assert captured_payload["receiver"] == "l30030745"
            assert "YW20260521001" in captured_payload["content"]
            assert "问题审核" in captured_payload["content"]
            assert "eCare单号：ECARE-001" in captured_payload["content"]
            assert "数据库连接超时" in captured_payload["content"]
            assert (
                f"{_DEFAULT_XIAOLUBAN_LINK_BASE}/tickets/YW20260521001"
                in captured_payload["content"]
            )

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


class TestOpsClosureCreatorNotificationMessage:
    def test_format_message_contains_text_and_full_link(self):
        msg = format_ops_closure_creator_notification_message(
            "https://ops.example.com/tickets/YW20260521001"
        )
        assert msg == (
            "此问题已闭环，请提单人尽快与运维侧对齐，如实填写改进建议\n"
            "问题链接：https://ops.example.com/tickets/YW20260521001"
        )

    def test_send_uses_creator_account_and_ticket_link(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            result = send_ops_closure_creator_notification(
                ticket_no="YW20260521001",
                creator="李潇雨 l30030745",
            )
        assert result is True
        assert captured_payload["receiver"] == "l30030745"
        assert "此问题已闭环，请提单人尽快与运维侧对齐，如实填写改进建议" in captured_payload["content"]
        assert (
            f"{_DEFAULT_XIAOLUBAN_LINK_BASE}/tickets/YW20260521001"
            in captured_payload["content"]
        )
        assert captured_payload["content"].startswith("此问题已闭环")

    def test_send_accepts_pure_account(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            result = send_ops_closure_creator_notification(
                ticket_no="YW20260521001",
                creator="test_user01",
            )
        assert result is True
        assert captured_payload["receiver"] == "test_user01"

    def test_send_skipped_when_no_account(self):
        with patch("utils.xiaoluban_message.requests.post") as mock_post:
            result = send_ops_closure_creator_notification(
                ticket_no="YW20260521001",
                creator="李潇雨",
            )
            assert result is False
            mock_post.assert_not_called()

    def test_send_failure_does_not_raise(self):
        with patch("utils.xiaoluban_message.requests.post", side_effect=Exception("network error")):
            result = send_ops_closure_creator_notification(
                ticket_no="YW20260521001",
                creator="李潇雨 l30030745",
            )
            assert result is False

    def test_link_uses_app_public_base_url(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with (
            patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", "https://ops.example.com/"),
            patch("utils.xiaoluban_message.requests.post", capture_post),
        ):
            send_ops_closure_creator_notification(
                ticket_no="YW20260521001",
                creator="test_user01",
            )
        assert "https://ops.example.com/tickets/YW20260521001" in captured_payload["content"]


class TestFormatGroupNotificationMessage:
    def test_complete_fields_with_ecare_and_desc(self):
        msg = format_group_notification_message(
            ticket_no="YW20260521001",
            start_date="2026-05-21",
            severity="严重",
            location="华北-北京",
            biz_env="运维阶段",
            product_line="公有云",
            component="内核问题",
            ecare_ticket_no="ECARE-001",
            issue_desc="数据库连接超时",
            problem_env="生产环境",
        )
        assert msg == "\n".join([
            "【流程ID】YW20260521001",
            "【起始日期】2026-05-21",
            "【局点】华北-北京",
            "【问题阶段】运维阶段",
            "【问题环境】生产环境",
            "【产品线】公有云",
            "【问题严重性】严重",
            "【问题组件】内核问题",
            "【eCare单号】ECARE-001",
            "【问题描述】数据库连接超时",
            "【问题确认人】",
        ])

    def test_includes_ops_handler(self):
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
            ops_handler="李潇雨 l30030745",
        )
        assert "【问题确认人】李潇雨 l30030745" in msg
        lines = msg.split("\n")
        assert lines[-1] == "【问题确认人】李潇雨 l30030745"
        assert lines[-2] == "【问题描述】数据库连接超时"

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
        desc_line = [l for l in msg.split("\n") if l.startswith("【问题描述】")][0]
        desc_value = desc_line.replace("【问题描述】", "")
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
        assert "【流程ID】YW20260521001" in msg
        assert "【问题阶段】" in msg
        assert "【问题环境】" in msg
        assert "【产品线】" in msg
        assert "【问题确认人】" in msg
        assert "【eCare单号】" in msg
        assert "【问题描述】" in msg
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
                    "biz_env": "运维阶段",
                    "problem_env": "生产环境",
                    "product_line": "公有云",
                    "component": "内核问题",
                    "ecare_ticket_no": "ECARE-001",
                    "issue_desc": "数据库异常",
                },
                ops_handler="李潇雨 l30030745",
            )
            assert result is True
            assert captured_payload["receiver"] == XIAOLUBAN_GROUP_CHAT_ID
            assert "【流程ID】YW20260521001" in captured_payload["content"]
            assert "【问题阶段】运维阶段" in captured_payload["content"]
            assert "【问题环境】生产环境" in captured_payload["content"]
            assert "【产品线】公有云" in captured_payload["content"]
            assert "【问题确认人】李潇雨 l30030745" in captured_payload["content"]
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
            assert "【流程ID】YW20260521001" in captured_payload["content"]
            assert "【eCare单号】" in captured_payload["content"]
            assert "【问题描述】" in captured_payload["content"]
            assert "【问题环境】" in captured_payload["content"]


class TestConfirmProblemSkipsHandlerNotification:
    """问题审核「确认问题」：只发群通知，不给下一处理人（本人）发私信。"""

    def _build_problem_fill_payload(self, client) -> dict:
        schema_resp = client.get("/api/nodes/problem_fill/schema")
        assert schema_resp.status_code == 200, schema_resp.text[:200]
        fields = schema_resp.json()["fields"]
        values: dict = {}
        for f in fields:
            key = f["key"]
            if not f.get("required", False):
                continue
            if f.get("readonly", False):
                continue
            if f.get("default_type") in ("today", "login_user"):
                continue
            options = f.get("options", [])
            if options:
                if key == "biz_env" and "运维阶段" in options:
                    values[key] = "运维阶段"
                elif key == "problem_env" and "生产环境" in options:
                    values[key] = "生产环境"
                else:
                    values[key] = options[0]
            elif f.get("type") == "text":
                values[key] = f"test_{key}"
            elif f.get("type") == "richtext":
                values[key] = f"<p>test {key}</p>"
            elif f.get("type") == "date":
                values[key] = "2026-04-27"
        pl = str(values.get("product_line") or "").strip()
        if "ecare_ticket_no" in values:
            values["ecare_ticket_no"] = "12345678901234" if pl == "公有云" else "12345678"
        return {
            "values": values,
            "operator_id": "test_user01",
            "operator_name": "测试用户01",
            "create_intent": True,
        }

    def _build_node_payload(self, client, node_key: str, handle_mode: str) -> dict:
        schema_resp = client.get(f"/api/nodes/{node_key}/schema")
        assert schema_resp.status_code == 200, schema_resp.text[:200]
        fields = schema_resp.json()["fields"]
        values = {"handle_mode": handle_mode}
        for f in fields:
            key = f["key"]
            if key == "handle_mode":
                continue
            if f.get("readonly", False):
                continue
            constraints = f.get("constraints") or {}
            required_if = constraints.get("required_if")
            if required_if:
                cond_field = list(required_if.keys())[0]
                cond_value = required_if[cond_field]
                cond_actual = values.get(cond_field)
                triggered = (
                    cond_actual in cond_value
                    if isinstance(cond_value, list)
                    else cond_actual == cond_value
                )
                if triggered:
                    options = f.get("options", [])
                    if options:
                        values[key] = options[0]
                    elif f.get("type") == "text":
                        values[key] = f"test_{key}"
                    elif f.get("type") == "richtext":
                        values[key] = f"<p>test {key}</p>"
                    elif f.get("type") == "date":
                        values[key] = "2026-04-27"
                    continue
            if not f.get("required", False):
                continue
            options = f.get("options", [])
            if options:
                values[key] = options[0]
            elif f.get("type") == "text":
                values[key] = f"test_{key}"
            elif f.get("type") == "richtext":
                values[key] = f"<p>test {key}</p>"
            elif f.get("type") == "date":
                values[key] = "2026-04-27"
        return {
            "values": values,
            "operator_id": "test_user01",
            "operator_name": "测试用户01",
        }

    def test_confirm_problem_skips_personal_sends_group(self):
        import uuid
        from fastapi.testclient import TestClient
        from app import app

        client = TestClient(app)
        draft_id = f"draft-{uuid.uuid4()}"
        fill_resp = client.post(
            f"/api/tickets/{draft_id}/nodes/problem_fill/submit",
            json=self._build_problem_fill_payload(client),
        )
        assert fill_resp.status_code == 200, fill_resp.text[:300]
        ticket_no = fill_resp.json().get("ticket_id") or draft_id
        assert str(ticket_no).startswith("YW"), ticket_no

        with (
            patch("routers.tickets.send_ticket_notification") as mock_personal,
            patch("routers.tickets.send_group_notification") as mock_group,
        ):
            mock_personal.return_value = True
            mock_group.return_value = True
            resp = client.post(
                f"/api/tickets/{ticket_no}/nodes/problem_review/submit",
                json=self._build_node_payload(client, "problem_review", "确认问题"),
            )
            assert resp.status_code == 200, resp.text[:300]
            mock_personal.assert_not_called()
            mock_group.assert_called_once()
            assert mock_group.call_args.kwargs["ticket_no"] == ticket_no
            ops_handler = str(mock_group.call_args.kwargs.get("ops_handler") or "").strip()
            assert ops_handler, "群通知应带上审核阶段当前处理人作为运维人员"
            assert " " in ops_handler or ops_handler  # 姓名 账号 或至少非空

    def test_problem_fill_arrival_still_notifies_handler(self):
        """对照：问题填写提交到达问题审核时，仍给处理人发私信。"""
        import uuid
        from fastapi.testclient import TestClient
        from app import app

        client = TestClient(app)
        draft_id = f"draft-{uuid.uuid4()}"
        with patch("routers.tickets.send_ticket_notification") as mock_personal:
            mock_personal.return_value = True
            fill_resp = client.post(
                f"/api/tickets/{draft_id}/nodes/problem_fill/submit",
                json=self._build_problem_fill_payload(client),
            )
            assert fill_resp.status_code == 200, fill_resp.text[:300]
            mock_personal.assert_called_once()
            assert mock_personal.call_args.kwargs["next_node_key"] == "problem_review"


class TestOpsClosureCreatorNotificationOnSubmit:
    """处理方式「提交运维闭环」到达运维闭环时，给提单人发改进建议提醒。"""

    def test_ops_analysis_submit_ops_closure_notifies_creator(self):
        from fastapi.testclient import TestClient
        from app import app
        from test_m02_ticket import _unique_ticket_no, _submit_fill, _submit_node

        client = TestClient(app)
        ticket_no = _unique_ticket_no()
        fill_resp = _submit_fill(client, ticket_no)
        assert fill_resp.status_code == 200, fill_resp.text[:300]
        with patch("routers.tickets.send_group_notification", return_value=True):
            review_resp = _submit_node(client, ticket_no, "problem_review", "确认问题")
        assert review_resp.status_code == 200, review_resp.text[:300]

        with patch("routers.tickets.send_ops_closure_creator_notification") as mock_notify:
            mock_notify.return_value = True
            resp = _submit_node(
                client,
                ticket_no,
                "ops_analysis",
                "提交运维闭环",
                extra_values={"is_quality_issue": "否"},
            )
            assert resp.status_code == 200, resp.text[:300]
            mock_notify.assert_called_once()
            assert mock_notify.call_args.kwargs["ticket_no"] == ticket_no
            creator = str(mock_notify.call_args.kwargs.get("creator") or "")
            assert "test_user01" in creator

            mock_notify.reset_mock()
            other = _submit_node(
                client,
                ticket_no,
                "ops_closure",
                "提交其他运维闭环",
                extra_values={"is_quality_issue": "否"},
            )
            assert other.status_code == 200, other.text[:300]
            mock_notify.assert_not_called()

    def test_ops_analysis_submit_dev_analysis_does_not_notify_creator(self):
        from fastapi.testclient import TestClient
        from app import app
        from test_m02_ticket import _unique_ticket_no, _submit_fill, _submit_node

        client = TestClient(app)
        ticket_no = _unique_ticket_no()
        fill_resp = _submit_fill(client, ticket_no)
        assert fill_resp.status_code == 200, fill_resp.text[:300]
        with patch("routers.tickets.send_group_notification", return_value=True):
            review_resp = _submit_node(client, ticket_no, "problem_review", "确认问题")
        assert review_resp.status_code == 200, review_resp.text[:300]

        with (
            patch("routers.tickets.send_ops_closure_creator_notification") as mock_notify,
            patch("routers.tickets.send_ticket_notification", return_value=True),
        ):
            mock_notify.return_value = True
            resp = _submit_node(
                client,
                ticket_no,
                "ops_analysis",
                "提交开发分析",
            )
            assert resp.status_code == 200, resp.text[:300]
            mock_notify.assert_not_called()


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

    def test_build_leave_approval_link_default_base_url(self):
        with patch("utils.xiaoluban_message.APP_PUBLIC_BASE_URL", ""):
            assert (
                build_leave_approval_link(7)
                == f"{_DEFAULT_XIAOLUBAN_LINK_BASE}/leave-application?id=7"
            )

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
        assert all(
            f"{_DEFAULT_XIAOLUBAN_LINK_BASE}/leave-application?id=12" in item["content"]
            for item in captured
        )

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
        assert (
            f"{_DEFAULT_XIAOLUBAN_LINK_BASE}/leave-application?id=12"
            in captured[0]["content"]
        )