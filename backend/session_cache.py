"""Session cache module - caches validated SSO sessions to avoid repeated verification.

This module provides a TTL-based cache for storing validated SSO user sessions.
Each cached entry includes user info, verification timestamp, and expiration time.

Architecture:
    Request → AuthMiddleware → Cache Lookup → Cache Hit? → Return cached user
                                          ↓ Cache Miss
                                      SSO Verify → DB Query → Cache Update → Return user

Cache Key Design:
    Key = f"{hwssot_cookie}:{login_sid_cookie}"
    - Uses two core SSO cookies (hwssot and login_sid)
    - Simple concatenation with colon separator
    - Empty cookie values use empty string

Cache Value (CacheEntry):
    - sso_user: SSO user info (lname, userName, email)
    - local_user: Local user info (account, role_code, group_name)
    - w3_account: User account identifier
    - verified_at: Timestamp when SSO verified this session
    - expires_at: Timestamp when cache entry expires
    - is_dev_mode: Whether this was verified in development mode

Security:
    - Cache only stores sessions that passed SSO verification
    - Cookie tampering results in different cache key (no cache hit)
    - First-time verification always goes through SSO service
    - TTL is shorter than SSO session validity period
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, asdict
from typing import Optional

from cachetools import TTLCache
from dotenv import load_dotenv
from pathlib import Path

# Load .env file
load_dotenv(Path(__file__).resolve().parent / ".env")

# Cache configuration
SESSION_CACHE_ENABLED = os.getenv("SESSION_CACHE_ENABLED", "1").strip().lower() in ("1", "true", "yes", "on")
SESSION_CACHE_MAXSIZE = int(os.getenv("SESSION_CACHE_MAXSIZE", "500"))
SESSION_CACHE_TTL = int(os.getenv("SESSION_CACHE_TTL", "300"))  # 5 minutes


@dataclass
class CacheEntry:
    """Cached session entry containing validated user info."""
    sso_user: dict
    local_user: dict
    w3_account: str
    verified_at: float
    expires_at: float
    is_dev_mode: bool


class SessionCache:
    """TTL-based cache for validated SSO sessions."""

    def __init__(self, maxsize: int = SESSION_CACHE_MAXSIZE, ttl: int = SESSION_CACHE_TTL):
        self._cache: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._maxsize = maxsize
        self._ttl = ttl
        self._hit_count = 0
        self._miss_count = 0
        self._enabled = SESSION_CACHE_ENABLED

    def _make_key(self, hwssot: str, login_sid: str) -> str:
        """Generate cache key from SSO cookies."""
        return f"{hwssot or ''}:{login_sid or ''}"

    def get(self, hwssot: str, login_sid: str) -> Optional[CacheEntry]:
        """Get cached session entry if exists and not expired."""
        if not self._enabled:
            return None

        key = self._make_key(hwssot, login_sid)
        entry = self._cache.get(key)

        if entry is not None:
            # Check if entry has expired (additional safety check)
            if entry.expires_at > time.time():
                self._hit_count += 1
                return entry
            else:
                # Remove expired entry
                del self._cache[key]

        self._miss_count += 1
        return None

    def set(
        self,
        hwssot: str,
        login_sid: str,
        sso_user: dict,
        local_user: dict,
        w3_account: str,
        is_dev_mode: bool = False
    ) -> CacheEntry:
        """Store validated session in cache."""
        if not self._enabled:
            # Still return entry even if caching disabled (for consistency)
            now = time.time()
            return CacheEntry(
                sso_user=sso_user,
                local_user=local_user,
                w3_account=w3_account,
                verified_at=now,
                expires_at=now + self._ttl,
                is_dev_mode=is_dev_mode
            )

        key = self._make_key(hwssot, login_sid)
        now = time.time()
        entry = CacheEntry(
            sso_user=sso_user,
            local_user=local_user,
            w3_account=w3_account,
            verified_at=now,
            expires_at=now + self._ttl,
            is_dev_mode=is_dev_mode
        )

        self._cache[key] = entry
        return entry

    def invalidate(self, hwssot: str, login_sid: str) -> bool:
        """Remove a specific cached session."""
        if not self._enabled:
            return False

        key = self._make_key(hwssot, login_sid)
        if key in self._cache:
            del self._cache[key]
            return True
        return False

    def clear(self) -> int:
        """Clear all cached sessions."""
        if not self._enabled:
            return 0

        count = len(self._cache)
        self._cache.clear()
        return count

    def stats(self) -> dict:
        """Get cache statistics."""
        total_requests = self._hit_count + self._miss_count
        hit_rate = self._hit_count / total_requests if total_requests > 0 else 0.0

        return {
            "enabled": self._enabled,
            "total_entries": len(self._cache),
            "maxsize": self._maxsize,
            "ttl_seconds": self._ttl,
            "hit_count": self._hit_count,
            "miss_count": self._miss_count,
            "hit_rate": round(hit_rate, 4),
            "total_requests": total_requests,
        }

    def is_enabled(self) -> bool:
        """Check if cache is enabled."""
        return self._enabled


# Global session cache instance
_session_cache: Optional[SessionCache] = None


def init_session_cache() -> SessionCache:
    """Initialize global session cache (called on app startup)."""
    global _session_cache
    if _session_cache is None:
        _session_cache = SessionCache()
    return _session_cache


def get_session_cache() -> SessionCache:
    """Get global session cache instance."""
    global _session_cache
    if _session_cache is None:
        _session_cache = SessionCache()
    return _session_cache


def get_cached_session(hwssot: str, login_sid: str) -> Optional[CacheEntry]:
    """Convenience function to get cached session."""
    return get_session_cache().get(hwssot, login_sid)


def set_cached_session(
    hwssot: str,
    login_sid: str,
    sso_user: dict,
    local_user: dict,
    w3_account: str,
    is_dev_mode: bool = False
) -> CacheEntry:
    """Convenience function to set cached session."""
    return get_session_cache().set(hwssot, login_sid, sso_user, local_user, w3_account, is_dev_mode)


def invalidate_session(hwssot: str, login_sid: str) -> bool:
    """Convenience function to invalidate a specific session."""
    return get_session_cache().invalidate(hwssot, login_sid)


def clear_all_sessions() -> int:
    """Convenience function to clear all cached sessions."""
    return get_session_cache().clear()


def get_cache_stats() -> dict:
    """Convenience function to get cache statistics."""
    return get_session_cache().stats()