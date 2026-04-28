const root = document.getElementById("root");

/** Demo rows: orderId, processId, currentStage, startDate, location, bizEnv, currentHandler, severity, description, status, creatorName */
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
const UI_THEME_STORAGE_KEY = "yunwei_ui_theme";
const UI_THEME_IDS = ["light", "dark", "eye-care", "pink-mist", "blue-lilac"];
/** 自定义背景图（仅本机 localStorage，Data URL） */
const CUSTOM_BG_STORAGE_KEY = "yunwei_custom_bg_data_url";
/** 内置背景预设（仓库内 frontend/assets/skin-presets/，与静态路径 /assets/skin-presets/ 对应） */
const SKIN_BG_PRESET_STORAGE_KEY = "yunwei_bg_preset_file";
const SKIN_BG_PRESETS = [
  { file: "preset-01.png", label: "预设 1", swatch: "preset-01" },
  { file: "preset-02.png", label: "预设 2", swatch: "preset-02" },
  { file: "preset-03.png", label: "预设 3", swatch: "preset-03" },
  { file: "preset-04.png", label: "预设 4", swatch: "preset-04" },
];
/** 单文件上限；Base64 后约为原文件 4/3，localStorage 单域配额有限 */
const CUSTOM_BG_MAX_FILE_BYTES = 2 * 1024 * 1024;

function skinPresetPublicUrl(filename) {
  return `/assets/skin-presets/${encodeURIComponent(filename)}`;
}

/** @returns {(typeof UI_THEME_IDS)[number]} */
function getStoredUiTheme() {
  try {
    const v = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
    if (UI_THEME_IDS.includes(v)) return v;
  } catch (_) {
    /* ignore */
  }
  return "light";
}

/** @param {(typeof UI_THEME_IDS)[number]} theme */
function applyUiTheme(theme) {
  const t = UI_THEME_IDS.includes(theme) ? theme : "light";
  if (t === "light") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", t);
  }
  try {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, t);
  } catch (_) {
    /* ignore */
  }
}

function hasStoredCustomBg() {
  try {
    const s = window.localStorage.getItem(CUSTOM_BG_STORAGE_KEY);
    return Boolean(s && String(s).startsWith("data:image/"));
  } catch (_) {
    return false;
  }
}

function getStoredPresetBgFile() {
  try {
    const f = window.localStorage.getItem(SKIN_BG_PRESET_STORAGE_KEY);
    const file = String(f || "").trim();
    if (!file || !SKIN_BG_PRESETS.some((p) => p.file === file)) return "";
    return file;
  } catch (_) {
    return "";
  }
}

/** @returns {"none"|"custom"|"preset"} */
function getBackgroundKind() {
  if (hasStoredCustomBg()) return "custom";
  if (getStoredPresetBgFile()) return "preset";
  return "none";
}

function applyPageBackgroundFromStorage() {
  const root = document.documentElement;
  let dataUrl = "";
  try {
    dataUrl = window.localStorage.getItem(CUSTOM_BG_STORAGE_KEY) || "";
  } catch (_) {
    /* ignore */
  }
  if (dataUrl && String(dataUrl).startsWith("data:image/")) {
    root.style.setProperty("--yunwei-custom-bg", `url(${JSON.stringify(dataUrl)})`);
    document.body.classList.add("has-custom-bg");
    return;
  }
  const presetFile = getStoredPresetBgFile();
  if (presetFile) {
    const u = skinPresetPublicUrl(presetFile);
    root.style.setProperty("--yunwei-custom-bg", `url(${JSON.stringify(u)})`);
    document.body.classList.add("has-custom-bg");
    return;
  }
  root.style.removeProperty("--yunwei-custom-bg");
  document.body.classList.remove("has-custom-bg");
}

function clearPageBackground() {
  try {
    window.localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
    window.localStorage.removeItem(SKIN_BG_PRESET_STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
  applyPageBackgroundFromStorage();
}

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

/** 问题审核～审核关闭：扁平 whitelist 用自定义下拉（非原生 select），避免 Win/Mac 原生弹层样式不一致 */
const WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS = new Set([
  "problem_review",
  "ops_analysis",
  "dev_analysis",
  "dev_closure",
  "ops_closure",
  "audit_close",
]);
/** 工单字段：可搜索下拉（按关键字过滤选项） */
const WF_FLAT_SEARCHABLE_FIELD_KEYS = new Set(["gauss_version"]);
const PERMISSION_WHITELIST_NODE_KEY = "__whitelist__";
const PERMISSION_WHITELIST_ITEMS = [
  { key: "home", label: "我的主页" },
  { key: "home_duty_roster", label: "我的主页 / 值班信息" },
  { key: "ticket_detail", label: "工单详情" },
  { key: "ticket_detail_passed_nodes", label: "工单详情 / 展开走过的节点" },
  { key: "ticket_detail_current_stage", label: "工单详情 / 当前阶段" },
  { key: "ticket_detail_log", label: "工单详情 / log" },
  { key: "ticket_list", label: "工作台" },
  { key: "workbench_group", label: "工作台 / 拉群按钮" },
  { key: "workbench_create", label: "工作台 / 创建按钮" },
  { key: "workbench_create_from_problem_fill", label: "工作台 / 创建问题是否从问题填写节点开始" },
  { key: "workbench_export", label: "工作台 / 导出按钮" },
  { key: "workbench_delete", label: "工作台 / 删除按钮" },
  { key: "leave_application", label: "请假申请" },
  { key: "leave_whitelist", label: "请假申请 / 审批白名单按钮" },
  { key: "leave_apply", label: "请假申请 / 申请按钮" },
  { key: "duty_roster", label: "值班表" },
  { key: "duty_roster_edit", label: "值班表 / 编辑按钮" },
  { key: "admin_users", label: "用户管理" },
  { key: "admin_users_edit", label: "用户管理 / 编辑按钮" },
  { key: "admin_permissions", label: "权限策略" },
  { key: "admin_permissions_add", label: "权限策略 / 新增权限组按钮" },
  { key: "admin_permissions_whitelist", label: "权限策略 / 配置白名单按钮" },
  { key: "stats_dashboard", label: "统计图表" },
  { key: "patch_manage", label: "补丁管理" },
  { key: "params_config", label: "参数配置" },
  { key: "params_duty_field_edit", label: "参数配置 / 责任田模块编辑按钮" },
  { key: "params_version_edit", label: "参数配置 / 版本模块编辑按钮" },
  { key: "params_group_template_edit", label: "参数配置 / 拉群模板编辑按钮" },
  { key: "params_llm_config", label: "参数配置 / 大模型配置" },
  { key: "ai_assistant", label: "智能助手" },
  { key: "ai_assistant_template_edit", label: "智能助手 / 快捷模板编辑" },
  { key: "ai_assistant_config", label: "智能助手 / 系统大模型配置" },
];
const PERMISSION_LEVEL_OPTIONS = [
  ["hidden", "不展示"],
  ["readonly", "只读"],
  ["editable", "可编辑"],
];
const PERMISSION_LEVEL_RANK = { hidden: 0, readonly: 1, editable: 2 };
const PERMISSION_STRATEGY_OPTIONS_BY_KEY = {
  home_duty_roster: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ticket_detail_passed_nodes: [
    ["editable", "可查看、编辑所有工单的所有阶段"],
    ["readonly", "可查看所有节点，仅可编辑自己处理过的节点"],
    ["hidden", "仅可查看“问题填写”节点"],
  ],
  ticket_detail_current_stage: [
    ["editable", "可编辑所有工单的当前阶段"],
    ["readonly", "当前处理人为本人的阶段"],
  ],
  ticket_detail_log: [
    ["hidden", "不可查看"],
    ["readonly", "可查看"],
  ],
  workbench_group: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_create: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_create_from_problem_fill: [
    ["editable", "是"],
    ["readonly", "否"],
  ],
  workbench_export: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_delete: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ticket_list: [
    ["readonly", "展示所有工单"],
    ["editable", "仅展示本人创建工单"],
  ],
  leave_application: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  leave_whitelist: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  leave_apply: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  duty_roster: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  duty_roster_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_permissions: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_permissions_add: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_permissions_whitelist: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_users: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_users_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  stats_dashboard: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  patch_manage: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_config: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_duty_field_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_version_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_group_template_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
};
/** 白名单级联：子项权限不得高于父项（按权限策略表约束） */
const PERMISSION_WHITELIST_CASCADE_RELATIONS = [
  ["home", "home_duty_roster"],
  ["ticket_detail", "home"],
  ["ticket_detail", "ticket_detail_passed_nodes"],
  ["ticket_detail", "ticket_detail_current_stage"],
  ["ticket_detail", "ticket_detail_log"],
  ["ticket_list", "workbench_group"],
  ["ticket_list", "workbench_create"],
  ["ticket_list", "workbench_export"],
  ["ticket_list", "workbench_delete"],
  ["leave_application", "leave_whitelist"],
  ["leave_application", "leave_apply"],
  ["duty_roster", "duty_roster_edit"],
  ["admin_users", "admin_users_edit"],
  ["admin_users", "admin_permissions"],
  ["admin_permissions", "admin_permissions_add"],
  ["admin_permissions", "admin_permissions_whitelist"],
  ["params_config", "params_duty_field_edit"],
  ["params_config", "params_version_edit"],
  ["params_config", "params_group_template_edit"],
];
const PERMISSION_WHITELIST_PARENT_MAP = PERMISSION_WHITELIST_CASCADE_RELATIONS.reduce((acc, [parent, child]) => {
  if (!acc[child]) acc[child] = [];
  acc[child].push(parent);
  return acc;
}, {});

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
const DUTY_HOLIDAY_STORAGE_KEY = "yunwei_duty_holiday_v1";
const DUTY_SELECTABLE_ROLE_CODES = new Set(["管理员", "普通人员"]);

/** 值班表单页内的区块（顺序即页面从上到下）；id 用于 URL 锚点与侧栏子菜单 */
const DUTY_ROSTER_SECTIONS = [
  { id: "duty-kernel-oncall", title: "内核值班表" },
  { id: "duty-control-oncall", title: "管控值班表" },
  { id: "duty-holiday-config", title: "节假日配置" },
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
  /** 创建弹窗起始节点：`problem_fill`（TAC 等仅问题填写 scope）或 `ops_analysis` */
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
  /** 我的主页 · 个人数据：快捷时间与自定义区间，与统计「人力投入」一致 */
  homePersonalPreset: "1w",
  homePersonalStart: "",
  homePersonalEnd: "",
  /** 透传率筛选：全部问题 | 质量问题 | 非质量问题 */
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
  /** @type {{ kind: string, dateKey: string } | null} */
  dutyDayModal: null,
  /** 已与服务端同步的「内核月|管控月」键，避免重复拉取 */
  dutyCalendarLoadedKey: "",
  dutyCalendarSyncPending: false,
  dutyHolidayLoadedKey: "",
  dutyHolidaySyncPending: false,
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
  reqTab: "all",
  reqSearch: "",
  reqList: [],
  reqListLoading: false,
  reqListTotal: 0,
  reqListPage: 1,
  reqListPageSize: 9999,
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
  /** 统计图表页子视图：labor 人力投入 | ownership 问题归属 | passthrough 透传分析 */
  statsChartsTab: "labor",
  /** 工单分析报告周期：week | biweek | month | quarter | year */
  statsReportPeriod: "week",
  /** 人力投入快捷范围：1d 近一天 | 1w 近一周 | 1m 近一月 | 6m 近半年 | 1y 近一年；空表示自定义日期 */
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
  /** 问题归属：快捷时间（与人力投入同口径） */
  statsOwnershipPreset: "1w",
  statsOwnershipStart: "",
  statsOwnershipEnd: "",
  /** 精度：year | quarter | month | day */
  statsOwnershipPrecision: "month",
  /** 是否质量问题：all | known | new | no（兼容历史值 yes | no） */
  statsOwnershipQuality: "all",
  /** 问题组件：kernel | control | all */
  statsOwnershipComponent: "all",
  /** 问题模块旭日图：intro 问题引入模块 | owner 问题归属模块 */
  statsOwnershipSunburstKind: "intro",
  /** 一级模块柱状：问题分类 owner | intro */
  statsOwnershipL1Class: "owner",
  /** 一级模块：storage | sql | peripheral */
  statsOwnershipL1ModuleFilter: "storage",
  /** DTS 单号去重：yes | no */
  statsOwnershipL1DtsDedup: "yes",
  statsOwnershipTopSiteN: 10,
  statsOwnershipTopInstanceSiteN: 10,
  /** 全量问题 TOP 模块：问题分类 */
  statsOwnershipTopModuleKind: "owner",
  /** 问题高发模块表：问题分类 */
  statsOwnershipHotspotKind: "owner",
  aiConversations: [],
  aiConversationsLoading: false,
  aiActiveConvId: null,
  aiMessages: [],
  aiMessagesLoading: false,
  aiChatLoading: false,
  aiChatError: "",
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
    isQualityIssue: String(formState.values?.is_quality_issue || ""),
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

/** 首页列表可筛列（流程 ID、SLA 时间不设筛选） */
const TICKET_LIST_FILTER_KEYS = [
  "currentStage",
  "startDate",
  "severity",
  "location",
  "bizEnv",
  "currentHandler",
  "description",
];

function ticketListFilterDisplayValue(ticket, colKey) {
  switch (colKey) {
    case "currentStage": {
      const s = String((ticket.currentStage ?? ticket.node) || "").trim();
      return s || "（空）";
    }
    case "startDate": {
      const s = String(ticket.startDate || "").trim();
      return s || "（空）";
    }
    case "severity":
      return normalizeIssueSeverity(ticket.severity ?? ticket.priority);
    case "location": {
      const s = String(ticket.location || "").trim();
      return s || "（空）";
    }
    case "bizEnv": {
      const s = String(ticket.bizEnv || "").trim();
      return s || "（空）";
    }
    case "currentHandler": {
      const s = String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
      return s || "（空）";
    }
    case "description":
      return listPreviewText(ticket.description || "--", 200);
    default:
      return "";
  }
}

function uniqueTicketListFilterValues(tickets, colKey) {
  const set = new Set();
  (tickets || []).forEach((t) => {
    const v = ticketListFilterDisplayValue(t, colKey);
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function filterTicketsByListColumnFilters(tickets, filters) {
  const sel = filters?.selected || {};
  return (tickets || []).filter((t) =>
    TICKET_LIST_FILTER_KEYS.every((key) => {
      const picked = sel[key] || [];
      if (picked.length === 0) return true;
      const val = ticketListFilterDisplayValue(t, key);
      return picked.includes(val);
    })
  );
}

function renderTicketListFilterHeader(label, colKey, allTickets, filterNs = "list") {
  const filtersState = filterNs === "home" ? state.homeTicketListFilters : state.ticketListFilters;
  const dataPrefix = filterNs === "home" ? "data-home-ticket-list-filter" : "data-ticket-list-filter";
  const thExtra = filterNs === "home" ? " home-ticket-list-th-filter" : "";
  const selected = filtersState.selected[colKey] || [];
  const values = uniqueTicketListFilterValues(allTickets, colKey);
  const isOpen = filtersState.openKey === colKey;
  const search = filtersState.search[colKey] || "";
  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const allChecked = visibleValues.length > 0 && visibleValues.every((v) => selected.includes(v));
  const active = selected.length > 0 ? "active" : "";
  const options = visibleValues
    .map(
      (v) =>
        `<label class="filter-opt"><input type="checkbox" ${dataPrefix}-value="${escapeAttr(v)}" ${selected.includes(v) ? "checked" : ""}/> ${escapeHtml(v)}</label>`
    )
    .join("");
  return `
    <th class="admin-th-filter ticket-list-th-filter${thExtra}">
      <span>${label}</span>
      <button type="button" class="filter-icon ${active}" ${dataPrefix}-open="${escapeAttr(colKey)}" title="筛选" aria-label="筛选">⏷</button>
      ${
        isOpen
          ? `<div class="filter-pop">
          <input class="filter-search" type="text" ${dataPrefix}-search="${escapeAttr(colKey)}" placeholder="搜索" value="${escapeAttr(search)}" />
          <label class="filter-opt filter-checkall"><input type="checkbox" ${dataPrefix}-checkall="${escapeAttr(colKey)}" ${allChecked ? "checked" : ""}/> （全选）</label>
          <div class="filter-pop-list">${options || '<div class="filter-empty">无可选值</div>'}</div>
          <div class="filter-pop-actions">
            <button type="button" class="action" ${dataPrefix}-reset-col="${escapeAttr(colKey)}">重置</button>
            <button type="button" class="action primary" ${dataPrefix}-close>完成</button>
          </div>
        </div>`
          : ""
      }
    </th>
  `;
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
        isQualityIssue: String(r.is_quality_issue || r.isQualityIssue || ""),
        createdAt: String(r.created_at || r.createdAt || ""),
        node_key: String(r.node_key || r.nodeKey || ""),
        operatorSubmitted: Boolean(r.operator_submitted ?? r.operatorSubmitted),
      };
    }).filter((x) => x.orderId);
    if (!mapped.length) {
      debugLog("tickets.sync.empty");
      return;
    }
    ticketList.splice(0, ticketList.length, ...sortTicketsByCreatedAtDesc(mapped));
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
  if (key === "home") return "/";
  if (key === "list") return "/workbench";
  if (key === "duty:roster") return "/duty-roster";
  if (key === "leave:application") return "/leave-application";
  if (key === "req:manage") return "/requirements";
  if (key === "settings:appearance") return "/settings/appearance";
  if (key === "params:duty-field") return "/params/duty-field";
  if (key === "params:version") return `/params/version#${state.versionSubTab === "hotfix" ? "hotfix" : "baseline"}`;
  if (key === "params:group-template") return "/params/group-template";
  if (key === "admin:permissions") return "/admin/permissions";
  if (key === "admin:users") return "/admin/users";
  if (key === "stats:charts") return "/stats/charts";
  if (key === "stats:report") return "/stats/report";
  if (key === "ai:assistant") return "/ai-assistant";
  if (key === "params:llm-config") return "/params/llm-config";
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
}

function getActiveTicket() {
  if (
    state.activeKey === "home" ||
    state.activeKey === "list" ||
    state.activeKey === "duty:roster" ||
    state.activeKey === "leave:application" ||
    state.activeKey === "req:manage" ||
    state.activeKey === "settings:appearance" ||
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

function ensureHomeTab() {
  const key = "home";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.unshift({ key, label: "我的主页", closable: false });
  }
  return key;
}

function ensureListTab() {
  const key = "list";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "工作台", closable: true });
  }
  return key;
}

function ensureStatsChartsTab() {
  const key = "stats:charts";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "统计图表", closable: true });
  }
  return key;
}

function ensureStatsReportTab() {
  const key = "stats:report";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "工单分析", closable: true });
  }
  return key;
}

function ensureSettingsTab() {
  const key = "settings:appearance";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "设置", closable: true });
  }
  return key;
}

/** @param {"duty-field"|"version"|"group-template"|"llm-config"} kind */
function ensureParamsTab(kind) {
  const map = {
    "duty-field": { key: "params:duty-field", label: "责任田模块" },
    version: { key: "params:version", label: "版本模块" },
    "group-template": { key: "params:group-template", label: "拉群模版" },
    "llm-config": { key: "params:llm-config", label: "大模型配置" },
  };
  const item = map[kind] || map["duty-field"];
  if (!state.openTabs.some((tab) => tab.key === item.key)) {
    state.openTabs.push({ key: item.key, label: item.label, closable: true });
  }
  return item.key;
}

function ensureAiTab() {
  const key = "ai:assistant";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "智能助手", closable: true });
  }
  return key;
}

function persistDutyAssignmentsLocal() {
  try {
    window.localStorage.setItem(DUTY_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(state.dutyAssignments));
  } catch (_) {}
}

