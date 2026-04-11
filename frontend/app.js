const root = document.getElementById("root");

/** Demo rows: orderId, processId, currentStage, startDate, location, bizEnv, currentHandler, severity, description, status, creatorName */
const tickets = [
  ["100000301", "YW20260402001", "开发闭环", "2026-04-02", "华东-上海", "公有云", "李潇雨", "致命", "迁移任务脚本异常。", "open", "Ranya"],
  ["100000302", "YW20260402002", "问题审核", "2026-04-03", "华北-北京", "混合云", "Raniak", "严重", "确认消息未展示。", "open", "Raniak"],
  ["100000307", "YW20260402003", "开发分析", "2026-04-04", "华南-深圳", "公有云", "Dose", "严重", "数据均值计算偏差。", "open", "Demo User"],
  ["100000304", "YW20260402004", "已关闭", "2026-04-05", "西南-成都", "轻量化", "", "致命", "体位校验失败，已闭环。", "closed", "Dose"],
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
  createdAt: `${r[3]}T12:00:00.000Z`,
}));

/** 首页列表「问题描述」等：去标签并截断，避免撑破表格 */
function listPreviewText(raw, maxLen = 160) {
  const t = String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "--";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** 问题严重性展示文案（与 option 一致：一般 / 严重 / 致命） */
function normalizeIssueSeverity(raw) {
  const s = String(raw || "").trim();
  if (s === "一般" || s === "严重" || s === "致命") return s;
  const lower = s.toLowerCase();
  if (lower === "urgent") return "致命";
  if (lower === "high") return "严重";
  if (lower === "low" || lower === "medium") return "一般";
  return s || "一般";
}

/** 沿用原有 .p.urgent / .high / .low 圆点样式，不新增 CSS */
function severityPillClass(label) {
  const s = normalizeIssueSeverity(label);
  if (s === "致命") return "urgent";
  if (s === "严重") return "high";
  if (s === "一般") return "low";
  return "medium";
}
const WORKFLOW_NODES = ["问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];

/** Backend base URL: same host as the page + port 8000 (avoids localhost vs 127.0.0.1 mismatches). Override: ?api=http://host:8000 or localStorage yunwei_api_base_url */
function resolveApiBaseUrl() {
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q) return q.replace(/\/$/, "");
    const ls = window.localStorage.getItem("yunwei_api_base_url");
    if (ls) return ls.replace(/\/$/, "");
  } catch (_) {
    /* ignore */
  }
  const { protocol, hostname } = window.location;
  if (protocol === "file:" || !hostname) return "http://127.0.0.1:8000";
  const h = hostname === "::1" ? "127.0.0.1" : hostname;
  return `${protocol}//${h}:8000`;
}

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

/** Positions `.tab-indicator` relative to `.tabs` padding box (getBoundingClientRect is border-box). */
function tabIndicatorMetrics(tabsWrap, target) {
  const wrapRect = tabsWrap.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const cs = getComputedStyle(tabsWrap);
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  return {
    x: targetRect.left - wrapRect.left - bl,
    y: targetRect.top - wrapRect.top - bt,
    w: targetRect.width,
    h: targetRect.height,
  };
}

const API_BASE_URL = resolveApiBaseUrl();

/** 拉群模版问题类型（与 `param_group_template.problem_kind` 一致） */
const GROUP_TEMPLATE_KINDS = [
  { kind: "major", label: "重大问题" },
  { kind: "urgent", label: "紧急问题" },
  { kind: "itr", label: "ITR管理升级" },
  { kind: "general", label: "一般问题" },
];

const GROUP_TEMPLATE_NAME_DEFAULTS = {
  major: "【GaussDB内部】【XX 重大问题】{Ecare单号 客户名称} GaussDB {故障描述}",
  urgent: "【GaussDB内部】【XX 紧急问题】{Ecare单号 客户名称} GaussDB {故障描述}",
  itr: "【GaussDB内部】【ITR 管理升级】{Ecare单号 客户名称} GaussDB {故障描述}",
  general: "【GaussDB内部】【一般问题】{Ecare单号 客户名称} GaussDB {故障描述}",
};

const DEFAULT_OPERATOR_ACCOUNT = "demo_001";
const DEFAULT_OPERATOR_NAME = "Demo User";
const NODE_KEY_BY_STEP = {
  问题填写: "problem_fill",
  问题审核: "problem_review",
  运维分析: "ops_analysis",
  开发分析: "dev_analysis",
  开发闭环: "dev_closure",
  运维闭环: "ops_closure",
  审核关闭: "audit_close",
};
const STEP_BY_NODE_KEY = Object.fromEntries(Object.entries(NODE_KEY_BY_STEP).map(([step, key]) => [key, step]));
const HANDLE_MODE_ROUTE = {
  problem_review: {
    确认问题: "ops_analysis",
    提交其他运维审核: "problem_review",
    非问题关闭: "problem_review",
  },
  ops_analysis: {
    提交开发分析: "dev_analysis",
    提交开发闭环: "dev_closure",
    提交运维闭环: "ops_closure",
    提交其他运维分析: "ops_analysis",
  },
  dev_analysis: {
    提交开发闭环: "dev_closure",
    提交其他开发分析: "dev_analysis",
    返回运维分析: "ops_analysis",
  },
  dev_closure: {
    提交运维闭环: "ops_closure",
    提交其他开发闭环: "dev_closure",
    返回开发分析: "dev_analysis",
    返回运维分析: "ops_analysis",
  },
  ops_closure: {
    提交运维审核关闭: "audit_close",
    提交其他运维闭环: "ops_closure",
    返回开发闭环: "dev_closure",
    返回运维分析: "ops_analysis",
  },
  audit_close: {
    问题解决关闭: "audit_close",
    提交其他审核关闭: "audit_close",
    返回运维闭环: "ops_closure",
    暂时挂起: "audit_close",
  },
};

/** 白名单里不插「空选项」的字段（处理方式：默认落在真实选项上，不出现空白行） */
const WHITELIST_NO_PLACEHOLDER_KEYS = new Set(["handle_mode"]);
const PERMISSION_WHITELIST_NODE_KEY = "__whitelist__";
const PERMISSION_WHITELIST_ITEMS = [
  { key: "duty_roster", label: "值班表" },
  { key: "admin_users", label: "用户管理" },
  { key: "admin_permissions", label: "权限策略" },
  { key: "stats_dashboard", label: "统计图表" },
  { key: "ticket_list", label: "工单列表" },
  { key: "ticket_detail", label: "工单详情" },
];
const PERMISSION_SCOPE_FIELD_KEYS = {
  ticket_list: "ticket_list_scope_self",
  ticket_detail: "ticket_detail_scope_problem_fill",
};

/** 值班日历区块：内核 / 管控（月历 + 编辑） */
const DUTY_CALENDAR_KIND_BY_SECTION_ID = {
  "duty-kernel-oncall": "kernel",
  "duty-control-oncall": "control",
};
/** 轮值表区块：与 state.dutyRotationLists 的键一致 */
const DUTY_ROTATION_KIND_BY_SECTION_ID = {
  "duty-kernel-rotation": "kernelRotation",
  "duty-control-rotation": "controlRotation",
};
/** 专项轮值：多个独立子表，与 state.dutyRotationLists 的 kind 键一致 */
const DUTY_SPECIAL_ROTATION_SUBTABLES = [
  { anchorId: "duty-special-slow-sql", title: "慢SQL(SQL)调优专项轮值表", kind: "specialSlowSql" },
  { anchorId: "duty-special-perf", title: "整体性能专项轮值表", kind: "specialPerf" },
  { anchorId: "duty-special-upgrade", title: "升级专项轮值表", kind: "specialUpgrade" },
  { anchorId: "duty-special-scale", title: "扩容专项轮值表", kind: "specialScale" },
  { anchorId: "duty-special-backup", title: "备份恢复专项轮值表", kind: "specialBackup" },
  { anchorId: "duty-special-dr", title: "容灾专项轮值表", kind: "specialDr" },
];
const DUTY_ALL_ROTATION_KINDS = [
  "kernelRotation",
  "controlRotation",
  ...DUTY_SPECIAL_ROTATION_SUBTABLES.map((s) => s.kind),
];
const DUTY_RL_ONCALL_STORAGE_KEY = "yunwei_duty_rl_oncall_v1";
const DUTY_SITE_ONCALL_STORAGE_KEY = "yunwei_duty_site_oncall_v1";
const DUTY_ROTATION_STORAGE_KEY = "yunwei_duty_rotation_v1";
const DUTY_ROTATION_STATUS_ACTIVE = "active";
const DUTY_ROTATION_STATUS_INACTIVE = "inactive";
const DUTY_SHIFT_FULL = "full";
const DUTY_SHIFT_NIGHT = "night";
const DUTY_ASSIGNMENTS_STORAGE_KEY = "yunwei_duty_calendar_v1";
const DUTY_SELECTABLE_ROLE_CODES = new Set(["管理员", "普通人员"]);

/** 值班表单页内的区块（顺序即页面从上到下）；id 用于 URL 锚点与侧栏子菜单 */
const DUTY_ROSTER_SECTIONS = [
  { id: "duty-kernel-oncall", title: "内核值班表" },
  { id: "duty-control-oncall", title: "管控值班表" },
  { id: "duty-kernel-rotation", title: "内核轮值表" },
  { id: "duty-control-rotation", title: "管控轮值表" },
  { id: "duty-special-rotation", title: "专项轮值表" },
  { id: "duty-site-oncall", title: "局点值班表" },
  { id: "duty-rl-oncall", title: "RL值班表" },
];
/** 请假申请：申请类型（与后端 LEAVE_APPLICATION_TYPES 一致） */
const LEAVE_APPLICATION_TYPES = ["重大问题公关", "特性开发", "外出公干", "请假/调休", "在途"];
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

function normalizeDutyRotationList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      account: String(x.account || "").trim(),
      user_name: String(x.user_name || "").trim(),
      status: x.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_INACTIVE : DUTY_ROTATION_STATUS_ACTIVE,
      last_accept_at: x.last_accept_at != null && String(x.last_accept_at).trim() ? String(x.last_accept_at).trim() : "",
    }))
    .filter((x) => x.account);
}

function normalizeDutySiteOnCallRows(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      site_name: String(x.site_name || "").trim(),
      account: String(x.account || "").trim(),
      user_name: String(x.user_name || "").trim(),
      status: x.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_INACTIVE : DUTY_ROTATION_STATUS_ACTIVE,
      last_accept_at: x.last_accept_at != null && String(x.last_accept_at).trim() ? String(x.last_accept_at).trim() : "",
    }))
    .filter((x) => x.site_name && x.account);
}

function normalizeDutyRlSlot(x) {
  return {
    account: String(x.account || "").trim(),
    user_name: String(x.user_name || "").trim(),
    phone: String(x.phone || "").trim(),
  };
}

function normalizeDutyRlOnCallRows(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      duty_date: String(x.duty_date || "").trim().slice(0, 10),
      primary: normalizeDutyRlSlot(x.primary || {}),
      backup: normalizeDutyRlSlot(x.backup || {}),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.duty_date));
}

const state = {
  openTabs: [{ key: "list", label: "Work Order", closable: false }],
  activeKey: "list",
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
  adminPermissionScopeDraft: {},
  createModalOpen: false,
  createTicketId: "",
  ticketListLoading: false,
  ticketListLoaded: false,
  listTab: "pending",
  listPage: 1,
  listPageSize: 10,
  listRefreshing: false,
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
  dutyEditMode: { kernel: false, control: false },
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
  /** @type {{ kind: string, dateKey: string } | null} */
  dutyDayModal: null,
  /** 已与服务端同步的「内核月|管控月」键，避免重复拉取 */
  dutyCalendarLoadedKey: "",
  dutyCalendarSyncPending: false,
  /** 已拉取过扩展值班表（轮值/局点/RL）的登录账号，切账号时重拉 */
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
  /** 侧栏「值班表」子菜单中专项轮值六项默认收起 */
  dutySpecialSubmenuExpanded: false,
  /** 下一次值班页 render 不要用「上次滚动位置」覆盖（侧栏锚点跳转由点击处自行 scrollIntoView） */
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
  /** 进入请假页后需拉列表（避免 bind 每轮 render 重复请求） */
  leaveNeedsRefresh: false,
  /** 「我的待办」列表勾选 id，用于批量审批 */
  leaveBatchSelectedIds: [],
  leaveBatchApprovalModalOpen: false,
  /** 责任田多级分类（与 GET /api/params/duty-field/tree 一致，含 id） */
  dutyFieldTree: [],
  dutyFieldTreeLoading: false,
  dutyFieldTreeSaving: false,
  dutyFieldTreeMsg: "",
  dutyFieldNeedsRefresh: false,
  dutyFieldEditMode: false,
  /** 责任田树：已收起节点的 path（如 "0"、"0.1"），仅前端展示用 */
  dutyFieldCollapsedPaths: new Set(),
  /** 版本模块：baseline | hotfix */
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
  /** 拉群模版（参数页 + 首页弹窗共用 GET 数据） */
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
  /** @type {null | { problem_kind: string, group_name_tpl: string, group_notice_tpl: string, group_members_tpl: string, first_report_tpl: string }[]} */
  groupPullLocal: null,
};
const DEBUG_ENABLED = true;
const DEBUG_LOG_LIMIT = 120;
const debugLogs = [];
const TEMP_AUTO_FILL_ALL_FIELDS = true;
const debugPanelState = {
  left: null,
  top: null,
  collapsed: true,
};

function renderDebugLogText() {
  return debugLogs.map((x) => `${x.at} ${x.event} ${JSON.stringify(x.detail)}`).join("\n");
}

function debugLog(event, detail = {}) {
  if (!DEBUG_ENABLED) return;
  const line = {
    at: nowText(),
    event: String(event || ""),
    detail,
  };
  debugLogs.push(line);
  if (debugLogs.length > DEBUG_LOG_LIMIT) debugLogs.shift();
  try {
    console.log(`[debug] ${line.at} ${line.event}`, detail);
  } catch (_) {
    // ignore console failure
  }
  const box = document.getElementById("debug-log-body");
  if (box) {
    box.textContent = renderDebugLogText();
    box.scrollTop = box.scrollHeight;
  }
}

function bindGlobalErrorLogs() {
  window.addEventListener("error", (ev) => {
    debugLog("window.error", {
      message: ev.message || "",
      source: ev.filename || "",
      line: ev.lineno || 0,
      col: ev.colno || 0,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    debugLog("window.unhandledrejection", {
      reason: reason instanceof Error ? reason.message : String(reason || ""),
    });
  });
}

/** 流程 / 工单号：YW + YYYYMMDD + 三位 000–999（与后端及 .cursor/rules/process-flow-id-format.mdc 一致） */
function makeNewTicketId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `YW${ymd}`;
  const key = `yw_ticket_seq_${ymd}`;
  let last = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(last) || last < 0) last = -1;
  const next = (last + 1) % 1000;
  window.localStorage.setItem(key, String(next));
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function remapTicketOrderId(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  if (workflowByOrderId[oldId]) {
    workflowByOrderId[newId] = workflowByOrderId[oldId];
    delete workflowByOrderId[oldId];
  }
  if (Object.prototype.hasOwnProperty.call(operationLogsByOrderId, oldId)) {
    operationLogsByOrderId[newId] = operationLogsByOrderId[oldId];
    delete operationLogsByOrderId[oldId];
  }
  if (Object.prototype.hasOwnProperty.call(state.logSyncStateByOrderId, oldId)) {
    state.logSyncStateByOrderId[newId] = state.logSyncStateByOrderId[oldId];
    delete state.logSyncStateByOrderId[oldId];
  }
  if (Object.prototype.hasOwnProperty.call(state.ticketStatusByOrderId, oldId)) {
    state.ticketStatusByOrderId[newId] = state.ticketStatusByOrderId[oldId];
    delete state.ticketStatusByOrderId[oldId];
  }
  Object.keys(state.formsByTicket).forEach((k) => {
    if (!k.startsWith(`${oldId}:`)) return;
    const nk = `${newId}:${k.slice(oldId.length + 1)}`;
    state.formsByTicket[nk] = state.formsByTicket[k];
    delete state.formsByTicket[k];
  });
  if (state.createTicketId === oldId) state.createTicketId = newId;
  state.openTabs.forEach((tab) => {
    if (tab.key === `ticket:${oldId}`) {
      tab.key = `ticket:${newId}`;
      tab.label = newId;
    }
  });
  state.selectedTicketIds = state.selectedTicketIds.map((id) => (id === oldId ? newId : id));
  if (state.activeKey === `ticket:${oldId}`) state.activeKey = `ticket:${newId}`;
  const row = ticketList.find((t) => t.orderId === oldId);
  if (row) row.orderId = newId;
}

function hasTicketContext(orderId) {
  if (workflowByOrderId[orderId]) return true;
  if (operationLogsByOrderId[orderId]) return true;
  const prefix = `${orderId}:`;
  return Object.keys(state.formsByTicket).some((k) => String(k).startsWith(prefix));
}

function getTicketById(orderId) {
  const found = ticketList.find((item) => item.orderId === orderId);
  if (found) return found;
  if (!hasTicketContext(orderId)) return null;
  const workflow = workflowByOrderId[orderId];
  const currentStepLabel = WORKFLOW_NODES[workflow?.currentStep] || "运维分析";
  const currentStepKey = NODE_KEY_BY_STEP[currentStepLabel] || "ops_analysis";
  const formState = getFormState(orderId, currentStepKey);
  const operator = getCurrentOperator();
  const desc = listPreviewText(
    formState.values?.issue_desc || formState.values?.problem_desc || formState.values?.description || "--",
    500
  );
  return {
    orderId,
    processId: orderId,
    subject: String(formState.values?.problem_title || formState.values?.title || `新建工单 ${orderId}`),
    severity: String(formState.values?.severity || "一般"),
    node: currentStepLabel,
    assignee: operator.userName,
    currentStage: currentStepLabel,
    currentHandler: operator.userName,
    startDate: String(formState.values?.start_date || new Date().toISOString().slice(0, 10)),
    location: String(formState.values?.location || ""),
    bizEnv: String(formState.values?.biz_env || ""),
    description: desc,
    status: "open",
    creatorName: operator.userName,
    createdAt: new Date().toISOString(),
  };
}

function ticketCreatedAtMs(t) {
  const raw = t?.createdAt ?? t?.created_at;
  if (raw) {
    const ms = Date.parse(String(raw));
    if (!Number.isNaN(ms)) return ms;
  }
  const sd = String(t?.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sd)) {
    const ms = Date.parse(`${sd}T12:00:00`);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

/** 首页 SLA 列：当前时间 − 建单时间，格式 X天Y时Z分（与 ticketCreatedAtMs 同源） */
function formatTicketSlaDhM(ticket) {
  const startMs = ticketCreatedAtMs(ticket);
  if (!startMs) return "--";
  const delta = Math.max(0, Date.now() - startMs);
  const minutesTotal = Math.floor(delta / 60000);
  const days = Math.floor(minutesTotal / (60 * 24));
  const hours = Math.floor((minutesTotal % (60 * 24)) / 60);
  const minutes = minutesTotal % 60;
  return `${days}天${hours}时${minutes}分`;
}

function sortTicketsByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const diff = ticketCreatedAtMs(b) - ticketCreatedAtMs(a);
    if (diff !== 0) return diff;
    return String(b.orderId || "").localeCompare(String(a.orderId || ""), undefined, { numeric: true });
  });
}

function getAllTickets() {
  const items = [...ticketList];
  const exists = new Set(items.map((x) => String(x.orderId || "")));
  const contextIds = new Set([
    ...Object.keys(workflowByOrderId),
    ...Object.keys(operationLogsByOrderId),
    ...Object.keys(state.formsByTicket)
      .map((k) => String(k).split(":")[0])
      .filter(Boolean),
  ]);
  contextIds.forEach((orderId) => {
    if (exists.has(orderId)) return;
    const fallback = getTicketById(orderId);
    if (!fallback) return;
    items.push(fallback);
    exists.add(orderId);
  });
  return sortTicketsByCreatedAtDesc(items);
}

async function syncTicketsFromServer() {
  const operator = getCurrentOperator();
  debugLog("tickets.sync.start", { operator: operator.account });
  try {
    const resp = await fetch(`${API_BASE_URL}/api/tickets?operator_id=${encodeURIComponent(operator.account)}`);
    if (!resp.ok) {
      debugLog("tickets.sync.http_error", { status: resp.status });
      return;
    }
    const json = await resp.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    const mapped = items.map((r) => {
      const status = (() => {
        const raw = String(r.status || "").toLowerCase();
        if (raw) return raw;
        return "open";
      })();
      const currentStage = String(r.current_stage || r.currentStage || r.node || "").trim() || "-";
      const handlerRaw = String(r.current_handler ?? r.currentHandler ?? r.assignee ?? "").trim();
      const currentHandler = status === "closed" ? "" : handlerRaw;
      return {
        status,
        orderId: String(r.order_id || r.orderId || ""),
        processId: String(r.process_id || r.processId || r.order_id || r.orderId || ""),
        currentStage,
        startDate: String(r.start_date || r.startDate || ""),
        location: String(r.location || ""),
        bizEnv: String(r.biz_env || r.bizEnv || ""),
        currentHandler,
        node_key: String(r.node_key || r.nodeKey || ""),
        severity: String(r.severity || r.priority || "一般"),
        node: currentStage,
        assignee: currentHandler,
        description: listPreviewText(r.description || r.description_plain || "--", 200),
        creatorName: String(r.creator_name || r.creatorName || ""),
        creatorId: String(r.creator_id || r.creatorId || ""),
        createdAt: String(r.created_at || r.createdAt || ""),
      };
    }).filter((x) => x.orderId);
    if (!mapped.length) {
      debugLog("tickets.sync.empty");
      return;
    }
    const localById = new Map(ticketList.map((x) => [String(x.orderId || ""), x]));
    mapped.forEach((x) => localById.set(x.orderId, { ...localById.get(x.orderId), ...x }));
    ticketList.splice(0, ticketList.length, ...sortTicketsByCreatedAtDesc(Array.from(localById.values())));
    debugLog("tickets.sync.ok", { count: mapped.length });
  } catch (_) {
    // Keep local demo data when backend is unavailable.
    debugLog("tickets.sync.exception");
  }
}

/** 首页刷新：工单列表 + 权限/用户（影响白名单与操作人展示），不整页 reload */
async function refreshHomeListData() {
  await syncTicketsFromServer();
  try {
    const [permResp, userResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/admin/permissions`),
      fetch(`${API_BASE_URL}/api/admin/users`),
    ]);
    if (permResp.ok) {
      const p = await permResp.json();
      state.adminPermissions = Array.isArray(p.items) ? p.items : [];
    }
    if (userResp.ok) {
      const u = await userResp.json();
      state.adminUsers = Array.isArray(u.items) ? u.items : [];
    }
  } catch (_) {
    /* 保留已有 admin 缓存 */
  }
}

function getUrlByKey(key) {
  if (key === "list") return "/";
  if (key === "duty:roster") return "/duty-roster";
  if (key === "leave:application") return "/leave-application";
  if (key === "params:duty-field") return "/params/duty-field";
  if (key === "params:version") return `/params/version#${state.versionSubTab === "hotfix" ? "hotfix" : "baseline"}`;
  if (key === "params:group-template") return "/params/group-template";
  if (key === "admin:permissions") return "/admin/permissions";
  if (key === "admin:users") return "/admin/users";
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
}

function getActiveTicket() {
  if (
    state.activeKey === "list" ||
    state.activeKey === "duty:roster" ||
    state.activeKey === "leave:application" ||
    state.activeKey.startsWith("params:") ||
    !state.activeKey.startsWith("ticket:")
  ) {
    return null;
  }
  return getTicketById(state.activeKey.replace("ticket:", ""));
}

function ensureTicketTab(orderId) {
  const key = `ticket:${orderId}`;
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: orderId, closable: true });
  }
  return key;
}

function ensureAdminTab(kind) {
  const key = `admin:${kind}`;
  const label = kind === "permissions" ? "权限策略" : "用户管理";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label, closable: true });
  }
  return key;
}

function ensureDutyTab() {
  const key = "duty:roster";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "值班表", closable: true });
  }
  return key;
}

/** @param {"duty-field"|"version"|"group-template"} kind */
function ensureParamsTab(kind) {
  const map = {
    "duty-field": { key: "params:duty-field", label: "责任田模块" },
    version: { key: "params:version", label: "版本模块" },
    "group-template": { key: "params:group-template", label: "拉群模版" },
  };
  const item = map[kind] || map["duty-field"];
  if (!state.openTabs.some((tab) => tab.key === item.key)) {
    state.openTabs.push({ key: item.key, label: item.label, closable: true });
  }
  return item.key;
}

function persistDutyAssignmentsLocal() {
  try {
    window.localStorage.setItem(DUTY_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(state.dutyAssignments));
  } catch (_) {}
}

