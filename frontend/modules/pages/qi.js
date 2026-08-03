// 质量改进看板图表渲染辅助
import { escapeHtml } from "../utils/escape.js";

export function renderQiKpiCard(label, value, sub) {
  return `<div class="stat-glass-card req-analytics-kpi"><div class="stat-glass-card-head"><div class="stat-glass-card-title">${escapeHtml(label)}</div></div><div class="req-analytics-kpi-val">${escapeHtml(String(value))}</div>${sub ? `<div class="req-analytics-kpi-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}
