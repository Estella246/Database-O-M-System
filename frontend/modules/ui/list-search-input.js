/**
 * 列表/弹层搜索框标准绑定（与工作台一致）：
 * 立即写 state、中文 composition、Enter 立即搜、防抖拉数；
 * 输入/拼音期间挂起整页 render，停手后再刷新，避免 IME 被打断。
 */

import { forceRequestRender } from "../core/scheduler.js";

/** @type {{ id: string, start: number, end: number } | null} */
let _pendingFocus = null;
let _skipNextLoadingRender = false;

/** @type {Set<string>} */
const _registeredSearchIds = new Set();

let _composing = false;
let _searchFocused = false;
let _lastActivityAt = 0;
let _renderDeferred = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let _quietFlushTimer = null;

/** 停手多久后允许整页重绘（仍聚焦时） */
export const LIST_SEARCH_RENDER_QUIET_MS = 500;

/**
 * @param {string | HTMLInputElement | null | undefined} inputOrId
 * @returns {HTMLInputElement | null}
 */
function resolveSearchInput(inputOrId) {
  if (typeof inputOrId === "string") {
    const el = document.getElementById(inputOrId);
    return el instanceof HTMLInputElement ? el : null;
  }
  return inputOrId instanceof HTMLInputElement ? inputOrId : null;
}

function isRegisteredSearchEl(el) {
  return el instanceof HTMLInputElement && !!el.id && _registeredSearchIds.has(el.id);
}

function noteActivity() {
  _lastActivityAt = Date.now();
  scheduleQuietFlush();
}

function scheduleQuietFlush() {
  if (_quietFlushTimer) clearTimeout(_quietFlushTimer);
  _quietFlushTimer = setTimeout(() => {
    _quietFlushTimer = null;
    flushDeferredListSearchRender();
  }, LIST_SEARCH_RENDER_QUIET_MS + 20);
}

/**
 * 搜索框仍在输入（聚焦且未停手，或正在拼音）时，应挂起整页 render。
 * @returns {boolean}
 */
export function shouldDeferListSearchRender() {
  if (_composing) return true;
  if (!_searchFocused) return false;
  return Date.now() - _lastActivityAt < LIST_SEARCH_RENDER_QUIET_MS;
}

/** 标记有一次因搜索输入而挂起的 render。 */
export function markListSearchRenderDeferred() {
  _renderDeferred = true;
}

/**
 * Enter / 明确要立刻刷列表时：放开「停手窗口」，允许马上整页重绘。
 */
export function releaseListSearchRenderHold() {
  _composing = false;
  _lastActivityAt = 0;
  if (_quietFlushTimer) {
    clearTimeout(_quietFlushTimer);
    _quietFlushTimer = null;
  }
}

/**
 * 若已挂起且当前可安全重绘，则冲刷一次。
 * @returns {boolean} 是否发起了冲刷
 */
export function flushDeferredListSearchRender() {
  if (!_renderDeferred) return false;
  if (shouldDeferListSearchRender()) {
    scheduleQuietFlush();
    return false;
  }
  _renderDeferred = false;
  forceRequestRender();
  return true;
}

/**
 * 在即将因搜索触发整页重绘前调用：记录当前搜索框光标。
 * @param {string | HTMLInputElement | null | undefined} inputOrId
 */
export function armListSearchFocusRestore(inputOrId) {
  const el = resolveSearchInput(inputOrId);
  if (!el || document.activeElement !== el) {
    _pendingFocus = null;
    return;
  }
  _pendingFocus = {
    id: el.id || "",
    start: el.selectionStart ?? el.value.length,
    end: el.selectionEnd ?? el.value.length,
  };
}

/** 整页重绘前：若焦点在已注册搜索框上，捕获最新光标。 */
export function armActiveListSearchFocusRestore() {
  const active = document.activeElement;
  if (!isRegisteredSearchEl(active)) return;
  armListSearchFocusRestore(/** @type {HTMLInputElement} */ (active));
}

/** 标记下一次列表 fetch 开头的 loading `requestRender` 应跳过（搜索触发时用）。 */
export function markSkipListLoadingRender() {
  _skipNextLoadingRender = true;
}

/** @returns {boolean} */
export function consumeSkipListLoadingRender() {
  if (!_skipNextLoadingRender) return false;
  _skipNextLoadingRender = false;
  return true;
}

