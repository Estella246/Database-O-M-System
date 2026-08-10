const fs = require("fs");
const path = require("path");

const pageSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/showcase-page.js"),
  "utf8",
);
const permissionSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/constants/permission.js"),
  "utf8",
);
const sceneSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/showcase-carousel/scene.js"),
  "utf8",
);
const configSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/showcase-carousel/config.js"),
  "utf8",
);

describe("GaussDB 大事件展示页", () => {
  test("Add 表单在标题与正文之间提供年月日时间字段", () => {
    expect(pageSrc).toContain('for="showcase-editor-event-date">时间</label>');
    expect(pageSrc).toContain('name="event_date" type="date"');
    expect(pageSrc).toContain("event_date: eventDate");
    expect(pageSrc).toContain("请填写时间");
  });

  test("详情页提供与 Add 共用权限的 Delete 操作", () => {
    expect(pageSrc).toContain("data-showcase-delete");
    expect(pageSrc).toContain('method: "DELETE"');
    expect(pageSrc).toContain("window.confirm");
    expect(permissionSrc).toContain("是否展示“Add”与“Delete”按钮");
  });

  test("奇数卡片使用半步中心吸附，避免松手后偏离中心", () => {
    expect(sceneSrc).toContain("createScrollController(canvas, config, -(images.length / 2))");
  });

  test("关闭鼠标轨迹粒子效果并保留 hover 高亮配置", () => {
    expect(configSrc).toMatch(/trail:\s*false/);
    expect(configSrc).toContain("hoverClean: 1.0");
    expect(configSrc).toContain("hoverDither:");
  });
});