function persistDutyRotationLocal() {
  try {
    const payload = {};
    DUTY_ALL_ROTATION_KINDS.forEach((k) => {
      payload[k] = state.dutyRotationLists[k] || [];
    });
    window.localStorage.setItem(DUTY_ROTATION_STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function persistDutySiteOnCallLocal() {
  try {
    window.localStorage.setItem(DUTY_SITE_ONCALL_STORAGE_KEY, JSON.stringify(state.dutySiteOnCallRows || []));
  } catch (_) {}
}

function persistDutyRlOnCallLocal() {
  try {
    window.localStorage.setItem(DUTY_RL_ONCALL_STORAGE_KEY, JSON.stringify(state.dutyRlOnCallRows || []));
  } catch (_) {}
}

function dutyRlLocalDateKey(d) {
  const x = d instanceof Date ? d : new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDutyRlNowZh() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDutyRlTableDateLabel(dk) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return dk;
  const [y, m, d] = dk.split("-").map((v) => parseInt(v, 10));
  return `${y}年${m}月${d}日`;
}

function dutyRlSlotFilled(s) {
  return !!(s && String(s.account || "").trim());
}

function formatRlTodayBannerPart(slot) {
  if (!dutyRlSlotFilled(slot)) return "—";
  const name = String(slot.user_name || "").trim() || "—";
  const acc = String(slot.account || "").trim();
  const phone = String(slot.phone || "").trim() || "—";
  return `${escapeHtml(name)}<span class="duty-rl-view-sep" aria-hidden="true"> · </span>${escapeHtml(acc)}<span class="duty-rl-view-sep" aria-hidden="true"> · </span><span class="duty-rl-phone-tag" title="手机号"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>`;
}

function renderRlPersonTableCell(slot, editing, idx, role) {
  if (editing) {
    if (!dutyRlSlotFilled(slot)) {
      return `<span class="duty-rl-empty-slot">—</span>`;
    }
    return `<div class="duty-rl-edit-slot">
      <div class="duty-rl-edit-name">${escapeHtml(dutyModalUserLabel(slot))}</div>
      <input type="tel" class="duty-rl-phone-edit" data-duty-rl-slot="${role}" data-duty-rl-idx="${idx}" value="${escapeAttr(slot.phone)}" placeholder="手机号" />
    </div>`;
  }
  if (!dutyRlSlotFilled(slot)) return "—";
  const name = String(slot.user_name || "").trim() || "—";
  const acc = String(slot.account || "").trim();
  const phone = String(slot.phone || "").trim() || "—";
  return `<div class="duty-rl-view-slot duty-rl-view-slot--inline">
    <span class="duty-rl-view-name">${escapeHtml(name)}</span>
    <span class="duty-rl-view-sep" aria-hidden="true">·</span>
    <span class="duty-rl-view-account">${escapeHtml(acc)}</span>
    <span class="duty-rl-view-sep" aria-hidden="true">·</span>
    <span class="duty-rl-phone-tag" title="手机号"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>
  </div>`;
}

function dutyCalendarSyncKey() {
  const a = state.dutyCalendarYm.kernel || { year: 0, month: 0 };
  const b = state.dutyCalendarYm.control || { year: 0, month: 0 };
  return `${a.year}-${a.month}|${b.year}-${b.month}`;
}

function mergeDutyMonthFromServer(kind, year, month, dateMap) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const bucket = { ...(state.dutyAssignments[kind] || {}) };
  Object.keys(bucket).forEach((k) => {
    if (k.startsWith(prefix)) delete bucket[k];
  });
  if (dateMap && typeof dateMap === "object") {
    Object.keys(dateMap).forEach((dk) => {
      const arr = dateMap[dk];
      if (Array.isArray(arr) && arr.length > 0) bucket[dk] = arr;
    });
  }
  state.dutyAssignments[kind] = bucket;
}

async function syncDutyCalendarMonthsFromServer() {
  const op = getCurrentOperator();
  const seen = new Map();
  ["kernel", "control"].forEach((k) => {
    const ym = state.dutyCalendarYm[k];
    if (!ym || !ym.year || !ym.month) return;
    const key = `${ym.year}-${ym.month}`;
    if (!seen.has(key)) seen.set(key, { year: ym.year, month: ym.month });
  });
  for (const { year, month } of seen.values()) {
    try {
      const resp = await fetch(
        `${API_BASE_URL}/api/duty/calendar?operator_id=${encodeURIComponent(op.account)}&year=${year}&month=${month}`
      );
      if (!resp.ok) continue;
      const json = await resp.json();
      mergeDutyMonthFromServer("kernel", year, month, json.kernel || {});
      mergeDutyMonthFromServer("control", year, month, json.control || {});
    } catch (_) {
      /* 离线时保留本地缓存 */
    }
  }
  persistDutyAssignmentsLocal();
}

async function persistDutyCalendarMonthToServer(kind, year, month) {
  persistDutyAssignmentsLocal();
  const op = getCurrentOperator();
  const last = new Date(year, month, 0).getDate();
  const bucket = state.dutyAssignments[kind] || {};
  const days = {};
  for (let d = 1; d <= last; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const arr = bucket[key];
    days[key] = Array.isArray(arr) ? arr : [];
  }
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/calendar`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        kind,
        year,
        month,
        days,
      }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      window.alert(`保存到服务器失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    window.alert(`保存到服务器失败：${String(e.message || e)}`);
    return false;
  }
}

function isDutyCalendarAdmin() {
  return getCurrentRoleCode() === "管理员";
}

function dutyRosterExtrasSyncKey() {
  const acc = getCurrentOperator().account || "";
  /** adminLoaded 后再拉一次，避免首屏角色未解析时漏掉「仅管理员」的本地数据迁移 */
  return `${acc}|${state.adminLoaded ? "1" : "0"}`;
}

/** @param {{ quiet?: boolean }} [options] quiet 时不弹窗（仅用于首次本地→服务端迁移） */
async function putDutyRotationToServer(options) {
  const quiet = !!(options && options.quiet);
  const op = getCurrentOperator();
  const lists = {};
  DUTY_ALL_ROTATION_KINDS.forEach((k) => {
    lists[k] = state.dutyRotationLists[k] || [];
  });
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/rotation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, lists }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      debugLog("duty.rotation.put.fail", { status: resp.status, detail: tx.slice(0, 200) });
      if (!quiet) window.alert(`保存到服务器失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    debugLog("duty.rotation.put.exception", { msg: String(e.message || e) });
    if (!quiet) window.alert(`保存到服务器失败：${String(e.message || e)}`);
    return false;
  }
}

/** @param {{ quiet?: boolean }} [options] */
async function putDutySiteOnCallToServer(options) {
  const quiet = !!(options && options.quiet);
  const op = getCurrentOperator();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/site-oncall`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, rows: state.dutySiteOnCallRows || [] }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      debugLog("duty.site.put.fail", { status: resp.status, detail: tx.slice(0, 200) });
      if (!quiet) window.alert(`局点值班表保存失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    debugLog("duty.site.put.exception", { msg: String(e.message || e) });
    if (!quiet) window.alert(`局点值班表保存失败：${String(e.message || e)}`);
    return false;
  }
}

/** @param {{ quiet?: boolean }} [options] */
async function putDutyRlOnCallToServer(options) {
  const quiet = !!(options && options.quiet);
  const op = getCurrentOperator();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/rl-oncall`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, rows: state.dutyRlOnCallRows || [] }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      debugLog("duty.rl.put.fail", { status: resp.status, detail: tx.slice(0, 200) });
      if (!quiet) window.alert(`RL 值班表保存失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    debugLog("duty.rl.put.exception", { msg: String(e.message || e) });
    if (!quiet) window.alert(`RL 值班表保存失败：${String(e.message || e)}`);
    return false;
  }
}

async function syncDutyRosterExtrasFromServer() {
  const op = getCurrentOperator();
  const admin = isDutyCalendarAdmin();
  const qs = `operator_id=${encodeURIComponent(op.account)}`;
  try {
    const [rRot, rSite, rRl] = await Promise.all([
      fetch(`${API_BASE_URL}/api/duty/rotation?${qs}`),
      fetch(`${API_BASE_URL}/api/duty/site-oncall?${qs}`),
      fetch(`${API_BASE_URL}/api/duty/rl-oncall?${qs}`),
    ]);

    if (rRot.ok) {
      const jr = await rRot.json();
      const serverEmpty = DUTY_ALL_ROTATION_KINDS.every((k) => !((jr[k] || []).length > 0));
      const localHas = DUTY_ALL_ROTATION_KINDS.some((k) => (state.dutyRotationLists[k] || []).length > 0);
      if (serverEmpty && localHas && admin) {
        await putDutyRotationToServer({ quiet: true });
      } else if (!serverEmpty || !localHas) {
        DUTY_ALL_ROTATION_KINDS.forEach((k) => {
          state.dutyRotationLists[k] = normalizeDutyRotationList(Array.isArray(jr[k]) ? jr[k] : []);
        });
      }
      persistDutyRotationLocal();
    }

    if (rSite.ok) {
      const js = await rSite.json();
      const rows = Array.isArray(js.rows) ? js.rows : [];
      const serverEmpty = rows.length === 0;
      const localHas = (state.dutySiteOnCallRows || []).length > 0;
      if (serverEmpty && localHas && admin) {
        await putDutySiteOnCallToServer({ quiet: true });
      } else if (!serverEmpty || !localHas) {
        state.dutySiteOnCallRows = normalizeDutySiteOnCallRows(rows);
      }
      persistDutySiteOnCallLocal();
    }

    if (rRl.ok) {
      const jl = await rRl.json();
      const rows = Array.isArray(jl.rows) ? jl.rows : [];
      const serverEmpty = rows.length === 0;
      const localHas = (state.dutyRlOnCallRows || []).length > 0;
      if (serverEmpty && localHas && admin) {
        await putDutyRlOnCallToServer({ quiet: true });
      } else if (!serverEmpty || !localHas) {
        state.dutyRlOnCallRows = normalizeDutyRlOnCallRows(rows);
      }
      persistDutyRlOnCallLocal();
    }
  } catch (_) {
    /* 离线时保留本地缓存 */
  }
}

function persistDutyRotationLocalAndServer() {
  persistDutyRotationLocal();
  if (!isDutyCalendarAdmin()) return;
  void putDutyRotationToServer();
}

function persistDutySiteOnCallLocalAndServer() {
  persistDutySiteOnCallLocal();
  if (!isDutyCalendarAdmin()) return;
  void putDutySiteOnCallToServer();
}

function persistDutyRlOnCallLocalAndServer() {
  persistDutyRlOnCallLocal();
  if (!isDutyCalendarAdmin()) return;
  void putDutyRlOnCallToServer();
}

function dutyShiftLabel(shift) {
  return shift === DUTY_SHIFT_NIGHT ? "晚班" : "全天";
}

function getDutySelectableUsers() {
  return state.adminUsers.filter((u) => {
    const a = u.is_active;
    if (a === false) return false;
    if (a != null && String(a).toLowerCase() === "false") return false;
    if (String(a) === "0") return false;
    const r = String(u.role_code || "");
    return DUTY_SELECTABLE_ROLE_CODES.has(r);
  });
}

function dutyModalUserLabel(u) {
  const acc = String(u.account || "");
  const nm = String(u.user_name || "");
  return nm ? `${nm} (${acc})` : acc;
}

function formatDutyRotationLastAccept(at) {
  if (!at || !String(at).trim()) return "—";
  const s = String(at).trim();
  const d = new Date(s.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return s;
}

function dutyRotationDatetimeLocalValue(at) {
  if (!at) return "";
  const s = String(at).trim();
  const d = new Date(s.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}` : "";
}

/**
 * @param {{ blockId: string, title: string, rKind: string, outer: "section"|"div", headingTag: "h2"|"h3", outerClass?: string }} opts
 */
function renderDutyRotationUnit(opts) {
  const { blockId, title, rKind, outer, headingTag, outerClass = "" } = opts;
  const admin = isDutyCalendarAdmin();
  const editing = !!state.dutyRotationEditMode[rKind];
  const list = state.dutyRotationLists[rKind] || [];
  const editBtn = admin
    ? `<button type="button" class="action duty-rot-edit-btn" data-duty-rot-edit="${escapeAttr(rKind)}">${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const noUsers = getDutySelectableUsers().length === 0;
  const rows = list
    .map((row, idx) => {
      const seq = idx + 1;
      const dispName = String(row.user_name || "").trim()
        ? `${String(row.user_name)} (${String(row.account)})`
        : String(row.account);
      const st = row.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_INACTIVE : DUTY_ROTATION_STATUS_ACTIVE;
      const statusCell = editing
        ? `<button type="button" class="duty-rot-status-toggle duty-rot-status-toggle--${st}" data-duty-rot-toggle="${escapeAttr(
            rKind
          )}" data-duty-rot-idx="${idx}" title="切换当值/置灰">${st === DUTY_ROTATION_STATUS_ACTIVE ? "● 当值" : "○ 置灰"}</button>`
        : `<span class="duty-rot-status duty-rot-status--${st}"><span class="duty-rot-status-dot" aria-hidden="true"></span>${
            st === DUTY_ROTATION_STATUS_ACTIVE ? "当值" : "置灰"
          }</span>`;
      const lastRaw = row.last_accept_at;
      const lastCell = editing
        ? `<input type="datetime-local" class="duty-rot-last-input" data-duty-rot-last="${escapeAttr(rKind)}" data-duty-rot-idx="${idx}" value="${escapeAttr(
            dutyRotationDatetimeLocalValue(lastRaw)
          )}" />`
        : escapeHtml(formatDutyRotationLastAccept(lastRaw));
      const opCell = editing
        ? `<button type="button" class="action danger duty-rot-remove-btn" data-duty-rot-remove="${escapeAttr(rKind)}" data-duty-rot-idx="${idx}">删除</button>`
        : "";
      return `<tr>
        <td class="duty-rot-col-seq">${seq}</td>
        <td>${escapeHtml(dispName)}</td>
        <td class="duty-rot-col-status">${statusCell}</td>
        <td class="duty-rot-col-last">${lastCell}</td>
        ${editing ? `<td class="duty-rot-col-op">${opCell}</td>` : ""}
      </tr>`;
    })
    .join("");
  const emptyMsg = admin ? "暂无轮值人员，可在编辑模式下添加。" : "暂无轮值人员，请联系管理员维护。";
  const tbodyContent =
    list.length > 0
      ? rows
      : `<tr><td colspan="${editing ? 5 : 4}" class="duty-rot-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const thead = editing
    ? `<thead><tr><th>序号</th><th>姓名</th><th>当值状态</th><th>最近接单时间</th><th>操作</th></tr></thead>`
    : `<thead><tr><th>序号</th><th>姓名</th><th>当值状态</th><th>最近接单时间</th></tr></thead>`;
  const addBlock = editing
    ? `<div class="duty-rot-add">
          <label class="duty-modal-field duty-modal-field--user">添加人员
            <div class="duty-modal-user-combo duty-rot-user-combo" data-duty-rot-combo="${escapeAttr(rKind)}">
              <input
                type="text"
                id="duty-rot-${escapeAttr(rKind)}-input"
                autocomplete="off"
                placeholder="${noUsers ? "暂无可用人员" : "输入姓名或账号搜索"}"
                aria-autocomplete="list"
                aria-controls="duty-rot-${escapeAttr(rKind)}-list"
                aria-expanded="false"
                role="combobox"
                ${noUsers ? "disabled" : ""}
              />
              <input type="hidden" id="duty-rot-${escapeAttr(rKind)}-account" value="" />
              <ul id="duty-rot-${escapeAttr(rKind)}-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
            </div>
          </label>
          <button type="button" class="action primary duty-rot-add-btn" data-duty-rot-add="${escapeAttr(rKind)}">添加至轮值</button>
        </div>`
    : "";
  const blockClass = `duty-roster-block${outerClass ? ` ${outerClass}` : ""}`;
  const titleClass = headingTag === "h3" ? "duty-roster-block-title duty-rot-subtitle" : "duty-roster-block-title";
  return `<${outer} class="${blockClass}" id="${escapeAttr(blockId)}">
          <div class="duty-roster-block-head">
            <${headingTag} class="${titleClass}">${escapeHtml(title)}</${headingTag}>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card${editing ? " duty-roster-card--editing" : ""}">
            <table class="duty-roster-table duty-rot-table">
              ${thead}
              <tbody>${tbodyContent}</tbody>
            </table>
            ${addBlock}
          </div>
        </${outer}>`;
}

function renderDutyRotationBlock(sectionId, title, rKind) {
  return renderDutyRotationUnit({
    blockId: sectionId,
    title,
    rKind,
    outer: "section",
    headingTag: "h2",
  });
}

function renderDutySpecialRotationSection() {
  const subs = DUTY_SPECIAL_ROTATION_SUBTABLES.map((sub) =>
    renderDutyRotationUnit({
      blockId: sub.anchorId,
      title: sub.title,
      rKind: sub.kind,
      outer: "div",
      headingTag: "h3",
      outerClass: "duty-special-rot-sub",
    })
  ).join("");
  return `
        <section class="duty-roster-block duty-special-rotation-wrap" id="duty-special-rotation">
          <h2 class="duty-roster-block-title">专项轮值表</h2>
          <div class="duty-special-rotation-stack">${subs}</div>
        </section>`;
}

function renderDutySiteOnCallBlock(sectionId, title) {
  const admin = isDutyCalendarAdmin();
  const editing = !!state.dutySiteOnCallEditMode;
  const list = state.dutySiteOnCallRows || [];
  const editBtn = admin
    ? `<button type="button" class="action duty-site-edit-btn" data-duty-site-edit>${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const noUsers = getDutySelectableUsers().length === 0;
  const rows = list
    .map((row, idx) => {
      const dispName = dutyModalUserLabel({ account: row.account, user_name: row.user_name });
      const st = row.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_INACTIVE : DUTY_ROTATION_STATUS_ACTIVE;
      const siteCell = editing
        ? `<input type="text" class="duty-site-name-input" data-duty-site-name-idx="${idx}" value="${escapeAttr(row.site_name)}" placeholder="局点名称" />`
        : escapeHtml(row.site_name);
      const statusCell = editing
        ? `<button type="button" class="duty-rot-status-toggle duty-rot-status-toggle--${st}" data-duty-site-toggle data-duty-site-idx="${idx}" title="切换当值/置灰">${st === DUTY_ROTATION_STATUS_ACTIVE ? "● 当值" : "○ 置灰"}</button>`
        : `<span class="duty-rot-status duty-rot-status--${st}"><span class="duty-rot-status-dot" aria-hidden="true"></span>${
            st === DUTY_ROTATION_STATUS_ACTIVE ? "当值" : "置灰"
          }</span>`;
      const lastRaw = row.last_accept_at;
      const lastCell = editing
        ? `<input type="datetime-local" class="duty-rot-last-input duty-site-last-input" data-duty-site-last data-duty-site-idx="${idx}" value="${escapeAttr(
            dutyRotationDatetimeLocalValue(lastRaw)
          )}" />`
        : escapeHtml(formatDutyRotationLastAccept(lastRaw));
      const opCell = editing
        ? `<button type="button" class="action danger duty-site-remove-btn" data-duty-site-idx="${idx}">删除</button>`
        : "";
      return `<tr>
        <td class="duty-site-col-name">${siteCell}</td>
        <td>${escapeHtml(dispName)}</td>
        <td class="duty-rot-col-status">${statusCell}</td>
        <td class="duty-rot-col-last">${lastCell}</td>
        ${editing ? `<td class="duty-rot-col-op">${opCell}</td>` : ""}
      </tr>`;
    })
    .join("");
  const emptyMsg = admin ? "暂无局点排班，编辑模式下可添加。" : "暂无局点排班，请联系管理员维护。";
  const tbodyContent =
    list.length > 0
      ? rows
      : `<tr><td colspan="${editing ? 5 : 4}" class="duty-rot-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const thead = editing
    ? `<thead><tr><th>局点名称</th><th>姓名</th><th>当值状态</th><th>最晚接单时间</th><th>操作</th></tr></thead>`
    : `<thead><tr><th>局点名称</th><th>姓名</th><th>当值状态</th><th>最晚接单时间</th></tr></thead>`;
  const addBlock = editing
    ? `<div class="duty-rot-add duty-site-oncall-add">
          <label class="duty-modal-field">局点名称
            <input type="text" id="duty-site-new-site" class="duty-site-new-site-input" placeholder="例如：华东局点" />
          </label>
          <label class="duty-modal-field duty-modal-field--user">人员
            <div class="duty-modal-user-combo duty-rot-user-combo">
              <input
                type="text"
                id="duty-site-oncall-input"
                autocomplete="off"
                placeholder="${noUsers ? "暂无可用人员" : "输入姓名或账号搜索"}"
                aria-autocomplete="list"
                aria-controls="duty-site-oncall-list"
                aria-expanded="false"
                role="combobox"
                ${noUsers ? "disabled" : ""}
              />
              <input type="hidden" id="duty-site-oncall-account" value="" />
              <ul id="duty-site-oncall-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
            </div>
          </label>
          <button type="button" class="action primary" id="duty-site-add-row-btn">添加一行</button>
        </div>`
    : "";
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card${editing ? " duty-roster-card--editing" : ""}">
            <table class="duty-roster-table duty-rot-table duty-site-oncall-table">
              ${thead}
              <tbody>${tbodyContent}</tbody>
            </table>
            ${addBlock}
          </div>
        </section>`;
}

function renderDutyRlOnCallBlock(sectionId, title) {
  const admin = isDutyCalendarAdmin();
  const editing = !!state.dutyRlOnCallEditMode;
  const list = [...(state.dutyRlOnCallRows || [])].sort((a, b) => b.duty_date.localeCompare(a.duty_date));
  const todayKey = dutyRlLocalDateKey();
  const todayRow = list.find((r) => r.duty_date === todayKey) || null;
  const editBtn = admin
    ? `<button type="button" class="action duty-rl-edit-btn" data-duty-rl-edit>${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const noUsers = getDutySelectableUsers().length === 0;
  const discipline = `
    <div class="duty-rl-discipline">
      <p class="duty-rl-discipline-title">值班纪律及纪律说明：</p>
      <p class="duty-rl-discipline-body">非紧急问题走正常流程，值班时间：当天 9:00～次日 9:00。</p>
    </div>`;
  const todayBanner = `
    <div class="duty-rl-today-banner" role="region" aria-label="当日值班">
      <p class="duty-rl-today-line"><strong>当前时间：</strong>${escapeHtml(formatDutyRlNowZh())}</p>
      <p class="duty-rl-today-line"><strong>主值班：</strong>${formatRlTodayBannerPart(todayRow?.primary)}</p>
      <p class="duty-rl-today-line"><strong>备值班：</strong>${formatRlTodayBannerPart(todayRow?.backup)}</p>
    </div>`;
  const tableRows = list
    .map((row, idx) => {
      const origIdx = (state.dutyRlOnCallRows || []).findIndex((r) => r.duty_date === row.duty_date);
      const i = origIdx >= 0 ? origIdx : idx;
      const dateCell = escapeHtml(formatDutyRlTableDateLabel(row.duty_date));
      const pri = renderRlPersonTableCell(row.primary, editing, i, "primary");
      const bak = renderRlPersonTableCell(row.backup, editing, i, "backup");
      const op = editing
        ? `<button type="button" class="action danger duty-rl-remove-btn" data-duty-rl-idx="${i}">删除</button>`
        : "";
      return `<tr>
        <td class="duty-rl-col-date">${dateCell}</td>
        <td class="duty-rl-col-person">${pri}</td>
        <td class="duty-rl-col-person">${bak}</td>
        ${editing ? `<td class="duty-rot-col-op">${op}</td>` : ""}
      </tr>`;
    })
    .join("");
  const emptyMsg = admin ? "暂无记录，编辑模式下可按日期添加主/备值班。" : "暂无记录，请联系管理员维护。";
  const tbodyContent =
    list.length > 0
      ? tableRows
      : `<tr><td colspan="${editing ? 4 : 3}" class="duty-rot-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const thead = editing
    ? `<thead><tr><th>日期</th><th>主值班</th><th>备值班</th><th>操作</th></tr></thead>`
    : `<thead><tr><th>日期</th><th>主值班</th><th>备值班</th></tr></thead>`;
  const addBlock = editing
    ? `<div class="duty-rl-add-block">
          <p class="duty-rl-add-title">添加记录（须填写手机号；同一日期将覆盖原记录）</p>
          <div class="duty-rl-add-grid">
            <label class="duty-modal-field">值班日期
              <input type="date" id="duty-rl-new-date" class="duty-rl-date-input" value="${escapeAttr(dutyRlLocalDateKey())}" />
            </label>
            <label class="duty-modal-field duty-modal-field--user">主值班
              <div class="duty-modal-user-combo duty-rot-user-combo">
                <input type="text" id="duty-rl-primary-input" autocomplete="off" placeholder="${noUsers ? "暂无可用人员" : "搜索姓名或账号"}" aria-autocomplete="list" aria-controls="duty-rl-primary-list" aria-expanded="false" role="combobox" ${noUsers ? "disabled" : ""} />
                <input type="hidden" id="duty-rl-primary-account" value="" />
                <ul id="duty-rl-primary-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
              </div>
            </label>
            <label class="duty-modal-field">主值班手机
              <input type="tel" id="duty-rl-primary-phone" class="duty-rl-phone-new" placeholder="11 位手机号" />
            </label>
            <label class="duty-modal-field duty-modal-field--user">备值班
              <div class="duty-modal-user-combo duty-rot-user-combo">
                <input type="text" id="duty-rl-backup-input" autocomplete="off" placeholder="可选" aria-autocomplete="list" aria-controls="duty-rl-backup-list" aria-expanded="false" role="combobox" ${noUsers ? "disabled" : ""} />
                <input type="hidden" id="duty-rl-backup-account" value="" />
                <ul id="duty-rl-backup-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
              </div>
            </label>
            <label class="duty-modal-field">备值班手机
              <input type="tel" id="duty-rl-backup-phone" class="duty-rl-phone-new" placeholder="有备值班则必填" />
            </label>
          </div>
          <button type="button" class="action primary" id="duty-rl-add-row-btn">添加</button>
        </div>`
    : "";
  const recentTitle = `<h3 class="duty-rl-recent-title">最近的值班信息</h3>`;
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card${editing ? " duty-roster-card--editing" : ""}">
            ${discipline}
            ${todayBanner}
            ${recentTitle}
            <table class="duty-roster-table duty-rot-table duty-rl-table">
              ${thead}
              <tbody>${tbodyContent}</tbody>
            </table>
            ${addBlock}
          </div>
        </section>`;
}

function dutyRosterAnchorValid(id) {
  if (!id) return false;
  if (DUTY_ROSTER_SECTIONS.some((s) => s.id === id)) return true;
  return DUTY_SPECIAL_ROTATION_SUBTABLES.some((s) => s.anchorId === id);
}

function renderDutySubmenuHtml() {
  const parts = [];
  const specialOpen = !!state.dutySpecialSubmenuExpanded;
  DUTY_ROSTER_SECTIONS.forEach((s) => {
    if (s.id === "duty-special-rotation") {
      const nested = DUTY_SPECIAL_ROTATION_SUBTABLES.map(
        (sub) =>
          `<button type="button" class="menu-submenu-item menu-submenu-item--duty-nested" role="menuitem" data-duty-anchor="${escapeAttr(sub.anchorId)}">${escapeHtml(sub.title)}</button>`
      ).join("");
      parts.push(
        `<div class="menu-submenu-special-group" role="presentation">
          <div class="menu-submenu-special-row">
            <button type="button" class="menu-submenu-item menu-submenu-item--special-main" role="menuitem" data-duty-anchor="${escapeAttr(s.id)}">${escapeHtml(s.title)}</button>
            <button type="button" class="menu-submenu-expand-btn" data-duty-special-toggle aria-expanded="${specialOpen}" aria-label="展开或收起专项子表">${specialOpen ? "▾" : "▸"}</button>
          </div>
          <div class="menu-submenu-nested-wrap"${specialOpen ? "" : " hidden"}>${nested}</div>
        </div>`
      );
    } else {
      parts.push(
        `<button type="button" class="menu-submenu-item" role="menuitem" data-duty-anchor="${escapeAttr(s.id)}">${escapeHtml(s.title)}</button>`
      );
    }
  });
  return parts.join("");
}

/** @returns {Array<Array<{ key: string, day: number } | null>>} */
function buildDutyMonthWeeks(year, month1) {
  const first = new Date(year, month1 - 1, 1);
  const last = new Date(year, month1, 0);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ key, day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function getDutyAssignmentsForDay(kind, dateKey) {
  const bucket = state.dutyAssignments[kind];
  if (!bucket || !dateKey) return [];
  const arr = bucket[dateKey];
  return Array.isArray(arr) ? arr : [];
}

/** 内核/管控日历格：排班条是否当前登录人（账号优先，再按姓名展示串） */
function dutyAssignmentMatchesCurrentUser(item) {
  const op = getCurrentOperator();
  const rowAcc = String(item.account || "").trim();
  const opAcc = String(op.account || "").trim();
  if (rowAcc && opAcc && rowAcc === opAcc) return true;
  const label = String(item.user_name || item.account || "").trim();
  return operatorMatchesPersonField(label, op);
}

function renderDutyCalendarBlock(sectionId, title, kind) {
  const ym = state.dutyCalendarYm[kind] || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const weeks = buildDutyMonthWeeks(year, month);
  const admin = isDutyCalendarAdmin();
  const editing = !!state.dutyEditMode[kind];
  const titleZh = `${year}年${month}月`;
  const wkLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const editBtn = admin
    ? `<button type="button" class="action duty-cal-edit-btn" data-duty-cal-edit="${escapeAttr(kind)}">${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const cellsHtml = weeks
    .map((row) => {
      const tds = row
        .map((cell) => {
          if (!cell) {
            return `<td class="duty-cal-cell duty-cal-cell--empty"></td>`;
          }
          const list = getDutyAssignmentsForDay(kind, cell.key);
          const hasSelf = list.some((it) => dutyAssignmentMatchesCurrentUser(it));
          const chips = list
            .map((item, idx) => {
              const sh = item.shift === DUTY_SHIFT_NIGHT ? "night" : "full";
              const cls = sh === "night" ? "duty-cal-chip duty-cal-chip--night" : "duty-cal-chip duty-cal-chip--full";
              const name = escapeHtml(String(item.user_name || item.account || ""));
              const tag = escapeHtml(dutyShiftLabel(sh));
              return `<span class="${cls}"><span class="duty-cal-chip-name">${name}</span><span class="duty-cal-chip-shift">${tag}</span></span>`;
            })
            .join("");
          const interactive = admin && editing ? `tabindex="0" role="button" data-duty-cal-cell="${escapeAttr(kind)}" data-duty-cal-date="${escapeAttr(cell.key)}"` : "";
          const cls = `duty-cal-cell${hasSelf ? " duty-cal-cell--self" : ""}${admin && editing ? " duty-cal-cell--interactive" : ""}`;
          return `<td class="${cls}" ${interactive}><span class="duty-cal-daynum">${cell.day}</span><div class="duty-cal-chips">${chips}</div></td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const headRow = `<tr>${wkLabels.map((l) => `<th class="duty-cal-wk">${escapeHtml(l)}</th>`).join("")}</tr>`;
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">
              ${editBtn}
            </div>
          </div>
          <div class="duty-roster-card duty-roster-card--calendar${editing ? " duty-roster-card--editing" : ""}">
            <div class="duty-cal-toolbar">
              <button type="button" class="action duty-cal-nav" data-duty-cal-nav="${escapeAttr(kind)}" data-duty-cal-dir="-1" aria-label="上个月">‹ 上个月</button>
              <span class="duty-cal-month-label">${escapeHtml(titleZh)}</span>
              <button type="button" class="action duty-cal-nav" data-duty-cal-nav="${escapeAttr(kind)}" data-duty-cal-dir="1" aria-label="下个月">下个月 ›</button>
            </div>
            <table class="duty-cal-table">
              <thead>${headRow}</thead>
              <tbody>${cellsHtml}</tbody>
            </table>
          </div>
        </section>`;
}

function renderDutyDayModalHtml() {
  const m = state.dutyDayModal;
  if (!m) return "";
  const { kind, dateKey } = m;
  const titleMap = { kernel: "内核值班表", control: "管控值班表" };
  const sectionTitle = titleMap[kind] || kind;
  const users = getDutySelectableUsers();
  const list = getDutyAssignmentsForDay(kind, dateKey);
  const [y, mo, d] = dateKey.split("-").map((x) => parseInt(x, 10));
  const dateLabel = `${y}年${mo}月${d}日`;
  const noDutyUsers = users.length === 0;
  const rows = list
    .map((item, idx) => {
      const sh = item.shift === DUTY_SHIFT_NIGHT ? DUTY_SHIFT_NIGHT : DUTY_SHIFT_FULL;
      return `<li class="duty-modal-row">
        <span class="duty-modal-row-text">${escapeHtml(String(item.user_name || item.account || ""))}</span>
        <span class="duty-modal-shift-tag ${sh === DUTY_SHIFT_NIGHT ? "duty-modal-shift-tag--night" : "duty-modal-shift-tag--full"}">${escapeHtml(dutyShiftLabel(sh))}</span>
        <button type="button" class="action danger duty-modal-remove" data-duty-modal-remove="${idx}">删除</button>
      </li>`;
    })
    .join("");
  return `
  <div class="perm-modal-mask duty-day-modal-mask" id="duty-day-modal-mask">
    <div class="perm-modal duty-day-modal" role="dialog" aria-modal="true" aria-labelledby="duty-day-modal-title">
      <div class="perm-modal-head">
        <h3 id="duty-day-modal-title">编辑值班 — ${escapeHtml(sectionTitle)} — ${escapeHtml(dateLabel)}</h3>
      </div>
      <div class="perm-modal-body">
        <p class="duty-modal-sub">同一日可添加多名人员；请区分「全天」与「晚班」。</p>
        <ul class="duty-modal-list">${rows || '<li class="duty-modal-empty">当日暂无排班</li>'}</ul>
        <div class="duty-modal-add">
          <label class="duty-modal-field duty-modal-field--user">人员
            <div class="duty-modal-user-combo">
              <input
                type="text"
                id="duty-modal-user-input"
                autocomplete="off"
                placeholder="${noDutyUsers ? "暂无可用人员（请先同步用户管理）" : "输入姓名或账号搜索"}"
                aria-autocomplete="list"
                aria-controls="duty-modal-user-listbox"
                aria-expanded="false"
                role="combobox"
                ${noDutyUsers ? "disabled" : ""}
              />
              <input type="hidden" id="duty-modal-user-account" value="" />
              <ul id="duty-modal-user-listbox" class="duty-modal-user-suggest" role="listbox" hidden></ul>
            </div>
          </label>
          <fieldset class="duty-modal-shifts">
            <legend class="sr-only">班次</legend>
            <label><input type="radio" name="duty-modal-shift" value="${DUTY_SHIFT_FULL}" checked /> 全天</label>
            <label><input type="radio" name="duty-modal-shift" value="${DUTY_SHIFT_NIGHT}" /> 晚班</label>
          </fieldset>
          <button type="button" class="action primary" id="duty-modal-add-btn">添加</button>
        </div>
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="duty-modal-close-btn">关闭</button>
      </div>
    </div>
  </div>`;
}

function renderDutyRosterPage() {
  const blocks = DUTY_ROSTER_SECTIONS.map((sec) => {
    const kind = DUTY_CALENDAR_KIND_BY_SECTION_ID[sec.id];
    if (kind) {
      return renderDutyCalendarBlock(sec.id, sec.title, kind);
    }
    if (sec.id === "duty-special-rotation") {
      return renderDutySpecialRotationSection();
    }
    const rotKind = DUTY_ROTATION_KIND_BY_SECTION_ID[sec.id];
    if (rotKind) {
      return renderDutyRotationBlock(sec.id, sec.title, rotKind);
    }
    if (sec.id === "duty-site-oncall") {
      return renderDutySiteOnCallBlock(sec.id, sec.title);
    }
    if (sec.id === "duty-rl-oncall") {
      return renderDutyRlOnCallBlock(sec.id, sec.title);
    }
    return `
        <section class="duty-roster-block" id="${escapeAttr(sec.id)}">
          <h2 class="duty-roster-block-title">${escapeHtml(sec.title)}</h2>
          <div class="duty-roster-card"><p class="duty-roster-note">该区块尚未配置。</p></div>
        </section>`;
  }).join("");
  return `
      <div class="duty-roster-page">
        ${blocks}
      </div>`;
}

function bindDutyRotationUserCombo(rKind) {
  const userInput = document.getElementById(`duty-rot-${rKind}-input`);
  const userAccountHidden = document.getElementById(`duty-rot-${rKind}-account`);
  const userList = document.getElementById(`duty-rot-${rKind}-list`);
  if (!userInput || !userAccountHidden || !userList) return;

  function closeRotSuggest() {
    userList.hidden = true;
    userInput.setAttribute("aria-expanded", "false");
  }

  function openRotSuggest(filterText) {
    if (userInput.disabled) return;
    const pool = getDutySelectableUsers();
    const qq = (filterText || "").trim().toLowerCase();
    const filtered =
      qq === ""
        ? pool.slice(0, 100)
        : pool.filter((u) => {
            const acc = String(u.account || "").toLowerCase();
            const nm = String(u.user_name || "").toLowerCase();
            const lab = dutyModalUserLabel(u).toLowerCase();
            return acc.includes(qq) || nm.includes(qq) || lab.includes(qq);
          }).slice(0, 100);
    if (filtered.length === 0) {
      userList.innerHTML = `<li class="duty-modal-user-suggest-empty" role="presentation">无匹配人员</li>`;
    } else {
      userList.innerHTML = filtered
        .map((u) => {
          const acc = String(u.account || "");
          return `<li role="option" class="duty-modal-user-suggest-item" data-account="${escapeAttr(acc)}">${escapeHtml(dutyModalUserLabel(u))}</li>`;
        })
        .join("");
    }
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput.addEventListener("focus", () => {
    openRotSuggest(userInput.value);
  });
  userInput.addEventListener("input", () => {
    userAccountHidden.value = "";
    openRotSuggest(userInput.value);
  });
  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeRotSuggest();
  });
  userList.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    closeRotSuggest();
  });
}

function bindDutySiteOnCallAddCombo() {
  const userInput = document.getElementById("duty-site-oncall-input");
  const userAccountHidden = document.getElementById("duty-site-oncall-account");
  const userList = document.getElementById("duty-site-oncall-list");
  if (!userInput || !userAccountHidden || !userList) return;

  function closeSuggest() {
    userList.hidden = true;
    userInput.setAttribute("aria-expanded", "false");
  }

  function openSuggest(filterText) {
    if (userInput.disabled) return;
    const pool = getDutySelectableUsers();
    const qq = (filterText || "").trim().toLowerCase();
    const filtered =
      qq === ""
        ? pool.slice(0, 100)
        : pool.filter((u) => {
            const acc = String(u.account || "").toLowerCase();
            const nm = String(u.user_name || "").toLowerCase();
            const lab = dutyModalUserLabel(u).toLowerCase();
            return acc.includes(qq) || nm.includes(qq) || lab.includes(qq);
          }).slice(0, 100);
    if (filtered.length === 0) {
      userList.innerHTML = `<li class="duty-modal-user-suggest-empty" role="presentation">无匹配人员</li>`;
    } else {
      userList.innerHTML = filtered
        .map((u) => {
          const acc = String(u.account || "");
          return `<li role="option" class="duty-modal-user-suggest-item" data-account="${escapeAttr(acc)}">${escapeHtml(dutyModalUserLabel(u))}</li>`;
        })
        .join("");
    }
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput.addEventListener("focus", () => {
    openSuggest(userInput.value);
  });
  userInput.addEventListener("input", () => {
    userAccountHidden.value = "";
    openSuggest(userInput.value);
  });
  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeSuggest();
  });
  userList.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    closeSuggest();
  });
}

function bindDutyRlUserCombo(role) {
  const userInput = document.getElementById(`duty-rl-${role}-input`);
  const userAccountHidden = document.getElementById(`duty-rl-${role}-account`);
  const userList = document.getElementById(`duty-rl-${role}-list`);
  if (!userInput || !userAccountHidden || !userList) return;

  function closeRlSuggest() {
    userList.hidden = true;
    userInput.setAttribute("aria-expanded", "false");
  }

  function openRlSuggest(filterText) {
    if (userInput.disabled) return;
    const pool = getDutySelectableUsers();
    const qq = (filterText || "").trim().toLowerCase();
    const filtered =
      qq === ""
        ? pool.slice(0, 100)
        : pool.filter((u) => {
            const acc = String(u.account || "").toLowerCase();
            const nm = String(u.user_name || "").toLowerCase();
            const lab = dutyModalUserLabel(u).toLowerCase();
            return acc.includes(qq) || nm.includes(qq) || lab.includes(qq);
          }).slice(0, 100);
    if (filtered.length === 0) {
      userList.innerHTML = `<li class="duty-modal-user-suggest-empty" role="presentation">无匹配人员</li>`;
    } else {
      userList.innerHTML = filtered
        .map((u) => {
          const acc = String(u.account || "");
          return `<li role="option" class="duty-modal-user-suggest-item" data-account="${escapeAttr(acc)}">${escapeHtml(dutyModalUserLabel(u))}</li>`;
        })
        .join("");
    }
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput.addEventListener("focus", () => {
    openRlSuggest(userInput.value);
  });
  userInput.addEventListener("input", () => {
    userAccountHidden.value = "";
    openRlSuggest(userInput.value);
  });
  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeRlSuggest();
  });
  userList.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    closeRlSuggest();
  });
}

