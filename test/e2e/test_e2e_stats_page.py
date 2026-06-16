import pytest

pytestmark = pytest.mark.e2e


class TestStatsPage:

    def test_tc_e2e_043_stats_charts_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#stats-charts-panel, .stats-charts-page")
        assert panel.count() > 0, "统计图表面板应存在"
