import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { dutyFieldNodeAtPath } from "./duty.js";

export const RESEARCH_DUTY_FIELD_KEY = "params_research_duty_field";

function normalizeResearchDutyFieldItem(x) {
  const o = x && typeof x === "object" ? x : {};
  const id = Number(o.id);
  return {
    id: Number.isFinite(id) ? id : null,
    name: String(o.name || "").trim(),
    owner: String(o.owner || "").trim(),
    scopes: (Array.isArray(o.scopes) ? o.scopes : []).map((sc) => ({
      domain: String((sc && sc.domain) || "").trim(),
      module: String((sc && sc.module) || "").trim(),
    })),
  };
}

export async function fetchResearchDutyFieldFromServer() {
  state.researchDutyFieldLoading = true;
  state.researchDutyFieldMsg = "";
  requestRender();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/research-duty-field`);
    const tx = await resp.text();
    let data = {};
    try {
      data = JSON.parse(tx);
    } catch (_) {
      data = {};
    }
    const detail = String(data.detail || data.message || tx || "").trim();
    if (!resp.ok) {
      // 拉取失败保留旧 items：只读列表不该因一次失败被清成空白（首次加载 items 本就是空数组）
      state.researchDutyFieldMsg = detail || `加载失败：${resp.status}`;
      return;
    }
    state.researchDutyFieldItems = (Array.isArray(data.items) ? data.items : []).map(normalizeResearchDutyFieldItem);
    state.researchDutyFieldMsg = "";
  } catch (e) {
    // 同上：网络异常也不清空已有列表，横幅提示即可
    state.researchDutyFieldMsg = `加载失败（网络异常）：${String(e?.message || e)}`;
  } finally {
    state.researchDutyFieldLoading = false;
    requestRender();
  }
}

function syncDraftRowsFromDom(panel, draft) {
  panel.querySelectorAll("[data-rdf-row]").forEach((rowEl) => {
    const idx = Number(rowEl.getAttribute("data-rdf-index"));
    if (!Number.isFinite(idx) || !draft[idx]) return;
    const name = rowEl.querySelector("[data-rdf-name]");
    const owner = rowEl.querySelector("[data-rdf-owner]");
    draft[idx].name = String(name?.value || "").trim();
    draft[idx].owner = String(owner?.value || "").trim();
  });
}

function validateResearchDutyFieldDraft(draft) {
  const seen = new Set();
  for (const row of draft || []) {
    if (!row.name) return { ok: false, message: "在研责任田名称不能为空" };
    // 目录内名称唯一：树节点弹窗按名称下拉选择，重名无法区分
    if (seen.has(row.name)) return { ok: false, message: `在研责任田名称重复：${row.name}` };
    seen.add(row.name);
  }
  return { ok: true };
}

export async function saveResearchDutyFieldDraftToServer() {
  if (!whitelistAllows(RESEARCH_DUTY_FIELD_KEY, "readonly") || !state.researchDutyFieldDraft) return;
  const panel = document.getElementById("research-duty-field-panel");
  if (panel) syncDraftRowsFromDom(panel, state.researchDutyFieldDraft);
  const check = validateResearchDutyFieldDraft(state.researchDutyFieldDraft);
  if (!check.ok) {
    window.alert(check.message);
    return;
  }
  const op = getCurrentOperator();
  state.researchDutyFieldSaving = true;
  state.researchDutyFieldMsg = "";
  requestRender();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/params/research-duty-field`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // 目录维护（带 id 全量替换）：只提交 名称/责任人；关联由树节点「在研」弹窗经 /binding 维护
      body: JSON.stringify({
        operator_id: op.account,
        items: (state.researchDutyFieldDraft || []).map((row) => ({ id: row.id ?? null, name: row.name, owner: row.owner })),
      }),
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
      state.researchDutyFieldMsg = detail || `保存失败：${resp.status}`;
      return;
    }
    state.researchDutyFieldItems = (Array.isArray(data.items) ? data.items : []).map(normalizeResearchDutyFieldItem);
    state.researchDutyFieldDraft = null;
    state.researchDutyFieldEditMode = false;
    state.researchDutyFieldMsg = "在研责任田已保存";
  } catch (e) {
    state.researchDutyFieldMsg = String(e?.message || e);
  } finally {
    state.researchDutyFieldSaving = false;
    requestRender();
  }
}

