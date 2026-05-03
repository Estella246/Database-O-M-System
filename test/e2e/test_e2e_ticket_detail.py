import pytest

pytestmark = pytest.mark.e2e


class TestTicketDetailInteraction:

    def test_tc_e2e_018_ticket_list_page_no_js_errors(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=home")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)

    def test_tc_e2e_019_click_ticket_if_available(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=home")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        ticket_row = page.locator(".ticket-row").first
        if ticket_row.is_visible():
            ticket_row.click()
            page.wait_for_timeout(3000)

    def test_tc_e2e_020_workbench_tab_no_js_errors(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=ticket:workbench")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)

    def test_tc_e2e_021_workbench_click_ticket_if_available(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/?tab=ticket:workbench")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        ticket_row = page.locator(".ticket-row").first
        if ticket_row.is_visible():
            ticket_row.click()
            page.wait_for_timeout(3000)

    def test_tc_e2e_022_direct_ticket_detail_url(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/?tab=home")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        ticket_row = page.locator(".ticket-row").first
        if not ticket_row.is_visible():
            pytest.skip("No ticket data available for detail page test")
        order_id = ticket_row.get_attribute("data-order-id")
        if not order_id:
            pytest.skip("Could not get ticket order ID")
        page.goto(f"{backend_server}/?tab=ticket:{order_id}")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"工单详情页发现 {len(js_errors)} 个 JS 错误:\n" + "\n".join(js_errors)


class TestModalInteraction:

    def test_tc_e2e_023_create_ticket_button(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/?tab=home")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        create_btn = page.locator("button", has_text="新建工单").first
        if not create_btn.is_visible():
            pytest.skip("Create ticket button not visible")
        try:
            create_btn.click(timeout=5000)
        except Exception:
            create_btn.dispatch_event("click")
        page.wait_for_timeout(2000)
        modal_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            modal_errors.append(msg)
        assert modal_errors == [], f"新建工单弹窗发现 {len(modal_errors)} 个 JS 错误:\n" + "\n".join(modal_errors)
