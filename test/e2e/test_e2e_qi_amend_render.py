import json
import os

import psycopg
import pytest

pytestmark = pytest.mark.e2e

QI_NO = "E2E-AMEND-RENDER"
DOMAIN = "SQL引擎"
MODULE = "驱动/JDBC"


def _seed_qi_at_review(dsn):
    """造一条停在 review、propose 已完成（带领域+模块、created_by=test_admin）的 QI，返回 id。"""
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
        conn.execute(
            """INSERT INTO qi_request
               (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                priority, domain, module_feature, planned_version, reviewer,
                current_stage, current_status, creator_id, creator_name)
               VALUES (%s,'特性加固','测试管理员 test_admin','amend渲染测试','','<p>测试</p>','',
                       '中',%s,%s,'','测试管理员 test_admin',
                       'review','in_progress','test_admin','测试管理员 test_admin')""",
            (QI_NO, DOMAIN, MODULE),
        )
        req_id = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
        ps = conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed') RETURNING id",
            (req_id,),
        ).fetchone()
        conn.execute(
            """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
               VALUES (%s,%s,'propose',%s::jsonb, FALSE, 'test_admin')""",
            (int(ps[0]), req_id, json.dumps({
                "category": "特性加固", "title": "amend渲染测试", "description": "<p>测试</p>",
                "priority": "中", "reviewer": "测试管理员 test_admin",
                "domain": DOMAIN, "module_feature": MODULE,
            })),
        )
        conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')",
            (req_id,),
        )
        conn.commit()
        return req_id


def _cleanup(dsn):
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
        conn.commit()


def test_qi_amend_propose_domain_and_cascader(page, backend_server, assert_no_js_errors):
    """走到评审后，提出人(创建人)修订提出阶段：领域回显已存值(非 '--')、模块&特性为级联(非文本框)。"""
    dsn = os.environ["DATABASE_URL"]
    req_id = _seed_qi_at_review(dsn)
    try:
        page.goto(f"{backend_server}/qi/{req_id}")
        page.wait_for_selector("#root", timeout=15000)
        # 领域 select 异步填充后应恢复已存值（覆盖修复①：曾显示 '--'）
        page.wait_for_function(
            """() => { const s = document.getElementById('qi-amend-propose-domain');
                      return s && s.tagName === 'SELECT' && s.value === '%s'; }""" % DOMAIN,
            timeout=10000,
        )
        domain_val = page.eval_on_selector("#qi-amend-propose-domain", "el => el.value")
        assert domain_val == DOMAIN, f"amend 提出阶段领域应回显 '{DOMAIN}'，实际 '{domain_val}'"

        # 模块&特性应为级联组件（覆盖修复②：曾渲染成文本框）
        wrap = page.locator('#qi-flow-panel .cascade-cascader[data-cascade-field="module_feature"]')
        assert wrap.count() > 0, "amend 提出阶段模块&特性应为级联组件，而非文本框"
        hidden_val = page.eval_on_selector(
            '#qi-flow-panel .cascade-cascader[data-cascade-field="module_feature"] [data-cascade-hidden]',
            "el => el.value",
        )
        assert hidden_val == MODULE, f"模块级联应回显已存值 '{MODULE}'，实际 '{hidden_val}'"
    finally:
        _cleanup(dsn)


QI_NO_RICH = "E2E-RICHTEXT-REPRO"
HTML_DESC = "<div><span>测试HTML标签</span></div>"


def _seed_qi_html_desc_readonly(dsn):
    """造一条停在 review、提出人=test_user01(非 test_admin)、详细描述为 HTML 的 QI，返回 id。
    test_admin 打开时为非处理人 → 提出阶段只读，复现富文本标签问题。"""
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO_RICH,))
        conn.execute(
            """INSERT INTO qi_request
               (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                priority, domain, module_feature, planned_version, reviewer,
                current_stage, current_status, creator_id, creator_name)
               VALUES (%s,'特性加固','测试用户01 test_user01','富文本回显测试','',%s,'',
                       '中','','','','测试用户01 test_user01',
                       'review','in_progress','test_user01','测试用户01 test_user01')""",
            (QI_NO_RICH, HTML_DESC),
        )
        req_id = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO_RICH,)).fetchone()[0])
        ps = conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'propose',1,'completed') RETURNING id",
            (req_id,),
        ).fetchone()
        conn.execute(
            """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
               VALUES (%s,%s,'propose',%s::jsonb, FALSE, 'test_user01')""",
            (int(ps[0]), req_id, json.dumps({
                "category": "特性加固", "title": "富文本回显测试",
                "description": HTML_DESC, "priority": "中",
                "reviewer": "测试用户01 test_user01", "domain": "", "module_feature": "",
            })),
        )
        conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status) VALUES (%s,'review',1,'pending')",
            (req_id,),
        )
        conn.commit()
        return req_id


