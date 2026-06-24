import {
  filterProblemReviewIssueTypeJudgeOptions,
  PROBLEM_REVIEW_ROTATION_ISSUE_TYPES,
  PROBLEM_REVIEW_SPECIAL_ROTATION_HANDLE_MODE,
  HANDLE_MODE_ROUTE,
} from "../../../frontend/modules/constants/workflow.js";

describe("problem review special rotation", () => {
  const all = [...PROBLEM_REVIEW_ROTATION_ISSUE_TYPES, "已停用选项"];

  test("HANDLE_MODE_ROUTE includes 提交专项轮值表", () => {
    expect(HANDLE_MODE_ROUTE.problem_review["提交专项轮值表"]).toBe("problem_review");
  });

  test("提交专项轮值表时保留专项与管控问题类型", () => {
    expect(
      filterProblemReviewIssueTypeJudgeOptions(all, PROBLEM_REVIEW_SPECIAL_ROTATION_HANDLE_MODE)
    ).toEqual(PROBLEM_REVIEW_ROTATION_ISSUE_TYPES);
  });

  test("其他处理方式不筛选选项列表", () => {
    expect(filterProblemReviewIssueTypeJudgeOptions(all, "提交其他运维审核")).toEqual(all);
  });
});
