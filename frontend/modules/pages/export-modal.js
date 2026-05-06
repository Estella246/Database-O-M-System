import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { listPreviewText, formatTicketSlaDhM } from "../utils/format.js";
import { normalizeIssueSeverity, severityPillClass } from "../utils/normalize.js";

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
  const warnHint =
    selectedCount === 0
      ? '<p class="export-hint export-hint--warn">当前无选中工单，请先选择工单或选择"全部工单"</p>'
      : "";

  return `
    <div class="perm-modal-mask export-modal-mask" id="export-modal-mask" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
      <div class="perm-modal export-modal">
        <div class="perm-modal-head">
          <h3 id="export-modal-title">导出工单</h3>
        </div>
        <div class="perm-modal-body export-modal-body">
          <div class="export-field">
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
          <div class="export-field">
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
            ${warnHint}
          </div>
          <div class="export-field">
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
 * 执行导出
 * @param {Array} visibleTickets 当前筛选条件下的全部可见工单
 */
export function performExport(visibleTickets) {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    window.alert("SheetJS 库未加载，请刷新页面重试");
    return;
  }

  // 确定导出数据范围
  let ticketsToExport;
  if (state.exportRange === "selected") {
    if (state.selectedTicketIds.length === 0) {
      window.alert("当前无选中工单，请选择工单或改选「全部工单」");
      return;
    }
    const selectedSet = new Set(state.selectedTicketIds);
    ticketsToExport = visibleTickets.filter((t) => selectedSet.has(t.orderId));
  } else {
    ticketsToExport = visibleTickets;
  }

  if (!ticketsToExport || ticketsToExport.length === 0) {
    window.alert("无可导出的工单数据");
    return;
  }

  state.exportLoading = true;
  requestRender();

  try {
    // 转换为表格行格式
    const rows = ticketsToExport.map((t) => {
      const sevLabel = normalizeIssueSeverity(t.severity ?? t.priority);
      const slaText = formatTicketSlaDhM(t);
      return {
        "流程ID": String(t.processId || t.orderId || ""),
        "当前阶段": String(t.currentStage ?? t.node ?? ""),
        "起始日期": String(t.startDate || ""),
        "问题严重性": sevLabel,
        "局点": String(t.location || ""),
        "业务环境": String(t.bizEnv || t.bizEnv || ""),
        "当前处理人": String(t.currentHandler ?? t.assignee ?? ""),
        "问题描述": listPreviewText(t.description || "--", 500),
        "SLA时间": slaText,
      };
    });

    // 生成文件名
    const operator = getCurrentOperator();
    const today = new Date().toISOString().slice(0, 10);
    const userPrefix = state.exportFileName || `${operator.account}_${today}`;
    const extension = state.exportFormat === "csv" ? "csv" : "xlsx";
    const fileName = `${userPrefix}.${extension}`;

    // 创建工作簿和工作表
    const workbook = X.utils.book_new();
    const worksheet = X.utils.json_to_sheet(rows, {
      header: ["流程ID", "当前阶段", "起始日期", "问题严重性", "局点", "业务环境", "当前处理人", "问题描述", "SLA时间"],
    });

    // 设置列宽（提升 Excel 可读性）
    worksheet["!cols"] = [
      { wch: 18 }, // 流程ID
      { wch: 12 }, // 当前阶段
      { wch: 12 }, // 起始日期
      { wch: 10 }, // 问题严重性
      { wch: 12 }, // 局点
      { wch: 12 }, // 业务环境
      { wch: 14 }, // 当前处理人
      { wch: 50 }, // 问题描述
      { wch: 12 }, // SLA时间
    ];

    X.utils.book_append_sheet(workbook, worksheet, "工单列表");

    // 导出文件
    if (state.exportFormat === "csv") {
      // CSV 格式导出
      const csvContent = X.utils.sheet_to_csv(worksheet);
      // 添加 BOM 头以支持中文
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      triggerDownload(blob, fileName);
    } else {
      // Excel 格式导出
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
 * @param {Blob} blob 文件 Blob 对象
 * @param {string} fileName 文件名
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
  // 默认：有选中则导出选中，无选中则导出全部
  state.exportRange = state.selectedTicketIds.length > 0 ? "selected" : "all";
  state.exportFileName = "";
  state.exportLoading = false;
  requestRender();
}