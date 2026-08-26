"""问题填写 eCare 单号（ecare_ticket_no）格式校验。"""

from __future__ import annotations

import re

PRODUCT_LINE_PUBLIC_CLOUD = "公有云"

# 默认：8 位数字，1 或 3 开头
_DEFAULT_RE = re.compile(r"^[13]\d{7}$")
# 公有云：14 位或 10 位纯数字
_PUBLIC_CLOUD_DIGITS_RE = re.compile(r"^(?:\d{14}|\d{10})$")
_PUBLIC_CLOUD_TS_PREFIX = "TS"
_PUBLIC_CLOUD_SJGD_PREFIX = "sjgd"

ECARE_TICKET_NO_FORMAT_HINT = "请输入格式正确的eCare单号"


def _is_public_cloud_product_line(product_line: str) -> bool:
    return str(product_line or "").strip() == PRODUCT_LINE_PUBLIC_CLOUD


def is_valid_ecare_ticket_no(value: str, product_line: str = "") -> bool:
    """非空 eCare 单号是否符合约定格式。空串由调用方按必填规则处理。"""
    s = str(value or "").strip()
    if not s:
        return False
    if _is_public_cloud_product_line(product_line):
        if _PUBLIC_CLOUD_DIGITS_RE.fullmatch(s):
            return True
        if s.startswith(_PUBLIC_CLOUD_TS_PREFIX):
            return True
        if s.startswith(_PUBLIC_CLOUD_SJGD_PREFIX):
            return True
        return False
    return bool(_DEFAULT_RE.fullmatch(s))


def ecare_ticket_no_format_error(_product_line: str = "") -> str:
    return ECARE_TICKET_NO_FORMAT_HINT


def sample_ecare_ticket_no(product_line: str = "") -> str:
    """测试/造数用的合法样例。"""
    if _is_public_cloud_product_line(product_line):
        return "12345678901234"
    return "12345678"
