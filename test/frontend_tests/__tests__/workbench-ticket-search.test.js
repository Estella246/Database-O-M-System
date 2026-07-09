/**
 * 工作台列表搜索：立即写 state、中文输入法、800ms 防抖、Enter 立即搜索、
 * 拉数前不整页 render；输入期间挂起 render，停手后再刷。
 */
const fs = require("fs");
const path = require("path");

const APP_JS = path.resolve(__dirname, "../../../frontend/app.js");
const LIST_SEARCH = path.resolve(
  __dirname,
  "../../../frontend/modules/ui/list-search-input.js",
);
const appSrc = fs.readFileSync(APP_JS, "utf8");
const listSearchSrc = fs.readFileSync(LIST_SEARCH, "utf8");

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
    expect(searchBlock).toContain("compositionend");
    expect(searchBlock).toContain('ev.key !== "Enter"');
    expect(searchBlock).toContain("releaseListSearchRenderHold");
  });

  test("防抖为 800ms", () => {
    expect(searchBlock).toContain("TICKET_SEARCH_DEBOUNCE_MS = 800");
  });

  test("拉数前不整页 render，并用公共焦点恢复", () => {
    expect(searchBlock).toContain("setListRefreshingUi");
    expect(searchBlock).toContain("armListSearchFocusRestore");
    expect(searchBlock).toContain("registerListSearchInput");
    expect(appSrc).toContain("restoreListSearchFocus()");
    expect(appSrc).toContain("shouldDeferListSearchRender");
    expect(appSrc).toContain("markListSearchRenderDeferred");
    const runFn = searchBlock.slice(
      searchBlock.indexOf("const runTicketSearchRefresh"),
      searchBlock.indexOf("const scheduleTicketSearchRefresh"),
    );
    expect(runFn).not.toMatch(/setListRefreshingUi\(true\);\s*render\(\)/);
  });
});

describe("list-search-input 公共工具", () => {
  test("提供 bind / arm / restore / skip loading / 挂起 render", () => {
    expect(listSearchSrc).toContain("export function bindListSearchInput");
    expect(listSearchSrc).toContain("export function armListSearchFocusRestore");
    expect(listSearchSrc).toContain("export function restoreListSearchFocus");
    expect(listSearchSrc).toContain("export function markSkipListLoadingRender");
    expect(listSearchSrc).toContain("export function consumeSkipListLoadingRender");
    expect(listSearchSrc).toContain("export function shouldDeferListSearchRender");
    expect(listSearchSrc).toContain("export function markListSearchRenderDeferred");
    expect(listSearchSrc).toContain("export function flushDeferredListSearchRender");
    expect(listSearchSrc).toContain("export function releaseListSearchRenderHold");
    expect(listSearchSrc).toContain("ev.isComposing");
    expect(listSearchSrc).toContain("compositionend");
    expect(listSearchSrc).toContain('ev.key !== "Enter"');
  });
});
