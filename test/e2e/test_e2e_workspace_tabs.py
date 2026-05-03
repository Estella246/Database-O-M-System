"""
E2E：顶栏「已打开页面」清单（#workspace-tabs / .workspace-tab）。

设计说明见同目录 WORKSPACE_TABS_TEST_DESIGN.md。
"""

from __future__ import annotations

import json
import warnings
from urllib.parse import urlparse

import httpx
import pytest

pytestmark = pytest.mark.e2e

SEEDED_ADMIN_ACCOUNT = "l30030745"
WHITELIST_NODE = "__whitelist__"
REQUIREMENT_FIELD = "requirement_list"

NAV_KEY_TO_EXPECTED_PATH = {
    "home": "/",
    "list": "/workbench",
    "duty:roster": "/duty-roster",
    "leave:application": "/leave-application",
    "req:manage": "/requirements",
    "stats:charts": "/stats/charts",
    "stats:report": "/stats/report",
    "stats:skills": "/stats/skills",
    "upload:analysis": "/upload-analysis",
    "settings:appearance": "/settings/appearance",
    "ai:assistant": "/ai-assistant",
}


def _requirement_list_permission_level(base_url: str) -> str | None:
    """返回种子管理员角色下 requirement_list 白名单等级；无行则 None（前端按 readonly 默认）。"""
    try:
        users = httpx.get(f"{base_url}/api/admin/users", timeout=10).json()
        items = users.get("items") or []
        role = None
        for u in items:
            if str(u.get("account") or "") == SEEDED_ADMIN_ACCOUNT:
                role = str(u.get("role_code") or "")
                break
        if not role:
            return None
        perms = httpx.get(f"{base_url}/api/admin/permissions", timeout=10).json()
        rows = perms.get("items") or []
        for r in rows:
            if (
                str(r.get("role_code") or "") == role
                and str(r.get("node_key") or "") == WHITELIST_NODE
                and str(r.get("field_key") or "") == REQUIREMENT_FIELD
            ):
                return str(r.get("permission_level") or "").strip() or None
        return None
    except Exception:
        return None


def _use_seeded_admin_operator(page, base_url: str) -> None:
    """在同源页面上下文写入 localStorage（须先导航到应用 origin）。"""
    page.goto(f"{base_url}/", wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)
    page.evaluate(
        f"""() => {{
        window.localStorage.setItem('demo_operator_account', {json.dumps(SEEDED_ADMIN_ACCOUNT)});
        window.localStorage.setItem('demo_operator_name', {json.dumps("李潇雨")});
    }}"""
    )


def _wait_root_and_admin(page, base_url: str) -> None:
    page.goto(f"{base_url}/", wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)
    try:
        page.wait_for_response(
            lambda r: r.url.endswith("/api/admin/permissions") or "/api/admin/permissions?" in r.url,
            timeout=20000,
        )
    except Exception:
        pass
    try:
        page.wait_for_response(
            lambda r: r.url.endswith("/api/admin/users") or "/api/admin/users?" in r.url,
            timeout=20000,
        )
    except Exception:
        pass
    page.wait_for_selector("#workspace-tabs", timeout=15000)
    page.wait_for_timeout(500)


def _click_nav_key(page, key: str) -> bool:
    loc = page.locator(f"[data-nav-key='{key}']").first
    if loc.count() == 0 or not loc.is_visible():
        return False
    try:
        loc.click(timeout=8000)
    except Exception:
        loc.dispatch_event("click")
    page.wait_for_timeout(600)
    return True


def _active_workspace_tab_key(page) -> str | None:
    active = page.locator(".workspace-tab.active").first
    if active.count() == 0:
        return None
    return active.get_attribute("data-workspace-tab")


def _assert_url_path(page, expected_suffix: str) -> None:
    path = urlparse(page.url).path or "/"
    exp = expected_suffix if expected_suffix.startswith("/") else "/" + expected_suffix
    assert path.rstrip("/") == exp.rstrip("/"), f"URL path 期望 {exp!r}，实际 {path!r}，完整 URL {page.url!r}"


def _filter_js_errors(collect_js_errors) -> list:
    out = []
    for e in collect_js_errors:
        msg = str(e) if not hasattr(e, "text") else e.text
        if any(
            p in msg
            for p in (
                "ERR_CONNECTION_REFUSED",
                "Failed to fetch",
                "net::ERR_",
            )
        ):
            continue
        out.append(msg)
    return out


