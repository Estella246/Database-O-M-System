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
    const fn = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 6000);
    expect(fn).toContain("state.ticketListLoading = true");
    expect(fn).toMatch(/state\.workbenchSnapshotPageIds\s*=\s*mapped/);
    expect(fn).toContain("_stickyWorkbenchSnapshotPageIds");
    expect(fn).not.toMatch(
      /ticketListLoading\s*=\s*true;[\s\S]{0,200}workbenchSnapshotPageIds\s*=\s*\[\s*\]/,
    );
  });

  test("输入未停手时丢弃空结果，避免闪 0 条", () => {
    const fnStart = src.indexOf("export async function syncTicketsFromServer");
    const fn = src.slice(fnStart, fnStart + 6000);
    expect(fn).toContain("shouldDeferListSearchRender");
    expect(fn).toMatch(
      /mapped\.length\s*===\s*0\s*&&\s*shouldDeferListSearchRender\(\)[\s\S]*?return;/,
    );
  });

  test("已有 snapshot 当前页时 shouldPrepare 为 false", () => {
    const fnStart = src.indexOf("export function shouldPrepareWorkbenchSnapshotSync");
    const fn = src.slice(fnStart, fnStart + 800);
    expect(fn).toContain("workbenchSnapshotPageIds");
    expect(fn).toMatch(
      /serverPaged\s*&&\s*Array\.isArray\(pageIds\)\s*&&\s*pageIds\.length\s*>\s*0\)\s*return false/,
    );
  });

  test("loading 且 pageIds 空时 applyWorkbenchListFilters 回退 sticky", () => {
    const fnStart = src.indexOf("export function applyWorkbenchListFilters");
    const fn = src.slice(fnStart, fnStart + 900);
    expect(fn).toContain("ticketListLoading");
    expect(fn).toContain("_stickyWorkbenchSnapshotPageIds");
  });

  test("空 pageIds 时 filterTicketsToWorkbenchSnapshotPage 仍返回空数组", () => {
    const filterStart = src.indexOf("export function filterTicketsToWorkbenchSnapshotPage");
    const filterBlock = src.slice(filterStart, filterStart + 400);
    expect(filterBlock).toContain("if (!ids.size) return []");
  });
});
