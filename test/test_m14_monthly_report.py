"""M14 现网重大问题月度分析报告接口测试。

覆盖：
- GET /api/monthly-report/{ym}        载入或自动初始化草稿
- PUT /api/monthly-report/{ym}/sections   分段保存（5 个段）
- POST /api/monthly-report/{ym}/archive   归档
- DELETE /api/monthly-report/{ym}/archive 取消归档
- DELETE /api/monthly-report/{ym}         草稿可删，归档不可删
- GET /api/monthly-report                 列表，可按 status 过滤
- 月份格式校验
- 已归档状态下编辑被拒绝
"""
from __future__ import annotations

import pytest


def _ym(year: int, month: int) -> str:
    return f"{year:04d}{month:02d}"


@pytest.fixture(scope="module")
def fresh_ym(api_client):
    """选取一个不易冲突的月份并清理后重新创建。"""
    candidates = ["209901", "209902", "209903"]
    chosen = None
    for ym in candidates:
        try:
            api_client.delete(f"/api/monthly-report/{ym}/archive")
        except Exception:
            pass
        api_client.delete(f"/api/monthly-report/{ym}")
        chosen = ym
        break
    yield chosen
    api_client.delete(f"/api/monthly-report/{chosen}/archive")
    api_client.delete(f"/api/monthly-report/{chosen}")


class TestMonthlyReportLoad:
    def test_tc_m14_001_get_initializes_draft(self, api_client, fresh_ym):
        resp = api_client.get(f"/api/monthly-report/{fresh_ym}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["report_month"] == fresh_ym
        assert body["status"] == "draft"
        # 5 段 JSON 字段都存在
        for col in ("section_overview", "section_insight", "section_major", "section_improve", "section_links"):
            assert col in body

    def test_tc_m14_002_get_idempotent(self, api_client, fresh_ym):
        a = api_client.get(f"/api/monthly-report/{fresh_ym}").json()
        b = api_client.get(f"/api/monthly-report/{fresh_ym}").json()
        assert a["report_month"] == b["report_month"]
        assert a["created_at"] == b["created_at"]

    def test_tc_m14_003_invalid_month_format(self, api_client):
        for bad in ("20260", "2026-04", "abcdef", "202613"):
            resp = api_client.get(f"/api/monthly-report/{bad}")
            assert resp.status_code == 400, bad


class TestMonthlyReportSectionSave:
    def test_tc_m14_010_save_overview(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "overview",
            "data": {
                "major_events": "test-events",
                "problem_analysis": "test-analysis",
                "risk_modules": "test-risk",
                "quality_feedback": "test-feedback",
            },
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["section_overview"]["major_events"] == "test-events"

    def test_tc_m14_011_save_insight_with_charts(self, api_client, fresh_ym):
        payload = {
            "section": "insight",
            "data": {
                "kpi": {"total_count": 100, "known_count": 60, "new_count": 40, "pansh_count": 20, "pansh_total": 80},
                "known_ratio": [{"name": "已知", "value": 60}, {"name": "新发现", "value": 40}],
                "pansh_ratio": [{"name": "磐石", "value": 20}, {"name": "非磐石", "value": 60}],
                "impact_categories": [{"name": "性能", "value": 30}],
                "top_modules": [{"name": "SQL", "value": 25}],
                "top1_breakdown": [{"name": "子项A", "value": 10}],
                "top2_breakdown": [{"name": "子项A", "value": 8}],
            },
        }
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json=payload)
        assert resp.status_code == 200
        assert resp.json()["section_insight"]["kpi"]["total_count"] == 100

    def test_tc_m14_012_save_major_5_types(self, api_client, fresh_ym):
        types = {
            "fatal": [{"序号": "1", "DTS单号": "DTS001"}],
            "severe": [],
            "normal": [],
            "escalation": [{"序号": "1", "备注": "升级到P0"}],
            "incident": [],
        }
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "major", "data": {"types": types},
        })
        assert resp.status_code == 200
        body = resp.json()["section_major"]
        assert body["types"]["fatal"][0]["DTS单号"] == "DTS001"
        assert body["types"]["escalation"][0]["备注"] == "升级到P0"

    def test_tc_m14_013_save_improve(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "improve",
            "data": {
                "module_distribution": [{"name": "SQL", "value": 12}],
                "sql_items": [{"name": "执行计划稳定性", "value": 6}],
                "storage_items": [{"name": "压缩", "value": 3}],
                "new_requests": [{"序号": "1", "模块": "SQL", "改进诉求": "优化器", "提出人": "张三", "状态": "待评估"}],
            },
        })
        assert resp.status_code == 200
        assert resp.json()["section_improve"]["new_requests"][0]["模块"] == "SQL"

    def test_tc_m14_014_save_links(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "links",
            "data": {"items": [{"name": "在线明细", "url": "http://example.com/sheet/1"}]},
        })
        assert resp.status_code == 200
        assert resp.json()["section_links"]["items"][0]["url"] == "http://example.com/sheet/1"

    def test_tc_m14_015_unknown_section_rejected(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "bogus", "data": {},
        })
        assert resp.status_code == 400


class TestMonthlyReportArchive:
    def test_tc_m14_020_archive(self, api_client, fresh_ym):
        resp = api_client.post(f"/api/monthly-report/{fresh_ym}/archive", json={"title": ""})
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "archived"
        assert body["archived_at"] is not None
        assert body["title"]  # 默认填 "{ym}月报"

    def test_tc_m14_021_archived_section_not_editable(self, api_client, fresh_ym):
        resp = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "overview", "data": {"major_events": "x"},
        })
        assert resp.status_code == 409

    def test_tc_m14_022_archived_cannot_delete(self, api_client, fresh_ym):
        resp = api_client.delete(f"/api/monthly-report/{fresh_ym}")
        assert resp.status_code == 409

    def test_tc_m14_023_unarchive(self, api_client, fresh_ym):
        resp = api_client.delete(f"/api/monthly-report/{fresh_ym}/archive")
        assert resp.status_code == 200
        assert resp.json()["status"] == "draft"
        # 解除归档后重新可保存
        resp2 = api_client.put(f"/api/monthly-report/{fresh_ym}/sections", json={
            "section": "overview", "data": {"major_events": "after-unarchive"},
        })
        assert resp2.status_code == 200


class TestMonthlyReportList:
    def test_tc_m14_030_list_contains_current(self, api_client, fresh_ym):
        # 重新归档以验证 status 过滤
        api_client.post(f"/api/monthly-report/{fresh_ym}/archive", json={"title": ""})
        resp = api_client.get("/api/monthly-report?status=archived")
        assert resp.status_code == 200
        items = resp.json()["items"]
        months = [it["report_month"] for it in items]
        assert fresh_ym in months

    def test_tc_m14_031_list_status_invalid(self, api_client):
        resp = api_client.get("/api/monthly-report?status=foo")
        assert resp.status_code == 400
