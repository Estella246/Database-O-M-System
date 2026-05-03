import {
  DUTY_ASSIGNMENTS_STORAGE_KEY,
  DUTY_HOLIDAY_STORAGE_KEY,
  DUTY_ALL_ROTATION_KINDS,
  DUTY_ROTATION_STORAGE_KEY,
  DUTY_SITE_ONCALL_STORAGE_KEY,
  DUTY_RL_ONCALL_STORAGE_KEY,
} from "../constants/duty.js";
import {
  normalizeDutyRotationList,
  normalizeDutySiteOnCallRows,
  normalizeDutyRlOnCallRows,
} from "../utils/normalize.js";

const tickets = [
  ["100000301", "YW20260402001", "开发闭环", "2026-04-02", "华东-上海", "公有云", "李潇雨", "致命", "迁移任务脚本异常。", "open", "Ranya", ""],
  ["100000302", "YW20260402002", "问题审核", "2026-04-03", "华北-北京", "混合云", "Raniak", "严重", "确认消息未展示。", "open", "Raniak", ""],
  ["100000307", "YW20260402003", "开发分析", "2026-04-04", "华南-深圳", "公有云", "Dose", "严重", "数据均值计算偏差。", "open", "Demo User", "demo_001"],
  ["100000304", "YW20260402004", "已关闭", "2026-04-05", "西南-成都", "轻量化", "", "致命", "体位校验失败，已闭环。", "closed", "Dose", ""],
  ["100000308", "YW20260410001", "问题审核", "2026-04-10", "华北-北京", "公有云", "Dose", "一般", "演示走单 A。", "open", "Demo User", "demo_001"],
  ["100000309", "YW20260410002", "问题审核", "2026-04-10", "华北-北京", "公有云", "Dose", "一般", "演示走单 B。", "open", "Demo User", "demo_001"],
  ["100000310", "YW20260411001", "运维分析", "2026-04-11", "华北-北京", "公有云", "Dose", "一般", "演示走单 C。", "open", "Demo User", "demo_001"],
];
let ticketList = tickets.map((r) => ({
  orderId: r[0],
  processId: r[1],
  currentStage: r[2],
  startDate: r[3],
  location: r[4],
  bizEnv: r[5],
  currentHandler: r[6],
  severity: r[7],
  description: r[8],
  status: r[9] || "open",
  node: r[2],
  assignee: r[6],
  creatorName: r[10] || r[6],
  creatorId: r[11] != null && String(r[11]).trim() !== "" ? String(r[11]).trim() : "",
  createdAt: `${r[3]}T12:00:00.000Z`,
  node_key: "",
  operatorSubmitted: false,
}));

function loadOperatorBadgePos() {
  try {
    const raw = window.localStorage.getItem("operator_badge_pos");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  } catch (_) {
    return null;
  }
}

