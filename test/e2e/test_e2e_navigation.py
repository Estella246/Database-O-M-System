import pytest

pytestmark = pytest.mark.e2e

NAV_ITEMS = [
    "统计图表",
    "上传分析",
    "管理后台",
    "请假管理",
    "参数配置",
    "需求管理",
    "AI助手",
]


class TestNavigationNoJSErrors:

    def test_tc_e2e_013_sidebar_navigation(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        for label in NAV_ITEMS:
            link = page.locator(f"text={label}").first
            if link.is_visible():
                try:
                    link.click(timeout=5000)
                except Exception:
                    link.dispatch_event("click")
                page.wait_for_timeout(1000)

    def test_tc_e2e_014_browser_back_forward(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        page.goto(f"{backend_server}/?tab=stats:charts")
        page.wait_for_timeout(2000)
        page.go_back()
        page.wait_for_timeout(2000)
        page.go_forward()
        page.wait_for_timeout(2000)

    def test_tc_e2e_015_deep_link_direct_access(self, page, backend_server, assert_no_js_errors):
        deep_links = [
            "/?tab=stats:charts",
            "/?tab=admin",
            "/?tab=leave",
            "/?tab=params",
            "/?tab=requirement",
            "/?tab=ai",
        ]
        for link in deep_links:
            page.goto(f"{backend_server}{link}")
            page.wait_for_selector("#root", timeout=10000)
            page.wait_for_timeout(1500)
