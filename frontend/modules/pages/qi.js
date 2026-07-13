// 质量改进看板图表渲染辅助
import { escapeHtml } from "../utils/escape.js";
import { STAT_LABOR_CHART_COLORS } from "./stats.js";

export function renderQiKpiCard(label, value, sub) {
  return `<div class="stat-glass-card req-analytics-kpi"><div class="stat-glass-card-head"><div class="stat-glass-card-title">${escapeHtml(label)}</div></div><div class="req-analytics-kpi-val">${escapeHtml(String(value))}</div>${sub ? `<div class="req-analytics-kpi-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

export function renderQiHorizontalBar(items) {
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
