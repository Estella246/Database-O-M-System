"""覆盖：页内柱状图（.qi-bar-plot）滚轮横向缩放（对齐统计图表，无横向滚动条）；
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

        # 无横向滚动条：页内柱图为 plot-slot
        assert page.locator(".qi-chart-scroll").count() == 0, "已取消横向滚动条方案"
        assert page.locator(".qi-bar-plot").count() > 0, "页内柱状图应为 .qi-bar-plot"
        # 无「显示全部」按钮（页内恒 Top N，全量在放大浮层）
        assert page.locator(".qi-expand-toggle").count() == 0, "应去掉「显示全部」按钮"

        # 领域柱图（首个 .qi-bar-plot）滚轮横向缩放
        def vb_width():
            return page.evaluate(
                """() => {
                    const svg = document.querySelector('.qi-bar-plot .stat-svg-chart');
                    if (!svg) return null;
                    const vb = (svg.getAttribute('viewBox') || '').split(' ');
                    return vb.length >= 3 ? parseFloat(vb[2]) : null;
                }"""
            )

        w0 = vb_width()
        assert w0 and w0 > 0, f"领域柱图应有 viewBox: {w0}"

        def host_wheel(deltaY):
            page.evaluate(
                """(dy) => {
                    const host = document.querySelector('.qi-bar-plot');
                    if (host) host.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
                }""",
                deltaY,
            )

        host_wheel(-400)
        page.wait_for_timeout(200)
        w1 = vb_width()
        assert w1 < w0, f"滚轮向上应放大（viewBox 变窄）: {w0} -> {w1}"
        host_wheel(400)
        page.wait_for_timeout(200)
        w2 = vb_width()
        assert w2 > w1, f"滚轮向下应缩小（viewBox 变宽）: {w1} -> {w2}"
    finally:
        _clean()
