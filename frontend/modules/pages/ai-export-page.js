import { escapeHtml, escapeAttr } from "../utils/escape.js";
import {
  AI_EXPORT_FIELDS_BY_NODE,
  NODE_LABELS,
  NODE_ORDER,
  AI_EXPORT_DEFAULT_PRESELECTED,
  AI_EXPORT_EXAMPLE_PROMPTS,
  getAIExportTotalFieldsCount,
  getAIExportDefaultSelectedFields,
  countSelectedFields,
  buildExportColumns,
} from "../constants/ai-export-fields.js";
import { loadDOMPurify } from "../utils/dompurify-wrapper.js";
import { API_BASE_URL } from "../services/api.js";
import { getCurrentOperator } from "../core/auth.js";
import { state } from "../state/state.js";
import { whitelistAllows } from "../utils/normalize.js";
import { requestRender } from "../core/scheduler.js";

/* ── ensure tab ── */

export function ensureAiExportTab() {
  const key = "ai:export";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "深度分析", closable: true });
  }
  return key;
}

/* ── API fetch helpers ── */

function _opId() {
  return getCurrentOperator().account || "demo_001";
}

export async function fetchAiExportCreateTask() {
  state.aiExportProcessing = true;
  requestRender();
  try {
    // Flatten selected fields from { nodeKey: [fieldKeys] } to flat array
    const originalColumns = [];
    const selected = state.aiExportSelectedFields || {};
    NODE_ORDER.forEach((nodeKey) => {
      (selected[nodeKey] || []).forEach((fieldKey) => {
        originalColumns.push(fieldKey);
      });
    });
    // Always include ticket_no
    if (!originalColumns.includes("ticket_no")) {
      originalColumns.unshift("ticket_no");
    }

    const resp = await fetch(`${API_BASE_URL}/api/ai-export/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: _opId(),
        source_config: state.aiExportSourceConfig || {},
        original_columns: originalColumns,
        natural_description: state.aiExportNaturalDescription || "",
        where_sql: state.aiExportWhereSql || "",
      }),
    });
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportCurrentTaskId = data.task_id;
      state.aiExportTaskStatus = data.status;
      state.aiExportTotalRows = data.total_rows;
      state.aiExportErrorMessage = "";
      state.aiExportOriginalColumns = originalColumns;
      fetchAiExportTaskList(); // refresh history after task creation
    } else {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
    }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  state.aiExportProcessing = false;
  requestRender();
}

export async function fetchAiExportQueryByDescription() {
  state.aiExportProcessing = true;
  state.aiExportLoadingStep = "理解查询描述";
  requestRender();
  try {
    const description = state.aiExportNaturalDescription || "";
    if (!description.trim()) {
      state.aiExportErrorMessage = "请输入查询描述";
      state.aiExportProcessing = false;
      state.aiExportLoadingStep = "";
      requestRender();
      return;
    }
    // Step A: LLM generates WHERE
    state.aiExportLoadingStep = "生成查询条件";
    const resp = await fetch(`${API_BASE_URL}/api/ai-export/query-by-description`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: _opId(),
        description: description.trim(),
        template_code: state.aiExportSourceConfig?.template_code || "HCS_INCIDENT",
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
      state.aiExportProcessing = false;
      state.aiExportLoadingStep = "";
      requestRender();
      return;
    }

    state.aiExportWhereSql = data.where_sql;
    state.aiExportMatchCount = data.match_count;
    state.aiExportNaturalSummary = data.natural_summary || "";
    state.aiExportErrorMessage = "";

    // Step B: Auto-fetch preview rows (merged — no separate "下一步" button)
    state.aiExportLoadingStep = "加载预览数据";
    try {
      const previewResp = await fetch(`${API_BASE_URL}/api/ai-export/preview-rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: _opId(),
          where_sql: data.where_sql,
          template_code: state.aiExportSourceConfig?.template_code || "HCS_INCIDENT",
        }),
      });
      const previewData = await previewResp.json();
      if (previewResp.ok) {
        state.aiExportPreviewRows = previewData.preview_rows || [];
        state.aiExportMatchCount = previewData.match_count || 0;
      } else {
        // Preview fetch failed — still show WHERE result, just no preview table
        state.aiExportPreviewRows = [];
      }
    } catch (_) { /* preview failure doesn't block the flow */ }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  state.aiExportProcessing = false;
  state.aiExportLoadingStep = "";
  requestRender();
}

export async function fetchAiExportPreviewRows() {
  state.aiExportProcessing = true;
  requestRender();
  try {
    const whereSql = state.aiExportWhereSql || "";
    if (!whereSql) {
      state.aiExportErrorMessage = "请先完成查询数据步骤";
      state.aiExportProcessing = false;
      requestRender();
      return;
    }
    const resp = await fetch(`${API_BASE_URL}/api/ai-export/preview-rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: _opId(),
        where_sql: whereSql,
        template_code: state.aiExportSourceConfig?.template_code || "HCS_INCIDENT",
      }),
    });
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportPreviewRows = data.preview_rows || [];
      state.aiExportMatchCount = data.match_count;
      state.aiExportErrorMessage = "";
    } else {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
    }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  state.aiExportProcessing = false;
  requestRender();
}

export async function fetchAiExportTranslateRules() {
  state.aiExportProcessing = true;
  state.aiExportLoadingStep = "理解规则描述";
  requestRender();
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks/${state.aiExportCurrentTaskId}/translate-rules`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: _opId(),
          rule_description: state.aiExportRuleDescription,
        }),
      }
    );
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportTaskStatus = data.status;
      state.aiExportTransformRules = data.transform_rules || [];
      state.aiExportPreviewRows = data.preview_rows || [];
      state.aiExportErrorMessage = "";
    } else {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
    }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  state.aiExportProcessing = false;
  state.aiExportLoadingStep = "";
  requestRender();
}

