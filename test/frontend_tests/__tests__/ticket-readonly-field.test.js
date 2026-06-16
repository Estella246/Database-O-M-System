/**
 * 回归：问题详情只读字段须完整展示多行与长文本
 * node --test test/frontend_tests/__tests__/ticket-readonly-field.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ticketUrl = pathToFileURL(join(__dirname, "../../../frontend/modules/pages/ticket.js")).href;

test("renderReadOnlyFieldValue preserves multiline plain text", async () => {
  const { renderReadOnlyFieldValue } = await import(ticketUrl);
  const html = renderReadOnlyFieldValue({ type: "text", key: "issue_desc" }, "第一行\n第二行");
  assert.match(html, /第一行\n第二行/);
  assert.match(html, /class="readonly-value"/);
  assert.doesNotMatch(html, /problem-field-passed-text/);
});

test("renderReadOnlyFieldValue renders richtext html", async () => {
  const { renderReadOnlyFieldValue } = await import(ticketUrl);
  const html = renderReadOnlyFieldValue(
    { type: "richtext", key: "issue_desc" },
    "<p>段落一</p><p>段落二</p>",
  );
  assert.match(html, /class="readonly-value readonly-rich"/);
  assert.match(html, /<p>段落一<\/p>/);
});

test("renderReadOnlyFieldValue shows empty placeholder", async () => {
  const { renderReadOnlyFieldValue } = await import(ticketUrl);
  const html = renderReadOnlyFieldValue({ type: "text", key: "note" }, "   ");
  assert.match(html, /class="readonly-empty"/);
});

test("ticket-page no longer uses passed inline single-line markup", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(__dirname, "../../../frontend/modules/pages/ticket-page.js"), "utf8");
  assert.doesNotMatch(src, /problem-field-passed-inline/);
  assert.doesNotMatch(src, /renderPassedInlineValue/);
});
