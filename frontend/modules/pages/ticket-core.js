import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state, ticketList, workflowByOrderId, operationLogsByOrderId } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { ensureAiExportTab } from "./ai-export-page.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import {
  operatorMatchesPersonField,
  operatorMatchesAnyPersonFields,
  ticketCreatorMatchesOperator,
  filterTicketsByListColumnFilters,
  formatYmdLocal,
  localYmd,
  nowText,
  priorityBadgeClass,
  categoryBadgeClass,
  valueBadgeClass,
  sortTicketsByCreatedAtDesc,
  listPreviewText,
  uniqueTicketListFilterValues,
  makeCreateDraftTicketId,
  isCreateDraftTicketId,
} from "../utils/format.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { buildQiListQuery, sanitizeQiListView } from "../utils/qi-url-state.js";
import { shouldDeferListSearchRender } from "../ui/list-search-input.js";
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
import { ensureAdminTab, ensureAdminData } from "./admin-page.js";
import {
  ensureLeaveTab,
  ensureRequirementTab,
  ensureQiTab,
  ensureQiDetailTab,
  ensureSettingsTab,
  ensureListTab,
  ensurePatchListTab,
  ensureOncallEvaTab,
  ensureMajorProblemTab,
  ensureSiteProfileTab,
  ensureToolPlazaTab,
} from "./settings-page.js";
import { ensureParamsTab } from "./params-page.js";
import { ensureAiTab } from "./ai-page.js";
import { ensureStatsChartsTab } from "./stats-page.js";
import { ensureShowcaseTab } from "./showcase-page.js";
import { ensureReportIssueTab } from "./report-page.js";
import { ensureRlOncallPublicTab } from "./rl-oncall-public-page.js";
import { ensureToolItemTab, prepareToolPlazaItemEnter } from "./tool-plaza-page.js";
import {
  ensureMonthlyReportTab,
  ensureMonthlyReportArchiveTab,
  loadMonthlyReport,
  loadMonthlyReportArchives,
  currentYm,
} from "./monthly-report-page.js";
import {
  ensureImprovementReportTab,
  ensureImprovementReportArchiveTab,
  loadImprovementReport,
  loadImprovementReportArchives,
} from "./improvement-report-page.js";
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

/** 清除某工单在 formsByTicket 中的全部节点表单缓存。 */
export function clearTicketFormCache(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;
  Object.keys(state.formsByTicket).forEach((k) => {
    if (k.startsWith(`${id}:`)) delete state.formsByTicket[k];
  });
}

/** 清除仅存在于前端的工单草稿（创建弹窗取消、删除失败回滚等）。 */
export function discardTicketLocalContext(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;
  delete workflowByOrderId[id];
  delete operationLogsByOrderId[id];
  delete state.ticketStatusByOrderId[id];
  delete state.logSyncStateByOrderId[id];
  clearTicketFormCache(id);
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
  state.ticketAssistantCreateMode = false;
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

/** 从操作日志推断当前阶段中文名（取最近一条非空 to）。 */
export function inferStageLabelFromOpLogs(orderId, wfNodes) {
  const nodes = Array.isArray(wfNodes) ? wfNodes : WORKFLOW_NODES;
  const logs = operationLogsByOrderId[orderId] || [];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const to = String(logs[i]?.to || "").trim();
    if (to && to !== "-" && nodes.includes(to)) return to;
  }
  return "";
}

export function getTicketById(orderId) {
  const found = ticketList.find((item) => item.orderId === orderId);
  if (found) return found;
  const workflow = workflowByOrderId[orderId];
  if (!workflow) return null;
  const templateCode = inferLocalTicketTemplateCode(orderId, workflow);
  const isHotpatch = templateCode === "HOTPATCH";
  const wfNodes = isHotpatch ? HOTPATCH_WORKFLOW_NODES : WORKFLOW_NODES;
  const nkByStep = isHotpatch ? HOTPATCH_NODE_KEY_BY_STEP : NODE_KEY_BY_STEP;
  const isDraft = isCreateDraftTicketId(orderId);
  // 正式单缺列表行时：优先用操作日志末节点，避免 workflow.currentStep 默认 0 误成「问题填写」。
  const fromLogs = !isDraft ? inferStageLabelFromOpLogs(orderId, wfNodes) : "";
  const stepFromWf =
    Number.isInteger(workflow?.currentStep) && workflow.currentStep >= 0
      ? wfNodes[workflow.currentStep]
      : "";
  const currentStepLabel =
    fromLogs ||
    stepFromWf ||
    (isHotpatch ? "诉求填写" : isDraft ? "运维分析" : "");
  if (!currentStepLabel) return null;
  const currentStepKey = nkByStep[currentStepLabel] || (isHotpatch ? "hp_demand_fill" : "ops_analysis");
  const formState = getFormState(orderId, currentStepKey);
  const operator = getCurrentOperator();
  const desc = listPreviewText(
    formState.values?.issue_desc || formState.values?.problem_desc || formState.values?.description || "--",
    500
  );
  const defaultSubject = isDraft
    ? isHotpatch
      ? "新建热补丁单"
      : "新建工单"
    : isHotpatch
      ? `新建热补丁单 ${orderId}`
      : `新建工单 ${orderId}`;
  // 仅本地草稿可把处理人填为登录人；正式单缺行时留空，避免误判可编辑。
  const handler = isDraft ? operator.userName : "";
  return {
    orderId,
    processId: orderId,
    templateCode,
    subject: String(formState.values?.problem_title || formState.values?.title || defaultSubject),
    severity: String(formState.values?.severity || "一般"),
    node: currentStepLabel,
    node_key: currentStepKey,
    assignee: handler,
    currentStage: currentStepLabel,
    currentHandler: handler,
    startDate: String(formState.values?.start_date || new Date().toISOString().slice(0, 10)),
    location: String(formState.values?.location || ""),
    bizEnv: String(formState.values?.biz_env || ""),
    description: desc,
    status: "open",
    creatorName: isDraft ? operator.userName : "",
    isQualityIssue: String(formState.values?.is_quality_issue || ""),
    createdAt: new Date().toISOString(),
  };
}

export function getAllTickets() {
  const items = [...ticketList];
  const exists = new Set(items.map((x) => String(x.orderId || "")));
  const createDraftId =
    state.createModalOpen && state.createTicketId ? String(state.createTicketId).trim() : "";
  // 仅合并本地建单草稿（workflowByOrderId）。详情页预加载写入的 formsByTicket 不能合成列表行，
  // 否则离开详情后会把「当前处理人」误填为登录人并污染主页待办。
  Object.keys(workflowByOrderId).forEach((orderId) => {
    if (!orderId || exists.has(orderId)) return;
    if (createDraftId && orderId === createDraftId) return;
    const fallback = getTicketById(orderId);
    if (!fallback) return;
    items.push(fallback);
    exists.add(orderId);
  });
  return sortTicketsByCreatedAtDesc(items);
}

