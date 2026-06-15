/**
 * 日期范围快捷预设回填守卫 — 与 frontend/modules/ui/date-range-picker-bind.js 保持一致。
 */

function shouldSkipDateRangePresetFill(dateRangePicker, { pickerId, start, end, preset }) {
  if (dateRangePicker?.id === pickerId) return true;
  if (start && !end && !preset) return true;
  if (!start && !end && preset === "") return true;
  return false;
}

describe("shouldSkipDateRangePresetFill", () => {
  const base = {
    pickerId: "stats-labor",
    start: "",
    end: "",
    preset: "1w",
  };

  test("首次进入且尚无日期时仍允许回填快捷预设", () => {
    expect(shouldSkipDateRangePresetFill(null, base)).toBe(false);
  });

  test("日历打开中不覆盖正在点选的范围", () => {
    expect(
      shouldSkipDateRangePresetFill({ id: "stats-labor" }, {
        ...base,
        start: "2026-06-01",
        end: "",
        preset: "",
      })
    ).toBe(true);
  });

  test("清除日期后保持空范围", () => {
    expect(
      shouldSkipDateRangePresetFill(null, {
        ...base,
        start: "",
        end: "",
        preset: "",
      })
    ).toBe(true);
  });

  test("仅选了开始日时保留用户输入", () => {
    expect(
      shouldSkipDateRangePresetFill(null, {
        ...base,
        start: "2026-06-05",
        end: "",
        preset: "",
      })
    ).toBe(true);
  });

  test("已有完整范围时不跳过", () => {
    expect(
      shouldSkipDateRangePresetFill(null, {
        ...base,
        start: "2026-06-01",
        end: "2026-06-10",
        preset: "",
      })
    ).toBe(false);
  });
});
