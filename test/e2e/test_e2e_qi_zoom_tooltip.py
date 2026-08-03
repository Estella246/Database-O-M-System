"""覆盖：放大浮层内 hover 饼图切片 / 柱图柱子 显示标签（浮动提示 .stat-svg-tooltip）。
回归点：浮层是独立 DOM，tooltip 需在克隆上重绑，且 z-index 需高于浮层。
"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "ZOOMTIP-"
DSN = os.environ.get("DATABASE_URL")


def _seed():
    cats = ["定位定界", "测试加固", "需求", "质量加固和改进"]
    stages = ["propose", "review", "analysis"]
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        for i in range(6):
            cur.execute(
                """INSERT INTO qi_request
                   (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,priority,
                    domain,module_feature,planned_version,reviewer,current_stage,current_status,
                    creator_id,creator_name,created_at)
                   VALUES (%s,%s,'测试甲 test_user01','浮层提示','N/A','d','',
                           '中',%s,%s,'','test_admin',%s,'in_progress','test_admin','测试管理员',%s)""",
                (f"{PREFIX}{i:03d}", cats[i % len(cats)], f"领域{i % 3}", f"模块{i}",
                 stages[i % len(stages)], datetime.datetime(2026, 7, 31, 10, 0)),
            )
        conn.commit()


def _clean():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def _tip_state(page):
    return page.evaluate(
        """() => {
            const t = document.querySelector('.stat-svg-tooltip');
            if (!t) return { display: "none", text: "" };
            return { display: getComputedStyle(t).display, text: (t.textContent || "").trim() };
        }"""
    )


def test_zoom_overlay_hover_tooltip(page, backend_server, assert_no_js_errors):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过浮层 hover 提示测试")
    try:
        _seed()
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        ov = page.locator(".qi-chart-zoom-overlay")

        # 1) 饼图：打开浮层 → hover 第一个切片 → 应显示提示且含标签
        page.locator("#qi-analytics-panel .stat-pie-svg").first.click()
        page.wait_for_timeout(400)
        assert ov.get_attribute("hidden") is None, "应打开饼图放大浮层"
        ov.locator(".stat-pie-slice").first.hover(force=True)
        page.wait_for_timeout(250)
        st = _tip_state(page)
        assert st["display"] == "block", f"hover 饼图切片应显示浮动提示: {st}"
        assert ":" in st["text"], f"提示应含「标签: 值」: {st}"
        # 离开 → 提示隐藏
        page.mouse.move(0, 0)
        page.wait_for_timeout(200)
        assert _tip_state(page)["display"] == "none", "移出后提示应隐藏"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # 2) 柱图：打开浮层 → hover 第一根柱子 → 应显示提示
        page.locator("#qi-analytics-panel .stat-svg-chart").first.click()
        page.wait_for_timeout(400)
        assert ov.get_attribute("hidden") is None, "应打开柱图放大浮层"
        ov.locator(".stat-bar-rect").first.hover(force=True)
        page.wait_for_timeout(250)
        st = _tip_state(page)
        assert st["display"] == "block", f"hover 柱图柱子应显示浮动提示: {st}"
        assert ":" in st["text"], f"提示应含「标签: 值」: {st}"
    finally:
        _clean()
