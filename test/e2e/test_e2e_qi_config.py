import os

import pytest

pytestmark = pytest.mark.e2e

QI_CONFIG_URL = "/params/qi-config"


class TestQiConfigPage:
    """质量改进配置页：迁移按钮权限组可见 + 白名单全选功能。"""

    def test_qi_config_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}{QI_CONFIG_URL}")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2500)
        panel = page.locator(".params-config-page")
        assert panel.count() > 0, "质量改进配置页应渲染"

    def test_qi_migrate_button_visible_for_permitted_role(self, page, backend_server, assert_no_js_errors):
        """能进入质量改进配置页（params_qi_candidates 非 hidden）的权限组应看到迁移按钮。"""
        page.goto(f"{backend_server}{QI_CONFIG_URL}")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2500)
        btn = page.locator("#qi-migrate-btn")
        assert btn.count() > 0, "有质量改进配置权限（params_qi_candidates 非 hidden）应可见迁移按钮"

    def test_qi_whitelist_select_all(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}{QI_CONFIG_URL}")
        page.wait_for_selector("#root", timeout=10000)
        # 等待 user 列表与候选人加载完成（编辑按钮出现即说明首屏已就绪）
        page.wait_for_selector("#qi-candidates-edit-btn", timeout=10000)
        page.wait_for_timeout(1500)

        # 进入编辑态
        page.locator("#qi-candidates-edit-btn").first.click(timeout=5000, force=True)
        page.wait_for_selector("#qi-candidates-select-all", timeout=5000)
        # 等待 user 列表补载完成，确保清单非空
        page.wait_for_function(
            "() => document.querySelectorAll('[data-qi-candidate-account]').length > 0",
            timeout=10000,
        )

        checkboxes = page.locator("[data-qi-candidate-account]")
        total = checkboxes.count()
        assert total > 0, "编辑态候选人清单应有可选用户"

        # 点击全选 → 所有可见项应被勾选，计数应等于可见项数
        page.locator("#qi-candidates-select-all").first.click(timeout=5000, force=True)
        page.wait_for_timeout(800)
        checked = page.locator("[data-qi-candidate-account]:checked")
        assert checked.count() == total, "全选后所有可见候选人均应被勾选"
        count_text = page.locator(".qi-candidates-count").first.inner_text()
        assert f"已选 {total} 人" in count_text, f"全选后计数应为 {total}，实际：{count_text}"

        # 再次点击（取消全选）→ 全部清空，计数归零
        page.locator("#qi-candidates-select-all").first.click(timeout=5000, force=True)
        page.wait_for_timeout(800)
        checked = page.locator("[data-qi-candidate-account]:checked")
        assert checked.count() == 0, "取消全选后不应有勾选项"
        count_text = page.locator(".qi-candidates-count").first.inner_text()
        assert "已选 0 人" in count_text, f"取消全选后计数应为 0，实际：{count_text}"

    def test_qi_candidates_search_on_submit_only(self, page, backend_server, assert_no_js_errors):
        """评审人/分析人搜索：输入不立即过滤，回车或点击搜索按钮才过滤。"""
        page.goto(f"{backend_server}{QI_CONFIG_URL}")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_selector("#qi-candidates-edit-btn", timeout=10000)
        page.wait_for_timeout(1500)
        page.locator("#qi-candidates-edit-btn").first.click(timeout=5000, force=True)
        page.wait_for_selector("#qi-candidates-select-all", timeout=5000)
        page.wait_for_function(
            "() => document.querySelectorAll('[data-qi-candidate-account]').length > 1",
            timeout=10000,
        )
        initial = page.locator("[data-qi-candidate-account]").count()
        assert initial > 1, "候选人清单应有多人供搜索过滤"

        # 输入搜索词：不应立即过滤
        page.fill("#qi-candidates-search", "test_user01")
        page.wait_for_timeout(600)
        after_type = page.locator("[data-qi-candidate-account]").count()
        assert after_type == initial, f"输入不应立即触发搜索过滤: {after_type} vs {initial}"

        # 回车：应过滤到唯一匹配
        page.press("#qi-candidates-search", "Enter")
        page.wait_for_timeout(600)
        after_enter = page.locator("[data-qi-candidate-account]").count()
        assert after_enter == 1, f"回车后应只剩 1 个匹配项(test_user01): {after_enter}"

        # 清空后点击「搜索」按钮：应恢复全部
        page.fill("#qi-candidates-search", "")
        page.wait_for_timeout(400)
        page.locator("#qi-candidates-search-btn").first.click(timeout=5000)
        page.wait_for_timeout(600)
        after_clear = page.locator("[data-qi-candidate-account]").count()
        assert after_clear == initial, f"清空后点搜索应恢复全部: {after_clear} vs {initial}"


