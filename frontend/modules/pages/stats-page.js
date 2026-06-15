import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { formatYmdLocal, localYmd, startOfLocalDay, nowText, ticketCreatedAtMs } from "../utils/format.js";
import { parseYmdToDate } from "../utils/date.js";
import { getAllTickets } from "./ticket-core.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import {
  bindDateRangePicker,
  renderDateRangeHtml,
  shouldSkipDateRangePresetFill,
} from "../ui/date-range-picker-bind.js";
import { MS_PER_DAY } from "../constants/theme.js";
import { WORKFLOW_NODES } from "../constants/workflow.js";
import {
  STAT_LABOR_STACK_STAGES,
  STAT_LABOR_PIE_STAGES,
  STAT_LABOR_CHART_COLORS,
  STAT_LABOR_STACK_CHART_COLORS,
  STAT_LABOR_SELECT_STATE_KEYS,
  STAT_LABOR_FIELD_STATE_KEYS,
  STAT_OWNERSHIP_R_LINES,
  STAT_OWNERSHIP_MULTILINE_REF_COLORS,
  STAT_OWNERSHIP_MODULES_L1,
  STAT_OWNERSHIP_SELECT_KEYS,
  statLaborHash,
  statLaborPeopleForGroupFilter,
  statLaborBarTopRoundPath,
  statLaborSvgBarVertical,
  statLaborSvgMultiLine,
  statLaborSvgDualAxisMultiLine,
  statLaborSvgLine,
  statLaborSvgStackedBars,
  statLaborSvgPie,
  statLaborPieLegend,
  statLaborStackLegend,
  statLaborSvgGroupedBars,
  statLaborGroupedLegend,
  statLaborSvgBarLineCombo,
  statLaborBarEntriesDesc,
  statOwnershipSplitLineStyle,
  statOwnershipAxisLabel,
  statsTicketDayYmd,
  statsNormalizePersonName,
  statsTicketPersonName,
  statsTicketStage,
  statsTicketIsQuality,
  statsTicketQualityIssueValue,
  statsFilterOwnershipRows,
  statsTicketComponent,
  statsTicketVersion,
  statsGroupByPrecisionLabel,
  statsCountBy,
  buildStatsOwnershipSunburstData,
  buildStatsOwnershipL1BarData,
  buildStatsOwnershipTopModuleBarData,
  buildStatsOwnershipSpcBarData,
  buildStatsOwnershipCoreBarData,
  buildStatsOwnershipHotspotTableData,
  statsOwnershipModuleKind,
  statsParseModulePathLevels,
  statsTicketModulePath,
  buildStatsOwnershipTimeLabels,
  buildStatsOwnershipZoomChartOption,
  withStatsCategoryXDataZoom,
  buildStatsLaborEchartBarOption,
  buildStatsLaborEchartStackedBarOption,
  buildStatsLaborEchartPieOption,
  statsTicketDoerAssistCategoryMulti,
  statsFindAdminUserByPerson,
  getStatsLaborProductLineOptions,
  statsTicketMatchesLaborProductLine,
} from "./stats.js";
import { ensureAdminWhitelistModalOnBody } from "./admin-page.js";
import {
  invalidateStatsChartsPayload,
  mapDoerPayloadToLegacy,
  runStatsDailyBackfill,
  statsChartsHasDateRange,
  statsChartsShowLoading,
} from "./stats-charts-api.js";

let statsOwnershipChartInstances = {};
let statsOwnershipResizeBound = false;
let statsLaborChartInstances = {};
let statsLaborResizeBound = false;
let statsLaborZoomEventBound = false;

export function ensureStatsChartsTab() {
  const key = "stats:charts";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "统计图表", closable: true });
  }
  return key;
}

export function applyStatsLaborPreset(preset) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  switch (preset) {
    case "1d":
      break;
    case "1w":
      start.setDate(start.getDate() - 6);
      break;
    case "1m":
      start.setDate(start.getDate() - 29);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return;
  }
  state.statsLaborPreset = preset;
  state.statsLaborStart = formatYmdLocal(start);
  state.statsLaborEnd = formatYmdLocal(end);
}

export function ensureStatsLaborRangeInit() {
  if (
    shouldSkipDateRangePresetFill(state.dateRangePicker, {
      pickerId: "stats-labor",
      start: state.statsLaborStart,
      end: state.statsLaborEnd,
      preset: state.statsLaborPreset,
    })
  ) {
    return;
  }
  if (!state.statsLaborStart || !state.statsLaborEnd) {
    applyStatsLaborPreset(state.statsLaborPreset || "1w");
  }
}

export function applyStatsOwnershipPreset(preset) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  switch (preset) {
    case "1d":
      break;
    case "1w":
      start.setDate(start.getDate() - 6);
      break;
    case "1m":
      start.setDate(start.getDate() - 29);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return;
  }
  state.statsOwnershipPreset = preset;
  state.statsOwnershipStart = formatYmdLocal(start);
  state.statsOwnershipEnd = formatYmdLocal(end);
}

export function ensureStatsOwnershipRangeInit() {
  if (
    shouldSkipDateRangePresetFill(state.dateRangePicker, {
      pickerId: "stats-ownership",
      start: state.statsOwnershipStart,
      end: state.statsOwnershipEnd,
      preset: state.statsOwnershipPreset,
    })
  ) {
    return;
  }
  if (!state.statsOwnershipStart || !state.statsOwnershipEnd) {
    applyStatsOwnershipPreset(state.statsOwnershipPreset || "1w");
  }
}

export function statsOwnershipQuerySeed() {
  ensureStatsOwnershipRangeInit();
  return [
    state.statsOwnershipStart,
    state.statsOwnershipEnd,
    state.statsOwnershipPrecision,
    state.statsOwnershipQuality,
    state.statsOwnershipComponent,
  ].join("|");
}

/** 受「是否质量问题」筛选影响的图表数据源；未筛选时与全量 payload 相同 */
export function getStatsOwnershipQualityScopedPayload() {
  const base = state.statsChartsPayload?.ownership;
  if (!base) return null;
  const q = String(state.statsOwnershipQuality || "all").trim();
  if (q === "all") return base;
  return state.statsChartsPayload?.ownershipQualityScoped || null;
}

export function statsTicketsInRange(startYmd, endYmd) {
  const start = parseYmdToDate(startYmd);
  const end = parseYmdToDate(endYmd);
  const all = getAllTickets();
  if (!start || !end || start > end) return all;
  const s = formatYmdLocal(start);
  const e = formatYmdLocal(end);
  return all.filter((t) => {
    const ymd = statsTicketDayYmd(t);
    return ymd && ymd >= s && ymd <= e;
  });
}

export function statsUserGroupByTicket(ticket) {
  const handler = String(ticket?.currentHandler || ticket?.assignee || "").trim();
  const creator = String(ticket?.creatorName || "").trim();
  const candidates = [handler, creator].filter(Boolean);
  for (let i = 0; i < candidates.length; i += 1) {
    const hit = statsFindAdminUserByPerson(candidates[i], state.adminUsers);
    if (hit && String(hit.group_name || "").trim()) return String(hit.group_name || "").trim();
  }
  return "未分组";
}

export function getStatsLaborSelectedProductLine() {
  const cur = String(state.statsLaborProductLine || "").trim();
  if (!cur) return "";
  return getStatsLaborProductLineOptions(state.adminUsers).includes(cur) ? cur : "";
}

export function getStatsLaborGroupOptions() {
  const set = new Set();
  state.adminUsers.forEach((u) => {
    const g = String(u.group_name || "").trim();
    if (g) set.add(g);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function getStatsLaborSelectedGroup(stateKey) {
  const cur = String(state[stateKey] || "").trim();
  if (!cur) return "";
  return getStatsLaborGroupOptions().includes(cur) ? cur : "";
}

export function statOwnershipDisposeCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  Object.keys(statsOwnershipChartInstances).forEach((k) => {
    try {
      statsOwnershipChartInstances[k].dispose();
    } catch (_) {
      // ignore
    }
  });
  statsOwnershipChartInstances = {};
}

export function statLaborDisposeCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  Object.keys(statsLaborChartInstances).forEach((k) => {
    try {
      statsLaborChartInstances[k].dispose();
    } catch (_) {
      // ignore
    }
  });
  statsLaborChartInstances = {};
}

export function buildStatsLaborChartOptions() {
  const cube = state.statsChartsPayload?.labor;
  if (!cube) return {};
  const counts = cube.counts || {};
  const dwell = cube.dwell?.by_stage_hours || {};
  const stages3 = WORKFLOW_NODES.filter((_, idx) => idx > 0 && idx < 7);
  const dwellStages = WORKFLOW_NODES.slice(1);

  const selectedGroup = getStatsLaborSelectedGroup("statsLaborGroup");
  const byPersonInput = selectedGroup
    ? counts.by_group_person?.[selectedGroup] || {}
    : counts.by_person || {};
  const { labels: people1b, values: vals1 } = statLaborBarEntriesDesc(byPersonInput);

  const byPersonOpen = selectedGroup
    ? counts.by_group_person_open?.[selectedGroup] || {}
    : counts.by_person_open || {};
  const { labels: people2b, values: vals2 } = statLaborBarEntriesDesc(byPersonOpen);

  const byStage =
    selectedGroup && counts.by_group_stage_open?.[selectedGroup]
      ? counts.by_group_stage_open[selectedGroup]
      : counts.by_stage_open || {};
  const vals3 = stages3.map((s) => byStage[s] || 0);

  const allGroupOptions = cube.groups?.length ? cube.groups : getStatsLaborGroupOptions();
  const stackGroups = selectedGroup ? [selectedGroup] : allGroupOptions;

  const hours5 = dwellStages.map((stage) => Math.round(dwell[stage] || 0));

  const byPersonStage = counts.by_person_stage || {};
  const people6b = Object.keys(byPersonStage).filter((name) => name && name !== "未分配").slice(0, 12);
  const personDwellStages = [...STAT_LABOR_STACK_STAGES];

  const stageAll = counts.by_stage_all || {};
  const pie7Slices = (cube.pie_stages || STAT_LABOR_PIE_STAGES).map((label) => ({
    label,
    value: stageAll[label] || 0,
  }));

  const flowKeys = ["流转至尖刀连", "独立闭环"];
  const byPersonFlow = counts.by_person_flow || {};
  const people10b = Object.keys(byPersonFlow).filter((name) => name && name !== "未分配").slice(0, 12);

  return {
    laborInput: buildStatsLaborEchartBarOption(
      people1b.length ? people1b : ["—"],
      vals1.length ? vals1 : [0]
    ),
    laborOhp: buildStatsLaborEchartBarOption(
      people2b.length ? people2b : ["—"],
      vals2.length ? vals2 : [0]
    ),
    laborOhs: buildStatsLaborEchartBarOption(stages3, vals3, {
      colors: stages3.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 2) % STAT_LABOR_CHART_COLORS.length]),
    }),
    laborGs: buildStatsLaborEchartStackedBarOption(
      stackGroups,
      STAT_LABOR_STACK_STAGES,
      (gi, key) => counts.by_group_stage_open?.[stackGroups[gi]]?.[key] || 0
    ),
    laborDwell: buildStatsLaborEchartBarOption(dwellStages, hours5, {
      colors: dwellStages.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 1) % STAT_LABOR_CHART_COLORS.length]),
      yUnit: "小时",
    }),
    laborPdw: buildStatsLaborEchartStackedBarOption(
      people6b.length ? people6b : ["—"],
      personDwellStages,
      (gi, key) => byPersonStage[people6b[gi]]?.[key] || 0
    ),
    laborPie7: buildStatsLaborEchartPieOption(pie7Slices),
    laborFd: buildStatsLaborEchartStackedBarOption(
      people10b.length ? people10b : ["—"],
      flowKeys,
      (gi, key) => byPersonFlow[people10b[gi]]?.[key] || 0
    ),
  };
}

const STATS_LABOR_ECHART_IDS = {
  laborInput: "stats-labor-echart-laborInput",
  laborOhp: "stats-labor-echart-laborOhp",
  laborOhs: "stats-labor-echart-laborOhs",
  laborGs: "stats-labor-echart-laborGs",
  laborDwell: "stats-labor-echart-laborDwell",
  laborPdw: "stats-labor-echart-laborPdw",
  laborPie7: "stats-labor-echart-laborPie7",
  laborFd: "stats-labor-echart-laborFd",
};

export function mountStatsLaborCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  statLaborDisposeCharts();
  const opts = buildStatsLaborChartOptions();
  const paintLaborCharts = (attempt = 0) => {
    let needsRetry = false;
    Object.keys(STATS_LABOR_ECHART_IDS).forEach((key) => {
      const el = document.getElementById(STATS_LABOR_ECHART_IDS[key]);
      if (!el) return;
      const existing = statsLaborChartInstances[key];
      if (existing?.__statsLaborPainted) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if ((w < 2 || h < 2) && attempt < 10) {
        needsRetry = true;
        return;
      }
      let chart = existing;
      if (!chart) {
        chart = E.init(el, null, { renderer: "canvas" });
        statsLaborChartInstances[key] = chart;
      }
      try {
        chart.resize();
      } catch (_) {
        // ignore
      }
      chart.setOption(opts[key], { notMerge: true });
      chart.__statsLaborPainted = true;
    });
    if (needsRetry) {
      requestAnimationFrame(() => paintLaborCharts(attempt + 1));
    }
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => paintLaborCharts(0));
  });
  if (!statsLaborResizeBound) {
    statsLaborResizeBound = true;
    window.addEventListener(
      "resize",
      () => {
        if (state.activeKey !== "stats:charts" || state.statsChartsTab !== "labor") return;
        Object.values(statsLaborChartInstances).forEach((c) => {
          try {
            c.resize();
          } catch (_) {
            // ignore
          }
        });
      },
      { passive: true }
    );
  }
}

