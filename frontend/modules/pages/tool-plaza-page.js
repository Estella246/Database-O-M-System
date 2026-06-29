import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";

export const TP_SEARCH_DEBOUNCE_MS = 400;
export let _tpSearchDebounceTimer = null;
let _tpFetchInProgress = false;
let _tpBound = false;

function renderMarkdown(md) {
  const src = String(md || "");
  const raw = typeof marked !== "undefined" ? marked.parse(src) : escapeHtml(src).replace(/\n/g, "<br>");
  const purify = typeof window !== "undefined" ? window.DOMPurify : null;
  return purify ? purify.sanitize(raw) : raw;
}

export function hotFireHtml(count) {
  const n = Math.max(0, Number(count) || 0);
  let tier = "cool";
  if (n >= 50) tier = "blaze";
  else if (n >= 10) tier = "hot";
  else if (n >= 1) tier = "warm";
  const icon = tier === "blaze" ? "🔥🔥" : tier === "cool" ? "" : "🔥";
  return `<span class="tp-hot-fire tp-hot-fire--${tier}" title="下载量 ${n}">
    ${icon ? `<span class="tp-hot-fire__icon" aria-hidden="true">${icon}</span>` : ""}
    <span class="tp-hot-fire__count">${n}</span>
  </span>`;
}

function typeBadgeHtml(itemType) {
  const isSkill = itemType === "skill";
  const label = isSkill ? "Skill" : "工具";
  const cls = isSkill ? "tp-type-badge--skill" : "tp-type-badge--tool";
  const tip = isSkill ? "Cursor Agent Skill" : "运维工具包";
  return `<span class="tp-type-badge ${cls}" title="${escapeAttr(tip)}">${label}</span>`;
}

export async function fetchToolPlazaCategories() {
  const op = getCurrentOperator();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ops-tool-plaza/categories?operator_id=${encodeURIComponent(op.account)}`
    );
    if (!r.ok) {
      state.toolPlazaCategories = [];
      return;
    }
    const j = await r.json();
    state.toolPlazaCategories = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.toolPlazaCategories = [];
  }
}

export async function fetchToolPlazaList() {
  if (_tpFetchInProgress) return;
  _tpFetchInProgress = true;
  const op = getCurrentOperator();
  state.toolPlazaListLoading = true;
  requestRender();
  try {
    const params = new URLSearchParams({
      operator_id: op.account,
      page: String(state.toolPlazaListPage || 1),
      page_size: String(state.toolPlazaListPageSize || 12),
    });
    const typeFilter = String(state.toolPlazaTypeFilter || "").trim();
    if (typeFilter === "skill" || typeFilter === "tool") params.set("item_type", typeFilter);
    const cat = String(state.toolPlazaCategoryFilter || "").trim();
    if (cat) params.set("category", cat);
    const q = String(state.toolPlazaSearch || "").trim();
    if (q) params.set("q", q);
    const r = await fetch(`${API_BASE_URL}/api/ops-tool-plaza/items?${params}`);
    if (!r.ok) {
      state.toolPlazaList = [];
      state.toolPlazaListTotal = 0;
      return;
    }
    const j = await r.json();
    state.toolPlazaList = Array.isArray(j.items) ? j.items : [];
    state.toolPlazaListTotal = Number(j.total) || 0;
  } catch (_) {
    state.toolPlazaList = [];
    state.toolPlazaListTotal = 0;
  } finally {
    state.toolPlazaListLoading = false;
    state.toolPlazaListLoaded = true;
    state.toolPlazaNeedsRefresh = false;
    _tpFetchInProgress = false;
    requestRender();
  }
}

export async function fetchToolPlazaDetail(id) {
  const op = getCurrentOperator();
  state.toolPlazaDetailLoading = true;
  state.toolPlazaDetailId = id;
  requestRender();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ops-tool-plaza/items/${id}?operator_id=${encodeURIComponent(op.account)}`
    );
    state.toolPlazaDetailBundle = r.ok ? await r.json() : null;
  } catch (_) {
    state.toolPlazaDetailBundle = null;
  } finally {
    state.toolPlazaDetailLoading = false;
    requestRender();
  }
}

