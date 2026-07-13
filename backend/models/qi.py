from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class QiCreatePayload(BaseModel):
    """创建质量改进诉求（提出阶段）。"""
    operator_id: str
    category: str = "质量加固和改进"
    title: str
    related_ticket_no: str = ""
    description: str = ""
    expected_goal: str = ""
    priority: str = "中"
    domain: str = ""
    module_feature: str = ""
    planned_version: str = ""
    reviewer: str = ""
    draft: bool = False  # True=仅暂存为草稿，不进入评审流程


class QiPatchPayload(BaseModel):
    """编辑提出阶段字段（仅 draft / propose 阶段可改）。"""
    operator_id: str
    category: Optional[str] = None
    title: Optional[str] = None
    related_ticket_no: Optional[str] = None
    description: Optional[str] = None
    expected_goal: Optional[str] = None
    priority: Optional[str] = None
    domain: Optional[str] = None
    module_feature: Optional[str] = None
    planned_version: Optional[str] = None
    reviewer: Optional[str] = None


class QiSubmitPayload(BaseModel):
    """阶段流转提交。"""
    operator_id: str
    stage_key: str
    handle_mode: str
    values: dict[str, Any] = {}
    batch: bool = False  # True=批量提交（绕过草稿限制）
    comment: str = ""


class QiSavePayload(BaseModel):
    """阶段草稿保存（不流转，跳过必填）。"""
    operator_id: str
    stage_key: str
    values: dict[str, Any] = {}


class QiProgressItemPayload(BaseModel):
    """新增/更新进展子项。"""
    operator_id: str
    content: str


class QiExportPayload(BaseModel):
    operator_id: str


class QiMigrateLegacyPayload(BaseModel):
    operator_id: str
    force: bool = False
    limit: int = 0
