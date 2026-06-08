/**
 * 须与 frontend/modules/pages/ticket-core.js 中 parseTicketDeepLinkOrderId 语义一致。
 */
const _TICKET_DEEP_LINK_RE = /^\/tickets\/([^/]+)\/?$/;

function parseTicketDeepLinkOrderId(pathname) {
  const match = String(pathname || "").match(_TICKET_DEEP_LINK_RE);
  return match ? decodeURIComponent(match[1]) : "";
}

describe("parseTicketDeepLinkOrderId", () => {
  test("解析标准工单深链", () => {
    expect(parseTicketDeepLinkOrderId("/tickets/YW20260608011")).toBe("YW20260608011");
  });

  test("解析带尾部斜杠的深链", () => {
    expect(parseTicketDeepLinkOrderId("/tickets/YW20260608011/")).toBe("YW20260608011");
  });

  test("非工单路径返回空", () => {
    expect(parseTicketDeepLinkOrderId("/workbench")).toBe("");
    expect(parseTicketDeepLinkOrderId("/")).toBe("");
  });
});
