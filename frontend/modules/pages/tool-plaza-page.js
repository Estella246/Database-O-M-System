import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import {
  armListSearchFocusRestore,
  markSkipListLoadingRender,
  consumeSkipListLoadingRender,
  registerListSearchInput,
  noteListSearchInputEvent,
  releaseListSearchRenderHold,
  setListSearchDebouncePending,
  setListSearchFetchPending,
  flushDeferredListSearchRender,
} from "../ui/list-search-input.js";
import { ensureToolPlazaTab } from "./settings-page.js";

export const TP_SEARCH_DEBOUNCE_MS = 400;
export let _tpSearchDebounceTimer = null;
let _tpFetchInProgress = false;
let _tpBound = false;

export function ensureToolItemTab(itemNo, title = "") {
  const no = String(itemNo || "").trim();
  const key = `tool-item:${no}`;
  const existing = state.openTabs.find((tab) => tab.key === key);
  if (!existing) {
    state.openTabs.push({ key, label: no, closable: true });
  } else if (title && existing.label === no) {
    existing.label = no;
  }
  return key;
}

export function toolPlazaItemUrl(itemNo) {
  return `/tool-plaza/${encodeURIComponent(String(itemNo || "").trim())}`;
}

export function getToolPlazaItemBundle(itemNo) {
  const no = String(itemNo || "").trim();
  return state.toolPlazaItemByNo[no] || null;
}

/** 列表/发布响应仅有 excerpt 时仍须拉详情接口拿 usage_md、detail_md、skill_md_content。 */
export function needsToolPlazaDetailFetch(cached) {
  if (!cached) return true;
  if (!String(cached.usage_md || "").trim()) return true;
  if (String(cached.item_type || "").toLowerCase() === "skill" && !String(cached.skill_md_content || "").trim()) {
    return true;
  }
  return false;
}

export function prepareToolPlazaItemEnter(itemNo) {
  const no = String(itemNo || "").trim();
  if (!no) return;
  ensureToolItemTab(no);
  if (needsToolPlazaDetailFetch(getToolPlazaItemBundle(no))) {
    state.toolPlazaItemHydratingNo = no;
    void fetchToolPlazaDetailByNo(no);
  }
}

function canEditToolPlazaItem(item, whitelist) {
  if (item && typeof item.can_edit === "boolean") return item.can_edit;
  const level = getWhitelistLevel("tool_plaza_edit", whitelist);
  if (level === "hidden") return false;
  if (level === "editable") return true;
  const op = getCurrentOperator();
  const pubId = String(item?.publisher_id || "").trim();
  return Boolean(pubId && pubId === String(op.account || "").trim());
}

function renderMarkdown(md) {
  const src = String(md || "");
  const raw = typeof marked !== "undefined" ? marked.parse(src) : escapeHtml(src).replace(/\n/g, "<br>");
  const purify = typeof window !== "undefined" ? window.DOMPurify : null;
  return purify ? purify.sanitize(raw) : raw;
}

export function heatScore(likeCount, downloadCount) {
  return 2 * Math.max(0, Number(likeCount) || 0) + Math.max(0, Number(downloadCount) || 0);
}

export function syncToolPlazaHeatFields(target) {
  if (!target || typeof target !== "object") return target;
  target.heat_score = heatScore(target.like_count, target.download_count);
  return target;
}

/** 火苗按热度分 heat=2L+D 分级展示；不展示具体热度数值。 */
export function hotFireHtml(heat) {
  const n = Math.max(0, Number(heat) || 0);
  let tier = "cool";
  if (n >= 40) tier = "blaze";
  else if (n >= 10) tier = "hot";
  else if (n >= 1) tier = "warm";
  const icon = tier === "blaze" ? "🔥🔥" : tier === "cool" ? "" : "🔥";
  if (!icon) {
    return `<span class="tp-hot-fire tp-hot-fire--cool" title="热度" aria-label="热度较低"></span>`;
  }
  return `<span class="tp-hot-fire tp-hot-fire--${tier}" title="热度" aria-label="热度">
    <span class="tp-hot-fire__icon" aria-hidden="true">${icon}</span>
  </span>`;
}

function downloadCountHtml(count) {
  const n = Math.max(0, Number(count) || 0);
  return `<span class="tp-download-count" title="下载量 ${n}"><span class="tp-download-count__icon" aria-hidden="true">⤓</span>${n}</span>`;
}

