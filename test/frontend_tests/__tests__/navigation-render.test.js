/**
 * 导航切换时合并为一次整页 render，避免先绘骨架再绘数据的闪跳。
 * 与 frontend/modules/pages/ticket-core.js 中 navigationNeedsDeferredRender 保持一致。
 */

function planTicketListResync(prevKey, nextKey) {
  const listLike = (x) => x === "list" || x === "patch:list";
  if (nextKey === "patch:list" && prevKey !== "patch:list") {
    return { sync: true, ignoreSearch: true };
  }
  if (prevKey === "patch:list" && nextKey === "list") {
    return { sync: true, ignoreSearch: true };
  }
  if (!listLike(prevKey) && listLike(nextKey)) {
    return { sync: true, ignoreSearch: false };
  }
  return { sync: false, ignoreSearch: false };
}

function navigationNeedsDeferredRender(prevKey, nextKey) {
  if (nextKey === "home" && prevKey !== "home") return true;
  if (planTicketListResync(prevKey, nextKey).sync) return true;
  return typeof nextKey === "string" && nextKey.startsWith("ticket:");
}

describe("navigationNeedsDeferredRender", () => {
  test("主页 → 工作台：延后至列表同步完成后再 render", () => {
    expect(navigationNeedsDeferredRender("home", "list")).toBe(true);
  });

  test("工作台 → 主页：延后至主页列表同步完成后再 render", () => {
    expect(navigationNeedsDeferredRender("list", "home")).toBe(true);
  });

  test("统计页 → 工作台：延后", () => {
    expect(navigationNeedsDeferredRender("stats:charts", "list")).toBe(true);
  });

  test("工单详情 → 工作台：延后", () => {
    expect(navigationNeedsDeferredRender("ticket:YW20260101001", "list")).toBe(true);
  });

  test("主页 → 工单详情：延后（深链补拉）", () => {
    expect(navigationNeedsDeferredRender("home", "ticket:YW20260101001")).toBe(true);
  });

  test("已在工作台再次点工作台：立即 render", () => {
    expect(navigationNeedsDeferredRender("list", "list")).toBe(false);
  });

  test("已在主页再次点主页：立即 render", () => {
    expect(navigationNeedsDeferredRender("home", "home")).toBe(false);
  });

  test("主页 → 值班表：立即 render", () => {
    expect(navigationNeedsDeferredRender("home", "duty:roster")).toBe(false);
  });
});
