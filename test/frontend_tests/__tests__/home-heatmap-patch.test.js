/**
 * 进入主页后热力图接口返回时须就地更新 DOM，不能依赖整页第二次 render。
 */
describe("patchMyHomeHeatmapDom", () => {
  function patchMyHomeHeatmapDom({ activeKey, homeEl, renderHtml, bind }) {
    if (activeKey !== "home") return false;
    if (!homeEl) return false;
    homeEl.innerHTML = renderHtml();
    bind();
    return true;
  }

  test("主页存在时替换热力图并绑定交互", () => {
    const homeEl = { innerHTML: "" };
    let bound = false;
    const ok = patchMyHomeHeatmapDom({
      activeKey: "home",
      homeEl,
      renderHtml: () => '<div class="order-heatmap-card">ok</div>',
      bind: () => {
        bound = true;
      },
    });
    expect(ok).toBe(true);
    expect(homeEl.innerHTML).toContain("order-heatmap-card");
    expect(bound).toBe(true);
  });

  test("非主页或节点缺失时返回 false，供调用方回退 requestRender", () => {
    expect(
      patchMyHomeHeatmapDom({
        activeKey: "list",
        homeEl: { innerHTML: "" },
        renderHtml: () => "x",
        bind: () => {},
      })
    ).toBe(false);
    expect(
      patchMyHomeHeatmapDom({
        activeKey: "home",
        homeEl: null,
        renderHtml: () => "x",
        bind: () => {},
      })
    ).toBe(false);
  });
});