/** 在 `render()` 末尾调用，恢复搜索框焦点与光标。 */
export function restoreListSearchFocus() {
  const pending = _pendingFocus;
  _pendingFocus = null;
  if (!pending?.id) return;
  const el = document.getElementById(pending.id);
  if (!(el instanceof HTMLInputElement)) return;
  el.focus({ preventScroll: true });
  const len = el.value.length;
  try {
    el.setSelectionRange(Math.min(pending.start, len), Math.min(pending.end, len));
  } catch (_) {
    /* type=search 在部分环境下可能不支持 setSelectionRange */
  }
}

/**
 * 注册搜索框：跟踪 focus / composition，供 render 挂起判断。
 * @param {HTMLInputElement} el
 */
function attachSearchLifecycle(el) {
  if (!el?.id) return;
  _registeredSearchIds.add(el.id);
  if (el.dataset.listSearchLifecycle === "1") return;
  el.dataset.listSearchLifecycle = "1";

  el.addEventListener("focus", () => {
    _searchFocused = true;
    noteActivity();
  });
  el.addEventListener("blur", () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (isRegisteredSearchEl(active)) {
        _searchFocused = true;
        return;
      }
      _searchFocused = false;
      _composing = false;
      flushDeferredListSearchRender();
    }, 0);
  });
  el.addEventListener("compositionstart", () => {
    _composing = true;
    _searchFocused = true;
    noteActivity();
  });
  el.addEventListener("compositionupdate", () => {
    _composing = true;
    noteActivity();
  });
  el.addEventListener("compositionend", () => {
    _composing = false;
    noteActivity();
    scheduleQuietFlush();
  });
  el.addEventListener("keydown", () => {
    noteActivity();
  });
}

/**
 * @param {HTMLInputElement | null | undefined} el
 * @param {{
 *   debounceMs?: number,
 *   skipLoadingRender?: boolean,
 *   onValue: (value: string) => void,
 *   onSearch: () => void,
 * }} opts
 * skipLoadingRender 默认 true（服务端列表跳过 fetch 开头 loading 整页 render）；纯前端过滤传 false。
 * @returns {() => void} 清理函数（可选）
 */
export function bindListSearchInput(el, opts) {
  if (!el || typeof opts?.onValue !== "function" || typeof opts?.onSearch !== "function") {
    return () => {};
  }
  attachSearchLifecycle(el);

  const debounceMs = Number(opts.debounceMs) > 0 ? Number(opts.debounceMs) : 800;
  const skipLoadingRender = opts.skipLoadingRender !== false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  const runSearch = () => {
    armListSearchFocusRestore(el);
    if (skipLoadingRender) markSkipListLoadingRender();
    opts.onSearch();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      runSearch();
    }, debounceMs);
  };

  const onInput = (ev) => {
    noteActivity();
    opts.onValue(el.value || "");
    if (ev.isComposing) return;
    schedule();
  };
  const onCompositionEnd = () => {
    opts.onValue(el.value || "");
    schedule();
  };
  const onKeyDown = (ev) => {
    if (ev.key !== "Enter") return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    releaseListSearchRenderHold();
    opts.onValue(el.value || "");
    runSearch();
  };

  el.addEventListener("input", onInput);
  el.addEventListener("compositionend", onCompositionEnd);
  el.addEventListener("keydown", onKeyDown);

  return () => {
    if (timer) clearTimeout(timer);
    el.removeEventListener("input", onInput);
    el.removeEventListener("compositionend", onCompositionEnd);
    el.removeEventListener("keydown", onKeyDown);
  };
}

/**
 * 工作台等手写绑定的搜索框：注册生命周期（挂起 render）。
 * @param {HTMLInputElement | null | undefined} el
 */
export function registerListSearchInput(el) {
  if (el instanceof HTMLInputElement) attachSearchLifecycle(el);
}

/**
 * 工具广场等 document 委托绑定：在事件里同步 composing / activity。
 * @param {HTMLInputElement | EventTarget | null | undefined} el
 * @param {"activity" | "compositionstart" | "compositionend" | "blur"} kind
 */
export function noteListSearchInputEvent(el, kind) {
  if (!(el instanceof HTMLInputElement) || !el.id) return;
  if (!_registeredSearchIds.has(el.id)) _registeredSearchIds.add(el.id);
  if (kind === "compositionstart") {
    _composing = true;
    _searchFocused = true;
    noteActivity();
    return;
  }
  if (kind === "compositionend") {
    _composing = false;
    noteActivity();
    scheduleQuietFlush();
    return;
  }
  if (kind === "blur") {
    setTimeout(() => {
      if (isRegisteredSearchEl(document.activeElement)) {
        _searchFocused = true;
        return;
      }
      _searchFocused = false;
      _composing = false;
      flushDeferredListSearchRender();
    }, 0);
    return;
  }
  _searchFocused = document.activeElement === el || _searchFocused;
  noteActivity();
}
