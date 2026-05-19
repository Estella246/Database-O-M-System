/**
 * 咨询问题与非咨询问题Doer效率统计功能测试
 * 测试目标：frontend/modules/pages/stats-page.js 和 stats.js
 */

// 共用的Doer分类辅助函数
function statsTicketDoerAssistCategoryMulti(nodes, includeOps, includeDev) {
  const STAT_DOER_CATEGORY_PRIORITY = {
    doer_resolved: 5,
    doer_helped: 4,
    doer_no_help: 3,
    no_doer: 2,
    urgent_hard: 2,
    not_filled: 1,
    unknown: 0,
  };

  function classifySinglePhaseDoerAssist(phaseNodeData) {
    const val = phaseNodeData?.use_doer_assist || "";
    if (val === "使用Doer，问题定位/解决") return "doer_resolved";
    if (val === "使用Doer，仅提供思路/辅助提效") return "doer_helped";
    if (val === "使用Doer，无帮助") return "doer_no_help";
    if (val === "未使用Doer") return "no_doer";
    if (val === "紧急疑难工单") return "urgent_hard";
    if (!phaseNodeData || val === "") return "not_filled";
    return "unknown";
  }

  const categories = [];
  if (includeOps) categories.push(classifySinglePhaseDoerAssist(nodes?.ops_analysis));
  if (includeDev) categories.push(classifySinglePhaseDoerAssist(nodes?.dev_analysis));
  if (categories.length === 0) return "unknown";

  let maxPriority = -1;
  let bestCategory = "unknown";
  for (const cat of categories) {
    const priority = STAT_DOER_CATEGORY_PRIORITY[cat] || 0;
    if (priority > maxPriority) {
      maxPriority = priority;
      bestCategory = cat;
    }
  }
  return bestCategory;
}

// 阶段映射常量
const DOER_EFFICIENCY_STAGE_MAP = {
  problem_review: "问题审核",
  ops_analysis: "运维分析",
  dev_analysis: "开发分析",
  dev_closure: "开发闭环",
  ops_closure: "运维闭环",
  audit_close: "审核关闭",
};

// 共用的计算逻辑
function calculateEfficiencyStats(tickets) {
  const stageKeys = ["problem_review", "ops_analysis", "dev_analysis", "dev_closure", "ops_closure", "audit_close"];
  const stages = stageKeys.map((k) => DOER_EFFICIENCY_STAGE_MAP[k] || k);

  // 分类：使用Doer vs 未使用Doer
  const usedDoerTickets = [];
  const noDoerTickets = [];

  tickets.forEach((item) => {
    const category = statsTicketDoerAssistCategoryMulti(item.nodes, true, true);
    if (category === "doer_resolved" || category === "doer_helped" || category === "doer_no_help") {
      usedDoerTickets.push(item);
    } else if (category === "no_doer") {
      noDoerTickets.push(item);
    }
  });

  // 计算各阶段平均滞留时间
  const avgHoursUsedDoer = stageKeys.map((nodeKey) => {
    const hoursList = usedDoerTickets
      .map((t) => t.instances?.[nodeKey]?.hours || 0)
      .filter((h) => h > 0);
    if (hoursList.length === 0) return 0;
    return hoursList.reduce((a, b) => a + b, 0) / hoursList.length;
  });

  const avgHoursNoDoer = stageKeys.map((nodeKey) => {
    const hoursList = noDoerTickets
      .map((t) => t.instances?.[nodeKey]?.hours || 0)
      .filter((h) => h > 0);
    if (hoursList.length === 0) return 0;
    return hoursList.reduce((a, b) => a + b, 0) / hoursList.length;
  });

  // 计算效率提升百分比
  const efficiencyGains = avgHoursNoDoer.map((noDoerHours, i) => {
    const usedHours = avgHoursUsedDoer[i];
    if (noDoerHours === 0) return 0;
    return Math.round(((noDoerHours - usedHours) / noDoerHours) * 100);
  });

  // 计算整体效率提升
  const validGains = efficiencyGains.filter((g) => g > 0);
  const avgEfficiencyGain = validGains.length > 0 ? Math.round(validGains.reduce((a, b) => a + b, 0) / validGains.length) : 0;

  // 找效率提升最高的阶段
  let maxGainStage = "";
  let maxGainValue = 0;
  efficiencyGains.forEach((gain, i) => {
    if (gain > maxGainValue) {
      maxGainValue = gain;
      maxGainStage = stages[i];
    }
  });

  return {
    stages,
    stageKeys,
    avgHoursUsedDoer,
    avgHoursNoDoer,
    efficiencyGains,
    avgEfficiencyGain,
    maxGainStage,
    maxGainValue,
    usedDoerCount: usedDoerTickets.length,
    noDoerCount: noDoerTickets.length,
    totalCount: tickets.length,
  };
}

