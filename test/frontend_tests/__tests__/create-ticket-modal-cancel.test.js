/**
 * 创建弹窗取消：未提交草稿不应出现在 getAllTickets 合并结果中。
 * 逻辑须与 frontend/modules/pages/ticket-core.js 一致（Jest CJS 内联）。
 */

function shouldIncludeLocalTicketInList(orderId, createModalOpen, createTicketId) {
  const draftId = createModalOpen && createTicketId ? String(createTicketId).trim() : "";
  if (draftId && orderId === draftId) return false;
  return true;
}

function discardTicketLocalContext(orderId, ctx) {
  const id = String(orderId || "").trim();
  if (!id) return;
  delete ctx.workflowByOrderId[id];
  delete ctx.operationLogsByOrderId[id];
  Object.keys(ctx.formsByTicket).forEach((k) => {
    if (k.startsWith(`${id}:`)) delete ctx.formsByTicket[k];
  });
  ctx.ticketList = ctx.ticketList.filter((t) => String(t.orderId || "") !== id);
}

describe("create ticket modal cancel", () => {
  test("创建弹窗打开时，草稿单号不进入列表合并", () => {
    expect(shouldIncludeLocalTicketInList("YW20260516001", true, "YW20260516001")).toBe(false);
    expect(shouldIncludeLocalTicketInList("YW20260516001", false, "YW20260516001")).toBe(true);
    expect(shouldIncludeLocalTicketInList("YW20260516002", true, "YW20260516001")).toBe(true);
  });

  test("discardTicketLocalContext 清除 workflow 与表单缓存", () => {
    const ctx = {
      workflowByOrderId: { YW20260516001: { templateCode: "HCS_INCIDENT" } },
      operationLogsByOrderId: { YW20260516001: [] },
      formsByTicket: { "YW20260516001:ops_analysis": { values: {} } },
      ticketList: [{ orderId: "YW20260516001" }, { orderId: "YW20260516002" }],
    };
    discardTicketLocalContext("YW20260516001", ctx);
    expect(ctx.workflowByOrderId.YW20260516001).toBeUndefined();
    expect(ctx.operationLogsByOrderId.YW20260516001).toBeUndefined();
    expect(ctx.formsByTicket["YW20260516001:ops_analysis"]).toBeUndefined();
    expect(ctx.ticketList.map((t) => t.orderId)).toEqual(["YW20260516002"]);
  });
});
