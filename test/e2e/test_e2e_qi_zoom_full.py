"""覆盖：页内 Top N 只截断不合并，放大浮层展现全量（饼图+柱图，页内与浮层均无「其他」）。
种 12 领域 → 页内 Top10=10；放大浮层=全量 12。
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


def _echart_labels(page, root=""):
    """从 ECharts 柱图容器读取 X 轴类目标签。"""
    return page.evaluate(
        """(root) => {
            const base = root ? document.querySelector(root) : document;
            const el = base ? base.querySelector('.stat-echart-host') : null;
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return [];
            const opt = inst.getOption();
            return (((opt.xAxis && opt.xAxis[0]) || {}).data || []).map(String);
        }""",
        root,
    )


def _echart_pie_labels(page, root=""):
    """从 ECharts 饼图容器读取扇区名。"""
    return page.evaluate(
        """(root) => {
            const base = root ? document.querySelector(root) : document;
            const el = base ? base.querySelector('.stat-echart-host') : null;
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return [];
            const opt = inst.getOption();
            const s0 = opt.series && opt.series[0];
            if (!s0 || s0.type !== 'pie') return [];
            return ((s0.data || []).map(d => d && d.name).map(String));
        }""",
        root,
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

        # 8 张图表均为 ECharts host
        ech_ids = [
            "qi-analytics-echart-stage-pie", "qi-analytics-echart-category-pie",
            "qi-analytics-echart-domain-pie", "qi-analytics-echart-module-pie",
            "qi-analytics-echart-domain-bar", "qi-analytics-echart-module-bar",
            "qi-analytics-echart-user-sub", "qi-analytics-echart-user-acc",
        ]
        attached = page.evaluate(
            """(ids) => ids.map(id => ({ id, exists: !!document.getElementById(id) }))""",
            ech_ids,
        )
        for a in attached:
            assert a["exists"], f"缺少 ECharts host: {a}"

        # —— 领域柱图（ECharts）：页内 Top N 只截断（无「其他」）；放大浮层全量 ——
        inline_bar = _echart_labels(page, '[data-qichart="domain-bar"]')
        assert "其他" not in inline_bar, f"页内领域柱图不应有「其他」: {inline_bar}"
        assert len(inline_bar) == 10, f"12 领域页内应只显示 Top10 柱: {inline_bar}"
        page.locator('[data-qichart="domain-bar"] .stat-echart-host').first.click()
        page.wait_for_timeout(450)
        assert ov.get_attribute("hidden") is None, "应打开领域柱图放大浮层"
        overlay_bar = _echart_labels(page, ".qi-chart-zoom-overlay")
        assert "其他" not in overlay_bar, f"放大浮层应全量、无「其他」: {overlay_bar}"
        assert len(overlay_bar) > len(inline_bar), f"浮层柱数应多于页内: {len(inline_bar)} -> {len(overlay_bar)}"
        assert set(overlay_bar) >= set(inline_bar), f"浮层应包含页内全部柱: {inline_bar} vs {overlay_bar}"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # —— 领域饼图（ECharts）：页内 Top N 只截断（无「其他」）；放大浮层全量 ——
        inline_pie = _echart_pie_labels(page, '[data-qichart="domain-pie"]')
        assert "其他" not in inline_pie, f"页内饼图不应有「其他」: {inline_pie}"
        assert len(inline_pie) == 10, f"12 领域页内饼图应只显示 Top10 切片: {inline_pie}"
        page.locator('[data-qichart="domain-pie"] .stat-echart-host').first.click()
        page.wait_for_timeout(450)
        assert ov.get_attribute("hidden") is None, "应打开饼图放大浮层"
        overlay_pie = _echart_pie_labels(page, ".qi-chart-zoom-overlay")
        assert "其他" not in overlay_pie, f"放大浮层应全量、无「其他」: {overlay_pie}"
        assert len(overlay_pie) > len(inline_pie), f"浮层切片数应多于页内: {len(inline_pie)} -> {len(overlay_pie)}"
        assert set(overlay_pie) >= set(inline_pie), f"浮层应包含页内全部切片: {inline_pie} vs {overlay_pie}"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    finally:
        _clean()


def test_zero_data_empty_hint_and_zoom_noop(page, backend_server, assert_no_js_errors):
    """零数据窗口：图卡显示「暂无数据」空态；点击空图卡不打开空白放大浮层。

    状态筛选=不接纳关闭（closed + review/analysis）：先把库里此类单临时置为进行中，
    保证筛选结果确定为零，结束时恢复原状态。
    """
    if not DSN:
        pytest.skip("无 DATABASE_URL，跳过零数据空态测试")
    moved = []
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, current_stage FROM qi_request "
            "WHERE current_status = 'closed' AND current_stage IN ('review', 'analysis')"
        )
        moved = cur.fetchall()
        if moved:
            cur.execute(
                "UPDATE qi_request SET current_status = 'in_progress' "
                "WHERE current_status = 'closed' AND current_stage IN ('review', 'analysis')"
            )
        conn.commit()
    try:
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator('[data-qi-analytics-status="closed_reject"]').first.click()
        page.wait_for_timeout(2500)  # 等筛选重拉 + 图表重挂载
        # 阶段/改进类型饼图恒渲染全类目（值为 0，后端契约），空态只看数据行驱动的柱图/堆叠卡
        for eid in ["qi-analytics-echart-domain-bar", "qi-analytics-echart-module-bar",
                    "qi-analytics-echart-user-sub", "qi-analytics-echart-user-acc",
                    "qi-analytics-echart-user-pending"]:
            empty = page.locator(f"#{eid} .qi-stage-empty", has_text="暂无数据")
            assert empty.count() == 1, f"零数据时 {eid} 应显示「暂无数据」空态"
        # 点击空图卡（提交数）：不打开空白放大浮层
        page.locator('[data-qichart="user-sub"] .stat-echart-host').first.click()
        page.wait_for_timeout(500)
        assert page.locator(".qi-chart-zoom-overlay").get_attribute("hidden") is not None, \
            "空数据点击图卡不应打开放大浮层"
    finally:
        if moved:
            with psycopg.connect(DSN) as conn, conn.cursor() as cur:
                for rid, stage in moved:
                    cur.execute(
                        "UPDATE qi_request SET current_status = 'closed', current_stage = %s WHERE id = %s",
                        (stage, rid),
                    )
                conn.commit()