export async function downloadToolPlazaItem(id) {
  const op = getCurrentOperator();
  const r = await fetch(
    `${API_BASE_URL}/api/ops-tool-plaza/items/${id}/download?operator_id=${encodeURIComponent(op.account)}`,
    { method: "POST" }
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.detail || "下载失败");
  }
  const j = await r.json();
  const url = j.url;
  const fileName = j.file_name || "download.zip";
  if (typeof j.download_count === "number") {
    const item = (state.toolPlazaList || []).find((x) => Number(x.id) === Number(id));
    if (item) item.download_count = j.download_count;
    if (state.toolPlazaDetailBundle && Number(state.toolPlazaDetailBundle.id) === Number(id)) {
      state.toolPlazaDetailBundle.download_count = j.download_count;
    }
  }
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  requestRender();
}

function categoryChipsHtml() {
  const active = String(state.toolPlazaCategoryFilter || "");
  const cats = Array.isArray(state.toolPlazaCategories) ? state.toolPlazaCategories : [];
  const chips = [
    `<button type="button" class="tp-chip ${active === "" ? "active" : ""}" data-tp-category="">全部</button>`,
    ...cats.map(
      (c) =>
        `<button type="button" class="tp-chip ${active === c ? "active" : ""}" data-tp-category="${escapeAttr(c)}">${escapeHtml(c)}</button>`
    ),
  ];
  return chips.join("");
}

function typeTabsHtml() {
  const cur = String(state.toolPlazaTypeFilter || "");
  const tabs = [
    { key: "", label: "全部" },
    { key: "skill", label: "Skill" },
    { key: "tool", label: "工具" },
  ];
  return tabs
    .map(
      (t) =>
        `<button type="button" class="tp-type-tab ${cur === t.key ? "active" : ""}" data-tp-type="${escapeAttr(t.key)}">${t.label}</button>`
    )
    .join("");
}

export function renderToolPlazaPage() {
  const whitelist = getCurrentWhitelistSettings();
  const canPublish = whitelistAllows("tool_plaza_publish", "readonly", whitelist);

  const pageSize = Number(state.toolPlazaListPageSize) > 0 ? Number(state.toolPlazaListPageSize) : 12;
  const totalItems = Number(state.toolPlazaListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.toolPlazaListPage) || 1), totalPages);
  if (currentPage !== state.toolPlazaListPage) state.toolPlazaListPage = currentPage;

  const cards = (state.toolPlazaList || [])
    .map((it) => {
      const excerpt =
        it.item_type === "skill"
          ? escapeHtml(String(it.skill_md_excerpt || "暂无预览"))
          : escapeHtml(String(it.usage_md_excerpt || "暂无使用说明"));
      return `<article class="tp-card" data-tp-card-id="${it.id}" tabindex="0" role="button" aria-label="查看 ${escapeAttr(it.title || "")}">
        <div class="tp-card-head">
          ${typeBadgeHtml(it.item_type)}
          ${hotFireHtml(it.download_count)}
        </div>
        <h3 class="tp-card-title">${escapeHtml(it.title || "")}</h3>
        <p class="tp-card-meta">
          <span class="tp-card-author">${escapeHtml(it.publisher_name || it.publisher_id || "")}</span>
          ${it.category ? `<span class="tp-card-category">${escapeHtml(it.category)}</span>` : ""}
        </p>
        <div class="tp-card-excerpt">${excerpt}</div>
      </article>`;
    })
    .join("");

  const empty = state.toolPlazaListLoading
    ? `<div class="tp-empty">加载中…</div>`
    : `<div class="tp-empty">暂无资源，${canPublish ? "点击右上角发布第一个吧" : "敬请期待"}</div>`;

  const sizeOptions = [12, 24, 48]
    .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
    .join("");

  const paginationHtml =
    totalItems > 0
      ? `<div class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${totalItems} 条，第 ${currentPage}/${totalPages} 页</span>
        <label class="list-pagination-size">每页
          <select id="tp-page-size">${sizeOptions}</select>
        </label>
        <button type="button" class="action" id="tp-prev-page" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" class="action" id="tp-next-page" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
      </div>
    </div>`
      : "";

  return `
    <section class="tp-wrap" id="tool-plaza-panel">
      <div class="tp-toolbar">
        <div class="tp-type-tabs" role="tablist">${typeTabsHtml()}</div>
        <div class="tp-search">
          <input type="search" id="tp-search-input" class="tp-search-input" placeholder="搜索标题、分类、作者、内容…" value="${escapeAttr(state.toolPlazaSearch)}" />
        </div>
        <div class="tp-toolbar-right">
          ${canPublish ? `<button type="button" class="action primary" id="tp-publish-btn">发布</button>` : ""}
        </div>
      </div>
      <div class="tp-category-row">${categoryChipsHtml()}</div>
      <div class="tp-grid">${cards || empty}</div>
      ${paginationHtml}
    </section>`;
}

