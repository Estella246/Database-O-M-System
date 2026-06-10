import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { AI_EXPORT_COLUMNS, AI_EXPORT_FIELD_GROUPS } from "../constants/ai-export-fields.js";
import { sanitizeReportHtml, loadDOMPurify } from "../utils/dompurify-wrapper.js";
import { API_BASE_URL } from "../services/api.js";
import { state } from "../state/state.js";
import { whitelistAllows } from "../utils/normalize.js";
import { requestRender } from "../core/scheduler.js";

/* ── ensure tab ── */

export function ensureAiExportTab() {
  const key = "ai:export";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "数据智析", closable: true });
  }
  return key;
}

/* ── API fetch helpers ── */

function _opId() {
  return state.localUser?.account || "demo_001";
}

export async function fetchAiExportCreateTask() {
  state.aiExportProcessing = true;
  requestRender();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/ai-export/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: _opId(),
        source_config: state.aiExportSourceConfig,
        original_columns: state.aiExportOriginalColumns,
      }),
    });
    const data = await resp.json();
    if (resp.ok) {
      state.aiExportCurrentTaskId = data.task_id;
      state.aiExportTaskStatus = data.status;
      state.aiExportTotalRows = data.total_rows;
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

export function renderAiExportPage() {
  const status = state.aiExportTaskStatus;
  const templates = state.aiExportTemplates;
  const errMsg = state.aiExportErrorMessage;

  let html = `<section class="ai-export-page" aria-label="数据智析">`;

  // Error / expired banner
  if (status === "error") {
    html += renderErrorBanner(errMsg);
    html += `<button type="button" class="action primary" id="ai-export-restart-btn">重新开始</button>`;
  } else if (status === "expired") {
    html += `<div class="ai-export-step">
      <div class="ai-export-step-title">任务已过期</div>
      <p>该任务数据已超过保留期限，请重新创建任务。</p>
      <button type="button" class="action primary" id="ai-export-restart-btn">重新开始</button>
    </div>`;
  }

  // Step 1: always shown unless processing/ready/error/expired
  if (status === null || status === "draft" || status === "preview") {
    html += renderStep1(status, templates);
  }

  // Step 2: shown when draft or preview (preview shows rule result)
  if (status === null || status === "draft" || status === "preview") {
    html += renderStep2(status);
  }

  // Step 3: shown when preview
  if (status === "preview") {
    html += renderStep3();
  }

  // Step 4: shown when processing or ready
  if (status === "processing" || status === "ready") {
    html += renderStep4(status);
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

function renderStep1(status, templates) {
  const src = state.aiExportSourceConfig;
  const cols = state.aiExportOriginalColumns;
  const timeFrom = src.time_range?.from || "";
  const timeTo = src.time_range?.to || "";
  const templateCode = src.template_code || "HCS_INCIDENT";
  const totalRows = state.aiExportTotalRows;
  const processing = state.aiExportProcessing;

  // Field checkbox groups
  const fieldGroupsHtml = AI_EXPORT_FIELD_GROUPS.map((g) => {
    const itemsHtml = g.fields.map((f) => {
      const checked = cols.includes(f.key) ? "checked" : "";
      return `<label class="ai-export-field-checkbox"><input type="checkbox" data-ai-export-field="${escapeAttr(f.key)}" ${checked} />${escapeHtml(f.label)}</label>`;
    }).join("");
    return `<div class="ai-export-field-group"><span class="ai-export-field-group-label">${escapeHtml(g.group)}</span>${itemsHtml}</div>`;
  }).join("");

  // Template dropdown
  const templateOptionsHtml = templates.map((t) => {
    return `<option value="${escapeAttr(String(t.id))}">${escapeHtml(t.name)}</option>`;
  }).join("");

  const resultHtml = (status === "draft" || status === "preview") && totalRows > 0
    ? `<p class="ai-export-step-result">查询到 <strong>${totalRows}</strong> 条数据</p>`
    : "";

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 1: 查询配置</div>
    <div class="ai-export-form-row">
      <label>时间范围（起）：<input type="date" class="ai-export-input" id="ai-export-time-from" value="${escapeAttr(timeFrom)}" /></label>
      <label>时间范围（止）：<input type="date" class="ai-export-input" id="ai-export-time-to" value="${escapeAttr(timeTo)}" /></label>
    </div>
    <div class="ai-export-form-row">
      <label>工单类型：<select class="ai-export-select" id="ai-export-template-code">
        <option value="HCS_INCIDENT" ${templateCode === "HCS_INCIDENT" ? "selected" : ""}>HCS_INCIDENT</option>
      </select></label>
    </div>
    <div class="ai-export-form-row">
      <label>导出字段：</label>
      <div class="ai-export-field-checkbox-group">${fieldGroupsHtml}</div>
    </div>
    <div class="ai-export-form-row">
      <label>规则模板（可选）：<select class="ai-export-select" id="ai-export-rule-template">
        <option value="">-- 从已有模板加载 --</option>${templateOptionsHtml}
      </select></label>
    </div>
    ${resultHtml}
    <div class="ai-export-form-actions">
      <button type="button" class="action primary" id="ai-export-query-btn" ${processing ? "disabled" : ""}>${processing ? "查询中…" : "查询数据"}</button>
    </div>
  </div>`;
}

function renderStep2(status) {
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
      </div>`;

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 2: 清洗规则</div>
    ${inputHtml}
    ${ruleSummaryHtml}
  </div>`;
}

function renderStep3() {
  const previewRows = state.aiExportPreviewRows;
  const cols = state.aiExportOriginalColumns;
  const rules = state.aiExportTransformRules;
  const derivedCols = rules.map((r) => r.target_column);
  const allCols = [...cols, ...derivedCols];

  // Column header labels: original columns use AI_EXPORT_COLUMNS mapping
  const headerLabels = allCols.map((c) => {
    if (cols.includes(c)) {
      return AI_EXPORT_COLUMNS[c] || c;
    }
    return c; // derived columns use target_column directly
  });

  const maxRows = 20;
  const displayRows = previewRows.slice(0, maxRows);

  const theadHtml = `<tr>${headerLabels.map((l) => `<th>${escapeHtml(l)}</th>`).join("")}</tr>`;
  const tbodyHtml = displayRows.map((row) => {
    return `<tr>${allCols.map((c) => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`;
  }).join("");

  const tableHtml = `<table class="ai-export-preview-table"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>`;

  return `<div class="ai-export-step">
    <div class="ai-export-step-title">Step 3: 数据预览（前 ${Math.min(previewRows.length, maxRows)} 行）</div>
    <div class="ai-export-preview-table-wrap">${tableHtml}</div>
    <div class="ai-export-form-actions">
      <button type="button" class="action" id="ai-export-edit-rules-btn-step3">修改规则</button>
      <button type="button" class="action primary" id="ai-export-start-processing-btn">开始全量处理</button>
    </div>
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

  // Fetch templates + task list silently on first load (no requestRender to avoid flicker loop)
  // These update state; the next natural user-triggered render will pick up the changes.
  if (!state._aiExportInitialLoaded) {
    state._aiExportInitialLoaded = true;
    try {
      const tplResp = await fetch(`${API_BASE_URL}/api/ai-export/templates?operator_id=${encodeURIComponent(_opId())}`);
      if (tplResp.ok) state.aiExportTemplates = tplResp.json().items || [];
    } catch (_) { /* ignore */ }
    try {
      const taskResp = await fetch(`${API_BASE_URL}/api/ai-export/tasks?operator_id=${encodeURIComponent(_opId())}&page=1&size=20`);
      if (taskResp.ok) { const d = taskResp.json(); state.aiExportTaskList = d.items || []; state.aiExportTaskListTotal = d.total || 0; }
    } catch (_) { /* ignore */ }
    // One single render after data is ready, not per-fetch
    requestRender();
  }

  // Restart progress polling if task is processing
  if (state.aiExportTaskStatus === "processing" && state.aiExportCurrentTaskId) {
    startProgressPolling(state.aiExportCurrentTaskId);
  }

  // ── Step 1 bindings ──

  const queryBtn = document.getElementById("ai-export-query-btn");
  if (queryBtn) {
    queryBtn.addEventListener("click", () => {
      // Read form values into state before fetching
      const timeFrom = document.getElementById("ai-export-time-from")?.value || "";
      const timeTo = document.getElementById("ai-export-time-to")?.value || "";
      const templateCode = document.getElementById("ai-export-template-code")?.value || "HCS_INCIDENT";

      const selectedFields = [];
      document.querySelectorAll("[data-ai-export-field]").forEach((el) => {
        if (el.checked) selectedFields.push(el.getAttribute("data-ai-export-field"));
      });

      state.aiExportSourceConfig = {
        time_range: { from: timeFrom, to: timeTo },
        template_code: templateCode,
      };
      state.aiExportOriginalColumns = selectedFields;

      if (!selectedFields.length) {
        state.aiExportErrorMessage = "请至少选择一个导出字段";
        requestRender();
        return;
      }

      fetchAiExportCreateTask();
    });
  }

  // Template load: fill form from selected template
  const templateSelect = document.getElementById("ai-export-rule-template");
  if (templateSelect) {
    templateSelect.addEventListener("change", () => {
      const tplId = parseInt(templateSelect.value);
      if (!tplId) return;
      const tpl = state.aiExportTemplates.find((t) => t.id === tplId);
      if (!tpl) return;
      // Fill source config + columns from template
      state.aiExportSourceConfig = tpl.source_config || {};
      state.aiExportOriginalColumns = tpl.original_columns || [];
      state.aiExportTransformRules = tpl.transform_rules || [];
      if (tpl.transform_rules && tpl.transform_rules.length) {
        state.aiExportRuleDescription = tpl.transform_rules
          .map((r) => `${r.type}: ${r.target_column}`)
          .join("; ");
      }
      requestRender();
    });
  }

  // ── Step 2 bindings ──

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

  // ── Step 3 bindings ──

  const editRulesBtnStep3 = document.getElementById("ai-export-edit-rules-btn-step3");
  if (editRulesBtnStep3) {
    editRulesBtnStep3.addEventListener("click", () => {
      state.aiExportTaskStatus = "draft";
      state._aiExportEditRules = true;
      requestRender();
    });
  }

  const startProcessingBtn = document.getElementById("ai-export-start-processing-btn");
  if (startProcessingBtn) {
    startProcessingBtn.addEventListener("click", () => {
      fetchAiExportStartProcessing().then(() => {
        if (state.aiExportTaskStatus === "processing" && state.aiExportCurrentTaskId) {
          startProgressPolling(state.aiExportCurrentTaskId);
        }
      });
    });
  }

  // ── Step 4 bindings ──

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
            source_config: state.aiExportSourceConfig,
            original_columns: state.aiExportOriginalColumns,
            transform_rules: state.aiExportTransformRules,
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
      state.aiExportSourceConfig = {};
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