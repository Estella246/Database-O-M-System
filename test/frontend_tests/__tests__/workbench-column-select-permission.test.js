/**
 * 工作台「选择列」白名单：展示全部列 / 仅系统+问题填写+问题审核
 * node --test test/frontend_tests/__tests__/workbench-column-select-permission.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const columnFieldsUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/constants/column-fields.js")
).href;
const normalizeUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/utils/normalize.js")
).href;

test("workbench_column_select 默认/readonly 不限制列节点", async () => {
  const { getWorkbenchColumnAllowedNodeKeys } = await import(columnFieldsUrl);
  assert.equal(getWorkbenchColumnAllowedNodeKeys({}), null);
  assert.equal(getWorkbenchColumnAllowedNodeKeys({ workbench_column_select: "readonly" }), null);
});

test("workbench_column_select editable 仅系统/问题填写/问题审核", async () => {
  const { getWorkbenchColumnAllowedNodeKeys, buildColumnGroups } = await import(columnFieldsUrl);
  const allowed = getWorkbenchColumnAllowedNodeKeys({ workbench_column_select: "editable" });
  assert.ok(allowed instanceof Set);
  assert.deepEqual([...allowed].sort(), ["problem_fill", "problem_review", "system"]);
  const groups = buildColumnGroups("list", allowed);
  assert.deepEqual(
    groups.map((g) => g.nodeKey).sort(),
    ["problem_fill", "problem_review", "system"]
  );
});

test("patch 命名空间不受选择列白名单限制", async () => {
  const { getWorkbenchColumnAllowedNodeKeys } = await import(columnFieldsUrl);
  assert.equal(
    getWorkbenchColumnAllowedNodeKeys({ workbench_column_select: "editable" }, "patch"),
    null
  );
});

test("ticket_list 展示时 workbench_column_select 可设为受限列", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    ticket_list: "readonly",
    workbench_column_select: "editable",
  });
  assert.equal(draft.ticket_list, "readonly");
  assert.equal(draft.workbench_column_select, "editable");
});

test("ticket_list 不展示时 workbench_column_select 被级联为 hidden", async () => {
  const { applyPermissionWhitelistCascade } = await import(normalizeUrl);
  const { draft } = applyPermissionWhitelistCascade({
    ticket_list: "hidden",
    workbench_column_select: "editable",
  });
  assert.equal(draft.workbench_column_select, "hidden");
});
