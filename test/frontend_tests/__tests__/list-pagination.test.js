/**
 * 列表客户端分页工具单元测试（与 frontend/modules/utils/list-pagination.js 一致）
 */

const LIST_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function clampListPage(totalItems, page, pageSize) {
  const ps = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const total = Math.max(0, Number(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return { pageSize: ps, totalPages, currentPage, totalItems: total };
}

function normalizeListPageJump(raw, totalPages, fallback = 1) {
  const tp = Math.max(1, Math.floor(Number(totalPages)) || 1);
  const fb = Math.min(Math.max(1, Math.floor(Number(fallback)) || 1), tp);
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fb;
  return Math.min(n, tp);
}

function sliceForListPage(items, currentPage, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const start = (currentPage - 1) * pageSize;
  return list.slice(start, start + pageSize);
}

function renderListPageJumpHtml(inputId, currentPage, totalPages) {
  const tp = Math.max(1, Math.floor(Number(totalPages)) || 1);
  const page = normalizeListPageJump(currentPage, tp, 1);
  return `<label class="list-pagination-jump">
          <span class="list-pagination-jump-text">前往</span>
          <input type="number" id="${inputId}" class="list-page-jump" min="1" max="${tp}" step="1" value="${page}" aria-label="前往第几页" />
          <span class="list-pagination-jump-suffix">页</span>
        </label>`;
}

describe("list-pagination", () => {
  test("LIST_PAGE_SIZE_OPTIONS 包含常用档位", () => {
    expect(LIST_PAGE_SIZE_OPTIONS).toEqual([10, 20, 50, 100]);
  });

  test("clampListPage 在总数为 0 时仍至少有 1 页", () => {
    const pg = clampListPage(0, 5, 10);
    expect(pg.totalPages).toBe(1);
    expect(pg.currentPage).toBe(1);
    expect(pg.totalItems).toBe(0);
  });

  test("clampListPage 将越界页码收拢到末页", () => {
    const pg = clampListPage(25, 99, 10);
    expect(pg.totalPages).toBe(3);
    expect(pg.currentPage).toBe(3);
  });

  test("sliceForListPage 按页切片", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(sliceForListPage(items, 2, 5)).toEqual([6, 7, 8, 9, 10]);
    expect(sliceForListPage(items, 3, 5)).toEqual([11]);
  });

  test("normalizeListPageJump 将越界页码收拢到末页", () => {
    expect(normalizeListPageJump(99, 5, 1)).toBe(5);
    expect(normalizeListPageJump(0, 5, 2)).toBe(2);
    expect(normalizeListPageJump("abc", 5, 3)).toBe(3);
    expect(normalizeListPageJump(3, 5, 1)).toBe(3);
  });

  test("renderListPageJumpHtml 含前往输入框", () => {
    const html = renderListPageJumpHtml("list-page-jump", 2, 8);
    expect(html).toContain('id="list-page-jump"');
    expect(html).toContain('value="2"');
    expect(html).toContain('max="8"');
    expect(html).toContain("前往");
  });
});
