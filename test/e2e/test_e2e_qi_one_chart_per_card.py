"""覆盖：一图一卡——每张图表卡恰好含一张图（不再多图共用一卡）。"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "ONEPERCARD-"
DSN = os.environ.get("DATABASE_URL")


def _seed():
    domains = ["数据库内核", "备份恢复", "监控告警"]
    modules = ["事务管理", "逻辑复制", "全量备份", "增量备份", "慢SQL"]
    users = ["王强 t003", "梁宇 t018", "何平 t015"]
    stages = ["propose", "review", "analysis", "closure"]
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        i = 1
        for d in domains:
            for _ in range(4):
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,
                        priority,domain,module_feature,planned_version,reviewer,current_stage,
                        current_status,creator_id,creator_name,created_at)
                       VALUES (%s,'特性加固',%s,'一图一卡测试','N/A','d','',
                               '中',%s,%s,'','test_admin',%s,'in_progress','test_admin','测试管理员',%s)""",
                    (f"{PREFIX}{i:03d}", users[i % len(users)], d, modules[i % len(modules)],
                     stages[i % len(stages)], datetime.datetime(2026, 7, 31, 10, 0)),
                )
                i += 1
        conn.commit()


def _clean():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def test_one_chart_per_card(page, backend_server, assert_no_js_errors):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("无 DATABASE_URL，跳过一图一卡测试")
    try:
        _seed()
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)

        res = page.evaluate(
            """() => {
                // 仅统计分区内的图表卡（排除 KPI 卡 .req-analytics-kpi）
                const cards = [...document.querySelectorAll('.req-analytics-section .req-analytics-block')];
                const perCard = cards.map(c => c.querySelectorAll('.stat-svg-chart, .stat-pie-svg').length);
                return {
                    cardCount: cards.length,
                    perCard,
                    allExactlyOne: perCard.every(n => n === 1),
                    multi: perCard.filter(n => n > 1).length,
                    zero: perCard.filter(n => n === 0).length,
                };
            }"""
        )
        # 分布总览(2) + 领域/模块(4) + 领域×用户(2) = 8 张图表卡
        # 不变量：没有「多图共用一卡」(multi==0)；某卡无数据时为空(0) 属正常（如无接纳数据时接纳数卡）
        assert res["cardCount"] >= 8, f"应有至少 8 张图表卡，实际 {res['cardCount']}: {res}"
        assert res["multi"] == 0, f"不应有多图共用一卡: {res}"
    finally:
        _clean()
