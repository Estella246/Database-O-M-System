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
    """改进报表-自定义日期选择器不导致页面刷新/清空。"""

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
    """改进报表页面加载验证：面板/KPI/统计区块/SVG 图表均应渲染，且无 JS 报错。"""

    def test_qi_analytics_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector("#root", timeout=15000)
        # .req-analytics-page 仅在统计数据加载完成后才渲染，等它出现即代表首屏就绪
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(800)
        # 面板容器存在
        assert page.locator("#qi-analytics-panel").count() > 0, "改进报表面板应渲染"
        # KPI 卡片区存在
        assert page.locator(".req-analytics-kpi-grid").count() > 0, "KPI 卡片区应存在"
        # 至少一个统计区块（分布总览 / 领域·模块 / 领域×用户 / 耗时Top）
        assert page.locator(".req-analytics-block").count() > 0, "统计区块应存在"
        # 图表存在（全部 ECharts）
        assert page.locator(".stat-echart-host").count() > 0, "ECharts 图表应存在"

    def test_qi_analytics_renders_distribution_sections(self, page, backend_server, assert_no_js_errors):
        """验证分布相关区块（分布总览 / 领域·模块 / 领域×用户）标题正常渲染。"""
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(800)
        headings = page.locator(".req-analytics-h2").all_inner_texts()
        page_text = " ".join(headings)
        assert "分布总览" in page_text, f"应有「分布总览」区块，实际标题: {headings}"
        assert "领域" in page_text, f"应有领域相关区块，实际标题: {headings}"
        # 饼图应有 4 个：阶段 / 改进类型 / 领域占比 / 模块&特性占比
        assert page.locator("#qi-analytics-panel .stat-echart-host").count() >= 8, "应有 8 个 ECharts 图表（4 饼图 + 4 柱图）"

    def test_qi_analytics_bars_show_value_labels_and_aria(self, page, backend_server, assert_no_js_errors):
        """Q1：柱状图柱顶数值标签恢复（SVG showValues 时代等价）+ aria 描述生效（非死参数）。"""
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)
        for chart_id in ("qi-analytics-echart-domain-bar", "qi-analytics-echart-module-bar",
                         "qi-analytics-echart-rf-acc"):
            info = page.evaluate(f"""() => {{
                const el = document.getElementById('{chart_id}');
                if (!el) return null;
                const inst = window.echarts && window.echarts.getInstanceByDom(el);
                if (!inst) return null;
                const o = inst.getOption();
                const s = (o.series || [])[0] || {{}};
                return {{
                    labelShow: s.label && s.label.show,
                    ariaDesc: o.aria && o.aria.label && o.aria.label.description,
                }};
            }}""")
            assert info is not None, f"{chart_id} 应已挂载 echarts 实例"
            assert info["labelShow"] is True, f"{chart_id} 柱顶数值标签应开启: {info}"
            assert info["ariaDesc"], f"{chart_id} aria 描述应生效（映射 opts.aria）: {info}"


