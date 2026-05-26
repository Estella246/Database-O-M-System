import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state, ticketList, workflowByOrderId, operationLogsByOrderId, TEMP_AUTO_FILL_ALL_FIELDS } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings, isActiveKeyVisible } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel, normalizePermissionLevel, getPermissionLevelRank, normalizePermissionLevelForItem, getPermissionStrategyOptions, getWhitelistKeyByActiveKey, applyPermissionWhitelistCascade, normalizeDutyCascadeValue, splitDutyFieldCascadePath } from "../utils/normalize.js";
import { operatorMatchesPersonField, formatYmdLocal, localYmd, nowText, makeNewTicketId, priorityBadgeClass, categoryBadgeClass, valueBadgeClass, sortTicketsByCreatedAtDesc, listPreviewText } from "../utils/format.js";
import { API_BASE_URL, parseApiError, stripDutyFieldIdsForApi, dutyFieldTreeHasEmptyLabel } from "../services/api.js";
import { parseTicketNodeDataResponse } from "../utils/node-data-response.js";
import { getImageFileFromClipboardData } from "../utils/richtext-paste-image.js";
import { requestRender } from "../core/scheduler.js";
import {
  WORKFLOW_NODES,
  NODE_KEY_BY_STEP,
  STEP_BY_NODE_KEY,
  HANDLE_MODE_ROUTE,
  filterOpsAnalysisHandleModeOptions,
  WHITELIST_NO_PLACEHOLDER_KEYS,
  WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS,
  WF_FLAT_SEARCHABLE_FIELD_KEYS,
  injectPersonOptionsIntoSchemaFields,
  isWorkflowFlatSelectSearchable,
  isWorkflowFlatSelectCreatable,
  shouldUseWorkflowFlatSelect,
  isMultiPersonWhitelistField,
  parseMultiPersonValue,
  joinMultiPersonValue,
  personOptionMatchesKeyword,
  PERSON_WHITELIST_FIELD_KEYS,
  TICKET_LIST_FILTER_KEYS,
  isWideTextField,
  getProblemFillFieldSortTier,
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
  renderPassedInlineValue,
  renderWorkflowFlatSelect,
  rebuildWfFlatSelectChoiceButtons,
  renderWorkflowFlatMultiSelect,
  renderCascadeWhitelistControl,
  resolveNextNodeKey,
} from "./ticket.js";
import { getDutyAssignmentsForDay, dutyModalUserLabel, dutyFieldParsePath, dutyFieldGetParentArray, dutyFieldNodeAtPath, dutyCascaderColumnsData, dutyCascaderColumnHtml, dutyRosterAnchorValid } from "./duty.js";
import { ensureAdminData, ensureAdminTab } from "./admin-page.js";
import { getPermissionWhitelistDetailText, uniqueColumnValues, getPermissionWhitelistPageAndDetail, getPermissionLevelForItem, getStrategyOptionsHtml, renderUserFilterHeader, renderUserTableHead } from "./admin.js";
import {
  ensureListTab,
  ensurePatchListTab,
  ensureUploadAnalysisTab,
  ensureLeaveTab,
  ensureRequirementTab,
  ensureSettingsTab,
} from "./settings-page.js";
import { ensureParamsTab } from "./params-page.js";
import { ensureStatsChartsTab, ensureStatsReportTab, ensureStatsSkillsTab } from "./stats-page.js";
import { ensureAiTab } from "./ai-page.js";
import {
  ensureHomeTab,
  getTicketById,
  beginCreateTicketModal,
  beginPatchCreateTicketModal,
  ensureDutyTab,
  remapTicketOrderId,
  getUrlByKey,
  ensureTicketTab,
  syncTicketsFromServer,
  planTicketListResync,
} from "./ticket-core.js";
import { fetchGroupTemplatesFromServer, saveGroupTemplateDraftToServer, renderGroupTemplateFieldsHtml, renderGroupTemplatePageHtml, renderGroupPullModalHtml, bindGroupTemplateParamsPage, bindGroupPullModal, renderVersionParamsPageHtml, renderParamsPage, saveVersionBaselineDraft, saveVersionHotfixDraft, bindVersionParamsPage, versionFindBaselineDraftRow, versionFindHotfixDraftRow, refreshVersionParamsData } from "./params-page.js";
import { fieldVisible, fieldEffectiveRequired } from "./requirement.js";

let dutyCascaderOpenWrap = null;
let wfFlatSelectOpenWrap = null;
let dutyCascaderGeomListenersBound = false;
let dutyCascaderDocumentBound = false;

