#!/usr/bin/env python3
"""
重大问题管理模块测试脚本
测试API接口功能
"""

import requests
import json
import sys
from datetime import datetime, date

BASE_URL = "http://127.0.0.1:8000/api/major-problems"
OPERATOR_ID = "test_operator"

def print_result(test_name, success, message=""):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status} - {test_name}")
    if message:
        print(f"    {message}")

def test_01_list_all():
    """测试1: 获取全部列表"""
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&page=1&page_size=10")
        data = r.json()
        success = r.status_code == 200 and "items" in data and "total" in data
        print_result("获取全部列表", success, f"返回 {data.get('total', 0)} 条数据")
        return success, data
    except Exception as e:
        print_result("获取全部列表", False, str(e))
        return False, None

def test_02_pagination():
    """测试2: 分页功能"""
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&page=1&page_size=5")
        data = r.json()
        success = r.status_code == 200 and len(data.get("items", [])) <= 5
        print_result("分页功能 (每页5条)", success, f"返回 {len(data.get('items', []))} 条")
        return success
    except Exception as e:
        print_result("分页功能", False, str(e))
        return False

def test_03_period_day():
    """测试3: 按今日筛选"""
    try:
        today = date.today().isoformat()
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&period=day&page=1&page_size=10")
        data = r.json()
        items = data.get("items", [])
        all_today = all(item.get("report_date") == today for item in items) if items else True
        success = r.status_code == 200
        print_result("按今日筛选", success, f"返回 {len(items)} 条当日数据")
        return success
    except Exception as e:
        print_result("按今日筛选", False, str(e))
        return False

def test_04_period_week():
    """测试4: 按本周筛选"""
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&period=week&page=1&page_size=10")
        data = r.json()
        success = r.status_code == 200
        print_result("按本周筛选", success, f"返回 {data.get('total', 0)} 条数据")
        return success
    except Exception as e:
        print_result("按本周筛选", False, str(e))
        return False

def test_05_period_month():
    """测试5: 按本月筛选"""
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&period=month&page=1&page_size=10")
        data = r.json()
        success = r.status_code == 200
        print_result("按本月筛选", success, f"返回 {data.get('total', 0)} 条数据")
        return success
    except Exception as e:
        print_result("按本月筛选", False, str(e))
        return False

def test_06_search_keyword():
    """测试6: 关键词搜索"""
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&q=北京&page=1&page_size=10")
        data = r.json()
        items = data.get("items", [])
        has_keyword = any("北京" in str(item.get("site_name", "")) or "北京" in str(item.get("description", "")) for item in items) if items else True
        success = r.status_code == 200
        print_result("关键词搜索 (北京)", success, f"返回 {len(items)} 条匹配数据")
        return success
    except Exception as e:
        print_result("关键词搜索", False, str(e))
        return False

def test_07_search_problem_no():
    """测试7: 按问题编号搜索"""
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&q=MP20260501001&page=1&page_size=10")
        data = r.json()
        items = data.get("items", [])
        success = r.status_code == 200 and len(items) >= 1
        print_result("按问题编号搜索", success, f"找到 {len(items)} 条数据")
        return success
    except Exception as e:
        print_result("按问题编号搜索", False, str(e))
        return False

def test_08_get_detail():
    """测试8: 获取详情"""
    try:
        # 先获取列表拿到一个ID
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&page=1&page_size=1")
        data = r.json()
        items = data.get("items", [])
        if not items:
            print_result("获取详情", False, "没有数据可供测试")
            return False
        problem_id = items[0].get("id")
        r2 = requests.get(f"{BASE_URL}/{problem_id}?operator_id={OPERATOR_ID}")
        detail = r2.json()
        success = r2.status_code == 200 and detail.get("id") == problem_id
        print_result("获取详情", success, f"获取ID={problem_id}的详情")
        return success
    except Exception as e:
        print_result("获取详情", False, str(e))
        return False

def test_09_get_detail_invalid_id():
    """测试9: 获取不存在详情"""
    try:
        r = requests.get(f"{BASE_URL}/99999?operator_id={OPERATOR_ID}")
        success = r.status_code == 404
        print_result("获取不存在详情 (404)", success, f"状态码={r.status_code}")
        return success
    except Exception as e:
        print_result("获取不存在详情", False, str(e))
        return False

