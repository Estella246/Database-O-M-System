import pytest

from e2e_api import require_ticket_order_id, require_advance_to_node, unique_e2e_tag

pytestmark = pytest.mark.e2e


def _direct_child_labels(nodes):
    """领域下的一级目录（直接 children 的 label），与级联顶层一致。"""
    return [n.get("label") for n in (nodes or [])]


def _fetch_duty_tree(api_client):
    return api_client.get("/api/params/duty-field/tree", params={"operator_id": "admin"}).json()


def _find_two_level_target(tree):
    """在责任田树中找一个「领域 → 一级目录(非叶子) → 二级叶子」组合，用于驱动级联。"""
    for dom in (tree.get("nodes") or []):
        for ch in (dom.get("children") or []):
            if ch.get("children"):
                leaf = ch["children"][0].get("label")
                if leaf:
                    return (dom["label"], ch["label"], leaf)
    return None


def _module_first_level(page, wrap_selector):
    """打开模块级联面板，返回一级目录(depth-0)的 data-label 列表。"""
    page.locator(f'{wrap_selector} .cascade-cascader-trigger').first.click(timeout=5000)
    page.wait_for_selector(f'{wrap_selector} .cascade-cascader-item[data-depth="0"]', timeout=5000)
    return page.eval_on_selector_all(
        f'{wrap_selector} .cascade-cascader-item[data-depth="0"]',
        "els => els.map(e => e.getAttribute('data-label'))",
    )


def _pick_module_path(page, wrap_selector, top_label, leaf_label):
    """驱动级联：开面板 → 点一级目录(展开二级) → 点二级叶子(提交)。"""
    page.locator(f'{wrap_selector} .cascade-cascader-trigger').first.click(timeout=5000)
    page.wait_for_selector(f'{wrap_selector} .cascade-cascader-item[data-depth="0"]', timeout=5000)
    page.locator(
        f'{wrap_selector} .cascade-cascader-item[data-depth="0"][data-label="{top_label}"]'
    ).first.click(timeout=5000)
    page.wait_for_selector(f'{wrap_selector} .cascade-cascader-item[data-depth="1"]', timeout=5000)
    page.locator(
        f'{wrap_selector} .cascade-cascader-item[data-depth="1"][data-label="{leaf_label}"]'
    ).first.click(timeout=5000)
    page.wait_for_timeout(400)
    return page.eval_on_selector(f'{wrap_selector} [data-cascade-hidden]', 'el => el.value')


def _open_ticket_qi_modal(page, backend_server, api_client):
    tag = unique_e2e_tag()
    order_id = require_ticket_order_id(api_client, tag)
    require_advance_to_node(api_client, order_id, "dev_analysis")
    page.goto(f"{backend_server}/tickets/{order_id}")
    page.wait_for_selector("#root", timeout=15000)
    page.wait_for_timeout(3000)
    page.locator(".ticket-qi-create-btn").first.dispatch_event("click")
    page.wait_for_selector("#ticket-qi-domain", timeout=5000)
    page.wait_for_function(
        "() => document.querySelectorAll('#ticket-qi-domain option').length > 1", timeout=10000
    )
    domains = page.eval_on_selector_all(
        "#ticket-qi-domain option", "els => els.map(e => e.value).filter(Boolean)"
    )
    return (domains[0] if domains else "")


def _open_qi_new_form(page, backend_server):
    page.goto(f"{backend_server}/qi")
    page.wait_for_selector("#root", timeout=15000)
    page.wait_for_timeout(2500)
    page.locator("#qi-create-btn").first.dispatch_event("click")
    page.wait_for_selector("#qi-new-category", timeout=5000)
    page.wait_for_function(
        "() => document.querySelectorAll('#qi-new-domain option').length > 1", timeout=10000
    )
    domains = page.eval_on_selector_all(
        "#qi-new-domain option", "els => els.map(e => e.value).filter(Boolean)"
    )
    return (domains[0] if domains else "")


