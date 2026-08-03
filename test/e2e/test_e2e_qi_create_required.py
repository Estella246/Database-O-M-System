"""接口测试：create_qi 必填校验——缺 priority/domain/module_feature → 400。
校验在 DB 关联检查之前（fail-fast），故无需真实 ticket/reviewer。
"""
import httpx
import pytest

pytestmark = pytest.mark.e2e

BASE = {
    "operator_id": "x", "title": "t", "related_ticket_no": "r", "description": "d",
    "priority": "中", "domain": "x", "module_feature": "y",
}


def test_create_qi_required_fields(backend_server):
    for field, keyword in [("priority", "优先级"), ("domain", "领域"), ("module_feature", "模块&特性")]:
        payload = {k: v for k, v in BASE.items() if k != field}
        r = httpx.post(f"{backend_server}/api/qi", json=payload, timeout=15)
        assert r.status_code == 400, f"缺 {field} 应 400，实际 {r.status_code}: {r.text[:150]}"
        assert keyword in r.json().get("detail", ""), f"缺 {field} 提示应含「{keyword}」: {r.text[:150]}"
