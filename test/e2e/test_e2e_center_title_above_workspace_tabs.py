"""
E2E：主区壳层标题（.head h1）须在 #workspace-tabs 之上，且与路由语义一致。

与「用户管理标题掉到页签下」回归相关；表驱动覆盖主要菜单路由。
"""

from __future__ import annotations

import json
import os

import httpx
import pytest

pytestmark = pytest.mark.e2e

# 与 test/e2e/conftest.py 中 E2E 演示账号一致，便于与 e2e_database_bootstrap 写入的白名单对齐
E2E_OPERATOR_ACCOUNT = os.getenv("E2E_OPERATOR_ACCOUNT", "test_admin").strip()
E2E_OPERATOR_NAME = os.getenv("E2E_OPERATOR_NAME", "测试管理员").strip()
WHITELIST_NODE = "__whitelist__"
REQUIREMENT_FIELD = "requirement_list"


def _requirement_list_permission_level(base_url: str) -> str | None:
    try:
        users = httpx.get(f"{base_url}/api/admin/users", timeout=10).json()
        items = users.get("items") or []
        role = None
        for u in items:
            if str(u.get("account") or "") == E2E_OPERATOR_ACCOUNT:
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
    page.goto(f"{base_url}/", wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)
    page.evaluate(
        f"""() => {{
        window.localStorage.setItem('demo_operator_account', {json.dumps(E2E_OPERATOR_ACCOUNT)});
        window.localStorage.setItem('demo_operator_name', {json.dumps(E2E_OPERATOR_NAME)});
    }}"""
    )


def _assert_h1_above_workspace_tabs(page, expected_substring: str) -> None:
    page.wait_for_selector("#workspace-tabs", timeout=15000)
    h1 = page.locator("main.center .head h1#center-page-title")
    assert h1.count() >= 1, "主区应有 #center-page-title 的 h1"
    assert h1.first.is_visible(), "主区 h1 应可见"
    cls = h1.first.get_attribute("class") or ""
    assert "hidden" not in cls.split(), f"h1 不应带 hidden 类，实际 class={cls!r}"
    text = (h1.first.inner_text() or "").strip()
    assert expected_substring in text, f"h1 文案应包含 {expected_substring!r}，实际 {text!r}"
    tabs = page.locator("#workspace-tabs").first
    assert tabs.is_visible()
    box_h1 = h1.first.bounding_box()
    box_tabs = tabs.bounding_box()
    assert box_h1 and box_tabs, "h1 与 workspace-tabs 应有 bounding_box"
    tol = 4.0
    assert (
        box_h1["y"] + box_h1["height"] <= box_tabs["y"] + tol
    ), f"h1 底边应在页签顶边之上：h1_bottom={box_h1['y'] + box_h1['height']}, tabs_top={box_tabs['y']}"


def _goto_and_assert(page, backend_server: str, path: str, expected: str, *, skip_if: str | None = None) -> None:
    if skip_if:
        pytest.fail(skip_if)
    _use_seeded_admin_operator(page, backend_server)
    page.goto(f"{backend_server}{path}", wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=15000)
    try:
        page.wait_for_response(
            lambda r: "/api/admin/" in r.url,
            timeout=15000,
        )
    except Exception:
        pass
    page.wait_for_timeout(400)
    if path == "/ai-assistant":
        try:
            page.wait_for_selector("section.ai-assistant-page", state="visible", timeout=20000)
        except Exception as e:
            pytest.fail(
                "深链 /ai-assistant 未挂载智能助手页（多为白名单未含 ai_assistant 或首屏 admin 竞态）；"
                f"详情: {e!r}"
            )
    _assert_h1_above_workspace_tabs(page, expected)


@pytest.mark.parametrize(
    "case_id,path,expected",
    [
        ("TC-CHROME-01", "/", "我的主页"),
        ("TC-CHROME-02", "/workbench", "工作台"),
        ("TC-CHROME-03", "/duty-roster", "值班表"),
        ("TC-CHROME-04", "/leave-application", "请假申请"),
        ("TC-CHROME-05", "/requirements", "需求管理"),
        ("TC-CHROME-06", "/stats/charts", "统计图表"),
        ("TC-CHROME-07", "/stats/report", "工单分析"),
        ("TC-CHROME-08", "/upload-analysis", "人力分析"),
        ("TC-CHROME-09", "/ai-assistant", "智能助手"),
        ("TC-CHROME-11", "/settings/appearance", "设置"),
        ("TC-CHROME-12a", "/params/duty-field", "责任田模块"),
        ("TC-CHROME-12b", "/params/version", "版本模块"),
        ("TC-CHROME-13", "/admin/users", "用户管理"),
        ("TC-CHROME-14", "/admin/permissions", "权限策略"),
    ],
)
def test_center_page_title_above_workspace_tabs(
    page, backend_server, assert_no_js_errors, case_id, path, expected
):
    skip = None
    if case_id == "TC-CHROME-05":
        level = _requirement_list_permission_level(backend_server)
        if level == "hidden":
            skip = "requirement_list 为 hidden：无法断言需求管理壳层标题"
    _goto_and_assert(page, backend_server, path, expected, skip_if=skip)
    assert page.locator(".admin-wrap .detail-head h2").count() == 0, (
        "管理页 .detail-head 内不应再放置与壳层重复的 h2 页标题"
    )


@pytest.mark.parametrize(
    "case_id,path,expected",
    [
        ("TC-CHROME-12c", "/params/group-template", "拉群模版"),
    ],
)
def test_center_page_title_group_template(
    page, backend_server, assert_no_js_errors, case_id, path, expected
):
    _goto_and_assert(page, backend_server, path, expected)
