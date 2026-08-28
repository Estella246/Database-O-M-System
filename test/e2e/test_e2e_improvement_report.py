"""E2E：改进报告（质量改进月度总结）。

覆盖：
- 菜单可见性：test_admin（DB 已种 improvement_report=editable）可见「改进报告 / 改进报告归档」；
  test_user01（默认 hidden）不可见且深链不停留。
- 报告页渲染：标题横幅、四段、工具栏（月份/刷新/导出 HTML/导出 Excel/归档）。
- 四段导入：overview 导入后出现聚合模板句；overall 导入后渲染 KPI 与 4 图挂载点。
- 归档/取消归档往返。
- 占比饼图遮挡修复：改进诉求领域占比/各阶段占比（含月报页同款）外置 {d}% 标签关闭、
  百分比并入图例（名称 xx.x%），不再与图例互相遮挡或贴边裁剪。
- 图例列/饼体像素级间隙（pie_legend_gap）：本页图卡 2×2 宽卡（.ir-page 作用域，
  月报页保持 4 列），4 列窄卡（1280 视口 ~229px）下图例 marker 会压到饼环。
- Excel 导出：图表不嵌入（xlsx-js-style 无嵌图能力，带图走 HTML 导出），但二段
  四图源数据以「名称/数值」子表补齐（体例与三段一致），下载文件 openpyxl 实读校验。
"""
import json

