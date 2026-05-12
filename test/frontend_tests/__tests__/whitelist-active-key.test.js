/**
 * activeKey → 权限白名单字段映射（补丁管理页签）
 * 与 frontend/modules/utils/normalize.js 中 getWhitelistKeyByActiveKey 保持一致。
 */

function getWhitelistKeyByActiveKey(activeKey) {
  const key = String(activeKey || "");
  if (key === "patch:list") return "patch_manage";
  return "";
}

describe("getWhitelistKeyByActiveKey (patch:list)", () => {
  test("patch:list 映射到 patch_manage", () => {
    expect(getWhitelistKeyByActiveKey("patch:list")).toBe("patch_manage");
  });
});
