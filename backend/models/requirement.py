from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class RequirementCreatePayload(BaseModel):
    operator_id: str
    title: str
    description: str
    proposer: str
    assignee: str
    related_issues: list[str] = Field(default_factory=list)
    external_req_no: str = ""
    planned_version: str = ""
    planned_date: Optional[str] = None
    priority: int = 5
    category: str = "其他"
    value: str = "质量加固"
    remark: str = ""


class RequirementPatchPayload(BaseModel):
    operator_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    proposer: Optional[str] = None
    assignee: Optional[str] = None
    related_issues: Optional[list[str]] = None
    external_req_no: Optional[str] = None
    planned_version: Optional[str] = None
    planned_date: Optional[str] = None
    priority: Optional[int] = None
    category: Optional[str] = None
    value: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[str] = None
    comment: str = ""


class RequirementExportPayload(BaseModel):
    operator_id: str