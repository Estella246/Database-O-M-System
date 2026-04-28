from __future__ import annotations

from pydantic import BaseModel, Field


class PermissionPolicyItem(BaseModel):
    role_code: str
    is_pl: bool = False
    node_key: str
    field_key: str
    permission_level: str


class PermissionPolicyBulkPayload(BaseModel):
    items: list[PermissionPolicyItem] = Field(default_factory=list)
    operator_id: str = "admin"