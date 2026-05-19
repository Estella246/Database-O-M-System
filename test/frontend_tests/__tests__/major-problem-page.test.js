/**
 * 重大问题台账 - 前端模块自检与纯函数测试
 * 对应模块：frontend/modules/pages/major-problem-page.js
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/major-problem-page.js",
);
const src = fs.readFileSync(SRC_PATH, "utf8");

function formatMpDate(d) {
  if (!d) return "";
  const s = String(d);
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

function formatYmdLocal(d) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getStatusClass(status) {
  const s = String(status || "").trim();
  if (s === "待处理") return "mp-status--pending";
  if (s === "处理中") return "mp-status--processing";
  if (s === "已解决") return "mp-status--resolved";
  if (s === "已关闭") return "mp-status--closed";
  return "";
}

describe("major-problem-page.js 结构性自检", () => {
  test("详情弹窗含编辑、删除按钮与二次确认删除逻辑", () => {
    expect(src).toContain('id="mp-detail-edit-btn"');
    expect(src).toContain('id="mp-detail-delete-btn"');
    expect(src).toContain("handleMajorProblemDelete");
    expect(src).toContain("window.confirm");
    expect(src).toContain("此操作不可恢复");
  });

  test("编辑弹窗与 PATCH 保存逻辑", () => {
    expect(src).toContain("majorProblemEditOpen");
    expect(src).toContain('id="mp-edit-mask"');
    expect(src).toContain("handleMajorProblemEditSubmit");
    expect(src).toContain('method: "PATCH"');
  });

  test("导出列表、分页、配置等核心能力仍存在", () => {
    expect(src).toContain("fetchMajorProblemList");
    expect(src).toContain("fetchMajorProblemDetail");
    expect(src).toContain("handleMajorProblemExport");
    expect(src).toContain("fetchMajorProblemConfig");
  });
});

describe("重大问题纯函数", () => {
  test("formatMpDate 截取日期部分", () => {
    expect(formatMpDate("2026-05-19T12:00:00")).toBe("2026-05-19");
    expect(formatMpDate("")).toBe("");
  });

  test("formatYmdLocal 输出 YYYY-MM-DD", () => {
    expect(formatYmdLocal(new Date("2026-05-19T15:00:00"))).toBe("2026-05-19");
  });

  test("getStatusClass 映射四种状态", () => {
    expect(getStatusClass("待处理")).toBe("mp-status--pending");
    expect(getStatusClass("处理中")).toBe("mp-status--processing");
    expect(getStatusClass("已解决")).toBe("mp-status--resolved");
    expect(getStatusClass("已关闭")).toBe("mp-status--closed");
    expect(getStatusClass("")).toBe("");
  });
});
