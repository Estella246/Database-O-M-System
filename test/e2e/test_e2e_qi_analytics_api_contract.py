"""接口测试：/api/qi/analytics 数据契约（本轮为 UI 重设计，未改后端；回归确认契约未受影响）。"""
import os

import httpx
import psycopg
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
    # analysis_*/closure_* 四字段供「责任田超期率」=（确认+实施超期）/（确认+实施总量）。
    # 无关联田（参数页可先建田后配关联）domain 为空串属合法状态，非空仅对有关联的田断言——
    # 否则共享库上手工造的无关联田（如本地「非」）会误伤契约）
    _dsn = os.environ.get("DATABASE_URL")
    if not _dsn:
        # 后端缺 DSN 时会回退到内置 DSN 正常起服务（backend/database.py），契约测试照样跑；
        # 但无 binding 视角时 domain 非空断言只能静默失效——显式跳过，不留假绿
        pytest.skip("无 DATABASE_URL，无法核对有关联田（domain 非空契约需查 binding），跳过")
    _bound = set()
    with psycopg.connect(_dsn) as _conn, _conn.cursor() as _cur:
        _cur.execute(
            """SELECT f.name, f.owner FROM research_duty_field f
               WHERE EXISTS (SELECT 1 FROM research_duty_field_binding b WHERE b.field_id = f.id)"""
        )
        _bound = {(str(r[0]), str(r[1])) for r in _cur.fetchall()}
    for item in j["research_field_stats"]:
        for f in ["name", "domain", "module", "owner", "total", "analyzed", "accepted", "closed_done", "overdue",
                  "analysis_total", "analysis_overdue", "closure_total", "closure_overdue"]:
            assert f in item, f"research_field_stats 元素缺少字段 {f}: {item}"
        for f in ["name", "domain", "module", "owner"]:
            assert isinstance(item[f], str), f"research_field_stats.{f} 应为 str: {item}"
        assert item["module"] == "", f"两层模型下 module 恒空（关联已并入 domain 文本）: {item}"
        if (item["name"], item["owner"]) in _bound:
            assert item["domain"], f"有关联的田 domain 应为非空合并文本: {item}"
        for f in ["total", "analyzed", "accepted", "closed_done", "overdue",
                  "analysis_total", "analysis_overdue", "closure_total", "closure_overdue"]:
            assert isinstance(item[f], int), f"research_field_stats.{f} 应为 int: {item}"
        # 超期率口径不变式：分项超期 ≤ 分母
        assert item["analysis_overdue"] <= item["analysis_total"], f"analysis_overdue 越界: {item}"
        assert item["closure_overdue"] <= item["closure_total"], f"closure_overdue 越界: {item}"

    # KPI 关键字段
    assert "total" in j["kpi"] and "in_progress" in j["kpi"], "kpi 应含 total/in_progress"
