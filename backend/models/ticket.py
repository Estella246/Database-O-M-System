from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class SubmitPayload(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    next_node_key: Optional[str] = None
    """新建工单时指定流程模板；已有工单以库内 template_id 为准。"""
    template_code: Optional[str] = None
    """创建弹窗首次流转提交为 true：单号已被占用时服务端按全局序号 a 重新取号建单。"""
    create_intent: bool = False
    """仅保存草稿：跳过必填校验，不推进流程（工作台「保存」按钮）。"""
    save_only: bool = False


class AllocateTicketNoPayload(BaseModel):
    """脚本/工具预取流程号；工作台创建弹窗在首次 submit 时取号。"""

    template_code: Optional[str] = "HCS_INCIDENT"


class TicketsBulkDeletePayload(BaseModel):
    """工作台/补丁管理列表批量删除：与列表接口同一 template_code 与仅看自己创建口径。"""

    operator_id: str = "demo_001"
    ticket_nos: list[str] = Field(default_factory=list)
    template_code: str = "HCS_INCIDENT"


class TicketSnapshotListQuery(BaseModel):
    """工作台 HCS 快照列表 POST 查询：列筛选项多时避免 GET query 过长。"""

    operator_id: str = "demo_001"
    operator_name: str = ""
    q: str = ""
    ticket_no: str = ""
    created_from: str = ""
    created_to: str = ""
    template_code: str = "HCS_INCIDENT"
    page: int = 1
    page_size: int = 20
    tab: str = "all"
    column_filters: dict[str, list[str]] = Field(default_factory=dict)


class TicketFacetsQuery(BaseModel):
    """工作台 HCS facets POST 查询：与列表同上下文，column_filters 走 body。"""

    operator_id: str = "demo_001"
    operator_name: str = ""
    column: str
    q: str = ""
    created_from: str = ""
    created_to: str = ""
    tab: str = "all"
    template_code: str = "HCS_INCIDENT"
    prefix: str = ""
    column_filters: dict[str, list[str]] = Field(default_factory=dict)