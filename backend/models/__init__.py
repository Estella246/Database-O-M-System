from __future__ import annotations

from models.ticket import SubmitPayload
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
from models.requirement import RequirementCreatePayload, RequirementPatchPayload
from models.params import (
    DutyFieldNodeInput,
    DutyFieldTreePutPayload,
    BaselineVersionCreatePayload,
    BaselineVersionPatchPayload,
    HotfixVersionCreatePayload,
    HotfixVersionPatchPayload,
    GroupTemplateItemIn,
    GroupTemplatePutPayload,
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
from models.upload import (
    UploadPreviewPayload,
    UploadCreatePayload,
    UploadSessionUpdatePayload,
    SessionConfigCreatePayload,
    UploadSessionItem,
    UploadSessionDetail,
    SessionConfigVersionItem,
)