export async function fetchAiExportStartProcessing() {
  state.aiExportFullProcessing = true;
  requestRender();
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks/${state.aiExportCurrentTaskId}/start-processing`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: _opId() }),
      }
    );
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportTaskStatus = data.status;
      state.aiExportErrorMessage = "";
    } else {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
    }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  state.aiExportFullProcessing = false;
  requestRender();
}

export async function fetchAiExportResumeTask(taskId) {
  state.aiExportProcessing = true;
  state.aiExportLoadingStep = "恢复任务数据";
  requestRender();
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks/${taskId}?operator_id=${encodeURIComponent(_opId())}`
    );
    const data = await resp.json();
    if (!resp.ok) {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
      state.aiExportProcessing = false;
      state.aiExportLoadingStep = "";
      requestRender();
      return;
    }

    // Restore state from task detail
    state.aiExportCurrentTaskId = data.id;
    state.aiExportTaskStatus = data.status;
    state.aiExportTotalRows = data.total_rows || 0;
    state.aiExportNaturalDescription = data.natural_description || "";
    state.aiExportWhereSql = data.where_sql || "";
    state.aiExportNaturalSummary = data.natural_summary || "";
    state.aiExportSourceConfig = data.source_config || {};
    state.aiExportRuleDescription = data.rule_description || "";
    state.aiExportTransformRules = data.transform_rules || [];
    state.aiExportOriginalColumns = data.original_columns || [];
    state.aiExportErrorMessage = "";

    // Restore selected fields from original_columns (flat array → { nodeKey: [fieldKeys] })
    const cols = data.original_columns || [];
    const restored = {};
    NODE_ORDER.forEach((nodeKey) => {
      const nodeFieldKeys = (AI_EXPORT_FIELDS_BY_NODE[nodeKey] || []).map((f) => f.key);
      restored[nodeKey] = nodeFieldKeys.filter((k) => cols.includes(k));
    });
    state.aiExportSelectedFields = restored;

    // Re-fetch preview_rows using the saved where_sql
    if (data.where_sql) {
      state.aiExportLoadingStep = "加载预览数据";
      requestRender();
      const previewResp = await fetch(`${API_BASE_URL}/api/ai-export/preview-rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: _opId(),
          where_sql: data.where_sql,
          template_code: data.source_config?.template_code || "HCS_INCIDENT",
        }),
      });
      const previewData = await previewResp.json();
      if (previewResp.ok) {
        state.aiExportPreviewRows = previewData.preview_rows || [];
        state.aiExportMatchCount = previewData.match_count || 0;
      } else {
        state.aiExportPreviewRows = [];
        state.aiExportMatchCount = 0;
      }
    } else {
      state.aiExportPreviewRows = [];
      state.aiExportMatchCount = 0;
    }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  state.aiExportProcessing = false;
  state.aiExportLoadingStep = "";
  requestRender();
}

export async function fetchAiExportCancel() {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks/${state.aiExportCurrentTaskId}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: _opId() }),
      }
    );
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportTaskStatus = data.status;
      state.aiExportProcessedRows = data.processed_rows;
      state.aiExportErrorMessage = "";
      stopProgressPolling();
    } else {
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
    }
  } catch (e) {
    state.aiExportErrorMessage = e.message;
  }
  requestRender();
}

export async function fetchAiExportGenerateReport() {
  state.aiExportReportStatus = "generating";
  requestRender();
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks/${state.aiExportCurrentTaskId}/generate-report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: _opId(),
          report_prompt: state.aiExportReportPrompt,
        }),
      }
    );
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportReportStatus = data.report_status || "done";
      state.aiExportErrorMessage = "";
    } else {
      state.aiExportReportStatus = "none";
      state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
    }
  } catch (e) {
    state.aiExportReportStatus = "none";
    state.aiExportErrorMessage = e.message;
  }
  requestRender();
}

export async function fetchAiExportTaskList(page) {
  const p = page || state.aiExportTaskListPage;
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks?operator_id=${encodeURIComponent(_opId())}&page=${p}&size=20`
    );
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportTaskList = data.items || [];
      state.aiExportTaskListTotal = data.total || 0;
      state.aiExportTaskListPage = p;
    }
  } catch (_) {
    state.aiExportTaskList = [];
  }
  requestRender();
}

/* ── progress polling ── */

function startProgressPolling(taskId) {
  if (state._aiExportProgressTimer) clearInterval(state._aiExportProgressTimer);
  state._aiExportProgressTimer = setInterval(async () => {
    // 不在深度分析页面时停止轮询，避免刷新其他页面
    if (state.activeKey !== "ai:export") {
      stopProgressPolling();
      return;
    }
    try {
      const resp = await fetch(
        `${API_BASE_URL}/api/ai-export/tasks/${taskId}/progress?operator_id=${encodeURIComponent(_opId())}`
      );
      if (resp.ok) {
        const data = await resp.json();
        const changed =
          state.aiExportProcessedRows !== data.processed_rows ||
          state.aiExportTaskStatus !== data.status ||
          state.aiExportErrorMessage !== (data.error_message || "");
        state.aiExportProcessedRows = data.processed_rows;
        state.aiExportTaskStatus = data.status;
        state.aiExportErrorMessage = data.error_message || "";
        if (data.status === "ready" || data.status === "error") {
          stopProgressPolling();
          fetchAiExportTaskList(); // refresh history when processing completes
          requestRender();
        } else if (changed) {
          requestRender();
        }
      }
    } catch (_) { /* ignore transient errors */ }
  }, 3000);
}

function stopProgressPolling() {
  if (state._aiExportProgressTimer) {
    clearInterval(state._aiExportProgressTimer);
    state._aiExportProgressTimer = null;
  }
}

/* ── render ── */

const STEP_LABELS = ["查询数据", "选择字段", "清洗规则", "导出&报表"];

function renderStepProgressBar(taskStatus, whereSql) {
  // Map state → current step number (1-4)
  let current = 1;
  if (whereSql && !taskStatus) current = 2;  // query done, task not created yet
  if (taskStatus === "draft") current = 3;
  if (taskStatus === "preview") current = 3;
  if (taskStatus === "processing" || taskStatus === "ready") current = 4;

  let html = `<div class="ai-export-step-nav">`;
  for (let i = 0; i < STEP_LABELS.length; i++) {
    const stepNum = i + 1;
    const isDone = stepNum < current || (taskStatus === "ready" && stepNum === current);
    const isActive = stepNum === current && taskStatus !== "ready";
    const cls = isDone ? "ai-export-step-nav-item--done" : isActive ? "ai-export-step-nav-item--active" : "";
    const icon = isDone ? "✓" : stepNum;
    html += `<span class="ai-export-step-nav-item ${cls}">
      <span class="ai-export-step-nav-num">${icon}</span>
      ${STEP_LABELS[i]}
    </span>`;
    if (i < STEP_LABELS.length - 1) {
      const arrowCls = isDone ? "ai-export-step-nav-arrow--done" : "";
      html += `<span class="ai-export-step-nav-arrow ${arrowCls}">→</span>`;
    }
  }
  html += `</div>`;
  return html;
}

