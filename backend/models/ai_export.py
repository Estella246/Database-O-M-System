from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class TransformRule(BaseModel):
    type: Literal["mapping", "llm_reasoning", "computed"]
    target_column: str
    # mapping 专属
    source_column: Optional[str] = None
    mapping: Optional[dict[str, str]] = None
    value_range: Optional[list[str]] = None
    # llm_reasoning 专属
    source_columns: Optional[list[str]] = None
    reasoning_instruction: Optional[str] = None
    # computed 专属
    expression: Optional[str] = None
    params: Optional[dict] = None


class TransformRules(BaseModel):
    transform_rules: list[TransformRule]


class AiExportTaskCreatePayload(BaseModel):
    operator_id: str = "demo_001"
    source_config: Optional[dict] = None
    original_columns: list[str] = Field(default_factory=list)
    natural_description: str = ""
    where_sql: str = ""


class AiExportTranslateRulesPayload(BaseModel):
    operator_id: str = "demo_001"
    rule_description: str


class AiExportStartProcessingPayload(BaseModel):
    operator_id: str = "demo_001"


class AiExportCancelPayload(BaseModel):
    operator_id: str = "demo_001"


class AiExportGenerateReportPayload(BaseModel):
    operator_id: str = "demo_001"
    report_prompt: str




class AiExportQueryByDescriptionPayload(BaseModel):
    operator_id: str = "demo_001"
    description: str
    template_code: str = ""


class AiExportPreviewRowsPayload(BaseModel):
    operator_id: str = "demo_001"
    where_sql: str
    template_code: str = ""