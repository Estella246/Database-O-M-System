"""
CSS 自动拆分脚本
读取 styles.css，按选择器前缀自动归类到 styles/ 子目录下对应文件。
主题规则(html[data-theme])和自定义背景规则(body.has-custom-bg)单独提取。
"""

import os
import re
import sys

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(FRONTEND_DIR, "styles.css")
DST_DIR = os.path.join(FRONTEND_DIR, "styles")
THEMES_DIR = os.path.join(DST_DIR, "themes")

PREFIX_MAP = [
    ("base", [
        r'^\*$',
        r'^html$',
        r'^html,\s*body',
        r'^:root',
        r'^body$',
        r'^body::before',
        r'^#root',
        r'^button,\s*input',
        r'^input\[type=',
    ]),
    ("layout", [
        r'^\.layout',
        r'^\.left$',
        r'^\.left\b',
        r'^\.left-top',
        r'^\.left::',
        r'^\.center$',
        r'^\.center\b',
        r'^\.center::before',
        r'^\.center\s',
        r'^\.collapse',
        r'^\.hamburger',
    ]),
    ("sidebar", [
        r'^\.menu',
        r'^\.menu-bottom',
        r'^\.menu-group',
        r'^\.menu-item',
        r'^\.menu-submenu',
    ]),
    ("ticket", [
        r'^\.flow',
        r'^\.wf-',
        r'^\.problem',
        r'^\.p-',
        r'^\.cat-',
        r'^\.val-',
        r'^\.detail',
        r'^\.order-',
        r'^\.rich-',
        r'^\.filter-',
        r'^\.date-range',
        r'^\.search',
        r'^\.table-wrap',
        r'^\.head\b',
        r'^\.toolbar',
        r'^\.tab-bar',
        r'^\.list-',
        r'^\.cascade-',
    ]),
    ("duty", [
        r'^\.duty-',
    ]),
    ("stats", [
        r'^\.stats-',
        r'^\.stat-',
    ]),
    ("report", [
        r'^\.upload-',
    ]),
    ("skill", [
        r'^\.skill-',
        r'^\.stats-skills',
    ]),
    ("leave", [
        r'^\.leave-',
    ]),
    ("home", [
        r'^\.home-',
    ]),
    ("settings", [
        r'^\.settings-',
        r'^\.skin-',
    ]),
    ("admin", [
        r'^\.admin-',
        r'^\.perm-',
        r'^\.oplog-',
        r'^\.group-template',
        r'^\.version-',
        r'^\.params-',
    ]),
    ("requirement", [
        r'^\.req-',
    ]),
    ("ai", [
        r'^\.ai-',
        r'^\.llm-',
    ]),
]

THEME_PATTERNS = [
    ("custom-bg", r'^html\[data-theme=.*\]\s+body\.has-custom-bg'),
    ("dark", r'^html\[data-theme="dark"\]'),
    ("eye-care", r'^html\[data-theme="eye-care"\]'),
    ("pink-mist", r'^html\[data-theme="pink-mist"\]'),
    ("blue-lilac", r'^html\[data-theme="blue-lilac"\]'),
]

KEYFRAME_FILE_MAP = {
    "bgDrift": "base",
    "pageIn": "layout",
    "panelFade": "ticket",
    "twinSheen": "ticket",
    "rowIn": "ticket",
    "focusRipple": "ticket",
    "statGlassCardIn": "stats",
    "statGlassShimmer": "stats",
    "statChartFadeUp": "stats",
    "statBarGrow": "stats",
    "statTotalPop": "stats",
    "statPieSpinIn": "stats",
    "statPieSlicePop": "stats",
    "statLegendRowIn": "stats",
    "statEchartHostIn": "stats",
    "statLineDraw": "home",
    "statAreaFade": "home",
    "statLineDotPop": "home",
    "ai-status-pulse": "ai",
    "upload-toast-in": "report",
    "upload-toast-out": "report",
    "modal-overlay-in": "report",
    "modal-in": "report",
    "upload-spin": "report",
}


def parse_css_blocks(text):
    blocks = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] in (' ', '\t', '\n', '\r'):
            i += 1
            continue
        if text[i:i+2] == '/*':
            end = text.find('*/', i + 2)
            if end == -1:
                end = n - 2
            comment = text[i:end+2]
            blocks.append(("comment", comment))
            i = end + 2
            continue
        if text[i] == '@':
            at_end = text.find('{', i)
            if at_end == -1:
                at_end = n
            at_keyword = text[i:at_end].strip()
            if at_keyword.startswith("@import"):
                semi = text.find(';', i)
                if semi == -1:
                    semi = n
                blocks.append(("at-rule", text[i:semi+1]))
                i = semi + 1
                continue
            if at_keyword.startswith("@keyframes"):
                brace_start = text.find('{', i)
                depth = 0
                j = brace_start
                while j < n:
                    if text[j] == '{':
                        depth += 1
                    elif text[j] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                blocks.append(("keyframe", text[i:j+1]))
                i = j + 1
                continue
            if at_keyword.startswith("@media"):
                brace_start = text.find('{', i)
                depth = 0
                j = brace_start
                while j < n:
                    if text[j] == '{':
                        depth += 1
                    elif text[j] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                blocks.append(("media", text[i:j+1]))
                i = j + 1
                continue
            brace_start = text.find('{', i)
            if brace_start != -1:
                depth = 0
                j = brace_start
                while j < n:
                    if text[j] == '{':
                        depth += 1
                    elif text[j] == '}':
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                blocks.append(("at-block", text[i:j+1]))
                i = j + 1
            else:
                semi = text.find(';', i)
                if semi == -1:
                    semi = n
                blocks.append(("at-rule", text[i:semi+1]))
                i = semi + 1
            continue
        brace_pos = text.find('{', i)
        if brace_pos == -1:
            break
        selector = text[i:brace_pos].strip()
        depth = 0
        j = brace_pos
        while j < n:
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = text[brace_pos:j+1]
        blocks.append(("rule", selector, body))
        i = j + 1
    return blocks