function persistDutyHolidayLocal() {
  try {
    window.localStorage.setItem(DUTY_HOLIDAY_STORAGE_KEY, JSON.stringify(state.dutyHolidayDays || {}));
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

function dutyHolidayMonthSyncKey() {
  const ym = state.dutyHolidayYm || { year: 0, month: 0 };
  return `${ym.year}-${ym.month}`;
}

function mergeDutyHolidayMonthFromServer(year, month, dayMap) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const bucket = { ...(state.dutyHolidayDays || {}) };
  Object.keys(bucket).forEach((k) => {
    if (k.startsWith(prefix)) delete bucket[k];
  });
  if (dayMap && typeof dayMap === "object") {
    Object.keys(dayMap).forEach((dk) => {
      const val = String(dayMap[dk] || "").trim();
      if (val === "workday" || val === "weekend_holiday") bucket[dk] = val;
    });
  }
  state.dutyHolidayDays = bucket;
}

async function syncDutyHolidayMonthFromServer() {
  const op = getCurrentOperator();
  const ym = state.dutyHolidayYm || { year: 0, month: 0 };
  if (!ym.year || !ym.month) return;
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/duty/holidays?operator_id=${encodeURIComponent(op.account)}&year=${ym.year}&month=${ym.month}`
    );
    if (!resp.ok) return;
    const json = await resp.json();
    mergeDutyHolidayMonthFromServer(ym.year, ym.month, json.days || {});
    persistDutyHolidayLocal();
  } catch (_) {
    /* 离线时保留本地缓存 */
  }
}

async function persistDutyHolidayMonthToServer(year, month) {
  persistDutyHolidayLocal();
  const op = getCurrentOperator();
  const last = new Date(year, month, 0).getDate();
  const bucket = state.dutyHolidayDays || {};
  const days = {};
  for (let d = 1; d <= last; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const val = String(bucket[key] || "").trim();
    if (val === "workday" || val === "weekend_holiday") days[key] = val;
  }
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/holidays`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        year,
        month,
        days,
      }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      window.alert(`节假日配置保存失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    window.alert(`节假日配置保存失败：${String(e.message || e)}`);
    return false;
  }
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

function canEditDutyRosterByWhitelist() {
  return whitelistAllows("duty_roster_edit", "readonly");
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
  const admin = canEditDutyRosterByWhitelist();
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
  if (!canEditDutyRosterByWhitelist()) return;
  void putDutyRotationToServer();
}

function persistDutySiteOnCallLocalAndServer() {
  persistDutySiteOnCallLocal();
  if (!canEditDutyRosterByWhitelist()) return;
  void putDutySiteOnCallToServer();
}

function persistDutyRlOnCallLocalAndServer() {
  persistDutyRlOnCallLocal();
  if (!canEditDutyRosterByWhitelist()) return;
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
  const admin = canEditDutyRosterByWhitelist();
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
  const admin = canEditDutyRosterByWhitelist();
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
  const admin = canEditDutyRosterByWhitelist();
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
  const admin = canEditDutyRosterByWhitelist();
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

function renderDutyHolidayConfigBlock(sectionId, title) {
  const ym = state.dutyHolidayYm || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const weeks = buildDutyMonthWeeks(year, month);
  const admin = canEditDutyRosterByWhitelist();
  const editing = !!state.dutyHolidayEditMode;
  const titleZh = `${year}年${month}月`;
  const wkLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const editBtn = admin
    ? `<button type="button" class="action duty-holiday-edit-btn" data-duty-holiday-edit>${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const cellsHtml = weeks
    .map((row) => {
      const tds = row
        .map((cell) => {
          if (!cell) return `<td class="duty-cal-cell duty-cal-cell--empty"></td>`;
          const val = String((state.dutyHolidayDays || {})[cell.key] || "").trim();
          const isWorkday = val === "workday";
          const isHoliday = val === "weekend_holiday";
          const tag = isWorkday ? "工作日" : isHoliday ? "周末节假日" : "";
          const extraCls = isWorkday ? " duty-cal-cell--full" : isHoliday ? " duty-cal-cell--night" : "";
          const interactive = admin && editing ? `tabindex="0" role="button" data-duty-holiday-date="${escapeAttr(cell.key)}"` : "";
          const chip = tag ? `<div class="duty-cal-chips"><span class="duty-cal-chip"><span class="duty-cal-chip-name">${escapeHtml(tag)}</span></span></div>` : "";
          return `<td class="duty-cal-cell${extraCls}${admin && editing ? " duty-cal-cell--interactive" : ""}" ${interactive}><span class="duty-cal-daynum">${cell.day}</span>${chip}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const headRow = `<tr>${wkLabels.map((l) => `<th class="duty-cal-wk">${escapeHtml(l)}</th>`).join("")}</tr>`;
  const tip = editing ? "点击日期可在“工作日/周末节假日”之间切换；清空请点击到第三态。" : "仅管理员可编辑。";
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card duty-roster-card--calendar${editing ? " duty-roster-card--editing" : ""}">
            <p class="duty-roster-note">${escapeHtml(tip)}</p>
            <div class="duty-cal-toolbar">
              <button type="button" class="action duty-holiday-nav" data-duty-holiday-dir="-1" aria-label="上个月">‹ 上个月</button>
              <span class="duty-cal-month-label">${escapeHtml(titleZh)}</span>
              <button type="button" class="action duty-holiday-nav" data-duty-holiday-dir="1" aria-label="下个月">下个月 ›</button>
            </div>
            <table class="duty-cal-table">
              <thead>${headRow}</thead>
              <tbody>${cellsHtml}</tbody>
            </table>
          </div>
        </section>`;
}

function renderHomeDutyKindChips(list, roleLabel) {
  if (!list.length) return `<span class="home-duty-cell-empty">—</span>`;
  return list
    .map((item) => {
      const sh = item.shift === DUTY_SHIFT_NIGHT ? "night" : "full";
      const cls = sh === "night" ? "duty-cal-chip duty-cal-chip--night" : "duty-cal-chip duty-cal-chip--full";
      const tag = escapeHtml(dutyShiftLabel(sh));
      return `<span class="${cls}"><span class="duty-cal-chip-name">${escapeHtml(roleLabel)}</span><span class="duty-cal-chip-shift">${tag}</span></span>`;
    })
    .join("");
}

function renderHomeDutyRlUnifiedCell(rlRow, rlPri, rlBak) {
  if (!rlRow || (!rlPri && !rlBak)) return `<span class="home-duty-cell-empty">—</span>`;
  const parts = [];
  if (rlPri) {
    parts.push(
      `<div class="duty-rl-view-slot duty-rl-view-slot--inline home-duty-rl-slot"><span class="duty-rl-view-name">RL值班 · 主值班</span>${homeDutyRlPhoneSuffix(rlRow.primary)}</div>`
    );
  }
  if (rlBak) {
    parts.push(
      `<div class="duty-rl-view-slot duty-rl-view-slot--inline home-duty-rl-slot"><span class="duty-rl-view-name">RL值班 · 备值班</span>${homeDutyRlPhoneSuffix(rlRow.backup)}</div>`
    );
  }
  return `<div class="home-duty-rl-cell">${parts.join("")}</div>`;
}

function homeDutyRlPhoneSuffix(slot) {
  const phone = String(slot.phone || "").trim();
  if (!phone) return "";
  return `<span class="duty-rl-view-sep" aria-hidden="true">·</span><span class="duty-rl-phone-tag" title="手机号"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>`;
}

function dutyRlSlotMatchesCurrentUser(slot) {
  if (!dutyRlSlotFilled(slot)) return false;
  return dutyAssignmentMatchesCurrentUser(slot);
}

/** 主页值班日历格：本人内核 / 管控 / RL 与是否高亮（与内核值班表同一套 grid） */
function buildHomeDutyCalendarCell(dateKey) {
  const kList = getDutyAssignmentsForDay("kernel", dateKey).filter((it) => dutyAssignmentMatchesCurrentUser(it));
  const cList = getDutyAssignmentsForDay("control", dateKey).filter((it) => dutyAssignmentMatchesCurrentUser(it));
  const rlRow = (state.dutyRlOnCallRows || []).find((r) => r.duty_date === dateKey);
  const rlPri = rlRow && dutyRlSlotMatchesCurrentUser(rlRow.primary);
  const rlBak = rlRow && dutyRlSlotMatchesCurrentUser(rlRow.backup);
  const hasSelf = kList.length > 0 || cList.length > 0 || !!rlPri || !!rlBak;
  const lines = [];
  if (kList.length) {
    lines.push(
      `<div class="home-duty-cal-line home-duty-cal-line--chips"><div class="home-duty-chips-wrap">${renderHomeDutyKindChips(
        kList,
        "内核值班"
      )}</div></div>`
    );
  }
  if (cList.length) {
    lines.push(
      `<div class="home-duty-cal-line home-duty-cal-line--chips"><div class="home-duty-chips-wrap">${renderHomeDutyKindChips(
        cList,
        "管控值班"
      )}</div></div>`
    );
  }
  if (rlPri || rlBak) {
    lines.push(`<div class="home-duty-cal-line home-duty-cal-line--rl">${renderHomeDutyRlUnifiedCell(rlRow, rlPri, rlBak)}</div>`);
  }
  const inner = `<div class="duty-cal-chips home-duty-cal-chips">${lines.join("")}</div>`;
  return { hasSelf, inner };
}

/** 我的主页「值班信息」：与内核值班表相同的月历网格，格内汇总本人内核 / 管控 / RL */
function renderHomeDutyInfoSectionHtml() {
  const ym = state.dutyCalendarYm.kernel || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const weeks = buildDutyMonthWeeks(year, month);
  const titleZh = `${year}年${month}月`;
  const wkLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const cellsHtml = weeks
    .map((row) => {
      const tds = row
        .map((cell) => {
          if (!cell) {
            return `<td class="duty-cal-cell duty-cal-cell--empty"></td>`;
          }
          const dateKey = cell.key;
          const { hasSelf, inner } = buildHomeDutyCalendarCell(dateKey);
          const cls = `duty-cal-cell${hasSelf ? " duty-cal-cell--self" : ""}`;
          return `<td class="${cls}"><span class="duty-cal-daynum">${cell.day}</span>${inner}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const headRow = `<tr>${wkLabels.map((l) => `<th class="duty-cal-wk">${escapeHtml(l)}</th>`).join("")}</tr>`;
  return `
    <section class="home-duty-info-section" id="home-duty-info" aria-label="值班信息">
      <div class="section-title home-duty-info-title">值班信息</div>
      <div class="duty-roster-card duty-roster-card--calendar home-duty-unified-card">
        <div class="duty-cal-toolbar">
          <button type="button" class="action duty-cal-nav" data-home-duty-unified-nav data-home-duty-dir="-1" aria-label="上个月">‹ 上个月</button>
          <span class="duty-cal-month-label">${escapeHtml(titleZh)}</span>
          <button type="button" class="action duty-cal-nav" data-home-duty-unified-nav data-home-duty-dir="1" aria-label="下个月">下个月 ›</button>
        </div>
        <div class="home-duty-cal-table-wrap">
          <table class="duty-cal-table home-duty-cal-table">
            <thead>${headRow}</thead>
            <tbody>${cellsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
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
    if (sec.id === "duty-holiday-config") {
      return renderDutyHolidayConfigBlock(sec.id, sec.title);
    }
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

  const hSk = dutyHolidayMonthSyncKey();
  if (state.dutyHolidayLoadedKey !== hSk && !state.dutyHolidaySyncPending) {
    state.dutyHolidaySyncPending = true;
    void syncDutyHolidayMonthFromServer().then(() => {
      state.dutyHolidaySyncPending = false;
      state.dutyHolidayLoadedKey = hSk;
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
  document.querySelectorAll("[data-duty-holiday-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = parseInt(btn.getAttribute("data-duty-holiday-dir") || "0", 10);
      let { year, month } = state.dutyHolidayYm || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
      month += dir;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      if (month > 12) {
        month = 1;
        year += 1;
      }
      state.dutyHolidayYm = { year, month };
      state.dutyHolidayLoadedKey = "";
      render();
    });
  });
  document.querySelectorAll("[data-duty-holiday-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dutyHolidayEditMode = !state.dutyHolidayEditMode;
      render();
    });
  });
  document.querySelectorAll("[data-duty-holiday-date]").forEach((cell) => {
    cell.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!state.dutyHolidayEditMode) return;
      const dateKey = cell.getAttribute("data-duty-holiday-date");
      if (!dateKey) return;
      const cur = String((state.dutyHolidayDays || {})[dateKey] || "");
      let next = "";
      if (cur === "workday") next = "weekend_holiday";
      else if (cur === "weekend_holiday") next = "";
      else next = "workday";
      if (!state.dutyHolidayDays) state.dutyHolidayDays = {};
      if (next) state.dutyHolidayDays[dateKey] = next;
      else delete state.dutyHolidayDays[dateKey];
      persistDutyHolidayLocal();
      const [y, mo] = dateKey.split("-").map((x) => parseInt(x, 10));
      await persistDutyHolidayMonthToServer(y, mo);
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

function ensureRequirementTab() {
  const key = "req:manage";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "需求管理", closable: true });
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

/** 我的主页「待审批」：与 GET scope=pending_approval 一致（待我审批 ∪ 本人发起且未结案） */
async function fetchHomeLeavePendingList() {
  const op = getCurrentOperator();
  state.homeLeavePendingLoading = true;
  render();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/leave/applications?operator_id=${encodeURIComponent(op.account)}&scope=${encodeURIComponent("pending_approval")}&q=`
    );
    if (!r.ok) {
      state.homeLeavePendingItems = [];
      return;
    }
    const j = await r.json();
    state.homeLeavePendingItems = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.homeLeavePendingItems = [];
  } finally {
    state.homeLeavePendingLoading = false;
    render();
  }
}

function renderHomeLeaveWorkbenchTableSection() {
  const items = state.homeLeavePendingItems || [];
  if (state.homeLeavePendingLoading) {
    return `<tbody id="home-leave-table-body"><tr><td colspan="10" class="leave-app-empty">加载中…</td></tr></tbody>`;
  }
  const rows = items
    .map((it, idx) => {
      const spanStart = formatLeaveIsoDisplay(it.span_start);
      const spanEnd = formatLeaveIsoDisplay(it.span_end);
      const hours = it.total_hours != null ? Number(it.total_hours).toFixed(2) : "—";
      const reason = String(it.reasons_concat || "").trim() || "—";
      return `<tr class="leave-app-row home-leave-app-row" data-leave-app-id="${it.id}">
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
  const empty = `<tr><td colspan="10" class="leave-app-empty">暂无数据</td></tr>`;
  return `<tbody id="home-leave-table-body">${rows || empty}</tbody>`;
}

function homePersonalWorkloadLabelsValues() {
  ensureHomePersonalRangeInit();
  const a = new Date(`${state.homePersonalStart}T12:00:00`);
  const b = new Date(`${state.homePersonalEnd}T12:00:00`);
  const t0 = a.getTime();
  const t1 = b.getTime();
  const maxPts = 12;
  const labels = [];
  const values = new Array(maxPts).fill(0);
  for (let i = 0; i < maxPts; i += 1) {
    const t = t0 + (i / Math.max(maxPts - 1, 1)) * (t1 - t0);
    const d = new Date(t);
    labels.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`);
  }
  return { labels, values };
}

function homePersonalWorkloadFromLaborInput() {
  ensureHomePersonalRangeInit();
  const base = homePersonalWorkloadLabelsValues();
  const op = getCurrentOperator();
  const normalizedName = statsNormalizePersonName(op.userName || "");
  const start = parseYmdToDate(state.homePersonalStart);
  const end = parseYmdToDate(state.homePersonalEnd);
  if (!start || !end) return base;
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) return base;

  // 与“统计图表-人力投入统计”同口径：按人员名统计，主页只取当前登录人。
  const rows = statsTicketsInRange(state.homePersonalStart, state.homePersonalEnd);
  const myRows = rows.filter((t) => {
    const person = statsTicketPersonName(t);
    if (normalizedName && person === normalizedName) return true;
    const raw = String(t?.currentHandler || t?.assignee || t?.creatorName || "").trim();
    return operatorMatchesPersonField(raw, op);
  });
  const values = new Array(base.labels.length).fill(0);
  if (!myRows.length) return { labels: base.labels, values };

  const span = Math.max(endMs - startMs, 0);
  myRows.forEach((t) => {
    const ymd = statsTicketDayYmd(t);
    const day = parseYmdToDate(ymd);
    if (!day) return;
    const ms = day.getTime();
    if (ms < startMs || ms > endMs) return;
    const rawIdx = span > 0 ? Math.floor(((ms - startMs) / span) * base.labels.length) : 0;
    const idx = Math.min(base.labels.length - 1, Math.max(0, rawIdx));
    values[idx] += 1;
  });
  return { labels: base.labels, values };
}

function normalizeHomePersonalQualityScope(v) {
  if (v === "quality") return "quality";
  if (v === "nonQuality") return "non_quality";
  return "all";
}

function homePersonalQueryKey() {
  ensureHomePersonalRangeInit();
  const op = getCurrentOperator();
  return `${op.account}|${state.homePersonalStart}|${state.homePersonalEnd}|${normalizeHomePersonalQualityScope(state.homePersonalPassthroughQuality || "all")}`;
}

function getHomePersonalStatsOrFallback() {
  const fallback = homePersonalWorkloadLabelsValues();
  const laborWorkload = homePersonalWorkloadFromLaborInput();
  const stats = state.homePersonalStats || {};
  const workload = stats.workload || {};
  const sla = stats.sla || {};
  const passthrough = stats.passthrough || {};
  const labels = Array.isArray(laborWorkload.labels) && laborWorkload.labels.length
    ? laborWorkload.labels
    : Array.isArray(workload.labels) && workload.labels.length
      ? workload.labels
      : fallback.labels;
  const values = Array.isArray(laborWorkload.values) && laborWorkload.values.length === labels.length
    ? laborWorkload.values
    : Array.isArray(workload.values) && workload.values.length === labels.length
      ? workload.values
      : fallback.values;
  const stages =
    Array.isArray(sla.stages) && sla.stages.length
      ? sla.stages
      : WORKFLOW_NODES.filter((s) => s !== "问题填写");
  const stageValues = Array.isArray(sla.values) && sla.values.length === stages.length ? sla.values : stages.map(() => 0);
  return {
    workload: { labels, values },
    sla: { stages, values: stageValues },
    passthrough: {
      independent: Number(passthrough.independent_closure_count || 0),
      commando: Number(passthrough.commando_count || 0),
    },
  };
}

async function fetchHomePersonalStats() {
  ensureHomePersonalRangeInit();
  const op = getCurrentOperator();
  const key = homePersonalQueryKey();
  state.homePersonalStatsLoadedKey = key;
  state.homePersonalStats = null;
  state.homePersonalStatsLoading = true;
  render();
  try {
    const qualityScope = normalizeHomePersonalQualityScope(state.homePersonalPassthroughQuality || "all");
    const q = new URLSearchParams({
      operator_id: op.account,
      start_date: state.homePersonalStart,
      end_date: state.homePersonalEnd,
      quality_scope: qualityScope,
    });
    const r = await fetch(`${API_BASE_URL}/api/home/personal-stats?${q.toString()}`);
    if (!r.ok) return;
    const j = await r.json();
    state.homePersonalStats = j && typeof j === "object" ? j : null;
  } catch (_) {
    // 后端不可用时回退为零值占位，保持页面可渲染
  } finally {
    state.homePersonalStatsLoading = false;
    render();
  }
}

function renderHomePersonalPassthroughQualityToggle() {
  const v = state.homePersonalPassthroughQuality || "all";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="是否质量问题">
    <span class="stat-labor-filter-label">是否质量问题</span>
    <button type="button" class="action ${v === "all" ? "primary" : ""}" data-home-personal-field="passthroughQuality" data-home-personal-value="all">全部问题</button>
    <button type="button" class="action ${v === "quality" ? "primary" : ""}" data-home-personal-field="passthroughQuality" data-home-personal-value="quality">质量问题</button>
    <button type="button" class="action ${v === "nonQuality" ? "primary" : ""}" data-home-personal-field="passthroughQuality" data-home-personal-value="nonQuality">非质量问题</button>
  </div>`;
}

function renderHomePersonalFiltersHtml() {
  ensureHomePersonalRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = { "1d": "近一天", "1w": "近一周", "1m": "近一月", "6m": "近半年", "1y": "近一年" };
  const segIdx = presetOrder.indexOf(state.homePersonalPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.homePersonalPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-home-personal-preset="${escapeAttr(id)}">${escapeHtml(
        presetLabels[id] || id
      )}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
    </div>`;
  const startDisp = state.homePersonalStart || "开始日期";
  const endDisp = state.homePersonalEnd || "结束日期";
  return `
    <div class="stats-labor-filters home-personal-filters" aria-label="个人数据筛选">
      <div class="stats-labor-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          <div class="date-range">
            <button type="button" class="date-trigger" id="home-personal-start-trigger">${escapeHtml(startDisp)}</button>
            <input class="date-hidden" id="home-personal-start-date" type="date" value="${escapeAttr(state.homePersonalStart || "")}" aria-label="开始日期" />
            <span class="date-sep">--</span>
            <button type="button" class="date-trigger" id="home-personal-end-trigger">${escapeHtml(endDisp)}</button>
            <input class="date-hidden" id="home-personal-end-date" type="date" value="${escapeAttr(state.homePersonalEnd || "")}" aria-label="结束日期" />
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderHomePersonalGlassCard(title, toolbarHtml, chartHtml, delayIdx) {
  const d = (delayIdx * 0.05).toFixed(2);
  const chartInner = `<div class="stat-glass-card-chart stat-chart-enter">${chartHtml}</div>`;
  return `<article class="stat-glass-card home-personal-glass-card" style="--stat-card-delay:${d}s">
    <div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
    </div>
    ${chartInner}
  </article>`;
}

function renderHomePersonalSectionHtml() {
  ensureHomePersonalRangeInit();
  const data = getHomePersonalStatsOrFallback();
  const wl = data.workload;
  const chartWl = statLaborSvgLine(wl.labels, wl.values, { aria: "本人处理工单数量", yUnit: "单位：件", stroke: "#ea580c" });

  const slaStages = data.sla.stages;
  const slaVals = data.sla.values;
  const chartSla = statLaborSvgBarVertical(slaStages, slaVals, {
    aria: "各阶段本人平均滞留",
    maxHint: Math.max(48, ...slaVals),
    fills: slaStages.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 3) % STAT_LABOR_CHART_COLORS.length]),
  });
  const slaNote = `<p class="stat-chart-unit-hint">纵轴：各阶段在本时段内本人平均滞留时长，单位：小时</p>`;

  const pieSlices = [
    { label: "流转独立闭环", value: Math.max(0, data.passthrough.independent) },
    { label: "流转至尖刀连", value: Math.max(0, data.passthrough.commando) },
  ];
  const chartPie = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pieSlices, { aria: "透传率" })}</div>${statLaborPieLegend(pieSlices)}</div>`;

  const cards = [
    renderHomePersonalGlassCard("工作量统计", "", chartWl, 0),
    renderHomePersonalGlassCard("SLA统计", "", chartSla + slaNote, 1),
    renderHomePersonalGlassCard("透传率", renderHomePersonalPassthroughQualityToggle(), chartPie, 2),
  ].join("");

  return `
    <section class="home-personal-section" aria-label="个人数据">
      <div class="section-title home-personal-title">个人数据</div>
      ${renderHomePersonalFiltersHtml()}
      <div class="stats-labor-sections home-personal-grid">${cards}</div>
    </section>
  `;
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
  const whitelist = getCurrentWhitelistSettings();
  const canManageWhitelist = whitelistAllows("leave_whitelist", "readonly", whitelist);
  const canApplyLeave = whitelistAllows("leave_apply", "readonly", whitelist);
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
          ${canManageWhitelist ? `<button type="button" class="action" id="leave-app-whitelist-btn">审批白名单</button>` : ""}
          ${canApplyLeave ? '<button type="button" class="action primary" id="leave-app-apply-btn">申请</button>' : ""}
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

const MS_PER_DAY = 86400000;

function localYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 热力图用：工单落到的本地日历日（优先 createdAt，否则 startDate） */
function ticketLocalActivityDateKey(ticket) {
  const raw = ticket.createdAt ?? ticket.created_at;
  if (raw) {
    const ms = Date.parse(String(raw));
    if (!Number.isNaN(ms)) return localYmd(new Date(ms));
  }
  const sd = String(ticket.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sd)) return sd.slice(0, 10);
  return "";
}

/** 本人走单日历：按「创建人为当前操作人」且日历日聚合条数（与列表「我创建」口径一致） */
function buildMyDailyOrderCounts(operator) {
  const map = new Map();
  getAllTickets().forEach((t) => {
    if (!ticketCreatorMatchesOperator(t, operator)) return;
    const key = ticketLocalActivityDateKey(t);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function startOfWeekSunday(d) {
  const x = startOfLocalDay(d);
  while (x.getDay() !== 0) x.setDate(x.getDate() - 1);
  return x;
}

function heatmapIntensityLevel(count, maxCount) {
  if (count <= 0) return 0;
  if (maxCount <= 0) return 0;
  const r = count / maxCount;
  if (r <= 0.2) return 1;
  if (r <= 0.4) return 2;
  if (r <= 0.65) return 3;
  return 4;
}

function formatZhLongDateFromYmd(ymd) {
  const [y, m, d] = String(ymd || "")
    .split("-")
    .map((x) => Number(x));
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return ymd;
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(dt);
}

function formatZhMonthFromYmd(ymd) {
  const [y, m] = String(ymd || "")
    .split("-")
    .map((x) => Number(x));
  if (!y || !m) return "—";
  const dt = new Date(y, m - 1, 1);
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(dt);
}

function buildMyHomeHeatmapModel(operator) {
  const end = startOfLocalDay(new Date());
  const start = new Date(end.getTime() - 364 * MS_PER_DAY);
  const startSunday = startOfWeekSunday(start);
  const totalDays = Math.floor((end - startSunday) / MS_PER_DAY) + 1;
  const numWeeks = Math.min(53, Math.max(1, Math.ceil(totalDays / 7)));

  const counts = buildMyDailyOrderCounts(operator);
  let maxInRange = 0;
  let totalOrders = 0;
  const monthTotals = new Map();
  let bestDayKey = "";
  let bestDayCount = 0;

  for (let w = 0; w < numWeeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const dt = new Date(startSunday);
      dt.setDate(startSunday.getDate() + w * 7 + dow);
      if (dt < start || dt > end) continue;
      const key = localYmd(dt);
      const c = counts.get(key) || 0;
      totalOrders += c;
      if (c > maxInRange) maxInRange = c;
      if (c > 0) {
        const mk = key.slice(0, 7);
        monthTotals.set(mk, (monthTotals.get(mk) || 0) + c);
      }
      if (c > bestDayCount) {
        bestDayCount = c;
        bestDayKey = key;
      } else if (c > 0 && c === bestDayCount && key.localeCompare(bestDayKey) > 0) {
        bestDayKey = key;
      }
    }
  }

  let bestMonthKey = "";
  let bestMonthTotal = -1;
  monthTotals.forEach((v, mk) => {
    if (v > bestMonthTotal) {
      bestMonthTotal = v;
      bestMonthKey = mk;
    }
  });

  const weeks = [];
  const monthLabelForWeek = [];
  for (let w = 0; w < numWeeks; w++) {
    const column = [];
    for (let dow = 0; dow < 7; dow++) {
      const dt = new Date(startSunday);
      dt.setDate(startSunday.getDate() + w * 7 + dow);
      if (dt < start || dt > end) column.push({ kind: "pad" });
      else {
        const key = localYmd(dt);
        const c = counts.get(key) || 0;
        column.push({
          kind: "day",
          date: dt,
          key,
          count: c,
          level: heatmapIntensityLevel(c, maxInRange),
        });
      }
    }
    weeks.push(column);
    const monthStartCell = column.find((cell) => cell.kind === "day" && cell.date.getDate() === 1);
    let label = "";
    if (monthStartCell) {
      label = new Intl.DateTimeFormat("zh-CN", { month: "numeric" }).format(monthStartCell.date);
    } else if (w === 0) {
      const firstDay = column.find((c) => c.kind === "day");
      if (firstDay) {
        label = new Intl.DateTimeFormat("zh-CN", { month: "numeric" }).format(firstDay.date);
      }
    }
    monthLabelForWeek.push(label);
  }

  const bestMonthLabel =
    bestMonthKey && bestMonthTotal > 0 ? formatZhMonthFromYmd(`${bestMonthKey}-01`) : "—";
  const bestDayLabel =
    bestDayKey && bestDayCount > 0 ? formatZhLongDateFromYmd(bestDayKey) : "—";

  return {
    weeks,
    monthLabelForWeek,
    totalOrders,
    bestMonthLabel,
    bestDayLabel,
  };
}

const HEATMAP_CELL_BG = ["#e4e1d8", "#bfe9c9", "#7ccf8d", "#3faa60", "#2a7a45"];
/** 热力图周列宽（px）：需容纳「10月」等文案，并与下方格子列对齐 */
/** 周列宽与格子边长一致，配合统一 gap，保证小方块四周间距相同 */
const HEATMAP_COL_PX = 12;
const HEATMAP_CELL_PX = 12;
const HEATMAP_GAP_PX = 2;

function heatmapPadCellStyle() {
  return `display:block;box-sizing:border-box;width:${HEATMAP_CELL_PX}px;height:${HEATMAP_CELL_PX}px;min-width:${HEATMAP_CELL_PX}px;min-height:${HEATMAP_CELL_PX}px;opacity:0;pointer-events:none;border:1px solid transparent;background:transparent`;
}

function heatmapDataCellStyle(level) {
  const lv = Math.min(4, Math.max(0, Number(level) || 0));
  const bg = HEATMAP_CELL_BG[lv];
  return `display:block;box-sizing:border-box;width:${HEATMAP_CELL_PX}px;height:${HEATMAP_CELL_PX}px;min-width:${HEATMAP_CELL_PX}px;min-height:${HEATMAP_CELL_PX}px;border-radius:3px;border:1px solid rgba(55,48,32,0.1);background:${bg}`;
}

function renderMyHomeHeatmapCard(operator) {
  const m = buildMyHomeHeatmapModel(operator);
  const totalDisp = Number(m.totalOrders || 0).toLocaleString("zh-CN");
  const nw = Math.max(1, Number(m.weeks.length) || 1);
  /** 按周列优先（每周一列、每周 7 格）扁平化，配合 grid-auto-flow:column + 7 行 */
  const flatCells = m.weeks
    .map((col) =>
      col
        .map((cell) => {
          if (cell.kind === "pad") {
            return `<span class="order-heatmap-cell order-heatmap-cell--pad" style="${heatmapPadCellStyle()}" aria-hidden="true"></span>`;
          }
          const lv = cell.level;
          return `<span class="order-heatmap-cell order-heatmap-cell--l${lv}" style="${heatmapDataCellStyle(lv)}" data-date="${escapeAttr(cell.key)}" data-count="${cell.count}" tabindex="-1"></span>`;
        })
        .join("")
    )
    .join("");
  const monthRow = m.monthLabelForWeek
    .map(
      (lab) =>
        `<span class="order-heatmap-month" style="display:block;width:100%;font-size:8px;line-height:1.15;color:#7a756c;text-align:center;white-space:nowrap;overflow:visible">${lab ? escapeHtml(lab) : ""}</span>`
    )
    .join("");
  /** 内联 grid：避免部分浏览器不支持 repeat(var(--n), 12px) 导致整段模板作废、子项退化成行内文本连在一起 */
  const monthsGridStyle = `display:grid;grid-template-columns:repeat(${nw},${HEATMAP_COL_PX}px);column-gap:${HEATMAP_GAP_PX}px;width:max-content;max-width:100%`;
  const heatmapGridStyle = `display:grid;grid-template-rows:repeat(7,${HEATMAP_CELL_PX}px);grid-auto-flow:column;grid-auto-columns:${HEATMAP_COL_PX}px;gap:${HEATMAP_GAP_PX}px;width:max-content;max-width:100%;overflow-x:auto;padding-bottom:4px`;
  const matrixStyle = `display:grid;grid-template-columns:18px max-content;column-gap:${HEATMAP_GAP_PX}px;align-items:start;width:max-content;max-width:100%`;
  const dowsStyle = `display:grid;grid-template-rows:repeat(7,${HEATMAP_CELL_PX}px);row-gap:${HEATMAP_GAP_PX}px;width:18px;font-size:10px;color:#7a756c;line-height:12px`;
  const legendStyle = `display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:12px;font-size:11px;color:#7a756c`;
  const statsStyle = `display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:baseline;gap:12px 20px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(230,224,210,0.65);width:100%;box-sizing:border-box;font-size:11px;color:#7a756c`;
  return `
    <div class="order-heatmap-card">
      <div class="order-heatmap-frame duty-roster-card duty-roster-card--calendar">
        <div class="order-heatmap-head">
          <div class="order-heatmap-head-main order-heatmap-caption">总走单：${escapeHtml(totalDisp)}</div>
        </div>
        <div class="order-heatmap-plot-inner">
          <div class="order-heatmap-plot-stack">
            <div class="order-heatmap-months-row" style="display:flex;align-items:flex-end;gap:${HEATMAP_GAP_PX}px;width:max-content;margin-top:12px;margin-bottom:2px" aria-hidden="true">
              <span class="order-heatmap-months-spacer" style="width:18px;flex-shrink:0"></span>
              <div class="order-heatmap-months" style="${monthsGridStyle}">${monthRow}</div>
            </div>
            <div class="order-heatmap-matrix" style="${matrixStyle}">
              <div class="order-heatmap-dows" style="${dowsStyle}" aria-hidden="true">
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px">一</span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px">三</span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px">五</span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
              </div>
              <div class="order-heatmap-grid" style="${heatmapGridStyle}">${flatCells}</div>
            </div>
            <div class="order-heatmap-legend order-heatmap-legend--centered" style="${legendStyle}" aria-hidden="true">
              <span>更少</span>
              <span class="order-heatmap-cell order-heatmap-cell--l0" style="${heatmapDataCellStyle(0)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l1" style="${heatmapDataCellStyle(1)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l2" style="${heatmapDataCellStyle(2)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l3" style="${heatmapDataCellStyle(3)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l4" style="${heatmapDataCellStyle(4)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span>更多</span>
            </div>
          </div>
        </div>
        <div class="order-heatmap-stats" style="${statsStyle}">
          <span class="order-heatmap-caption">最活跃月：${escapeHtml(m.bestMonthLabel)}</span>
          <span class="order-heatmap-caption">最活跃天：${escapeHtml(m.bestDayLabel)}</span>
        </div>
      </div>
      <div id="order-heatmap-tooltip" class="order-heatmap-tooltip" hidden role="tooltip">
        <div class="order-heatmap-tooltip-date"></div>
        <div class="order-heatmap-tooltip-metric"></div>
      </div>
    </div>`;
}

function bindMyHomeHeatmap() {
  const orphanTip = document.body.querySelector("#order-heatmap-tooltip");
  if (orphanTip) orphanTip.remove();

  const home = document.getElementById("home-page");
  const grid = home?.querySelector(".order-heatmap-grid");
  const tip = document.getElementById("order-heatmap-tooltip");
  if (!home || !grid || !tip) return;
  const dateEl = tip.querySelector(".order-heatmap-tooltip-date");
  const metricEl = tip.querySelector(".order-heatmap-tooltip-metric");
  if (!dateEl || !metricEl) return;

  const positionTipNearCell = (cell) => {
    if (tip.parentElement !== document.body) {
      document.body.appendChild(tip);
    }
    const r = cell.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    tip.style.transform = "none";
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.hidden = false;
    tip.style.visibility = "hidden";
    void tip.offsetWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.top - th - gap;
    if (top < margin) {
      top = r.bottom + gap;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - tw - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - th - margin);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = "visible";
  };

  const hide = () => {
    tip.hidden = true;
    tip.style.visibility = "";
  };

  grid.addEventListener(
    "mouseover",
    (e) => {
      const cell = e.target && e.target.closest ? e.target.closest(".order-heatmap-cell[data-date]") : null;
      if (!cell || !grid.contains(cell)) {
        hide();
        return;
      }
      const ymd = cell.getAttribute("data-date") || "";
      const count = Number(cell.getAttribute("data-count") || "0");
      dateEl.textContent = formatZhLongDateFromYmd(ymd);
      metricEl.textContent = `走单量：${Number.isFinite(count) ? count : 0}`;
      positionTipNearCell(cell);
    },
    true
  );

  grid.addEventListener(
    "mouseout",
    (e) => {
      const related = e.relatedTarget;
      if (related && related instanceof Node && grid.contains(related)) return;
      hide();
    },
    true
  );

  if (!window.__yunweiHeatmapScrollHide) {
    window.__yunweiHeatmapScrollHide = () => {
      const t = document.getElementById("order-heatmap-tooltip");
      if (t && !t.hidden) {
        t.hidden = true;
        t.style.visibility = "";
      }
    };
    window.addEventListener("scroll", window.__yunweiHeatmapScrollHide, { passive: true, capture: true });
  }
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

function getWhitelistLevel(fieldKey, whitelist) {
  const map = whitelist || getCurrentWhitelistSettings();
  const raw = String(map?.[fieldKey] || "").trim();
  if (Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, raw)) return raw;
  // 未在策略名单里的，默认可查看
  return "readonly";
}

const REQ_STATUSES = ["待分析", "待RAT决策", "开发中", "已经落地"];
const REQ_STATUS_FORWARD = { "待分析": "待RAT决策", "待RAT决策": "开发中", "开发中": "已经落地" };
const REQ_STATUS_BACKWARD = { "待RAT决策": "待分析", "开发中": "待RAT决策", "已经落地": "开发中" };
let _reqSearchDebounceTimer = null;
const REQ_SEARCH_DEBOUNCE_MS = 400;

async function fetchReqList() {
  const op = getCurrentOperator();
  state.reqListLoading = true;
  render();
  try {
    const scope = state.reqTab === "mine" ? "mine" : state.reqTab === "assigned" ? "assigned" : "all";
    const q = state.reqSearch.trim();
    const r = await fetch(
      `${API_BASE_URL}/api/requirements?operator_id=${encodeURIComponent(op.account)}&scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}&page=${state.reqListPage}&page_size=${state.reqListPageSize}`
    );
    if (!r.ok) {
      state.reqList = [];
      state.reqListTotal = 0;
      return;
    }
    const j = await r.json();
    state.reqList = Array.isArray(j.items) ? j.items : [];
    state.reqListTotal = j.total || 0;
  } catch (_) {
    state.reqList = [];
    state.reqListTotal = 0;
  } finally {
    state.reqListLoading = false;
    render();
  }
}

async function fetchReqDetail(id) {
  const op = getCurrentOperator();
  state.reqDetailLoading = true;
  state.reqDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/requirements/${id}?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.reqDetailBundle = null;
      return;
    }
    state.reqDetailBundle = await r.json();
  } catch (_) {
    state.reqDetailBundle = null;
  } finally {
    state.reqDetailLoading = false;
    render();
  }
}

async function fetchReqDetailLogs(id) {
  const op = getCurrentOperator();
  state.reqDetailLogsLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/requirements/${id}/logs?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.reqDetailLogs = [];
      return;
    }
    const j = await r.json();
    state.reqDetailLogs = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.reqDetailLogs = [];
  } finally {
    state.reqDetailLogsLoading = false;
    render();
  }
}

function formatReqDate(d) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  return s || "—";
}

function formatReqDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function priorityBadgeClass(p) {
  if (p <= 3) return "urgent";
  if (p <= 6) return "high";
  return "low";
}

function categoryBadgeClass(c) {
  if (c === "管控需求") return "cat-control";
  if (c === "内核需求") return "cat-kernel";
  if (c === "管控和内核需求") return "cat-both";
  return "cat-other";
}

function valueBadgeClass(v) {
  if (v === "质量加固") return "val-quality";
  if (v === "性能提升") return "val-perf";
  if (v === "竞争力提升") return "val-compet";
  if (v === "定位能力提升") return "val-locate";
  if (v === "恢复能力提升") return "val-recover";
  if (v === "感知能力提升") return "val-perceive";
  return "val-quality";
}

function renderRequirementPage() {
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("requirement_create", "readonly", whitelist);
  const tabsHtml = `
    <div class="req-tabs">
      <button type="button" class="req-tab ${state.reqTab === "all" ? "active" : ""}" data-req-tab="all">全部需求</button>
      <button type="button" class="req-tab ${state.reqTab === "mine" ? "active" : ""}" data-req-tab="mine">我提出的</button>
      <button type="button" class="req-tab ${state.reqTab === "assigned" ? "active" : ""}" data-req-tab="assigned">我负责的</button>
      <button type="button" class="req-tab ${state.reqTab === "analytics" ? "active" : ""}" data-req-tab="analytics">📊 分析</button>
    </div>`;
  if (state.reqTab === "analytics") {
    return `
    <section class="req-wrap" id="req-management-panel">
      <div class="req-toolbar">
        ${tabsHtml}
        ${renderReqAnalyticsFiltersHtml()}
      </div>
      ${renderReqAnalyticsBodyHtml()}
    </section>`;
  }
  const rows = (state.reqList || [])
    .map((it, idx) => {
      const issues = Array.isArray(it.related_issues) ? it.related_issues.join(", ") : "";
      const pClass = priorityBadgeClass(it.priority);
      const cClass = categoryBadgeClass(it.category || "其他");
      const vClass = valueBadgeClass(it.value || "质量加固");
      return `<tr class="req-row" data-req-id="${it.id}">
        <td>${(state.reqListPage - 1) * state.reqListPageSize + idx + 1}</td>
        <td>${escapeHtml(String(it.requirement_no || ""))}</td>
        <td class="req-title-cell">${escapeHtml(String(it.title || ""))}</td>
        <td>${escapeHtml(String(it.proposer || ""))}</td>
        <td>${escapeHtml(String(it.assignee || ""))}</td>
        <td><span class="p ${pClass}">${it.priority}</span></td>
        <td><span class="cat-tag ${cClass}">${escapeHtml(String(it.category || "其他"))}</span></td>
        <td><span class="val-tag ${vClass}">${escapeHtml(String(it.value || "质量加固"))}</span></td>
        <td>${escapeHtml(String(it.status || ""))}</td>
        <td>${escapeHtml(String(it.planned_version || ""))}</td>
        <td class="req-nowrap">${formatReqDate(it.planned_date)}</td>
      </tr>`;
    })
    .join("");
  const empty = `<tr><td colspan="11" class="req-empty">${state.reqListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  return `
    <section class="req-wrap" id="req-management-panel">
      <div class="req-toolbar">
        ${tabsHtml}
        <div class="req-search">
          <input type="search" id="req-search-input" class="req-search-input" placeholder="搜索编号、标题、描述、提出人、责任人、分类、价值等" value="${escapeAttr(state.reqSearch)}" />
        </div>
        <div class="req-toolbar-right">
          ${canCreate ? '<button type="button" class="action primary" id="req-create-btn">新建</button>' : ""}
        </div>
      </div>
      <div class="req-table-card">
        <table class="req-table">
          <thead>
            <tr>
              <th>序号</th><th>需求编号</th><th>标题</th><th>提出人</th><th>责任人</th><th>优先级</th><th>需求分类</th><th>需求价值</th><th>状态</th><th>计划版本</th><th>计划日期</th>
            </tr>
          </thead>
          <tbody>${state.reqList.length ? rows : empty}</tbody>
        </table>
      </div>
    </section>`;
}

const REQ_ANALYTICS_PRESETS = [
  { key: "1w", label: "近1周", days: 7 },
  { key: "1m", label: "近1月", days: 30 },
  { key: "3m", label: "近3月", days: 90 },
  { key: "custom", label: "自定义", days: 0 },
];

function reqAnalyticsDateBounds() {
  const preset = REQ_ANALYTICS_PRESETS.find((p) => p.key === state.reqAnalyticsPreset);
  const today = new Date();
  let start, end;
  if (preset && preset.days > 0) {
    end = today;
    start = new Date(today);
    start.setDate(start.getDate() - preset.days);
  } else {
    start = state.reqAnalyticsStart ? new Date(state.reqAnalyticsStart) : new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    end = state.reqAnalyticsEnd ? new Date(state.reqAnalyticsEnd) : today;
  }
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

async function fetchReqAnalytics() {
  const { start, end } = reqAnalyticsDateBounds();
  state.reqAnalyticsLoading = true;
  state.reqAnalyticsData = null;
  render();
  try {
    const params = new URLSearchParams({
      operator_id: state.currentUser || "",
      start_date: formatYmdLocal(start),
      end_date: formatYmdLocal(end),
      precision: state.reqAnalyticsPrecision,
    });
    const resp = await fetch(`/api/requirements/analytics?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      state.reqAnalyticsData = { error: err.detail || `HTTP ${resp.status}` };
    } else {
      state.reqAnalyticsData = await resp.json();
    }
  } catch (e) {
    state.reqAnalyticsData = { error: String(e) };
  } finally {
    state.reqAnalyticsLoading = false;
    render();
  }
}

function renderReqAnalyticsFiltersHtml() {
  const presetBtns = REQ_ANALYTICS_PRESETS.map((p) => `<button type="button" class="req-tab ${state.reqAnalyticsPreset === p.key ? "active" : ""}" data-req-analytics-preset="${p.key}">${p.label}</button>`).join("");
  const customRow = state.reqAnalyticsPreset === "custom"
    ? `<span class="req-analytics-date-row">
        <input type="date" id="req-analytics-start" class="req-input" value="${escapeAttr(state.reqAnalyticsStart)}" />
        <span>~</span>
        <input type="date" id="req-analytics-end" class="req-input" value="${escapeAttr(state.reqAnalyticsEnd)}" />
      </span>`
    : "";
  const precBtns = `<span class="req-analytics-prec-row">
    <button type="button" class="req-tab ${state.reqAnalyticsPrecision === "week" ? "active" : ""}" data-req-analytics-prec="week">按周</button>
    <button type="button" class="req-tab ${state.reqAnalyticsPrecision === "month" ? "active" : ""}" data-req-analytics-prec="month">按月</button>
  </span>`;
  return `<div class="req-analytics-filters">${presetBtns}${customRow}${precBtns}</div>`;
}

