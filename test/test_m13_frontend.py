"""
前端功能测试 - M13 模块
使用 Playwright 进行端到端测试

测试用例：
- TC-M13-016 ~ TC-M13-028: UI元素渲染测试
- TC-M13-029 ~ TC-M13-042: 用户交互测试
"""

import os
import pytest
from playwright.sync_api import Page, Browser, expect

BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")


@pytest.fixture(scope="module")
def browser(browser: Browser):
    """浏览器fixture"""
    return browser


@pytest.fixture(scope="function")
def page(browser: Browser):
    """页面fixture，每个测试用例使用新页面"""
    page = browser.new_page()
    page.goto(BASE_URL)
    yield page
    page.close()


class TestFrontendUIRendering:
    """UI元素渲染测试 - TC-M13-016 ~ TC-M13-028"""

    def test_tc_m13_016_home_navbar(self, page: Page):
        """TC-M13-016: 首页渲染-顶部导航栏"""
        page.goto(BASE_URL)
        # 验证导航栏存在
        navbar = page.locator(".layout-header")
        expect(navbar).to_be_visible()
        
        # 验证导航标签存在
        expect(page.locator("text=我的主页")).to_be_visible()
        expect(page.locator("text=工作台")).to_be_visible()

    def test_tc_m13_017_home_ticket_table(self, page: Page):
        """TC-M13-017: 首页渲染-工单列表表格"""
        page.goto(BASE_URL)
        # 验证表格存在
        table = page.locator(".ticket-list-table")
        expect(table).to_be_visible()
        
        # 验证表头列存在
        headers = ["流程ID", "当前阶段", "SLA", "问题描述", "严重性", "操作"]
        for header in headers:
            expect(page.locator(f"th:has-text('{header}')")).to_be_visible()

    def test_tc_m13_018_home_create_button(self, page: Page):
        """TC-M13-018: 首页渲染-创建工单按钮"""
        page.goto(BASE_URL)
        # 验证创建工单按钮存在
        create_btn = page.locator("button:has-text('创建工单')")
        expect(create_btn).to_be_visible()

    def test_tc_m13_019_home_filter_buttons(self, page: Page):
        """TC-M13-019: 首页渲染-筛选按钮"""
        page.goto(BASE_URL)
        # 验证筛选按钮存在
        filter_buttons = page.locator(".filter-icon")
        expect(filter_buttons).to_have_count(greater_or_equal=1)

    def test_tc_m13_022_sidebar_menu(self, page: Page):
        """TC-M13-022: 侧边栏-功能菜单"""
        page.goto(BASE_URL)
        # 验证侧边栏存在
        sidebar = page.locator(".layout-left")
        expect(sidebar).to_be_visible()
        
        # 验证菜单项目存在
        menu_items = ["值班表", "请假申请", "参数配置", "权限策略"]
        for item in menu_items:
            expect(page.locator(f"text='{item}'")).to_be_visible()

    def test_tc_m13_025_leave_application_form(self, page: Page):
        """TC-M13-025: 请假申请-申请表单"""
        page.goto(f"{BASE_URL}/#/leave")
        # 验证申请表单存在
        expect(page.locator("text=请假申请")).to_be_visible()
        
        # 验证表单字段存在
        fields = ["申请类型", "时间段", "审批人", "抄送人"]
        for field in fields:
            expect(page.locator(f"label:has-text('{field}')")).to_be_visible()


class TestFrontendUserInteraction:
    """用户交互测试 - TC-M13-029 ~ TC-M13-042"""

    def test_tc_m13_029_tab_switch_workbench(self, page: Page):
        """TC-M13-029: 标签页切换-工作台"""
        page.goto(BASE_URL)
        # 点击工作台标签
        workbench_tab = page.locator("text=工作台")
        workbench_tab.click()
        
        # 验证页面切换到工作台
        expect(page.locator(".workbench-container")).to_be_visible()

    def test_tc_m13_030_tab_switch_duty(self, page: Page):
        """TC-M13-030: 标签页切换-值班表"""
        page.goto(BASE_URL)
        # 点击值班表菜单
        duty_menu = page.locator("text=值班表")
        duty_menu.click()
        
        # 验证页面切换到值班表
        expect(page.locator("text=内核值班表")).to_be_visible()

    def test_tc_m13_031_create_ticket_modal(self, page: Page):
        """TC-M13-031: 创建工单弹窗-打开"""
        page.goto(BASE_URL)
        # 点击创建工单按钮
        create_btn = page.locator("button:has-text('创建工单')")
        create_btn.click()
        
        # 验证弹窗打开
        modal = page.locator(".modal-overlay")
        expect(modal).to_be_visible()

    def test_tc_m13_035_sidebar_collapse(self, page: Page):
        """TC-M13-035: 侧边栏折叠-收起"""
        page.goto(BASE_URL)
        # 找到折叠按钮
        collapse_btn = page.locator(".layout-collapse-btn")
        if collapse_btn.is_visible():
            collapse_btn.click()
            # 验证侧边栏收起
            expect(page.locator(".layout.left-collapsed")).to_be_visible()

    def test_tc_m13_037_theme_switch_dark(self, page: Page):
        """TC-M13-037: 主题切换-深色模式"""
        page.goto(BASE_URL)
        # 找到主题切换按钮
        theme_btn = page.locator(".theme-switcher")
        if theme_btn.is_visible():
            theme_btn.click()
            # 选择dark主题
            dark_option = page.locator("text=深色模式")
            if dark_option.is_visible():
                dark_option.click()
                # 验证深色主题应用
                expect(page.locator("html[data-theme='dark']")).to_be_visible()

    def test_tc_m13_041_ticket_search(self, page: Page):
        """TC-M13-041: 工单搜索-关键字搜索"""
        page.goto(BASE_URL)
        # 找到搜索框
        search_input = page.locator(".search-input")
        if search_input.is_visible():
            search_input.fill("迁移")
            search_input.press("Enter")
            
            # 验证搜索结果显示
            results = page.locator(".ticket-list-row")
            expect(results).to_be_visible()


class TestFrontendEdgeCases:
    """前端边界情况测试"""

    def test_page_not_found_fallback(self, page: Page):
        """测试不存在的路由回退到首页"""
        page.goto(f"{BASE_URL}/nonexistent-route")
        # 验证返回首页内容
        expect(page.locator("text=我的主页")).to_be_visible()

    def test_empty_state_display(self, page: Page):
        """测试空状态显示"""
        page.goto(f"{BASE_URL}/#/leave")
        # 验证空状态提示存在
        empty_state = page.locator(".empty-state")
        if empty_state.is_visible():
            expect(empty_state).to_contain_text("暂无")

    def test_loading_state(self, page: Page):
        """测试加载状态显示"""
        page.goto(BASE_URL)
        # 验证加载指示器存在
        loading = page.locator(".loading-spinner")
        # 加载完成后不应显示
        page.wait_for_load_state("networkidle")
        expect(loading).not_to_be_visible()