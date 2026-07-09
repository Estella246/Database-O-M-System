/**
 * 列表搜索：输入/拼音期间挂起整页 render（方案 A）静态契约。
 */
const fs = require("fs");
const path = require("path");

const LIST_SEARCH = path.resolve(
  __dirname,
  "../../../frontend/modules/ui/list-search-input.js",
);
const APP_JS = path.resolve(__dirname, "../../../frontend/app.js");
const listSearchSrc = fs.readFileSync(LIST_SEARCH, "utf8");
const appSrc = fs.readFileSync(APP_JS, "utf8");

describe("list search defer render (方案 A)", () => {
  test("公共模块导出挂起 / 冲刷 / 释放 API", () => {
    expect(listSearchSrc).toContain("export function shouldDeferListSearchRender");
    expect(listSearchSrc).toContain("export function markListSearchRenderDeferred");
    expect(listSearchSrc).toContain("export function flushDeferredListSearchRender");
    expect(listSearchSrc).toContain("export function releaseListSearchRenderHold");
    expect(listSearchSrc).toContain("LIST_SEARCH_RENDER_QUIET_MS");
    expect(listSearchSrc).toContain("compositionstart");
    expect(listSearchSrc).toContain("_composing");
  });

  test("app.js render 入口在输入期间挂起", () => {
    expect(appSrc).toMatch(
      /function render\(\)\s*\{[\s\S]*?shouldDeferListSearchRender\(\)[\s\S]*?markListSearchRenderDeferred\(\)[\s\S]*?return;/,
    );
    expect(appSrc).toContain("armActiveListSearchFocusRestore");
  });

  test("Enter 立即搜索时释放挂起窗口", () => {
    expect(appSrc).toContain("releaseListSearchRenderHold");
    expect(listSearchSrc).toMatch(
      /ev\.key !== "Enter"[\s\S]*?releaseListSearchRenderHold\(\)/,
    );
  });
});