function renderReqAnalyticsKpiCard(label, value, sub) {
  return `<div class="stat-glass-card req-analytics-kpi"><div class="stat-glass-card-head"><div class="stat-glass-card-title">${escapeHtml(label)}</div></div><div class="req-analytics-kpi-val">${escapeHtml(String(value))}</div>${sub ? `<div class="req-analytics-kpi-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

function renderReqAnalyticsHorizontalBar(items, opts = {}) {
  const maxVal = Math.max(1, ...items.map((it) => it.count));
  const bars = items.map((it, i) => {
    const pct = Math.max(4, Math.round((it.count / maxVal) * 100));
    const c = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
    return `<div class="req-analytics-hbar-row">
      <span class="req-analytics-hbar-label">${escapeHtml(String(it.name || it.label || ""))}</span>
      <div class="req-analytics-hbar-track"><div class="req-analytics-hbar-fill" style="width:${pct}%;background:${c}"></div></div>
      <span class="req-analytics-hbar-val">${it.count}</span>
    </div>`;
  }).join("");
  return `<div class="req-analytics-hbar">${bars}</div>`;
}

function renderReqAnalyticsBodyHtml() {
  if (state.reqAnalyticsLoading) {
    return `<div class="req-analytics-loading">加载中…</div>`;
  }
  const d = state.reqAnalyticsData;
  if (!d) {
    return `<div class="req-analytics-empty">正在加载数据…</div>`;
  }
  if (d.error) {
    return `<div class="req-analytics-error">加载失败：${escapeHtml(d.error)}</div>`;
  }
  const kpi = d.kpi || {};
  const onTimeText = kpi.on_time_rate != null ? `${Math.round(kpi.on_time_rate * 100)}%` : "—";
  const avgPrio = kpi.avg_priority != null ? kpi.avg_priority : "—";
  const kpiRow = `
    <div class="req-analytics-kpi-grid">
      ${renderReqAnalyticsKpiCard("需求总数", kpi.total || 0, "")}
      ${renderReqAnalyticsKpiCard("进行中", kpi.in_progress || 0, "待分析+待RAT决策+开发中")}
      ${renderReqAnalyticsKpiCard("已落地", kpi.landed || 0, `按时落地率 ${onTimeText}`)}
      ${renderReqAnalyticsKpiCard("延期数", kpi.overdue_count || 0, "计划日期已过未落地")}
      ${renderReqAnalyticsKpiCard("平均优先级", avgPrio, "1最高 10最低")}
    </div>`;

  const sd = d.status_distribution || {};
  const statusPie = statLaborSvgPie(
    (sd.labels || []).map((l, i) => ({ label: l, value: (sd.values || [])[i] || 0 })),
    { donut: true, aria: "状态分布" }
  );
  const statusLegend = statLaborPieLegend(
    (sd.labels || []).map((l, i) => ({ label: l, value: (sd.values || [])[i] || 0 }))
  );

  const cd = d.category_distribution || {};
  const categoryPie = statLaborSvgPie(
    (cd.labels || []).map((l, i) => ({ label: l, value: (cd.values || [])[i] || 0 })),
    { donut: true, aria: "需求分类分布" }
  );
  const categoryLegend = statLaborPieLegend(
    (cd.labels || []).map((l, i) => ({ label: l, value: (cd.values || [])[i] || 0 }))
  );

  const vd = d.value_distribution || {};
  const valueItems = (vd.labels || []).map((l, i) => ({ name: l, count: (vd.values || [])[i] || 0 }));
  const valueBar = renderReqAnalyticsHorizontalBar(valueItems, { aria: "需求价值分布" });

  const distSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">分布总览</h2>
      <div class="req-analytics-dist-grid">
        <div class="req-analytics-dist-col">
          <h3>状态分布</h3>
          <div class="req-analytics-chart-center">${statusPie}${statusLegend}</div>
        </div>
        <div class="req-analytics-dist-col">
          <h3>需求分类</h3>
          <div class="req-analytics-chart-center">${categoryPie}${categoryLegend}</div>
        </div>
        <div class="req-analytics-dist-col">
          <h3>需求价值</h3>
          ${valueBar}
        </div>
      </div>
    </div>`;

  const pd = d.priority_distribution || {};
  const prioGroups = pd.groups || [];
  const prioLabels = prioGroups.map((g) => g.label);
  const prioValues = prioGroups.map((g) => g.count);
  const prioBar = statLaborSvgBarVertical(prioLabels, prioValues, { aria: "优先级分布" });
  const prioDetailRows = prioGroups.map((g) => {
    const detail = (g.items || []).map((v, i) => `P${i + (g.label.includes("P1") ? 1 : g.label.includes("P4") ? 4 : 7)}:${v}`).join("  ");
    return `<div class="req-analytics-prio-detail"><strong>${escapeHtml(g.label)}</strong>: ${g.count} 个 (${detail})</div>`;
  }).join("");
  const prioSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">优先级分布</h2>
      <div class="req-analytics-chart-row">${prioBar}</div>
      ${prioDetailRows}
    </div>`;

  const tr = d.trend || {};
  const trendLabels = tr.labels || [];
  const trendCreated = tr.created || [];
  const trendChanged = tr.status_changed || [];
  const trendLanded = tr.landed || [];
  const trendMax = Math.max(1, ...trendCreated, ...trendChanged, ...trendLanded);
  const trendMulti = statLaborSvgMultiLine(trendLabels, [
    { name: "新建", values: trendCreated, stroke: STAT_LABOR_CHART_COLORS[0] },
    { name: "状态变更", values: trendChanged, stroke: STAT_LABOR_CHART_COLORS[4] },
    { name: "已落地", values: trendLanded, stroke: STAT_LABOR_CHART_COLORS[9] },
  ], { aria: "需求趋势", maxHint: trendMax });
  const trendSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">趋势分析</h2>
      <div class="req-analytics-trend-legend">
        <span style="color:${STAT_LABOR_CHART_COLORS[0]}">● 新建</span>
        <span style="color:${STAT_LABOR_CHART_COLORS[4]}">● 状态变更</span>
        <span style="color:${STAT_LABOR_CHART_COLORS[9]}">● 已落地</span>
      </div>
      <div class="req-analytics-chart-row">${trendMulti}</div>
    </div>`;

  const pl = d.person_load || {};
  const proposerBar = renderReqAnalyticsHorizontalBar(pl.top_proposers || [], { aria: "提出人Top10" });
  const assigneeBar = renderReqAnalyticsHorizontalBar(pl.top_assignees || [], { aria: "责任人Top10" });
  const personSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">人员负载</h2>
      <div class="req-analytics-person-grid">
        <div class="req-analytics-person-col"><h3>提出人 Top10</h3>${proposerBar}</div>
        <div class="req-analytics-person-col"><h3>责任人 Top10</h3>${assigneeBar}</div>
      </div>
    </div>`;

  const vp = d.version_plan || {};
  const byVersion = vp.by_version || [];
  const overdueDetails = vp.overdue_details || [];
  let versionSection = "";
  if (byVersion.length > 0) {
    const versionBar = statLaborSvgStackedBars(
      byVersion,
      ["已落地", "进行中", "延期"],
      (gi, key) => {
        const v = byVersion[gi];
        if (key === "已落地") return v.landed;
        if (key === "延期") return v.overdue;
        return v.total - v.landed - v.overdue;
      },
      { aria: "版本计划" }
    );
    const versionTable = `<table class="req-analytics-version-table"><thead><tr><th>版本</th><th>总数</th><th>已落地</th><th>延期</th></tr></thead><tbody>${byVersion.map((v) => `<tr><td>${escapeHtml(v.version)}</td><td>${v.total}</td><td>${v.landed}</td><td class="${v.overdue > 0 ? "req-analytics-overdue" : ""}">${v.overdue}</td></tr>`).join("")}</tbody></table>`;
    versionSection = `
      <div class="req-analytics-block">
        <h2 class="req-analytics-h2">版本计划</h2>
        <div class="req-analytics-chart-row">${versionBar}</div>
        ${versionTable}
      </div>`;
  }
  let overdueSection = "";
  if (overdueDetails.length > 0) {
    const rows = overdueDetails.map((r) => `<tr><td>${escapeHtml(r.requirement_no)}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.planned_date)}</td><td>${escapeHtml(r.status)}</td></tr>`).join("");
    overdueSection = `
      <div class="req-analytics-block">
        <h2 class="req-analytics-h2">延期明细</h2>
        <table class="req-analytics-version-table"><thead><tr><th>需求编号</th><th>标题</th><th>计划日期</th><th>当前状态</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  }

  return `
    <div class="req-analytics-page">
      ${kpiRow}
      ${distSection}
      ${prioSection}
      ${trendSection}
      ${personSection}
      ${versionSection}
      ${overdueSection}
    </div>`;
}

function bindReqAnalyticsPage() {
  document.querySelectorAll("[data-req-analytics-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-req-analytics-preset");
      if (!k) return;
      state.reqAnalyticsPreset = k;
      fetchReqAnalytics();
    });
  });
  document.querySelectorAll("[data-req-analytics-prec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-req-analytics-prec");
      if (!k) return;
      state.reqAnalyticsPrecision = k;
      fetchReqAnalytics();
    });
  });
  const startInput = document.getElementById("req-analytics-start");
  const endInput = document.getElementById("req-analytics-end");
  if (startInput) {
    startInput.addEventListener("change", () => {
      state.reqAnalyticsStart = startInput.value;
      state.reqAnalyticsPreset = "custom";
      fetchReqAnalytics();
    });
  }
  if (endInput) {
    endInput.addEventListener("change", () => {
      state.reqAnalyticsEnd = endInput.value;
      state.reqAnalyticsPreset = "custom";
      fetchReqAnalytics();
    });
  }
}

function renderRequirementModalsHtml() {
  const createOpen = state.reqCreateOpen
    ? (() => {
        const issueRows = (state.reqDraftRelatedIssues || [""])
          .map((v, i) => `<div class="req-related-issue-row">
            <input type="text" class="req-input req-related-issue-input" data-req-issue-idx="${i}" value="${escapeAttr(String(v || ""))}" placeholder="工单号或DTS单号" />
            <button type="button" class="action danger req-related-issue-del" data-req-issue-idx="${i}" ${state.reqDraftRelatedIssues.length <= 1 ? "disabled" : ""}>删除</button>
          </div>`)
          .join("");
        return `<div class="perm-modal-mask req-modal-mask" id="req-create-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>新建需求</h3></div>
          <div class="perm-modal-body req-create-body">
            <label class="req-field">需求标题 *
              <input type="text" id="req-create-title" class="req-input" placeholder="请输入需求标题" />
            </label>
            <label class="req-field">详细描述 *
              <textarea id="req-create-desc" class="req-textarea" rows="3" placeholder="请输入详细描述"></textarea>
            </label>
            <label class="req-field">需求提出人 *
              <input type="text" id="req-create-proposer" class="req-input" placeholder="例如：张三 zhangsan" />
            </label>
            <label class="req-field">需求分类 *
              <select id="req-create-category" class="req-input">
                <option value="管控需求">管控需求</option>
                <option value="内核需求">内核需求</option>
                <option value="管控和内核需求">管控和内核需求</option>
                <option value="其他" selected>其他</option>
              </select>
            </label>
            <label class="req-field">需求价值 *
              <select id="req-create-value" class="req-input">
                <option value="质量加固" selected>质量加固</option>
                <option value="性能提升">性能提升</option>
                <option value="竞争力提升">竞争力提升</option>
                <option value="定位能力提升">定位能力提升</option>
                <option value="恢复能力提升">恢复能力提升</option>
                <option value="感知能力提升">感知能力提升</option>
              </select>
            </label>
            <label class="req-field">当前责任人 *
              <input type="text" id="req-create-assignee" class="req-input" placeholder="例如：李四 lisi" />
            </label>
            <div class="req-field">
              <span>关联问题（选填）</span>
              <div id="req-create-issues">${issueRows}</div>
              <button type="button" class="action" id="req-add-issue-btn">+ 添加关联</button>
            </div>
            <label class="req-field">需求单号（选填）
              <input type="text" id="req-create-ext-no" class="req-input" placeholder="外部需求单号" />
            </label>
            <label class="req-field">计划落地版本（选填）
              <input type="text" id="req-create-version" class="req-input" placeholder="例如：V8.2.0" />
            </label>
            <label class="req-field">计划落地日期（选填）
              <input type="date" id="req-create-planned-date" class="req-input" />
            </label>
            <label class="req-field">优先级 *（1最高，10最低）
              <input type="number" id="req-create-priority" class="req-input" min="1" max="10" value="5" />
            </label>
            <label class="req-field">备注
              <textarea id="req-create-remark" class="req-textarea" rows="2" placeholder="备注信息"></textarea>
            </label>
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-create-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-create-submit-btn">提交</button>
          </div>
        </div></div>`;
      })()
    : "";

  const detail = state.reqDetailId
    ? (() => {
        const b = state.reqDetailBundle;
        const loading = state.reqDetailLoading;
        const op = getCurrentOperator();
        const isCreator = b && String(b.creator_id || "").trim() === String(op.account || "").trim();
        const canEdit = isCreator || (b && String(b.assignee || "").includes(op.account || "___"));
        const canDelete = isCreator && b && String(b.status || "").trim() === "待分析";
        const issues = Array.isArray(b?.related_issues) ? b.related_issues.join("，") : "—";
        const logRows = (state.reqDetailLogs || [])
          .map((lg) => {
            const actionLabel = String(lg.action || "") === "created" ? "创建需求" : String(lg.action || "") === "status_changed" ? "状态变更" : "编辑更新";
            const statusChange = lg.from_status && lg.to_status ? `${escapeHtml(lg.from_status)} → ${escapeHtml(lg.to_status)}` : "";
            return `<tr>
              <td>${escapeHtml(formatReqDateTime(lg.created_at))}</td>
              <td>${escapeHtml(String(lg.operator_name || ""))}</td>
              <td>${escapeHtml(actionLabel)}</td>
              <td>${statusChange}</td>
              <td>${escapeHtml(String(lg.comment || ""))}</td>
            </tr>`;
          })
          .join("");
        return `<div class="perm-modal-mask req-modal-mask" id="req-detail-mask">
        <div class="perm-modal req-modal req-detail-modal" role="dialog">
          <div class="perm-modal-head"><h3>需求详情 ${b ? escapeHtml(String(b.requirement_no || "")) : ""}</h3></div>
          <div class="perm-modal-body">
            ${loading ? "<p>加载中…</p>" : ""}
            ${
              b
                ? `<div class="req-detail-meta">
              <p><strong>状态</strong> <span class="p ${priorityBadgeClass(b.priority)}">${escapeHtml(String(b.status || ""))}</span> · <strong>优先级</strong> ${b.priority} · <strong>需求分类</strong> <span class="cat-tag ${categoryBadgeClass(b.category || "其他")}">${escapeHtml(String(b.category || "其他"))}</span> · <strong>需求价值</strong> <span class="val-tag ${valueBadgeClass(b.value || "质量加固")}">${escapeHtml(String(b.value || "质量加固"))}</span></p>
              <p><strong>需求标题</strong> ${escapeHtml(String(b.title || ""))}</p>
              <p><strong>需求提出人</strong> ${escapeHtml(String(b.proposer || ""))} · <strong>当前责任人</strong> ${escapeHtml(String(b.assignee || ""))}</p>
              <p><strong>需求单号</strong> ${escapeHtml(String(b.external_req_no || "—"))} · <strong>计划版本</strong> ${escapeHtml(String(b.planned_version || "—"))} · <strong>计划日期</strong> ${formatReqDate(b.planned_date)}</p>
              <p><strong>关联问题</strong> ${escapeHtml(issues)}</p>
              <div class="req-detail-desc"><strong>详细描述</strong><div class="req-detail-desc-content">${escapeHtml(String(b.description || ""))}</div></div>
              ${String(b.remark || "").trim() ? `<p><strong>备注</strong> ${escapeHtml(String(b.remark || ""))}</p>` : ""}
              <p><strong>创建人</strong> ${escapeHtml(String(b.creator_name || ""))} · <strong>创建时间</strong> ${formatReqDateTime(b.created_at)}</p>
            </div>
            ${
              canEdit
                ? `<div class="req-detail-actions">
              <button type="button" class="action" id="req-detail-edit-btn">编辑</button>
              ${
                REQ_STATUS_FORWARD[String(b.status || "").trim()]
                  ? `<button type="button" class="action primary" data-req-status-forward="${escapeAttr(REQ_STATUS_FORWARD[String(b.status || "").trim()])}">流转至「${REQ_STATUS_FORWARD[String(b.status || "").trim()]}」</button>`
                  : ""
              }
              ${
                REQ_STATUS_BACKWARD[String(b.status || "").trim()]
                  ? `<button type="button" class="action danger" data-req-status-backward="${escapeAttr(REQ_STATUS_BACKWARD[String(b.status || "").trim()])}">回退至「${REQ_STATUS_BACKWARD[String(b.status || "").trim()]}」</button>`
                  : ""
              }
              ${canDelete ? `<button type="button" class="action danger" id="req-detail-delete-btn">删除</button>` : ""}
            </div>`
                : ""
            }
            <h4 class="req-subhd">操作日志</h4>
            <table class="req-mini-table">
              <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>状态变更</th><th>备注</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="5" class="req-empty">暂无</td></tr>`}</tbody>
            </table>`
                : "<p>无法加载</p>"
            }
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-detail-close-btn">关闭</button>
          </div>
        </div></div>`;
      })()
    : "";

  const editOpen = state.reqEditOpen && state.reqDetailBundle
    ? (() => {
        const b = state.reqDetailBundle;
        const issueRows = (state.reqDraftRelatedIssues || [""])
          .map((v, i) => `<div class="req-related-issue-row">
            <input type="text" class="req-input req-related-issue-input" data-req-edit-issue-idx="${i}" value="${escapeAttr(String(v || ""))}" placeholder="工单号或DTS单号" />
            <button type="button" class="action danger req-edit-issue-del" data-req-edit-issue-idx="${i}" ${state.reqDraftRelatedIssues.length <= 1 ? "disabled" : ""}>删除</button>
          </div>`)
          .join("");
        return `<div class="perm-modal-mask req-modal-mask" id="req-edit-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>编辑需求</h3></div>
          <div class="perm-modal-body req-create-body">
            <label class="req-field">需求标题 *
              <input type="text" id="req-edit-title" class="req-input" value="${escapeAttr(String(b.title || ""))}" />
            </label>
            <label class="req-field">详细描述 *
              <textarea id="req-edit-desc" class="req-textarea" rows="3">${escapeHtml(String(b.description || ""))}</textarea>
            </label>
            <label class="req-field">需求提出人 *
              <input type="text" id="req-edit-proposer" class="req-input" value="${escapeAttr(String(b.proposer || ""))}" />
            </label>
            <label class="req-field">需求分类 *
              <select id="req-edit-category" class="req-input">
                <option value="管控需求" ${String(b.category || "") === "管控需求" ? "selected" : ""}>管控需求</option>
                <option value="内核需求" ${String(b.category || "") === "内核需求" ? "selected" : ""}>内核需求</option>
                <option value="管控和内核需求" ${String(b.category || "") === "管控和内核需求" ? "selected" : ""}>管控和内核需求</option>
                <option value="其他" ${String(b.category || "其他") === "其他" ? "selected" : ""}>其他</option>
              </select>
            </label>
            <label class="req-field">需求价值 *
              <select id="req-edit-value" class="req-input">
                <option value="质量加固" ${String(b.value || "质量加固") === "质量加固" ? "selected" : ""}>质量加固</option>
                <option value="性能提升" ${String(b.value || "") === "性能提升" ? "selected" : ""}>性能提升</option>
                <option value="竞争力提升" ${String(b.value || "") === "竞争力提升" ? "selected" : ""}>竞争力提升</option>
                <option value="定位能力提升" ${String(b.value || "") === "定位能力提升" ? "selected" : ""}>定位能力提升</option>
                <option value="恢复能力提升" ${String(b.value || "") === "恢复能力提升" ? "selected" : ""}>恢复能力提升</option>
                <option value="感知能力提升" ${String(b.value || "") === "感知能力提升" ? "selected" : ""}>感知能力提升</option>
              </select>
            </label>
            <label class="req-field">当前责任人 *
              <input type="text" id="req-edit-assignee" class="req-input" value="${escapeAttr(String(b.assignee || ""))}" />
            </label>
            <div class="req-field">
              <span>关联问题</span>
              <div id="req-edit-issues">${issueRows}</div>
              <button type="button" class="action" id="req-edit-add-issue-btn">+ 添加关联</button>
            </div>
            <label class="req-field">需求单号
              <input type="text" id="req-edit-ext-no" class="req-input" value="${escapeAttr(String(b.external_req_no || ""))}" />
            </label>
            <label class="req-field">计划落地版本
              <input type="text" id="req-edit-version" class="req-input" value="${escapeAttr(String(b.planned_version || ""))}" />
            </label>
            <label class="req-field">计划落地日期
              <input type="date" id="req-edit-planned-date" class="req-input" value="${escapeAttr(formatReqDate(b.planned_date))}" />
            </label>
            <label class="req-field">优先级 *（1最高，10最低）
              <input type="number" id="req-edit-priority" class="req-input" min="1" max="10" value="${b.priority || 5}" />
            </label>
            <label class="req-field">备注
              <textarea id="req-edit-remark" class="req-textarea" rows="2">${escapeHtml(String(b.remark || ""))}</textarea>
            </label>
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-edit-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-edit-submit-btn">保存</button>
          </div>
        </div></div>`;
      })()
    : "";

  return createOpen + detail + editOpen;
}

function bindRequirementPage() {
  if (state.reqNeedsRefresh) {
    state.reqNeedsRefresh = false;
    void fetchReqList();
  }
  document.querySelectorAll("[data-req-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-req-tab");
      if (t !== "all" && t !== "mine" && t !== "assigned" && t !== "analytics") return;
      state.reqTab = t;
      state.reqListPage = 1;
      if (t === "analytics") {
        if (!state.reqAnalyticsData) fetchReqAnalytics();
        render();
        bindReqAnalyticsPage();
        return;
      }
      render();
      void fetchReqList();
    });
  });
  const searchInp = document.getElementById("req-search-input");
  const scheduleSearch = () => {
    if (_reqSearchDebounceTimer) clearTimeout(_reqSearchDebounceTimer);
    _reqSearchDebounceTimer = setTimeout(() => {
      _reqSearchDebounceTimer = null;
      void fetchReqList();
    }, REQ_SEARCH_DEBOUNCE_MS);
  };
  searchInp?.addEventListener("input", (ev) => {
    state.reqSearch = searchInp.value || "";
    if (ev.isComposing) return;
    scheduleSearch();
  });
  searchInp?.addEventListener("compositionend", () => {
    state.reqSearch = searchInp.value || "";
    scheduleSearch();
  });
  searchInp?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    if (_reqSearchDebounceTimer) {
      clearTimeout(_reqSearchDebounceTimer);
      _reqSearchDebounceTimer = null;
    }
    state.reqSearch = searchInp.value || "";
    void fetchReqList();
  });
  document.getElementById("req-create-btn")?.addEventListener("click", () => {
    state.reqDraftRelatedIssues = [""];
    state.reqCreateOpen = true;
    render();
  });
  document.getElementById("req-create-cancel-btn")?.addEventListener("click", () => {
    state.reqCreateOpen = false;
    render();
  });
  document.getElementById("req-create-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-create-mask")) {
      state.reqCreateOpen = false;
      render();
    }
  });
  document.getElementById("req-add-issue-btn")?.addEventListener("click", () => {
    state.reqDraftRelatedIssues.push("");
    render();
  });
  document.querySelectorAll(".req-related-issue-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-req-issue-idx") || "-1", 10);
      if (idx >= 0 && state.reqDraftRelatedIssues.length > 1) {
        state.reqDraftRelatedIssues.splice(idx, 1);
        render();
      }
    });
  });
  document.getElementById("req-create-submit-btn")?.addEventListener("click", async () => {
    const title = (document.getElementById("req-create-title")?.value || "").trim();
    const desc = (document.getElementById("req-create-desc")?.value || "").trim();
    const proposer = (document.getElementById("req-create-proposer")?.value || "").trim();
    const category = (document.getElementById("req-create-category")?.value || "其他").trim();
    const reqValue = (document.getElementById("req-create-value")?.value || "质量加固").trim();
    const assignee = (document.getElementById("req-create-assignee")?.value || "").trim();
    const extNo = (document.getElementById("req-create-ext-no")?.value || "").trim();
    const version = (document.getElementById("req-create-version")?.value || "").trim();
    const plannedDate = (document.getElementById("req-create-planned-date")?.value || "").trim();
    const priority = parseInt(document.getElementById("req-create-priority")?.value || "5", 10);
    const remark = (document.getElementById("req-create-remark")?.value || "").trim();
    document.querySelectorAll(".req-related-issue-input").forEach((inp, i) => {
      state.reqDraftRelatedIssues[i] = inp.value || "";
    });
    const relatedIssues = state.reqDraftRelatedIssues.filter((v) => v.trim());
    if (!title) { window.alert("需求标题不能为空"); return; }
    if (!desc) { window.alert("详细描述不能为空"); return; }
    if (!proposer) { window.alert("需求提出人不能为空"); return; }
    if (!assignee) { window.alert("当前责任人不能为空"); return; }
    if (priority < 1 || priority > 10) { window.alert("优先级须为1-10"); return; }
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          title, description: desc, proposer, assignee, category, value: reqValue,
          related_issues: relatedIssues,
          external_req_no: extNo, planned_version: version,
          planned_date: plannedDate || null,
          priority, remark,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`创建失败：${t.slice(0, 200)}`);
        return;
      }
      state.reqCreateOpen = false;
      await fetchReqList();
    } catch (e) {
      window.alert(`创建失败：${String(e.message || e)}`);
    }
  });
  document.querySelector("#req-management-panel .req-table tbody")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.req-row");
    if (!tr) return;
    const id = parseInt(tr.getAttribute("data-req-id") || "-1", 10);
    if (!Number.isFinite(id) || id < 0) return;
    state.reqDetailId = id;
    void fetchReqDetail(id);
    void fetchReqDetailLogs(id);
  });
  document.getElementById("req-detail-close-btn")?.addEventListener("click", () => {
    state.reqDetailId = null;
    state.reqDetailBundle = null;
    state.reqDetailLogs = [];
    state.reqEditOpen = false;
    render();
  });
  document.getElementById("req-detail-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-detail-mask")) {
      state.reqDetailId = null;
      state.reqDetailBundle = null;
      state.reqDetailLogs = [];
      state.reqEditOpen = false;
      render();
    }
  });
  document.getElementById("req-detail-edit-btn")?.addEventListener("click", () => {
    if (!state.reqDetailBundle) return;
    const b = state.reqDetailBundle;
    state.reqDraftRelatedIssues = Array.isArray(b.related_issues) && b.related_issues.length > 0 ? [...b.related_issues] : [""];
    state.reqEditOpen = true;
    render();
  });
  document.getElementById("req-edit-cancel-btn")?.addEventListener("click", () => {
    state.reqEditOpen = false;
    render();
  });
  document.getElementById("req-edit-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-edit-mask")) {
      state.reqEditOpen = false;
      render();
    }
  });
  document.getElementById("req-edit-add-issue-btn")?.addEventListener("click", () => {
    state.reqDraftRelatedIssues.push("");
    render();
  });
  document.querySelectorAll(".req-edit-issue-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-req-edit-issue-idx") || "-1", 10);
      if (idx >= 0 && state.reqDraftRelatedIssues.length > 1) {
        state.reqDraftRelatedIssues.splice(idx, 1);
        render();
      }
    });
  });
  document.getElementById("req-edit-submit-btn")?.addEventListener("click", async () => {
    if (!state.reqDetailBundle) return;
    const b = state.reqDetailBundle;
    const title = (document.getElementById("req-edit-title")?.value || "").trim();
    const desc = (document.getElementById("req-edit-desc")?.value || "").trim();
    const proposer = (document.getElementById("req-edit-proposer")?.value || "").trim();
    const category = (document.getElementById("req-edit-category")?.value || "其他").trim();
    const reqValue = (document.getElementById("req-edit-value")?.value || "质量加固").trim();
    const assignee = (document.getElementById("req-edit-assignee")?.value || "").trim();
    const extNo = (document.getElementById("req-edit-ext-no")?.value || "").trim();
    const version = (document.getElementById("req-edit-version")?.value || "").trim();
    const plannedDate = (document.getElementById("req-edit-planned-date")?.value || "").trim();
    const priority = parseInt(document.getElementById("req-edit-priority")?.value || "5", 10);
    const remark = (document.getElementById("req-edit-remark")?.value || "").trim();
    document.querySelectorAll(".req-related-issue-input").forEach((inp, i) => {
      state.reqDraftRelatedIssues[i] = inp.value || "";
    });
    const relatedIssues = state.reqDraftRelatedIssues.filter((v) => v.trim());
    if (!title) { window.alert("需求标题不能为空"); return; }
    if (!desc) { window.alert("详细描述不能为空"); return; }
    if (!proposer) { window.alert("需求提出人不能为空"); return; }
    if (!assignee) { window.alert("当前责任人不能为空"); return; }
    if (priority < 1 || priority > 10) { window.alert("优先级须为1-10"); return; }
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          title, description: desc, proposer, assignee, category, value: reqValue,
          related_issues: relatedIssues,
          external_req_no: extNo, planned_version: version,
          planned_date: plannedDate || null,
          priority, remark,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`保存失败：${t.slice(0, 200)}`);
        return;
      }
      state.reqEditOpen = false;
      await fetchReqDetail(b.id);
      await fetchReqDetailLogs(b.id);
      await fetchReqList();
    } catch (e) {
      window.alert(`保存失败：${String(e.message || e)}`);
    }
  });
  document.querySelectorAll("[data-req-status-forward]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.reqDetailBundle) return;
      const newStatus = btn.getAttribute("data-req-status-forward");
      if (!newStatus) return;
      if (!window.confirm(`确定流转至「${newStatus}」？`)) return;
      const op = getCurrentOperator();
      try {
        const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, status: newStatus }),
        });
        if (!r.ok) {
          const t = await r.text();
          window.alert(`流转失败：${t.slice(0, 200)}`);
          return;
        }
        await fetchReqDetail(state.reqDetailBundle.id);
        await fetchReqDetailLogs(state.reqDetailBundle.id);
        await fetchReqList();
      } catch (e) {
        window.alert(`流转失败：${String(e.message || e)}`);
      }
    });
  });
  document.querySelectorAll("[data-req-status-backward]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.reqDetailBundle) return;
      const newStatus = btn.getAttribute("data-req-status-backward");
      if (!newStatus) return;
      if (!window.confirm(`确定回退至「${newStatus}」？`)) return;
      const op = getCurrentOperator();
      try {
        const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, status: newStatus }),
        });
        if (!r.ok) {
          const t = await r.text();
          window.alert(`回退失败：${t.slice(0, 200)}`);
          return;
        }
        await fetchReqDetail(state.reqDetailBundle.id);
        await fetchReqDetailLogs(state.reqDetailBundle.id);
        await fetchReqList();
      } catch (e) {
        window.alert(`回退失败：${String(e.message || e)}`);
      }
    });
  });
  document.getElementById("req-detail-delete-btn")?.addEventListener("click", async () => {
    if (!state.reqDetailBundle) return;
    if (!window.confirm("确定删除此需求？仅「待分析」状态可删除。")) return;
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}?operator_id=${encodeURIComponent(op.account)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`删除失败：${t.slice(0, 200)}`);
        return;
      }
      state.reqDetailId = null;
      state.reqDetailBundle = null;
      state.reqDetailLogs = [];
      await fetchReqList();
    } catch (e) {
      window.alert(`删除失败：${String(e.message || e)}`);
    }
  });
  if (state.reqTab === "analytics") {
    bindReqAnalyticsPage();
  }
}

function whitelistAllows(fieldKey, minLevel, whitelist) {
  if (!fieldKey) return true;
  const need = minLevel || "readonly";
  return getPermissionLevelRank(getWhitelistLevel(fieldKey, whitelist)) >= getPermissionLevelRank(need);
}

function getWhitelistKeyByActiveKey(activeKey) {
  const key = String(activeKey || "");
  if (key === "home") return "home";
  if (key === "list") return "ticket_list";
  if (key === "duty:roster") return "duty_roster";
  if (key === "leave:application") return "leave_application";
  if (key === "req:manage") return "requirement_list";
  if (key === "admin:permissions") return "admin_permissions";
  if (key === "admin:users") return "admin_users";
  if (key === "stats:charts" || key === "stats:report") return "stats_dashboard";
  if (key === "ai:assistant") return "ai_assistant";
  if (key === "params:llm-config") return "params_llm_config";
  if (key.startsWith("params:")) return "params_config";
  if (key.startsWith("ticket:")) return "ticket_detail";
  return "";
}

function isActiveKeyVisible(activeKey, whitelist) {
  const fieldKey = getWhitelistKeyByActiveKey(activeKey);
  if (!fieldKey) return true;
  return whitelistAllows(fieldKey, "readonly", whitelist);
}

function getDefaultVisibleActiveKey(whitelist) {
  if (whitelistAllows("home", "readonly", whitelist)) return ensureHomeTab();
  if (whitelistAllows("ticket_list", "readonly", whitelist)) return ensureListTab();
  if (whitelistAllows("duty_roster", "readonly", whitelist)) return ensureDutyTab();
  if (whitelistAllows("leave_application", "readonly", whitelist)) return ensureLeaveTab();
  if (whitelistAllows("requirement_list", "readonly", whitelist)) return ensureRequirementTab();
  if (whitelistAllows("stats_dashboard", "readonly", whitelist)) return ensureStatsChartsTab();
  return ensureSettingsTab();
}

function getCreateModalStartNodeKey() {
  const whitelist = getCurrentWhitelistSettings();
  const fromProblemFill = getWhitelistLevel("workbench_create_from_problem_fill", whitelist) === "editable";
  return fromProblemFill ? "problem_fill" : "ops_analysis";
}

function beginCreateTicketModal() {
  const operator = getCurrentOperator();
  const orderId = makeNewTicketId();
  const nodeKey = getCreateModalStartNodeKey();
  const stepLabel = STEP_BY_NODE_KEY[nodeKey] || "运维分析";
  state.createTicketId = orderId;
  state.createModalOpen = true;
  state.createModalNodeKey = nodeKey;
  workflowByOrderId[orderId] = {
    currentStep: WORKFLOW_NODES.indexOf(stepLabel),
    logs: [
      {
        step: stepLabel,
        actor: operator.userName,
        at: nowText(),
        summary: `创建工单并从${stepLabel}节点开始。`,
      },
    ],
  };
  operationLogsByOrderId[orderId] = [];
  ensureNodeFormData(orderId, nodeKey);
  render();
}

function getWorkbenchListBaseTickets(operator) {
  const whitelist = getCurrentWhitelistSettings();
  const onlyMyCreated = getWhitelistLevel("ticket_list", whitelist) === "editable";
  return onlyMyCreated
    ? getAllTickets().filter((t) => ticketCreatorMatchesOperator(t, operator))
    : getAllTickets();
}

/** 我的主页 · 工单列表：待办工单 / 待关单 / 待审核关闭（待审批为请假列表，不走本函数） */
function filterTicketsByHomeWorkbenchTab(tickets, tab, operator) {
  const list = tickets || [];
  if (tab === "leave_pending") return [];
  if (tab === "pending") {
    return list.filter((t) => {
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesPersonField(handler, operator);
    });
  }
  if (tab === "pending_close") {
    return list.filter((t) => {
      const st = String(t.status || "").toLowerCase();
      if (st === "closed") return false;
      return Boolean(t.operatorSubmitted);
    });
  }
  if (tab === "audit_close") {
    return list.filter((t) => {
      const nk = String(t.node_key || "").trim();
      if (nk !== "audit_close") return false;
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesPersonField(handler, operator);
    });
  }
  return list;
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
  if (pathname === "/requirements" || pathname === "/requirements/") {
    state.activeKey = ensureRequirementTab();
    state.reqNeedsRefresh = true;
    return;
  }
  if (pathname === "/settings/appearance" || pathname === "/settings/appearance/") {
    state.activeKey = ensureSettingsTab();
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
  if (pathname === "/params/llm-config" || pathname === "/params/llm-config/") {
    state.activeKey = ensureParamsTab("llm-config");
    state.aiLlmConfigLoading = true;
    return;
  }
  if (pathname === "/ai-assistant" || pathname === "/ai-assistant/") {
    state.activeKey = ensureAiTab();
    state.aiNeedsRefresh = true;
    return;
  }
  if (pathname === "/" || pathname === "") {
    state.activeKey = ensureHomeTab();
    return;
  }
  if (pathname === "/workbench" || pathname === "/workbench/") {
    state.activeKey = ensureListTab();
    return;
  }
  if (pathname === "/stats/charts" || pathname === "/stats/charts/") {
    state.activeKey = ensureStatsChartsTab();
    return;
  }
  if (pathname === "/stats/report" || pathname === "/stats/report/") {
    state.activeKey = ensureStatsReportTab();
    return;
  }
  const match = pathname.match(/^\/tickets\/([^/]+)\/?$/);
  if (!match) {
    state.activeKey = ensureHomeTab();
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

function formatYmdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {"1d"|"1w"|"1m"|"6m"|"1y"} preset */
function applyStatsLaborPreset(preset) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  switch (preset) {
    case "1d":
      break;
    case "1w":
      start.setDate(start.getDate() - 6);
      break;
    case "1m":
      start.setDate(start.getDate() - 29);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return;
  }
  state.statsLaborPreset = preset;
  state.statsLaborStart = formatYmdLocal(start);
  state.statsLaborEnd = formatYmdLocal(end);
}

function ensureStatsLaborRangeInit() {
  if (!state.statsLaborStart || !state.statsLaborEnd) {
    applyStatsLaborPreset(state.statsLaborPreset || "1w");
  }
}

/** @param {"1d"|"1w"|"1m"|"6m"|"1y"} preset */
function applyHomePersonalPreset(preset) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  switch (preset) {
    case "1d":
      break;
    case "1w":
      start.setDate(start.getDate() - 6);
      break;
    case "1m":
      start.setDate(start.getDate() - 29);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return;
  }
  state.homePersonalPreset = preset;
  state.homePersonalStart = formatYmdLocal(start);
  state.homePersonalEnd = formatYmdLocal(end);
}

function ensureHomePersonalRangeInit() {
  if (!state.homePersonalStart || !state.homePersonalEnd) {
    applyHomePersonalPreset(state.homePersonalPreset || "1w");
  }
}

/** @param {"1d"|"1w"|"1m"|"6m"|"1y"} preset */
function applyStatsOwnershipPreset(preset) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  switch (preset) {
    case "1d":
      break;
    case "1w":
      start.setDate(start.getDate() - 6);
      break;
    case "1m":
      start.setDate(start.getDate() - 29);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return;
  }
  state.statsOwnershipPreset = preset;
  state.statsOwnershipStart = formatYmdLocal(start);
  state.statsOwnershipEnd = formatYmdLocal(end);
}

function ensureStatsOwnershipRangeInit() {
  if (!state.statsOwnershipStart || !state.statsOwnershipEnd) {
    applyStatsOwnershipPreset(state.statsOwnershipPreset || "1w");
  }
}

function parseYmdToDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {"year"|"quarter"|"month"|"day"} precision
 * @returns {{ labels: string[], n: number }}
 */
function buildStatsOwnershipTimeLabels(startYmd, endYmd, precision) {
  const start = parseYmdToDate(startYmd);
  const end = parseYmdToDate(endYmd);
  if (!start || !end || start > end) return { labels: ["—"], n: 1 };
  const labels = [];
  if (precision === "day") {
    const d = new Date(start);
    const endT = end.getTime();
    let guard = 0;
    while (d.getTime() <= endT && guard < 400) {
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      d.setDate(d.getDate() + 1);
      guard += 1;
    }
  } else if (precision === "month") {
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    const endM = new Date(end.getFullYear(), end.getMonth(), 1);
    while (d <= endM) {
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      d.setMonth(d.getMonth() + 1);
    }
  } else if (precision === "quarter") {
    const d = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
    const endT = end.getTime();
    let guard = 0;
    while (d.getTime() <= endT && guard < 80) {
      const q = Math.floor(d.getMonth() / 3) + 1;
      labels.push(`${d.getFullYear()}Q${q}`);
      d.setMonth(d.getMonth() + 3);
      guard += 1;
    }
  } else {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) labels.push(String(y));
  }
  if (!labels.length) labels.push("—");
  return { labels, n: labels.length };
}

function statsOwnershipQuerySeed() {
  ensureStatsOwnershipRangeInit();
  return [
    state.statsOwnershipStart,
    state.statsOwnershipEnd,
    state.statsOwnershipPrecision,
    state.statsOwnershipQuality,
    state.statsOwnershipComponent,
  ].join("|");
}

