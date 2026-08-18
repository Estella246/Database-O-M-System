"""覆盖：页内柱状图（ECharts dataZoom）滚轮横向缩放（对齐统计图表，无横向滚动条）；
页内恒 Top N+其他、无「显示全部」按钮（全量改在放大浮层展现）。
"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "INLINEBAR-"
DSN = os.environ.get("DATABASE_URL")


def _seed():
    domains = [f"领域{i:02d}" for i in range(12)]  # >10 → Top N 裁剪 + 其他
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        for i, dm in enumerate(domains):
            cur.execute(
                """INSERT INTO qi_request
                   (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,priority,
                    domain,module_feature,planned_version,reviewer,current_stage,current_status,
                    creator_id,creator_name,created_at)
                   VALUES (%s,'质量加固和改进','测试甲 test_user01','内联缩放','N/A','d','',
                           '中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',%s)""",
                (f"{PREFIX}{i:03d}", dm, f"模块{i}", datetime.datetime(2026, 7, 31, 10, 0)),
            )
        conn.commit()


def _clean():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def test_inline_bar_wheel_zoom(page, backend_server, assert_no_js_errors):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过页内柱状图缩放测试")
    try:
        _seed()
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        # 无横向滚动条 + 无「显示全部」按钮（全量在放大浮层）
        assert page.locator(".qi-chart-scroll").count() == 0, "已取消横向滚动条方案"
        assert page.locator(".qi-expand-toggle").count() == 0, "应去掉「显示全部」按钮"

        # 页内柱图为 ECharts host，且启用 dataZoom 滚轮缩放
        has_datazoom = page.evaluate(
            """() => {
                const el = document.getElementById('qi-analytics-echart-domain-bar');
                const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
                if (!inst) return false;
                const opt = inst.getOption();
                return Array.isArray(opt.dataZoom) && opt.dataZoom.length > 0;
            }"""
        )
        assert has_datazoom, "页内领域柱图应启用 dataZoom 滚轮缩放"
    finally:
        _clean()


def _legend_selected_state(page, el_id):
    return page.evaluate(
        """(elId) => {
            const el = document.getElementById(elId);
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return null;
            const legend = (inst.getOption().legend || [{}])[0] || {};
            return JSON.stringify(legend.selected || {});
        }""",
        el_id,
    )


def test_legend_click_does_not_open_zoom(page, backend_server, assert_no_js_errors):
    """图例切显/翻页的点击不应触发全屏放大浮层；图形区点击仍应放大。"""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过图例点击测试")
    try:
        _seed()
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        # 浮层是常驻单例、以 hidden 属性开关（不移出 DOM），可见性一律查属性而非 count()
        def overlay_open():
            return page.locator(".qi-chart-zoom-overlay").get_attribute("hidden") is None

        # 领域占比饼图绑定了点击放大，且带 legend(type:scroll)，图例画在容器底部。
        # 滚动型图例条目位置随宽度/条目数变化，固定坐标不稳：网格探测底部若干点位，
        # 以「legend selected 翻转」自证命中图例；未命中处按既有设计会开浮层，关掉再试。
        el = page.locator("#qi-analytics-echart-domain-pie")
        # 该卡片常在首屏之下（容器底部可低于视口，mouse.click 打到视口外全是空点击）：
        # 先滚入视口再取坐标
        el.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        box = el.bounding_box()
        assert box, "领域占比饼图应存在"
        hit = False
        for dy in (10, 18, 26, 34, 42):
            for fx in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
                before = _legend_selected_state(page, "qi-analytics-echart-domain-pie")
                page.mouse.click(box["x"] + box["width"] * fx, box["y"] + box["height"] - dy)
                page.wait_for_timeout(300)
                if _legend_selected_state(page, "qi-analytics-echart-domain-pie") != before:
                    hit = True
                    break
                if overlay_open():
                    page.locator(".qi-chart-zoom-close").click()
                    page.wait_for_timeout(200)
            if hit:
                break
        assert hit, "网格探测未能命中图例（点击坐标全部失效，用例无法验证抑制逻辑）"
        assert not overlay_open(), "图例点击不应弹放大浮层"

        # 图形区（饼图本体）点击仍应打开放大浮层
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.3)
        page.wait_for_timeout(400)
        assert overlay_open(), "图形区点击应打开放大浮层"
        page.locator(".qi-chart-zoom-close").click()
        page.wait_for_timeout(300)
        assert not overlay_open(), "关闭后浮层应隐藏"
    finally:
        _clean()


def test_inline_charts_resize_on_window_resize(page, backend_server, assert_no_js_errors):
    """窗口尺寸变化后页内 ECharts canvas 应跟随重绘，而不是保持初始化时的像素宽度。"""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过 resize 测试")
    try:
        _seed()
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        def canvas_width(el_id):
            return page.evaluate(
                """(elId) => {
                    const el = document.getElementById(elId);
                    const c = el && el.querySelector('canvas');
                    return c ? c.width : -1;
                }""",
                el_id,
            )

        w1 = canvas_width("qi-analytics-echart-domain-bar")
        assert w1 > 100, f"初始 canvas 应有宽度: {w1}"
        page.set_viewport_size({"width": 800, "height": 900})
        page.wait_for_timeout(600)
        w2 = canvas_width("qi-analytics-echart-domain-bar")
        assert w2 < w1 - 40, f"窗口缩窄后 canvas 应重绘为新宽度: {w1} -> {w2}"
    finally:
        _clean()
