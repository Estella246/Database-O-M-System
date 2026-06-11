from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class RequirementCreatePayload(BaseModel):
    operator_id: str
    category: str = "质量加固和改进"
    represent_issue: str = ""
    domain: str = ""
    module_feature: str = ""
    description: str = ""
    improvement: str
    priority: str = "中"
    proposer: str
    status: str = "已接纳"
    planned_version: str = ""


class RequirementPatchPayload(BaseModel):
    operator_id: str
    category: Optional[str] = None
    represent_issue: Optional[str] = None
    domain: Optional[str] = None
    module_feature: Optional[str] = None
    description: Optional[str] = None
    improvement: Optional[str] = None
    priority: Optional[str] = None
    proposer: Optional[str] = None
    status: Optional[str] = None
    planned_version: Optional[str] = None
    comment: str = ""


class RequirementExportPayload(BaseModel):
    operator_id: str


class RequirementImportPayload(BaseModel):
    operator_id: str
