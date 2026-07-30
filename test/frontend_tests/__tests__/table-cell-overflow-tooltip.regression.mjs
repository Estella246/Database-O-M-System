/**
 * 工作台列表单元格悬停全文：仅在未完整展示时设置 title。
 * 运行：node --experimental-vm-modules --test test/frontend_tests/__tests__/table-cell-overflow-tooltip.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/ui/table-cell-overflow-tooltip.js")
).href;

test("cellNeedsOverflowTooltip：全文已展示时不提示", async () => {
  const { cellNeedsOverflowTooltip } = await import(moduleUrl);
  const cell = { textContent: "YW20260101001", scrollWidth: 100, clientWidth: 100, scrollHeight: 20, clientHeight: 20 };
  assert.equal(cellNeedsOverflowTooltip(cell, "YW20260101001"), false);
});

test("cellNeedsOverflowTooltip：程序截断（全文更长）时提示", async () => {
  const { cellNeedsOverflowTooltip } = await import(moduleUrl);
  const short = "a".repeat(200) + "…";
  const full = "a".repeat(260);
  const cell = { textContent: short, scrollWidth: 100, clientWidth: 100, scrollHeight: 20, clientHeight: 20 };
  assert.equal(cellNeedsOverflowTooltip(cell, full), true);
});

test("cellNeedsOverflowTooltip：CSS 省略（scrollWidth 更大）时提示", async () => {
  const { cellNeedsOverflowTooltip } = await import(moduleUrl);
  const text = "这是一段很长的局点名称会被省略";
  const cell = { textContent: text, scrollWidth: 180, clientWidth: 80, scrollHeight: 20, clientHeight: 20 };
  assert.equal(cellNeedsOverflowTooltip(cell, text), true);
});

test("cellNeedsOverflowTooltip：空值与（空）不提示", async () => {
  const { cellNeedsOverflowTooltip } = await import(moduleUrl);
  const cell = { textContent: "（空）", scrollWidth: 10, clientWidth: 10, scrollHeight: 20, clientHeight: 20 };
  assert.equal(cellNeedsOverflowTooltip(cell, ""), false);
  assert.equal(cellNeedsOverflowTooltip(cell, "（空）"), false);
});

test("renderDynamicTableRowCells：长描述带 data-cell-full-text（工作台与主页）", async () => {
  const tableColumnsUrl = pathToFileURL(
    join(__dirname, "../../../frontend/modules/pages/table-columns.js")
  ).href;
  globalThis.window = {
    location: { protocol: "http:", hostname: "127.0.0.1", port: "8000", origin: "http://127.0.0.1:8000", search: "" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  const { renderDynamicTableRowCells } = await import(tableColumnsUrl);
  const longDesc = "x".repeat(300);
  const ticket = {
    orderId: "YW20260101001",
    processId: "YW20260101001",
    description: longDesc,
    issue_desc: longDesc,
  };
  for (const namespace of ["list", "home"]) {
    const html = renderDynamicTableRowCells(ticket, namespace, new Set());
    assert.ok(html.includes("data-cell-full-text"), `${namespace} 应写入完整文本 data 属性`);
    assert.ok(!html.includes(" title="), `${namespace} title 由渲染后脚本按是否截断设置`);
  }
});
