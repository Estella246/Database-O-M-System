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

function applyWorkbenchListFilters(
  baseTickets,
  listTab,
  filters,
  { serverPaged = false, pageIds = [], filterPopOpen = false } = {}
) {
  let base = Array.isArray(baseTickets) ? baseTickets : [];
  if (serverPaged) {
    base = filterTicketsToWorkbenchSnapshotPage(base, pageIds);
  }
  const visibleByTab =
    listTab === "all"
      ? base
      : base.filter(() => true);
  // 与 ticket-core.js：快照分页 + 列筛选弹层打开时跳过客户端列筛选，避免全选大量 facets 滤空当前页
  if (serverPaged && filterPopOpen) {
    return visibleByTab;
  }
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

  test("列筛选弹层打开时全选大量值不把当前页滤空（待完成后再 resync）", () => {
    const serverPage = [
      { orderId: "YW20260101001", collaborator: "张三 z001" },
      { orderId: "YW20260101002", collaborator: "李四 l002" },
    ];
    const manySelected = Array.from({ length: 80 }, (_, i) => `协同人${i} a${String(i).padStart(6, "0")}`);
    const filters = { selected: { collaborator: manySelected } };
    const whileOpen = applyWorkbenchListFilters(serverPage, "all", filters, {
      serverPaged: true,
      pageIds: serverPage.map((t) => t.orderId),
      filterPopOpen: true,
    });
    expect(whileOpen.map((t) => t.orderId)).toEqual(["YW20260101001", "YW20260101002"]);

    const afterClose = applyWorkbenchListFilters(serverPage, "all", filters, {
      serverPaged: true,
      pageIds: serverPage.map((t) => t.orderId),
      filterPopOpen: false,
    });
    expect(afterClose).toEqual([]);
  });
});
