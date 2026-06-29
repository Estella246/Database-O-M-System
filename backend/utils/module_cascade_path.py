"""责任田级联模块路径：统一为「一级/二级/三级」斜杠分隔。"""
from __future__ import annotations

import json
import re
from typing import Any

MODULE_CASCADE_FIELD_KEYS = frozenset({"issue_intro_module", "issue_owner_module"})

_MODULE_QUOTE_RE = re.compile(r'["""''「」『』\'"\u201c\u201d\u2018\u2019]')


def _strip_legacy_quotes(token: str) -> str:
    return _MODULE_QUOTE_RE.sub("", token.strip()).strip()


def _parse_legacy_module_array(text: str) -> list[str]:
    inner = str(text or "").strip()
    if not inner.startswith("["):
        return []
    try:
        data = json.loads(inner)
        if isinstance(data, list):
            return [
                _strip_legacy_quotes(str(x))
                for x in data
                if _strip_legacy_quotes(str(x))
            ]
    except json.JSONDecodeError:
        pass
    body = inner.lstrip("[").rstrip("]").strip()
    if not body:
        return []
    quoted = re.findall(r'["""''「『]([^"""''」』]+)["""''」』]', body)
    if quoted:
        return [_strip_legacy_quotes(p) for p in quoted if _strip_legacy_quotes(p)]
    return [
        _strip_legacy_quotes(part)
        for part in re.split(r"[,，]", body)
        if _strip_legacy_quotes(part)
    ]


def normalize_module_cascade_path(raw: Any) -> str:
    """将老库 JSON 数组或杂乱引号格式转为标准级联路径。"""
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("["):
        parts = _parse_legacy_module_array(s)
        if parts:
            return "/".join(parts)
    if "/" in s:
        return "/".join(part.strip() for part in s.split("/") if part.strip())
    return s
