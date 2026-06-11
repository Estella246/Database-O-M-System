"""统计图表：服务端按时间范围聚合，避免前端拉全量工单。"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable

from config import SCHEMA_TEMPLATE_CODE, TICKET_LIST_SNAPSHOT_ENABLED
from database import db_conn
from utils.date_helpers import parse_ymd
from utils.ticket_status import ticket_status_is_closed

_STATS_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ACCOUNT_LIKE_RE = re.compile(r"^[a-zA-Z]\d{6,}$")
_SPC_VER_RE = re.compile(r"SPC|\.B\d", re.I)
_CORE_C_VER_RE = re.compile(r"^\d+\.\d+\.\d+")

WORKFLOW_NODES = ("问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭")
LABOR_STACK_STAGES = ("问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭")
LABOR_PIE_STAGES = WORKFLOW_NODES + ("关闭", "暂时挂起")
OWNERSHIP_R_LINES = ("503", "505", "506", "V5R001", "V5R002")
OWNERSHIP_L1_LABELS = {"storage": "存储引擎", "sql": "SQL引擎", "peripheral": "周边组件"}

# 复合维度键分隔符（勿用 \\0：PostgreSQL jsonb 禁止 NUL）
METRICS_COMPOUND_SEP = "\x1f"


def metrics_compound_key(left: str, right: str) -> str:
    return f"{left}{METRICS_COMPOUND_SEP}{right}"


def split_metrics_compound_key(raw: str) -> tuple[str, str] | None:
    s = str(raw or "")
    if METRICS_COMPOUND_SEP in s:
        a, b = s.split(METRICS_COMPOUND_SEP, 1)
        return a, b
    if "\x00" in s:
        a, b = s.split("\x00", 1)
        return a, b
    return None

DOER_STAGE_KEYS = (
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
)
DOER_STAGE_NAMES = {
    "problem_review": "问题审核",
    "ops_analysis": "运维分析",
    "dev_analysis": "开发分析",
    "dev_closure": "开发闭环",
    "ops_closure": "运维闭环",
    "audit_close": "审核关闭",
}

DOER_CATEGORY_PRIORITY = {
    "doer_resolved": 5,
    "doer_helped": 4,
    "doer_no_help": 3,
    "no_doer": 2,
    "urgent_hard": 2,
    "not_filled": 1,
    "unknown": 0,
}


def _normalize_person_name(raw: str) -> str:
    base = str(raw or "").strip()
    if not base:
        return ""
    compact = re.sub(r"[()（）]", " ", base)
    compact = re.sub(r"\s+", " ", compact).strip()
    if not compact:
        return ""
    tokens = compact.split()
    non_account = [t for t in tokens if not _ACCOUNT_LIKE_RE.match(t)]
    if non_account and len(non_account) != len(tokens):
        return " ".join(non_account)
    without_suffix = re.sub(r"[\s·_-]*[a-zA-Z]\d{6,}$", "", compact, flags=re.I).strip()
    return without_suffix or compact


def _find_admin_user(raw: str, admin_users: list[dict[str, Any]]) -> dict[str, Any] | None:
    name = str(raw or "").strip()
    if not name:
        return None
    normalized = _normalize_person_name(name)
    for u in admin_users:
        user_name = str(u.get("user_name") or "").strip()
        account = str(u.get("account") or "").strip()
        if user_name == name or account == name:
            return u
        if _normalize_person_name(user_name) == normalized or account == normalized:
            return u
    return None


def _ticket_group(ticket: dict[str, Any], admin_users: list[dict[str, Any]]) -> str:
    handler = str(ticket.get("currentHandler") or ticket.get("assignee") or "").strip()
    creator = str(ticket.get("creatorName") or "").strip()
    for cand in (handler, creator):
        if not cand:
            continue
        hit = _find_admin_user(cand, admin_users)
        if hit and str(hit.get("group_name") or "").strip():
            return str(hit.get("group_name") or "").strip()
    return "未分组"


def _person_product_line(raw: str, admin_users: list[dict[str, Any]]) -> str:
    hit = _find_admin_user(raw, admin_users)
    return str(hit.get("product_line") or "").strip() if hit else ""


def _stats_day(ticket: dict[str, Any]) -> str:
    s = str(ticket.get("startDate") or "").strip()
    if _STATS_DAY_RE.match(s):
        return s
    created = ticket.get("createdAt") or ticket.get("created_at") or ""
    if isinstance(created, datetime):
        return created.astimezone(timezone.utc).strftime("%Y-%m-%d")
    s = str(created).strip()
    return s[:10] if len(s) >= 10 else ""


def _ticket_stage(ticket: dict[str, Any]) -> str:
    st = str(ticket.get("status") or "").strip().lower()
    if st == "closed" or ticket_status_is_closed(ticket.get("status")):
        return "关闭"
    if st == "suspended":
        return "暂时挂起"
    return str(ticket.get("currentStage") or ticket.get("node") or "").strip() or "问题审核"


def _is_open(ticket: dict[str, Any]) -> bool:
    return str(ticket.get("status") or "").strip().lower() != "closed" and not ticket_status_is_closed(
        ticket.get("status")
    )


def _quality_value(ticket: dict[str, Any]) -> str:
    raw = str(ticket.get("isQualityIssue") or ticket.get("is_quality_issue") or "").strip()
    if not raw:
        return ""
    if "新发现" in raw:
        return "new"
    if "已知" in raw:
        return "known"
    if raw == "否":
        return "no"
    if raw == "是":
        return "known"
    return ""


def _is_quality_severity(ticket: dict[str, Any]) -> bool:
    sev = str(ticket.get("severity") or "").strip()
    return sev in ("严重", "致命")


def _ticket_component(ticket: dict[str, Any]) -> str:
    raw = str(ticket.get("component") or ticket.get("problemComponent") or "").strip()
    if "内核" in raw:
        return "kernel"
    if "管控" in raw:
        return "control"
    desc = str(ticket.get("description") or "")
    if "内核" in desc:
        return "kernel"
    if "管控" in desc:
        return "control"
    return "all"


def _ticket_version(ticket: dict[str, Any]) -> str:
    gauss = str(ticket.get("gauss_version") or ticket.get("gaussVersion") or "").strip()
    if gauss:
        return gauss
    direct = str(ticket.get("hcsVersion") or ticket.get("version") or "").strip()
    if direct:
        return direct
    desc = str(ticket.get("description") or "")
    m = re.search(r"(\d+\.\d+(?:\.\d+)?(?:\.SPC\d+)?)", desc)
    return m.group(1) if m else "未知版本"


def _module_path(ticket: dict[str, Any], kind: str) -> str:
    key = "issue_owner_module" if kind == "owner" else "issue_intro_module"
    return str(ticket.get(key) or "").strip()


def _parse_module_levels(path: str) -> tuple[str, str, str]:
    s = str(path or "").strip()
    if not s:
        return ("未填写", "未填写", "未填写")
    parts = [p.strip() for p in s.split("/") if p.strip()]
    return (
        parts[0] if parts else "未填写",
        parts[1] if len(parts) >= 2 else "未填写",
        parts[2] if len(parts) >= 3 else "未填写",
    )


def _r_of_version(v: str) -> str:
    if v.startswith("505"):
        return "505"
    if v.startswith("503"):
        return "503"
    if v.startswith("506"):
        return "506"
    if "V500R001" in v:
        return "V5R001"
    if "V500R002" in v:
        return "V5R002"
    return "505"


def _is_spc_version(ver: str) -> bool:
    return bool(_SPC_VER_RE.search(str(ver or "")))


def _is_core_c_version(ver: str) -> bool:
    s = str(ver or "").strip()
    if not s or _is_spc_version(s):
        return False
    return bool(_CORE_C_VER_RE.match(s))


def _count_by(rows: list[dict[str, Any]], key_fn) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for t in rows:
        out[str(key_fn(t))] += 1
    return dict(out)


def _top_entries(counts: dict[str, int], limit: int = 10) -> list[dict[str, Any]]:
    return [{"name": k, "value": v} for k, v in sorted(counts.items(), key=lambda x: (-x[1], x[0]))[:limit]]


def _dedupe_dts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for t in rows:
        dts = str(t.get("dts_no") or "").strip()
        if dts:
            if dts in seen:
                continue
            seen.add(dts)
        out.append(t)
    return out


def _build_time_labels(start: date, end: date, precision: str) -> list[str]:
    labels: list[str] = []
    if precision == "day":
        d = start
        guard = 0
        while d <= end and guard < 400:
            labels.append(f"{d.month}/{d.day}")
            d = date.fromordinal(d.toordinal() + 1)
            guard += 1
    elif precision == "month":
        d = date(start.year, start.month, 1)
        end_m = date(end.year, end.month, 1)
        while d <= end_m:
            labels.append(f"{d.year}-{d.month:02d}")
            if d.month == 12:
                d = date(d.year + 1, 1, 1)
            else:
                d = date(d.year, d.month + 1, 1)
    else:
        y = start.year
        while y <= end.year:
            labels.append(str(y))
            y += 1
    return labels or ["—"]


def _bucket_label(ymd: str, precision: str) -> str:
    if not _STATS_DAY_RE.match(ymd):
        return "—"
    y, m, d = int(ymd[:4]), int(ymd[5:7]), int(ymd[8:10])
    if precision == "day":
        return f"{m}/{d}"
    if precision == "month":
        return f"{y}-{m:02d}"
    return str(y)


def _series_for_rows(rows: list[dict[str, Any]], labels: list[str], precision: str) -> list[int]:
    idx = {lab: i for i, lab in enumerate(labels)}
    out = [0] * len(labels)
    for t in rows:
        lab = _bucket_label(_stats_day(t), precision)
        i = idx.get(lab)
        if i is not None:
            out[i] += 1
    return out


def _build_sunburst(rows: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    l1_map: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for t in rows:
        l1, l2, l3 = _parse_module_levels(_module_path(t, kind))
        l1_map[l1][l2][l3] += 1

    def branch_count(l3_map: dict[str, int]) -> int:
        return sum(l3_map.values())

    result = []
    for l1, l2_map in sorted(l1_map.items(), key=lambda x: -sum(branch_count(v) for v in x[1].values())):
        children = []
        for l2, l3_map in sorted(l2_map.items(), key=lambda x: -branch_count(x[1])):
            l3_children = [{"name": l3, "value": v} for l3, v in sorted(l3_map.items(), key=lambda x: -x[1])]
            children.append({"name": l2, "children": l3_children})
        result.append({"name": l1, "children": children})
    return result


def _load_admin_users(conn: psycopg.Connection) -> list[dict[str, Any]]:
    try:
        rows = conn.execute(
            "SELECT account, user_name, group_name, product_line FROM user_account"
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _snapshot_table_ready(conn: psycopg.Connection) -> bool:
    if not TICKET_LIST_SNAPSHOT_ENABLED:
        return False
    try:
        r = conn.execute("SELECT to_regclass('public.ticket_list_snapshot') AS name").fetchone()
        return bool(r and r.get("name"))
    except Exception:
        return False


def _row_from_snapshot(r: dict[str, Any]) -> dict[str, Any]:
    extra = r.get("extra_fields") or {}
    if not isinstance(extra, dict):
        extra = {}
    created = r.get("created_at")
    created_iso = created.isoformat() if hasattr(created, "isoformat") else str(created or "")
    order_id = str(r.get("ticket_no") or "")
    row = {
        "orderId": order_id,
        "processId": order_id,
        "status": str(r.get("status") or "open"),
        "creatorName": str(r.get("creator_name") or ""),
        "creatorId": str(r.get("creator_id") or ""),
        "currentStage": str(r.get("current_stage") or ""),
        "currentHandler": str(r.get("current_handler") or ""),
        "assignee": str(r.get("current_handler") or ""),
        "startDate": str(r.get("start_date") or ""),
        "location": str(r.get("location") or ""),
        "bizEnv": str(r.get("biz_env") or ""),
        "severity": str(r.get("severity") or "一般"),
        "isQualityIssue": str(r.get("is_quality_issue") or ""),
        "description": str(r.get("description_plain") or "")[:200],
        "createdAt": created_iso,
        **{k: str(v or "") for k, v in extra.items()},
    }
    return row


def fetch_stats_tickets(
    conn: psycopg.Connection,
    operator_id: str,
    start_date: date,
    end_date: date,
    *,
    only_self: bool,
) -> list[dict[str, Any]]:
    """按 stats_day 落在 [start_date, end_date] 的 HCS 工单。"""
    from routers.tickets import _get_whitelist_flags, _list_tickets_legacy

    if _snapshot_table_ready(conn):
        params: list[Any] = [only_self, operator_id, SCHEMA_TEMPLATE_CODE, start_date, end_date]
        sql = """
            SELECT tls.ticket_no, tls.status, tls.creator_name, tls.creator_id,
                   tls.current_stage, tls.current_handler, tls.start_date, tls.location,
                   tls.biz_env, tls.severity, tls.is_quality_issue, tls.description_plain,
                   tls.extra_fields, tls.created_at
            FROM ticket_list_snapshot tls
            WHERE (%s = FALSE OR tls.creator_id = %s)
              AND tls.template_code = %s
              AND COALESCE(
                CASE WHEN tls.start_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN tls.start_date::date ELSE NULL END,
                DATE(timezone('Asia/Shanghai', tls.created_at))
              ) BETWEEN %s AND %s
        """
        try:
            rows = conn.execute(sql, tuple(params)).fetchall()
            return [_row_from_snapshot(dict(r)) for r in rows]
        except UndefinedTable:
            pass

    legacy = _list_tickets_legacy(
        operator_id=operator_id,
        template_code=SCHEMA_TEMPLATE_CODE,
    )
    items = legacy.get("items") or []
    out: list[dict[str, Any]] = []
    for it in items:
        row = {
            "orderId": str(it.get("order_id") or it.get("orderId") or ""),
            "processId": str(it.get("process_id") or it.get("order_id") or ""),
            "status": str(it.get("status") or "open"),
            "creatorName": str(it.get("creator_name") or it.get("creatorName") or ""),
            "creatorId": str(it.get("creator_id") or it.get("creatorId") or ""),
            "currentStage": str(it.get("current_stage") or it.get("currentStage") or ""),
            "currentHandler": str(it.get("current_handler") or it.get("currentHandler") or ""),
            "assignee": str(it.get("current_handler") or it.get("assignee") or ""),
            "startDate": str(it.get("start_date") or it.get("startDate") or ""),
            "location": str(it.get("location") or ""),
            "bizEnv": str(it.get("biz_env") or it.get("bizEnv") or ""),
            "severity": str(it.get("severity") or "一般"),
            "isQualityIssue": str(it.get("is_quality_issue") or it.get("isQualityIssue") or ""),
            "description": str(it.get("description") or "")[:200],
            "createdAt": str(it.get("created_at") or it.get("createdAt") or ""),
        }
        for k, v in it.items():
            if k not in row and isinstance(v, (str, int, float, bool)):
                row[k] = v
        sd = start_date.isoformat()
        ed = end_date.isoformat()
        day = _stats_day(row)
        if day and sd <= day <= ed:
            out.append(row)
    return out


def _filter_ownership_rows(
    rows: list[dict[str, Any]], quality: str, component: str
) -> list[dict[str, Any]]:
    scoped = rows
    if component != "all":
        scoped = [t for t in scoped if _ticket_component(t) == component]
    if quality == "all":
        return scoped
    out: list[dict[str, Any]] = []
    for t in scoped:
        v = _quality_value(t)
        if not v:
            continue
        if quality == "yes" and v in ("known", "new"):
            out.append(t)
        elif quality in ("known", "new", "no") and v == quality:
            out.append(t)
    return out


def build_ownership_payload(
    rows: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
) -> dict[str, Any]:
    all_rows = _filter_ownership_rows(rows, quality, component)
    time_labels = _build_time_labels(start_date, end_date, precision)
    trend_rows = [t for t in all_rows if _quality_value(t)]
    known_rows = [t for t in trend_rows if _quality_value(t) == "known"]
    new_rows = [t for t in trend_rows if _quality_value(t) == "new"]
    no_rows = [t for t in trend_rows if _quality_value(t) == "no"]

    by_version = _count_by(all_rows, _ticket_version)
    versions = sorted(by_version.keys(), key=lambda k: (-by_version[k], k))[:11]
    versions_for_series = versions or ["未知版本"]

    by_env = _count_by(all_rows, lambda t: str(t.get("bizEnv") or "").strip() or "未知环境")
    env_keys = list(by_env.keys())[:5]

    by_site = _count_by(all_rows, lambda t: str(t.get("location") or "").strip() or "未知局点")
    by_site_inst: dict[str, set[str]] = defaultdict(set)
    for t in all_rows:
        site = str(t.get("location") or "").strip() or "未知局点"
        pid = str(t.get("processId") or t.get("orderId") or "").strip()
        if pid:
            by_site_inst[site].add(pid)

    spc_all = _top_entries(
        _count_by([t for t in all_rows if _is_spc_version(_ticket_version(t))], _ticket_version), 20
    )
    spc_open = _top_entries(
        _count_by(
            [t for t in all_rows if _is_open(t) and _is_spc_version(_ticket_version(t))], _ticket_version
        ),
        20,
    )
    core_bars = _top_entries(
        _count_by([t for t in all_rows if _is_core_c_version(_ticket_version(t))], _ticket_version), 10
    )

    l1_bars: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for kind in ("intro", "owner"):
        l1_bars[kind] = {}
        for key, label in OWNERSHIP_L1_LABELS.items():
            for dedup in (False, True):
                scoped = all_rows
                scoped = [t for t in scoped if _parse_module_levels(_module_path(t, kind))[0] == label]
                if dedup:
                    scoped = _dedupe_dts(scoped)
                counts = _count_by(scoped, lambda t: _parse_module_levels(_module_path(t, kind))[1])
                l1_bars[kind][f"{key}_{'dedup' if dedup else 'raw'}"] = _top_entries(counts, 20)

    version_cat_rows = list(by_env.keys())[:8]
    version_cat_cols = versions_for_series[:11]
    version_cat_cells: list[list[int]] = []
    for er in version_cat_rows:
        row_cells = []
        for col in version_cat_cols:
            row_cells.append(
                sum(
                    1
                    for t in all_rows
                    if (str(t.get("bizEnv") or "").strip() or "未知环境") == er and _ticket_version(t) == col
                )
            )
        version_cat_cells.append(row_cells)

    hotspot: dict[str, Any] = {}
    for kind in ("intro", "owner"):
        by_l1 = _count_by(all_rows, lambda t, k=kind: _parse_module_levels(_module_path(t, k))[0])
        module_rows = [k for k, _ in sorted(by_l1.items(), key=lambda x: (-x[1], x[0]))[:8]]
        version_cols = [k for k, _ in sorted(by_version.items(), key=lambda x: (-x[1], x[0]))[:5]]
        cells = []
        for l1 in module_rows:
            row_tickets = [t for t in all_rows if _parse_module_levels(_module_path(t, kind))[0] == l1]
            counts = [sum(1 for t in row_tickets if _ticket_version(t) == ver) for ver in version_cols]
            cells.append({"l1": l1, "counts": counts})
        hotspot[kind] = {"moduleRows": module_rows, "versionCols": version_cols or ["—"], "cells": cells}

    return {
        "time_labels": time_labels,
        "precision": precision,
        "trend": {
            "known": _series_for_rows(known_rows, time_labels, precision),
            "new": _series_for_rows(new_rows, time_labels, precision),
            "no": _series_for_rows(no_rows, time_labels, precision),
        },
        "by_version_time": {
            ver: _series_for_rows([t for t in all_rows if _ticket_version(t) == ver], time_labels, precision)
            for ver in versions_for_series
        },
        "by_biz_env_time": {
            env: _series_for_rows(
                [t for t in all_rows if (str(t.get("bizEnv") or "").strip() or "未知环境") == env],
                time_labels,
                precision,
            )
            for env in env_keys
        },
        "by_r_version_time": {
            name: _series_for_rows([t for t in all_rows if _r_of_version(_ticket_version(t)) == name], time_labels, precision)
            for name in OWNERSHIP_R_LINES
        },
        "sunburst": {
            "intro": _build_sunburst(all_rows, "intro"),
            "owner": _build_sunburst(all_rows, "owner"),
        },
        "l1_bars": l1_bars,
        "top_site": _top_entries(by_site, 20),
        "top_inst_site": _top_entries({k: len(v) for k, v in by_site_inst.items()}, 20),
        "top_ver": _top_entries(by_version, 20),
        "top_inst_ver": _top_entries(
            _count_by([t for t in all_rows if _is_open(t)], _ticket_version), 20
        ),
        "spc_bars": spc_all[:10],
        "inst_spc_bars": spc_open[:10],
        "core_bars": core_bars,
        "top_mod_intro": _top_entries(
            _count_by(all_rows, lambda t: _parse_module_levels(_module_path(t, "intro"))[0]), 10
        ),
        "top_mod_owner": _top_entries(
            _count_by(all_rows, lambda t: _parse_module_levels(_module_path(t, "owner"))[0]), 10
        ),
        "version_category_table": {
            "rows": version_cat_rows,
            "cols": version_cat_cols,
            "cells": version_cat_cells,
        },
        "hotspot": hotspot,
    }


def build_labor_payload(
    rows: list[dict[str, Any]],
    admin_users: list[dict[str, Any]],
    product_line: str,
) -> dict[str, Any]:
    if product_line:
        rows = [
            t
            for t in rows
            if _person_product_line(
                str(t.get("currentHandler") or t.get("assignee") or t.get("creatorName") or ""), admin_users
            )
            == product_line
        ]

    groups = sorted({ _ticket_group(t, admin_users) for t in rows }, key=lambda x: x)
    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    def person_name(t: dict[str, Any]) -> str:
        raw = str(t.get("currentHandler") or t.get("assignee") or t.get("creatorName") or "").strip()
        return _normalize_person_name(raw) or "未分配"

    by_person = _count_by(rows, person_name)
    open_rows = [t for t in rows if _is_open(t)]
    by_person_open = _count_by(open_rows, person_name)
    by_stage_open = _count_by(open_rows, _ticket_stage)

    by_group_stage_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in open_rows:
        by_group_stage_open[_ticket_group(t, admin_users)][_ticket_stage(t)] += 1

    by_stage_all = _count_by(rows, _ticket_stage)

    dwell_by_stage: dict[str, float] = {}
    for stage in LABOR_STACK_STAGES:
        stage_rows = [t for t in rows if _ticket_stage(t) == stage]
        if not stage_rows:
            dwell_by_stage[stage] = 0.0
            continue
        total_h = 0.0
        for t in stage_rows:
            created = t.get("createdAt") or ""
            try:
                if isinstance(created, str) and created:
                    ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() * 1000
                else:
                    ts = now_ms
            except ValueError:
                ts = now_ms
            total_h += max(0.0, (now_ms - ts) / 3600000.0)
        dwell_by_stage[stage] = round(total_h / len(stage_rows))

    by_person_stage: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in rows:
        by_person_stage[person_name(t)][_ticket_stage(t)] += 1

    by_person_flow: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in rows:
        p = person_name(t)
        g = _ticket_group(t, admin_users)
        by_group_person[g][p] += 1
        if _is_open(t):
            by_group_person_open[g][p] += 1
        st = _ticket_stage(t)
        if str(t.get("status") or "").lower() == "closed" or ticket_status_is_closed(t.get("status")):
            by_person_flow[p]["独立闭环"] += 1
        elif "开发" in st or "运维" in st:
            by_person_flow[p]["流转至尖刀连"] += 1

    return {
        "groups": groups,
        "stages": list(LABOR_STACK_STAGES),
        "pie_stages": list(LABOR_PIE_STAGES),
        "counts": {
            "by_person": by_person,
            "by_person_open": by_person_open,
            "by_stage_open": dict(by_stage_open),
            "by_group_stage_open": {g: dict(v) for g, v in by_group_stage_open.items()},
            "by_stage_all": by_stage_all,
            "by_person_stage": {p: dict(v) for p, v in by_person_stage.items()},
            "by_person_flow": {p: dict(v) for p, v in by_person_flow.items()},
            "by_group_person": {g: dict(v) for g, v in by_group_person.items()},
            "by_group_person_open": {g: dict(v) for g, v in by_group_person_open.items()},
        },
        "dwell": {"by_stage_hours": dwell_by_stage},
    }


def _classify_single_phase_doer(vals: dict[str, Any] | None) -> str:
    if not vals:
        return "not_filled"
    val = str(vals.get("use_doer_assist") or "")
    mapping = {
        "使用Doer，问题定位/解决": "doer_resolved",
        "使用Doer，仅提供思路/辅助提效": "doer_helped",
        "使用Doer，无帮助": "doer_no_help",
        "未使用Doer": "no_doer",
        "紧急疑难工单": "urgent_hard",
    }
    if val in mapping:
        return mapping[val]
    if not val:
        return "not_filled"
    return "unknown"


def _classify_doer_multi(nodes: dict[str, Any], include_ops: bool, include_dev: bool) -> str:
    cats: list[str] = []
    if include_ops:
        cats.append(_classify_single_phase_doer(nodes.get("ops_analysis")))
    if include_dev:
        cats.append(_classify_single_phase_doer(nodes.get("dev_analysis")))
    if not cats:
        return "unknown"
    best = "unknown"
    best_p = -1
    for cat in cats:
        p = DOER_CATEGORY_PRIORITY.get(cat, 0)
        if p > best_p:
            best_p = p
            best = cat
    return best


def _is_consult_ticket(nodes: dict[str, Any]) -> bool:
    ops = nodes.get("ops_analysis") or {}
    dev = nodes.get("dev_analysis") or {}
    return str(ops.get("is_consult_issue") or "") == "是" or str(dev.get("is_consult_issue") or "") == "是"


def _consult_efficiency_block(items: list[dict[str, Any]], *, consult: bool) -> dict[str, Any]:
    filtered = [it for it in items if _is_consult_ticket(it.get("nodes") or {}) == consult]
    used: list[dict[str, Any]] = []
    not_used: list[dict[str, Any]] = []
    for it in filtered:
        cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            used.append(it)
        elif cat == "no_doer":
            not_used.append(it)

    stages = [DOER_STAGE_NAMES[k] for k in DOER_STAGE_KEYS]

    def avg_hours(tickets: list[dict[str, Any]], node_key: str) -> float:
        hours = [
            float((t.get("instances") or {}).get(node_key, {}).get("hours") or 0)
            for t in tickets
            if float((t.get("instances") or {}).get(node_key, {}).get("hours") or 0) > 0
        ]
        if not hours:
            return 0.0
        return sum(hours) / len(hours)

    avg_used = [round(avg_hours(used, k), 2) for k in DOER_STAGE_KEYS]
    avg_no = [round(avg_hours(not_used, k), 2) for k in DOER_STAGE_KEYS]
    gains = [
        round(((avg_no[i] - avg_used[i]) / avg_no[i]) * 100) if avg_no[i] else 0 for i in range(len(stages))
    ]
    valid_gains = [g for g in gains if g > 0]
    avg_gain = round(sum(valid_gains) / len(valid_gains)) if valid_gains else 0
    max_gain = max(gains) if gains else 0
    max_stage = stages[gains.index(max_gain)] if max_gain else ""

    return {
        "stages": stages,
        "stageKeys": list(DOER_STAGE_KEYS),
        "avgHoursUsedDoer": avg_used,
        "avgHoursNoDoer": avg_no,
        "efficiencyGains": gains,
        "avgEfficiencyGain": avg_gain,
        "maxGainStage": max_stage,
        "maxGainValue": max_gain,
        "usedDoerCount": len(used),
        "noDoerCount": len(not_used),
        "totalConsultCount": len(filtered) if consult else 0,
        "totalNonConsultCount": len(filtered) if not consult else 0,
    }


def _fetch_doer_items(conn: psycopg.Connection, ticket_ids: list[int]) -> list[dict[str, Any]]:
    from routers.tickets import SCHEMA_TEMPLATE_CODE, PERSON_VALUE_FIELD_KEYS, _normalize_person_field_value
    from utils.ticket_closed_at import closed_at_iso, fetch_ticket_closed_at_by_id

    if not ticket_ids:
        return []

    node_data_rows = conn.execute(
        """
        SELECT tnd.ticket_id, wn.node_key, tnd.values_json
        FROM ticket_node_data tnd
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE tnd.ticket_id = ANY(%s) AND wt.template_code = %s
        ORDER BY tnd.ticket_id, wn.node_key, tnd.created_at DESC
        """,
        (ticket_ids, SCHEMA_TEMPLATE_CODE),
    ).fetchall()

    by_ticket_node: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    for ndr in node_data_rows:
        tid = int(ndr["ticket_id"])
        nk = str(ndr["node_key"])
        if nk in by_ticket_node[tid]:
            continue
        raw_vals = ndr["values_json"]
        vals = dict(raw_vals) if isinstance(raw_vals, dict) else {}
        for pk in PERSON_VALUE_FIELD_KEYS:
            if pk in vals and isinstance(vals[pk], str):
                vals[pk] = _normalize_person_field_value(pk, vals[pk])
        by_ticket_node[tid][nk] = vals

    instance_rows = conn.execute(
        """
        SELECT tni.ticket_id, wn.node_key, tni.started_at, tni.ended_at
        FROM ticket_node_instance tni
        JOIN workflow_node wn ON wn.id = tni.node_id
        WHERE tni.ticket_id = ANY(%s) AND wn.node_key = ANY(%s)
        """,
        (ticket_ids, list(DOER_STAGE_KEYS)),
    ).fetchall()

    now_utc = datetime.now(timezone.utc)
    by_ticket_instance: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    for ir in instance_rows:
        tid = int(ir["ticket_id"])
        nk = str(ir["node_key"])
        st = ir["started_at"]
        et = ir["ended_at"] or now_utc
        if st:
            hours = max(0.0, (et - st).total_seconds() / 3600.0)
            by_ticket_instance[tid][nk] = {"hours": round(hours, 2)}

    closed_at_by_id = fetch_ticket_closed_at_by_id(conn, ticket_ids)
    meta_rows = conn.execute(
        "SELECT id, ticket_no, created_at FROM ticket WHERE id = ANY(%s)",
        (ticket_ids,),
    ).fetchall()
    meta_by_id = {int(r["id"]): r for r in meta_rows}

    items: list[dict[str, Any]] = []
    for tid in ticket_ids:
        meta = meta_by_id.get(tid)
        if not meta:
            continue
        created = meta["created_at"]
        closed = closed_at_by_id.get(tid)
        items.append(
            {
                "ticket_no": str(meta["ticket_no"]),
                "nodes": by_ticket_node.get(tid, {}),
                "instances": by_ticket_instance.get(tid, {}),
                "created_at": created.isoformat() if hasattr(created, "isoformat") else str(created or ""),
                "closed_at": closed_at_iso(closed),
            }
        )
    return items


def build_doer_payload(
    conn: psycopg.Connection,
    rows: list[dict[str, Any]],
    include_ops: bool,
    include_dev: bool,
) -> dict[str, Any]:
    ticket_nos = [str(t.get("orderId") or "") for t in rows if t.get("orderId")]
    if not ticket_nos:
        empty_slices = [
            {"label": "问题定位/解决", "value": 0},
            {"label": "思路/辅助提效", "value": 0},
            {"label": "无帮助", "value": 0},
            {"label": "未使用Doer", "value": 0},
            {"label": "紧急疑难工单", "value": 0},
            {"label": "未填写", "value": 0},
        ]
        return {
            "total": 0,
            "doerResolved": 0,
            "doerHelped": 0,
            "doerNoHelp": 0,
            "noDoer": 0,
            "urgentHard": 0,
            "notFilled": 0,
            "unknown": 0,
            "usedDoer": 0,
            "effective": 0,
            "filledTotal": 0,
            "includeOps": include_ops,
            "includeDev": include_dev,
            "usageSlices": empty_slices,
            "effectivenessSlices": [
                {"label": "有效(定位/解决+辅助提效)", "value": 0},
                {"label": "无帮助", "value": 0},
            ],
            "consultEfficiency": _consult_efficiency_block([], consult=True),
            "nonConsultEfficiency": _consult_efficiency_block([], consult=False),
            "dailyClosed": {"labels": [], "values": [], "totalCount": 0, "avgDuration": 0},
            "dailyDoerUsage": {"labels": [], "barValues": [], "lineValues": [], "totalUsedDoer": 0, "totalTickets": 0, "avgPct": 0},
            "dailyConsult": {"labels": [], "barValues": [], "lineValues": [], "totalConsult": 0, "totalTickets": 0, "avgPct": 0},
            "monthlyConsult": {"labels": [], "barValues": [], "lineValues": []},
            "dailyDoerEffectiveness": {"labels": [], "barValues": [], "lineValues": [], "avgRate": 0},
        }

    id_rows = conn.execute(
        "SELECT id, ticket_no FROM ticket WHERE ticket_no = ANY(%s)",
        (ticket_nos,),
    ).fetchall()
    ticket_ids = [int(r["id"]) for r in id_rows]
    items = _fetch_doer_items(conn, ticket_ids)

    counts = defaultdict(int)
    for it in items:
        counts[_classify_doer_multi(it.get("nodes") or {}, include_ops, include_dev)] += 1

    doer_resolved = counts["doer_resolved"]
    doer_helped = counts["doer_helped"]
    doer_no_help = counts["doer_no_help"]
    no_doer = counts["no_doer"]
    urgent_hard = counts["urgent_hard"]
    not_filled = counts["not_filled"]
    unknown = counts["unknown"]
    total = len(items)
    used_doer = doer_resolved + doer_helped + doer_no_help
    effective = doer_resolved + doer_helped
    filled_total = used_doer + no_doer + urgent_hard

    # daily closed avg duration
    closed = [it for it in items if it.get("closed_at") and it.get("created_at")]
    by_closed: dict[str, list[float]] = defaultdict(list)
    for it in closed:
        try:
            c0 = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00"))
            c1 = datetime.fromisoformat(str(it["closed_at"]).replace("Z", "+00:00"))
            hours = (c1 - c0).total_seconds() / 3600.0
            ymd = c1.astimezone(timezone.utc).strftime("%Y-%m-%d")
            by_closed[ymd].append(hours)
        except ValueError:
            continue
    sorted_closed_dates = sorted(by_closed.keys())
    daily_closed_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_closed_dates]
    daily_closed_values = [
        round(sum(by_closed[d]) / len(by_closed[d]), 1) if by_closed[d] else 0 for d in sorted_closed_dates
    ]
    total_dur = sum(h for vals in by_closed.values() for h in vals)
    avg_dur = round(total_dur / len(closed), 1) if closed else 0

    # daily doer usage
    by_created: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "usedDoer": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            ymd = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            continue
        by_created[ymd]["total"] += 1
        cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            by_created[ymd]["usedDoer"] += 1
    sorted_created = sorted(by_created.keys())
    daily_doer_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_created]
    daily_doer_bars = [by_created[d]["usedDoer"] for d in sorted_created]
    daily_doer_lines = [
        round(by_created[d]["usedDoer"] / by_created[d]["total"] * 100) if by_created[d]["total"] else 0
        for d in sorted_created
    ]
    tot_used = sum(daily_doer_bars)
    tot_tix = sum(by_created[d]["total"] for d in sorted_created)

    # daily consult
    by_consult_day: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "consult": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            ymd = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            continue
        by_consult_day[ymd]["total"] += 1
        if _is_consult_ticket(it.get("nodes") or {}):
            by_consult_day[ymd]["consult"] += 1
    sorted_consult = sorted(by_consult_day.keys())
    daily_consult_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_consult]
    daily_consult_bars = [by_consult_day[d]["consult"] for d in sorted_consult]
    daily_consult_lines = [
        round(by_consult_day[d]["consult"] / by_consult_day[d]["total"] * 100)
        if by_consult_day[d]["total"]
        else 0
        for d in sorted_consult
    ]

    tot_consult = sum(daily_consult_bars)
    tot_consult_tix = sum(by_consult_day[d]["total"] for d in sorted_consult)
    avg_consult_pct = round(tot_consult / tot_consult_tix * 100) if tot_consult_tix else 0

    # monthly consult
    by_month: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "consult": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            dt = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00"))
            ym = dt.strftime("%Y-%m")
        except ValueError:
            continue
        by_month[ym]["total"] += 1
        if _is_consult_ticket(it.get("nodes") or {}):
            by_month[ym]["consult"] += 1
    sorted_months = sorted(by_month.keys())
    monthly_labels = sorted_months
    monthly_bars = [by_month[m]["consult"] for m in sorted_months]
    monthly_lines = [
        round(by_month[m]["consult"] / by_month[m]["total"] * 100) if by_month[m]["total"] else 0
        for m in sorted_months
    ]

    # daily doer effectiveness
    by_eff: dict[str, dict[str, int]] = defaultdict(lambda: {"used": 0, "effective": 0})
    for it in items:
        if not it.get("created_at"):
            continue
        try:
            ymd = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            continue
        cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            by_eff[ymd]["used"] += 1
            if cat in ("doer_resolved", "doer_helped"):
                by_eff[ymd]["effective"] += 1
    sorted_eff = sorted(by_eff.keys())
    eff_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_eff]
    eff_bars = [by_eff[d]["effective"] for d in sorted_eff]
    eff_lines = [
        round(by_eff[d]["effective"] / by_eff[d]["used"] * 100) if by_eff[d]["used"] else 0 for d in sorted_eff
    ]
    avg_rate = round(sum(eff_bars) / tot_used * 100) if tot_used else 0

    consult_block = _consult_efficiency_block(items, consult=True)
    non_consult_block = _consult_efficiency_block(items, consult=False)

    return {
        "total": total,
        "doerResolved": doer_resolved,
        "doerHelped": doer_helped,
        "doerNoHelp": doer_no_help,
        "noDoer": no_doer,
        "urgentHard": urgent_hard,
        "notFilled": not_filled,
        "unknown": unknown,
        "usedDoer": used_doer,
        "effective": effective,
        "filledTotal": filled_total,
        "includeOps": include_ops,
        "includeDev": include_dev,
        "usageSlices": [
            {"label": "问题定位/解决", "value": doer_resolved},
            {"label": "思路/辅助提效", "value": doer_helped},
            {"label": "无帮助", "value": doer_no_help},
            {"label": "未使用Doer", "value": no_doer},
            {"label": "紧急疑难工单", "value": urgent_hard},
            {"label": "未填写", "value": not_filled},
        ],
        "effectivenessSlices": [
            {"label": "有效(定位/解决+辅助提效)", "value": effective},
            {"label": "无帮助", "value": doer_no_help},
        ],
        "consultEfficiency": consult_block,
        "nonConsultEfficiency": non_consult_block,
        "dailyClosed": {
            "labels": daily_closed_labels,
            "values": daily_closed_values,
            "totalCount": len(closed),
            "avgDuration": avg_dur,
        },
        "dailyDoerUsage": {
            "labels": daily_doer_labels,
            "barValues": daily_doer_bars,
            "lineValues": daily_doer_lines,
            "totalUsedDoer": tot_used,
            "totalTickets": tot_tix,
            "avgPct": round(tot_used / tot_tix * 100) if tot_tix else 0,
        },
        "dailyConsult": {
            "labels": daily_consult_labels,
            "barValues": daily_consult_bars,
            "lineValues": daily_consult_lines,
            "totalConsult": tot_consult,
            "totalTickets": tot_consult_tix,
            "avgPct": avg_consult_pct,
        },
        "monthlyConsult": {
            "labels": monthly_labels,
            "barValues": monthly_bars,
            "lineValues": monthly_lines,
            "totalConsult": sum(monthly_bars),
            "totalTickets": sum(by_month[m]["total"] for m in sorted_months),
            "avgPct": round(sum(monthly_bars) / sum(by_month[m]["total"] for m in sorted_months) * 100)
            if sorted_months and sum(by_month[m]["total"] for m in sorted_months)
            else 0,
        },
        "dailyDoerEffectiveness": {
            "labels": eff_labels,
            "barValues": eff_bars,
            "lineValues": eff_lines,
            "totalUsedDoer": tot_used,
            "totalEffective": sum(eff_bars),
            "avgRate": avg_rate,
            "avgPct": avg_rate,
        },
    }


def _ownership_segment_key(quality: str, component: str) -> str:
    q = str(quality or "all").strip().lower()
    c = str(component or "all").strip().lower()
    if q not in ("known", "new", "no", "yes"):
        q = "all"
    if c not in ("kernel", "control"):
        c = "all"
    return f"{q}_{c}"


def _sum_slice_maps(slices: list[dict[str, Any]], segment_key: str, field: str) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for sl in slices:
        seg = (sl.get("ownership") or {}).get(segment_key) or {}
        src = seg.get(field) or {}
        if isinstance(src, dict):
            for k, v in src.items():
                if isinstance(v, (int, float)):
                    out[str(k)] += int(v)
    return dict(out)


def build_ownership_payload_from_daily_slices(
    daily_slices: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    precision: str,
    quality: str,
    component: str,
) -> dict[str, Any]:
    sk = _ownership_segment_key(quality, component)
    time_labels = _build_time_labels(start_date, end_date, precision)
    idx = {lab: i for i, lab in enumerate(time_labels)}
    trend_known = [0] * len(time_labels)
    trend_new = [0] * len(time_labels)
    trend_no = [0] * len(time_labels)

    by_version_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    by_biz_env_time: dict[str, list[int]] = defaultdict(lambda: [0] * len(time_labels))
    by_r_version_time: dict[str, list[int]] = {name: [0] * len(time_labels) for name in OWNERSHIP_R_LINES}

    for sl in daily_slices:
        seg = (sl.get("ownership") or {}).get(sk) or {}
        ymd = str(sl.get("stats_day") or "")
        lab = _bucket_label(ymd, precision)
        i = idx.get(lab)
        if i is None:
            continue
        trend_known[i] += int(seg.get("trend_known") or 0)
        trend_new[i] += int(seg.get("trend_new") or 0)
        trend_no[i] += int(seg.get("trend_no") or 0)
        for ver, cnt in (seg.get("by_version") or {}).items():
            by_version_time[str(ver)][i] += int(cnt)
        for env, cnt in (seg.get("by_biz_env") or {}).items():
            by_biz_env_time[str(env)][i] += int(cnt)
        for r_ver, cnt in (seg.get("by_r_version") or {}).items():
            if r_ver in by_r_version_time:
                by_r_version_time[r_ver][i] += int(cnt)

    by_version = _sum_slice_maps(daily_slices, sk, "by_version")
    versions = sorted(by_version.keys(), key=lambda k: (-by_version[k], k))[:11]
    versions_for_series = versions or ["未知版本"]
    by_env = _sum_slice_maps(daily_slices, sk, "by_biz_env")
    env_keys = list(by_env.keys())[:5]
    by_site = _sum_slice_maps(daily_slices, sk, "by_site")
    by_site_inst = _sum_slice_maps(daily_slices, sk, "by_site_proc")

    spc_all = _top_entries(_sum_slice_maps(daily_slices, sk, "spc_by_version"), 20)
    spc_open = _top_entries(_sum_slice_maps(daily_slices, sk, "spc_open_by_version"), 20)
    core_bars = _top_entries(_sum_slice_maps(daily_slices, sk, "core_by_version"), 10)

    l1_bars: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for kind, l2_field, dedup_field in (
        ("intro", "module_intro_l2", "dts_dedup_intro_l2"),
        ("owner", "module_owner_l2", "dts_dedup_owner_l2"),
    ):
        l1_bars[kind] = {}
        for key, label in OWNERSHIP_L1_LABELS.items():
            for dedup in (False, True):
                field = dedup_field if dedup else l2_field
                counts: dict[str, int] = defaultdict(int)
                for sl in daily_slices:
                    seg = (sl.get("ownership") or {}).get(sk) or {}
                    for path, cnt in (seg.get(field) or {}).items():
                        l1 = str(path).split("/")[0] if path else "未填写"
                        if l1 == label:
                            l2 = "/".join(str(path).split("/")[:2]) if path else "未填写"
                            counts[l2] += int(cnt)
                l1_bars[kind][f"{key}_{'dedup' if dedup else 'raw'}"] = _top_entries(dict(counts), 20)

    version_env = _sum_slice_maps(daily_slices, sk, "version_env")
    version_cat_rows: list[str] = []
    version_cat_cols = versions_for_series[:11]
    env_ver_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for compound, cnt in version_env.items():
        parts = split_metrics_compound_key(compound)
        if parts:
            env_ver_counts[parts[0]][parts[1]] += int(cnt)
    version_cat_rows = list(env_ver_counts.keys())[:8]
    version_cat_cells = [
        [env_ver_counts.get(er, {}).get(col, 0) for col in version_cat_cols] for er in version_cat_rows
    ]

    hotspot: dict[str, Any] = {}
    for kind, field in (("intro", "hotspot_intro"), ("owner", "hotspot_owner")):
        l1_counts = _sum_slice_maps(daily_slices, sk, f"module_{kind}_l1")
        module_rows = [k for k, _ in sorted(l1_counts.items(), key=lambda x: (-x[1], x[0]))[:8]]
        raw_hot = _sum_slice_maps(daily_slices, sk, field)
        ver_counts: dict[str, int] = defaultdict(int)
        l1_ver: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for compound, cnt in raw_hot.items():
            parts = split_metrics_compound_key(compound)
            if parts:
                l1_ver[parts[0]][parts[1]] += int(cnt)
                ver_counts[parts[1]] += int(cnt)
        version_cols = [k for k, _ in sorted(ver_counts.items(), key=lambda x: (-x[1], x[0]))[:5]]
        cells = [{"l1": l1, "counts": [l1_ver.get(l1, {}).get(ver, 0) for ver in version_cols]} for l1 in module_rows]
        hotspot[kind] = {"moduleRows": module_rows, "versionCols": version_cols or ["—"], "cells": cells}

    def _sunburst_from_l3(field: str) -> list[dict[str, Any]]:
        l3_map = _sum_slice_maps(daily_slices, sk, field)
        l1_map: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
        for path, cnt in l3_map.items():
            parts = [p.strip() for p in str(path).split("/") if p.strip()]
            l1 = parts[0] if parts else "未填写"
            l2 = parts[1] if len(parts) >= 2 else "未填写"
            l3 = parts[2] if len(parts) >= 3 else "未填写"
            l1_map[l1][l2][l3] += int(cnt)
        result = []
        for l1, l2_map in sorted(l1_map.items(), key=lambda x: -sum(sum(v.values()) for v in x[1].values())):
            children = []
            for l2, l3_map2 in sorted(l2_map.items(), key=lambda x: -sum(x[1].values())):
                l3_children = [{"name": l3, "value": v} for l3, v in sorted(l3_map2.items(), key=lambda x: -x[1])]
                children.append({"name": l2, "children": l3_children})
            result.append({"name": l1, "children": children})
        return result

    return {
        "time_labels": time_labels,
        "precision": precision,
        "trend": {"known": trend_known, "new": trend_new, "no": trend_no},
        "by_version_time": {
            ver: by_version_time.get(ver, [0] * len(time_labels)) for ver in versions_for_series
        },
        "by_biz_env_time": {env: by_biz_env_time.get(env, [0] * len(time_labels)) for env in env_keys},
        "by_r_version_time": by_r_version_time,
        "sunburst": {
            "intro": _sunburst_from_l3("module_intro_l3"),
            "owner": _sunburst_from_l3("module_owner_l3"),
        },
        "l1_bars": l1_bars,
        "top_site": _top_entries(by_site, 20),
        "top_inst_site": _top_entries(by_site_inst, 20),
        "top_ver": _top_entries(by_version, 20),
        "top_inst_ver": _top_entries(_sum_slice_maps(daily_slices, sk, "open_by_version"), 20),
        "spc_bars": spc_all[:10],
        "inst_spc_bars": spc_open[:10],
        "core_bars": core_bars,
        "top_mod_intro": _top_entries(_sum_slice_maps(daily_slices, sk, "module_intro_l1"), 10),
        "top_mod_owner": _top_entries(_sum_slice_maps(daily_slices, sk, "module_owner_l1"), 10),
        "version_category_table": {
            "rows": version_cat_rows,
            "cols": version_cat_cols,
            "cells": version_cat_cells,
        },
        "hotspot": hotspot,
    }


def _merge_labor_from_slices(daily_slices: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {
        "by_person": {},
        "by_person_open": {},
        "by_stage_open": {},
        "by_group_stage_open": {},
        "by_stage_all": {},
        "by_person_stage": {},
        "by_person_stage_open": {},
        "by_person_flow": {},
        "by_group_person": {},
        "by_group_person_open": {},
        "open_dwell": {},
        "open_dwell_stack": {},
    }
    for sl in daily_slices:
        lab = sl.get("labor") or {}
        for k in ("by_person", "by_person_open", "by_stage_open", "by_stage_all"):
            for pk, v in (lab.get(k) or {}).items():
                merged[k][pk] = int(merged[k].get(pk, 0)) + int(v)
        for person, stages in (lab.get("by_person_stage") or {}).items():
            ps = merged["by_person_stage"].setdefault(person, {})
            for st, v in stages.items():
                ps[st] = int(ps.get(st, 0)) + int(v)
        for person, stages in (lab.get("by_person_stage_open") or {}).items():
            ps = merged.setdefault("by_person_stage_open", {}).setdefault(person, {})
            for st, v in stages.items():
                ps[st] = int(ps.get(st, 0)) + int(v)
        for person, flows in (lab.get("by_person_flow") or {}).items():
            pf = merged["by_person_flow"].setdefault(person, {})
            for fk, v in flows.items():
                pf[fk] = int(pf.get(fk, 0)) + int(v)
        for stage, bucket in (lab.get("open_dwell") or {}).items():
            ob = merged["open_dwell"].setdefault(stage, {"count": 0, "sum_created_ms": 0.0})
            ob["count"] += int(bucket.get("count") or 0)
            ob["sum_created_ms"] += float(bucket.get("sum_created_ms") or 0)
        for stage, bucket in (lab.get("open_dwell_stack") or {}).items():
            ob = merged["open_dwell_stack"].setdefault(stage, {"count": 0, "sum_created_ms": 0.0})
            ob["count"] += int(bucket.get("count") or 0)
            ob["sum_created_ms"] += float(bucket.get("sum_created_ms") or 0)
    return merged


def build_labor_payload_from_daily_slices(
    daily_slices: list[dict[str, Any]],
    admin_users: list[dict[str, Any]],
    product_line: str,
) -> dict[str, Any]:
    if product_line:
        pl = str(product_line).strip()
        filtered: list[dict[str, Any]] = []
        for sl in daily_slices:
            lab = sl.get("labor") or {}
            keep = False
            for person in (lab.get("by_person") or {}).keys():
                if _person_product_line(str(person), admin_users) == pl:
                    keep = True
                    break
            if keep:
                filtered.append(sl)
        daily_slices = filtered

    merged = _merge_labor_from_slices(daily_slices)
    groups_set: set[str] = set()
    for person in merged["by_person"].keys():
        fake_ticket = {"currentHandler": person, "creatorName": person}
        groups_set.add(_ticket_group(fake_ticket, admin_users))
    groups = sorted(groups_set)

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    dwell_by_stage: dict[str, float] = {}
    for stage in LABOR_STACK_STAGES:
        bucket = merged["open_dwell_stack"].get(stage) or {"count": 0, "sum_created_ms": 0.0}
        cnt = int(bucket.get("count") or 0)
        if cnt <= 0:
            dwell_by_stage[stage] = 0.0
            continue
        avg_ms = now_ms - float(bucket.get("sum_created_ms") or 0) / cnt
        dwell_by_stage[stage] = round(max(0.0, avg_ms) / 3600000.0)

    by_group_stage_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_group_person_open: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for person, cnt in merged["by_person"].items():
        g = _ticket_group({"currentHandler": person, "creatorName": person}, admin_users)
        by_group_person[g][person] += int(cnt)
    for person, cnt in merged["by_person_open"].items():
        g = _ticket_group({"currentHandler": person, "creatorName": person}, admin_users)
        by_group_person_open[g][person] += int(cnt)
    for person, stages in merged.get("by_person_stage_open", {}).items():
        g = _ticket_group({"currentHandler": person, "creatorName": person}, admin_users)
        for st, v in stages.items():
            by_group_stage_open[g][st] += int(v)

    if product_line:
        pl = str(product_line).strip()
        by_person = {
            p: c
            for p, c in merged["by_person"].items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_open = {
            p: c
            for p, c in merged["by_person_open"].items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_stage = {
            p: v
            for p, v in merged["by_person_stage"].items()
            if _person_product_line(p, admin_users) == pl
        }
        by_person_flow = {
            p: v
            for p, v in merged["by_person_flow"].items()
            if _person_product_line(p, admin_users) == pl
        }
    else:
        by_person = merged["by_person"]
        by_person_open = merged["by_person_open"]
        by_person_stage = merged["by_person_stage"]
        by_person_flow = merged["by_person_flow"]

    return {
        "groups": groups,
        "stages": list(LABOR_STACK_STAGES),
        "pie_stages": list(LABOR_PIE_STAGES),
        "counts": {
            "by_person": by_person,
            "by_person_open": by_person_open,
            "by_stage_open": dict(merged["by_stage_open"]),
            "by_group_stage_open": {g: dict(v) for g, v in by_group_stage_open.items()},
            "by_stage_all": merged["by_stage_all"],
            "by_person_stage": {p: dict(v) for p, v in by_person_stage.items()},
            "by_person_flow": {p: dict(v) for p, v in by_person_flow.items()},
            "by_group_person": {g: dict(v) for g, v in by_group_person.items()},
            "by_group_person_open": {g: dict(v) for g, v in by_group_person_open.items()},
        },
        "dwell": {"by_stage_hours": dwell_by_stage},
    }


def build_doer_payload_from_daily_slices(
    daily_slices: list[dict[str, Any]],
    include_ops: bool,
    include_dev: bool,
) -> dict[str, Any]:
    empty_slices = [
        {"label": "问题定位/解决", "value": 0},
        {"label": "思路/辅助提效", "value": 0},
        {"label": "无帮助", "value": 0},
        {"label": "未使用Doer", "value": 0},
        {"label": "紧急疑难工单", "value": 0},
        {"label": "未填写", "value": 0},
    ]
    if not daily_slices:
        return {
            "total": 0,
            "doerResolved": 0,
            "doerHelped": 0,
            "doerNoHelp": 0,
            "noDoer": 0,
            "urgentHard": 0,
            "notFilled": 0,
            "unknown": 0,
            "usedDoer": 0,
            "effective": 0,
            "filledTotal": 0,
            "includeOps": include_ops,
            "includeDev": include_dev,
            "usageSlices": empty_slices,
            "effectivenessSlices": [
                {"label": "有效(定位/解决+辅助提效)", "value": 0},
                {"label": "无帮助", "value": 0},
            ],
            "consultEfficiency": _consult_efficiency_block([], consult=True),
            "nonConsultEfficiency": _consult_efficiency_block([], consult=False),
            "dailyClosed": {"labels": [], "values": [], "totalCount": 0, "avgDuration": 0},
            "dailyDoerUsage": {
                "labels": [],
                "barValues": [],
                "lineValues": [],
                "totalUsedDoer": 0,
                "totalTickets": 0,
                "avgPct": 0,
            },
            "dailyConsult": {"labels": [], "barValues": [], "lineValues": [], "totalConsult": 0, "totalTickets": 0, "avgPct": 0},
            "monthlyConsult": {"labels": [], "barValues": [], "lineValues": []},
            "dailyDoerEffectiveness": {"labels": [], "barValues": [], "lineValues": [], "avgRate": 0},
        }

    counts = defaultdict(int)
    by_created: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_consult_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_month: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_closed: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "sum_hours": 0.0})
    by_eff: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    consult_eff_merged: dict[str, Any] = defaultdict(float)
    non_consult_eff_merged: dict[str, Any] = defaultdict(float)
    total = 0

    for sl in daily_slices:
        doer = sl.get("doer") or {}
        if include_ops and include_dev:
            cat_src = doer.get("by_category") or {}
        elif include_ops:
            cat_src = doer.get("by_ops_category") or {}
        else:
            cat_src = doer.get("by_dev_category") or {}
        for cat, cnt in cat_src.items():
            counts[str(cat)] += int(cnt)
            total += int(cnt)
        for day, bucket in (doer.get("by_created_day") or {}).items():
            for k, v in bucket.items():
                by_created[str(day)][str(k)] += int(v) if isinstance(v, int) else 0
        for day, bucket in (doer.get("by_closed_day") or {}).items():
            by_closed[str(day)]["count"] += int(bucket.get("count") or 0)
            by_closed[str(day)]["sum_hours"] += float(bucket.get("sum_hours") or 0)
        for ym, bucket in (doer.get("by_created_month") or {}).items():
            for k, v in bucket.items():
                by_month[str(ym)][str(k)] += int(v)
        for k, v in (doer.get("consult_eff") or {}).items():
            if isinstance(v, (int, float)):
                consult_eff_merged[k] += v
        for k, v in (doer.get("non_consult_eff") or {}).items():
            if isinstance(v, (int, float)):
                non_consult_eff_merged[k] += v
        for day, bucket in (doer.get("by_created_day") or {}).items():
            by_consult_day[str(day)]["total"] += int(bucket.get("total") or 0)
            by_consult_day[str(day)]["consult"] += int(bucket.get("consult") or 0)
            if int(bucket.get("used_for_eff") or 0):
                by_eff[str(day)]["used"] += int(bucket.get("used_for_eff") or 0)
                by_eff[str(day)]["effective"] += int(bucket.get("effective") or 0)

    doer_resolved = counts["doer_resolved"]
    doer_helped = counts["doer_helped"]
    doer_no_help = counts["doer_no_help"]
    no_doer = counts["no_doer"]
    urgent_hard = counts["urgent_hard"]
    not_filled = counts["not_filled"]
    unknown = counts["unknown"]
    used_doer = doer_resolved + doer_helped + doer_no_help
    effective = doer_resolved + doer_helped

    sorted_closed = sorted(by_closed.keys())
    daily_closed_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_closed]
    daily_closed_values = [
        round(by_closed[d]["sum_hours"] / by_closed[d]["count"], 1) if by_closed[d]["count"] else 0
        for d in sorted_closed
    ]
    closed_count = sum(int(by_closed[d]["count"]) for d in sorted_closed)
    total_dur = sum(by_closed[d]["sum_hours"] for d in sorted_closed)
    avg_dur = round(total_dur / closed_count, 1) if closed_count else 0

    sorted_created = sorted(by_created.keys())
    daily_doer_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_created]
    daily_doer_bars = [int(by_created[d].get("used_doer", 0)) for d in sorted_created]
    daily_doer_lines = [
        round(by_created[d]["used_doer"] / by_created[d]["total"] * 100) if by_created[d].get("total") else 0
        for d in sorted_created
    ]
    tot_used = sum(daily_doer_bars)
    tot_tix = sum(int(by_created[d].get("total", 0)) for d in sorted_created)

    sorted_consult = sorted(by_consult_day.keys())
    daily_consult_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_consult]
    daily_consult_bars = [int(by_consult_day[d].get("consult", 0)) for d in sorted_consult]
    daily_consult_lines = [
        round(by_consult_day[d]["consult"] / by_consult_day[d]["total"] * 100)
        if by_consult_day[d].get("total")
        else 0
        for d in sorted_consult
    ]
    tot_consult = sum(daily_consult_bars)
    tot_consult_tix = sum(int(by_consult_day[d].get("total", 0)) for d in sorted_consult)

    sorted_months = sorted(by_month.keys())
    monthly_bars = [int(by_month[m].get("consult", 0)) for m in sorted_months]
    monthly_lines = [
        round(by_month[m]["consult"] / by_month[m]["total"] * 100) if by_month[m].get("total") else 0
        for m in sorted_months
    ]

    sorted_eff = sorted(by_eff.keys())
    eff_labels = [f"{int(d[5:7])}/{int(d[8:10])}" for d in sorted_eff]
    eff_bars = [int(by_eff[d].get("effective", 0)) for d in sorted_eff]
    eff_lines = [
        round(by_eff[d]["effective"] / by_eff[d]["used"] * 100) if by_eff[d].get("used") else 0 for d in sorted_eff
    ]
    avg_rate = round(sum(eff_bars) / tot_used * 100) if tot_used else 0

    def _eff_block_from_merged(merged: dict[str, Any], *, consult: bool) -> dict[str, Any]:
        stages = [DOER_STAGE_NAMES[k] for k in DOER_STAGE_KEYS]
        total_key = "consult_total" if consult else "non_consult_total"
        filtered_total = int(merged.get(total_key) or 0)
        avg_used = []
        avg_no = []
        for nk in DOER_STAGE_KEYS:
            used_h = float(merged.get(f"hours_used_{nk}") or 0)
            used_c = int(merged.get(f"count_used_{nk}") or 0)
            no_h = float(merged.get(f"hours_no_{nk}") or 0)
            no_c = int(merged.get(f"count_no_{nk}") or 0)
            avg_used.append(round(used_h / used_c, 2) if used_c else 0.0)
            avg_no.append(round(no_h / no_c, 2) if no_c else 0.0)
        gains = [
            round(((avg_no[i] - avg_used[i]) / avg_no[i]) * 100) if avg_no[i] else 0 for i in range(len(stages))
        ]
        valid_gains = [g for g in gains if g > 0]
        avg_gain = round(sum(valid_gains) / len(valid_gains)) if valid_gains else 0
        max_gain = max(gains) if gains else 0
        max_stage = stages[gains.index(max_gain)] if max_gain else ""
        used_count = sum(int(merged.get(f"count_used_{nk}") or 0) for nk in DOER_STAGE_KEYS)
        no_count = sum(int(merged.get(f"count_no_{nk}") or 0) for nk in DOER_STAGE_KEYS)
        return {
            "stages": stages,
            "stageKeys": list(DOER_STAGE_KEYS),
            "avgHoursUsedDoer": avg_used,
            "avgHoursNoDoer": avg_no,
            "efficiencyGains": gains,
            "avgEfficiencyGain": avg_gain,
            "maxGainStage": max_stage,
            "maxGainValue": max_gain,
            "usedDoerCount": used_count,
            "noDoerCount": no_count,
            "totalConsultCount": filtered_total if consult else 0,
            "totalNonConsultCount": filtered_total if not consult else 0,
        }

    return {
        "total": total,
        "doerResolved": doer_resolved,
        "doerHelped": doer_helped,
        "doerNoHelp": doer_no_help,
        "noDoer": no_doer,
        "urgentHard": urgent_hard,
        "notFilled": not_filled,
        "unknown": unknown,
        "usedDoer": used_doer,
        "effective": effective,
        "filledTotal": used_doer + no_doer + urgent_hard,
        "includeOps": include_ops,
        "includeDev": include_dev,
        "usageSlices": [
            {"label": "问题定位/解决", "value": doer_resolved},
            {"label": "思路/辅助提效", "value": doer_helped},
            {"label": "无帮助", "value": doer_no_help},
            {"label": "未使用Doer", "value": no_doer},
            {"label": "紧急疑难工单", "value": urgent_hard},
            {"label": "未填写", "value": not_filled},
        ],
        "effectivenessSlices": [
            {"label": "有效(定位/解决+辅助提效)", "value": effective},
            {"label": "无帮助", "value": doer_no_help},
        ],
        "consultEfficiency": _eff_block_from_merged(dict(consult_eff_merged), consult=True),
        "nonConsultEfficiency": _eff_block_from_merged(dict(non_consult_eff_merged), consult=False),
        "dailyClosed": {
            "labels": daily_closed_labels,
            "values": daily_closed_values,
            "totalCount": closed_count,
            "avgDuration": avg_dur,
        },
        "dailyDoerUsage": {
            "labels": daily_doer_labels,
            "barValues": daily_doer_bars,
            "lineValues": daily_doer_lines,
            "totalUsedDoer": tot_used,
            "totalTickets": tot_tix,
            "avgPct": round(tot_used / tot_tix * 100) if tot_tix else 0,
        },
        "dailyConsult": {
            "labels": daily_consult_labels,
            "barValues": daily_consult_bars,
            "lineValues": daily_consult_lines,
            "totalConsult": tot_consult,
            "totalTickets": tot_consult_tix,
            "avgPct": round(tot_consult / tot_consult_tix * 100) if tot_consult_tix else 0,
        },
        "monthlyConsult": {
            "labels": sorted_months,
            "barValues": monthly_bars,
            "lineValues": monthly_lines,
            "totalConsult": sum(monthly_bars),
            "totalTickets": sum(int(by_month[m].get("total", 0)) for m in sorted_months),
            "avgPct": round(sum(monthly_bars) / sum(int(by_month[m].get("total", 0)) for m in sorted_months) * 100)
            if sorted_months and sum(int(by_month[m].get("total", 0)) for m in sorted_months)
            else 0,
        },
        "dailyDoerEffectiveness": {
            "labels": eff_labels,
            "barValues": eff_bars,
            "lineValues": eff_lines,
            "totalUsedDoer": tot_used,
            "totalEffective": sum(eff_bars),
            "avgRate": avg_rate,
            "avgPct": avg_rate,
        },
    }


def get_stats_charts(
    operator_id: str,
    view: str,
    start_date: str,
    end_date: str,
    *,
    product_line: str = "",
    precision: str = "month",
    quality: str = "all",
    component: str = "all",
    include_ops: bool = True,
    include_dev: bool = True,
) -> dict[str, Any]:
    from routers.tickets import _get_whitelist_flags

    op = str(operator_id or "").strip() or "demo_001"
    sd = parse_ymd(start_date, "start_date")
    ed = parse_ymd(end_date, "end_date")
    if sd > ed:
        sd, ed = ed, sd
    view = str(view or "").strip().lower()
    if view not in ("labor", "ownership", "doer"):
        raise ValueError("view 须为 labor、ownership 或 doer")
    if precision not in ("day", "month", "year"):
        raise ValueError("precision 须为 day、month 或 year")

    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, op)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        admin_users = _load_admin_users(conn)

        from ticket_stats_daily import fetch_merged_daily_metrics, stats_daily_enabled

        daily = None
        use_daily = False
        if stats_daily_enabled():
            daily = fetch_merged_daily_metrics(conn, sd, ed, only_self=only_self, operator_id=op)
            if daily is not None and daily.get("daily_slices") is not None:
                if daily["daily_slices"]:
                    use_daily = True
                else:
                    has_rollup = conn.execute(
                        "SELECT 1 FROM ticket_stats_daily WHERE template_code = %s LIMIT 1",
                        (SCHEMA_TEMPLATE_CODE,),
                    ).fetchone()
                    use_daily = bool(has_rollup)

        if use_daily and daily is not None:
            slices = daily["daily_slices"]
            ticket_count = int(daily.get("ticket_count") or 0)
            if view == "labor":
                payload = build_labor_payload_from_daily_slices(
                    slices, admin_users, str(product_line or "").strip()
                )
            elif view == "ownership":
                payload = build_ownership_payload_from_daily_slices(
                    slices, sd, ed, precision, str(quality or "all"), str(component or "all")
                )
            else:
                payload = build_doer_payload_from_daily_slices(slices, include_ops, include_dev)
        else:
            rows = fetch_stats_tickets(conn, op, sd, ed, only_self=only_self)
            ticket_count = len(rows)
            if view == "labor":
                payload = build_labor_payload(rows, admin_users, str(product_line or "").strip())
            elif view == "ownership":
                payload = build_ownership_payload(rows, sd, ed, precision, str(quality or "all"), str(component or "all"))
            else:
                payload = build_doer_payload(conn, rows, include_ops, include_dev)

    return {
        "view": view,
        "range": {"start_date": sd.isoformat(), "end_date": ed.isoformat()},
        "ticket_count": ticket_count,
        "payload": payload,
    }
