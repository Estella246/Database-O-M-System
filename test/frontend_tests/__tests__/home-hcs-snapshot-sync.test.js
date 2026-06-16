/**
 * 主页 HCS 同步：各页签走快照服务端 tab（与 ticket_list_snapshot._base_where 一致）。
 */
function homeHcsSnapshotTabForSync(homeWorkbenchTab) {
  switch (String(homeWorkbenchTab || "").trim()) {
    case "pending":
      return "pending";
    case "pending_close":
      return "pending_close";
    case "audit_close":
      return "audit_close";
    case "handled":
      return "handled";
    default:
      return "all";
  }
}

function homeWorkbenchTabUsesServerSnapshotTab(tab) {
  const t = String(tab || "").trim();
  return t === "pending" || t === "pending_close" || t === "audit_close" || t === "handled";
}

async function fetchAllHomeHcsSnapshotTickets(fetchImpl, buildQs, tab = "all") {
  const pageSize = 100;
  const allTickets = [];
  let page = 1;
  let total = 0;
  let listMode = "";

  while (true) {
    const qs = buildQs(page, pageSize, tab);
    try {
      const resp = await fetchImpl(qs);
      if (!resp.ok) return { listMode: "error", tickets: null };
      const json = await resp.json();
      if (page === 1) {
        listMode = String(json.list_mode || "");
        if (listMode !== "snapshot") return { listMode, tickets: null };
      }
      const items = Array.isArray(json?.items) ? json.items : [];
      total = Number(json.total) || 0;
      items.forEach((row) => {
        const id = String(row.orderId || row.order_id || "");
        if (id) allTickets.push({ orderId: id, currentHandler: row.current_handler || row.currentHandler || "" });
      });
      if (allTickets.length >= total || items.length === 0) break;
      page += 1;
    } catch (_) {
      return { listMode: "error", tickets: null };
    }
  }
  return { listMode: "snapshot", tickets: allTickets };
}

describe("homeHcsSnapshotTabForSync", () => {
  test.each([
    ["pending", "pending"],
    ["pending_close", "pending_close"],
    ["audit_close", "audit_close"],
    ["handled", "handled"],
    ["leave_pending", "all"],
  ])("页签 %s 映射快照 tab=%s", (homeTab, snapTab) => {
    expect(homeHcsSnapshotTabForSync(homeTab)).toBe(snapTab);
  });
});

describe("homeWorkbenchTabUsesServerSnapshotTab", () => {
  test("工单列表页签走服务端快照", () => {
    expect(homeWorkbenchTabUsesServerSnapshotTab("pending_close")).toBe(true);
    expect(homeWorkbenchTabUsesServerSnapshotTab("audit_close")).toBe(true);
  });

  test("请假待审批不走 HCS 快照", () => {
    expect(homeWorkbenchTabUsesServerSnapshotTab("leave_pending")).toBe(false);
  });
});

describe("fetchAllHomeHcsSnapshotTickets", () => {
  test("待办页签请求带 tab=pending", async () => {
    const calls = [];
    await fetchAllHomeHcsSnapshotTickets(
      async (qs) => {
        calls.push(qs);
        return {
          ok: true,
          async json() {
            return { list_mode: "snapshot", total: 0, items: [] };
          },
        };
      },
      (page, pageSize, tab) => `page=${page}&page_size=${pageSize}&tab=${tab}`,
      "pending"
    );
    expect(calls[0]).toContain("tab=pending");
  });

  test("待关单页签请求带 tab=pending_close", async () => {
    const calls = [];
    await fetchAllHomeHcsSnapshotTickets(
      async (qs) => {
        calls.push(qs);
        return {
          ok: true,
          async json() {
            return { list_mode: "snapshot", total: 0, items: [] };
          },
        };
      },
      (page, pageSize, tab) => `page=${page}&page_size=${pageSize}&tab=${tab}`,
      "pending_close"
    );
    expect(calls[0]).toContain("tab=pending_close");
  });

  test("首屏为 legacy 时回落全量接口", async () => {
    const result = await fetchAllHomeHcsSnapshotTickets(
      async () => ({
        ok: true,
        async json() {
          return { list_mode: "legacy", items: [{ order_id: "YW20260101001" }] };
        },
      }),
      (page, pageSize) => `page=${page}&page_size=${pageSize}`
    );
    expect(result.listMode).toBe("legacy");
    expect(result.tickets).toBeNull();
  });
});
