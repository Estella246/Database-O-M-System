/**
 * 列表搜索框统一走 bindListSearchInput / 焦点恢复 / 跳过 loading 整页 render。
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../frontend");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pages = [
  {
    file: "modules/pages/site-profile-page.js",
    bind: "bindListSearchInput",
    consume: "consumeSkipListLoadingRender",
    stateKey: "siteProfileSearch",
  },
  {
    file: "modules/pages/leave-page.js",
    bind: "bindListSearchInput",
    consume: "consumeSkipListLoadingRender",
    stateKey: "leaveSearch",
  },
  {
    file: "modules/pages/requirement-page.js",
    bind: "bindListSearchInput",
    consume: "consumeSkipListLoadingRender",
    stateKey: "reqSearch",
  },
  {
    file: "modules/pages/major-issue-page.js",
    bind: "bindListSearchInput",
    consume: "consumeSkipListLoadingRender",
    stateKey: "majorIssueSearch",
  },
  {
    file: "modules/pages/major-problem-page.js",
    bind: "bindListSearchInput",
    consume: "consumeSkipListLoadingRender",
    stateKey: "majorProblemSearch",
  },
  {
    file: "modules/pages/migrate-legacy-modal.js",
    bind: "bindListSearchInput",
    consume: "consumeSkipListLoadingRender",
    stateKey: "migrateLegacySearch",
  },
  {
    file: "modules/pages/admin-page.js",
    bind: "bindListSearchInput",
    consume: null,
    stateKey: "adminUserSearch",
  },
  {
    file: "modules/pages/column-select-modal.js",
    bind: "bindListSearchInput",
    consume: null,
    stateKey: "columnSelectSearchKeyword",
  },
  {
    file: "modules/pages/params-page.js",
    bind: "bindListSearchInput",
    consume: null,
    stateKey: "versionBaselineSearch",
  },
  {
    file: "modules/pages/tool-plaza-page.js",
    bind: "armListSearchFocusRestore",
    consume: "consumeSkipListLoadingRender",
    stateKey: "toolPlazaSearch",
  },
];

describe("全站列表搜索框对齐工作台原则", () => {
  test.each(pages)("$file 使用公共搜索约定", ({ file, bind, consume, stateKey }) => {
    const src = read(file);
    expect(src).toContain(bind);
    expect(src).toContain(stateKey);
    if (consume) expect(src).toContain(consume);
  });

  test("params 版本双搜索框均绑定", () => {
    const src = read("modules/pages/params-page.js");
    expect(src).toContain("version-search-baseline");
    expect(src).toContain("version-search-hotfix");
    expect(src).toContain("versionHotfixSearch");
  });

  test("app.js render 末尾恢复搜索焦点，入口挂起输入中的 render", () => {
    const src = read("app.js");
    expect(src).toContain("restoreListSearchFocus()");
    expect(src).toContain("armListSearchFocusRestore");
    expect(src).toContain("shouldDeferListSearchRender");
    expect(src).toContain("markListSearchRenderDeferred");
  });

  test("列筛选弹层 apply 前 arm 焦点", () => {
    const src = read("modules/ui/column-filter-pop.js");
    expect(src).toContain("armListSearchFocusRestore");
  });
});
