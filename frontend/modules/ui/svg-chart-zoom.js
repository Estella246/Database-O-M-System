/**
 * SVG 图表点击放大：把图表（饼图含图例）克隆进全屏浮层，按 viewBox 等比放大展示，
 * 解决用户/领域过多时图表过小看不清的问题。适用 .stat-svg-chart / .stat-pie-svg。
 */

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

export function bindSvgChartZoom(rootEl, selector = ".stat-svg-chart, .stat-pie-svg") {
  if (!rootEl || !rootEl.querySelectorAll) return;
  overlayEl(); // 预建浮层并绑定关闭事件
  rootEl.querySelectorAll(selector).forEach((chart) => {
    if (chart.dataset.zoomBound) return;
    chart.dataset.zoomBound = "1";
    chart.style.cursor = "zoom-in";
    chart.addEventListener("click", () => {
      const ov = overlayEl();
      const host = ov.querySelector(".qi-chart-zoom-host");
      host.innerHTML = "";
      host.appendChild(chart.cloneNode(true));
      // 饼图：附带紧邻的图例
      const legend = chart.nextElementSibling;
      if (chart.classList.contains("stat-pie-svg") && legend && legend.classList.contains("stat-pie-legend")) {
        host.appendChild(legend.cloneNode(true));
      }
      ov.querySelector(".qi-chart-zoom-title").textContent = titleFor(chart);
      ov.removeAttribute("hidden");
    });
  });
}
