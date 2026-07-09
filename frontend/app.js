// Import auth.js first to setup fetch interceptor before any API calls
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings, isActiveKeyVisible, getDefaultVisibleActiveKey, ensureLoggedIn } from "./modules/core/auth.js";
import { renderRlOncallPublicPage, bindRlOncallPublicPage } from "./modules/pages/rl-oncall-public-page.js";

import { state, ticketList } from "./modules/state/state.js";
import { escapeHtml, escapeAttr } from "./modules/utils/escape.js";
import {
  listPreviewText,
  formatTicketSlaDhM,
  uniqueTicketListFilterValues,
  filterTicketsByListColumnFilters,
  operatorMatchesPersonField,
  operatorMatchesAnyPersonFields,
  ticketCreatorMatchesOperator,
  tabIndicatorMetrics,
} from "./modules/utils/format.js";
import { destroyDateRangePickerOverlay } from "./modules/ui/workbench-glass-datepicker.js";
import {
  bindColumnFilterSearchInput,
  detachColumnFilterPopsFromBody,
  ensureColumnFilterPopOnBody,
  isColumnFilterPopInteraction,
} from "./modules/ui/column-filter-pop.js";
import {
  armListSearchFocusRestore,
  armActiveListSearchFocusRestore,
  restoreListSearchFocus,
  registerListSearchInput,
  releaseListSearchRenderHold,
  shouldDeferListSearchRender,
  markListSearchRenderDeferred,
  noteListSearchInputEvent,
} from "./modules/ui/list-search-input.js";
import {
  detachTicketLogDrawerFromBody,
  ensureTicketLogDrawerOnBody,
} from "./modules/ui/ticket-log-drawer.js";
import {
  bindDateRangePicker,
  ensureDateRangePickerContext,
  renderDateRangeHtml,
} from "./modules/ui/date-range-picker-bind.js";
import {
  normalizeIssueSeverity,
  severityPillClass,
  whitelistAllows,
} from "./modules/utils/normalize.js";
import {
  DEFAULT_OPERATOR_NAME,
} from "./modules/constants/theme.js";
import { registerRender } from "./modules/core/scheduler.js";
import { bootstrap } from "./modules/pages/bootstrap.js";
import {
  syncDutyCalendarMonthsFromServer,
  dutyRosterExtrasSyncKey,
  syncDutyRosterExtrasFromServer,
  renderDutySubmenuHtml,
  renderHomeDutyInfoSectionHtml,
  patchHomeDutyCalendarDom,
  navigateHomeDutyCalendarMonth,
  renderDutyDayModalHtml,
  renderDutyCalendarImportModalHtml,
  renderDutyRosterPage,
  bindDutyRosterPage,
  dutyRosterAnchorValid,
} from "./modules/pages/duty.js";
import {
  renderHomeLeaveWorkbenchTableSection,
  renderLeaveApplicationPage,
  renderLeaveModalsHtml,
  bindLeaveApplicationPage,
} from "./modules/pages/leave-page.js";

import {
  renderRequirementPage,
  renderRequirementModalsHtml,
  bindRequirementPage,
} from "./modules/pages/requirement-page.js";

import {
  renderMajorIssuePage,
  renderMajorIssueModalsHtml,
  bindMajorIssuePage,
  fetchMajorIssueList,
  syncMajorIssueBackfillUi,
} from "./modules/pages/major-issue-page.js";

import {
  renderSiteProfilePage,
  renderSiteProfileModalsHtml,
  bindSiteProfilePage,
  fetchSiteProfileList,
} from "./modules/pages/site-profile-page.js";

import {
  renderToolPlazaPage,
  renderToolPlazaModalsHtml,
  renderToolPlazaItemDetailPage,
  bindToolPlazaPage,
  fetchToolPlazaList,
  fetchToolPlazaCategories,
  prepareToolPlazaItemEnter,
} from "./modules/pages/tool-plaza-page.js";

import {
  ensureStatsChartsTab,
  detachStatsChartZoomMasksFromBody,
  detachAdminWhitelistModalFromBody,
  renderStatsChartsPage,
  bindStatsChartsPage,
  ensureStatsLaborRangeInit,
  ensureStatsOwnershipRangeInit,
} from "./modules/pages/stats-page.js";

import {
  loadStatsChartsDataIfNeeded,
  statsChartsQueryKeyForTab,
} from "./modules/pages/stats-charts-api.js";

import {
  ensureAdminTab,
  ensureAdminWhitelistModalOnBody,
  captureAdminWhitelistModalScroll,
  restoreAdminWhitelistModalScroll,
  ensureAdminData,
  renderAdminPage,
  bindAdminPage,
} from "./modules/pages/admin-page.js";

import {
  ensureParamsTab,
  bindVersionParamsPage,
  fetchGroupTemplatesFromServer,
  renderGroupPullModalHtml,
  bindGroupTemplateParamsPage,
  bindIssueRootCauseParamsPage,
  bindGroupPullModal,
  renderParamsPage,
} from "./modules/pages/params-page.js";

import { getParamsPageHeadline, defaultGroupTemplateList } from "./modules/pages/params.js";

import {
  ensureAiTab,
  renderAiAssistantPage,
  bindAiAssistantPage,
} from "./modules/pages/ai-page.js";

import {
  renderAiExportPage,
  bindAiExportPage,
  ensureAiExportTab,
} from "./modules/pages/ai-export-page.js";

import {
  ensureSettingsTab,
  ensureLeaveTab,
  ensureRequirementTab,
  ensureMajorProblemTab,
  ensureSiteProfileTab,
  ensureToolPlazaTab,
  ensureListTab,
  ensurePatchListTab,
  ensureOncallEvaTab,
  renderSettingsAppearanceHtml,
  bindSettingsAppearancePage,
} from "./modules/pages/settings-page.js";

import {
  renderOncallEvaPage,
  bindOncallEvaPage,
  refreshOncallEvaPage,
  disposeOncallEvaCharts,
} from "./modules/pages/oncall-eva-page.js";

import {
  ensureReportIssueTab,
  renderReportIssuePage,
  bindReportIssuePage,
} from "./modules/pages/report-page.js";

import {
  ensureMonthlyReportTab,
  ensureMonthlyReportArchiveTab,
  renderMonthlyReportPage,
  bindMonthlyReportPage,
  renderMonthlyReportArchivePage,
  bindMonthlyReportArchivePage,
  loadMonthlyReport,
  loadMonthlyReportArchives,
  currentYm,
} from "./modules/pages/monthly-report-page.js";

import {
  ensureNodeFormData,
  syncOperationLogsFromServer,
  bindNodeForms,
  bindDutyFieldParamsPage,
  renderWorkflow,
  renderOperationLogs,
  renderNodeForm,
  shouldHideSaveButtonInCreateModal,
  bindLlmConfigPage,
  prepareTicketDetailEnter,
  isTicketDetailShowLoading,
} from "./modules/pages/ticket-page.js";

import {
  fetchHomeLeavePendingList,
  homePersonalQueryKey,
  fetchHomePersonalStats,
  patchHomePersonalStatsDom,
  renderHomePersonalSectionHtml,
  fetchLeaveDetail,
  renderMyHomeHeatmapCard,
  bindMyHomeHeatmap,
  getWorkbenchListBaseTickets,
  getPatchListBaseTickets,
  getHomePendingWorkbenchBaseTickets,
  homeWorkbenchTabUsesMergedTicketBase,
  applyHomePersonalPreset,
} from "./modules/pages/home-page.js";

import {
  renderTicketListFilterHeader,
  syncTicketsFromServer,
  syncHomeWorkbenchTicketLists,
  runNavigationTicketSyncAndRender,
  registerNavigationListPatch,
  refreshHomeListData,
  resyncWorkbenchTicketList,
  resyncHomeWorkbenchList,
  applyWorkbenchListFilters,
  fetchWorkbenchFilteredTicketIds,
  fetchTicketListFacets,
  invalidateWorkbenchListFacets,
  fetchHomeListFacets,
  invalidateHomeListFacets,
  getUrlByKey,
  getActiveTicket,
  getCreateModalStartNodeKey,
  beginCreateTicketModal,
  beginPatchCreateTicketModal,
  closeCreateTicketModal,
  ensureTicketTab,
  ensureDutyTab,
  ensureHomeTab,
} from "./modules/pages/ticket-core.js";
import { resolveCreateModalNodeKeyForRender } from "./modules/utils/resolve-create-modal-node-key.js";
import {
  renderExportModalHtml,
  bindExportModal,
  openExportModal,
} from "./modules/pages/export-modal.js";
import {
  renderMigrateLegacyModalHtml,
  bindMigrateLegacyModal,
  openMigrateLegacyModal,
} from "./modules/pages/migrate-legacy-modal.js";
import {
  renderProblemFillReviewerModalHtml,
  bindProblemFillReviewerModal,
} from "./modules/pages/problem-fill-reviewer-modal.js";
import {
  renderColumnSelectModalHtml,
  bindColumnSelectModal,
  openColumnSelectModal,
} from "./modules/pages/column-select-modal.js";
import {
  renderAskDoerModalHtml,
  bindAskDoerModal,
  openAskDoerModal,
} from "./modules/ui/ask-doer-modal.js";
import {
  getCurrentTableColumns,
  renderDynamicTableHeader,
  renderDynamicTableRowCells,
} from "./modules/pages/table-columns.js";
import { dutyCalendarSyncKey as _dutyCalendarSyncKey } from "./modules/utils/date.js";
import { bindSidebarFlyouts } from "./modules/ui/sidebar-flyouts.js";
import { bindSidebarResize } from "./modules/ui/sidebar-resize.js";
import { applyTableCellOverflowTooltips } from "./modules/ui/table-cell-overflow-tooltip.js";