export function buildStatsOwnershipChartOptions() {
  const payload = state.statsChartsPayload?.ownership;
  if (!payload) return {};
  const scoped = getStatsOwnershipQualityScopedPayload();
  ensureStatsOwnershipRangeInit();
  const timeLabels = payload.time_labels || ["—"];
  const n = timeLabels.length;
  const lineAnim = { animation: true, animationDuration: 980, animationEasing: "cubicOut" };
  const totalLine = payload.trend?.total || [];
  const qualityYesLine = payload.trend?.quality_yes || [];
  const knownQualityLine = payload.trend?.known || [];
  const newQualityLine = payload.trend?.new || [];

  const scopedLabels = scoped?.time_labels || timeLabels;
  const scopedN = scopedLabels.length;

  const byVersionTime = scoped?.by_version_time || {};
  const versionsForSeries = Object.keys(byVersionTime).length ? Object.keys(byVersionTime) : [];
  const verSeries = versionsForSeries.map((ver, vi) => ({
    name: ver,
    type: "line",
    smooth: 0.22,
    symbol: "circle",
    symbolSize: 5,
    showSymbol: scopedN < 18,
    lineStyle: { width: vi < 4 ? 2.2 : 1.4 },
    data: byVersionTime[ver] || [],
  }));

  const byBizEnvTime = scoped?.by_biz_env_time || {};
  const envKeys = Object.keys(byBizEnvTime);
  const bizLines = envKeys.map((name, bi) => {
    const c = STAT_OWNERSHIP_MULTILINE_REF_COLORS[bi % STAT_OWNERSHIP_MULTILINE_REF_COLORS.length];
    return {
      name,
      type: "line",
      smooth: 0.25,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: scopedN < 18,
      lineStyle: { color: c, width: 2 },
      itemStyle: { color: c },
      data: byBizEnvTime[name] || [],
    };
  });

  const byRTime = scoped?.by_r_version_time || {};
  const rSeries = STAT_OWNERSHIP_R_LINES.map((name, ri) => {
    const c = STAT_OWNERSHIP_MULTILINE_REF_COLORS[ri % STAT_OWNERSHIP_MULTILINE_REF_COLORS.length];
    return {
      name,
      type: "line",
      smooth: 0.22,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: scopedN < 18,
      lineStyle: { color: c, width: 2 },
      itemStyle: { color: c },
      data: byRTime[name] || [],
    };
  });

  const sunburstKind = statsOwnershipModuleKind(state.statsOwnershipSunburstKind);
  let sunData = (scoped?.sunburst && scoped.sunburst[sunburstKind]) || [];
  if (!sunData.length && scoped && String(state.statsOwnershipQuality || "all") !== "all") {
    const localRows = statsFilterOwnershipRows(
      statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd),
      state.statsOwnershipQuality,
      state.statsOwnershipComponent
    );
    if (localRows.length) {
      sunData = buildStatsOwnershipSunburstData(localRows, sunburstKind);
    }
  }

  const l1ModuleKey = state.statsOwnershipL1ModuleFilter || "storage";
  const l1Kind = statsOwnershipModuleKind(state.statsOwnershipL1Class);
  const l1Dedup = state.statsOwnershipL1DtsDedup === "yes" ? "dedup" : "raw";
  const l1Bars =
    (scoped?.l1_bars && scoped.l1_bars[l1Kind] && scoped.l1_bars[l1Kind][`${l1ModuleKey}_${l1Dedup}`]) || [];

  const topN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopSiteN) || 10));
  const sitePick = (payload.top_site || []).slice(0, topN).map((x) => x.name);
  const topSiteVals = (payload.top_site || []).slice(0, topN).map((x) => x.value);

  const topInstN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopInstanceSiteN) || 10));
  const instPick = (payload.top_inst_site || []).slice(0, topInstN).map((x) => x.name);
  const topInstVals = (payload.top_inst_site || []).slice(0, topInstN).map((x) => x.value);

  const allVersionsForSeries = Object.keys(payload.by_version_time || {}).length
    ? Object.keys(payload.by_version_time || {})
    : [];
  const shortVers = allVersionsForSeries.slice(0, 5);
  const byVersionMap = Object.fromEntries((payload.top_ver || []).map((x) => [x.name, x.value]));
  const topVerVals = shortVers.map((v) => byVersionMap[v] || 0);
  const instVerMap = Object.fromEntries((payload.top_inst_ver || []).map((x) => [x.name, x.value]));
  const topInstVerVals = shortVers.map((v) => instVerMap[v] || 0);

  const spcBars = payload.spc_bars || [];
  const spcKeys = spcBars.map((x) => x.name);
  const spcVals = spcBars.map((x) => x.value);
  const instSpcBars = payload.inst_spc_bars || [];
  const topInstSpcKeys = instSpcBars.map((x) => x.name);
  const topInstSpcVals = instSpcBars.map((x) => x.value);

  const coreBars = scoped?.core_bars || [];
  const coreKeys = coreBars.map((x) => x.name);
  const coreVals = coreBars.map((x) => x.value);

  const topModKind = statsOwnershipModuleKind(state.statsOwnershipTopModuleKind);
  const topModBars = (topModKind === "owner" ? payload.top_mod_owner : payload.top_mod_intro) || [];
  const topModLabs = topModBars.map((x) => x.name);
  const topModVals = topModBars.map((x) => x.value);

  const commonTooltip = {
    trigger: "axis",
    backgroundColor: "rgba(255, 252, 244, 0.94)",
    borderColor: "rgba(220, 212, 198, 0.9)",
    textStyle: { color: "#4a453d", fontSize: 12 },
  };

  const options = {
    ownTrend: {
      ...lineAnim,
      color: [
        STAT_LABOR_CHART_COLORS[8],
        STAT_LABOR_CHART_COLORS[10],
        STAT_LABOR_CHART_COLORS[0],
        STAT_LABOR_CHART_COLORS[4],
      ],
      tooltip: { ...commonTooltip },
      legend: {
        data: ["全量问题", "全部质量问题", "已知质量问题", "新发现质量问题"],
        bottom: 4,
        textStyle: { color: "#5c574f", fontSize: 11 },
      },
      grid: { left: 48, right: 20, top: 36, bottom: 64 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 14 ? 28 : 0 },
        axisLine: { lineStyle: { color: "rgba(180, 172, 158, 0.55)" } },
      },
      yAxis: {
        type: "value",
        splitLine: statOwnershipSplitLineStyle(),
        axisLabel: statOwnershipAxisLabel(),
      },
      series: [
        {
          name: "全量问题",
          type: "line",
          smooth: 0.22,
          symbol: "circle",
          symbolSize: 5,
          showSymbol: n < 18,
          lineStyle: { width: 2.4 },
          data: totalLine,
        },
        {
          name: "全部质量问题",
          type: "line",
          smooth: 0.22,
          symbol: "circle",
          symbolSize: 5,
          showSymbol: n < 18,
          lineStyle: { width: 2.2 },
          data: qualityYesLine,
        },
        { name: "已知质量问题", type: "line", smooth: 0.28, areaStyle: { opacity: 0.12 }, data: knownQualityLine },
        { name: "新发现质量问题", type: "line", smooth: 0.28, areaStyle: { opacity: 0.1 }, data: newQualityLine },
      ],
    },
    ownVerLine: {
      ...lineAnim,
      tooltip: { ...commonTooltip },
      legend: {
        type: "scroll",
        bottom: 0,
        pageIconColor: "#7a7368",
        textStyle: { fontSize: 10, color: "#5c574f" },
      },
      grid: { left: 48, right: 16, top: 28, bottom: 96 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: scopedLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: scopedN > 12 ? 26 : 0 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: verSeries,
    },
    ownSunburst: {
      ...lineAnim,
      color: STAT_LABOR_CHART_COLORS,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "sunburst",
          radius: ["18%", "88%"],
          sort: undefined,
          emphasis: { focus: "ancestor" },
          data: sunData,
          label: { show: true, rotate: "radial", color: "#3a3834", fontSize: 10 },
          labelLayout: { hideOverlap: false },
          itemStyle: {
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: "rgba(255, 252, 244, 0.85)",
          },
          levels: [
            {},
            { r0: "18%", r: "42%", label: { rotate: "tangential", fontSize: 10 } },
            { r0: "42%", r: "64%", label: { rotate: "tangential", fontSize: 10 } },
            {
              r0: "64%",
              r: "88%",
              label: {
                show: true,
                position: "inside",
                rotate: "tangential",
                align: "center",
                fontSize: 9,
                minAngle: 0,
                color: "#3a3834",
              },
            },
          ],
        },
      ],
    },
    ownL1Bar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 16, top: 28, bottom: 56 },
      xAxis: {
        type: "category",
        data: l1Bars.length ? l1Bars.map((x) => x.name) : ["暂无数据"],
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 22 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: l1Bars.length ? l1Bars.map((x) => x.value) : [0],
          barWidth: "52%",
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: STAT_LABOR_CHART_COLORS[0],
          },
        },
      ],
    },
    ownSourceLine: {
      ...lineAnim,
      tooltip: commonTooltip,
      legend: { bottom: 4, type: "scroll", textStyle: { fontSize: 10, color: "#5c574f" } },
      grid: { left: 48, right: 14, top: 32, bottom: 72 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: scopedLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: scopedN > 14 ? 28 : 0 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: bizLines,
    },
    ownRLine: {
      ...lineAnim,
      tooltip: commonTooltip,
      legend: { bottom: 4, textStyle: { fontSize: 11, color: "#5c574f" } },
      grid: { left: 48, right: 18, top: 32, bottom: 56 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: scopedLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: scopedN > 14 ? 26 : 0 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: rSeries,
    },
    ownTopSite: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 68 },
      xAxis: {
        type: "category",
        data: sitePick,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topSiteVals,
          barWidth: "58%",
          itemStyle: {
            borderRadius: [7, 7, 0, 0],
            color: STAT_LABOR_CHART_COLORS[2],
          },
        },
      ],
    },
    ownTopInstSite: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 68 },
      xAxis: {
        type: "category",
        data: instPick,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topInstVals,
          barWidth: "58%",
          itemStyle: {
            borderRadius: [7, 7, 0, 0],
            color: STAT_LABOR_CHART_COLORS[5],
          },
        },
      ],
    },
    ownTopVer: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: shortVers, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topVerVals,
          barWidth: "50%",
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: STAT_LABOR_CHART_COLORS[1],
          },
        },
      ],
    },
    ownTopSpc: {
      ...lineAnim,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 44, right: 10, top: 22, bottom: 78 },
      xAxis: {
        type: "category",
        data: spcKeys.length ? spcKeys : ["暂无SPC版本"],
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 26, fontSize: 9 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [{ type: "bar", data: spcVals.length ? spcVals : [0], barWidth: "52%", itemStyle: { borderRadius: [6, 6, 0, 0], color: STAT_LABOR_CHART_COLORS[4] } }],
    },
    ownTopInstVer: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: shortVers, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topInstVerVals,
          barWidth: "50%",
          itemStyle: { borderRadius: [7, 7, 0, 0], color: STAT_LABOR_CHART_COLORS[6] },
        },
      ],
    },
    ownTopInstSpc: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 10, top: 22, bottom: 78 },
      xAxis: {
        type: "category",
        data: topInstSpcKeys.length ? topInstSpcKeys : ["暂无SPC版本"],
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 26, fontSize: 9 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [{ type: "bar", data: topInstSpcVals.length ? topInstSpcVals : [0], barWidth: "52%", itemStyle: { borderRadius: [6, 6, 0, 0], color: STAT_LABOR_CHART_COLORS[3] } }],
    },
    ownCoreBar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: coreKeys.length ? coreKeys : ["暂无C版本"], axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: coreVals.length ? coreVals : [0],
          barWidth: "48%",
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: STAT_LABOR_CHART_COLORS[4],
          },
        },
      ],
    },
    ownTopModuleBar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 44 },
      xAxis: { type: "category", data: topModLabs.length ? topModLabs : ["暂无数据"], axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topModVals.length ? topModVals : [0],
          barWidth: "46%",
          itemStyle: { borderRadius: [8, 8, 0, 0], color: STAT_LABOR_CHART_COLORS[7] },
        },
      ],
    },
  };
  Object.keys(options).forEach((key) => {
    if (key === "ownSunburst") return;
    options[key] = withStatsCategoryXDataZoom(options[key]);
  });
  return options;
}

export function mountStatsOwnershipCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  statOwnershipDisposeCharts();
  const opts = buildStatsOwnershipChartOptions();
  const ids = {
    ownTrend: "stats-ownership-echart-trend",
    ownVerLine: "stats-ownership-echart-ver-line",
    ownSunburst: "stats-ownership-echart-sunburst",
    ownL1Bar: "stats-ownership-echart-l1",
    ownSourceLine: "stats-ownership-echart-source",
    ownRLine: "stats-ownership-echart-r",
    ownTopSite: "stats-ownership-echart-top-site",
    ownTopInstSite: "stats-ownership-echart-top-inst-site",
    ownTopVer: "stats-ownership-echart-top-ver",
    ownTopSpc: "stats-ownership-echart-top-spc",
    ownTopInstVer: "stats-ownership-echart-top-iver",
    ownTopInstSpc: "stats-ownership-echart-top-ispc",
    ownCoreBar: "stats-ownership-echart-core",
    ownTopModuleBar: "stats-ownership-echart-top-mod",
  };
  const paintOwnershipCharts = (attempt = 0) => {
    let needsRetry = false;
    Object.keys(ids).forEach((key) => {
      const el = document.getElementById(ids[key]);
      if (!el) return;
      const existing = statsOwnershipChartInstances[key];
      if (existing?.__statsOwnershipPainted) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if ((w < 2 || h < 2) && attempt < 10) {
        needsRetry = true;
        return;
      }
      let chart = existing;
      if (!chart) {
        chart = E.init(el, null, { renderer: "canvas" });
        statsOwnershipChartInstances[key] = chart;
      }
      try {
        chart.resize();
      } catch (_) {
        // ignore
      }
      chart.setOption(opts[key], { notMerge: true });
      chart.__statsOwnershipPainted = true;
    });
    if (needsRetry) {
      requestAnimationFrame(() => paintOwnershipCharts(attempt + 1));
    }
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => paintOwnershipCharts(0));
  });
  if (!statsOwnershipResizeBound) {
    statsOwnershipResizeBound = true;
    window.addEventListener(
      "resize",
      () => {
        if (state.activeKey !== "stats:charts" || state.statsChartsTab !== "ownership") return;
        Object.values(statsOwnershipChartInstances).forEach((c) => {
          try {
            c.resize();
          } catch (_) {
            // ignore
          }
        });
      },
      { passive: true }
    );
  }
}

