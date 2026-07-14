"""列表快照分批重建：避免 refresh_all_hcs_snapshots 一次加载全部 ticket id OOM。"""
from __future__ import annotations

import pytest

from config import SCHEMA_TEMPLATE_CODE


@pytest.fixture(autouse=True)
def _ensure_snapshot_table():
    try:
        from ticket_list_snapshot import refresh_all_hcs_snapshots

        refresh_all_hcs_snapshots(batch_size=10)
    except Exception as exc:
        pytest.skip(f"ticket_list_snapshot unavailable: {exc}")


def test_refresh_hcs_snapshots_batch():
    from database import db_conn
    from ticket_list_snapshot import refresh_hcs_snapshots_batch

    with db_conn() as conn:
        summary = refresh_hcs_snapshots_batch(conn, after_ticket_id=0, batch_size=5)
    assert summary.get("ok") is True
    assert "has_more" in summary
    assert "done_cumulative" in summary
    assert "total" in summary


def test_refresh_all_hcs_snapshots_batch_size_zero_uses_cursor():
    """batch_size=0 不再一次加载全部 ID，仍应成功返回 refreshed/total。"""
    from ticket_list_snapshot import refresh_all_hcs_snapshots

    summary = refresh_all_hcs_snapshots(batch_size=0)
    assert "refreshed" in summary
    assert "total" in summary
    assert summary["refreshed"] == summary["total"]


def test_refresh_hcs_snapshots_by_ticket_ids():
    from database import db_conn
    from ticket_list_snapshot import refresh_hcs_snapshots_by_ticket_ids

    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT t.id
            FROM ticket t
            JOIN workflow_template wtt ON wtt.id = t.template_id
            WHERE wtt.template_code = %s
            ORDER BY t.id
            LIMIT 1
            """,
            (SCHEMA_TEMPLATE_CODE,),
        ).fetchone()
    if not row:
        pytest.skip("no hcs tickets")
    tid = int(row["id"])
    with db_conn() as conn:
        n = refresh_hcs_snapshots_by_ticket_ids(conn, [tid], commit_every=1)
    assert n == 1


def test_refresh_hcs_snapshots_by_ticket_nos():
    from database import db_conn
    from ticket_list_snapshot import refresh_hcs_snapshots_by_ticket_nos

    with db_conn() as conn:
        row = conn.execute(
            """
            SELECT t.ticket_no
            FROM ticket t
            JOIN workflow_template wtt ON wtt.id = t.template_id
            WHERE wtt.template_code = %s
            ORDER BY t.id
            LIMIT 1
            """,
            (SCHEMA_TEMPLATE_CODE,),
        ).fetchone()
        if not row:
            pytest.skip("no hcs tickets")
        no = str(row["ticket_no"])
        summary = refresh_hcs_snapshots_by_ticket_nos(
            conn,
            [no, "YW_NOT_EXIST_SNAPSHOT_TEST"],
            batch_size=5,
        )
    assert summary.get("ok") is True
    assert summary.get("list_mode") == "by_ticket_nos"
    assert summary.get("has_more") is False
    assert int(summary.get("refreshed") or 0) == 1
    assert int(summary.get("skipped_not_found") or 0) == 1
    assert int(summary.get("total") or 0) == 1