TICKET_MODULE_WRAP = '.cascade-cascader[data-cascade-field="module"]'
QI_MODULE_WRAP = '.cascade-cascader[data-cascade-field="module_feature"]'


class TestTicketQiCreateDomainSource:
    """工单「新增改进建议」弹窗领域/模块&特性须与责任田树同源（模块为级联，根=领域 children）。"""

    def test_ticket_qi_create_domain_matches_duty_tree(self, page, backend_server, api_client, assert_no_js_errors):
        tag = unique_e2e_tag()
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "dev_analysis")
        page.goto(f"{backend_server}/tickets/{order_id}")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(3000)
        page.locator(".ticket-qi-create-btn").first.dispatch_event("click")
        page.wait_for_selector("#ticket-qi-domain", timeout=5000)
        page.wait_for_function(
            "() => document.querySelectorAll('#ticket-qi-domain option').length > 1", timeout=10000
        )
        modal_domains = page.eval_on_selector_all(
            "#ticket-qi-domain option", "els => els.map(e => e.value).filter(Boolean)"
        )
        tree = _fetch_duty_tree(api_client)
        top_labels = [n["label"] for n in (tree.get("nodes") or [])]
        assert modal_domains == top_labels, f"领域下拉应与责任田树第一层一致: {modal_domains} vs {top_labels}"

        # 模块级联：选首个领域 → 开面板 → 一级目录 == 该领域直接 children（不再扁平化后代）
        if top_labels:
            first_domain = top_labels[0]
            page.select_option("#ticket-qi-domain", first_domain)
            page.wait_for_timeout(500)
            top_node = next((n for n in tree["nodes"] if n["label"] == first_domain), {})
            modal_modules = _module_first_level(page, TICKET_MODULE_WRAP)
            assert modal_modules == _direct_child_labels(top_node.get("children")), (
                f"模块级联一级目录应=领域直接 children: {modal_modules} vs {_direct_child_labels(top_node.get('children'))}"
            )


class TestQiCreateFieldsConsistency:
    """质量改进列表「新建」与工单页「新增改进建议」：分类/优先级/领域/模块 一致。"""

    def test_option_content_consistency(self, page, backend_server, api_client, assert_no_js_errors):
        first_domain = _open_ticket_qi_modal(page, backend_server, api_client)
        t_cat = page.eval_on_selector_all("#ticket-qi-category option", "els => els.map(e => e.value).filter(Boolean)")
        t_pri = page.eval_on_selector_all("#ticket-qi-priority option", "els => els.map(e => e.value).filter(Boolean)")
        t_dom = page.eval_on_selector_all("#ticket-qi-domain option", "els => els.map(e => e.value).filter(Boolean)")
        if first_domain:
            page.select_option("#ticket-qi-domain", first_domain)
            page.wait_for_timeout(500)
        # 模块为级联：读其一级目录
        t_mod = _module_first_level(page, TICKET_MODULE_WRAP) if first_domain else []

        _open_qi_new_form(page, backend_server)
        q_cat = page.eval_on_selector_all("#qi-new-category option", "els => els.map(e => e.value).filter(Boolean)")
        q_pri = page.eval_on_selector_all("#qi-new-priority option", "els => els.map(e => e.value).filter(Boolean)")
        q_dom = page.eval_on_selector_all("#qi-new-domain option", "els => els.map(e => e.value).filter(Boolean)")
        if first_domain:
            page.select_option("#qi-new-domain", first_domain)
            page.wait_for_timeout(500)
        q_mod = _module_first_level(page, QI_MODULE_WRAP) if first_domain else []

        assert t_cat == q_cat, f"分类选项不一致: {t_cat} vs {q_cat}"
        assert t_pri == q_pri, f"优先级选项不一致: {t_pri} vs {q_pri}"
        assert t_dom == q_dom, f"领域选项不一致: {t_dom} vs {q_dom}"
        assert t_mod == q_mod, f"模块级联一级目录不一致(领域={first_domain}): {t_mod} vs {q_mod}"

    def test_field_key_consistency(self, page, backend_server, api_client, assert_no_js_errors):
        """工单弹窗提交的字段键须是质量改进新建表单字段键的子集（同名字段）。"""
        page.on("dialog", lambda d: d.accept())
        _open_ticket_qi_modal(page, backend_server, api_client)
        page.fill("#ticket-qi-title", "一致性校验")
        page.fill("#ticket-qi-reviewer", "测试用户01 test_user01")
        page.eval_on_selector('[data-rich-key="desc"]', 'el => el.value = "consistency check"')
        with page.expect_request(lambda r: "/api/qi" in r.url and r.method == "POST") as req_info:
            page.locator("#ticket-qi-submit").first.dispatch_event("click")
        body = req_info.value.post_data_json or {}
        ticket_keys = set(body.keys()) - {"operator_id", "draft"}

        _open_qi_new_form(page, backend_server)
        qform_keys = set(
            page.eval_on_selector_all('[id^="qi-new-"]', "els => els.map(e => e.id.replace('qi-new-',''))")
        )
        extra = ticket_keys - qform_keys
        assert not extra, f"工单弹窗提交了新建表单没有的字段键: {extra}"


