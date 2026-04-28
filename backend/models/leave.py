from __future__ import annotations

from pydantic import BaseModel, Field


class LeaveTimeSegmentIn(BaseModel):
    start_at: str
    end_at: str
    reason: str = ""


class LeaveApplicationCreatePayload(BaseModel):
    operator_id: str
    application_type: str
    segments: list[LeaveTimeSegmentIn] = Field(default_factory=list)
    approver_account: str
    cc_accounts: list[str] = Field(default_factory=list)


class LeaveActionPayload(BaseModel):
    operator_id: str
    action: str
    comment: str = ""


class LeaveApproverWhitelistPutPayload(BaseModel):
    operator_id: str = "admin"
    accounts: list[str] = Field(default_factory=list)