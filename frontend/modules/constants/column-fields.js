/**
 * 表格列选择字段定义常量
 * 用于工作台工单列表的动态列选择功能
 */

import { EXPORT_FIELDS_BY_NODE, NODE_LABELS, NODE_ORDER } from "./export-fields.js";

// 最大列数限制
export const MAX_COLUMN_COUNT = 15;

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

/**
 * 构建列选择分组（统一从 EXPORT_FIELDS_BY_NODE 获取）
 * @returns {Array<{nodeKey, nodeLabel, fields}>}
 */
export function buildColumnGroups() {
  const groups = [];

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
  NODE_ORDER.forEach((nodeKey) => {
    const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
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
  // 遍历所有节点查找字段
  for (const nodeKey of NODE_ORDER) {
    const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
    const field = fields.find((f) => f.key === key);
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
  const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
  return fields.filter((f) => selectedKeys.includes(f.key)).length;
}

/**
 * 获取分组内总字段数
 * @param {string} nodeKey 节点 key
 * @returns {number}
 */
export function getGroupTotalCount(nodeKey) {
  return (EXPORT_FIELDS_BY_NODE[nodeKey] || []).length;
}