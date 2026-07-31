"""质量改进统计分析——柱状图「固定柱宽 + 容器内左右滑动」回归测试。

验证点（不依赖具体数据量，数据稀疏时仍可跑结构校验；数据密集时额外校验可滑动）：
1. 每张柱状图都被 .qi-chart-scroll 包裹；
2. SVG 声明了数值 width 属性（intrinsic 宽度），且按 intrinsic 宽度渲染（width:auto 生效，不被压缩到 100%）；
3. 数据足够多（柱数多）时，容器 scrollWidth > clientWidth，可左右滑动；
4. Top N 「显示全部」切换后柱数增加、图变宽。
"""

import pytest

pytestmark = pytest.mark.e2e

QI_ANALYTICS_URL = "/stats/qi-analytics"


def _chart_metrics(page):
    """返回每张柱状图的度量：svgWidthAttr / renderedW / containerClientW / scrollW / bars。"""
    return page.evaluate(
        """() => {
            const wraps = [...document.querySelectorAll('.qi-chart-scroll')];
            return wraps.map((w) => {
                const svg = w.querySelector('svg.stat-svg-chart');
                const r = svg ? svg.getBoundingClientRect() : null;
                return {
                    widthAttr: svg ? Number(svg.getAttribute('width')) : null,
                    renderedW: r ? Math.round(r.width) : null,
                    clientW: w.clientWidth,
                    scrollW: w.scrollWidth,
                    bars: svg ? svg.querySelectorAll('path.stat-bar-rect').length : 0,
                };
            });
        }"""
    )


class TestQiAnalyticsScroll:
    def test_bar_charts_fixed_width_scrollable(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}{QI_ANALYTICS_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)  # 等图表绘制完

        charts = _chart_metrics(page)
        assert len(charts) > 0, "应至少渲染一张柱状图（.qi-chart-scroll）"

        for i, c in enumerate(charts):
            # 1) SVG 必须声明数值 width（intrinsic 宽度）
            assert c["widthAttr"] and c["widthAttr"] >= 560, (
                f"chart#{i} SVG 缺少有效的 width 属性: {c}"
            )
            # 2) 渲染宽度应贴近 intrinsic 宽度（width:auto 生效，未被压成 100%）
            assert abs(c["renderedW"] - c["widthAttr"]) <= 2, (
                f"chart#{i} 渲染宽度 {c['renderedW']} != intrinsic {c['widthAttr']}（CSS width:auto 未生效）: {c}"
            )

        # 3) 默认视图：若已有图宽超出容器，则应可滑动（容器宽时默认视图不溢出也属正常）
        for c in charts:
            if c["widthAttr"] > c["clientW"]:
                assert c["scrollW"] > c["clientW"], (
                    f"超出容器的柱状图应可滑动: {c}"
                )

        # 4) Top N「显示全部」切换：柱数增加、图变宽；超出容器时可左右滑动，再「收起」恢复
        mod_toggle = page.locator('.qi-expand-toggle[data-expand-key="module"]')
        if mod_toggle.count():
            before = _chart_metrics(page)
            mod_before = before[1] if len(before) > 1 else before[0]
            mod_toggle.first.click()  # 显示全部
            page.wait_for_timeout(1200)
            after = _chart_metrics(page)
            mod_after = after[1] if len(after) > 1 else after[0]
            assert mod_after["bars"] > mod_before["bars"], (
                f"显示全部后柱数应增加: {mod_before} -> {mod_after}"
            )
            assert mod_after["widthAttr"] > mod_before["widthAttr"], (
                f"显示全部后图宽应增大: {mod_before} -> {mod_after}"
            )
            # 全量模块（数十个）必然超出容器 → 必须可滑动
            assert mod_after["scrollW"] > mod_after["clientW"], (
                f"全量模块柱状图应可左右滑动，scrollW={mod_after['scrollW']} "
                f"clientW={mod_after['clientW']}: {mod_after}"
            )
            # 收起 → 恢复到 Top N（柱数回落）
            mod_toggle = page.locator('.qi-expand-toggle[data-expand-key="module"]')
            mod_toggle.first.click()
            page.wait_for_timeout(1200)
            collapsed = _chart_metrics(page)
            mod_collapsed = collapsed[1] if len(collapsed) > 1 else collapsed[0]
            assert mod_collapsed["bars"] < mod_after["bars"], (
                f"收起后柱数应回落: {mod_after} -> {mod_collapsed}"
            )
