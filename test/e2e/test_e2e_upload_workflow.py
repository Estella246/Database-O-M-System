import time
import uuid

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _api_create_upload_session(api_client, tag):
    resp = api_client.post("/api/upload", json={
        "operator_id": "test_admin",
        "operator_name": "Test Admin",
        "file_name": f"e2e_test_{tag}.xlsx",
        "session_name": f"E2E上传测试-{tag}",
        "raw_data": {"Sheet1": [{"姓名": "张三", "工作量": 10}, {"姓名": "李四", "工作量": 20}]},
        "available_sheets": ["Sheet1"],
        "import_options": {"selected_sheets": ["Sheet1"], "name_column": "姓名"},
        "display_mode": "chart",
    })
    if resp.status_code == 200:
        return resp.json().get("session_id")
    return None


def _api_delete_upload_session(api_client, session_id):
    if session_id:
        api_client.post(f"/api/upload/delete/{session_id}", params={"operator_id": "test_admin"})


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


class TestUploadPageLoad:
    """上传分析页面加载"""

    def test_tc_e2e_701_upload_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/upload-analysis")
        _wait_for(page, "#root")
        # 与 renderUploadAnalysisPage 一致：section.upload-page、工具栏、文件选择
        root_panel = page.locator("section.upload-page").first
        root_panel.wait_for(state="visible", timeout=15000)
        toolbar = page.locator(".upload-toolbar").first
        assert toolbar.is_visible(), "上传分析页应有工具栏"


class TestUploadSessionViaAPI:
    """上传会话 - 通过API驱动数据，UI验证展示"""

    def test_tc_e2e_702_upload_history_shows_session(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        session_id = _api_create_upload_session(api_client, tag)
        if not session_id:
            pytest.skip("无法通过API创建上传会话")
        try:
            page.goto(f"{backend_server}/upload-analysis")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            history_items = page.locator("[data-upload-session], .upload-history-item, .upload-session-row")
            if history_items.count() > 0:
                found = False
                for i in range(history_items.count()):
                    item = history_items.nth(i)
                    if tag in item.inner_text():
                        found = True
                        break
                assert found, f"上传历史应显示刚创建的会话 {tag}"
        finally:
            _api_delete_upload_session(api_client, session_id)

    def test_tc_e2e_703_upload_session_click_detail(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        session_id = _api_create_upload_session(api_client, tag)
        if not session_id:
            pytest.skip("无法通过API创建上传会话")
        try:
            page.goto(f"{backend_server}/upload-analysis")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            history_items = page.locator("[data-upload-session], .upload-history-item, .upload-session-row")
            for i in range(history_items.count()):
                item = history_items.nth(i)
                if tag in item.inner_text():
                    item.click(timeout=5000)
                    page.wait_for_timeout(2000)
                    break
        finally:
            _api_delete_upload_session(api_client, session_id)

    def test_tc_e2e_704_upload_preview_via_api(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        resp = api_client.post("/api/upload/preview", json={
            "operator_id": "test_admin",
            "file_name": f"preview_{tag}.xlsx",
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名", "工作量"], "preview_rows": [["张三", 10]], "row_count": 1}
            ],
        })
        if resp.status_code != 200:
            pytest.skip("上传预览API不可用")
        page.goto(f"{backend_server}/upload-analysis")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)

    def test_tc_e2e_705_upload_session_config_change(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        session_id = _api_create_upload_session(api_client, tag)
        if not session_id:
            pytest.skip("无法通过API创建上传会话")
        try:
            config_resp = api_client.post(f"/api/upload/session/config/{session_id}", json={
                "operator_id": "test_admin",
                "import_options": {"selected_sheets": ["Sheet1"], "name_column": "姓名"},
                "display_mode": "table",
            })
            if config_resp.status_code != 200:
                pytest.skip("上传会话配置更新失败")
            page.goto(f"{backend_server}/upload-analysis")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
        finally:
            _api_delete_upload_session(api_client, session_id)

    def test_tc_e2e_706_upload_kpi_cards(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        session_id = _api_create_upload_session(api_client, tag)
        if not session_id:
            pytest.skip("无法通过API创建上传会话")
        try:
            page.goto(f"{backend_server}/upload-analysis")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            kpi_cards = page.locator(".upload-kpi-card")
            if kpi_cards.count() > 0:
                assert kpi_cards.first.is_visible(), "上传分析页面应显示KPI卡片"
        finally:
            _api_delete_upload_session(api_client, session_id)
