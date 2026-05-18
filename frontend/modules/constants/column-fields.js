/**
 * 表格列选择字段定义常量
 * 用于工作台工单列表、补丁管理列表的动态列选择功能
 */

import { EXPORT_FIELDS_BY_NODE, NODE_LABELS, NODE_ORDER } from "./export-fields.js";
import {
  HOTPATCH_EXPORT_FIELDS_BY_NODE,
  HOTPATCH_NODE_LABELS,
  HOTPATCH_NODE_ORDER,
} from "./hotpatch-export-fields.js";

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

/** 补丁管理列表默认展示列（与命名空间 `patch` 的 localStorage 键 `ticket_list_columns_patch` 对应） */
export const DEFAULT_PATCH_TABLE_COLUMNS = [
  { nodeKey: "system", fieldKey: "processId" },
  { nodeKey: "system", fieldKey: "currentStage" },
  { nodeKey: "system", fieldKey: "currentHandler" },
  { nodeKey: "hp_demand_fill", fieldKey: "fill_date" },
  { nodeKey: "system", fieldKey: "creatorName" },
];

/** 旧版补丁默认列 keys（localStorage 字符串数组迁移用） */
export const DEFAULT_PATCH_LIST_COLUMN_KEYS = [
  "processId",
  "currentStage",
  "currentHandler",
  "start_date",
  "creatorName",
];

/**
 * @param {string} [namespace="list"] `list` | `home` | `patch`
 */
function getColumnFieldCatalog(namespace = "list") {
  if (namespace === "patch") {
    return {
      fieldsByNode: HOTPATCH_EXPORT_FIELDS_BY_NODE,
      nodeLabels: HOTPATCH_NODE_LABELS,
      nodeOrder: HOTPATCH_NODE_ORDER,
    };
  }
  return {
    fieldsByNode: EXPORT_FIELDS_BY_NODE,
    nodeLabels: NODE_LABELS,
    nodeOrder: NODE_ORDER,
  };
}

/**
 * 构建列选择分组
 * @param {string} [namespace="list"] `list` | `home` | `patch`
 * @returns {Array<{nodeKey, nodeLabel, fields}>}
 */
