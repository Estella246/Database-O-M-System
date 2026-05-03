import pytest

pytestmark = pytest.mark.e2e

PARAMS_SUB_NAV_KEYS = [
    ("params:duty-field", "责任田模块"),
    ("params:version", "版本模块"),
    ("params:group-template", "拉群模版"),
]


class TestParamsPage:

    def test_tc_e2e_039_params_sub_nav(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/params/duty-field")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        for nav_key, label in PARAMS_SUB_NAV_KEYS:
            btn = page.locator(f"[data-nav-key='{nav_key}']").first
            if btn.count() == 0:
                continue
            try:
                btn.click(timeout=5000, force=True)
            except Exception:
                btn.dispatch_event("click")
            page.wait_for_timeout(1000)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"参数配置子菜单导航发现 {len(js_errors)} 个 JS 错误"

    def test_tc_e2e_040_duty_field_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/duty-field")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#duty-field-panel, .params-config-page")
        assert panel.count() > 0, "责任田模块面板应存在"

    def test_tc_e2e_041_version_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/version")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        content = page.locator(".params-config-page, .version-params-page")
        assert content.count() > 0, "版本模块页面应存在"

    def test_tc_e2e_042_group_template_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/group-template")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        content = page.locator(".params-config-page, .group-template-page")
        assert content.count() > 0, "拉群模版页面应存在"
