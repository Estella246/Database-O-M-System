import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { bindListSearchInput } from "../ui/list-search-input.js";
import { GROUP_TEMPLATE_KINDS, GROUP_TEMPLATE_NAME_DEFAULTS } from "../constants/theme.js";
import {
  filterVersionBaselineRows,
  filterVersionHotfixRows,
  formatBaselinePickLabel,
  defaultGroupTemplateList,
  mergeGroupTemplateItemsFromApi,
  groupTemplateRowByKind,
  getParamsPageHeadline,
} from "./params.js";
import {
  renderIssueRootCausePageHtml,
  bindIssueRootCauseParamsPage,
} from "./issue-root-cause-params.js";

export { bindIssueRootCauseParamsPage } from "./issue-root-cause-params.js";
import { getUrlByKey } from "./ticket-core.js";
import { renderLlmConfigPageHtml, renderDutyFieldTreeInnerHtml } from "./ticket-page.js";
import {
  clampListPage,
  sliceForListPage,
  renderListPaginationHtml,
  bindListPagination,
} from "../utils/list-pagination.js";

export function ensureParamsTab(kind) {
  const map = {
    "duty-field": { key: "params:duty-field", label: "责任田模块" },
    version: { key: "params:version", label: "版本模块" },
    "group-template": { key: "params:group-template", label: "拉群模版" },
    "issue-root-cause": { key: "params:issue-root-cause", label: "问题根因" },
    "llm-config": { key: "params:llm-config", label: "大模型配置" },
    "qi-config": { key: "params:qi-config", label: "质量改进配置" },
  };
  const item = map[kind] || map["duty-field"];
  if (!state.openTabs.some((tab) => tab.key === item.key)) {
    state.openTabs.push({ key: item.key, label: item.label, closable: true });
  }
  return item.key;
}

export async function saveVersionBaselineDraft() {
  const draft = state.versionBaselineDraft;
  const orig = state.versionBaselineOrig;
  if (!draft || !orig) return;
  for (const row of draft) {
    if (!String(row.version_label || "").trim()) {
      window.alert("「版本」不能为空");
      return;
    }
  }
  const op = getCurrentOperator();
  state.versionBaselineSaving = true;
  state.versionMsg = "";
  requestRender();
  try {
    const origById = new Map((orig || []).filter((r) => r.id).map((r) => [r.id, r]));
    const draftIds = new Set((draft || []).filter((r) => r.id).map((r) => r.id));
    for (const o of orig) {
      if (o.id && !draftIds.has(o.id)) {
        const resp = await fetch(
          `${API_BASE_URL}/api/params/baseline-versions/${o.id}?operator_id=${encodeURIComponent(op.account)}`,
          { method: "DELETE" },
        );
        if (!resp.ok) throw new Error(await parseApiError(resp));
      }
    }
    for (let i = 0; i < draft.length; i++) {
      const row = draft[i];
      const sort_order = i;
      if (!row.id) {
        const resp = await fetch(`${API_BASE_URL}/api/params/baseline-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: op.account,
            version_label: String(row.version_label || "").trim(),
            commit_hash: String(row.commit_hash || "").trim(),
            sort_order,
          }),
        });
        if (!resp.ok) throw new Error(await parseApiError(resp));
      } else {
        const o = origById.get(row.id);
        const changed =
          !o ||
          String(o.version_label || "") !== String(row.version_label || "").trim() ||
          String(o.commit_hash || "") !== String(row.commit_hash || "").trim() ||
          Number(o.sort_order) !== sort_order;
        if (changed) {
          const resp = await fetch(`${API_BASE_URL}/api/params/baseline-versions/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operator_id: op.account,
              version_label: String(row.version_label || "").trim(),
              commit_hash: String(row.commit_hash || "").trim(),
              sort_order,
            }),
          });
          if (!resp.ok) throw new Error(await parseApiError(resp));
        }
      }
    }
    await refreshVersionParamsData();
    state.versionBaselineEditMode = false;
    state.versionBaselineDraft = null;
    state.versionBaselineOrig = null;
    state.versionMsg = "基线版本已保存";
  } catch (e) {
    state.versionMsg = String(e?.message || e);
  } finally {
    state.versionBaselineSaving = false;
    requestRender();
  }
}

export async function saveVersionHotfixDraft() {
  const draft = state.versionHotfixDraft;
  const orig = state.versionHotfixOrig;
  if (!draft || !orig) return;
  for (const row of draft) {
    if (!String(row.hotfix_label || "").trim()) {
      window.alert("「热补丁版本」不能为空");
      return;
    }
    const bid = Number(row.baseline_id);
    if (!Number.isFinite(bid) || bid <= 0) {
      window.alert("请选择基线版本");
      return;
    }
  }
  const op = getCurrentOperator();
  state.versionHotfixSaving = true;
  state.versionMsg = "";
  requestRender();
  try {
    const origById = new Map((orig || []).filter((r) => r.id).map((r) => [r.id, r]));
    const draftIds = new Set((draft || []).filter((r) => r.id).map((r) => r.id));
    for (const o of orig) {
      if (o.id && !draftIds.has(o.id)) {
        const resp = await fetch(
          `${API_BASE_URL}/api/params/hotfix-versions/${o.id}?operator_id=${encodeURIComponent(op.account)}`,
          { method: "DELETE" },
        );
        if (!resp.ok) throw new Error(await parseApiError(resp));
      }
    }
    for (let i = 0; i < draft.length; i++) {
      const row = draft[i];
      const sort_order = i;
      const baseline_id = Number(row.baseline_id);
      if (!row.id) {
        const resp = await fetch(`${API_BASE_URL}/api/params/hotfix-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: op.account,
            baseline_id,
            hotfix_label: String(row.hotfix_label || "").trim(),
            sort_order,
          }),
        });
        if (!resp.ok) throw new Error(await parseApiError(resp));
      } else {
        const o = origById.get(row.id);
        const changed =
          !o ||
          String(o.hotfix_label || "") !== String(row.hotfix_label || "").trim() ||
          Number(o.baseline_id) !== baseline_id ||
          Number(o.sort_order) !== sort_order;
        if (changed) {
          const resp = await fetch(`${API_BASE_URL}/api/params/hotfix-versions/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operator_id: op.account,
              baseline_id,
              hotfix_label: String(row.hotfix_label || "").trim(),
              sort_order,
            }),
          });
          if (!resp.ok) throw new Error(await parseApiError(resp));
        }
      }
    }
    await refreshVersionParamsData();
    state.versionHotfixEditMode = false;
    state.versionHotfixDraft = null;
    state.versionHotfixOrig = null;
    state.versionMsg = "热补丁版本已保存";
  } catch (e) {
    state.versionMsg = String(e?.message || e);
  } finally {
    state.versionHotfixSaving = false;
    requestRender();
  }
}

