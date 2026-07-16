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
               VALUES (%s,'质量加固和改进','测试管理员 test_admin','amend渲染测试','','<p>测试</p>','',
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
                "category": "质量加固和改进", "title": "amend渲染测试", "description": "<p>测试</p>",
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
               VALUES (%s,'质量加固和改进','测试用户01 test_user01','富文本回显测试','',%s,'',
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
                "category": "质量加固和改进", "title": "富文本回显测试",
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