function likeButtonHtml(it, { compact = false } = {}) {
  const liked = Boolean(it?.liked_by_me);
  const count = Math.max(0, Number(it?.like_count) || 0);
  const id = Number(it?.id) || 0;
  const label = liked ? "取消点赞" : "点赞";
  const cls = `tp-like-btn${liked ? " is-liked" : ""}${compact ? " tp-like-btn--compact" : ""}`;
  return `<button type="button" class="${cls}" data-tp-like-id="${id}" aria-pressed="${liked}" aria-label="${label}" title="${label}">
    <span class="tp-like-btn__icon" aria-hidden="true">${liked ? "♥" : "♡"}</span>
    <span class="tp-like-btn__count">${count}</span>
  </button>`;
}

function typeBadgeHtml(itemType) {
  const isSkill = itemType === "skill";
  const label = isSkill ? "Skill" : "工具";
  const cls = isSkill ? "tp-type-badge--skill" : "tp-type-badge--tool";
  const tip = isSkill ? "Cursor Agent Skill" : "运维工具包";
  return `<span class="tp-type-badge ${cls}" title="${escapeAttr(tip)}">${label}</span>`;
}

function publishTypeIconBtn(type, active) {
  const isSkill = type === "skill";
  const label = isSkill ? "Skill" : "工具";
  const cls = isSkill ? "tp-type-badge--skill" : "tp-type-badge--tool";
  const tip = isSkill ? "Cursor Agent Skill" : "运维工具包";
  return `<button type="button" class="tp-publish-type-tab tp-publish-type-tab--${isSkill ? "skill" : "tool"}${active ? " active" : ""}" data-tp-publish-type="${type}" role="radio" aria-checked="${active}" aria-label="${escapeAttr(label)}"><span class="tp-type-badge ${cls}" title="${escapeAttr(tip)}">${label}</span></button>`;
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
  if (!consumeSkipListLoadingRender()) requestRender();
  try {
    const params = new URLSearchParams({
      operator_id: op.account,
      page: String(state.toolPlazaListPage || 1),
      page_size: String(state.toolPlazaListPageSize || 18),
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

export async function fetchToolPlazaDetailByNo(itemNo) {
  const no = String(itemNo || "").trim();
  if (!no) return;
  const op = getCurrentOperator();
  state.toolPlazaItemLoadingNo = no;
  requestRender();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ops-tool-plaza/items/by-no/${encodeURIComponent(no)}?operator_id=${encodeURIComponent(op.account)}`
    );
    const bundle = r.ok ? await r.json() : null;
    if (bundle && bundle.item_no) {
      state.toolPlazaItemByNo[String(bundle.item_no)] = bundle;
    } else if (!bundle && !getToolPlazaItemBundle(no)) {
      delete state.toolPlazaItemByNo[no];
    }
  } catch (_) {
    delete state.toolPlazaItemByNo[no];
  } finally {
    if (state.toolPlazaItemLoadingNo === no) state.toolPlazaItemLoadingNo = "";
    if (state.toolPlazaItemHydratingNo === no) state.toolPlazaItemHydratingNo = "";
    requestRender();
  }
}

export function openToolPlazaItem(it) {
  const itemNo = String(it?.item_no || "").trim();
  if (!itemNo) return;
  ensureToolItemTab(itemNo, it?.title || "");
  state.activeKey = `tool-item:${itemNo}`;
  history.pushState({}, "", toolPlazaItemUrl(itemNo));
  if (it?.item_no) {
    state.toolPlazaItemByNo[itemNo] = { ...(getToolPlazaItemBundle(itemNo) || {}), ...it };
  }
  if (needsToolPlazaDetailFetch(getToolPlazaItemBundle(itemNo))) {
    void fetchToolPlazaDetailByNo(itemNo);
  } else {
    requestRender();
  }
}

function closeToolPlazaItemTab(itemNo) {
  const no = String(itemNo || "").trim();
  if (!no) return;
  const key = `tool-item:${no}`;
  state.openTabs = state.openTabs.filter((tab) => tab.key !== key);
  delete state.toolPlazaItemByNo[no];
  if (state.activeKey === key) {
    state.activeKey = ensureToolPlazaTab();
    history.replaceState({}, "", "/tool-plaza");
  }
}

export function toolPlazaDownloadUrl(itemId) {
  const op = getCurrentOperator();
  return `${API_BASE_URL}/api/ops-tool-plaza/items/${encodeURIComponent(String(itemId))}/download?operator_id=${encodeURIComponent(op.account)}`;
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "download.zip";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseDownloadFileName(contentDisposition, fallback = "download.zip") {
  const raw = String(contentDisposition || "");
  const utf8Match = raw.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (_) {
      /* fall through */
    }
  }
  const plainMatch = raw.match(/filename="([^"]+)"/i);
  if (plainMatch?.[1]) return plainMatch[1];
  return fallback;
}

export async function triggerToolPlazaDownload(detail) {
  const id = Number(detail?.id) || 0;
  if (id <= 0) {
    throw new Error("资源信息未就绪，请稍后再试");
  }
  const r = await fetch(toolPlazaDownloadUrl(id), { method: "GET" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.detail || "下载失败");
  }
  const blob = await r.blob();
  const fileName = parseDownloadFileName(r.headers.get("Content-Disposition"), detail?.file_name || "download.zip");
  triggerBlobDownload(blob, fileName);
  const countHeader = r.headers.get("X-Download-Count");
  const downloadCount = countHeader != null ? Number(countHeader) : NaN;
  if (Number.isFinite(downloadCount)) {
    const item = (state.toolPlazaList || []).find((x) => Number(x.id) === Number(id));
    if (item) {
      item.download_count = downloadCount;
      syncToolPlazaHeatFields(item);
    }
    const itemNo = String(detail?.item_no || "").trim();
    if (itemNo && state.toolPlazaItemByNo[itemNo]) {
      state.toolPlazaItemByNo[itemNo].download_count = downloadCount;
      syncToolPlazaHeatFields(state.toolPlazaItemByNo[itemNo]);
    }
  }
  requestRender();
}

export async function toggleToolPlazaLike(itemId) {
  const id = Number(itemId) || 0;
  if (id <= 0) return;
  const listItem = (state.toolPlazaList || []).find((x) => Number(x.id) === id);
  const detailItem = Object.values(state.toolPlazaItemByNo || {}).find((x) => Number(x.id) === id);
  const current = listItem || detailItem;
  const wasLiked = Boolean(current?.liked_by_me);
  const prevLike = Math.max(0, Number(current?.like_count) || 0);

  const applyLocal = (liked, likeCount) => {
    const patch = (target) => {
      if (!target) return;
      target.liked_by_me = liked;
      target.like_count = likeCount;
      syncToolPlazaHeatFields(target);
    };
    patch(listItem);
    patch(detailItem);
  };

  applyLocal(!wasLiked, Math.max(0, prevLike + (wasLiked ? -1 : 1)));
  requestRender();

  const op = getCurrentOperator();
  const method = wasLiked ? "DELETE" : "POST";
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ops-tool-plaza/items/${id}/like?operator_id=${encodeURIComponent(op.account)}`,
      { method }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      applyLocal(wasLiked, prevLike);
      requestRender();
      throw new Error(j.detail || (wasLiked ? "取消点赞失败" : "点赞失败"));
    }
    const likeCount = Number(j.like_count);
    const liked = Boolean(j.liked_by_me);
    applyLocal(liked, Number.isFinite(likeCount) ? likeCount : prevLike);
    if (Number.isFinite(Number(j.download_count))) {
      if (listItem) listItem.download_count = Number(j.download_count);
      if (detailItem) detailItem.download_count = Number(j.download_count);
    }
    if (listItem) syncToolPlazaHeatFields(listItem);
    if (detailItem) syncToolPlazaHeatFields(detailItem);
    requestRender();
  } catch (err) {
    applyLocal(wasLiked, prevLike);
    requestRender();
    throw err;
  }
}

export async function downloadToolPlazaItem(id) {
  const cached =
    (state.toolPlazaList || []).find((x) => Number(x.id) === Number(id)) ||
    Object.values(state.toolPlazaItemByNo || {}).find((x) => Number(x.id) === Number(id)) ||
    { id };
  await triggerToolPlazaDownload(cached);
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

  const pageSize = Number(state.toolPlazaListPageSize) > 0 ? Number(state.toolPlazaListPageSize) : 18;
  const totalItems = Number(state.toolPlazaListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.toolPlazaListPage) || 1), totalPages);
  if (currentPage !== state.toolPlazaListPage) state.toolPlazaListPage = currentPage;

  const cards = (state.toolPlazaList || [])
    .map((it) => {
      const excerpt = escapeHtml(
        String(it.detail_md_excerpt || "").trim() ||
          (it.item_type === "skill"
            ? String(it.skill_md_excerpt || "暂无预览")
            : String(it.usage_md_excerpt || "暂无详情"))
      );
      return `<article class="tp-card" data-tp-card-id="${it.id}" data-tp-item-no="${escapeAttr(it.item_no || "")}" tabindex="0" role="button" aria-label="查看 ${escapeAttr(it.title || "")}">
        <div class="tp-card-head">
          ${typeBadgeHtml(it.item_type)}
          <div class="tp-card-head-right">
            ${hotFireHtml(it.heat_score ?? heatScore(it.like_count, it.download_count))}
            ${downloadCountHtml(it.download_count)}
            ${likeButtonHtml(it, { compact: true })}
          </div>
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

  const sizeOptions = [18, 36, 54]
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
        <label class="list-pagination-jump">
          <span class="list-pagination-jump-text">前往</span>
          <input type="number" id="tp-page-jump" class="list-page-jump" min="1" max="${totalPages}" step="1" value="${currentPage}" aria-label="前往第几页" />
          <span class="list-pagination-jump-suffix">页</span>
        </label>
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

export function renderToolPlazaItemDetailPage(itemNo) {
  const no = String(itemNo || "").trim();
  const loading = state.toolPlazaItemLoadingNo === no || state.toolPlazaItemHydratingNo === no;
  const detail = getToolPlazaItemBundle(no);
  const whitelist = getCurrentWhitelistSettings();
  const detailCanEdit = detail && !loading ? canEditToolPlazaItem(detail, whitelist) : false;

  if (loading && !detail) {
    return `<section class="tp-detail-page detail-card detail-card-inline">
      <h2>加载中…</h2>
      <p>正在加载资源 ${escapeHtml(no)}。</p>
    </section>`;
  }

  if (!detail) {
    return `<section class="tp-detail-page detail-card detail-card-inline">
      <h2>资源不存在</h2>
      <p>未找到编号 ${escapeHtml(no)} 对应的 Skill 或工具。</p>
    </section>`;
  }

  const detailMarkdown = String(detail.detail_md || detail.detail_md_excerpt || "").trim();
  const usageMarkdown = String(detail.usage_md || detail.usage_md_excerpt || "").trim();
  const skillMarkdown =
    detail.item_type === "skill" ? String(detail.skill_md_content || detail.skill_md_excerpt || "").trim() : "";

  return `<section class="tp-detail-page detail-card detail-card-inline">
    <div class="detail-head">
      <div class="tp-detail-head-main">
        <h2>${escapeHtml(detail.title || no)}</h2>
        <p class="tp-detail-no">${escapeHtml(detail.item_no || no)}</p>
      </div>
      <div class="detail-actions">
        <button type="button" class="action" id="tp-detail-copy-link" data-tp-item-no="${escapeAttr(detail.item_no || no)}">分享链接</button>
        ${detailCanEdit ? '<button type="button" class="action danger" id="tp-detail-delete">删除</button>' : ""}
        ${detailCanEdit ? '<button type="button" class="action" id="tp-detail-edit">编辑</button>' : ""}
        <button type="button" class="action primary" id="tp-detail-download">下载</button>
      </div>
    </div>
    <div class="tp-detail-body tp-detail-body--page">
      <div class="tp-detail-meta">
        ${typeBadgeHtml(detail.item_type)}
        <div class="tp-detail-meta-stats">
          ${hotFireHtml(detail.heat_score ?? heatScore(detail.like_count, detail.download_count))}
          ${downloadCountHtml(detail.download_count)}
          ${likeButtonHtml(detail)}
        </div>
        <span class="tp-detail-author">${escapeHtml(detail.publisher_name || detail.publisher_id || "")}</span>
        ${detail.category ? `<span class="tp-detail-category">${escapeHtml(detail.category)}</span>` : ""}
      </div>
      ${
        detailMarkdown
          ? `<section class="tp-detail-section">
              <h4 class="tp-detail-section-title">详情</h4>
              <div class="tp-md-preview tp-md-preview--full">${renderMarkdown(detailMarkdown)}</div>
            </section>`
          : `<p class="tp-empty">暂无详情</p>`
      }
      ${
        usageMarkdown
          ? `<section class="tp-detail-section">
              <h4 class="tp-detail-section-title">使用方式</h4>
              <div class="tp-md-preview tp-md-preview--full">${renderMarkdown(usageMarkdown)}</div>
            </section>`
          : ""
      }
      ${
        detail.item_type === "skill" && skillMarkdown
          ? `<section class="tp-detail-section">
              <h4 class="tp-detail-section-title">SKILL.md</h4>
              <div class="tp-md-preview tp-md-preview--full">${renderMarkdown(skillMarkdown)}</div>
            </section>`
          : detail.item_type === "tool"
            ? `<p class="tp-detail-tool-note">工具包文件：${escapeHtml(detail.file_name || "")}</p>`
            : !usageMarkdown
              ? `<p class="tp-empty">暂无 SKILL.md 预览</p>`
              : ""
      }
    </div>
  </section>`;
}

export function renderToolPlazaModalsHtml() {
  const publishOpen = state.toolPlazaPublishOpen;
  const editId = Number(state.toolPlazaEditId) || 0;
  const isEditMode = editId > 0;
  const publishType = state.toolPlazaPublishType === "tool" ? "tool" : "skill";
  const detailDraft = String(state.toolPlazaPublishDetail || "");
  const usageDraft = String(state.toolPlazaPublishUsage || "");
  const detailPreviewHtml = detailDraft.trim()
    ? `<div class="tp-publish-preview-pane tp-md-preview" id="tp-publish-detail-preview">${renderMarkdown(detailDraft)}</div>`
    : `<div class="tp-publish-preview-pane tp-publish-preview-pane--empty" id="tp-publish-detail-preview">填写详情后将在此预览 Markdown 效果</div>`;
  const usagePreviewHtml = usageDraft.trim()
    ? `<div class="tp-publish-preview-pane tp-md-preview" id="tp-publish-usage-preview">${renderMarkdown(usageDraft)}</div>`
    : `<div class="tp-publish-preview-pane tp-publish-preview-pane--empty" id="tp-publish-usage-preview">填写使用方式后将在此预览 Markdown 效果</div>`;
  const cats = Array.isArray(state.toolPlazaCategories) ? state.toolPlazaCategories : [];
  const datalistOpts = cats.map((c) => `<option value="${escapeAttr(c)}"></option>`).join("");

  const publishModal = publishOpen
    ? `<div class="perm-modal-mask" id="tp-publish-mask">
      <div class="perm-modal tp-publish-modal" role="dialog" aria-modal="true" aria-labelledby="tp-publish-title">
        <div class="perm-modal-head">
          <h3 id="tp-publish-title">${isEditMode ? "编辑" : "发布"}</h3>
          <button type="button" class="create-ticket-modal-close" id="tp-publish-close" aria-label="关闭">×</button>
        </div>
        <div class="perm-modal-body tp-publish-body">
          <div class="tp-publish-split">
            <div class="tp-publish-form-col">
          ${
            isEditMode
              ? `<div class="tp-form-label">类型
                  ${typeBadgeHtml(publishType)}
                </div>`
              : `<div class="tp-form-label">类型 <span class="tp-required">*</span>
            <div class="tp-publish-type-tabs" role="radiogroup" aria-label="发布类型">
              ${publishTypeIconBtn("skill", publishType === "skill")}
              ${publishTypeIconBtn("tool", publishType === "tool")}
            </div>
          </div>`
          }
          <label class="tp-form-label">标题 <span class="tp-required">*</span>
            <input type="text" id="tp-publish-title-input" class="tp-form-input" maxlength="128" value="${escapeAttr(state.toolPlazaPublishTitle)}" placeholder="给资源起个名字" />
          </label>
          <label class="tp-form-label">标签 <span class="tp-required">*</span>
            <input type="text" id="tp-publish-category-input" class="tp-form-input" list="tp-category-datalist" maxlength="64" value="${escapeAttr(state.toolPlazaPublishCategory)}" placeholder="慢SQL优化、锁问题、热补丁工具等...可新增或选择已有分类" />
            <datalist id="tp-category-datalist">${datalistOpts}</datalist>
          </label>
          <label class="tp-form-label">详情 <span class="tp-required">*</span>
            <span class="tp-form-hint">支持 Markdown，右侧实时预览</span>
            <textarea id="tp-publish-detail-input" class="tp-form-textarea tp-form-textarea--publish" rows="8" maxlength="20000" placeholder="介绍工具/Skill 的功能、适用场景、注意事项等">${escapeHtml(detailDraft)}</textarea>
          </label>
          <label class="tp-form-label">使用方式 <span class="tp-required">*</span>
            <span class="tp-form-hint">支持 Markdown，右侧实时预览</span>
            <textarea id="tp-publish-usage-input" class="tp-form-textarea tp-form-textarea--publish" rows="8" maxlength="20000" placeholder="${publishType === "tool" ? "例：下载解压后，执行 run.sh 或按 README 说明操作" : ""}">${escapeHtml(usageDraft)}</textarea>
          </label>
          <div class="tp-form-label">文件 ${isEditMode ? "" : '<span class="tp-required">*</span>'}
            <div class="tp-upload-zone" id="tp-upload-zone">
              <input type="file" id="tp-publish-file" accept=".zip,application/zip" class="tp-upload-input" />
              <div class="tp-upload-placeholder">
                <span class="tp-upload-icon">📦</span>
                <span>${isEditMode ? "点击或拖拽上传新 .zip（不更换可留空）" : "点击或拖拽上传 .zip"}</span>
              </div>
              ${state.toolPlazaPublishFileName ? `<div class="tp-upload-name">${escapeHtml(state.toolPlazaPublishFileName)}</div>` : isEditMode && state.toolPlazaEditFileName ? `<div class="tp-upload-name tp-upload-name--current">当前：${escapeHtml(state.toolPlazaEditFileName)}</div>` : ""}
            </div>
            ${
              publishType === "skill"
                ? `<p class="tp-upload-hint">${isEditMode ? "更换文件时须包含 SKILL.md" : "请上传包含 SKILL.md 的文件夹的 .zip 文件"}</p>`
                : `<p class="tp-upload-hint">${isEditMode ? "更换文件时须为 .zip 工具包" : "请上传工具压缩包（.zip）"}</p>`
            }
          </div>
          ${state.toolPlazaPublishError ? `<div class="tp-form-error">${escapeHtml(state.toolPlazaPublishError)}</div>` : ""}
            </div>
            <div class="tp-publish-preview-col">
              <div class="tp-publish-preview-head">详情预览</div>
              ${detailPreviewHtml}
              <div class="tp-publish-preview-head tp-publish-preview-head--sub">使用方式预览</div>
              ${usagePreviewHtml}
            </div>
          </div>
        </div>
        <div class="perm-modal-foot">
          <button type="button" class="action" id="tp-publish-cancel">取消</button>
          <button type="button" class="action primary" id="tp-publish-submit" ${state.toolPlazaPublishLoading ? "disabled" : ""}>${state.toolPlazaPublishLoading ? (isEditMode ? "保存中…" : "发布中…") : isEditMode ? "保存" : "发布"}</button>
        </div>
      </div>
    </div>`
    : "";

  return publishModal;
}

function openPublishModal() {
  state.toolPlazaPublishOpen = true;
  state.toolPlazaEditId = null;
  state.toolPlazaEditFileName = "";
  state.toolPlazaPublishType = "skill";
  state.toolPlazaPublishTitle = "";
  state.toolPlazaPublishCategory = "";
  state.toolPlazaPublishDetail = "";
  state.toolPlazaPublishUsage = "";
  state.toolPlazaPublishFile = null;
  state.toolPlazaPublishFileName = "";
  state.toolPlazaPublishError = "";
  state.toolPlazaPublishLoading = false;
  fetchToolPlazaCategories().then(() => requestRender());
  requestRender();
}

function openEditModal(detail) {
  if (!detail || !detail.id) return;
  state.toolPlazaPublishOpen = true;
  state.toolPlazaEditId = detail.id;
  state.toolPlazaPublishType = detail.item_type === "tool" ? "tool" : "skill";
  state.toolPlazaPublishTitle = String(detail.title || "");
  state.toolPlazaPublishCategory = String(detail.category || "");
  state.toolPlazaPublishDetail = String(detail.detail_md || "");
  state.toolPlazaPublishUsage = String(detail.usage_md || "");
  state.toolPlazaPublishFile = null;
  state.toolPlazaPublishFileName = "";
  state.toolPlazaEditFileName = String(detail.file_name || "");
  state.toolPlazaPublishError = "";
  state.toolPlazaPublishLoading = false;
  fetchToolPlazaCategories().then(() => requestRender());
  requestRender();
}

function closePublishModal() {
  state.toolPlazaPublishOpen = false;
  state.toolPlazaEditId = null;
  state.toolPlazaEditFileName = "";
  state.toolPlazaPublishLoading = false;
  state.toolPlazaPublishError = "";
  requestRender();
}

function getActiveToolPlazaItemDetail() {
  if (typeof state.activeKey !== "string" || !state.activeKey.startsWith("tool-item:")) return null;
  const itemNo = state.activeKey.slice("tool-item:".length);
  return getToolPlazaItemBundle(itemNo);
}

async function submitPublish() {
  if (state.toolPlazaPublishLoading) return;
  const editId = Number(state.toolPlazaEditId) || 0;
  const isEditMode = editId > 0;
  const title = String(state.toolPlazaPublishTitle || "").trim();
  const category = String(state.toolPlazaPublishCategory || "").trim();
  const detailMd = String(state.toolPlazaPublishDetail || "").trim();
  const usageMd = String(state.toolPlazaPublishUsage || "").trim();
  const file = state.toolPlazaPublishFile;
  if (!title) {
    state.toolPlazaPublishError = "请填写标题";
    requestRender();
    return;
  }
  if (!category) {
    state.toolPlazaPublishError = "请填写或选择标签";
    requestRender();
    return;
  }
  if (!detailMd) {
    state.toolPlazaPublishError = "请填写详情";
    requestRender();
    return;
  }
  if (!usageMd) {
    state.toolPlazaPublishError = "请填写使用方式";
    requestRender();
    return;
  }
  if (!isEditMode && !file) {
    state.toolPlazaPublishError = "请选择 zip 文件";
    requestRender();
    return;
  }
  state.toolPlazaPublishLoading = true;
  state.toolPlazaPublishError = "";
  requestRender();
  const op = getCurrentOperator();
  const fd = new FormData();
  fd.append("title", title);
  fd.append("category", category);
  fd.append("detail_md", detailMd);
  fd.append("usage_md", usageMd);
  if (file) fd.append("file", file, file.name || "upload.zip");
  try {
    const url = isEditMode
      ? `${API_BASE_URL}/api/ops-tool-plaza/items/${editId}?operator_id=${encodeURIComponent(op.account)}`
      : `${API_BASE_URL}/api/ops-tool-plaza/items?operator_id=${encodeURIComponent(op.account)}`;
    if (!isEditMode) {
      fd.append("item_type", state.toolPlazaPublishType === "tool" ? "tool" : "skill");
    }
    const r = await fetch(url, { method: isEditMode ? "PUT" : "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.toolPlazaPublishError = j.detail || (isEditMode ? "保存失败" : "发布失败");
      state.toolPlazaPublishLoading = false;
      requestRender();
      return;
    }
    closePublishModal();
    if (j.item_no) {
      openToolPlazaItem(j);
      if (needsToolPlazaDetailFetch(getToolPlazaItemBundle(String(j.item_no)))) {
        await fetchToolPlazaDetailByNo(j.item_no);
      }
    } else if (!isEditMode) {
      state.toolPlazaListPage = 1;
    }
    state.toolPlazaNeedsRefresh = true;
    await fetchToolPlazaCategories();
    await fetchToolPlazaList();
  } catch (_) {
    state.toolPlazaPublishError = "网络错误，请重试";
    state.toolPlazaPublishLoading = false;
    requestRender();
  }
}

async function deleteToolPlazaItem(itemId, itemNo = "") {
  const itemIdNum = Number(itemId) || 0;
  if (itemIdNum <= 0) return;
  if (!window.confirm("确定删除此资源？此操作不可恢复。")) return;
  const op = getCurrentOperator();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ops-tool-plaza/items/${itemIdNum}?operator_id=${encodeURIComponent(op.account)}`,
      { method: "DELETE" }
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      window.alert(j.detail || "删除失败");
      return;
    }
    const no = String(itemNo || "").trim();
    if (no) closeToolPlazaItemTab(no);
    state.toolPlazaNeedsRefresh = true;
    await fetchToolPlazaCategories();
    await fetchToolPlazaList();
  } catch (_) {
    window.alert("网络错误，请重试");
  }
}

