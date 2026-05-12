/**
 * 仅管理员可见入口（运维效率 / 报告生成）的判定逻辑单元测试。
 * 复制 frontend/modules/core/auth.js 内的判定常量与函数，避免在 jest-node 下做 ESM 解析。
 */

const ADMIN_ROLE_CODES = new Set(["admin", "管理员", "PL"]);
const ADMIN_ONLY_ACTIVE_KEYS = new Set(["oncall:eva", "report:generate"]);

function isAdminRole(roleCode) {
  return ADMIN_ROLE_CODES.has(String(roleCode || ""));
}

/**
 * 简化版 isActiveKeyVisible：只关心 admin-only 闸口，不复刻完整白名单逻辑。
 * 对应 frontend/modules/core/auth.js 中的同名函数。
 */
function isActiveKeyVisible(activeKey, roleCode) {
  if (ADMIN_ONLY_ACTIVE_KEYS.has(activeKey) && !isAdminRole(roleCode)) return false;
  return true;
}

describe("admin-only 入口判定", () => {
  describe("isAdminRole", () => {
    test.each(["admin", "管理员", "PL"]) ("'%s' 视为管理员", (code) => {
      expect(isAdminRole(code)).toBe(true);
    });

    test.each(["普通人员", "TAC提单", "", null, undefined, "Admin"]) ("'%s' 不是管理员", (code) => {
      expect(isAdminRole(code)).toBe(false);
    });
  });

  describe("isActiveKeyVisible", () => {
    test("管理员可见 oncall:eva", () => {
      expect(isActiveKeyVisible("oncall:eva", "管理员")).toBe(true);
    });

    test("管理员可见 report:generate", () => {
      expect(isActiveKeyVisible("report:generate", "admin")).toBe(true);
    });

    test("普通人员不可见 oncall:eva", () => {
      expect(isActiveKeyVisible("oncall:eva", "普通人员")).toBe(false);
    });

    test("普通人员不可见 report:generate", () => {
      expect(isActiveKeyVisible("report:generate", "普通人员")).toBe(false);
    });

    test("非 admin-only 入口不受角色限制", () => {
      expect(isActiveKeyVisible("home", "普通人员")).toBe(true);
      expect(isActiveKeyVisible("report:issue", "普通人员")).toBe(true);
      expect(isActiveKeyVisible("report:archive", "普通人员")).toBe(true);
    });
  });
});
