/**
 * 提单助手：history.get 回填用户气泡，且气泡不被 flex 压缩。
 * node --test test/frontend_tests/__tests__/ticket-assistant-history.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const historyUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/utils/ta-history.js"),
).href;
const cssPath = join(__dirname, "../../../frontend/styles/ticket-assistant.css");

test("history.get 有用户气泡时即使更短也采用历史", async () => {
  const { resolveFetchedTaMessages } = await import(historyUrl);
  const prev = [
    { role: "assistant", content: "本地助手" },
    { role: "assistant", content: "多余一条" },
  ];
  const items = [
    { role: "user", content: "我发的" },
    { role: "assistant", content: "九问答" },
  ];
  const next = resolveFetchedTaMessages(prev, items, { chatLoading: false });
  assert.equal(next[0].role, "user");
  assert.equal(next[0].content, "我发的");
});

test("历史没有用户气泡时保留本地用户气泡", async () => {
  const { resolveFetchedTaMessages } = await import(historyUrl);
  const prev = [
    { role: "user", content: "我发的" },
    { role: "assistant", content: "答" },
  ];
  const items = [{ role: "assistant", content: "只有助手" }];
  const next = resolveFetchedTaMessages(prev, items, { chatLoading: false });
  assert.equal(next[0].role, "user");
});

test("流式进行中不拿空历史冲掉本地", async () => {
  const { resolveFetchedTaMessages } = await import(historyUrl);
  const prev = [
    { role: "user", content: "我发的" },
    { role: "assistant", content: "", streaming: true },
  ];
  const next = resolveFetchedTaMessages(prev, [], { chatLoading: true });
  assert.equal(next, prev);
});

test("用户气泡 CSS 禁止被 flex 压缩", () => {
  const css = readFileSync(cssPath, "utf8");
  const idx = css.indexOf(".ta-msg {");
  assert.ok(idx >= 0);
  const block = css.slice(idx, idx + 220);
  assert.match(block, /flex-shrink:\s*0/);
});
