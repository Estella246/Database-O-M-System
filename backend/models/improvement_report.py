from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ImprovementReportSectionPutPayload(BaseModel):
    operator_id: str = ""
    section: str  # overview / overall / domain / monthly_new
    data: dict[str, Any]


class ImprovementReportArchivePayload(BaseModel):
    operator_id: str = ""
    title: str = ""
