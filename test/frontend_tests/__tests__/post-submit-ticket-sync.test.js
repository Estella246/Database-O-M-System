/**
 * 节点流转提交后的列表同步策略（与 ticket-page.js / ticket-core.js 一致）。
 * 详情页提交后须只拉当前单，避免 legacy 全量 GET /api/tickets。
 */

function shouldUseSingleTicketSyncAfterFlowSubmit(activeKey) {
  return typeof activeKey === "string" && activeKey.startsWith("ticket:");
}

function ticketDetailLoadingWhileSync(isTicketDetail, ticketListLoading, activeTicket, hydratingOrderId) {
  if (!isTicketDetail) return false;
  if (ticketListLoading && !activeTicket) return true;
  const orderId = activeTicket?.orderId || "";
  return !!orderId && hydratingOrderId === orderId;
}

describe("post-submit ticket list sync", () => {
  test("详情页流转提交后只同步当前工单", () => {
    expect(shouldUseSingleTicketSyncAfterFlowSubmit("ticket:YW20260608011")).toBe(true);
    expect(shouldUseSingleTicketSyncAfterFlowSubmit("list")).toBe(false);
  });

  test("详情页已有本地工单时不因后台 sync 显示加载中", () => {
    const activeTicket = { orderId: "YW20260608011" };
    expect(ticketDetailLoadingWhileSync(true, true, activeTicket, "")).toBe(false);
  });

  test("深链首屏预载仍显示加载中", () => {
    expect(ticketDetailLoadingWhileSync(true, true, null, "")).toBe(true);
  });

  test("节点表单预加载中显示整页加载中", () => {
    const activeTicket = { orderId: "YW20260608011" };
    expect(ticketDetailLoadingWhileSync(true, false, activeTicket, "YW20260608011")).toBe(true);
    expect(ticketDetailLoadingWhileSync(true, false, activeTicket, "")).toBe(false);
  });
});
