/**
 * 补丁管理导出弹窗应绑定热补丁流程节点/字段，并在请求中带 template_code=HOTPATCH。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const exportModalJs = fs.readFileSync(
  path.join(ROOT, "frontend/modules/pages/export-modal.js"),
  "utf8"
);
const ticketCoreJs = fs.readFileSync(
  path.join(ROOT, "frontend/modules/pages/ticket-core.js"),
  "utf8"
);
const hotpatchExportJs = fs.readFileSync(
  path.join(ROOT, "frontend/modules/constants/hotpatch-export-fields.js"),
  "utf8"
);

describe("patch export catalog", () => {
  test("export-modal 引用热补丁字段表并按 patch:list 切换目录", () => {
    expect(exportModalJs).toContain("hotpatch-export-fields.js");
    expect(exportModalJs).toContain("HOTPATCH_EXPORT_FIELDS_BY_NODE");
    expect(exportModalJs).toContain("HOTPATCH_NODE_ORDER");
    expect(exportModalJs).toContain('activeKey === "patch:list"');
    expect(exportModalJs).toContain('template_code: templateCode');
    expect(exportModalJs).toContain('"HOTPATCH"');
  });

  test("补丁全部导出按当前筛选可见单号提交，避免误走工作台快照", () => {
    expect(exportModalJs).toContain('templateCode === "HOTPATCH"');
    expect(exportModalJs).toMatch(/visibleTickets\.map\(\(t\) => String\(t\.orderId/);
  });

  test("list_query 含 template_code 以便后端区分流程", () => {
    expect(ticketCoreJs).toContain('template_code: state.activeKey === "patch:list" ? "HOTPATCH"');
  });

  test("热补丁导出字段含诉求填写节点，不含工作台 problem_fill", () => {
    expect(hotpatchExportJs).toContain("hp_demand_fill:");
    expect(hotpatchExportJs).toMatch(/hp_demand_fill:[\s\S]*dts_no/);
    expect(hotpatchExportJs).toContain('hp_demand_fill: "诉求填写"');
    expect(hotpatchExportJs).not.toContain("problem_fill");
  });
});
