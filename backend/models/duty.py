from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DutyCalendarPutPayload(BaseModel):
    operator_id: str = "admin"
    kind: str = Field(..., description="kernel、control、public_cloud、poc 或 research_version")
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    days: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


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