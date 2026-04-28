from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Any
import psycopg
from fastapi import APIRouter, HTTPException
from config import (
    HOME_PERSONAL_SLA_STAGE_KEYS,
    HOME_PERSONAL_STAGE_NAME_BY_KEY,
    HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS,
)
from database import db_conn
from utils import (
    parse_ymd as _parse_ymd,
    to_utc_start as _to_utc_start,
)

router = APIRouter(prefix="/api/home", tags=["home"])


def _quality_scope_matches(scope: str, raw_value: str) -> bool:
    if scope == "all":
        return True
    val = str(raw_value or "").strip().lower()
    is_quality = val in ("true", "yes", "1", "是", "质量")
    if scope == "quality":
        return is_quality
    return not is_quality


@router.get("/personal-stats")
def get_home_personal_stats(
    operator_id: str = "demo_001",
    start_date: str = "",
    end_date: str = "",
    quality_scope: str = "all",
) -> dict[str, Any]:
    op = str(operator_id or "").strip() or "demo_001"
    sd = _parse_ymd(start_date, "start_date")
    ed = _parse_ymd(end_date, "end_date")
    if sd > ed:
        sd, ed = ed, sd
    sc = str(quality_scope or "all").strip().lower()
    if sc not in ("all", "quality", "non_quality"):
        raise HTTPException(status_code=400, detail="quality_scope 须为 all、quality 或 non_quality")

    start_dt = _to_utc_start(sd)
    end_dt_exclusive = _to_utc_start(ed) + date.resolution
    end_ts = end_dt_exclusive.timestamp()
    span_secs = max(end_ts - start_dt.timestamp(), 1.0)

    points = 12
    labels: list[str] = []
    workload_values = [0 for _ in range(points)]
    for i in range(points):
        ts = start_dt.timestamp() + (i / max(points - 1, 1)) * (end_ts - start_dt.timestamp())
        labels.append(datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%m/%d"))

    sla_sum_by_stage = {k: 0.0 for k in HOME_PERSONAL_SLA_STAGE_KEYS}
    sla_count_by_stage = {k: 0 for k in HOME_PERSONAL_SLA_STAGE_KEYS}
    passthrough_independent = 0
    passthrough_commando = 0

    with db_conn() as conn:
        workload_rows = conn.execute(
            """
            SELECT tfl.created_at
            FROM ticket_flow_log tfl
            WHERE tfl.operator_id = %s
              AND tfl.action_type IN ('submit', 'jump_submit')
              AND tfl.created_at >= %s
              AND tfl.created_at < %s
            ORDER BY tfl.created_at ASC
            """,
            (op, start_dt, end_dt_exclusive),
        ).fetchall()
        for row in workload_rows:
            ts = row["created_at"]
            if not ts:
                continue
            ts_ms = ts.timestamp()
            idx = int(((ts_ms - start_dt.timestamp()) / span_secs) * points)
            if idx < 0:
                idx = 0
            elif idx >= points:
                idx = points - 1
            workload_values[idx] += 1

        sla_rows = conn.execute(
            """
            SELECT wn.node_key, tni.started_at, tni.ended_at
            FROM ticket_node_instance tni
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE tni.handler_id = %s
              AND wn.node_key = ANY(%s)
              AND tni.started_at >= %s
              AND tni.started_at < %s
            """,
            (op, list(HOME_PERSONAL_SLA_STAGE_KEYS), start_dt, end_dt_exclusive),
        ).fetchall()
        now_utc = datetime.now(timezone.utc)
        for row in sla_rows:
            stage_key = str(row["node_key"] or "").strip()
            if stage_key not in sla_sum_by_stage:
                continue
            st = row["started_at"]
            if not st:
                continue
            et = row["ended_at"] if row["ended_at"] else now_utc
            hours = max(0.0, (et - st).total_seconds() / 3600.0)
            sla_sum_by_stage[stage_key] += hours
            sla_count_by_stage[stage_key] += 1

        passthrough_rows = conn.execute(
            """
            SELECT
              t.id,
              t.status,
              COALESCE(cur.node_key, '') AS current_node_key,
              COALESCE(latest.values_json->>'is_quality_issue', '') AS is_quality_issue,
              EXISTS (
                SELECT 1
                FROM ticket_flow_log tf1
                JOIN workflow_node f1 ON f1.id = tf1.from_node_id
                JOIN workflow_node t1 ON t1.id = tf1.to_node_id
                WHERE tf1.ticket_id = t.id
                  AND tf1.action_type IN ('submit', 'jump_submit')
                  AND f1.node_key = 'ops_analysis'
                  AND t1.node_key IN ('dev_closure', 'ops_closure')
              ) AS has_independent_closure,
              EXISTS (
                SELECT 1
                FROM ticket_flow_log tf2
                JOIN workflow_node f2 ON f2.id = tf2.from_node_id
                JOIN workflow_node t2 ON t2.id = tf2.to_node_id
                WHERE tf2.ticket_id = t.id
                  AND tf2.action_type IN ('submit', 'jump_submit')
                  AND f2.node_key IN ('ops_analysis', 'ops_closure')
                  AND t2.node_key = 'dev_analysis'
              ) AS has_commando
            FROM ticket t
            LEFT JOIN workflow_node cur ON cur.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT tnd.values_json
              FROM ticket_node_data tnd
              WHERE tnd.ticket_id = t.id
              ORDER BY tnd.created_at DESC, tnd.id DESC
              LIMIT 1
            ) latest ON TRUE
            WHERE t.created_at >= %s
              AND t.created_at < %s
            """,
            (start_dt, end_dt_exclusive),
        ).fetchall()
        for row in passthrough_rows:
            curr_key = str(row["current_node_key"] or "").strip()
            is_closed = str(row["status"] or "").strip().lower() == "closed"
            if (not is_closed) and curr_key in HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS:
                continue
            if not _quality_scope_matches(sc, str(row["is_quality_issue"] or "")):
                continue
            has_independent = bool(row["has_independent_closure"])
            has_commando = bool(row["has_commando"])
            if has_commando:
                passthrough_commando += 1
            elif has_independent:
                passthrough_independent += 1

    stage_labels = [HOME_PERSONAL_STAGE_NAME_BY_KEY[k] for k in HOME_PERSONAL_SLA_STAGE_KEYS]
    stage_values = [
        int(round(sla_sum_by_stage[k] / sla_count_by_stage[k])) if sla_count_by_stage[k] > 0 else 0
        for k in HOME_PERSONAL_SLA_STAGE_KEYS
    ]
    return {
        "workload": {"labels": labels, "values": workload_values},
        "sla": {"stages": stage_labels, "values": stage_values},
        "passthrough": {
            "independent_closure_count": passthrough_independent,
            "commando_count": passthrough_commando,
        },
    }