import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta

from utils.ticket_reminder import (
    _extract_chinese_name,
    format_reminder_message,
    check_and_send_reminders,
)


class TestExtractChineseName:
    def test_canonical_format_name_account(self):
        assert _extract_chinese_name("张三 l30030745") == "张三"

    def test_canonical_format_name_with_hyphen_account(self):
        assert _extract_chinese_name("张三 l300-30745") == "张三"

    def test_raw_format_account_name(self):
        assert _extract_chinese_name("l30030745 张三") == "张三"

    def test_raw_format_account_plus_name(self):
        assert _extract_chinese_name("l30030745+张三") == "张三"

    def test_only_name_no_account(self):
        assert _extract_chinese_name("张三") == "张三"

    def test_empty_string(self):
        assert _extract_chinese_name("") == ""

    def test_whitespace_only(self):
        assert _extract_chinese_name("   ") == ""

    def test_name_with_space_and_account(self):
        assert _extract_chinese_name("Jean Claude z12345") == "Jean Claude"


class TestFormatReminderMessage:
    def test_general_severity(self):
        msg = format_reminder_message("张三", "一般")
        assert msg == "@张三 你有一条一般级别现网问题未处理，请及时确认！"

    def test_serious_severity(self):
        msg = format_reminder_message("张三", "严重")
        assert msg == "@张三 你有一条严重级别现网问题未处理，请及时确认！"

    def test_critical_severity(self):
        msg = format_reminder_message("张三", "致命")
        assert msg == "@张三 你有一条致命级别现网问题未处理，请及时确认！"

    def test_different_name(self):
        msg = format_reminder_message("李四", "严重")
        assert msg == "@李四 你有一条严重级别现网问题未处理，请及时确认！"


def _make_entered_at(minutes_ago):
    return datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)


def _make_mock_db():
    """Create mock db_conn that returns a connection with pr_node and empty tickets."""
    mock_conn = MagicMock()
    pr_result = MagicMock(fetchone=lambda: {"id": 100})
    tickets_result = MagicMock(fetchall=lambda: [])
    mock_conn.execute.side_effect = [pr_result, tickets_result]
    mock_conn.commit = MagicMock()
    mock_db = MagicMock()
    mock_db.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_db.return_value.__exit__ = MagicMock(return_value=False)
    return mock_db


def _make_mock_db_with_tickets(ticket_rows):
    """Create mock db_conn with ticket rows at problem_review."""
    mock_conn = MagicMock()
    pr_result = MagicMock(fetchone=lambda: {"id": 100})
    tickets_result = MagicMock(fetchall=lambda: ticket_rows)
    mock_conn.execute.side_effect = [pr_result, tickets_result]
    mock_conn.commit = MagicMock()
    mock_db = MagicMock()
    mock_db.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_db.return_value.__exit__ = MagicMock(return_value=False)
    return mock_db


