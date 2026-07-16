/**
 * 重大问题（工单驱动）勾选与导出契约。
 * node --test test/frontend_tests/__tests__/major-issue-export.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../..");

const pageSrc = readFileSync(
  join(root, "frontend/modules/pages/major-issue-page.js"),
  "utf8",
);
const permissionSrc = readFileSync(
  join(root, "frontend/modules/constants/permission.js"),
  "utf8",
);
const stateSrc = readFileSync(join(root, "frontend/modules/state/state.js"), "utf8");

test("major-issue-page 含勾选列与导出按钮", () => {
  assert.match(pageSrc, /data-mi-select/);
  assert.match(pageSrc, /id="mi-select-all"/);
  assert.match(pageSrc, /id="mi-export-btn"/);
  assert.match(pageSrc, /major_problem_export/);
  assert.match(pageSrc, /\/api\/major-issues\/export/);
  assert.match(pageSrc, /majorIssueSelectedIds/);
  assert.match(pageSrc, /exportRange === "selected"/);
  assert.match(pageSrc, /请先选中要导出的重大问题/);
  assert.match(pageSrc, /e\.target instanceof HTMLInputElement && e\.target\.type === "checkbox"/);
});

test("permission.js 含重大问题导出白名单项与级联", () => {
  assert.match(permissionSrc, /major_problem_export/);
  assert.match(permissionSrc, /major_problem_create/);
  assert.match(
    permissionSrc,
    /\["major_problem_list", "major_problem_export"\]/,
  );
});

test("state.js 含重大问题选中与导出 loading", () => {
  assert.match(stateSrc, /majorIssueSelectedIds/);
  assert.match(stateSrc, /majorIssueExportLoading/);
});
