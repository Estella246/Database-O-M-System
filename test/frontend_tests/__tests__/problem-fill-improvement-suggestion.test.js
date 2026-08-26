/**
 * 问题填写「改进建议」：选填富文本，流转日志出现过运维闭环才可见。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const REQ_SRC = fs.readFileSync(path.join(ROOT, "frontend/modules/pages/requirement.js"), "utf8");
const PAGE_SRC = fs.readFileSync(path.join(ROOT, "frontend/modules/pages/ticket-page.js"), "utf8");
const EXPORT_SRC = fs.readFileSync(
  path.join(ROOT, "frontend/modules/constants/export-fields.js"),
  "utf8"
);
const MIG_SRC = fs.readFileSync(
  path.join(ROOT, "db/migrations/0126_problem_fill_improvement_suggestion.sql"),
  "utf8"
);
const VAL_SRC = fs.readFileSync(path.join(ROOT, "backend/utils/validators.py"), "utf8");

describe("问题填写改进建议", () => {
  test("迁移定义选填富文本且按运维闭环流转可见", () => {
    expect(MIG_SRC).toContain("'improvement_suggestion'");
    expect(MIG_SRC).toContain("'改进建议'");
    expect(MIG_SRC).toContain("'richtext'");
    expect(MIG_SRC).toContain("FALSE");
    expect(MIG_SRC).toContain('visible_when_flow_visited');
    expect(MIG_SRC).toContain("ops_closure");
  });

  test("前后端可见性规则读取流转日志上下文", () => {
    expect(REQ_SRC).toContain("visible_when_flow_visited");
    expect(REQ_SRC).toContain("FLOW_VISIT_CONTEXT_KEY");
    expect(VAL_SRC).toContain("visible_when_flow_visited");
    expect(VAL_SRC).toContain("FLOW_VISIT_CONTEXT_KEY");
    expect(PAGE_SRC).toContain("collectFlowVisitedTokens");
    expect(PAGE_SRC).toContain("withFlowVisitContext");
  });

  test("导出字段含改进建议", () => {
    expect(EXPORT_SRC).toContain('key: "improvement_suggestion"');
    expect(EXPORT_SRC).toContain('label: "改进建议"');
  });
});