class TestQiAnalyticsDatePicker:
    """质量改进统计-自定义日期选择器不导致页面刷新/清空。"""

    def test_custom_date_picker_opens_without_page_reset(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(3000)
        # 点"自定义"预设
        page.locator('[data-qi-analytics-preset="custom"]').first.click(timeout=5000)
        page.wait_for_timeout(1000)
        # 自定义日期区域应出现
        date_range = page.locator('[data-date-range-id="qi-analytics-custom"]')
        assert date_range.count() > 0, "自定义日期区域应出现"
        # 点击开始日期按钮 — 不应导致页面刷新/消失
        start_btn = page.locator('[data-date-range-id="qi-analytics-custom"] [data-range-part="start"]').first
        # 记录当前 URL，点击后不应变化
        url_before = page.url
        start_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        url_after = page.url
        assert url_before == url_after, f"点击日期按钮不应改变 URL: {url_before} → {url_after}"
        # 日历弹层应出现（或至少日期区域仍在）
        assert date_range.count() > 0, "点击日期后日期区域不应消失"




class TestQiAnalyticsPageLoad:
    """质量改进统计页面加载验证：面板/KPI/统计区块/SVG 图表均应渲染，且无 JS 报错。"""

    def test_qi_analytics_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector("#root", timeout=15000)
        # .req-analytics-page 仅在统计数据加载完成后才渲染，等它出现即代表首屏就绪
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(800)
        # 面板容器存在
        assert page.locator("#qi-analytics-panel").count() > 0, "质量改进统计面板应渲染"
        # KPI 卡片区存在
        assert page.locator(".req-analytics-kpi-grid").count() > 0, "KPI 卡片区应存在"
        # 至少一个统计区块（分布总览 / 领域·模块 / 领域×用户 / 耗时Top）
        assert page.locator(".req-analytics-block").count() > 0, "统计区块应存在"
        # SVG 图表存在（饼图或柱状图）
        assert page.locator(".stat-svg-chart").count() > 0, "SVG 图表应存在"

    def test_qi_analytics_renders_distribution_sections(self, page, backend_server, assert_no_js_errors):
        """验证分布相关区块（分布总览 / 领域·模块 / 领域×用户）标题正常渲染。"""
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(800)
        headings = page.locator(".req-analytics-h2").all_inner_texts()
        page_text = " ".join(headings)
        assert "分布总览" in page_text, f"应有「分布总览」区块，实际标题: {headings}"
        assert "领域" in page_text, f"应有领域相关区块，实际标题: {headings}"


class TestQiAnalyticsDomainFilter:
    """领域×用户矩阵：可按领域筛选，默认展示全部领域，选中某领域后矩阵收敛到该领域。"""

    QI_NO_PREFIX = "DOMFILT-"
    DOM_A = "筛选测试领域A"
    DOM_B = "筛选测试领域B"

    def _seed_qi_rows(self, dsn):
        import psycopg
        rows = [
            (f"{self.QI_NO_PREFIX}A1", "测试甲 domA", self.DOM_A),
            (f"{self.QI_NO_PREFIX}A2", "测试乙 domB", self.DOM_A),
            (f"{self.QI_NO_PREFIX}B1", "测试甲 domA", self.DOM_B),
        ]
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                # 自愈：清理可能残留的同前缀行（含子表），避免上次中断留下的主键冲突
                cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (self.QI_NO_PREFIX + "%",))
                cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (self.QI_NO_PREFIX + "%",))
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (self.QI_NO_PREFIX + "%",))
                for qi_no, proposer, domain in rows:
                    cur.execute(
                        """INSERT INTO qi_request
                           (qi_no, category, proposer, title, related_ticket_no, description,
                            expected_goal, priority, domain, module_feature, planned_version,
                            reviewer, current_stage, current_status, creator_id, creator_name)
                           VALUES (%s,'质量加固和改进',%s,'领域筛选测试','DOMFILT-N/A','测试描述',
                                   '','中',%s,'','','test_admin','review','in_progress','test_admin','测试管理员')""",
                        (qi_no, proposer, domain),
                    )
            conn.commit()

    def _cleanup_qi_rows(self, dsn):
        import psycopg
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (self.QI_NO_PREFIX + "%",))
                cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (self.QI_NO_PREFIX + "%",))
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (self.QI_NO_PREFIX + "%",))
            conn.commit()

    def test_domain_filter_narrows_matrix(self, page, backend_server, assert_no_js_errors):
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过领域筛选测试")
        try:
            self._seed_qi_rows(dsn)
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1000)

            # 已种数据 → 柱状图应渲染并显示数值标签（showValues 开启）
            assert page.locator("#qi-analytics-panel .stat-bar-val").count() > 0, "柱状图应显示数值标签"
            # 每个柱状图应按数值从高到低（左→右）排列
            charts = page.eval_on_selector_all(
                "#qi-analytics-panel .stat-svg-chart",
                "els => els.map(c => [...c.querySelectorAll('.stat-bar-rect')].map(b => ((b.querySelector('title')||{}).textContent || '').trim()))",
            )
            for idx, titles in enumerate(charts):
                vals = [int(t.rsplit(":", 1)[1]) for t in titles if ":" in t and t.rsplit(":", 1)[1].strip().isdigit()]
                if len(vals) > 1:
                    assert vals == sorted(vals, reverse=True), f"第{idx+1}个柱状图应降序，实际: {vals}"

            sel = page.locator("#qi-analytics-domain")
            assert sel.count() > 0, "领域×用户区块应有领域筛选下拉"
            assert sel.input_value() == "", "默认应选中「全部领域」"

            def domain_columns():
                # 领域×用户矩阵（提交数）表头：首列「用户\领域」、末列「合计」之外即领域列
                heads = page.locator(".qi-analytics-matrix--user-domain").first.locator("thead th").all_inner_texts()
                return [h.strip() for h in heads[1:-1]]

            # 默认全部：两个测试领域都应作为列出现
            cols = domain_columns()
            assert self.DOM_A in cols and self.DOM_B in cols, f"默认应展示全部领域，实际列: {cols}"

            # 选领域 A：矩阵收敛到只有 A 一列
            sel.select_option(self.DOM_A)
            page.wait_for_timeout(700)
            cols_a = domain_columns()
            assert cols_a == [self.DOM_A], f"筛选「{self.DOM_A}」后应只剩该领域一列，实际: {cols_a}"
            # 选领域后末列表头应由「合计」变「小计」（反映是领域小计语义）
            last_head = page.locator(".qi-analytics-matrix--user-domain").first.locator("thead th").all_inner_texts()[-1].strip()
            assert last_head == "小计", f"筛选领域后末列应为「小计」，实际: {last_head}"

            # 切回全部：恢复两列
            sel.select_option("")
            page.wait_for_timeout(700)
            cols_back = domain_columns()
            assert self.DOM_A in cols_back and self.DOM_B in cols_back, f"切回全部应恢复，实际列: {cols_back}"
        finally:
            self._cleanup_qi_rows(dsn)

    def test_bar_hover_shows_tooltip(self, page, backend_server, assert_no_js_errors):
        """柱状图悬停应弹出浮动提示（原生 <title> 在 SVG 不可靠，改用 .stat-svg-tooltip）。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过 tooltip 测试")
        try:
            self._seed_qi_rows(dsn)
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1000)
            tip = page.locator(".stat-svg-tooltip")
            assert not tip.is_visible(), "hover 前提示应隐藏"
            bar = page.locator("#qi-analytics-panel .stat-bar-rect").first
            title = page.eval_on_selector("#qi-analytics-panel .stat-bar-rect", "el => ((el.querySelector('title')||{}).textContent || '').trim()")
            bar.hover()
            page.wait_for_timeout(400)
            assert tip.is_visible(), "悬停柱子应弹出提示"
            assert tip.inner_text().strip() == title, f"提示文本应=柱子 title，实际: {tip.inner_text().strip()!r} vs {title!r}"
        finally:
            self._cleanup_qi_rows(dsn)

    def test_domain_filter_resets_on_preset_change(self, page, backend_server, assert_no_js_errors):
        """切换时间预设应重置领域筛选，避免幽灵筛选跨窗口残留/复活。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过领域筛选测试")
        try:
            self._seed_qi_rows(dsn)
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1000)
            sel = page.locator("#qi-analytics-domain")
            sel.select_option(self.DOM_A)
            page.wait_for_timeout(700)
            assert sel.input_value() == self.DOM_A, "应已选中领域 A"
            # 切换时间预设 → 领域筛选应重置为「全部领域」
            page.locator("[data-qi-analytics-preset]").first.click()
            # 直接等待「下拉重建且值为空」这一稳定条件，避免读到重渲染前的旧元素/加载态
            page.wait_for_function(
                "() => { const s = document.querySelector('#qi-analytics-domain'); return !!s && s.value === ''; }",
                timeout=15000,
            )
            assert sel.input_value() == "", f"切预设后领域筛选应重置为全部，实际: {sel.input_value()}"
        finally:
            self._cleanup_qi_rows(dsn)

    def test_empty_proposer_bucketed_as_unknown(self, backend_server):
        """空 proposer 应归到 user='未知'（NULLIF 兜底）；提交/接纳两条矩阵都应如此。"""
        import json
        import psycopg
        import httpx
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过空 proposer 测试")
        qi_no = self.QI_NO_PREFIX + "EMPTY"
        domain = "空proposer域"
        try:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                rid = cur.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, proposer, title, related_ticket_no, description,
                        expected_goal, priority, domain, module_feature, planned_version,
                        reviewer, current_stage, current_status, creator_id, creator_name)
                       VALUES (%s,'质量加固和改进','','空proposer测试','DOMFILT-N/A','测试描述',
                               '','中',%s,'','','test_admin','review','in_progress','test_admin','测试管理员')
                       RETURNING id""",
                    (qi_no, domain),
                ).fetchone()[0]
                # 置为已接纳（analysis 阶段 accept=是）→ 同时进入接纳矩阵，覆盖两条 SQL 的 NULLIF
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
            r = httpx.get(f"{backend_server}/api/qi/analytics",
                          params={"operator_id": "test_admin", "start_date": "", "end_date": ""})
            data = r.json()
            sub_users = {row["user"] for row in data.get("user_domain_submission", []) if row.get("domain") == domain}
            acc_users = {row["user"] for row in data.get("user_domain_acceptance", []) if row.get("domain") == domain}
            assert sub_users == {"未知"}, f"提交矩阵：空 proposer 应归到 '未知'，实际: {sub_users}"
            assert acc_users == {"未知"}, f"接纳矩阵：空 proposer 应归到 '未知'，实际: {acc_users}"
        finally:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no = %s)", (qi_no,))
                cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no = %s)", (qi_no,))
                cur.execute("DELETE FROM qi_request WHERE qi_no = %s", (qi_no,))
                conn.commit()
