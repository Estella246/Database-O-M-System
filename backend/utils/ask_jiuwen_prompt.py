"""从已提交节点数据组装「Ask 九问」提示词（不用列表快照，避免富文本截断）。"""

from __future__ import annotations

import json
import re
from typing import Any

import psycopg

from utils.ticket_inherited_values import values_json_as_dict

# 流转控件 / 元信息开关：对排查无信息量
_EXCLUDED_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "handle_mode",
        "next_handler",
        "close_reason",
        "issue_type_judge",
        # 严重性 / 单号 / 人员 / 级别与透传类开关
        "severity",
        "ecare_ticket_no",
        "hcs_owner",
        "creator",
        "creator_name",
        "creatorName",
        "event_level",
        "customer_voice",
        "use_doer_assist",
        "has_collaborator",
        "output_problem_report",
        "front_pass_through",
        "version_pass_through",
        "warning_needed",
    }
)

_EXCLUDED_FIELD_TYPES: frozenset[str] = frozenset({"file"})

# 单字段去 HTML 后软上限（全量保留语义；仅防极端超长）
_RICHTEXT_PROMPT_MAX = 12_000

_TAG_RE = re.compile(r"<[^>]+>")


def _is_draft_row(row: dict[str, Any]) -> bool:
    if str(row.get("draft") or "").strip().lower() in ("true", "1", "yes"):
        return True
    snap = row.get("schema_snapshot")
    if isinstance(snap, dict) and snap.get("draft"):
        return True
    return False


def _plain_for_prompt(raw: Any, *, field_type: str = "text", max_len: int | None = None) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (list, tuple)):
        parts = [_plain_for_prompt(x, field_type=field_type) for x in raw]
        return "、".join(p for p in parts if p)
    if isinstance(raw, dict):
        try:
            text = json.dumps(raw, ensure_ascii=False)
        except (TypeError, ValueError):
            text = str(raw)
    else:
        text = str(raw)

    if field_type == "richtext" or ("<" in text and ">" in text):
        text = (
            text.replace("<br>", "\n")
            .replace("<br/>", "\n")
            .replace("<br />", "\n")
            .replace("</p>", "\n")
            .replace("</div>", "\n")
            .replace("</li>", "\n")
        )
        text = _TAG_RE.sub("", text)
        text = (
            text.replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
        )
        text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    else:
        text = text.strip()

    if not text:
        return ""
    limit = max_len if max_len is not None else (
        _RICHTEXT_PROMPT_MAX if field_type == "richtext" else None
    )
    if limit is not None and len(text) > limit:
        return text[:limit] + "…"
    return text


def _value_nonempty(raw: Any) -> bool:
    if raw is None:
        return False
    if isinstance(raw, str):
        return bool(raw.strip())
    if isinstance(raw, (list, tuple, dict)):
        return bool(raw)
    return True


def _load_field_meta(
    conn: psycopg.Connection, template_code: str
) -> dict[str, dict[str, Any]]:
    """field_key → {label, type}；同 key 取流程更靠后节点的定义。"""
    rows = conn.execute(
        """
        SELECT nfd.field_key AS key,
               nfd.field_name AS label,
               nfd.field_type AS type,
               wn.node_order
        FROM node_field_def nfd
        JOIN workflow_node wn ON wn.id = nfd.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s
          AND nfd.is_active = TRUE
        ORDER BY wn.node_order ASC, nfd.sort_order ASC, nfd.id ASC
        """,
        (template_code,),
    ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("key") or "").strip()
        if not key:
            continue
        out[key] = {
            "label": str(row.get("label") or key).strip() or key,
            "type": str(row.get("type") or "text").strip() or "text",
        }
    return out


