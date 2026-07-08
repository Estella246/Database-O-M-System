import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state, ticketList, workflowByOrderId, operationLogsByOrderId, TEMP_AUTO_FILL_ALL_FIELDS } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel, normalizePermissionLevel, getPermissionLevelRank, normalizePermissionLevelForItem, getPermissionStrategyOptions, getWhitelistKeyByActiveKey, applyPermissionWhitelistCascade, normalizeDutyCascadeValue, splitDutyFieldCascadePath } from "../utils/normalize.js";
import { operatorMatchesPersonField, formatYmdLocal, localYmd, nowText, makeNewTicketId, priorityBadgeClass, categoryBadgeClass, valueBadgeClass, sortTicketsByCreatedAtDesc, listPreviewText, isCreateDraftTicketId } from "../utils/format.js";
import { API_BASE_URL, parseApiError, stripDutyFieldIdsForApi, dutyFieldTreeHasEmptyLabel } from "../services/api.js";
import { parseTicketNodeDataResponse } from "../utils/node-data-response.js";
import { getImageFileFromClipboardData } from "../utils/richtext-paste-image.js";
import {
  parseTicketFileFieldValue,
  serializeTicketFileFieldValue,
  ticketFileFieldDisplayName,
} from "../utils/ticket-file-field.js";
import { requestRender } from "../core/scheduler.js";
import {
  WORKFLOW_NODES,
  NODE_KEY_BY_STEP,
  STEP_BY_NODE_KEY,
  HANDLE_MODE_ROUTE,
  filterOpsAnalysisHandleModeOptions,
  filterProblemFillComponentOptions,
  filterProblemReviewIssueTypeJudgeOptions,
  PROBLEM_REVIEW_SPECIAL_ROTATION_HANDLE_MODE,
  WHITELIST_NO_PLACEHOLDER_KEYS,
  WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS,
  WF_FLAT_SEARCHABLE_FIELD_KEYS,
  injectPersonOptionsIntoSchemaFields,
  isWorkflowFlatSelectSearchable,
  shouldUseWorkflowFlatSelect,
  isMultiPersonWhitelistField,
  parseMultiPersonValue,
  joinMultiPersonValue,
  personOptionMatchesKeyword,
  PERSON_WHITELIST_FIELD_KEYS,
  TICKET_LIST_FILTER_KEYS,
  isWideTextField,
  getProblemFillFieldSortTier,
  PROBLEM_FILL_LOCATION_HINT,
  resolveWorkflowStepIndexFromTicket,
} from "../constants/workflow.js";
import { getRootCauseCategoriesForIssueType } from "../constants/issue-root-cause.js";
import {
  HOTPATCH_WORKFLOW_NODES,
  HOTPATCH_NODE_KEY_BY_STEP,
  HOTPATCH_STEP_BY_NODE_KEY,
  HOTPATCH_HANDLE_MODE_ROUTE,
  HOTPATCH_FLOW_BAR_LAYOUT,
  renderHotpatchFlowJoinHtml,
  resolveHotpatchFlowJoinKind,
} from "../constants/hotpatch-workflow.js";
import { DUTY_FIELD_CASCADE_SEP } from "../constants/duty.js";
import { GROUP_TEMPLATE_KINDS, GROUP_TEMPLATE_NAME_DEFAULTS } from "../constants/theme.js";
import {
  normalizeNodeKey,
  formatValidationErrors,
  renderReadOnlyFieldValue,
  renderWorkflowFlatSelect,
  rebuildWfFlatSelectChoiceButtons,
  renderWorkflowFlatMultiSelect,
  renderCascadeWhitelistControl,
  resolveNextNodeKey,
} from "./ticket.js";
import { getDutyAssignmentsForDay, dutyModalUserLabel, dutyFieldParsePath, dutyFieldGetParentArray, dutyFieldNodeAtPath, dutyCascaderColumnsData, dutyCascaderColumnHtml, dutyCascaderCaptureColumnScroll, dutyCascaderRestoreColumnScroll, dutyCascaderSearchPanelHtml, dutyRosterAnchorValid } from "./duty.js";
import { ensureAdminData } from "./admin-page.js";
import { getPermissionWhitelistDetailText, uniqueColumnValues, getPermissionWhitelistPageAndDetail, getPermissionLevelForItem, getStrategyOptionsHtml, renderUserFilterHeader, renderUserTableHead } from "./admin.js";
import {
  ensureHomeTab,
  getTicketById,
  beginCreateTicketModal,
  beginPatchCreateTicketModal,
  ensureDutyTab,
  remapTicketOrderId,
  getUrlByKey,
  ensureTicketTab,
  syncSingleTicketFromServer,
  syncTicketsFromServer,
  clearTicketFormCache,
  isTicketClosedStatus,
  runWorkbenchSnapshotRebuild,
  resyncWorkbenchTicketList,
  invalidateWorkbenchListFacets,
  refreshHomeListData,
} from "./ticket-core.js";
import { openMigrateLegacyModal } from "./migrate-legacy-modal.js";
import { invalidateHomePersonalStats } from "./home-page.js";
import { openProblemFillReviewerModal } from "./problem-fill-reviewer-modal.js";
import { fetchGroupTemplatesFromServer, saveGroupTemplateDraftToServer, renderGroupTemplateFieldsHtml, renderGroupTemplatePageHtml, renderGroupPullModalHtml, bindGroupTemplateParamsPage, bindGroupPullModal, renderVersionParamsPageHtml, renderParamsPage, saveVersionBaselineDraft, saveVersionHotfixDraft, bindVersionParamsPage, versionFindBaselineDraftRow, versionFindHotfixDraftRow, refreshVersionParamsData } from "./params-page.js";
import { fieldVisible, fieldEffectiveRequired } from "./requirement.js";

let dutyCascaderOpenWrap = null;
let wfFlatSelectOpenWrap = null;
let dutyCascaderGeomListenersBound = false;
let dutyCascaderDocumentBound = false;
let dutyCascaderColScrollLockUntil = 0;

export function getFormState(orderId, nodeKey) {
  const key = `${orderId}:${nodeKey}`;
  if (!state.formsByTicket[key]) {
    state.formsByTicket[key] = {
      loading: false,
      loaded: false,
      notFound: false,
      failed: false,
      saving: false,
      savingMode: "",
      error: "",
      success: "",
      fields: [],
      values: {},
    };
  }
  return state.formsByTicket[key];
}

export function collectValuesForRules(form, fields) {
  const fd = new FormData(form);
  const vals = {};
  fields.forEach((f) => {
    const raw = fd.get(f.key);
    vals[f.key] = typeof raw === "string" ? raw.trim() : raw ? String(raw) : "";
  });
  form.querySelectorAll("[data-rich-hidden]").forEach((hid) => {
    if (hid.name) vals[hid.name] = (hid.value || "").trim();
  });
  return vals;
}

function syncOpsAnalysisHandleModeOptions(form, formState, vals) {
  const field = formState.fields.find((f) => f.key === "handle_mode");
  if (!field) return;
  const wrap = form.querySelector('[data-field-key="handle_mode"]');
  if (!wrap) return;
  const rawOptions = Array.isArray(field.options) ? field.options : [];
  const options = filterOpsAnalysisHandleModeOptions(rawOptions, vals.is_quality_issue);
  const allowed = new Set(options);
  const flatWrap = wrap.querySelector("[data-wf-flat-select]");
  if (flatWrap) {
    flatWrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
      if (btn.classList.contains("wf-flat-select-item--placeholder")) return;
      const pick = String(btn.getAttribute("data-wf-flat-value-pick") || "").trim();
      btn.hidden = !allowed.has(pick);
    });
    const hidden = flatWrap.querySelector("[data-wf-flat-value]");
    const cur = String(hidden?.value || "").trim();
    if (cur && !allowed.has(cur)) {
      wfFlatSelectCommit(flatWrap, "");
    }
    return;
  }
  const select = wrap.querySelector('select[name="handle_mode"]');
  if (!select) return;
  select.querySelectorAll("option").forEach((opt) => {
    const v = String(opt.value || "").trim();
    if (!v) return;
    opt.hidden = !allowed.has(v);
    opt.disabled = !allowed.has(v);
  });
  const cur = String(select.value || "").trim();
  if (cur && !allowed.has(cur)) {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function syncProblemReviewIssueTypeJudgeOptions(form, formState, vals) {
  const field = formState.fields.find((f) => f.key === "issue_type_judge");
  if (!field) return;
  const wrap = form.querySelector('[data-field-key="issue_type_judge"]');
  if (!wrap) return;
  const rawOptions = Array.isArray(field.options) ? field.options : [];
  const options = filterProblemReviewIssueTypeJudgeOptions(rawOptions, vals.handle_mode);
  const allowed = new Set(options);
  const flatWrap = wrap.querySelector("[data-wf-flat-select]");
  if (flatWrap) {
    flatWrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
      if (btn.classList.contains("wf-flat-select-item--placeholder")) return;
      const pick = String(btn.getAttribute("data-wf-flat-value-pick") || "").trim();
      btn.hidden = !allowed.has(pick);
    });
    const hidden = flatWrap.querySelector("[data-wf-flat-value]");
    const cur = String(hidden?.value || "").trim();
    if (cur && !allowed.has(cur)) {
      wfFlatSelectCommit(flatWrap, "");
    }
    return;
  }
  const select = wrap.querySelector('select[name="issue_type_judge"]');
  if (!select) return;
  select.querySelectorAll("option").forEach((opt) => {
    const v = String(opt.value || "").trim();
    if (!v) return;
    opt.hidden = !allowed.has(v);
    opt.disabled = !allowed.has(v);
  });
  const cur = String(select.value || "").trim();
  if (cur && !allowed.has(cur)) {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function syncProblemFillComponentOptions(form, formState, vals) {
  const field = formState.fields.find((f) => f.key === "component");
  if (!field) return;
  const wrap = form.querySelector('[data-field-key="component"]');
  if (!wrap) return;
  const rawOptions = Array.isArray(field.options) ? field.options : [];
  const options = filterProblemFillComponentOptions(rawOptions, vals.product_line);
  const allowed = new Set(options);
  const flatWrap = wrap.querySelector("[data-wf-flat-select]");
  if (flatWrap) {
    flatWrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
      if (btn.classList.contains("wf-flat-select-item--placeholder")) return;
      const pick = String(btn.getAttribute("data-wf-flat-value-pick") || "").trim();
      btn.hidden = !allowed.has(pick);
    });
    const hidden = flatWrap.querySelector("[data-wf-flat-value]");
    const cur = String(hidden?.value || "").trim();
    if (cur && !allowed.has(cur)) {
      wfFlatSelectCommit(flatWrap, "");
    }
    return;
  }
  const select = wrap.querySelector('select[name="component"]');
  if (!select) return;
  select.querySelectorAll("option").forEach((opt) => {
    const v = String(opt.value || "").trim();
    if (!v) return;
    opt.hidden = !allowed.has(v);
    opt.disabled = !allowed.has(v);
  });
  const cur = String(select.value || "").trim();
  if (cur && !allowed.has(cur)) {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function syncRootCauseCategoryOptions(form, formState, vals) {
  const field = formState.fields.find((f) => f.key === "root_cause_category");
  if (!field?.options_by_parent) return;
  const wrap = form.querySelector('[data-field-key="root_cause_category"]');
  if (!wrap) return;
  const options = getRootCauseCategoriesForIssueType(field, vals.issue_type);
  const allowed = new Set(options);
  const flatWrap = wrap.querySelector("[data-wf-flat-select]");
  if (flatWrap) {
    const hidden = flatWrap.querySelector("[data-wf-flat-value]");
    const cur = String(hidden?.value || "").trim();
    const list = flatWrap.querySelector("[data-wf-flat-list]");
    rebuildWfFlatSelectChoiceButtons(list, options, { currentValue: cur });
    const searchInput = flatWrap.querySelector("[data-wf-flat-search]");
    if (searchInput) wfFlatSelectApplySearch(flatWrap, searchInput.value);
    if (cur && options.length > 0 && !allowed.has(cur)) {
      wfFlatSelectCommit(flatWrap, "");
    } else {
      wfFlatSelectSyncLabel(flatWrap);
    }
    return;
  }
  const select = wrap.querySelector('select[name="root_cause_category"]');
  if (!select) return;
  const existing = new Set(
    Array.from(select.querySelectorAll("option"))
      .map((opt) => String(opt.value || "").trim())
      .filter(Boolean)
  );
  for (const item of options) {
    if (existing.has(item)) continue;
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  }
  select.querySelectorAll("option").forEach((opt) => {
    const v = String(opt.value || "").trim();
    if (!v) return;
    const show = options.length === 0 || allowed.has(v);
    opt.hidden = !show;
    opt.disabled = !show;
  });
  const cur = String(select.value || "").trim();
  if (cur && options.length > 0 && !allowed.has(cur)) {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function applyNodeFieldRules(form, formState) {
  const vals = collectValuesForRules(form, formState.fields);
  const nodeKey = form.getAttribute("data-node-key") || "";
  if (nodeKey === "ops_analysis") {
    syncOpsAnalysisHandleModeOptions(form, formState, vals);
    syncRootCauseCategoryOptions(form, formState, vals);
  }
  if (nodeKey === "problem_review") {
    syncProblemReviewIssueTypeJudgeOptions(form, formState, vals);
  }
  if (nodeKey === "problem_fill") {
    syncProblemFillComponentOptions(form, formState, vals);
  }
  formState.fields.forEach((field) => {
    const wrap = form.querySelector(`[data-field-key="${field.key}"]`);
    if (!wrap) return;
    const vis = fieldVisible(field, vals);
    const req = fieldEffectiveRequired(field, vals);
    const effectiveVis = vis;
    const effectiveReq = req;
    wrap.classList.toggle("problem-field-hidden", !effectiveVis);
    wrap.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "hidden" && el.closest("[data-rich-editor]")) return;
      el.disabled = !effectiveVis;
    });
    const casc = wrap.querySelector(".cascade-cascader");
    if (casc && !effectiveVis) dutyCascaderClose(casc);
    const flatSel = wrap.querySelector("[data-wf-flat-select]");
    if (flatSel && !effectiveVis) wfFlatSelectClose(flatSel);
    wrap.querySelectorAll(".cascade-cascader button").forEach((el) => {
      el.disabled = !effectiveVis;
    });
    wrap.querySelectorAll(".wf-flat-select-trigger").forEach((el) => {
      el.disabled = !effectiveVis || field.readonly;
    });
    wrap.querySelectorAll(".rich-content").forEach((el) => {
      el.contentEditable = vis && !field.readonly ? "true" : "false";
    });
    wrap.querySelectorAll(".rich-toolbar button, .rich-toolbar input[type=file]").forEach((el) => {
      el.disabled = !effectiveVis || field.readonly;
    });
    wrap.querySelectorAll(".ticket-file-upload input[type=file]").forEach((el) => {
      el.disabled = !effectiveVis || field.readonly;
    });
    wrap.querySelectorAll(".ticket-file-upload-btn").forEach((el) => {
      el.classList.toggle("disabled", !effectiveVis || field.readonly);
    });
    const mark = wrap.querySelector(".required-mark");
    if (mark) mark.style.display = effectiveReq ? "" : "none";
  });
}

