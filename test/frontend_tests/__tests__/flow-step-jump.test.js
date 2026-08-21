/**
 * 工单详情顶栏进度条点击展开节点卡片
 */

function getFlowExpandedSteps(raw) {
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw)) return new Set(raw);
  return new Set();
}

function shouldFlowLogBeOpen({ isCurrent, nodeHandlerOk, step, expandedSteps }) {
  if (isCurrent && nodeHandlerOk) return true;
  return getFlowExpandedSteps(expandedSteps).has(step);
}

function flowStepHasDetailCard(step, visitedSteps) {
  return visitedSteps.has(step);
}

describe("flow step jump", () => {
  test("只有已走过节点可从顶栏跳转展开", () => {
    const visited = new Set(["问题填写", "问题审核"]);
    expect(flowStepHasDetailCard("问题填写", visited)).toBe(true);
    expect(flowStepHasDetailCard("运维分析", visited)).toBe(false);
  });

  test("当前处理人节点自动展开；其它节点依赖用户点击记录", () => {
    expect(
      shouldFlowLogBeOpen({
        isCurrent: true,
        nodeHandlerOk: true,
        step: "运维分析",
        expandedSteps: undefined,
      })
    ).toBe(true);
    expect(
      shouldFlowLogBeOpen({
        isCurrent: false,
        nodeHandlerOk: false,
        step: "问题填写",
        expandedSteps: new Set(["问题填写"]),
      })
    ).toBe(true);
    expect(
      shouldFlowLogBeOpen({
        isCurrent: false,
        nodeHandlerOk: false,
        step: "问题审核",
        expandedSteps: new Set(["问题填写"]),
      })
    ).toBe(false);
  });
});
