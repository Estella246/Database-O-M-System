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


class TicketsBulkDeletePayload(BaseModel):
    """工作台/补丁管理列表批量删除：与列表接口同一 template_code 与仅看自己创建口径。"""

    operator_id: str = "demo_001"
    ticket_nos: list[str] = Field(default_factory=list)
    template_code: str = "HCS_INCIDENT"