class TestQiAnalyticsDomainFilter:
    """领域×用户矩阵：可按领域筛选，默认展示全部领域，选中某领域后矩阵收敛到该领域。"""

    # === ECharts 工具：从 echarts 实例提取 X 轴标签（替代原 SVG .stat-bar-rect title） ===
    def _echart_x_labels(page, el_id):
        """从 ECharts 容器提取 X 轴类目标签列表。"""
        return page.evaluate(f"""() => {{
            const el = document.getElementById('{el_id}');
            if (!el) return [];
            const inst = window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return [];
            const opt = inst.getOption();
            return (opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || [];
        }}""")

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
                           VALUES (%s,'特性加固',%s,'领域筛选测试','DOMFILT-N/A','测试描述',
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

    def test_domain_filter_narrows_user_bar(self, page, backend_server, assert_no_js_errors):
        """领域×用户：提交数/接纳数各自独立按领域筛选（互不影响）。自种含接纳数据（analysis accept=是）。"""
        import json
        import psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过领域×用户筛选测试")
        prefix = "DOMFILTIND-"
        rows = [
            (prefix + "A1", self.DOM_A, "测试甲"),
            (prefix + "A2", self.DOM_A, "测试乙"),
            (prefix + "B1", self.DOM_B, "测试甲"),
        ]
        try:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (prefix + "%",))
                cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (prefix + "%",))
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                for qi_no, domain, user in rows:
                    rid = cur.execute(
                        """INSERT INTO qi_request
                           (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                            priority, domain, module_feature, planned_version, reviewer, current_stage,
                            current_status, creator_id, creator_name, created_at)
                           VALUES (%s,'特性加固',%s,'领域用户筛选','x','d','',
                                   '中',%s,'','','test_admin','review','in_progress','test_admin','测试管理员',NOW())
                           RETURNING id""",
                        (qi_no, user, domain),
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
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1500)
            # 切「近1周」窗口：种子落在今天，库里历史数据（如 DENSE 批量造数）全部排除，
            # top-N 图表（用户 top15/模块 top10）只含种子，断言不随环境数据量漂移
            page.locator('[data-qi-analytics-preset="1w"]').click()
            page.wait_for_timeout(2500)

            # ECharts 柱图应有 canvas 渲染
            assert page.locator("#qi-analytics-panel .stat-echart-host canvas").count() > 0, "ECharts 柱图应渲染"

            subSel = page.locator("[data-qi-analytics-domain-sub]")
            accSel = page.locator("[data-qi-analytics-domain-acc]")
            assert subSel.count() == 1 and accSel.count() == 1, "提交数/接纳率应各有一个独立领域筛选器"

            def labels(title):
                return page.evaluate("""(title) => {
                  const cols = [...document.querySelectorAll('.req-analytics-dist-col')];
                  const col = cols.find(c => (((c.querySelector('h3')||{}).textContent||'').trim()).includes(title));
                  if (!col) return [];
                  const host = col.querySelector('.stat-echart-host');
                  if (host && window.echarts) {
                    const inst = window.echarts.getInstanceByDom(host);
                    if (inst) {
                      const opt = inst.getOption();
                      const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
                      return Array.isArray(xa && xa.data) ? xa.data.map(String) : [];
                    }
                  }
                  return [];
                }""", title)

            # 默认：提交数/接纳率均含 测试甲、测试乙（有提交的用户）
            assert {"测试甲", "测试乙"} <= set(labels("每人各阶段")), f"提交数默认应含 DOM_A 用户: {labels('每人各阶段')}"
            assert {"测试甲", "测试乙"} <= set(labels("接纳率")), f"接纳率默认应含 DOM_A 用户: {labels('接纳率')}"
            # 改「提交数」筛选器=DOM_B → 提交数收敛(测试乙消失)、接纳率不变(测试乙仍在)
            subSel.select_option(self.DOM_B); page.wait_for_timeout(700)
            assert "测试乙" not in set(labels("每人各阶段")), f"提交数筛选 DOM_B 后应无测试乙: {labels('每人各阶段')}"
            assert "测试乙" in set(labels("接纳率")), f"接纳率不应受提交数筛选影响: {labels('接纳率')}"
            # 改「接纳率」筛选器=DOM_A → 接纳率恢复测试乙、提交数不变(仍无测试乙)
            accSel.select_option(self.DOM_A); page.wait_for_timeout(700)
            assert "测试乙" in set(labels("接纳率")), f"接纳率筛选 DOM_A 后应含测试乙: {labels('接纳率')}"
            assert "测试乙" not in set(labels("每人各阶段")), f"提交数不应受接纳率筛选影响: {labels('每人各阶段')}"
        finally:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_stage_data WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (prefix + "%",))
                cur.execute("DELETE FROM qi_stage WHERE request_id IN (SELECT id FROM qi_request WHERE qi_no LIKE %s)", (prefix + "%",))
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                conn.commit()

    def test_bar_hover_shows_tooltip(self, page, backend_server, assert_no_js_errors):
        """Q4：柱状图(ECharts) tooltip 覆盖——真实 hover 柱体后 tooltip DOM 渲染且含坐标轴标签与数值
        （SVG title 时代的等价护栏；dispatchAction showTip 兜底消除鼠标坐标竞态）。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过 tooltip 测试")
        try:
            self._seed_qi_rows(dsn)
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            # 近1周窗口：排除 DENSE 历史数据，图表只含种子行（标签确定）
            page.locator('[data-qi-analytics-preset="1w"]').click()
            page.wait_for_timeout(2500)
            # 统一锚定「领域」柱图：hover/showTip/断言读的是同一个 host
            # （面板首个 host 是「阶段」饼图——饼心是 tooltip 死区，且跨图读取必空）
            host_sel = "#qi-analytics-echart-domain-bar"
            canvas = page.locator(f"{host_sel} canvas").first
            assert canvas.is_visible(), "ECharts 柱图 canvas 应可见"

            # tooltip DOM 判定：ECharts 悬停后在容器内创建 tooltip div（内容含类目标签/数值）
            def tooltip_text():
                return page.evaluate("""(sel) => {
                    const host = document.querySelector(sel);
                    if (!host) return '';
                    const tips = [...host.querySelectorAll('div')].filter(d => d.textContent && d.textContent.trim());
                    return tips.map(d => d.textContent.trim()).join('|');
                }""", host_sel)

            # 真实 hover：鼠标移到画布 1/4 宽处（首个柱体带中心；种子 2 个领域，中部是柱间隙）
            box = canvas.bounding_box()
            assert box, "柱图 canvas 应有 bounding box"
            page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.5)
            page.wait_for_timeout(600)
            text = tooltip_text()
            if not text:
                # 兜底：经 ECharts action 精确指向首个数据点（消除鼠标像素落点竞态）
                page.evaluate("""(sel) => {
                    const el = document.querySelector(sel);
                    const inst = window.echarts && window.echarts.getInstanceByDom(el);
                    if (inst) inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 });
                }""", host_sel)
                page.wait_for_timeout(600)
                text = tooltip_text()
            assert text, "悬停柱图后应渲染 tooltip 内容（hover 或 showTip 兜底）"
            assert any(t.isdigit() for t in text.split("|")), f"tooltip 应含数值，实际: {text[:200]}"
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
            sel = page.locator("[data-qi-analytics-domain-sub]")
            sel.select_option(self.DOM_A)
            page.wait_for_timeout(700)
            assert sel.input_value() == self.DOM_A, "应已选中领域 A"
            # 切换时间预设 → 领域筛选应重置为「全部领域」
            page.locator("[data-qi-analytics-preset]").first.click()
            # 直接等待「下拉重建且值为空」这一稳定条件，避免读到重渲染前的旧元素/加载态
            page.wait_for_function(
                "() => { const s = document.querySelector('[data-qi-analytics-domain-sub]'); return !!s && s.value === ''; }",
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
                       VALUES (%s,'特性加固','','空proposer测试','DOMFILT-N/A','测试描述',
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

    def test_module_filter_by_domain(self, page, backend_server, assert_no_js_errors):
        """模块&特性分布可按领域筛选：选中领域后模块饼图收敛到该领域的模块。"""
        import psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过模块领域筛选测试")
        prefix = "DOMFILTMOD-"
        rows = [
            (prefix + "A1", self.DOM_A, "模块A1"),
            (prefix + "A2", self.DOM_A, "模块A2"),
            (prefix + "B1", self.DOM_B, "模块B1"),
        ]
        try:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                for qi_no, domain, module in rows:
                    cur.execute(
                        """INSERT INTO qi_request
                           (qi_no, category, proposer, title, related_ticket_no, description,
                            expected_goal, priority, domain, module_feature, planned_version,
                            reviewer, current_stage, current_status, creator_id, creator_name, created_at)
                           VALUES (%s,'特性加固','测试甲 test_user01','模块筛选测试','x','d',
                                   '','中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',NOW())""",
                        (qi_no, domain, module),
                    )
                conn.commit()
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1000)
            # 近1周窗口：排除库中历史造数（标签断言从放大浮层读全量数据，不依赖页内 Top10）
            page.locator('[data-qi-analytics-preset="1w"]').click()
            page.wait_for_timeout(2000)
            pieSel = page.locator("[data-qi-analytics-module-domain-pie]")
            barSel = page.locator("[data-qi-analytics-module-domain-bar]")
            assert pieSel.count() == 1 and barSel.count() == 1, "饼图卡/柱图卡应各有一个独立筛选器"
            assert pieSel.input_value() == "" and barSel.input_value() == "", "默认均为全部领域"

            def labels(title):
                # 从放大浮层读全量标签（页内图 Top10 截断，种子计数=1 时可能被窗口内其它数据挤出）：
                # 按列标题精确匹配点击卡片图 → 轮询浮层实例就绪 → 读 series name（饼）/xAxis（柱）→ Esc 关闭
                import re as _re
                col = page.locator(".req-analytics-dist-col").filter(
                    has=page.locator("h3", has_text=_re.compile(rf"^{_re.escape(title)}$"))
                )
                col.locator(".stat-echart-host").first.click()
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
                got = page.evaluate("""() => {
                    const el = document.querySelector('.qi-chart-zoom-overlay .stat-echart-host');
                    const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
                    const opt = inst.getOption();
                    const s0 = opt.series && opt.series[0];
                    if (s0 && s0.type === 'pie') {
                        return ((s0.data || []).map(d => d && d.name).map(String));
                    }
                    return (((opt.xAxis && opt.xAxis[0]) || {}).data || []).map(String);
                }""")
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
                return got

            # 1) 默认（全部领域，粒度默认「最深」）：标签为 领域/模块 全路径（粒度从领域算起的口径）；
            #    选定领域后展示层才剥掉恒定领域前缀（下面 2/3 步的裸模块名）
            ALL_PF = {f"{self.DOM_A}/模块A1", f"{self.DOM_A}/模块A2", f"{self.DOM_B}/模块B1"}
            assert ALL_PF <= set(labels("模块&特性占比")), f"饼图默认应含全部 DOMFILTMOD 领域/模块: {labels('模块&特性占比')}"
            assert ALL_PF <= set(labels("模块&特性")), f"柱图默认应含全部 DOMFILTMOD 领域/模块: {labels('模块&特性')}"
            # 2) 改「饼图」筛选器=DOM_A → 饼图收敛到 DOM_A 模块、柱图不变（独立）
            pieSel.select_option(self.DOM_A); page.wait_for_timeout(700)
            pie2 = set(labels("模块&特性占比")); bar2 = set(labels("模块&特性"))
            assert {"模块A1", "模块A2"} <= pie2 and "模块B1" not in pie2, f"饼图应收敛到 DOM_A 模块: {pie2}"
            assert f"{self.DOM_B}/模块B1" in bar2, f"柱图不应受饼图筛选影响（B1 仍在，全部领域下带前缀）: {bar2}"
            # 3) 改「柱图」筛选器=DOM_B → 柱图收敛到 DOM_B 模块、饼图不变（独立）
            barSel.select_option(self.DOM_B); page.wait_for_timeout(700)
            pie3 = set(labels("模块&特性占比")); bar3 = set(labels("模块&特性"))
            assert {"模块B1"} <= bar3 and {"模块A1", "模块A2"}.isdisjoint(bar3), f"柱图应收敛到 DOM_B 模块: {bar3}"
            assert {"模块A1", "模块A2"} <= pie3 and "模块B1" not in pie3, f"饼图不应受柱图筛选影响: {pie3}"
        finally:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                conn.commit()

    def test_chart_click_zooms_to_overlay(self, page, backend_server, assert_no_js_errors):
        """点击图表应弹出全屏放大浮层（柱图/饼图），可关闭。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过图表放大测试")
        try:
            self._seed_qi_rows(dsn)
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            ov = page.locator(".qi-chart-zoom-overlay")
            assert ov.get_attribute("hidden") is not None, "放大浮层初始应隐藏"
            # 点 ECharts 柱图（领域柱图有放大浮层）→ 浮层打开
            page.locator('[data-qichart="domain-bar"] .stat-echart-host').first.click()
            page.wait_for_timeout(500)
            assert ov.get_attribute("hidden") is None, "点击柱状图应打开放大浮层"
            assert ov.locator(".qi-chart-zoom-title").inner_text(), "放大浮层应有标题"
            # 关闭按钮
            ov.locator(".qi-chart-zoom-close").click()
            page.wait_for_timeout(300)
            assert ov.get_attribute("hidden") is not None, "关闭后浮层应隐藏"
            # 点饼图（ECharts）→ 打开且内嵌 ECharts；Esc 关闭
            page.locator('[data-qichart="domain-pie"] .stat-echart-host').first.click()
            page.wait_for_timeout(400)
            assert ov.get_attribute("hidden") is None, "点击饼图应打开放大浮层"
            assert ov.locator("[data-echart-host]").count() > 0, "饼图放大应内嵌 ECharts"
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            assert ov.get_attribute("hidden") is not None, "Esc 应关闭浮层"
        finally:
            self._cleanup_qi_rows(dsn)

    def test_wheel_zooms_bar_chart_in_overlay(self, page, backend_server, assert_no_js_errors):
        """柱状图放大后支持滚轮缩放（ECharts dataZoom 内置，参考统计图表人力投入）。"""
        import datetime
        import psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过滚轮缩放测试")
        prefix = "WHEELZOOM-"
        try:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                for i in range(12):  # 12 领域 → Top10+其他=11 类目，minSpan 允许缩放
                    cur.execute(
                        """INSERT INTO qi_request
                           (qi_no,category,proposer,title,related_ticket_no,description,expected_goal,priority,
                            domain,module_feature,planned_version,reviewer,current_stage,current_status,
                            creator_id,creator_name,created_at)
                           VALUES (%s,'特性加固','测试甲 test_user01','滚轮缩放','N/A','d','',
                                   '中',%s,%s,'','test_admin','review','in_progress','test_admin','测试管理员',%s)""",
                        (f"{prefix}{i:03d}", f"领域{i:02d}", f"模块{i}", datetime.datetime(2026, 7, 31, 10, 0)),
                    )
                conn.commit()
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1000)
            page.locator('[data-qichart="domain-bar"] .stat-echart-host').first.click()
            page.wait_for_timeout(400)
            ov = page.locator(".qi-chart-zoom-overlay")
            assert ov.get_attribute("hidden") is None, "点击柱状图应打开放大浮层"
            # 浮层 ECharts 柱图应启用 dataZoom 滚轮缩放
            has_datazoom = page.evaluate(
                """() => {
                    const el = document.querySelector('.qi-chart-zoom-overlay [data-echart-host]');
                    const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
                    if (!inst) return false;
                    const opt = inst.getOption();
                    return Array.isArray(opt.dataZoom) && opt.dataZoom.length > 0;
                }"""
            )
            assert has_datazoom, "放大浮层柱图应启用 dataZoom 滚轮缩放"
        finally:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                conn.commit()

    def test_stage_filter_narrows_charts(self, page, backend_server, assert_no_js_errors):
        """阶段多选筛选：选阶段后领域/模块/用户维度按 current_stage 过滤（KPI 不受影响）。"""
        import psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过阶段筛选测试")
        prefix = "STAGEFILT-"
        rows = [
            (prefix + "R1", self.DOM_A, "测试甲 test_user01", "review"),
            (prefix + "R2", self.DOM_A, "测试乙 test_user02", "review"),
            (prefix + "A1", self.DOM_A, "测试甲 test_user01", "analysis"),
        ]
        try:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                for qi_no, domain, proposer, stage in rows:
                    cur.execute(
                        """INSERT INTO qi_request
                           (qi_no, category, proposer, title, related_ticket_no, description,
                            expected_goal, priority, domain, module_feature, planned_version,
                            reviewer, current_stage, current_status, creator_id, creator_name, created_at)
                           VALUES (%s,'特性加固',%s,'阶段筛选测试','x','d','','中',%s,'','',
                                   'test_admin',%s,'in_progress','test_admin','测试管理员',NOW())""",
                        (qi_no, proposer, domain, stage),
                    )
                conn.commit()
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(1000)
            # 近1周窗口：排除库中历史造数，领域图只含种子（注意预设点击会重置阶段筛选，须先点预设再选阶段）
            page.locator('[data-qi-analytics-preset="1w"]').click()
            page.wait_for_timeout(2000)

            def domain_value(domain):
                return page.evaluate("""(domain) => {
                  const el = document.getElementById('qi-analytics-echart-domain-bar');
                  const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
                  if (!inst) return null;
                  const opt = inst.getOption();
                  const labels = ((opt.xAxis && opt.xAxis[0]) || {}).data || [];
                  const vals = ((opt.series && opt.series[0]) || {}).data || [];
                  const idx = labels.findIndex(l => String(l) === domain);
                  if (idx < 0) return null;
                  const v = vals[idx];
                  return typeof v === 'object' ? (v.value || 0) : (v || 0);
                }""", domain)

            assert domain_value(self.DOM_A) is not None, "应能在领域柱图找到测试领域"
            # 全部阶段：DOM_A = 3（2 review + 1 analysis）
            assert domain_value(self.DOM_A) == 3, f"全部阶段 DOM_A 应为 3，实际: {domain_value(self.DOM_A)}"
            # 选 review：DOM_A = 2
            page.locator('[data-qi-analytics-stage="review"]').click(); page.wait_for_timeout(1500)
            assert domain_value(self.DOM_A) == 2, f"仅 review 时 DOM_A 应为 2，实际: {domain_value(self.DOM_A)}"
            # 改选 analysis（先取消 review）：DOM_A = 1
            page.locator('[data-qi-analytics-stage="review"]').click(); page.wait_for_timeout(1500)
            page.locator('[data-qi-analytics-stage="analysis"]').click(); page.wait_for_timeout(1500)
            assert domain_value(self.DOM_A) == 1, f"仅 analysis 时 DOM_A 应为 1，实际: {domain_value(self.DOM_A)}"
            # 取消 analysis：恢复 3
            page.locator('[data-qi-analytics-stage="analysis"]').click(); page.wait_for_timeout(1500)
            assert domain_value(self.DOM_A) == 3, f"取消阶段筛选应恢复 3，实际: {domain_value(self.DOM_A)}"
        finally:
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (prefix + "%",))
                conn.commit()


