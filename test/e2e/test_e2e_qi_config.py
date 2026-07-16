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


