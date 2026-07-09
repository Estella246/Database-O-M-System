/**
 * 工作台列表搜索：立即写 state、中文输入法、800ms 防抖、Enter 立即搜索、
 * 拉数前不整页 render、拉数后恢复搜索框焦点。
 */
const fs = require("fs");
const path = require("path");

const APP_JS = path.resolve(__dirname, "../../../frontend/app.js");
const appSrc = fs.readFileSync(APP_JS, "utf8");

const searchBlock = (() => {
  const start = appSrc.indexOf("ticket-list-search-input");
  const end = appSrc.indexOf("placeTabIndicator(active)", start);
  return appSrc.slice(start, end > start ? end : start + 4000);
})();

describe("workbench ticket list search", () => {
  test("输入时立即同步 state.ticketListSearch", () => {
    expect(searchBlock).toMatch(
      /state\.ticketListSearch\s*=\s*searchInput\.value\s*\|\|\s*""/,
    );
  });

  test("支持中文输入法 composition 与 Enter 立即搜索", () => {
    expect(searchBlock).toContain("ev.isComposing");
    expect(searchBlock).toContain('addEventListener("compositionend"');
    expect(searchBlock).toContain('ev.key !== "Enter"');
  });

  test("防抖为 800ms", () => {
    expect(searchBlock).toContain("TICKET_SEARCH_DEBOUNCE_MS = 800");
  });

  test("拉数前不整页 render，拉数后恢复搜索框焦点", () => {
    expect(searchBlock).toContain("setListRefreshingUi");
    expect(searchBlock).toContain("captureTicketSearchCaret");
    expect(searchBlock).toContain("restoreTicketSearchFocus");
    expect(searchBlock).toMatch(/runTicketSearchRefresh[\s\S]*setListRefreshingUi\(true\)/);
    expect(searchBlock).toMatch(
      /finally\s*\{[\s\S]*setListRefreshingUi\(false\)[\s\S]*render\(\)[\s\S]*restoreTicketSearchFocus\(\)/,
    );
    // 拉数前不得为 listRefreshing 单独整页 render
    const runFn = searchBlock.slice(
      searchBlock.indexOf("const runTicketSearchRefresh"),
      searchBlock.indexOf("const scheduleTicketSearchRefresh"),
    );
    expect(runFn).not.toMatch(/setListRefreshingUi\(true\);\s*render\(\)/);
    expect(runFn).not.toMatch(/listRefreshing\s*=\s*true;\s*render\(\)/);
  });
});
