/**
 * 创建弹窗 node_key 解析（补丁管理须默认 hp_demand_fill / 诉求填写）
 * 逻辑须与 frontend/modules/utils/resolve-create-modal-node-key.js 一致（Jest 以 CJS 跑测，故内联实现）。
 */

function resolveCreateModalNodeKeyForRender(createModalOpen, storedNodeKey, createModalWorkflow, hcsStartNodeKey) {
  if (!createModalOpen) return String(storedNodeKey || "").trim();
  const stored = String(storedNodeKey || "").trim();
  if (stored) return stored;
  return createModalWorkflow === "HOTPATCH" ? "hp_demand_fill" : hcsStartNodeKey;
}

describe("resolveCreateModalNodeKeyForRender", () => {
  test("弹窗未打开时仅返回已存的 nodeKey（可为空）", () => {
    expect(resolveCreateModalNodeKeyForRender(false, "", "HOTPATCH", "ops_analysis")).toBe("");
    expect(resolveCreateModalNodeKeyForRender(false, "problem_fill", "HCS_INCIDENT", "ops_analysis")).toBe(
      "problem_fill",
    );
  });

  test("HOTPATCH 且 nodeKey 为空时回落 hp_demand_fill", () => {
    expect(resolveCreateModalNodeKeyForRender(true, "", "HOTPATCH", "problem_fill")).toBe("hp_demand_fill");
    expect(resolveCreateModalNodeKeyForRender(true, "  ", "HOTPATCH", "problem_fill")).toBe("hp_demand_fill");
  });

  test("HOTPATCH 且已有 nodeKey 时原样返回", () => {
    expect(resolveCreateModalNodeKeyForRender(true, "hp_demand_fill", "HOTPATCH", "problem_fill")).toBe(
      "hp_demand_fill",
    );
  });

  test("非 HOTPATCH 且 nodeKey 为空时使用工作台起单节点", () => {
    expect(resolveCreateModalNodeKeyForRender(true, "", "HCS_INCIDENT", "problem_fill")).toBe("problem_fill");
    expect(resolveCreateModalNodeKeyForRender(true, "", "HCS_INCIDENT", "ops_analysis")).toBe("ops_analysis");
  });
});
