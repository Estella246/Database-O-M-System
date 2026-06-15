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

const LEGACY_TICKET_CLOSED_STATUSES = new Set(["关闭", "完成", "非问题关闭", "已关闭"]);

function isTicketClosedStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return false;
  if (raw.toLowerCase() === "closed") return true;
  return LEGACY_TICKET_CLOSED_STATUSES.has(raw);
}

function filterPendingClose(tickets) {
  return tickets.filter((t) => {
    if (isTicketClosedStatus(t.status)) return false;
    return Boolean(t.operatorSubmitted);
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

describe("home pending_close workbench tab", () => {
  const tickets = [
    { orderId: "YW20260101001", status: "open", operatorSubmitted: true },
    { orderId: "YW20260101002", status: "closed", operatorSubmitted: true },
    { orderId: "YW20260101003", status: "已关闭", operatorSubmitted: true },
    { orderId: "YW20260101004", status: "关闭", operatorSubmitted: true },
    { orderId: "YW20260101005", status: "open", operatorSubmitted: false },
  ];

  test("待关单排除 closed 与老库中文终态", () => {
    const ids = filterPendingClose(tickets).map((t) => t.orderId);
    expect(ids).toEqual(["YW20260101001"]);
  });
});
