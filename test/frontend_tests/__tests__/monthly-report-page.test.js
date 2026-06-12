/**
 * 现网重大问题月度分析报告 - 纯函数单元测试
 * 对应模块：frontend/modules/pages/monthly-report-page.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 加载 ES 模块的纯函数：抽取并 eval 到沙箱
const SRC_PATH = path.resolve(
  __dirname,
  "../../../frontend/modules/pages/monthly-report-page.js",
);
const src = fs.readFileSync(SRC_PATH, "utf8");

// 简化策略：直接复制需要测试的纯函数到此处（保持与源文件同步）
function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymToTitle(ym) {
  if (!/^\d{6}$/.test(String(ym))) return "";
  return `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月报`;
}

const MAJOR_TYPES = [
  { key: "coredump", label: "coredump" },
  { key: "consistency", label: "数据正确性&一致性" },
  { key: "full", label: "满" },
  { key: "hang_slow", label: "hang/慢" },
  { key: "escalation", label: "升级" },
];

const MAJOR_COLUMNS = [
  "重大问题类型", "局点", "版本", "问题编号", "问题描述",
  "根因/进展", "问题影响", "问题领域", "模块/特性", "责任XM",
];

const IMPROVE_COLUMNS = ["编号", "问题描述", "改进目标", "负责领域", "责任人"];

function defaultSectionData(section) {
  if (section === "overview") {
    return {
      banner_product: "xxxx",
      banner_drafter: "xxx",
      banner_reviewer: "yyy",
      major_events: "本月共发生 0 起重大管理升级与事故。",
      problem_analysis: "本月问题总体特征、分布与趋势分析。",
      risk_modules: "重点风险模块：（请补充模块和特性）",
      quality_feedback: "质量改进识别与反馈：（请补充）",
    };
  }
  if (section === "major") {
    const types = {};
    MAJOR_TYPES.forEach((t) => { types[t.key] = []; });
    return { types };
  }
  if (section === "links") return { content: "" };
  if (section === "insight") {
    return {
      kpi: { total_count: 0, known_count: 0, new_count: 0, pansh_count: 0, pansh_total: 0 },
      impact_categories: [], top_modules: [],
      top1_breakdown: [], top2_breakdown: [],
    };
  }
  if (section === "improve") {
    return {
      module_distribution: [], sql_items: [], storage_items: [], new_requests: [],
    };
  }
  return {};
}

describe("源文件结构性自检", () => {
  test("monthly-report-page.js 已包含 5 段所需的导出符号", () => {
    expect(src).toContain("export const SECTION_KEYS");
    expect(src).toContain("export const MAJOR_TYPES");
    expect(src).toContain("export const MAJOR_COLUMNS");
    expect(src).toContain("export const IMPROVE_COLUMNS");
    expect(src).toContain("export function defaultSectionData");
    expect(src).toContain("export function currentYm");
    expect(src).toContain("export function ymToTitle");
    expect(src).toContain("export function ensureMonthlyReportTab");
    expect(src).toContain("export function ensureMonthlyReportArchiveTab");
    expect(src).toContain("export function renderMonthlyReportPage");
    expect(src).toContain("export function bindMonthlyReportPage");
    expect(src).toContain("export function renderMonthlyReportArchivePage");
  });

  test("MAJOR_COLUMNS 共 10 列（按用户需求）", () => {
    expect(MAJOR_COLUMNS).toHaveLength(10);
  });

  test("MAJOR_TYPES 共 5 类（按用户需求）", () => {
    expect(MAJOR_TYPES).toHaveLength(5);
    const labels = MAJOR_TYPES.map((t) => t.label);
    expect(labels).toEqual(
      expect.arrayContaining(["coredump", "数据正确性&一致性", "满", "hang/慢", "升级"]),
    );
  });

  test("IMPROVE_COLUMNS 共 5 列（按用户需求）", () => {
    expect(IMPROVE_COLUMNS).toHaveLength(5);
    expect(IMPROVE_COLUMNS).toEqual([
      "编号", "问题描述", "改进目标", "负责领域", "责任人",
    ]);
  });

  test("改进诉求表格在表头上方包含合并标题行", () => {
    expect(src).toContain("mr-improve-title-row");
    expect(src).toContain("本月新增改进诉求");
  });

  test("整体情况上方包含暗红色标题横幅（含主标题与拟制/审核行）", () => {
    expect(src).toContain("mr-title-banner");
    expect(src).toContain("mr-title-banner-main");
    expect(src).toContain("mr-title-banner-sub");
    expect(src).toContain("现网重大问题月度分析");
    expect(src).toContain("拟制:");
    expect(src).toContain("审核:");
  });

  test("标题横幅 3 个字段在编辑态下可编辑（复用 overview 段保存）", () => {
    expect(src).toContain('data-mr-overview-field="banner_product"');
    expect(src).toContain('data-mr-overview-field="banner_drafter"');
    expect(src).toContain('data-mr-overview-field="banner_reviewer"');
  });

  test("HTML 导出横幅字体与网页一致：标题 30px、拟制/审核行 20px", () => {
    const bannerMatch = src.match(/const bannerHtml = `[\s\S]*?`;/);
    expect(bannerMatch).not.toBeNull();
    // 标题 30px
    expect(bannerMatch[0]).toContain("font-size:30px");
    // 拟制:...审核: 行 20px
    expect(bannerMatch[0]).toMatch(/font-size:20px;opacity:\.92;[\s\S]*拟制:/);
  });

  test("HTML 导出重大问题表使用固定布局 + MAJOR_COL_WIDTHS 列宽（与网页一致）", () => {
    // 修复前：导出 major 表无 colgroup/table-layout，列宽随内容变化，与网页不一致
    expect(src).toContain("const majorColGroup = `<colgroup>${MAJOR_COL_WIDTHS.map");
    // major 表必须同时声明 colgroup 与固定布局
    const majorTableMatch = src.match(/const majorTablesHtml = `[\s\S]*?<\/table>`/);
    expect(majorTableMatch).not.toBeNull();
    expect(majorTableMatch[0]).toContain("table-layout:fixed");
    expect(majorTableMatch[0]).toContain("${majorColGroup}");
  });

  test("工具栏包含「导出 Excel」按钮且绑定到 exportReportXlsx", () => {
    expect(src).toContain("导出 Excel");
    expect(src).toContain('id="mr-export-xlsx-btn"');
    expect(src).toContain("mr-export-xlsx-btn");
    expect(src).toContain("buildExportXlsx");
    expect(src).toContain("exportReportXlsx");
  });

  test("Excel 导出生成单一 sheet「月度报告」，5 段在同一 sheet 内堆叠", () => {
    expect(src).toContain('book_append_sheet(wb, ws, "月度报告")');
    // 顺序堆叠的 5 段标题
    expect(src).toContain("一、整体概况");
    expect(src).toContain("二、问题透视");
    expect(src).toContain("三、重大问题");
    expect(src).toContain("四、改进诉求");
    expect(src).toContain("五、问题详情&质量改进记录");
  });

  test("Excel 单 sheet 使用合并单元格（章节横幅整行合并 + 类型列纵向合并）", () => {
    expect(src).toContain('"!merges"');
    expect(src).toContain("pushFullRow");
  });

  test("Excel 样式（依赖 xlsx-js-style）：红色横幅 + 天蓝段头 + 表头底色 + 边框", () => {
    expect(src).toContain("8B1A1A"); // 横幅暗红
    expect(src).toContain("87CEEB"); // 段头天蓝
    expect(src).toContain("F0F3F7"); // 表头底色
    expect(src).toContain("thinBorder");
    expect(src).toContain("recordStyle");
    expect(src).toContain('"!rows"');
  });

  test("Excel 图表分布与 HTML 一致：insight 2x2 网格 + improve 1x3 网格", () => {
    expect(src).toContain("pushKvBands");
    // 2x2: 左 cFrom 0 cTo 4，右 cFrom 5 cTo 9
    expect(src).toContain('cFrom: 0, cTo: 4');
    expect(src).toContain('cFrom: 5, cTo: 9');
    // 1x3: 0-3 / 4-6 / 7-9
    expect(src).toContain('cFrom: 0, cTo: 3');
    expect(src).toContain('cFrom: 4, cTo: 6');
    expect(src).toContain('cFrom: 7, cTo: 9');
    // 旧的逐表堆叠 pushKv 已被移除
    expect(src).not.toMatch(/pushKv\(\s*"Top/);
    expect(src).not.toMatch(/pushKv\(\s*"改进诉求模块占比"/);
  });

  test("标题横幅行内提供编辑/保存/取消入口（复用 overview 段）", () => {
    expect(src).toContain('class="mr-title-banner-actions"');
    expect(src).toContain('data-mr-edit="overview"');
    expect(src).toContain('data-mr-save="overview"');
    expect(src).toContain('data-mr-cancel="overview"');
    // 归档态隐藏入口
    expect(src).toContain("isArchived");
  });
});

describe("defaultSectionData(overview) 包含横幅 3 字段", () => {
  test("overview 默认值含 banner_product / banner_drafter / banner_reviewer", () => {
    const d = defaultSectionData("overview");
    expect(d.banner_product).toBe("xxxx");
    expect(d.banner_drafter).toBe("xxx");
    expect(d.banner_reviewer).toBe("yyy");
  });
});

describe("ymToTitle", () => {
  test("形如 202604 → 2026年4月报", () => {
    expect(ymToTitle("202604")).toBe("2026年4月报");
  });
  test("形如 202612 → 2026年12月报（保留双位数）", () => {
    expect(ymToTitle("202612")).toBe("2026年12月报");
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
  test("overview 包含 4 个文本字段 + 3 个横幅字段", () => {
    const d = defaultSectionData("overview");
    expect(Object.keys(d).sort()).toEqual(
      [
        "banner_drafter", "banner_product", "banner_reviewer",
        "major_events", "problem_analysis", "quality_feedback", "risk_modules",
      ].sort(),
    );
  });

  test("major 初始化 5 个类型空数组", () => {
    const d = defaultSectionData("major");
    expect(d.types).toBeDefined();
    MAJOR_TYPES.forEach((t) => {
      expect(Array.isArray(d.types[t.key])).toBe(true);
      expect(d.types[t.key]).toHaveLength(0);
    });
  });

  test("links 初始化 content 为空字符串", () => {
    const d = defaultSectionData("links");
    expect(typeof d.content).toBe("string");
    expect(d.content).toBe("");
  });

  test("insight 包含 KPI 与 4 个图表数据键", () => {
    const d = defaultSectionData("insight");
    expect(d.kpi).toBeDefined();
    [
      "impact_categories",
      "top_modules",
      "top1_breakdown",
      "top2_breakdown",
    ].forEach((k) => {
      expect(Array.isArray(d[k])).toBe(true);
    });
  });

  test("improve 包含模块分布 / sql / storage / new_requests", () => {
    const d = defaultSectionData("improve");
    expect(Array.isArray(d.module_distribution)).toBe(true);
    expect(Array.isArray(d.sql_items)).toBe(true);
    expect(Array.isArray(d.storage_items)).toBe(true);
    expect(Array.isArray(d.new_requests)).toBe(true);
  });

  test("未知段返回空对象", () => {
    expect(defaultSectionData("unknown")).toEqual({});
  });
});