export function bindVersionParamsPage() {
  const canEditVersion = whitelistAllows("params_version_edit", "readonly");
  if (!canEditVersion && (state.versionBaselineEditMode || state.versionHotfixEditMode)) {
    state.versionBaselineEditMode = false;
    state.versionBaselineDraft = null;
    state.versionBaselineOrig = null;
    state.versionHotfixEditMode = false;
    state.versionHotfixDraft = null;
    state.versionHotfixOrig = null;
  }
  if (state.versionNeedsRefresh && !state.versionBaselineEditMode && !state.versionHotfixEditMode) {
    state.versionNeedsRefresh = false;
    void refreshVersionParamsData();
  }

  const panel = document.getElementById("version-params-panel");
  if (!panel) return;

  panel.querySelectorAll("[data-version-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = btn.getAttribute("data-version-sub") || "baseline";
      if (sub !== "baseline" && sub !== "hotfix") return;
      if (state.versionBaselineEditMode || state.versionHotfixEditMode) {
        if (!window.confirm("正在编辑，切换将放弃未保存的修改，确定吗？")) return;
        state.versionBaselineEditMode = false;
        state.versionBaselineDraft = null;
        state.versionBaselineOrig = null;
        state.versionHotfixEditMode = false;
        state.versionHotfixDraft = null;
        state.versionHotfixOrig = null;
      }
      state.versionSubTab = sub;
      history.replaceState({}, "", getUrlByKey("params:version"));
      requestRender();
    });
  });

  const VERSION_SEARCH_DEBOUNCE_MS = 400;
  const searchBaseline = panel.querySelector("#version-search-baseline");
  bindListSearchInput(searchBaseline, {
    debounceMs: VERSION_SEARCH_DEBOUNCE_MS,
    skipLoadingRender: false,
    onValue: (v) => {
      state.versionBaselineSearch = v;
      state.versionBaselineListPage = 1;
    },
    onSearch: () => {
      requestRender();
    },
  });
  const searchHotfix = panel.querySelector("#version-search-hotfix");
  bindListSearchInput(searchHotfix, {
    debounceMs: VERSION_SEARCH_DEBOUNCE_MS,
    skipLoadingRender: false,
    onValue: (v) => {
      state.versionHotfixSearch = v;
      state.versionHotfixListPage = 1;
    },
    onSearch: () => {
      requestRender();
    },
  });

  bindListPagination(panel, {
    pageSizeSelectId: "version-baseline-page-size",
    prevId: "version-baseline-page-prev",
    nextId: "version-baseline-page-next",
    totalPages: clampListPage(
      filterVersionBaselineRows(
        (state.versionBaselineEditMode ? state.versionBaselineDraft : state.versionBaselineList) || [],
        state.versionBaselineSearch,
      ).length,
      state.versionBaselineListPage,
      state.versionBaselineListPageSize,
    ).totalPages,
    currentPage: state.versionBaselineListPage,
    onPageSizeChange: (size) => {
      state.versionBaselineListPageSize = size;
      state.versionBaselineListPage = 1;
      requestRender();
    },
    onPrev: () => {
      if (state.versionBaselineListPage > 1) {
        state.versionBaselineListPage--;
        requestRender();
      }
    },
    onNext: () => {
      const pg = clampListPage(
        filterVersionBaselineRows(
          (state.versionBaselineEditMode ? state.versionBaselineDraft : state.versionBaselineList) || [],
          state.versionBaselineSearch,
        ).length,
        state.versionBaselineListPage,
        state.versionBaselineListPageSize,
      );
      if (state.versionBaselineListPage < pg.totalPages) {
        state.versionBaselineListPage++;
        requestRender();
      }
    },
    onPageChange: (page) => {
      state.versionBaselineListPage = page;
      requestRender();
    },
  });
  bindListPagination(panel, {
    pageSizeSelectId: "version-hotfix-page-size",
    prevId: "version-hotfix-page-prev",
    nextId: "version-hotfix-page-next",
    totalPages: clampListPage(
      filterVersionHotfixRows(
        (state.versionHotfixEditMode ? state.versionHotfixDraft : state.versionHotfixList) || [],
        state.versionHotfixSearch,
      ).length,
      state.versionHotfixListPage,
      state.versionHotfixListPageSize,
    ).totalPages,
    currentPage: state.versionHotfixListPage,
    onPageSizeChange: (size) => {
      state.versionHotfixListPageSize = size;
      state.versionHotfixListPage = 1;
      requestRender();
    },
    onPrev: () => {
      if (state.versionHotfixListPage > 1) {
        state.versionHotfixListPage--;
        requestRender();
      }
    },
    onNext: () => {
      const pg = clampListPage(
        filterVersionHotfixRows(
          (state.versionHotfixEditMode ? state.versionHotfixDraft : state.versionHotfixList) || [],
          state.versionHotfixSearch,
        ).length,
        state.versionHotfixListPage,
        state.versionHotfixListPageSize,
      );
      if (state.versionHotfixListPage < pg.totalPages) {
        state.versionHotfixListPage++;
        requestRender();
      }
    },
    onPageChange: (page) => {
      state.versionHotfixListPage = page;
      requestRender();
    },
  });

  panel.querySelector("#version-baseline-toggle-edit")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    if (state.versionBaselineEditMode) {
      state.versionBaselineEditMode = false;
      state.versionBaselineDraft = null;
      state.versionBaselineOrig = null;
    } else {
      state.versionBaselineEditMode = true;
      state.versionBaselineDraft = JSON.parse(JSON.stringify(state.versionBaselineList || []));
      state.versionBaselineOrig = JSON.parse(JSON.stringify(state.versionBaselineList || []));
    }
    requestRender();
  });

  panel.querySelector("#version-baseline-add-row")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    if (!state.versionBaselineDraft) return;
    state.versionBaselineDraft.push({
      id: null,
      clientKey: `vb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      version_label: "",
      commit_hash: "",
    });
    requestRender();
  });

  panel.querySelector("#version-baseline-save")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    void saveVersionBaselineDraft();
  });

  panel.querySelector("#version-baseline-delete-selected")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    const d = state.versionBaselineDraft;
    if (!d) return;
    const checks = panel.querySelectorAll("input[data-vb-check]:checked");
    if (!checks.length) {
      window.alert("请先勾选要删除的行");
      return;
    }
    const drop = new Set(
      [...checks].map((cb) => {
        const id = cb.getAttribute("data-vb-id");
        const ck = cb.getAttribute("data-vb-ckey") || "";
        return id != null && String(id).trim() !== "" ? `id:${id}` : `c:${ck}`;
      }),
    );
    state.versionBaselineDraft = d.filter((r) => {
      const k = r.id != null ? `id:${r.id}` : `c:${r.clientKey || ""}`;
      return !drop.has(k);
    });
    const hall = panel.querySelector("#version-baseline-check-all");
    if (hall) hall.checked = false;
    requestRender();
  });

  panel.querySelector("#version-baseline-check-all")?.addEventListener("change", (ev) => {
    const on = !!ev.target.checked;
    panel.querySelectorAll("input[data-vb-check]").forEach((cb) => {
      cb.checked = on;
    });
  });

  panel.querySelector("#version-hotfix-toggle-edit")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    if (state.versionHotfixEditMode) {
      state.versionHotfixEditMode = false;
      state.versionHotfixDraft = null;
      state.versionHotfixOrig = null;
    } else {
      state.versionHotfixEditMode = true;
      state.versionHotfixDraft = JSON.parse(JSON.stringify(state.versionHotfixList || []));
      state.versionHotfixOrig = JSON.parse(JSON.stringify(state.versionHotfixList || []));
    }
    requestRender();
  });

  panel.querySelector("#version-hotfix-add-row")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    if (!state.versionHotfixDraft) return;
    const bases = state.versionBaselineList || [];
    const firstId = bases.length ? Number(bases[0].id) : 0;
    state.versionHotfixDraft.push({
      id: null,
      clientKey: `vh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      baseline_id: Number.isFinite(firstId) && firstId > 0 ? firstId : null,
      hotfix_label: "",
      baseline_version_label: "",
      baseline_commit_hash: "",
    });
    requestRender();
  });

  panel.querySelector("#version-hotfix-save")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    void saveVersionHotfixDraft();
  });

  panel.querySelector("#version-hotfix-delete-selected")?.addEventListener("click", () => {
    if (!canEditVersion) return;
    const d = state.versionHotfixDraft;
    if (!d) return;
    const checks = panel.querySelectorAll("input[data-vh-check]:checked");
    if (!checks.length) {
      window.alert("请先勾选要删除的行");
      return;
    }
    const drop = new Set(
      [...checks].map((cb) => {
        const id = cb.getAttribute("data-vh-id");
        const ck = cb.getAttribute("data-vh-ckey") || "";
        return id != null && String(id).trim() !== "" ? `id:${id}` : `c:${ck}`;
      }),
    );
    state.versionHotfixDraft = d.filter((r) => {
      const k = r.id != null ? `id:${r.id}` : `c:${r.clientKey || ""}`;
      return !drop.has(k);
    });
    const hall = panel.querySelector("#version-hotfix-check-all");
    if (hall) hall.checked = false;
    requestRender();
  });

  panel.querySelector("#version-hotfix-check-all")?.addEventListener("change", (ev) => {
    const on = !!ev.target.checked;
    panel.querySelectorAll("input[data-vh-check]").forEach((cb) => {
      cb.checked = on;
    });
  });

  panel.querySelectorAll("[data-vb-field]").forEach((inp) => {
    const sync = () => {
      const row = versionFindBaselineDraftRow(inp.getAttribute("data-vb-id"), inp.getAttribute("data-vb-ckey"));
      if (!row) return;
      const f = inp.getAttribute("data-vb-field");
      if (f === "version_label") row.version_label = inp.value;
      else if (f === "commit_hash") row.commit_hash = inp.value;
    };
    inp.addEventListener("input", sync);
    inp.addEventListener("change", sync);
  });

  panel.querySelectorAll("[data-vh-field]").forEach((el) => {
    const sync = () => {
      const row = versionFindHotfixDraftRow(el.getAttribute("data-vh-id"), el.getAttribute("data-vh-ckey"));
      if (!row) return;
      const f = el.getAttribute("data-vh-field");
      if (f === "hotfix_label") row.hotfix_label = el.value;
      if (f === "baseline_id") row.baseline_id = Number(el.value);
    };
    el.addEventListener("change", sync);
    if (el.tagName !== "SELECT") el.addEventListener("input", sync);
  });
}

