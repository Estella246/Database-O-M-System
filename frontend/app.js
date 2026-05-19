// Import auth.js first to setup fetch interceptor before any API calls
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings, isActiveKeyVisible, getDefaultVisibleActiveKey, ensureLoggedIn } from "./modules/core/auth.js";

import { state } from "./modules/state/state.js";
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
import { parseYmdToDate } from "./modules/utils/date.js";
import {
  destroyWorkbenchCreatedCalendarOverlay,
  mountWorkbenchCreatedCalendarOverlay,
} from "./modules/ui/workbench-glass-datepicker.js";
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
  renderDutyDayModalHtml,
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
  renderMajorProblemPage,
  renderMajorProblemModalsHtml,
  bindMajorProblemPage,
  fetchMajorProblemList,
} from "./modules/pages/major-problem-page.js";

import {
  ensureStatsChartsTab,
  ensureStatsReportTab,
  ensureStatsSkillsTab,
  detachStatsChartZoomMasksFromBody,
  detachAdminWhitelistModalFromBody,
  renderStatsReportPage,
  bindStatsReportPage,
  fetchStatsSkillsList,
  renderStatsSkillsPage,
  bindStatsSkillsPage,
  renderStatsChartsPage,
  bindStatsChartsPage,
  renderUploadAnalysisPage,
  bindUploadAnalysisPage,
} from "./modules/pages/stats-page.js";

import {
  ensureAdminTab,
  ensureAdminWhitelistModalOnBody,
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
  ensureSettingsTab,
  ensureUploadAnalysisTab,
  ensureLeaveTab,
  ensureRequirementTab,
  ensureMajorProblemTab,
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
  bindLlmConfigPage,
} from "./modules/pages/ticket-page.js";

import {
  fetchHomeLeavePendingList,
  homePersonalQueryKey,
  fetchHomePersonalStats,
  renderHomePersonalSectionHtml,
  fetchLeaveDetail,
  renderMyHomeHeatmapCard,
  bindMyHomeHeatmap,
  getWorkbenchListBaseTickets,
  getPatchListBaseTickets,
  getHomePendingWorkbenchBaseTickets,
  filterTicketsByHomeWorkbenchTab,
  applyHomePersonalPreset,
} from "./modules/pages/home-page.js";

import {
  renderTicketListFilterHeader,
  syncTicketsFromServer,
  syncHomeWorkbenchTicketLists,
  planTicketListResync,
  refreshHomeListData,
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
  renderColumnSelectModalHtml,
  bindColumnSelectModal,
  openColumnSelectModal,
} from "./modules/pages/column-select-modal.js";
import {
  getCurrentTableColumns,
  renderDynamicTableHeader,
  renderDynamicTableRowCells,
} from "./modules/pages/table-columns.js";
import { normalizeNodeKey } from "./modules/pages/ticket.js";
import { dutyCalendarSyncKey as _dutyCalendarSyncKey } from "./modules/utils/date.js";
import { bindSidebarFlyouts } from "./modules/ui/sidebar-flyouts.js";
import { bindSidebarResize } from "./modules/ui/sidebar-resize.js";

const root = document.getElementById("root");
let sidebarFlyoutAbort = null;

