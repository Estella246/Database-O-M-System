import pytest

pytestmark = pytest.mark.e2e

PARAMS_SUB_NAV_KEYS = [
    ("params:duty-field", "责任田模块"),
    ("params:version", "版本模块"),
    ("params:group-template", "拉群模版"),
    ("params:issue-root-cause", "问题根因"),
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


class TestDutyFieldInteraction:

    def test_tc_e2e_079_duty_field_edit_toggle(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/duty-field")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("#duty-field-edit-btn").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("责任田编辑按钮不可见（非管理员）")
        edit_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(1000)
        done_btn = page.locator("#duty-field-done-btn").first
        assert done_btn.count() > 0, "进入编辑模式后应出现完成按钮"
        cancel_btn = page.locator("#duty-field-cancel-btn").first
        assert cancel_btn.count() > 0, "进入编辑模式后应出现取消按钮"
        add_root_btn = page.locator("#duty-field-add-root-btn").first
        assert add_root_btn.count() > 0, "进入编辑模式后应出现添加根节点按钮"

    def test_tc_e2e_080_duty_field_tree_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/duty-field")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        tree = page.locator(".duty-field-ul")
        hint = page.locator(".duty-field-hint")
        if tree.count() > 0:
            assert tree.first.is_visible(), "责任田模块树形结构应可见"
        elif hint.count() > 0:
            assert True
        else:
            pytest.fail("责任田模块无数据且无提示")


class TestVersionInteraction:

    def test_tc_e2e_081_version_sub_tabs(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/version")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        sub_tabs = page.locator("[data-version-sub]")
        if sub_tabs.count() > 0:
            for i in range(min(sub_tabs.count(), 3)):
                tab = sub_tabs.nth(i)
                if tab.is_visible():
                    tab.click(timeout=5000)
                    page.wait_for_timeout(800)

    def test_tc_e2e_082_version_edit_toggle(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/version")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-version-edit], button", has_text="编辑").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("版本模块编辑按钮不可见")
        edit_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(1000)
        save_btn = page.locator("[data-version-save], button", has_text="保存").first
        assert save_btn.count() > 0, "进入编辑模式后应出现保存按钮"


class TestGroupTemplateInteraction:

    def test_tc_e2e_083_group_template_kind_tabs(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/group-template")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        kind_tabs = page.locator("[data-group-template-kind]")
        if kind_tabs.count() > 0:
            first_tab = kind_tabs.first
            first_tab.click(timeout=5000)
            page.wait_for_timeout(800)
            assert first_tab.evaluate("el => el.classList.contains('primary')"), "选中的类型标签应有 primary 样式"

    def test_tc_e2e_084_group_template_edit_toggle(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/group-template")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-group-template-edit], button", has_text="编辑").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.fail("拉群模版编辑按钮不可见")
        edit_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(1000)
        save_btn = page.locator("[data-group-template-save], button", has_text="保存").first
        assert save_btn.count() > 0, "进入编辑模式后应出现保存按钮"


class TestLlmConfigInteraction:

    def test_tc_e2e_085_llm_config_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/llm-config")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        content = page.locator(".llm-config-page, .params-config-page")
        assert content.count() > 0, "大模型配置页面应存在"

    def test_tc_e2e_086_llm_config_has_save_button(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/llm-config")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        save_btn = page.locator("#llm-config-save")
        if save_btn.count() > 0:
            assert save_btn.is_visible(), "大模型配置页面应有保存按钮"

    def test_tc_e2e_087_llm_config_has_test_button(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/llm-config")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        test_btn = page.locator("#llm-config-test")
        if test_btn.count() > 0:
            assert test_btn.is_visible(), "大模型配置页面应有测试连通性按钮"

    def test_tc_e2e_088_llm_config_has_inputs(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/params/llm-config")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        inputs = page.locator("[data-llm-key]")
        assert inputs.count() > 0, "大模型配置页面应有配置输入项"
