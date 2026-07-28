import {
  filterOpsAnalysisHandleModeOptions,
  opsAnalysisExcludesOpsClosure,
  preferOpsAnalysisDefaultHandleMode,
  OPS_ANALYSIS_DEFAULT_HANDLE_MODE,
} from "../../../frontend/modules/constants/workflow.js";

describe("ops analysis handle_mode options", () => {
  const all = ["提交运维闭环", "提交开发分析", "提交开发闭环", "提交其他运维分析"];

  test("quality yes excludes 提交运维闭环", () => {
    expect(opsAnalysisExcludesOpsClosure("是（已知质量问题）")).toBe(true);
    expect(opsAnalysisExcludesOpsClosure("是（新发现质量问题）")).toBe(true);
    expect(filterOpsAnalysisHandleModeOptions(all, "是（已知质量问题）")).toEqual([
      "提交开发分析",
      "提交开发闭环",
      "提交其他运维分析",
    ]);
  });

  test("quality no keeps all options", () => {
    expect(opsAnalysisExcludesOpsClosure("否")).toBe(false);
    expect(filterOpsAnalysisHandleModeOptions(all, "否")).toEqual(all);
  });

  test("preferOpsAnalysisDefaultHandleMode pins 提交运维闭环 first", () => {
    expect(OPS_ANALYSIS_DEFAULT_HANDLE_MODE).toBe("提交运维闭环");
    expect(preferOpsAnalysisDefaultHandleMode(["提交开发分析", "提交运维闭环", "提交其他运维分析"])).toEqual([
      "提交运维闭环",
      "提交开发分析",
      "提交其他运维分析",
    ]);
  });
});
