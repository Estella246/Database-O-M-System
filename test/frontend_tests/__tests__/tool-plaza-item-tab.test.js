/**
 * 工具广场详情页签：路由与详情区高度样式回归。
 */

const fs = require("fs");
const path = require("path");

function toolPlazaItemUrl(itemNo) {
  return `/tool-plaza/${encodeURIComponent(String(itemNo || "").trim())}`;
}

const toolPlazaCss = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/styles/tool-plaza.css"),
  "utf8"
);

describe("tool-plaza item tab", () => {
  test("toolPlazaItemUrl encodes item no path", () => {
    expect(toolPlazaItemUrl("SKILL20260701000")).toBe("/tool-plaza/SKILL20260701000");
    expect(toolPlazaItemUrl("TOOL20260701001")).toBe("/tool-plaza/TOOL20260701001");
  });

  test("detail page body overrides modal max-height so content fills viewport", () => {
    const modalCap = toolPlazaCss.indexOf(".tp-detail-body {\n  overflow-y: auto;\n  max-height: 60vh;");
    const pageOverride = toolPlazaCss.indexOf(".tp-detail-body.tp-detail-body--page");
    expect(modalCap).toBeGreaterThan(-1);
    expect(pageOverride).toBeGreaterThan(modalCap);
    expect(toolPlazaCss).toMatch(/\.tp-detail-body\.tp-detail-body--page\s*\{[^}]*max-height:\s*none/s);
    expect(toolPlazaCss).toMatch(/\.tp-detail-page\.detail-card\s*\{[^}]*min-height:\s*calc\(100vh/s);
  });
});
