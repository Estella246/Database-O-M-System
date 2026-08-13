/**
 * DTS 单号格式错误文案映射（与 ticket.js formatValidationErrors 一致）。
 */

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket.js"),
  "utf8"
);
const PAGE = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js"),
  "utf8"
);

describe("dts_no format validation UX", () => {
  test("formatValidationErrors 映射 dts_no invalid format", () => {
    expect(SRC).toMatch(/invalid format/);
    expect(SRC).toMatch(/key === "dts_no"/);
    expect(SRC).toMatch(/若为问题单/);
    expect(SRC).toMatch(/还未落地的需求/);
    expect(SRC).toMatch(/AR\.SR\.IR/);
  });

  test("dts_no 输入框带格式占位提示", () => {
    expect(PAGE).toMatch(/field\.key === "dts_no"/);
    expect(PAGE).toMatch(/DTS20260826xxxxx/);
  });
});
