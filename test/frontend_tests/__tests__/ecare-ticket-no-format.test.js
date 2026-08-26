/**
 * eCare 单号格式校验接线（与 ticket.js / ticket-page.js / workflow.js 一致）。
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
const WF = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/constants/workflow.js"),
  "utf8"
);

describe("ecare_ticket_no format validation UX", () => {
  test("workflow.js 含默认与公有云两套规则", () => {
    expect(WF).toMatch(/isValidEcareTicketNo/);
    expect(WF).toMatch(/\^\[13\]\\d\{7\}\$/);
    expect(WF).toMatch(/\^\\d\{14\}\$/);
    expect(WF).toMatch(/\^\\d\{10\}\$/);
    expect(WF).toMatch(/startsWith\("TS"\)/);
    expect(WF).toMatch(/startsWith\("sjgd"\)/);
    expect(WF).toMatch(/请输入格式正确的eCare单号/);
  });

  test("formatValidationErrors 映射 ecare_ticket_no invalid format", () => {
    expect(SRC).toMatch(/key === "ecare_ticket_no"/);
    expect(SRC).toMatch(/请输入格式正确的eCare单号/);
  });

  test("提交时做格式校验，输入框不带占位提示", () => {
    expect(PAGE).toMatch(/ecareTicketNoClientError/);
    expect(PAGE).not.toMatch(/ecareTicketNoPlaceholder/);
    expect(PAGE).not.toMatch(/syncProblemFillEcarePlaceholder/);
    expect(PAGE).not.toMatch(/field\.key === "ecare_ticket_no"/);
  });
});