export async function fetchGroupTemplatesFromServer() {
  state.groupTemplateLoading = true;
  state.groupTemplateMsg = "";
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/group-templates`);
    const tx = await resp.text();
    let data = {};
    try {
      data = JSON.parse(tx);
    } catch (_) {
      data = {};
    }
    const detail = String(data.detail || data.message || tx || "").trim();
    if (!resp.ok) {
      state.groupTemplateItems = defaultGroupTemplateList();
      state.groupTemplateMsg =
        resp.status === 503 ? detail || "拉群模版表未就绪，请执行数据库迁移。" : `加载失败：${detail || resp.status}`;
      return false;
    }
    state.groupTemplateItems = mergeGroupTemplateItemsFromApi(data.items);
    state.groupTemplateMsg = "";
    return true;
  } catch (e) {
    state.groupTemplateItems = defaultGroupTemplateList();
    state.groupTemplateMsg = `加载失败（网络异常）：${String(e?.message || e)}`;
    return false;
  } finally {
    state.groupTemplateLoading = false;
  }
}

export function renderGroupTemplateFieldsHtml(row, readOnly, idPrefix) {
  const p = idPrefix || "gt";
  const ro = readOnly ? "readonly" : "";
  const r = row || {
    problem_kind: state.groupTemplateActiveKind,
    group_name_tpl: "",
    group_notice_tpl: "",
    group_members_tpl: "",
    first_report_tpl: "",
  };
  const fields = [
    { key: "group_name_tpl", label: "群名称" },
    { key: "group_notice_tpl", label: "群公告" },
    { key: "group_members_tpl", label: "群组成员" },
    { key: "first_report_tpl", label: "首次通报" },
  ];
  return fields
    .map(
      (f) => `
    <div class="group-template-field">
      <label class="group-template-label" for="${p}-${f.key}">${escapeHtml(f.label)}</label>
      <textarea id="${p}-${f.key}" class="group-template-input" data-field="${escapeAttr(f.key)}" rows="${f.key === "group_name_tpl" ? 3 : 5}" ${ro}>${escapeHtml(String(r[f.key] ?? ""))}</textarea>
    </div>`
    )
    .join("");
}

export function renderGroupTemplatePageHtml(title) {
  const admin = whitelistAllows("params_group_template_edit", "readonly");
  const loading = state.groupTemplateLoading;
  const saving = state.groupTemplateSaving;
  const edit = state.groupTemplateEditMode && admin;
  const src = edit ? state.groupTemplateDraft : state.groupTemplateItems;
  const row = groupTemplateRowByKind(src, state.groupTemplateActiveKind);
  const msg = state.groupTemplateMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|未就绪|迁移/.test(state.groupTemplateMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.groupTemplateMsg)}</p>`
    : "";
  const tabs = GROUP_TEMPLATE_KINDS.map(
    ({ kind, label }) => `
    <button type="button" class="action ${state.groupTemplateActiveKind === kind ? "primary" : ""}" data-group-template-kind="${escapeAttr(kind)}">${escapeHtml(label)}</button>`
  ).join("");
  let actions = "";
  if (admin) {
    if (!edit) {
      actions = `<button type="button" class="action primary" id="group-template-edit-btn" ${loading || saving ? "disabled" : ""}>编辑</button>`;
    } else {
      actions = `<button type="button" class="action primary" id="group-template-save-btn" ${loading || saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        <button type="button" class="action" id="group-template-cancel-btn" ${loading || saving ? "disabled" : ""}>取消</button>`;
    }
  } else {
    actions = `<span class="duty-field-hint">仅管理员可编辑并保存模版。</span>`;
  }
  const body =
    loading && !state.groupTemplateItems.length
      ? `<p class="duty-field-hint">正在从服务器加载…</p>`
      : renderGroupTemplateFieldsHtml(row, !edit, "gt");
  return `
    <section class="detail-card detail-card-inline params-config-page group-template-page" id="group-template-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">${actions}</div>
      </div>
      ${msg}
      <div class="version-params-subtabs group-template-type-tabs" role="tablist" aria-label="问题类型">${tabs}</div>
      ${body}
    </section>
  `;
}

export function renderGroupPullModalHtml() {
  if (!state.groupPullModalOpen) return "";
  const loading = state.groupPullLoading;
  const local = Array.isArray(state.groupPullLocal) ? state.groupPullLocal : state.groupTemplateItems;
  const row = groupTemplateRowByKind(local, state.groupPullActiveKind);
  const tabs = GROUP_TEMPLATE_KINDS.map(
    ({ kind, label }) => `
    <button type="button" class="action ${state.groupPullActiveKind === kind ? "primary" : ""}" data-group-pull-kind="${escapeAttr(kind)}">${escapeHtml(label)}</button>`
  ).join("");
  const warn =
    !loading && state.groupTemplateMsg
      ? `<p class="duty-field-banner duty-field-banner--err">${escapeHtml(state.groupTemplateMsg)}</p>`
      : "";
  const body = loading
    ? `<p class="duty-field-hint">正在加载模版…</p>`
    : renderGroupTemplateFieldsHtml(row, false, "gp");
  return `
  <div class="perm-modal-mask" id="group-pull-modal-mask" role="dialog" aria-modal="true" aria-labelledby="group-pull-modal-title">
    <div class="perm-modal group-pull-modal">
      <div class="perm-modal-head">
        <h3 id="group-pull-modal-title">拉群</h3>
      </div>
      <div class="perm-modal-body">
        ${warn}
        <div class="version-params-subtabs group-template-type-tabs" role="tablist" aria-label="问题类型">${tabs}</div>
        ${body}
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action primary" id="group-pull-submit-btn" ${loading || state.groupPullSubmitting ? "disabled" : ""}>${state.groupPullSubmitting ? "拉群中…" : "一键拉群"}</button>
        <button type="button" class="action" id="group-pull-close-btn">关闭</button>
      </div>
    </div>
  </div>`;
}