function render() {
  destroyWorkbenchCreatedCalendarOverlay();
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
  const isHome = state.activeKey === "home";
  if (!isHome) {
    document.body.querySelector("#order-heatmap-tooltip")?.remove();
  }
  const isList = state.activeKey === "list";
  const isPatchList = state.activeKey === "patch:list";
  const listTableColumnNamespace = isPatchList ? "patch" : "list";
  const showWorkbenchLikeList = isList || isPatchList;
  if (!showWorkbenchLikeList) state.ticketListCalPopover = null;
  const isDuty = state.activeKey === "duty:roster";
  const isLeave = state.activeKey === "leave:application";
  const isReq = state.activeKey === "req:manage";
  const isMajorProblem = state.activeKey === "major:problem";
  const isParams = state.activeKey.startsWith("params:");
  const isAdmin = state.activeKey.startsWith("admin:");
  const isStats = state.activeKey === "stats:charts";
  const isStatsReport = state.activeKey === "stats:report";
  const isStatsSkills = state.activeKey === "stats:skills";
  const isSettings = state.activeKey === "settings:appearance";
  const isAi = state.activeKey === "ai:assistant";
  const isUpload = state.activeKey === "upload:analysis";
  const isOncallEva = state.activeKey === "oncall:eva";
  const isReportIssue = state.activeKey === "report:issue";
  const isReportGenerate = state.activeKey === "report:generate";
  const isReportArchive = state.activeKey === "report:archive";
  const isReport = isReportIssue || isReportGenerate || isReportArchive;
  const currentOperator = getCurrentOperator();
  const canViewHome = whitelistAllows("home", "readonly", whitelist);
  const canViewList = whitelistAllows("ticket_list", "readonly", whitelist);
  const canViewDuty = whitelistAllows("duty_roster", "readonly", whitelist);
  const canViewLeave = whitelistAllows("leave_application", "readonly", whitelist);
  const canViewReq = whitelistAllows("requirement_list", "readonly", whitelist);
  const canViewMajorProblem = whitelistAllows("major_problem_list", "readonly", whitelist);
  const canViewAdminPermissions = whitelistAllows("admin_permissions", "readonly", whitelist);
  const canViewAdminUsers = whitelistAllows("admin_users", "readonly", whitelist);
  const canViewParams = whitelistAllows("params_config", "readonly", whitelist);
  const canViewLlmConfig = whitelistAllows("params_llm_config", "readonly", whitelist);
  const canViewAi = whitelistAllows("ai_assistant", "readonly", whitelist);
  const canViewStats = whitelistAllows("stats_dashboard", "readonly", whitelist);
  const canViewPatch = whitelistAllows("patch_manage", "readonly", whitelist);
  const canViewHomeDutyInfo = whitelistAllows("home_duty_roster", "readonly", whitelist);
  const canViewOncallEva = whitelistAllows("oncall_eva", "readonly", whitelist);
  const canViewReportMenu = whitelistAllows("monthly_report", "readonly", whitelist);
  const canViewWorkbenchGroup = whitelistAllows("workbench_group", "readonly", whitelist);
  const canViewWorkbenchCreate = whitelistAllows("workbench_create", "readonly", whitelist);
  const canViewWorkbenchExport = whitelistAllows("workbench_export", "readonly", whitelist);
  const canViewWorkbenchDelete = whitelistAllows("workbench_delete", "readonly", whitelist);
  const canViewPatchManageDelete = whitelistAllows("patch_manage_delete", "readonly", whitelist);
  const canViewTicketLog = whitelistAllows("ticket_detail_log", "readonly", whitelist);
  if (!canViewTicketLog && state.logDrawerOpen) state.logDrawerOpen = false;
  const currentRoleCode = getCurrentRoleCode();
  let ticketListBaseForFilters = [];
  if (isList) {
    ticketListBaseForFilters = getWorkbenchListBaseTickets(currentOperator);
  } else if (isPatchList) {
    ticketListBaseForFilters = getPatchListBaseTickets(currentOperator);
  }
  let homeTicketListBaseForFilters = [];
  if (isHome) {
    homeTicketListBaseForFilters =
      state.homeWorkbenchTab === "pending"
        ? getHomePendingWorkbenchBaseTickets(currentOperator)
        : getWorkbenchListBaseTickets(currentOperator);
  }
  // 提前计算 visibleTickets 用于导出弹窗渲染
  let listVisibleTickets = [];
  if (showWorkbenchLikeList) {
    const operator = getCurrentOperator();
    const baseTickets = ticketListBaseForFilters;
    const visibleByTab = baseTickets.filter((t) => {
      if (state.listTab === "all") return true;
      if (state.listTab === "created") return ticketCreatorMatchesOperator(t, operator);
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesAnyPersonFields(handler, operator);
    });
    listVisibleTickets = filterTicketsByListColumnFilters(visibleByTab, state.ticketListFilters);
  }
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
      : isDuty
        ? "值班表"
        : isLeave
          ? "请假申请"
            : isSettings
            ? "设置 · GaussDB-Ops"
            : isStatsReport
              ? "工单分析 · GaussDB-Ops"
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
                  : state.activeKey.replace("ticket:", "");

  detachStatsChartZoomMasksFromBody();
  detachAdminWhitelistModalFromBody();
  const workbenchCreatedStartLabel = escapeHtml(state.ticketListCreatedStart || "开始");
  const workbenchCreatedEndLabel = escapeHtml(state.ticketListCreatedEnd || "结束");
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
            <div class="menu-submenu menu-submenu--duty" role="menu" aria-label="值班表子项">
              ${renderDutySubmenuHtml()}
            </div>
          </div>` : ""}
          ${canViewLeave ? `<button class="menu-item menu-item--tag ${isLeave ? "active" : ""}" data-nav-key="leave:application">请假申请</button>` : ""}
        </section>
        <section class="menu-group" aria-label="运维管理">
          <h3 class="menu-group-title">运维管理</h3>
          ${canViewPatch ? `<button type="button" class="menu-item menu-item--tag ${isPatchList ? "active" : ""}" data-nav-key="patch:list">补丁管理</button>` : ""}
          <button class="menu-item menu-item--tag">变更日历</button>
          ${canViewMajorProblem ? `<button class="menu-item menu-item--tag ${isMajorProblem ? "active" : ""}" data-nav-key="major:problem">重大问题</button>` : ""}
          ${canViewReq ? `<button class="menu-item menu-item--tag ${isReq ? "active" : ""}" data-nav-key="req:manage">需求管理</button>` : ""}
        </section>
        <section class="menu-group" aria-label="数据报表">
          <h3 class="menu-group-title">数据报表</h3>
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStats ? "active" : ""}" data-nav-key="stats:charts">统计图表</button>` : ""}
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStatsReport ? "active" : ""}" data-nav-key="stats:report">工单分析</button>` : ""}
${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStatsSkills ? "active" : ""}" data-nav-key="stats:skills">工单分析 Skill</button>` : ""}
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isUpload ? "active" : ""}" data-nav-key="upload:analysis">人力分析</button>` : ""}
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
            <div class="menu-submenu menu-submenu--params" role="menu" aria-label="参数配置子项">
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
      <div
        class="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        tabindex="0"
      ></div>
    </aside>

    <main class="center center-enter">
      <div class="head">
