"""接口测试：/api/qi/analytics 数据契约（本轮为 UI 重设计，未改后端；回归确认契约未受影响）。"""
import httpx
import pytest

pytestmark = pytest.mark.e2e


def test_qi_analytics_contract(backend_server):
    url = f"{backend_server}/api/qi/analytics"
    r = httpx.get(
        url,
        params={"operator_id": "test_admin", "start_date": "2026-01-01", "end_date": "2026-12-31"},
        timeout=30,
    )
    assert r.status_code == 200, f"分析接口应 200，实际 {r.status_code}: {r.text[:300]}"
    j = r.json()

    # 顶层契约字段（前端 renderQiAnalyticsBody 依赖）
    for k in [
        "kpi",
        "stage_distribution",
        "domain_distribution",
        "module_distribution",
        "domain_module_distribution",
        "user_domain_submission",
        "user_domain_acceptance",
        "category_distribution",
    ]:
        assert k in j, f"分析接口缺少字段 {k}"

    # 分布字段形状：labels / values 均为数组
    for k in ["stage_distribution", "domain_distribution", "module_distribution", "category_distribution"]:
        assert "labels" in j[k] and "values" in j[k], f"{k} 应含 labels/values"
        assert isinstance(j[k]["labels"], list) and isinstance(j[k]["values"], list)
        assert len(j[k]["labels"]) == len(j[k]["values"]), f"{k} labels/values 长度应一致"

    # domain_module / user_* 为对象数组
    for k in ["domain_module_distribution", "user_domain_submission", "user_domain_acceptance"]:
        assert isinstance(j[k], list), f"{k} 应为数组"

    # KPI 关键字段
    assert "total" in j["kpi"] and "in_progress" in j["kpi"], "kpi 应含 total/in_progress"
