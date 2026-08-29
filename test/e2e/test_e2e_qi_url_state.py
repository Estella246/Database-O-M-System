"""
质量改进列表（/qi）筛选状态 URL 持久化 E2E：
1. 设筛选 → reload → URL/筛选图标激活态/行集保持（恢复的是条件不是数据）
2. reload 前新插一条匹配记录 → reload 后新数据出现 + 发出了带筛选参数的 GET /api/qi（实时拉取）
3. 筛选态点行进详情 → go_back → 筛选恢复（popstate 路径）
4. 深链 /qi?domain=… 直达 → 筛选生效；goto 裸 /qi → 默认态
5. /qi/new 深链 → URL 不被追加筛选 query（pathname 守卫）

判别设计：种子行均设 priority=高（列表按 高→中→低 + created_at DESC 排序，新建行最新，
保证落在第 1 页，不受库内 DENSE 演示数据分页干扰）；用唯一「领域」值区分两条记录
（后端 domain 为 ILIKE 子串匹配，E2E 专用领域值互不包含、不与存量数据交叉）。
"""
import os
from urllib.parse import quote

import psycopg
import pytest

pytestmark = pytest.mark.e2e

PREFIX = "E2E-QIURL-"
DOMAIN_A = PREFIX + "领域甲"
DOMAIN_B = PREFIX + "领域乙"
NO_A = PREFIX + "A"      # domain=DOMAIN_A
NO_B = PREFIX + "B"      # domain=DOMAIN_B
NO_NEW = PREFIX + "NEW"  # 场景2 reload 前新插入，domain=DOMAIN_A


def _insert_qi(conn, no, domain):
    conn.execute(
        """INSERT INTO qi_request
           (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
            priority, domain, module_feature, planned_version, reviewer,
            current_stage, current_status, creator_id, creator_name)
           VALUES (%s,'质量加固和改进','测试管理员 test_admin',%s,'','<p>t</p>','',
                   '高',%s,'驱动/JDBC','','测试管理员 test_admin',
                   'review','in_progress','test_admin','测试管理员 test_admin')""",
        (no, no, domain),
    )


def _seed_two(dsn):
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        _insert_qi(conn, NO_A, DOMAIN_A)
        _insert_qi(conn, NO_B, DOMAIN_B)
        conn.commit()


def _insert_one(dsn, no, domain):
    with psycopg.connect(dsn) as conn:
        _insert_qi(conn, no, domain)
        conn.commit()


def _cleanup(dsn):
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no LIKE %s", (PREFIX + "%",))
        conn.commit()


def _open_list(page, backend_server):
    page.goto(f"{backend_server}/qi")
    page.wait_for_selector("#qi-panel .req-table tbody", timeout=15000)
    page.wait_for_function(
        """() => {
          const rows = [...document.querySelectorAll('#qi-panel .req-table tbody tr[data-qi-no]')];
          return rows.some(r => r.dataset.qiNo === '%s') && rows.some(r => r.dataset.qiNo === '%s');
        }""" % (NO_A, NO_B),
        timeout=15000,
    )


def _visible_nos(page):
    return page.eval_on_selector_all(
        "#qi-panel .req-table tbody tr[data-qi-no]", "els => els.map(e => e.dataset.qiNo)"
    )


def _wait_rows(page, kept_nos, gone_nos):
    """等待行集收敛：kept 全部可见、gone 全部不可见。"""
    page.wait_for_function(
        """([kept, gone]) => {
          const rows = [...document.querySelectorAll('#qi-panel .req-table tbody tr[data-qi-no]')];
          return kept.every(n => rows.some(r => r.dataset.qiNo === n))
              && gone.every(n => !rows.some(r => r.dataset.qiNo === n));
        }""",
        arg=[kept_nos, gone_nos],
        timeout=15000,
    )


def _apply_domain_filter(page, domain):
    """点领域列头筛选 → 等下拉选项渲染（异步拉 filter-options）→ 选值 → 等行集收敛。"""
    page.click("#qi-filter-icon-domain")
    opt = f'.qi-filter-opt[data-filter-key="domain"][data-filter-value="{domain}"]'
    page.wait_for_selector(opt, timeout=15000)
    page.click(opt)
    _wait_rows(page, [NO_A] if domain == DOMAIN_A else [NO_B],
               [NO_B] if domain == DOMAIN_A else [NO_A])


def test_qi_filter_url_reload_and_fresh_data(page, backend_server, assert_no_js_errors):
    """场景 1+2：筛选后 reload 筛选保持；reload 前新写入的数据在恢复结果中存在（实时拉取）。"""
    dsn = os.environ["DATABASE_URL"]
    _seed_two(dsn)
    try:
        _open_list(page, backend_server)
        nos = _visible_nos(page)
        assert NO_A in nos and NO_B in nos, f"初始两条应在第 1 页可见，实际 {nos[:12]}"

        # 设 domain 筛选
        _apply_domain_filter(page, DOMAIN_A)
        assert "domain=" in page.url, f"筛选后 URL 应含 domain 参数，实际 {page.url}"
        icon_style = page.eval_on_selector("#qi-filter-icon-domain", "el => el.getAttribute('style')")
        assert "color" in icon_style, f"筛选图标应处于激活态，实际 {icon_style}"

        # reload 前新插一条同领域（模拟新写入数据/他人新提交）
        _insert_one(dsn, NO_NEW, DOMAIN_A)

        # 捕获 reload 后发出的列表请求，证明带筛选参数实时拉取
        list_requests = []
        page.on("request", lambda req: list_requests.append(req.url) if "/api/qi?" in req.url else None)
        page.reload()
        _wait_rows(page, [NO_A, NO_NEW], [NO_B])
        # 筛选状态恢复：URL + 行集（新数据在筛选结果中存在，不匹配的被排除）
        assert "domain=" in page.url, f"reload 后 URL 应保持筛选，实际 {page.url}"
        icon_style = page.eval_on_selector("#qi-filter-icon-domain", "el => el.getAttribute('style')")
        assert "color" in icon_style, "reload 后筛选图标应仍激活"
        assert any("domain=" in u for u in list_requests), (
            f"reload 后应发出带筛选参数的 GET /api/qi，实际请求 {list_requests[:5]}"
        )
    finally:
        _cleanup(dsn)


