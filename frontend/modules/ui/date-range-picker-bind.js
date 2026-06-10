import { state } from "../state/state.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { parseYmdToDate } from "../utils/date.js";
import { reduceRangeDateClick } from "../utils/date-range-pick.js";
import {
  destroyDateRangePickerOverlay,
  mountDateRangePickerOverlay,
} from "./workbench-glass-datepicker.js";

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} [opts.startYmd]
 * @param {string} [opts.endYmd]
 * @param {string} [opts.startLabel]
 * @param {string} [opts.endLabel]
 * @param {string} [opts.className]
 * @param {string} [opts.title]
 */
export function renderDateRangeHtml({
  id,
  startYmd = "",
  endYmd = "",
  startLabel = "开始日期",
  endLabel = "结束日期",
  className = "",
  title = "点击选择日期范围",
}) {
  const startDisp = startYmd || startLabel;
  const endDisp = endYmd || endLabel;
  const cls = ["date-range", className].filter(Boolean).join(" ");
  return `
    <div class="${cls}" data-date-range-id="${escapeAttr(id)}" title="${escapeAttr(title)}">
      <button type="button" class="date-trigger" data-range-part="start" aria-label="开始日期">${escapeHtml(startDisp)}</button>
      <span class="date-sep">--</span>
      <button type="button" class="date-trigger" data-range-part="end" aria-label="结束日期">${escapeHtml(endDisp)}</button>
    </div>
  `;
}

/**
 * @param {string[]} activeIds 当前页面允许的 date-range id 列表
 */
export function ensureDateRangePickerContext(activeIds) {
  const pop = state.dateRangePicker;
  if (pop && !activeIds.includes(pop.id)) {
    state.dateRangePicker = null;
    destroyDateRangePickerOverlay();
  }
}

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {() => { start: string, end: string }} opts.getRange
 * @param {(start: string, end: string) => void} opts.setRange
 * @param {() => void} opts.onApplied
 * @param {() => void} opts.requestRender
 */
export function bindDateRangePicker({ id, getRange, setRange, onApplied, requestRender }) {
  const container = document.querySelector(`[data-date-range-id="${CSS.escape(id)}"]`);
  if (!container) return;

  const openPicker = (ev) => {
    ev.stopPropagation();
    const pop = state.dateRangePicker;
    if (pop?.id === id) {
      const incomplete = pop.phase === "awaitingEnd";
      state.dateRangePicker = null;
      destroyDateRangePickerOverlay();
      if (incomplete) onApplied();
      requestRender();
      return;
    }

    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth();
    const { start, end } = getRange();
    const anchorYmd = start || end;
    if (anchorYmd) {
      const d = parseYmdToDate(anchorYmd);
      if (d) {
        viewYear = d.getFullYear();
        viewMonth = d.getMonth();
      }
    }
    state.dateRangePicker = { id, viewYear, viewMonth, phase: null };
    requestRender();
  };

  container.querySelectorAll(".date-trigger").forEach((btn) => {
    btn.addEventListener("click", openPicker);
  });

  const pop = state.dateRangePicker;
  if (!pop || pop.id !== id) return;

  mountDateRangePickerOverlay({
    cfg: pop,
    selectedStart: getRange().start,
    selectedEnd: getRange().end,
    anchorEl: container,
    onNavigate: (y, m) => {
      if (!state.dateRangePicker || state.dateRangePicker.id !== id) return;
      state.dateRangePicker = { ...state.dateRangePicker, viewYear: y, viewMonth: m };
      requestRender();
    },
    onPick: (ymd) => {
      const cur = state.dateRangePicker;
      if (!cur || cur.id !== id) return;
      const range = getRange();
      const result = reduceRangeDateClick({
        start: range.start,
        end: range.end,
        phase: cur.phase,
        ymd,
      });
      setRange(result.start, result.end);
      if (result.complete) {
        state.dateRangePicker = null;
        onApplied();
      } else {
        state.dateRangePicker = { ...cur, phase: result.phase };
      }
      requestRender();
    },
    onClear: () => {
      setRange("", "");
      state.dateRangePicker = null;
      onApplied();
      requestRender();
    },
    onClose: () => {
      const cur = state.dateRangePicker;
      if (!cur || cur.id !== id) return;
      const incomplete = cur.phase === "awaitingEnd";
      state.dateRangePicker = null;
      destroyDateRangePickerOverlay();
      if (incomplete) onApplied();
      requestRender();
    },
  });
}
