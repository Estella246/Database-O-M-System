import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { listPreviewText, formatTicketSlaDhM, ticketListFilterDisplayValue } from "../utils/format.js";
import { normalizeIssueSeverity, severityPillClass } from "../utils/normalize.js";
import { getCurrentWhitelistSettings } from "../core/auth.js";
import {
  loadColumnConfigFromStorage,
  getDefaultSelectedColumns,
  validateColumnConfig,
  buildTableColumns,
  saveColumnConfigToStorage,
  getWorkbenchColumnAllowedNodeKeys,
} from "../constants/column-fields.js";
import { TICKET_LIST_FILTER_KEYS } from "../constants/workflow.js";
import {
  isTicketListColumnFilterable,
  ticketListColumnFilterKey,
  STAGE_HANDLER_FIELD_KEY,
} from "../constants/column-fields.js";

/**
 * 获取当前表格列配置
 * @param {string} namespace `list` | `home` | `patch`（补丁管理与工作台共用表格组件，`patch` 使用独立默认列与 localStorage）
 * @returns {Array<Object>} 列定义数组（包含 nodeKey, fieldKey, label, fullLabel 等）
 */
export function getCurrentTableColumns(namespace) {
  const allowedNodeKeys = getWorkbenchColumnAllowedNodeKeys(getCurrentWhitelistSettings(), namespace);
  let columnConfig = loadColumnConfigFromStorage(namespace);
  if (!columnConfig || columnConfig.length === 0) {
    columnConfig = getDefaultSelectedColumns(namespace, allowedNodeKeys);
  }
  columnConfig = validateColumnConfig(columnConfig, namespace, allowedNodeKeys);
  // 曾保存的列若已全部失效（字段/节点变更、脏数据），校验后会变空，仅剩下勾选列
  if (!columnConfig.length) {
    columnConfig = getDefaultSelectedColumns(namespace, allowedNodeKeys);
    saveColumnConfigToStorage(namespace, columnConfig);
  }

  // 转换为列定义数组（带节点信息）
  let columns = buildTableColumns(columnConfig, namespace);
  // 与 validate 口径不一致或字段定义变更时，build 可能得到空数组
  if (!columns.length) {
    columnConfig = getDefaultSelectedColumns(namespace, allowedNodeKeys);
    saveColumnConfigToStorage(namespace, columnConfig);
    columns = buildTableColumns(columnConfig, namespace);
  }

  // 补丁列表：保持与默认/用户配置一致的列序；工作台/主页仍按流程ID、日期类优先排序
  if (namespace === "patch") {
    return columns;
  }
  return sortColumnsByPriority(columns);
}

/**
 * 按优先级排序列：流程ID优先，日期字段次优先
 * @param {Array<Object>} columns 列定义数组（包含 nodeKey, fieldKey）
 * @returns {Array<Object>} 排序后的列定义数组
 */
function sortColumnsByPriority(columns) {
  // 日期类字段 keys
  const dateKeys = ["start_date", "slaTime", "kernel_upgrade_time"];

  return columns.sort((a, b) => {
    // 流程ID始终在最前
    if (a.nodeKey === "system" && a.fieldKey === "processId") return -1;
    if (b.nodeKey === "system" && b.fieldKey === "processId") return 1;

    // 日期字段排在流程ID之后
    const aIsDate = dateKeys.includes(a.fieldKey) || a.type === "date";
    const bIsDate = dateKeys.includes(b.fieldKey) || b.type === "date";
    if (aIsDate && !bIsDate) return -1;
    if (!aIsDate && bIsDate) return 1;

    // 同类型保持原顺序
    return 0;
  });
}

/**
 * 获取工单列值
 * @param {Object} ticket 工单数据
 * @param {Object} col 列定义（包含 nodeKey, fieldKey 等）
 * @returns {Object} { display: string, fullText: string } 显示值和完整文本
 */
