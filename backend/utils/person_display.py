from __future__ import annotations

import re

from config import _PERSON_ACCOUNT_SPACE, _PERSON_ACCOUNT_PLUS

MULTI_PERSON_DELIMITER = "；"


def dedupe_preserve_str(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def canonical_person_display(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    m = _PERSON_ACCOUNT_SPACE.match(s)
    if m:
        return f"{m.group(2).strip()} {m.group(1)}".strip()
    m2 = _PERSON_ACCOUNT_PLUS.match(s)
    if m2:
        return f"{m2.group(2).strip()} {m2.group(1)}".strip()
    return s


def parse_multi_person_parts(raw: str) -> list[str]:
    s = str(raw or "").strip()
    if not s:
        return []
    if MULTI_PERSON_DELIMITER in s:
        return [p.strip() for p in s.split(MULTI_PERSON_DELIMITER) if p.strip()]
    return [s]


def canonical_multi_person_display(raw: str) -> str:
    parts = parse_multi_person_parts(raw)
    if not parts:
        return ""
    normed = dedupe_preserve_str([canonical_person_display(p) for p in parts if canonical_person_display(p)])
    return MULTI_PERSON_DELIMITER.join(normed)