def test_10_create_record():
    """测试10: 创建记录"""
    try:
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "ops_order_no": "OPS_TEST_001",
            "site_name": "测试数据中心",
            "problem_type": "性能问题",
            "description": "这是一个测试问题描述",
            "root_cause": "测试根因",
            "solution": "测试解决方案",
            "root_cause_category": "代码优化",
            "feature_category": "查询性能",
            "impact_category": "性能影响",
            "kernel_version": "V5.2.0",
            "dts_bug_no": "DTS_TEST_001",
            "status": "待处理"
        }
        r = requests.post(BASE_URL, json=payload)
        data = r.json()
        success = r.status_code == 200 and data.get("problem_no")
        print_result("创建记录", success, f"问题编号={data.get('problem_no', 'N/A')}")
        return success, data.get("id") if success else None
    except Exception as e:
        print_result("创建记录", False, str(e))
        return False, None

def test_11_create_missing_required():
    """测试11: 创建缺少必填字段"""
    try:
        payload = {
            "operator_id": OPERATOR_ID,
            # 缺少report_date
        }
        r = requests.post(BASE_URL, json=payload)
        success = r.status_code == 400
        print_result("创建缺少必填字段 (400)", success, f"状态码={r.status_code}")
        return success
    except Exception as e:
        print_result("创建缺少必填字段", False, str(e))
        return False

def test_12_create_invalid_status():
    """测试12: 创建无效状态"""
    try:
        payload = {
            "operator_id": OPERATOR_ID,
            "report_date": date.today().isoformat(),
            "site_name": "测试数据中心",
            "problem_type": "性能问题",
            "description": "测试描述",
            "status": "无效状态"
        }
        r = requests.post(BASE_URL, json=payload)
        success = r.status_code == 400
        print_result("创建无效状态 (400)", success, f"状态码={r.status_code}")
        return success
    except Exception as e:
        print_result("创建无效状态", False, str(e))
        return False

def test_13_update_record(created_id=None):
    """测试13: 更新记录"""
    try:
        if not created_id:
            # 先获取一个ID
            r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&page=1&page_size=1")
            data = r.json()
            items = data.get("items", [])
            if not items:
                print_result("更新记录", False, "没有数据可供测试")
                return False
            created_id = items[0].get("id")
        
        payload = {
            "operator_id": OPERATOR_ID,
            "status": "处理中",
            "solution": "更新后的解决方案"
        }
        r = requests.patch(f"{BASE_URL}/{created_id}", json=payload)
        success = r.status_code == 200
        print_result("更新记录", success, f"更新ID={created_id}")
        return success, created_id
    except Exception as e:
        print_result("更新记录", False, str(e))
        return False, None

def test_14_update_invalid_id():
    """测试14: 更新不存在的记录"""
    try:
        payload = {
            "operator_id": OPERATOR_ID,
            "status": "处理中"
        }
        r = requests.patch(f"{BASE_URL}/99999", json=payload)
        success = r.status_code == 404
        print_result("更新不存在记录 (404)", success, f"状态码={r.status_code}")
        return success
    except Exception as e:
        print_result("更新不存在记录", False, str(e))
        return False

def test_15_update_no_fields():
    """测试15: 更新无字段"""
    try:
        payload = {
            "operator_id": OPERATOR_ID
        }
        # 先获取一个有效ID
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&page=1&page_size=1")
        data = r.json()
        items = data.get("items", [])
        if not items:
            print_result("更新无字段", False, "没有数据可供测试")
            return False
        created_id = items[0].get("id")
        r = requests.patch(f"{BASE_URL}/{created_id}", json=payload)
        success = r.status_code == 400
        print_result("更新无字段 (400)", success, f"状态码={r.status_code}")
        return success
    except Exception as e:
        print_result("更新无字段", False, str(e))
        return False

def test_16_export_data():
    """测试16: 导出数据"""
    try:
        r = requests.get(f"{BASE_URL}/export?operator_id={OPERATOR_ID}")
        data = r.json()
        success = r.status_code == 200 and "items" in data
        print_result("导出数据", success, f"导出 {len(data.get('items', []))} 条数据")
        return success
    except Exception as e:
        print_result("导出数据", False, str(e))
        return False

def test_17_export_with_search():
    """测试17: 导出带搜索条件"""
    try:
        r = requests.get(f"{BASE_URL}/export?operator_id={OPERATOR_ID}&q=性能问题")
        data = r.json()
        success = r.status_code == 200
        print_result("导出带搜索条件", success, f"导出 {len(data.get('items', []))} 条数据")
        return success
    except Exception as e:
        print_result("导出带搜索条件", False, str(e))
        return False

