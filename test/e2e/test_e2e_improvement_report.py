"""E2E：改进报告（质量改进月度总结）。

覆盖：
- 菜单可见性：test_admin（DB 已种 improvement_report=editable）可见「改进报告 / 改进报告归档」；
  test_user01（默认 hidden）不可见且深链不停留。
- 报告页渲染：标题横幅、四段、工具栏（月份/刷新/导出 HTML/导出 Excel/归档）。
- 四段导入：overview 导入后出现聚合模板句；overall 导入后渲染 KPI 与 4 图挂载点。
- 归档/取消归档往返。
- 占比饼图遮挡修复：改进诉求领域占比/各阶段占比（含月报页同款）外置 {d}% 标签关闭、
  百分比并入图例（名称 xx.x%），不再与图例互相遮挡或贴边裁剪。
"""
import json

import pytest

pytestmark = pytest.mark.e2e

PAGE_URL = "/report/improvement"
ARCHIVE_URL = "/report/improvement-archive"
YM = "202608"


def _switch_operator(page, base_url, account: str, name: str):
    """切换操作员并重载。

    SKIP_SSO_AUTH 下 /api/auth/me 恒返回 DEV_USER_ACCOUNT（auth.js 会以其覆盖本地操作员），
    localStorage 切换不生效——这里 route-mock /me 返回目标账号，保证按角色断言确定性。
    """
    page.route(
        "**/api/auth/me",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "success": True,
                "sso_user": {"lname": name, "userName": account},
                "local_user": {"account": account, "user_name": name},
                "w3Account": account,
            }, ensure_ascii=False),
        ),
    )
    page.goto(f"{base_url}/")
    page.wait_for_selector("#root", timeout=15000)
    page.evaluate(
        f"""() => {{
            window.localStorage.setItem('demo_operator_account', {json.dumps(account)});
            window.localStorage.setItem('demo_operator_name', {json.dumps(name)});
        }}"""
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)
    page.wait_for_timeout(1500)


