"""老库 t_work_flow_task.form_data 解析：cnFieldName → 新平台 field_key，富文本与图片恢复。"""
from __future__ import annotations

import html
import json
import logging
import re
from typing import Any, Callable

import psycopg

from utils.module_cascade_path import (
    MODULE_CASCADE_FIELD_KEYS,
    normalize_module_cascade_path,
)

logger = logging.getLogger(__name__)

LEGACY_RICHTEXT_FIELD_KEYS = frozenset(
    {
        "issue_desc",
        "issue_track",
        "workaround",
        "root_cause",
        "dfx_gap",
        "sla_analysis",
    }
)

LEGACY_PLAIN_TEXT_FIELD_KEYS = frozenset(
    {
        "error_text",
        "core_stack_text",
        "error_archive_text",
    }
)

_FORM_VALUE_KEYS = (
    "fieldValue",
    "value",
    "fieldValueText",
    "defaultValue",
    "field_value",
)

_FORM_ITEMS_WRAPPER_KEYS = ("formData", "form_data", "fields", "data", "list")

_HTML_TAG_RE = re.compile(r"<\s*(p|br|div|img|span|table|ul|ol|li|h[1-6])\b", re.I)
_PLAIN_TEXT_BR_RE = re.compile(r"<\s*br\s*/?\s*>", re.I)
_PLAIN_TEXT_BLOCK_END_RE = re.compile(
    r"<\s*/\s*(p|div|li|tr|h[1-6])\s*>", re.I
)
_PLAIN_TEXT_TAG_RE = re.compile(r"<[^>]+>")


_CN_LABEL_ALIASES = {
    "问题模块": "issue_intro_module",
    "问题引入模块": "issue_intro_module",
    "问题归属模块": "issue_owner_module",
}


def load_cn_label_to_field_key(
    conn: psycopg.Connection, template_code: str
) -> dict[str, str]:
    """新平台 node_field_def.field_name → field_key。"""
    rows = conn.execute(
        """
        SELECT DISTINCT nfd.field_name, nfd.field_key
        FROM node_field_def nfd
        JOIN workflow_node wn ON wn.id = nfd.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s AND nfd.is_active = TRUE
        """,
        (template_code,),
    ).fetchall()
    out: dict[str, str] = {}
    for row in rows:
        label = str(row.get("field_name") or "").strip()
        key = str(row.get("field_key") or "").strip()
        if label and key:
            out[label] = key
    for label, key in _CN_LABEL_ALIASES.items():
        out.setdefault(label, key)
    return out


def _looks_like_html(text: str) -> bool:
    return bool(_HTML_TAG_RE.search(text))


def normalize_legacy_plain_text(val: str) -> str:
    """老库 plain text 字段在 form_data 中可能带编辑器 HTML 包装，还原为纯文本。"""
    s = str(val or "")
    if not s.strip():
        return ""
    s = s.replace("\\n", "\n").replace("\\r", "\r")
    if not _looks_like_html(s):
        return s.strip()
    s = _PLAIN_TEXT_BR_RE.sub("\n", s)
    s = _PLAIN_TEXT_BLOCK_END_RE.sub("\n", s)
    s = _PLAIN_TEXT_TAG_RE.sub("", s)
    s = html.unescape(s)
    lines = [line.strip() for line in s.splitlines()]
    if not lines:
        return ""
    if len(lines) == 1:
        return lines[0]
    return "\n".join(lines).strip()


