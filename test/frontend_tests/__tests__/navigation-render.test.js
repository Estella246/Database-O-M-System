/**
 * 导航切换：先立即 render 切页；列表同步后就地 patch 表格，避免第二次整页重绘。
 * 与 frontend/modules/pages/ticket-core.js 中 navigationNeedsAsyncListSync 保持一致。
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

function navigationNeedsAsyncListSync(prevKey, nextKey) {
  if (nextKey === "home" && prevKey !== "home") return true;
  if (planTicketListResync(prevKey, nextKey).sync) return true;
  return typeof nextKey === "string" && nextKey.startsWith("ticket:");
}

describe("navigationNeedsAsyncListSync", () => {
  test("主页 → 工作台：首帧立即切页，后台拉列表后再 render", () => {
    expect(navigationNeedsAsyncListSync("home", "list")).toBe(true);
  });

  test("工作台 → 主页：首帧立即切页，后台拉主页列表后再 render", () => {
    expect(navigationNeedsAsyncListSync("list", "home")).toBe(true);
  });

  test("统计页 → 工作台：后台拉列表", () => {
    expect(navigationNeedsAsyncListSync("stats:charts", "list")).toBe(true);
  });

  test("工单详情 → 工作台：后台拉列表", () => {
    expect(navigationNeedsAsyncListSync("ticket:YW20260101001", "list")).toBe(true);
  });

  test("主页 → 工单详情：后台深链补拉", () => {
    expect(navigationNeedsAsyncListSync("home", "ticket:YW20260101001")).toBe(true);
  });

  test("已在工作台再次点工作台：仅首帧 render", () => {
    expect(navigationNeedsAsyncListSync("list", "list")).toBe(false);
  });

  test("已在主页再次点主页：仅首帧 render", () => {
    expect(navigationNeedsAsyncListSync("home", "home")).toBe(false);
  });

  test("主页 → 值班表：仅首帧 render", () => {
    expect(navigationNeedsAsyncListSync("home", "duty:roster")).toBe(false);
  });
});

describe("ensureDeepLinkTicketLoaded 与详情预加载", () => {
  test("ticket-core 在节点表单预加载完成后才二次 render", () => {
    const coreSrc = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../../frontend/modules/pages/ticket-core.js"),
      "utf8",
    );
    expect(coreSrc).toMatch(/preloadTicketDetailContent/);
    expect(coreSrc).toMatch(/if\s*\(state\.ticketDetailHydratingOrderId\s*===\s*orderId\)/);
    expect(coreSrc).toMatch(/if\s*\(getTicketById\(orderId\)\)\s*return false/);
  });
});
