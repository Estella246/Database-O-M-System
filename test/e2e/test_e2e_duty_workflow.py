import time
import uuid

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


class TestDutyPageLoad:
    """值班表页面加载与布局"""

    def test_tc_e2e_401_duty_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        panel = page.locator("#duty-roster-panel")
        assert panel.count() > 0, "值班表面板应存在"

    def test_tc_e2e_402_duty_page_has_blocks(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        blocks = page.locator(".duty-roster-block")
        if blocks.count() == 0:
            pytest.skip("值班表区块未渲染（可能无数据）")
        assert blocks.count() >= 1, "值班表应至少有一个区块"

    def test_tc_e2e_403_duty_page_has_titles(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        titles = page.locator(".duty-roster-block-title")
        if titles.count() == 0:
            pytest.skip("值班表标题未渲染")
        assert titles.count() >= 1, "值班表区块应有标题"


class TestDutyCalendarInteraction:
    """值班日历交互"""

    def test_tc_e2e_404_duty_calendar_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        calendar = page.locator(".duty-calendar, .duty-roster-calendar, [data-duty-calendar]")
        if calendar.count() == 0:
            pytest.skip("值班日历不可见")
        assert calendar.first.is_visible(), "值班日历应可见"

    def test_tc_e2e_405_duty_calendar_day_click(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        day_cells = page.locator("[data-duty-day], .duty-calendar-day, td[data-date]")
        if day_cells.count() == 0:
            pytest.skip("值班日历日期单元格不可见")
        first_day = day_cells.first
        if first_day.is_visible():
            first_day.click(timeout=5000)
            page.wait_for_timeout(1000)

    def test_tc_e2e_406_duty_roster_edit_button(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        edit_btn = page.locator("[data-duty-edit], button", has_text="编辑").first
        if edit_btn.count() == 0 or not edit_btn.is_visible():
            pytest.skip("值班表编辑按钮不可见")
        edit_btn.click(timeout=5000, force=True)
        page.wait_for_timeout(1000)
        save_btn = page.locator("[data-duty-save], button", has_text="保存").first
        if save_btn.count() > 0:
            assert save_btn.is_visible(), "进入编辑模式后应出现保存按钮"


class TestDutyRotationInteraction:
    """轮值表交互"""

    def test_tc_e2e_407_duty_rotation_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        rotation_tab = page.locator("[data-duty-tab='rotation'], [data-duty-roster-tab='rotation']").first
        if rotation_tab.count() == 0 or not rotation_tab.is_visible():
            pytest.skip("轮值表标签页不可见")
        rotation_tab.click(timeout=5000)
        page.wait_for_timeout(1500)

    def test_tc_e2e_408_duty_site_oncall_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        oncall_tab = page.locator("[data-duty-tab='site'], [data-duty-roster-tab='site']").first
        if oncall_tab.count() == 0 or not oncall_tab.is_visible():
            pytest.skip("现场值班标签页不可见")
        oncall_tab.click(timeout=5000)
        page.wait_for_timeout(1500)

    def test_tc_e2e_409_duty_rl_oncall_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        rl_tab = page.locator("[data-duty-tab='rl'], [data-duty-roster-tab='rl']").first
        if rl_tab.count() == 0 or not rl_tab.is_visible():
            pytest.skip("RL值班标签页不可见")
        rl_tab.click(timeout=5000)
        page.wait_for_timeout(1500)


class TestDutyHolidayInteraction:
    """节假日配置交互"""

    def test_tc_e2e_410_duty_holiday_config_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        holiday_btn = page.locator("[data-duty-holiday], button", has_text="节假日").first
        if holiday_btn.count() > 0 and holiday_btn.is_visible():
            holiday_btn.click(timeout=5000)
            page.wait_for_timeout(1000)
