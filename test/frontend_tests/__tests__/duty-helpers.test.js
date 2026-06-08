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

const DUTY_FIELD_CASCADE_SEP = "/";

function dutyCascaderCollectAllPaths(tree, prefix = []) {
  const paths = [];
  const nodes = Array.isArray(tree) ? tree : [];
  for (const node of nodes) {
    const lab = String(node.label || "").trim();
    if (!lab) continue;
    const parts = [...prefix, lab];
    paths.push(parts.join(DUTY_FIELD_CASCADE_SEP));
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length) paths.push(...dutyCascaderCollectAllPaths(children, parts));
  }
  return paths;
}

function dutyCascaderPathMatchesKeyword(path, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  const txt = String(path || "").trim().toLowerCase();
  if (!txt) return false;
  if (txt.includes(kw)) return true;
  const tokens = kw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return txt.includes(kw);
  return tokens.every((t) => txt.includes(t));
}

function dutyCascaderSearchPanelHtml(tree, keyword, selectedPath = "") {
  const kw = String(keyword || "").trim();
  const all = dutyCascaderCollectAllPaths(tree);
  const matched = kw ? all.filter((p) => dutyCascaderPathMatchesKeyword(p, kw)) : [];
  if (!matched.length) {
    return `<div class="cascade-cascader-search-results"><div class="cascade-cascader-empty">${kw ? "无匹配项" : ""}</div></div>`;
  }
  const active = String(selectedPath || "").trim();
  const items = matched
    .map((path) => {
      const sel = path === active ? " is-active" : "";
      return `<button type="button" class="cascade-cascader-search-item${sel}" data-cascade-search-pick="${escapeAttr(path)}" tabindex="-1">${escapeHtml(path)}</button>`;
    })
    .join("");
  return `<div class="cascade-cascader-search-results" data-cascade-search-list>${items}</div>`;
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

function dutyCascaderCaptureColumnScroll(colsEl) {
  const scrollByDepth = {};
  if (!colsEl) return scrollByDepth;
  colsEl.querySelectorAll(".cascade-cascader-col").forEach((col) => {
    const depth = col.getAttribute("data-col-depth");
    if (depth != null) scrollByDepth[depth] = col.scrollTop;
  });
  return scrollByDepth;
}

function dutyCascaderRestoreColumnScroll(colsEl, scrollByDepth) {
  if (!colsEl || !scrollByDepth) return;
  colsEl.querySelectorAll(".cascade-cascader-col").forEach((col) => {
    const depth = col.getAttribute("data-col-depth");
    if (depth != null && Object.prototype.hasOwnProperty.call(scrollByDepth, depth)) {
      col.scrollTop = scrollByDepth[depth];
    }
  });
}

function mockCascadeCol(depth, scrollTop = 0) {
  let top = scrollTop;
  return {
    getAttribute(name) {
      return name === "data-col-depth" ? String(depth) : null;
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(v) {
      top = v;
    },
  };
}

function mockCascadeColsEl(cols) {
  return {
    querySelectorAll(selector) {
      return selector === ".cascade-cascader-col" ? cols : [];
    },
  };
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

describe("dutyCascaderCollectAllPaths", () => {
  const tree = [
    {
      label: "SQL引擎",
      children: [
        { label: "驱动", children: [{ label: "JDBC", children: [] }] },
        { label: "优化器", children: [] },
      ],
    },
    { label: "内核", children: [] },
  ];

  test("收集全部合法路径（含中间节点）", () => {
    expect(dutyCascaderCollectAllPaths(tree)).toEqual([
      "SQL引擎",
      "SQL引擎/驱动",
      "SQL引擎/驱动/JDBC",
      "SQL引擎/优化器",
      "内核",
    ]);
  });
});

describe("dutyCascaderPathMatchesKeyword", () => {
  test("空关键字匹配全部", () => {
    expect(dutyCascaderPathMatchesKeyword("SQL引擎/驱动/JDBC", "")).toBe(true);
  });

  test("子串匹配", () => {
    expect(dutyCascaderPathMatchesKeyword("SQL引擎/驱动/JDBC", "jdbc")).toBe(true);
    expect(dutyCascaderPathMatchesKeyword("SQL引擎/驱动/JDBC", "引擎")).toBe(true);
  });

  test("空格分词须全部命中", () => {
    expect(dutyCascaderPathMatchesKeyword("SQL引擎/驱动/JDBC", "sql jdbc")).toBe(true);
    expect(dutyCascaderPathMatchesKeyword("SQL引擎/驱动/JDBC", "sql 优化器")).toBe(false);
  });
});

describe("dutyCascaderSearchPanelHtml", () => {
  const tree = [
    { label: "SQL引擎", children: [{ label: "驱动", children: [{ label: "JDBC", children: [] }] }] },
    { label: "内核", children: [] },
  ];

  test("无匹配时显示无匹配项", () => {
    const html = dutyCascaderSearchPanelHtml(tree, "不存在的关键字");
    expect(html).toContain("无匹配项");
  });

  test("有匹配时渲染可点击路径", () => {
    const html = dutyCascaderSearchPanelHtml(tree, "jdbc", "SQL引擎/驱动/JDBC");
    expect(html).toContain('data-cascade-search-pick="SQL引擎/驱动/JDBC"');
    expect(html).toContain("is-active");
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

describe("dutyCascaderCaptureColumnScroll / dutyCascaderRestoreColumnScroll", () => {
  test("捕获并按 depth 恢复各列 scrollTop", () => {
    const col0 = mockCascadeCol(0, 120);
    const col1 = mockCascadeCol(1, 40);
    const colsEl = mockCascadeColsEl([col0, col1]);
    const saved = dutyCascaderCaptureColumnScroll(colsEl);
    expect(saved).toEqual({ 0: 120, 1: 40 });

    col0.scrollTop = 0;
    col1.scrollTop = 0;
    dutyCascaderRestoreColumnScroll(colsEl, saved);
    expect(col0.scrollTop).toBe(120);
    expect(col1.scrollTop).toBe(40);
  });

  test("空容器返回空对象", () => {
    expect(dutyCascaderCaptureColumnScroll(null)).toEqual({});
    expect(dutyCascaderCaptureColumnScroll(mockCascadeColsEl([]))).toEqual({});
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

describe("duty selectable users suggest", () => {
  function dutyModalUserLabel(u) {
    const acc = String(u.account || "");
    const nm = String(u.user_name || "");
    return nm ? `${nm} (${acc})` : acc;
  }

  function personOptionMatchesKeyword(optionText, keyword) {
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return true;
    const txt = String(optionText || "").trim().toLowerCase();
    if (!txt) return false;
    if (txt.includes(kw)) return true;
    const tokens = kw.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return txt.includes(kw);
    return tokens.every((t) => txt.includes(t));
  }

  function isDutySelectableAdminUser(u) {
    const a = u?.is_active;
    if (a === false) return false;
    if (a != null && String(a).toLowerCase() === "false") return false;
    if (String(a) === "0") return false;
    return true;
  }

  function filterDutyUsersForSuggest(pool, filterText, { emptyLimit = 100 } = {}) {
    const users = Array.isArray(pool) ? pool : [];
    const qq = String(filterText || "").trim();
    if (!qq) return users.slice(0, emptyLimit);
    return users.filter((u) => {
      const acc = String(u.account || "");
      const nm = String(u.user_name || "");
      return (
        personOptionMatchesKeyword(dutyModalUserLabel(u), qq) ||
        personOptionMatchesKeyword(acc, qq) ||
        personOptionMatchesKeyword(nm, qq)
      );
    });
  }

  const pool = [
    { account: "admin01", user_name: "管理员甲", role_code: "管理员", is_active: true },
    { account: "tac01", user_name: "提单乙", role_code: "TAC提单", is_active: true },
    { account: "off01", user_name: "离职丙", role_code: "普通人员", is_active: false },
  ];

  test("includes active users from all role codes", () => {
    expect(pool.filter(isDutySelectableAdminUser).map((u) => u.account)).toEqual(["admin01", "tac01"]);
  });

  test("search matches account, name, and spaced tokens without result cap", () => {
    expect(filterDutyUsersForSuggest(pool, "tac01").map((u) => u.account)).toEqual(["tac01"]);
    expect(filterDutyUsersForSuggest(pool, "提单").map((u) => u.account)).toEqual(["tac01"]);
    expect(filterDutyUsersForSuggest(pool, "提单 tac01").map((u) => u.account)).toEqual(["tac01"]);
  });

  test("search returns all matches beyond empty-state preview limit", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      account: `user${String(i).padStart(3, "0")}`,
      user_name: `用户${i}`,
      role_code: "普通人员",
      is_active: true,
    }));
    expect(filterDutyUsersForSuggest(many, "").length).toBe(100);
    expect(filterDutyUsersForSuggest(many, "用户").length).toBe(120);
  });
});

describe("dutyUserContactPhone", () => {
  function dutyUserContactPhone(u) {
    return String(u?.contact_phone || "").trim();
  }

  test("returns trimmed contact_phone", () => {
    expect(dutyUserContactPhone({ contact_phone: " 13800000001 " })).toBe("13800000001");
  });

  test("returns empty string when missing", () => {
    expect(dutyUserContactPhone(null)).toBe("");
    expect(dutyUserContactPhone({})).toBe("");
    expect(dutyUserContactPhone({ contact_phone: "   " })).toBe("");
  });
});

describe("bindDutyRlUserCombo auto phone", () => {
  test("duty.js fills phone from contact_phone on user select", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../../frontend/modules/pages/duty.js"),
      "utf8"
    );
    expect(src).toMatch(/dutyUserContactPhone\(u\)/);
    expect(src).toMatch(/if \(phoneInput && u\) phoneInput\.value = dutyUserContactPhone\(u\)/);
    expect(src).toMatch(/getElementById\(`duty-rl-\$\{role\}-phone`\)/);
  });
});

describe("duty holiday config month nav", () => {
  test("renderDutyHolidayConfigBlock nav buttons match bindDutyRosterPage selector", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../../frontend/modules/pages/duty.js"),
      "utf8"
    );
    expect(src).toMatch(/data-duty-holiday-nav data-duty-holiday-dir="-1"/);
    expect(src).toMatch(/data-duty-holiday-nav data-duty-holiday-dir="1"/);
    expect(src).toMatch(/querySelectorAll\("\[data-duty-holiday-nav\]"\)/);
  });
});

describe("duty calendar import file selection", () => {
  function applyDutyCalendarImportFileChoice(file) {
    if (!file) return { accepted: false, fileName: "" };
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return { accepted: false, invalidFormat: true, fileName: "" };
    }
    return { accepted: true, file, fileName: file.name };
  }

  function resolveDutyCalendarImportFile(importState, fileInput) {
    return importState?.file || fileInput?.files?.[0] || null;
  }

  test("accepts xlsx and keeps file reference for submit after rerender", () => {
    const file = { name: "kernel-2026-06.xlsx" };
    const choice = applyDutyCalendarImportFileChoice(file);
    expect(choice).toEqual({ accepted: true, file, fileName: "kernel-2026-06.xlsx" });

    const importState = { file: choice.file };
    const emptyInput = { files: [] };
    expect(resolveDutyCalendarImportFile(importState, emptyInput)).toBe(file);
  });

  test("rejects non-xlsx files", () => {
    expect(applyDutyCalendarImportFileChoice({ name: "bad.csv" })).toEqual({
      accepted: false,
      invalidFormat: true,
      fileName: "",
    });
  });

  test("falls back to file input when state file missing", () => {
    const file = { name: "from-input.xlsx" };
    const input = { files: [file] };
    expect(resolveDutyCalendarImportFile({ file: null }, input)).toBe(file);
  });

  test("renderDutyCalendarImportErrorsHtml shows row level messages", () => {
    function renderDutyCalendarImportErrorsHtml(errors) {
      if (!Array.isArray(errors) || !errors.length) return "";
      return errors
        .map(
          (e) =>
            `<div class="duty-import-error-item">第${Number(e.row) || "?"}行 · ${String(e.field || "")}：${String(e.message || "")}</div>`
        )
        .join("");
    }

    const html = renderDutyCalendarImportErrorsHtml([
      { row: 3, field: "账号", message: "账号不存在：zhangsan" },
    ]);
    expect(html).toContain("第3行");
    expect(html).toContain("账号不存在：zhangsan");
  });

  test("duty import change handler updates span without requestRender", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../../frontend/modules/pages/duty.js"),
      "utf8"
    );
    const changeBlock = src.slice(
      src.indexOf('dutyImportFileInput.addEventListener("change"'),
      src.indexOf('document.getElementById("duty-import-submit-btn")')
    );
    expect(changeBlock).toMatch(/dutyImportFileNameSpan\)\s+dutyImportFileNameSpan\.textContent/);
    expect(changeBlock).not.toMatch(/requestRender\(\)/);
    expect(changeBlock).toMatch(/state\.dutyCalendarImportFile\s*=\s*result\.file/);
  });
});

