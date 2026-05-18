/**
 * 补丁管理「选择列」应绑定热补丁流程字段目录（非 HCS 工单 export-fields）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const columnFieldsJs = fs.readFileSync(
  path.join(ROOT, "frontend/modules/constants/column-fields.js"),
  "utf8"
);
const hotpatchExportJs = fs.readFileSync(
  path.join(ROOT, "frontend/modules/constants/hotpatch-export-fields.js"),
  "utf8"
);

describe("patch column select catalog", () => {
  test("column-fields 在 patch 命名空间引用热补丁字段表", () => {
    expect(columnFieldsJs).toContain("hotpatch-export-fields.js");
    expect(columnFieldsJs).toContain('namespace === "patch"');
    expect(columnFieldsJs).toContain("HOTPATCH_EXPORT_FIELDS_BY_NODE");
    expect(columnFieldsJs).toContain("HOTPATCH_NODE_ORDER");
  });

  test("热补丁字段表含诉求填写节点与 DTS 单号", () => {
    expect(hotpatchExportJs).toContain("hp_demand_fill:");
    expect(hotpatchExportJs).toMatch(/hp_demand_fill:[\s\S]*dts_no/);
    expect(hotpatchExportJs).toContain('hp_demand_fill: "诉求填写"');
    expect(hotpatchExportJs).not.toContain("problem_fill");
  });

  test("buildColumnGroups 接受 namespace 参数", () => {
    expect(columnFieldsJs).toMatch(/export function buildColumnGroups\(namespace/);
  });
});