def _load_submitted_node_rows(
    conn: psycopg.Connection, ticket_internal_id: int, template_code: str
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT wn.node_key,
               wn.node_name,
               wn.node_order,
               tnd.values_json,
               tnd.created_at,
               tnd.schema_snapshot,
               COALESCE(tnd.schema_snapshot->>'draft', '') AS draft
        FROM ticket_node_data tnd
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE tnd.ticket_id = %s
          AND wt.template_code = %s
        ORDER BY wn.node_order ASC, tnd.created_at ASC, tnd.id ASC
        """,
        (ticket_internal_id, template_code),
    ).fetchall()
    return [dict(r) for r in rows if not _is_draft_row(dict(r))]


def merge_submitted_field_values(
    node_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """同 key：流程更靠后节点的非空值覆盖更早节点（空不覆盖）。"""
    merged: dict[str, Any] = {}
    for row in node_rows:
        vals = values_json_as_dict(row.get("values_json"))
        if not vals:
            continue
        for key, raw in vals.items():
            k = str(key or "").strip()
            if not k or k in _EXCLUDED_FIELD_KEYS:
                continue
            if not _value_nonempty(raw):
                continue
            merged[k] = raw
    return merged


def build_ask_jiuwen_prompt_text(
    *,
    ticket_no: str,
    current_stage: str,
    status: str,
    merged_values: dict[str, Any],
    field_meta: dict[str, dict[str, Any]],
) -> str:
    status_label = "已关闭" if str(status or "").strip().lower() == "closed" else "进行中"
    lines: list[str] = [
        f"【工单问诊 {ticket_no}】请基于以下已汇总信息协助排查",
        f"流程ID：{ticket_no}",
        f"当前阶段：{current_stage or '-'}",
        f"状态：{status_label}",
        "",
    ]

    # 按字段定义顺序输出，再补未在 schema 中的键
    ordered_keys = [k for k in field_meta.keys() if k in merged_values]
    seen = set(ordered_keys)
    for k in merged_values:
        if k not in seen:
            ordered_keys.append(k)

    field_lines: list[str] = []
    for key in ordered_keys:
        if key in _EXCLUDED_FIELD_KEYS:
            continue
        meta = field_meta.get(key) or {}
        ftype = str(meta.get("type") or "text")
        if ftype in _EXCLUDED_FIELD_TYPES:
            continue
        label = str(meta.get("label") or key)
        text = _plain_for_prompt(merged_values.get(key), field_type=ftype)
        if not text:
            continue
        field_lines.append(f"{label}：{text}")

    if field_lines:
        lines.extend(field_lines)
    else:
        lines.append("（已提交业务字段较少，请结合流程信息向用户追问。）")

    return "\n".join(lines)


def session_title_from_issue_desc(
    merged_values: dict[str, Any],
    field_meta: dict[str, dict[str, Any]] | None = None,
    *,
    max_len: int = 80,
    fallback: str = "",
) -> str:
    """与详情页顶栏副标题同口径：问题描述纯文本截断。"""
    meta = field_meta or {}
    for desc_key in ("issue_desc", "problem_desc", "description"):
        raw = merged_values.get(desc_key)
        if not _value_nonempty(raw):
            continue
        ftype = str((meta.get(desc_key) or {}).get("type") or "richtext")
        plain = _plain_for_prompt(raw, field_type=ftype, max_len=None)
        plain = " ".join(plain.split()).strip()
        if not plain:
            continue
        if len(plain) > max_len:
            return plain[:max_len] + "…"
        return plain
    return str(fallback or "").strip()


def build_ask_jiuwen_prompt_for_ticket(
    conn: psycopg.Connection, ticket_no: str
) -> dict[str, Any]:
    """返回 {ticket_no, current_stage, status, prompt, field_count}；工单不存在返回 None。"""
    tid = str(ticket_no or "").strip()
    if not tid:
        return None

    row = conn.execute(
        """
        SELECT t.id,
               t.ticket_no,
               COALESCE(t.status, 'open') AS status,
               wt.template_code,
               CASE
                 WHEN COALESCE(t.status, 'open') = 'closed' THEN '已关闭'
                 ELSE COALESCE(wn.node_name, wn.node_key, '-')
               END AS current_stage
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
        WHERE t.ticket_no = %s
        LIMIT 1
        """,
        (tid,),
    ).fetchone()
    if not row:
        return None

    template_code = str(row.get("template_code") or "").strip()
    internal_id = int(row["id"])
    field_meta = _load_field_meta(conn, template_code)
    node_rows = _load_submitted_node_rows(conn, internal_id, template_code)
    merged = merge_submitted_field_values(node_rows)
    # 去掉 file 类型键
    for key, meta in list(field_meta.items()):
        if str(meta.get("type") or "") in _EXCLUDED_FIELD_TYPES:
            merged.pop(key, None)

    prompt = build_ask_jiuwen_prompt_text(
        ticket_no=str(row["ticket_no"]),
        current_stage=str(row.get("current_stage") or "-"),
        status=str(row.get("status") or "open"),
        merged_values=merged,
        field_meta=field_meta,
    )
    title = session_title_from_issue_desc(
        merged, field_meta, fallback=str(row["ticket_no"])
    )

    # 统计实际写入提示词的业务行（去掉头 4 行元信息与空行）
    body_lines = [
        ln
        for ln in prompt.splitlines()
        if ln
        and not ln.startswith("【工单问诊")
        and not ln.startswith("流程ID：")
        and not ln.startswith("当前阶段：")
        and not ln.startswith("状态：")
        and not ln.startswith("（已提交业务字段较少")
    ]
    return {
        "ticket_no": str(row["ticket_no"]),
        "current_stage": str(row.get("current_stage") or "-"),
        "status": str(row.get("status") or "open"),
        "prompt": prompt,
        "field_count": len(body_lines),
        "title": title,
    }
