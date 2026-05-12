import { state } from "../state/state.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { requestRender } from "../core/scheduler.js";

export function ensureReportIssueTab() {
  const key = "report:issue";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "问题报表", closable: true });
  }
  return key;
}

export function detectDtsColumn(columns) {
  const list = (columns || []).map((c) => String(c || ""));
  const lower = list.map((c) => c.toLowerCase());
  let idx = lower.findIndex((c) => c === "dts" || c === "dts单号" || c === "dts号");
  if (idx >= 0) return list[idx];
  idx = lower.findIndex((c) => c.includes("dts"));
  if (idx >= 0) return list[idx];
  return "";
}

export function normalizeDtsValue(raw) {
  return String(raw == null ? "" : raw).trim().toLowerCase();
}

export function buildHistoryIndex(historyRows, dtsCol) {
  const idx = new Map();
  if (!dtsCol) return idx;
  (historyRows || []).forEach((row) => {
    const key = normalizeDtsValue(row[dtsCol]);
    if (key && !idx.has(key)) idx.set(key, row);
  });
  return idx;
}

export function mergeIssueRows(historyRows, newRows, schemaCols, dtsCol) {
  const cols = (schemaCols || []).slice();
  const historyIndex = buildHistoryIndex(historyRows, dtsCol);
  return (newRows || []).map((row) => {
    const merged = {};
    const dtsKey = dtsCol ? normalizeDtsValue(row[dtsCol]) : "";
    const histRow = dtsKey ? historyIndex.get(dtsKey) : undefined;
    cols.forEach((col) => {
      const newVal = row[col];
      const newStr = newVal == null ? "" : String(newVal);
      if (newStr.trim() !== "") {
        merged[col] = newStr;
        return;
      }
      if (histRow != null) {
        const histVal = histRow[col];
        const histStr = histVal == null ? "" : String(histVal);
        merged[col] = histStr;
        return;
      }
      merged[col] = "";
    });
    return merged;
  });
}

function setIssueMsg(msg, type = "info") {
  state.reportIssueMsg = String(msg || "");
  state.reportIssueMsgType = type;
}

function recomputeMergedRows() {
  const cols = state.reportIssueColumns || [];
  const dtsCol = state.reportIssueDtsColumn || "";
  state.reportIssueMergedRows = mergeIssueRows(
    state.reportIssueHistoryRows || [],
    state.reportIssueNewRows || [],
    cols,
    dtsCol
  );
}