// 咨询问题Doer效率数据处理函数
function processConsultIssueDoerEfficiencyData(items) {
  // 1. 筛选咨询类问题（is_consult_issue = "是"）
  const consultTickets = items.filter((item) => {
    const opsData = item.nodes?.ops_analysis || {};
    const devData = item.nodes?.dev_analysis || {};
    return opsData.is_consult_issue === "是" || devData.is_consult_issue === "是";
  });

  const result = calculateEfficiencyStats(consultTickets);
  return {
    ...result,
    totalConsultCount: consultTickets.length,
  };
}

// 非咨询问题Doer效率数据处理函数
function processNonConsultIssueDoerEfficiencyData(items) {
  // 1. 筛选非咨询类问题（is_consult_issue = "否")
  const nonConsultTickets = items.filter((item) => {
    const opsData = item.nodes?.ops_analysis || {};
    const devData = item.nodes?.dev_analysis || {};
    // 需明确是"否"，排除未填写的（空值不属于非咨询）
    return opsData.is_consult_issue === "否" || devData.is_consult_issue === "否";
  });

  const result = calculateEfficiencyStats(nonConsultTickets);
  return {
    ...result,
    totalNonConsultCount: nonConsultTickets.length,
  };
}

// 模拟分组柱状图SVG渲染函数
function statLaborSvgGroupedBars(groups, seriesNames, getValues, opts = {}) {
  const W = 620;
  const H = 300;
  const seriesColors = opts.seriesColors || ["#22c55e", "#94a3b8"];

  let bars = "";
  const nGroups = groups.length;
  const nSeries = seriesNames.length;

  for (let gi = 0; gi < nGroups; gi++) {
    for (let si = 0; si < nSeries; si++) {
      const val = getValues(gi, si) || 0;
      if (val > 0) {
        const fill = seriesColors[si];
        bars += `<path fill="${fill}" data-gi="${gi}" data-si="${si}" data-val="${val.toFixed(1)}">`;
      }
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}">${bars}</svg>`;
}

describe("咨询问题Doer效率统计", () => {
  describe("数据筛选逻辑", () => {
    test("正确筛选is_consult_issue为'是'的工单", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { nodes: { dev_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.totalConsultCount).toBe(2);
    });

    test("开发分析继承运维分析的咨询问题标识", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "是" }, dev_analysis: {} } },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.totalConsultCount).toBe(1);
    });

    test("无咨询问题时返回空数据", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.totalConsultCount).toBe(0);
      expect(result.usedDoerCount).toBe(0);
      expect(result.noDoerCount).toBe(0);
    });
  });

  describe("Doer分类逻辑", () => {
    test("向上取整：任一阶段使用Doer即归类为使用Doer", () => {
      const items = [
        {
          nodes: {
            ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" },
            dev_analysis: { use_doer_assist: "未使用Doer" },
          },
          instances: { ops_analysis: { hours: 2 }, dev_analysis: { hours: 3 } },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.usedDoerCount).toBe(1);
      expect(result.noDoerCount).toBe(0);
    });

    test("两阶段都是未使用Doer归类为未使用Doer", () => {
      const items = [
        {
          nodes: {
            ops_analysis: { is_consult_issue: "是", use_doer_assist: "未使用Doer" },
            dev_analysis: { use_doer_assist: "未使用Doer" },
          },
          instances: {},
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.noDoerCount).toBe(1);
      expect(result.usedDoerCount).toBe(0);
    });

    test("排除紧急疑难工单", () => {
      const items = [
        {
          nodes: {
            ops_analysis: { is_consult_issue: "是", use_doer_assist: "紧急疑难工单" },
          },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.usedDoerCount + result.noDoerCount).toBe(0);
    });

    test("排除未填写Doer情况的工单", () => {
      const items = [
        {
          nodes: {
            ops_analysis: { is_consult_issue: "是", use_doer_assist: "" },
          },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.usedDoerCount + result.noDoerCount).toBe(0);
    });
  });

  describe("滞留时间计算", () => {
    test("正确计算平均滞留时间", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 2.0 }, dev_analysis: { hours: 3.0 } },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 4.0 }, dev_analysis: { hours: 6.0 } },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      // ops_analysis阶段索引为1，平均 (2+4)/2 = 3
      expect(result.avgHoursUsedDoer[1]).toBeCloseTo(3.0, 0.01);
      // dev_analysis阶段索引为2，平均 (3+6)/2 = 4.5
      expect(result.avgHoursUsedDoer[2]).toBeCloseTo(4.5, 0.01);
    });

    test("处理无滞留时间数据的工单", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: {},
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.avgHoursUsedDoer.every((h) => h === 0)).toBe(true);
    });
  });

  describe("效率提升百分比计算", () => {
    test("正确计算效率提升百分比", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 3.0 } },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "未使用Doer" } },
          instances: { ops_analysis: { hours: 6.0 } },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      // ops_analysis阶段：使用Doer 3小时，未使用Doer 6小时
      // 效率提升 = (6-3)/6 * 100 = 50%
      expect(result.efficiencyGains[1]).toBe(50);
    });

    test("未使用Doer为0时返回0", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 2 } },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.noDoerCount).toBe(0);
      expect(result.efficiencyGains.every((g) => g === 0)).toBe(true);
    });

    test("效率提升超过100%的情况（使用Doer时间更短）", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 1.0 } },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "未使用Doer" } },
          instances: { ops_analysis: { hours: 10.0 } },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      // 效率提升 = (10-1)/10 * 100 = 90%
      expect(result.efficiencyGains[1]).toBe(90);
    });
  });

  describe("分组柱状图渲染", () => {
    test("正确渲染分组柱状图SVG", () => {
      const svg = statLaborSvgGroupedBars(
        ["问题审核", "运维分析"],
        ["使用Doer", "未使用Doer"],
        (gi, si) => (gi === 0 ? (si === 0 ? 2 : 4) : (si === 0 ? 3 : 6)),
        { seriesColors: ["#22c55e", "#94a3b8"] }
      );
      expect(svg).toContain("svg");
      expect(svg).toContain("#22c55e");
      expect(svg).toContain("#94a3b8");
    });

    test("值为0时不渲染柱子", () => {
      const svg = statLaborSvgGroupedBars(
        ["问题审核"],
        ["使用Doer", "未使用Doer"],
        () => 0,
        {}
      );
      expect(svg).not.toContain("path fill");
    });
  });

  describe("KPI数据完整性", () => {
    test("返回完整KPI数据结构", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 2 } },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "未使用Doer" } },
          instances: { ops_analysis: { hours: 4 } },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      expect(result.stages).toBeDefined();
      expect(result.avgHoursUsedDoer).toBeDefined();
      expect(result.avgHoursNoDoer).toBeDefined();
      expect(result.efficiencyGains).toBeDefined();
      expect(result.avgEfficiencyGain).toBeDefined();
      expect(result.maxGainStage).toBeDefined();
      expect(result.maxGainValue).toBeDefined();
      expect(result.usedDoerCount).toBeDefined();
      expect(result.noDoerCount).toBeDefined();
      expect(result.totalConsultCount).toBeDefined();
    });

    test("找到效率提升最高的阶段", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: {
            ops_analysis: { hours: 2 },
            dev_analysis: { hours: 1 },
          },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "未使用Doer" } },
          instances: {
            ops_analysis: { hours: 8 },
            dev_analysis: { hours: 10 },
          },
        },
      ];
      const result = processConsultIssueDoerEfficiencyData(items);
      // ops_analysis: (8-2)/8 = 75%
      // dev_analysis: (10-1)/10 = 90%
      expect(result.maxGainStage).toBe("开发分析");
      expect(result.maxGainValue).toBe(90);
    });
  });
});

