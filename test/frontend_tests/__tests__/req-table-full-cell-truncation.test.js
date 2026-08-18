/**
 * 回归锁：全量表 .req-table--full 的单元格省略号截断必须保留在通用 td 规则上
 * （配合 table-cell-overflow-tooltip 的 scrollWidth 检测，删掉会导致溢出提示失效）；
 * 工单页内联/非内联空态占位列数须与表头一致（内联 8 / 非内联 10）。
 */

const fs = require("fs");
const path = require("path");

const cssSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/styles/requirement.css"),
  "utf8",
);
const pageSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js"),
  "utf8",
);

describe("req-table--full 单元格截断与空态列数", () => {
  test("通用 td 规则含 nowrap + overflow hidden + ellipsis（tooltip 截断检测依赖）", () => {
    const block = cssSrc.slice(
      cssSrc.indexOf(".req-table--full td {"),
      cssSrc.indexOf("}", cssSrc.indexOf(".req-table--full td {")) + 1
    );
    expect(block).toMatch(/white-space:\s*nowrap/);
    expect(block).toMatch(/overflow:\s*hidden/);
    expect(block).toMatch(/text-overflow:\s*ellipsis/);
  });

  test("工单页空态 colspan 与表头列数一致（内联 8 / 非内联 10）", () => {
    expect(pageSrc).toContain("var emptyCols = isInline ? 8 : 10");
  });
});
