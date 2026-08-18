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
import { bindSvgChartTooltip } from "./svg-chart-tooltip.js";

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
    const host = _overlay.querySelector(".qi-chart-zoom-host");
    const E = typeof window !== "undefined" ? window.echarts : undefined;
    if (E && host) {
      host.querySelectorAll("[data-echart-host]").forEach((div) => {
        const inst = E.getInstanceByDom(div);
        if (inst) inst.dispose();
      });
    }
    host.innerHTML = "";
    _overlay.setAttribute("hidden", "");
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
 * 给柱状图 svg 绑定滚轮横向缩放 + 拖拽平移（统计图表同款）。
 * 既用于放大浮层里的克隆图，也用于页内柱状图（.qi-bar-plot 内）。
 * 浮层每次打开是新克隆；页内每次重渲染是新 svg —— 旧监听器随节点移除，不累积。
 */
export function bindBarHorizontalZoom(host) {
  if (!host) return;
  // 兼容两种入参：放大浮层里的 svg 克隆（直接传 svg）；页内 plot-slot 宿主（传 .qi-bar-plot，绑在宿主上避免 letterbox 死区）
  const isSvg = host.classList && host.classList.contains("stat-svg-chart");
  const svg = isSvg ? host : host.querySelector("svg.stat-svg-chart:not(.stat-pie-svg)");
  if (!svg || host.dataset.barZoomBound === "1") return;
  if (svg.classList.contains("stat-pie-svg")) return; // 仅柱状图
  const fullVb = statsSvgParseViewBox(svg.getAttribute("viewBox"));
  if (!fullVb || fullVb.w <= 0 || fullVb.h <= 0) return;
  const categoryCount = statsSvgCountXCategories(svg);
  if (categoryCount < 2) return; // 类目太少不缩放

  host.dataset.barZoomBound = "1";
  host.setAttribute("title", "滚轮缩放，按住拖拽平移");
  if (host.style) host.style.cursor = "grab";
  const minSpan = statsSvgCategoryMinSpan(categoryCount);
  let state = createStatsSvgHorizontalZoomState();
  const apply = () => statsSvgApplyHorizontalZoomViewBox(svg, state, fullVb);
  // 拖拽平移速度倍率（>1 更跟手）
  const PAN_SPEED = 3.0;

  // 滚轮：向上(deltaY<0)放大 / 向下缩小
  host.addEventListener(
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
    const rect = host.getBoundingClientRect();
    if (!rect.width) return;
    const deltaStart = (-(ev.clientX - lastX) / rect.width) * state.span * PAN_SPEED;
    lastX = ev.clientX;
    state = statsSvgPanHorizontalZoom(state, deltaStart);
    apply();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    if (host.style) host.style.cursor = "grab";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  host.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || state.span >= 1) return;
    dragging = true;
    lastX = ev.clientX;
    if (host.style) host.style.cursor = "grabbing";
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
      delete host.dataset.barZoomBound;
      // 全量优先：有 _fullRenderer 则放大展现全量（饼图含图例）；否则克隆当前图（阶段/改进类型等，全量==Top N）
      const fullStr = (typeof chart._fullRenderer === "function") ? chart._fullRenderer() : null;
      if (fullStr) {
        const tpl = document.createElement("template");
        tpl.innerHTML = fullStr.trim();
        host.appendChild(tpl.content.cloneNode(true));
      } else {
        host.appendChild(chart.cloneNode(true));
        const legend = chart.nextElementSibling;
        if (chart.classList.contains("stat-pie-svg") && legend && legend.classList.contains("stat-pie-legend")) {
          host.appendChild(legend.cloneNode(true));
        }
      }
      // 浮层内 hover 显示标签（复用页内同款浮动提示，读 <title>）
      bindSvgChartTooltip(host);
      // 柱状图：绑定滚轮缩放 + 拖拽平移（绑定在容器 host 上，覆盖 SVG+图例全区域）；饼图不支持
      const isBar = chart.classList.contains("stat-svg-chart") && !chart.classList.contains("stat-pie-svg");
      if (isBar) bindBarHorizontalZoom(host);
      if (hint) hint.hidden = !isBar;
      ov.querySelector(".qi-chart-zoom-title").textContent = titleFor(chart);
      ov.removeAttribute("hidden");
    });
  });
}

/**
 * 放大浮层内嵌 ECharts（迁移到 ECharts 的图表，如「提交数」）：
 * 浮层 host 里放一个带 data-echart-host 的容器，关闭时由 close() 统一 dispose。
 * buildOption() 返回 ECharts option（全量数据，不截断 Top N）。
 */
export function openChartZoomEchart(title, buildOption) {
  const ov = overlayEl();
  const host = ov.querySelector(".qi-chart-zoom-host");
  host.innerHTML = "";
  const div = document.createElement("div");
  div.className = "stat-echart-host";
  div.setAttribute("data-echart-host", "");
  host.appendChild(div);
  ov.querySelector(".qi-chart-zoom-title").textContent = title;
  const hint = ov.querySelector(".qi-chart-zoom-hint");
  if (hint) hint.hidden = true; // ECharts 自带 dataZoom 缩放，无需「滚轮缩放·拖拽平移」提示
  ov.removeAttribute("hidden");
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E || typeof buildOption !== "function") return;
  const paint = (attempt = 0) => {
    // 浮层已关闭（close 会清空 host，div 脱离文档）或超限后停止，避免每帧空转
    if (!div.isConnected || attempt >= 60) return;
    if (div.clientWidth < 2 || div.clientHeight < 2) {
      requestAnimationFrame(() => paint(attempt + 1));
      return;
    }
    const chart = E.init(div, null, { renderer: "canvas" });
    chart.setOption(buildOption(), { notMerge: true });
  };
  requestAnimationFrame(() => paint(0));
}

/**
 * 预建放大浮层（懒创建：图表点击后才出现，但首屏/测试需其存在于 DOM 且隐藏）。
 */
export function ensureChartZoomOverlay() {
  overlayEl();
}