export async function saveGroupTemplateDraftToServer() {
  if (!whitelistAllows("params_group_template_edit", "readonly") || !state.groupTemplateDraft) return;
  const op = getCurrentOperator();
  state.groupTemplateSaving = true;
  state.groupTemplateMsg = "";
  requestRender();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/group-templates`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, items: state.groupTemplateDraft }),
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
      state.groupTemplateMsg = detail || `保存失败：${resp.status}`;
      return;
    }
    state.groupTemplateItems = mergeGroupTemplateItemsFromApi(data.items);
    state.groupTemplateDraft = null;
    state.groupTemplateEditMode = false;
    state.groupTemplateMsg = "拉群模版已保存";
  } catch (e) {
    state.groupTemplateMsg = String(e?.message || e);
  } finally {
    state.groupTemplateSaving = false;
    requestRender();
  }
}

export function bindGroupTemplateParamsPage() {
  if (state.groupTemplateNeedsRefresh) {
    state.groupTemplateNeedsRefresh = false;
    void fetchGroupTemplatesFromServer().then(() => requestRender());
  }

  const panel = document.getElementById("group-template-panel");
  if (!panel) return;

  panel.querySelector("#group-template-edit-btn")?.addEventListener("click", () => {
    if (!whitelistAllows("params_group_template_edit", "readonly")) return;
    state.groupTemplateEditMode = true;
    state.groupTemplateDraft = JSON.parse(JSON.stringify(state.groupTemplateItems || defaultGroupTemplateList()));
    state.groupTemplateMsg = "";
    requestRender();
  });

  panel.querySelector("#group-template-cancel-btn")?.addEventListener("click", () => {
    state.groupTemplateEditMode = false;
    state.groupTemplateDraft = null;
    state.groupTemplateMsg = "";
    void fetchGroupTemplatesFromServer().then(() => requestRender());
  });

  panel.querySelector("#group-template-save-btn")?.addEventListener("click", () => void saveGroupTemplateDraftToServer());

  panel.querySelectorAll("[data-group-template-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-group-template-kind") || "major";
      state.groupTemplateActiveKind = k;
      requestRender();
    });
  });

  const src = state.groupTemplateEditMode && whitelistAllows("params_group_template_edit", "readonly") ? state.groupTemplateDraft : null;
  panel.querySelectorAll("textarea.group-template-input").forEach((ta) => {
    ta.addEventListener("input", () => {
      if (!src) return;
      const kind = state.groupTemplateActiveKind;
      const row = groupTemplateRowByKind(src, kind);
      const field = ta.getAttribute("data-field");
      if (row && field) row[field] = ta.value;
    });
  });
}

export function bindGroupPullModal() {
  const mask = document.getElementById("group-pull-modal-mask");
  if (!mask) return;

  mask.querySelector("#group-pull-close-btn")?.addEventListener("click", () => {
    state.groupPullModalOpen = false;
    state.groupPullLocal = null;
    requestRender();
  });

  mask.addEventListener("click", (ev) => {
    if (ev.target === mask) {
      state.groupPullModalOpen = false;
      state.groupPullLocal = null;
      requestRender();
    }
  });

  mask.querySelectorAll("[data-group-pull-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-group-pull-kind") || "major";
      state.groupPullActiveKind = k;
      requestRender();
    });
  });

  const local = state.groupPullLocal;
  mask.querySelectorAll("textarea.group-template-input").forEach((ta) => {
    ta.addEventListener("input", () => {
      if (!Array.isArray(local)) return;
      const kind = state.groupPullActiveKind;
      const row = groupTemplateRowByKind(local, kind);
      const field = ta.getAttribute("data-field");
      if (row && field) row[field] = ta.value;
    });
  });

  mask.querySelector("#group-pull-submit-btn")?.addEventListener("click", async () => {
    if (state.groupPullSubmitting) return;
    const list = Array.isArray(state.groupPullLocal) ? state.groupPullLocal : state.groupTemplateItems;
    const kind = state.groupPullActiveKind;
    const row = groupTemplateRowByKind(list, kind) || {};
    const op = getCurrentOperator();
    const payload = {
      problem_kind: kind,
      group_name: String(row.group_name_tpl || "").trim(),
      manifesto: String(row.group_notice_tpl || "").trim(),
      group_members: String(row.group_members_tpl || "").trim(),
      message: String(row.first_report_tpl || "").trim(),
      operator_id: op.account,
    };
    state.groupPullSubmitting = true;
    requestRender();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/welink/create-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = {};
      try { data = await resp.json(); } catch (_) { data = {}; }
      if (!resp.ok) {
        const detail = String(data.detail || data.message || "").trim();
        window.alert(`群组创建失败：${detail || resp.status}`);
        return;
      }
      window.alert(`群组创建成功！群ID：${data.group_id || ""}`);
      state.groupPullModalOpen = false;
      state.groupPullLocal = null;
    } catch (e) {
      window.alert(`群组创建失败：${e instanceof Error ? e.message : "网络异常"}`);
    } finally {
      state.groupPullSubmitting = false;
      requestRender();
    }
  });
}

export function renderVersionParamsPageHtml(title) {
  const sub = state.versionSubTab === "hotfix" ? "hotfix" : "baseline";
  const canEditVersion = whitelistAllows("params_version_edit", "readonly");
  if (!canEditVersion && (state.versionBaselineEditMode || state.versionHotfixEditMode)) {
    state.versionBaselineEditMode = false;
    state.versionBaselineDraft = null;
    state.versionBaselineOrig = null;
    state.versionHotfixEditMode = false;
    state.versionHotfixDraft = null;
    state.versionHotfixOrig = null;
  }
  const loading = state.versionBaselineLoading || state.versionHotfixLoading;
  const saving = state.versionBaselineSaving || state.versionHotfixSaving;
  const msg = state.versionMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|冲突|引用|不存在|不能为空|请先/.test(state.versionMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.versionMsg)}</p>`
    : "";
  const bases = state.versionBaselineList || [];

  const baselineRowsSrc = state.versionBaselineEditMode ? state.versionBaselineDraft : state.versionBaselineList;
  const baselineVisibleAll = filterVersionBaselineRows(baselineRowsSrc || [], state.versionBaselineSearch);
  const baselinePg = clampListPage(
    baselineVisibleAll.length,
    state.versionBaselineListPage,
    state.versionBaselineListPageSize,
  );
  if (baselinePg.currentPage !== state.versionBaselineListPage) state.versionBaselineListPage = baselinePg.currentPage;
  const baselineVisible = sliceForListPage(baselineVisibleAll, baselinePg.currentPage, baselinePg.pageSize);
  const baselinePaginationHtml = renderListPaginationHtml({
    wrapId: "version-baseline-pagination",
    totalItems: baselinePg.totalItems,
    currentPage: baselinePg.currentPage,
    totalPages: baselinePg.totalPages,
    pageSize: baselinePg.pageSize,
    pageSizeSelectId: "version-baseline-page-size",
    prevId: "version-baseline-page-prev",
    nextId: "version-baseline-page-next",
  });
  const baselineHead = state.versionBaselineEditMode
    ? `<tr><th class="version-row-check" scope="col"><input type="checkbox" id="version-baseline-check-all" title="全选当前列表" aria-label="全选当前列表" /></th><th>序号</th><th>版本</th><th>commit号</th></tr>`
    : `<tr><th>序号</th><th>版本</th><th>commit号</th></tr>`;
  const baselineColCount = state.versionBaselineEditMode ? 4 : 3;
  const baselineBody = baselineVisible
    .map((r, vi) => {
      const seq = (baselinePg.currentPage - 1) * baselinePg.pageSize + vi + 1;
      const idAttr = r.id != null ? String(r.id) : "";
      const ckey = r.clientKey || "";
      if (state.versionBaselineEditMode) {
        return `<tr>
          <td class="version-row-check"><input type="checkbox" data-vb-check data-vb-id="${escapeAttr(idAttr)}" data-vb-ckey="${escapeAttr(ckey)}" /></td>
          <td>${seq}</td>
          <td><input type="text" class="admin-table-inline" data-vb-field="version_label" data-vb-id="${escapeAttr(idAttr)}" data-vb-ckey="${escapeAttr(ckey)}" value="${escapeAttr(String(r.version_label || ""))}" maxlength="256" /></td>
          <td><input type="text" class="admin-table-inline" data-vb-field="commit_hash" data-vb-id="${escapeAttr(idAttr)}" data-vb-ckey="${escapeAttr(ckey)}" value="${escapeAttr(String(r.commit_hash || ""))}" maxlength="128" /></td>
        </tr>`;
      }
      return `<tr>
        <td>${seq}</td>
        <td>${escapeHtml(String(r.version_label || ""))}</td>
        <td>${escapeHtml(String(r.commit_hash || ""))}</td>
      </tr>`;
    })
    .join("");

  const hotfixRowsSrc = state.versionHotfixEditMode ? state.versionHotfixDraft : state.versionHotfixList;
  const hotfixVisibleAll = filterVersionHotfixRows(hotfixRowsSrc || [], state.versionHotfixSearch);
  const hotfixPg = clampListPage(hotfixVisibleAll.length, state.versionHotfixListPage, state.versionHotfixListPageSize);
  if (hotfixPg.currentPage !== state.versionHotfixListPage) state.versionHotfixListPage = hotfixPg.currentPage;
  const hotfixVisible = sliceForListPage(hotfixVisibleAll, hotfixPg.currentPage, hotfixPg.pageSize);
  const hotfixPaginationHtml = renderListPaginationHtml({
    wrapId: "version-hotfix-pagination",
    totalItems: hotfixPg.totalItems,
    currentPage: hotfixPg.currentPage,
    totalPages: hotfixPg.totalPages,
    pageSize: hotfixPg.pageSize,
    pageSizeSelectId: "version-hotfix-page-size",
    prevId: "version-hotfix-page-prev",
    nextId: "version-hotfix-page-next",
  });
  const hotfixHead = state.versionHotfixEditMode
    ? `<tr><th class="version-row-check" scope="col"><input type="checkbox" id="version-hotfix-check-all" title="全选当前列表" aria-label="全选当前列表" /></th><th>序号</th><th>基线版本</th><th>热补丁版本</th></tr>`
    : `<tr><th>序号</th><th>基线版本</th><th>热补丁版本</th></tr>`;
  const hotfixColCount = state.versionHotfixEditMode ? 4 : 3;
  const hotfixBody = hotfixVisible
    .map((r, vi) => {
      const seq = (hotfixPg.currentPage - 1) * hotfixPg.pageSize + vi + 1;
      const baselineText = formatBaselinePickLabel({
        version_label: r.baseline_version_label,
        commit_hash: r.baseline_commit_hash,
      });
      const idAttr = r.id != null ? String(r.id) : "";
      const ckey = r.clientKey || "";
      if (state.versionHotfixEditMode) {
        const opts = bases
          .map((b) => {
            const id = Number(b.id);
            const sel = Number(r.baseline_id) === id ? "selected" : "";
            return `<option value="${id}" ${sel}>${escapeHtml(formatBaselinePickLabel(b))}</option>`;
          })
          .join("");
        const selectHtml = bases.length
          ? `<select class="admin-table-inline" data-vh-field="baseline_id" data-vh-id="${escapeAttr(idAttr)}" data-vh-ckey="${escapeAttr(ckey)}">${opts}</select>`
          : `<span class="duty-field-hint">请先在「基线版本」中维护数据</span>`;
        return `<tr>
          <td class="version-row-check"><input type="checkbox" data-vh-check data-vh-id="${escapeAttr(idAttr)}" data-vh-ckey="${escapeAttr(ckey)}" /></td>
          <td>${seq}</td>
          <td>${selectHtml}</td>
          <td><input type="text" class="admin-table-inline" data-vh-field="hotfix_label" data-vh-id="${escapeAttr(idAttr)}" data-vh-ckey="${escapeAttr(ckey)}" value="${escapeAttr(String(r.hotfix_label || ""))}" maxlength="256" /></td>
        </tr>`;
      }
      return `<tr>
        <td>${seq}</td>
        <td>${escapeHtml(baselineText)}</td>
        <td>${escapeHtml(String(r.hotfix_label || ""))}</td>
      </tr>`;
    })
    .join("");

  const baselineTable =
    baselineBody ||
    `<tr><td colspan="${baselineColCount}">${loading ? "加载中…" : state.versionBaselineSearch.trim() ? "无匹配行" : "暂无数据"}</td></tr>`;
  const hotfixTable =
    hotfixBody ||
    `<tr><td colspan="${hotfixColCount}">${loading ? "加载中…" : state.versionHotfixSearch.trim() ? "无匹配行" : "暂无数据"}</td></tr>`;
  const baselineEmpty = !baselineVisibleAll.length;
  const hotfixEmpty = !hotfixVisibleAll.length;

  const baselineHeadActions =
    sub === "baseline" && canEditVersion
      ? `
        <button type="button" class="action" id="version-baseline-toggle-edit">${state.versionBaselineEditMode ? "退出编辑" : "编辑"}</button>
        ${
          state.versionBaselineEditMode
            ? `<button type="button" class="action" id="version-baseline-add-row" ${saving ? "disabled" : ""}>新增行</button>
        <button type="button" class="action danger" id="version-baseline-delete-selected" ${saving ? "disabled" : ""}>删除</button>
        <button type="button" class="action primary" id="version-baseline-save" ${saving ? "disabled" : ""}>${state.versionBaselineSaving ? "保存中…" : "保存"}</button>`
            : ""
        }
      `
      : "";
  const hotfixHeadActions =
    sub === "hotfix" && canEditVersion
      ? `
        <button type="button" class="action" id="version-hotfix-toggle-edit">${state.versionHotfixEditMode ? "退出编辑" : "编辑"}</button>
        ${
          state.versionHotfixEditMode
            ? `<button type="button" class="action" id="version-hotfix-add-row" ${saving ? "disabled" : ""}>新增行</button>
        <button type="button" class="action danger" id="version-hotfix-delete-selected" ${saving ? "disabled" : ""}>删除</button>
        <button type="button" class="action primary" id="version-hotfix-save" ${saving ? "disabled" : ""}>${state.versionHotfixSaving ? "保存中…" : "保存"}</button>`
            : ""
        }
      `
      : "";
  const detailActionsHtml = sub === "baseline" ? baselineHeadActions : hotfixHeadActions;

  const baselineBlock = `
    <div class="version-params-toolbar">
      <input type="search" id="version-search-baseline" class="filter-search version-params-search" placeholder="搜索版本或 commit…" value="${escapeAttr(state.versionBaselineSearch || "")}" />
    </div>
    <div class="oplog-table-wrap">
      <table class="oplog-table admin-table">
        <thead>${baselineHead}</thead>
        <tbody>${baselineTable}</tbody>
      </table>
      ${baselineEmpty ? "" : baselinePaginationHtml}
    </div>`;

  const hotfixBlock = `
    <div class="version-params-toolbar">
      <input type="search" id="version-search-hotfix" class="filter-search version-params-search" placeholder="搜索热补丁或基线…" value="${escapeAttr(state.versionHotfixSearch || "")}" />
    </div>
    <div class="oplog-table-wrap">
      <table class="oplog-table admin-table">
        <thead>${hotfixHead}</thead>
        <tbody>${hotfixTable}</tbody>
      </table>
      ${hotfixEmpty ? "" : hotfixPaginationHtml}
    </div>`;

  return `
    <section class="detail-card detail-card-inline params-config-page version-params-page" id="version-params-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions detail-actions--version">${detailActionsHtml}</div>
      </div>
      <div class="version-params-subtabs">
        <button type="button" class="action ${sub === "baseline" ? "primary" : ""}" data-version-sub="baseline">基线版本</button>
        <button type="button" class="action ${sub === "hotfix" ? "primary" : ""}" data-version-sub="hotfix">热补丁版本</button>
      </div>
      ${msg}
      ${sub === "baseline" ? baselineBlock : hotfixBlock}
    </section>
  `;
}

