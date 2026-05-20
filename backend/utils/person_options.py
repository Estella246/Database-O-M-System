"""人员类白名单：从 user_account（用户管理/权限体系）加载可选人。"""

from __future__ import annotations

from typing import Any

import psycopg

from config import PERSON_VALUE_FIELD_KEYS
from utils.person_display import canonical_person_display, dedupe_preserve_str


def person_whitelist_options_are_placeholder_only(options: list[Any]) -> bool:
    if not isinstance(options, list) or not options:
        return True
    norm = [str(x).strip() for x in options if str(x).strip()]
    if not norm:
        return True
    if len(norm) == 1 and norm[0] == "temp":
        return True
    if len(norm) == 1 and "姓名" in norm[0] and "工号" in norm[0]:
        return True
    return False


def load_active_user_person_options(conn: psycopg.Connection) -> list[str]:
    try:
        rows = conn.execute(
            """
            SELECT account, user_name
            FROM user_account
            WHERE is_active IS DISTINCT FROM FALSE
            ORDER BY user_name, account
            """
        ).fetchall()
    except Exception:
        return []
    out: list[str] = []
    for row in rows:
        acc = str(row.get("account") or "").strip()
        nm = str(row.get("user_name") or "").strip()
        if not acc and not nm:
            continue
        disp = canonical_person_display(f"{nm} {acc}" if nm and acc else (acc or nm))
        if disp:
            out.append(disp)
    return dedupe_preserve_str(out)


def should_resolve_person_options_from_user_account(
    field_key: str,
    option_source_type: str,
    options: list[Any],
) -> bool:
    if field_key not in PERSON_VALUE_FIELD_KEYS:
        return False
    if field_key in ("next_handler", "collaborator"):
        return True
    st = str(option_source_type or "").strip()
    if st == "external_api":
        return True
    return person_whitelist_options_are_placeholder_only(options)


def resolve_person_field_options(
    conn: psycopg.Connection,
    field_key: str,
    option_source_type: str,
    options: list[Any],
    user_options_cache: list[str] | None,
) -> tuple[list[str], list[str] | None]:
    """返回 (options, updated_cache)。"""
    opts = list(options)
    if not should_resolve_person_options_from_user_account(field_key, option_source_type, opts):
        if field_key in PERSON_VALUE_FIELD_KEYS and opts and opts != ["temp"]:
            opts = dedupe_preserve_str([canonical_person_display(str(o)) for o in opts])
        return opts, user_options_cache
    cache = user_options_cache
    if cache is None:
        cache = load_active_user_person_options(conn)
    if cache:
        return list(cache), cache
    if field_key in PERSON_VALUE_FIELD_KEYS and opts and opts != ["temp"]:
        opts = dedupe_preserve_str([canonical_person_display(str(o)) for o in opts])
    return opts, cache