export function mountStatsChartZoomMaskToBody(maskEl) {
  if (maskEl && maskEl.parentNode !== document.body) {
    document.body.appendChild(maskEl);
  }
}

export function ensureStatsChartZoomMasksOnBody() {
  mountStatsChartZoomMaskToBody(document.getElementById("stats-ownership-zoom-mask"));
  mountStatsChartZoomMaskToBody(document.getElementById("stats-labor-zoom-mask"));
  mountStatsChartZoomMaskToBody(document.getElementById("stats-doer-zoom-mask"));
}

export function detachStatsChartZoomMasksFromBody() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  document.querySelectorAll("body > .stats-chart-zoom-mask").forEach((mask) => {
    if (mask.id === "stats-ownership-zoom-mask") {
      const host = mask.querySelector("#stats-ownership-zoom-chart");
      const tableHost = mask.querySelector("#stats-ownership-zoom-table-host");
      if (host && E) {
        const zc = E.getInstanceByDom(host);
        if (zc) zc.dispose();
      }
      if (tableHost) {
        tableHost.innerHTML = "";
        tableHost.setAttribute("hidden", "");
        tableHost.style.display = "none";
      }
      window.__statsOwnershipZoomChart = null;
    } else if (mask.id === "stats-labor-zoom-mask") {
      const host = mask.querySelector("#stats-labor-zoom-chart");
      if (host && E) {
        const zc = E.getInstanceByDom(host);
        if (zc) zc.dispose();
      }
      window.__statsLaborZoomChart = null;
    }
    mask.remove();
  });
}

export function detachAdminWhitelistModalFromBody() {
  document.querySelectorAll("body > .admin-whitelist-modal-mask").forEach((mask) => {
    mask.remove();
  });
}

export function replayStatsZoomSurfaceAnimation(el) {
  if (!el) return;
  el.style.animation = "none";
  void el.offsetHeight;
  el.style.animation = "";
}

export function openStatsOwnershipChartZoom(chartKey) {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const opts = buildStatsOwnershipChartOptions();
  const opt = opts[chartKey];
  if (!opt) return;
  const mask = document.getElementById("stats-ownership-zoom-mask");
  const host = document.getElementById("stats-ownership-zoom-chart");
  const tableHost = document.getElementById("stats-ownership-zoom-table-host");
  const titleEl = document.getElementById("stats-ownership-zoom-title");
  if (!mask || !host) return;
  mountStatsChartZoomMaskToBody(mask);
  if (tableHost) {
    tableHost.setAttribute("hidden", "");
    tableHost.style.display = "none";
    tableHost.innerHTML = "";
  }
  host.style.display = "block";
  const titles = {
    ownTrend: "现网问题数量趋势",
    ownVerLine: "按版本透视问题数量",
    ownSunburst: "问题模块透视",
    ownL1Bar: "一级模块透视",
    ownSourceLine: "现网问题来源数量趋势",
    ownRLine: "R版本透视问题数量",
    ownTopSite: "全量问题TOP局点",
    ownTopInstSite: "实例数量TOP局点",
    ownTopVer: "全量问题TOP版本",
    ownTopSpc: "全量问题TOP SPC版本",
    ownTopInstVer: "实例数量TOP版本",
    ownTopInstSpc: "实例数量TOP SPC版本",
    ownCoreBar: "CORE问题透视C版本",
    ownTopModuleBar: "全量问题TOP模块",
  };
  if (titleEl) titleEl.textContent = titles[chartKey] || "图表";
  mask.classList.add("stats-ownership-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
  replayStatsZoomSurfaceAnimation(host);
  const zc = E.getInstanceByDom(host);
  if (zc) zc.dispose();
  window.__statsOwnershipZoomChart = null;
  const paintZoomChart = (attempt = 0) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if ((w < 2 || h < 2) && attempt < 12) {
      requestAnimationFrame(() => paintZoomChart(attempt + 1));
      return;
    }
    const big = E.init(host, null, { renderer: "canvas" });
    const zOpt = buildStatsOwnershipZoomChartOption(opt);
    if (zOpt.legend && typeof zOpt.legend === "object" && !Array.isArray(zOpt.legend)) {
      zOpt.legend.textStyle = { ...(zOpt.legend.textStyle || {}), fontSize: 12 };
    }
    if (zOpt.xAxis && !Array.isArray(zOpt.xAxis) && zOpt.xAxis.axisLabel) {
      zOpt.xAxis.axisLabel.fontSize = (zOpt.xAxis.axisLabel.fontSize || 11) + 1;
    }
    big.setOption(zOpt, { notMerge: true });
    window.__statsOwnershipZoomChart = big;
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => paintZoomChart(0));
  });
}

export function closeStatsOwnershipChartZoom() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  const mask = document.getElementById("stats-ownership-zoom-mask");
  const host = document.getElementById("stats-ownership-zoom-chart");
  const tableHost = document.getElementById("stats-ownership-zoom-table-host");
  if (mask) {
    mask.classList.remove("stats-ownership-zoom-mask--open");
    mask.setAttribute("aria-hidden", "true");
  }
  if (host && E) {
    const zc = E.getInstanceByDom(host);
    if (zc) zc.dispose();
  }
  if (tableHost) {
    tableHost.innerHTML = "";
    tableHost.setAttribute("hidden", "");
    tableHost.style.display = "none";
  }
  window.__statsOwnershipZoomChart = null;
}

