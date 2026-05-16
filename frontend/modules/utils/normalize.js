import { PERMISSION_LEVEL_RANK, PERMISSION_DEFAULT_HIDDEN_KEYS, PERMISSION_STRATEGY_OPTIONS_BY_KEY, PERMISSION_LEVEL_OPTIONS, PERMISSION_WHITELIST_ITEMS, PERMISSION_WHITELIST_PARENT_MAP } from "../constants/permission.js";

export function normalizeIssueSeverity(raw) {
  const s = String(raw || "").trim();
  if (s === "一般" || s === "严重" || s === "致命") return s;
  const lower = s.toLowerCase();
  if (lower === "urgent") return "致命";
  if (lower === "high") return "严重";
  if (lower === "low" || lower === "medium") return "一般";
  return s || "一般";
}

export function severityPillClass(label) {
  const s = normalizeIssueSeverity(label);
  if (s === "致命") return "urgent";
  if (s === "严重") return "high";
  if (s === "一般") return "low";
  return "medium";
}

export function normalizeDutyRotationList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      account: String(x.account || "").trim(),
      user_name: String(x.user_name || "").trim(),
      status: x.status === "inactive" ? "inactive" : "active",
      last_accept_at: x.last_accept_at != null && String(x.last_accept_at).trim() ? String(x.last_accept_at).trim() : "",
    }))
    .filter((x) => x.account);
}

export function normalizeDutySiteOnCallRows(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      site_name: String(x.site_name || "").trim(),
      account: String(x.account || "").trim(),
      user_name: String(x.user_name || "").trim(),
      status: x.status === "inactive" ? "inactive" : "active",
      last_accept_at: x.last_accept_at != null && String(x.last_accept_at).trim() ? String(x.last_accept_at).trim() : "",
    }))
    .filter((x) => x.site_name && x.account);
}

export function normalizeDutyRlSlot(x) {
  return {
    account: String(x.account || "").trim(),
    user_name: String(x.user_name || "").trim(),
    phone: String(x.phone || "").trim(),
  };
}

export function normalizeDutyRlOnCallRows(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      duty_date: String(x.duty_date || "").trim().slice(0, 10),
      primary: normalizeDutyRlSlot(x.primary || {}),
      backup: normalizeDutyRlSlot(x.backup || {}),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.duty_date));
}

export function normalizeDutyCascadeValue(raw) {
  return String(raw || "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

export function splitDutyFieldCascadePath(raw) {
  return String(raw || "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizePermissionLevel(level) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, level) ? level : "hidden";
}

export function getPermissionLevelRank(level) {
  return PERMISSION_LEVEL_RANK[normalizePermissionLevel(level)];
}

export function getWhitelistLevel(fieldKey, whitelist) {
  const map = whitelist;
  const raw = String(map?.[fieldKey] || "").trim();
  if (Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, raw)) return raw;
  if (PERMISSION_DEFAULT_HIDDEN_KEYS.has(fieldKey)) return "hidden";
  return "readonly";
}

export function whitelistAllows(fieldKey, minLevel, whitelist) {
  if (!fieldKey) return true;
  const need = minLevel || "readonly";
  return getPermissionLevelRank(getWhitelistLevel(fieldKey, whitelist)) >= getPermissionLevelRank(need);
}

export function normalizePermissionLevelForItem(itemKey, level) {
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

export function getPermissionStrategyOptions(itemKey) {
  const source = PERMISSION_STRATEGY_OPTIONS_BY_KEY[itemKey] || PERMISSION_LEVEL_OPTIONS;
  return source.map(([v, t]) => ({
    value: v,
    text: t,
  }));
}

export function getWhitelistKeyByActiveKey(activeKey) {
  const key = String(activeKey || "");
  if (key === "home") return "home";
  if (key === "list") return "ticket_list";
  if (key === "patch:list") return "patch_manage";
  if (key === "duty:roster") return "duty_roster";
  if (key === "leave:application") return "leave_application";
  if (key === "req:manage") return "requirement_list";
  if (key === "major:problem") return "major_problem_list";
  if (key === "admin:permissions") return "admin_permissions";
  if (key === "admin:users") return "admin_users";
  if (key === "stats:charts" || key === "stats:report" || key === "stats:skills") return "stats_dashboard";
  if (key === "report:issue" || key === "report:generate") return "stats_dashboard";
  if (key === "ai:assistant") return "ai_assistant";
  if (key === "params:llm-config") return "params_llm_config";
  if (key === "upload:analysis") return "upload_analysis";
  if (key === "oncall:eva") return "oncall_eva";
  if (key.startsWith("params:")) return "params_config";
  if (key.startsWith("ticket:")) return "ticket_detail";
  return "";
}

export function applyPermissionWhitelistCascade(draft) {
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
  nextDraft.home = nextDraft.ticket_detail;
  const homeDutyRank = getPermissionLevelRank(nextDraft.home_duty_roster);
  const homeRank = getPermissionLevelRank(nextDraft.home);
  if (homeDutyRank > homeRank) {
    nextDraft.home_duty_roster = nextDraft.home;
  }
  return { draft: nextDraft };
}
