from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class MonthlyReportSectionPutPayload(BaseModel):
    operator_id: str = ""
    section: str  # overview / insight / major / improve / links
    data: dict[str, Any]


class MonthlyReportArchivePayload(BaseModel):
    operator_id: str = ""
    title: str = ""