export function getFormState(orderId, nodeKey) {
  const key = `${orderId}:${nodeKey}`;
  if (!state.formsByTicket[key]) {
    state.formsByTicket[key] = {
      loading: false,
      loaded: false,
      notFound: false,
      failed: false,
      saving: false,
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
    const mark = wrap.querySelector(".required-mark");
    if (mark) mark.style.display = effectiveReq ? "" : "none";
  });
}

export function buildSubmitValues(form, formState) {
  form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    syncRichEditorValue(editor);
  });
  const vals = collectValuesForRules(form, formState.fields);
  const out = {};
  formState.fields.forEach((field) => {
    if (!fieldVisible(field, vals)) return;
    out[field.key] = vals[field.key] ?? "";
  });
  return out;
}

export async function ensureNodeFormData(orderId, nodeKey, workflowTemplate = "HCS_INCIDENT", allowMissingTicketData = false) {
  const formState = getFormState(orderId, nodeKey);
  if (formState.loading || formState.loaded || formState.failed) return;

  formState.loading = true;
  formState.error = "";
  // Do not requestRender() here: renderWorkflow may kick off many nodes in one pass; nested requestRender() per node caused deep re-entrancy.

  try {
    const operator = getCurrentOperator();
    const tc = workflowTemplate === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
    const schemaQs = tc !== "HCS_INCIDENT" ? `?template_code=${encodeURIComponent(tc)}` : "";
    const [schemaResp, dataResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/nodes/${encodeURIComponent(nodeKey)}/schema${schemaQs}`),
      fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/data?operator_id=${encodeURIComponent(operator.account)}`),
    ]);
    if (schemaResp.status === 404) {
      formState.notFound = true;
      formState.loaded = true;
      return;
    }
    if (!schemaResp.ok) throw new Error(`schema load failed: ${schemaResp.status}`);
    const schemaJson = await schemaResp.json();
    const dataJson = await parseTicketNodeDataResponse(dataResp, {
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
    const netFail = /load failed|failed to fetch|networkerror|aborted|not allowed|refused/i.test(raw);
    formState.error = netFail
      ? `无法连接后端 ${API_BASE_URL}（请在本机终端运行 uvicorn，且与页面同主机访问，例如页面用 http://127.0.0.1:5173 打开）。也可用地址栏加参数 ?api=http://127.0.0.1:8000 指定 API。详情：${raw}`
      : raw || "load failed";
    formState.failed = true;
  } finally {
    formState.loading = false;
    requestRender();
  }
}

export async function syncOperationLogsFromServer(orderId) {
  const syncState = state.logSyncStateByOrderId[orderId] || { loading: false, loaded: false };
  if (syncState.loading || syncState.loaded) return;
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
    syncState.loaded = true;
    if (prev !== next) requestRender();
  } catch (_) {
    // ignore log sync failure
  } finally {
    syncState.loading = false;
    state.logSyncStateByOrderId[orderId] = syncState;
  }
}

