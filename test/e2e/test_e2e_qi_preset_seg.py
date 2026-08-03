"""覆盖：时间筛选改造为统计图表同款胶囊分段（.qi-preset-seg）。
结构(轨道+滑块+4段) + 选中段 aria-selected + 滑块 --seg-i 随选中变化 + 切预设仍触发重拉。
"""
import pytest

pytestmark = pytest.mark.e2e


def test_preset_segmented_control(page, backend_server, assert_no_js_errors):
    page.set_viewport_size({"width": 1400, "height": 900})
    page.goto(f"{backend_server}/stats/qi-analytics")
    page.wait_for_selector(".req-analytics-page", timeout=15000)
    page.wait_for_timeout(1500)

    # 结构：胶囊分段轨道 + 4 段按钮 + 恰好 1 个选中
    assert page.locator(".qi-preset-seg").count() == 1, "应有时间筛选胶囊分段 .qi-preset-seg"
    assert page.locator(".qi-preset-seg-slider").count() == 1, "应有滑动白块"
    btns = page.locator(".qi-preset-seg-btn")
    assert btns.count() == 5, f"应有 5 个预设段(全部/近1周/近1月/近3月/自定义): {btns.count()}"
    selected = page.locator('.qi-preset-seg-btn[aria-selected="true"]')
    assert selected.count() == 1, f"应恰好 1 段选中: {selected.count()}"

    # 切到「近3月」→ 该段选中、滑块 --seg-i 更新为 3（第 4 段，index 3）
    page.locator('.qi-preset-seg-btn[data-qi-analytics-preset="3m"]').click()
    page.wait_for_timeout(800)
    assert page.locator('.qi-preset-seg-btn[data-qi-analytics-preset="3m"]').get_attribute("aria-selected") == "true", "近3月 应选中"
    seg_i = page.eval_on_selector(".qi-preset-seg", "el => el.style.getPropertyValue('--seg-i').trim()")
    assert seg_i == "3", f"近3月(index 3) 滑块 --seg-i 应为 '3': {seg_i!r}"
