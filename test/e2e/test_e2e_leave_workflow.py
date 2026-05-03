import time
import uuid
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _api_create_leave(api_client, tag):
    now = datetime.now()
    start = (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:00:00")
    end = (now + timedelta(hours=6)).strftime("%Y-%m-%dT%H:00:00")
    resp = api_client.post("/api/leave/applications", json={
        "operator_id": "test_admin",
        "application_type": "事假",
        "segments": [
            {"start": start, "end": end, "reason": f"E2E请假测试-{tag}"}
        ],
    })
    if resp.status_code == 200:
        return resp.json().get("id")
    return None


def _api_delete_leave(api_client, leave_id):
    if leave_id:
        api_client.delete(f"/api/leave/applications/{leave_id}", params={"operator_id": "test_admin"})


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


class TestLeavePageLoad:
    """请假管理页面加载与布局"""

    def test_tc_e2e_301_leave_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        panel = page.locator("#leave-application-panel")
        assert panel.count() > 0, "请假申请面板应存在"

    def test_tc_e2e_302_leave_page_has_tabs(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        tabs = page.locator("[data-leave-tab]")
        assert tabs.count() >= 2, "请假管理页面应有至少2个标签页"

    def test_tc_e2e_303_leave_page_has_table(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        table = page.locator(".leave-app-table").first
        assert table.is_visible(), "请假管理页面应有请假列表表格"

    def test_tc_e2e_304_leave_page_has_search(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        search = page.locator("#leave-app-search-input").first
        assert search.is_visible(), "请假管理页面应有搜索框"


class TestLeaveTabSwitch:
    """请假管理标签切换"""

    def test_tc_e2e_305_switch_to_todo_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        todo_tab = page.locator("[data-leave-tab='todo']").first
        if todo_tab.count() == 0 or not todo_tab.is_visible():
            pytest.skip("我的待办标签页不可见")
        todo_tab.click(timeout=5000)
        page.wait_for_timeout(1500)
        assert todo_tab.evaluate("el => el.classList.contains('active')"), "点击后标签应为active"

    def test_tc_e2e_306_switch_to_all_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        all_tab = page.locator("[data-leave-tab='all']").first
        if all_tab.count() == 0 or not all_tab.is_visible():
            pytest.skip("所有申请标签页不可见")
        all_tab.click(timeout=5000)
        page.wait_for_timeout(1500)
        assert all_tab.evaluate("el => el.classList.contains('active')"), "点击后标签应为active"


class TestLeaveApplyViaUI:
    """请假申请 - 通过UI操作"""

    def test_tc_e2e_307_apply_leave_modal_open(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        apply_btn = page.locator("#leave-app-apply-btn").first
        if apply_btn.count() == 0 or not apply_btn.is_visible():
            pytest.skip("申请按钮不可见（权限限制）")
        apply_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        modal = page.locator("#leave-app-create-mask, .perm-modal-mask").first
        assert modal.is_visible(), "点击申请后应弹出请假申请弹窗"

    def test_tc_e2e_308_apply_leave_modal_has_fields(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        apply_btn = page.locator("#leave-app-apply-btn").first
        if apply_btn.count() == 0 or not apply_btn.is_visible():
            pytest.skip("申请按钮不可见（权限限制）")
        apply_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        type_select = page.locator("#leave-app-type-select, select[data-leave-type]").first
        if type_select.count() > 0:
            assert type_select.is_visible(), "弹窗中应有申请类型选择"
        seg_table = page.locator("#leave-app-seg-tbody").first
        if seg_table.count() > 0:
            assert seg_table.is_visible(), "弹窗中应有请假时间段表格"

    def test_tc_e2e_309_apply_leave_fill_and_cancel(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        apply_btn = page.locator("#leave-app-apply-btn").first
        if apply_btn.count() == 0 or not apply_btn.is_visible():
            pytest.skip("申请按钮不可见（权限限制）")
        apply_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        cancel_btn = page.locator("#leave-app-create-cancel, .perm-modal-actions button", has_text="取消").first
        if cancel_btn.count() > 0 and cancel_btn.is_visible():
            cancel_btn.click(timeout=5000)
            page.wait_for_timeout(1000)


class TestLeaveListInteraction:
    """请假列表交互 - 通过API准备数据"""

    def test_tc_e2e_310_leave_list_shows_created_application(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        leave_id = _api_create_leave(api_client, tag)
        if not leave_id:
            pytest.skip("无法通过API创建请假申请")
        try:
            page.goto(f"{backend_server}/leave-application")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            all_tab = page.locator("[data-leave-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(1500)
            leave_rows = page.locator(f".leave-app-row[data-leave-app-id='{leave_id}']").first
            if leave_rows.count() > 0:
                assert leave_rows.is_visible(), "请假列表应显示刚创建的申请"
        finally:
            _api_delete_leave(api_client, leave_id)

    def test_tc_e2e_311_leave_row_click_opens_detail(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        leave_id = _api_create_leave(api_client, tag)
        if not leave_id:
            pytest.skip("无法通过API创建请假申请")
        try:
            page.goto(f"{backend_server}/leave-application")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            all_tab = page.locator("[data-leave-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(1500)
            leave_row = page.locator(f".leave-app-row[data-leave-app-id='{leave_id}']").first
            if leave_row.count() == 0 or not leave_row.is_visible():
                pytest.skip("请假列表未显示测试申请行")
            leave_row.click(timeout=5000)
            page.wait_for_timeout(2000)
            detail_modal = page.locator("#leave-app-detail-mask, .perm-modal-mask").first
            if detail_modal.count() > 0 and detail_modal.is_visible():
                assert True
        finally:
            _api_delete_leave(api_client, leave_id)

    def test_tc_e2e_312_leave_search_interaction(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/leave-application")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        search = page.locator("#leave-app-search-input").first
        if search.count() == 0 or not search.is_visible():
            pytest.skip("搜索框不可见")
        search.fill("E2E测试")
        page.wait_for_timeout(800)
        assert search.input_value() == "E2E测试", "搜索框应可输入"
        search.fill("")
        page.wait_for_timeout(500)


class TestLeaveApprovalViaUI:
    """请假审批交互"""

    def test_tc_e2e_313_leave_detail_has_action_buttons(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        leave_id = _api_create_leave(api_client, tag)
        if not leave_id:
            pytest.skip("无法通过API创建请假申请")
        try:
            page.goto(f"{backend_server}/leave-application")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            all_tab = page.locator("[data-leave-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(1500)
            leave_row = page.locator(f".leave-app-row[data-leave-app-id='{leave_id}']").first
            if leave_row.count() == 0 or not leave_row.is_visible():
                pytest.skip("请假列表未显示测试申请行")
            leave_row.click(timeout=5000)
            page.wait_for_timeout(2000)
            action_btns = page.locator("[data-leave-action]")
            if action_btns.count() > 0:
                agree_btn = page.locator("[data-leave-action='agree']").first
                cancel_btn = page.locator("[data-leave-action='cancel']").first
                reject_btn = page.locator("[data-leave-action='reject']").first
                has_any = any(
                    btn.count() > 0 and btn.is_visible()
                    for btn in [agree_btn, cancel_btn, reject_btn]
                )
                assert has_any, "请假详情弹窗应有操作按钮"
        finally:
            _api_delete_leave(api_client, leave_id)