function bindDutyRosterPage() {
  const sk = dutyCalendarSyncKey();
  if (state.dutyCalendarLoadedKey !== sk && !state.dutyCalendarSyncPending) {
    state.dutyCalendarSyncPending = true;
    void syncDutyCalendarMonthsFromServer().then(() => {
      state.dutyCalendarSyncPending = false;
      state.dutyCalendarLoadedKey = sk;
      render();
    });
  }

  const exSk = dutyRosterExtrasSyncKey();
  if (state.dutyRosterExtrasLoadedKey !== exSk && !state.dutyRosterExtrasSyncPending) {
    state.dutyRosterExtrasSyncPending = true;
    void syncDutyRosterExtrasFromServer().then(() => {
      state.dutyRosterExtrasSyncPending = false;
      state.dutyRosterExtrasLoadedKey = exSk;
      render();
    });
  }

  document.querySelectorAll("[data-duty-cal-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-duty-cal-nav");
      const dir = parseInt(btn.getAttribute("data-duty-cal-dir") || "0", 10);
      if (!kind || !state.dutyCalendarYm[kind]) return;
      let { year, month } = state.dutyCalendarYm[kind];
      month += dir;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      if (month > 12) {
        month = 1;
        year += 1;
      }
      state.dutyCalendarYm[kind] = { year, month };
      state.dutyCalendarLoadedKey = "";
      render();
    });
  });
  document.querySelectorAll("[data-duty-cal-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-duty-cal-edit");
      if (!kind) return;
      state.dutyEditMode[kind] = !state.dutyEditMode[kind];
      if (!state.dutyEditMode[kind]) state.dutyDayModal = null;
      render();
    });
  });
  document.querySelectorAll("[data-duty-cal-cell]").forEach((cell) => {
    cell.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const kind = cell.getAttribute("data-duty-cal-cell");
      const dateKey = cell.getAttribute("data-duty-cal-date");
      if (!kind || !dateKey) return;
      state.dutyDayModal = { kind, dateKey };
      render();
    });
  });
  const mask = document.getElementById("duty-day-modal-mask");
  const closeBtn = document.getElementById("duty-modal-close-btn");
  const addBtn = document.getElementById("duty-modal-add-btn");
  const modalInner = mask?.querySelector(".duty-day-modal");
  const userInput = document.getElementById("duty-modal-user-input");
  const userAccountHidden = document.getElementById("duty-modal-user-account");
  const userList = document.getElementById("duty-modal-user-listbox");
  const userCombo = document.querySelector(".duty-modal-user-combo");

  function closeDutyUserSuggest() {
    if (userList) userList.hidden = true;
    userInput?.setAttribute("aria-expanded", "false");
  }

  function openDutyUserSuggest(filterText) {
    if (!userInput || !userList || userInput.disabled) return;
    const pool = getDutySelectableUsers();
    const qq = (filterText || "").trim().toLowerCase();
    const filtered =
      qq === ""
        ? pool.slice(0, 100)
        : pool.filter((u) => {
            const acc = String(u.account || "").toLowerCase();
            const nm = String(u.user_name || "").toLowerCase();
            const lab = dutyModalUserLabel(u).toLowerCase();
            return acc.includes(qq) || nm.includes(qq) || lab.includes(qq);
          }).slice(0, 100);
    if (filtered.length === 0) {
      userList.innerHTML = `<li class="duty-modal-user-suggest-empty" role="presentation">无匹配人员</li>`;
    } else {
      userList.innerHTML = filtered
        .map((u) => {
          const acc = String(u.account || "");
          return `<li role="option" class="duty-modal-user-suggest-item" data-account="${escapeAttr(acc)}">${escapeHtml(dutyModalUserLabel(u))}</li>`;
        })
        .join("");
    }
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput?.addEventListener("focus", () => {
    openDutyUserSuggest(userInput.value);
  });
  userInput?.addEventListener("input", () => {
    if (userAccountHidden) userAccountHidden.value = "";
    openDutyUserSuggest(userInput.value);
  });
  userInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeDutyUserSuggest();
  });
  userList?.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li || !userAccountHidden || !userInput) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    closeDutyUserSuggest();
  });

  mask?.addEventListener("click", (ev) => {
    if (ev.target === mask) {
      state.dutyDayModal = null;
      render();
    }
  });
  closeBtn?.addEventListener("click", () => {
    state.dutyDayModal = null;
    render();
  });
  modalInner?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (userCombo && userList && !userList.hidden && !userCombo.contains(ev.target)) {
      closeDutyUserSuggest();
    }
  });
  addBtn?.addEventListener("click", async () => {
    const m = state.dutyDayModal;
    if (!m) return;
    let acc = (userAccountHidden?.value || "").trim();
    if (!acc && userInput) {
      const q = (userInput.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) acc = String(exact[0].account || "");
    }
    if (!acc) {
      window.alert("请先搜索并选择人员");
      return;
    }
    const user = state.adminUsers.find((u) => String(u.account || "") === acc);
    const shiftEl = document.querySelector('input[name="duty-modal-shift"]:checked');
    const shift = shiftEl?.value === DUTY_SHIFT_NIGHT ? DUTY_SHIFT_NIGHT : DUTY_SHIFT_FULL;
    if (!state.dutyAssignments[m.kind]) state.dutyAssignments[m.kind] = {};
    if (!state.dutyAssignments[m.kind][m.dateKey]) state.dutyAssignments[m.kind][m.dateKey] = [];
    state.dutyAssignments[m.kind][m.dateKey].push({
      account: acc,
      user_name: String(user?.user_name || ""),
      shift,
    });
    persistDutyAssignmentsLocal();
    const [y, mo] = m.dateKey.split("-").map((x) => parseInt(x, 10));
    await persistDutyCalendarMonthToServer(m.kind, y, mo);
    render();
  });
  document.querySelectorAll(".duty-modal-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const m = state.dutyDayModal;
      if (!m) return;
      const idx = parseInt(btn.getAttribute("data-duty-modal-remove") || "-1", 10);
      const arr = state.dutyAssignments[m.kind]?.[m.dateKey];
      if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
      arr.splice(idx, 1);
      if (arr.length === 0) delete state.dutyAssignments[m.kind][m.dateKey];
      persistDutyAssignmentsLocal();
      const [y, mo] = m.dateKey.split("-").map((x) => parseInt(x, 10));
      await persistDutyCalendarMonthToServer(m.kind, y, mo);
      render();
    });
  });

  document.querySelectorAll("[data-duty-rot-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rk = btn.getAttribute("data-duty-rot-edit");
      if (!rk || !(rk in state.dutyRotationEditMode)) return;
      state.dutyRotationEditMode[rk] = !state.dutyRotationEditMode[rk];
      render();
    });
  });
  document.querySelectorAll("[data-duty-rot-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rk = btn.getAttribute("data-duty-rot-toggle");
      const idx = parseInt(btn.getAttribute("data-duty-rot-idx") || "-1", 10);
      const list = state.dutyRotationLists[rk];
      if (!list || idx < 0 || idx >= list.length) return;
      const row = list[idx];
      row.status =
        row.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_ACTIVE : DUTY_ROTATION_STATUS_INACTIVE;
      persistDutyRotationLocalAndServer();
      render();
    });
  });
  document.querySelectorAll(".duty-rot-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rk = btn.getAttribute("data-duty-rot-remove");
      const idx = parseInt(btn.getAttribute("data-duty-rot-idx") || "-1", 10);
      const list = state.dutyRotationLists[rk];
      if (!list || idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      persistDutyRotationLocalAndServer();
      render();
    });
  });
  document.querySelectorAll(".duty-rot-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rk = btn.getAttribute("data-duty-rot-add");
      if (!rk) return;
      const hidden = document.getElementById(`duty-rot-${rk}-account`);
      const input = document.getElementById(`duty-rot-${rk}-input`);
      let acc = (hidden?.value || "").trim();
      if (!acc && input) {
        const q = (input.value || "").trim();
        const pool = getDutySelectableUsers();
        const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
        if (exact.length === 1) acc = String(exact[0].account || "");
      }
      if (!acc) {
        window.alert("请先搜索并选择要加入轮值的人员");
        return;
      }
      const list = state.dutyRotationLists[rk];
      if (!list) return;
      if (list.some((r) => r.account === acc)) {
        window.alert("该人员已在轮值表中");
        return;
      }
      const user = state.adminUsers.find((u) => String(u.account || "") === acc);
      list.push({
        account: acc,
        user_name: String(user?.user_name || ""),
        status: DUTY_ROTATION_STATUS_ACTIVE,
        last_accept_at: "",
      });
      persistDutyRotationLocalAndServer();
      if (hidden) hidden.value = "";
      if (input) input.value = "";
      render();
    });
  });
  document.querySelectorAll(".duty-rot-last-input").forEach((inp) => {
    if (inp.hasAttribute("data-duty-site-last")) return;
    inp.addEventListener("change", () => {
      const rk = inp.getAttribute("data-duty-rot-last");
      const idx = parseInt(inp.getAttribute("data-duty-rot-idx") || "-1", 10);
      const list = state.dutyRotationLists[rk];
      if (!list || idx < 0 || idx >= list.length) return;
      const v = inp.value.trim();
      list[idx].last_accept_at = v ? v.replace("T", " ") : "";
      persistDutyRotationLocalAndServer();
    });
  });

  document.querySelectorAll("[data-duty-site-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dutySiteOnCallEditMode = !state.dutySiteOnCallEditMode;
      render();
    });
  });
  document.querySelectorAll("[data-duty-site-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-duty-site-idx") || "-1", 10);
      const list = state.dutySiteOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      const row = list[idx];
      row.status =
        row.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_ACTIVE : DUTY_ROTATION_STATUS_INACTIVE;
      persistDutySiteOnCallLocalAndServer();
      render();
    });
  });
  document.querySelectorAll(".duty-site-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-duty-site-idx") || "-1", 10);
      const list = state.dutySiteOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      persistDutySiteOnCallLocalAndServer();
      render();
    });
  });
  document.querySelectorAll(".duty-site-name-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.getAttribute("data-duty-site-name-idx") || "-1", 10);
      const list = state.dutySiteOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      const v = (inp.value || "").trim();
      if (!v) {
        window.alert("局点名称不能为空");
        render();
        return;
      }
      list[idx].site_name = v;
      persistDutySiteOnCallLocalAndServer();
    });
  });
  document.querySelectorAll(".duty-site-last-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.getAttribute("data-duty-site-idx") || "-1", 10);
      const list = state.dutySiteOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      const v = inp.value.trim();
      list[idx].last_accept_at = v ? v.replace("T", " ") : "";
      persistDutySiteOnCallLocalAndServer();
    });
  });
  document.getElementById("duty-site-add-row-btn")?.addEventListener("click", () => {
    const siteEl = document.getElementById("duty-site-new-site");
    const hidden = document.getElementById("duty-site-oncall-account");
    const input = document.getElementById("duty-site-oncall-input");
    const site = (siteEl?.value || "").trim();
    let acc = (hidden?.value || "").trim();
    if (!acc && input) {
      const q = (input.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) acc = String(exact[0].account || "");
    }
    if (!site) {
      window.alert("请填写局点名称");
      return;
    }
    if (!acc) {
      window.alert("请先搜索并选择人员");
      return;
    }
    const user = state.adminUsers.find((u) => String(u.account || "") === acc);
    state.dutySiteOnCallRows.push({
      site_name: site,
      account: acc,
      user_name: String(user?.user_name || ""),
      status: DUTY_ROTATION_STATUS_ACTIVE,
      last_accept_at: "",
    });
    persistDutySiteOnCallLocalAndServer();
    if (siteEl) siteEl.value = "";
    if (hidden) hidden.value = "";
    if (input) input.value = "";
    render();
  });

  document.querySelectorAll("[data-duty-rl-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dutyRlOnCallEditMode = !state.dutyRlOnCallEditMode;
      render();
    });
  });
  document.querySelectorAll(".duty-rl-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-duty-rl-idx") || "-1", 10);
      const list = state.dutyRlOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      persistDutyRlOnCallLocalAndServer();
      render();
    });
  });
  document.querySelectorAll(".duty-rl-phone-edit").forEach((inp) => {
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.getAttribute("data-duty-rl-idx") || "-1", 10);
      const role = inp.getAttribute("data-duty-rl-slot") || "primary";
      const list = state.dutyRlOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      const key = role === "backup" ? "backup" : "primary";
      list[idx][key].phone = (inp.value || "").trim();
      persistDutyRlOnCallLocalAndServer();
    });
  });
  document.getElementById("duty-rl-add-row-btn")?.addEventListener("click", () => {
    const dateEl = document.getElementById("duty-rl-new-date");
    const dateRaw = (dateEl?.value || "").trim().slice(0, 10);
    if (!dateRaw || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      window.alert("请选择有效的值班日期");
      return;
    }
    const pHidden = document.getElementById("duty-rl-primary-account");
    const pInput = document.getElementById("duty-rl-primary-input");
    let pAcc = (pHidden?.value || "").trim();
    if (!pAcc && pInput) {
      const q = (pInput.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) pAcc = String(exact[0].account || "");
    }
    const pPhone = (document.getElementById("duty-rl-primary-phone")?.value || "").trim();
    if (!pAcc) {
      window.alert("请选择主值班人员");
      return;
    }
    if (!pPhone) {
      window.alert("请填写主值班手机号");
      return;
    }
    const bHidden = document.getElementById("duty-rl-backup-account");
    const bInput = document.getElementById("duty-rl-backup-input");
    let bAcc = (bHidden?.value || "").trim();
    if (!bAcc && bInput) {
      const q = (bInput.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) bAcc = String(exact[0].account || "");
    }
    const bPhone = (document.getElementById("duty-rl-backup-phone")?.value || "").trim();
    if (bAcc && !bPhone) {
      window.alert("已选择备值班人员时，请填写备值班手机号");
      return;
    }
    const pUser = state.adminUsers.find((u) => String(u.account || "") === pAcc);
    const bUser = bAcc ? state.adminUsers.find((u) => String(u.account || "") === bAcc) : null;
    const entry = {
      duty_date: dateRaw,
      primary: {
        account: pAcc,
        user_name: String(pUser?.user_name || ""),
        phone: pPhone,
      },
      backup: bAcc
        ? {
            account: bAcc,
            user_name: String(bUser?.user_name || ""),
            phone: bPhone,
          }
        : { account: "", user_name: "", phone: "" },
    };
    const di = state.dutyRlOnCallRows.findIndex((r) => r.duty_date === dateRaw);
    if (di >= 0) state.dutyRlOnCallRows[di] = entry;
    else state.dutyRlOnCallRows.push(entry);
    persistDutyRlOnCallLocalAndServer();
    if (dateEl) dateEl.value = "";
    if (pHidden) pHidden.value = "";
    if (pInput) pInput.value = "";
    if (document.getElementById("duty-rl-primary-phone")) document.getElementById("duty-rl-primary-phone").value = "";
    if (bHidden) bHidden.value = "";
    if (bInput) bInput.value = "";
    if (document.getElementById("duty-rl-backup-phone")) document.getElementById("duty-rl-backup-phone").value = "";
    render();
  });

  bindDutySiteOnCallAddCombo();
  bindDutyRlUserCombo("primary");
  bindDutyRlUserCombo("backup");
  DUTY_ALL_ROTATION_KINDS.forEach((k) => bindDutyRotationUserCombo(k));
}

function ensureLeaveTab() {
  const key = "leave:application";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "请假申请", closable: true });
  }
  return key;
}

function formatLeaveIsoDisplay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function leaveSegmentDurationHours(startVal, endVal) {
  if (!startVal || !endVal) return "—";
  const a = new Date(startVal);
  const b = new Date(endVal);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return "—";
  return ((b - a) / 3600000).toFixed(2);
}

/** 根据当前输入框取值刷新申请弹窗内「申请时长/h」列（避免整页 render 导致事由输入失焦） */
function updateLeaveCreateSegmentDurationCells() {
  document.querySelectorAll("#leave-app-seg-tbody tr").forEach((tr) => {
    const start = tr.querySelector('[data-leave-seg-field="start"]')?.value || "";
    const end = tr.querySelector('[data-leave-seg-field="end"]')?.value || "";
    const durCell = tr.querySelector(".leave-app-dur-cell");
    if (durCell) durCell.textContent = leaveSegmentDurationHours(start, end);
  });
}

function leaveApplicantDefaultDisplay() {
  const op = getCurrentOperator();
  const name = String(op.userName || "").trim();
  const acc = String(op.account || "").trim();
  return name ? `${name} ${acc}` : acc;
}

function resetLeaveCreateForm() {
  state.leaveDraftSegKey = 1;
  state.leaveCreateSegments = [{ key: state.leaveDraftSegKey++, start: "", end: "", reason: "" }];
  state.leaveCreateType = "";
  state.leaveCreateApprover = "";
  state.leaveCreateCc = "";
}

async function fetchLeaveApproverWhitelist() {
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/leave/approver-whitelist?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) return;
    const j = await r.json();
    state.leaveApproverWhitelist = Array.isArray(j.items) ? j.items : [];
  } catch (_) {}
}

async function fetchLeaveList() {
  const op = getCurrentOperator();
  state.leaveListLoading = true;
  render();
  try {
    const scope = state.leaveTab === "todo" ? "todo" : "all";
    const q = state.leaveSearch.trim();
    const r = await fetch(
      `${API_BASE_URL}/api/leave/applications?operator_id=${encodeURIComponent(op.account)}&scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}`
    );
    if (!r.ok) {
      state.leaveList = [];
      return;
    }
    const j = await r.json();
    state.leaveList = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.leaveList = [];
  } finally {
    const keep = new Set((state.leaveList || []).map((x) => x.id));
    state.leaveBatchSelectedIds = (state.leaveBatchSelectedIds || []).filter((id) => keep.has(id));
    state.leaveListLoading = false;
    render();
  }
}

async function runLeaveBatchActions(ids, action, comment) {
  const op = getCurrentOperator();
  const errors = [];
  for (const id of ids) {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/leave/applications/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account, action, comment: comment || "" }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        errors.push(`#${id}: ${resp.status} ${tx.slice(0, 120)}`);
      }
    } catch (e) {
      errors.push(`#${id}: ${String(e.message || e)}`);
    }
  }
  if (errors.length) {
    window.alert(`部分失败（${errors.length}/${ids.length}）：\n${errors.slice(0, 8).join("\n")}${errors.length > 8 ? "\n…" : ""}`);
  }
  state.leaveBatchSelectedIds = [];
  await fetchLeaveList();
}

async function fetchLeaveDetail(id) {
  const op = getCurrentOperator();
  state.leaveDetailLoading = true;
  state.leaveDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/leave/applications/${id}?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.leaveDetailBundle = null;
      return;
    }
    state.leaveDetailBundle = await r.json();
  } catch (_) {
    state.leaveDetailBundle = null;
  } finally {
    state.leaveDetailLoading = false;
    render();
  }
}

function renderLeaveApplicationPage() {
  const admin = isDutyCalendarAdmin();
  const batchTodo = state.leaveTab === "todo";
  const listIds = (state.leaveList || []).map((x) => x.id);
  const sel = state.leaveBatchSelectedIds || [];
  const allSelected = batchTodo && listIds.length > 0 && listIds.every((id) => sel.includes(id));
  const checkTh = batchTodo
    ? `<th class="leave-app-col-check"><input type="checkbox" id="leave-batch-select-all" title="全选" ${allSelected ? "checked" : ""} /></th>`
    : "";
  const rows = (state.leaveList || [])
    .map((it, idx) => {
      const spanStart = formatLeaveIsoDisplay(it.span_start);
      const spanEnd = formatLeaveIsoDisplay(it.span_end);
      const hours = it.total_hours != null ? Number(it.total_hours).toFixed(2) : "—";
      const reason = String(it.reasons_concat || "").trim() || "—";
      const checkTd = batchTodo
        ? `<td class="leave-app-col-check"><input type="checkbox" class="leave-app-row-check" data-leave-app-select="${it.id}" ${sel.includes(it.id) ? "checked" : ""} /></td>`
        : "";
      return `<tr class="leave-app-row" data-leave-app-id="${it.id}">
        ${checkTd}
        <td>${idx + 1}</td>
        <td>${escapeHtml(String(it.application_no || ""))}</td>
        <td>${escapeHtml(String(it.status || ""))}</td>
        <td>${escapeHtml(String(it.application_type || ""))}</td>
        <td>${escapeHtml(String(it.applicant_display || ""))}</td>
        <td class="leave-app-nowrap">${escapeHtml(spanStart)}</td>
        <td class="leave-app-nowrap">${escapeHtml(spanEnd)}</td>
        <td>${escapeHtml(hours)}</td>
        <td class="leave-app-reason">${escapeHtml(reason)}</td>
        <td>${escapeHtml(String(it.current_handler_display || "—"))}</td>
      </tr>`;
    })
    .join("");
  const colCount = batchTodo ? 11 : 10;
  const empty = `<tr><td colspan="${colCount}" class="leave-app-empty">${state.leaveListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  return `
    <section class="leave-app-wrap" id="leave-application-panel">
      <div class="leave-app-toolbar">
        <div class="leave-app-tabs">
          <button type="button" class="leave-app-tab ${state.leaveTab === "all" ? "active" : ""}" data-leave-tab="all">所有申请</button>
          <button type="button" class="leave-app-tab ${state.leaveTab === "todo" ? "active" : ""}" data-leave-tab="todo">我的待办</button>
        </div>
        <div class="leave-app-search">
          <input type="search" id="leave-app-search-input" class="leave-app-search-input" placeholder="搜索编号、状态、类型、发起人、时间、时长、理由、处理人等" value="${escapeAttr(state.leaveSearch)}" />
        </div>
        <div class="leave-app-toolbar-right">
          ${batchTodo ? `<button type="button" class="action primary" id="leave-batch-approval-btn">批量审批</button>` : ""}
          ${admin ? `<button type="button" class="action" id="leave-app-whitelist-btn">审批白名单</button>` : ""}
          <button type="button" class="action primary" id="leave-app-apply-btn">申请</button>
        </div>
      </div>
      <div class="leave-app-table-card">
        <table class="leave-app-table">
          <thead>
            <tr>
              ${checkTh}
              <th>序号</th><th>申请编号</th><th>申请状态</th><th>申请类型</th><th>发起人</th>
              <th>开始时间</th><th>结束时间</th><th>请假时长/h</th><th>申请理由</th><th>当前处理人</th>
            </tr>
          </thead>
          <tbody>${state.leaveList.length ? rows : empty}</tbody>
        </table>
      </div>
    </section>`;
}

function renderLeaveModalsHtml() {
  const createSegRows = state.leaveCreateSegments
    .map((seg, i) => {
      const dur = leaveSegmentDurationHours(seg.start, seg.end);
      return `<tr data-leave-seg-key="${seg.key}">
        <td>${i + 1}</td>
        <td><input type="datetime-local" class="leave-app-dt" step="1" data-leave-seg-field="start" value="${escapeAttr(seg.start)}" /></td>
        <td><input type="datetime-local" class="leave-app-dt" step="1" data-leave-seg-field="end" value="${escapeAttr(seg.end)}" /></td>
        <td class="leave-app-dur-cell">${escapeHtml(dur)}</td>
        <td><input type="text" class="leave-app-reason-input" data-leave-seg-field="reason" value="${escapeAttr(seg.reason)}" placeholder="事由" /></td>
        <td><button type="button" class="action danger leave-app-seg-del" data-leave-seg-key="${seg.key}" ${state.leaveCreateSegments.length <= 1 ? "disabled" : ""}>删除</button></td>
      </tr>`;
    })
    .join("");
  const typeOpts = LEAVE_APPLICATION_TYPES.map(
    (t) => `<option value="${escapeAttr(t)}" ${state.leaveCreateType === t ? "selected" : ""}>${escapeHtml(t)}</option>`
  ).join("");
  const apprOpts = (state.leaveApproverWhitelist || [])
    .map((w) => {
      const lab = `${String(w.user_name || "").trim()} ${w.account}`.trim();
      return `<option value="${escapeAttr(w.account)}" ${state.leaveCreateApprover === w.account ? "selected" : ""}>${escapeHtml(lab)}</option>`;
    })
    .join("");
  const createOpen = state.leaveCreateOpen
    ? `<div class="perm-modal-mask leave-app-modal-mask" id="leave-app-create-mask">
      <div class="perm-modal leave-app-modal" role="dialog">
        <div class="perm-modal-head"><h3>请假申请</h3></div>
        <div class="perm-modal-body leave-app-create-body">
          <label class="leave-app-field">申请类型（必填）
            <select id="leave-create-type" class="leave-app-select"><option value="">请选择</option>${typeOpts}</select>
          </label>
          <div class="leave-app-seg-toolbar">
            <span class="leave-app-seg-title">时间段（可多条）</span>
            <button type="button" class="action" id="leave-app-add-seg-btn">新增行</button>
          </div>
          <table class="leave-app-seg-table">
            <thead><tr><th>序号</th><th>开始时间</th><th>结束时间</th><th>申请时长/h</th><th>申请事由</th><th>操作</th></tr></thead>
            <tbody id="leave-app-seg-tbody">${createSegRows}</tbody>
          </table>
          <label class="leave-app-field">申请人（必填）
            <input type="text" id="leave-create-applicant" readonly class="leave-app-input" value="${escapeAttr(leaveApplicantDefaultDisplay())}" />
          </label>
          <label class="leave-app-field">审批人（必填，白名单）
            <select id="leave-create-approver" class="leave-app-select"><option value="">请选择</option>${apprOpts}</select>
          </label>
          <label class="leave-app-field">抄送人（选填，多个账号逗号分隔）
            <input type="text" id="leave-create-cc" class="leave-app-input" placeholder="例如：user1,user2" value="${escapeAttr(state.leaveCreateCc)}" />
          </label>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="leave-create-cancel-btn">取消</button>
          <button type="button" class="action primary" id="leave-create-submit-btn">提交</button>
        </div>
      </div></div>`
    : "";
  const wlChecked = new Set((state.leaveApproverWhitelist || []).map((x) => String(x.account || "")));
  const wlRows = (state.adminUsers || [])
    .filter((u) => {
      const a = u.is_active;
      if (a === false) return false;
      if (a != null && String(a).toLowerCase() === "false") return false;
      if (String(a) === "0") return false;
      return true;
    })
    .map((u) => {
      const acc = String(u.account || "");
      const checked = wlChecked.has(acc) ? "checked" : "";
      const lab = `${String(u.user_name || "").trim()} ${acc}`.trim();
      return `<label class="leave-app-wl-item"><input type="checkbox" data-leave-wl-acc="${escapeAttr(acc)}" ${checked} /> ${escapeHtml(lab)}</label>`;
    })
    .join("");
  const wl = state.leaveWhitelistModalOpen
    ? `<div class="perm-modal-mask leave-app-modal-mask" id="leave-app-wl-mask">
    <div class="perm-modal leave-app-modal" role="dialog">
      <div class="perm-modal-head"><h3>审批人白名单</h3></div>
      <div class="perm-modal-body">
        <p class="leave-app-hint">勾选可审批请假申请的用户（须已在用户管理中）。</p>
        <div class="leave-app-wl-grid">${wlRows || "<p class='leave-app-empty'>暂无用户数据，请先刷新列表。</p>"}</div>
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="leave-wl-cancel-btn">取消</button>
        <button type="button" class="action primary" id="leave-wl-save-btn">保存</button>
      </div>
    </div></div>`
    : "";
  const detail = state.leaveDetailId
    ? (() => {
        const b = state.leaveDetailBundle;
        const loading = state.leaveDetailLoading;
        const app = b?.application;
        const op = getCurrentOperator();
        const canAct =
          app &&
          app.status === "审批中" &&
          String(app.current_handler_account || "").trim() === String(op.account || "").trim();
        const logRows = (b?.logs || [])
          .map(
            (lg) =>
              `<tr>
            <td>${escapeHtml(String(lg.step_label || ""))}</td>
            <td>${escapeHtml(String(lg.operator_display || ""))}</td>
            <td class="leave-app-nowrap">${escapeHtml(formatLeaveIsoDisplay(lg.created_at))}</td>
            <td>${escapeHtml(String(lg.action || ""))}</td>
            <td class="leave-app-log-comment">${escapeHtml(String(lg.comment || ""))}</td>
          </tr>`
          )
          .join("");
        const segRows = (b?.segments || [])
          .map((s) => {
            const sn = s.seq != null ? Number(s.seq) + 1 : "";
            return `<tr><td>${sn}</td><td>${escapeHtml(formatLeaveIsoDisplay(s.start_at))}</td><td>${escapeHtml(formatLeaveIsoDisplay(s.end_at))}</td><td>${Number(s.duration_hours || 0).toFixed(2)}</td><td>${escapeHtml(String(s.reason || ""))}</td></tr>`;
          })
          .join("");
        const ccLine = (b?.cc_displays || []).map((c) => escapeHtml(c.display)).join("；") || "—";
        const appNo = app ? escapeHtml(String(app.application_no || "")) : "";
        return `<div class="perm-modal-mask leave-app-modal-mask" id="leave-app-detail-mask">
        <div class="perm-modal leave-app-modal leave-app-detail-modal" role="dialog">
          <div class="perm-modal-head"><h3>申请详情 ${appNo}</h3></div>
          <div class="perm-modal-body">
            ${loading ? "<p>加载中…</p>" : ""}
            ${
              app
                ? `<div class="leave-app-detail-meta">
              <p><strong>状态</strong> ${escapeHtml(String(app.status))} · <strong>类型</strong> ${escapeHtml(String(app.application_type))}</p>
              <p><strong>发起人</strong> ${escapeHtml(String(app.applicant_display))} · <strong>审批人</strong> ${escapeHtml(String(app.approver_display))}</p>
              <p><strong>抄送</strong> ${ccLine}</p>
            </div>
            <h4 class="leave-app-subhd">时间段</h4>
            <table class="leave-app-mini-table"><thead><tr><th>序号</th><th>开始</th><th>结束</th><th>时长/h</th><th>事由</th></tr></thead><tbody>${segRows}</tbody></table>`
                : "<p>无法加载</p>"
            }
            ${
              canAct
                ? `<div class="leave-app-actions-block">
              <label class="leave-app-field">审批意见
                <textarea id="leave-detail-comment" class="leave-app-textarea" rows="2" placeholder="拒绝时必填"></textarea>
              </label>
              <div class="leave-app-action-btns">
                <button type="button" class="action danger" data-leave-action="cancel">取消</button>
                <button type="button" class="action danger" data-leave-action="reject">拒绝</button>
                <button type="button" class="action primary" data-leave-action="agree">同意</button>
              </div>
            </div>`
                : ""
            }
            <h4 class="leave-app-subhd">审批日志</h4>
            <table class="leave-app-mini-table leave-app-log-table">
              <thead><tr><th>环节</th><th>操作人</th><th>操作时间</th><th>操作</th><th>评审意见</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="5" class="leave-app-empty">暂无</td></tr>`}</tbody>
            </table>
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="leave-detail-close-btn">关闭</button>
          </div>
        </div></div>`;
      })()
    : "";
  const batchN = (state.leaveBatchSelectedIds || []).length;
  const batchApprovalModal = state.leaveBatchApprovalModalOpen
    ? `<div class="perm-modal-mask leave-app-modal-mask" id="leave-batch-approval-mask">
      <div class="perm-modal leave-app-modal" role="dialog">
        <div class="perm-modal-head"><h3>批量审批</h3></div>
        <div class="perm-modal-body leave-app-create-body">
          <p class="leave-app-hint">已选 <strong>${batchN}</strong> 条待办，请选择操作并确认。</p>
          <div class="leave-app-batch-act-row" role="radiogroup" aria-label="审批操作">
            <label class="leave-app-batch-act-opt"><input type="radio" name="leave-batch-act" value="agree" checked /> 同意</label>
            <label class="leave-app-batch-act-opt"><input type="radio" name="leave-batch-act" value="reject" /> 拒绝</label>
            <label class="leave-app-batch-act-opt"><input type="radio" name="leave-batch-act" value="cancel" /> 取消</label>
          </div>
          <label class="leave-app-field">审批意见
            <textarea id="leave-batch-approval-comment" class="leave-app-textarea" rows="3" placeholder="拒绝时必填；同意、取消可选填"></textarea>
          </label>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="leave-batch-approval-cancel-btn">关闭</button>
          <button type="button" class="action primary" id="leave-batch-approval-submit-btn">确定</button>
        </div>
      </div></div>`
    : "";
  return `${createOpen}${detail}${wl}${batchApprovalModal}`;
}

let _leaveSearchDebounceTimer = null;
/** 请假列表搜索防抖（ms） */
const LEAVE_SEARCH_DEBOUNCE_MS = 1000;

