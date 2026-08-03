"""覆盖：接纳数（用户接纳柱图）专用看护——渲染 / Top N+其他(灰显) / 放大浮层全量。
接纳数据需 qi_stage(analysis,completed) + qi_stage_data(accept='是')。
"""
import os
import datetime
import json
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "ACC-"
DSN = os.environ.get("DATABASE_URL")
MUTED = "#c7c2b8"


def _seed():
    domains = ["数据库内核", "备份恢复", "监控告警"]
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (PREFIX + "%",))
        cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (PREFIX + "%",))
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        for i in range(1, 19):  # 18 个不同接纳人 → Top N(15)+其他
            user = f"接纳用户{i:02d} acc{i:02d}"
            dom = domains[i % len(domains)]
            rid = cur.execute(
                """INSERT INTO qi_request
                   (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,priority,
                    domain,module_feature,planned_version,reviewer,current_stage,current_status,
                    creator_id,creator_name,created_at)
                   VALUES (%s,'质量加固和改进',%s,'接纳数测试','N/A','d','','中',%s,%s,'',
                           'test_admin','acceptance','closed','test_admin','测试管理员',%s) RETURNING id""",
                (f"{PREFIX}{i:03d}", user, dom, f"模块{i}", datetime.datetime(2026, 7, 31, 10, 0)),
            ).fetchone()[0]
            sid = cur.execute(
                """INSERT INTO qi_stage (request_id, stage_key, sequence, status)
                   VALUES (%s,'analysis',3,'completed') RETURNING id""",
                (rid,),
            ).fetchone()[0]
            cur.execute(
                """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
                   VALUES (%s,%s,'analysis',%s::jsonb,FALSE,'test_admin')""",
                (sid, rid, json.dumps({"accept": "是"}, ensure_ascii=False)),
            )
        conn.commit()


def _clean():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (PREFIX + "%",))
        cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (PREFIX + "%",))
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def test_acceptance_chart(page, backend_server, assert_no_js_errors):
    """接纳数：渲染 + Top N+其他灰显 + 放大浮层全量。"""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过接纳数测试")
    try:
        _seed()
        page.set_viewport_size({"width": 1400, "height": 900})
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        # 接纳数卡（按 h3「接纳数」定位）
        info = page.evaluate(
            """() => {
                const cols = [...document.querySelectorAll('.req-analytics-dist-col')];
                const col = cols.find(c => (((c.querySelector('h3')||{}).textContent||'').trim()) === '接纳数');
                const svg = col && col.querySelector('.qi-bar-plot .stat-svg-chart');
                if (!svg) return { found: false };
                const bars = [...svg.querySelectorAll('.stat-bar-rect')];
                const labels = bars.map(b => ((b.querySelector('title')||{}).textContent||'').split(':')[0].trim());
                const last = bars[bars.length - 1];
                return { found: true, barCount: bars.length, labels, lastLabel: labels[labels.length-1], lastFill: (last && last.getAttribute('fill') || '').toLowerCase() };
            }"""
        )
        assert info["found"], "接纳数卡应存在"
        # 18 接纳人 → Top15+其他 = 16 柱
        assert info["barCount"] == 16, f"接纳数 Top15+其他应为 16 柱: {info}"
        assert info["lastLabel"] == "其他", f"末位应为「其他」: {info}"
        assert info["lastFill"] == MUTED, f"「其他」应弱化色 {MUTED}: {info}"

        # 放大浮层全量：点接纳数柱图 → 全量(>=18)、无「其他」
        page.locator('[data-qichart="user-acc"] .qi-bar-plot .stat-svg-chart').first.click()
        page.wait_for_timeout(500)
        ov = page.locator(".qi-chart-zoom-overlay")
        assert ov.get_attribute("hidden") is None, "应打开接纳数放大浮层"
        ov_info = page.evaluate(
            """() => {
                const svg = document.querySelector('.qi-chart-zoom-overlay .stat-svg-chart');
                const bars = svg ? [...svg.querySelectorAll('.stat-bar-rect')] : [];
                return { count: bars.length, labels: bars.map(b => ((b.querySelector('title')||{}).textContent||'').split(':')[0].trim()) };
            }"""
        )
        assert ov_info["count"] >= 18, f"放大浮层应全量(>=18 柱): {ov_info}"
        assert "其他" not in ov_info["labels"], f"全量应无「其他」: {ov_info}"
    finally:
        _clean()
