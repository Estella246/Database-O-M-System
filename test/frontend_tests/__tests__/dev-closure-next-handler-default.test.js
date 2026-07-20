/**
 * 按处理方式默认带出下一步处理人（开发闭环 / 运维分析，与 ticket-page.js 契约一致）。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const WF_PATH = path.resolve(__dirname, "../../../frontend/modules/constants/workflow.js");
const src = fs.readFileSync(SRC_PATH, "utf8");
const wfSrc = fs.readFileSync(WF_PATH, "utf8");

describe("dev_closure next_handler default for 提交运维闭环 / 返回运维分析", () => {
  test("workflow 常量覆盖两种处理方式", () => {
    expect(wfSrc).toMatch(/export const DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES = new Set\(/);
    expect(wfSrc).toMatch(/"提交运维闭环"/);
    expect(wfSrc).toMatch(/"返回运维分析"/);
  });

  test("加载节点数据时保存 suggested_next_handler_by_handle_mode", () => {
    expect(src).toMatch(/formState\.suggestedNextHandlerByHandleMode/);
    expect(src).toMatch(/suggested_next_handler_by_handle_mode/);
  });

  test("applyNodeFieldRules 在开发闭环调用默认带出", () => {
    expect(src).toMatch(
      /if \(nodeKey === "dev_closure"\) \{\s*syncSuggestedNextHandlerByHandleMode\([\s\S]*?DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES/
    );
  });

  test("按当前处理方式取建议人，切到目标方式或空值时带出，已有手选不覆盖", () => {
    const fn = src.slice(
      src.indexOf("export function syncSuggestedNextHandlerByHandleMode"),
      src.indexOf("export function applyNodeFieldRules")
    );
    expect(fn).toMatch(/modes\.has\(hm\)/);
    expect(fn).toMatch(/suggestedMap\[hm\]/);
    expect(fn).toMatch(/modeChanged = prevHm !== undefined && prevHm !== hm/);
    expect(fn).toMatch(/if \(!modeChanged && current\) return/);
  });
});

describe("ops_analysis next_handler default for 提交运维闭环", () => {
  test("workflow 常量仅覆盖提交运维闭环", () => {
    expect(wfSrc).toMatch(/export const OPS_ANALYSIS_DEFAULT_NEXT_HANDLER_HANDLE_MODES = new Set\(/);
    const block = wfSrc.slice(
      wfSrc.indexOf("export const OPS_ANALYSIS_DEFAULT_NEXT_HANDLER_HANDLE_MODES"),
      wfSrc.indexOf("export const OPS_ANALYSIS_DEFAULT_NEXT_HANDLER_HANDLE_MODES") + 220
    );
    expect(block).toMatch(/"提交运维闭环"/);
    expect(block).not.toMatch(/"返回运维分析"/);
  });

  test("applyNodeFieldRules 在运维分析调用默认带出", () => {
    expect(src).toMatch(
      /if \(nodeKey === "ops_analysis"\) \{[\s\S]*?syncSuggestedNextHandlerByHandleMode\([\s\S]*?OPS_ANALYSIS_DEFAULT_NEXT_HANDLER_HANDLE_MODES/
    );
  });

  test("切到非目标方式时清空仍等于建议人的下一步处理人", () => {
    const fn = src.slice(
      src.indexOf("export function syncSuggestedNextHandlerByHandleMode"),
      src.indexOf("export function applyNodeFieldRules")
    );
    expect(fn).toMatch(/离开「需默认带出」的处理方式时/);
    expect(fn).toMatch(/prevSuggested && current === prevSuggested/);
    expect(fn).toMatch(/_setNextHandlerFieldValue\(form, formState, ""\)/);
  });
});
