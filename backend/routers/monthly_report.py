"""现网重大问题月度分析报告路由：

- GET    /api/monthly-report/{ym}           获取或初始化指定月份草稿（不存在自动创建空骨架）
- PUT    /api/monthly-report/{ym}/sections  分段保存（覆盖式）
- POST   /api/monthly-report/{ym}/archive   归档（status=archived，archived_at=now）
- DELETE /api/monthly-report/{ym}/archive   取消归档（回到 draft）
- GET    /api/monthly-report                列表（按 status 过滤，archived 默认按月降序）

报告内容五段以 JSONB 存储，section key 与前端约定一致：
  overview / insight / major / improve / links
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Query

from config import SCHEMA_TEMPLATE_CODE
from database import db_conn
from models import MonthlyReportSectionPutPayload, MonthlyReportArchivePayload

_SCHEMA_HINT = "请在数据库执行 db/migrations/0036_monthly_report.sql"
_MONTH_RE = re.compile(r"^[0-9]{6}$")
_SECTION_COLS = {
    "overview": "section_overview",
    "insight": "section_insight",
    "major": "section_major",
    "improve": "section_improve",
    "links": "section_links",
}

# ---------- 导入（从本月工单聚合）相关口径 ----------
# 内核质量问题 = 问题组件为「内核问题」且「是否质量问题」命中下列取值之一。
_KERNEL_COMPONENT = "内核问题"
_QUALITY_KNOWN = "是（已知质量问题）"
_QUALITY_NEW = "是（新发现质量问题）"
_QUALITY_VALUES = (_QUALITY_KNOWN, _QUALITY_NEW)
# 问题透视「影响分类」只统计这 6 种问题类型（按 dts 去重）。
_IMPACT_ISSUE_TYPES = ("coredump", "数据不一致", "慢", "满", "hang", "集群状态异常")
# 重大问题 5 类分组：issue_type → 分组键；未命中类型回落「升级」(看是否涉及内核升级)。
_MAJOR_TYPE_BY_ISSUE = {
    "coredump": "coredump",
    "数据不一致": "consistency",
    "满": "full",
    "hang": "hang_slow",
    "慢": "hang_slow",
}
_MAJOR_GROUP_KEYS = ("coredump", "consistency", "full", "hang_slow", "escalation")
# 计算单张工单有效值时需要读取的字段（按流程最后出现节点取值）。
_IMPORT_FIELD_KEYS = (
    "component", "is_quality_issue", "issue_type", "issue_intro_module",
    "dts_no", "root_cause_category", "event_level", "location",
    "gauss_version", "issue_desc", "root_cause", "kernel_upgrade_involved",
)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

router = APIRouter(prefix="/api/monthly-report", tags=["monthly-report"])


def _coerce_str(v: Any) -> str:
    """节点值统一成字符串：列表取首个非空元素，其余 str() 后去空白。"""
    if isinstance(v, list):
        for item in v:
            s = str(item).strip() if item is not None else ""
            if s:
                return s
        return ""
    return str(v).strip() if v is not None else ""


def _plain_text(v: Any) -> str:
    """富文本（HTML）转纯文本，供表格单元格展示。"""
    s = _coerce_str(v)
    if not s:
        return ""
    s = _TAG_RE.sub(" ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
          .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"'))
    return _WS_RE.sub(" ", s).strip()


def _path_parts(v: Any) -> list[str]:
    from utils.module_cascade_path import normalize_module_cascade_path

    s = normalize_module_cascade_path(_coerce_str(v))
    return [p.strip() for p in s.split("/") if p.strip()] if s else []


def _first_level(v: Any) -> str:
    parts = _path_parts(v)
    return parts[0] if parts else ""


def _second_level(v: Any) -> str:
    parts = _path_parts(v)
    return parts[1] if len(parts) > 1 else ""


def _level2_plus(v: Any) -> str:
    parts = _path_parts(v)
    return "/".join(parts[1:]) if len(parts) > 1 else ""


def _effective_fields_by_ticket(conn: psycopg.Connection, ym: str) -> dict[int, dict[str, str]]:
    """读取本月（按 created_at 的 Asia/Shanghai 自然月）HCS 工单各字段的有效值。

    有效值口径与「字段继承-最后出现节点」一致：同一 field_key 在多个节点出现时，
    按 ticket_node_data.created_at 升序遍历，取最后一个非空值。
    """
    rows = conn.execute(
        """
        SELECT t.id AS ticket_id, t.ticket_no, d.values_json
          FROM ticket t
          JOIN workflow_template wt ON wt.id = t.template_id
          JOIN ticket_node_data d ON d.ticket_id = t.id
         WHERE wt.template_code = %s
           AND to_char(t.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMM') = %s
         ORDER BY t.id, d.created_at, d.id
        """,
        (SCHEMA_TEMPLATE_CODE, ym),
    ).fetchall()
    out: dict[int, dict[str, str]] = {}
    for r in rows:
        tid = int(r["ticket_id"])
        slot = out.setdefault(tid, {"ticket_no": _coerce_str(r["ticket_no"])})
        vj = r["values_json"] or {}
        if not isinstance(vj, dict):
            continue
        for k in _IMPORT_FIELD_KEYS:
            val = _coerce_str(vj.get(k))
            if not val:
                continue
            if k == "is_quality_issue":
                # 「是否质量问题」的质量结论具有粘性：一旦在分析阶段判定为质量问题，
                # 后续回退/重提把它改回「否」不应翻案（否则会漏计这类内核质量问题）。
                # 仍允许在两种质量取值（已知↔新发现）之间更新为最后一次质量判定。
                prev = slot.get(k)
                if prev in _QUALITY_VALUES and val not in _QUALITY_VALUES:
                    continue
            slot[k] = val  # 升序遍历 → 覆盖为最后一个非空值
    return out


def _is_kernel_quality(f: dict[str, str]) -> bool:
    return f.get("component", "") == _KERNEL_COMPONENT and f.get("is_quality_issue", "") in _QUALITY_VALUES


def _dedup_key(f: dict[str, str], tid: int) -> str:
    """去重键：优先 DTS 单号；为空时回落工单自身（保证每单至少计一次）。"""
    return f.get("dts_no", "") or f"__t{tid}"


def _count_distinct_by(buckets: dict[str, set[str]]) -> list[dict[str, Any]]:
    return [{"name": name, "value": len(keys)} for name, keys in buckets.items()]


def _compute_insight(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    fields = _effective_fields_by_ticket(conn, ym)
    base = {tid: f for tid, f in fields.items() if _is_kernel_quality(f)}

    total = len(base)
    known = sum(1 for f in base.values() if f.get("is_quality_issue") == _QUALITY_KNOWN)
    new = sum(1 for f in base.values() if f.get("is_quality_issue") == _QUALITY_NEW)

    # 影响分类：固定 6 种问题类型，按 dts 去重计数
    impact_buckets: dict[str, set[str]] = {t: set() for t in _IMPACT_ISSUE_TYPES}
    # Top 模块：引入模块第二层子模块，按 dts 去重
    module_buckets: dict[str, set[str]] = {}
    # Top1=coredump 根因分类、Top2=满 根因分类，按 dts 去重
    coredump_root: dict[str, set[str]] = {}
    full_root: dict[str, set[str]] = {}

    for tid, f in base.items():
        key = _dedup_key(f, tid)
        itype = f.get("issue_type", "")
        if itype in impact_buckets:
            impact_buckets[itype].add(key)
        sub = _second_level(f.get("issue_intro_module", ""))
        if sub:
            module_buckets.setdefault(sub, set()).add(key)
        rcc = f.get("root_cause_category", "")
        if itype == "coredump" and rcc:
            coredump_root.setdefault(rcc, set()).add(key)
        if itype == "满" and rcc:
            full_root.setdefault(rcc, set()).add(key)

    impact_categories = [{"name": t, "value": len(impact_buckets[t])} for t in _IMPACT_ISSUE_TYPES]
    top_modules = sorted(_count_distinct_by(module_buckets), key=lambda d: d["value"], reverse=True)[:10]
    top1_breakdown = sorted(_count_distinct_by(coredump_root), key=lambda d: d["value"], reverse=True)
    top2_breakdown = sorted(_count_distinct_by(full_root), key=lambda d: d["value"], reverse=True)

    return {
        # 磐石版本暂不计算，置 0（前端导入时保留既有手填值）
        "kpi": {"total_count": total, "known_count": known, "new_count": new,
                "pansh_count": 0, "pansh_total": 0},
        "impact_categories": impact_categories,
        "top_modules": top_modules,
        "top1_breakdown": top1_breakdown,
        "top2_breakdown": top2_breakdown,
    }


def _compute_major(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    fields = _effective_fields_by_ticket(conn, ym)
    types: dict[str, list[dict[str, str]]] = {k: [] for k in _MAJOR_GROUP_KEYS}

    for tid, f in fields.items():
        if not _is_kernel_quality(f):
            continue
        # 「重大问题类型」指下面 5 个分类本身（按 issue_type 的问题性质归类），
        # 与工单「事件级别」无关——不再按事件级别过滤，否则会漏掉大量内核质量问题。
        itype = f.get("issue_type", "")
        group = _MAJOR_TYPE_BY_ISSUE.get(itype)
        if group is None:
            group = "escalation" if f.get("kernel_upgrade_involved", "") == "是" else None
        if group is None:
            continue
        types[group].append({
            "局点": f.get("location", ""),
            "版本": f.get("gauss_version", ""),
            "问题编号": f.get("dts_no", ""),
            "问题描述": _plain_text(f.get("issue_desc", "")),
            "根因/进展": _plain_text(f.get("root_cause", "")),
            "问题影响": f.get("event_level", ""),
            "问题领域": _first_level(f.get("issue_intro_module", "")),
            "模块/特性": _level2_plus(f.get("issue_intro_module", "")),
            "责任XM": "",
        })
    return {"types": types}


def _kv_sorted(counts: dict[str, int]) -> list[dict[str, Any]]:
    return sorted(
        [{"name": k, "value": v} for k, v in counts.items()],
        key=lambda d: d["value"], reverse=True,
    )


def _compute_improve(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    """从「质量改进」(requirement) 聚合改进诉求段。

    - 领域占比 / SQL 领域改进 / 存储领域改进：取**全部**质量改进数据（不限月份）——
      领域占比按 `domain` 分组计数；SQL/存储 分别取 domain 含「SQL」/「存储」的项，
      按 `module_feature`（模块&特性）分组计数
    - 本月新增改进诉求表（new_requests）：仅取 proposed_at（提出时间）落在所选月份的项，
      映射 编号/问题描述/改进目标/负责领域/责任人
    """
    # 图表：全量
    domain_counts: dict[str, int] = {}
    sql_counts: dict[str, int] = {}
    storage_counts: dict[str, int] = {}
    for r in conn.execute("SELECT domain, module_feature FROM requirement").fetchall():
        domain = _coerce_str(r["domain"])
        mf = _coerce_str(r["module_feature"])
        if domain:
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
        if mf:
            if "sql" in domain.lower():
                sql_counts[mf] = sql_counts.get(mf, 0) + 1
            elif "存储" in domain:
                storage_counts[mf] = storage_counts.get(mf, 0) + 1

    # 本月新增改进诉求表：仅本月
    month_rows = conn.execute(
        """
        SELECT requirement_no, description, improvement, domain, proposer
          FROM requirement
         WHERE to_char(proposed_at, 'YYYYMM') = %s
         ORDER BY id
        """,
        (ym,),
    ).fetchall()
    new_requests = [{
        "编号": _coerce_str(r["requirement_no"]),
        "问题描述": _coerce_str(r["description"]),
        "改进目标": _coerce_str(r["improvement"]),
        "负责领域": _coerce_str(r["domain"]),
        "责任人": _coerce_str(r["proposer"]),
    } for r in month_rows]

    return {
        "module_distribution": _kv_sorted(domain_counts),
        "sql_items": _kv_sorted(sql_counts),
        "storage_items": _kv_sorted(storage_counts),
        "new_requests": new_requests,
    }


def _validate_month(ym: str) -> str:
    s = (ym or "").strip()
    if not _MONTH_RE.match(s):
        raise HTTPException(status_code=400, detail="report_month 格式应为 YYYYMM (如 202604)")
    year = int(s[:4])
    month = int(s[4:])
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="report_month 月份取值非法")
    if year < 2000 or year > 2999:
        raise HTTPException(status_code=400, detail="report_month 年份取值非法")
    return s


def _row_to_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.astimezone(timezone.utc).isoformat()
        else:
            out[key] = value
    return out


def _ensure_report(conn: psycopg.Connection, ym: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM monthly_report WHERE report_month = %s",
        (ym,),
    ).fetchone()
    if row is not None:
        return _row_to_dict(row)  # type: ignore[return-value]
    conn.execute(
        """
        INSERT INTO monthly_report (report_month, title, status)
        VALUES (%s, %s, 'draft')
        ON CONFLICT (report_month) DO NOTHING
        """,
        (ym, f"{ym}月报"),
    )
    row = conn.execute(
        "SELECT * FROM monthly_report WHERE report_month = %s",
        (ym,),
    ).fetchone()
    return _row_to_dict(row)  # type: ignore[return-value]


def _wrap_schema_error(exc: psycopg.Error) -> HTTPException:
    return HTTPException(status_code=500, detail=f"月度报告表未就绪：{exc.__class__.__name__}. {_SCHEMA_HINT}")


@router.get("/{ym}")
def get_or_init_report(ym: str) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            data = _ensure_report(conn, ym)
            conn.commit()
            return data
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.get("/{ym}/import/{section}")
def import_section_from_tickets(ym: str, section: str) -> dict[str, Any]:
    """从本月工单聚合计算指定段数据（只读，不落库）。

    - insight：问题透视 KPI + 4 个图表数据（内核质量问题口径，按 dts 去重）
    - major：重大问题 5 类分组表格（内核质量问题 ∩ 重大事件级别）
    - improve：改进诉求（来自「质量改进」本月数据：领域占比/SQL·存储领域改进/本月新增表）
    返回结构与前端段数据一致，前端填入草稿、用户核对后再保存。
    """
    ym = _validate_month(ym)
    section = (section or "").strip()
    try:
        with db_conn() as conn:
            if section == "insight":
                return _compute_insight(conn, ym)
            if section == "major":
                return _compute_major(conn, ym)
            if section == "improve":
                return _compute_improve(conn, ym)
            raise HTTPException(status_code=400, detail=f"该段不支持导入：{section}")
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.put("/{ym}/sections")
def update_section(ym: str, payload: MonthlyReportSectionPutPayload) -> dict[str, Any]:
    ym = _validate_month(ym)
    section = (payload.section or "").strip()
    col = _SECTION_COLS.get(section)
    if not col:
        raise HTTPException(status_code=400, detail=f"未知 section：{section}")
    try:
        with db_conn() as conn:
            _ensure_report(conn, ym)
            row = conn.execute(
                "SELECT status FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            if row and row.get("status") == "archived":
                raise HTTPException(status_code=409, detail="报告已归档，无法编辑；请先取消归档")
            data_json = json.dumps(payload.data or {}, ensure_ascii=False)
            conn.execute(
                f"UPDATE monthly_report SET {col} = %s::jsonb WHERE report_month = %s",
                (data_json, ym),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            return _row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.post("/{ym}/archive")
def archive_report(ym: str, payload: MonthlyReportArchivePayload) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            _ensure_report(conn, ym)
            title = (payload.title or "").strip() or f"{ym}月报"
            conn.execute(
                """
                UPDATE monthly_report
                   SET status = 'archived', archived_at = NOW(), title = %s
                 WHERE report_month = %s
                """,
                (title, ym),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            return _row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.delete("/{ym}/archive")
def unarchive_report(ym: str) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT id FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="报告不存在")
            conn.execute(
                "UPDATE monthly_report SET status='draft', archived_at=NULL WHERE report_month=%s",
                (ym,),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM monthly_report WHERE report_month = %s",
                (ym,),
            ).fetchone()
            return _row_to_dict(row)  # type: ignore[return-value]
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.get("")
def list_reports(status: str = Query("", description="draft / archived / 空=全部")) -> dict[str, Any]:
    status = (status or "").strip()
    if status and status not in ("draft", "archived"):
        raise HTTPException(status_code=400, detail="status 只能是 draft 或 archived")
    try:
        with db_conn() as conn:
            sql = """
                SELECT report_month, title, status, archived_at, created_at, updated_at
                  FROM monthly_report
            """
            args: list[Any] = []
            if status:
                sql += " WHERE status = %s"
                args.append(status)
            sql += " ORDER BY report_month DESC"
            rows = conn.execute(sql, tuple(args)).fetchall()
            return {"items": [_row_to_dict(r) for r in rows]}
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)


@router.delete("/{ym}")
def delete_report(ym: str) -> dict[str, Any]:
    ym = _validate_month(ym)
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT status FROM monthly_report WHERE report_month=%s",
                (ym,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="报告不存在")
            if row.get("status") == "archived":
                raise HTTPException(status_code=409, detail="已归档报告不可删除，请先取消归档")
            conn.execute("DELETE FROM monthly_report WHERE report_month=%s", (ym,))
            conn.commit()
            return {"deleted": ym}
    except psycopg.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
        raise _wrap_schema_error(exc)
