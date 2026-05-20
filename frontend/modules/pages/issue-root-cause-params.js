import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import {
  issueRootCauseRowByType,
  mergeIssueRootCauseItemsFromApi,
  defaultIssueRootCauseList,
  validateIssueRootCauseDraft,
  resolveActiveIssueTypeIndex,
} from "../constants/issue-root-cause.js";

export async function fetchIssueRootCauseFromServer() {
  state.issueRootCauseLoading = true;
  state.issueRootCauseMsg = "";
  requestRender();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/issue-root-cause`);
    const tx = await resp.text();
    let data = {};
    try {
      data = JSON.parse(tx);
    } catch (_) {
      data = {};
    }
    const detail = String(data.detail || data.message || tx || "").trim();
    if (!resp.ok) {
      state.issueRootCauseItems = defaultIssueRootCauseList([]);
      state.issueRootCauseIssueTypes = [];
      state.issueRootCauseMsg = detail || `加载失败：${resp.status}`;
      return;
    }
    state.issueRootCauseIssueTypes = Array.isArray(data.issue_types)
      ? data.issue_types.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    state.issueRootCauseItems = mergeIssueRootCauseItemsFromApi(data);
    const first = state.issueRootCauseItems[0]?.issue_type || "";
    if (!state.issueRootCauseItems.some((r) => r.issue_type === state.issueRootCauseActiveType)) {
      state.issueRootCauseActiveType = first;
    }
    state.issueRootCauseMsg = "";
  } catch (e) {
    state.issueRootCauseItems = defaultIssueRootCauseList([]);
    state.issueRootCauseIssueTypes = [];
    state.issueRootCauseMsg = `加载失败（网络异常）：${String(e?.message || e)}`;
  } finally {
    state.issueRootCauseLoading = false;
    requestRender();
  }
}

function syncDraftIssueTypesFromDom(panel, draft) {
  panel.querySelectorAll("[data-irc-type-row]").forEach((rowEl) => {
    const idx = Number(rowEl.getAttribute("data-irc-type-index"));
    const inp = rowEl.querySelector("[data-irc-issue-type]");
    if (!Number.isFinite(idx) || !draft[idx] || !inp) return;
    draft[idx].issue_type = String(inp.value || "").trim();
  });
}

function syncDraftCategoriesFromDom(panel, draft, activeType) {
  const row = issueRootCauseRowByType(draft, activeType);
  if (!row) return;
  const inputs = panel.querySelectorAll(".issue-root-cause-input[data-irc-category]");
  row.categories = Array.from(inputs)
    .map((el) => String(el.value || "").trim())
    .filter(Boolean);
}

export async function saveIssueRootCauseDraftToServer() {
  if (!whitelistAllows("params_group_template_edit", "readonly") || !state.issueRootCauseDraft) return;
  const panel = document.getElementById("issue-root-cause-panel");
  if (panel) syncDraftIssueTypesFromDom(panel, state.issueRootCauseDraft);
  const check = validateIssueRootCauseDraft(state.issueRootCauseDraft);
  if (!check.ok) {
    window.alert(check.message);
    return;
  }
  const op = getCurrentOperator();
  state.issueRootCauseSaving = true;
  state.issueRootCauseMsg = "";
  requestRender();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/issue-root-cause`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, items: state.issueRootCauseDraft }),
    });
    const tx = await resp.text();
    let data = {};
    try {
      data = JSON.parse(tx);
    } catch (_) {
      data = {};
    }
    const detail = String(data.detail || data.message || tx || "").trim();
    if (!resp.ok) {
      state.issueRootCauseMsg = detail || `保存失败：${resp.status}`;
      return;
    }
    state.issueRootCauseIssueTypes = Array.isArray(data.issue_types)
      ? data.issue_types.map((x) => String(x || "").trim()).filter(Boolean)
      : state.issueRootCauseIssueTypes;
    state.issueRootCauseItems = mergeIssueRootCauseItemsFromApi(data);
    state.issueRootCauseDraft = null;
    state.issueRootCauseEditMode = false;
    state.issueRootCauseActiveType = state.issueRootCauseItems[0]?.issue_type || "";
    state.issueRootCauseMsg = "问题根因联动已保存";
  } catch (e) {
    state.issueRootCauseMsg = String(e?.message || e);
  } finally {
    state.issueRootCauseSaving = false;
    requestRender();
  }
}