class TestQiListFieldFilters:
    """QI 列表按 领域/模块&特性/提出人 筛选（修复前这两个参数被后端忽略）。"""

    PREFIX = "LISTFILT-"
    DOM_X = "LFDOM-X"
    DOM_Y = "LFDOM-Y"
    MF_X = "LFMF-X"
    MF_Y = "LFMF-Y"

    def _seed(self, dsn):
        import psycopg
        rows = [
            ("LISTFILT-1", self.DOM_X, self.MF_X, "LF提出甲 lfp1"),
            ("LISTFILT-2", self.DOM_X, self.MF_Y, "LF提出乙 lfp2"),
            ("LISTFILT-3", self.DOM_Y, self.MF_X, "LF提出甲 lfp1"),
        ]
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (self.PREFIX + "%",))
            for qi_no, dom, mf, proposer in rows:
                cur.execute(
                    """INSERT INTO qi_request
                       (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                        priority, domain, module_feature, planned_version, reviewer,
                        current_stage, current_status, creator_id, creator_name, created_at)
                       VALUES (%s,'特性加固',%s,'列表筛选测试','x','d','','高',%s,%s,'','test_admin',
                               'review','in_progress','test_admin','测试管理员',NOW())""",
                    (qi_no, proposer, dom, mf),
                )
            conn.commit()

    def _cleanup(self, dsn):
        import psycopg
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (self.PREFIX + "%",))
            conn.commit()

    def _qi_nos(self, backend_server, **params):
        import httpx
        p = {"operator_id": "test_admin", "scope": "all", "page_size": 100}
        p.update(params)
        r = httpx.get(f"{backend_server}/api/qi", params=p)
        assert r.status_code == 200, f"列表接口失败: {r.status_code} {r.text[:200]}"
        return {it["qi_no"] for it in r.json().get("items", [])}

    def test_filter_options_endpoint(self, backend_server):
        """筛选下拉数据源 /api/qi/filter-options 应返回去重的领域/模块/提出人。"""
        import httpx
        r = httpx.get(f"{backend_server}/api/qi/filter-options", params={"operator_id": "test_admin"})
        assert r.status_code == 200, f"filter-options 应 200，实际 {r.status_code}"
        d = r.json()
        assert "domains" in d and "module_features" in d and "proposers" in d, f"应含三字段: {list(d)}"
        assert isinstance(d["domains"], list), "domains 应为数组"

    def test_list_filter_by_fields(self, backend_server):
        import os
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过列表筛选测试")
        try:
            self._seed(dsn)
            seeded = {"LISTFILT-1", "LISTFILT-2", "LISTFILT-3"}
            # 不过滤：三条都在
            assert seeded.issubset(self._qi_nos(backend_server)), "种子数据应出现在列表"
            # 领域 = DOM_X → 只剩 1、2
            assert self._qi_nos(backend_server, domain=self.DOM_X) & seeded == {"LISTFILT-1", "LISTFILT-2"}
            # 模块 = MF_X → 只剩 1、3
            assert self._qi_nos(backend_server, module_feature=self.MF_X) & seeded == {"LISTFILT-1", "LISTFILT-3"}
            # 提出人 = LF提出甲 lfp1 → 只剩 1、3
            assert self._qi_nos(backend_server, proposer="LF提出甲 lfp1") & seeded == {"LISTFILT-1", "LISTFILT-3"}
        finally:
            self._cleanup(dsn)


