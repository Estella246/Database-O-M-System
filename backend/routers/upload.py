from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from database import db_conn
from models import (
    UploadPreviewPayload,
    UploadCreatePayload,
    UploadSessionUpdatePayload,
    SessionConfigCreatePayload,
)

_UPLOAD_SCHEMA_HINT = "请在数据库执行 db/migrations/0033_upload_sessions.sql"

router = APIRouter(prefix="/api/upload", tags=["upload"])


def _get_user_name(conn, operator_id: str) -> str:
    """获取用户显示名称"""
    row = conn.execute(
        "SELECT user_name FROM user_account WHERE account = %s",
        (operator_id,),
    ).fetchone()
    return str(row["user_name"] or "").strip() if row else operator_id


@router.post("/preview")
def preview_upload(payload: UploadPreviewPayload) -> dict[str, Any]:
    """验证前端解析后的预览数据格式"""
    sheets = payload.sheets or []
    if not sheets:
        raise HTTPException(status_code=400, detail="无有效sheet数据")
    for sheet in sheets:
        if not sheet.get("name"):
            raise HTTPException(status_code=400, detail="sheet缺少名称")
        if not sheet.get("columns"):
            raise HTTPException(status_code=400, detail=f"sheet '{sheet.get('name')}' 缺少列定义")
    return {"ok": True, "sheets": sheets, "file_name": payload.file_name}


