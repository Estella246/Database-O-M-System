"""
重大问题模块 E2E 测试用例（20个）
测试前端交互：页面加载、列表筛选、搜索、新增弹窗、详情查看、导出、配置管理
"""

import os
import time
from datetime import date, datetime, timedelta

import pytest
from playwright.sync_api import Page, expect

from conftest import E2E_BASE_URL, E2E_OPERATOR_ACCOUNT, E2E_OPERATOR_NAME, _E2EApiClient

BASE_URL = E2E_BASE_URL.rstrip("/")
OPERATOR_ID = E2E_OPERATOR_ACCOUNT


@pytest.fixture(scope="module")
def api_client():
    """API客户端用于数据准备"""
    client = _E2EApiClient(BASE_URL)
    yield client


@pytest.fixture(scope="module", autouse=True)
def setup_test_data(api_client):
    """创建测试数据"""
    # 确保测试用户存在
    api_client.post("/api/admin/users/bulk", json={
        "items": [{
            "account": OPERATOR_ID,
            "user_name": E2E_OPERATOR_NAME,
            "role_code": "admin",
            "is_active": True,
            "group_name": "测试组",
        }],
        "operator_id": "admin",
    })
    
    # 创建测试重大问题记录
    test_records = []
    for i in range(3):
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": f"E2E测试数据中心{i+1}",
            "problem_type": "性能问题",
            "description": f"E2E测试问题描述{i+1}",
            "status": "待处理",
        }
        r = api_client.post("/api/major-problems", json=payload)
        if r.status_code == 200:
            test_records.append(r.json())
    
    yield test_records
    
    # 清理测试数据
    for record in test_records:
        problem_id = record.get("id")
        if problem_id:
            api_client.delete(f"/api/major-problems/{problem_id}?operator_id={OPERATOR_ID}")


class TestMajorProblemPageLoad:
    """测试组1：页面加载"""

    def test_01_page_load_success(self, page: Page):
        """测试01: 重大问题页面加载成功"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("h1", timeout=5000)
        expect(page.locator("h1")).to_contain_text("重大问题")
        # 等待数据加载
        page.wait_for_timeout(1000)

    def test_02_page_title_display(self, page: Page):
        """测试02: 页面标题正确显示"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("h1", timeout=5000)
        expect(page.locator("h1")).to_have_text("重大问题")

    def test_03_toolbar_buttons_visible(self, page: Page):
        """测试03: 工具栏按钮可见"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("h1", timeout=5000)
        page.wait_for_timeout(1000)
        # 检查导入、导出、新增、配置按钮
        expect(page.locator("#mp-import-btn")).to_be_visible()
        expect(page.locator("#mp-export-btn")).to_be_visible()
        expect(page.locator("#mp-create-btn")).to_be_visible()
        expect(page.locator("#mp-config-btn")).to_be_visible()

    def test_04_search_input_visible(self, page: Page):
        """测试04: 搜索框可见"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-search-input", timeout=5000)
        expect(page.locator("#mp-search-input")).to_be_visible()


class TestMajorProblemPeriodFilter:
    """测试组2：时间筛选"""

    def test_05_period_all_button(self, page: Page):
        """测试05: 全部时间筛选按钮"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("[data-mp-period='all']", timeout=5000)
        expect(page.locator("[data-mp-period='all']")).to_be_visible()

    def test_06_period_day_button(self, page: Page):
        """测试06: 今日筛选按钮"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("[data-mp-period='day']", timeout=5000)
        expect(page.locator("[data-mp-period='day']")).to_be_visible()

    def test_07_period_week_button(self, page: Page):
        """测试07: 本周筛选按钮"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("[data-mp-period='week']", timeout=5000)
        expect(page.locator("[data-mp-period='week']")).to_be_visible()

    def test_08_period_month_button(self, page: Page):
        """测试08: 本月筛选按钮"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("[data-mp-period='month']", timeout=5000)
        expect(page.locator("[data-mp-period='month']")).to_be_visible()

    def test_09_period_custom_button(self, page: Page):
        """测试09: 自定义时间筛选"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("[data-mp-period='custom']", timeout=5000)
        # 点击自定义按钮
        page.locator("[data-mp-period='custom']").click()
        page.wait_for_timeout(500)
        # 应出现日期范围选择器
        expect(page.locator('[data-date-range-id="major-problem-custom"]')).to_be_visible()
        expect(page.locator('[data-date-range-id="major-problem-custom"] .date-trigger[data-range-part="start"]')).to_be_visible()
        expect(page.locator('[data-date-range-id="major-problem-custom"] .date-trigger[data-range-part="end"]')).to_be_visible()


class TestMajorProblemSearch:
    """测试组3：搜索功能"""

    def test_10_search_input_placeholder(self, page: Page):
        """测试10: 搜索框占位符文本"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-search-input", timeout=5000)
        placeholder = page.locator("#mp-search-input").get_attribute("placeholder")
        assert "搜索" in placeholder or "运维单号" in placeholder

    def test_11_search_by_keyword(self, page: Page):
        """测试11: 关键词搜索"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-search-input", timeout=5000)
        # 输入搜索关键词
        page.locator("#mp-search-input").fill("E2E测试")
        page.wait_for_timeout(1500)  # 等待防抖和API响应
        # 验证表格存在
        expect(page.locator(".mp-table")).to_be_visible()

    def test_12_search_clear(self, page: Page):
        """测试12: 清空搜索"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-search-input", timeout=5000)
        page.locator("#mp-search-input").fill("测试")
        page.wait_for_timeout(500)
        page.locator("#mp-search-input").clear()
        page.wait_for_timeout(1500)
        expect(page.locator("#mp-search-input")).to_have_value("")


