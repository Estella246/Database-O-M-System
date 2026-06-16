/**
 * 主页 HCS 同步：优先快照全量分页（current_handler 与待办页签一致），
 * 与 frontend/modules/pages/ticket-core.js 中 fetchAllHomeHcsSnapshotTickets 逻辑一致。
 */
async function fetchAllHomeHcsSnapshotTickets(fetchImpl, buildQs) {
  const pageSize = 100;
  const allTickets = [];
  let page = 1;
  let total = 0;
  let listMode = "";

  while (true) {
    const qs = buildQs(page, pageSize);
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

describe("fetchAllHomeHcsSnapshotTickets", () => {
  test("快照单页返回全部 HCS 行", async () => {
    const result = await fetchAllHomeHcsSnapshotTickets(
      async () => ({
        ok: true,
        async json() {
          return {
            list_mode: "snapshot",
            total: 2,
            items: [
              { order_id: "YW20260101001", current_handler: "张三 u1" },
              { order_id: "YW20260101002", current_handler: "李四 u2" },
            ],
          };
        },
      }),
      (page, pageSize) => `page=${page}&page_size=${pageSize}&tab=all`
    );
    expect(result.listMode).toBe("snapshot");
    expect(result.tickets.map((t) => t.orderId)).toEqual(["YW20260101001", "YW20260101002"]);
    expect(result.tickets[0].currentHandler).toBe("张三 u1");
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

  test("快照多页合并", async () => {
    const calls = [];
    const result = await fetchAllHomeHcsSnapshotTickets(
      async (qs) => {
        calls.push(qs);
        if (qs.includes("page=1")) {
          return {
            ok: true,
            async json() {
              return {
                list_mode: "snapshot",
                total: 12,
                items: Array.from({ length: 10 }, (_, i) => ({
                  order_id: `YW20260101${String(i).padStart(3, "0")}`,
                  current_handler: "张三 u1",
                })),
              };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return {
              list_mode: "snapshot",
              total: 12,
              items: [
                { order_id: "YW20260101010", current_handler: "张三 u1" },
                { order_id: "YW20260101011", current_handler: "张三 u1" },
              ],
            };
          },
        };
      },
      (page, pageSize) => `page=${page}&page_size=${pageSize}`
    );
    expect(result.tickets).toHaveLength(12);
    expect(calls).toHaveLength(2);
  });
});
