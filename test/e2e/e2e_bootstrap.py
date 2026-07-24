"""
E2E 会话级数据引导：与 test/conftest.py 的 load_test_data() 使用同一套 JSON，
保证 Playwright 所连后端上的 user_account / role_permission_policy / 请假审批白名单
与 API 测试一致。

设计要点：
- E2E 子进程（8999）与 pytest API 用例（8000）常共用同一 DATABASE_URL，但 API 侧的
  session fixture 不会在 E2E 进程启动时自动执行；因此在 E2E session 内显式 bulk upsert。
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

_TEST_DATA_DIR = Path(__file__).resolve().parents[1] / "test_data"


def load_merged_test_data() -> dict:
    with open(_TEST_DATA_DIR / "test_data.json", encoding="utf-8") as f:
        data = json.load(f)
    preset = _TEST_DATA_DIR / "admin_whitelist_full.json"
    if preset.is_file():
        extra = json.loads(preset.read_text(encoding="utf-8"))
        data.setdefault("permissions", [])
        data["permissions"] = list(data["permissions"]) + list(extra)
    return data


def seed_e2e_backend(base_url: str) -> None:
    """向给定 base_url 写入用户、权限策略、请假审批人白名单。"""
    data = load_merged_test_data()
    url = base_url.rstrip("/")
    with httpx.Client(base_url=url, timeout=120.0) as client:
        u = client.post(
            "/api/admin/users/bulk",
            json={"items": data["users"], "operator_id": "admin"},
        )
        if u.status_code != 200:
            raise RuntimeError(f"E2E seed users/bulk HTTP {u.status_code}: {u.text[:800]}")

        perms = data.get("permissions") or []
        if perms:
            p = client.post(
                "/api/admin/permissions/bulk",
                json={"items": perms, "operator_id": "test_admin"},
            )
            if p.status_code != 200:
                raise RuntimeError(
                    f"E2E seed permissions/bulk HTTP {p.status_code}: {p.text[:800]}"
                )

        accounts = data.get("leave_approver_whitelist") or []
        if accounts:
            w = client.put(
                "/api/leave/approver-whitelist",
                json={"operator_id": "test_admin", "accounts": accounts},
            )
            if w.status_code != 200:
                raise RuntimeError(
                    f"E2E seed leave approver-whitelist HTTP {w.status_code}: {w.text[:800]}"
                )

        # 责任田树（领域/模块&特性）：cascader 等依赖它，必须有多领域
        tree = data.get("duty_field_tree")
        if tree:
            t = client.put(
                "/api/params/duty-field/tree",
                json={"operator_id": "test_admin", "nodes": tree.get("nodes", [])},
            )
            if t.status_code != 200:
                raise RuntimeError(
                    f"E2E seed duty-field tree HTTP {t.status_code}: {t.text[:800]}"
                )
