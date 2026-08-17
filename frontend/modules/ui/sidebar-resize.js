/** 侧栏展开宽度（px），持久化到 localStorage */
export const SIDEBAR_WIDTH_STORAGE_KEY = "gauss_sidebar_width_px";
/** 侧栏是否收起，持久化到 localStorage（整页 render 后仍保持） */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "gauss_sidebar_collapsed";
export const SIDEBAR_WIDTH_DEFAULT = 136;
export const SIDEBAR_WIDTH_MIN = 112;
export const SIDEBAR_WIDTH_MAX = 360;

export function clampSidebarWidth(px) {
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
}

export function loadStoredSidebarWidth() {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null || raw === "") return SIDEBAR_WIDTH_DEFAULT;
    return clampSidebarWidth(Number(raw));
  } catch (_) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

export function saveStoredSidebarWidth(px) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(px)));
  } catch (_) {
    /* ignore */
  }
}

export function loadStoredSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

export function saveStoredSidebarCollapsed(collapsed) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch (_) {
    /* ignore */
  }
}

export function readLayoutSidebarWidth(layoutEl) {
  if (!layoutEl) return loadStoredSidebarWidth();
  const inline = layoutEl.style.getPropertyValue("--sidebar-width").trim();
  if (inline) {
    const n = parseFloat(inline);
    if (Number.isFinite(n)) return clampSidebarWidth(n);
  }
  return loadStoredSidebarWidth();
}

export function applySidebarWidth(layoutEl, px, { collapsed = false } = {}) {
  if (!layoutEl) return;
  if (collapsed) {
    layoutEl.style.removeProperty("--sidebar-width");
    return;
  }
  layoutEl.style.setProperty("--sidebar-width", `${clampSidebarWidth(px)}px`);
}

/**
 * 侧栏右缘拖拽改宽；宽度写入 localStorage，下次进入页面仍生效。
 */
export function bindSidebarResize(rootEl, { signal } = {}) {
  const layout = rootEl.querySelector(".layout");
  const handle = rootEl.querySelector(".sidebar-resize-handle");
  const collapseBtn = rootEl.querySelector("#collapse-btn");
  if (!layout || !handle) return;

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, { ...opts, signal });
  };

  const isCollapsed = () => layout.classList.contains("left-collapsed");

  const syncExpandedWidth = () => {
    if (isCollapsed()) {
      applySidebarWidth(layout, loadStoredSidebarWidth(), { collapsed: true });
      return;
    }
    applySidebarWidth(layout, loadStoredSidebarWidth(), { collapsed: false });
  };

  syncExpandedWidth();

  if (collapseBtn) {
    on(collapseBtn, "click", () => {
      requestAnimationFrame(syncExpandedWidth);
    });
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("sidebar-resize-handle--dragging");
    document.body.classList.remove("sidebar-resize-active");
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    const w = readLayoutSidebarWidth(layout);
    saveStoredSidebarWidth(w);
    applySidebarWidth(layout, w, { collapsed: isCollapsed() });
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };

  const onPointerMove = (e) => {
    if (!dragging || isCollapsed()) return;
    const next = clampSidebarWidth(startWidth + (e.clientX - startX));
    layout.style.setProperty("--sidebar-width", `${next}px`);
  };

  on(handle, "pointerdown", (e) => {
    if (isCollapsed() || e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = readLayoutSidebarWidth(layout);
    handle.classList.add("sidebar-resize-handle--dragging");
    document.body.classList.add("sidebar-resize-active");
    handle.setPointerCapture(e.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  });

  on(handle, "keydown", (e) => {
    if (isCollapsed()) return;
    let delta = 0;
    if (e.key === "ArrowRight") delta = 8;
    else if (e.key === "ArrowLeft") delta = -8;
    else return;
    e.preventDefault();
    const next = clampSidebarWidth(readLayoutSidebarWidth(layout) + delta);
    saveStoredSidebarWidth(next);
    applySidebarWidth(layout, next, { collapsed: false });
  });
}