function bindLeaveApplicationPage() {
  void fetchLeaveApproverWhitelist();
  if (state.leaveNeedsRefresh) {
    state.leaveNeedsRefresh = false;
    void fetchLeaveList();
  }
  document.querySelectorAll("[data-leave-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-leave-tab");
      if (t !== "all" && t !== "todo") return;
      state.leaveTab = t;
      state.leaveBatchSelectedIds = [];
      state.leaveBatchApprovalModalOpen = false;
      render();
      void fetchLeaveList();
    });
  });
  document.getElementById("leave-batch-select-all")?.addEventListener("change", (ev) => {
    const on = ev.target.checked;
    const ids = (state.leaveList || []).map((x) => x.id);
    state.leaveBatchSelectedIds = on ? [...ids] : [];
    render();
  });
  document.getElementById("leave-batch-approval-btn")?.addEventListener("click", () => {
    const ids = state.leaveBatchSelectedIds || [];
    if (!ids.length) {
      window.alert("请先勾选待办申请");
      return;
    }
    state.leaveBatchApprovalModalOpen = true;
    render();
  });
  document.getElementById("leave-batch-approval-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-batch-approval-mask")) {
      state.leaveBatchApprovalModalOpen = false;
      render();
    }
  });
  document.getElementById("leave-batch-approval-cancel-btn")?.addEventListener("click", () => {
    state.leaveBatchApprovalModalOpen = false;
    render();
  });
  document.getElementById("leave-batch-approval-submit-btn")?.addEventListener("click", async () => {
    const ids = [...(state.leaveBatchSelectedIds || [])];
    if (!ids.length) {
      window.alert("没有可审批的申请，请重新勾选");
      state.leaveBatchApprovalModalOpen = false;
      render();
      return;
    }
    const act = document.querySelector('input[name="leave-batch-act"]:checked')?.value;
    const comment = (document.getElementById("leave-batch-approval-comment")?.value || "").trim();
    if (act !== "agree" && act !== "reject" && act !== "cancel") return;
    if (act === "reject" && !comment) {
      window.alert("批量拒绝须填写审批意见");
      return;
    }
    const verb = { agree: "同意", reject: "拒绝", cancel: "取消" }[act];
    if (!window.confirm(`确定对选中的 ${ids.length} 条申请执行「${verb}」？`)) return;
    state.leaveBatchApprovalModalOpen = false;
    render();
    await runLeaveBatchActions(ids, act, comment);
  });
  document.querySelector("#leave-application-panel .leave-app-table tbody")?.addEventListener("change", (ev) => {
    const cb = ev.target;
    if (!cb.matches?.("input.leave-app-row-check")) return;
    const id = parseInt(cb.getAttribute("data-leave-app-select") || "-1", 10);
    if (!Number.isFinite(id) || id < 0) return;
    let next = [...(state.leaveBatchSelectedIds || [])];
    if (cb.checked) {
      if (!next.includes(id)) next.push(id);
    } else {
      next = next.filter((x) => x !== id);
    }
    state.leaveBatchSelectedIds = next;
    render();
  });
  const leaveSearchInp = document.getElementById("leave-app-search-input");
  const scheduleLeaveListSearch = () => {
    if (_leaveSearchDebounceTimer) clearTimeout(_leaveSearchDebounceTimer);
    _leaveSearchDebounceTimer = setTimeout(() => {
      _leaveSearchDebounceTimer = null;
      void fetchLeaveList();
    }, LEAVE_SEARCH_DEBOUNCE_MS);
  };
  leaveSearchInp?.addEventListener("input", (ev) => {
    state.leaveSearch = leaveSearchInp.value || "";
    if (ev.isComposing) return;
    scheduleLeaveListSearch();
  });
  leaveSearchInp?.addEventListener("compositionend", () => {
    state.leaveSearch = leaveSearchInp.value || "";
    scheduleLeaveListSearch();
  });
  leaveSearchInp?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    if (_leaveSearchDebounceTimer) {
      clearTimeout(_leaveSearchDebounceTimer);
      _leaveSearchDebounceTimer = null;
    }
    state.leaveSearch = leaveSearchInp.value || "";
    void fetchLeaveList();
  });
  document.getElementById("leave-app-apply-btn")?.addEventListener("click", async () => {
    await fetchLeaveApproverWhitelist();
    resetLeaveCreateForm();
    state.leaveCreateOpen = true;
    render();
  });
  document.getElementById("leave-app-whitelist-btn")?.addEventListener("click", () => {
    if (!isDutyCalendarAdmin()) return;
    state.leaveWhitelistModalOpen = true;
    render();
  });
  document.querySelectorAll(".leave-app-row").forEach((tr) => {
    tr.addEventListener("click", (ev) => {
      if (ev.target.closest?.(".leave-app-col-check")) return;
      const id = parseInt(tr.getAttribute("data-leave-app-id") || "-1", 10);
      if (id < 0) return;
      state.leaveDetailId = id;
      state.leaveDetailBundle = null;
      state.leaveDetailLoading = true;
      render();
      void fetchLeaveDetail(id);
    });
  });
  document.getElementById("leave-app-create-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-app-create-mask")) {
      state.leaveCreateOpen = false;
      render();
    }
  });
  document.getElementById("leave-create-cancel-btn")?.addEventListener("click", () => {
    state.leaveCreateOpen = false;
    render();
  });
  document.getElementById("leave-app-add-seg-btn")?.addEventListener("click", () => {
    state.leaveCreateSegments.push({ key: state.leaveDraftSegKey++, start: "", end: "", reason: "" });
    render();
  });
  const leaveSegTbody = document.getElementById("leave-app-seg-tbody");
  const onLeaveSegDatetimeInput = (ev) => {
    const t = ev.target;
    if (!t.matches?.('[data-leave-seg-field="start"]') && !t.matches?.('[data-leave-seg-field="end"]')) return;
    updateLeaveCreateSegmentDurationCells();
  };
  leaveSegTbody?.addEventListener("input", onLeaveSegDatetimeInput);
  leaveSegTbody?.addEventListener("change", onLeaveSegDatetimeInput);
  if (state.leaveCreateOpen) updateLeaveCreateSegmentDurationCells();
  document.querySelectorAll(".leave-app-seg-del").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const k = btn.getAttribute("data-leave-seg-key");
      if (!k || state.leaveCreateSegments.length <= 1) return;
      state.leaveCreateSegments = state.leaveCreateSegments.filter((s) => String(s.key) !== k);
      render();
    });
  });
  document.getElementById("leave-create-type")?.addEventListener("change", () => {
    const el = document.getElementById("leave-create-type");
    state.leaveCreateType = (el?.value || "").trim();
  });
  document.getElementById("leave-create-approver")?.addEventListener("change", () => {
    const el = document.getElementById("leave-create-approver");
    state.leaveCreateApprover = (el?.value || "").trim();
  });
  document.getElementById("leave-create-cc")?.addEventListener("change", () => {
    const el = document.getElementById("leave-create-cc");
    state.leaveCreateCc = (el?.value || "").trim();
  });
  document.getElementById("leave-create-submit-btn")?.addEventListener("click", async () => {
    const typeEl = document.getElementById("leave-create-type");
    const apprEl = document.getElementById("leave-create-approver");
    const ccEl = document.getElementById("leave-create-cc");
    const application_type = (typeEl?.value || "").trim();
    const approver_account = (apprEl?.value || "").trim();
    const ccRaw = (ccEl?.value || "").trim();
    const cc_accounts = ccRaw
      ? ccRaw
          .split(/[,，\s]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
    if (!application_type) {
      window.alert("请选择申请类型");
      return;
    }
    if (!approver_account) {
      window.alert("请选择审批人");
      return;
    }
    const tbody = document.getElementById("leave-app-seg-tbody");
    const trs = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
    const segments = [];
    for (const tr of trs) {
      const start = tr.querySelector('[data-leave-seg-field="start"]')?.value || "";
      const end = tr.querySelector('[data-leave-seg-field="end"]')?.value || "";
      const reason = tr.querySelector('[data-leave-seg-field="reason"]')?.value || "";
      if (!start || !end) {
        window.alert("请填写每条时间段的开始与结束时间");
        return;
      }
      const s = new Date(start);
      const e = new Date(end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        window.alert("结束时间须晚于开始时间");
        return;
      }
      segments.push({ start_at: s.toISOString(), end_at: e.toISOString(), reason: reason.trim() });
    }
    if (!segments.length) {
      window.alert("至少保留一条时间段");
      return;
    }
    const op = getCurrentOperator();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/leave/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          application_type,
          segments,
          approver_account,
          cc_accounts,
        }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        window.alert(`提交失败：${resp.status} ${tx.slice(0, 240)}`);
        return;
      }
      state.leaveCreateOpen = false;
      await fetchLeaveList();
    } catch (e) {
      window.alert(`提交失败：${String(e.message || e)}`);
    }
  });
  document.getElementById("leave-app-detail-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-app-detail-mask")) {
      state.leaveDetailId = null;
      state.leaveDetailBundle = null;
      render();
    }
  });
  document.getElementById("leave-detail-close-btn")?.addEventListener("click", () => {
    state.leaveDetailId = null;
    state.leaveDetailBundle = null;
    render();
  });
  document.querySelectorAll("[data-leave-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-leave-action");
      const id = state.leaveDetailId;
      if (!id || !act) return;
      const ta = document.getElementById("leave-detail-comment");
      const comment = (ta?.value || "").trim();
      if (act === "reject" && !comment) {
        window.alert("拒绝时请填写审批意见");
        return;
      }
      const op = getCurrentOperator();
      try {
        const resp = await fetch(`${API_BASE_URL}/api/leave/applications/${id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: op.account,
            action: act,
            comment,
          }),
        });
        if (!resp.ok) {
          const tx = await resp.text();
          window.alert(`操作失败：${resp.status} ${tx.slice(0, 240)}`);
          return;
        }
        await fetchLeaveDetail(id);
        await fetchLeaveList();
      } catch (e) {
        window.alert(`操作失败：${String(e.message || e)}`);
      }
    });
  });
  document.getElementById("leave-app-wl-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-app-wl-mask")) {
      state.leaveWhitelistModalOpen = false;
      render();
    }
  });
  document.getElementById("leave-wl-cancel-btn")?.addEventListener("click", () => {
    state.leaveWhitelistModalOpen = false;
    render();
  });
  document.getElementById("leave-wl-save-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator();
    const boxes = document.querySelectorAll("#leave-app-wl-mask input[data-leave-wl-acc]");
    const accounts = Array.from(boxes)
      .filter((x) => x instanceof HTMLInputElement && x.checked)
      .map((x) => x.getAttribute("data-leave-wl-acc") || "")
      .filter(Boolean);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/leave/approver-whitelist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account, accounts }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        window.alert(`保存失败：${resp.status} ${tx.slice(0, 240)}`);
        return;
      }
      state.leaveWhitelistModalOpen = false;
      await fetchLeaveApproverWhitelist();
      render();
    } catch (e) {
      window.alert(`保存失败：${String(e.message || e)}`);
    }
  });
}

function getCurrentOperator() {
  const savedAccount = (window.localStorage.getItem("demo_operator_account") || "").trim();
  const savedName = (window.localStorage.getItem("demo_operator_name") || "").trim();
  const account = savedAccount || DEFAULT_OPERATOR_ACCOUNT;
  const row = state.adminUsers.find((u) => String(u.account || "") === account);
  const userName = String(row?.user_name || savedName || DEFAULT_OPERATOR_NAME);
  return { account, userName };
}

/** 列表过滤：当前处理人等字段（「姓名 账号」「账号 姓名」或纯姓名/账号）是否与当前登录人一致 */
function operatorMatchesPersonField(fieldValue, operator) {
  const raw = String(fieldValue || "").trim();
  if (!raw) return false;
  const acc = String(operator.account || "").trim();
  const name = String(operator.userName || "").trim();
  if (acc && (raw === acc || raw.includes(acc))) return true;
  if (name && (raw === name || raw.includes(name))) return true;
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (acc && tokens.includes(acc)) return true;
  if (name && tokens.includes(name)) return true;
  return false;
}

function ticketCreatorMatchesOperator(ticket, operator) {
  const cid = String(ticket.creatorId || "").trim();
  const acc = String(operator.account || "").trim();
  if (cid && acc && cid === acc) return true;
  return operatorMatchesPersonField(String(ticket.creatorName || ""), operator);
}

function getCurrentRoleCode() {
  const operator = getCurrentOperator();
  const row = state.adminUsers.find((u) => String(u.account || "") === operator.account);
  return String(row?.role_code || "");
}

function getCurrentWhitelistSettings() {
  const operator = getCurrentOperator();
  const user = state.adminUsers.find((u) => String(u.account || "") === operator.account);
  const roleCode = String(user?.role_code || "");
  if (!roleCode) return {};
  const rows = state.adminPermissions.filter(
    (x) => String(x.role_code || "") === roleCode && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY
  );
  const out = {};
  rows.forEach((r) => {
    out[String(r.field_key || "")] = String(r.permission_level || "hidden");
  });
  return out;
}

function syncActiveKeyFromPath(pathname) {
  if (pathname === "/admin/permissions") {
    state.activeKey = ensureAdminTab("permissions");
    return;
  }
  if (pathname === "/admin/users") {
    state.activeKey = ensureAdminTab("users");
    return;
  }
  if (pathname === "/duty-roster" || pathname === "/duty-roster/") {
    state.activeKey = ensureDutyTab();
    return;
  }
  if (pathname === "/leave-application" || pathname === "/leave-application/") {
    state.activeKey = ensureLeaveTab();
    state.leaveNeedsRefresh = true;
    return;
  }
  if (pathname === "/params/duty-field" || pathname === "/params/duty-field/") {
    state.activeKey = ensureParamsTab("duty-field");
    state.dutyFieldNeedsRefresh = true;
    state.dutyFieldEditMode = false;
    return;
  }
  if (pathname === "/params/version" || pathname === "/params/version/") {
    state.activeKey = ensureParamsTab("version");
    const h = String(window.location.hash || "").replace(/^#/, "");
    if (h === "hotfix" || h === "baseline") state.versionSubTab = h;
    state.versionNeedsRefresh = true;
    return;
  }
  if (pathname === "/params/group-template" || pathname === "/params/group-template/") {
    state.activeKey = ensureParamsTab("group-template");
    state.groupTemplateNeedsRefresh = true;
    state.groupTemplateEditMode = false;
    state.groupTemplateDraft = null;
    return;
  }
  const match = pathname.match(/^\/tickets\/([^/]+)$/);
  if (!match) {
    state.activeKey = "list";
    return;
  }
  const orderId = decodeURIComponent(match[1]);
  const key = ensureTicketTab(orderId);
  state.activeKey = key;
}

function normalizeNodeKey(rawNode) {
  const raw = String(rawNode || "").trim();
  if (!raw) return "";
  if (NODE_KEY_BY_STEP[raw]) return NODE_KEY_BY_STEP[raw];
  const lowered = raw.toLowerCase();
  if (STEP_BY_NODE_KEY[lowered]) return lowered;
  return "";
}

function render() {
  debugLog("render.start", { activeKey: state.activeKey, listTab: state.listTab });
  const suppressDutyMainScrollRestore = state.dutySuppressMainScrollRestore;
  state.dutySuppressMainScrollRestore = false;
  const prevMain = document.querySelector(".layout > .center");
  let savedDutyMainScroll = null;
  if (prevMain && prevMain.querySelector("#duty-roster-panel, .duty-roster-page")) {
    savedDutyMainScroll = { top: prevMain.scrollTop, left: prevMain.scrollLeft };
  }
  const activeTicket = getActiveTicket();
  const isList = state.activeKey === "list";
  const isDuty = state.activeKey === "duty:roster";
  const isLeave = state.activeKey === "leave:application";
  const isParams = state.activeKey.startsWith("params:");
  const isAdmin = state.activeKey.startsWith("admin:");
  const currentOperator = getCurrentOperator();
  const currentRoleCode = getCurrentRoleCode();
  const operatorOptions = Array.from(new Set(state.adminUsers.map((x) => String(x.account || "")).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  if (currentOperator.account && !operatorOptions.includes(currentOperator.account)) {
    operatorOptions.unshift(currentOperator.account);
  }
  const createModalHtml = state.createModalOpen && state.createTicketId
    ? `<div class="perm-modal-mask">
        <div class="perm-modal create-ticket-modal">
          <div class="perm-modal-head">
            <h3>创建工单</h3>
          </div>
          <div class="perm-modal-body">
            ${renderNodeForm(state.createTicketId, "ops_analysis", { editable: true })}
          </div>
          <div class="perm-modal-actions">
            <button class="action" type="button" id="cancel-create-ticket-btn">取消</button>
          </div>
        </div>
      </div>`
    : "";
  document.title = isList
    ? "运维工单平台 Demo"
    : isDuty
      ? "值班表"
      : isLeave
        ? "请假申请"
        : isParams
          ? `${getParamsPageHeadline(state.activeKey)} · 参数配置`
          : isAdmin
            ? "权限管理"
            : state.activeKey.replace("ticket:", "");

  root.innerHTML = `
  <div class="layout">
    <aside class="left">
      <div class="left-top">
        <div class="hamburger">☰</div>
        <button id="collapse-btn" class="collapse" title="收起/展开侧边栏">«</button>
      </div>
      <nav class="menu">
        <button class="menu-item ${isList ? "active" : ""}" data-nav-key="list">My Tasks</button>
        <div class="menu-item-wrap menu-item-wrap--duty">
          <button type="button" class="menu-item ${isDuty ? "active" : ""}" data-nav-key="duty:roster">值班表</button>
          <div class="menu-submenu" role="menu" aria-label="值班表子项">
            ${renderDutySubmenuHtml()}
          </div>
        </div>
        <button class="menu-item ${isLeave ? "active" : ""}" data-nav-key="leave:application">请假申请</button>
        <button class="menu-item">补丁管理</button>
        <button class="menu-item ${state.activeKey === "admin:permissions" ? "active" : ""}" data-nav-key="admin:permissions">权限策略</button>
        <button class="menu-item ${state.activeKey === "admin:users" ? "active" : ""}" data-nav-key="admin:users">用户管理</button>
        <div class="menu-item-wrap menu-item-wrap--params">
          <button type="button" class="menu-item ${isParams ? "active" : ""}" data-nav-key="params:duty-field">参数配置</button>
          <div class="menu-submenu" role="menu" aria-label="参数配置子项">
            <button type="button" class="menu-submenu-item" data-nav-key="params:duty-field">责任田模块</button>
            <button type="button" class="menu-submenu-item" data-nav-key="params:version">版本模块</button>
            <button type="button" class="menu-submenu-item" data-nav-key="params:group-template">拉群模版</button>
          </div>
        </div>
        <button class="menu-item">变更日历</button>
        <button class="menu-item">重大问题</button>
      </nav>
      <div class="menu-bottom">
        <button class="menu-item">设置</button>
      </div>
    </aside>

    <main class="center center-enter">
      <div class="head">
        <h1 class="${isList || isDuty || isLeave || isParams ? "" : "hidden"}">${isList ? "Work Order" : isDuty ? "值班表" : isLeave ? "请假申请" : isParams ? getParamsPageHeadline(state.activeKey) : ""}</h1>
        <div class="actions ${isList ? "" : "hidden"}">
          <button type="button" class="action" id="group-pull-open-btn">拉群</button>
          <button class="action primary" id="create-ticket-btn">创建</button>
          <button class="action">导出</button>
          <button class="action danger" id="delete-ticket-btn">删除</button>
        </div>
      </div>

      <div class="workspace-tabs" id="workspace-tabs">
        ${state.openTabs
          .map(
            (tab) => `
            <button type="button" class="workspace-tab ${tab.key === state.activeKey ? "active" : ""}" data-workspace-tab="${tab.key}">
              <span>${tab.label}</span>
              ${
                tab.closable
                  ? `<span class="workspace-tab-close" data-close-tab="${tab.key}" aria-label="关闭">×</span>`
                  : ""
              }
            </button>`
          )
          .join("")}
      </div>

      ${
        isList
          ? `
      <div class="toolbar">
        <div class="filters">
          <input class="search" placeholder="Search" />
          <div class="date-range">
            <button class="date-trigger" id="start-trigger" type="button">starttime</button>
            <input class="date-hidden" id="start-date" type="date" aria-label="starttime" />
            <span class="date-sep">--</span>
            <button class="date-trigger" id="end-trigger" type="button">endtime</button>
            <input class="date-hidden" id="end-date" type="date" aria-label="endtime" />
          </div>
          <div class="tabs-with-refresh">
            <div class="tabs" role="tablist">
              <span class="tab-indicator" aria-hidden="true"></span>
              <button type="button" class="tab ${state.listTab === "pending" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "pending"}" data-tab="pending">待处理</button>
              <button type="button" class="tab ${state.listTab === "all" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "all"}" data-tab="all">全局</button>
              <button type="button" class="tab ${state.listTab === "created" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "created"}" data-tab="created">我创建</button>
            </div>
            <button type="button" class="action list-refresh-btn" id="list-refresh-btn" aria-label="刷新列表数据" ${state.listRefreshing ? "disabled" : ""}>${state.listRefreshing ? "刷新中…" : "刷新"}</button>
          </div>
        </div>
      </div>

      <section class="table-wrap" id="list-panel" aria-live="polite">
        <div class="section-title">Work order list</div>
        <table>
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="select-all-tickets" aria-label="全选工单" /></th><th>流程ID</th><th>当前阶段</th><th>起始日期</th><th>问题严重性</th><th>局点</th><th>业务环境</th><th>当前处理人</th><th>问题描述</th><th>SLA时间</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
        <div id="list-pagination" class="list-pagination"></div>
      </section>
      `
          : isDuty
            ? `
      <section class="duty-roster-wrap" id="duty-roster-panel" aria-label="值班表汇总">
        ${renderDutyRosterPage()}
      </section>
      `
            : isLeave
              ? `
      <section class="leave-app-page" id="leave-application-page" aria-label="请假申请">
        ${renderLeaveApplicationPage()}
      </section>
      `
              : isParams
                ? `
      ${renderParamsPage()}
      `
                : isAdmin
                ? `
      ${renderAdminPage()}
      `
                : `
      <section class="detail-card detail-card-inline">
        ${
          activeTicket
            ? `
        <div class="detail-head">
          <h2>Order ${activeTicket.orderId}</h2>
          <div class="detail-actions">
            <button class="action" id="copy-link-btn" type="button">Share Link</button>
            <button class="action action-log" id="toggle-log-drawer-btn" type="button">${state.logDrawerOpen ? "close" : "log"}</button>
          </div>
        </div>
        <div class="detail-workspace">
          <div class="flow-main">
            ${renderWorkflow(activeTicket.orderId)}
          </div>
          ${renderOperationLogs(activeTicket.orderId)}
        </div>`
            : `
        <h2>Order Not Found</h2>
        <p>未找到当前链接对应的问题单。</p>`
        }
      </section>
      `
      }
    </main>
  </div>
  ${renderDutyDayModalHtml()}
  <div class="operator-badge">
    <div class="operator-title">当前账号</div>
    <select id="operator-switcher">
      ${operatorOptions.map((account) => `<option value="${escapeAttr(account)}" ${account === currentOperator.account ? "selected" : ""}>${escapeHtml(account)}</option>`).join("")}
    </select>
    <div class="operator-meta">${escapeHtml(currentOperator.userName)}${currentRoleCode ? ` · ${escapeHtml(currentRoleCode)}` : ""}</div>
  </div>
  ${createModalHtml}
  ${isList ? renderGroupPullModalHtml() : ""}
  ${isLeave ? renderLeaveModalsHtml() : ""}
  ${
    DEBUG_ENABLED
      ? `<div id="debug-log-panel" style="position:fixed;left:${debugPanelState.left === null ? "auto" : `${debugPanelState.left}px`};top:${debugPanelState.top === null ? "auto" : `${debugPanelState.top}px`};right:${debugPanelState.left === null ? "12px" : "auto"};bottom:${debugPanelState.top === null ? "12px" : "auto"};z-index:9999;width:420px;max-width:90vw;background:#111;color:#d8ffd8;border:1px solid #3a3a3a;border-radius:8px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;box-shadow:0 10px 24px rgba(0,0,0,.35);">
          <div id="debug-log-drag-handle" style="padding:6px 8px;border-bottom:1px solid #2a2a2a;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none;">
            <strong>Debug Log</strong>
            <div style="display:flex;gap:6px;align-items:center;">
              <button type="button" id="debug-log-toggle-btn" style="border:1px solid #444;background:#1b1b1b;color:#ddd;border-radius:4px;padding:2px 8px;cursor:pointer;">${debugPanelState.collapsed ? "Expand" : "Collapse"}</button>
              <button type="button" id="debug-log-clear-btn" style="border:1px solid #444;background:#1b1b1b;color:#ddd;border-radius:4px;padding:2px 8px;cursor:pointer;">Clear</button>
            </div>
          </div>
          <pre id="debug-log-body" style="display:${debugPanelState.collapsed ? "none" : "block"};margin:0;padding:8px;max-height:180px;overflow:auto;white-space:pre-wrap;"></pre>
        </div>`
      : ""
  }
`;
  if (DEBUG_ENABLED) {
    const panel = document.getElementById("debug-log-panel");
    const dragHandle = document.getElementById("debug-log-drag-handle");
    const toggleBtn = document.getElementById("debug-log-toggle-btn");
    const clearBtn = document.getElementById("debug-log-clear-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        debugPanelState.collapsed = !debugPanelState.collapsed;
        render();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        debugLogs.length = 0;
        const box = document.getElementById("debug-log-body");
        if (box) box.textContent = "";
      });
    }
    const box = document.getElementById("debug-log-body");
    if (box) {
      box.textContent = renderDebugLogText();
      box.scrollTop = box.scrollHeight;
    }
    if (panel && dragHandle) {
      dragHandle.addEventListener("mousedown", (ev) => {
        const rect = panel.getBoundingClientRect();
        const startX = ev.clientX;
        const startY = ev.clientY;
        const originLeft = rect.left;
        const originTop = rect.top;
        const onMove = (moveEv) => {
          const nextLeft = Math.max(8, originLeft + (moveEv.clientX - startX));
          const nextTop = Math.max(8, originTop + (moveEv.clientY - startY));
          panel.style.left = `${nextLeft}px`;
          panel.style.top = `${nextTop}px`;
          panel.style.right = "auto";
          panel.style.bottom = "auto";
        };
        const onUp = () => {
          const latest = panel.getBoundingClientRect();
          debugPanelState.left = latest.left;
          debugPanelState.top = latest.top;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
  }

  const layout = document.querySelector(".layout");
  const collapseBtn = document.getElementById("collapse-btn");
  collapseBtn.addEventListener("click", () => {
    layout.classList.toggle("left-collapsed");
    collapseBtn.textContent = layout.classList.contains("left-collapsed") ? "»" : "«";
  });
  const operatorSwitcher = document.getElementById("operator-switcher");
  if (operatorSwitcher) {
    operatorSwitcher.addEventListener("change", async () => {
      const nextAccount = operatorSwitcher.value || "";
      if (!nextAccount) return;
      const user = state.adminUsers.find((u) => String(u.account || "") === nextAccount);
      const nextName = String(user?.user_name || DEFAULT_OPERATOR_NAME);
      window.localStorage.setItem("demo_operator_account", nextAccount);
      window.localStorage.setItem("demo_operator_name", nextName);
      if (state.activeKey === "leave:application") state.leaveNeedsRefresh = true;
      if (state.activeKey === "params:duty-field") {
        state.dutyFieldNeedsRefresh = true;
        state.dutyFieldEditMode = false;
      }
      if (state.activeKey === "params:version") state.versionNeedsRefresh = true;
      if (state.activeKey === "params:group-template") {
        state.groupTemplateNeedsRefresh = true;
        state.groupTemplateEditMode = false;
        state.groupTemplateDraft = null;
      }
      await syncTicketsFromServer();
      render();
    });
  }
  const operatorBadge = document.querySelector(".operator-badge");
  const operatorTitle = operatorBadge?.querySelector(".operator-title");
  if (operatorBadge && state.operatorBadgePos) {
    operatorBadge.style.left = `${state.operatorBadgePos.left}px`;
    operatorBadge.style.top = `${state.operatorBadgePos.top}px`;
    operatorBadge.style.right = "auto";
    operatorBadge.style.bottom = "auto";
  }
  if (operatorBadge && operatorTitle) {
    operatorTitle.addEventListener("mousedown", (ev) => {
      const rect = operatorBadge.getBoundingClientRect();
      const startX = ev.clientX;
      const startY = ev.clientY;
      const originLeft = rect.left;
      const originTop = rect.top;
      const onMove = (moveEv) => {
        const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
        const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
        const nextLeft = Math.min(maxLeft, Math.max(8, originLeft + (moveEv.clientX - startX)));
        const nextTop = Math.min(maxTop, Math.max(8, originTop + (moveEv.clientY - startY)));
        operatorBadge.style.left = `${nextLeft}px`;
        operatorBadge.style.top = `${nextTop}px`;
        operatorBadge.style.right = "auto";
        operatorBadge.style.bottom = "auto";
      };
      const onUp = () => {
        const latest = operatorBadge.getBoundingClientRect();
        state.operatorBadgePos = { left: latest.left, top: latest.top };
        window.localStorage.setItem("operator_badge_pos", JSON.stringify(state.operatorBadgePos));
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  document.getElementById("workspace-tabs").addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close-tab]");
    if (closeTarget) {
      event.stopPropagation();
      const key = closeTarget.getAttribute("data-close-tab");
      state.openTabs = state.openTabs.filter((tab) => tab.key !== key);
      if (state.activeKey === key) {
        state.activeKey = state.openTabs[state.openTabs.length - 1].key;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
      return;
    }
    const tabTarget = event.target.closest("[data-workspace-tab]");
    if (!tabTarget) return;
    const prevTabKey = state.activeKey;
    state.activeKey = tabTarget.getAttribute("data-workspace-tab");
    if (state.activeKey === "params:duty-field" && prevTabKey !== "params:duty-field") {
      state.dutyFieldNeedsRefresh = true;
      state.dutyFieldEditMode = false;
    }
    if (state.activeKey === "params:version" && prevTabKey !== "params:version") state.versionNeedsRefresh = true;
    if (state.activeKey === "params:group-template" && prevTabKey !== "params:group-template") {
      state.groupTemplateNeedsRefresh = true;
      state.groupTemplateEditMode = false;
      state.groupTemplateDraft = null;
    }
    history.pushState({}, "", getUrlByKey(state.activeKey));
    render();
  });

  document.querySelectorAll("[data-nav-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-nav-key");
      if (!key) return;
      const prevNavKey = state.activeKey;
      if (key.startsWith("admin:")) {
        ensureAdminTab(key.split(":")[1]);
      }
      if (key === "duty:roster") {
        ensureDutyTab();
      }
      if (key.startsWith("params:")) {
        ensureParamsTab(key.slice("params:".length));
      }
      state.activeKey = key;
      if (key === "params:duty-field" && prevNavKey !== "params:duty-field") {
        state.dutyFieldNeedsRefresh = true;
        state.dutyFieldEditMode = false;
      }
      if (key === "params:version" && prevNavKey !== "params:version") state.versionNeedsRefresh = true;
      if (key === "params:group-template" && prevNavKey !== "params:group-template") {
        state.groupTemplateNeedsRefresh = true;
        state.groupTemplateEditMode = false;
        state.groupTemplateDraft = null;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
    });
  });

  if (isList) {
    const whitelist = getCurrentWhitelistSettings();
    const onlyMyCreated = whitelist[PERMISSION_SCOPE_FIELD_KEYS.ticket_list] === "editable";
    const operator = getCurrentOperator();
    const allTickets = getAllTickets();
    const baseTickets = onlyMyCreated
      ? allTickets.filter((t) => ticketCreatorMatchesOperator(t, operator))
      : allTickets;
    const visibleByTab = baseTickets.filter((t) => {
      if (state.listTab === "all") return true;
      if (state.listTab === "created") return ticketCreatorMatchesOperator(t, operator);
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesPersonField(handler, operator);
    });
    const visibleTickets = visibleByTab;
    const pageSize = Number(state.listPageSize) > 0 ? Number(state.listPageSize) : 10;
    const totalTickets = visibleTickets.length;
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.listPage) || 1), totalPages);
    if (currentPage !== state.listPage) state.listPage = currentPage;
    const start = (currentPage - 1) * pageSize;
    const pageTickets = visibleTickets.slice(start, start + pageSize);
    const body = document.getElementById("table-body");
    const selectedSet = new Set(state.selectedTicketIds);
    const nRows = pageTickets.length;
    const staggerStepSec = nRows > 0 ? Math.min(0.04, 0.48 / nRows) : 0;
    pageTickets.forEach((ticket, rowIndex) => {
      const sevLabel = normalizeIssueSeverity(ticket.severity ?? ticket.priority);
      const sevClass = severityPillClass(sevLabel);
      const proc = String(ticket.processId || ticket.orderId || "");
      const stage = String((ticket.currentStage ?? ticket.node) || "");
      const handlerDisp = String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
      const desc = listPreviewText(ticket.description || "--", 200);
      const tr = document.createElement("tr");
      tr.className = "ticket-row";
      tr.dataset.orderId = ticket.orderId;
      tr.style.setProperty("--row-stagger", `${(rowIndex + 1) * staggerStepSec}s`);
      const slaText = formatTicketSlaDhM(ticket);
      tr.innerHTML = `<td><input type="checkbox" data-ticket-select="${escapeAttr(ticket.orderId || "")}" ${selectedSet.has(ticket.orderId) ? "checked" : ""} aria-label="选择工单 ${escapeAttr(ticket.orderId || "")}" /></td><td>${escapeHtml(proc)}</td><td>${escapeHtml(stage)}</td><td>${escapeHtml(String(ticket.startDate || ""))}</td><td><span class="p ${sevClass}">${escapeHtml(sevLabel)}</span></td><td>${escapeHtml(String(ticket.location || ""))}</td><td>${escapeHtml(String(ticket.bizEnv || ""))}</td><td>${escapeHtml(handlerDisp)}</td><td class="ticket-desc-cell">${escapeHtml(desc)}</td><td class="ticket-sla-cell">${escapeHtml(slaText)}</td>`;
      tr.addEventListener("click", () => {
        state.activeKey = ensureTicketTab(ticket.orderId);
        history.pushState({}, "", getUrlByKey(state.activeKey));
        render();
      });
      body.appendChild(tr);
    });
    const selectAll = document.getElementById("select-all-tickets");
    if (selectAll) {
      const allVisibleSelected = pageTickets.length > 0 && pageTickets.every((t) => selectedSet.has(t.orderId));
      selectAll.checked = allVisibleSelected;
      selectAll.addEventListener("change", () => {
        const next = new Set(state.selectedTicketIds);
        if (selectAll.checked) pageTickets.forEach((t) => next.add(t.orderId));
        else pageTickets.forEach((t) => next.delete(t.orderId));
        state.selectedTicketIds = Array.from(next);
        render();
      });
    }
    const paginationWrap = document.getElementById("list-pagination");
    if (paginationWrap) {
      const sizeOptions = [10, 20, 50, 100]
        .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
        .join("");
      paginationWrap.innerHTML = `
        <div class="list-pagination-bar">
          <span class="list-pagination-summary">共 ${totalTickets} 条，第 ${currentPage}/${totalPages} 页</span>
          <label class="list-pagination-size">
            <span class="list-pagination-size-text">每页</span>
            <select id="list-page-size" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
            <span class="list-pagination-size-suffix">条</span>
          </label>
          <div class="list-pagination-nav">
            <button class="action list-page-btn" type="button" id="list-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
            <button class="action list-page-btn" type="button" id="list-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
          </div>
        </div>
      `;
      const pageSizeSelect = document.getElementById("list-page-size");
      if (pageSizeSelect) {
        pageSizeSelect.addEventListener("change", () => {
          state.listPageSize = Number(pageSizeSelect.value) || 10;
          state.listPage = 1;
          render();
        });
      }
      const prevBtn = document.getElementById("list-page-prev");
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          state.listPage = Math.max(1, currentPage - 1);
          render();
        });
      }
      const nextBtn = document.getElementById("list-page-next");
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          state.listPage = Math.min(totalPages, currentPage + 1);
          render();
        });
      }
    }
    document.querySelectorAll("[data-ticket-select]").forEach((el) => {
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("change", () => {
        const orderId = el.getAttribute("data-ticket-select") || "";
        if (!orderId) return;
        const next = new Set(state.selectedTicketIds);
        if (el.checked) next.add(orderId);
        else next.delete(orderId);
        state.selectedTicketIds = Array.from(next);
      });
    });
    const createBtn = document.getElementById("create-ticket-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        const operator = getCurrentOperator();
        const orderId = makeNewTicketId();
        state.createTicketId = orderId;
        state.createModalOpen = true;
        workflowByOrderId[orderId] = {
          currentStep: WORKFLOW_NODES.indexOf("运维分析"),
          logs: [
            { step: "运维分析", actor: operator.userName, at: nowText(), summary: "创建工单并从运维分析节点开始。" },
          ],
        };
        operationLogsByOrderId[orderId] = [];
        ensureNodeFormData(orderId, "ops_analysis");
        render();
      });
    }
    const cancelCreateBtn = document.getElementById("cancel-create-ticket-btn");
    if (cancelCreateBtn) {
      cancelCreateBtn.addEventListener("click", () => {
        state.createModalOpen = false;
        state.createTicketId = "";
        render();
      });
    }
    if (state.createModalOpen && state.createTicketId) {
      ensureNodeFormData(state.createTicketId, "ops_analysis");
      bindNodeForms(state.createTicketId);
    }

    const groupPullBtn = document.getElementById("group-pull-open-btn");
    if (groupPullBtn) {
      groupPullBtn.addEventListener("click", () => {
        state.groupPullModalOpen = true;
        state.groupPullLoading = true;
        state.groupPullLocal = null;
        state.groupTemplateMsg = "";
        render();
        void fetchGroupTemplatesFromServer().then(() => {
          state.groupPullLocal = JSON.parse(JSON.stringify(state.groupTemplateItems || defaultGroupTemplateList()));
          state.groupPullLoading = false;
          render();
        });
      });
    }
    if (state.groupPullModalOpen) bindGroupPullModal();

    function bindDatePicker(triggerId, inputId, fallbackLabel) {
      const trigger = document.getElementById(triggerId);
      const input = document.getElementById(inputId);
      trigger.addEventListener("click", () => {
        if (typeof input.showPicker === "function") input.showPicker();
        else input.click();
      });
      input.addEventListener("change", () => {
        trigger.textContent = input.value || fallbackLabel;
      });
    }

    bindDatePicker("start-trigger", "start-date", "starttime");
    bindDatePicker("end-trigger", "end-date", "endtime");

    const tabButtons = document.querySelectorAll(".tabs .tab");
    const tabsWrap = document.querySelector(".tabs");
    const listPanel = document.getElementById("list-panel");
    const tableBody = document.getElementById("table-body");

    function placeTabIndicator(target) {
      if (!tabsWrap || !target) return;
      const m = tabIndicatorMetrics(tabsWrap, target);
      tabsWrap.style.setProperty("--indicator-x", `${m.x}px`);
      tabsWrap.style.setProperty("--indicator-y", `${m.y}px`);
      tabsWrap.style.setProperty("--indicator-w", `${m.w}px`);
      tabsWrap.style.setProperty("--indicator-h", `${m.h}px`);
      state.tabIndicatorLast = { ...m };
    }

    function retrigger(node, cls) {
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
    }

    const initialActive = document.querySelector(".tabs .tab.active");
    if (tabsWrap && initialActive) {
      if (state.tabIndicatorFrom && Number.isFinite(state.tabIndicatorFrom.x) && Number.isFinite(state.tabIndicatorFrom.w)) {
        const f = state.tabIndicatorFrom;
        tabsWrap.style.setProperty("--indicator-x", `${f.x}px`);
        tabsWrap.style.setProperty("--indicator-y", `${Number.isFinite(f.y) ? f.y : 0}px`);
        tabsWrap.style.setProperty("--indicator-w", `${f.w}px`);
        tabsWrap.style.setProperty("--indicator-h", `${Number.isFinite(f.h) ? f.h : 28}px`);
        requestAnimationFrame(() => placeTabIndicator(initialActive));
        state.tabIndicatorFrom = null;
      } else {
        placeTabIndicator(initialActive);
      }
    }
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const currentActive = document.querySelector(".tabs .tab.active");
        if (tabsWrap && currentActive) {
          state.tabIndicatorFrom = tabIndicatorMetrics(tabsWrap, currentActive);
        } else if (state.tabIndicatorLast) {
          state.tabIndicatorFrom = { ...state.tabIndicatorLast };
        }
        tabButtons.forEach((t) => {
          t.classList.remove("active");
          t.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        state.listTab = btn.dataset.tab || "pending";
        state.listPage = 1;
        render();
        retrigger(listPanel, "tab-anim");
        retrigger(listPanel, "sheen-anim");
        retrigger(tableBody, "row-reflow");
      });
    });

    const listRefreshBtn = document.getElementById("list-refresh-btn");
    if (listRefreshBtn) {
      listRefreshBtn.addEventListener("click", async () => {
        if (state.listRefreshing) return;
        state.listRefreshing = true;
        render();
        try {
          await refreshHomeListData();
        } finally {
          state.listRefreshing = false;
          render();
        }
      });
    }

    const active = document.querySelector(".tabs .tab.active");
    placeTabIndicator(active);
  } else if (isDuty) {
    bindDutyRosterPage();
  } else if (isLeave) {
    bindLeaveApplicationPage();
  } else if (isParams && state.activeKey === "params:duty-field") {
    bindDutyFieldParamsPage();
  } else if (isParams && state.activeKey === "params:version") {
    bindVersionParamsPage();
  } else if (isParams && state.activeKey === "params:group-template") {
    bindGroupTemplateParamsPage();
  } else if (!isAdmin) {
    if (activeTicket) {
      syncOperationLogsFromServer(activeTicket.orderId);
      const currentNodeKey = normalizeNodeKey(activeTicket.node_key || activeTicket.node);
      if (currentNodeKey) ensureNodeFormData(activeTicket.orderId, currentNodeKey);
      bindNodeForms(activeTicket.orderId);
    }
    const toggleDrawerBtn = document.getElementById("toggle-log-drawer-btn");
    if (toggleDrawerBtn) {
      toggleDrawerBtn.addEventListener("click", () => {
        state.logDrawerOpen = !state.logDrawerOpen;
        render();
      });
    }
    const closeDrawerBtn = document.getElementById("close-log-drawer-btn");
    if (closeDrawerBtn) {
      closeDrawerBtn.addEventListener("click", () => {
        state.logDrawerOpen = false;
        render();
      });
    }
    const copyBtn = document.getElementById("copy-link-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const shareLink = window.location.href;
        try {
          await navigator.clipboard.writeText(shareLink);
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Share Link";
          }, 1200);
        } catch (_err) {
          window.prompt("复制以下链接分享给他人：", shareLink);
        }
      });
    }
  } else {
    bindAdminPage();
  }

  if (state.activeKey === "duty:roster") {
    const mainEl = document.querySelector(".layout > .center");
    if (mainEl) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!suppressDutyMainScrollRestore && savedDutyMainScroll) {
            mainEl.scrollTop = savedDutyMainScroll.top;
            mainEl.scrollLeft = savedDutyMainScroll.left;
          } else if (!suppressDutyMainScrollRestore && !savedDutyMainScroll) {
            const id = window.location.hash.replace(/^#/, "");
            if (id && dutyRosterAnchorValid(id)) {
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }
        });
      });
    }
  }
}

function getFormState(orderId, nodeKey) {
  const key = `${orderId}:${nodeKey}`;
  if (!state.formsByTicket[key]) {
    state.formsByTicket[key] = {
      loading: false,
      loaded: false,
      notFound: false,
      failed: false,
      saving: false,
      error: "",
      success: "",
      fields: [],
      values: {},
    };
  }
  return state.formsByTicket[key];
}

function fieldVisible(field, vals) {
  if (field.key === "next_handler" && String(vals.handle_mode || "") === "问题解决关闭") {
    return false;
  }
  const c = field.constraints || {};
  const rules = c.visible_when_all;
  if (!rules || !rules.length) return true;
  return rules.every((r) => {
    const v = vals[r.field];
    return (r.values || []).includes(v);
  });
}

function matchesRequiredIf(requiredIf, vals) {
  if (!requiredIf || typeof requiredIf !== "object") return false;
  return Object.entries(requiredIf).every(([depKey, expected]) => {
    const actual = vals[depKey];
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

function optionalWhenAllMatches(c, vals) {
  const rules = c.optional_when_all;
  if (!rules || !rules.length) return false;
  return rules.every((r) => (r.values || []).includes(vals[r.field]));
}

function optionalWhenAnyMatches(c, vals) {
  const rules = c.optional_when_any;
  if (!rules || !rules.length) return false;
  return rules.some((r) => (r.values || []).includes(vals[r.field]));
}

function fieldEffectiveRequired(field, vals) {
  const c = field.constraints || {};
  if (!fieldVisible(field, vals)) return false;
  if (optionalWhenAnyMatches(c, vals) || optionalWhenAllMatches(c, vals)) return false;
  if (c.required_when_visible) return true;
  if (c.required_if && Object.keys(c.required_if).length) {
    return matchesRequiredIf(c.required_if, vals);
  }
  return !!field.required;
}

function collectValuesForRules(form, fields) {
  const fd = new FormData(form);
  const vals = {};
  fields.forEach((f) => {
    const raw = fd.get(f.key);
    vals[f.key] = typeof raw === "string" ? raw.trim() : raw ? String(raw) : "";
  });
  form.querySelectorAll("[data-rich-hidden]").forEach((hid) => {
    if (hid.name) vals[hid.name] = (hid.value || "").trim();
  });
  return vals;
}

function applyNodeFieldRules(form, formState) {
  const vals = collectValuesForRules(form, formState.fields);
  formState.fields.forEach((field) => {
    const wrap = form.querySelector(`[data-field-key="${field.key}"]`);
    if (!wrap) return;
    const vis = fieldVisible(field, vals);
    const req = fieldEffectiveRequired(field, vals);
    const effectiveVis = vis;
    const effectiveReq = req;
    wrap.classList.toggle("problem-field-hidden", !effectiveVis);
    wrap.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "hidden" && el.closest("[data-rich-editor]")) return;
      el.disabled = !effectiveVis;
    });
    const casc = wrap.querySelector(".cascade-cascader");
    if (casc && !effectiveVis) dutyCascaderClose(casc);
    wrap.querySelectorAll(".cascade-cascader button").forEach((el) => {
      el.disabled = !effectiveVis;
    });
    wrap.querySelectorAll(".rich-content").forEach((el) => {
      el.contentEditable = vis && !field.readonly ? "true" : "false";
    });
    wrap.querySelectorAll(".rich-toolbar button, .rich-toolbar input[type=file]").forEach((el) => {
      el.disabled = !effectiveVis || field.readonly;
    });
    const mark = wrap.querySelector(".required-mark");
    if (mark) mark.style.display = effectiveReq ? "" : "none";
    if (field.key === "next_handler") {
      const select = wrap.querySelector("select[name=\"next_handler\"]");
      const map = field.constraints?.next_handler_by_handle_mode;
      const mode = vals.handle_mode || "";
      if (select && map && typeof map === "object") {
        const allowed = Array.isArray(map[mode]) ? map[mode] : [];
        if (allowed.length > 0) {
          const prev = select.value || "";
          const usePlaceholder = false;
          const placeholder = "";
          const opts = allowed
            .map((v) => `<option value="${escapeAttr(v)}" ${v === prev ? "selected" : ""}>${escapeHtml(v)}</option>`)
            .join("");
          select.innerHTML = `${placeholder}${opts}`;
          if (!allowed.includes(prev)) {
            select.value = allowed[0];
          }
        }
      }
    }
  });
}

function buildSubmitValues(form, formState) {
  form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    syncRichEditorValue(editor);
  });
  const vals = collectValuesForRules(form, formState.fields);
  const out = {};
  formState.fields.forEach((field) => {
    if (!fieldVisible(field, vals)) return;
    out[field.key] = vals[field.key] ?? "";
  });
  return out;
}

function formatValidationErrors(errors, fields) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const labelByKey = Object.fromEntries((fields || []).map((f) => [String(f.key || ""), String(f.label || f.key || "")]));
  const msgs = errors.map((raw) => {
    const text = String(raw || "").trim();
    const reqMatch = text.match(/^([a-zA-Z0-9_]+)\s+is required$/);
    if (reqMatch) {
      const key = reqMatch[1];
      const label = labelByKey[key] || key;
      return `【${label}】为必填项`;
    }
    const oneOfMatch = text.match(/^([a-zA-Z0-9_]+)\s+must be one of\s+/);
    if (oneOfMatch) {
      const key = oneOfMatch[1];
      const label = labelByKey[key] || key;
      return `【${label}】取值不在白名单中`;
    }
    return text;
  });
  return msgs.join("；");
}

async function ensureNodeFormData(orderId, nodeKey) {
  const formState = getFormState(orderId, nodeKey);
  if (formState.loading || formState.loaded || formState.failed) return;

  formState.loading = true;
  formState.error = "";
  // Do not render() here: renderWorkflow may kick off many nodes in one pass; nested render() per node caused deep re-entrancy.

  try {
    const operator = getCurrentOperator();
    const [schemaResp, dataResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/nodes/${encodeURIComponent(nodeKey)}/schema`),
      fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/data?operator_id=${encodeURIComponent(operator.account)}`),
    ]);
    if (schemaResp.status === 404) {
      formState.notFound = true;
      formState.loaded = true;
      return;
    }
    if (!schemaResp.ok) throw new Error(`schema load failed: ${schemaResp.status}`);
    if (!dataResp.ok) throw new Error(`data load failed: ${dataResp.status}`);
    const schemaJson = await schemaResp.json();
    const dataJson = await dataResp.json();
    formState.fields = Array.isArray(schemaJson.fields)
      ? schemaJson.fields.map((f) => ({ ...f, constraints: f.constraints || {} }))
      : [];
    formState.values = dataJson.values || {};
    formState.loaded = true;
    formState.failed = false;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err || "");
    const netFail = /load failed|failed to fetch|networkerror|aborted|not allowed|refused/i.test(raw);
    formState.error = netFail
      ? `无法连接后端 ${API_BASE_URL}（请在本机终端运行 uvicorn，且与页面同主机访问，例如页面用 http://127.0.0.1:5173 打开）。也可用地址栏加参数 ?api=http://127.0.0.1:8000 指定 API。详情：${raw}`
      : raw || "load failed";
    formState.failed = true;
  } finally {
    formState.loading = false;
    render();
  }
}

