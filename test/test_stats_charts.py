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
    _ownership_payload_empty,
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
        assert "no" not in payload["trend"]

    def test_build_ownership_dual_payload_quality_scoped(self):
        known = {**SAMPLE_ROW, "orderId": "YW20260201002", "isQualityIssue": "是（已知质量问题）"}
        no = {**SAMPLE_ROW, "orderId": "YW20260201004", "isQualityIssue": "否"}
        rows = [known, no]
        all_payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        yes_payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "yes", "all")
        assert sum(all_payload["trend"]["total"]) == 2
        assert sum(yes_payload["trend"]["total"]) == 1
        assert all_payload["sunburst"]["intro"]
        assert yes_payload["sunburst"]["intro"]
        assert sum(all_payload["trend"]["total"]) > sum(yes_payload["trend"]["total"])

    def test_build_ownership_payload_quality_yes(self):
        known = {**SAMPLE_ROW, "orderId": "YW20260201002", "isQualityIssue": "是（已知质量问题）"}
        new = {**SAMPLE_ROW, "orderId": "YW20260201003", "isQualityIssue": "是（新发现质量问题）"}
        no = {**SAMPLE_ROW, "orderId": "YW20260201004", "isQualityIssue": "否"}
        rows = [known, new, no]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "yes", "all")
        assert sum(payload["trend"]["known"]) == 1
        assert sum(payload["trend"]["new"]) == 1
        assert "no" not in payload["trend"]
        assert payload["sunburst"]["intro"]
        assert payload["sunburst"]["intro"][0]["name"] == "存储引擎"

    def test_build_labor_payload(self):
        payload = build_labor_payload([SAMPLE_ROW], [], "")
        assert payload["counts"]["by_person"].get("张三") == 1

    def test_build_labor_payload_counts_submitters_not_current_handler(self):
        """走过单即计入：流转后当前处理人变了，原提交人仍计 1。"""
        row = {
            **SAMPLE_ROW,
            "currentHandler": "李四",
            "creatorName": "王五",
            "_laborSubmitters": ["张三"],
        }
        payload = build_labor_payload([row], [], "")
        assert payload["counts"]["by_person"].get("张三") == 1
        assert payload["counts"]["by_person"].get("李四") is None
        # 滞留类仍按当前处理人
        assert payload["counts"]["by_person_open"].get("李四") == 1

    def test_build_labor_payload_same_person_ticket_once(self):
        row = {
            **SAMPLE_ROW,
            "_laborSubmitters": ["张三", "张三"],
        }
        payload = build_labor_payload([row], [], "")
        assert payload["counts"]["by_person"].get("张三") == 1

    def test_build_labor_payload_include_collab(self):
        row = {
            **SAMPLE_ROW,
            "currentHandler": "李四",
            "collaborator": "赵六 z000001；钱七 q000002",
            "_laborSubmitters": ["张三"],
        }
        without = build_labor_payload([row], [], "", include_collab=False)
        with_collab = build_labor_payload([row], [], "", include_collab=True)
        assert without["counts"]["by_person"].get("张三") == 1
        assert without["counts"]["by_person"].get("赵六") is None
        assert with_collab["counts"]["by_person"].get("张三") == 1
        assert with_collab["counts"]["by_person"].get("赵六") == 1
        assert with_collab["counts"]["by_person"].get("钱七") == 1

    def test_build_labor_payload_collab_dedup_with_submitter(self):
        """提交人同时又是协同人时，同人同单仍只计 1。"""
        row = {
            **SAMPLE_ROW,
            "collaborator": "张三 z000001；赵六 z000002",
            "_laborSubmitters": ["张三"],
        }
        payload = build_labor_payload([row], [], "", include_collab=True)
        assert payload["counts"]["by_person"].get("张三") == 1
        assert payload["counts"]["by_person"].get("赵六") == 1

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
        assert (
            slice_payload["l1_bars"]["intro"]["storage_dedup"]
            == row_payload["l1_bars"]["intro"]["storage_dedup"]
        )
        assert (
            slice_payload["l1_bars"]["owner"]["storage_dedup"]
            == row_payload["l1_bars"]["owner"]["storage_dedup"]
        )

    def test_ownership_l1_bars_dedup_without_dts_no(self):
        row = {**SAMPLE_ROW, "dts_no": ""}
        row_payload = build_ownership_payload([row], date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics

        ownership = {sk: _ownership_segment_metrics(row) for sk in _ownership_segment_keys(row)}
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "all",
            "all",
        )
        assert slice_payload["l1_bars"]["intro"]["storage_dedup"] == row_payload["l1_bars"]["intro"]["storage_dedup"]
        assert slice_payload["l1_bars"]["intro"]["storage_raw"] == row_payload["l1_bars"]["intro"]["storage_raw"]

    def test_ownership_l1_bars_dedup_dts_no(self):
        rows = [
            {**SAMPLE_ROW, "orderId": "YW20260201001", "dts_no": "DTS-001"},
            {**SAMPLE_ROW, "orderId": "YW20260201002", "dts_no": "DTS-001"},
        ]
        row_payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics, _deep_merge_sum

        ownership: dict = {}
        for t in rows:
            for sk in _ownership_segment_keys(t):
                seg = _ownership_segment_metrics(t)
                ownership[sk] = _deep_merge_sum(ownership.get(sk) or {}, seg) if sk in ownership else seg
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "all",
            "all",
        )
        assert slice_payload["l1_bars"]["intro"]["storage_dedup"] == row_payload["l1_bars"]["intro"]["storage_dedup"]
        assert slice_payload["l1_bars"]["intro"]["storage_dedup"] == [{"name": "块存储", "value": 1}]

    def test_ownership_l1_bars_user_module_path(self):
        """存储引擎/段页管理/空闲空间管理 + DTS：一级模块透视应计入段页管理。"""
        row = {
            **SAMPLE_ROW,
            "orderId": "YW20260605008",
            "startDate": "2026-06-05",
            "dts_no": "DTS-20260605001",
            "issue_intro_module": "存储引擎/段页管理/空闲空间管理",
            "issue_owner_module": "存储引擎/段页管理/空闲空间管理",
        }
        payload = build_ownership_payload(
            [row], date(2026, 6, 1), date(2026, 6, 30), "month", "all", "all"
        )
        intro_dedup = payload["l1_bars"]["intro"]["storage_dedup"]
        owner_dedup = payload["l1_bars"]["owner"]["storage_dedup"]
        assert intro_dedup == [{"name": "段页管理", "value": 1}]
        assert owner_dedup == [{"name": "段页管理", "value": 1}]

    def test_ownership_l1_bars_legacy_json_array_module_path(self):
        raw = '[”SQL引擎，“分区表”，“分区自动扩展”]'
        row = {
            **SAMPLE_ROW,
            "orderId": "YW20260605009",
            "startDate": "2026-06-05",
            "issue_intro_module": raw,
            "issue_owner_module": raw,
        }
        payload = build_ownership_payload(
            [row], date(2026, 6, 1), date(2026, 6, 30), "month", "all", "all"
        )
        intro_dedup = payload["l1_bars"]["intro"]["sql_dedup"]
        assert intro_dedup == [{"name": "分区表", "value": 1}]

    def test_ownership_l1_bars_patch_from_rows_when_daily_dedup_empty(self):
        from stats_charts import _patch_l1_bars_from_rows
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics

        row = {
            **SAMPLE_ROW,
            "orderId": "YW20260605008",
            "startDate": "2026-06-05",
            "dts_no": "DTS-20260605001",
            "issue_intro_module": "存储引擎/段页管理/空闲空间管理",
            "issue_owner_module": "存储引擎/段页管理/空闲空间管理",
        }
        # 模拟旧日汇总：仅有 module_intro_l2，dedup 专用字段缺失
        seg = _ownership_segment_metrics({**row, "dts_no": ""})
        seg.pop("dts_dedup_intro_l2", None)
        seg.pop("dts_dedup_owner_l2", None)
        ownership = {sk: seg for sk in _ownership_segment_keys(row)}
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-06-05", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 6, 1),
            date(2026, 6, 30),
            "month",
            "all",
            "all",
        )
        assert slice_payload["l1_bars"]["intro"]["storage_dedup"] == [{"name": "段页管理", "value": 1}]
        slice_payload["l1_bars"] = {"intro": {"storage_dedup": []}, "owner": {"storage_dedup": []}}
        patched = _patch_l1_bars_from_rows(
            slice_payload, [row], date(2026, 6, 1), date(2026, 6, 30), "month", "all", "all"
        )
        assert patched["l1_bars"]["intro"]["storage_dedup"] == [{"name": "段页管理", "value": 1}]

    def test_ownership_payload_from_daily_slices_quality_yes_sunburst(self):
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics, _deep_merge_sum

        ownership: dict = {}
        for t in (
            SAMPLE_ROW,
            {**SAMPLE_ROW, "orderId": "YW20260201004", "isQualityIssue": "否"},
        ):
            for sk in _ownership_segment_keys(t):
                seg = _ownership_segment_metrics(t)
                ownership[sk] = _deep_merge_sum(ownership.get(sk) or {}, seg) if sk in ownership else seg
        row_payload = build_ownership_payload(
            [SAMPLE_ROW], date(2026, 2, 1), date(2026, 2, 28), "month", "yes", "all"
        )
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "yes",
            "all",
        )
        assert slice_payload["sunburst"]["intro"] == row_payload["sunburst"]["intro"]
        assert sum(slice_payload["trend"]["total"]) == sum(row_payload["trend"]["total"])

    def test_ownership_payload_excludes_unknown_version_and_empty_module(self):
        rows = [
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201010",
                "gauss_version": "",
                "hcsVersion": "",
                "description": "响应时间0.2秒超时，误差0.00",
            },
            {**SAMPLE_ROW, "orderId": "YW20260201011", "issue_intro_module": "", "issue_owner_module": ""},
        ]
        payload = build_ownership_payload(
            rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert "未知版本" not in payload["by_version_time"]
        assert "未知版本" not in {x["name"] for x in payload["top_ver"]}
        assert "0.2" not in payload["by_version_time"]
        assert "0.00" not in payload["by_version_time"]
        assert "未填写" not in {x["name"] for x in payload["top_mod_intro"]}
        assert payload["sunburst"]["intro"] == build_ownership_payload(
            [SAMPLE_ROW], date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )["sunburst"]["intro"]
        assert "未填写" not in payload["hotspot"]["intro"]["moduleRows"]
        assert "未知版本" not in payload["version_category_table"]["cols"]

    def test_ownership_sunburst_excludes_not_filled_placeholders(self):
        rows = [
            {**SAMPLE_ROW, "orderId": "YW20260201020", "issue_intro_module": "存储引擎/块存储"},
            {**SAMPLE_ROW, "orderId": "YW20260201021", "issue_intro_module": ""},
        ]
        payload = build_ownership_payload(
            rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        intro = payload["sunburst"]["intro"]
        names: list[str] = []

        def collect(nodes):
            for n in nodes or []:
                names.append(str(n.get("name") or ""))
                collect(n.get("children"))

        collect(intro)
        assert "未填写" not in names
        assert any(n.get("name") == "存储引擎" for n in intro)

        from ticket_stats_daily import _deep_merge_sum, _ownership_segment_keys, _ownership_segment_metrics

        ownership: dict = {}
        for t in rows:
            for sk in _ownership_segment_keys(t):
                seg = _ownership_segment_metrics(t)
                ownership[sk] = _deep_merge_sum(ownership.get(sk) or {}, seg) if sk in ownership else seg
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "all",
            "all",
        )
        assert slice_payload["sunburst"]["intro"] == intro

    def test_ownership_payload_empty_helper(self):
        assert _ownership_payload_empty({"trend": {"total": [0, 0]}, "sunburst": {"intro": [], "owner": []}})
        assert not _ownership_payload_empty(
            {"trend": {"total": [0, 0]}, "sunburst": {"intro": [{"name": "存储引擎", "children": []}]}}
        )

    def test_labor_payload_from_daily_slices(self):
        row = {**SAMPLE_ROW, "_laborSubmitters": ["张三"]}
        payload = build_labor_payload([row], [], "")
        from ticket_stats_daily import _labor_metrics

        lab = _labor_metrics(SAMPLE_ROW, submitters=["张三"])
        from_slice = build_labor_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": {}, "labor": lab, "doer": {}}],
            [],
            "",
        )
        assert from_slice["counts"]["by_person"] == payload["counts"]["by_person"]

    def test_labor_payload_from_daily_slices_include_collab(self):
        from ticket_stats_daily import _labor_metrics

        ticket = {
            **SAMPLE_ROW,
            "collaborator": "赵六 z000001",
            "_laborSubmitters": ["张三"],
        }
        lab = _labor_metrics(ticket, submitters=["张三"])
        assert lab["by_person_submit"].get("张三") == 1
        assert lab["by_person_collab"].get("赵六") == 1
        without = build_labor_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": {}, "labor": lab, "doer": {}}],
            [],
            "",
            include_collab=False,
        )
        with_collab = build_labor_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": {}, "labor": lab, "doer": {}}],
            [],
            "",
            include_collab=True,
        )
        assert without["counts"]["by_person"].get("张三") == 1
        assert without["counts"]["by_person"].get("赵六") is None
        assert with_collab["counts"]["by_person"].get("赵六") == 1

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
