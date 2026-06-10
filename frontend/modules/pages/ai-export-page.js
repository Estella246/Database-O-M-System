import { escapeHtml, escapeAttr } from "../utils/escape.js";
import {
  AI_EXPORT_FIELDS_BY_NODE,
  AI_EXPORT_SYSTEM_FIELDS_ALL,
  NODE_LABELS,
  NODE_ORDER,
  AI_EXPORT_DEFAULT_PRESELECTED,
  AI_EXPORT_EXAMPLE_PROMPTS,
  getAIExportTotalFieldsCount,
  getAIExportDefaultSelectedFields,
  countSelectedFields,
  buildExportColumns,
} from "../constants/ai-export-fields.js";
import { sanitizeReportHtml, loadDOMPurify } from "../utils/dompurify-wrapper.js";
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
  requestRender();
  try {
    const description = state.aiExportNaturalDescription || "";
    if (!description.trim()) {
      state.aiExportErrorMessage = "请输入查询描述";
      state.aiExportProcessing = false;
      requestRender();
      return;
    }
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
    if (resp.ok) {
      state.aiExportWhereSql = data.where_sql;
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
      // Fetch the report HTML for preview
      await fetchAiExportReportHtml();
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

async function fetchAiExportReportHtml() {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/tasks/${state.aiExportCurrentTaskId}/report-html`
    );
    if (resp.ok) {
      state.aiExportReportHtml = await resp.text();
    }
  } catch (_) {
    state.aiExportReportHtml = "";
  }
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

export async function fetchAiExportTemplates() {
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/ai-export/templates?operator_id=${encodeURIComponent(_opId())}`
    );
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportTemplates = data.items || [];
    }
  } catch (_) {
    state.aiExportTemplates = [];
  }
  requestRender();
}

/* ── progress polling ── */

