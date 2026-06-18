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
  test("输入时立即同步 state.siteProfileSearch，避免重绘清空搜索词", () => {
    expect(src).toMatch(
      /state\.siteProfileSearch\s*=\s*searchInput\.value\s*\|\|\s*""/,
    );
  });

  test("支持中文输入法 composition 与 Enter 立即搜索", () => {
    expect(src).toContain("ev.isComposing");
    expect(src).toContain('addEventListener("compositionend"');
    expect(src).toContain('ev.key !== "Enter"');
    expect(src).toContain("SP_SEARCH_DEBOUNCE_MS = 800");
  });

  test("列表拉取与导出仍使用 siteProfileSearch", () => {
    expect(src).toContain("state.siteProfileSearch.trim()");
    expect(src).toContain("fetchSiteProfileList");
    expect(src).toContain("handleSiteProfileExport");
  });
});
