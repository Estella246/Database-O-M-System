import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import {
  EXPORT_FIELDS_BY_NODE,
  NODE_LABELS,
  NODE_ORDER,
  getTotalFieldsCount,
  getDefaultSelectedFields,
  countSelectedFields,
} from "../constants/export-fields.js";
import {
  HOTPATCH_EXPORT_FIELDS_BY_NODE,
  HOTPATCH_NODE_LABELS,
  HOTPATCH_NODE_ORDER,
  getHotpatchTotalFieldsCount,
  getHotpatchDefaultSelectedFields,
} from "../constants/hotpatch-export-fields.js";
import { buildWorkbenchListExportQuery } from "./ticket-core.js";

function isPatchExportContext() {
  return state.activeKey === "patch:list";
}

function getExportFieldCatalog() {
  if (isPatchExportContext()) {
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

function catalogDefaultSelectedFields() {
  return isPatchExportContext() ? getHotpatchDefaultSelectedFields() : getDefaultSelectedFields();
}

function catalogTotalFieldsCount() {
  return isPatchExportContext() ? getHotpatchTotalFieldsCount() : getTotalFieldsCount();
}

function catalogTemplateCode() {
  return isPatchExportContext() ? "HOTPATCH" : "HCS_INCIDENT";
}

/** 超过此条数走异步任务（防网关 504）；以内改同步 export-file 一口气下载。 */
export const CLIENT_EXPORT_MAX = 500;

/**
 * 是否走异步导出任务（创建任务 + 轮询进度）。
 * 仅按条数判断：工作台服务端分页不再强制异步，小批量同步生成即可。
 * 后台写文件仍按批（EXPORT_BATCH_SIZE）查库/落盘，避免 CPU/内存飙升。
 */
export function shouldUseAsyncServerExport(exportCount) {
  return exportCount > CLIENT_EXPORT_MAX;
}

/** @deprecated 使用 shouldUseAsyncServerExport；保留别名避免外部引用断裂 */
export function shouldUseServerExport(exportCount) {
  return shouldUseAsyncServerExport(exportCount);
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
            ${renderExportConfirmLabel()}
          </button>
        </div>
      </div>
    </div>`;
}

function renderExportConfirmLabel() {
  if (!state.exportLoading) return "导出";
  const total = Math.max(0, Number(state.exportTotalRows) || 0);
  const processed = Math.max(0, Number(state.exportProcessedRows) || 0);
  if (total > 0) {
    return `导出中… ${processed}/${total}`;
  }
  return "导出中…";
}

/**
 * 渲染字段选择区域
 */
function renderFieldSelectionSection() {
  const selectedFields = state.exportSelectedFields || catalogDefaultSelectedFields();
  const totalFields = catalogTotalFieldsCount();
  const selectedCount = countSelectedFields(selectedFields);
  const allSelected = selectedCount === totalFields;
  const { nodeOrder } = getExportFieldCatalog();

  // 渲染各节点分组
  const nodeGroupsHtml = nodeOrder.map((nodeKey) =>
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
  const { fieldsByNode, nodeLabels } = getExportFieldCatalog();
  const fields = fieldsByNode[nodeKey] || [];
  const nodeLabel = nodeLabels[nodeKey] || nodeKey;
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
        state.exportSelectedFields = catalogDefaultSelectedFields();
      } else {
        // 全不选：清空所有节点
        const empty = {};
        getExportFieldCatalog().nodeOrder.forEach((nk) => {
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
      const fields = getExportFieldCatalog().fieldsByNode[nodeKey] || [];
      const current = state.exportSelectedFields || catalogDefaultSelectedFields();
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
      const current = state.exportSelectedFields || catalogDefaultSelectedFields();
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
 * 关闭导出弹窗；若有进行中的异步任务则立刻取消并删服务端临时文件。
 */
function closeExportModal() {
  stopExportProgressPolling();
  const taskId = state.exportTaskId;
  const operator = getCurrentOperator();
  if (typeof state._exportWaitReject === "function") {
    try {
      state._exportWaitReject(new Error("已取消导出"));
    } catch (_) {
      /* ignore */
    }
    state._exportWaitReject = null;
  }
  state.exportModalOpen = false;
  state.exportLoading = false;
  state.exportTaskId = null;
  state.exportProcessedRows = 0;
  state.exportTotalRows = 0;
  requestRender();
  if (taskId) {
    fetch(`${API_BASE_URL}/api/tickets/export-tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: operator.account }),
    }).catch(() => {});
  }
}

