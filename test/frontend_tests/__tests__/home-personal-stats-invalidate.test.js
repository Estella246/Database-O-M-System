/**
 * 主页个人统计：流转提交后失效缓存，进入主页时须重新拉取。
 */
function invalidateHomePersonalStats(state) {
  state.homePersonalStatsLoadedKey = "";
  state.homePersonalStats = null;
}

function shouldRefetchHomePersonalStats(state, queryKey) {
  return state.homePersonalStatsLoadedKey !== queryKey && !state.homePersonalStatsLoading;
}

describe("invalidateHomePersonalStats", () => {
  test("清空已加载 key 与缓存 payload", () => {
    const state = {
      homePersonalStatsLoadedKey: "u1|2026-01-01|2026-01-31|all",
      homePersonalStats: { workload: { labels: ["01/01"], values: [1] } },
    };
    invalidateHomePersonalStats(state);
    expect(state.homePersonalStatsLoadedKey).toBe("");
    expect(state.homePersonalStats).toBeNull();
  });

  test("失效后 render 判定应触发重新拉取", () => {
    const state = {
      homePersonalStatsLoadedKey: "",
      homePersonalStats: null,
      homePersonalStatsLoading: false,
    };
    const key = "u1|2026-01-01|2026-01-31|all";
    expect(shouldRefetchHomePersonalStats(state, key)).toBe(true);
  });
});
