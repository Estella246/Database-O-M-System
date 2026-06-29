"""老库 form_data 解析与富文本合并单测。"""
from __future__ import annotations

import json

from backend.legacy_form_data import (
    merge_field_value,
    merge_form_values_into,
    merge_parse_with_form_values,
    normalize_legacy_richtext,
    parse_legacy_form_data,
)

_CN_MAP = {
    "问题进展跟踪": "issue_track",
    "问题描述": "issue_desc",
    "规避措施/恢复方法": "workaround",
}


def test_normalize_legacy_richtext_plain_newlines():
    out = normalize_legacy_richtext("行1\n行2")
    assert "<br>" in out
    assert "行1" in out and "行2" in out


def test_normalize_legacy_richtext_preserves_html_and_img():
    html = '<p>截图</p><img src="data:image/png;base64,abc123" />'
    assert normalize_legacy_richtext(html) == html


def test_merge_field_value_richtext_prefers_form_with_img():
    parse_val = "截断前缀"
    form_val = '截断前缀<img src="data:image/png;base64,xyz" />'
    assert merge_field_value("issue_track", parse_val, form_val) == form_val


def test_merge_field_value_richtext_prefers_longer_form():
    parse_val = "短"
    form_val = "更长的完整问题进展跟踪内容"
    assert merge_field_value("issue_track", parse_val, form_val) == form_val


def test_parse_legacy_form_data_cn_field_name_array():
    raw = json.dumps(
        [
            {
                "cnFieldName": "问题进展跟踪",
                "tipInfo": "",
                "fieldValue": "<p>行1</p><img src=\"data:image/png;base64,abc\" />",
            }
        ],
        ensure_ascii=False,
    )
    out = parse_legacy_form_data(raw, _CN_MAP)
    assert "issue_track" in out
    assert "<img" in out["issue_track"]
    assert "行1" in out["issue_track"]


def test_parse_legacy_form_data_wrapped_list():
    raw = json.dumps(
        {
            "formData": [
                {
                    "cnFieldName": "问题描述",
                    "fieldValue": "纯文本\n第二行",
                }
            ]
        },
        ensure_ascii=False,
    )
    out = parse_legacy_form_data(raw, _CN_MAP)
    assert "issue_desc" in out
    assert "<br>" in out["issue_desc"]


def test_merge_parse_with_form_values():
    merged = merge_parse_with_form_values(
        {"issue_track": "截断"},
        {"issue_track": '截断<img src="data:image/png;base64,x" />'},
    )
    assert "<img" in merged["issue_track"]


def test_merge_form_values_into_accumulates_tasks():
    base = {"issue_track": "运维阶段"}
    later = {"issue_track": "运维阶段\n开发已接手"}
    out = merge_form_values_into(base, later)
    assert "开发已接手" in out["issue_track"]
