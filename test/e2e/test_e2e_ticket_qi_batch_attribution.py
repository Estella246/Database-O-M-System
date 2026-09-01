"""工单闭环批量提交 QI 的「提交归属」端到端测试（缺陷修复验证）。

S1 静默版全链路：test_admin（桩 /api/auth/me 模拟其登录态）在工单节点建草稿 →
   工单到 ops_closure → admin 真实浏览器触发闭环提交（真实 saveNode→
   batchSubmitQiDraftsSilent 路径）→ 归属/评审人/编号断言 → 双视角 amend 按钮。
S2 手动版对齐：batchSubmitQiDrafts（无按钮渲染点，页面内动态 import 调用是唯一可测路径）
   → confirm 文案不含「评审人将默认为您本人」→ 评审人保持原值、归属=创建人。

运行：PYTEST_SKIP_AUTO_MIGRATE=1 + TEST_API_BASE_URL 照常（e2e pytestmark）。
"""
import json
import os

import psycopg
import pytest

from e2e_api import require_advance_to_node, require_submit_ok, require_ticket_order_id

pytestmark = pytest.mark.e2e

TITLE_PREFIX = "E2E-QI-ATTRIB-"
REVIEWER_DISP = "测试用户02 test_user02"   # 下一步处理人（与创建人/闭环人都不同）
# 创建人须满足：① 管理员角色（普通人员无权看工单节点表单）② 账号不含 "admin" 子串
# （前端 amend 按钮有 includes 松匹配，"test_admin" 会让闭环人也看到按钮——既有怪癖，
# 服务端 /save 门禁为精确匹配）。test_bulk_002 两条都满足。
CREATOR = ("test_bulk_002", "批量用户2")
TRIGGER = ("admin", "管理员")               # 运维闭环操作人


def _dsn():
    return os.environ["DATABASE_URL"]


def _ensure_reviewer_whitelist(api_client):
    """评审人白名单需含创建人/触发人/评审人（create/submit 都校验白名单）。"""
    api_client.post("/api/qi/candidates/reviewer", json={
        "operator_id": "admin",
        "accounts": [CREATOR[0], TRIGGER[0], "test_user01", "test_user02"],
    })


def _qi_row(title):
    with psycopg.connect(_dsn()) as conn:
        return conn.execute(
            """SELECT r.id, r.qi_no, r.current_status, r.current_stage, r.reviewer,
                      r.creator_id,
                      (SELECT fl.operator_id FROM qi_flow_log fl
                        WHERE fl.request_id = r.id AND fl.action = 'submitted'
                          AND fl.from_stage = 'propose' ORDER BY fl.id DESC LIMIT 1),
                      (SELECT sd.created_by FROM qi_stage_data sd
                        WHERE sd.request_id = r.id AND sd.stage_key = 'propose'
                          AND sd.draft = FALSE ORDER BY sd.created_at DESC LIMIT 1)
               FROM qi_request r WHERE r.title = %s""",
            (title,),
        ).fetchone()


_IDENTITY_ROUTE = "**/api/auth/me*"


def _stub_identity(page, account, user_name, group_name):
    """e2e 后端 SKIP_SSO_AUTH 下 /api/auth/me 恒返回 DEV_USER_ACCOUNT(admin)，且
    getCurrentOperator 优先 currentUser——浏览器永远以 admin 操作。只桩身份接口
    模拟 SSO 登录人切换，其余业务链路（建草稿/闭环提交/详情渲染）全部真实。"""
    page.route(_IDENTITY_ROUTE, lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({
            "success": True,
            "sso_user": {"lname": user_name, "userName": account,
                         "email": f"{account}@dev.local"},
            "local_user": {"account": account, "user_name": user_name,
                           "role_code": "管理员", "group_name": group_name},
            "w3Account": account,
        })))


def _unstub_identity(page):
    page.unroute(_IDENTITY_ROUTE)


