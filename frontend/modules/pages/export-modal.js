import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { formatTicketSlaDhM } from "../utils/format.js";
import {
  EXPORT_FIELDS_BY_NODE,
  NODE_LABELS,
  NODE_ORDER,
  getTotalFieldsCount,
  getDefaultSelectedFields,
  countSelectedFields,
  stripImagesFromHtml,
  buildExportColumns,
} from "../constants/export-fields.js";
import { buildWorkbenchListExportQuery } from "./ticket-core.js";

/** 浏览器端导出上限；超出或服务端分页列表改由后端生成文件。 */
export const CLIENT_EXPORT_MAX = 500;

export function shouldUseServerExport(exportCount) {
  return (state.ticketListServerPaged && state.activeKey === "list") || exportCount > CLIENT_EXPORT_MAX;
}

/**
 * 已选中导出：visibleTickets 可能仅含当前页，须按 selectedTicketIds 补齐全部选中单。
 */
export function resolveSelectedExportTickets(visibleTickets, selectedTicketIds) {
  const selectedSet = new Set(selectedTicketIds);
  const fromVisible = visibleTickets.filter((t) => selectedSet.has(t.orderId));
  const foundIds = new Set(fromVisible.map((t) => t.orderId));
  const stubs = selectedTicketIds
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ orderId: id, processId: id }));
  return [...fromVisible, ...stubs];
}

/**
 * 渲染导出弹窗 HTML
 * @param {number} selectedCount 当前选中工单数量
 * @param {number} totalCount 当前筛选条件下的全部工单数量
 * @returns {string} 弹窗 HTML 字符串
 */
