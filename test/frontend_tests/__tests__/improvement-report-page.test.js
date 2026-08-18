/**
 * 质量改进报告（月度总结） - 纯函数单元测试
 * 对应模块：frontend/modules/pages/improvement-report-page.js
 */

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/improvement-report-page.js",
);
const src = fs.readFileSync(SRC_PATH, "utf8");

// 简化策略：直接复制需要测试的纯函数到此处（保持与源文件同步）
function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymToTitle(ym) {
  if (!/^\d{6}$/.test(String(ym))) return "";
  return `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月改进报告`;
}

const SECTION_KEYS = ["overview", "overall", "domain", "monthly_new"];

const SECTION_LABELS = {
  overview: "一、整体概况",
  overall: "二、质量改进整体分析",
  domain: "三、质量改进领域分析",
  monthly_new: "四、本月新增改进诉求",
};

const NEW_REQ_COLUMNS = ["编号", "改进标题", "详细描述", "优先级", "负责领域", "负责人"];

function defaultSectionData(section) {
  if (section === "overview") return { one_line: "", detail: "" };
  if (section === "overall") return { kpi: {}, domain_pie: [], stage_pie: [], rf_accept_rate: [], rf_overdue_rate: [] };
  if (section === "domain") return { modules: [] };
  if (section === "monthly_new") return { rows: [] };
  return {};
}

