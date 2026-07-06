"""重大问题（工单驱动）路由。

设计要点：
- 工作台的工单，当「事件级别」达到重大阈值时自动流转到本页面（惰性同步）。
- 列表接口每次拉取前先扫描符合阈值的工单并 upsert 到 major_issue：
  快照字段（局点/级别/描述/运维分析人/开发分析人/通报日期）刷新，进展记录不受同步影响；
  整体状态默认不动，但工单流转至「审核关闭(audit_close)」节点时自动置为「关闭」（后端真值优先）。
- 进展跟踪：每日可追加一条进展记录（带时间、进展内容、风险消减措施）。
- 权限：查看复用 major_problem_list，写操作（改状态/加进展）复用 major_problem_create。
"""
from __future__ import annotations

import logging
import time
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException

from config import MAJOR_ISSUE_SYNC_INTERVAL_SECONDS
from database import db_conn

logger = logging.getLogger(__name__)

_MAJOR_ISSUE_SCHEMA_HINT = "请在数据库执行 db/migrations/0073_major_issue.sql"

# 触发自动流转的事件级别集合（option set OS_EVENT_LEVEL）
QUALIFYING_EVENT_LEVELS: tuple[str, ...] = (
    "内部通报重大问题",
    "管理升级预警",
    "已管理升级",
    "事故",
    "P1-P3事件",
)

MAJOR_ISSUE_STATUSES = ("进行中", "挂起", "关闭")

_OPS_ANALYSIS_NODE_KEY = "ops_analysis"
_DEV_ANALYSIS_NODE_KEY = "dev_analysis"
_PROBLEM_FILL_NODE_KEY = "problem_fill"
_AUDIT_CLOSE_NODE_KEY = "audit_close"

_last_full_sync_monotonic: float = 0.0

router = APIRouter(prefix="/api/major-issues", tags=["major-issues"])


def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute("SELECT user_name FROM user_account WHERE account = %s", (acc,)).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _can_write(conn: psycopg.Connection, account: str) -> bool:
    """写操作权限：复用工作台白名单 major_problem_create（与查看的 major_problem_list 同体系）。

    与前端 whitelistAllows 口径一致：非 hidden 即允许。
    """
    from whitelist_policy import whitelist_delete_allowed

    if not str(account or "").strip():
        return False
    return whitelist_delete_allowed(conn, account, "major_problem_create")


