/**
 * 请假申请创建弹窗：点击遮罩不关闭，与工作台创建弹窗一致。
 */
const fs = require("fs");
const path = require("path");

const LEAVE_PAGE = path.resolve(__dirname, "../../../frontend/modules/pages/leave-page.js");
const APP_JS = path.resolve(__dirname, "../../../frontend/app.js");
const leaveSrc = fs.readFileSync(LEAVE_PAGE, "utf8");
const appSrc = fs.readFileSync(APP_JS, "utf8");

describe("leave create modal overlay", () => {
  test("工作台创建弹窗不监听遮罩点击关闭", () => {
    const start = appSrc.indexOf("// 创建弹窗：工作台与提单助手共用");
    expect(start).toBeGreaterThan(-1);
    const closeBlock = appSrc.slice(start, start + 800);
    expect(closeBlock).toMatch(/close-create-ticket-btn/);
    expect(closeBlock).toMatch(/closeCreateTicketModal\(\)/);
    expect(closeBlock).not.toMatch(/perm-modal-mask/);
    expect(closeBlock).not.toMatch(/ev\.target/);
  });

  test("请假创建弹窗不因点击遮罩关闭", () => {
    const bindBlock = leaveSrc.slice(leaveSrc.indexOf("export function bindLeaveApplicationPage"));
    expect(bindBlock).not.toMatch(
      /getElementById\("leave-app-create-mask"\)\?\.addEventListener\("click"/
    );
  });

  test("请假创建弹窗仅通过标题栏关闭按钮关闭，无取消按钮", () => {
    const bindBlock = leaveSrc.slice(leaveSrc.indexOf("export function bindLeaveApplicationPage"));
    expect(leaveSrc).toMatch(/id="leave-create-close-btn"/);
    expect(leaveSrc).not.toMatch(/leave-create-cancel-btn/);
    expect(bindBlock).toMatch(/leave-create-close-btn/);
    expect(bindBlock).toMatch(/closeLeaveCreateModal/);
    expect(bindBlock).not.toMatch(/leave-create-cancel-btn/);
  });
});
