import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state, ticketList, workflowByOrderId, operationLogsByOrderId, TEMP_AUTO_FILL_ALL_FIELDS } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings, isActiveKeyVisible } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel, normalizePermissionLevel, getPermissionLevelRank, normalizePermissionLevelForItem, getPermissionStrategyOptions, getWhitelistKeyByActiveKey, applyPermissionWhitelistCascade, normalizeDutyCascadeValue, splitDutyFieldCascadePath } from "../utils/normalize.js";
import { operatorMatchesPersonField, formatYmdLocal, localYmd, nowText, makeNewTicketId, priorityBadgeClass, categoryBadgeClass, valueBadgeClass, sortTicketsByCreatedAtDesc, listPreviewText } from "../utils/format.js";
import { API_BASE_URL, stripDutyFieldIdsForApi, dutyFieldTreeHasEmptyLabel } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { WORKFLOW_NODES, NODE_KEY_BY_STEP, STEP_BY_NODE_KEY, HANDLE_MODE_ROUTE, WHITELIST_NO_PLACEHOLDER_KEYS, WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS, WF_FLAT_SEARCHABLE_FIELD_KEYS, TICKET_LIST_FILTER_KEYS } from "../constants/workflow.js";
import { DUTY_FIELD_CASCADE_SEP } from "../constants/duty.js";
import { GROUP_TEMPLATE_KINDS, GROUP_TEMPLATE_NAME_DEFAULTS } from "../constants/theme.js";
import {
  normalizeNodeKey,
  formatValidationErrors,
  renderReadOnlyFieldValue,
  renderPassedInlineValue,
  fileToDataUrl,
  renderWorkflowFlatSelect,
  renderCascadeWhitelistControl,
  resolveNextNodeKey,
} from "./ticket.js";
import { getDutyAssignmentsForDay, dutyModalUserLabel, dutyFieldParsePath, dutyFieldGetParentArray, dutyFieldNodeAtPath, dutyCascaderColumnsData, dutyCascaderColumnHtml, dutyRosterAnchorValid } from "./duty.js";
import { ensureAdminData, ensureAdminTab } from "./admin-page.js";
import { getPermissionWhitelistDetailText, uniqueColumnValues, getPermissionWhitelistPageAndDetail, getPermissionLevelForItem, getStrategyOptionsHtml, renderUserFilterHeader, renderUserTableHead } from "./admin.js";
import { ensureListTab, ensureUploadAnalysisTab, ensureLeaveTab, ensureRequirementTab, ensureSettingsTab } from "./settings-page.js";
import { ensureParamsTab } from "./params-page.js";
import { ensureStatsChartsTab, ensureStatsReportTab, ensureStatsSkillsTab } from "./stats-page.js";
import { ensureAiTab } from "./ai-page.js";
import { ensureHomeTab, getTicketById, beginCreateTicketModal, ensureDutyTab, remapTicketOrderId, getUrlByKey, ensureTicketTab, syncTicketsFromServer } from "./ticket-core.js";
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

