import pytest

pytestmark = pytest.mark.e2e

PAGE_ROUTES = {
    "home": "/",
    "stats_charts": "/stats/charts",
    "stats_labor": "/stats/charts",
    "stats_ownership": "/stats/charts",
    "admin_page": "/admin/permissions",
    "leave_page": "/leave-application",
    "params_page": "/params/version",
    "requirement_page": "/requirements",
    "ai_page": "/ai-assistant",
    "report_issue": "/report/issue",
    "report_generate": "/report/generate",
}


class TestPageLoadNoJSErrors:

    def test_tc_e2e_001_home_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_002_stats_charts(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_003_stats_labor(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_004_stats_ownership(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_008_admin_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/admin/permissions")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_009_leave_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_010_params_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/version")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_011_requirement_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_012_ai_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)

    def test_tc_e2e_013_report_issue_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/report/issue")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_selector(".report-page--issue", timeout=5000)
        page.wait_for_timeout(1000)

    def test_tc_e2e_014_report_generate_page(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/report/generate")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_selector(".report-page--generate", timeout=5000)
        page.wait_for_timeout(2000)