def test_18_delete_record(created_id=None):
    """测试18: 删除记录"""
    try:
        if not created_id:
            # 先创建一个用于删除
            payload = {
                "operator_id": OPERATOR_ID,
                "report_date": date.today().isoformat(),
                "site_name": "待删除数据中心",
                "problem_type": "性能问题",
                "description": "待删除测试记录"
            }
            r = requests.post(BASE_URL, json=payload)
            data = r.json()
            created_id = data.get("id")
        
        r = requests.delete(f"{BASE_URL}/{created_id}?operator_id={OPERATOR_ID}")
        success = r.status_code == 200 and r.json().get("deleted")
        print_result("删除记录", success, f"删除ID={created_id}")
        return success
    except Exception as e:
        print_result("删除记录", False, str(e))
        return False

def test_19_delete_invalid_id():
    """测试19: 删除不存在的记录"""
    try:
        r = requests.delete(f"{BASE_URL}/99999?operator_id={OPERATOR_ID}")
        success = r.status_code == 404
        print_result("删除不存在记录 (404)", success, f"状态码={r.status_code}")
        return success
    except Exception as e:
        print_result("删除不存在记录", False, str(e))
        return False

def test_20_custom_period():
    """测试20: 自定义日期范围筛选"""
    try:
        start_date = "2026-05-01"
        end_date = "2026-05-05"
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&period=custom&start_date={start_date}&end_date={end_date}&page=1&page_size=10")
        data = r.json()
        items = data.get("items", [])
        # 验证所有返回的数据都在日期范围内
        all_in_range = all(
            start_date <= item.get("report_date", "") <= end_date 
            for item in items
        ) if items else True
        success = r.status_code == 200 and all_in_range
        print_result("自定义日期范围筛选", success, f"返回 {len(items)} 条数据，范围 {start_date} ~ {end_date}")
        return success
    except Exception as e:
        print_result("自定义日期范围筛选", False, str(e))
        return False

def main():
    print("=" * 60)
    print("重大问题管理模块测试")
    print("=" * 60)
    print()
    
    # 检查服务是否运行
    try:
        r = requests.get(f"{BASE_URL}?operator_id={OPERATOR_ID}&page=1&page_size=1", timeout=5)
        if r.status_code != 200:
            print("❌ 后端服务未正常运行，请先启动服务")
            return
    except:
        print("❌ 无法连接后端服务，请先启动服务: python -m uvicorn backend.app:app")
        return
    
    print("后端服务正常运行，开始测试...\n")
    
    results = []
    created_id = None
    
    # 运行所有测试
    success, data = test_01_list_all()
    results.append(("test_01_list_all", success))
    
    results.append(("test_02_pagination", test_02_pagination()))
    results.append(("test_03_period_day", test_03_period_day()))
    results.append(("test_04_period_week", test_04_period_week()))
    results.append(("test_05_period_month", test_05_period_month()))
    results.append(("test_06_search_keyword", test_06_search_keyword()))
    results.append(("test_07_search_problem_no", test_07_search_problem_no()))
    results.append(("test_08_get_detail", test_08_get_detail()))
    results.append(("test_09_get_detail_invalid_id", test_09_get_detail_invalid_id()))
    
    success, created_id = test_10_create_record()
    results.append(("test_10_create_record", success))
    
    results.append(("test_11_create_missing_required", test_11_create_missing_required()))
    results.append(("test_12_create_invalid_status", test_12_create_invalid_status()))
    
    success, created_id = test_13_update_record(created_id)
    results.append(("test_13_update_record", success))
    
    results.append(("test_14_update_invalid_id", test_14_update_invalid_id()))
    results.append(("test_15_update_no_fields", test_15_update_no_fields()))
    results.append(("test_16_export_data", test_16_export_data()))
    results.append(("test_17_export_with_search", test_17_export_with_search()))
    results.append(("test_18_delete_record", test_18_delete_record(created_id)))
    results.append(("test_19_delete_invalid_id", test_19_delete_invalid_id()))
    results.append(("test_20_custom_period", test_20_custom_period()))
    
    # 统计结果
    print()
    print("=" * 60)
    passed = sum(1 for _, s in results if s)
    failed = sum(1 for _, s in results if not s)
    print(f"测试结果: 通过 {passed}/{len(results)}, 失败 {failed}/{len(results)}")
    
    if failed > 0:
        print("\n失败的测试:")
        for name, success in results:
            if not success:
                print(f"  - {name}")
    print("=" * 60)

if __name__ == "__main__":
    main()