describe("非咨询问题Doer效率统计", () => {
  describe("数据筛选逻辑", () => {
    test("正确筛选is_consult_issue为'否'的工单", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { nodes: { dev_analysis: { is_consult_issue: "否" } } },
        { nodes: { ops_analysis: { is_consult_issue: "" } } }, // 空值不属于非咨询
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.totalNonConsultCount).toBe(2);
    });

    test("开发分析继承运维分析的非咨询问题标识", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "否" }, dev_analysis: {} } },
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.totalNonConsultCount).toBe(1);
    });

    test("无非咨询问题时返回空数据", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { nodes: { ops_analysis: { is_consult_issue: "" } } }, // 空值不计入
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.totalNonConsultCount).toBe(0);
      expect(result.usedDoerCount).toBe(0);
      expect(result.noDoerCount).toBe(0);
    });

    test("空值不被计入非咨询问题", () => {
      const items = [
        { nodes: { ops_analysis: {} } }, // 无is_consult_issue字段
        { nodes: { ops_analysis: { is_consult_issue: "" } } }, // 空字符串
        { nodes: { ops_analysis: { is_consult_issue: "否" } } }, // 正确的"否"
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.totalNonConsultCount).toBe(1);
    });
  });

  describe("Doer分类逻辑", () => {
    test("正确分类使用Doer的非咨询问题", () => {
      const items = [
        {
          nodes: {
            ops_analysis: { is_consult_issue: "否", use_doer_assist: "使用Doer，问题定位/解决" },
          },
          instances: { ops_analysis: { hours: 2 } },
        },
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.usedDoerCount).toBe(1);
      expect(result.noDoerCount).toBe(0);
    });

    test("正确分类未使用Doer的非咨询问题", () => {
      const items = [
        {
          nodes: {
            ops_analysis: { is_consult_issue: "否", use_doer_assist: "未使用Doer" },
          },
          instances: {},
        },
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.noDoerCount).toBe(1);
      expect(result.usedDoerCount).toBe(0);
    });
  });

  describe("滞留时间计算", () => {
    test("正确计算非咨询问题的平均滞留时间", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "否", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 3.0 }, dev_analysis: { hours: 5.0 } },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "否", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 5.0 }, dev_analysis: { hours: 7.0 } },
        },
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      // ops_analysis阶段索引为1，平均 (3+5)/2 = 4
      expect(result.avgHoursUsedDoer[1]).toBeCloseTo(4.0, 0.01);
      // dev_analysis阶段索引为2，平均 (5+7)/2 = 6
      expect(result.avgHoursUsedDoer[2]).toBeCloseTo(6.0, 0.01);
    });
  });

  describe("效率提升百分比计算", () => {
    test("正确计算非咨询问题的效率提升", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "否", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 2.0 } },
        },
        {
          nodes: { ops_analysis: { is_consult_issue: "否", use_doer_assist: "未使用Doer" } },
          instances: { ops_analysis: { hours: 8.0 } },
        },
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      // ops_analysis阶段：使用Doer 2小时，未使用Doer 8小时
      // 效率提升 = (8-2)/8 * 100 = 75%
      expect(result.efficiencyGains[1]).toBe(75);
    });
  });

  describe("KPI数据完整性", () => {
    test("返回完整KPI数据结构", () => {
      const items = [
        {
          nodes: { ops_analysis: { is_consult_issue: "否", use_doer_assist: "使用Doer，问题定位/解决" } },
          instances: { ops_analysis: { hours: 2 } },
        },
      ];
      const result = processNonConsultIssueDoerEfficiencyData(items);
      expect(result.stages).toBeDefined();
      expect(result.avgHoursUsedDoer).toBeDefined();
      expect(result.avgHoursNoDoer).toBeDefined();
      expect(result.efficiencyGains).toBeDefined();
      expect(result.avgEfficiencyGain).toBeDefined();
      expect(result.maxGainStage).toBeDefined();
      expect(result.maxGainValue).toBeDefined();
      expect(result.usedDoerCount).toBeDefined();
      expect(result.noDoerCount).toBeDefined();
      expect(result.totalNonConsultCount).toBeDefined();
    });
  });

  describe("咨询与非咨询问题隔离", () => {
    test("同一工单不会被同时计入咨询和非咨询统计", () => {
      const items = [
        { nodes: { ops_analysis: { is_consult_issue: "是", use_doer_assist: "使用Doer，问题定位/解决" } } },
        { nodes: { ops_analysis: { is_consult_issue: "否", use_doer_assist: "使用Doer，问题定位/解决" } } },
        { nodes: { ops_analysis: { is_consult_issue: "", use_doer_assist: "使用Doer，问题定位/解决" } } },
      ];
      const consultResult = processConsultIssueDoerEfficiencyData(items);
      const nonConsultResult = processNonConsultIssueDoerEfficiencyData(items);

      // 咨询问题：1个
      expect(consultResult.totalConsultCount).toBe(1);
      // 非咨询问题：1个（空值不计入）
      expect(nonConsultResult.totalNonConsultCount).toBe(1);
      // 总数应等于items数减去空值
      expect(consultResult.totalConsultCount + nonConsultResult.totalNonConsultCount).toBe(2);
    });
  });
});