export function renderTicketListFilterHeader(label, colKey, allTickets, filterNs = "list", facetValues = null) {
  const filtersState = filterNs === "home" ? state.homeTicketListFilters : state.ticketListFilters;
  const dataPrefix = filterNs === "home" ? "data-home-ticket-list-filter" : "data-ticket-list-filter";
  const thExtra = filterNs === "home" ? " home-ticket-list-th-filter" : "";
  const selected = filtersState.selected[colKey] || [];
  const values = Array.isArray(facetValues)
    ? facetValues
    : uniqueTicketListFilterValues(allTickets, colKey);
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
const _TICKET_DEEP_LINK_RE = /^\/tickets\/([^/]+)\/?$/;

export function parseTicketDeepLinkOrderId(pathname) {
  const match = String(pathname || "").match(_TICKET_DEEP_LINK_RE);
  return match ? decodeURIComponent(match[1]) : "";
}

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

/** 侧栏/页签切换时是否须重新拉工单列表（工作台 ↔ 补丁管理须全量换 template_code） */
export function planTicketListResync(prevKey, nextKey) {
  const listLike = (x) => x === "list" || x === "patch:list";
  if (nextKey === "patch:list" && prevKey !== "patch:list") {
    return { sync: true, ignoreSearch: true };
  }
  if (prevKey === "patch:list" && nextKey === "list") {
    return { sync: true, ignoreSearch: true };
  }
  // 进入工作台/补丁管理时再拉列表；离开时不拉（避免全量列表污染快照分页态）。
  // 工作台仅 HCS 快照分页；补丁管理仅 HOTPATCH；主页由 syncHomeWorkbenchTicketLists 单独拉取。
  if (!listLike(prevKey) && listLike(nextKey)) {
    return { sync: true, ignoreSearch: false };
  }
  return { sync: false, ignoreSearch: false };
}

/**
 * 从非工作台页进入 `list` 时同步清理 legacy 全量 HCS 并标记 loading，
 * 须在首帧 render 之前调用（侧栏、顶栏页签、popstate 等所有入口）。
 */
export function prepareListPageEnter(prevKey, nextKey) {
  const resync = planTicketListResync(prevKey, nextKey);
  if (nextKey === "list" && prevKey !== "list" && resync.sync) {
    state.ticketListServerPaged = true;
    prepareWorkbenchSnapshotSync();
    state.ticketListLoading = true;
  }
  return resync;
}

/**
 * 导航切换后是否须在首帧 render 之后后台拉列表/深链并再 render 一次。
 */
export function navigationNeedsAsyncListSync(prevKey, nextKey) {
  if (nextKey === "home" && prevKey !== "home") return true;
  if (planTicketListResync(prevKey, nextKey).sync) return true;
  return typeof nextKey === "string" && nextKey.startsWith("ticket:");
}

/** @deprecated 使用 navigationNeedsAsyncListSync */
export function navigationNeedsDeferredRender(prevKey, nextKey) {
  return navigationNeedsAsyncListSync(prevKey, nextKey);
}

/**
 * 侧栏/顶栏页签/popstate 等路由切换：先立即 render 切页；列表同步完成后优先就地更新表格，避免第二次整页重绘。
 */
let _navigationListPatchFn = null;

export function registerNavigationListPatch(fn) {
  _navigationListPatchFn = fn;
}

export function runNavigationTicketSyncAndRender(prevKey, nextKey, renderFn) {
  const resync = prepareListPageEnter(prevKey, nextKey);
  if (nextKey === "home" && prevKey !== "home") {
    state.homeWorkbenchListLoading = true;
  }
  renderFn();

  if (!navigationNeedsAsyncListSync(prevKey, nextKey)) return;

  const afterListSync = () => {
    if (typeof _navigationListPatchFn === "function" && _navigationListPatchFn()) return;
    renderFn();
  };

  void (async () => {
    if (nextKey === "home" && prevKey !== "home") {
      await syncHomeWorkbenchTicketLists();
      state.homeWorkbenchListLoading = false;
      afterListSync();
      return;
    }
    if (resync.sync) {
      const search = resync.ignoreSearch ? "" : state.ticketListSearch;
      await syncTicketsFromServer(search);
      afterListSync();
      return;
    }
    if (typeof nextKey === "string" && nextKey.startsWith("ticket:")) {
      const orderId = nextKey.slice("ticket:".length);
      if (state.ticketDetailHydratingOrderId === orderId) {
        const { preloadTicketDetailContent } = await import("./ticket-page.js");
        try {
          await syncSingleTicketFromServer(orderId);
        } catch (_) {
          /* 保留本地行，preload 仍尝试拉节点数据 */
        }
        if (!getTicketById(orderId)) {
          await syncTicketsFromServer("", { ticketNo: orderId });
        }
        await preloadTicketDetailContent(orderId);
        state.ticketDetailHydratingOrderId = "";
      }
      renderFn();
    }
  })();
}

let _ticketListSyncSeq = 0;

/**
 * 将接口列表合并进本地 ticketList：先去掉同模板旧数据，再追加接口行；按 orderId 去重，接口数据优先。
 * @param {Array} localList
 * @param {Array} mapped
 * @param {"HCS_INCIDENT"|"HOTPATCH"} templateCode
 */
export function mergeTicketListAfterServerSync(localList, mapped, templateCode) {
  const strip = templateCode === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const effectiveTemplateCode = (t) => {
    const tc = String(t.templateCode || "").trim();
    if (tc === "HOTPATCH" || tc === "HCS_INCIDENT") return tc;
    return strip === "HCS_INCIDENT" ? "HCS_INCIDENT" : tc;
  };
  const keep = localList.filter((t) => effectiveTemplateCode(t) !== strip);
  const serverOrderIds = new Set(mapped.map((x) => String(x.orderId || "")));
  const keepWithoutServerDupes = keep.filter((t) => !serverOrderIds.has(String(t.orderId || "")));
  return sortTicketsByCreatedAtDesc([...keepWithoutServerDupes, ...mapped]);
}

/**
 * 按 orderId 就地更新/插入列表行，不剥离同模板其它工单。
 * 用于单票 sync（详情进入、节点提交后），避免清掉其它已开详情页签的列表行，
 * 否则切回时 getTicketById 会用 currentStep=0 合成「问题填写」并可误编辑。
 */
export function upsertTicketListRows(localList, mapped) {
  const byId = new Map();
  (localList || []).forEach((t) => {
    const id = String(t?.orderId || "").trim();
    if (id) byId.set(id, t);
  });
  (mapped || []).forEach((t) => {
    const id = String(t?.orderId || "").trim();
    if (!id) return;
    byId.set(id, t);
  });
  return sortTicketsByCreatedAtDesc([...byId.values()]);
}

export function isWorkbenchSnapshotListContext(activeKey, templateCode, options = {}) {
  if (options.ticketNo || options.legacyFullList) return false;
  if (activeKey !== "list") return false;
  return templateCode === "HCS_INCIDENT";
}

/** 是否允许发起列表同步：仅工作台 HCS 快照、补丁全量、或指定 ticket_no；其它场景禁止 legacy 全量。 */
export function shouldSyncTicketListFromServer(activeKey, templateCode, options = {}) {
  const ticketNo = String(options.ticketNo || "").trim();
  if (ticketNo) return true;
  if (options.legacyFullList) return true;
  if (activeKey === "list" && templateCode === "HCS_INCIDENT") return true;
  if (activeKey === "patch:list") return true;
  return false;
}

function workbenchColumnFiltersObject() {
  const sel = state.ticketListFilters?.selected || {};
  const out = {};
  Object.keys(sel).forEach((k) => {
    const arr = Array.isArray(sel[k]) ? sel[k].filter(Boolean) : [];
    if (arr.length) out[k] = arr;
  });
  return out;
}

function serializeWorkbenchColumnFilters() {
  return JSON.stringify(workbenchColumnFiltersObject());
}

/** 有列筛选时走 POST body，避免协同处理人等全选大量值时 GET query 过长失败。 */
function workbenchListHasColumnFilters() {
  return Object.keys(workbenchColumnFiltersObject()).length > 0;
}

export function buildWorkbenchSnapshotListBody(searchKeyword = "") {
  const operator = getCurrentOperator();
  return {
    operator_id: operator.account,
    operator_name: String(operator.userName || ""),
    template_code: "HCS_INCIDENT",
    page: Math.max(1, Number(state.listPage) || 1),
    page_size: Math.max(1, Number(state.listPageSize) || 10),
    tab: String(state.listTab || "all"),
    q: String(searchKeyword ?? state.ticketListSearch ?? "").trim(),
    created_from: String(state.ticketListCreatedStart || "").trim(),
    created_to: String(state.ticketListCreatedEnd || "").trim(),
    column_filters: workbenchColumnFiltersObject(),
  };
}

async function fetchWorkbenchSnapshotListResponse(searchKeyword = "") {
  if (workbenchListHasColumnFilters()) {
    return fetch(`${API_BASE_URL}/api/tickets/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWorkbenchSnapshotListBody(searchKeyword)),
    });
  }
  const qs = buildWorkbenchListQueryParams(searchKeyword);
  return fetch(`${API_BASE_URL}/api/tickets?${qs.toString()}`);
}

async function fetchWorkbenchFacetsResponse(column) {
  const colKey = String(column || "").trim();
  const prefix = String(state.ticketListFilters?.search?.[colKey] || "").trim();
  if (workbenchListHasColumnFilters()) {
    const body = {
      ...buildWorkbenchSnapshotListBody(),
      column: colKey,
      prefix,
    };
    return fetch(`${API_BASE_URL}/api/tickets/facets/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const qs = buildWorkbenchListQueryParams();
  qs.set("column", colKey);
  if (prefix) qs.set("prefix", prefix);
  return fetch(`${API_BASE_URL}/api/tickets/facets?${qs.toString()}`);
}

/** 拉数中途若 pageIds 被误清，展示仍用上一页稳定 ID。 */
let _stickyWorkbenchSnapshotPageIds = [];

/** 快照分页展示：仅保留服务端当前页返回的工单，剔除 merge 进 ticketList 的已打开详情页缓存。 */
export function filterTicketsToWorkbenchSnapshotPage(tickets, pageIds) {
  const ids = new Set(
    (pageIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  if (!ids.size) return [];
  return (tickets || []).filter((t) => ids.has(String(t.orderId || "").trim()));
}

/** 工作台列表可见行：页签 + 列筛选（快照分页时再按当前页 ID 剔除 merge 保留的已打开详情页工单）。 */
export function applyWorkbenchListFilters(baseTickets, operator, options = {}) {
  let base = Array.isArray(baseTickets) ? baseTickets : [];
  const serverPaged =
    options.serverPaged ??
    (state.ticketListServerPaged && state.activeKey === "list");
  if (serverPaged) {
    let pageIds = state.workbenchSnapshotPageIds;
    // 拉数中途 pageIds 为空时，用上一页 sticky，避免短暂 0 条。
    if (
      state.ticketListLoading &&
      (!Array.isArray(pageIds) || pageIds.length === 0) &&
      _stickyWorkbenchSnapshotPageIds.length > 0
    ) {
      pageIds = _stickyWorkbenchSnapshotPageIds;
    }
    base = filterTicketsToWorkbenchSnapshotPage(base, pageIds);
  }
  const visibleByTab = base.filter((t) => {
    if (state.listTab === "all") return true;
    if (state.listTab === "created") return ticketCreatorMatchesOperator(t, operator);
    if (state.listTab === "handled") return Boolean(t.operatorSubmitted);
    if (state.listTab === "collaborated") {
      return operatorMatchesAnyPersonFields(String(t.collaborator || ""), operator);
    }
    const handler = String((t.currentHandler ?? t.assignee) || "").trim();
    return operatorMatchesAnyPersonFields(handler, operator);
  });
  // 快照分页：列筛选弹层打开期间选项来自全量 facets，尚未点「完成」resync。
  // 若此时用已选值客户端过滤当前页，全选大量协同处理人等值会把当前页滤空；
  // 单选碰巧命中当前页则有结果。关闭弹层后再应用列筛选以剔除 merge 残留。
  if (serverPaged && state.ticketListFilters?.openKey) {
    return visibleByTab;
  }
  return filterTicketsByListColumnFilters(visibleByTab, state.ticketListFilters);
}

/** 服务端导出：传递列表筛选条件，由后端按 SQL 拉取工单号。 */
export function buildWorkbenchListExportQuery() {
  const sel = state.ticketListFilters?.selected || {};
  const column_filters = {};
  Object.keys(sel).forEach((k) => {
    const arr = Array.isArray(sel[k]) ? sel[k].filter(Boolean) : [];
    if (arr.length) column_filters[k] = arr;
  });
  return {
    tab: String(state.listTab || "all"),
    q: String(state.ticketListSearch || "").trim(),
    created_from: String(state.ticketListCreatedStart || "").trim(),
    created_to: String(state.ticketListCreatedEnd || "").trim(),
    column_filters,
    template_code: state.activeKey === "patch:list" ? "HOTPATCH" : "HCS_INCIDENT",
  };
}

export function buildWorkbenchListQueryParams(searchKeyword = "") {
  const operator = getCurrentOperator();
  const qs = new URLSearchParams();
  qs.set("operator_id", operator.account);
  qs.set("operator_name", String(operator.userName || ""));
  qs.set("template_code", "HCS_INCIDENT");
  qs.set("page", String(Math.max(1, Number(state.listPage) || 1)));
  qs.set("page_size", String(Math.max(1, Number(state.listPageSize) || 10)));
  qs.set("tab", String(state.listTab || "all"));
  qs.set("q", String(searchKeyword ?? state.ticketListSearch ?? "").trim());
  const cf = String(state.ticketListCreatedStart || "").trim();
  const ct = String(state.ticketListCreatedEnd || "").trim();
  if (cf) qs.set("created_from", cf);
  if (ct) qs.set("created_to", ct);
  const filtersJson = serializeWorkbenchColumnFilters();
  if (filtersJson && filtersJson !== "{}") qs.set("column_filters", filtersJson);
  return qs;
}

/** 服务端分页列表：按当前筛选条件拉取全部工单号（跨页全选用，仅收集 ID 避免 OOM）。 */
export async function fetchWorkbenchFilteredTicketIds() {
  const pageSize = 100;
  const allIds = [];
  let page = 1;
  let total = 0;
  const savedPage = state.listPage;
  const savedPageSize = state.listPageSize;

  try {
    state.listPageSize = pageSize;
    while (true) {
      state.listPage = page;
      try {
        const resp = await fetchWorkbenchSnapshotListResponse();
        if (!resp.ok) break;
        const json = await resp.json();
        const items = Array.isArray(json?.items) ? json.items : [];
        total = Number(json.total) || 0;
        items.forEach((row) => {
          const id = String(row?.orderId || row?.order_id || "").trim();
          if (id) allIds.push(id);
        });
        if (allIds.length >= total || items.length === 0) break;
        page += 1;
      } catch (_) {
        break;
      }
    }
  } finally {
    state.listPage = savedPage;
    state.listPageSize = savedPageSize;
  }
  return allIds;
}

function mergeWorkbenchPagedHcsTickets(mapped) {
  const strip = "HCS_INCIDENT";
  const openIds = new Set(
    state.openTabs
      .filter((tab) => String(tab.key || "").startsWith("ticket:"))
      .map((tab) => tab.key.slice("ticket:".length))
  );
  const keepNonHcs = ticketList.filter((t) => {
    const tc = String(t.templateCode || "").trim();
    return tc !== strip;
  });
  const mappedIds = new Set(mapped.map((x) => String(x.orderId || "")));
  const keepOpenHcs = ticketList.filter(
    (t) =>
      String(t.templateCode || "") === strip &&
      openIds.has(String(t.orderId || "")) &&
      !mappedIds.has(String(t.orderId || ""))
  );
  return sortTicketsByCreatedAtDesc([...keepNonHcs, ...keepOpenHcs, ...mapped]);
}

function countHcsTicketsInList(list) {
  return (list || ticketList).filter((t) => {
    const tc = String(t.templateCode || "HCS_INCIDENT").trim();
    return tc === "HCS_INCIDENT" || tc === "";
  }).length;
}

/** 工作台快照 sync 前去掉主页 legacy 全量 HCS 缓存，避免 loading 期间 render 一次性刷全表。 */
export function shouldPrepareWorkbenchSnapshotSync(listState = {}) {
  const pageSize = Math.max(1, Number(listState.listPageSize ?? state.listPageSize) || 10);
  const serverPaged = listState.ticketListServerPaged ?? state.ticketListServerPaged;
  const pageIds = listState.workbenchSnapshotPageIds ?? state.workbenchSnapshotPageIds;
  // 已有快照当前页时（搜索/翻页），不得 prepare 清空，否则 loading 窗口列表变 0 条。
  if (serverPaged && Array.isArray(pageIds) && pageIds.length > 0) return false;
  const hcsCount = countHcsTicketsInList(listState.ticketList);
  return !serverPaged || hcsCount > pageSize;
}

export function prepareWorkbenchSnapshotSync() {
  state.ticketListServerPaged = true;
  state.workbenchSnapshotPageIds = [];
  _stickyWorkbenchSnapshotPageIds = [];
  ticketList.splice(0, ticketList.length, ...mergeWorkbenchPagedHcsTickets([]));
}

export function invalidateWorkbenchListFacets() {
  state.ticketListFacetValues = {};
}

export async function fetchTicketListFacets(column) {
  const colKey = String(column || "").trim();
  if (!colKey) return;
  try {
    const resp = await fetchWorkbenchFacetsResponse(colKey);
    if (!resp.ok) return;
    const json = await resp.json();
    const values = Array.isArray(json?.values) ? json.values : [];
    state.ticketListFacetValues = { ...state.ticketListFacetValues, [colKey]: values };
  } catch (_) {
    /* 保留已有 facets */
  }
}

export async function resyncWorkbenchTicketList() {
  invalidateWorkbenchListFacets();
  state.listPage = Math.max(1, Number(state.listPage) || 1);
  return syncTicketsFromServer(state.ticketListSearch);
}

export const SNAPSHOT_REBUILD_BATCH_SIZE = 50;

export async function postSnapshotRebuildBatch(body) {
  const resp = await fetch(`${API_BASE_URL}/api/tickets/snapshot/rebuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await parseApiError(resp));
  }
  return resp.json();
}

/** 分批重建 HCS 工作台列表快照；onProgress / onLog 供 UI 同步进度。 */
export async function runWorkbenchSnapshotRebuild({ onProgress, onLog } = {}) {
  const operator = getCurrentOperator();
  let afterTicketId = 0;
  let total = 0;
  let done = 0;

  console.info("[snapshot-rebuild] start", { batchSize: SNAPSHOT_REBUILD_BATCH_SIZE });

  while (true) {
    const json = await postSnapshotRebuildBatch({
      operator_id: operator.account,
      after_ticket_id: afterTicketId,
      batch_size: SNAPSHOT_REBUILD_BATCH_SIZE,
    });
    total = Number(json.total) || total;
    done = Number(json.done_cumulative) ?? done;
    const logs = Array.isArray(json.logs) ? json.logs : [];
    logs.forEach((line) => {
      const msg = String(line || "").trim();
      if (msg) {
        console.info("[snapshot-rebuild]", msg);
        onLog?.(msg);
      }
    });
    onProgress?.({
      done,
      total,
      processed: Number(json.processed) || 0,
      hasMore: Boolean(json.has_more),
    });
    console.info("[snapshot-rebuild] batch", {
      processed: json.processed,
      done,
      total,
      hasMore: json.has_more,
      nextAfter: json.next_after_ticket_id,
    });
    if (!json.has_more) break;
    afterTicketId = Number(json.next_after_ticket_id) || 0;
    if (!afterTicketId) break;
  }

  console.info("[snapshot-rebuild] done", { done, total });
  return { done, total };
}

/** 按 ticket_no 列表重建快照（工作台勾选 / 当前筛选）；超过 batch 时分批请求。 */
export async function runWorkbenchSnapshotRebuildForTicketNos(ticketNos, { onProgress, onLog } = {}) {
  const operator = getCurrentOperator();
  const seen = new Set();
  const nos = [];
  for (const raw of ticketNos || []) {
    const no = String(raw || "").trim();
    if (!no || seen.has(no)) continue;
    seen.add(no);
    nos.push(no);
  }
  if (!nos.length) {
    return { done: 0, total: 0, skippedNotFound: 0 };
  }

  console.info("[snapshot-rebuild] start by_ticket_nos", {
    count: nos.length,
    batchSize: SNAPSHOT_REBUILD_BATCH_SIZE,
  });

  let done = 0;
  let total = 0;
  let skippedNotFound = 0;
  for (let i = 0; i < nos.length; i += SNAPSHOT_REBUILD_BATCH_SIZE) {
    const chunk = nos.slice(i, i + SNAPSHOT_REBUILD_BATCH_SIZE);
    const json = await postSnapshotRebuildBatch({
      operator_id: operator.account,
      ticket_nos: chunk,
      batch_size: SNAPSHOT_REBUILD_BATCH_SIZE,
    });
    const batchDone = Number(json.done_cumulative) || Number(json.refreshed) || 0;
    done += batchDone;
    total += Number(json.total) || batchDone;
    skippedNotFound += Number(json.skipped_not_found) || 0;
    const logs = Array.isArray(json.logs) ? json.logs : [];
    logs.forEach((line) => {
      const msg = String(line || "").trim();
      if (msg) {
        console.info("[snapshot-rebuild]", msg);
        onLog?.(msg);
      }
    });
    onProgress?.({
      done,
      total: nos.length,
      processed: batchDone,
      hasMore: i + SNAPSHOT_REBUILD_BATCH_SIZE < nos.length,
    });
    console.info("[snapshot-rebuild] by_ticket_nos batch", {
      chunk: chunk.length,
      done,
      requested: nos.length,
      skippedNotFound,
    });
  }

  console.info("[snapshot-rebuild] done by_ticket_nos", { done, total, skippedNotFound });
  return { done, total, skippedNotFound };
}

/**
 * 工作台是否存在缩小范围的列表条件（搜索/页签/日期/列筛选）。
 * 无条件时顶栏「重建列表快照」仍走全量游标重建。
 */
export function workbenchListHasActiveScope() {
  if (String(state.ticketListSearch || "").trim()) return true;
  if (String(state.listTab || "all").trim() !== "all") return true;
  if (String(state.ticketListCreatedStart || "").trim()) return true;
  if (String(state.ticketListCreatedEnd || "").trim()) return true;
  const sel = state.ticketListFilters?.selected || {};
  return Object.keys(sel).some((k) => {
    const arr = Array.isArray(sel[k]) ? sel[k].filter(Boolean) : [];
    return arr.length > 0;
  });
}

/**
 * 解析顶栏「重建列表快照」目标：勾选优先，否则当前筛选；皆无则全量。
 * @returns {{ mode: "selected" | "filtered" | "all", ticketNos: string[] }}
 */
export function resolveWorkbenchSnapshotRebuildTarget(selectedTicketIds = state.selectedTicketIds) {
  const selected = [];
  const seen = new Set();
  for (const raw of selectedTicketIds || []) {
    const no = String(raw || "").trim();
    if (!no || seen.has(no)) continue;
    seen.add(no);
    selected.push(no);
  }
  if (selected.length) {
    return { mode: "selected", ticketNos: selected };
  }
  if (workbenchListHasActiveScope()) {
    return { mode: "filtered", ticketNos: [] };
  }
  return { mode: "all", ticketNos: [] };
}

/** @deprecated 请使用 runWorkbenchSnapshotRebuild */
export async function rebuildWorkbenchListSnapshot() {
  const summary = await runWorkbenchSnapshotRebuild();
  return {
    ok: true,
    refreshed: summary.done,
    total: summary.total,
  };
}

/** 节点提交/流转后只刷新当前工单，避免在详情页触发 legacy 全量列表拉取。 */
export async function syncSingleTicketFromServer(orderId) {
  const ticketNo = String(orderId || "").trim();
  if (!ticketNo) return;
  return syncTicketsFromServer("", { ticketNo });
}

export async function syncTicketsFromServer(searchKeyword = "", options = {}) {
  const seq = ++_ticketListSyncSeq;
  const operator = getCurrentOperator();
  const ticketNo = String(options.ticketNo || "").trim();
  const q = ticketNo ? "" : (searchKeyword || state.ticketListSearch || "").trim();
  const tpl = options.templateCode || templateCodeForTicketListSync(state.activeKey);
  if (!shouldSyncTicketListFromServer(state.activeKey, tpl, options)) {
    return;
  }
  const workbenchSnapshot = isWorkbenchSnapshotListContext(state.activeKey, tpl, options);
  if (workbenchSnapshot) {
    state.ticketListServerPaged = true;
    if (shouldPrepareWorkbenchSnapshotSync()) {
      prepareWorkbenchSnapshotSync();
    }
  }
  state.ticketListLoading = true;
  // 搜索/翻页拉数期间保留上一页 snapshot IDs，避免输入挂起 render 时列表被滤成空。
  // 新结果到达后再整体替换 workbenchSnapshotPageIds。
  try {
    let resp;
    if (ticketNo) {
      const qs = new URLSearchParams();
      qs.set("operator_id", operator.account);
      qs.set("template_code", tpl);
      qs.set("ticket_no", ticketNo);
      resp = await fetch(`${API_BASE_URL}/api/tickets?${qs.toString()}`);
    } else if (workbenchSnapshot) {
      resp = await fetchWorkbenchSnapshotListResponse(q);
    } else {
      const qs = new URLSearchParams();
      qs.set("operator_id", operator.account);
      qs.set("operator_name", String(operator.userName || ""));
      qs.set("q", q);
      qs.set("template_code", tpl);
      if (state.activeKey === "list" || state.activeKey === "patch:list") {
        const cf = String(state.ticketListCreatedStart || "").trim();
        const ct = String(state.ticketListCreatedEnd || "").trim();
        if (cf) qs.set("created_from", cf);
        if (ct) qs.set("created_to", ct);
      }
      resp = await fetch(`${API_BASE_URL}/api/tickets?${qs.toString()}`);
    }
    if (!resp.ok) {
      return;
    }
    const json = await resp.json();
    if (seq !== _ticketListSyncSeq) return;
    const items = Array.isArray(json?.items) ? json.items : [];
    const mapped = items.map(mapServerTicketListRow).filter((x) => x.orderId);
    if (ticketNo) {
      // 单票刷新：只 upsert，勿用 merge 剥离同模板其它已开页签行。
      ticketList.splice(0, ticketList.length, ...upsertTicketListRows(ticketList, mapped));
    } else if (workbenchSnapshot && json.list_mode === "snapshot") {
      // 输入/拼音未停手时，空结果多半是中间态，勿覆盖上一页（否则会闪 0 条）。
      if (mapped.length === 0 && shouldDeferListSearchRender()) {
        return;
      }
      state.ticketListServerPaged = true;
      state.ticketListTotal = Number(json.total) || 0;
      if (Number(json.page) > 0) state.listPage = Number(json.page);
      state.workbenchSnapshotPageIds = mapped
        .map((x) => String(x.orderId || "").trim())
        .filter(Boolean);
      // 仅非空结果刷新 sticky；空结果在已停手时才清 sticky（真实无匹配）。
      if (mapped.length > 0) {
        _stickyWorkbenchSnapshotPageIds = state.workbenchSnapshotPageIds.slice();
      } else {
        _stickyWorkbenchSnapshotPageIds = [];
      }
      ticketList.splice(0, ticketList.length, ...mergeWorkbenchPagedHcsTickets(mapped));
    } else if (workbenchSnapshot && json.list_mode !== "snapshot") {
      state.ticketListServerPaged = false;
      state.ticketListTotal = mapped.length;
      ticketList.splice(0, ticketList.length, ...mergeTicketListAfterServerSync(ticketList, mapped, tpl));
    } else {
      // 主页 HOTPATCH 全量同步晚于工作台快照分页完成时，勿把 list 误切回客户端分页（否则只剩当前页条数）。
      if (state.activeKey === "list" && tpl === "HCS_INCIDENT") {
        state.ticketListServerPaged = false;
        state.ticketListTotal = 0;
      }
      ticketList.splice(0, ticketList.length, ...mergeTicketListAfterServerSync(ticketList, mapped, tpl));
    }
  } catch (_) {
    // Keep local demo data when backend is unavailable.
  } finally {
    if (seq === _ticketListSyncSeq) {
      state.ticketListLoading = false;
      state.ticketListLoaded = true;
    }
  }
}

const LEGACY_TICKET_CLOSED_STATUSES = new Set([
  "关闭",
  "完成",
  "非问题关闭",
  "已关闭",
]);

/** 工单是否终态：新平台 closed 或迁入后的老库中文关闭态。 */
export function isTicketClosedStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return false;
  if (raw.toLowerCase() === "closed") return true;
  return LEGACY_TICKET_CLOSED_STATUSES.has(raw);
}

function mapServerTicketListRow(r) {
  const status = String(r.status || "").trim() || "open";
  const currentStage = String(r.current_stage || r.currentStage || r.node || "").trim() || "-";
  const rawNodeKey = String(r.node_key || r.nodeKey || "").trim().toLowerCase();
  const isTempSuspended = status === "暂时挂起" || status.toLowerCase() === "suspended";
  const nodeKey = isTempSuspended ? "audit_close" : rawNodeKey;
  const stepFromNodeKey = nodeKey ? String(STEP_BY_NODE_KEY[nodeKey] || "").trim() : "";
  const workflowNodeLabel = isTempSuspended
    ? "审核关闭"
    : stepFromNodeKey || (currentStage !== "-" ? currentStage : "");
  const handlerRaw = String(r.current_handler ?? r.currentHandler ?? r.assignee ?? "").trim();
  const currentHandler = isTicketClosedStatus(status) ? "" : handlerRaw;
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
    ...r,
    status,
    orderId: String(r.order_id || r.orderId || ""),
    processId: String(r.process_id || r.processId || r.order_id || r.orderId || ""),
    currentStage,
    startDate: String(r.start_date || r.startDate || ""),
    location: String(r.location || ""),
    bizEnv: String(r.biz_env || r.bizEnv || ""),
    currentHandler,
    node_key: nodeKey || rawNodeKey,
    severity: String(r.severity || r.priority || "一般"),
    node: workflowNodeLabel || currentStage,
    assignee: currentHandler,
    hotpatchFrontierKeys,
    hotpatchParallelHandlers,
    description: listPreviewText(r.description || r.description_plain || "--", 200),
    creatorName: String(r.creator_name || r.creatorName || ""),
    creatorId: String(r.creator_id || r.creatorId || ""),
    isQualityIssue: String(r.is_quality_issue || r.isQualityIssue || ""),
    createdAt: String(r.created_at || r.createdAt || ""),
    closedAt: String(r.closed_at || r.closedAt || ""),
    suspendedAt: String(r.suspended_at || r.suspendedAt || ""),
    slaPausedSeconds: Number(r.slaPausedSeconds ?? r.sla_paused_seconds ?? 0) || 0,
    operatorSubmitted: Boolean(r.operator_submitted ?? r.operatorSubmitted),
    templateCode: String(r.templateCode || r.template_code || ""),
  };
}

/** 首屏/深链：只预载当前工单，避免拉全量列表。统计页改由 /api/stats/charts 按需聚合。 */
export async function syncBootstrapTickets(pathname = window.location.pathname) {
  const orderId = parseTicketDeepLinkOrderId(pathname);
  if (state.activeKey === "home") {
    await syncHomeWorkbenchTicketLists();
    return;
  }
  if (state.activeKey === "stats:charts" || state.activeKey === "stats:skills" || state.activeKey === "stats:qi-analytics") {
    return;
  }
  if (state.activeKey === "list" || state.activeKey === "patch:list") {
    await syncTicketsFromServer();
    return;
  }
  if (orderId) {
    await syncTicketsFromServer("", { ticketNo: orderId });
    return;
  }
  // 其它页（管理/参数/值班等）首屏不拉 HCS 全量列表，避免 legacy page=0 OOM
}

/** 浏览器前进/后退到工单深链且本地尚无该单时补拉。返回是否实际发起了补拉。 */
export async function ensureDeepLinkTicketLoaded() {
  if (typeof state.activeKey !== "string" || !state.activeKey.startsWith("ticket:")) return false;
  const orderId = state.activeKey.slice("ticket:".length);
  if (getTicketById(orderId)) return false;
  await syncTicketsFromServer("", { ticketNo: orderId });
  return true;
}

/** 主页 HCS 快照 tab：各页签与服务端筛选口径一致（见 ticket_list_snapshot._base_where）。 */
export function homeHcsSnapshotTabForSync(homeWorkbenchTab) {
  switch (String(homeWorkbenchTab || "").trim()) {
    case "pending":
      return "pending";
    case "pending_close":
      return "pending_close";
    case "audit_close":
      return "audit_close";
    case "handled":
      return "handled";
    default:
      return "all";
  }
}

/** 我的主页需合并 HCS + HOTPATCH 数据集的页签（待办、曾处理） */
export function homeWorkbenchTabUsesMergedTicketBase(tab) {
  return tab === "pending" || tab === "handled";
}

/** 主页工单列表页签是否走快照服务端 tab（HCS 部分）；HOTPATCH 仍单独拉取后合并。 */
export function homeWorkbenchTabUsesServerSnapshotTab(tab) {
  const t = String(tab || "").trim();
  return (
    t === "pending" ||
    t === "pending_close" ||
    t === "audit_close" ||
    t === "handled"
  );
}

export function filterTicketsByHomeWorkbenchTab(tickets, tab, operator, options = {}) {
  const list = tickets || [];
  const serverHcsTab = Boolean(options.serverHcsTab);
  if (tab === "leave_pending") return [];
  return list.filter((t) => {
    const tc = String(t.templateCode || "").trim();
    if (serverHcsTab && tc !== "HOTPATCH") return true;
    if (tab === "pending") {
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesAnyPersonFields(handler, operator);
    }
    if (tab === "pending_close") {
      if (isTicketClosedStatus(t.status)) return false;
      return Boolean(t.operatorSubmitted);
    }
    if (tab === "audit_close") {
      const nk = String(t.node_key || "").trim();
      if (nk !== "audit_close") return false;
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesAnyPersonFields(handler, operator);
    }
    if (tab === "handled") {
      return Boolean(t.operatorSubmitted);
    }
    return true;
  });
}

function homeColumnFiltersObject() {
  const sel = state.homeTicketListFilters?.selected || {};
  const out = {};
  Object.keys(sel).forEach((k) => {
    const arr = Array.isArray(sel[k]) ? sel[k].filter(Boolean) : [];
    if (arr.length) out[k] = arr;
  });
  return out;
}

function serializeHomeColumnFilters() {
  return JSON.stringify(homeColumnFiltersObject());
}

function homeListHasColumnFilters() {
  return Object.keys(homeColumnFiltersObject()).length > 0;
}

export function buildHomeHcsListBody(searchKeyword = "", page = 1, pageSize = 10, tab = "all") {
  const operator = getCurrentOperator();
  return {
    operator_id: operator.account,
    operator_name: String(operator.userName || ""),
    template_code: "HCS_INCIDENT",
    tab: String(tab || "all"),
    q: String(searchKeyword || "").trim(),
    page: Math.max(1, Number(page) || 1),
    page_size: Math.max(1, Number(pageSize) || 10),
    column_filters: homeColumnFiltersObject(),
  };
}

/** 主页 HCS 列表查询（快照分页；列筛选走 column_filters）。 */
export function buildHomeHcsListQueryParams(searchKeyword = "", page = 1, pageSize = 10, tab = "all") {
  const operator = getCurrentOperator();
  const qs = new URLSearchParams();
  qs.set("operator_id", operator.account);
  qs.set("operator_name", String(operator.userName || ""));
  qs.set("template_code", "HCS_INCIDENT");
  qs.set("tab", String(tab || "all"));
  qs.set("q", String(searchKeyword || "").trim());
  qs.set("page", String(Math.max(1, Number(page) || 1)));
  qs.set("page_size", String(Math.max(1, Number(pageSize) || 10)));
  const filtersJson = serializeHomeColumnFilters();
  if (filtersJson && filtersJson !== "{}") qs.set("column_filters", filtersJson);
  return qs;
}

function ticketCreatedAtSortMs(t) {
  const raw = t?.createdAt ?? t?.created_at;
  if (raw) {
    const ms = Date.parse(String(raw));
    if (!Number.isNaN(ms)) return ms;
  }
  const sd = String(t?.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sd)) {
    const ms = Date.parse(sd.slice(0, 10));
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function compareTicketsCreatedDesc(a, b) {
  const d = ticketCreatedAtSortMs(b) - ticketCreatedAtSortMs(a);
  if (d !== 0) return d;
  return String(b?.orderId || "").localeCompare(String(a?.orderId || ""));
}

/** 主页 HCS：单页快照列表（与工作台一致，不循环拉全量）。 */
export async function fetchHomeHcsSnapshotPage(searchKeyword = "", page = 1, pageSize = 10, tab = "all") {
  try {
    let resp;
    if (homeListHasColumnFilters()) {
      resp = await fetch(`${API_BASE_URL}/api/tickets/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildHomeHcsListBody(searchKeyword, page, pageSize, tab)),
      });
    } else {
      const qs = buildHomeHcsListQueryParams(searchKeyword, page, pageSize, tab);
      resp = await fetch(`${API_BASE_URL}/api/tickets?${qs.toString()}`);
    }
    if (!resp.ok) return { listMode: "error", items: [], total: 0, page: 1 };
    const json = await resp.json();
    const listMode = String(json.list_mode || "");
    if (listMode !== "snapshot") return { listMode, items: [], total: 0, page: 1 };
    const items = (Array.isArray(json?.items) ? json.items : [])
      .map(mapServerTicketListRow)
      .filter((x) => x.orderId);
    return {
      listMode: "snapshot",
      items,
      total: Number(json.total) || 0,
      page: Number(json.page) || page,
    };
  } catch (_) {
    return { listMode: "error", items: [], total: 0, page: 1 };
  }
}

function filterHomeHotpatchTicketsForTab(tab, operator) {
  const hot = (state.homeHotpatchTickets || []).filter(
    (t) => String(t.templateCode || "") === "HOTPATCH"
  );
  const byTab = filterTicketsByHomeWorkbenchTab(hot, tab, operator, { serverHcsTab: false });
  return filterTicketsByListColumnFilters(byTab, state.homeTicketListFilters);
}

async function* iterateHomeMergedTicketStream(tab, searchKeyword, operator) {
  const hpSorted = filterHomeHotpatchTicketsForTab(tab, operator).sort(compareTicketsCreatedDesc);
  let hpIdx = 0;
  let hcsPage = 1;
  const hcsChunk = 100;
  let hcsBuffer = [];
  let hcsBufIdx = 0;
  let hcsTotal = Infinity;

  async function refillHcs() {
    const chunk = await fetchHomeHcsSnapshotPage(searchKeyword, hcsPage, hcsChunk, tab);
    if (chunk.listMode !== "snapshot") {
      hcsTotal = 0;
      hcsBuffer = [];
      return;
    }
    hcsTotal = chunk.total;
    hcsBuffer = chunk.items;
    hcsBufIdx = 0;
    hcsPage += 1;
  }

  await refillHcs();
  while (hpIdx < hpSorted.length || hcsBufIdx < hcsBuffer.length || (hcsPage - 1) * hcsChunk < hcsTotal) {
    const hpItem = hpIdx < hpSorted.length ? hpSorted[hpIdx] : null;
    let hcsItem = hcsBufIdx < hcsBuffer.length ? hcsBuffer[hcsBufIdx] : null;
    if (!hcsItem && (hcsPage - 1) * hcsChunk < hcsTotal) {
      await refillHcs();
      hcsItem = hcsBufIdx < hcsBuffer.length ? hcsBuffer[hcsBufIdx] : null;
    }
    if (!hpItem && !hcsItem) break;
    if (hpItem && (!hcsItem || compareTicketsCreatedDesc(hpItem, hcsItem) <= 0)) {
      yield hpItem;
      hpIdx += 1;
    } else if (hcsItem) {
      yield hcsItem;
      hcsBufIdx += 1;
    } else {
      break;
    }
  }
}

/** 主页列表当前页：HCS 快照分页；待办/曾处理与 HOTPATCH 按建单时间归并后取一页。 */
export async function composeHomeListPage(searchKeyword = "", page = 1, pageSize = 10, tab = "all") {
  const operator = getCurrentOperator();
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 10);
  const mergeHotpatch = homeWorkbenchTabUsesMergedTicketBase(tab);

  if (!mergeHotpatch) {
    return fetchHomeHcsSnapshotPage(searchKeyword, pageNum, size, tab);
  }

  const hpSorted = filterHomeHotpatchTicketsForTab(tab, operator);
  const hcsMeta = await fetchHomeHcsSnapshotPage(searchKeyword, 1, 1, tab);
  if (hcsMeta.listMode !== "snapshot") {
    return { listMode: hcsMeta.listMode, items: [], total: 0, page: pageNum };
  }
  const combinedTotal = hpSorted.length + hcsMeta.total;
  const start = (pageNum - 1) * size;
  const items = [];
  let i = 0;
  for await (const row of iterateHomeMergedTicketStream(tab, searchKeyword, operator)) {
    if (i >= start && items.length < size) items.push(row);
    if (items.length >= size) break;
    i += 1;
  }
  return { listMode: "snapshot", items, total: combinedTotal, page: pageNum };
}

