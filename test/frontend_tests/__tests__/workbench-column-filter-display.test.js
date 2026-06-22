/**
 * 工作台快照分页：merge 保留的已打开详情页工单须再经列筛选剔除，避免列表前几行不符合筛选条件。
 * 与 frontend/modules/pages/ticket-core.js applyWorkbenchListFilters 一致。
 */
function ticketListFilterDisplayValue(ticket, colKey) {
  if (colKey === "location") {
    const s = String(ticket.location || "").trim();
    return s || "（空）";
  }
  return String(ticket[colKey] || "").trim() || "（空）";
}

function filterTicketsByListColumnFilters(tickets, filters) {
  const sel = filters?.selected || {};
  const activeKeys = Object.keys(sel).filter((k) => (sel[k] || []).length > 0);
  return (tickets || []).filter((t) =>
    activeKeys.every((key) => {
      const picked = sel[key] || [];
      const val = ticketListFilterDisplayValue(t, key);
      return picked.includes(val);
    })
  );
}

function applyWorkbenchListFilters(baseTickets, listTab, filters) {
  const base = Array.isArray(baseTickets) ? baseTickets : [];
  const visibleByTab =
    listTab === "all"
      ? base
      : base.filter(() => true);
  return filterTicketsByListColumnFilters(visibleByTab, filters);
}

describe("applyWorkbenchListFilters（快照分页展示）", () => {
  test("列筛选后剔除 merge 保留、不符合条件的已打开工单", () => {
    const serverPage = [
      { orderId: "YW20260101001", location: "北京" },
      { orderId: "YW20260101002", location: "北京" },
      { orderId: "YW20260101003", location: "北京" },
    ];
    const openTabExtras = [
      { orderId: "YW20260101010", location: "上海" },
      { orderId: "YW20260101011", location: "广州" },
    ];
    const merged = [...openTabExtras, ...serverPage];
    const filters = { selected: { location: ["北京"] } };
    const visible = applyWorkbenchListFilters(merged, "all", filters);
    expect(visible.map((t) => t.orderId)).toEqual([
      "YW20260101001",
      "YW20260101002",
      "YW20260101003",
    ]);
  });

  test("无列筛选时保留 merge 的已打开工单", () => {
    const merged = [
      { orderId: "YW20260101010", location: "上海" },
      { orderId: "YW20260101001", location: "北京" },
    ];
    const visible = applyWorkbenchListFilters(merged, "all", { selected: {} });
    expect(visible.map((t) => t.orderId)).toEqual(["YW20260101010", "YW20260101001"]);
  });
});