export function bindNodeForms(orderId) {
  const forms = document.querySelectorAll("form[data-node-form]");
  forms.forEach((form) => {
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    const nodeKey = form.getAttribute("data-node-key");
    if (!nodeKey) return;
    const wfTpl = form.getAttribute("data-workflow-template") === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
    const formState = getFormState(orderId, nodeKey);

    form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      bindRichEditor(editor);
    });

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

    const saveNode = async (options = {}) => {
      const isFlowSubmit = !!options.flowSubmit;
      if (formState.saving) return { ok: false };
      const values = buildSubmitValues(form, formState);
      // Keep in-progress form input on any subsequent re-render.
      formState.values = { ...(formState.values || {}), ...values };
      formState.saving = true;
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
        };
        if (wfTpl === "HOTPATCH") {
          submitBody.template_code = "HOTPATCH";
        }
        const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/submit`, {
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
        const resolvedId = String(json?.ticket_id || "").trim() || orderId;
        if (resolvedId !== orderId) remapTicketOrderId(orderId, resolvedId);
        return { ok: true, values: formState.values, orderId: resolvedId };
      } catch (err) {
        formState.error = err instanceof Error ? err.message : "提交失败";
        if (formState.error) window.alert(formState.error);
        return { ok: false };
      } finally {
        formState.saving = false;
        requestRender();
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = event.submitter instanceof Element ? event.submitter : null;
      const flowSubmitPending = form.dataset.flowSubmitPending === "1";
      const isFlowSubmit = !!submitter?.hasAttribute("data-action-submit") || flowSubmitPending;
      if (flowSubmitPending) delete form.dataset.flowSubmitPending;
      const saved = await saveNode({ flowSubmit: isFlowSubmit });
      if (!saved.ok) return;
      const workId = saved.orderId || orderId;
      if (!isFlowSubmit) return;
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
        requestRender();
        return;
      }
      if (wfTpl !== "HOTPATCH") {
        advanceWorkflow(workId, nodeKey, nextNodeKey, handleMode, wfTpl);
      }
      const ticketKey = ensureTicketTab(workId);
      state.activeKey = ticketKey;
      history.replaceState({}, "", getUrlByKey(ticketKey));
      // Avoid location.assign: static servers (e.g. python -m http.server) have no /tickets/* file → 404 HTML.
      void syncTicketsFromServer()
        .catch(() => {})
        .finally(() => requestRender());
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

    const closeTarget = target.closest("[data-close-tab]");
    if (closeTarget) {
      event.preventDefault();
      event.stopPropagation();
      const key = closeTarget.getAttribute("data-close-tab");
      if (!key) return;
      state.openTabs = state.openTabs.filter((tab) => tab.key !== key);
      if (state.activeKey === key) {
        state.activeKey = state.openTabs[state.openTabs.length - 1].key;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      requestRender();
      return;
    }

    const tabTarget = target.closest("[data-workspace-tab]");
    if (tabTarget) {
      event.preventDefault();
      event.stopPropagation();
      const key = tabTarget.getAttribute("data-workspace-tab");
      if (!key) return;
      const prevWsKey = state.activeKey;
      state.activeKey = key;
      if (key === "leave:application") state.leaveNeedsRefresh = true;
      if (key === "req:manage" && prevWsKey !== "req:manage") state.reqNeedsRefresh = true;
      if (key === "params:duty-field" && prevWsKey !== "params:duty-field") {
        state.dutyFieldNeedsRefresh = true;
        state.dutyFieldEditMode = false;
      }
      if (key === "params:version" && prevWsKey !== "params:version") state.versionNeedsRefresh = true;
      if (key === "params:group-template" && prevWsKey !== "params:group-template") {
        state.groupTemplateNeedsRefresh = true;
        state.groupTemplateEditMode = false;
        state.groupTemplateDraft = null;
      }
      if (key === "params:issue-root-cause" && prevWsKey !== "params:issue-root-cause") {
        state.issueRootCauseNeedsRefresh = true;
        state.issueRootCauseEditMode = false;
        state.issueRootCauseDraft = null;
      }
      if (key === "params:llm-config" && prevWsKey !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant" && prevWsKey !== "ai:assistant") {
        state.aiNeedsRefresh = true;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      const tabResync = planTicketListResync(prevWsKey, key);
      if (tabResync.sync) {
        const search = tabResync.ignoreSearch ? "" : state.ticketListSearch;
        void syncTicketsFromServer(search).then(() => requestRender());
      }
      requestRender();
      return;
    }

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

    const navTarget = target.closest("[data-nav-key]");
    if (navTarget) {
      event.preventDefault();
      event.stopPropagation();
      const key = navTarget.getAttribute("data-nav-key");
      if (!key) return;
      const whitelist = getCurrentWhitelistSettings();
      if (!isActiveKeyVisible(key, whitelist)) return;
      const prevNavKey2 = state.activeKey;
      if (key.startsWith("admin:")) ensureAdminTab(key.split(":")[1]);
      if (key === "home") ensureHomeTab();
      if (key === "list") ensureListTab();
      if (key === "patch:list") ensurePatchListTab();
      if (key === "duty:roster") ensureDutyTab();
      if (key.startsWith("params:")) ensureParamsTab(key.slice("params:".length));
      if (key === "leave:application") {
        ensureLeaveTab();
        state.leaveNeedsRefresh = true;
      }
      if (key === "req:manage") {
        ensureRequirementTab();
        if (prevNavKey2 !== "req:manage") state.reqNeedsRefresh = true;
      }
      if (key === "settings:appearance") {
        ensureSettingsTab();
      }
      if (key === "stats:charts") {
        ensureStatsChartsTab();
      }
      if (key === "stats:report") {
        ensureStatsReportTab();
      }
      if (key === "stats:skills") {
        ensureStatsSkillsTab();
      }
      if (key === "upload:analysis") {
        ensureUploadAnalysisTab();
      }
      state.activeKey = key;
      if (key === "params:duty-field" && prevNavKey2 !== "params:duty-field") {
        state.dutyFieldNeedsRefresh = true;
        state.dutyFieldEditMode = false;
      }
      if (key === "params:version" && prevNavKey2 !== "params:version") state.versionNeedsRefresh = true;
      if (key === "params:group-template" && prevNavKey2 !== "params:group-template") {
        state.groupTemplateNeedsRefresh = true;
        state.groupTemplateEditMode = false;
        state.groupTemplateDraft = null;
      }
      if (key === "params:issue-root-cause" && prevNavKey2 !== "params:issue-root-cause") {
        state.issueRootCauseNeedsRefresh = true;
        state.issueRootCauseEditMode = false;
        state.issueRootCauseDraft = null;
      }
      if (key === "params:llm-config" && prevNavKey2 !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant") {
        ensureAiTab();
        if (prevNavKey2 !== "ai:assistant") state.aiNeedsRefresh = true;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      const navResync = planTicketListResync(prevNavKey2, key);
      if (navResync.sync) {
        const search = navResync.ignoreSearch ? "" : state.ticketListSearch;
        void syncTicketsFromServer(search).then(() => requestRender());
      }
      requestRender();
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
      void (async () => {
        const operator = getCurrentOperator();
        const tpl = state.activeKey === "patch:list" ? "HOTPATCH" : "HCS_INCIDENT";
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
          await syncTicketsFromServer();
        } catch (e) {
          window.alert(`删除失败：${e && e.message ? e.message : String(e)}`);
          return;
        }
        requestRender();
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

export function renderWorkflow(orderId) {
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  const ticket = getTicketById(orderId);
  const wfTpl = String(ticket?.templateCode || "") === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const wfNodes = wfTpl === "HOTPATCH" ? HOTPATCH_WORKFLOW_NODES : WORKFLOW_NODES;
  const nkByStep = wfTpl === "HOTPATCH" ? HOTPATCH_NODE_KEY_BY_STEP : NODE_KEY_BY_STEP;
  const stepByKey = wfTpl === "HOTPATCH" ? HOTPATCH_STEP_BY_NODE_KEY : STEP_BY_NODE_KEY;
  const inferStepFromTicket = () => {
    const node = String(ticket?.node || "").trim();
    if (!node) return -1;
    if (wfNodes.includes(node)) return wfNodes.indexOf(node);
    const byKey = stepByKey[node.toLowerCase()] || stepByKey[node];
    if (byKey && wfNodes.includes(byKey)) return wfNodes.indexOf(byKey);
    return -1;
  };
  const inferredIndex = inferStepFromTicket();
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
  const ticketStatus = String(ticket?.status || state.ticketStatusByOrderId[orderId] || "open").toLowerCase();
  const isClosed = ticketStatus === "closed";
  let currentStepLabel = wfNodes[effectiveCurrentStep] || "";
  if (parallelMulti && frontierNodeKeys.length) {
    currentStepLabel = frontierNodeKeys
      .map((k) => HOTPATCH_STEP_BY_NODE_KEY[k] || k)
      .filter(Boolean)
      .join("，");
  }
  const visitedSteps = new Set(workflow.logs.map((log) => String(log.step || "")).filter(Boolean));
  const opLogs = operationLogsByOrderId[orderId] || [];
  const latestMetaByStep = new Map();
  opLogs.forEach((log) => {
    const from = String(log.from || "");
    const to = String(log.to || "");
    if (from) visitedSteps.add(from);
    if (to) visitedSteps.add(to);
    if (from) latestMetaByStep.set(from, { actor: String(log.actor || "-"), at: String(log.at || "") });
    if (to) latestMetaByStep.set(to, { actor: String(log.actor || "-"), at: String(log.at || "") });
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
    let formBody = "";
    if (nodeKey) {
      const editable = isCurrent
        ? (currentStageLevel === "editable" || nodeHandlerOk)
        : passedNodeLevel === "editable";
      ensureNodeFormData(orderId, nodeKey, wfTpl);
      formBody = renderNodeForm(orderId, nodeKey, {
        editable,
        passedView: !isCurrent && passedNodeLevel !== "editable",
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
    const metaText = log
      ? `${log.actor} · ${log.at}`
      : latestMeta
        ? `${latestMeta.actor} · ${latestMeta.at}`
        : "暂无记录";
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
  requestRender();
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
  if (!colsEl) return;
  let path = [];
  try {
    path = JSON.parse(wrap.dataset.cascadeNavPath || "[]");
  } catch (_e) {
    path = [];
  }
  if (!Array.isArray(tree) || !tree.length) {
    colsEl.innerHTML = `<div class="cascade-cascader-empty">${escapeHtml("暂无选项，请先在责任田模块维护")}</div>`;
    if (preview) preview.textContent = "";
    if (panel && !panel.hidden && panel.classList.contains("is-open")) {
      requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
    }
    return;
  }
  const columns = dutyCascaderColumnsData(tree, path);
  colsEl.innerHTML = columns.map((col) => dutyCascaderColumnHtml(col.depth, col.list, col.activeLabel)).join("");
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
  dutyCascaderClearOpenWrap(wrap);
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
  labelEl.textContent = v || (ph ? "请选择" : "");
  labelEl.classList.add("cascade-cascader-label");
  labelEl.classList.toggle("is-placeholder", !v && ph);
}

export function wfFlatSelectApplySearch(wrap, keyword) {
  const kw = String(keyword || "").trim();
  const personSelect = wrap.dataset.wfPersonSelect === "1";
  let shown = 0;
  const optionTexts = [];
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    if (btn.hasAttribute("data-wf-flat-create")) return;
    const isPlaceholder = btn.classList.contains("wf-flat-select-item--placeholder");
    const txt = String(btn.getAttribute("data-wf-search-text") || btn.textContent || "").trim();
    if (!isPlaceholder) optionTexts.push(txt);
    const keep = !kw
      ? !isPlaceholder
      : !isPlaceholder && (personSelect ? personOptionMatchesKeyword(txt, kw) : txt.toLowerCase().includes(kw.toLowerCase()));
    btn.hidden = !keep;
    if (keep) shown += 1;
  });
  let showCreate = false;
  if (wrap.dataset.wfFlatCreatable === "1") {
    const createBtn = wrap.querySelector("[data-wf-flat-create]");
    if (createBtn) {
      showCreate = !!kw && !optionTexts.some((t) => t.toLowerCase() === kw.toLowerCase());
      createBtn.hidden = !showCreate;
      createBtn.setAttribute("data-wf-flat-value-pick", showCreate ? kw : "");
      if (showCreate) createBtn.textContent = `新增局点「${kw}」`;
    }
  }
  const emptyEl = wrap.querySelector("[data-wf-flat-empty]");
  if (emptyEl) emptyEl.hidden = shown > 0 || showCreate;
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
  dutyCascaderSetOpenWrap(wrap);
  dutyCascaderRenderPanel(wrap);
  panel.hidden = false;
  panel.classList.add("is-open");
  trig.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    dutyCascaderPositionPanel(wrap);
    requestAnimationFrame(() => dutyCascaderPositionPanel(wrap));
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
  form.addEventListener("click", (ev) => {
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
  const passedView = options.passedView === true;
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
      if (!editable && (field.key === "handle_mode" || field.key === "next_handler")) {
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
        const usePlaceholder = !WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key);
        if (shouldUseWorkflowFlatSelect(nodeKey, field)) {
          const flatCtx = {
            options,
            usePlaceholder,
            enableSearch: isWorkflowFlatSelectSearchable(field),
            creatable: isWorkflowFlatSelectCreatable(field),
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

      if (!editable && passedView) {
        const inlineText = renderPassedInlineValue(field, value);
        return `
        <div class="${fieldCls} problem-field-passed-inline" data-field-key="${escapeAttr(field.key)}">
          <span class="problem-field-passed-label">${escapeHtml(field.label)}${requiredMark}</span>
          <span class="problem-field-passed-sep">：</span>
          <span class="problem-field-passed-text" title="${escapeAttr(inlineText)}">${escapeHtml(inlineText || "-")}</span>
        </div>
      `;
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
      <form id="node-form-${orderId}-${nodeKey}" ${editable ? `data-node-form="1" data-node-key="${escapeAttr(nodeKey)}" data-order-id="${escapeAttr(orderId)}" data-workflow-template="${escapeAttr(wfForm)}"` : ""}>
        <div class="problem-fill-grid">
          ${fieldRows || `<p class="problem-fill-status">当前无字段配置</p>`}
        </div>
        ${
          editable
            ? `<div class="problem-fill-actions">
          <button class="action primary" type="submit" ${formState.saving ? "disabled" : ""}>
            ${formState.saving ? "保存中..." : "保存"}
          </button>
          <button class="action" type="submit" data-action-submit ${formState.saving ? "disabled" : ""}>提交</button>
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
