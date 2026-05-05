"""
CSS 重构测试 - 确保拆分后样式完整性和正确性
L1: CSS 语法校验
L2: 规则完整性校验（选择器/动画/媒体查询零丢失）
"""

import os
import re
import pytest

FRONTEND_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)
STYLES_DIR = os.path.join(FRONTEND_DIR, "styles")
ORIGINAL_CSS_PATH = os.path.join(FRONTEND_DIR, "styles.css")
ORIGINAL_BACKUP = os.path.join(FRONTEND_DIR, "styles.css.bak")


def _read_original_css():
    if os.path.isfile(ORIGINAL_BACKUP):
        return open(ORIGINAL_BACKUP, encoding="utf-8").read()
    return open(ORIGINAL_CSS_PATH, encoding="utf-8").read()


def _collect_split_css_files():
    if not os.path.isdir(STYLES_DIR):
        return []
    files = []
    for root, _, fnames in os.walk(STYLES_DIR):
        for f in sorted(fnames):
            if f.endswith(".css"):
                files.append(os.path.join(root, f))
    return files


def _is_refactored():
    content = open(ORIGINAL_CSS_PATH, encoding="utf-8").read().strip()
    lines = [l.strip() for l in content.splitlines() if l.strip()]
    non_comment = [l for l in lines if not l.startswith("/*") and not l.startswith("*") and not l.endswith("*/")]
    return len(non_comment) > 0 and all(l.startswith("@import") for l in non_comment)


def _merged_split_css_text():
    merged = ""
    for path in _collect_split_css_files():
        merged += open(path, encoding="utf-8").read() + "\n"
    return merged


def _union_selectors_from_split_files():
    """各分文件中选择器的并集（无 .bak 时与合并文本对照用）。"""
    union = set()
    for path in _collect_split_css_files():
        union |= set(_extract_selectors(open(path, encoding="utf-8").read()))
    return union


def _css_text_for_baseline_metrics():
    """无 .bak 且已拆分时，用合并后的分文件内容做 keyframes/@media 体量断言。"""
    if os.path.isfile(ORIGINAL_BACKUP):
        return open(ORIGINAL_BACKUP, encoding="utf-8").read()
    if _is_refactored():
        return _merged_split_css_text()
    return open(ORIGINAL_CSS_PATH, encoding="utf-8").read()


def _extract_selectors(css_text):
    no_comments = re.sub(r'/\*.*?\*/', '', css_text, flags=re.DOTALL)
    pattern = re.compile(r'([^{}]+)\{', re.DOTALL)
    selectors = []
    for m in pattern.finditer(no_comments):
        sel = m.group(1).strip()
        if sel.startswith("@"):
            continue
        for s in sel.split(","):
            s = s.strip()
            if s:
                selectors.append(s)
    return sorted(selectors)


def _extract_keyframes(css_text):
    no_comments = re.sub(r'/\*.*?\*/', '', css_text, flags=re.DOTALL)
    pattern = re.compile(r'@keyframes\s+([\w-]+)')
    return set(pattern.findall(no_comments))


def _extract_media_conditions(css_text):
    no_comments = re.sub(r'/\*.*?\*/', '', css_text, flags=re.DOTALL)
    pattern = re.compile(r'@media\s*([^{]+)\{')
    return set(m.strip() for m in pattern.findall(no_comments))


@pytest.fixture(scope="module", autouse=True)
def _require_css_split_contract():
    if not _is_refactored():
        pytest.fail(
            "CSS 拆分契约：frontend/styles.css 中非注释行须全部为 @import。"
            "全员完成拆分前请勿合并；见 docs/testing-local-contract.md。"
        )


# ── L1: CSS 语法校验 ──────────────────────────────────────────────