function researchFieldScopeText(row) {
  const scopes = Array.isArray(row?.scopes) ? row.scopes : [];
  if (!scopes.length) return "未关联（在责任田树节点上配置）";
  return scopes
    .map((sc) => {
      const domain = String(sc.domain || "").trim();
      const module_ = String(sc.module || "").trim();
      return module_ ? `${domain}/${module_}` : `${domain}（整领域）`;
    })
    .join("、");
}

function renderReadonlyRows(items) {
  if (!items.length) {
    return `<p class="duty-field-hint">暂无在研责任田，请点击编辑添加。</p>`;
  }
  const rows = items
    .map(
      (row) => `
    <div class="research-field-row research-field-row--read">
      <span class="research-field-name">${escapeHtml(row.name || "—")}</span>
      <span class="research-field-scope">${escapeHtml(researchFieldScopeText(row))}</span>
      <span class="research-field-owner">责任人：${escapeHtml(row.owner || "—")}</span>
    </div>`,
    )
    .join("");
  return `<div class="research-field-list">${rows}</div>`;
}

function renderEditRows(draft) {
  const rows = (draft || [])
    .map(
      (row, idx) => `
    <div class="research-field-row" data-rdf-row data-rdf-index="${idx}">
      <input type="text" class="research-field-input" data-rdf-name value="${escapeAttr(row.name)}" placeholder="在研责任田名称" maxlength="256" />
      <input type="text" class="research-field-input research-field-input--owner" data-rdf-owner value="${escapeAttr(row.owner)}" placeholder="责任人" maxlength="256" />
      <span class="research-field-scope">${escapeHtml(researchFieldScopeText(row))}</span>
      <button type="button" class="action danger" data-rdf-remove="${idx}" title="删除">删除</button>
    </div>`,
    )
    .join("");
  return `
    <div class="research-field-list">${rows || `<p class="duty-field-hint">请添加在研责任田。</p>`}</div>
    <button type="button" class="action" id="rdf-add-row">＋添加在研责任田</button>`;
}

