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

# SSO server base URL
SSO_BASE_URL = os.getenv("SSO_BASE_URL", "http://login.bluezone.com:5000")

# SSO login URL (derived from base URL)
SSO_LOGIN_URL = f"{SSO_BASE_URL}/login"

# SSO profile API endpoint
SSO_PROFILE_URL = f"{SSO_BASE_URL}/account/profile"

# Cookie domain for SSO cookies (used when clearing cookies on logout)
# Default to parent domain, can be overridden via env
SSO_COOKIE_DOMAIN = os.getenv("SSO_COOKIE_DOMAIN", ".bluezone.com")

# Cookie names to clear on logout
SSO_COOKIE_NAMES = ["JESESSIONID", "login_sid", "login_uid", "sso_login"]

# Auth middleware whitelist prefixes (paths that don't require authentication)
AUTH_WHITELIST_PREFIXES = [
    "/health",
    "/api/auth/me",
    "/api/auth/config",
    "/api/auth/health",
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