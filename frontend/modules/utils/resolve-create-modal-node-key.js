/**
 * 创建工单弹窗渲染用的 node_key。
 * HOTPATCH 在 stored 为空时必须回落 hp_demand_fill，不可使用工作台起单节点。
 */
export function resolveCreateModalNodeKeyForRender(createModalOpen, storedNodeKey, createModalWorkflow, hcsStartNodeKey) {
  if (!createModalOpen) return String(storedNodeKey || "").trim();
  const stored = String(storedNodeKey || "").trim();
  if (stored) return stored;
  return createModalWorkflow === "HOTPATCH" ? "hp_demand_fill" : hcsStartNodeKey;
}