class TestQiCategoryValidation:
    """分类校验应使用完整 QI_CATEGORIES（含 资料/升级 及新增 易用性提升/产品规格），不再误报无效分类。"""

    def _real_ticket_no(self):
        import psycopg
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            return None
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT ticket_no FROM ticket WHERE ticket_no <> '' LIMIT 1")
            row = cur.fetchone()
            return row[0] if row else None

    def _create(self, backend_server, category, tno):
        # 用「不存在的评审人」让流程在分类校验之后失败，避免实际建单污染数据
        import httpx
        return httpx.post(f"{backend_server}/api/qi", json={
            "operator_id": "test_admin", "category": category, "title": "分类校验测试",
            "related_ticket_no": tno, "description": "d", "reviewer": "nonexistent_qi_test_user",
            "priority": "中", "domain": "测试领域", "module_feature": "测试模块",
        })

    def test_category_ziliao_passes_validation(self, backend_server):
        """分类=资料 应通过分类校验（走到后续校验），而非被判「无效分类」。"""
        tno = self._real_ticket_no()
        if not tno:
            pytest.skip("无真实工单号，跳过分类校验测试")
        r = self._create(backend_server, "资料", tno)
        assert r.json().get("detail") != "无效分类", "分类=资料 不应被判无效分类"

    def test_category_upgrade_passes_validation(self, backend_server):
        """分类=升级（原 升级checklist 改名）应通过分类校验。"""
        tno = self._real_ticket_no()
        if not tno:
            pytest.skip("无真实工单号，跳过分类校验测试")
        r = self._create(backend_server, "升级", tno)
        assert r.json().get("detail") != "无效分类", "分类=升级 不应被判无效分类"

    @pytest.mark.parametrize("category", ["易用性提升", "产品规格"])
    def test_category_new_enum_passes_validation(self, backend_server, category):
        """新增分类（易用性提升/产品规格）应通过分类校验。"""
        tno = self._real_ticket_no()
        if not tno:
            pytest.skip("无真实工单号，跳过分类校验测试")
        r = self._create(backend_server, category, tno)
        assert r.json().get("detail") != "无效分类", f"分类={category} 不应被判无效分类"

    @pytest.mark.parametrize("category", ["质量加固和改进", "升级checklist", "测试加固", "需求"])
    def test_retired_category_rejected(self, backend_server, category):
        """退役旧分类（0129 迁移前枚举）应被判「无效分类」。"""
        tno = self._real_ticket_no()
        if not tno:
            pytest.skip("无真实工单号，跳过分类校验测试")
        r = self._create(backend_server, category, tno)
        assert r.status_code == 400
        assert r.json().get("detail") == "无效分类", f"退役分类={category} 应被判无效分类"

    def test_invalid_category_rejected(self, backend_server):
        """非法分类仍应被拒为「无效分类」（校验仍生效）。"""
        tno = self._real_ticket_no()
        if not tno:
            pytest.skip("无真实工单号，跳过分类校验测试")
        r = self._create(backend_server, "根本不存在的分类", tno)
        assert r.status_code == 400
        assert r.json().get("detail") == "无效分类", "非法分类应被判无效分类"


