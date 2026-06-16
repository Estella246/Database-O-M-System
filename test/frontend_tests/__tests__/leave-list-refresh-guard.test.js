/**
 * 请假申请列表：进入页签/侧栏导航时应拉取列表，避免首次进入空白。
 */
const fs = require("fs");
const path = require("path");

const LEAVE_PAGE = path.resolve(__dirname, "../../../frontend/modules/pages/leave-page.js");
const APP_JS = path.resolve(__dirname, "../../../frontend/app.js");
const leaveSrc = fs.readFileSync(LEAVE_PAGE, "utf8");
const appSrc = fs.readFileSync(APP_JS, "utf8");

describe("leave list refresh guard", () => {
  test("bindLeaveApplicationPage 在未加载或 needsRefresh 时拉取列表", () => {
    const bindBlock = leaveSrc.slice(leaveSrc.indexOf("export function bindLeaveApplicationPage"));
    expect(bindBlock).toMatch(
      /if\s*\(\s*state\.leaveNeedsRefresh\s*\|\|\s*\(\s*!state\.leaveListLoaded\s*&&\s*!state\.leaveListLoading\s*\)\)/
    );
    expect(bindBlock).toMatch(/void fetchLeaveList\(\)/);
  });

  test("fetchLeaveList 完成后标记 leaveListLoaded", () => {
    const fnBlock = leaveSrc.slice(leaveSrc.indexOf("export async function fetchLeaveList"));
    expect(fnBlock).toMatch(/state\.leaveListLoaded\s*=\s*true/);
  });

  test("侧栏点击请假申请时设置 leaveNeedsRefresh", () => {
    expect(appSrc).toMatch(/key === "leave:application"/);
    expect(appSrc).toMatch(/prevNavKey !== "leave:application"\)\s*state\.leaveNeedsRefresh\s*=\s*true/);
  });

  test("工作区页签切换到请假申请时设置 leaveNeedsRefresh", () => {
    expect(appSrc).toMatch(
      /state\.activeKey === "leave:application"\s*&&\s*prevTabKey !== "leave:application"\)\s*\{\s*state\.leaveNeedsRefresh\s*=\s*true/
    );
  });
});
