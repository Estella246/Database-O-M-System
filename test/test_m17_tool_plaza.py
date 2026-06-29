"""M17 运维工具广场接口测试。"""

from __future__ import annotations

import io
import zipfile

import pytest

OP = "admin"


@pytest.fixture(scope="module", autouse=True)
def _ensure_tool_plaza_whitelist(api_client):
    api_client.post(
        "/api/admin/permissions/bulk",
        json={
            "operator_id": "admin",
            "items": [
                {
                    "role_code": "admin",
                    "is_pl": False,
                    "node_key": "__whitelist__",
                    "field_key": f,
                    "permission_level": "readonly",
                }
                for f in ("tool_plaza_list", "tool_plaza_publish")
            ],
        },
    )
    yield


def _zip_with_skill(content: str, inner_path: str = "my-skill/SKILL.md") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(inner_path, content)
    return buf.getvalue()


def _zip_tool_only() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("tool/run.sh", "#!/bin/sh\necho hi")
    return buf.getvalue()


class TestToolPlazaValidation:
    def test_publish_skill_rejects_zip_without_skill_md(self, api_client) -> None:
        body = _zip_tool_only()
        r = api_client.post(
            f"/api/ops-tool-plaza/items?operator_id={OP}",
            data={
                "item_type": "skill",
                "title": "坏包",
                "category": "诊断",
                "usage_md": "说明",
            },
            files={"file": ("bad.zip", body, "application/zip")},
        )
        assert r.status_code == 400
        assert "SKILL.md" in r.json().get("detail", "")

    def test_publish_requires_category(self, api_client) -> None:
        body = _zip_with_skill("# x")
        r = api_client.post(
            f"/api/ops-tool-plaza/items?operator_id={OP}",
            data={
                "item_type": "skill",
                "title": "无分类",
                "category": "   ",
                "usage_md": "下载后使用",
            },
            files={"file": ("ok.zip", body, "application/zip")},
        )
        assert r.status_code == 400

    def test_publish_requires_usage_md(self, api_client) -> None:
        body = _zip_with_skill("# x")
        r = api_client.post(
            f"/api/ops-tool-plaza/items?operator_id={OP}",
            data={
                "item_type": "skill",
                "title": "标题",
                "category": "测试",
                "usage_md": "   ",
            },
            files={"file": ("ok.zip", body, "application/zip")},
        )
        assert r.status_code == 400
        assert "使用方式" in r.json().get("detail", "")


class TestToolPlazaList:
    def test_list_and_categories_when_schema_ready(self, api_client) -> None:
        r = api_client.get("/api/ops-tool-plaza/items", params={"operator_id": OP})
        if r.status_code == 503:
            pytest.skip("运维工具广场表未迁移")
        assert r.status_code == 200
        body = r.json()
        assert "items" in body
        assert isinstance(body["items"], list)

        r2 = api_client.get("/api/ops-tool-plaza/categories", params={"operator_id": OP})
        assert r2.status_code == 200
        assert isinstance(r2.json().get("items"), list)


class TestToolPlazaDetail:
    def test_get_item_returns_usage_md_fields(self, api_client) -> None:
        from database import db_conn
        from psycopg.errors import UndefinedTable

        try:
            with db_conn() as conn:
                row = conn.execute(
                    """
                    INSERT INTO ops_tool_item (
                      item_type, title, category, file_name, object_name, file_size,
                      usage_md, usage_md_excerpt, publisher_id, publisher_name
                    )
                    VALUES ('tool', '详情测试', '测试', 't.zip', 'ops-tool-plaza/tool/t.zip', 1,
                            '使用说明正文', '使用说明摘要', %s, '测试员 admin')
                    RETURNING id
                    """,
                    (OP,),
                ).fetchone()
                conn.commit()
                item_id = int(row["id"])
        except UndefinedTable:
            pytest.skip("运维工具广场表未迁移")

        try:
            r = api_client.get(f"/api/ops-tool-plaza/items/{item_id}", params={"operator_id": OP})
            assert r.status_code == 200
            body = r.json()
            assert body["usage_md"] == "使用说明正文"
            assert body["usage_md_excerpt"] == "使用说明摘要"
        finally:
            with db_conn() as conn:
                conn.execute("DELETE FROM ops_tool_item WHERE id = %s", (item_id,))
                conn.commit()
