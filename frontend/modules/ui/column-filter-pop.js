/** 表头列筛选弹层挂到 body，fixed 定位，避免被表格 tbody / overflow 裁切。 */

import { armListSearchFocusRestore, registerListSearchInput } from "./list-search-input.js";

const POP_WIDTH = 220;
const LAYER_Z_INDEX = 10060;

/** @type {(() => void) | null} */
let unbindLayerListeners = null;

/**
 * @param {HTMLElement} pop
 * @param {HTMLElement} anchorEl
 */
export function positionColumnFilterPop(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = r.right - 6 - POP_WIDTH;
  let top = r.bottom + 4;

  if (left < margin) left = margin;
  if (left + POP_WIDTH > vw - margin) left = vw - POP_WIDTH - margin;

  pop.style.position = "fixed";
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.right = "auto";
  pop.style.width = `${POP_WIDTH}px`;
  pop.style.zIndex = String(LAYER_Z_INDEX);

  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > vh - margin) {
      const above = r.top - margin - pr.height;
      if (above >= margin) pop.style.top = `${above}px`;
    }
  });
}

/**
 * @param {HTMLElement} pop
 * @param {HTMLElement} anchorEl
 */
function bindColumnFilterPopLayerListeners(pop, anchorEl) {
  unbindColumnFilterPopLayerListeners();
  const reposition = () => positionColumnFilterPop(pop, anchorEl);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  unbindLayerListeners = () => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    unbindLayerListeners = null;
  };
}

export function unbindColumnFilterPopLayerListeners() {
  unbindLayerListeners?.();
}

/** 整页重绘前移除已挂到 body 的列筛选弹层 */
export function detachColumnFilterPopsFromBody() {
  unbindColumnFilterPopLayerListeners();
  document.querySelectorAll("body > .filter-pop.filter-pop--layer").forEach((el) => el.remove());
}

/** 将当前打开的表头列筛选弹层挂到 body 并定位 */
export function ensureColumnFilterPopOnBody() {
  const pop = document.querySelector(".admin-th-filter .filter-pop");
  if (!pop) return;
  const anchorTh = pop.closest(".admin-th-filter");
  const anchor = anchorTh?.querySelector(".filter-icon") || anchorTh;
  if (!(anchor instanceof HTMLElement)) return;

  pop.classList.add("filter-pop--layer");
  if (pop.parentNode !== document.body) {
    document.body.appendChild(pop);
  }
  positionColumnFilterPop(pop, anchor);
  bindColumnFilterPopLayerListeners(pop, anchor);
}

/** 点击外部关闭时：弹层挂 body 后仍视为筛选 UI 内部 */
export function isColumnFilterPopInteraction(target) {
  return target instanceof Element && (target.closest(".admin-th-filter") != null || target.closest(".filter-pop") != null);
}

const COLUMN_FILTER_SEARCH_DEBOUNCE_MS = 400;

/** @type {ReturnType<typeof setTimeout> | null} */
let columnFilterSearchDebounceTimer = null;

/** @param {() => void} apply */
export function scheduleColumnFilterSearchApply(apply) {
  if (columnFilterSearchDebounceTimer) clearTimeout(columnFilterSearchDebounceTimer);
  columnFilterSearchDebounceTimer = setTimeout(() => {
    columnFilterSearchDebounceTimer = null;
    apply();
  }, COLUMN_FILTER_SEARCH_DEBOUNCE_MS);
}

/** @param {() => void} apply */
export function flushColumnFilterSearchApply(apply) {
  if (columnFilterSearchDebounceTimer) {
    clearTimeout(columnFilterSearchDebounceTimer);
    columnFilterSearchDebounceTimer = null;
  }
  apply();
}

/**
 * 列筛选弹层内搜索：仅更新 state 中的关键词，防抖后再刷新选项列表，避免每键整页重绘。
 * @param {HTMLInputElement} el
 * @param {(value: string) => void} onValue
 * @param {() => void} onApply
 */
export function bindColumnFilterSearchInput(el, onValue, onApply) {
  registerListSearchInput(el);
  const applyWithFocus = () => {
    armListSearchFocusRestore(el);
    onApply();
  };
  el.addEventListener("input", (ev) => {
    onValue(el.value || "");
    if (ev.isComposing) return;
    scheduleColumnFilterSearchApply(applyWithFocus);
  });
  el.addEventListener("compositionend", () => {
    onValue(el.value || "");
    scheduleColumnFilterSearchApply(applyWithFocus);
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    onValue(el.value || "");
    flushColumnFilterSearchApply(applyWithFocus);
  });
}
