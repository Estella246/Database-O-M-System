"""E2E：实施阶段「解决版本」必填下拉。

覆盖：
- 处理人态：closure 表单 accept_version 渲染为 <select>，选项来自 /api/qi/config/accept-versions。
- 存量值兜底：历史版本不在选项中时，作为额外选项保留并回显选中。
- 修订态（amend）：同样为下拉。
- 静态兜底（V2）：配置接口失败时 0122 种子选项仍渲染，必填 select 不为空。
"""
import json
import os

import psycopg
import pytest

pytestmark = pytest.mark.e2e

QI_NO = "E2E-CLO-VER"
DOMAIN = "SQL引擎"
MODULE = "驱动/JDBC"
OLD_VERSION = "505.2.0-旧"


def _seed_qi_at_closure(dsn, accept_version=OLD_VERSION):
    """造一条停在 closure（处理人=test_admin）的 QI，返回 id。"""
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
        conn.execute(
            """INSERT INTO qi_request
               (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                priority, domain, module_feature, planned_version, reviewer,
                current_stage, current_status, creator_id, creator_name)
               VALUES (%s,'质量加固和改进','测试管理员 test_admin','解决版本下拉测试','','<p>测试</p>','',
                       '中',%s,%s,'','测试管理员 test_admin',
                       'closure','in_progress','test_admin','测试管理员 test_admin')""",
            (QI_NO, DOMAIN, MODULE),
        )
        rid = int(conn.execute("SELECT id FROM qi_request WHERE qi_no=%s", (QI_NO,)).fetchone()[0])
        conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) "
            "VALUES (%s,'analysis',1,'completed','测试管理员 test_admin')",
            (rid,),
        )
        cs = conn.execute(
            "INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible) "
            "VALUES (%s,'closure',1,'in_progress','测试管理员 test_admin') RETURNING id",
            (rid,),
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, draft, created_by)
               VALUES (%s,%s,'closure',%s::jsonb, FALSE, 'test_admin')""",
            (int(cs), rid, json.dumps({"accept_version": accept_version}, ensure_ascii=False)),
        )
        conn.commit()
        return rid


def _cleanup(dsn):
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no=%s", (QI_NO,))
        conn.commit()


def test_closure_accept_version_is_select_with_options(page, backend_server, assert_no_js_errors):
    dsn = os.environ["DATABASE_URL"]
    rid = _seed_qi_at_closure(dsn)
    try:
        page.goto(f"{backend_server}/qi/{rid}")
        page.wait_for_selector("#root", timeout=15000)
        # 处理人态下拉异步填充完成：配置选项齐备且选中值为存量旧版本（兜底保留）。
        # 等待与读取放在同一次求值里（页面多个异步 fetch 会触发重渲染，快照读取可能撞上下拉重建）
        need = json.dumps(["507.0", "507.1", "508.0", OLD_VERSION])
        result = page.wait_for_function(
            """(need) => {
                const s = document.getElementById('qi-stage-closure-accept_version');
                if (!s || s.tagName !== 'SELECT') return false;
                const opts = Array.from(s.options).map(o => o.value);
                if (!need.every(v => opts.includes(v)) || s.value !== %s) return false;
                return { tag: s.tagName, opts };
            }""" % json.dumps(OLD_VERSION),
            arg=json.loads(need),
            timeout=15000,
        )
        sel = result.json_value()
        assert sel["tag"] == "SELECT", "解决版本应为下拉"
        for v in ("507.0", "507.1", "508.0", OLD_VERSION):
            assert v in sel["opts"], f"选项应含 {v}，实际: {sel['opts']}"
        # 标签动态切换：closure_method 未填（默认问题单闭环口径）→ 标签为「解决版本」
        label = page.locator('[data-field-label="accept_version"]').first.inner_text()
        assert "解决版本" in label or "接纳版本" in label, f"accept_version 标签异常: {label}"
    finally:
        _cleanup(dsn)


def test_closure_accept_version_empty_option_exists(page, backend_server, assert_no_js_errors):
    """下拉含空选项「--」，未选择时提交由后端拦截必填（前端 select 默认值空）。"""
    dsn = os.environ["DATABASE_URL"]
    rid = _seed_qi_at_closure(dsn, accept_version="")
    try:
        page.goto(f"{backend_server}/qi/{rid}")
        page.wait_for_selector("#root", timeout=15000)
        result = page.wait_for_function(
            """() => {
                const s = document.getElementById('qi-stage-closure-accept_version');
                return s && s.tagName === 'SELECT' && s.options.length > 1
                    ? { value: s.value } : false;
            }""",
            timeout=15000,
        )
        assert result.json_value()["value"] == "", "存量值为空时下拉应停在「--」空选项"
    finally:
        _cleanup(dsn)


def test_closure_accept_version_fetch_success_is_authoritative(page, backend_server, assert_no_js_errors):
    """V2：fetch 成功时配置全量权威——选项=接口返回的启用项，不与静态兜底合并，
    管理员删除/停用的版本不再出现。"""
    dsn = os.environ["DATABASE_URL"]
    rid = _seed_qi_at_closure(dsn, accept_version="")
    try:
        page.route(
            "**/api/qi/config/accept-versions*",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"versions": [
                    {"version": "E2E-ONLY-9.9", "enabled": True},
                    {"version": "E2E-DISABLED-0.1", "enabled": False},
                ]}),
            ),
        )
        page.goto(f"{backend_server}/qi/{rid}")
        page.wait_for_selector("#root", timeout=15000)
        result = page.wait_for_function(
            """() => {
                const s = document.getElementById('qi-stage-closure-accept_version');
                if (!s || s.tagName !== 'SELECT') return false;
                const opts = Array.from(s.options).map(o => o.value);
                return opts.includes('E2E-ONLY-9.9') ? { opts } : false;
            }""",
            timeout=15000,
        )
        opts = result.json_value()["opts"]
        assert opts == ["", "E2E-ONLY-9.9"], (
            f"fetch 成功时选项应仅为接口启用项（不合并静态兜底、不停用项）: {opts}"
        )
    finally:
        page.unroute("**/api/qi/config/accept-versions*")
        _cleanup(dsn)


def test_closure_accept_version_static_fallback_on_fetch_fail(page, backend_server, assert_no_js_errors):
    """V2：配置接口失败（网络/未迁移 5xx）时，静态兜底选项（0122 种子）仍渲染——
    必填 select 不为空，提交不因 fetch 失败被后端 400 卡死。"""
    dsn = os.environ["DATABASE_URL"]
    rid = _seed_qi_at_closure(dsn, accept_version="")
    try:
        # 拦截配置接口：直接失败（fetch reject → .catch 走 console.warn 静态兜底路径）
        page.route("**/api/qi/config/accept-versions*", lambda route: route.abort())
        page.goto(f"{backend_server}/qi/{rid}")
        page.wait_for_selector("#root", timeout=15000)
        result = page.wait_for_function(
            """() => {
                const s = document.getElementById('qi-stage-closure-accept_version');
                if (!s || s.tagName !== 'SELECT') return false;
                const opts = Array.from(s.options).map(o => o.value);
                return ['507.0', '507.1', '508.0'].every(v => opts.includes(v)) ? { opts } : false;
            }""",
            timeout=15000,
        )
        opts = result.json_value()["opts"]
        for v in ("507.0", "507.1", "508.0"):
            assert v in opts, f"fetch 失败时静态兜底应含 {v}，实际: {opts}"
    finally:
        page.unroute("**/api/qi/config/accept-versions*")
        _cleanup(dsn)
