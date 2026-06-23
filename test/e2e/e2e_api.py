"""E2E 前置：通过后端 API 建单/流转；失败使用 pytest.fail，避免业务条件 skip。"""
from __future__ import annotations

import time
import uuid

import pytest


def unique_e2e_tag() -> str:
    return f"e2e_{int(time.time())}_{uuid.uuid4().hex[:6]}"


# 非 YWxxxxxxxx 占位路径：后端会为每次 submit 分配新的 YW 单号（见 tickets._get_or_create_ticket）。
_E2E_CREATE_TICKET_PREFIX = "/api/tickets/e2e_auto_alloc"
_TEST_FILE_JSON = (
    '{"url":"https://test.example/report.pdf","file_name":"report.pdf","object_name":"test/report.pdf"}'
)


def api_create_ticket_response(api_client, tag: str):
    """与当前库内 problem_fill 字段一致（见 db/migrations 及 LOCATION/问题阶段 选项）。"""
    return api_client.post(
        f"{_E2E_CREATE_TICKET_PREFIX}/nodes/problem_fill/submit",
        json={
            "values": {
                "start_date": time.strftime("%Y-%m-%d"),
                "location": "temp",
                "biz_env": "生产环境",
                "severity": "一般",
                "component": "内核问题",
                "ecare_ticket_no": f"ECARE-E2E-{tag}",
                "issue_desc": f"<p>端到端测试自动创建-{tag}</p>",
            },
            "operator_id": "test_admin",
            "operator_name": "测试管理员",
            "next_node_key": "problem_review",
        },
    )


def require_ticket_order_id(api_client, tag: str | None = None) -> str:
    tag = tag or unique_e2e_tag()
    resp = api_create_ticket_response(api_client, tag)
    if resp.status_code == 200:
        body = resp.json()
        oid = body.get("order_id") or body.get("orderId") or body.get("ticket_id")
        if oid:
            return str(oid)
    pytest.fail(
        "无法通过 API 创建工单（前置失败）。"
        f"HTTP {resp.status_code}\n{resp.text[:1600]}"
    )


def _build_node_payload(api_client, node_key: str, handle_mode: str, overrides=None):
    """与 test/test_m02_ticket.py 一致：按节点 schema 填充必填与条件必填字段。"""
    schema_resp = api_client.get(f"/api/nodes/{node_key}/schema")
    if schema_resp.status_code != 200:
        pytest.fail(
            f"无法拉取节点 {node_key} schema：HTTP {schema_resp.status_code} {schema_resp.text[:400]}"
        )
    fields = schema_resp.json()["fields"]
    values: dict = {"handle_mode": handle_mode}
    for f in fields:
        key = f["key"]
        if key == "handle_mode":
            continue
        if overrides and key in overrides:
            values[key] = overrides[key]
            continue
        if f.get("readonly", False):
            continue
        constraints = f.get("constraints") or {}
        required_if = constraints.get("required_if")
        if required_if:
            cond_field = list(required_if.keys())[0]
            cond_value = required_if[cond_field]
            cond_actual = values.get(cond_field)
            triggered = False
            if isinstance(cond_value, list):
                triggered = cond_actual in cond_value
            else:
                triggered = cond_actual == cond_value
            if triggered:
                options = f.get("options", [])
                if options:
                    values[key] = options[0]
                elif f.get("type") == "text":
                    values[key] = f"test_{key}"
                elif f.get("type") == "richtext":
                    values[key] = f"<p>test {key}</p>"
                elif f.get("type") == "date":
                    values[key] = "2026-04-27"
                elif f.get("type") == "file":
                    values[key] = _TEST_FILE_JSON
                continue
        visible_when_all = constraints.get("visible_when_all")
        required_when_visible = constraints.get("required_when_visible")
        if visible_when_all and required_when_visible:
            all_match = True
            for cond in visible_when_all:
                cond_field = cond.get("field")
                cond_values = cond.get("values", [])
                if values.get(cond_field) not in cond_values:
                    all_match = False
                    break
            if all_match:
                options = f.get("options", [])
                if options:
                    values[key] = options[0]
                elif f.get("type") == "text":
                    values[key] = f"test_{key}"
                elif f.get("type") == "richtext":
                    values[key] = f"<p>test {key}</p>"
                elif f.get("type") == "date":
                    values[key] = "2026-04-27"
                elif f.get("type") == "file":
                    values[key] = _TEST_FILE_JSON
                continue
        if not f.get("required", False):
            continue
        options = f.get("options", [])
        if options:
            values[key] = options[0]
        elif f.get("type") == "text":
            values[key] = f"test_{key}"
        elif f.get("type") == "richtext":
            values[key] = f"<p>test {key}</p>"
        elif f.get("type") == "date":
            values[key] = "2026-04-27"
        elif f.get("type") == "file":
            values[key] = _TEST_FILE_JSON
    if overrides:
        values.update(overrides)
    return {
        "values": values,
        "operator_id": "test_admin",
        "operator_name": "测试管理员",
    }


def api_submit_node(
    api_client,
    order_id,
    node_key,
    handle_mode,
    next_node_key=None,
    *,
    extra_values=None,
):
    payload = _build_node_payload(api_client, node_key, handle_mode, overrides=extra_values)
    if next_node_key:
        payload["next_node_key"] = next_node_key
    return api_client.post(
        f"/api/tickets/{order_id}/nodes/{node_key}/submit",
        json=payload,
    )


def require_submit_ok(
    api_client,
    order_id: str,
    node_key: str,
    handle_mode: str,
    next_node_key: str | None = None,
    *,
    ctx: str = "",
    extra_values=None,
) -> None:
    resp = api_submit_node(
        api_client, order_id, node_key, handle_mode, next_node_key, extra_values=extra_values
    )
    if resp.status_code != 200:
        prefix = f"{ctx} " if ctx else ""
        pytest.fail(
            f"{prefix}节点 {node_key} 流转失败 HTTP {resp.status_code}: {resp.text[:1200]}"
        )


_ADVANCE_ROUTE = [
    ("problem_review", "确认问题", "ops_analysis"),
    ("ops_analysis", "提交开发分析", "dev_analysis"),
    ("dev_analysis", "提交开发闭环", "dev_closure"),
    ("dev_closure", "提交运维闭环", "ops_closure"),
    ("ops_closure", "提交运维审核关闭", "audit_close"),
]


def require_advance_to_node(api_client, order_id: str, target_node_key: str) -> None:
    for node_key, handle_mode, next_key in _ADVANCE_ROUTE:
        require_submit_ok(api_client, order_id, node_key, handle_mode, next_key)
        if next_key == target_node_key:
            return
    if target_node_key != "audit_close":
        pytest.fail(f"无法推进工单到节点 {target_node_key!r}")


def seed_workbench_tickets_for_pagination(api_client, count: int = 22) -> None:
    """默认每页 10 条：>=22 保证至少 3 页，下一页按钮可用。"""
    for i in range(count):
        tag = f"seedpg_{i}_{unique_e2e_tag()}"
        require_ticket_order_id(api_client, tag)
