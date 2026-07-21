"""质量改进页面 E2E 看护测试：打开列表/详情/新建页面，检查 JS 无报错。"""
import pytest
import os
import sys

# 仅在有 Playwright 的环境中运行
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    pytest.skip("Playwright not installed", allow_module_level=True)

BASE = os.environ.get("TEST_FRONTEND_URL", "http://127.0.0.1:8000")


def _check_page_errors(page, url, label):
    """打开页面，等待渲染，收集 JS 报错。返回错误列表。"""
    errors = []
    page.on("pageerror", lambda e: errors.append(e.message))
    page.goto(url, wait_until="networkidle", timeout=20000)
    page.wait_for_timeout(4000)
    if errors:
        print(f"  [{label}] JS errors: {errors}")
    return errors


class TestQiPageNoJSErrors:
    """QI 相关页面打开时不应有 JS 报错。"""

    def test_qi_list_page_no_errors(self):
        """QI 列表页无 JS 报错。"""
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            errors = _check_page_errors(page, f"{BASE}/qi", "QI列表")
            browser.close()
            assert not errors, f"QI 列表页 JS 报错: {errors}"

    def test_qi_detail_page_no_errors(self):
        """已有 QI 详情页无 JS 报错。"""
        # 先获取一个已存在的 QI ID
        import requests
        r = requests.get(
            f"{os.environ.get('TEST_API_BASE_URL', 'http://127.0.0.1:18080')}/api/qi",
            params={"operator_id": "admin", "scope": "all", "page_size": 1},
            timeout=10,
        )
        items = r.json().get("items", []) if r.ok else []
        if not items:
            pytest.skip("无 QI 数据，跳过详情页测试")

        qi_id = items[0]["id"]
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            errors = _check_page_errors(page, f"{BASE}/qi/{qi_id}", f"QI详情-{qi_id}")
            browser.close()
            assert not errors, f"QI 详情页 JS 报错: {errors}"

    def test_qi_new_page_no_errors(self):
        """新建 QI 页面无 JS 报错。"""
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            errors = _check_page_errors(page, f"{BASE}/qi/new", "QI新建")
            browser.close()
            assert not errors, f"QI 新建页 JS 报错: {errors}"

    def test_qi_draft_detail_page_no_errors(self):
        """草稿 QI 详情页无 JS 报错（看护 can_submit_draft 渲染）。"""
        import requests
        api_base = os.environ.get("TEST_API_BASE_URL", "http://127.0.0.1:18080")
        r = requests.get(
            f"{api_base}/api/qi",
            params={"operator_id": "admin", "scope": "all", "status": "draft", "page_size": 1},
            timeout=10,
        )
        items = r.json().get("items", []) if r.ok else []
        if not items:
            pytest.skip("无草稿 QI 数据，跳过草稿详情页测试")

        qi_id = items[0]["id"]
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            errors = _check_page_errors(page, f"{BASE}/qi/{qi_id}", f"草稿详情-{qi_id}")
            browser.close()
            assert not errors, f"草稿 QI 详情页 JS 报错: {errors}"