export function renderAiExportPage() {
  const activeView = state.aiExportActiveView || "workflow";

  let html = `<div class="ai-export-layout">
    <nav class="ai-export-sidebar">
      <div class="ai-export-sidebar-title">深度分析</div>
      <button class="ai-export-sidebar-item ${activeView === 'workflow' ? 'active' : ''}" data-ai-export-view="workflow">◈ 分析操作</button>
      <button class="ai-export-sidebar-item ${activeView === 'history' ? 'active' : ''}" data-ai-export-view="history">◈ 历史任务</button>
    </nav>
    <div class="ai-export-main">
      ${activeView === 'workflow' ? renderWorkflowContent() : renderHistoryContent()}
    </div>
  </div>`;
  return html;
}

function renderWorkflowContent() {
  const taskStatus = state.aiExportTaskStatus;
  const errMsg = state.aiExportErrorMessage;
  const whereSql = state.aiExportWhereSql || "";
  const naturalSummary = state.aiExportNaturalSummary || "";

  // Determine active step
  let activeStep = 1;
  if (whereSql && !taskStatus) activeStep = 2;
  if (taskStatus === "draft" || taskStatus === "preview") activeStep = 3;
  if (taskStatus === "processing" || taskStatus === "ready") activeStep = 4;

  let html = "";

  // Step progress overview
  html += renderStepProgressBar(taskStatus, whereSql);

  // Error / expired banner
  if (taskStatus === "error") {
    html += renderErrorBanner(errMsg);
    html += `<button type="button" class="action primary" id="ai-export-restart-btn">重新开始</button>`;
  } else if (taskStatus === "expired") {
    html += `<div class="ai-export-step">
      <div class="ai-export-step-title">任务已过期</div>
      <p>该任务数据已超过保留期限，请重新创建任务。</p>
      <button type="button" class="action primary" id="ai-export-restart-btn">重新开始</button>
    </div>`;
  }

  if (taskStatus === "error" || taskStatus === "expired") {
    // Only error/expired banner — skip step rendering
  } else if (taskStatus === "processing" || taskStatus === "ready") {
    // Step 4 only — fully expanded
    html += renderStep4(taskStatus);
  } else {
    // Steps 1-3: progressive disclosure based on activeStep

    // Step 1
    if (activeStep === 1) {
      html += renderStep1QueryData(taskStatus, whereSql, naturalSummary);
    } else {
      // Collapsed summary for completed Step 1
      const summary = naturalSummary || whereSql;
      const matchCount = state.aiExportMatchCount || 0;
      html += `<details class="ai-export-step-collapsed" open>
        <summary class="ai-export-step-collapsed-summary">
          <span class="ai-export-step-collapsed-label">✓ Step 1: 查询数据</span>
          <span class="ai-export-step-collapsed-detail">${escapeHtml(summary)} — ${matchCount}条工单</span>
        </summary>
        ${renderStep1QueryData(taskStatus, whereSql, naturalSummary)}
      </details>`;
    }

    // Step 2
    if (activeStep === 2) {
      html += renderStep2FieldSelection(taskStatus, whereSql, naturalSummary);
    } else if (activeStep >= 3 && ((whereSql && !taskStatus) || taskStatus === "draft" || taskStatus === "preview")) {
      // Collapsed summary for completed Step 2
      const selectedCount = countSelectedFields(state.aiExportSelectedFields || {});
      const matchCount = state.aiExportMatchCount || 0;
      html += `<details class="ai-export-step-collapsed" open>
        <summary class="ai-export-step-collapsed-summary">
          <span class="ai-export-step-collapsed-label">✓ Step 2: 选择字段</span>
          <span class="ai-export-step-collapsed-detail">${selectedCount}个字段 — ${matchCount}条工单</span>
        </summary>
        ${renderStep2FieldSelection(taskStatus, whereSql, naturalSummary)}
      </details>`;
    } else {
      // Placeholder for not-yet-reached Step 2
      html += renderStepPlaceholder(2, "选择字段");
    }

    // Step 3
    if (activeStep === 3) {
      html += renderStep3Rules(taskStatus);
    } else if (activeStep >= 4) {
      // Collapsed for completed Step 3 (not common, but possible)
      html += `<details class="ai-export-step-collapsed" open>
        <summary class="ai-export-step-collapsed-summary">
          <span class="ai-export-step-collapsed-label">✓ Step 3: 清洗规则</span>
        </summary>
        ${renderStep3Rules(taskStatus)}
      </details>`;
    } else {
      // Placeholder for not-yet-reached Step 3
      html += renderStepPlaceholder(3, "清洗规则");
    }

    // Placeholder for Step 4 (always placeholder when not processing/ready)
    html += renderStepPlaceholder(4, "导出&报表");
  }

  return html;
}

function renderHistoryContent() {
  return renderTaskList();
}

/* ── sub-renderers ── */

function renderErrorBanner(errMsg) {
  return `<div class="ai-export-step ai-export-step-error">
    <div class="ai-export-step-title">处理出错</div>
    <p class="ai-export-error-msg">${escapeHtml(errMsg || "未知错误")}</p>
  </div>`;
}

function renderStepPlaceholder(stepNum, label) {
  return `<div class="ai-export-step-placeholder">
    <span class="ai-export-step-nav-num">${stepNum}</span>
    <span class="ai-export-step-placeholder-label">${label}</span>
  </div>`;
}

