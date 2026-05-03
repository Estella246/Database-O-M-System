import pytest

pytestmark = pytest.mark.e2e


class TestPageLoadNoJSErrors:

    def test_tc_e2e_001_home_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_002_stats_charts(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=stats:charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_003_stats_labor(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=stats:labor")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_004_stats_ownership(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=stats:ownership")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_005_stats_report(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=stats:report")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_006_stats_skills(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=stats:skills")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_007_upload_analysis(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=upload")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_008_admin_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=admin")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_009_leave_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=leave")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_010_params_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=params")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_011_requirement_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=requirement")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_012_ai_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=ai")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
