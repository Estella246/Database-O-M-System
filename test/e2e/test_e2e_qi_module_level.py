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
                       VALUES (%s,'特性加固','测试甲 test_user01','粒度','N/A','d','',
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


def _pie_pairs(page, root):
    """从 ECharts 饼图读 name→value（首序列扇区数据）。"""
    return page.evaluate(
        """(root) => {
            const base = document.querySelector(root);
            const el = base && base.querySelector('.stat-echart-host');
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return null;
            const s = ((inst.getOption().series || [])[0] || {});
            const m = {};
            (s.data || []).forEach(d => { m[String(d && d.name)] = Number(d && d.value); });
            return m;
        }""",
        root,
    )


def _wait_zoom_chart_ready(page):
    """轮询等待放大浮层内 ECharts 实例就绪（open 延迟 rAF 初始化，慢机下 500ms 固定等待不可靠）。"""
    page.wait_for_function(
        """() => {
            const el = document.querySelector('.qi-chart-zoom-overlay .stat-echart-host');
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return false;
            const s0 = (inst.getOption().series || [])[0];
            return !!(s0 && (s0.data || []).length);
        }""",
        timeout=8000,
    )
    page.wait_for_timeout(200)


def _open_module_pie_zoom(page):
    page.locator('[data-qichart="module-pie"] .stat-echart-host').first.click()
    page.locator(".qi-chart-zoom-overlay").wait_for(state="visible", timeout=8000)
    _wait_zoom_chart_ready(page)
    pairs = _pie_pairs(page, ".qi-chart-zoom-overlay")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    return pairs


def _open_module_bar_zoom(page):
    page.locator('[data-qichart="module-bar"] .stat-echart-host').first.click()
    page.locator(".qi-chart-zoom-overlay").wait_for(state="visible", timeout=8000)
    _wait_zoom_chart_ready(page)
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
            assert lvl_sel.count() == 1, "柱图卡应有且仅有一个「粒度」下拉"
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

    def test_pie_level_granularity_and_bar_independence(self, page, backend_server, assert_no_js_errors):
        """饼图粒度与柱图同款且互不耦合：默认最深前缀全路径；一级合并为领域扇区；柱图粒度不受影响。"""
        if not DSN:
            pytest.skip("无 DATABASE_URL，跳过模块粒度测试")
        try:
            _seed()
            page.set_viewport_size({"width": 1400, "height": 900})
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)

            pie_lvl_sel = page.locator("[data-qi-analytics-module-level-pie]")
            assert pie_lvl_sel.count() == 1, "饼图卡应有且仅有一个「粒度」下拉"
            assert pie_lvl_sel.input_value() == "0", "饼图默认应为「最深」"

            # 默认最深：扇区名 = 领域/模块全路径（放大浮层全量，免疫页内 Top10 截断）
            pairs = _open_module_pie_zoom(page)
            assert pairs.get("领域MLA/mA/p1") == 2, f"最深粒度应逐路径计数: {pairs}"
            assert pairs.get("领域MLA/mB") == 3 and pairs.get("领域MLB/mC") == 4, pairs

            # 先给柱图设二级、再给饼图设一级 → 柱图不受饼图粒度影响（互不耦合）
            page.locator("[data-qi-analytics-module-level-bar]").select_option("2")
            page.wait_for_timeout(800)
            pie_lvl_sel.select_option("1")
            page.wait_for_timeout(800)
            pie_pairs = _open_module_pie_zoom(page)
            assert pie_pairs.get("领域MLA") == 6, f"一级应按领域合并扇区: {pie_pairs}"
            assert pie_pairs.get("领域MLB") == 4, pie_pairs
            assert all("/" not in k for k in pie_pairs), f"一级扇区名应为领域本身: {pie_pairs}"
            bar_pairs = _open_module_bar_zoom(page)
            assert bar_pairs.get("领域MLA/mA") == 3, f"柱图应保持二级粒度（不受饼图影响）: {bar_pairs}"
        finally:
            _clean()

    def test_clamp_persists_effective_level(self, page, backend_server, assert_no_js_errors):
        """收敛即落账：存储层级超出已选领域数据最深层时收敛为有效层级并写回 state——
        切回全部领域不会静默跳回更深层级，显示值 === 提交值（重选当前项可触发 change）。"""
        if not DSN:
            pytest.skip("无 DATABASE_URL，跳过模块粒度测试")
        try:
            _seed()
            page.set_viewport_size({"width": 1400, "height": 900})
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            _select_level(page, "3")  # 全部领域 maxDepth=3（领域MLA/mA/p1）
            # 选浅领域（领域MLB 只有 mC，maxDepth=2）→ 三级收敛为二级
            page.locator("[data-qi-analytics-module-domain-bar]").select_option("领域MLB")
            page.wait_for_timeout(800)
            lvl_sel = page.locator("[data-qi-analytics-module-level-bar]")
            assert lvl_sel.input_value() == "2", "存储层级(3)超出已选领域最深层(2)应收敛显示为二级"
            pairs = _open_module_bar_zoom(page)
            assert pairs == {"mC": 4}, f"收敛后按二级聚合并去前缀: {pairs}"
            # 切回全部领域：保持收敛后的二级，不静默跳回三级
            page.locator("[data-qi-analytics-module-domain-bar]").select_option("")
            page.wait_for_timeout(800)
            assert lvl_sel.input_value() == "2", "切回全部领域应保持收敛后的二级（不跳回更深层级）"
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA/mA") == 3 and pairs.get("领域MLA/mB") == 3, pairs
            assert pairs.get("领域MLB/mC") == 4 and "领域MLA/mA/p1" not in pairs, pairs
            # 收敛后仍可正常切换其它层级（窗口内可能有库中其它领域数据，子集断言）
            _select_level(page, "1")
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA") == 6 and pairs.get("领域MLB") == 4, f"收敛后切一级应正常生效: {pairs}"
            assert "领域MLA/mA" not in pairs and "领域MLA/mA/p1" not in pairs, pairs
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
            page.locator("[data-qi-analytics-module-level-pie]").select_option("2")
            page.wait_for_timeout(800)
            # 种子 NOW()-2h 在近1周窗口内：切窗后一级合并仍在
            page.locator('[data-qi-analytics-preset="1w"]').first.click()
            page.wait_for_timeout(2500)  # 重拉 + 重挂载
            lvl_sel = page.locator("[data-qi-analytics-module-level-bar]")
            assert lvl_sel.input_value() == "1", "切窗后粒度选择应保持"
            pairs = _open_module_bar_zoom(page)
            assert pairs.get("领域MLA") == 6 and pairs.get("领域MLB") == 4, pairs
            assert all("/" not in k for k in pairs), pairs
            # 饼图粒度同样持久（state 各自独立保存）
            pie_sel = page.locator("[data-qi-analytics-module-level-pie]")
            assert pie_sel.input_value() == "2", "切窗后饼图粒度选择应保持"
            pie_pairs = _open_module_pie_zoom(page)
            assert pie_pairs.get("领域MLA/mA") == 3 and pie_pairs.get("领域MLA/mB") == 3, pie_pairs
            assert pie_pairs.get("领域MLB/mC") == 4, pie_pairs
        finally:
            _clean()
