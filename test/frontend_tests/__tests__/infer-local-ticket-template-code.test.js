/**
 * 本地占位工单模板推断（须与 frontend/modules/pages/ticket-core.js 中 inferLocalTicketTemplateCode 一致；Jest 以 CJS 跑测，故内联实现）。
 */
function inferLocalTicketTemplateCode(orderId, workflow, formKeys) {
  const fromWf = String(workflow?.templateCode || "").trim();
  if (fromWf === "HOTPATCH" || fromWf === "HCS_INCIDENT") return fromWf;
  const keys = Array.isArray(formKeys) ? formKeys : [];
  const prefix = `${orderId}:`;
  return keys.some((k) => String(k).startsWith(prefix) && String(k).includes(":hp_")) ? "HOTPATCH" : "HCS_INCIDENT";
}

describe("inferLocalTicketTemplateCode", () => {
  test("workflow 上已带 templateCode 时直接采用", () => {
    expect(inferLocalTicketTemplateCode("YW20260101001", { templateCode: "HOTPATCH" }, [])).toBe("HOTPATCH");
    expect(inferLocalTicketTemplateCode("YW20260101001", { templateCode: "HCS_INCIDENT" }, [])).toBe("HCS_INCIDENT");
  });

  test("无 workflow.templateCode 时，凭表单 key 中含 :hp_ 判定热补丁", () => {
    const keys = ["YW20260101001:hp_demand_fill", "other:problem_fill"];
    expect(inferLocalTicketTemplateCode("YW20260101001", {}, keys)).toBe("HOTPATCH");
    expect(inferLocalTicketTemplateCode("YW20260101001", null, keys)).toBe("HOTPATCH");
  });

  test("否则为 HCS 事件单", () => {
    expect(inferLocalTicketTemplateCode("YW20260101001", {}, ["YW20260101001:ops_analysis"])).toBe("HCS_INCIDENT");
    expect(inferLocalTicketTemplateCode("YW20260101001", {}, [])).toBe("HCS_INCIDENT");
  });
});
