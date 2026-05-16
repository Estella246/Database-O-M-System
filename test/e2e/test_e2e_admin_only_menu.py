"""E2E：运维效率 / 月度报告 入口由权限策略白名单驱动。

覆盖：
- test_admin（管理员，DB 已种 oncall_eva=readonly + monthly_report=editable）：
  侧边栏可见「运维效率」按钮、月度报告父菜单及「问题报表 / 报告生成 / 报告归档」子项。
- test_user01（普通人员，无白名单配置 → 默认 hidden）：
  侧边栏不渲染上述任一入口，深链直接访问也不会停留在对应页面。
"""

import json

import pytest

pytestmark = pytest.mark.e2e


def _switch_operator(page, base_url, account: str, name: str):
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


class TestAdminOnlyMenuVisibility:

    def test_admin_sees_oncall_eva_and_report_menu(self, page, backend_server):
        _switch_operator(page, backend_server, "test_admin", "测试管理员")
        oncall_btn = page.locator("[data-nav-key='oncall:eva']")
        report_issue_btn = page.locator("[data-nav-key='report:issue']")
        report_gen_btn = page.locator("[data-nav-key='report:generate']")
        report_archive_btn = page.locator("[data-nav-key='report:archive']")
        assert oncall_btn.count() >= 1, "管理员侧栏应渲染「运维效率」入口"
        assert report_issue_btn.count() >= 1, "管理员侧栏应渲染「问题报表」入口"
        assert report_gen_btn.count() >= 1, "管理员侧栏应渲染「报告生成」入口"
        assert report_archive_btn.count() >= 1, "管理员侧栏应渲染「报告归档」入口"

    def test_normal_user_cannot_see_oncall_eva(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        oncall_btn = page.locator("[data-nav-key='oncall:eva']")
        assert oncall_btn.count() == 0, "普通员工（oncall_eva 默认 hidden）不应看到「运维效率」入口"

    def test_normal_user_cannot_see_monthly_report_menu(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        for key in ("report:issue", "report:generate", "report:archive"):
            btn = page.locator(f"[data-nav-key='{key}']")
            assert btn.count() == 0, f"普通员工（monthly_report 默认 hidden）不应看到「{key}」入口"

    def test_normal_user_oncall_deep_link_redirects(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        page.goto(f"{backend_server}/oncall-eva")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2000)
        # 即便未暴露 __APP_STATE__，渲染出的标题/页面也不应是「运维效率」。
        title = page.locator("#center-page-title").first
        if title.count():
            assert title.inner_text().strip() != "运维效率", "普通员工深链 /oncall-eva 不应停留在运维效率页"

    def test_normal_user_monthly_report_deep_links_redirect(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        forbidden = {
            "/report/issue": "问题报表",
            "/report/generate": "报告生成",
            "/report/archive": "报告归档",
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
