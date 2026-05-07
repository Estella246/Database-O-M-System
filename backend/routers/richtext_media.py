from __future__ import annotations

import logging
import os
import uuid
from datetime import timedelta
from io import BytesIO
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/richtext", tags=["richtext"])

_MAX_BYTES = 5 * 1024 * 1024
_ALLOWED_CT = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
_CT_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _minio_config() -> dict[str, Any] | None:
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


@router.post("/upload-image")
async def upload_richtext_image(
    operator_id: str = "demo_001",
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """工单富文本插入图片：写入 MinIO，返回可嵌入 HTML 的 URL（公开前缀或预签名）。"""
    _ = operator_id  # 与其它接口一致保留，便于后续审计

    raw_ct = file.content_type or ""
    ct = raw_ct.split(";")[0].strip().lower()
    if ct not in _ALLOWED_CT:
        raise HTTPException(status_code=400, detail="仅支持 JPEG、PNG、GIF、WebP 图片")

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="空文件")
    if len(body) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    cfg = _minio_config()
    if not cfg:
        raise HTTPException(
            status_code=503,
            detail="富文本图片存储未配置：请设置 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET",
        )

    ext = _CT_EXT.get(ct, ".bin")
    object_name = f"richtext/{uuid.uuid4().hex}{ext}"
    bucket = cfg["bucket"]

    try:
        from minio import Minio
    except ImportError as e:
        logger.error("minio package missing: %s", e)
        raise HTTPException(status_code=500, detail="服务端未安装 minio 依赖") from e

    client = Minio(
        cfg["endpoint"],
        access_key=cfg["access_key"],
        secret_key=cfg["secret_key"],
        secure=bool(cfg["secure"]),
    )

    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
    except Exception as e:
        logger.exception("MinIO bucket check/create failed: %s", e)
        raise HTTPException(status_code=502, detail="无法访问或创建存储桶") from e

    try:
        client.put_object(
            bucket,
            object_name,
            BytesIO(body),
            length=len(body),
            content_type=ct,
        )
    except Exception as e:
        logger.exception("MinIO put_object failed: %s", e)
        raise HTTPException(status_code=502, detail="图片上传失败") from e

    public_base = cfg["public_base"]
    if public_base:
        url = f"{public_base}/{object_name}"
    else:
        try:
            url = client.presigned_get_object(bucket, object_name, expires=timedelta(days=7))
        except Exception as e:
            logger.exception("MinIO presigned URL failed: %s", e)
            raise HTTPException(status_code=502, detail="无法生成访问链接") from e

    logger.info("richtext image uploaded: bucket=%s object=%s bytes=%s", bucket, object_name, len(body))
    return {"ok": True, "url": url, "object_name": object_name}
