/**
 * 迁入/删除已迁完成后不自动重建列表快照（须手动点工作台「重建列表快照」）。
 * node --test test/frontend_tests/__tests__/migrate-legacy-no-auto-snapshot.regression.mjs
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

test("migrate-legacy-modal 不在迁入/删除流程中自动 refresh_snapshot", () => {
  assert.doesNotMatch(source, /refreshMigrateLegacySnapshot/);
  assert.doesNotMatch(source, /needsSnapshot/);
  assert.doesNotMatch(source, /重建列表快照…/);
  assert.match(source, /refresh_snapshot:\s*false/);
});
