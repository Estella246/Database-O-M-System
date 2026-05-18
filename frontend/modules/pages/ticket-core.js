import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state, ticketList, workflowByOrderId, operationLogsByOrderId } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { operatorMatchesPersonField, formatYmdLocal, localYmd, nowText, makeNewTicketId, makeNewHotpatchTicketId, priorityBadgeClass, categoryBadgeClass, valueBadgeClass, sortTicketsByCreatedAtDesc, listPreviewText, uniqueTicketListFilterValues } from "../utils/format.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import {
  WORKFLOW_NODES,
  NODE_KEY_BY_STEP,
  STEP_BY_NODE_KEY,
  HANDLE_MODE_ROUTE,
  WHITELIST_NO_PLACEHOLDER_KEYS,
  TICKET_LIST_FILTER_KEYS,
} from "../constants/workflow.js";
import {
  HOTPATCH_WORKFLOW_NODES,
  HOTPATCH_STEP_BY_NODE_KEY,
  HOTPATCH_NODE_KEY_BY_STEP,
} from "../constants/hotpatch-workflow.js";
import { ensureAdminTab } from "./admin-page.js";
import {
  ensureLeaveTab,
  ensureRequirementTab,
  ensureSettingsTab,
  ensureListTab,
  ensurePatchListTab,
  ensureUploadAnalysisTab,
  ensureOncallEvaTab,
} from "./settings-page.js";
import { ensureParamsTab } from "./params-page.js";
import { ensureAiTab } from "./ai-page.js";
import { ensureStatsChartsTab, ensureStatsReportTab, ensureStatsSkillsTab } from "./stats-page.js";
import { ensureReportIssueTab } from "./report-page.js";
import {
  ensureMonthlyReportTab,
  ensureMonthlyReportArchiveTab,
  loadMonthlyReport,
  loadMonthlyReportArchives,
  currentYm,
} from "./monthly-report-page.js";
import { getFormState, ensureNodeFormData } from "./ticket-page.js";

export function remapTicketOrderId(oldId, newId) {
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
  if (row) {
    row.orderId = newId;
    if (Object.prototype.hasOwnProperty.call(row, "processId")) row.processId = newId;
  }
}

export function hasTicketContext(orderId) {
  if (workflowByOrderId[orderId]) return true;
  if (operationLogsByOrderId[orderId]) return true;
  const prefix = `${orderId}:`;
  return Object.keys(state.formsByTicket).some((k) => String(k).startsWith(prefix));
}

/** 清除仅存在于前端的工单草稿（创建弹窗取消、删除失败回滚等）。 */
export function discardTicketLocalContext(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;
  delete workflowByOrderId[id];
  delete operationLogsByOrderId[id];
  delete state.ticketStatusByOrderId[id];
  delete state.logSyncStateByOrderId[id];
  Object.keys(state.formsByTicket).forEach((k) => {
    if (k.startsWith(`${id}:`)) delete state.formsByTicket[k];
  });
  const idx = ticketList.findIndex((t) => String(t.orderId || "") === id);
  if (idx >= 0) ticketList.splice(idx, 1);
}

/** 关闭创建工单/热补丁弹窗并丢弃未提交的本地草稿。 */
export function closeCreateTicketModal() {
  const draftId = String(state.createTicketId || "").trim();
  if (draftId) discardTicketLocalContext(draftId);
  state.createModalOpen = false;
  state.createTicketId = "";
  state.createModalNodeKey = "";
  state.createModalWorkflow = "HCS_INCIDENT";
}

/**
 * 仅存在于本地上下文（尚未进 ticketList）的工单，从 workflow 或表单 key 推断模板，
 * 供工作台/补丁列表分流（须与后端 template_code 一致）。
 */
export function inferLocalTicketTemplateCode(orderId, workflow, formKeys = null) {
  const fromWf = String(workflow?.templateCode || "").trim();
  if (fromWf === "HOTPATCH" || fromWf === "HCS_INCIDENT") return fromWf;
  const keys = Array.isArray(formKeys) ? formKeys : Object.keys(state.formsByTicket);
  const prefix = `${orderId}:`;
  return keys.some((k) => String(k).startsWith(prefix) && String(k).includes(":hp_")) ? "HOTPATCH" : "HCS_INCIDENT";
}

