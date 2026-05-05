import pytest

pytestmark = pytest.mark.e2e


class TestDutyPage:

    def test_tc_e2e_035_duty_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        panel = page.locator("#duty-roster-panel")
        assert panel.count() > 0, "值班表面板应存在"

    def test_tc_e2e_036_duty_page_content(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/duty-roster")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        blocks = page.locator(".duty-roster-block")
        if blocks.count() == 0:
            pytest.fail("值班表区块未渲染（可能无数据）")
        assert blocks.count() >= 1, "值班表应至少有一个区块"
        titles = page.locator(".duty-roster-block-title")
        assert titles.count() >= 1, "值班表区块应有标题"
