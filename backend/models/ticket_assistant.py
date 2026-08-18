from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class TicketAssistantCreatePayload(BaseModel):
    form_values: dict[str, Any] = Field(default_factory=dict)
    initial_message: str = Field(
        default="",
        description="纯对话开聊：无表单时用首条用户消息作为 session.create 首聊内容",
    )
    title: str = Field(default="", description="可选会话标题（如工单问诊 YW…）")
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    model_name: str = ""


class TicketAssistantChatPayload(BaseModel):
    content: str = ""
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    model_name: str = ""


class TicketAssistantAnswerPayload(BaseModel):
    """九问 ask_user / 权限确认作答，续跑对话。"""

    request_id: str = ""
    answers: list[dict[str, Any]] = Field(default_factory=list)
    source: str = "ask_user_interrupt"
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    model_name: str = ""
    approval_schema: str = ""
    evolution_meta: Optional[dict[str, Any]] = None
    plan_approval_kind: str = ""
    plan_content: str = ""
    plan_language: str = ""


class TicketAssistantInterruptPayload(BaseModel):
    """对齐九问 chat.interrupt；提单助手停止生成用 intent=cancel。"""

    operator_id: str = "demo_001"
    intent: str = "cancel"
    mode: str = "agent"


class TicketAssistantTransferPayload(BaseModel):
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    next_node_key: Optional[str] = "problem_review"