export function shouldRenderFlowFields(isCurrentNode) {
  return !!isCurrentNode;
}

/** 创建工单弹窗从问题填写节点起单时不展示「保存」，仅保留「提交」。 */
export function shouldHideSaveButtonInCreateModal(nodeKey) {
  return String(nodeKey || "").trim() === "problem_fill";
}

export function buildSubmitValues(form, formState, options = {}) {
  const excludeFlowFields = !!options.excludeFlowFields;
  form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    syncRichEditorValue(editor);
  });
  const vals = collectValuesForRules(form, formState.fields);
  const out = {};
  formState.fields.forEach((field) => {
    if (excludeFlowFields && (field.key === "handle_mode" || field.key === "next_handler")) return;
    if (!fieldVisible(field, vals)) return;
    out[field.key] = vals[field.key] ?? "";
  });
  return out;
}

function isNodeFormNetworkError(message) {
  return /failed to fetch|networkerror|network request failed|connection refused|err_connection/i.test(message);
}

export async function ensureNodeFormData(
  orderId,
  nodeKey,
  workflowTemplate = "HCS_INCIDENT",
  allowMissingTicketData = false,
  options = {},
) {
  const createDraft = options.createDraft === true;
  const formState = getFormState(orderId, nodeKey);
  if (formState.loading || formState.loaded || formState.failed) return;

  formState.loading = true;
  formState.error = "";
  // Do not requestRender() here: renderWorkflow may kick off many nodes in one pass; nested requestRender() per node caused deep re-entrancy.

  const tc = workflowTemplate === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const schemaUrl = `${API_BASE_URL}/api/nodes/${encodeURIComponent(nodeKey)}/schema${
    tc !== "HCS_INCIDENT" ? `?template_code=${encodeURIComponent(tc)}` : ""
  }`;
  let schemaStatus = null;
  let dataStatus = null;

  try {
    const operator = getCurrentOperator();
    const dataUrl = `${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/data?operator_id=${encodeURIComponent(operator.account)}`;
    const schemaResp = await fetch(schemaUrl);
    schemaStatus = schemaResp.status;
    let dataResp = null;
    if (!createDraft) {
      dataResp = await fetch(dataUrl);
      dataStatus = dataResp.status;
    }
    if (schemaResp.status === 404) {
      formState.notFound = true;
      formState.loaded = true;
      return;
    }
    if (!schemaResp.ok) {
      const detail = await parseApiError(schemaResp);
      throw new Error(`schema HTTP ${schemaResp.status}: ${detail}`);
    }
    const schemaJson = await schemaResp.json();
    const dataJson = createDraft
      ? { values: {} }
      : await parseTicketNodeDataResponse(dataResp, {
          allowMissingTicket404: allowMissingTicketData,
        });
    formState.fields = Array.isArray(schemaJson.fields)
      ? schemaJson.fields.map((f) => ({
          ...f,
          constraints: f.constraints || {},
          ui_props: f.ui_props && typeof f.ui_props === "object" ? f.ui_props : {},
          options_by_parent:
            f.options_by_parent && typeof f.options_by_parent === "object" ? f.options_by_parent : undefined,
        }))
      : [];
    const needsPersonOpts = formState.fields.some(
      (f) => f.type === "whitelist" && PERSON_WHITELIST_FIELD_KEYS.has(f.key),
    );
    if (needsPersonOpts && (!Array.isArray(state.adminUsers) || !state.adminUsers.length)) {
      try {
        const userResp = await fetch(`${API_BASE_URL}/api/admin/users`);
        if (userResp.ok) {
          const u = await userResp.json();
          state.adminUsers = Array.isArray(u.items) ? u.items : [];
        }
      } catch (_) {
        /* 保留 schema 后端下发的 options */
      }
    }
    if (Array.isArray(state.adminUsers) && state.adminUsers.length) {
      formState.fields = injectPersonOptionsIntoSchemaFields(formState.fields, state.adminUsers);
    }
    formState.values = dataJson.values || {};
    formState.loaded = true;
    formState.failed = false;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err || "");
    const netFail = isNodeFormNetworkError(raw);
    console.error("[节点表单] 加载失败", {
      orderId,
      nodeKey,
      workflowTemplate: tc,
      apiBase: API_BASE_URL,
      schemaUrl,
      schemaStatus,
      dataStatus,
      networkError: netFail,
      message: raw,
      error: err,
    });
    formState.error = netFail
      ? `无法连接后端 ${API_BASE_URL}（请在本机终端运行 uvicorn，且与页面同主机访问，例如页面用 http://127.0.0.1:5173 打开）。也可用地址栏加参数 ?api=http://127.0.0.1:8000 指定 API。详情：${raw}`
      : raw || "load failed";
    formState.failed = true;
  } finally {
    formState.loading = false;
    if (!options.suppressRender) requestRender();
  }
}

async function preloadWorkflowFormsAfterFlowSubmit(orderId, nextNodeKey, workflowTemplate) {
  const wfTpl = workflowTemplate === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const ticket = getTicketById(orderId);
  let nodeKeys = [];
  if (wfTpl === "HOTPATCH") {
    const frontier = Array.isArray(ticket?.hotpatchFrontierKeys) ? ticket.hotpatchFrontierKeys : [];
    nodeKeys = frontier.length ? frontier : nextNodeKey ? [nextNodeKey] : [];
  } else if (nextNodeKey) {
    nodeKeys = [nextNodeKey];
  } else {
    const nk = normalizeNodeKey(String(ticket?.node_key || ticket?.node || ""));
    if (nk) nodeKeys = [nk];
  }
  const preloadOpts = { suppressRender: true };
  await Promise.all(nodeKeys.map((k) => ensureNodeFormData(orderId, k, wfTpl, false, preloadOpts)));
}

/** 服务端操作日志 → 节点卡片 workflow.logs（刷新后 meta 与抽屉一致）。 */
export function hydrateWorkflowLogsFromOpLogs(orderId, opLogs) {
  const rows = Array.isArray(opLogs) ? opLogs : [];
  if (!rows.length) return;
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  if (Array.isArray(workflow.logs) && workflow.logs.length > 0) return;
  const byStep = new Map();
  rows.forEach((entry) => {
    const step = String(entry?.from || "").trim();
    if (!step || step === "-") return;
    const action = String(entry?.action || "submit");
    const handleHint =
      action === "close" ? "关闭" : action === "submit" ? "提交" : action;
    byStep.set(step, {
      step,
      actor: String(entry?.actor || "-"),
      at: String(entry?.at || ""),
      summary: `${handleHint} · ${step}`,
    });
  });
  if (!byStep.size) return;
  workflowByOrderId[orderId] = { ...workflow, logs: [...byStep.values()] };
}

