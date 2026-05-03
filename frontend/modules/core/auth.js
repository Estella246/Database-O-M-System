import { PERMISSION_WHITELIST_NODE_KEY } from "../constants/permission.js";
import { DEFAULT_OPERATOR_ACCOUNT, DEFAULT_OPERATOR_NAME } from "../constants/theme.js";
import { state } from "../state/state.js";

function getCurrentOperator() {
  const savedAccount = (window.localStorage.getItem("demo_operator_account") || "").trim();
  const savedName = (window.localStorage.getItem("demo_operator_name") || "").trim();
  const account = savedAccount || DEFAULT_OPERATOR_ACCOUNT;
  const row = state.adminUsers.find((u) => String(u.account || "") === account);
  const userName = String(row?.user_name || savedName || DEFAULT_OPERATOR_NAME);
  return { account, userName };
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

import { getWhitelistKeyByActiveKey } from "../utils/normalize.js";
import { whitelistAllows } from "../utils/normalize.js";
import { ensureListTab, ensureLeaveTab, ensureRequirementTab, ensureSettingsTab } from "../pages/settings-page.js";
import { ensureHomeTab, ensureDutyTab } from "../pages/ticket-core.js";
import { ensureStatsChartsTab } from "../pages/stats-page.js";

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

export { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings, isActiveKeyVisible, getDefaultVisibleActiveKey };
