/**
 * 工单详情「Ask 九问」按钮独立白名单项。
 * node --test test/frontend_tests/__tests__/ticket-detail-ask-jiuwen-permission.regression.mjs
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
const normalizeUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/utils/normalize.js"),
).href;

test("permission.js 含 ticket_detail_ask_jiuwen 且默认 hidden", async () => {
  const {
    PERMISSION_WHITELIST_ITEMS,
    PERMISSION_STRATEGY_OPTIONS_BY_KEY,
    PERMISSION_WHITELIST_CASCADE_RELATIONS,
    PERMISSION_DEFAULT_HIDDEN_KEYS,
  } = await import(permissionUrl);

  const keys = PERMISSION_WHITELIST_ITEMS.map((x) => x.key);
  assert.ok(keys.includes("ticket_detail_ask_jiuwen"));
  assert.deepEqual(PERMISSION_STRATEGY_OPTIONS_BY_KEY.ticket_detail_ask_jiuwen, [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ]);
  assert.ok(PERMISSION_DEFAULT_HIDDEN_KEYS.has("ticket_detail_ask_jiuwen"));
  assert.ok(
    PERMISSION_WHITELIST_CASCADE_RELATIONS.some(
      ([parent, child]) => parent === "ticket_detail" && child === "ticket_detail_ask_jiuwen",
    ),
  );
});

test("未配置时 Ask 九问不展示；readonly 才展示", async () => {
  const { getWhitelistLevel, whitelistAllows } = await import(normalizeUrl);
  assert.equal(getWhitelistLevel("ticket_detail_ask_jiuwen", {}), "hidden");
  assert.equal(whitelistAllows("ticket_detail_ask_jiuwen", "readonly", {}), false);
  assert.equal(
    whitelistAllows("ticket_detail_ask_jiuwen", "readonly", { ticket_detail_ask_jiuwen: "readonly" }),
    true,
  );
  assert.equal(
    whitelistAllows("ticket_detail_ask_jiuwen", "readonly", { ticket_detail_ask_jiuwen: "hidden" }),
    false,
  );
});

test("ticket_detail 不展示时 Ask 九问被级联为 hidden", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    ticket_detail: "hidden",
    ticket_detail_ask_jiuwen: "readonly",
  });
  assert.equal(draft.ticket_detail_ask_jiuwen, "hidden");
});
