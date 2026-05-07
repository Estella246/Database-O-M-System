/**
 * 工作台按创建日筛选 — 与 frontend/modules/utils/format.js 中
 * ticketCreatedAtLocalYmdStrict / filterTicketsByWorkbenchCreatedRange 语义保持一致。
 */

function formatYmdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ticketCreatedAtLocalYmdStrict(t) {
  const raw = t?.createdAt ?? t?.created_at;
  if (!raw) return "";
  const ms = Date.parse(String(raw));
  if (Number.isNaN(ms)) return "";
  return formatYmdLocal(new Date(ms));
}

function filterTicketsByWorkbenchCreatedRange(tickets, startYmd, endYmd) {
  const s = String(startYmd || "").trim();
  const e = String(endYmd || "").trim();
  if (!s && !e) return tickets || [];
  return (tickets || []).filter((t) => {
    const ymd = ticketCreatedAtLocalYmdStrict(t);
    if (!ymd) return false;
    if (s && ymd < s) return false;
    if (e && ymd > e) return false;
    return true;
  });
}

describe("filterTicketsByWorkbenchCreatedRange", () => {
  const t1 = { orderId: "a", createdAt: "2026-03-10T08:00:00.000Z" };
  const t2 = { orderId: "b", createdAt: "2026-03-15T08:00:00.000Z" };
  const t3 = { orderId: "c", createdAt: "2026-03-20T08:00:00.000Z" };
  const list = [t1, t2, t3];

  test("无起止日期时原样返回", () => {
    expect(filterTicketsByWorkbenchCreatedRange(list, "", "")).toEqual(list);
    expect(filterTicketsByWorkbenchCreatedRange(null, "", "")).toEqual([]);
  });

  test("仅开始日期：排除创建日早于开始的工单", () => {
    const localMid = ticketCreatedAtLocalYmdStrict(t2);
    const out = filterTicketsByWorkbenchCreatedRange(list, localMid, "");
    expect(out.map((x) => x.orderId)).toEqual(["b", "c"]);
  });

  test("仅结束日期：排除创建日晚于结束的工单", () => {
    const localMid = ticketCreatedAtLocalYmdStrict(t2);
    const out = filterTicketsByWorkbenchCreatedRange(list, "", localMid);
    expect(out.map((x) => x.orderId)).toEqual(["a", "b"]);
  });

  test("起止皆有：闭区间", () => {
    const lo = ticketCreatedAtLocalYmdStrict(t1);
    const hi = ticketCreatedAtLocalYmdStrict(t2);
    const out = filterTicketsByWorkbenchCreatedRange(list, lo, hi);
    expect(out.map((x) => x.orderId)).toEqual(["a", "b"]);
  });

  test("无 createdAt 仅有 startDate 的工单在筛选时被排除", () => {
    const noCreated = { orderId: "x", startDate: "2026-01-01" };
    const out = filterTicketsByWorkbenchCreatedRange([noCreated], "2026-01-01", "2026-12-31");
    expect(out).toEqual([]);
  });
});
