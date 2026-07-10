/**
 * 开发闭环「提交运维闭环」下一步处理人默认带出（与 ticket-page.js 契约一致）。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const WF_PATH = path.resolve(__dirname, "../../../frontend/modules/constants/workflow.js");
const src = fs.readFileSync(SRC_PATH, "utf8");
const wfSrc = fs.readFileSync(WF_PATH, "utf8");

describe("dev_closure next_handler default for 提交运维闭环", () => {
  test("workflow 常量与后端口径一致", () => {
    expect(wfSrc).toMatch(/export const DEV_CLOSURE_TO_OPS_CLOSURE_HANDLE_MODE = "提交运维闭环"/);
  });

  test("加载节点数据时保存 suggested_next_handler_by_handle_mode", () => {
    expect(src).toMatch(/formState\.suggestedNextHandlerByHandleMode/);
    expect(src).toMatch(/suggested_next_handler_by_handle_mode/);
  });

  test("applyNodeFieldRules 在开发闭环调用默认带出", () => {
    expect(src).toMatch(/if \(nodeKey === "dev_closure"\) \{\s*syncDevClosureNextHandlerDefault/);
  });

  test("切到提交运维闭环或空值时带出建议人，已有手选不覆盖", () => {
    const fn = src.slice(
      src.indexOf("export function syncDevClosureNextHandlerDefault"),
      src.indexOf("export function applyNodeFieldRules")
    );
    expect(fn).toMatch(/DEV_CLOSURE_TO_OPS_CLOSURE_HANDLE_MODE/);
    expect(fn).toMatch(/modeChanged = prevHm !== undefined && prevHm !== hm/);
    expect(fn).toMatch(/if \(!modeChanged && current\) return/);
  });
});
