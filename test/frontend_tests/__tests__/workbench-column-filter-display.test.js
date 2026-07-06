/**
 * 工作台快照分页：merge 保留的已打开详情页工单须从展示路径剔除（翻页/搜索/列筛选均适用）。
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

function filterTicketsToWorkbenchSnapshotPage(tickets, pageIds) {
  const ids = new Set(
    (pageIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  if (!ids.size) return [];
  return (tickets || []).filter((t) => ids.has(String(t.orderId || "").trim()));
}

function applyWorkbenchListFilters(baseTickets, listTab, filters, { serverPaged = false, pageIds = [] } = {}) {
  let base = Array.isArray(baseTickets) ? baseTickets : [];
  if (serverPaged) {
    base = filterTicketsToWorkbenchSnapshotPage(base, pageIds);
  }
  const visibleByTab =
    listTab === "all"
      ? base
      : base.filter(() => true);
  return filterTicketsByListColumnFilters(visibleByTab, filters);
}

describe("applyWorkbenchListFilters（快照分页展示）", () => {
  test("快照分页时剔除 merge 保留的已打开工单（无列筛选）", () => {
    const serverPage = [
      { orderId: "YW20260101001", location: "北京" },
      { orderId: "YW20260101002", location: "北京" },
    ];
    const openTabExtras = [
      { orderId: "YW20260101010", location: "上海" },
      { orderId: "YW20260101011", location: "广州" },
    ];
    const merged = [...openTabExtras, ...serverPage];
    const visible = applyWorkbenchListFilters(merged, "all", { selected: {} }, {
      serverPaged: true,
      pageIds: ["YW20260101001", "YW20260101002"],
    });
    expect(visible.map((t) => t.orderId)).toEqual(["YW20260101001", "YW20260101002"]);
  });

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
    const visible = applyWorkbenchListFilters(merged, "all", filters, {
      serverPaged: true,
      pageIds: serverPage.map((t) => t.orderId),
    });
    expect(visible.map((t) => t.orderId)).toEqual([
      "YW20260101001",
      "YW20260101002",
      "YW20260101003",
    ]);
  });

  test("非快照分页时保留 merge 的已打开工单（客户端分页路径）", () => {
    const merged = [
      { orderId: "YW20260101010", location: "上海" },
      { orderId: "YW20260101001", location: "北京" },
    ];
    const visible = applyWorkbenchListFilters(merged, "all", { selected: {} });
    expect(visible.map((t) => t.orderId)).toEqual(["YW20260101010", "YW20260101001"]);
  });

  test("翻页后仅展示新页服务端返回的工单", () => {
    const merged = [
      { orderId: "YW20260101010", location: "上海" },
      { orderId: "YW20260101011", location: "广州" },
      { orderId: "YW20260101021", location: "北京" },
      { orderId: "YW20260101022", location: "北京" },
    ];
    const visible = applyWorkbenchListFilters(merged, "all", { selected: {} }, {
      serverPaged: true,
      pageIds: ["YW20260101021", "YW20260101022"],
    });
    expect(visible.map((t) => t.orderId)).toEqual(["YW20260101021", "YW20260101022"]);
  });
});
