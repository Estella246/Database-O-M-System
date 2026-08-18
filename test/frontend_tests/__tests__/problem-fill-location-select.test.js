/**
 * 问题填写「局点」下拉：禁止手动新增，展示维护提示。
 */
const fs = require("fs");
const path = require("path");

const WORKFLOW_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/constants/workflow.js"),
  "utf8",
);
const TICKET_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket.js"),
  "utf8",
);
const TICKET_PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js"),
  "utf8",
);
const TICKETS_PY_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../backend/routers/tickets.py"),
  "utf8",
);

const HINT = "未录入局点咨询宋康 00800147录入";

describe("问题填写局点下拉不可手动新增", () => {
  test("workflow 常量含局点提示且搜索占位不含手动输入", () => {
    expect(WORKFLOW_SRC).toContain(`export const PROBLEM_FILL_LOCATION_HINT = "${HINT}"`);
    expect(WORKFLOW_SRC).toContain('if (key === "location") return "搜索局点"');
    expect(WORKFLOW_SRC).not.toContain("搜索或输入新局点");
    expect(WORKFLOW_SRC).not.toContain("WF_FLAT_CREATABLE_FIELD_KEYS");
    expect(WORKFLOW_SRC).not.toContain("isWorkflowFlatSelectCreatable");
  });

  test("扁平下拉渲染不含可新增局点按钮", () => {
    expect(TICKET_SRC).not.toContain("data-wf-flat-creatable");
    expect(TICKET_SRC).not.toContain("data-wf-flat-create");
    expect(TICKET_SRC).not.toContain("新增局点");
  });

  test("问题填写表单局点提示在下拉占位处展示", () => {
    expect(TICKET_PAGE_SRC).toContain("PROBLEM_FILL_LOCATION_HINT");
    expect(TICKET_PAGE_SRC).toContain("placeholderLabel:");
    expect(TICKET_PAGE_SRC).toContain('nodeKey === "problem_fill" && field.key === "location"');
    expect(TICKET_PAGE_SRC).not.toContain("problem-field-hint");
    expect(TICKET_PAGE_SRC).not.toContain("isWorkflowFlatSelectCreatable");
    expect(TICKET_PAGE_SRC).not.toContain("新增局点");
  });

  test("扁平下拉支持自定义占位文案", () => {
    expect(TICKET_SRC).toContain("placeholderLabel");
    expect(TICKET_SRC).toContain("data-wf-flat-placeholder-text");
  });

  test("工单提交不再自动创建局点档案", () => {
    expect(TICKETS_PY_SRC).not.toContain("_ensure_site_profile_for_location");
  });
});
