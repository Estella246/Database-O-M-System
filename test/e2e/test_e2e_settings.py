import pytest

pytestmark = pytest.mark.e2e


class TestSettingsInteraction:

    def test_tc_e2e_024_settings_page_no_js_errors(self, page, backend_server, assert_no_js_errors):
        page.goto(f"{backend_server}/settings/appearance")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)

    def test_tc_e2e_025_settings_skin_theme_click(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/settings/appearance")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        skin_tiles = page.locator(".settings-skin-tile[data-ui-theme]")
        if skin_tiles.count() == 0:
            pytest.fail("Skin theme tiles not found")
        tile = skin_tiles.first
        tile.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            tile.click(timeout=5000)
        except Exception:
            tile.dispatch_event("click")
        page.wait_for_timeout(1000)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"皮肤主题切换发现 {len(js_errors)} 个 JS 错误:\n" + "\n".join(js_errors)

    def test_tc_e2e_026_settings_preset_bg_click(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/settings/appearance")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        preset_tiles = page.locator(".settings-skin-tile--preset[data-bg-preset-file]")
        if preset_tiles.count() == 0:
            pytest.fail("Preset background tiles not found")
        tile = preset_tiles.first
        tile.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            tile.click(timeout=5000)
        except Exception:
            tile.dispatch_event("click")
        page.wait_for_timeout(1000)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"预设背景点击发现 {len(js_errors)} 个 JS 错误:\n" + "\n".join(js_errors)
        has_custom_bg = page.evaluate("document.body.classList.contains('has-custom-bg')")
        assert has_custom_bg, "点击预设背景后 body 应有 has-custom-bg 类"

    def test_tc_e2e_027_settings_clear_bg_click(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/settings/appearance")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        preset_tiles = page.locator(".settings-skin-tile--preset[data-bg-preset-file]")
        if preset_tiles.count() > 0:
            tile = preset_tiles.first
            tile.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            try:
                tile.click(timeout=5000)
            except Exception:
                tile.dispatch_event("click")
            page.wait_for_timeout(500)
        clear_btn = page.locator("#settings-custom-bg-clear")
        if clear_btn.count() == 0:
            pytest.fail("Clear background button not found")
        btn = clear_btn.first
        btn.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            btn.click(timeout=5000)
        except Exception:
            btn.dispatch_event("click")
        page.wait_for_timeout(1000)
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"清除背景点击发现 {len(js_errors)} 个 JS 错误:\n" + "\n".join(js_errors)

    def test_tc_e2e_047_theme_switch_and_restore(self, page, backend_server, save_restore_local_storage, collect_js_errors):
        page.goto(f"{backend_server}/settings/appearance")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        original_theme = page.evaluate("document.documentElement.getAttribute('data-theme') || ''")
        skin_tiles = page.locator(".settings-skin-tile[data-ui-theme]")
        if skin_tiles.count() < 2:
            pytest.fail("需要至少 2 个皮肤主题")
        second_tile = skin_tiles.nth(1)
        second_tile.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            second_tile.click(timeout=5000)
        except Exception:
            second_tile.dispatch_event("click")
        page.wait_for_timeout(1000)
        new_theme = page.evaluate("document.documentElement.getAttribute('data-theme') || ''")
        assert new_theme != original_theme, "切换后主题应改变"
        first_tile = skin_tiles.first
        first_tile.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            first_tile.click(timeout=5000)
        except Exception:
            first_tile.dispatch_event("click")
        page.wait_for_timeout(1000)
        restored_theme = page.evaluate("document.documentElement.getAttribute('data-theme') || ''")
        assert restored_theme == original_theme, "切回后主题应恢复"
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"主题切换恢复发现 {len(js_errors)} 个 JS 错误"

    def test_tc_e2e_048_preset_bg_switch_and_clear(self, page, backend_server, save_restore_local_storage, collect_js_errors):
        page.goto(f"{backend_server}/settings/appearance")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(2000)
        preset_tiles = page.locator(".settings-skin-tile--preset[data-bg-preset-file]")
        if preset_tiles.count() < 2:
            pytest.fail("需要至少 2 个预设背景")
        first_tile = preset_tiles.first
        first_tile.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            first_tile.click(timeout=5000)
        except Exception:
            first_tile.dispatch_event("click")
        page.wait_for_timeout(800)
        has_bg_1 = page.evaluate("document.body.classList.contains('has-custom-bg')")
        assert has_bg_1, "点击第一个预设后 body 应有 has-custom-bg"
        second_tile = preset_tiles.nth(1)
        second_tile.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        try:
            second_tile.click(timeout=5000)
        except Exception:
            second_tile.dispatch_event("click")
        page.wait_for_timeout(800)
        has_bg_2 = page.evaluate("document.body.classList.contains('has-custom-bg')")
        assert has_bg_2, "点击第二个预设后 body 仍应有 has-custom-bg"
        clear_btn = page.locator("#settings-custom-bg-clear")
        if clear_btn.count() > 0:
            clear_btn.first.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            try:
                clear_btn.first.click(timeout=5000)
            except Exception:
                clear_btn.first.dispatch_event("click")
            page.wait_for_timeout(800)
            has_bg_cleared = page.evaluate("document.body.classList.contains('has-custom-bg')")
            assert not has_bg_cleared, "清除背景后 body 不应有 has-custom-bg"
        js_errors = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if any(p in msg for p in ["ERR_CONNECTION_REFUSED", "Failed to fetch", "net::ERR_"]):
                continue
            js_errors.append(msg)
        assert js_errors == [], f"预设背景切换清除发现 {len(js_errors)} 个 JS 错误"
