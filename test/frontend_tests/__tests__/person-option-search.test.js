import {
  personOptionMatchesKeyword,
  isWorkflowFlatSelectSearchable,
  shouldUseWorkflowFlatSelect,
  workflowFlatSelectSearchPlaceholder,
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
});

describe("引入/修复版本可搜索下拉", () => {
  test("引入版本、修复版本均启用搜索", () => {
    expect(isWorkflowFlatSelectSearchable({ key: "intro_version" })).toBe(true);
    expect(isWorkflowFlatSelectSearchable({ key: "fix_version" })).toBe(true);
  });

  test("版本字段搜索框占位提示为版本关键字", () => {
    expect(workflowFlatSelectSearchPlaceholder({ key: "intro_version" })).toBe("搜索版本关键字");
    expect(workflowFlatSelectSearchPlaceholder({ key: "fix_version" })).toBe("搜索版本关键字");
  });
});
