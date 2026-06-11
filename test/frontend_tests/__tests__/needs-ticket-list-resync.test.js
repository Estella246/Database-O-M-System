/**
 * 导航时工单列表拉取计划
 * 与 frontend/modules/pages/ticket-core.js 中 planTicketListResync 保持一致。
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

describe("planTicketListResync", () => {
  test("从主页进入补丁管理应全量拉 HOTPATCH", () => {
    expect(planTicketListResync("home", "patch:list")).toEqual({ sync: true, ignoreSearch: true });
  });

  test("从工作台进入补丁管理应全量拉 HOTPATCH", () => {
    expect(planTicketListResync("list", "patch:list")).toEqual({ sync: true, ignoreSearch: true });
  });

  test("从主页进入工作台应拉取且可带搜索", () => {
    expect(planTicketListResync("home", "list")).toEqual({ sync: true, ignoreSearch: false });
  });

  test("补丁管理回到工作台应全量拉 HCS", () => {
    expect(planTicketListResync("patch:list", "list")).toEqual({ sync: true, ignoreSearch: true });
  });

  test("同页签内切换不拉取", () => {
    expect(planTicketListResync("patch:list", "patch:list")).toEqual({ sync: false, ignoreSearch: false });
  });

  test("离开工作台到其他页不拉取", () => {
    expect(planTicketListResync("list", "settings:appearance")).toEqual({ sync: false, ignoreSearch: false });
    expect(planTicketListResync("list", "duty:roster")).toEqual({ sync: false, ignoreSearch: false });
  });

  test("离开工作台到主页不重复拉取", () => {
    expect(planTicketListResync("list", "home")).toEqual({ sync: false, ignoreSearch: false });
  });
});
