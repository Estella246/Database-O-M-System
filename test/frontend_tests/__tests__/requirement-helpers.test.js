/**
 * 前端需求管理/工单字段规则辅助函数单元测试
 * 对应模块：frontend/modules/pages/requirement.js
 */

function fieldVisible(field, vals) {
  if (field.key === "next_handler" && String(vals.handle_mode || "") === "问题解决关闭") {
    return false;
  }
  const c = field.constraints || {};
  const rules = c.visible_when_all;
  if (!rules || !rules.length) return true;
  return rules.every((r) => {
    const v = vals[r.field];
    return (r.values || []).includes(v);
  });
}

function matchesRequiredIf(requiredIf, vals) {
  if (!requiredIf || typeof requiredIf !== "object") return false;
  return Object.entries(requiredIf).every(([depKey, expected]) => {
    const actual = vals[depKey];
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

function optionalWhenAllMatches(c, vals) {
  const rules = c.optional_when_all;
  if (!rules || !rules.length) return false;
  return rules.every((r) => (r.values || []).includes(vals[r.field]));
}

function optionalWhenAnyMatches(c, vals) {
  const rules = c.optional_when_any;
  if (!rules || !rules.length) return false;
  return rules.some((r) => (r.values || []).includes(vals[r.field]));
}

function fieldEffectiveRequired(field, vals) {
  const c = field.constraints || {};
  if (!fieldVisible(field, vals)) return false;
  if (optionalWhenAnyMatches(c, vals) || optionalWhenAllMatches(c, vals)) return false;
  if (c.required_when_visible) return true;
  if (c.required_if && Object.keys(c.required_if).length) {
    return matchesRequiredIf(c.required_if, vals);
  }
  return !!field.required;
}

describe("fieldVisible", () => {
  test("next_handler在问题解决关闭时隐藏", () => {
    expect(fieldVisible({ key: "next_handler" }, { handle_mode: "问题解决关闭" })).toBe(false);
  });

  test("next_handler在其他模式下可见", () => {
    expect(fieldVisible({ key: "next_handler" }, { handle_mode: "转派" })).toBe(true);
  });

  test("无约束默认可见", () => {
    expect(fieldVisible({ key: "title" }, {})).toBe(true);
  });

  test("visible_when_all全部匹配时可见", () => {
    const field = {
      key: "detail",
      constraints: { visible_when_all: [{ field: "type", values: ["bug", "issue"] }] },
    };
    expect(fieldVisible(field, { type: "bug" })).toBe(true);
  });

  test("visible_when_all不匹配时隐藏", () => {
    const field = {
      key: "detail",
      constraints: { visible_when_all: [{ field: "type", values: ["bug"] }] },
    };
    expect(fieldVisible(field, { type: "feature" })).toBe(false);
  });
});

describe("matchesRequiredIf", () => {
  test("空条件返回false", () => {
    expect(matchesRequiredIf(null, {})).toBe(false);
    expect(matchesRequiredIf(undefined, {})).toBe(false);
  });

  test("单条件匹配", () => {
    expect(matchesRequiredIf({ type: "bug" }, { type: "bug" })).toBe(true);
  });

  test("单条件不匹配", () => {
    expect(matchesRequiredIf({ type: "bug" }, { type: "feature" })).toBe(false);
  });

  test("多条件全部匹配", () => {
    expect(matchesRequiredIf({ type: "bug", severity: "高" }, { type: "bug", severity: "高" })).toBe(true);
  });

  test("多条件部分匹配返回false", () => {
    expect(matchesRequiredIf({ type: "bug", severity: "高" }, { type: "bug", severity: "低" })).toBe(false);
  });

  test("数组期望值", () => {
    expect(matchesRequiredIf({ type: ["bug", "issue"] }, { type: "bug" })).toBe(true);
    expect(matchesRequiredIf({ type: ["bug", "issue"] }, { type: "feature" })).toBe(false);
  });
});

describe("optionalWhenAllMatches", () => {
  test("无规则返回false", () => {
    expect(optionalWhenAllMatches({}, {})).toBe(false);
  });

  test("全部匹配返回true", () => {
    const c = { optional_when_all: [{ field: "status", values: ["draft"] }] };
    expect(optionalWhenAllMatches(c, { status: "draft" })).toBe(true);
  });

  test("不匹配返回false", () => {
    const c = { optional_when_all: [{ field: "status", values: ["draft"] }] };
    expect(optionalWhenAllMatches(c, { status: "closed" })).toBe(false);
  });
});

describe("optionalWhenAnyMatches", () => {
  test("无规则返回false", () => {
    expect(optionalWhenAnyMatches({}, {})).toBe(false);
  });

  test("任一匹配返回true", () => {
    const c = { optional_when_any: [{ field: "status", values: ["draft"] }, { field: "type", values: ["bug"] }] };
    expect(optionalWhenAnyMatches(c, { status: "draft", type: "feature" })).toBe(true);
  });

  test("全不匹配返回false", () => {
    const c = { optional_when_any: [{ field: "status", values: ["draft"] }, { field: "type", values: ["bug"] }] };
    expect(optionalWhenAnyMatches(c, { status: "closed", type: "feature" })).toBe(false);
  });
});

describe("fieldEffectiveRequired", () => {
  test("不可见字段不需要必填", () => {
    const field = { key: "next_handler", required: true };
    expect(fieldEffectiveRequired(field, { handle_mode: "问题解决关闭" })).toBe(false);
  });

  test("optional_when_any匹配时非必填", () => {
    const field = {
      key: "note",
      required: true,
      constraints: { optional_when_any: [{ field: "status", values: ["draft"] }] },
    };
    expect(fieldEffectiveRequired(field, { status: "draft" })).toBe(false);
  });

  test("required_when_visible为true时必填", () => {
    const field = {
      key: "title",
      required: false,
      constraints: { required_when_visible: true },
    };
    expect(fieldEffectiveRequired(field, {})).toBe(true);
  });

  test("required_if匹配时必填", () => {
    const field = {
      key: "reason",
      required: false,
      constraints: { required_if: { type: "bug" } },
    };
    expect(fieldEffectiveRequired(field, { type: "bug" })).toBe(true);
  });

  test("required_if不匹配时非必填", () => {
    const field = {
      key: "reason",
      required: false,
      constraints: { required_if: { type: "bug" } },
    };
    expect(fieldEffectiveRequired(field, { type: "feature" })).toBe(false);
  });

  test("has_core_stack为是时Core堆栈文字版必填", () => {
    const field = {
      key: "core_stack_text",
      required: false,
      constraints: { required_if: { has_core_stack: "是" } },
    };
    expect(fieldEffectiveRequired(field, { has_core_stack: "是" })).toBe(true);
    expect(fieldEffectiveRequired(field, { has_core_stack: "否" })).toBe(false);
    expect(fieldEffectiveRequired(field, { has_core_stack: "不涉及" })).toBe(false);
  });

  test("问题类型为错或coredump时报错信息归档必填", () => {
    const field = {
      key: "error_archive_text",
      required: false,
      constraints: { required_if: { issue_type: ["错", "coredump"] } },
    };
    expect(fieldEffectiveRequired(field, { issue_type: "错" })).toBe(true);
    expect(fieldEffectiveRequired(field, { issue_type: "coredump" })).toBe(true);
    expect(fieldEffectiveRequired(field, { issue_type: "慢" })).toBe(false);
    expect(fieldEffectiveRequired(field, {})).toBe(false);
  });

  test("运维闭环协同处理人选是时可见且必填", () => {
    const field = {
      key: "collaborator",
      required: false,
      constraints: {
        visible_when_all: [{ field: "has_collaborator", values: ["是"] }],
        required_when_visible: true,
      },
    };
    expect(fieldVisible(field, { has_collaborator: "是" })).toBe(true);
    expect(fieldEffectiveRequired(field, { has_collaborator: "是" })).toBe(true);
    expect(fieldVisible(field, { has_collaborator: "否" })).toBe(false);
    expect(fieldEffectiveRequired(field, { has_collaborator: "否" })).toBe(false);
  });

  test("运维闭环选输出问题报告时上传字段可见且必填", () => {
    const field = {
      key: "problem_report",
      required: false,
      constraints: {
        visible_when_all: [{ field: "output_problem_report", values: ["是"] }],
        required_when_visible: true,
      },
    };
    expect(fieldVisible(field, { output_problem_report: "是" })).toBe(true);
    expect(fieldEffectiveRequired(field, { output_problem_report: "是" })).toBe(true);
    expect(fieldVisible(field, { output_problem_report: "否" })).toBe(false);
    expect(fieldEffectiveRequired(field, { output_problem_report: "否" })).toBe(false);
  });

  test("默认按field.required判断", () => {
    expect(fieldEffectiveRequired({ key: "a", required: true }, {})).toBe(true);
    expect(fieldEffectiveRequired({ key: "a", required: false }, {})).toBe(false);
  });
});
