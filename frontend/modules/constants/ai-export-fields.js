/**
 * AI Export (深度分析) 导出字段定义 — 复用工作台导出的 92 字段结构，
 * 加上 AI 专属扩展 system 字段（closed_at, created_at）。
 *
 * 原来的 AI_EXPORT_FIELD_GROUPS（9 字段）和 AI_EXPORT_COLUMNS（22 条目）已删除，
 * 统一使用 export-fields.js 的 EXPORT_FIELDS_BY_NODE + NODE_LABELS + NODE_ORDER。
 */

import {
  EXPORT_FIELDS_BY_NODE,
  NODE_LABELS,
  NODE_ORDER,
  EXPORT_SYSTEM_FIELDS,
  getTotalFieldsCount,
  getDefaultSelectedFields,
  countSelectedFields,
  buildExportColumns,
} from "./export-fields.js";

// ── AI Export 专属扩展 system 字段 ──
// 工作台导出的 EXPORT_SYSTEM_FIELDS 只有 5 个（不含 closed_at、created_at），
// AI Export 需要额外支持这两个字段
export const AI_EXPORT_SYSTEM_FIELDS_EXTRA = [
  { key: "closed_at", label: "关闭时间", type: "system" },
  { key: "created_at", label: "创建时间", type: "system" },
];

// AI Export 完整 system 字段列表 = EXPORT_SYSTEM_FIELDS + AI_EXPORT_SYSTEM_FIELDS_EXTRA
export const AI_EXPORT_SYSTEM_FIELDS_ALL = [...EXPORT_SYSTEM_FIELDS, ...AI_EXPORT_SYSTEM_FIELDS_EXTRA];

// Override the system node in EXPORT_FIELDS_BY_NODE for AI Export use
// (the original EXPORT_FIELDS_BY_NODE.system is EXPORT_SYSTEM_FIELDS with 5 fields)
export const AI_EXPORT_FIELDS_BY_NODE = {
  ...EXPORT_FIELDS_BY_NODE,
  system: AI_EXPORT_SYSTEM_FIELDS_ALL,
};

// ── AI Export 总字段数（含扩展 system 字段）──
// Original: 5 system + 9 + 4 + 30 + 20 + 6 + 13 + 5 = 92
// Extended: 7 system (5+2) + 9 + 4 + 30 + 20 + 6 + 13 + 5 = 94
export function getAIExportTotalFieldsCount() {
  return Object.values(AI_EXPORT_FIELDS_BY_NODE).reduce(
    (sum, fields) => sum + fields.length,
    0
  );
}

// ── AI Export 默认选中字段（全部选中）──
export function getAIExportDefaultSelectedFields() {
  const selected = {};
  Object.keys(AI_EXPORT_FIELDS_BY_NODE).forEach((nodeKey) => {
    selected[nodeKey] = AI_EXPORT_FIELDS_BY_NODE[nodeKey].map((f) => f.key);
  });
  return selected;
}

// ── AI Export 常用预选字段（Step 2 初始推荐勾选）──
// 只预选最常用的 5 个字段，避免全选 94 个字段
export const AI_EXPORT_DEFAULT_PRESELECTED = {
  system: ["processId", "currentStage", "currentHandler", "creatorName", "created_at"],
  problem_fill: ["location", "severity", "issue_desc"],
};

// ── AI Export Step 1 示例提示 ──
export const AI_EXPORT_EXAMPLE_PROMPTS = [
  "最近一周的所有工单",
  "本月严重性为致命或严重的工单",
  "产品线为5G且当前阶段为处理中的工单",
  "过去三个月局点包含'华为云'的工单",
];

// ── Re-export helpers from export-fields.js (for convenience) ──
export {
  NODE_LABELS,
  NODE_ORDER,
  countSelectedFields,
  buildExportColumns,
};