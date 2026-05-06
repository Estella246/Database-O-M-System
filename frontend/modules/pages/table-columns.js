import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { listPreviewText, formatTicketSlaDhM, ticketListFilterDisplayValue } from "../utils/format.js";
import { normalizeIssueSeverity, severityPillClass } from "../utils/normalize.js";
import {
  loadColumnConfigFromStorage,
  getDefaultSelectedColumns,
  validateColumnKeys,
  getColumnDefinition,
} from "../constants/column-fields.js";
import { TICKET_LIST_FILTER_KEYS } from "../constants/workflow.js";

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
  const columns = columnKeys.map((key) => getColumnDefinition(key)).filter(Boolean);

  // 按优先级排序：流程ID -> 日期字段 -> 其他字段
  return sortColumnsByPriority(columns);
}

/**
 * 按优先级排序列：流程ID优先，日期字段次优先
 * @param {Array<Object>} columns 列定义数组
 * @returns {Array<Object>} 排序后的列定义数组
 */
function sortColumnsByPriority(columns) {
  // 日期类字段 keys
  const dateKeys = ["startDate", "start_date", "slaTime", "kernel_upgrade_time"];

  return columns.sort((a, b) => {
    // 流程ID始终在最前
    if (a.key === "processId") return -1;
    if (b.key === "processId") return 1;

    // 日期字段排在流程ID之后
    const aIsDate = dateKeys.includes(a.key) || a.type === "date";
    const bIsDate = dateKeys.includes(b.key) || b.type === "date";
    if (aIsDate && !bIsDate) return -1;
    if (!aIsDate && bIsDate) return 1;

    // 同类型保持原顺序
    return 0;
  });
}

/**
 * 获取工单列值
 * @param {Object} ticket 工单数据
 * @param {Object} col 列定义
 * @returns {Object} { display: string, fullText: string } 显示值和完整文本
 */
export function getTicketColumnValue(ticket, col) {
  const { key, type } = col;
  let display = "";
  let fullText = "";

  // 系统字段特殊处理
  if (key === "processId") {
    display = String(ticket.processId || ticket.orderId || "");
    fullText = display;
    return { display, fullText };
  }
  if (key === "currentStage") {
    display = String((ticket.currentStage ?? ticket.node) || "");
    fullText = display;
    return { display, fullText };
  }
  if (key === "currentHandler") {
    display = String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
    fullText = display;
    return { display, fullText };
  }
  if (key === "slaTime") {
    display = formatTicketSlaDhM(ticket);
    fullText = display;
    return { display, fullText };
  }

  // 默认列字段（从 ticket 对象直接取值）
  if (key === "startDate" || key === "start_date") {
    display = String(ticket.startDate || "");
    fullText = display;
    return { display, fullText };
  }
  if (key === "severity") {
    const sevLabel = normalizeIssueSeverity(ticket.severity ?? ticket.priority);
    const sevClass = severityPillClass(sevLabel);
    display = `<span class="p ${sevClass}">${escapeHtml(sevLabel)}</span>`;
    fullText = sevLabel;
    return { display, fullText };
  }
  if (key === "location") {
    display = String(ticket.location || "");
    fullText = display;
    return { display, fullText };
  }
  if (key === "bizEnv" || key === "biz_env") {
    display = String(ticket.bizEnv || "");
    fullText = display;
    return { display, fullText };
  }
  if (key === "description" || key === "issue_desc") {
    fullText = ticket.description || "--";
    display = listPreviewText(fullText, 200);
    return { display, fullText };
  }

  // 使用 ticketListFilterDisplayValue 获取可筛选字段的值
  if (TICKET_LIST_FILTER_KEYS.includes(key)) {
    display = ticketListFilterDisplayValue(ticket, key);
    fullText = display;
    return { display, fullText };
  }

  // 其他扩展字段：阶段一暂不支持，返回空
  return { display: "", fullText: "" };
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

  const thHtml = columns
    .map((col) => {
      // 可筛选字段：使用筛选器渲染
      if (TICKET_LIST_FILTER_KEYS.includes(col.key)) {
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
      const { display, fullText } = getTicketColumnValue(ticket, col);
      // 特殊列添加 class
      let cellClass = "";
      if (col.key === "description" || col.key === "issue_desc") {
        cellClass = "ticket-desc-cell";
      } else if (col.key === "slaTime") {
        cellClass = "ticket-sla-cell";
      }
      // 如果显示值与完整文本不同，添加 title 属性用于悬停显示
      const needTooltip = display !== fullText && fullText.length > display.length;
      const titleAttr = needTooltip ? ` title="${escapeAttr(fullText)}"` : "";
      return `<td${cellClass ? ` class="${cellClass}"` : ""}${titleAttr}>${display}</td>`;
    })
    .join("");

  return checkboxHtml + cellsHtml;
}