"""重大问题（工单驱动）路由。

设计要点：
- 工作台的工单，当「事件级别」（快照 extra_fields.event_level）命中阈值时 upsert 到 major_issue。
- 展示字段（起始日期、局点、问题描述、分析人等）只读 ticket_list_snapshot，与工作台列表同源；本模块不写入快照表。
- 列表接口只读 major_issue 分页；历史回填由 POST /backfill 按快照 event_level 筛单号后分批 upsert。
- problem_fill / ops_analysis 保存或提交时由工单模块刷新快照后，再按单同步 major_issue。
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from fastapi import APIRouter, HTTPException, Request

from config import MAJOR_ISSUE_BACKFILL_BATCH_SIZE
from database import db_conn
from utils.html_text import strip_html_plain

logger = logging.getLogger(__name__)

_MAJOR_ISSUE_SCHEMA_HINT = "请在数据库执行 db/migrations/0073_major_issue.sql"

QUALIFYING_EVENT_LEVELS: tuple[str, ...] = (
    "内部通报重大问题",
    "管理升级预警",
    "已管理升级",
    "事故",
    "P1-P3事件",
    "P4事件",
)

MAJOR_ISSUE_STATUSES = ("进行中", "挂起", "关闭")

_OPS_ANALYSIS_NODE_KEY = "ops_analysis"
_DEV_ANALYSIS_NODE_KEY = "dev_analysis"
_PROBLEM_FILL_NODE_KEY = "problem_fill"

_ADMIN_ROLE_CODES = frozenset({"admin", "管理员"})
_MAJOR_ISSUE_CLOSE_ROLE_CODES = frozenset({"admin", "管理员", "运维组长"})

_SYNC_FIELD_NODES = (_OPS_ANALYSIS_NODE_KEY, _PROBLEM_FILL_NODE_KEY)

_QUALIFYING_SNAPSHOT_WHERE = (
    "NULLIF(BTRIM(tls.extra_fields->>'event_level'), '') = ANY(%s)"
)

router = APIRouter(prefix="/api/major-issues", tags=["major-issues"])

_SYNC_CTE_BODY = """
        candidates AS (
            SELECT
                t.ticket_no,
                CASE
                    WHEN tls.start_date ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$'
                    THEN tls.start_date::date
                    ELSE (t.created_at AT TIME ZONE 'UTC')::date
                END AS report_date,
                COALESCE(tls.location, '') AS site_name,
                NULLIF(BTRIM(tls.extra_fields->>'event_level'), '') AS event_level,
                COALESCE(NULLIF(BTRIM(tls.description_plain), ''), '') AS description,
                COALESCE(
                    NULLIF(BTRIM(tls.extra_fields->>'ops_analyst'), ''),
                    NULLIF(BTRIM(tls.fields_by_node->'ops_analysis'->>'next_handler'), ''),
                    ''
                ) AS ops_analyst,
                COALESCE(
                    NULLIF(BTRIM(tls.extra_fields->>'dev_analyst'), ''),
                    NULLIF(BTRIM(tls.fields_by_node->'dev_analysis'->>'next_handler'), ''),
                    ''
                ) AS dev_analyst
            FROM ticket t
            INNER JOIN ticket_list_snapshot tls ON tls.ticket_id = t.id
            WHERE NULLIF(BTRIM(tls.extra_fields->>'event_level'), '') = ANY(%s)
              {candidate_ticket_filter}
        )
