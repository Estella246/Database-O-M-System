from __future__ import annotations

from models.ticket import SubmitPayload, TicketsBulkDeletePayload
from models.permission import PermissionPolicyItem, PermissionPolicyBulkPayload
from models.user import UserAccountItem, UserAccountBulkPayload
from models.duty import (
    DutyCalendarPutPayload,
    DutyRotationPutPayload,
    DutySiteOnCallPutPayload,
    DutyRlOnCallPutPayload,
    HolidayConfigPutPayload,
)
from models.leave import (
    LeaveTimeSegmentIn,
    LeaveApplicationCreatePayload,
    LeaveActionPayload,
    LeaveApproverWhitelistPutPayload,
)
from models.requirement import RequirementCreatePayload, RequirementPatchPayload, RequirementExportPayload, RequirementImportPayload
from models.params import (
    DutyFieldNodeInput,
    DutyFieldTreePutPayload,
    BaselineVersionCreatePayload,
    BaselineVersionPatchPayload,
    HotfixVersionCreatePayload,
    HotfixVersionPatchPayload,
    GroupTemplateItemIn,
    GroupTemplatePutPayload,
    IssueRootCauseItemIn,
    IssueRootCausePutPayload,
)
from models.ai import (
    AiConversationCreatePayload,
    AiConversationPatchPayload,
    AiChatPayload,
    AiQuickTemplateCreatePayload,
    AiQuickTemplatePatchPayload,
    LlmConfigPutPayload,
    AiUserLlmConfigPutPayload,
    LlmTestPayload,
)
from models.skill import (
    SkillCreatePayload,
    SkillPatchPayload,
    SkillTestPayload,
    SkillAnalyzePayload,
    SkillBatchAnalyzePayload,
)
from models.upload import (
    UploadPreviewPayload,
    UploadCreatePayload,
    UploadSessionUpdatePayload,
    SessionConfigCreatePayload,
    UploadSessionItem,
    UploadSessionDetail,
    SessionConfigVersionItem,
)
from models.oncall_eva import (
    OncallExtraCreatePayload,
    OncallExtraReviewPayload,
    OncallEventCreatePayload,
)
from models.monthly_report import (
    MonthlyReportSectionPutPayload,
    MonthlyReportArchivePayload,
)