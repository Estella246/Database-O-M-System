#!/usr/bin/env python3
"""
重大问题管理模块完整测试用例（20个）
覆盖场景：列表、分页、时间筛选、搜索、新增、详情、导出、配置管理、更新、删除
"""

import pytest
import os
import sys
from datetime import datetime, date, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"

sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

os.environ["SKIP_SSO_AUTH"] = "1"

BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")
OPERATOR_ID = "test_major_problem_user"


@pytest.fixture(scope="module")
def api_client():
    import httpx
    client = httpx.Client(base_url=BASE_URL, timeout=30.0)
    yield client
    client.close()


@pytest.fixture(scope="module", autouse=True)
def setup_test_user(api_client):
    """确保测试用户存在"""
    api_client.post("/api/admin/users/bulk", json={
        "items": [{
            "account": OPERATOR_ID,
            "user_name": "测试用户",
            "role_code": "admin",
            "is_active": True,
        }],
        "operator_id": "admin",
    })
    yield OPERATOR_ID


@pytest.fixture(scope="module", autouse=True)
def cleanup_test_data(api_client, setup_test_user):
    """清理测试数据"""
    yield
    r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=100")
    if r.status_code == 200:
        items = r.json().get("items", [])
        for item in items:
            if item.get("creator_id") == OPERATOR_ID:
                api_client.delete(f"/api/major-problems/{item['id']}?operator_id={OPERATOR_ID}")


@pytest.fixture(scope="function")
def create_test_record(api_client, setup_test_user):
    """创建一条测试记录"""
    payload = {
        "operator_id": OPERATOR_ID,
        "report_date": date.today().isoformat(),
        "ops_order_no": f"OPS_TEST_{datetime.now().strftime('%H%M%S')}",
        "site_name": "测试数据中心",
        "problem_type": "性能问题",
        "description": "这是一个测试问题描述",
        "root_cause": "测试根因",
        "solution": "测试解决方案",
        "root_cause_category": "数据库优化",
        "feature_category": "查询性能",
        "impact_category": "性能影响",
        "kernel_version": "V5.2.1",
        "dts_bug_no": f"DTS{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "status": "待处理",
    }
    r = api_client.post("/api/major-problems", json=payload)
    assert r.status_code == 200
    record = r.json()
    return record


class TestMajorProblemListAndPagination:
    """测试组1：列表加载和分页"""

    def test_01_list_all_success(self, api_client, setup_test_user):
        """测试01: 获取全部列表成功"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert data["total"] >= 0

    def test_02_pagination_page_size(self, api_client, setup_test_user):
        """测试02: 分页功能-指定每页5条"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=5")
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) <= 5
        assert data["page_size"] == 5

    def test_03_pagination_page_number(self, api_client, setup_test_user, create_test_record):
        """测试03: 分页功能-指定页数"""
        r1 = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=10")
        r2 = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=2&page_size=5")
        assert r1.status_code == 200
        assert r2.status_code == 200
        data1 = r1.json()
        data2 = r2.json()
        assert data1["page"] == 1
        assert data2["page"] == 2

    def test_04_pagination_default_params(self, api_client, setup_test_user):
        """测试04: 分页默认参数"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert data["page"] == 1
        assert data["page_size"] == 10


class TestMajorProblemTimeFilter:
    """测试组2：时间筛选"""

    def test_05_period_all(self, api_client, setup_test_user):
        """测试05: 时间筛选-全部"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=all&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data

    def test_06_period_day(self, api_client, setup_test_user, create_test_record):
        """测试06: 时间筛选-今日"""
        today = date.today().isoformat()
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=day&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        if items:
            for item in items:
                assert item.get("report_date") == today

    def test_07_period_week(self, api_client, setup_test_user):
        """测试07: 时间筛选-本周"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=week&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "total" in data

    def test_08_period_month(self, api_client, setup_test_user):
        """测试08: 时间筛选-本月"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=month&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 0

    def test_09_period_custom_range(self, api_client, setup_test_user):
        """测试09: 时间筛选-自定义范围"""
        start_date = date.today() - timedelta(days=10)
        end_date = date.today()
        r = api_client.get(
            f"/api/major-problems?operator_id={OPERATOR_ID}&period=custom"
            f"&start_date={start_date.isoformat()}&end_date={end_date.isoformat()}"
            f"&page=1&page_size=10"
        )
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        if items:
            for item in items:
                report_date = item.get("report_date")
                assert start_date.isoformat() <= report_date <= end_date.isoformat()


