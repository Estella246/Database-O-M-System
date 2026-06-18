import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";

// 局点档案 28 个业务字段 —— 顺序即列表/表单/导出的列顺序
export const SITE_PROFILE_FIELDS = [
  { key: "site_name", label: "局点名称", type: "text", required: true },
  { key: "profile_type", label: "类型", type: "text" },
  { key: "product_component", label: "产品组件", type: "text" },
  { key: "onsite_contract", label: "驻场合同", type: "text" },
  { key: "industry", label: "所属行业", type: "text" },
  { key: "region", label: "地区", type: "text" },
  { key: "representative_office", label: "所属代表处", type: "text" },
  { key: "stage", label: "阶段", type: "text" },
  { key: "tags", label: "标签", type: "text" },
  { key: "delivery_method", label: "交付方式", type: "text" },
  { key: "report_date", label: "汇报日期", type: "date" },
  { key: "report_nature", label: "回报性质", type: "text" },
  { key: "ops_personnel", label: "运维人员", type: "text" },
  { key: "kernel_delivery", label: "内核交付", type: "text" },
  { key: "kernel_maintenance", label: "内核维护", type: "text" },
  { key: "service_support", label: "服务支持", type: "text" },
  { key: "tech_lead", label: "技术组长", type: "text" },
  { key: "da", label: "DA", type: "text" },
  { key: "sa", label: "SA", type: "text" },
  { key: "td", label: "TD", type: "text" },
  { key: "account_manager", label: "客户经理", type: "text" },
  { key: "project_manager", label: "项目经理", type: "text" },
  { key: "service_manager", label: "服务经理", type: "text" },
  { key: "software_revenue", label: "软件收入", type: "text" },
  { key: "service_revenue", label: "服务收入", type: "text" },
  { key: "confirm_receipt_time", label: "确收时间", type: "date" },
  { key: "risk_description", label: "风险描述", type: "textarea" },
  { key: "dtrb_conclusion", label: "DTRB结论", type: "textarea" },
];

export let _spSearchDebounceTimer = null;
export const SP_SEARCH_DEBOUNCE_MS = 800;
let _spFetchInProgress = false;

