/**
 * 工具广场热度 / 火苗 / 下载 URL 静态契约（与 tool-plaza-page.js 一致）。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/tool-plaza-page.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("tool-plaza heat formula", () => {
  test("heat = 2L + D", () => {
    expect(src).toMatch(/return\s+2\s*\*\s*Math\.max\(0,\s*Number\(likeCount\)/);
    expect(src).toMatch(/heatScore\(target\.like_count,\s*target\.download_count\)/);
  });
});

describe("tool-plaza hotFireHtml uses heat_score", () => {
  test("tiers by heat without numeric heat value", () => {
    expect(src).toMatch(/if\s*\(n\s*>=\s*40\)\s*tier\s*=\s*"blaze"/);
    expect(src).toMatch(/else if\s*\(n\s*>=\s*10\)\s*tier\s*=\s*"hot"/);
    expect(src).toMatch(/title="热度"/);
    expect(src).not.toMatch(/tp-hot-fire__count/);
    expect(src).toMatch(/hotFireHtml\(it\.heat_score/);
    expect(src).toMatch(/downloadCountHtml\(it\.download_count\)/);
  });
});

describe("tool-plaza like UI wiring", () => {
  test("exposes like toggle with like count", () => {
    expect(src).toMatch(/export async function toggleToolPlazaLike/);
    expect(src).toMatch(/data-tp-like-id=/);
    expect(src).toMatch(/\/api\/ops-tool-plaza\/items\/\$\{id\}\/like/);
    expect(src).toMatch(/tp-like-btn__count/);
    expect(src).toMatch(/liked \? "♥" : "♡"/);
  });
});

describe("needsToolPlazaDetailFetch / download URL still present", () => {
  test("detail fetch helper and download URL builder exist", () => {
    expect(src).toMatch(/export function needsToolPlazaDetailFetch/);
    expect(src).toMatch(/export function toolPlazaDownloadUrl/);
    expect(src).toMatch(/\/api\/ops-tool-plaza\/items\/\$\{encodeURIComponent\(String\(itemId\)\)\}\/download/);
  });
});