class TestQiReadonlyRichtextRender:
    """只读视图富文本(详细描述)应渲染 HTML，不显示 <div><span> 原始标签。"""

    def test_readonly_richtext_renders_html_not_tags(self, page, backend_server, assert_no_js_errors):
        dsn = os.environ["DATABASE_URL"]
        req_id = _seed_qi_html_desc_readonly(dsn)
        try:
            # 以 test_admin（非提出人）打开 → 提出阶段为只读
            page.goto(f"{backend_server}/qi/{req_id}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            # 修复前：详细描述渲染为 <textarea>，HTML 被转义后当文本显示 <div><span> 标签
            desc_textarea = page.locator(
                '.problem-field:has(label[data-field-label="description"]) textarea'
            )
            assert desc_textarea.count() == 0, (
                "只读详细描述不应渲染为 textarea（会把 HTML 当文本显示 <div><span> 标签）"
            )
            # 修复后：渲染为 HTML（readonly-rich div），可见文本不含原始标签
            desc_div = page.locator(
                '.problem-field:has(label[data-field-label="description"]) .readonly-rich,'
                '.problem-field:has(label[data-field-label="description"]) .readonly-value'
            )
            assert desc_div.count() > 0, "只读详细描述应渲染为 HTML(div)"
            text = desc_div.first.inner_text()
            assert "<div>" not in text and "<span>" not in text, (
                f"只读详细描述不应显示原始 HTML 标签: {text[:80]}"
            )
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO_RICH,))
                conn.commit()


def _seed_qi_for_transfer(dsn, stage, qi_no):
    """造一条停在指定阶段、handler=admin 的 QI（admin 可在浏览器中作为当前处理人操作），返回 id。"""
    import json
    stage_order = ["propose", "review", "analysis", "closure", "acceptance"]
    idx = stage_order.index(stage)
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qi_no,))
        status = "in_progress"
        conn.execute(
            """INSERT INTO qi_request
               (qi_no, category, proposer, title, description, expected_goal, priority, reviewer,
                current_stage, current_status, creator_id, creator_name)
               VALUES (%s,'特性加固','管理员 admin','转单测试','d','','中','管理员 admin',
                       %s,%s,'admin','管理员 admin')""",
            (qi_no, stage, status),
        )
        rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (qi_no,)).fetchone()[0])
        for i, sk in enumerate(stage_order[:idx + 1]):
            st = "in_progress" if sk == stage else "completed"
            conn.execute(
                "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) VALUES (%s,%s,1,%s,%s)",
                (rid, sk, st, "管理员 admin" if sk in ("analysis", "closure") else ""),
            )
        conn.commit()
        return rid


class TestQiTransferE2E:
    """每个阶段的转单 e2e：按钮可见 + API 转单成功。"""

    def test_transfer_button_visible_and_transfer_works(self, page, backend_server, assert_no_js_errors):
        """review/analysis/closure/acceptance 四个阶段：转单按钮可见 + 转单 API 成功。"""
        import os
        dsn = os.environ["DATABASE_URL"]
        stages = [
            ("review", "TEST-E2E-TR-REV"),
            ("analysis", "TEST-E2E-TR-ANA"),
            ("closure", "TEST-E2E-TR-CLO"),
            ("acceptance", "TEST-E2E-TR-ACC"),
        ]
        for stage, qi_no in stages:
            rid = _seed_qi_for_transfer(dsn, stage, qi_no)
            try:
                # 浏览器打开 → 转单按钮应可见
                page.goto(f"{backend_server}/qi/{rid}")
                page.wait_for_selector("#root", timeout=15000)
                page.wait_for_timeout(3000)
                transfer_btn = page.locator(f"button:has-text('转单')")
                assert transfer_btn.count() > 0, f"[{stage}] 转单按钮应可见"

                # 通过 API 转单（弹窗 prompt 在 Playwright 中不好操作，直接验 API）
                resp = page.request.post(
                    f"{backend_server}/api/qi/{rid}/transfer",
                    data=json.dumps({"operator_id": "admin", "transfer_to": "测试用户01 test_user01"}),
                    headers={"Content-Type": "application/json"},
                )
                assert resp.status == 200, f"[{stage}] 转单 API 应 200，实际 {resp.status}: {resp.text()[:200]}"
            finally:
                with psycopg.connect(dsn) as conn:
                    conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (qi_no,))
                    conn.commit()