"""


def _sync_sql_params(ticket_ids: list[int]) -> tuple[Any, ...]:
    levels = list(QUALIFYING_EVENT_LEVELS)
    return (levels, ticket_ids, ticket_ids)


def _build_sync_sql() -> str:
    cte = _SYNC_CTE_BODY.format(
        candidate_ticket_filter="AND t.id = ANY(%s)",
    )
    return f"""
        WITH {cte},
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
        ),
        removed AS (
            DELETE FROM major_issue m
            WHERE m.ticket_no IN (SELECT ticket_no FROM ticket WHERE id = ANY(%s))
              AND NOT EXISTS (
                  SELECT 1 FROM candidates c WHERE c.ticket_no = m.ticket_no
              )
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM upserted) AS upserted_cnt,
            (SELECT COUNT(*) FROM removed) AS removed_cnt
        """


def _display_name_account(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute("SELECT user_name FROM user_account WHERE account = %s", (acc,)).fetchone()
    un = str(row["user_name"] or "").strip() if row else ""
    return f"{un} {acc}".strip() if un else acc


def _user_role_code(conn: psycopg.Connection, account: str) -> str:
    acc = str(account or "").strip()
    if not acc:
        return ""
    row = conn.execute(
        "SELECT role_code FROM user_account WHERE account = %s",
        (acc,),
    ).fetchone()
    return str(row["role_code"] or "").strip() if row else ""


def _can_write(conn: psycopg.Connection, account: str) -> bool:
    from whitelist_policy import whitelist_delete_allowed

    if not str(account or "").strip():
        return False
    return whitelist_delete_allowed(conn, account, "major_problem_create")


def _can_close_major_issue(conn: psycopg.Connection, account: str) -> bool:
    return _user_role_code(conn, account) in _MAJOR_ISSUE_CLOSE_ROLE_CODES


def _str(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _sync_ticket_ids(conn: psycopg.Connection, ticket_ids: list[int]) -> dict[str, int]:
    """按工单 id 列表同步：仅以最新 event_level 判定是否入库（命中阈值才 upsert）。"""
    if not ticket_ids:
        return {"upserted": 0, "removed": 0}
    row = conn.execute(
        _build_sync_sql(),
        _sync_sql_params(ticket_ids),
    ).fetchone()
    return {
        "upserted": int((row or {}).get("upserted_cnt") or 0),
        "removed": int((row or {}).get("removed_cnt") or 0),
    }


def _event_levels_from_snapshot(conn: psycopg.Connection, ticket_ids: list[int]) -> dict[int, str]:
    """从 ticket_list_snapshot.extra_fields 读取 event_level（与工作台列表一致）。"""
    if not ticket_ids:
        return {}
    try:
        rows = conn.execute(
            """
            SELECT tls.ticket_id,
                   NULLIF(BTRIM(tls.extra_fields->>'event_level'), '') AS event_level
            FROM ticket_list_snapshot tls
            WHERE tls.ticket_id = ANY(%s)
              AND NULLIF(BTRIM(tls.extra_fields->>'event_level'), '') IS NOT NULL
            """,
            (ticket_ids,),
        ).fetchall()
    except UndefinedTable:
        return {}
    out: dict[int, str] = {}
    for r in rows:
        tid = int(r["ticket_id"])
        lvl = _str(r.get("event_level"))
        if lvl:
            out[tid] = lvl
    return out


def _remove_major_issues_for_tickets(conn: psycopg.Connection, ticket_ids: list[int]) -> int:
    if not ticket_ids:
        return 0
    rows = conn.execute(
        """
        DELETE FROM major_issue m
        USING ticket t
        WHERE t.id = ANY(%s) AND m.ticket_no = t.ticket_no
        RETURNING m.id
        """,
        (ticket_ids,),
    ).fetchall()
    return len(rows)


def _sync_ticket_ids_from_snapshot(conn: psycopg.Connection, ticket_ids: list[int]) -> dict[str, int]:
    """只读快照判定 event_level；命中阈值再从快照 upsert 展示字段（不写快照表）。"""
    if not ticket_ids:
        return {"upserted": 0, "removed": 0}
    levels = _event_levels_from_snapshot(conn, ticket_ids)
    qualifying_set = {lvl for lvl in QUALIFYING_EVENT_LEVELS}
    qualifying = [tid for tid in ticket_ids if levels.get(tid) in qualifying_set]
    non_qualifying = [tid for tid in ticket_ids if tid not in qualifying]
    upserted = 0
    removed = 0
    if qualifying:
        sync_result = _sync_ticket_ids(conn, qualifying)
        upserted = sync_result["upserted"]
    if non_qualifying:
        removed = _remove_major_issues_for_tickets(conn, non_qualifying)
    return {"upserted": upserted, "removed": removed}


def sync_major_issue_for_ticket(conn: psycopg.Connection, ticket_id: int) -> dict[str, int]:
    return _sync_ticket_ids_from_snapshot(conn, [int(ticket_id)])


def _backfill_ticket_ids(conn: psycopg.Connection, ticket_ids: list[int]) -> dict[str, int]:
    """只读快照判定 event_level；命中阈值再从快照 upsert 展示字段（不写快照表）。"""
    return _sync_ticket_ids_from_snapshot(conn, ticket_ids)


def _count_qualifying_snapshot_tickets(conn: psycopg.Connection) -> int:
    row = conn.execute(
        f"""
        SELECT COUNT(*) AS cnt
        FROM ticket_list_snapshot tls
        WHERE {_QUALIFYING_SNAPSHOT_WHERE}
        """,
        (list(QUALIFYING_EVENT_LEVELS),),
    ).fetchone()
    return int((row or {}).get("cnt") or 0)


def _fetch_qualifying_ticket_ids(
    conn: psycopg.Connection,
    *,
    after_ticket_id: int,
    limit: int,
) -> list[int]:
    rows = conn.execute(
        f"""
        SELECT tls.ticket_id
        FROM ticket_list_snapshot tls
        WHERE {_QUALIFYING_SNAPSHOT_WHERE}
          AND tls.ticket_id > %s
        ORDER BY tls.ticket_id ASC
        LIMIT %s
        """,
        (list(QUALIFYING_EVENT_LEVELS), max(0, int(after_ticket_id)), limit),
    ).fetchall()
    return [int(r["ticket_id"]) for r in rows]


def backfill_major_issues_batch(
    conn: psycopg.Connection,
    *,
    after_ticket_id: int = 0,
    batch_size: int | None = None,
    ticket_ids: list[int] | None = None,
) -> dict[str, Any]:
    """回填一批：先从快照 event_level 筛 ticket_id，再 upsert major_issue。"""
    bs = batch_size if batch_size is not None else MAJOR_ISSUE_BACKFILL_BATCH_SIZE
    bs = max(10, min(500, int(bs)))

    if ticket_ids is not None:
        ids = [int(i) for i in ticket_ids if int(i) > 0]
        result = _backfill_ticket_ids(conn, ids)
        major_total = int(
            conn.execute("SELECT COUNT(*) AS cnt FROM major_issue").fetchone()["cnt"] or 0
        )
        return {
            **result,
            "processed": len(ids),
            "after_ticket_id": max(ids) if ids else after_ticket_id,
            "has_more": False,
            "ticket_total": None,
            "major_issue_total": major_total,
        }

    cursor = max(0, int(after_ticket_id))
    ids = _fetch_qualifying_ticket_ids(conn, after_ticket_id=cursor, limit=bs)
    ticket_total: int | None = None
    if cursor == 0:
        ticket_total = _count_qualifying_snapshot_tickets(conn)

    if not ids:
        major_total = int(
            conn.execute("SELECT COUNT(*) AS cnt FROM major_issue").fetchone()["cnt"] or 0
        )
        return {
            "upserted": 0,
            "removed": 0,
            "processed": 0,
            "after_ticket_id": cursor,
            "has_more": False,
            "ticket_total": ticket_total if ticket_total is not None else 0,
            "major_issue_total": major_total,
        }

    result = _sync_ticket_ids(conn, ids)
    major_total = int(
        conn.execute("SELECT COUNT(*) AS cnt FROM major_issue").fetchone()["cnt"] or 0
    )
    return {
        **result,
        "processed": len(ids),
        "after_ticket_id": max(ids),
        "has_more": len(ids) >= bs,
        "ticket_total": ticket_total,
        "major_issue_total": major_total,
    }


def backfill_all_major_issues(*, batch_size: int | None = None) -> dict[str, Any]:
    """CLI 全量回填：内部循环 backfill_major_issues_batch 直至完成。"""
    after = 0
    ticket_total = 0
    processed = 0
    upserted_total = 0
    removed_total = 0
    while True:
        with db_conn() as conn:
            summary = backfill_major_issues_batch(
                conn, after_ticket_id=after, batch_size=batch_size
            )
            conn.commit()
        if summary.get("ticket_total") is not None:
            ticket_total = int(summary.get("ticket_total") or 0)
        processed += int(summary.get("processed") or 0)
        upserted_total += int(summary.get("upserted") or 0)
        removed_total += int(summary.get("removed") or 0)
        if not summary.get("has_more"):
            break
        after = int(summary.get("after_ticket_id") or 0)
        if not after:
            break
    return {
        "upserted": upserted_total,
        "removed": removed_total,
        "processed": processed,
        "ticket_total": ticket_total,
    }


def maybe_sync_major_issue_after_ticket_field_change(
    conn: psycopg.Connection,
    ticket_id: int,
    node_key: str,
) -> None:
    if str(node_key or "").strip() not in _SYNC_FIELD_NODES:
        return
    try:
        result = sync_major_issue_for_ticket(conn, ticket_id)
        if result["upserted"] or result["removed"]:
            logger.info(
                "major_issue ticket sync ticket_id=%s node=%s upserted=%s removed=%s",
                ticket_id,
                node_key,
                result["upserted"],
                result["removed"],
            )
    except UndefinedTable:
        logger.warning("major_issue table missing; skip ticket sync ticket_id=%s", ticket_id)


def _serialize_issue(row: dict) -> dict[str, Any]:
    return {
        "id": int(row.get("id") or 0),
        "ticket_no": _str(row.get("ticket_no")),
        "report_date": row["report_date"].isoformat() if row.get("report_date") else "",
        "site_name": _str(row.get("site_name")),
        "event_level": _str(row.get("event_level")),
        "description": strip_html_plain(_str(row.get("description"))),
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


@router.post("/backfill", response_model=None)
async def backfill_major_issues(
    request: Request, payload: dict
) -> dict[str, Any]:
    """历史回填：按快照 event_level 筛 ticket_id 游标分批 upsert，每批单事务 commit。

    支持 X-Stream-Keepalive: 1 流式 keepalive，避免网关 504。
    """
    from utils.long_request_stream import maybe_stream_json_response

    return await maybe_stream_json_response(request, lambda: _backfill_major_issues_sync(payload))


def _backfill_major_issues_sync(body: dict) -> dict[str, Any]:
    operator_id = str(body.get("operator_id", "")).strip()
    if not operator_id:
        raise HTTPException(status_code=400, detail="operator_id 不能为空")
    after_ticket_id = 0 if bool(body.get("reset_cursor")) else max(0, int(body.get("after_ticket_id") or 0))
    ticket_nos_raw = body.get("ticket_nos") or []
    ticket_nos = [str(x).strip() for x in ticket_nos_raw if str(x).strip()]
    batch_size = body.get("batch_size")
    bs: int | None = None
    if batch_size is not None:
        bs = max(10, min(500, int(batch_size)))

    logger.info(
        "major_issue backfill start operator=%s after_ticket_id=%s batch_size=%s count_only=%s",
        operator_id,
        after_ticket_id,
        bs,
        bool(body.get("count_only")),
    )

    try:
        with db_conn() as conn:
            if not _can_write(conn, operator_id):
                raise HTTPException(status_code=403, detail="无权执行重大问题回填")
            if bool(body.get("count_only")):
                ticket_total = _count_qualifying_snapshot_tickets(conn)
                major_total = int(
                    conn.execute("SELECT COUNT(*) AS cnt FROM major_issue").fetchone()["cnt"] or 0
                )
                logger.info(
                    "major_issue backfill count_only operator=%s qualifying_total=%s major_issue_total=%s",
                    operator_id,
                    ticket_total,
                    major_total,
                )
                return {
                    "processed": 0,
                    "upserted": 0,
                    "removed": 0,
                    "after_ticket_id": after_ticket_id,
                    "has_more": False,
                    "ticket_total": ticket_total,
                    "major_issue_total": major_total,
                    "count_only": True,
                }
            ticket_ids: list[int] | None = None
            if ticket_nos:
                rows = conn.execute(
                    "SELECT id FROM ticket WHERE ticket_no = ANY(%s)",
                    (ticket_nos,),
                ).fetchall()
                ticket_ids = [int(r["id"]) for r in rows]
            result = backfill_major_issues_batch(
                conn,
                after_ticket_id=after_ticket_id,
                batch_size=bs,
                ticket_ids=ticket_ids,
            )
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"重大问题表未就绪：{_MAJOR_ISSUE_SCHEMA_HINT}") from exc

    logger.info(
        "major_issue backfill operator=%s processed=%s upserted=%s removed=%s after=%s has_more=%s",
        operator_id,
        result.get("processed"),
        result.get("upserted"),
        result.get("removed"),
        result.get("after_ticket_id"),
        result.get("has_more"),
    )
    return result


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
            if st == "关闭":
                if not _can_close_major_issue(conn, operator_id):
                    raise HTTPException(status_code=403, detail="仅管理员或运维组长可关闭重大问题")
            elif not _can_write(conn, operator_id):
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
