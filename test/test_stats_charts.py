"""统计图表聚合：模块单测 + API 集成（需后端已加载新路由）。"""
import pytest
from datetime import date

from stats_charts import (
    build_labor_payload,
    build_labor_payload_from_daily_slices,
    build_ownership_payload,
    build_ownership_payload_from_daily_slices,
    build_doer_payload,
    get_stats_charts,
    _quality_value,
)
from ticket_stats_daily import _deep_merge_sum, _deep_merge_sub


SAMPLE_ROW = {
    "startDate": "2026-02-01",
    "status": "open",
    "currentStage": "运维分析",
    "currentHandler": "张三",
    "creatorName": "张三",
    "severity": "一般",
    "isQualityIssue": "是（已知质量问题）",
    "issue_intro_module": "存储引擎/块存储/事务",
    "issue_owner_module": "存储引擎/块存储",
    "gauss_version": "505.1.0.SPC1",
    "bizEnv": "生产",
    "location": "北京局点",
    "description": "内核问题",
    "orderId": "YW20260201001",
}


class TestStatsChartsModule:
    def test_quality_value_known(self):
        assert _quality_value(SAMPLE_ROW) == "known"

    def test_build_ownership_payload(self):
        payload = build_ownership_payload(
            [SAMPLE_ROW], date(2026, 1, 1), date(2026, 3, 31), "month", "all", "all"
        )
        assert payload["time_labels"]
        assert sum(payload["trend"]["known"]) >= 1
        assert sum(payload["trend"]["total"]) >= 1
        assert sum(payload["trend"]["quality_yes"]) >= 1
        assert payload["sunburst"]["intro"]

    def test_build_ownership_payload_trend_totals(self):
        known = {**SAMPLE_ROW, "orderId": "YW20260201002", "isQualityIssue": "是（已知质量问题）"}
        new = {**SAMPLE_ROW, "orderId": "YW20260201003", "isQualityIssue": "是（新发现质量问题）"}
        no = {**SAMPLE_ROW, "orderId": "YW20260201004", "isQualityIssue": "否"}
        unset = {**SAMPLE_ROW, "orderId": "YW20260201005", "isQualityIssue": ""}
        rows = [known, new, no, unset]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        assert sum(payload["trend"]["total"]) == 4
        assert sum(payload["trend"]["quality_yes"]) == 2
        assert sum(payload["trend"]["known"]) == 1
        assert sum(payload["trend"]["new"]) == 1
        assert sum(payload["trend"]["no"]) == 1

    def test_build_ownership_payload_quality_yes(self):
        known = {**SAMPLE_ROW, "orderId": "YW20260201002", "isQualityIssue": "是（已知质量问题）"}
        new = {**SAMPLE_ROW, "orderId": "YW20260201003", "isQualityIssue": "是（新发现质量问题）"}
        no = {**SAMPLE_ROW, "orderId": "YW20260201004", "isQualityIssue": "否"}
        rows = [known, new, no]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "yes", "all")
        assert sum(payload["trend"]["known"]) == 1
        assert sum(payload["trend"]["new"]) == 1
        assert sum(payload["trend"]["no"]) == 0

    def test_build_labor_payload(self):
        payload = build_labor_payload([SAMPLE_ROW], [], "")
        assert payload["counts"]["by_person"].get("张三") == 1

    def test_get_stats_charts_invalid_view(self):
        with pytest.raises(ValueError, match="view"):
            get_stats_charts("demo_001", "bad", "2026-01-01", "2026-04-30")


