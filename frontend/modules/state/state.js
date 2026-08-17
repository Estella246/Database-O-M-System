import {
  DUTY_ASSIGNMENTS_STORAGE_KEY,
  DUTY_HOLIDAY_STORAGE_KEY,
  DUTY_ALL_ROTATION_KINDS,
  DUTY_ROTATION_STORAGE_KEY,
  DUTY_RL_ONCALL_STORAGE_KEY,
} from "../constants/duty.js";
import {
  normalizeDutyRotationList,
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
  /** 用户管理编辑基线：account(lower) -> 规范化行，用于增量保存 diff */
  adminUsersBaseline: {},
  adminLoading: false,
  adminLoaded: false,
  adminMsg: "",
  adminMsgError: false,
  adminPermissionRole: "",
  adminPermissionEditMode: false,
  adminPermissionDialogOpen: false,
  adminPermissionDraft: {},
  adminPermissionExpandedGroups: {},
  createModalOpen: false,
  createTicketId: "",
  createModalNodeKey: "",
  /** 提单助手：创建弹窗提交走九问会话而非 create_intent 建单 */
  ticketAssistantCreateMode: false,
  /** 进入提单助手且无选中会话时自动弹创建窗（一次性） */
  ticketAssistantAutoCreatePending: false,
  taSessions: [],
  taSessionsLoading: false,
  taActiveSessionId: null,
  taActiveSession: null,
  taMessages: [],
  /** 当前 taMessages 所属会话 id，切换时用来避免串内容 */
  taMessagesSessionId: null,
  /** sessionId -> messages，切换会话即时展示 */
  taMessagesCache: {},
  taMessagesLoading: false,
  taChatLoading: false,
  taTransferLoading: false,
  taChatError: "",
  /** 流式回复累计文本（供重绘恢复） */
  taStreamingText: "",
  taNeedsRefresh: false,
  /** 九问 models.list 结果 */
  taModels: [],
  taModelsLoading: false,
  /** 已尝试拉取过模型（含失败/空列表），避免空结果时 bind 死循环重绘 */
  taModelsFetched: false,
  taActiveModel: "",
  taModelMenuOpen: false,
  /** 九问 ask_user 待答（chat.ask_user_question） */
  taPendingAskUser: null,
  /** ask_user 卡片 UI：{ page, answersByPage: { [idx]: { selected, custom, customActive } } } */
  taAskUserUi: null,
  /** Gemini 风格：对话历史默认收起 */
  taHistoryOpen: false,
  /** 问题填写起单提交成功后展示的问题审核人弹窗 */
  problemFillReviewerModalOpen: false,
  problemFillReviewerName: "",
  problemFillReviewerAccount: "",
  problemFillReviewerTicketNo: "",
  /** Ask Doer 快捷链接弹窗 */
  askDoerModalOpen: false,
  /** 创建弹窗流程：HCS_INCIDENT | HOTPATCH */
  createModalWorkflow: "HCS_INCIDENT",
  ticketListLoading: false,
  ticketListLoaded: false,
  /** 工单详情预加载中：整页显示「加载中…」，避免流程壳与各节点字段分帧闪动 */
  ticketDetailHydratingOrderId: "",
  // 默认「全局」：避免「待处理」依赖 currentHandler 与登录人严格匹配时，数据正常却一进工作台就 0 条
  listTab: "all",
  listPage: 1,
  listPageSize: 10,
  listRefreshing: false,
  /** 工作台 HCS 列表快照全量重建中 */
  snapshotRebuilding: false,
  snapshotRebuildProgress: "",
  snapshotRebuildDone: 0,
  snapshotRebuildTotal: 0,
  /** 统计图表日汇总回填 */
  statsDailyBackfillRunning: false,
  statsDailyBackfillProgress: "",
  statsDailyBackfillDone: 0,
  statsDailyBackfillTotal: 0,
  /** 工作台 HCS 列表是否走后端快照分页 */
  ticketListServerPaged: false,
  ticketListTotal: 0,
  /** 快照分页最近一次 sync 返回的当前页工单号（展示用，不含 merge 保留的已打开详情页） */
  workbenchSnapshotPageIds: [],
  /** 列筛选 facets：colKey -> string[] */
  ticketListFacetValues: {},
  ticketListSearch: "",
  /** 工作台列表：按工单创建日（本地）筛选，YYYY-MM-DD，空为不限制 */
  ticketListCreatedStart: "",
  ticketListCreatedEnd: "",
  /** 全站日期范围毛玻璃日历：null 或 { id, viewYear, viewMonth, phase }，viewMonth 为 0–11 */
  dateRangePicker: null,
  ticketListFilters: {
    selected: {
      currentStage: [],
      severity: [],
      location: [],
      bizEnv: [],
      currentHandler: [],
    },
    search: {
      currentStage: "",
      severity: "",
      location: "",
      bizEnv: "",
      currentHandler: "",
    },
    openKey: "",
  },
  homeWorkbenchTab: "pending",
  /** 从其他页进入主页时工单表等待 sync，首帧仅展示加载占位 */
  homeWorkbenchListLoading: false,
  homeListRefreshing: false,
  homeLeavePendingItems: [],
  homeLeavePendingLoading: false,
  homePersonalPreset: "1w",
  homePersonalStart: "",
  homePersonalEnd: "",
  homePersonalPassthroughQuality: "all",
  homePersonalStatsLoading: false,
  homePersonalStatsLoadedKey: "",
  homePersonalStats: null,
  homeQiClosure: [],
  homeQiClosureLoading: false,
  homeListPage: 1,
  homeListPageSize: 10,
  /** 主页工单表：服务端分页当前页（与工作台 ticketList 解耦，避免全量 HCS 进内存） */
  homeListTickets: [],
  homeListTotal: 0,
  homeListServerPaged: true,
  /** 待办/曾处理页签合并用的 HOTPATCH 子集（体量通常较小） */
  homeHotpatchTickets: [],
  homeListFacetValues: {},
  homeOrderHeatmapCounts: null,
  homeOrderHeatmapLoading: false,
  homeTicketListFilters: {
    selected: {
      currentStage: [],
      severity: [],
      location: [],
      bizEnv: [],
      currentHandler: [],
    },
    search: {
      currentStage: "",
      severity: "",
      location: "",
      bizEnv: "",
      currentHandler: "",
    },
    openKey: "",
  },
  selectedTicketIds: [],
  tabIndicatorFrom: null,
  tabIndicatorLast: null,
  logSyncStateByOrderId: {},
  adminUserEditMode: false,
  /** 编辑态待删除账号（点保存才真正 DELETE） */
  adminUsersPendingDelete: [],
  adminUsersListPage: 1,
  adminUsersListPageSize: 10,
  adminUserSearch: "",
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
      email: [],
      contact_phone: [],
      product_line: [],
      expert_domain: [],
      min_dept: [],
      remark: [],
    },
    search: {
      account: "",
      user_name: "",
      role_code: "",
      group_name: "",
      email: "",
      contact_phone: "",
      product_line: "",
      expert_domain: "",
      min_dept: "",
      remark: "",
    },
    openKey: "",
  },
  dutyCalendarYm: (() => {
    const t = new Date();
    const y = t.getFullYear();
    const m = t.getMonth() + 1;
    return {
      kernel: { year: y, month: m },
      control: { year: y, month: m },
      public_cloud: { year: y, month: m },
      poc: { year: y, month: m },
      research_version: { year: y, month: m },
    };
  })(),
  dutyHolidayYm: (() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() + 1 };
  })(),
  dutyEditMode: { kernel: false, control: false, public_cloud: false, poc: false, research_version: false },
  dutyHolidayEditMode: false,
  dutyAssignments: (() => {
    try {
      const raw = window.localStorage.getItem(DUTY_ASSIGNMENTS_STORAGE_KEY);
      if (!raw) return { kernel: {}, control: {}, public_cloud: {}, poc: {}, research_version: {} };
      const p = JSON.parse(raw);
      return {
        kernel: p.kernel && typeof p.kernel === "object" ? p.kernel : {},
        control: p.control && typeof p.control === "object" ? p.control : {},
        public_cloud: p.public_cloud && typeof p.public_cloud === "object" ? p.public_cloud : {},
        poc: p.poc && typeof p.poc === "object" ? p.poc : {},
        research_version:
          p.research_version && typeof p.research_version === "object" ? p.research_version : {},
      };
    } catch (_) {
      return { kernel: {}, control: {}, public_cloud: {}, poc: {}, research_version: {} };
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
  dutyCalendarImportModal: null,
  dutyCalendarImportFile: null,
  dutyCalendarImportFileName: "",
  dutyCalendarImportErrors: [],
  dutyCalendarImportLoading: false,
  dutyRlImportModal: false,
  dutyRlImportFile: null,
  dutyRlImportFileName: "",
  dutyRlImportErrors: [],
  dutyRlImportLoading: false,
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
  leaveListLoaded: false,
  leaveApproverWhitelist: [],
  leaveCreateOpen: false,
  /** 请假申请弹窗提交中，防止重复点击或重复绑定监听导致多次建单 */
  leaveCreateSubmitting: false,
  leaveWhitelistModalOpen: false,
  leaveWhitelistDraftAccounts: [],
  leaveDetailId: null,
  leaveDetailBundle: null,
  leaveDetailLoading: false,
  leaveDraftSegKey: 1,
  leaveCreateSegments: [],
  leaveCreateType: "",
  leaveCreateApplicant: "",
  leaveCreateApplicantAccount: "",
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
  reqExportLoading: false,
  reqImportLoading: false,
  reqImportModalOpen: false,
  reqImportFileName: "",
  // QI 工作流（质量改进 v2）
  qiTab: "all", qiList: [], qiListLoading: false, qiListLoaded: false,
  qiListTotal: 0, qiListPage: 1, qiListPageSize: 10,
  qiListSearch: "", qiListFilters: {}, qiFilterOptions: null,
  qiCreateOpen: false, qiCreateSubmitting: false,
  qiDetailId: null, qiDetailBundle: null, qiDetailLoading: false, qiDetailLoaded: false,
  qiEditOpen: false, qiSubmitStage: "", qiNeedsRefresh: false,
  // QI 流程视图（全屏）：qiFlowViewId 为 null=列表, 'new'=新建, number=已有单
  qiFlowViewId: null, qiFlowStage: "",
  qiAnalyticsLoading: false, qiAnalyticsData: null, qiAnalyticsNeedsRefresh: false,
  qiAnalyticsPreset: "all", qiAnalyticsStart: "", qiAnalyticsEnd: "", qiAnalyticsPrecision: "week",
  qiAnalyticsDomainSub: "",
  qiAnalyticsDomainAcc: "",
  qiAnalyticsModuleDomainPie: "",
  qiAnalyticsModuleDomainBar: "",
  qiAnalyticsStages: [],
  qiAnalyticsFull: null,
  qiExportLoading: false, qiImportLoading: false,
  qiImportModalOpen: false, qiImportFileName: "",
  // QI 候选人管理（参数配置子页）
  qiCandidatesTab: "reviewer", qiCandidatesReviewer: [], qiCandidatesAnalyst: [],
  qiCandidatesLoading: false, qiCandidatesSaving: false,
  qiCandidatesEditMode: false, qiCandidatesDraft: [], qiCandidatesSearch: "",
  qiCandidatesNeedsRefresh: false,
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
  // 重大问题（工单驱动）
  majorIssueStatusFilter: "",
  majorIssueSearch: "",
  majorIssueList: [],
  majorIssueListLoading: false,
  majorIssueListLoaded: false,
  majorIssueListError: "",
  majorIssueListTotal: 0,
  majorIssueListPage: 1,
  majorIssueListPageSize: 20,
  majorIssueNeedsRefresh: false,
  majorIssueDetailId: null,
  majorIssueDetailBundle: null,
  majorIssueProgressList: [],
  majorIssueProgressLoading: false,
  majorIssueProgressOpen: false,
  majorIssueProgressHistoryOpen: false,
  majorIssueBackfillRunning: false,
  majorIssueBackfillProgress: "",
  majorIssueBackfillScanned: 0,
  majorIssueBackfillTicketTotal: 0,
  majorIssueBackfillInList: 0,
  majorIssueBackfillUpserted: 0,
  majorIssueBackfillRemoved: 0,
  majorIssueBackfillBatchNo: 0,
  majorIssueBackfillAfterTicketId: 0,
  majorIssueSelectedIds: [],
  majorIssueExportLoading: false,
  siteProfileSearch: "",
  siteProfileList: [],
  siteProfileListLoading: false,
  siteProfileListLoaded: false,
  siteProfileListTotal: 0,
  siteProfileListPage: 1,
  siteProfileListPageSize: 10,
  siteProfileCreateOpen: false,
  siteProfileEditOpen: false,
  siteProfileDetailId: null,
  siteProfileDetailBundle: null,
  siteProfileDetailLoading: false,
  siteProfileSelectedIds: [],
  siteProfileNeedsRefresh: false,
  toolPlazaSearch: "",
  toolPlazaTypeFilter: "",
  toolPlazaCategoryFilter: "",
  toolPlazaList: [],
  toolPlazaListLoading: false,
  toolPlazaListLoaded: false,
  toolPlazaListTotal: 0,
  toolPlazaListPage: 1,
  toolPlazaListPageSize: 18,
  toolPlazaCategories: [],
  toolPlazaNeedsRefresh: false,
  toolPlazaPublishOpen: false,
  toolPlazaPublishType: "skill",
  toolPlazaPublishTitle: "",
  toolPlazaPublishCategory: "",
  toolPlazaPublishDetail: "",
  toolPlazaPublishUsage: "",
  toolPlazaPublishFile: null,
  toolPlazaPublishFileName: "",
  toolPlazaPublishError: "",
  toolPlazaPublishLoading: false,
  toolPlazaEditId: null,
  toolPlazaEditFileName: "",
  toolPlazaItemByNo: {},
  toolPlazaItemLoadingNo: "",
  toolPlazaItemHydratingNo: "",
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
  issueRootCauseItems: [],
  issueRootCauseIssueTypes: [],
  issueRootCauseDraft: null,
  issueRootCauseEditMode: false,
  issueRootCauseLoading: false,
  issueRootCauseSaving: false,
  issueRootCauseMsg: "",
  issueRootCauseActiveType: "",
  issueRootCauseNeedsRefresh: false,
  groupPullModalOpen: false,
  groupPullLoading: false,
  groupPullSubmitting: false,
  groupPullActiveKind: "major",
  groupPullLocal: null,
  statsChartsTab: "labor",
    statsLaborPreset: "1w",
  statsLaborStart: "",
  statsLaborEnd: "",
  statsLaborProductLine: "",
  statsLaborGroup: "",
  statsLaborDomain: "",
  statsLaborQuality: "all",
  statsLaborComponent: "all",
  statsLaborInputCollab: "yes",
  statsLaborOpenHoldPersonStage: "",
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
  statsChartsPayload: { labor: null, ownership: null, ownershipQualityScoped: null, doer: null },
  statsChartsLoading: { labor: false, ownership: false, doer: false },
  statsChartsLoadedKey: { labor: "", ownership: "", doer: "" },
  statsChartsTicketCount: { labor: 0, ownership: 0, doer: 0 },
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
  // ── AI Export (深度分析) ──
  aiExportCurrentTaskId: null,
  aiExportTaskStatus: null,
  aiExportTotalRows: 0,
  aiExportProcessedRows: 0,
  aiExportErrorMessage: "",
  aiExportTransformRules: [],
  aiExportPreviewRows: [],
  aiExportOriginalColumns: [],
  aiExportSourceConfig: {},
  aiExportRuleDescription: "",
  aiExportTaskList: [],
  aiExportTaskListPage: 1,
  aiExportTaskListTotal: 0,
  aiExportProcessing: false,
  aiExportFullProcessing: false,
  aiExportReportPrompt: "",
  aiExportReportStatus: "none",
  aiExportActiveView: "workflow",
  _aiExportInitialLoaded: false,
  _aiExportProgressTimer: null,
  _aiExportEditRules: false,
  aiExportSelectedFields: null,
  aiExportNaturalDescription: "",
  aiExportWhereSql: "",
  aiExportMatchCount: 0,
  exportModalOpen: false,
  /** 历史迁入弹窗 */
  migrateLegacyModalOpen: false,
  migrateLegacyCandidates: [],
  migrateLegacySelectedProcessIds: [],
  migrateLegacyCandidatesLoading: false,
  migrateLegacyCandidatesError: "",
  migrateLegacySearch: "",
  migrateLegacySubmitting: false,
  /** 迁入/修复进行中进度文案 */
  migrateLegacyProgress: "",
  exportFormat: "csv",
  exportRange: "selected",
  exportFileName: "",
  exportLoading: false,
  exportTaskId: null,
  exportProcessedRows: 0,
  exportTotalRows: 0,
  _exportProgressTimer: null,
  _exportWaitReject: null,
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
  oncallEvaGroup: "",              // 组别筛选（""=全部），值取自 user_account.group_name
  oncallEvaGroups: [],             // 可选组别列表
  oncallEvaDeptSel: [],            // 已选部门（多选，[]=全部），值取自 user_account.min_dept（组内细分）
  oncallEvaDeptOpen: false,        // 部门多选下拉是否展开
  oncallEvaDepts: [],              // 当前组别下可选部门列表
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
  monthlyReportImporting: { overview: false, insight: false, major: false, improve: false, links: false },
  monthlyReportDrafts: { overview: null, insight: null, major: null, improve: null, links: null },
  monthlyReportInsightView: "chart",      // chart | data（数据编辑视图）
  monthlyReportArchiveList: [],           // 归档列表
  monthlyReportArchiveLoading: false,
};

const TEMP_AUTO_FILL_ALL_FIELDS = false;

export { tickets, ticketList, workflowByOrderId, operationLogsByOrderId, state, TEMP_AUTO_FILL_ALL_FIELDS };
