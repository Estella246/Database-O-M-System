"""系统测试：在研责任田（田目录 + 节点关联两层模型）——参数页目录维护（增行/填名称责任人/保存/重载持久/删除）
+ 树节点「在研」弹窗（下拉选既有田/解除关联/多模块共田）+ 分析页四图（接纳率/闭环率/超期单数/超期率）。

口径：目录只管名称/责任人（名称目录内唯一）；「领域/模块」关联只在树节点弹窗配（单槽位绑定，可选既有田），
不同模块可绑同一田（统计按田合并）；接纳率=accepted/analyzed、闭环率=closed_done/accepted、
超期=in_progress 且 started_at+SLA 判超期；超期率=(analysis_overdue+closure_overdue)/(analysis_total+closure_total)。
匹配：domain 相同且（module 空=整领域，或 module_feature == module 或以 module+'/' 开头）；
模块槽位未命中任何田时人兜底——生效责任人（确认/实施阶段最新非空 qi_stage.responsible）属于
某田 owner（多人「；」分隔）即归该田，模块优先、每单最多归 0/1 个田。
"""
import os

import httpx
import psycopg
import pytest

pytestmark = pytest.mark.e2e

# 责任田树（树节点「在研」弹窗的槽位来源；与在研责任田目录相互独立）
RF_TREE = [
    {"label": "E2E研领域A", "children": [
        {"label": "E2E研模块A1", "owner": "张三 zhangsan", "children": []},
        {"label": "E2E研模块A2", "owner": "李四 lisi", "children": []},
    ]},
    {"label": "E2E研叶子领域C", "children": []},
]

# 田目录 + 各自关联（module 空 = 整领域槽位）。
# owner 必须是系统用户（PUT 校验；树节点 owner 是另一概念不受此校验，RF_TREE 保持虚构名）。
RF_ROWS = [
    {"name": "E2E田A1", "owner": "测试管理员 test_admin", "scopes": [{"domain": "E2E研领域A", "module": "E2E研模块A1"}]},
    {"name": "E2E田C", "owner": "测试用户02 test_user02", "scopes": [{"domain": "E2E研叶子领域C", "module": ""}]},
]


def _put_tree(backend_server, nodes):
    r = httpx.put(
        f"{backend_server}/api/params/duty-field/tree",
        json={"operator_id": "test_admin", "nodes": nodes},
        timeout=30,
    )
    assert r.status_code == 200, r.text


def _put_rf_rows(backend_server, rows):
    """目录全量替换 + 逐槽位绑定（两层模型造数入口）。"""
    r = httpx.put(
        f"{backend_server}/api/params/research-duty-field",
        json={"operator_id": "test_admin",
              "items": [{"name": x.get("name", ""), "owner": x.get("owner", "")} for x in rows]},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    id_by_name = {i["name"]: i["id"] for i in r.json().get("items", [])}
    for x in rows:
        for sc in x.get("scopes") or []:
            rb = httpx.put(
                f"{backend_server}/api/params/research-duty-field/binding",
                json={"operator_id": "test_admin", "domain": sc.get("domain", ""),
                      "module": sc.get("module", ""), "field_id": id_by_name.get(x["name"])},
                timeout=30,
            )
            assert rb.status_code == 200, rb.text


def _get_rf_rows(backend_server):
    r = httpx.get(f"{backend_server}/api/params/research-duty-field", timeout=30)
    assert r.status_code == 200, r.text
    return r.json().get("items", [])


@pytest.fixture
def rf_guard(backend_server):
    """用例前后保存/恢复责任田树与在研责任田目录+关联，避免污染其它用例。"""
    tree_before = httpx.get(f"{backend_server}/api/params/duty-field/tree", timeout=30).json().get("nodes", [])
    rows_before = _get_rf_rows(backend_server)
    yield
    _put_tree(backend_server, tree_before)
    _put_rf_rows(backend_server, rows_before)


def _seed_request(dsn, qi_no, domain, module_feature, stage, status):
    with psycopg.connect(dsn) as conn:
        row = conn.execute(
            """INSERT INTO qi_request
               (qi_no, category, proposer, title, related_ticket_no, description, expected_goal,
                priority, domain, module_feature, reviewer, current_stage, current_status,
                creator_id, creator_name)
               VALUES (%s, '特性加固', '张三 zhangsan', %s, 'x', 'd', 'g', '中', %s, %s,
                       'test_admin', %s, %s, 'test_admin', '测试管理员')
               RETURNING id""",
            (qi_no, qi_no, domain, module_feature, stage, status),
        ).fetchone()
        conn.commit()
        return row[0]


def _seed_analysis(dsn, request_id, accept, responsible=""):
    with psycopg.connect(dsn) as conn:
        sid = conn.execute(
            """INSERT INTO qi_stage (request_id, stage_key, sequence, status, responsible)
               VALUES (%s, 'analysis', 1, 'completed', %s) RETURNING id""",
            (request_id, responsible),
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
               VALUES (%s, %s, 'analysis', %s::jsonb, 'test_admin')""",
            (sid, request_id, f'{{"accept":"{accept}"}}'),
        )
        conn.commit()


def _seed_rf_analytics_data(dsn):
    """A1 田：3 已分析 2 接纳 1 闭环 + 1 closure 超期 + 1 analysis 在途不超期；C 整领域田：1 单未分析（无 qi_stage，不入在途）。

    期望图表值——接纳率 E2E田A1=round(2/3*100)=67%；闭环率 E2E田A1=round(1/2*100)=50%；超期 E2E田A1=1；
    超期率 E2E田A1=(0+1)/(1+1)=50%；E2E田C 在途 0 不入超期率图。
    """
    _cleanup_rf_data(dsn)
    rid_done = _seed_request(dsn, "E2ERF-1", "E2E研领域A", "E2E研模块A1", "acceptance", "closed")
    _seed_analysis(dsn, rid_done, "是")
    rid_prog = _seed_request(dsn, "E2ERF-2", "E2E研领域A", "E2E研模块A1", "closure", "in_progress")
    _seed_analysis(dsn, rid_prog, "是")
    rid_rej = _seed_request(dsn, "E2ERF-3", "E2E研领域A", "E2E研模块A1", "review", "in_progress")
    _seed_analysis(dsn, rid_rej, "否")
    # closure 超期：started 20 天前（> 默认 336h SLA）
    with psycopg.connect(dsn) as conn:
        sid = conn.execute(
            """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at)
               VALUES (%s, 'closure', 1, 'in_progress', NOW() - INTERVAL '20 days') RETURNING id""",
            (rid_prog,),
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO qi_stage_data (stage_id, request_id, stage_key, values_json, created_by)
               VALUES (%s, %s, 'closure', '{"sla_time":"2026-08-01"}'::jsonb, 'test_admin')""",
            (sid, rid_prog),
        )
        conn.commit()
    # analysis 在途不超期（started 1h < 72h）：进超期率分母、不进分子
    rid_an = _seed_request(dsn, "E2ERF-5", "E2E研领域A", "E2E研模块A1", "analysis", "in_progress")
    with psycopg.connect(dsn) as conn:
        conn.execute(
            """INSERT INTO qi_stage (request_id, stage_key, sequence, status, started_at)
               VALUES (%s, 'analysis', 1, 'in_progress', NOW() - INTERVAL '1 hour')""",
            (rid_an,),
        )
        conn.commit()
    _seed_request(dsn, "E2ERF-4", "E2E研叶子领域C", "", "analysis", "in_progress")