// ========== 月度咨询问题走势统计测试 ==========

// 格式化日期为本地YYYY-MM-DD格式
function formatYmdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 月度咨询问题数据处理函数
function processMonthlyConsultIssueData(items) {
  // 按自然月分组（格式：YYYY-MM）
  const byMonth = new Map();
  items.forEach((item) => {
    const createdAt = item.created_at;
    if (!createdAt) return;
    const d = new Date(createdAt);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, { total: 0, consult: 0 });
    }
    byMonth.get(monthKey).total += 1;
    // 判断是否为咨询问题
    const opsData = item.nodes?.ops_analysis || {};
    const devData = item.nodes?.dev_analysis || {};
    if (opsData.is_consult_issue === "是" || devData.is_consult_issue === "是") {
      byMonth.get(monthKey).consult += 1;
    }
  });

  // 按月份排序
  const sortedMonths = Array.from(byMonth.keys()).sort();
  const labels = sortedMonths;

  const barValues = sortedMonths.map((monthKey) => byMonth.get(monthKey)?.consult || 0);
  const lineValues = sortedMonths.map((monthKey) => {
    const data = byMonth.get(monthKey);
    if (!data || data.total === 0) return 0;
    return Math.round((data.consult / data.total) * 100);
  });

  // 计算总计
  const totalConsult = barValues.reduce((a, b) => a + b, 0);
  const totalTickets = sortedMonths.reduce((sum, monthKey) => sum + (byMonth.get(monthKey)?.total || 0), 0);
  const avgPct = totalTickets > 0 ? Math.round((totalConsult / totalTickets) * 100) : 0;

  return {
    labels,
    barValues,
    lineValues,
    totalConsult,
    totalTickets,
    avgPct,
    monthCount: sortedMonths.length,
  };
}

