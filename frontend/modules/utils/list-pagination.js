/** 列表客户端分页：与工单工作台、重大问题列表一致的交互 */

export const LIST_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function clampListPage(totalItems, page, pageSize) {
  const ps = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const total = Math.max(0, Number(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return { pageSize: ps, totalPages, currentPage, totalItems: total };
}

export function sliceForListPage(items, currentPage, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const start = (currentPage - 1) * pageSize;
  return list.slice(start, start + pageSize);
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
}) {
  const sizeOptions = LIST_PAGE_SIZE_OPTIONS.map(
    (size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`,
  ).join("");
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
      </div>
    </div>`;
}

export function bindListPagination(root, { pageSizeSelectId, prevId, nextId, onPageSizeChange, onPrev, onNext }) {
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
}
