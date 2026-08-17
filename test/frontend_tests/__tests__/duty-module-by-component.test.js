import {
  filterDutyFieldTreeByComponent,
  dutyModulePathAllowedForComponent,
  PROBLEM_FILL_CONTROL_COMPONENT,
  PROBLEM_FILL_KERNEL_COMPONENT,
  CONTROL_COMPONENT_DUTY_L1_LABELS,
} from "../../../frontend/modules/constants/workflow.js";

describe("duty module filter by component", () => {
  const tree = [
    { label: "SQL引擎", children: [{ label: "驱动", children: [] }] },
    { label: "管控问题", children: [{ label: "管控子模块", children: [] }] },
    { label: "管控", children: [{ label: "旧管控子", children: [] }] },
  ];

  test("control component keeps 管控问题 root preferentially", () => {
    const filtered = filterDutyFieldTreeByComponent(tree, PROBLEM_FILL_CONTROL_COMPONENT);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe("管控问题");
  });

  test("falls back to 管控 when 管控问题 root missing", () => {
    const noControlProblem = tree.filter((n) => n.label !== "管控问题");
    const filtered = filterDutyFieldTreeByComponent(noControlProblem, PROBLEM_FILL_CONTROL_COMPONENT);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe("管控");
  });

  test("kernel or empty component keeps full tree", () => {
    expect(filterDutyFieldTreeByComponent(tree, PROBLEM_FILL_KERNEL_COMPONENT)).toEqual(tree);
    expect(filterDutyFieldTreeByComponent(tree, "")).toEqual(tree);
  });

  test("path allowed under control L1 labels", () => {
    expect(dutyModulePathAllowedForComponent("管控问题/管控子模块", PROBLEM_FILL_CONTROL_COMPONENT)).toBe(
      true,
    );
    expect(dutyModulePathAllowedForComponent("管控/旧管控子", PROBLEM_FILL_CONTROL_COMPONENT)).toBe(true);
    expect(dutyModulePathAllowedForComponent("SQL引擎/驱动", PROBLEM_FILL_CONTROL_COMPONENT)).toBe(false);
    expect(dutyModulePathAllowedForComponent("", PROBLEM_FILL_CONTROL_COMPONENT)).toBe(true);
    expect(dutyModulePathAllowedForComponent("SQL引擎/驱动", PROBLEM_FILL_KERNEL_COMPONENT)).toBe(true);
  });

  test("control L1 labels constant order", () => {
    expect(CONTROL_COMPONENT_DUTY_L1_LABELS[0]).toBe("管控问题");
  });
});
