"""富文本图片走 MinIO：路由单测（不依赖已启动的 HTTP 服务）。"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app import app


@pytest.fixture
def richtext_client() -> TestClient:
    return TestClient(app)


def test_upload_image_rejects_wrong_content_type_without_minio(richtext_client: TestClient) -> None:
    r = richtext_client.post(
        "/api/richtext/upload-image?operator_id=demo_001",
        files={"file": ("x.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400


def test_upload_image_returns_503_when_minio_not_configured(richtext_client: TestClient) -> None:
    blank = {
        "MINIO_ENDPOINT": "",
        "MINIO_ACCESS_KEY": "",
        "MINIO_SECRET_KEY": "",
        "MINIO_BUCKET": "",
        "MINIO_PUBLIC_BASE_URL": "",
        "MINIO_USE_SSL": "",
    }
    with patch.dict(os.environ, blank, clear=False):
        r = richtext_client.post(
            "/api/richtext/upload-image?operator_id=demo_001",
            files={"file": ("t.png", b"\x00\x01", "image/png")},
        )
    assert r.status_code == 503
    assert "MINIO" in r.json().get("detail", "")


def test_upload_image_uses_public_url_when_configured(richtext_client: TestClient) -> None:
    fake = MagicMock()
    fake.bucket_exists.return_value = True
    env = {
        "MINIO_ENDPOINT": "localhost:9000",
        "MINIO_ACCESS_KEY": "access",
        "MINIO_SECRET_KEY": "secret",
        "MINIO_BUCKET": "yw-assets",
        "MINIO_PUBLIC_BASE_URL": "https://cdn.example.com/yw-assets",
        "MINIO_USE_SSL": "false",
    }
    with patch.dict(os.environ, env, clear=False), patch("minio.Minio", return_value=fake):
        r = richtext_client.post(
            "/api/richtext/upload-image?operator_id=demo_001",
            files={"file": ("a.png", b"x", "image/png")},
        )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    url = j.get("url", "")
    assert url.startswith("https://cdn.example.com/yw-assets/richtext/")
    assert url.endswith(".png")
    fake.put_object.assert_called_once()
    fake.presigned_get_object.assert_not_called()


def test_upload_image_presigned_when_no_public_base(richtext_client: TestClient) -> None:
    fake = MagicMock()
    fake.bucket_exists.return_value = True
    fake.presigned_get_object.return_value = "https://minio.local/presigned?token=1"
    env = {
        "MINIO_ENDPOINT": "localhost:9000",
        "MINIO_ACCESS_KEY": "access",
        "MINIO_SECRET_KEY": "secret",
        "MINIO_BUCKET": "b",
        "MINIO_PUBLIC_BASE_URL": "",
        "MINIO_USE_SSL": "false",
    }
    with patch.dict(os.environ, env, clear=False), patch("minio.Minio", return_value=fake):
        r = richtext_client.post(
            "/api/richtext/upload-image?operator_id=demo_001",
            files={"file": ("a.jpg", b"x", "image/jpeg")},
        )
    assert r.status_code == 200, r.text
    assert r.json().get("url") == "https://minio.local/presigned?token=1"
    fake.presigned_get_object.assert_called_once()
