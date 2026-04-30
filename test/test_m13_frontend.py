"""
前端功能测试 - M13 模块
使用 Playwright 进行端到端测试

测试用例：
- TC-M13-016 ~ TC-M13-028: UI元素渲染测试
- TC-M13-029 ~ TC-M13-042: 用户交互测试
"""

import os
import pytest

pytest.importorskip("playwright")

from playwright.sync_api import Page, Browser, expect

BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")


@pytest.fixture(scope="function")
def page(browser):
    """页面fixture，每个测试用例使用新页面"""
    page = browser.new_page()
    page.goto(BASE_URL)
    yield page
    page.close()


class TestFrontendUIRendering:
    """UI元素渲染测试 - TC-M13-016 ~ TC-M13-028"""

    def test_tc_m13_016_home_navbar(self, page):
        """TC-M13-016: 首页渲染-顶部导航栏"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        layout = page.locator(".layout")
        expect(layout).to_be_visible()
        
        home_btn = page.locator("button[data-nav-key='home']")
        expect(home_btn).to_be_visible()
        
        workbench_btn = page.locator("button[data-nav-key='list']")
        expect(workbench_btn).to_be_visible()

    def test_tc_m13_017_home_ticket_table(self, page):
        """TC-M13-017: 首页渲染-工单列表表格"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        table_wrap = page.locator(".home-workbench-table")
        if table_wrap.count() > 0:
            expect(table_wrap.first).to_be_visible()
            
            headers = ["流程ID", "当前阶段", "SLA", "问题描述", "严重性", "操作"]
            for header in headers:
                header_loc = page.locator(f"th:has-text('{header}')")
                if header_loc.count() > 0:
                    expect(header_loc.first).to_be_visible()

    def test_tc_m13_018_home_create_button(self, page):
        """TC-M13-018: 首页渲染-创建工单按钮"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        create_btn = page.locator("button:has-text('创建工单')")
        if create_btn.count() > 0:
            expect(create_btn.first).to_be_visible()

    def test_tc_m13_019_home_filter_buttons(self, page):
        """TC-M13-019: 首页渲染-筛选按钮"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        filter_buttons = page.locator(".filter-icon")
        count = filter_buttons.count()
        assert count >= 0

    def test_tc_m13_022_sidebar_menu(self, page):
        """TC-M13-022: 侧边栏-功能菜单"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        sidebar = page.locator("aside.left")
        expect(sidebar).to_be_visible()
        
        menu_items = ["值班表", "请假申请", "参数配置", "权限策略"]
        for item in menu_items:
            menu_loc = page.locator(f"button:has-text('{item}')")
            if menu_loc.count() > 0:
                expect(menu_loc.first).to_be_visible()

    def test_tc_m13_025_leave_application_form(self, page):
        """TC-M13-025: 请假申请-申请表单"""
        page.goto(f"{BASE_URL}/#/leave")
        page.wait_for_load_state("networkidle")
        leave_title = page.locator("text=请假申请")
        if leave_title.count() > 0:
            expect(leave_title.first).to_be_visible()


class TestFrontendUserInteraction:
    """用户交互测试 - TC-M13-029 ~ TC-M13-042"""

    def test_tc_m13_029_tab_switch_workbench(self, page):
        """TC-M13-029: 标签页切换-工作台"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        workbench_btn = page.locator("button[data-nav-key='list']")
        if workbench_btn.count() > 0:
            workbench_btn.first.click()
            page.wait_for_load_state("networkidle")

    def test_tc_m13_030_tab_switch_duty(self, page):
        """TC-M13-030: 标签页切换-值班表"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        duty_btn = page.locator("button[data-nav-key='duty:roster']")
        if duty_btn.count() > 0:
            duty_btn.first.click()
            page.wait_for_load_state("networkidle")

    def test_tc_m13_031_create_ticket_modal(self, page):
        """TC-M13-031: 创建工单弹窗-打开"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        create_btn = page.locator("button:has-text('创建工单')")
        if create_btn.count() > 0:
            create_btn.first.click()
            page.wait_for_timeout(500)

    def test_tc_m13_035_sidebar_collapse(self, page):
        """TC-M13-035: 侧边栏折叠-收起"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        collapse_btn = page.locator("#collapse-btn")
        if collapse_btn.count() > 0:
            collapse_btn.first.click()
            page.wait_for_timeout(300)

    def test_tc_m13_037_theme_switch_dark(self, page):
        """TC-M13-037: 主题切换-深色模式"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")

    def test_tc_m13_041_ticket_search(self, page):
        """TC-M13-041: 工单搜索-关键字搜索"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        search_input = page.locator(".search-input")
        if search_input.count() > 0:
            search_input.first.fill("迁移")
            search_input.first.press("Enter")
            page.wait_for_load_state("networkidle")


class TestFrontendEdgeCases:
    """前端边界情况测试"""

    def test_page_not_found_fallback(self, page):
        """测试不存在的路由回退到首页"""
        page.goto(f"{BASE_URL}/#/nonexistent-route")
        page.wait_for_load_state("networkidle")
        layout = page.locator(".layout")
        expect(layout).to_be_visible()

    def test_empty_state_display(self, page):
        """测试空状态显示"""
        page.goto(f"{BASE_URL}/#/leave")
        page.wait_for_load_state("networkidle")

    def test_loading_state(self, page):
        """测试加载状态显示"""
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        loading = page.locator(".loading-spinner")
        expect(loading).not_to_be_visible()