export function renderToolPlazaModalsHtml() {
  const publishOpen = state.toolPlazaPublishOpen;
  const detailOpen = Boolean(state.toolPlazaDetailId);
  const publishType = state.toolPlazaPublishType === "tool" ? "tool" : "skill";
  const usageDraft = String(state.toolPlazaPublishUsage || "");
  const usagePreviewHtml = usageDraft.trim()
    ? `<div class="tp-usage-preview tp-md-preview" id="tp-publish-usage-preview">${renderMarkdown(usageDraft)}</div>`
    : `<div class="tp-usage-preview tp-usage-preview--empty" id="tp-publish-usage-preview">填写后将在此预览 Markdown 效果</div>`;
  const cats = Array.isArray(state.toolPlazaCategories) ? state.toolPlazaCategories : [];
  const datalistOpts = cats.map((c) => `<option value="${escapeAttr(c)}"></option>`).join("");

  const publishModal = publishOpen
    ? `<div class="perm-modal-mask" id="tp-publish-mask">
      <div class="perm-modal tp-publish-modal" role="dialog" aria-modal="true" aria-labelledby="tp-publish-title">
        <div class="perm-modal-head">
          <h3 id="tp-publish-title">发布</h3>
          <button type="button" class="create-ticket-modal-close" id="tp-publish-close" aria-label="关闭">×</button>
        </div>
        <div class="perm-modal-body">
          <div class="tp-form-label">类型 <span class="tp-required">*</span>
            <div class="tp-publish-type-tabs" role="radiogroup" aria-label="发布类型">
              <button type="button" class="tp-publish-type-tab tp-publish-type-tab--skill ${publishType === "skill" ? "active" : ""}" data-tp-publish-type="skill" role="radio" aria-checked="${publishType === "skill"}">
                <span class="tp-type-badge tp-type-badge--skill">Skill</span>
              </button>
              <button type="button" class="tp-publish-type-tab tp-publish-type-tab--tool ${publishType === "tool" ? "active" : ""}" data-tp-publish-type="tool" role="radio" aria-checked="${publishType === "tool"}">
                <span class="tp-type-badge tp-type-badge--tool">工具</span>
              </button>
            </div>
          </div>
          <label class="tp-form-label">标题 <span class="tp-required">*</span>
            <input type="text" id="tp-publish-title-input" class="tp-form-input" maxlength="128" value="${escapeAttr(state.toolPlazaPublishTitle)}" placeholder="给资源起个名字" />
          </label>
          <label class="tp-form-label">分类 <span class="tp-required">*</span>
            <input type="text" id="tp-publish-category-input" class="tp-form-input" list="tp-category-datalist" maxlength="64" value="${escapeAttr(state.toolPlazaPublishCategory)}" placeholder="手填或选择已有分类" />
            <datalist id="tp-category-datalist">${datalistOpts}</datalist>
          </label>
          <label class="tp-form-label">使用方式 <span class="tp-required">*</span>
            <span class="tp-form-hint">支持 Markdown，发布后在详情页渲染展示</span>
            <textarea id="tp-publish-usage-input" class="tp-form-textarea" rows="6" maxlength="20000" placeholder="${publishType === "skill" ? "例：下载解压后，将目录复制到项目的 .cursor/skills/ 下使用" : "例：下载解压后，执行 run.sh 或按 README 说明操作"}">${escapeHtml(usageDraft)}</textarea>
            <div class="tp-usage-preview-wrap">
              <div class="tp-usage-preview-label">预览</div>
              ${usagePreviewHtml}
            </div>
          </label>
          <div class="tp-form-label">文件 <span class="tp-required">*</span>
            <div class="tp-upload-zone" id="tp-upload-zone">
              <input type="file" id="tp-publish-file" accept=".zip,application/zip" class="tp-upload-input" />
              <div class="tp-upload-placeholder">
                <span class="tp-upload-icon">📦</span>
                <span>点击或拖拽上传 .zip</span>
              </div>
              ${state.toolPlazaPublishFileName ? `<div class="tp-upload-name">${escapeHtml(state.toolPlazaPublishFileName)}</div>` : ""}
            </div>
            ${
              publishType === "skill"
                ? `<p class="tp-upload-hint">请上传包含 SKILL.md 的文件夹的 .zip 文件</p>`
                : `<p class="tp-upload-hint">请上传工具压缩包（.zip）</p>`
            }
          </div>
          ${state.toolPlazaPublishError ? `<div class="tp-form-error">${escapeHtml(state.toolPlazaPublishError)}</div>` : ""}
        </div>
        <div class="perm-modal-foot">
          <button type="button" class="action" id="tp-publish-cancel">取消</button>
          <button type="button" class="action primary" id="tp-publish-submit" ${state.toolPlazaPublishLoading ? "disabled" : ""}>${state.toolPlazaPublishLoading ? "发布中…" : "发布"}</button>
        </div>
      </div>
    </div>`
    : "";

  const detail = state.toolPlazaDetailBundle;
  const detailModal = detailOpen
    ? `<div class="perm-modal-mask" id="tp-detail-mask">
      <div class="perm-modal tp-detail-modal" role="dialog" aria-modal="true" aria-labelledby="tp-detail-title">
        <div class="perm-modal-head">
          <h3 id="tp-detail-title">${escapeHtml(detail?.title || (state.toolPlazaDetailLoading ? "加载中…" : "资源详情"))}</h3>
          <button type="button" class="create-ticket-modal-close" id="tp-detail-close" aria-label="关闭">×</button>
        </div>
        <div class="perm-modal-body tp-detail-body">
          ${
            state.toolPlazaDetailLoading
              ? `<div class="tp-empty">加载中…</div>`
              : !detail
                ? `<div class="tp-empty">加载失败</div>`
                : `<div class="tp-detail-meta">
                    ${typeBadgeHtml(detail.item_type)}
                    ${hotFireHtml(detail.download_count)}
                    <span class="tp-detail-author">${escapeHtml(detail.publisher_name || detail.publisher_id || "")}</span>
                    ${detail.category ? `<span class="tp-detail-category">${escapeHtml(detail.category)}</span>` : ""}
                  </div>
                  ${
                    detail.usage_md
                      ? `<section class="tp-detail-section">
                          <h4 class="tp-detail-section-title">使用方式</h4>
                          <div class="tp-md-preview tp-md-preview--full">${renderMarkdown(detail.usage_md)}</div>
                        </section>`
                      : ""
                  }
                  ${
                    detail.item_type === "skill" && detail.skill_md_content
                      ? `<section class="tp-detail-section">
                          <h4 class="tp-detail-section-title">SKILL.md</h4>
                          <div class="tp-md-preview tp-md-preview--full">${renderMarkdown(detail.skill_md_content)}</div>
                        </section>`
                      : detail.item_type === "tool"
                        ? `<p class="tp-detail-tool-note">工具包文件：${escapeHtml(detail.file_name || "")}</p>`
                        : !detail.usage_md
                          ? `<p class="tp-empty">暂无 SKILL.md 预览</p>`
                          : ""
                  }`
          }
        </div>
        <div class="perm-modal-foot">
          <button type="button" class="action" id="tp-detail-cancel">关闭</button>
          <button type="button" class="action primary" id="tp-detail-download" ${!detail || state.toolPlazaDetailLoading ? "disabled" : ""}>下载</button>
        </div>
      </div>
    </div>`
    : "";

  return publishModal + detailModal;
}

