from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class TicketAssistantCreatePayload(BaseModel):
    form_values: dict[str, Any] = Field(default_factory=dict)
    initial_message: str = Field(
        default="",
        description="纯对话开聊：无表单时用首条用户消息作为 session.create 首聊内容",
    )
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    model_name: str = ""


class TicketAssistantChatPayload(BaseModel):
    content: str = ""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    model_name: str = ""


class TicketAssistantTransferPayload(BaseModel):
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    next_node_key: Optional[str] = "problem_review"
