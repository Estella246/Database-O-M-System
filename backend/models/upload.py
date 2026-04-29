from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# 常量定义
MAX_PREVIEW_ROWS = 50
NAME_COLUMN_CANDIDATES = ["名称", "姓名", "名字", "name", "人员", "同学", "员工姓名", "员工"]
DATE_COLUMN_PATTERNS = ["日期", "时间", "date", "time", "created", "updated"]
VALID_DISPLAY_MODES = ("chart", "table", "mixed", "last", "custom")
VALID_CHART_TYPES = ("bar", "line", "pie", "scatter")
VALID_AGGREGATE_MODES = ("sum", "avg", "single")


class UploadPreviewPayload(BaseModel):
    """前端解析后的预览数据"""
    operator_id: str = "demo_001"
    file_name: str = ""
    sheets: list[dict[str, Any]] = Field(default_factory=list)  # [{name, columns, preview_rows, row_count}]


class SheetInfo(BaseModel):
    """Sheet信息"""
    name: str = ""
    columns: list[str] = Field(default_factory=list)
    row_count: int = 0
    preview_rows: list[dict[str, Any]] = Field(default_factory=list)
    dtypes: dict[str, str] = Field(default_factory=dict)
    missing_counts: dict[str, int] = Field(default_factory=dict)
    numeric_columns: list[str] = Field(default_factory=list)
    date_columns: list[str] = Field(default_factory=list)


class ColumnConfig(BaseModel):
    """列配置"""
    name: str = ""
    display_name: str = ""
    column_type: str = "text"  # text | numeric | date
    chart_type: str = "bar"
    is_avg: bool = False
    is_selected: bool = True


class UploadCreatePayload(BaseModel):
    """创建会话请求"""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    file_name: str = ""
    session_name: str = ""
    raw_data: dict[str, Any] = Field(default_factory=dict)  # {sheet_name: [rows]}
    available_sheets: list[str] = Field(default_factory=list)
    selected_sheets: list[str] = Field(default_factory=list)
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"
    # 新增字段
    columns: list[str] = Field(default_factory=list)
    selected_columns: list[str] = Field(default_factory=list)
    display_names: dict[str, str] = Field(default_factory=dict)
    column_types: dict[str, str] = Field(default_factory=dict)
    chart_types: dict[str, str] = Field(default_factory=dict)
    avg_columns: list[str] = Field(default_factory=list)
    name_column: str = ""
    aggregate_mode: str = "sum"  # sum | avg | single
    preview_rows: list[dict[str, Any]] = Field(default_factory=list)
    numeric_describe: dict[str, Any] = Field(default_factory=dict)


class UploadSessionUpdatePayload(BaseModel):
    """更新会话配置"""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    session_name: Optional[str] = None
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"
    # 新增字段
    selected_sheets: list[str] = Field(default_factory=list)
    selected_columns: list[str] = Field(default_factory=list)
    display_names: dict[str, str] = Field(default_factory=dict)
    column_types: dict[str, str] = Field(default_factory=dict)
    chart_types: dict[str, str] = Field(default_factory=dict)
    avg_columns: list[str] = Field(default_factory=list)
    name_column: str = ""
    aggregate_mode: str = "sum"
    version_name: str = ""


class SessionConfigCreatePayload(BaseModel):
    """创建配置版本"""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    session_id: int = 0
    version_name: str = ""
    config_name: str = ""
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"
    selected_sheets: list[str] = Field(default_factory=list)
    selected_columns: list[str] = Field(default_factory=list)
    display_names: dict[str, str] = Field(default_factory=dict)
    column_types: dict[str, str] = Field(default_factory=dict)
    chart_types: dict[str, str] = Field(default_factory=dict)
    avg_columns: list[str] = Field(default_factory=list)
    name_column: str = ""
    aggregate_mode: str = "sum"


class UploadSessionItem(BaseModel):
    """会话列表项"""
    id: int
    session_name: str = ""
    file_name: str = ""
    display_mode: str = "chart"
    creator_name: str = ""
    created_at: str = ""
    updated_at: str = ""
    row_count: int = 0
    col_count: int = 0
    sheet_count: int = 0


class UploadSessionDetail(BaseModel):
    """会话详情"""
    id: int
    session_name: str = ""
    file_name: str = ""
    raw_data: dict[str, Any] = Field(default_factory=dict)
    import_options: dict[str, Any] = Field(default_factory=dict)
    available_sheets: list[str] = Field(default_factory=list)
    selected_sheets: list[str] = Field(default_factory=list)
    display_mode: str = "chart"
    creator_id: str = ""
    creator_name: str = ""
    created_at: str = ""
    updated_at: str = ""
    config_versions: list[dict[str, Any]] = Field(default_factory=list)
    config_count: int = 0
    # 新增字段
    row_count: int = 0
    col_count: int = 0
    columns: list[str] = Field(default_factory=list)
    selected_columns: list[str] = Field(default_factory=list)
    display_names: dict[str, str] = Field(default_factory=dict)
    column_types: dict[str, str] = Field(default_factory=dict)
    chart_types: dict[str, str] = Field(default_factory=dict)
    avg_columns: list[str] = Field(default_factory=list)
    name_column: str = ""
    aggregate_mode: str = "sum"
    preview_rows: list[dict[str, Any]] = Field(default_factory=list)
    numeric_describe: dict[str, Any] = Field(default_factory=dict)
    date_columns: list[str] = Field(default_factory=list)


class SessionConfigVersionItem(BaseModel):
    """配置版本项"""
    id: int
    session_id: int
    version_name: str = ""
    config_name: str = ""
    import_options: dict[str, Any] = Field(default_factory=dict)
    display_mode: str = "chart"
    selected_sheets: list[str] = Field(default_factory=list)
    selected_columns: list[str] = Field(default_factory=list)
    display_names: dict[str, str] = Field(default_factory=dict)
    column_types: dict[str, str] = Field(default_factory=dict)
    chart_types: dict[str, str] = Field(default_factory=dict)
    avg_columns: list[str] = Field(default_factory=list)
    name_column: str = ""
    aggregate_mode: str = "sum"
    is_active: bool = True
    creator_name: str = ""
    created_at: str = ""


class PreviewResponse(BaseModel):
    """预览响应"""
    ok: bool = True
    file_name: str = ""
    sheets: list[SheetInfo] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    # 新增字段
    total_rows: int = 0
    total_cols: int = 0
    sheet_count: int = 0
    date_columns: list[str] = Field(default_factory=list)
    name_column_candidates: list[str] = Field(default_factory=list)
    numeric_describe: dict[str, Any] = Field(default_factory=dict)
    preview_truncated: bool = False


class UploadSessionCreateResponse(BaseModel):
    """创建会话响应"""
    ok: bool = True
    session_id: int
    config_version_id: int
    created_at: str = ""
    summary: dict[str, Any] = Field(default_factory=dict)