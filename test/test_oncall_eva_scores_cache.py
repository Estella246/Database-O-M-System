"""运维效率 /scores 结果缓存单元测试。"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _reset_scores_cache():
    import routers.oncall_eva as eva

    eva._scores_cache.clear()
    yield
    eva._scores_cache.clear()


def test_scores_cache_hit_skips_db_compute():
    import routers.oncall_eva as eva

    key = eva._scores_cache_key(2026, 5, "", set())
    payload = {"period": {"year": 2026, "month": 5}, "team": {}, "items": []}
    eva._scores_cache_set(key, payload)

    with patch.object(eva, "db_conn") as db_conn_mock:
        result = eva.list_scores(year=2026, month=5, min_dept=None)
    assert result is payload
    db_conn_mock.assert_not_called()


def test_scores_force_refresh_bypasses_cache():
    import routers.oncall_eva as eva

    key = eva._scores_cache_key(2026, 5, "", set())
    eva._scores_cache_set(key, {"period": {"year": 2026, "month": 5}, "team": {}, "items": []})
    computed = {"period": {"year": 2026, "month": 5}, "team": {"headcount": 1}, "items": [{"account": "a"}]}

    conn = MagicMock()
    with patch.object(eva, "ONCALL_EVA_SCORES_CACHE_SECONDS", 120):
        with patch.object(eva, "db_conn") as db_conn_mock:
            db_conn_mock.return_value.__enter__.return_value = conn
            with patch.object(eva, "_compute_scores_payload", return_value=computed) as compute:
                result = eva.list_scores(
                    year=2026, month=5, min_dept=None, force_refresh=True,
                )
    assert result == computed
    compute.assert_called_once()
    assert eva._scores_cache_get(key) == computed
