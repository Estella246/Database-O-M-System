from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from psycopg.errors import UndefinedTable
from pydantic import BaseModel, Field

from config import TICKET_STATS_DAILY_ENABLED
from database import db_conn
from stats_charts import get_stats_charts
from utils.logging_config import operator_log_label

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stats/charts", tags=["stats-charts"])


class StatsDailyBackfillPayload(BaseModel):
    operator_id: str = "demo_001"
    reset: bool = False
    after_ticket_id: int = Field(0, ge=0)
    batch_size: int = Field(50, ge=1, le=500)


def _stats_daily_backfill_allowed(conn, operator_id: str) -> bool:
    from whitelist_policy import whitelist_delete_allowed

    return whitelist_delete_allowed(conn, operator_id, "workbench_snapshot_rebuild")


@router.get("")
def stats_charts(
    operator_id: str = Query("demo_001"),
    view: str = Query(..., description="labor | ownership | doer"),
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    product_line: str = Query("", description="人力投入：产品线筛选"),
    include_collab: bool = Query(False, description="人力投入：是否计入协同处理人"),
    precision: str = Query("month", description="问题归属：day|month|year"),
    quality: str = Query("all", description="问题归属：质量问题筛选"),
    component: str = Query("all", description="问题归属：组件 kernel|control|all"),
    include_ops: bool = Query(True, description="Doer：含运维分析"),
    include_dev: bool = Query(True, description="Doer：含开发分析"),
) -> dict[str, Any]:
    """统计图表聚合接口：按时间范围返回预聚合结果，不返回全量工单明细。"""
    try:
        return get_stats_charts(
            operator_id,
            view,
            start_date,
            end_date,
            product_line=product_line,
            precision=precision,
            quality=quality,
            component=component,
            include_ops=include_ops,
            include_dev=include_dev,
            include_collab=include_collab,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/backfill")
def backfill_stats_daily(payload: StatsDailyBackfillPayload) -> dict[str, Any]:
    """运维：分批回填统计日汇总（须 workbench_snapshot_rebuild 非 hidden）。"""
    if not TICKET_STATS_DAILY_ENABLED:
        raise HTTPException(status_code=503, detail="TICKET_STATS_DAILY_ENABLED=0，跳过日汇总回填")
    op = str(payload.operator_id or "").strip() or "demo_001"
    op_log = operator_log_label(op)
    with db_conn() as conn:
        if not _stats_daily_backfill_allowed(conn, op):
            raise HTTPException(status_code=403, detail="无回填日汇总权限（workbench_snapshot_rebuild）")
        from ticket_stats_daily import backfill_stats_daily_batch

        try:
            summary = backfill_stats_daily_batch(
                conn,
                reset=bool(payload.reset),
                after_ticket_id=int(payload.after_ticket_id or 0),
                batch_size=int(payload.batch_size or 50),
            )
            conn.commit()
        except UndefinedTable as exc:
            raise HTTPException(status_code=503, detail="ticket_stats_daily 表不存在，请先执行迁移 0082") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    logger.info(
        "stats daily backfill api operator=%s processed=%s cumulative=%s total=%s has_more=%s",
        op_log,
        summary.get("processed"),
        summary.get("done_cumulative"),
        summary.get("total"),
        summary.get("has_more"),
    )
    return summary
