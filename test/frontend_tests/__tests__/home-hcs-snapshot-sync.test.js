/**
 * 主页 HCS 同步：服务端分页（与工作台一致），不循环拉全量。
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

function homeWorkbenchTabUsesMergedTicketBase(tab) {
  return tab === "pending" || tab === "handled";
}

async function fetchHomeHcsSnapshotPage(fetchImpl, buildQs, page, pageSize, tab) {
  const qs = buildQs(page, pageSize, tab);
  try {
    const resp = await fetchImpl(qs);
    if (!resp.ok) return { listMode: "error", items: [], total: 0, page: 1 };
    const json = await resp.json();
    const listMode = String(json.list_mode || "");
    if (listMode !== "snapshot") return { listMode, items: [], total: 0, page: 1 };
    const items = (Array.isArray(json?.items) ? json.items : []).filter((x) => x.orderId);
    return {
      listMode: "snapshot",
      items,
      total: Number(json.total) || 0,
      page: Number(json.page) || page,
    };
  } catch (_) {
    return { listMode: "error", items: [], total: 0, page: 1 };
  }
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

describe("homeWorkbenchTabUsesMergedTicketBase", () => {
  test("待办与曾处理合并 HOTPATCH", () => {
    expect(homeWorkbenchTabUsesMergedTicketBase("pending")).toBe(true);
    expect(homeWorkbenchTabUsesMergedTicketBase("handled")).toBe(true);
    expect(homeWorkbenchTabUsesMergedTicketBase("pending_close")).toBe(false);
  });
});

describe("fetchHomeHcsSnapshotPage", () => {
  test("待办页签单次请求带 tab=pending", async () => {
    const calls = [];
    const result = await fetchHomeHcsSnapshotPage(
      async (qs) => {
        calls.push(qs);
        return {
          ok: true,
          async json() {
            return { list_mode: "snapshot", total: 1, page: 1, items: [{ orderId: "YW20260101001" }] };
          },
        };
      },
      (page, pageSize, tab) => `page=${page}&page_size=${pageSize}&tab=${tab}`,
      1,
      10,
      "pending"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("tab=pending");
    expect(calls[0]).toContain("page_size=10");
    expect(result.listMode).toBe("snapshot");
    expect(result.items).toHaveLength(1);
  });

  test("非快照响应不拉第二页", async () => {
    let callCount = 0;
    const result = await fetchHomeHcsSnapshotPage(
      async () => {
        callCount += 1;
        return {
          ok: true,
          async json() {
            return { list_mode: "legacy", items: [{ orderId: "YW20260101001" }] };
          },
        };
      },
      (page, pageSize, tab) => `page=${page}&page_size=${pageSize}&tab=${tab}`,
      1,
      10,
      "all"
    );
    expect(callCount).toBe(1);
    expect(result.listMode).toBe("legacy");
    expect(result.items).toEqual([]);
  });
});
