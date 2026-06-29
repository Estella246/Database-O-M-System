from __future__ import annotations

import io
import re
import zipfile


def _normalize_zip_path(name: str) -> str:
    return name.replace("\\", "/").strip("/")


def find_skill_md_in_zip(body: bytes) -> str | None:
    """从 zip 中查找任意层级的 SKILL.md，返回 UTF-8 文本。"""
    if not body:
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            candidates: list[tuple[int, str]] = []
            for raw_name in zf.namelist():
                norm = _normalize_zip_path(raw_name)
                if not norm or norm.endswith("/"):
                    continue
                base = norm.rsplit("/", 1)[-1]
                if base.upper() != "SKILL.MD":
                    continue
                depth = norm.count("/")
                candidates.append((depth, raw_name))
            if not candidates:
                return None
            candidates.sort(key=lambda x: x[0])
            raw = zf.read(candidates[0][1])
            return raw.decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, OSError):
        return None


def make_skill_md_excerpt(md: str, *, max_len: int = 300) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", md)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"[#>*_\[\]()!-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"