export function renderParamsPage() {
  const title = getParamsPageHeadline(state.activeKey);
  if (state.activeKey === "params:version") {
    return renderVersionParamsPageHtml(title);
  }
  if (state.activeKey === "params:group-template") {
    return renderGroupTemplatePageHtml(title);
  }
  if (state.activeKey === "params:issue-root-cause") {
    return renderIssueRootCausePageHtml(title);
  }
  if (state.activeKey === "params:llm-config") {
    return renderLlmConfigPageHtml(title);
  }
  if (state.activeKey === "params:qi-config") {
    return renderQiConfigPageHtml(title);
  }
  if (state.activeKey !== "params:duty-field") {
    const intro = "该参数子页尚未接入。";
    return `
    <section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
      </div>
      <p class="params-page-intro">${escapeHtml(intro)}</p>
    </section>
  `;
  }

  const loading = state.dutyFieldTreeLoading;
  const saving = state.dutyFieldTreeSaving;
  const admin = whitelistAllows("params_duty_field_edit", "readonly");
  const edit = state.dutyFieldEditMode && admin;
  const msg = state.dutyFieldTreeMsg
    ? `<p class="duty-field-banner duty-field-banner--err">${escapeHtml(state.dutyFieldTreeMsg)}</p>`
    : "";
  let body = "";
  if (loading && !state.dutyFieldTree.length) {
    body = '<p class="duty-field-hint">正在从服务器加载…</p>';
  } else if (!state.dutyFieldTree.length) {
    body = '<p class="duty-field-hint">暂无数据。</p>';
  } else {
    body = `${loading ? '<p class="duty-field-hint">刷新中…</p>' : ""}<ul class="duty-field-ul duty-field-ul-root">${renderDutyFieldTreeInnerHtml(state.dutyFieldTree, "", edit)}</ul>`;
  }

  const busy = loading || saving;
  let actions = "";
  if (admin && !loading) {
    if (!state.dutyFieldEditMode) {
      actions = `<button type="button" class="action primary" id="duty-field-edit-btn" ${busy ? "disabled" : ""}>编辑</button>`;
    } else {
      actions = `
          <button type="button" class="action primary" id="duty-field-done-btn" ${busy ? "disabled" : ""}>${saving ? "保存中…" : "完成"}</button>
          <button type="button" class="action" id="duty-field-cancel-btn" ${busy ? "disabled" : ""}>取消</button>
          <button type="button" class="action" id="duty-field-add-root-btn" ${busy ? "disabled" : ""}>添加根节点</button>`;
    }
  }

  return `
    <section class="detail-card detail-card-inline params-config-page" id="duty-field-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">${actions}</div>
      </div>
      ${msg}
      ${body}
    </section>
  `;
}

