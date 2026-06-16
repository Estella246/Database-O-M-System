"""SSO configuration module - centralized config management."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env file
load_dotenv(Path(__file__).resolve().parent / ".env")

# Skip SSO authentication (for testing/development)
# Set SKIP_SSO_AUTH=1 or SKIP_SSO_AUTH=true to disable auth middleware
SKIP_SSO_AUTH = os.getenv("SKIP_SSO_AUTH", "").strip().lower() in ("1", "true", "yes", "on")

# SSO login URL - where user redirects to login
# This is the login page URL (e.g., http://app.bulezone.com/login)
SSO_LOGIN_URL = os.getenv("SSO_LOGIN_URL", "http://app.bulezone.com/login")

# SSO profile/validation URL - where backend validates cookies
# This is the API endpoint to validate session (e.g., http://login.bulezone.com/account/profile)
SSO_PROFILE_URL = os.getenv("SSO_PROFILE_URL", "http://login.bulezone.com/account/profile")

# Legacy SSO_BASE_URL for backward compatibility (if set, derives login/profile URLs)
legacy_base_url = os.getenv("SSO_BASE_URL", "")
if legacy_base_url and not os.getenv("SSO_LOGIN_URL"):
    SSO_LOGIN_URL = f"{legacy_base_url}/login"
if legacy_base_url and not os.getenv("SSO_PROFILE_URL"):
    SSO_PROFILE_URL = f"{legacy_base_url}/account/profile"

# Cookie domain for SSO cookies (used when clearing cookies on logout)
# Default to parent domain, can be overridden via env
SSO_COOKIE_DOMAIN = os.getenv("SSO_COOKIE_DOMAIN", ".bluezone.com")

# Cookie names to clear on logout
SSO_COOKIE_NAMES = ["env_token", "hwsso_login", "hwssot", "hwssot3", "idss_cid", "lang", "login_logFlag", "login_sid", "login_uid", "suid", "ztsg_ruuid"]

# Auth middleware whitelist prefixes (paths that don't require authentication)
AUTH_WHITELIST_PREFIXES = [
    "/health",
    "/api/auth/me",
    "/api/auth/config",
    "/api/auth/health",
]

# Method-specific auth whitelist: (path_prefix, allowed_methods)
# Only exempts auth for specified HTTP methods; other methods still require auth
AUTH_WHITELIST_METHOD_SPECIFIC = [
    ("/api/duty/rl-oncall", ["GET"]),
]

# Static asset prefixes (frontend resources, skip auth check)
AUTH_STATIC_PREFIXES = [
    "/",
    "/js/",
    "/css/",
    "/assets/",
    "/modules/",
    "/fonts/",
    "/images/",
]