function stopExportProgressPolling() {
  if (state._exportProgressTimer) {
    clearInterval(state._exportProgressTimer);
    state._exportProgressTimer = null;
  }
}

async function downloadExportTaskFile(taskId, fileName) {
  const operator = getCurrentOperator();
  const resp = await fetch(
    `${API_BASE_URL}/api/tickets/export-tasks/${taskId}/download?operator_id=${encodeURIComponent(operator.account)}`
  );
  if (!resp.ok) {
    throw new Error(await parseApiError(resp));
  }
  const blob = await resp.blob();
  triggerDownload(blob, fileName);
}

function buildExportRequestBody(visibleTickets) {
  const operator = getCurrentOperator();
  const today = new Date().toISOString().slice(0, 10);
  const selectedFields = state.exportSelectedFields || catalogDefaultSelectedFields();
  const templateCode = catalogTemplateCode();
  const body = {
    operator_id: operator.account,
    operator_name: String(operator.userName || ""),
    format: state.exportFormat,
    range: state.exportRange,
    selected_fields: selectedFields,
    filename_prefix: state.exportFileName || `${operator.account}_${today}`,
    template_code: templateCode,
  };
  if (state.exportRange === "selected") {
    body.ticket_nos = [...state.selectedTicketIds];
  } else if (templateCode === "HOTPATCH") {
    // 补丁管理非 HCS 快照分页，「全部」按当前筛选可见单号走 selected，避免误导工作台 list_query。
    body.range = "selected";
    body.ticket_nos = Array.isArray(visibleTickets)
      ? visibleTickets.map((t) => String(t.orderId || "").trim()).filter(Boolean)
      : [];
  } else {
    body.list_query = buildWorkbenchListExportQuery();
  }
  return body;
}

/**
 * ≤500 条：同步 POST /export-file，一次请求生成并下载（服务端仍按批写，控内存）。
 * 无任务表、无轮询。
 */