function statsTicketDayYmd(ticket) {
  const s = String(ticket?.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = ticketCreatedAtMs(ticket);
  if (!ms) return "";
  return formatYmdLocal(new Date(ms));
}

function statsNormalizePersonName(raw) {
  const base = String(raw || "").trim();
  if (!base) return "";
  const compact = base.replace(/[()（）]/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const accountLike = (token) => /^[a-zA-Z]\d{6,}$/.test(String(token || "").trim());
  const tokens = compact.split(" ").filter(Boolean);
  if (!tokens.length) return compact;
  const nonAccountTokens = tokens.filter((t) => !accountLike(t));
  if (nonAccountTokens.length && nonAccountTokens.length !== tokens.length) {
    return nonAccountTokens.join(" ");
  }
  const withoutSuffix = compact.replace(/[\s·_-]*[a-zA-Z]\d{6,}$/i, "").trim();
  if (withoutSuffix) return withoutSuffix;
  return compact;
}

function statsTicketPersonName(ticket) {
  const raw = String(ticket?.currentHandler || ticket?.assignee || ticket?.creatorName || "").trim();
  return statsNormalizePersonName(raw) || "未分配";
}

function statsTicketStage(ticket) {
  const st = String(ticket?.status || "").trim().toLowerCase();
  if (st === "closed") return "关闭";
  if (st === "suspended") return "暂时挂起";
  return String(ticket?.currentStage || ticket?.node || "").trim() || "问题审核";
}

function statsTicketIsQuality(ticket) {
  const sev = normalizeIssueSeverity(ticket?.severity || "");
  return sev === "严重" || sev === "致命";
}

function statsTicketQualityIssueValue(ticket) {
  const raw = String(ticket?.isQualityIssue ?? ticket?.is_quality_issue ?? "").trim();
  if (!raw) return "";
  if (raw.includes("新发现")) return "new";
  if (raw.includes("已知")) return "known";
  if (raw === "否") return "no";
  if (raw === "是") return "known";
  return "";
}

function statsTicketComponent(ticket) {
  const raw = String(ticket?.component || ticket?.problemComponent || "").trim();
  if (raw.includes("内核")) return "kernel";
  if (raw.includes("管控")) return "control";
  const desc = String(ticket?.description || "");
  if (desc.includes("内核")) return "kernel";
  if (desc.includes("管控")) return "control";
  return "all";
}

function statsTicketVersion(ticket) {
  const direct = String(ticket?.hcsVersion || ticket?.version || "").trim();
  if (direct) return direct;
  const desc = String(ticket?.description || "");
  const m = desc.match(/(\d+\.\d+(?:\.\d+)?(?:\.SPC\d+)?)/);
  if (m) return m[1];
  return "未知版本";
}

function statsTicketsInRange(startYmd, endYmd) {
  const start = parseYmdToDate(startYmd);
  const end = parseYmdToDate(endYmd);
  const all = getAllTickets();
  if (!start || !end || start > end) return all;
  const s = formatYmdLocal(start);
  const e = formatYmdLocal(end);
  return all.filter((t) => {
    const ymd = statsTicketDayYmd(t);
    return ymd && ymd >= s && ymd <= e;
  });
}

function statsUserGroupByTicket(ticket) {
  const handler = String(ticket?.currentHandler || ticket?.assignee || "").trim();
  const creator = String(ticket?.creatorName || "").trim();
  const candidates = [handler, creator].filter(Boolean);
  for (let i = 0; i < candidates.length; i += 1) {
    const name = candidates[i];
    const normalized = statsNormalizePersonName(name);
    const hit = state.adminUsers.find((u) => {
      const userName = String(u.user_name || "").trim();
      const account = String(u.account || "").trim();
      const userNameNormalized = statsNormalizePersonName(userName);
      return userName === name || account === name || userNameNormalized === normalized || account === normalized;
    });
    if (hit && String(hit.group_name || "").trim()) return String(hit.group_name || "").trim();
  }
  return "未分组";
}

function statsGroupByPrecisionLabel(ymd, precision) {
  const d = parseYmdToDate(ymd);
  if (!d) return "—";
  if (precision === "day") return `${d.getMonth() + 1}/${d.getDate()}`;
  if (precision === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (precision === "quarter") return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
  return String(d.getFullYear());
}

function statsCountBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

/** 人力投入统计页：演示用人名（按小组） */
const STAT_LABOR_DEMO_ROSTER = {
  内核一组: ["张三", "李四", "王五", "孙八"],
  管控二组: ["赵六", "钱七"],
  尖刀连: ["周九", "吴十", "郑一"],
  特战队: ["陈二", "刘三"],
  突击队: ["杨四", "黄五", "林六"],
};
const STAT_LABOR_STACK_STAGES = ["问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];
const STAT_LABOR_PIE_STAGES = [...WORKFLOW_NODES, "关闭", "暂时挂起"];
/**
 * 统计图表分色（折线/堆叠/饼图/ECharts 共用）。
 * 参考色板：暖色阶（亮黄→橙→番茄红→砖红，对应渐变条中的离散实心带）+
 * 点缀（电青、薄荷绿、品红，对应蓝绿渐变 / 粉橙渐变中的高饱和区）。
 */
const STAT_LABOR_CHART_COLORS = [
  "#facc15",
  "#fbbf24",
  "#f59e0b",
  "#f97316",
  "#ea580c",
  "#ef4444",
  "#dc2626",
  "#b91c1c",
  "#06b6d4",
  "#22c55e",
  "#e879f9",
];
/** 堆叠柱状图专用：自下而上按层序 赤→橙→黄→绿→青→蓝 连续色相，易区分；超过 6 层再接紫、玫红并循环 */
const STAT_LABOR_STACK_CHART_COLORS = [
  "#d32f2f",
  "#f57c00",
  "#fbc02d",
  "#388e3c",
  "#00838f",
  "#1565c0",
  "#6a1b9a",
  "#c2185b",
];
const STAT_LABOR_SELECT_STATE_KEYS = new Set([
  "statsLaborInputGroup",
  "statsLaborOpenHoldPersonGroup",
  "statsLaborOpenHoldPersonStage",
  "statsLaborOpenHoldStageGroup",
  "statsLaborGroupStackGroup",
  "statsLaborAvgDwellGroup",
  "statsLaborPersonDwellGroup",
  "statsLaborFlowDetailGroup",
]);
const STAT_LABOR_FIELD_STATE_KEYS = new Set([
  "statsLaborInputCollab",
  "statsLaborAvgDwellQuality",
  "statsLaborPersonDwellModule",
  "statsLaborInterceptQuality",
  "statsLaborCommandoFlowQuality",
  "statsLaborFlowDetailQuality",
]);

function statLaborHash(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) h = Math.imul(31, h) + str.charCodeAt(i) || 0;
  return Math.abs(h);
}

function statLaborRand(seed, i) {
  const x = Math.sin(statLaborHash(String(seed)) + i * 999.983) * 10000;
  return x - Math.floor(x);
}

function getStatsLaborGroupOptions() {
  const set = new Set();
  state.adminUsers.forEach((u) => {
    const g = String(u.group_name || "").trim();
    if (g) set.add(g);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function getStatsLaborSelectedGroup(stateKey) {
  const cur = String(state[stateKey] || "").trim();
  if (!cur) return "";
  return getStatsLaborGroupOptions().includes(cur) ? cur : "";
}

function statLaborPeopleForGroupFilter(groupFilter) {
  const g = String(groupFilter || "").trim();
  if (g && STAT_LABOR_DEMO_ROSTER[g]) return [...STAT_LABOR_DEMO_ROSTER[g]];
  if (g) {
    const base = STAT_LABOR_DEMO_ROSTER[Object.keys(STAT_LABOR_DEMO_ROSTER)[0]] || [];
    return base.map((n) => `${n}·${g.slice(0, 2)}`);
  }
  const out = [];
  Object.values(STAT_LABOR_DEMO_ROSTER).forEach((arr) => arr.forEach((n) => out.push(n)));
  return out;
}

function statLaborSeriesInt(seed, n, minV, maxV) {
  return Array.from({ length: n }, (_, i) => {
    const r = statLaborRand(seed, i);
    return minV + Math.floor(r * (maxV - minV + 1));
  });
}

function statLaborBarTopRoundPath(x, y, w, h, rMax) {
  const hh = Math.max(h, 0);
  if (hh < 0.5) return "";
  const rr = Math.min(Math.max(rMax, 0), w / 2, hh / 2, 9);
  if (rr < 0.75) {
    return `M${x},${y + hh}L${x},${y}L${x + w},${y}L${x + w},${y + hh}Z`;
  }
  return `M${x},${y + hh}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + hh}Z`;
}

function statLaborSvgBarVertical(labels, values, opts = {}) {
  const W = 560;
  const H = 260;
  const pl = 40;
  const pr = 20;
  const pb = 56;
  const pt = 28;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  const gap = 6;
  const bw = Math.max(10, Math.min(44, (innerW - gap * (n - 1)) / n));
  const maxVal = Math.max(1, ...values, opts.maxHint || 0);
  let rects = "";
  labels.forEach((lab, i) => {
    const v = values[i] || 0;
    const h = (v / maxVal) * innerH;
    const slot = innerW / n;
    const x = pl + i * slot + (slot - bw) / 2;
    const y = pt + innerH - h;
    const fh = opts.fills && opts.fills[i];
    let fill = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
    if (fh) {
      if (String(fh).startsWith("url(")) fill = String(fh);
      else if (String(fh).startsWith("#")) fill = String(fh);
      else fill = String(fh);
    }
    const bh = Math.max(h, 1);
    const d = statLaborBarTopRoundPath(x, y, bw, bh, 6);
    rects += `<path class="stat-bar-rect" d="${d}" fill="${fill}" style="--stat-bar-i:${i}"><title>${escapeHtml(String(lab))}: ${v}</title></path>`;
  });
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxVal * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  let xLabels = "";
  labels.forEach((lab, i) => {
    const slot = innerW / n;
    const cx = pl + i * slot + slot / 2;
    const short = String(lab).length > 5 ? `${String(lab).slice(0, 4)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-22 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });
  return `<svg class="stat-svg-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(
    opts.aria || "柱状图"
  )}">${yAxis}${rects}${xLabels}</svg>`;
}

/** 折线图（与人力投入 SVG 风格一致）：labels 为横轴刻度，values 为纵轴数值 */
function statLaborSvgMultiLine(labels, seriesList, opts = {}) {
  const W = 560;
  const H = 260;
  const pl = 44;
  const pr = 18;
  const pb = 52;
  const pt = 28;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  let maxVal = 1;
  for (const s of seriesList) {
    for (const v of s.values) {
      const nv = Number(v) || 0;
      if (nv > maxVal) maxVal = nv;
    }
  }
  if (opts.maxHint && opts.maxHint > maxVal) maxVal = opts.maxHint;
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxVal * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  let xLabels = "";
  labels.forEach((lab, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const cx = pl + t * innerW;
    const short = String(lab).length > 7 ? `${String(lab).slice(0, 6)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-20 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });
  let paths = "";
  let dots = "";
  for (let si = 0; si < seriesList.length; si++) {
    const s = seriesList[si];
    const stroke = s.stroke || STAT_LABOR_CHART_COLORS[si % STAT_LABOR_CHART_COLORS.length];
    const nums = s.values.map((v) => Number(v) || 0);
    const pts = nums.map((vn, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const x = pl + t * innerW;
      const y = pt + innerH - (vn / maxVal) * innerH;
      return { x, y, vn };
    });
    const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    paths += `<path class="stat-line-path" d="${lineD || ""}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    dots += pts.map((p, i) =>
      `<circle class="stat-line-dot stat-line-dot--multi" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${stroke}" style="--stat-line-i:${i}"><title>${escapeHtml(String(labels[i] || ""))} · ${escapeHtml(s.name || "")}: ${p.vn}</title></circle>`
    ).join("");
  }
  return `<svg class="stat-svg-chart stat-svg-chart--line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(opts.aria || "多线折线图")}">${yAxis}${paths}${dots}${xLabels}</svg>`;
}

function statLaborSvgLine(labels, values, opts = {}) {
  const W = 560;
  const H = 260;
  const pl = 44;
  const pr = 18;
  const pb = 52;
  const pt = 28;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  const nums = values.map((v) => Number(v) || 0);
  const maxVal = Math.max(1, ...nums, opts.maxHint || 0);
  const minVal = opts.minHint !== undefined ? opts.minHint : 0;
  const span = Math.max(maxVal - minVal, 1e-6);
  const pts = values.map((v, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const x = pl + t * innerW;
    const vn = Number(v) || 0;
    const y = pt + innerH - ((vn - minVal) / span) * innerH;
    return { x, y, vn };
  });
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const areaD =
    pts.length > 1
      ? `${lineD} L ${pts[pts.length - 1].x.toFixed(2)} ${(pt + innerH).toFixed(2)} L ${pts[0].x.toFixed(2)} ${(pt + innerH).toFixed(2)} Z`
      : "";
  const stroke = opts.stroke || "#ea580c";
  const gradId = `stat-line-grad-${Math.abs(statLaborHash(opts.aria || "line"))}`;
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = minVal + (span * t) / ticks;
    const disp =
      opts.yDecimals === 1 ? val.toFixed(1) : opts.yDecimals === 2 ? val.toFixed(2) : Math.round(val);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${disp}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  let xLabels = "";
  labels.forEach((lab, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const cx = pl + t * innerW;
    const short = String(lab).length > 7 ? `${String(lab).slice(0, 6)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-20 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });
  const unitHint = opts.yUnit ? `<text class="stat-line-unit" x="${pl}" y="${pt - 6}">${escapeHtml(String(opts.yUnit))}</text>` : "";
  const fillGrad = `<defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>`;
  const area = areaD ? `<path class="stat-line-area" d="${areaD}" fill="url(#${gradId})" />` : "";
  const pathEl = `<path class="stat-line-path" d="${lineD || ""}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
  const dots = pts
    .map(
      (p, i) =>
        `<circle class="stat-line-dot" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${stroke}" style="--stat-line-i:${i}"><title>${escapeHtml(String(labels[i] || ""))}: ${p.vn}</title></circle>`
    )
    .join("");
  return `<svg class="stat-svg-chart stat-svg-chart--line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(
    opts.aria || "折线图"
  )}">${fillGrad}${yAxis}${area}${pathEl}${dots}${unitHint}${xLabels}</svg>`;
}

function statLaborSvgStackedBars(groups, seriesKeys, getValues, opts = {}) {
  const W = 580;
  const H = 280;
  const pl = 44;
  const pr = 24;
  const pb = 52;
  const pt = 36;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(groups.length, 1);
  const slot = innerW / n;
  const bw = Math.min(52, slot * 0.62);
  let maxStack = 1;
  const stacks = groups.map((g, gi) => {
    const vals = seriesKeys.map((k) => getValues(gi, k));
    const t = vals.reduce((a, b) => a + b, 0);
    maxStack = Math.max(maxStack, t);
    return vals;
  });
  let body = "";
  groups.forEach((g, gi) => {
    const vals = stacks[gi];
    const total = vals.reduce((a, b) => a + b, 0);
    const cx = pl + gi * slot + slot / 2;
    let yAcc = pt + innerH;
    let topSi = -1;
    for (let si = seriesKeys.length - 1; si >= 0; si -= 1) {
      if (vals[si] > 0) {
        topSi = si;
        break;
      }
    }
    const x0 = cx - bw / 2;
    vals.forEach((v, si) => {
      if (!v) return;
      const h = (v / maxStack) * innerH;
      yAcc -= h;
      const fill = STAT_LABOR_STACK_CHART_COLORS[si % STAT_LABOR_STACK_CHART_COLORS.length];
      const isTop = si === topSi;
      if (isTop) {
        const d = statLaborBarTopRoundPath(x0, yAcc, bw, h, 6);
        body += `<path class="stat-bar-rect stat-bar-rect--stack" d="${d}" fill="${fill}" style="--stat-bar-i:${gi + si}"><title>${escapeHtml(seriesKeys[si])}: ${v}</title></path>`;
      } else {
        body += `<rect class="stat-bar-rect stat-bar-rect--stack" x="${x0.toFixed(1)}" y="${yAcc.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" style="--stat-bar-i:${gi + si}"><title>${escapeHtml(seriesKeys[si])}: ${v}</title></rect>`;
      }
    });
    body += `<text class="stat-stack-total" x="${cx}" y="${pt + 4}">${total}</text>`;
    const short = String(g).length > 6 ? `${String(g).slice(0, 5)}…` : String(g);
    body += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 14}" transform="rotate(-22 ${cx} ${H - 14})">${escapeHtml(short)}</text>`;
  });
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxStack * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  return `<svg class="stat-svg-chart stat-svg-chart--stacked" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(
    opts.aria || "堆叠柱状图"
  )}">${yAxis}${body}</svg>`;
}

function statLaborSvgPie(slices, opts = {}) {
  const cx = 100;
  const cy = 100;
  const r = opts.donut ? 68 : 78;
  const normalized = (Array.isArray(slices) ? slices : []).map((s) => {
    const n = Number(s?.value);
    return {
      ...s,
      value: Number.isFinite(n) ? Math.max(0, n) : 0,
    };
  });
  const total = normalized.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return `<svg class="stat-pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(
      opts.aria || "饼图"
    )}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(148, 163, 184, 0.22)" stroke="rgba(148, 163, 184, 0.45)" stroke-width="1.5"></circle></svg>`;
  }
  const positive = normalized
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.value > 0);
  if (positive.length === 1) {
    const only = positive[0];
    const hex = STAT_LABOR_CHART_COLORS[only.i % STAT_LABOR_CHART_COLORS.length];
    return `<svg class="stat-pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(
      opts.aria || "饼图"
    )}"><circle class="stat-pie-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${hex}" style="--stat-pie-i:${only.i}"><title>${escapeHtml(
      only.label
    )}: ${only.value} (100.0%)</title></circle></svg>`;
  }
  let angle = -Math.PI / 2;
  let paths = "";
  normalized.forEach((s, i) => {
    const frac = s.value / total;
    if (frac <= 0) return;
    const hex = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
    const a2 = angle + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    paths += `<path class="stat-pie-slice" d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${hex}" style="--stat-pie-i:${i}"><title>${escapeHtml(s.label)}: ${s.value} (${((frac * 100).toFixed(1))}%)</title></path>`;
    angle = a2;
  });
  return `<svg class="stat-pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(opts.aria || "饼图")}">${paths}</svg>`;
}

function statLaborPieLegend(slices) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  return `<ul class="stat-pie-legend">
    ${slices
      .map((s, i) => {
        const pct = ((s.value / total) * 100).toFixed(1);
        const c = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
        return `<li class="stat-pie-legend-item" style="--stat-pie-i:${i}"><span class="stat-pie-legend-dot" style="background:${c}"></span><span class="stat-pie-legend-label">${escapeHtml(s.label)}</span><span class="stat-pie-legend-val">${s.value}</span><span class="stat-pie-legend-pct">${pct}%</span></li>`;
      })
      .join("")}
  </ul>`;
}

function statLaborStackLegend(keys) {
  return `<div class="stat-stack-legend" role="list">
    ${keys
      .map((k, i) => {
        const c = STAT_LABOR_STACK_CHART_COLORS[i % STAT_LABOR_STACK_CHART_COLORS.length];
        return `<span class="stat-stack-legend-item" role="listitem"><i style="background:${c}"></i>${escapeHtml(k)}</span>`;
      })
      .join("")}
  </div>`;
}

const STAT_OWNERSHIP_VERSIONS_FULL = [
  "505.2.0",
  "505.1.1",
  "505.2.RC1",
  "505.1.0",
  "505.0.0",
  "503.2.0",
  "V500R002C00",
  "V500R002C10",
  "V500R001C00",
  "V500R001C10",
  "V500R001C20",
];
const STAT_OWNERSHIP_VERSIONS_SHORT = ["505.2", "505.1", "503.1", "506.0", "505.0"];
const STAT_OWNERSHIP_BIZ_ENVS = ["电信云", "移动云", "金融专网", "政务云", "互联网", "混合云"];
const STAT_OWNERSHIP_R_LINES = ["503", "505", "506", "V5R001", "V5R002"];
/** 多折线图参考色（与「按版本透视」示意：宝蓝、黄绿、金黄、珊瑚、品红、紫、天青、橙、森绿） */
const STAT_OWNERSHIP_MULTILINE_REF_COLORS = [
  "#2563eb",
  "#84cc16",
  "#eab308",
  "#fb7185",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#15803d",
];
const STAT_OWNERSHIP_CORE_C = ["505.2.1", "505.1.0", "503.2.0", "506.0.0", "505.0.0"];
const STAT_OWNERSHIP_SPC = [
  "505.2.1.SPC0800",
  "505.2.1.B021",
  "506.0.0.SPC0100",
  "503.1.0.SPC2000",
  "505.2.0.SPC0100",
];
const STAT_OWNERSHIP_MODULES_L3 = ["事务管理", "OM", "逻辑复制", "索引管理", "备份恢复", "查询优化"];
const STAT_OWNERSHIP_MODULES_L1 = [
  { key: "storage", label: "存储引擎" },
  { key: "sql", label: "SQL引擎" },
  { key: "peripheral", label: "周边组件" },
];
const STAT_OWNERSHIP_SITE_NAMES = [
  "华东-杭州局点",
  "华北-北京局点",
  "华南-深圳局点",
  "西南-成都局点",
  "金融-上海局点",
  "政务-西安局点",
  "混合-武汉局点",
  "测试-苏州局点",
  "生产-南京局点",
  "灾备-广州局点",
  "研发-廊坊局点",
  "外场-青岛局点",
  "核心-重庆局点",
  "边缘-厦门局点",
  "园区-天津局点",
];

const STAT_OWNERSHIP_SELECT_KEYS = new Set([
  "statsOwnershipPrecision",
  "statsOwnershipQuality",
  "statsOwnershipComponent",
  "statsOwnershipSunburstKind",
  "statsOwnershipL1Class",
  "statsOwnershipL1ModuleFilter",
  "statsOwnershipL1DtsDedup",
  "statsOwnershipTopSiteN",
  "statsOwnershipTopInstanceSiteN",
  "statsOwnershipTopModuleKind",
  "statsOwnershipHotspotKind",
]);

/** @type {Record<string, any>} */
let statsOwnershipChartInstances = {};
let statsOwnershipResizeBound = false;

function statOwnershipDisposeCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  Object.keys(statsOwnershipChartInstances).forEach((k) => {
    try {
      statsOwnershipChartInstances[k].dispose();
    } catch (_) {
      // ignore
    }
  });
  statsOwnershipChartInstances = {};
}

function statOwnershipSplitLineStyle() {
  return { lineStyle: { color: "rgba(200, 192, 175, 0.38)", type: "dashed" } };
}

function statOwnershipAxisLabel() {
  return { color: "#7a7368", fontSize: 11 };
}

/** 构建问题归属页各 ECharts 配置（演示数据） */
function buildStatsOwnershipChartOptions() {
  ensureStatsOwnershipRangeInit();
  const prec = state.statsOwnershipPrecision || "month";
  const { labels: timeLabels, n } = buildStatsOwnershipTimeLabels(state.statsOwnershipStart, state.statsOwnershipEnd, prec);
  const lineAnim = { animationDuration: 980, animationEasing: "cubicOut" };
  const allRowsRaw = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd);
  const comp = state.statsOwnershipComponent || "all";
  const allRows = allRowsRaw.filter((t) => (comp === "all" ? true : statsTicketComponent(t) === comp));
  const qualityFilter = String(state.statsOwnershipQuality || "all");
  const trendRows = allRows.filter((t) => {
    const v = statsTicketQualityIssueValue(t);
    if (!v) return false;
    if (qualityFilter === "all") return true;
    if (qualityFilter === "yes") return v === "known" || v === "new";
    if (qualityFilter === "known" || qualityFilter === "new" || qualityFilter === "no") return v === qualityFilter;
    return qualityFilter === "no" ? v === "no" : true;
  });
  const bucketIdx = new Map(timeLabels.map((lab, i) => [lab, i]));
  const toSeries = (rows) => {
    const out = Array.from({ length: n }, () => 0);
    rows.forEach((t) => {
      const ymd = statsTicketDayYmd(t);
      const lab = statsGroupByPrecisionLabel(ymd, prec);
      const i = bucketIdx.get(lab);
      if (i != null) out[i] += 1;
    });
    return out;
  };
  const knownQualityRows = trendRows.filter((t) => statsTicketQualityIssueValue(t) === "known");
  const newQualityRows = trendRows.filter((t) => statsTicketQualityIssueValue(t) === "new");
  const nonQualityRows = trendRows.filter((t) => statsTicketQualityIssueValue(t) === "no");
  const knownQualityLine = toSeries(knownQualityRows);
  const newQualityLine = toSeries(newQualityRows);
  const nonQualityLine = toSeries(nonQualityRows);

  const byVersion = statsCountBy(allRows, (t) => statsTicketVersion(t));
  const versions = Array.from(byVersion.keys())
    .sort((a, b) => (byVersion.get(b) || 0) - (byVersion.get(a) || 0))
    .slice(0, 11);
  const versionsForSeries = versions.length ? versions : ["未知版本"];
  const verSeries = versionsForSeries.map((ver, vi) => ({
    name: ver,
    type: "line",
    smooth: 0.22,
    symbol: "circle",
    symbolSize: 5,
    showSymbol: n < 18,
    lineStyle: { width: vi < 4 ? 2.2 : 1.4 },
    data: toSeries(allRows.filter((t) => statsTicketVersion(t) === ver)),
  }));

  const envKeys = Array.from(statsCountBy(allRows, (t) => String(t.bizEnv || "").trim() || "未知环境").keys())
    .slice(0, 5);
  const bizLines = envKeys.map((name, bi) => {
    const c = STAT_OWNERSHIP_MULTILINE_REF_COLORS[bi % STAT_OWNERSHIP_MULTILINE_REF_COLORS.length];
    return {
      name,
      type: "line",
      smooth: 0.25,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: n < 18,
      lineStyle: { color: c, width: 2 },
      itemStyle: { color: c },
      data: toSeries(allRows.filter((t) => (String(t.bizEnv || "").trim() || "未知环境") === name)),
    };
  });

  const rOfVersion = (v) => {
    if (v.startsWith("505")) return "505";
    if (v.startsWith("503")) return "503";
    if (v.startsWith("506")) return "506";
    if (v.includes("V500R001")) return "V5R001";
    if (v.includes("V500R002")) return "V5R002";
    return "505";
  };
  const rSeries = STAT_OWNERSHIP_R_LINES.map((name, ri) => {
    const c = STAT_OWNERSHIP_MULTILINE_REF_COLORS[ri % STAT_OWNERSHIP_MULTILINE_REF_COLORS.length];
    return {
      name,
      type: "line",
      smooth: 0.22,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: n < 18,
      lineStyle: { color: c, width: 2 },
      itemStyle: { color: c },
      data: toSeries(allRows.filter((t) => rOfVersion(statsTicketVersion(t)) === name)),
    };
  });

  const moduleOfTicket = (t) => {
    const st = statsTicketStage(t);
    if (st.includes("开发")) return "SQL引擎";
    if (st.includes("运维")) return "周边组件";
    return "存储引擎";
  };
  const l3OfTicket = (t) => {
    const st = statsTicketStage(t);
    if (st.includes("审核")) return "事务管理";
    if (st.includes("开发")) return "查询优化";
    if (st.includes("运维")) return "备份恢复";
    return "索引管理";
  };
  const moduleRows = new Map();
  allRows.forEach((t) => {
    const l1 = moduleOfTicket(t);
    const l3 = l3OfTicket(t);
    if (!moduleRows.has(l1)) moduleRows.set(l1, []);
    moduleRows.get(l1).push({ t, l3 });
  });
  const sunData = STAT_OWNERSHIP_MODULES_L1.map((L1) => {
    const rowsL1 = moduleRows.get(L1.label) || [];
    const byL3 = statsCountBy(rowsL1, (x) => x.l3);
    return {
      name: L1.label,
      children: STAT_OWNERSHIP_MODULES_L3.map((m) => {
        const v = byL3.get(m) || 0;
        return {
          name: m,
          value: v,
          children: [
            { name: "P1", value: Math.round(v * 0.2) },
            { name: "P2", value: Math.round(v * 0.5) },
            { name: "P3", value: Math.max(0, v - Math.round(v * 0.2) - Math.round(v * 0.5)) },
          ],
        };
      }),
    };
  });

  const l1Bars = STAT_OWNERSHIP_MODULES_L3.map((m) => ({
    name: m,
    value: allRows.filter((t) => l3OfTicket(t) === m).length,
  }));

  const bySite = statsCountBy(allRows, (t) => String(t.location || "").trim() || "未知局点");
  const topN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopSiteN) || 10));
  const sitePick = Array.from(bySite.keys())
    .sort((a, b) => (bySite.get(b) || 0) - (bySite.get(a) || 0))
    .slice(0, topN);
  const topSiteVals = sitePick.map((s) => bySite.get(s) || 0);

  const bySiteInst = new Map();
  allRows.forEach((t) => {
    const site = String(t.location || "").trim() || "未知局点";
    const pid = String(t.processId || t.orderId || "").trim();
    if (!bySiteInst.has(site)) bySiteInst.set(site, new Set());
    if (pid) bySiteInst.get(site).add(pid);
  });
  const topInstN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopInstanceSiteN) || 10));
  const instPick = Array.from(bySiteInst.keys())
    .sort((a, b) => (bySiteInst.get(b)?.size || 0) - (bySiteInst.get(a)?.size || 0))
    .slice(0, topInstN);
  const topInstVals = instPick.map((s) => bySiteInst.get(s)?.size || 0);

  const shortVers = versionsForSeries.slice(0, 5);
  const topVerVals = shortVers.map((v) => byVersion.get(v) || 0);
  const topInstVerVals = shortVers.map((v) => allRows.filter((t) => statsTicketVersion(t) === v && String(t.status || "").toLowerCase() !== "closed").length);

  const spcKeys = versionsForSeries.map((v) => (v.includes("SPC") ? v : `${v}.SPC`)).slice(0, 5);
  const spcVals = spcKeys.map((v) => Math.max(0, Math.round((byVersion.get(v.replace(".SPC", "")) || 0) * 0.8)));
  const topInstSpcVals = spcKeys.map((v) => Math.max(0, Math.round((byVersion.get(v.replace(".SPC", "")) || 0) * 0.55)));

  const coreKeys = shortVers.map((v) => `${v}.0`);
  const coreVals = coreKeys.map((v) => Math.max(0, Math.round((byVersion.get(v.replace(".0", "")) || 0) * 0.7)));

  const topModLabs = STAT_OWNERSHIP_MODULES_L1.map((x) => x.label);
  const topModVals = topModLabs.map((m) => (moduleRows.get(m) || []).length);

  const commonTooltip = {
    trigger: "axis",
    backgroundColor: "rgba(255, 252, 244, 0.94)",
    borderColor: "rgba(220, 212, 198, 0.9)",
    textStyle: { color: "#4a453d", fontSize: 12 },
  };

  return {
    ownTrend: {
      ...lineAnim,
      color: [STAT_LABOR_CHART_COLORS[0], STAT_LABOR_CHART_COLORS[4], STAT_LABOR_CHART_COLORS[8]],
      tooltip: { ...commonTooltip },
      legend: {
        data: ["是（已知质量问题）", "是（新发现质量问题）", "否"],
        bottom: 4,
        textStyle: { color: "#5c574f", fontSize: 11 },
      },
      grid: { left: 48, right: 20, top: 36, bottom: 52 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 14 ? 28 : 0 },
        axisLine: { lineStyle: { color: "rgba(180, 172, 158, 0.55)" } },
      },
      yAxis: {
        type: "value",
        splitLine: statOwnershipSplitLineStyle(),
        axisLabel: statOwnershipAxisLabel(),
      },
      series: [
        { name: "是（已知质量问题）", type: "line", smooth: 0.28, areaStyle: { opacity: 0.12 }, data: knownQualityLine },
        { name: "是（新发现质量问题）", type: "line", smooth: 0.28, areaStyle: { opacity: 0.1 }, data: newQualityLine },
        { name: "否", type: "line", smooth: 0.28, areaStyle: { opacity: 0.08 }, data: nonQualityLine },
      ],
    },
    ownVerLine: {
      ...lineAnim,
      tooltip: { ...commonTooltip },
      legend: {
        type: "scroll",
        bottom: 0,
        pageIconColor: "#7a7368",
        textStyle: { fontSize: 10, color: "#5c574f" },
      },
      grid: { left: 48, right: 16, top: 28, bottom: 96 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 12 ? 26 : 0 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: verSeries,
    },
    ownSunburst: {
      ...lineAnim,
      color: STAT_LABOR_CHART_COLORS,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "sunburst",
          radius: ["18%", "92%"],
          sort: undefined,
          emphasis: { focus: "ancestor" },
          data: sunData,
          label: { rotate: "radial", color: "#3a3834", fontSize: 10 },
          itemStyle: {
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: "rgba(255, 252, 244, 0.85)",
          },
          levels: [
            {},
            { r0: "18%", r: "42%", label: { rotate: "tangential" } },
            { r0: "42%", r: "72%", label: { align: "right" } },
            { r0: "72%", r: "92%", label: { position: "outside", padding: 2 } },
          ],
        },
      ],
    },
    ownL1Bar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 16, top: 28, bottom: 56 },
      xAxis: {
        type: "category",
        data: l1Bars.map((x) => x.name),
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 22 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: l1Bars.map((x) => x.value),
          barWidth: "52%",
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: STAT_LABOR_CHART_COLORS[0],
          },
        },
      ],
    },
    ownSourceLine: {
      ...lineAnim,
      tooltip: commonTooltip,
      legend: { bottom: 4, type: "scroll", textStyle: { fontSize: 10, color: "#5c574f" } },
      grid: { left: 48, right: 14, top: 32, bottom: 72 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 14 ? 28 : 0 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: bizLines,
    },
    ownRLine: {
      ...lineAnim,
      tooltip: commonTooltip,
      legend: { bottom: 4, textStyle: { fontSize: 11, color: "#5c574f" } },
      grid: { left: 48, right: 18, top: 32, bottom: 56 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 14 ? 26 : 0 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: rSeries,
    },
    ownTopSite: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 68 },
      xAxis: {
        type: "category",
        data: sitePick,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topSiteVals,
          barWidth: "58%",
          itemStyle: {
            borderRadius: [7, 7, 0, 0],
            color: STAT_LABOR_CHART_COLORS[2],
          },
        },
      ],
    },
    ownTopInstSite: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 68 },
      xAxis: {
        type: "category",
        data: instPick,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topInstVals,
          barWidth: "58%",
          itemStyle: {
            borderRadius: [7, 7, 0, 0],
            color: STAT_LABOR_CHART_COLORS[5],
          },
        },
      ],
    },
    ownTopVer: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: shortVers, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topVerVals,
          barWidth: "50%",
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: STAT_LABOR_CHART_COLORS[1],
          },
        },
      ],
    },
    ownTopSpc: {
      ...lineAnim,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 44, right: 10, top: 22, bottom: 78 },
      xAxis: {
        type: "category",
        data: STAT_OWNERSHIP_SPC,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 26, fontSize: 9 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [{ type: "bar", data: spcVals, barWidth: "52%", itemStyle: { borderRadius: [6, 6, 0, 0], color: STAT_LABOR_CHART_COLORS[4] } }],
    },
    ownTopInstVer: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: shortVers, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topInstVerVals,
          barWidth: "50%",
          itemStyle: { borderRadius: [7, 7, 0, 0], color: STAT_LABOR_CHART_COLORS[6] },
        },
      ],
    },
    ownTopInstSpc: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 10, top: 22, bottom: 78 },
      xAxis: {
        type: "category",
        data: STAT_OWNERSHIP_SPC,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 26, fontSize: 9 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [{ type: "bar", data: topInstSpcVals, barWidth: "52%", itemStyle: { borderRadius: [6, 6, 0, 0], color: STAT_LABOR_CHART_COLORS[3] } }],
    },
    ownCoreBar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: STAT_OWNERSHIP_CORE_C, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: coreVals,
          barWidth: "48%",
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: STAT_LABOR_CHART_COLORS[4],
          },
        },
      ],
    },
    ownTopModuleBar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 44 },
      xAxis: { type: "category", data: topModLabs, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topModVals,
          barWidth: "46%",
          itemStyle: { borderRadius: [8, 8, 0, 0], color: STAT_LABOR_CHART_COLORS[7] },
        },
      ],
    },
  };
}

function mountStatsOwnershipCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  statOwnershipDisposeCharts();
  const opts = buildStatsOwnershipChartOptions();
  const ids = {
    ownTrend: "stats-ownership-echart-trend",
    ownVerLine: "stats-ownership-echart-ver-line",
    ownSunburst: "stats-ownership-echart-sunburst",
    ownL1Bar: "stats-ownership-echart-l1",
    ownSourceLine: "stats-ownership-echart-source",
    ownRLine: "stats-ownership-echart-r",
    ownTopSite: "stats-ownership-echart-top-site",
    ownTopInstSite: "stats-ownership-echart-top-inst-site",
    ownTopVer: "stats-ownership-echart-top-ver",
    ownTopSpc: "stats-ownership-echart-top-spc",
    ownTopInstVer: "stats-ownership-echart-top-iver",
    ownTopInstSpc: "stats-ownership-echart-top-ispc",
    ownCoreBar: "stats-ownership-echart-core",
    ownTopModuleBar: "stats-ownership-echart-top-mod",
  };
  Object.keys(ids).forEach((key) => {
    const el = document.getElementById(ids[key]);
    if (!el) return;
    const chart = E.init(el, null, { renderer: "canvas" });
    chart.setOption(opts[key]);
    statsOwnershipChartInstances[key] = chart;
  });
  if (!statsOwnershipResizeBound) {
    statsOwnershipResizeBound = true;
    window.addEventListener(
      "resize",
      () => {
        if (state.activeKey !== "stats:charts" || state.statsChartsTab !== "ownership") return;
        Object.values(statsOwnershipChartInstances).forEach((c) => {
          try {
            c.resize();
          } catch (_) {
            // ignore
          }
        });
      },
      { passive: true }
    );
  }
}

/** 放大遮罩挂到 body，避免落在可滚动主区内导致 fixed 参照异常、浮层贴底 */
function mountStatsChartZoomMaskToBody(maskEl) {
  if (maskEl && maskEl.parentNode !== document.body) {
    document.body.appendChild(maskEl);
  }
}

/** 统计页渲染后尽早把遮罩挂到 body，避免仍在带 transform 的 .center 内时打开放大 */
function ensureStatsChartZoomMasksOnBody() {
  mountStatsChartZoomMaskToBody(document.getElementById("stats-ownership-zoom-mask"));
  mountStatsChartZoomMaskToBody(document.getElementById("stats-labor-zoom-mask"));
}

/** 管理页白名单弹窗挂到 body，避免受权限卡片容器层级/滚动上下文限制 */
function mountAdminWhitelistModalToBody(maskEl) {
  if (maskEl && maskEl.parentNode !== document.body) {
    document.body.appendChild(maskEl);
  }
}

function ensureAdminWhitelistModalOnBody() {
  mountAdminWhitelistModalToBody(document.querySelector(".admin-whitelist-modal-mask"));
}

/** 整页重绘前：移除已挂到 body 的统计放大遮罩，避免与新一轮 HTML 中的节点 id 重复 */
function detachStatsChartZoomMasksFromBody() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  document.querySelectorAll("body > .stats-chart-zoom-mask").forEach((mask) => {
    if (mask.id === "stats-ownership-zoom-mask") {
      const host = mask.querySelector("#stats-ownership-zoom-chart");
      const tableHost = mask.querySelector("#stats-ownership-zoom-table-host");
      if (host && E) {
        const zc = E.getInstanceByDom(host);
        if (zc) zc.dispose();
      }
      if (tableHost) {
        tableHost.innerHTML = "";
        tableHost.setAttribute("hidden", "");
        tableHost.style.display = "none";
      }
      window.__statsOwnershipZoomChart = null;
    } else if (mask.id === "stats-labor-zoom-mask") {
      const host = mask.querySelector("#stats-labor-zoom-content");
      if (host) host.innerHTML = "";
    }
    mask.remove();
  });
}

/** 整页重绘前移除已挂到 body 的白名单弹窗，避免残留重复节点 */
function detachAdminWhitelistModalFromBody() {
  document.querySelectorAll("body > .admin-whitelist-modal-mask").forEach((mask) => {
    mask.remove();
  });
}

/** @param {string} chartKey */
function openStatsOwnershipChartZoom(chartKey) {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const opts = buildStatsOwnershipChartOptions();
  const opt = opts[chartKey];
  if (!opt) return;
  const mask = document.getElementById("stats-ownership-zoom-mask");
  const host = document.getElementById("stats-ownership-zoom-chart");
  const tableHost = document.getElementById("stats-ownership-zoom-table-host");
  const titleEl = document.getElementById("stats-ownership-zoom-title");
  if (!mask || !host) return;
  mountStatsChartZoomMaskToBody(mask);
  if (tableHost) {
    tableHost.setAttribute("hidden", "");
    tableHost.style.display = "none";
    tableHost.innerHTML = "";
  }
  host.style.display = "block";
  const titles = {
    ownTrend: "现网问题数量趋势",
    ownVerLine: "按版本透视问题数量",
    ownSunburst: "问题模块透视",
    ownL1Bar: "一级模块透视",
    ownSourceLine: "现网问题来源数量趋势",
    ownRLine: "R版本透视问题数量",
    ownTopSite: "全量问题TOP局点",
    ownTopInstSite: "实例数量TOP局点",
    ownTopVer: "全量问题TOP版本",
    ownTopSpc: "全量问题TOP SPC版本",
    ownTopInstVer: "实例数量TOP版本",
    ownTopInstSpc: "实例数量TOP SPC版本",
    ownCoreBar: "CORE问题透视C版本",
    ownTopModuleBar: "全量问题TOP模块",
  };
  if (titleEl) titleEl.textContent = titles[chartKey] || "图表";
  mask.classList.add("stats-ownership-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
  const zc = E.getInstanceByDom(host);
  if (zc) zc.dispose();
  const big = E.init(host, null, { renderer: "canvas" });
  const zOpt = JSON.parse(JSON.stringify(opt));
  if (zOpt.legend && typeof zOpt.legend === "object" && !Array.isArray(zOpt.legend)) {
    zOpt.legend.textStyle = { ...(zOpt.legend.textStyle || {}), fontSize: 12 };
  }
  if (zOpt.xAxis && !Array.isArray(zOpt.xAxis) && zOpt.xAxis.axisLabel) {
    zOpt.xAxis.axisLabel.fontSize = (zOpt.xAxis.axisLabel.fontSize || 11) + 1;
  }
  big.setOption(zOpt);
  requestAnimationFrame(() => {
    try {
      big.resize();
    } catch (_) {
      // ignore
    }
  });
  window.__statsOwnershipZoomChart = big;
}

function closeStatsOwnershipChartZoom() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  const mask = document.getElementById("stats-ownership-zoom-mask");
  const host = document.getElementById("stats-ownership-zoom-chart");
  const tableHost = document.getElementById("stats-ownership-zoom-table-host");
  if (mask) {
    mask.classList.remove("stats-ownership-zoom-mask--open");
    mask.setAttribute("aria-hidden", "true");
  }
  if (host && E) {
    const zc = E.getInstanceByDom(host);
    if (zc) zc.dispose();
  }
  if (tableHost) {
    tableHost.innerHTML = "";
    tableHost.setAttribute("hidden", "");
    tableHost.style.display = "none";
  }
  window.__statsOwnershipZoomChart = null;
}