// 组合图表渲染函数（简化版）
function statLaborSvgBarLineCombo(labels, barValues, lineValues, opts = {}) {
  if (!labels || labels.length === 0) return "";
  const barColor = opts.barColor || "#22c55e";
  const lineColor = opts.lineColor || "#f97316";
  return `<svg data-bar-color="${barColor}" data-line-color="${lineColor}" data-labels="${labels.join(",")}"></svg>`;
}

describe("月度咨询问题走势统计", () => {
  describe("月份分组逻辑", () => {
    test("正确按自然月分组（YYYY-MM格式）", () => {
      const items = [
        { created_at: "2026-01-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-01-20T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { created_at: "2026-02-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-02-28T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.labels).toEqual(["2026-01", "2026-02"]);
      expect(result.monthCount).toBe(2);
    });

    test("同一月份的工单合并统计", () => {
      const items = [
        { created_at: "2026-03-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-03-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-03-31T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.labels).toEqual(["2026-03"]);
      expect(result.barValues[0]).toBe(2); // 两个咨询问题
      expect(result.totalTickets).toBe(3);
    });

    test("跨年月份正确分组", () => {
      const items = [
        { created_at: "2025-12-31T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-01-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.labels).toEqual(["2025-12", "2026-01"]);
      expect(result.monthCount).toBe(2);
    });
  });

  describe("咨询问题数量统计", () => {
    test("正确统计每月咨询问题数量", () => {
      const items = [
        { created_at: "2026-04-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-04-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-04-20T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.barValues[0]).toBe(2); // 2026-04有2个咨询问题
    });

    test("支持运维分析和开发分析两阶段判断咨询问题", () => {
      const items = [
        { created_at: "2026-05-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-05-02T10:00:00Z", nodes: { dev_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-05-03T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" }, dev_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.barValues[0]).toBe(3); // 所有都是咨询问题（任一阶段为"是"即算）
    });

    test("无咨询问题时数量为0", () => {
      const items = [
        { created_at: "2026-06-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { created_at: "2026-06-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.barValues[0]).toBe(0);
      expect(result.totalConsult).toBe(0);
    });
  });

  describe("占比百分比计算", () => {
    test("正确计算每月咨询问题占比", () => {
      const items = [
        { created_at: "2026-07-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-07-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { created_at: "2026-07-20T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { created_at: "2026-07-25T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      // 2026-07: 1个咨询问题 / 4个工单 = 25%
      expect(result.lineValues[0]).toBe(25);
    });

    test("100%占比的情况", () => {
      const items = [
        { created_at: "2026-08-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-08-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.lineValues[0]).toBe(100);
    });

    test("0%占比的情况", () => {
      const items = [
        { created_at: "2026-09-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.lineValues[0]).toBe(0);
    });
  });

  describe("整体统计计算", () => {
    test("正确计算整体咨询问题占比", () => {
      const items = [
        { created_at: "2026-10-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-10-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
        { created_at: "2026-11-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-11-15T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "否" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      // 总计: 2个咨询问题 / 4个工单 = 50%
      expect(result.totalConsult).toBe(2);
      expect(result.totalTickets).toBe(4);
      expect(result.avgPct).toBe(50);
    });

    test("无工单数据时返回空结果", () => {
      const result = processMonthlyConsultIssueData([]);
      expect(result.labels.length).toBe(0);
      expect(result.totalConsult).toBe(0);
      expect(result.totalTickets).toBe(0);
      expect(result.avgPct).toBe(0);
    });

    test("缺失created_at的工单被忽略", () => {
      const items = [
        { created_at: null, nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-12-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.totalTickets).toBe(1);
      expect(result.labels).toEqual(["2026-12"]);
    });
  });

  describe("月份排序", () => {
    test("月份按时间顺序排序", () => {
      const items = [
        { created_at: "2026-03-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-01-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
        { created_at: "2026-02-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.labels).toEqual(["2026-01", "2026-02", "2026-03"]);
    });
  });

  describe("图表渲染", () => {
    test("正确渲染组合图表SVG", () => {
      const data = {
        labels: ["2026-01", "2026-02"],
        barValues: [2, 3],
        lineValues: [50, 75],
        totalConsult: 5,
        totalTickets: 7,
        avgPct: 71,
      };
      const svg = statLaborSvgBarLineCombo(data.labels, data.barValues, data.lineValues, {
        barColor: "#22c55e",
        lineColor: "#f97316",
      });
      expect(svg).toContain("svg");
      expect(svg).toContain("#22c55e");
      expect(svg).toContain("#f97316");
      expect(svg).toContain("2026-01,2026-02");
    });

    test("空数据不渲染图表", () => {
      const svg = statLaborSvgBarLineCombo([], [], [], {});
      expect(svg).toBe("");
    });
  });

  describe("数据结构完整性", () => {
    test("返回完整数据结构", () => {
      const items = [
        { created_at: "2026-01-01T10:00:00Z", nodes: { ops_analysis: { is_consult_issue: "是" } } },
      ];
      const result = processMonthlyConsultIssueData(items);
      expect(result.labels).toBeDefined();
      expect(result.barValues).toBeDefined();
      expect(result.lineValues).toBeDefined();
      expect(result.totalConsult).toBeDefined();
      expect(result.totalTickets).toBeDefined();
      expect(result.avgPct).toBeDefined();
      expect(result.monthCount).toBeDefined();
    });
  });
});