class TestMajorProblemCreate:
    """测试组4：新增功能"""

    def test_13_create_button_click(self, page: Page):
        """测试13: 点击新增按钮打开弹窗"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-create-btn", timeout=5000)
        page.locator("#mp-create-btn").click()
        page.wait_for_timeout(500)
        # 弹窗标题应出现
        expect(page.locator("h3")).to_contain_text("新增重大问题")

    def test_14_create_form_fields(self, page: Page):
        """测试14: 新增弹窗表单字段"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-create-btn", timeout=5000)
        page.locator("#mp-create-btn").click()
        page.wait_for_timeout(500)
        # 检查必填字段
        expect(page.locator("#mp-create-report-date")).to_be_visible()
        expect(page.locator("#mp-create-site-name")).to_be_visible()
        expect(page.locator("#mp-create-problem-type")).to_be_visible()
        expect(page.locator("#mp-create-description")).to_be_visible()

    def test_15_create_cancel_button(self, page: Page):
        """测试15: 取消新增"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-create-btn", timeout=5000)
        page.locator("#mp-create-btn").click()
        page.wait_for_timeout(500)
        # 点击取消
        page.locator("#mp-create-cancel-btn").click()
        page.wait_for_timeout(500)
        # 弹窗应消失
        expect(page.locator("h3")).not_to_contain_text("新增重大问题")

    def test_16_create_submit_validation(self, page: Page):
        """测试16: 提交验证必填字段"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-create-btn", timeout=5000)
        page.locator("#mp-create-btn").click()
        page.wait_for_timeout(500)
        # 不填必填字段直接提交
        page.locator("#mp-create-submit-btn").click()
        page.wait_for_timeout(500)
        # 应有错误提示（alert或错误消息）
        # 弹窗仍然存在表示验证失败
        expect(page.locator("h3")).to_contain_text("新增重大问题")


class TestMajorProblemPagination:
    """测试组5：分页功能"""

    def test_17_pagination_controls_visible(self, page: Page):
        """测试17: 分页控件可见"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-list-pagination", timeout=5000)
        expect(page.locator("#mp-page-prev")).to_be_visible()
        expect(page.locator("#mp-page-next")).to_be_visible()
        expect(page.locator("#mp-page-size")).to_be_visible()
        expect(page.locator("#mp-page-jump")).to_be_visible()

    def test_18_page_size_selector(self, page: Page):
        """测试18: 每页条数选择器"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-page-size", timeout=5000)
        # 验证默认值为10
        expect(page.locator("#mp-page-size")).to_have_value("10")

    def test_18b_page_jump_input(self, page: Page):
        """测试18b: 前往第 n 页可手动输入"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector("#mp-page-jump", timeout=5000)
        jump = page.locator("#mp-page-jump")
        expect(jump).to_be_visible()
        jump.fill("1")
        jump.press("Enter")
        page.wait_for_timeout(500)
        expect(jump).to_have_value("1")

    def test_19_pagination_summary(self, page: Page):
        """测试19: 分页统计信息"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector(".list-pagination-summary", timeout=5000)
        summary = page.locator(".list-pagination-summary").text_content()
        assert "共" in summary and "条" in summary

    def test_20_table_rows_display(self, page: Page):
        """测试20: 表格行显示"""
        page.goto(f"{BASE_URL}/#/major-problems")
        page.wait_for_selector(".mp-table", timeout=5000)
        page.wait_for_timeout(1000)
        # 表格应有行数据或空数据提示
        rows = page.locator(".mp-row")
        empty = page.locator(".mp-empty")
        # 至少有一个可见
        assert rows.count() > 0 or empty.is_visible()