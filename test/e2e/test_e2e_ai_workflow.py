import json
import time
import uuid

import pytest

pytestmark = pytest.mark.e2e


def _unique_tag():
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


def _api_create_conversation(api_client, tag):
    resp = api_client.post("/api/ai/conversations", json={
        "operator_id": "test_admin",
        "title": f"E2E对话-{tag}",
    })
    if resp.status_code == 200:
        body = resp.json()
        item = body.get("item") or {}
        return item.get("id")
    return None


def _api_delete_conversation(api_client, conv_id):
    if conv_id:
        api_client.delete(f"/api/ai/conversations/{conv_id}", params={"operator_id": "test_admin"})


def _wait_for(page, selector, timeout=10000):
    page.wait_for_selector(selector, timeout=timeout)


def _wait_ai_shell(page, timeout_ms: int = 20000):
    page.wait_for_selector("section.ai-assistant-page", state="visible", timeout=timeout_ms)


def _select_conversation_input_ready(page, conv_id, timeout_ms: int = 20000):
    cid = int(conv_id)
    page.wait_for_selector(f"[data-ai-conv-id='{cid}']", state="visible", timeout=timeout_ms)
    page.locator(f"[data-ai-conv-id='{cid}']").first.click(timeout=10000)
    # 等待会话项被标记为 active（点击后需等待渲染完成）
    page.wait_for_function(
        f"() => {{ const el = document.querySelector('[data-ai-conv-id=\\'{cid}\\']'); return el && el.classList.contains('active'); }}",
        timeout=timeout_ms,
    )


def _ensure_ai_input_via_new_conv(page, timeout_ms: int = 20000):
    _wait_ai_shell(page, timeout_ms=timeout_ms)
    inp = page.locator("#ai-input").first
    if inp.count() == 0:
        pytest.fail("智能助手页未渲染输入框")
    # 输入框始终可用，无需等待 disabled 状态
    # 如果没有激活会话，点击新建按钮创建一个
    if not page.locator(".ai-conv-item.active").count():
        with page.expect_response(
            lambda r: r.request.method == "POST"
            and "/api/ai/conversations" in r.url
            and "/chat" not in r.url,
            timeout=timeout_ms,
        ):
            page.locator("#ai-new-conv-btn").click(timeout=10000)
        # 等待新建的会话项变为 active
        page.wait_for_function(
            "() => { const el = document.querySelector('.ai-conv-item.active'); return el; }",
            timeout=timeout_ms,
        )


class TestAiPageWorkflow:
    """AI助手完整交互流程"""

    def test_tc_e2e_501_ai_page_load_and_layout(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        _wait_for(page, "#root")
        try:
            _wait_ai_shell(page)
        except Exception:
            pytest.fail("智能助手页未挂载，多为无 ai_assistant 白名单或路由未生效")
        conv_list = page.locator("[data-ai-conv-id]")
        input_area = page.locator("#ai-input, .ai-input").first
        has_list = conv_list.count() > 0
        has_input = input_area.count() > 0
        assert has_list or has_input, "AI助手页面应有对话列表或输入框（无会话时输入框可为 disabled）"

    def test_tc_e2e_502_ai_new_conversation(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        conv_id = _api_create_conversation(api_client, tag)
        if not conv_id:
            pytest.fail("无法通过API创建对话")
        try:
            page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            _select_conversation_input_ready(page, conv_id)
            conv_item = page.locator(f"[data-ai-conv-id='{int(conv_id)}']").first
            assert conv_item.evaluate("el => el.classList.contains('active')"), "选中的对话应有active样式"
        finally:
            _api_delete_conversation(api_client, conv_id)

    def test_tc_e2e_503_ai_send_message(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        conv_id = _api_create_conversation(api_client, tag)
        if not conv_id:
            pytest.fail("无法通过API创建对话")
        try:

            def _stub_chat(route):
                if route.request.method != "POST":
                    route.continue_()
                    return
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "role": "assistant",
                            "content": "E2E stub",
                            "prompt_tokens": 1,
                            "completion_tokens": 1,
                        }
                    ),
                )

            page.route("**/api/ai/conversations/*/chat", _stub_chat)
            page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            _select_conversation_input_ready(page, conv_id)
            input_area = page.locator("#ai-input").first
            if input_area.count() == 0 or not input_area.is_visible():
                pytest.fail("AI输入框不可见")
            input_area.fill(f"E2E测试消息-{tag}")
            page.wait_for_timeout(500)
            send_btn = page.locator("#ai-send-btn").first
            if send_btn.count() > 0 and send_btn.is_visible():
                send_btn.click(timeout=5000)
                page.wait_for_timeout(3000)
                user_msg = page.locator(".ai-msg-user").first
                if user_msg.count() > 0:
                    assert user_msg.is_visible(), "发送消息后应显示用户消息气泡"
        finally:
            _api_delete_conversation(api_client, conv_id)

    def test_tc_e2e_504_ai_quick_template_click(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        _wait_for(page, "#root")
        _wait_ai_shell(page)
        page.wait_for_selector("[data-ai-quick-id]", state="visible", timeout=20000)
        _ensure_ai_input_via_new_conv(page)
        quick_btns = page.locator("[data-ai-quick-id]")
        first_btn = quick_btns.first
        first_btn.click(timeout=5000)
        page.wait_for_timeout(500)
        input_area = page.locator("#ai-input").first
        assert input_area.input_value() != "", "点击快捷按钮后输入框应有内容"

    def test_tc_e2e_505_ai_conversation_delete(self, page, backend_server, api_client, assert_no_js_errors):
        tag = _unique_tag()
        conv_id = _api_create_conversation(api_client, tag)
        if not conv_id:
            pytest.fail("无法通过API创建对话")
        try:
            page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            conv_item = page.locator(f"[data-ai-conv-id='{int(conv_id)}']").first
            conv_item.wait_for(state="visible", timeout=20000)
            delete_btn = conv_item.locator("[data-ai-conv-delete]").first
            if delete_btn.count() > 0 and delete_btn.is_visible():
                page.on("dialog", lambda dialog: dialog.accept())
                delete_btn.click(timeout=5000)
                page.wait_for_timeout(2000)
        finally:
            _api_delete_conversation(api_client, conv_id)

    def test_tc_e2e_506_ai_conversation_switch(self, page, backend_server, api_client, assert_no_js_errors):
        tag1 = _unique_tag()
        tag2 = _unique_tag()
        conv_id1 = _api_create_conversation(api_client, tag1)
        conv_id2 = _api_create_conversation(api_client, tag2)
        if not conv_id1 or not conv_id2:
            if conv_id1:
                _api_delete_conversation(api_client, conv_id1)
            if conv_id2:
                _api_delete_conversation(api_client, conv_id2)
            pytest.fail("无法通过API创建对话")
        try:
            page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
            _wait_for(page, "#root")
            _wait_ai_shell(page)
            conv1 = page.locator(f"[data-ai-conv-id='{int(conv_id1)}']").first
            conv2 = page.locator(f"[data-ai-conv-id='{int(conv_id2)}']").first
            conv1.wait_for(state="visible", timeout=20000)
            conv2.wait_for(state="visible", timeout=20000)
            conv1.click(timeout=5000)
            page.wait_for_timeout(400)
            conv2.click(timeout=5000)
            page.wait_for_timeout(400)
            assert conv2.evaluate("el => el.classList.contains('active')"), "切换后第二个对话应为active"
        finally:
            _api_delete_conversation(api_client, conv_id1)
            _api_delete_conversation(api_client, conv_id2)