def _str(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _sync_audit_close_status(conn: psycopg.Connection) -> None:
    """工单已流转至「审核关闭」节点：对应重大问题自动置为「关闭」（后端真值优先）。"""
    conn.execute(
        """
        UPDATE major_issue m
        SET status = %s, updated_at = NOW()
        WHERE m.status <> %s
          AND EXISTS (
              SELECT 1 FROM ticket t
              JOIN ticket_flow_log fl ON fl.ticket_id = t.id
              JOIN workflow_node wn ON wn.id = fl.to_node_id
              WHERE t.ticket_no = m.ticket_no
                AND wn.node_key = %s
          )
        """,
        ("关闭", "关闭", _AUDIT_CLOSE_NODE_KEY),
    )


def _sync_major_issues_bulk(conn: psycopg.Connection) -> int:
    """SQL 批量 upsert 符合阈值的工单快照，避免 Python 侧全量加载 ticket_node_data。"""
    row = conn.execute(
        """
        WITH ops_last AS (
            SELECT DISTINCT ON (fl.ticket_id)
                fl.ticket_id, fl.operator_name, fl.created_at
            FROM ticket_flow_log fl
            JOIN workflow_node wn ON wn.id = fl.from_node_id
            WHERE wn.node_key = %s
              AND fl.action_type IN ('submit', 'jump_submit')
            ORDER BY fl.ticket_id, fl.created_at DESC, fl.id DESC
        ),
        dev_last AS (
            SELECT DISTINCT ON (fl.ticket_id)
                fl.ticket_id, fl.operator_name AS dev_analyst
            FROM ticket_flow_log fl
            JOIN workflow_node wn ON wn.id = fl.from_node_id
            WHERE wn.node_key = %s
              AND fl.action_type IN ('submit', 'jump_submit')
            ORDER BY fl.ticket_id, fl.created_at DESC, fl.id DESC
        ),
        field_data AS (
            SELECT
                t.id AS ticket_id,
                d.created_at,
                d.id AS data_id,
                NULLIF(BTRIM(d.values_json->>'event_level'), '') AS event_level,
                NULLIF(BTRIM(d.values_json->>'location'), '') AS location,
                NULLIF(BTRIM(d.values_json->>'issue_desc'), '') AS issue_desc
            FROM ops_last o
            JOIN ticket t ON t.id = o.ticket_id
            JOIN ticket_node_instance ni ON ni.ticket_id = t.id
            JOIN ticket_node_data d ON d.ticket_node_instance_id = ni.id
            JOIN workflow_node wn ON wn.id = ni.node_id
            WHERE wn.node_key IN (%s, %s)
        ),
        last_event AS (
            SELECT DISTINCT ON (ticket_id) ticket_id, event_level
            FROM field_data
            WHERE event_level IS NOT NULL
            ORDER BY ticket_id, created_at DESC, data_id DESC
        ),
        last_location AS (
            SELECT DISTINCT ON (ticket_id) ticket_id, location
            FROM field_data
            WHERE location IS NOT NULL
            ORDER BY ticket_id, created_at DESC, data_id DESC
        ),
        last_desc AS (
            SELECT DISTINCT ON (ticket_id) ticket_id, issue_desc
            FROM field_data
            WHERE issue_desc IS NOT NULL
            ORDER BY ticket_id, created_at DESC, data_id DESC
        ),
        candidates AS (
            SELECT
                t.ticket_no,
                (o.created_at AT TIME ZONE 'UTC')::date AS report_date,
                COALESCE(ll.location, '') AS site_name,
                le.event_level,
                COALESCE(ld.issue_desc, '') AS description,
                COALESCE(o.operator_name, '') AS ops_analyst,
                COALESCE(d.dev_analyst, '') AS dev_analyst
            FROM ops_last o
            JOIN ticket t ON t.id = o.ticket_id
            JOIN last_event le ON le.ticket_id = o.ticket_id
            LEFT JOIN last_location ll ON ll.ticket_id = o.ticket_id
            LEFT JOIN last_desc ld ON ld.ticket_id = o.ticket_id
            LEFT JOIN dev_last d ON d.ticket_id = o.ticket_id
            WHERE le.event_level = ANY(%s)
        ),
        upserted AS (
            INSERT INTO major_issue (
                ticket_no, report_date, site_name, event_level,
                description, ops_analyst, dev_analyst
            )
            SELECT
                ticket_no, report_date, site_name, event_level,
                description, ops_analyst, dev_analyst
            FROM candidates
            ON CONFLICT (ticket_no) DO UPDATE SET
                report_date = EXCLUDED.report_date,
                site_name   = EXCLUDED.site_name,
                event_level = EXCLUDED.event_level,
                description = EXCLUDED.description,
                ops_analyst = EXCLUDED.ops_analyst,
                dev_analyst = EXCLUDED.dev_analyst,
                updated_at  = NOW()
            RETURNING 1
        )
        SELECT COUNT(*) AS cnt FROM upserted
        """,
        (
            _OPS_ANALYSIS_NODE_KEY,
            _DEV_ANALYSIS_NODE_KEY,
            _OPS_ANALYSIS_NODE_KEY,
            _PROBLEM_FILL_NODE_KEY,
            list(QUALIFYING_EVENT_LEVELS),
        ),
    ).fetchone()
    return int((row or {}).get("cnt") or 0)


def _maybe_sync_major_issues(conn: psycopg.Connection, *, force: bool = False) -> int:
    """惰性同步：默认按 MAJOR_ISSUE_SYNC_INTERVAL_SECONDS 节流，避免列表每次请求全库扫描。"""
    global _last_full_sync_monotonic

    _sync_audit_close_status(conn)

    interval = MAJOR_ISSUE_SYNC_INTERVAL_SECONDS
    now = time.monotonic()
    if not force and interval > 0 and (now - _last_full_sync_monotonic) < interval:
        conn.commit()
        return 0

    t0 = time.perf_counter()
    count = _sync_major_issues_bulk(conn)
    conn.commit()
    _last_full_sync_monotonic = now
    logger.info(
        "major_issue sync done upserted=%s elapsed_ms=%.0f interval_s=%s forced=%s",
        count,
        (time.perf_counter() - t0) * 1000,
        interval,
        force,
    )
    return count


def _sync_major_issues(conn: psycopg.Connection) -> int:
    """兼容旧调用：强制全量同步。"""
    return _maybe_sync_major_issues(conn, force=True)


def _serialize_issue(row: dict) -> dict[str, Any]:
    return {
        "id": int(row.get("id") or 0),
        "ticket_no": _str(row.get("ticket_no")),
        "report_date": row["report_date"].isoformat() if row.get("report_date") else "",
        "site_name": _str(row.get("site_name")),
        "event_level": _str(row.get("event_level")),
        "description": _str(row.get("description")),
        "ops_analyst": _str(row.get("ops_analyst")),
        "dev_analyst": _str(row.get("dev_analyst")),
        "status": _str(row.get("status")),
        "progress_count": int(row.get("progress_count") or 0),
        "latest_progress_at": row["latest_progress_at"].isoformat() if row.get("latest_progress_at") else "",
        "latest_progress_content": _str(row.get("latest_progress_content")),
        "latest_progress_risk": _str(row.get("latest_progress_risk")),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else "",
    }


def _serialize_progress(row: dict) -> dict[str, Any]:
    return {
        "id": int(row.get("id") or 0),
        "major_issue_id": int(row.get("major_issue_id") or 0),
        "progress_at": row["progress_at"].isoformat() if row.get("progress_at") else "",
        "content": _str(row.get("content")),
        "risk_measure": _str(row.get("risk_measure")),
        "creator_id": _str(row.get("creator_id")),
        "creator_name": _str(row.get("creator_name")),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
    }


@router.get("")
def list_major_issues(
    operator_id: str = "demo_001",
    status: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 20,
    force_sync: bool = False,
) -> dict:
    st = str(status or "").strip()
    if st and st not in MAJOR_ISSUE_STATUSES:
        raise HTTPException(status_code=400, detail=f"无效状态: {st}")
    qq = str(q or "").strip()
    pg = max(1, page)
    ps = max(1, min(100, page_size))
    offset = (pg - 1) * ps

    try:
        with db_conn() as conn:
            _maybe_sync_major_issues(conn, force=force_sync)

            where_parts: list[str] = ["1=1"]
            params: list[Any] = []
            if st:
                where_parts.append("m.status = %s")
                params.append(st)
            if qq:
                pat = f"%{qq}%"
                where_parts.append(
                    "(m.ticket_no ILIKE %s OR m.site_name ILIKE %s OR m.description ILIKE %s "
                    "OR m.ops_analyst ILIKE %s OR m.dev_analyst ILIKE %s)"
                )
                params.extend([pat] * 5)
            wh = " AND ".join(where_parts)

            count_row = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM major_issue m WHERE {wh}", tuple(params)
            ).fetchone()
            total = int(count_row["cnt"] or 0)

            rows = conn.execute(
                f"""
                SELECT m.*,
                  (SELECT COUNT(*) FROM major_issue_progress p WHERE p.major_issue_id = m.id) AS progress_count,
                  lp.progress_at AS latest_progress_at,
                  lp.content     AS latest_progress_content,
                  lp.risk_measure AS latest_progress_risk
                FROM major_issue m
                LEFT JOIN LATERAL (
                  SELECT progress_at, content, risk_measure
                  FROM major_issue_progress p
                  WHERE p.major_issue_id = m.id
                  ORDER BY p.progress_at DESC, p.id DESC
                  LIMIT 1
                ) lp ON TRUE
                WHERE {wh}
                ORDER BY m.report_date DESC NULLS LAST, m.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(params + [ps, offset]),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_ISSUE_SCHEMA_HINT}") from exc

    return {
        "items": [_serialize_issue(r) for r in rows],
        "total": total,
        "page": pg,
        "page_size": ps,
    }


@router.get("/{issue_id}")
def get_major_issue(issue_id: int, operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT * FROM major_issue WHERE id = %s", (issue_id,)
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_ISSUE_SCHEMA_HINT}") from exc
    if not row:
        raise HTTPException(status_code=404, detail="重大问题记录不存在")
    row["progress_count"] = 0
    return _serialize_issue(row)


@router.patch("/{issue_id}")
def update_major_issue_status(issue_id: int, payload: dict) -> dict:
    operator_id = str(payload.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    st = str(payload.get("status", "")).strip()
    if st not in MAJOR_ISSUE_STATUSES:
        raise HTTPException(status_code=400, detail=f"无效状态: {st}")
    try:
        with db_conn() as conn:
            if not _can_write(conn, operator_id):
                raise HTTPException(status_code=403, detail="无权修改重大问题状态")
            existing = conn.execute(
                "SELECT id FROM major_issue WHERE id = %s", (issue_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="重大问题记录不存在")
            conn.execute(
                "UPDATE major_issue SET status = %s WHERE id = %s", (st, issue_id)
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM major_issue WHERE id = %s", (issue_id,)
            ).fetchone()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_ISSUE_SCHEMA_HINT}") from exc
    row["progress_count"] = 0
    return _serialize_issue(row)


@router.get("/{issue_id}/progress")
def list_progress(issue_id: int, operator_id: str = "demo_001") -> dict:
    try:
        with db_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, major_issue_id, progress_at, content, risk_measure,
                       creator_id, creator_name, created_at
                FROM major_issue_progress
                WHERE major_issue_id = %s
                ORDER BY progress_at DESC, id DESC
                """,
                (issue_id,),
            ).fetchall()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_ISSUE_SCHEMA_HINT}") from exc
    return {"items": [_serialize_progress(r) for r in rows], "total": len(rows)}


