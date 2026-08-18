/**
 * 改进报告占比饼图 - buildPieOption 纯函数单元测试
 * 覆盖文件：frontend/modules/pages/improvement-report-page.js（改进诉求领域占比/各阶段占比）
 *
 * 修复点：百分比并入图例（名称 xx.x%）、关闭扇区外置标签（label/labelLine.show=false），
 * 消除外置 {d}% 标签与右侧图例互相遮挡、贴边裁剪。
 * 月度报告页不随改进报告改动（解耦边界），页面级挂载/数据链路由 e2e（test_e2e_improvement_report.py）覆盖。
 */

const fs = require("fs");
const path = require("path");

const readSrc = (rel) =>
  fs.readFileSync(path.resolve(__dirname, rel), "utf8");
const irSrc = readSrc("../../../frontend/modules/pages/improvement-report-page.js");

// 简化策略：直接复制需要测试的纯函数到此处（保持与源文件同步，哨兵用例防止源漂移）
function buildPieOption(title, items) {
  const data = (items || []).filter((d) => Number(d.value || 0) > 0)
    .map((d) => ({ name: String(d.name || ""), value: Number(d.value || 0) }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const pctByName = {};
  data.forEach((d) => { pctByName[d.name] = total > 0 ? (d.value * 100) / total : 0; });
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: {
      orient: "vertical", right: 4, top: "middle", type: "scroll", height: "90%",
      formatter: (name) => (pctByName[name] != null ? `${name}  ${pctByName[name].toFixed(1)}%` : name),
    },
    series: [{
      name: title,
      type: "pie",
      radius: ["40%", "64%"],
      center: ["40%", "50%"],
      avoidLabelOverlap: true,
      label: { show: false },
      labelLine: { show: false },
      data,
    }],
  };
}

describe("源文件哨兵（改进报告页实现，源改动时提示同步本测试）", () => {
  const SNIPPET_LABEL_OFF = "label: { show: false },";
  const SNIPPET_LABELLINE_OFF = "labelLine: { show: false },";
  const SNIPPET_FMT = "formatter: (name) => (pctByName[name] != null ? `${name}  ${pctByName[name].toFixed(1)}%` : name),";

  test("improvement-report-page.js：外置标签已关闭、百分比并入图例", () => {
    expect(irSrc).toContain(SNIPPET_LABEL_OFF);
    expect(irSrc).toContain(SNIPPET_LABELLINE_OFF);
    expect(irSrc).toContain(SNIPPET_FMT);
    expect(irSrc).toContain("const pctByName = {};");
    // 旧的外置百分比标签实现应已移除（防止回退）
    expect(irSrc).not.toContain('label: { show: true, formatter: "{d}%" }');
  });

  test("tooltip 明细口径不变（名称: 数量 (百分比%)）", () => {
    expect(irSrc).toContain('formatter: "{b}: {c} ({d}%)"');
  });
});

describe("buildPieOption 数据与百分比计算", () => {
  test("零值项被过滤，不进扇区也不进图例", () => {
    const opt = buildPieOption("阶段占比", [
      { name: "提出", value: 3 },
      { name: "评审", value: 0 },
      { name: "确认", value: 1 },
    ]);
    expect(opt.series[0].data).toEqual([
      { name: "提出", value: 3 },
      { name: "确认", value: 1 },
    ]);
  });

  test("图例 formatter 输出「名称  xx.x%」且比例正确", () => {
    const opt = buildPieOption("领域占比", [
      { name: "领域A", value: 3 },
      { name: "领域B", value: 1 },
    ]);
    const fmt = opt.legend.formatter;
    expect(fmt("领域A")).toBe("领域A  75.0%");
    expect(fmt("领域B")).toBe("领域B  25.0%");
  });

  test("多小扇区百分比保留 1 位小数（对应 53 领域场景）", () => {
    const items = Array.from({ length: 53 }, (_, i) => ({ name: `领域${i}`, value: 1 }));
    const opt = buildPieOption("领域占比", items);
    expect(opt.series[0].data).toHaveLength(53);
    expect(opt.legend.formatter("领域10")).toBe("领域10  1.9%");
  });

  test("全部为零/空数据不产生 NaN（total=0 防除零）", () => {
    for (const items of [[], [{ name: "A", value: 0 }], null]) {
      const opt = buildPieOption("领域占比", items);
      expect(opt.series[0].data).toEqual([]);
      // 数据为空 → 没有已知名称，formatter 未知名回退原名（不崩、不出 NaN%）
      expect(opt.legend.formatter("任意名")).toBe("任意名");
    }
  });

  test("formatter 对未知名称回退为纯名称（不出 undefined%）", () => {
    const opt = buildPieOption("领域占比", [{ name: "SQL引擎", value: 5 }]);
    expect(opt.legend.formatter("不存在的领域")).toBe("不存在的领域");
  });
});

describe("buildPieOption 遮挡修复的 option 形状", () => {
  test("外置百分比标签与引导线均已关闭", () => {
    const opt = buildPieOption("领域占比", [{ name: "A", value: 2 }]);
    expect(opt.series[0].label.show).toBe(false);
    expect(opt.series[0].labelLine.show).toBe(false);
  });

  test("tooltip 保持明细口径（数量+精确百分比在悬浮时可见）", () => {
    const opt = buildPieOption("领域占比", [{ name: "A", value: 2 }]);
    expect(opt.tooltip).toEqual({ trigger: "item", formatter: "{b}: {c} ({d}%)" });
  });
});
