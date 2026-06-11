import { formatYmdLocal } from "../utils/format.js";
import {
  dateRangePickerHintText,
  isYmdInRange,
  normalizeRangeStartEnd,
  shiftCalendarViewMonth,
  shiftCalendarViewYear,
} from "../utils/date-range-pick.js";

let rootEl = null;
let onDocKey = null;
let onWinScroll = null;

export function destroyDateRangePickerOverlay() {
  if (onDocKey) {
    document.removeEventListener("keydown", onDocKey, true);
    onDocKey = null;
  }
  if (onWinScroll) {
    window.removeEventListener("scroll", onWinScroll, true);
    onWinScroll = null;
  }
  if (rootEl) {
    rootEl.remove();
    rootEl = null;
  }
}

/** @deprecated 使用 destroyDateRangePickerOverlay */
export const destroyWorkbenchCreatedCalendarOverlay = destroyDateRangePickerOverlay;

function monthCells(viewYear, viewMonth) {
  const cells = [];
  const first = new Date(viewYear, viewMonth, 1);
  const pad = first.getDay();
  for (let i = 0; i < 42; i += 1) {
    const day = i - pad + 1;
    const dt = new Date(viewYear, viewMonth, day);
    const inMonth = dt.getMonth() === viewMonth;
    cells.push({ dt, inMonth, ymd: formatYmdLocal(dt) });
  }
  return cells;
}

function applyDayRangeClasses(btn, ymd, selectedStart, selectedEnd) {
  const s = String(selectedStart || "").trim();
  const e = String(selectedEnd || "").trim();
  if (!s) return;
  if (s && !e) {
    if (ymd === s) btn.classList.add("is-range-start");
    return;
  }
  const { start, end } = normalizeRangeStartEnd(s, e);
  if (start === end && ymd === start) {
    btn.classList.add("is-range-start", "is-range-end");
    return;
  }
  if (ymd === start) btn.classList.add("is-range-start");
  if (ymd === end) btn.classList.add("is-range-end");
  if (isYmdInRange(ymd, start, end) && ymd !== start && ymd !== end) {
    btn.classList.add("is-in-range");
  }
}

