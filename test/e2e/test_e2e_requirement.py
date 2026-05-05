import time
import uuid

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _api_create_requirement(api_client, tag):
    resp = api_client.post("/api/requirements", json={
        "operator_id": "test_admin",
        "title": f"E2E需求-{tag}",
        "description": f"端到端测试自动创建-{tag}",
        "proposer": "测试提出人",
        "assignee": "测试责任人",
        "priority": 5,
        "category": "其他",
        "value": "质量加固",
    })
    if resp.status_code == 200:
        return resp.json().get("id")
    return None


def _api_delete_requirement(api_client, req_id):
    api_client.delete(f"/api/requirements/{req_id}", params={"operator_id": "test_admin"})


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


def _wait_req_row_visible(page, req_id, *, title_tag: str | None = None, timeout_ms: int = 25000):
    """列表默认按优先级分页，新建需求可能不在第一页；用标题关键词搜索缩窄结果后再等行挂载。"""
    rid = str(int(req_id))
    if title_tag:
        needle = f"E2E需求-{title_tag}"
        page.locator("#req-search-input").fill(needle)
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
    page.wait_for_selector(f".req-row[data-req-id='{rid}']", state="visible", timeout=timeout_ms)
    return page.locator(f".req-row[data-req-id='{rid}']").first


