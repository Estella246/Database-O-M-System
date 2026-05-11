/**
 * oncall 评议页面纯函数：
 * - 周期默认值与选项
 * - 加分项类目元数据（与后端 EXTRA_CATEGORIES 对齐）
 * - 档位归类（SLA / 独立闭环率）
 * - 文本与数字格式化
 */

export const ONCALL_EVA_DEFAULT_TAB = "scores";

export const ONCALL_EVA_EXTRA_CATEGORIES = [
  { key: "efficiency", label: "效率提升", per_item: 5 },
  { key: "enablement", label: "赋能", per_item: 4 },
  { key: "knowledge", label: "知识沉淀", per_item: 4 },
  { key: "public", label: "公共事务", per_item: 4 },
  { key: "travel", label: "出差现场", per_item: 4 },
  { key: "other", label: "其他", per_item: 3 },
];

// 主题色系（与 CSS 中的语义色保持一致）
export const ONCALL_EVA_PALETTE = {
  sla: "#4F7CFF",
  closure: "#8B5CF6",
  ticket: "#14B8A6",
  extra: "#F59E0B",
  red: "#EF4444",
  black: "#475569",
  muted: "#A8B0BD",
};

export function getDefaultEvaPeriod(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function formatEvaPeriodLabel(period) {
  if (!period) return "";
  const m = String(period.month || 1).padStart(2, "0");
  return `${period.year}-${m}`;
}

export function buildPeriodOptions(currentYear, currentMonth, span = 24) {
  const out = [];
  let y = currentYear;
  let m = currentMonth;
  for (let i = 0; i < span; i += 1) {
    out.push({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function formatNumber(n, digits = 2) {
  if (n == null || isNaN(n)) return "--";
  return Number(n).toFixed(digits);
}

export function formatHoursDhM(hours) {
  if (hours == null || isNaN(hours)) return "--";
  const totalMin = Math.round(Number(hours) * 60);
  const days = Math.floor(totalMin / (60 * 24));
  const restAfterDays = totalMin - days * 60 * 24;
  const hh = Math.floor(restAfterDays / 60);
  const mm = restAfterDays - hh * 60;
  if (days > 0) return `${days}d ${hh}h ${mm}m`;
  if (hh > 0) return `${hh}h ${mm}m`;
  return `${mm}m`;
}

export function slaTierKey(avgHours) {
  if (avgHours == null) return "none";
  if (avgHours <= 24) return "lt24";
  if (avgHours <= 48) return "lt48";
  if (avgHours <= 72) return "lt72";
  return "gt72";
}

export const SLA_TIER_META = {
  lt24: { label: "≤24h", base: 100, color: "#10B981" },
  lt48: { label: "≤48h", base: 80, color: "#4F7CFF" },
  lt72: { label: "≤72h", base: 60, color: "#F59E0B" },
  gt72: { label: ">72h", base: 30, color: "#EF4444" },
  none: { label: "无数据", base: 0, color: "#A8B0BD" },
};

export function describeSlaTier(avgHours) {
  const key = slaTierKey(avgHours);
  const m = SLA_TIER_META[key];
  return key === "none" ? m.label : `${m.label}（基础分 ${m.base}）`;
}

export function closureTierKey(ratePct) {
  if (ratePct == null) return "none";
  if (ratePct >= 90) return "excellent";
  if (ratePct >= 70) return "passing";
  return "poor";
}

export const CLOSURE_TIER_META = {
  excellent: { label: "≥90% 优秀", color: "#10B981" },
  passing: { label: "70%~90% 合格", color: "#4F7CFF" },
  poor: { label: "<70% 待改进", color: "#EF4444" },
  none: { label: "无数据", color: "#A8B0BD" },
};

export function describeClosureTier(ratePct) {
  if (ratePct == null) return "无数据";
  if (ratePct >= 90) return "≥90%（满分）";
  if (ratePct >= 70) return "70%~90%（线性插值）";
  return "<70%（基础分 60）";
}

export function categoryLabel(key) {
  const m = ONCALL_EVA_EXTRA_CATEGORIES.find((c) => c.key === key);
  return m ? m.label : key;
}

export function categoryPerItemCap(key) {
  const m = ONCALL_EVA_EXTRA_CATEGORIES.find((c) => c.key === key);
  return m ? m.per_item : 0;
}

export function personDisplayName(item) {
  if (!item) return "—";
  return String(item.user_name || item.account || "—");
}

export function ticketAchievementPct(metrics, threshold) {
  const cnt = Number(metrics?.ticket_count || 0);
  const base = Number(threshold || 0);
  if (base <= 0) return cnt > 0 ? 100 : 0;
  return Math.min(100, (cnt / base) * 100);
}
