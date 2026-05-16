/**
 * 「运维效率 / 月度报告」入口可见性判定单元测试。
 *
 * 这两个入口已从 hardcoded admin 闸口改为完全由权限策略白名单驱动：
 *   - oncall:eva                → oncall_eva
 *   - report:issue/generate/archive → monthly_report
 *   - 两者均在 PERMISSION_DEFAULT_HIDDEN_KEYS 中，未配置时默认 hidden。
 *
 * 复制 frontend 内的纯函数/常量，避免 jest-node 下做 ESM 解析。
 */

const PERMISSION_LEVEL_RANK = { hidden: 0, readonly: 1, editable: 2 };

const PERMISSION_DEFAULT_HIDDEN_KEYS = new Set([
  "ai_assistant",
  "ai_assistant_template_edit",
  "ai_assistant_config",
  "oncall_eva",
  "oncall_eva_review",
  "monthly_report",
]);

function getWhitelistKeyByActiveKey(activeKey) {
  const key = String(activeKey || "");
  if (key === "oncall:eva") return "oncall_eva";
  if (key === "report:issue" || key === "report:generate" || key === "report:archive") return "monthly_report";
  return "";
}

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

function isActiveKeyVisible(activeKey, whitelist) {
  const fieldKey = getWhitelistKeyByActiveKey(activeKey);
  if (!fieldKey) return true;
  return whitelistAllows(fieldKey, "readonly", whitelist);
}

describe("oncall:eva / report:* activeKey → 白名单字段映射", () => {
  test("oncall:eva → oncall_eva", () => {
    expect(getWhitelistKeyByActiveKey("oncall:eva")).toBe("oncall_eva");
  });

  test.each(["report:issue", "report:generate", "report:archive"])(
    "%s → monthly_report",
    (key) => {
      expect(getWhitelistKeyByActiveKey(key)).toBe("monthly_report");
    },
  );
});

describe("默认 hidden：未配置时不可见", () => {
  test("oncall:eva 默认不可见", () => {
    expect(isActiveKeyVisible("oncall:eva", {})).toBe(false);
  });

  test.each(["report:issue", "report:generate", "report:archive"])(
    "%s 默认不可见",
    (key) => {
      expect(isActiveKeyVisible(key, {})).toBe(false);
    },
  );
});

describe("白名单显式配置覆盖默认", () => {
  test("oncall_eva=readonly 时 oncall:eva 可见", () => {
    expect(isActiveKeyVisible("oncall:eva", { oncall_eva: "readonly" })).toBe(true);
  });

  test("oncall_eva=editable 时 oncall:eva 可见", () => {
    expect(isActiveKeyVisible("oncall:eva", { oncall_eva: "editable" })).toBe(true);
  });

  test("oncall_eva=hidden 时 oncall:eva 不可见", () => {
    expect(isActiveKeyVisible("oncall:eva", { oncall_eva: "hidden" })).toBe(false);
  });

  test.each(["report:issue", "report:generate", "report:archive"])(
    "monthly_report=readonly 时 %s 可见",
    (key) => {
      expect(isActiveKeyVisible(key, { monthly_report: "readonly" })).toBe(true);
    },
  );

  test.each(["report:issue", "report:generate", "report:archive"])(
    "monthly_report=hidden 时 %s 不可见",
    (key) => {
      expect(isActiveKeyVisible(key, { monthly_report: "hidden" })).toBe(false);
    },
  );
});

describe("非受控入口不受影响", () => {
  test("home 在空白名单下默认可见", () => {
    expect(isActiveKeyVisible("home", {})).toBe(true);
  });
});
