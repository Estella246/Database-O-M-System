/**
 * 详情流程条当前步骤推断（对应 workflow.js resolveWorkflowStepIndexFromTicket）
 */

const WORKFLOW_NODES = ["问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];
const STEP_BY_NODE_KEY = {
  problem_fill: "问题填写",
  problem_review: "问题审核",
  ops_analysis: "运维分析",
  dev_analysis: "开发分析",
  dev_closure: "开发闭环",
  ops_closure: "运维闭环",
  audit_close: "审核关闭",
};

function resolveWorkflowStepIndexFromTicket(ticket, wfNodes, stepByKey) {
  const nodes = Array.isArray(wfNodes) ? wfNodes : WORKFLOW_NODES;
  const byKey = stepByKey || STEP_BY_NODE_KEY;
  const nodeKey = String(ticket?.node_key || "").trim().toLowerCase();
  if (nodeKey) {
    const step = byKey[nodeKey];
    if (step && nodes.includes(step)) return nodes.indexOf(step);
  }
  const status = String(ticket?.status || "").trim();
  if (status === "暂时挂起" || status.toLowerCase() === "suspended") {
    const idx = nodes.indexOf("审核关闭");
    if (idx >= 0) return idx;
  }
  const stage = String(ticket?.node || ticket?.currentStage || "").trim();
  if (stage === "暂时挂起") {
    const idx = nodes.indexOf("审核关闭");
    if (idx >= 0) return idx;
  }
  if (!stage || stage === "-") return -1;
  if (nodes.includes(stage)) return nodes.indexOf(stage);
  const byKeyFromStage = byKey[stage.toLowerCase()] || byKey[stage];
  if (byKeyFromStage && nodes.includes(byKeyFromStage)) return nodes.indexOf(byKeyFromStage);
  return -1;
}

describe("resolveWorkflowStepIndexFromTicket", () => {
  test("node_key=audit_close 落在审核关闭", () => {
    const idx = resolveWorkflowStepIndexFromTicket(
      { node_key: "audit_close", currentStage: "暂时挂起", status: "暂时挂起" },
      WORKFLOW_NODES,
      STEP_BY_NODE_KEY
    );
    expect(idx).toBe(WORKFLOW_NODES.indexOf("审核关闭"));
  });

  test("currentStage=暂时挂起 无 node_key 时落在审核关闭", () => {
    const idx = resolveWorkflowStepIndexFromTicket(
      { node: "暂时挂起", currentStage: "暂时挂起", status: "暂时挂起" },
      WORKFLOW_NODES,
      STEP_BY_NODE_KEY
    );
    expect(idx).toBe(WORKFLOW_NODES.indexOf("审核关闭"));
  });

  test("status=suspended 落在审核关闭", () => {
    const idx = resolveWorkflowStepIndexFromTicket(
      { status: "suspended" },
      WORKFLOW_NODES,
      STEP_BY_NODE_KEY
    );
    expect(idx).toBe(WORKFLOW_NODES.indexOf("审核关闭"));
  });
});
