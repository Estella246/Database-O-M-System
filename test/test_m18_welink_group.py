import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest
from unittest.mock import patch, MagicMock

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Load welink router module directly from file to avoid routers/__init__.py cascade
_spec = importlib.util.spec_from_file_location("routers.welink", BACKEND_DIR / "routers" / "welink.py")
_welink_mod = importlib.util.module_from_spec(_spec)
sys.modules["routers.welink"] = _welink_mod
_spec.loader.exec_module(_welink_mod)

_parse_invite_list = _welink_mod._parse_invite_list
_resolve_title = _welink_mod._resolve_title
_WelinkCreateGroupRequest = _welink_mod.WelinkCreateGroupRequest
_api_create_group = _welink_mod.api_create_group
_WelinkGroupCreateRequest = _welink_mod.WelinkGroupCreateRequest


class TestParseInviteList:
    def test_canonical_format_account_name(self):
        result = _parse_invite_list("zhangsan001 张三,lisi004 李四")
        assert result == ["zhangsan001", "lisi004"]

    def test_pure_account_only(self):
        result = _parse_invite_list("zhangsan001,lisi004")
        assert result == ["zhangsan001", "lisi004"]

    def test_mixed_formats(self):
        result = _parse_invite_list("zhangsan001 张三,wangwu005,lisi004 李四")
        assert result == ["zhangsan001", "wangwu005", "lisi004"]

    def test_empty_string(self):
        assert _parse_invite_list("") == []

    def test_none_input(self):
        assert _parse_invite_list(None) == []

    def test_extra_whitespace(self):
        result = _parse_invite_list("  zhangsan001  张三  ,  lisi004  李四  ")
        assert result == ["zhangsan001", "lisi004"]

    def test_empty_segments_ignored(self):
        result = _parse_invite_list("zhangsan001 张三,,lisi004 李四")
        assert result == ["zhangsan001", "lisi004"]

    def test_name_only_no_account(self):
        result = _parse_invite_list("张三")
        assert result == []

    def test_account_with_dots_and_underscores(self):
        result = _parse_invite_list("a.b_c123 某人")
        assert result == ["a.b_c123"]

    def test_single_member(self):
        result = _parse_invite_list("zhangsan001 张三")
        assert result == ["zhangsan001"]


class TestResolveTitle:
    def test_major_returns_war_room(self):
        assert _resolve_title("major") == "WarRoom已拉起，请按规范刷新进展"

    def test_urgent_returns_war_room(self):
        assert _resolve_title("urgent") == "WarRoom已拉起，请按规范刷新进展"

    def test_itr_returns_war_room(self):
        assert _resolve_title("itr") == "WarRoom已拉起，请按规范刷新进展"

    def test_general_returns_normal(self):
        assert _resolve_title("general") == "请按规范刷新进展"


class TestCreateGroupEndpointLogic:
    def test_success_returns_group_id(self):
        mock_req = MagicMock()
        mock_req.state.w3_account = "testowner"
        payload = _WelinkCreateGroupRequest(
            problem_kind="major",
            group_name="test group",
            manifesto="test manifesto",
            group_members="zhangsan001 张三,lisi004 李四",
            message="first report",
            operator_id="testop",
        )
        with patch("routers.welink.create_group_and_send_message", return_value="group_123") as mock_fn:
            result = asyncio.run(_api_create_group(payload, mock_req))
            assert result["ok"] is True
            assert result["group_id"] == "group_123"
            welink_req = mock_fn.call_args[0][0]
            assert welink_req.group_name == "test group"
            assert welink_req.invite_list == ["zhangsan001", "lisi004"]
            assert welink_req.title == "WarRoom已拉起，请按规范刷新进展"
            assert welink_req.group_desc == ""
            owner = mock_fn.call_args[0][1]
            assert owner == "testowner"

    def test_general_kind_title(self):
        mock_req = MagicMock()
        mock_req.state.w3_account = "testowner"
        payload = _WelinkCreateGroupRequest(
            problem_kind="general",
            group_name="general group",
            manifesto="",
            group_members="",
            message="",
            operator_id="testop",
        )
        with patch("routers.welink.create_group_and_send_message", return_value="group_456") as mock_fn:
            result = asyncio.run(_api_create_group(payload, mock_req))
            assert result["ok"] is True
            welink_req = mock_fn.call_args[0][0]
            assert welink_req.title == "请按规范刷新进展"

    def test_welink_failure_raises_500(self):
        from fastapi import HTTPException
        mock_req = MagicMock()
        mock_req.state.w3_account = "testowner"
        payload = _WelinkCreateGroupRequest(
            problem_kind="major",
            group_name="test group",
            manifesto="",
            group_members="",
            message="",
            operator_id="testop",
        )
        with patch("routers.welink.create_group_and_send_message", side_effect=RuntimeError("token failed")):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(_api_create_group(payload, mock_req))
            assert exc_info.value.status_code == 500
            assert "token failed" in str(exc_info.value.detail)

    def test_owner_from_w3_account(self):
        mock_req = MagicMock()
        mock_req.state.w3_account = "w3user001"
        payload = _WelinkCreateGroupRequest(
            problem_kind="major",
            group_name="test",
            manifesto="",
            group_members="",
            message="",
            operator_id="fallbackop",
        )
        with patch("routers.welink.create_group_and_send_message", return_value="grp_001") as mock_fn:
            asyncio.run(_api_create_group(payload, mock_req))
            assert mock_fn.call_args[0][1] == "w3user001"

    def test_owner_fallback_to_operator_id(self):
        from fastapi import Request
        mock_req = MagicMock(spec=Request)
        del mock_req.state.w3_account
        payload = _WelinkCreateGroupRequest(
            problem_kind="major",
            group_name="test",
            manifesto="",
            group_members="",
            message="",
            operator_id="fallbackop",
        )
        with patch("routers.welink.create_group_and_send_message", return_value="grp_002") as mock_fn:
            asyncio.run(_api_create_group(payload, mock_req))
            assert mock_fn.call_args[0][1] == "fallbackop"

    def test_member_parsing_in_endpoint(self):
        mock_req = MagicMock()
        mock_req.state.w3_account = "testowner"
        payload = _WelinkCreateGroupRequest(
            problem_kind="urgent",
            group_name="urgent group",
            manifesto="notice",
            group_members="a001 张三,b002 李四,c003",
            message="report",
            operator_id="testop",
        )
        with patch("routers.welink.create_group_and_send_message", return_value="grp_789") as mock_fn:
            result = asyncio.run(_api_create_group(payload, mock_req))
            assert result["ok"] is True
            welink_req = mock_fn.call_args[0][0]
            assert welink_req.invite_list == ["a001", "b002", "c003"]