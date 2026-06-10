import pytest
from unittest.mock import patch, MagicMock

from utils.xiaoluban_message import send_message, _strip_html_and_truncate


class TestSendMessage:
    def test_send_message_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            result = send_message("test content", "receiver123")
            assert result is True

    def test_send_message_status_not_ok(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "error"}
        mock_response.text = '{"status": "error"}'
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_success_with_success_true(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            assert send_message("test content", "receiver123") is True

    def test_send_message_status_ok_case_insensitive(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "OK"}
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            assert send_message("test content", "receiver123") is True

    def test_send_message_empty_receiver(self):
        with patch("utils.xiaoluban_message.requests.post") as mock_post:
            assert send_message("test content", "") is False
            mock_post.assert_not_called()

    def test_send_message_status_not_200(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.json.return_value = {"status": "ok"}
        mock_response.text = "internal error"
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_http_error(self):
        import requests
        with patch("utils.xiaoluban_message.requests.post", side_effect=requests.RequestException("connection failed")):
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_unexpected_error(self):
        with patch("utils.xiaoluban_message.requests.post", side_effect=Exception("unexpected")):
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_json_parse_error(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.side_effect = ValueError("invalid json")
        mock_response.text = "not json"
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_context_does_not_affect_failure_result(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "bad gateway"
        with patch("utils.xiaoluban_message.requests.post", return_value=mock_response):
            result = send_message(
                "test content",
                "receiver123",
                context="reminder ticket_no=YW20240001 severity=一般",
            )
        assert result is False


class TestMessagePayload:
    def test_payload_structure(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None
        captured_headers = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload, captured_headers
            captured_payload = json
            captured_headers = headers
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            send_message("test content", "receiver123")
            assert captured_payload["content"] == "test content"
            assert captured_payload["receiver"] == "receiver123"
            assert "auth" in captured_payload
            assert captured_headers["Content-Type"] == "application/json"

    def test_config_url_used(self):
        from config import XIAOLUBAN_MESSAGE_URL
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_url = None

        def capture_post(url, **kwargs):
            nonlocal captured_url
            captured_url = url
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            send_message("test content", "receiver123")
            assert captured_url == XIAOLUBAN_MESSAGE_URL

    def test_config_auth_used(self):
        from config import XIAOLUBAN_MESSAGE_SEND_TOKEN
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        captured_payload = None

        def capture_post(url, json=None, headers=None, **kwargs):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.requests.post", capture_post):
            send_message("test content", "receiver123")
            assert captured_payload["auth"] == XIAOLUBAN_MESSAGE_SEND_TOKEN


class TestStripHtmlAndTruncate:
    def test_strip_html_tags(self):
        assert _strip_html_and_truncate("<p>Hello <b>world</b></p>") == "Hello world"

    def test_truncate_long_text(self):
        assert _strip_html_and_truncate("A" * 150, 100) == "A" * 100 + "..."

    def test_short_text_not_truncated(self):
        assert _strip_html_and_truncate("Short text", 100) == "Short text"

    def test_empty_string(self):
        assert _strip_html_and_truncate("", 100) == ""

    def test_whitespace_normalization(self):
        assert _strip_html_and_truncate("  hello   world  ", 100) == "hello world"