export function buildColumnGroups(namespace = "list") {
  const { fieldsByNode, nodeLabels, nodeOrder } = getColumnFieldCatalog(namespace);
  const groups = [];

  nodeOrder.forEach((nodeKey) => {
    const fields = fieldsByNode[nodeKey] || [];
    groups.push({
      nodeKey,
      nodeLabel: nodeLabels[nodeKey] || nodeKey,
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
 * @param {string} [namespace="list"]
 * @returns {number}
 */
export function getAllSelectableColumnCount(namespace = "list") {
  const { fieldsByNode, nodeOrder } = getColumnFieldCatalog(namespace);
  let total = 0;
  nodeOrder.forEach((nodeKey) => {
    const fields = fieldsByNode[nodeKey] || [];
    total += fields.length;
  });
  return total;
}

/**
 * 获取所有可选择的列配置（带节点）
 * @param {string} [namespace="list"]
 * @returns {Array<{nodeKey, fieldKey}>}
 */
export function getAllSelectableColumns(namespace = "list") {
  const { fieldsByNode, nodeOrder } = getColumnFieldCatalog(namespace);
  const columns = [];
  nodeOrder.forEach((nodeKey) => {
    const fields = fieldsByNode[nodeKey] || [];
    fields.forEach((f) => {
      columns.push({ nodeKey, fieldKey: f.key });
    });
  });
  return columns;
}

/**
 * 获取默认全选字段（列选择弹窗「全选」用）
 * @param {string} [namespace="list"]
 * @returns {Object} { nodeKey: [fieldKeys] }
 */
export function getDefaultSelectedFields(namespace = "list") {
  const { fieldsByNode } = getColumnFieldCatalog(namespace);
  const selected = {};
  Object.keys(fieldsByNode).forEach((nodeKey) => {
    selected[nodeKey] = fieldsByNode[nodeKey].map((f) => f.key);
  });
  return selected;
}

/**
 * 从 localStorage 加载列配置
 * @param {string} namespace `list` | `home` | `patch`
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
      const migrated = migrateOldColumnKeys(parsed, namespace);
      saveColumnConfigToStorage(namespace, migrated);
      return migrated;
    }

    return parsed.filter((item) =>
      item && typeof item === "object" && item.nodeKey && item.fieldKey
    );
  } catch (_) {
    return null;
  }
}

// 旧版 key 别名映射（HCS 工作台）
const OLD_KEY_ALIASES = {
  startDate: "start_date",
  bizEnv: "biz_env",
  description: "issue_desc",
};

// 补丁列表旧版 key：起始日期对应诉求填写-填写日期
const PATCH_OLD_KEY_ALIASES = {
  startDate: "fill_date",
  start_date: "fill_date",
};

/**
 * 将旧版 keys 数组迁移到新版配置格式
 * @param {Array<string>} oldKeys
 * @param {string} [namespace="list"]
 * @returns {Array<{nodeKey, fieldKey}>}
 */
function migrateOldColumnKeys(oldKeys, namespace = "list") {
  const groups = buildColumnGroups(namespace);
  const migrated = [];
  const aliases = namespace === "patch"
    ? { ...OLD_KEY_ALIASES, ...PATCH_OLD_KEY_ALIASES }
    : OLD_KEY_ALIASES;

  oldKeys.forEach((key) => {
    const actualKey = aliases[key] || key;
    for (const group of groups) {
      const field = group.fields.find((f) => f.key === actualKey);
      if (field) {
        migrated.push({ nodeKey: group.nodeKey, fieldKey: actualKey });
        break;
      }
    }
  });

  return migrated;
}

/**
 * 保存列配置到 localStorage
 * @param {string} namespace `list` | `home` | `patch`
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
 * @param {Array<{nodeKey, fieldKey}>} columnConfig
 * @param {string} [namespace="list"]
 * @returns {Array<{nodeKey, fieldKey}>}
 */
export function validateColumnConfig(columnConfig, namespace = "list") {
  const allColumns = getAllSelectableColumns(namespace);
  return columnConfig.filter((item) =>
    allColumns.some((c) => c.nodeKey === item.nodeKey && c.fieldKey === item.fieldKey)
  );
}

/**
 * 获取默认选中的列配置
 * @param {string} [namespace="list"] `list` | `home` | `patch`
 * @returns {Array<{nodeKey, fieldKey}>}
 */
export function getDefaultSelectedColumns(namespace = "list") {
  if (namespace === "patch") {
    return validateColumnConfig([...DEFAULT_PATCH_TABLE_COLUMNS], namespace);
  }
  if (namespace === "home") {
    return validateColumnConfig([...DEFAULT_TABLE_COLUMNS], namespace);
  }
  return [...DEFAULT_TABLE_COLUMNS];
}

/**
 * 构建表格列定义（用于渲染）
 * @param {Array<{nodeKey, fieldKey}>} columnConfig
 * @param {string} [namespace="list"]
 * @returns {Array<{nodeKey, fieldKey, label, fullLabel, type, stripImages}>}
 */
export function buildTableColumns(columnConfig, namespace = "list") {
  const { fieldsByNode, nodeLabels } = getColumnFieldCatalog(namespace);
  const columns = [];
  columnConfig.forEach((item) => {
    const fields = fieldsByNode[item.nodeKey] || [];
    const field = fields.find((f) => f.key === item.fieldKey);
    if (field) {
      const nodeLabel = nodeLabels[item.nodeKey] || item.nodeKey;
      columns.push({
        nodeKey: item.nodeKey,
        fieldKey: item.fieldKey,
        label: field.label,
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
 * @param {Object} selectedFields {nodeKey: [fieldKeys]}
 * @param {string} nodeKey
 * @param {string} [namespace="list"]
 * @returns {number}
 */
export function countSelectedInGroup(selectedFields, nodeKey, namespace = "list") {
  const { fieldsByNode } = getColumnFieldCatalog(namespace);
  const fields = fieldsByNode[nodeKey] || [];
  const selected = selectedFields[nodeKey] || [];
  return fields.filter((f) => selected.includes(f.key)).length;
}

/**
 * 获取分组内总字段数
 * @param {string} nodeKey
 * @param {string} [namespace="list"]
 * @returns {number}
 */
export function getGroupTotalCount(nodeKey, namespace = "list") {
  const { fieldsByNode } = getColumnFieldCatalog(namespace);
  return (fieldsByNode[nodeKey] || []).length;
}
