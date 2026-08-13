"""DTS 单号（dts_no）格式校验。"""

from __future__ import annotations

import re

# DTS/BUG + 恰好 13 个字符（总长 16，如 DTS20260826xxxxx）
_DTS_BUG_RE = re.compile(r"^(?:DTS|BUG).{13}$")

# 按长度降序，避免短前缀误抢（如 IR 抢在 AR.SR.IR 之前）
_DTS_PREFIXES: tuple[str, ...] = ("AR.SR.IR", "SR.IR", "IR", "RR")

DTS_NO_FORMAT_HINT = (
    "若为问题单，格式要求 DTS单号/BUG单号；"
    "若为需求号，要求以 AR.SR.IR 或 SR.IR 或 IR 开头；"
    "若为还未落地的需求，要求以 RR 开头"
)


def is_valid_dts_no(value: str) -> bool:
    """非空 dts_no 是否符合约定格式。空串由调用方按必填规则处理。"""
    s = str(value or "").strip()
    if not s:
        return False
    if _DTS_BUG_RE.match(s):
        return True
    return any(s.startswith(p) for p in _DTS_PREFIXES)


def dts_no_format_error(field_key: str = "dts_no") -> str:
    """与 is required 同风格的英文错误码，供前端映射中文。"""
    return f"{field_key} invalid format"