function openPublishModal() {
  state.toolPlazaPublishOpen = true;
  state.toolPlazaPublishType = "skill";
  state.toolPlazaPublishTitle = "";
  state.toolPlazaPublishCategory = "";
  state.toolPlazaPublishUsage = "";
  state.toolPlazaPublishFile = null;
  state.toolPlazaPublishFileName = "";
  state.toolPlazaPublishError = "";
  state.toolPlazaPublishLoading = false;
  fetchToolPlazaCategories().then(() => requestRender());
  requestRender();
}

function closePublishModal() {
  state.toolPlazaPublishOpen = false;
  state.toolPlazaPublishLoading = false;
  state.toolPlazaPublishError = "";
  requestRender();
}

function closeDetailModal() {
  state.toolPlazaDetailId = null;
  state.toolPlazaDetailBundle = null;
  state.toolPlazaDetailLoading = false;
  requestRender();
}

async function submitPublish() {
  if (state.toolPlazaPublishLoading) return;
  const title = String(state.toolPlazaPublishTitle || "").trim();
  const category = String(state.toolPlazaPublishCategory || "").trim();
  const usageMd = String(state.toolPlazaPublishUsage || "").trim();
  const file = state.toolPlazaPublishFile;
  if (!title) {
    state.toolPlazaPublishError = "请填写标题";
    requestRender();
    return;
  }
  if (!category) {
    state.toolPlazaPublishError = "请填写或选择分类";
    requestRender();
    return;
  }
  if (!usageMd) {
    state.toolPlazaPublishError = "请填写使用方式";
    requestRender();
    return;
  }
  if (!file) {
    state.toolPlazaPublishError = "请选择 zip 文件";
    requestRender();
    return;
  }
  state.toolPlazaPublishLoading = true;
  state.toolPlazaPublishError = "";
  requestRender();
  const op = getCurrentOperator();
  const fd = new FormData();
  fd.append("item_type", state.toolPlazaPublishType === "tool" ? "tool" : "skill");
  fd.append("title", title);
  fd.append("category", category);
  fd.append("usage_md", usageMd);
  fd.append("file", file, file.name || "upload.zip");
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ops-tool-plaza/items?operator_id=${encodeURIComponent(op.account)}`,
      { method: "POST", body: fd }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.toolPlazaPublishError = j.detail || "发布失败";
      state.toolPlazaPublishLoading = false;
      requestRender();
      return;
    }
    closePublishModal();
    state.toolPlazaListPage = 1;
    state.toolPlazaNeedsRefresh = true;
    await fetchToolPlazaCategories();
    await fetchToolPlazaList();
  } catch (_) {
    state.toolPlazaPublishError = "网络错误，请重试";
    state.toolPlazaPublishLoading = false;
    requestRender();
  }
}

function syncPublishUsagePreview(text) {
  const preview = document.getElementById("tp-publish-usage-preview");
  if (!preview) return;
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    preview.className = "tp-usage-preview tp-usage-preview--empty";
    preview.textContent = "填写后将在此预览 Markdown 效果";
    return;
  }
  preview.className = "tp-usage-preview tp-md-preview";
  preview.innerHTML = renderMarkdown(text);
}

export function bindToolPlazaPage() {
  if (_tpBound) return;
  _tpBound = true;

  let composing = false;

  document.addEventListener("input", (e) => {
    if (e.target.id === "tp-search-input") {
      if (composing) return;
      state.toolPlazaSearch = e.target.value;
      clearTimeout(_tpSearchDebounceTimer);
      _tpSearchDebounceTimer = setTimeout(() => {
        state.toolPlazaListPage = 1;
        fetchToolPlazaList();
      }, TP_SEARCH_DEBOUNCE_MS);
    }
    if (e.target.id === "tp-publish-title-input") state.toolPlazaPublishTitle = e.target.value;
    if (e.target.id === "tp-publish-category-input") state.toolPlazaPublishCategory = e.target.value;
    if (e.target.id === "tp-publish-usage-input") {
      state.toolPlazaPublishUsage = e.target.value;
      syncPublishUsagePreview(e.target.value);
    }
  });

  document.addEventListener("compositionstart", (e) => {
    if (e.target.id === "tp-search-input") composing = true;
  });
  document.addEventListener("compositionend", (e) => {
    if (e.target.id === "tp-search-input") {
      composing = false;
      state.toolPlazaSearch = e.target.value;
      clearTimeout(_tpSearchDebounceTimer);
      _tpSearchDebounceTimer = setTimeout(() => {
        state.toolPlazaListPage = 1;
        fetchToolPlazaList();
      }, TP_SEARCH_DEBOUNCE_MS);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id === "tp-search-input" && e.key === "Enter") {
      clearTimeout(_tpSearchDebounceTimer);
      state.toolPlazaSearch = e.target.value;
      state.toolPlazaListPage = 1;
      fetchToolPlazaList();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "tp-publish-file") {
      const f = e.target.files && e.target.files[0];
      state.toolPlazaPublishFile = f || null;
      state.toolPlazaPublishFileName = f ? f.name : "";
      state.toolPlazaPublishError = "";
      requestRender();
    }
    if (e.target.id === "tp-page-size") {
      state.toolPlazaListPageSize = Number(e.target.value) || 12;
      state.toolPlazaListPage = 1;
      fetchToolPlazaList();
    }
  });

  document.addEventListener("click", async (e) => {
    const typeTab = e.target.closest("[data-tp-type]");
    if (typeTab) {
      state.toolPlazaTypeFilter = typeTab.getAttribute("data-tp-type") || "";
      state.toolPlazaListPage = 1;
      fetchToolPlazaList();
      return;
    }
    const catChip = e.target.closest("[data-tp-category]");
    if (catChip) {
      state.toolPlazaCategoryFilter = catChip.getAttribute("data-tp-category") || "";
      state.toolPlazaListPage = 1;
      fetchToolPlazaList();
      return;
    }
    const publishTypeBtn = e.target.closest("[data-tp-publish-type]");
    if (publishTypeBtn) {
      const t = publishTypeBtn.getAttribute("data-tp-publish-type") || "skill";
      if (t !== state.toolPlazaPublishType) {
        state.toolPlazaPublishType = t === "tool" ? "tool" : "skill";
        state.toolPlazaPublishFile = null;
        state.toolPlazaPublishFileName = "";
        state.toolPlazaPublishError = "";
        requestRender();
      }
      return;
    }
    if (e.target.id === "tp-publish-btn") {
      openPublishModal();
      return;
    }
    if (e.target.id === "tp-publish-close" || e.target.id === "tp-publish-cancel") {
      closePublishModal();
      return;
    }
    if (e.target.id === "tp-publish-submit") {
      await submitPublish();
      return;
    }
    if (e.target.id === "tp-detail-close" || e.target.id === "tp-detail-cancel") {
      closeDetailModal();
      return;
    }
    if (e.target.id === "tp-detail-download" && state.toolPlazaDetailId) {
      try {
        await downloadToolPlazaItem(state.toolPlazaDetailId);
      } catch (err) {
        alert(err.message || "下载失败");
      }
      return;
    }
    if (e.target.id === "tp-prev-page") {
      state.toolPlazaListPage = Math.max(1, (state.toolPlazaListPage || 1) - 1);
      fetchToolPlazaList();
      return;
    }
    if (e.target.id === "tp-next-page") {
      state.toolPlazaListPage = (state.toolPlazaListPage || 1) + 1;
      fetchToolPlazaList();
      return;
    }
    const card = e.target.closest("[data-tp-card-id]");
    if (card) {
      const id = Number(card.getAttribute("data-tp-card-id"));
      if (id > 0) fetchToolPlazaDetail(id);
      return;
    }
    if (e.target.id === "tp-publish-mask") closePublishModal();
    if (e.target.id === "tp-detail-mask") closeDetailModal();
  });

  document.addEventListener("keydown", (e) => {
    const card = e.target.closest("[data-tp-card-id]");
    if (card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      const id = Number(card.getAttribute("data-tp-card-id"));
      if (id > 0) fetchToolPlazaDetail(id);
    }
  });
}
