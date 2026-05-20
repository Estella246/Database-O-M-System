import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from utils.xiaoluban_message import send_message, send_message_async


class TestSendMessageSync:
    def test_send_message_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '{"success": true}'
        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post.return_value = mock_response
            result = send_message("test content", "receiver123")
            assert result is True

    def test_send_message_status_not_200(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "error"
        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post.return_value = mock_response
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_null_response(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "null"
        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post.return_value = mock_response
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_empty_response(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = ""
        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post.return_value = mock_response
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_http_error(self):
        import httpx
        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post.side_effect = httpx.ConnectError("connection failed")
            result = send_message("test content", "receiver123")
            assert result is False

    def test_send_message_unexpected_error(self):
        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post.side_effect = Exception("unexpected")
            result = send_message("test content", "receiver123")
            assert result is False


class TestSendMessageAsync:
    @pytest.mark.asyncio
    async def test_send_message_async_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '{"success": true}'
        with patch("utils.xiaoluban_message.httpx.AsyncClient") as mock_client:
            mock_post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.post = mock_post
            result = await send_message_async("test content", "receiver123")
            assert result is True

    @pytest.mark.asyncio
    async def test_send_message_async_status_not_200(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "error"
        with patch("utils.xiaoluban_message.httpx.AsyncClient") as mock_client:
            mock_post = MagicMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.post = mock_post
            result = await send_message_async("test content", "receiver123")
            assert result is False

    @pytest.mark.asyncio
    async def test_send_message_async_null_response(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "null"
        with patch("utils.xiaoluban_message.httpx.AsyncClient") as mock_client:
            mock_post = MagicMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.post = mock_post
            result = await send_message_async("test content", "receiver123")
            assert result is False

    @pytest.mark.asyncio
    async def test_send_message_async_http_error(self):
        import httpx
        with patch("utils.xiaoluban_message.httpx.AsyncClient") as mock_client:
            mock_post = MagicMock(side_effect=httpx.ConnectError("connection failed"))
            mock_client.return_value.__aenter__.return_value.post = mock_post
            result = await send_message_async("test content", "receiver123")
            assert result is False

    @pytest.mark.asyncio
    async def test_send_message_async_unexpected_error(self):
        with patch("utils.xiaoluban_message.httpx.AsyncClient") as mock_client:
            mock_post = MagicMock(side_effect=Exception("unexpected"))
            mock_client.return_value.__aenter__.return_value.post = mock_post
            result = await send_message_async("test content", "receiver123")
            assert result is False


class TestMessagePayload:
    def test_payload_structure(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '{"success": true}'
        captured_payload = None
        captured_headers = None

        def capture_post(url, json=None, headers=None):
            nonlocal captured_payload, captured_headers
            captured_payload = json
            captured_headers = headers
            return mock_response

        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post = capture_post
            send_message("test content", "receiver123")
            assert captured_payload["content"] == "test content"
            assert captured_payload["receiver"] == "receiver123"
            assert "auth" in captured_payload
            assert captured_headers["Content-Type"] == "application/json"

    def test_config_url_used(self):
        from config import XIAOLUBAN_MESSAGE_URL
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '{"success": true}'
        captured_url = None

        def capture_post(url, **kwargs):
            nonlocal captured_url
            captured_url = url
            return mock_response

        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post = capture_post
            send_message("test content", "receiver123")
            assert captured_url == XIAOLUBAN_MESSAGE_URL

    def test_config_auth_used(self):
        from config import XIAOLUBAN_MESSAGE_SEND_TOKEN
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '{"success": true}'
        captured_payload = None

        def capture_post(url, json=None, headers=None):
            nonlocal captured_payload
            captured_payload = json
            return mock_response

        with patch("utils.xiaoluban_message.httpx.Client") as mock_client:
            mock_client.return_value.__enter__.return_value.post = capture_post
            send_message("test content", "receiver123")
            assert captured_payload["auth"] == XIAOLUBAN_MESSAGE_SEND_TOKEN