/** @param {"vcat"|"hot"} kind */
function openStatsOwnershipTableZoom(kind) {
  const mask = document.getElementById("stats-ownership-zoom-mask");
  const chartHost = document.getElementById("stats-ownership-zoom-chart");
  const tableHost = document.getElementById("stats-ownership-zoom-table-host");
  const titleEl = document.getElementById("stats-ownership-zoom-title");
  if (!mask || !tableHost) return;
  const sourceId = kind === "vcat" ? "stats-ownership-table-version-cat" : "stats-ownership-table-hotspot";
  const titleMap = { vcat: "版本问题类别走势", hot: "问题高发模块" };
  const src = document.getElementById(sourceId);
  if (titleEl) titleEl.textContent = titleMap[kind] || "表格";
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (chartHost && E) {
    const zc = E.getInstanceByDom(chartHost);
    if (zc) zc.dispose();
    chartHost.style.display = "none";
  }
  tableHost.innerHTML = src
    ? `<div class="stat-ownership-table-scroll stat-ownership-table-zoom-inner">${src.outerHTML}</div>`
    : "";
  tableHost.removeAttribute("hidden");
  tableHost.style.display = "block";
  mountStatsChartZoomMaskToBody(mask);
  mask.classList.add("stats-ownership-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
}

function renderStatsOwnershipZoomModalHtml() {
  return `<div class="perm-modal-mask stats-chart-zoom-mask stats-ownership-zoom-mask" id="stats-ownership-zoom-mask" aria-hidden="true">
  <div class="perm-modal stats-ownership-zoom-modal" role="dialog" aria-modal="true" aria-labelledby="stats-ownership-zoom-title">
    <div class="perm-modal-head stats-ownership-zoom-head">
      <h3 id="stats-ownership-zoom-title">图表</h3>
      <button type="button" class="action" id="stats-ownership-zoom-close">关闭</button>
    </div>
    <div class="perm-modal-body stats-ownership-zoom-body">
      <div id="stats-ownership-zoom-chart" class="stats-ownership-zoom-echart-host"></div>
      <div id="stats-ownership-zoom-table-host" class="stats-ownership-zoom-table-host" hidden></div>
    </div>
  </div>
</div>`;
}

function renderOwnershipGlassCard(title, toolbarHtml, innerHtml, delayIdx, chartZoomKey, tableZoomKind) {
  const d = (delayIdx * 0.05).toFixed(2);
  let zbtn = "";
  if (chartZoomKey) {
    zbtn = `<button type="button" class="stat-chart-zoom-btn" data-stats-ownership-zoom="${escapeAttr(chartZoomKey)}" title="放大查看" aria-label="放大查看">⛶</button>`;
  } else if (tableZoomKind) {
    zbtn = `<button type="button" class="stat-chart-zoom-btn" data-stats-ownership-table-zoom="${escapeAttr(tableZoomKind)}" title="放大查看" aria-label="放大查看">⛶</button>`;
  }
  const headHtml = zbtn
    ? `<div class="stat-glass-card-head stat-glass-card-head--has-zoom">
      <div class="stat-glass-card-head-main">
        <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
        ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
      </div>
      <div class="stat-glass-card-head-zoom">${zbtn}</div>
    </div>`
    : `<div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
    </div>`;
  return `<article class="stat-glass-card" style="--stat-card-delay:${d}s">
    ${headHtml}
    <div class="stat-glass-card-chart stat-chart-enter">
      ${innerHtml}
    </div>
  </article>`;
}

function renderStatsOwnershipVersionCategoryTable() {
  const rows = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => String(t.bizEnv || "").trim() || "未知环境").keys()).slice(0, 8);
  const cols = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => statsTicketVersion(t)).keys()).slice(0, 11);
  const head = `<thead><tr><th class="stat-ownership-th-corner">业务环境 \\ 版本</th>${cols
    .map((c) => `<th class="stat-ownership-th-ver">${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row, ri) => {
      const tds = cols
        .map((col) => {
          const v = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd).filter(
            (t) => (String(t.bizEnv || "").trim() || "未知环境") === row && statsTicketVersion(t) === col
          ).length;
          return `<td>${v}</td>`;
        })
        .join("");
      return `<tr><th scope="row" class="stat-ownership-row-head">${escapeHtml(row)}</th>${tds}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-version-cat">${head}${body}</table>`;
}

function renderStatsOwnershipHotspotTable() {
  const rows = ["存储引擎", "SQL引擎", "周边组件"];
  const cols = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => statsTicketVersion(t)).keys()).slice(0, 5);
  const moduleOfTicket = (t) => {
    const st = statsTicketStage(t);
    if (st.includes("开发")) return "SQL引擎";
    if (st.includes("运维")) return "周边组件";
    return "存储引擎";
  };
  const head = `<thead><tr><th class="stat-ownership-th-corner">模块 \\ 版本</th>${cols
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => {
      const tds = cols
        .map((col) => {
          const v = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd).filter(
            (t) => moduleOfTicket(t) === row && statsTicketVersion(t) === col
          ).length;
          return `<td>${v}</td>`;
        })
        .join("");
      return `<tr><th scope="row" class="stat-ownership-row-head">${escapeHtml(row)}</th>${tds}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-hotspot">${head}${body}</table>`;
}

function renderStatsOwnershipFiltersHtml() {
  ensureStatsOwnershipRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = {
    "1d": "近一天",
    "1w": "近一周",
    "1m": "近一月",
    "6m": "近半年",
    "1y": "近一年",
  };
  const segIdx = presetOrder.indexOf(state.statsOwnershipPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.statsOwnershipPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-ownership-preset="${escapeAttr(id)}">${escapeHtml(
        presetLabels[id] || id
      )}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
    </div>`;
  const startDisp = state.statsOwnershipStart || "开始日期";
  const endDisp = state.statsOwnershipEnd || "结束日期";

  const prec = state.statsOwnershipPrecision || "month";
  const precOpts = [
    { v: "year", t: "年" },
    { v: "quarter", t: "季" },
    { v: "month", t: "月" },
    { v: "day", t: "日" },
  ]
    .map((x) => `<option value="${x.v}" ${prec === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");

  const qual = state.statsOwnershipQuality || "all";
  const qualOpts = [
    { v: "all", t: "全部" },
    { v: "known", t: "是（已知质量问题）" },
    { v: "new", t: "是（新发现质量问题）" },
    { v: "no", t: "否" },
  ]
    .map((x) => `<option value="${x.v}" ${qual === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");

  const comp = state.statsOwnershipComponent || "all";
  const compOpts = [
    { v: "kernel", t: "内核问题" },
    { v: "control", t: "管控问题" },
    { v: "all", t: "全部问题" },
  ]
    .map((x) => `<option value="${x.v}" ${comp === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");

  return `
    <div class="stats-labor-filters stats-ownership-filters" aria-label="问题归属筛选">
      <div class="stats-labor-top-row stats-ownership-filter-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          <div class="date-range">
            <button type="button" class="date-trigger" id="stats-ownership-start-trigger">${escapeHtml(startDisp)}</button>
            <input class="date-hidden" id="stats-ownership-start-date" type="date" value="${escapeAttr(state.statsOwnershipStart || "")}" aria-label="开始日期" />
            <span class="date-sep">--</span>
            <button type="button" class="date-trigger" id="stats-ownership-end-trigger">${escapeHtml(endDisp)}</button>
            <input class="date-hidden" id="stats-ownership-end-date" type="date" value="${escapeAttr(state.statsOwnershipEnd || "")}" aria-label="结束日期" />
          </div>
        </div>
        <div class="stats-ownership-filter-inline" role="group" aria-label="精度与问题类型">
          <label class="stat-labor-filter"><span class="stat-labor-filter-label">精度</span>
            <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipPrecision">${precOpts}</select>
          </label>
          <label class="stat-labor-filter"><span class="stat-labor-filter-label">是否质量问题</span>
            <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipQuality">${qualOpts}</select>
          </label>
          <label class="stat-labor-filter"><span class="stat-labor-filter-label">问题组件</span>
            <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipComponent">${compOpts}</select>
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderStatsOwnershipSectionCardsHtml() {
  const echartsFallback =
    typeof window !== "undefined" && typeof window.echarts === "undefined"
      ? `<p class="stat-echart-fallback">图表库加载失败，请检查网络后刷新。</p>`
      : "";

  const sunburstToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipSunburstKind">
        <option value="intro" ${state.statsOwnershipSunburstKind === "intro" ? "selected" : ""}>问题引入模块</option>
        <option value="owner" ${state.statsOwnershipSunburstKind === "owner" ? "selected" : ""}>问题归属模块</option>
      </select></label>`;

  const l1Toolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipL1Class">
        <option value="owner" ${state.statsOwnershipL1Class === "owner" ? "selected" : ""}>问题归属</option>
        <option value="intro" ${state.statsOwnershipL1Class === "intro" ? "selected" : ""}>问题引入</option>
      </select></label>
    <label class="stat-labor-filter"><span class="stat-labor-filter-label">模块</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipL1ModuleFilter">
        ${STAT_OWNERSHIP_MODULES_L1.map(
          (x) =>
            `<option value="${escapeAttr(x.key)}" ${state.statsOwnershipL1ModuleFilter === x.key ? "selected" : ""}>${escapeHtml(x.label)}</option>`
        ).join("")}
      </select></label>
    <label class="stat-labor-filter"><span class="stat-labor-filter-label">DTS单号去重</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipL1DtsDedup">
        <option value="yes" ${state.statsOwnershipL1DtsDedup === "yes" ? "selected" : ""}>是</option>
        <option value="no" ${state.statsOwnershipL1DtsDedup === "no" ? "selected" : ""}>否</option>
      </select></label>`;

  const topSiteN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopSiteN) || 10));
  const topSiteToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">显示条数</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipTopSiteN">
        ${[5, 8, 10, 12, 15, 20]
          .map((n) => `<option value="${n}" ${topSiteN === n ? "selected" : ""}>${n}</option>`)
          .join("")}
      </select></label>`;

  const topInstN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopInstanceSiteN) || 10));
  const topInstToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">显示条数</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipTopInstanceSiteN">
        ${[5, 8, 10, 12, 15, 20]
          .map((n) => `<option value="${n}" ${topInstN === n ? "selected" : ""}>${n}</option>`)
          .join("")}
      </select></label>`;

  const topModToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipTopModuleKind">
        <option value="owner" ${state.statsOwnershipTopModuleKind === "owner" ? "selected" : ""}>问题归属</option>
        <option value="intro" ${state.statsOwnershipTopModuleKind === "intro" ? "selected" : ""}>问题引入</option>
      </select></label>`;

  const hotspotToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipHotspotKind">
        <option value="owner" ${state.statsOwnershipHotspotKind === "owner" ? "selected" : ""}>问题归属</option>
        <option value="intro" ${state.statsOwnershipHotspotKind === "intro" ? "selected" : ""}>问题引入</option>
      </select></label>`;

  const hTrend = `<div class="stat-echart-host" id="stats-ownership-echart-trend"></div>${echartsFallback}`;
  const hVer = `<div class="stat-echart-host stat-echart-host--tall" id="stats-ownership-echart-ver-line"></div>${echartsFallback}`;
  const hSun = `<div class="stat-echart-host stat-echart-host--sunburst" id="stats-ownership-echart-sunburst"></div>${echartsFallback}`;
  const hL1 = `<div class="stat-echart-host" id="stats-ownership-echart-l1"></div>${echartsFallback}`;
  const hSrc = `<div class="stat-echart-host" id="stats-ownership-echart-source"></div>${echartsFallback}`;
  const hR = `<div class="stat-echart-host" id="stats-ownership-echart-r"></div>${echartsFallback}`;
  const hTopSite = `<div class="stat-echart-host" id="stats-ownership-echart-top-site"></div>${echartsFallback}`;
  const hTopInst = `<div class="stat-echart-host" id="stats-ownership-echart-top-inst-site"></div>${echartsFallback}`;
  const hTopVer = `<div class="stat-echart-host" id="stats-ownership-echart-top-ver"></div>${echartsFallback}`;
  const hTopSpc = `<div class="stat-echart-host" id="stats-ownership-echart-top-spc"></div>${echartsFallback}`;
  const hTopIVer = `<div class="stat-echart-host" id="stats-ownership-echart-top-iver"></div>${echartsFallback}`;
  const hTopISpc = `<div class="stat-echart-host" id="stats-ownership-echart-top-ispc"></div>${echartsFallback}`;
  const hCore = `<div class="stat-echart-host" id="stats-ownership-echart-core"></div>${echartsFallback}`;
  const hTopMod = `<div class="stat-echart-host" id="stats-ownership-echart-top-mod"></div>${echartsFallback}`;

  return [
    renderOwnershipGlassCard("现网问题数量趋势", "", hTrend, 0, "ownTrend"),
    renderOwnershipGlassCard("按版本透视问题数量", "", hVer, 1, "ownVerLine"),
    renderOwnershipGlassCard("问题模块透视问题数量", sunburstToolbar, hSun, 2, "ownSunburst"),
    renderOwnershipGlassCard("一级模块透视问题数量", l1Toolbar, hL1, 3, "ownL1Bar"),
    renderOwnershipGlassCard("现网问题来源数量趋势", "", hSrc, 4, "ownSourceLine"),
    renderOwnershipGlassCard(
      "版本问题类别走势",
      "",
      `<div class="stat-ownership-table-scroll stat-chart-enter">${renderStatsOwnershipVersionCategoryTable()}</div>`,
      5,
      "",
      "vcat"
    ),
    renderOwnershipGlassCard("全量问题TOP局点", topSiteToolbar, hTopSite, 6, "ownTopSite"),
    renderOwnershipGlassCard("实例数量TOP局点", topInstToolbar, hTopInst, 7, "ownTopInstSite"),
    renderOwnershipGlassCard("全量问题TOP版本", "", hTopVer, 8, "ownTopVer"),
    renderOwnershipGlassCard("全量问题TOP SPC版本", "", hTopSpc, 9, "ownTopSpc"),
    renderOwnershipGlassCard("实例数量TOP版本", "", hTopIVer, 10, "ownTopInstVer"),
    renderOwnershipGlassCard("实例数量TOP SPC版本", "", hTopISpc, 11, "ownTopInstSpc"),
    renderOwnershipGlassCard("CORE问题透视C版本", "", hCore, 12, "ownCoreBar"),
    renderOwnershipGlassCard("R版本透视问题数量", "", hR, 13, "ownRLine"),
    renderOwnershipGlassCard("全量问题TOP模块", topModToolbar, hTopMod, 14, "ownTopModuleBar"),
    renderOwnershipGlassCard(
      "问题高发模块",
      hotspotToolbar,
      `<div class="stat-ownership-table-scroll stat-chart-enter">${renderStatsOwnershipHotspotTable()}</div>`,
      15,
      "",
      "hot"
    ),
  ].join("");
}

function renderStatLaborGroupSelect(stateKey, label) {
  const opts = getStatsLaborGroupOptions();
  const cur = getStatsLaborSelectedGroup(stateKey);
  const options = [`<option value="">全部小组</option>`].concat(
    opts.map((g) => `<option value="${escapeAttr(g)}" ${g === cur ? "selected" : ""}>${escapeHtml(g)}</option>`)
  );
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">${escapeHtml(label)}</span><select class="stat-labor-select" data-stat-labor-select="${escapeAttr(stateKey)}">${options.join("")}</select></label>`;
}

function renderStatLaborStageSelect(stateKey, label) {
  const cur = state[stateKey] || "";
  const stages = [...WORKFLOW_NODES, "暂时挂起"];
  const options = [`<option value="">全部阶段</option>`].concat(
    stages.map((s) => `<option value="${escapeAttr(s)}" ${s === cur ? "selected" : ""}>${escapeHtml(s)}</option>`)
  );
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">${escapeHtml(label)}</span><select class="stat-labor-select" data-stat-labor-select="${escapeAttr(stateKey)}">${options.join("")}</select></label>`;
}

function renderStatLaborYesNoToggle(stateKey, label, yesLabel, noLabel) {
  const v = state[stateKey] || "yes";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="${escapeAttr(label)}">
    <span class="stat-labor-filter-label">${escapeHtml(label)}</span>
    <button type="button" class="action ${v === "yes" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="yes">${escapeHtml(yesLabel)}</button>
    <button type="button" class="action ${v === "no" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="no">${escapeHtml(noLabel)}</button>
  </div>`;
}

function renderStatLaborQualityToggle(stateKey) {
  const v = state[stateKey] || "all";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="是否质量问题">
    <span class="stat-labor-filter-label">是否质量问题</span>
    <button type="button" class="action ${v === "all" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="all">全部问题</button>
    <button type="button" class="action ${v === "quality" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="quality">质量问题</button>
    <button type="button" class="action ${v === "nonQuality" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="nonQuality">非质量问题</button>
  </div>`;
}

function renderStatLaborModuleToggle(stateKey) {
  const v = state[stateKey] || "all";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="问题组件">
    <span class="stat-labor-filter-label">问题组件</span>
    <button type="button" class="action ${v === "all" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="all">全部问题</button>
    <button type="button" class="action ${v === "kernel" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="kernel">内核问题</button>
    <button type="button" class="action ${v === "control" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="control">管控问题</button>
  </div>`;
}

/** 人力投入图表放大弹窗标题 */
const STAT_LABOR_ZOOM_TITLES = {
  laborInput: "人力投入统计",
  laborOhp: "未闭环问题滞留人",
  laborOhs: "未闭环问题滞留阶段",
  laborGs: "各组未闭环问题数量",
  laborDwell: "各阶段问题平均滞留时间",
  laborPdw: "各阶段人员平均滞留时间",
  laborPie7: "各阶段问题占比",
  laborPie8: "问题拦截占比",
  laborPie9: "突击队问题流转整体占比",
  laborFd: "问题流转详细占比",
};

function renderStatsLaborZoomModalHtml() {
  return `<div class="perm-modal-mask stats-chart-zoom-mask stats-labor-zoom-mask" id="stats-labor-zoom-mask" aria-hidden="true">
  <div class="perm-modal stats-ownership-zoom-modal stats-labor-zoom-modal" role="dialog" aria-modal="true" aria-labelledby="stats-labor-zoom-title">
    <div class="perm-modal-head stats-ownership-zoom-head">
      <h3 id="stats-labor-zoom-title">图表</h3>
      <button type="button" class="action" id="stats-labor-zoom-close">关闭</button>
    </div>
    <div class="perm-modal-body stats-ownership-zoom-body stats-labor-zoom-body">
      <div id="stats-labor-zoom-content" class="stats-labor-zoom-content"></div>
    </div>
  </div>
</div>`;
}

function openStatsLaborChartZoom(chartKey) {
  const src = document.getElementById(`stats-labor-chart-${chartKey}`);
  const mask = document.getElementById("stats-labor-zoom-mask");
  const host = document.getElementById("stats-labor-zoom-content");
  const titleEl = document.getElementById("stats-labor-zoom-title");
  if (!src || !mask || !host) return;
  mountStatsChartZoomMaskToBody(mask);
  if (titleEl) titleEl.textContent = STAT_LABOR_ZOOM_TITLES[chartKey] || "图表";
  host.innerHTML = src.innerHTML;
  mask.classList.add("stats-chart-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
}

function closeStatsLaborChartZoom() {
  const mask = document.getElementById("stats-labor-zoom-mask");
  const host = document.getElementById("stats-labor-zoom-content");
  if (mask) {
    mask.classList.remove("stats-chart-zoom-mask--open");
    mask.setAttribute("aria-hidden", "true");
  }
  if (host) host.innerHTML = "";
}

function renderStatLaborGlassCard(title, toolbarHtml, chartHtml, delayIdx, laborZoomKey) {
  const d = (delayIdx * 0.05).toFixed(2);
  const zbtn = laborZoomKey
    ? `<button type="button" class="stat-chart-zoom-btn" data-stats-labor-zoom="${escapeAttr(laborZoomKey)}" title="放大查看" aria-label="放大查看">⛶</button>`
    : "";
  const chartInner = laborZoomKey
    ? `<div class="stat-glass-card-chart stat-chart-enter"><div id="stats-labor-chart-${escapeAttr(laborZoomKey)}" class="stats-labor-chart-host">${chartHtml}</div></div>`
    : `<div class="stat-glass-card-chart stat-chart-enter">${chartHtml}</div>`;
  const headHtml = zbtn
    ? `<div class="stat-glass-card-head stat-glass-card-head--has-zoom">
      <div class="stat-glass-card-head-main">
        <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
        ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
      </div>
      <div class="stat-glass-card-head-zoom">${zbtn}</div>
    </div>`
    : `<div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
    </div>`;
  return `<article class="stat-glass-card" style="--stat-card-delay:${d}s">
    ${headHtml}
    ${chartInner}
  </article>`;
}

function renderStatsLaborSectionCardsHtml() {
  const rows = statsTicketsInRange(state.statsLaborStart, state.statsLaborEnd);
  const rowsOpen = rows.filter((t) => String(t.status || "").toLowerCase() !== "closed");
  const rowsByGroup = new Map();
  rows.forEach((t) => {
    const g = statsUserGroupByTicket(t);
    if (!rowsByGroup.has(g)) rowsByGroup.set(g, []);
    rowsByGroup.get(g).push(t);
  });
  const selectedInputGroup = getStatsLaborSelectedGroup("statsLaborInputGroup");
  const inputRows = selectedInputGroup ? rows.filter((t) => statsUserGroupByTicket(t) === selectedInputGroup) : rows;
  const byPersonInput = statsCountBy(inputRows, (t) => statsTicketPersonName(t));
  const people1b = Array.from(byPersonInput.keys());
  const vals1 = people1b.map((k) => byPersonInput.get(k) || 0);
  const chart1 = statLaborSvgBarVertical(people1b.length ? people1b : ["—"], vals1.length ? vals1 : [0], { aria: "人力投入问题数", maxHint: 22 });

  const st2 = String(state.statsLaborOpenHoldPersonStage || "").trim();
  const selectedOpenHoldGroup = getStatsLaborSelectedGroup("statsLaborOpenHoldPersonGroup");
  const rows2 = rowsOpen.filter((t) => {
    if (selectedOpenHoldGroup && statsUserGroupByTicket(t) !== selectedOpenHoldGroup) return false;
    if (st2 && statsTicketStage(t) !== st2) return false;
    return true;
  });
  const byPersonOpen = statsCountBy(rows2, (t) => statsTicketPersonName(t));
  const people2b = Array.from(byPersonOpen.keys());
  const vals2 = people2b.map((k) => byPersonOpen.get(k) || 0);
  const chart2 = statLaborSvgBarVertical(people2b.length ? people2b : ["—"], vals2.length ? vals2 : [0], { aria: "未闭环滞留人问题数" });

  const stages3 = WORKFLOW_NODES.filter((_, idx) => idx > 0 && idx < 7);
  const selectedStageGroup = getStatsLaborSelectedGroup("statsLaborOpenHoldStageGroup");
  const rows3 = selectedStageGroup ? rowsOpen.filter((t) => statsUserGroupByTicket(t) === selectedStageGroup) : rowsOpen;
  const byStage = statsCountBy(rows3, (t) => statsTicketStage(t));
  const vals3 = stages3.map((s) => byStage.get(s) || 0);
  const chart3 = statLaborSvgBarVertical(stages3, vals3, { aria: "各阶段未闭环数量", fills: stages3.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 2) % STAT_LABOR_CHART_COLORS.length]) });

  const allGroupOptions = getStatsLaborGroupOptions();
  const selectedStackGroup = getStatsLaborSelectedGroup("statsLaborGroupStackGroup");
  const stackGroups = selectedStackGroup ? [selectedStackGroup] : allGroupOptions;
  const chart4 = `${statLaborStackLegend(STAT_LABOR_STACK_STAGES)}${statLaborSvgStackedBars(
    stackGroups,
    STAT_LABOR_STACK_STAGES,
    (gi, key) => (rowsByGroup.get(stackGroups[gi]) || []).filter((t) => statsTicketStage(t) === key && String(t.status || "").toLowerCase() !== "closed").length,
    { aria: "各组未闭环分阶段" }
  )}`;

  const dwellStages = WORKFLOW_NODES.slice(1);
  const nowMs = Date.now();
  const selectedDwellGroup = getStatsLaborSelectedGroup("statsLaborAvgDwellGroup");
  const selectedDwellQuality = String(state.statsLaborAvgDwellQuality || "all");
  const rows5 = rows.filter((t) => {
    if (selectedDwellGroup && statsUserGroupByTicket(t) !== selectedDwellGroup) return false;
    if (selectedDwellQuality === "quality" && !statsTicketIsQuality(t)) return false;
    if (selectedDwellQuality === "nonQuality" && statsTicketIsQuality(t)) return false;
    return true;
  });
  const hours5 = dwellStages.map((stage) => {
    const stageRows = rows5.filter((t) => statsTicketStage(t) === stage);
    if (!stageRows.length) return 0;
    const total = stageRows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0);
    return Math.round(total / stageRows.length);
  });
  const chart5 = statLaborSvgBarVertical(dwellStages, hours5, {
    aria: "各阶段平均滞留小时",
    fills: dwellStages.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 1) % STAT_LABOR_CHART_COLORS.length]),
  });
  const chart5Note = `<p class="stat-chart-unit-hint">纵轴单位：小时（基于建单时间统计）</p>`;

  const selectedPersonGroup = getStatsLaborSelectedGroup("statsLaborPersonDwellGroup");
  const selectedModule = String(state.statsLaborPersonDwellModule || "all");
  const people6b = selectedPersonGroup
    ? Array.from(new Set((rowsByGroup.get(selectedPersonGroup) || []).map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配")))
    : Array.from(new Set(rows.map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配"))).slice(0, 12);
  const personDwellStages = [...STAT_LABOR_STACK_STAGES];
  const chart6 = `${statLaborStackLegend(personDwellStages)}${statLaborSvgStackedBars(
    people6b.length ? people6b : ["—"],
    personDwellStages,
    (gi, key) => {
      const person = people6b[gi];
      const pr = rows.filter((t) => statsTicketPersonName(t) === person);
      const mr = selectedModule === "all" ? pr : pr.filter((t) => statsTicketComponent(t) === selectedModule);
      return mr.filter((t) => statsTicketStage(t) === key).length;
    },
    { aria: "各阶段人员滞留时间" }
  )}<p class="stat-chart-unit-hint">纵轴：按问题单数统计</p>`;

  const stageAll = statsCountBy(rows, (t) => statsTicketStage(t));
  const pie7Slices = STAT_LABOR_PIE_STAGES.map((label) => ({ label, value: stageAll.get(label) || 0 }));
  const chart7 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie7Slices, { aria: "各阶段问题占比" })}</div>${statLaborPieLegend(pie7Slices)}</div>`;

  const q8 = state.statsLaborInterceptQuality;
  const rows8 = rows.filter((t) => (q8 === "all" ? true : q8 === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t)));
  const group8 = statsCountBy(rows8, (t) => statsUserGroupByTicket(t));
  const pie8Slices = [
    { label: "特战队拦截", value: group8.get("特战队") || 0 },
    { label: "尖刀连拦截", value: group8.get("尖刀连") || 0 },
    { label: "突击队拦截", value: group8.get("突击队") || 0 },
  ];
  const chart8 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie8Slices, { aria: "问题拦截占比" })}</div>${statLaborPieLegend(pie8Slices)}</div>`;

  const q9 = state.statsLaborCommandoFlowQuality;
  const rows9 = rows.filter((t) => (q9 === "all" ? true : q9 === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t)));
  const commando = rows9.filter((t) => statsUserGroupByTicket(t) === "突击队");
  const pie9Slices = [
    { label: "流转至特战队", value: commando.filter((t) => statsUserGroupByTicket(t) === "特战队").length },
    { label: "独立闭环", value: commando.filter((t) => String(t.status || "").toLowerCase() === "closed").length },
    { label: "流转至尖刀连", value: commando.filter((t) => statsUserGroupByTicket(t) === "尖刀连").length },
  ];
  const chart9 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie9Slices, { aria: "突击队问题流转占比" })}</div>${statLaborPieLegend(pie9Slices)}</div>`;

  const flowKeys = ["流转至尖刀连", "独立闭环"];
  const selectedFlowGroup = getStatsLaborSelectedGroup("statsLaborFlowDetailGroup");
  const rows10Base = selectedFlowGroup ? rows.filter((t) => statsUserGroupByTicket(t) === selectedFlowGroup) : rows;
  const rows10 = rows10Base.filter((t) => {
    const q = String(state.statsLaborFlowDetailQuality || "all");
    return q === "all" ? true : q === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t);
  });
  const people10b = Array.from(new Set(rows10.map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配"))).slice(0, 12);
  const chart10 = `${statLaborStackLegend(flowKeys)}${statLaborSvgStackedBars(
    people10b.length ? people10b : ["—"],
    flowKeys,
    (gi, key) => {
      const person = people10b[gi];
      const r = rows10.filter((t) => statsTicketPersonName(t) === person);
      if (key === "独立闭环") return r.filter((t) => String(t.status || "").toLowerCase() === "closed").length;
      return r.filter((t) => statsTicketStage(t).includes("开发") || statsTicketStage(t).includes("运维")).length;
    },
    { aria: "问题流转详细占比" }
  )}`;

  return [
    renderStatLaborGlassCard(
      "人力投入统计",
      `${renderStatLaborGroupSelect("statsLaborInputGroup", "组别")}${renderStatLaborYesNoToggle("statsLaborInputCollab", "包含协同处理", "是", "否")}`,
      chart1,
      0,
      "laborInput"
    ),
    renderStatLaborGlassCard(
      "未闭环问题滞留人",
      `${renderStatLaborGroupSelect("statsLaborOpenHoldPersonGroup", "组别")}${renderStatLaborStageSelect("statsLaborOpenHoldPersonStage", "阶段")}`,
      chart2,
      1,
      "laborOhp"
    ),
    renderStatLaborGlassCard("未闭环问题滞留阶段", renderStatLaborGroupSelect("statsLaborOpenHoldStageGroup", "组别"), chart3, 2, "laborOhs"),
    renderStatLaborGlassCard("各组未闭环问题数量", renderStatLaborGroupSelect("statsLaborGroupStackGroup", "组别"), chart4, 3, "laborGs"),
    renderStatLaborGlassCard(
      "各阶段问题平均滞留时间",
      `${renderStatLaborGroupSelect("statsLaborAvgDwellGroup", "组别")}${renderStatLaborQualityToggle("statsLaborAvgDwellQuality")}`,
      chart5 + chart5Note,
      4,
      "laborDwell"
    ),
    renderStatLaborGlassCard(
      "各阶段人员平均滞留时间",
      `${renderStatLaborGroupSelect("statsLaborPersonDwellGroup", "组别")}${renderStatLaborModuleToggle("statsLaborPersonDwellModule")}`,
      chart6,
      5,
      "laborPdw"
    ),
    renderStatLaborGlassCard("各阶段问题占比", "", chart7, 6, "laborPie7"),
    renderStatLaborGlassCard("问题拦截占比", renderStatLaborQualityToggle("statsLaborInterceptQuality"), chart8, 7, "laborPie8"),
    renderStatLaborGlassCard("突击队问题流转整体占比", renderStatLaborQualityToggle("statsLaborCommandoFlowQuality"), chart9, 8, "laborPie9"),
    renderStatLaborGlassCard(
      "问题流转详细占比",
      `${renderStatLaborQualityToggle("statsLaborFlowDetailQuality")}${renderStatLaborGroupSelect("statsLaborFlowDetailGroup", "组别")}`,
      chart10,
      9,
      "laborFd"
    ),
  ].join("");
}

function renderStatsLaborFiltersHtml() {
  ensureStatsLaborRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = {
    "1d": "近一天",
    "1w": "近一周",
    "1m": "近一月",
    "6m": "近半年",
    "1y": "近一年",
  };
  const segIdx = presetOrder.indexOf(state.statsLaborPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.statsLaborPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-labor-preset="${escapeAttr(id)}">${escapeHtml(
        presetLabels[id] || id
      )}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
    </div>`;
  const startDisp = state.statsLaborStart || "开始日期";
  const endDisp = state.statsLaborEnd || "结束日期";
  return `
    <div class="stats-labor-filters" aria-label="人力投入筛选">
      <div class="stats-labor-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          <div class="date-range">
            <button type="button" class="date-trigger" id="stats-labor-start-trigger">${escapeHtml(startDisp)}</button>
            <input class="date-hidden" id="stats-labor-start-date" type="date" value="${escapeAttr(state.statsLaborStart || "")}" aria-label="开始日期" />
            <span class="date-sep">--</span>
            <button type="button" class="date-trigger" id="stats-labor-end-trigger">${escapeHtml(endDisp)}</button>
            <input class="date-hidden" id="stats-labor-end-date" type="date" value="${escapeAttr(state.statsLaborEnd || "")}" aria-label="结束日期" />
          </div>
        </div>
      </div>
    </div>
  `;
}

/** @param {"week"|"biweek"|"month"|"quarter"|"year"} period */
function getStatsReportPeriodBounds(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "week": {
      const dow = today.getDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const start = new Date(today);
      start.setDate(today.getDate() + monOffset);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    case "biweek": {
      const end = new Date(today);
      const start = new Date(today);
      start.setDate(today.getDate() - 13);
      return { start, end };
    }
    case "month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start, end };
    }
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const start = new Date(today.getFullYear(), q * 3, 1);
      const end = new Date(today.getFullYear(), q * 3 + 3, 0);
      return { start, end };
    }
    case "year": {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 12, 0);
      return { start, end };
    }
    default:
      return { start: today, end: today };
  }
}

/** @param {"week"|"biweek"|"month"|"quarter"|"year"} period */
function statReportMix(period, salt) {
  let h = salt * 1315423911;
  const s = `${period}:${salt}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * @param {"week"|"biweek"|"month"|"quarter"|"year"} period
 * @returns {{
 *   total: number, open: number, dwellH: number, passthroughPct: number, mom: string,
 *   summary: string, topRisks: { t: string, sev: string }[],
 *   trend: { label: string, v: number }[],
 *   modules: { name: string, n: number, pct: string }[],
 *   versions: { name: string, n: number }[],
 *   sites: { name: string, issues: number, inst: number }[],
 *   labor: { group: string, inN: number, hold: number, dwell: number }[],
 *   stages: { name: string, h: number }[],
 *   risks: { obj: string, signal: string, sev: string, action: string }[],
 * }}
 */
function buildStatsReportMock(period) {
  const { start, end } = getStatsReportPeriodBounds(period);
  const startYmd = formatYmdLocal(start);
  const endYmd = formatYmdLocal(end);
  const rows = statsTicketsInRange(startYmd, endYmd);
  const total = rows.length;
  const open = rows.filter((t) => String(t.status || "").toLowerCase() !== "closed").length;
  const nowMs = Date.now();
  const dwellH =
    total > 0 ? Math.round(rows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0) / Math.max(1, total)) : 0;
  const passthroughPct = total > 0 ? Math.round((rows.filter((t) => statsTicketIsQuality(t)).length / total) * 100) : 0;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000)));
  const prevRows = statsTicketsInRange(formatYmdLocal(prevStart), formatYmdLocal(prevEnd));
  const prevTotal = prevRows.length || 1;
  const momPct = Math.round(((total - prevTotal) / prevTotal) * 100);
  const mom = `${momPct >= 0 ? "+" : ""}${momPct}%`;
  const summary = `本周期全量 ${total} 件，未闭环 ${open} 件，问题量较上周期 ${mom}，建议重点关注滞留阶段与高发局点。`;
  const topRisks = [
    { t: `高严重级问题 ${rows.filter((t) => statsTicketIsQuality(t)).length} 件`, sev: "高" },
    { t: `未闭环问题 ${open} 件`, sev: open > Math.max(5, total * 0.4) ? "高" : "中" },
    { t: `平均滞留 ${dwellH} 小时`, sev: dwellH > 72 ? "高" : dwellH > 36 ? "中" : "低" },
  ];
  const trend = (() => {
    const buckets = period === "year" ? ["Q1", "Q2", "Q3", "Q4"] : period === "quarter" ? ["M1", "M2", "M3"] : ["W1", "W2", "W3", "W4"];
    const arr = Array.from({ length: buckets.length }, () => 0);
    rows.forEach((t) => {
      const d = parseYmdToDate(statsTicketDayYmd(t));
      if (!d) return;
      let i = 0;
      if (period === "year") i = Math.min(3, Math.floor(d.getMonth() / 3));
      else if (period === "quarter") i = Math.min(2, d.getMonth() % 3);
      else i = Math.min(buckets.length - 1, Math.floor((d.getDate() - 1) / Math.max(1, Math.ceil(31 / buckets.length))));
      arr[i] += 1;
    });
    return buckets.map((label, i) => ({ label, v: arr[i] }));
  })();
  const byModule = statsCountBy(rows, (t) => {
    const st = statsTicketStage(t);
    if (st.includes("开发")) return "SQL引擎";
    if (st.includes("运维")) return "周边组件";
    return "存储引擎";
  });
  const modules = Array.from(byModule.entries())
    .map(([name, n]) => ({ name, n, pct: `${total > 0 ? ((n / total) * 100).toFixed(1) : "0.0"}%` }))
    .sort((a, b) => b.n - a.n);
  const byVer = statsCountBy(rows, (t) => statsTicketVersion(t));
  const versions = Array.from(byVer.entries())
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  const bySite = statsCountBy(rows, (t) => String(t.location || "").trim() || "未知局点");
  const bySiteInst = new Map();
  rows.forEach((t) => {
    const s = String(t.location || "").trim() || "未知局点";
    const pid = String(t.processId || t.orderId || "").trim();
    if (!bySiteInst.has(s)) bySiteInst.set(s, new Set());
    if (pid) bySiteInst.get(s).add(pid);
  });
  const sites = Array.from(bySite.entries())
    .map(([name, issues]) => ({ name, issues, inst: bySiteInst.get(name)?.size || 0 }))
    .sort((a, b) => b.issues - a.issues)
    .slice(0, 6);
  const byGroup = statsCountBy(rows, (t) => statsUserGroupByTicket(t));
  const labor = Array.from(byGroup.entries())
    .map(([group, inN]) => {
      const grpRows = rows.filter((t) => statsUserGroupByTicket(t) === group);
      const hold = grpRows.filter((t) => String(t.status || "").toLowerCase() !== "closed").length;
      const dwell = grpRows.length
        ? Math.round(grpRows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0) / grpRows.length)
        : 0;
      return { group, inN, hold, dwell };
    })
    .sort((a, b) => b.inN - a.inN)
    .slice(0, 6);
  const byStage = statsCountBy(rows, (t) => statsTicketStage(t));
  const stages = Array.from(byStage.entries())
    .map(([name, cnt]) => ({ name, h: total > 0 ? Math.round((cnt / total) * Math.max(8, dwellH)) : 0 }))
    .slice(0, 6);
  const risks = [
    { obj: "高严重级问题", signal: `占比 ${total > 0 ? ((rows.filter((t) => statsTicketIsQuality(t)).length / total) * 100).toFixed(1) : "0.0"}%`, sev: "高", action: "优先闭环" },
    { obj: "未闭环工单", signal: `${open} 件`, sev: open > Math.max(5, total * 0.4) ? "高" : "中", action: "按阶段清理" },
    { obj: "平均滞留", signal: `${dwellH} 小时`, sev: dwellH > 72 ? "高" : dwellH > 36 ? "中" : "低", action: "优化流转" },
  ];
  return {
    total,
    open,
    dwellH,
    passthroughPct,
    mom,
    summary,
    topRisks,
    trend,
    modules,
    versions,
    sites,
    labor,
    stages,
    risks,
  };
}