const root = document.getElementById("root");
let sidebarFlyoutAbort = null;

function patchListPaginationControls({
  wrapId,
  prevId,
  nextId,
  pageSizeId,
  totalTickets,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const summary = wrap.querySelector(".list-pagination-summary");
  if (summary) summary.textContent = `共 ${totalTickets} 条，第 ${currentPage}/${totalPages} 页`;
  const prev = document.getElementById(prevId);
  const next = document.getElementById(nextId);
  if (prev) {
    prev.disabled = currentPage <= 1;
    prev.onclick = () => onPageChange(Math.max(1, currentPage - 1));
  }
  if (next) {
    next.disabled = currentPage >= totalPages;
    next.onclick = () => onPageChange(Math.min(totalPages, currentPage + 1));
  }
  const sizeSel = document.getElementById(pageSizeId);
  if (sizeSel) {
    if (Number(sizeSel.value) !== pageSize) sizeSel.value = String(pageSize);
    sizeSel.onchange = () => onPageSizeChange(Number(sizeSel.value) || 10);
  }
}

function bindTicketRowSelectCells(rootEl, attrName) {
  rootEl.querySelectorAll(`[${attrName}]`).forEach((el) => {
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el.addEventListener("change", () => {
      const orderId = el.getAttribute(attrName) || "";
      if (!orderId) return;
      const next = new Set(state.selectedTicketIds);
      if (el.checked) next.add(orderId);
      else next.delete(orderId);
      state.selectedTicketIds = Array.from(next);
    });
  });
}

function appendTicketTableRows(body, pageTickets, { namespace, selectedSet, whitelist, animate = true }) {
  const nRows = pageTickets.length;
  const staggerStepSec = animate && nRows > 0 ? Math.min(0.04, 0.48 / nRows) : 0;
  pageTickets.forEach((ticket, rowIndex) => {
    const tr = document.createElement("tr");
    tr.className = "ticket-row";
    tr.dataset.orderId = ticket.orderId;
    if (animate) tr.style.setProperty("--row-stagger", `${(rowIndex + 1) * staggerStepSec}s`);
    tr.innerHTML = renderDynamicTableRowCells(ticket, namespace, selectedSet);
    tr.addEventListener("click", () => {
      if (!whitelistAllows("ticket_detail", "readonly", whitelist)) return;
      const prevKey = state.activeKey;
      prepareTicketDetailEnter(ticket.orderId);
      state.activeKey = ensureTicketTab(ticket.orderId);
      history.pushState({}, "", getUrlByKey(state.activeKey));
      runNavigationTicketSyncAndRender(prevKey, state.activeKey, render);
    });
    body.appendChild(tr);
  });
  applyTableCellOverflowTooltips(body);
}

/** 导航后列表同步完成：仅更新工单表格与分页，成功则跳过第二次整页 render。 */
function patchNavListPanelsAfterSync() {
  const whitelist = getCurrentWhitelistSettings();
  const currentOperator = getCurrentOperator();
  const activeKey = state.activeKey;

  if (activeKey === "list" || activeKey === "patch:list") {
    const isList = activeKey === "list";
    const listTableColumnNamespace = activeKey === "patch:list" ? "patch" : "list";
    const workbenchUsesServerPagedList = isList && (state.ticketListServerPaged || state.ticketListLoading);
    let ticketListBaseForFilters = [];
    if (isList) {
      ticketListBaseForFilters = workbenchUsesServerPagedList
        ? ticketList.filter((t) => {
            const tc = String(t.templateCode || "HCS_INCIDENT").trim();
            return tc === "HCS_INCIDENT" || tc === "";
          })
        : getWorkbenchListBaseTickets(currentOperator);
    } else {
      ticketListBaseForFilters = getPatchListBaseTickets(currentOperator);
    }

    let listVisibleTickets = applyWorkbenchListFilters(ticketListBaseForFilters, currentOperator);

    const serverPagedList = workbenchUsesServerPagedList;
    const pageSize = Number(state.listPageSize) > 0 ? Number(state.listPageSize) : 10;
    const totalTickets = serverPagedList
      ? Math.max(0, Number(state.ticketListTotal) || 0)
      : listVisibleTickets.length;
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.listPage) || 1), totalPages);
    state.listPage = currentPage;
    const start = (currentPage - 1) * pageSize;
    const pageTickets = serverPagedList
      ? listVisibleTickets
      : listVisibleTickets.slice(start, start + pageSize);

    const body = document.getElementById("table-body");
    if (!body) return false;
    body.replaceChildren();
    const selectedSet = new Set(state.selectedTicketIds);
    appendTicketTableRows(body, pageTickets, {
      namespace: listTableColumnNamespace,
      selectedSet,
      whitelist,
      animate: true,
    });
    bindTicketRowSelectCells(body, "data-ticket-select");

    const selectAll = document.getElementById("select-all-tickets");
    if (selectAll) {
      const filteredTotal = serverPagedList
        ? Math.max(0, Number(state.ticketListTotal) || 0)
        : listVisibleTickets.length;
      const pageAllSelected =
        listVisibleTickets.length > 0 && listVisibleTickets.every((t) => selectedSet.has(t.orderId));
      selectAll.checked = serverPagedList
        ? filteredTotal > 0 && pageAllSelected && selectedSet.size >= filteredTotal
        : pageAllSelected;
    }

    const syncWorkbenchPage = () => {
      if (!isList || !workbenchUsesServerPagedList) {
        render();
        return;
      }
      if (state.listRefreshing) return;
      state.listRefreshing = true;
      render();
      void resyncWorkbenchTicketList().finally(() => {
        state.listRefreshing = false;
        render();
      });
    };
    patchListPaginationControls({
      wrapId: "list-pagination",
      prevId: "list-page-prev",
      nextId: "list-page-next",
      pageSizeId: "list-page-size",
      totalTickets,
      currentPage,
      totalPages,
      pageSize,
      onPageChange: (page) => {
        state.listPage = page;
        syncWorkbenchPage();
      },
      onPageSizeChange: (size) => {
        state.listPageSize = size;
        state.listPage = 1;
        syncWorkbenchPage();
      },
    });
    return true;
  }

  if (activeKey === "home" && state.homeWorkbenchTab !== "leave_pending") {
    const homeBody = document.getElementById("home-table-body");
    if (!homeBody) return false;
    homeBody.replaceChildren();
    if (state.homeWorkbenchListLoading) {
      const tr = document.createElement("tr");
      tr.className = "ticket-row ticket-row--loading";
      tr.innerHTML = `<td colspan="32" class="list-loading-cell">加载中…</td>`;
      homeBody.appendChild(tr);
      return true;
    }

    const pageTickets = Array.isArray(state.homeListTickets) ? state.homeListTickets : [];
    const pageSize = Number(state.homeListPageSize) > 0 ? Number(state.homeListPageSize) : 10;
    const totalTickets = Math.max(0, Number(state.homeListTotal) || 0);
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.homeListPage) || 1), totalPages);
    state.homeListPage = currentPage;

    const selectedSet = new Set(state.selectedTicketIds);
    appendTicketTableRows(homeBody, pageTickets, {
      namespace: "home",
      selectedSet,
      whitelist,
      animate: true,
    });
    bindTicketRowSelectCells(homeBody, "data-home-ticket-select");

    const homeSelectAll = document.getElementById("home-select-all-tickets");
    if (homeSelectAll) {
      const pageAllSelected =
        pageTickets.length > 0 && pageTickets.every((t) => selectedSet.has(t.orderId));
      homeSelectAll.checked = pageAllSelected;
    }

    const syncHomePage = () => {
      if (state.homeListRefreshing) return;
      state.homeListRefreshing = true;
      render();
      void resyncHomeWorkbenchList().finally(() => {
        state.homeListRefreshing = false;
        render();
      });
    };

    patchListPaginationControls({
      wrapId: "home-list-pagination",
      prevId: "home-page-prev",
      nextId: "home-page-next",
      pageSizeId: "home-page-size",
      totalTickets,
      currentPage,
      totalPages,
      pageSize,
      onPageChange: (page) => {
        state.homeListPage = page;
        syncHomePage();
      },
      onPageSizeChange: (size) => {
        state.homeListPageSize = size;
        state.homeListPage = 1;
        syncHomePage();
      },
    });
    return true;
  }

  return false;
}

