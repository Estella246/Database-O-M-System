"""重大问题后台分批同步单元测试。"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _reset_sync_state():
    import routers.major_issue as mi

    mi._last_background_sync_monotonic = 0.0
    mi._batch_cursor_ticket_id = 0
    yield
    mi._last_background_sync_monotonic = 0.0
    mi._batch_cursor_ticket_id = 0


def test_background_sync_skips_within_interval():
    import routers.major_issue as mi

    with patch.object(mi, "MAJOR_ISSUE_SYNC_INTERVAL_SECONDS", 120):
        with patch.object(mi, "_background_sync_lock") as lock:
            lock.acquire.return_value = True
            mi._last_background_sync_monotonic = time.monotonic()
            with patch.object(mi, "sync_major_issues_batch") as batch:
                mi._run_background_sync_batch()
    batch.assert_not_called()


def test_background_sync_runs_batch_when_interval_elapsed():
    import routers.major_issue as mi

    conn = MagicMock()
    with patch.object(mi, "MAJOR_ISSUE_SYNC_INTERVAL_SECONDS", 120):
        with patch.object(mi, "_background_sync_lock") as lock:
            lock.acquire.return_value = True
            mi._last_background_sync_monotonic = 0.0
            with patch.object(mi, "db_conn") as db:
                db.return_value.__enter__.return_value = conn
                with patch.object(
                    mi,
                    "sync_major_issues_batch",
                    return_value={"changed": 2, "batch_size": 200, "after_ticket_id": 400, "done_cycle": False},
                ) as batch:
                    mi._run_background_sync_batch()
    batch.assert_called_once_with(conn)
    conn.commit.assert_called_once()


def test_sync_batch_advances_cursor_and_resets_at_end():
    import routers.major_issue as mi

    conn = MagicMock()
    conn.execute.return_value.fetchall.side_effect = [
        [{"id": 10}, {"id": 20}],
        [],
    ]
    with patch.object(mi, "MAJOR_ISSUE_SYNC_BATCH_SIZE", 200):
        with patch.object(mi, "_sync_ticket_ids", return_value={"upserted": 1, "removed": 0}) as sync:
            result = mi.sync_major_issues_batch(conn, batch_size=200)
    assert result["batch_size"] == 2
    assert result["after_ticket_id"] == 20
    assert result["done_cycle"] is True
    sync.assert_called_once_with(conn, [10, 20])

    result2 = mi.sync_major_issues_batch(conn, batch_size=200)
    assert result2["done_cycle"] is True
    assert result2["batch_size"] == 0
    assert mi._batch_cursor_ticket_id == 0
