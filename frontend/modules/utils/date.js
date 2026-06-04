export function dutyRlLocalDateKey(d) {
  const x = d instanceof Date ? d : new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dutyShiftLabel(shift) {
  return shift === "night" ? "晚班" : "全天";
}

export function buildDutyMonthWeeks(year, month1) {
  const first = new Date(year, month1 - 1, 1);
  const last = new Date(year, month1, 0);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ key, day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function parseYmdToDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ymdFromDate(d) {
  if (!d || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(ymd, n) {
  const d = parseYmdToDate(ymd);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  return ymdFromDate(d);
}

export function daysBetween(startYmd, endYmd) {
  const a = parseYmdToDate(startYmd);
  const b = parseYmdToDate(endYmd);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function isWeekend(ymd) {
  const d = parseYmdToDate(ymd);
  if (!d) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function startOfWeekSunday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  while (x.getDay() !== 0) x.setDate(x.getDate() - 1);
  return x;
}

export function heatmapIntensityLevel(count, maxCount) {
  if (count <= 0) return 0;
  if (maxCount <= 0) return 0;
  const r = count / maxCount;
  if (r <= 0.2) return 1;
  if (r <= 0.4) return 2;
  if (r <= 0.65) return 3;
  return 4;
}

export function formatZhLongDateFromYmd(ymd) {
  const [y, m, d] = String(ymd || "")
    .split("-")
    .map((x) => Number(x));
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return ymd;
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(dt);
}

export function formatZhMonthFromYmd(ymd) {
  const [y, m] = String(ymd || "")
    .split("-")
    .map((x) => Number(x));
  if (!y || !m) return "";
  const dt = new Date(y, m - 1, 1);
  if (Number.isNaN(dt.getTime())) return ymd;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(dt);
}

export function dutyCalendarSyncKey(st) {
  const a = st.dutyCalendarYm.kernel || { year: 0, month: 0 };
  const b = st.dutyCalendarYm.control || { year: 0, month: 0 };
  const c = st.dutyCalendarYm.public_cloud || { year: 0, month: 0 };
  const d = st.dutyCalendarYm.poc || { year: 0, month: 0 };
  const e = st.dutyCalendarYm.research_version || { year: 0, month: 0 };
  return `${a.year}-${a.month}|${b.year}-${b.month}|${c.year}-${c.month}|${d.year}-${d.month}|${e.year}-${e.month}`;
}

export function dutyHolidayMonthSyncKey(st) {
  const ym = st.dutyHolidayYm || { year: 0, month: 0 };
  return `${ym.year}-${ym.month}`;
}
