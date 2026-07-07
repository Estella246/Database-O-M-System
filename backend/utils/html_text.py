"""富文本（HTML）转列表/表格展示用纯文本。"""
from __future__ import annotations

import re

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def strip_html_plain(text: str, *, max_len: int | None = None) -> str:
    t = _HTML_TAG_RE.sub(" ", text or "")
    t = (
        t.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    t = _WS_RE.sub(" ", t).strip()
    if max_len is not None and len(t) > max_len:
        return t[:max_len] + "…"
    return t