class TestRequirementPageLoad:
    """需求管理页面加载与布局"""

    def test_tc_e2e_201_requirement_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        panel = page.locator("#req-management-page")
        assert panel.count() > 0, "需求管理面板应存在"

    def test_tc_e2e_202_requirement_page_has_tabs(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        tabs = page.locator("[data-req-tab]")
        assert tabs.count() >= 3, "需求管理页面应有至少3个标签页"

    def test_tc_e2e_203_requirement_page_has_table(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        table = page.locator(".req-table").first
        assert table.is_visible(), "需求管理页面应有需求列表表格"

    def test_tc_e2e_204_requirement_page_has_search(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        search = page.locator("#req-search-input").first
        assert search.is_visible(), "需求管理页面应有搜索框"


class TestRequirementTabSwitch:
    """需求管理标签切换"""

    def test_tc_e2e_205_switch_to_mine_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        mine_tab = page.locator("[data-req-tab='mine']").first
        if mine_tab.count() == 0 or not mine_tab.is_visible():
            pytest.fail("我提出的标签页不可见")
        mine_tab.click(timeout=5000)
        page.wait_for_timeout(1500)
        assert mine_tab.evaluate("el => el.classList.contains('active')"), "点击后标签应为active"

    def test_tc_e2e_206_switch_to_assigned_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        assigned_tab = page.locator("[data-req-tab='assigned']").first
        if assigned_tab.count() == 0 or not assigned_tab.is_visible():
            pytest.fail("我负责的标签页不可见")
        assigned_tab.click(timeout=5000)
        page.wait_for_timeout(1500)
        assert assigned_tab.evaluate("el => el.classList.contains('active')"), "点击后标签应为active"

    def test_tc_e2e_207_switch_to_analytics_tab(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        analytics_tab = page.locator("[data-req-tab='analytics']").first
        if analytics_tab.count() == 0 or not analytics_tab.is_visible():
            pytest.fail("分析标签页不可见")
        analytics_tab.click(timeout=5000)
        page.wait_for_timeout(2000)
        kpi_grid = page.locator(".req-analytics-kpi-grid").first
        if kpi_grid.count() > 0:
            assert kpi_grid.is_visible(), "分析标签页应显示KPI卡片"


class TestRequirementCreateViaUI:
    """需求创建 - 通过UI操作"""

    def test_tc_e2e_208_create_requirement_modal_open(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        create_btn = page.locator("#req-create-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("新建按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        modal = page.locator("#req-create-mask").first
        assert modal.is_visible(), "点击新建后应弹出创建需求弹窗"

    def test_tc_e2e_209_create_requirement_modal_has_fields(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        create_btn = page.locator("#req-create-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("新建按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        title_input = page.locator("#req-create-title").first
        assert title_input.is_visible(), "弹窗中应有标题输入框"
        desc_input = page.locator("#req-create-desc").first
        assert desc_input.is_visible(), "弹窗中应有描述输入框"
        proposer_input = page.locator("#req-create-proposer").first
        assert proposer_input.is_visible(), "弹窗中应有提出人输入框"
        submit_btn = page.locator("#req-create-submit-btn").first
        assert submit_btn.is_visible(), "弹窗中应有提交按钮"

    def test_tc_e2e_210_create_requirement_fill_and_cancel(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        create_btn = page.locator("#req-create-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("新建按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        tag = _unique_tag()
        title_input = page.locator("#req-create-title").first
        title_input.fill(f"E2E需求-{tag}")
        desc_input = page.locator("#req-create-desc").first
        desc_input.fill(f"端到端测试-{tag}")
        proposer_input = page.locator("#req-create-proposer").first
        proposer_input.fill("测试提出人")
        cancel_btn = page.locator("#req-create-cancel-btn").first
        if cancel_btn.count() > 0 and cancel_btn.is_visible():
            cancel_btn.click(timeout=5000)
            page.wait_for_timeout(1000)
            modal = page.locator("#req-create-mask").first
            assert modal.count() == 0 or not modal.is_visible(), "点击取消后弹窗应关闭"

    def test_tc_e2e_211_create_requirement_submit(self, page, backend_server, api_client, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        create_btn = page.locator("#req-create-btn").first
        if create_btn.count() == 0 or not create_btn.is_visible():
            pytest.fail("新建按钮不可见（权限限制）")
        create_btn.click(timeout=5000)
        page.wait_for_timeout(1500)
        tag = _unique_tag()
        title_input = page.locator("#req-create-title").first
        title_input.fill(f"E2E需求提交-{tag}")
        desc_input = page.locator("#req-create-desc").first
        desc_input.fill(f"端到端提交测试-{tag}")
        proposer_input = page.locator("#req-create-proposer").first
        proposer_input.fill("测试提出人")
        assignee_input = page.locator("#req-create-assignee").first
        assert assignee_input.count() > 0, "创建需求弹窗应有责任人字段"
        assignee_input.fill("测试责任人")
        # 列表按 priority ASC 再 created_at DESC；优先级 5 易落到后页，改为 1 使新行尽量出现在首屏
        page.locator("#req-create-priority").first.fill("1")
        submit_btn = page.locator("#req-create-submit-btn").first

        def _dismiss_dialog(d):
            try:
                d.accept()
            except Exception:
                pass

        page.once("dialog", _dismiss_dialog)
        submit_btn.click(timeout=5000)
        page.wait_for_selector("#req-create-mask", state="detached", timeout=20000)
        page.wait_for_timeout(1500)
        all_tab = page.locator("[data-req-tab='all']").first
        if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
            all_tab.click(timeout=5000)
            page.wait_for_timeout(1000)
        page.wait_for_function(
            """(t) => {
              const cells = document.querySelectorAll('.req-title-cell');
              return [...cells].some((c) => c.textContent && c.textContent.includes(t));
            }""",
            arg=tag,
            timeout=25000,
        )
        title_cell = page.locator(".req-title-cell").filter(has_text=tag).first
        assert title_cell.is_visible()
        assert tag in title_cell.inner_text(), f"提交需求后列表应显示新需求 {tag}"


class TestRequirementDetailViaUI:
    """需求详情 - 通过API准备数据，UI验证"""

    def test_tc_e2e_212_click_requirement_row_opens_detail(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        req_id = _api_create_requirement(api_client, tag)
        if not req_id:
            pytest.fail("无法通过API创建需求")
        try:
            page.goto(f"{backend_server}/requirements", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            all_tab = page.locator("[data-req-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(800)
            req_row = _wait_req_row_visible(page, req_id, title_tag=tag)
            req_row.click(timeout=5000)
            page.wait_for_timeout(2000)
            detail_modal = page.locator("#req-detail-mask").first
            assert detail_modal.is_visible(), "点击需求行后应弹出详情弹窗"
        finally:
            _api_delete_requirement(api_client, req_id)

    def test_tc_e2e_213_requirement_detail_shows_info(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        req_id = _api_create_requirement(api_client, tag)
        if not req_id:
            pytest.fail("无法通过API创建需求")
        try:
            page.goto(f"{backend_server}/requirements", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            all_tab = page.locator("[data-req-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(800)
            req_row = _wait_req_row_visible(page, req_id, title_tag=tag)
            req_row.click(timeout=5000)
            page.wait_for_timeout(2000)
            detail_body = page.locator(".req-detail-meta").first
            if detail_body.count() > 0:
                assert detail_body.is_visible(), "需求详情应显示元信息"
            close_btn = page.locator("#req-detail-close-btn").first
            if close_btn.count() > 0 and close_btn.is_visible():
                close_btn.click(timeout=5000)
                page.wait_for_timeout(1000)
        finally:
            _api_delete_requirement(api_client, req_id)

    def test_tc_e2e_214_requirement_status_forward(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        req_id = _api_create_requirement(api_client, tag)
        if not req_id:
            pytest.fail("无法通过API创建需求")
        try:
            api_client.patch(f"/api/requirements/{req_id}", json={"status": "待RAT决策", "operator_id": "test_admin"})
            page.goto(f"{backend_server}/requirements", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            all_tab = page.locator("[data-req-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(800)
            req_row = _wait_req_row_visible(page, req_id, title_tag=tag)
            req_row.click(timeout=5000)
            page.wait_for_timeout(2000)
            forward_btn = page.locator("[data-req-status-forward]").first
            if forward_btn.count() > 0 and forward_btn.is_visible():
                forward_btn.click(timeout=5000)
                page.wait_for_timeout(2000)
            close_btn = page.locator("#req-detail-close-btn").first
            if close_btn.count() > 0 and close_btn.is_visible():
                close_btn.click(timeout=5000)
        finally:
            _api_delete_requirement(api_client, req_id)

    def test_tc_e2e_215_requirement_full_status_flow(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        req_id = _api_create_requirement(api_client, tag)
        if not req_id:
            pytest.fail("无法通过API创建需求")
        try:
            statuses = ["待RAT决策", "开发中", "已经落地"]
            for s in statuses:
                resp = api_client.patch(f"/api/requirements/{req_id}", json={"status": s, "operator_id": "test_admin"})
                if resp.status_code != 200:
                    pytest.fail(f"需求状态流转至 {s} 失败")
            page.goto(f"{backend_server}/requirements")
            _wait_for(page, "#root")
            page.wait_for_timeout(3000)
            all_tab = page.locator("[data-req-tab='all']").first
            if all_tab.count() > 0 and not all_tab.evaluate("el => el.classList.contains('active')"):
                all_tab.click(timeout=5000)
                page.wait_for_timeout(1500)
            req_row = page.locator(f".req-row[data-req-id='{req_id}']").first
            if req_row.count() > 0 and req_row.is_visible():
                req_row.click(timeout=5000)
                page.wait_for_timeout(2000)
                detail_body = page.locator(".req-detail-meta").first
                if detail_body.count() > 0:
                    assert "已经落地" in detail_body.inner_text(), "需求详情应显示最终状态"
                close_btn = page.locator("#req-detail-close-btn").first
                if close_btn.count() > 0 and close_btn.is_visible():
                    close_btn.click(timeout=5000)
        finally:
            _api_delete_requirement(api_client, req_id)


class TestRequirementSearchInteraction:
    """需求搜索交互"""

    def test_tc_e2e_216_requirement_search_input(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        search = page.locator("#req-search-input").first
        if search.count() == 0 or not search.is_visible():
            pytest.fail("搜索框不可见")
        search.fill("E2E测试")
        page.wait_for_timeout(1000)
        assert search.input_value() == "E2E测试", "搜索框应可输入"
        search.fill("")
        page.wait_for_timeout(500)

    def test_tc_e2e_217_requirement_pagination(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/requirements")
        _wait_for(page, "#root")
        page.wait_for_timeout(3000)
        pagination = page.locator("#req-list-pagination").first
        if pagination.count() > 0 and pagination.is_visible():
            page_size_select = page.locator("#req-page-size").first
            if page_size_select.count() > 0:
                page_size_select.select_option("10")
                page.wait_for_timeout(1000)
