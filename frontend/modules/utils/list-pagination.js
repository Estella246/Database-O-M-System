/** 列表客户端分页：与工单工作台、重大问题列表一致的交互 */

export const LIST_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function clampListPage(totalItems, page, pageSize) {
  const ps = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const total = Math.max(0, Number(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return { pageSize: ps, totalPages, currentPage, totalItems: total };
}

/** 将用户输入的页码收拢到 [1, totalPages]；非法值回退 fallback（默认当前页） */
export function normalizeListPageJump(raw, totalPages, fallback = 1) {
  const tp = Math.max(1, Math.floor(Number(totalPages)) || 1);
  const fb = Math.min(Math.max(1, Math.floor(Number(fallback)) || 1), tp);
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fb;
  return Math.min(n, tp);
}

export function sliceForListPage(items, currentPage, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const start = (currentPage - 1) * pageSize;
  return list.slice(start, start + pageSize);
}

export function renderListPageJumpHtml(inputId, currentPage, totalPages) {
  const tp = Math.max(1, Math.floor(Number(totalPages)) || 1);
  const page = normalizeListPageJump(currentPage, tp, 1);
  return `<label class="list-pagination-jump">
          <span class="list-pagination-jump-text">前往</span>
          <input type="number" id="${inputId}" class="list-page-jump" min="1" max="${tp}" step="1" value="${page}" aria-label="前往第几页" />
          <span class="list-pagination-jump-suffix">页</span>
        </label>`;
}

export function renderListPaginationHtml({
  wrapId,
  totalItems,
  currentPage,
  totalPages,
  pageSize,
  pageSizeSelectId,
  prevId,
  nextId,
  pageJumpId,
}) {
  const sizeOptions = LIST_PAGE_SIZE_OPTIONS.map(
    (size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`,
  ).join("");
  const jumpId =
    pageJumpId ||
    (pageSizeSelectId ? String(pageSizeSelectId).replace(/-page-size$/, "-page-jump") : "list-page-jump");
  return `
    <div id="${wrapId}" class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${totalItems} 条，第 ${currentPage}/${totalPages} 页</span>
        <label class="list-pagination-size">
          <span class="list-pagination-size-text">每页</span>
          <select id="${pageSizeSelectId}" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
          <span class="list-pagination-size-suffix">条</span>
        </label>
        <div class="list-pagination-nav">
          <button class="action list-page-btn" type="button" id="${prevId}" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="action list-page-btn" type="button" id="${nextId}" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
        ${renderListPageJumpHtml(jumpId, currentPage, totalPages)}
      </div>
    </div>`;
}

/**
 * 绑定前往第 n 页输入：失焦或 Enter 时提交；非法值回退当前页，超过总页数则截断。
 * 页码未变时不触发回调。使用 onchange/onkeydown 属性赋值，便于重复绑定。
 */
export function bindListPageJumpInput(el, { totalPages, currentPage = 1, onPageChange } = {}) {
  if (!el || typeof onPageChange !== "function") return;
  const tp = Math.max(1, Math.floor(Number(totalPages)) || 1);
  let lastCommitted = normalizeListPageJump(el.value, tp, currentPage);
  el.max = String(tp);
  const commit = () => {
    const next = normalizeListPageJump(el.value, tp, lastCommitted);
    el.value = String(next);
    if (next === lastCommitted) return;
    lastCommitted = next;
    onPageChange(next);
  };
  el.onchange = commit;
  el.onkeydown = (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    commit();
    el.blur();
  };
}

export function bindListPagination(
  root,
  {
    pageSizeSelectId,
    prevId,
    nextId,
    pageJumpId,
    totalPages,
    currentPage,
    onPageSizeChange,
    onPrev,
    onNext,
    onPageChange,
  },
) {
  const scope = root && typeof root.querySelector === "function" ? root : document;
  scope.querySelector(`#${pageSizeSelectId}`)?.addEventListener("change", (ev) => {
    onPageSizeChange(Number(ev.target.value) || 10);
  });
  scope.querySelector(`#${prevId}`)?.addEventListener("click", () => {
    onPrev();
  });
  scope.querySelector(`#${nextId}`)?.addEventListener("click", () => {
    onNext();
  });
  const jumpId =
    pageJumpId ||
    (pageSizeSelectId ? String(pageSizeSelectId).replace(/-page-size$/, "-page-jump") : "");
  if (jumpId && typeof onPageChange === "function") {
    bindListPageJumpInput(scope.querySelector(`#${jumpId}`), {
      totalPages,
      currentPage,
      onPageChange,
    });
  }
}
