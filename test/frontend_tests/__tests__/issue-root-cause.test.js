import {
  getRootCauseCategoriesForIssueType,
  mergeIssueRootCauseItemsFromApi,
  validateIssueRootCauseDraft,
} from "../../../frontend/modules/constants/issue-root-cause.js";

describe("issue root cause linkage", () => {
  test("getRootCauseCategoriesForIssueType returns categories for selected issue type", () => {
    const field = {
      options_by_parent: {
        parent_field: "issue_type",
        map: {
          慢: ["配置错误", "代码缺陷"],
          满: ["存储管理"],
        },
      },
      options: ["配置错误", "代码缺陷", "存储管理"],
    };
    expect(getRootCauseCategoriesForIssueType(field, "慢")).toEqual(["配置错误", "代码缺陷"]);
    expect(getRootCauseCategoriesForIssueType(field, "满")).toEqual(["存储管理"]);
    expect(getRootCauseCategoriesForIssueType(field, "错")).toEqual([]);
  });

  test("validateIssueRootCauseDraft rejects empty and duplicate types", () => {
    expect(validateIssueRootCauseDraft([{ issue_type: "慢", categories: [] }])).toEqual({ ok: true });
    expect(validateIssueRootCauseDraft([{ issue_type: "", categories: [] }]).ok).toBe(false);
    expect(
      validateIssueRootCauseDraft([
        { issue_type: "慢", categories: [] },
        { issue_type: "慢", categories: [] },
      ]).ok
    ).toBe(false);
  });

  test("mergeIssueRootCauseItemsFromApi aligns with issue_types order", () => {
    const items = mergeIssueRootCauseItemsFromApi({
      issue_types: ["慢", "满"],
      items: [
        { issue_type: "满", categories: ["存储管理"] },
        { issue_type: "慢", categories: ["代码缺陷"] },
      ],
    });
    expect(items).toEqual([
      { issue_type: "慢", categories: ["代码缺陷"] },
      { issue_type: "满", categories: ["存储管理"] },
    ]);
  });
});