export function getTicketColumnValue(ticket, col) {
  const { nodeKey, fieldKey, type, stripImages } = col;
  let display = "";
  let fullText = "";

  // 系统字段特殊处理（nodeKey === "system"）
  if (nodeKey === "system") {
    if (fieldKey === "processId") {
      display = String(ticket.processId || ticket.orderId || "");
      fullText = display;
      return { display, fullText };
    }
    if (fieldKey === "currentStage") {
      display = String((ticket.currentStage ?? ticket.node) || "");
      fullText = display;
      return { display, fullText };
    }
    if (fieldKey === "currentHandler") {
      display = String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
      fullText = display;
      return { display, fullText };
    }
    if (fieldKey === "slaTime") {
      display = formatTicketSlaDhM(ticket);
      fullText = display;
      return { display, fullText };
    }
  }
  if (fieldKey === "creatorName") {
    display = String(ticket.creatorName ?? ticket.creator_name ?? "").trim();
    fullText = display;
    return { display, fullText };
  }

  // 默认列字段（从 ticket 对象直接取值，用于向后兼容）
  if (fieldKey === "startDate" || fieldKey === "start_date" || fieldKey === "fill_date") {
    display = String(ticket.startDate || ticket.start_date || ticket.fill_date || "").trim();
    fullText = display;
    return { display, fullText };
  }
  if (fieldKey === "severity") {
    const sevLabel = normalizeIssueSeverity(ticket.severity ?? ticket.priority);
    const sevClass = severityPillClass(sevLabel);
    display = `<span class="p ${sevClass}">${escapeHtml(sevLabel)}</span>`;
    fullText = sevLabel;
    return { display, fullText };
  }
  if (fieldKey === "location") {
    display = String(ticket.location || "").trim();
    fullText = display;
    return { display, fullText };
  }
  if (fieldKey === "bizEnv" || fieldKey === "biz_env") {
    display = String(ticket.bizEnv || ticket.biz_env || "").trim();
    fullText = display;
    return { display, fullText };
  }
  if (fieldKey === "description" || fieldKey === "issue_desc") {
    fullText = ticket.description || ticket.issue_desc || "--";
    display = listPreviewText(fullText, 200);
    return { display, fullText };
  }

  // 使用 ticketListFilterDisplayValue 获取可筛选字段的值
  if (TICKET_LIST_FILTER_KEYS.includes(fieldKey)) {
    display = ticketListFilterDisplayValue(ticket, fieldKey);
    fullText = display;
    return { display, fullText };
  }

  // 按节点获取字段值（优先从 _fieldsByNode 获取）
  const fieldsByNode = ticket._fieldsByNode || {};
  const nodeFields = fieldsByNode[nodeKey] || {};
  let rawValue = nodeFields[fieldKey];

  // 如果按节点没找到，尝试从扁平化的 ticket 对象获取（向后兼容）
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    rawValue = ticket[fieldKey];
  }

  if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
    // richtext 类型：去除 HTML 标签，截断显示
    if (type === "richtext" || stripImages) {
      fullText = String(rawValue).trim();
      display = listPreviewText(fullText, 200);
      return { display, fullText };
    }
    // date 类型：直接显示
    if (type === "date") {
      display = String(rawValue).trim().slice(0, 10);
      fullText = display;
      return { display, fullText };
    }
    // whitelist / text 类型：直接显示
    display = String(rawValue).trim();
    fullText = display;
    return { display, fullText };
  }

  // 无数据时显示（空）
  return { display: "（空）", fullText: "" };
}

/**
 * 渲染动态表头
 * @param {Array} allTickets 用于筛选的数据源
 * @param {string} namespace `list` | `home` | `patch`
 * @param {Function} renderFilterHeader 筛选器渲染函数
 * @returns {string} 表头 HTML
 */
export function renderDynamicTableHeader(allTickets, namespace, renderFilterHeader) {
  const columns = getCurrentTableColumns(namespace);
  const filterPrefix = namespace === "home" ? "home-" : "";

  const thHtml = columns
    .map((col) => {
      // 可筛选字段：使用筛选器渲染（下拉/whitelist/各阶段处理人；富文本与起始日期等除外）
      if (isTicketListColumnFilterable(col)) {
        const filterKey = ticketListColumnFilterKey(col);
        // 各阶段处理人表头用「节点-处理人」，避免多列同名混淆
        const headerLabel =
          col.fieldKey === STAGE_HANDLER_FIELD_KEY ? col.fullLabel || col.label : col.label;
        return renderFilterHeader(headerLabel, filterKey, allTickets, namespace);
      }
      // 其他字段：直接渲染 th（使用 fullLabel 或 label）
      const headerLabel = col.fullLabel || col.label;
      return `<th>${escapeHtml(headerLabel)}</th>`;
    })
    .join("");

  return `
    <th style="width:36px;"><input type="checkbox" id="${filterPrefix}select-all-tickets" aria-label="全选工单" /></th>
    ${thHtml}`;
}

/**
 * 渲染动态表格行单元格
 * @param {Object} ticket 工单数据
 * @param {string} namespace `list` | `home` | `patch`
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
      if (col.fieldKey === "description" || col.fieldKey === "issue_desc") {
        cellClass = "ticket-desc-cell";
      } else if (col.fieldKey === "slaTime") {
        cellClass = "ticket-sla-cell";
      }
      const fullTextAttr =
        fullText && String(fullText).trim() && String(fullText).trim() !== "（空）"
          ? ` data-cell-full-text="${escapeAttr(String(fullText).trim())}"`
          : "";
      // 非 severity 列必须为纯文本：未转义的 < 等会破坏 tr.innerHTML 解析，导致仅勾选列可见
      const cellInner = col.fieldKey === "severity" ? display : escapeHtml(String(display ?? ""));
      return `<td${cellClass ? ` class="${cellClass}"` : ""}${fullTextAttr}>${cellInner}</td>`;
    })
    .join("");

  return checkboxHtml + cellsHtml;
}