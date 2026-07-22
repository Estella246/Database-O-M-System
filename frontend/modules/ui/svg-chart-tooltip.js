/**
 * SVG 图表 hover 浮动提示。
 * 原生 <title> 在 SVG 元素上常被浏览器忽略或延迟明显，这里改用一个跟随鼠标的
 * 浮动提示，读取元素 <title> 的文本展示。适用 .stat-bar-rect / .stat-pie-slice /
 * .stat-line-dot 等带 <title> 的 SVG 图形。
 */

let _tipEl = null;
function tipEl() {
  if (_tipEl && document.body.contains(_tipEl)) return _tipEl;
  _tipEl = document.createElement("div");
  _tipEl.className = "stat-svg-tooltip";
  _tipEl.style.display = "none";
  document.body.appendChild(_tipEl);
  return _tipEl;
}

export function bindSvgChartTooltip(rootEl, selector = ".stat-bar-rect, .stat-pie-slice, .stat-line-dot") {
  if (!rootEl || !rootEl.querySelectorAll) return;
  const tip = tipEl();
  tip.style.display = "none"; // 重新绑定（重渲染）时先隐藏，避免残影
  rootEl.querySelectorAll(selector).forEach((el) => {
    const t = el.querySelector("title");
    const text = t ? t.textContent.trim() : "";
    if (!text) return;
    el.addEventListener("mouseenter", () => {
      tip.textContent = text;
      tip.style.display = "block";
    });
    el.addEventListener("mousemove", (e) => {
      tip.style.left = e.clientX + 14 + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    el.addEventListener("mouseleave", () => {
      tip.style.display = "none";
    });
  });
}