export async function refreshVersionParamsData() {
  state.versionBaselineLoading = true;
  state.versionHotfixLoading = true;
  state.versionMsg = "";
  requestRender();
  const op = getCurrentOperator();
  try {
    const [bResp, hResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/params/baseline-versions?operator_id=${encodeURIComponent(op.account)}`),
      fetch(`${API_BASE_URL}/api/params/hotfix-versions?operator_id=${encodeURIComponent(op.account)}`),
    ]);
    const bJson = await bResp.json().catch(() => ({}));
    const hJson = await hResp.json().catch(() => ({}));
    if (!bResp.ok) {
      const d = bJson.detail != null ? String(bJson.detail) : `HTTP ${bResp.status}`;
      state.versionMsg = bResp.status === 503 ? d : `基线列表：${d}`;
      state.versionBaselineList = [];
    } else {
      state.versionBaselineList = Array.isArray(bJson.items) ? bJson.items : [];
    }
    if (!hResp.ok) {
      const d = hJson.detail != null ? String(hJson.detail) : `HTTP ${hResp.status}`;
      if (!state.versionMsg) state.versionMsg = hResp.status === 503 ? d : `热补丁列表：${d}`;
      state.versionHotfixList = [];
    } else {
      state.versionHotfixList = Array.isArray(hJson.items) ? hJson.items : [];
    }
  } catch (_e) {
    state.versionMsg = "版本数据加载失败（网络异常）";
    state.versionBaselineList = [];
    state.versionHotfixList = [];
  } finally {
    state.versionBaselineLoading = false;
    state.versionHotfixLoading = false;
    requestRender();
  }
}

export function versionFindBaselineDraftRow(idAttr, clientKey) {
  const d = state.versionBaselineDraft;
  if (!d) return null;
  if (idAttr != null && String(idAttr).trim() !== "") {
    const n = Number(idAttr);
    if (Number.isFinite(n)) return d.find((r) => r.id === n) ?? null;
  }
  const ck = String(clientKey || "");
  return d.find((r) => !r.id && r.clientKey === ck) ?? null;
}

export function versionFindHotfixDraftRow(idAttr, clientKey) {
  const d = state.versionHotfixDraft;
  if (!d) return null;
  if (idAttr != null && String(idAttr).trim() !== "") {
    const n = Number(idAttr);
    if (Number.isFinite(n)) return d.find((r) => r.id === n) ?? null;
  }
  const ck = String(clientKey || "");
  return d.find((r) => !r.id && r.clientKey === ck) ?? null;
}

// ===================================================================
// QI 候选人管理（参数配置子页：params:qi-candidates）
// ===================================================================
async function fetchQiCandidatesList(kind) {
  state.qiCandidatesLoading = true;
  requestRender();
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/qi/candidates/${kind}?operator_id=${encodeURIComponent(op.account)}`);
    const d = r.ok ? await r.json() : { candidates: [] };
    const list = (d.candidates || []).map(c => c.account);
    if (kind === "reviewer") state.qiCandidatesReviewer = list;
    else state.qiCandidatesAnalyst = list;
  } catch (_) {
    if (kind === "reviewer") state.qiCandidatesReviewer = [];
    else state.qiCandidatesAnalyst = [];
  }
  state.qiCandidatesLoading = false;
  requestRender();
}

export function renderQiCandidatesPageHtml(title) {
  const tab = state.qiCandidatesTab || "reviewer";
  const list = tab === "reviewer" ? (state.qiCandidatesReviewer || []) : (state.qiCandidatesAnalyst || []);
  const loading = state.qiCandidatesLoading;
  const saving = state.qiCandidatesSaving;
  const edit = state.qiCandidatesEditMode;
  const draft = state.qiCandidatesDraft || [];
  const users = state.adminUsers || [];

  const tabsHtml = `
    <div class="req-tabs">
      <button type="button" class="req-tab ${tab === "reviewer" ? "active" : ""}" data-qi-candidates-tab="reviewer">评审人候选</button>
      <button type="button" class="req-tab ${tab === "analyst" ? "active" : ""}" data-qi-candidates-tab="analyst">分析人候选</button>
    </div>`;

  let body = "";
  if (loading) {
    body = '<p style="padding:24px;color:#64748b">加载中…</p>';
  } else if (edit) {
    const draftSet = new Set(draft);
    const searchTerm = (state.qiCandidatesSearch || "").trim().toLowerCase();
    const filtered = searchTerm
      ? users.filter(u => (u.account || "").toLowerCase().includes(searchTerm) || (u.user_name || "").toLowerCase().includes(searchTerm))
      : users;
    const rows = filtered.map(u => {
      const checked = draftSet.has(u.account);
      return `<label class="qi-candidate-checkbox"><input type="checkbox" ${checked ? "checked" : ""} data-qi-candidate-account="${escapeAttr(u.account)}"> ${escapeHtml(u.user_name || u.account)} <span class="qi-candidate-account">${escapeHtml(u.account)}</span></label>`;
    }).join("");
    body = `
      <div class="qi-candidates-edit-bar">
        <input type="search" id="qi-candidates-search" class="req-search-input" placeholder="搜索用户…" value="${escapeAttr(searchTerm)}">
        <span class="qi-candidates-count">已选 ${draft.length} 人</span>
      </div>
      <div class="qi-candidates-checklist">${rows || '<p style="color:#94a3b8">无匹配用户</p>'}</div>
      <div class="qi-candidates-actions">
        <button type="button" class="action" id="qi-candidates-cancel-btn">取消</button>
        <button type="button" class="action primary" id="qi-candidates-save-btn" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
      </div>`;
  } else {
    if (!list.length) {
      body = '<p style="padding:24px;color:#94a3b8">暂无候选人</p>';
    } else {
      const userMap = new Map(users.map(u => [u.account, u]));
      const items = list.map(acc => {
        const u = userMap.get(acc);
        const name = u ? u.user_name : acc;
        return `<div class="qi-candidate-item"><span>${escapeHtml(name)} <span class="qi-candidate-account">${escapeHtml(acc)}</span></span></div>`;
      }).join("");
      body = `<div class="qi-candidates-list">${items}</div>`;
    }
  }

  return `
    <section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        ${!edit ? `<button type="button" class="action primary" id="qi-candidates-edit-btn">编辑</button>` : ""}
      </div>
      ${tabsHtml}
      ${body}
    </section>`;
}

