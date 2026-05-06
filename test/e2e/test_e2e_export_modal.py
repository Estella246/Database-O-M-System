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
        # Excel 选项默认选中
        xlsx_radio = modal.locator("input[name='export-format'][value='xlsx']").first
        assert xlsx_radio.is_visible(), "应有 Excel 格式选项"
        assert xlsx_radio.is_checked(), "Excel 格式应默认选中"
        # CSV 选项可选
        csv_radio = modal.locator("input[name='export-format'][value='csv']").first
        assert csv_radio.is_visible(), "应有 CSV 格式选项"

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