/**
 * 补丁管理导出按钮独立白名单项（与 workbench_export 解耦）。
 * node --test test/frontend_tests/__tests__/patch-manage-export-permission.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const permissionUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/constants/permission.js"),
).href;
const normalizeUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/utils/normalize.js"),
).href;

test("permission.js 含 patch_manage_export 且级联自 patch_manage", async () => {
  const {
    PERMISSION_WHITELIST_ITEMS,
    PERMISSION_STRATEGY_OPTIONS_BY_KEY,
    PERMISSION_WHITELIST_CASCADE_RELATIONS,
  } = await import(permissionUrl);

  const keys = PERMISSION_WHITELIST_ITEMS.map((x) => x.key);
  assert.ok(keys.includes("patch_manage_export"));
  assert.deepEqual(PERMISSION_STRATEGY_OPTIONS_BY_KEY.patch_manage_export, [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ]);
  assert.ok(
    PERMISSION_WHITELIST_CASCADE_RELATIONS.some(
      ([parent, child]) => parent === "patch_manage" && child === "patch_manage_export",
    ),
  );
});

test("补丁管理导出权限可独立于工作台导出配置", async () => {
  const { whitelistAllows } = await import(normalizeUrl);
  const wl = {
    patch_manage: "readonly",
    patch_manage_export: "readonly",
    workbench_export: "hidden",
  };
  assert.equal(whitelistAllows("patch_manage_export", "readonly", wl), true);
  assert.equal(whitelistAllows("workbench_export", "readonly", wl), false);
});

test("patch_manage 不展示时导出子项被级联为 hidden", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    patch_manage: "hidden",
    patch_manage_export: "readonly",
  });
  assert.equal(draft.patch_manage_export, "hidden");
});

test("补丁管理页导出按钮按 patch_manage_export 展示", () => {
  const appSrc = readFileSync(join(__dirname, "../../../frontend/app.js"), "utf8");
  assert.match(appSrc, /whitelistAllows\("patch_manage_export"/);
  assert.match(
    appSrc,
    /isPatchList \? canViewPatchManageExport : canViewWorkbenchExport/,
  );
});
