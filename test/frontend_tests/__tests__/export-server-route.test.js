/**
 * 与 frontend/modules/pages/export-modal.js 中 shouldUseAsyncServerExport 逻辑一致。
 */
const CLIENT_EXPORT_MAX = 500;

function shouldUseAsyncServerExport(exportCount) {
  return exportCount > CLIENT_EXPORT_MAX;
}

describe("shouldUseAsyncServerExport", () => {
  test("条数不超过上限时走同步 export-file（含服务端分页工作台小批量）", () => {
    expect(shouldUseAsyncServerExport(3)).toBe(false);
    expect(shouldUseAsyncServerExport(500)).toBe(false);
  });

  test("条数超过上限时走异步 export-tasks", () => {
    expect(shouldUseAsyncServerExport(501)).toBe(true);
    expect(shouldUseAsyncServerExport(20000)).toBe(true);
  });
});
