/**
 * requestRender 合并同帧多次调用，减轻侧栏快速切换时的重绘风暴。
 */
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(__dirname, "../../../frontend/modules/core/scheduler.js");
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("scheduler requestRender coalescing", () => {
  test("使用 requestAnimationFrame 合并重绘", () => {
    expect(src).toMatch(/_renderScheduled/);
    expect(src).toMatch(/requestAnimationFrame/);
  });
});
