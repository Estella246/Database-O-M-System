// 富文本图片缩放控件：点击图片 → 四周虚线 + 8 个手柄（4 边 + 4 角）拖拽缩放
// 用法：attachImageResizer(richContentElement, onChange)

const HANDLE_POSITIONS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

let _activeOverlay = null;
let _activeImg = null;

export function attachImageResizer(contentEl, onChange) {
  if (!contentEl || contentEl.dataset.imgResizerBound === "1") return;
  contentEl.dataset.imgResizerBound = "1";

  contentEl.addEventListener("click", (ev) => {
    const img = ev.target.closest("img");
    if (img) {
      showResizer(img, contentEl, onChange);
    } else {
      hideResizer();
    }
  });

  // 点击外部取消选中
  document.addEventListener("mousedown", (ev) => {
    if (_activeOverlay && !_activeOverlay.contains(ev.target) && _activeImg && !_activeImg.contains(ev.target)) {
      hideResizer();
    }
  });
}

function showResizer(img, contentEl, onChange) {
  hideResizer();
  _activeImg = img;

  // 确保图片有显式尺寸（按需初始化）
  if (!img.style.width) {
    const w = img.naturalWidth > 0 ? Math.min(img.naturalWidth, contentEl.clientWidth - 30) : 300;
    img.style.width = w + "px";
  }
  const rect = img.getBoundingClientRect();
  const naturalRatio = (img.naturalHeight && img.naturalWidth) ? img.naturalHeight / img.naturalWidth : 1;

  // 创建覆盖层（覆盖在图片上，含虚线框 + 8 手柄）
  const overlay = document.createElement("div");
  overlay.className = "qi-img-resizer-overlay";
  overlay.style.cssText = `position:fixed; left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px; z-index:9999; pointer-events:none;`;
  overlay.innerHTML = `
    <div class="qi-img-resizer-box"></div>
    ${HANDLE_POSITIONS.map(pos => `<div class="qi-img-handle qi-img-handle--${pos}" data-pos="${pos}"></div>`).join("")}
  `;
  document.body.appendChild(overlay);
  _activeOverlay = overlay;

  // 给图片加选中轮廓（虚线）
  img.classList.add("qi-img-selected");

  // 定位手柄
  positionHandles(overlay, rect);

  // 绑定拖拽
  overlay.querySelectorAll(".qi-img-handle").forEach(handle => {
    handle.style.pointerEvents = "auto";
    handle.addEventListener("mousedown", (ev) => startResize(ev, handle.getAttribute("data-pos"), img, overlay, contentEl, naturalRatio, onChange));
  });

  // 滚动/resize 时重新定位
  const reposition = () => {
    if (!_activeImg || !_activeOverlay) return;
    const r = img.getBoundingClientRect();
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    positionHandles(overlay, r);
  };
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition);
  overlay._reposition = reposition;
}

function positionHandles(overlay, rect) {
  const handles = overlay.querySelectorAll(".qi-img-handle");
  handles.forEach(h => {
    const pos = h.getAttribute("data-pos");
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const map = { nw: [0, 0], n: [cx, 0], ne: [rect.width, 0], e: [rect.width, cy], se: [rect.width, rect.height], s: [cx, rect.height], sw: [0, rect.height], w: [0, cy] };
    const [x, y] = map[pos];
    h.style.left = (x - 6) + "px";
    h.style.top = (y - 6) + "px";
  });
}

function startResize(ev, pos, img, overlay, contentEl, ratio, onChange) {
  ev.preventDefault();
  ev.stopPropagation();
  const startX = ev.clientX;
  const startY = ev.clientY;
  const startW = img.getBoundingClientRect().width;
  const startH = img.getBoundingClientRect().height;
  const minSize = 40;
  const maxSize = contentEl.clientWidth * 2;
  const keepRatio = pos.length === 2; // 角落拖拽保持比例

  const onMove = (e) => {
    let newW = startW, newH = startH;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (pos.includes("e")) newW = startW + dx;
    if (pos.includes("w")) newW = startW - dx;
    if (pos.includes("s")) newH = startH + dy;
    if (pos.includes("n")) newH = startH - dy;
    newW = Math.max(minSize, Math.min(maxSize, newW));
    if (keepRatio) {
      // 角落：按宽度为主，高度按比例
      newH = newW * ratio;
    } else {
      newH = Math.max(minSize, Math.min(maxSize, newH));
    }
    img.style.width = newW + "px";
    img.style.height = newH + "px";
    // 同步覆盖层
    const r = img.getBoundingClientRect();
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    positionHandles(overlay, r);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    if (onChange) onChange();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

export function hideResizer() {
  if (_activeOverlay) {
    if (_activeOverlay._reposition) {
      window.removeEventListener("scroll", _activeOverlay._reposition);
      window.removeEventListener("resize", _activeOverlay._reposition);
    }
    _activeOverlay.remove();
    _activeOverlay = null;
  }
  if (_activeImg) {
    _activeImg.classList.remove("qi-img-selected");
    _activeImg = null;
  }
}
