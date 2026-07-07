"""重大问题回填分批单元测试。"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


def test_backfill_count_only_returns_ticket_total():
    import routers.major_issue as mi

    conn = MagicMock()

    def _execute(sql, params=None):
        cur = MagicMock()
        if "FROM ticket" in sql and "COUNT" in sql:
            cur.fetchone.return_value = {"cnt": 12345}
        elif "FROM major_issue" in sql:
            cur.fetchone.return_value = {"cnt": 7}
        return cur

    conn.execute.side_effect = _execute
    with patch.object(mi, "db_conn") as db:
        db.return_value.__enter__.return_value = conn
        with patch.object(mi, "_can_write", return_value=True):
            result = mi._backfill_major_issues_sync({"operator_id": "admin", "count_only": True})
    assert result["count_only"] is True
    assert result["ticket_total"] == 12345
    assert result["major_issue_total"] == 7
    assert result["processed"] == 0


def test_build_sync_sql_escapes_date_regex_braces():
    import routers.major_issue as mi

    sql = mi._build_sync_sql()
    assert r"^\d{4}-\d{2}-\d{2}$" in sql
    assert "ops_ticket_filter" not in sql


def test_backfill_batch_returns_has_more_and_totals():
    import routers.major_issue as mi

    conn = MagicMock()

    def _execute(sql, params=None):
        cur = MagicMock()
        if "FROM ticket WHERE id >" in sql:
            cur.fetchall.return_value = [{"id": i} for i in range(1, 101)]
        elif "FROM major_issue" in sql:
            cur.fetchone.return_value = {"cnt": 5}
        elif "FROM ticket" in sql and "COUNT" in sql:
            cur.fetchone.return_value = {"cnt": 20000}
        return cur

    conn.execute.side_effect = _execute
    with patch.object(mi, "_backfill_ticket_ids", return_value={"upserted": 2, "removed": 0}) as sync:
        result = mi.backfill_major_issues_batch(conn, after_ticket_id=0, batch_size=100)
    assert result["processed"] == 100
    assert result["after_ticket_id"] == 100
    assert result["has_more"] is True
    assert result["ticket_total"] == 20000
    assert result["major_issue_total"] == 5
    sync.assert_called_once_with(conn, list(range(1, 101)))


def test_backfill_batch_done_when_fewer_than_batch_size():
    import routers.major_issue as mi

    conn = MagicMock()
    calls = {"n": 0}

    def _execute(sql, params=None):
        cur = MagicMock()
        if "FROM ticket WHERE id >" in sql:
            calls["n"] += 1
            if calls["n"] == 1:
                cur.fetchall.return_value = [{"id": 10}, {"id": 20}]
            else:
                cur.fetchall.return_value = []
        elif "FROM major_issue" in sql:
            cur.fetchone.return_value = {"cnt": 3}
        elif "FROM ticket" in sql and "COUNT" in sql:
            cur.fetchone.return_value = {"cnt": 95}
        return cur

    conn.execute.side_effect = _execute
    with patch.object(mi, "_backfill_ticket_ids", return_value={"upserted": 1, "removed": 0}):
        result = mi.backfill_major_issues_batch(conn, after_ticket_id=5, batch_size=100)
    assert result["has_more"] is False
    assert result["processed"] == 2
    assert result["ticket_total"] is None

    empty = mi.backfill_major_issues_batch(conn, after_ticket_id=99, batch_size=100)
    assert empty["processed"] == 0
    assert empty["has_more"] is False


def test_backfill_endpoint_requires_write_permission():
    import routers.major_issue as mi

    conn = MagicMock()
    with patch.object(mi, "db_conn") as db:
        db.return_value.__enter__.return_value = conn
        with patch.object(mi, "_can_write", return_value=False):
            with pytest.raises(HTTPException) as exc:
                mi._backfill_major_issues_sync({"operator_id": "guest"})
    assert exc.value.status_code == 403


def test_backfill_ticket_ids_only_full_syncs_qualifying():
    import routers.major_issue as mi

    conn = MagicMock()
    with patch.object(mi, "_event_levels_from_snapshot", return_value={1: "事故", 2: "P4", 3: "内部通报重大问题"}):
        with patch.object(mi, "_sync_ticket_ids", return_value={"upserted": 2}) as full_sync:
            with patch.object(mi, "_remove_major_issues_for_tickets", return_value=1) as remove:
                with patch.object(mi, "_ensure_snapshots_for_tickets") as ensure_snap:
                    result = mi._backfill_ticket_ids(conn, [1, 2, 3])
    assert result == {"upserted": 2, "removed": 1}
    ensure_snap.assert_called_once_with(conn, [1, 2, 3])
    full_sync.assert_called_once_with(conn, [1, 3])
    remove.assert_called_once_with(conn, [2])
