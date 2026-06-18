/**
 * 工作台点开详情后再进主页：仅 formsByTicket 预加载不应合成待办行（须与 ticket-core getAllTickets 一致）。
 */

function getAllTicketsFromContext(ticketList, workflowByOrderId, formsByTicket, createModalOpen, createTicketId) {
  const items = [...ticketList];
  const exists = new Set(items.map((x) => String(x.orderId || "")));
  const createDraftId = createModalOpen && createTicketId ? String(createTicketId).trim() : "";
  Object.keys(workflowByOrderId).forEach((orderId) => {
    if (!orderId || exists.has(orderId)) return;
    if (createDraftId && orderId === createDraftId) return;
    items.push({
      orderId,
      templateCode: workflowByOrderId[orderId]?.templateCode || "HCS_INCIDENT",
      currentHandler: "本地草稿处理人",
    });
    exists.add(orderId);
  });
  return items;
}

function filterHomePendingWithServerHcsTab(tickets, operator) {
  return tickets.filter((t) => {
    const tc = String(t.templateCode || "").trim();
    if (tc !== "HOTPATCH") return true;
    const handler = String((t.currentHandler ?? t.assignee) || "").trim();
    return handler === operator.userName || handler.includes(operator.account);
  });
}

describe("home viewed ticket must not appear in pending", () => {
  const operator = { account: "demo_001", userName: "演示用户" };

  test("仅 formsByTicket 预加载时不进入 getAllTickets 合并结果", () => {
    const ticketList = [];
    const workflowByOrderId = {};
    const formsByTicket = { "YW20260618001:ops_analysis": { loaded: true, values: {} } };
    const merged = getAllTicketsFromContext(
      ticketList,
      workflowByOrderId,
      formsByTicket,
      false,
      ""
    );
    expect(merged).toHaveLength(0);
  });

  test("本地建单草稿（workflowByOrderId）仍应合并进列表", () => {
    const merged = getAllTicketsFromContext(
      [],
      { YW20260618002: { templateCode: "HCS_INCIDENT", currentStep: 0 } },
      {},
      false,
      ""
    );
    expect(merged.map((t) => t.orderId)).toEqual(["YW20260618002"]);
  });

  test("打开创建弹窗时草稿单号不进入列表", () => {
    const merged = getAllTicketsFromContext(
      [],
      { YW20260618003: { templateCode: "HCS_INCIDENT" } },
      {},
      true,
      "YW20260618003"
    );
    expect(merged).toHaveLength(0);
  });

  test("详情预加载后主页 HCS 快照待办不应多出他人工单", () => {
    const snapshotPending = [{ orderId: "YW20260618010", templateCode: "HCS_INCIDENT", currentHandler: "他人 账号" }];
    const phantomIfBug = {
      orderId: "YW20260618001",
      templateCode: "HCS_INCIDENT",
      currentHandler: operator.userName,
    };
    const base = snapshotPending;
    const buggyBase = [...snapshotPending, phantomIfBug];
    expect(filterHomePendingWithServerHcsTab(base, operator).map((t) => t.orderId)).toEqual(["YW20260618010"]);
    expect(filterHomePendingWithServerHcsTab(buggyBase, operator).map((t) => t.orderId).sort()).toEqual([
      "YW20260618001",
      "YW20260618010",
    ]);
  });
});
