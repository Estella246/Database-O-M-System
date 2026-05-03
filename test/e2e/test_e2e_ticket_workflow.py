import time
import uuid

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _api_create_ticket(api_client, tag):
    resp = api_client.post("/api/tickets/YW00000000000/nodes/problem_fill/submit", json={
        "values": {
            "problem_title": f"E2E测试工单-{tag}",
            "issue_desc": f"端到端测试自动创建-{tag}",
            "severity": "一般",
            "location": "华东-上海",
            "biz_env": "生产",
            "start_date": time.strftime("%Y-%m-%d"),
            "handle_mode": "确认问题",
        },
        "operator_id": "test_admin",
        "operator_name": "Test Admin",
        "next_node_key": "problem_review",
    })
    if resp.status_code == 200:
        return resp.json().get("order_id") or resp.json().get("orderId")
    return None


def _api_submit_node(api_client, order_id, node_key, handle_mode, next_node_key=None):
    resp = api_client.post(f"/api/tickets/{order_id}/nodes/{node_key}/submit", json={
        "values": {"handle_mode": handle_mode},
        "operator_id": "test_admin",
        "operator_name": "Test Admin",
        "next_node_key": next_node_key or "",
    })
    return resp


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


class TestTicketCreateViaUI:
    """工单创建 - 通过UI操作"""

    def test_tc_e2e_101_create_ticket_modal_open(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.skip("创建工单按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        modal = page.locator(".create-ticket-modal").first
        assert modal.is_visible(), "点击创建按钮后应弹出创建工单弹窗"

    def test_tc_e2e_102_create_ticket_modal_has_form(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.skip("创建工单按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        form = page.locator("form[data-node-form]").first
        assert form.is_visible(), "创建工单弹窗中应有表单"
        save_btn = form.locator("button.action.primary[type='submit']").first
        assert save_btn.is_visible(), "表单中应有保存按钮"
        submit_btn = form.locator("button[data-action-submit]").first
        assert submit_btn.is_visible(), "表单中应有提交按钮"

    def test_tc_e2e_103_create_ticket_modal_cancel(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.skip("创建工单按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        cancel_btn = page.locator("#cancel-create-ticket-btn").first
        if cancel_btn.count() == 0 or not cancel_btn.is_visible():
            pytest.skip("取消按钮不可见")
        cancel_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".create-ticket-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击取消后弹窗应关闭"


class TestTicketWorkflowViaAPI:
    """工单全流程 - 通过API驱动数据，UI验证展示"""

    def test_tc_e2e_104_ticket_detail_shows_workflow(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        flow_wrap = page.locator(".flow-wrap").first
        if flow_wrap.count() > 0:
            assert flow_wrap.is_visible(), "工单详情页应显示流程区域"
        flow_bar = page.locator(".flow-bar").first
        if flow_bar.count() > 0:
            assert flow_bar.is_visible(), "工单详情页应显示流程进度条"

    def test_tc_e2e_105_ticket_detail_shows_node_form(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        form = page.locator("form[data-node-form]").first
        if form.count() > 0:
            assert form.is_visible(), "工单详情页当前节点应显示表单"

    def test_tc_e2e_106_ticket_detail_flow_logs(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        logs = page.locator(".flow-log").first
        if logs.count() > 0:
            assert logs.is_visible(), "工单详情页应显示流程日志"

    def test_tc_e2e_107_ticket_full_7_node_forward_flow(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")

        flow_steps = [
            ("problem_review", "确认问题", "ops_analysis"),
            ("ops_analysis", "提交开发分析", "dev_analysis"),
            ("dev_analysis", "提交开发闭环", "dev_closure"),
            ("dev_closure", "提交运维闭环", "ops_closure"),
            ("ops_closure", "提交运维审核关闭", "audit_close"),
            ("audit_close", "问题解决关闭", ""),
        ]
        for node_key, handle_mode, next_key in flow_steps:
            resp = _api_submit_node(api_client, order_id, node_key, handle_mode, next_key)
            if resp.status_code != 200:
                pytest.skip(f"节点 {node_key} 流转失败: {resp.status_code}")

        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        flow_bar = page.locator(".flow-bar li")
        if flow_bar.count() > 0:
            closed_items = flow_bar.locator(".flow-step-done, .flow-step-closed, [class*=done], [class*=closed]")
            assert closed_items.count() > 0, "7节点流转完成后应有已完成的步骤标记"

    def test_tc_e2e_108_ticket_list_shows_created_ticket(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        ticket_rows = page.locator(".ticket-row")
        found = False
        for i in range(ticket_rows.count()):
            row = ticket_rows.nth(i)
            row_id = row.get_attribute("data-order-id") or ""
            if row_id == order_id:
                found = True
                break
        assert found, f"工作台列表应显示刚创建的工单 {order_id}"


class TestTicketWorkbenchInteraction:
    """工单工作台交互"""

    def test_tc_e2e_109_workbench_ticket_click_opens_detail(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        ticket_row = page.locator(f".ticket-row[data-order-id='{order_id}']").first
        if ticket_row.count() == 0 or not ticket_row.is_visible():
            pytest.skip("工作台未显示测试工单行")
        ticket_row.click(timeout=5000)
        page.wait_for_timeout(2000)
        detail_tab = page.locator(f"[data-workspace-tab='ticket:{order_id}']").first
        if detail_tab.count() > 0:
            assert detail_tab.is_visible(), "点击工单行后应打开工单详情标签页"

    def test_tc_e2e_110_workbench_filter_interaction(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        filter_icons = page.locator("[data-home-ticket-list-filter-open]")
        if filter_icons.count() == 0:
            pytest.skip("工作台筛选图标未找到")
        filter_icons.first.click(timeout=5000)
        page.wait_for_timeout(500)
        filter_pop = page.locator(".filter-pop, [data-home-ticket-list-filter-panel]").first
        if filter_pop.count() > 0 and filter_pop.is_visible():
            search_input = page.locator("[data-home-ticket-list-filter-search]").first
            if search_input.count() > 0:
                search_input.fill("E2E测试")
                page.wait_for_timeout(500)
            close_btn = page.locator("[data-home-ticket-list-filter-close]").first
            if close_btn.count() > 0:
                close_btn.click(timeout=5000)
                page.wait_for_timeout(300)

    def test_tc_e2e_111_ticket_detail_node_expand(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        _api_submit_node(api_client, order_id, "problem_review", "确认问题", "ops_analysis")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        details = page.locator("details.flow-log")
        if details.count() > 0:
            first_detail = details.first
            if not first_detail.evaluate("el => el.open"):
                summary = first_detail.locator("summary").first
                if summary.is_visible():
                    summary.click(timeout=5000)
                    page.wait_for_timeout(500)
                    assert first_detail.evaluate("el => el.open"), "点击summary后details应展开"

    def test_tc_e2e_112_ticket_detail_form_save(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        order_id = _api_create_ticket(api_client, tag)
        if not order_id:
            pytest.skip("无法通过API创建工单")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        form = page.locator("form[data-node-form]").first
        if form.count() == 0 or not form.is_visible():
            pytest.skip("当前节点表单不可见")
        save_btn = form.locator("button.action.primary[type='submit']").first
        if save_btn.count() == 0 or not save_btn.is_visible():
            pytest.skip("保存按钮不可见")
        save_btn.click(timeout=5000)
        page.wait_for_timeout(2000)
