/**
 * 日期范围双次点选逻辑 — 与 frontend/modules/utils/date-range-pick.js 保持一致。
 */

function normalizeRangeStartEnd(start, end) {
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (!s || !e) return { start: s, end: e };
  if (s <= e) return { start: s, end: e };
  return { start: e, end: s };
}

function isYmdInRange(ymd, start, end) {
  const y = String(ymd || "").trim();
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (!y || !s || !e) return false;
  const { start: lo, end: hi } = normalizeRangeStartEnd(s, e);
  return y >= lo && y <= hi;
}

function reduceRangeDateClick({ start, end, phase, ymd }) {
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

function dateRangePickerHintText(selectedStart, selectedEnd, rangePhase) {
  const s = String(selectedStart || "").trim();
  const e = String(selectedEnd || "").trim();
  if (rangePhase === "awaitingEnd" && s) return `开始：${s} · 请选择结束日期`;
  if (s && e) return `${s} — ${e}`;
  if (s) return `开始：${s}`;
  return "请选择开始日期";
}

function shiftCalendarViewMonth(viewYear, viewMonth, deltaMonths) {
  const d = new Date(viewYear, viewMonth + deltaMonths, 1);
  return { viewYear: d.getFullYear(), viewMonth: d.getMonth() };
}

function shiftCalendarViewYear(viewYear, viewMonth, deltaYears) {
  return { viewYear: viewYear + deltaYears, viewMonth };
}

describe("normalizeRangeStartEnd", () => {
  test("起止有序时原样返回", () => {
    expect(normalizeRangeStartEnd("2026-03-01", "2026-03-10")).toEqual({
      start: "2026-03-01",
      end: "2026-03-10",
    });
  });

  test("起止颠倒时自动交换", () => {
    expect(normalizeRangeStartEnd("2026-03-20", "2026-03-05")).toEqual({
      start: "2026-03-05",
      end: "2026-03-20",
    });
  });

  test("仅一端有值时不交换", () => {
    expect(normalizeRangeStartEnd("2026-03-01", "")).toEqual({
      start: "2026-03-01",
      end: "",
    });
  });
});

describe("isYmdInRange", () => {
  test("区间内（含起止）", () => {
    expect(isYmdInRange("2026-03-05", "2026-03-01", "2026-03-10")).toBe(true);
    expect(isYmdInRange("2026-03-01", "2026-03-01", "2026-03-10")).toBe(true);
    expect(isYmdInRange("2026-03-10", "2026-03-01", "2026-03-10")).toBe(true);
  });

  test("区间外或缺参", () => {
    expect(isYmdInRange("2026-02-28", "2026-03-01", "2026-03-10")).toBe(false);
    expect(isYmdInRange("2026-03-11", "2026-03-01", "2026-03-10")).toBe(false);
    expect(isYmdInRange("2026-03-05", "2026-03-01", "")).toBe(false);
  });
});

describe("reduceRangeDateClick", () => {
  test("第一次点击设开始并进入 awaitingEnd", () => {
    expect(
      reduceRangeDateClick({ start: "", end: "", phase: null, ymd: "2026-06-01" })
    ).toEqual({
      start: "2026-06-01",
      end: "",
      phase: "awaitingEnd",
      complete: false,
    });
  });

  test("已有完整区间时第一次点击重新选开始", () => {
    expect(
      reduceRangeDateClick({
        start: "2026-05-01",
        end: "2026-05-31",
        phase: null,
        ymd: "2026-06-10",
      })
    ).toEqual({
      start: "2026-06-10",
      end: "",
      phase: "awaitingEnd",
      complete: false,
    });
  });

  test("第二次点击完成区间并归一化顺序", () => {
    expect(
      reduceRangeDateClick({
        start: "2026-06-10",
        end: "",
        phase: "awaitingEnd",
        ymd: "2026-06-01",
      })
    ).toEqual({
      start: "2026-06-01",
      end: "2026-06-10",
      phase: null,
      complete: true,
    });
  });

  test("同一日期点两次为单日范围", () => {
    const first = reduceRangeDateClick({
      start: "",
      end: "",
      phase: null,
      ymd: "2026-06-15",
    });
    expect(first.complete).toBe(false);
    expect(
      reduceRangeDateClick({
        start: first.start,
        end: first.end,
        phase: first.phase,
        ymd: "2026-06-15",
      })
    ).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
      phase: null,
      complete: true,
    });
  });
});

describe("dateRangePickerHintText", () => {
  test("各阶段提示文案", () => {
    expect(dateRangePickerHintText("", "", null)).toBe("请选择开始日期");
    expect(dateRangePickerHintText("2026-06-01", "", "awaitingEnd")).toBe(
      "开始：2026-06-01 · 请选择结束日期"
    );
    expect(dateRangePickerHintText("2026-06-01", "2026-06-10", null)).toBe(
      "2026-06-01 — 2026-06-10"
    );
  });
});

describe("shiftCalendarViewMonth", () => {
  test("同年内切换月份", () => {
    expect(shiftCalendarViewMonth(2026, 5, 1)).toEqual({ viewYear: 2026, viewMonth: 6 });
    expect(shiftCalendarViewMonth(2026, 5, -1)).toEqual({ viewYear: 2026, viewMonth: 4 });
  });

  test("跨年切换月份", () => {
    expect(shiftCalendarViewMonth(2026, 0, -1)).toEqual({ viewYear: 2025, viewMonth: 11 });
    expect(shiftCalendarViewMonth(2026, 11, 1)).toEqual({ viewYear: 2027, viewMonth: 0 });
  });
});

describe("shiftCalendarViewYear", () => {
  test("切换年份时月份不变", () => {
    expect(shiftCalendarViewYear(2026, 3, 1)).toEqual({ viewYear: 2027, viewMonth: 3 });
    expect(shiftCalendarViewYear(2026, 3, -1)).toEqual({ viewYear: 2025, viewMonth: 3 });
  });
});