@router.post("/{issue_id}/progress")
def add_progress(issue_id: int, payload: dict) -> dict:
    operator_id = str(payload.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    content = str(payload.get("content", "")).strip()
    if not content:
        raise HTTPException(status_code=400, detail="进展内容不能为空")
    risk_measure = str(payload.get("risk_measure", "")).strip()
    try:
        with db_conn() as conn:
            if not _can_write(conn, operator_id):
                raise HTTPException(status_code=403, detail="无权新增进展记录")
            existing = conn.execute(
                "SELECT id FROM major_issue WHERE id = %s", (issue_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="重大问题记录不存在")
            creator_name = _display_name_account(conn, operator_id) or operator_id
            # 进展按天记录：同一天（Asia/Shanghai）再次提交，覆盖当天的历史进展，而非追加新行
            today_row = conn.execute(
                """
                SELECT id FROM major_issue_progress
                WHERE major_issue_id = %s
                  AND (progress_at AT TIME ZONE 'Asia/Shanghai')::date
                      = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
                ORDER BY progress_at DESC, id DESC
                LIMIT 1
                """,
                (issue_id,),
            ).fetchone()
            if today_row:
                row = conn.execute(
                    """
                    UPDATE major_issue_progress
                    SET content = %s, risk_measure = %s, progress_at = NOW(),
                        creator_id = %s, creator_name = %s
                    WHERE id = %s
                    RETURNING id, major_issue_id, progress_at, content, risk_measure,
                              creator_id, creator_name, created_at
                    """,
                    (content, risk_measure, operator_id, creator_name, today_row["id"]),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    INSERT INTO major_issue_progress (
                        major_issue_id, content, risk_measure, creator_id, creator_name
                    ) VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, major_issue_id, progress_at, content, risk_measure,
                              creator_id, creator_name, created_at
                    """,
                    (issue_id, content, risk_measure, operator_id, creator_name),
                ).fetchone()
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_ISSUE_SCHEMA_HINT}") from exc
    return _serialize_progress(row)
