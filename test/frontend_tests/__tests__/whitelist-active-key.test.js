/**
 * activeKey → 权限白名单字段映射（补丁管理页签）
 * 与 frontend/modules/utils/normalize.js 中 getWhitelistKeyByActiveKey 保持一致。
 */

function getWhitelistKeyByActiveKey(activeKey) {
  const key = String(activeKey || "");
  if (key === "patch:list") return "patch_manage";
  if (key === "params:duty-field") return "params_duty_field_edit";
  if (key === "params:version") return "params_version_edit";
  if (key === "params:group-template") return "params_group_template_edit";
  if (key === "params:issue-root-cause") return "params_issue_root_cause";
  if (key === "params:llm-config") return "params_llm_config";
  if (key.startsWith("params:")) return "params_config";
  return "";
}

describe("getWhitelistKeyByActiveKey (patch:list)", () => {
  test("patch:list 映射到 patch_manage", () => {
    expect(getWhitelistKeyByActiveKey("patch:list")).toBe("patch_manage");
  });
});

describe("getWhitelistKeyByActiveKey (params sub-pages)", () => {
  test("params:duty-field 映射到 params_duty_field_edit", () => {
    expect(getWhitelistKeyByActiveKey("params:duty-field")).toBe("params_duty_field_edit");
  });

  test("params:version 映射到 params_version_edit", () => {
    expect(getWhitelistKeyByActiveKey("params:version")).toBe("params_version_edit");
  });

  test("params:group-template 映射到 params_group_template_edit", () => {
    expect(getWhitelistKeyByActiveKey("params:group-template")).toBe("params_group_template_edit");
  });

  test("params:issue-root-cause 映射到 params_issue_root_cause", () => {
    expect(getWhitelistKeyByActiveKey("params:issue-root-cause")).toBe("params_issue_root_cause");
  });

  test("params:llm-config 映射到 params_llm_config", () => {
    expect(getWhitelistKeyByActiveKey("params:llm-config")).toBe("params_llm_config");
  });
});