export async function syncOperationLogsFromServer(orderId, options = {}) {
  const syncState = state.logSyncStateByOrderId[orderId] || { loading: false, loaded: false };
  const force = Boolean(options.force);
  if (syncState.loading || (syncState.loaded && !force)) return;
  syncState.loading = true;
  state.logSyncStateByOrderId[orderId] = syncState;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/logs`);
    if (!resp.ok) return;
    const json = await resp.json();
    const rows = Array.isArray(json?.items) ? json.items : [];
    const mapped = rows.map((r) => ({
      at: String(r.at || ""),
      actor: String(r.actor || "-"),
      action: String(r.action || "submit"),
      from: String(r.from || "-"),
      to: String(r.to || "-"),
      nextHandler: String(r.next_handler || "-"),
    }));
    const prev = JSON.stringify(operationLogsByOrderId[orderId] || []);
    const next = JSON.stringify(mapped);
    operationLogsByOrderId[orderId] = mapped;
    hydrateWorkflowLogsFromOpLogs(orderId, mapped);
    syncState.loaded = true;
    if (prev !== next && !options.suppressRender) requestRender();
  } catch (_) {
    // ignore log sync failure
  } finally {
    syncState.loading = false;
    state.logSyncStateByOrderId[orderId] = syncState;
  }
}

export function bindNodeForms(orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return;
  const forms = document.querySelectorAll("form[data-node-form]");
  forms.forEach((form) => {
    if (String(form.getAttribute("data-order-id") || "").trim() !== oid) return;
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    const nodeKey = form.getAttribute("data-node-key");
    if (!nodeKey) return;
    const wfTpl = form.getAttribute("data-workflow-template") === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
    const formState = getFormState(oid, nodeKey);

    form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      bindRichEditor(editor);
    });
    bindTicketFileUploadFields(form);

    const runRules = () => {
      form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
        syncRichEditorValue(editor);
      });
      const vals = collectValuesForRules(form, formState.fields);
      formState.values = { ...(formState.values || {}), ...vals };
      applyNodeFieldRules(form, formState);
    };
    bindDutyFieldCascader(form);
    bindWorkflowFlatSelect(form);
    runRules();
    form.addEventListener("change", runRules);
    form.addEventListener("input", (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest("[data-wf-flat-search]")) return;
      runRules();
    });

    const isCurrentNode = form.getAttribute("data-is-current-node") !== "0";

    const saveNode = async (options = {}) => {
      const isFlowSubmit = isCurrentNode && !!options.flowSubmit;
      if (formState.saving) return { ok: false };
      const values = buildSubmitValues(form, formState, { excludeFlowFields: !isCurrentNode });
      // Keep in-progress form input on any subsequent re-render.
      formState.values = { ...(formState.values || {}), ...values };
      formState.saving = true;
      formState.savingMode = isFlowSubmit ? "submit" : "save";
      formState.error = "";
      formState.success = "";
      requestRender();

      try {
        const operator = getCurrentOperator();
        const nextNodeKey = isFlowSubmit
          ? resolveNextNodeKey(nodeKey, values.handle_mode || "", wfTpl === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT")
          : "";
        const submitBody = {
          values,
          operator_id: operator.account,
          operator_name: operator.userName,
          next_node_key: nextNodeKey || null,
          save_only: !isFlowSubmit,
        };
        if (wfTpl === "HOTPATCH") {
          submitBody.template_code = "HOTPATCH";
        }
        if (
          isFlowSubmit &&
          state.createModalOpen &&
          String(state.createTicketId || "").trim() === oid &&
          nodeKey === state.createModalNodeKey
        ) {
          submitBody.create_intent = true;
        }
        const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(oid)}/nodes/${encodeURIComponent(nodeKey)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submitBody),
        });
        const rawText = await resp.text();
        let json = {};
        try {
          json = rawText ? JSON.parse(rawText) : {};
        } catch (_) {
          json = {};
        }
        if (!resp.ok) {
          const errors = json?.detail?.errors;
          const formatted = formatValidationErrors(errors, formState.fields);
          throw new Error(formatted || (json?.detail?.message ? String(json.detail.message) : `提交失败（HTTP ${resp.status}）`));
        }
        formState.values = json?.saved?.values || values;
        formState.success = "已保存";
        const resolvedId = String(json?.ticket_id || "").trim() || oid;
        if (resolvedId !== oid) remapTicketOrderId(oid, resolvedId);
        return {
          ok: true,
          values: formState.values,
          orderId: resolvedId,
          amended: Boolean(json?.amended),
          draft: Boolean(json?.draft),
          flowApplied: !json?.amended && !json?.draft,
        };
      } catch (err) {
        formState.error = err instanceof Error ? err.message : "提交失败";
        if (formState.error) window.alert(formState.error);
        return { ok: false };
      } finally {
        if (!options.deferSavingClear || formState.error) {
          formState.saving = false;
          formState.savingMode = "";
        }
        if (!options.suppressRenderOnComplete || formState.error) requestRender();
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = event.submitter instanceof Element ? event.submitter : null;
      const flowSubmitPending = form.dataset.flowSubmitPending === "1";
      const isFlowSubmit =
        isCurrentNode && (!!submitter?.hasAttribute("data-action-submit") || flowSubmitPending);
      if (flowSubmitPending) delete form.dataset.flowSubmitPending;
      const isCreateModalSubmit =
        isFlowSubmit &&
        state.createModalOpen &&
        String(state.createTicketId || "").trim() === oid &&
        nodeKey === state.createModalNodeKey;
      const saved = await saveNode({
        flowSubmit: isFlowSubmit,
        suppressRenderOnComplete: isFlowSubmit,
        deferSavingClear: isCreateModalSubmit,
      });
      if (!saved.ok) return;
      const workId = saved.orderId || oid;
      if (!isFlowSubmit) return;
      if (!saved.flowApplied) return;

      const completeFlowSubmit = async ({ skipFinalRender = false } = {}) => {
        invalidateHomePersonalStats();
        const handleMode = saved.values?.handle_mode || "";
        const nextNodeKey = resolveNextNodeKey(nodeKey, handleMode, wfTpl === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT");
        state.activeKey = ensureTicketTab(workId);
        history.pushState({}, "", getUrlByKey(state.activeKey));
        if (state.createModalOpen && nodeKey === state.createModalNodeKey) {
          const exists = ticketList.some((x) => x.orderId === workId);
          if (!exists) {
            const operator = getCurrentOperator();
            const closed =
              handleMode === "问题解决关闭" ||
              handleMode === "非问题关闭" ||
              handleMode === "完成" ||
              handleMode === "裁决未通过（结束）";
            const stepBy = wfTpl === "HOTPATCH" ? HOTPATCH_STEP_BY_NODE_KEY : STEP_BY_NODE_KEY;
            const nextStepLabel = closed
              ? "已关闭"
              : nextNodeKey
                ? stepBy[nextNodeKey] || String(nextNodeKey)
                : wfTpl === "HOTPATCH"
                  ? "开发填写"
                  : "运维分析";
            ticketList.unshift({
              orderId: workId,
              templateCode: wfTpl === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT",
              processId: workId,
              currentStage: nextStepLabel,
              startDate: String(saved.values?.start_date || new Date().toISOString().slice(0, 10)),
              location: String(saved.values?.location || ""),
              bizEnv: String(saved.values?.biz_env || ""),
              currentHandler: closed ? "" : operator.userName,
              severity: String(saved.values?.severity || "一般"),
              description: listPreviewText(
                saved.values?.issue_desc || saved.values?.problem_desc || saved.values?.description || "--",
                200
              ),
              status: closed ? "closed" : "open",
              node: nextStepLabel,
              assignee: closed ? "" : operator.userName,
              creatorName: operator.userName,
              creatorId: operator.account,
              createdAt: new Date().toISOString(),
            });
            ticketList.splice(0, ticketList.length, ...sortTicketsByCreatedAtDesc(ticketList));
          }
          state.createModalOpen = false;
          state.createTicketId = "";
          state.createModalNodeKey = "";
        }
        if (!nextNodeKey) {
          formState.error = "未匹配到流转目标，请检查处理方式";
          if (!skipFinalRender) requestRender();
          return;
        }
        if (wfTpl !== "HOTPATCH") {
          advanceWorkflow(workId, nodeKey, nextNodeKey, handleMode, wfTpl);
        }
        const ticketKey = ensureTicketTab(workId);
        state.activeKey = ticketKey;
        history.replaceState({}, "", getUrlByKey(ticketKey));
        // Avoid location.assign: static servers (e.g. python -m http.server) have no /tickets/* file → 404 HTML.
        try {
          await syncSingleTicketFromServer(workId);
        } catch (_) {
          /* 保留 advanceWorkflow 后的本地状态 */
        }
        try {
          delete state.logSyncStateByOrderId[workId];
          await syncOperationLogsFromServer(workId, { force: true, suppressRender: true });
        } catch (_) {
          /* 日志同步失败仍保留 advanceWorkflow 本地态 */
        }
        try {
          await preloadWorkflowFormsAfterFlowSubmit(workId, nextNodeKey, wfTpl);
        } catch (_) {
          /* 预加载失败仍刷新，由 ensureNodeFormData 错误态展示 */
        }
        if (!skipFinalRender) requestRender();
      };

      if (isCreateModalSubmit) {
        try {
          await completeFlowSubmit({ skipFinalRender: true });
          if (nodeKey === "problem_fill") {
            const nextHandler = String(saved.values?.next_handler || "").trim();
            const ticketNo = String(saved.orderId || workId || "").trim();
            if (nextHandler) openProblemFillReviewerModal(nextHandler, ticketNo);
          }
        } finally {
          formState.saving = false;
          formState.savingMode = "";
          requestRender();
        }
      } else {
        await completeFlowSubmit();
      }
    });
  });
}

export function renderDutyFieldTreeInnerHtml(nodes, prefix, editable) {
  const list = Array.isArray(nodes) ? nodes : [];
  const collapsed = state.dutyFieldCollapsedPaths;
  return list
    .map((node, i) => {
      const path = prefix === "" ? String(i) : `${prefix}.${i}`;
      const label = escapeAttr(String(node.label ?? ""));
      const hasKids = !!(node.children && node.children.length);
      const isCollapsed = hasKids && collapsed.has(path);
      const toggleBtn = hasKids
        ? `<button type="button" class="duty-field-toggle" data-df-toggle="${escapeAttr(path)}" aria-expanded="${isCollapsed ? "false" : "true"}" title="${isCollapsed ? "展开子节点" : "收起子节点"}">${isCollapsed ? "▸" : "▾"}</button>`
        : `<span class="duty-field-toggle-spacer" aria-hidden="true"></span>`;
      const sub = hasKids
        ? `<ul class="duty-field-ul" ${isCollapsed ? "hidden" : ""}>${renderDutyFieldTreeInnerHtml(node.children, path, editable)}</ul>`
        : "";
      const row = editable
        ? `<div class="duty-field-row">
        ${toggleBtn}
        <input type="text" class="duty-field-label-input" data-df-path="${escapeAttr(path)}" value="${label}" placeholder="节点名称" maxlength="512" />
        <button type="button" class="action duty-field-btn" data-df-add-child="${escapeAttr(path)}">＋子项</button>
        <button type="button" class="action duty-field-btn" data-df-add-sibling="${escapeAttr(path)}">＋同级</button>
        <button type="button" class="action danger duty-field-btn" data-df-remove="${escapeAttr(path)}">删除</button>
      </div>`
        : `<div class="duty-field-row duty-field-row--readonly">
        ${toggleBtn}
        <span class="duty-field-label-text">${escapeHtml(String(node.label ?? ""))}</span>
      </div>`;
      return `<li class="duty-field-li" data-df-path="${escapeAttr(path)}">
      ${row}
      ${sub}
    </li>`;
    })
    .join("");
}

export async function fetchDutyFieldTreeFromServer() {
  state.dutyFieldTreeLoading = true;
  state.dutyFieldTreeMsg = "";
  requestRender();
  try {
    const op = getCurrentOperator();
    const resp = await fetch(`${API_BASE_URL}/api/params/duty-field/tree?operator_id=${encodeURIComponent(op.account)}`);
    let data = {};
    try {
      data = await resp.json();
    } catch (_e) {
      data = {};
    }
    if (!resp.ok) {
      const detail = data.detail != null ? String(data.detail) : `HTTP ${resp.status}`;
      state.dutyFieldTreeMsg = resp.status === 503 ? detail : `加载失败：${detail}`;
      state.dutyFieldTree = [];
    } else {
      state.dutyFieldTree = Array.isArray(data.nodes) ? data.nodes : [];
    }
  } catch (_e) {
    state.dutyFieldTreeMsg = "加载失败（网络异常）";
    state.dutyFieldTree = [];
  } finally {
    state.dutyFieldTreeLoading = false;
    requestRender();
  }
}

export async function saveDutyFieldTreeToServer(options) {
  const exitEditOnSuccess = !!(options && options.exitEditOnSuccess);
  if (state.dutyFieldTreeLoading || state.dutyFieldTreeSaving) return;
  if (dutyFieldTreeHasEmptyLabel(state.dutyFieldTree)) {
    window.alert("存在未填写名称的节点，请补全或删除后再保存。");
    return;
  }
  state.dutyFieldTreeSaving = true;
  state.dutyFieldTreeMsg = "";
  requestRender();
  try {
    const op = getCurrentOperator();
    const body = { operator_id: op.account, nodes: stripDutyFieldIdsForApi(state.dutyFieldTree) };
    const resp = await fetch(`${API_BASE_URL}/api/params/duty-field/tree`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let detail = "";
    try {
      const j = await resp.json();
      detail = j.detail != null ? String(j.detail) : "";
    } catch (_e) {}
    if (!resp.ok) {
      const errText = detail || `保存失败（HTTP ${resp.status}）`;
      state.dutyFieldTreeMsg = errText;
      window.alert(errText);
    } else {
      state.dutyFieldTreeMsg = "";
      try {
        const op2 = getCurrentOperator();
        const r2 = await fetch(`${API_BASE_URL}/api/params/duty-field/tree?operator_id=${encodeURIComponent(op2.account)}`);
        const d2 = await r2.json();
        if (r2.ok && Array.isArray(d2.nodes)) state.dutyFieldTree = d2.nodes;
      } catch (_e) {
        /* 树仍以本地为准 */
      }
      if (exitEditOnSuccess) state.dutyFieldEditMode = false;
    }
  } catch (_e) {
    const errText = "保存失败（网络异常）";
    state.dutyFieldTreeMsg = errText;
    window.alert(errText);
  } finally {
    state.dutyFieldTreeSaving = false;
    requestRender();
  }
}

export function bindDutyFieldParamsPage() {
  if (state.dutyFieldNeedsRefresh) {
    state.dutyFieldNeedsRefresh = false;
    void fetchDutyFieldTreeFromServer();
  }

  const panel = document.getElementById("duty-field-panel");
  if (!panel) return;

  panel.querySelector("#duty-field-edit-btn")?.addEventListener("click", () => {
    state.dutyFieldEditMode = true;
    state.dutyFieldTreeMsg = "";
    requestRender();
  });
  panel.querySelector("#duty-field-done-btn")?.addEventListener("click", () => void saveDutyFieldTreeToServer({ exitEditOnSuccess: true }));
  panel.querySelector("#duty-field-cancel-btn")?.addEventListener("click", () => {
    state.dutyFieldEditMode = false;
    state.dutyFieldTreeMsg = "";
    void fetchDutyFieldTreeFromServer();
  });
  panel.querySelector("#duty-field-add-root-btn")?.addEventListener("click", () => {
    state.dutyFieldTree.push({ label: "", children: [] });
    state.dutyFieldTreeMsg = "";
    requestRender();
  });

  panel.querySelectorAll(".duty-field-label-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const parts = dutyFieldParsePath(inp.getAttribute("data-df-path") || "");
      const node = dutyFieldNodeAtPath(state.dutyFieldTree, parts);
      if (node) node.label = inp.value;
    });
  });

  panel.addEventListener("click", (ev) => {
    const toggle = ev.target.closest("[data-df-toggle]");
    if (toggle) {
      ev.preventDefault();
      const path = toggle.getAttribute("data-df-toggle") || "";
      if (!path) return;
      const set = state.dutyFieldCollapsedPaths;
      if (set.has(path)) set.delete(path);
      else set.add(path);
      requestRender();
      return;
    }
    if (!state.dutyFieldEditMode || !whitelistAllows("params_duty_field_edit", "readonly")) return;
    const addChild = ev.target.closest("[data-df-add-child]");
    if (addChild) {
      ev.preventDefault();
      const parts = dutyFieldParsePath(addChild.getAttribute("data-df-add-child") || "");
      const node = dutyFieldNodeAtPath(state.dutyFieldTree, parts);
      if (!node) return;
      if (!Array.isArray(node.children)) node.children = [];
      node.children.push({ label: "", children: [] });
      state.dutyFieldTreeMsg = "";
      requestRender();
      return;
    }
    const addSib = ev.target.closest("[data-df-add-sibling]");
    if (addSib) {
      ev.preventDefault();
      const parts = dutyFieldParsePath(addSib.getAttribute("data-df-add-sibling") || "");
      const parentArr = dutyFieldGetParentArray(state.dutyFieldTree, parts);
      if (!parentArr) return;
      const idx = parts[parts.length - 1];
      parentArr.splice(idx + 1, 0, { label: "", children: [] });
      state.dutyFieldTreeMsg = "";
      requestRender();
      return;
    }
    const rm = ev.target.closest("[data-df-remove]");
    if (rm) {
      ev.preventDefault();
      const parts = dutyFieldParsePath(rm.getAttribute("data-df-remove") || "");
      const parentArr = dutyFieldGetParentArray(state.dutyFieldTree, parts);
      if (!parentArr) return;
      const idx = parts[parts.length - 1];
      if (idx < 0 || idx >= parentArr.length) return;
      parentArr.splice(idx, 1);
      state.dutyFieldTreeMsg = "";
      requestRender();
    }
  });
}

export function renderPermissionWhitelistRootRow(group) {
  const item = group.root;
  const { page, detail } = getPermissionWhitelistPageAndDetail(item);
  const curLevel = getPermissionLevelForItem(item.key, state.adminPermissionDraft[item.key]);
  const optionsHtml = getStrategyOptionsHtml(item.key, curLevel);
  const scopeHtml = item.key === "home" ? "可查看工单范围策略同工单详情" : "-";
  return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <strong>${escapeHtml(page)}</strong>
        </div>
      </td>
      <td>
        ${escapeHtml(detail)}
        ${scopeHtml === "-" ? "" : `<div class="perm-row-note">${scopeHtml}</div>`}
      </td>
      <td>
        <select data-perm-item-key="${escapeAttr(item.key)}" ${item.key === "home" ? "disabled" : ""}>
          ${optionsHtml}
        </select>
      </td>
    </tr>
  `;
}

export function renderPermissionFilterHeader(label, key, allRows) {
  const selected = state.adminPermissionFilters.selected[key] || [];
  const values = uniqueColumnValues(allRows, key);
  const isOpen = state.adminPermissionFilters.openKey === key;
  const search = state.adminPermissionFilters.search[key] || "";
  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const allChecked = visibleValues.length > 0 && visibleValues.every((v) => selected.includes(v));
  const active = selected.length > 0 ? "active" : "";
  const options = visibleValues
    .map((v) => `<label class="filter-opt"><input type="checkbox" data-perm-filter-value="${escapeAttr(v)}" ${selected.includes(v) ? "checked" : ""}/> ${escapeHtml(v)}</label>`)
    .join("");
  return `
    <th class="admin-th-filter">
      <span>${label}</span>
      <button type="button" class="filter-icon ${active}" data-perm-filter-open="${key}" title="筛选" aria-label="筛选">⏷</button>
      ${
        isOpen
          ? `<div class="filter-pop">
          <input class="filter-search" type="text" data-perm-filter-search="${key}" placeholder="搜索" value="${escapeAttr(search)}" />
          <label class="filter-opt filter-checkall"><input type="checkbox" data-perm-filter-checkall="${key}" ${allChecked ? "checked" : ""}/> （全选）</label>
          <div class="filter-pop-list">${options || '<div class="filter-empty">无可选值</div>'}</div>
          <div class="filter-pop-actions">
            <button type="button" class="action" data-perm-filter-reset-col="${key}">重置</button>
            <button type="button" class="action primary" data-perm-filter-close>完成</button>
          </div>
        </div>`
          : ""
      }
    </th>
  `;
}

export function renderPermissionTableHead(allRows, showActions) {
  return `<tr>
    ${renderPermissionFilterHeader("角色", "role_code", allRows)}
    ${renderPermissionFilterHeader("是否PL", "is_pl", allRows)}
    ${renderPermissionFilterHeader("节点", "node_key", allRows)}
    ${renderPermissionFilterHeader("字段", "field_key", allRows)}
    ${renderPermissionFilterHeader("权限", "permission_level", allRows)}
    ${showActions ? "<th>操作</th>" : ""}
  </tr>`;
}


export async function createTicketFromOpsAnalysis() {
  await ensureAdminData();
  if (state.activeKey === "patch:list") beginPatchCreateTicketModal();
  else beginCreateTicketModal();
}

let flowStepToggleBound = false;

