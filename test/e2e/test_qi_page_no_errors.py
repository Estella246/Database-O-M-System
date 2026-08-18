"""质量改进页面 E2E 看护测试：打开列表/详情/新建页面，检查 JS 无报错。"""
import pytest
import httpx

pytestmark = pytest.mark.e2e


def _first_qi_id(backend_server, status=None):
    params = {"operator_id": "test_admin", "scope": "all", "page_size": 1}
    if status:
        params["status"] = status
    # trust_env=False：与 conftest 一致，避免系统代理把本机回环请求打挂导致用例静默跳过
    r = httpx.get(f"{backend_server}/api/qi", params=params, timeout=10, trust_env=False)
    items = r.json().get("items", []) if r.status_code == 200 else []
    return items[0]["id"] if items else None


class TestQiPageNoJSErrors:
    """QI 相关页面打开时不应有 JS 报错。"""

    def test_qi_list_page_no_errors(self, page, backend_server, assert_no_js_errors):
        """QI 列表页无 JS 报错。"""
        page.goto(f"{backend_server}/qi", wait_until="networkidle", timeout=20000)
        page.wait_for_timeout(3000)

    def test_qi_new_page_no_errors(self, page, backend_server, assert_no_js_errors):
        """新建 QI 页面无 JS 报错。"""
        page.goto(f"{backend_server}/qi/new", wait_until="networkidle", timeout=20000)
        page.wait_for_timeout(3000)

    def test_qi_detail_page_no_errors(self, page, backend_server, assert_no_js_errors):
        """已有 QI 详情页无 JS 报错。"""
        qi_id = _first_qi_id(backend_server)
        if not qi_id:
            pytest.skip("无 QI 数据，跳过详情页测试")
        page.goto(f"{backend_server}/qi/{qi_id}", wait_until="networkidle", timeout=20000)
        page.wait_for_timeout(3000)

    def test_qi_draft_detail_page_no_errors(self, page, backend_server, assert_no_js_errors):
        """草稿 QI 详情页无 JS 报错（看护 can_submit_draft 渲染）。"""
        qi_id = _first_qi_id(backend_server, status="draft")
        if not qi_id:
            pytest.skip("无草稿 QI 数据，跳过草稿详情页测试")
        page.goto(f"{backend_server}/qi/{qi_id}", wait_until="networkidle", timeout=20000)
        page.wait_for_timeout(3000)
