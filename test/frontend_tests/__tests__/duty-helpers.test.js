/**
 * 前端值班页面辅助函数单元测试
 * 对应模块：frontend/modules/pages/duty.js
 */

function dutyRosterAnchorValid(id) {
  if (!id) return false;
  if (DUTY_ROSTER_SECTIONS.some((s) => s.id === id)) return true;
  return DUTY_SPECIAL_ROTATION_SUBTABLES.some((s) => s.anchorId === id);
}

const DUTY_ROSTER_SECTIONS = [
  { id: "duty-kernel-rotation", title: "内核值班" },
  { id: "duty-control-rotation", title: "管控值班" },
  { id: "duty-special-rotation", title: "专项排班" },
  { id: "duty-site-on-call", title: "现场值班" },
  { id: "duty-rl-on-call", title: "RL值班" },
  { id: "duty-holiday-config", title: "节假日配置" },
];

const DUTY_SPECIAL_ROTATION_SUBTABLES = [
  { anchorId: "duty-special-dbcheck", title: "DB巡检" },
  { anchorId: "duty-special-backup", title: "备份检查" },
];

function dutyFieldParsePath(path) {
  return String(path || "")
    .split(".")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function dutyFieldGetParentArray(tree, parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return tree;
  let arr = tree;
  for (let d = 0; d < parts.length - 1; d++) {
    const n = arr[parts[d]];
    if (!n) return null;
    if (!Array.isArray(n.children)) n.children = [];
    arr = n.children;
  }
  return arr;
}

function dutyFieldNodeAtPath(tree, parts) {
  const parent = dutyFieldGetParentArray(tree, parts);
  if (!parent) return null;
  return parent[parts[parts.length - 1]] ?? null;
}

function dutyCascaderColumnsData(tree, tempPath) {
  const columns = [];
  let cur = Array.isArray(tree) ? tree : [];
  let d = 0;
  for (;;) {
    if (!cur.length) break;
    columns.push({ depth: d, list: cur, activeLabel: tempPath[d] ?? null });
    const label = tempPath[d];
    if (label == null || label === "") break;
    const node = cur.find((n) => String(n.label || "").trim() === label);
    if (!node || !Array.isArray(node.children) || !node.children.length) break;
    cur = node.children;
    d++;
  }
  return columns;
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function dutyCascaderColumnHtml(depth, nodes, activeLabel) {
  const items = (nodes || [])
    .map((node) => {
      const lab = String(node.label || "").trim();
      if (!lab) return "";
      const ch = Array.isArray(node.children) && node.children.length > 0;
      const active = lab === activeLabel ? " is-active" : "";
      const arrow = ch ? '<span class="cascade-cascader-arrow" aria-hidden="true">▸</span>' : "";
      return `<button type="button" class="cascade-cascader-item${active}" data-depth="${depth}" data-label="${escapeAttr(lab)}" data-has-children="${ch ? "1" : "0"}">${escapeHtml(lab)}${arrow}</button>`;
    })
    .filter(Boolean)
    .join("");
  return `<div class="cascade-cascader-col" role="listbox" data-col-depth="${depth}">${items}</div>`;
}

function getDutyAssignmentsForDay(kind, dateKey, dutyAssignments) {
  const bucket = dutyAssignments[kind];
  if (!bucket || !dateKey) return [];
  const arr = bucket[dateKey];
  return Array.isArray(arr) ? arr : [];
}

describe("dutyRosterAnchorValid", () => {
  test("空值返回false", () => {
    expect(dutyRosterAnchorValid("")).toBe(false);
    expect(dutyRosterAnchorValid(null)).toBe(false);
    expect(dutyRosterAnchorValid(undefined)).toBe(false);
  });

  test("有效section id返回true", () => {
    expect(dutyRosterAnchorValid("duty-kernel-rotation")).toBe(true);
    expect(dutyRosterAnchorValid("duty-control-rotation")).toBe(true);
  });

  test("有效专项子表anchorId返回true", () => {
    expect(dutyRosterAnchorValid("duty-special-dbcheck")).toBe(true);
    expect(dutyRosterAnchorValid("duty-special-backup")).toBe(true);
  });

  test("无效id返回false", () => {
    expect(dutyRosterAnchorValid("nonexistent")).toBe(false);
    expect(dutyRosterAnchorValid("random-id")).toBe(false);
  });
});

describe("dutyFieldParsePath", () => {
  test("null和undefined返回[0]", () => {
    expect(dutyFieldParsePath(null)).toEqual([0]);
    expect(dutyFieldParsePath(undefined)).toEqual([0]);
  });

  test("空字符串返回[0]", () => {
    expect(dutyFieldParsePath("")).toEqual([0]);
  });

  test("单级路径", () => {
    expect(dutyFieldParsePath("0")).toEqual([0]);
    expect(dutyFieldParsePath("3")).toEqual([3]);
  });

  test("多级路径", () => {
    expect(dutyFieldParsePath("0.1.2")).toEqual([0, 1, 2]);
  });

  test("过滤非整数和负数", () => {
    expect(dutyFieldParsePath("0.abc.2")).toEqual([0, 2]);
    expect(dutyFieldParsePath("0.-1.2")).toEqual([0, 2]);
  });
});

describe("dutyFieldGetParentArray", () => {
  const tree = [
    { label: "A", children: [{ label: "A1" }, { label: "A2" }] },
    { label: "B" },
  ];

  test("空parts返回null", () => {
    expect(dutyFieldGetParentArray(tree, [])).toBe(null);
  });

  test("单级parts返回tree本身", () => {
    expect(dutyFieldGetParentArray(tree, [0])).toBe(tree);
  });

  test("多级parts返回子数组", () => {
    const result = dutyFieldGetParentArray(tree, [0, 1]);
    expect(result).toEqual([{ label: "A1" }, { label: "A2" }]);
  });

  test("无效路径返回null", () => {
    expect(dutyFieldGetParentArray(tree, [5, 0])).toBe(null);
  });
});

describe("dutyFieldNodeAtPath", () => {
  const tree = [
    { label: "A", children: [{ label: "A1" }, { label: "A2" }] },
    { label: "B" },
  ];

  test("返回正确节点", () => {
    expect(dutyFieldNodeAtPath(tree, [0])).toEqual({ label: "A", children: [{ label: "A1" }, { label: "A2" }] });
    expect(dutyFieldNodeAtPath(tree, [0, 1])).toEqual({ label: "A2" });
  });

  test("无效路径返回null", () => {
    expect(dutyFieldNodeAtPath(tree, [5])).toBe(null);
  });
});

describe("dutyCascaderColumnsData", () => {
  const tree = [
    { label: "内核", children: [{ label: "子项1" }, { label: "子项2" }] },
    { label: "管控" },
  ];

  test("空树返回空数组", () => {
    expect(dutyCascaderColumnsData([], [])).toEqual([]);
  });

  test("无选中路径返回第一列", () => {
    const result = dutyCascaderColumnsData(tree, []);
    expect(result).toHaveLength(1);
    expect(result[0].depth).toBe(0);
    expect(result[0].activeLabel).toBe(null);
  });

  test("选中路径返回多列", () => {
    const result = dutyCascaderColumnsData(tree, ["内核"]);
    expect(result).toHaveLength(2);
    expect(result[0].activeLabel).toBe("内核");
    expect(result[1].depth).toBe(1);
  });
});

describe("dutyCascaderColumnHtml", () => {
  test("空节点返回空列容器", () => {
    const html = dutyCascaderColumnHtml(0, [], null);
    expect(html).toContain("cascade-cascader-col");
    expect(html).not.toContain("cascade-cascader-item");
  });

  test("有节点返回按钮", () => {
    const nodes = [{ label: "测试", children: [] }];
    const html = dutyCascaderColumnHtml(0, nodes, null);
    expect(html).toContain("测试");
    expect(html).toContain("cascade-cascader-item");
  });

  test("选中项添加is-active类", () => {
    const nodes = [{ label: "选中项", children: [] }];
    const html = dutyCascaderColumnHtml(0, nodes, "选中项");
    expect(html).toContain("is-active");
  });

  test("有子节点显示箭头", () => {
    const nodes = [{ label: "父级", children: [{ label: "子级" }] }];
    const html = dutyCascaderColumnHtml(0, nodes, null);
    expect(html).toContain("cascade-cascader-arrow");
  });
});

describe("getDutyAssignmentsForDay", () => {
  const dutyAssignments = {
    kernel: {
      "2025-01-01": [{ account: "user1", display_name: "用户1" }],
      "2025-01-02": [{ account: "user2", display_name: "用户2" }],
    },
    control: {
      "2025-01-01": [{ account: "user3", display_name: "用户3" }],
    },
  };

  test("返回指定日期的排班", () => {
    const result = getDutyAssignmentsForDay("kernel", "2025-01-01", dutyAssignments);
    expect(result).toEqual([{ account: "user1", display_name: "用户1" }]);
  });

  test("无排班返回空数组", () => {
    const result = getDutyAssignmentsForDay("kernel", "2025-01-03", dutyAssignments);
    expect(result).toEqual([]);
  });

  test("无kind返回空数组", () => {
    const result = getDutyAssignmentsForDay("nonexistent", "2025-01-01", dutyAssignments);
    expect(result).toEqual([]);
  });

  test("空dateKey返回空数组", () => {
    const result = getDutyAssignmentsForDay("kernel", "", dutyAssignments);
    expect(result).toEqual([]);
  });
});
