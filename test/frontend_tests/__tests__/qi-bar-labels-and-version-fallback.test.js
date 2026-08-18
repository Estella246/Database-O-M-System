/**
 * 质量改进分析柱状图数值标签 + 解决版本静态兜底 - 哨兵与纯函数测试
 * 覆盖：
 * - frontend/modules/pages/stats.js（buildStatsLaborEchartBarOption：showValues/aria）
 * - frontend/modules/pages/qi-page.js（qi 分析四图与放大弹窗传 showValues；accept_version 合并兜底）
 * - frontend/modules/constants/qi.js（QI_ACCEPT_VERSION_FALLBACK 静态兜底；sla_time 退役）
 *
 * 修复点（code-review Q1/V2/S2）：
 * Q1：SVG→ECharts 迁移后 qi 分析柱状图丢失数值标签（原 showValues:true）、opts.aria 成死参数；
 * V2：解决版本必填 select 无静态选项，fetch 失败 → 空 select 提交 "" 被后端 400 卡死；
 * S2：sla_time 死字段退役（不参与超期计算、不再采集/展示/导出）。
 * 纯函数行为级断言见 stats-helpers.test.js；页面级挂载由 e2e（test_e2e_qi_config.py）覆盖。
 */

const fs = require("fs");
const path = require("path");

const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
const statsSrc = readSrc("../../../frontend/modules/pages/stats.js");
const qiPageSrc = readSrc("../../../frontend/modules/pages/qi-page.js");
const qiConstSrc = readSrc("../../../frontend/modules/constants/qi.js");
const ticketPageSrc = readSrc("../../../frontend/modules/pages/ticket-page.js");

describe("Q1：ECharts 柱状图数值标签与 aria（stats.js 源哨兵）", () => {
  test("buildStatsLaborEchartBarOption 支持 showValues 柱顶标签（值>0 才显示）", () => {
    expect(statsSrc).toContain("show: !!opts.showValues");
    expect(statsSrc).toContain('position: "top"');
    expect(statsSrc).toContain('formatter: (p) => (Number(p.value) > 0 ? p.value : "")');
  });

  test("opts.aria 映射 ECharts aria.label.description（不再是死参数）", () => {
    expect(statsSrc).toMatch(/aria: \{ enabled: true, label: \{ enabled: true, description: opts\.aria \} \}/);
  });

  test("qi 分析四图与放大弹窗均传 showValues:true", () => {
    expect(qiPageSrc).toContain('{ aria, showValues: true }');
    expect(qiPageSrc).toContain('{ aria: title, showValues: true }');
  });
});

// 与源文件保持同步的逻辑副本（第 2 轮 C3/C4 语义：fetch 成功 = 配置全量权威，静态兜底不再合并复活；
// 重建取值 = 用户当前已选 sel.value 优先，回落渲染时存量值；存量值不在选项中时兜底保留为选项）
function buildAcceptVersionOptions(fetched, saved) {
  const rows = fetched || [];
  const versions = rows.filter(v => v && v.enabled !== false).map(v => String(v.version)).filter(Boolean);
  const opts = versions.slice();
  if (saved && !opts.includes(saved)) opts.push(saved);
  return opts;
}

describe("V2：解决版本选项（fetch 成功 = 配置权威 + 存量值兜底）", () => {
  test("静态兜底常量存在（同迁移 0122 种子）且接入 accept_version 字段（初始渲染/.catch 路径用）", () => {
    expect(qiConstSrc).toContain('export const QI_ACCEPT_VERSION_FALLBACK = ["507.0", "507.1", "508.0"];');
    expect(qiConstSrc).toContain("options: QI_ACCEPT_VERSION_FALLBACK");
  });

  test("fetch 成功（含空列表）→ 只列启用项，静态兜底不合并（C3：删除的版本不复活）", () => {
    expect(buildAcceptVersionOptions([{ version: "T-509.0", enabled: true }], "")).toEqual(["T-509.0"]);
    expect(buildAcceptVersionOptions([
      { version: "507.0", enabled: true },
      { version: "507.1", enabled: false },
    ], "")).toEqual(["507.0"]);
    expect(buildAcceptVersionOptions([], "")).toEqual([]);
  });

  test("存量/用户已选值不在选项中时兜底保留为选项", () => {
    expect(buildAcceptVersionOptions([{ version: "507.0", enabled: true }], "509.9")).toEqual(
      ["507.0", "509.9"],
    );
  });

  test("fetch 失败不再吞错（catch 有告警日志；初始渲染的静态兜底保持不动）", () => {
    expect(qiPageSrc).toMatch(/console\.warn\("\[qi\] 解决版本配置加载失败/);
  });

  test("源哨兵：fetch 成功路径不再合并静态兜底；重建取值用户当前选择优先（C4）", () => {
    expect(qiPageSrc).not.toContain("merged.push");
    expect(qiPageSrc).toContain("const saved = sel.value || sel.dataset.currentValue || \"\"");
  });

  test("empty_option：accept_version 初始渲染即带「--」空选项，未选值不静默回落首个种子", () => {
    expect(qiConstSrc).toContain("empty_option: true");
    expect(qiPageSrc.match(/f\.empty_option \? '<option value="">--<\/option>' : ''/g)?.length).toBe(2); // 阶段面板 + 修订面板两处渲染器
  });
});

describe("S2：sla_time 死字段退役（源哨兵）", () => {
  test("前端常量与页面无 sla_time 残留", () => {
    expect(qiConstSrc).not.toContain("sla_time");
    expect(qiPageSrc).not.toContain("sla_time");
    expect(ticketPageSrc).not.toContain("sla_time");
  });

  test("工单详情关联改进表不再渲染 SLA时间 列", () => {
    expect(ticketPageSrc).not.toContain("<th>SLA时间</th>");
  });
});