class TestQiTransferPickerE2E:
    """转单弹窗的下拉搜索选择器交互验证。"""

    def test_transfer_dropdown_picker_works(self, page, backend_server, assert_no_js_errors):
        """打开转单弹窗 → 搜索候选人 → 下拉出现 → 选中后确认按钮激活。"""
        import os
        dsn = os.environ["DATABASE_URL"]
        rid = _seed_qi_for_transfer(dsn, "review", "TEST-E2E-TR-PICK")
        try:
            page.goto(f"{backend_server}/qi/{rid}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            # 点转单按钮
            page.locator("button:has-text('转单')").first.click(timeout=5000)
            page.wait_for_selector("#qi-transfer-mask", timeout=5000)
            # 确认按钮初始禁用
            confirm_btn = page.locator("#qi-transfer-confirm")
            assert confirm_btn.is_disabled(), "确认按钮初始应禁用"
            # 聚焦搜索框 → 下拉应出现
            picker = page.locator("#qi-transfer-mask .qi-person-input")
            picker.click(timeout=3000)
            page.wait_for_selector(".qi-person-suggest", timeout=5000)
            suggest_visible = page.locator(".qi-person-suggest").count() > 0
            assert suggest_visible, "搜索下拉应出现"
            # 输入搜索 → 下拉应过滤
            picker.fill("test")
            page.wait_for_timeout(500)
            # 选中第一个候选人
            first_item = page.locator(".qi-person-suggest .qi-person-item").first
            if first_item.count() > 0:
                first_item.click(timeout=3000)
                page.wait_for_timeout(300)
                # 选中后确认按钮应激活
                assert not confirm_btn.is_disabled(), "选中人后确认按钮应激活"
            # 关闭弹窗（取消）
            page.locator("#qi-transfer-cancel").click(timeout=3000)
            page.wait_for_timeout(300)
            assert page.locator("#qi-transfer-modal").count() == 0, "取消后弹窗应关闭"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-E2E-TR-PICK",))
                conn.commit()


class TestQiTransferModalNoMaskClose:
    """转单弹窗点遮罩不关闭，仅取消/转单成功才关闭。"""

    def test_mask_click_does_not_close_transfer_modal(self, page, backend_server, assert_no_js_errors):
        import os
        dsn = os.environ["DATABASE_URL"]
        rid = _seed_qi_for_transfer(dsn, "review", "TEST-E2E-TR-MASK")
        try:
            page.goto(f"{backend_server}/qi/{rid}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            # 打开转单弹窗
            page.locator("button:has-text('转单')").first.click(timeout=5000)
            page.wait_for_selector("#qi-transfer-mask", timeout=5000)
            assert page.locator("#qi-transfer-mask").count() > 0, "弹窗应已打开"
            # 关闭可能弹出的搜索下拉（避免拦截点击）
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            # 点击遮罩（弹窗外） → 弹窗不应关闭
            page.locator("#qi-transfer-mask").click(timeout=3000, force=True, position={"x": 5, "y": 5})
            page.wait_for_timeout(500)
            assert page.locator("#qi-transfer-mask").count() > 0, "点遮罩不应关闭转单弹窗"
            # 点取消 → 弹窗应关闭
            page.locator("#qi-transfer-cancel").first.click(timeout=3000)
            page.wait_for_timeout(300)
            assert page.locator("#qi-transfer-mask").count() == 0, "点取消应关闭转单弹窗"
        finally:
            with psycopg.connect(dsn) as conn:
                conn.execute("DELETE FROM qi_request WHERE qi_no=%s", ("TEST-E2E-TR-MASK",))
                conn.commit()
