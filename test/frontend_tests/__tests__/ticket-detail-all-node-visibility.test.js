/**
 * 工单详情权限为“可查看所有节点”时，卡片渲染与预加载不能再受流转日志限制。
 */

const fs = require("fs");
const path = require("path");

const pageSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js"),
  "utf8",
);

describe("ticket detail all-node visibility", () => {
  test("详情表单节点不再按 visitedSteps 过滤", () => {
    const computeBlock = pageSrc.slice(
      pageSrc.indexOf("export function computeDetailFormNodeKeys"),
      pageSrc.indexOf("export function detailFormsReady"),
    );
    expect(computeBlock).not.toContain("if (!visitedSteps.has(step)) return");
    expect(computeBlock).toContain('if (onlyProblemFill && nkByStep[step] !== "problem_fill") return');
  });

  test("详情卡片渲染不再按 visitedSteps 过滤", () => {
    const renderBlock = pageSrc.slice(
      pageSrc.indexOf("export function renderWorkflow"),
      pageSrc.indexOf("export function renderProblemFill"),
    );
    expect(renderBlock).not.toContain('if (!visitedSteps.has(step)) return ""');
  });
});
