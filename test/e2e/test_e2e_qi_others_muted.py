"""覆盖：Top N「其他」灰显——othersFills + 饼图/图例/柱状图 opt-in fills。
12 个领域 → Top10 + 其他；断言「其他」柱/扇区/圆点用弱化色 #c7c2b8，前 10 项为正常彩色。
"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "OTHERSFILL-"
MUTED = "#c7c2b8"


def test_others_slice_bar_legend_muted(page, backend_server, assert_no_js_errors):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过「其他」灰显测试")
    domains = [f"测试领域{i:02d}" for i in range(12)]  # 12 > 10 → 触发 Top N + 其他
    try:
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
            for i, dm in enumerate(domains):
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,
                        priority,domain,module_feature,planned_version,reviewer,current_stage,
                        current_status,creator_id,creator_name,created_at)
                       VALUES (%s,'质量加固和改进','测试甲 test_user01','其他灰显测试','N/A','d','',
                               '中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',%s)""",
                    (f"{PREFIX}{i:03d}", dm, f"模块{i}", datetime.datetime(2026, 7, 31, 10, 0)),
                )
            conn.commit()

        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        res = page.evaluate(
            """(muted) => {
                const firstBar = document.querySelector('#qi-analytics-panel .stat-svg-chart');
                const bars = firstBar ? [...firstBar.querySelectorAll('.stat-bar-rect')].map(e => (e.getAttribute('fill') || '').toLowerCase()) : [];
                const slices = [...document.querySelectorAll('#qi-analytics-panel .stat-pie-slice')].map(e => (e.getAttribute('fill') || '').toLowerCase());
                const dots = [...document.querySelectorAll('#qi-analytics-panel .stat-pie-legend-dot')].map(e => (e.getAttribute('style') || '').toLowerCase());
                return {
                    barCount: bars.length,
                    lastBarMuted: bars.length ? bars[bars.length - 1] === muted : false,
                    nonMutedBars: bars.filter(b => b && b !== muted).length,
                    anySliceMuted: slices.includes(muted),
                    anyDotMuted: dots.some(s => s.includes(muted)),
                };
            }""",
            MUTED,
        )
        assert res["barCount"] == 11, f"12 领域 Top10+其他应为 11 柱: {res}"
        assert res["nonMutedBars"] == 10, f"前 10 柱应为正常彩色(非弱化): {res}"
        assert res["lastBarMuted"], f"末位「其他」柱应弱化为 {MUTED}: {res}"
        assert res["anySliceMuted"], f"饼图「其他」扇区应弱化: {res}"
        assert res["anyDotMuted"], f"图例「其他」圆点应弱化: {res}"
    finally:
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
            conn.commit()