function formatSpDate(d) {
  if (!d) return "";
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function formatYmdLocal(d) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchSiteProfileList() {
  if (_spFetchInProgress) return;
  _spFetchInProgress = true;
  const op = getCurrentOperator();
  state.siteProfileListLoading = true;
  requestRender();
  try {
    const q = state.siteProfileSearch.trim();
    const r = await fetch(
      `${API_BASE_URL}/api/site-profiles?operator_id=${encodeURIComponent(op.account)}&q=${encodeURIComponent(q)}&page=${state.siteProfileListPage}&page_size=${state.siteProfileListPageSize}`
    );
    if (!r.ok) {
      state.siteProfileList = [];
      state.siteProfileListTotal = 0;
      return;
    }
    const j = await r.json();
    state.siteProfileList = Array.isArray(j.items) ? j.items : [];
    state.siteProfileListTotal = j.total || 0;
  } catch (_) {
    state.siteProfileList = [];
    state.siteProfileListTotal = 0;
  } finally {
    state.siteProfileListLoading = false;
    state.siteProfileListLoaded = true;
    state.siteProfileNeedsRefresh = false;
    _spFetchInProgress = false;
    requestRender();
  }
}

export async function fetchSiteProfileDetail(id) {
  const op = getCurrentOperator();
  state.siteProfileDetailLoading = true;
  state.siteProfileDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/site-profiles/${id}?operator_id=${encodeURIComponent(op.account)}`);
    state.siteProfileDetailBundle = r.ok ? await r.json() : null;
  } catch (_) {
    state.siteProfileDetailBundle = null;
  } finally {
    state.siteProfileDetailLoading = false;
    requestRender();
  }
}

export function renderSiteProfilePage() {
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("site_profile_create", "readonly", whitelist);
  const canDelete = canCreate;
  const canExport = whitelistAllows("site_profile_export", "readonly", whitelist);
  const selectedSet = new Set((state.siteProfileSelectedIds || []).map((x) => Number(x)).filter((x) => x > 0));

  const pageSize = Number(state.siteProfileListPageSize) > 0 ? Number(state.siteProfileListPageSize) : 10;
  const totalItems = Number(state.siteProfileListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.siteProfileListPage) || 1), totalPages);
  if (currentPage !== state.siteProfileListPage) state.siteProfileListPage = currentPage;

  const headCells = SITE_PROFILE_FIELDS.map((f) => `<th>${escapeHtml(f.label)}</th>`).join("");

  const pageItems = state.siteProfileList || [];
  const pageAllSelected =
    pageItems.length > 0 && pageItems.every((it) => selectedSet.has(Number(it.id)));
  const rows = pageItems
    .map((it, idx) => {
      const pid = Number(it.id);
      const cells = SITE_PROFILE_FIELDS.map((f) => {
        const v = f.type === "date" ? formatSpDate(it[f.key]) : String(it[f.key] || "");
        const cls = f.type === "textarea" ? "sp-desc-cell" : "sp-nowrap";
        return `<td class="${cls}">${escapeHtml(v)}</td>`;
      }).join("");
      const checkboxCell = canDelete
        ? `<td><input type="checkbox" data-sp-select="${pid}" ${selectedSet.has(pid) ? "checked" : ""} aria-label="选择局点档案 ${escapeAttr(String(it.site_name || pid))}" /></td>`
        : "";
      return `<tr class="sp-row" data-sp-id="${it.id}">
        ${checkboxCell}
        <td class="sp-nowrap">${(currentPage - 1) * pageSize + idx + 1}</td>
        ${cells}
      </tr>`;
    })
    .join("");

  const colCount = SITE_PROFILE_FIELDS.length + 1 + (canDelete ? 1 : 0);
  const empty = `<tr><td colspan="${colCount}" class="sp-empty">${state.siteProfileListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  const sizeOptions = [10, 20, 50, 100]
    .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
    .join("");

  const paginationHtml = `
    <div id="sp-list-pagination" class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${totalItems} 条，第 ${currentPage}/${totalPages} 页</span>
        <label class="list-pagination-size">
          <span class="list-pagination-size-text">每页</span>
          <select id="sp-page-size" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
          <span class="list-pagination-size-suffix">条</span>
        </label>
        <div class="list-pagination-nav">
          <button class="action list-page-btn" type="button" id="sp-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="action list-page-btn" type="button" id="sp-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
    </div>`;

  return `
    <section class="sp-wrap" id="site-profile-panel">
      <div class="sp-toolbar">
        <div class="sp-search">
          <input type="search" id="sp-search-input" class="sp-search-input" placeholder="搜索局点名称、地区、代表处、运维人员、客户经理等" value="${escapeAttr(state.siteProfileSearch)}" />
        </div>
        <div class="sp-toolbar-right">
          ${canExport ? '<button type="button" class="action" id="sp-export-btn">导出</button>' : ""}
          ${canCreate ? '<button type="button" class="action primary" id="sp-create-btn">新增</button>' : ""}
          ${canDelete ? '<button type="button" class="action danger" id="sp-delete-btn">删除</button>' : ""}
        </div>
      </div>
      <div class="sp-table-card">
        <table class="sp-table">
          <thead>
            <tr>${canDelete ? '<th style="width:36px;"><input type="checkbox" id="sp-select-all" aria-label="全选局点档案" ' + (pageAllSelected ? "checked" : "") + " /></th>" : ""}<th>序号</th>${headCells}</tr>
          </thead>
          <tbody>${state.siteProfileList.length ? rows : empty}</tbody>
        </table>
        ${paginationHtml}
      </div>
    </section>`;
}

function spFieldId(prefix, key) {
  return `sp-${prefix}-${key}`;
}

function renderSiteProfileFormBody(prefix, data = {}) {
  return `<div class="sp-form-grid">
    ${SITE_PROFILE_FIELDS.map((f) => {
      const id = spFieldId(prefix, f.key);
      const raw = data[f.key];
      const reqMark = f.required ? " *" : "";
      const wrapCls = f.type === "textarea" ? "sp-field sp-field--wide" : "sp-field";
      if (f.type === "textarea") {
        return `<label class="${wrapCls}">${escapeHtml(f.label)}${reqMark}
          <textarea id="${id}" class="sp-textarea" rows="2">${escapeHtml(String(raw || ""))}</textarea>
        </label>`;
      }
      const inputType = f.type === "date" ? "date" : "text";
      const val = f.type === "date" ? formatSpDate(raw) : String(raw || "");
      return `<label class="${wrapCls}">${escapeHtml(f.label)}${reqMark}
        <input type="${inputType}" id="${id}" class="sp-input" value="${escapeAttr(val)}" />
      </label>`;
    }).join("")}
  </div>`;
}

function readSiteProfileFormValues(prefix) {
  const out = {};
  SITE_PROFILE_FIELDS.forEach((f) => {
    out[f.key] = document.getElementById(spFieldId(prefix, f.key))?.value?.trim() || "";
  });
  return out;
}

function validateSiteProfileFormValues(values) {
  if (!values.site_name) {
    alert("局点名称不能为空");
    return false;
  }
  return true;
}

function closeSiteProfileDetail() {
  state.siteProfileDetailId = null;
  state.siteProfileDetailBundle = null;
  state.siteProfileEditOpen = false;
}

export function renderSiteProfileModalsHtml() {
  const whitelist = getCurrentWhitelistSettings();
  const canEdit = whitelistAllows("site_profile_create", "readonly", whitelist);

  const createOpen = state.siteProfileCreateOpen
    ? `<div class="perm-modal-mask sp-modal-mask" id="sp-create-mask">
        <div class="perm-modal sp-modal" role="dialog">
          <div class="perm-modal-head"><h3>新增局点档案</h3></div>
          <div class="perm-modal-body sp-form-body">
            ${renderSiteProfileFormBody("create", {})}
          </div>
          <div class="perm-modal-foot">
            <button type="button" class="action" id="sp-create-cancel-btn">取消</button>
            <button type="button" class="action primary" id="sp-create-submit-btn">提交</button>
          </div>
        </div>
      </div>`
    : "";

  const bundle = state.siteProfileDetailBundle;
  const detailOpen = state.siteProfileDetailId && bundle
    ? `<div class="perm-modal-mask sp-modal-mask" id="sp-detail-mask">
        <div class="perm-modal sp-modal sp-detail-modal" role="dialog">
          <div class="perm-modal-head"><h3>局点档案详情 - ${escapeHtml(String(bundle.site_name || ""))}</h3></div>
          <div class="perm-modal-body sp-detail-body">
            <div class="sp-detail-grid">
              ${SITE_PROFILE_FIELDS.map((f) => {
                const v = f.type === "date" ? formatSpDate(bundle[f.key]) : String(bundle[f.key] || "");
                const wide = f.type === "textarea" ? " sp-detail-item--wide" : "";
                return `<div class="sp-detail-item${wide}"><span class="sp-detail-label">${escapeHtml(f.label)}</span><span class="sp-detail-value">${escapeHtml(v) || "—"}</span></div>`;
              }).join("")}
            </div>
          </div>
          <div class="perm-modal-foot sp-detail-foot">
            <div class="sp-detail-foot-actions">
              ${canEdit ? '<button type="button" class="action" id="sp-detail-edit-btn">编辑</button>' : ""}
              ${canEdit ? '<button type="button" class="action danger" id="sp-detail-delete-btn">删除</button>' : ""}
            </div>
            <button type="button" class="action" id="sp-detail-close-btn">关闭</button>
          </div>
        </div>
      </div>`
    : "";

  const editOpen = state.siteProfileEditOpen && bundle
    ? `<div class="perm-modal-mask sp-modal-mask" id="sp-edit-mask">
        <div class="perm-modal sp-modal" role="dialog">
          <div class="perm-modal-head"><h3>编辑局点档案 - ${escapeHtml(String(bundle.site_name || ""))}</h3></div>
          <div class="perm-modal-body sp-form-body">
            ${renderSiteProfileFormBody("edit", bundle)}
          </div>
          <div class="perm-modal-foot">
            <button type="button" class="action" id="sp-edit-cancel-btn">取消</button>
            <button type="button" class="action primary" id="sp-edit-submit-btn">保存</button>
          </div>
        </div>
      </div>`
    : "";

  return createOpen + detailOpen + editOpen;
}

export function bindSiteProfilePage() {
  const panel = document.getElementById("site-profile-panel");
  if (!panel) return;

  const searchInput = document.getElementById("sp-search-input");
  const scheduleSiteProfileSearch = () => {
    clearTimeout(_spSearchDebounceTimer);
    _spSearchDebounceTimer = setTimeout(() => {
      _spSearchDebounceTimer = null;
      state.siteProfileListPage = 1;
      fetchSiteProfileList();
    }, SP_SEARCH_DEBOUNCE_MS);
  };
  if (searchInput) {
    searchInput.addEventListener("input", (ev) => {
      state.siteProfileSearch = searchInput.value || "";
      if (ev.isComposing) return;
      scheduleSiteProfileSearch();
    });
    searchInput.addEventListener("compositionend", () => {
      state.siteProfileSearch = searchInput.value || "";
      scheduleSiteProfileSearch();
    });
    searchInput.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      if (_spSearchDebounceTimer) {
        clearTimeout(_spSearchDebounceTimer);
        _spSearchDebounceTimer = null;
      }
      state.siteProfileSearch = searchInput.value || "";
      state.siteProfileListPage = 1;
      fetchSiteProfileList();
    });
  }

  const pageSizeSelect = document.getElementById("sp-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      state.siteProfileListPageSize = Number(pageSizeSelect.value) || 10;
      state.siteProfileListPage = 1;
      fetchSiteProfileList();
    });
  }

  const prevBtn = document.getElementById("sp-page-prev");
  const nextBtn = document.getElementById("sp-page-next");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (state.siteProfileListPage > 1) {
        state.siteProfileListPage--;
        fetchSiteProfileList();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const ps = Number(state.siteProfileListPageSize) || 10;
      const totalPages = Math.max(1, Math.ceil((state.siteProfileListTotal || 0) / ps));
      if (state.siteProfileListPage < totalPages) {
        state.siteProfileListPage++;
        fetchSiteProfileList();
      }
    });
  }

  document.querySelectorAll(".sp-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") return;
      const id = Number(row.getAttribute("data-sp-id"));
      if (id) fetchSiteProfileDetail(id);
    });
  });

  const selectAll = document.getElementById("sp-select-all");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      const checked = selectAll.checked;
      const next = new Set((state.siteProfileSelectedIds || []).map((x) => Number(x)).filter((x) => x > 0));
      (state.siteProfileList || []).forEach((it) => {
        const pid = Number(it.id);
        if (!pid) return;
        if (checked) next.add(pid);
        else next.delete(pid);
      });
      state.siteProfileSelectedIds = Array.from(next);
      requestRender();
    });
  }

  document.querySelectorAll("[data-sp-select]").forEach((el) => {
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("change", () => {
      const pid = Number(el.getAttribute("data-sp-select") || 0);
      if (!pid) return;
      const next = new Set((state.siteProfileSelectedIds || []).map((x) => Number(x)).filter((x) => x > 0));
      if (el.checked) next.add(pid);
      else next.delete(pid);
      state.siteProfileSelectedIds = Array.from(next);
      requestRender();
    });
  });

  const createBtn = document.getElementById("sp-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      state.siteProfileCreateOpen = true;
      requestRender();
    });
  }

  const deleteBtn = document.getElementById("sp-delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      void handleSiteProfileBulkDelete();
    });
  }

  const createCancelBtn = document.getElementById("sp-create-cancel-btn");
  if (createCancelBtn) {
    createCancelBtn.addEventListener("click", () => {
      state.siteProfileCreateOpen = false;
      requestRender();
    });
  }
  const createSubmitBtn = document.getElementById("sp-create-submit-btn");
  if (createSubmitBtn) {
    createSubmitBtn.addEventListener("click", () => handleSiteProfileCreateSubmit());
  }

  const exportBtn = document.getElementById("sp-export-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => handleSiteProfileExport());
  }

  const detailCloseBtn = document.getElementById("sp-detail-close-btn");
  if (detailCloseBtn) {
    detailCloseBtn.addEventListener("click", () => {
      closeSiteProfileDetail();
      requestRender();
    });
  }
  const detailEditBtn = document.getElementById("sp-detail-edit-btn");
  if (detailEditBtn) {
    detailEditBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.siteProfileEditOpen = true;
      requestRender();
    });
  }
  const detailDeleteBtn = document.getElementById("sp-detail-delete-btn");
  if (detailDeleteBtn) {
    detailDeleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleSiteProfileDelete();
    });
  }

  const editCancelBtn = document.getElementById("sp-edit-cancel-btn");
  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", () => {
      state.siteProfileEditOpen = false;
      requestRender();
    });
  }
  const editSubmitBtn = document.getElementById("sp-edit-submit-btn");
  if (editSubmitBtn) {
    editSubmitBtn.addEventListener("click", () => handleSiteProfileEditSubmit());
  }

  const createMask = document.getElementById("sp-create-mask");
  if (createMask) {
    createMask.addEventListener("click", (e) => {
      if (e.target === createMask) {
        state.siteProfileCreateOpen = false;
        requestRender();
      }
    });
  }
  const detailMask = document.getElementById("sp-detail-mask");
  if (detailMask) {
    detailMask.addEventListener("click", (e) => {
      if (e.target === detailMask) {
        closeSiteProfileDetail();
        requestRender();
      }
    });
  }
  const editMask = document.getElementById("sp-edit-mask");
  if (editMask) {
    editMask.addEventListener("click", (e) => {
      if (e.target === editMask) {
        state.siteProfileEditOpen = false;
        requestRender();
      }
    });
  }
}