async function syncOperationLogsFromServer(orderId) {
  const syncState = state.logSyncStateByOrderId[orderId] || { loading: false, loaded: false };
  if (syncState.loading || syncState.loaded) return;
  syncState.loading = true;
  state.logSyncStateByOrderId[orderId] = syncState;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/logs`);
    if (!resp.ok) return;
    const json = await resp.json();
    const rows = Array.isArray(json?.items) ? json.items : [];
    const mapped = rows.map((r) => ({
      at: String(r.at || ""),
      actor: String(r.actor || "-"),
      action: String(r.action || "submit"),
      from: String(r.from || "-"),
      to: String(r.to || "-"),
    }));
    const prev = JSON.stringify(operationLogsByOrderId[orderId] || []);
    const next = JSON.stringify(mapped);
    operationLogsByOrderId[orderId] = mapped;
    syncState.loaded = true;
    if (prev !== next) render();
  } catch (_) {
    // ignore log sync failure
  } finally {
    syncState.loading = false;
    state.logSyncStateByOrderId[orderId] = syncState;
  }
}

function bindNodeForms(orderId) {
  const forms = document.querySelectorAll("form[data-node-form]");
  forms.forEach((form) => {
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    const nodeKey = form.getAttribute("data-node-key");
    if (!nodeKey) return;
    const formState = getFormState(orderId, nodeKey);

    form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      bindRichEditor(editor);
    });

    const runRules = () => {
      form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
        syncRichEditorValue(editor);
      });
      applyNodeFieldRules(form, formState);
    };
    bindDutyFieldCascader(form);
    runRules();
    form.addEventListener("change", runRules);
    form.addEventListener("input", runRules);

    const saveNode = async (options = {}) => {
      const isFlowSubmit = !!options.flowSubmit;
      if (formState.saving) return { ok: false };
      const values = buildSubmitValues(form, formState);
      // Keep in-progress form input on any subsequent re-render.
      formState.values = { ...(formState.values || {}), ...values };
      formState.saving = true;
      formState.error = "";
      formState.success = "";
      render();

      try {
        const operator = getCurrentOperator();
        const nextNodeKey = isFlowSubmit ? resolveNextNodeKey(nodeKey, values.handle_mode || "") : "";
        debugLog("node.submit.start", { orderId, nodeKey });
        const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values,
            operator_id: operator.account,
            operator_name: operator.userName,
            next_node_key: nextNodeKey || null,
          }),
        });
        const rawText = await resp.text();
        let json = {};
        try {
          json = rawText ? JSON.parse(rawText) : {};
        } catch (_) {
          json = {};
        }
        if (!resp.ok) {
          const errors = json?.detail?.errors;
          const formatted = formatValidationErrors(errors, formState.fields);
          debugLog("node.submit.http_error", {
            orderId,
            nodeKey,
            status: resp.status,
            rawText,
            errors: Array.isArray(errors) ? errors : [],
            detail: json?.detail || null,
          });
          throw new Error(formatted || (json?.detail?.message ? String(json.detail.message) : `提交失败（HTTP ${resp.status}）`));
        }
        formState.values = json?.saved?.values || values;
        formState.success = "已保存";
        const resolvedId = String(json?.ticket_id || "").trim() || orderId;
        if (resolvedId !== orderId) remapTicketOrderId(orderId, resolvedId);
        debugLog("node.submit.ok", { orderId: resolvedId, nodeKey, remapped: resolvedId !== orderId });
        return { ok: true, values: formState.values, orderId: resolvedId };
      } catch (err) {
        debugLog("node.submit.exception", {
          orderId,
          nodeKey,
          message: err instanceof Error ? err.message : String(err || ""),
        });
        formState.error = err instanceof Error ? err.message : "提交失败";
        if (formState.error) window.alert(formState.error);
        return { ok: false };
      } finally {
        formState.saving = false;
        render();
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = event.submitter instanceof Element ? event.submitter : null;
      const flowSubmitPending = form.dataset.flowSubmitPending === "1";
      const isFlowSubmit = !!submitter?.hasAttribute("data-action-submit") || flowSubmitPending;
      if (flowSubmitPending) delete form.dataset.flowSubmitPending;
      const saved = await saveNode({ flowSubmit: isFlowSubmit });
      if (!saved.ok) return;
      const workId = saved.orderId || orderId;
      if (!isFlowSubmit) return;
      const handleMode = saved.values?.handle_mode || "";
      const nextNodeKey = resolveNextNodeKey(nodeKey, handleMode);
      state.activeKey = ensureTicketTab(workId);
      history.pushState({}, "", getUrlByKey(state.activeKey));
      if (state.createModalOpen && nodeKey === "ops_analysis") {
        const exists = ticketList.some((x) => x.orderId === workId);
        if (!exists) {
          const operator = getCurrentOperator();
          const closed = handleMode === "问题解决关闭" || handleMode === "非问题关闭";
          const nextStepLabel = closed
            ? "已关闭"
            : nextNodeKey
              ? STEP_BY_NODE_KEY[nextNodeKey] || String(nextNodeKey)
              : "运维分析";
          ticketList.unshift({
            orderId: workId,
            processId: String(saved.values?.process_flow_id || saved.values?.flow_id || workId),
            currentStage: nextStepLabel,
            startDate: String(saved.values?.start_date || new Date().toISOString().slice(0, 10)),
            location: String(saved.values?.location || ""),
            bizEnv: String(saved.values?.biz_env || ""),
            currentHandler: closed ? "" : operator.userName,
            severity: String(saved.values?.severity || "一般"),
            description: listPreviewText(
              saved.values?.issue_desc || saved.values?.problem_desc || saved.values?.description || "--",
              200
            ),
            status: closed ? "closed" : "open",
            node: nextStepLabel,
            assignee: closed ? "" : operator.userName,
            creatorName: operator.userName,
            creatorId: operator.account,
            createdAt: new Date().toISOString(),
          });
          ticketList.splice(0, ticketList.length, ...sortTicketsByCreatedAtDesc(ticketList));
        }
        state.createModalOpen = false;
        state.createTicketId = "";
      }
      if (!nextNodeKey) {
        formState.error = "未匹配到流转目标，请检查处理方式";
        render();
        return;
      }
      advanceWorkflow(workId, nodeKey, nextNodeKey, handleMode);
      const ticketKey = ensureTicketTab(workId);
      state.activeKey = ticketKey;
      history.replaceState({}, "", getUrlByKey(ticketKey));
      // Avoid location.assign: static servers (e.g. python -m http.server) have no /tickets/* file → 404 HTML.
      void syncTicketsFromServer()
        .catch(() => {})
        .finally(() => render());
    });
  });
}

async function ensureAdminData() {
  if (state.adminLoading) return;
  if (state.adminLoaded) return;
  state.adminLoading = true;
  try {
    const [permResp, userResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/admin/permissions`),
      fetch(`${API_BASE_URL}/api/admin/users`),
    ]);
    if (permResp.ok) {
      const p = await permResp.json();
      state.adminPermissions = Array.isArray(p.items) ? p.items : [];
      if (!state.adminPermissionRole) {
        const firstRole = state.adminPermissions.find((x) => x.role_code)?.role_code || "";
        state.adminPermissionRole = firstRole;
      }
    }
    if (userResp.ok) {
      const u = await userResp.json();
      state.adminUsers = Array.isArray(u.items) ? u.items : [];
    }
  } finally {
    state.adminLoaded = true;
    state.adminLoading = false;
    render();
  }
}

function getParamsPageHeadline(activeKey) {
  if (activeKey === "params:duty-field") return "责任田模块";
  if (activeKey === "params:version") return "版本模块";
  if (activeKey === "params:group-template") return "拉群模版";
  return "参数配置";
}

