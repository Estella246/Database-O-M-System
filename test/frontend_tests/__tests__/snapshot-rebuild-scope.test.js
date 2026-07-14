/**
 * 工作台「重建列表快照」目标范围：勾选 > 当前筛选 > 全量
 * node --test test/frontend_tests/__tests__/snapshot-rebuild-scope.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePath = join(__dirname, "../../../frontend/modules/pages/ticket-core.js");
const source = readFileSync(corePath, "utf8");

function loadResolveHelpers() {
  const match = source.match(
    /export function workbenchListHasActiveScope\(\) \{[\s\S]*?\n\}\n\n\/\*\*[\s\S]*?export function resolveWorkbenchSnapshotRebuildTarget\([\s\S]*?\n\}/,
  );
  assert.ok(match, "resolveWorkbenchSnapshotRebuildTarget 未找到");
  const code = match[0]
    .replace("export function workbenchListHasActiveScope", "function workbenchListHasActiveScope")
    .replace(
      "export function resolveWorkbenchSnapshotRebuildTarget",
      "function resolveWorkbenchSnapshotRebuildTarget",
    );
  const sandbox = {
    state: {
      selectedTicketIds: [],
      ticketListSearch: "",
      listTab: "all",
      ticketListCreatedStart: "",
      ticketListCreatedEnd: "",
      ticketListFilters: { selected: {} },
    },
  };
  vm.runInNewContext(`${code}\nthis.workbenchListHasActiveScope = workbenchListHasActiveScope;\nthis.resolveWorkbenchSnapshotRebuildTarget = resolveWorkbenchSnapshotRebuildTarget;`, sandbox);
  return sandbox;
}

test("勾选优先于筛选", () => {
  const ctx = loadResolveHelpers();
  ctx.state.ticketListSearch = "北京";
  const r = ctx.resolveWorkbenchSnapshotRebuildTarget(["YW1", "YW1", " YW2 "]);
  assert.equal(r.mode, "selected");
  assert.equal(JSON.stringify([...r.ticketNos]), JSON.stringify(["YW1", "YW2"]));
});

test("无勾选但有筛选 → filtered", () => {
  const ctx = loadResolveHelpers();
  ctx.state.listTab = "todo";
  const r = ctx.resolveWorkbenchSnapshotRebuildTarget([]);
  assert.equal(r.mode, "filtered");
  assert.equal(r.ticketNos.length, 0);
});

test("无勾选无筛选 → all", () => {
  const ctx = loadResolveHelpers();
  const r = ctx.resolveWorkbenchSnapshotRebuildTarget([]);
  assert.equal(r.mode, "all");
});

test("ticket-page 顶栏重建走 resolveWorkbenchSnapshotRebuildTarget", () => {
  const page = readFileSync(
    join(__dirname, "../../../frontend/modules/pages/ticket-page.js"),
    "utf8",
  );
  assert.match(page, /resolveWorkbenchSnapshotRebuildTarget/);
  assert.match(page, /runWorkbenchSnapshotRebuildForTicketNos/);
  assert.match(page, /fetchWorkbenchFilteredTicketIds/);
  assert.doesNotMatch(page, /migrate-legacy-snapshot-selected/);
});
