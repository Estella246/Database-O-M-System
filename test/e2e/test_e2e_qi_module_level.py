"""E2E：模块&特性柱状图「层级粒度」选择（从领域算起：一级=领域，最深=领域+完整模块路径）。

覆盖：
- 默认「最深」：全部领域下标签为 领域/模块全路径（含多段路径），计数与逐路径一致。
- 一级=领域本身：同领域全部合并计数；二级=领域/模块：叶子段合并。
- 已选领域：展示层剥掉恒定领域前缀（计数口径不变），一级只剩领域本身一根柱。
- 放大浮层与页内柱图同源跟随粒度（qiAnalyticsFull.moduleBar）。
- 切换时间窗口：粒度选择持久（领域筛选按既有约定重置），无 JS 错误。
"""
import os
import datetime
import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "MODLVL-"
DSN = os.environ.get("DATABASE_URL")

# 领域MLA：mA/p1×2 + mA/p2×1 + mB×3；领域MLB：mC×4（NOW() 种子抗污染 + 近1周窗口内）
SEED = [
    ("领域MLA", "mA/p1", 2),
    ("领域MLA", "mA/p2", 1),
    ("领域MLA", "mB", 3),
    ("领域MLB", "mC", 4),
]


def _seed():
    now = datetime.datetime.now()
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        n = 0
        for domain, module, cnt in SEED:
            for _ in range(cnt):
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,priority,
                        domain,module_feature,planned_version,reviewer,current_stage,current_status,
                        creator_id,creator_name,created_at)
                       VALUES (%s,'质量加固和改进','测试甲 test_user01','粒度','N/A','d','',
                               '中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',%s)""",
                    (f"{PREFIX}{n:03d}", domain, module, now - datetime.timedelta(hours=2)),
                )
                n += 1
        conn.commit()


def _clean():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def _bar_pairs(page, root):
    """从 ECharts 柱图读 label→value（xAxis 类目 × 首序列数值）。"""
    return page.evaluate(
        """(root) => {
            const base = document.querySelector(root);
            const el = base && base.querySelector('.stat-echart-host');
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return null;
            const opt = inst.getOption();
            const labels = ((opt.xAxis && opt.xAxis[0]) || {}).data || [];
            const vals = ((opt.series && opt.series[0]) || {}).data || [];
            const m = {};
            labels.forEach((l, i) => {
                const v = vals[i];
                m[String(l)] = Number(v && typeof v === "object" ? v.value : v);
            });
            return m;
        }""",
        root,
    )


def _open_module_bar_zoom(page):
    page.locator('[data-qichart="module-bar"] .stat-echart-host').first.click()
    page.wait_for_timeout(500)
    assert page.locator(".qi-chart-zoom-overlay").get_attribute("hidden") is None, "应打开放大浮层"
    pairs = _bar_pairs(page, ".qi-chart-zoom-overlay")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    return pairs


def _select_level(page, value):
    page.locator("[data-qi-analytics-module-level-bar]").select_option(value)
    page.wait_for_timeout(800)  # 纯前端重聚合 + 重挂载


class TestModuleLevelGranularity:
    def test_default_deepest_and_level_switch(self, page, backend_server, assert_no_js_errors):
        if not DSN:
            pytest.skip("无 DATABASE_URL，跳过模块粒度测试")
        try:
            _seed()
            page.set_viewport_size({"width": 1400, "height": 900})
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)

            # 粒度下拉存在；默认「最深」；选项枚举到数据最深层级（本地 DENSE 数据含 3 段模块路径 → 含「四级」）
            lvl_sel = page.locator("[data-qi-analytics-module-level-bar]")
            assert lvl_sel.count() >= 1, "柱图卡应有「粒度」下拉"
            assert lvl_sel.input_value() == "0", "默认应为「最深」（行为不变）"
            for label in ("最深", "一级", "二级"):
                assert lvl_sel.locator("option", has_text=label).count() >= 1, f"粒度选项应含「{label}」"

            # 默认最深：全部领域下标签 = 领域/模块全路径（放大浮层取全量，免疫页内 Top10 挤占）
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA/mA/p1") == 2, f"最深粒度应逐路径计数: {pairs}"
            assert pairs.get("领域MLA/mA/p2") == 1 and pairs.get("领域MLA/mB") == 3, pairs
            assert pairs.get("领域MLB/mC") == 4, pairs

            # 一级=领域本身：同领域合并
            _select_level(page, "1")
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA") == 6, f"一级应按领域合并 2+1+3=6: {pairs}"
            assert pairs.get("领域MLB") == 4, pairs
            assert all("/" not in k for k in pairs), f"一级标签应为领域本身（无斜杠）: {pairs}"

            # 二级=领域/模块：mA 两叶子合并为 3
            _select_level(page, "2")
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA/mA") == 3, f"二级应合并 mA 叶子 2+1=3: {pairs}"
            assert pairs.get("领域MLA/mB") == 3 and pairs.get("领域MLB/mC") == 4, pairs
            assert all(k.count("/") <= 1 for k in pairs), f"二级标签最多一个斜杠: {pairs}"
        finally:
            _clean()

    def test_domain_filter_strips_prefix(self, page, backend_server, assert_no_js_errors):
        """已选领域：粒度计数仍从领域算起，展示剥掉恒定前缀；一级只剩领域一根柱。"""
        if not DSN:
            pytest.skip("无 DATABASE_URL，跳过模块粒度测试")
        try:
            _seed()
            page.set_viewport_size({"width": 1400, "height": 900})
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            page.locator("[data-qi-analytics-module-domain-bar]").select_option("领域MLA")
            page.wait_for_timeout(800)
            _select_level(page, "2")
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("mA") == 3 and pairs.get("mB") == 3, f"选领域后二级应去前缀: {pairs}"
            assert all(not k.startswith("领域MLA/") and k != "领域MLB" for k in pairs), pairs
            # 一级 + 已选领域 → 全部并入领域本身（无斜杠、不去前缀），仅一根柱
            _select_level(page, "1")
            pairs = _open_module_bar_zoom(page)
            assert pairs == {"领域MLA": 6}, f"一级+已选领域应只剩领域本身一根柱: {pairs}"
        finally:
            _clean()

    def test_level_persists_across_window_switch(self, page, backend_server, assert_no_js_errors):
        """切换时间窗口：粒度持久（领域筛选按既有约定重置），选项仍可用，无 JS 错误。"""
        if not DSN:
            pytest.skip("无 DATABASE_URL，跳过模块粒度测试")
        try:
            _seed()
            page.set_viewport_size({"width": 1400, "height": 900})
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            _select_level(page, "1")
            # 种子 NOW()-2h 在近1周窗口内：切窗后一级合并仍在
            page.locator('[data-qi-analytics-preset="1w"]').first.click()
            page.wait_for_timeout(2500)  # 重拉 + 重挂载
            lvl_sel = page.locator("[data-qi-analytics-module-level-bar]")
            assert lvl_sel.input_value() == "1", "切窗后粒度选择应保持"
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA") == 6 and pairs.get("领域MLB") == 4, pairs
            assert all("/" not in k for k in pairs), pairs
        finally:
            _clean()
