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

DEEP_LINK_PATHS = [
    "/stats/charts",
    "/admin/permissions",
    "/leave-application",
    "/params/version",
    "/requirements",
    "/ai-assistant",
    "/settings/appearance",
    "/workbench",
    "/duty-roster",
        "/upload-analysis",
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
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_timeout(2000)
        page.go_back()
        page.wait_for_timeout(2000)
        page.go_forward()
        page.wait_for_timeout(2000)

    def test_tc_e2e_015_deep_link_direct_access(self, page, backend_server, assert_no_js_errors):
        for path in DEEP_LINK_PATHS:
            page.goto(f"{backend_server}{path}")
            page.wait_for_selector("#root", timeout=10000)
            page.wait_for_timeout(1500)

    def test_tc_e2e_028_sidebar_collapse_expand(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        collapse_btn = page.locator("#collapse-btn")
        if collapse_btn.count() == 0:
            pytest.fail("Collapse button not found")
        collapse_btn.first.click()
        page.wait_for_timeout(500)
        is_collapsed = page.evaluate("document.querySelector('.layout').classList.contains('left-collapsed')")
        assert is_collapsed, "点击折叠按钮后侧边栏应折叠"
        collapse_btn.first.click()
        page.wait_for_timeout(500)
        is_expanded = page.evaluate("!document.querySelector('.layout').classList.contains('left-collapsed')")
        assert is_expanded, "再次点击折叠按钮后侧边栏应展开"
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"侧边栏折叠展开发现 {len(js_errors)} 个 JS 错误"

    def test_tc_e2e_029_sidebar_nav_page_render(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        nav_checks = [
            ("工作台", ".table-wrap"),
            ("值班表", ".duty-roster-card, .table-wrap, #duty-roster-panel"),
        ]
        for label, selector in nav_checks:
            link = page.locator(f"text={label}").first
            if not link.is_visible():
                continue
            try:
                link.click(timeout=5000)
            except Exception:
                link.dispatch_event("click")
            page.wait_for_timeout(2000)
            content = page.locator(selector).first
            assert content.is_visible(), f"点击'{label}'后应渲染 {selector}"
        settings_btn = page.locator("[data-nav-key='settings:appearance']").first
        if settings_btn.count() > 0 and settings_btn.is_visible():
            try:
                settings_btn.click(timeout=5000)
            except Exception:
                settings_btn.dispatch_event("click")
            page.wait_for_timeout(2000)
            settings_content = page.locator(".settings-page, #settings-custom-bg-clear").first
            assert settings_content.is_visible(), "点击'设置'后应渲染设置页面"
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"侧边栏导航验证发现 {len(js_errors)} 个 JS 错误"

    def test_tc_e2e_sidebar_perm_settings_no_vertical_overlap(self, page, backend_server):
        """侧栏「权限策略」与底栏「设置」垂直方向不得叠字（小视口下主菜单应可滚动）。"""
        page.set_viewport_size({"width": 1000, "height": 520})
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        perm = page.locator('[data-nav-key="admin:permissions"]').first
        settings = page.locator('[data-nav-key="settings:appearance"]').first
        if perm.count() == 0 or settings.count() == 0:
            pytest.fail("侧栏无权限策略或设置入口（白名单不可见）")
        if not perm.is_visible() or not settings.is_visible():
            pytest.fail("权限策略或设置按钮不可见")
        overlap = page.evaluate(
            """() => {
              const a = document.querySelector('[data-nav-key="admin:permissions"]');
              const b = document.querySelector('[data-nav-key="settings:appearance"]');
              if (!a || !b) return { ok: true, skipped: true };
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              const intersectY = Math.max(ra.top, rb.top) < Math.min(ra.bottom, rb.bottom);
              return { ok: !intersectY, intersectY, ra: { t: ra.top, b: ra.bottom }, rb: { t: rb.top, b: rb.bottom } };
            }"""
        )
        if overlap.get("skipped"):
            pytest.fail("DOM 中未找到两按钮")
        assert overlap.get("ok"), (
            "侧栏「权限策略」与「设置」垂直方向不应相交；"
            f"intersectY={overlap.get('intersectY')} perm={overlap.get('ra')} settings={overlap.get('rb')}"
        )

    def test_tc_e2e_030_workspace_tab_open_close(self, page, backend_server, collect_js_errors):
        # 轻量烟雾；完整 workspace-tabs 场景见 test/e2e/test_e2e_workspace_tabs.py。
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        nav_keys = ["list", "duty:roster", "settings:appearance"]
        for key in nav_keys:
            btn = page.locator(f"[data-nav-key='{key}']").first
            if btn.is_visible():
                try:
                    btn.click(timeout=5000)
                except Exception:
                    btn.dispatch_event("click")
                page.wait_for_timeout(800)
        tab_count = page.locator(".workspace-tab").count()
        assert tab_count >= 2, f"应至少打开 2 个标签页，实际 {tab_count}"
        close_btns = page.locator(".workspace-tab-close")
        if close_btns.count() > 0:
            close_btns.first.click()
            page.wait_for_timeout(500)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"标签页关闭发现 {len(js_errors)} 个 JS 错误"
