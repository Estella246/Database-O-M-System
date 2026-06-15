/**
 * 运维效率页刷新防重入：避免 needsRefresh 在请求完成前反复触发 refreshOncallEvaPage 导致卡死。
 */
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/oncall-eva-page.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("oncall-eva refresh guard", () => {
  test("refresh 开始时清除 needsRefresh 并加 in-flight 锁", () => {
    const fnBlock = src.slice(src.indexOf("export async function refreshOncallEvaPage"));
    expect(fnBlock).toMatch(/if\s*\(\s*oncallEvaRefreshInFlight\s*\)\s*return/);
    expect(fnBlock).toMatch(/oncallEvaRefreshInFlight\s*=\s*true/);
    expect(fnBlock).toMatch(/state\.oncallEvaNeedsRefresh\s*=\s*false/);
    expect(fnBlock).toMatch(/oncallEvaRefreshInFlight\s*=\s*false/);
  });

  test("批量刷新期间抑制 fetch 触发的中间重绘", () => {
    expect(src).toMatch(/suppressOncallEvaFetchRenders/);
    expect(src).toMatch(/maybeRequestRenderAfterFetch/);
    const fnBlock = src.slice(src.indexOf("export async function refreshOncallEvaPage"));
    expect(fnBlock).toMatch(/suppressOncallEvaFetchRenders\s*=\s*true/);
    expect(fnBlock).toMatch(/suppressOncallEvaFetchRenders\s*=\s*false/);
  });

  test("bindOncallEvaPage 仅在 needsRefresh 时触发 refresh", () => {
    const bindBlock = src.slice(src.indexOf("export function bindOncallEvaPage"));
    expect(bindBlock).toMatch(/if\s*\(\s*state\.oncallEvaNeedsRefresh\s*\)\s*refreshOncallEvaPage\(\)/);
  });
});
