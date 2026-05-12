"""E2E：运维效率 / 报告生成 仅管理员可见。

覆盖：
- test_admin（管理员）：侧边栏可见「运维效率」按钮、月度报告子菜单内含「报告生成」。
- test_user01（普通人员）：侧边栏不渲染上述两项，深链直接访问也不会停留在对应页面。
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

    def test_admin_sees_oncall_eva_and_report_generate(self, page, backend_server):
        _switch_operator(page, backend_server, "test_admin", "测试管理员")
        oncall_btn = page.locator("[data-nav-key='oncall:eva']")
        report_gen_btn = page.locator("[data-nav-key='report:generate']")
        assert oncall_btn.count() >= 1, "管理员侧栏应渲染「运维效率」入口"
        assert report_gen_btn.count() >= 1, "管理员侧栏应渲染「报告生成」入口"

    def test_normal_user_cannot_see_oncall_eva(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        oncall_btn = page.locator("[data-nav-key='oncall:eva']")
        assert oncall_btn.count() == 0, "普通员工不应看到「运维效率」入口"

    def test_normal_user_cannot_see_report_generate(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        report_gen_btn = page.locator("[data-nav-key='report:generate']")
        assert report_gen_btn.count() == 0, "普通员工不应看到「报告生成」入口"

    def test_normal_user_oncall_deep_link_redirects(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        page.goto(f"{backend_server}/oncall-eva")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2000)
        active_key = page.evaluate("() => window.__APP_STATE__ && window.__APP_STATE__.activeKey")
        # 即便未暴露 __APP_STATE__，渲染出的标题/页面也不应是「运维效率」。
        title = page.locator("#center-page-title").first
        if title.count():
            assert title.inner_text().strip() != "运维效率", "普通员工深链 /oncall-eva 不应停留在运维效率页"

    def test_normal_user_report_generate_deep_link_redirects(self, page, backend_server):
        _switch_operator(page, backend_server, "test_user01", "测试用户01")
        page.goto(f"{backend_server}/report/generate")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(2000)
        title = page.locator("#center-page-title").first
        if title.count():
            assert title.inner_text().strip() != "报告生成", "普通员工深链 /report/generate 不应停留在报告生成页"