export function invalidateHomeListFacets() {
  state.homeListFacetValues = {};
}

export async function fetchHomeListFacets(column) {
  const colKey = String(column || "").trim();
  if (!colKey) return;
  const tab = homeHcsSnapshotTabForSync(state.homeWorkbenchTab);
  const prefix = String(state.homeTicketListFilters?.search?.[colKey] || "").trim();
  try {
    let resp;
    if (homeListHasColumnFilters()) {
      resp = await fetch(`${API_BASE_URL}/api/tickets/facets/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildHomeHcsListBody("", 1, 10, tab),
          column: colKey,
          prefix,
        }),
      });
    } else {
      const qs = buildHomeHcsListQueryParams("", 1, 10, tab);
      qs.set("column", colKey);
      if (prefix) qs.set("prefix", prefix);
      resp = await fetch(`${API_BASE_URL}/api/tickets/facets?${qs.toString()}`);
    }
    if (!resp.ok) return;
    const json = await resp.json();
    const values = Array.isArray(json?.values) ? json.values : [];
    state.homeListFacetValues = { ...state.homeListFacetValues, [colKey]: values };
  } catch (_) {
    /* 保留已有 facets */
  }
}

export function buildHomeListFacetsQueryParams(column) {
  const tab = homeHcsSnapshotTabForSync(state.homeWorkbenchTab);
  const qs = buildHomeHcsListQueryParams("", 1, 10, tab);
  qs.set("column", column);
  return qs;
}

let _homeListSyncSeq = 0;

/** 拉取 HOTPATCH 全量（体量通常较小）供主页待办/曾处理合并，不写入全局 ticketList。 */
export async function syncHomeHotpatchTicketsOnly(searchKeyword = "") {
  const operator = getCurrentOperator();
  const q = String(searchKeyword || "").trim();
  const qs = new URLSearchParams();
  qs.set("operator_id", operator.account);
  qs.set("operator_name", String(operator.userName || ""));
  qs.set("q", q);
  qs.set("template_code", "HOTPATCH");
  try {
    const resp = await fetch(`${API_BASE_URL}/api/tickets?${qs.toString()}`);
    if (!resp.ok) {
      state.homeHotpatchTickets = [];
      return;
    }
    const json = await resp.json();
    const items = (Array.isArray(json?.items) ? json.items : [])
      .map(mapServerTicketListRow)
      .filter((x) => x.orderId);
    state.homeHotpatchTickets = items;
  } catch (_) {
    state.homeHotpatchTickets = [];
  }
}

/** 主页工单表：仅拉当前页（服务端分页）。 */
export async function syncHomeWorkbenchListPage(searchKeyword = "") {
  const seq = ++_homeListSyncSeq;
  const tab = homeHcsSnapshotTabForSync(state.homeWorkbenchTab);
  state.homeListServerPaged = true;
  state.homeWorkbenchListLoading = true;
  try {
    if (homeWorkbenchTabUsesMergedTicketBase(state.homeWorkbenchTab)) {
      await syncHomeHotpatchTicketsOnly(searchKeyword);
    } else {
      state.homeHotpatchTickets = [];
    }
    if (seq !== _homeListSyncSeq) return;
    const result = await composeHomeListPage(
      searchKeyword,
      state.homeListPage,
      state.homeListPageSize,
      tab
    );
    if (seq !== _homeListSyncSeq) return;
    if (result.listMode === "snapshot") {
      state.homeListTickets = result.items;
      state.homeListTotal = Number(result.total) || 0;
      if (Number(result.page) > 0) state.homeListPage = Number(result.page);
    } else {
      state.homeListTickets = [];
      state.homeListTotal = 0;
    }
  } finally {
    if (seq === _homeListSyncSeq) {
      state.homeWorkbenchListLoading = false;
    }
  }
}

export async function resyncHomeWorkbenchList() {
  invalidateHomeListFacets();
  state.homeListPage = Math.max(1, Number(state.homeListPage) || 1);
  return syncHomeWorkbenchListPage();
}

/** @deprecated 全量拉取已废弃；保留别名避免旧引用断裂。 */
export async function fetchAllHomeHcsSnapshotTickets(searchKeyword = "", tab = "all") {
  const one = await fetchHomeHcsSnapshotPage(searchKeyword, 1, 1, tab);
  return { listMode: one.listMode, tickets: one.listMode === "snapshot" ? [] : null };
}

/** @deprecated 使用 syncHomeWorkbenchListPage */
export async function syncHomeHcsTicketList(searchKeyword = "") {
  return syncHomeWorkbenchListPage(searchKeyword);
}

/** 我的主页：当前页工单 + 走单日历 + 个人统计。 */
export async function syncHomeWorkbenchTicketLists(searchKeyword = "") {
  const { fetchHomePersonalStats } = await import("./home-page.js");
  await Promise.all([
    syncHomeWorkbenchListPage(searchKeyword),
    fetchHomeOrderHeatmapCounts(),
    fetchHomePersonalStats(),
  ]);
}

export async function fetchHomeOrderHeatmapCounts() {
  const operator = getCurrentOperator();
  state.homeOrderHeatmapLoading = true;
  try {
    const qs = new URLSearchParams();
    qs.set("operator_id", operator.account);
    qs.set("operator_name", String(operator.userName || ""));
    const resp = await fetch(`${API_BASE_URL}/api/home/order-heatmap?${qs.toString()}`);
    if (!resp.ok) return;
    const json = await resp.json();
    const raw = json?.counts;
    state.homeOrderHeatmapCounts =
      raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  } catch (_) {
    /* 保留已有热力图缓存 */
  } finally {
    state.homeOrderHeatmapLoading = false;
    const { patchMyHomeHeatmapDom } = await import("./home-page.js");
    if (!patchMyHomeHeatmapDom()) requestRender();
  }
}

export async function refreshHomeListData() {
  if (state.activeKey === "home") {
    await syncHomeWorkbenchTicketLists();
  } else if (state.activeKey === "list" || state.activeKey === "patch:list") {
    await syncTicketsFromServer(state.ticketListSearch);
  }
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
  if (key === "rl:oncall") return "/rl-oncall";
  if (key === "leave:application") return "/leave-application";
  if (key === "assistant:ticket") return "/ticket-assistant";
  if (key === "req:manage") return "/requirements";
  if (key === "qi:manage") {
    // 带上当前筛选 query：侧栏/顶栏 tab 等 pushState 导航离开再回来不丢筛选
    const qs = buildQiListQuery(state).toString();
    return "/qi" + (qs ? "?" + qs : "");
  }
  if (key.startsWith("qi-detail:")) return `/qi/${key.slice("qi-detail:".length)}`;
  if (key === "major:problem") return "/major-problems";
  if (key === "site:profile") return "/site-profiles";
  if (key === "tool:plaza") return "/tool-plaza";
  if (key.startsWith("tool-item:")) {
    return `/tool-plaza/${encodeURIComponent(key.replace("tool-item:", ""))}`;
  }
  if (key === "settings:appearance") return "/settings/appearance";
  if (key === "params:duty-field") return "/params/duty-field";
  if (key === "params:version") return `/params/version#${state.versionSubTab === "hotfix" ? "hotfix" : "baseline"}`;
  if (key === "params:group-template") return "/params/group-template";
  if (key === "params:issue-root-cause") return "/params/issue-root-cause";
  if (key === "params:research-duty-field") return "/params/research-duty-field";
  if (key === "admin:permissions") return "/admin/permissions";
  if (key === "admin:users") return "/admin/users";
  if (key === "stats:charts") return "/stats/charts";
  if (key === "stats:qi-analytics") return "/stats/qi-analytics";
  if (key === "stats:showcase") return "/stats/showcase";
  if (key === "ai:assistant") return "/ai-assistant";
  if (key === "ai:export") return "/ai-export";
  if (key === "params:llm-config") return "/params/llm-config";
  if (key === "params:qi-config") return "/params/qi-config";
  if (key === "oncall:eva") return "/oncall-eva";
  if (key === "report:issue") return "/report/issue";
  if (key === "report:generate") return "/report/generate";
  if (key === "report:archive") return "/report/archive";
  if (key === "report:improvement") return "/report/improvement";
  if (key === "report:improvement-archive") return "/report/improvement-archive";
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
}

export function getActiveTicket() {
  if (
    state.activeKey === "home" ||
    state.activeKey === "list" ||
    state.activeKey === "patch:list" ||
    state.activeKey === "duty:roster" ||
    state.activeKey === "leave:application" ||
    state.activeKey === "assistant:ticket" ||
    state.activeKey === "req:manage" ||
    state.activeKey === "major:problem" ||
    state.activeKey === "site:profile" ||
    state.activeKey === "tool:plaza" ||
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
  const orderId = makeCreateDraftTicketId();
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
  clearTicketFormCache(orderId);
  ensureNodeFormData(orderId, nodeKey, "HCS_INCIDENT", true, { createDraft: true });
  requestRender();
}

export function beginPatchCreateTicketModal() {
  const operator = getCurrentOperator();
  const orderId = makeCreateDraftTicketId();
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
  clearTicketFormCache(orderId);
  ensureNodeFormData(orderId, nodeKey, "HOTPATCH", true, { createDraft: true });
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
  if (pathname === "/rl-oncall" || pathname === "/rl-oncall/") {
    state.activeKey = ensureRlOncallPublicTab();
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
  if (pathname === "/qi" || pathname === "/qi/") {
    state.activeKey = ensureQiTab();
    state.qiFlowViewId = null;
    // URL query 为唯一真源：恢复筛选状态（无 query → 默认值）；bootstrap（刷新/深链）与 popstate（前进后退）都走这里
    Object.assign(state, sanitizeQiListView(window.location.search));
    state.qiNeedsRefresh = true;
    return;
  }
  if (pathname === "/qi/new" || pathname === "/qi/new/") {
    state.activeKey = ensureQiTab();
    state.qiFlowViewId = "new";
    state.qiFlowStage = "propose";
    state.qiDetailBundle = null;
    state.qiDetailLoaded = false;
    return;
  }
  {
    const m = pathname.match(/^\/qi\/(\d+)\/?$/);
    if (m) {
      const qiId = parseInt(m[1], 10);
      state.activeKey = ensureQiDetailTab(qiId);
      state.qiFlowViewId = qiId;
      state.qiDetailBundle = null;
      state.qiDetailLoaded = false;
      return;
    }
  }
  if (pathname === "/major-problems" || pathname === "/major-problems/") {
    state.activeKey = ensureMajorProblemTab();
    state.majorIssueNeedsRefresh = true;
    return;
  }
  if (pathname === "/site-profiles" || pathname === "/site-profiles/") {
    state.activeKey = ensureSiteProfileTab();
    state.siteProfileNeedsRefresh = true;
    return;
  }
  if (pathname === "/tool-plaza" || pathname === "/tool-plaza/") {
    state.activeKey = ensureToolPlazaTab();
    state.toolPlazaNeedsRefresh = true;
    return;
  }
  const tpItemMatch = pathname.match(/^\/tool-plaza\/([^/]+)\/?$/);
  if (tpItemMatch) {
    const itemNo = decodeURIComponent(tpItemMatch[1]);
    state.activeKey = ensureToolItemTab(itemNo);
    prepareToolPlazaItemEnter(itemNo);
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
  if (pathname === "/params/issue-root-cause" || pathname === "/params/issue-root-cause/") {
    state.activeKey = ensureParamsTab("issue-root-cause");
    state.issueRootCauseNeedsRefresh = true;
    state.issueRootCauseEditMode = false;
    state.issueRootCauseDraft = null;
    return;
  }
  if (pathname === "/params/research-duty-field" || pathname === "/params/research-duty-field/") {
    state.activeKey = ensureParamsTab("research-duty-field");
    state.researchDutyFieldNeedsRefresh = true;
    state.researchDutyFieldEditMode = false;
    state.researchDutyFieldDraft = null;
    return;
  }
  if (pathname === "/params/llm-config" || pathname === "/params/llm-config/") {
    state.activeKey = ensureParamsTab("llm-config");
    state.aiLlmConfigLoading = true;
    return;
  }
  if (pathname === "/params/qi-config" || pathname === "/params/qi-config/") {
    state.activeKey = ensureParamsTab("qi-config");
    state.qiCandidatesNeedsRefresh = true;
    return;
  }
  if (pathname === "/ai-assistant" || pathname === "/ai-assistant/") {
    state.activeKey = ensureAiTab();
    state.aiNeedsRefresh = true;
    return;
  }
  if (pathname === "/ticket-assistant" || pathname === "/ticket-assistant/") {
    const key = "assistant:ticket";
    if (!state.openTabs.some((tab) => tab.key === key)) {
      state.openTabs.push({ key, label: "提单助手", closable: true });
    }
    state.activeKey = key;
    state.taNeedsRefresh = true;
    if (!state.taActiveSessionId) state.ticketAssistantAutoCreatePending = true;
    return;
  }
  if (pathname === "/ai-export" || pathname === "/ai-export/") {
    state.activeKey = ensureAiExportTab();
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
  if (pathname === "/stats/qi-analytics" || pathname === "/stats/qi-analytics/") {
    const key = "stats:qi-analytics";
    if (!state.openTabs.some(t => t.key === key)) state.openTabs.push({ key, label: "质量改进统计", closable: true });
    state.activeKey = key;
    state.qiAnalyticsNeedsRefresh = true;
    return;
  }
  if (pathname === "/stats/showcase" || pathname === "/stats/showcase/") {
    state.activeKey = ensureShowcaseTab(state);
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
  if (pathname === "/report/improvement" || pathname === "/report/improvement/") {
    state.activeKey = ensureImprovementReportTab();
    void loadImprovementReport(state.improvementReportYm || currentYm());
    return;
  }
  if (pathname === "/report/improvement-archive" || pathname === "/report/improvement-archive/") {
    state.activeKey = ensureImprovementReportArchiveTab();
    void loadImprovementReportArchives();
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

export async function checkAndFlushCreateAction() {
  const params = new URLSearchParams(window.location.search);
  if (state.activeKey !== "list") return false;
  if (params.get("action") !== "create-ticket") return false;
  closeCreateTicketModal();
  await ensureAdminData();
  if (getWhitelistLevel("workbench_create", getCurrentWhitelistSettings()) === "hidden") {
    window.alert("您没有创建工单的权限");
    return false;
  }
  beginCreateTicketModal();
  return true;
}
