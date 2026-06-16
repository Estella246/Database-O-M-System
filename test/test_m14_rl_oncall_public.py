"""RL On-Call Public Access tests - M14 module.

Tests for:
- GET /api/duty/rl-oncall accessible without auth (method-specific whitelist)
- PUT /api/duty/rl-oncall still requires auth (method not whitelisted)
- Public page SPA route accessible without auth
"""
import pytest
import httpx
import os


BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")
SKIP_SSO_AUTH = os.getenv("SKIP_SSO_AUTH", "").strip().lower() in ("1", "true", "yes", "on")


class TestRlOncallPublicAccess:
    """Test that GET /api/duty/rl-oncall is accessible without authentication."""

    def test_tc_01_get_rl_oncall_without_auth(self):
        """GET /api/duty/rl-oncall should return 200 without auth (whitelist exemption)."""
        resp = httpx.get(f"{BASE_URL}/api/duty/rl-oncall", timeout=10.0)
        assert resp.status_code == 200
        data = resp.json()
        assert "rows" in data
        assert isinstance(data["rows"], list)

    @pytest.mark.skipif(SKIP_SSO_AUTH, reason="SKIP_SSO_AUTH mode skips auth middleware")
    def test_tc_02_put_rl_oncall_without_auth_returns_401(self):
        """PUT /api/duty/rl-oncall should return 401 without auth (method not whitelisted)."""
        resp = httpx.put(
            f"{BASE_URL}/api/duty/rl-oncall",
            json={"rows": [], "operator_id": "test"},
            timeout=10.0,
        )
        assert resp.status_code == 401

    def test_tc_03_rl_oncall_spa_route_accessible(self):
        """SPA route /rl-oncall should serve frontend HTML without auth."""
        resp = httpx.get(f"{BASE_URL}/rl-oncall", timeout=10.0, follow_redirects=False)
        # SPA route returns frontend HTML, not 401
        assert resp.status_code in (200, 404)

    def test_tc_04_get_rl_oncall_with_default_operator_id(self):
        """GET /api/duty/rl-oncall works without operator_id parameter."""
        resp = httpx.get(f"{BASE_URL}/api/duty/rl-oncall", timeout=10.0)
        assert resp.status_code == 200
        data = resp.json()
        assert "rows" in data

    def test_tc_05_get_rl_oncall_returns_valid_structure(self):
        """GET /api/duty/rl-oncall should return valid data structure."""
        resp = httpx.get(f"{BASE_URL}/api/duty/rl-oncall", timeout=10.0)
        assert resp.status_code == 200
        data = resp.json()
        rows = data.get("rows", [])
        if len(rows) > 0:
            row = rows[0]
            assert "duty_date" in row
            assert "primary" in row
            assert "backup" in row


class TestMethodSpecificWhitelist:
    """Test method-specific whitelist behavior (GET exempt, PUT not exempt)."""

    def test_tc_01_get_exempted_from_auth(self):
        """GET method on whitelisted path should bypass auth."""
        resp = httpx.get(f"{BASE_URL}/api/duty/rl-oncall", timeout=10.0)
        assert resp.status_code == 200

    @pytest.mark.skipif(SKIP_SSO_AUTH, reason="SKIP_SSO_AUTH mode skips auth middleware")
    def test_tc_02_put_not_exempted_from_auth(self):
        """PUT method on same path should still require auth."""
        resp = httpx.put(
            f"{BASE_URL}/api/duty/rl-oncall",
            json={"rows": [], "operator_id": "test"},
            timeout=10.0,
        )
        assert resp.status_code == 401

    @pytest.mark.skipif(SKIP_SSO_AUTH, reason="SKIP_SSO_AUTH mode skips auth middleware")
    def test_tc_03_post_not_exempted_from_auth(self):
        """POST method on same path should still require auth."""
        resp = httpx.post(
            f"{BASE_URL}/api/duty/rl-oncall",
            json={"rows": []},
            timeout=10.0,
        )
        assert resp.status_code == 401

    @pytest.mark.skipif(SKIP_SSO_AUTH, reason="SKIP_SSO_AUTH mode skips auth middleware")
    def test_tc_04_delete_not_exempted_from_auth(self):
        """DELETE method on same path should still require auth."""
        resp = httpx.delete(f"{BASE_URL}/api/duty/rl-oncall", timeout=10.0)
        assert resp.status_code == 401


TEST_CASE_SUMMARY = """
M14 RL On-Call Public Access Module Test Summary:

TC01 RL On-Call Public Access:
  - test_tc_01_get_rl_oncall_without_auth: GET accessible without auth
  - test_tc_02_put_rl_oncall_without_auth_returns_401: PUT requires auth (skipped in dev mode)
  - test_tc_03_rl_oncall_spa_route_accessible: SPA route serves frontend
  - test_tc_04_get_rl_oncall_with_default_operator_id: Works without operator_id
  - test_tc_05_get_rl_oncall_returns_valid_structure: Returns valid data structure

TC02 Method-Specific Whitelist:
  - test_tc_01_get_exempted_from_auth: GET bypasses auth
  - test_tc_02_put_not_exempted_from_auth: PUT still requires auth (skipped in dev mode)
  - test_tc_03_post_not_exempted_from_auth: POST still requires auth (skipped in dev mode)
  - test_tc_04_delete_not_exempted_from_auth: DELETE still requires auth (skipped in dev mode)
"""