function dutyFieldParsePath(path) {
  return String(path || "")
    .split(".")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function dutyFieldGetParentArray(tree, parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return tree;
  let arr = tree;
  for (let d = 0; d < parts.length - 1; d++) {
    const n = arr[parts[d]];
    if (!n) return null;
    if (!Array.isArray(n.children)) n.children = [];
    arr = n.children;
  }
  return arr;
}

function dutyFieldNodeAtPath(tree, parts) {
  const parent = dutyFieldGetParentArray(tree, parts);
  if (!parent) return null;
  return parent[parts[parts.length - 1]] ?? null;
}

function stripDutyFieldIdsForApi(nodes) {
  return (nodes || []).map((n) => ({
    label: String(n.label || "").trim(),
    children: stripDutyFieldIdsForApi(n.children),
  }));
}

function dutyFieldTreeHasEmptyLabel(nodes) {
  for (const n of nodes || []) {
    if (!String(n.label || "").trim()) return true;
    if (dutyFieldTreeHasEmptyLabel(n.children)) return true;
  }
  return false;
}

function renderDutyFieldTreeInnerHtml(nodes, prefix, editable) {
  const list = Array.isArray(nodes) ? nodes : [];
  const collapsed = state.dutyFieldCollapsedPaths;
  return list
    .map((node, i) => {
      const path = prefix === "" ? String(i) : `${prefix}.${i}`;
      const label = escapeAttr(String(node.label ?? ""));
      const hasKids = !!(node.children && node.children.length);
      const isCollapsed = hasKids && collapsed.has(path);
      const toggleBtn = hasKids
        ? `<button type="button" class="duty-field-toggle" data-df-toggle="${escapeAttr(path)}" aria-expanded="${isCollapsed ? "false" : "true"}" title="${isCollapsed ? "展开子节点" : "收起子节点"}">${isCollapsed ? "▸" : "▾"}</button>`
        : `<span class="duty-field-toggle-spacer" aria-hidden="true"></span>`;
      const sub = hasKids
        ? `<ul class="duty-field-ul" ${isCollapsed ? "hidden" : ""}>${renderDutyFieldTreeInnerHtml(node.children, path, editable)}</ul>`
        : "";
      const row = editable
        ? `<div class="duty-field-row">
        ${toggleBtn}
        <input type="text" class="duty-field-label-input" data-df-path="${escapeAttr(path)}" value="${label}" placeholder="节点名称" maxlength="512" />
        <button type="button" class="action duty-field-btn" data-df-add-child="${escapeAttr(path)}">＋子项</button>
        <button type="button" class="action duty-field-btn" data-df-add-sibling="${escapeAttr(path)}">＋同级</button>
        <button type="button" class="action danger duty-field-btn" data-df-remove="${escapeAttr(path)}">删除</button>
      </div>`
        : `<div class="duty-field-row duty-field-row--readonly">
        ${toggleBtn}
        <span class="duty-field-label-text">${escapeHtml(String(node.label ?? ""))}</span>
      </div>`;
      return `<li class="duty-field-li" data-df-path="${escapeAttr(path)}">
      ${row}
      ${sub}
    </li>`;
    })
    .join("");
}

async function fetchDutyFieldTreeFromServer() {
  state.dutyFieldTreeLoading = true;
  state.dutyFieldTreeMsg = "";
  render();
  try {
    const op = getCurrentOperator();
    const resp = await fetch(`${API_BASE_URL}/api/params/duty-field/tree?operator_id=${encodeURIComponent(op.account)}`);
    let data = {};
    try {
      data = await resp.json();
    } catch (_e) {
      data = {};
    }
    if (!resp.ok) {
      const detail = data.detail != null ? String(data.detail) : `HTTP ${resp.status}`;
      state.dutyFieldTreeMsg = resp.status === 503 ? detail : `加载失败：${detail}`;
      state.dutyFieldTree = [];
    } else {
      state.dutyFieldTree = Array.isArray(data.nodes) ? data.nodes : [];
    }
  } catch (_e) {
    state.dutyFieldTreeMsg = "加载失败（网络异常）";
    state.dutyFieldTree = [];
  } finally {
    state.dutyFieldTreeLoading = false;
    render();
  }
}

async function saveDutyFieldTreeToServer(options) {
  const exitEditOnSuccess = !!(options && options.exitEditOnSuccess);
  if (state.dutyFieldTreeLoading || state.dutyFieldTreeSaving) return;
  if (dutyFieldTreeHasEmptyLabel(state.dutyFieldTree)) {
    window.alert("存在未填写名称的节点，请补全或删除后再保存。");
    return;
  }
  state.dutyFieldTreeSaving = true;
  state.dutyFieldTreeMsg = "";
  render();
  try {
    const op = getCurrentOperator();
    const body = { operator_id: op.account, nodes: stripDutyFieldIdsForApi(state.dutyFieldTree) };
    const resp = await fetch(`${API_BASE_URL}/api/params/duty-field/tree`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let detail = "";
    try {
      const j = await resp.json();
      detail = j.detail != null ? String(j.detail) : "";
    } catch (_e) {}
    if (!resp.ok) {
      const errText = detail || `保存失败（HTTP ${resp.status}）`;
      state.dutyFieldTreeMsg = errText;
      window.alert(errText);
    } else {
      state.dutyFieldTreeMsg = "";
      try {
        const op2 = getCurrentOperator();
        const r2 = await fetch(`${API_BASE_URL}/api/params/duty-field/tree?operator_id=${encodeURIComponent(op2.account)}`);
        const d2 = await r2.json();
        if (r2.ok && Array.isArray(d2.nodes)) state.dutyFieldTree = d2.nodes;
      } catch (_e) {
        /* 树仍以本地为准 */
      }
      if (exitEditOnSuccess) state.dutyFieldEditMode = false;
    }
  } catch (_e) {
    const errText = "保存失败（网络异常）";
    state.dutyFieldTreeMsg = errText;
    window.alert(errText);
  } finally {
    state.dutyFieldTreeSaving = false;
    render();
  }
}

function filterVersionBaselineRows(rows, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return rows || [];
  return (rows || []).filter((r) => {
    const a = String(r.version_label || "").toLowerCase();
    const b = String(r.commit_hash || "").toLowerCase();
    return a.includes(s) || b.includes(s);
  });
}

function filterVersionHotfixRows(rows, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return rows || [];
  return (rows || []).filter((r) => {
    const h = String(r.hotfix_label || "").toLowerCase();
    const bv = String(r.baseline_version_label || "").toLowerCase();
    const bc = String(r.baseline_commit_hash || "").toLowerCase();
    return h.includes(s) || bv.includes(s) || bc.includes(s);
  });
}

function formatBaselinePickLabel(row) {
  const v = String(row?.version_label || "").trim();
  const c = String(row?.commit_hash || "").trim();
  return c ? `${v}（${c}）` : v || "—";
}

async function refreshVersionParamsData() {
  state.versionBaselineLoading = true;
  state.versionHotfixLoading = true;
  state.versionMsg = "";
  render();
  const op = getCurrentOperator();
  try {
    const [bResp, hResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/params/baseline-versions?operator_id=${encodeURIComponent(op.account)}`),
      fetch(`${API_BASE_URL}/api/params/hotfix-versions?operator_id=${encodeURIComponent(op.account)}`),
    ]);
    const bJson = await bResp.json().catch(() => ({}));
    const hJson = await hResp.json().catch(() => ({}));
    if (!bResp.ok) {
      const d = bJson.detail != null ? String(bJson.detail) : `HTTP ${bResp.status}`;
      state.versionMsg = bResp.status === 503 ? d : `基线列表：${d}`;
      state.versionBaselineList = [];
    } else {
      state.versionBaselineList = Array.isArray(bJson.items) ? bJson.items : [];
    }
    if (!hResp.ok) {
      const d = hJson.detail != null ? String(hJson.detail) : `HTTP ${hResp.status}`;
      if (!state.versionMsg) state.versionMsg = hResp.status === 503 ? d : `热补丁列表：${d}`;
      state.versionHotfixList = [];
    } else {
      state.versionHotfixList = Array.isArray(hJson.items) ? hJson.items : [];
    }
  } catch (_e) {
    state.versionMsg = "版本数据加载失败（网络异常）";
    state.versionBaselineList = [];
    state.versionHotfixList = [];
  } finally {
    state.versionBaselineLoading = false;
    state.versionHotfixLoading = false;
    render();
  }
}

function versionFindBaselineDraftRow(idAttr, clientKey) {
  const d = state.versionBaselineDraft;
  if (!d) return null;
  if (idAttr != null && String(idAttr).trim() !== "") {
    const n = Number(idAttr);
    if (Number.isFinite(n)) return d.find((r) => r.id === n) ?? null;
  }
  const ck = String(clientKey || "");
  return d.find((r) => !r.id && r.clientKey === ck) ?? null;
}

function versionFindHotfixDraftRow(idAttr, clientKey) {
  const d = state.versionHotfixDraft;
  if (!d) return null;
  if (idAttr != null && String(idAttr).trim() !== "") {
    const n = Number(idAttr);
    if (Number.isFinite(n)) return d.find((r) => r.id === n) ?? null;
  }
  const ck = String(clientKey || "");
  return d.find((r) => !r.id && r.clientKey === ck) ?? null;
}

async function saveVersionBaselineDraft() {
  const draft = state.versionBaselineDraft;
  const orig = state.versionBaselineOrig;
  if (!draft || !orig) return;
  for (const row of draft) {
    if (!String(row.version_label || "").trim()) {
      window.alert("「版本」不能为空");
      return;
    }
  }
  const op = getCurrentOperator();
  state.versionBaselineSaving = true;
  state.versionMsg = "";
  render();
  try {
    const origById = new Map((orig || []).filter((r) => r.id).map((r) => [r.id, r]));
    const draftIds = new Set((draft || []).filter((r) => r.id).map((r) => r.id));
    for (const o of orig) {
      if (o.id && !draftIds.has(o.id)) {
        const resp = await fetch(
          `${API_BASE_URL}/api/params/baseline-versions/${o.id}?operator_id=${encodeURIComponent(op.account)}`,
          { method: "DELETE" },
        );
        if (!resp.ok) throw new Error(await parseApiError(resp));
      }
    }
    for (let i = 0; i < draft.length; i++) {
      const row = draft[i];
      const sort_order = i;
      if (!row.id) {
        const resp = await fetch(`${API_BASE_URL}/api/params/baseline-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: op.account,
            version_label: String(row.version_label || "").trim(),
            commit_hash: String(row.commit_hash || "").trim(),
            sort_order,
          }),
        });
        if (!resp.ok) throw new Error(await parseApiError(resp));
      } else {
        const o = origById.get(row.id);
        const changed =
          !o ||
          String(o.version_label || "") !== String(row.version_label || "").trim() ||
          String(o.commit_hash || "") !== String(row.commit_hash || "").trim() ||
          Number(o.sort_order) !== sort_order;
        if (changed) {
          const resp = await fetch(`${API_BASE_URL}/api/params/baseline-versions/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operator_id: op.account,
              version_label: String(row.version_label || "").trim(),
              commit_hash: String(row.commit_hash || "").trim(),
              sort_order,
            }),
          });
          if (!resp.ok) throw new Error(await parseApiError(resp));
        }
      }
    }
    await refreshVersionParamsData();
    state.versionBaselineEditMode = false;
    state.versionBaselineDraft = null;
    state.versionBaselineOrig = null;
    state.versionMsg = "基线版本已保存";
  } catch (e) {
    state.versionMsg = String(e?.message || e);
  } finally {
    state.versionBaselineSaving = false;
    render();
  }
}

async function parseApiError(resp) {
  const j = await resp.json().catch(() => ({}));
  return j.detail != null ? String(j.detail) : `HTTP ${resp.status}`;
}

async function saveVersionHotfixDraft() {
  const draft = state.versionHotfixDraft;
  const orig = state.versionHotfixOrig;
  if (!draft || !orig) return;
  for (const row of draft) {
    if (!String(row.hotfix_label || "").trim()) {
      window.alert("「热补丁版本」不能为空");
      return;
    }
    const bid = Number(row.baseline_id);
    if (!Number.isFinite(bid) || bid <= 0) {
      window.alert("请选择基线版本");
      return;
    }
  }
  const op = getCurrentOperator();
  state.versionHotfixSaving = true;
  state.versionMsg = "";
  render();
  try {
    const origById = new Map((orig || []).filter((r) => r.id).map((r) => [r.id, r]));
    const draftIds = new Set((draft || []).filter((r) => r.id).map((r) => r.id));
    for (const o of orig) {
      if (o.id && !draftIds.has(o.id)) {
        const resp = await fetch(
          `${API_BASE_URL}/api/params/hotfix-versions/${o.id}?operator_id=${encodeURIComponent(op.account)}`,
          { method: "DELETE" },
        );
        if (!resp.ok) throw new Error(await parseApiError(resp));
      }
    }
    for (let i = 0; i < draft.length; i++) {
      const row = draft[i];
      const sort_order = i;
      const baseline_id = Number(row.baseline_id);
      if (!row.id) {
        const resp = await fetch(`${API_BASE_URL}/api/params/hotfix-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: op.account,
            baseline_id,
            hotfix_label: String(row.hotfix_label || "").trim(),
            sort_order,
          }),
        });
        if (!resp.ok) throw new Error(await parseApiError(resp));
      } else {
        const o = origById.get(row.id);
        const changed =
          !o ||
          String(o.hotfix_label || "") !== String(row.hotfix_label || "").trim() ||
          Number(o.baseline_id) !== baseline_id ||
          Number(o.sort_order) !== sort_order;
        if (changed) {
          const resp = await fetch(`${API_BASE_URL}/api/params/hotfix-versions/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operator_id: op.account,
              baseline_id,
              hotfix_label: String(row.hotfix_label || "").trim(),
              sort_order,
            }),
          });
          if (!resp.ok) throw new Error(await parseApiError(resp));
        }
      }
    }
    await refreshVersionParamsData();
    state.versionHotfixEditMode = false;
    state.versionHotfixDraft = null;
    state.versionHotfixOrig = null;
    state.versionMsg = "热补丁版本已保存";
  } catch (e) {
    state.versionMsg = String(e?.message || e);
  } finally {
    state.versionHotfixSaving = false;
    render();
  }
}

function bindVersionParamsPage() {
  if (state.versionNeedsRefresh && !state.versionBaselineEditMode && !state.versionHotfixEditMode) {
    state.versionNeedsRefresh = false;
    void refreshVersionParamsData();
  }

  const panel = document.getElementById("version-params-panel");
  if (!panel) return;

  panel.querySelectorAll("[data-version-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = btn.getAttribute("data-version-sub") || "baseline";
      if (sub !== "baseline" && sub !== "hotfix") return;
      if (state.versionBaselineEditMode || state.versionHotfixEditMode) {
        if (!window.confirm("正在编辑，切换将放弃未保存的修改，确定吗？")) return;
        state.versionBaselineEditMode = false;
        state.versionBaselineDraft = null;
        state.versionBaselineOrig = null;
        state.versionHotfixEditMode = false;
        state.versionHotfixDraft = null;
        state.versionHotfixOrig = null;
      }
      state.versionSubTab = sub;
      history.replaceState({}, "", getUrlByKey("params:version"));
      render();
    });
  });

  const searchBaseline = panel.querySelector("#version-search-baseline");
  if (searchBaseline) {
    searchBaseline.addEventListener("input", () => {
      state.versionBaselineSearch = searchBaseline.value || "";
      render();
    });
  }
  const searchHotfix = panel.querySelector("#version-search-hotfix");
  if (searchHotfix) {
    searchHotfix.addEventListener("input", () => {
      state.versionHotfixSearch = searchHotfix.value || "";
      render();
    });
  }

  panel.querySelector("#version-baseline-toggle-edit")?.addEventListener("click", () => {
    if (state.versionBaselineEditMode) {
      state.versionBaselineEditMode = false;
      state.versionBaselineDraft = null;
      state.versionBaselineOrig = null;
    } else {
      state.versionBaselineEditMode = true;
      state.versionBaselineDraft = JSON.parse(JSON.stringify(state.versionBaselineList || []));
      state.versionBaselineOrig = JSON.parse(JSON.stringify(state.versionBaselineList || []));
    }
    render();
  });

  panel.querySelector("#version-baseline-add-row")?.addEventListener("click", () => {
    if (!state.versionBaselineDraft) return;
    state.versionBaselineDraft.push({
      id: null,
      clientKey: `vb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      version_label: "",
      commit_hash: "",
    });
    render();
  });

  panel.querySelector("#version-baseline-save")?.addEventListener("click", () => void saveVersionBaselineDraft());

  panel.querySelector("#version-baseline-delete-selected")?.addEventListener("click", () => {
    const d = state.versionBaselineDraft;
    if (!d) return;
    const checks = panel.querySelectorAll("input[data-vb-check]:checked");
    if (!checks.length) {
      window.alert("请先勾选要删除的行");
      return;
    }
    const drop = new Set(
      [...checks].map((cb) => {
        const id = cb.getAttribute("data-vb-id");
        const ck = cb.getAttribute("data-vb-ckey") || "";
        return id != null && String(id).trim() !== "" ? `id:${id}` : `c:${ck}`;
      }),
    );
    state.versionBaselineDraft = d.filter((r) => {
      const k = r.id != null ? `id:${r.id}` : `c:${r.clientKey || ""}`;
      return !drop.has(k);
    });
    const hall = panel.querySelector("#version-baseline-check-all");
    if (hall) hall.checked = false;
    render();
  });

  panel.querySelector("#version-baseline-check-all")?.addEventListener("change", (ev) => {
    const on = !!ev.target.checked;
    panel.querySelectorAll("input[data-vb-check]").forEach((cb) => {
      cb.checked = on;
    });
  });

  panel.querySelector("#version-hotfix-toggle-edit")?.addEventListener("click", () => {
    if (state.versionHotfixEditMode) {
      state.versionHotfixEditMode = false;
      state.versionHotfixDraft = null;
      state.versionHotfixOrig = null;
    } else {
      state.versionHotfixEditMode = true;
      state.versionHotfixDraft = JSON.parse(JSON.stringify(state.versionHotfixList || []));
      state.versionHotfixOrig = JSON.parse(JSON.stringify(state.versionHotfixList || []));
    }
    render();
  });

  panel.querySelector("#version-hotfix-add-row")?.addEventListener("click", () => {
    if (!state.versionHotfixDraft) return;
    const bases = state.versionBaselineList || [];
    const firstId = bases.length ? Number(bases[0].id) : 0;
    state.versionHotfixDraft.push({
      id: null,
      clientKey: `vh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      baseline_id: Number.isFinite(firstId) && firstId > 0 ? firstId : null,
      hotfix_label: "",
      baseline_version_label: "",
      baseline_commit_hash: "",
    });
    render();
  });

  panel.querySelector("#version-hotfix-save")?.addEventListener("click", () => void saveVersionHotfixDraft());

  panel.querySelector("#version-hotfix-delete-selected")?.addEventListener("click", () => {
    const d = state.versionHotfixDraft;
    if (!d) return;
    const checks = panel.querySelectorAll("input[data-vh-check]:checked");
    if (!checks.length) {
      window.alert("请先勾选要删除的行");
      return;
    }
    const drop = new Set(
      [...checks].map((cb) => {
        const id = cb.getAttribute("data-vh-id");
        const ck = cb.getAttribute("data-vh-ckey") || "";
        return id != null && String(id).trim() !== "" ? `id:${id}` : `c:${ck}`;
      }),
    );
    state.versionHotfixDraft = d.filter((r) => {
      const k = r.id != null ? `id:${r.id}` : `c:${r.clientKey || ""}`;
      return !drop.has(k);
    });
    const hall = panel.querySelector("#version-hotfix-check-all");
    if (hall) hall.checked = false;
    render();
  });

  panel.querySelector("#version-hotfix-check-all")?.addEventListener("change", (ev) => {
    const on = !!ev.target.checked;
    panel.querySelectorAll("input[data-vh-check]").forEach((cb) => {
      cb.checked = on;
    });
  });

  panel.querySelectorAll("[data-vb-field]").forEach((inp) => {
    const sync = () => {
      const row = versionFindBaselineDraftRow(inp.getAttribute("data-vb-id"), inp.getAttribute("data-vb-ckey"));
      if (!row) return;
      const f = inp.getAttribute("data-vb-field");
      if (f === "version_label") row.version_label = inp.value;
      else if (f === "commit_hash") row.commit_hash = inp.value;
    };
    inp.addEventListener("input", sync);
    inp.addEventListener("change", sync);
  });

  panel.querySelectorAll("[data-vh-field]").forEach((el) => {
    const sync = () => {
      const row = versionFindHotfixDraftRow(el.getAttribute("data-vh-id"), el.getAttribute("data-vh-ckey"));
      if (!row) return;
      const f = el.getAttribute("data-vh-field");
      if (f === "hotfix_label") row.hotfix_label = el.value;
      if (f === "baseline_id") row.baseline_id = Number(el.value);
    };
    el.addEventListener("change", sync);
    if (el.tagName !== "SELECT") el.addEventListener("input", sync);
  });
}

function bindDutyFieldParamsPage() {
  if (state.dutyFieldNeedsRefresh) {
    state.dutyFieldNeedsRefresh = false;
    void fetchDutyFieldTreeFromServer();
  }

  const panel = document.getElementById("duty-field-panel");
  if (!panel) return;

  panel.querySelector("#duty-field-edit-btn")?.addEventListener("click", () => {
    state.dutyFieldEditMode = true;
    state.dutyFieldTreeMsg = "";
    render();
  });
  panel.querySelector("#duty-field-done-btn")?.addEventListener("click", () => void saveDutyFieldTreeToServer({ exitEditOnSuccess: true }));
  panel.querySelector("#duty-field-cancel-btn")?.addEventListener("click", () => {
    state.dutyFieldEditMode = false;
    state.dutyFieldTreeMsg = "";
    void fetchDutyFieldTreeFromServer();
  });
  panel.querySelector("#duty-field-add-root-btn")?.addEventListener("click", () => {
    state.dutyFieldTree.push({ label: "", children: [] });
    state.dutyFieldTreeMsg = "";
    render();
  });

  panel.querySelectorAll(".duty-field-label-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const parts = dutyFieldParsePath(inp.getAttribute("data-df-path") || "");
      const node = dutyFieldNodeAtPath(state.dutyFieldTree, parts);
      if (node) node.label = inp.value;
    });
  });

  panel.addEventListener("click", (ev) => {
    const toggle = ev.target.closest("[data-df-toggle]");
    if (toggle) {
      ev.preventDefault();
      const path = toggle.getAttribute("data-df-toggle") || "";
      if (!path) return;
      const set = state.dutyFieldCollapsedPaths;
      if (set.has(path)) set.delete(path);
      else set.add(path);
      render();
      return;
    }
    if (!state.dutyFieldEditMode || !isDutyCalendarAdmin()) return;
    const addChild = ev.target.closest("[data-df-add-child]");
    if (addChild) {
      ev.preventDefault();
      const parts = dutyFieldParsePath(addChild.getAttribute("data-df-add-child") || "");
      const node = dutyFieldNodeAtPath(state.dutyFieldTree, parts);
      if (!node) return;
      if (!Array.isArray(node.children)) node.children = [];
      node.children.push({ label: "", children: [] });
      state.dutyFieldTreeMsg = "";
      render();
      return;
    }
    const addSib = ev.target.closest("[data-df-add-sibling]");
    if (addSib) {
      ev.preventDefault();
      const parts = dutyFieldParsePath(addSib.getAttribute("data-df-add-sibling") || "");
      const parentArr = dutyFieldGetParentArray(state.dutyFieldTree, parts);
      if (!parentArr) return;
      const idx = parts[parts.length - 1];
      parentArr.splice(idx + 1, 0, { label: "", children: [] });
      state.dutyFieldTreeMsg = "";
      render();
      return;
    }
    const rm = ev.target.closest("[data-df-remove]");
    if (rm) {
      ev.preventDefault();
      const parts = dutyFieldParsePath(rm.getAttribute("data-df-remove") || "");
      const parentArr = dutyFieldGetParentArray(state.dutyFieldTree, parts);
      if (!parentArr) return;
      const idx = parts[parts.length - 1];
      if (idx < 0 || idx >= parentArr.length) return;
      parentArr.splice(idx, 1);
      state.dutyFieldTreeMsg = "";
      render();
    }
  });
}

function defaultGroupTemplateList() {
  return GROUP_TEMPLATE_KINDS.map(({ kind }) => ({
    problem_kind: kind,
    group_name_tpl: GROUP_TEMPLATE_NAME_DEFAULTS[kind] || "",
    group_notice_tpl: "",
    group_members_tpl: "",
    first_report_tpl: "",
  }));
}

function mergeGroupTemplateItemsFromApi(items) {
  const byKind = Object.fromEntries(
    (Array.isArray(items) ? items : []).map((x) => [String(x.problem_kind || "").trim(), x])
  );
  return GROUP_TEMPLATE_KINDS.map(({ kind }) => {
    const row = byKind[kind];
    if (!row) {
      return {
        problem_kind: kind,
        group_name_tpl: GROUP_TEMPLATE_NAME_DEFAULTS[kind] || "",
        group_notice_tpl: "",
        group_members_tpl: "",
        first_report_tpl: "",
      };
    }
    return {
      problem_kind: kind,
      group_name_tpl: String(row.group_name_tpl ?? ""),
      group_notice_tpl: String(row.group_notice_tpl ?? ""),
      group_members_tpl: String(row.group_members_tpl ?? ""),
      first_report_tpl: String(row.first_report_tpl ?? ""),
    };
  });
}

async function fetchGroupTemplatesFromServer() {
  state.groupTemplateLoading = true;
  state.groupTemplateMsg = "";
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/group-templates`);
    const tx = await resp.text();
    let data = {};
    try {
      data = JSON.parse(tx);
    } catch (_) {
      data = {};
    }
    const detail = String(data.detail || data.message || tx || "").trim();
    if (!resp.ok) {
      state.groupTemplateItems = defaultGroupTemplateList();
      state.groupTemplateMsg =
        resp.status === 503 ? detail || "拉群模版表未就绪，请执行数据库迁移。" : `加载失败：${detail || resp.status}`;
      return false;
    }
    state.groupTemplateItems = mergeGroupTemplateItemsFromApi(data.items);
    state.groupTemplateMsg = "";
    return true;
  } catch (e) {
    state.groupTemplateItems = defaultGroupTemplateList();
    state.groupTemplateMsg = `加载失败（网络异常）：${String(e?.message || e)}`;
    return false;
  } finally {
    state.groupTemplateLoading = false;
  }
}

function groupTemplateRowByKind(items, kind) {
  const list = Array.isArray(items) ? items : [];
  return list.find((r) => String(r.problem_kind || "") === kind) || null;
}

function renderGroupTemplateFieldsHtml(row, readOnly, idPrefix) {
  const p = idPrefix || "gt";
  const ro = readOnly ? "readonly" : "";
  const r = row || {
    problem_kind: state.groupTemplateActiveKind,
    group_name_tpl: "",
    group_notice_tpl: "",
    group_members_tpl: "",
    first_report_tpl: "",
  };
  const fields = [
    { key: "group_name_tpl", label: "群名称" },
    { key: "group_notice_tpl", label: "群公告" },
    { key: "group_members_tpl", label: "群组成员" },
    { key: "first_report_tpl", label: "首次通报" },
  ];
  return fields
    .map(
      (f) => `
    <div class="group-template-field">
      <label class="group-template-label" for="${p}-${f.key}">${escapeHtml(f.label)}</label>
      <textarea id="${p}-${f.key}" class="group-template-input" data-field="${escapeAttr(f.key)}" rows="${f.key === "group_name_tpl" ? 3 : 5}" ${ro}>${escapeHtml(String(r[f.key] ?? ""))}</textarea>
    </div>`
    )
    .join("");
}

function renderGroupTemplatePageHtml(title) {
  const admin = isDutyCalendarAdmin();
  const loading = state.groupTemplateLoading;
  const saving = state.groupTemplateSaving;
  const edit = state.groupTemplateEditMode && admin;
  const src = edit ? state.groupTemplateDraft : state.groupTemplateItems;
  const row = groupTemplateRowByKind(src, state.groupTemplateActiveKind);
  const msg = state.groupTemplateMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|未就绪|迁移/.test(state.groupTemplateMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.groupTemplateMsg)}</p>`
    : "";
  const tabs = GROUP_TEMPLATE_KINDS.map(
    ({ kind, label }) => `
    <button type="button" class="action ${state.groupTemplateActiveKind === kind ? "primary" : ""}" data-group-template-kind="${escapeAttr(kind)}">${escapeHtml(label)}</button>`
  ).join("");
  let actions = "";
  if (admin) {
    if (!edit) {
      actions = `<button type="button" class="action primary" id="group-template-edit-btn" ${loading || saving ? "disabled" : ""}>编辑</button>`;
    } else {
      actions = `<button type="button" class="action primary" id="group-template-save-btn" ${loading || saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        <button type="button" class="action" id="group-template-cancel-btn" ${loading || saving ? "disabled" : ""}>取消</button>`;
    }
  } else {
    actions = `<span class="duty-field-hint">仅管理员可编辑并保存模版。</span>`;
  }
  const body =
    loading && !state.groupTemplateItems.length
      ? `<p class="duty-field-hint">正在从服务器加载…</p>`
      : renderGroupTemplateFieldsHtml(row, !edit, "gt");
  return `
    <section class="detail-card detail-card-inline params-config-page group-template-page" id="group-template-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">${actions}</div>
      </div>
      ${msg}
      <div class="version-params-subtabs group-template-type-tabs" role="tablist" aria-label="问题类型">${tabs}</div>
      ${body}
    </section>
  `;
}

function renderGroupPullModalHtml() {
  if (!state.groupPullModalOpen) return "";
  const loading = state.groupPullLoading;
  const local = Array.isArray(state.groupPullLocal) ? state.groupPullLocal : state.groupTemplateItems;
  const row = groupTemplateRowByKind(local, state.groupPullActiveKind);
  const tabs = GROUP_TEMPLATE_KINDS.map(
    ({ kind, label }) => `
    <button type="button" class="action ${state.groupPullActiveKind === kind ? "primary" : ""}" data-group-pull-kind="${escapeAttr(kind)}">${escapeHtml(label)}</button>`
  ).join("");
  const warn =
    !loading && state.groupTemplateMsg
      ? `<p class="duty-field-banner duty-field-banner--err">${escapeHtml(state.groupTemplateMsg)}</p>`
      : "";
  const body = loading
    ? `<p class="duty-field-hint">正在加载模版…</p>`
    : renderGroupTemplateFieldsHtml(row, false, "gp");
  return `
  <div class="perm-modal-mask" id="group-pull-modal-mask" role="dialog" aria-modal="true" aria-labelledby="group-pull-modal-title">
    <div class="perm-modal group-pull-modal">
      <div class="perm-modal-head">
        <h3 id="group-pull-modal-title">拉群</h3>
      </div>
      <div class="perm-modal-body">
        ${warn}
        <div class="version-params-subtabs group-template-type-tabs" role="tablist" aria-label="问题类型">${tabs}</div>
        ${body}
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="group-pull-copy-btn" ${loading ? "disabled" : ""}>确定</button>
        <button type="button" class="action" id="group-pull-close-btn">关闭</button>
      </div>
    </div>
  </div>`;
}

async function saveGroupTemplateDraftToServer() {
  if (!isDutyCalendarAdmin() || !state.groupTemplateDraft) return;
  const op = getCurrentOperator();
  state.groupTemplateSaving = true;
  state.groupTemplateMsg = "";
  render();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/group-templates`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, items: state.groupTemplateDraft }),
    });
    const tx = await resp.text();
    let data = {};
    try {
      data = JSON.parse(tx);
    } catch (_) {
      data = {};
    }
    const detail = String(data.detail || data.message || tx || "").trim();
    if (!resp.ok) {
      state.groupTemplateMsg = detail || `保存失败：${resp.status}`;
      return;
    }
    state.groupTemplateItems = mergeGroupTemplateItemsFromApi(data.items);
    state.groupTemplateDraft = null;
    state.groupTemplateEditMode = false;
    state.groupTemplateMsg = "拉群模版已保存";
  } catch (e) {
    state.groupTemplateMsg = String(e?.message || e);
  } finally {
    state.groupTemplateSaving = false;
    render();
  }
}

function bindGroupTemplateParamsPage() {
  if (state.groupTemplateNeedsRefresh) {
    state.groupTemplateNeedsRefresh = false;
    void fetchGroupTemplatesFromServer().then(() => render());
  }

  const panel = document.getElementById("group-template-panel");
  if (!panel) return;

  panel.querySelector("#group-template-edit-btn")?.addEventListener("click", () => {
    if (!isDutyCalendarAdmin()) return;
    state.groupTemplateEditMode = true;
    state.groupTemplateDraft = JSON.parse(JSON.stringify(state.groupTemplateItems || defaultGroupTemplateList()));
    state.groupTemplateMsg = "";
    render();
  });

  panel.querySelector("#group-template-cancel-btn")?.addEventListener("click", () => {
    state.groupTemplateEditMode = false;
    state.groupTemplateDraft = null;
    state.groupTemplateMsg = "";
    void fetchGroupTemplatesFromServer().then(() => render());
  });

  panel.querySelector("#group-template-save-btn")?.addEventListener("click", () => void saveGroupTemplateDraftToServer());

  panel.querySelectorAll("[data-group-template-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-group-template-kind") || "major";
      state.groupTemplateActiveKind = k;
      render();
    });
  });

  const src = state.groupTemplateEditMode && isDutyCalendarAdmin() ? state.groupTemplateDraft : null;
  panel.querySelectorAll("textarea.group-template-input").forEach((ta) => {
    ta.addEventListener("input", () => {
      if (!src) return;
      const kind = state.groupTemplateActiveKind;
      const row = groupTemplateRowByKind(src, kind);
      const field = ta.getAttribute("data-field");
      if (row && field) row[field] = ta.value;
    });
  });
}

