import pytest

pytestmark = pytest.mark.e2e


class TestStatsPage:

    def test_tc_e2e_043_stats_charts_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#stats-charts-panel, .stats-charts-page")
        assert panel.count() > 0, "统计图表面板应存在"

    def test_tc_e2e_044_stats_report_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/report")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        content = page.locator(".stats-report-toolbar-outer, .stats-report-page")
        assert content.count() > 0, "工单分析页面应存在"

    def test_tc_e2e_046_upload_analysis_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/upload-analysis")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        upload_btn = page.locator("#upload-file-input, .upload-file-btn-text")
        assert upload_btn.count() > 0, "人力分析页面应包含上传按钮"
