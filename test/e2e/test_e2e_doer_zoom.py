"""
Doer统计页面放大按钮功能测试
测试目标：验证Doer Tab中各卡片的放大按钮点击后能正确显示弹窗
"""
import pytest

pytestmark = pytest.mark.e2e


class TestDoerZoomButton:
    """Doer统计页面放大按钮测试"""

    def test_tc_e2e_doer_zoom_button_works(self, page, backend_server, assert_no_js_errors):
        """测试Doer Tab放大按钮点击后弹窗正确显示"""
        # 导航到统计图表页面
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(1000)

        # 点击Doer Tab
        doer_tab_btn = page.locator("[data-stats-charts-tab='doer']")
        if doer_tab_btn.count() == 0:
            pytest.skip("Doer Tab按钮不存在，可能是功能未启用")
        doer_tab_btn.click()
        page.wait_for_timeout(2000)

        # 等待Doer数据加载完成（可能显示loading状态）
        # 检查是否有loading提示
        loading_indicator = page.locator(".stats-doer-loading")
        if loading_indicator.count() > 0:
            # 等待loading消失
            page.wait_for_selector(".stats-doer-loading", state="hidden", timeout=10000)

        # 等待卡片渲染
        page.wait_for_timeout(2000)

        # 查找第一个放大按钮
        zoom_btns = page.locator("[data-stats-labor-zoom]")
        if zoom_btns.count() == 0:
            pytest.skip("未找到放大按钮，Doer数据可能未加载")

        # 点击第一个Doer相关的放大按钮
        doer_keys = [
            "doerUsage", "doerEffectiveness", "doerConsultKpi",
            "doerConsultBar", "doerConsultTrend", "doerNonConsultKpi",
            "doerNonConsultBar", "doerNonConsultTrend", "dailyClosedDuration",
            "dailyDoerUsage", "dailyConsultIssue", "dailyDoerEffectiveness"
        ]

        first_doer_btn = None
        for i in range(zoom_btns.count()):
            btn = zoom_btns.nth(i)
            key = btn.get_attribute("data-stats-labor-zoom")
            if key in doer_keys:
                first_doer_btn = btn
                break

        if first_doer_btn is None:
            pytest.skip("未找到Doer相关的放大按钮")

        # 点击放大按钮
        first_doer_btn.click()
        page.wait_for_timeout(1000)

        # 验证弹窗是否打开
        zoom_mask = page.locator("#stats-doer-zoom-mask")
        assert zoom_mask.count() > 0, "Doer放大弹窗应存在"

        # 检查弹窗是否可见（通过class判断）
        is_open = zoom_mask.evaluate(
            "el => el.classList.contains('stats-chart-zoom-mask--open')"
        )
        assert is_open, "Doer放大弹窗应处于打开状态"

        # 检查弹窗内容是否渲染
        zoom_content = page.locator("#stats-doer-zoom-content")
        assert zoom_content.count() > 0, "Doer放大弹窗内容区域应存在"

        # 检查内容区域是否有内容（SVG图表）
        content_html = zoom_content.inner_html()
        assert len(content_html) > 0, "Doer放大弹窗应包含图表内容"

        # 关闭弹窗
        close_btn = page.locator("#stats-doer-zoom-close")
        if close_btn.count() > 0:
            close_btn.click()
            page.wait_for_timeout(500)

            # 验证弹窗已关闭
            is_closed = zoom_mask.evaluate(
                "el => !el.classList.contains('stats-chart-zoom-mask--open')"
            )
            assert is_closed, "Doer放大弹窗应处于关闭状态"

    def test_tc_e2e_doer_zoom_multiple_cards(self, page, backend_server, assert_no_js_errors):
        """测试多个Doer卡片放大按钮都能正常工作"""
        page.goto(f"{backend_server}/stats/charts")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(1000)

        # 点击Doer Tab
        doer_tab_btn = page.locator("[data-stats-charts-tab='doer']")
        if doer_tab_btn.count() == 0:
            pytest.skip("Doer Tab按钮不存在")
        doer_tab_btn.click()
        page.wait_for_timeout(3000)

        # 等待loading消失
        loading_indicator = page.locator(".stats-doer-loading")
        if loading_indicator.count() > 0:
            page.wait_for_selector(".stats-doer-loading", state="hidden", timeout=10000)

        doer_keys = [
            "doerUsage", "doerEffectiveness", "doerConsultKpi",
            "dailyClosedDuration", "dailyDoerUsage"
        ]

        # 测试多个放大按钮
        tested_count = 0
        for key in doer_keys:
            btn = page.locator(f"[data-stats-labor-zoom='{key}']")
            if btn.count() == 0:
                continue

            # 点击放大按钮
            btn.click()
            page.wait_for_timeout(500)

            # 验证弹窗打开
            zoom_mask = page.locator("#stats-doer-zoom-mask")
            is_open = zoom_mask.evaluate(
                "el => el.classList.contains('stats-chart-zoom-mask--open')"
            )
            assert is_open, f"点击{key}按钮后弹窗应打开"

            # 关闭弹窗
            close_btn = page.locator("#stats-doer-zoom-close")
            close_btn.click()
            page.wait_for_timeout(300)

            tested_count += 1

        assert tested_count > 0, "应至少测试一个放大按钮"