class TestMajorProblemSearch:
    """测试组3：搜索功能"""

    def test_10_search_by_keyword(self, api_client, setup_test_user, create_test_record):
        """测试10: 关键词搜索"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q=测试&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data

    def test_11_search_by_problem_no(self, api_client, setup_test_user, create_test_record):
        """测试11: 按问题编号搜索"""
        problem_no = create_test_record.get("problem_no", "")
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q={problem_no}&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        found = any(item.get("problem_no") == problem_no for item in items)
        assert found

    def test_12_search_by_site_name(self, api_client, setup_test_user, create_test_record):
        """测试12: 按局点名称搜索"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q=数据中心&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        has_match = any("数据中心" in str(item.get("site_name", "")) for item in items)
        assert has_match

    def test_13_search_empty_result(self, api_client, setup_test_user):
        """测试13: 搜索无结果"""
        r = api_client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q=不存在关键词999999&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0
        assert len(data["items"]) == 0


class TestMajorProblemCreate:
    """测试组4：新增重大问题"""

    def test_14_create_success(self, api_client, setup_test_user):
        """测试14: 创建成功"""
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": "新建测试局点",
            "problem_type": "安全问题",
            "description": "这是一个安全问题描述",
            "status": "待处理",
        }
        r = api_client.post("/api/major-problems", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "problem_no" in data
        assert data.get("site_name") == "新建测试局点"
        assert data.get("problem_type") == "安全问题"
        assert data.get("status") == "待处理"

    def test_15_create_all_fields(self, api_client, setup_test_user):
        """测试15: 创建包含所有字段"""
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "ops_order_no": "OPS_FULL_TEST",
            "site_name": "全字段测试局点",
            "problem_type": "可用性问题",
            "description": "全字段测试描述",
            "root_cause": "全字段测试根因",
            "solution": "全字段测试解决方案",
            "root_cause_category": "配置错误",
            "feature_category": "高可用",
            "impact_category": "业务中断",
            "kernel_version": "V6.0.0",
            "dts_bug_no": "DTS_FULL_TEST",
            "status": "处理中",
        }
        r = api_client.post("/api/major-problems", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data.get("root_cause_category") == "配置错误"
        assert data.get("feature_category") == "高可用"
        assert data.get("impact_category") == "业务中断"

    def test_16_create_missing_required_field(self, api_client, setup_test_user):
        """测试16: 创建缺少必填字段"""
        payload = {
            "operator_id": OPERATOR_ID,
        }
        r = api_client.post("/api/major-problems", json=payload)
        assert r.status_code == 400

    def test_17_create_invalid_status(self, api_client, setup_test_user):
        """测试17: 创建无效状态"""
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": "无效状态测试",
            "problem_type": "性能问题",
            "description": "测试描述",
            "status": "无效状态值",
        }
        r = api_client.post("/api/major-problems", json=payload)
        assert r.status_code == 400


