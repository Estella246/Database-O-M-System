"""M17 运维工具广场接口测试。"""

from __future__ import annotations

import io
import re
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
                for f in ("tool_plaza_list", "tool_plaza_publish", "tool_plaza_edit")
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

    def test_list_returns_existing_items(self, api_client) -> None:
        from database import db_conn
        from psycopg.errors import UndefinedTable

        item_no = "TOOL20990101999"
        try:
            with db_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO ops_tool_item (
                      item_no, item_type, title, category, file_name, object_name, file_size,
                      usage_md, usage_md_excerpt, publisher_id, publisher_name
                    )
                    VALUES (%s, 'tool', '列表回归测试', '测试', 't.zip', 'ops-tool-plaza/tool/t.zip', 1,
                            '使用说明', '摘要', %s, '测试员')
                    ON CONFLICT (item_no) DO NOTHING
                    """,
                    (item_no, OP),
                )
                conn.commit()
        except UndefinedTable:
            pytest.skip("运维工具广场表未迁移")

        try:
            r = api_client.get("/api/ops-tool-plaza/items", params={"operator_id": OP, "q": "列表回归测试"})
            if r.status_code == 503:
                pytest.skip("运维工具广场表未迁移")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("total", 0) >= 1
            assert any(it.get("title") == "列表回归测试" for it in body.get("items") or [])
            assert "can_edit" in (body.get("items") or [{}])[0]
        finally:
            with db_conn() as conn:
                conn.execute("DELETE FROM ops_tool_item WHERE item_no = %s", (item_no,))
                conn.commit()


class TestToolPlazaPublishItemNo:
    def test_publish_skill_returns_item_no(self, api_client) -> None:
        body = _zip_with_skill("# Skill\n\nHello")
        r = api_client.post(
            f"/api/ops-tool-plaza/items?operator_id={OP}",
            data={
                "item_type": "skill",
                "title": "编号测试 Skill",
                "category": "测试",
                "usage_md": "下载后使用",
            },
            files={"file": ("ok.zip", body, "application/zip")},
        )
        if r.status_code in (502, 503):
            pytest.skip("运维工具广场依赖 MinIO 或表未迁移")
        assert r.status_code == 200
        item_no = str(r.json().get("item_no") or "")
        assert re.match(r"^SKILL[0-9]{11}$", item_no)
        try:
            r2 = api_client.get(
                f"/api/ops-tool-plaza/items/by-no/{item_no}",
                params={"operator_id": OP},
            )
            assert r2.status_code == 200
            assert r2.json().get("item_no") == item_no
            assert r2.json().get("title") == "编号测试 Skill"
        finally:
            item_id = int(r.json().get("id") or 0)
            if item_id:
                api_client.delete(f"/api/ops-tool-plaza/items/{item_id}", params={"operator_id": OP})


class TestToolPlazaDetail:
    def test_get_item_returns_usage_md_fields(self, api_client) -> None:
        from database import db_conn
        from psycopg.errors import UndefinedTable

        try:
            with db_conn() as conn:
                row = conn.execute(
                    """
                    INSERT INTO ops_tool_item (
                      item_no, item_type, title, category, file_name, object_name, file_size,
                      usage_md, usage_md_excerpt, publisher_id, publisher_name
                    )
                    VALUES ('TOOL20990101001', 'tool', '详情测试', '测试', 't.zip', 'ops-tool-plaza/tool/t.zip', 1,
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


class TestToolPlazaDownload:
    def _insert_item(self) -> int:
        from database import db_conn
        from psycopg.errors import UndefinedTable

        try:
            with db_conn() as conn:
                row = conn.execute(
                    """
                    INSERT INTO ops_tool_item (
                      item_no, item_type, title, category, file_name, object_name, file_size,
                      usage_md, usage_md_excerpt, publisher_id, publisher_name
                    )
                    VALUES ('TOOL20990101003', 'tool', '下载测试', '测试', 't.zip', 'ops-tool-plaza/tool/t.zip', 1,
                            '使用说明', '摘要', %s, '测试员')
                    RETURNING id
                    """,
                    (OP,),
                ).fetchone()
                conn.commit()
                return int(row["id"])
        except UndefinedTable:
            pytest.skip("运维工具广场表未迁移")

    def _delete_item(self, item_id: int) -> None:
        from database import db_conn

        with db_conn() as conn:
            conn.execute("DELETE FROM ops_tool_item WHERE id = %s", (item_id,))
            conn.commit()

    def test_get_download_redirect_matches_post_url(self, api_client) -> None:
        item_id = self._insert_item()
        try:
            r_post = api_client.post(
                f"/api/ops-tool-plaza/items/{item_id}/download",
                params={"operator_id": OP},
            )
            r_get = api_client.get(
                f"/api/ops-tool-plaza/items/{item_id}/download",
                params={"operator_id": OP},
            )
            if r_post.status_code == 503:
                assert r_get.status_code == 503
                return
            assert r_post.status_code == 200, r_post.text
            body = r_post.json()
            assert body.get("url")
            assert r_get.status_code == 302, r_get.text
            assert r_get.headers.get("location") == body["url"]
        finally:
            self._delete_item(item_id)


class TestToolPlazaEditDelete:
    def _insert_item(self, publisher_id: str = OP) -> int:
        from database import db_conn
        from psycopg.errors import UndefinedTable

        try:
            with db_conn() as conn:
                row = conn.execute(
                    """
                    INSERT INTO ops_tool_item (
                      item_no, item_type, title, category, file_name, object_name, file_size,
                      usage_md, usage_md_excerpt, publisher_id, publisher_name
                    )
                    VALUES ('TOOL20990101002', 'tool', '编辑删除测试', '测试', 't.zip', 'ops-tool-plaza/tool/t.zip', 1,
                            '使用说明', '摘要', %s, '测试员')
                    RETURNING id
                    """,
                    (publisher_id,),
                ).fetchone()
                conn.commit()
                return int(row["id"])
        except UndefinedTable:
            pytest.skip("运维工具广场表未迁移")

    def _delete_item(self, item_id: int) -> None:
        from database import db_conn

        with db_conn() as conn:
            conn.execute("DELETE FROM ops_tool_item WHERE id = %s", (item_id,))
            conn.commit()

    def _set_edit_level(self, api_client, level: str) -> None:
        api_client.post(
            "/api/admin/permissions/bulk",
            json={
                "operator_id": OP,
                "items": [
                    {
                        "role_code": "admin",
                        "is_pl": False,
                        "node_key": "__whitelist__",
                        "field_key": "tool_plaza_edit",
                        "permission_level": level,
                    }
                ],
            },
        )

    def test_update_metadata_without_file(self, api_client) -> None:
        item_id = self._insert_item()
        try:
            r = api_client.put(
                f"/api/ops-tool-plaza/items/{item_id}",
                params={"operator_id": OP},
                data={
                    "title": "新标题",
                    "category": "新标签",
                    "usage_md": "新使用方式",
                },
            )
            if r.status_code == 503:
                pytest.skip("运维工具广场表未迁移")
            assert r.status_code == 200
            body = r.json()
            assert body["title"] == "新标题"
            assert body["category"] == "新标签"
            assert body["can_edit"] is True
        finally:
            self._delete_item(item_id)

    def test_delete_own_with_readonly_edit(self, api_client) -> None:
        self._set_edit_level(api_client, "readonly")
        item_id = self._insert_item()
        try:
            r = api_client.delete(
                f"/api/ops-tool-plaza/items/{item_id}",
                params={"operator_id": OP},
            )
            assert r.status_code == 200
            assert r.json().get("ok") is True
            item_id = 0
        finally:
            if item_id:
                self._delete_item(item_id)

    def test_delete_other_forbidden_with_readonly_edit(self, api_client) -> None:
        self._set_edit_level(api_client, "readonly")
        item_id = self._insert_item(publisher_id="other_user")
        try:
            r = api_client.delete(
                f"/api/ops-tool-plaza/items/{item_id}",
                params={"operator_id": OP},
            )
            assert r.status_code == 403
        finally:
            self._delete_item(item_id)

    def test_delete_other_allowed_with_editable(self, api_client) -> None:
        self._set_edit_level(api_client, "editable")
        item_id = self._insert_item(publisher_id="other_user")
        try:
            r = api_client.delete(
                f"/api/ops-tool-plaza/items/{item_id}",
                params={"operator_id": OP},
            )
            assert r.status_code == 200
            item_id = 0
        finally:
            if item_id:
                self._delete_item(item_id)

    def test_edit_hidden_forbidden(self, api_client) -> None:
        self._set_edit_level(api_client, "hidden")
        item_id = self._insert_item()
        try:
            r = api_client.put(
                f"/api/ops-tool-plaza/items/{item_id}",
                params={"operator_id": OP},
                data={
                    "title": "不应成功",
                    "category": "测试",
                    "usage_md": "x",
                },
            )
            assert r.status_code == 403
        finally:
            self._delete_item(item_id)
            self._set_edit_level(api_client, "editable")
