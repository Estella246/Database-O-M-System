from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from stats_charts import get_stats_charts

router = APIRouter(prefix="/api/stats/charts", tags=["stats-charts"])


@router.get("")
def stats_charts(
    operator_id: str = Query("demo_001"),
    view: str = Query(..., description="labor | ownership | doer"),
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    product_line: str = Query("", description="人力投入：产品线筛选"),
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
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