class TestWorkspaceTabsTcWs01Initial:
    def test_tc_ws_01_initial_home_tab(self, page, backend_server, collect_js_errors):
        _wait_root_and_admin(page, backend_server)
        home = page.locator('[data-workspace-tab="home"]')
        assert home.count() >= 1, "初始应存在「我的主页」标签"
        close_on_home = page.locator('[data-workspace-tab="home"] .workspace-tab-close')
        assert close_on_home.count() == 0, "「我的主页」标签不应有关闭按钮"
        _assert_url_path(page, "/")
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs09ApiBase:
    def test_tc_ws_09_api_base_url_matches_backend_origin(self, page, backend_server, collect_js_errors):
        """契约：SPA 与后端同源非「纯前端 dev 端口」时，API_BASE_URL 与 backend_server origin 一致。"""
        _wait_root_and_admin(page, backend_server)
        api_base = page.evaluate(
            """async () => {
            const m = await import('/modules/services/api.js');
            return m.API_BASE_URL;
        }"""
        )
        bu = urlparse(backend_server)
        au = urlparse(api_base)
        assert au.scheme == bu.scheme, f"API_BASE_URL scheme 期望 {bu.scheme!r}，实际 {api_base!r}"
        assert (au.hostname or "") == (bu.hostname or ""), f"API_BASE_URL host 期望 {bu.hostname!r}，实际 {api_base!r}"
        b_port = bu.port or (443 if bu.scheme == "https" else 80)
        a_port = au.port or (443 if au.scheme == "https" else 80)
        assert a_port == b_port, f"API_BASE_URL 端口期望 {b_port}，实际 {api_base!r} -> port {a_port}"
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs02NavUrlActive:
    def test_tc_ws_02_nav_keys_match_url_and_active_tab(self, page, backend_server, collect_js_errors):
        req_lvl = _requirement_list_permission_level(backend_server)
        _use_seeded_admin_operator(page, backend_server)
        _wait_root_and_admin(page, backend_server)
        for key in ("list", "duty:roster"):
            if not _click_nav_key(page, key):
                pytest.skip(f"侧栏无可见入口: {key}")
            assert page.locator(f'[data-workspace-tab="{key}"]').count() >= 1, f"点击后应存在标签 {key}"
            exp = NAV_KEY_TO_EXPECTED_PATH[key]
            _assert_url_path(page, exp)
            assert _active_workspace_tab_key(page) == key, f"激活标签应为 {key}"
        if req_lvl == "hidden":
            pytest.skip(
                f"API 确认 {SEEDED_ADMIN_ACCOUNT} 所在角色对 {REQUIREMENT_FIELD} 为 hidden，不验证需求管理顶栏标签"
            )
        if _click_nav_key(page, "req:manage"):
            page.wait_for_selector(
                '[data-workspace-tab="req:manage"]',
                state="attached",
                timeout=15000,
            )
            assert page.locator('[data-workspace-tab="req:manage"]').count() >= 1
            _assert_url_path(page, "/requirements")
            assert _active_workspace_tab_key(page) == "req:manage"
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs08SettingsNav:
    def test_tc_ws_08_settings_appearance_tab_after_sidebar_click(self, page, backend_server, collect_js_errors):
        """委托路径须调用 ensureSettingsTab：侧栏「设置」后顶栏与 URL 一致。"""
        _use_seeded_admin_operator(page, backend_server)
        _wait_root_and_admin(page, backend_server)
        if not _click_nav_key(page, "settings:appearance"):
            pytest.skip("侧栏无可见「设置」入口（settings:appearance）")
        page.wait_for_selector(
            '[data-workspace-tab="settings:appearance"]',
            state="attached",
            timeout=15000,
        )
        assert page.locator('[data-workspace-tab="settings:appearance"]').count() >= 1
        _assert_url_path(page, "/settings/appearance")
        assert _active_workspace_tab_key(page) == "settings:appearance"
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs03DeepLinkRequirements:
    def test_tc_ws_03_deep_link_requirements_branch(self, page, backend_server, collect_js_errors):
        req_lvl = _requirement_list_permission_level(backend_server)
        _use_seeded_admin_operator(page, backend_server)
        try:
            page.wait_for_response(
                lambda r: "/api/admin/permissions" in r.url,
                timeout=20000,
            )
        except Exception:
            pass
        page.wait_for_timeout(800)
        nav_req = page.locator("[data-nav-key='req:manage']").first
        req_visible = nav_req.count() > 0 and nav_req.is_visible()

        page.goto(f"{backend_server}/requirements", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        try:
            page.wait_for_response(
                lambda r: "/api/admin/permissions" in r.url,
                timeout=20000,
            )
        except Exception:
            pass
        page.wait_for_timeout(1200)

        tab_req = page.locator('[data-workspace-tab="req:manage"]')
        if req_lvl == "hidden":
            assert tab_req.count() == 0, "API 为 hidden 时顶栏不得出现 req:manage 标签"
            assert _active_workspace_tab_key(page) != "req:manage"
        elif req_visible:
            assert tab_req.count() == 1, "侧栏可见「需求管理」时，深链后顶栏必须存在 req:manage 标签"
            assert _active_workspace_tab_key(page) == "req:manage"
            _assert_url_path(page, "/requirements")
        else:
            assert tab_req.count() == 0, "侧栏不可见「需求管理」时，顶栏不应出现 req:manage 标签"
            assert _active_workspace_tab_key(page) != "req:manage", "无侧栏入口时不应以 req:manage 为激活顶栏标签"
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs04MultiThenReq:
    def test_tc_ws_04_multi_tabs_then_requirement_tab_in_dom(self, page, backend_server, collect_js_errors):
        if _requirement_list_permission_level(backend_server) == "hidden":
            pytest.skip("requirement_list 为 hidden，跳过「多标签 + 需求管理」场景")
        _use_seeded_admin_operator(page, backend_server)
        _wait_root_and_admin(page, backend_server)
        if not _click_nav_key(page, "req:manage"):
            pytest.skip("当前环境侧栏无「需求管理」入口，跳过多标签场景")
        page.goto(f"{backend_server}/", wait_until="domcontentloaded")
        _use_seeded_admin_operator(page, backend_server)
        _wait_root_and_admin(page, backend_server)
        sequence = [
            "list",
            "duty:roster",
            "stats:charts",
            "stats:report",
            "stats:skills",
            "upload:analysis",
            "req:manage",
        ]
        for key in sequence:
            if not _click_nav_key(page, key):
                pytest.skip(f"侧栏缺少入口，在 {key} 处中止")
        page.wait_for_selector(
            '[data-workspace-tab="req:manage"]',
            state="attached",
            timeout=15000,
        )
        assert page.locator('[data-workspace-tab="req:manage"]').count() == 1
        assert _active_workspace_tab_key(page) == "req:manage"
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs05Viewport:
    def test_tc_ws_05_active_tab_and_viewport_note(self, page, backend_server, collect_js_errors):
        if _requirement_list_permission_level(backend_server) == "hidden":
            pytest.skip("requirement_list 为 hidden，跳过视口几何记录用例")
        _use_seeded_admin_operator(page, backend_server)
        _wait_root_and_admin(page, backend_server)
        sequence = [
            "list",
            "duty:roster",
            "stats:charts",
            "stats:report",
            "stats:skills",
            "upload:analysis",
            "req:manage",
        ]
        page.set_viewport_size({"width": 900, "height": 800})
        for key in sequence:
            if not _click_nav_key(page, key):
                pytest.skip(f"侧栏缺少入口: {key}")
        page.wait_for_selector(
            '[data-workspace-tab="req:manage"]',
            state="attached",
            timeout=15000,
        )
        assert _active_workspace_tab_key(page) == "req:manage"
        in_vp = page.evaluate(
            """() => {
            const tab = document.querySelector('[data-workspace-tab="req:manage"]');
            const container = document.getElementById('workspace-tabs');
            if (!tab || !container) return { ok: false, reason: 'missing' };
            const tr = tab.getBoundingClientRect();
            const cr = container.getBoundingClientRect();
            const eps = 2;
            const inViewport = tr.left >= cr.left - eps && tr.right <= cr.right + eps;
            return { ok: true, inViewport, tr: {l:tr.left,r:tr.right,t:tr.top,b:tr.bottom},
                     cr: {l:cr.left,r:cr.right,t:cr.top,b:cr.bottom} };
            }"""
        )
        assert in_vp.get("ok") is True, str(in_vp)
        if not in_vp.get("inViewport"):
            warnings.warn(
                "TC-WS-05 viewport_overflow: req:manage 标签在 DOM 中但未必完全落在 "
                f"#workspace-tabs 可视矩形内。几何: {in_vp}",
                UserWarning,
                stacklevel=2,
            )
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs06Close:
    def test_tc_ws_06_close_first_closable_tab(self, page, backend_server, collect_js_errors):
        _use_seeded_admin_operator(page, backend_server)
        _wait_root_and_admin(page, backend_server)
        _click_nav_key(page, "list")
        _click_nav_key(page, "duty:roster")
        closes = page.locator(".workspace-tab-close")
        n_before = closes.count()
        assert n_before >= 1, "应存在至少一个可关闭标签"
        first_close = closes.first
        key_before = first_close.get_attribute("data-close-tab")
        first_close.click()
        page.wait_for_timeout(600)
        assert page.locator(f'[data-workspace-tab="{key_before}"]').count() == 0, "关闭后该 key 标签应从 DOM 消失"
        assert _filter_js_errors(collect_js_errors) == []


class TestWorkspaceTabsTcWs07WhitelistStatsHidden:
    def test_tc_ws_07_tac_user_stats_route_not_active_tab(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        page.evaluate(
            """() => {
            window.localStorage.setItem('demo_operator_account', 'i00822653');
            window.localStorage.setItem('demo_operator_name', 'Lazov');
        }"""
        )
        page.goto(f"{backend_server}/stats/charts", wait_until="domcontentloaded")
        page.wait_for_selector("#root", timeout=15000)
        try:
            page.wait_for_response(
                lambda r: "/api/admin/permissions" in r.url,
                timeout=20000,
            )
        except Exception:
            pass
        page.wait_for_timeout(2000)
        users_ok = page.evaluate(
            """async () => {
            const r = await fetch('/api/admin/users');
            if (!r.ok) return false;
            const j = await r.json();
            const items = j.items || [];
            return items.some((u) => String(u.account || '') === 'i00822653');
        }"""
        )
        if not users_ok:
            pytest.skip("当前库无 i00822653 用户，跳过 TC-WS-07")
        active = _active_workspace_tab_key(page)
        assert active != "stats:charts", (
            f"TAC 等无 stats_dashboard 权限时，激活顶栏标签不应为 stats:charts，实际 {active!r}"
        )
        assert _filter_js_errors(collect_js_errors) == []
