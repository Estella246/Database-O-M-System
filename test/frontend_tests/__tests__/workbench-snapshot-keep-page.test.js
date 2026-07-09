/**
 * 工作台快照拉数：开始时不清空上一页 ID，避免搜索刷新窗口列表变空。
 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/ticket-core.js",
);
const src = fs.readFileSync(SRC, "utf8");

describe("syncTicketsFromServer 保留上一页 snapshot", () => {
  test("拉数开始时不把 workbenchSnapshotPageIds 置空", () => {
    const fnStart = src.indexOf("export async function syncTicketsFromServer");
    const fnEnd = src.indexOf("\nexport ", fnStart + 10);
    const fn = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 5000);
    expect(fn).toContain("state.ticketListLoading = true");
    // 成功拿到 snapshot 结果时仍会写入 pageIds
    expect(fn).toMatch(/state\.workbenchSnapshotPageIds\s*=\s*mapped/);
    // 开始拉数时不得清空（否则输入挂起 render 期间列表被滤成 0 条）
    expect(fn).not.toMatch(
      /ticketListLoading\s*=\s*true;[\s\S]{0,200}workbenchSnapshotPageIds\s*=\s*\[\s*\]/,
    );
  });

  test("空 pageIds 时 filterTicketsToWorkbenchSnapshotPage 仍返回空数组", () => {
    // 行为契约：无 ID 时不展示全量 merge 缓存（与实现一致）
    const filterStart = src.indexOf("export function filterTicketsToWorkbenchSnapshotPage");
    const filterBlock = src.slice(filterStart, filterStart + 400);
    expect(filterBlock).toContain("if (!ids.size) return []");
  });
});
