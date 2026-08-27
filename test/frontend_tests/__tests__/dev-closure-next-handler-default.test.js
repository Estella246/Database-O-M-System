/**
 * 按处理方式默认带出下一步处理人（开发闭环 / 运维分析，与 ticket-page.js 契约一致）。
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const WF_PATH = path.resolve(__dirname, "../../../frontend/modules/constants/workflow.js");
const NORM_PATH = path.resolve(__dirname, "../../../frontend/modules/utils/normalize.js");
const src = fs.readFileSync(SRC_PATH, "utf8");
const wfSrc = fs.readFileSync(WF_PATH, "utf8");
const normSrc = fs.readFileSync(NORM_PATH, "utf8");

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
    expect(fn).toMatch(/if \(!forceOverwrite && !modeChanged && current\) return/);
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
      /if \(nodeKey === "ops_analysis"\) \{[\s\S]*?syncSuggestedNextHandlerByHandleMode\([\s\S]*?OPS_ANALYSIS_NEXT_HANDLER_SYNC_HANDLE_MODES/
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

describe("to_dev_closure next_handler default from duty-field L2 owner", () => {
  test("workflow 常量覆盖提交开发闭环与返回开发闭环", () => {
    expect(wfSrc).toMatch(/export const TO_DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES = new Set\(/);
    expect(wfSrc).toMatch(/"提交开发闭环"/);
    expect(wfSrc).toMatch(/"返回开发闭环"/);
    expect(wfSrc).toMatch(/export const TO_DEV_CLOSURE_HANDLE_MODE_BY_NODE/);
  });

  test("normalize 提供按级联树解析二级负责人", () => {
    expect(normSrc).toMatch(/export function resolveDutyFieldL2OwnerFromCascade/);
  });

  test("改问题模块时强制按新路径覆盖下一步处理人", () => {
    const fn = src.slice(
      src.indexOf("export function syncSuggestedNextHandlerByHandleMode"),
      src.indexOf("export function applyNodeFieldRules")
    );
    expect(fn).toMatch(/forceOverwrite/);
    expect(fn).toMatch(/_lastIssueIntroForNextDefault/);
    expect(src).toMatch(/introChanged && hm === TO_DEV_CLOSURE_HANDLE_MODE_BY_NODE/);
  });
});
