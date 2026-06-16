"""E2E tests for the RL On-Call public page (/rl-oncall).

Tests:
- Public page accessible without authentication
- No sidebar displayed
- Read-only content (discipline notice, today banner, duty table)
- No edit buttons or delete buttons
"""
import pytest

pytestmark = pytest.mark.e2e


class TestRlOncallPublicPage:
    """Test the public RL on-call page at /rl-oncall."""

    def test_tc_e2e_public_page_accessible_without_auth(self, page, backend_server, assert_no_js_errors):
        """Public page should load without login/auth."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#rl-oncall-public-panel")
        assert panel.count() > 0, "RL值班表公开面板应存在"

    def test_tc_e2e_public_page_no_sidebar(self, page, backend_server, assert_no_js_errors):
        """Public page should not display the left sidebar."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        sidebar = page.locator("aside.left")
        assert sidebar.count() == 0, "公开页面不应有侧边栏"

    def test_tc_e2e_public_page_has_discipline_notice(self, page, backend_server, assert_no_js_errors):
        """Public page should display the discipline notice."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        discipline = page.locator(".duty-rl-discipline")
        assert discipline.count() > 0, "值班纪律说明应存在"
        title = page.locator(".duty-rl-discipline-title")
        assert title.count() > 0, "值班纪律标题应存在"

    def test_tc_e2e_public_page_has_today_banner(self, page, backend_server, assert_no_js_errors):
        """Public page should display the today banner with current time and on-call info."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        banner = page.locator(".duty-rl-today-banner")
        assert banner.count() > 0, "今日值班横幅应存在"
        # Check for current time line
        lines = page.locator(".duty-rl-today-line")
        assert lines.count() >= 2, "今日横幅应至少有当前时间和主值班信息"

    def test_tc_e2e_public_page_has_table(self, page, backend_server, assert_no_js_errors):
        """Public page should display the RL on-call table."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        table = page.locator(".duty-rl-table")
        assert table.count() > 0, "RL值班表格应存在"
        # Check table has 3 columns (date, primary, backup)
        headers = page.locator(".duty-rl-table thead th")
        assert headers.count() == 3, "表格应有 3 列（日期、主值班、备值班）"

    def test_tc_e2e_public_page_no_edit_button(self, page, backend_server, assert_no_js_errors):
        """Public page should not have any edit buttons."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        edit_btn = page.locator("[data-duty-rl-edit]")
        assert edit_btn.count() == 0, "公开页面不应有编辑按钮"
        # Also check no add-row button
        add_btn = page.locator("#duty-rl-add-row-btn")
        assert add_btn.count() == 0, "公开页面不应有添加按钮"

    def test_tc_e2e_public_page_no_delete_button(self, page, backend_server, assert_no_js_errors):
        """Public page should not have any delete buttons in table rows."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        remove_btn = page.locator(".duty-rl-remove-btn")
        assert remove_btn.count() == 0, "公开页面不应有删除按钮"

    def test_tc_e2e_public_page_title(self, page, backend_server, assert_no_js_errors):
        """Public page should show 'RL值班表' as title."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        title = page.locator("#center-page-title")
        assert title.inner_text() == "RL值班表", "页面标题应为 'RL值班表'"

    def test_tc_e2e_public_page_document_title(self, page, backend_server, assert_no_js_errors):
        """Document title should include 'RL值班表'."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        doc_title = page.title()
        assert "RL值班表" in doc_title, f"文档标题应包含 'RL值班表', 实际: {doc_title}"

    def test_tc_e2e_public_page_refresh_works(self, page, backend_server, assert_no_js_errors):
        """Public page should work on browser refresh (SPA deep link)."""
        page.goto(f"{backend_server}/rl-oncall")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#rl-oncall-public-panel")
        assert panel.count() > 0
        # Refresh the page
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel_after = page.locator("#rl-oncall-public-panel")
        assert panel_after.count() > 0, "刷新后公开面板应仍然存在"
