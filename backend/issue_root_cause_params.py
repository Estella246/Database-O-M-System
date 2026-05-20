from __future__ import annotations

from typing import Any

import psycopg
from fastapi import HTTPException
from psycopg.errors import UndefinedTable

_ISSUE_TYPE_SET_CODE = "OS_ISSUE_TYPE"
_ROOT_CAUSE_FIELD_KEY = "root_cause_category"
_PARENT_FIELD_KEY = "issue_type"


def load_issue_type_labels(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute(
        """
        SELECT oi.option_value
        FROM option_set os
        JOIN option_item oi ON oi.option_set_id = os.id
        WHERE os.set_code = %s AND oi.is_active = TRUE
        ORDER BY oi.sort_order, oi.id
        """,
        (_ISSUE_TYPE_SET_CODE,),
    ).fetchall()
    out: list[str] = []
    seen: set[str] = set()
    for r in rows:
        lab = str(r.get("option_value") or "").strip()
        if not lab or lab in seen:
            continue
        seen.add(lab)
        out.append(lab)
    return out


def load_issue_root_cause_map(conn: psycopg.Connection) -> dict[str, list[str]]:
    try:
        rows = conn.execute(
            """
            SELECT issue_type, root_cause_category, sort_order
            FROM param_issue_root_cause_map
            ORDER BY issue_type, sort_order, root_cause_category
            """
        ).fetchall()
    except UndefinedTable:
        return {}
    by_type: dict[str, list[str]] = {}
    for r in rows:
        it = str(r.get("issue_type") or "").strip()
        cat = str(r.get("root_cause_category") or "").strip()
        if not it or not cat:
            continue
        by_type.setdefault(it, []).append(cat)
    return by_type


def normalize_issue_root_cause_payload(items: list[Any]) -> list[tuple[str, list[str]]]:
    """校验并规范化 PUT 载荷：顺序即问题类型展示顺序。"""
    out: list[tuple[str, list[str]]] = []
    seen_types: set[str] = set()
    for raw in items or []:
        issue_type = str(getattr(raw, "issue_type", None) or (raw.get("issue_type") if isinstance(raw, dict) else "") or "").strip()
        if not issue_type:
            raise HTTPException(status_code=400, detail="问题类型不能为空")
        if issue_type in seen_types:
            raise HTTPException(status_code=400, detail=f"问题类型重复：{issue_type}")
        seen_types.add(issue_type)
        cats: list[str] = []
        cat_seen: set[str] = set()
        categories = getattr(raw, "categories", None)
        if categories is None and isinstance(raw, dict):
            categories = raw.get("categories")
        for c_raw in categories or []:
            cat = str(c_raw or "").strip()
            if not cat or cat in cat_seen:
                continue
            cat_seen.add(cat)
            cats.append(cat[:256])
        out.append((issue_type, cats))
    return out


def sync_issue_type_option_items(conn: psycopg.Connection, type_labels: list[str]) -> None:
    row = conn.execute(
        "SELECT id FROM option_set WHERE set_code = %s",
        (_ISSUE_TYPE_SET_CODE,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="问题类型选项集 OS_ISSUE_TYPE 未配置")
    set_id = int(row["id"])
    conn.execute(
        "UPDATE option_item SET is_active = FALSE, updated_at = NOW() WHERE option_set_id = %s",
        (set_id,),
    )
    for i, lab in enumerate(type_labels):
        label = lab[:256]
        conn.execute(
            """
            INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
            VALUES (%s, %s, %s, %s, TRUE)
            ON CONFLICT (option_set_id, option_value) DO UPDATE SET
              option_label = EXCLUDED.option_label,
              sort_order = EXCLUDED.sort_order,
              is_active = TRUE,
              updated_at = NOW()
            """,
            (set_id, label, label, i),
        )


def build_issue_root_cause_response(
    conn: psycopg.Connection,
    normalized: list[tuple[str, list[str]]],
) -> dict[str, Any]:
    issue_types = [t for t, _ in normalized]
    items = [{"issue_type": t, "categories": cats} for t, cats in normalized]
    return {"issue_types": issue_types, "items": items}


def merge_issue_root_cause_items(
    issue_types: list[str],
    rows: list[Any] | None,
) -> list[dict[str, Any]]:
    by_type: dict[str, list[str]] = {}
    for r in rows or []:
        it = str(r.get("issue_type") or "").strip()
        raw = r.get("categories")
        if not it:
            continue
        cats: list[str] = []
        if isinstance(raw, list):
            seen: set[str] = set()
            for x in raw:
                c = str(x or "").strip()
                if c and c not in seen:
                    seen.add(c)
                    cats.append(c)
        by_type[it] = cats
    return [{"issue_type": it, "categories": list(by_type.get(it, []))} for it in issue_types]


def attach_issue_root_cause_to_field(field: dict[str, Any], mapping: dict[str, list[str]]) -> None:
    if str(field.get("key") or "") != _ROOT_CAUSE_FIELD_KEY:
        return
    field["options_by_parent"] = {
        "parent_field": _PARENT_FIELD_KEY,
        "map": mapping,
    }
    union: list[str] = []
    seen: set[str] = set()
    for cats in mapping.values():
        for c in cats:
            if c not in seen:
                seen.add(c)
                union.append(c)
    field["options"] = union
