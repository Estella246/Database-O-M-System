/**
 * 运维工具广场白名单：策略表展示与侧栏可见性须与运行时 getWhitelistLevel 一致。
 */

const PERMISSION_LEVEL_RANK = { hidden: 0, readonly: 1, editable: 2 };

const PERMISSION_DEFAULT_HIDDEN_KEYS = new Set([
  "ai_assistant",
  "ai_assistant_template_edit",
  "ai_assistant_config",
  "ai_export",
  "ai_export_template",
  "oncall_eva",
  "oncall_eva_review",
  "monthly_report",
  "requirement_export",
]);

function getWhitelistLevel(fieldKey, whitelist) {
  const raw = String(whitelist?.[fieldKey] || "").trim();
  if (Object.prototype.hasOwnProperty.call(PERMISSION_LEVEL_RANK, raw)) return raw;
  if (PERMISSION_DEFAULT_HIDDEN_KEYS.has(fieldKey)) return "hidden";
  return "readonly";
}

function whitelistAllows(fieldKey, minLevel, whitelist) {
  if (!fieldKey) return true;
  const need = minLevel || "readonly";
  return PERMISSION_LEVEL_RANK[getWhitelistLevel(fieldKey, whitelist)] >= PERMISSION_LEVEL_RANK[need];
}

function getWhitelistKeyByActiveKey(activeKey) {
  if (String(activeKey || "") === "tool:plaza") return "tool_plaza_list";
  return "";
}

function isActiveKeyVisible(activeKey, whitelist) {
  const fieldKey = getWhitelistKeyByActiveKey(activeKey);
  if (!fieldKey) return true;
  return whitelistAllows(fieldKey, "readonly", whitelist);
}

describe("tool_plaza_list 默认策略", () => {
  test("未配置时默认只读（展示），不是 hidden", () => {
    expect(getWhitelistLevel("tool_plaza_list", {})).toBe("readonly");
  });

  test("未配置时侧栏入口可见", () => {
    expect(whitelistAllows("tool_plaza_list", "readonly", {})).toBe(true);
    expect(isActiveKeyVisible("tool:plaza", {})).toBe(true);
  });
});

describe("tool_plaza_list 显式 hidden", () => {
  test("配置 hidden 后入口不可见", () => {
    const wl = { tool_plaza_list: "hidden" };
    expect(whitelistAllows("tool_plaza_list", "readonly", wl)).toBe(false);
    expect(isActiveKeyVisible("tool:plaza", wl)).toBe(false);
  });
});

describe("tool_plaza_publish 与 tool_plaza_list 区分", () => {
  test("仅隐藏发布按钮时广场仍可见", () => {
    const wl = { tool_plaza_list: "readonly", tool_plaza_publish: "hidden" };
    expect(whitelistAllows("tool_plaza_list", "readonly", wl)).toBe(true);
    expect(whitelistAllows("tool_plaza_publish", "readonly", wl)).toBe(false);
  });
});

function canEditToolPlazaItem(item, whitelist, account) {
  if (item && typeof item.can_edit === "boolean") return item.can_edit;
  const level = getWhitelistLevel("tool_plaza_edit", whitelist);
  if (level === "hidden") return false;
  if (level === "editable") return true;
  const pubId = String(item?.publisher_id || "").trim();
  return Boolean(pubId && pubId === String(account || "").trim());
}

describe("tool_plaza_edit 本人与全部", () => {
  test("editable 可编辑他人发布", () => {
    const wl = { tool_plaza_edit: "editable" };
    expect(canEditToolPlazaItem({ publisher_id: "other" }, wl, "me")).toBe(true);
  });

  test("readonly 仅可编辑本人发布", () => {
    const wl = { tool_plaza_edit: "readonly" };
    expect(canEditToolPlazaItem({ publisher_id: "me" }, wl, "me")).toBe(true);
    expect(canEditToolPlazaItem({ publisher_id: "other" }, wl, "me")).toBe(false);
  });

  test("hidden 不可编辑", () => {
    const wl = { tool_plaza_edit: "hidden" };
    expect(canEditToolPlazaItem({ publisher_id: "me" }, wl, "me")).toBe(false);
  });

  test("优先使用接口返回的 can_edit", () => {
    expect(canEditToolPlazaItem({ can_edit: false, publisher_id: "me" }, { tool_plaza_edit: "editable" }, "me")).toBe(false);
  });
});
