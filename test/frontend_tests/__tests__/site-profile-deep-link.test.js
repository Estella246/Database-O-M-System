/**
 * 局点档案深链与 URL 映射须与 ticket-core.js 一致，避免刷新被误解析为工单。
 */
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/ticket-core.js",
);
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("ticket-core.js 局点档案深链", () => {
  test("getUrlByKey 将 site:profile 映射到 /site-profiles", () => {
    expect(src).toMatch(
      /if\s*\(\s*key\s*===\s*"site:profile"\s*\)\s*return\s*"\/site-profiles"/,
    );
  });

  test("syncActiveKeyFromPath 识别 /site-profiles 并刷新列表", () => {
    expect(src).toMatch(/pathname\s*===\s*"\/site-profiles"/);
    expect(src).toMatch(/ensureSiteProfileTab\(\)/);
    expect(src).toMatch(/state\.siteProfileNeedsRefresh\s*=\s*true/);
  });

  test("getActiveTicket 不把 site:profile 当作工单详情", () => {
    expect(src).toMatch(/state\.activeKey\s*===\s*"site:profile"/);
  });
});
