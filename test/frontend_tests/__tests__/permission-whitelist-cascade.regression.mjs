/**
 * 回归：范围类策略（leave_application_all 等）在父项为「展示」时仍可选 editable。
 * node --test test/frontend_tests/__tests__/permission-whitelist-cascade.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const normalizeUrl = pathToFileURL(join(__dirname, "../../../frontend/modules/utils/normalize.js")).href;

test("leave_application 展示时 leave_application_all 可设为仅本人申请", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    leave_application: "readonly",
    leave_application_all: "editable",
  });
  assert.equal(draft.leave_application, "readonly");
  assert.equal(draft.leave_application_all, "editable");
});

test("leave_application 不展示时 leave_application_all 被级联为 hidden", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    leave_application: "hidden",
    leave_application_all: "editable",
  });
  assert.equal(draft.leave_application_all, "hidden");
});
