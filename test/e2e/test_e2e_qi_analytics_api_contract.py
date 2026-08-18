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
        "user_stage_distribution",
        "user_sub_all",
        "user_acc_all",
        "handler_stage_distribution",
        "category_distribution",
        "research_field_stats",
    ]:
        assert k in j, f"分析接口缺少字段 {k}"

    # 分布字段形状：labels / values 均为数组
    for k in ["stage_distribution", "domain_distribution", "module_distribution", "category_distribution"]:
        assert "labels" in j[k] and "values" in j[k], f"{k} 应含 labels/values"
        assert isinstance(j[k]["labels"], list) and isinstance(j[k]["values"], list)
        assert len(j[k]["labels"]) == len(j[k]["values"]), f"{k} labels/values 长度应一致"

    # domain_module / user_* 为对象数组
    for k in ["domain_module_distribution", "user_domain_submission", "user_domain_acceptance", "user_stage_distribution", "user_sub_all", "user_acc_all", "handler_stage_distribution", "research_field_stats"]:
        assert isinstance(j[k], list), f"{k} 应为数组"

    # 在研责任田统计元素契约（两层模型：一行=一田；前端按 name/domain/owner + 计数字段组装图表，
    # domain 为该田全部关联的合并文本如「D1/M1、D2（整领域）」，module 恒 ""；
    # analysis_*/closure_* 四字段供「责任田超期率」=（确认+实施超期）/（确认+实施总量））
    for item in j["research_field_stats"]:
        for f in ["name", "domain", "module", "owner", "total", "analyzed", "accepted", "closed_done", "overdue",
                  "analysis_total", "analysis_overdue", "closure_total", "closure_overdue"]:
            assert f in item, f"research_field_stats 元素缺少字段 {f}: {item}"
        for f in ["name", "domain", "module", "owner"]:
            assert isinstance(item[f], str), f"research_field_stats.{f} 应为 str: {item}"
        assert item["module"] == "", f"两层模型下 module 恒空（关联已并入 domain 文本）: {item}"
        assert item["domain"], f"domain 应为非空合并文本: {item}"
        for f in ["total", "analyzed", "accepted", "closed_done", "overdue",
                  "analysis_total", "analysis_overdue", "closure_total", "closure_overdue"]:
            assert isinstance(item[f], int), f"research_field_stats.{f} 应为 int: {item}"
        # 超期率口径不变式：分项超期 ≤ 分母
        assert item["analysis_overdue"] <= item["analysis_total"], f"analysis_overdue 越界: {item}"
        assert item["closure_overdue"] <= item["closure_total"], f"closure_overdue 越界: {item}"

    # KPI 关键字段
    assert "total" in j["kpi"] and "in_progress" in j["kpi"], "kpi 应含 total/in_progress"