describe("home duty calendar kinds", () => {
  const DUTY_CALENDAR_KINDS = ["kernel", "control", "public_cloud", "poc", "research_version"];
  const DUTY_CALENDAR_HOME_LABELS = {
    kernel: "内核值班",
    control: "管控值班",
    public_cloud: "公有云值班",
    poc: "POC值班",
    research_version: "在研版本值班",
  };

  function collectHomeDutySelfKinds(dateKey, dutyAssignments, account) {
    return DUTY_CALENDAR_KINDS.filter((kind) =>
      getDutyAssignmentsForDay(kind, dateKey, dutyAssignments).some((it) => String(it.account || "") === account)
    );
  }

  test("all calendar kinds have home labels", () => {
    DUTY_CALENDAR_KINDS.forEach((kind) => {
      expect(DUTY_CALENDAR_HOME_LABELS[kind]).toBeTruthy();
    });
  });

  test("includes public cloud and poc self assignments", () => {
    const dutyAssignments = {
      kernel: {},
      control: {},
      public_cloud: { "2026-06-04": [{ account: "alice", shift: "full" }] },
      poc: { "2026-06-04": [{ account: "alice", shift: "night" }] },
    };
    expect(collectHomeDutySelfKinds("2026-06-04", dutyAssignments, "alice")).toEqual(["public_cloud", "poc"]);
  });
});