class TestStatsDailyPreagg:
    def test_deep_merge_sum_sub(self):
        a = {"ownership": {"all_all": {"total": 2, "by_version": {"v1": 2}}}}
        b = {"ownership": {"all_all": {"total": 1, "by_version": {"v1": 1, "v2": 1}}}}
        merged = _deep_merge_sum(a, b)
        assert merged["ownership"]["all_all"]["total"] == 3
        assert merged["ownership"]["all_all"]["by_version"]["v1"] == 3
        assert merged["ownership"]["all_all"]["by_version"]["v2"] == 1
        left = _deep_merge_sub(merged, b)
        assert left["ownership"]["all_all"]["total"] == 2

    def test_ownership_payload_from_daily_slices_matches_row_payload(self):
        row_payload = build_ownership_payload(
            [SAMPLE_ROW], date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics

        ownership = {sk: _ownership_segment_metrics(SAMPLE_ROW) for sk in _ownership_segment_keys(SAMPLE_ROW)}
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "all",
            "all",
        )
        assert slice_payload["trend"]["known"] == row_payload["trend"]["known"]
        assert slice_payload["trend"]["total"] == row_payload["trend"]["total"]
        assert slice_payload["trend"]["quality_yes"] == row_payload["trend"]["quality_yes"]
        assert slice_payload["top_mod_intro"] == row_payload["top_mod_intro"]

    def test_labor_payload_from_daily_slices(self):
        payload = build_labor_payload([SAMPLE_ROW], [], "")
        from ticket_stats_daily import _labor_metrics

        lab = _labor_metrics(SAMPLE_ROW)
        from_slice = build_labor_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": {}, "labor": lab, "doer": {}}],
            [],
            "",
        )
        assert from_slice["counts"]["by_person"] == payload["counts"]["by_person"]

    def test_ownership_metrics_jsonb_safe(self):
        import json

        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics

        seg = _ownership_segment_metrics(SAMPLE_ROW)
        blob = json.dumps(seg, ensure_ascii=False)
        assert "\x00" not in blob
        assert "\u0000" not in blob


class TestStatsChartsApi:
    def test_labor_view(self, api_client):
        resp = api_client.get(
            "/api/stats/charts",
            params={
                "operator_id": "test_user01",
                "view": "labor",
                "start_date": "2026-01-01",
                "end_date": "2026-04-30",
            },
        )
        if resp.headers.get("content-type", "").startswith("text/html"):
            pytest.skip("后端未加载 /api/stats/charts 路由（需重启 uvicorn）")
        assert resp.status_code == 200
        body = resp.json()
        assert body["view"] == "labor"
        assert "counts" in body["payload"]

    def test_ownership_view(self, api_client):
        resp = api_client.get(
            "/api/stats/charts",
            params={
                "operator_id": "test_user01",
                "view": "ownership",
                "start_date": "2026-01-01",
                "end_date": "2026-04-30",
            },
        )
        if resp.headers.get("content-type", "").startswith("text/html"):
            pytest.skip("后端未加载 /api/stats/charts 路由")
        assert resp.status_code == 200
        assert "time_labels" in resp.json()["payload"]

    def test_doer_view(self, api_client):
        resp = api_client.get(
            "/api/stats/charts",
            params={
                "operator_id": "test_user01",
                "view": "doer",
                "start_date": "2026-01-01",
                "end_date": "2026-04-30",
            },
        )
        if resp.headers.get("content-type", "").startswith("text/html"):
            pytest.skip("后端未加载 /api/stats/charts 路由")
        assert resp.status_code == 200
        assert "usageSlices" in resp.json()["payload"]

    def test_invalid_view(self, api_client):
        resp = api_client.get(
            "/api/stats/charts",
            params={
                "operator_id": "test_user01",
                "view": "invalid",
                "start_date": "2026-01-01",
                "end_date": "2026-04-30",
            },
        )
        if resp.headers.get("content-type", "").startswith("text/html"):
            pytest.skip("后端未加载 /api/stats/charts 路由")
        assert resp.status_code == 400


class TestStatsDailyBackfillApi:
    def test_backfill_batch(self, api_client):
        resp = api_client.post(
            "/api/stats/charts/backfill",
            json={
                "operator_id": "test_user01",
                "reset": True,
                "after_ticket_id": 0,
                "batch_size": 5,
            },
        )
        if resp.headers.get("content-type", "").startswith("text/html"):
            pytest.skip("后端未加载 /api/stats/charts/backfill 路由")
        if resp.status_code == 403:
            pytest.skip("测试账号无 workbench_snapshot_rebuild 权限")
        if resp.status_code == 503:
            pytest.skip(f"日汇总不可用: {resp.text}")
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is True
        assert "logs" in body
        assert isinstance(body.get("logs"), list)
        assert "has_more" in body