function renderStatsReportPeriodSegHtml() {
  const order = /** @type {const} */ (["week", "biweek", "month", "quarter", "year"]);
  const labels = { week: "周", biweek: "双周", month: "月", quarter: "季", year: "年" };
  const segIdx = order.indexOf(state.statsReportPeriod);
  const segI = segIdx >= 0 ? segIdx : 0;
  const btns = order
    .map((id) => {
      const active = state.statsReportPeriod === id;
      return `<button type="button" class="stats-charts-tab-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-report-period="${escapeAttr(
        id
      )}">${escapeHtml(labels[id] || id)}</button>`;
    })
    .join("");
  return `<div class="stats-report-period-bar stats-charts-tab-bar" role="tablist" aria-label="报告周期" style="--seg-i:${segI};--seg-n:5">
      <span class="stats-report-period-slider stats-charts-tab-seg-slider" aria-hidden="true"></span>
      <div class="stats-charts-tab-seg-inner stats-report-period-seg-inner">${btns}</div>
    </div>`;
}

function renderStatsReportPage() {
  const period = state.statsReportPeriod;
  const { start, end } = getStatsReportPeriodBounds(period);
  const rangeText = `${formatYmdLocal(start)} ~ ${formatYmdLocal(end)}`;
  const genAt = formatYmdLocal(new Date());
  const d = buildStatsReportMock(period);
  const ptDelta = Math.floor(statReportMix(period, 999) * 12);
  const sevClass = (sev) => (sev === "高" ? "urgent" : sev === "中" ? "high" : "low");
  const kpi = (label, val, sub) =>
    `<div class="stat-glass-card stats-report-kpi"><div class="stat-glass-card-head"><div class="stat-glass-card-title">${escapeHtml(label)}</div></div><div class="stats-report-kpi-val">${escapeHtml(
      val
    )}</div>${sub ? `<div class="stats-report-kpi-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
  const table = (heads, rows) =>
    `<table class="stats-report-table"><thead><tr>${heads.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return `
    <div class="stats-charts-tab-bar-outer stats-report-toolbar-outer">
      ${renderStatsReportPeriodSegHtml()}
      <div class="stats-report-meta-row">
        <span class="stats-report-range">${escapeHtml(rangeText)}</span>
        <span class="stats-report-generated">${escapeHtml(genAt)}</span>
      </div>
    </div>
    <section class="stats-report-page" id="stats-report-panel" aria-label="工单分析">
      <div class="stats-report-block">
        <h2 class="stats-report-h2">执行摘要</h2>
        <p class="stats-report-lead">${escapeHtml(d.summary)}</p>
        <div class="stats-labor-sections stats-report-kpi-grid">
          ${kpi("全量问题", String(d.total), `环比 ${d.mom}`)}
          ${kpi("未闭环", String(d.open), "")}
          ${kpi("平均滞留", `${d.dwellH} 小时`, "")}
          ${kpi("透传率", `${d.passthroughPct}%`, "")}
        </div>
        <div class="stats-report-top3">
          ${d.topRisks
            .map(
              (x) =>
                `<div class="stats-report-top3-item"><span class="p ${sevClass(x.sev)}">${escapeHtml(x.sev)}</span><span class="stats-report-top3-text">${escapeHtml(x.t)}</span></div>`
            )
            .join("")}
        </div>
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">流量与趋势</h2>
        <div class="stats-report-trend-bars">
          ${d.trend
            .map((p) => {
              const max = Math.max(...d.trend.map((x) => x.v), 1);
              const px = Math.max(10, Math.round((p.v / max) * 104));
              return `<div class="stats-report-trend-cell"><div class="stats-report-trend-bar" style="height:${px}px"></div><span>${escapeHtml(p.label)}</span><strong>${p.v}</strong></div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">模块与版本</h2>
        ${table(
          ["模块", "问题数", "占比"],
          d.modules.slice(0, 6).map(
            (row) =>
              `<tr><td>${escapeHtml(row.name)}</td><td>${row.n}</td><td>${escapeHtml(row.pct)}</td></tr>`
          )
        )}
        ${table(
          ["版本线", "问题数"],
          d.versions.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.n}</td></tr>`)
        )}
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">局点</h2>
        ${table(
          ["局点", "问题数", "实例数"],
          d.sites.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.issues}</td><td>${row.inst}</td></tr>`)
        )}
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">人力与流程</h2>
        ${table(
          ["组别", "投入问题数", "未闭环", "平均滞留(h)"],
          d.labor.map(
            (row) =>
              `<tr><td>${escapeHtml(row.group)}</td><td>${row.inN}</td><td>${row.hold}</td><td>${row.dwell}</td></tr>`
          )
        )}
        ${table(
          ["阶段", "平均滞留(h)"],
          d.stages.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.h}</td></tr>`)
        )}
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">透传</h2>
        <div class="stats-report-inline-metrics">
          <span>全量 <strong>${d.passthroughPct}%</strong></span>
          <span>质量问题 <strong>${Math.min(99, d.passthroughPct + ptDelta)}%</strong></span>
          <span>非质量问题 <strong>${Math.max(3, d.passthroughPct - ptDelta)}%</strong></span>
        </div>
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">高风险识别</h2>
        ${table(
          ["对象", "信号", "严重度", "建议动作"],
          d.risks.map(
            (row) =>
              `<tr><td>${escapeHtml(row.obj)}</td><td>${escapeHtml(row.signal)}</td><td><span class="p ${sevClass(row.sev)}">${escapeHtml(
                row.sev
              )}</span></td><td>${escapeHtml(row.action)}</td></tr>`
          )
        )}
      </div>
    </section>
  `;
}

function bindStatsReportPage() {
  document.querySelectorAll("[data-stats-report-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-report-period");
      if (!id || state.statsReportPeriod === id) return;
      state.statsReportPeriod = id;
      render();
    });
  });
}

function renderStatsChartsTabSegHtml() {
  const tabOrder = ["labor", "ownership", "passthrough"];
  const tabLabels = { labor: "人力投入", ownership: "问题归属", passthrough: "透传分析" };
  const segIdx = tabOrder.indexOf(state.statsChartsTab);
  const segI = segIdx >= 0 ? segIdx : 0;
  const tabBtns = tabOrder
    .map((id) => {
      const active = state.statsChartsTab === id;
      return `<button type="button" class="stats-charts-tab-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-charts-tab="${escapeAttr(id)}">${escapeHtml(
        tabLabels[id] || id
      )}</button>`;
    })
    .join("");
  return `<div class="stats-charts-tab-bar" role="tablist" aria-label="统计视图" style="--seg-i:${segI}">
      <span class="stats-charts-tab-seg-slider" aria-hidden="true"></span>
      <div class="stats-charts-tab-seg-inner">${tabBtns}</div>
    </div>`;
}

function renderStatsChartsPage() {
  const laborFiltersRow = state.statsChartsTab === "labor" ? renderStatsLaborFiltersHtml() : "";
  const ownershipFiltersRow = state.statsChartsTab === "ownership" ? renderStatsOwnershipFiltersHtml() : "";
  const laborGrid =
    state.statsChartsTab === "labor"
      ? `${renderStatsLaborZoomModalHtml()}<div class="stats-labor-sections">${renderStatsLaborSectionCardsHtml()}</div>`
      : "";
  const ownershipGrid =
    state.statsChartsTab === "ownership"
      ? `${renderStatsOwnershipZoomModalHtml()}<div class="stats-labor-sections stats-ownership-sections">${renderStatsOwnershipSectionCardsHtml()}</div>`
      : "";
  const bodyHtml = laborGrid || ownershipGrid || "";
  const filtersRow = laborFiltersRow || ownershipFiltersRow;
  return `
    <div class="stats-charts-tab-bar-outer">
      ${renderStatsChartsTabSegHtml()}
      ${filtersRow}
    </div>
    <section class="stats-charts-page" id="stats-charts-panel" aria-label="统计图表">
      <div class="stats-charts-body" id="stats-charts-body" aria-live="polite">${bodyHtml}</div>
    </section>
  `;
}

function bindStatsChartsPage() {
  if (state.statsChartsTab !== "ownership") {
    statOwnershipDisposeCharts();
  }
  document.querySelectorAll("[data-stats-charts-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-charts-tab");
      if (!id || state.statsChartsTab === id) return;
      state.statsChartsTab = id;
      render();
    });
  });

  document.querySelectorAll("[data-stats-labor-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-labor-preset");
      if (!id) return;
      applyStatsLaborPreset(id);
      render();
    });
  });

  function bindStatsLaborDateTrigger(triggerId, inputId, field, fallbackLabel) {
    const trigger = document.getElementById(triggerId);
    const input = document.getElementById(inputId);
    if (!trigger || !input) return;
    trigger.addEventListener("click", () => {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    });
    input.addEventListener("change", () => {
      if (field === "start") state.statsLaborStart = input.value;
      else state.statsLaborEnd = input.value;
      state.statsLaborPreset = "";
      trigger.textContent = input.value || fallbackLabel;
      render();
    });
  }
  bindStatsLaborDateTrigger("stats-labor-start-trigger", "stats-labor-start-date", "start", "开始日期");
  bindStatsLaborDateTrigger("stats-labor-end-trigger", "stats-labor-end-date", "end", "结束日期");

  document.querySelectorAll("[data-stat-labor-select]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-stat-labor-select");
      if (!k || !STAT_LABOR_SELECT_STATE_KEYS.has(k)) return;
      state[k] = sel.value;
      render();
    });
  });
  document.querySelectorAll("[data-stat-labor-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-stat-labor-field");
      const v = btn.getAttribute("data-stat-labor-value");
      if (!k || !STAT_LABOR_FIELD_STATE_KEYS.has(k) || v == null) return;
      state[k] = v;
      render();
    });
  });

  document.querySelectorAll("[data-stats-ownership-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-ownership-preset");
      if (!id) return;
      applyStatsOwnershipPreset(id);
      render();
    });
  });

  function bindStatsOwnershipDateTrigger(triggerId, inputId, field, fallbackLabel) {
    const trigger = document.getElementById(triggerId);
    const input = document.getElementById(inputId);
    if (!trigger || !input) return;
    trigger.addEventListener("click", () => {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    });
    input.addEventListener("change", () => {
      if (field === "start") state.statsOwnershipStart = input.value;
      else state.statsOwnershipEnd = input.value;
      state.statsOwnershipPreset = "";
      trigger.textContent = input.value || fallbackLabel;
      render();
    });
  }
  bindStatsOwnershipDateTrigger("stats-ownership-start-trigger", "stats-ownership-start-date", "start", "开始日期");
  bindStatsOwnershipDateTrigger("stats-ownership-end-trigger", "stats-ownership-end-date", "end", "结束日期");

  document.querySelectorAll("[data-stats-ownership-select]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-stats-ownership-select");
      if (!k || !STAT_OWNERSHIP_SELECT_KEYS.has(k)) return;
      const raw = sel.value;
      if (k === "statsOwnershipTopSiteN" || k === "statsOwnershipTopInstanceSiteN") state[k] = Number(raw) || 10;
      else state[k] = raw;
      render();
    });
  });

  document.querySelectorAll("[data-stats-ownership-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-stats-ownership-zoom");
      if (!key) return;
      requestAnimationFrame(() => openStatsOwnershipChartZoom(key));
    });
  });

  document.querySelectorAll("[data-stats-ownership-table-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-stats-ownership-table-zoom");
      if (kind !== "vcat" && kind !== "hot") return;
      openStatsOwnershipTableZoom(kind);
    });
  });

  const ownZoomClose = document.getElementById("stats-ownership-zoom-close");
  const ownZoomMask = document.getElementById("stats-ownership-zoom-mask");
  if (ownZoomClose) {
    ownZoomClose.addEventListener("click", () => closeStatsOwnershipChartZoom());
  }
  if (ownZoomMask) {
    ownZoomMask.addEventListener("click", (ev) => {
      if (ev.target === ownZoomMask) closeStatsOwnershipChartZoom();
    });
  }

  if (!window.__statsChartsZoomEscBound) {
    window.__statsChartsZoomEscBound = true;
    document.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key !== "Escape") return;
        const om = document.getElementById("stats-ownership-zoom-mask");
        if (om && om.classList.contains("stats-ownership-zoom-mask--open")) closeStatsOwnershipChartZoom();
        const lm = document.getElementById("stats-labor-zoom-mask");
        if (lm && lm.classList.contains("stats-chart-zoom-mask--open")) closeStatsLaborChartZoom();
      },
      true
    );
  }

  document.querySelectorAll("[data-stats-labor-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-stats-labor-zoom");
      if (!key) return;
      requestAnimationFrame(() => openStatsLaborChartZoom(key));
    });
  });
  const laborZoomClose = document.getElementById("stats-labor-zoom-close");
  const laborZoomMask = document.getElementById("stats-labor-zoom-mask");
  if (laborZoomClose) {
    laborZoomClose.addEventListener("click", () => closeStatsLaborChartZoom());
  }
  if (laborZoomMask) {
    laborZoomMask.addEventListener("click", (ev) => {
      if (ev.target === laborZoomMask) closeStatsLaborChartZoom();
    });
  }

  ensureStatsChartZoomMasksOnBody();
  if (state.statsChartsTab === "ownership") {
    requestAnimationFrame(() => {
      mountStatsOwnershipCharts();
    });
  }
}

function renderSettingsAppearanceHtml() {
  const cur = getStoredUiTheme();
  const themes = [
    { id: "light", label: "浅色", swatch: "light" },
    { id: "dark", label: "暗黑", swatch: "dark" },
    { id: "eye-care", label: "护眼色", swatch: "eye-care" },
    { id: "pink-mist", label: "浅粉渐变", swatch: "pink-mist" },
    { id: "blue-lilac", label: "蓝紫渐变", swatch: "blue-lilac" },
  ];
  const tiles = themes
    .map(
      ({ id, label, swatch }) => `
        <button type="button" class="settings-skin-tile ${cur === id ? "active" : ""}" data-ui-theme="${id}" role="radio" aria-checked="${cur === id}" aria-label="${label}">
          <span class="settings-skin-swatch settings-skin-swatch--${swatch}" aria-hidden="true"></span>
          <span class="settings-skin-label">${label}</span>
        </button>`
    )
    .join("");
  const bgKind = getBackgroundKind();
  const presetTiles = SKIN_BG_PRESETS.map(
    ({ file, label, swatch }) => `
        <button type="button" class="settings-skin-tile settings-skin-tile--preset ${
          !hasStoredCustomBg() && getStoredPresetBgFile() === file ? "active" : ""
        }" data-bg-preset-file="${escapeAttr(file)}" role="radio" aria-checked="${
          !hasStoredCustomBg() && getStoredPresetBgFile() === file
        }" aria-label="${escapeAttr(label)}">
          <span class="settings-skin-swatch settings-skin-swatch--${swatch}" aria-hidden="true"></span>
          <span class="settings-skin-label">${escapeHtml(label)}</span>
        </button>`
  ).join("");
  const bgStatusLine =
    bgKind === "custom"
      ? "当前已使用本机保存的背景图。"
      : bgKind === "preset"
        ? "当前使用内置预设背景。"
        : "";
  return `
      <section class="settings-page" aria-label="设置">
        <div class="section-title">皮肤设置</div>
        <div class="settings-skin-grid" role="radiogroup" aria-label="皮肤设置">
          ${tiles}
        </div>
        <div class="section-title">背景预设</div>
        <div class="settings-skin-grid settings-skin-grid--presets" role="radiogroup" aria-label="背景预设">
          ${presetTiles}
        </div>
        <div class="section-title">背景图（本机）</div>
        <div class="settings-custom-bg">
          <div class="settings-custom-bg-row">
            <label class="settings-custom-bg-file-label">
              <input type="file" id="settings-custom-bg-file" class="settings-custom-bg-file" accept="image/*" />
              <span>选择图片</span>
            </label>
            <button type="button" class="action settings-custom-bg-clear" id="settings-custom-bg-clear">清除背景图</button>
          </div>
          <p class="settings-custom-bg-hint">单张不超过 2MB；超出请先在本地缩小尺寸或压缩后再上传。</p>
          <p class="settings-custom-bg-status" id="settings-custom-bg-status" role="status">${bgStatusLine}</p>
        </div>
      </section>`;
}

function bindSettingsAppearancePage() {
  document.querySelectorAll(".settings-skin-tile[data-ui-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.getAttribute("data-ui-theme");
      if (!UI_THEME_IDS.includes(theme)) return;
      applyUiTheme(theme);
      document.querySelectorAll(".settings-skin-tile[data-ui-theme]").forEach((b) => {
        const on = b.getAttribute("data-ui-theme") === theme;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    });
  });

  const fileInput = document.getElementById("settings-custom-bg-file");
  const statusEl = document.getElementById("settings-custom-bg-status");
  const clearBtn = document.getElementById("settings-custom-bg-clear");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > CUSTOM_BG_MAX_FILE_BYTES) {
        if (statusEl) statusEl.textContent = `文件超过 ${CUSTOM_BG_MAX_FILE_BYTES / 1024 / 1024}MB，请换较小的图片。`;
        fileInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl.startsWith("data:image/")) {
          if (statusEl) statusEl.textContent = "请选择图片文件。";
          return;
        }
        try {
          window.localStorage.removeItem(SKIN_BG_PRESET_STORAGE_KEY);
          window.localStorage.setItem(CUSTOM_BG_STORAGE_KEY, dataUrl);
          applyPageBackgroundFromStorage();
          syncSettingsPresetTileActive();
          if (statusEl) statusEl.textContent = "已保存，仅保存在本浏览器，下次打开仍会生效。";
        } catch (err) {
          const name = err && typeof err === "object" ? err.name : "";
          if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
            if (statusEl) statusEl.textContent = "存储空间不足，请换更小的图片或清除站点数据后重试。";
          } else if (statusEl) {
            statusEl.textContent = "保存失败，请重试。";
          }
        }
        fileInput.value = "";
      };
      reader.onerror = () => {
        if (statusEl) statusEl.textContent = "读取文件失败。";
        fileInput.value = "";
      };
      reader.readAsDataURL(file);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearPageBackground();
      if (fileInput) fileInput.value = "";
      syncSettingsPresetTileActive();
      if (statusEl) statusEl.textContent = "已恢复为渐变背景。";
    });
  }

  document.querySelectorAll(".settings-skin-tile--preset[data-bg-preset-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.getAttribute("data-bg-preset-file");
      if (!file || !SKIN_BG_PRESETS.some((p) => p.file === file)) return;
      try {
        window.localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
        window.localStorage.setItem(SKIN_BG_PRESET_STORAGE_KEY, file);
      } catch (_) {
        /* ignore */
      }
      applyPageBackgroundFromStorage();
      syncSettingsPresetTileActive();
      if (statusEl) {
        statusEl.textContent = "已启用内置预设背景。";
      }
    });
  });
}

function syncSettingsPresetTileActive() {
  const customOn = hasStoredCustomBg();
  const cur = customOn ? "" : getStoredPresetBgFile();
  document.querySelectorAll(".settings-skin-tile--preset[data-bg-preset-file]").forEach((btn) => {
    const file = btn.getAttribute("data-bg-preset-file") || "";
    const on = Boolean(cur && file === cur);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
}

function render() {
  debugLog("render.start", { activeKey: state.activeKey, listTab: state.listTab });
  const whitelist = getCurrentWhitelistSettings();
  if (!isActiveKeyVisible(state.activeKey, whitelist)) {
    state.activeKey = getDefaultVisibleActiveKey(whitelist);
  }
  const suppressDutyMainScrollRestore = state.dutySuppressMainScrollRestore;
  state.dutySuppressMainScrollRestore = false;
  const prevMain = document.querySelector(".layout > .center");
  let savedDutyMainScroll = null;
  if (prevMain && prevMain.querySelector("#duty-roster-panel, .duty-roster-page")) {
    savedDutyMainScroll = { top: prevMain.scrollTop, left: prevMain.scrollLeft };
  }
  const activeTicket = getActiveTicket();
  const isHome = state.activeKey === "home";
  if (!isHome) {
    document.body.querySelector("#order-heatmap-tooltip")?.remove();
  }
  const isList = state.activeKey === "list";
  const isDuty = state.activeKey === "duty:roster";
  const isLeave = state.activeKey === "leave:application";
  const isReq = state.activeKey === "req:manage";
  const isParams = state.activeKey.startsWith("params:");
  const isAdmin = state.activeKey.startsWith("admin:");
  const isStats = state.activeKey === "stats:charts";
  const isStatsReport = state.activeKey === "stats:report";
  const isSettings = state.activeKey === "settings:appearance";
  const isAi = state.activeKey === "ai:assistant";
  const currentOperator = getCurrentOperator();
  const canViewHome = whitelistAllows("home", "readonly", whitelist);
  const canViewList = whitelistAllows("ticket_list", "readonly", whitelist);
  const canViewDuty = whitelistAllows("duty_roster", "readonly", whitelist);
  const canViewLeave = whitelistAllows("leave_application", "readonly", whitelist);
  const canViewReq = whitelistAllows("requirement_list", "readonly", whitelist);
  const canViewAdminPermissions = whitelistAllows("admin_permissions", "readonly", whitelist);
  const canViewAdminUsers = whitelistAllows("admin_users", "readonly", whitelist);
  const canViewParams = whitelistAllows("params_config", "readonly", whitelist);
  const canViewLlmConfig = whitelistAllows("params_llm_config", "readonly", whitelist);
  const canViewAi = whitelistAllows("ai_assistant", "readonly", whitelist);
  const canViewStats = whitelistAllows("stats_dashboard", "readonly", whitelist);
  const canViewPatch = whitelistAllows("patch_manage", "readonly", whitelist);
  const canViewHomeDutyInfo = whitelistAllows("home_duty_roster", "readonly", whitelist);
  const canViewWorkbenchGroup = whitelistAllows("workbench_group", "readonly", whitelist);
  const canViewWorkbenchCreate = whitelistAllows("workbench_create", "readonly", whitelist);
  const canViewWorkbenchExport = whitelistAllows("workbench_export", "readonly", whitelist);
  const canViewWorkbenchDelete = whitelistAllows("workbench_delete", "readonly", whitelist);
  const canViewTicketLog = whitelistAllows("ticket_detail_log", "readonly", whitelist);
  if (!canViewTicketLog && state.logDrawerOpen) state.logDrawerOpen = false;
  const currentRoleCode = getCurrentRoleCode();
  const operatorOptions = Array.from(new Set(state.adminUsers.map((x) => String(x.account || "")).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  if (currentOperator.account && !operatorOptions.includes(currentOperator.account)) {
    operatorOptions.unshift(currentOperator.account);
  }
  let ticketListBaseForFilters = [];
  if (isList) {
    ticketListBaseForFilters = getWorkbenchListBaseTickets(currentOperator);
  }
  let homeTicketListBaseForFilters = [];
  if (isHome) {
    homeTicketListBaseForFilters = getWorkbenchListBaseTickets(currentOperator);
  }
  const createModalNodeKey =
    state.createModalNodeKey || (state.createModalOpen ? getCreateModalStartNodeKey() : "");
  const createModalHtml = state.createModalOpen && state.createTicketId
    ? `<div class="perm-modal-mask">
        <div class="perm-modal create-ticket-modal">
          <div class="perm-modal-head">
            <h3>创建工单</h3>
          </div>
          <div class="perm-modal-body">
            ${renderNodeForm(state.createTicketId, createModalNodeKey || "ops_analysis", { editable: true })}
          </div>
          <div class="perm-modal-actions">
            <button class="action" type="button" id="cancel-create-ticket-btn">取消</button>
          </div>
        </div>
      </div>`
    : "";
  document.title = isHome
    ? "我的主页 · 运维工单平台 Demo"
    : isList
      ? "运维工单平台 Demo"
      : isDuty
        ? "值班表"
        : isLeave
          ? "请假申请"
            : isSettings
            ? "设置 · 运维工单平台 Demo"
            : isStatsReport
              ? "工单分析 · 运维工单平台 Demo"
              : isStats
                ? "统计图表 · 运维工单平台 Demo"
                : isParams
                ? `${getParamsPageHeadline(state.activeKey)} · 参数配置`
                : isAdmin
                  ? "权限管理"
                  : state.activeKey.replace("ticket:", "");

  detachStatsChartZoomMasksFromBody();
  detachAdminWhitelistModalFromBody();
  root.innerHTML = `
  <div class="layout">
    <aside class="left">
      <div class="left-top">
        <div class="hamburger">☰</div>
        <button id="collapse-btn" class="collapse" title="收起/展开侧边栏">«</button>
      </div>
      <nav class="menu">
        ${canViewHome ? `<button class="menu-item ${isHome ? "active" : ""}" data-nav-key="home">我的主页</button>` : ""}
        <section class="menu-group" aria-label="办公协作">
          <h3 class="menu-group-title">办公协作</h3>
          ${canViewList ? `<button class="menu-item menu-item--tag ${isList ? "active" : ""}" data-nav-key="list">工作台</button>` : ""}
          ${canViewDuty ? `<div class="menu-item-wrap menu-item-wrap--duty">
            <button type="button" class="menu-item menu-item--tag ${isDuty ? "active" : ""}" data-nav-key="duty:roster">值班表</button>
            <div class="menu-submenu" role="menu" aria-label="值班表子项">
              ${renderDutySubmenuHtml()}
            </div>
          </div>` : ""}
          ${canViewLeave ? `<button class="menu-item menu-item--tag ${isLeave ? "active" : ""}" data-nav-key="leave:application">请假申请</button>` : ""}
        </section>
        <section class="menu-group" aria-label="运维管理">
          <h3 class="menu-group-title">运维管理</h3>
          ${canViewPatch ? `<button class="menu-item menu-item--tag">补丁管理</button>` : ""}
          <button class="menu-item menu-item--tag">变更日历</button>
          <button class="menu-item menu-item--tag">重大问题</button>
          ${canViewReq ? `<button class="menu-item menu-item--tag ${isReq ? "active" : ""}" data-nav-key="req:manage">需求管理</button>` : ""}
        </section>
        <section class="menu-group" aria-label="数据报表">
          <h3 class="menu-group-title">数据报表</h3>
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStats ? "active" : ""}" data-nav-key="stats:charts">统计图表</button>` : ""}
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStatsReport ? "active" : ""}" data-nav-key="stats:report">工单分析</button>` : ""}
        </section>
        ${canViewAi ? `<section class="menu-group" aria-label="智能助手">
          <h3 class="menu-group-title">智能助手</h3>
          <button type="button" class="menu-item menu-item--tag ${isAi ? "active" : ""}" data-nav-key="ai:assistant">AI 对话</button>
        </section>` : ""}
        <section class="menu-group" aria-label="系统设置">
          <h3 class="menu-group-title">系统设置</h3>
          ${canViewAdminUsers ? `<button class="menu-item menu-item--tag ${state.activeKey === "admin:users" ? "active" : ""}" data-nav-key="admin:users">用户管理</button>` : ""}
          ${canViewAdminPermissions ? `<button class="menu-item menu-item--tag ${state.activeKey === "admin:permissions" ? "active" : ""}" data-nav-key="admin:permissions">权限策略</button>` : ""}
          ${canViewParams ? `<div class="menu-item-wrap menu-item-wrap--params">
            <button type="button" class="menu-item menu-item--tag ${isParams ? "active" : ""}" data-nav-key="params:duty-field">参数配置</button>
            <div class="menu-submenu" role="menu" aria-label="参数配置子项">
              <button type="button" class="menu-submenu-item" data-nav-key="params:duty-field">责任田模块</button>
              <button type="button" class="menu-submenu-item" data-nav-key="params:version">版本模块</button>
              <button type="button" class="menu-submenu-item" data-nav-key="params:group-template">拉群模版</button>
              ${canViewLlmConfig ? `<button type="button" class="menu-submenu-item" data-nav-key="params:llm-config">大模型配置</button>` : ""}
            </div>
          </div>` : ""}
        </section>
      </nav>
      <div class="menu-bottom">
        <button type="button" class="menu-item ${isSettings ? "active" : ""}" data-nav-key="settings:appearance">设置</button>
      </div>
    </aside>

    <main class="center center-enter">
      <div class="head">
        <h1 class="${isHome || isList || isDuty || isLeave || isReq || isParams || isStats || isStatsReport || isSettings || isAi ? "" : "hidden"}">${isHome ? "我的主页" : isList ? "工作台" : isDuty ? "值班表" : isLeave ? "请假申请" : isReq ? "需求管理" : isSettings ? "设置" : isAi ? "智能助手" : isParams ? getParamsPageHeadline(state.activeKey) : isStatsReport ? "工单分析" : isStats ? "统计图表" : ""}</h1>
        <div class="actions ${isList ? "" : "hidden"}">
          ${canViewWorkbenchGroup ? '<button type="button" class="action" id="group-pull-open-btn">拉群</button>' : ""}
          ${canViewWorkbenchCreate ? '<button class="action primary" id="create-ticket-btn">创建</button>' : ""}
          ${canViewWorkbenchExport ? '<button class="action">导出</button>' : ""}
          ${canViewWorkbenchDelete ? '<button class="action danger" id="delete-ticket-btn">删除</button>' : ""}
        </div>
      </div>

      <div class="workspace-tabs" id="workspace-tabs">
        ${state.openTabs
          .filter((tab) => isActiveKeyVisible(tab.key, whitelist))
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
        isHome
          ? `
      <section class="home-page" id="home-page" aria-label="我的主页">
        ${renderMyHomeHeatmapCard(currentOperator)}
      </section>
      <div class="toolbar home-workbench-toolbar">
        <div class="tabs home-workbench-tabs" role="tablist">
          <button type="button" class="tab ${state.homeWorkbenchTab === "pending" ? "active" : ""}" role="tab" aria-selected="${state.homeWorkbenchTab === "pending"}" data-home-workbench-tab="pending">待办工单</button>
          <button type="button" class="tab ${state.homeWorkbenchTab === "pending_close" ? "active" : ""}" role="tab" aria-selected="${state.homeWorkbenchTab === "pending_close"}" data-home-workbench-tab="pending_close">待关单</button>
          <button type="button" class="tab ${state.homeWorkbenchTab === "audit_close" ? "active" : ""}" role="tab" aria-selected="${state.homeWorkbenchTab === "audit_close"}" data-home-workbench-tab="audit_close">待审核关闭</button>
          <button type="button" class="tab ${state.homeWorkbenchTab === "leave_pending" ? "active" : ""}" role="tab" aria-selected="${state.homeWorkbenchTab === "leave_pending"}" data-home-workbench-tab="leave_pending">待审批</button>
        </div>
      </div>
      ${
        state.homeWorkbenchTab === "leave_pending"
          ? `
      <section class="table-wrap home-workbench-table home-leave-workbench-table" id="home-list-panel" aria-live="polite">
        <div class="section-title">请假待审批</div>
        <table class="leave-app-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>申请编号</th>
              <th>状态</th>
              <th>类型</th>
              <th>发起人</th>
              <th>开始</th>
              <th>结束</th>
              <th>时长(小时)</th>
              <th>理由</th>
              <th>当前处理人</th>
            </tr>
          </thead>
          ${renderHomeLeaveWorkbenchTableSection()}
        </table>
      </section>
      `
          : `
      <section class="table-wrap home-workbench-table" id="home-list-panel" aria-live="polite">
        <div class="section-title">Work order list</div>
        <table>
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="home-select-all-tickets" aria-label="全选工单" /></th>
              <th>流程ID</th>
              ${renderTicketListFilterHeader("当前阶段", "currentStage", homeTicketListBaseForFilters, "home")}
              ${renderTicketListFilterHeader("起始日期", "startDate", homeTicketListBaseForFilters, "home")}
              ${renderTicketListFilterHeader("问题严重性", "severity", homeTicketListBaseForFilters, "home")}
              ${renderTicketListFilterHeader("局点", "location", homeTicketListBaseForFilters, "home")}
              ${renderTicketListFilterHeader("业务环境", "bizEnv", homeTicketListBaseForFilters, "home")}
              ${renderTicketListFilterHeader("当前处理人", "currentHandler", homeTicketListBaseForFilters, "home")}
              ${renderTicketListFilterHeader("问题描述", "description", homeTicketListBaseForFilters, "home")}
              <th>SLA时间</th>
            </tr>
          </thead>
          <tbody id="home-table-body"></tbody>
        </table>
        <div id="home-list-pagination" class="list-pagination"></div>
      </section>
      `
      }
      ${renderHomePersonalSectionHtml()}
      ${canViewHomeDutyInfo ? renderHomeDutyInfoSectionHtml() : ""}
      `
          : isList
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
              <th style="width:36px;"><input type="checkbox" id="select-all-tickets" aria-label="全选工单" /></th>
              <th>流程ID</th>
              ${renderTicketListFilterHeader("当前阶段", "currentStage", ticketListBaseForFilters)}
              ${renderTicketListFilterHeader("起始日期", "startDate", ticketListBaseForFilters)}
              ${renderTicketListFilterHeader("问题严重性", "severity", ticketListBaseForFilters)}
              ${renderTicketListFilterHeader("局点", "location", ticketListBaseForFilters)}
              ${renderTicketListFilterHeader("业务环境", "bizEnv", ticketListBaseForFilters)}
              ${renderTicketListFilterHeader("当前处理人", "currentHandler", ticketListBaseForFilters)}
              ${renderTicketListFilterHeader("问题描述", "description", ticketListBaseForFilters)}
              <th>SLA时间</th>
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
            : isReq
              ? `
      <section class="req-page" id="req-management-page" aria-label="需求管理">
        ${renderRequirementPage()}
      </section>
      `
            : isLeave
              ? `
      <section class="leave-app-page" id="leave-application-page" aria-label="请假申请">
        ${renderLeaveApplicationPage()}
      </section>
      `
              : isSettings
                ? `
      ${renderSettingsAppearanceHtml()}
      `
                : isStatsReport
                  ? `
      ${renderStatsReportPage()}
      `
                  : isStats
                    ? `
      ${renderStatsChartsPage()}
      `
                    : isParams
                  ? `
      ${renderParamsPage()}
      `
                  : isAi
                ? `
      ${renderAiAssistantPage()}
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
            ${canViewTicketLog ? `<button class="action action-log" id="toggle-log-drawer-btn" type="button">${state.logDrawerOpen ? "close" : "log"}</button>` : ""}
          </div>
        </div>
        <div class="detail-workspace">
          <div class="flow-main">
            ${renderWorkflow(activeTicket.orderId)}
          </div>
          ${canViewTicketLog ? renderOperationLogs(activeTicket.orderId) : ""}
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
  ${isReq ? renderRequirementModalsHtml() : ""}
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
  ensureAdminWhitelistModalOnBody();
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
      const whitelist = getCurrentWhitelistSettings();
      if (!isActiveKeyVisible(key, whitelist)) return;
      const prevNavKey = state.activeKey;
      if (key.startsWith("admin:")) {
        ensureAdminTab(key.split(":")[1]);
      }
      if (key === "home") {
        ensureHomeTab();
      }
      if (key === "list") {
        ensureListTab();
      }
      if (key === "duty:roster") {
        ensureDutyTab();
      }
      if (key === "req:manage") {
        ensureRequirementTab();
      }
      if (key === "stats:charts") {
        ensureStatsChartsTab();
      }
      if (key === "stats:report") {
        ensureStatsReportTab();
      }
      if (key === "settings:appearance") {
        ensureSettingsTab();
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
      if (key === "params:llm-config" && prevNavKey !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant") {
        ensureAiTab();
        if (prevNavKey !== "ai:assistant") state.aiNeedsRefresh = true;
      }
      if (key === "req:manage" && prevNavKey !== "req:manage") {
        state.reqNeedsRefresh = true;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
    });
  });

  if (isList) {
    const operator = getCurrentOperator();
    const baseTickets = ticketListBaseForFilters;
    const visibleByTab = baseTickets.filter((t) => {
      if (state.listTab === "all") return true;
      if (state.listTab === "created") return ticketCreatorMatchesOperator(t, operator);
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesPersonField(handler, operator);
    });
    const visibleTickets = filterTicketsByListColumnFilters(visibleByTab, state.ticketListFilters);
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
        if (!whitelistAllows("ticket_detail", "readonly")) return;
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
      createBtn.addEventListener("click", async () => {
        await ensureAdminData();
        beginCreateTicketModal();
      });
    }
    const cancelCreateBtn = document.getElementById("cancel-create-ticket-btn");
    if (cancelCreateBtn) {
      cancelCreateBtn.addEventListener("click", () => {
        state.createModalOpen = false;
        state.createTicketId = "";
        state.createModalNodeKey = "";
        render();
      });
    }
    if (state.createModalOpen && state.createTicketId) {
      const nk = state.createModalNodeKey || getCreateModalStartNodeKey();
      ensureNodeFormData(state.createTicketId, nk);
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

    document.querySelectorAll("[data-ticket-list-filter-open]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const key = el.getAttribute("data-ticket-list-filter-open");
        if (!key) return;
        state.ticketListFilters.openKey = state.ticketListFilters.openKey === key ? "" : key;
        render();
      });
    });
    const ticketListFilterOpenKey = state.ticketListFilters.openKey;
    if (ticketListFilterOpenKey) {
      document.querySelectorAll("[data-ticket-list-filter-search]").forEach((el) => {
        el.addEventListener("input", () => {
          const key = el.getAttribute("data-ticket-list-filter-search");
          if (!key) return;
          state.ticketListFilters.search[key] = el.value || "";
          render();
        });
      });
      document.querySelectorAll("[data-ticket-list-filter-value]").forEach((el) => {
        el.addEventListener("change", () => {
          const value = el.getAttribute("data-ticket-list-filter-value") || "";
          const openKey = state.ticketListFilters.openKey;
          if (!openKey) return;
          const cur = new Set(state.ticketListFilters.selected[openKey] || []);
          if (el.checked) cur.add(value);
          else cur.delete(value);
          state.ticketListFilters.selected[openKey] = Array.from(cur);
          state.listPage = 1;
          render();
        });
      });
      document.querySelectorAll("[data-ticket-list-filter-checkall]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-ticket-list-filter-checkall");
          if (!key) return;
          const all = uniqueTicketListFilterValues(ticketListBaseForFilters, key).filter((v) =>
            v.toLowerCase().includes((state.ticketListFilters.search[key] || "").toLowerCase())
          );
          const cur = new Set(state.ticketListFilters.selected[key] || []);
          if (el.checked) all.forEach((v) => cur.add(v));
          else all.forEach((v) => cur.delete(v));
          state.ticketListFilters.selected[key] = Array.from(cur);
          state.listPage = 1;
          render();
        });
      });
      document.querySelectorAll("[data-ticket-list-filter-reset-col]").forEach((el) => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-ticket-list-filter-reset-col");
          if (!key) return;
          state.ticketListFilters.selected[key] = [];
          state.ticketListFilters.search[key] = "";
          state.listPage = 1;
          render();
        });
      });
      document.querySelectorAll("[data-ticket-list-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.ticketListFilters.openKey = "";
          render();
        });
      });
    }
    document.addEventListener(
      "click",
      (ev) => {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".ticket-list-th-filter")) return;
        if (!state.ticketListFilters.openKey) return;
        state.ticketListFilters.openKey = "";
        render();
      },
      { once: true }
    );

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
  } else if (isHome) {
    if (state.homeWorkbenchTab !== "leave_pending") {
    const operator = currentOperator;
    const baseTickets = homeTicketListBaseForFilters;
    const visibleByTab = filterTicketsByHomeWorkbenchTab(baseTickets, state.homeWorkbenchTab, operator);
    const visibleTickets = filterTicketsByListColumnFilters(visibleByTab, state.homeTicketListFilters);
    const pageSize = Number(state.homeListPageSize) > 0 ? Number(state.homeListPageSize) : 10;
    const totalTickets = visibleTickets.length;
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.homeListPage) || 1), totalPages);
    if (currentPage !== state.homeListPage) state.homeListPage = currentPage;
    const start = (currentPage - 1) * pageSize;
    const pageTickets = visibleTickets.slice(start, start + pageSize);
    const homeBody = document.getElementById("home-table-body");
    const selectedSet = new Set(state.selectedTicketIds);
    const nRows = pageTickets.length;
    const staggerStepSec = nRows > 0 ? Math.min(0.04, 0.48 / nRows) : 0;
    if (homeBody) {
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
        tr.innerHTML = `<td><input type="checkbox" data-home-ticket-select="${escapeAttr(ticket.orderId || "")}" ${selectedSet.has(ticket.orderId) ? "checked" : ""} aria-label="选择工单 ${escapeAttr(ticket.orderId || "")}" /></td><td>${escapeHtml(proc)}</td><td>${escapeHtml(stage)}</td><td>${escapeHtml(String(ticket.startDate || ""))}</td><td><span class="p ${sevClass}">${escapeHtml(sevLabel)}</span></td><td>${escapeHtml(String(ticket.location || ""))}</td><td>${escapeHtml(String(ticket.bizEnv || ""))}</td><td>${escapeHtml(handlerDisp)}</td><td class="ticket-desc-cell">${escapeHtml(desc)}</td><td class="ticket-sla-cell">${escapeHtml(slaText)}</td>`;
        tr.addEventListener("click", () => {
          if (!whitelistAllows("ticket_detail", "readonly")) return;
          state.activeKey = ensureTicketTab(ticket.orderId);
          history.pushState({}, "", getUrlByKey(state.activeKey));
          render();
        });
        homeBody.appendChild(tr);
      });
    }
    const homeSelectAll = document.getElementById("home-select-all-tickets");
    if (homeSelectAll) {
      const allVisibleSelected = pageTickets.length > 0 && pageTickets.every((t) => selectedSet.has(t.orderId));
      homeSelectAll.checked = allVisibleSelected;
      homeSelectAll.addEventListener("change", () => {
        const next = new Set(state.selectedTicketIds);
        if (homeSelectAll.checked) pageTickets.forEach((t) => next.add(t.orderId));
        else pageTickets.forEach((t) => next.delete(t.orderId));
        state.selectedTicketIds = Array.from(next);
        render();
      });
    }
    const homePaginationWrap = document.getElementById("home-list-pagination");
    if (homePaginationWrap) {
      const sizeOptions = [10, 20, 50, 100]
        .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
        .join("");
      homePaginationWrap.innerHTML = `
        <div class="list-pagination-bar">
          <span class="list-pagination-summary">共 ${totalTickets} 条，第 ${currentPage}/${totalPages} 页</span>
          <label class="list-pagination-size">
            <span class="list-pagination-size-text">每页</span>
            <select id="home-page-size" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
            <span class="list-pagination-size-suffix">条</span>
          </label>
          <div class="list-pagination-nav">
            <button class="action list-page-btn" type="button" id="home-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
            <button class="action list-page-btn" type="button" id="home-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
          </div>
        </div>
      `;
      const homePageSizeSelect = document.getElementById("home-page-size");
      if (homePageSizeSelect) {
        homePageSizeSelect.addEventListener("change", () => {
          state.homeListPageSize = Number(homePageSizeSelect.value) || 10;
          state.homeListPage = 1;
          render();
        });
      }
      const homePrevBtn = document.getElementById("home-page-prev");
      if (homePrevBtn) {
        homePrevBtn.addEventListener("click", () => {
          state.homeListPage = Math.max(1, currentPage - 1);
          render();
        });
      }
      const homeNextBtn = document.getElementById("home-page-next");
      if (homeNextBtn) {
        homeNextBtn.addEventListener("click", () => {
          state.homeListPage = Math.min(totalPages, currentPage + 1);
          render();
        });
      }
    }
    document.querySelectorAll("[data-home-ticket-select]").forEach((el) => {
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("change", () => {
        const orderId = el.getAttribute("data-home-ticket-select") || "";
        if (!orderId) return;
        const next = new Set(state.selectedTicketIds);
        if (el.checked) next.add(orderId);
        else next.delete(orderId);
        state.selectedTicketIds = Array.from(next);
      });
    });

    document.querySelectorAll("[data-home-ticket-list-filter-open]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const key = el.getAttribute("data-home-ticket-list-filter-open");
        if (!key) return;
        state.homeTicketListFilters.openKey = state.homeTicketListFilters.openKey === key ? "" : key;
        render();
      });
    });
    const homeTicketListFilterOpenKey = state.homeTicketListFilters.openKey;
    if (homeTicketListFilterOpenKey) {
      document.querySelectorAll("[data-home-ticket-list-filter-search]").forEach((el) => {
        el.addEventListener("input", () => {
          const key = el.getAttribute("data-home-ticket-list-filter-search");
          if (!key) return;
          state.homeTicketListFilters.search[key] = el.value || "";
          render();
        });
      });
      document.querySelectorAll("[data-home-ticket-list-filter-value]").forEach((el) => {
        el.addEventListener("change", () => {
          const value = el.getAttribute("data-home-ticket-list-filter-value") || "";
          const openKey = state.homeTicketListFilters.openKey;
          if (!openKey) return;
          const cur = new Set(state.homeTicketListFilters.selected[openKey] || []);
          if (el.checked) cur.add(value);
          else cur.delete(value);
          state.homeTicketListFilters.selected[openKey] = Array.from(cur);
          state.homeListPage = 1;
          render();
        });
      });
      document.querySelectorAll("[data-home-ticket-list-filter-checkall]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.getAttribute("data-home-ticket-list-filter-checkall");
          if (!key) return;
          const all = uniqueTicketListFilterValues(homeTicketListBaseForFilters, key).filter((v) =>
            v.toLowerCase().includes((state.homeTicketListFilters.search[key] || "").toLowerCase())
          );
          const cur = new Set(state.homeTicketListFilters.selected[key] || []);
          if (el.checked) all.forEach((v) => cur.add(v));
          else all.forEach((v) => cur.delete(v));
          state.homeTicketListFilters.selected[key] = Array.from(cur);
          state.homeListPage = 1;
          render();
        });
      });
      document.querySelectorAll("[data-home-ticket-list-filter-reset-col]").forEach((el) => {
        el.addEventListener("click", () => {
          const key = el.getAttribute("data-home-ticket-list-filter-reset-col");
          if (!key) return;
          state.homeTicketListFilters.selected[key] = [];
          state.homeTicketListFilters.search[key] = "";
          state.homeListPage = 1;
          render();
        });
      });
      document.querySelectorAll("[data-home-ticket-list-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.homeTicketListFilters.openKey = "";
          render();
        });
      });
    }
    document.addEventListener(
      "click",
      (ev) => {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".home-ticket-list-th-filter")) return;
        if (!state.homeTicketListFilters.openKey) return;
        state.homeTicketListFilters.openKey = "";
        render();
      },
      { once: true }
    );
    }

    document.querySelectorAll("#home-list-panel .home-leave-app-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = parseInt(tr.getAttribute("data-leave-app-id") || "-1", 10);
        if (id < 0) return;
        state.activeKey = ensureLeaveTab();
        state.leaveDetailId = id;
        state.leaveDetailBundle = null;
        state.leaveDetailLoading = true;
        state.leaveNeedsRefresh = true;
        history.pushState({}, "", getUrlByKey(state.activeKey));
        render();
        void fetchLeaveDetail(id);
      });
    });

    document.querySelectorAll("[data-home-workbench-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-home-workbench-tab") || "pending";
        state.homeWorkbenchTab = tab;
        state.homeListPage = 1;
        if (tab === "leave_pending") {
          void fetchHomeLeavePendingList();
        } else {
          render();
        }
      });
    });

    document.querySelectorAll("[data-home-personal-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-home-personal-preset");
        if (!id) return;
        applyHomePersonalPreset(id);
        render();
      });
    });
    const hpStartTrigger = document.getElementById("home-personal-start-trigger");
    const hpStartInput = document.getElementById("home-personal-start-date");
    const hpEndTrigger = document.getElementById("home-personal-end-trigger");
    const hpEndInput = document.getElementById("home-personal-end-date");
    if (hpStartTrigger && hpStartInput) {
      hpStartTrigger.addEventListener("click", () => {
        if (typeof hpStartInput.showPicker === "function") hpStartInput.showPicker();
        else hpStartInput.click();
      });
      hpStartInput.addEventListener("change", () => {
        state.homePersonalStart = hpStartInput.value || "";
        state.homePersonalPreset = "";
        render();
      });
    }
    if (hpEndTrigger && hpEndInput) {
      hpEndTrigger.addEventListener("click", () => {
        if (typeof hpEndInput.showPicker === "function") hpEndInput.showPicker();
        else hpEndInput.click();
      });
      hpEndInput.addEventListener("change", () => {
        state.homePersonalEnd = hpEndInput.value || "";
        state.homePersonalPreset = "";
        render();
      });
    }
    document.querySelectorAll("[data-home-personal-field]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = btn.getAttribute("data-home-personal-field");
        const val = btn.getAttribute("data-home-personal-value");
        if (field === "passthroughQuality" && val) {
          state.homePersonalPassthroughQuality = val;
          render();
        }
      });
    });
    const hpStatsKey = homePersonalQueryKey();
    if (state.homePersonalStatsLoadedKey !== hpStatsKey && !state.homePersonalStatsLoading) {
      void fetchHomePersonalStats();
    }

    const dutyCalSk = dutyCalendarSyncKey();
    if (state.dutyCalendarLoadedKey !== dutyCalSk && !state.dutyCalendarSyncPending) {
      state.dutyCalendarSyncPending = true;
      void syncDutyCalendarMonthsFromServer().then(() => {
        state.dutyCalendarSyncPending = false;
        state.dutyCalendarLoadedKey = dutyCalSk;
        render();
      });
    }
    const dutyExSk = dutyRosterExtrasSyncKey();
    if (state.dutyRosterExtrasLoadedKey !== dutyExSk && !state.dutyRosterExtrasSyncPending) {
      state.dutyRosterExtrasSyncPending = true;
      void syncDutyRosterExtrasFromServer().then(() => {
        state.dutyRosterExtrasSyncPending = false;
        state.dutyRosterExtrasLoadedKey = dutyExSk;
        render();
      });
    }
    document.querySelectorAll("#home-duty-info [data-home-duty-unified-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = parseInt(btn.getAttribute("data-home-duty-dir") || "0", 10);
        const kYm = state.dutyCalendarYm.kernel;
        if (!kYm) return;
        let { year, month } = kYm;
        month += dir;
        if (month < 1) {
          month = 12;
          year -= 1;
        }
        if (month > 12) {
          month = 1;
          year += 1;
        }
        state.dutyCalendarYm.kernel = { year, month };
        state.dutyCalendarYm.control = { year, month };
        state.dutyCalendarLoadedKey = "";
        render();
      });
    });

    bindMyHomeHeatmap();
  } else if (isDuty) {
    bindDutyRosterPage();
  } else if (isLeave) {
    bindLeaveApplicationPage();
  } else if (isReq) {
    bindRequirementPage();
  } else if (isSettings) {
    bindSettingsAppearancePage();
  } else if (isParams && state.activeKey === "params:duty-field") {
    bindDutyFieldParamsPage();
  } else if (isParams && state.activeKey === "params:version") {
    bindVersionParamsPage();
  } else if (isParams && state.activeKey === "params:group-template") {
    bindGroupTemplateParamsPage();
  } else if (isParams && state.activeKey === "params:llm-config") {
    bindLlmConfigPage();
  } else if (isAi) {
    bindAiAssistantPage();
  } else if (isStatsReport) {
    bindStatsReportPage();
  } else if (isStats) {
    bindStatsChartsPage();
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
    const flatSel = wrap.querySelector("[data-wf-flat-select]");
    if (flatSel && !effectiveVis) wfFlatSelectClose(flatSel);
    wrap.querySelectorAll(".cascade-cascader button").forEach((el) => {
      el.disabled = !effectiveVis;
    });
    wrap.querySelectorAll(".wf-flat-select-trigger").forEach((el) => {
      el.disabled = !effectiveVis || field.readonly;
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
      const flatWrap = wrap.querySelector("[data-wf-flat-select]");
      const map = field.constraints?.next_handler_by_handle_mode;
      const mode = vals.handle_mode || "";
      if (flatWrap && map && typeof map === "object") {
        const allowed = Array.isArray(map[mode]) ? map[mode] : [];
        if (allowed.length > 0) {
          const hidden = flatWrap.querySelector("[data-wf-flat-value]");
          const listEl = flatWrap.querySelector("[data-wf-flat-list]");
          const prev = (hidden?.value || "").trim();
          const opts = allowed
            .map((v) => {
              const sel = v === prev ? " is-active" : "";
              return `<button type="button" class="wf-flat-select-item${sel}" data-wf-flat-value-pick="${escapeAttr(v)}" tabindex="-1">${escapeHtml(v)}</button>`;
            })
            .join("");
          if (listEl) listEl.innerHTML = opts;
          flatWrap.dataset.wfFlatPlaceholder = "0";
          if (!allowed.includes(prev) && hidden) {
            hidden.value = allowed[0];
          }
          wfFlatSelectSyncLabel(flatWrap);
          hidden?.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (select && map && typeof map === "object") {
        const allowed = Array.isArray(map[mode]) ? map[mode] : [];
        if (allowed.length > 0) {
          const prev = select.value || "";
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
      nextHandler: String(r.next_handler || "-"),
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
    bindWorkflowFlatSelect(form);
    runRules();
    form.addEventListener("change", runRules);
    form.addEventListener("input", (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest("[data-wf-flat-search]")) return;
      runRules();
    });

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
      if (state.createModalOpen && nodeKey === state.createModalNodeKey) {
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
        state.createModalNodeKey = "";
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
  while (state.adminLoading) {
    await new Promise((r) => setTimeout(r, 40));
  }
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
  if (activeKey === "params:llm-config") return "大模型配置";
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
  const canEditVersion = whitelistAllows("params_version_edit", "readonly");
  if (!canEditVersion && (state.versionBaselineEditMode || state.versionHotfixEditMode)) {
    state.versionBaselineEditMode = false;
    state.versionBaselineDraft = null;
    state.versionBaselineOrig = null;
    state.versionHotfixEditMode = false;
    state.versionHotfixDraft = null;
    state.versionHotfixOrig = null;
  }
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
    if (!canEditVersion) return;
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
    if (!canEditVersion) return;
    if (!state.versionBaselineDraft) return;
    state.versionBaselineDraft.push({
      id: null,
      clientKey: `vb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      version_label: "",
      commit_hash: "",
    });
    render();
  });

  panel.querySelector("#version-baseline-save")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    void saveVersionBaselineDraft();
  });

  panel.querySelector("#version-baseline-delete-selected")?.addEventListener("click", () => {
    if (!canEditVersion) return;
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
    if (!canEditVersion) return;
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
    if (!canEditVersion) return;
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

  panel.querySelector("#version-hotfix-save")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    void saveVersionHotfixDraft();
  });

  panel.querySelector("#version-hotfix-delete-selected")?.addEventListener("click", () => {
    if (!canEditVersion) return;
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
    if (!state.dutyFieldEditMode || !whitelistAllows("params_duty_field_edit", "readonly")) return;
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
  const admin = whitelistAllows("params_group_template_edit", "readonly");
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
  if (!whitelistAllows("params_group_template_edit", "readonly") || !state.groupTemplateDraft) return;
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
    if (!whitelistAllows("params_group_template_edit", "readonly")) return;
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

  const src = state.groupTemplateEditMode && whitelistAllows("params_group_template_edit", "readonly") ? state.groupTemplateDraft : null;
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
  const canEditVersion = whitelistAllows("params_version_edit", "readonly");
  if (!canEditVersion && (state.versionBaselineEditMode || state.versionHotfixEditMode)) {
    state.versionBaselineEditMode = false;
    state.versionBaselineDraft = null;
    state.versionBaselineOrig = null;
    state.versionHotfixEditMode = false;
    state.versionHotfixDraft = null;
    state.versionHotfixOrig = null;
  }
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
    sub === "baseline" && canEditVersion
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
    sub === "hotfix" && canEditVersion
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
  if (state.activeKey === "params:llm-config") {
    return renderLlmConfigPageHtml(title);
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
  const admin = whitelistAllows("params_duty_field_edit", "readonly");
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

function normalizePermissionLevel(level) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, level) ? level : "hidden";
}

function getPermissionLevelRank(level) {
  return PERMISSION_LEVEL_RANK[normalizePermissionLevel(level)];
}

function applyPermissionWhitelistCascade(draft) {
  const nextDraft = {};
  PERMISSION_WHITELIST_ITEMS.forEach((item) => {
    nextDraft[item.key] = normalizePermissionLevel(draft[item.key]);
  });
  for (let i = 0; i < PERMISSION_WHITELIST_ITEMS.length; i += 1) {
    let changed = false;
    PERMISSION_WHITELIST_ITEMS.forEach((item) => {
      const parents = PERMISSION_WHITELIST_PARENT_MAP[item.key] || [];
      if (!parents.length) return;
      const parentMaxRank = parents.reduce((maxRank, parentKey) => {
        const rank = getPermissionLevelRank(nextDraft[parentKey]);
        return rank < maxRank ? rank : maxRank;
      }, PERMISSION_LEVEL_RANK.editable);
      if (getPermissionLevelRank(nextDraft[item.key]) > parentMaxRank) {
        nextDraft[item.key] = PERMISSION_LEVEL_OPTIONS[parentMaxRank][0];
        changed = true;
      }
    });
    if (!changed) break;
  }
  // 表格要求：我的主页“可查看工单范围”策略与工单详情保持一致
  nextDraft.home = nextDraft.ticket_detail;
  const homeDutyRank = getPermissionLevelRank(nextDraft.home_duty_roster);
  const homeRank = getPermissionLevelRank(nextDraft.home);
  if (homeDutyRank > homeRank) {
    nextDraft.home_duty_roster = nextDraft.home;
  }
  return { draft: nextDraft };
}

function getWhitelistScopeSummaryByItemKey(itemKey, levelByKey) {
  if (itemKey === "home") {
    return "可查看工单范围策略同工单详情";
  }
  return "-";
}

function getPermissionWhitelistPageAndDetail(item) {
  const label = String(item?.label || "");
  const segs = label.split("/").map((x) => x.trim()).filter(Boolean);
  return {
    page: segs[0] || label,
    detail: segs.length > 1 ? segs.slice(1).join(" / ") : "-",
  };
}

function getPermissionWhitelistVisibleItems() {
  const hiddenRootKeys = new Set(["ticket_detail", "params_config"]);
  return PERMISSION_WHITELIST_ITEMS.filter((item) => !hiddenRootKeys.has(item.key));
}

function getPermissionWhitelistDetailText(itemKey, page, detail) {
  if (itemKey === "home") {
    return "可查看工单范围";
  }
  if (itemKey === "home_duty_roster") {
    return "是否展示“值班信息”";
  }
  if (itemKey === "ticket_list") {
    return "可查看工单范围";
  }
  if (detail !== "-") {
    return detail;
  }
  return `是否展示“${page}”页面`;
}

function getPermissionStrategyText(itemKey, level) {
  const normalized = normalizePermissionLevel(level);
  const strategyOptions = PERMISSION_STRATEGY_OPTIONS_BY_KEY[itemKey] || [];
  const hit = strategyOptions.find(([v]) => v === normalized);
  if (hit) return hit[1];
  const fallbackHit = strategyOptions.find(([v]) => v === "readonly");
  if (fallbackHit) return fallbackHit[1];
  if (strategyOptions.length) return strategyOptions[0][1];
  const levelText = Object.fromEntries(PERMISSION_LEVEL_OPTIONS);
  return levelText[normalized] || normalized;
}

function getPermissionStrategyOptions(itemKey) {
  const source = PERMISSION_STRATEGY_OPTIONS_BY_KEY[itemKey] || PERMISSION_LEVEL_OPTIONS;
  return source.map(([v, t]) => ({
    value: v,
    text: t,
  }));
}

function normalizePermissionLevelForItem(itemKey, level) {
  const normalized = normalizePermissionLevel(level);
  const source = PERMISSION_STRATEGY_OPTIONS_BY_KEY[itemKey] || PERMISSION_LEVEL_OPTIONS;
  const allowed = source.map(([v]) => v);
  if (allowed.includes(normalized)) return normalized;
  const rank = getPermissionLevelRank(normalized);
  const candidates = allowed
    .map((v) => ({ v, rank: getPermissionLevelRank(v) }))
    .sort((a, b) => b.rank - a.rank);
  const fit = candidates.find((x) => x.rank <= rank);
  if (fit) return fit.v;
  return candidates.length ? candidates[candidates.length - 1].v : (allowed[0] || normalized);
}

function getPermissionLevelForItem(itemKey, level) {
  return normalizePermissionLevelForItem(itemKey, level);
}

function getStrategyOptionsHtml(itemKey, curLevel) {
  const options = getPermissionStrategyOptions(itemKey);
  return options.map((opt) => {
    const selected = curLevel === opt.value ? "selected" : "";
    return `<option value="${opt.value}" ${selected}>${escapeHtml(opt.text)}</option>`;
  }).join("");
}

/** 选择子项高权限时，向上提升父项，避免子项选项被“灰掉不可点” */
function promotePermissionParents(draft, itemKey, targetLevel) {
  const nextDraft = { ...draft };
  const desiredRank = getPermissionLevelRank(targetLevel);
  const queue = [itemKey];
  const visited = new Set();
  while (queue.length) {
    const cur = queue.shift();
    const parents = PERMISSION_WHITELIST_PARENT_MAP[cur] || [];
    parents.forEach((parentKey) => {
      if (visited.has(parentKey)) return;
      visited.add(parentKey);
      const currentRank = getPermissionLevelRank(nextDraft[parentKey]);
      if (currentRank < desiredRank) {
        nextDraft[parentKey] = getPermissionLevelForItem(parentKey, targetLevel);
      }
      queue.push(parentKey);
    });
  }
  return nextDraft;
}

function getCurrentLevelTextByStrategy(itemKey, level) {
  const resolved = getPermissionLevelForItem(itemKey, level);
  if (itemKey === "home") {
    return "权限策略同“工单详情”";
  }
  return getPermissionStrategyText(itemKey, resolved);
}

function buildPermissionWhitelistGroups() {
  const groups = [];
  const byTitle = {};
  PERMISSION_WHITELIST_ITEMS.forEach((item) => {
    const label = String(item.label || "");
    const segs = label.split("/").map((x) => x.trim()).filter(Boolean);
    const groupTitle = segs[0] || label;
    if (!groupTitle) return;
    if (!byTitle[groupTitle]) {
      const group = { title: groupTitle, root: null, children: [] };
      byTitle[groupTitle] = group;
      groups.push(group);
    }
    const group = byTitle[groupTitle];
    if (segs.length <= 1) {
      group.root = item;
    } else {
      group.children.push(item);
    }
  });
  return groups;
}

function renderPermissionWhitelistItemRow(item) {
  const curLevel = getPermissionLevelForItem(item.key, state.adminPermissionDraft[item.key]);
  const optionsHtml = getStrategyOptionsHtml(item.key, curLevel);
  const { page, detail } = getPermissionWhitelistPageAndDetail(item);
  const detailText = getPermissionWhitelistDetailText(item.key, page, detail);
  return `
    <tr>
      <td>${escapeHtml(page)}</td>
      <td>${escapeHtml(detailText)}</td>
      <td>
        <select data-perm-item-key="${escapeAttr(item.key)}" ${item.key === "home" ? "disabled" : ""}>
          ${optionsHtml}
        </select>
      </td>
    </tr>
  `;
}

function renderPermissionWhitelistRootRow(group) {
  const item = group.root;
  const { page, detail } = getPermissionWhitelistPageAndDetail(item);
  const curLevel = getPermissionLevelForItem(item.key, state.adminPermissionDraft[item.key]);
  const optionsHtml = getStrategyOptionsHtml(item.key, curLevel);
  const scopeHtml = item.key === "home" ? "可查看工单范围策略同工单详情" : "-";
  return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <strong>${escapeHtml(page)}</strong>
        </div>
      </td>
      <td>
        ${escapeHtml(detail)}
        ${scopeHtml === "-" ? "" : `<div class="perm-row-note">${scopeHtml}</div>`}
      </td>
      <td>
        <select data-perm-item-key="${escapeAttr(item.key)}" ${item.key === "home" ? "disabled" : ""}>
          ${optionsHtml}
        </select>
      </td>
    </tr>
  `;
}

function renderAdminPage() {
  const isPermissions = state.activeKey === "admin:permissions";
  const whitelist = getCurrentWhitelistSettings();
  const canManageWhitelist = whitelistAllows("admin_permissions_whitelist", "readonly", whitelist);
  const canAddPermissionGroup = whitelistAllows("admin_permissions_add", "readonly", whitelist);
  const canEditUsers = whitelistAllows("admin_users_edit", "readonly", whitelist);
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
    const previewCascaded = applyPermissionWhitelistCascade(
      Object.fromEntries(PERMISSION_WHITELIST_ITEMS.map((item) => [item.key, levelByKey[item.key] || "hidden"]))
    );
    const previewLevelByKey = {
      ...levelByKey,
      ...previewCascaded.draft,
    };
    const previewRows = getPermissionWhitelistVisibleItems()
      .map((item) => {
        const { page, detail } = getPermissionWhitelistPageAndDetail(item);
        const detailText = getPermissionWhitelistDetailText(item.key, page, detail);
        return {
          key: item.key,
          page,
          detail: detailText,
          level: previewLevelByKey[item.key] || "hidden",
        };
      })
      .filter(Boolean);
    return `
    <section class="detail-card detail-card-inline admin-wrap">
      <div class="detail-head">
        <h2>权限策略</h2>
        <div class="detail-actions">
          ${canAddPermissionGroup ? '<button class="action" type="button" data-admin-role-add>新增权限组</button>' : ""}
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
            ${canManageWhitelist ? `<button class="action primary" type="button" data-admin-whitelist-open ${selectedGroup ? "" : "disabled"}>配置白名单</button>` : ""}
          </div>
          <div class="oplog-table-wrap">
            <table class="oplog-table admin-table">
              <thead><tr><th>页面</th><th>详情</th><th>策略</th></tr></thead>
              <tbody>
                ${
                  selectedGroup
                    ? previewRows
                      .map((row) => `<tr><td>${escapeHtml(row.page)}</td><td>${escapeHtml(row.detail)}</td><td>${escapeHtml(getCurrentLevelTextByStrategy(row.key, row.level))}</td></tr>`)
                      .join("")
                    : '<tr><td colspan="3">请先选择或新增权限组</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ${
        state.adminPermissionDialogOpen
          ? `<div class="perm-modal-mask admin-whitelist-modal-mask">
        <div class="perm-modal admin-whitelist-modal">
          <div class="perm-modal-head">
            <h3>配置白名单 · ${escapeHtml(selectedGroup)}</h3>
          </div>
          <div class="perm-modal-body">
            <table class="oplog-table admin-table">
              <thead><tr><th>页面</th><th>详情</th><th>策略</th></tr></thead>
              <tbody>
                ${getPermissionWhitelistVisibleItems().map((item) => renderPermissionWhitelistItemRow(item)).join("")}
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
              : `${canEditUsers ? `${!isUserEditMode ? '<button class="action primary" data-admin-toggle-edit>编辑</button>' : ""}
          ${
            isUserEditMode
              ? `<button class="action" data-admin-add>新增用户行</button>
          <button class="action primary" data-admin-save>保存</button>`
              : ""
          }` : ""}`
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
        ${canAddPermissionGroup ? '<button class="action" type="button" data-admin-role-add>新增角色</button>' : ""}
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
        state.adminPermissionExpandedGroups = {};
        const cascaded = applyPermissionWhitelistCascade(
          Object.fromEntries(PERMISSION_WHITELIST_ITEMS.map((x) => [x.key, "hidden"]))
        );
        state.adminPermissionDraft = cascaded.draft;
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
        const cascaded = applyPermissionWhitelistCascade(draft);
        state.adminPermissionDraft = cascaded.draft;
        state.adminPermissionExpandedGroups = {};
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
        const targetLevel = getPermissionLevelForItem(key, el.value || "hidden");
        state.adminPermissionDraft[key] = targetLevel;
        state.adminPermissionDraft = promotePermissionParents(state.adminPermissionDraft, key, targetLevel);
        const cascaded = applyPermissionWhitelistCascade(state.adminPermissionDraft);
        state.adminPermissionDraft = cascaded.draft;
        render();
      });
    });
    document.querySelectorAll("[data-perm-group-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const title = btn.getAttribute("data-perm-group-toggle") || "";
        if (!title) return;
        const cur = !!state.adminPermissionExpandedGroups[title];
        state.adminPermissionExpandedGroups = { ...state.adminPermissionExpandedGroups, [title]: !cur };
        render();
      });
    });
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const group = state.adminPermissionRole || "";
        if (!group) return;
        const cascaded = applyPermissionWhitelistCascade(state.adminPermissionDraft);
        state.adminPermissionDraft = cascaded.draft;
        const newRows = PERMISSION_WHITELIST_ITEMS.map((item) => ({
          role_code: group,
          is_pl: false,
          node_key: PERMISSION_WHITELIST_NODE_KEY,
          field_key: item.key,
          permission_level: getPermissionLevelForItem(item.key, state.adminPermissionDraft[item.key]),
        }));
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

async function createTicketFromOpsAnalysis() {
  debugLog("ticket.create.click");
  await ensureAdminData();
  beginCreateTicketModal();
  debugLog("ticket.create.modal_open", { orderId: state.createTicketId, nodeKey: state.createModalNodeKey });
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
      if (key === "params:llm-config" && prevWsKey !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant" && prevWsKey !== "ai:assistant") {
        state.aiNeedsRefresh = true;
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
      const whitelist = getCurrentWhitelistSettings();
      if (!isActiveKeyVisible(key, whitelist)) return;
      const prevNavKey2 = state.activeKey;
      if (key.startsWith("admin:")) ensureAdminTab(key.split(":")[1]);
      if (key === "home") ensureHomeTab();
      if (key === "list") ensureListTab();
      if (key === "duty:roster") ensureDutyTab();
      if (key.startsWith("params:")) ensureParamsTab(key.slice("params:".length));
      if (key === "leave:application") {
        ensureLeaveTab();
        state.leaveNeedsRefresh = true;
      }
      if (key === "stats:charts") {
        ensureStatsChartsTab();
      }
      if (key === "stats:report") {
        ensureStatsReportTab();
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
      if (key === "params:llm-config" && prevNavKey2 !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant") {
        ensureAiTab();
        if (prevNavKey2 !== "ai:assistant") state.aiNeedsRefresh = true;
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
      if (!state.openTabs.some((t) => t.key === state.activeKey)) state.activeKey = ensureHomeTab();
      state.selectedTicketIds = [];
      render();
    }
  }, true);
}

function bootstrap() {
  applyUiTheme(getStoredUiTheme());
  applyPageBackgroundFromStorage();
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
  const passedNodeLevel = getWhitelistLevel("ticket_detail_passed_nodes", whitelist);
  const currentStageLevel = getWhitelistLevel("ticket_detail_current_stage", whitelist);
  const onlyProblemFill = passedNodeLevel === "hidden";
  const nodeBar = WORKFLOW_NODES.map((step, index) => {
    if (onlyProblemFill && NODE_KEY_BY_STEP[step] !== "problem_fill") return "";
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
      const editable = isCurrent
        ? (currentStageLevel === "editable" || isCurrentHandler)
        : passedNodeLevel === "editable";
      ensureNodeFormData(orderId, nodeKey);
      formBody = renderNodeForm(orderId, nodeKey, { editable, passedView: !isCurrent && passedNodeLevel !== "editable" });
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
    const logClass = isCurrent ? "flow-log" : "flow-log flow-log-passed";
    return `
      <details class="${logClass}" ${open}>
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
    nextHandler: "-",
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
        <td>${escapeHtml(String(log.nextHandler || log.next_handler || "-"))}</td>
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
              <th>下一步处理人</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="6">No logs</td></tr>`}
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
let wfFlatSelectOpenWrap = null;
let dutyCascaderGeomListenersBound = false;

function dutyCascaderEnsureGeomListeners() {
  if (dutyCascaderGeomListenersBound) return;
  dutyCascaderGeomListenersBound = true;
  const repo = () => {
    if (dutyCascaderOpenWrap) dutyCascaderPositionPanel(dutyCascaderOpenWrap);
    if (wfFlatSelectOpenWrap) wfFlatSelectPositionPanel(wfFlatSelectOpenWrap);
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

/** 面板相对触发器容器定位；按视口边界做左右/上下防溢出修正 */
function dutyCascaderPositionPanel(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  if (!panel || !trig || panel.hidden || !panel.classList.contains("is-open")) return;
  const r = trig.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cap = Math.min(560, vw - margin * 2);
  panel.style.position = "absolute";
  panel.style.width = "";
  panel.style.maxWidth = `${cap}px`;
  panel.style.minWidth = `${Math.min(280, Math.max(96, Math.ceil(r.width)))}px`;
  panel.style.left = "0px";
  panel.style.top = `${Math.max(4, trig.offsetHeight + 4)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.zIndex = "10050";
  panel.style.maxHeight = `${Math.max(160, vh - r.bottom - margin * 2)}px`;

  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    if (pr.right > vw - margin) {
      const shift = Math.max(margin - r.left, (vw - margin) - pr.right);
      panel.style.left = `${Math.floor(shift)}px`;
    }
    if (pr.bottom > vh - margin) {
      const above = r.top - margin - pr.height;
      if (above >= margin) {
        panel.style.top = `${-Math.ceil(pr.height + 4)}px`;
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

function wfFlatSelectClearPanelStyles(panel) {
  if (!panel) return;
  ["position", "left", "top", "right", "bottom", "width", "minWidth", "maxWidth", "maxHeight", "zIndex"].forEach((k) => {
    panel.style[k] = "";
  });
}

function wfFlatSelectSetOpenWrap(wrap) {
  wfFlatSelectOpenWrap = wrap;
  dutyCascaderEnsureGeomListeners();
}

function wfFlatSelectClearOpenWrap(wrap) {
  if (wfFlatSelectOpenWrap === wrap) wfFlatSelectOpenWrap = null;
}

function wfFlatSelectPositionPanel(wrap) {
  const panel = wrap.querySelector(".wf-flat-select-panel");
  const trig = wrap.querySelector(".wf-flat-select-trigger");
  if (!panel || !trig || panel.hidden || !panel.classList.contains("is-open")) return;
  const r = trig.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.width, 160), vw - margin * 2);
  panel.style.position = "absolute";
  panel.style.width = `${Math.ceil(w)}px`;
  panel.style.minWidth = `${Math.ceil(Math.min(280, Math.max(96, r.width)))}px`;
  panel.style.left = "0px";
  panel.style.top = `${Math.max(4, trig.offsetHeight + 4)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.zIndex = "10050";
  panel.style.maxHeight = `${Math.max(160, vh - r.bottom - margin * 2)}px`;

  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    if (pr.right > vw - margin) {
      const shift = Math.max(margin - r.left, (vw - margin) - pr.right);
      panel.style.left = `${Math.floor(shift)}px`;
    }
    if (pr.bottom > vh - margin) {
      const above = r.top - margin - pr.height;
      if (above >= margin) {
        panel.style.top = `${-Math.ceil(pr.height + 4)}px`;
        panel.style.maxHeight = `${Math.max(160, r.top - margin * 2)}px`;
      }
    }
  });
}

function wfFlatSelectSyncLabel(wrap) {
  const h = wrap.querySelector("[data-wf-flat-value]");
  const labelEl = wrap.querySelector(".wf-flat-select-label");
  if (!h || !labelEl) return;
  const v = String(h.value || "").trim();
  const ph = wrap.dataset.wfFlatPlaceholder === "1";
  labelEl.textContent = v || (ph ? "请选择" : "");
  labelEl.classList.add("cascade-cascader-label");
  labelEl.classList.toggle("is-placeholder", !v && ph);
}

function wfFlatSelectApplySearch(wrap, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  let shown = 0;
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    const isPlaceholder = btn.classList.contains("wf-flat-select-item--placeholder");
    const txt = String(btn.textContent || "").trim().toLowerCase();
    const keep = !kw ? true : !isPlaceholder && txt.includes(kw);
    btn.hidden = !keep;
    if (keep) shown += 1;
  });
  const emptyEl = wrap.querySelector("[data-wf-flat-empty]");
  if (emptyEl) emptyEl.hidden = shown > 0;
}

function wfFlatSelectClose(wrap) {
  const panel = wrap.querySelector(".wf-flat-select-panel");
  const trig = wrap.querySelector(".wf-flat-select-trigger");
  wfFlatSelectClearOpenWrap(wrap);
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("is-open");
    wfFlatSelectClearPanelStyles(panel);
  }
  if (trig) trig.setAttribute("aria-expanded", "false");
}

function wfFlatSelectToggle(wrap) {
  const panel = wrap.querySelector(".wf-flat-select-panel");
  const trig = wrap.querySelector(".wf-flat-select-trigger");
  const searchInput = wrap.querySelector("[data-wf-flat-search]");
  if (!panel || !trig) return;
  const isOpen = !panel.hidden && panel.classList.contains("is-open");
  if (isOpen) {
    if (searchInput) {
      searchInput.value = "";
      wfFlatSelectApplySearch(wrap, "");
    }
    wfFlatSelectClose(wrap);
    return;
  }
  document.querySelectorAll(".cascade-cascader").forEach((w) => dutyCascaderClose(w));
  document.querySelectorAll("[data-wf-flat-select]").forEach((w) => {
    if (w !== wrap) wfFlatSelectClose(w);
  });
  wfFlatSelectSetOpenWrap(wrap);
  panel.hidden = false;
  panel.classList.add("is-open");
  trig.setAttribute("aria-expanded", "true");
  if (searchInput) {
    searchInput.value = "";
    wfFlatSelectApplySearch(wrap, "");
  }
  requestAnimationFrame(() => {
    wfFlatSelectPositionPanel(wrap);
    requestAnimationFrame(() => wfFlatSelectPositionPanel(wrap));
    if (searchInput) searchInput.focus();
  });
}

function wfFlatSelectCommit(wrap, value) {
  const hidden = wrap.querySelector("[data-wf-flat-value]");
  if (!hidden) return;
  hidden.value = value == null ? "" : String(value);
  wfFlatSelectSyncLabel(wrap);
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    const raw = btn.getAttribute("data-wf-flat-value-pick");
    const pickVal = raw == null ? "" : String(raw);
    btn.classList.toggle("is-active", pickVal === String(hidden.value || ""));
  });
  wfFlatSelectClose(wrap);
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderWorkflowFlatSelect(field, value, editable, ctx) {
  const { options, usePlaceholder, enableSearch } = ctx;
  const viewOnly = !!(field.readonly || !editable);
  const keyEsc = escapeAttr(field.key);
  const norm = String(value || "").trim();
  if (viewOnly) {
    return `<div class="wf-flat-select wf-flat-select--readonly" data-wf-flat-select data-field-key="${keyEsc}">
      <span class="wf-flat-select-readonly">${escapeHtml(norm || "—")}</span>
    </div>`;
  }
  const ph = usePlaceholder;
  const labelText = norm || (ph ? "请选择" : String(options[0] || ""));
  const placeholderBtn = ph
    ? `<button type="button" class="wf-flat-select-item wf-flat-select-item--placeholder${!norm ? " is-active" : ""}" data-wf-flat-value-pick="" tabindex="-1">${escapeHtml("请选择")}</button>`
    : "";
  const optsBtns = options
    .map((item) => {
      const sel = item === norm ? " is-active" : "";
      return `<button type="button" class="wf-flat-select-item${sel}" data-wf-flat-value-pick="${escapeAttr(item)}" tabindex="-1">${escapeHtml(item)}</button>`;
    })
    .join("");
  const searchWrap = enableSearch
    ? `<div class="wf-flat-select-search-wrap">
        <input type="text" class="wf-flat-select-search" data-wf-flat-search placeholder="${escapeAttr("搜索版本关键字")}" />
      </div>`
    : "";
  return `<div class="wf-flat-select" data-wf-flat-select data-field-key="${keyEsc}" data-wf-flat-placeholder="${ph ? "1" : "0"}">
    <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(norm)}" data-wf-flat-value />
    <div class="wf-flat-select-inner">
      <button type="button" class="wf-flat-select-trigger cascade-cascader-trigger" aria-expanded="false" aria-haspopup="listbox">
        <span class="wf-flat-select-label cascade-cascader-label${!norm && ph ? " is-placeholder" : ""}">${escapeHtml(labelText)}</span>
        <span class="cascade-cascader-caret" aria-hidden="true">▾</span>
      </button>
      <div class="wf-flat-select-panel" hidden>
        ${searchWrap}
        <div class="wf-flat-select-scroll" data-wf-flat-list>${placeholderBtn}${optsBtns}</div>
        ${enableSearch ? `<div class="wf-flat-select-empty" data-wf-flat-empty hidden>${escapeHtml("无匹配项")}</div>` : ""}
      </div>
    </div>
  </div>`;
}

function bindWorkflowFlatSelect(form) {
  ensureDutyCascaderDocumentClose();
  if (form.dataset.wfFlatSelectFormBound === "1") return;
  form.dataset.wfFlatSelectFormBound = "1";
  form.addEventListener("input", (ev) => {
    const input = ev.target.closest("[data-wf-flat-search]");
    if (!input || !form.contains(input)) return;
    const wrap = input.closest("[data-wf-flat-select]");
    if (!wrap || !form.contains(wrap)) return;
    wfFlatSelectApplySearch(wrap, input.value || "");
  });
  form.addEventListener("click", (ev) => {
    const trig = ev.target.closest(".wf-flat-select-trigger");
    if (trig && form.contains(trig)) {
      ev.preventDefault();
      wfFlatSelectToggle(trig.closest("[data-wf-flat-select]"));
      return;
    }
    const pick = ev.target.closest("[data-wf-flat-value-pick]");
    if (pick && form.contains(pick)) {
      ev.preventDefault();
      const wrap = pick.closest("[data-wf-flat-select]");
      if (!wrap || !form.contains(wrap)) return;
      const raw = pick.getAttribute("data-wf-flat-value-pick");
      wfFlatSelectCommit(wrap, raw == null ? "" : String(raw));
    }
  });
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
  document.querySelectorAll("[data-wf-flat-select]").forEach((w) => wfFlatSelectClose(w));
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
      const insideFlat = e.target.closest("[data-wf-flat-select]");
      document.querySelectorAll(".cascade-cascader").forEach((w) => {
        if (inside !== w) dutyCascaderClose(w);
      });
      document.querySelectorAll("[data-wf-flat-select]").forEach((w) => {
        if (insideFlat !== w) wfFlatSelectClose(w);
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
  const passedView = options.passedView === true;
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
        if (WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS.has(nodeKey) || WF_FLAT_SEARCHABLE_FIELD_KEYS.has(field.key)) {
          control = renderWorkflowFlatSelect(field, value, editable, {
            options,
            usePlaceholder,
            enableSearch: WF_FLAT_SEARCHABLE_FIELD_KEYS.has(field.key),
          });
        } else {
          const placeholderOpt = usePlaceholder
            ? `<option value="" ${value === "" ? "selected" : ""}></option>`
            : "";
          const optionHtml = options
            .map((item) => `<option value="${escapeAttr(item)}" ${item === value ? "selected" : ""}>${escapeHtml(item)}</option>`)
            .join("");
          control = `<select name="${field.key}" ${readonly} ${!editable ? "disabled" : ""}>${placeholderOpt}${optionHtml}</select>`;
        }
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

      if (!editable && passedView) {
        const inlineText = renderPassedInlineValue(field, value);
        return `
        <div class="${fieldCls} problem-field-passed-inline" data-field-key="${escapeAttr(field.key)}">
          <span class="problem-field-passed-label">${escapeHtml(field.label)}${requiredMark}</span>
          <span class="problem-field-passed-sep">：</span>
          <span class="problem-field-passed-text" title="${escapeAttr(inlineText)}">${escapeHtml(inlineText || "-")}</span>
        </div>
      `;
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

function renderPassedInlineValue(field, value) {
  if (field.type === "richtext") {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return String(value || "").replace(/\s+/g, " ").trim();
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

async function fetchAiConversations() {
  const op = getCurrentOperator();
  state.aiConversationsLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/conversations?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) { state.aiConversations = []; return; }
    const j = await r.json();
    state.aiConversations = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiConversations = []; }
  finally { state.aiConversationsLoading = false; }
}

async function fetchAiMessages(convId) {
  state.aiMessagesLoading = true;
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/conversations/${convId}/messages?operator_id=${encodeURIComponent(op.account)}&page_size=200`);
    if (!r.ok) { state.aiMessages = []; return; }
    const j = await r.json();
    state.aiMessages = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiMessages = []; }
  finally { state.aiMessagesLoading = false; }
}

async function fetchAiQuickTemplates() {
  const op = getCurrentOperator();
  state.aiQuickTemplatesLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/quick-templates?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) { state.aiQuickTemplates = []; return; }
    const j = await r.json();
    state.aiQuickTemplates = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiQuickTemplates = []; }
  finally { state.aiQuickTemplatesLoading = false; }
}

