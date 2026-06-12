import {
  personOptionMatchesKeyword,
  isWorkflowFlatSelectSearchable,
  shouldUseWorkflowFlatSelect,
} from "../../../frontend/modules/constants/workflow.js";

describe("personOptionMatchesKeyword", () => {
  test("空关键字显示全部", () => {
    expect(personOptionMatchesKeyword("李潇雨 l30030745", "")).toBe(true);
  });

  test("按姓名片段匹配", () => {
    expect(personOptionMatchesKeyword("李潇雨 l30030745", "李潇")).toBe(true);
  });

  test("按账号片段匹配", () => {
    expect(personOptionMatchesKeyword("李潇雨 l30030745", "l300")).toBe(true);
  });

  test("空格分词须同时命中", () => {
    expect(personOptionMatchesKeyword("李潇雨 l30030745", "李潇 l300")).toBe(true);
    expect(personOptionMatchesKeyword("李潇雨 l30030745", "王五 l300")).toBe(false);
  });
});

describe("next_handler 可搜索下拉", () => {
  test("next_handler 启用搜索", () => {
    expect(isWorkflowFlatSelectSearchable({ key: "next_handler" })).toBe(true);
  });

  test("热补丁节点 next_handler 使用扁平下拉", () => {
    expect(shouldUseWorkflowFlatSelect("hp_ccb", { type: "whitelist", key: "next_handler" })).toBe(true);
  });

  test("问题填写节点白名单字段使用扁平下拉", () => {
    expect(shouldUseWorkflowFlatSelect("problem_fill", { type: "whitelist", key: "severity" })).toBe(true);
  });

  test("热补丁诉求填写节点白名单字段使用扁平下拉", () => {
    expect(shouldUseWorkflowFlatSelect("hp_demand_fill", { type: "whitelist", key: "patch_type" })).toBe(true);
  });
});
