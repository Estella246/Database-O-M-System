/**
 * 进入工作台快照分页前清理 legacy 全量 HCS 缓存
 * 与 frontend/modules/pages/ticket-core.js 中 shouldPrepareWorkbenchSnapshotSync / prepareWorkbenchSnapshotSync 一致。
 */
function countHcsTicketsInList(list) {
  return (list || []).filter((t) => {
    const tc = String(t.templateCode || "HCS_INCIDENT").trim();
    return tc === "HCS_INCIDENT" || tc === "";
  }).length;
}

function shouldPrepareWorkbenchSnapshotSync(listState = {}) {
  const pageSize = Math.max(1, Number(listState.listPageSize) || 10);
  const serverPaged = Boolean(listState.ticketListServerPaged);
  const hcsCount = countHcsTicketsInList(listState.ticketList);
  return !serverPaged || hcsCount > pageSize;
}

function prepareWorkbenchSnapshotSync(ticketList, openTabs = []) {
  const strip = "HCS_INCIDENT";
  const openIds = new Set(
    openTabs
      .filter((tab) => String(tab.key || "").startsWith("ticket:"))
      .map((tab) => tab.key.slice("ticket:".length))
  );
  const keepNonHcs = ticketList.filter((t) => String(t.templateCode || "").trim() !== strip);
  const keepOpenHcs = ticketList.filter(
    (t) =>
      String(t.templateCode || "") === strip &&
      openIds.has(String(t.orderId || ""))
  );
  return [...keepNonHcs, ...keepOpenHcs];
}

describe("shouldPrepareWorkbenchSnapshotSync", () => {
  test("主页 legacy 全量 HCS 缓存（未分页）须清理", () => {
    const ticketList = Array.from({ length: 500 }, (_, i) => ({
      orderId: `YW20260101${String(i).padStart(3, "0")}`,
      templateCode: "HCS_INCIDENT",
    }));
    expect(
      shouldPrepareWorkbenchSnapshotSync({
        ticketListServerPaged: false,
        listPageSize: 10,
        ticketList,
      })
    ).toBe(true);
  });

  test("已在快照分页且仅一页数据时不清理", () => {
    const ticketList = Array.from({ length: 10 }, (_, i) => ({
      orderId: `YW20260101${String(i).padStart(3, "0")}`,
      templateCode: "HCS_INCIDENT",
    }));
    expect(
      shouldPrepareWorkbenchSnapshotSync({
        ticketListServerPaged: true,
        listPageSize: 10,
        ticketList,
      })
    ).toBe(false);
  });

  test("快照标志为 true 但内存仍含超一页 HCS 时仍须清理", () => {
    const ticketList = Array.from({ length: 50 }, (_, i) => ({
      orderId: `YW20260101${String(i).padStart(3, "0")}`,
      templateCode: "HCS_INCIDENT",
    }));
    expect(
      shouldPrepareWorkbenchSnapshotSync({
        ticketListServerPaged: true,
        listPageSize: 10,
        ticketList,
      })
    ).toBe(true);
  });
});

describe("prepareWorkbenchSnapshotSync", () => {
  test("去掉 legacy 全量 HCS，保留 HOTPATCH 与已打开工单页签", () => {
    const ticketList = [
      { orderId: "HPM20260101001", templateCode: "HOTPATCH" },
      { orderId: "YW20260101001", templateCode: "HCS_INCIDENT" },
      { orderId: "YW20260101002", templateCode: "HCS_INCIDENT" },
      { orderId: "YW20260101003", templateCode: "HCS_INCIDENT" },
    ];
    const openTabs = [{ key: "ticket:YW20260101002", label: "YW20260101002" }];
    const next = prepareWorkbenchSnapshotSync(ticketList, openTabs);
    expect(next.map((t) => t.orderId)).toEqual(["HPM20260101001", "YW20260101002"]);
  });
});

function planTicketListResync(prevKey, nextKey) {
  const listLike = (x) => x === "list" || x === "patch:list";
  if (nextKey === "patch:list" && prevKey !== "patch:list") {
    return { sync: true, ignoreSearch: true };
  }
  if (prevKey === "patch:list" && nextKey === "list") {
    return { sync: true, ignoreSearch: true };
  }
  if (!listLike(prevKey) && listLike(nextKey)) {
    return { sync: true, ignoreSearch: false };
  }
  return { sync: false, ignoreSearch: false };
}

function prepareListPageEnter(prevKey, nextKey, state = {}) {
  const resync = planTicketListResync(prevKey, nextKey);
  const sideEffects = { prepared: false, loading: false, serverPaged: false };
  if (nextKey === "list" && prevKey !== "list" && resync.sync) {
    sideEffects.prepared = true;
    sideEffects.loading = true;
    sideEffects.serverPaged = true;
  }
  return { ...resync, sideEffects };
}

describe("prepareListPageEnter", () => {
  test("从统计页进入工作台：须 prepare 且拉列表", () => {
    const r = prepareListPageEnter("stats:charts", "list");
    expect(r.sync).toBe(true);
    expect(r.sideEffects.prepared).toBe(true);
    expect(r.sideEffects.loading).toBe(true);
  });

  test("从工单详情进入工作台：须 prepare", () => {
    const r = prepareListPageEnter("ticket:YW20260101001", "list");
    expect(r.sync).toBe(true);
    expect(r.sideEffects.prepared).toBe(true);
  });

  test("已在工作台时再次点击工作台：不 prepare", () => {
    const r = prepareListPageEnter("list", "list");
    expect(r.sync).toBe(false);
    expect(r.sideEffects.prepared).toBe(false);
  });

  test("工作台翻页/刷新（同页 resync）：不 prepare", () => {
    const r = prepareListPageEnter("list", "list");
    expect(r.sideEffects.prepared).toBe(false);
  });
});