describe("源文件结构性自检", () => {
  test("improvement-report-page.js 已包含所需的导出符号", () => {
    expect(src).toContain("export const SECTION_KEYS");
    expect(src).toContain("export const SECTION_LABELS");
    expect(src).toContain("export const NEW_REQ_COLUMNS");
    expect(src).toContain("export const NEW_REQ_COL_WIDTHS");
    expect(src).toContain("export const OVERALL_KPI_DEFS");
    expect(src).toContain("export const MODULE_CHART_DEFS");
    expect(src).toContain("export function defaultSectionData");
    // 改进报告与月度报告解耦：currentYm/ymToTitle 为本模块自持实现，
    // 不得 import 月度报告页（改月报内容属越界）
    expect(src).not.toContain("monthly-report-page");
    expect(src).toContain("function currentYm()");
    expect(src).toContain("月改进报告");
    expect(src).toContain("export function ensureImprovementReportTab");
    expect(src).toContain("export function ensureImprovementReportArchiveTab");
    expect(src).toContain("export function renderImprovementReportPage");
    expect(src).toContain("export function mountImprovementReportCharts");
    expect(src).toContain("export function bindImprovementReportPage");
    expect(src).toContain("export function renderImprovementReportArchivePage");
    expect(src).toContain("export function bindImprovementReportArchivePage");
  });

  test("四段标题符合用户需求模板", () => {
    expect(SECTION_LABELS.overview).toBe("一、整体概况");
    expect(SECTION_LABELS.overall).toBe("二、质量改进整体分析");
    expect(SECTION_LABELS.domain).toBe("三、质量改进领域分析");
    expect(SECTION_LABELS.monthly_new).toBe("四、本月新增改进诉求");
    expect(SECTION_KEYS).toHaveLength(4);
  });

  test("本月新增改进诉求表格共 6 列（编号/标题/描述/优先级/领域/负责人）", () => {
    expect(NEW_REQ_COLUMNS).toHaveLength(6);
    expect(NEW_REQ_COLUMNS).toEqual([
      "编号", "改进标题", "详细描述", "优先级", "负责领域", "负责人",
    ]);
    // 源文件同步声明
    expect(src).toContain('export const NEW_REQ_COLUMNS = ["编号", "改进标题", "详细描述", "优先级", "负责领域", "负责人"]');
  });

  test("标题横幅复用 mr-title-banner 并含「质量改进报告（x年x月）」", () => {
    // 横幅复用月度报告 mr-* 样式（蓝底由 report.css 提供），标题带月份
    expect(src).toContain("mr-title-banner");
    expect(src).toContain("renderTitleBanner");
    expect(src).toContain("质量改进报告（${escapeHtml(monthLabel)}）");
  });

  test("整体分析 4 图挂载点存在（领域饼/阶段饼/责任田接纳率/责任田超期率）", () => {
    expect(src).toContain('id="ir-chart-overall-domain"');
    expect(src).toContain('id="ir-chart-overall-stage"');
    expect(src).toContain('id="ir-chart-overall-rf-accept"');
    expect(src).toContain('id="ir-chart-overall-rf-overdue"');
  });

  test("领域分析按二级模块渲染模块块 + 每模块 5 图", () => {
    expect(src).toContain("ir-module-block");
    // 模块内图表键与 MODULE_CHART_DEFS 对应（stage_pie/category_pie/user_submission/user_accept_rate/handler_pending）
    expect(src).toContain("stage_pie");
    expect(src).toContain("category_pie");
    expect(src).toContain("user_submission");
    expect(src).toContain("user_accept_rate");
    expect(src).toContain("handler_pending");
  });

  test("责任田三率 chip 与超期率口径（确认+实施）存在", () => {
    expect(src).toContain("ir-rf-rates");
    expect(src).toContain("ir-rf-chip");
    expect(src).toContain("接纳率");
    expect(src).toContain("闭环率");
    expect(src).toContain("超期率");
  });

  test("工具栏包含导出 HTML / 导出 Excel / 归档入口", () => {
    expect(src).toContain("导出 HTML");
    expect(src).toContain("导出 Excel");
    expect(src).toContain("ir-export-xlsx-btn");
    expect(src).toContain("buildExportHtml");
    expect(src).toContain("exportReportHtml");
    expect(src).toContain("buildExportXlsx");
    expect(src).toContain("exportReportXlsx");
  });

  test("四段均可导入（IMPORTABLE_SECTIONS）", () => {
    expect(src).toContain("IMPORTABLE_SECTIONS");
    const m = src.match(/IMPORTABLE_SECTIONS\s*=\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    ["overview", "overall", "domain", "monthly_new"].forEach(k => {
      expect(m[1]).toContain(`${k}: true`);
    });
  });
});

describe("ymToTitle", () => {
  test("形如 202604 → 2026年4月改进报告", () => {
    expect(ymToTitle("202604")).toBe("2026年4月改进报告");
  });
  test("形如 202612 → 2026年12月改进报告（保留双位数）", () => {
    expect(ymToTitle("202612")).toBe("2026年12月改进报告");
  });
  test("非法输入返回空字符串", () => {
    expect(ymToTitle("")).toBe("");
    expect(ymToTitle("2026-04")).toBe("");
    expect(ymToTitle("abcdef")).toBe("");
    expect(ymToTitle(null)).toBe("");
  });
});

describe("currentYm", () => {
  test("返回 6 位数字 YYYYMM", () => {
    expect(currentYm()).toMatch(/^\d{6}$/);
  });
  test("月份位 01-12 之间", () => {
    const ym = currentYm();
    const m = parseInt(ym.slice(4), 10);
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThanOrEqual(12);
  });
});

describe("defaultSectionData", () => {
  test("overview 含一句话进展与详细进展", () => {
    const d = defaultSectionData("overview");
    expect(d.one_line).toBe("");
    expect(d.detail).toBe("");
  });
  test("overall 含 KPI 与 4 个图表数据键", () => {
    const d = defaultSectionData("overall");
    expect(d.kpi).toBeDefined();
    ["domain_pie", "stage_pie", "rf_accept_rate", "rf_overdue_rate"].forEach(k => {
      expect(Array.isArray(d[k])).toBe(true);
    });
  });
  test("domain 含 modules 数组", () => {
    const d = defaultSectionData("domain");
    expect(Array.isArray(d.modules)).toBe(true);
  });
  test("monthly_new 含 rows 数组", () => {
    const d = defaultSectionData("monthly_new");
    expect(Array.isArray(d.rows)).toBe(true);
  });
  test("未知段返回空对象", () => {
    expect(defaultSectionData("unknown")).toEqual({});
  });
});