function renderCategoryRows(categories, editable) {
  const list = Array.isArray(categories) ? categories : [];
  if (!list.length && !editable) {
    return `<p class="duty-field-hint">暂无根因分类。</p>`;
  }
  const rows = (list.length ? list : editable ? [""] : [])
    .map(
      (val, i) => `
    <div class="issue-root-cause-row" data-irc-row="${i}">
      ${
        editable
          ? `<input type="text" class="issue-root-cause-input" data-irc-category value="${escapeAttr(String(val || ""))}" placeholder="根因分类" maxlength="256" />
        <button type="button" class="action danger issue-root-cause-del" data-irc-remove="${i}" title="删除">删除</button>`
          : `<span class="issue-root-cause-read">${escapeHtml(String(val || ""))}</span>`
      }
    </div>`
    )
    .join("");
  const addBtn = editable
    ? `<button type="button" class="action" id="irc-add-category">＋添加根因分类</button>`
    : "";
  return `<div class="issue-root-cause-list">${rows}</div>${addBtn}`;
}

function renderIssueTypeTabs(issueTypes, active) {
  return issueTypes
    .map(
      (it) => `
    <button type="button" class="action ${active === it ? "primary" : ""}" data-issue-root-cause-type="${escapeAttr(it)}">${escapeHtml(it)}</button>`
    )
    .join("");
}

function renderIssueTypeEditRows(draft, activeType) {
  const activeIdx = resolveActiveIssueTypeIndex(draft, activeType);
  return (draft || [])
    .map(
      (row, idx) => `
    <div class="issue-root-cause-type-row ${idx === activeIdx ? "is-active" : ""}" data-irc-type-row data-irc-type-index="${idx}">
      <input type="text" class="issue-root-cause-input issue-root-cause-type-input" data-irc-issue-type value="${escapeAttr(String(row.issue_type || ""))}" placeholder="问题类型" maxlength="128" />
      <button type="button" class="action ${idx === activeIdx ? "primary" : ""}" data-irc-type-select="${idx}">配置根因</button>
      <button type="button" class="action danger" data-irc-type-remove="${idx}" title="删除">删除</button>
    </div>`
    )
    .join("");
}

