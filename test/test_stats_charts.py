"""统计图表聚合：模块单测 + API 集成（需后端已加载新路由）。"""
import pytest
from datetime import date

from stats_charts import (
    OWNERSHIP_R_LINES,
    build_labor_payload,
    build_labor_payload_from_daily_slices,
    build_ownership_payload,
    build_ownership_payload_from_daily_slices,
    build_doer_payload,
    get_stats_charts,
    _quality_value,
    _ownership_payload_empty,
    _r_of_version,
    _c_of_version,
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

    def test_build_ownership_payload_precision_quarter(self):
        q1 = {**SAMPLE_ROW, "orderId": "YW20260201011", "startDate": "2026-02-01"}
        q2 = {**SAMPLE_ROW, "orderId": "YW20260401012", "startDate": "2026-04-15"}
        payload = build_ownership_payload(
            [q1, q2], date(2026, 1, 1), date(2026, 6, 30), "quarter", "all", "all"
        )
        assert payload["time_labels"] == ["2026Q1", "2026Q2"]
        assert payload["precision"] == "quarter"
        assert sum(payload["trend"]["total"]) == 2
        assert payload["trend"]["total"][0] == 1
        assert payload["trend"]["total"][1] == 1

    def test_r_version_includes_507(self):
        assert "507" in OWNERSHIP_R_LINES
        assert _r_of_version("507.0.0") == "507"
        assert _r_of_version("507.1.0.SPC0100") == "507"
        row = {**SAMPLE_ROW, "orderId": "YW20260201007", "gauss_version": "507.0.0"}
        payload = build_ownership_payload(
            [row], date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert "507" in payload["by_r_version_time"]
        assert sum(payload["by_r_version_time"]["507"]) == 1
        assert sum(payload["by_r_version_time"]["505"]) == 0

    def test_r_of_version_from_gaussdb_kernel_label(self):
        assert _r_of_version("GaussDB Kernel 505.2.0.SPC0900") == "505"
        assert _r_of_version("GaussDB Kernel 506.0.0.SPC0100") == "506"
        assert _r_of_version("GaussDB Kernel 503.1.0") == "503"
        assert _r_of_version("GaussDB Kernel 507.0.0") == "507"
        assert _r_of_version("GaussDB 506.0") == "506"
        assert _r_of_version("V500R001C00") == "V5R001"
        assert _r_of_version("V500R002C10") == "V5R002"
        assert _r_of_version("V_Test_1.0") == ""
        assert _r_of_version("未知版本") == ""
        rows = [
            {**SAMPLE_ROW, "orderId": "YW20260201503", "gauss_version": "GaussDB Kernel 503.1.0"},
            {**SAMPLE_ROW, "orderId": "YW20260201505", "gauss_version": "GaussDB Kernel 505.2.0.SPC0900"},
            {**SAMPLE_ROW, "orderId": "YW20260201506", "gauss_version": "GaussDB Kernel 506.0.0.SPC0100"},
            {**SAMPLE_ROW, "orderId": "YW20260201599", "gauss_version": "V_Test_1.0"},
        ]
        payload = build_ownership_payload(
            rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert sum(payload["by_r_version_time"]["503"]) == 1
        assert sum(payload["by_r_version_time"]["505"]) == 1
        assert sum(payload["by_r_version_time"]["506"]) == 1
        assert sum(payload["by_r_version_time"]["507"]) == 0

    def test_c_of_version_vrc_and_dotted(self):
        assert _c_of_version("V500R001C00") == "V500R001C00"
        assert _c_of_version("V500R002C10") == "V500R002C10"
        assert _c_of_version("v500r001c00spc0100") == "V500R001C00"
        assert _c_of_version("505.2.1") == "505.2.1"
        assert _c_of_version("505.1.1") == "505.1.1"
        assert _c_of_version("505.1.0.SPC1") == "505.1.0"
        assert _c_of_version("GaussDB Kernel 505.2.0.SPC0900") == "505.2.0"
        assert _c_of_version("505.2.1.B021") == "505.2.1"
        assert _c_of_version("503.0.RC3") == "503.0.RC3"
        assert _c_of_version("503.0.RC3.B013") == "503.0.RC3"
        assert _c_of_version("503.0.rc3.b013") == "503.0.RC3"
        assert _c_of_version("GaussDB Kernel 503.0.RC3.B013") == "503.0.RC3"
        assert _c_of_version("505.2.RC1") == "505.2.RC1"
        assert _c_of_version("505.2.RC1.B001") == "505.2.RC1"
        assert _c_of_version("505.2") == ""
        assert _c_of_version("未知版本") == ""
        assert _c_of_version("") == ""
        assert _r_of_version("503.0.RC3.B013") == "503"
        assert _r_of_version("GaussDB Kernel 503.0.RC3.B013") == "503"

    def test_ownership_by_c_version_time_merges_b_into_c(self):
        """C 粒度：多个 B 版本归到同一 C；VxxxRxxxCxx、x.y.z、x.y.RCz 均可识别。"""
        rows = [
            {**SAMPLE_ROW, "orderId": "YW20260201C01", "gauss_version": "505.1.0.V00"},
            {**SAMPLE_ROW, "orderId": "YW20260201C02", "gauss_version": "505.1.0.V01"},
            {**SAMPLE_ROW, "orderId": "YW20260201C03", "gauss_version": "V500R001C00"},
            {**SAMPLE_ROW, "orderId": "YW20260201C04", "gauss_version": "V500R002C10"},
            {**SAMPLE_ROW, "orderId": "YW20260201C05", "gauss_version": "505.2"},
            {**SAMPLE_ROW, "orderId": "YW20260201C06", "gauss_version": "503.0.RC3.B013"},
            {**SAMPLE_ROW, "orderId": "YW20260201C07", "gauss_version": "503.0.RC3.B014"},
            {**SAMPLE_ROW, "orderId": "YW20260201C08", "gauss_version": "503.0.RC3"},
        ]
        payload = build_ownership_payload(
            rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        c_time = payload["by_c_version_time"]
        assert sum(c_time["505.1.0"]) == 2
        assert sum(c_time["V500R001C00"]) == 1
        assert sum(c_time["V500R002C10"]) == 1
        assert sum(c_time["503.0.RC3"]) == 3
        assert "505.2" not in c_time
        assert "505.1.0.V00" not in c_time
        assert "503.0.RC3.B013" not in c_time
        assert list(c_time.keys())[0] == "503.0.RC3"
        b_total = sum(sum(pts) for pts in payload["by_version_time"].values())
        c_total = sum(sum(pts) for pts in c_time.values())
        assert b_total == 8
        assert c_total == 7
        assert sum(payload["by_version_time"].get("505.2") or []) == 1
        assert sum(payload["by_r_version_time"]["503"]) == 3

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
        assert slice_payload["by_c_version_time"]["505.1.0"] == c_time["505.1.0"]
        assert slice_payload["by_c_version_time"]["503.0.RC3"] == c_time["503.0.RC3"]
        assert set(slice_payload["by_c_version_time"]) == set(c_time)

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

    def test_build_ownership_payload_omits_by_biz_env_time(self):
        """已去掉现网问题来源数量趋势，payload 不再返回 by_biz_env_time。"""
        payload = build_ownership_payload(
            [SAMPLE_ROW], date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert "by_biz_env_time" not in payload
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": {}, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "all",
            "all",
        )
        assert "by_biz_env_time" not in slice_payload

    def test_ownership_stage_and_env_pie(self):
        """工单发生阶段/环境/来源分布：按问题阶段、问题环境、产品线全量出饼，空值归未知。"""
        rows = [
            {**SAMPLE_ROW, "orderId": "YW20260201A01", "bizEnv": "运维阶段", "problem_env": "生产环境", "product_line": "公有云"},
            {**SAMPLE_ROW, "orderId": "YW20260201A02", "bizEnv": "运维阶段", "problem_env": "生产环境", "product_line": "公有云"},
            {**SAMPLE_ROW, "orderId": "YW20260201A03", "bizEnv": "POC阶段", "problem_env": "测试环境", "product_line": "混合云（HCS）"},
            {**SAMPLE_ROW, "orderId": "YW20260201A04", "bizEnv": "", "problem_env": "", "product_line": ""},
            {**SAMPLE_ROW, "orderId": "YW20260201A05", "bizEnv": "交付阶段", "problemEnv": "测试环境", "productLine": "混合云（轻量化）"},
        ]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        stage = {x["name"]: x["value"] for x in payload["stage_pie"]}
        env = {x["name"]: x["value"] for x in payload["env_pie"]}
        source = {x["name"]: x["value"] for x in payload["source_pie"]}
        assert stage == {"运维阶段": 2, "POC阶段": 1, "交付阶段": 1, "未知阶段": 1}
        assert env == {"生产环境": 2, "测试环境": 2, "未知环境": 1}
        assert source == {"公有云": 2, "混合云（HCS）": 1, "混合云（轻量化）": 1, "未知产品线": 1}
        assert [x["name"] for x in payload["stage_pie"]][0] == "运维阶段"
        assert [x["name"] for x in payload["source_pie"]][0] == "公有云"
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
        assert slice_payload["stage_pie"] == payload["stage_pie"]
        assert slice_payload["env_pie"] == payload["env_pie"]
        assert slice_payload["source_pie"] == payload["source_pie"]
        assert slice_payload["quality_source_pie"] == payload["quality_source_pie"]
        assert slice_payload["top_site"] == payload["top_site"]
        assert slice_payload["top_site_quality"] == payload["top_site_quality"]
        # 该组样例均为质量问题，两张来源饼应一致
        assert payload["quality_source_pie"] == payload["source_pie"]

    def test_ownership_env_pie_missing_on_legacy_daily_slices(self):
        """旧日汇总无 by_problem_env 时环境饼为空，需行级回补。"""
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics
        from stats_charts import _daily_slices_missing_problem_env, _ownership_segment_key

        row = {**SAMPLE_ROW, "problem_env": "生产环境", "bizEnv": "运维阶段"}
        ownership = {sk: _ownership_segment_metrics(row) for sk in _ownership_segment_keys(row)}
        for seg in ownership.values():
            seg.pop("by_problem_env", None)
        slices = [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}]
        payload = build_ownership_payload_from_daily_slices(
            slices, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert payload["env_pie"] == []
        assert payload["stage_pie"] == [{"name": "运维阶段", "value": 1}]
        assert _daily_slices_missing_problem_env(slices, _ownership_segment_key("all", "all")) is True

    def test_ownership_source_pie_missing_on_legacy_daily_slices(self):
        """旧日汇总无 by_product_line 时来源饼为空，需行级回补。"""
        from ticket_stats_daily import _ownership_segment_keys, _ownership_segment_metrics
        from stats_charts import _daily_slices_missing_product_line, _ownership_segment_key

        row = {**SAMPLE_ROW, "product_line": "公有云", "bizEnv": "运维阶段"}
        ownership = {sk: _ownership_segment_metrics(row) for sk in _ownership_segment_keys(row)}
        for seg in ownership.values():
            seg.pop("by_product_line", None)
        slices = [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}]
        payload = build_ownership_payload_from_daily_slices(
            slices, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert payload["source_pie"] == []
        assert payload["stage_pie"] == [{"name": "运维阶段", "value": 1}]
        assert _daily_slices_missing_product_line(slices, _ownership_segment_key("all", "all")) is True

    def test_ownership_quality_source_pie_filters_quality_yes(self):
        """质量问题来源分布：仅计入已知/新发现质量问题；工单问题来源分布仍为全量。"""
        rows = [
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201Q01",
                "product_line": "公有云",
                "isQualityIssue": "是（已知质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201Q02",
                "product_line": "公有云",
                "isQualityIssue": "是（新发现质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201Q03",
                "product_line": "公有云",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201Q04",
                "product_line": "混合云（HCS）",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201Q05",
                "product_line": "混合云（轻量化）",
                "isQualityIssue": "",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201Q06",
                "product_line": "混合云（HCS）",
                "isQualityIssue": "是（已知质量问题）",
            },
        ]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        source = {x["name"]: x["value"] for x in payload["source_pie"]}
        qsource = {x["name"]: x["value"] for x in payload["quality_source_pie"]}
        assert source == {"公有云": 3, "混合云（HCS）": 2, "混合云（轻量化）": 1}
        assert qsource == {"公有云": 2, "混合云（HCS）": 1}

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
        assert slice_payload["source_pie"] == payload["source_pie"]
        assert slice_payload["quality_source_pie"] == payload["quality_source_pie"]
        assert slice_payload["top_site_quality"] == payload["top_site_quality"]

    def test_ownership_issue_type_time_filters_quality_yes(self):
        """TOP类型问题趋势：仅计入已知/新发现质量问题，按问题类型出线；否与未填不计入。"""
        rows = [
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201T01",
                "issue_type": "coredump",
                "isQualityIssue": "是（已知质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201T02",
                "issue_type": "coredump",
                "isQualityIssue": "是（新发现质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201T03",
                "issue_type": "coredump",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201T04",
                "issue_type": "慢",
                "isQualityIssue": "是（已知质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201T05",
                "issue_type": "满",
                "isQualityIssue": "",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201T06",
                "issue_type": "",
                "isQualityIssue": "是（新发现质量问题）",
            },
        ]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        by_type = {k: sum(v) for k, v in payload["by_issue_type_time"].items()}
        assert by_type == {"coredump": 2, "慢": 1, "未知类型": 1}
        assert list(payload["by_issue_type_time"].keys())[0] == "coredump"

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
        assert slice_payload["by_issue_type_time"] == payload["by_issue_type_time"]

    def test_ownership_quality_top_site_filters_quality_yes(self):
        """质量问题TOP局点：仅计入已知/新发现质量问题；工单数量TOP局点仍为全量。"""
        rows = [
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201S01",
                "location": "北京局点",
                "isQualityIssue": "是（已知质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201S02",
                "location": "北京局点",
                "isQualityIssue": "是（新发现质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201S03",
                "location": "北京局点",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201S04",
                "location": "上海局点",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201S05",
                "location": "广州局点",
                "isQualityIssue": "",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201S06",
                "location": "上海局点",
                "isQualityIssue": "是（已知质量问题）",
            },
        ]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        sites = {x["name"]: x["value"] for x in payload["top_site"]}
        qsites = {x["name"]: x["value"] for x in payload["top_site_quality"]}
        assert sites == {"北京局点": 3, "上海局点": 2, "广州局点": 1}
        assert qsites == {"北京局点": 2, "上海局点": 1}

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
        assert slice_payload["top_site"] == payload["top_site"]
        assert slice_payload["top_site_quality"] == payload["top_site_quality"]

    def test_ownership_quality_top_version_filters_quality_yes(self):
        """质量问题TOP版本：仅计入已知/新发现质量问题；工单数量TOP版本仍为全量。"""
        rows = [
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201V11",
                "gauss_version": "505.1.0",
                "isQualityIssue": "是（已知质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201V12",
                "gauss_version": "505.1.0",
                "isQualityIssue": "是（新发现质量问题）",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201V13",
                "gauss_version": "505.1.0",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201V14",
                "gauss_version": "506.0.0",
                "isQualityIssue": "否",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201V15",
                "gauss_version": "506.0.0",
                "isQualityIssue": "",
            },
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201V16",
                "gauss_version": "503.2.0",
                "isQualityIssue": "是（已知质量问题）",
            },
        ]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        all_vers = {k: sum(v) for k, v in payload["by_version_time"].items()}
        q_vers = {k: sum(v) for k, v in payload["by_version_time_quality"].items()}
        assert all_vers == {"505.1.0": 3, "506.0.0": 2, "503.2.0": 1}
        assert q_vers == {"505.1.0": 2, "503.2.0": 1}

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
        assert {k: sum(v) for k, v in slice_payload["by_version_time"].items()} == all_vers
        assert {k: sum(v) for k, v in slice_payload["by_version_time_quality"].items()} == q_vers

    def test_ownership_quality_version_time_excludes_no_and_unset(self):
        """质量问题版本趋势：不是「否」的计入（已知/新发现）；否与未填不计入。全量版本趋势仍含否。"""
        known = {
            **SAMPLE_ROW,
            "orderId": "YW20260201V01",
            "gauss_version": "505.1.0.SPC1",
            "isQualityIssue": "是（已知质量问题）",
        }
        new = {
            **SAMPLE_ROW,
            "orderId": "YW20260201V02",
            "gauss_version": "505.2.0",
            "isQualityIssue": "是（新发现质量问题）",
        }
        no = {
            **SAMPLE_ROW,
            "orderId": "YW20260201V03",
            "gauss_version": "506.0.0",
            "isQualityIssue": "否",
        }
        unset = {
            **SAMPLE_ROW,
            "orderId": "YW20260201V04",
            "gauss_version": "503.1.0",
            "isQualityIssue": "",
        }
        rows = [known, new, no, unset]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        all_vers = set(payload["by_version_time"])
        q_vers = set(payload["by_version_time_quality"])
        assert all_vers == {"505.1.0.SPC1", "505.2.0", "506.0.0", "503.1.0"}
        assert q_vers == {"505.1.0.SPC1", "505.2.0"}
        assert sum(payload["by_version_time"]["506.0.0"]) == 1
        assert sum(payload["by_version_time_quality"]["505.1.0.SPC1"]) == 1
        assert sum(payload["by_c_version_time_quality"].get("505.2.0") or []) == 1
        assert sum(payload["by_r_version_time_quality"]["505"]) == 2
        assert sum(payload["by_r_version_time_quality"]["506"]) == 0
        assert sum(payload["by_r_version_time"]["506"]) == 1

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
        assert set(slice_payload["by_version_time_quality"]) == q_vers
        assert slice_payload["by_version_time_quality"] == payload["by_version_time_quality"]
        assert slice_payload["by_c_version_time_quality"] == payload["by_c_version_time_quality"]
        assert slice_payload["by_r_version_time_quality"]["505"] == payload["by_r_version_time_quality"]["505"]
        assert slice_payload["by_version_time"] == payload["by_version_time"]

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

    def test_build_labor_payload_person_stage_from_instances(self):
        """各阶段人员滞留：按传入的节点实例历史，一单可计多阶段。"""
        row = {**SAMPLE_ROW, "orderId": "YW20260201999", "status": "closed", "currentHandler": "李四"}
        person_stage = {"李四": {"运维分析": 1, "开发分析": 1, "审核关闭": 1}}
        payload = build_labor_payload([row], [], "", person_stage_counts=person_stage)
        assert payload["counts"]["by_person_stage"]["李四"] == {
            "运维分析": 1,
            "开发分析": 1,
            "审核关闭": 1,
        }

    def test_build_labor_payload_person_stage_hours_from_instances(self):
        """人员/问题平均滞留：实例人×阶段小时；阶段柱用传入的阶段平均小时。"""
        row = {**SAMPLE_ROW, "orderId": "YW20260201999", "status": "closed", "currentHandler": "李四"}
        person_hours = {"李四": {"运维分析": 12.0, "开发分析": 8.0, "审核关闭": 2.0}}
        stage_hours = {
            "问题审核": 0.0,
            "运维分析": 12.0,
            "开发分析": 8.0,
            "开发闭环": 0.0,
            "运维闭环": 0.0,
            "审核关闭": 2.0,
        }
        payload = build_labor_payload(
            [row],
            [],
            "",
            person_stage_hours=person_hours,
            stage_hours=stage_hours,
        )
        assert payload["dwell"]["by_person_stage_hours"]["李四"] == person_hours["李四"]
        assert payload["dwell"]["by_stage_hours"]["运维分析"] == 12.0
        assert payload["dwell"]["by_stage_hours"]["开发分析"] == 8.0
        assert payload["dwell"]["by_stage_hours"]["审核关闭"] == 2.0

    def test_instance_dwell_hours_open_uses_now(self):
        from datetime import datetime, timezone, timedelta
        from stats_charts import _instance_dwell_hours

        now = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)
        started = now - timedelta(hours=5)
        assert _instance_dwell_hours(started, None, now_utc=now) == 5.0
        assert _instance_dwell_hours(started, now - timedelta(hours=2), now_utc=now) == 3.0
        assert _instance_dwell_hours(None, now, now_utc=now) is None

    def test_labor_exclude_save_amend_sql_present(self):
        """滞留统计 SQL 须排除保存/补录实例，避免 ~0h 实例拉低平均。"""
        from stats_charts import _LABOR_EXCLUDE_SAVE_AMEND_SQL

        sql = _LABOR_EXCLUDE_SAVE_AMEND_SQL
        assert "ticket_node_data" in sql
        assert "draft" in sql
        assert "amended" in sql
        assert "NOT EXISTS" in sql

    def test_avg_hours_from_dwell_bucket(self):
        from stats_charts import avg_hours_from_dwell_bucket

        now_ms = 1_000_000_000_000.0
        # 已结束 2h×1 + 未结束从 now-4h 起 → (2+4)/2 = 3
        started_open_ms = now_ms - 4 * 3600000.0
        assert avg_hours_from_dwell_bucket(
            {"sum_h": 2.0, "cnt": 1, "sum_start_ms": started_open_ms, "cnt_open": 1},
            now_ms=now_ms,
        ) == 3
        assert avg_hours_from_dwell_bucket(
            {"sum_h": 1.0, "cnt": 1, "sum_start_ms": 0.0, "cnt_open": 0},
            now_ms=now_ms,
        ) == 1
        assert avg_hours_from_dwell_bucket({}, now_ms=now_ms) == 0.0

    def test_labor_payload_from_daily_slices_instance_dwell(self):
        """日汇总 dwell_by_* 累加器应直接还原人员/问题平均滞留，无需再扫实例。"""
        from ticket_stats_daily import _labor_metrics

        lab = _labor_metrics(
            SAMPLE_ROW,
            submitters=["李四"],
            person_stages={"李四": {"运维分析": 1}},
            dwell_acc={
                "by_person_stage": {
                    "李四": {"运维分析": {"sum_h": 1.0, "cnt": 1, "sum_start_ms": 0.0, "cnt_open": 0}}
                },
                "by_stage": {
                    "运维分析": {"sum_h": 1.0, "cnt": 1, "sum_start_ms": 0.0, "cnt_open": 0}
                },
            },
        )
        assert lab["dwell_by_person_stage"]["李四"]["运维分析"]["sum_h"] == 1.0
        from_slice = build_labor_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": {}, "labor": lab, "doer": {}}],
            [],
            "",
        )
        assert from_slice["dwell"]["by_person_stage_hours"]["李四"]["运维分析"] == 1
        assert from_slice["dwell"]["by_stage_hours"]["运维分析"] == 1
        assert from_slice["counts"]["by_person_stage"]["李四"]["运维分析"] == 1

    def test_build_labor_payload_closed_fallback_audit_close(self):
        """无实例数据时回退：已关闭计入「审核关闭」。"""
        closed = {
            **SAMPLE_ROW,
            "orderId": "YW20260201999",
            "status": "closed",
            "currentStage": "审核关闭",
            "currentHandler": "李四",
        }
        payload = build_labor_payload([closed], [], "")
        assert payload["counts"]["by_person_stage"].get("李四", {}).get("审核关闭") == 1
        assert "关闭" not in (payload["counts"]["by_person_stage"].get("李四") or {})

    def test_build_labor_payload(self):
        payload = build_labor_payload([SAMPLE_ROW], [], "")
        assert payload["counts"]["by_person"].get("张三") == 1
        assert payload["counts"]["by_person_open"].get("张三") == 1
        assert payload["counts"]["by_person_stage_open"].get("张三", {}).get("运维分析") == 1

    def test_build_labor_payload_person_stage_open_filters_current_stage(self):
        """未闭环滞留人按阶段筛：仅当前阶段未闭环计入 by_person_stage_open。"""
        ops = {**SAMPLE_ROW, "currentHandler": "张三", "currentStage": "运维分析"}
        dev = {
            **SAMPLE_ROW,
            "orderId": "YW20260201002",
            "currentHandler": "李四",
            "currentStage": "开发分析",
        }
        closed = {
            **SAMPLE_ROW,
            "orderId": "YW20260201003",
            "status": "closed",
            "currentHandler": "王五",
            "currentStage": "审核关闭",
        }
        payload = build_labor_payload([ops, dev, closed], [], "")
        open_stage = payload["counts"]["by_person_stage_open"]
        assert open_stage.get("张三", {}).get("运维分析") == 1
        assert open_stage.get("李四", {}).get("开发分析") == 1
        assert "王五" not in open_stage
        assert payload["counts"]["by_person_open"].get("张三") == 1
        assert payload["counts"]["by_person_open"].get("李四") == 1
        assert payload["counts"]["by_person_open"].get("王五") is None

    def test_build_labor_payload_from_slices_exposes_person_stage_open(self):
        """日汇总读出须带 by_person_stage_open，供前端阶段下拉筛选。"""
        from_slice = build_labor_payload_from_daily_slices(
            [
                {
                    "labor": {
                        "by_person_submit": {"张三": 1},
                        "by_person_open": {"张三": 1, "李四": 1},
                        "by_stage_open": {"运维分析": 1, "开发分析": 1},
                        "by_person_stage_open": {
                            "张三": {"运维分析": 1},
                            "李四": {"开发分析": 1},
                        },
                        "by_stage_all": {"运维分析": 1, "开发分析": 1},
                        "by_person_stage": {},
                        "by_person_flow": {},
                    }
                }
            ],
            [],
            "",
        )
        assert from_slice["counts"]["by_person_stage_open"]["张三"]["运维分析"] == 1
        assert from_slice["counts"]["by_person_stage_open"]["李四"]["开发分析"] == 1

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

    def test_flow_flags_from_last_ops_dest(self):
        """归类只看运维分析最后一次提交去向，历史走过开发分析不单独记透传。"""
        from stats_charts import flow_flags_from_last_ops_dest

        assert flow_flags_from_last_ops_dest("dev_analysis") == (True, False)
        assert flow_flags_from_last_ops_dest("ops_closure") == (False, True)
        assert flow_flags_from_last_ops_dest("dev_closure") == (False, True)
        assert flow_flags_from_last_ops_dest("ops_analysis") == (False, False)
        assert flow_flags_from_last_ops_dest("") == (False, False)

    def test_build_labor_payload_flow_passthrough_key(self):
        """流转详细占比：按运维分析最后提交人计票，早期节点不计（不看关单）。"""
        from stats_charts import LABOR_FLOW_COMMANDO, LABOR_FLOW_INDEPENDENT, resolve_labor_flow_key

        assert (
            resolve_labor_flow_key(
                status="open",
                current_stage="运维分析",
                has_commando=True,
            )
            == ""
        )
        assert (
            resolve_labor_flow_key(
                status="closed",
                current_stage="运维分析",
                has_commando=True,
            )
            == ""
        )
        assert (
            resolve_labor_flow_key(
                status="open",
                current_stage="审核关闭",
                has_independent=True,
            )
            == LABOR_FLOW_INDEPENDENT
        )
        assert (
            resolve_labor_flow_key(
                status="closed",
                current_stage="已关闭",
                has_commando=True,
            )
            == LABOR_FLOW_COMMANDO
        )

        early = {**SAMPLE_ROW, "_laborFlowKey": "", "_laborFlowPerson": "张三"}
        indep = {
            **SAMPLE_ROW,
            "currentStage": "审核关闭",
            "currentHandler": "创建人甲",
            "_laborFlowKey": LABOR_FLOW_INDEPENDENT,
            "_laborFlowPerson": "运维甲",
        }
        cmd = {
            **SAMPLE_ROW,
            "currentStage": "审核关闭",
            "currentHandler": "创建人乙",
            "_laborFlowKey": LABOR_FLOW_COMMANDO,
            "_laborFlowPerson": "运维乙",
        }
        no_anchor = {
            **SAMPLE_ROW,
            "currentStage": "审核关闭",
            "currentHandler": "某人",
            "_laborFlowKey": LABOR_FLOW_COMMANDO,
            "_laborFlowPerson": "",
        }
        payload = build_labor_payload([early, indep, cmd, no_anchor], [], "")
        assert payload["counts"]["by_person_flow"].get("张三") is None
        assert payload["counts"]["by_person_flow"].get("创建人甲") is None
        assert payload["counts"]["by_person_flow"].get("某人") is None
        assert payload["counts"]["by_person_flow"]["运维甲"][LABOR_FLOW_INDEPENDENT] == 1
        assert payload["counts"]["by_person_flow"]["运维乙"][LABOR_FLOW_COMMANDO] == 1

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
        assert slice_payload["stage_pie"] == row_payload["stage_pie"]
        assert slice_payload["env_pie"] == row_payload["env_pie"]
        assert slice_payload["source_pie"] == row_payload["source_pie"]
        assert slice_payload["quality_source_pie"] == row_payload["quality_source_pie"]
        assert slice_payload["by_issue_type_time"] == row_payload["by_issue_type_time"]
        assert slice_payload["top_site"] == row_payload["top_site"]
        assert slice_payload["top_site_quality"] == row_payload["top_site_quality"]

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

    def test_ownership_l1_bars_all_l2_modules(self):
        """一级模块透视：一级下二级模块全量出柱，不截断 Top20。"""
        rows = [
            {
                **SAMPLE_ROW,
                "orderId": f"YW20260202{i:03d}",
                "issue_intro_module": f"存储引擎/二级{i:02d}/叶子",
                "issue_owner_module": f"存储引擎/二级{i:02d}/叶子",
            }
            for i in range(22)
        ]
        payload = build_ownership_payload(rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all")
        bars = payload["l1_bars"]["intro"]["storage_raw"]
        assert len(bars) == 22
        assert {x["name"] for x in bars} == {f"二级{i:02d}" for i in range(22)}

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
        assert "未知版本" not in payload["version_category_table"]["cols"]

    def test_ownership_by_version_time_includes_all_valid_versions(self):
        """按版本透视 / 版本问题类别走势：时间窗内全部有效版本，不截断 TopN；仍排除未知版本。"""
        rows = []
        for i in range(12):
            rows.append(
                {
                    **SAMPLE_ROW,
                    "orderId": f"YW20260201{100 + i}",
                    "gauss_version": f"505.1.0.V{i:02d}",
                }
            )
        rows.append(
            {
                **SAMPLE_ROW,
                "orderId": "YW20260201199",
                "gauss_version": "",
                "hcsVersion": "",
                "description": "无版本",
            }
        )
        payload = build_ownership_payload(
            rows, date(2026, 2, 1), date(2026, 2, 28), "month", "all", "all"
        )
        assert len(payload["by_version_time"]) == 12
        assert "未知版本" not in payload["by_version_time"]
        for i in range(12):
            ver = f"505.1.0.V{i:02d}"
            assert ver in payload["by_version_time"]
            assert sum(payload["by_version_time"][ver]) == 1
        # 版本问题类别走势：同样收录全部有效版本
        assert len(payload["version_category_table"]["cols"]) == 12
        assert "未知版本" not in payload["version_category_table"]["cols"]
        assert set(payload["version_category_table"]["cols"]) == set(payload["by_version_time"])

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
        assert len(slice_payload["by_version_time"]) == 12
        assert "未知版本" not in slice_payload["by_version_time"]
        assert set(slice_payload["by_version_time"]) == set(payload["by_version_time"])
        assert len(slice_payload["version_category_table"]["cols"]) == 12
        assert set(slice_payload["version_category_table"]["cols"]) == set(payload["by_version_time"])

    def test_ownership_by_version_time_excludes_zero_count_versions(self):
        """按版本透视不展示数量为 0 的版本。"""
        from ticket_stats_daily import _deep_merge_sum, _ownership_segment_keys, _ownership_segment_metrics

        ownership: dict = {}
        for t in ({**SAMPLE_ROW, "orderId": "YW20260201200", "gauss_version": "505.9.0"},):
            for sk in _ownership_segment_keys(t):
                seg = _ownership_segment_metrics(t)
                ownership[sk] = _deep_merge_sum(ownership.get(sk) or {}, seg) if sk in ownership else seg
        # 日汇总里残留数量为 0 的版本键，不应进入图表
        for sk, seg in ownership.items():
            by_ver = dict(seg.get("by_version") or {})
            by_ver["505.0.0.ZERO"] = 0
            seg["by_version"] = by_ver
            ownership[sk] = seg
        slice_payload = build_ownership_payload_from_daily_slices(
            [{"stats_day": "2026-02-01", "ownership": ownership, "labor": {}, "doer": {}}],
            date(2026, 2, 1),
            date(2026, 2, 28),
            "month",
            "all",
            "all",
        )
        assert "505.0.0.ZERO" not in slice_payload["by_version_time"]
        assert "505.0.0.ZERO" not in slice_payload["version_category_table"]["cols"]
        assert "505.9.0" in slice_payload["by_version_time"]
        assert sum(slice_payload["by_version_time"]["505.9.0"]) == 1

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

    def test_labor_payload_from_daily_slices_by_person_flow(self):
        """日汇总应直接带出流转占比，且兼容旧键名「流转至尖刀连」。"""
        from stats_charts import LABOR_FLOW_COMMANDO, LABOR_FLOW_INDEPENDENT
        from ticket_stats_daily import _labor_metrics

        indep = {
            **SAMPLE_ROW,
            "currentStage": "审核关闭",
            "currentHandler": "创建人甲",
            "_laborFlowKey": LABOR_FLOW_INDEPENDENT,
            "_laborFlowPerson": "运维甲",
        }
        cmd = {
            **SAMPLE_ROW,
            "currentStage": "审核关闭",
            "currentHandler": "创建人乙",
            "_laborFlowKey": LABOR_FLOW_COMMANDO,
            "_laborFlowPerson": "运维乙",
        }
        row_payload = build_labor_payload([indep, cmd], [], "")
        lab_a = _labor_metrics(indep, submitters=["运维甲"])
        lab_b = _labor_metrics(cmd, submitters=["运维乙"])
        from_slice = build_labor_payload_from_daily_slices(
            [
                {"stats_day": "2026-02-01", "ownership": {}, "labor": lab_a, "doer": {}},
                {"stats_day": "2026-02-02", "ownership": {}, "labor": lab_b, "doer": {}},
            ],
            [],
            "",
        )
        assert from_slice["counts"]["by_person_flow"] == row_payload["counts"]["by_person_flow"]
        assert from_slice["counts"]["by_person_flow"]["运维甲"][LABOR_FLOW_INDEPENDENT] == 1
        assert from_slice["counts"]["by_person_flow"]["运维乙"][LABOR_FLOW_COMMANDO] == 1

        legacy = build_labor_payload_from_daily_slices(
            [
                {
                    "stats_day": "2026-02-03",
                    "ownership": {},
                    "labor": {"by_person_flow": {"运维丙": {"流转至尖刀连": 2}}},
                    "doer": {},
                }
            ],
            [],
            "",
        )
        assert legacy["counts"]["by_person_flow"]["运维丙"][LABOR_FLOW_COMMANDO] == 2

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
