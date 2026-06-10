/** @typedef {'awaitingEnd' | null} DateRangePickPhase */

/**
 * @param {string} start
 * @param {string} end
 * @returns {{ start: string, end: string }}
 */
export function normalizeRangeStartEnd(start, end) {
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (!s || !e) return { start: s, end: e };
  if (s <= e) return { start: s, end: e };
  return { start: e, end: s };
}

/**
 * @param {string} ymd
 * @param {string} start
 * @param {string} end
 */
export function isYmdInRange(ymd, start, end) {
  const y = String(ymd || "").trim();
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (!y || !s || !e) return false;
  const { start: lo, end: hi } = normalizeRangeStartEnd(s, e);
  return y >= lo && y <= hi;
}

/**
 * 双次点选：第一次设开始并进入 awaitingEnd；第二次设结束并完成。
 *
 * @param {{ start: string, end: string, phase: DateRangePickPhase, ymd: string }} args
 * @returns {{ start: string, end: string, phase: DateRangePickPhase, complete: boolean }}
 */
export function reduceRangeDateClick({ start, end, phase, ymd }) {
  const y = String(ymd || "").trim();
  if (!y) return { start, end, phase, complete: false };

  if (phase !== "awaitingEnd") {
    return { start: y, end: "", phase: "awaitingEnd", complete: false };
  }

  const normalized = normalizeRangeStartEnd(start, y);
  return {
    start: normalized.start,
    end: normalized.end,
    phase: null,
    complete: true,
  };
}

/**
 * @param {string} selectedStart
 * @param {string} selectedEnd
 * @param {DateRangePickPhase} rangePhase
 */
export function dateRangePickerHintText(selectedStart, selectedEnd, rangePhase) {
  const s = String(selectedStart || "").trim();
  const e = String(selectedEnd || "").trim();
  if (rangePhase === "awaitingEnd" && s) return `开始：${s} · 请选择结束日期`;
  if (s && e) return `${s} — ${e}`;
  if (s) return `开始：${s}`;
  return "请选择开始日期";
}