export function renderExportModalHtml(selectedCount, totalCount) {
  if (!state.exportModalOpen) return "";

  const operator = getCurrentOperator();
  const today = new Date().toISOString().slice(0, 10);
  const defaultFileName = `${operator.account}_${today}`;

  const formatXlsxChecked = state.exportFormat === "xlsx" ? "checked" : "";
  const formatCsvChecked = state.exportFormat === "csv" ? "checked" : "";
  const rangeSelectedChecked = state.exportRange === "selected" ? "checked" : "";
  const rangeAllChecked = state.exportRange === "all" ? "checked" : "";

  const selectedDisabled = selectedCount === 0 ? "disabled" : "";
  const rangeWarnHint =
    selectedCount === 0
      ? '<p class="export-hint export-hint--warn">当前无选中工单，请先选择工单或选择"全部工单"</p>'
      : "";

  // 字段选择区域
  const fieldSelectionHtml = renderFieldSelectionSection();

  return `
    <div class="perm-modal-mask export-modal-mask" id="export-modal-mask" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
      <div class="perm-modal export-modal export-modal--wide">
        <div class="perm-modal-head">
          <h3 id="export-modal-title">导出工单</h3>
        </div>
        <div class="perm-modal-body export-modal-body">
          <div class="export-section">
            <label class="export-label">导出格式</label>
            <div class="export-radio-group" role="radiogroup" aria-label="导出格式">
              <label class="export-radio-opt">
                <input type="radio" name="export-format" value="xlsx" ${formatXlsxChecked} />
                <span>Excel (.xlsx)</span>
              </label>
              <label class="export-radio-opt">
                <input type="radio" name="export-format" value="csv" ${formatCsvChecked} />
                <span>CSV (.csv)</span>
              </label>
            </div>
          </div>
          <div class="export-section">
            <label class="export-label">导出范围</label>
            <div class="export-radio-group" role="radiogroup" aria-label="导出范围">
              <label class="export-radio-opt">
                <input type="radio" name="export-range" value="selected" ${rangeSelectedChecked} ${selectedDisabled} />
                <span>已选中的工单（${selectedCount} 条）</span>
              </label>
              <label class="export-radio-opt">
                <input type="radio" name="export-range" value="all" ${rangeAllChecked} />
                <span>全部工单（当前筛选条件下的 ${totalCount} 条）</span>
              </label>
            </div>
            ${rangeWarnHint}
          </div>
          ${fieldSelectionHtml}
          <div class="export-section">
            <label class="export-label">文件名前缀（可选）</label>
            <input type="text" class="export-input" id="export-filename-input"
                   value="${escapeAttr(state.exportFileName)}"
                   placeholder="留空则使用默认：${escapeAttr(defaultFileName)}" />
            <p class="export-hint">文件将下载到浏览器默认下载路径，扩展名自动添加</p>
          </div>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="export-cancel-btn">取消</button>
          <button type="button" class="action primary" id="export-confirm-btn" ${state.exportLoading ? "disabled" : ""}>
            ${state.exportLoading ? "导出中…" : "导出"}
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * 渲染字段选择区域
 */
function renderFieldSelectionSection() {
  const selectedFields = state.exportSelectedFields || getDefaultSelectedFields();
  const totalFields = getTotalFieldsCount();
  const selectedCount = countSelectedFields(selectedFields);
  const allSelected = selectedCount === totalFields;

  // 渲染各节点分组
  const nodeGroupsHtml = NODE_ORDER.map((nodeKey) =>
    renderNodeFieldGroup(nodeKey, selectedFields)
  ).join("");

  return `
    <div class="export-section export-section--fields">
      <label class="export-label">导出字段</label>
      <div class="export-field-global-control">
        <label class="export-checkbox-opt">
          <input type="checkbox" id="export-select-all-fields" ${allSelected ? "checked" : ""} />
          <span>全选全部字段 (${selectedCount}/${totalFields})</span>
        </label>
      </div>
      <div class="export-field-groups">
        ${nodeGroupsHtml}
      </div>
    </div>`;
}

/**
 * 渲染单个节点字段分组
 */
function renderNodeFieldGroup(nodeKey, selectedFields) {
  const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
  const nodeLabel = NODE_LABELS[nodeKey] || nodeKey;
  const selected = selectedFields[nodeKey] || [];
  const nodeAllSelected = selected.length === fields.length;
  const expanded = state.exportExpandedNodes?.[nodeKey] || false;

  // 字段 checkbox 列表（双列布局）
  const fieldListHtml = fields
    .map((f) => {
      const checked = selected.includes(f.key) ? "checked" : "";
      return `
        <label class="export-checkbox-opt export-field-item">
          <input type="checkbox" data-export-field="${escapeAttr(nodeKey)}:${escapeAttr(f.key)}" ${checked} />
          <span>${escapeHtml(f.label)}</span>
        </label>`;
    })
    .join("");

  return `
    <details class="export-field-group" ${expanded ? "open" : ""} data-export-node="${escapeAttr(nodeKey)}">
      <summary class="export-field-group-summary">
        <label class="export-checkbox-opt export-node-checkbox">
          <input type="checkbox" data-export-node-select-all="${escapeAttr(nodeKey)}" ${nodeAllSelected ? "checked" : ""} />
          <span>${escapeHtml(nodeLabel)} (${selected.length}/${fields.length})</span>
        </label>
        <span class="export-field-expand-icon">${expanded ? "▼" : "▶"}</span>
      </summary>
      <div class="export-field-list">
        ${fieldListHtml}
      </div>
    </details>`;
}

/**
 * 绑定导出弹窗事件
 * @param {Array} visibleTickets 当前筛选条件下的全部可见工单
 */
export function bindExportModal(visibleTickets) {
  const mask = document.getElementById("export-modal-mask");
  if (!mask) return;

  // 点击遮罩层关闭
  mask.addEventListener("click", (ev) => {
    if (ev.target === mask) {
      closeExportModal();
    }
  });

  // 取消按钮
  document.getElementById("export-cancel-btn")?.addEventListener("click", closeExportModal);

  // 格式选择
  mask.querySelectorAll("input[name='export-format']").forEach((radio) => {
    radio.addEventListener("change", () => {
      state.exportFormat = radio.value;
      requestRender();
    });
  });

  // 范围选择
  mask.querySelectorAll("input[name='export-range']").forEach((radio) => {
    radio.addEventListener("change", () => {
      state.exportRange = radio.value;
      requestRender();
    });
  });

  // 文件名输入
  const filenameInput = document.getElementById("export-filename-input");
  if (filenameInput) {
    filenameInput.addEventListener("input", () => {
      state.exportFileName = filenameInput.value.trim();
    });
  }

  // 字段选择 - 全选全部字段
  const selectAllFieldsCheckbox = document.getElementById("export-select-all-fields");
  if (selectAllFieldsCheckbox) {
    selectAllFieldsCheckbox.addEventListener("change", () => {
      const checked = selectAllFieldsCheckbox.checked;
      if (checked) {
        state.exportSelectedFields = getDefaultSelectedFields();
      } else {
        // 全不选：清空所有节点
        const empty = {};
        NODE_ORDER.forEach((nk) => {
          empty[nk] = [];
        });
        state.exportSelectedFields = empty;
      }
      requestRender();
    });
  }

  // 字段选择 - 节点级全选
  mask.querySelectorAll("[data-export-node-select-all]").forEach((checkbox) => {
    checkbox.addEventListener("click", (ev) => {
      // 阻止事件冒泡到 summary（避免触发 details toggle）
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const nodeKey = checkbox.getAttribute("data-export-node-select-all");
      if (!nodeKey) return;
      const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
      const current = state.exportSelectedFields || getDefaultSelectedFields();
      if (checkbox.checked) {
        current[nodeKey] = fields.map((f) => f.key);
      } else {
        current[nodeKey] = [];
      }
      state.exportSelectedFields = current;
      requestRender();
    });
  });

  // 字段选择 - 单个字段 checkbox
  mask.querySelectorAll("[data-export-field]").forEach((checkbox) => {
    checkbox.addEventListener("click", (ev) => {
      // 阻止事件冒泡（避免触发 details toggle 或其他父元素事件）
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const data = checkbox.getAttribute("data-export-field") || "";
      const [nodeKey, fieldKey] = data.split(":");
      if (!nodeKey || !fieldKey) return;
      const current = state.exportSelectedFields || getDefaultSelectedFields();
      const nodeSelected = current[nodeKey] || [];
      const set = new Set(nodeSelected);
      if (checkbox.checked) {
        set.add(fieldKey);
      } else {
        set.delete(fieldKey);
      }
      current[nodeKey] = Array.from(set);
      state.exportSelectedFields = current;
      requestRender();
    });
  });

  // 折叠/展开节点分组
  mask.querySelectorAll(".export-field-group").forEach((details) => {
    details.addEventListener("toggle", () => {
      const nodeKey = details.getAttribute("data-export-node");
      if (!nodeKey) return;
      const expanded = state.exportExpandedNodes || {};
      expanded[nodeKey] = details.open;
      state.exportExpandedNodes = expanded;
    });
  });

  // 导出确认按钮
  document.getElementById("export-confirm-btn")?.addEventListener("click", () => {
    performExport(visibleTickets);
  });
}

/**
 * 关闭导出弹窗
 */
function closeExportModal() {
  state.exportModalOpen = false;
  state.exportLoading = false;
  requestRender();
}

/**
 * 服务端生成导出文件并触发下载（不将大批量数据载入浏览器内存）。
 */
async function performServerExport() {
  const operator = getCurrentOperator();
  const today = new Date().toISOString().slice(0, 10);
  const selectedFields = state.exportSelectedFields || getDefaultSelectedFields();
  const body = {
    operator_id: operator.account,
    operator_name: String(operator.userName || ""),
    format: state.exportFormat,
    range: state.exportRange,
    selected_fields: selectedFields,
    filename_prefix: state.exportFileName || `${operator.account}_${today}`,
  };
  if (state.exportRange === "selected") {
    body.ticket_nos = [...state.selectedTicketIds];
  } else {
    body.list_query = buildWorkbenchListExportQuery();
  }

  const resp = await fetch(`${API_BASE_URL}/api/tickets/export-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await parseApiError(resp));
  }

  const blob = await resp.blob();
  const extension = state.exportFormat === "csv" ? "csv" : "xlsx";
  const fileName = `${body.filename_prefix}.${extension}`;
  triggerDownload(blob, fileName);
}