def _cleanup_rf_data(dsn):
    """清 E2E 残留（含其它 e2e 文件崩溃未清的行）：人兜底归桶后，任何 effective responsible
    等于测试用户的残留单都会漂移本文件的精确计数断言（分析页默认窗口是全量）。
    注意两个前缀都要：本文件自己的行是 'E2ERF-%'（E2E 后跟 R 不是连字符，'E2E-%'
    匹配不到它们——曾因此让本文件自己的行跨套件存活并污染 m20/m21 精确计数）；
    'E2E-%' 兜其它 e2e 文件（E2E-CLO-VER 等）。前提是 e2e 串行执行（无 xdist），
    若引入并行需改为按文件前缀收窄 + 独立数据库。"""
    with psycopg.connect(dsn) as conn:
        conn.execute("DELETE FROM qi_request WHERE qi_no LIKE 'E2E-%' OR qi_no LIKE 'E2ERF-%'")
        conn.commit()


def _echart_data(page, el_id):
    """取 ECharts 柱图的 x 轴类目与首系列数值。"""
    return page.evaluate("""(elId) => {
        const el = document.getElementById(elId);
        const inst = window.echarts && el && window.echarts.getInstanceByDom(el);
        if (!inst) return null;
        const opt = inst.getOption();
        const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
        return {
            x: (xa && xa.data) ? xa.data.map(String) : [],
            y: (opt.series && opt.series[0] && opt.series[0].data || []).map(d => (d && d.value !== undefined) ? d.value : d),
        };
    }""", el_id)


def _goto_params_page(page, backend_server):
    page.goto(f"{backend_server}/params/research-duty-field")
    page.wait_for_selector("#research-duty-field-panel", timeout=15000)


