import {
  filterProblemFillComponentOptions,
  PROBLEM_FILL_KERNEL_COMPONENT,
  PROBLEM_FILL_PUBLIC_CLOUD_PRODUCT_LINE,
} from "../../../frontend/modules/constants/workflow.js";

describe("problem fill component options", () => {
  const all = ["内核问题", "管控问题"];

  test("public cloud product line only allows kernel component", () => {
    expect(
      filterProblemFillComponentOptions(all, PROBLEM_FILL_PUBLIC_CLOUD_PRODUCT_LINE),
    ).toEqual([PROBLEM_FILL_KERNEL_COMPONENT]);
  });

  test("other product lines keep both options", () => {
    expect(filterProblemFillComponentOptions(all, "混合云（HCS）")).toEqual(all);
    expect(filterProblemFillComponentOptions(all, "")).toEqual(all);
  });
});
