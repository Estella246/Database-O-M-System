import { state } from "../state/state.js";
import { getWhitelistKeyByActiveKey, whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import {
  makeNewTicketId,
  operatorMatchesPersonField,
  operatorMatchesAnyPersonFields,
  ticketCreatorMatchesOperator,
} from "../utils/format.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { requestRender } from "../core/scheduler.js";
import { STEP_BY_NODE_KEY, WORKFLOW_NODES } from "../constants/workflow.js";
import { workflowByOrderId, operationLogsByOrderId } from "../state/state.js";

function getUrlByKey(key) {
  if (key === "home") return "/";
  if (key === "list") return "/workbench";
  if (key === "duty:roster") return "/duty-roster";
  if (key === "leave:application") return "/leave-application";
  if (key === "req:manage") return "/requirements";
  if (key === "major:problem") return "/major-problems";
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
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
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

function ensureStatsSkillsTab() {
  const key = "stats:skills";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "工单分析 Skill", closable: true });
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

function ensureUploadAnalysisTab() {
  const key = "upload:analysis";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "人力分析", closable: true });
  }
  return key;
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

function ensureMajorProblemTab() {
  const key = "major:problem";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "重大问题", closable: true });
  }
  return key;
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

function getWorkbenchListBaseTickets(operator, getAllTickets) {
  const whitelist = getCurrentWhitelistSettings();
  const onlyMyCreated = getWhitelistLevel("ticket_list", whitelist) === "editable";
  return onlyMyCreated
    ? getAllTickets().filter((t) => ticketCreatorMatchesOperator(t, operator))
    : getAllTickets();
}

function filterTicketsByHomeWorkbenchTab(tickets, tab, operator) {
  const list = tickets || [];
  if (tab === "leave_pending") return [];
  if (tab === "pending") {
    return list.filter((t) => {
      const handler = String((t.currentHandler ?? t.assignee) || "").trim();
      return operatorMatchesAnyPersonFields(handler, operator);
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
      return operatorMatchesAnyPersonFields(handler, operator);
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
  if (pathname === "/major-problems" || pathname === "/major-problems/") {
    state.activeKey = ensureMajorProblemTab();
    state.majorProblemNeedsRefresh = true;
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
  if (pathname === "/stats/skills" || pathname === "/stats/skills/") {
    state.activeKey = ensureStatsSkillsTab();
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

export {
  getUrlByKey,
  ensureTicketTab,
  ensureAdminTab,
  ensureDutyTab,
  ensureHomeTab,
  ensureListTab,
  ensureStatsChartsTab,
  ensureStatsReportTab,
  ensureStatsSkillsTab,
  ensureSettingsTab,
  ensureParamsTab,
  ensureAiTab,
  ensureUploadAnalysisTab,
  ensureLeaveTab,
  ensureRequirementTab,
  ensureMajorProblemTab,
  isActiveKeyVisible,
  getDefaultVisibleActiveKey,
  getCreateModalStartNodeKey,
  getWorkbenchListBaseTickets,
  filterTicketsByHomeWorkbenchTab,
  syncActiveKeyFromPath,
};
