/**
 * 工单节点流转提交后的重绘策略（与 ticket-page.js 一致）。
 * 避免 saveNode / advanceWorkflow / sync / ensureNodeFormData 连续 requestRender 导致详情页闪跳。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("flow submit render coalescing", () => {
  test("流转提交跳过 saveNode 完成时的即时重绘", () => {
    expect(src).toMatch(/suppressRenderOnComplete:\s*isFlowSubmit/);
    expect(src).toMatch(/if\s*\(!options\.suppressRenderOnComplete\)\s*requestRender\(\)/);
  });

  test("advanceWorkflow 不再单独触发 requestRender", () => {
    const fnBlock = src.slice(src.indexOf("export function advanceWorkflow"), src.indexOf("export function renderOperationLogs"));
    expect(fnBlock).not.toMatch(/requestRender\(\)/);
  });

  test("流转提交在 sync 与预加载下一节点表单后只 requestRender 一次", () => {
    const submitBlock = src.slice(src.indexOf('form.addEventListener("submit"'), src.indexOf("export function renderDutyFieldTreeInnerHtml"));
    expect(submitBlock).toMatch(/await syncSingleTicketFromServer\(workId\)/);
    expect(submitBlock).toMatch(/await preloadWorkflowFormsAfterFlowSubmit\(workId, nextNodeKey, wfTpl\)/);
    expect(submitBlock).toMatch(/requestRender\(\);\s*\n\s*\}\);/);
    expect(submitBlock).not.toMatch(/syncSingleTicketFromServer\(workId\)[\s\S]*?\.finally\(\(\)\s*=>\s*requestRender\(\)/);
  });

  test("预加载节点表单时 suppressRender 避免中间帧重绘", () => {
    expect(src).toMatch(/preloadWorkflowFormsAfterFlowSubmit/);
    expect(src).toMatch(/suppressRender:\s*true/);
    expect(src).toMatch(/if\s*\(!options\.suppressRender\)\s*requestRender\(\)/);
  });
});