@router.post("")
def create_upload_session(payload: UploadCreatePayload) -> dict[str, Any]:
    """创建上传会话，保存数据与配置"""
    op = str(payload.operator_id or "").strip() or "demo_001"
    op_name = str(payload.operator_name or "").strip() or _get_user_name_from_payload(op)
    
    with db_conn() as conn:
        # 检查表是否存在
        try:
            conn.execute("SELECT 1 FROM upload_session LIMIT 1").fetchone()
        except Exception:
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        # 插入会话
        row = conn.execute(
            """
            INSERT INTO upload_session (
                session_name, file_name, raw_data, import_options,
                available_sheets, display_mode, creator_id, creator_name
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (
                payload.session_name or payload.file_name,
                payload.file_name,
                payload.raw_data,
                payload.import_options,
                payload.available_sheets,
                payload.display_mode,
                op,
                op_name,
            ),
        ).fetchone()
        
        # 创建初始配置版本
        config_row = conn.execute(
            """
            INSERT INTO session_config_version (
                session_id, version_name, import_options, display_mode,
                creator_id, creator_name
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                row["id"],
                "初始配置",
                payload.import_options,
                payload.display_mode,
                op,
                op_name,
            ),
        ).fetchone()
        
        conn.commit()
        
        return {
            "ok": True,
            "session_id": row["id"],
            "config_version_id": config_row["id"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else "",
        }


def _get_user_name_from_payload(operator_id: str) -> str:
    """默认用户名"""
    return "Demo User" if operator_id == "demo_001" else operator_id


@router.get("/history")
def list_upload_history(
    operator_id: str = "demo_001",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """查询历史会话列表"""
    op = str(operator_id or "").strip() or "demo_001"
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    
    with db_conn() as conn:
        try:
            rows = conn.execute(
                """
                SELECT id, session_name, file_name, display_mode,
                       creator_name, created_at, updated_at
                FROM upload_session
                WHERE creator_id = %s AND is_deleted = FALSE
                ORDER BY updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (op, limit, offset),
            ).fetchall()
            count_row = conn.execute(
                """
                SELECT COUNT(*) AS cnt FROM upload_session
                WHERE creator_id = %s AND is_deleted = FALSE
                """,
                (op,),
            ).fetchone()
        except Exception:
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        items = [
            {
                "id": r["id"],
                "session_name": r["session_name"] or r["file_name"] or "",
                "file_name": r["file_name"] or "",
                "display_mode": r["display_mode"] or "chart",
                "creator_name": r["creator_name"] or "",
                "created_at": r["created_at"].isoformat() if r["created_at"] else "",
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else "",
            }
            for r in rows
        ]
        
        return {"items": items, "total": count_row["cnt"] or 0, "limit": limit, "offset": offset}


@router.get("/latest")
def get_latest_session(operator_id: str = "demo_001") -> dict[str, Any]:
    """获取最新会话"""
    op = str(operator_id or "").strip() or "demo_001"
    
    with db_conn() as conn:
        try:
            row = conn.execute(
                """
                SELECT id, session_name, file_name, raw_data, import_options,
                       available_sheets, display_mode, creator_id, creator_name,
                       created_at, updated_at
                FROM upload_session
                WHERE creator_id = %s AND is_deleted = FALSE
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (op,),
            ).fetchone()
        except Exception:
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        if not row:
            return {"ok": False, "detail": "无历史会话"}
        
        return {
            "ok": True,
            "session": {
                "id": row["id"],
                "session_name": row["session_name"] or row["file_name"] or "",
                "file_name": row["file_name"] or "",
                "raw_data": row["raw_data"] or {},
                "import_options": row["import_options"] or {},
                "available_sheets": row["available_sheets"] or [],
                "display_mode": row["display_mode"] or "chart",
                "creator_id": row["creator_id"] or "",
                "creator_name": row["creator_name"] or "",
                "created_at": row["created_at"].isoformat() if row["created_at"] else "",
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else "",
            },
        }


@router.get("/session/{session_id}")
def get_session_detail(session_id: int) -> dict[str, Any]:
    """获取指定会话详情"""
    if session_id <= 0:
        raise HTTPException(status_code=400, detail="无效会话ID")
    
    with db_conn() as conn:
        try:
            row = conn.execute(
                """
                SELECT id, session_name, file_name, raw_data, import_options,
                       available_sheets, display_mode, creator_id, creator_name,
                       created_at, updated_at
                FROM upload_session
                WHERE id = %s AND is_deleted = FALSE
                """,
                (session_id,),
            ).fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="会话不存在或已删除")
            
            # 获取配置版本列表
            config_rows = conn.execute(
                """
                SELECT id, session_id, version_name, import_options, display_mode,
                       is_active, creator_name, created_at
                FROM session_config_version
                WHERE session_id = %s
                ORDER BY created_at DESC
                """,
                (session_id,),
            ).fetchall()
        except Exception as e:
            if "不存在" in str(e) or "404" in str(e):
                raise
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        config_versions = [
            {
                "id": r["id"],
                "session_id": r["session_id"],
                "version_name": r["version_name"] or "",
                "import_options": r["import_options"] or {},
                "display_mode": r["display_mode"] or "chart",
                "is_active": r["is_active"] or False,
                "creator_name": r["creator_name"] or "",
                "created_at": r["created_at"].isoformat() if r["created_at"] else "",
            }
            for r in config_rows
        ]
        
        return {
            "ok": True,
            "session": {
                "id": row["id"],
                "session_name": row["session_name"] or row["file_name"] or "",
                "file_name": row["file_name"] or "",
                "raw_data": row["raw_data"] or {},
                "import_options": row["import_options"] or {},
                "available_sheets": row["available_sheets"] or [],
                "display_mode": row["display_mode"] or "chart",
                "creator_id": row["creator_id"] or "",
                "creator_name": row["creator_name"] or "",
                "created_at": row["created_at"].isoformat() if row["created_at"] else "",
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else "",
                "config_versions": config_versions,
            },
        }


@router.post("/session/config/{session_id}")
def update_session_config(session_id: int, payload: UploadSessionUpdatePayload) -> dict[str, Any]:
    """更新会话配置，并创建新版本"""
    if session_id <= 0:
        raise HTTPException(status_code=400, detail="无效会话ID")
    
    op = str(payload.operator_id or "").strip() or "demo_001"
    
    with db_conn() as conn:
        try:
            # 检查会话是否存在
            exist_row = conn.execute(
                "SELECT id FROM upload_session WHERE id = %s AND is_deleted = FALSE",
                (session_id,),
            ).fetchone()
            if not exist_row:
                raise HTTPException(status_code=404, detail="会话不存在或已删除")
            
            # 更新会话配置
            conn.execute(
                """
                UPDATE upload_session
                SET import_options = %s, display_mode = %s,
                    session_name = COALESCE(%s, session_name),
                    updated_at = NOW()
                WHERE id = %s
                """,
                (
                    payload.import_options,
                    payload.display_mode,
                    payload.session_name,
                    session_id,
                ),
            )
            
            # 创建新配置版本
            config_row = conn.execute(
                """
                INSERT INTO session_config_version (
                    session_id, version_name, import_options, display_mode,
                    creator_id, creator_name
                ) VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, created_at
                """,
                (
                    session_id,
                    f"配置变更 {datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
                    payload.import_options,
                    payload.display_mode,
                    op,
                    _get_user_name(conn, op),
                ),
            ).fetchone()
            
            conn.commit()
        except Exception as e:
            if "不存在" in str(e) or "404" in str(e):
                raise
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        return {
            "ok": True,
            "config_version_id": config_row["id"],
            "created_at": config_row["created_at"].isoformat() if config_row["created_at"] else "",
        }


@router.get("/session/configs/{session_id}")
def list_session_configs(session_id: int) -> dict[str, Any]:
    """获取会话配置版本列表"""
    if session_id <= 0:
        raise HTTPException(status_code=400, detail="无效会话ID")
    
    with db_conn() as conn:
        try:
            rows = conn.execute(
                """
                SELECT id, session_id, version_name, import_options, display_mode,
                       is_active, creator_name, created_at
                FROM session_config_version
                WHERE session_id = %s
                ORDER BY created_at DESC
                """,
                (session_id,),
            ).fetchall()
        except Exception:
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        items = [
            {
                "id": r["id"],
                "session_id": r["session_id"],
                "version_name": r["version_name"] or "",
                "import_options": r["import_options"] or {},
                "display_mode": r["display_mode"] or "chart",
                "is_active": r["is_active"] or False,
                "creator_name": r["creator_name"] or "",
                "created_at": r["created_at"].isoformat() if r["created_at"] else "",
            }
            for r in rows
        ]
        
        return {"items": items, "total": len(items), "session_id": session_id}


@router.post("/session/config/apply/{config_id}")
def apply_config_version(config_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    """应用指定配置版本"""
    if config_id <= 0:
        raise HTTPException(status_code=400, detail="无效配置版本ID")
    
    with db_conn() as conn:
        try:
            # 获取配置版本
            config_row = conn.execute(
                """
                SELECT id, session_id, import_options, display_mode
                FROM session_config_version
                WHERE id = %s
                """,
                (config_id,),
            ).fetchone()
            
            if not config_row:
                raise HTTPException(status_code=404, detail="配置版本不存在")
            
            session_id = config_row["session_id"]
            
            # 更新会话配置
            conn.execute(
                """
                UPDATE upload_session
                SET import_options = %s, display_mode = %s, updated_at = NOW()
                WHERE id = %s AND is_deleted = FALSE
                """,
                (
                    config_row["import_options"],
                    config_row["display_mode"],
                    session_id,
                ),
            )
            
            # 标记当前版本为活跃
            conn.execute(
                """
                UPDATE session_config_version SET is_active = FALSE WHERE session_id = %s
                """,
                (session_id,),
            )
            conn.execute(
                """
                UPDATE session_config_version SET is_active = TRUE WHERE id = %s
                """,
                (config_id,),
            )
            
            conn.commit()
        except Exception as e:
            if "不存在" in str(e) or "404" in str(e):
                raise
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        return {"ok": True, "config_id": config_id, "session_id": session_id}


@router.post("/delete/{session_id}")
def delete_session(session_id: int, operator_id: str = "demo_001") -> dict[str, Any]:
    """删除会话（软删除）"""
    if session_id <= 0:
        raise HTTPException(status_code=400, detail="无效会话ID")
    
    with db_conn() as conn:
        try:
            row = conn.execute(
                """
                UPDATE upload_session
                SET is_deleted = TRUE, updated_at = NOW()
                WHERE id = %s AND is_deleted = FALSE AND creator_id = %s
                RETURNING id
                """,
                (session_id, operator_id),
            ).fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="会话不存在或无权删除")
            
            conn.commit()
        except Exception as e:
            if "不存在" in str(e) or "404" in str(e):
                raise
            raise HTTPException(status_code=500, detail=_UPLOAD_SCHEMA_HINT)
        
        return {"ok": True, "deleted_id": session_id}