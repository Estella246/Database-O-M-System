import pytest

pytestmark = pytest.mark.e2e


class TestHomePage:

    def test_tc_e2e_031_home_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        root = page.locator("#root")
        assert root.is_visible(), "#root 应可见"
        sidebar = page.locator(".sidebar, .menu-item")
        assert sidebar.count() > 0, "侧边栏菜单项应存在"
        table_wrap = page.locator("#home-list-panel")
        assert table_wrap.count() > 0, "首页工单列表容器应存在"

    def test_tc_e2e_032_home_workbench_tab_switch(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        tabs = ["pending", "pending_close", "audit_close", "leave_pending"]
        for tab_key in tabs:
            btn = page.locator(f"[data-home-workbench-tab='{tab_key}']").first
            if btn.count() == 0 or not btn.is_visible():
                continue
            btn.click()
            page.wait_for_timeout(800)
            is_active = btn.evaluate("el => el.classList.contains('active')")
            assert is_active, f"点击 '{tab_key}' 标签后应为 active 状态"
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"工作台标签切换发现 {len(js_errors)} 个 JS 错误"

    def test_tc_e2e_033_home_filter_search_interaction(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        filter_icons = page.locator("[data-home-ticket-list-filter-open]")
        if filter_icons.count() == 0:
            pytest.fail("首页筛选图标未找到")
        filter_icons.first.click()
        page.wait_for_timeout(500)
        search_input = page.locator("[data-home-ticket-list-filter-search]").first
        if search_input.count() == 0:
            pytest.fail("首页筛选搜索框未找到")
        search_input.fill("test")
        page.wait_for_timeout(500)
        close_btn = page.locator("[data-home-ticket-list-filter-close]").first
        if close_btn.count() > 0:
            close_btn.click()
            page.wait_for_timeout(300)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"首页搜索交互发现 {len(js_errors)} 个 JS 错误"

    def test_tc_e2e_034_home_ticket_list_structure(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        table = page.locator("#home-list-panel table")
        if table.count() == 0:
            pytest.fail("首页工单列表表格未渲染")
        thead = table.first.locator("thead")
        assert thead.count() > 0, "工单列表应有表头"
