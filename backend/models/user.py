from __future__ import annotations

from pydantic import BaseModel, Field


class UserAccountItem(BaseModel):
    account: str
    user_name: str
    role_code: str
    group_name: str
    email: str = ""
    contact_phone: str = ""
    product_line: str = ""
    min_dept: str = ""
    remark: str = ""
    is_active: bool = True


class UserAccountBulkPayload(BaseModel):
    items: list[UserAccountItem] = Field(default_factory=list)
    operator_id: str = "admin"