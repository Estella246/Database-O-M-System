/**
 * 从问题填写节点起单的创建弹窗不展示「保存」按钮。
 */

function shouldHideSaveButtonInCreateModal(nodeKey) {
  return String(nodeKey || "").trim() === "problem_fill";
}

describe("create ticket modal hide save button", () => {
  test("问题填写起单时隐藏保存", () => {
    expect(shouldHideSaveButtonInCreateModal("problem_fill")).toBe(true);
  });

  test("运维分析起单时仍展示保存", () => {
    expect(shouldHideSaveButtonInCreateModal("ops_analysis")).toBe(false);
    expect(shouldHideSaveButtonInCreateModal("")).toBe(false);
  });
});