def classify_rule(selector):
    for theme_name, pattern in THEME_PATTERNS:
        if re.search(pattern, selector):
            return ("theme", theme_name)
    for prefix, patterns in PREFIX_MAP:
        for pattern in patterns:
            if re.search(pattern, selector):
                return ("page", prefix)
    first_class = re.search(r'\.([\w-]+)', selector)
    if first_class:
        cls = first_class.group(1)
        dash_idx = cls.find('-')
        if dash_idx > 0:
            prefix = cls[:dash_idx]
            for page_name, _ in PREFIX_MAP:
                if prefix == page_name:
                    return ("page", page_name)
    return ("page", "ticket")


def classify_keyframe(block_text):
    m = re.match(r'@keyframes\s+([\w-]+)', block_text)
    if m:
        name = m.group(1)
        return KEYFRAME_FILE_MAP.get(name, "ticket")
    return "ticket"


def classify_media(block_text):
    inner = block_text[block_text.find('{')+1:block_text.rfind('}')]
    inner_blocks = parse_css_blocks(inner)
    if not inner_blocks:
        return "ticket"
    counts = {}
    for b in inner_blocks:
        if b[0] == "rule":
            _, page = classify_rule(b[1])
            counts[page] = counts.get(page, 0) + 1
    if counts:
        return max(counts, key=counts.get)
    return "ticket"


def main():
    with open(SRC, encoding="utf-8") as f:
        original = f.read()

    blocks = parse_css_blocks(original)

    page_files = {}
    theme_files = {}
    pending_comments = []

    for block in blocks:
        if block[0] == "comment":
            pending_comments.append(block[1])
            continue
        if block[0] == "at-rule":
            pending_comments = []
            continue

        prefix = ""
        if pending_comments:
            prefix = "\n".join(pending_comments) + "\n"
            pending_comments = []

        if block[0] == "keyframe":
            target = classify_keyframe(block[1])
            page_files.setdefault(target, []).append(prefix + block[1])
        elif block[0] == "media":
            target = classify_media(block[1])
            page_files.setdefault(target, []).append(prefix + block[1])
        elif block[0] == "at-block":
            page_files.setdefault("base", []).append(prefix + block[1])
        elif block[0] == "rule":
            selector, body = block[1], block[2]
            kind, target = classify_rule(selector)
            if kind == "theme":
                theme_files.setdefault(target, []).append(prefix + selector + " " + body)
            else:
                page_files.setdefault(target, []).append(prefix + selector + " " + body)

    os.makedirs(THEMES_DIR, exist_ok=True)

    order = ["base", "layout", "sidebar", "ticket", "duty", "stats",
             "report", "skill", "leave", "home", "settings", "admin",
             "requirement", "ai"]

    for name in order:
        if name not in page_files:
            continue
        path = os.path.join(DST_DIR, f"{name}.css")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(page_files[name]))
            f.write("\n")
        count = len(page_files[name])
        print(f"  {name}.css: {count} blocks")

    for theme_name in ["dark", "eye-care", "pink-mist", "blue-lilac", "custom-bg"]:
        if theme_name not in theme_files:
            continue
        path = os.path.join(THEMES_DIR, f"{theme_name}.css")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(theme_files[theme_name]))
            f.write("\n")
        count = len(theme_files[theme_name])
        print(f"  themes/{theme_name}.css: {count} blocks")

    entry_lines = []
    for name in order:
        entry_lines.append(f'@import "styles/{name}.css";')
    for theme_name in ["dark", "eye-care", "pink-mist", "blue-lilac", "custom-bg"]:
        entry_lines.append(f'@import "styles/themes/{theme_name}.css";')

    entry_path = os.path.join(FRONTEND_DIR, "styles.css.new")
    with open(entry_path, "w", encoding="utf-8") as f:
        f.write("\n".join(entry_lines) + "\n")
    print(f"\n  styles.css.new (entry file) created")

    backup_path = os.path.join(FRONTEND_DIR, "styles.css.bak")
    if not os.path.exists(backup_path):
        import shutil
        shutil.copy2(SRC, backup_path)
        print(f"  styles.css.bak (backup) created")


if __name__ == "__main__":
    main()