def _cleanup(title):
    with psycopg.connect(_dsn()) as conn:
        conn.execute("DELETE FROM qi_request WHERE title = %s", (title,))
        conn.commit()


def _switch_operator(page, backend_server, account, name):
    page.goto(f"{backend_server}/", wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)
    page.evaluate(
        "([a, n]) => { window.localStorage.setItem('demo_operator_account', a);"
        "             window.localStorage.setItem('demo_operator_name', n); }",
        [account, name],
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)


def _open_node_panel(page, node_key):
    """当前节点表单在 <details class="flow-log"> 手风琴里，默认折叠，先展开再交互。"""
    page.locator(
        f'details.flow-log:has(form[data-node-key="{node_key}"][data-is-current-node="1"])'
    ).first.evaluate("d => { d.open = true; }")
    page.wait_for_timeout(300)


def _advance_to_ops_closure(api_client, order_id):
    """显式分步推进到 ops_closure：dev_analysis 的 is_quality_issue 选「否」，
    避开 dts_no 的 DTS/BUG 格式校验（通用填充 test_dts_no 会被 400 拦截）。"""
    require_advance_to_node(api_client, order_id, "dev_analysis")
    require_submit_ok(api_client, order_id, "dev_analysis", "提交开发闭环", "dev_closure",
                      extra_values={"is_quality_issue": "否"})
    require_submit_ok(api_client, order_id, "dev_closure", "提交运维闭环", "ops_closure")


def _fill_current_node_form(page, node_key):
    """尽力填充当前节点表单（文本/下拉）。闭环批量提交在 saveNode 最前置执行，
    节点提交本身的成败不影响 QI 归属断言，但填全可避免 400 噪音。
    下拉联动会触发局部重渲染（重渲染会冲掉已填值），循环填充直至收敛。"""
    form_sel = f'form[data-node-form="1"][data-node-key="{node_key}"][data-is-current-node="1"]'
    page.wait_for_selector(form_sel, timeout=15000)
    fill_js = """(sel) => {
      const form = document.querySelector(sel); if (!form) return;
      form.querySelectorAll('input[type=text]:not([readonly])').forEach(i => {
        if (i.value.trim()) return;
        const k = i.id + ' ' + (i.name || '');
        // 格式校验字段填合法值，保证节点提交本身也成功
        if (/dts_no|bug_no/.test(k)) i.value = 'DTS2026083112345';
        else if (/ecare/.test(k)) i.value = '12345678';
        else i.value = 'e2e归属验证';
      });
      form.querySelectorAll('input[type=date]').forEach(i => { if (!i.value) i.value = '2026-08-31'; });
      form.querySelectorAll('textarea').forEach(t => { if (!t.value.trim()) t.value = 'e2e归属验证'; });
      form.querySelectorAll('select').forEach(s => {
        if (s.value) return;
        const opt = [...s.options].find(o => o.value && o.value.trim());
        if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      // wf-flat-select（whitelist 字段自定义控件）：点选项按钮选中；有「否」优先选否
      // （选「是」会联动出 file 类必填字段 problem_report，需真实文件上传）
      form.querySelectorAll('[data-wf-flat-select]').forEach(w => {
        const active = w.querySelector('.wf-flat-select-item.is-active:not(.wf-flat-select-item--placeholder)');
        if (active) return;
        const btns = [...w.querySelectorAll('[data-wf-flat-value-pick]:not(.wf-flat-select-item--placeholder)')];
        if (!btns.length) return;
        const no = btns.find(b => (b.getAttribute('data-wf-flat-value-pick') || '').trim() === '否');
        (no || btns[0]).click();
      });
    }"""
    for _ in range(3):
        page.evaluate(fill_js, form_sel)
        page.wait_for_timeout(400)


