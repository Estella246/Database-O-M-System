/**
 * 工作台服务端分页全选：按筛选条件分页拉取全部工单号
 * 与 frontend/modules/pages/ticket-core.js 中 fetchWorkbenchFilteredTicketIds 逻辑一致。
 */
async function fetchWorkbenchFilteredTicketIds(fetchImpl, buildQs) {
  const pageSize = 100;
  const allIds = [];
  let page = 1;
  let total = 0;

  while (true) {
    const qs = buildQs(page, pageSize);
    try {
      const resp = await fetchImpl(qs);
      if (!resp.ok) break;
      const json = await resp.json();
      const items = Array.isArray(json?.items) ? json.items : [];
      total = Number(json.total) || 0;
      items.forEach((row) => {
        const id = String(row.orderId || row.order_id || "");
        if (id) allIds.push(id);
      });
      if (allIds.length >= total || items.length === 0) break;
      page += 1;
    } catch (_) {
      break;
    }
  }
  return allIds;
}

describe("fetchWorkbenchFilteredTicketIds", () => {
  test("单页结果返回全部工单号", async () => {
    const calls = [];
    const ids = await fetchWorkbenchFilteredTicketIds(
      async (qs) => {
        calls.push(qs);
        return {
          ok: true,
          async json() {
            return {
              total: 3,
              items: [{ orderId: "YW20260101001" }, { orderId: "YW20260101002" }, { orderId: "YW20260101003" }],
            };
          },
        };
      },
      (page, pageSize) => `page=${page}&page_size=${pageSize}`
    );
    expect(ids).toEqual(["YW20260101001", "YW20260101002", "YW20260101003"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("page=1&page_size=100");
  });

  test("多页结果合并全部工单号", async () => {
    const calls = [];
    const ids = await fetchWorkbenchFilteredTicketIds(
      async (qs) => {
        calls.push(qs);
        if (qs.includes("page=1")) {
          return {
            ok: true,
            async json() {
              return {
                total: 15,
                items: Array.from({ length: 10 }, (_, i) => ({ orderId: `YW202601010${String(i + 1).padStart(2, "0")}` })),
              };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return {
              total: 15,
              items: Array.from({ length: 5 }, (_, i) => ({ orderId: `YW202601020${String(i + 1).padStart(2, "0")}` })),
            };
          },
        };
      },
      (page, pageSize) => `page=${page}&page_size=${pageSize}`
    );
    expect(ids).toHaveLength(15);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("page=2&page_size=100");
  });
});
