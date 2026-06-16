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

test("duty_roster 仅展示 RL 时 duty_roster_edit 被级联为 hidden", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    duty_roster: "editable",
    duty_roster_edit: "readonly",
  });
  assert.equal(draft.duty_roster, "editable");
  assert.equal(draft.duty_roster_edit, "hidden");
});

test("duty_roster 展示全部时 duty_roster_edit 可独立配置", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    duty_roster: "readonly",
    duty_roster_edit: "readonly",
  });
  assert.equal(draft.duty_roster, "readonly");
  assert.equal(draft.duty_roster_edit, "readonly");
});

test("isDutyRosterRlOnlyView 识别 editable 范围策略", async () => {
  const { isDutyRosterRlOnlyView } = await import(normalizeUrl);
  assert.equal(isDutyRosterRlOnlyView({ duty_roster: "editable" }), true);
  assert.equal(isDutyRosterRlOnlyView({ duty_roster: "readonly" }), false);
  assert.equal(isDutyRosterRlOnlyView({ duty_roster: "hidden" }), false);
});
