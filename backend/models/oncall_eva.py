from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class OncallExtraCreatePayload(BaseModel):
    operator_id: str
    account: str = ""
    period_year: int
    period_month: int
    category: str
    description: str
    declared_score: float = 0
    evidence_url: str = ""


class OncallExtraReviewPayload(BaseModel):
    operator_id: str
    status: str  # approved / rejected
    review_comment: str = ""
    is_excellent: bool = False
    declared_score: Optional[float] = None


class OncallEventCreatePayload(BaseModel):
    operator_id: str
    account: str
    period_year: int
    period_month: int
    kind: str  # red / black
    score: float
    summary: str
    evidence_url: str = ""
