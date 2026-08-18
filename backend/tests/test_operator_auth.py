from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from sso_config import SKIP_SSO_AUTH
from utils.operator_auth import resolve_operator_id


def _request(*, account: str = "", w3: str = ""):
    local = {"account": account} if account else {}
    return SimpleNamespace(state=SimpleNamespace(local_user=local, w3_account=w3))


def test_resolve_prefers_sso_account_over_claimed():
    op = resolve_operator_id(_request(account="sso_user"), "impersonate_me")
    assert op == "sso_user"


def test_resolve_uses_w3_when_local_user_missing():
    op = resolve_operator_id(_request(w3="w3_user"), "claimed")
    assert op == "w3_user"


def test_resolve_skip_sso_falls_back_to_claimed():
    if not SKIP_SSO_AUTH:
        pytest.skip("SKIP_SSO_AUTH 关闭时无会话会 401")
    op = resolve_operator_id(_request(), "claimed_user")
    assert op == "claimed_user"


def test_resolve_skip_sso_defaults_demo():
    if not SKIP_SSO_AUTH:
        pytest.skip("SKIP_SSO_AUTH 关闭时无会话会 401")
    op = resolve_operator_id(_request(), "")
    assert op == "demo_001"


def test_resolve_without_skip_sso_requires_login(monkeypatch):
    import utils.operator_auth as auth

    monkeypatch.setattr(auth, "SKIP_SSO_AUTH", False)
    with pytest.raises(HTTPException) as exc:
        auth.resolve_operator_id(_request(), "claimed_user")
    assert exc.value.status_code == 401
