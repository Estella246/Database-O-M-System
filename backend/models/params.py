from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DutyFieldNodeInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    label: str = ""
    owner: str = ""
    children: list["DutyFieldNodeInput"] = Field(default_factory=list)


DutyFieldNodeInput.model_rebuild()


class DutyFieldTreePutPayload(BaseModel):
    operator_id: str = "admin"
    nodes: list[DutyFieldNodeInput] = Field(default_factory=list)


class BaselineVersionCreatePayload(BaseModel):
    operator_id: str = "admin"
    version_label: str
    commit_hash: str = ""
    sort_order: Optional[int] = None


class BaselineVersionPatchPayload(BaseModel):
    operator_id: str = "admin"
    version_label: Optional[str] = None
    commit_hash: Optional[str] = None
    sort_order: Optional[int] = None


class HotfixVersionCreatePayload(BaseModel):
    operator_id: str = "admin"
    baseline_id: int
    hotfix_label: str
    sort_order: Optional[int] = None


class HotfixVersionPatchPayload(BaseModel):
    operator_id: str = "admin"
    baseline_id: Optional[int] = None
    hotfix_label: Optional[str] = None
    sort_order: Optional[int] = None


class GroupTemplateItemIn(BaseModel):
    problem_kind: str
    group_name_tpl: str = ""
    group_notice_tpl: str = ""
    group_members_tpl: str = ""
    first_report_tpl: str = ""


class GroupTemplatePutPayload(BaseModel):
    operator_id: str = "admin"
    items: list[GroupTemplateItemIn] = Field(default_factory=list)


class IssueRootCauseItemIn(BaseModel):
    issue_type: str
    categories: list[str] = Field(default_factory=list)


class IssueRootCausePutPayload(BaseModel):
    operator_id: str = "admin"
    items: list[IssueRootCauseItemIn] = Field(default_factory=list)