import openpyxl
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
            const pct = (v) => (typeof v === "string" && v.endsWith("%")
                ? parseFloat(v.slice(0, -1)) : v);
            return {
                labelShow: s.label && s.label.show,
                labelLineShow: s.labelLine && s.labelLine.show,
                dataLen: data.length,
                center0Num: pct((s.center || [])[0]),
                radiusOuterNum: pct((s.radius || [])[1]),
                legendFormatterSample: (first && typeof legend.formatter === "function")
                    ? legend.formatter(first.name) : null,
            };
        }""",
        chart_id,
    )


def pie_legend_gap(page, chart_id: str):
    """图例列左缘与饼体右缘的像素间隙（负=重叠；None=图未挂载）。

    echarts 5.6.0 实测几何（像素扫描校准）：图例内容左缘 = 宿主宽 − right − padding
    − itemWidth − 图标-文字间距 5（echarts 内置，option 不暴露）− 最长图例文本宽；
    right/padding/itemWidth/字号均从 legend option 读取，与 buildPieOption 配置同源，
    调整字号/边距时本断言自动跟随。饼体右缘 = center[0]%×宽 + radius[1]%×min(宽,高)/2。
    """
    return page.evaluate(
        """(chartId) => {
            const el = document.getElementById(chartId);
            if (!el) return null;
            const inst = window.echarts && window.echarts.getInstanceByDom(el);
            const o = inst && inst.getOption();
            const s = o && o.series && o.series[0];
            if (!s) return null;
            const w = el.clientWidth, h = el.clientHeight;
            const min = h < w ? h : w;
            const pieRight = (parseFloat(s.center[0]) / 100) * w
                + (parseFloat(s.radius[1]) / 100) * (min / 2);
            const leg = (o.legend || [])[0] || {};
            const padRaw = leg.padding == null ? 5 : leg.padding;
            const pad = Array.isArray(padRaw) ? (padRaw[1] == null ? 5 : padRaw[1]) : padRaw;
            const fontSize = (leg.textStyle || {}).fontSize || 11;
            const ctx = el.getElementsByTagName('canvas')[0].getContext('2d');
            ctx.font = `${fontSize}px sans-serif`;
            const fmt = typeof leg.formatter === 'function' ? leg.formatter : (n) => n;
            let maxText = 0;
            (s.data || []).forEach((d) => {
                const tw = ctx.measureText(fmt(d.name)).width;
                if (tw > maxText) maxText = tw;
            });
            const legendLeft = w - Number(leg.right || 0) - pad
                - Number(leg.itemWidth || 25) - 5 - maxText;
            return Math.round(legendLeft - pieRight);
        }""",
        chart_id,
    )


def pie_pairs(page, chart_id):
    """echarts 饼图 series[0] 名称→数值（套件共用读取器：图面/导出同源对照取数）。"""
    return page.evaluate(
        """(c) => {
            const el = document.getElementById(c);
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            const s = inst && inst.getOption().series[0];
            if (!s) return null;
            const m = {};
            (s.data || []).forEach(d => { m[String(d && d.name)] = Number(d && d.value); });
            return m;
        }""", chart_id)


def bar_pairs(page, chart_id):
    """echarts 柱图 x 轴标签→数值（与 pie_pairs 同为导出/图面同源对照的真值读取器）。"""
    return page.evaluate(
        """(c) => {
            const el = document.getElementById(c);
            const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
            const o = inst && inst.getOption();
            if (!o) return null;
            const labels = ((o.xAxis || [])[0] || {}).data || [];
            const vals = ((o.series || [])[0] || {}).data || [];
            const m = {};
            labels.forEach((l, i) => { m[String(l)] = Number(vals[i]); });
            return m;
        }""", chart_id)


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
        # 像素级间隙：整体双饼同样不得重叠——4 列窄卡（1280 视口 ~229px）下
        # 图例 marker 曾实测压饼环 ~8px，本页图卡已改 2×2 宽卡（.ir-page 作用域）
        for chart_id in ("ir-chart-overall-domain", "ir-chart-overall-stage"):
            gap = pie_legend_gap(page, chart_id)
            assert gap is not None, f"{chart_id} 应已挂载 echarts 实例（间隙测算需实例）"
            assert gap >= 8, (
                f"{chart_id} 图例列与饼体重叠/贴边（间距 {gap}px < 8px）——"
                "本页图卡应为 2×2 宽卡（.ir-page），图例列不得压到饼体"
            )

    def test_domain_four_charts_level1_level2(self, page, backend_server, assert_no_js_errors):
        """第三段=模块&特性 一级/二级 柱图+饼图（4 图，从领域算起）：
        一级扇区=领域（无斜杠）、二级扇区=领域/模块首段（空模块=领域/未分类，与统计页一致）；
        两级总量与逐领域分组一致；柱图与饼图同源；
        饼体几何沿用「center 25% / radius 50% + 图例含百分比」防遮挡口径；
        旧的按二级模块逐模块 5 图结构不再存在。"""
        page.goto(f"{backend_server}{PAGE_URL}")
        page.wait_for_selector(".ir-title-banner, .mr-title-banner", timeout=15000)
        page.wait_for_timeout(2000)
        page.locator("[data-ir-import='domain']").first.click(timeout=10000)
        # 等「导入完成」信号（成功→进入编辑态出现保存按钮；失败→报错文案），再判空态：
        # 空态提示在导入前的初始渲染就存在，不能作为完成信号（本套件依赖本地 DENSE 演示数据）
        page.wait_for_function(
            """() => document.querySelector(".mr-section--domain [data-ir-save='domain']")
                || (document.body.innerText || '').includes('导入失败')""",
            timeout=15000,
        )
        assert "导入失败" not in page.locator("body").inner_text(), "第三段导入请求不应失败"
        assert page.locator(".mr-section--domain .mr-empty-hint").count() == 0, \
            "第三段导入后不应为空态：本地库当前 YTD 窗口需有非草稿数据（DENSE 演示数据是否就位？）"
        page.wait_for_function(
            """() => {
                const el = document.getElementById('ir-chart-domain-l1-pie');
                return !!(el && window.echarts && window.echarts.getInstanceByDom(el));
            }""",
            timeout=15000,
        )
        assert page.locator(".ir-module-block").count() == 0, "旧的逐模块块结构应已移除"
        for cid in ("ir-chart-domain-l1-bar", "ir-chart-domain-l1-pie",
                    "ir-chart-domain-l2-bar", "ir-chart-domain-l2-pie"):
            mounted = page.evaluate(
                """(c) => {
                    const el = document.getElementById(c);
                    return !!(el && window.echarts && window.echarts.getInstanceByDom(el));
                }""", cid)
            assert mounted, f"{cid} 应已挂载 echarts 实例"

        l1 = pie_pairs(page, "ir-chart-domain-l1-pie")
        l2 = pie_pairs(page, "ir-chart-domain-l2-pie")
        assert l1, "一级饼应有数据扇区"
        assert all("/" not in k for k in l1), f"一级扇区应为领域本身（无斜杠）: {l1}"
        assert any("/" in k for k in l2), f"二级扇区应为 领域/模块首段: {l2}"
        # 两级总量一致（同一次分布的两级切片）
        assert sum(l1.values()) == sum(l2.values()) > 0, (l1, l2)
        # 二级按领域分组的和 === 一级该领域值（聚合口径一致）
        for dom, v in l1.items():
            grouped = sum(x for k, x in l2.items() if k == dom or k.startswith(dom + "/"))
            assert grouped == v, f"二级分组和应等于一级 {dom}: {grouped} != {v} ({l1}, {l2})"
        # 柱图与饼图同源（消费同一序列）
        assert bar_pairs(page, "ir-chart-domain-l1-bar") == l1
        assert bar_pairs(page, "ir-chart-domain-l2-bar") == l2
        # 饼体几何防遮挡（沿用模块饼图修复口径：center 25% / radius 50% + 图例百分比）
        # + 像素级图例/饼体间隙：领域分析为 2×2 宽卡，二级「领域/模块 xx.x%」长图例
        # 在 4 列窄卡（~229px）下左缘会压到饼体右缘（曾实测重叠 ~8-32px）
        for cid in ("ir-chart-domain-l1-pie", "ir-chart-domain-l2-pie"):
            opt = _pie_option_via_echarts(page, cid)
            assert opt is not None and opt["dataLen"] >= 1, f"{cid} 应有数据扇区: {opt}"
            assert opt["center0Num"] <= 30, f"{cid} 饼体圆心横坐标应 ≤30%: {opt}"
            assert opt["radiusOuterNum"] <= 52, f"{cid} 外半径应 ≤52%（防与图例重合）: {opt}"
            sample = opt["legendFormatterSample"] or ""
            assert sample and sample.endswith("%"), f"{cid} 图例应含百分比: {sample}"
            gap = pie_legend_gap(page, cid)
            assert gap is not None, f"{cid} 应已挂载 echarts 实例（间隙测算需实例）"
            assert gap >= 8, (
                f"{cid} 图例列与饼体重叠/贴边（间距 {gap}px < 8px）——"
                "领域分析应为 2×2 宽卡，二级「领域/模块 xx.x%」长图例不得压到饼体"
            )

    # 注：月报页（/report/generate）饼图不随改进报告改动——按「改进报告实现不修改
    # 月度报告内容」的边界，月报侧修复与对应 e2e 已随解耦还原移除（test_monthly_report_improve_pie_labels_off）。


class TestXlsxExportChartSeries:
    """Excel 导出图表数据完整性：图不嵌入（库能力边界，带图走 HTML 导出），
    但二段四图（领域占比/各阶段占比/责任田接纳率/责任田超期率）源数据须以
    「名称/数值」子表落进 xlsx（体例与三段一级/二级子表一致），不再只有 KPI 行。
    下载文件用 openpyxl 实读断言，防「只断按钮存在」的空转覆盖。"""

    SUB_TITLES = ("改进诉求领域占比", "改进诉求各阶段占比",
                  "责任田接纳率(%)", "责任田超期率(%)")

    def test_xlsx_contains_overall_chart_series_tables(self, page, backend_server, assert_no_js_errors):
        import httpx
        base = backend_server
        # 前置：清掉目标月报告残留（含已归档态——归档态页面只读无导入按钮，且已归档
        # 报告 DELETE 直接删会 409，须先取消归档再删；与归档用例收尾同款两步清理，
        # 保证本用例可独立运行）。页面首载默认当前月，跨月后须显式选 YM 防错位
        opq = "operator_id=test_admin"
        httpx.delete(f"{base}/api/improvement-report/{YM}/archive?{opq}", timeout=15)
        httpx.delete(f"{base}/api/improvement-report/{YM}?{opq}", timeout=15)
        try:
            page.goto(f"{base}{PAGE_URL}")
            page.wait_for_selector("#root", timeout=15000)
            page.fill("#ir-month-input", f"{YM[:4]}-{YM[4:]}")
            page.evaluate(
                "() => document.getElementById('ir-month-input')"
                ".dispatchEvent(new Event('change', {bubbles: true}))"
            )
            page.wait_for_selector("[data-ir-import='overall']", timeout=15000)
            page.locator("[data-ir-import='overall']").first.click(timeout=10000)
            # 完成信号=进入编辑态（「整体接纳率」等 KPI 标签空数据也渲染，不可作信号）
            page.wait_for_function(
                """() => document.querySelector("[data-ir-save='overall']")
                    || (document.body.innerText || '').includes('导入失败')""",
                timeout=15000,
            )
            assert "导入失败" not in page.locator("body").inner_text(), "overall 导入不应失败"
            # Excel 导出读「已保存」快照（导入只进编辑草稿，导入→核对→保存为既定流程）；
            # HTML 导出文本同取已保存数据，但图表 PNG 取当前渲染实例——历史行为，非本用例覆盖点
            page.locator("[data-ir-save='overall']").first.click(timeout=10000)
            page.wait_for_function(
                """() => (document.body.innerText || '').includes('已保存')
                    || (document.body.innerText || '').includes('保存失败')""",
                timeout=15000,
            )
            body_txt = page.locator("body").inner_text()
            assert "保存失败" not in body_txt, "overall 段保存不应失败"
            # 保存触发全页重渲染（先 dispose 再延迟重挂），等四图实例带数据就绪再取对照真值
            page.wait_for_function(
                """() => ['ir-chart-overall-domain', 'ir-chart-overall-stage',
                         'ir-chart-overall-rf-accept', 'ir-chart-overall-rf-overdue']
                    .every((id) => {
                        const el = document.getElementById(id);
                        const inst = el && window.echarts && window.echarts.getInstanceByDom(el);
                        const s = inst && inst.getOption().series[0];
                        return !!(s && s.data && s.data.length >= 1);
                    })""",
                timeout=15000,
            )

            domain_pie = pie_pairs(page, "ir-chart-overall-domain")
            stage_pie = pie_pairs(page, "ir-chart-overall-stage")
            accept_bar = bar_pairs(page, "ir-chart-overall-rf-accept")
            overdue_bar = bar_pairs(page, "ir-chart-overall-rf-overdue")
            assert domain_pie and accept_bar, "DENSE 演示数据下领域饼/接纳率柱应有数据"

            with page.expect_download() as download_info:
                page.locator("#ir-export-xlsx-btn").click(timeout=10000)
            download = download_info.value
            assert download.suggested_filename.endswith(".xlsx"), \
                f"下载文件应为 xlsx: {download.suggested_filename}"

            # download.path() 为无扩展名临时文件，openpyxl 按扩展名识别格式，复制后缀后再读
            import shutil
            src = download.path()
            xlsx_path = src.parent / (src.name + ".xlsx")
            shutil.copy(src, xlsx_path)
            wb = openpyxl.load_workbook(xlsx_path, data_only=True)
            assert wb.sheetnames == ["改进报告"], f"应为单 sheet「改进报告」: {wb.sheetnames}"
            ws = wb["改进报告"]
            col_a = [("" if c.value is None else str(c.value).strip()) for c in ws["A"]]

            # 四段章节标题在位（导出骨架回归）
            for head in ("一、整体概况", "二、质量改进整体分析",
                         "三、质量改进领域分析", "四、本月新增改进诉求"):
                assert head in col_a, f"xlsx 应含章节标题「{head}」"

            # 子表区扫描：标题 → 「名称/数值」表头 → 数据行；每表后恒有空行作终止符，
            # 遇（暂无数据）/空行/其它子表或章节标题即止（不设行数上限，序列长度不人为截断）。
            # col_a 为列 A 的列表（下标 0 起），ws.cell 行号 1 起——统一按下标遍历，行号=下标+1
            def region_pairs(title):
                i = col_a.index(title)
                assert col_a[i + 1] == "名称", f"「{title}」下一行应为表头「名称」: {col_a[i + 1]}"
                pairs = {}
                for j in range(i + 2, len(col_a)):
                    name = col_a[j]
                    if (not name or name == "（暂无数据）" or name in self.SUB_TITLES
                            or name.startswith(("一、", "二、", "三、", "四、"))):
                        break
                    pairs[name] = ws.cell(row=j + 1, column=2).value
                return pairs

            for title in self.SUB_TITLES:
                assert title in col_a, f"xlsx 二段应含图表数据子表「{title}」（图表不嵌入但数据须补齐）"

            # 饼子表=饼图口径（过滤 ≤0 行、后端序），柱子表=柱图口径（保留 0 值、数值降序）
            # ——四表均与页面同源，逐项严格相等（非「类型对即可」的宽松断言）
            xlsx_domain = region_pairs("改进诉求领域占比")
            xlsx_stage = region_pairs("改进诉求各阶段占比")
            assert xlsx_domain == {k: v for k, v in domain_pie.items() if v > 0}, \
                f"领域占比子表应与页面饼图同源: {xlsx_domain} != {domain_pie}"
            assert xlsx_stage == {k: v for k, v in stage_pie.items() if v > 0}, \
                f"各阶段占比子表应与页面饼图同源: {xlsx_stage} != {stage_pie}"
            assert region_pairs("责任田接纳率(%)") == accept_bar, \
                f"接纳率子表应与页面柱图同源（保留 0 值行）: {region_pairs('责任田接纳率(%)')} != {accept_bar}"
            assert region_pairs("责任田超期率(%)") == overdue_bar, \
                f"超期率子表应与页面柱图同源（保留 0 值行）: {region_pairs('责任田超期率(%)')} != {overdue_bar}"

            # 三段子表体例沿用（一级/二级标题仍在，防本次重构挤掉既有内容）
            for title in ("模块&特性（一级，领域）", "模块&特性（二级，领域/模块）"):
                assert title in col_a, f"xlsx 三段应保留子表「{title}」"
        finally:
            # 收尾清理目标月报告（含归档态两步删），避免污染共享库（本套件既有惯例）
            httpx.delete(f"{base}/api/improvement-report/{YM}/archive?{opq}", timeout=15)
            httpx.delete(f"{base}/api/improvement-report/{YM}?{opq}", timeout=15)
