#!/usr/bin/env python3
"""
重大问题模块测试独立运行脚本
不依赖 conftest.py，直接运行测试用例
"""

import httpx
import sys
import os
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

class TestRunner:
    def __init__(self):
        self.client = httpx.Client(base_url=BASE_URL, timeout=30.0)
        self.passed = 0
        self.failed = 0
        self.results = []

    def close(self):
        self.client.close()

    def setup(self):
        """确保测试用户存在"""
        self.client.post("/api/admin/users/bulk", json={
            "items": [{
                "account": OPERATOR_ID,
                "user_name": "测试用户",
                "role_code": "admin",
                "group_name": "测试组",
                "is_active": True,
            }],
            "operator_id": "admin",
        })

    def cleanup(self):
        """清理测试数据"""
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=100")
        if r.status_code == 200:
            items = r.json().get("items", [])
            for item in items:
                if item.get("creator_id") == OPERATOR_ID:
                    self.client.delete(f"/api/major-problems/{item['id']}?operator_id={OPERATOR_ID}")

    def run_test(self, name, func):
        """运行单个测试"""
        try:
            func()
            self.passed += 1
            self.results.append((name, True, ""))
            print(f"✅ {name}")
        except AssertionError as e:
            self.failed += 1
            error_msg = str(e) or "Assertion failed (no message)"
            self.results.append((name, False, error_msg))
            print(f"❌ {name}: {error_msg}")
        except Exception as e:
            self.failed += 1
            error_msg = f"{type(e).__name__}: {str(e)}"
            self.results.append((name, False, error_msg))
            print(f"❌ {name}: {error_msg}")

    def create_test_record(self):
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
        r = self.client.post("/api/major-problems", json=payload)
        assert r.status_code == 200, f"创建失败: status={r.status_code}, response={r.text[:200]}"
        return r.json()

    # 测试1-5：列表和分页
    def test_01_list_all_success(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert data["total"] >= 0

    def test_02_pagination_page_size(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=5")
        assert r.status_code == 200
        data = r.json()
        assert len(data.get("items", [])) <= 5
        assert data.get("page_size") == 5

    def test_03_pagination_page_number(self):
        r1 = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=1&page_size=10")
        r2 = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&page=2&page_size=5")
        assert r1.status_code == 200
        assert r2.status_code == 200
        data1 = r1.json()
        data2 = r2.json()
        assert data1.get("page") == 1
        assert data2.get("page") == 2

    def test_04_pagination_default_params(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert data.get("page") == 1
        assert data.get("page_size") == 10

    def test_05_period_all(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=all&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data

    # 测试6-9：时间筛选
    def test_06_period_day(self):
        today = date.today().isoformat()
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=day&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        if items:
            for item in items:
                assert item.get("report_date") == today

    def test_07_period_week(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=week&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "total" in data

    def test_08_period_month(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&period=month&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert data.get("total") >= 0

    def test_09_period_custom_range(self):
        start_date = date.today() - timedelta(days=10)
        end_date = date.today()
        r = self.client.get(
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
                if report_date:
                    assert start_date.isoformat() <= report_date <= end_date.isoformat()

    # 测试10-13：搜索功能
    def test_10_search_by_keyword(self):
        record = self.create_test_record()
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q=测试&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data

    def test_11_search_by_problem_no(self):
        record = self.create_test_record()
        problem_no = record.get("problem_no", "")
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q={problem_no}&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        found = any(item.get("problem_no") == problem_no for item in items)
        assert found

    def test_12_search_by_site_name(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q=数据中心&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", [])
        has_match = any("数据中心" in str(item.get("site_name", "")) for item in items)
        assert has_match or len(items) == 0

    def test_13_search_empty_result(self):
        r = self.client.get(f"/api/major-problems?operator_id={OPERATOR_ID}&q=不存在关键词999&page=1&page_size=10")
        assert r.status_code == 200
        data = r.json()
        assert data.get("total") == 0
        assert len(data.get("items", [])) == 0

    # 测试14-17：新增功能
    def test_14_create_success(self):
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": "新建测试局点",
            "problem_type": "安全问题",
            "description": "这是一个安全问题描述",
            "status": "待处理",
        }
        r = self.client.post("/api/major-problems", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "problem_no" in data
        assert data.get("site_name") == "新建测试局点"
        assert data.get("problem_type") == "安全问题"
        assert data.get("status") == "待处理"

    def test_15_create_all_fields(self):
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
        r = self.client.post("/api/major-problems", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data.get("root_cause") == "全字段测试根因"
        assert data.get("feature_category") == "高可用"
        assert data.get("impact_category") == "业务中断"

    def test_16_create_missing_required(self):
        payload = {"operator_id": OPERATOR_ID}
        r = self.client.post("/api/major-problems", json=payload)
        assert r.status_code == 400

    def test_17_create_invalid_status(self):
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": "无效状态测试",
            "problem_type": "性能问题",
            "description": "测试描述",
            "status": "无效状态值",
        }
        r = self.client.post("/api/major-problems", json=payload)
        assert r.status_code == 400

    # 测试18-20：详情查看
    def test_18_get_detail_success(self):
        record = self.create_test_record()
        problem_id = record.get("id")
        r = self.client.get(f"/api/major-problems/{problem_id}?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        assert data.get("id") == problem_id
        assert data.get("problem_no") == record.get("problem_no")

    def test_19_get_detail_not_found(self):
        r = self.client.get(f"/api/major-problems/999999?operator_id={OPERATOR_ID}")
        assert r.status_code == 404

    def test_20_get_detail_all_fields(self):
        record = self.create_test_record()
        problem_id = record.get("id")
        r = self.client.get(f"/api/major-problems/{problem_id}?operator_id={OPERATOR_ID}")
        assert r.status_code == 200
        data = r.json()
        required_fields = [
            "id", "report_date", "ops_order_no", "problem_no", "site_name",
            "problem_type", "description", "status", "creator_id", "creator_name",
        ]
        for field in required_fields:
            assert field in data


def main():
    print("=" * 60)
    print("重大问题管理模块测试（20个用例）")
    print("=" * 60)
    print()

    runner = TestRunner()
    
    # 检查服务是否运行
    try:
        r = runner.client.get("/health", timeout=5)
        if r.status_code != 200:
            print("❌ 后端服务未正常运行")
            runner.close()
            return 1
    except Exception as e:
        print(f"❌ 无法连接后端服务: {e}")
        runner.close()
        return 1

    print("后端服务正常运行，开始测试...\n")
    runner.setup()

    # 运行所有测试
    tests = [
        # 列表和分页
        ("test_01_list_all_success", runner.test_01_list_all_success),
        ("test_02_pagination_page_size", runner.test_02_pagination_page_size),
        ("test_03_pagination_page_number", runner.test_03_pagination_page_number),
        ("test_04_pagination_default_params", runner.test_04_pagination_default_params),
        ("test_05_period_all", runner.test_05_period_all),
        # 时间筛选
        ("test_06_period_day", runner.test_06_period_day),
        ("test_07_period_week", runner.test_07_period_week),
        ("test_08_period_month", runner.test_08_period_month),
        ("test_09_period_custom_range", runner.test_09_period_custom_range),
        # 搜索功能
        ("test_10_search_by_keyword", runner.test_10_search_by_keyword),
        ("test_11_search_by_problem_no", runner.test_11_search_by_problem_no),
        ("test_12_search_by_site_name", runner.test_12_search_by_site_name),
        ("test_13_search_empty_result", runner.test_13_search_empty_result),
        # 新增功能
        ("test_14_create_success", runner.test_14_create_success),
        ("test_15_create_all_fields", runner.test_15_create_all_fields),
        ("test_16_create_missing_required", runner.test_16_create_missing_required),
        ("test_17_create_invalid_status", runner.test_17_create_invalid_status),
        # 详情查看
        ("test_18_get_detail_success", runner.test_18_get_detail_success),
        ("test_19_get_detail_not_found", runner.test_19_get_detail_not_found),
        ("test_20_get_detail_all_fields", runner.test_20_get_detail_all_fields),
    ]

    for name, func in tests:
        runner.run_test(name, func)

    # 清理
    runner.cleanup()
    runner.close()

    # 输出结果
    print()
    print("=" * 60)
    print(f"测试结果: 通过 {runner.passed}/20, 失败 {runner.failed}/20")
    
    if runner.failed > 0:
        print("\n失败的测试:")
        for name, success, error in runner.results:
            if not success:
                print(f"  - {name}: {error[:50]}")
    print("=" * 60)
    
    return 0 if runner.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())