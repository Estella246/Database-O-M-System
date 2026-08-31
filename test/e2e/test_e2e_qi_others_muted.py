"""覆盖：Top N 只截断不合并——页内无「其他」项，柱数=Top N，全部正常彩色。
12 个领域 → 页内只显示 Top 10 柱（无「其他」）；点击放大浮层展示全量 12 柱。
"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "OTHERSFILL-"


def test_topn_truncation_no_others(page, backend_server, assert_no_js_errors):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过 Top N 截断测试")
    domains = [f"测试领域{i:02d}" for i in range(12)]  # 12 > 10 → 截断为 Top10
    try:
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
            for i, dm in enumerate(domains):
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,
                        priority,domain,module_feature,planned_version,reviewer,current_stage,
                        current_status,creator_id,creator_name,created_at)
                       VALUES (%s,'特性加固','测试甲 test_user01','TopN截断测试','N/A','d','',
                               '中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',%s)""",
                    (f"{PREFIX}{i:03d}", dm, f"模块{i}", datetime.datetime(2026, 7, 31, 10, 0)),
                )
            conn.commit()

        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        # 页内：领域柱图只显示 Top 10，无「其他」
        res = page.evaluate(
            """() => {
                const barEl = document.getElementById('qi-analytics-echart-domain-bar');
                const inst = barEl && window.echarts && window.echarts.getInstanceByDom(barEl);
                if (!inst) return { barLabels: [] };
                const opt = inst.getOption();
                const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
                return { barLabels: (xa && xa.data) || [] };
            }"""
        )
        assert len(res["barLabels"]) == 10, f"12 领域页内应只显示 Top10 柱: {res['barLabels']}"
        assert "其他" not in res["barLabels"], f"不应有「其他」柱: {res['barLabels']}"

        # 点击放大 → 浮层展示全量 12 柱
        page.locator('[data-qichart="domain-bar"] .stat-echart-host').first.click(timeout=5000)
        page.wait_for_timeout(600)
        ov = page.locator(".qi-chart-zoom-overlay")
        assert ov.get_attribute("hidden") is None, "点击柱图应打开放大浮层"
        ov_labels = page.evaluate(
            """() => {
                const hosts = document.querySelectorAll('.qi-chart-zoom-overlay .stat-echart-host, .qi-chart-zoom-overlay #chart-zoom-echart');
                for (const h of hosts) {
                    const inst = window.echarts && window.echarts.getInstanceByDom(h);
                    if (inst) {
                        const opt = inst.getOption();
                        const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
                        if (xa && xa.data) return xa.data;
                    }
                }
                return [];
            }"""
        )
        # 放大浮层展示全量（>10，且包含全部 12 个种子领域）
        assert len(ov_labels) > 10, f"放大浮层应展示全量(>10 柱): {ov_labels}"
        seeded = set(domains)
        assert seeded <= set(ov_labels), f"放大浮层应包含全部种子领域: 缺少 {seeded - set(ov_labels)}"
    finally:
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
            conn.commit()
