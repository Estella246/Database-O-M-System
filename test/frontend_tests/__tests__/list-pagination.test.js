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

function sliceForListPage(items, currentPage, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const start = (currentPage - 1) * pageSize;
  return list.slice(start, start + pageSize);
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
});