class TestResearchFieldParamsPage:
    """参数页「在研责任田」目录维护：只管名称/责任人，关联只读展示（在树节点上配）。"""

    def test_research_duty_field_crud_flow(self, page, backend_server, rf_guard, assert_no_js_errors):
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, [])
        _goto_params_page(page, backend_server)
        page.wait_for_timeout(1200)
        # 空态提示
        assert page.locator(".duty-field-hint", has_text="暂无在研责任田").count() == 1, "空表应显示空态提示"

        # 进入编辑：增两行，行内只有 名称/责任人 输入 + 只读关联文本（无领域/模块下拉）
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#rdf-add-row", timeout=10000)
        page.locator("#rdf-add-row").click()
        page.wait_for_timeout(300)
        page.locator("#rdf-add-row").click()
        page.wait_for_timeout(300)
        assert page.locator("#research-duty-field-panel [data-rdf-row]").count() == 2, "应有 2 个编辑行"
        assert page.locator("#research-duty-field-panel [data-rdf-domain]").count() == 0, "编辑行不应有领域下拉"
        assert page.locator("#research-duty-field-panel [data-rdf-module]").count() == 0, "编辑行不应有模块下拉"

        row0 = page.locator('[data-rdf-row][data-rdf-index="0"]')
        row0.locator("[data-rdf-name]").fill("E2E田A1")
        row0.locator("[data-rdf-owner]").fill("测试管理员 test_admin")
        row1 = page.locator('[data-rdf-row][data-rdf-index="1"]')
        row1.locator("[data-rdf-name]").fill("E2E田C")
        row1.locator("[data-rdf-owner]").fill("测试用户02 test_user02")

        # 保存 → 面板回到只读态并显示两行；新建田尚无关联 → 未关联提示文案
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        assert page.locator("#research-duty-field-panel .research-field-row--read").count() == 2, "保存后应显示 2 行"
        scope0 = page.locator(".research-field-row--read").nth(0).locator(".research-field-scope").inner_text()
        assert "未关联" in scope0 and "树节点" in scope0, f"新建田应提示关联在树上配: {scope0}"

        # API 读回：顺序=提交顺序，字段完整、无关联
        items = _get_rf_rows(backend_server)
        assert [i["name"] for i in items] == ["E2E田A1", "E2E田C"], f"API 读回应按提交顺序: {items}"
        assert items[0]["owner"] == "测试管理员 test_admin" and items[0]["scopes"] == []
        assert items[1]["owner"] == "测试用户02 test_user02" and items[1]["scopes"] == []

        # 重载页面：只读态持久展示
        _goto_params_page(page, backend_server)
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        assert page.locator("#research-duty-field-panel .research-field-row--read").count() == 2, "重载后仍应显示 2 行"
        assert page.locator(".research-field-name", has_text="E2E田A1").count() == 1

        # 再编辑：删除行 0 → 保存 → 仅剩 E2E田C
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#research-duty-field-panel [data-rdf-row]", timeout=10000)
        page.locator('[data-rdf-remove="0"]').click()
        page.wait_for_timeout(300)
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_timeout(1500)
        items = _get_rf_rows(backend_server)
        assert [i["name"] for i in items] == ["E2E田C"], f"删除后应仅剩 E2E田C: {items}"
        # 重载后只读行只剩 1 行
        _goto_params_page(page, backend_server)
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        assert page.locator("#research-duty-field-panel .research-field-row--read").count() == 1, "重载后应只剩 1 行"

        # 侧栏入口：hover「参数配置」→ 点击「在研责任田」子菜单可进入面板（覆盖导航点击路径与刷新钩子）
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=15000)
        page.wait_for_timeout(1200)
        page.locator('[data-nav-key="params:duty-field"]').first.hover()
        submenu_btn = page.locator('[data-nav-key="params:research-duty-field"]')
        assert submenu_btn.count() == 1, "侧栏参数配置子菜单应有「在研责任田」入口"
        submenu_btn.click()
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        assert page.locator("#research-duty-field-panel .research-field-row--read").count() == 1, "侧栏进入后应显示剩余 1 行"
        assert page.locator(".research-field-name", has_text="E2E田C").count() == 1, "剩余行应为 E2E田C"

    def test_multi_owner_save_normalization(self, page, backend_server, rf_guard, assert_no_js_errors):
        """多人责任人：混用历史分隔符「，」+ 重复段输入 → 保存规范化为「；」并去重保序；
        只读行全量展示；面板说明含多人写法与「责任人兜底」口径。"""
        _put_rf_rows(backend_server, [])
        _goto_params_page(page, backend_server)
        page.wait_for_timeout(1200)
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#rdf-add-row", timeout=10000)
        page.locator("#rdf-add-row").click()
        page.wait_for_timeout(300)
        row0 = page.locator('[data-rdf-row][data-rdf-index="0"]')
        row0.locator("[data-rdf-name]").fill("E2E多人田")
        row0.locator("[data-rdf-owner]").fill("测试用户01 test_user01，测试管理员 test_admin；测试用户01 test_user01")
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        items = _get_rf_rows(backend_server)
        assert items and items[0]["owner"] == "测试用户01 test_user01；测试管理员 test_admin", \
            f"多人责任人应规范化为「；」分隔并去重保序: {items}"
        owner_text = page.locator(".research-field-row--read").first.locator(".research-field-owner").inner_text()
        assert owner_text == "责任人：测试用户01 test_user01；测试管理员 test_admin", \
            f"只读行应全量展示规范化后的多人责任人: {owner_text}"
        # 超长多人责任人截断为省略号（title 悬浮可看全量）
        style = page.locator(".research-field-owner").first.evaluate(
            "el => { const cs = getComputedStyle(el); return [cs.whiteSpace, cs.textOverflow, cs.overflow]; }")
        assert style == ["nowrap", "ellipsis", "hidden"], f"只读行责任人应单行省略号截断: {style}"
        assert page.locator(".research-field-owner").first.get_attribute("title") == \
            "测试用户01 test_user01；测试管理员 test_admin", "title 应携带全量责任人"
        hint = page.locator("#research-duty-field-panel .duty-field-hint").last.inner_text()
        assert "「；」分隔" in hint and "责任人兜底" in hint, f"面板说明应含多人写法与兜底口径: {hint}"

    def test_owner_not_user_rejected_red_banner(self, page, backend_server, rf_guard, assert_no_js_errors):
        """责任人非系统用户：保存 400 → 红色错误横幅（含缺失段指引），留在编辑态数据不丢、不落库；
        修正为真实用户后可正常保存（错误可恢复）。"""
        _put_rf_rows(backend_server, [])
        _goto_params_page(page, backend_server)
        page.wait_for_timeout(1200)
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#rdf-add-row", timeout=10000)
        page.locator("#rdf-add-row").click()
        page.wait_for_timeout(300)
        row0 = page.locator('[data-rdf-row][data-rdf-index="0"]')
        row0.locator("[data-rdf-name]").fill("E2E假人田")
        row0.locator("[data-rdf-owner]").fill("测试用户01 test_user01；假人 no_such_user")
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_timeout(1500)
        banner = page.locator("#research-duty-field-panel .duty-field-banner--err")
        assert banner.count() == 1, "责任人非系统用户应展示红色错误横幅"
        banner_text = banner.inner_text()
        assert "责任人不存在" in banner_text and "假人 no_such_user" in banner_text, \
            f"横幅应含缺失段与修正指引: {banner_text}"
        assert page.locator("#research-duty-field-panel [data-rdf-row]").count() == 1, "保存失败应留在编辑态"
        assert page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-name]').input_value() == "E2E假人田", \
            "编辑行已填内容不应丢失"
        assert _get_rf_rows(backend_server) == [], "校验失败不应落库"

        # 修正为真实用户后重试保存成功
        page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-owner]').fill("测试用户01 test_user01；测试管理员 test_admin")
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        items = _get_rf_rows(backend_server)
        assert items and items[0]["owner"] == "测试用户01 test_user01；测试管理员 test_admin", f"修正后应可保存: {items}"

    def test_owner_format_prevalidation_alert(self, page, backend_server, rf_guard, assert_no_js_errors):
        """责任人段无空白（缺账号）：前端预校验 alert 指明问题段，不发保存请求、不落库。"""
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        _put_rf_rows(backend_server, [])
        _goto_params_page(page, backend_server)
        page.wait_for_timeout(1200)
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#rdf-add-row", timeout=10000)
        page.locator("#rdf-add-row").click()
        page.wait_for_timeout(300)
        page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-name]').fill("E2E格式田")
        page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-owner]').fill("测试用户01 test_user01；只有姓名")
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_timeout(800)
        assert any("责任人格式须为「姓名 账号」" in m and "只有姓名" in m for m in dialogs), \
            f"段无账号应弹前端预校验并指明问题段: {dialogs}"
        assert _get_rf_rows(backend_server) == [], "预校验失败不应落库"
        assert page.locator("#research-duty-field-panel [data-rdf-row]").count() == 1, "应留在编辑态"

    def test_readonly_scope_text_and_edit_preserves_binding(self, page, backend_server, rf_guard, assert_no_js_errors):
        """已有关联的田：只读行展示关联合并文本；编辑改名/责任人保存不丢关联（即使模块已不在树上）。"""
        _put_tree(backend_server, RF_TREE)  # 树里没有「RF失踪模块」
        _put_rf_rows(backend_server, [
            {"name": "E2E田失联", "owner": "测试管理员 test_admin",
             "scopes": [
                 {"domain": "E2E研领域A", "module": "RF失踪模块"},
                 {"domain": "E2E研叶子领域C", "module": ""},
             ]},
        ])
        _goto_params_page(page, backend_server)
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        scope = page.locator(".research-field-row--read").first.locator(".research-field-scope").inner_text()
        assert scope == "E2E研领域A/RF失踪模块、E2E研叶子领域C（整领域）", f"多条关联合并展示: {scope}"

        # 编辑：改名称/责任人（不碰关联），保存后关联原样保留
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#rdf-add-row", timeout=10000)
        page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-name]').fill("E2E田失联改名")
        page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-owner]').fill("Lazov i00822653")
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        rows = _get_rf_rows(backend_server)
        # ASCII「姓名 账号」经 canonical 换序存储（词元键匹配不受影响）
        assert len(rows) == 1 and rows[0]["name"] == "E2E田失联改名" and rows[0]["owner"] == "i00822653 Lazov", rows
        assert rows[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": "RF失踪模块"},
            {"domain": "E2E研叶子领域C", "module": ""},
        ], f"目录保存不应改动关联: {rows}"

    def test_edit_blocked_when_refresh_fails(self, page, backend_server, rf_guard, assert_no_js_errors):
        """进编辑前强制重拉：拉取失败不进编辑态（PUT 全量替换，不能拿空/旧快照误清全表）。"""
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, RF_ROWS)
        _goto_params_page(page, backend_server)
        page.wait_for_timeout(1200)
        assert page.locator("#research-duty-field-panel .research-field-row--read").count() == 2

        # 拦截编辑按钮触发的重拉，返回 500
        page.route("**/api/params/research-duty-field", lambda route: route.fulfill(status=500, body="boom"))
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_timeout(1500)
        assert page.locator("#rdf-add-row").count() == 0, "重拉失败不应进入编辑态"
        assert page.locator("#research-duty-field-panel .duty-field-banner").count() >= 1, "应展示错误横幅"
        assert page.locator("#research-duty-field-panel .research-field-row--read").count() == 2, "只读行应保留"

        # 解除拦截后重试应正常进编辑并带出既有行
        page.unroute("**/api/params/research-duty-field")
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#rdf-add-row", timeout=10000)
        assert page.locator('[data-rdf-row][data-rdf-index="0"]').count() == 1, "重拉成功后应带出既有行"
        rows = _get_rf_rows(backend_server)
        assert any(r["name"] == "E2E田A1" for r in rows), f"数据不应被破坏: {rows}"


