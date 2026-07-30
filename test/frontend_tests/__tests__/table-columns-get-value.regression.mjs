/**
 * 回归：`getTicketColumnValue` 在非 system 列上不得抛错（曾误用未定义的 `key` 导致整表无行）。
 * 运行：自 test/frontend_tests 目录执行
 *   node --experimental-vm-modules --test __tests__/table-columns-get-value.regression.mjs
 * 或自仓库根目录：
 *   node --experimental-vm-modules --test test/frontend_tests/__tests__/table-columns-get-value.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(join(__dirname, "../../../frontend/modules/pages/table-columns.js")).href;

function ensureWindowMock() {
  globalThis.window = {
    location: { protocol: "http:", hostname: "127.0.0.1", port: "8000", origin: "http://127.0.0.1:8000", search: "" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
}

test("getTicketColumnValue：非 system 列（如起始日期）不抛错", async () => {
  ensureWindowMock();
  const { getTicketColumnValue } = await import(moduleUrl);
  const ticket = { orderId: "YW20260101001", startDate: "2026-01-02", creatorName: "演示  demo_001" };
  const col = { nodeKey: "problem_fill", fieldKey: "start_date", type: "date" };
  const out = getTicketColumnValue(ticket, col);
  assert.equal(out.display, "2026-01-02");
});

test("getTicketColumnValue：creatorName 列可读", async () => {
  ensureWindowMock();
  const { getTicketColumnValue } = await import(moduleUrl);
  const ticket = { creatorName: "张三 zhang" };
  const col = { nodeKey: "system", fieldKey: "creatorName", type: "system" };
  const out = getTicketColumnValue(ticket, col);
  assert.equal(out.display, "张三 zhang");
});

/** 补丁列表与工作台共用 renderDynamicTableRowCells，依赖 window.localStorage 读列配置 */
test("renderDynamicTableRowCells：patch 命名空间整行可渲染（多列 td）", async () => {
  ensureWindowMock();
  const { renderDynamicTableRowCells } = await import(moduleUrl);
  const ticket = {
    orderId: "YW20260105001",
    processId: "YW20260105001",
    templateCode: "HOTPATCH",
    currentStage: "诉求填写",
    currentHandler: "张三 demo_001",
    startDate: "2026-01-05",
    creatorName: "李四 demo_002",
    createdAt: "2026-01-05T10:00:00.000Z",
  };
  const html = renderDynamicTableRowCells(ticket, "patch", new Set());
  assert.ok(html.includes("type=\"checkbox\""), "应含勾选列");
  const tdCount = (html.match(/<td/g) || []).length;
  assert.ok(tdCount >= 3, `应有多列数据单元格，实际 td 数 ${tdCount}`);
});

test("isTicketListColumnFilterable：起始日期与问题描述不可筛，whitelist 可筛", async () => {
  const { isTicketListColumnFilterable } = await import(
    pathToFileURL(join(__dirname, "../../../frontend/modules/constants/column-fields.js")).href
  );
  assert.equal(
    isTicketListColumnFilterable({ nodeKey: "problem_fill", fieldKey: "start_date", type: "date" }),
    false
  );
  assert.equal(
    isTicketListColumnFilterable({ nodeKey: "problem_fill", fieldKey: "issue_desc", type: "richtext" }),
    false
  );
  assert.equal(
    isTicketListColumnFilterable({ nodeKey: "ops_analysis", fieldKey: "handle_mode", type: "whitelist" }),
    true
  );
  assert.equal(
    isTicketListColumnFilterable({ nodeKey: "system", fieldKey: "processId", type: "system" }),
    false
  );
});
