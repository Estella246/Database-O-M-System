/**
 * 工作台/主页服务端翻页：拉数前不得整页 render，避免旧页 rowIn 先播一遍、新页再播一遍。
 * （远程/Windows 延迟更明显；本地 Mac 往往几乎看不出。）
 */
const fs = require("fs");
const path = require("path");

const APP_JS = path.resolve(__dirname, "../../../frontend/app.js");
const appSrc = fs.readFileSync(APP_JS, "utf8");

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) return "";
  const end = src.indexOf(endNeedle, start);
  return src.slice(start, end > start ? end : start + 800);
}

describe("workbench list pagination animation", () => {
  test("提供就地 listRefreshing UI，勿依赖中间帧整页 render", () => {
    expect(appSrc).toContain("function setListRefreshingUi(refreshing)");
    expect(appSrc).toContain("function setHomeListRefreshingUi(refreshing)");
    expect(appSrc).toMatch(/翻页\/刷新拉数：就地标/);
  });

  test("syncListPageFromServer：拉数前不 render，完成后只 render 一次", () => {
    const block = sliceBetween(
      appSrc,
      "const syncListPageFromServer = () => {",
      "const pageSizeSelect = document.getElementById(\"list-page-size\");",
    );
    expect(block).toContain("setListRefreshingUi(true)");
    expect(block).toContain("resyncWorkbenchTicketList()");
    expect(block).toMatch(/setListRefreshingUi\(false\);\s*render\(\)/);
    expect(block).not.toMatch(/setListRefreshingUi\(true\);\s*render\(\)/);
    expect(block).not.toMatch(/listRefreshing\s*=\s*true;\s*render\(\)/);
  });

  test("patchNav syncWorkbenchPage：同样避免中间帧 render", () => {
    const block = sliceBetween(
      appSrc,
      "const syncWorkbenchPage = () => {",
      "patchListPaginationControls({\n      wrapId: \"list-pagination\"",
    );
    expect(block).toContain("setListRefreshingUi(true)");
    expect(block).toMatch(/setListRefreshingUi\(false\);\s*render\(\)/);
    expect(block).not.toMatch(/setListRefreshingUi\(true\);\s*render\(\)/);
  });

  test("主页 syncHomePage：拉数前不 render", () => {
    const occurrences = [];
    let from = 0;
    while (true) {
      const start = appSrc.indexOf("const syncHomePage = () => {", from);
      if (start < 0) break;
      const end = appSrc.indexOf("};", start);
      occurrences.push(appSrc.slice(start, end > start ? end + 2 : start + 400));
      from = start + 1;
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    for (const block of occurrences) {
      expect(block).toContain("setHomeListRefreshingUi(true)");
      expect(block).toMatch(/setHomeListRefreshingUi\(false\);\s*render\(\)/);
      expect(block).not.toMatch(/setHomeListRefreshingUi\(true\);\s*render\(\)/);
      expect(block).not.toMatch(/homeListRefreshing\s*=\s*true;\s*render\(\)/);
    }
  });

  test("列表刷新按钮：拉数前不整页 render", () => {
    const block = sliceBetween(
      appSrc,
      'const listRefreshBtn = document.getElementById("list-refresh-btn");',
      "ticket-list-search-input",
    );
    expect(block).toContain("setListRefreshingUi(true)");
    expect(block).not.toMatch(/setListRefreshingUi\(true\);\s*render\(\)/);
    expect(block).not.toMatch(/listRefreshing\s*=\s*true;\s*render\(\)/);
  });
});
