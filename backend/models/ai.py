from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AiConversationCreatePayload(BaseModel):
    operator_id: str = "demo_001"
    title: Optional[str] = None


class AiConversationPatchPayload(BaseModel):
    operator_id: str = "demo_001"
    title: Optional[str] = None


class AiChatPayload(BaseModel):
    operator_id: str = "demo_001"
    content: str


class AiQuickTemplateCreatePayload(BaseModel):
    operator_id: str = "demo_001"
    question: str


class AiQuickTemplatePatchPayload(BaseModel):
    operator_id: str = "demo_001"
    question: str


class LlmConfigPutPayload(BaseModel):
    operator_id: str = "admin"
    items: list[dict[str, str]] = Field(default_factory=list)


class AiUserLlmConfigPutPayload(BaseModel):
    operator_id: str = "demo_001"
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    query_timeout: Optional[int] = None
    max_react_rounds: Optional[int] = None
    max_result_rows: Optional[int] = None
    context_max_token: Optional[int] = None


class LlmTestPayload(BaseModel):
    operator_id: str = "demo_001"