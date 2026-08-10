from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from routers import showcase


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

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, _query, params=None):
        self.params = params
        return _FakeResult(self.row)


def _row():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    return {
        "id": 13,
        "title": "新展示",
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

    result = showcase.create_showcase_item(
        showcase.ShowcaseCreateRequest(
            operator_id="demo_001",
            title=" 新展示 ",
            detail_html="<p>正文</p>",
            image_url="https://minio.example/showcase.webp",
            image_object_name="richtext/example.webp",
        )
    )

    assert result["ok"] is True
    assert result["item"]["id"] == 13
    assert conn.params == (
        "新展示",
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


def test_list_showcase_items_returns_database_ids(monkeypatch):
    conn = _FakeConnection(_row())
    monkeypatch.setattr(showcase, "db_conn", lambda: conn)

    result = showcase.list_showcase_items()

    assert result["items"][0]["id"] == 13
    assert result["items"][0]["detail_html"] == "<p>正文</p>"
