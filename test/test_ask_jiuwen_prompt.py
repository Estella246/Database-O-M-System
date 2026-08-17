"""Ask 九问提示词：合并口径与空字段省略（不依赖 DB）。"""

from __future__ import annotations

from utils.ask_jiuwen_prompt import (
    build_ask_jiuwen_prompt_text,
    merge_submitted_field_values,
    session_title_from_issue_desc,
    _plain_for_prompt,
)


def test_merge_later_node_nonempty_wins():
    rows = [
        {
            "node_key": "ops_analysis",
            "node_order": 3,
            "values_json": {
                "issue_intro_module": "模块A",
                "issue_desc": "<p>早期描述</p>",
                "handle_mode": "提交开发分析",
            },
        },
        {
            "node_key": "dev_analysis",
            "node_order": 4,
            "values_json": {
                "issue_intro_module": "模块B",
                "issue_desc": "",
                "root_cause": "<p>根因全文</p>",
            },
        },
    ]
    merged = merge_submitted_field_values(rows)
    assert merged["issue_intro_module"] == "模块B"
    # 后节点空不覆盖
    assert "早期描述" in str(merged["issue_desc"])
    assert "根因全文" in str(merged["root_cause"])
    assert "handle_mode" not in merged


def test_merge_skips_empty_and_draft_already_filtered():
    rows = [
        {
            "node_key": "problem_fill",
            "node_order": 1,
            "values_json": {"location": "局点X", "severity": ""},
        }
    ]
    merged = merge_submitted_field_values(rows)
    assert merged == {"location": "局点X"}


def test_prompt_omits_empty_keeps_long_richtext():
    long_body = "报错明细" + ("字" * 800)
    html = f"<p>{long_body}</p>"
    prompt = build_ask_jiuwen_prompt_text(
        ticket_no="YW20260817001",
        current_stage="运维分析",
        status="open",
        merged_values={
            "issue_desc": html,
            "location": "某局点",
            "severity": "严重",
            "ecare_ticket_no": "ECARE-001",
            "hcs_owner": "张三",
            "event_level": "一般问题",
            "customer_voice": "投诉",
            "use_doer_assist": "是",
            "has_collaborator": "否",
            "output_problem_report": "否",
            "front_pass_through": "否",
            "version_pass_through": "否",
            "warning_needed": "否",
            "handle_mode": "应被排除",
        },
        field_meta={
            "issue_desc": {"label": "问题描述", "type": "richtext"},
            "location": {"label": "局点", "type": "text"},
            "severity": {"label": "问题严重性", "type": "whitelist"},
            "ecare_ticket_no": {"label": "eCare单号", "type": "text"},
            "hcs_owner": {"label": "创建人", "type": "text"},
            "event_level": {"label": "事件级别", "type": "whitelist"},
            "customer_voice": {"label": "客户声音", "type": "whitelist"},
            "use_doer_assist": {"label": "是否使用Doer辅助", "type": "whitelist"},
            "has_collaborator": {"label": "是否有协同处理人", "type": "whitelist"},
            "output_problem_report": {"label": "是否输出问题报告", "type": "whitelist"},
            "front_pass_through": {"label": "是否前端透传", "type": "whitelist"},
            "version_pass_through": {"label": "是否透传至版本", "type": "whitelist"},
            "warning_needed": {"label": "是否需要预警", "type": "whitelist"},
            "handle_mode": {"label": "处理方式", "type": "whitelist"},
        },
    )
    assert "YW20260817001" in prompt
    assert "运维分析" in prompt
    assert "某局点" in prompt
    assert long_body in prompt
    assert "问题严重性" not in prompt
    assert "eCare单号" not in prompt
    assert "创建人" not in prompt
    assert "事件级别" not in prompt
    assert "客户声音" not in prompt
    assert "是否使用Doer辅助" not in prompt
    assert "是否有协同处理人" not in prompt
    assert "是否输出问题报告" not in prompt
    assert "是否前端透传" not in prompt
    assert "是否透传至版本" not in prompt
    assert "是否需要预警" not in prompt
    assert "处理方式" not in prompt
    assert "…" not in prompt or len(prompt) > 500


def test_merge_excludes_meta_field_keys():
    rows = [
        {
            "node_key": "ops_analysis",
            "node_order": 3,
            "values_json": {
                "location": "局点Y",
                "severity": "致命",
                "event_level": "事故",
                "use_doer_assist": "是",
            },
        }
    ]
    merged = merge_submitted_field_values(rows)
    assert merged == {"location": "局点Y"}


def test_plain_for_prompt_preserves_newlines():
    text = _plain_for_prompt("<p>第一行</p><p>第二行</p>", field_type="richtext")
    assert "第一行" in text
    assert "第二行" in text


def test_session_title_from_issue_desc():
    title = session_title_from_issue_desc(
        {"issue_desc": "<p>PVC 挂载失败导致业务中断</p>", "location": "某局点"},
        {"issue_desc": {"label": "问题描述", "type": "richtext"}},
        fallback="YW20260817001",
    )
    assert title == "PVC 挂载失败导致业务中断"

    long = "描" * 100
    truncated = session_title_from_issue_desc(
        {"issue_desc": f"<p>{long}</p>"},
        fallback="YW1",
    )
    assert truncated.endswith("…")
    assert len(truncated) == 81

    assert session_title_from_issue_desc({}, fallback="YW2") == "YW2"


def test_ask_jiuwen_prompt_api_404(api_client):
    resp = api_client.get("/api/tickets/YW99999999000/ask-jiuwen-prompt")
    assert resp.status_code == 404
