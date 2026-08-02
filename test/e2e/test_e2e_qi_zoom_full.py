"""覆盖：页内 Top N+其他，放大浮层展现全量（饼图+柱图，浮层无「其他」）。
种 12 领域 → 页内 Top10+其他=11；放大浮层=全量 12、无「其他」。
"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "ZOOMFULL-"
DSN = os.environ.get("DATABASE_URL")


def _seed():
    domains = [f"领域{i:02d}" for i in range(12)]
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        for i, dm in enumerate(domains):
            cur.execute(
                """INSERT INTO qi_request
                   (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,priority,
                    domain,module_feature,planned_version,reviewer,current_stage,current_status,
                    creator_id,creator_name,created_at)
                   VALUES (%s,'质量加固和改进','测试甲 test_user01','全量','N/A','d','',
                           '中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',%s)""",
                (f"{PREFIX}{i:03d}", dm, f"模块{i}", datetime.datetime(2026, 7, 31, 10, 0)),
            )
        conn.commit()


def _clean():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def _labels(page, selector, root=""):
    return page.evaluate(
        """([root, selector]) => {
            const r = root ? document.querySelector(root) : document;
            const els = r ? r.querySelectorAll(selector) : [];
            return [...els].map(e => ((e.querySelector('title') || {}).textContent || '').split(':')[0].trim());
        }""",
        [root, selector],
    )


def test_inline_topn_overlay_full(page, backend_server, assert_no_js_errors):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过浮层全量测试")
    try:
        _seed()
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)
        ov = page.locator(".qi-chart-zoom-overlay")

        # 6 张可裁剪图：有图的卡都应挂「全量渲染器」（attachQiFullRenderers 覆盖全部 key）
        attached = page.evaluate(
            """() => ["domain-pie","module-pie","domain-bar","module-bar","user-sub","user-acc"].map(k => {
                const card = document.querySelector(`[data-qichart="${k}"]`);
                const el = card && card.querySelector(".stat-pie-svg, .stat-svg-chart");
                return { k, hasCard: !!card, hasChart: !!el, hasRenderer: !!(el && typeof el._fullRenderer === "function") };
            })"""
        )
        for a in attached:
            assert a["hasCard"], f"缺少 data-qichart 卡片: {a}"
            if a["hasChart"]:
                assert a["hasRenderer"], f"有图的卡片应挂全量渲染器: {a}"

        # —— 柱图：页内 Top N+其他；放大浮层全量、无「其他」——
        inline_bar = _labels(page, ".stat-bar-rect", ".qi-bar-plot")
        assert "其他" in inline_bar, f"页内柱图应含 Top N「其他」: {inline_bar}"
        page.locator("#qi-analytics-panel .stat-svg-chart").first.click()
        page.wait_for_timeout(450)
        assert ov.get_attribute("hidden") is None, "应打开柱图放大浮层"
        overlay_bar = _labels(page, ".stat-bar-rect", ".qi-chart-zoom-overlay")
        assert "其他" not in overlay_bar, f"放大浮层应全量、无「其他」: {overlay_bar}"
        assert len(overlay_bar) > len(inline_bar), f"浮层柱数应多于页内: {len(inline_bar)} -> {len(overlay_bar)}"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # —— 饼图：页内 Top N+其他；放大浮层全量、无「其他」——
        inline_pie = _labels(page, ".stat-pie-slice", '[data-qichart="domain-pie"]')
        assert "其他" in inline_pie, f"页内饼图应含 Top N「其他」: {inline_pie}"
        page.locator('[data-qichart="domain-pie"] .stat-pie-svg').first.click()
        page.wait_for_timeout(450)
        assert ov.get_attribute("hidden") is None, "应打开饼图放大浮层"
        overlay_pie = _labels(page, ".stat-pie-slice", ".qi-chart-zoom-overlay")
        assert "其他" not in overlay_pie, f"放大浮层应全量、无「其他」: {overlay_pie}"
        assert len(overlay_pie) > len(inline_pie), f"浮层切片数应多于页内: {len(inline_pie)} -> {len(overlay_pie)}"
    finally:
        _clean()
