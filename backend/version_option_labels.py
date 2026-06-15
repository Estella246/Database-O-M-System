from __future__ import annotations

import psycopg
from psycopg.errors import UndefinedTable

from config import _VERSION_BASELINE_OPTION_SET_CODES
from utils import dedupe_preserve_str as _dedupe_preserve_str

RELEASE_VERSION_OPTION_SET_CODE = "OS_RELEASE_VERSION"


def _labels_from_rows(rows: list, key: str) -> list[str]:
    return _dedupe_preserve_str(
        [str(r.get(key) or "").strip() for r in rows if str(r.get(key) or "").strip()]
    )


def load_baseline_version_labels(conn: psycopg.Connection) -> list[str]:
    try:
        rows = conn.execute(
            """
            SELECT version_label
            FROM param_baseline_version
            ORDER BY sort_order, id
            """
        ).fetchall()
    except UndefinedTable:
        return []
    return _labels_from_rows(rows, "version_label")


def load_hotfix_version_labels(conn: psycopg.Connection) -> list[str]:
    try:
        rows = conn.execute(
            """
            SELECT h.hotfix_label
            FROM param_hotfix_version h
            JOIN param_baseline_version b ON b.id = h.baseline_id
            ORDER BY b.sort_order, b.id, h.sort_order, h.id
            """
        ).fetchall()
    except UndefinedTable:
        return []
    return _labels_from_rows(rows, "hotfix_label")


def load_version_option_labels_for_set(conn: psycopg.Connection, set_code: str) -> list[str]:
    baselines = load_baseline_version_labels(conn)
    if set_code == RELEASE_VERSION_OPTION_SET_CODE:
        hotfixes = load_hotfix_version_labels(conn)
        return _dedupe_preserve_str(baselines + hotfixes)
    return baselines


def fill_version_baseline_option_map(
    conn: psycopg.Connection, external_codes: set[str]
) -> dict[str, list[str]]:
    option_map: dict[str, list[str]] = {}
    for code in external_codes & _VERSION_BASELINE_OPTION_SET_CODES:
        option_map[code] = load_version_option_labels_for_set(conn, code)
    return option_map
