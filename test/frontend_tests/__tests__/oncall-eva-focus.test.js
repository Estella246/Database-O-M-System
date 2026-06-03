/**
 * 运维效率第一幅图（主角成绩单）默认聚焦逻辑 - 纯函数单元测试。
 * 对应模块：frontend/modules/pages/oncall-eva-page.js 的 pickFocusedItem。
 * 需求：默认显示本组得分最高的人员（items 已按 total_score 降序）。
 *
 * 约定：与源文件保持同步（沿用本套件「复制纯函数到测试」的策略）。
 */

function pickFocusedItem(items, selectedAccount) {
  if (!items || !items.length) return null;
  if (!selectedAccount) return items[0];
  return items.find((x) => x.account === selectedAccount) || items[0];
}

describe("pickFocusedItem", () => {
  // 后端已按 total_score 降序，items[0] 即本组最高分
  const items = [
    { account: "top", total_score: 95 },
    { account: "mid", total_score: 80 },
    { account: "low", total_score: 60 },
  ];

  test("无选择时默认聚焦本组得分最高者（榜首）", () => {
    expect(pickFocusedItem(items, "").account).toBe("top");
    expect(pickFocusedItem(items, undefined).account).toBe("top");
    expect(pickFocusedItem(items, null).account).toBe("top");
  });

  test("有显式选择时聚焦所选人员", () => {
    expect(pickFocusedItem(items, "mid").account).toBe("mid");
  });

  test("所选人员不在本组（切组残留）时回退到榜首", () => {
    expect(pickFocusedItem(items, "not_in_group").account).toBe("top");
  });

  test("空列表返回 null", () => {
    expect(pickFocusedItem([], "")).toBeNull();
    expect(pickFocusedItem(null, "x")).toBeNull();
  });
});
