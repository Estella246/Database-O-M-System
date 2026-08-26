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
const pagePath = join(__dirname, "../../../frontend/modules/pages/ticket-assistant-page.js");

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

test("chat.final 将流式过程话术折入工作区，只保留最终回答", async () => {
  const { finalizeTaAssistantTurn } = await import(historyUrl);
  const messages = [
    { role: "user", content: "帮我查一下" },
    { role: "assistant", content: "最终结论：服务正常" },
  ];
  const next = finalizeTaAssistantTurn(
    messages,
    "让我搜索一下相关信息……\n\n我已经收集到了所需信息。\n\n最终结论：服务正常",
    "最终结论：服务正常",
  );

  assert.equal(next[1].content, "最终结论：服务正常");
  assert.equal(next[1].final_content, "最终结论：服务正常");
  assert.match(next[1].work_content, /让我搜索一下/);
  assert.match(next[1].work_content, /我已经收集到了/);
  assert.doesNotMatch(next[1].work_content, /最终结论/);
});

test("流式内容与 final 相同，不生成多余工作过程", async () => {
  const { finalizeTaAssistantTurn } = await import(historyUrl);
  const next = finalizeTaAssistantTurn(
    [{ role: "assistant", content: "直接回答" }],
    "直接回答",
    "直接回答",
  );
  assert.equal(next[0].content, "直接回答");
  assert.equal(next[0].work_content, undefined);
});

test("流结束后的历史回拉不覆盖已折叠的 chat.final", async () => {
  const { resolveFetchedTaMessages } = await import(historyUrl);
  const local = [
    { role: "user", content: "帮我查一下" },
    {
      role: "assistant",
      content: "最终结论",
      final_content: "最终结论",
      work_content: "让我搜索一下……\n\n我已经收集到了……",
    },
  ];
  const rawHistory = [
    { role: "user", content: "帮我查一下" },
    { role: "assistant", content: "让我搜索一下……" },
    { role: "assistant", content: "我已经收集到了……" },
    { role: "assistant", content: "最终结论" },
  ];

  const resolved = resolveFetchedTaMessages(local, rawHistory, {
    preserveFinalizedLocal: true,
  });
  assert.equal(resolved, local);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[1].final_content, "最终结论");
});

test("普通打开历史仍采用服务端最新消息", async () => {
  const { resolveFetchedTaMessages } = await import(historyUrl);
  const local = [
    { role: "user", content: "旧问题" },
    { role: "assistant", content: "旧答案", final_content: "旧答案" },
  ];
  const history = [
    { role: "user", content: "新问题" },
    { role: "assistant", content: "新答案" },
  ];
  assert.equal(resolveFetchedTaMessages(local, history), history);
});

test("离开提单助手后后台流不得触发当前页面 DOM 更新", async () => {
  const { shouldPatchTicketAssistantStream } = await import(historyUrl);
  assert.equal(shouldPatchTicketAssistantStream("workbench:list", 7, 7), false);
  assert.equal(shouldPatchTicketAssistantStream("assistant:ticket", 8, 7), false);
  assert.equal(shouldPatchTicketAssistantStream("assistant:ticket", 7, 7), true);
});

test("流式回复时转人工按钮不因输入框 loading 禁用", () => {
  const src = readFileSync(pagePath, "utf8");
  const btnIdx = src.indexOf('id="ta-transfer-btn"');
  assert.ok(btnIdx >= 0, "应渲染转人工按钮");
  const btnSnippet = src.slice(btnIdx, btnIdx + 180);
  assert.match(btnSnippet, /\$\{transferring \? "disabled" : ""\}/);
  assert.doesNotMatch(btnSnippet, /composerDisabled/);
});