export function applyNodeFieldRules(form, formState) {
  const vals = collectValuesForRules(form, formState.fields);
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
    if (field.key === "next_handler") {
      const select = wrap.querySelector("select[name=\"next_handler\"]");
      const flatWrap = wrap.querySelector("[data-wf-flat-select]");
      const map = field.constraints?.next_handler_by_handle_mode;
      const mode = vals.handle_mode || "";
      if (flatWrap && map && typeof map === "object") {
        const allowed = Array.isArray(map[mode]) ? map[mode] : [];
        if (allowed.length > 0) {
          const hidden = flatWrap.querySelector("[data-wf-flat-value]");
          const listEl = flatWrap.querySelector("[data-wf-flat-list]");
          const prev = (hidden?.value || "").trim();
          const opts = allowed
            .map((v) => {
              const sel = v === prev ? " is-active" : "";
              return `<button type="button" class="wf-flat-select-item${sel}" data-wf-flat-value-pick="${escapeAttr(v)}" tabindex="-1">${escapeHtml(v)}</button>`;
            })
            .join("");
          if (listEl) listEl.innerHTML = opts;
          flatWrap.dataset.wfFlatPlaceholder = "0";
          if (!allowed.includes(prev) && hidden) {
            hidden.value = allowed[0];
          }
          wfFlatSelectSyncLabel(flatWrap);
          hidden?.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (select && map && typeof map === "object") {
        const allowed = Array.isArray(map[mode]) ? map[mode] : [];
        if (allowed.length > 0) {
          const prev = select.value || "";
          const placeholder = "";
          const opts = allowed
            .map((v) => `<option value="${escapeAttr(v)}" ${v === prev ? "selected" : ""}>${escapeHtml(v)}</option>`)
            .join("");
          select.innerHTML = `${placeholder}${opts}`;
          if (!allowed.includes(prev)) {
            select.value = allowed[0];
          }
        }
      }
    }
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

export async function ensureNodeFormData(orderId, nodeKey) {
  const formState = getFormState(orderId, nodeKey);
  if (formState.loading || formState.loaded || formState.failed) return;

  formState.loading = true;
  formState.error = "";
  // Do not requestRender() here: renderWorkflow may kick off many nodes in one pass; nested requestRender() per node caused deep re-entrancy.

  try {
    const operator = getCurrentOperator();
    const [schemaResp, dataResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/nodes/${encodeURIComponent(nodeKey)}/schema`),
      fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/data?operator_id=${encodeURIComponent(operator.account)}`),
    ]);
    if (schemaResp.status === 404) {
      formState.notFound = true;
      formState.loaded = true;
      return;
    }
    if (!schemaResp.ok) throw new Error(`schema load failed: ${schemaResp.status}`);
    if (!dataResp.ok) throw new Error(`data load failed: ${dataResp.status}`);
    const schemaJson = await schemaResp.json();
    const dataJson = await dataResp.json();
    formState.fields = Array.isArray(schemaJson.fields)
      ? schemaJson.fields.map((f) => ({ ...f, constraints: f.constraints || {} }))
      : [];
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
    const formState = getFormState(orderId, nodeKey);

    form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      bindRichEditor(editor);
    });

    const runRules = () => {
      form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
        syncRichEditorValue(editor);
      });
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
        const nextNodeKey = isFlowSubmit ? resolveNextNodeKey(nodeKey, values.handle_mode || "") : "";
        const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values,
            operator_id: operator.account,
            operator_name: operator.userName,
            next_node_key: nextNodeKey || null,
          }),
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
      const nextNodeKey = resolveNextNodeKey(nodeKey, handleMode);
      state.activeKey = ensureTicketTab(workId);
      history.pushState({}, "", getUrlByKey(state.activeKey));
      if (state.createModalOpen && nodeKey === state.createModalNodeKey) {
        const exists = ticketList.some((x) => x.orderId === workId);
        if (!exists) {
          const operator = getCurrentOperator();
          const closed = handleMode === "问题解决关闭" || handleMode === "非问题关闭";
          const nextStepLabel = closed
            ? "已关闭"
            : nextNodeKey
              ? STEP_BY_NODE_KEY[nextNodeKey] || String(nextNodeKey)
              : "运维分析";
          ticketList.unshift({
            orderId: workId,
            processId: String(saved.values?.process_flow_id || saved.values?.flow_id || workId),
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
      advanceWorkflow(workId, nodeKey, nextNodeKey, handleMode);
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
  beginCreateTicketModal();
}

export function bindGlobalFallbackClicks() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

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
      if (key === "params:llm-config" && prevWsKey !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant" && prevWsKey !== "ai:assistant") {
        state.aiNeedsRefresh = true;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
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
      if (key === "params:llm-config" && prevNavKey2 !== "params:llm-config") {
        state.aiLlmConfigLoading = true;
      }
      if (key === "ai:assistant") {
        ensureAiTab();
        if (prevNavKey2 !== "ai:assistant") state.aiNeedsRefresh = true;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
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
      ticketList.splice(0, ticketList.length, ...ticketList.filter((t) => !selected.has(String(t.orderId || ""))));
      state.selectedTicketIds.forEach((orderId) => {
        delete workflowByOrderId[orderId];
        delete operationLogsByOrderId[orderId];
        delete state.ticketStatusByOrderId[orderId];
        Object.keys(state.formsByTicket).forEach((k) => {
          if (k.startsWith(`${orderId}:`)) delete state.formsByTicket[k];
        });
      });
      state.openTabs = state.openTabs.filter((tab) => {
        if (!tab.key.startsWith("ticket:")) return true;
        const id = tab.key.replace("ticket:", "");
        return !selected.has(id);
      });
      if (!state.openTabs.some((t) => t.key === state.activeKey)) state.activeKey = ensureHomeTab();
      state.selectedTicketIds = [];
      requestRender();
    }
  }, true);
}

export function renderWorkflow(orderId) {
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  const ticket = getTicketById(orderId);
  const inferStepFromTicket = () => {
    const node = String(ticket?.node || "").trim();
    if (!node) return -1;
    if (WORKFLOW_NODES.includes(node)) return WORKFLOW_NODES.indexOf(node);
    const byKey = STEP_BY_NODE_KEY[node.toLowerCase()] || STEP_BY_NODE_KEY[node];
    if (byKey && WORKFLOW_NODES.includes(byKey)) return WORKFLOW_NODES.indexOf(byKey);
    return -1;
  };
  const inferredIndex = inferStepFromTicket();
  const effectiveCurrentStep = inferredIndex >= 0 ? inferredIndex : workflow.currentStep;
  const logsByStep = new Map(workflow.logs.map((log) => [log.step, log]));
  const firstStep = workflow.logs[0]?.step || "";
  const firstStepIndex = WORKFLOW_NODES.indexOf(firstStep);
  const isCreatedFromOps = String(orderId || "").startsWith("N");
  const startIndex = firstStepIndex >= 0 ? firstStepIndex : (isCreatedFromOps ? WORKFLOW_NODES.indexOf("运维分析") : 0);
  const ticketStatus = String(ticket?.status || state.ticketStatusByOrderId[orderId] || "open").toLowerCase();
  const isClosed = ticketStatus === "closed";
  const currentStepLabel = WORKFLOW_NODES[effectiveCurrentStep] || "";
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
  if (currentStepLabel) visitedSteps.add(currentStepLabel);
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
  const nodeBar = WORKFLOW_NODES.map((step, index) => {
    if (onlyProblemFill && NODE_KEY_BY_STEP[step] !== "problem_fill") return "";
    if (index < startIndex) return "";
    let stateClass = "upcoming";
    if (!isClosed && index === effectiveCurrentStep) stateClass = "current";
    else if (visitedSteps.has(step)) stateClass = "passed";
    return `<li class="flow-node ${stateClass}">
      <span class="flow-dot"></span>
      <span class="flow-label">${step}</span>
    </li>`;
  })
    .filter(Boolean)
    .join("");

  const logs = WORKFLOW_NODES.map((step, index) => {
    if (onlyProblemFill && NODE_KEY_BY_STEP[step] !== "problem_fill") return "";
    if (index < startIndex) return "";
    if (!visitedSteps.has(step)) return "";
    const isCurrent = !isClosed && index === effectiveCurrentStep;
    const log = logsByStep.get(step);
    const latestMeta = latestMetaByStep.get(step);
    const nodeKey = NODE_KEY_BY_STEP[step];
    let formBody = "";
    if (nodeKey) {
      const editable = isCurrent
        ? (currentStageLevel === "editable" || isCurrentHandler)
        : passedNodeLevel === "editable";
      ensureNodeFormData(orderId, nodeKey);
      formBody = renderNodeForm(orderId, nodeKey, { editable, passedView: !isCurrent && passedNodeLevel !== "editable" });
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
    const open = isCurrent && isCurrentHandler ? "open" : "";
    const metaText = log
      ? `${log.actor} · ${log.at}`
      : latestMeta
        ? `${latestMeta.actor} · ${latestMeta.at}`
        : "暂无记录";
    const logClass = isCurrent ? "flow-log" : "flow-log flow-log-passed";
    return `
      <details class="${logClass}" ${open}>
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

  return `
    <section class="flow-wrap flow-wrap-full">
      <ol class="flow-bar">${nodeBar}</ol>
      <div class="flow-logs">
        ${logs}
      </div>
    </section>
  `;
}

export function advanceWorkflow(orderId, fromNodeKey, toNodeKey, handleMode) {
  const workflow = workflowByOrderId[orderId];
  if (!workflow) return;
  const fromStep = STEP_BY_NODE_KEY[fromNodeKey];
  const toStep = STEP_BY_NODE_KEY[toNodeKey];
  if (!fromStep || !toStep) return;
  const fromIndex = WORKFLOW_NODES.indexOf(fromStep);
  const toIndex = WORKFLOW_NODES.indexOf(toStep);
  if (toIndex < 0) return;
  const moveLabel = toIndex === fromIndex ? "本节点" : (toIndex > fromIndex ? "下一节点" : "回退节点");

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
  if (handleMode === "问题解决关闭" || handleMode === "非问题关闭") {
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
  const kw = String(keyword || "").trim().toLowerCase();
  let shown = 0;
  wrap.querySelectorAll("[data-wf-flat-value-pick]").forEach((btn) => {
    const isPlaceholder = btn.classList.contains("wf-flat-select-item--placeholder");
    const txt = String(btn.textContent || "").trim().toLowerCase();
    const keep = !kw ? true : !isPlaceholder && txt.includes(kw);
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

export function bindWorkflowFlatSelect(form) {
  ensureDutyCascaderDocumentClose();
  if (form.dataset.wfFlatSelectFormBound === "1") return;
  form.dataset.wfFlatSelectFormBound = "1";
  form.addEventListener("input", (ev) => {
    const input = ev.target.closest("[data-wf-flat-search]");
    if (!input || !form.contains(input)) return;
    const wrap = input.closest("[data-wf-flat-select]");
    if (!wrap || !form.contains(wrap)) return;
    wfFlatSelectApplySearch(wrap, input.value || "");
  });
  form.addEventListener("click", (ev) => {
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
      wfFlatSelectCommit(wrap, raw == null ? "" : String(raw));
    }
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
      dutyCascaderToggle(trig.closest(".cascade-cascader"));
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

  const fields = [...(formState.fields || [])].sort((a, b) => {
    const ar = a.type === "richtext" ? 1 : 0;
    const br = b.type === "richtext" ? 1 : 0;
    return ar - br;
  });
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
      let control = `<input type="text" name="${field.key}" value="${escapeAttr(value)}" ${readonly} />`;
      const fieldCls = field.type === "richtext" ? "problem-field problem-field-rich" : "problem-field";

      if (field.type === "date") {
        control = `<input type="date" name="${field.key}" value="${escapeAttr(value)}" ${readonly} ${!editable ? "disabled" : ""} />`;
      } else if (field.type === "whitelist" && Array.isArray(field.cascade_options)) {
        control = renderCascadeWhitelistControl(field, value, editable);
      } else if (field.type === "whitelist") {
        const rawOptions = Array.isArray(field.options) ? field.options : [];
        let options = rawOptions.length > 0 ? rawOptions : ["temp"];
        if (field.key === "handle_mode") {
          const routeMap = HANDLE_MODE_ROUTE[nodeKey] || {};
          const allowedModes = Object.keys(routeMap);
          if (allowedModes.length > 0) {
            options = options.filter((item) => allowedModes.includes(item));
          }
        }
        const usePlaceholder = !WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key);
        if (WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS.has(nodeKey) || WF_FLAT_SEARCHABLE_FIELD_KEYS.has(field.key)) {
          control = renderWorkflowFlatSelect(field, value, editable, {
            options,
            usePlaceholder,
            enableSearch: WF_FLAT_SEARCHABLE_FIELD_KEYS.has(field.key),
          });
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
        control = `<input type="text" name="${field.key}" value="${escapeAttr(value)}" readonly disabled />`;
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
      <form id="node-form-${orderId}-${nodeKey}" ${editable ? `data-node-form="1" data-node-key="${escapeAttr(nodeKey)}" data-order-id="${escapeAttr(orderId)}"` : ""}>
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

export function bindRichEditor(editorWrap) {
  if (!editorWrap || editorWrap.dataset.bound === "1") return;
  editorWrap.dataset.bound = "1";

  const isDisabled = editorWrap.dataset.disabled === "1";
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  const imageInput = editorWrap.querySelector("[data-image-input]");
  const toolbar = editorWrap.querySelector(".rich-toolbar");
  if (!content || !hidden || !toolbar) return;

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
        const dataUrl = await fileToDataUrl(file);
        content.focus();
        document.execCommand("insertImage", false, dataUrl);
        syncRichEditorValue(editorWrap);
      } finally {
        imageInput.value = "";
      }
    });
  }

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