async function sendAiChat(convId, content) {
  const op = getCurrentOperator();
  state.aiChatLoading = true;
  state.aiChatError = "";
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, content }),
    });
    const j = await r.json();
    if (!r.ok) {
      state.aiChatError = j.detail || "请求失败";
      return null;
    }
    return j;
  } catch (e) {
    state.aiChatError = String(e.message || e);
    return null;
  } finally {
    state.aiChatLoading = false;
  }
}

async function fetchLlmConfig() {
  const op = getCurrentOperator();
  state.aiLlmConfigLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/params/llm-config?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) { state.aiLlmConfigItems = []; return; }
    const j = await r.json();
    state.aiLlmConfigItems = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiLlmConfigItems = []; }
  finally { state.aiLlmConfigLoading = false; }
}

function renderLlmConfigPageHtml(title) {
  const items = state.aiLlmConfigItems;
  const loading = state.aiLlmConfigLoading;
  const saving = state.aiLlmConfigSaving;
  const msg = state.aiLlmConfigMsg ? `<p class="duty-field-banner duty-field-banner--err">${escapeHtml(state.aiLlmConfigMsg)}</p>` : "";
  const testResult = state.aiLlmConfigTestResult;
  const testHtml = testResult
    ? `<p class="llm-config-test-result ${testResult.ok ? "llm-config-test-ok" : "llm-config-test-fail"}">${escapeHtml(testResult.detail)}</p>`
    : "";

  if (loading && !items.length) {
    return `<section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}"><div class="detail-head"><h2>${escapeHtml(title)}</h2></div><p class="params-page-intro">加载中…</p></section>`;
  }

  const fieldLabels = {
    llm_api_base_url: "API 地址",
    llm_api_key: "API Key",
    llm_model: "模型名称",
    llm_max_tokens: "最大 Token",
    llm_temperature: "温度",
    llm_system_prompt: "系统提示词",
    llm_query_timeout: "查询超时(秒)",
    llm_max_react_rounds: "最大推理轮次",
    llm_max_result_rows: "结果行数上限",
    llm_enabled: "全局开关",
  };
  const boolKeys = new Set(["llm_enabled"]);
  const textareaKeys = new Set(["llm_system_prompt"]);

  const rows = items.map((it) => {
    const key = String(it.key || "");
    const val = String(it.value || "");
    const label = fieldLabels[key] || key;
    const desc = String(it.description || "");
    const isBool = boolKeys.has(key);
    const isTextarea = textareaKeys.has(key);
    const isPassword = key === "llm_api_key";

    let inputHtml;
    if (isBool) {
      const checked = val === "true";
      inputHtml = `<label class="llm-config-switch"><input type="checkbox" data-llm-key="${escapeAttr(key)}" ${checked ? "checked" : ""} /><span class="llm-config-switch-label">${checked ? "已启用" : "已停用"}</span></label>`;
    } else if (isTextarea) {
      inputHtml = `<textarea class="llm-config-textarea" data-llm-key="${escapeAttr(key)}" rows="4" placeholder="${escapeAttr(desc)}">${escapeHtml(val)}</textarea>`;
    } else if (isPassword) {
      inputHtml = `<input type="password" class="llm-config-input" data-llm-key="${escapeAttr(key)}" value="${escapeAttr(val)}" placeholder="${escapeAttr(desc)}" autocomplete="off" />`;
    } else {
      inputHtml = `<input type="text" class="llm-config-input" data-llm-key="${escapeAttr(key)}" value="${escapeAttr(val)}" placeholder="${escapeAttr(desc)}" />`;
    }

    return `<tr>
      <td class="llm-config-label">${escapeHtml(label)}</td>
      <td>${inputHtml}</td>
      <td class="llm-config-desc">${escapeHtml(desc)}</td>
    </tr>`;
  }).join("");

  return `
    <section class="detail-card detail-card-inline params-config-page llm-config-page" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">
          <button type="button" class="action primary" id="llm-config-save" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
          <button type="button" class="action" id="llm-config-test" ${state.aiLlmConfigTesting ? "disabled" : ""}>${state.aiLlmConfigTesting ? "测试中…" : "测试连通性"}</button>
        </div>
      </div>
      ${msg}
      ${testHtml}
      <table class="llm-config-table">
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderAiAssistantPage() {
  const conversations = state.aiConversations;
  const activeConvId = state.aiActiveConvId;
  const messages = state.aiMessages;
  const loading = state.aiChatLoading;
  const error = state.aiChatError;
  const templates = state.aiQuickTemplates;

  const convListHtml = conversations.map((c) => {
    const isActive = c.id === activeConvId;
    const title = String(c.title || "新对话");
    return `<div class="ai-conv-item ${isActive ? "active" : ""}" data-ai-conv-id="${c.id}">
      <span class="ai-conv-title">${escapeHtml(title)}</span>
      <button type="button" class="ai-conv-delete" data-ai-conv-delete="${c.id}" title="删除">×</button>
    </div>`;
  }).join("");

  const presetTemplates = templates.filter((t) => t.is_preset);
  const customTemplates = templates.filter((t) => !t.is_preset);
  const canEditTemplate = whitelistAllows("ai_assistant_template_edit", "readonly");

  const templateHtml = [...presetTemplates, ...customTemplates].map((t) => {
    const isPreset = t.is_preset;
    return `<button type="button" class="ai-quick-btn" data-ai-quick-id="${t.id}" data-ai-quick-question="${escapeAttr(t.question)}" title="${escapeAttr(t.question)}">${escapeHtml(t.question.length > 20 ? t.question.slice(0, 20) + "…" : t.question)}${!isPreset && canEditTemplate ? `<span class="ai-quick-del" data-ai-quick-del="${t.id}">×</span>` : ""}</button>`;
  }).join("");

  const messagesHtml = messages.map((m) => {
    const role = String(m.role || "");
    const content = String(m.content || "");
    const reactSteps = m.react_steps;
    const sqlQuery = m.sql_query;
    const queryResult = m.query_result;

    if (role === "user") {
      return `<div class="ai-msg ai-msg-user"><div class="ai-msg-bubble">${escapeHtml(content)}</div></div>`;
    }

    let stepsHtml = "";
    if (reactSteps && Array.isArray(reactSteps) && reactSteps.length > 0) {
      const stepsInner = reactSteps.map((s, i) => {
        let stepText = "";
        if (s.thought) stepText += `💭 ${escapeHtml(s.thought)}`;
        if (s.action) stepText += `\n🔧 Action: ${escapeHtml(s.action)}`;
        if (s.sql) stepText += `\n📝 SQL: ${escapeHtml(s.sql)}`;
        if (s.observation) {
          const obs = typeof s.observation === "string" ? s.observation : JSON.stringify(s.observation, null, 2);
          stepText += `\n👁️ Observation: ${escapeHtml(obs).slice(0, 500)}`;
        }
        return `<div class="ai-react-step">${stepText}</div>`;
      }).join("");
      stepsHtml = `<details class="ai-react-details"><summary>推理过程 (${reactSteps.length} 步)</summary><div class="ai-react-steps">${stepsInner}</div></details>`;
    }

    let resultHtml = "";
    if (sqlQuery) {
      resultHtml += `<details class="ai-sql-details"><summary>执行的 SQL</summary><pre class="ai-sql-pre">${escapeHtml(sqlQuery)}</pre></details>`;
    }
    if (queryResult && Array.isArray(queryResult) && queryResult.length > 0) {
      const cols = Object.keys(queryResult[0]);
      const maxRows = 10;
      const displayRows = queryResult.slice(0, maxRows);
      const tableRows = displayRows.map((row) => `<tr>${cols.map((c) => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`).join("");
      resultHtml += `<details class="ai-result-details"><summary>查询结果 (${queryResult.length} 行${queryResult.length > maxRows ? `，显示前 ${maxRows} 行` : ""})</summary><div class="ai-result-table-wrap"><table class="ai-result-table"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div></details>`;
    }

    const renderedContent = typeof marked !== "undefined" ? marked.parse(content) : content.replace(/\n/g, "<br>");
    return `<div class="ai-msg ai-msg-assistant">
      <div class="ai-msg-bubble">${renderedContent}</div>
      ${stepsHtml}
      ${resultHtml}
    </div>`;
  }).join("");

  const welcomeHtml = !activeConvId && !messages.length
    ? `<div class="ai-welcome"><div class="ai-welcome-icon">🤖</div><p>你好！我是运维智能助手，可以帮你查询和分析工单数据。</p><p>请选择一个会话或创建新对话开始。</p></div>`
    : "";

  const chatArea = activeConvId
    ? `<div class="ai-chat-messages" id="ai-chat-messages">${messagesHtml}${loading ? '<div class="ai-msg ai-msg-assistant"><div class="ai-msg-bubble ai-msg-thinking">正在思考…</div></div>' : ""}${error ? `<div class="ai-msg ai-msg-error">❌ ${escapeHtml(error)}</div>` : ""}</div>`
    : `<div class="ai-chat-empty">${welcomeHtml}</div>`;

  return `
    <section class="ai-assistant-page" aria-label="智能助手">
      <div class="ai-sidebar">
        <button type="button" class="action primary ai-new-conv-btn" id="ai-new-conv-btn">+ 新对话</button>
        <div class="ai-conv-list" id="ai-conv-list">${convListHtml}</div>
      </div>
      <div class="ai-main">
        ${chatArea}
        <div class="ai-input-area">
          <div class="ai-quick-templates">${templateHtml}${canEditTemplate ? `<button type="button" class="ai-quick-btn ai-quick-add" id="ai-quick-add-btn">+ 添加</button>` : ""}${canEditTemplate && state.aiQuickAddOpen ? `<span class="ai-quick-add-inline"><input type="text" class="ai-quick-add-input" id="ai-quick-add-input" placeholder="输入快捷问题…" /><button type="button" class="ai-quick-add-ok" id="ai-quick-add-ok">✓</button><button type="button" class="ai-quick-add-cancel" id="ai-quick-add-cancel">✕</button></span>` : ""}</div>
          <div class="ai-input-row">
            <input type="text" class="ai-input" id="ai-input" placeholder="输入你的问题…" ${!activeConvId || loading ? "disabled" : ""} />
            <button type="button" class="action primary ai-send-btn" id="ai-send-btn" ${!activeConvId || loading ? "disabled" : ""}>发送</button>
            <button type="button" class="action ai-config-btn" id="ai-user-config-btn" title="我的模型配置">⚙️</button>
          </div>
        </div>
      </div>
    </section>
    ${state.aiUserConfigModalOpen ? renderAiUserConfigModal() : ""}
  `;
}

function renderAiUserConfigModal() {
  const data = state.aiUserConfigData;
  const saving = state.aiUserConfigSaving;
  const msg = state.aiUserConfigMsg ? `<p class="llm-config-banner ${state.aiUserConfigMsg.includes("成功") ? "llm-config-test-ok" : "llm-config-test-fail"}">${escapeHtml(state.aiUserConfigMsg)}</p>` : "";
  const testResult = state.aiLlmConfigTestResult;
  const testHtml = testResult
    ? `<p class="llm-config-test-result ${testResult.ok ? "llm-config-test-ok" : "llm-config-test-fail"}">${escapeHtml(testResult.detail)}</p>`
    : "";

  const effective = data?.effective || {};
  const userOverride = data?.user_override || {};
  const systemDefault = data?.system_default || {};

  const fields = [
    { key: "api_base_url", label: "API 地址", type: "text", ph: systemDefault.api_base_url || "使用系统默认" },
    { key: "api_key", label: "API Key", type: "password", ph: systemDefault.api_key ? "已配置（系统默认）" : "未配置" },
    { key: "model", label: "模型名称", type: "text", ph: systemDefault.model || "使用系统默认" },
    { key: "max_tokens", label: "最大 Token", type: "number", ph: systemDefault.max_tokens || "使用系统默认" },
    { key: "temperature", label: "温度", type: "number", ph: systemDefault.temperature ?? "使用系统默认" },
    { key: "system_prompt", label: "系统提示词", type: "textarea", ph: "留空使用系统默认" },
    { key: "query_timeout", label: "查询超时(秒)", type: "number", ph: systemDefault.query_timeout || "使用系统默认" },
    { key: "max_react_rounds", label: "最大推理轮次", type: "number", ph: systemDefault.max_react_rounds || "使用系统默认" },
    { key: "max_result_rows", label: "结果行数上限", type: "number", ph: systemDefault.max_result_rows || "使用系统默认" },
  ];

  const formRows = fields.map((f) => {
    const val = userOverride[f.key] ?? "";
    let inputHtml;
    if (f.type === "textarea") {
      inputHtml = `<textarea class="llm-config-textarea" data-ai-user-key="${f.key}" rows="3" placeholder="${escapeAttr(f.ph)}">${escapeHtml(String(val))}</textarea>`;
    } else if (f.type === "password") {
      inputHtml = `<input type="password" class="llm-config-input" data-ai-user-key="${f.key}" value="${escapeAttr(String(val))}" placeholder="${escapeAttr(f.ph)}" autocomplete="off" />`;
    } else {
      inputHtml = `<input type="${f.type}" class="llm-config-input" data-ai-user-key="${f.key}" value="${escapeAttr(String(val))}" placeholder="${escapeAttr(f.ph)}" />`;
    }
    const source = val && val !== "****" ? "（你的配置）" : "（系统默认）";
    return `<tr><td class="llm-config-label">${escapeHtml(f.label)}</td><td>${inputHtml}</td><td class="llm-config-desc">${source}</td></tr>`;
  }).join("");

  return `
    <div class="perm-modal-mask" id="ai-user-config-modal">
      <div class="perm-modal ai-user-config-modal">
        <div class="perm-modal-head">
          <h3>我的模型配置</h3>
        </div>
        <div class="perm-modal-body">
          <p class="ai-user-config-hint">未配置的项将使用系统默认值</p>
          ${msg}
          ${testHtml}
          <table class="llm-config-table"><tbody>${formRows}</tbody></table>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="ai-user-config-cancel">取消</button>
          <button type="button" class="action danger" id="ai-user-config-clear">清除我的配置</button>
          <button type="button" class="action" id="ai-user-config-test">测试连通性</button>
          <button type="button" class="action primary" id="ai-user-config-save" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  `;
}

async function bindAiAssistantPage() {
  const op = getCurrentOperator();

  if (state.aiNeedsRefresh) {
    state.aiNeedsRefresh = false;
    await Promise.all([fetchAiConversations(), fetchAiQuickTemplates()]);
    if (state.aiActiveConvId) {
      await fetchAiMessages(state.aiActiveConvId);
    }
    render();
  }

  const newConvBtn = document.getElementById("ai-new-conv-btn");
  if (newConvBtn) {
    newConvBtn.addEventListener("click", async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (!r.ok) { const j = await r.json(); state.aiChatError = j.detail || "创建失败"; render(); return; }
        const j = await r.json();
        state.aiActiveConvId = j.item.id;
        state.aiMessages = [];
        await fetchAiConversations();
        render();
        const input = document.getElementById("ai-input");
        if (input) input.focus();
      } catch (e) { state.aiChatError = String(e.message || e); render(); }
    });
  }

  document.querySelectorAll("[data-ai-conv-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-ai-conv-delete]")) return;
      const convId = parseInt(el.getAttribute("data-ai-conv-id"));
      if (convId && convId !== state.aiActiveConvId) {
        state.aiActiveConvId = convId;
        fetchAiMessages(convId).then(() => render());
      }
    });
  });

  document.querySelectorAll("[data-ai-conv-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const convId = parseInt(btn.getAttribute("data-ai-conv-delete"));
      if (!convId) return;
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/conversations/${convId}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
        if (!r.ok) { const j = await r.json(); state.aiChatError = j.detail || "删除失败"; render(); return; }
        if (state.aiActiveConvId === convId) {
          state.aiActiveConvId = null;
          state.aiMessages = [];
        }
        await fetchAiConversations();
        render();
      } catch (e) { state.aiChatError = String(e.message || e); render(); }
    });
  });

  const sendBtn = document.getElementById("ai-send-btn");
  const input = document.getElementById("ai-input");
  const doSend = async () => {
    if (!input || !state.aiActiveConvId) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    state.aiMessages.push({ role: "user", content: text });
    render();
    const result = await sendAiChat(state.aiActiveConvId, text);
    if (result) {
      state.aiMessages.push(result);
    }
    await fetchAiConversations();
    render();
    const msgArea = document.getElementById("ai-chat-messages");
    if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
  };

  if (sendBtn) sendBtn.addEventListener("click", doSend);
  if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });

  document.querySelectorAll("[data-ai-quick-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-ai-quick-del]")) return;
      const question = btn.getAttribute("data-ai-quick-question");
      if (question && input) { input.value = question; input.focus(); }
    });
  });

  document.querySelectorAll("[data-ai-quick-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tplId = parseInt(btn.getAttribute("data-ai-quick-del"));
      if (!tplId) return;
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/quick-templates/${tplId}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
        if (!r.ok) { const j = await r.json(); state.aiChatError = j.detail || "删除失败"; render(); return; }
        await fetchAiQuickTemplates();
        render();
      } catch (e) { state.aiChatError = String(e.message || e); render(); }
    });
  });

  const addQuickBtn = document.getElementById("ai-quick-add-btn");
  if (addQuickBtn) {
    addQuickBtn.addEventListener("click", () => {
      state.aiQuickAddOpen = true;
      render();
      const inp = document.getElementById("ai-quick-add-input");
      if (inp) inp.focus();
    });
  }

  const addQuickOk = document.getElementById("ai-quick-add-ok");
  if (addQuickOk) {
    addQuickOk.addEventListener("click", async () => {
      const inp = document.getElementById("ai-quick-add-input");
      const question = (inp ? inp.value : "").trim();
      if (!question) return;
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/quick-templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, question }),
        });
        if (!r.ok) { const j = await r.json(); state.aiQuickAddOpen = false; render(); return; }
        state.aiQuickAddOpen = false;
        await fetchAiQuickTemplates();
        render();
      } catch (e) { state.aiQuickAddOpen = false; render(); }
    });
  }

  const addQuickInput = document.getElementById("ai-quick-add-input");
  if (addQuickInput) {
    addQuickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById("ai-quick-add-ok")?.click(); }
      if (e.key === "Escape") { state.aiQuickAddOpen = false; render(); }
    });
  }

  const addQuickCancel = document.getElementById("ai-quick-add-cancel");
  if (addQuickCancel) {
    addQuickCancel.addEventListener("click", () => { state.aiQuickAddOpen = false; render(); });
  }

  const userConfigBtn = document.getElementById("ai-user-config-btn");
  if (userConfigBtn) {
    userConfigBtn.addEventListener("click", async () => {
      state.aiUserConfigModalOpen = true;
      state.aiUserConfigLoading = true;
      state.aiUserConfigMsg = "";
      render();
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config?operator_id=${encodeURIComponent(op.account)}`);
        if (r.ok) {
          state.aiUserConfigData = await r.json();
        }
      } catch (_) {}
      state.aiUserConfigLoading = false;
      render();
    });
  }

  bindAiUserConfigModal();
  const msgArea = document.getElementById("ai-chat-messages");
  if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
}