class TestQiModuleCascaderValue:
    """模块&特性级联取值=所选领域 children 起算的 "/" 路径（不含领域），两处表单一致。"""

    def test_cascader_path_value_and_parity(self, page, backend_server, api_client, assert_no_js_errors):
        tree = _fetch_duty_tree(api_client)
        target = _find_two_level_target(tree)
        assert target, "责任田树需至少一个「领域→一级目录(非叶子)→二级叶子」组合以驱动级联"
        domain_label, top_label, leaf_label = target
        expected = f"{top_label}/{leaf_label}"

        # 工单弹窗：选领域 → 驱动级联 → 断言 hidden 值
        _open_ticket_qi_modal(page, backend_server, api_client)
        page.select_option("#ticket-qi-domain", domain_label)
        page.wait_for_timeout(500)
        t_val = _pick_module_path(page, TICKET_MODULE_WRAP, top_label, leaf_label)
        assert t_val == expected, f"工单弹窗模块级联取值应为 {expected}，实际 {t_val}"

        # 质量改进新建表单：同领域同路径 → 断言 hidden 值一致
        _open_qi_new_form(page, backend_server)
        page.select_option("#qi-new-domain", domain_label)
        page.wait_for_timeout(500)
        q_val = _pick_module_path(page, QI_MODULE_WRAP, top_label, leaf_label)
        assert q_val == expected, f"新建表单模块级联取值应为 {expected}，实际 {q_val}"
        assert t_val == q_val, f"两处表单模块级联取值应一致: {t_val} vs {q_val}"


class TestQiCreateModalClose:
    """工单「新增改进建议」弹窗：点遮罩(非窗口)不关闭，只能点取消/暂存关闭。"""

    def test_mask_click_does_not_close_modal(self, page, backend_server, api_client, assert_no_js_errors):
        _open_ticket_qi_modal(page, backend_server, api_client)
        assert page.locator("#ticket-qi-modal-container").count() == 1, "弹窗应已打开"
        # 点击遮罩(非窗口)：弹窗不应关闭（修复前会关闭、丢失填写内容）
        page.eval_on_selector("#ticket-qi-mask", "el => el.click()")
        page.wait_for_timeout(300)
        assert page.locator("#ticket-qi-modal-container").count() == 1, "点击遮罩不应关闭弹窗"
        # 点「取消」：弹窗应关闭
        page.locator("#ticket-qi-cancel").first.click(timeout=5000)
        page.wait_for_timeout(300)
        assert page.locator("#ticket-qi-modal-container").count() == 0, "点取消应关闭弹窗"
