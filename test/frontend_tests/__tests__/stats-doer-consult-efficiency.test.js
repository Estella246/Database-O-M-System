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