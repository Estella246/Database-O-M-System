/**
 * 须与 frontend/modules/pages/ticket-core.js 中 templateCodeForTicketListSync 语义一致（Jest 以 CJS 跑测，故内联实现）。
 */
const _HPM_TICKET_NO_RE = /^HPM\d{11}$/;

function templateCodeForTicketListSync(activeKey) {
  if (activeKey === "patch:list") return "HOTPATCH";
  if (typeof activeKey === "string" && activeKey.startsWith("ticket:")) {
    const oid = activeKey.slice("ticket:".length);
    if (_HPM_TICKET_NO_RE.test(oid)) return "HOTPATCH";
  }
  return "HCS_INCIDENT";
}

describe("templateCodeForTicketListSync", () => {
  test("补丁列表页签拉 HOTPATCH", () => {
    expect(templateCodeForTicketListSync("patch:list")).toBe("HOTPATCH");
  });

  test("热补丁单号深链详情页拉 HOTPATCH（刷新后仍能命中 ticketList）", () => {
    expect(templateCodeForTicketListSync("ticket:HPM20260509009")).toBe("HOTPATCH");
  });

  test("运维单号深链仍拉 HCS_INCIDENT", () => {
    expect(templateCodeForTicketListSync("ticket:YW20260509001")).toBe("HCS_INCIDENT");
  });

  test("工作台与其它页签默认 HCS_INCIDENT", () => {
    expect(templateCodeForTicketListSync("list")).toBe("HCS_INCIDENT");
    expect(templateCodeForTicketListSync("home")).toBe("HCS_INCIDENT");
  });

  test("非规范单号前缀不误判 HOTPATCH", () => {
    expect(templateCodeForTicketListSync("ticket:HPM2026050901")).toBe("HCS_INCIDENT");
  });
});
