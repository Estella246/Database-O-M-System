/**
 * 表格列选择字段定义常量
 * 用于工作台工单列表的动态列选择功能
 */

import { EXPORT_FIELDS_BY_NODE, NODE_LABELS, NODE_ORDER } from "./export-fields.js";

// 最大列数限制
export const MAX_COLUMN_COUNT = 15;

// 默认展示列（当前表格已有的9列）
// 格式：{nodeKey, fieldKey} 支持同 key 不同节点的字段
// 日期相关字段靠前显示
export const DEFAULT_TABLE_COLUMNS = [
  { nodeKey: "system", fieldKey: "processId" },
  { nodeKey: "problem_fill", fieldKey: "start_date" },
  { nodeKey: "system", fieldKey: "slaTime" },
  { nodeKey: "system", fieldKey: "currentStage" },
  { nodeKey: "problem_fill", fieldKey: "severity" },
  { nodeKey: "problem_fill", fieldKey: "location" },
  { nodeKey: "problem_fill", fieldKey: "biz_env" },
  { nodeKey: "system", fieldKey: "currentHandler" },
  { nodeKey: "problem_fill", fieldKey: "issue_desc" },
];

// 旧版默认列 keys（兼容旧数据迁移）
const DEFAULT_TABLE_COLUMN_KEYS_OLD = [
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
 * 获取所有可选择列的总数（不去重，按节点统计）
 * @returns {number}
 */
export function getAllSelectableColumnCount() {
  let total = 0;
  NODE_ORDER.forEach((nodeKey) => {
    const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
    total += fields.length;
  });
  return total;
}

/**
 * 获取所有可选择的列配置（带节点）
 * @returns {Array<{nodeKey, fieldKey}>}
 */
export function getAllSelectableColumns() {
  const columns = [];
  NODE_ORDER.forEach((nodeKey) => {
    const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
    fields.forEach((f) => {
      columns.push({ nodeKey, fieldKey: f.key });
    });
  });
  return columns;
}

/**
 * 从 localStorage 加载列配置
 * @param {string} namespace "list" 或 "home"
 * @returns {Array<{nodeKey, fieldKey}>|null} 列配置数组
 */
export function loadColumnConfigFromStorage(namespace) {
  const storageKey = `ticket_list_columns_${namespace}`;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    // 检测旧格式（纯字符串数组），自动迁移
    if (parsed.length > 0 && typeof parsed[0] === "string") {
      // 旧格式迁移到新格式
      const migrated = migrateOldColumnKeys(parsed);
      // 保存新格式
      saveColumnConfigToStorage(namespace, migrated);
      return migrated;
    }

    // 新格式：{nodeKey, fieldKey} 数组
    return parsed.filter((item) =>
      item && typeof item === "object" && item.nodeKey && item.fieldKey
    );
  } catch (_) {
    return null;
  }
}

/**
 * 将旧版 keys 数组迁移到新版配置格式
 * @param {Array<string>} oldKeys 旧版 keys 数组
 * @returns {Array<{nodeKey, fieldKey}>} 新版配置数组
 */
function migrateOldColumnKeys(oldKeys) {
  const groups = buildColumnGroups();
  const migrated = [];

  // 映射旧 key 到新配置
  oldKeys.forEach((key) => {
    // 处理旧版 key 的别名映射
    const actualKey = OLD_KEY_ALIASES[key] || key;

    // 查找第一个包含该字段的节点（默认行为）
    for (const group of groups) {
      const field = group.fields.find((f) => f.key === actualKey);
      if (field) {
        migrated.push({ nodeKey: group.nodeKey, fieldKey: actualKey });
        break;  // 只取第一个匹配
      }
    }
  });

  return migrated;
}

// 旧版 key 别名映射
const OLD_KEY_ALIASES = {
  startDate: "start_date",
  bizEnv: "biz_env",
  description: "issue_desc",
};

/**
 * 保存列配置到 localStorage
 * @param {string} namespace "list" 或 "home"
 * @param {Array<{nodeKey, fieldKey}>} columnConfig 列配置数组
 */
export function saveColumnConfigToStorage(namespace, columnConfig) {
  const storageKey = `ticket_list_columns_${namespace}`;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(columnConfig));
  } catch (_) {
    // localStorage 写入失败，静默处理
  }
}

/**
 * 验证列配置有效性（移除无效的列配置）
 * @param {Array<{nodeKey, fieldKey}>} columnConfig 列配置数组
 * @returns {Array<{nodeKey, fieldKey}>} 有效列配置
 */
export function validateColumnConfig(columnConfig) {
  const allColumns = getAllSelectableColumns();
  return columnConfig.filter((item) =>
    allColumns.some((c) => c.nodeKey === item.nodeKey && c.fieldKey === item.fieldKey)
  );
}

/**
 * 获取默认选中的列配置
 * @returns {Array<{nodeKey, fieldKey}>}
 */
export function getDefaultSelectedColumns() {
  return [...DEFAULT_TABLE_COLUMNS];
}

/**
 * 构建表格列定义（用于渲染）
 * @param {Array<{nodeKey, fieldKey}>} columnConfig 列配置数组
 * @returns {Array<{nodeKey, fieldKey, label, fullLabel, type, stripImages}>}
 */
export function buildTableColumns(columnConfig) {
  const columns = [];
  columnConfig.forEach((item) => {
    const fields = EXPORT_FIELDS_BY_NODE[item.nodeKey] || [];
    const field = fields.find((f) => f.key === item.fieldKey);
    if (field) {
      const nodeLabel = NODE_LABELS[item.nodeKey] || item.nodeKey;
      columns.push({
        nodeKey: item.nodeKey,
        fieldKey: item.fieldKey,
        label: field.label,
        // 同 key 不同节点时，表头显示带节点前缀
        fullLabel: `${nodeLabel}-${field.label}`,
        type: field.type,
        stripImages: field.stripImages,
      });
    }
  });
  return columns;
}

/**
 * 计算分组内已选中的字段数
 * @param {Object} selectedFields {nodeKey: [fieldKeys]} 选中的字段
 * @param {string} nodeKey 节点 key
 * @returns {number}
 */
export function countSelectedInGroup(selectedFields, nodeKey) {
  const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
  const selected = selectedFields[nodeKey] || [];
  return fields.filter((f) => selected.includes(f.key)).length;
}

/**
 * 获取分组内总字段数
 * @param {string} nodeKey 节点 key
 * @returns {number}
 */
export function getGroupTotalCount(nodeKey) {
  return (EXPORT_FIELDS_BY_NODE[nodeKey] || []).length;
}