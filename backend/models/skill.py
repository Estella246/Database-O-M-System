from __future__ import annotations

from typing import Optional, Any
from pydantic import BaseModel, Field


class SkillCreatePayload(BaseModel):
    operator_id: str = "demo_001"
    operator_name: str = ""
    name: str
    description: Optional[str] = None
    api_base_url: str
    api_key: str
    model: str = "gpt-4o"
    max_tokens: int = 4096
    temperature: float = 0.3
    system_prompt: Optional[str] = None
    analysis_prompt_template: str
    input_fields: Optional[dict[str, Any]] = None
    output_format: Optional[dict[str, Any]] = None
    is_enabled: bool = True


class SkillPatchPayload(BaseModel):
    operator_id: str = "demo_001"
    operator_name: str = ""
    name: Optional[str] = None
    description: Optional[str] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    analysis_prompt_template: Optional[str] = None
    input_fields: Optional[dict[str, Any]] = None
    output_format: Optional[dict[str, Any]] = None
    is_enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class SkillTestPayload(BaseModel):
    operator_id: str = "demo_001"


class SkillAnalyzePayload(BaseModel):
    operator_id: str = "demo_001"
    operator_name: str = ""
    ticket_no: str
    custom_input: Optional[dict[str, Any]] = None


class SkillBatchAnalyzePayload(BaseModel):
    operator_id: str = "demo_001"
    operator_name: str = ""
    ticket_nos: list[str] = Field(default_factory=list)