def test_qi_filter_back_from_detail(page, backend_server, assert_no_js_errors):
    """场景 3：筛选态点行进详情（pushState /qi/{id}）→ go_back → 筛选恢复。"""
    dsn = os.environ["DATABASE_URL"]
    _seed_two(dsn)
    try:
        _open_list(page, backend_server)
        _apply_domain_filter(page, DOMAIN_A)
        assert "domain=" in page.url

        # 点行进流程视图（pushState /qi/{id}）
        page.click(f'tr[data-qi-no="{NO_A}"]')
        page.wait_for_function("() => /\\/qi\\/\\d+/.test(location.pathname)", timeout=15000)

        page.go_back()
        page.wait_for_function(
            """() => /\\/qi\\/?$/.test(location.pathname) && location.search.includes('domain')""",
            timeout=15000,
        )
        _wait_rows(page, [NO_A], [NO_B])
        assert "domain=" in page.url, f"go_back 后筛选应恢复，实际 {page.url}"
    finally:
        _cleanup(dsn)


def test_qi_deep_link_and_bare_url(page, backend_server, assert_no_js_errors):
    """场景 4：深链 /qi?domain=… 直达筛选生效；裸 /qi 默认全量。"""
    dsn = os.environ["DATABASE_URL"]
    _seed_two(dsn)
    try:
        # 深链直达（带筛选 query）
        page.goto(f"{backend_server}/qi?domain={quote(DOMAIN_A)}")
        page.wait_for_selector("#qi-panel .req-table tbody", timeout=15000)
        _wait_rows(page, [NO_A], [NO_B])
        assert NO_A in _visible_nos(page), "深链应直接命中筛选"

        # 裸 /qi → 默认态（URL 为唯一真源）
        page.goto(f"{backend_server}/qi")
        page.wait_for_selector("#qi-panel .req-table tbody", timeout=15000)
        _wait_rows(page, [NO_A, NO_B], [])
        assert "domain=" not in page.url
    finally:
        _cleanup(dsn)


def test_qi_new_deep_link_keeps_url_clean(page, backend_server, assert_no_js_errors):
    """场景 5：/qi/new 深链 URL 不被追加筛选 query（pathname 守卫）。"""
    dsn = os.environ["DATABASE_URL"]
    _seed_two(dsn)
    try:
        page.goto(f"{backend_server}/qi/new")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(1500)
        assert "?" not in page.url, f"/qi/new 的 URL 不应被追加筛选 query，实际 {page.url}"
    finally:
        _cleanup(dsn)


def test_qi_tab_persist_and_sidebar_roundtrip(page, backend_server, assert_no_js_errors):
    """场景 6：页签切换 tab 进 URL 且 reload 保持；侧栏离开再回来 URL 筛选不丢（getUrlByKey 拼 query）。"""
    dsn = os.environ["DATABASE_URL"]
    _seed_two(dsn)
    try:
        _open_list(page, backend_server)
        # 页签：全部 → 我提出的 → reload 保持
        page.click('[data-qi-tab="mine"]')
        page.wait_for_function("() => location.search.includes('tab=mine')", timeout=15000)
        page.reload()
        page.wait_for_function(
            """() => {
              const b = document.querySelector('[data-qi-tab="mine"]');
              return b && b.classList.contains('active') && location.search.includes('tab=mine');
            }""",
            timeout=15000,
        )
        # 回「全部」设筛选，侧栏往返 URL/筛选不丢。
        # 竞态防护：_wait_rows 可能被 tab 切换前的旧 DOM 行满足（种子行在 mine 范围同样可见），
        # 而此时 tab 切换触发的 fetchQiList 仍在途——其响应重渲染表头时，筛选弹层模板整体重建
        # 且自带 hidden（qi-page.js renderQiList），会把刚打开的弹层替换成隐藏新节点（慢环境下
        # 全量混跑曾复现 click 超时）。故必须等该次列表请求落定后再打开弹层。
        with page.expect_response(
            lambda r: "/api/qi?" in r.url and "scope=all" in r.url, timeout=15000
        ):
            page.click('[data-qi-tab="all"]')
        page.wait_for_function("() => !location.search.includes('tab=')", timeout=15000)
        page.wait_for_timeout(300)  # 等响应后的渲染落定
        _wait_rows(page, [NO_A, NO_B], [])
        _apply_domain_filter(page, DOMAIN_A)
        assert "domain=" in page.url

        page.click('[data-nav-key="list"]')  # 工作台
        page.wait_for_function("() => /\\/workbench/.test(location.pathname)", timeout=15000)
        page.click('[data-nav-key="qi:manage"]')  # 质量改进
        page.wait_for_function(
            """() => /\\/qi\\/?$/.test(location.pathname) && location.search.includes('domain')""",
            timeout=15000,
        )
        _wait_rows(page, [NO_A], [NO_B])
    finally:
        _cleanup(dsn)
