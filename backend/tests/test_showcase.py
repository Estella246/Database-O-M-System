from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import showcase


def _anon_request():
    return SimpleNamespace(state=SimpleNamespace())


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row

    def fetchall(self):
        return [self._row]


class _FakeConnection:
    def __init__(self, row):
        self.row = row
        self.params = None
        self.queries = []
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, _query, params=None):
        self.queries.append(_query)
        self.params = params
        return _FakeResult(self.row)

    def commit(self):
        self.committed = True


def _row():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    return {
        "id": 13,
        "title": "新展示",
        "event_date": date(2024, 3, 12),
        "detail_html": "<p>正文</p>",
        "image_url": "https://minio.example/showcase.webp",
        "image_object_name": "richtext/example.webp",
        "created_by": "demo_001",
        "created_at": now,
        "updated_at": now,
    }


def test_create_showcase_item_persists_editor_values(monkeypatch):
    conn = _FakeConnection(_row())
    monkeypatch.setattr(showcase, "db_conn", lambda: conn)
    monkeypatch.setattr(showcase, "require_whitelist", lambda *_a, **_k: None)
    monkeypatch.setattr(
        showcase, "resolve_operator_id", lambda _req, claimed: str(claimed or "demo_001")
    )

    result = showcase.create_showcase_item(
        showcase.ShowcaseCreateRequest(
            operator_id="demo_001",
            title=" 新展示 ",
            event_date="2024-03-12",
            detail_html="<p>正文</p>",
            image_url="https://minio.example/showcase.webp",
            image_object_name="richtext/example.webp",
        ),
        request=_anon_request(),
    )

    assert result["ok"] is True
    assert result["item"]["id"] == 13
    assert result["item"]["event_date"] == "2024-03-12"
    assert conn.params == (
        "新展示",
        date(2024, 3, 12),
        "<p>正文</p>",
        "https://minio.example/showcase.webp",
        "richtext/example.webp",
        "demo_001",
    )


def test_create_showcase_item_requires_image_and_body():
    with pytest.raises(HTTPException, match="请填写正文"):
        showcase._normalize_detail("<p>&nbsp;</p>")
    with pytest.raises(HTTPException, match="请上传展示图片"):
        showcase._normalize_image_url("")
    with pytest.raises(HTTPException, match="请填写时间"):
        showcase._normalize_event_date("")
    with pytest.raises(HTTPException, match="时间格式"):
        showcase._normalize_event_date("2024/03/12")


def test_list_showcase_items_returns_database_ids(monkeypatch):
    conn = _FakeConnection(_row())
    monkeypatch.setattr(showcase, "db_conn", lambda: conn)
    monkeypatch.setattr(showcase, "require_whitelist", lambda *_a, **_k: None)
    monkeypatch.setattr(showcase, "resolve_operator_id", lambda *_a, **_k: "demo_001")

    result = showcase.list_showcase_items(request=_anon_request())

    assert result["items"][0]["id"] == 13
    assert result["items"][0]["detail_html"] == "<p>正文</p>"
    assert result["items"][0]["event_date"] == "2024-03-12"
    assert any("ORDER BY event_date ASC" in query for query in conn.queries)


def test_delete_showcase_item_checks_shared_add_delete_permission(monkeypatch):
    conn = _FakeConnection(_row())
    deleted_objects = []
    monkeypatch.setattr(showcase, "db_conn", lambda: conn)
    monkeypatch.setattr(
        showcase,
        "whitelist_delete_allowed",
        lambda _conn, operator_id, field_key: operator_id == "demo_001" and field_key == "showcase_add",
    )
    monkeypatch.setattr(showcase, "delete_object", lambda **kwargs: deleted_objects.append(kwargs["object_name"]))
    monkeypatch.setattr(
        showcase, "resolve_operator_id", lambda _req, claimed: str(claimed or "demo_001")
    )

    result = showcase.delete_showcase_item(13, _anon_request(), "demo_001")

    assert result == {"ok": True, "id": 13}
    assert any("DELETE FROM showcase_item" in query for query in conn.queries)
    assert conn.committed is True
    assert deleted_objects == ["richtext/example.webp"]


def test_delete_showcase_item_rejects_hidden_permission(monkeypatch):
    conn = _FakeConnection(_row())
    monkeypatch.setattr(showcase, "db_conn", lambda: conn)
    monkeypatch.setattr(showcase, "whitelist_delete_allowed", lambda *_args: False)
    monkeypatch.setattr(showcase, "resolve_operator_id", lambda _req, claimed: str(claimed or ""))

    with pytest.raises(HTTPException) as exc_info:
        showcase.delete_showcase_item(13, _anon_request(), "visitor")

    assert exc_info.value.status_code == 403