class TestQiListDescriptionRendering:
    """列表描述列：HTML 标签去除 + 实体解码（&nbsp; 等）。"""

    PREFIX = "DESCRNDR-"

    def _seed(self, dsn):
        import psycopg
        html_desc = "<p>实体测试</p><div>&nbsp;空格&nbsp;</div><div>带<b>加粗</b></div>"
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (self.PREFIX + "%",))
            cur.execute(
                """INSERT INTO qi_request
                   (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                    priority, domain, module_feature, planned_version, reviewer,
                    current_stage, current_status, creator_id, creator_name, created_at)
                   VALUES (%s,'特性加固','测试 test','描述渲染测试','x',%s,'',
                           '高','','','','test','review','in_progress','test','测试',NOW())""",
                (self.PREFIX + "1", html_desc),
            )
            conn.commit()

    def _cleanup(self, dsn):
        import psycopg
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (self.PREFIX + "%",))
            conn.commit()

    def test_description_decodes_html_entities(self, page, backend_server, assert_no_js_errors):
        """列表描述列应解码 HTML 实体，不出现 nbsp 等原始实体文本。"""
        import os
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL")
        try:
            self._seed(dsn)
            page.goto(f"{backend_server}/")
            page.wait_for_selector("#root")
            page.evaluate("window.localStorage.setItem('demo_operator_account','test_admin');window.localStorage.setItem('demo_operator_name','测试管理员');")
            page.goto(f"{backend_server}/qi")
            page.wait_for_selector("#qi-panel .req-table--full tbody tr", timeout=15000)
            page.wait_for_timeout(1000)
            # 找到测试行的描述单元格，确认不含 nbsp
            row_text = page.evaluate("""() => {
              const rows = [...document.querySelectorAll('#qi-panel .req-table--full tbody tr')];
              const row = rows.find(r => r.textContent.includes('DESCRNDR-1'));
              return row ? row.textContent : 'NOT FOUND';
            }""")
            assert "DESCRNDR-1" in row_text, "测试行应出现在列表"
            assert "nbsp" not in row_text, f"描述列不应出现原始 &nbsp; 实体: {row_text[:200]}"
        finally:
            self._cleanup(dsn)


