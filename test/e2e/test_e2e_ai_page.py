import pytest

pytestmark = pytest.mark.e2e


def _wait_ai_shell(page, timeout_ms: int = 20000):
    page.wait_for_selector("section.ai-assistant-page", state="visible", timeout=timeout_ms)


def _ensure_ai_input_enabled(page, timeout_ms: int = 20000):
    """无选中会话时 #ai-input 为 disabled；与产品行为一致，用例需先新建或选中会话。"""
    _wait_ai_shell(page, timeout_ms=timeout_ms)
    inp = page.locator("#ai-input").first
    if inp.count() == 0:
        pytest.fail("智能助手页未渲染输入框")
    if inp.is_disabled():
        with page.expect_response(
            lambda r: r.request.method == "POST"
            and "/api/ai/conversations" in r.url
            and "/chat" not in r.url,
            timeout=timeout_ms,
        ):
            page.locator("#ai-new-conv-btn").click(timeout=10000)
        page.wait_for_function(
            "() => { const el = document.querySelector('#ai-input'); return el && !el.disabled; }",
            timeout=timeout_ms,
        )


class TestAiPage:

    def test_tc_e2e_073_ai_page_load(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        root = page.locator("#root")
        assert root.is_visible(), "AI 对话页面应可见"

    def test_tc_e2e_074_ai_page_has_input(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        _ensure_ai_input_enabled(page)
        input_area = page.locator("#ai-input, .ai-input").first
        assert input_area.is_visible(), "AI 对话页面应有可编辑输入框"

    def test_tc_e2e_075_ai_page_has_send_button(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        _ensure_ai_input_enabled(page)
        send_btn = page.locator("#ai-send-btn, .ai-send-btn").first
        if send_btn.count() == 0:
            pytest.fail("AI 对话页面发送按钮不可见（权限限制）")
        assert send_btn.is_visible(), "AI 对话页面应有发送按钮"

    def test_tc_e2e_076_ai_conversation_list(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        _wait_ai_shell(page)
        conv_items = page.locator("[data-ai-conv-id]")
        if conv_items.count() > 0:
            first_conv = conv_items.first
            first_conv.click(timeout=5000)
            page.wait_for_timeout(1000)
            assert first_conv.evaluate("el => el.classList.contains('active')"), "选中的对话应有 active 样式"

    def test_tc_e2e_077_ai_quick_buttons(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        _wait_ai_shell(page)
        page.wait_for_selector("[data-ai-quick-id]", state="visible", timeout=20000)
        _ensure_ai_input_enabled(page)
        quick_btns = page.locator("[data-ai-quick-id]")
        if quick_btns.count() > 0:
            first_btn = quick_btns.first
            first_btn.click(timeout=5000)
            page.wait_for_timeout(500)
            input_area = page.locator("#ai-input").first
            assert input_area.input_value() != "", "点击快捷按钮后输入框应有内容"

    def test_tc_e2e_078_ai_new_conversation(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/ai-assistant", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        _wait_ai_shell(page)
        new_btn = page.locator("button", has_text="新建对话").first
        if new_btn.count() == 0:
            new_btn = page.locator("[data-ai-new-conv]").first
        if new_btn.count() > 0 and new_btn.is_visible():
            new_btn.click(timeout=5000)
            page.wait_for_timeout(1000)
