/**
 * 迁入弹窗搜索：立即写 state、中文输入法、防抖请求老库、Enter 立即搜索。
 * node --test test/frontend_tests/__tests__/migrate-legacy-search.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(__dirname, "../../../frontend/modules/pages/migrate-legacy-modal.js"),
  "utf8",
);

test("migrate-legacy-modal 搜索框走服务端 candidates 接口", () => {
  assert.match(source, /params\.set\("search", q\)/);
  assert.match(source, /loadMigrateLegacyCandidates\(\)/);
  assert.match(source, /MIGRATE_LEGACY_SEARCH_DEBOUNCE_MS/);
  assert.match(source, /ev\.isComposing/);
  assert.match(source, /compositionend/);
  assert.match(source, /ev\.key !== "Enter"/);
  assert.doesNotMatch(
    source,
    /migrate-legacy-search[\s\S]{0,200}requestRender\(\)/,
    "搜索输入不应每次按键整页重绘",
  );
});