function bindGroupPullModal() {
  const mask = document.getElementById("group-pull-modal-mask");
  if (!mask) return;

  mask.querySelector("#group-pull-close-btn")?.addEventListener("click", () => {
    state.groupPullModalOpen = false;
    state.groupPullLocal = null;
    render();
  });

  mask.addEventListener("click", (ev) => {
    if (ev.target === mask) {
      state.groupPullModalOpen = false;
      state.groupPullLocal = null;
      render();
    }
  });

  mask.querySelectorAll("[data-group-pull-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-group-pull-kind") || "major";
      state.groupPullActiveKind = k;
      render();
    });
  });

  const local = state.groupPullLocal;
  mask.querySelectorAll("textarea.group-template-input").forEach((ta) => {
    ta.addEventListener("input", () => {
      if (!Array.isArray(local)) return;
      const kind = state.groupPullActiveKind;
      const row = groupTemplateRowByKind(local, kind);
      const field = ta.getAttribute("data-field");
      if (row && field) row[field] = ta.value;
    });
  });

  mask.querySelector("#group-pull-copy-btn")?.addEventListener("click", async () => {
    const list = Array.isArray(state.groupPullLocal) ? state.groupPullLocal : state.groupTemplateItems;
    const kind = state.groupPullActiveKind;
    const row = groupTemplateRowByKind(list, kind) || {};
    const label = GROUP_TEMPLATE_KINDS.find((x) => x.kind === kind)?.label || kind;
    const text = [
      `问题类型：${label}`,
      `群名称：${String(row.group_name_tpl || "").trim()}`,
      `群公告：${String(row.group_notice_tpl || "").trim()}`,
      `群组成员：${String(row.group_members_tpl || "").trim()}`,
      `首次通报：${String(row.first_report_tpl || "").trim()}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      window.alert("已复制到剪贴板");
    } catch (_e) {
      window.prompt("请手动复制：", text);
    }
  });
}

function renderVersionParamsPageHtml(title) {
  const sub = state.versionSubTab === "hotfix" ? "hotfix" : "baseline";
  const loading = state.versionBaselineLoading || state.versionHotfixLoading;
  const saving = state.versionBaselineSaving || state.versionHotfixSaving;
  const msg = state.versionMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|冲突|引用|不存在|不能为空|请先/.test(state.versionMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.versionMsg)}</p>`
    : "";
  const bases = state.versionBaselineList || [];

  const baselineRowsSrc = state.versionBaselineEditMode ? state.versionBaselineDraft : state.versionBaselineList;
  const baselineVisible = filterVersionBaselineRows(baselineRowsSrc || [], state.versionBaselineSearch);
  const baselineHead = state.versionBaselineEditMode
    ? `<tr><th class="version-row-check" scope="col"><input type="checkbox" id="version-baseline-check-all" title="全选当前列表" aria-label="全选当前列表" /></th><th>序号</th><th>版本</th><th>commit号</th></tr>`
    : `<tr><th>序号</th><th>版本</th><th>commit号</th></tr>`;
  const baselineColCount = state.versionBaselineEditMode ? 4 : 3;
  const baselineBody = baselineVisible
    .map((r, vi) => {
      const seq = vi + 1;
      const idAttr = r.id != null ? String(r.id) : "";
      const ckey = r.clientKey || "";
      if (state.versionBaselineEditMode) {
        return `<tr>
          <td class="version-row-check"><input type="checkbox" data-vb-check data-vb-id="${escapeAttr(idAttr)}" data-vb-ckey="${escapeAttr(ckey)}" /></td>
          <td>${seq}</td>
          <td><input type="text" class="admin-table-inline" data-vb-field="version_label" data-vb-id="${escapeAttr(idAttr)}" data-vb-ckey="${escapeAttr(ckey)}" value="${escapeAttr(String(r.version_label || ""))}" maxlength="256" /></td>
          <td><input type="text" class="admin-table-inline" data-vb-field="commit_hash" data-vb-id="${escapeAttr(idAttr)}" data-vb-ckey="${escapeAttr(ckey)}" value="${escapeAttr(String(r.commit_hash || ""))}" maxlength="128" /></td>
        </tr>`;
      }
      return `<tr>
        <td>${seq}</td>
        <td>${escapeHtml(String(r.version_label || ""))}</td>
        <td>${escapeHtml(String(r.commit_hash || ""))}</td>
      </tr>`;
    })
    .join("");

  const hotfixRowsSrc = state.versionHotfixEditMode ? state.versionHotfixDraft : state.versionHotfixList;
  const hotfixVisible = filterVersionHotfixRows(hotfixRowsSrc || [], state.versionHotfixSearch);
  const hotfixHead = state.versionHotfixEditMode
    ? `<tr><th class="version-row-check" scope="col"><input type="checkbox" id="version-hotfix-check-all" title="全选当前列表" aria-label="全选当前列表" /></th><th>序号</th><th>基线版本</th><th>热补丁版本</th></tr>`
    : `<tr><th>序号</th><th>基线版本</th><th>热补丁版本</th></tr>`;
  const hotfixColCount = state.versionHotfixEditMode ? 4 : 3;
  const hotfixBody = hotfixVisible
    .map((r, vi) => {
      const seq = vi + 1;
      const baselineText = formatBaselinePickLabel({
        version_label: r.baseline_version_label,
        commit_hash: r.baseline_commit_hash,
      });
      const idAttr = r.id != null ? String(r.id) : "";
      const ckey = r.clientKey || "";
      if (state.versionHotfixEditMode) {
        const opts = bases
          .map((b) => {
            const id = Number(b.id);
            const sel = Number(r.baseline_id) === id ? "selected" : "";
            return `<option value="${id}" ${sel}>${escapeHtml(formatBaselinePickLabel(b))}</option>`;
          })
          .join("");
        const selectHtml = bases.length
          ? `<select class="admin-table-inline" data-vh-field="baseline_id" data-vh-id="${escapeAttr(idAttr)}" data-vh-ckey="${escapeAttr(ckey)}">${opts}</select>`
          : `<span class="duty-field-hint">请先在「基线版本」中维护数据</span>`;
        return `<tr>
          <td class="version-row-check"><input type="checkbox" data-vh-check data-vh-id="${escapeAttr(idAttr)}" data-vh-ckey="${escapeAttr(ckey)}" /></td>
          <td>${seq}</td>
          <td>${selectHtml}</td>
          <td><input type="text" class="admin-table-inline" data-vh-field="hotfix_label" data-vh-id="${escapeAttr(idAttr)}" data-vh-ckey="${escapeAttr(ckey)}" value="${escapeAttr(String(r.hotfix_label || ""))}" maxlength="256" /></td>
        </tr>`;
      }
      return `<tr>
        <td>${seq}</td>
        <td>${escapeHtml(baselineText)}</td>
        <td>${escapeHtml(String(r.hotfix_label || ""))}</td>
      </tr>`;
    })
    .join("");

  const baselineTable =
    baselineBody ||
    `<tr><td colspan="${baselineColCount}">${loading ? "加载中…" : state.versionBaselineSearch.trim() ? "无匹配行" : "暂无数据"}</td></tr>`;
  const hotfixTable =
    hotfixBody ||
    `<tr><td colspan="${hotfixColCount}">${loading ? "加载中…" : state.versionHotfixSearch.trim() ? "无匹配行" : "暂无数据"}</td></tr>`;

  const baselineHeadActions =
    sub === "baseline"
      ? `
        <button type="button" class="action" id="version-baseline-toggle-edit">${state.versionBaselineEditMode ? "退出编辑" : "编辑"}</button>
        ${
          state.versionBaselineEditMode
            ? `<button type="button" class="action" id="version-baseline-add-row" ${saving ? "disabled" : ""}>新增行</button>
        <button type="button" class="action danger" id="version-baseline-delete-selected" ${saving ? "disabled" : ""}>删除</button>
        <button type="button" class="action primary" id="version-baseline-save" ${saving ? "disabled" : ""}>${state.versionBaselineSaving ? "保存中…" : "保存"}</button>`
            : ""
        }
      `
      : "";
  const hotfixHeadActions =
    sub === "hotfix"
      ? `
        <button type="button" class="action" id="version-hotfix-toggle-edit">${state.versionHotfixEditMode ? "退出编辑" : "编辑"}</button>
        ${
          state.versionHotfixEditMode
            ? `<button type="button" class="action" id="version-hotfix-add-row" ${saving ? "disabled" : ""}>新增行</button>
        <button type="button" class="action danger" id="version-hotfix-delete-selected" ${saving ? "disabled" : ""}>删除</button>
        <button type="button" class="action primary" id="version-hotfix-save" ${saving ? "disabled" : ""}>${state.versionHotfixSaving ? "保存中…" : "保存"}</button>`
            : ""
        }
      `
      : "";
  const detailActionsHtml = sub === "baseline" ? baselineHeadActions : hotfixHeadActions;

  const baselineBlock = `
    <div class="version-params-toolbar">
      <input type="search" id="version-search-baseline" class="filter-search version-params-search" placeholder="搜索版本或 commit…" value="${escapeAttr(state.versionBaselineSearch || "")}" />
    </div>
    <div class="oplog-table-wrap">
      <table class="oplog-table admin-table">
        <thead>${baselineHead}</thead>
        <tbody>${baselineTable}</tbody>
      </table>
    </div>`;

  const hotfixBlock = `
    <div class="version-params-toolbar">
      <input type="search" id="version-search-hotfix" class="filter-search version-params-search" placeholder="搜索热补丁或基线…" value="${escapeAttr(state.versionHotfixSearch || "")}" />
    </div>
    <div class="oplog-table-wrap">
      <table class="oplog-table admin-table">
        <thead>${hotfixHead}</thead>
        <tbody>${hotfixTable}</tbody>
      </table>
    </div>`;

  return `
    <section class="detail-card detail-card-inline params-config-page version-params-page" id="version-params-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions detail-actions--version">${detailActionsHtml}</div>
      </div>
      <div class="version-params-subtabs">
        <button type="button" class="action ${sub === "baseline" ? "primary" : ""}" data-version-sub="baseline">基线版本</button>
        <button type="button" class="action ${sub === "hotfix" ? "primary" : ""}" data-version-sub="hotfix">热补丁版本</button>
      </div>
      ${msg}
      ${sub === "baseline" ? baselineBlock : hotfixBlock}
    </section>
  `;
}

function renderParamsPage() {
  const title = getParamsPageHeadline(state.activeKey);
  if (state.activeKey === "params:version") {
    return renderVersionParamsPageHtml(title);
  }
  if (state.activeKey === "params:group-template") {
    return renderGroupTemplatePageHtml(title);
  }
  if (state.activeKey !== "params:duty-field") {
    const intro = "该参数子页尚未接入。";
    return `
    <section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
      </div>
      <p class="params-page-intro">${escapeHtml(intro)}</p>
    </section>
  `;
  }

  const loading = state.dutyFieldTreeLoading;
  const saving = state.dutyFieldTreeSaving;
  const admin = isDutyCalendarAdmin();
  const edit = state.dutyFieldEditMode && admin;
  const msg = state.dutyFieldTreeMsg
    ? `<p class="duty-field-banner duty-field-banner--err">${escapeHtml(state.dutyFieldTreeMsg)}</p>`
    : "";
  let body = "";
  if (loading && !state.dutyFieldTree.length) {
    body = '<p class="duty-field-hint">正在从服务器加载…</p>';
  } else if (!state.dutyFieldTree.length) {
    body = '<p class="duty-field-hint">暂无数据。</p>';
  } else {
    body = `${loading ? '<p class="duty-field-hint">刷新中…</p>' : ""}<ul class="duty-field-ul duty-field-ul-root">${renderDutyFieldTreeInnerHtml(state.dutyFieldTree, "", edit)}</ul>`;
  }

  const busy = loading || saving;
  let actions = "";
  if (admin && !loading) {
    if (!state.dutyFieldEditMode) {
      actions = `<button type="button" class="action primary" id="duty-field-edit-btn" ${busy ? "disabled" : ""}>编辑</button>`;
    } else {
      actions = `
          <button type="button" class="action primary" id="duty-field-done-btn" ${busy ? "disabled" : ""}>${saving ? "保存中…" : "完成"}</button>
          <button type="button" class="action" id="duty-field-cancel-btn" ${busy ? "disabled" : ""}>取消</button>
          <button type="button" class="action" id="duty-field-add-root-btn" ${busy ? "disabled" : ""}>添加根节点</button>`;
    }
  }

  return `
    <section class="detail-card detail-card-inline params-config-page" id="duty-field-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">${actions}</div>
      </div>
      ${msg}
      ${body}
    </section>
  `;
}

function renderAdminPage() {
  const isPermissions = state.activeKey === "admin:permissions";
  const permissionGroups = Array.from(new Set(state.adminPermissions.map((x) => String(x.role_code || "")).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  if (isPermissions) {
    const allPermissionRows = state.adminPermissions;
    const groupNames = Array.from(new Set(allPermissionRows.map((x) => String(x.role_code || "")).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const selectedGroup = state.adminPermissionRole || "";
    const groupRows = allPermissionRows.filter(
      (x) => String(x.role_code || "") === selectedGroup && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY
    );
    const levelByKey = Object.fromEntries(
      groupRows.map((x) => [String(x.field_key || ""), String(x.permission_level || "hidden")])
    );
    const previewRows = PERMISSION_WHITELIST_ITEMS.map((item) => ({
      label: item.label,
      level: levelByKey[item.key] || "hidden",
      scope:
        item.key === "ticket_list"
          ? (levelByKey[PERMISSION_SCOPE_FIELD_KEYS.ticket_list] === "editable" ? "仅查看本人创建工单" : "-")
          : item.key === "ticket_detail"
            ? (levelByKey[PERMISSION_SCOPE_FIELD_KEYS.ticket_detail] === "editable" ? "仅查看问题填写节点" : "-")
            : "-",
    }));
    const levelText = { hidden: "不展示", readonly: "只读", editable: "可编辑" };
    return `
    <section class="detail-card detail-card-inline admin-wrap">
      <div class="detail-head">
        <h2>权限策略</h2>
        <div class="detail-actions">
          <button class="action" type="button" data-admin-role-add>新增权限组</button>
        </div>
      </div>
      ${state.adminMsg ? `<p class="problem-fill-status success">${escapeHtml(state.adminMsg)}</p>` : ""}
      <div class="perm-layout">
        <div class="perm-layout-left">
          <div class="perm-layout-title">权限组</div>
          <div class="perm-group-list">
            ${
              groupNames.length
                ? groupNames
                  .map((role) => `<button class="perm-group-item ${selectedGroup === role ? "active" : ""}" type="button" data-admin-role-view="${escapeAttr(role)}">${escapeHtml(role)}</button>`)
                  .join("")
                : '<div class="perm-group-empty">暂无权限组，请先新增</div>'
            }
          </div>
        </div>
        <div class="perm-layout-right">
          <div class="admin-subtabs">
            ${selectedGroup ? "" : "<span>请先在左侧选择权限组</span>"}
            <button class="action primary" type="button" data-admin-whitelist-open ${selectedGroup ? "" : "disabled"}>配置白名单</button>
          </div>
          <div class="oplog-table-wrap">
            <table class="oplog-table admin-table">
              <thead><tr><th>白名单页面</th><th>权限级别</th><th>限制条件</th></tr></thead>
              <tbody>
                ${
                  selectedGroup
                    ? previewRows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(levelText[r.level] || r.level)}</td><td>${escapeHtml(r.scope)}</td></tr>`).join("")
                    : '<tr><td colspan="3">请先选择或新增权限组</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ${
        state.adminPermissionDialogOpen
          ? `<div class="perm-modal-mask">
        <div class="perm-modal">
          <div class="perm-modal-head">
            <h3>配置白名单 · ${escapeHtml(selectedGroup)}</h3>
          </div>
          <div class="perm-modal-body">
            <table class="oplog-table admin-table">
              <thead><tr><th>白名单页面</th><th>权限级别</th><th>限制条件</th></tr></thead>
              <tbody>
                ${PERMISSION_WHITELIST_ITEMS.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.label)}</td>
                    <td>
                      <select data-perm-item-key="${escapeAttr(item.key)}">
                        ${[
                          ["hidden", "不展示"],
                          ["readonly", "只读"],
                          ["editable", "可编辑"],
                        ].map(([v, t]) => `<option value="${v}" ${(state.adminPermissionDraft[item.key] || "hidden") === v ? "selected" : ""}>${t}</option>`).join("")}
                      </select>
                    </td>
                    <td>
                      ${
                        item.key === "ticket_list"
                          ? `<label class="filter-opt"><input type="checkbox" data-perm-scope-key="ticket_list" ${state.adminPermissionScopeDraft.ticket_list ? "checked" : ""}/> 仅查看本人创建工单</label>`
                          : item.key === "ticket_detail"
                            ? `<label class="filter-opt"><input type="checkbox" data-perm-scope-key="ticket_detail" ${state.adminPermissionScopeDraft.ticket_detail ? "checked" : ""}/> 仅查看问题填写节点</label>`
                            : "-"
                      }
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="perm-modal-actions">
            <button class="action" type="button" data-admin-whitelist-cancel>取消</button>
            <button class="action primary" type="button" data-admin-whitelist-save>保存</button>
          </div>
        </div>
      </div>`
          : ""
      }
    </section>
  `;
  }
  const isPermissionEditMode = isPermissions && state.adminPermissionEditMode;
  const isUserEditMode = !isPermissions && state.adminUserEditMode;
  const allPermissionRows = state.adminPermissions;
  const roleRows = isPermissions && state.adminPermissionRole
    ? allPermissionRows.filter((x) => String(x.role_code || "") === state.adminPermissionRole)
    : allPermissionRows;
  const rows = isPermissions ? roleRows : state.adminUsers;
  const filteredRows = isPermissions
    ? filterPermissionRows(rows, state.adminPermissionFilters)
    : filterUserRows(rows, state.adminUserFilters);
  const title = isPermissions ? "权限策略" : "用户管理";
  const subtitle = "";
  const columnCount = isPermissions ? (isPermissionEditMode ? 6 : 5) : (isUserEditMode ? 6 : 5);
  const tableHead = isPermissions
    ? renderPermissionTableHead(rows, isPermissionEditMode)
    : renderUserTableHead(filteredRows, rows, isUserEditMode);
  const body = filteredRows
    .map((r, idx) => {
      if (isPermissions) {
        if (!isPermissionEditMode) {
          return `<tr>
          <td>${escapeHtml(String(r.role_code || ""))}</td>
          <td>${r.is_pl ? "是" : "否"}</td>
          <td>${escapeHtml(String(r.node_key || ""))}</td>
          <td>${escapeHtml(String(r.field_key || ""))}</td>
          <td>${escapeHtml(String(r.permission_level || ""))}</td>
        </tr>`;
        }
        return `<tr data-admin-row="${idx}">
          <td><input data-k="role_code" value="${escapeAttr(r.role_code || "")}" /></td>
          <td><input data-k="is_pl" type="checkbox" ${r.is_pl ? "checked" : ""} /></td>
          <td><input data-k="node_key" value="${escapeAttr(r.node_key || "")}" /></td>
          <td><input data-k="field_key" value="${escapeAttr(r.field_key || "")}" /></td>
          <td>
            <select data-k="permission_level">
              ${["hidden", "readonly", "editable"]
                .map((x) => `<option value="${x}" ${r.permission_level === x ? "selected" : ""}>${x}</option>`)
                .join("")}
            </select>
          </td>
          <td><button class="icon-delete-btn" type="button" data-row-delete="${idx}" title="删除" aria-label="删除">🗑</button></td>
        </tr>`;
      }
      if (!isUserEditMode) {
        return `<tr>
        <td>${escapeHtml(String(r.account || ""))}</td>
        <td>${escapeHtml(String(r.user_name || ""))}</td>
        <td>${escapeHtml(String(r.role_code || ""))}</td>
        <td>${escapeHtml(String(r.group_name || ""))}</td>
        <td>${r.is_pl ? "是" : "否"}</td>
      </tr>`;
      }
      return `<tr data-admin-row="${idx}">
        <td><input data-k="account" value="${escapeAttr(r.account || "")}" /></td>
        <td><input data-k="user_name" value="${escapeAttr(r.user_name || "")}" /></td>
        <td>
          <select data-k="role_code">
            <option value="">请选择权限组</option>
            ${Array.from(new Set([...(permissionGroups || []), String(r.role_code || "")].filter(Boolean)))
              .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
              .map((role) => `<option value="${escapeAttr(role)}" ${String(r.role_code || "") === role ? "selected" : ""}>${escapeHtml(role)}</option>`)
              .join("")}
          </select>
        </td>
        <td><input data-k="group_name" value="${escapeAttr(r.group_name || "")}" /></td>
        <td><input data-k="is_pl" type="checkbox" ${r.is_pl ? "checked" : ""} /></td>
        <td><button class="icon-delete-btn" type="button" data-row-delete="${idx}" title="删除" aria-label="删除">🗑</button></td>
      </tr>`;
    })
    .join("");
  return `
    <section class="detail-card detail-card-inline admin-wrap">
      <div class="detail-head">
        <h2>${title}</h2>
        <div class="detail-actions">
          ${
            isPermissions
              ? `${!isPermissionEditMode ? '<button class="action primary" data-admin-toggle-edit>编辑</button>' : ""}
          ${
            isPermissionEditMode
              ? `<button class="action" data-admin-add>新增白名单项</button>
          <button class="action primary" data-admin-save>保存</button>`
              : ""
          }`
              : `${!isUserEditMode ? '<button class="action primary" data-admin-toggle-edit>编辑</button>' : ""}
          ${
            isUserEditMode
              ? `<button class="action" data-admin-add>新增用户行</button>
          <button class="action primary" data-admin-save>保存</button>`
              : ""
          }`
          }
        </div>
      </div>
      <p class="problem-fill-status">${subtitle}</p>
      ${state.adminMsg ? `<p class="problem-fill-status success">${escapeHtml(state.adminMsg)}</p>` : ""}
      ${
        isPermissions
          ? `<div class="admin-subtabs">
        <select data-admin-role-select>
          <option value="">全部角色</option>
          ${Array.from(new Set(allPermissionRows.map((x) => String(x.role_code || "")).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
            .map((role) => `<option value="${escapeAttr(role)}" ${state.adminPermissionRole === role ? "selected" : ""}>${escapeHtml(role)}</option>`)
            .join("")}
        </select>
        <button class="action" type="button" data-admin-role-add>新增角色</button>
      </div>`
          : ""
      }
      <div class="oplog-table-wrap">
        <table class="oplog-table admin-table">
          <thead>${tableHead}</thead>
          <tbody>${body || `<tr><td colspan="${columnCount}">No data</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function filterPermissionRows(rows, filters) {
  const selected = filters.selected || {};
  return rows.filter((r) => {
    const roleOk = (selected.role_code || []).length === 0 || selected.role_code.includes(String(r.role_code || ""));
    const plOk = (selected.is_pl || []).length === 0 || selected.is_pl.includes((r.is_pl ? "是" : "否"));
    const nodeOk = (selected.node_key || []).length === 0 || selected.node_key.includes(String(r.node_key || ""));
    const fieldOk = (selected.field_key || []).length === 0 || selected.field_key.includes(String(r.field_key || ""));
    const permOk = (selected.permission_level || []).length === 0 || selected.permission_level.includes(String(r.permission_level || ""));
    return roleOk && nodeOk && fieldOk && permOk && plOk;
  });
}

function filterUserRows(rows, filters) {
  const selected = filters.selected || {};
  return rows.filter((r) => {
    const accountOk = (selected.account || []).length === 0 || selected.account.includes(String(r.account || ""));
    const nameOk = (selected.user_name || []).length === 0 || selected.user_name.includes(String(r.user_name || ""));
    const roleOk = (selected.role_code || []).length === 0 || selected.role_code.includes(String(r.role_code || ""));
    const groupOk = (selected.group_name || []).length === 0 || selected.group_name.includes(String(r.group_name || ""));
    const plOk = (selected.is_pl || []).length === 0 || selected.is_pl.includes((r.is_pl ? "是" : "否"));
    return accountOk && nameOk && roleOk && groupOk && plOk;
  });
}


function uniqueColumnValues(rows, key) {
  const set = new Set();
  rows.forEach((r) => {
    if (key === "is_pl") set.add(r.is_pl ? "是" : "否");
    else set.add(String(r[key] || ""));
  });
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function renderPermissionFilterHeader(label, key, allRows) {
  const selected = state.adminPermissionFilters.selected[key] || [];
  const values = uniqueColumnValues(allRows, key);
  const isOpen = state.adminPermissionFilters.openKey === key;
  const search = state.adminPermissionFilters.search[key] || "";
  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const allChecked = visibleValues.length > 0 && visibleValues.every((v) => selected.includes(v));
  const active = selected.length > 0 ? "active" : "";
  const options = visibleValues
    .map((v) => `<label class="filter-opt"><input type="checkbox" data-perm-filter-value="${escapeAttr(v)}" ${selected.includes(v) ? "checked" : ""}/> ${escapeHtml(v)}</label>`)
    .join("");
  return `
    <th class="admin-th-filter">
      <span>${label}</span>
      <button type="button" class="filter-icon ${active}" data-perm-filter-open="${key}" title="筛选" aria-label="筛选">⏷</button>
      ${
        isOpen
          ? `<div class="filter-pop">
          <input class="filter-search" type="text" data-perm-filter-search="${key}" placeholder="搜索" value="${escapeAttr(search)}" />
          <label class="filter-opt filter-checkall"><input type="checkbox" data-perm-filter-checkall="${key}" ${allChecked ? "checked" : ""}/> （全选）</label>
          <div class="filter-pop-list">${options || '<div class="filter-empty">无可选值</div>'}</div>
          <div class="filter-pop-actions">
            <button type="button" class="action" data-perm-filter-reset-col="${key}">重置</button>
            <button type="button" class="action primary" data-perm-filter-close>完成</button>
          </div>
        </div>`
          : ""
      }
    </th>
  `;
}

function renderPermissionTableHead(allRows, showActions) {
  return `<tr>
    ${renderPermissionFilterHeader("角色", "role_code", allRows)}
    ${renderPermissionFilterHeader("是否PL", "is_pl", allRows)}
    ${renderPermissionFilterHeader("节点", "node_key", allRows)}
    ${renderPermissionFilterHeader("字段", "field_key", allRows)}
    ${renderPermissionFilterHeader("权限", "permission_level", allRows)}
    ${showActions ? "<th>操作</th>" : ""}
  </tr>`;
}


function renderUserFilterHeader(label, key, allRows) {
  const selected = state.adminUserFilters.selected[key] || [];
  const values = uniqueColumnValues(allRows, key);
  const isOpen = state.adminUserFilters.openKey === key;
  const search = state.adminUserFilters.search[key] || "";
  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const allChecked = visibleValues.length > 0 && visibleValues.every((v) => selected.includes(v));
  const active = selected.length > 0 ? "active" : "";
  const options = visibleValues
    .map((v) => `<label class="filter-opt"><input type="checkbox" data-user-filter-value="${escapeAttr(v)}" ${selected.includes(v) ? "checked" : ""}/> ${escapeHtml(v)}</label>`)
    .join("");
  return `
    <th class="admin-th-filter">
      <span>${label}</span>
      <button type="button" class="filter-icon ${active}" data-user-filter-open="${key}" title="筛选" aria-label="筛选">⏷</button>
      ${
        isOpen
          ? `<div class="filter-pop">
          <input class="filter-search" type="text" data-user-filter-search="${key}" placeholder="搜索" value="${escapeAttr(search)}" />
          <label class="filter-opt filter-checkall"><input type="checkbox" data-user-filter-checkall="${key}" ${allChecked ? "checked" : ""}/> （全选）</label>
          <div class="filter-pop-list">${options || '<div class="filter-empty">无可选值</div>'}</div>
          <div class="filter-pop-actions">
            <button type="button" class="action" data-user-filter-reset-col="${key}">重置</button>
            <button type="button" class="action primary" data-user-filter-close>完成</button>
          </div>
        </div>`
          : ""
      }
    </th>
  `;
}

function renderUserTableHead(filteredRows, allRows, showActions) {
  return `<tr>
    ${renderUserFilterHeader("账号", "account", allRows)}
    ${renderUserFilterHeader("姓名", "user_name", allRows)}
    ${renderUserFilterHeader("角色", "role_code", allRows)}
    ${renderUserFilterHeader("小组", "group_name", allRows)}
    ${renderUserFilterHeader("是否PL", "is_pl", allRows)}
    ${showActions ? "<th>操作</th>" : ""}
  </tr>`;
}

function bindAdminPage() {
  ensureAdminData();
  const isPermissions = state.activeKey === "admin:permissions";
  if (isPermissions) {
    const roleAddBtn = document.querySelector("[data-admin-role-add]");
    const openBtn = document.querySelector("[data-admin-whitelist-open]");
    const cancelBtn = document.querySelector("[data-admin-whitelist-cancel]");
    const saveBtn = document.querySelector("[data-admin-whitelist-save]");
    document.querySelectorAll("[data-admin-role-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-admin-role-view") || "";
        state.adminPermissionRole = role;
        state.adminPermissionDialogOpen = false;
        render();
      });
    });
    if (roleAddBtn) {
      roleAddBtn.addEventListener("click", () => {
        const group = (window.prompt("请输入用户权限组名称") || "").trim();
        if (!group) return;
        state.adminPermissionRole = group;
        state.adminPermissionDialogOpen = true;
        state.adminPermissionDraft = Object.fromEntries(PERMISSION_WHITELIST_ITEMS.map((x) => [x.key, "hidden"]));
        state.adminPermissionScopeDraft = { ticket_list: false, ticket_detail: false };
        render();
      });
    }
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        const group = state.adminPermissionRole || "";
        if (!group) return;
        const rows = state.adminPermissions.filter(
          (x) => String(x.role_code || "") === group && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY
        );
        const draft = {};
        PERMISSION_WHITELIST_ITEMS.forEach((item) => {
          const hit = rows.find((r) => String(r.field_key || "") === item.key);
          draft[item.key] = hit?.permission_level || "hidden";
        });
        state.adminPermissionDraft = draft;
        state.adminPermissionScopeDraft = {
          ticket_list: (rows.find((r) => String(r.field_key || "") === PERMISSION_SCOPE_FIELD_KEYS.ticket_list)?.permission_level || "hidden") === "editable",
          ticket_detail: (rows.find((r) => String(r.field_key || "") === PERMISSION_SCOPE_FIELD_KEYS.ticket_detail)?.permission_level || "hidden") === "editable",
        };
        state.adminPermissionDialogOpen = true;
        render();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        state.adminPermissionDialogOpen = false;
        render();
      });
    }
    document.querySelectorAll("[data-perm-item-key]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.getAttribute("data-perm-item-key");
        if (!key) return;
        state.adminPermissionDraft[key] = el.value || "hidden";
      });
    });
    document.querySelectorAll("[data-perm-scope-key]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.getAttribute("data-perm-scope-key");
        if (!key) return;
        state.adminPermissionScopeDraft[key] = !!el.checked;
      });
    });
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const group = state.adminPermissionRole || "";
        if (!group) return;
        const newRows = PERMISSION_WHITELIST_ITEMS.map((item) => ({
          role_code: group,
          is_pl: false,
          node_key: PERMISSION_WHITELIST_NODE_KEY,
          field_key: item.key,
          permission_level: state.adminPermissionDraft[item.key] || "hidden",
        }));
        newRows.push({
          role_code: group,
          is_pl: false,
          node_key: PERMISSION_WHITELIST_NODE_KEY,
          field_key: PERMISSION_SCOPE_FIELD_KEYS.ticket_list,
          permission_level: state.adminPermissionScopeDraft.ticket_list ? "editable" : "hidden",
        });
        newRows.push({
          role_code: group,
          is_pl: false,
          node_key: PERMISSION_WHITELIST_NODE_KEY,
          field_key: PERMISSION_SCOPE_FIELD_KEYS.ticket_detail,
          permission_level: state.adminPermissionScopeDraft.ticket_detail ? "editable" : "hidden",
        });
        const others = state.adminPermissions.filter(
          (x) => !(String(x.role_code || "") === group && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY)
        );
        const merged = others.concat(newRows);
        const resp = await fetch(`${API_BASE_URL}/api/admin/permissions/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: merged, operator_id: "admin" }),
        });
        if (!resp.ok) {
          state.adminMsg = "保存失败";
          render();
          return;
        }
        state.adminPermissions = merged;
        state.adminPermissionDialogOpen = false;
        state.adminMsg = "保存成功";
        render();
      });
    }
    return;
  }
  const isPermissionEditMode = isPermissions && state.adminPermissionEditMode;
  const isUserEditMode = !isPermissions && state.adminUserEditMode;
  const roleSelect = document.querySelector("[data-admin-role-select]");
  const roleAddBtn = document.querySelector("[data-admin-role-add]");
  if (roleSelect) {
    roleSelect.addEventListener("change", () => {
      state.adminPermissionRole = roleSelect.value || "";
      render();
    });
  }
  if (roleAddBtn) {
    roleAddBtn.addEventListener("click", () => {
      const role = (window.prompt("请输入新角色编码") || "").trim();
      if (!role) return;
      state.adminPermissionRole = role;
      if (!state.adminPermissionEditMode) state.adminPermissionEditMode = true;
      state.adminPermissions.push({
        role_code: role,
        is_pl: false,
        node_key: "",
        field_key: "",
        permission_level: "editable",
      });
      render();
    });
  }
  const toggleEditBtn = document.querySelector("[data-admin-toggle-edit]");
  const addBtn = document.querySelector("[data-admin-add]");
  const saveBtn = document.querySelector("[data-admin-save]");
  if (toggleEditBtn) {
    toggleEditBtn.addEventListener("click", () => {
      if (isPermissions) state.adminPermissionEditMode = !state.adminPermissionEditMode;
      else state.adminUserEditMode = !state.adminUserEditMode;
      render();
    });
  }
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (isPermissions) {
        state.adminPermissions.push({
          role_code: state.adminPermissionRole || "",
          is_pl: false,
          node_key: "",
          field_key: "",
          permission_level: "editable",
        });
      } else {
        state.adminUsers.push({
          account: "",
          user_name: "",
          role_code: "",
          group_name: "",
          is_pl: false,
        });
      }
      render();
    });
  }
  document.querySelectorAll("[data-row-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.getAttribute("data-row-delete"));
      if (!Number.isInteger(idx) || idx < 0) return;
      const baseRows = isPermissions
        ? filterPermissionRows(
          state.adminPermissionRole
            ? state.adminPermissions.filter((x) => String(x.role_code || "") === state.adminPermissionRole)
            : state.adminPermissions,
          state.adminPermissionFilters
        )
        : filterUserRows(state.adminUsers, state.adminUserFilters);
      const row = baseRows[idx];
      if (!row) return;
      if (isPermissions) {
        const qs = new URLSearchParams({
          role_code: String(row.role_code || ""),
          is_pl: String(!!row.is_pl),
          node_key: String(row.node_key || ""),
          field_key: String(row.field_key || ""),
        });
        await fetch(`${API_BASE_URL}/api/admin/permissions?${qs.toString()}`, { method: "DELETE" });
        const pos = state.adminPermissions.findIndex(
          (x) =>
            x.role_code === row.role_code &&
            !!x.is_pl === !!row.is_pl &&
            x.node_key === row.node_key &&
            x.field_key === row.field_key
        );
        if (pos >= 0) state.adminPermissions.splice(pos, 1);
      } else {
        const qs = new URLSearchParams({ account: String(row.account || "") });
        await fetch(`${API_BASE_URL}/api/admin/users?${qs.toString()}`, { method: "DELETE" });
        const pos = state.adminUsers.findIndex((x) => x.account === row.account && x.user_name === row.user_name);
        if (pos >= 0) state.adminUsers.splice(pos, 1);
      }
      render();
    });
  });
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (isPermissions && !isPermissionEditMode) return;
      if (!isPermissions && !isUserEditMode) return;
      const rows = Array.from(document.querySelectorAll("tr[data-admin-row]"));
      const items = rows.map((tr) => {
        const get = (k) => tr.querySelector(`[data-k="${k}"]`);
        if (isPermissions) {
          return {
            role_code: (get("role_code")?.value || "").trim(),
            is_pl: !!get("is_pl")?.checked,
            node_key: (get("node_key")?.value || "").trim(),
            field_key: (get("field_key")?.value || "").trim(),
            permission_level: (get("permission_level")?.value || "editable").trim(),
          };
        }
        return {
          account: (get("account")?.value || "").trim(),
          user_name: (get("user_name")?.value || "").trim(),
          role_code: (get("role_code")?.value || "").trim(),
          group_name: (get("group_name")?.value || "").trim(),
          is_pl: !!get("is_pl")?.checked,
        };
      }).filter((x) => {
        if (isPermissions) return x.role_code && x.node_key && x.field_key;
        return x.account && x.user_name;
      });
      const url = isPermissions ? "/api/admin/permissions/bulk" : "/api/admin/users/bulk";
      const resp = await fetch(`${API_BASE_URL}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, operator_id: "admin" }),
      });
      if (!resp.ok) {
        state.adminMsg = "保存失败";
        render();
        return;
      }
      if (isPermissions) {
        if (state.adminPermissionRole) {
          const otherRoles = state.adminPermissions.filter((x) => String(x.role_code || "") !== state.adminPermissionRole);
          state.adminPermissions = otherRoles.concat(items);
        } else {
          state.adminPermissions = items;
        }
      } else {
        state.adminUsers = items;
      }
      if (isPermissions) state.adminPermissionEditMode = false;
      else state.adminUserEditMode = false;
      state.adminMsg = "保存成功";
      render();
    });
  }
  if (isPermissions) {
    document.querySelectorAll("[data-perm-filter-open]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.getAttribute("data-perm-filter-open");
        if (!key) return;
        state.adminPermissionFilters.openKey = state.adminPermissionFilters.openKey === key ? "" : key;
        render();
      });
    });
    const openKey = state.adminPermissionFilters.openKey;
    if (openKey) {
      document.querySelectorAll("[data-perm-filter-search]").forEach((el) => {
        el.addEventListener("input", () => {
          const key = el.getAttribute("data-perm-filter-search");
          if (!key) return;
          state.adminPermissionFilters.search[key] = el.value || "";
          render();
        });
      });
      document.querySelectorAll("[data-perm-filter-value]").forEach((el) => {
        el.addEventListener("change", () => {
          const value = el.getAttribute("data-perm-filter-value") || "";
          const cur = new Set(state.adminPermissionFilters.selected[openKey] || []);
          if (el.checked) cur.add(value);
          else cur.delete(value);
          state.adminPermissionFilters.selected[openKey] = Array.from(cur);
          render();
        });
      });
      document.querySelectorAll("[data-perm-filter-checkall]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-perm-filter-checkall");
          if (!key) return;
          const all = uniqueColumnValues(state.adminPermissions, key).filter((v) =>
            v.toLowerCase().includes((state.adminPermissionFilters.search[key] || "").toLowerCase())
          );
          const cur = new Set(state.adminPermissionFilters.selected[key] || []);
          if (el.checked) all.forEach((v) => cur.add(v));
          else all.forEach((v) => cur.delete(v));
          state.adminPermissionFilters.selected[key] = Array.from(cur);
          render();
        });
      });
      document.querySelectorAll("[data-perm-filter-reset-col]").forEach((el) => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-perm-filter-reset-col");
          if (!key) return;
          state.adminPermissionFilters.selected[key] = [];
          state.adminPermissionFilters.search[key] = "";
          render();
        });
      });
      document.querySelectorAll("[data-perm-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.adminPermissionFilters.openKey = "";
          render();
        });
      });
    }
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".admin-th-filter")) return;
      if (!state.adminPermissionFilters.openKey) return;
      state.adminPermissionFilters.openKey = "";
      render();
    }, { once: true });
  } else {
    document.querySelectorAll("[data-user-filter-open]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.getAttribute("data-user-filter-open");
        if (!key) return;
        state.adminUserFilters.openKey = state.adminUserFilters.openKey === key ? "" : key;
        render();
      });
    });
    const openKey = state.adminUserFilters.openKey;
    if (openKey) {
      document.querySelectorAll("[data-user-filter-search]").forEach((el) => {
        el.addEventListener("input", () => {
          const key = el.getAttribute("data-user-filter-search");
          if (!key) return;
          state.adminUserFilters.search[key] = el.value || "";
          render();
        });
      });
      document.querySelectorAll("[data-user-filter-value]").forEach((el) => {
        el.addEventListener("change", () => {
          const value = el.getAttribute("data-user-filter-value") || "";
          const cur = new Set(state.adminUserFilters.selected[openKey] || []);
          if (el.checked) cur.add(value);
          else cur.delete(value);
          state.adminUserFilters.selected[openKey] = Array.from(cur);
          render();
        });
      });
      document.querySelectorAll("[data-user-filter-checkall]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-user-filter-checkall");
          if (!key) return;
          const all = uniqueColumnValues(state.adminUsers, key).filter((v) =>
            v.toLowerCase().includes((state.adminUserFilters.search[key] || "").toLowerCase())
          );
          const cur = new Set(state.adminUserFilters.selected[key] || []);
          if (el.checked) {
            all.forEach((v) => cur.add(v));
          } else {
            all.forEach((v) => cur.delete(v));
          }
          state.adminUserFilters.selected[key] = Array.from(cur);
          render();
        });
      });
      document.querySelectorAll("[data-user-filter-reset-col]").forEach((el) => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-user-filter-reset-col");
          if (!key) return;
          state.adminUserFilters.selected[key] = [];
          state.adminUserFilters.search[key] = "";
          render();
        });
      });
      document.querySelectorAll("[data-user-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.adminUserFilters.openKey = "";
          render();
        });
      });
    }
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".admin-th-filter")) return;
      if (!state.adminUserFilters.openKey) return;
      state.adminUserFilters.openKey = "";
      render();
    }, { once: true });
    const anySelected = Object.values(state.adminUserFilters.selected).some((arr) => (arr || []).length > 0);
    const resetAll = document.querySelector("[data-user-filter-reset-all]");
    if (resetAll && anySelected) {
      resetAll.addEventListener("click", () => {
        state.adminUserFilters.selected = {
          account: [],
          user_name: [],
          role_code: [],
          group_name: [],
          is_pl: [],
        };
        render();
      });
    }
  }
}

function createTicketFromOpsAnalysis() {
  debugLog("ticket.create.click");
  const operator = getCurrentOperator();
  const orderId = makeNewTicketId();
  state.createTicketId = orderId;
  state.createModalOpen = true;
  workflowByOrderId[orderId] = {
    currentStep: WORKFLOW_NODES.indexOf("运维分析"),
    logs: [
      { step: "运维分析", actor: operator.userName, at: nowText(), summary: "创建工单并从运维分析节点开始。" },
    ],
  };
  operationLogsByOrderId[orderId] = [];
  ensureNodeFormData(orderId, "ops_analysis");
  render();
  debugLog("ticket.create.modal_open", { orderId });
}

function bindGlobalFallbackClicks() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const closeTarget = target.closest("[data-close-tab]");
    if (closeTarget) {
      event.preventDefault();
      event.stopPropagation();
      const key = closeTarget.getAttribute("data-close-tab");
      if (!key) return;
      state.openTabs = state.openTabs.filter((tab) => tab.key !== key);
      if (state.activeKey === key) {
        state.activeKey = state.openTabs[state.openTabs.length - 1].key;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
      return;
    }

    const tabTarget = target.closest("[data-workspace-tab]");
    if (tabTarget) {
      debugLog("workspace.tab.click", { key: tabTarget.getAttribute("data-workspace-tab") || "" });
      event.preventDefault();
      event.stopPropagation();
      const key = tabTarget.getAttribute("data-workspace-tab");
      if (!key) return;
      const prevWsKey = state.activeKey;
      state.activeKey = key;
      if (key === "leave:application") state.leaveNeedsRefresh = true;
      if (key === "params:duty-field" && prevWsKey !== "params:duty-field") {
        state.dutyFieldNeedsRefresh = true;
        state.dutyFieldEditMode = false;
      }
      if (key === "params:version" && prevWsKey !== "params:version") state.versionNeedsRefresh = true;
      if (key === "params:group-template" && prevWsKey !== "params:group-template") {
        state.groupTemplateNeedsRefresh = true;
        state.groupTemplateEditMode = false;
        state.groupTemplateDraft = null;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
      return;
    }

    const dutySpecialToggle = target.closest("[data-duty-special-toggle]");
    if (dutySpecialToggle) {
      event.preventDefault();
      event.stopPropagation();
      const group = dutySpecialToggle.closest(".menu-submenu-special-group");
      const nested = group?.querySelector(".menu-submenu-nested-wrap");
      if (!nested) return;
      const nextOpen = nested.hidden;
      nested.hidden = !nextOpen;
      state.dutySpecialSubmenuExpanded = nextOpen;
      dutySpecialToggle.setAttribute("aria-expanded", String(nextOpen));
      dutySpecialToggle.textContent = nextOpen ? "▾" : "▸";
      return;
    }

    const dutyAnchorTarget = target.closest("[data-duty-anchor]");
    if (dutyAnchorTarget) {
      event.preventDefault();
      event.stopPropagation();
      const id = dutyAnchorTarget.getAttribute("data-duty-anchor") || "";
      if (!id || !dutyRosterAnchorValid(id)) return;
      ensureDutyTab();
      state.activeKey = "duty:roster";
      history.pushState({}, "", `/duty-roster#${id}`);
      state.dutySuppressMainScrollRestore = true;
      render();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      return;
    }

    const navTarget = target.closest("[data-nav-key]");
    if (navTarget) {
      debugLog("nav.click", { key: navTarget.getAttribute("data-nav-key") || "" });
      event.preventDefault();
      event.stopPropagation();
      const key = navTarget.getAttribute("data-nav-key");
      if (!key) return;
      const prevNavKey2 = state.activeKey;
      if (key.startsWith("admin:")) ensureAdminTab(key.split(":")[1]);
      if (key === "duty:roster") ensureDutyTab();
      if (key.startsWith("params:")) ensureParamsTab(key.slice("params:".length));
      if (key === "leave:application") {
        ensureLeaveTab();
        state.leaveNeedsRefresh = true;
      }
      state.activeKey = key;
      if (key === "params:duty-field" && prevNavKey2 !== "params:duty-field") {
        state.dutyFieldNeedsRefresh = true;
        state.dutyFieldEditMode = false;
      }
      if (key === "params:version" && prevNavKey2 !== "params:version") state.versionNeedsRefresh = true;
      if (key === "params:group-template" && prevNavKey2 !== "params:group-template") {
        state.groupTemplateNeedsRefresh = true;
        state.groupTemplateEditMode = false;
        state.groupTemplateDraft = null;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
      return;
    }

    const createBtn = target.closest("#create-ticket-btn");
    if (createBtn) {
      debugLog("create.button.click");
      event.preventDefault();
      event.stopPropagation();
      createTicketFromOpsAnalysis();
      return;
    }

    const submitActionBtn = target.closest("[data-action-submit]");
    if (submitActionBtn) {
      event.preventDefault();
      event.stopPropagation();
      const form = submitActionBtn.closest("form");
      debugLog("node.submit.button_click", {
        hasForm: !!form,
        formId: form?.id || "",
        formBound: form?.dataset?.bound || "0",
        nodeKey: form?.getAttribute("data-node-key") || "",
      });
      if (form && typeof form.requestSubmit === "function") {
        form.dataset.flowSubmitPending = "1";
        form.requestSubmit(submitActionBtn);
      } else if (form) {
        form.dataset.flowSubmitPending = "1";
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return;
    }

    const deleteBtn = target.closest("#delete-ticket-btn");
    if (deleteBtn) {
      event.preventDefault();
      event.stopPropagation();
      const selected = new Set(state.selectedTicketIds);
      if (selected.size === 0) {
        window.alert("请先选中要删除的工单");
        return;
      }
      ticketList.splice(0, ticketList.length, ...ticketList.filter((t) => !selected.has(String(t.orderId || ""))));
      state.selectedTicketIds.forEach((orderId) => {
        delete workflowByOrderId[orderId];
        delete operationLogsByOrderId[orderId];
        delete state.ticketStatusByOrderId[orderId];
        Object.keys(state.formsByTicket).forEach((k) => {
          if (k.startsWith(`${orderId}:`)) delete state.formsByTicket[k];
        });
      });
      state.openTabs = state.openTabs.filter((tab) => {
        if (!tab.key.startsWith("ticket:")) return true;
        const id = tab.key.replace("ticket:", "");
        return !selected.has(id);
      });
      if (!state.openTabs.some((t) => t.key === state.activeKey)) state.activeKey = "list";
      state.selectedTicketIds = [];
      render();
    }
  }, true);
}