class TestMajorProblemDetail:
    """测试组5：详情查看"""

    def test_18_get_detail_success(self, api_client, setup_test_user, create_test_record):
        """测试18: 获取详情成功"""
        problem_id = create_test_record.get("id")
        r = api_client.get(f"/api/major-problems/{problem_id}?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert data.get("id") == problem_id
        assert data.get("problem_no") == create_test_record.get("problem_no")

    def test_19_get_detail_not_found(self, api_client, setup_test_user):
        """测试19: 获取详情-404"""
        r = api_client.get(f"/api/major-problems/999999?operator_id={OPERATOR_ID}")
        assert r.status_code == 404

    def test_20_get_detail_all_fields(self, api_client, setup_test_user, create_test_record):
        """测试20: 获取详情包含所有字段"""
        problem_id = create_test_record.get("id")
        r = api_client.get(f"/api/major-problems/{problem_id}?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        required_fields = [
            "id", "report_date", "ops_order_no", "problem_no", "site_name",
            "problem_type", "description", "status", "creator_id", "creator_name",
        ]
        for field in required_fields:
            assert field in data


class TestMajorProblemUpdate:
    """测试组6：更新功能"""

    def test_21_update_status_success(self, api_client, setup_test_user, create_test_record):
        """测试21: 更新状态成功"""
        problem_id = create_test_record.get("id")
        payload = {
            "operator_id": OPERATOR_ID,
            "status": "处理中",
        }
        r = api_client.patch(f"/api/major-problems/{problem_id}", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "处理中"

    def test_22_update_multiple_fields(self, api_client, setup_test_user, create_test_record):
        """测试22: 更新多个字段"""
        problem_id = create_test_record.get("id")
        payload = {
            "operator_id": OPERATOR_ID,
            "status": "已解决",
            "solution": "更新后的解决方案",
            "root_cause": "更新后的根因分析",
        }
        r = api_client.patch(f"/api/major-problems/{problem_id}", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "已解决"
        assert data.get("solution") == "更新后的解决方案"

    def test_23_update_not_found(self, api_client, setup_test_user):
        """测试23: 更新不存在的记录"""
        payload = {
            "operator_id": OPERATOR_ID,
            "status": "处理中",
        }
        r = api_client.patch(f"/api/major-problems/999999", json=payload)
        assert r.status_code == 404

    def test_24_update_no_fields(self, api_client, setup_test_user, create_test_record):
        """测试24: 更新无字段"""
        problem_id = create_test_record.get("id")
        payload = {
            "operator_id": OPERATOR_ID,
        }
        r = api_client.patch(f"/api/major-problems/{problem_id}", json=payload)
        assert r.status_code == 400


class TestMajorProblemDelete:
    """测试组7：删除功能"""

    def test_25_delete_success(self, api_client, setup_test_user):
        """测试25: 删除记录成功"""
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": "待删除局点",
            "problem_type": "安全问题",
            "description": "待删除测试记录",
        }
        r1 = api_client.post("/api/major-problems", json=payload)
        assert r1.status_code == 200
        problem_id = r1.json().get("id")
        
        r2 = api_client.delete(f"/api/major-problems/{problem_id}?operator_id={OPERATOR_ID}")
        assert r2.status_code == 200
        assert r2.json().get("deleted") is True

    def test_26_delete_not_found(self, api_client, setup_test_user):
        """测试26: 删除不存在的记录"""
        r = api_client.delete(f"/api/major-problems/999999?operator_id={OPERATOR_ID}")
        assert r.status_code == 404


class TestMajorProblemExport:
    """测试组8：导出功能"""

    def test_27_export_all(self, api_client, setup_test_user):
        """测试27: 导出全部数据"""
        r = api_client.get(f"/api/major-problems/export?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data

    def test_28_export_with_search(self, api_client, setup_test_user, create_test_record):
        """测试28: 导出带搜索条件"""
        r = api_client.get(f"/api/major-problems/export?operator_id={OPERATOR_ID}&q=测试")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        assert isinstance(items, list)

    def test_29_export_with_period(self, api_client, setup_test_user):
        """测试29: 导出带时间筛选"""
        r = api_client.get(f"/api/major-problems/export?operator_id={OPERATOR_ID}&period=month")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 0


class TestMajorProblemConfig:
    """测试组9：配置字段管理"""

    def test_30_config_list_success(self, api_client, setup_test_user):
        """测试30: 获取配置列表成功"""
        r = api_client.get(f"/api/major-problems/config?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data

    def test_31_config_all_list(self, api_client, setup_test_user):
        """测试31: 获取全部配置列表（含未启用）"""
        r = api_client.get(f"/api/major-problems/config/all?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data

    def test_32_config_create_success(self, api_client, setup_test_user):
        """测试32: 创建配置字段成功"""
        payload = {
            "operator_id": OPERATOR_ID,
            "field_key": f"test_field_{datetime.now().strftime('%H%M%S')}",
            "field_label": "测试字段",
            "field_type": "text",
            "field_options": [],
            "is_required": False,
            "is_active": True,
            "sort_order": 0,
        }
        r = api_client.post("/api/major-problems/config", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data.get("field_key") == payload["field_key"]
        assert data.get("field_label") == "测试字段"

    def test_33_config_duplicate_key(self, api_client, setup_test_user):
        """测试33: 创建重复field_key配置"""
        field_key = f"duplicate_test_{datetime.now().strftime('%H%M%S')}"
        payload1 = {
            "operator_id": OPERATOR_ID,
            "field_key": field_key,
            "field_label": "重复字段1",
            "field_type": "text",
        }
        r1 = api_client.post("/api/major-problems/config", json=payload1)
        if r1.status_code == 200:
            payload2 = {
                "operator_id": OPERATOR_ID,
                "field_key": field_key,
                "field_label": "重复字段2",
                "field_type": "text",
            }
            r2 = api_client.post("/api/major-problems/config", json=payload2)
            assert r2.status_code == 400

    def test_34_config_update_success(self, api_client, setup_test_user):
        """测试34: 更新配置字段成功"""
        payload = {
            "operator_id": OPERATOR_ID,
            "field_key": f"update_test_{datetime.now().strftime('%H%M%S')}",
            "field_label": "待更新字段",
            "field_type": "text",
        }
        r1 = api_client.post("/api/major-problems/config", json=payload)
        assert r1.status_code == 200
        config_id = r1.json().get("id")
        
        update_payload = {
            "operator_id": OPERATOR_ID,
            "field_label": "已更新字段",
            "is_active": True,
        }
        r2 = api_client.patch(f"/api/major-problems/config/{config_id}", json=update_payload)
        assert r2.status_code == 200
        data = r2.json()
        assert data.get("field_label") == "已更新字段"

    def test_35_config_delete_success(self, api_client, setup_test_user):
        """测试35: 删除配置字段成功"""
        payload = {
            "operator_id": OPERATOR_ID,
            "field_key": f"delete_test_{datetime.now().strftime('%H%M%S')}",
            "field_label": "待删除字段",
            "field_type": "text",
        }
        r1 = api_client.post("/api/major-problems/config", json=payload)
        assert r1.status_code == 200
        config_id = r1.json().get("id")
        
        r2 = api_client.delete(f"/api/major-problems/config/{config_id}?operator_id={OPERATOR_ID}")
        assert r2.status_code == 200
        assert r2.json().get("deleted") is True