async function performSyncServerExport(visibleTickets) {
  const body = buildExportRequestBody(visibleTickets);
  const extension = state.exportFormat === "csv" ? "csv" : "xlsx";
  const fileName = `${body.filename_prefix}.${extension}`;

  const resp = await fetch(`${API_BASE_URL}/api/tickets/export-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await parseApiError(resp));
  }
  const blob = await resp.blob();
  triggerDownload(blob, fileName);
}

/**
 * 服务端异步生成导出文件：创建任务 → 轮询进度 → 完成后下载。
 * 轮询仅用于等后台任务结束（避免同步长请求被网关 504），不是「每 1.5s 处理一批」。
 * 生成侧按批查询/写盘，进度回调降频更新，避免整表进内存。
 */
async function performAsyncServerExport(visibleTickets) {
  const body = buildExportRequestBody(visibleTickets);

  const createResp = await fetch(`${API_BASE_URL}/api/tickets/export-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!createResp.ok) {
    throw new Error(await parseApiError(createResp));
  }
  const created = await createResp.json();
  const taskId = created.task_id;
  if (!taskId) {
    throw new Error("创建导出任务失败：未返回 task_id");
  }

  state.exportTaskId = taskId;
  state.exportTotalRows = Number(created.total_rows) || 0;
  state.exportProcessedRows = 0;
  requestRender();

  const extension = state.exportFormat === "csv" ? "csv" : "xlsx";
  const fileName = created.filename || `${body.filename_prefix}.${extension}`;

  const waitReady = () =>
    new Promise((resolve, reject) => {
      state._exportWaitReject = reject;
      const pollOnce = async () => {
        try {
          const operator = getCurrentOperator();
          const resp = await fetch(
            `${API_BASE_URL}/api/tickets/export-tasks/${taskId}/progress?operator_id=${encodeURIComponent(operator.account)}`
          );
          if (!resp.ok) {
            reject(new Error(await parseApiError(resp)));
            return true;
          }
          const data = await resp.json();
          const processed = Number(data.processed_rows) || 0;
          const total = Number(data.total_rows) || state.exportTotalRows || 0;
          const changed =
            state.exportProcessedRows !== processed ||
            state.exportTotalRows !== total ||
            state.exportTaskId !== taskId;
          state.exportProcessedRows = processed;
          state.exportTotalRows = total;
          if (changed) requestRender();

          if (data.status === "ready") {
            resolve(data);
            return true;
          }
          if (data.status === "cancelled") {
            reject(new Error("已取消导出"));
            return true;
          }
          if (data.status === "error" || data.status === "expired") {
            reject(new Error(data.error_message || "导出失败"));
            return true;
          }
          return false;
        } catch (err) {
          reject(err);
          return true;
        }
      };

      pollOnce().then((done) => {
        if (done) {
          state._exportWaitReject = null;
          return;
        }
        stopExportProgressPolling();
        state._exportProgressTimer = setInterval(async () => {
          const finished = await pollOnce();
          if (finished) {
            stopExportProgressPolling();
            state._exportWaitReject = null;
          }
        }, 1500);
      });
    });

  await waitReady();
  // 成功生成后清掉 taskId，关闭弹窗时不再误调 cancel
  state.exportTaskId = null;
  state._exportWaitReject = null;
  await downloadExportTaskFile(taskId, fileName);
}

/**
 * 执行导出（一律由服务端按批生成文件，浏览器不拼 SheetJS 大表）。
 * ≤500：同步 export-file 一口气下载；>500：异步任务 + 轮询防 504。
 * @param {Array} _visibleTickets 保留参数以兼容调用方；单号来自选中或 list_query
 */
export async function performExport(_visibleTickets) {
  const selectedFields = state.exportSelectedFields || catalogDefaultSelectedFields();
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
        : Array.isArray(_visibleTickets)
          ? _visibleTickets.length
          : 0;

  if (exportCount === 0) {
    window.alert("无可导出的工单数据");
    return;
  }

  state.exportLoading = true;
  requestRender();

  try {
    if (shouldUseAsyncServerExport(exportCount)) {
      await performAsyncServerExport(_visibleTickets);
    } else {
      await performSyncServerExport(_visibleTickets);
    }
    closeExportModal();
  } catch (err) {
    console.error("Export error:", err);
    stopExportProgressPolling();
    const msg = String(err?.message || err || "");
    const cancelled = msg.includes("已取消导出");
    if (!cancelled) {
      window.alert(`导出失败：${msg}`);
    }
    state.exportLoading = false;
    state.exportTaskId = null;
    state._exportWaitReject = null;
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
  stopExportProgressPolling();
  state.exportModalOpen = true;
  state.exportFormat = "csv";
  state.exportRange = state.selectedTicketIds.length > 0 ? "selected" : "all";
  state.exportFileName = "";
  state.exportLoading = false;
  state.exportTaskId = null;
  state.exportProcessedRows = 0;
  state.exportTotalRows = 0;
  // 初始化字段选择状态（默认全选；补丁管理用热补丁节点字段）
  state.exportSelectedFields = catalogDefaultSelectedFields();
  // 初始化折叠状态（默认全部折叠）
  state.exportExpandedNodes = {};
  requestRender();
}