function syncPublishPreviewPane(paneId, text, emptyHint) {
  const preview = document.getElementById(paneId);
  if (!preview) return;
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    preview.className = "tp-publish-preview-pane tp-publish-preview-pane--empty";
    preview.textContent = emptyHint;
    return;
  }
  preview.className = "tp-publish-preview-pane tp-md-preview";
  preview.innerHTML = renderMarkdown(text);
}

function syncPublishUsagePreview(text) {
  syncPublishPreviewPane("tp-publish-usage-preview", text, "填写使用方式后将在此预览 Markdown 效果");
}

function syncPublishDetailPreview(text) {
  syncPublishPreviewPane("tp-publish-detail-preview", text, "填写详情后将在此预览 Markdown 效果");
}

export function bindToolPlazaPage() {
  if (_tpBound) return;
  _tpBound = true;

  const runToolPlazaSearchFetch = () => {
    const el = document.getElementById("tp-search-input");
    setListSearchDebouncePending(false);
    setListSearchFetchPending(true);
    armListSearchFocusRestore(el);
    markSkipListLoadingRender();
    state.toolPlazaListPage = 1;
    void Promise.resolve(fetchToolPlazaList()).finally(() => {
      setListSearchFetchPending(false);
      flushDeferredListSearchRender();
    });
  };

  const scheduleToolPlazaSearch = () => {
    setListSearchDebouncePending(true);
    clearTimeout(_tpSearchDebounceTimer);
    _tpSearchDebounceTimer = setTimeout(() => {
      _tpSearchDebounceTimer = null;
      runToolPlazaSearchFetch();
    }, TP_SEARCH_DEBOUNCE_MS);
  };

  const runToolPlazaSearchNow = () => {
    clearTimeout(_tpSearchDebounceTimer);
    _tpSearchDebounceTimer = null;
    releaseListSearchRenderHold();
    runToolPlazaSearchFetch();
  };

  document.addEventListener("focusin", (e) => {
    if (e.target?.id === "tp-search-input") {
      registerListSearchInput(e.target);
      noteListSearchInputEvent(e.target, "activity");
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "tp-search-input") {
      registerListSearchInput(e.target);
      noteListSearchInputEvent(e.target, "activity");
      state.toolPlazaSearch = e.target.value || "";
      if (e.isComposing) return;
      scheduleToolPlazaSearch();
    }
    if (e.target.id === "tp-publish-title-input") state.toolPlazaPublishTitle = e.target.value;
    if (e.target.id === "tp-publish-category-input") state.toolPlazaPublishCategory = e.target.value;
    if (e.target.id === "tp-publish-detail-input") {
      state.toolPlazaPublishDetail = e.target.value;
      syncPublishDetailPreview(e.target.value);
    }
    if (e.target.id === "tp-publish-usage-input") {
      state.toolPlazaPublishUsage = e.target.value;
      syncPublishUsagePreview(e.target.value);
    }
  });

  document.addEventListener("compositionstart", (e) => {
    if (e.target.id === "tp-search-input") {
      registerListSearchInput(e.target);
      noteListSearchInputEvent(e.target, "compositionstart");
    }
  });

  document.addEventListener("compositionend", (e) => {
    if (e.target.id === "tp-search-input") {
      noteListSearchInputEvent(e.target, "compositionend");
      state.toolPlazaSearch = e.target.value || "";
      scheduleToolPlazaSearch();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id === "tp-search-input" && e.key === "Enter") {
      state.toolPlazaSearch = e.target.value || "";
      runToolPlazaSearchNow();
    }
    if (e.target.id === "tp-page-jump" && e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
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
      state.toolPlazaListPageSize = Number(e.target.value) || 18;
      state.toolPlazaListPage = 1;
      fetchToolPlazaList();
    }
    if (e.target.id === "tp-page-jump") {
      const pageSize = Number(state.toolPlazaListPageSize) || 18;
      const totalPages = Math.max(1, Math.ceil((state.toolPlazaListTotal || 0) / pageSize));
      const raw = Math.floor(Number(e.target.value));
      const next = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, totalPages) : (state.toolPlazaListPage || 1);
      e.target.value = String(next);
      if (next !== state.toolPlazaListPage) {
        state.toolPlazaListPage = next;
        fetchToolPlazaList();
      }
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
    if (e.target.closest("[data-tp-like-id]")) {
      const likeBtn = e.target.closest("[data-tp-like-id]");
      e.preventDefault();
      e.stopPropagation();
      const likeId = Number(likeBtn.getAttribute("data-tp-like-id")) || 0;
      try {
        likeBtn.disabled = true;
        await toggleToolPlazaLike(likeId);
      } catch (err) {
        window.alert(err.message || "操作失败");
      } finally {
        const btn = document.querySelector(`[data-tp-like-id="${likeId}"]`);
        if (btn) btn.disabled = false;
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
    if (e.target.id === "tp-detail-edit") {
      const detail = getActiveToolPlazaItemDetail();
      if (detail) openEditModal(detail);
      return;
    }
    if (e.target.id === "tp-detail-delete") {
      const detail = getActiveToolPlazaItemDetail();
      if (detail?.id) await deleteToolPlazaItem(detail.id, detail.item_no);
      return;
    }
    if (e.target.closest("#tp-detail-download")) {
      const detail = getActiveToolPlazaItemDetail();
      const btn = e.target.closest("#tp-detail-download");
      try {
        if (btn) btn.disabled = true;
        await triggerToolPlazaDownload(detail);
      } catch (err) {
        alert(err.message || "下载失败");
      } finally {
        if (btn) btn.disabled = false;
      }
      return;
    }
    if (e.target.closest("#tp-detail-copy-link")) {
      const copyBtn = e.target.closest("#tp-detail-copy-link");
      const itemNo = copyBtn?.getAttribute("data-tp-item-no") || "";
      const url = `${window.location.origin}${toolPlazaItemUrl(itemNo)}`;
      try {
        await navigator.clipboard.writeText(url);
        if (copyBtn) copyBtn.textContent = "已复制";
        setTimeout(() => {
          const btn = document.getElementById("tp-detail-copy-link");
          if (btn) btn.textContent = "分享链接";
        }, 1500);
      } catch (_) {
        window.prompt("复制链接", url);
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
      const itemNo = card.getAttribute("data-tp-item-no") || "";
      const id = Number(card.getAttribute("data-tp-card-id"));
      const it =
        (state.toolPlazaList || []).find((x) => String(x.item_no || "") === itemNo) ||
        (itemNo ? { item_no: itemNo, id } : null);
      if (it?.item_no) openToolPlazaItem(it);
      return;
    }
    if (e.target.id === "tp-publish-mask") closePublishModal();
  });

  document.addEventListener("keydown", (e) => {
    const card = e.target.closest("[data-tp-card-id]");
    if (card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      const itemNo = card.getAttribute("data-tp-item-no") || "";
      const id = Number(card.getAttribute("data-tp-card-id"));
      const it =
        (state.toolPlazaList || []).find((x) => String(x.item_no || "") === itemNo) ||
        (itemNo ? { item_no: itemNo, id } : null);
      if (it?.item_no) openToolPlazaItem(it);
    }
  });
}
