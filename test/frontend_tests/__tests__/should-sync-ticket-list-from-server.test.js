/**
 * syncTicketsFromServer 入口守卫：非工作台/补丁列表且无 ticket_no 时禁止 legacy 全量拉取。
 * 与 frontend/modules/pages/ticket-core.js 中 shouldSyncTicketListFromServer 一致。
 */
function shouldSyncTicketListFromServer(activeKey, templateCode, options = {}) {
  const ticketNo = String(options.ticketNo || "").trim();
  if (ticketNo) return true;
  if (options.legacyFullList) return true;
  if (activeKey === "list" && templateCode === "HCS_INCIDENT") return true;
  if (activeKey === "patch:list") return true;
  return false;
}

describe("shouldSyncTicketListFromServer", () => {
  test("工作台 HCS 允许同步", () => {
    expect(shouldSyncTicketListFromServer("list", "HCS_INCIDENT")).toBe(true);
  });

  test("补丁管理允许同步", () => {
    expect(shouldSyncTicketListFromServer("patch:list", "HOTPATCH")).toBe(true);
  });

  test("指定 ticket_no 允许同步", () => {
    expect(
      shouldSyncTicketListFromServer("ticket:YW20260101001", "HCS_INCIDENT", {
        ticketNo: "YW20260101001",
      })
    ).toBe(true);
  });

  test("主页/详情/管理页无单号时禁止全量同步", () => {
    expect(shouldSyncTicketListFromServer("home", "HCS_INCIDENT")).toBe(false);
    expect(shouldSyncTicketListFromServer("ticket:YW20260101001", "HCS_INCIDENT")).toBe(false);
    expect(shouldSyncTicketListFromServer("admin:users", "HCS_INCIDENT")).toBe(false);
    expect(shouldSyncTicketListFromServer("major:problem", "HCS_INCIDENT")).toBe(false);
  });
});