function render() {
  if (shouldDeferListSearchRender()) {
    markListSearchRenderDeferred();
    return;
  }
  armActiveListSearchFocusRestore();
  destroyDateRangePickerOverlay();
  captureAdminWhitelistModalScroll();
  const whitelist = getCurrentWhitelistSettings();
  // 避免首屏 admin 用户/权限尚未拉取时，空白名单误把深链路由（如 /ai-assistant）打回首页
  if (
    state.adminLoaded &&
    !state.adminLoading &&
    !isActiveKeyVisible(state.activeKey, whitelist)
  ) {
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
  const isTicketDetail =
    typeof state.activeKey === "string" && state.activeKey.startsWith("ticket:");
  const ticketDetailLoading = isTicketDetailShowLoading(
    isTicketDetail,
    state.ticketListLoading,
    activeTicket,
    state.ticketDetailHydratingOrderId,
  );
  const isHome = state.activeKey === "home";
  if (!isHome) {
    document.body.querySelector("#order-heatmap-tooltip")?.remove();
  }
  const isList = state.activeKey === "list";
  const isPatchList = state.activeKey === "patch:list";
  const listTableColumnNamespace = isPatchList ? "patch" : "list";
  const showWorkbenchLikeList = isList || isPatchList;
  if (
    state.createModalOpen &&
    state.activeKey !== "list" &&
    state.activeKey !== "patch:list"
  ) {
    closeCreateTicketModal();
  }
  const isDuty = state.activeKey === "duty:roster";
  const isRlOncall = state.activeKey === "rl:oncall";
  const isLeave = state.activeKey === "leave:application";
  const isReq = state.activeKey === "req:manage";
  const isMajorProblem = state.activeKey === "major:problem";
  const isSiteProfile = state.activeKey === "site:profile";
  const isToolPlaza = state.activeKey === "tool:plaza";
  const isToolPlazaItem =
    typeof state.activeKey === "string" && state.activeKey.startsWith("tool-item:");
  const toolPlazaItemNo = isToolPlazaItem ? state.activeKey.replace("tool-item:", "") : "";
  const isParams = state.activeKey.startsWith("params:");
  const isAdmin = state.activeKey.startsWith("admin:");
  const isStats = state.activeKey === "stats:charts";
  const isSettings = state.activeKey === "settings:appearance";
  const isAiAssistant = state.activeKey === "ai:assistant";
  const isAiExport = state.activeKey === "ai:export";
  const isAiMenu = isAiAssistant || isAiExport;
  const isOncallEva = state.activeKey === "oncall:eva";
  if (!isOncallEva) disposeOncallEvaCharts();
  const isReportIssue = state.activeKey === "report:issue";
  const isReportGenerate = state.activeKey === "report:generate";
  const isReportArchive = state.activeKey === "report:archive";
  const isReport = isReportIssue || isReportGenerate || isReportArchive;
  const activeDateRangeIds = [];
  if (showWorkbenchLikeList) activeDateRangeIds.push("workbench-created");
  if (isHome) activeDateRangeIds.push("home-personal");
  if (isStats && (state.statsChartsTab === "labor" || state.statsChartsTab === "doer")) {
    activeDateRangeIds.push("stats-labor");
  }
  if (isStats && state.statsChartsTab === "ownership") activeDateRangeIds.push("stats-ownership");
  if (isMajorProblem && state.majorProblemPeriod === "custom") activeDateRangeIds.push("major-problem-custom");
  if (isReq && state.reqAnalyticsPreset === "custom") activeDateRangeIds.push("req-analytics-custom");
  ensureDateRangePickerContext(activeDateRangeIds);
  const currentOperator = getCurrentOperator();
  const canViewHome = whitelistAllows("home", "readonly", whitelist);
  const canViewList = whitelistAllows("ticket_list", "readonly", whitelist);
  const canViewDuty = whitelistAllows("duty_roster", "readonly", whitelist);
  const canViewLeave = whitelistAllows("leave_application", "readonly", whitelist);
  const canViewReq = whitelistAllows("requirement_list", "readonly", whitelist);
  const canViewMajorProblem = whitelistAllows("major_problem_list", "readonly", whitelist);
  const canViewSiteProfile = whitelistAllows("site_profile_list", "readonly", whitelist);
  const canViewToolPlaza = whitelistAllows("tool_plaza_list", "readonly", whitelist);
  const canViewAdminPermissions = whitelistAllows("admin_permissions", "readonly", whitelist);
  const canViewAdminUsers = whitelistAllows("admin_users", "readonly", whitelist);
  const canViewParams = whitelistAllows("params_config", "readonly", whitelist);
  const canViewParamsDutyField = whitelistAllows("params_duty_field_edit", "readonly", whitelist);
  const canViewParamsVersion = whitelistAllows("params_version_edit", "readonly", whitelist);
  const canViewParamsGroupTemplate = whitelistAllows("params_group_template_edit", "readonly", whitelist);
  const canViewIssueRootCause = whitelistAllows("params_issue_root_cause", "readonly", whitelist);
  const canViewLlmConfig = whitelistAllows("params_llm_config", "readonly", whitelist);
  const canViewParamsMenu =
    canViewParams &&
    (canViewParamsDutyField ||
      canViewParamsVersion ||
      canViewParamsGroupTemplate ||
      canViewIssueRootCause ||
      canViewLlmConfig);
  const canViewAi = whitelistAllows("ai_assistant", "readonly", whitelist);
  const canViewAiExport = whitelistAllows("ai_export", "readonly", whitelist);
  const canViewAiMenu = canViewAi || canViewAiExport || canViewToolPlaza;
  const canViewStats = whitelistAllows("stats_dashboard", "readonly", whitelist);
  const canViewPatch = whitelistAllows("patch_manage", "readonly", whitelist);
  const canViewHomeDutyInfo = whitelistAllows("home_duty_roster", "readonly", whitelist);
  const canViewOncallEva = whitelistAllows("oncall_eva", "readonly", whitelist);
  const canViewReportMenu = whitelistAllows("monthly_report", "readonly", whitelist);
  const canViewWorkbenchGroup = whitelistAllows("workbench_group", "readonly", whitelist);
  const canViewWorkbenchCreate = whitelistAllows("workbench_create", "readonly", whitelist);
  const canViewWorkbenchExport = whitelistAllows("workbench_export", "readonly", whitelist);
  const canViewWorkbenchDelete = whitelistAllows("workbench_delete", "readonly", whitelist);
  const canViewWorkbenchMigrate = whitelistAllows("workbench_migrate", "readonly", whitelist);
  const canViewWorkbenchSnapshotRebuild = whitelistAllows("workbench_snapshot_rebuild", "readonly", whitelist);
  const canViewPatchManageDelete = whitelistAllows("patch_manage_delete", "readonly", whitelist);
  const canViewTicketLog = whitelistAllows("ticket_detail_log", "readonly", whitelist);
  if (!canViewTicketLog && state.logDrawerOpen) state.logDrawerOpen = false;
  const currentRoleCode = getCurrentRoleCode();
  const workbenchUsesServerPagedList =
    isList && (state.ticketListServerPaged || state.ticketListLoading);
  let ticketListBaseForFilters = [];
  if (isList) {
    const useEmptyWorkbenchBase = workbenchUsesServerPagedList && state.ticketListLoading;
    ticketListBaseForFilters = useEmptyWorkbenchBase
      ? []
      : workbenchUsesServerPagedList
        ? ticketList.filter((t) => {
            const tc = String(t.templateCode || "HCS_INCIDENT").trim();
            return tc === "HCS_INCIDENT" || tc === "";
          })
        : getWorkbenchListBaseTickets(currentOperator);
  } else if (isPatchList) {
    ticketListBaseForFilters = getPatchListBaseTickets(currentOperator);
  }
  let homeTicketListBaseForFilters = [];
  if (isHome) {
    homeTicketListBaseForFilters = state.homeListServerPaged
      ? state.homeListTickets || []
      : homeWorkbenchTabUsesMergedTicketBase(state.homeWorkbenchTab)
        ? getHomePendingWorkbenchBaseTickets(currentOperator)
        : getWorkbenchListBaseTickets(currentOperator);
  }
  // 提前计算 visibleTickets 用于导出弹窗渲染
  let listVisibleTickets = [];
  let listExportTotalCount = 0;
  if (showWorkbenchLikeList) {
    const operator = getCurrentOperator();
    listVisibleTickets = applyWorkbenchListFilters(ticketListBaseForFilters, operator);
    listExportTotalCount = workbenchUsesServerPagedList
      ? Math.max(0, Number(state.ticketListTotal) || 0)
      : listVisibleTickets.length;
  }
  const renderWorkbenchListFilterHeader = (label, colKey, allTickets, filterNs) =>
    renderTicketListFilterHeader(
      label,
      colKey,
      allTickets,
      filterNs,
      isList && workbenchUsesServerPagedList
        ? (Array.isArray(state.ticketListFacetValues[colKey])
            ? state.ticketListFacetValues[colKey]
            : [])
        : null
    );
  const renderHomeListFilterHeader = (label, colKey, allTickets, _filterNs) =>
    renderTicketListFilterHeader(
      label,
      colKey,
      allTickets,
      "home",
      state.homeListServerPaged
        ? (Array.isArray(state.homeListFacetValues[colKey])
            ? state.homeListFacetValues[colKey]
            : [])
        : null
    );
  const createModalWf = state.createModalWorkflow === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const createModalNodeKey = resolveCreateModalNodeKeyForRender(
    state.createModalOpen,
    state.createModalNodeKey,
    state.createModalWorkflow,
    getCreateModalStartNodeKey(),
  );
  const createModalHead =
    createModalWf === "HOTPATCH" ? "创建热补丁单" : "创建工单";
  const createModalDefaultNodeKey = createModalWf === "HOTPATCH" ? "hp_demand_fill" : "ops_analysis";
  const createModalHtml = state.createModalOpen && state.createTicketId
    ? `<div class="perm-modal-mask">
        <div class="perm-modal create-ticket-modal" role="dialog" aria-modal="true" aria-labelledby="create-ticket-modal-title">
          <div class="perm-modal-head create-ticket-modal-head">
            <h3 id="create-ticket-modal-title">${escapeHtml(createModalHead)}</h3>
            <button type="button" class="create-ticket-modal-close" id="close-create-ticket-btn" aria-label="关闭">×</button>
          </div>
          <div class="perm-modal-body create-ticket-modal-body">
            ${renderNodeForm(state.createTicketId, createModalNodeKey || createModalDefaultNodeKey, {
              editable: true,
              workflowTemplate: createModalWf,
              hideSaveButton: shouldHideSaveButtonInCreateModal(createModalNodeKey || createModalDefaultNodeKey),
            })}
          </div>
        </div>
      </div>`
    : "";
  document.title = isHome
    ? "我的主页 · GaussDB-Ops"
    : isList || isPatchList
      ? isPatchList
        ? "补丁管理 · GaussDB-Ops"
        : "GaussDB-Ops"
      : isRlOncall
        ? "RL值班表 · GaussDB-Ops"
        : isDuty
          ? "值班表"
          : isLeave
          ? "请假申请"
            : isToolPlaza
            ? "工具广场 · GaussDB-Ops"
            : isSettings
            ? "设置 · GaussDB-Ops"
            : isStats
                ? "统计图表 · GaussDB-Ops"
                : isReportIssue
                  ? "问题报表 · 月度报告"
                  : isReportGenerate
                    ? "报告生成 · 月度报告"
                  : isReportArchive
                    ? "报告归档 · 月度报告"
                : isParams
                ? `${getParamsPageHeadline(state.activeKey)} · 参数配置`
                : isAdmin
                  ? `${state.activeKey === "admin:permissions" ? "权限策略" : "用户管理"} · GaussDB-Ops`
                  : state.activeKey.startsWith("tool-item:")
                    ? state.activeKey.replace("tool-item:", "")
                  : state.activeKey.replace("ticket:", "");

  detachStatsChartZoomMasksFromBody();
  detachAdminWhitelistModalFromBody();
  detachColumnFilterPopsFromBody();
  detachTicketLogDrawerFromBody();
  root.innerHTML = `
  <div class="layout${isRlOncall ? " layout--public" : ""}">
    ${isRlOncall ? "" : `<aside class="left">
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
            <div class="menu-submenu menu-submenu--duty" role="menu" aria-label="值班表子项">
              ${renderDutySubmenuHtml()}
            </div>
          </div>` : ""}
          ${canViewLeave ? `<button class="menu-item menu-item--tag ${isLeave ? "active" : ""}" data-nav-key="leave:application">请假申请</button>` : ""}
        </section>
        <section class="menu-group" aria-label="运维管理">
          <h3 class="menu-group-title">运维管理</h3>
          ${canViewPatch ? `<button type="button" class="menu-item menu-item--tag ${isPatchList ? "active" : ""}" data-nav-key="patch:list">补丁管理</button>` : ""}
          ${canViewMajorProblem ? `<button class="menu-item menu-item--tag ${isMajorProblem ? "active" : ""}" data-nav-key="major:problem">重大问题</button>` : ""}
          ${canViewSiteProfile ? `<button class="menu-item menu-item--tag ${isSiteProfile ? "active" : ""}" data-nav-key="site:profile">局点档案</button>` : ""}
          ${canViewReq ? `<button class="menu-item menu-item--tag ${isReq ? "active" : ""}" data-nav-key="req:manage">质量改进</button>` : ""}
        </section>
        <section class="menu-group" aria-label="数据报表">
          <h3 class="menu-group-title">数据报表</h3>
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStats ? "active" : ""}" data-nav-key="stats:charts">统计图表</button>` : ""}
          ${canViewOncallEva ? `<button type="button" class="menu-item menu-item--tag ${isOncallEva ? "active" : ""}" data-nav-key="oncall:eva">运维效率</button>` : ""}
          ${canViewReportMenu ? `<div class="menu-item-wrap menu-item-wrap--report">
            <button type="button" class="menu-item menu-item--tag ${isReport ? "active" : ""}" data-nav-key="report:issue">月度报告</button>
            <div class="menu-submenu menu-submenu--report" role="menu" aria-label="月度报告子项">
              <button type="button" class="menu-submenu-item" data-nav-key="report:issue">问题报表</button>
              <button type="button" class="menu-submenu-item" data-nav-key="report:generate">报告生成</button>
              <button type="button" class="menu-submenu-item" data-nav-key="report:archive">报告归档</button>
            </div>
          </div>` : ""}
        </section>
        ${canViewAiMenu ? `<section class="menu-group" aria-label="效率提升">
          <h3 class="menu-group-title">效率提升</h3>
          ${canViewAi ? `<button class="menu-item menu-item--tag ${isAiAssistant ? "active" : ""}" data-nav-key="ai:assistant">智能助手</button>` : ""}
          ${canViewAiExport ? `<button class="menu-item menu-item--tag ${isAiExport ? "active" : ""}" data-nav-key="ai:export">深度分析</button>` : ""}
          ${canViewToolPlaza ? `<button class="menu-item menu-item--tag ${isToolPlaza ? "active" : ""}" data-nav-key="tool:plaza">工具广场</button>` : ""}
        </section>` : ""}
        <section class="menu-group" aria-label="系统设置">
          <h3 class="menu-group-title">系统设置</h3>
          ${canViewAdminUsers ? `<button class="menu-item menu-item--tag ${state.activeKey === "admin:users" ? "active" : ""}" data-nav-key="admin:users">用户管理</button>` : ""}
          ${canViewAdminPermissions ? `<button class="menu-item menu-item--tag ${state.activeKey === "admin:permissions" ? "active" : ""}" data-nav-key="admin:permissions">权限策略</button>` : ""}
          ${canViewParamsMenu ? `<div class="menu-item-wrap menu-item-wrap--params">
            <button type="button" class="menu-item menu-item--tag ${isParams ? "active" : ""}" data-nav-key="params:duty-field">参数配置</button>
            <div class="menu-submenu menu-submenu--params" role="menu" aria-label="参数配置子项">
              ${canViewParamsDutyField ? `<button type="button" class="menu-submenu-item" data-nav-key="params:duty-field">责任田模块</button>` : ""}
              ${canViewParamsVersion ? `<button type="button" class="menu-submenu-item" data-nav-key="params:version">版本模块</button>` : ""}
              ${canViewParamsGroupTemplate ? `<button type="button" class="menu-submenu-item" data-nav-key="params:group-template">拉群模版</button>` : ""}
              ${canViewIssueRootCause ? `<button type="button" class="menu-submenu-item" data-nav-key="params:issue-root-cause">问题根因</button>` : ""}
              ${canViewLlmConfig ? `<button type="button" class="menu-submenu-item" data-nav-key="params:llm-config">大模型配置</button>` : ""}
            </div>
          </div>` : ""}
        </section>
      </nav>
      <div class="menu-bottom">
        <button type="button" class="menu-item ${isSettings ? "active" : ""}" data-nav-key="settings:appearance">设置</button>
      </div>
      <div
        class="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        tabindex="0"
      ></div>
    </aside>`}

    <main class="center center-enter">
      <div class="head${isRlOncall ? " hidden" : ""}">
<h1 id="center-page-title" class="${isHome || isList || isPatchList || isDuty || isLeave || isReq || isMajorProblem || isSiteProfile || isToolPlaza || isToolPlazaItem || isParams || isStats || isSettings || isAiMenu || isOncallEva || isAdmin || isReport ? "" : "hidden"}">${isHome ? (() => { const op = getCurrentOperator(); return op.userName ? `${op.userName}的主页` : "我的主页"; })() : isList ? "工作台" : isPatchList ? "补丁管理" : isDuty ? "值班表" : isLeave ? "请假申请" : isReq ? "质量改进" : isMajorProblem ? "重大问题" : isSiteProfile ? "局点档案" : isToolPlaza ? "工具广场" : isToolPlazaItem ? toolPlazaItemNo : isSettings ? "设置" : isAiAssistant ? "智能助手" : isAiExport ? "深度分析" : isOncallEva ? "运维效率" : isParams ? getParamsPageHeadline(state.activeKey) : isAdmin ? (state.activeKey === "admin:permissions" ? "权限策略" : "用户管理") : isStats ? "统计图表" : isReportIssue ? "问题报表" : isReportGenerate ? "报告生成" : isReportArchive ? "报告归档" : ""}</h1>
        <div class="actions ${showWorkbenchLikeList ? "" : "hidden"}">
          ${canViewWorkbenchGroup ? '<button type="button" class="action" id="group-pull-open-btn">拉群</button>' : ""}
          ${canViewWorkbenchCreate ? '<button class="action primary" id="create-ticket-btn">创建</button>' : ""}
          ${canViewWorkbenchExport ? '<button type="button" class="action" id="export-ticket-btn">导出</button>' : ""}
          ${showWorkbenchLikeList && (isPatchList ? canViewPatchManageDelete : canViewWorkbenchDelete)
            ? '<button class="action danger" id="delete-ticket-btn">删除</button>'
            : ""}
          ${showWorkbenchLikeList && !isPatchList && canViewWorkbenchMigrate
            ? '<button type="button" class="action" id="migrate-ticket-btn">迁入</button>'
            : ""}
          ${isList && canViewWorkbenchSnapshotRebuild
            ? (() => {
                const running = state.snapshotRebuilding;
                const total = Number(state.snapshotRebuildTotal) || 0;
                const done = Number(state.snapshotRebuildDone) || 0;
                const label = running
                  ? total > 0
                    ? `重建快照 ${done}/${total}…`
                    : state.snapshotRebuildProgress || "重建快照中…"
                  : "重建列表快照";
                return `<button type="button" class="action" id="snapshot-rebuild-btn" ${running ? "disabled" : ""}>${label}</button>`;
              })()
            : ""}
        </div>
      </div>

      <div class="workspace-tabs${isRlOncall ? " hidden" : ""}" id="workspace-tabs">
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
          <button type="button" class="tab ${state.homeWorkbenchTab === "handled" ? "active" : ""}" role="tab" aria-selected="${state.homeWorkbenchTab === "handled"}" data-home-workbench-tab="handled">曾处理</button>
        </div>
        ${canViewWorkbenchExport ? '<button type="button" class="action" id="home-column-select-btn">选择列</button>' : ""}
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
              ${renderDynamicTableHeader(homeTicketListBaseForFilters, "home", renderHomeListFilterHeader)}
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
          : showWorkbenchLikeList
            ? `
      <div class="toolbar">
        <div class="filters">
          <input type="search" id="ticket-list-search-input" class="search" placeholder="搜索工单号、标题、处理人、描述、局点等" value="${escapeAttr(state.ticketListSearch)}" />
          <div class="date-range-wrap date-range-wrap--workbench-created">
            ${renderDateRangeHtml({
              id: "workbench-created",
              startYmd: state.ticketListCreatedStart,
              endYmd: state.ticketListCreatedEnd,
              startLabel: "开始",
              endLabel: "结束",
              className: "date-range--workbench-created",
              title: "按工单创建时间（本地日期）筛选",
            })}
          </div>
          <div class="tabs-with-refresh">
            <div class="tabs" role="tablist">
              <span class="tab-indicator" aria-hidden="true"></span>
              <button type="button" class="tab ${state.listTab === "pending" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "pending"}" data-tab="pending">待处理</button>
              <button type="button" class="tab ${state.listTab === "all" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "all"}" data-tab="all">全局</button>
              <button type="button" class="tab ${state.listTab === "created" ? "active" : ""}" role="tab" aria-selected="${state.listTab === "created"}" data-tab="created">我创建</button>
            </div>
            <button type="button" class="action list-refresh-btn" id="list-refresh-btn" aria-label="刷新列表数据" ${state.listRefreshing ? "disabled" : ""}>${state.listRefreshing ? "刷新中…" : "刷新"}</button>
            <button type="button" class="action" id="list-column-select-btn">选择列</button>
          </div>
        </div>
      </div>

      <section class="table-wrap" id="list-panel" aria-live="polite">
        <div class="section-title">Work order list</div>
        <table>
          <thead>
            <tr>
              ${renderDynamicTableHeader(ticketListBaseForFilters, listTableColumnNamespace, renderWorkbenchListFilterHeader)}
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
        <div id="list-pagination" class="list-pagination"></div>
      </section>
      `
            : isRlOncall
            ? `
      <section class="rl-oncall-public-wrap" id="rl-oncall-public-panel" aria-label="RL值班表">
        ${renderRlOncallPublicPage()}
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
      <section class="req-page" id="req-management-page" aria-label="质量改进">
        ${renderRequirementPage()}
      </section>
      `
            : isMajorProblem
              ? `
      <section class="mp-page" id="major-problem-page" aria-label="重大问题">
        ${renderMajorIssuePage()}
      </section>
      `
            : isSiteProfile
              ? `
      <section class="sp-page" id="site-profile-page" aria-label="局点档案">
        ${renderSiteProfilePage()}
      </section>
      `
            : isToolPlaza && canViewToolPlaza
              ? `
      <section class="tp-page" id="tool-plaza-page" aria-label="工具广场">
        ${renderToolPlazaPage()}
      </section>
      `
              : isToolPlazaItem && canViewToolPlaza
                ? renderToolPlazaItemDetailPage(toolPlazaItemNo)
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
                  : isStats
                    ? `
      ${renderStatsChartsPage()}
      `
                      : isOncallEva
                      ? `
      ${renderOncallEvaPage()}
      `
                      : isReportIssue
                      ? `
      ${renderReportIssuePage()}
      `
                      : isReportGenerate
                      ? `
      ${renderMonthlyReportPage()}
      `
                      : isReportArchive
                      ? `
      ${renderMonthlyReportArchivePage()}
      `
                      : isParams
                  ? `
      ${renderParamsPage()}
      `
                  : isAiAssistant
                ? `
      ${renderAiAssistantPage()}
      `
                : isAiExport
                ? `
      ${renderAiExportPage()}
      `
                : isAdmin
                ? `
      ${renderAdminPage()}
      `
                : `
      <section class="detail-card detail-card-inline">
        ${
          ticketDetailLoading
            ? `
        <h2>加载中…</h2>
        <p>正在加载问题单 ${escapeHtml(state.activeKey.replace("ticket:", ""))}。</p>`
            : activeTicket
            ? `
        <div class="detail-head">
          <h2>Order ${activeTicket.orderId}</h2>
          <div class="detail-actions">
            <button class="action ai" id="ask-doer-btn" type="button">Ask Doer</button>
            <button class="action ai" id="ask-aid-btn" type="button">Ask Aid</button>
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
  <div id="sidebar-flyout-portal"></div>
  ${renderDutyDayModalHtml()}
  ${renderDutyCalendarImportModalHtml()}
  ${createModalHtml}
  ${renderProblemFillReviewerModalHtml()}
  ${showWorkbenchLikeList ? renderGroupPullModalHtml() : ""}
  ${showWorkbenchLikeList ? renderExportModalHtml(state.selectedTicketIds.length, listExportTotalCount) : ""}
  ${showWorkbenchLikeList ? renderMigrateLegacyModalHtml() : ""}
  ${isHome ? renderColumnSelectModalHtml("home") : ""}
  ${showWorkbenchLikeList ? renderColumnSelectModalHtml("list") : ""}
  ${showWorkbenchLikeList ? renderColumnSelectModalHtml("patch") : ""}
  ${isLeave ? renderLeaveModalsHtml() : ""}
  ${isReq ? renderRequirementModalsHtml() : ""}
  ${isMajorProblem ? renderMajorIssueModalsHtml() : ""}
  ${isSiteProfile ? renderSiteProfileModalsHtml() : ""}
  ${isToolPlaza || isToolPlazaItem ? renderToolPlazaModalsHtml() : ""}
  ${renderAskDoerModalHtml(activeTicket?.orderId)}
`;
  ensureAdminWhitelistModalOnBody();
  restoreAdminWhitelistModalScroll();
  if (isMajorProblem && state.majorIssueBackfillRunning) {
    syncMajorIssueBackfillUi();
  }

  sidebarFlyoutAbort?.abort();
  sidebarFlyoutAbort = new AbortController();
  if (!isRlOncall) {
    bindSidebarFlyouts(root, { signal: sidebarFlyoutAbort.signal });
    bindSidebarResize(root, { signal: sidebarFlyoutAbort.signal });
  }

  const layout = document.querySelector(".layout");
  const collapseBtn = document.getElementById("collapse-btn");
  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      layout.classList.toggle("left-collapsed");
      collapseBtn.textContent = layout.classList.contains("left-collapsed") ? "»" : "«";
    });
  }

  document.getElementById("workspace-tabs").addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close-tab]");
    if (closeTarget) {
      event.stopPropagation();
      const key = closeTarget.getAttribute("data-close-tab");
      const prevTabKey = state.activeKey;
      state.openTabs = state.openTabs.filter((tab) => tab.key !== key);
      if (state.activeKey === key) {
        state.activeKey = state.openTabs[state.openTabs.length - 1].key;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      if (state.activeKey !== prevTabKey) {
        runNavigationTicketSyncAndRender(prevTabKey, state.activeKey, render);
      } else {
        render();
      }
      return;
    }
    const tabTarget = event.target.closest("[data-workspace-tab]");
    if (!tabTarget) return;
    const prevTabKey = state.activeKey;
    state.activeKey = tabTarget.getAttribute("data-workspace-tab");
    if (typeof state.activeKey === "string" && state.activeKey.startsWith("ticket:")) {
      prepareTicketDetailEnter(state.activeKey.slice("ticket:".length));
    }
    if (typeof state.activeKey === "string" && state.activeKey.startsWith("tool-item:")) {
      prepareToolPlazaItemEnter(state.activeKey.slice("tool-item:".length));
    }
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
    if (state.activeKey === "params:issue-root-cause" && prevTabKey !== "params:issue-root-cause") {
      state.issueRootCauseNeedsRefresh = true;
      state.issueRootCauseEditMode = false;
      state.issueRootCauseDraft = null;
    }
    if (state.activeKey === "oncall:eva" && prevTabKey !== "oncall:eva") {
      state.oncallEvaNeedsRefresh = true;
    }
    if (state.activeKey === "leave:application" && prevTabKey !== "leave:application") {
      state.leaveNeedsRefresh = true;
    }
    history.pushState({}, "", getUrlByKey(state.activeKey));
    runNavigationTicketSyncAndRender(prevTabKey, state.activeKey, render);
  });

  document.querySelectorAll("[data-nav-key]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
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
      if (key === "patch:list") {
        ensurePatchListTab();
      }
      if (key === "duty:roster") {
        ensureDutyTab();
      }
      if (key === "req:manage") {
        ensureRequirementTab();
      }
      if (key === "major:problem") {
        ensureMajorProblemTab();
        if (prevNavKey !== "major:problem") state.majorIssueNeedsRefresh = true;
      }
      if (key === "site:profile") {
        ensureSiteProfileTab();
        if (prevNavKey !== "site:profile") state.siteProfileNeedsRefresh = true;
      }
      if (key === "tool:plaza") {
        ensureToolPlazaTab();
        if (prevNavKey !== "tool:plaza") state.toolPlazaNeedsRefresh = true;
      }
      if (key === "stats:charts") {
        ensureStatsChartsTab();
      }
      if (key === "report:issue") {
        ensureReportIssueTab();
      }
      if (key === "report:generate") {
        ensureMonthlyReportTab();
        if (prevNavKey !== "report:generate") {
          const ym = state.monthlyReportYm || currentYm();
          void loadMonthlyReport(ym);
        }
      }
      if (key === "report:archive") {
        ensureMonthlyReportArchiveTab();
        if (prevNavKey !== "report:archive") {
          void loadMonthlyReportArchives();
        }
      }
      if (key === "oncall:eva") {
        ensureOncallEvaTab();
        if (prevNavKey !== "oncall:eva") state.oncallEvaNeedsRefresh = true;
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
      if (key === "params:issue-root-cause" && prevNavKey !== "params:issue-root-cause") {
        state.issueRootCauseNeedsRefresh = true;
        state.issueRootCauseEditMode = false;
        state.issueRootCauseDraft = null;
      }
      if (key === "params:llm-config" && prevNavKey !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant") {
        ensureAiTab();
        if (prevNavKey !== "ai:assistant") state.aiNeedsRefresh = true;
      }
      if (key === "ai:export") {
        ensureAiExportTab();
      }
      if (key === "leave:application") {
        ensureLeaveTab();
        if (prevNavKey !== "leave:application") state.leaveNeedsRefresh = true;
      }
      if (key === "req:manage" && prevNavKey !== "req:manage") {
        state.reqNeedsRefresh = true;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      runNavigationTicketSyncAndRender(prevNavKey, key, render);
    });
  });

  if (showWorkbenchLikeList) {
    const serverPagedList = workbenchUsesServerPagedList;
    const pageSize = Number(state.listPageSize) > 0 ? Number(state.listPageSize) : 10;
    const totalTickets = serverPagedList
      ? Math.max(0, Number(state.ticketListTotal) || 0)
      : listVisibleTickets.length;
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.listPage) || 1), totalPages);
    if (currentPage !== state.listPage) state.listPage = currentPage;
    const start = (currentPage - 1) * pageSize;
    const pageTickets = serverPagedList
      ? listVisibleTickets
      : listVisibleTickets.slice(start, start + pageSize);
    const body = document.getElementById("table-body");
    const selectedSet = new Set(state.selectedTicketIds);
    if (body) {
      if (pageTickets.length === 0 && state.ticketListLoading && isList) {
        const tr = document.createElement("tr");
        tr.className = "ticket-row ticket-row--loading";
        tr.innerHTML = `<td colspan="32" class="list-loading-cell">加载中…</td>`;
        body.appendChild(tr);
      } else {
      appendTicketTableRows(body, pageTickets, {
        namespace: listTableColumnNamespace,
        selectedSet,
        whitelist,
        animate: true,
      });
      }
    }
    const selectAll = document.getElementById("select-all-tickets");
    if (selectAll) {
      const filteredTotal = serverPagedList
        ? Math.max(0, Number(state.ticketListTotal) || 0)
        : listVisibleTickets.length;
      const pageAllSelected =
        listVisibleTickets.length > 0 && listVisibleTickets.every((t) => selectedSet.has(t.orderId));
      const allVisibleSelected = serverPagedList
        ? filteredTotal > 0 && pageAllSelected && selectedSet.size >= filteredTotal
        : pageAllSelected;
      selectAll.checked = allVisibleSelected;
      selectAll.addEventListener("change", () => {
        const checked = selectAll.checked;
        if (serverPagedList) {
          selectAll.disabled = true;
          void fetchWorkbenchFilteredTicketIds()
            .then((ids) => {
              const next = new Set(state.selectedTicketIds);
              if (checked) ids.forEach((id) => next.add(id));
              else ids.forEach((id) => next.delete(id));
              state.selectedTicketIds = Array.from(next);
            })
            .finally(() => {
              selectAll.disabled = false;
              render();
            });
          return;
        }
        const next = new Set(state.selectedTicketIds);
        if (checked) listVisibleTickets.forEach((t) => next.add(t.orderId));
        else listVisibleTickets.forEach((t) => next.delete(t.orderId));
        state.selectedTicketIds = Array.from(next);
        render();
      });
    }
    const paginationWrap = document.getElementById("list-pagination");
    if (paginationWrap) {
      const sizeOptions = [10, 20, 50, 100, 200]
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
      const syncListPageFromServer = () => {
        if (workbenchUsesServerPagedList) {
          if (state.listRefreshing) return;
          state.listRefreshing = true;
          render();
          void resyncWorkbenchTicketList().finally(() => {
            state.listRefreshing = false;
            render();
          });
          return;
        }
        render();
      };
      const pageSizeSelect = document.getElementById("list-page-size");
      if (pageSizeSelect) {
        pageSizeSelect.addEventListener("change", () => {
          state.listPageSize = Number(pageSizeSelect.value) || 10;
          state.listPage = 1;
          syncListPageFromServer();
        });
      }
      const prevBtn = document.getElementById("list-page-prev");
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          state.listPage = Math.max(1, currentPage - 1);
          syncListPageFromServer();
        });
      }
      const nextBtn = document.getElementById("list-page-next");
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          state.listPage = Math.min(totalPages, currentPage + 1);
          syncListPageFromServer();
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
        if (isPatchList) beginPatchCreateTicketModal();
        else beginCreateTicketModal();
      });
    }
    const closeCreateBtn = document.getElementById("close-create-ticket-btn");
    if (closeCreateBtn) {
      closeCreateBtn.addEventListener("click", () => {
        closeCreateTicketModal();
        render();
      });
    }
    if (state.createModalOpen && state.createTicketId) {
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

    const exportBtn = document.getElementById("export-ticket-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        openExportModal();
      });
    }
    if (state.exportModalOpen) bindExportModal(listVisibleTickets);

    if (state.migrateLegacyModalOpen) bindMigrateLegacyModal();

    // 列选择按钮
    const listColumnBtn = document.getElementById("list-column-select-btn");
    if (listColumnBtn) {
      listColumnBtn.addEventListener("click", () => {
        openColumnSelectModal(listTableColumnNamespace);
      });
    }
    if (
      state.columnSelectModalOpen &&
      (state.columnSelectNamespace === "list" || state.columnSelectNamespace === "patch")
    ) {
      bindColumnSelectModal(state.columnSelectNamespace, () => render());
    }

    bindDateRangePicker({
      id: "workbench-created",
      getRange: () => ({
        start: state.ticketListCreatedStart,
        end: state.ticketListCreatedEnd,
      }),
      setRange: (start, end) => {
        state.ticketListCreatedStart = start;
        state.ticketListCreatedEnd = end;
      },
      onApplied: () => {
        state.listPage = 1;
        void syncTicketsFromServer(state.ticketListSearch).then(() => render());
      },
      requestRender: render,
    });

    document.querySelectorAll("[data-ticket-list-filter-open]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const key = el.getAttribute("data-ticket-list-filter-open");
        if (!key) return;
        const nextOpen = state.ticketListFilters.openKey === key ? "" : key;
        state.ticketListFilters.openKey = nextOpen;
        if (workbenchUsesServerPagedList && nextOpen) {
          void fetchTicketListFacets(nextOpen).then(() => render());
        } else {
          render();
        }
      });
    });
    const ticketListFilterOpenKey = state.ticketListFilters.openKey;
    if (ticketListFilterOpenKey) {
      document.querySelectorAll("[data-ticket-list-filter-search]").forEach((el) => {
        const key = el.getAttribute("data-ticket-list-filter-search");
        if (!key || !(el instanceof HTMLInputElement)) return;
        bindColumnFilterSearchInput(
          el,
          (value) => {
            state.ticketListFilters.search[key] = value;
          },
          () => {
            if (workbenchUsesServerPagedList) {
              void fetchTicketListFacets(key).then(() => render());
            } else {
              render();
            }
          }
        );
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
          const all =
            workbenchUsesServerPagedList && Array.isArray(state.ticketListFacetValues[key])
              ? state.ticketListFacetValues[key].filter((v) =>
                  v.toLowerCase().includes((state.ticketListFilters.search[key] || "").toLowerCase())
                )
              : uniqueTicketListFilterValues(ticketListBaseForFilters, key).filter((v) =>
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
          if (workbenchUsesServerPagedList) {
            invalidateWorkbenchListFacets();
            void resyncWorkbenchTicketList().then(() => render());
          } else {
            render();
          }
        });
      });
      document.querySelectorAll("[data-ticket-list-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.ticketListFilters.openKey = "";
          if (workbenchUsesServerPagedList) {
            void resyncWorkbenchTicketList().then(() => render());
          } else {
            render();
          }
        });
      });
    }
    document.addEventListener(
      "click",
      (ev) => {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        if (isColumnFilterPopInteraction(target)) return;
        if (!state.ticketListFilters.openKey) return;
        state.ticketListFilters.openKey = "";
        if (workbenchUsesServerPagedList) {
          void resyncWorkbenchTicketList().then(() => render());
        } else {
          render();
        }
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
        state.listTab = btn.dataset.tab || "all";
        state.listPage = 1;
        invalidateWorkbenchListFacets();
        const afterTab = () => {
          render();
          retrigger(listPanel, "tab-anim");
          retrigger(listPanel, "sheen-anim");
          retrigger(tableBody, "row-reflow");
        };
        if (isList) {
          void resyncWorkbenchTicketList().then(afterTab);
        } else {
          afterTab();
        }
      });
    });

    const listRefreshBtn = document.getElementById("list-refresh-btn");
    if (listRefreshBtn) {
      listRefreshBtn.addEventListener("click", async () => {
        if (state.listRefreshing) return;
        state.listRefreshing = true;
        render();
        try {
          if (isList) {
            invalidateWorkbenchListFacets();
            await resyncWorkbenchTicketList();
          } else {
            await refreshHomeListData();
          }
        } finally {
          state.listRefreshing = false;
          render();
        }
      });
    }

    // 搜索输入框事件
    const searchInput = document.getElementById("ticket-list-search-input");
    registerListSearchInput(searchInput);
    const TICKET_SEARCH_DEBOUNCE_MS = 800;
    let _ticketSearchDebounceTimer = null;

    const setListRefreshingUi = (refreshing) => {
      state.listRefreshing = refreshing;
      const btn = document.getElementById("list-refresh-btn");
      if (!btn) return;
      btn.disabled = refreshing;
      btn.textContent = refreshing ? "刷新中…" : "刷新";
    };

    const runTicketSearchRefresh = async () => {
      armListSearchFocusRestore(searchInput);
      state.listPage = 1;
      setListRefreshingUi(true);
      try {
        await syncTicketsFromServer(state.ticketListSearch);
      } finally {
        setListRefreshingUi(false);
        render();
      }
    };

    const scheduleTicketSearchRefresh = () => {
      if (_ticketSearchDebounceTimer) clearTimeout(_ticketSearchDebounceTimer);
      _ticketSearchDebounceTimer = setTimeout(() => {
        _ticketSearchDebounceTimer = null;
        void runTicketSearchRefresh();
      }, TICKET_SEARCH_DEBOUNCE_MS);
    };

    searchInput?.addEventListener("input", (ev) => {
      noteListSearchInputEvent(searchInput, "activity");
      state.ticketListSearch = searchInput.value || "";
      if (ev.isComposing) return;
      scheduleTicketSearchRefresh();
    });

    searchInput?.addEventListener("compositionend", () => {
      noteListSearchInputEvent(searchInput, "compositionend");
      state.ticketListSearch = searchInput.value || "";
      scheduleTicketSearchRefresh();
    });

    searchInput?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      if (_ticketSearchDebounceTimer) {
        clearTimeout(_ticketSearchDebounceTimer);
        _ticketSearchDebounceTimer = null;
      }
      releaseListSearchRenderHold();
      state.ticketListSearch = searchInput.value || "";
      void runTicketSearchRefresh();
    });

    const active = document.querySelector(".tabs .tab.active");
    placeTabIndicator(active);
  } else if (isHome) {
    if (state.homeWorkbenchTab !== "leave_pending") {
    const operator = currentOperator;
    const pageTickets = Array.isArray(state.homeListTickets) ? state.homeListTickets : [];
    const pageSize = Number(state.homeListPageSize) > 0 ? Number(state.homeListPageSize) : 10;
    const totalTickets = Math.max(0, Number(state.homeListTotal) || 0);
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.homeListPage) || 1), totalPages);
    if (currentPage !== state.homeListPage) state.homeListPage = currentPage;
    const homeBody = document.getElementById("home-table-body");
    const selectedSet = new Set(state.selectedTicketIds);
    if (homeBody) {
      if (state.homeWorkbenchListLoading) {
        const tr = document.createElement("tr");
        tr.className = "ticket-row ticket-row--loading";
        tr.innerHTML = `<td colspan="32" class="list-loading-cell">加载中…</td>`;
        homeBody.appendChild(tr);
      } else {
        appendTicketTableRows(homeBody, pageTickets, {
          namespace: "home",
          selectedSet,
          whitelist,
          animate: true,
        });
      }
    }
    const syncHomePage = () => {
      if (state.homeListRefreshing) return;
      state.homeListRefreshing = true;
      render();
      void resyncHomeWorkbenchList().finally(() => {
        state.homeListRefreshing = false;
        render();
      });
    };
    const homeSelectAll = document.getElementById("home-select-all-tickets");
    if (homeSelectAll) {
      const pageAllSelected =
        pageTickets.length > 0 && pageTickets.every((t) => selectedSet.has(t.orderId));
      homeSelectAll.checked = pageAllSelected;
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
          syncHomePage();
        });
      }
      const homePrevBtn = document.getElementById("home-page-prev");
      if (homePrevBtn) {
        homePrevBtn.addEventListener("click", () => {
          state.homeListPage = Math.max(1, currentPage - 1);
          syncHomePage();
        });
      }
      const homeNextBtn = document.getElementById("home-page-next");
      if (homeNextBtn) {
        homeNextBtn.addEventListener("click", () => {
          state.homeListPage = Math.min(totalPages, currentPage + 1);
          syncHomePage();
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
        const nextOpen = state.homeTicketListFilters.openKey === key ? "" : key;
        state.homeTicketListFilters.openKey = nextOpen;
        if (state.homeListServerPaged && nextOpen) {
          void fetchHomeListFacets(nextOpen).then(() => render());
        } else {
          render();
        }
      });
    });
    const homeTicketListFilterOpenKey = state.homeTicketListFilters.openKey;
    if (homeTicketListFilterOpenKey) {
      document.querySelectorAll("[data-home-ticket-list-filter-search]").forEach((el) => {
        const key = el.getAttribute("data-home-ticket-list-filter-search");
        if (!key || !(el instanceof HTMLInputElement)) return;
        bindColumnFilterSearchInput(
          el,
          (value) => {
            state.homeTicketListFilters.search[key] = value;
          },
          () => {
            if (state.homeListServerPaged) {
              void fetchHomeListFacets(key).then(() => render());
            } else {
              render();
            }
          }
        );
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
          const all =
            state.homeListServerPaged && Array.isArray(state.homeListFacetValues[key])
              ? state.homeListFacetValues[key].filter((v) =>
                  v.toLowerCase().includes((state.homeTicketListFilters.search[key] || "").toLowerCase())
                )
              : uniqueTicketListFilterValues(homeTicketListBaseForFilters, key).filter((v) =>
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
          if (state.homeListServerPaged) {
            invalidateHomeListFacets();
            void resyncHomeWorkbenchList().then(() => render());
          } else {
            render();
          }
        });
      });
      document.querySelectorAll("[data-home-ticket-list-filter-close]").forEach((el) => {
        el.addEventListener("click", () => {
          state.homeTicketListFilters.openKey = "";
          if (state.homeListServerPaged) {
            void resyncHomeWorkbenchList().then(() => render());
          } else {
            render();
          }
        });
      });
    }
    document.addEventListener(
      "click",
      (ev) => {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        if (isColumnFilterPopInteraction(target)) return;
        if (!state.homeTicketListFilters.openKey) return;
        state.homeTicketListFilters.openKey = "";
        if (state.homeListServerPaged) {
          void resyncHomeWorkbenchList().then(() => render());
        } else {
          render();
        }
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
        if (tab === state.homeWorkbenchTab) return;
        state.homeWorkbenchTab = tab;
        state.homeListPage = 1;
        invalidateHomeListFacets();
        if (tab === "leave_pending") {
          render();
          void fetchHomeLeavePendingList();
        } else {
          state.homeWorkbenchListLoading = true;
          render();
          void syncHomeWorkbenchTicketLists().then(() => {
            state.homeWorkbenchListLoading = false;
            render();
          });
        }
      });
    });

    // 主页列选择按钮
    const homeColumnBtn = document.getElementById("home-column-select-btn");
    if (homeColumnBtn) {
      homeColumnBtn.addEventListener("click", () => {
        openColumnSelectModal("home");
      });
    }
    if (state.columnSelectModalOpen && state.columnSelectNamespace === "home") {
      bindColumnSelectModal("home", () => render());
    }

    document.querySelectorAll("[data-home-personal-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-home-personal-preset");
        if (!id) return;
        applyHomePersonalPreset(id);
        render();
      });
    });
    bindDateRangePicker({
      id: "home-personal",
      getRange: () => ({
        start: state.homePersonalStart,
        end: state.homePersonalEnd,
      }),
      setRange: (start, end) => {
        state.homePersonalStart = start;
        state.homePersonalEnd = end;
        state.homePersonalPreset = "";
      },
      onApplied: () => {
        void fetchHomePersonalStats();
      },
      requestRender: render,
    });
    const personalSection = document.querySelector(".home-personal-section");
    if (personalSection && personalSection.dataset.passthroughBound !== "1") {
      personalSection.dataset.passthroughBound = "1";
      personalSection.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-home-personal-field]");
        if (!btn) return;
        const field = btn.getAttribute("data-home-personal-field");
        const val = btn.getAttribute("data-home-personal-value");
        if (field === "passthroughQuality" && val) {
          state.homePersonalPassthroughQuality = val;
          void fetchHomePersonalStats();
        }
      });
    }
    const hpStatsKey = homePersonalQueryKey();
    if (state.homePersonalStatsLoadedKey !== hpStatsKey && !state.homePersonalStatsLoading) {
      void fetchHomePersonalStats();
    }

    const dutyCalSk = _dutyCalendarSyncKey(state);
    if (state.dutyCalendarLoadedKey !== dutyCalSk && !state.dutyCalendarSyncPending) {
      state.dutyCalendarSyncPending = true;
      void syncDutyCalendarMonthsFromServer().then(() => {
        state.dutyCalendarSyncPending = false;
        state.dutyCalendarLoadedKey = dutyCalSk;
        if (!patchHomeDutyCalendarDom()) render();
      });
    }
    const dutyExSk = dutyRosterExtrasSyncKey();
    if (state.dutyRosterExtrasLoadedKey !== dutyExSk && !state.dutyRosterExtrasSyncPending) {
      state.dutyRosterExtrasSyncPending = true;
      void syncDutyRosterExtrasFromServer().then(() => {
        state.dutyRosterExtrasLoadedKey = dutyExSk;
        state.dutyRosterExtrasSyncPending = false;
        if (!patchHomeDutyCalendarDom()) render();
      });
    }
    document.querySelectorAll("#home-duty-info [data-home-duty-unified-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = parseInt(btn.getAttribute("data-home-duty-dir") || "0", 10);
        navigateHomeDutyCalendarMonth(dir);
        render();
      });
    });

    bindMyHomeHeatmap();
  } else if (isRlOncall) {
    bindRlOncallPublicPage();
  } else if (isDuty) {
    bindDutyRosterPage();
  } else if (isLeave) {
    bindLeaveApplicationPage();
  } else if (isReq) {
    bindRequirementPage();
  } else if (isMajorProblem) {
    if ((state.majorIssueNeedsRefresh || !state.majorIssueListLoaded) && !state.majorIssueListLoading) {
      fetchMajorIssueList();
    }
    bindMajorIssuePage();
  } else if (isSiteProfile) {
    if ((state.siteProfileNeedsRefresh || !state.siteProfileListLoaded) && !state.siteProfileListLoading) {
      fetchSiteProfileList();
    }
    bindSiteProfilePage();
  } else if (isToolPlaza || isToolPlazaItem) {
    bindToolPlazaPage();
    if (isToolPlazaItem && toolPlazaItemNo) {
      prepareToolPlazaItemEnter(toolPlazaItemNo);
    }
    if (isToolPlaza && (state.toolPlazaNeedsRefresh || !state.toolPlazaListLoaded) && !state.toolPlazaListLoading) {
      void fetchToolPlazaCategories().then(() => fetchToolPlazaList());
    }
  } else if (isSettings) {
    bindSettingsAppearancePage();
  } else if (isParams && state.activeKey === "params:duty-field") {
    bindDutyFieldParamsPage();
  } else if (isParams && state.activeKey === "params:version") {
    bindVersionParamsPage();
  } else if (isParams && state.activeKey === "params:group-template") {
    bindGroupTemplateParamsPage();
  } else if (isParams && state.activeKey === "params:issue-root-cause") {
    bindIssueRootCauseParamsPage();
  } else if (isParams && state.activeKey === "params:llm-config") {
    bindLlmConfigPage();
  } else if (isAiAssistant) {
    bindAiAssistantPage();
  } else if (isAiExport) {
    bindAiExportPage();
  } else if (isOncallEva) {
    bindOncallEvaPage();
  } else if (isStats) {
    const statsTab = state.statsChartsTab || "labor";
    if (statsTab === "labor" || statsTab === "doer") {
      ensureStatsLaborRangeInit();
    } else if (statsTab === "ownership") {
      ensureStatsOwnershipRangeInit();
    }
    const statsKey = statsChartsQueryKeyForTab(statsTab);
    const statsLoadedKey = state.statsChartsLoadedKey?.[statsTab] || "";
    const statsLoading = state.statsChartsLoading?.[statsTab] || false;
    if (statsLoadedKey !== statsKey && !statsLoading) {
      void loadStatsChartsDataIfNeeded(statsTab);
    }
    bindStatsChartsPage();
  } else if (isReportIssue) {
    bindReportIssuePage();
  } else if (isReportGenerate) {
    bindMonthlyReportPage();
  } else if (isReportArchive) {
    bindMonthlyReportArchivePage((ym) => {
      // 点击「查看」：切换月份并跳到报告生成页
      ensureMonthlyReportTab();
      state.activeKey = "report:generate";
      void loadMonthlyReport(ym);
      const newPath = "/report/generate";
      try { window.history.pushState({}, "", newPath); } catch (_) { /* ignore */ }
      render();
    });
  } else if (!isAdmin) {
    if (activeTicket && !ticketDetailLoading) {
      syncOperationLogsFromServer(activeTicket.orderId);
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
    // Ask Doer按钮事件 - 打开快捷链接弹窗
    const askDoerBtn = document.getElementById("ask-doer-btn");
    if (askDoerBtn && activeTicket) {
      askDoerBtn.addEventListener("click", () => {
        openAskDoerModal();
      });
    }
    // Ask Aid按钮事件
    const askAidBtn = document.getElementById("ask-aid-btn");
    if (askAidBtn) {
      askAidBtn.addEventListener("click", () => {
        window.open("https://console.his.huawei.com/assistant-im/#/gaussdbops", "_blank");
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

  ensureColumnFilterPopOnBody();
  ensureTicketLogDrawerOnBody();
  if (state.problemFillReviewerModalOpen) bindProblemFillReviewerModal();
  bindAskDoerModal();
  restoreListSearchFocus();

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

registerNavigationListPatch(patchNavListPanelsAfterSync);
registerRender(render);
const isPublicRoute = window.location.pathname === "/rl-oncall" || window.location.pathname === "/rl-oncall/";
if (isPublicRoute) {
  bootstrap();
} else {
  ensureLoggedIn().then((loggedIn) => {
    if (loggedIn) {
      bootstrap();
    }
  });
}
