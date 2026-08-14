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
    expert_domain: str = ""
    min_dept: str = ""
    remark: str = ""
    is_active: bool = True
    # 改账号时带上编辑前的账号，便于后端按原行更新而非误插入新行
    original_account: str = ""


class UserAccountBulkPayload(BaseModel):
    items: list[UserAccountItem] = Field(default_factory=list)
    operator_id: str = "admin"