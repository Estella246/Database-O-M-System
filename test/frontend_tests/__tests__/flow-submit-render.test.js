/**
 * 工单节点流转提交后的重绘策略（与 ticket-page.js 一致）。
 * 避免 saveNode / advanceWorkflow / sync / ensureNodeFormData 连续 requestRender 导致详情页闪跳。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("flow submit render coalescing", () => {
  test("流转提交跳过 saveNode 成功完成时的即时重绘", () => {
    expect(src).toMatch(/suppressRenderOnComplete:\s*isFlowSubmit/);
    expect(src).toMatch(/if\s*\(!options\.suppressRenderOnComplete\s*\|\|\s*formState\.error\)\s*requestRender\(\)/);
  });

  test("流转提交校验失败时仍重绘以恢复按钮状态", () => {
    const saveNodeBlock = src.slice(src.indexOf("const saveNode = async"), src.indexOf('form.addEventListener("submit"'));
    expect(saveNodeBlock).toMatch(/formState\.error\s*=\s*err instanceof Error/);
    expect(saveNodeBlock).toMatch(/if\s*\(!options\.suppressRenderOnComplete\s*\|\|\s*formState\.error\)\s*requestRender\(\)/);
  });

  test("流转提交进行中仅提交按钮显示提交中", () => {
    expect(src).toMatch(/formState\.savingMode\s*=\s*isFlowSubmit\s*\?\s*"submit"\s*:\s*"save"/);
    expect(src).toMatch(/formState\.saving\s*&&\s*formState\.savingMode\s*===\s*"submit"\s*\?\s*"提交中\.\.\."\s*:\s*"提交"/);
    expect(src).toMatch(/formState\.saving\s*&&\s*formState\.savingMode\s*===\s*"save"\s*\?\s*"保存中\.\.\."\s*:\s*"保存"/);
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

  test("详情页 renderWorkflow 并行加载节点表单后合并为一次重绘", () => {
    expect(src).toMatch(/scheduleWorkflowDetailFormRender/);
    expect(src).toMatch(/detailFormSuppress\s*=\s*\{\s*suppressRender:\s*true\s*\}/);
    const wfBlock = src.slice(src.indexOf("export function renderWorkflow"), src.indexOf("export function advanceWorkflow"));
    expect(wfBlock).toMatch(/void scheduleWorkflowDetailFormRender\(orderId, detailFormNodeKeys\)/);
  });
});
