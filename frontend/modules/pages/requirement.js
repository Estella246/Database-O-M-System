import { escapeHtml } from "../utils/escape.js";
import { STAT_LABOR_CHART_COLORS } from "./stats.js";

export const FLOW_VISIT_CONTEXT_KEY = "__flow_visited";

const FLOW_VISIT_ALIASES = {
  ops_closure: new Set(["ops_closure", "运维闭环"]),
  运维闭环: new Set(["ops_closure", "运维闭环"]),
};

export function flowVisitedContains(visited, required) {
  if (!Array.isArray(required) || !required.length) return true;
  const tokens = new Set();
  if (Array.isArray(visited)) {
    visited.forEach((x) => {
      const t = String(x || "").trim();
      if (t && t !== "-") tokens.add(t);
    });
  } else if (typeof visited === "string") {
    const t = visited.trim();
    if (t && t !== "-") tokens.add(t);
  }
  return required.every((need) => {
    const n = String(need || "").trim();
    if (!n) return true;
    const candidates = new Set(FLOW_VISIT_ALIASES[n] || [n]);
    candidates.add(n);
    for (const c of candidates) {
      if (tokens.has(c)) return true;
    }
    return false;
  });
}

export function fieldVisible(field, vals) {
  if (field.key === "next_handler" && String(vals.handle_mode || "") === "问题解决关闭") {
    return false;
  }
  const c = field.constraints || {};
  const rules = c.visible_when_all;
  if (rules && rules.length) {
    const allMatch = rules.every((r) => {
      const v = vals[r.field];
      return (r.values || []).includes(v);
    });
    if (!allMatch) return false;
  }
  const need = c.visible_when_flow_visited;
  if (Array.isArray(need) && need.length) {
    if (!flowVisitedContains(vals[FLOW_VISIT_CONTEXT_KEY], need)) return false;
  }
  return true;
}

export function matchesRequiredIf(requiredIf, vals) {
  if (!requiredIf || typeof requiredIf !== "object") return false;
  return Object.entries(requiredIf).every(([depKey, expected]) => {
    const actual = vals[depKey];
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

export function optionalWhenAllMatches(c, vals) {
  const rules = c.optional_when_all;
  if (!rules || !rules.length) return false;
  return rules.every((r) => (r.values || []).includes(vals[r.field]));
}

export function optionalWhenAnyMatches(c, vals) {
  const rules = c.optional_when_any;
  if (!rules || !rules.length) return false;
  return rules.some((r) => (r.values || []).includes(vals[r.field]));
}

export function fieldEffectiveRequired(field, vals) {
  const c = field.constraints || {};
  if (!fieldVisible(field, vals)) return false;
  if (optionalWhenAnyMatches(c, vals) || optionalWhenAllMatches(c, vals)) return false;
  if (c.required_when_visible) return true;
  if (c.required_if && Object.keys(c.required_if).length) {
    return matchesRequiredIf(c.required_if, vals);
  }
  return !!field.required;
}

export function renderReqAnalyticsKpiCard(label, value, sub) {
  return `<div class="stat-glass-card req-analytics-kpi"><div class="stat-glass-card-head"><div class="stat-glass-card-title">${escapeHtml(label)}</div></div><div class="req-analytics-kpi-val">${escapeHtml(String(value))}</div>${sub ? `<div class="req-analytics-kpi-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

export function renderReqAnalyticsHorizontalBar(items, opts = {}) {
  const maxVal = Math.max(1, ...items.map((it) => it.count));
  const bars = items.map((it, i) => {
    const pct = Math.max(4, Math.round((it.count / maxVal) * 100));
    const c = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
    return `<div class="req-analytics-hbar-row">
      <span class="req-analytics-hbar-label">${escapeHtml(String(it.name || it.label || ""))}</span>
      <div class="req-analytics-hbar-track"><div class="req-analytics-hbar-fill" style="width:${pct}%;background:${c}"></div></div>
      <span class="req-analytics-hbar-val">${it.count}</span>
    </div>`;
  }).join("");
  return `<div class="req-analytics-hbar">${bars}</div>`;
}