export function bindGlobalFallbackClicks() {
  if (!flowStepToggleBound) {
    flowStepToggleBound = true;
    document.addEventListener("toggle", (event) => {
      const el = event.target;
      if (!(el instanceof HTMLDetailsElement)) return;
      const step = el.getAttribute("data-flow-step");
      const orderId = el.closest(".flow-wrap")?.getAttribute("data-order-id");
      if (!step || !orderId) return;
      const set = ensureFlowExpandedSteps(orderId);
      if (el.open) set.add(step);
      else set.delete(step);
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const flowJump = target.closest("[data-flow-step-jump]");
    if (flowJump) {
      event.preventDefault();
      event.stopPropagation();
      const step = flowJump.getAttribute("data-flow-step-jump");
      const orderId = flowJump.closest(".flow-wrap")?.getAttribute("data-order-id");
      if (!step || !orderId) return;
      ensureFlowExpandedSteps(orderId).add(step);
      requestRender();
      requestAnimationFrame(() => {
        const wrap = document.querySelector(`.flow-wrap[data-order-id="${orderId}"]`);
        const card = wrap?.querySelector(`.flow-logs details[data-flow-step="${step}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      return;
    }

    // 侧栏 data-nav-key、顶栏 workspace 页签与关闭按钮由 app.js 在每次 render 后绑定；
    // 此处勿重复处理，否则一次点击会触发两次 syncTicketsFromServer + render 导致卡顿。

    const dutySpecialToggle = target.closest("[data-duty-special-toggle]");
    if (dutySpecialToggle) {
      event.preventDefault();
      event.stopPropagation();
      const group = dutySpecialToggle.closest(".menu-submenu-special-group");
      const nested = group?.querySelector(".menu-submenu-nested-wrap");
      if (!nested) return;
      const nextOpen = nested.hidden;
      nested.hidden = !nextOpen;
      state.dutySpecialSubmenuExpanded = nextOpen;
      dutySpecialToggle.setAttribute("aria-expanded", String(nextOpen));
      dutySpecialToggle.textContent = nextOpen ? "▾" : "▸";
      return;
    }

    const dutyAnchorTarget = target.closest("[data-duty-anchor]");
    if (dutyAnchorTarget) {
      event.preventDefault();
      event.stopPropagation();
      const id = dutyAnchorTarget.getAttribute("data-duty-anchor") || "";
      if (!id || !dutyRosterAnchorValid(id)) return;
      ensureDutyTab();
      state.activeKey = "duty:roster";
      history.pushState({}, "", `/duty-roster#${id}`);
      state.dutySuppressMainScrollRestore = true;
      requestRender();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      return;
    }

    const createBtn = target.closest("#create-ticket-btn");
    if (createBtn) {
      event.preventDefault();
      event.stopPropagation();
      createTicketFromOpsAnalysis();
      return;
    }

    const submitActionBtn = target.closest("[data-action-submit]");
    if (submitActionBtn) {
      event.preventDefault();
      event.stopPropagation();
      const form = submitActionBtn.closest("form");
      if (form && typeof form.requestSubmit === "function") {
        form.dataset.flowSubmitPending = "1";
        form.requestSubmit(submitActionBtn);
      } else if (form) {
        form.dataset.flowSubmitPending = "1";
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return;
    }

    const deleteBtn = target.closest("#delete-ticket-btn");
    if (deleteBtn) {
      event.preventDefault();
      event.stopPropagation();
      const selected = new Set(state.selectedTicketIds);
      if (selected.size === 0) {
        window.alert("请先选中要删除的工单");
        return;
      }
      const selectedIds = [...selected].map((x) => String(x || "").trim()).filter(Boolean);
      const ticketNos = [];
      const seenNo = new Set();
      for (const id of selectedIds) {
        const row = ticketList.find((t) => String(t.orderId || "") === id) || getTicketById(id);
        const no = String((row && (row.orderId || row.processId)) || id || "").trim();
        if (!no || seenNo.has(no)) continue;
        seenNo.add(no);
        ticketNos.push(no);
      }
      if (!window.confirm(`此操作将删除${ticketNos.length}条工单，是否继续？`)) {
        return;
      }
      void (async () => {
        const operator = getCurrentOperator();
        const tpl = state.activeKey === "patch:list" ? "HOTPATCH" : "HCS_INCIDENT";
        try {
          const resp = await fetch(`${API_BASE_URL}/api/tickets/bulk-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operator_id: operator.account,
              ticket_nos: ticketNos,
              template_code: tpl,
            }),
          });
          let json = {};
          try {
            json = await resp.json();
          } catch (_) {
            json = {};
          }
          if (!resp.ok) {
            const detail =
              json && json.detail != null
                ? typeof json.detail === "string"
                  ? json.detail
                  : JSON.stringify(json.detail)
                : `HTTP ${resp.status}`;
            window.alert(`删除失败：${detail}`);
            return;
          }
          const deleted = Array.isArray(json?.deleted) ? json.deleted.map((x) => String(x || "").trim()) : [];
          const deletedSet = new Set(deleted);
          const skipped = ticketNos.filter((id) => !deletedSet.has(id));
          ticketList.splice(
            0,
            ticketList.length,
            ...ticketList.filter((t) => !deletedSet.has(String(t.orderId || ""))),
          );
          deleted.forEach((orderId) => {
            delete workflowByOrderId[orderId];
            delete operationLogsByOrderId[orderId];
            delete state.ticketStatusByOrderId[orderId];
            delete state.logSyncStateByOrderId[orderId];
            Object.keys(state.formsByTicket).forEach((k) => {
              if (k.startsWith(`${orderId}:`)) delete state.formsByTicket[k];
            });
          });
          state.openTabs = state.openTabs.filter((tab) => {
            if (!tab.key.startsWith("ticket:")) return true;
            const id = tab.key.replace("ticket:", "");
            return !deletedSet.has(id);
          });
          if (!state.openTabs.some((t) => t.key === state.activeKey)) state.activeKey = ensureHomeTab();
          state.selectedTicketIds = [];
          if (skipped.length) {
            window.alert(
              `以下工单未从数据库删除（库中无此单号、无权、模板不一致或单号与库不一致）：\n${skipped.join("\n")}`,
            );
          }
          await refreshHomeListData();
        } catch (e) {
          window.alert(`删除失败：${e && e.message ? e.message : String(e)}`);
          return;
        }
        requestRender();
      })();
      return;
    }

    const migrateBtn = target.closest("#migrate-ticket-btn");
    if (migrateBtn) {
      event.preventDefault();
      event.stopPropagation();
      openMigrateLegacyModal();
      return;
    }

    const snapshotRebuildBtn = target.closest("#snapshot-rebuild-btn");
    if (snapshotRebuildBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (state.snapshotRebuilding) return;
      if (
        !window.confirm(
          "确认重建工作台 HCS 列表快照？\n将按每批 50 条分批扫描并写入 ticket_list_snapshot，数据量大时可能耗时较久。\n（等同 python scripts/backfill_ticket_list_snapshot.py）",
        )
      ) {
        return;
      }
      state.snapshotRebuilding = true;
      state.snapshotRebuildProgress = "准备重建…";
      state.snapshotRebuildDone = 0;
      state.snapshotRebuildTotal = 0;
      requestRender();
      void (async () => {
        try {
          const summary = await runWorkbenchSnapshotRebuild({
            onProgress: ({ done, total, hasMore }) => {
              state.snapshotRebuildDone = Number(done) || 0;
              state.snapshotRebuildTotal = Number(total) || 0;
              state.snapshotRebuildProgress = hasMore
                ? `重建中… ${state.snapshotRebuildDone}/${state.snapshotRebuildTotal || "—"}`
                : `重建完成 ${state.snapshotRebuildDone}/${state.snapshotRebuildTotal || state.snapshotRebuildDone}`;
              requestRender();
            },
          });
          window.alert(
            `列表快照重建完成：${summary.done}/${summary.total || summary.done} 条 HCS 工单`,
          );
          invalidateWorkbenchListFacets();
          await resyncWorkbenchTicketList();
        } catch (e) {
          window.alert(`重建列表快照失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          state.snapshotRebuilding = false;
          state.snapshotRebuildProgress = "";
          requestRender();
        }
      })();
      return;
    }
  }, true);
}

function hotpatchNodeHandlerMatch(ticket, nodeKey, operator) {
  const ph = ticket?.hotpatchParallelHandlers || ticket?.hotpatch_parallel_handlers;
  if (ph && typeof ph === "object" && ph[nodeKey]) {
    return operatorMatchesPersonField(String(ph[nodeKey]), operator);
  }
  const fbn = ticket?._fieldsByNode || {};
  const plan = fbn.hp_plan || fbn["hp_plan"] || {};
  if (nodeKey === "hp_assign_dev" || nodeKey === "hp_dev_analysis") {
    return plan.开发人员 ? operatorMatchesPersonField(String(plan.开发人员), operator) : false;
  }
  if (nodeKey === "hp_assign_test" || nodeKey === "hp_test_analysis") {
    return plan.测试人员 ? operatorMatchesPersonField(String(plan.测试人员), operator) : false;
  }
  return false;
}

function getFlowExpandedSteps(orderId) {
  const raw = state.flowExpandedStepsByOrderId[orderId];
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw)) return new Set(raw);
  return new Set();
}

function ensureFlowExpandedSteps(orderId) {
  let set = state.flowExpandedStepsByOrderId[orderId];
  if (!(set instanceof Set)) {
    set = getFlowExpandedSteps(orderId);
    state.flowExpandedStepsByOrderId[orderId] = set;
  }
  return set;
}

export function shouldFlowLogBeOpen({ isCurrent, nodeHandlerOk, step, orderId }) {
  if (isCurrent && nodeHandlerOk) return true;
  return getFlowExpandedSteps(orderId).has(step);
}

export function flowStepHasDetailCard(step, visitedSteps) {
  return visitedSteps.has(step);
}

function renderFlowStepJumpLabel(step, labelHtml, hasCard) {
  if (!hasCard) return labelHtml;
  return `<button type="button" class="flow-step-jump" data-flow-step-jump="${escapeAttr(step)}" title="展开${escapeAttr(step)}">${labelHtml}</button>`;
}

/**
 * 热补丁详情顶栏：圆角矩形节点 + 并行泳道（与流程图一致），状态与单行条相同。
 */
function renderHotpatchFlowBarHtml({
  wfNodes,
  nkByStep,
  startIndex,
  effectiveCurrentStep,
  visitedSteps,
  isClosed,
  onlyProblemFill,
  frontierNodeKeys,
}) {
  const indexOf = (step) => wfNodes.indexOf(step);
  const useMulti = Array.isArray(frontierNodeKeys) && frontierNodeKeys.length > 1;

  const stepCell = (step) => {
    const index = indexOf(step);
    if (index < 0) return "";
    if (onlyProblemFill && nkByStep[step] !== "problem_fill") return "";
    if (index < startIndex) return "";
    let stateClass = "upcoming";
    const nk = nkByStep[step];
    const isCurrent =
      !isClosed && (useMulti && nk ? frontierNodeKeys.includes(nk) : index === effectiveCurrentStep);
    if (isCurrent) stateClass = "current";
    else if (visitedSteps.has(step)) stateClass = "passed";
    const hasCard = flowStepHasDetailCard(step, visitedSteps);
    const labelInner = escapeHtml(step);
    const label = renderFlowStepJumpLabel(step, labelInner, hasCard);
    const labelClass = hasCard ? "hp-flow-node-label hp-flow-node-label--jump" : "hp-flow-node-label";
    return `<div class="hp-flow-node hp-flow-node--${stateClass}"><span class="${labelClass}">${label}</span></div>`;
  };

  const connectorBetween = `<span class="hp-flow-connector" aria-hidden="true"></span>`;

  const buildSequence = (steps) => {
    const cells = steps.map(stepCell).filter(Boolean);
    if (!cells.length) return "";
    return `<div class="hp-flow-seq">${cells.join(connectorBetween)}</div>`;
  };

  const buildParallel2 = (lanes) => {
    const rows = lanes
      .map((laneSteps) => {
        const cells = laneSteps.map(stepCell).filter(Boolean);
        if (!cells.length) return "";
        return `<div class="hp-flow-lane">${cells.join(connectorBetween)}</div>`;
      })
      .filter(Boolean)
      .join("");
    if (!rows) return "";
    return `<div class="hp-flow-parallel hp-flow-parallel--2">${rows}</div>`;
  };

  const buildParallel4 = (laneSteps) => {
    const rows = laneSteps
      .map((step) => {
        const c = stepCell(step);
        return c ? `<div class="hp-flow-lane hp-flow-lane--single">${c}</div>` : "";
      })
      .filter(Boolean)
      .join("");
    if (!rows) return "";
    return `<div class="hp-flow-parallel hp-flow-parallel--4">${rows}</div>`;
  };

  const segmentParts = [];
  for (const seg of HOTPATCH_FLOW_BAR_LAYOUT) {
    let html = "";
    if (seg.type === "sequence") html = buildSequence(seg.steps);
    else if (seg.type === "parallel2") html = buildParallel2(seg.lanes);
    else if (seg.type === "parallel4") html = buildParallel4(seg.lanes);
    if (html) segmentParts.push({ type: seg.type, html });
  }
  if (!segmentParts.length) return "";

  const diagramBody = segmentParts
    .map((part, i) => {
      if (i === 0) return part.html;
      const kind = resolveHotpatchFlowJoinKind(segmentParts[i - 1].type, part.type);
      return `${renderHotpatchFlowJoinHtml(kind)}${part.html}`;
    })
    .join("");
  return `<div class="hp-flow-diagram">${diagramBody}</div>`;
}

/** 曾作为来源节点提交过（含建单首节点的 workflow.log）的 step 集合。 */
export function collectSubmittedFromSteps(workflowLogs, opLogs) {
  const set = new Set();
  (workflowLogs || []).forEach((entry) => {
    const step = String(entry?.step || "").trim();
    if (step) set.add(step);
  });
  (opLogs || []).forEach((entry) => {
    const from = String(entry?.from || "").trim();
    if (from && from !== "-") set.add(from);
  });
  return set;
}

/** 当前登录人是否曾作为处理人提交/完成该流程 step（与操作日志、本地 workflow.log 对齐）。 */
export function operatorProcessedFlowStep(step, { workflowLog, opLogs, operator } = {}) {
  const stepName = String(step || "").trim();
  if (!stepName || !operator) return false;
  const actorMatches = (actor) => operatorMatchesPersonField(String(actor || ""), operator);
  if (workflowLog && actorMatches(workflowLog.actor)) return true;
  for (const entry of opLogs || []) {
    if (!actorMatches(entry?.actor)) continue;
    const from = String(entry?.from || "").trim();
    const to = String(entry?.to || "").trim();
    if (from === stepName) return true;
    if (to === stepName) return true;
  }
  return false;
}

/** 工单详情节点卡片是否可编辑（当前节点 / 已走过节点与权限策略一致）。 */
export function resolveFlowNodeEditable({
  isCurrent,
  passedNodeLevel,
  currentStageLevel,
  nodeHandlerOk,
  selfProcessedStep,
}) {
  if (isCurrent) return currentStageLevel === "editable" || nodeHandlerOk;
  if (passedNodeLevel === "editable") return true;
  if (passedNodeLevel === "readonly" && selfProcessedStep) return true;
  return false;
}

/** 节点卡片右上角处理人/时间：仅来源已提交节点展示，首次抵达的目标节点留空。 */
export function resolveFlowLogMetaText({ log, latestMeta, submittedFromStep }) {
  if (log) return `${log.actor} · ${log.at}`;
  if (!submittedFromStep) return "";
  if (latestMeta) return `${latestMeta.actor} · ${latestMeta.at}`;
  return "暂无记录";
}

/** 与 renderWorkflow 一致的流程上下文，供详情预加载与渲染共用。 */
export function buildWorkflowDetailContext(orderId) {
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  const ticket = getTicketById(orderId);
  if (!ticket) return null;
  const wfTpl = String(ticket?.templateCode || "") === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const wfNodes = wfTpl === "HOTPATCH" ? HOTPATCH_WORKFLOW_NODES : WORKFLOW_NODES;
  const nkByStep = wfTpl === "HOTPATCH" ? HOTPATCH_NODE_KEY_BY_STEP : NODE_KEY_BY_STEP;
  const stepByKey = wfTpl === "HOTPATCH" ? HOTPATCH_STEP_BY_NODE_KEY : STEP_BY_NODE_KEY;
  const inferredIndex = resolveWorkflowStepIndexFromTicket(ticket, wfNodes, stepByKey);
  const effectiveCurrentStep = inferredIndex >= 0 ? inferredIndex : workflow.currentStep;
  const frontierNodeKeys =
    wfTpl === "HOTPATCH" && Array.isArray(ticket?.hotpatchFrontierKeys) ? ticket.hotpatchFrontierKeys : null;
  const parallelMulti = Boolean(frontierNodeKeys && frontierNodeKeys.length > 1);
  const logsByStep = new Map(workflow.logs.map((log) => [log.step, log]));
  const firstStep = workflow.logs[0]?.step || "";
  const firstStepIndex = wfNodes.indexOf(firstStep);
  const isCreatedFromOps = String(orderId || "").startsWith("N");
  const startIndex =
    firstStepIndex >= 0 ? firstStepIndex : wfTpl === "HOTPATCH" ? 0 : isCreatedFromOps ? WORKFLOW_NODES.indexOf("运维分析") : 0;
  const ticketStatus = String(ticket?.status || state.ticketStatusByOrderId[orderId] || "open").trim();
  const isClosed = isTicketClosedStatus(ticketStatus);
  let currentStepLabel = wfNodes[effectiveCurrentStep] || "";
  if (parallelMulti && frontierNodeKeys.length) {
    currentStepLabel = frontierNodeKeys
      .map((k) => HOTPATCH_STEP_BY_NODE_KEY[k] || k)
      .filter(Boolean)
      .join("，");
  }
  const visitedSteps = new Set(workflow.logs.map((log) => String(log.step || "")).filter(Boolean));
  const opLogs = operationLogsByOrderId[orderId] || [];
  const submittedFromSteps = collectSubmittedFromSteps(workflow.logs, opLogs);
  const latestMetaByStep = new Map();
  opLogs.forEach((log) => {
    const from = String(log.from || "");
    const to = String(log.to || "");
    if (from) visitedSteps.add(from);
    if (to) visitedSteps.add(to);
    if (from) latestMetaByStep.set(from, { actor: String(log.actor || "-"), at: String(log.at || "") });
  });
  if (parallelMulti && frontierNodeKeys.length) {
    frontierNodeKeys.forEach((k) => {
      const lab = HOTPATCH_STEP_BY_NODE_KEY[k];
      if (lab) visitedSteps.add(lab);
    });
  } else if (currentStepLabel) {
    visitedSteps.add(currentStepLabel);
  }
  const operator = getCurrentOperator();
  const assignee = String(ticket?.assignee || "");
  const isCurrentHandler =
    assignee === operator.userName ||
    assignee === operator.account ||
    assignee.includes(operator.account) ||
    assignee.includes(operator.userName);
  const whitelist = getCurrentWhitelistSettings();
  const passedNodeLevel = getWhitelistLevel("ticket_detail_passed_nodes", whitelist);
  const currentStageLevel = getWhitelistLevel("ticket_detail_current_stage", whitelist);
  const onlyProblemFill = passedNodeLevel === "hidden";
  return {
    ticket,
    wfTpl,
    wfNodes,
    nkByStep,
    startIndex,
    effectiveCurrentStep,
    visitedSteps,
    isClosed,
    onlyProblemFill,
    frontierNodeKeys,
    parallelMulti,
    logsByStep,
    submittedFromSteps,
    latestMetaByStep,
    isCurrentHandler,
    passedNodeLevel,
    currentStageLevel,
    operator,
    opLogs,
  };
}

export function computeDetailFormNodeKeys(orderId) {
  const ctx = buildWorkflowDetailContext(orderId);
  if (!ctx) return [];
  const { wfNodes, nkByStep, startIndex, visitedSteps, onlyProblemFill } = ctx;
  const keys = [];
  wfNodes.forEach((step, index) => {
    if (onlyProblemFill && nkByStep[step] !== "problem_fill") return;
    if (index < startIndex) return;
    if (!visitedSteps.has(step)) return;
    const nk = nkByStep[step];
    if (nk) keys.push(nk);
  });
  return keys;
}

export function detailFormsReady(orderId) {
  const id = String(orderId || "").trim();
  if (!id || !getTicketById(id)) return false;
  const keys = computeDetailFormNodeKeys(id);
  if (!keys.length) return true;
  return keys.every((k) => {
    const fs = getFormState(id, k);
    return fs.loaded || fs.failed || fs.notFound;
  });
}

/** 进入详情前丢弃该工单的本地详情缓存，避免列表/旧会话中的节点与阶段滞后。 */
export function invalidateTicketDetailSession(orderId) {
  const id = String(orderId || "").trim();
  if (!id || isCreateDraftTicketId(id)) return;
  clearTicketFormCache(id);
  delete state.logSyncStateByOrderId[id];
  delete operationLogsByOrderId[id];
  const wf = workflowByOrderId[id];
  if (wf) {
    workflowByOrderId[id] = { ...wf, logs: [] };
  }
}

/** 进入详情前标记须整页「加载中…」，并清理本地详情缓存以强制从服务端拉最新态。 */
export function prepareTicketDetailEnter(orderId) {
  const id = String(orderId || "").trim();
  if (!id) {
    state.ticketDetailHydratingOrderId = "";
    return;
  }
  invalidateTicketDetailSession(id);
  state.ticketDetailHydratingOrderId = id;
}

const _detailPreloadByOrderId = new Map();

/** 并行预加载详情页各节点表单与操作日志，期间不触发中间帧重绘。 */
export async function preloadTicketDetailContent(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;
  if (_detailPreloadByOrderId.has(id)) return _detailPreloadByOrderId.get(id);
  const task = (async () => {
    const suppress = { suppressRender: true };
    await syncOperationLogsFromServer(id, { ...suppress, force: true });
    const ctx = buildWorkflowDetailContext(id);
    if (!ctx) return;
    const keys = computeDetailFormNodeKeys(id);
    await Promise.all(keys.map((k) => ensureNodeFormData(id, k, ctx.wfTpl, false, suppress)));
  })().finally(() => {
    _detailPreloadByOrderId.delete(id);
  });
  _detailPreloadByOrderId.set(id, task);
  return task;
}

export function isTicketDetailShowLoading(isTicketDetail, ticketListLoading, activeTicket, hydratingOrderId) {
  if (!isTicketDetail) return false;
  if (ticketListLoading && !activeTicket) return true;
  const orderId = activeTicket?.orderId || "";
  return !!orderId && hydratingOrderId === orderId;
}

export function renderWorkflow(orderId) {
  const ctx = buildWorkflowDetailContext(orderId);
  if (!ctx) {
    return `<section class="flow-wrap flow-wrap-full" data-order-id="${escapeAttr(orderId)}"><p class="problem-fill-status">未找到工单。</p></section>`;
  }
  const {
    ticket,
    wfTpl,
    wfNodes,
    nkByStep,
    startIndex,
    effectiveCurrentStep,
    visitedSteps,
    isClosed,
    onlyProblemFill,
    frontierNodeKeys,
    parallelMulti,
    logsByStep,
    submittedFromSteps,
    latestMetaByStep,
    isCurrentHandler,
    passedNodeLevel,
    currentStageLevel,
    operator,
    opLogs,
  } = ctx;
  const nodeBar =
    wfTpl === "HOTPATCH"
      ? renderHotpatchFlowBarHtml({
          wfNodes,
          nkByStep,
          startIndex,
          effectiveCurrentStep,
          visitedSteps,
          isClosed,
          onlyProblemFill,
          frontierNodeKeys,
        })
      : wfNodes
          .map((step, index) => {
            if (onlyProblemFill && nkByStep[step] !== "problem_fill") return "";
            if (index < startIndex) return "";
            let stateClass = "upcoming";
            if (!isClosed && index === effectiveCurrentStep) stateClass = "current";
            else if (visitedSteps.has(step)) stateClass = "passed";
            const hasCard = flowStepHasDetailCard(step, visitedSteps);
            const label = renderFlowStepJumpLabel(step, escapeHtml(step), hasCard);
            const labelClass = hasCard ? "flow-label flow-label--jump" : "flow-label";
            return `<li class="flow-node ${stateClass}">
      <span class="flow-dot"></span>
      <span class="${labelClass}">${label}</span>
    </li>`;
          })
          .filter(Boolean)
          .join("");

  const logs = wfNodes.map((step, index) => {
    if (onlyProblemFill && nkByStep[step] !== "problem_fill") return "";
    if (index < startIndex) return "";
    if (!visitedSteps.has(step)) return "";
    const nk = nkByStep[step];
    const isCurrent = (() => {
      if (isClosed) return false;
      if (parallelMulti && nk) return frontierNodeKeys.includes(nk);
      return index === effectiveCurrentStep;
    })();
    const log = logsByStep.get(step);
    const latestMeta = latestMetaByStep.get(step);
    const nodeKey = nk;
    const nodeHandlerOk = parallelMulti && nodeKey ? hotpatchNodeHandlerMatch(ticket, nodeKey, operator) : isCurrentHandler;
    const selfProcessedStep = operatorProcessedFlowStep(step, { workflowLog: log, opLogs, operator });
    let formBody = "";
    if (nodeKey) {
      const editable = resolveFlowNodeEditable({
        isCurrent,
        passedNodeLevel,
        currentStageLevel,
        nodeHandlerOk,
        selfProcessedStep,
      });
      ensureNodeFormData(orderId, nodeKey, wfTpl);
      formBody = renderNodeForm(orderId, nodeKey, {
        editable,
        isCurrentNode: isCurrent,
        workflowTemplate: wfTpl,
      });
    }
    const formState = nodeKey ? getFormState(orderId, nodeKey) : null;
    let body = formBody;
    if (!body) {
      if (formState?.notFound && formState.loaded) {
        body = log ? log.summary : `<p class="problem-fill-status">该节点暂无表单定义。</p>`;
      } else if (!formState?.loading && !formState?.failed) {
        body = log ? log.summary : "暂无处理内容。";
      }
    }
    const open = shouldFlowLogBeOpen({ isCurrent, nodeHandlerOk, step, orderId }) ? "open" : "";
    const metaText = resolveFlowLogMetaText({
      log,
      latestMeta,
      submittedFromStep: submittedFromSteps.has(step),
    });
    const logClass = isCurrent ? "flow-log" : "flow-log flow-log-passed";
    return `
      <details class="${logClass}" data-flow-step="${escapeAttr(step)}" ${open}>
        <summary>
          <span>${step}</span>
          <span class="flow-log-meta">${metaText}</span>
        </summary>
        <div class="flow-log-body">${body}</div>
      </details>
    `;
  })
    .filter(Boolean)
    .join("");

  const flowBarTag = wfTpl === "HOTPATCH" ? "div" : "ol";
  const flowBarClass = wfTpl === "HOTPATCH" ? "flow-bar flow-bar--hotpatch" : "flow-bar";

  return `
    <section class="flow-wrap flow-wrap-full" data-order-id="${escapeAttr(orderId)}">
      <${flowBarTag} class="${flowBarClass}">${nodeBar}</${flowBarTag}>
      <div class="flow-logs">
        ${logs}
      </div>
    </section>
  `;
}

export function advanceWorkflow(orderId, fromNodeKey, toNodeKey, handleMode, workflowTemplate = "HCS_INCIDENT") {
  const workflow = workflowByOrderId[orderId];
  if (!workflow) return;
  const wf = workflowTemplate === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const stepBy = wf === "HOTPATCH" ? HOTPATCH_STEP_BY_NODE_KEY : STEP_BY_NODE_KEY;
  const wfNodes = wf === "HOTPATCH" ? HOTPATCH_WORKFLOW_NODES : WORKFLOW_NODES;
  const fromStep = stepBy[fromNodeKey];
  const toStep = stepBy[toNodeKey];
  if (!fromStep || !toStep) return;
  const fromIndex = wfNodes.indexOf(fromStep);
  const toIndex = wfNodes.indexOf(toStep);
  if (toIndex < 0) return;
  const moveLabel = toIndex === fromIndex ? "本节点" : toIndex > fromIndex ? "下一节点" : "回退节点";

  workflow.currentStep = toIndex;
  const at = nowText();
  const operator = getCurrentOperator();
  workflow.logs.push({
    step: fromStep,
    actor: operator.userName,
    at,
    summary: handleMode ? `处理方式：${handleMode}，${moveLabel}至 ${toStep}。` : `${moveLabel}至 ${toStep}。`,
  });

  const logs = operationLogsByOrderId[orderId] || [];
  logs.push({
    at,
    actor: operator.userName,
    action: moveLabel,
    from: fromStep,
    to: toStep,
    nextHandler: "-",
  });
  operationLogsByOrderId[orderId] = logs;
  const closed =
    handleMode === "问题解决关闭" ||
    handleMode === "非问题关闭" ||
    handleMode === "完成" ||
    handleMode === "裁决未通过（结束）";
  if (closed) {
    state.ticketStatusByOrderId[orderId] = "closed";
  } else if (!state.ticketStatusByOrderId[orderId]) {
    state.ticketStatusByOrderId[orderId] = "open";
  }
}

export function renderOperationLogs(orderId) {
  const logs = operationLogsByOrderId[orderId] || [];
  const drawerClass = state.logDrawerOpen ? "open" : "";
  const rows = logs
    .map(
      (log) => `
      <tr>
        <td>${log.at}</td>
        <td>${log.actor}</td>
        <td>${log.action}</td>
        <td>${log.from}</td>
        <td>${log.to}</td>
        <td>${escapeHtml(String(log.nextHandler || log.next_handler || "-"))}</td>
      </tr>
    `
    )
    .join("");
  return `
    <aside class="oplog-drawer ${drawerClass}">
      <div class="oplog-panel">
        <div class="oplog-head">
          <div class="oplog-title">log</div>
          <button class="oplog-close" id="close-log-drawer-btn" type="button">×</button>
        </div>
        <div class="oplog-table-wrap">
        <table class="oplog-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th>来源节点</th>
              <th>目标节点</th>
              <th>下一步处理人</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="6">No logs</td></tr>`}
          </tbody>
        </table>
        </div>
      </div>
    </aside>
  `;
}

export function cascadeReadTreeFromWrap(wrap) {
  const el = wrap.querySelector("script.cascade-tree-data");
  if (!el || !el.textContent) return [];
  try {
    return JSON.parse(el.textContent);
  } catch (_e) {
    return [];
  }
}

export function dutyCascaderRenderPanel(wrap) {
  const tree = cascadeReadTreeFromWrap(wrap);
  const colsEl = wrap.querySelector("[data-cascade-columns]");
  const preview = wrap.querySelector(".cascade-cascader-preview");
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const searchInput = wrap.querySelector("[data-cascade-search]");
  const searchKw = String(searchInput?.value || "").trim();
  if (!colsEl) return;
  let path = [];
  try {
    path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
  } catch (_e) {
    path = [];
  }
  const scrollByDepth = dutyCascaderCaptureColumnScroll(colsEl);
  if (!Array.isArray(tree) || !tree.length) {
    colsEl.classList.remove("is-search-mode");
    colsEl.innerHTML = `<div class="cascade-cascader-empty">${escapeHtml("暂无选项，请先在责任田模块维护")}</div>`;
    if (preview) preview.textContent = "";
    if (panel && !panel.hidden && panel.classList.contains("is-open")) {
      requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
    }
    return;
  }
  if (searchKw) {
    const hidden = wrap.querySelector("[data-cascade-hidden]");
    colsEl.classList.add("is-search-mode");
    colsEl.innerHTML = dutyCascaderSearchPanelHtml(tree, searchKw, hidden?.value || "");
  } else {
    colsEl.classList.remove("is-search-mode");
    const columns = dutyCascaderColumnsData(tree, path);
    colsEl.innerHTML = columns.map((col) => dutyCascaderColumnHtml(col.depth, col.list, col.activeLabel)).join("");
    dutyCascaderRestoreColumnScroll(colsEl, scrollByDepth);
  }
  if (preview) {
    const p = path.filter((x) => String(x || "").trim());
    preview.textContent = p.length ? p.join(DUTY_FIELD_CASCADE_SEP) : "";
  }
  if (panel && !panel.hidden && panel.classList.contains("is-open")) {
    requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
  }
}

export function dutyCascaderClearPanelStyles(panel) {
  if (!panel) return;
  ["position", "left", "top", "right", "bottom", "width", "minWidth", "maxWidth", "maxHeight", "zIndex"].forEach((k) => {
    panel.style[k] = "";
  });
}

export function dutyCascaderEnsureGeomListeners() {
  if (dutyCascaderGeomListenersBound) return;
  dutyCascaderGeomListenersBound = true;
  const repo = () => {
    if (dutyCascaderOpenWrap) dutyCascaderPositionPanel(dutyCascaderOpenWrap);
    if (wfFlatSelectOpenWrap) wfFlatSelectPositionPanel(wfFlatSelectOpenWrap);
  };
  window.addEventListener("scroll", repo, true);
  window.addEventListener("resize", repo);
}

export function dutyCascaderSetOpenWrap(wrap) {
  dutyCascaderOpenWrap = wrap;
  dutyCascaderEnsureGeomListeners();
}

export function dutyCascaderClearOpenWrap(wrap) {
  if (dutyCascaderOpenWrap === wrap) dutyCascaderOpenWrap = null;
}

export function dutyCascaderPositionPanel(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  if (!panel || !trig || panel.hidden || !panel.classList.contains("is-open")) return;
  const r = trig.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cap = Math.min(560, vw - margin * 2);
  panel.style.position = "absolute";
  panel.style.width = "";
  panel.style.maxWidth = `${cap}px`;
  panel.style.minWidth = `${Math.min(280, Math.max(96, Math.ceil(r.width)))}px`;
  panel.style.left = "0px";
  panel.style.top = `${Math.max(4, trig.offsetHeight + 4)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.zIndex = "10050";
  panel.style.maxHeight = `${Math.max(160, vh - r.bottom - margin * 2)}px`;

  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    if (pr.right > vw - margin) {
      const shift = Math.max(margin - r.left, (vw - margin) - pr.right);
      panel.style.left = `${Math.floor(shift)}px`;
    }
    if (pr.bottom > vh - margin) {
      const above = r.top - margin - pr.height;
      if (above >= margin) {
        panel.style.top = `${-Math.ceil(pr.height + 4)}px`;
        panel.style.maxHeight = `${Math.max(160, r.top - margin * 2)}px`;
      }
    }
  });
}

export function dutyCascaderSyncTrigger(wrap) {
  const h = wrap.querySelector("[data-cascade-hidden]");
  const labelEl = wrap.querySelector(".cascade-cascader-label");
  if (!h || !labelEl) return;
  const v = normalizeDutyCascadeValue(h.value);
  labelEl.textContent = v || "请选择";
  labelEl.classList.toggle("is-placeholder", !v);
}

export function dutyCascaderClose(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  const searchInput = wrap.querySelector("[data-cascade-search]");
  dutyCascaderClearOpenWrap(wrap);
  if (searchInput) searchInput.value = "";
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("is-open");
    dutyCascaderClearPanelStyles(panel);
  }
  if (trig) trig.setAttribute("aria-expanded", "false");
}

export function dutyCascaderCommit(wrap, pathParts) {
  const parts = pathParts.map((p) => String(p || "").trim()).filter(Boolean);
  const hidden = wrap.querySelector("[data-cascade-hidden]");
  if (!hidden) return;
  hidden.value = parts.join(DUTY_FIELD_CASCADE_SEP);
  dutyCascaderSyncTrigger(wrap);
  dutyCascaderClose(wrap);
  delete wrap.dataset.cascadeNavPath;
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

export function dutyCascaderConfirmCurrent(wrap) {
  let path = [];
  try {
    path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
  } catch (_e) {
    path = [];
  }
  const parts = path.map((p) => String(p || "").trim()).filter(Boolean);
  if (!parts.length) return;
  dutyCascaderCommit(wrap, parts);
}

export function wfFlatSelectClearPanelStyles(panel) {
  if (!panel) return;
  ["position", "left", "top", "right", "bottom", "width", "minWidth", "maxWidth", "maxHeight", "zIndex"].forEach((k) => {
    panel.style[k] = "";
  });
}

export function wfFlatSelectSetOpenWrap(wrap) {
  wfFlatSelectOpenWrap = wrap;
  dutyCascaderEnsureGeomListeners();
}

export function wfFlatSelectClearOpenWrap(wrap) {
  if (wfFlatSelectOpenWrap === wrap) wfFlatSelectOpenWrap = null;
}

export function wfFlatSelectPositionPanel(wrap) {
  const panel = wrap.querySelector(".wf-flat-select-panel");
  const trig = wrap.querySelector(".wf-flat-select-trigger");
  if (!panel || !trig || panel.hidden || !panel.classList.contains("is-open")) return;
  const r = trig.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.width, 160), vw - margin * 2);
  panel.style.position = "absolute";
  panel.style.width = `${Math.ceil(w)}px`;
  panel.style.minWidth = `${Math.ceil(Math.min(280, Math.max(96, r.width)))}px`;
  panel.style.left = "0px";
  panel.style.top = `${Math.max(4, trig.offsetHeight + 4)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.zIndex = "10050";
  panel.style.maxHeight = `${Math.max(160, vh - r.bottom - margin * 2)}px`;

  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    if (pr.right > vw - margin) {
      const shift = Math.max(margin - r.left, (vw - margin) - pr.right);
      panel.style.left = `${Math.floor(shift)}px`;
    }
    if (pr.bottom > vh - margin) {
      const above = r.top - margin - pr.height;
      if (above >= margin) {
        panel.style.top = `${-Math.ceil(pr.height + 4)}px`;
        panel.style.maxHeight = `${Math.max(160, r.top - margin * 2)}px`;
      }
    }
  });
}

export function wfFlatSelectSyncLabel(wrap) {
  const h = wrap.querySelector("[data-wf-flat-value]");
  const labelEl = wrap.querySelector(".wf-flat-select-label");
  if (!h || !labelEl) return;
  const v = String(h.value || "").trim();
  const ph = wrap.dataset.wfFlatPlaceholder === "1";
  const phText = String(wrap.dataset.wfFlatPlaceholderText || "请选择").trim() || "请选择";
  labelEl.textContent = v || (ph ? phText : "");
  labelEl.classList.add("cascade-cascader-label");
  labelEl.classList.toggle("is-placeholder", !v && ph);
}

export function wfFlatSelectApplySearch(wrap, keyword) {
  const kw = String(keyword || "").trim();
  const personSelect = wrap.dataset.wfPersonSelect === "1";
  let shown = 0;
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    const isPlaceholder = btn.classList.contains("wf-flat-select-item--placeholder");
    const txt = String(btn.getAttribute("data-wf-search-text") || btn.textContent || "").trim();
    const keep = !kw
      ? !isPlaceholder
      : !isPlaceholder && (personSelect ? personOptionMatchesKeyword(txt, kw) : txt.toLowerCase().includes(kw.toLowerCase()));
    btn.hidden = !keep;
    if (keep) shown += 1;
  });
  const emptyEl = wrap.querySelector("[data-wf-flat-empty]");
  if (emptyEl) emptyEl.hidden = shown > 0;
}

export function wfFlatSelectClose(wrap) {
  const panel = wrap.querySelector(".wf-flat-select-panel");
  const trig = wrap.querySelector(".wf-flat-select-trigger");
  wfFlatSelectClearOpenWrap(wrap);
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("is-open");
    wfFlatSelectClearPanelStyles(panel);
  }
  if (trig) trig.setAttribute("aria-expanded", "false");
}

export function wfFlatSelectToggle(wrap) {
  const panel = wrap.querySelector(".wf-flat-select-panel");
  const trig = wrap.querySelector(".wf-flat-select-trigger");
  const searchInput = wrap.querySelector("[data-wf-flat-search]");
  if (!panel || !trig) return;
  const isOpen = !panel.hidden && panel.classList.contains("is-open");
  if (isOpen) {
    if (searchInput) {
      searchInput.value = "";
      wfFlatSelectApplySearch(wrap, "");
    }
    wfFlatSelectClose(wrap);
    return;
  }
  document.querySelectorAll(".cascade-cascader").forEach((w) => dutyCascaderClose(w));
  document.querySelectorAll("[data-wf-flat-select]").forEach((w) => {
    if (w !== wrap) wfFlatSelectClose(w);
  });
  wfFlatSelectSetOpenWrap(wrap);
  panel.hidden = false;
  panel.classList.add("is-open");
  trig.setAttribute("aria-expanded", "true");
  if (searchInput) {
    searchInput.value = "";
    wfFlatSelectApplySearch(wrap, "");
  }
  requestAnimationFrame(() => {
    wfFlatSelectPositionPanel(wrap);
    requestAnimationFrame(() => wfFlatSelectPositionPanel(wrap));
    if (searchInput) searchInput.focus();
  });
}

export function wfFlatSelectCommit(wrap, value) {
  const hidden = wrap.querySelector("[data-wf-flat-value]");
  if (!hidden) return;
  hidden.value = value == null ? "" : String(value);
  wfFlatSelectSyncLabel(wrap);
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    const raw = btn.getAttribute("data-wf-flat-value-pick");
    const pickVal = raw == null ? "" : String(raw);
    btn.classList.toggle("is-active", pickVal === String(hidden.value || ""));
  });
  wfFlatSelectClose(wrap);
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

export function wfFlatMultiSelectSyncChips(wrap) {
  const hidden = wrap.querySelector("[data-wf-flat-value]");
  const inner = wrap.querySelector(".wf-flat-select-inner");
  if (!hidden || !inner) return;
  const selected = parseMultiPersonValue(hidden.value);
  let chipsEl = inner.querySelector(".wf-flat-multi-chips");
  if (!selected.length) {
    if (chipsEl) chipsEl.remove();
    return;
  }
  const html = selected
    .map(
      (item) =>
        `<span class="wf-flat-multi-chip" title="${escapeAttr(item)}">${escapeHtml(item)}<button type="button" class="wf-flat-multi-chip-remove" data-wf-flat-chip-remove="${escapeAttr(item)}" aria-label="移除">×</button></span>`
    )
    .join("");
  if (!chipsEl) {
    chipsEl = document.createElement("div");
    chipsEl.className = "wf-flat-multi-chips";
    const panel = inner.querySelector(".wf-flat-select-panel");
    inner.insertBefore(chipsEl, panel);
  }
  chipsEl.innerHTML = html;
}

export function wfFlatMultiSelectSyncLabel(wrap) {
  const h = wrap.querySelector("[data-wf-flat-value]");
  const labelEl = wrap.querySelector(".wf-flat-select-label");
  if (!h || !labelEl) return;
  const stored = joinMultiPersonValue(parseMultiPersonValue(h.value));
  h.value = stored;
  const ph = wrap.dataset.wfFlatPlaceholder === "1";
  labelEl.textContent = stored || (ph ? "请选择" : "");
  labelEl.title = stored;
  labelEl.classList.toggle("is-placeholder", !stored && ph);
  wfFlatMultiSelectSyncChips(wrap);
}

export function wfFlatMultiSelectSyncActive(wrap) {
  const hidden = wrap.querySelector("[data-wf-flat-value]");
  if (!hidden) return;
  const selected = new Set(parseMultiPersonValue(hidden.value));
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    const isPlaceholder = btn.classList.contains("wf-flat-select-item--placeholder");
    const raw = btn.getAttribute("data-wf-flat-value-pick");
    const pickVal = raw == null ? "" : String(raw);
    if (isPlaceholder) {
      btn.classList.toggle("is-active", selected.size === 0);
      return;
    }
    btn.classList.toggle("is-active", selected.has(pickVal));
  });
}

export function wfFlatMultiSelectTogglePick(wrap, pickVal) {
  const hidden = wrap.querySelector("[data-wf-flat-value]");
  if (!hidden) return;
  const val = String(pickVal ?? "").trim();
  if (!val) {
    hidden.value = "";
  } else {
    const cur = parseMultiPersonValue(hidden.value);
    const idx = cur.indexOf(val);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(val);
    hidden.value = joinMultiPersonValue(cur);
  }
  wfFlatMultiSelectSyncLabel(wrap);
  wfFlatMultiSelectSyncActive(wrap);
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

export function wfFlatMultiSelectRemoveChip(wrap, personVal) {
  const hidden = wrap.querySelector("[data-wf-flat-value]");
  if (!hidden) return;
  const val = String(personVal ?? "").trim();
  const cur = parseMultiPersonValue(hidden.value).filter((x) => x !== val);
  hidden.value = joinMultiPersonValue(cur);
  wfFlatMultiSelectSyncLabel(wrap);
  wfFlatMultiSelectSyncActive(wrap);
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

export function bindWorkflowFlatSelect(form) {
  ensureDutyCascaderDocumentClose();
  if (form.dataset.wfFlatSelectFormBound === "1") return;
  form.dataset.wfFlatSelectFormBound = "1";
  const onFlatSearch = (ev) => {
    const input = ev.target.closest("[data-wf-flat-search]");
    if (!input || !form.contains(input)) return;
    const wrap = input.closest("[data-wf-flat-select]");
    if (!wrap || !form.contains(wrap)) return;
    wfFlatSelectApplySearch(wrap, input.value || "");
  };
  form.addEventListener("input", onFlatSearch);
  form.addEventListener("compositionend", onFlatSearch);
  form.addEventListener("click", (ev) => {
    const doneBtn = ev.target.closest("[data-wf-flat-multi-done]");
    if (doneBtn && form.contains(doneBtn)) {
      ev.preventDefault();
      const wrap = doneBtn.closest("[data-wf-flat-select]");
      if (wrap) wfFlatSelectClose(wrap);
      return;
    }
    const chipRemove = ev.target.closest("[data-wf-flat-chip-remove]");
    if (chipRemove && form.contains(chipRemove)) {
      ev.preventDefault();
      const wrap = chipRemove.closest("[data-wf-flat-select]");
      if (!wrap || !form.contains(wrap)) return;
      const raw = chipRemove.getAttribute("data-wf-flat-chip-remove");
      wfFlatMultiSelectRemoveChip(wrap, raw == null ? "" : String(raw));
      return;
    }
    const trig = ev.target.closest(".wf-flat-select-trigger");
    if (trig && form.contains(trig)) {
      ev.preventDefault();
      wfFlatSelectToggle(trig.closest("[data-wf-flat-select]"));
      return;
    }
    const pick = ev.target.closest("[data-wf-flat-value-pick]");
    if (pick && form.contains(pick)) {
      ev.preventDefault();
      const wrap = pick.closest("[data-wf-flat-select]");
      if (!wrap || !form.contains(wrap)) return;
      const raw = pick.getAttribute("data-wf-flat-value-pick");
      if (wrap.dataset.wfFlatMulti === "1") {
        wfFlatMultiSelectTogglePick(wrap, raw == null ? "" : String(raw));
        return;
      }
      wfFlatSelectCommit(wrap, raw == null ? "" : String(raw));
    }
  });
  form.querySelectorAll('[data-wf-flat-multi="1"]').forEach((wrap) => {
    wfFlatMultiSelectSyncLabel(wrap);
    wfFlatMultiSelectSyncActive(wrap);
  });
}

export function dutyCascaderToggle(wrap) {
  const panel = wrap.querySelector(".cascade-cascader-panel");
  const trig = wrap.querySelector(".cascade-cascader-trigger");
  if (!panel || !trig) return;
  const isOpen = !panel.hidden && panel.classList.contains("is-open");
  if (isOpen) {
    dutyCascaderClose(wrap);
    return;
  }
  document.querySelectorAll("[data-wf-flat-select]").forEach((w) => wfFlatSelectClose(w));
  document.querySelectorAll(".cascade-cascader").forEach((w) => {
    if (w !== wrap) dutyCascaderClose(w);
  });
  const hidden = wrap.querySelector("[data-cascade-hidden]");
  wrap.dataset.cascadeNavPath = JSON.stringify(splitDutyFieldCascadePath(hidden?.value || ""));
  const searchInput = wrap.querySelector("[data-cascade-search]");
  if (searchInput) searchInput.value = "";
  dutyCascaderSetOpenWrap(wrap);
  dutyCascaderRenderPanel(wrap);
  panel.hidden = false;
  panel.classList.add("is-open");
  trig.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    dutyCascaderPositionPanel(wrap);
    requestAnimationFrame(() => {
      dutyCascaderPositionPanel(wrap);
      if (searchInput) searchInput.focus();
    });
  });
}

export function ensureDutyCascaderDocumentClose() {
  if (dutyCascaderDocumentBound) return;
  dutyCascaderDocumentBound = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const inside = e.target.closest(".cascade-cascader");
      const insideFlat = e.target.closest("[data-wf-flat-select]");
      document.querySelectorAll(".cascade-cascader").forEach((w) => {
        if (inside !== w) dutyCascaderClose(w);
      });
      document.querySelectorAll("[data-wf-flat-select]").forEach((w) => {
        if (insideFlat !== w) wfFlatSelectClose(w);
      });
    },
    true,
  );
}

export function bindDutyFieldCascader(form) {
  ensureDutyCascaderDocumentClose();
  if (form.dataset.dutyCascaderFormBound === "1") return;
  form.dataset.dutyCascaderFormBound = "1";
  const lockCascaderColScroll = (ev) => {
    if (!ev.target.closest(".cascade-cascader-col")) return;
    dutyCascaderColScrollLockUntil = Date.now() + 200;
  };
  form.addEventListener("wheel", lockCascaderColScroll, { capture: true, passive: true });
  form.addEventListener("scroll", lockCascaderColScroll, { capture: true, passive: true });
  form.addEventListener("touchmove", lockCascaderColScroll, { capture: true, passive: true });
  const onCascadeSearch = (ev) => {
    const input = ev.target.closest("[data-cascade-search]");
    if (!input || !form.contains(input)) return;
    const wrap = input.closest(".cascade-cascader");
    if (!wrap || !form.contains(wrap)) return;
    dutyCascaderRenderPanel(wrap);
    requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
  };
  form.addEventListener("input", onCascadeSearch);
  form.addEventListener("compositionend", onCascadeSearch);
  form.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-cascade-search]")) return;
    const searchPick = ev.target.closest("[data-cascade-search-pick]");
    if (searchPick && form.contains(searchPick)) {
      ev.preventDefault();
      const wrap = searchPick.closest(".cascade-cascader");
      if (!wrap || !form.contains(wrap)) return;
      const pathStr = searchPick.getAttribute("data-cascade-search-pick") || "";
      dutyCascaderCommit(wrap, splitDutyFieldCascadePath(pathStr));
      return;
    }
    const trig = ev.target.closest(".cascade-cascader-trigger");
    if (trig && form.contains(trig)) {
      ev.preventDefault();
      const wrap = trig.closest(".cascade-cascader");
      if (wrap) dutyCascaderToggle(wrap);
      return;
    }
    const ok = ev.target.closest(".cascade-cascader-confirm");
    if (ok && form.contains(ok)) {
      const wrap = ok.closest(".cascade-cascader");
      if (wrap && form.contains(wrap)) dutyCascaderConfirmCurrent(wrap);
      return;
    }
    const item = ev.target.closest(".cascade-cascader-item");
    if (!item || !form.contains(item)) return;
    const wrap = item.closest(".cascade-cascader");
    if (!wrap || !form.contains(wrap)) return;
    const depth = Number(item.getAttribute("data-depth"));
    if (Number.isNaN(depth)) return;
    const label = item.getAttribute("data-label") || "";
    const hasChildren = item.getAttribute("data-has-children") === "1";
    let path = [];
    try {
      path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
    } catch (_e) {
      path = [];
    }
    const newPath = path.slice(0, depth).concat([label]);
    wrap.dataset.cascadeNavPath = JSON.stringify(newPath);
    if (!hasChildren) {
      dutyCascaderCommit(wrap, newPath);
    } else {
      dutyCascaderRenderPanel(wrap);
    }
  });
  /** 与左侧导航子菜单一致：悬停带子项的行即展开右侧下一列（触控仍可用点击） */
  form.addEventListener("mouseover", (ev) => {
    if (Date.now() < dutyCascaderColScrollLockUntil) return;
    const item = ev.target.closest(".cascade-cascader-item");
    if (!item || !form.contains(item)) return;
    const wrap = item.closest(".cascade-cascader");
    if (!wrap || !form.contains(wrap)) return;
    const panel = wrap.querySelector(".cascade-cascader-panel");
    if (!panel || panel.hidden || !panel.classList.contains("is-open")) return;
    if (item.getAttribute("data-has-children") !== "1") return;
    const depth = Number(item.getAttribute("data-depth"));
    if (Number.isNaN(depth)) return;
    const label = item.getAttribute("data-label") || "";
    const newPath = (() => {
      let path = [];
      try {
        path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
      } catch (_e) {
        path = [];
      }
      return path.slice(0, depth).concat([label]);
    })();
    const nextStr = JSON.stringify(newPath);
    if ((wrap.dataset.cascadeNavPath || "[]") === nextStr) return;
    wrap.dataset.cascadeNavPath = nextStr;
    dutyCascaderRenderPanel(wrap);
  });
}

export function renderNodeForm(orderId, nodeKey, options = {}) {
  const editable = options.editable !== false;
  const isCurrentNode = options.isCurrentNode !== false;
  const hideSaveButton = !!options.hideSaveButton;
  const showFlowFields = shouldRenderFlowFields(isCurrentNode);
  const wfForm = options.workflowTemplate === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const formState = getFormState(orderId, nodeKey);
  if (formState.notFound) return "";
  if (formState.loading && !formState.loaded) {
    return `
      <section class="problem-fill-wrap">
        <p class="problem-fill-status">正在加载字段...</p>
      </section>
    `;
  }

  if (formState.error && !formState.loaded) {
    return `
      <section class="problem-fill-wrap">
        <p class="problem-fill-status error">加载失败：${escapeHtml(formState.error)}</p>
      </section>
    `;
  }

  const fields = (formState.fields || [])
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const ta = getProblemFillFieldSortTier(a.f);
      const tb = getProblemFillFieldSortTier(b.f);
      if (ta !== tb) return ta - tb;
      return a.i - b.i;
    })
    .map(({ f }) => f);
  const fieldRows = fields
    .map((field) => {
      if (!showFlowFields && (field.key === "handle_mode" || field.key === "next_handler")) {
        return "";
      }
      const value = getInitialFieldValue(field, formState.values || {});
      const readonly = field.readonly || !editable ? "readonly" : "";
      const c = field.constraints || {};
      const showMarkSlot =
        field.required ||
        !!(
          c.required_when_visible ||
          (c.required_if && typeof c.required_if === "object" && Object.keys(c.required_if).length)
        );
      const requiredMark = showMarkSlot ? `<span class="required-mark">*</span>` : "";
      const wideText = isWideTextField(field);
      let control = wideText
        ? `<textarea name="${field.key}" rows="8" ${readonly}>${escapeHtml(String(value || ""))}</textarea>`
        : `<input type="text" name="${field.key}" value="${escapeAttr(value)}" ${readonly} />`;
      const fieldCls =
        field.type === "richtext" || wideText ? "problem-field problem-field-rich" : "problem-field";

      if (field.type === "date") {
        control = `<input type="date" name="${field.key}" value="${escapeAttr(value)}" ${readonly} ${!editable ? "disabled" : ""} />`;
      } else if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
        control = renderCascadeWhitelistControl(field, value, editable);
      } else if (field.type === "whitelist") {
        const rawOptions = Array.isArray(field.options) ? field.options : [];
        let options = rawOptions.length > 0 ? rawOptions : ["temp"];
        if (field.key === "root_cause_category" && field.options_by_parent) {
          options = getRootCauseCategoriesForIssueType(field, (formState.values || {}).issue_type);
        }
        if (field.key === "handle_mode") {
          const routeMap =
            wfForm === "HOTPATCH"
              ? HOTPATCH_HANDLE_MODE_ROUTE[nodeKey] || {}
              : HANDLE_MODE_ROUTE[nodeKey] || {};
          const allowedModes = Object.keys(routeMap).filter((k) => k !== "__default__");
          if (allowedModes.length > 0) {
            options = options.filter((item) => allowedModes.includes(item));
          }
          if (nodeKey === "ops_analysis" && wfForm !== "HOTPATCH") {
            const qf = fields.find((f) => f.key === "is_quality_issue");
            const qv = qf
              ? getInitialFieldValue(qf, formState.values || {})
              : (formState.values || {}).is_quality_issue;
            options = filterOpsAnalysisHandleModeOptions(options, qv);
          }
        }
        if (field.key === "issue_type_judge" && nodeKey === "problem_review") {
          const hm =
            getInitialFieldValue(
              fields.find((f) => f.key === "handle_mode") || {},
              formState.values || {}
            ) || (formState.values || {}).handle_mode;
          options = filterProblemReviewIssueTypeJudgeOptions(options, hm);
        }
        if (field.key === "component" && nodeKey === "problem_fill") {
          const pl =
            getInitialFieldValue(
              fields.find((f) => f.key === "product_line") || {},
              formState.values || {}
            ) || (formState.values || {}).product_line;
          options = filterProblemFillComponentOptions(options, pl);
        }
        const usePlaceholder = !WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key);
        if (shouldUseWorkflowFlatSelect(nodeKey, field)) {
          const flatCtx = {
            options,
            usePlaceholder,
            enableSearch: isWorkflowFlatSelectSearchable(field),
            placeholderLabel:
              nodeKey === "problem_fill" && field.key === "location"
                ? PROBLEM_FILL_LOCATION_HINT
                : undefined,
          };
          control = isMultiPersonWhitelistField(field, nodeKey)
            ? renderWorkflowFlatMultiSelect(field, value, editable, flatCtx)
            : renderWorkflowFlatSelect(field, value, editable, flatCtx);
        } else {
          const placeholderOpt = usePlaceholder
            ? `<option value="" ${value === "" ? "selected" : ""}></option>`
            : "";
          const optionHtml = options
            .map((item) => `<option value="${escapeAttr(item)}" ${item === value ? "selected" : ""}>${escapeHtml(item)}</option>`)
            .join("");
          control = `<select name="${field.key}" ${readonly} ${!editable ? "disabled" : ""}>${placeholderOpt}${optionHtml}</select>`;
        }
      } else if (field.type === "file") {
        control = renderTicketFileUploadControl(field, value, editable);
      } else if (field.type === "richtext") {
        const disabled = field.readonly || !editable ? "disabled" : "";
        const editorId = `rt-${orderId}-${nodeKey}-${field.key}`;
        control = `
          <div class="rich-editor" data-rich-editor data-editor-id="${editorId}" data-disabled="${field.readonly ? "1" : "0"}">
            <div class="rich-toolbar">
              <button type="button" data-cmd="bold" ${disabled}>B</button>
              <button type="button" data-cmd="italic" ${disabled}>I</button>
              <button type="button" data-cmd="underline" ${disabled}>U</button>
              <button type="button" data-cmd="insertUnorderedList" ${disabled}>• List</button>
              <button type="button" data-cmd="insertOrderedList" ${disabled}>1. List</button>
              <button type="button" data-cmd="formatBlock" data-cmd-value="h3" ${disabled}>H3</button>
              <label class="img-upload ${field.readonly ? "disabled" : ""}">
                图片
                <input type="file" accept="image/*" data-image-input ${disabled} />
              </label>
            </div>
            <div
              class="rich-content"
              id="${editorId}"
              contenteditable="${field.readonly || !editable ? "false" : "true"}"
              data-placeholder="请输入问题描述..."
            >${value || ""}</div>
            <input type="hidden" name="${field.key}" value="${escapeAttr(value)}" data-rich-hidden />
          </div>
        `;
      } else if (!editable) {
        control = wideText
          ? `<textarea name="${field.key}" rows="8" readonly disabled>${escapeHtml(String(value || ""))}</textarea>`
          : `<input type="text" name="${field.key}" value="${escapeAttr(value)}" readonly disabled />`;
      }

      return `
        <div class="${fieldCls} ${editable ? "" : "problem-field-inline"}" data-field-key="${escapeAttr(field.key)}">
          <label>${escapeHtml(field.label)}${requiredMark}</label>
          ${editable ? control : renderReadOnlyFieldValue(field, value)}
        </div>
      `;
    })
    .filter(Boolean)
    .join("");

  const message = formState.error
    ? `<p class="problem-fill-status error">${escapeHtml(formState.error)}</p>`
    : formState.success
      ? `<p class="problem-fill-status success">${escapeHtml(formState.success)}</p>`
      : "";

  return `
    <section class="problem-fill-wrap">
      ${message}
      <form id="node-form-${orderId}-${nodeKey}" ${editable ? `data-node-form="1" data-node-key="${escapeAttr(nodeKey)}" data-order-id="${escapeAttr(orderId)}" data-workflow-template="${escapeAttr(wfForm)}" data-is-current-node="${isCurrentNode ? "1" : "0"}"` : ""}>
        <div class="problem-fill-grid">
          ${fieldRows || `<p class="problem-fill-status">当前无字段配置</p>`}
        </div>
        ${
          editable
            ? `<div class="problem-fill-actions">
          ${
            hideSaveButton
              ? ""
              : `<button class="action primary" type="submit" ${formState.saving ? "disabled" : ""}>
            ${formState.saving && formState.savingMode === "save" ? "保存中..." : "保存"}
          </button>`
          }
          ${
            showFlowFields
              ? `<button class="${hideSaveButton ? "action primary" : "action"}" type="submit" data-action-submit ${formState.saving ? "disabled" : ""}>${formState.saving && formState.savingMode === "submit" ? "提交中..." : "提交"}</button>`
              : ""
          }
        </div>`
            : ""
        }
      </form>
    </section>
  `;
}

export function getInitialFieldValue(field, savedValues) {
  if (savedValues && savedValues[field.key] != null) {
    return String(savedValues[field.key]);
  }
  if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
    if (TEMP_AUTO_FILL_ALL_FIELDS) {
      const flat = Array.isArray(field.options) ? field.options : [];
      if (flat.length > 0) return String(flat[0]);
      const tr = field.cascade_options;
      if (Array.isArray(tr) && tr.length) {
        const first = String(tr[0].label || "").trim();
        if (first) return first;
      }
    }
    return "";
  }
  if (TEMP_AUTO_FILL_ALL_FIELDS) {
    if (field.type === "date") {
      return new Date().toISOString().slice(0, 10);
    }
    if (field.type === "datetime") {
      return new Date().toISOString().slice(0, 16);
    }
    if (field.type === "whitelist") {
      const options = Array.isArray(field.options) && field.options.length > 0 ? field.options : ["temp"];
      return String(options[0] || "temp");
    }
    if (field.default_type === "login_user") {
      const operator = getCurrentOperator();
      return `${operator.account} ${operator.userName}`;
    }
    if (typeof field.default_value === "string" && field.default_value.trim() !== "") {
      return field.default_value;
    }
    return "temp";
  }
  if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
    const flat = Array.isArray(field.options) ? field.options : [];
    if (WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key) && flat.length > 0) return String(flat[0]);
    return "";
  }
  if (field.type === "whitelist") {
    const options = Array.isArray(field.options) && field.options.length > 0 ? field.options : ["temp"];
    if (WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key) && options.length > 0) {
      return String(options[0]);
    }
    return "";
  }
  if (field.default_type === "today") {
    return new Date().toISOString().slice(0, 10);
  }
  if (field.default_type === "login_user") {
    const operator = getCurrentOperator();
    return `${operator.userName} ${operator.account}`;
  }
  if (typeof field.default_value === "string") {
    return field.default_value;
  }
  return "";
}

const _RICHTEXT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const _TICKET_FILE_MAX_BYTES = 20 * 1024 * 1024;

function renderTicketFileUploadControl(field, value, editable) {
  const meta = parseTicketFileFieldValue(value);
  const serialized = meta ? serializeTicketFileFieldValue(meta) : String(value || "").trim();
  const viewOnly = field.readonly || !editable;
  const displayName = ticketFileFieldDisplayName(meta, "");
  const linkClass = meta ? "" : " hidden";
  return `
    <div class="ticket-file-upload" data-ticket-file-upload data-field-key="${escapeAttr(field.key)}">
      <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(serialized)}" data-file-value />
      <span class="ticket-file-upload-name" data-file-label>${escapeHtml(displayName || "未上传")}</span>
      <label class="ticket-file-upload-btn${viewOnly ? " disabled" : ""}">
        选择文件
        <input type="file" data-file-input ${viewOnly ? "disabled" : ""} />
      </label>
      <a class="ticket-file-upload-link${linkClass}" data-file-link href="${escapeAttr(meta?.url || "")}" target="_blank" rel="noopener noreferrer">查看</a>
    </div>
  `;
}

async function uploadTicketFileToMinio(file) {
  const operator = getCurrentOperator();
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(
    `${API_BASE_URL}/api/richtext/upload-file?operator_id=${encodeURIComponent(operator.account)}`,
    { method: "POST", body: fd }
  );
  if (!resp.ok) {
    const errText = await parseApiError(resp);
    throw new Error(errText || `文件上传失败（${resp.status}）`);
  }
  const data = await resp.json();
  const url = data && data.url ? String(data.url) : "";
  if (!url) throw new Error("文件上传未返回地址");
  return {
    url,
    file_name: data.file_name ? String(data.file_name) : String(file.name || "file"),
    object_name: data.object_name ? String(data.object_name) : "",
  };
}

export function bindTicketFileUploadFields(form) {
  if (!form) return;
  form.querySelectorAll("[data-ticket-file-upload]").forEach((wrap) => {
    if (wrap.dataset.bound === "1") return;
    wrap.dataset.bound = "1";
    const input = wrap.querySelector("[data-file-input]");
    const hidden = wrap.querySelector("[data-file-value]");
    const labelEl = wrap.querySelector("[data-file-label]");
    const link = wrap.querySelector("[data-file-link]");
    if (!input || !hidden) return;
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > _TICKET_FILE_MAX_BYTES) {
        window.alert("文件大小不能超过 20MB");
        return;
      }
      try {
        const result = await uploadTicketFileToMinio(file);
        hidden.value = serializeTicketFileFieldValue(result);
        if (labelEl) labelEl.textContent = result.file_name || "已上传";
        if (link) {
          link.href = result.url;
          link.classList.remove("hidden");
        }
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        window.alert(e && e.message ? e.message : "文件上传失败");
      } finally {
        input.value = "";
      }
    });
  });
}

export function bindRichEditor(editorWrap) {
  if (!editorWrap || editorWrap.dataset.bound === "1") return;
  editorWrap.dataset.bound = "1";

  const isDisabled = editorWrap.dataset.disabled === "1";
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  const imageInput = editorWrap.querySelector("[data-image-input]");
  const toolbar = editorWrap.querySelector(".rich-toolbar");
  if (!content || !hidden || !toolbar) return;

  async function uploadRichTextImageToMinio(file) {
    const operator = getCurrentOperator();
    const fd = new FormData();
    fd.append("file", file);
    const resp = await fetch(
      `${API_BASE_URL}/api/richtext/upload-image?operator_id=${encodeURIComponent(operator.account)}`,
      { method: "POST", body: fd }
    );
    if (!resp.ok) {
      const errText = await parseApiError(resp);
      throw new Error(errText || `图片上传失败（${resp.status}）`);
    }
    const data = await resp.json();
    const url = data && data.url ? String(data.url) : "";
    if (!url) throw new Error("图片上传未返回地址");
    return url;
  }

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cmd]");
    if (!button || isDisabled) return;
    const cmd = button.getAttribute("data-cmd");
    const cmdValue = button.getAttribute("data-cmd-value");
    content.focus();
    document.execCommand(cmd, false, cmdValue || undefined);
    syncRichEditorValue(editorWrap);
  });

  if (imageInput) {
    imageInput.addEventListener("change", async () => {
      if (isDisabled) return;
      const file = imageInput.files && imageInput.files[0];
      if (!file) return;
      try {
        if (file.size > _RICHTEXT_IMAGE_MAX_BYTES) {
          window.alert("图片大小不能超过 5MB");
          return;
        }
        const url = await uploadRichTextImageToMinio(file);
        content.focus();
        document.execCommand("insertImage", false, url);
        syncRichEditorValue(editorWrap);
      } catch (e) {
        window.alert(e && e.message ? e.message : "图片上传失败");
      } finally {
        imageInput.value = "";
      }
    });
  }

  content.addEventListener("paste", (ev) => {
    if (isDisabled) return;
    const cd = ev.clipboardData;
    const file = getImageFileFromClipboardData(cd);
    if (!file) return;
    ev.preventDefault();
    if (file.size > _RICHTEXT_IMAGE_MAX_BYTES) {
      window.alert("图片大小不能超过 5MB");
      return;
    }
    void (async () => {
      try {
        const url = await uploadRichTextImageToMinio(file);
        content.focus();
        document.execCommand("insertImage", false, url);
        syncRichEditorValue(editorWrap);
      } catch (e) {
        window.alert(e && e.message ? e.message : "图片上传失败");
      }
    })();
  });

  content.addEventListener("input", () => {
    syncRichEditorValue(editorWrap);
  });
}

export function syncRichEditorValue(editorWrap) {
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  if (!content || !hidden) return;
  hidden.value = content.innerHTML.trim();
}

export async function fetchLlmConfig() {
  const op = getCurrentOperator();
  state.aiLlmConfigLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/params/llm-config?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) { state.aiLlmConfigItems = []; return; }
    const j = await r.json();
    state.aiLlmConfigItems = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiLlmConfigItems = []; }
  finally { state.aiLlmConfigLoading = false; }
}

export function renderLlmConfigPageHtml(title) {
  const items = state.aiLlmConfigItems;
  const loading = state.aiLlmConfigLoading;
  const saving = state.aiLlmConfigSaving;
  const msg = state.aiLlmConfigMsg ? `<p class="duty-field-banner duty-field-banner--err">${escapeHtml(state.aiLlmConfigMsg)}</p>` : "";
  const testResult = state.aiLlmConfigTestResult;
  const testHtml = testResult
    ? `<p class="llm-config-test-result ${testResult.ok ? "llm-config-test-ok" : "llm-config-test-fail"}">${escapeHtml(testResult.detail)}</p>`
    : "";

  if (loading && !items.length) {
    return `<section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}"><div class="detail-head"><h2>${escapeHtml(title)}</h2></div><p class="params-page-intro">加载中…</p></section>`;
  }

  const fieldLabels = {
    llm_api_base_url: "API 地址",
    llm_api_key: "API Key",
    llm_model: "模型名称",
    llm_max_tokens: "最大 Token",
    llm_temperature: "温度",
    llm_system_prompt: "系统提示词",
    llm_query_timeout: "查询超时(秒)",
    llm_max_react_rounds: "最大推理轮次",
    llm_max_result_rows: "结果行数上限",
    llm_enabled: "全局开关",
    llm_context_max_token: "上下文最大Token",
  };
  const boolKeys = new Set(["llm_enabled"]);
  const textareaKeys = new Set(["llm_system_prompt"]);

  const rows = items.map((it) => {
    const key = String(it.key || "");
    const val = String(it.value || "");
    const label = fieldLabels[key] || key;
    const desc = String(it.description || "");
    const isBool = boolKeys.has(key);
    const isTextarea = textareaKeys.has(key);
    const isPassword = key === "llm_api_key";

    let inputHtml;
    if (isBool) {
      const checked = val === "true";
      inputHtml = `<label class="llm-config-switch"><input type="checkbox" data-llm-key="${escapeAttr(key)}" ${checked ? "checked" : ""} /><span class="llm-config-switch-label">${checked ? "已启用" : "已停用"}</span></label>`;
    } else if (isTextarea) {
      inputHtml = `<textarea class="llm-config-textarea" data-llm-key="${escapeAttr(key)}" rows="4" placeholder="${escapeAttr(desc)}">${escapeHtml(val)}</textarea>`;
    } else if (isPassword) {
      inputHtml = `<input type="password" class="llm-config-input" data-llm-key="${escapeAttr(key)}" value="${escapeAttr(val)}" placeholder="${escapeAttr(desc)}" autocomplete="off" />`;
    } else {
      inputHtml = `<input type="text" class="llm-config-input" data-llm-key="${escapeAttr(key)}" value="${escapeAttr(val)}" placeholder="${escapeAttr(desc)}" />`;
    }

    return `<tr>
      <td class="llm-config-label">${escapeHtml(label)}</td>
      <td>${inputHtml}</td>
      <td class="llm-config-desc">${escapeHtml(desc)}</td>
    </tr>`;
  }).join("");

  return `
    <section class="detail-card detail-card-inline params-config-page llm-config-page" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">
          <button type="button" class="action primary" id="llm-config-save" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
          <button type="button" class="action" id="llm-config-test" ${state.aiLlmConfigTesting ? "disabled" : ""}>${state.aiLlmConfigTesting ? "测试中…" : "测试连通性"}</button>
        </div>
      </div>
      ${msg}
      ${testHtml}
      <table class="llm-config-table">
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

export async function bindLlmConfigPage() {
  const op = getCurrentOperator();

  if (state.aiLlmConfigLoading && !state.aiLlmConfigItems.length) {
    await fetchLlmConfig();
    requestRender();
    return;
  }

  if (!state.aiLlmConfigItems.length) {
    await fetchLlmConfig();
    requestRender();
  }

  const saveBtn = document.getElementById("llm-config-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const items = [];
      document.querySelectorAll("[data-llm-key]").forEach((el) => {
        const key = el.getAttribute("data-llm-key");
        let val;
        if (el.type === "checkbox") {
          val = el.checked ? "true" : "false";
        } else {
          val = el.value.trim();
        }
        const existing = state.aiLlmConfigItems.find((it) => it.key === key);
        items.push({
          key,
          value: val,
          value_type: existing?.value_type || "string",
          description: existing?.description || "",
        });
      });
      state.aiLlmConfigSaving = true;
      state.aiLlmConfigMsg = "";
      try {
        const r = await fetch(`${API_BASE_URL}/api/params/llm-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, items }),
        });
        if (!r.ok) { const j = await r.json(); state.aiLlmConfigMsg = j.detail || "保存失败"; }
        else {
          const j = await r.json();
          state.aiLlmConfigItems = Array.isArray(j.items) ? j.items : [];
          state.aiLlmConfigMsg = "";
        }
      } catch (e) { state.aiLlmConfigMsg = String(e.message || e); }
      state.aiLlmConfigSaving = false;
      requestRender();
    });
  }

  const testBtn = document.getElementById("llm-config-test");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      state.aiLlmConfigTesting = true;
      state.aiLlmConfigTestResult = null;
      requestRender();
      try {
        const r = await fetch(`${API_BASE_URL}/api/params/llm-config/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (r.ok) {
          state.aiLlmConfigTestResult = await r.json();
        } else {
          state.aiLlmConfigTestResult = { ok: false, detail: "测试请求失败" };
        }
      } catch (e) {
        state.aiLlmConfigTestResult = { ok: false, detail: String(e.message || e) };
      }
      state.aiLlmConfigTesting = false;
      requestRender();
    });
  }

  document.querySelectorAll("[data-llm-key][type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      const label = cb.parentElement.querySelector(".llm-config-switch-label");
      if (label) label.textContent = cb.checked ? "已启用" : "已停用";
    });
  });
}