class TestQiNewDescriptionTemplate:
    """新建 QI 时详细描述应预填模板【问题背景】【改进建议】。"""

    def test_new_qi_has_description_template(self, page, backend_server, assert_no_js_errors):
        """QI 列表 → 新建 → 详细描述应含模板。"""
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root")
        page.evaluate("window.localStorage.setItem('demo_operator_account','test_admin');window.localStorage.setItem('demo_operator_name','测试管理员');")
        page.goto(f"{backend_server}/qi/new")
        page.wait_for_selector("#qi-new-description", timeout=15000)
        page.wait_for_timeout(500)
        text = page.locator("#qi-new-description").inner_text()
        assert "问题背景" in text, f"详细描述应预填【问题背景】模板，实际: {text!r}"
        assert "改进建议" in text, f"详细描述应预填【改进建议】模板，实际: {text!r}"


class TestQiAcceptVersionConfigSection:
    """质量改进配置：解决版本选项维护节 + 阶段超期五行。"""

    def _goto_config(self, page, backend_server):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root")
        page.evaluate("window.localStorage.setItem('demo_operator_account','test_admin');window.localStorage.setItem('demo_operator_name','测试管理员');")
        page.goto(f"{backend_server}{QI_CONFIG_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2500)

    def test_accept_version_section_renders_seeds(self, page, backend_server, assert_no_js_errors):
        """解决版本节渲染迁移 0122 种子（507.0/507.1/508.0）。"""
        import httpx
        # 保证配置为种子值（其它用例可能改过）
        httpx.post(f"{backend_server}/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]}, timeout=15)
        self._goto_config(page, backend_server)
        page.wait_for_function(
            "() => document.querySelectorAll('#qi-accept-version-list [data-accept-version-idx]').length >= 3",
            timeout=15000,
        )
        vals = page.eval_on_selector_all(
            "#qi-accept-version-list [data-accept-version-idx]",
            "els => els.map(e => e.value)",
        )
        assert vals[:3] == ["507.0", "507.1", "508.0"], f"种子版本应按序渲染，实际: {vals}"
        assert page.locator("#qi-accept-version-add-btn").count() >= 1
        assert page.locator("#qi-accept-version-save-btn").count() >= 1

    def test_accept_version_add_delete_save(self, page, backend_server, assert_no_js_errors):
        """添加一行→保存（POST 全量）→刷新后仍在；删除→保存→消失。"""
        import httpx
        httpx.post(f"{backend_server}/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]}, timeout=15)
        try:
            self._goto_config(page, backend_server)
            page.wait_for_function(
                "() => document.querySelectorAll('#qi-accept-version-list [data-accept-version-idx]').length >= 3",
                timeout=15000,
            )
            # 添加一行并填值
            page.locator("#qi-accept-version-add-btn").first.click(timeout=5000)
            inputs = page.locator("#qi-accept-version-list [data-accept-version-idx]")
            page.wait_for_timeout(300)
            inputs.nth(3).fill("509.0")
            page.locator("#qi-accept-version-save-btn").first.click(timeout=5000)
            page.wait_for_timeout(1200)
            # API 侧应已保存
            j = httpx.get(f"{backend_server}/api/qi/config/accept-versions", timeout=15).json()
            assert [v["version"] for v in j["versions"]] == ["507.0", "507.1", "508.0", "509.0"], \
                f"保存后应为 4 项，实际: {j['versions']}"
            # 删除第 4 行 → 保存 → 恢复 3 项
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_function(
                "() => document.querySelectorAll('#qi-accept-version-list [data-accept-version-idx]').length >= 4",
                timeout=15000,
            )
            page.locator("[data-del-accept-version='3']").first.click(timeout=5000)
            page.wait_for_timeout(300)
            page.locator("#qi-accept-version-save-btn").first.click(timeout=5000)
            page.wait_for_timeout(1200)
            j = httpx.get(f"{backend_server}/api/qi/config/accept-versions", timeout=15).json()
            assert [v["version"] for v in j["versions"]] == ["507.0", "507.1", "508.0"], \
                f"删除保存后应恢复 3 项，实际: {j['versions']}"
        finally:
            httpx.post(f"{backend_server}/api/qi/config/accept-versions", json={"versions": ["507.0", "507.1", "508.0"]}, timeout=15)

    def test_stage_sla_five_rows(self, page, backend_server, assert_no_js_errors):
        """阶段超期节：五行（提出/评审/确认/实施/验收）+ 新口径 hint 文案。"""
        self._goto_config(page, backend_server)
        page.wait_for_function(
            "() => document.querySelectorAll('[data-stage-sla]').length >= 5",
            timeout=15000,
        )
        keys = page.eval_on_selector_all("[data-stage-sla]", "els => els.map(e => e.getAttribute('data-stage-sla'))")
        assert set(keys) >= {"propose", "review", "analysis", "closure", "acceptance"}, \
            f"阶段超期应五行可配，实际: {keys}"
        body = page.locator("body").inner_text()
        assert "阶段开始时间" in body and "已退役" in body, "hint 应说明新超期口径与 sla_time 退役"