<h1 id="center-page-title" class="${isHome || isList || isPatchList || isDuty || isLeave || isReq || isMajorProblem || isParams || isStats || isStatsReport || isStatsSkills || isSettings || isAi || isUpload || isOncallEva || isAdmin || isReport ? "" : "hidden"}">${isHome ? (() => { const op = getCurrentOperator(); return op.userName ? `${op.userName}的主页` : "我的主页"; })() : isList ? "工作台" : isPatchList ? "补丁管理" : isDuty ? "值班表" : isLeave ? "请假申请" : isReq ? "需求管理" : isMajorProblem ? "重大问题" : isSettings ? "设置" : isAi ? "智能助手" : isUpload ? "人力分析" : isOncallEva ? "运维效率" : isParams ? getParamsPageHeadline(state.activeKey) : isAdmin ? (state.activeKey === "admin:permissions" ? "权限策略" : "用户管理") : isStatsSkills ? "工单分析 Skill" : isStatsReport ? "工单分析" : isStats ? "统计图表" : isReportIssue ? "问题报表" : isReportGenerate ? "报告生成" : isReportArchive ? "报告归档" : ""}</h1>
        <div class="actions ${showWorkbenchLikeList ? "" : "hidden"}">
          ${canViewWorkbenchGroup ? '<button type="button" class="action" id="group-pull-open-btn">拉群</button>' : ""}
          ${canViewWorkbenchCreate ? '<button class="action primary" id="create-ticket-btn">创建</button>' : ""}
          ${canViewWorkbenchExport ? '<button type="button" class="action" id="export-ticket-btn">导出</button>' : ""}
          ${showWorkbenchLikeList && (isPatchList ? canViewPatchManageDelete : canViewWorkbenchDelete)
            ? '<button class="action danger" id="delete-ticket-btn">删除</button>'
            : ""}
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
              ${renderDynamicTableHeader(homeTicketListBaseForFilters, "home", renderTicketListFilterHeader)}
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
          <div class="date-range date-range--workbench-created" title="按工单创建时间（本地日期）筛选">
            <button class="date-trigger" id="start-trigger" type="button" aria-label="创建开始日期">${workbenchCreatedStartLabel}</button>
            <span class="date-sep">--</span>
            <button class="date-trigger" id="end-trigger" type="button" aria-label="创建结束日期">${workbenchCreatedEndLabel}</button>
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
              ${renderDynamicTableHeader(ticketListBaseForFilters, listTableColumnNamespace, renderTicketListFilterHeader)}
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
            : isMajorProblem
              ? `
      <section class="mp-page" id="major-problem-page" aria-label="重大问题">
        ${renderMajorProblemPage()}
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
                  : isStatsSkills
                    ? `
      ${renderStatsSkillsPage()}
      `
                    : isStats
                      ? `
      ${renderStatsChartsPage()}
      `
                    : isUpload
                      ? `
      ${renderUploadAnalysisPage()}
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
            <button class="action ai" id="ask-doer-btn" type="button">Ask Doer</button>
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
  ${createModalHtml}
  ${showWorkbenchLikeList ? renderGroupPullModalHtml() : ""}
  ${showWorkbenchLikeList ? renderExportModalHtml(state.selectedTicketIds.length, listVisibleTickets.length) : ""}
  ${isHome ? renderColumnSelectModalHtml("home") : ""}
  ${showWorkbenchLikeList ? renderColumnSelectModalHtml("list") : ""}
  ${showWorkbenchLikeList ? renderColumnSelectModalHtml("patch") : ""}
  ${isLeave ? renderLeaveModalsHtml() : ""}
  ${isReq ? renderRequirementModalsHtml() : ""}
  ${isMajorProblem ? renderMajorProblemModalsHtml() : ""}
