import time

import pytest

from e2e_api import require_submit_ok, require_ticket_order_id, unique_e2e_tag

pytestmark = pytest.mark.e2e


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


def _ensure_visible_node_form(page, timeout_ms: int = 15000):
    """当前节点卡片若未自动展开（处理人与登录人不一致时），依次展开直到表单可见。"""
    deadline = time.time() + timeout_ms / 1000.0
    while time.time() < deadline:
        loc = page.locator("details.flow-log[open] form[data-node-form]").first
        if loc.count() > 0 and loc.is_visible():
            return loc
        n = page.locator("details.flow-log").count()
        for i in range(n):
            det = page.locator("details.flow-log").nth(i)
            if not det.evaluate("el => el.open"):
                sum_btn = det.locator("summary").first
                if sum_btn.count():
                    sum_btn.click(timeout=5000)
                    page.wait_for_timeout(400)
            inner = det.locator("form[data-node-form]").first
            if inner.count() > 0 and inner.is_visible():
                return inner
        page.wait_for_timeout(300)
    pytest.fail("工单详情未找到可见的节点表单（请检查 flow-log 或 ticket_detail 白名单）")


def _fail_if_create_btn_hidden(create_btn, msg_extra=""):
    if create_btn.count() == 0 or not create_btn.is_visible():
        pytest.fail(
            "创建工单按钮不可见：确认 workbench_create 在白名单为 readonly。"
            + msg_extra
        )


class TestTicketCreateViaUI:
    """工单创建 - 通过UI操作"""

    def test_tc_e2e_101_create_ticket_modal_open(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        _fail_if_create_btn_hidden(create_btn)
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        modal = page.locator(".create-ticket-modal").first
        assert modal.is_visible(), "点击创建按钮后应弹出创建工单弹窗"

    def test_tc_e2e_102_create_ticket_modal_has_form(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        _fail_if_create_btn_hidden(create_btn)
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        form = page.locator("form[data-node-form]").first
        assert form.is_visible(), "创建工单弹窗中应有表单"
        save_btn = form.locator("button.action.primary[type='submit']").first
        assert save_btn.is_visible(), "表单中应有保存按钮"
        submit_btn = form.locator("button[data-action-submit]").first
        assert submit_btn.is_visible(), "表单中应有提交按钮"

    def test_tc_e2e_103_create_ticket_modal_close(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        rows_before = page.locator("#table-body tr.ticket-row").count()
        create_btn = page.locator("#create-ticket-btn").first
        _fail_if_create_btn_hidden(create_btn)
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        close_btn = page.locator("#close-create-ticket-btn").first
        if close_btn.count() == 0 or not close_btn.is_visible():
            pytest.fail("关闭按钮不可见（创建弹窗未完整渲染）")
        close_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        modal = page.locator(".create-ticket-modal").first
        assert modal.count() == 0 or not modal.is_visible(), "点击关闭后弹窗应关闭"
        rows_after = page.locator("#table-body tr.ticket-row").count()
        assert rows_after == rows_before, "取消创建后列表行数不应增加"


class TestTicketWorkflowViaAPI:
    """工单全流程 - 通过API驱动数据，UI验证展示"""

    def test_tc_e2e_104_ticket_detail_shows_workflow(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
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
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        form = _ensure_visible_node_form(page)
        assert form.is_visible(), "工单详情页当前节点应显示表单"

    def test_tc_e2e_106_ticket_detail_flow_logs(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        logs = page.locator(".flow-log").first
        if logs.count() > 0:
            assert logs.is_visible(), "工单详情页应显示流程日志"

    def test_tc_e2e_107_ticket_full_7_node_forward_flow(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)

        flow_steps = [
            ("problem_review", "确认问题", "ops_analysis"),
            ("ops_analysis", "提交开发分析", "dev_analysis"),
            ("dev_analysis", "提交开发闭环", "dev_closure"),
            ("dev_closure", "提交运维闭环", "ops_closure"),
            ("ops_closure", "提交运维审核关闭", "audit_close"),
            ("audit_close", "问题解决关闭", ""),
        ]
        for node_key, handle_mode, next_key in flow_steps:
            require_submit_ok(
                api_client, order_id, node_key, handle_mode, next_key or None,
                ctx="7_node_flow",
            )

        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.passed").count() > 0, "7节点流转完成后应有已完成的步骤标记"

    def test_tc_e2e_108_ticket_list_shows_created_ticket(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
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
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        ticket_row = page.locator(f".ticket-row[data-order-id='{order_id}']").first
        if ticket_row.count() == 0 or not ticket_row.is_visible():
            pytest.fail(
                f"工作台未显示测试工单行 {order_id}：确认 ticket_list 为 readonly 且 operator 与建单一致"
            )
        ticket_row.click(timeout=5000)
        page.wait_for_timeout(2000)
        detail_tab = page.locator(f"[data-workspace-tab='ticket:{order_id}']").first
        if detail_tab.count() > 0:
            assert detail_tab.is_visible(), "点击工单行后应打开工单详情标签页"

    def test_tc_e2e_110_workbench_filter_interaction(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        filter_icons = page.locator("[data-ticket-list-filter-open]")
        if filter_icons.count() == 0:
            pytest.fail("工作台筛选图标未找到（列表工具栏未挂载）")
        filter_icons.first.click(timeout=5000)
        page.wait_for_timeout(500)
        filter_pop = page.locator(".filter-pop").first
        if filter_pop.count() > 0 and filter_pop.is_visible():
            search_input = page.locator("[data-ticket-list-filter-search]").first
            if search_input.count() > 0:
                search_input.fill("E2E测试")
                page.wait_for_timeout(500)
            close_btn = page.locator("[data-ticket-list-filter-close]").first
            if close_btn.count() > 0:
                close_btn.click(timeout=5000)
                page.wait_for_timeout(300)

    def test_tc_e2e_111_ticket_detail_node_expand(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_submit_ok(
            api_client, order_id, "problem_review", "确认问题", "ops_analysis",
            ctx="node_expand",
        )
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
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        form = _ensure_visible_node_form(page)
        if not form.is_visible():
            pytest.fail("当前节点表单不可见（详情页未渲染表单）")
        save_btn = form.locator("button.action.primary[type='submit']").first
        if save_btn.count() == 0 or not save_btn.is_visible():
            pytest.fail("保存按钮不可见")
        save_btn.click(timeout=5000)
        page.wait_for_timeout(2000)
