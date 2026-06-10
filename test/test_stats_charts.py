"""统计图表聚合：模块单测 + API 集成（需后端已加载新路由）。"""
import pytest
from datetime import date

from stats_charts import (
    build_labor_payload,
    build_ownership_payload,
    build_doer_payload,
    get_stats_charts,
    _quality_value,
)


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
        assert payload["sunburst"]["intro"]

    def test_build_labor_payload(self):
        payload = build_labor_payload([SAMPLE_ROW], [], "")
        assert payload["counts"]["by_person"].get("张三") == 1

    def test_get_stats_charts_invalid_view(self):
        with pytest.raises(ValueError, match="view"):
            get_stats_charts("demo_001", "bad", "2026-01-01", "2026-04-30")


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