const workflowByOrderId = {
  "100000301": {
    currentStep: 4,
    logs: [
      { step: "问题填写", actor: "Ranya", at: "2026-04-02 09:05", summary: "提交问题单并补充初始信息。" },
      { step: "问题审核", actor: "Ranya", at: "2026-04-02 09:20", summary: "已确认问题范围，转运维分析。" },
      { step: "运维分析", actor: "Dose", at: "2026-04-02 10:05", summary: "定位到迁移任务脚本异常，转开发分析。" },
      { step: "开发分析", actor: "Raniak", at: "2026-04-02 11:32", summary: "确认兼容性缺陷，已安排修复并进入开发闭环。" },
    ],
  },
  "100000302": {
    currentStep: 2,
    logs: [
      { step: "问题填写", actor: "Raniak", at: "2026-04-03 13:50", summary: "发起问题并填写基础信息。" },
      { step: "问题审核", actor: "Ranya", at: "2026-04-03 14:15", summary: "审核通过，流转至运维分析。" },
    ],
  },
  "100000307": {
    currentStep: 3,
    logs: [
      { step: "问题填写", actor: "Dose", at: "2026-04-04 08:45", summary: "提交问题并补充影响范围。" },
      { step: "问题审核", actor: "Dose", at: "2026-04-04 09:10", summary: "问题已受理。" },
      { step: "运维分析", actor: "Dose", at: "2026-04-04 11:20", summary: "初步排查后需要开发介入。" },
    ],
  },
  "100000304": {
    currentStep: 5,
    logs: [
      { step: "问题填写", actor: "Dose", at: "2026-04-05 08:30", summary: "提交问题单并附现场信息。" },
      { step: "问题审核", actor: "Dose", at: "2026-04-05 08:50", summary: "审核完成并进入运维分析。" },
      { step: "运维分析", actor: "Dose", at: "2026-04-05 09:40", summary: "确认与接口返回数据有关，转开发分析。" },
      { step: "开发分析", actor: "Raniak", at: "2026-04-05 10:35", summary: "修复已发布，进入开发闭环。" },
      { step: "开发闭环", actor: "Raniak", at: "2026-04-05 13:20", summary: "开发闭环完成，提交运维验证。" },
    ],
  },
};
const operationLogsByOrderId = {
  "100000301": [
    { at: "2026-04-02 09:05", actor: "Ranya", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-02 09:20", actor: "Ranya", action: "提交下一节点", from: "问题审核", to: "运维分析" },
    { at: "2026-04-02 10:05", actor: "Dose", action: "提交下一节点", from: "运维分析", to: "开发分析" },
    { at: "2026-04-02 11:32", actor: "Raniak", action: "提交下一节点", from: "开发分析", to: "开发闭环" },
  ],
  "100000302": [
    { at: "2026-04-03 13:50", actor: "Raniak", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-03 14:15", actor: "Ranya", action: "提交下一节点", from: "问题审核", to: "运维分析" },
  ],
  "100000307": [
    { at: "2026-04-04 08:45", actor: "Dose", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-04 09:10", actor: "Dose", action: "提交下一节点", from: "问题审核", to: "运维分析" },
    { at: "2026-04-04 11:20", actor: "Dose", action: "提交下一节点", from: "运维分析", to: "开发分析" },
  ],
  "100000304": [
    { at: "2026-04-05 08:30", actor: "Dose", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-05 08:50", actor: "Dose", action: "提交下一节点", from: "问题审核", to: "运维分析" },
    { at: "2026-04-05 09:40", actor: "Dose", action: "提交下一节点", from: "运维分析", to: "开发分析" },
    { at: "2026-04-05 10:35", actor: "Raniak", action: "提交下一节点", from: "开发分析", to: "开发闭环" },
    { at: "2026-04-05 13:20", actor: "Raniak", action: "提交下一节点", from: "开发闭环", to: "运维闭环" },
  ],
};

const state = {
  openTabs: [{ key: "home", label: "我的主页", closable: false }],
  activeKey: "home",
  logDrawerOpen: false,
  formsByTicket: {},
  ticketStatusByOrderId: {},
  adminPermissions: [],
  adminUsers: [],
  adminLoading: false,
  adminLoaded: false,
  adminMsg: "",
  adminPermissionRole: "",
  adminPermissionEditMode: false,
  adminPermissionDialogOpen: false,
  adminPermissionDraft: {},
  adminPermissionExpandedGroups: {},
  createModalOpen: false,
  createTicketId: "",
  createModalNodeKey: "",
  ticketListLoading: false,
  ticketListLoaded: false,
  listTab: "pending",
  listPage: 1,
  listPageSize: 10,
  listRefreshing: false,
  ticketListFilters: {
    selected: {
      currentStage: [],
      startDate: [],
      severity: [],
      location: [],
      bizEnv: [],
      currentHandler: [],
      description: [],
    },
    search: {
      currentStage: "",
      startDate: "",
      severity: "",
      location: "",
      bizEnv: "",
      currentHandler: "",
      description: "",
    },
    openKey: "",
  },
  homeWorkbenchTab: "pending",
  homeLeavePendingItems: [],
  homeLeavePendingLoading: false,
  homePersonalPreset: "1w",
  homePersonalStart: "",
  homePersonalEnd: "",
  homePersonalPassthroughQuality: "all",
  homePersonalStatsLoading: false,
  homePersonalStatsLoadedKey: "",
  homePersonalStats: null,
  homeListPage: 1,
  homeListPageSize: 10,
  homeTicketListFilters: {
    selected: {
      currentStage: [],
      startDate: [],
      severity: [],
      location: [],
      bizEnv: [],
      currentHandler: [],
      description: [],
    },
    search: {
      currentStage: "",
      startDate: "",
      severity: "",
      location: "",
      bizEnv: "",
      currentHandler: "",
      description: "",
    },
    openKey: "",
  },
  selectedTicketIds: [],
  tabIndicatorFrom: null,
  tabIndicatorLast: null,
  operatorBadgePos: loadOperatorBadgePos(),
  logSyncStateByOrderId: {},
  adminUserEditMode: false,
  adminPermissionFilters: {
    selected: {
      role_code: [],
      is_pl: [],
      node_key: [],
      field_key: [],
      permission_level: [],
    },
    search: {
      role_code: "",
      is_pl: "",
      node_key: "",
      field_key: "",
      permission_level: "",
    },
    openKey: "",
  },
  adminUserFilters: {
    selected: {
      account: [],
      user_name: [],
      role_code: [],
      group_name: [],
      is_pl: [],
    },
    search: {
      account: "",
      user_name: "",
      role_code: "",
      group_name: "",
      is_pl: "",
    },
    openKey: "",
  },
  dutyCalendarYm: (() => {
    const t = new Date();
    const y = t.getFullYear();
    const m = t.getMonth() + 1;
    return { kernel: { year: y, month: m }, control: { year: y, month: m } };
  })(),
  dutyHolidayYm: (() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() + 1 };
  })(),
  dutyEditMode: { kernel: false, control: false },
  dutyHolidayEditMode: false,
  dutyAssignments: (() => {
    try {
      const raw = window.localStorage.getItem(DUTY_ASSIGNMENTS_STORAGE_KEY);
      if (!raw) return { kernel: {}, control: {} };
      const p = JSON.parse(raw);
      return {
        kernel: p.kernel && typeof p.kernel === "object" ? p.kernel : {},
        control: p.control && typeof p.control === "object" ? p.control : {},
      };
    } catch (_) {
      return { kernel: {}, control: {} };
    }
  })(),
  dutyHolidayDays: (() => {
    try {
      const raw = window.localStorage.getItem(DUTY_HOLIDAY_STORAGE_KEY);
      if (!raw) return {};
      const p = JSON.parse(raw);
      return p && typeof p === "object" ? p : {};
    } catch (_) {
      return {};
    }
  })(),
  dutyDayModal: null,
  dutyCalendarLoadedKey: "",
  dutyCalendarSyncPending: false,
  dutyHolidayLoadedKey: "",
  dutyHolidaySyncPending: false,
  dutyRosterExtrasLoadedKey: "",
  dutyRosterExtrasSyncPending: false,
  dutyRotationEditMode: (() => {
    const o = {};
    DUTY_ALL_ROTATION_KINDS.forEach((k) => {
      o[k] = false;
    });
    return o;
  })(),
  dutyRotationLists: (() => {
    const lists = {};
    DUTY_ALL_ROTATION_KINDS.forEach((k) => {
      lists[k] = [];
    });
    try {
      const raw = window.localStorage.getItem(DUTY_ROTATION_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        DUTY_ALL_ROTATION_KINDS.forEach((k) => {
          if (p[k] != null) lists[k] = normalizeDutyRotationList(p[k]);
        });
      }
    } catch (_) {}
    return lists;
  })(),
  dutySpecialSubmenuExpanded: false,
  dutySuppressMainScrollRestore: false,
  dutySiteOnCallEditMode: false,
  dutySiteOnCallRows: (() => {
    try {
      const raw = window.localStorage.getItem(DUTY_SITE_ONCALL_STORAGE_KEY);
      if (!raw) return [];
      return normalizeDutySiteOnCallRows(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  })(),
  dutyRlOnCallEditMode: false,
  dutyRlOnCallRows: (() => {
    try {
      const raw = window.localStorage.getItem(DUTY_RL_ONCALL_STORAGE_KEY);
      if (!raw) return [];
      return normalizeDutyRlOnCallRows(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  })(),
  leaveTab: "all",
  leaveSearch: "",
  leaveList: [],
  leaveListLoading: false,
  leaveApproverWhitelist: [],
  leaveCreateOpen: false,
  leaveWhitelistModalOpen: false,
  leaveDetailId: null,
  leaveDetailBundle: null,
  leaveDetailLoading: false,
  leaveDraftSegKey: 1,
  leaveCreateSegments: [],
  leaveCreateType: "",
  leaveCreateApprover: "",
  leaveCreateCc: "",
  leaveNeedsRefresh: false,
  leaveBatchSelectedIds: [],
  leaveBatchApprovalModalOpen: false,
  reqTab: "all",
  reqSearch: "",
  reqList: [],
  reqListLoading: false,
  reqListTotal: 0,
  reqListPage: 1,
  reqListPageSize: 10,
  reqCreateOpen: false,
  reqDetailId: null,
  reqDetailBundle: null,
  reqDetailLoading: false,
  reqDetailLogs: [],
  reqDetailLogsLoading: false,
  reqNeedsRefresh: false,
  reqEditOpen: false,
  reqStatusChangeOpen: false,
  reqDraftRelatedIssues: [""],
  reqAnalyticsLoading: false,
  reqAnalyticsData: null,
  reqAnalyticsPreset: "3m",
  reqAnalyticsStart: "",
  reqAnalyticsEnd: "",
  reqAnalyticsPrecision: "week",
  dutyFieldTree: [],
  dutyFieldTreeLoading: false,
  dutyFieldTreeSaving: false,
  dutyFieldTreeMsg: "",
  dutyFieldNeedsRefresh: false,
  dutyFieldEditMode: false,
  dutyFieldCollapsedPaths: new Set(),
  versionSubTab: "baseline",
  versionBaselineList: [],
  versionHotfixList: [],
  versionBaselineOrig: null,
  versionBaselineDraft: null,
  versionHotfixOrig: null,
  versionHotfixDraft: null,
  versionBaselineEditMode: false,
  versionHotfixEditMode: false,
  versionBaselineSearch: "",
  versionHotfixSearch: "",
  versionBaselineLoading: false,
  versionHotfixLoading: false,
  versionBaselineSaving: false,
  versionHotfixSaving: false,
  versionMsg: "",
  versionNeedsRefresh: false,
  groupTemplateItems: [],
  groupTemplateDraft: null,
  groupTemplateEditMode: false,
  groupTemplateLoading: false,
  groupTemplateSaving: false,
  groupTemplateMsg: "",
  groupTemplateActiveKind: "major",
  groupTemplateNeedsRefresh: false,
  groupPullModalOpen: false,
  groupPullLoading: false,
  groupPullActiveKind: "major",
  groupPullLocal: null,
  statsChartsTab: "labor",
  statsReportPeriod: "week",
  statsSkillsList: [],
  statsSkillsLoading: false,
  statsSkillsSelectedId: null,
  statsSkillsEditModalOpen: false,
  statsSkillsEditMode: "create",
  statsSkillsEditForm: {
    name: "",
    description: "",
    api_base_url: "",
    api_key: "",
    model: "gpt-4o",
    max_tokens: 4096,
    temperature: 0.3,
    system_prompt: "",
    analysis_prompt_template: "",
    input_fields: null,
    output_format: null,
    is_enabled: true,
  },
  statsSkillsTestLoading: false,
  statsSkillsTestResult: null,
  statsLaborPreset: "1w",
  statsLaborStart: "",
  statsLaborEnd: "",
  statsLaborInputGroup: "",
  statsLaborInputCollab: "yes",
  statsLaborOpenHoldPersonGroup: "",
  statsLaborOpenHoldPersonStage: "",
  statsLaborOpenHoldStageGroup: "",
  statsLaborGroupStackGroup: "",
  statsLaborAvgDwellGroup: "",
  statsLaborAvgDwellQuality: "all",
  statsLaborPersonDwellGroup: "",
  statsLaborPersonDwellModule: "all",
  statsLaborInterceptQuality: "all",
  statsLaborCommandoFlowQuality: "all",
  statsLaborFlowDetailQuality: "all",
  statsLaborFlowDetailGroup: "",
  uploadSessions: [],
  uploadSessionsLoaded: false,
  currentUploadSession: null,
  uploadSessionConfig: null,
  uploadDataPreview: null,
  uploadShowConfigModal: false,
  uploadSelectedSheets: [],
  uploadSelectedColumns: {},
  uploadDisplayMode: "chart",
  uploadChartType: "bar",
  uploadAvgColumns: [],
  uploadNameColumn: "",
  uploadBrowseTab: "overview",
  uploadAggregateMode: "sum",
  uploadColumnWeights: {},
  uploadEnableWeightedSum: false,
  statsOwnershipPreset: "1w",
  statsOwnershipStart: "",
  statsOwnershipEnd: "",
  statsOwnershipPrecision: "month",
  statsOwnershipQuality: "all",
  statsOwnershipComponent: "all",
  statsOwnershipSunburstKind: "intro",
  statsOwnershipL1Class: "owner",
  statsOwnershipL1ModuleFilter: "storage",
  statsOwnershipL1DtsDedup: "yes",
  statsOwnershipTopSiteN: 10,
  statsOwnershipTopInstanceSiteN: 10,
  statsOwnershipTopModuleKind: "owner",
  statsOwnershipHotspotKind: "owner",
  aiConversations: [],
  aiConversationsLoading: false,
  aiActiveConvId: null,
  aiMessages: [],
  aiMessagesLoading: false,
  aiChatLoading: false,
  aiChatError: "",
  aiWorkStatus: "idle",
  aiTokenStats: { prompt: 0, completion: 0, total: 0 },
  aiQuickTemplates: [],
  aiQuickTemplatesLoading: false,
  aiQuickAddOpen: false,
  aiUserConfigModalOpen: false,
  aiUserConfigLoading: false,
  aiUserConfigSaving: false,
  aiUserConfigMsg: "",
  aiUserConfigData: null,
  aiNeedsRefresh: false,
  aiLlmConfigItems: [],
  aiLlmConfigLoading: false,
  aiLlmConfigSaving: false,
  aiLlmConfigMsg: "",
  aiLlmConfigTestResult: null,
  aiLlmConfigTesting: false,
};

const TEMP_AUTO_FILL_ALL_FIELDS = true;

export { tickets, ticketList, workflowByOrderId, operationLogsByOrderId, state, TEMP_AUTO_FILL_ALL_FIELDS };