async function handleSiteProfileCreateSubmit() {
  const op = getCurrentOperator();
  const values = readSiteProfileFormValues("create");
  if (!validateSiteProfileFormValues(values)) return;
  try {
    const r = await fetch(`${API_BASE_URL}/api/site-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, ...values }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "创建失败");
      return;
    }
    state.siteProfileCreateOpen = false;
    state.siteProfileListPage = 1;
    fetchSiteProfileList();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleSiteProfileEditSubmit() {
  const bundle = state.siteProfileDetailBundle;
  const profileId = bundle?.id || state.siteProfileDetailId;
  if (!profileId) return;
  const values = readSiteProfileFormValues("edit");
  if (!validateSiteProfileFormValues(values)) return;
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/site-profiles/${profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, ...values }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "保存失败");
      return;
    }
    state.siteProfileDetailBundle = await r.json();
    state.siteProfileEditOpen = false;
    await fetchSiteProfileList();
    requestRender();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleSiteProfileDelete() {
  const bundle = state.siteProfileDetailBundle;
  const profileId = bundle?.id || state.siteProfileDetailId;
  if (!profileId || !bundle) return;
  const name = String(bundle.site_name || "").trim() || String(profileId);
  if (!window.confirm(`确定删除局点档案「${name}」吗？此操作不可恢复。`)) return;
  const op = getCurrentOperator();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/site-profiles/${profileId}?operator_id=${encodeURIComponent(op.account)}`,
      { method: "DELETE" }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "删除失败");
      return;
    }
    const deletedId = Number(profileId);
    state.siteProfileSelectedIds = (state.siteProfileSelectedIds || []).filter((x) => Number(x) !== deletedId);
    closeSiteProfileDetail();
    await fetchSiteProfileList();
    requestRender();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

export async function handleSiteProfileBulkDelete() {
  const selected = new Set((state.siteProfileSelectedIds || []).map((x) => Number(x)).filter((x) => x > 0));
  if (selected.size === 0) {
    window.alert("请先选中要删除的局点档案");
    return;
  }
  const selectedIds = [...selected];
  if (!window.confirm(`此操作将删除${selectedIds.length}条局点档案，是否继续？`)) {
    return;
  }
  const op = getCurrentOperator();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/site-profiles/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        profile_ids: selectedIds,
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
    const deleted = Array.isArray(json?.deleted) ? json.deleted.map((x) => Number(x)).filter((x) => x > 0) : [];
    const deletedSet = new Set(deleted);
    const skipped = selectedIds.filter((id) => !deletedSet.has(id));
    if (deletedSet.has(Number(state.siteProfileDetailId))) {
      closeSiteProfileDetail();
    }
    state.siteProfileSelectedIds = [];
    if (skipped.length) {
      window.alert(
        `以下局点档案未从数据库删除（库中无此记录或无权）：\n${skipped.join("\n")}`,
      );
    }
    await fetchSiteProfileList();
    requestRender();
  } catch (e) {
    window.alert(`删除失败：${e && e.message ? e.message : String(e)}`);
  }
}

async function handleSiteProfileExport() {
  const op = getCurrentOperator();
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    alert("SheetJS 未加载，无法导出");
    return;
  }
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/site-profiles/export?operator_id=${encodeURIComponent(op.account)}&q=${encodeURIComponent(state.siteProfileSearch.trim())}`
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "导出失败");
      return;
    }
    const j = await r.json();
    const items = j.items || [];
    if (!items.length) {
      alert("没有可导出的数据");
      return;
    }
    const header = SITE_PROFILE_FIELDS.map((f) => f.label);
    const aoa = [header];
    items.forEach((it) => {
      aoa.push(
        SITE_PROFILE_FIELDS.map((f) =>
          f.type === "date" ? formatSpDate(it[f.key]) : String(it[f.key] || "")
        )
      );
    });
    const ws = X.utils.aoa_to_sheet(aoa);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "局点档案");
    X.writeFile(wb, `局点档案_${formatYmdLocal(new Date())}.xlsx`);
  } catch (e) {
    alert("导出失败：" + e.message);
  }
}
