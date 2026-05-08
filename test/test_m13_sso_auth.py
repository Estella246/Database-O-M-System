"""SSO Authentication tests - M13 module.

Tests for:
- Auth router endpoints
- AuthMiddleware behavior
- Whitelist path handling
- SSO service integration
"""
import pytest
import httpx
import os


BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")
SSO_LOGIN_URL = os.getenv("SSO_LOGIN_URL", "http://app.bulezone.com/login")
SSO_PROFILE_URL = os.getenv("SSO_PROFILE_URL", "http://login.bulezone.com/account/profile")


class TestAuthHealthEndpoint:
    """Test /api/auth/health endpoint."""

    def test_tc_01_auth_health_returns_ok(self):
        """Auth health endpoint should return ok status."""
        resp = httpx.get(f"{BASE_URL}/api/auth/health", timeout=10.0)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "ok"
        assert "sso_login_url" in data


class TestAuthMeEndpoint:
    """Test /api/auth/me endpoint."""

    def test_tc_01_no_cookie_returns_401(self):
        """Request without cookie should return 401."""
        resp = httpx.get(f"{BASE_URL}/api/auth/me", timeout=10.0)
        assert resp.status_code == 401
        data = resp.json()
        assert "detail" in data

    def test_tc_02_no_sso_cookie_returns_401(self):
        """Request with non-SSO cookie should return 401."""
        resp = httpx.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Cookie": "other_cookie=value"},
            timeout=10.0
        )
        assert resp.status_code == 401
        data = resp.json()
        assert "No SSO session cookie" in data.get("detail", "") or data.get("detail") == "No cookie"

    def test_tc_03_invalid_sso_cookie_returns_401(self):
        """Request with invalid SSO session ID should return 401."""
        resp = httpx.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Cookie": "JESESSIONID=invalid-session-id-12345"},
            timeout=10.0
        )
        # May return 401 (session invalid) or 503 (SSO unavailable)
        assert resp.status_code in (401, 503)


class TestAuthMiddleware:
    """Test AuthMiddleware behavior on protected API endpoints."""

    def test_tc_01_health_endpoint_skips_auth(self):
        """Health endpoint should be accessible without auth."""
        resp = httpx.get(f"{BASE_URL}/health", timeout=10.0)
        assert resp.status_code == 200
        assert resp.json().get("status") == "ok"

    def test_tc_02_auth_me_endpoint_skips_auth(self):
        """Auth me endpoint itself should skip middleware auth check."""
        # This endpoint handles its own auth validation
        resp = httpx.get(f"{BASE_URL}/api/auth/me", timeout=10.0)
        # Returns 401 but that's from endpoint's own validation, not middleware
        assert resp.status_code == 401

    def test_tc_03_protected_api_returns_401_without_cookie(self):
        """Protected API endpoints should return 401 without cookie."""
        # Try to access protected API endpoint
        resp = httpx.get(f"{BASE_URL}/api/tickets", timeout=10.0)
        assert resp.status_code == 401
        data = resp.json()
        assert "detail" in data

    def test_tc_04_protected_api_returns_401_without_sso_cookie(self):
        """Protected API endpoints should return 401 without SSO cookie."""
        resp = httpx.get(
            f"{BASE_URL}/api/tickets",
            headers={"Cookie": "session=abc"},
            timeout=10.0
        )
        assert resp.status_code == 401
        data = resp.json()
        assert "No SSO session cookie" in data.get("detail", "") or data.get("detail") == "No cookie"

    def test_tc_05_static_frontend_paths_skip_auth(self):
        """Static frontend paths should skip auth middleware."""
        # Frontend root path
        resp = httpx.get(f"{BASE_URL}/", timeout=10.0)
        # May return 200 (frontend HTML) or 404 if frontend not served
        assert resp.status_code in (200, 404)

    def test_tc_06_spa_routes_skip_auth(self):
        """SPA routes (non-API paths) should skip auth middleware."""
        # SPA routes like /tickets/123 are handled by frontend
        resp = httpx.get(f"{BASE_URL}/tickets/YW20260101001", timeout=10.0)
        # Should return frontend HTML, not 401 from auth middleware
        assert resp.status_code in (200, 404)


class TestWhitelistPaths:
    """Test whitelist path handling."""

    def test_tc_01_health_is_whitelisted(self):
        """Health endpoint should always be accessible."""
        resp = httpx.get(f"{BASE_URL}/health", timeout=10.0)
        assert resp.status_code == 200

    def test_tc_02_auth_health_is_whitelisted(self):
        """Auth health endpoint should be accessible."""
        resp = httpx.get(f"{BASE_URL}/api/auth/health", timeout=10.0)
        assert resp.status_code == 200

    def test_tc_03_auth_me_is_whitelisted(self):
        """Auth me endpoint should be accessible for validation."""
        resp = httpx.get(f"{BASE_URL}/api/auth/me", timeout=10.0)
        # Endpoint returns 401 for invalid session, but middleware doesn't block it
        assert resp.status_code == 401


@pytest.mark.skipif(
    not os.getenv("SSO_SERVICE_AVAILABLE"),
    reason="SSO service not available for integration test"
)
class TestSsoIntegration:
    """Integration tests with real SSO service.

    These tests require:
    1. SSO service running at SSO_BASE_URL
    2. SSO_SERVICE_AVAILABLE=1 environment variable set
    """

    def test_tc_01_login_and_access_protected_api(self):
        """Test full login flow and accessing protected API."""
        # Step 1: Login to SSO
        login_resp = httpx.post(
            SSO_LOGIN_URL,
            data={"userName": "zhangsan", "password": "admin123"},
            timeout=10.0,
            follow_redirects=False
        )
        # Should get cookies in response
        assert login_resp.status_code in (200, 302)
        cookies = login_resp.cookies
        assert "JESESSIONID" in cookies or "login_sid" in cookies

        # Step 2: Use cookies to access protected API
        cookie_string = "; ".join(f"{k}={v}" for k, v in cookies.items())
        api_resp = httpx.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Cookie": cookie_string},
            timeout=10.0
        )
        assert api_resp.status_code == 200
        user_data = api_resp.json()
        assert user_data.get("success") is True
        assert "lname" in user_data
        assert "w3Account" in user_data


# Summary of test cases
TEST_CASE_SUMMARY = """
M13 SSO Authentication Module Test Summary:

TC01 Auth Health Endpoint:
  - test_tc_01_auth_health_returns_ok: Verify auth health endpoint works

TC02 Auth Me Endpoint:
  - test_tc_01_no_cookie_returns_401: No cookie = 401
  - test_tc_02_no_sso_cookie_returns_401: Non-SSO cookie = 401
  - test_tc_03_invalid_sso_cookie_returns_401: Invalid session = 401

TC03 Auth Middleware:
  - test_tc_01_health_endpoint_skips_auth: Health endpoint whitelisted
  - test_tc_02_auth_me_endpoint_skips_auth: Auth me whitelisted
  - test_tc_03_protected_api_returns_401_without_cookie: Protected APIs require auth
  - test_tc_04_protected_api_returns_401_without_sso_cookie: SSO cookie required
  - test_tc_05_static_frontend_paths_skip_auth: Static paths whitelisted
  - test_tc_06_spa_routes_skip_auth: SPA routes whitelisted

TC04 Whitelist Paths:
  - test_tc_01_health_is_whitelisted: Health accessible
  - test_tc_02_auth_health_is_whitelisted: Auth health accessible
  - test_tc_03_auth_me_is_whitelisted: Auth me accessible for validation

TC05 SSO Integration (requires SSO service):
  - test_tc_01_login_and_access_protected_api: Full login flow test
"""