export function getTicketById(orderId) {
  const found = ticketList.find((item) => item.orderId === orderId);
  if (found) return found;
  if (!hasTicketContext(orderId)) return null;
  const workflow = workflowByOrderId[orderId];
  const templateCode = inferLocalTicketTemplateCode(orderId, workflow);
  const isHotpatch = templateCode === "HOTPATCH";
  const wfNodes = isHotpatch ? HOTPATCH_WORKFLOW_NODES : WORKFLOW_NODES;
  const nkByStep = isHotpatch ? HOTPATCH_NODE_KEY_BY_STEP : NODE_KEY_BY_STEP;
  const currentStepLabel =
    wfNodes[workflow?.currentStep] || (isHotpatch ? "诉求填写" : "运维分析");
  const currentStepKey = nkByStep[currentStepLabel] || (isHotpatch ? "hp_demand_fill" : "ops_analysis");
  const formState = getFormState(orderId, currentStepKey);
  const operator = getCurrentOperator();
  const desc = listPreviewText(
    formState.values?.issue_desc || formState.values?.problem_desc || formState.values?.description || "--",
    500
  );
  const defaultSubject = isHotpatch ? `新建热补丁单 ${orderId}` : `新建工单 ${orderId}`;
  return {
    orderId,
    processId: orderId,
    templateCode,
    subject: String(formState.values?.problem_title || formState.values?.title || defaultSubject),
    severity: String(formState.values?.severity || "一般"),
    node: currentStepLabel,
    node_key: currentStepKey,
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

export function getAllTickets() {
  const items = [...ticketList];
  const exists = new Set(items.map((x) => String(x.orderId || "")));
  const createDraftId =
    state.createModalOpen && state.createTicketId ? String(state.createTicketId).trim() : "";
  const contextIds = new Set([
    ...Object.keys(state.formsByTicket)
      .map((k) => String(k).split(":")[0])
      .filter(Boolean),
    ...Object.keys(workflowByOrderId),
  ]);
  contextIds.forEach((orderId) => {
    if (!orderId || exists.has(orderId)) return;
    if (createDraftId && orderId === createDraftId) return;
    const fallback = getTicketById(orderId);
    if (!fallback) return;
    items.push(fallback);
    exists.add(orderId);
  });
  return sortTicketsByCreatedAtDesc(items);
}

export function renderTicketListFilterHeader(label, colKey, allTickets, filterNs = "list") {
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

/** 与后端 `ticket_no` 一致：`HPM` + 8 位日期 + 3 位序号（共 11 位数字）。 */
const _HPM_TICKET_NO_RE = /^HPM\d{11}$/;

/**
 * 决定 `GET /api/tickets` 的 `template_code`。
 * 深链 `/tickets/HPM…` 时 `activeKey` 为 `ticket:HPM…`，若仍按 HCS 拉取则列表不含该单，刷新后详情会「Order Not Found」。
 */
export function templateCodeForTicketListSync(activeKey) {
  if (activeKey === "patch:list") return "HOTPATCH";
  if (typeof activeKey === "string" && activeKey.startsWith("ticket:")) {
    const oid = activeKey.slice("ticket:".length);
    if (_HPM_TICKET_NO_RE.test(oid)) return "HOTPATCH";
  }
  return "HCS_INCIDENT";
}

export async function syncTicketsFromServer(searchKeyword = "", options = {}) {
  const operator = getCurrentOperator();
  const q = (searchKeyword || state.ticketListSearch || "").trim();
  try {
    const qs = new URLSearchParams();
    qs.set("operator_id", operator.account);
    qs.set("q", q);
    const tpl = options.templateCode || templateCodeForTicketListSync(state.activeKey);
    qs.set("template_code", tpl);
    if (state.activeKey === "list" || state.activeKey === "patch:list") {
      const cf = String(state.ticketListCreatedStart || "").trim();
      const ct = String(state.ticketListCreatedEnd || "").trim();
      if (cf) qs.set("created_from", cf);
      if (ct) qs.set("created_to", ct);
    }
    const url = `${API_BASE_URL}/api/tickets?${qs.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) {
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
      // 保留所有后端返回的字段（包括扩展字段），然后覆盖规范化字段
      const hotpatchFrontierKeys = Array.isArray(r.hotpatchFrontierKeys)
        ? r.hotpatchFrontierKeys
        : Array.isArray(r.hotpatch_frontier_keys)
          ? r.hotpatch_frontier_keys
          : null;
      const hotpatchParallelHandlers =
        r.hotpatchParallelHandlers && typeof r.hotpatchParallelHandlers === "object"
          ? r.hotpatchParallelHandlers
          : r.hotpatch_parallel_handlers && typeof r.hotpatch_parallel_handlers === "object"
            ? r.hotpatch_parallel_handlers
            : {};
      return {
        ...r,  // 保留所有扩展字段（如 use_doer_assist）
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
        hotpatchFrontierKeys,
        hotpatchParallelHandlers,
        description: listPreviewText(r.description || r.description_plain || "--", 200),
        creatorName: String(r.creator_name || r.creatorName || ""),
        creatorId: String(r.creator_id || r.creatorId || ""),
        isQualityIssue: String(r.is_quality_issue || r.isQualityIssue || ""),
        createdAt: String(r.created_at || r.createdAt || ""),
        operatorSubmitted: Boolean(r.operator_submitted ?? r.operatorSubmitted),
        templateCode: String(r.templateCode || r.template_code || ""),
      };
    }).filter((x) => x.orderId);
    const merged = (() => {
      const strip = tpl === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
      const keep = ticketList.filter((t) => String(t.templateCode || "") !== strip);
      return sortTicketsByCreatedAtDesc([...keep, ...mapped]);
    })();
    ticketList.splice(0, ticketList.length, ...merged);
  } catch (_) {
    // Keep local demo data when backend is unavailable.
  }
}

/** 我的主页待办需同时展示 HCS 与 HOTPATCH，须分别拉取后合并进 ticketList */
export async function syncHomeWorkbenchTicketLists(searchKeyword = "") {
  await syncTicketsFromServer(searchKeyword, { templateCode: "HCS_INCIDENT" });
  await syncTicketsFromServer(searchKeyword, { templateCode: "HOTPATCH" });
}

export async function refreshHomeListData() {
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

export function getUrlByKey(key) {
  if (key === "home") return "/";
  if (key === "list") return "/workbench";
  if (key === "patch:list") return "/hotpatch";
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
  if (key === "stats:skills") return "/stats/skills";
  if (key === "ai:assistant") return "/ai-assistant";
  if (key === "params:llm-config") return "/params/llm-config";
  if (key === "upload:analysis") return "/upload-analysis";
  if (key === "oncall:eva") return "/oncall-eva";
  if (key === "report:issue") return "/report/issue";
  if (key === "report:generate") return "/report/generate";
  if (key === "report:archive") return "/report/archive";
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
}

export function getActiveTicket() {
  if (
    state.activeKey === "home" ||
    state.activeKey === "list" ||
    state.activeKey === "patch:list" ||
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

export function ensureTicketTab(orderId) {
  const key = `ticket:${orderId}`;
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: orderId, closable: true });
  }
  return key;
}

export function ensureDutyTab() {
  const key = "duty:roster";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "值班表", closable: true });
  }
  return key;
}

export function ensureHomeTab() {
  const key = "home";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.unshift({ key, label: "我的主页", closable: false });
  }
  return key;
}

export function getCreateModalStartNodeKey() {
  const whitelist = getCurrentWhitelistSettings();
  const fromProblemFill = getWhitelistLevel("workbench_create_from_problem_fill", whitelist) === "editable";
  return fromProblemFill ? "problem_fill" : "ops_analysis";
}

export function beginCreateTicketModal() {
  const operator = getCurrentOperator();
  const orderId = makeNewTicketId();
  const nodeKey = getCreateModalStartNodeKey();
  const stepLabel = STEP_BY_NODE_KEY[nodeKey] || "运维分析";
  state.createTicketId = orderId;
  state.createModalOpen = true;
  state.createModalNodeKey = nodeKey;
  state.createModalWorkflow = "HCS_INCIDENT";
  workflowByOrderId[orderId] = {
    templateCode: "HCS_INCIDENT",
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
  ensureNodeFormData(orderId, nodeKey, "HCS_INCIDENT", true);
  requestRender();
}

export function beginPatchCreateTicketModal() {
  const operator = getCurrentOperator();
  const orderId = makeNewHotpatchTicketId();
  const nodeKey = "hp_demand_fill";
  const stepLabel = HOTPATCH_STEP_BY_NODE_KEY[nodeKey] || "诉求填写";
  state.createTicketId = orderId;
  state.createModalOpen = true;
  state.createModalNodeKey = nodeKey;
  state.createModalWorkflow = "HOTPATCH";
  workflowByOrderId[orderId] = {
    templateCode: "HOTPATCH",
    currentStep: Math.max(0, HOTPATCH_WORKFLOW_NODES.indexOf(stepLabel)),
    logs: [
      {
        step: stepLabel,
        actor: operator.userName,
        at: nowText(),
        summary: `创建热补丁单并从${stepLabel}节点开始。`,
      },
    ],
  };
  operationLogsByOrderId[orderId] = [];
  ensureNodeFormData(orderId, nodeKey, "HOTPATCH", true);
  requestRender();
}

export function syncActiveKeyFromPath(pathname) {
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
  if (pathname === "/upload-analysis" || pathname === "/upload-analysis/") {
    state.activeKey = ensureUploadAnalysisTab();
    return;
  }
  if (pathname === "/oncall-eva" || pathname === "/oncall-eva/") {
    state.activeKey = ensureOncallEvaTab();
    state.oncallEvaNeedsRefresh = true;
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
  if (pathname === "/hotpatch" || pathname === "/hotpatch/") {
    state.activeKey = ensurePatchListTab();
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
  if (pathname === "/stats/skills" || pathname === "/stats/skills/") {
    state.activeKey = ensureStatsSkillsTab();
    return;
  }
  if (pathname === "/report/issue" || pathname === "/report/issue/") {
    state.activeKey = ensureReportIssueTab();
    return;
  }
  if (pathname === "/report/generate" || pathname === "/report/generate/") {
    state.activeKey = ensureMonthlyReportTab();
    void loadMonthlyReport(state.monthlyReportYm || currentYm());
    return;
  }
  if (pathname === "/report/archive" || pathname === "/report/archive/") {
    state.activeKey = ensureMonthlyReportArchiveTab();
    void loadMonthlyReportArchives();
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