function bindAiUserConfigModal() {
  const op = getCurrentOperator();
  const cancelBtn = document.getElementById("ai-user-config-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      state.aiUserConfigModalOpen = false;
      state.aiUserConfigMsg = "";
      state.aiLlmConfigTestResult = null;
      render();
    });
  }

  const clearBtn = document.getElementById("ai-user-config-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (!r.ok) { const j = await r.json(); state.aiUserConfigMsg = j.detail || "清除失败"; render(); return; }
        state.aiUserConfigMsg = "配置已清除";
        const r2 = await fetch(`${API_BASE_URL}/api/ai/my-llm-config?operator_id=${encodeURIComponent(op.account)}`);
        if (r2.ok) state.aiUserConfigData = await r2.json();
        render();
      } catch (e) { state.aiUserConfigMsg = String(e.message || e); render(); }
    });
  }

  const saveBtn = document.getElementById("ai-user-config-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const fields = {};
      document.querySelectorAll("[data-ai-user-key]").forEach((el) => {
        const key = el.getAttribute("data-ai-user-key");
        const val = el.value.trim();
        if (val) {
          if (["max_tokens", "query_timeout", "max_react_rounds", "max_result_rows"].includes(key)) {
            fields[key] = parseInt(val) || null;
          } else if (key === "temperature") {
            fields[key] = parseFloat(val) || null;
          } else {
            fields[key] = val;
          }
        } else {
          fields[key] = null;
        }
      });
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, ...fields }),
        });
        if (!r.ok) { const j = await r.json(); state.aiUserConfigMsg = j.detail || "保存失败"; render(); return; }
        state.aiUserConfigMsg = "保存成功";
        const r2 = await fetch(`${API_BASE_URL}/api/ai/my-llm-config?operator_id=${encodeURIComponent(op.account)}`);
        if (r2.ok) state.aiUserConfigData = await r2.json();
        render();
      } catch (e) { state.aiUserConfigMsg = String(e.message || e); render(); }
    });
  }

  const testBtn = document.getElementById("ai-user-config-test");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      state.aiLlmConfigTesting = true;
      state.aiLlmConfigTestResult = null;
      render();
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (r.ok) {
          state.aiLlmConfigTestResult = await r.json();
        } else {
          state.aiLlmConfigTestResult = { ok: false, detail: "测试请求失败" };
        }
      } catch (e) {
        state.aiLlmConfigTestResult = { ok: false, detail: String(e.message || e) };
      }
      state.aiLlmConfigTesting = false;
      render();
    });
  }
}

async function bindLlmConfigPage() {
  const op = getCurrentOperator();

  if (state.aiLlmConfigLoading && !state.aiLlmConfigItems.length) {
    await fetchLlmConfig();
    render();
    return;
  }

  if (!state.aiLlmConfigItems.length) {
    await fetchLlmConfig();
    render();
  }

  const saveBtn = document.getElementById("llm-config-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const items = [];
      document.querySelectorAll("[data-llm-key]").forEach((el) => {
        const key = el.getAttribute("data-llm-key");
        let val;
        if (el.type === "checkbox") {
          val = el.checked ? "true" : "false";
        } else {
          val = el.value.trim();
        }
        const existing = state.aiLlmConfigItems.find((it) => it.key === key);
        items.push({
          key,
          value: val,
          value_type: existing?.value_type || "string",
          description: existing?.description || "",
        });
      });
      state.aiLlmConfigSaving = true;
      state.aiLlmConfigMsg = "";
      try {
        const r = await fetch(`${API_BASE_URL}/api/params/llm-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, items }),
        });
        if (!r.ok) { const j = await r.json(); state.aiLlmConfigMsg = j.detail || "保存失败"; }
        else {
          const j = await r.json();
          state.aiLlmConfigItems = Array.isArray(j.items) ? j.items : [];
          state.aiLlmConfigMsg = "";
        }
      } catch (e) { state.aiLlmConfigMsg = String(e.message || e); }
      state.aiLlmConfigSaving = false;
      render();
    });
  }

  const testBtn = document.getElementById("llm-config-test");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      state.aiLlmConfigTesting = true;
      state.aiLlmConfigTestResult = null;
      render();
      try {
        const r = await fetch(`${API_BASE_URL}/api/params/llm-config/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (r.ok) {
          state.aiLlmConfigTestResult = await r.json();
        } else {
          state.aiLlmConfigTestResult = { ok: false, detail: "测试请求失败" };
        }
      } catch (e) {
        state.aiLlmConfigTestResult = { ok: false, detail: String(e.message || e) };
      }
      state.aiLlmConfigTesting = false;
      render();
    });
  }

  document.querySelectorAll("[data-llm-key][type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      const label = cb.parentElement.querySelector(".llm-config-switch-label");
      if (label) label.textContent = cb.checked ? "已启用" : "已停用";
    });
  });
}

bootstrap();