function startProgressPolling(taskId) {
  if (state._aiExportProgressTimer) clearInterval(state._aiExportProgressTimer);
  state._aiExportProgressTimer = setInterval(async () => {
    try {
      const resp = await fetch(
        `${API_BASE_URL}/api/ai-export/tasks/${taskId}/progress?operator_id=${encodeURIComponent(_opId())}`
      );
      if (resp.ok) {
        const data = await resp.json();
        state.aiExportProcessedRows = data.processed_rows;
        state.aiExportTaskStatus = data.status;
        state.aiExportErrorMessage = data.error_message || "";
        if (data.status === "ready" || data.status === "error") {
          stopProgressPolling();
          fetchAiExportTaskList(); // refresh history when processing completes
        }
        requestRender();
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
  const taskStatus = state.aiExportTaskStatus;
  const templates = state.aiExportTemplates;
  const errMsg = state.aiExportErrorMessage;
  const whereSql = state.aiExportWhereSql || "";

  let html = `<section class="ai-export-page" aria-label="深度分析">`;

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

  // Step 1: 查询数据 — always shown unless processing/ready/error/expired
  if (!taskStatus || taskStatus === "draft" || taskStatus === "preview") {
    html += renderStep1QueryData(taskStatus, whereSql, templates);
  }

  // Step 2: 选择字段 + 数据预览 — shown after query-by-description succeeds (whereSql available, no task yet)
  // or when task is draft/preview (going back from Step 3)
  if ((whereSql && !taskStatus) || taskStatus === "draft" || taskStatus === "preview") {
    html += renderStep2FieldSelection(taskStatus, whereSql);
  }

  // Step 3: 清洗规则 — shown when task is draft (after creation) or preview (after rule translation)
  if (taskStatus === "draft" || taskStatus === "preview") {
    html += renderStep3Rules(taskStatus);
  }

  // Step 4: shown when processing or ready
  if (taskStatus === "processing" || taskStatus === "ready") {
    html += renderStep4(taskStatus);
  }

  // History task list (always shown)
  html += renderTaskList();

  html += `</section>`;
  return html;
}

/* ── sub-renderers ── */

function renderErrorBanner(errMsg) {
  return `<div class="ai-export-step ai-export-step-error">
    <div class="ai-export-step-title">处理出错</div>
    <p class="ai-export-error-msg">${escapeHtml(errMsg || "未知错误")}</p>
  </div>`;
}

function renderStep1QueryData(taskStatus, whereSql, templates) {
  const description = state.aiExportNaturalDescription || "";
  const matchCount = state.aiExportMatchCount || 0;
  const processing = state.aiExportProcessing;
  const hasQuery = whereSql && !taskStatus;  // query-by-description done but no task yet

  // Example prompts
  const exampleHtml = AI_EXPORT_EXAMPLE_PROMPTS.map((p) =>
    `<button type="button" class="action ai-export-example-btn" data-ai-export-example="${escapeAttr(p)}">${escapeHtml(p)}</button>`
  ).join("");

  // Template dropdown
  const templateOptionsHtml = templates.map((t) =>
    `<option value="${escapeAttr(String(t.id))}">${escapeHtml(t.name)}</option>`
  ).join("");

  // Query result section (shown after successful query)
  let resultHtml = "";
  if (hasQuery) {
    resultHtml = `
      <div class="ai-export-query-result">
        <div class="ai-export-step-result">
          <strong>生成的条件：</strong>
          <code class="ai-export-where-code">${escapeHtml(whereSql)}</code>
        </div>
        <div class="ai-export-step-result">
          匹配工单数：<strong>${matchCount}</strong> 条
        </div>
        <div class="ai-export-form-actions">
          <button type="button" class="action" id="ai-export-requery-btn">重新查询</button>
          <button type="button" class="action primary" id="ai-export-next-to-fields-btn">下一步：选择字段</button>
        </div>
      </div>`;
  }

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 1: 查询数据</div>
    <div class="ai-export-form-group">
      <label>描述你想查询的数据：</label>
      <textarea class="ai-export-textarea" id="ai-export-description" rows="4" placeholder="例如：最近一周的所有工单">${escapeHtml(description)}</textarea>
    </div>
    <div class="ai-export-form-group">
      💡 试试这些：${exampleHtml}
    </div>
    <div class="ai-export-form-row">
      <label>从模板加载：<select class="ai-export-select" id="ai-export-rule-template">
        <option value="">-- 从已有模板加载 --</option>${templateOptionsHtml}
      </select></label>
    </div>
    ${hasQuery ? "" : `<div class="ai-export-form-actions">
      <button type="button" class="action primary" id="ai-export-query-btn" ${processing ? "disabled" : ""}>${processing ? "查询中…" : "查询数据"}</button>
    </div>`}
    ${resultHtml}
  </div>`;
}

function renderStep2FieldSelection(taskStatus, whereSql) {
  const selected = state.aiExportSelectedFields || AI_EXPORT_DEFAULT_PRESELECTED;
  const previewRows = state.aiExportPreviewRows || [];
  const totalFieldCount = getAIExportTotalFieldsCount();
  const selectedCount = countSelectedFields(selected);
  const matchCount = state.aiExportMatchCount || 0;

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
      查询条件：<code>${escapeHtml(whereSql)}</code> — 匹配 <strong>${matchCount}</strong> 条工单
    </div>

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

  const inputHtml = showInput
    ? `<div class="ai-export-form-row">
        <label>清洗规则描述：</label>
        <textarea class="ai-export-textarea" id="ai-export-rule-desc" rows="4" placeholder="例如：新增列'风险等级'，取值['高风险','低风险']，severity致命/严重→高风险，一般→低风险">${escapeHtml(ruleDesc)}</textarea>
      </div>
      <div class="ai-export-form-actions">
        <button type="button" class="action primary" id="ai-export-translate-btn" ${processing ? "disabled" : ""}>${processing ? "翻译中…" : "生成规则"}</button>
      </div>`
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
        <button type="button" class="action" id="ai-export-save-template-btn">保存为模板</button>
      </div>
    </div>`;

    // Report section
    const reportPrompt = state.aiExportReportPrompt;
    const reportStatus = state.aiExportReportStatus;
    const reportHtml = state.aiExportReportHtml;

    html += `<div class="ai-export-report-section">
      <div class="ai-export-section-title">分析报告（可选）</div>
      <div class="ai-export-form-row">
        <textarea class="ai-export-textarea" id="ai-export-report-prompt" rows="3" placeholder="例如：按局点分组统计工单数量，给出饼图">${escapeHtml(reportPrompt)}</textarea>
      </div>
      <div class="ai-export-form-actions">
        <button type="button" class="action primary" id="ai-export-generate-report-btn" ${reportStatus === "generating" ? "disabled" : ""}>${reportStatus === "generating" ? "生成中…" : (reportStatus === "done" ? "重新生成" : "生成报告")}</button>
      </div>`;

    if (reportStatus === "done" && reportHtml) {
      const sanitized = sanitizeReportHtml(reportHtml);
      html += `<div class="ai-export-report-preview" id="ai-export-report-preview">${sanitized}</div>
        <div class="ai-export-form-actions">
          <button type="button" class="action" id="ai-export-download-report-btn">下载报告 HTML</button>
        </div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function renderTaskList() {
  const tasks = state.aiExportTaskList;
  const total = state.aiExportTaskListTotal;
  const page = state.aiExportTaskListPage;
  const totalPages = Math.ceil(total / 20) || 1;

  if (!tasks.length && total === 0) {
    return `<div class="ai-export-task-list-section">
      <div class="ai-export-section-title">历史任务</div>
      <p class="ai-export-empty">暂无任务记录</p>
    </div>`;
  }

  const rowsHtml = tasks.map((t) => {
    const statusLabel = { draft: "草稿", preview: "预览中", processing: "处理中", ready: "已完成", expired: "已过期", error: "出错" };
    const s = statusLabel[t.status] || t.status;
    const createdAt = t.created_at ? new Date(t.created_at).toLocaleString("zh-CN") : "";
    const actions = [];
    if (t.status === "ready") {
      actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-download="${t.task_id}">下载</button>`);
      if (t.report_status === "done") {
        actions.push(`<button type="button" class="action ai-export-tl-action" data-ai-export-tl-report="${t.task_id}">报告</button>`);
      }
    }
    actions.push(`<button type="button" class="action danger ai-export-tl-action" data-ai-export-tl-delete="${t.task_id}">删除</button>`);
    return `<tr>
      <td>${t.task_id}</td>
      <td>${escapeHtml(s)}</td>
      <td>${t.total_rows}</td>
      <td>${createdAt}</td>
      <td>${actions.join(" ")}</td>
    </tr>`;
  }).join("");

  return `<div class="ai-export-task-list-section">
    <div class="ai-export-section-title">历史任务</div>
    <table class="ai-export-task-list">
      <thead><tr><th>ID</th><th>状态</th><th>行数</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="ai-export-pagination">
      <span>第 ${page} 页 / 共 ${totalPages} 页</span>
      <button type="button" class="action" id="ai-export-tl-prev" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <button type="button" class="action" id="ai-export-tl-next" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    </div>
  </div>`;
}

/* ── bind ── */

export async function bindAiExportPage() {
  // Load DOMPurify on first bind
  await loadDOMPurify();

  // Fetch templates + task list silently on first load
  if (!state._aiExportInitialLoaded) {
    state._aiExportInitialLoaded = true;
    // Initialize new state fields if not set
    if (!state.aiExportSelectedFields) {
      state.aiExportSelectedFields = AI_EXPORT_DEFAULT_PRESELECTED;
    }
    if (!state.aiExportNaturalDescription) state.aiExportNaturalDescription = "";
    if (!state.aiExportWhereSql) state.aiExportWhereSql = "";
    if (!state.aiExportMatchCount) state.aiExportMatchCount = 0;
    try {
      const tplResp = await fetch(`${API_BASE_URL}/api/ai-export/templates?operator_id=${encodeURIComponent(_opId())}`);
      if (tplResp.ok) { const tplData = await tplResp.json(); state.aiExportTemplates = tplData.items || []; }
    } catch (_) { /* ignore */ }
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
  const nextToFieldsBtn = document.getElementById("ai-export-next-to-fields-btn");
  if (nextToFieldsBtn) {
    nextToFieldsBtn.addEventListener("click", () => {
      // Fetch preview rows for Step 2
      fetchAiExportPreviewRows();
    });
  }

  // Template load: fill natural_description + where_sql from template
  const templateSelect = document.getElementById("ai-export-rule-template");
  if (templateSelect) {
    templateSelect.addEventListener("change", () => {
      const tplId = parseInt(templateSelect.value);
      if (!tplId) return;
      const tpl = state.aiExportTemplates.find((t) => t.id === tplId);
      if (!tpl) return;
      // Fill description from template's natural_description
      state.aiExportNaturalDescription = tpl.natural_description || "";
      state.aiExportWhereSql = tpl.where_sql || "";
      state.aiExportSourceConfig = tpl.source_config || {};
      if (tpl.original_columns) {
        // Reconstruct selectedFields from flat original_columns
        const selected = {};
        NODE_ORDER.forEach((nodeKey) => {
          const nodeFields = (AI_EXPORT_FIELDS_BY_NODE[nodeKey] || []).map((f) => f.key);
          selected[nodeKey] = nodeFields.filter((k) => tpl.original_columns.includes(k));
        });
        state.aiExportSelectedFields = selected;
      }
      state.aiExportTransformRules = tpl.transform_rules || [];
      if (tpl.transform_rules && tpl.transform_rules.length) {
        state.aiExportRuleDescription = tpl.transform_rules
          .map((r) => `${r.type}: ${r.target_column}`)
          .join("; ");
      }
      requestRender();
    });
  }

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

  const saveTemplateBtn = document.getElementById("ai-export-save-template-btn");
  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener("click", async () => {
      const name = prompt("请输入模板名称：");
      if (!name || !name.trim()) return;
      try {
        const resp = await fetch(`${API_BASE_URL}/api/ai-export/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: _opId(),
            name: name.trim(),
            natural_description: state.aiExportNaturalDescription || "",
            where_sql: state.aiExportWhereSql || "",
            source_config: state.aiExportSourceConfig || {},
            original_columns: state.aiExportOriginalColumns || [],
            transform_rules: state.aiExportTransformRules || [],
          }),
        });
        if (resp.ok) {
          await fetchAiExportTemplates();
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

  const generateReportBtn = document.getElementById("ai-export-generate-report-btn");
  if (generateReportBtn) {
    generateReportBtn.addEventListener("click", () => {
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

  const downloadReportBtn = document.getElementById("ai-export-download-report-btn");
  if (downloadReportBtn) {
    downloadReportBtn.addEventListener("click", () => {
      const taskId = state.aiExportCurrentTaskId;
      if (!taskId) return;
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/report-download?operator_id=${encodeURIComponent(_opId())}`, "_blank");
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
      state.aiExportRuleDescription = "";
      state.aiExportProcessing = false;
      state.aiExportFullProcessing = false;
      state.aiExportReportPrompt = "";
      state.aiExportReportStatus = "none";
      state.aiExportReportHtml = "";
      state._aiExportEditRules = false;
      requestRender();
    });
  }

  // ── Task list bindings ──

  document.querySelectorAll("[data-ai-export-tl-download]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-download");
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/download?operator_id=${encodeURIComponent(_opId())}`, "_blank");
    });
  });

  document.querySelectorAll("[data-ai-export-tl-report]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-ai-export-tl-report");
      window.open(`${API_BASE_URL}/api/ai-export/tasks/${taskId}/report-download?operator_id=${encodeURIComponent(_opId())}`, "_blank");
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