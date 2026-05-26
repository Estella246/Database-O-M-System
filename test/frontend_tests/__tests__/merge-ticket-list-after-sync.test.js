/**
 * 工作台列表与接口合并去重（须与 frontend/modules/pages/ticket-core.js 中 mergeTicketListAfterServerSync 一致；Jest 以 CJS 跑测，故内联实现）。
 */
function mergeTicketListAfterServerSync(localList, mapped, templateCode) {
  const strip = templateCode === "HOTPATCH" ? "HOTPATCH" : "HCS_INCIDENT";
  const effectiveTemplateCode = (t) => {
    const tc = String(t.templateCode || "").trim();
    if (tc === "HOTPATCH" || tc === "HCS_INCIDENT") return tc;
    return strip === "HCS_INCIDENT" ? "HCS_INCIDENT" : tc;
  };
  const keep = localList.filter((t) => effectiveTemplateCode(t) !== strip);
  const serverOrderIds = new Set(mapped.map((x) => String(x.orderId || "")));
  const keepWithoutServerDupes = keep.filter((t) => !serverOrderIds.has(String(t.orderId || "")));
  return [...keepWithoutServerDupes, ...mapped];
}

describe("mergeTicketListAfterServerSync", () => {
  test("HCS 同步时去掉 templateCode 为空的本地占位，且不与接口行重复", () => {
    const local = [
      { orderId: "YW20260526001", templateCode: "", currentStage: "运维分析" },
      { orderId: "HPM20260526001", templateCode: "HOTPATCH", currentStage: "诉求填写" },
    ];
    const mapped = [{ orderId: "YW20260526001", templateCode: "HCS_INCIDENT", currentStage: "运维分析" }];
    const merged = mergeTicketListAfterServerSync(local, mapped, "HCS_INCIDENT");
    const ids = merged.map((t) => t.orderId);
    expect(ids.filter((id) => id === "YW20260526001")).toHaveLength(1);
    expect(merged.find((t) => t.orderId === "YW20260526001").templateCode).toBe("HCS_INCIDENT");
    expect(ids).toContain("HPM20260526001");
  });

  test("保留其它模板的本地行", () => {
    const local = [
      { orderId: "HPM20260526001", templateCode: "HOTPATCH" },
      { orderId: "YW20260526002", templateCode: "" },
    ];
    const mapped = [{ orderId: "YW20260526002", templateCode: "HCS_INCIDENT" }];
    const merged = mergeTicketListAfterServerSync(local, mapped, "HCS_INCIDENT");
    expect(merged.map((t) => t.orderId)).toEqual(["HPM20260526001", "YW20260526002"]);
  });
});
