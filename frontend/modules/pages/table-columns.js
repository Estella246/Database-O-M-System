import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { listPreviewText, formatTicketSlaDhM } from "../utils/format.js";
import { normalizeIssueSeverity, severityPillClass } from "../utils/normalize.js";
import {
  loadColumnConfigFromStorage,
  getDefaultSelectedColumns,
  validateColumnKeys,
  getColumnDefinition,
  SYSTEM_COLUMNS,
} from "../constants/column-fields.js";

/**
 * 获取当前表格列配置
 * @param {string} namespace "list" 或 "home"
 * @returns {Array<Object>} 列定义数组
 */
export function getCurrentTableColumns(namespace) {
  let columnKeys = loadColumnConfigFromStorage(namespace);
  if (!columnKeys) {
    columnKeys = getDefaultSelectedColumns();
  }
  columnKeys = validateColumnKeys(columnKeys);

  // 转换为列定义数组
  return columnKeys.map((key) => getColumnDefinition(key)).filter(Boolean);
}

/**
 * 获取工单列值
 * @param {Object} ticket 工单数据
 * @param {Object} col 列定义
 * @returns {string} 显示值（可能包含 HTML）
 */
export function getTicketColumnValue(ticket, col) {
  const { key, type } = col;

  // 系统字段特殊处理
  if (key === "processId") {
    return String(ticket.processId || ticket.orderId || "");
  }
  if (key === "currentStage") {
    return String((ticket.currentStage ?? ticket.node) || "");
  }
  if (key === "currentHandler") {
    return String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
  }
  if (key === "slaTime") {
    return formatTicketSlaDhM(ticket);
  }

  // 默认列字段（从 ticket 对象直接取值）
  if (key === "startDate" || key === "start_date") {
    return String(ticket.startDate || "");
  }
  if (key === "severity") {
    const sevLabel = normalizeIssueSeverity(ticket.severity ?? ticket.priority);
    const sevClass = severityPillClass(sevLabel);
    return `<span class="p ${sevClass}">${escapeHtml(sevLabel)}</span>`;
  }
  if (key === "location") {
    return String(ticket.location || "");
  }
  if (key === "bizEnv" || key === "biz_env") {
    return String(ticket.bizEnv || "");
  }
  if (key === "description" || key === "issue_desc") {
    return listPreviewText(ticket.description || "--", 200);
  }

  // 其他扩展字段：阶段一暂不支持，返回空字符串
  // 阶段二可从后端获取节点数据
  return "";
}

/**
 * 渲染动态表头
 * @param {Array} allTickets 用于筛选的数据源
 * @param {string} namespace "list" 或 "home"
 * @param {Function} renderFilterHeader 筛选器渲染函数
 * @returns {string} 表头 HTML
 */
export function renderDynamicTableHeader(allTickets, namespace, renderFilterHeader) {
  const columns = getCurrentTableColumns(namespace);
  const filterPrefix = namespace === "home" ? "home-" : "";

  // 可筛选的字段 keys
  const filterableKeys = ["currentStage", "startDate", "severity", "location", "bizEnv", "currentHandler", "description"];

  const thHtml = columns
    .map((col) => {
      // 可筛选字段：使用筛选器渲染
      if (filterableKeys.includes(col.key)) {
        return renderFilterHeader(col.label, col.key, allTickets, namespace);
      }
      // 其他字段：直接渲染 th
      return `<th>${escapeHtml(col.label)}</th>`;
    })
    .join("");

  return `
    <th style="width:36px;"><input type="checkbox" id="${filterPrefix}select-all-tickets" aria-label="全选工单" /></th>
    ${thHtml}`;
}

/**
 * 渲染动态表格行单元格
 * @param {Object} ticket 工单数据
 * @param {string} namespace "list" 或 "home"
 * @param {Set} selectedSet 已选中的工单 ID 集合
 * @returns {string} 单元格 HTML
 */
export function renderDynamicTableRowCells(ticket, namespace, selectedSet) {
  const columns = getCurrentTableColumns(namespace);
  const filterPrefix = namespace === "home" ? "home-" : "";
  const orderId = ticket.orderId || "";

  // 选择列
  const checkboxHtml = `<td><input type="checkbox" data-${filterPrefix}ticket-select="${escapeAttr(orderId)}" ${selectedSet.has(orderId) ? "checked" : ""} aria-label="选择工单 ${escapeAttr(orderId)}" /></td>`;

  // 数据列
  const cellsHtml = columns
    .map((col) => {
      const value = getTicketColumnValue(ticket, col);
      // 特殊列添加 class
      let cellClass = "";
      if (col.key === "description" || col.key === "issue_desc") {
        cellClass = "ticket-desc-cell";
      } else if (col.key === "slaTime") {
        cellClass = "ticket-sla-cell";
      }
      return `<td${cellClass ? ` class="${cellClass}"` : ""}>${value}</td>`;
    })
    .join("");

  return checkboxHtml + cellsHtml;
}