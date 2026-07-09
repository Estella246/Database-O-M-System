/**
 * 局点档案 - 前端模块自检
 * 对应模块：frontend/modules/pages/site-profile-page.js
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/site-profile-page.js",
);
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("site-profile-page.js 搜索框与工作台一致", () => {
  test("使用 bindListSearchInput 并立即同步 siteProfileSearch", () => {
    expect(src).toContain("bindListSearchInput");
    expect(src).toMatch(/state\.siteProfileSearch\s*=\s*v/);
  });

  test("防抖 800ms，并跳过搜索触发的 loading 整页 render", () => {
    expect(src).toContain("SP_SEARCH_DEBOUNCE_MS = 800");
    expect(src).toContain("consumeSkipListLoadingRender");
  });

  test("列表拉取与导出仍使用 siteProfileSearch", () => {
    expect(src).toContain("state.siteProfileSearch.trim()");
    expect(src).toContain("fetchSiteProfileList");
    expect(src).toContain("handleSiteProfileExport");
  });
});