function parseExcelToRows(file) {
  return new Promise((resolve, reject) => {
    const X = typeof window !== "undefined" ? window.XLSX : undefined;
    if (!X) {
      reject(new Error("SheetJS 未加载"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = X.read(data, { type: "array" });
        const firstName = wb.SheetNames[0];
        if (!firstName) {
          resolve({ rows: [], columns: [], sheetName: "" });
          return;
        }
        const sheet = wb.Sheets[firstName];
        const rows = X.utils.sheet_to_json(sheet, { defval: "" });
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        resolve({ rows, columns, sheetName: firstName });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsArrayBuffer(file);
  });
}

async function handleHistoryUpload(file) {
  if (!file) return;
  try {
    const { rows } = await parseExcelToRows(file);
    state.reportIssueHistoryRows = rows;
    state.reportIssueHistoryFileName = file.name || "";
    setIssueMsg(`已加载历史问题列表：${rows.length} 行。`, "success");
    recomputeMergedRows();
  } catch (err) {
    setIssueMsg(`历史问题列表解析失败：${err && err.message ? err.message : err}`, "error");
  }
  requestRender();
}

async function handleNewUpload(file) {
  if (!file) return;
  try {
    const { rows, columns } = await parseExcelToRows(file);
    state.reportIssueNewRows = rows;
    state.reportIssueColumns = columns;
    state.reportIssueNewFileName = file.name || "";
    state.reportIssueDtsColumn = detectDtsColumn(columns);
    if (!state.reportIssueDtsColumn) {
      setIssueMsg(`已加载新增问题列表：${rows.length} 行；未在表头识别到 DTS 单号列，将无法关联历史信息。`, "error");
    } else {
      setIssueMsg(`已加载新增问题列表：${rows.length} 行；已按 「${state.reportIssueDtsColumn}」 关联历史信息。`, "success");
    }
    recomputeMergedRows();
  } catch (err) {
    setIssueMsg(`新增问题列表解析失败：${err && err.message ? err.message : err}`, "error");
  }
  requestRender();
}

function exportMergedToXlsx() {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    setIssueMsg("SheetJS 未加载，无法导出。", "error");
    requestRender();
    return;
  }
  const rows = state.reportIssueMergedRows || [];
  const cols = state.reportIssueColumns || [];
  if (!rows.length || !cols.length) {
    setIssueMsg("当前没有可导出的数据。", "error");
    requestRender();
    return;
  }
  const aoa = [cols, ...rows.map((r) => cols.map((c) => (r[c] == null ? "" : r[c])))];
  const ws = X.utils.aoa_to_sheet(aoa);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "问题报表");
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  X.writeFile(wb, `问题报表_${ymd}.xlsx`);
}

function renderTable(rows, cols) {
  if (!cols.length) return `<div class="report-empty">请先导入「新增问题列表」以确定表格字段。</div>`;
  if (!rows.length) return `<div class="report-empty">暂无可显示的数据。</div>`;
  const head = cols
    .map((c) => `<th>${escapeHtml(String(c))}</th>`)
    .join("");
  const body = rows
    .map((r, i) => {
      const tds = cols
        .map((c) => `<td>${escapeHtml(String(r[c] == null ? "" : r[c]))}</td>`)
        .join("");
      return `<tr data-row-index="${i}">${tds}</tr>`;
    })
    .join("");
  return `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export function renderReportIssuePage() {
  const msg = String(state.reportIssueMsg || "");
  const msgType = String(state.reportIssueMsgType || "info");
  const banner = msg
    ? `<div class="report-banner report-banner--${escapeAttr(msgType)}" role="status">${escapeHtml(msg)}</div>`
    : "";
  const cols = state.reportIssueColumns || [];
  const merged = state.reportIssueMergedRows || [];
  const historyName = state.reportIssueHistoryFileName || "";
  const newName = state.reportIssueNewFileName || "";
  const exportDisabled = !merged.length || !cols.length;
  return `
    <section class="report-page report-page--issue" aria-label="问题报表">
      <div class="report-toolbar">
        <label class="report-file-label">
          <input type="file" id="report-history-file" class="report-file-input" accept=".xlsx,.xls" />
          <span>导入历史问题列表</span>
        </label>
        <span class="report-file-name" id="report-history-name">${historyName ? escapeHtml(historyName) : "未选择文件"}</span>
        <label class="report-file-label">
          <input type="file" id="report-new-file" class="report-file-input" accept=".xlsx,.xls" />
          <span>导入新增问题列表</span>
        </label>
        <span class="report-file-name" id="report-new-name">${newName ? escapeHtml(newName) : "未选择文件"}</span>
        <span class="report-toolbar-spacer"></span>
        <button type="button" class="action" id="report-clear-btn">清空</button>
        <button type="button" class="action primary" id="report-export-btn" ${exportDisabled ? "disabled" : ""}>导出</button>
      </div>
      ${banner}
      <div class="report-summary">
        <span>历史问题：${(state.reportIssueHistoryRows || []).length} 行</span>
        <span>新增问题：${(state.reportIssueNewRows || []).length} 行</span>
        <span>合并行数：${merged.length} 行</span>
        <span>DTS 列：${state.reportIssueDtsColumn ? escapeHtml(state.reportIssueDtsColumn) : "未识别"}</span>
      </div>
      ${renderTable(merged, cols)}
    </section>`;
}

export function bindReportIssuePage() {
  const historyInput = document.getElementById("report-history-file");
  if (historyInput) {
    historyInput.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) void handleHistoryUpload(file);
      historyInput.value = "";
    });
  }
  const newInput = document.getElementById("report-new-file");
  if (newInput) {
    newInput.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) void handleNewUpload(file);
      newInput.value = "";
    });
  }
  const exportBtn = document.getElementById("report-export-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => exportMergedToXlsx());
  }
  const clearBtn = document.getElementById("report-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.reportIssueHistoryRows = [];
      state.reportIssueNewRows = [];
      state.reportIssueMergedRows = [];
      state.reportIssueColumns = [];
      state.reportIssueDtsColumn = "";
      state.reportIssueHistoryFileName = "";
      state.reportIssueNewFileName = "";
      setIssueMsg("已清空。", "info");
      requestRender();
    });
  }
}

