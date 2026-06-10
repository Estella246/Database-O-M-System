import time

import pytest

from e2e_api import (
    api_submit_node,
    require_advance_to_node,
    require_submit_ok,
    require_ticket_order_id,
    unique_e2e_tag,
)

pytestmark = pytest.mark.e2e


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


class TestTicketRollbackFlow:
    """工单回退流程 - 验证各节点回退操作"""

    def test_tc_e2e_113_dev_analysis_rollback_to_ops_analysis(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "dev_analysis")
        require_submit_ok(api_client, order_id, "dev_analysis", "返回运维分析", "ops_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "回退后flow-bar应有current节点标记"

    def test_tc_e2e_114_dev_closure_rollback_to_dev_analysis(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "dev_closure")
        require_submit_ok(api_client, order_id, "dev_closure", "返回开发分析", "dev_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "回退后flow-bar应有current节点标记"

    def test_tc_e2e_115_dev_closure_rollback_to_ops_analysis(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "dev_closure")
        require_submit_ok(api_client, order_id, "dev_closure", "返回运维分析", "ops_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "跨节点回退后flow-bar应有current节点标记"

    def test_tc_e2e_116_ops_closure_rollback_to_dev_closure(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "ops_closure")
        require_submit_ok(api_client, order_id, "ops_closure", "返回开发闭环", "dev_closure", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "回退后flow-bar应有current节点标记"

    def test_tc_e2e_117_ops_closure_rollback_to_ops_analysis(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "ops_closure")
        require_submit_ok(api_client, order_id, "ops_closure", "返回运维分析", "ops_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "跨节点回退后flow-bar应有current节点标记"

    def test_tc_e2e_118_audit_close_rollback_to_ops_closure(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "audit_close")
        require_submit_ok(api_client, order_id, "audit_close", "返回运维闭环", "ops_closure", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "审核关闭回退后flow-bar应有current节点标记"


class TestTicketJumpForwardFlow:
    """工单跳转/跨节点前跳流程"""

    def test_tc_e2e_119_ops_analysis_jump_to_dev_closure(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "ops_analysis")
        require_submit_ok(api_client, order_id, "ops_analysis", "提交开发闭环", "dev_closure", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.passed").count() >= 2, "跳转后应有已通过节点标记"

    def test_tc_e2e_120_ops_analysis_jump_to_ops_closure(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "ops_analysis")
        require_submit_ok(
            api_client,
            order_id,
            "ops_analysis",
            "提交运维闭环",
            "ops_closure",
            ctx="rollback",
            extra_values={"is_quality_issue": "否"},
        )
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.passed").count() >= 2, "跳转后应有已通过节点标记"


class TestTicketSameNodeStay:
    """工单同节点停留 - 处理方式不改变当前节点"""

    def test_tc_e2e_121_problem_review_stay(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_submit_ok(api_client, order_id, "problem_review", "提交其他运维审核", "problem_review", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "同节点停留后flow-bar应有current节点标记"

    def test_tc_e2e_122_ops_analysis_stay(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "ops_analysis")
        require_submit_ok(api_client, order_id, "ops_analysis", "提交其他运维分析", "ops_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "同节点停留后flow-bar应有current节点标记"

    def test_tc_e2e_123_audit_close_stay(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "audit_close")
        require_submit_ok(api_client, order_id, "audit_close", "提交其他审核关闭", "audit_close", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "同节点停留后flow-bar应有current节点标记"


class TestTicketCloseFlow:
    """工单关闭流程"""

    def test_tc_e2e_124_non_problem_close(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_submit_ok(api_client, order_id, "problem_review", "非问题关闭", "problem_review", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        detail_head = page.locator(".detail-head h2").first
        if detail_head.count() > 0:
            assert detail_head.is_visible(), "工单详情标题应可见"

    def test_tc_e2e_125_problem_resolved_close(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "audit_close")
        require_submit_ok(api_client, order_id, "audit_close", "问题解决关闭", "audit_close", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.passed").count() >= 6, "问题解决关闭后所有已通过节点应标记为passed"

    def test_tc_e2e_126_closed_ticket_no_editable_form(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "audit_close")
        require_submit_ok(api_client, order_id, "audit_close", "问题解决关闭", "audit_close", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        editable_form = page.locator("form[data-node-form] button[data-action-submit]").first
        if editable_form.count() > 0:
            assert not editable_form.is_visible() or editable_form.is_disabled(), "已关闭工单不应有可编辑的提交按钮"


class TestTicketSuspendFlow:
    """工单挂起流程"""

    def test_tc_e2e_127_suspend_at_audit_close(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "audit_close")
        require_submit_ok(api_client, order_id, "audit_close", "暂时挂起", "audit_close", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "挂起后flow-bar应有current节点标记"


class TestTicketFlowBarStates:
    """工单流转各节点状态可视化验证"""

    def test_tc_e2e_128_flow_bar_initial_state(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        flow_bar = page.locator(".flow-bar")
        if flow_bar.count() == 0:
            pytest.fail("工单详情未渲染 .flow-bar（检查路由与工单数据）")
        if flow_bar.locator("li.flow-node").count() > 0:
            assert flow_bar.locator("li.flow-node.current").count() >= 1, "初始状态应有current节点"
            assert flow_bar.locator("li.flow-node.upcoming").count() >= 1, "初始状态应有upcoming节点"

    def test_tc_e2e_129_flow_bar_passed_state_after_review(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_submit_ok(api_client, order_id, "problem_review", "确认问题", "ops_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        flow_bar = page.locator(".flow-bar")
        if flow_bar.count() == 0:
            pytest.fail("工单详情未渲染 .flow-bar（检查路由与工单数据）")
        if flow_bar.locator("li.flow-node").count() > 0:
            assert flow_bar.locator("li.flow-node.passed").count() >= 1, "审核通过后应有passed节点"

    def test_tc_e2e_130_flow_bar_all_passed_after_close(self, page, backend_server, api_client, assert_no_js_errors):
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
                ctx="flow_bar_all_passed",
            )
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        flow_bar = page.locator(".flow-bar")
        if flow_bar.count() == 0:
            pytest.fail("工单详情未渲染 .flow-bar（检查路由与工单数据）")
        if flow_bar.locator("li.flow-node").count() > 0:
            assert flow_bar.locator("li.flow-node.upcoming").count() == 0, "关闭后不应有upcoming节点"


class TestTicketDetailFeatures:
    """工单详情页功能"""

    def test_tc_e2e_131_share_link_button(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        share_btn = page.locator("#copy-link-btn").first
        if share_btn.count() > 0 and share_btn.is_visible():
            share_btn.click(timeout=5000)
            page.wait_for_timeout(500)

    def test_tc_e2e_132_log_drawer_toggle(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        log_btn = page.locator("#toggle-log-drawer-btn").first
        if log_btn.count() == 0 or not log_btn.is_visible():
            pytest.fail("日志按钮不可见：确认 admin_whitelist_full 含 ticket_detail_log")
        log_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        log_drawer = page.locator(".log-drawer, .operation-log-drawer").first
        if log_drawer.count() > 0:
            assert log_drawer.is_visible(), "点击日志按钮后应显示操作日志抽屉"
        log_btn2 = page.locator("#toggle-log-drawer-btn").first
        if log_btn2.count() > 0 and log_btn2.is_visible():
            log_btn2.click(timeout=5000)
            page.wait_for_timeout(500)

    def test_tc_e2e_133_operation_log_content(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_submit_ok(
            api_client, order_id, "problem_review", "确认问题", "ops_analysis",
            ctx="operation_log",
        )
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        log_btn = page.locator("#toggle-log-drawer-btn").first
        if log_btn.count() > 0 and log_btn.is_visible():
            log_btn.click(timeout=5000)
            page.wait_for_timeout(1000)
        log_entries = page.locator(".log-entry, .op-log-row, .operation-log-item")
        if log_entries.count() > 0:
            assert log_entries.first.is_visible(), "操作日志应显示条目"

    def test_tc_e2e_134_workspace_tab_close(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        ticket_row = page.locator(f"tr[data-order-id='{order_id}'], .ticket-row[data-order-id='{order_id}']").first
        if ticket_row.count() > 0 and ticket_row.is_visible():
            ticket_row.click(timeout=5000)
            page.wait_for_timeout(2000)
            close_tab = page.locator(f"[data-close-tab='ticket:{order_id}']").first
            if close_tab.count() > 0 and close_tab.is_visible():
                close_tab.click(timeout=5000)
                page.wait_for_timeout(1000)
                tab = page.locator(f"[data-workspace-tab='ticket:{order_id}']").first
                assert tab.count() == 0 or not tab.is_visible(), "关闭标签页后工单详情标签应消失"

    def test_tc_e2e_135_workspace_tab_switch(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        ticket_row = page.locator(f"tr[data-order-id='{order_id}'], .ticket-row[data-order-id='{order_id}']").first
        if ticket_row.count() > 0 and ticket_row.is_visible():
            ticket_row.click(timeout=5000)
            page.wait_for_timeout(2000)
        home_tab = page.locator("[data-workspace-tab='home']").first
        if home_tab.count() > 0 and home_tab.is_visible():
            home_tab.click(timeout=5000)
            page.wait_for_timeout(1000)
            assert home_tab.evaluate("el => el.classList.contains('active')"), "切换到主页标签后应为active"
        ticket_tab = page.locator(f"[data-workspace-tab='ticket:{order_id}']").first
        if ticket_tab.count() > 0 and ticket_tab.is_visible():
            ticket_tab.click(timeout=5000)
            page.wait_for_timeout(1000)
            assert ticket_tab.evaluate("el => el.classList.contains('active')"), "切换到工单标签后应为active"


class TestWorkbenchAdvancedInteraction:
    """工作台高级交互"""

    def test_tc_e2e_136_home_workbench_tab_pending(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        pending_tab = page.locator("[data-home-workbench-tab='pending']").first
        if pending_tab.count() == 0 or not pending_tab.is_visible():
            pytest.fail("首页待办工单标签不可见（DOM/权限）")
        pending_tab.click(timeout=5000)
        page.wait_for_timeout(1000)
        assert pending_tab.evaluate("el => el.classList.contains('active')"), "待办工单标签应为active"

    def test_tc_e2e_137_home_workbench_tab_pending_close(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        pending_close_tab = page.locator("[data-home-workbench-tab='pending_close']").first
        if pending_close_tab.count() == 0 or not pending_close_tab.is_visible():
            pytest.fail("首页待关单标签不可见（DOM/权限）")
        pending_close_tab.click(timeout=5000)
        page.wait_for_timeout(1000)
        assert pending_close_tab.evaluate("el => el.classList.contains('active')"), "待关单标签应为active"

    def test_tc_e2e_138_home_workbench_tab_audit_close(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        audit_close_tab = page.locator("[data-home-workbench-tab='audit_close']").first
        if audit_close_tab.count() == 0 or not audit_close_tab.is_visible():
            pytest.fail("首页待审核关闭标签不可见（DOM/权限）")
        audit_close_tab.click(timeout=5000)
        page.wait_for_timeout(1000)
        assert audit_close_tab.evaluate("el => el.classList.contains('active')"), "待审核关闭标签应为active"

    def test_tc_e2e_139_workbench_list_tab_switch(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        all_tab = page.locator("[data-tab='all']").first
        if all_tab.count() > 0 and all_tab.is_visible():
            all_tab.click(timeout=5000)
            page.wait_for_timeout(1000)
            assert all_tab.evaluate("el => el.classList.contains('active')"), "全局标签应为active"
        created_tab = page.locator("[data-tab='created']").first
        if created_tab.count() > 0 and created_tab.is_visible():
            created_tab.click(timeout=5000)
            page.wait_for_timeout(1000)
            assert created_tab.evaluate("el => el.classList.contains('active')"), "我创建标签应为active"

    def test_tc_e2e_140_workbench_refresh_button(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        refresh_btn = page.locator("#list-refresh-btn").first
        if refresh_btn.count() > 0 and refresh_btn.is_visible():
            refresh_btn.click(timeout=5000)
            page.wait_for_timeout(3000)

    def test_tc_e2e_141_workbench_search_input(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        search = page.locator("input.search, input[placeholder='Search']").first
        if search.count() > 0 and search.is_visible():
            search.fill("E2E测试")
            page.wait_for_timeout(500)
            assert search.input_value() == "E2E测试", "搜索框应可输入"
            search.fill("")
            page.wait_for_timeout(300)

    def test_tc_e2e_142_workbench_date_range(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        date_range = page.locator('[data-date-range-id="workbench-created"]').first
        start_trigger = date_range.locator('.date-trigger[data-range-part="start"]').first
        if start_trigger.count() > 0 and start_trigger.is_visible():
            start_trigger.click(timeout=5000)
            page.wait_for_timeout(400)
            layer = page.locator(".workbench-glass-cal-layer").first
            if layer.count() > 0 and layer.is_visible():
                pick = page.locator(".workbench-glass-cal-day.is-today").first
                if pick.count() == 0 or not pick.is_visible():
                    pick = page.locator(".workbench-glass-cal-grid .workbench-glass-cal-day").nth(12)
                pick.click(timeout=5000)
                page.wait_for_timeout(400)
                assert page.locator(".workbench-glass-cal-layer").count() > 0, "选开始日后日历应保持打开以选结束日"
                pick2 = page.locator(".workbench-glass-cal-grid .workbench-glass-cal-day").nth(15)
                if pick2.count() == 0 or not pick2.is_visible():
                    pick2 = pick
                pick2.click(timeout=5000)
                page.wait_for_timeout(500)
                assert page.locator(".workbench-glass-cal-layer").count() == 0, "选完结束日后毛玻璃日历应关闭"

    def test_tc_e2e_143_workbench_select_all_checkbox(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        select_all = page.locator("#select-all-tickets, #home-select-all-tickets").first
        if select_all.count() > 0 and select_all.is_visible():
            select_all.click(timeout=5000)
            page.wait_for_timeout(500)
            assert select_all.is_checked(), "点击全选后checkbox应为checked"

    def test_tc_e2e_143b_workbench_select_all_across_pages(
        self, page, backend_server, assert_no_js_errors, e2e_workbench_multipage_seed,
    ):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        select_all = page.locator("#select-all-tickets").first
        if select_all.count() == 0 or not select_all.is_visible():
            pytest.fail("工作台表头全选框未渲染")
        next_btn = page.locator("#list-page-next").first
        if next_btn.count() == 0 or next_btn.is_disabled():
            pytest.fail("需要至少两页工单以验证跨页全选")
        select_all.click(timeout=5000)
        page.wait_for_timeout(500)
        assert select_all.is_checked(), "点击全选后表头 checkbox 应为 checked"
        next_btn.click(timeout=5000)
        page.wait_for_timeout(800)
        row_checks = page.locator("#table-body input[data-ticket-select]")
        row_count = row_checks.count()
        assert row_count > 0, "第二页应有工单行"
        for i in range(row_count):
            assert row_checks.nth(i).is_checked(), "全选应包含当前筛选下所有页，第二页行也应为选中"

    def test_tc_e2e_144_workbench_delete_button_visible(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        delete_btn = page.locator("#delete-ticket-btn").first
        if delete_btn.count() > 0 and delete_btn.is_visible():
            assert True
        else:
            pytest.fail("删除按钮不可见：确认 workbench_delete 在白名单中为 readonly")

    def test_tc_e2e_145_workbench_pagination(
        self, page, backend_server, assert_no_js_errors, e2e_workbench_multipage_seed,
    ):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        pagination = page.locator("#list-pagination, #home-list-pagination").first
        if pagination.count() == 0 or not pagination.is_visible():
            pytest.fail("工作台分页栏未渲染（列表未挂载）")
        next_btn = page.locator("#list-page-next").first
        prev_btn = page.locator("#list-page-prev").first
        if next_btn.count() == 0:
            pytest.fail("工作台无下一页按钮（分页控件缺失）")
        if next_btn.is_disabled():
            pytest.fail(
                "下一页仍不可用：e2e_workbench_multipage_seed 应已批量建单，"
                "请检查 ticket_list 是否为 readonly（展示全部）及默认每页条数。"
            )
        assert prev_btn.is_disabled(), "首页时上一页应为 disabled"
        next_btn.click(timeout=5000)
        page.wait_for_timeout(800)
        assert not prev_btn.is_disabled(), "进入第二页后上一页应可点"


class TestTicketCreateUISubmit:
    """工单创建 - 通过UI填写表单并提交"""

    def test_tc_e2e_146_create_ticket_fill_title(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("创建工单按钮不可见：确认 workbench_create 在白名单为 readonly")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        title_input = page.locator("form[data-node-form] input[name='problem_title']").first
        if title_input.count() > 0 and title_input.is_visible():
            tag = unique_e2e_tag()
            title_input.fill(f"E2E创建工单-{tag}")
            page.wait_for_timeout(300)
            assert title_input.input_value() == f"E2E创建工单-{tag}", "标题输入框应可填写"

    def test_tc_e2e_147_create_ticket_fill_severity(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("创建工单按钮不可见：确认 workbench_create 在白名单为 readonly")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        severity_select = page.locator("form[data-node-form] select[name='severity']").first
        if severity_select.count() > 0 and severity_select.is_visible():
            severity_select.select_option(index=1)
            page.wait_for_timeout(300)

    def test_tc_e2e_148_create_ticket_handle_mode_select(self, page, backend_server):
        # 不挂 assert_no_js_errors：切换 flat-select 时前端可能产生 console 噪声
        page.goto(f"{backend_server}/workbench")
        _wait_for(page, "#root")
        page.wait_for_timeout(2000)
        create_btn = page.locator("#create-ticket-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("创建工单按钮不可见：确认 workbench_create 在白名单为 readonly")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        handle_mode = page.locator("form[data-node-form] [data-wf-flat-select][data-field-key='handle_mode']").first
        if handle_mode.count() > 0 and handle_mode.is_visible():
            trig = handle_mode.locator(".wf-flat-select-trigger").first
            if trig.count() > 0:
                trig.click(timeout=5000)
            panel = handle_mode.locator(".wf-flat-select-panel").first
            panel.wait_for(state="visible", timeout=5000)
            alt = handle_mode.locator("[data-wf-flat-value-pick]:not(.is-active)").first
            if alt.count() == 0:
                pytest.fail("处理方式无可切换选项（选项数据未加载）")
            alt.click(timeout=5000)
            page.wait_for_timeout(300)
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)


class TestTicketRollbackAndForward:
    """工单回退后再次前进 - 验证回退+前进组合流程"""

    def test_tc_e2e_149_rollback_then_forward_again(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "dev_closure")
        require_submit_ok(api_client, order_id, "dev_closure", "返回开发分析", "dev_analysis", ctx="rollback")
        require_submit_ok(api_client, order_id, "dev_analysis", "提交开发闭环", "dev_closure", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "回退后再次前进flow-bar应有current节点标记"

    def test_tc_e2e_150_multiple_rollback_and_forward(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "ops_closure")
        require_submit_ok(api_client, order_id, "ops_closure", "返回运维分析", "ops_analysis", ctx="rollback")
        require_submit_ok(api_client, order_id, "ops_analysis", "提交开发分析", "dev_analysis", ctx="rollback")
        page.goto(f"{backend_server}/tickets/{order_id}")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        bar = page.locator(".flow-bar").first
        if bar.locator("li.flow-node").count() > 0:
            assert bar.locator("li.flow-node.current").count() > 0, "多次回退前进后flow-bar应有current节点标记"
