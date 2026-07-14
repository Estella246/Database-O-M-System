/**
 * 工作台列表与接口合并去重（须与 frontend/modules/pages/ticket-core.js 中
 * mergeTicketListAfterServerSync / upsertTicketListRows 一致；Jest 以 CJS 跑测，故内联实现）。
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

function upsertTicketListRows(localList, mapped) {
  const byId = new Map();
  (localList || []).forEach((t) => {
    const id = String(t?.orderId || "").trim();
    if (id) byId.set(id, t);
  });
  (mapped || []).forEach((t) => {
    const id = String(t?.orderId || "").trim();
    if (!id) return;
    byId.set(id, t);
  });
  return [...byId.values()];
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

describe("upsertTicketListRows", () => {
  test("单票刷新保留其它已开页签行，并更新目标单阶段", () => {
    const local = [
      { orderId: "YW20260526001", templateCode: "HCS_INCIDENT", currentStage: "运维分析", node_key: "ops_analysis" },
      { orderId: "YW20260526002", templateCode: "HCS_INCIDENT", currentStage: "开发闭环", node_key: "dev_closure" },
    ];
    const mapped = [
      { orderId: "YW20260526001", templateCode: "HCS_INCIDENT", currentStage: "开发分析", node_key: "dev_analysis" },
    ];
    const merged = upsertTicketListRows(local, mapped);
    expect(merged).toHaveLength(2);
    expect(merged.find((t) => t.orderId === "YW20260526001").node_key).toBe("dev_analysis");
    expect(merged.find((t) => t.orderId === "YW20260526002").node_key).toBe("dev_closure");
  });

  test("目标单不在本地时插入新行", () => {
    const local = [{ orderId: "YW20260526002", templateCode: "HCS_INCIDENT", node_key: "ops_analysis" }];
    const mapped = [{ orderId: "YW20260526001", templateCode: "HCS_INCIDENT", node_key: "problem_review" }];
    const merged = upsertTicketListRows(local, mapped);
    expect(merged.map((t) => t.orderId).sort()).toEqual(["YW20260526001", "YW20260526002"]);
  });
});