class TestCheckAndSendReminders:
    """Test the core reminder logic by mocking DB queries and helper functions."""

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="一般")
    @patch("utils.ticket_reminder._get_current_handler", return_value="张三 l30030745")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_general_severity_one_reminder(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """一般: 15分钟后触发1次"""
        entered_16 = _make_entered_at(16)
        mock_entered.return_value = entered_16
        mock_db_obj = _make_mock_db_with_tickets([{"id": 1, "ticket_no": "YW20240001"}])
        mock_db.return_value.__enter__ = MagicMock(return_value=mock_db_obj.return_value.__enter__.return_value)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        # Re-create mock_conn with correct side_effect
        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_called_once_with(
            "@张三 你有一条一般级别现网问题未处理，请及时确认！",
            "test_group_chat_001",
            context="reminder ticket_no=YW20240001 severity=一般",
        )
        mock_upsert.assert_called_once()

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log")
    @patch("utils.ticket_reminder._get_severity", return_value="一般")
    @patch("utils.ticket_reminder._get_current_handler", return_value="张三 l30030745")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_general_severity_no_second_reminder(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """一般: reminder_count=1时不再触发(max=1)"""
        entered_30 = _make_entered_at(30)
        mock_entered.return_value = entered_30
        mock_log.return_value = {"severity": "一般", "entered_at": entered_30, "reminder_count": 1, "last_reminded_at": entered_30 + timedelta(minutes=15)}

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="严重")
    @patch("utils.ticket_reminder._get_current_handler", return_value="李四 l30030746")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_serious_severity_first_reminder(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """严重: 15分钟触发第1次"""
        entered_16 = _make_entered_at(16)
        mock_entered.return_value = entered_16

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_called_once_with(
            "@李四 你有一条严重级别现网问题未处理，请及时确认！",
            "test_group_chat_001",
            context="reminder ticket_no=YW20240001 severity=严重",
        )

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log")
    @patch("utils.ticket_reminder._get_severity", return_value="严重")
    @patch("utils.ticket_reminder._get_current_handler", return_value="李四 l30030746")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_serious_severity_second_reminder_at_30(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """严重: 31分钟触发第2次(reminder_count=1, next_milestone=30)"""
        entered_31 = _make_entered_at(31)
        mock_entered.return_value = entered_31
        mock_log.return_value = {"severity": "严重", "entered_at": entered_31, "reminder_count": 1, "last_reminded_at": entered_31 + timedelta(minutes=15)}

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_called_once_with(
            "@李四 你有一条严重级别现网问题未处理，请及时确认！",
            "test_group_chat_001",
            context="reminder ticket_no=YW20240001 severity=严重",
        )

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log")
    @patch("utils.ticket_reminder._get_severity", return_value="严重")
    @patch("utils.ticket_reminder._get_current_handler", return_value="李四 l30030746")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_serious_severity_no_fourth_reminder(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """严重: reminder_count=3时不再触发(max=3)"""
        entered_50 = _make_entered_at(50)
        mock_entered.return_value = entered_50
        mock_log.return_value = {"severity": "严重", "entered_at": entered_50, "reminder_count": 3, "last_reminded_at": entered_50 + timedelta(minutes=45)}

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="致命")
    @patch("utils.ticket_reminder._get_current_handler", return_value="王五 l30030747")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_critical_severity_first_reminder(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """致命: 15分钟触发第1次"""
        entered_16 = _make_entered_at(16)
        mock_entered.return_value = entered_16

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_called_once_with(
            "@王五 你有一条致命级别现网问题未处理，请及时确认！",
            "test_group_chat_001",
            context="reminder ticket_no=YW20240001 severity=致命",
        )

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log")
    @patch("utils.ticket_reminder._get_severity", return_value="致命")
    @patch("utils.ticket_reminder._get_current_handler", return_value="王五 l30030747")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_critical_severity_max_10_reminders(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """致命: reminder_count=10时不再触发"""
        entered_160 = _make_entered_at(160)
        mock_entered.return_value = entered_160
        mock_log.return_value = {"severity": "致命", "entered_at": entered_160, "reminder_count": 10, "last_reminded_at": entered_160 + timedelta(minutes=150)}

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message")
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder.db_conn")
    def test_no_tickets_at_problem_review(self, mock_db, mock_cleanup, mock_send):
        """无工单在问题审核时不触发"""
        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: []),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message")
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder.db_conn")
    def test_closed_ticket_not_reminded(self, mock_db, mock_cleanup, mock_send):
        """已关闭的工单不在查询结果中(SQL已过滤), 不触发"""
        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: []),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message")
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="一般")
    @patch("utils.ticket_reminder._get_current_handler", return_value="")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_handler_empty_skips_ticket(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """处理人为空时跳过该工单"""
        entered_16 = _make_entered_at(16)
        mock_entered.return_value = entered_16

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message")
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="未知级别")
    @patch("utils.ticket_reminder._get_current_handler", return_value="张三 l30030745")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_invalid_severity_skips_ticket(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """不在REMINDER_SEVERITY_MAX_COUNT中的severity跳过"""
        entered_16 = _make_entered_at(16)
        mock_entered.return_value = entered_16

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()

    @patch("utils.ticket_reminder.send_message", return_value=True)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log")
    @patch("utils.ticket_reminder._get_severity", return_value="严重")
    @patch("utils.ticket_reminder._get_current_handler", return_value="李四 l30030746")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_reenter_problem_review_resets_count(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """工单重新进入问题审核时重置reminder_count"""
        old_entered = _make_entered_at(30)
        new_entered = _make_entered_at(16)
        mock_entered.return_value = new_entered
        # Stored entered_at differs from current → reset count
        mock_log.return_value = {"severity": "严重", "entered_at": old_entered, "reminder_count": 2, "last_reminded_at": old_entered + timedelta(minutes=30)}

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        # Count was reset to 0, 16min elapsed → (0+1)*15=15min milestone reached
        mock_send.assert_called_once_with(
            "@李四 你有一条严重级别现网问题未处理，请及时确认！",
            "test_group_chat_001",
            context="reminder ticket_no=YW20240001 severity=严重",
        )

    @patch("utils.ticket_reminder.send_message", return_value=False)
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="一般")
    @patch("utils.ticket_reminder._get_current_handler", return_value="张三 l30030745")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_send_failure_does_not_upsert_log(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """send_message失败时不调用_upsert_reminder_log"""
        entered_16 = _make_entered_at(16)
        mock_entered.return_value = entered_16

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_upsert.assert_not_called()

    @patch("utils.ticket_reminder.send_message")
    @patch("utils.ticket_reminder._cleanup_stale_reminders")
    @patch("utils.ticket_reminder._upsert_reminder_log")
    @patch("utils.ticket_reminder._get_reminder_log", return_value=None)
    @patch("utils.ticket_reminder._get_severity", return_value="致命")
    @patch("utils.ticket_reminder._get_current_handler", return_value="王五 l30030747")
    @patch("utils.ticket_reminder._get_entered_at")
    @patch("utils.ticket_reminder.db_conn")
    def test_less_than_15_minutes_no_reminder(
        self, mock_db, mock_entered, mock_handler, mock_severity,
        mock_log, mock_upsert, mock_cleanup, mock_send,
    ):
        """elapsed < 15分钟时不触发"""
        entered_10 = _make_entered_at(10)
        mock_entered.return_value = entered_10

        conn = MagicMock()
        conn.execute.side_effect = [
            MagicMock(fetchone=lambda: {"id": 100}),
            MagicMock(fetchall=lambda: [{"id": 1, "ticket_no": "YW20240001"}]),
        ]
        conn.commit = MagicMock()
        mock_db.return_value.__enter__ = MagicMock(return_value=conn)
        mock_db.return_value.__exit__ = MagicMock(return_value=False)

        check_and_send_reminders()

        mock_send.assert_not_called()