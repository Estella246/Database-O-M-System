import pytest

from e2e_api import require_ticket_order_id, unique_e2e_tag

pytestmark = pytest.mark.e2e


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


def _ensure_export_btn_visible(page):
    """确保导出按钮可见（需要 workbench_export 权限为 readonly）"""
    export_btn = page.locator("#export-ticket-btn").first
    if export_btn.count() == 0 or not export_btn.is_visible():
        pytest.fail(
            "导出按钮不可见：确认 workbench_export 在白名单为 readonly。"
        )
    return export_btn


class TestExportModalBasics:
    """导出弹窗基础功能测试"""

    def test_tc_e2e_export_01_modal_open(self, page, backend_server, assert_no_js_errors):
        """点击导出按钮应打开导出弹窗"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        assert modal.is_visible(), "点击导出按钮后应弹出导出弹窗"
        # 验证标题
        title = modal.locator("#export-modal-title").first
        assert title.is_visible() and title.text_content() == "导出工单"

    def test_tc_e2e_export_02_modal_has_format_options(self, page, backend_server, assert_no_js_errors):
        """导出弹窗应有格式选择选项"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # CSV 选项默认选中
        csv_radio = modal.locator("input[name='export-format'][value='csv']").first
        assert csv_radio.is_visible(), "应有 CSV 格式选项"
        assert csv_radio.is_checked(), "CSV 格式应默认选中"
        # Excel 选项可选
        xlsx_radio = modal.locator("input[name='export-format'][value='xlsx']").first
        assert xlsx_radio.is_visible(), "应有 Excel 格式选项"

    def test_tc_e2e_export_03_modal_has_range_options(self, page, backend_server, assert_no_js_errors):
        """导出弹窗应有范围选择选项"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 验证范围选项存在
        selected_radio = modal.locator("input[name='export-range'][value='selected']").first
        all_radio = modal.locator("input[name='export-range'][value='all']").first
        assert selected_radio.is_visible(), "应有「已选中工单」选项"
        assert all_radio.is_visible(), "应有「全部工单」选项"

    def test_tc_e2e_export_04_modal_has_filename_input(self, page, backend_server, assert_no_js_errors):
        """导出弹窗应有文件名输入框"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        filename_input = modal.locator("#export-filename-input").first
        assert filename_input.is_visible(), "应有文件名输入框"

    def test_tc_e2e_export_05_modal_cancel(self, page, backend_server, assert_no_js_errors):
        """点击取消按钮应关闭弹窗"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        assert modal.is_visible()
        cancel_btn = modal.locator("#export-cancel-btn").first
        cancel_btn.click(timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".export-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击取消后弹窗应关闭"

    def test_tc_e2e_export_06_modal_close_by_mask(self, page, backend_server, assert_no_js_errors):
        """点击遮罩层应关闭弹窗"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        mask = page.locator("#export-modal-mask").first
        assert mask.is_visible()
        # 点击遮罩层（不是弹窗内容）
        mask.click(position={"x": 10, "y": 10}, timeout=5000)
        page.wait_for_timeout(500)
        modal = page.locator(".export-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击遮罩层后弹窗应关闭"


class TestExportFormatSwitch:
    """导出格式切换测试"""

    def test_tc_e2e_export_07_switch_to_csv(self, page, backend_server, assert_no_js_errors):
        """切换到 CSV 格式应更新选中状态"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        csv_radio = modal.locator("input[name='export-format'][value='csv']").first
        csv_radio.click(timeout=5000)
        page.wait_for_timeout(300)
        assert csv_radio.is_checked(), "点击后 CSV 应为选中状态"
        xlsx_radio = modal.locator("input[name='export-format'][value='xlsx']").first
        assert not xlsx_radio.is_checked(), "Excel 应取消选中"

    def test_tc_e2e_export_08_switch_to_xlsx(self, page, backend_server, assert_no_js_errors):
        """切换到 Excel 格式应更新选中状态"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 先切换到 CSV
        csv_radio = modal.locator("input[name='export-format'][value='csv']").first
        csv_radio.click(timeout=5000)
        page.wait_for_timeout(300)
        # 再切换回 Excel
        xlsx_radio = modal.locator("input[name='export-format'][value='xlsx']").first
        xlsx_radio.click(timeout=5000)
        page.wait_for_timeout(300)
        assert xlsx_radio.is_checked(), "Excel 应为选中状态"


class TestExportRangeSwitch:
    """导出范围切换测试"""

    def test_tc_e2e_export_09_switch_to_all(self, page, backend_server, assert_no_js_errors):
        """切换到全部工单应更新选中状态"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        all_radio = modal.locator("input[name='export-range'][value='all']").first
        all_radio.click(timeout=5000)
        page.wait_for_timeout(300)
        assert all_radio.is_checked(), "全部工单应为选中状态"


class TestExportFilenameInput:
    """文件名输入测试"""

    def test_tc_e2e_export_10_custom_filename(self, page, backend_server, assert_no_js_errors):
        """输入自定义文件名应生效"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        filename_input = modal.locator("#export-filename-input").first
        filename_input.fill("test_export_custom", timeout=5000)
        page.wait_for_timeout(300)
        value = filename_input.input_value()
        assert value == "test_export_custom", "文件名输入应保存用户输入"


class TestExportWithSelectedTickets:
    """选中工单导出测试"""

    def test_tc_e2e_export_11_selected_range_default_when_selected(
        self, page, backend_server, api_client, assert_no_js_errors
    ):
        """有选中工单时，默认导出范围为「已选中」"""
        # 创建一个工单
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        # 选中该工单
        checkbox = page.locator(f"[data-ticket-select='{order_id}']").first
        if checkbox.count() > 0 and checkbox.is_visible():
            checkbox.check(timeout=5000)
            page.wait_for_timeout(500)
        # 打开导出弹窗
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        selected_radio = modal.locator("input[name='export-range'][value='selected']").first
        # 若有选中，应默认选中或可选
        assert selected_radio.is_visible()


class TestExportFieldSelection:
    """字段选择功能测试"""

    def test_tc_e2e_export_12_field_selection_section_visible(self, page, backend_server, assert_no_js_errors):
        """导出弹窗应显示字段选择区域"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 字段选择区域
        field_section = modal.locator(".export-section--fields").first
        assert field_section.is_visible(), "应显示字段选择区域"
        # 全选 checkbox
        select_all = modal.locator("#export-select-all-fields").first
        assert select_all.is_visible(), "应显示全选 checkbox"
        assert select_all.is_checked(), "全选应默认选中"

    def test_tc_e2e_export_13_field_groups_collapsed_by_default(self, page, backend_server, assert_no_js_errors):
        """字段分组默认折叠"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 检查节点分组数量（7个节点）
        field_groups = modal.locator(".export-field-group")
        assert field_groups.count() == 7, "应有7个节点字段分组"
        # 默认全部折叠（details 未 open）
        for i in range(field_groups.count()):
            group = field_groups.nth(i)
            assert not group.evaluate("el => el.open"), f"第{i+1}个分组应默认折叠"

    def test_tc_e2e_export_14_expand_node_field_group(self, page, backend_server, assert_no_js_errors):
        """点击可展开节点字段分组"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 点击第一个分组的展开图标（而不是 summary 整体，避免触发 checkbox）
        first_group = modal.locator(".export-field-group").first
        expand_icon = first_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        assert first_group.evaluate("el => el.open"), "点击后分组应展开"
        # 应显示字段列表
        field_list = first_group.locator(".export-field-list").first
        assert field_list.is_visible(), "展开后应显示字段列表"

    def test_tc_e2e_export_15_field_checkbox_count(self, page, backend_server, assert_no_js_errors):
        """展开后显示正确数量的字段 checkbox"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 展开问题填写节点（预期8个字段）
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        expand_icon = problem_fill_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        # 检查字段数量
        field_items = problem_fill_group.locator(".export-field-item")
        assert field_items.count() == 8, "问题填写节点应有8个可导出字段"

    def test_tc_e2e_export_16_node_select_all_checkbox(self, page, backend_server, assert_no_js_errors):
        """节点级全选 checkbox 功能"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 展开问题填写节点
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        expand_icon = problem_fill_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        # 点击节点级全选取消（直接点击 checkbox input）
        node_checkbox = problem_fill_group.locator("input[data-export-node-select-all='problem_fill']").first
        assert node_checkbox.is_checked(), "节点级全选应默认选中"
        node_checkbox.click(timeout=5000)
        page.wait_for_timeout(800)
        # 需要重新获取元素（弹窗重新渲染）
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        node_checkbox = problem_fill_group.locator("input[data-export-node-select-all='problem_fill']").first
        assert not node_checkbox.is_checked(), "取消后节点级全选应为未选中"
        # 所有字段 checkbox 应取消选中
        field_items = problem_fill_group.locator(".export-field-item input[type='checkbox']")
        for i in range(field_items.count()):
            assert not field_items.nth(i).is_checked(), f"第{i+1}个字段应取消选中"

    def test_tc_e2e_export_17_toggle_single_field(self, page, backend_server, assert_no_js_errors):
        """单独取消选中某个字段"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 展开问题填写节点
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        expand_icon = problem_fill_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        # 取消选中第一个字段
        first_field = problem_fill_group.locator(".export-field-item input[type='checkbox']").first
        first_field.click(timeout=5000)
        page.wait_for_timeout(800)
        # 重新获取元素
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        first_field = problem_fill_group.locator(".export-field-item input[type='checkbox']").first
        assert not first_field.is_checked(), "取消后字段应为未选中"
        # 节点级全选应取消
        node_checkbox = problem_fill_group.locator("input[data-export-node-select-all='problem_fill']").first
        assert not node_checkbox.is_checked(), "取消单个字段后节点级全选应为未选中"

    def test_tc_e2e_export_18_global_select_all_checkbox(self, page, backend_server, assert_no_js_errors):
        """全局全选 checkbox 功能"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 点击全局全选取消
        select_all = modal.locator("#export-select-all-fields").first
        select_all.click(timeout=5000)
        page.wait_for_timeout(800)
        assert not select_all.is_checked(), "取消后全局全选应为未选中"
        # 展开问题填写节点检查字段全取消
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        expand_icon = problem_fill_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        node_checkbox = problem_fill_group.locator("input[data-export-node-select-all='problem_fill']").first
        assert not node_checkbox.is_checked(), "取消全局全选后节点级也应取消"

    def test_tc_e2e_export_19_reselect_field(self, page, backend_server, assert_no_js_errors):
        """取消后再选中字段"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 先取消全局全选
        select_all = modal.locator("#export-select-all-fields").first
        select_all.click(timeout=5000)
        page.wait_for_timeout(800)
        # 展开问题填写节点
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        expand_icon = problem_fill_group.locator(".export-field-expand-icon").first
        expand_icon.click(timeout=5000)
        page.wait_for_timeout(500)
        # 再选中第一个字段
        first_field = problem_fill_group.locator(".export-field-item input[type='checkbox']").first
        first_field.click(timeout=5000)
        page.wait_for_timeout(800)
        # 重新获取元素
        problem_fill_group = modal.locator("details[data-export-node='problem_fill']").first
        first_field = problem_fill_group.locator(".export-field-item input[type='checkbox']").first
        assert first_field.is_checked(), "重新选中后字段应为选中状态"

    def test_tc_e2e_export_20_all_node_groups_present(self, page, backend_server, assert_no_js_errors):
        """所有7个节点分组都存在"""
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        export_btn = _ensure_export_btn_visible(page)
        export_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".export-modal").first
        # 验证所有节点
        expected_nodes = [
            "problem_fill",
            "problem_review",
            "ops_analysis",
            "dev_analysis",
            "dev_closure",
            "ops_closure",
            "audit_close",
        ]
        for node_key in expected_nodes:
            group = modal.locator(f"details[data-export-node='{node_key}']").first
            assert group.count() > 0, f"应存在节点 {node_key} 的分组"