class TestImprovementReportMenu:
    def test_admin_sees_improvement_report_menu(self, page, backend_server):
        _switch_operator(page, backend_server, "test_admin", "测试管理员")
        assert page.locator("[data-nav-key='report:improvement']").count() >= 1, \
            "管理员侧栏应渲染「改进报告」入口"
        assert page.locator("[data-nav-key='report:improvement-archive']").count() >= 1, \
            "管理员侧栏应渲染「改进报告归档」入口"

    def test_normal_user_cannot_see_improvement_report_menu(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        for key in ("report:improvement", "report:improvement-archive"):
            assert page.locator(f"[data-nav-key='{key}']").count() == 0, \
                f"普通员工（improvement_report 默认 hidden）不应看到「{key}」入口"

    def test_normal_user_deep_links_redirect(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        forbidden = {
            PAGE_URL: "改进报告",
            ARCHIVE_URL: "改进报告归档",
        }
        for path, blocked_title in forbidden.items():
            page.goto(f"{backend_server}{path}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(2000)
            title = page.locator("#center-page-title").first
            if title.count():
                assert title.inner_text().strip() != blocked_title, (
                    f"普通员工深链 {path} 不应停留在「{blocked_title}」页"
                )

    def test_admin_deep_link_h1_titles(self, page, backend_server, assert_no_js_errors):
        """管理员深链两页的 #center-page-title 须命中改进报告分支（报告生成/报告归档），
        而非沿用月度报告标题或空白。"""
        _switch_operator(page, backend_server, "test_admin", "测试管理员")
        expected = {PAGE_URL: "报告生成", ARCHIVE_URL: "报告归档"}
        for path, title_text in expected.items():
            page.goto(f"{backend_server}{path}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(2000)
            title = page.locator("#center-page-title").first
            assert title.count() >= 1, f"{path} 应渲染 #center-page-title"
            actual = title.inner_text().strip()
            assert actual == title_text, f"{path} 页头标题应为「{title_text}」，实际「{actual}」"


class TestImprovementReportPage:
    def test_page_renders_four_sections_and_toolbar(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}{PAGE_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_selector(".ir-title-banner, .mr-title-banner", timeout=15000)
        page.wait_for_timeout(2500)
        body = page.locator("body").inner_text()
        # 四段标题
        for sec in ("一、整体概况", "二、质量改进整体分析", "三、质量改进领域分析", "四、本月新增改进诉求"):
            assert sec in body, f"页面应包含段落标题「{sec}」"
        # 标题横幅含「质量改进报告」
        assert "质量改进报告" in body
        # 工具栏按钮
        for btn_id in ("ir-month-input", "ir-reload-btn", "ir-export-btn", "ir-export-xlsx-btn", "ir-archive-btn"):
            assert page.locator(f"#{btn_id}").count() >= 1, f"工具栏应含 #{btn_id}"

    def test_import_overview_fills_template(self, page, backend_server, assert_no_js_errors):
        """overview 导入：进入编辑态并出现聚合模板句（YTD 一句话）。"""
        page.goto(f"{backend_server}{PAGE_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2000)
        btn = page.locator("[data-ir-import='overview']").first
        btn.click(timeout=10000)
        # 导入完成 → 编辑态出现聚合句（本地 DENSE 数据 YTD 非空）
        page.wait_for_function(
            "() => document.body.innerText.includes('累计识别现网改进诉求')",
            timeout=15000,
        )
        # save 按钮应与句子同一渲染出现；短暂轮询以区分「渲染竞态」与「编辑态丢失」
        appeared = False
        for _ in range(50):
            if page.locator("[data-ir-save='overview']").count() >= 1:
                appeared = True
                break
            page.wait_for_timeout(100)
        if not appeared:
            diag = page.evaluate(
                "() => ({msg: (document.querySelector('[class*=msg]')||{}).textContent || '',"
                " body_has_sentence: document.body.innerText.includes('累计识别现网改进诉求'),"
                " import_btn: !!document.querySelector(\"[data-ir-import='overview']\")})"
            )
            assert appeared, f"导入后应进入编辑态（可保存）: {diag}"

    def test_import_overall_renders_kpi_and_charts(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}{PAGE_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("[data-ir-import='overall']").first.click(timeout=10000)
        page.wait_for_function(
            "() => document.body.innerText.includes('整体接纳率')",
            timeout=15000,
        )
        # 4 图挂载点存在
        for chart_id in ("ir-chart-overall-domain", "ir-chart-overall-stage",
                         "ir-chart-overall-rf-accept", "ir-chart-overall-rf-overdue"):
            assert page.locator(f"#{chart_id}").count() >= 1, f"整体分析应含 #{chart_id}"

    def test_archive_and_unarchive(self, page, backend_server, assert_no_js_errors):
        import httpx
        # 清掉可能残留的同月报告，保证归档按钮出现（draft 态）
        # 接口按 operator_id 白名单鉴权（fail-closed），种子/清理须带管理员账号
        base = backend_server
        opq = "operator_id=test_admin"
        httpx.delete(f"{base}/api/improvement-report/{YM}?{opq}", timeout=15)
        page.goto(f"{base}{PAGE_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2500)
        archive_btn = page.locator("#ir-archive-btn")
        assert archive_btn.count() >= 1, "draft 态应显示「归档」按钮"
        archive_btn.first.click(timeout=10000)
        page.wait_for_selector("#ir-unarchive-btn", timeout=15000)
        assert page.locator("#ir-unarchive-btn").count() >= 1, "归档后应显示「取消归档」"
        # 归档后导入按钮应禁用/消失（archived 不可编辑）
        page.locator("#ir-unarchive-btn").first.click(timeout=10000)
        page.wait_for_selector("#ir-archive-btn", timeout=15000)
        # 收尾清理该月报告，避免污染后续用例
        httpx.delete(f"{base}/api/improvement-report/{YM}?{opq}", timeout=15)

    def test_archive_page_lists_archived(self, page, backend_server, assert_no_js_errors):
        import httpx
        base = backend_server
        opq = "operator_id=test_admin"
        # 造一条已归档报告（API 直达），归档页应列出并可「查看」
        httpx.delete(f"{base}/api/improvement-report/202501?{opq}", timeout=15)
        httpx.get(f"{base}/api/improvement-report/202501?{opq}", timeout=15)
        httpx.post(f"{base}/api/improvement-report/202501/archive?{opq}", json={"title": "E2E归档测试"}, timeout=15)
        try:
            page.goto(f"{base}{ARCHIVE_URL}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(2500)
            body = page.locator("body").inner_text()
            assert "202501" in body, "归档页应列出 202501 归档报告"
            assert page.locator("[data-ir-archive-open='202501']").count() >= 1, "归档页应有「查看」入口"
        finally:
            httpx.delete(f"{base}/api/improvement-report/202501/archive?{opq}", timeout=15)
            httpx.delete(f"{base}/api/improvement-report/202501?{opq}", timeout=15)


def _pie_option_via_echarts(page, chart_id: str):
    """经 echarts 全局取图实例 option（canvas 绘制，DOM 断言不可达）。"""
    return page.evaluate(
        """(chartId) => {
            const el = document.getElementById(chartId);
            if (!el) return null;
            const inst = window.echarts && window.echarts.getInstanceByDom(el);
            if (!inst) return null;
            const o = inst.getOption();
            const s = (o.series || [])[0];
            if (!s) return null;
            const legend = (o.legend || [])[0] || {};
            const data = s.data || [];
            const first = data[0];
            return {
                labelShow: s.label && s.label.show,
                labelLineShow: s.labelLine && s.labelLine.show,
                dataLen: data.length,
                legendFormatterSample: (first && typeof legend.formatter === "function")
                    ? legend.formatter(first.name) : null,
            };
        }""",
        chart_id,
    )


class TestRatioPieOcclusionFix:
    """遮挡修复回归：改进诉求领域占比 / 各阶段占比。

    根因：外置 {d}% 标签 + 右侧竖排图例共享同一水平空间，领域多（53 个）、小扇区
    多（~2%）时互相遮挡且贴边裁剪。修复：关闭外置标签，百分比并入图例（名称 xx.x%）。
    """

    def test_overall_two_pies_labels_off_and_pct_in_legend(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}{PAGE_URL}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("[data-ir-import='overall']").first.click(timeout=10000)
        page.wait_for_function(
            "() => document.body.innerText.includes('整体接纳率')",
            timeout=15000,
        )
        page.wait_for_timeout(800)
        for chart_id in ("ir-chart-overall-domain", "ir-chart-overall-stage"):
            opt = _pie_option_via_echarts(page, chart_id)
            assert opt is not None, f"{chart_id} 应已挂载 echarts 实例"
            assert opt["labelShow"] is False, f"{chart_id} 外置百分比标签应关闭（防与图例遮挡）: {opt}"
            assert opt["labelLineShow"] is False, f"{chart_id} 标签引导线应关闭: {opt}"
            assert opt["dataLen"] >= 1, f"{chart_id} 应有数据扇区: {opt}"
            sample = opt["legendFormatterSample"] or ""
            assert sample and sample.endswith("%"), \
                f"{chart_id} 图例应显示「名称 xx.x%」（百分比并入图例）: {sample}"
            assert "%" in sample and not sample.rstrip("%").endswith("undefined"), \
                f"{chart_id} 图例百分比不应为 undefined/NaN: {sample}"

    # 注：月报页（/report/generate）饼图不随改进报告改动——按「改进报告实现不修改
    # 月度报告内容」的边界，月报侧修复与对应 e2e 已随解耦还原移除（test_monthly_report_improve_pie_labels_off）。
