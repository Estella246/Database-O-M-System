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


# 宽容分隔符：全角/半角分号、全角/半角逗号、顿号。存量数据（如配置页早期手工输入）
# 可能混用这些分隔符，读侧按此拆分即可，无需数据迁移；规范化写入只产出「；」。
_LENIENT_SPLIT_RE = re.compile(r"[；;，,、]")
# 段内空白串（含全角空格等 Unicode 空白）折叠为单个半角空格：
# 否则「张三　zhangsan」（IME/Excel 粘贴常见）过不了「含半角空格」的格式校验。
_WS_RUN_RE = re.compile(r"\s+")


def person_key(person: str) -> tuple[str, ...]:
    """人 → 次序无关的词元键：按空白拆分并排序。

    归桶比对刻意不用 canonical_person_display + 末段取账号：canonical 对「ASCII 词 + ASCII 账号」
    是对合（翻一次换序、翻两次还原），owner 侧（保存时规范化 + 读桶再解析）与 responsible 侧
    （仅解析一次）的翻转次数不同会取到不同末段，导致同人匹配不上；词元键对段序不敏感，
    「姓名 账号」与「账号 姓名」同键，也不依赖任何一侧的规范化次数。
    """
    return tuple(sorted(str(person or "").split()))


def parse_person_parts_lenient(raw: str) -> list[str]:
    """按宽容分隔符拆多人串，段内空白串折叠为半角空格，逐段 canonical 后按词元键去重保序；
    空串返回 []。

    去重按 person_key（而非字符串）：canonical 对 ASCII「姓名 账号」是对合，
    同一人两种段序写法（'Lazov i00822653' 与 'i00822653 Lazov'）字符串不同但同人，只留首个。
    注意不能按空白拆段——每段「姓名 账号」内部就含空格。
    """
    s = str(raw or "").strip()
    if not s:
        return []
    parts = _LENIENT_SPLIT_RE.split(s)
    out: list[str] = []
    seen: set[tuple[str, ...]] = set()
    for x in parts:
        p = canonical_person_display(_WS_RUN_RE.sub(" ", x)).strip()
        if not p:
            continue
        k = person_key(p)
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out