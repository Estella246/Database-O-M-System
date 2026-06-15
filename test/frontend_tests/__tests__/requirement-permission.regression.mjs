/**
 * 质量改进页权限策略白名单项与按钮可见性。
 * node --test test/frontend_tests/__tests__/requirement-permission.regression.mjs
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

const REQ_KEYS = [
  "requirement_list",
  "requirement_create",
  "requirement_import",
  "requirement_export",
];

test("permission.js 含质量改进页面与子按钮白名单项", async () => {
  const {
    PERMISSION_WHITELIST_ITEMS,
    PERMISSION_STRATEGY_OPTIONS_BY_KEY,
    PERMISSION_WHITELIST_CASCADE_RELATIONS,
    PERMISSION_DEFAULT_HIDDEN_KEYS,
  } = await import(permissionUrl);

  const keys = PERMISSION_WHITELIST_ITEMS.map((x) => x.key);
  for (const key of REQ_KEYS) {
    assert.ok(keys.includes(key), `missing ${key}`);
    assert.deepEqual(PERMISSION_STRATEGY_OPTIONS_BY_KEY[key], [
      ["readonly", "展示"],
      ["hidden", "不展示"],
    ]);
  }

  for (const child of ["requirement_create", "requirement_import", "requirement_export"]) {
    assert.ok(
      PERMISSION_WHITELIST_CASCADE_RELATIONS.some(
        ([parent, c]) => parent === "requirement_list" && c === child,
      ),
      `missing cascade requirement_list -> ${child}`,
    );
  }

  assert.ok(PERMISSION_DEFAULT_HIDDEN_KEYS.has("requirement_export"));
  assert.equal(PERMISSION_DEFAULT_HIDDEN_KEYS.has("requirement_list"), false);
  assert.equal(PERMISSION_DEFAULT_HIDDEN_KEYS.has("requirement_create"), false);
  assert.equal(PERMISSION_DEFAULT_HIDDEN_KEYS.has("requirement_import"), false);
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

test("质量改进子按钮权限可独立于页面策略配置", () => {
  const wl = {
    requirement_list: "readonly",
    requirement_create: "hidden",
    requirement_import: "hidden",
    requirement_export: "readonly",
  };
  assert.equal(whitelistAllows("requirement_list", "readonly", wl), true);
  assert.equal(whitelistAllows("requirement_create", "readonly", wl), false);
  assert.equal(whitelistAllows("requirement_import", "readonly", wl), false);
  assert.equal(whitelistAllows("requirement_export", "readonly", wl), true);
});

test("requirement_list hidden 时侧栏不展示质量改进入口", () => {
  const wl = { requirement_list: "hidden" };
  assert.equal(whitelistAllows("requirement_list", "readonly", wl), false);
});
