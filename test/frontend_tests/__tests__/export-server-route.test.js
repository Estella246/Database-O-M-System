/**
 * 与 frontend/modules/pages/export-modal.js 中 shouldUseServerExport 逻辑一致。
 */
const CLIENT_EXPORT_MAX = 500;

function shouldUseServerExport(state, exportCount) {
  return (state.ticketListServerPaged && state.activeKey === "list") || exportCount > CLIENT_EXPORT_MAX;
}

describe("shouldUseServerExport", () => {
  test("服务端分页工作台列表始终走服务端导出", () => {
    expect(
      shouldUseServerExport({ ticketListServerPaged: true, activeKey: "list" }, 3)
    ).toBe(true);
    expect(
      shouldUseServerExport({ ticketListServerPaged: true, activeKey: "list" }, 20000)
    ).toBe(true);
  });

  test("非服务端分页且条数不超过上限时走浏览器导出", () => {
    expect(
      shouldUseServerExport({ ticketListServerPaged: false, activeKey: "list" }, 100)
    ).toBe(false);
  });

  test("条数超过上限时走服务端导出", () => {
    expect(
      shouldUseServerExport({ ticketListServerPaged: false, activeKey: "patch:list" }, 501)
    ).toBe(true);
  });
});
