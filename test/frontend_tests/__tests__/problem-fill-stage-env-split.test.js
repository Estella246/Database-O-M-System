/**
 * 问题填写「问题阶段」拆成问题阶段 + 问题环境，均为必填下拉。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const EXPORT_SRC = fs.readFileSync(
  path.join(ROOT, "frontend/modules/constants/export-fields.js"),
  "utf8"
);
const BE_EXPORT_SRC = fs.readFileSync(
  path.join(ROOT, "backend/ticket_export_fields.py"),
  "utf8"
);
const MIG_SRC = fs.readFileSync(
  path.join(ROOT, "db/migrations/0128_split_problem_stage_and_env.sql"),
  "utf8"
);

describe("问题填写阶段与环境拆分", () => {
  test("迁移新增问题环境且阶段选项不含生产/测试环境", () => {
    expect(MIG_SRC).toContain("'problem_env'");
    expect(MIG_SRC).toContain("'问题环境'");
    expect(MIG_SRC).toContain("'OS_PROBLEM_ENV'");
    expect(MIG_SRC).toContain("'运维阶段'");
    expect(MIG_SRC).toContain("'测试环境'");
    expect(MIG_SRC).toContain("NOT IN ('POC阶段', '交付阶段', '运维阶段', '在研版本试点')");
  });

  test("前后端导出字段均含问题环境", () => {
    expect(EXPORT_SRC).toContain('key: "problem_env"');
    expect(EXPORT_SRC).toContain('label: "问题环境"');
    expect(BE_EXPORT_SRC).toContain('"problem_env"');
    expect(BE_EXPORT_SRC).toContain('"问题环境"');
  });
});
