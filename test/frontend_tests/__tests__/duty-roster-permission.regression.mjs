/**
 * 回归：值班表 duty_roster 范围策略「仅展示 RL 值班表」
 * node --test test/frontend_tests/__tests__/duty-roster-permission.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const permUrl = pathToFileURL(join(__dirname, "../../../frontend/modules/constants/permission.js")).href;
const normalizeUrl = pathToFileURL(join(__dirname, "../../../frontend/modules/utils/normalize.js")).href;

test("duty_roster_edit 策略下拉含「仅展示RL值班表相关编辑按钮」", async () => {
  const { PERMISSION_STRATEGY_OPTIONS_BY_KEY } = await import(permUrl);
  assert.deepEqual(PERMISSION_STRATEGY_OPTIONS_BY_KEY.duty_roster_edit, [
    ["readonly", "展示"],
    ["editable", "仅展示RL值班表相关编辑按钮"],
    ["hidden", "不展示"],
  ]);
});

test("duty_roster 策略下拉含「仅展示RL值班表」", async () => {
  const { PERMISSION_STRATEGY_OPTIONS_BY_KEY } = await import(permUrl);
  assert.deepEqual(PERMISSION_STRATEGY_OPTIONS_BY_KEY.duty_roster, [
    ["readonly", "展示"],
    ["editable", "仅展示RL值班表"],
    ["hidden", "不展示"],
  ]);
});

test("RL 范围策略下仅返回 RL 区块", async () => {
  const { getVisibleDutyRosterSectionsForWhitelist } = await import(normalizeUrl);
  const rlOnly = getVisibleDutyRosterSectionsForWhitelist({ duty_roster: "editable" });
  assert.equal(rlOnly.length, 1);
  assert.equal(rlOnly[0].id, "duty-rl-oncall");

  const full = getVisibleDutyRosterSectionsForWhitelist({ duty_roster: "readonly" });
  assert.ok(full.length > 1);
  assert.ok(full.some((s) => s.id === "duty-kernel-oncall"));
});

test("RL 范围策略下 dutyRosterAnchorValid 仅认可 RL 锚点", async () => {
  const { dutyRosterAnchorValidForWhitelist } = await import(normalizeUrl);
  const wl = { duty_roster: "editable" };
  assert.equal(dutyRosterAnchorValidForWhitelist("duty-rl-oncall", wl), true);
  assert.equal(dutyRosterAnchorValidForWhitelist("duty-kernel-oncall", wl), false);
  assert.equal(dutyRosterAnchorValidForWhitelist("duty-special-slow-sql", wl), false);

  const fullWl = { duty_roster: "readonly" };
  assert.equal(dutyRosterAnchorValidForWhitelist("duty-kernel-oncall", fullWl), true);
  assert.equal(dutyRosterAnchorValidForWhitelist("duty-special-slow-sql", fullWl), true);
});
