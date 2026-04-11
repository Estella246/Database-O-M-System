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

function getUrlByKey(key) {
  if (key === "list") return "/";
  if (key === "admin:permissions") return "/admin/permissions";
  if (key === "admin:users") return "/admin/users";
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
}

function getActiveTicket() {
  if (state.activeKey === "list") return null;
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
  const activeTicket = getActiveTicket();
  const isList = state.activeKey === "list";
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
  document.title = isList ? "运维工单平台 Demo" : isAdmin ? "权限管理" : state.activeKey.replace("ticket:", "");

  root.innerHTML = `
  <div class="layout">
    <aside class="left">
      <div class="left-top">
        <div class="hamburger">☰</div>
        <button id="collapse-btn" class="collapse" title="收起/展开侧边栏">«</button>
      </div>
      <nav class="menu">
        <button class="menu-item ${isList ? "active" : ""}" data-nav-key="list">My Tasks</button>
        <button class="menu-item">值班表</button>
        <button class="menu-item">补丁管理</button>
        <button class="menu-item ${state.activeKey === "admin:permissions" ? "active" : ""}" data-nav-key="admin:permissions">权限策略</button>
        <button class="menu-item ${state.activeKey === "admin:users" ? "active" : ""}" data-nav-key="admin:users">用户管理</button>
        <button class="menu-item">变更日历</button>
        <button class="menu-item">重大问题</button>
      </nav>
      <div class="menu-bottom">
        <button class="menu-item">设置</button>
      </div>
    </aside>

    <main class="center center-enter">
      <div class="head">
        <h1 class="${isList ? "" : "hidden"}">${isList ? "Work Order" : `Order ${activeTicket ? activeTicket.orderId : "Not Found"}`}</h1>
        <div class="actions ${isList ? "" : "hidden"}">
          <button class="action">拉群</button>
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
          <div class="tabs" role="tablist">
            <span class="tab-indicator" aria-hidden="true"></span>
            <button type="button" class="tab ${state.listTab === "pending" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "pending"}" data-tab="pending">待处理</button>
            <button type="button" class="tab ${state.listTab === "all" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "all"}" data-tab="all">全局</button>
            <button type="button" class="tab ${state.listTab === "created" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "created"}" data-tab="created">我创建</button>
          </div>
        </div>
      </div>

      <section class="table-wrap" id="list-panel" aria-live="polite">
        <div class="section-title">Work order list</div>
        <table>
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="select-all-tickets" aria-label="全选工单" /></th><th>流程ID</th><th>当前阶段</th><th>起始日期</th><th>问题严重性</th><th>局点</th><th>业务环境</th><th>当前处理人</th><th>问题描述</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
        <div id="list-pagination" class="list-pagination"></div>
      </section>
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
  <div class="operator-badge">
    <div class="operator-title">当前账号</div>
    <select id="operator-switcher">
      ${operatorOptions.map((account) => `<option value="${escapeAttr(account)}" ${account === currentOperator.account ? "selected" : ""}>${escapeHtml(account)}</option>`).join("")}
    </select>
    <div class="operator-meta">${escapeHtml(currentOperator.userName)}${currentRoleCode ? ` · ${escapeHtml(currentRoleCode)}` : ""}</div>
  </div>
  ${createModalHtml}
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
    state.activeKey = tabTarget.getAttribute("data-workspace-tab");
    history.pushState({}, "", getUrlByKey(state.activeKey));
    render();
  });

  document.querySelectorAll("[data-nav-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-nav-key");
      if (!key) return;
      if (key.startsWith("admin:")) {
        ensureAdminTab(key.split(":")[1]);
      }
      state.activeKey = key;
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
      tr.innerHTML = `<td><input type="checkbox" data-ticket-select="${escapeAttr(ticket.orderId || "")}" ${selectedSet.has(ticket.orderId) ? "checked" : ""} aria-label="选择工单 ${escapeAttr(ticket.orderId || "")}" /></td><td>${escapeHtml(proc)}</td><td>${escapeHtml(stage)}</td><td>${escapeHtml(String(ticket.startDate || ""))}</td><td><span class="p ${sevClass}">${escapeHtml(sevLabel)}</span></td><td>${escapeHtml(String(ticket.location || ""))}</td><td>${escapeHtml(String(ticket.bizEnv || ""))}</td><td>${escapeHtml(handlerDisp)}</td><td class="ticket-desc-cell">${escapeHtml(desc)}</td>`;
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

    const active = document.querySelector(".tabs .tab.active");
    placeTabIndicator(active);
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
      state.activeKey = key;
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
      return;
    }

    const navTarget = target.closest("[data-nav-key]");
    if (navTarget) {
      debugLog("nav.click", { key: navTarget.getAttribute("data-nav-key") || "" });
      event.preventDefault();
      event.stopPropagation();
      const key = navTarget.getAttribute("data-nav-key");
      if (!key) return;
      if (key.startsWith("admin:")) ensureAdminTab(key.split(":")[1]);
      state.activeKey = key;
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
      <form id="node-form-${orderId}-${nodeKey}" ${editable ? `data-node-form="1" data-node-key="${nodeKey}"` : ""}>
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