function renderStep1QueryData(taskStatus, whereSql, naturalSummary) {
  const description = state.aiExportNaturalDescription || "";
  const matchCount = state.aiExportMatchCount || 0;
  const processing = state.aiExportProcessing;
  const loadingStep = state.aiExportLoadingStep || "";
  const hasQuery = whereSql && (!taskStatus || taskStatus === "draft" || taskStatus === "preview");

  // Example prompts
  const exampleHtml = AI_EXPORT_EXAMPLE_PROMPTS.map((p) =>
    `<button type="button" class="action ai-export-example-btn" data-ai-export-example="${escapeAttr(p)}">${escapeHtml(p)}</button>`
  ).join("");

  // Query result section (shown after successful query)
  let resultHtml = "";
  if (hasQuery) {
    // "重新查询" only shown when no task yet (taskStatus null) —
    // draft/preview tasks shouldn't be casually discarded
    const requeryBtnHtml = !taskStatus
      ? `<button type="button" class="action" id="ai-export-requery-btn">重新查询</button>`
      : "";
    // Show natural_summary by default, WHERE code in collapsible details
    const summaryText = naturalSummary || whereSql;
    const whereDetailsHtml = whereSql
      ? `<details class="ai-export-where-details">
          <summary class="ai-export-where-summary-btn">查看原始 SQL 条件</summary>
          <code class="ai-export-where-code">${escapeHtml(whereSql)}</code>
        </details>`
      : "";
    resultHtml = `
      <div class="ai-export-query-result">
        <div class="ai-export-step-result">
          <strong>查询条件：</strong>${escapeHtml(summaryText)}
        </div>
        ${whereDetailsHtml}
        <div class="ai-export-step-result">
          匹配工单数：<strong>${matchCount}</strong> 条
        </div>
        <div class="ai-export-form-actions">
          ${requeryBtnHtml}
        </div>
      </div>`;
  }

  // Loading state (P0-2: spinner + step text)
  const loadingHtml = processing
    ? `<div class="ai-export-loading-state">
        <div class="ai-export-loading-spinner"></div>
        <span class="ai-export-loading-text">正在${escapeHtml(loadingStep)}...</span>
      </div>`
    : "";

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 1: 查询数据</div>
    <div class="ai-export-form-group">
      <label>描述你想查询的数据：</label>
      <textarea class="ai-export-textarea" id="ai-export-description" rows="4" placeholder="例如：最近一周的所有工单">${escapeHtml(description)}</textarea>
    </div>
    <div class="ai-export-form-group">
      💡 试试这些：${exampleHtml}
    </div>
    ${hasQuery ? "" : (processing ? loadingHtml : `<div class="ai-export-form-actions">
      <button type="button" class="action primary" id="ai-export-query-btn">查询数据</button>
    </div>`)}
    ${resultHtml}
  </div>`;
}

function renderStep2FieldSelection(taskStatus, whereSql, naturalSummary) {
  const selected = state.aiExportSelectedFields || AI_EXPORT_DEFAULT_PRESELECTED;
  const previewRows = state.aiExportPreviewRows || [];
  const totalFieldCount = getAIExportTotalFieldsCount();
  const selectedCount = countSelectedFields(selected);
  const matchCount = state.aiExportMatchCount || 0;
  const summaryText = naturalSummary || whereSql;
  const whereDetailsHtml = whereSql
    ? `<details class="ai-export-where-details">
        <summary class="ai-export-where-summary-btn">查看原始 SQL 条件</summary>
        <code class="ai-export-where-code">${escapeHtml(whereSql)}</code>
      </details>`
    : "";

  // ── Field checkbox groups (using <details> collapsible pattern) ──
  const globalCheckboxState = selectedCount === totalFieldCount ? "checked" : "";
  const globalLabel = `全选全部字段 (${selectedCount}/${totalFieldCount})`;

  const groupsHtml = NODE_ORDER.map((nodeKey) => {
    const fields = AI_EXPORT_FIELDS_BY_NODE[nodeKey] || [];
    const nodeLabel = NODE_LABELS[nodeKey];
    const nodeSelectedKeys = selected[nodeKey] || [];
    const nodeTotal = fields.length;
    const nodeChecked = nodeSelectedKeys.length === nodeTotal ? "checked" : "";
    const isOpen = nodeSelectedKeys.length > 0 ? "open" : "";  // auto-expand if fields selected

    const fieldItemsHtml = fields.map((f) => {
      const isChecked = nodeSelectedKeys.includes(f.key) ? "checked" : "";
      return `<label class="ai-export-field-checkbox">
        <input type="checkbox" data-ai-export-field="${escapeAttr(nodeKey + ":" + f.key)}" ${isChecked} />
        ${escapeHtml(f.label)}
      </label>`;
    }).join("");

    return `<details class="ai-export-field-group" data-ai-export-node="${escapeAttr(nodeKey)}" ${isOpen}>
      <summary class="ai-export-field-group-summary">
        <label class="ai-export-field-checkbox ai-export-node-checkbox">
          <input type="checkbox" data-ai-export-node-select-all="${escapeAttr(nodeKey)}" ${nodeChecked} />
          <span>${escapeHtml(nodeLabel)} (${nodeSelectedKeys.length}/${nodeTotal})</span>
        </label>
      </summary>
      <div class="ai-export-field-list">${fieldItemsHtml}</div>
    </details>`;
  }).join("");

  // ── Preview table (show selected columns from preview_rows) ──
  const selectedColumns = [];
  NODE_ORDER.forEach((nodeKey) => {
    (selected[nodeKey] || []).forEach((key) => {
      selectedColumns.push(key);
    });
  });
  // Always include ticket_no
  if (!selectedColumns.includes("ticket_no")) selectedColumns.unshift("ticket_no");

  // Field label lookup
  const fieldLabelMap = {};
  NODE_ORDER.forEach((nodeKey) => {
    (AI_EXPORT_FIELDS_BY_NODE[nodeKey] || []).forEach((f) => {
      fieldLabelMap[f.key] = f.label;
    });
  });

  const previewHtml = previewRows.length > 0
    ? (() => {
        const headerLabels = selectedColumns.map((c) => fieldLabelMap[c] || c);
        const maxRows = 20;
        const displayRows = previewRows.slice(0, maxRows);
        const theadHtml = `<tr>${headerLabels.map((l) => `<th>${escapeHtml(l)}</th>`).join("")}</tr>`;
        const tbodyHtml = displayRows.map((row) =>
          `<tr>${selectedColumns.map((c) => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`
        ).join("");
        return `<div class="ai-export-preview-table-wrap">
          <table class="ai-export-preview-table"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>
        </div>`;
      })()
    : `<p class="ai-export-empty">选择字段后将显示数据预览</p>`;

  const nextBtnLabel = taskStatus ? "下一步：清洗规则" : "确认并创建任务";
  const prevBtnHtml = !taskStatus ? `<button type="button" class="action" id="ai-export-back-to-query-btn">上一步</button>` : "";

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 2: 选择字段 & 数据预览</div>
    <div class="ai-export-step-result">
      查询条件：<strong>${escapeHtml(summaryText)}</strong> — 匹配 <strong>${matchCount}</strong> 条工单
    </div>
    ${whereDetailsHtml}

    <div class="ai-export-form-group">
      <div class="ai-export-step-title" style="font-size:13px;">导出字段</div>
      <label class="ai-export-field-checkbox" style="font-weight:600;margin-bottom:8px;">
        <input type="checkbox" id="ai-export-select-all-fields" ${globalCheckboxState} />
        <span>${globalLabel}</span>
      </label>
      <div class="ai-export-field-checkbox-group">${groupsHtml}</div>
    </div>

    <div class="ai-export-form-group">
      <div class="ai-export-step-title" style="font-size:13px;">数据预览（前 20 条）</div>
      ${previewHtml}
    </div>

    <div class="ai-export-form-actions">
      ${prevBtnHtml}
      <button type="button" class="action primary" id="ai-export-next-to-rules-btn">${nextBtnLabel}</button>
    </div>
  </div>`;
}

function renderStep3Rules(taskStatus) {
  const ruleDesc = state.aiExportRuleDescription;
  const rules = state.aiExportTransformRules;
  const processing = state.aiExportProcessing;
  const hasRules = rules.length > 0;

  // If preview status and rules exist, show rule summary (not editable)
  let ruleSummaryHtml = "";
  if (hasRules) {
    const mappingRules = rules.filter((r) => r.type === "mapping");
    const computedRules = rules.filter((r) => r.type === "computed");
    const llmRules = rules.filter((r) => r.type === "llm_reasoning");

    const mappingHtml = mappingRules.map((r) => {
      const mapEntries = Object.entries(r.mapping || {}).map(([k, v]) => `${escapeHtml(k)} → ${escapeHtml(v)}`).join(" | ");
      return `<div class="ai-export-rule-item">
        <span class="ai-export-rule-type">mapping</span>: <strong>${escapeHtml(r.target_column)}</strong>
        ← ${escapeHtml(r.source_column)}
        <span class="ai-export-rule-mapping">${mapEntries}</span>
      </div>`;
    }).join("");

    const computedHtml = computedRules.map((r) => {
      return `<div class="ai-export-rule-item">
        <span class="ai-export-rule-type">computed</span>: <strong>${escapeHtml(r.target_column)}</strong>
        ← ${escapeHtml((r.source_columns || []).join(" + "))}
        (${escapeHtml(r.expression || "")})
      </div>`;
    }).join("");

    const llmHtml = llmRules.map((r) => {
      return `<div class="ai-export-rule-item">
        <span class="ai-export-rule-type">llm_reasoning</span>: <strong>${escapeHtml(r.target_column)}</strong>
        ← ${escapeHtml((r.source_columns || []).join(" + "))}
        <span class="ai-export-rule-range">取值: ${escapeHtml((r.value_range || []).join(" / "))}</span>
      </div>`;
    }).join("");

    ruleSummaryHtml = `<div class="ai-export-rule-preview">
      <div class="ai-export-rule-preview-title">规则预览（不可编辑）</div>
      ${mappingHtml}${computedHtml}${llmHtml}
    </div>`;
  }

  // Show input area if no rules yet (draft/null) or if "修改规则" was clicked
  const showInput = !hasRules || state._aiExportEditRules;
  // Show "执行导出" button when preview status + rules exist (ready to proceed to Step 4)
  const nextBtnHtml = (taskStatus === "preview" && hasRules && !showInput)
    ? `<button type="button" class="action primary" id="ai-export-start-processing-btn">执行导出</button>`
    : "";

  const loadingStep = state.aiExportLoadingStep || "";
  const loadingHtml = processing
    ? `<div class="ai-export-loading-state">
        <div class="ai-export-loading-spinner"></div>
        <span class="ai-export-loading-text">正在${escapeHtml(loadingStep)}...</span>
      </div>`
    : "";

  const inputHtml = showInput
    ? (processing ? loadingHtml : `<div class="ai-export-form-row">
        <label>清洗规则描述：</label>
        <textarea class="ai-export-textarea" id="ai-export-rule-desc" rows="4" placeholder="例如：新增列'风险等级'，取值['高风险','低风险']，severity致命/严重→高风险，一般→低风险">${escapeHtml(ruleDesc)}</textarea>
      </div>
      <div class="ai-export-form-actions">
        <button type="button" class="action primary" id="ai-export-translate-btn">生成规则</button>
      </div>`)
    : `<div class="ai-export-form-actions">
        <button type="button" class="action" id="ai-export-edit-rules-btn">修改规则</button>
        ${nextBtnHtml}
      </div>`;

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 3: 清洗规则</div>
    ${inputHtml}
    ${ruleSummaryHtml}
  </div>`;
}

function renderStep4(status) {
  let html = `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 4: ${status === "processing" ? "处理进度" : "导出 / 报告"}</div>`;

  if (status === "processing") {
    const total = state.aiExportTotalRows;
    const processed = state.aiExportProcessedRows;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    html += `<div class="ai-export-progress-bar-wrap">
      <div class="ai-export-progress-bar" style="width: ${pct}%"></div>
      <span class="ai-export-progress-text">${processed}/${total} 行 (${pct}%)</span>
    </div>
    <div class="ai-export-form-actions">
      <button type="button" class="action danger" id="ai-export-cancel-btn">取消处理</button>
    </div>`;
  }

  if (status === "ready") {
    // Export section
    html += `<div class="ai-export-export-section">
      <div class="ai-export-section-title">导出</div>
      <div class="ai-export-form-actions">
        <button type="button" class="action primary" id="ai-export-download-btn">导出 Excel</button>
      </div>
    </div>`;

    // Report section
    const reportPrompt = state.aiExportReportPrompt;
    const reportStatus = state.aiExportReportStatus;

    html += `<div class="ai-export-report-section">
      <div class="ai-export-section-title">分析报告（可选）</div>`;

    if (reportStatus === "done") {
      html += `<div class="ai-export-form-actions">
        <button type="button" class="action primary" id="ai-export-view-report-btn">查看报告</button>
        <button type="button" class="action" id="ai-export-generate-report-btn">重新生成</button>
      </div>`;
    } else if (reportStatus === "generating") {
      html += `<div class="ai-export-form-actions">
        <button type="button" class="action" disabled>报告生成中…</button>
      </div>`;
    } else {
      html += `<div class="ai-export-form-row">
        <textarea class="ai-export-textarea" id="ai-export-report-prompt" rows="3" placeholder="例如：按局点分组统计工单数量，给出饼图">${escapeHtml(reportPrompt)}</textarea>
      </div>
      <div class="ai-export-form-actions">
        <button type="button" class="action primary" id="ai-export-generate-report-btn">生成报告</button>
      </div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function showReportPromptDialog(taskId) {
  const overlay = document.createElement("div");
  overlay.className = "ai-export-dialog-overlay";
  overlay.innerHTML = `
    <div class="ai-export-dialog">
      <div class="ai-export-dialog-title">生成分析报告</div>
      <textarea class="ai-export-dialog-textarea" placeholder="请输入报告需求描述，例如：分析工单的严重性分布和趋势"></textarea>
      <div class="ai-export-dialog-actions">
        <button class="ai-export-dialog-cancel">取消</button>
        <button class="action ai-export-dialog-confirm">生成报告</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector(".ai-export-dialog-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".ai-export-dialog-confirm").addEventListener("click", async () => {
    const prompt = overlay.querySelector(".ai-export-dialog-textarea").value.trim();
    if (!prompt) return;
    overlay.remove();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: _opId(), report_prompt: prompt }),
      });
      if (resp.ok) {
        state.aiExportErrorMessage = "";
        await fetchAiExportTaskList(state.aiExportTaskListPage);
        requestRender();
        // Start polling for report generation completion
        _pollReportGeneration(taskId);
      } else {
        const data = await resp.json();
        state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
        requestRender();
      }
    } catch (e) {
      state.aiExportErrorMessage = e.message;
      requestRender();
    }
  });
}

let _reportPollTimer = null;

function _pollReportGeneration(taskId) {
  if (_reportPollTimer) clearInterval(_reportPollTimer);
  _reportPollTimer = setInterval(async () => {
    await fetchAiExportTaskList(state.aiExportTaskListPage);
    // Find the task in the list to check its report_status
    const task = (state.aiExportTaskList || []).find(t => t.task_id === parseInt(taskId));
    if (task && task.report_status !== "generating") {
      clearInterval(_reportPollTimer);
      _reportPollTimer = null;
      requestRender();
    }
  }, 5000); // Poll every 5 seconds
}

function renderTaskList() {
  const tasks = state.aiExportTaskList;
  const total = state.aiExportTaskListTotal;
  const page = state.aiExportTaskListPage;
  const totalPages = Math.ceil(total / 20) || 1;

  if (!tasks.length && total === 0) {
    return `<div class="ai-export-history-empty">暂无任务记录</div>`;
  }

  const truncate = (text, max) => text && text.length > max ? text.slice(0, max) + "…" : (text || "");

  const statusMap = { draft: "草稿", preview: "预览中", processing: "处理中", ready: "已完成", expired: "已过期", error: "出错" };
  const statusColorMap = { draft: "draft", preview: "preview", processing: "processing", ready: "ready", expired: "expired", error: "error" };

  const cardsHtml = tasks.map((t) => {
    const statusLabel = statusMap[t.status] || t.status;
    const statusClass = statusColorMap[t.status] || "";
    const createdAt = t.created_at ? new Date(t.created_at).toLocaleString("zh-CN") : "";
    const actions = [];

    // Resume (draft/preview)
    if (t.status === "draft" || t.status === "preview") {
      actions.push(`<button type="button" class="action primary ai-export-tl-action" data-ai-export-tl-resume="${t.task_id}">继续</button>`);
    }

    // Ready task actions
    if (t.status === "ready") {
      actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-download="${t.task_id}">下载Excel</button>`);
      actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-preview-excel="${t.task_id}">预览</button>`);
      if (t.report_status === "done") {
        actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-report="${t.task_id}">查看报告</button>`);
        actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-download-report="${t.task_id}">下载报告</button>`);
      } else if (t.report_status === "none") {
        actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-gen-report="${t.task_id}">生成报告</button>`);
      } else if (t.report_status === "generating") {
        actions.push(`<span class="ai-export-tl-action ai-export-tl-action-disabled">报告生成中…</span>`);
      }
    }

    // Delete (always)
    actions.push(`<button type="button" class="action danger ai-export-tl-action" data-ai-export-tl-delete="${t.task_id}">删除</button>`);

    // Fields
    const queryText = truncate(t.query_summary || t.query_description, 50);
    const ruleText = truncate(t.rule_summary, 50);
    const reportText = truncate(t.report_prompt, 50);

    return `<div class="ai-export-history-card">
      <div class="ai-export-history-card-header">
        <span class="ai-export-history-card-id">#${t.task_id}</span>
        <span class="ai-export-history-card-status ai-export-history-card-status-${statusClass}">${escapeHtml(statusLabel)}</span>
        <span class="ai-export-history-card-meta">${t.total_rows}行 · ${createdAt}</span>
      </div>
      <div class="ai-export-history-card-body">
        ${queryText ? `<div class="ai-export-history-card-field"><span class="ai-export-history-card-field-label">查询：</span>${escapeHtml(queryText)}</div>` : ""}
        ${ruleText ? `<div class="ai-export-history-card-field"><span class="ai-export-history-card-field-label">规则：</span>${escapeHtml(ruleText)}</div>` : ""}
        ${reportText ? `<div class="ai-export-history-card-field"><span class="ai-export-history-card-field-label">报告：</span>${escapeHtml(reportText)}</div>` : ""}
      </div>
      <div class="ai-export-history-card-actions">
        ${actions.join(" ")}
      </div>
    </div>`;
  }).join("");

  return `${cardsHtml}
    <div class="ai-export-pagination">
      <span>第 ${page} 页 / 共 ${totalPages} 页</span>
      <button type="button" class="action" id="ai-export-tl-prev" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <button type="button" class="action" id="ai-export-tl-next" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    </div>`;
}