class TestResearchFieldAnalyticsCharts:
    """分析页：在研责任田区块三图数值 + 点击放大 + 空态引导。"""

    def test_research_charts_no_match_show_empty(self, page, backend_server, rf_guard, assert_no_js_errors):
        """配置了责任田但窗口内无匹配单：区块渲染、四张图卡各自显示「暂无数据」空态。"""
        _put_rf_rows(backend_server, [
            {"name": "E2E田无匹配", "owner": "Lazov i00822653",
             "scopes": [{"domain": "E2E研无匹配领域", "module": ""}]},
        ])
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2500)
        section = page.locator(".req-analytics-section", has_text="在研责任田")
        assert section.count() >= 1, "有配置时区块应渲染（含图表容器）"
        for h in ["qi-analytics-echart-rf-acc", "qi-analytics-echart-rf-closure", "qi-analytics-echart-rf-overdue",
                  "qi-analytics-echart-rf-overdue-rate"]:
            empty = page.locator(f"#{h} .qi-stage-empty", has_text="暂无数据")
            assert empty.count() == 1, f"无匹配数据时 {h} 应显示「暂无数据」空态"

    def test_research_charts_values_and_zoom(self, page, backend_server, rf_guard, assert_no_js_errors):
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过在研责任田图表测试")
        _put_rf_rows(backend_server, RF_ROWS)
        _seed_rf_analytics_data(dsn)
        try:
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            section = page.locator(".req-analytics-section", has_text="在研责任田")
            assert section.count() >= 1, "应有「在研责任田」区块"
            hosts = ["qi-analytics-echart-rf-acc", "qi-analytics-echart-rf-closure", "qi-analytics-echart-rf-overdue",
                     "qi-analytics-echart-rf-overdue-rate"]
            for h in hosts:
                assert page.locator(f"#{h}").count() == 1, f"图表容器 {h} 应存在"
            acc = _echart_data(page, hosts[0])
            clo = _echart_data(page, hosts[1])
            ovd = _echart_data(page, hosts[2])
            rate = _echart_data(page, hosts[3])
            assert acc is not None and clo is not None and ovd is not None and rate is not None, "四张责任田图都应有 ECharts 实例"
            # E2E田A1: 接纳率 2/3=67%；闭环率 1/2=50%；超期 1；超期率 (0+1)/(1+1)=50%；E2E田C 未分析/无在途不入图
            assert acc["x"] == ["E2E田A1"], f"接纳率图应仅含 E2E田A1（C 未分析不入图）: {acc}"
            assert acc["y"] == [67], f"接纳率应为 67: {acc}"
            assert clo["x"] == ["E2E田A1"] and clo["y"] == [50], f"闭环率应为 50: {clo}"
            assert ovd["x"] == ["E2E田A1"] and ovd["y"] == [1], f"超期应为 1: {ovd}"
            assert rate["x"] == ["E2E田A1"], f"超期率图应仅含 E2E田A1（C 无确认/实施在途不入图）: {rate}"
            assert rate["y"] == [50], f"超期率应为 50（(0+1)/(1+1)）: {rate}"
            # 点击放大浮层
            page.locator(f"#{hosts[0]}").click()
            page.wait_for_timeout(800)
            assert page.locator(".qi-chart-zoom-overlay:not([hidden])").count() == 1, "点击应打开放大浮层"
            title = page.locator(".qi-chart-zoom-title").inner_text()
            assert "责任田接纳率" in title, f"浮层标题应为责任田接纳率: {title}"
            page.locator(".qi-chart-zoom-close").click()
            page.wait_for_timeout(300)
            # 第 4 张超期率图也可放大
            page.locator(f"#{hosts[3]}").click()
            page.wait_for_timeout(800)
            assert page.locator(".qi-chart-zoom-overlay:not([hidden])").count() == 1, "超期率图点击应打开放大浮层"
            title = page.locator(".qi-chart-zoom-title").inner_text()
            assert "责任田超期率" in title, f"浮层标题应为责任田超期率: {title}"
            page.locator(".qi-chart-zoom-close").click()
            page.wait_for_timeout(300)
        finally:
            _cleanup_rf_data(dsn)

    def test_research_deep_module_binding_attribution(self, page, backend_server, rf_guard, assert_no_js_errors):
        """三级以下槽位统计归因：(领域,「模块/特性」) 按前缀匹配 module_feature「模块/特性」与「模块/特性/子项」；
        更浅路径「模块」不误吞（若误吞接纳率为 2/3=67 而非 2/2=100）。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过深度槽位归因测试")
        _put_rf_rows(backend_server, [
            {"name": "E2E深田", "owner": "Lazov i00822653",
             "scopes": [{"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X"}]},
        ])
        try:
            _cleanup_rf_data(dsn)
            rid_exact = _seed_request(dsn, "E2ERF-D1", "E2E研领域A", "E2E研模块A1/E2E研特性X", "review", "closed")
            _seed_analysis(dsn, rid_exact, "是")
            rid_prefix = _seed_request(dsn, "E2ERF-D2", "E2E研领域A", "E2E研模块A1/E2E研特性X/E2E研子项Y", "review", "closed")
            _seed_analysis(dsn, rid_prefix, "是")
            # 更浅路径：单存在但未被接纳——若被误吞进该田则接纳率 2/3=67
            rid_shallow = _seed_request(dsn, "E2ERF-D3", "E2E研领域A", "E2E研模块A1", "review", "closed")
            _seed_analysis(dsn, rid_shallow, "否")
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            acc = _echart_data(page, "qi-analytics-echart-rf-acc")
            assert acc is not None, "接纳率图应有 ECharts 实例"
            assert acc["x"] == ["E2E深田"], f"深度槽位应命中精确与前缀两单: {acc}"
            assert acc["y"] == [100], f"接纳率应为 2/2=100（浅路径不误吞则 2/3=67）: {acc}"
        finally:
            _cleanup_rf_data(dsn)

    def test_research_charts_owner_fallback(self, page, backend_server, rf_guard, assert_no_js_errors):
        """人兜底归桶端到端：模块槽位未命中任何田的单，生效责任人（analysis 阶段 qi_stage.responsible）
        属于某田多人 owner 之一 → 计入该田；owner 不匹配的田不出现（每单最多归 0/1 田，无跨田重叠）。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过人兜底图表测试")
        # 两田均无模块关联：模块归桶必不命中，只能走人兜底
        _put_rf_rows(backend_server, [
            {"name": "E2E人兜底田", "owner": "测试用户01 test_user01；测试用户02 test_user02"},
            {"name": "E2E无关田", "owner": "Lazov i00822653"},
        ])
        try:
            _cleanup_rf_data(dsn)  # 先清残留再种数，精确计数不受其它 e2e 崩溃残留影响
            rid = _seed_request(dsn, "E2ERF-F1", "E2E研无主领域", "", "review", "closed")
            _seed_analysis(dsn, rid, "是", responsible="测试用户02 test_user02")  # 多人田的第二人命中
            page.goto(f"{backend_server}/stats/qi-analytics")
            page.wait_for_selector(".req-analytics-page", timeout=15000)
            page.wait_for_timeout(2500)
            acc = _echart_data(page, "qi-analytics-echart-rf-acc")
            assert acc is not None, "接纳率图应有 ECharts 实例"
            assert acc["x"] == ["E2E人兜底田"], f"无模块关联的单应经责任人兜底归田（无关田不出现）: {acc}"
            assert acc["y"] == [100], f"接纳率应为 1/1=100: {acc}"
        finally:
            _cleanup_rf_data(dsn)

    def test_research_empty_hint_when_no_rows(self, page, backend_server, rf_guard, assert_no_js_errors):
        _put_rf_rows(backend_server, [])
        page.goto(f"{backend_server}/stats/qi-analytics")
        page.wait_for_selector(".req-analytics-page", timeout=15000)
        page.wait_for_timeout(2000)
        section = page.locator(".req-analytics-section", has_text="在研责任田")
        assert section.count() >= 1, "区块标题应存在"
        assert section.locator(".qi-stage-empty", has_text="暂无在研责任田").count() == 1, "应显示空态引导文案"
        assert page.locator('[id^="qi-analytics-echart-rf-"]').count() == 0, "无配置时不应渲染责任田图表"


