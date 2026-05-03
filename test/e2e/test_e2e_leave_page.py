import pytest

pytestmark = pytest.mark.e2e


class TestLeavePage:

    def test_tc_e2e_037_leave_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#leave-application-panel")
        assert panel.count() > 0, "请假申请面板应存在"

    def test_tc_e2e_038_leave_form_elements(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/leave-application")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        tabs = page.locator("[data-leave-tab]")
        if tabs.count() == 0:
            pytest.skip("请假标签页未找到")
        for i in range(tabs.count()):
            tab = tabs.nth(i)
            if tab.is_visible():
                tab.click()
                page.wait_for_timeout(800)
        search_input = page.locator("#leave-app-search-input")
        if search_input.count() > 0:
            search_input.fill("test")
            page.wait_for_timeout(500)
            search_input.fill("")
            page.wait_for_timeout(300)
        table = page.locator(".leave-app-table")
        assert table.count() > 0, "请假列表表格应存在"
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"请假页面交互发现 {len(js_errors)} 个 JS 错误"
