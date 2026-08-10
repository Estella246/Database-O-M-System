import {
  PERMISSION_LEVEL_RANK,
  PERMISSION_DEFAULT_HIDDEN_KEYS,
  PERMISSION_STRATEGY_OPTIONS_BY_KEY,
  PERMISSION_LEVEL_OPTIONS,
  PERMISSION_WHITELIST_ITEMS,
  PERMISSION_WHITELIST_PARENT_MAP,
  PERMISSION_WHITELIST_NODE_KEY,
  PERMISSION_SCOPE_STRATEGY_KEYS,
} from "../constants/permission.js";
import { DUTY_RL_ONCALL_SECTION_ID, DUTY_ROSTER_SECTIONS, DUTY_SPECIAL_ROTATION_SUBTABLES } from "../constants/duty.js";

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
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("[")) {
    const parts = parseLegacyModuleArray(s);
    if (parts.length) return parts.join("/");
  }
  return s
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function parseLegacyModuleArray(s) {
  try {
    const data = JSON.parse(s);
    if (Array.isArray(data)) {
      return data.map((x) => stripLegacyModuleQuotes(String(x || ""))).filter(Boolean);
    }
  } catch {
    /* 老库非标准 JSON */
  }
  const inner = s.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  const quoted = [...inner.matchAll(/["""''「『]([^"""''」』]+)["""''」』]/g)];
  if (quoted.length) {
    return quoted.map((m) => stripLegacyModuleQuotes(m[1])).filter(Boolean);
  }
  return inner
    .split(/[,，]/)
    .map((part) => stripLegacyModuleQuotes(part))
    .filter(Boolean);
}

function stripLegacyModuleQuotes(token) {
  return String(token || "")
    .trim()
    .replace(/["""''「」『』'"\u201c\u201d\u2018\u2019]/g, "")
    .trim();
}

export function splitDutyFieldCascadePath(raw) {
  return String(raw || "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 按问题引入模块路径取责任田二级模块（一级下第二层）的负责人。 */
export function resolveDutyFieldL2OwnerFromCascade(cascadeOptions, modulePath) {
  const parts = splitDutyFieldCascadePath(modulePath);
  if (parts.length < 2) return "";
  const [l1, l2] = parts;
  const roots = Array.isArray(cascadeOptions) ? cascadeOptions : [];
  const l1Node = roots.find((n) => String(n?.label || "").trim() === l1);
  if (!l1Node) return "";
  const kids = Array.isArray(l1Node.children) ? l1Node.children : [];
  const l2Node = kids.find((n) => String(n?.label || "").trim() === l2);
  return String(l2Node?.owner || "").trim();
}

export function normalizePermissionLevel(level) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, level) ? level : "hidden";
}

export function getPermissionLevelRank(level) {
  return PERMISSION_LEVEL_RANK[normalizePermissionLevel(level)];
}

/** 与后端 whitelist_field_levels_effective 一致：配置白名单仅写 is_pl=false 时，PL 用户回落到该基线。 */
export function buildEffectiveWhitelistMap(permissions, roleCode, userIsPl) {
  const rc = String(roleCode || "").trim();
  if (!rc) return {};
  const node = PERMISSION_WHITELIST_NODE_KEY;
  const pick = (pl) =>
    (permissions || []).filter(
      (x) =>
        String(x.role_code || "") === rc &&
        String(x.node_key || "") === node &&
        !!x.is_pl === !!pl,
    );
  const toMap = (rows) => {
    const out = {};
    rows.forEach((r) => {
      const fk = String(r.field_key || "").trim();
      if (fk) out[fk] = String(r.permission_level || "hidden");
    });
    return out;
  };
  const base = toMap(pick(false));
  if (!userIsPl) return base;
  return { ...base, ...toMap(pick(true)) };
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
  if (key === "assistant:ticket") return "ticket_assistant";
  if (key === "req:manage") return "requirement_list";
  if (key === "qi:manage") return "requirement_list";
  if (key.startsWith("qi-detail:")) return "requirement_list";
  if (key === "major:problem") return "major_problem_list";
  if (key === "site:profile") return "site_profile_list";
  if (key === "tool:plaza") return "tool_plaza_list";
  if (key.startsWith("tool-item:")) return "tool_plaza_list";
  if (key === "admin:permissions") return "admin_permissions";
  if (key === "admin:users") return "admin_users";
  if (key === "stats:charts") return "stats_dashboard";
  if (key === "stats:qi-analytics") return "stats_qi_analytics";
  if (key === "stats:showcase") return "stats_dashboard";
  if (key === "report:issue" || key === "report:generate" || key === "report:archive") return "monthly_report";
  if (key === "ai:assistant") return "ai_assistant";
  if (key === "ai:export") return "ai_export";
  if (key === "params:duty-field") return "params_duty_field_edit";
  if (key === "params:version") return "params_version_edit";
  if (key === "params:group-template") return "params_group_template_edit";
  if (key === "params:llm-config") return "params_llm_config";
  if (key === "params:issue-root-cause") return "params_issue_root_cause";
  if (key.startsWith("params:")) return "params_config";
  if (key === "oncall:eva") return "oncall_eva";
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
      if (PERMISSION_SCOPE_STRATEGY_KEYS.has(item.key)) {
        const parentHidden = parents.some(
          (parentKey) => getPermissionLevelRank(nextDraft[parentKey]) === PERMISSION_LEVEL_RANK.hidden
        );
        if (parentHidden && getPermissionLevelRank(nextDraft[item.key]) > PERMISSION_LEVEL_RANK.hidden) {
          nextDraft[item.key] = "hidden";
          changed = true;
        }
        return;
      }
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
  if (nextDraft.duty_roster === "editable" && nextDraft.duty_roster_edit === "readonly") {
    nextDraft.duty_roster_edit = "editable";
  }
  return { draft: nextDraft };
}

export function isDutyRosterRlOnlyView(whitelist) {
  return getWhitelistLevel("duty_roster", whitelist) === "editable";
}

export function isDutyRosterEditRlOnly(whitelist) {
  return getWhitelistLevel("duty_roster_edit", whitelist) === "editable";
}

export function getVisibleDutyRosterSectionsForWhitelist(whitelist) {
  if (isDutyRosterRlOnlyView(whitelist)) {
    return DUTY_ROSTER_SECTIONS.filter((s) => s.id === DUTY_RL_ONCALL_SECTION_ID);
  }
  return DUTY_ROSTER_SECTIONS;
}

export function dutyRosterAnchorValidForWhitelist(id, whitelist) {
  if (!id) return false;
  if (getVisibleDutyRosterSectionsForWhitelist(whitelist).some((s) => s.id === id)) return true;
  if (isDutyRosterRlOnlyView(whitelist)) return false;
  return DUTY_SPECIAL_ROTATION_SUBTABLES.some((s) => s.anchorId === id);
}
