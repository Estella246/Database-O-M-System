from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DutyCalendarPutPayload(BaseModel):
    operator_id: str = "admin"
    kind: str = Field(..., description="kernel、control、public_cloud、poc 或 research_version")
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    days: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class DutyCalendarSlotPayload(BaseModel):
    """单条增删：仅操作一条排班，不提交当天完整列表。"""

    operator_id: str = "admin"
    kind: str = Field(..., description="kernel、control、public_cloud、poc 或 research_version")
    date: str = Field(..., description="YYYY-MM-DD")
    account: str = Field(..., min_length=1)
    user_name: str = ""
    shift: str = Field("full", description="full 或 night")


class DutyRotationPutPayload(BaseModel):
    operator_id: str = "admin"
    lists: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class DutySiteOnCallPutPayload(BaseModel):
    operator_id: str = "admin"
    rows: list[dict[str, Any]] = Field(default_factory=list)


class DutyRlOnCallPutPayload(BaseModel):
    operator_id: str = "admin"
    rows: list[dict[str, Any]] = Field(default_factory=list)


class HolidayConfigPutPayload(BaseModel):
    operator_id: str = "admin"
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    days: dict[str, str] = Field(default_factory=dict)