function positionPanel(panel, anchorEl) {
  if (!anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  const pad = 8;
  const pw = 300;
  const ph = 360;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + pw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pw - pad);
  if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - ph - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/**
 * @param {object} opts
 * @param {{ viewYear: number, viewMonth: number, phase?: import("../utils/date-range-pick.js").DateRangePickPhase }} opts.cfg
 * @param {string} opts.selectedStart
 * @param {string} opts.selectedEnd
 * @param {HTMLElement | null} opts.anchorEl
 * @param {(y: number, m: number) => void} opts.onNavigate
 * @param {(ymd: string) => void} opts.onPick
 * @param {() => void} opts.onClear
 * @param {() => void} opts.onClose
 */
export function mountDateRangePickerOverlay(opts) {
  destroyDateRangePickerOverlay();
  const { cfg, selectedStart, selectedEnd, anchorEl, onNavigate, onPick, onClear, onClose } = opts;
  if (!anchorEl) {
    onClose();
    return;
  }

  const rangePhase = cfg.phase ?? null;

  const layer = document.createElement("div");
  layer.className = "workbench-glass-cal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "workbench-glass-cal-backdrop";
  backdrop.setAttribute("aria-label", "关闭日历");
  backdrop.addEventListener("click", () => onClose());

  const panel = document.createElement("div");
  panel.className = "workbench-glass-cal-panel";

  const head = document.createElement("div");
  head.className = "workbench-glass-cal-head";

  const prevGroup = document.createElement("div");
  prevGroup.className = "workbench-glass-cal-nav-group";

  const prevYearBtn = document.createElement("button");
  prevYearBtn.type = "button";
  prevYearBtn.className = "workbench-glass-cal-nav workbench-glass-cal-nav--year";
  prevYearBtn.textContent = "«";
  prevYearBtn.setAttribute("aria-label", "上一年");

  const prevMonthBtn = document.createElement("button");
  prevMonthBtn.type = "button";
  prevMonthBtn.className = "workbench-glass-cal-nav workbench-glass-cal-nav--month";
  prevMonthBtn.textContent = "‹";
  prevMonthBtn.setAttribute("aria-label", "上一月");

  const title = document.createElement("div");
  title.className = "workbench-glass-cal-title";

  const nextGroup = document.createElement("div");
  nextGroup.className = "workbench-glass-cal-nav-group";

  const nextMonthBtn = document.createElement("button");
  nextMonthBtn.type = "button";
  nextMonthBtn.className = "workbench-glass-cal-nav workbench-glass-cal-nav--month";
  nextMonthBtn.textContent = "›";
  nextMonthBtn.setAttribute("aria-label", "下一月");

  const nextYearBtn = document.createElement("button");
  nextYearBtn.type = "button";
  nextYearBtn.className = "workbench-glass-cal-nav workbench-glass-cal-nav--year";
  nextYearBtn.textContent = "»";
  nextYearBtn.setAttribute("aria-label", "下一年");

  title.textContent = `${cfg.viewYear}年${cfg.viewMonth + 1}月`;

  prevYearBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const { viewYear, viewMonth } = shiftCalendarViewYear(cfg.viewYear, cfg.viewMonth, -1);
    onNavigate(viewYear, viewMonth);
  });
  prevMonthBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const { viewYear, viewMonth } = shiftCalendarViewMonth(cfg.viewYear, cfg.viewMonth, -1);
    onNavigate(viewYear, viewMonth);
  });
  nextMonthBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const { viewYear, viewMonth } = shiftCalendarViewMonth(cfg.viewYear, cfg.viewMonth, 1);
    onNavigate(viewYear, viewMonth);
  });
  nextYearBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const { viewYear, viewMonth } = shiftCalendarViewYear(cfg.viewYear, cfg.viewMonth, 1);
    onNavigate(viewYear, viewMonth);
  });

  prevGroup.append(prevYearBtn, prevMonthBtn);
  nextGroup.append(nextMonthBtn, nextYearBtn);
  head.append(prevGroup, title, nextGroup);

  const weekRow = document.createElement("div");
  weekRow.className = "workbench-glass-cal-weekdays";
  ["日", "一", "二", "三", "四", "五", "六"].forEach((w) => {
    const c = document.createElement("div");
    c.className = "workbench-glass-cal-wd";
    c.textContent = w;
    weekRow.appendChild(c);
  });

  const grid = document.createElement("div");
  grid.className = "workbench-glass-cal-grid";

  const todayYmd = formatYmdLocal(new Date());

  monthCells(cfg.viewYear, cfg.viewMonth).forEach(({ dt, inMonth, ymd }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "workbench-glass-cal-day";
    if (!inMonth) b.classList.add("is-muted");
    b.textContent = String(dt.getDate());
    if (ymd === todayYmd) b.classList.add("is-today");
    applyDayRangeClasses(b, ymd, selectedStart, selectedEnd);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onPick(ymd);
    });
    grid.appendChild(b);
  });

  const hint = document.createElement("div");
  hint.className = "workbench-glass-cal-hint";
  hint.textContent = dateRangePickerHintText(selectedStart, selectedEnd, rangePhase);

  const foot = document.createElement("div");
  foot.className = "workbench-glass-cal-foot";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "workbench-glass-cal-clear";
  clearBtn.textContent = "清除日期范围";
  clearBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClear();
  });
  foot.appendChild(clearBtn);

  panel.addEventListener("click", (ev) => ev.stopPropagation());
  panel.append(head, weekRow, grid, hint, foot);
  layer.append(backdrop, panel);
  document.body.appendChild(layer);
  rootEl = layer;
  positionPanel(panel, anchorEl);

  onDocKey = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    }
  };
  document.addEventListener("keydown", onDocKey, true);

  onWinScroll = () => onClose();
  window.addEventListener("scroll", onWinScroll, true);
}

/** @deprecated 使用 mountDateRangePickerOverlay */
export const mountWorkbenchCreatedCalendarOverlay = mountDateRangePickerOverlay;