export function renderResearchDutyFieldPageHtml(title) {
  const admin = whitelistAllows(RESEARCH_DUTY_FIELD_KEY, "readonly");
  const loading = state.researchDutyFieldLoading;
  const saving = state.researchDutyFieldSaving;
  const edit = state.researchDutyFieldEditMode && admin;
  const items = state.researchDutyFieldItems || [];
  const msg = state.researchDutyFieldMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|未就绪|迁移/.test(state.researchDutyFieldMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.researchDutyFieldMsg)}</p>`
    : "";
  let actions = "";
  if (admin) {
    if (!edit) {
      actions = `<button type="button" class="action primary" id="research-duty-field-edit-btn" ${loading || saving ? "disabled" : ""}>编辑</button>`;
    } else {
      actions = `<button type="button" class="action primary" id="research-duty-field-save-btn" ${loading || saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        <button type="button" class="action" id="research-duty-field-cancel-btn" ${loading || saving ? "disabled" : ""}>取消</button>`;
    }
  } else {
    actions = `<span class="duty-field-hint">当前权限不可编辑并保存。</span>`;
  }

  let body = "";
  if (loading && !items.length) {
    body = `<p class="duty-field-hint">正在从服务器加载…</p>`;
  } else if (edit) {
    // 任何来源的重渲染（rAF 帧）重建行前，先收割旧 DOM 里已填的文本值，杜绝丢输入的时序窗口
    const livePanel = document.getElementById("research-duty-field-panel");
    if (livePanel && state.researchDutyFieldDraft) {
      harvestEditTextInputsIntoDraft(livePanel, state.researchDutyFieldDraft);
    }
    body = renderEditRows(state.researchDutyFieldDraft);
  } else {
    body = renderReadonlyRows(items);
  }

  return `
    <section class="detail-card detail-card-inline params-config-page research-duty-field-page" id="research-duty-field-panel" aria-label="${escapeAttr(title)}">
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-actions">${actions}</div>
      </div>
      ${msg}
      ${body}
      <p class="duty-field-hint">在研责任田用于质量改进分析的按田统计。此处维护田目录（名称/责任人）；「领域/模块」关联在责任田树节点的「在研」按钮下拉配置，不同模块可关联同一个田（统计按田合并）。</p>
    </section>
  `;
}

function syncEditRowsFromLiveDom() {
  // 异步回调（列表刷新等）触发的重渲染前，先把当前 DOM 里的编辑行同步进 draft，
  // 否则 rAF 重绘会用未同步的 draft 重建行，丢掉用户已填的名称/责任人。
  if (!state.researchDutyFieldEditMode || !state.researchDutyFieldDraft) return;
  const livePanel = document.getElementById("research-duty-field-panel");
  if (livePanel) syncDraftRowsFromDom(livePanel, state.researchDutyFieldDraft);
}

function harvestEditTextInputsIntoDraft(panel, draft) {
  // 渲染期收割：重绘前从仍在文档里的旧编辑行回收「名称/责任人」文本值。
  // 只收文本输入——select 的变更由各自 change 监听同步，此处回灌会撤销「领域切换清模块」等修正；
  // 行数一致才收——刚增/删行后长度不等，旧 DOM 下标与新 draft 错位，跳过以免覆盖。
  const liveRows = panel.querySelectorAll("[data-rdf-row]");
  if (liveRows.length !== draft.length) return;
  liveRows.forEach((rowEl) => {
    const idx = Number(rowEl.getAttribute("data-rdf-index"));
    if (!Number.isFinite(idx) || !draft[idx]) return;
    const name = rowEl.querySelector("[data-rdf-name]");
    const owner = rowEl.querySelector("[data-rdf-owner]");
    if (name) draft[idx].name = String(name.value || "").trim();
    if (owner) draft[idx].owner = String(owner.value || "").trim();
  });
}

export function bindResearchDutyFieldParamsPage() {
  if (state.researchDutyFieldNeedsRefresh) {
    state.researchDutyFieldNeedsRefresh = false;
    void fetchResearchDutyFieldFromServer().then(() => { syncEditRowsFromLiveDom(); requestRender(); });
  }

  const panel = document.getElementById("research-duty-field-panel");
  if (!panel) return;

  panel.querySelector("#research-duty-field-edit-btn")?.addEventListener("click", () => {
    if (!whitelistAllows(RESEARCH_DUTY_FIELD_KEY, "readonly")) return;
    if (state.researchDutyFieldLoading) return;
    // 先拉最新再进编辑：PUT 是全量替换，若首屏加载失败（items 误为空）直接编辑保存会把全表清空。
    state.researchDutyFieldLoading = true;
    state.researchDutyFieldMsg = "";
    requestRender();
    void fetchResearchDutyFieldFromServer().then(() => {
      // 拉取失败（Msg 非空）不进编辑，横幅展示错误；成功则 Msg 必为 ""
      if (state.researchDutyFieldMsg) {
        requestRender();
        return;
      }
      state.researchDutyFieldEditMode = true;
      state.researchDutyFieldDraft = (state.researchDutyFieldItems || []).map((row) => ({ ...row, scopes: [...(row.scopes || [])] }));
      state.researchDutyFieldMsg = "";
      requestRender();
    });
  });

  panel.querySelector("#research-duty-field-cancel-btn")?.addEventListener("click", () => {
    state.researchDutyFieldEditMode = false;
    state.researchDutyFieldDraft = null;
    state.researchDutyFieldMsg = "";
    void fetchResearchDutyFieldFromServer().then(() => requestRender());
  });

  panel.querySelector("#research-duty-field-save-btn")?.addEventListener("click", () => void saveResearchDutyFieldDraftToServer());

  const draft =
    state.researchDutyFieldEditMode && whitelistAllows(RESEARCH_DUTY_FIELD_KEY, "readonly")
      ? state.researchDutyFieldDraft
      : null;
  if (!draft) return;

  panel.querySelector("#rdf-add-row")?.addEventListener("click", () => {
    syncDraftRowsFromDom(panel, draft);
    draft.push({ id: null, name: "", owner: "", scopes: [] });
    requestRender();
  });

  panel.querySelectorAll("[data-rdf-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncDraftRowsFromDom(panel, draft);
      const idx = Number(btn.getAttribute("data-rdf-remove"));
      if (!Number.isFinite(idx)) return;
      draft.splice(idx, 1);
      requestRender();
    });
  });

  // 名称/责任人输入即时同步进 draft：编辑行期间任何来源的重渲染
  // （rAF 帧从 draft 重建行）都不会丢掉已填的值。监听器同步执行，早于其后任何渲染帧。
  panel.querySelectorAll("[data-rdf-name], [data-rdf-owner]").forEach((inp) => {
    inp.addEventListener("input", () => syncDraftRowsFromDom(panel, draft));
  });
}

/** 树节点槽位 (domain, module) 当前绑定的田；返回田条目或 null（module 空=整领域槽位）。 */
export function researchFieldRowFor(domain, module) {
  const d = String(domain || "").trim();
  const m = String(module || "").trim();
  if (!d) return null;
  return (
    (state.researchDutyFieldItems || []).find((row) =>
      (row.scopes || []).some(
        (sc) => String(sc.domain || "").trim() === d && String(sc.module || "").trim() === m,
      ),
    ) || null
  );
}

/** 树节点槽位的生效田：自身槽位 → 逐级父路径槽位 → 整领域槽位（与统计侧前缀匹配口径一致）。
 * 返回 { row, inherited } 或 null；inherited=true 表示命中的是上级槽位（角标标「继承」）。 */
export function researchFieldRowEffectiveFor(domain, module) {
  const own = String(module || "").trim();
  let m = own;
  for (;;) {
    const row = researchFieldRowFor(domain, m);
    if (row) return { row, inherited: m !== own };
    if (!m) return null;
    const cut = m.lastIndexOf("/");
    m = cut >= 0 ? m.slice(0, cut) : "";
  }
}

/** 全量级联槽位：枚举 parts 节点子树内全部下级节点的 (domain, module) 槽位（含各层级）。
 * 模块路径推导与树渲染一致：二级起标签按 / 连接；空标签节点不出槽位但继续下钻。 */
export function collectResearchCascadeSlots(tree, parts, baseModule) {
  const node = dutyFieldNodeAtPath(tree, parts);
  if (!node) return [];
  const domain = String(dutyFieldNodeAtPath(tree, parts.slice(0, 1))?.label || "").trim();
  if (!domain) return [];
  const prefix0 = String(baseModule || "").trim();
  const out = [];
  const walk = (children, prefix) => {
    (Array.isArray(children) ? children : []).forEach((ch) => {
      const label = String(ch?.label || "").trim();
      if (label) {
        const mod = prefix ? `${prefix}/${label}` : label;
        out.push({ domain, module: mod });
        walk(ch?.children || [], mod);
      } else {
        walk(ch?.children || [], prefix);
      }
    });
  };
  walk(node.children || [], prefix0);
  return out;
}

export function openResearchFieldNodeModal(domain, module, cascadeSlots) {
  if (!whitelistAllows(RESEARCH_DUTY_FIELD_KEY, "readonly", getCurrentWhitelistSettings())) return;
  state.researchFieldNodeModalOpen = true;
  state.researchFieldNodeDomain = String(domain || "").trim();
  state.researchFieldNodeModule = String(module || "").trim();
  state.researchFieldNodeCascadeSlots = Array.isArray(cascadeSlots) ? cascadeSlots : [];
  state.researchFieldNodeFieldId = "";
  state.researchFieldNodeOwner = "";
  state.researchFieldNodeMsg = "";
  state.researchFieldNodeExists = false;
  state.researchFieldNodeLoading = true;
  requestRender();
  // 开窗先拉最新，避免用陈旧 items 预填；弹窗已关或已切到其它节点则丢弃响应。
  void fetchResearchDutyFieldFromServer().then(() => {
    if (
      !state.researchFieldNodeModalOpen ||
      state.researchFieldNodeDomain !== String(domain || "").trim() ||
      state.researchFieldNodeModule !== String(module || "").trim()
    ) {
      return;
    }
    state.researchFieldNodeLoading = false;
    if (state.researchDutyFieldMsg) {
      // 加载失败（网络/503 等）：弹窗内展示错误，不预填
      state.researchFieldNodeMsg = state.researchDutyFieldMsg;
      requestRender();
      return;
    }
    const row = researchFieldRowFor(domain, module);
    state.researchFieldNodeFieldId = row && row.id !== null ? String(row.id) : "";
    state.researchFieldNodeOwner = row ? String(row.owner || "") : "";
    state.researchFieldNodeExists = !!row;
    requestRender();
  });
}

export function closeResearchFieldNodeModal() {
  state.researchFieldNodeModalOpen = false;
  state.researchFieldNodeDomain = "";
  state.researchFieldNodeModule = "";
  state.researchFieldNodeCascadeSlots = [];
  state.researchFieldNodeFieldId = "";
  state.researchFieldNodeOwner = "";
  state.researchFieldNodeMsg = "";
  state.researchFieldNodeExists = false;
  state.researchFieldNodeLoading = false;
  state.researchFieldNodeSaving = false;
  requestRender();
}

export function renderResearchFieldNodeModalHtml() {
  if (!state.researchFieldNodeModalOpen) return "";
  const domain = String(state.researchFieldNodeDomain || "");
  const module_ = String(state.researchFieldNodeModule || "");
  const loading = state.researchFieldNodeLoading;
  const saving = state.researchFieldNodeSaving;
  const msg = state.researchFieldNodeMsg
    ? `<p class="duty-field-banner ${/失败|403|503|网络|异常|未就绪|迁移/.test(state.researchFieldNodeMsg) ? "duty-field-banner--err" : "duty-field-banner--ok"}">${escapeHtml(state.researchFieldNodeMsg)}</p>`
    : "";
  const items = (state.researchDutyFieldItems || []).filter((row) => row.name);
  const selectedId = String(state.researchFieldNodeFieldId || "");
  const fieldOptions = items
    .map((row) => {
      const v = row.id === null ? "" : String(row.id);
      const label = row.owner ? `${row.name}（${row.owner}）` : row.name;
      return `<option value="${escapeAttr(v)}" ${v === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const emptyCatalog = !loading && !items.length;
  const cascadeCount = Array.isArray(state.researchFieldNodeCascadeSlots) ? state.researchFieldNodeCascadeSlots.length : 0;
  const body = loading
    ? `<p class="duty-field-hint">正在从服务器加载…</p>`
    : `<div class="research-field-modal-form">
        <select id="research-field-node-name" class="research-field-select" ${emptyCatalog ? "disabled" : ""} aria-label="选择在研责任田">
          <option value="">请选择在研责任田</option>
          ${fieldOptions}
        </select>
        <input type="text" id="research-field-node-owner" class="research-field-input research-field-input--owner" value="${escapeAttr(state.researchFieldNodeOwner)}" placeholder="责任人（随所选责任田带出）" readonly />
      </div>
      ${emptyCatalog ? `<p class="duty-field-hint">目录为空：请先在「参数配置 → 在研责任田」中添加。</p>` : ""}`;
  return `
    <div class="perm-modal-mask research-field-modal-mask" role="presentation">
      <div class="perm-modal research-field-modal" role="dialog" aria-modal="true" aria-labelledby="research-field-node-modal-title">
        <div class="perm-modal-head">
          <h3 id="research-field-node-modal-title">配置在研责任田</h3>
          <button type="button" class="create-ticket-modal-close" id="close-research-field-node-btn" aria-label="关闭">✕</button>
        </div>
        <div class="perm-modal-body">
          <div class="research-field-modal-scope">领域：<strong>${escapeHtml(domain)}</strong> ／ 模块：<strong>${escapeHtml(module_ || "（整领域）")}</strong></div>
          <p class="duty-field-hint">从「参数配置 → 在研责任田」目录中下拉选择本节点对应的田（只能选已有的，不能新增）；不同模块可关联同一个田。若责任田树有未保存的改名，请先保存树再配置。</p>
          ${!loading && cascadeCount > 0 ? `<p class="duty-field-hint">保存后将同时为 ${cascadeCount} 个下级节点绑定该田（下级原有绑定会被覆盖）；解除关联仅作用于本节点。</p>` : ""}
          ${body}
          ${msg}
        </div>
        <div class="perm-modal-actions">
          ${state.researchFieldNodeExists && !loading ? `<button type="button" class="action danger" id="research-field-node-remove-btn" ${saving ? "disabled" : ""}>解除关联</button>` : ""}
          <button type="button" class="action" id="research-field-node-close-btn" ${saving ? "disabled" : ""}>关闭</button>
          <button type="button" class="action primary" id="research-field-node-save-btn" ${loading || saving || emptyCatalog ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>`;
}

async function submitResearchFieldNodeModal(mode) {
  if (!state.researchFieldNodeModalOpen || state.researchFieldNodeLoading || state.researchFieldNodeSaving) return;
  if (!whitelistAllows(RESEARCH_DUTY_FIELD_KEY, "readonly", getCurrentWhitelistSettings())) return;
  const domain = String(state.researchFieldNodeDomain || "").trim();
  const module_ = String(state.researchFieldNodeModule || "").trim();
  if (!domain) return;
  const existing = researchFieldRowFor(domain, module_);
  let fieldId = null;
  if (mode === "remove") {
    if (!existing) return;
    if (!window.confirm(`确认解除在研责任田「${existing.name || "—"}」与 ${domain}/${module_ || "（整领域）"} 的关联？（仅解除本节点，下级绑定不变；田仍保留在参数配置中）`)) return;
  } else {
    const raw = String(state.researchFieldNodeFieldId || "").trim();
    if (!raw) {
      window.alert("请选择在研责任田（目录在「参数配置 → 在研责任田」中维护）");
      return;
    }
    fieldId = Number(raw);
    if (!Number.isFinite(fieldId)) return;
  }
  state.researchFieldNodeSaving = true;
  state.researchFieldNodeMsg = "";
  requestRender();
  try {
    // 单槽位原子 upsert + 全量级联下级：不再前端读-改-写全量列表（field_id=null 即解除关联，仅自身不级联）
    const resp = await fetch(`${API_BASE_URL}/api/params/research-duty-field/binding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: getCurrentOperator().account,
        domain,
        module: module_,
        field_id: fieldId,
        cascade_slots: mode === "remove" ? [] : state.researchFieldNodeCascadeSlots || [],
      }),
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
      state.researchFieldNodeMsg = detail || `保存失败：${resp.status}`;
      return;
    }
    state.researchDutyFieldItems = (Array.isArray(data.items) ? data.items : []).map(normalizeResearchDutyFieldItem);
    state.researchDutyFieldNeedsRefresh = true; // 面板下次进入重拉
    closeResearchFieldNodeModal();
  } catch (e) {
    state.researchFieldNodeMsg = String(e?.message || e);
  } finally {
    state.researchFieldNodeSaving = false;
    requestRender();
  }
}

export function bindResearchFieldNodeModal() {
  if (!state.researchFieldNodeModalOpen) return;
  const mask = document.querySelector(".research-field-modal-mask");
  if (!mask) return;
  const closeModal = () => {
    if (state.researchFieldNodeSaving) return;
    closeResearchFieldNodeModal();
  };
  mask.querySelector("#close-research-field-node-btn")?.addEventListener("click", closeModal);
  mask.querySelector("#research-field-node-close-btn")?.addEventListener("click", closeModal);
  mask.addEventListener("click", (ev) => {
    if (ev.target === mask) closeModal();
  });
  const nameSelect = mask.querySelector("#research-field-node-name");
  const ownerInput = mask.querySelector("#research-field-node-owner");
  // 下拉选择即同步 state：责任人随所选田只读带出（不触发整页重渲染，避免重建下拉丢焦点）。
  nameSelect?.addEventListener("change", () => {
    state.researchFieldNodeFieldId = String(nameSelect.value || "");
    const row = (state.researchDutyFieldItems || []).find((r) => String(r.id ?? "") === state.researchFieldNodeFieldId);
    state.researchFieldNodeOwner = row ? String(row.owner || "") : "";
    if (ownerInput) ownerInput.value = state.researchFieldNodeOwner;
  });
  mask.querySelector("#research-field-node-save-btn")?.addEventListener("click", () => void submitResearchFieldNodeModal("save"));
  mask.querySelector("#research-field-node-remove-btn")?.addEventListener("click", () => void submitResearchFieldNodeModal("remove"));
}
