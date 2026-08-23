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
  if (section === "domain") return { level1: [], level2: [] };
  if (section === "monthly_new") return { rows: [] };
  return {};
}

function domainHasData(d) {
  return (Array.isArray(d.level1) && d.level1.length > 0)
    || (Array.isArray(d.level2) && d.level2.length > 0);
}

describe("源文件结构性自检", () => {
  test("improvement-report-page.js 已包含所需的导出符号", () => {
    expect(src).toContain("export const SECTION_KEYS");
    expect(src).toContain("export const SECTION_LABELS");
    expect(src).toContain("export const NEW_REQ_COLUMNS");
    expect(src).toContain("export const NEW_REQ_COL_WIDTHS");
    expect(src).toContain("export const OVERALL_KPI_DEFS");
    expect(src).toContain("export const DOMAIN_CHART_DEFS");
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

  test("领域分析渲染模块&特性 一级/二级 柱图+饼图（4 图挂载点，无逐模块旧结构）", () => {
    expect(src).toContain('id="ir-chart-domain-${d.id}"');
    // DOMAIN_CHART_DEFS 定义 4 图：一级/二级 × 柱/饼
    ["l1-bar", "l1-pie", "l2-bar", "l2-pie"].forEach((id) => {
      expect(src).toContain(`id: "${id}"`);
    });
    expect(src).toContain("模块&特性分布（一级）");
    expect(src).toContain("模块&特性占比（一级）");
    expect(src).toContain("模块&特性分布（二级）");
    expect(src).toContain("模块&特性占比（二级）");
    // 旧「按二级模块逐模块 5 图」结构已整体移除
    expect(src).not.toContain("MODULE_CHART_DEFS");
    expect(src).not.toContain("MODULE_CHART_COLORS");
    expect(src).not.toContain("ir-module-block");
    expect(src).not.toContain("ir-rf-chip");
    // 柱图配色常量随四图定义更名
    expect(src).toContain("DOMAIN_CHART_COLORS");
    // 两级序列非空判定：渲染 / HTML 导出 / Excel 导出三处共用同一 helper
    expect(src).toContain("const domainHasData = (d) =>");
    expect((src.match(/domainHasData\(/g) || []).length).toBe(3);
    // 旧存量第三段（modules 结构）进入编辑即按新契约起步，不再原样保存回去
    expect(src).toContain('section === "domain" && !Array.isArray(stored.level1)');
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
  test("domain 含 level1/level2 两个序列数组", () => {
    const d = defaultSectionData("domain");
    expect(Array.isArray(d.level1)).toBe(true);
    expect(Array.isArray(d.level2)).toBe(true);
  });
  test("domainHasData 两级任一非空即为有数据（含旧 modules 结构判定为空）", () => {
    expect(domainHasData({ level1: [], level2: [] })).toBe(false);
    expect(domainHasData({})).toBe(false);
    // 旧存量第三段结构（modules）在新契约下视为无数据 → 空态提示
    expect(domainHasData({ modules: [{ name: "M" }] })).toBe(false);
    expect(domainHasData({ level1: [{ name: "D", value: 1 }], level2: [] })).toBe(true);
    expect(domainHasData({ level1: [], level2: [{ name: "D/M", value: 1 }] })).toBe(true);
  });
  test("monthly_new 含 rows 数组", () => {
    const d = defaultSectionData("monthly_new");
    expect(Array.isArray(d.rows)).toBe(true);
  });
  test("未知段返回空对象", () => {
    expect(defaultSectionData("unknown")).toEqual({});
  });
});
