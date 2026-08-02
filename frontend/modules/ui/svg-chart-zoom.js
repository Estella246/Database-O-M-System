/**
 * SVG 图表点击放大：把图表（饼图含图例）克隆进全屏浮层，按 viewBox 等比放大展示，
 * 解决用户/领域过多时图表过小看不清的问题。适用 .stat-svg-chart / .stat-pie-svg。
 *
 * 柱状图放大后支持滚轮横向缩放 + 按住拖拽平移（复用统计图表 stats.js 的同款实现）。
 */
import {
  statsSvgParseViewBox,
  statsSvgCountXCategories,
  statsSvgCategoryMinSpan,
  createStatsSvgHorizontalZoomState,
  statsSvgWheelHorizontalZoom,
  statsSvgPanHorizontalZoom,
  statsSvgApplyHorizontalZoomViewBox,
} from "../pages/stats.js";

let _overlay = null;
function overlayEl() {
  if (_overlay && document.body.contains(_overlay)) return _overlay;
  _overlay = document.createElement("div");
  _overlay.className = "qi-chart-zoom-overlay";
  _overlay.setAttribute("hidden", "");
  _overlay.innerHTML = `
    <div class="qi-chart-zoom-backdrop"></div>
    <div class="qi-chart-zoom-dialog" role="dialog" aria-modal="true">
      <div class="qi-chart-zoom-head">
        <span class="qi-chart-zoom-title"></span>
        <span class="qi-chart-zoom-hint" hidden>滚轮缩放 · 按住拖拽平移</span>
        <button type="button" class="qi-chart-zoom-close" aria-label="关闭放大">✕</button>
      </div>
      <div class="qi-chart-zoom-host"></div>
    </div>`;
  document.body.appendChild(_overlay);
  const close = () => {
    _overlay.setAttribute("hidden", "");
    _overlay.querySelector(".qi-chart-zoom-host").innerHTML = "";
  };
  _overlay.querySelector(".qi-chart-zoom-backdrop").addEventListener("click", close);
  _overlay.querySelector(".qi-chart-zoom-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !_overlay.hidden) close(); });
  return _overlay;
}

function titleFor(chart) {
  const col = chart.closest(".req-analytics-dist-col, .req-analytics-block");
  const h = col && col.querySelector("h3, h2");
  return ((h && h.textContent) || "").trim() || chart.getAttribute("aria-label") || "图表";
}

/**
 * 给放大浮层里的柱状图绑定滚轮横向缩放 + 拖拽平移。
 * 直接绑定到克隆出的 svg 上：每次打开放大都是新克隆，旧克隆随 host.innerHTML=''
 * 一并移除（含其监听器），不会累积。逻辑与统计图表 bindStatsSvgHorizontalZoomHost 一致。
 */
function bindOverlayBarZoom(svg) {
  if (!svg || svg.dataset.overlayZoomBound === "1") return;
  if (svg.classList.contains("stat-pie-svg")) return; // 仅柱状图
  const fullVb = statsSvgParseViewBox(svg.getAttribute("viewBox"));
  if (!fullVb || fullVb.w <= 0 || fullVb.h <= 0) return;
  const categoryCount = statsSvgCountXCategories(svg);
  if (categoryCount < 2) return; // 类目太少不缩放

  svg.dataset.overlayZoomBound = "1";
  svg.setAttribute("title", "滚轮缩放，按住拖拽平移");
  svg.style.cursor = "grab";
  const minSpan = statsSvgCategoryMinSpan(categoryCount);
  let state = createStatsSvgHorizontalZoomState();
  const apply = () => statsSvgApplyHorizontalZoomViewBox(svg, state, fullVb);

  // 滚轮：向上(deltaY<0)放大 / 向下缩小
  svg.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      state = statsSvgWheelHorizontalZoom(state, ev.deltaY, { minSpan });
      apply();
    },
    { passive: false }
  );

  // 按住拖拽平移（仅放大后 span<1 生效）
  let dragging = false;
  let lastX = 0;
  const onMove = (ev) => {
    if (!dragging || state.span >= 1) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const deltaStart = (-(ev.clientX - lastX) / rect.width) * state.span;
    lastX = ev.clientX;
    state = statsSvgPanHorizontalZoom(state, deltaStart);
    apply();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    svg.style.cursor = "grab";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  svg.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || state.span >= 1) return;
    dragging = true;
    lastX = ev.clientX;
    svg.style.cursor = "grabbing";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

export function bindSvgChartZoom(rootEl, selector = ".stat-svg-chart, .stat-pie-svg") {
  if (!rootEl || !rootEl.querySelectorAll) return;
  const ov = overlayEl(); // 预建浮层并绑定关闭事件
  const hint = ov.querySelector(".qi-chart-zoom-hint");
  rootEl.querySelectorAll(selector).forEach((chart) => {
    if (chart.dataset.zoomBound) return;
    chart.dataset.zoomBound = "1";
    chart.style.cursor = "zoom-in";
    chart.addEventListener("click", () => {
      const host = ov.querySelector(".qi-chart-zoom-host");
      host.innerHTML = "";
      const cloned = chart.cloneNode(true);
      host.appendChild(cloned);
      // 饼图：附带紧邻的图例
      const legend = chart.nextElementSibling;
      if (chart.classList.contains("stat-pie-svg") && legend && legend.classList.contains("stat-pie-legend")) {
        host.appendChild(legend.cloneNode(true));
      }
      // 柱状图：绑定滚轮缩放 + 拖拽平移；饼图不支持
      const isBar = cloned.classList.contains("stat-svg-chart") && !cloned.classList.contains("stat-pie-svg");
      if (isBar) bindOverlayBarZoom(cloned);
      if (hint) hint.hidden = !isBar;
      ov.querySelector(".qi-chart-zoom-title").textContent = titleFor(chart);
      ov.removeAttribute("hidden");
    });
  });
}