class TestCSSSyntax:

    def test_entry_file_only_imports(self):
        content = open(ORIGINAL_CSS_PATH, encoding="utf-8").read()
        lines = [l.strip() for l in content.splitlines() if l.strip()]
        for line in lines:
            if line.startswith("/*") or line.startswith("*") or line.endswith("*/"):
                continue
            assert line.startswith("@import"), (
                f"入口文件含非 @import 行: {line}"
            )

    def test_all_css_files_brace_matched(self):
        for path in _collect_split_css_files():
            content = open(path, encoding="utf-8").read()
            stripped = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
            opens = stripped.count('{')
            closes = stripped.count('}')
            assert opens == closes, (
                f"{os.path.relpath(path, FRONTEND_DIR)}: "
                f"花括号不匹配 开={opens} 闭={closes}"
            )

    def test_import_paths_reference_existing_files(self):
        content = open(ORIGINAL_CSS_PATH, encoding="utf-8").read()
        import_pattern = re.compile(r'@import\s+["\']([^"\']+)["\']')
        for m in import_pattern.finditer(content):
            ref = m.group(1)
            full = os.path.normpath(os.path.join(FRONTEND_DIR, ref))
            assert os.path.isfile(full), (
                f"@import 引用的文件不存在: {ref} (解析为 {full})"
            )


# ── L2: 规则完整性校验 ────────────────────────────────────────────

class TestCSSRuleCompleteness:

    def test_no_selectors_lost(self):
        original = _read_original_css()
        original_sels = set(_extract_selectors(original))

        merged = _merged_split_css_text()
        merged_sels = set(_extract_selectors(merged))

        missing = original_sels - merged_sels
        assert not missing, f"拆分后丢失 {len(missing)} 个选择器: {sorted(missing)[:20]}"

        if _is_refactored() and not os.path.isfile(ORIGINAL_BACKUP):
            union_from_files = _union_selectors_from_split_files()
            merged_set = set(_extract_selectors(merged))
            assert merged_set == union_from_files, (
                "合并后的选择器集合应与各分文件选择器并集一致；"
                f"仅合并有 {len(merged_set - union_from_files)} 个多余，"
                f"仅分文件有 {len(union_from_files - merged_set)} 个缺失"
            )

        # 选择器条数比率需完整单文件基线；无 styles.css.bak 时入口仅为 @import，不做此项。
        if os.path.isfile(ORIGINAL_BACKUP):
            original_list = _extract_selectors(original)
            merged_list = _extract_selectors(merged)
            ratio = len(merged_list) / max(len(original_list), 1)
            assert 0.95 <= ratio <= 1.05, (
                f"选择器数量偏差过大: 原始={len(original_list)}, "
                f"拆分后={len(merged_list)}, 比率={ratio:.3f}"
            )

    def test_no_keyframes_lost(self):
        original = _read_original_css()
        original_kfs = _extract_keyframes(original)

        merged = _merged_split_css_text()
        merged_kfs = _extract_keyframes(merged)

        missing = original_kfs - merged_kfs
        assert not missing, f"拆分后丢失 @keyframes: {missing}"

    def test_no_media_queries_lost(self):
        original = _read_original_css()
        original_media = _extract_media_conditions(original)

        merged = _merged_split_css_text()
        merged_media = _extract_media_conditions(merged)

        missing = original_media - merged_media
        assert not missing, f"拆分后丢失 @media: {missing}"


# ── L0: 重构前基准测试（始终运行） ────────────────────────────────

class TestCSSBaseline:
    """重构前就能运行的基准测试，确保原始文件本身无语法问题"""

    def test_original_css_brace_matched(self):
        content = _read_original_css()
        stripped = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        opens = stripped.count('{')
        closes = stripped.count('}')
        assert opens == closes, f"原始文件花括号不匹配 开={opens} 闭={closes}"

    def test_original_css_has_keyframes(self):
        content = _css_text_for_baseline_metrics()
        kfs = _extract_keyframes(content)
        assert len(kfs) >= 20, f"样式集合应有 20+ 个 @keyframes，实际 {len(kfs)}"

    def test_original_css_has_media_queries(self):
        content = _css_text_for_baseline_metrics()
        medias = _extract_media_conditions(content)
        assert len(medias) >= 6, f"样式集合应有 6+ 个 @media，实际 {len(medias)}"
