from __future__ import annotations

import logging
import os
import uuid
from datetime import timedelta
from io import BytesIO
from typing import Any

logger = logging.getLogger(__name__)


def minio_config() -> dict[str, Any] | None:
    endpoint = os.getenv("MINIO_ENDPOINT", "").strip()
    access_key = os.getenv("MINIO_ACCESS_KEY", "").strip()
    secret_key = os.getenv("MINIO_SECRET_KEY", "").strip()
    bucket = os.getenv("MINIO_BUCKET", "").strip()
    if not (endpoint and access_key and secret_key and bucket):
        return None
    use_ssl = os.getenv("MINIO_USE_SSL", "").strip().lower() in ("1", "true", "yes", "on")
    public_base = os.getenv("MINIO_PUBLIC_BASE_URL", "").strip().rstrip("/")
    return {
        "endpoint": endpoint,
        "access_key": access_key,
        "secret_key": secret_key,
        "bucket": bucket,
        "secure": use_ssl,
        "public_base": public_base,
    }


def put_object_and_resolve_url(
    *,
    body: bytes,
    content_type: str,
    object_name: str,
    cfg: dict[str, Any],
) -> str:
    bucket = cfg["bucket"]
    try:
        from minio import Minio
    except ImportError as e:
        logger.error("minio package missing: %s", e)
        raise RuntimeError("服务端未安装 minio 依赖") from e

    client = Minio(
        cfg["endpoint"],
        access_key=cfg["access_key"],
        secret_key=cfg["secret_key"],
        secure=bool(cfg["secure"]),
    )

    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)

    client.put_object(
        bucket,
        object_name,
        BytesIO(body),
        length=len(body),
        content_type=content_type,
    )

    public_base = cfg["public_base"]
    if public_base:
        return f"{public_base}/{object_name}"
    return client.presigned_get_object(bucket, object_name, expires=timedelta(days=7))


def upload_bytes(
    *,
    body: bytes,
    content_type: str,
    object_prefix: str,
    ext: str,
) -> dict[str, str]:
    cfg = minio_config()
    if not cfg:
        raise ValueError(
            "MINIO_NOT_CONFIGURED:请设置 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET"
        )
    safe_ext = ext if ext.startswith(".") else f".{ext}"
    object_name = f"{object_prefix.rstrip('/')}/{uuid.uuid4().hex}{safe_ext}"
    url = put_object_and_resolve_url(
        body=body,
        content_type=content_type,
        object_name=object_name,
        cfg=cfg,
    )
    return {"url": url, "object_name": object_name}


def _minio_client(cfg: dict[str, Any]):
    try:
        from minio import Minio
    except ImportError as e:
        logger.error("minio package missing: %s", e)
        raise RuntimeError("服务端未安装 minio 依赖") from e
    return Minio(
        cfg["endpoint"],
        access_key=cfg["access_key"],
        secret_key=cfg["secret_key"],
        secure=bool(cfg["secure"]),
    )


def presigned_download_url(*, object_name: str, expires_hours: int = 1) -> str:
    cfg = minio_config()
    if not cfg:
        raise ValueError(
            "MINIO_NOT_CONFIGURED:请设置 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET"
        )
    client = _minio_client(cfg)
    return client.presigned_get_object(
        cfg["bucket"],
        object_name,
        expires=timedelta(hours=max(1, expires_hours)),
    )
