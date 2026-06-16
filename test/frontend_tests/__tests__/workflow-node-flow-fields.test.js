/**
 * 非当前节点隐藏流转字段（处理方式 / 下一步处理人）
 */

function shouldRenderFlowFields(isCurrentNode) {
  return !!isCurrentNode;
}

function buildSubmitValuesExcludingFlow(fields, vals, excludeFlowFields) {
  const out = {};
  fields.forEach((field) => {
    if (excludeFlowFields && (field.key === "handle_mode" || field.key === "next_handler")) return;
    out[field.key] = vals[field.key] ?? "";
  });
  return out;
}

describe("workflow node flow fields visibility", () => {
  test("当前节点展示流转字段", () => {
    expect(shouldRenderFlowFields(true)).toBe(true);
  });

  test("非当前节点隐藏流转字段", () => {
    expect(shouldRenderFlowFields(false)).toBe(false);
  });

  test("buildSubmitValues 在非当前节点排除 handle_mode 与 next_handler", () => {
    const fields = [
      { key: "issue_desc", type: "text" },
      { key: "handle_mode", type: "whitelist" },
      { key: "next_handler", type: "whitelist" },
    ];
    const vals = {
      issue_desc: "更新描述",
      handle_mode: "确认问题",
      next_handler: "张三 zhangsan",
    };
    const out = buildSubmitValuesExcludingFlow(fields, vals, true);
    expect(out.issue_desc).toBe("更新描述");
    expect(out.handle_mode).toBeUndefined();
    expect(out.next_handler).toBeUndefined();
  });

  test("buildSubmitValues 在当前节点保留流转字段", () => {
    const fields = [{ key: "handle_mode", type: "whitelist" }];
    const vals = { handle_mode: "确认问题" };
    const out = buildSubmitValuesExcludingFlow(fields, vals, false);
    expect(out.handle_mode).toBe("确认问题");
  });
});
