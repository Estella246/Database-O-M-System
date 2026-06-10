/**
 * 工作台迁入 / 重建列表快照按钮可见性（独立白名单项）。
 * node --test test/frontend_tests/__tests__/workbench-migrate-snapshot-permission.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const permissionUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/constants/permission.js"),
).href;

test("permission.js 含 workbench_migrate 与 workbench_snapshot_rebuild", async () => {
  const {
    PERMISSION_WHITELIST_ITEMS,
    PERMISSION_STRATEGY_OPTIONS_BY_KEY,
    PERMISSION_WHITELIST_CASCADE_RELATIONS,
  } = await import(permissionUrl);

  const keys = PERMISSION_WHITELIST_ITEMS.map((x) => x.key);
  assert.ok(keys.includes("workbench_migrate"));
  assert.ok(keys.includes("workbench_snapshot_rebuild"));

  for (const key of ["workbench_migrate", "workbench_snapshot_rebuild"]) {
    assert.deepEqual(PERMISSION_STRATEGY_OPTIONS_BY_KEY[key], [
      ["readonly", "展示"],
      ["hidden", "不展示"],
    ]);
  }

  assert.ok(
    PERMISSION_WHITELIST_CASCADE_RELATIONS.some(
      ([parent, child]) => parent === "ticket_list" && child === "workbench_migrate",
    ),
  );
  assert.ok(
    PERMISSION_WHITELIST_CASCADE_RELATIONS.some(
      ([parent, child]) => parent === "ticket_list" && child === "workbench_snapshot_rebuild",
    ),
  );
});

const PERMISSION_LEVEL_RANK = { hidden: 0, readonly: 1, editable: 2 };

function getWhitelistLevel(fieldKey, whitelist) {
  const raw = String(whitelist?.[fieldKey] || "").trim();
  if (Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, raw)) return raw;
  return "readonly";
}

function whitelistAllows(fieldKey, minLevel, whitelist) {
  const need = minLevel || "readonly";
  return PERMISSION_LEVEL_RANK[getWhitelistLevel(fieldKey, whitelist)] >= PERMISSION_LEVEL_RANK[need];
}

test("迁入与重建快照权限独立于 workbench_delete", () => {
  const wl = { workbench_delete: "hidden", workbench_migrate: "readonly", workbench_snapshot_rebuild: "readonly" };
  assert.equal(whitelistAllows("workbench_delete", "readonly", wl), false);
  assert.equal(whitelistAllows("workbench_migrate", "readonly", wl), true);
  assert.equal(whitelistAllows("workbench_snapshot_rebuild", "readonly", wl), true);
});

test("ticket_list hidden 时子项策略仍可在配置层单独设为 hidden", () => {
  const wl = { workbench_migrate: "hidden", workbench_snapshot_rebuild: "hidden" };
  assert.equal(whitelistAllows("workbench_migrate", "readonly", wl), false);
  assert.equal(whitelistAllows("workbench_snapshot_rebuild", "readonly", wl), false);
});
