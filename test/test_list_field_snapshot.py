"""_list_field_snapshot 单元测试（不依赖 API 服务）。"""
from __future__ import annotations

from datetime import datetime, timezone


def test_list_field_snapshot_description_last_submit_wins():
    """列表「问题描述」与继承字段一致：后序节点非空覆盖前序。"""
    from routers.tickets import _list_field_snapshot

    t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 1, 2, tzinfo=timezone.utc)
    t3 = datetime(2026, 1, 3, tzinfo=timezone.utc)
    snap = _list_field_snapshot(
        [
            {"values_json": {"issue_desc": "起单描述"}, "created_at": t1, "node_key": "problem_fill"},
            {"values_json": {"issue_desc": "运维分析补充"}, "created_at": t2, "node_key": "ops_analysis"},
            {"values_json": {"location": "北京"}, "created_at": t3, "node_key": "dev_analysis"},
        ]
    )
    assert snap["_description_raw"] == "运维分析补充"
    assert snap["_all_fields"]["issue_desc"] == "运维分析补充"


def test_issue_track_search_text_up_to_1000_plain_chars():
    """问题进展跟踪写入 search_text 时去 HTML 后最多 1000 字；列表预览仍 200。"""
    from datetime import datetime, timezone

    from routers import tickets as t
    from routers.tickets import _list_field_snapshot
    from ticket_list_snapshot import _build_search_text, _snapshot_search_parts

    marker = "FINDME_AT_950"
    plain = "a" * 950 + marker + "b" * 1200
    html = f"<p>{plain}</p><img src='data:image/png;base64,xxx' />"
    row = {
        "values_json": {"issue_track": html},
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "node_key": "ops_analysis",
    }
    snap = _list_field_snapshot([row])
    merged = snap["_all_fields"]["issue_track"]
    assert len(merged) <= 1000
    assert marker in merged
    assert "base64" not in merged.lower()

    extra_fields = {
        "issue_track": t._strip_html_list_preview(merged, t.SNAPSHOT_EXTRA_FIELDS_RICHTEXT_MAX),
    }
    assert len(extra_fields["issue_track"]) <= 200
    assert marker not in extra_fields["issue_track"]

    parts = _snapshot_search_parts(
        order_id="YW20260101001",
        creator_id="u1",
        creator_name="测试",
        current_stage="运维分析",
        handler_display="测试 u1",
        desc_plain="--",
        location="",
        biz_env="",
        sev="一般",
        start_date="2026-01-01",
        all_fields=snap["_all_fields"],
        extra_fields=extra_fields,
        t=t,
    )
    search_text = _build_search_text(parts)
    assert marker.lower() in search_text


def test_other_richtext_search_text_up_to_500_plain_chars():
    """根因等其它 richtext 写入 search_text 时去 HTML 后最多 500 字。"""
    from datetime import datetime, timezone

    from routers import tickets as t
    from routers.tickets import _list_field_snapshot
    from ticket_list_snapshot import _build_search_text, _snapshot_search_parts

    marker = "ROOT_CAUSE_MARKER"
    plain = "x" * 450 + marker + "y" * 200
    row = {
        "values_json": {"root_cause": f"<p>{plain}</p>"},
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "node_key": "dev_analysis",
    }
    snap = _list_field_snapshot([row])
    extra_fields = {
        "root_cause": t._strip_html_list_preview(
            snap["_all_fields"]["root_cause"], t.SNAPSHOT_EXTRA_FIELDS_RICHTEXT_MAX
        ),
    }
    assert marker not in extra_fields["root_cause"]

    parts = _snapshot_search_parts(
        order_id="YW20260101002",
        creator_id="u1",
        creator_name="测试",
        current_stage="开发分析",
        handler_display="测试 u1",
        desc_plain="--",
        location="",
        biz_env="",
        sev="一般",
        start_date="2026-01-01",
        all_fields=snap["_all_fields"],
        extra_fields=extra_fields,
        t=t,
    )
    assert marker.lower() in _build_search_text(parts)


def test_list_snapshot_keys_include_version_and_ops_closure_flags():
    """快照写入键须含引入/修复版本与运维闭环协同/报告标志；不含 problem_report。"""
    from datetime import datetime, timezone

    from routers.tickets import ALL_LIST_COLUMN_KEYS, WHITELIST_LIST_COLUMN_KEYS, _list_field_snapshot

    for key in (
        "intro_version",
        "fix_version",
        "has_collaborator",
        "output_problem_report",
    ):
        assert key in ALL_LIST_COLUMN_KEYS
        assert key in WHITELIST_LIST_COLUMN_KEYS
    assert "problem_report" not in ALL_LIST_COLUMN_KEYS

    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    snap = _list_field_snapshot(
        [
            {
                "values_json": {"intro_version": "V0.9", "fix_version": "V0.9.1"},
                "created_at": t0,
                "node_key": "dev_analysis",
            },
            {
                "values_json": {
                    "intro_version": "V1.0",
                    "fix_version": "V1.1",
                    "has_collaborator": "是",
                    "output_problem_report": "否",
                    "problem_report": "should-not-snapshot",
                },
                "created_at": t0,
                "node_key": "ops_closure",
            },
        ]
    )
    # 同键多节点：流程更后的运维闭环覆盖开发分析
    assert snap["_all_fields"]["intro_version"] == "V1.0"
    assert snap["_all_fields"]["fix_version"] == "V1.1"
    assert snap["_all_fields"]["has_collaborator"] == "是"
    assert snap["_all_fields"]["output_problem_report"] == "否"
    assert "problem_report" not in snap["_all_fields"]
    assert snap["_fields_by_node"]["dev_analysis"]["intro_version"] == "V0.9"
    assert snap["_fields_by_node"]["ops_closure"]["intro_version"] == "V1.0"
    assert snap["_fields_by_node"]["ops_closure"]["has_collaborator"] == "是"