function bootstrap() {
  syncActiveKeyFromPath(window.location.pathname);
  bindGlobalErrorLogs();
  debugLog("bootstrap.start", { path: window.location.pathname });
  bindGlobalFallbackClicks();
  ensureAdminData();
  render();
  syncTicketsFromServer().then(() => render());
  window.addEventListener("popstate", () => {
    syncActiveKeyFromPath(window.location.pathname);
    render();
  });
  window.addEventListener("hashchange", () => {
    if (!/\/params\/version\/?$/.test(window.location.pathname)) return;
    const h = String(window.location.hash || "").replace(/^#/, "");
    if (h === "hotfix" || h === "baseline") {
      state.versionSubTab = h;
      render();
    }
  });
  window.addEventListener("resize", () => {
    const tabsWrap = document.querySelector(".tabs");
    const target = document.querySelector(".tabs .tab.active");
    if (!tabsWrap || !target) return;
    const m = tabIndicatorMetrics(tabsWrap, target);
    tabsWrap.style.setProperty("--indicator-x", `${m.x}px`);
    tabsWrap.style.setProperty("--indicator-y", `${m.y}px`);
    tabsWrap.style.setProperty("--indicator-w", `${m.w}px`);
    tabsWrap.style.setProperty("--indicator-h", `${m.h}px`);
  });
}

function renderWorkflow(orderId) {
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  const ticket = getTicketById(orderId);
  const inferStepFromTicket = () => {
    const node = String(ticket?.node || "").trim();
    if (!node) return -1;
    if (WORKFLOW_NODES.includes(node)) return WORKFLOW_NODES.indexOf(node);
    const byKey = STEP_BY_NODE_KEY[node.toLowerCase()] || STEP_BY_NODE_KEY[node];
    if (byKey && WORKFLOW_NODES.includes(byKey)) return WORKFLOW_NODES.indexOf(byKey);
    return -1;
  };
  const inferredIndex = inferStepFromTicket();
  const effectiveCurrentStep = inferredIndex >= 0 ? inferredIndex : workflow.currentStep;
  const logsByStep = new Map(workflow.logs.map((log) => [log.step, log]));
  const firstStep = workflow.logs[0]?.step || "";
  const firstStepIndex = WORKFLOW_NODES.indexOf(firstStep);
  const isCreatedFromOps = String(orderId || "").startsWith("N");
  const startIndex = firstStepIndex >= 0 ? firstStepIndex : (isCreatedFromOps ? WORKFLOW_NODES.indexOf("运维分析") : 0);
  const ticketStatus = String(ticket?.status || state.ticketStatusByOrderId[orderId] || "open").toLowerCase();
  const isClosed = ticketStatus === "closed";
  const currentStepLabel = WORKFLOW_NODES[effectiveCurrentStep] || "";
  const visitedSteps = new Set(workflow.logs.map((log) => String(log.step || "")).filter(Boolean));
  const opLogs = operationLogsByOrderId[orderId] || [];
  const latestMetaByStep = new Map();
  opLogs.forEach((log) => {
    const from = String(log.from || "");
    const to = String(log.to || "");
    if (from) visitedSteps.add(from);
    if (to) visitedSteps.add(to);
    if (from) latestMetaByStep.set(from, { actor: String(log.actor || "-"), at: String(log.at || "") });
    if (to) latestMetaByStep.set(to, { actor: String(log.actor || "-"), at: String(log.at || "") });
  });
  if (currentStepLabel) visitedSteps.add(currentStepLabel);
  const operator = getCurrentOperator();
  const assignee = String(ticket?.assignee || "");
  const isCurrentHandler =
    assignee === operator.userName ||
    assignee === operator.account ||
    assignee.includes(operator.account) ||
    assignee.includes(operator.userName);
  const whitelist = getCurrentWhitelistSettings();
  const onlyProblemFill = whitelist[PERMISSION_SCOPE_FIELD_KEYS.ticket_detail] === "editable";
  const nodeBar = WORKFLOW_NODES.map((step, index) => {
    if (index < startIndex) return "";
    let stateClass = "upcoming";
    if (!isClosed && index === effectiveCurrentStep) stateClass = "current";
    else if (visitedSteps.has(step)) stateClass = "passed";
    return `<li class="flow-node ${stateClass}">
      <span class="flow-dot"></span>
      <span class="flow-label">${step}</span>
    </li>`;
  })
    .filter(Boolean)
    .join("");

  const logs = WORKFLOW_NODES.map((step, index) => {
    if (onlyProblemFill && NODE_KEY_BY_STEP[step] !== "problem_fill") return "";
    if (index < startIndex) return "";
    if (!visitedSteps.has(step)) return "";
    const isCurrent = !isClosed && index === effectiveCurrentStep;
    const log = logsByStep.get(step);
    const latestMeta = latestMetaByStep.get(step);
    const nodeKey = NODE_KEY_BY_STEP[step];
    let formBody = "";
    if (nodeKey) {
      const editable = isCurrent && isCurrentHandler;
      ensureNodeFormData(orderId, nodeKey);
      formBody = renderNodeForm(orderId, nodeKey, { editable });
    }
    const formState = nodeKey ? getFormState(orderId, nodeKey) : null;
    let body = formBody;
    if (!body) {
      if (formState?.notFound && formState.loaded) {
        body = log ? log.summary : `<p class="problem-fill-status">该节点暂无表单定义。</p>`;
      } else if (!formState?.loading && !formState?.failed) {
        body = log ? log.summary : "暂无处理内容。";
      }
    }
    const open = isCurrent && isCurrentHandler ? "open" : "";
    const metaText = log
      ? `${log.actor} · ${log.at}`
      : latestMeta
        ? `${latestMeta.actor} · ${latestMeta.at}`
        : "暂无记录";
    return `
      <details class="flow-log" ${open}>
        <summary>
          <span>${step}</span>
          <span class="flow-log-meta">${metaText}</span>
        </summary>
        <div class="flow-log-body">${body}</div>
      </details>
    `;
  })
    .filter(Boolean)
    .join("");

  return `
    <section class="flow-wrap flow-wrap-full">
      <ol class="flow-bar">${nodeBar}</ol>
      <div class="flow-logs">
        ${logs}
      </div>
    </section>
  `;
}

function resolveNextNodeKey(nodeKey, handleMode) {
  const mode = String(handleMode || "").trim();
  if (mode === "问题解决关闭" || mode === "非问题关闭") return nodeKey;
  if (mode.startsWith("提交其他")) return nodeKey;
  if (nodeKey === "problem_fill") return "problem_review";
  const routeMap = HANDLE_MODE_ROUTE[nodeKey] || {};
  return routeMap[mode] || null;
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function advanceWorkflow(orderId, fromNodeKey, toNodeKey, handleMode) {
  const workflow = workflowByOrderId[orderId];
  if (!workflow) return;
  const fromStep = STEP_BY_NODE_KEY[fromNodeKey];
  const toStep = STEP_BY_NODE_KEY[toNodeKey];
  if (!fromStep || !toStep) return;
  const fromIndex = WORKFLOW_NODES.indexOf(fromStep);
  const toIndex = WORKFLOW_NODES.indexOf(toStep);
  if (toIndex < 0) return;
  const moveLabel = toIndex === fromIndex ? "本节点" : (toIndex > fromIndex ? "下一节点" : "回退节点");

  workflow.currentStep = toIndex;
  const at = nowText();
  const operator = getCurrentOperator();
  workflow.logs.push({
    step: fromStep,
    actor: operator.userName,
    at,
    summary: handleMode ? `处理方式：${handleMode}，${moveLabel}至 ${toStep}。` : `${moveLabel}至 ${toStep}。`,
  });

  const logs = operationLogsByOrderId[orderId] || [];
  logs.push({
    at,
    actor: operator.userName,
    action: moveLabel,
    from: fromStep,
    to: toStep,
  });
  operationLogsByOrderId[orderId] = logs;
  if (handleMode === "问题解决关闭" || handleMode === "非问题关闭") {
    state.ticketStatusByOrderId[orderId] = "closed";
  } else if (!state.ticketStatusByOrderId[orderId]) {
    state.ticketStatusByOrderId[orderId] = "open";
  }
  render();
}

function renderOperationLogs(orderId) {
  const logs = operationLogsByOrderId[orderId] || [];
  const drawerClass = state.logDrawerOpen ? "open" : "";
  const rows = logs
    .map(
      (log) => `
      <tr>
        <td>${log.at}</td>
        <td>${log.actor}</td>
        <td>${log.action}</td>
        <td>${log.from}</td>
        <td>${log.to}</td>
      </tr>
    `
    )
    .join("");
  return `
    <aside class="oplog-drawer ${drawerClass}">
      <div class="oplog-panel">
        <div class="oplog-head">
          <div class="oplog-title">log</div>
          <button class="oplog-close" id="close-log-drawer-btn" type="button">×</button>
        </div>
        <div class="oplog-table-wrap">
        <table class="oplog-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th>来源节点</th>
              <th>目标节点</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5">No logs</td></tr>`}
          </tbody>
        </table>
        </div>
      </div>
    </aside>
  `;
}

/** 与后端 `_DUTY_FIELD_PATH_SEP`、`_normalize_duty_path_value` 一致：隐藏域提交值为 a/b/c */
const DUTY_FIELD_CASCADE_SEP = "/";

function normalizeDutyCascadeValue(raw) {
  return String(raw || "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

function splitDutyFieldCascadePath(raw) {
  return String(raw || "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cascadeReadTreeFromWrap(wrap) {
  const el = wrap.querySelector("script.cascade-tree-data");
  if (!el || !el.textContent) return [];
  try {
    return JSON.parse(el.textContent);
  } catch (_e) {
    return [];
  }
}

function dutyCascaderColumnsData(tree, tempPath) {
  const columns = [];
  let cur = Array.isArray(tree) ? tree : [];
  let d = 0;
  for (;;) {
    if (!cur.length) break;
    columns.push({ depth: d, list: cur, activeLabel: tempPath[d] ?? null });
    const label = tempPath[d];
    if (label == null || label === "") break;
    const node = cur.find((n) => String(n.label || "").trim() === label);
    if (!node || !Array.isArray(node.children) || !node.children.length) break;
    cur = node.children;
    d++;
  }
  return columns;
}

function dutyCascaderColumnHtml(depth, nodes, activeLabel) {
  const items = (nodes || [])
    .map((node) => {
      const lab = String(node.label || "").trim();
      if (!lab) return "";
      const ch = Array.isArray(node.children) && node.children.length > 0;
      const active = lab === activeLabel ? " is-active" : "";
      const arrow = ch ? '<span class="cascade-cascader-arrow" aria-hidden="true">▸</span>' : "";
      return `<button type="button" class="cascade-cascader-item${active}" data-depth="${depth}" data-label="${escapeAttr(lab)}" data-has-children="${ch ? "1" : "0"}">${escapeHtml(lab)}${arrow}</button>`;
    })
    .filter(Boolean)
    .join("");
  return `<div class="cascade-cascader-col" role="listbox" data-col-depth="${depth}">${items}</div>`;
}

function dutyCascaderRenderPanel(wrap) {
  const tree = cascadeReadTreeFromWrap(wrap);
  const colsEl = wrap.querySelector("[data-cascade-columns]");
  const preview = wrap.querySelector(".cascade-cascader-preview");
  const panel = wrap.querySelector(".cascade-cascader-panel");
  if (!colsEl) return;
  let path = [];
  try {
    path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
  } catch (_e) {
    path = [];
  }
  if (!Array.isArray(tree) || !tree.length) {
    colsEl.innerHTML = `<div class="cascade-cascader-empty">${escapeHtml("暂无选项，请先在责任田模块维护")}</div>`;
    if (preview) preview.textContent = "";
    if (panel && !panel.hidden && panel.classList.contains("is-open")) {
      requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
    }
    return;
  }
  const columns = dutyCascaderColumnsData(tree, path);
  colsEl.innerHTML = columns.map((col) => dutyCascaderColumnHtml(col.depth, col.list, col.activeLabel)).join("");
  if (preview) {
    const p = path.filter((x) => String(x || "").trim());
    preview.textContent = p.length ? p.join(DUTY_FIELD_CASCADE_SEP) : "";
  }
  if (panel && !panel.hidden && panel.classList.contains("is-open")) {
    requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
  }
}

function dutyCascaderClearPanelStyles(panel) {
  if (!panel) return;
  ["position", "left", "top", "right", "bottom", "width", "minWidth", "maxWidth", "maxHeight", "zIndex"].forEach((k) => {
    panel.style[k] = "";
  });
}

let dutyCascaderOpenWrap = null;
let dutyCascaderGeomListenersBound = false;

function dutyCascaderEnsureGeomListeners() {
  if (dutyCascaderGeomListenersBound) return;
  dutyCascaderGeomListenersBound = true;
  const repo = () => {
    if (dutyCascaderOpenWrap) dutyCascaderPositionPanel(dutyCascaderOpenWrap);
  };
  window.addEventListener("scroll", repo, true);
  window.addEventListener("resize", repo);
}

function dutyCascaderSetOpenWrap(wrap) {
  dutyCascaderOpenWrap = wrap;
  dutyCascaderEnsureGeomListeners();
}

function dutyCascaderClearOpenWrap(wrap) {
  if (dutyCascaderOpenWrap === wrap) dutyCascaderOpenWrap = null;
}

/** 面板 fixed；宽度随列数收缩（由 CSS width:max-content），仅限制上限并在贴边时左移 */
function dutyCascaderPositionPanel(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  if (!panel || !trig || panel.hidden || !panel.classList.contains("is-open")) return;
  const r = trig.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cap = Math.min(560, vw - margin * 2);
  panel.style.position = "fixed";
  panel.style.width = "";
  panel.style.maxWidth = `${cap}px`;
  panel.style.minWidth = `${Math.min(280, Math.max(96, Math.ceil(r.width)))}px`;
  panel.style.left = `${Math.max(margin, r.left)}px`;
  panel.style.top = `${r.bottom + 4}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.zIndex = "10050";
  panel.style.maxHeight = `${Math.max(160, vh - r.bottom - margin * 2)}px`;

  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    if (pr.right > vw - margin) {
      panel.style.left = `${Math.max(margin, vw - margin - pr.width)}px`;
    }
    if (pr.bottom > vh - margin) {
      const above = r.top - margin - pr.height;
      if (above >= margin) {
        panel.style.top = `${above}px`;
        panel.style.maxHeight = `${Math.max(160, r.top - margin * 2)}px`;
      }
    }
  });
}

function dutyCascaderSyncTrigger(wrap) {
  const h = wrap.querySelector("[data-cascade-hidden]");
  const labelEl = wrap.querySelector(".cascade-cascader-label");
  if (!h || !labelEl) return;
  const v = normalizeDutyCascadeValue(h.value);
  labelEl.textContent = v || "请选择";
  labelEl.classList.toggle("is-placeholder", !v);
}

function dutyCascaderClose(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  dutyCascaderClearOpenWrap(wrap);
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("is-open");
    dutyCascaderClearPanelStyles(panel);
  }
  if (trig) trig.setAttribute("aria-expanded", "false");
}

function dutyCascaderCommit(wrap, pathParts) {
  const parts = pathParts.map((p) => String(p || "").trim()).filter(Boolean);
  const hidden = wrap.querySelector("[data-cascade-hidden]");
  if (!hidden) return;
  hidden.value = parts.join(DUTY_FIELD_CASCADE_SEP);
  dutyCascaderSyncTrigger(wrap);
  dutyCascaderClose(wrap);
  delete wrap.dataset.cascadeNavPath;
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function dutyCascaderConfirmCurrent(wrap) {
  let path = [];
  try {
    path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
  } catch (_e) {
    path = [];
  }
  const parts = path.map((p) => String(p || "").trim()).filter(Boolean);
  if (!parts.length) return;
  dutyCascaderCommit(wrap, parts);
}

function dutyCascaderToggle(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  if (!panel || !trig) return;
  const isOpen = !panel.hidden && panel.classList.contains("is-open");
  if (isOpen) {
    dutyCascaderClose(wrap);
    return;
  }
  document.querySelectorAll(".cascade-cascader").forEach((w) => {
    if (w !== wrap) dutyCascaderClose(w);
  });
  const hidden = wrap.querySelector("[data-cascade-hidden]");
  wrap.dataset.cascadeNavPath = JSON.stringify(splitDutyFieldCascadePath(hidden?.value || ""));
  dutyCascaderSetOpenWrap(wrap);
  dutyCascaderRenderPanel(wrap);
  panel.hidden = false;
  panel.classList.add("is-open");
  trig.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    dutyCascaderPositionPanel(wrap);
    requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
  });
}

let dutyCascaderDocumentBound = false;
function ensureDutyCascaderDocumentClose() {
  if (dutyCascaderDocumentBound) return;
  dutyCascaderDocumentBound = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const inside = e.target.closest(".cascade-cascader");
      document.querySelectorAll(".cascade-cascader").forEach((w) => {
        if (inside !== w) dutyCascaderClose(w);
      });
    },
    true,
  );
}

function bindDutyFieldCascader(form) {
  ensureDutyCascaderDocumentClose();
  if (form.dataset.dutyCascaderFormBound === "1") return;
  form.dataset.dutyCascaderFormBound = "1";
  form.addEventListener("click", (ev) => {
    const trig = ev.target.closest(".cascade-cascader-trigger");
    if (trig && form.contains(trig)) {
      ev.preventDefault();
      dutyCascaderToggle(trig.closest(".cascade-cascader"));
      return;
    }
    const ok = ev.target.closest(".cascade-cascader-confirm");
    if (ok && form.contains(ok)) {
      const wrap = ok.closest(".cascade-cascader");
      if (wrap && form.contains(wrap)) dutyCascaderConfirmCurrent(wrap);
      return;
    }
    const item = ev.target.closest(".cascade-cascader-item");
    if (!item || !form.contains(item)) return;
    const wrap = item.closest(".cascade-cascader");
    if (!wrap || !form.contains(wrap)) return;
    const depth = Number(item.getAttribute("data-depth"));
    if (Number.isNaN(depth)) return;
    const label = item.getAttribute("data-label") || "";
    const hasChildren = item.getAttribute("data-has-children") === "1";
    let path = [];
    try {
      path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
    } catch (_e) {
      path = [];
    }
    const newPath = path.slice(0, depth).concat([label]);
    wrap.dataset.cascadeNavPath = JSON.stringify(newPath);
    if (!hasChildren) {
      dutyCascaderCommit(wrap, newPath);
    } else {
      dutyCascaderRenderPanel(wrap);
    }
  });
  /** 与左侧导航子菜单一致：悬停带子项的行即展开右侧下一列（触控仍可用点击） */
  form.addEventListener("mouseover", (ev) => {
    const item = ev.target.closest(".cascade-cascader-item");
    if (!item || !form.contains(item)) return;
    const wrap = item.closest(".cascade-cascader");
    if (!wrap || !form.contains(wrap)) return;
    const panel = wrap.querySelector(".cascade-cascader-panel");
    if (!panel || panel.hidden || !panel.classList.contains("is-open")) return;
    if (item.getAttribute("data-has-children") !== "1") return;
    const depth = Number(item.getAttribute("data-depth"));
    if (Number.isNaN(depth)) return;
    const label = item.getAttribute("data-label") || "";
    const newPath = (() => {
      let path = [];
      try {
        path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
      } catch (_e) {
        path = [];
      }
      return path.slice(0, depth).concat([label]);
    })();
    const nextStr = JSON.stringify(newPath);
    if ((wrap.dataset.cascadeNavPath || "[]") === nextStr) return;
    wrap.dataset.cascadeNavPath = nextStr;
    dutyCascaderRenderPanel(wrap);
  });
}

function renderCascadeWhitelistControl(field, value, editable = true) {
  const viewOnly = !!(field.readonly || !editable);
  const keyEsc = escapeAttr(field.key);
  const norm = normalizeDutyCascadeValue(value);
  const tree = field.cascade_options;

  if (viewOnly) {
    return `<div class="cascade-select cascade-cascader cascade-select--readonly" data-cascade-field="${keyEsc}">
      <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(norm)}" data-cascade-hidden />
      <span class="cascade-readonly-text">${escapeHtml(norm || "—")}</span>
    </div>`;
  }

  const jsonRaw = JSON.stringify(tree != null ? tree : []).replace(/</g, "\\u003c");
  const jsonEsc = escapeHtml(jsonRaw);
  const phCls = norm ? "cascade-cascader-label" : "cascade-cascader-label is-placeholder";
  return `<div class="cascade-select cascade-cascader" data-cascade-field="${keyEsc}">
    <script type="application/json" class="cascade-tree-data">${jsonEsc}</script>
    <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(norm)}" data-cascade-hidden />
    <div class="cascade-cascader-inner">
      <button type="button" class="cascade-cascader-trigger" aria-expanded="false" aria-haspopup="true">
        <span class="${phCls}">${escapeHtml(norm || "请选择")}</span>
        <span class="cascade-cascader-caret" aria-hidden="true">▾</span>
      </button>
      <div class="cascade-cascader-panel" hidden>
        <div class="cascade-cascader-columns" data-cascade-columns></div>
        <div class="cascade-cascader-footer">
          <span class="cascade-cascader-preview"></span>
          <button type="button" class="cascade-cascader-confirm">${escapeHtml("确定")}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderNodeForm(orderId, nodeKey, options = {}) {
  const editable = options.editable !== false;
  const formState = getFormState(orderId, nodeKey);
  if (formState.notFound) return "";
  if (formState.loading && !formState.loaded) {
    return `
      <section class="problem-fill-wrap">
        <p class="problem-fill-status">正在加载字段...</p>
      </section>
    `;
  }

  if (formState.error && !formState.loaded) {
    return `
      <section class="problem-fill-wrap">
        <p class="problem-fill-status error">加载失败：${escapeHtml(formState.error)}</p>
      </section>
    `;
  }

  const fields = [...(formState.fields || [])].sort((a, b) => {
    const ar = a.type === "richtext" ? 1 : 0;
    const br = b.type === "richtext" ? 1 : 0;
    return ar - br;
  });
  const fieldRows = fields
    .map((field) => {
      if (!editable && (field.key === "handle_mode" || field.key === "next_handler")) {
        return "";
      }
      const value = getInitialFieldValue(field, formState.values || {});
      const readonly = field.readonly || !editable ? "readonly" : "";
      const c = field.constraints || {};
      const showMarkSlot =
        field.required ||
        !!(
          c.required_when_visible ||
          (c.required_if && typeof c.required_if === "object" && Object.keys(c.required_if).length)
        );
      const requiredMark = showMarkSlot ? `<span class="required-mark">*</span>` : "";
      let control = `<input type="text" name="${field.key}" value="${escapeAttr(value)}" ${readonly} />`;
      const fieldCls = field.type === "richtext" ? "problem-field problem-field-rich" : "problem-field";

      if (field.type === "date") {
        control = `<input type="date" name="${field.key}" value="${escapeAttr(value)}" ${readonly} ${!editable ? "disabled" : ""} />`;
      } else if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
        control = renderCascadeWhitelistControl(field, value, editable);
      } else if (field.type === "whitelist") {
        const rawOptions = Array.isArray(field.options) ? field.options : [];
        let options = rawOptions.length > 0 ? rawOptions : ["temp"];
        if (field.key === "handle_mode") {
          const routeMap = HANDLE_MODE_ROUTE[nodeKey] || {};
          const allowedModes = Object.keys(routeMap);
          if (allowedModes.length > 0) {
            options = options.filter((item) => allowedModes.includes(item));
          }
        }
        const usePlaceholder = !WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key);
        const placeholderOpt = usePlaceholder
          ? `<option value="" ${value === "" ? "selected" : ""}></option>`
          : "";
        const optionHtml = options
          .map((item) => `<option value="${escapeAttr(item)}" ${item === value ? "selected" : ""}>${escapeHtml(item)}</option>`)
          .join("");
        control = `<select name="${field.key}" ${readonly} ${!editable ? "disabled" : ""}>${placeholderOpt}${optionHtml}</select>`;
      } else if (field.type === "richtext") {
        const disabled = field.readonly || !editable ? "disabled" : "";
        const editorId = `rt-${orderId}-${nodeKey}-${field.key}`;
        control = `
          <div class="rich-editor" data-rich-editor data-editor-id="${editorId}" data-disabled="${field.readonly ? "1" : "0"}">
            <div class="rich-toolbar">
              <button type="button" data-cmd="bold" ${disabled}>B</button>
              <button type="button" data-cmd="italic" ${disabled}>I</button>
              <button type="button" data-cmd="underline" ${disabled}>U</button>
              <button type="button" data-cmd="insertUnorderedList" ${disabled}>• List</button>
              <button type="button" data-cmd="insertOrderedList" ${disabled}>1. List</button>
              <button type="button" data-cmd="formatBlock" data-cmd-value="h3" ${disabled}>H3</button>
              <label class="img-upload ${field.readonly ? "disabled" : ""}">
                图片
                <input type="file" accept="image/*" data-image-input ${disabled} />
              </label>
            </div>
            <div
              class="rich-content"
              id="${editorId}"
              contenteditable="${field.readonly || !editable ? "false" : "true"}"
              data-placeholder="请输入问题描述..."
            >${value || ""}</div>
            <input type="hidden" name="${field.key}" value="${escapeAttr(value)}" data-rich-hidden />
          </div>
        `;
      } else if (!editable) {
        control = `<input type="text" name="${field.key}" value="${escapeAttr(value)}" readonly disabled />`;
      }

      return `
        <div class="${fieldCls} ${editable ? "" : "problem-field-inline"}" data-field-key="${escapeAttr(field.key)}">
          <label>${escapeHtml(field.label)}${requiredMark}</label>
          ${editable ? control : renderReadOnlyFieldValue(field, value)}
        </div>
      `;
    })
    .filter(Boolean)
    .join("");

  const message = formState.error
    ? `<p class="problem-fill-status error">${escapeHtml(formState.error)}</p>`
    : formState.success
      ? `<p class="problem-fill-status success">${escapeHtml(formState.success)}</p>`
      : "";

  return `
    <section class="problem-fill-wrap">
      ${message}
      <form id="node-form-${orderId}-${nodeKey}" ${editable ? `data-node-form="1" data-node-key="${escapeAttr(nodeKey)}" data-order-id="${escapeAttr(orderId)}"` : ""}>
        <div class="problem-fill-grid">
          ${fieldRows || `<p class="problem-fill-status">当前无字段配置</p>`}
        </div>
        ${
          editable
            ? `<div class="problem-fill-actions">
          <button class="action primary" type="submit" ${formState.saving ? "disabled" : ""}>
            ${formState.saving ? "保存中..." : "保存"}
          </button>
          <button class="action" type="submit" data-action-submit ${formState.saving ? "disabled" : ""}>提交</button>
        </div>`
            : ""
        }
      </form>
    </section>
  `;
}

function renderReadOnlyFieldValue(field, value) {
  if (field.type === "richtext") {
    return `<div class="readonly-value readonly-rich">${value || '<span class="readonly-empty">-</span>'}</div>`;
  }
  const text = String(value || "").trim();
  return `<div class="readonly-value">${text ? escapeHtml(text) : '<span class="readonly-empty">-</span>'}</div>`;
}

function getInitialFieldValue(field, savedValues) {
  if (savedValues && savedValues[field.key] != null) {
    return String(savedValues[field.key]);
  }
  if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
    if (TEMP_AUTO_FILL_ALL_FIELDS) {
      const flat = Array.isArray(field.options) ? field.options : [];
      if (flat.length > 0) return String(flat[0]);
      const tr = field.cascade_options;
      if (Array.isArray(tr) && tr.length) {
        const first = String(tr[0].label || "").trim();
        if (first) return first;
      }
    }
    return "";
  }
  if (TEMP_AUTO_FILL_ALL_FIELDS) {
    if (field.type === "date") {
      return new Date().toISOString().slice(0, 10);
    }
    if (field.type === "datetime") {
      return new Date().toISOString().slice(0, 16);
    }
    if (field.type === "whitelist") {
      const options = Array.isArray(field.options) && field.options.length > 0 ? field.options : ["temp"];
      return String(options[0] || "temp");
    }
    if (field.default_type === "login_user") {
      const operator = getCurrentOperator();
      return `${operator.account} ${operator.userName}`;
    }
    if (typeof field.default_value === "string" && field.default_value.trim() !== "") {
      return field.default_value;
    }
    return "temp";
  }
  if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
    const flat = Array.isArray(field.options) ? field.options : [];
    if (WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key) && flat.length > 0) return String(flat[0]);
    return "";
  }
  if (field.type === "whitelist") {
    const options = Array.isArray(field.options) && field.options.length > 0 ? field.options : ["temp"];
    if (WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key) && options.length > 0) {
      return String(options[0]);
    }
    return "";
  }
  if (field.default_type === "today") {
    return new Date().toISOString().slice(0, 10);
  }
  if (field.default_type === "login_user") {
    const operator = getCurrentOperator();
    return `${operator.userName} ${operator.account}`;
  }
  if (typeof field.default_value === "string") {
    return field.default_value;
  }
  return "";
}

function bindRichEditor(editorWrap) {
  if (!editorWrap || editorWrap.dataset.bound === "1") return;
  editorWrap.dataset.bound = "1";

  const isDisabled = editorWrap.dataset.disabled === "1";
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  const imageInput = editorWrap.querySelector("[data-image-input]");
  const toolbar = editorWrap.querySelector(".rich-toolbar");
  if (!content || !hidden || !toolbar) return;

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cmd]");
    if (!button || isDisabled) return;
    const cmd = button.getAttribute("data-cmd");
    const cmdValue = button.getAttribute("data-cmd-value");
    content.focus();
    document.execCommand(cmd, false, cmdValue || undefined);
    syncRichEditorValue(editorWrap);
  });

  if (imageInput) {
    imageInput.addEventListener("change", async () => {
      if (isDisabled) return;
      const file = imageInput.files && imageInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        content.focus();
        document.execCommand("insertImage", false, dataUrl);
        syncRichEditorValue(editorWrap);
      } finally {
        imageInput.value = "";
      }
    });
  }

  content.addEventListener("input", () => {
    syncRichEditorValue(editorWrap);
  });
}

function syncRichEditorValue(editorWrap) {
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  if (!content || !hidden) return;
  hidden.value = content.innerHTML.trim();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image read failed"));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(input) {
  return escapeHtml(input).replaceAll('"', "&quot;");
}

bootstrap();

