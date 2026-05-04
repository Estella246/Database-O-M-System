import { state } from "./modules/state/state.js";
import { escapeHtml, escapeAttr } from "./modules/utils/escape.js";
import {
  listPreviewText,
  formatTicketSlaDhM,
  uniqueTicketListFilterValues,
  filterTicketsByListColumnFilters,
  operatorMatchesPersonField,
  ticketCreatorMatchesOperator,
  tabIndicatorMetrics,
} from "./modules/utils/format.js";
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
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings, isActiveKeyVisible, getDefaultVisibleActiveKey } from "./modules/core/auth.js";
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
  ensureListTab,
  renderSettingsAppearanceHtml,
  bindSettingsAppearancePage,
} from "./modules/pages/settings-page.js";

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
  filterTicketsByHomeWorkbenchTab,
  applyHomePersonalPreset,
} from "./modules/pages/home-page.js";

import {
  renderTicketListFilterHeader,
  syncTicketsFromServer,
  refreshHomeListData,
  getUrlByKey,
  getActiveTicket,
  getCreateModalStartNodeKey,
  beginCreateTicketModal,
  ensureTicketTab,
  ensureDutyTab,
  ensureHomeTab,
} from "./modules/pages/ticket-core.js";
import { normalizeNodeKey } from "./modules/pages/ticket.js";
import { dutyCalendarSyncKey as _dutyCalendarSyncKey } from "./modules/utils/date.js";

const root = document.getElementById("root");

function render() {
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
  const isStatsSkills = state.activeKey === "stats:skills";
  const isSettings = state.activeKey === "settings:appearance";
  const isAi = state.activeKey === "ai:assistant";
  const isUpload = state.activeKey === "upload:analysis";
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
                  ? `${state.activeKey === "admin:permissions" ? "权限策略" : "用户管理"} · 运维工单平台 Demo`
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
${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isStatsSkills ? "active" : ""}" data-nav-key="stats:skills">工单分析 Skill</button>` : ""}
          ${canViewStats ? `<button type="button" class="menu-item menu-item--tag ${isUpload ? "active" : ""}" data-nav-key="upload:analysis">人力分析</button>` : ""}
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
<h1 id="center-page-title" class="${isHome || isList || isDuty || isLeave || isReq || isParams || isStats || isStatsReport || isStatsSkills || isSettings || isAi || isUpload || isAdmin ? "" : "hidden"}">${isHome ? "我的主页" : isList ? "工作台" : isDuty ? "值班表" : isLeave ? "请假申请" : isReq ? "需求管理" : isSettings ? "设置" : isAi ? "智能助手" : isUpload ? "人力分析" : isParams ? getParamsPageHeadline(state.activeKey) : isAdmin ? (state.activeKey === "admin:permissions" ? "权限策略" : "用户管理") : isStatsSkills ? "工单分析 Skill" : isStatsReport ? "工单分析" : isStats ? "统计图表" : ""}</h1>
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
`;
  ensureAdminWhitelistModalOnBody();

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
      if (key === "stats:skills") {
        ensureStatsSkillsTab();
      }
      if (key === "upload:analysis") {
        ensureUploadAnalysisTab();
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

registerRender(render);
bootstrap();
