/**
 * 局点档案列表批量删除与工作台删除按钮行为一致
 */

const fs = require("fs");
const path = require("path");

const SP_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/site-profile-page.js",
);
const APP_PATH = path.resolve(__dirname, "../../../frontend/app.js");

const spSrc = fs.readFileSync(SP_PATH, "utf8");
const appSrc = fs.readFileSync(APP_PATH, "utf8");

describe("site-profile bulk delete", () => {
  test("列表含勾选列与全选", () => {
    expect(spSrc).toContain("sp-select-all");
    expect(spSrc).toContain("data-sp-select");
    expect(spSrc).toContain("siteProfileSelectedIds");
  });

  test("删除按钮在工具栏新增右侧", () => {
    expect(spSrc).toContain('id="sp-create-btn">新增</button>');
    expect(spSrc).toContain('id="sp-delete-btn">删除</button>');
    expect(spSrc).toMatch(
      /id="sp-create-btn">新增<\/button>[\s\S]*id="sp-delete-btn">删除<\/button>/,
    );
    expect(spSrc).toContain("handleSiteProfileBulkDelete");
    expect(appSrc).not.toContain("isSiteProfile && canViewSiteProfileDelete");
  });

  test("批量删除二次确认与接口", () => {
    expect(spSrc).toContain("请先选中要删除的局点档案");
    expect(spSrc).toContain("此操作将删除${selectedIds.length}条局点档案，是否继续？");
    expect(spSrc).toContain("/api/site-profiles/bulk-delete");
  });
});
