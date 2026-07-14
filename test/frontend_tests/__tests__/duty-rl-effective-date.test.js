/**
 * RL 值班生效日：当天 9:00～次日 9:00
 * 对应 frontend/modules/utils/date.js → dutyRlEffectiveDateKey
 */

function dutyRlLocalDateKey(d) {
  const x = d instanceof Date ? d : new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dutyRlEffectiveDateKey(d) {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date();
  if (x.getHours() < 9) {
    x.setDate(x.getDate() - 1);
  }
  return dutyRlLocalDateKey(x);
}

describe("dutyRlEffectiveDateKey", () => {
  test("at 09:00 uses calendar day", () => {
    expect(dutyRlEffectiveDateKey(new Date(2026, 6, 14, 9, 0, 0))).toBe("2026-07-14");
  });

  test("at 11:13 uses calendar day", () => {
    expect(dutyRlEffectiveDateKey(new Date(2026, 6, 14, 11, 13, 0))).toBe("2026-07-14");
  });

  test("at 08:59 still uses previous day", () => {
    expect(dutyRlEffectiveDateKey(new Date(2026, 6, 14, 8, 59, 0))).toBe("2026-07-13");
  });

  test("at midnight uses previous day", () => {
    expect(dutyRlEffectiveDateKey(new Date(2026, 6, 14, 0, 0, 0))).toBe("2026-07-13");
  });

  test("cross-month before 09:00 rolls to previous month", () => {
    expect(dutyRlEffectiveDateKey(new Date(2026, 6, 1, 8, 0, 0))).toBe("2026-06-30");
  });

  test("cross-year before 09:00 rolls to previous year", () => {
    expect(dutyRlEffectiveDateKey(new Date(2026, 0, 1, 8, 30, 0))).toBe("2025-12-31");
  });
});
