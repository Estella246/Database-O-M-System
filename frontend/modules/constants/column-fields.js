/**
 * 表格列选择字段定义常量
 * 用于工作台工单列表的动态列选择功能
 */

import { EXPORT_FIELDS_BY_NODE, NODE_LABELS, NODE_ORDER } from "./export-fields.js";

// 最大列数限制
export const MAX_COLUMN_COUNT = 15;

// 系统字段（不在导出字段定义中，需要单独处理）
// 这些字段是 ticket 对象中直接存在的，不需要从节点数据获取
export const SYSTEM_COLUMNS = [
  { key: "processId", label: "流程ID", type: "system", nodeKey: "system" },
  { key: "currentStage", label: "当前阶段", type: "system", nodeKey: "system" },
  { key: "currentHandler", label: "当前处理人", type: "system", nodeKey: "system" },
  { key: "slaTime", label: "SLA时间", type: "system", nodeKey: "system" },
];

// 默认展示列（当前表格已有的9列）
// 日期相关字段靠前显示
export const DEFAULT_TABLE_COLUMN_KEYS = [
  "processId",
  "startDate",
  "slaTime",
  "currentStage",
  "severity",
  "location",
  "bizEnv",
  "currentHandler",
  "description",
];

// 问题填写节点中与默认列重叠的字段映射
// 用于从 ticket 对象取值时的字段名转换
export const TICKET_FIELD_MAP = {
  startDate: "startDate",        // ticket.startDate
  severity: "severity",          // ticket.severity
  location: "location",          // ticket.location
  bizEnv: "bizEnv",              // ticket.bizEnv
  description: "description",    // ticket.description
};

/**
 * 构建列选择分组（系统字段 + 各节点字段）
 * @returns {Array<{nodeKey, nodeLabel, fields}>}
 */
export function buildColumnGroups() {
  const groups = [
    {
      nodeKey: "system",
      nodeLabel: "系统字段",
      fields: SYSTEM_COLUMNS,
    },
  ];

  NODE_ORDER.forEach((nodeKey) => {
    const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
    groups.push({
      nodeKey,
      nodeLabel: NODE_LABELS[nodeKey] || nodeKey,
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        nodeKey,
        stripImages: f.stripImages,
      })),
    });
  });

  return groups;
}

/**
 * 获取所有可选择列的 keys
 * @returns {Set<string>}
 */
export function getAllSelectableColumnKeys() {
  const keys = new Set();
  SYSTEM_COLUMNS.forEach((c) => keys.add(c.key));
  Object.values(EXPORT_FIELDS_BY_NODE).forEach((fields) => {
    fields.forEach((f) => keys.add(f.key));
  });
  return keys;
}

/**
 * 获取列定义
 * @param {string} key 列 key
 * @returns {Object|null} 列定义
 */
export function getColumnDefinition(key) {
  // 先查系统字段
  const sysCol = SYSTEM_COLUMNS.find((c) => c.key === key);
  if (sysCol) return sysCol;

  // 再查各节点字段
  for (const nodeKey of Object.keys(EXPORT_FIELDS_BY_NODE)) {
    const field = EXPORT_FIELDS_BY_NODE[nodeKey].find((f) => f.key === key);
    if (field) {
      return {
        key: field.key,
        label: field.label,
        type: field.type,
        nodeKey,
        stripImages: field.stripImages,
      };
    }
  }

  return null;
}

/**
 * 从 localStorage 加载列配置
 * @param {string} namespace "list" 或 "home"
 * @returns {Array<string>|null} 列 keys 数组
 */
export function loadColumnConfigFromStorage(namespace) {
  const storageKey = `ticket_list_columns_${namespace}`;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * 保存列配置到 localStorage
 * @param {string} namespace "list" 或 "home"
 * @param {Array<string>} columnKeys 列 keys 数组
 */
export function saveColumnConfigToStorage(namespace, columnKeys) {
  const storageKey = `ticket_list_columns_${namespace}`;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(columnKeys));
  } catch (_) {
    // localStorage 写入失败，静默处理
  }
}

/**
 * 验证列配置有效性（移除无效的列 key）
 * @param {Array<string>} columnKeys 列 keys 数组
 * @returns {Array<string>} 有效列 keys
 */
export function validateColumnKeys(columnKeys) {
  const allKeys = getAllSelectableColumnKeys();
  return columnKeys.filter((k) => allKeys.has(k));
}

/**
 * 获取默认选中的列 keys
 * @returns {Array<string>}
 */
export function getDefaultSelectedColumns() {
  return [...DEFAULT_TABLE_COLUMN_KEYS];
}

/**
 * 计算分组内已选中的字段数
 * @param {Array<string>} selectedKeys 选中的列 keys
 * @param {string} nodeKey 节点 key
 * @returns {number}
 */
export function countSelectedInGroup(selectedKeys, nodeKey) {
  if (nodeKey === "system") {
    return SYSTEM_COLUMNS.filter((c) => selectedKeys.includes(c.key)).length;
  }
  const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
  return fields.filter((f) => selectedKeys.includes(f.key)).length;
}

/**
 * 获取分组内总字段数
 * @param {string} nodeKey 节点 key
 * @returns {number}
 */
export function getGroupTotalCount(nodeKey) {
  if (nodeKey === "system") {
    return SYSTEM_COLUMNS.length;
  }
  return (EXPORT_FIELDS_BY_NODE[nodeKey] || []).length;
}