/* ── bind ── */

export async function bindAiExportPage() {
  // Load DOMPurify on first bind
  await loadDOMPurify();

  // Initialize aiExportActiveView
  if (!state.aiExportActiveView) state.aiExportActiveView = "workflow";

  // Sidebar view switching
  document.querySelectorAll("[data-ai-export-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.aiExportActiveView = btn.dataset.aiExportView;
      requestRender();
    });
  });

  // Fetch task list silently on first load
  if (!state._aiExportInitialLoaded) {
    state._aiExportInitialLoaded = true;
    // Initialize new state fields if not set
    if (!state.aiExportSelectedFields) {
      state.aiExportSelectedFields = AI_EXPORT_DEFAULT_PRESELECTED;
    }
    if (!state.aiExportNaturalDescription) state.aiExportNaturalDescription = "";
    if (!state.aiExportWhereSql) state.aiExportWhereSql = "";
    if (!state.aiExportMatchCount) state.aiExportMatchCount = 0;
    if (!state.aiExportNaturalSummary) state.aiExportNaturalSummary = "";
    if (!state.aiExportLoadingStep) state.aiExportLoadingStep = "";
    try {
      const taskResp = await fetch(`${API_BASE_URL}/api/ai-export/tasks?operator_id=${encodeURIComponent(_opId())}&page=1&size=20`);
      if (taskResp.ok) { const d = await taskResp.json(); state.aiExportTaskList = d.items || []; state.aiExportTaskListTotal = d.total || 0; }
    } catch (_) { /* ignore */ }
    requestRender();
  }

  // Restart progress polling if task is processing
  if (state.aiExportTaskStatus === "processing" && state.aiExportCurrentTaskId) {
    startProgressPolling(state.aiExportCurrentTaskId);
  }

  // ── Step 1: 查询数据 bindings ──

  // Query by description button
  const queryBtn = document.getElementById("ai-export-query-btn");
  if (queryBtn) {
    queryBtn.addEventListener("click", () => {
      const desc = document.getElementById("ai-export-description")?.value || "";
      if (!desc.trim()) {
        state.aiExportErrorMessage = "请输入查询描述";
        requestRender();
        return;
      }
      state.aiExportNaturalDescription = desc.trim();
      fetchAiExportQueryByDescription();
    });
  }

  // Example prompt buttons (fill description + auto-query)
  document.querySelectorAll("[data-ai-export-example]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const example = btn.getAttribute("data-ai-export-example");
      state.aiExportNaturalDescription = example;
      requestRender();
    });
  });

  // Re-query button (clear old WHERE + show query form again)
  const requeryBtn = document.getElementById("ai-export-requery-btn");
  if (requeryBtn) {
    requeryBtn.addEventListener("click", () => {
      state.aiExportWhereSql = "";
      state.aiExportMatchCount = 0;
      state.aiExportPreviewRows = [];
      requestRender();
    });
  }

  // Next to fields button (transition from Step 1 to Step 2)
  // nextToFieldsBtn removed — preview rows now auto-fetched on query success

  // ── Step 2: 选择字段 bindings ──

  // Global select all checkbox
  const selectAllBtn = document.getElementById("ai-export-select-all-fields");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("change", () => {
      if (selectAllBtn.checked) {
        state.aiExportSelectedFields = getAIExportDefaultSelectedFields();
      } else {
        // Uncheck all
        state.aiExportSelectedFields = {};
        NODE_ORDER.forEach((nodeKey) => {
          state.aiExportSelectedFields[nodeKey] = [];
        });
      }
      requestRender();
    });
  }

  // Node-level select all checkboxes
  document.querySelectorAll("[data-ai-export-node-select-all]").forEach((el) => {
    el.addEventListener("change", () => {
      const nodeKey = el.getAttribute("data-ai-export-node-select-all");
      const fields = AI_EXPORT_FIELDS_BY_NODE[nodeKey] || [];
      if (el.checked) {
        state.aiExportSelectedFields[nodeKey] = fields.map((f) => f.key);
      } else {
        state.aiExportSelectedFields[nodeKey] = [];
      }
      requestRender();
    });
  });

  // Individual field checkboxes
  document.querySelectorAll("[data-ai-export-field]").forEach((el) => {
    el.addEventListener("change", () => {
      const fieldAttr = el.getAttribute("data-ai-export-field");
      const [nodeKey, fieldKey] = fieldAttr.split(":");
      if (!nodeKey || !fieldKey) return;
      const current = state.aiExportSelectedFields[nodeKey] || [];
      if (el.checked) {
        if (!current.includes(fieldKey)) {
          state.aiExportSelectedFields[nodeKey] = [...current, fieldKey];
        }
      } else {
        state.aiExportSelectedFields[nodeKey] = current.filter((k) => k !== fieldKey);
      }
      requestRender();
    });
  });

  // Back to query button (Step 2 → Step 1)
  const backToQueryBtn = document.getElementById("ai-export-back-to-query-btn");
  if (backToQueryBtn) {
    backToQueryBtn.addEventListener("click", () => {
      // Clear where_sql + preview to go back to Step 1
      state.aiExportWhereSql = "";
      state.aiExportMatchCount = 0;
      state.aiExportPreviewRows = [];
      requestRender();
    });
  }

  // Next to rules button (Step 2 → Step 3, creates task if not yet created)
  const nextToRulesBtn = document.getElementById("ai-export-next-to-rules-btn");
  if (nextToRulesBtn) {
    nextToRulesBtn.addEventListener("click", () => {
      // Validate at least some fields selected
      const selectedCount = countSelectedFields(state.aiExportSelectedFields || {});
      if (selectedCount < 1) {
        state.aiExportErrorMessage = "请至少选择一个导出字段";
        requestRender();
        return;
      }
      // If task not yet created (whereSql set but no taskStatus), create it
      if (state.aiExportWhereSql && !state.aiExportTaskStatus) {
        state.aiExportSourceConfig = state.aiExportSourceConfig || { template_code: "HCS_INCIDENT" };
        fetchAiExportCreateTask();
      }
      // If task already exists (draft/preview), just move to next step
    });
  }

  // ── Step 3: 清洗规则 bindings ──

  const translateBtn = document.getElementById("ai-export-translate-btn");
  if (translateBtn) {
    translateBtn.addEventListener("click", () => {
      const desc = document.getElementById("ai-export-rule-desc")?.value || "";
      if (!desc.trim()) {
        state.aiExportErrorMessage = "请输入清洗规则描述";
        requestRender();
        return;
      }
      state.aiExportRuleDescription = desc.trim();
      state._aiExportEditRules = false;
      fetchAiExportTranslateRules();
    });
  }

  const editRulesBtn = document.getElementById("ai-export-edit-rules-btn");
  if (editRulesBtn) {
    editRulesBtn.addEventListener("click", () => {
      state._aiExportEditRules = true;
      requestRender();
    });
  }

  const startProcessingBtn = document.getElementById("ai-export-start-processing-btn");
  if (startProcessingBtn) {
    startProcessingBtn.addEventListener("click", () => {
      fetchAiExportStartProcessing();
    });
  }

  // ── Step 4 bindings ── (unchanged)

  const cancelBtn = document.getElementById("ai-export-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      fetchAiExportCancel();
    });
  }

  const downloadBtn = document.getElementById("ai-export-download-btn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const taskId = state.aiExportCurrentTaskId;
      if (!taskId) return;
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/download?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  }

  const generateReportBtn = document.getElementById("ai-export-generate-report-btn");
  if (generateReportBtn) {
    generateReportBtn.addEventListener("click", () => {
      // "重新生成" button: show textarea by resetting reportStatus
      if (state.aiExportReportStatus === "done") {
        state.aiExportReportStatus = "none";
        requestRender();
        return;
      }
      const prompt = document.getElementById("ai-export-report-prompt")?.value || "";
      if (!prompt.trim()) {
        state.aiExportErrorMessage = "请输入报告描述";
        requestRender();
        return;
      }
      state.aiExportReportPrompt = prompt.trim();
      fetchAiExportGenerateReport();
    });
  }

  const viewReportBtn = document.getElementById("ai-export-view-report-btn");
  if (viewReportBtn) {
    viewReportBtn.addEventListener("click", () => {
      const taskId = state.aiExportCurrentTaskId;
      if (!taskId) return;
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/report-html?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  }

  // ── Restart button ──

  const restartBtn = document.getElementById("ai-export-restart-btn");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      stopProgressPolling();
      state.aiExportCurrentTaskId = null;
      state.aiExportTaskStatus = null;
      state.aiExportTotalRows = 0;
      state.aiExportProcessedRows = 0;
      state.aiExportErrorMessage = "";
      state.aiExportTransformRules = [];
      state.aiExportPreviewRows = [];
      state.aiExportOriginalColumns = [];
      state.aiExportSelectedFields = AI_EXPORT_DEFAULT_PRESELECTED;
      state.aiExportSourceConfig = { template_code: "HCS_INCIDENT" };
      state.aiExportNaturalDescription = "";
      state.aiExportWhereSql = "";
      state.aiExportMatchCount = 0;
      state.aiExportNaturalSummary = "";
      state.aiExportLoadingStep = "";
      state.aiExportRuleDescription = "";
      state.aiExportProcessing = false;
      state.aiExportFullProcessing = false;
      state.aiExportActiveView = "workflow";
      state.aiExportReportPrompt = "";
      state.aiExportReportStatus = "none";
      state._aiExportEditRules = false;
      requestRender();
    });
  }

  // ── Task list bindings ──

  document.querySelectorAll("[data-ai-export-tl-resume]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = parseInt(btn.getAttribute("data-ai-export-tl-resume"));
      if (!taskId) return;
      state.aiExportActiveView = "workflow";
      await fetchAiExportResumeTask(taskId);
    });
  });

  document.querySelectorAll("[data-ai-export-tl-download]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-download");
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/download?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  });

  document.querySelectorAll("[data-ai-export-tl-preview-excel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-preview-excel");
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/preview-excel?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  });

  document.querySelectorAll("[data-ai-export-tl-report]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-report");
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/report-html?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  });

  document.querySelectorAll("[data-ai-export-tl-download-report]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-download-report");
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/report-download?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  });

  document.querySelectorAll("[data-ai-export-tl-gen-report]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-gen-report");
      showReportPromptDialog(taskId);
    });
  });

  document.querySelectorAll("[data-ai-export-tl-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = parseInt(btn.getAttribute("data-ai-export-tl-delete"));
      if (!taskId) return;
      try {
        const resp = await fetch(`${API_BASE_URL}/api/ai-export/tasks/${taskId}?operator_id=${encodeURIComponent(_opId())}`, {
          method: "DELETE",
        });
        if (resp.ok) {
          await fetchAiExportTaskList(state.aiExportTaskListPage);
        } else {
          const data = await resp.json();
          state.aiExportErrorMessage = data.detail || `HTTP ${resp.status}`;
          requestRender();
        }
      } catch (e) {
        state.aiExportErrorMessage = e.message;
        requestRender();
      }
    });
  });

  const prevBtn = document.getElementById("ai-export-tl-prev");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (state.aiExportTaskListPage > 1) {
        fetchAiExportTaskList(state.aiExportTaskListPage - 1);
      }
    });
  }

  const nextBtn = document.getElementById("ai-export-tl-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const totalPages = Math.ceil(state.aiExportTaskListTotal / 20) || 1;
      if (state.aiExportTaskListPage < totalPages) {
        fetchAiExportTaskList(state.aiExportTaskListPage + 1);
      }
    });
  }
}