export function openStatsOwnershipTableZoom(kind) {
  const mask = document.getElementById("stats-ownership-zoom-mask");
  const chartHost = document.getElementById("stats-ownership-zoom-chart");
  const tableHost = document.getElementById("stats-ownership-zoom-table-host");
  const titleEl = document.getElementById("stats-ownership-zoom-title");
  if (!mask || !tableHost) return;
  const sourceId = kind === "vcat" ? "stats-ownership-table-version-cat" : "stats-ownership-table-hotspot";
  const titleMap = { vcat: "版本问题类别走势", hot: "问题高发模块" };
  const src = document.getElementById(sourceId);
  if (titleEl) titleEl.textContent = titleMap[kind] || "表格";
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (chartHost && E) {
    const zc = E.getInstanceByDom(chartHost);
    if (zc) zc.dispose();
    chartHost.style.display = "none";
  }
  const scrollWrap = src?.closest?.(".stat-ownership-table-scroll");
  const tableHtml = scrollWrap ? scrollWrap.innerHTML : src ? src.outerHTML : "";
  tableHost.innerHTML = tableHtml
    ? `<div class="stat-glass-card-chart stat-chart-enter"><div class="stat-ownership-table-scroll stat-ownership-table-zoom-inner">${tableHtml}</div></div>`
    : "";
  tableHost.removeAttribute("hidden");
  tableHost.style.display = "block";
  mountStatsChartZoomMaskToBody(mask);
  mask.classList.add("stats-ownership-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
  replayStatsZoomSurfaceAnimation(tableHost.querySelector(".stat-ownership-table-scroll"));
}

export function renderStatsOwnershipZoomModalHtml() {
  return `<div class="perm-modal-mask stats-chart-zoom-mask stats-ownership-zoom-mask" id="stats-ownership-zoom-mask" aria-hidden="true">
  <div class="perm-modal stats-ownership-zoom-modal" role="dialog" aria-modal="true" aria-labelledby="stats-ownership-zoom-title">
    <div class="perm-modal-head stats-ownership-zoom-head">
      <h3 id="stats-ownership-zoom-title">图表</h3>
      <button type="button" class="action" id="stats-ownership-zoom-close">关闭</button>
    </div>
    <div class="perm-modal-body stats-ownership-zoom-body">
      <div id="stats-ownership-zoom-chart" class="stats-ownership-zoom-echart-host"></div>
      <div id="stats-ownership-zoom-table-host" class="stats-ownership-zoom-table-host" hidden></div>
    </div>
  </div>
</div>`;
}

function wrapStatsUniformPlotSlot(plotHtml, laborChartHostId) {
  const plotBody = laborChartHostId
    ? `<div id="${escapeAttr(laborChartHostId)}" class="stats-labor-chart-host">${plotHtml}</div>`
    : plotHtml;
  return `<div class="stats-chart-plot-slot"><div class="stats-chart-plot-slot-inner">${plotBody}</div></div>`;
}

function buildStatsUniformGlassCardChart(plotHtml, laborChartHostId, plotAboveHtml, plotBelowHtml) {
  return `<div class="stat-glass-card-chart stat-chart-enter">
    ${plotAboveHtml || ""}
    ${wrapStatsUniformPlotSlot(plotHtml, laborChartHostId)}
    ${plotBelowHtml || ""}
  </div>`;
}

export function renderOwnershipGlassCard(title, toolbarHtml, innerHtml, delayIdx, chartZoomKey, tableZoomKind) {
  const d = (delayIdx * 0.05).toFixed(2);
  let zbtn = "";
  if (chartZoomKey) {
    zbtn = `<button type="button" class="stat-chart-zoom-btn" data-stats-ownership-zoom="${escapeAttr(chartZoomKey)}" title="放大查看" aria-label="放大查看">⛶</button>`;
  } else if (tableZoomKind) {
    zbtn = `<button type="button" class="stat-chart-zoom-btn" data-stats-ownership-table-zoom="${escapeAttr(tableZoomKind)}" title="放大查看" aria-label="放大查看">⛶</button>`;
  }
  const headHtml = zbtn
    ? `<div class="stat-glass-card-head stat-glass-card-head--has-zoom">
      <div class="stat-glass-card-head-main">
        <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
        <div class="stat-glass-card-toolbar">${toolbarHtml || ""}</div>
      </div>
      <div class="stat-glass-card-head-zoom">${zbtn}</div>
    </div>`
    : `<div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      <div class="stat-glass-card-toolbar">${toolbarHtml || ""}</div>
    </div>`;
  return `<article class="stat-glass-card stats-charts-uniform-card" style="--stat-card-delay:${d}s">
    ${headHtml}
    ${buildStatsUniformGlassCardChart(innerHtml, "", "", "")}
  </article>`;
}

export function renderStatsOwnershipVersionCategoryTable() {
  const scoped = getStatsOwnershipQualityScopedPayload();
  const tbl = scoped?.version_category_table;
  if (!tbl) {
    return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-version-cat"><tbody><tr><td>加载中…</td></tr></tbody></table>`;
  }
  const rows = tbl.rows || [];
  const cols = tbl.cols || [];
  const head = `<thead><tr><th class="stat-ownership-th-corner">问题阶段 \\ 版本</th>${cols
    .map((c) => `<th class="stat-ownership-th-ver">${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row, ri) => {
      const tds = (tbl.cells?.[ri] || [])
        .map((v) => `<td>${v}</td>`)
        .join("");
      return `<tr><th scope="row" class="stat-ownership-row-head">${escapeHtml(row)}</th>${tds}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-version-cat">${head}${body}</table>`;
}

export function renderStatsOwnershipHotspotTable() {
  const kind = statsOwnershipModuleKind(state.statsOwnershipHotspotKind);
  const scoped = getStatsOwnershipQualityScopedPayload();
  const hotspot = scoped?.hotspot?.[kind];
  if (!hotspot) {
    return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-hotspot"><tbody><tr><td>加载中…</td></tr></tbody></table>`;
  }
  const { moduleRows, versionCols, cells } = hotspot;
  const cols = versionCols?.length ? versionCols : ["—"];
  const head = `<thead><tr><th class="stat-ownership-th-corner">模块 \\ 版本</th>${cols
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const bodyRows = cells?.length ? cells : [{ l1: "暂无数据", counts: cols.map(() => 0) }];
  const body = `<tbody>${bodyRows
    .map((row) => {
      const tds = (row.counts?.length ? row.counts : cols.map(() => 0))
        .map((v) => `<td>${v}</td>`)
        .join("");
      return `<tr><th scope="row" class="stat-ownership-row-head">${escapeHtml(row.l1)}</th>${tds}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-hotspot">${head}${body}</table>`;
}

export function renderStatsOwnershipFiltersHtml() {
  ensureStatsOwnershipRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = {
    "1d": "近一天",
    "1w": "近一周",
    "1m": "近一月",
    "6m": "近半年",
    "1y": "近一年",
  };
  const segIdx = presetOrder.indexOf(state.statsOwnershipPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.statsOwnershipPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-ownership-preset="${escapeAttr(id)}">${escapeHtml(
        presetLabels[id] || id
      )}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
    </div>`;

  const prec = state.statsOwnershipPrecision || "month";
  const precOpts = [
    { v: "year", t: "年" },
    { v: "quarter", t: "季" },
    { v: "month", t: "月" },
    { v: "day", t: "日" },
  ]
    .map((x) => `<option value="${x.v}" ${prec === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");

  const qual = state.statsOwnershipQuality || "all";
  const qualOpts = [
    { v: "all", t: "全部" },
    { v: "yes", t: "全部质量问题" },
    { v: "known", t: "是（已知质量问题）" },
    { v: "new", t: "是（新发现质量问题）" },
    { v: "no", t: "否" },
  ]
    .map((x) => `<option value="${x.v}" ${qual === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");

  const comp = state.statsOwnershipComponent || "all";
  const compOpts = [
    { v: "kernel", t: "内核问题" },
    { v: "control", t: "管控问题" },
    { v: "all", t: "全部问题" },
  ]
    .map((x) => `<option value="${x.v}" ${comp === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");

  return `
    <div class="stats-labor-filters stats-ownership-filters" aria-label="问题归属筛选">
      <div class="stats-labor-top-row stats-ownership-filter-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          ${renderDateRangeHtml({
            id: "stats-ownership",
            startYmd: state.statsOwnershipStart,
            endYmd: state.statsOwnershipEnd,
          })}
        </div>
        <div class="stats-ownership-filter-inline" role="group" aria-label="精度与问题类型">
          <label class="stat-labor-filter"><span class="stat-labor-filter-label">精度</span>
            <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipPrecision">${precOpts}</select>
          </label>
          <label class="stat-labor-filter"><span class="stat-labor-filter-label">是否质量问题</span>
            <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipQuality">${qualOpts}</select>
          </label>
          <label class="stat-labor-filter"><span class="stat-labor-filter-label">问题组件</span>
            <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipComponent">${compOpts}</select>
          </label>
        </div>
      </div>
    </div>
  `;
}

export function renderStatsOwnershipSectionCardsHtml() {
  ensureStatsOwnershipRangeInit();
  if (!state.statsChartsPayload?.ownership) {
    if (statsChartsShowLoading("ownership")) {
      return `<div class="stats-doer-loading">正在加载问题归属统计数据…</div>`;
    }
    if (statsChartsHasDateRange("ownership")) {
      return `<div class="stats-doer-placeholder">暂无统计数据</div>`;
    }
    return `<div class="stats-doer-placeholder">请选择时间范围后查看统计数据</div>`;
  }
  const echartsFallback =
    typeof window !== "undefined" && typeof window.echarts === "undefined"
      ? `<p class="stat-echart-fallback">图表库加载失败，请检查网络后刷新。</p>`
      : "";

  const sunburstToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipSunburstKind">
        <option value="intro" ${state.statsOwnershipSunburstKind === "intro" ? "selected" : ""}>问题引入模块</option>
        <option value="owner" ${state.statsOwnershipSunburstKind === "owner" ? "selected" : ""}>问题归属模块</option>
      </select></label>`;

  const l1Toolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipL1Class">
        <option value="owner" ${state.statsOwnershipL1Class === "owner" ? "selected" : ""}>问题归属</option>
        <option value="intro" ${state.statsOwnershipL1Class === "intro" ? "selected" : ""}>问题引入</option>
      </select></label>
    <label class="stat-labor-filter"><span class="stat-labor-filter-label">模块</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipL1ModuleFilter">
        ${STAT_OWNERSHIP_MODULES_L1.map(
          (x) =>
            `<option value="${escapeAttr(x.key)}" ${state.statsOwnershipL1ModuleFilter === x.key ? "selected" : ""}>${escapeHtml(x.label)}</option>`
        ).join("")}
      </select></label>
    <label class="stat-labor-filter"><span class="stat-labor-filter-label">DTS单号去重</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipL1DtsDedup">
        <option value="yes" ${state.statsOwnershipL1DtsDedup === "yes" ? "selected" : ""}>是</option>
        <option value="no" ${state.statsOwnershipL1DtsDedup === "no" ? "selected" : ""}>否</option>
      </select></label>`;

  const topSiteN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopSiteN) || 10));
  const topSiteToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">显示条数</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipTopSiteN">
        ${[5, 8, 10, 12, 15, 20]
          .map((n) => `<option value="${n}" ${topSiteN === n ? "selected" : ""}>${n}</option>`)
          .join("")}
      </select></label>`;

  const topInstN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopInstanceSiteN) || 10));
  const topInstToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">显示条数</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipTopInstanceSiteN">
        ${[5, 8, 10, 12, 15, 20]
          .map((n) => `<option value="${n}" ${topInstN === n ? "selected" : ""}>${n}</option>`)
          .join("")}
      </select></label>`;

  const topModToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipTopModuleKind">
        <option value="owner" ${state.statsOwnershipTopModuleKind === "owner" ? "selected" : ""}>问题归属</option>
        <option value="intro" ${state.statsOwnershipTopModuleKind === "intro" ? "selected" : ""}>问题引入</option>
      </select></label>`;

  const hotspotToolbar = `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题分类</span>
      <select class="stat-labor-select" data-stats-ownership-select="statsOwnershipHotspotKind">
        <option value="owner" ${state.statsOwnershipHotspotKind === "owner" ? "selected" : ""}>问题归属</option>
        <option value="intro" ${state.statsOwnershipHotspotKind === "intro" ? "selected" : ""}>问题引入</option>
      </select></label>`;

  const hTrend = `<div class="stat-echart-host" id="stats-ownership-echart-trend"></div>${echartsFallback}`;
  const hVer = `<div class="stat-echart-host stat-echart-host--tall" id="stats-ownership-echart-ver-line"></div>${echartsFallback}`;
  const hSun = `<div class="stat-echart-host stat-echart-host--sunburst" id="stats-ownership-echart-sunburst"></div>${echartsFallback}`;
  const hL1 = `<div class="stat-echart-host" id="stats-ownership-echart-l1"></div>${echartsFallback}`;
  const hSrc = `<div class="stat-echart-host" id="stats-ownership-echart-source"></div>${echartsFallback}`;
  const hR = `<div class="stat-echart-host" id="stats-ownership-echart-r"></div>${echartsFallback}`;
  const hTopSite = `<div class="stat-echart-host" id="stats-ownership-echart-top-site"></div>${echartsFallback}`;
  const hTopInst = `<div class="stat-echart-host" id="stats-ownership-echart-top-inst-site"></div>${echartsFallback}`;
  const hTopVer = `<div class="stat-echart-host" id="stats-ownership-echart-top-ver"></div>${echartsFallback}`;
  const hTopSpc = `<div class="stat-echart-host" id="stats-ownership-echart-top-spc"></div>${echartsFallback}`;
  const hTopIVer = `<div class="stat-echart-host" id="stats-ownership-echart-top-iver"></div>${echartsFallback}`;
  const hTopISpc = `<div class="stat-echart-host" id="stats-ownership-echart-top-ispc"></div>${echartsFallback}`;
  const hCore = `<div class="stat-echart-host" id="stats-ownership-echart-core"></div>${echartsFallback}`;
  const hTopMod = `<div class="stat-echart-host" id="stats-ownership-echart-top-mod"></div>${echartsFallback}`;

  return [
    renderOwnershipGlassCard("现网问题数量趋势", "", hTrend, 0, "ownTrend"),
    renderOwnershipGlassCard("按版本透视问题数量", "", hVer, 1, "ownVerLine"),
    renderOwnershipGlassCard("问题模块透视问题数量", sunburstToolbar, hSun, 2, "ownSunburst"),
    renderOwnershipGlassCard("一级模块透视问题数量", l1Toolbar, hL1, 3, "ownL1Bar"),
    renderOwnershipGlassCard("现网问题来源数量趋势", "", hSrc, 4, "ownSourceLine"),
    renderOwnershipGlassCard(
      "版本问题类别走势",
      "",
      `<div class="stat-ownership-table-scroll stat-chart-enter">${renderStatsOwnershipVersionCategoryTable()}</div>`,
      5,
      "",
      "vcat"
    ),
    renderOwnershipGlassCard("全量问题TOP局点", topSiteToolbar, hTopSite, 6, "ownTopSite"),
    renderOwnershipGlassCard("实例数量TOP局点", topInstToolbar, hTopInst, 7, "ownTopInstSite"),
    renderOwnershipGlassCard("全量问题TOP版本", "", hTopVer, 8, "ownTopVer"),
    renderOwnershipGlassCard("全量问题TOP SPC版本", "", hTopSpc, 9, "ownTopSpc"),
    renderOwnershipGlassCard("实例数量TOP版本", "", hTopIVer, 10, "ownTopInstVer"),
    renderOwnershipGlassCard("实例数量TOP SPC版本", "", hTopISpc, 11, "ownTopInstSpc"),
    renderOwnershipGlassCard("CORE问题透视C版本", "", hCore, 12, "ownCoreBar"),
    renderOwnershipGlassCard("R版本透视问题数量", "", hR, 13, "ownRLine"),
    renderOwnershipGlassCard("全量问题TOP模块", topModToolbar, hTopMod, 14, "ownTopModuleBar"),
    renderOwnershipGlassCard(
      "问题高发模块",
      hotspotToolbar,
      `<div class="stat-ownership-table-scroll stat-chart-enter">${renderStatsOwnershipHotspotTable()}</div>`,
      15,
      "",
      "hot"
    ),
  ].join("");
}

export function renderStatLaborProductLineSelect() {
  const cur = getStatsLaborSelectedProductLine();
  const options = [
    `<option value="" ${cur === "" ? "selected" : ""}>全部</option>`,
    ...getStatsLaborProductLineOptions(state.adminUsers).map(
      (pl) => `<option value="${escapeAttr(pl)}" ${cur === pl ? "selected" : ""}>${escapeHtml(pl)}</option>`
    ),
  ];
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">产品线</span><select class="stat-labor-select" data-stat-labor-select="statsLaborProductLine">${options.join("")}</select></label>`;
}

export function renderStatLaborGroupSelect(stateKey, label) {
  const opts = getStatsLaborGroupOptions();
  const cur = getStatsLaborSelectedGroup(stateKey);
  const options = [`<option value="">全部小组</option>`].concat(
    opts.map((g) => `<option value="${escapeAttr(g)}" ${g === cur ? "selected" : ""}>${escapeHtml(g)}</option>`)
  );
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">${escapeHtml(label)}</span><select class="stat-labor-select" data-stat-labor-select="${escapeAttr(stateKey)}">${options.join("")}</select></label>`;
}

export function renderStatLaborStageSelect(stateKey, label) {
  const cur = state[stateKey] || "";
  const stages = [...WORKFLOW_NODES, "暂时挂起"];
  const options = [`<option value="">全部阶段</option>`].concat(
    stages.map((s) => `<option value="${escapeAttr(s)}" ${s === cur ? "selected" : ""}>${escapeHtml(s)}</option>`)
  );
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">${escapeHtml(label)}</span><select class="stat-labor-select" data-stat-labor-select="${escapeAttr(stateKey)}">${options.join("")}</select></label>`;
}

export function renderStatLaborYesNoToggle(stateKey, label, yesLabel, noLabel) {
  const v = state[stateKey] || "yes";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="${escapeAttr(label)}">
    <span class="stat-labor-filter-label">${escapeHtml(label)}</span>
    <button type="button" class="action ${v === "yes" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="yes">${escapeHtml(yesLabel)}</button>
    <button type="button" class="action ${v === "no" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="no">${escapeHtml(noLabel)}</button>
  </div>`;
}

export function renderStatLaborQualitySelect(stateKey) {
  const v = state[stateKey] || "all";
  const opts = [
    { v: "all", t: "全部问题" },
    { v: "quality", t: "质量问题" },
    { v: "nonQuality", t: "非质量问题" },
  ]
    .map((x) => `<option value="${x.v}" ${v === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">是否质量问题</span><select class="stat-labor-select" data-stat-labor-select="${escapeAttr(stateKey)}">${opts}</select></label>`;
}

export function renderStatLaborComponentSelect(stateKey) {
  const v = state[stateKey] || "all";
  const opts = [
    { v: "all", t: "全部问题" },
    { v: "kernel", t: "内核问题" },
    { v: "control", t: "管控问题" },
  ]
    .map((x) => `<option value="${x.v}" ${v === x.v ? "selected" : ""}>${x.t}</option>`)
    .join("");
  return `<label class="stat-labor-filter"><span class="stat-labor-filter-label">问题组件</span><select class="stat-labor-select" data-stat-labor-select="${escapeAttr(stateKey)}">${opts}</select></label>`;
}

/** 人力投入各卡片放大弹窗标题，键与 `renderStatsLaborSectionCardsHtml` 中 `laborZoomKey` 一致 */
const STAT_LABOR_ZOOM_TITLES = {
  laborInput: "人力投入统计",
  laborOhp: "未闭环问题滞留人",
  laborOhs: "未闭环问题滞留阶段",
  laborGs: "各组未闭环问题数量",
  laborDwell: "各阶段问题平均滞留时间",
  laborPdw: "各阶段人员平均滞留时间",
  laborPie7: "各阶段问题占比",
  laborFd: "问题流转详细占比",
};

/** Doer统计各卡片放大弹窗标题 */
const STAT_DOER_ZOOM_TITLES = {
  doerUsage: "Doer处理问题占比",
  doerDetail: "Doer使用详情",
  doerEffectiveness: "Doer有效率",
  dailyDoerEffectiveness: "Doer有效率趋势",
};

export function renderStatsLaborZoomModalHtml() {
  return `<div class="perm-modal-mask stats-chart-zoom-mask stats-labor-zoom-mask" id="stats-labor-zoom-mask" aria-hidden="true">
  <div class="perm-modal stats-ownership-zoom-modal stats-labor-zoom-modal" role="dialog" aria-modal="true" aria-labelledby="stats-labor-zoom-title">
    <div class="perm-modal-head stats-ownership-zoom-head">
      <h3 id="stats-labor-zoom-title">图表</h3>
      <button type="button" class="action" id="stats-labor-zoom-close">关闭</button>
    </div>
    <div class="perm-modal-body stats-ownership-zoom-body stats-labor-zoom-body">
      <div id="stats-labor-zoom-chart" class="stats-ownership-zoom-echart-host"></div>
    </div>
  </div>
</div>`;
}

export function bindStatsSvgHorizontalZoomHost(hostEl) {
  if (!hostEl || typeof document === "undefined" || hostEl.dataset.statSvgZoomBound === "1") return;
  const svg = hostEl.querySelector("svg.stat-svg-chart:not(.stat-pie-svg)");
  if (!svg) return;
  const fullVb = statsSvgParseViewBox(svg.getAttribute("viewBox"));
  if (!fullVb || fullVb.w <= 0 || fullVb.h <= 0) return;
  const categoryCount = statsSvgCountXCategories(svg);
  if (categoryCount < 2) return;

  hostEl.dataset.statSvgZoomBound = "1";
  hostEl.classList.add("stats-svg-chart-host--xzoom");
  if (!hostEl.getAttribute("title")) {
    hostEl.setAttribute("title", "滚轮横向缩放，按住拖拽平移");
  }

  const minSpan = statsSvgCategoryMinSpan(categoryCount);
  let state = createStatsSvgHorizontalZoomState();
  const apply = () => statsSvgApplyHorizontalZoomViewBox(svg, state, fullVb);

  hostEl.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      state = statsSvgWheelHorizontalZoom(state, ev.deltaY, { minSpan });
      apply();
    },
    { passive: false }
  );

  let dragging = false;
  let lastX = 0;
  const onMove = (ev) => {
    if (!dragging || state.span >= 1) return;
    const rect = hostEl.getBoundingClientRect();
    if (!rect.width) return;
    const deltaStart = (-(ev.clientX - lastX) / rect.width) * state.span;
    lastX = ev.clientX;
    state = statsSvgPanHorizontalZoom(state, deltaStart);
    apply();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    hostEl.classList.remove("stats-svg-chart-host--panning");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  hostEl.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || state.span >= 1) return;
    dragging = true;
    lastX = ev.clientX;
    hostEl.classList.add("stats-svg-chart-host--panning");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

export function mountStatsLaborSvgHorizontalZoom(scopeEl) {
  if (typeof document === "undefined") return;
  const scopes = [];
  if (scopeEl && scopeEl.querySelectorAll) {
    scopes.push(scopeEl);
  } else {
    const laborSections = document.querySelector(".stats-labor-sections");
    if (laborSections) scopes.push(laborSections);
    const zoomContent = document.getElementById("stats-labor-zoom-chart");
    if (zoomContent) scopes.push(zoomContent);
  }
  scopes.forEach((scope) => {
    scope.querySelectorAll(".stats-labor-chart-host").forEach((host) => bindStatsSvgHorizontalZoomHost(host));
  });
}

export function openStatsLaborChartZoom(chartKey) {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const opts = buildStatsLaborChartOptions();
  const opt = opts[chartKey];
  if (!opt) return;
  const mask = document.getElementById("stats-labor-zoom-mask");
  const host = document.getElementById("stats-labor-zoom-chart");
  const titleEl = document.getElementById("stats-labor-zoom-title");
  if (!mask || !host) return;
  mountStatsChartZoomMaskToBody(mask);
  if (titleEl) titleEl.textContent = STAT_LABOR_ZOOM_TITLES[chartKey] || "图表";
  mask.classList.add("stats-chart-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
  replayStatsZoomSurfaceAnimation(host);
  const zc = E.getInstanceByDom(host);
  if (zc) zc.dispose();
  window.__statsLaborZoomChart = null;
  const paintZoomChart = (attempt = 0) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if ((w < 2 || h < 2) && attempt < 12) {
      requestAnimationFrame(() => paintZoomChart(attempt + 1));
      return;
    }
    const big = E.init(host, null, { renderer: "canvas" });
    const zOpt = buildStatsOwnershipZoomChartOption(opt);
    if (zOpt.legend && typeof zOpt.legend === "object" && !Array.isArray(zOpt.legend)) {
      zOpt.legend.textStyle = { ...(zOpt.legend.textStyle || {}), fontSize: 12 };
    }
    if (zOpt.xAxis && !Array.isArray(zOpt.xAxis) && zOpt.xAxis.axisLabel) {
      zOpt.xAxis.axisLabel.fontSize = (zOpt.xAxis.axisLabel.fontSize || 11) + 1;
    }
    big.setOption(zOpt, { notMerge: true });
    window.__statsLaborZoomChart = big;
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => paintZoomChart(0));
  });
}

export function closeStatsLaborChartZoom() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  const mask = document.getElementById("stats-labor-zoom-mask");
  const host = document.getElementById("stats-labor-zoom-chart");
  if (mask) {
    mask.classList.remove("stats-chart-zoom-mask--open");
    mask.setAttribute("aria-hidden", "true");
  }
  if (host && E) {
    const zc = E.getInstanceByDom(host);
    if (zc) zc.dispose();
  }
  window.__statsLaborZoomChart = null;
}

/** Doer统计放大弹窗HTML */
export function renderStatsDoerZoomModalHtml() {
  return `<div class="perm-modal-mask stats-chart-zoom-mask stats-doer-zoom-mask" id="stats-doer-zoom-mask" aria-hidden="true">
    <div class="perm-modal stats-ownership-zoom-modal stats-doer-zoom-modal" role="dialog" aria-modal="true" aria-labelledby="stats-doer-zoom-title">
      <div class="perm-modal-head stats-ownership-zoom-head">
        <h3 id="stats-doer-zoom-title">图表</h3>
        <button type="button" class="action" id="stats-doer-zoom-close">关闭</button>
      </div>
      <div class="perm-modal-body stats-ownership-zoom-body stats-doer-zoom-body">
        <div id="stats-doer-zoom-content" class="stats-doer-zoom-content"></div>
      </div>
    </div>
  </div>`;
}

export function openStatsDoerChartZoom(chartKey) {
  const src = document.getElementById(`stats-labor-chart-${chartKey}`);
  const mask = document.getElementById("stats-doer-zoom-mask");
  const host = document.getElementById("stats-doer-zoom-content");
  const titleEl = document.getElementById("stats-doer-zoom-title");
  if (!src || !mask || !host) return;
  mountStatsChartZoomMaskToBody(mask);
  if (titleEl) titleEl.textContent = STAT_DOER_ZOOM_TITLES[chartKey] || "图表";
  host.innerHTML = src.innerHTML;
  mask.classList.add("stats-chart-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
}

export function closeStatsDoerChartZoom() {
  const mask = document.getElementById("stats-doer-zoom-mask");
  const host = document.getElementById("stats-doer-zoom-content");
  if (mask) {
    mask.classList.remove("stats-chart-zoom-mask--open");
    mask.setAttribute("aria-hidden", "true");
  }
  if (host) host.innerHTML = "";
}

/** Doer统计筛选器 */
export function renderStatsDoerFiltersHtml() {
  ensureStatsLaborRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = { "1d": "近一天", "1w": "近一周", "1m": "近一月", "6m": "近半年", "1y": "近一年" };
  const segIdx = presetOrder.indexOf(state.statsLaborPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.statsLaborPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-labor-preset="${escapeAttr(id)}">${escapeHtml(presetLabels[id] || id)}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
    <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
    <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
  </div>`;
  // 阶段选择checkbox
  const opsChecked = state.statsDoerIncludeOps ? "checked" : "";
  const devChecked = state.statsDoerIncludeDev ? "checked" : "";
  const phaseToggleHtml = `
    <div class="stats-doer-phase-toggle" role="group" aria-label="统计阶段选择">
      <label class="stats-doer-phase-option">
        <input type="checkbox" data-stats-doer-phase="ops" ${opsChecked} />
        <span>运维分析</span>
      </label>
      <label class="stats-doer-phase-option">
        <input type="checkbox" data-stats-doer-phase="dev" ${devChecked} />
        <span>开发分析</span>
      </label>
    </div>
  `;
  // 提示文案根据阶段选择动态变化
  const includeOps = state.statsDoerIncludeOps;
  const includeDev = state.statsDoerIncludeDev;
  const hintText = includeOps && includeDev
    ? "任意阶段使用了Doer即统计在内，向上取整取优先级最高值"
    : includeOps || includeDev
      ? `统计基于${includeOps ? "运维分析" : "开发分析"}阶段的Doer辅助字段`
      : "请至少选择一个分析阶段";
  return `
    <div class="stats-labor-filters" aria-label="Doer统计筛选">
      <div class="stats-labor-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          ${renderDateRangeHtml({
            id: "stats-labor",
            startYmd: state.statsLaborStart,
            endYmd: state.statsLaborEnd,
          })}
        </div>
      </div>
      ${phaseToggleHtml}
      <p class="stats-doer-hint">${escapeHtml(hintText)}</p>
    </div>
  `;
}

/** 获取Doer统计数据（改由 /api/stats/charts?view=doer 聚合） */
export async function fetchDoerStatsData(_startYmd, _endYmd, _includeOps = true, _includeDev = true) {
  return state.statsDoerData || mapDoerPayloadToLegacy(state.statsChartsPayload?.doer);
}

// ========== 咨询问题Doer效率统计 ==========

/** 阶段node_key到阶段名称映射 */
const DOER_EFFICIENCY_STAGE_MAP = {
  problem_review: "问题审核",
  ops_analysis: "运维分析",
  dev_analysis: "开发分析",
  dev_closure: "开发闭环",
  ops_closure: "运维闭环",
  audit_close: "审核关闭",
};

/** 咨询问题Doer效率数据处理 */
function processConsultIssueDoerEfficiencyData(items) {
  // 1. 筛选咨询类问题（is_consult_issue = "是"）
  const consultTickets = items.filter((item) => {
    const opsData = item.nodes?.ops_analysis || {};
    const devData = item.nodes?.dev_analysis || {};
    return opsData.is_consult_issue === "是" || devData.is_consult_issue === "是";
  });

  // 2. 分类：使用Doer vs 未使用Doer
  const usedDoerTickets = [];
  const noDoerTickets = [];

  consultTickets.forEach((item) => {
    const category = statsTicketDoerAssistCategoryMulti(item.nodes, true, true);
    if (category === "doer_resolved" || category === "doer_helped" || category === "doer_no_help") {
      usedDoerTickets.push(item);
    } else if (category === "no_doer") {
      noDoerTickets.push(item);
    }
    // 排除 urgent_hard 和 not_filled
  });

  // 3. 计算各阶段平均滞留时间
  const stageKeys = ["problem_review", "ops_analysis", "dev_analysis", "dev_closure", "ops_closure", "audit_close"];
  const stages = stageKeys.map((k) => DOER_EFFICIENCY_STAGE_MAP[k] || k);

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

  // 4. 计算效率提升百分比
  const efficiencyGains = avgHoursNoDoer.map((noDoerHours, i) => {
    const usedHours = avgHoursUsedDoer[i];
    if (noDoerHours === 0) return 0;
    return Math.round(((noDoerHours - usedHours) / noDoerHours) * 100);
  });

  // 5. 计算整体效率提升（所有阶段有效数据的平均值）
  const validGains = efficiencyGains.filter((g) => g > 0);
  const avgEfficiencyGain = validGains.length > 0 ? Math.round(validGains.reduce((a, b) => a + b, 0) / validGains.length) : 0;

  // 6. 找效率提升最高的阶段
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
    totalConsultCount: consultTickets.length,
  };
}

/** 渲染Doer咨询效率KPI卡片 */
function renderDoerConsultKpiCardsHtml(data) {
  if (!data) return "";
  const { avgEfficiencyGain, usedDoerCount, noDoerCount, maxGainStage, maxGainValue, totalConsultCount } = data;

  const gainColor = avgEfficiencyGain >= 30 ? "#22c55e" : avgEfficiencyGain >= 10 ? "#f97316" : "#94a3b8";

  return `<div class="stat-doer-kpi-grid">
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">整体效率提升</div>
      <div class="stat-doer-kpi-value" style="color:${gainColor}">${avgEfficiencyGain}<span class="stat-doer-kpi-unit">%</span></div>
    </div>
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">使用Doer咨询问题</div>
      <div class="stat-doer-kpi-value">${usedDoerCount}<span class="stat-doer-kpi-unit">个</span></div>
    </div>
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">未使用Doer咨询问题</div>
      <div class="stat-doer-kpi-value">${noDoerCount}<span class="stat-doer-kpi-unit">个</span></div>
    </div>
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">最快提升阶段</div>
      <div class="stat-doer-kpi-value" style="color:#f97316">${maxGainStage}<span class="stat-doer-kpi-unit">${maxGainValue > 0 ? ` (${maxGainValue}%)` : ""}</span></div>
    </div>
  </div><p class="stat-chart-unit-hint">基于 ${totalConsultCount} 个咨询类问题统计</p>`;
}

/** 渲染Doer咨询效率分组柱状图 */
function renderDoerConsultGroupedBarChartHtml(data) {
  if (!data) return "";
  const { stages, avgHoursUsedDoer, avgHoursNoDoer, usedDoerCount, noDoerCount } = data;

  const seriesColors = ["#22c55e", "#94a3b8"]; // 绿色=使用Doer, 灰色=未使用Doer
  const chartSvg = statLaborSvgGroupedBars(
    stages,
    ["使用Doer", "未使用Doer"],
    (gi, si) => (si === 0 ? avgHoursUsedDoer[gi] : avgHoursNoDoer[gi]),
    { aria: "咨询问题各阶段平均滞留时间对比", seriesColors, yUnit: "小时" }
  );

  const legendHtml = statLaborGroupedLegend(["使用Doer", "未使用Doer"], seriesColors, [usedDoerCount, noDoerCount]);

  return `${legendHtml}${chartSvg}`;
}

/** 渲染Doer咨询效率趋势折线图（双Y轴版本） */
function renderDoerConsultTrendChartHtml(data) {
  if (!data || !data.stages) return "";
  const { stages, avgHoursUsedDoer, avgHoursNoDoer, efficiencyGains } = data;

  // 使用双Y轴多折线图：左侧小时，右侧百分比
  const seriesList = [
    { name: "使用Doer(h)", values: avgHoursUsedDoer, stroke: "#22c55e" },
    { name: "未使用Doer(h)", values: avgHoursNoDoer, stroke: "#94a3b8" },
    { name: "效率提升", values: efficiencyGains, stroke: "#f97316" },
  ];

  const chartSvg = statLaborSvgDualAxisMultiLine(stages, seriesList, {
    aria: "咨询问题Doer效率趋势",
    leftUnit: "小时",
  });

  return `<p class="stat-chart-unit-hint">左侧Y轴: 滞留时间(小时) | 右侧Y轴: 效率提升百分比</p>${chartSvg}`;
}

// ========== 非咨询问题Doer效率统计 ==========

/** 非咨询问题Doer效率数据处理 */
function processNonConsultIssueDoerEfficiencyData(items) {
  // 1. 筛选非咨询类问题（is_consult_issue = "否")
  const nonConsultTickets = items.filter((item) => {
    const opsData = item.nodes?.ops_analysis || {};
    const devData = item.nodes?.dev_analysis || {};
    // 需明确是"否"，排除未填写的（空值不属于非咨询）
    return opsData.is_consult_issue === "否" || devData.is_consult_issue === "否";
  });

  // 2. 分类：使用Doer vs 未使用Doer
  const usedDoerTickets = [];
  const noDoerTickets = [];

  nonConsultTickets.forEach((item) => {
    const category = statsTicketDoerAssistCategoryMulti(item.nodes, true, true);
    if (category === "doer_resolved" || category === "doer_helped" || category === "doer_no_help") {
      usedDoerTickets.push(item);
    } else if (category === "no_doer") {
      noDoerTickets.push(item);
    }
    // 排除 urgent_hard 和 not_filled
  });

  // 3. 计算各阶段平均滞留时间
  const stageKeys = ["problem_review", "ops_analysis", "dev_analysis", "dev_closure", "ops_closure", "audit_close"];
  const stages = stageKeys.map((k) => DOER_EFFICIENCY_STAGE_MAP[k] || k);

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

  // 4. 计算效率提升百分比
  const efficiencyGains = avgHoursNoDoer.map((noDoerHours, i) => {
    const usedHours = avgHoursUsedDoer[i];
    if (noDoerHours === 0) return 0;
    return Math.round(((noDoerHours - usedHours) / noDoerHours) * 100);
  });

  // 5. 计算整体效率提升（所有阶段有效数据的平均值）
  const validGains = efficiencyGains.filter((g) => g > 0);
  const avgEfficiencyGain = validGains.length > 0 ? Math.round(validGains.reduce((a, b) => a + b, 0) / validGains.length) : 0;

  // 6. 找效率提升最高的阶段
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
    totalNonConsultCount: nonConsultTickets.length,
  };
}

/** 渲染Doer非咨询效率KPI卡片 */
function renderDoerNonConsultKpiCardsHtml(data) {
  if (!data) return "";
  const { avgEfficiencyGain, usedDoerCount, noDoerCount, maxGainStage, maxGainValue, totalNonConsultCount } = data;

  const gainColor = avgEfficiencyGain >= 30 ? "#22c55e" : avgEfficiencyGain >= 10 ? "#f97316" : "#94a3b8";

  return `<div class="stat-doer-kpi-grid">
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">整体效率提升</div>
      <div class="stat-doer-kpi-value" style="color:${gainColor}">${avgEfficiencyGain}<span class="stat-doer-kpi-unit">%</span></div>
    </div>
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">使用Doer非咨询问题</div>
      <div class="stat-doer-kpi-value">${usedDoerCount}<span class="stat-doer-kpi-unit">个</span></div>
    </div>
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">未使用Doer非咨询问题</div>
      <div class="stat-doer-kpi-value">${noDoerCount}<span class="stat-doer-kpi-unit">个</span></div>
    </div>
    <div class="stat-doer-kpi-item">
      <div class="stat-doer-kpi-label">最快提升阶段</div>
      <div class="stat-doer-kpi-value" style="color:#f97316">${maxGainStage}<span class="stat-doer-kpi-unit">${maxGainValue > 0 ? ` (${maxGainValue}%)` : ""}</span></div>
    </div>
  </div><p class="stat-chart-unit-hint">基于 ${totalNonConsultCount} 个非咨询类问题统计</p>`;
}

/** 渲染Doer非咨询效率分组柱状图 */
function renderDoerNonConsultGroupedBarChartHtml(data) {
  if (!data) return "";
  const { stages, avgHoursUsedDoer, avgHoursNoDoer, usedDoerCount, noDoerCount } = data;

  const seriesColors = ["#22c55e", "#94a3b8"]; // 绿色=使用Doer, 灰色=未使用Doer
  const chartSvg = statLaborSvgGroupedBars(
    stages,
    ["使用Doer", "未使用Doer"],
    (gi, si) => (si === 0 ? avgHoursUsedDoer[gi] : avgHoursNoDoer[gi]),
    { aria: "非咨询问题各阶段平均滞留时间对比", seriesColors, yUnit: "小时" }
  );

  const legendHtml = statLaborGroupedLegend(["使用Doer", "未使用Doer"], seriesColors, [usedDoerCount, noDoerCount]);

  return `${legendHtml}${chartSvg}`;
}

/** 渲染Doer非咨询效率趋势折线图（双Y轴版本） */
function renderDoerNonConsultTrendChartHtml(data) {
  if (!data || !data.stages) return "";
  const { stages, avgHoursUsedDoer, avgHoursNoDoer, efficiencyGains } = data;

  // 使用双Y轴多折线图：左侧小时，右侧百分比
  const seriesList = [
    { name: "使用Doer(h)", values: avgHoursUsedDoer, stroke: "#22c55e" },
    { name: "未使用Doer(h)", values: avgHoursNoDoer, stroke: "#94a3b8" },
    { name: "效率提升", values: efficiencyGains, stroke: "#f97316" },
  ];

  const chartSvg = statLaborSvgDualAxisMultiLine(stages, seriesList, {
    aria: "非咨询问题Doer效率趋势",
    leftUnit: "小时",
  });

  return `<p class="stat-chart-unit-hint">左侧Y轴: 滞留时间(小时) | 右侧Y轴: 效率提升百分比</p>${chartSvg}`;
}

// ========== 每日闭环平均时长统计 ==========

/** 处理每日闭环工单平均时长数据 */
function processDailyClosedAvgDurationData(items) {
  // 1. 筛选已关闭的工单（有closed_at字段）
  const closedTickets = items.filter((item) => item.closed_at && item.created_at);

  if (closedTickets.length === 0) {
    return { labels: [], values: [], totalCount: 0, avgDuration: 0 };
  }

  // 2. 计算每个工单的处理时长（小时）
  const ticketsWithDuration = closedTickets.map((item) => {
    const createdAt = new Date(item.created_at);
    const closedAt = new Date(item.closed_at);
    const durationHours = (closedAt - createdAt) / (1000 * 60 * 60);
    return {
      ...item,
      durationHours,
      closedDateYmd: formatYmdLocal(closedAt),
    };
  });

  // 3. 按关闭日期分组，计算每日平均处理时长
  const byClosedDate = new Map();
  ticketsWithDuration.forEach((ticket) => {
    const ymd = ticket.closedDateYmd;
    if (!byClosedDate.has(ymd)) {
      byClosedDate.set(ymd, []);
    }
    byClosedDate.get(ymd).push(ticket.durationHours);
  });

  // 4. 按日期排序，生成标签和平均值
  const sortedDates = Array.from(byClosedDate.keys()).sort();
  const labels = sortedDates.map((ymd) => {
    // 简化显示：5/8 格式
    const d = parseYmdToDate(ymd);
    if (!d) return ymd;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const values = sortedDates.map((ymd) => {
    const hoursList = byClosedDate.get(ymd);
    if (!hoursList || hoursList.length === 0) return 0;
    const avg = hoursList.reduce((a, b) => a + b, 0) / hoursList.length;
    return Math.round(avg * 10) / 10; // 保留一位小数
  });

  // 5. 计算整体平均处理时长
  const totalDuration = ticketsWithDuration.reduce((sum, t) => sum + t.durationHours, 0);
  const avgDuration = Math.round((totalDuration / ticketsWithDuration.length) * 10) / 10;

  return {
    labels,
    values,
    dailyCounts: sortedDates.map((ymd) => byClosedDate.get(ymd)?.length || 0),
    totalCount: closedTickets.length,
    avgDuration,
  };
}

/** 渲染每日闭环平均时长折线图 */
function renderDailyClosedAvgDurationChartHtml(data) {
  if (!data || data.labels.length === 0) {
    return `<p class="stat-chart-unit-hint">时间范围内无已关闭的工单数据</p>`;
  }

  const { labels, values, totalCount, avgDuration } = data;

  // 使用折线图展示每日平均处理时长
  const chartSvg = statLaborSvgLine(labels, values, {
    aria: "每日闭环平均处理时长",
    stroke: "#3b82f6", // 蓝色
    yUnit: "小时",
    yDecimals: 1,
  });

  return `<p class="stat-chart-unit-hint">整体平均处理时长: <strong>${avgDuration}小时</strong> (${totalCount}个已关闭工单)</p>${chartSvg}`;
}

// ========== 每日Doer使用数量与占比统计 ==========

/** 处理每日Doer使用数量和占比数据 */
function processDailyDoerUsageData(items) {
  // 按工单创建日期分组
  const byDate = new Map();
  items.forEach((item) => {
    const createdAt = item.created_at;
    if (!createdAt) return;
    const ymd = formatYmdLocal(new Date(createdAt));
    if (!byDate.has(ymd)) {
      byDate.set(ymd, { total: 0, usedDoer: 0 });
    }
    byDate.get(ymd).total += 1;
    // 判断是否使用Doer
    const category = statsTicketDoerAssistCategoryMulti(item.nodes, true, true);
    if (category === "doer_resolved" || category === "doer_helped" || category === "doer_no_help") {
      byDate.get(ymd).usedDoer += 1;
    }
  });

  // 按日期排序
  const sortedDates = Array.from(byDate.keys()).sort();
  const labels = sortedDates.map((ymd) => {
    const d = parseYmdToDate(ymd);
    if (!d) return ymd;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const barValues = sortedDates.map((ymd) => byDate.get(ymd)?.usedDoer || 0);
  const lineValues = sortedDates.map((ymd) => {
    const data = byDate.get(ymd);
    if (!data || data.total === 0) return 0;
    return Math.round((data.usedDoer / data.total) * 100);
  });

  // 计算总计
  const totalUsedDoer = barValues.reduce((a, b) => a + b, 0);
  const totalTickets = sortedDates.reduce((sum, ymd) => sum + (byDate.get(ymd)?.total || 0), 0);
  const avgPct = totalTickets > 0 ? Math.round((totalUsedDoer / totalTickets) * 100) : 0;

  return {
    labels,
    barValues,
    lineValues,
    totalUsedDoer,
    totalTickets,
    avgPct,
    dateCount: sortedDates.length,
  };
}

/** 渲染每日Doer使用数量和占比组合图表 */
function renderDailyDoerUsageChartHtml(data) {
  if (!data || data.labels.length === 0) {
    return `<p class="stat-chart-unit-hint">时间范围内无工单数据</p>`;
  }

  const { labels, barValues, lineValues, totalUsedDoer, totalTickets, avgPct } = data;

  const chartSvg = statLaborSvgBarLineCombo(labels, barValues, lineValues, {
    aria: "每日Doer使用数量与占比",
    barColor: "#3b82f6", // 蓝色柱状图
    lineColor: "#f97316", // 橙色折线图
    barLabel: "使用Doer数量",
    lineLabel: "占比",
  });

  return `<p class="stat-chart-unit-hint">整体Doer使用占比: <strong>${avgPct}%</strong> (${totalUsedDoer}/${totalTickets}个工单)</p>${chartSvg}`;
}

// ========== 咨询问题走势统计 ==========

/** 处理每日咨询问题数量和占比数据 */
function processDailyConsultIssueData(items) {
  // 按工单创建日期分组
  const byDate = new Map();
  items.forEach((item) => {
    const createdAt = item.created_at;
    if (!createdAt) return;
    const ymd = formatYmdLocal(new Date(createdAt));
    if (!byDate.has(ymd)) {
      byDate.set(ymd, { total: 0, consult: 0 });
    }
    byDate.get(ymd).total += 1;
    // 判断是否为咨询问题
    const opsData = item.nodes?.ops_analysis || {};
    const devData = item.nodes?.dev_analysis || {};
    if (opsData.is_consult_issue === "是" || devData.is_consult_issue === "是") {
      byDate.get(ymd).consult += 1;
    }
  });

  // 按日期排序
  const sortedDates = Array.from(byDate.keys()).sort();
  const labels = sortedDates.map((ymd) => {
    const d = parseYmdToDate(ymd);
    if (!d) return ymd;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const barValues = sortedDates.map((ymd) => byDate.get(ymd)?.consult || 0);
  const lineValues = sortedDates.map((ymd) => {
    const data = byDate.get(ymd);
    if (!data || data.total === 0) return 0;
    return Math.round((data.consult / data.total) * 100);
  });

  // 计算总计
  const totalConsult = barValues.reduce((a, b) => a + b, 0);
  const totalTickets = sortedDates.reduce((sum, ymd) => sum + (byDate.get(ymd)?.total || 0), 0);
  const avgPct = totalTickets > 0 ? Math.round((totalConsult / totalTickets) * 100) : 0;

  return {
    labels,
    barValues,
    lineValues,
    totalConsult,
    totalTickets,
    avgPct,
    dateCount: sortedDates.length,
  };
}

/** 渲染每日咨询问题数量和占比组合图表 */
function renderDailyConsultIssueChartHtml(data) {
  if (!data || data.labels.length === 0) {
    return `<p class="stat-chart-unit-hint">时间范围内无工单数据</p>`;
  }

  const { labels, barValues, lineValues, totalConsult, totalTickets, avgPct } = data;

  const chartSvg = statLaborSvgBarLineCombo(labels, barValues, lineValues, {
    aria: "咨询问题走势",
    barColor: "#22c55e", // 绿色柱状图
    lineColor: "#f97316", // 橙色折线图
    barLabel: "咨询问题数量",
    lineLabel: "占比",
  });

  return `<p class="stat-chart-unit-hint">整体咨询问题占比: <strong>${avgPct}%</strong> (${totalConsult}/${totalTickets}个工单)</p>${chartSvg}`;
}

// ========== 月度咨询问题走势统计 ==========

/** 处理月度咨询问题数量和占比数据 */
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
  const labels = sortedMonths; // 直接使用 YYYY-MM 格式作为标签

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

/** 渲染月度咨询问题数量和占比组合图表 */
function renderMonthlyConsultIssueChartHtml(data) {
  if (!data || data.labels.length === 0) {
    return `<p class="stat-chart-unit-hint">时间范围内无工单数据</p>`;
  }

  const { labels, barValues, lineValues, totalConsult, totalTickets, avgPct } = data;

  const chartSvg = statLaborSvgBarLineCombo(labels, barValues, lineValues, {
    aria: "月度咨询问题走势",
    barColor: "#22c55e", // 绿色柱状图
    lineColor: "#f97316", // 橙色折线图
    barLabel: "咨询问题数量",
    lineLabel: "占比",
  });

  return `<p class="stat-chart-unit-hint">整体咨询问题占比: <strong>${avgPct}%</strong> (${totalConsult}/${totalTickets}个工单)</p>${chartSvg}`;
}

// ========== Doer有效率趋势统计 ==========

/** 处理每日Doer有效率趋势数据 */
function processDailyDoerEffectivenessData(items) {
  // 按工单创建日期分组
  const byDate = new Map();
  items.forEach((item) => {
    const createdAt = item.created_at;
    if (!createdAt) return;
    const ymd = formatYmdLocal(new Date(createdAt));
    if (!byDate.has(ymd)) {
      byDate.set(ymd, { usedDoer: 0, effective: 0 });
    }
    // 判断是否使用Doer及是否有效
    const category = statsTicketDoerAssistCategoryMulti(item.nodes, true, true);
    if (category === "doer_resolved" || category === "doer_helped" || category === "doer_no_help") {
      byDate.get(ymd).usedDoer += 1;
      // 有效：问题定位/解决 或 思路/辅助提效
      if (category === "doer_resolved" || category === "doer_helped") {
        byDate.get(ymd).effective += 1;
      }
    }
  });

  // 按日期排序
  const sortedDates = Array.from(byDate.keys()).sort();
  const labels = sortedDates.map((ymd) => {
    const d = parseYmdToDate(ymd);
    if (!d) return ymd;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  // 每日使用Doer数量（柱状图）
  const barValues = sortedDates.map((ymd) => byDate.get(ymd)?.usedDoer || 0);
  // 每日有效率百分比（折线图）
  const lineValues = sortedDates.map((ymd) => {
    const data = byDate.get(ymd);
    if (!data || data.usedDoer === 0) return 0;
    return Math.round((data.effective / data.usedDoer) * 100);
  });

  // 计算总计
  const totalUsedDoer = barValues.reduce((a, b) => a + b, 0);
  const totalEffective = sortedDates.reduce((sum, ymd) => sum + (byDate.get(ymd)?.effective || 0), 0);
  const avgPct = totalUsedDoer > 0 ? Math.round((totalEffective / totalUsedDoer) * 100) : 0;

  return {
    labels,
    barValues,
    lineValues,
    totalUsedDoer,
    totalEffective,
    avgPct,
    dateCount: sortedDates.length,
  };
}

/** 渲染每日Doer有效率趋势组合图表 */
function renderDailyDoerEffectivenessChartHtml(data) {
  if (!data || data.labels.length === 0) {
    return `<p class="stat-chart-unit-hint">时间范围内无Doer使用数据</p>`;
  }

  const { labels, barValues, lineValues, totalUsedDoer, totalEffective, avgPct } = data;

  const chartSvg = statLaborSvgBarLineCombo(labels, barValues, lineValues, {
    aria: "Doer有效率趋势",
    barColor: "#3b82f6", // 蓝色柱状图
    lineColor: "#22c55e", // 绿色折线图（有效率）
    barLabel: "使用Doer数量",
    lineLabel: "有效率",
  });

  return `<p class="stat-chart-unit-hint">整体Doer有效率: <strong>${avgPct}%</strong> (${totalEffective}/${totalUsedDoer}个有效)</p>${chartSvg}`;
}

/** Doer统计卡片渲染 */
export function renderStatsDoerSectionCardsHtml() {
  ensureStatsLaborRangeInit();
  const doerData = state.statsDoerData;
  if (!doerData) {
    if (statsChartsShowLoading("doer") || state.statsDoerDataLoading) {
      return `<div class="stats-doer-loading">正在加载Doer统计数据...</div>`;
    }
    if (statsChartsHasDateRange("doer")) {
      return `<div class="stats-doer-placeholder">暂无统计数据</div>`;
    }
    return `<div class="stats-doer-placeholder">请选择时间范围后查看统计数据</div>`;
  }
  const { usageSlices, effectivenessSlices, usedDoer, effective, filledTotal, doerResolved, doerHelped, doerNoHelp } = doerData;

  // 饼图1：Doer处理问题占比（细分三种使用情况）- 独占一行，优化布局
  const usagePct = filledTotal > 0 ? ((usedDoer / filledTotal) * 100).toFixed(1) : "0.0";
  const chart1Header = `<div class="stat-doer-chart-header">
    <p class="stat-doer-chart-summary">使用Doer工单占比: <strong>${usagePct}%</strong> (${usedDoer}/${filledTotal}，已填写Doer情况的工单)</p>
    <p class="stat-doer-chart-detail">其中: 问题定位/解决 <strong>${doerResolved}</strong>, 思路/辅助提效 <strong>${doerHelped}</strong>, 无帮助 <strong>${doerNoHelp}</strong></p>
  </div>`;
  const chart1 = `${chart1Header}
  <div class="stat-doer-pie-layout">
    <div class="stat-pie-wrap">${statLaborSvgPie(usageSlices, { aria: "Doer处理问题占比" })}</div>
    <div class="stat-pie-legend-wrap">${statLaborPieLegend(usageSlices)}</div>
  </div>`;

  // 饼图2：Doer有效率
  const effPct = usedDoer > 0 ? ((effective / usedDoer) * 100).toFixed(1) : "0.0";
  const chart2Header = `<div class="stat-doer-chart-header">
    <p class="stat-doer-chart-summary">有效率: <strong>${effPct}%</strong> (${effective}/${usedDoer})</p>
  </div>`;
  const chart2 = `${chart2Header}
  <div class="stat-doer-pie-layout">
    <div class="stat-pie-wrap">${statLaborSvgPie(effectivenessSlices, { aria: "Doer有效率" })}</div>
    <div class="stat-pie-legend-wrap">${statLaborPieLegend(effectivenessSlices)}</div>
  </div>`;

  // 咨询问题Doer效率（服务端预聚合）
  const consultData = doerData.consultEfficiency;

  // KPI卡片
  const kpiHtml = renderDoerConsultKpiCardsHtml(consultData);

  // 分组柱状图
  const groupedBarHtml = renderDoerConsultGroupedBarChartHtml(consultData);

  // 趋势折线图
  const trendHtml = renderDoerConsultTrendChartHtml(consultData);

  const nonConsultData = doerData.nonConsultEfficiency;

  // 非咨询KPI卡片
  const nonConsultKpiHtml = renderDoerNonConsultKpiCardsHtml(nonConsultData);

  // 非咨询分组柱状图
  const nonConsultGroupedBarHtml = renderDoerNonConsultGroupedBarChartHtml(nonConsultData);

  // 非咨询趋势折线图
  const nonConsultTrendHtml = renderDoerNonConsultTrendChartHtml(nonConsultData);

  const dailyClosedData = doerData.dailyClosed;
  const dailyClosedChartHtml = renderDailyClosedAvgDurationChartHtml(dailyClosedData);

  const dailyDoerUsageData = doerData.dailyDoerUsage;
  const dailyDoerUsageChartHtml = renderDailyDoerUsageChartHtml(dailyDoerUsageData);

  const dailyConsultIssueData = doerData.dailyConsult;
  const dailyConsultIssueChartHtml = renderDailyConsultIssueChartHtml(dailyConsultIssueData);

  const monthlyConsultIssueData = doerData.monthlyConsult;
  const monthlyConsultIssueChartHtml = renderMonthlyConsultIssueChartHtml(monthlyConsultIssueData);

  const dailyDoerEffectivenessData = doerData.dailyDoerEffectiveness;
  const dailyDoerEffectivenessChartHtml = renderDailyDoerEffectivenessChartHtml(dailyDoerEffectivenessData);

  return [
    renderStatLaborGlassCard("Doer处理问题占比", "", chart1, 0, "doerUsage", "stat-glass-card--wide-2"),
    renderStatLaborGlassCard("Doer有效率", "", chart2, 1, "doerEffectiveness", "stat-glass-card--wide-1"),
    renderStatLaborGlassCard("咨询问题Doer效率KPI", "", kpiHtml, 2, "doerConsultKpi", "stat-glass-card--row2"),
    renderStatLaborGlassCard("咨询问题各阶段滞留对比", "", groupedBarHtml, 3, "doerConsultBar", "stat-glass-card--row2"),
    renderStatLaborGlassCard("咨询问题效率趋势", "", trendHtml, 4, "doerConsultTrend", "stat-glass-card--row2"),
    renderStatLaborGlassCard("非咨询问题Doer效率KPI", "", nonConsultKpiHtml, 5, "doerNonConsultKpi", "stat-glass-card--row3"),
    renderStatLaborGlassCard("非咨询问题各阶段滞留对比", "", nonConsultGroupedBarHtml, 6, "doerNonConsultBar", "stat-glass-card--row3"),
    renderStatLaborGlassCard("非咨询问题效率趋势", "", nonConsultTrendHtml, 7, "doerNonConsultTrend", "stat-glass-card--row3"),
    renderStatLaborGlassCard("每日闭环平均处理时长", "", dailyClosedChartHtml, 8, "dailyClosedDuration", "stat-glass-card--row4"),
    renderStatLaborGlassCard("每日Doer使用数量与占比", "", dailyDoerUsageChartHtml, 9, "dailyDoerUsage", "stat-glass-card--row4"),
    renderStatLaborGlassCard("咨询问题走势", "", dailyConsultIssueChartHtml, 10, "dailyConsultIssue", "stat-glass-card--row4"),
    renderStatLaborGlassCard("Doer有效率趋势", "", dailyDoerEffectivenessChartHtml, 11, "dailyDoerEffectiveness", "stat-glass-card--row4"),
    renderStatLaborGlassCard("月度咨询问题走势", "", monthlyConsultIssueChartHtml, 12, "monthlyConsultIssue", "stat-glass-card--row5"),
  ].join("");
}

export function renderStatLaborGlassCard(
  title,
  toolbarHtml,
  chartHtml,
  delayIdx,
  laborZoomKey,
  extraClass = "",
  plotAboveHtml = "",
  plotBelowHtml = ""
) {
  const d = (delayIdx * 0.05).toFixed(2);
  const uniformCharts = !extraClass;
  const zbtn = laborZoomKey
    ? `<button type="button" class="stat-chart-zoom-btn" data-stats-labor-zoom="${escapeAttr(laborZoomKey)}" title="放大查看" aria-label="放大查看">⛶</button>`
    : "";
  const hostId = laborZoomKey && !uniformCharts ? `stats-labor-chart-${laborZoomKey}` : "";
  const chartInner = uniformCharts
    ? buildStatsUniformGlassCardChart(chartHtml, "", plotAboveHtml, plotBelowHtml)
    : laborZoomKey
      ? `<div class="stat-glass-card-chart stat-chart-enter"><div id="${escapeAttr(hostId)}" class="stats-labor-chart-host">${chartHtml}</div></div>`
      : `<div class="stat-glass-card-chart stat-chart-enter">${chartHtml}</div>`;
  const headHtml = zbtn
    ? `<div class="stat-glass-card-head stat-glass-card-head--has-zoom">
      <div class="stat-glass-card-head-main">
        <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
        <div class="stat-glass-card-toolbar">${toolbarHtml || ""}</div>
      </div>
      <div class="stat-glass-card-head-zoom">${zbtn}</div>
    </div>`
    : `<div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      <div class="stat-glass-card-toolbar">${toolbarHtml || ""}</div>
    </div>`;
  const classStr = extraClass ? `stat-glass-card ${extraClass}` : "stat-glass-card stats-charts-uniform-card";
  return `<article class="${classStr}" style="--stat-card-delay:${d}s">
    ${headHtml}
    ${chartInner}
  </article>`;
}

export function renderStatsLaborSectionCardsHtml() {
  ensureStatsLaborRangeInit();
  const cube = state.statsChartsPayload?.labor;
  if (!cube) {
    if (statsChartsShowLoading("labor")) {
      return `<div class="stats-doer-loading">正在加载人力投入统计数据…</div>`;
    }
    if (statsChartsHasDateRange("labor")) {
      return `<div class="stats-doer-placeholder">暂无统计数据</div>`;
    }
    return `<div class="stats-doer-placeholder">请选择时间范围后查看统计数据</div>`;
  }
  const echartsFallback =
    typeof window !== "undefined" && typeof window.echarts === "undefined"
      ? `<p class="stat-echart-fallback">图表库加载失败，请检查网络后刷新。</p>`
      : "";
  const laborEchart = (chartKey) =>
    `<div class="stat-echart-host" id="stats-labor-echart-${escapeAttr(chartKey)}"></div>${echartsFallback}`;

  const chart5Note = `<p class="stat-chart-unit-hint">纵轴单位：小时（基于建单时间统计）</p>`;
  const chart6Note = `<p class="stat-chart-unit-hint">纵轴：按问题单数统计</p>`;

  return [
    renderStatLaborGlassCard(
      "人力投入统计",
      renderStatLaborYesNoToggle("statsLaborInputCollab", "包含协同处理", "是", "否"),
      laborEchart("laborInput"),
      0,
      "laborInput"
    ),
    renderStatLaborGlassCard(
      "未闭环问题滞留人",
      renderStatLaborStageSelect("statsLaborOpenHoldPersonStage", "阶段"),
      laborEchart("laborOhp"),
      1,
      "laborOhp"
    ),
    renderStatLaborGlassCard("未闭环问题滞留阶段", "", laborEchart("laborOhs"), 2, "laborOhs"),
    renderStatLaborGlassCard("各组未闭环问题数量", "", laborEchart("laborGs"), 3, "laborGs"),
    renderStatLaborGlassCard(
      "各阶段问题平均滞留时间",
      "",
      laborEchart("laborDwell"),
      4,
      "laborDwell",
      "",
      "",
      chart5Note
    ),
    renderStatLaborGlassCard(
      "各阶段人员平均滞留时间",
      "",
      laborEchart("laborPdw"),
      5,
      "laborPdw",
      "",
      "",
      chart6Note
    ),
    renderStatLaborGlassCard("各阶段问题占比", "", laborEchart("laborPie7"), 6, "laborPie7"),
    renderStatLaborGlassCard("问题流转详细占比", "", laborEchart("laborFd"), 7, "laborFd"),
  ].join("");
}

export function renderStatsLaborFiltersHtml() {
  ensureStatsLaborRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = {
    "1d": "近一天",
    "1w": "近一周",
    "1m": "近一月",
    "6m": "近半年",
    "1y": "近一年",
  };
  const segIdx = presetOrder.indexOf(state.statsLaborPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.statsLaborPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-labor-preset="${escapeAttr(id)}">${escapeHtml(
        presetLabels[id] || id
      )}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
    </div>`;
  return `
    <div class="stats-labor-filters" aria-label="人力投入筛选">
      <div class="stats-labor-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          ${renderDateRangeHtml({
            id: "stats-labor",
            startYmd: state.statsLaborStart,
            endYmd: state.statsLaborEnd,
          })}
        </div>
        <div class="stats-labor-filter-top-inline" role="group" aria-label="维度筛选">
          ${renderStatLaborProductLineSelect()}
          ${renderStatLaborGroupSelect("statsLaborGroup", "组别")}
          ${renderStatLaborQualitySelect("statsLaborQuality")}
          ${renderStatLaborComponentSelect("statsLaborComponent")}
        </div>
      </div>
    </div>
  `;
}


export function renderStatsChartsTabSegHtml() {
  const tabOrder = ["labor", "ownership", "doer"];
  const tabLabels = { labor: "人力投入", ownership: "问题归属", doer: "Doer统计" };
  const segIdx = tabOrder.indexOf(state.statsChartsTab);
  const segI = segIdx >= 0 ? segIdx : 0;
  const tabBtns = tabOrder
    .map((id) => {
      const active = state.statsChartsTab === id;
      return `<button type="button" class="stats-charts-tab-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-charts-tab="${escapeAttr(id)}">${escapeHtml(
        tabLabels[id] || id
      )}</button>`;
    })
    .join("");
  return `<div class="stats-charts-tab-bar" role="tablist" aria-label="统计视图" style="--seg-i:${segI}">
      <span class="stats-charts-tab-seg-slider" aria-hidden="true"></span>
      <div class="stats-charts-tab-seg-inner">${tabBtns}</div>
    </div>`;
}

function renderStatsDailyBackfillToolbarHtml() {
  const whitelist = getCurrentWhitelistSettings();
  if (!whitelistAllows("workbench_snapshot_rebuild", "readonly", whitelist)) return "";
  const running = state.statsDailyBackfillRunning;
  const total = Number(state.statsDailyBackfillTotal) || 0;
  const done = Number(state.statsDailyBackfillDone) || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const progressText = escapeHtml(
    state.statsDailyBackfillProgress || (running ? "准备回填…" : "按 stats_day 预写日汇总，加速两年全量查询"),
  );
  return `
    <div class="stats-daily-backfill-toolbar" id="stats-daily-backfill-toolbar">
      <div class="stats-daily-backfill-toolbar-row">
        <button type="button" class="action" id="stats-daily-backfill-btn" ${running ? "disabled" : ""}>${
          running ? "回填日汇总中…" : "回填日汇总"
        }</button>
        <span class="stats-daily-backfill-progress-text" id="stats-daily-backfill-progress-text">${progressText}</span>
      </div>
      ${
        running || total > 0
          ? `<div class="stats-daily-backfill-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="stats-daily-backfill-progress-fill" style="width:${pct}%"></div>
      </div>`
          : ""
      }
    </div>`;
}

async function startStatsDailyBackfillFromUi() {
  if (state.statsDailyBackfillRunning) return;
  if (
    !window.confirm(
      "确认回填统计图表日汇总？\n将清空并重建 ticket_stats_daily / ticket_stats_ticket，数据量大时会分批执行。\n（须已执行迁移 0082 且 ticket_list_snapshot 已就绪）",
    )
  ) {
    return;
  }
  state.statsDailyBackfillRunning = true;
  state.statsDailyBackfillProgress = "准备回填…";
  state.statsDailyBackfillDone = 0;
  state.statsDailyBackfillTotal = 0;
  requestRender();
  try {
    const summary = await runStatsDailyBackfill({
      onProgress: ({ done, total, hasMore }) => {
        state.statsDailyBackfillDone = Number(done) || 0;
        state.statsDailyBackfillTotal = Number(total) || 0;
        state.statsDailyBackfillProgress = hasMore
          ? `回填中… ${state.statsDailyBackfillDone}/${state.statsDailyBackfillTotal || "—"}`
          : `回填完成 ${state.statsDailyBackfillDone}/${state.statsDailyBackfillTotal || state.statsDailyBackfillDone}`;
        requestRender();
      },
    });
    state.statsDailyBackfillProgress = `回填完成：${summary.done}/${summary.total || summary.done} 条`;
    window.alert(`统计日汇总回填完成：${summary.done}/${summary.total || summary.done} 条 HCS 工单`);
    invalidateStatsChartsPayload(state.statsChartsTab === "ownership" ? "ownership" : "labor");
    requestRender();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.statsDailyBackfillProgress = `回填失败：${msg}`;
    window.alert(`回填日汇总失败：${msg}`);
    requestRender();
  } finally {
    state.statsDailyBackfillRunning = false;
    requestRender();
  }
}

export function renderStatsChartsPage() {
  if (state.statsChartsTab === "passthrough") state.statsChartsTab = "labor";
  const laborFiltersRow = state.statsChartsTab === "labor" ? renderStatsLaborFiltersHtml() : "";
  const ownershipFiltersRow = state.statsChartsTab === "ownership" ? renderStatsOwnershipFiltersHtml() : "";
  const doerFiltersRow = state.statsChartsTab === "doer" ? renderStatsDoerFiltersHtml() : "";
  const backfillToolbar = renderStatsDailyBackfillToolbarHtml();
  const laborGrid =
    state.statsChartsTab === "labor"
      ? `${renderStatsLaborZoomModalHtml()}<div class="stats-labor-sections">${renderStatsLaborSectionCardsHtml()}</div>`
      : "";
  const ownershipGrid =
    state.statsChartsTab === "ownership"
      ? `${renderStatsOwnershipZoomModalHtml()}<div class="stats-labor-sections stats-ownership-sections">${renderStatsOwnershipSectionCardsHtml()}</div>`
      : "";
  const doerGrid =
    state.statsChartsTab === "doer"
      ? `${renderStatsDoerZoomModalHtml()}<div class="stats-labor-sections stats-doer-sections">${renderStatsDoerSectionCardsHtml()}</div>`
      : "";
  const bodyHtml = laborGrid || ownershipGrid || doerGrid || "";
  const filtersRow = laborFiltersRow || ownershipFiltersRow || doerFiltersRow;
  return `
    <div class="stats-charts-tab-bar-outer">
      ${renderStatsChartsTabSegHtml()}
      ${backfillToolbar}
      ${filtersRow}
    </div>
    <section class="stats-charts-page" id="stats-charts-panel" aria-label="统计图表">
      <div class="stats-charts-body" id="stats-charts-body" aria-live="polite">${bodyHtml}</div>
    </section>
  `;
}

export function bindStatsChartsPage() {
  if (state.statsChartsTab !== "ownership") {
    statOwnershipDisposeCharts();
  }
  const backfillBtn = document.getElementById("stats-daily-backfill-btn");
  if (backfillBtn && !backfillBtn.dataset.bound) {
    backfillBtn.dataset.bound = "1";
    backfillBtn.addEventListener("click", () => {
      void startStatsDailyBackfillFromUi();
    });
  }
  document.querySelectorAll("[data-stats-charts-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-charts-tab");
      if (!id || state.statsChartsTab === id) return;
      state.statsChartsTab = id;
      requestRender();
    });
  });

  document.querySelectorAll("[data-stats-labor-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-labor-preset");
      if (!id) return;
      applyStatsLaborPreset(id);
      invalidateStatsChartsPayload(state.statsChartsTab === "doer" ? "doer" : "labor");
      requestRender();
    });
  });

  if (state.statsChartsTab === "labor" || state.statsChartsTab === "doer") {
    bindDateRangePicker({
      id: "stats-labor",
      getRange: () => ({
        start: state.statsLaborStart,
        end: state.statsLaborEnd,
      }),
      setRange: (start, end) => {
        state.statsLaborStart = start;
        state.statsLaborEnd = end;
        state.statsLaborPreset = "";
      },
      onApplied: () => {
        invalidateStatsChartsPayload(state.statsChartsTab === "doer" ? "doer" : "labor");
        requestRender();
      },
      requestRender,
    });
  }

  document.querySelectorAll("[data-stat-labor-select]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-stat-labor-select");
      if (!k || !STAT_LABOR_SELECT_STATE_KEYS.has(k)) return;
      state[k] = sel.value;
      if (k === "statsLaborProductLine") {
        invalidateStatsChartsPayload("labor");
        requestRender();
        return;
      }
      requestRender();
      if (state.statsChartsTab === "labor" && state.statsChartsPayload?.labor) {
        requestAnimationFrame(() => mountStatsLaborCharts());
      }
    });
  });
  document.querySelectorAll("[data-stat-labor-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-stat-labor-field");
      const v = btn.getAttribute("data-stat-labor-value");
      if (!k || !STAT_LABOR_FIELD_STATE_KEYS.has(k) || v == null) return;
      state[k] = v;
      requestRender();
      if (state.statsChartsTab === "labor" && state.statsChartsPayload?.labor) {
        requestAnimationFrame(() => mountStatsLaborCharts());
      }
    });
  });

  document.querySelectorAll("[data-stats-ownership-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-ownership-preset");
      if (!id) return;
      applyStatsOwnershipPreset(id);
      invalidateStatsChartsPayload("ownership");
      requestRender();
    });
  });

  if (state.statsChartsTab === "ownership") {
    bindDateRangePicker({
      id: "stats-ownership",
      getRange: () => ({
        start: state.statsOwnershipStart,
        end: state.statsOwnershipEnd,
      }),
      setRange: (start, end) => {
        state.statsOwnershipStart = start;
        state.statsOwnershipEnd = end;
        state.statsOwnershipPreset = "";
      },
      onApplied: () => {
        invalidateStatsChartsPayload("ownership");
        requestRender();
      },
      requestRender,
    });
  }

  document.querySelectorAll("[data-stats-ownership-select]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-stats-ownership-select");
      if (!k || !STAT_OWNERSHIP_SELECT_KEYS.has(k)) return;
      const raw = sel.value;
      if (k === "statsOwnershipTopSiteN" || k === "statsOwnershipTopInstanceSiteN") state[k] = Number(raw) || 10;
      else state[k] = raw;
      const refetchKeys = new Set(["statsOwnershipPrecision", "statsOwnershipQuality", "statsOwnershipComponent"]);
      if (refetchKeys.has(k)) {
        invalidateStatsChartsPayload("ownership");
        requestRender();
        return;
      }
      requestRender();
      if (state.statsChartsTab === "ownership" && state.statsChartsPayload?.ownership) {
        requestAnimationFrame(() => mountStatsOwnershipCharts());
      }
    });
  });

  document.querySelectorAll("[data-stats-ownership-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-stats-ownership-zoom");
      if (!key) return;
      requestAnimationFrame(() => openStatsOwnershipChartZoom(key));
    });
  });

  document.querySelectorAll("[data-stats-ownership-table-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-stats-ownership-table-zoom");
      if (kind !== "vcat" && kind !== "hot") return;
      requestAnimationFrame(() => openStatsOwnershipTableZoom(kind));
    });
  });

  const ownZoomClose = document.getElementById("stats-ownership-zoom-close");
  const ownZoomMask = document.getElementById("stats-ownership-zoom-mask");
  if (ownZoomClose) {
    ownZoomClose.addEventListener("click", () => closeStatsOwnershipChartZoom());
  }
  if (ownZoomMask) {
    ownZoomMask.addEventListener("click", (ev) => {
      if (ev.target === ownZoomMask) closeStatsOwnershipChartZoom();
    });
  }

  if (!window.__statsChartsZoomEscBound) {
    window.__statsChartsZoomEscBound = true;
    document.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key !== "Escape") return;
        const om = document.getElementById("stats-ownership-zoom-mask");
        if (om && om.classList.contains("stats-ownership-zoom-mask--open")) closeStatsOwnershipChartZoom();
        const lm = document.getElementById("stats-labor-zoom-mask");
        if (lm && lm.classList.contains("stats-chart-zoom-mask--open")) closeStatsLaborChartZoom();
        const dm = document.getElementById("stats-doer-zoom-mask");
        if (dm && dm.classList.contains("stats-chart-zoom-mask--open")) closeStatsDoerChartZoom();
      },
      true
    );
  }

  // Labor放大弹窗事件绑定（使用事件委托，解决异步加载后重新渲染导致事件丢失问题）
  const doerKeys = ["doerUsage", "doerEffectiveness", "doerConsultKpi", "doerConsultBar", "doerConsultTrend", "doerNonConsultKpi", "doerNonConsultBar", "doerNonConsultTrend", "dailyClosedDuration", "dailyDoerUsage", "dailyConsultIssue", "dailyDoerEffectiveness"];
  if (!statsLaborZoomEventBound) {
    statsLaborZoomEventBound = true;
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-stats-labor-zoom]");
      if (!btn) return;
      const key = btn.getAttribute("data-stats-labor-zoom");
      if (!key) return;
      // 根据key类型决定调用哪个函数
      if (doerKeys.includes(key) && state.statsChartsTab === "doer") {
        requestAnimationFrame(() => openStatsDoerChartZoom(key));
      } else if (state.statsChartsTab === "labor") {
        requestAnimationFrame(() => openStatsLaborChartZoom(key));
      }
    });
  }
  const laborZoomClose = document.getElementById("stats-labor-zoom-close");
  const laborZoomMask = document.getElementById("stats-labor-zoom-mask");
  if (laborZoomClose) {
    laborZoomClose.addEventListener("click", () => closeStatsLaborChartZoom());
  }
  if (laborZoomMask) {
    laborZoomMask.addEventListener("click", (ev) => {
      if (ev.target === laborZoomMask) closeStatsLaborChartZoom();
    });
  }

  // Doer 阶段选择 checkbox 事件绑定
  document.querySelectorAll("[data-stats-doer-phase]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const phase = cb.getAttribute("data-stats-doer-phase");
      if (phase === "ops") state.statsDoerIncludeOps = cb.checked;
      else if (phase === "dev") state.statsDoerIncludeDev = cb.checked;
      invalidateStatsChartsPayload("doer");
      requestRender();
    });
  });

  // Doer 关闭按钮事件绑定
  const doerZoomClose = document.getElementById("stats-doer-zoom-close");
  const doerZoomMask = document.getElementById("stats-doer-zoom-mask");
  if (doerZoomClose) {
    doerZoomClose.addEventListener("click", () => closeStatsDoerChartZoom());
  }
  if (doerZoomMask) {
    doerZoomMask.addEventListener("click", (ev) => {
      if (ev.target === doerZoomMask) closeStatsDoerChartZoom();
    });
  }

  ensureStatsChartZoomMasksOnBody();
  const activeTab = state.statsChartsTab;
  if (activeTab === "ownership" && state.statsChartsPayload?.ownership) {
    requestAnimationFrame(() => {
      mountStatsOwnershipCharts();
    });
  }
  if (activeTab === "labor" && state.statsChartsPayload?.labor) {
    requestAnimationFrame(() => {
      mountStatsLaborCharts();
    });
  }
}
