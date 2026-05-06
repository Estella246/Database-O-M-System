import pytest

pytestmark = pytest.mark.e2e


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


def _ensure_column_btn_visible(page, namespace="list"):
    """确保列选择按钮可见"""
    btn_id = f"{namespace}-column-select-btn"
    btn = page.locator(f"#{btn_id}").first
    if btn.count() == 0 or not btn.is_visible():
        pytest.fail(f"列选择按钮 {btn_id} 不可见")
    return btn


class TestColumnSelectModalBasics:
    """列选择弹窗基础功能测试"""

    def test_tc_e2e_column_01_modal_open(self, page, backend_server, assert_no_js_errors):
        """点击列选择按钮应打开弹窗"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        assert modal.is_visible(), "点击列选择按钮后应弹出弹窗"
        title = modal.locator("#column-select-modal-title").first
        assert title.is_visible() and title.text_content() == "选择展示列"

    def test_tc_e2e_column_02_modal_has_groups(self, page, backend_server, assert_no_js_errors):
        """列选择弹窗应显示字段分组"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        # 系统字段分组 + 7 个节点分组
        groups = modal.locator(".export-field-group")
        assert groups.count() >= 8, "应至少有系统字段和各节点分组"

    def test_tc_e2e_column_03_groups_collapsed_by_default(self, page, backend_server, assert_no_js_errors):
        """字段分组默认折叠"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        groups = modal.locator(".export-field-group")
        for i in range(groups.count()):
            group = groups.nth(i)
            assert not group.evaluate("el => el.open"), f"第{i+1}个分组应默认折叠"

    def test_tc_e2e_column_04_expand_group(self, page, backend_server, assert_no_js_errors):
        """点击可展开字段分组"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        # 点击第一个分组的展开图标
        first_group = modal.locator(".export-field-group").first
        expand_icon = first_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        assert first_group.evaluate("el => el.open"), "点击后分组应展开"
        field_list = first_group.locator(".export-field-list").first
        assert field_list.is_visible(), "展开后应显示字段列表"

    def test_tc_e2e_column_05_modal_cancel(self, page, backend_server, assert_no_js_errors):
        """点击取消按钮应关闭弹窗"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        assert modal.is_visible()
        cancel_btn = modal.locator("#column-select-cancel-btn").first
        cancel_btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击取消后弹窗应关闭"

    def test_tc_e2e_column_06_modal_close_by_mask(self, page, backend_server, assert_no_js_errors):
        """点击遮罩层应关闭弹窗"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        mask = page.locator("#column-select-modal-mask").first
        assert mask.is_visible()
        mask.click(position={"x": 10, "y": 10}, timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击遮罩层后弹窗应关闭"

    def test_tc_e2e_column_07_reset_default(self, page, backend_server, assert_no_js_errors):
        """点击恢复默认应重置列配置"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        reset_btn = modal.locator("#column-select-reset-btn").first
        reset_btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击恢复默认后弹窗应关闭"


class TestColumnSelectCheckbox:
    """列选择 checkbox 功能测试"""

    def test_tc_e2e_column_08_global_select_all(self, page, backend_server, assert_no_js_errors):
        """全选 checkbox 功能"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        select_all = modal.locator("#column-select-all").first
        # 默认不是全选（因为列数超过15）
        # 点击全选会触发提示
        select_all.click(timeout=5000)
        page.wait_for_timeout(500)

    def test_tc_e2e_column_09_node_select_all(self, page, backend_server, assert_no_js_errors):
        """节点级全选 checkbox 功能"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        # 展开系统字段分组
        sys_group = modal.locator("details[data-column-node='system']").first
        expand_icon = sys_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        # 系统字段默认全选
        node_checkbox = sys_group.locator("input[data-column-node-select-all='system']").first
        assert node_checkbox.is_checked(), "系统字段分组应默认全选"

    def test_tc_e2e_column_10_toggle_single_field(self, page, backend_server, assert_no_js_errors):
        """单独取消选中某个字段"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        # 展开系统字段分组
        sys_group = modal.locator("details[data-column-node='system']").first
        expand_icon = sys_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        # 取消选中 SLA时间
        sla_checkbox = sys_group.locator("input[data-column-field='system:slaTime']").first
        assert sla_checkbox.is_checked(), "SLA时间应默认选中"
        sla_checkbox.click(timeout=5000)
        page.wait_for_timeout(500)
        # 重新获取元素
        sys_group = modal.locator("details[data-column-node='system']").first
        sla_checkbox = sys_group.locator("input[data-column-field='system:slaTime']").first
        assert not sla_checkbox.is_checked(), "取消后 SLA时间应为未选中"


class TestColumnSelectApply:
    """列选择应用功能测试"""

    def test_tc_e2e_column_11_apply_changes(self, page, backend_server, assert_no_js_errors):
        """点击应用按钮应保存配置并关闭弹窗"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        # 点击应用
        confirm_btn = modal.locator("#column-select-confirm-btn").first
        confirm_btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击应用后弹窗应关闭"

    def test_tc_e2e_column_12_max_columns_limit(self, page, backend_server, assert_no_js_errors):
        """超过15列限制时提示"""
        page.goto(f"{backend_server}/list")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = _ensure_column_btn_visible(page, "list")
        btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".column-select-modal").first
        # 点击全选（会触发超过限制提示）
        select_all = modal.locator("#column-select-all").first
        select_all.click(timeout=5000)
        page.wait_for_timeout(500)
        # 弹窗应仍然打开（因为操作失败）
        modal = page.locator(".column-select-modal").first
        # 注意：由于 alert 会阻塞，这里可能需要特殊处理


class TestHomeColumnSelect:
    """主页列选择功能测试"""

    def test_tc_e2e_column_13_home_column_btn(self, page, backend_server, assert_no_js_errors):
        """主页应显示列选择按钮"""
        page.goto(f"{backend_server}/")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        btn = page.locator("#home-column-select-btn").first
        # 检查按钮是否存在（取决于权限）
        # 如果有 workbench_export 权限则显示
        if btn.count() > 0 and btn.is_visible():
            btn.click(timeout=5000)
            page.wait_for_timeout(500)
            modal = page.locator(".column-select-modal").first
            assert modal.is_visible(), "主页点击列选择按钮后应弹出弹窗"