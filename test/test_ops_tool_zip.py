"""运维工具广场 zip 解析单测。"""

from __future__ import annotations

import io
import zipfile

from backend.utils.ops_tool_zip import find_skill_md_in_zip, make_skill_md_excerpt


def _zip_bytes(entries: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, content in entries.items():
            zf.writestr(path, content)
    return buf.getvalue()


def test_find_skill_md_at_root():
    body = _zip_bytes({"SKILL.md": "# Hello\n\nWorld"})
    assert find_skill_md_in_zip(body) == "# Hello\n\nWorld"


def test_find_skill_md_in_nested_folder():
    body = _zip_bytes({"my-skill/SKILL.md": "# Nested"})
    assert find_skill_md_in_zip(body) == "# Nested"


def test_find_skill_md_case_insensitive_filename():
    body = _zip_bytes({"pkg/skill.MD": "# Case"})
    assert find_skill_md_in_zip(body) == "# Case"


def test_find_skill_md_missing_returns_none():
    body = _zip_bytes({"readme.txt": "nope"})
    assert find_skill_md_in_zip(body) is None


def test_make_skill_md_excerpt_strips_markdown():
    md = "# Title\n\nSome **bold** text and `code`."
    excerpt = make_skill_md_excerpt(md, max_len=50)
    assert "Title" in excerpt
    assert "**" not in excerpt
    assert len(excerpt) <= 50