def _goto_duty_field_page(page, backend_server):
    page.goto(f"{backend_server}/params/duty-field")
    page.wait_for_selector("#duty-field-panel", timeout=15000)
    page.wait_for_timeout(800)


def _open_research_modal(page, path):
    page.locator(f'[data-df-research="{path}"]').first.click()
    page.wait_for_selector(".research-field-modal", timeout=10000)
    page.wait_for_selector("#research-field-node-name", timeout=10000)
    page.wait_for_timeout(300)


def _select_field_option(page, name):
    """在下拉中选中 label 以田名开头的选项（label 为「名称（责任人）」）。"""
    page.locator("#research-field-node-name").select_option(label=name)


class TestResearchFieldTreeEntry:
    """责任田树页按节点配置在研责任田：下拉选目录既有田（锁定槽位）、空目录/未选校验、换绑、解除、多模块共田、权限隐藏。"""

    def test_tree_modal_empty_catalog_and_unselected(self, page, backend_server, rf_guard, assert_no_js_errors):
        """目录为空：下拉禁用+提示、保存禁用；目录有田但未选：保存弹校验不落库。"""
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, [])
        _goto_duty_field_page(page, backend_server)
        page.wait_for_selector('[data-df-research="0"]', timeout=10000)

        _open_research_modal(page, "0")
        assert page.locator("#research-field-node-name").is_disabled(), "目录为空时下拉应禁用"
        hint = page.locator(".research-field-modal .duty-field-hint", has_text="目录为空").count()
        assert hint == 1, "应提示先到参数配置添加田"
        assert page.locator("#research-field-node-save-btn").is_disabled(), "目录为空时保存应禁用"
        assert _get_rf_rows(backend_server) == [], "不应有任何落库"

        # 关闭弹窗 → 通过 API 建目录田 → 重开弹窗可选择
        page.locator("#research-field-node-close-btn").click()
        page.wait_for_timeout(300)
        _put_rf_rows(backend_server, [{"name": "E2E树田整域", "owner": "测试管理员 test_admin"}])
        _goto_duty_field_page(page, backend_server)
        _open_research_modal(page, "0")
        assert not page.locator("#research-field-node-name").is_disabled(), "目录有田时下拉应可用"
        assert page.locator("#research-field-node-save-btn").count() == 1 and \
            not page.locator("#research-field-node-save-btn").is_disabled(), "目录有田时保存应可用"

        # 未选任何田直接保存 → 前端校验 alert，不落库
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(500)
        assert any("请选择在研责任田" in m for m in dialogs), f"未选应弹校验: {dialogs}"
        assert _get_rf_rows(backend_server)[0]["scopes"] == [], "校验失败不应产生关联"

    def test_tree_domain_node_binds_whole_domain_slot(self, page, backend_server, rf_guard, assert_no_js_errors):
        """领域节点「在研」→ 整领域槽位：下拉选田保存后仅 1 条 (领域,'') 关联，树出角标。"""
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, [{"name": "E2E树田整域", "owner": "测试管理员 test_admin"}])
        _goto_duty_field_page(page, backend_server)
        page.wait_for_selector('[data-df-research="0"]', timeout=10000)

        _open_research_modal(page, "0")
        scope = page.locator(".research-field-modal-scope").inner_text()
        assert "E2E研领域A" in scope and "整领域" in scope, f"弹窗应锁定整领域槽位: {scope}"
        assert page.locator("#research-field-node-remove-btn").count() == 0, "无关联时不应有解除按钮"

        _select_field_option(page, "E2E树田整域（测试管理员 test_admin）")
        page.wait_for_timeout(200)
        owner_val = page.locator("#research-field-node-owner").input_value()
        assert owner_val == "测试管理员 test_admin", f"责任人应随所选田只读带出: {owner_val}"
        assert page.locator("#research-field-node-owner").is_editable() is False, "责任人输入应只读"
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        assert page.locator(".research-field-modal").count() == 0, "保存成功后弹窗应关闭"
        items = _get_rf_rows(backend_server)
        # 全量级联：整域槽位绑定时子树全部下级（A1、A2）一并写入
        assert len(items) == 1 and items[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": ""},
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A2"},
        ], f"整域绑定应级联写入全部下级槽位: {items}"
        assert items[0]["name"] == "E2E树田整域" and items[0]["owner"] == "测试管理员 test_admin"
        # 角标断言限定节点自身行（> .duty-field-row），避免命中级联后子节点的角标
        badge = page.locator('[data-df-path="0"] > .duty-field-row .duty-field-research-badge')
        assert badge.count() == 1 and "E2E树田整域" in badge.inner_text(), "树上该领域节点应显示角标"

    def test_tree_module_node_binds_module_slot(self, page, backend_server, rf_guard, assert_no_js_errors):
        """模块节点「在研」→ (领域,模块) 槽位；深度 2 节点 → (领域, 二级起标签路径 join /) 槽位。"""
        _put_tree(backend_server, [
            {"label": "E2E研领域A", "children": [
                {"label": "E2E研模块A1", "owner": "张三 zhangsan", "children": [
                    {"label": "E2E研特性X", "children": []},
                ]},
            ]},
        ])
        _put_rf_rows(backend_server, [{"name": "E2E树田模块", "owner": "测试用户01 test_user01"}])
        _goto_duty_field_page(page, backend_server)
        page.wait_for_selector('[data-df-research="0.0"]', timeout=10000)
        # 深度 1 有子节点默认收起：先展开其子级
        assert page.locator('[data-df-research="0.0"]').is_visible(), "模块节点行应可见（子级收起不影响自身）"
        page.locator('[data-df-toggle="0.0"]').click()
        page.wait_for_selector('[data-df-path="0.0.0"]', timeout=5000)
        assert page.locator('[data-df-research="0.0.0"]').count() == 1, "深度 2 节点也应有在研按钮"

        _open_research_modal(page, "0.0")
        scope = page.locator(".research-field-modal-scope").inner_text()
        assert "E2E研领域A" in scope and "E2E研模块A1" in scope, f"弹窗应锁定 领域/模块 槽位: {scope}"
        _select_field_option(page, "E2E树田模块（测试用户01 test_user01）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = _get_rf_rows(backend_server)
        # 全量级联：绑定 A1 时其下级槽位（A1/特性X）一并写入
        assert len(items) == 1 and items[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X"},
        ], f"模块绑定应级联写入其下级槽位: {items}"
        badge = page.locator('[data-df-path="0.0"] > .duty-field-row .duty-field-research-badge')
        assert badge.count() == 1 and "E2E树田模块" in badge.inner_text(), "模块节点应显示角标"

        # 深度 2 节点：槽位 = (领域, 二级起标签路径按 / 连接)，与深度 1 槽位各自独立
        _open_research_modal(page, "0.0.0")
        scope = page.locator(".research-field-modal-scope").inner_text()
        assert "E2E研领域A" in scope and "E2E研模块A1/E2E研特性X" in scope, \
            f"深度 2 弹窗应锁定 领域/模块路径 槽位: {scope}"
        _select_field_option(page, "E2E树田模块（测试用户01 test_user01）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = _get_rf_rows(backend_server)
        assert items[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X"},
        ], f"深度 2 槽位应独立落库（多模块共田）: {items}"
        deep_badge = page.locator('[data-df-path="0.0.0"] > .duty-field-row .duty-field-research-badge')
        assert deep_badge.count() == 1 and "E2E树田模块" in deep_badge.inner_text(), "深度 2 节点应显示角标"

    def test_tree_deep_node_level4_bind_and_unbind(self, page, backend_server, rf_guard, assert_no_js_errors):
        """四级节点（证明三级以下任意层级可配）：绑定 → 角标 + 三段模块路径落库；解除 → 角标消失、田保留。"""
        page.on("dialog", lambda d: d.accept())
        _put_tree(backend_server, [
            {"label": "E2E研领域A", "children": [
                {"label": "E2E研模块A1", "children": [
                    {"label": "E2E研特性X", "children": [
                        {"label": "E2E研子项Y", "children": []},
                    ]},
                ]},
            ]},
        ])
        _put_rf_rows(backend_server, [{"name": "E2E深田", "owner": "Lazov i00822653"}])
        _goto_duty_field_page(page, backend_server)
        # 一级默认展开、二级及以下默认收起：逐层展开到四级
        for toggle in ("0.0", "0.0.0"):
            page.locator(f'[data-df-toggle="{toggle}"]').click()
            page.wait_for_timeout(200)
        page.wait_for_selector('[data-df-path="0.0.0.0"]', timeout=5000)
        assert page.locator('[data-df-research="0.0.0.0"]').count() == 1, "四级节点应有在研按钮"

        _open_research_modal(page, "0.0.0.0")
        scope = page.locator(".research-field-modal-scope").inner_text()
        assert "E2E研模块A1/E2E研特性X/E2E研子项Y" in scope, f"四级节点模块路径应为三段: {scope}"
        # 下拉 label 用存储侧 owner（ASCII「姓名 账号」经 canonical 换序为「账号 姓名」）
        _select_field_option(page, "E2E深田（i00822653 Lazov）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = _get_rf_rows(backend_server)
        assert items[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X/E2E研子项Y"}
        ], f"四级槽位应落库: {items}"
        badge = page.locator('[data-df-path="0.0.0.0"] .duty-field-research-badge')
        assert badge.count() == 1 and "E2E深田" in badge.inner_text(), "四级节点应显示角标"

        # 解除关联：槽位移除、角标消失，田保留在目录
        _open_research_modal(page, "0.0.0.0")
        page.locator("#research-field-node-remove-btn").click()
        page.wait_for_timeout(1200)
        assert page.locator(".research-field-modal").count() == 0, "解除后弹窗应关闭"
        items = _get_rf_rows(backend_server)
        assert items[0]["name"] == "E2E深田" and items[0]["scopes"] == [], f"解除后田应保留且无关联: {items}"
        assert page.locator('[data-df-path="0.0.0.0"] .duty-field-research-badge').count() == 0, "解除后角标应消失"

    def test_tree_modal_prefill_and_rebind(self, page, backend_server, rf_guard, assert_no_js_errors):
        """已配槽位开窗回显所选田；换选另一田保存：仅该槽位关联移动、目录顺序不变。"""
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, RF_ROWS)
        _goto_duty_field_page(page, backend_server)

        _open_research_modal(page, "0.0")
        sel_val = page.locator("#research-field-node-name").input_value()
        items = _get_rf_rows(backend_server)
        a1 = next(i for i in items if i["name"] == "E2E田A1")
        assert sel_val == str(a1["id"]), "应回显已绑定的田"
        assert page.locator("#research-field-node-owner").input_value() == "测试管理员 test_admin", "应回显田的责任人"
        assert page.locator("#research-field-node-remove-btn").count() == 1, "已关联时应出现解除按钮"

        # 换选 E2E田C → 保存：槽位 (E2E研领域A, E2E研模块A1) 的关联移到田C
        _select_field_option(page, "E2E田C（测试用户02 test_user02）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = _get_rf_rows(backend_server)
        assert [i["name"] for i in items] == ["E2E田A1", "E2E田C"], f"目录顺序应保持: {items}"
        a1 = next(i for i in items if i["name"] == "E2E田A1")
        c = next(i for i in items if i["name"] == "E2E田C")
        assert a1["scopes"] == [], f"原田应失去该槽位关联: {a1}"
        assert {"domain": "E2E研领域A", "module": "E2E研模块A1"} in c["scopes"], f"新田应获得该槽位关联: {c}"
        assert {"domain": "E2E研叶子领域C", "module": ""} in c["scopes"], f"田C 原整领域关联应保留: {c}"

    def test_tree_modal_unbind_keeps_catalog(self, page, backend_server, rf_guard, assert_no_js_errors):
        """解除关联：confirm 后槽位关联移除、角标消失，田仍保留在目录（含其其它关联）。"""
        page.on("dialog", lambda d: d.accept())
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, RF_ROWS)
        _goto_duty_field_page(page, backend_server)
        page.wait_for_selector('[data-df-path="0.0"] .duty-field-research-badge', timeout=10000)

        _open_research_modal(page, "0.0")
        assert page.locator("#research-field-node-remove-btn").inner_text().strip() == "解除关联"
        page.locator("#research-field-node-remove-btn").click()
        page.wait_for_timeout(1200)
        assert page.locator(".research-field-modal").count() == 0, "解除后弹窗应关闭"
        items = _get_rf_rows(backend_server)
        a1 = next(i for i in items if i["name"] == "E2E田A1")
        assert a1["scopes"] == [], f"槽位关联应已移除: {a1}"
        assert any(i["name"] == "E2E田A1" for i in items), "田应保留在目录中"
        assert page.locator('[data-df-path="0.0"] .duty-field-research-badge').count() == 0, "解除后角标应消失"
        assert page.locator('[data-df-path="1"] .duty-field-research-badge').count() == 1, "C 整领域角标应保留"

    def test_tree_two_modules_share_one_field(self, page, backend_server, rf_guard, assert_no_js_errors):
        """多模块共田：两个模块节点选同一个田 → 两个角标同名、目录里该田有两条关联。"""
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, [{"name": "E2E共田", "owner": "Lazov i00822653"}])
        _goto_duty_field_page(page, backend_server)

        for path in ("0.0", "0.1"):
            _open_research_modal(page, path)
            _select_field_option(page, "E2E共田（i00822653 Lazov）")
            page.locator("#research-field-node-save-btn").click()
            page.wait_for_timeout(1200)
            assert page.locator(".research-field-modal").count() == 0, "保存后弹窗应关闭"

        badge0 = page.locator('[data-df-path="0.0"] .duty-field-research-badge').inner_text()
        badge1 = page.locator('[data-df-path="0.1"] .duty-field-research-badge').inner_text()
        assert "E2E共田" in badge0 and "E2E共田" in badge1, f"两个模块节点角标应同名: {badge0!r} {badge1!r}"
        items = _get_rf_rows(backend_server)
        assert len(items) == 1 and items[0]["name"] == "E2E共田", f"目录应只有 1 个田: {items}"
        assert items[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A2"},
        ], f"该田应有两条模块关联: {items}"

    def test_tree_and_panel_cross_entry_consistency(self, page, backend_server, rf_guard, assert_no_js_errors):
        """树入口绑田 → 独立面板可见并可改名保存 → 回树页角标显示新名（双入口编辑同一目录）。"""
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, [{"name": "E2E双入口田", "owner": "测试管理员 test_admin"}])
        _goto_duty_field_page(page, backend_server)
        page.wait_for_selector('[data-df-research="0"]', timeout=10000)
        _open_research_modal(page, "0")
        _select_field_option(page, "E2E双入口田（测试管理员 test_admin）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = _get_rf_rows(backend_server)
        # 全量级联：整域绑定写入 A1、A2 下级槽位
        assert items and items[0]["scopes"] == [
            {"domain": "E2E研领域A", "module": ""},
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A2"},
        ], f"树入口应已绑定（含级联下级）: {items}"

        # 面板页：显示该田（带关联文本）并改名保存
        _goto_params_page(page, backend_server)
        page.wait_for_selector('#research-duty-field-panel .research-field-row--read', timeout=10000)
        assert page.locator(".research-field-name", has_text="E2E双入口田").count() == 1, "面板应显示树入口绑的田"
        scope = page.locator(".research-field-row--read").first.locator(".research-field-scope").inner_text()
        assert scope == "E2E研领域A（整领域）、E2E研领域A/E2E研模块A1、E2E研领域A/E2E研模块A2", \
            f"面板只读行应展示树入口配的关联（含级联下级）: {scope}"
        page.locator("#research-duty-field-edit-btn").click()
        page.wait_for_selector("#research-duty-field-panel [data-rdf-row]", timeout=10000)
        page.locator('[data-rdf-row][data-rdf-index="0"] [data-rdf-name]').fill("E2E双入口田改名")
        page.locator("#research-duty-field-save-btn").click()
        page.wait_for_selector("#research-duty-field-panel .research-field-row--read", timeout=10000)
        assert any(i["name"] == "E2E双入口田改名" for i in _get_rf_rows(backend_server)), "面板改名应已落库"

        # 回树页：角标显示新名（限定节点自身行，级联后子节点也有同名角标）
        _goto_duty_field_page(page, backend_server)
        page.wait_for_selector('[data-df-path="0"] > .duty-field-row .duty-field-research-badge', timeout=10000)
        assert "E2E双入口田改名" in page.locator('[data-df-path="0"] > .duty-field-row .duty-field-research-badge').inner_text(), \
            "树页角标应显示面板改的名"

    def test_tree_cascade_write_and_badge_inheritance(self, page, backend_server, rf_guard, assert_no_js_errors):
        """修改上级级联下级（全量写入）+ 继承角标 + 解除仅自身 + 换绑覆盖。"""
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        # 空标签节点走不到 e2e（树 PUT 对空 label 400），其下钻防御分支由 jest 单测覆盖
        tree = [{"label": "E2E研领域A", "children": [
            {"label": "E2E研模块A1", "children": [
                {"label": "E2E研特性X", "children": [
                    {"label": "E2E研子项Y", "children": []},
                ]},
            ]},
        ]}]
        _put_tree(backend_server, tree)
        _put_rf_rows(backend_server, [
            {"name": "E2E级联田一", "owner": "测试管理员 test_admin"},
            {"name": "E2E级联田二", "owner": "测试用户01 test_user01"},
        ])
        _goto_duty_field_page(page, backend_server)
        for toggle in ("0.0", "0.0.0"):
            page.locator(f'[data-df-toggle="{toggle}"]').click()
            page.wait_for_timeout(200)
        page.wait_for_selector('[data-df-path="0.0.0.0"]', timeout=5000)

        # 1) 绑定 0.0（A1）→ 田一：子树全量写入（X、X/Y），节点角标均为自身绑定
        _open_research_modal(page, "0.0")
        hint = page.locator(".research-field-modal .duty-field-hint", has_text="保存后将同时为").inner_text()
        assert "2 个下级节点" in hint, f"弹窗应提示级联下级数量: {hint}"
        _select_field_option(page, "E2E级联田一（测试管理员 test_admin）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = {i["name"]: i for i in _get_rf_rows(backend_server)}
        assert items["E2E级联田一"]["scopes"] == [
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X"},
            {"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X/E2E研子项Y"},
        ], f"绑定上级应全量级联写入下级槽位: {items['E2E级联田一']}"
        for path in ("0.0", "0.0.0", "0.0.0.0"):
            badge = page.locator(f'[data-df-path="{path}"] > .duty-field-row .duty-field-research-badge')
            assert badge.count() == 1 and "E2E级联田一" in badge.inner_text() and "继承" not in badge.inner_text(), \
                f"{path} 应显示自身绑定角标: {badge.inner_text() if badge.count() else '无'}"
            assert badge.get_attribute("class").find("--inherited") == -1, f"{path} 不应有继承样式"

        # 2) 解除 0.0.0（A1/X）仅自身：深槽位保留，A1/X 角标变为继承田一
        _open_research_modal(page, "0.0.0")
        page.locator("#research-field-node-remove-btn").click()
        page.wait_for_timeout(1200)
        assert any("仅解除本节点，下级绑定不变" in m for m in dialogs), f"解除 confirm 应注明不级联: {dialogs}"
        items = {i["name"]: i for i in _get_rf_rows(backend_server)}
        assert items["E2E级联田一"]["scopes"] == [
            {"domain": "E2E研领域A", "module": "E2E研模块A1"},
            {"domain": "E2E研领域A", "module": "E2E研模块A1/E2E研特性X/E2E研子项Y"},
        ], f"解除应仅自身槽位: {items['E2E级联田一']}"
        inherited = page.locator('[data-df-path="0.0.0"] > .duty-field-row .duty-field-research-badge')
        assert inherited.count() == 1 and "E2E级联田一（继承）" in inherited.inner_text(), \
            f"未绑定下级应显示继承角标: {inherited.inner_text() if inherited.count() else '无'}"
        assert "--inherited" in (inherited.get_attribute("class") or ""), "继承角标应有弱化样式类"

        # 3) 换绑 0.0 → 田二：子树全量覆盖（A1/X 重新有自身绑定），田一清空
        _open_research_modal(page, "0.0")
        _select_field_option(page, "E2E级联田二（测试用户01 test_user01）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = {i["name"]: i for i in _get_rf_rows(backend_server)}
        # 顺序按绑定表 id 序（换绑时 A1/X 为新插入），按模块排序比较
        assert sorted(s["module"] for s in items["E2E级联田二"]["scopes"]) == [
            "E2E研模块A1", "E2E研模块A1/E2E研特性X", "E2E研模块A1/E2E研特性X/E2E研子项Y",
        ], f"换绑上级应全量覆盖下级槽位: {items['E2E级联田二']}"
        assert items["E2E级联田一"]["scopes"] == [], f"原田应清空: {items['E2E级联田一']}"
        for path in ("0.0", "0.0.0", "0.0.0.0"):
            badge = page.locator(f'[data-df-path="{path}"] > .duty-field-row .duty-field-research-badge')
            assert badge.count() == 1 and "E2E级联田二" in badge.inner_text() and "继承" not in badge.inner_text(), \
                f"换绑后 {path} 应显示田二自身绑定角标"

        # 4) 整域兜底继承：绑定 0（整领域）→ 田一（级联覆盖全部子树）后解除 0.0（仅自身），
        #    0.0 自身无绑定 → 角标经模块路径逐级回退后落到整领域槽位，显示「田一（继承）」
        _open_research_modal(page, "0")
        _select_field_option(page, "E2E级联田一（测试管理员 test_admin）")
        page.locator("#research-field-node-save-btn").click()
        page.wait_for_timeout(1200)
        items = {i["name"]: i for i in _get_rf_rows(backend_server)}
        assert sorted(s["module"] for s in items["E2E级联田一"]["scopes"]) == [
            "", "E2E研模块A1", "E2E研模块A1/E2E研特性X", "E2E研模块A1/E2E研特性X/E2E研子项Y",
        ], f"整域绑定应级联覆盖全部下级: {items['E2E级联田一']}"
        assert items["E2E级联田二"]["scopes"] == []

        _open_research_modal(page, "0.0")
        page.locator("#research-field-node-remove-btn").click()
        page.wait_for_timeout(1200)
        dom_badge = page.locator('[data-df-path="0.0"] > .duty-field-row .duty-field-research-badge')
        assert dom_badge.count() == 1 and "E2E级联田一（继承）" in dom_badge.inner_text(), \
            f"自身无绑定时角标应回退到整域槽位继承: {dom_badge.inner_text() if dom_badge.count() else '无'}"
        assert "--inherited" in (dom_badge.get_attribute("class") or ""), "整域兜底继承角标应有弱化样式类"

    def test_tree_research_entry_hidden_by_whitelist(self, page, backend_server, rf_guard, assert_no_js_errors):
        """在研权限 hidden：树页按钮与角标均不渲染（PUT 服务端 403 已由接口测试锁定）。"""
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            pytest.skip("无 DATABASE_URL，跳过权限隐藏测试")
        _put_tree(backend_server, RF_TREE)
        _put_rf_rows(backend_server, RF_ROWS)
        prev_level = None
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT permission_level FROM role_permission_policy
                       WHERE role_code='管理员' AND is_pl=false AND node_key='__whitelist__'
                         AND field_key='params_research_duty_field'""")
                row = cur.fetchone()
            prev_level = row[0] if row else None
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO role_permission_policy
                           (role_code, is_pl, node_key, field_key, permission_level, updated_by)
                           VALUES ('管理员', false, '__whitelist__', 'params_research_duty_field', 'hidden', 'pytest')
                           ON CONFLICT (role_code, is_pl, node_key, field_key)
                           DO UPDATE SET permission_level = 'hidden'""")
                conn.commit()
            _goto_duty_field_page(page, backend_server)
            page.wait_for_selector(".duty-field-li", timeout=10000)
            # 权限数据可能晚于首帧渲染：轮询等待按钮归零（若始终存在则超时失败）
            page.wait_for_function(
                "() => document.querySelectorAll('[data-df-research]').length === 0",
                timeout=8000,
            )
            page.wait_for_timeout(500)
            assert page.locator("[data-df-research]").count() == 0, "权限 hidden 时不应渲染在研按钮"
            assert page.locator(".duty-field-research-badge").count() == 0, "权限 hidden 时不应渲染在研角标"
        finally:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    if prev_level is None:
                        cur.execute(
                            """DELETE FROM role_permission_policy
                               WHERE role_code='管理员' AND is_pl=false AND node_key='__whitelist__'
                                 AND field_key='params_research_duty_field'""")
                    else:
                        cur.execute(
                            """UPDATE role_permission_policy SET permission_level = %s
                               WHERE role_code='管理员' AND is_pl=false AND node_key='__whitelist__'
                                 AND field_key='params_research_duty_field'""",
                            (prev_level,))
                conn.commit()