export function renderIssueRootCausePageHtml(title) {
  const admin = whitelistAllows("params_group_template_edit", "readonly");
  const loading = state.issueRootCauseLoading;
  const saving = state.issueRootCauseSaving;
  const edit = state.issueRootCauseEditMode && admin;
  const issueTypes = state.issueRootCauseIssueTypes.length
    ? state.issueRootCauseIssueTypes
    : (state.issueRootCauseItems || []).map((x) => x.issue_type);
  const src = edit ? state.issueRootCauseDraft : state.issueRootCauseItems;
  const draftList = Array.isArray(src) ? src : [];
  const active = state.issueRootCauseActiveType ?? draftList[0]?.issue_type ?? issueTypes[0] ?? "";
  const activeIdx = resolveActiveIssueTypeIndex(draftList, active);
  const row =
    edit && activeIdx >= 0
      ? draftList[activeIdx]
      : issueRootCauseRowByType(draftList, active) || { issue_type: active, categories: [] };
  const msg = state.issueRootCauseMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|未就绪|迁移/.test(state.issueRootCauseMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.issueRootCauseMsg)}</p>`
    : "";
  let actions = "";
  if (admin) {
    if (!edit) {
      actions = `<button type="button" class="action primary" id="issue-root-cause-edit-btn" ${loading || saving ? "disabled" : ""}>编辑</button>`;
    } else {
      actions = `<button type="button" class="action primary" id="issue-root-cause-save-btn" ${loading || saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        <button type="button" class="action" id="issue-root-cause-cancel-btn" ${loading || saving ? "disabled" : ""}>取消</button>`;
    }
  } else {
    actions = `<span class="duty-field-hint">仅管理员可编辑并保存。</span>`;
  }

  let body = "";
  if (loading && !state.issueRootCauseItems.length) {
    body = `<p class="duty-field-hint">正在从服务器加载…</p>`;
  } else if (edit) {
    const typeBlock = `
      <div class="issue-root-cause-section">
        <h3 class="issue-root-cause-section-title">问题类型</h3>
        <div class="issue-root-cause-type-list">${renderIssueTypeEditRows(draftList, active) || `<p class="duty-field-hint">请添加问题类型。</p>`}</div>
        <button type="button" class="action" id="irc-add-issue-type">＋添加问题类型</button>
      </div>`;
    const catBlock = `
      <div class="issue-root-cause-section">
        <h3 class="issue-root-cause-section-title">根因分类${active ? `（${escapeHtml(active)}）` : ""}</h3>
        ${active ? renderCategoryRows(row.categories, true) : `<p class="duty-field-hint">请先选择或填写问题类型。</p>`}
      </div>`;
    body = typeBlock + catBlock;
  } else if (!issueTypes.length) {
    body = `<p class="duty-field-hint">暂无问题类型，请点击编辑添加。</p>`;
  } else {
    body = `
      <div class="version-params-subtabs issue-root-cause-type-tabs" role="tablist" aria-label="问题类型">${renderIssueTypeTabs(issueTypes, active)}</div>
      <div class="issue-root-cause-section">
        <h3 class="issue-root-cause-section-title">根因分类（${escapeHtml(active || issueTypes[0] || "")}）</h3>
        ${renderCategoryRows(row.categories, false)}
      </div>`;
  }

  return `
    <section class="detail-card detail-card-inline params-config-page issue-root-cause-page" id="issue-root-cause-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">${actions}</div>
      </div>
      ${msg}
      ${body}
    </section>
  `;
}

export function bindIssueRootCauseParamsPage() {
  if (state.issueRootCauseNeedsRefresh) {
    state.issueRootCauseNeedsRefresh = false;
    void fetchIssueRootCauseFromServer().then(() => requestRender());
  }

  const panel = document.getElementById("issue-root-cause-panel");
  if (!panel) return;

  panel.querySelector("#issue-root-cause-edit-btn")?.addEventListener("click", () => {
    if (!whitelistAllows("params_group_template_edit", "readonly")) return;
    state.issueRootCauseEditMode = true;
    state.issueRootCauseDraft = JSON.parse(JSON.stringify(state.issueRootCauseItems || []));
    if (!state.issueRootCauseDraft.length) {
      state.issueRootCauseDraft = [{ issue_type: "", categories: [""] }];
    }
    state.issueRootCauseActiveType = state.issueRootCauseDraft[0]?.issue_type || "";
    state.issueRootCauseMsg = "";
    requestRender();
  });

  panel.querySelector("#issue-root-cause-cancel-btn")?.addEventListener("click", () => {
    state.issueRootCauseEditMode = false;
    state.issueRootCauseDraft = null;
    state.issueRootCauseMsg = "";
    void fetchIssueRootCauseFromServer().then(() => requestRender());
  });

  panel.querySelector("#issue-root-cause-save-btn")?.addEventListener("click", () => void saveIssueRootCauseDraftToServer());

  panel.querySelectorAll("[data-issue-root-cause-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.issueRootCauseActiveType = btn.getAttribute("data-issue-root-cause-type") || "";
      requestRender();
    });
  });

  const draft = state.issueRootCauseEditMode && whitelistAllows("params_group_template_edit", "readonly") ? state.issueRootCauseDraft : null;
  if (!draft) return;

  const selectActiveByIndex = (idx) => {
    syncDraftIssueTypesFromDom(panel, draft);
    syncDraftCategoriesFromDom(panel, draft, state.issueRootCauseActiveType);
    const row = draft[idx];
    if (!row) return;
    state.issueRootCauseActiveType = String(row.issue_type || "").trim();
    requestRender();
  };

  panel.querySelector("#irc-add-issue-type")?.addEventListener("click", () => {
    syncDraftIssueTypesFromDom(panel, draft);
    syncDraftCategoriesFromDom(panel, draft, state.issueRootCauseActiveType);
    draft.push({ issue_type: "", categories: [""] });
    state.issueRootCauseActiveType = "";
    requestRender();
  });

  panel.querySelectorAll("[data-irc-type-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncDraftIssueTypesFromDom(panel, draft);
      syncDraftCategoriesFromDom(panel, draft, state.issueRootCauseActiveType);
      const idx = Number(btn.getAttribute("data-irc-type-remove"));
      if (!Number.isFinite(idx)) return;
      draft.splice(idx, 1);
      if (!draft.length) {
        state.issueRootCauseActiveType = "";
      } else {
        const next = draft[Math.min(idx, draft.length - 1)];
        state.issueRootCauseActiveType = String(next?.issue_type || "").trim();
      }
      requestRender();
    });
  });

  panel.querySelectorAll("[data-irc-type-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-irc-type-select"));
      if (!Number.isFinite(idx)) return;
      selectActiveByIndex(idx);
    });
  });

  panel.querySelectorAll("[data-irc-issue-type]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const rowEl = inp.closest("[data-irc-type-row]");
      const idx = Number(rowEl?.getAttribute("data-irc-type-index"));
      if (!Number.isFinite(idx) || !draft[idx]) return;
      draft[idx].issue_type = String(inp.value || "").trim();
      if (resolveActiveIssueTypeIndex(draft, state.issueRootCauseActiveType) === idx) {
        state.issueRootCauseActiveType = draft[idx].issue_type;
      }
    });
    inp.addEventListener("focus", () => {
      const rowEl = inp.closest("[data-irc-type-row]");
      const idx = Number(rowEl?.getAttribute("data-irc-type-index"));
      if (!Number.isFinite(idx)) return;
      panel.querySelectorAll(".issue-root-cause-type-row").forEach((el) => el.classList.remove("is-active"));
      rowEl?.classList.add("is-active");
      panel.querySelectorAll("[data-irc-type-select]").forEach((b) => b.classList.remove("primary"));
      const sel = panel.querySelector(`[data-irc-type-select="${idx}"]`);
      sel?.classList.add("primary");
    });
  });

  panel.querySelector("#irc-add-category")?.addEventListener("click", () => {
    syncDraftIssueTypesFromDom(panel, draft);
    syncDraftCategoriesFromDom(panel, draft, state.issueRootCauseActiveType);
    const row = issueRootCauseRowByType(draft, state.issueRootCauseActiveType);
    if (!row) {
      window.alert("请先填写并选中问题类型");
      return;
    }
    row.categories = [...(row.categories || []), ""];
    requestRender();
  });

  panel.querySelectorAll("[data-irc-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncDraftIssueTypesFromDom(panel, draft);
      const row = issueRootCauseRowByType(draft, state.issueRootCauseActiveType);
      if (!row) return;
      const idx = Number(btn.getAttribute("data-irc-remove"));
      if (!Number.isFinite(idx)) return;
      row.categories = (row.categories || []).filter((_, i) => i !== idx);
      requestRender();
    });
  });

  panel.querySelectorAll(".issue-root-cause-input[data-irc-category]").forEach((inp) => {
    inp.addEventListener("input", () => {
      syncDraftCategoriesFromDom(panel, draft, state.issueRootCauseActiveType);
    });
  });
}