/**
 * 执行导出
 * @param {Array} visibleTickets 当前筛选条件下的全部可见工单
 */
export async function performExport(visibleTickets) {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    window.alert("SheetJS 库未加载，请刷新页面重试");
    return;
  }

  // 检查是否有选中字段
  const selectedFields = state.exportSelectedFields || getDefaultSelectedFields();
  const totalSelected = countSelectedFields(selectedFields);
  if (totalSelected === 0) {
    window.alert("请至少选择一个导出字段");
    return;
  }

  if (state.exportRange === "selected" && state.selectedTicketIds.length === 0) {
    window.alert("当前无选中工单，请选择工单或改选「全部工单」");
    return;
  }

  const exportCount =
    state.exportRange === "selected"
      ? state.selectedTicketIds.length
      : state.ticketListServerPaged && state.activeKey === "list"
        ? Math.max(0, Number(state.ticketListTotal) || 0)
        : visibleTickets.length;

  if (exportCount === 0) {
    window.alert("无可导出的工单数据");
    return;
  }

  state.exportLoading = true;
  requestRender();

  try {
    if (shouldUseServerExport(exportCount)) {
      await performServerExport();
      closeExportModal();
      return;
    }

    let ticketsToExport;
    if (state.exportRange === "selected") {
      ticketsToExport = resolveSelectedExportTickets(visibleTickets, state.selectedTicketIds);
    } else {
      ticketsToExport = visibleTickets;
    }

    if (!ticketsToExport || ticketsToExport.length === 0) {
      window.alert("无可导出的工单数据");
      state.exportLoading = false;
      requestRender();
      return;
    }
    // 获取工单编号列表
    const ticketNos = ticketsToExport.map((t) => t.orderId || t.processId);

    // 调用后端 API 获取完整节点数据
    const operator = getCurrentOperator();
    const resp = await fetch(`${API_BASE_URL}/api/tickets/export-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket_nos: ticketNos,
        operator_id: operator.account,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`获取导出数据失败：${resp.status} ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const exportItems = data.items || [];

    // 为每个导出项添加系统字段数据（从原始 ticket 对象获取）
    const ticketMap = new Map(ticketsToExport.map((t) => [t.orderId || t.processId, t]));
    exportItems.forEach((item) => {
      const ticket = ticketMap.get(item.ticket_no);
      if (ticket) {
        item.nodes = item.nodes || {};
        item.nodes.system = {
          processId: ticket.processId || ticket.orderId || "",
          currentStage: ticket.currentStage || ticket.node || "",
          currentHandler: ticket.currentHandler || ticket.assignee || "",
          slaTime: formatTicketSlaDhM(ticket),
        };
      }
    });

    // 构建导出列
    const columns = buildExportColumns(selectedFields);
    if (columns.length === 0) {
      throw new Error("未选择任何导出字段");
    }

    // 转换为表格行格式
    const rows = exportItems.map((item) => {
      const row = {};
      columns.forEach((col) => {
        const nodeData = item.nodes?.[col.nodeKey] || {};
        let value = nodeData[col.fieldKey] || "";
        // 处理富文本字段（转纯文本）
        if (col.stripImages && typeof value === "string") {
          value = stripImagesFromHtml(value);
        }
        // 日期字段格式化
        if (col.type === "date" && value) {
          value = String(value).slice(0, 10);
        }
        row[col.fullLabel] = String(value || "");
      });
      return row;
    });

    // 生成文件名
    const today = new Date().toISOString().slice(0, 10);
    const userPrefix = state.exportFileName || `${operator.account}_${today}`;
    const extension = state.exportFormat === "csv" ? "csv" : "xlsx";
    const fileName = `${userPrefix}.${extension}`;

    // 创建工作簿和工作表
    const workbook = X.utils.book_new();
    const headers = columns.map((c) => c.fullLabel);
    const worksheet = X.utils.json_to_sheet(rows, { header: headers });

    // 设置列宽
    worksheet["!cols"] = columns.map((c) => ({
      wch: Math.min(50, Math.max(12, c.label.length + 4)),
    }));

    X.utils.book_append_sheet(workbook, worksheet, "工单数据");

    // 导出文件
    if (state.exportFormat === "csv") {
      const csvContent = X.utils.sheet_to_csv(worksheet);
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      triggerDownload(blob, fileName);
    } else {
      const excelBuffer = X.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      triggerDownload(blob, fileName);
    }

    // 导出成功，关闭弹窗
    closeExportModal();
  } catch (err) {
    console.error("Export error:", err);
    window.alert(`导出失败：${err.message || err}`);
    state.exportLoading = false;
    requestRender();
  }
}

/**
 * 触发文件下载
 */
function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 打开导出弹窗
 */
export function openExportModal() {
  state.exportModalOpen = true;
  state.exportFormat = "xlsx";
  state.exportRange = state.selectedTicketIds.length > 0 ? "selected" : "all";
  state.exportFileName = "";
  state.exportLoading = false;
  // 初始化字段选择状态（默认全选）
  state.exportSelectedFields = getDefaultSelectedFields();
  // 初始化折叠状态（默认全部折叠）
  state.exportExpandedNodes = {};
  requestRender();
}