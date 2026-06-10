/**
 * 工作台 / 补丁管理列表批量删除二次确认
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("ticket-page bulk delete confirm", () => {
  test("删除按钮点击后弹出条数确认框", () => {
    expect(src).toContain("#delete-ticket-btn");
    expect(src).toContain("window.confirm");
    expect(src).toContain("此操作将删除${ticketNos.length}条工单，是否继续？");
  });
});
