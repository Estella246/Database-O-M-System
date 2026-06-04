from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from utils.minio_storage import minio_config, upload_bytes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/richtext", tags=["richtext"])

_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_MAX_FILE_BYTES = 20 * 1024 * 1024
_ALLOWED_IMAGE_CT = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
_IMAGE_CT_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
_ALLOWED_FILE_EXT = frozenset(
    {
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".txt",
        ".zip",
        ".rar",
        ".7z",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
    }
)
_ALLOWED_FILE_CT = frozenset(
    {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "application/zip",
        "application/x-zip-compressed",
        "application/x-rar-compressed",
        "application/x-7z-compressed",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/octet-stream",
    }
)


def _minio_not_configured_detail() -> str:
    return "富文本图片存储未配置：请设置 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET"


def _file_ext_from_name(name: str) -> str:
    base = os.path.basename(str(name or "").strip())
    dot = base.rfind(".")
    if dot < 0:
        return ""
    return base[dot:].lower()


def _resolve_upload_file_meta(file: UploadFile) -> tuple[str, str]:
    raw_ct = (file.content_type or "").split(";")[0].strip().lower()
    ext = _file_ext_from_name(file.filename or "")
    if not ext:
        raise HTTPException(status_code=400, detail="无法识别文件扩展名")
    if ext not in _ALLOWED_FILE_EXT:
        raise HTTPException(status_code=400, detail="不支持的文件类型")
    if raw_ct and raw_ct not in _ALLOWED_FILE_CT:
        raise HTTPException(status_code=400, detail="不支持的文件类型")
    ct = raw_ct or "application/octet-stream"
    return ct, ext


@router.post("/upload-image")
async def upload_richtext_image(
    operator_id: str = "demo_001",
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """工单富文本插入图片：写入 MinIO，返回可嵌入 HTML 的 URL（公开前缀或预签名）。"""
    _ = operator_id

    raw_ct = file.content_type or ""
    ct = raw_ct.split(";")[0].strip().lower()
    if ct not in _ALLOWED_IMAGE_CT:
        raise HTTPException(status_code=400, detail="仅支持 JPEG、PNG、GIF、WebP 图片")

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="空文件")
    if len(body) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    if not minio_config():
        raise HTTPException(status_code=503, detail=_minio_not_configured_detail())

    ext = _IMAGE_CT_EXT.get(ct, ".bin")
    try:
        result = upload_bytes(
            body=body,
            content_type=ct,
            object_prefix="richtext",
            ext=ext,
        )
    except ValueError as e:
        if str(e).startswith("MINIO_NOT_CONFIGURED"):
            raise HTTPException(status_code=503, detail=_minio_not_configured_detail()) from e
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("MinIO image upload failed: %s", e)
        raise HTTPException(status_code=502, detail="图片上传失败") from e

    logger.info(
        "richtext image uploaded: object=%s bytes=%s",
        result["object_name"],
        len(body),
    )
    return {"ok": True, "url": result["url"], "object_name": result["object_name"]}


@router.post("/upload-file")
async def upload_ticket_file(
    operator_id: str = "demo_001",
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """工单附件（如运维闭环问题报告）：写入 MinIO，返回 URL 与对象键。"""
    _ = operator_id

    ct, ext = _resolve_upload_file_meta(file)
    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="空文件")
    if len(body) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="文件大小不能超过 20MB")

    if not minio_config():
        raise HTTPException(status_code=503, detail=_minio_not_configured_detail())

    file_name = os.path.basename(str(file.filename or "file").strip()) or "file"
    try:
        result = upload_bytes(
            body=body,
            content_type=ct,
            object_prefix="ticket-files",
            ext=ext,
        )
    except ValueError as e:
        if str(e).startswith("MINIO_NOT_CONFIGURED"):
            raise HTTPException(status_code=503, detail=_minio_not_configured_detail()) from e
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("MinIO file upload failed: %s", e)
        raise HTTPException(status_code=502, detail="文件上传失败") from e

    logger.info(
        "ticket file uploaded: object=%s name=%s bytes=%s",
        result["object_name"],
        file_name,
        len(body),
    )
    return {
        "ok": True,
        "url": result["url"],
        "object_name": result["object_name"],
        "file_name": file_name,
    }