export function bindQiCandidatesParamsPage() {
  if (state.qiCandidatesNeedsRefresh) {
    state.qiCandidatesNeedsRefresh = false;
    fetchQiCandidatesList(state.qiCandidatesTab || "reviewer");
  }

  // Tab switch
  document.querySelectorAll("[data-qi-candidates-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-qi-candidates-tab");
      if (!t || t === state.qiCandidatesTab) return;
      state.qiCandidatesTab = t;
      state.qiCandidatesEditMode = false;
      state.qiCandidatesDraft = [];
      state.qiCandidatesSearch = "";
      fetchQiCandidatesList(t);
    });
  });

  // Edit button
  document.getElementById("qi-candidates-edit-btn")?.addEventListener("click", () => {
    const current = state.qiCandidatesTab === "reviewer" ? state.qiCandidatesReviewer : state.qiCandidatesAnalyst;
    state.qiCandidatesDraft = [...(current || [])];
    state.qiCandidatesSearch = "";
    state.qiCandidatesEditMode = true;
    requestRender();
  });

  // Cancel
  document.getElementById("qi-candidates-cancel-btn")?.addEventListener("click", () => {
    state.qiCandidatesEditMode = false;
    state.qiCandidatesDraft = [];
    state.qiCandidatesSearch = "";
    requestRender();
  });

  // Search
  const si = document.getElementById("qi-candidates-search");
  si?.addEventListener("input", (ev) => {
    state.qiCandidatesSearch = ev.target.value;
    requestRender();
  });

  // Checkbox toggle
  document.querySelectorAll("[data-qi-candidate-account]").forEach(cb => {
    cb.addEventListener("change", () => {
      const acc = cb.getAttribute("data-qi-candidate-account");
      const draft = [...(state.qiCandidatesDraft || [])];
      if (cb.checked && !draft.includes(acc)) draft.push(acc);
      else if (!cb.checked) {
        const idx = draft.indexOf(acc);
        if (idx >= 0) draft.splice(idx, 1);
      }
      state.qiCandidatesDraft = draft;
    });
  });

  // Save
  document.getElementById("qi-candidates-save-btn")?.addEventListener("click", async () => {
    const kind = state.qiCandidatesTab || "reviewer";
    const op = getCurrentOperator();
    state.qiCandidatesSaving = true;
    requestRender();
    try {
      const r = await fetch(`${API_BASE_URL}/api/qi/candidates/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account, accounts: state.qiCandidatesDraft }),
      });
      if (!r.ok) { window.alert(`保存失败: ${await r.text()}`); return; }
      if (kind === "reviewer") state.qiCandidatesReviewer = [...state.qiCandidatesDraft];
      else state.qiCandidatesAnalyst = [...state.qiCandidatesDraft];
      state.qiCandidatesEditMode = false;
      state.qiCandidatesDraft = [];
      state.qiCandidatesSearch = "";
    } finally { state.qiCandidatesSaving = false; requestRender(); }
  });
}

// ===================================================================
// QI 闭环进展配置（参数配置子页：params:qi-closure-progress）
// ===================================================================
export function renderQiClosureProgressPageHtml(title) {
  // 触发加载（如未缓存）
  if (!window._qiClosureProgressCache) {
    fetch(`${API_BASE_URL}/api/qi/config/closure-progress?operator_id=admin`).then(r => r.json()).then(cfg => {
      window._qiClosureProgressCache = cfg; requestRender();
    }).catch(() => {});
  }
  const cfg = window._qiClosureProgressCache || { progress: {} };
  const progress = cfg.progress || {};
  const methods = ["需求闭环", "问题单闭环"];
  const rows = methods.map(m => {
    const stages = progress[m] || [];
    const stageInputs = stages.map((s, i) =>
      `<div style="display:flex;gap:8px;align-items:center;padding:2px 0"><input type="text" value="${escapeAttr(s)}" data-progress-method="${escapeAttr(m)}" data-progress-idx="${i}" class="req-input" style="flex:1" /><button type="button" class="action" data-del-progress="${escapeAttr(m)}:${i}" style="padding:2px 8px;font-size:12px">×</button></div>`
    ).join("");
    return `<div style="border:1px solid var(--border-color,#e5e7eb);border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:8px">${escapeHtml(m)}</div>
      ${stageInputs}
      <button type="button" class="action" data-add-progress="${escapeAttr(m)}" style="margin-top:4px;font-size:12px">+ 添加阶段</button>
    </div>`;
  }).join("");
  return `
    <section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}">
      <div class="detail-head"><h2>${escapeHtml(title)}</h2><button type="button" class="action primary" id="qi-closure-progress-save-btn">保存</button></div>
      <div id="qi-closure-progress-list">${rows}</div>
    </section>`;
}

export function bindQiClosureProgressParamsPage() {
  const container = document.querySelector(".params-config-page");
  if (!container || container.dataset.qiClosureBound === "1") return;
  container.dataset.qiClosureBound = "1";
  // 迁移旧数据
  document.getElementById("qi-migrate-btn")?.addEventListener("click", async () => {
    if (!window.confirm("确定将旧质量改进数据迁移到新系统？")) return;
    const btn = document.getElementById("qi-migrate-btn");
    const result = document.getElementById("qi-migrate-result");
    if (btn) btn.disabled = true;
    if (result) result.textContent = "迁移中…";
    try {
      const r = await fetch(`${API_BASE_URL}/api/qi/migrate-legacy`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: getCurrentOperator().account, force: true })
      });
      const d = await r.json();
      if (r.ok) { if (result) result.textContent = `迁移完成：${d.migrated} 条`; }
      else { if (result) result.textContent = "迁移失败"; window.alert(await r.text()); }
    } catch(e) { if (result) result.textContent = "迁移失败: " + (e.message||e); }
    finally { if (btn) btn.disabled = false; }
  });
  // 闭环进展保存
  document.getElementById("qi-closure-progress-save-btn")?.addEventListener("click", async () => {
    const progress = {};
    document.querySelectorAll("#qi-closure-progress-list [data-progress-method]").forEach(inp => {
      const method = inp.getAttribute("data-progress-method");
      const v = inp.value.trim();
      if (v) { progress[method] = progress[method] || []; progress[method].push(v); }
    });
    const r = await fetch(`${API_BASE_URL}/api/qi/config/closure-progress`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: "admin", progress })
    });
    if (!r.ok) { window.alert("保存失败"); return; }
    window._qiClosureProgressCache = { progress };
    window.alert("已保存");
  });
  // Delegate events
  document.getElementById("qi-closure-progress-list")?.addEventListener("click", ev => {
    const del = ev.target.closest("[data-del-progress]");
    if (del) { del.closest("div[style]")?.remove(); return; }
    const add = ev.target.closest("[data-add-progress]");
    if (add) {
      const m = add.getAttribute("data-add-progress");
      const div = document.createElement("div");
      div.style.cssText = "display:flex;gap:8px;align-items:center;padding:2px 0";
      div.innerHTML = `<input type="text" data-progress-method="${escapeAttr(m)}" class="req-input" style="flex:1" placeholder="阶段名称" /><button type="button" class="action" style="padding:2px 8px;font-size:12px">×</button>`;
      div.querySelector("button").addEventListener("click", () => div.remove());
      add.before(div);
    }
  });
}

// ===================================================================
// 质量改进配置（合并 QI白名单 + 闭环进展配置）
// ===================================================================
export function renderQiConfigPageHtml(title) {
  const tab = state.qiCandidatesTab || "reviewer";
  const list = tab === "reviewer" ? (state.qiCandidatesReviewer||[]) : (state.qiCandidatesAnalyst||[]);
  const loading = state.qiCandidatesLoading, saving = state.qiCandidatesSaving;
  const edit = state.qiCandidatesEditMode, draft = state.qiCandidatesDraft || [];
  const users = state.adminUsers || [];
  const tabsHtml = `
    <div class="req-tabs">
      <button type="button" class="req-tab ${tab==="reviewer"?"active":""}" data-qi-candidates-tab="reviewer">评审人</button>
      <button type="button" class="req-tab ${tab==="analyst"?"active":""}" data-qi-candidates-tab="analyst">分析人</button>
    </div>`;
  let body = "";
  if (loading) { body = '<p style="padding:24px;color:#64748b">加载中…</p>'; }
  else if (edit) {
    const draftSet = new Set(draft);
    const s = (state.qiCandidatesSearch||"").trim().toLowerCase();
    const filtered = s ? users.filter(u => (u.account||"").toLowerCase().includes(s) || (u.user_name||"").toLowerCase().includes(s)) : users;
    const allFilteredSelected = filtered.length > 0 && filtered.every(u => draftSet.has(u.account));
    const rows = filtered.map(u => `<label class="qi-candidate-checkbox"><input type="checkbox" ${draftSet.has(u.account)?"checked":""} data-qi-candidate-account="${escapeAttr(u.account)}"> ${escapeHtml(u.user_name||u.account)} <span class="qi-candidate-account">${escapeHtml(u.account)}</span></label>`).join("");
    body = `<div class="qi-candidates-edit-bar"><input type="search" id="qi-candidates-search" class="req-search-input" placeholder="搜索用户（回车或点击搜索）" value="${escapeAttr(state.qiCandidatesSearch || "")}"><button type="button" class="action" id="qi-candidates-search-btn">搜索</button><label class="qi-candidate-checkbox" style="white-space:nowrap"><input type="checkbox" id="qi-candidates-select-all" ${allFilteredSelected?"checked":""}> 全选</label><span class="qi-candidates-count">已选 ${draft.length} 人</span></div><div class="qi-candidates-checklist">${rows||'<p style="color:#94a3b8">无匹配用户</p>'}</div><div class="qi-candidates-actions"><button type="button" class="action" id="qi-candidates-cancel-btn">取消</button><button type="button" class="action primary" id="qi-candidates-save-btn" ${saving?"disabled":""}>${saving?"保存中…":"保存"}</button></div>`;
  } else {
    if (!list.length) { body = '<p style="padding:24px;color:#94a3b8">暂无</p>'; }
    else {
      const um = new Map(users.map(u => [u.account,u]));
      body = '<div class="qi-candidates-list">'+list.map(a => `<div class="qi-candidate-item"><span>${escapeHtml(um.get(a)?um.get(a).user_name:a)} <span class="qi-candidate-account">${escapeHtml(a)}</span></span></div>`).join("")+'</div>';
    }
  }

  const cfg = window._qiClosureProgressCache || { progress: {} };
  const progress = cfg.progress || {};
  const closureBody = ["需求闭环","问题单闭环"].map(m => {
    const stages = progress[m] || [];
    const inputs = stages.map((s,i) => `<div style="display:flex;gap:8px;align-items:center;padding:2px 0"><input type="text" value="${escapeAttr(s)}" data-progress-method="${escapeAttr(m)}" data-progress-idx="${i}" class="req-input" style="flex:1"><button type="button" class="action" data-del-progress="${escapeAttr(m)}:${i}" style="padding:2px 8px;font-size:12px">×</button></div>`).join("");
    return `<div style="border:1px solid var(--border-color,#e5e7eb);border-radius:8px;padding:12px;margin-bottom:12px"><div style="font-weight:600;margin-bottom:8px">${escapeHtml(m)}</div>${inputs}<button type="button" class="action" data-add-progress="${escapeAttr(m)}" style="margin-top:4px;font-size:12px">+ 添加阶段</button></div>`;
  }).join("");

  // 迁移属于「质量改进配置」页能力，与该页同锁 params_qi_candidates（不单独隔离到 requirement_create）：
  // 能进入/配置质量改进配置页的权限组即可见可用迁移
  const canMigrate = whitelistAllows("params_qi_candidates", "readonly", getCurrentWhitelistSettings());
  return `<section class="detail-card detail-card-inline params-config-page" aria-label="${escapeAttr(title)}">
    <div class="detail-head"><h2>${escapeHtml(title)}</h2></div>
    ${canMigrate ? `<div style="margin-bottom:16px;padding:12px;background:var(--bg-secondary,#f8fafc);border-radius:8px;border:1px solid var(--border-color,#e5e7eb)">
      <div style="font-weight:600;margin-bottom:4px">数据迁移</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px">将旧质量改进（requirement）数据迁移到新系统，统一导入到评审阶段</div>
      <button type="button" class="action primary" id="qi-migrate-btn">迁移旧数据</button>
      <span id="qi-migrate-result" style="margin-left:8px;font-size:12px;color:#64748b"></span>
    </div>` : ""}
    <h3 style="margin:0 0 8px;font-size:14px;font-weight:600">白名单</h3>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">${tabsHtml}${!edit?`<button type="button" class="action primary" id="qi-candidates-edit-btn">编辑</button>`:""}</div>
    ${body}
    <h3 style="margin:24px 0 8px;font-size:14px;font-weight:600">闭环进展</h3>
    <button type="button" class="action primary" id="qi-closure-progress-save-btn" style="margin-bottom:8px">保存</button>
    <div id="qi-closure-progress-list">${closureBody}</div>
  </section>`;
}

export function bindQiConfigParamsPage() {
  if (state.qiCandidatesNeedsRefresh) {
    state.qiCandidatesNeedsRefresh = false;
    state._qiConfigDataLoaded = false;
  }
  // 每次 render 都重新绑定事件（DOM 可能已被替换）
  const loadCandidates = (kind) => {
    if (state.qiCandidatesLoading) return;
    state.qiCandidatesLoading = true;
    const op = getCurrentOperator();
    fetch(`${API_BASE_URL}/api/qi/candidates/${kind}?operator_id=${encodeURIComponent(op.account)}`).then(r => r.json()).then(d => {
      const list = (d.candidates||[]).map(c => c.account);
      if (kind === "reviewer") state.qiCandidatesReviewer = list;
      else state.qiCandidatesAnalyst = list;
      state.qiCandidatesLoading = false;
      requestRender();
    }).catch(() => { state.qiCandidatesLoading = false; });
  };
  // 仅在首次进入时加载数据（避免无限循环）
  if (!state._qiConfigDataLoaded) {
    state._qiConfigDataLoaded = true;
    if (!state.qiCandidatesReviewer.length && !state.qiCandidatesAnalyst.length) {
      loadCandidates(state.qiCandidatesTab || "reviewer");
    }
    if (!window._qiClosureProgressCache) {
      fetch(`${API_BASE_URL}/api/qi/config/closure-progress?operator_id=admin`).then(r=>r.json()).then(cfg=>{window._qiClosureProgressCache=cfg;requestRender();}).catch(()=>{});
    }
    // 候选人名称映射与全选清单均依赖 user 列表；直接进入本页时按需补载
    if (!state.adminUsers || state.adminUsers.length === 0) {
      fetch(`${API_BASE_URL}/api/admin/users`).then(r => r.json()).then(u => {
        state.adminUsers = Array.isArray(u.items) ? u.items : [];
        requestRender();
      }).catch(() => {});
    }
  }

  document.querySelectorAll("[data-qi-candidates-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-qi-candidates-tab");
      if (!t || t === state.qiCandidatesTab) return;
      state.qiCandidatesTab = t; state.qiCandidatesEditMode = false; state.qiCandidatesDraft = []; state.qiCandidatesSearch = "";
      loadCandidates(t);
    });
  });
  document.getElementById("qi-candidates-edit-btn")?.addEventListener("click", () => {
    const cur = state.qiCandidatesTab === "reviewer" ? state.qiCandidatesReviewer : state.qiCandidatesAnalyst;
    state.qiCandidatesDraft = [...(cur||[])]; state.qiCandidatesSearch = ""; state.qiCandidatesEditMode = true; requestRender();
  });
  document.getElementById("qi-candidates-cancel-btn")?.addEventListener("click", () => {
    state.qiCandidatesEditMode = false; state.qiCandidatesDraft = []; state.qiCandidatesSearch = ""; requestRender();
  });
  // 搜索：仅记录输入，回车或点击「搜索」按钮才过滤（不逐字实时过滤）
  document.getElementById("qi-candidates-search")?.addEventListener("input", ev => { state.qiCandidatesSearch = ev.target.value; });
  document.getElementById("qi-candidates-search")?.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); requestRender(); } });
  document.getElementById("qi-candidates-search-btn")?.addEventListener("click", () => requestRender());
  document.querySelectorAll("[data-qi-candidate-account]").forEach(cb => {
    cb.addEventListener("change", () => {
      const acc = cb.getAttribute("data-qi-candidate-account");
      const draft = [...(state.qiCandidatesDraft||[])];
      if (cb.checked && !draft.includes(acc)) draft.push(acc);
      else if (!cb.checked) { const i = draft.indexOf(acc); if (i>=0) draft.splice(i,1); }
      state.qiCandidatesDraft = draft;
    });
  });
  document.getElementById("qi-candidates-select-all")?.addEventListener("change", ev => {
    const users = state.adminUsers || [];
    const s = (state.qiCandidatesSearch||"").trim().toLowerCase();
    const filtered = s ? users.filter(u => (u.account||"").toLowerCase().includes(s) || (u.user_name||"").toLowerCase().includes(s)) : users;
    const fset = new Set(filtered.map(u => u.account));
    let draft = [...(state.qiCandidatesDraft||[])];
    if (ev.target.checked) {
      filtered.forEach(u => { if (!draft.includes(u.account)) draft.push(u.account); });
    } else {
      draft = draft.filter(a => !fset.has(a));
    }
    state.qiCandidatesDraft = draft;
    requestRender();
  });
  document.getElementById("qi-candidates-save-btn")?.addEventListener("click", async () => {
    const kind = state.qiCandidatesTab||"reviewer"; const op = getCurrentOperator();
    state.qiCandidatesSaving = true; requestRender();
    try {
      const r = await fetch(`${API_BASE_URL}/api/qi/candidates/${kind}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operator_id:op.account,accounts:state.qiCandidatesDraft})});
      if (!r.ok) { window.alert("保存失败: "+await r.text()); return; }
      if (kind==="reviewer") state.qiCandidatesReviewer=[...state.qiCandidatesDraft]; else state.qiCandidatesAnalyst=[...state.qiCandidatesDraft];
      state.qiCandidatesEditMode=false; state.qiCandidatesDraft=[]; state.qiCandidatesSearch="";
    } finally { state.qiCandidatesSaving=false; requestRender(); }
  });

  document.getElementById("qi-closure-progress-save-btn")?.addEventListener("click", async () => {
    const progress = {};
    document.querySelectorAll("#qi-closure-progress-list [data-progress-method]").forEach(inp => {
      const m = inp.getAttribute("data-progress-method"); const v = inp.value.trim();
      if(v){progress[m]=progress[m]||[];progress[m].push(v);}
    });
    const r = await fetch(`${API_BASE_URL}/api/qi/config/closure-progress`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operator_id:"admin",progress})});
    if(!r.ok){window.alert("保存失败");return;}
    window._qiClosureProgressCache={progress};window.alert("已保存");
  });
  document.getElementById("qi-closure-progress-list")?.addEventListener("click", ev => {
    const del=ev.target.closest("[data-del-progress]"); if(del){del.closest("div[style]")?.remove();return;}
    const add=ev.target.closest("[data-add-progress]"); if(add){
      const m=add.getAttribute("data-add-progress"); const div=document.createElement("div");
      div.style.cssText="display:flex;gap:8px;align-items:center;padding:2px 0";
      div.innerHTML=`<input type="text" data-progress-method="${escapeAttr(m)}" class="req-input" style="flex:1" placeholder="阶段名称"><button type="button" class="action" style="padding:2px 8px;font-size:12px">×</button>`;
      div.querySelector("button").addEventListener("click",()=>div.remove()); add.before(div);
    }
  });

  // 迁移旧数据
  document.getElementById("qi-migrate-btn")?.addEventListener("click", async () => {
    if (!window.confirm("确定将旧质量改进数据迁移到新系统？")) return;
    const btn = document.getElementById("qi-migrate-btn");
    const result = document.getElementById("qi-migrate-result");
    if (btn) btn.disabled = true;
    if (result) result.textContent = "迁移中…";
    try {
      const r = await fetch(`${API_BASE_URL}/api/qi/migrate-legacy`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: getCurrentOperator().account, force: true })
      });
      const d = await r.json();
      if (r.ok) { if (result) result.textContent = `迁移完成：${d.migrated} 条`; }
      else { if (result) result.textContent = "迁移失败"; }
    } catch(e) { if (result) result.textContent = "迁移失败"; }
    finally { if (btn) btn.disabled = false; }
  });
}
