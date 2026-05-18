/**
 * 我的主页「待办工单」应合并补丁管理 HOTPATCH 待办（与补丁页「待处理」同口径）
 */

function getHomePendingWorkbenchBaseTicketsMock(getAllTickets, operator, whitelistLevel) {
  const onlyMyCreated = whitelistLevel === "editable";
  const all = getAllTickets();
  const base = onlyMyCreated
    ? all.filter((t) => t.creatorId === operator.account)
    : all;
  const hcs = base.filter((t) => String(t.templateCode || "") !== "HOTPATCH");
  const patch = base.filter((t) => String(t.templateCode || "") === "HOTPATCH");
  const seen = new Set(hcs.map((t) => t.orderId));
  const merged = [...hcs];
  for (const t of patch) {
    if (!seen.has(t.orderId)) merged.push(t);
  }
  return merged;
}

function filterPending(tickets, operator) {
  return tickets.filter((t) => {
    const handler = String((t.currentHandler ?? t.assignee) || "").trim();
    return handler === operator.account || handler.includes(operator.account);
  });
}

describe("home pending workbench includes HOTPATCH", () => {
  const operator = { account: "u1", userName: "张三" };
  const tickets = [
    { orderId: "YW20260101001", templateCode: "HCS_INCIDENT", currentHandler: "u1", creatorId: "u2" },
    { orderId: "HPM20260101001", templateCode: "HOTPATCH", currentHandler: "u1", creatorId: "u2" },
    { orderId: "HPM20260101002", templateCode: "HOTPATCH", currentHandler: "other", creatorId: "u1" },
  ];

  test("待办数据集含 HCS 与 HOTPATCH", () => {
    const base = getHomePendingWorkbenchBaseTicketsMock(() => tickets, operator, "readonly");
    expect(base.map((t) => t.orderId).sort()).toEqual([
      "HPM20260101001",
      "HPM20260101002",
      "YW20260101001",
    ]);
  });

  test("待办页签过滤后含本人处理的 HOTPATCH", () => {
    const base = getHomePendingWorkbenchBaseTicketsMock(() => tickets, operator, "readonly");
    const pending = filterPending(base, operator);
    expect(pending.map((t) => t.orderId).sort()).toEqual(["HPM20260101001", "YW20260101001"]);
  });
});
