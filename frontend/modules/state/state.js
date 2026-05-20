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

// 工单数据从后端 API 获取，此处不再硬编码模拟数据
// 测试数据可通过 scripts/generate_test_tickets.py 生成
const tickets = [];
let ticketList = [];

// 流程日志从后端 API 获取，此处不再硬编码模拟数据
const workflowByOrderId = {};
const operationLogsByOrderId = {};

const state = {
  openTabs: [{ key: "home", label: "我的主页", closable: false }],
  activeKey: "home",
  logDrawerOpen: false,
  /** 工单详情：用户通过顶栏进度条点击展开的节点 step 名（按 orderId） */
  flowExpandedStepsByOrderId: {},
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
  /** 创建弹窗流程：HCS_INCIDENT | HOTPATCH */
  createModalWorkflow: "HCS_INCIDENT",
  ticketListLoading: false,
  ticketListLoaded: false,
  // 默认「全局」：避免「待处理」依赖 currentHandler 与登录人严格匹配时，数据正常却一进工作台就 0 条
  listTab: "all",
  listPage: 1,
  listPageSize: 10,
  listRefreshing: false,
  ticketListSearch: "",
  /** 工作台列表：按工单创建日（本地）筛选，YYYY-MM-DD，空为不限制 */
  ticketListCreatedStart: "",
  ticketListCreatedEnd: "",
  /** 工作台毛玻璃日历：null 或 { which, viewYear, viewMonth }，viewMonth 为 0–11 */
  ticketListCalPopover: null,
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
  logSyncStateByOrderId: {},
  adminUserEditMode: false,
  adminUsersListPage: 1,
  adminUsersListPageSize: 10,
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
  leaveListTotal: 0,
  leaveListPage: 1,
  leaveListPageSize: 10,
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
  reqListLoaded: false,
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
  majorProblemPeriod: "all",
  majorProblemSearch: "",
  majorProblemStart: "",
  majorProblemEnd: "",
  majorProblemList: [],
  majorProblemListLoading: false,
  majorProblemListLoaded: false,
  majorProblemListTotal: 0,
  majorProblemListPage: 1,
  majorProblemListPageSize: 10,
  majorProblemCreateOpen: false,
  majorProblemEditOpen: false,
  majorProblemDetailId: null,
  majorProblemDetailBundle: null,
  majorProblemDetailLoading: false,
  majorProblemNeedsRefresh: false,
  majorProblemExportModalOpen: false,
  majorProblemConfigModalOpen: false,
  majorProblemConfigList: [],
  majorProblemConfigLoading: false,
  majorProblemConfigLoaded: false,
  majorProblemConfigEditOpen: false,
  majorProblemConfigDraft: null,
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
  versionBaselineListPage: 1,
  versionBaselineListPageSize: 10,
  versionHotfixListPage: 1,
  versionHotfixListPageSize: 10,
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
  statsLaborFlowDetailQuality: "all",
  statsLaborFlowDetailGroup: "",
  uploadSessions: [],
  uploadSessionsLoaded: false,
  currentUploadSession: null,
  uploadSessionConfig: null,
  uploadDataPreview: null,
  uploadLoading: false,
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
  // Doer统计状态
  statsDoerPreset: "1w",
  statsDoerStart: "",
  statsDoerEnd: "",
  statsDoerDataLoaded: false,
  statsDoerDataLoading: false,
  statsDoerData: null,
  statsDoerDataLoadedKey: "",
  statsDoerIncludeOps: true,  // 是否包含运维分析阶段
  statsDoerIncludeDev: true,  // 是否包含开发分析阶段
  // Doer咨询效率统计状态
  statsDoerConsultData: null,           // 咨询问题Doer效率数据
  statsDoerConsultTrendPrecision: "week", // 趋势时间粒度：week或month
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
  exportModalOpen: false,
  exportFormat: "xlsx",
  exportRange: "selected",
  exportFileName: "",
  exportLoading: false,
  exportSelectedFields: null,  // { nodeKey: [fieldKeys] } 默认全选
  exportExpandedNodes: {},     // { nodeKey: boolean } 折叠状态
  columnSelectModalOpen: false,
  columnSelectNamespace: "",   // "list" 或 "home"
  columnSelectExpandedNodes: {}, // { nodeKey: boolean } 折叠状态
  columnSelectedFields: {},    // { nodeKey: [fieldKeys] } 弹窗内临时选中的字段（未保存到 localStorage）
  columnSelectSearchKeyword: "", // 列选择弹窗搜索关键词
  oncallEvaNeedsRefresh: false,
  oncallEvaPeriod: null,           // {year, month}
  oncallEvaConfig: null,           // 评议规则常量
  oncallEvaScores: null,           // 综合得分汇总
  oncallEvaScoresLoading: false,
  oncallEvaExtras: [],             // 当前周期所有加分项
  oncallEvaExtrasLoading: false,
  oncallEvaEvents: [],             // 当前周期所有红黑事件
  oncallEvaEventsLoading: false,
  oncallEvaTab: "scores",          // scores | extras | events
  oncallEvaSelectedAccount: "",
  oncallEvaExtraDraft: null,       // 申报弹窗 draft
  oncallEvaEventDraft: null,       // 红黑事件录入弹窗 draft
  oncallEvaMsg: "",
  reportIssueHistoryRows: [],
  reportIssueNewRows: [],
  reportIssueMergedRows: [],
  reportIssueColumns: [],
  reportIssueDtsColumn: "",
  reportIssueHistoryFileName: "",
  reportIssueNewFileName: "",
  reportIssueMsg: "",
  reportIssueMsgType: "info",
  // 月度分析报告（5 段式可编辑）
  monthlyReportYm: "",                    // 当前编辑月份 YYYYMM
  monthlyReportData: null,                // { report_month, status, section_overview, ... }
  monthlyReportLoading: false,
  monthlyReportMsg: "",
  monthlyReportMsgType: "info",
  monthlyReportEditing: { overview: false, insight: false, major: false, improve: false, links: false },
  monthlyReportSaving: { overview: false, insight: false, major: false, improve: false, links: false },
  monthlyReportDrafts: { overview: null, insight: null, major: null, improve: null, links: null },
  monthlyReportInsightView: "chart",      // chart | data（数据编辑视图）
  monthlyReportArchiveList: [],           // 归档列表
  monthlyReportArchiveLoading: false,
};

const TEMP_AUTO_FILL_ALL_FIELDS = false;

export { tickets, ticketList, workflowByOrderId, operationLogsByOrderId, state, TEMP_AUTO_FILL_ALL_FIELDS };
