from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class UploadPreviewPayload(BaseModel):
    """前端解析后的预览数据"""
    operator_id: str = "demo_001"
    file_name: str = ""
    sheets: list[dict[str, Any]] = Field(default_factory=list)  # [{name, columns, preview_rows, row_count}]


class UploadCreatePayload(BaseModel):
    """创建会话请求"""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    file_name: str = ""
    session_name: str = ""
    raw_data: dict[str, Any] = Field(default_factory=dict)  # {sheet_name: [rows]}
    available_sheets: list[str] = Field(default_factory=list)
    import_options: dict[str, Any] = Field(default_factory=dict)  # 配置详情
    display_mode: str = "chart"  # chart | table | mixed


class UploadSessionUpdatePayload(BaseModel):
    """更新会话配置"""
    operator_id: str = "demo_001"
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"
    session_name: Optional[str] = None


class SessionConfigCreatePayload(BaseModel):
    """创建配置版本"""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    version_name: str = ""
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"


class UploadSessionItem(BaseModel):
    """会话列表项"""
    id: int
    session_name: str = ""
    file_name: str = ""
    display_mode: str = "chart"
    creator_name: str = ""
    created_at: str = ""
    updated_at: str = ""


class UploadSessionDetail(BaseModel):
    """会话详情"""
    id: int
    session_name: str = ""
    file_name: str = ""
    raw_data: dict[str, Any] = Field(default_factory=dict)
    import_options: dict[str, Any] = Field(default_factory=dict)
    available_sheets: list[str] = Field(default_factory=list)
    display_mode: str = "chart"
    creator_id: str = ""
    creator_name: str = ""
    created_at: str = ""
    updated_at: str = ""
    config_versions: list[dict[str, Any]] = Field(default_factory=list)


class SessionConfigVersionItem(BaseModel):
    """配置版本项"""
    id: int
    session_id: int
    version_name: str = ""
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"
    is_active: bool = True
    creator_name: str = ""
    created_at: str = ""