`;
  ensureAdminWhitelistModalOnBody();

  sidebarFlyoutAbort?.abort();
  sidebarFlyoutAbort = new AbortController();
  bindSidebarFlyouts(root, { signal: sidebarFlyoutAbort.signal });
  bindSidebarResize(root, { signal: sidebarFlyoutAbort.signal });

  const layout = document.querySelector(".layout");
  const collapseBtn = document.getElementById("collapse-btn");
  collapseBtn.addEventListener("click", () => {
    layout.classList.toggle("left-collapsed");
    collapseBtn.textContent = layout.classList.contains("left-collapsed") ? "»" : "«";
  });

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
    if (state.activeKey === "oncall:eva" && prevTabKey !== "oncall:eva") {
      state.oncallEvaNeedsRefresh = true;
    }
    history.pushState({}, "", getUrlByKey(state.activeKey));
    if (state.activeKey === "home" && prevTabKey !== "home") {
      void syncHomeWorkbenchTicketLists().then(() => render());
    }
    const tabResync = planTicketListResync(prevTabKey, state.activeKey);
    if (tabResync.sync) {
      const search = tabResync.ignoreSearch ? "" : state.ticketListSearch;
      void syncTicketsFromServer(search).then(() => render());
    }
    render();
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
        if (prevNavKey !== "home") {
          void syncHomeWorkbenchTicketLists().then(() => render());
        }
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
        if (prevNavKey !== "major:problem") state.majorProblemNeedsRefresh = true;
      }
      if (key === "stats:charts") {
        ensureStatsChartsTab();
      }
      if (key === "stats:report") {
        ensureStatsReportTab();
      }
      if (key === "stats:skills") {
        ensureStatsSkillsTab();
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
      if (key === "upload:analysis") {
        ensureUploadAnalysisTab();
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
      const navResync = planTicketListResync(prevNavKey, key);
      if (navResync.sync) {
        const search = navResync.ignoreSearch ? "" : state.ticketListSearch;
        void syncTicketsFromServer(search).then(() => render());
      }
      render();
    });
  });

  if (showWorkbenchLikeList) {
    // 使用提前计算的 listVisibleTickets（已在 render 函数开头计算）
    const pageSize = Number(state.listPageSize) > 0 ? Number(state.listPageSize) : 10;
    const totalTickets = listVisibleTickets.length;
    const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.listPage) || 1), totalPages);
    if (currentPage !== state.listPage) state.listPage = currentPage;
    const start = (currentPage - 1) * pageSize;
    const pageTickets = listVisibleTickets.slice(start, start + pageSize);
    const body = document.getElementById("table-body");
    const selectedSet = new Set(state.selectedTicketIds);
    const nRows = pageTickets.length;
    const staggerStepSec = nRows > 0 ? Math.min(0.04, 0.48 / nRows) : 0;
    if (body) {
      pageTickets.forEach((ticket, rowIndex) => {
        const tr = document.createElement("tr");
        tr.className = "ticket-row";
        tr.dataset.orderId = ticket.orderId;
        tr.style.setProperty("--row-stagger", `${(rowIndex + 1) * staggerStepSec}s`);
        tr.innerHTML = renderDynamicTableRowCells(ticket, listTableColumnNamespace, selectedSet);
        tr.addEventListener("click", () => {
          if (!whitelistAllows("ticket_detail", "readonly")) return;
          state.activeKey = ensureTicketTab(ticket.orderId);
          history.pushState({}, "", getUrlByKey(state.activeKey));
          render();
        });
        body.appendChild(tr);
      });
    }
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
      const wf = state.createModalWorkflow === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
      const nk =
        state.createModalNodeKey ||
        (wf === "HOTPATCH" ? "hp_demand_fill" : getCreateModalStartNodeKey());
      ensureNodeFormData(state.createTicketId, nk, wf, true);
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

    function openWorkbenchCreatedDatePopover(which) {
      if (state.ticketListCalPopover?.which === which) {
        state.ticketListCalPopover = null;
        render();
        return;
      }
      let viewYear = new Date().getFullYear();
      let viewMonth = new Date().getMonth();
      const curYmd = which === "start" ? state.ticketListCreatedStart : state.ticketListCreatedEnd;
      if (curYmd) {
        const d = parseYmdToDate(curYmd);
        if (d) {
          viewYear = d.getFullYear();
          viewMonth = d.getMonth();
        }
      }
      state.ticketListCalPopover = { which, viewYear, viewMonth };
      render();
    }
    const startCreatedBtn = document.getElementById("start-trigger");
    const endCreatedBtn = document.getElementById("end-trigger");
    if (startCreatedBtn) {
      startCreatedBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openWorkbenchCreatedDatePopover("start");
      });
    }
    if (endCreatedBtn) {
      endCreatedBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openWorkbenchCreatedDatePopover("end");
      });
    }
    if (state.ticketListCalPopover) {
      const pop = state.ticketListCalPopover;
      const anchorEl = document.getElementById(pop.which === "start" ? "start-trigger" : "end-trigger");
      mountWorkbenchCreatedCalendarOverlay({
        cfg: pop,
        selectedStart: state.ticketListCreatedStart,
        selectedEnd: state.ticketListCreatedEnd,
        anchorEl,
        onNavigate: (y, m) => {
          if (!state.ticketListCalPopover) return;
          state.ticketListCalPopover = { ...state.ticketListCalPopover, viewYear: y, viewMonth: m };
          render();
        },
        onPick: (ymd) => {
          const w = state.ticketListCalPopover?.which;
          if (!w) return;
          if (w === "start") {
            state.ticketListCreatedStart = ymd;
            if (state.ticketListCreatedEnd && ymd > state.ticketListCreatedEnd) {
              state.ticketListCreatedEnd = ymd;
            }
          } else {
            state.ticketListCreatedEnd = ymd;
            if (state.ticketListCreatedStart && ymd < state.ticketListCreatedStart) {
              state.ticketListCreatedStart = ymd;
            }
          }
          state.ticketListCalPopover = null;
          state.listPage = 1;
          void syncTicketsFromServer(state.ticketListSearch).then(() => render());
        },
        onClear: () => {
          const w = state.ticketListCalPopover?.which;
          if (w === "start") state.ticketListCreatedStart = "";
          else if (w === "end") state.ticketListCreatedEnd = "";
          state.ticketListCalPopover = null;
          state.listPage = 1;
          void syncTicketsFromServer(state.ticketListSearch).then(() => render());
        },
        onClose: () => {
          state.ticketListCalPopover = null;
          render();
        },
      });
    }

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
        state.listTab = btn.dataset.tab || "all";
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

    // 搜索输入框事件
    const searchInput = document.getElementById("ticket-list-search-input");
    const TICKET_SEARCH_DEBOUNCE_MS = 400;
    let _ticketSearchDebounceTimer = null;

    const scheduleTicketSearchRefresh = () => {
      if (_ticketSearchDebounceTimer) clearTimeout(_ticketSearchDebounceTimer);
      _ticketSearchDebounceTimer = setTimeout(async () => {
        _ticketSearchDebounceTimer = null;
        state.listRefreshing = true;
        state.listPage = 1;
        render();
        try {
          await syncTicketsFromServer(state.ticketListSearch);
        } finally {
          state.listRefreshing = false;
          render();
        }
      }, TICKET_SEARCH_DEBOUNCE_MS);
    };

    searchInput?.addEventListener("input", (ev) => {
      state.ticketListSearch = searchInput.value || "";
      if (ev.isComposing) return;
      scheduleTicketSearchRefresh();
    });

    searchInput?.addEventListener("compositionend", () => {
      state.ticketListSearch = searchInput.value || "";
      scheduleTicketSearchRefresh();
    });

    searchInput?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      if (_ticketSearchDebounceTimer) {
        clearTimeout(_ticketSearchDebounceTimer);
        _ticketSearchDebounceTimer = null;
      }
      state.ticketListSearch = searchInput.value || "";
      state.listPage = 1;
      state.listRefreshing = true;
      render();
      void syncTicketsFromServer(state.ticketListSearch).finally(() => {
        state.listRefreshing = false;
        render();
      });
    });

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
        const tr = document.createElement("tr");
        tr.className = "ticket-row";
        tr.dataset.orderId = ticket.orderId;
        tr.style.setProperty("--row-stagger", `${(rowIndex + 1) * staggerStepSec}s`);
        tr.innerHTML = renderDynamicTableRowCells(ticket, "home", selectedSet);
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

    const dutyCalSk = _dutyCalendarSyncKey(state);
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
  } else if (isMajorProblem) {
    if ((state.majorProblemNeedsRefresh || !state.majorProblemListLoaded) && !state.majorProblemListLoading) {
      fetchMajorProblemList();
    }
    bindMajorProblemPage();
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
  } else if (isStatsSkills) {
    if (!state.statsSkillsList.length && !state.statsSkillsLoading) {
      fetchStatsSkillsList();
    }
    bindStatsSkillsPage();
  } else if (isUpload) {
    bindUploadAnalysisPage();
  } else if (isOncallEva) {
    bindOncallEvaPage();
  } else if (isStatsReport) {
    bindStatsReportPage();
  } else if (isStats) {
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
    // Ask Doer按钮事件
    const askDoerBtn = document.getElementById("ask-doer-btn");
    if (askDoerBtn && activeTicket) {
      askDoerBtn.addEventListener("click", () => {
        const orderId = activeTicket.orderId;
        const baseUrl = "http://10.30.196.77:18130";
        const targetUrl = `${baseUrl}/#/agentViews?ticket_id=${encodeURIComponent(orderId)}`;
        window.open(targetUrl, "_blank");
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

registerRender(render);
ensureLoggedIn().then((loggedIn) => {
  if (loggedIn) {
    bootstrap();
  }
});