def normalize_legacy_richtext(val: str) -> str:
    """纯文本换行转 HTML；已有 HTML（含 img）原样保留。"""
    s = str(val or "")
    if not s.strip():
        return ""
    s = s.replace("\\n", "\n").replace("\\r", "\r")
    if _looks_like_html(s):
        return s.strip()
    escaped = (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    parts = re.split(r"\r\n|\r|\n", escaped)
    return "<br>".join(parts)


def _field_value_from_item(item: dict[str, Any]) -> str:
    for key in _FORM_VALUE_KEYS:
        raw = item.get(key)
        if raw is None:
            continue
        if isinstance(raw, (dict, list)):
            try:
                text = json.dumps(raw, ensure_ascii=False)
            except (TypeError, ValueError):
                text = str(raw)
        else:
            text = str(raw)
        if text.strip():
            return text
    return ""


def _extract_form_items(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for key in _FORM_ITEMS_WRAPPER_KEYS:
            inner = data.get(key)
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        if data.get("cnFieldName") or data.get("cn_field_name"):
            return [data]
    return []


def parse_legacy_form_data(
    raw: Any,
    cn_label_to_field_key: dict[str, str],
    *,
    normalize_person: Callable[[str, str], str] | None = None,
    person_field_keys: frozenset[str] | None = None,
) -> dict[str, str]:
    """解析单条 task.form_data，返回 field_key → 值。"""
    if raw is None:
        return {}
    text = str(raw).strip()
    if not text:
        return {}
    try:
        data = json.loads(text) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("legacy form_data JSON parse failed: %s", exc)
        return {}

    out: dict[str, str] = {}
    for item in _extract_form_items(data):
        cn = str(item.get("cnFieldName") or item.get("cn_field_name") or "").strip()
        if not cn:
            continue
        field_key = cn_label_to_field_key.get(cn)
        if not field_key:
            continue
        val = _field_value_from_item(item).strip()
        if not val:
            continue
        if field_key in LEGACY_RICHTEXT_FIELD_KEYS:
            val = normalize_legacy_richtext(val)
        elif field_key in LEGACY_PLAIN_TEXT_FIELD_KEYS:
            val = normalize_legacy_plain_text(val)
        elif field_key in MODULE_CASCADE_FIELD_KEYS:
            val = normalize_module_cascade_path(val)
        elif normalize_person and person_field_keys and field_key in person_field_keys:
            val = normalize_person(field_key, val)
        out[field_key] = val
    return out


def merge_field_value(field_key: str, parse_val: str, form_val: str) -> str:
    """合并 parse 列与 form_data 同键取值；富文本优先更完整的一方。"""
    pv = str(parse_val or "").strip()
    fv = str(form_val or "").strip()
    if not fv:
        return pv
    if not pv:
        return fv
    if field_key in LEGACY_PLAIN_TEXT_FIELD_KEYS:
        pv_plain = normalize_legacy_plain_text(pv)
        fv_plain = normalize_legacy_plain_text(fv)
        if not fv_plain:
            return pv_plain
        if not pv_plain:
            return fv_plain
        if fv_plain == pv_plain:
            return pv_plain
        if len(fv_plain) > len(pv_plain):
            return fv_plain
        return pv_plain
    if field_key not in LEGACY_RICHTEXT_FIELD_KEYS:
        return fv
    fv_lower = fv.lower()
    if "<img" in fv_lower:
        return fv
    if len(fv) > len(pv):
        return fv
    if pv and fv.startswith(pv):
        return fv
    if len(pv) > len(fv):
        return pv
    return fv


def merge_parse_with_form_values(
    parse_values: dict[str, str],
    form_values: dict[str, str],
) -> dict[str, str]:
    """将 form_data 字段合并进 parse 基线（用于回填 / 初始 full_values）。"""
    out = dict(parse_values)
    for key, fv in form_values.items():
        sv = str(fv or "").strip()
        if not sv:
            continue
        if key in out:
            out[key] = merge_field_value(key, out[key], sv)
        else:
            out[key] = sv
    return out


def merge_form_values_into(
    base: dict[str, str],
    incoming: dict[str, str],
) -> dict[str, str]:
    """按 task 顺序累积：incoming 覆盖/补强 base 同键。"""
    out = dict(base)
    for key, fv in incoming.items():
        sv = str(fv or "").strip()
        if not sv:
            continue
        if key in out:
            out[key] = merge_field_value(key, out[key], sv)
        else:
            out[key] = sv
    return out