class TestTicketQiBatchAttributionSilent:
    """S1：运维闭环静默批量提交 → 归属=草稿创建人。"""

    def test_silent_batch_attribution_and_amend_gate(self, page, backend_server, api_client, assert_no_js_errors):
        title = TITLE_PREFIX + "S1"
        _cleanup(title)
        _ensure_reviewer_whitelist(api_client)
        tag = os.environ.get("PYTEST_XDIST_WORKER", "") + title
        order_id = require_ticket_order_id(api_client, tag)
        require_advance_to_node(api_client, order_id, "dev_analysis")
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        try:
            # 1) 创建人 test_admin 在工单节点弹窗暂存草稿（桩身份接口模拟其登录态）
            _stub_identity(page, *CREATOR, "测试组")
            page.goto(f"{backend_server}/tickets/{order_id}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            _open_node_panel(page, "dev_analysis")
            page.locator(".ticket-qi-create-btn").first.click(timeout=5000)
            page.wait_for_selector("#ticket-qi-title", timeout=5000)
            page.fill("#ticket-qi-title", title)
            page.fill("#ticket-qi-desc", "<p>e2e归属验证描述</p>")
            page.evaluate(
                "v => { document.getElementById('ticket-qi-reviewer').value = v; }", REVIEWER_DISP)
            page.wait_for_function(
                "() => document.querySelectorAll('#ticket-qi-domain option').length > 1", timeout=10000)
            domain = page.eval_on_selector_all(
                "#ticket-qi-domain option", "els => els.map(e => e.value).filter(Boolean)")[0]
            page.select_option("#ticket-qi-domain", domain)
            page.wait_for_timeout(500)
            # 模块级联：开面板 → 点首个一级目录 → 有二级则点首个叶子
            wrap = '.cascade-cascader[data-cascade-field="module"]'
            page.locator(f"{wrap} .cascade-cascader-trigger").first.click(timeout=5000)
            page.wait_for_selector(f'{wrap} .cascade-cascader-item[data-depth="0"]', timeout=5000)
            page.locator(f'{wrap} .cascade-cascader-item[data-depth="0"]').first.click(timeout=5000)
            page.wait_for_timeout(400)
            depth1 = page.locator(f'{wrap} .cascade-cascader-item[data-depth="1"]')
            if depth1.count() > 0:
                depth1.first.click(timeout=5000)
                page.wait_for_timeout(400)
            module_val = page.eval_on_selector(f"{wrap} [data-cascade-hidden]", "el => el.value")
            assert module_val, "模块&特性级联应选中叶子节点"

            page.locator("#ticket-qi-submit").click(timeout=5000)
            page.wait_for_timeout(2500)
            assert any("已暂存" in m for m in dialogs), f"暂存成功提示未出现: {dialogs}"
            row = _qi_row(title)
            assert row and row[2] == "draft", "草稿应已创建且停留 draft"
            assert row[5] == CREATOR[0], f"草稿创建人应为 {CREATOR[0]}，实际 {row[5]}"

            # 2) 撤桩恢复 admin 真实登录态，API 推进到 ops_closure，真实浏览器触发闭环提交
            _unstub_identity(page)
            _advance_to_ops_closure(api_client, order_id)
            page.goto(f"{backend_server}/tickets/{order_id}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            _open_node_panel(page, "ops_closure")
            _fill_current_node_form(page, "ops_closure")
            page.locator(
                'form[data-node-form="1"][data-node-key="ops_closure"][data-is-current-node="1"] '
                "button[data-action-submit]"
            ).first.click(timeout=5000)
            # 3) 轮询等静默批量提交落库（在节点提交前置执行，与节点提交成败无关）
            for _ in range(30):
                row = _qi_row(title)
                if row and row[2] == "in_progress":
                    break
                page.wait_for_timeout(500)
            assert row and row[2] == "in_progress", f"闭环后草稿应被批量提交: {row}"
            qi_id, qi_no, status, stage, reviewer, creator_id, log_op, last_submitter = row
            assert str(qi_no).startswith("ZLGJ-"), f"应分配正式编号: {qi_no}"
            assert stage == "review"
            # 核心断言：归属=草稿创建人（非闭环操作人 admin），评审人保持草稿原值
            assert log_op == CREATOR[0], f"操作日志操作人应为创建人 {CREATOR[0]}，实际 {log_op}"
            assert last_submitter == CREATOR[0], f"last_submitter 应为创建人，实际 {last_submitter}"
            assert reviewer == REVIEWER_DISP, f"评审人应保持草稿原值，实际 {reviewer}"

            # 4) 双视角 amend 门禁：闭环操作人（当前真实登录态 admin）不可见，
            #    桩回创建人登录态后可见
            page.goto(f"{backend_server}/qi/{qi_id}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            assert page.locator(".qi-amend-save-btn").count() == 0, "闭环操作人不应看到「保存修改」"

            _stub_identity(page, *CREATOR, "测试组")
            page.goto(f"{backend_server}/qi/{qi_id}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            assert page.locator(".qi-amend-save-btn").count() > 0, "创建人应看到提出阶段「保存修改」"
            _unstub_identity(page)
        finally:
            _unstub_identity(page)
            _cleanup(title)


class TestTicketQiBatchAttributionManual:
    """S2：手动批量提交对齐——保留草稿原评审人，confirm 文案不再写「默认为您本人」。"""

    def test_manual_batch_keeps_reviewer_and_text(self, page, backend_server, api_client, assert_no_js_errors):
        title = TITLE_PREFIX + "S2"
        _cleanup(title)
        _ensure_reviewer_whitelist(api_client)
        tag = os.environ.get("PYTEST_XDIST_WORKER", "") + title
        order_id = require_ticket_order_id(api_client, tag)
        _advance_to_ops_closure(api_client, order_id)
        # 创建人 test_admin（默认操作人）经 API 暂存草稿（弹窗交互已由 S1 覆盖）
        r = api_client.post("/api/qi", json={
            "operator_id": CREATOR[0], "title": title, "related_ticket_no": order_id,
            "description": "<p>S2</p>", "category": "特性加固", "priority": "中",
            "domain": "测试领域", "module_feature": "测试模块",
            "reviewer": REVIEWER_DISP, "draft": True,
        })
        assert r.status_code == 200, r.text
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        try:
            # 闭环操作人 admin 视角调用真实手动批量函数（该按钮无渲染点，动态 import 是唯一可测路径）
            _switch_operator(page, backend_server, *TRIGGER)
            page.goto(f"{backend_server}/tickets/{order_id}")
            page.wait_for_selector("#root", timeout=15000)
            page.wait_for_timeout(3000)
            page.evaluate(
                """async (orderId) => {
                     const m = await import('/modules/pages/ticket-page.js?t=' + Date.now());
                     await m.batchSubmitQiDrafts(orderId);
                   }""", order_id)
            page.wait_for_timeout(4000)
            confirm = next((m for m in dialogs if "提交至评审" in m), "")
            assert confirm, f"confirm 未出现: {dialogs}"
            assert "评审人将默认为您本人" not in confirm, f"旧文案应已移除: {confirm}"
            assert "评审人保持" in confirm, f"新文案应说明评审人保持原设定: {confirm}"
            assert any("已提交 1/1" in m for m in dialogs), f"完成提示未出现: {dialogs}"

            row = _qi_row(title)
            assert row and row[2] == "in_progress", f"手动批量应已提交: {row}"
            qi_id, qi_no, status, stage, reviewer, creator_id, log_op, last_submitter = row
            assert reviewer == REVIEWER_DISP, f"评审人应保持草稿原值（修复前被覆盖为操作人）: {reviewer}"
            assert log_op == CREATOR[0], f"操作日志操作人应为创建人，实际 {log_op}"
            assert last_submitter == CREATOR[0]
        finally:
            _cleanup(title)
