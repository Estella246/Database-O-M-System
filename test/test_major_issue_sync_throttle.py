"""重大问题惰性同步节流与 SQL 路径单元测试（不依赖完整库）。"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _reset_sync_clock():
    import routers.major_issue as mi

    mi._last_full_sync_monotonic = 0.0
    yield
    mi._last_full_sync_monotonic = 0.0


def test_maybe_sync_skips_bulk_within_interval():
    import routers.major_issue as mi

    conn = MagicMock()
    with patch.object(mi, "MAJOR_ISSUE_SYNC_INTERVAL_SECONDS", 120):
        with patch.object(mi, "_sync_audit_close_status") as audit:
            with patch.object(mi, "_sync_major_issues_bulk") as bulk:
                mi._last_full_sync_monotonic = time.monotonic()
                count = mi._maybe_sync_major_issues(conn, force=False)
    assert count == 0
    audit.assert_called_once_with(conn)
    bulk.assert_not_called()
    conn.commit.assert_called_once()


def test_maybe_sync_runs_bulk_when_forced():
    import routers.major_issue as mi

    conn = MagicMock()
    with patch.object(mi, "MAJOR_ISSUE_SYNC_INTERVAL_SECONDS", 120):
        with patch.object(mi, "_sync_audit_close_status"):
            with patch.object(mi, "_sync_major_issues_bulk", return_value=3) as bulk:
                mi._last_full_sync_monotonic = time.monotonic()
                count = mi._maybe_sync_major_issues(conn, force=True)
    assert count == 3
    bulk.assert_called_once_with(conn)


def test_maybe_sync_runs_bulk_when_interval_zero():
    import routers.major_issue as mi

    conn = MagicMock()
    with patch.object(mi, "MAJOR_ISSUE_SYNC_INTERVAL_SECONDS", 0):
        with patch.object(mi, "_sync_audit_close_status"):
            with patch.object(mi, "_sync_major_issues_bulk", return_value=1) as bulk:
                mi._last_full_sync_monotonic = time.monotonic()
                count = mi._maybe_sync_major_issues(conn, force=False)
    assert count == 1
    bulk.assert_called_once_with(conn)
