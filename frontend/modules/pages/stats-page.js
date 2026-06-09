import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { formatYmdLocal, localYmd, startOfLocalDay, nowText, ticketCreatedAtMs } from "../utils/format.js";
import { parseYmdToDate } from "../utils/date.js";
import { getAllTickets } from "./ticket-core.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
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
  statOwnershipSplitLineStyle,
  statOwnershipAxisLabel,
  getStatsReportPeriodBounds,
  statsTicketDayYmd,
  statsNormalizePersonName,
  statsTicketPersonName,
  statsTicketStage,
  statsTicketIsQuality,
  statsTicketQualityIssueValue,
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
  renderUploadKpiCard,
  statsTicketDoerAssistCategoryMulti,
  statsFindAdminUserByPerson,
  getStatsLaborProductLineOptions,
  statsTicketMatchesLaborProductLine,
} from "./stats.js";
import { UPLOAD_CHART_COLORS, findNameColumn } from "./upload.js";
import { ensureAdminWhitelistModalOnBody } from "./admin-page.js";

let statsOwnershipChartInstances = {};
let uploadChartInstance = null;
let uploadChartResizeHandler = null;
let statsLaborZoomEventBound = false;

export function ensureStatsChartsTab() {
  const key = "stats:charts";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "统计图表", closable: true });
  }
  return key;
}

export function ensureStatsReportTab() {
  const key = "stats:report";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "工单分析", closable: true });
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

export function buildStatsOwnershipChartOptions() {
  ensureStatsOwnershipRangeInit();
  const prec = state.statsOwnershipPrecision || "month";
  const { labels: timeLabels, n } = buildStatsOwnershipTimeLabels(state.statsOwnershipStart, state.statsOwnershipEnd, prec);
  const lineAnim = { animation: true, animationDuration: 980, animationEasing: "cubicOut" };
  const allRowsRaw = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd);
  const comp = state.statsOwnershipComponent || "all";
  const allRows = allRowsRaw.filter((t) => (comp === "all" ? true : statsTicketComponent(t) === comp));
  const qualityFilter = String(state.statsOwnershipQuality || "all");
  const trendRows = allRows.filter((t) => {
    const v = statsTicketQualityIssueValue(t);
    if (!v) return false;
    if (qualityFilter === "all") return true;
    if (qualityFilter === "yes") return v === "known" || v === "new";
    if (qualityFilter === "known" || qualityFilter === "new" || qualityFilter === "no") return v === qualityFilter;
    return qualityFilter === "no" ? v === "no" : true;
  });
  const bucketIdx = new Map(timeLabels.map((lab, i) => [lab, i]));
  const toSeries = (rows) => {
    const out = Array.from({ length: n }, () => 0);
    rows.forEach((t) => {
      const ymd = statsTicketDayYmd(t);
      const lab = statsGroupByPrecisionLabel(ymd, prec);
      const i = bucketIdx.get(lab);
      if (i != null) out[i] += 1;
    });
    return out;
  };
  const knownQualityRows = trendRows.filter((t) => statsTicketQualityIssueValue(t) === "known");
  const newQualityRows = trendRows.filter((t) => statsTicketQualityIssueValue(t) === "new");
  const nonQualityRows = trendRows.filter((t) => statsTicketQualityIssueValue(t) === "no");
  const knownQualityLine = toSeries(knownQualityRows);
  const newQualityLine = toSeries(newQualityRows);
  const nonQualityLine = toSeries(nonQualityRows);

  const byVersion = statsCountBy(allRows, (t) => statsTicketVersion(t));
  const versions = Array.from(byVersion.keys())
    .sort((a, b) => (byVersion.get(b) || 0) - (byVersion.get(a) || 0))
    .slice(0, 11);
  const versionsForSeries = versions.length ? versions : ["未知版本"];
  const verSeries = versionsForSeries.map((ver, vi) => ({
    name: ver,
    type: "line",
    smooth: 0.22,
    symbol: "circle",
    symbolSize: 5,
    showSymbol: n < 18,
    lineStyle: { width: vi < 4 ? 2.2 : 1.4 },
    data: toSeries(allRows.filter((t) => statsTicketVersion(t) === ver)),
  }));

  const envKeys = Array.from(statsCountBy(allRows, (t) => String(t.bizEnv || "").trim() || "未知环境").keys())
    .slice(0, 5);
  const bizLines = envKeys.map((name, bi) => {
    const c = STAT_OWNERSHIP_MULTILINE_REF_COLORS[bi % STAT_OWNERSHIP_MULTILINE_REF_COLORS.length];
    return {
      name,
      type: "line",
      smooth: 0.25,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: n < 18,
      lineStyle: { color: c, width: 2 },
      itemStyle: { color: c },
      data: toSeries(allRows.filter((t) => (String(t.bizEnv || "").trim() || "未知环境") === name)),
    };
  });

  const rOfVersion = (v) => {
    if (v.startsWith("505")) return "505";
    if (v.startsWith("503")) return "503";
    if (v.startsWith("506")) return "506";
    if (v.includes("V500R001")) return "V5R001";
    if (v.includes("V500R002")) return "V5R002";
    return "505";
  };
  const rSeries = STAT_OWNERSHIP_R_LINES.map((name, ri) => {
    const c = STAT_OWNERSHIP_MULTILINE_REF_COLORS[ri % STAT_OWNERSHIP_MULTILINE_REF_COLORS.length];
    return {
      name,
      type: "line",
      smooth: 0.22,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: n < 18,
      lineStyle: { color: c, width: 2 },
      itemStyle: { color: c },
      data: toSeries(allRows.filter((t) => rOfVersion(statsTicketVersion(t)) === name)),
    };
  });

  const sunburstKind = statsOwnershipModuleKind(state.statsOwnershipSunburstKind);
  const sunData = buildStatsOwnershipSunburstData(allRows, sunburstKind);

  const l1ModuleKey = state.statsOwnershipL1ModuleFilter || "storage";
  const l1ModuleLabel = STAT_OWNERSHIP_MODULES_L1.find((x) => x.key === l1ModuleKey)?.label || STAT_OWNERSHIP_MODULES_L1[0].label;
  const l1Bars = buildStatsOwnershipL1BarData(
    allRows,
    statsOwnershipModuleKind(state.statsOwnershipL1Class),
    l1ModuleLabel,
    state.statsOwnershipL1DtsDedup === "yes"
  );

  const bySite = statsCountBy(allRows, (t) => String(t.location || "").trim() || "未知局点");
  const topN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopSiteN) || 10));
  const sitePick = Array.from(bySite.keys())
    .sort((a, b) => (bySite.get(b) || 0) - (bySite.get(a) || 0))
    .slice(0, topN);
  const topSiteVals = sitePick.map((s) => bySite.get(s) || 0);

  const bySiteInst = new Map();
  allRows.forEach((t) => {
    const site = String(t.location || "").trim() || "未知局点";
    const pid = String(t.processId || t.orderId || "").trim();
    if (!bySiteInst.has(site)) bySiteInst.set(site, new Set());
    if (pid) bySiteInst.get(site).add(pid);
  });
  const topInstN = Math.min(20, Math.max(3, Number(state.statsOwnershipTopInstanceSiteN) || 10));
  const instPick = Array.from(bySiteInst.keys())
    .sort((a, b) => (bySiteInst.get(b)?.size || 0) - (bySiteInst.get(a)?.size || 0))
    .slice(0, topInstN);
  const topInstVals = instPick.map((s) => bySiteInst.get(s)?.size || 0);

  const shortVers = versionsForSeries.slice(0, 5);
  const topVerVals = shortVers.map((v) => byVersion.get(v) || 0);
  const topInstVerVals = shortVers.map((v) => allRows.filter((t) => statsTicketVersion(t) === v && String(t.status || "").toLowerCase() !== "closed").length);

  const spcBars = buildStatsOwnershipSpcBarData(allRows, { openOnly: false, limit: 10 });
  const spcKeys = spcBars.map((x) => x.name);
  const spcVals = spcBars.map((x) => x.value);
  const instSpcBars = buildStatsOwnershipSpcBarData(allRows, { openOnly: true, limit: 10 });
  const topInstSpcKeys = instSpcBars.map((x) => x.name);
  const topInstSpcVals = instSpcBars.map((x) => x.value);

  const coreBars = buildStatsOwnershipCoreBarData(allRows, 10);
  const coreKeys = coreBars.map((x) => x.name);
  const coreVals = coreBars.map((x) => x.value);

  const topModBars = buildStatsOwnershipTopModuleBarData(allRows, statsOwnershipModuleKind(state.statsOwnershipTopModuleKind), 10);
  const topModLabs = topModBars.map((x) => x.name);
  const topModVals = topModBars.map((x) => x.value);

  const commonTooltip = {
    trigger: "axis",
    backgroundColor: "rgba(255, 252, 244, 0.94)",
    borderColor: "rgba(220, 212, 198, 0.9)",
    textStyle: { color: "#4a453d", fontSize: 12 },
  };

  return {
    ownTrend: {
      ...lineAnim,
      color: [STAT_LABOR_CHART_COLORS[0], STAT_LABOR_CHART_COLORS[4], STAT_LABOR_CHART_COLORS[8]],
      tooltip: { ...commonTooltip },
      legend: {
        data: ["是（已知质量问题）", "是（新发现质量问题）", "否"],
        bottom: 4,
        textStyle: { color: "#5c574f", fontSize: 11 },
      },
      grid: { left: 48, right: 20, top: 36, bottom: 52 },
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
        { name: "是（已知质量问题）", type: "line", smooth: 0.28, areaStyle: { opacity: 0.12 }, data: knownQualityLine },
        { name: "是（新发现质量问题）", type: "line", smooth: 0.28, areaStyle: { opacity: 0.1 }, data: newQualityLine },
        { name: "否", type: "line", smooth: 0.28, areaStyle: { opacity: 0.08 }, data: nonQualityLine },
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
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 12 ? 26 : 0 },
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
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 14 ? 28 : 0 },
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
        data: timeLabels,
        axisLabel: { ...statOwnershipAxisLabel(), rotate: n > 14 ? 26 : 0 },
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
      const host = mask.querySelector("#stats-labor-zoom-content");
      if (host) host.innerHTML = "";
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
  const rows = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => String(t.bizEnv || "").trim() || "未知环境").keys()).slice(0, 8);
  const cols = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => statsTicketVersion(t)).keys()).slice(0, 11);
  const head = `<thead><tr><th class="stat-ownership-th-corner">问题阶段 \\ 版本</th>${cols
    .map((c) => `<th class="stat-ownership-th-ver">${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row, ri) => {
      const tds = cols
        .map((col) => {
          const v = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd).filter(
            (t) => (String(t.bizEnv || "").trim() || "未知环境") === row && statsTicketVersion(t) === col
          ).length;
          return `<td>${v}</td>`;
        })
        .join("");
      return `<tr><th scope="row" class="stat-ownership-row-head">${escapeHtml(row)}</th>${tds}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table class="stat-ownership-table-wrap" id="stats-ownership-table-version-cat">${head}${body}</table>`;
}

export function renderStatsOwnershipHotspotTable() {
  const tickets = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd);
  const { moduleRows, versionCols, cells } = buildStatsOwnershipHotspotTableData(
    tickets,
    statsOwnershipModuleKind(state.statsOwnershipHotspotKind)
  );
  const cols = versionCols.length ? versionCols : ["—"];
  const head = `<thead><tr><th class="stat-ownership-th-corner">模块 \\ 版本</th>${cols
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const bodyRows = moduleRows.length
    ? cells
    : [{ l1: "暂无数据", counts: cols.map(() => 0) }];
  const body = `<tbody>${bodyRows
    .map((row) => {
      const tds = (row.counts.length ? row.counts : cols.map(() => 0))
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
  const startDisp = state.statsOwnershipStart || "开始日期";
  const endDisp = state.statsOwnershipEnd || "结束日期";

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
          <div class="date-range">
            <button type="button" class="date-trigger" id="stats-ownership-start-trigger">${escapeHtml(startDisp)}</button>
            <input class="date-hidden" id="stats-ownership-start-date" type="date" value="${escapeAttr(state.statsOwnershipStart || "")}" aria-label="开始日期" />
            <span class="date-sep">--</span>
            <button type="button" class="date-trigger" id="stats-ownership-end-trigger">${escapeHtml(endDisp)}</button>
            <input class="date-hidden" id="stats-ownership-end-date" type="date" value="${escapeAttr(state.statsOwnershipEnd || "")}" aria-label="结束日期" />
          </div>
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

export function renderStatLaborQualityToggle(stateKey) {
  const v = state[stateKey] || "all";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="是否质量问题">
    <span class="stat-labor-filter-label">是否质量问题</span>
    <button type="button" class="action ${v === "all" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="all">全部问题</button>
    <button type="button" class="action ${v === "quality" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="quality">质量问题</button>
    <button type="button" class="action ${v === "nonQuality" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="nonQuality">非质量问题</button>
  </div>`;
}

export function renderStatLaborModuleToggle(stateKey) {
  const v = state[stateKey] || "all";
  return `<div class="stat-labor-toggle-row" role="group" aria-label="问题组件">
    <span class="stat-labor-filter-label">问题组件</span>
    <button type="button" class="action ${v === "all" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="all">全部问题</button>
    <button type="button" class="action ${v === "kernel" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="kernel">内核问题</button>
    <button type="button" class="action ${v === "control" ? "primary" : ""}" data-stat-labor-field="${escapeAttr(stateKey)}" data-stat-labor-value="control">管控问题</button>
  </div>`;
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
      <div id="stats-labor-zoom-content" class="stats-labor-zoom-content"></div>
    </div>
  </div>
</div>`;
}

export function openStatsLaborChartZoom(chartKey) {
  const src = document.getElementById(`stats-labor-chart-${chartKey}`);
  const mask = document.getElementById("stats-labor-zoom-mask");
  const host = document.getElementById("stats-labor-zoom-content");
  const titleEl = document.getElementById("stats-labor-zoom-title");
  if (!src || !mask || !host) return;
  mountStatsChartZoomMaskToBody(mask);
  const titles = {
    laborInput: "人力投入统计",
    laborOhp: "未闭环问题滞留人",
    laborOhs: "未闭环问题滞留阶段",
    laborGs: "各组未闭环问题数量",
    laborDwell: "各阶段问题平均滞留时间",
    laborPdw: "各阶段人员平均滞留时间",
    laborPie7: "各阶段问题占比",
    laborFd: "问题流转详细占比",
  };
  if (titleEl) titleEl.textContent = titles[chartKey] || "图表";
  host.innerHTML = src.innerHTML;
  mask.classList.add("stats-chart-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
}

export function closeStatsLaborChartZoom() {
  const mask = document.getElementById("stats-labor-zoom-mask");
  const host = document.getElementById("stats-labor-zoom-content");
  if (mask) {
    mask.classList.remove("stats-chart-zoom-mask--open");
    mask.setAttribute("aria-hidden", "true");
  }
  if (host) host.innerHTML = "";
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
  const startDisp = state.statsLaborStart || "开始日期";
  const endDisp = state.statsLaborEnd || "结束日期";
  // 阶段选择checkbox
  const opsChecked = state.statsDoerIncludeOps ? "checked" : "";
  const devChecked = state.statsDoerIncludeDev ? "checked" : "";
  const phaseToggleHtml = `
    <div class="stats-doer-phase-toggle" role="group" aria-label="统计阶段选择">
      <label class="upload-sheet-checkbox">
        <input type="checkbox" data-stats-doer-phase="ops" ${opsChecked} />
        <span>运维分析</span>
      </label>
      <label class="upload-sheet-checkbox">
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
          <div class="date-range">
            <button type="button" class="date-trigger" id="stats-labor-start-trigger">${escapeHtml(startDisp)}</button>
            <input class="date-hidden" id="stats-labor-start-date" type="date" value="${escapeAttr(state.statsLaborStart || "")}" aria-label="开始日期" />
            <span class="date-sep">--</span>
            <button type="button" class="date-trigger" id="stats-labor-end-trigger">${escapeHtml(endDisp)}</button>
            <input class="date-hidden" id="stats-labor-end-date" type="date" value="${escapeAttr(state.statsLaborEnd || "")}" aria-label="结束日期" />
          </div>
        </div>
      </div>
      ${phaseToggleHtml}
      <p class="stats-doer-hint">${escapeHtml(hintText)}</p>
    </div>
  `;
}

/** 获取Doer统计数据 */
export async function fetchDoerStatsData(startYmd, endYmd, includeOps = true, includeDev = true) {
  const tickets = statsTicketsInRange(startYmd, endYmd);
  const ticketNos = tickets.map((t) => t.orderId || t.processId).filter(Boolean);
  // 调试日志：检查请求的工单数量和阶段选择
  console.log("[Doer统计] 时间范围内工单数:", tickets.length, "请求编号数:", ticketNos.length,
              "阶段:", includeOps ? "运维" : "", includeDev ? "开发" : "");
  if (!ticketNos.length) {
    return {
      total: 0,
      doerResolved: 0,
      doerHelped: 0,
      doerNoHelp: 0,
      noDoer: 0,
      urgentHard: 0,
      unknown: 0,
      usedDoer: 0,
      effective: 0,
      includeOps,
      includeDev,
      usageSlices: [
        { label: "问题定位/解决", value: 0 },
        { label: "思路/辅助提效", value: 0 },
        { label: "无帮助", value: 0 },
        { label: "未使用Doer", value: 0 },
        { label: "紧急疑难工单", value: 0 },
        { label: "未填写", value: 0 },
      ],
      effectivenessSlices: [{ label: "有效(定位/解决+辅助提效)", value: 0 }, { label: "无帮助", value: 0 }],
    };
  }
  const operator = getCurrentOperator();
  const resp = await fetch(`${API_BASE_URL}/api/tickets/export-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket_nos: ticketNos, operator_id: operator.account }),
  });
  if (!resp.ok) {
    throw new Error(`获取Doer数据失败: ${resp.status}`);
  }
  const data = await resp.json();
  const items = data.items || [];
  // 调试日志：检查返回的工单数量
  console.log("[Doer统计] API返回工单数:", items.length, "请求数:", ticketNos.length);
  let doerResolved = 0;
  let doerHelped = 0;
  let doerNoHelp = 0;
  let noDoer = 0;
  let urgentHard = 0;
  let notFilled = 0;  // 未填写Doer使用情况
  let unknown = 0;
  items.forEach((item) => {
    // 使用多阶段分类函数，支持向上取整
    const category = statsTicketDoerAssistCategoryMulti(item.nodes, includeOps, includeDev);
    if (category === "doer_resolved") doerResolved += 1;
    else if (category === "doer_helped") doerHelped += 1;
    else if (category === "doer_no_help") doerNoHelp += 1;
    else if (category === "no_doer") noDoer += 1;
    else if (category === "urgent_hard") urgentHard += 1;
    else if (category === "not_filled") notFilled += 1;
    else unknown += 1;
  });
  // 调试日志：检查分类结果
  console.log("[Doer统计] 分类结果:", { doerResolved, doerHelped, doerNoHelp, noDoer, urgentHard, notFilled, unknown });
  const total = items.length;
  const usedDoer = doerResolved + doerHelped + doerNoHelp;
  const effective = doerResolved + doerHelped;
  // 已填写Doer情况的工单数（用于计算有效率时排除未填写的）
  const filledTotal = usedDoer + noDoer + urgentHard;
  return {
    total,
    doerResolved,
    doerHelped,
    doerNoHelp,
    noDoer,
    urgentHard,
    notFilled,
    unknown,
    usedDoer,
    effective,
    filledTotal,
    includeOps,
    includeDev,
    usageSlices: [
      { label: "问题定位/解决", value: doerResolved },
      { label: "思路/辅助提效", value: doerHelped },
      { label: "无帮助", value: doerNoHelp },
      { label: "未使用Doer", value: noDoer },
      { label: "紧急疑难工单", value: urgentHard },
      { label: "未填写", value: notFilled },
    ],
    effectivenessSlices: [
      { label: "有效(定位/解决+辅助提效)", value: effective },
      { label: "无帮助", value: doerNoHelp },
    ],
    items,  // 新增：原始数据（包含instances滞留时间）
  };
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
  const doerData = state.statsDoerData;
  if (!doerData) {
    if (state.statsDoerDataLoading) {
      return `<div class="stats-doer-loading">正在加载Doer统计数据...</div>`;
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

  // 咨询问题Doer效率数据处理
  const consultData = processConsultIssueDoerEfficiencyData(doerData.items || []);

  // KPI卡片
  const kpiHtml = renderDoerConsultKpiCardsHtml(consultData);

  // 分组柱状图
  const groupedBarHtml = renderDoerConsultGroupedBarChartHtml(consultData);

  // 趋势折线图
  const trendHtml = renderDoerConsultTrendChartHtml(consultData);

  // 非咨询问题Doer效率数据处理
  const nonConsultData = processNonConsultIssueDoerEfficiencyData(doerData.items || []);

  // 非咨询KPI卡片
  const nonConsultKpiHtml = renderDoerNonConsultKpiCardsHtml(nonConsultData);

  // 非咨询分组柱状图
  const nonConsultGroupedBarHtml = renderDoerNonConsultGroupedBarChartHtml(nonConsultData);

  // 非咨询趋势折线图
  const nonConsultTrendHtml = renderDoerNonConsultTrendChartHtml(nonConsultData);

  // 每日闭环平均处理时长
  const dailyClosedData = processDailyClosedAvgDurationData(doerData.items || []);
  const dailyClosedChartHtml = renderDailyClosedAvgDurationChartHtml(dailyClosedData);

  // 每日Doer使用数量与占比
  const dailyDoerUsageData = processDailyDoerUsageData(doerData.items || []);
  const dailyDoerUsageChartHtml = renderDailyDoerUsageChartHtml(dailyDoerUsageData);

  // 咨询问题走势（数量+占比）
  const dailyConsultIssueData = processDailyConsultIssueData(doerData.items || []);
  const dailyConsultIssueChartHtml = renderDailyConsultIssueChartHtml(dailyConsultIssueData);

  // 月度咨询问题走势（按自然月分组）
  const monthlyConsultIssueData = processMonthlyConsultIssueData(doerData.items || []);
  const monthlyConsultIssueChartHtml = renderMonthlyConsultIssueChartHtml(monthlyConsultIssueData);

  // Doer有效率趋势（数量+有效率）
  const dailyDoerEffectivenessData = processDailyDoerEffectivenessData(doerData.items || []);
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

/** 异步加载Doer统计数据 */
async function loadDoerStatsDataIfNeeded() {
  if (state.statsDoerDataLoading) return;
  ensureStatsLaborRangeInit();
  const startYmd = state.statsLaborStart;
  const endYmd = state.statsLaborEnd;
  const includeOps = state.statsDoerIncludeOps;
  const includeDev = state.statsDoerIncludeDev;
  // key包含阶段选择状态，确保阶段变化时重新加载
  const key = `${startYmd}_${endYmd}_${includeOps}_${includeDev}`;
  // 如果已经加载了相同时间范围和阶段选择的数据，直接返回
  if (state.statsDoerDataLoadedKey === key && state.statsDoerData) {
    return;
  }
  state.statsDoerDataLoading = true;
  state.statsDoerDataLoaded = false;
  requestRender();
  try {
    const doerData = await fetchDoerStatsData(startYmd, endYmd, includeOps, includeDev);
    state.statsDoerData = doerData;
    state.statsDoerDataLoaded = true;
    state.statsDoerDataLoadedKey = key;
  } catch (err) {
    console.error("Failed to load Doer stats:", err);
    state.statsDoerData = null;
    state.statsDoerDataLoaded = false;
  }
  state.statsDoerDataLoading = false;
  requestRender();
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
  const hostId = laborZoomKey ? `stats-labor-chart-${laborZoomKey}` : "";
  const chartInner = uniformCharts
    ? buildStatsUniformGlassCardChart(chartHtml, hostId, plotAboveHtml, plotBelowHtml)
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
  const allRows = statsTicketsInRange(state.statsLaborStart, state.statsLaborEnd);
  const selectedProductLine = getStatsLaborSelectedProductLine();
  const rows = selectedProductLine
    ? allRows.filter((t) => statsTicketMatchesLaborProductLine(t, selectedProductLine, state.adminUsers))
    : allRows;
  const rowsOpen = rows.filter((t) => String(t.status || "").toLowerCase() !== "closed");
  const rowsByGroup = new Map();
  rows.forEach((t) => {
    const g = statsUserGroupByTicket(t);
    if (!rowsByGroup.has(g)) rowsByGroup.set(g, []);
    rowsByGroup.get(g).push(t);
  });
  const selectedInputGroup = getStatsLaborSelectedGroup("statsLaborInputGroup");
  const inputRows = selectedInputGroup ? rows.filter((t) => statsUserGroupByTicket(t) === selectedInputGroup) : rows;
  const byPersonInput = statsCountBy(inputRows, (t) => statsTicketPersonName(t));
  const people1b = Array.from(byPersonInput.keys());
  const vals1 = people1b.map((k) => byPersonInput.get(k) || 0);
  const chart1 = statLaborSvgBarVertical(people1b.length ? people1b : ["—"], vals1.length ? vals1 : [0], { aria: "人力投入问题数", maxHint: 22 });

  const st2 = String(state.statsLaborOpenHoldPersonStage || "").trim();
  const selectedOpenHoldGroup = getStatsLaborSelectedGroup("statsLaborOpenHoldPersonGroup");
  const rows2 = rowsOpen.filter((t) => {
    if (selectedOpenHoldGroup && statsUserGroupByTicket(t) !== selectedOpenHoldGroup) return false;
    if (st2 && statsTicketStage(t) !== st2) return false;
    return true;
  });
  const byPersonOpen = statsCountBy(rows2, (t) => statsTicketPersonName(t));
  const people2b = Array.from(byPersonOpen.keys());
  const vals2 = people2b.map((k) => byPersonOpen.get(k) || 0);
  const chart2 = statLaborSvgBarVertical(people2b.length ? people2b : ["—"], vals2.length ? vals2 : [0], { aria: "未闭环滞留人问题数" });

  const stages3 = WORKFLOW_NODES.filter((_, idx) => idx > 0 && idx < 7);
  const selectedStageGroup = getStatsLaborSelectedGroup("statsLaborOpenHoldStageGroup");
  const rows3 = selectedStageGroup ? rowsOpen.filter((t) => statsUserGroupByTicket(t) === selectedStageGroup) : rowsOpen;
  const byStage = statsCountBy(rows3, (t) => statsTicketStage(t));
  const vals3 = stages3.map((s) => byStage.get(s) || 0);
  const chart3 = statLaborSvgBarVertical(stages3, vals3, { aria: "各阶段未闭环数量", fills: stages3.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 2) % STAT_LABOR_CHART_COLORS.length]) });

  const allGroupOptions = getStatsLaborGroupOptions();
  const selectedStackGroup = getStatsLaborSelectedGroup("statsLaborGroupStackGroup");
  const stackGroups = selectedStackGroup ? [selectedStackGroup] : allGroupOptions;
  const chart4Legend = statLaborStackLegend(STAT_LABOR_STACK_STAGES);
  const chart4 = statLaborSvgStackedBars(
    stackGroups,
    STAT_LABOR_STACK_STAGES,
    (gi, key) => (rowsByGroup.get(stackGroups[gi]) || []).filter((t) => statsTicketStage(t) === key && String(t.status || "").toLowerCase() !== "closed").length,
    { aria: "各组未闭环分阶段" }
  );

  const dwellStages = WORKFLOW_NODES.slice(1);
  const nowMs = Date.now();
  const selectedDwellGroup = getStatsLaborSelectedGroup("statsLaborAvgDwellGroup");
  const selectedDwellQuality = String(state.statsLaborAvgDwellQuality || "all");
  const rows5 = rows.filter((t) => {
    if (selectedDwellGroup && statsUserGroupByTicket(t) !== selectedDwellGroup) return false;
    if (selectedDwellQuality === "quality" && !statsTicketIsQuality(t)) return false;
    if (selectedDwellQuality === "nonQuality" && statsTicketIsQuality(t)) return false;
    return true;
  });
  const hours5 = dwellStages.map((stage) => {
    const stageRows = rows5.filter((t) => statsTicketStage(t) === stage);
    if (!stageRows.length) return 0;
    const total = stageRows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0);
    return Math.round(total / stageRows.length);
  });
  const chart5 = statLaborSvgBarVertical(dwellStages, hours5, {
    aria: "各阶段平均滞留小时",
    fills: dwellStages.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 1) % STAT_LABOR_CHART_COLORS.length]),
  });
  const chart5Note = `<p class="stat-chart-unit-hint">纵轴单位：小时（基于建单时间统计）</p>`;

  const selectedPersonGroup = getStatsLaborSelectedGroup("statsLaborPersonDwellGroup");
  const selectedModule = String(state.statsLaborPersonDwellModule || "all");
  const people6b = selectedPersonGroup
    ? Array.from(new Set((rowsByGroup.get(selectedPersonGroup) || []).map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配")))
    : Array.from(new Set(rows.map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配"))).slice(0, 12);
  const personDwellStages = [...STAT_LABOR_STACK_STAGES];
  const chart6Legend = statLaborStackLegend(personDwellStages);
  const chart6 = statLaborSvgStackedBars(
    people6b.length ? people6b : ["—"],
    personDwellStages,
    (gi, key) => {
      const person = people6b[gi];
      const pr = rows.filter((t) => statsTicketPersonName(t) === person);
      const mr = selectedModule === "all" ? pr : pr.filter((t) => statsTicketComponent(t) === selectedModule);
      return mr.filter((t) => statsTicketStage(t) === key).length;
    },
    { aria: "各阶段人员滞留时间" }
  );
  const chart6Note = `<p class="stat-chart-unit-hint">纵轴：按问题单数统计</p>`;

  const stageAll = statsCountBy(rows, (t) => statsTicketStage(t));
  const pie7Slices = STAT_LABOR_PIE_STAGES.map((label) => ({ label, value: stageAll.get(label) || 0 }));
  const chart7 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie7Slices, { aria: "各阶段问题占比" })}</div>${statLaborPieLegend(pie7Slices)}</div>`;

  const flowKeys = ["流转至尖刀连", "独立闭环"];
  const selectedFlowGroup = getStatsLaborSelectedGroup("statsLaborFlowDetailGroup");
  const rows10Base = selectedFlowGroup ? rows.filter((t) => statsUserGroupByTicket(t) === selectedFlowGroup) : rows;
  const rows10 = rows10Base.filter((t) => {
    const q = String(state.statsLaborFlowDetailQuality || "all");
    return q === "all" ? true : q === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t);
  });
  const people10b = Array.from(new Set(rows10.map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配"))).slice(0, 12);
  const chart10Legend = statLaborStackLegend(flowKeys);
  const chart10 = statLaborSvgStackedBars(
    people10b.length ? people10b : ["—"],
    flowKeys,
    (gi, key) => {
      const person = people10b[gi];
      const r = rows10.filter((t) => statsTicketPersonName(t) === person);
      if (key === "独立闭环") return r.filter((t) => String(t.status || "").toLowerCase() === "closed").length;
      return r.filter((t) => statsTicketStage(t).includes("开发") || statsTicketStage(t).includes("运维")).length;
    },
    { aria: "问题流转详细占比" }
  );

  return [
    renderStatLaborGlassCard(
      "人力投入统计",
      `${renderStatLaborGroupSelect("statsLaborInputGroup", "组别")}${renderStatLaborYesNoToggle("statsLaborInputCollab", "包含协同处理", "是", "否")}`,
      chart1,
      0,
      "laborInput"
    ),
    renderStatLaborGlassCard(
      "未闭环问题滞留人",
      `${renderStatLaborGroupSelect("statsLaborOpenHoldPersonGroup", "组别")}${renderStatLaborStageSelect("statsLaborOpenHoldPersonStage", "阶段")}`,
      chart2,
      1,
      "laborOhp"
    ),
    renderStatLaborGlassCard("未闭环问题滞留阶段", renderStatLaborGroupSelect("statsLaborOpenHoldStageGroup", "组别"), chart3, 2, "laborOhs"),
    renderStatLaborGlassCard("各组未闭环问题数量", renderStatLaborGroupSelect("statsLaborGroupStackGroup", "组别"), chart4, 3, "laborGs", "", chart4Legend),
    renderStatLaborGlassCard(
      "各阶段问题平均滞留时间",
      `${renderStatLaborGroupSelect("statsLaborAvgDwellGroup", "组别")}${renderStatLaborQualityToggle("statsLaborAvgDwellQuality")}`,
      chart5,
      4,
      "laborDwell",
      "",
      "",
      chart5Note
    ),
    renderStatLaborGlassCard(
      "各阶段人员平均滞留时间",
      `${renderStatLaborGroupSelect("statsLaborPersonDwellGroup", "组别")}${renderStatLaborModuleToggle("statsLaborPersonDwellModule")}`,
      chart6,
      5,
      "laborPdw",
      "",
      chart6Legend,
      chart6Note
    ),
    renderStatLaborGlassCard("各阶段问题占比", "", chart7, 6, "laborPie7"),
    renderStatLaborGlassCard(
      "问题流转详细占比",
      `${renderStatLaborQualityToggle("statsLaborFlowDetailQuality")}${renderStatLaborGroupSelect("statsLaborFlowDetailGroup", "组别")}`,
      chart10,
      7,
      "laborFd",
      "",
      chart10Legend
    ),
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
  const startDisp = state.statsLaborStart || "开始日期";
  const endDisp = state.statsLaborEnd || "结束日期";
  return `
    <div class="stats-labor-filters" aria-label="人力投入筛选">
      <div class="stats-labor-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          <div class="date-range">
            <button type="button" class="date-trigger" id="stats-labor-start-trigger">${escapeHtml(startDisp)}</button>
            <input class="date-hidden" id="stats-labor-start-date" type="date" value="${escapeAttr(state.statsLaborStart || "")}" aria-label="开始日期" />
            <span class="date-sep">--</span>
            <button type="button" class="date-trigger" id="stats-labor-end-trigger">${escapeHtml(endDisp)}</button>
            <input class="date-hidden" id="stats-labor-end-date" type="date" value="${escapeAttr(state.statsLaborEnd || "")}" aria-label="结束日期" />
          </div>
        </div>
        <div class="stats-labor-filter-inline" role="group" aria-label="产品线筛选">
          ${renderStatLaborProductLineSelect()}
        </div>
      </div>
    </div>
  `;
}

export function buildStatsReportMock(period) {
  const { start, end } = getStatsReportPeriodBounds(period);
  const startYmd = formatYmdLocal(start);
  const endYmd = formatYmdLocal(end);
  const rows = statsTicketsInRange(startYmd, endYmd);
  const total = rows.length;
  const open = rows.filter((t) => String(t.status || "").toLowerCase() !== "closed").length;
  const nowMs = Date.now();
  const dwellH =
    total > 0 ? Math.round(rows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0) / Math.max(1, total)) : 0;
  const passthroughPct = total > 0 ? Math.round((rows.filter((t) => statsTicketIsQuality(t)).length / total) * 100) : 0;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000)));
  const prevRows = statsTicketsInRange(formatYmdLocal(prevStart), formatYmdLocal(prevEnd));
  const prevTotal = prevRows.length || 1;
  const momPct = Math.round(((total - prevTotal) / prevTotal) * 100);
  const mom = `${momPct >= 0 ? "+" : ""}${momPct}%`;
  const summary = `本周期全量 ${total} 件，未闭环 ${open} 件，问题量较上周期 ${mom}，建议重点关注滞留阶段与高发局点。`;
  const topRisks = [
    { t: `高严重级问题 ${rows.filter((t) => statsTicketIsQuality(t)).length} 件`, sev: "高" },
    { t: `未闭环问题 ${open} 件`, sev: open > Math.max(5, total * 0.4) ? "高" : "中" },
    { t: `平均滞留 ${dwellH} 小时`, sev: dwellH > 72 ? "高" : dwellH > 36 ? "中" : "低" },
  ];
  const trend = (() => {
    const buckets = period === "year" ? ["Q1", "Q2", "Q3", "Q4"] : period === "quarter" ? ["M1", "M2", "M3"] : ["W1", "W2", "W3", "W4"];
    const arr = Array.from({ length: buckets.length }, () => 0);
    rows.forEach((t) => {
      const d = parseYmdToDate(statsTicketDayYmd(t));
      if (!d) return;
      let i = 0;
      if (period === "year") i = Math.min(3, Math.floor(d.getMonth() / 3));
      else if (period === "quarter") i = Math.min(2, d.getMonth() % 3);
      else i = Math.min(buckets.length - 1, Math.floor((d.getDate() - 1) / Math.max(1, Math.ceil(31 / buckets.length))));
      arr[i] += 1;
    });
    return buckets.map((label, i) => ({ label, v: arr[i] }));
  })();
  const byModule = statsCountBy(rows, (t) => statsParseModulePathLevels(statsTicketModulePath(t, "owner")).l1);
  const modules = Array.from(byModule.entries())
    .map(([name, n]) => ({ name, n, pct: `${total > 0 ? ((n / total) * 100).toFixed(1) : "0.0"}%` }))
    .sort((a, b) => b.n - a.n);
  const byVer = statsCountBy(rows, (t) => statsTicketVersion(t));
  const versions = Array.from(byVer.entries())
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  const bySite = statsCountBy(rows, (t) => String(t.location || "").trim() || "未知局点");
  const bySiteInst = new Map();
  rows.forEach((t) => {
    const s = String(t.location || "").trim() || "未知局点";
    const pid = String(t.processId || t.orderId || "").trim();
    if (!bySiteInst.has(s)) bySiteInst.set(s, new Set());
    if (pid) bySiteInst.get(s).add(pid);
  });
  const sites = Array.from(bySite.entries())
    .map(([name, issues]) => ({ name, issues, inst: bySiteInst.get(name)?.size || 0 }))
    .sort((a, b) => b.issues - a.issues)
    .slice(0, 6);
  const byGroup = statsCountBy(rows, (t) => statsUserGroupByTicket(t));
  const labor = Array.from(byGroup.entries())
    .map(([group, inN]) => {
      const grpRows = rows.filter((t) => statsUserGroupByTicket(t) === group);
      const hold = grpRows.filter((t) => String(t.status || "").toLowerCase() !== "closed").length;
      const dwell = grpRows.length
        ? Math.round(grpRows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0) / grpRows.length)
        : 0;
      return { group, inN, hold, dwell };
    })
    .sort((a, b) => b.inN - a.inN)
    .slice(0, 6);
  const byStage = statsCountBy(rows, (t) => statsTicketStage(t));
  const stages = Array.from(byStage.entries())
    .map(([name, cnt]) => {
      const stageRows = rows.filter((t) => statsTicketStage(t) === name);
      const h = stageRows.length
        ? Math.round(stageRows.reduce((sum, t) => sum + Math.max(0, (nowMs - ticketCreatedAtMs(t)) / 3600000), 0) / stageRows.length)
        : 0;
      return { name, h, cnt };
    })
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 6)
    .map(({ name, h }) => ({ name, h }));
  const qualityIssueRows = rows.filter((t) => {
    const v = statsTicketQualityIssueValue(t);
    return v === "known" || v === "new";
  });
  const nonQualityIssueRows = rows.filter((t) => statsTicketQualityIssueValue(t) === "no");
  const qualityIssuePct = total > 0 ? Math.round((qualityIssueRows.length / total) * 100) : 0;
  const nonQualityIssuePct = total > 0 ? Math.round((nonQualityIssueRows.length / total) * 100) : 0;
  const risks = [
    { obj: "高严重级问题", signal: `占比 ${total > 0 ? ((rows.filter((t) => statsTicketIsQuality(t)).length / total) * 100).toFixed(1) : "0.0"}%`, sev: "高", action: "优先闭环" },
    { obj: "未闭环工单", signal: `${open} 件`, sev: open > Math.max(5, total * 0.4) ? "高" : "中", action: "按阶段清理" },
    { obj: "平均滞留", signal: `${dwellH} 小时`, sev: dwellH > 72 ? "高" : dwellH > 36 ? "中" : "低", action: "优化流转" },
  ];
  return {
    total,
    open,
    dwellH,
    passthroughPct,
    qualityIssuePct,
    nonQualityIssuePct,
    mom,
    summary,
    topRisks,
    trend,
    modules,
    versions,
    sites,
    labor,
    stages,
    risks,
  };
}

export function renderStatsReportPeriodSegHtml() {
  const order = /** @type {const} */ (["week", "biweek", "month", "quarter", "year"]);
  const labels = { week: "周", biweek: "双周", month: "月", quarter: "季", year: "年" };
  const segIdx = order.indexOf(state.statsReportPeriod);
  const segI = segIdx >= 0 ? segIdx : 0;
  const btns = order
    .map((id) => {
      const active = state.statsReportPeriod === id;
      return `<button type="button" class="stats-charts-tab-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-stats-report-period="${escapeAttr(
        id
      )}">${escapeHtml(labels[id] || id)}</button>`;
    })
    .join("");
  return `<div class="stats-report-period-bar stats-charts-tab-bar" role="tablist" aria-label="报告周期" style="--seg-i:${segI};--seg-n:5">
      <span class="stats-report-period-slider stats-charts-tab-seg-slider" aria-hidden="true"></span>
      <div class="stats-charts-tab-seg-inner stats-report-period-seg-inner">${btns}</div>
    </div>`;
}

export function renderStatsReportPage() {
  const period = state.statsReportPeriod;
  const { start, end } = getStatsReportPeriodBounds(period);
  const rangeText = `${formatYmdLocal(start)} ~ ${formatYmdLocal(end)}`;
  const genAt = formatYmdLocal(new Date());
  const d = buildStatsReportMock(period);
  const sevClass = (sev) => (sev === "高" ? "urgent" : sev === "中" ? "high" : "low");
  const kpi = (label, val, sub) =>
    `<div class="stat-glass-card stats-report-kpi"><div class="stat-glass-card-head"><div class="stat-glass-card-title">${escapeHtml(label)}</div></div><div class="stats-report-kpi-val">${escapeHtml(
      val
    )}</div>${sub ? `<div class="stats-report-kpi-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
  const table = (heads, rows) =>
    `<table class="stats-report-table"><thead><tr>${heads.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return `
    <div class="stats-charts-tab-bar-outer stats-report-toolbar-outer">
      ${renderStatsReportPeriodSegHtml()}
      <div class="stats-report-meta-row">
        <span class="stats-report-range">${escapeHtml(rangeText)}</span>
        <span class="stats-report-generated">${escapeHtml(genAt)}</span>
      </div>
    </div>
    <section class="stats-report-page" id="stats-report-panel" aria-label="工单分析">
      <div class="stats-report-block">
        <h2 class="stats-report-h2">执行摘要</h2>
        <p class="stats-report-lead">${escapeHtml(d.summary)}</p>
        <div class="stats-labor-sections stats-report-kpi-grid">
          ${kpi("全量问题", String(d.total), `环比 ${d.mom}`)}
          ${kpi("未闭环", String(d.open), "")}
          ${kpi("平均滞留", `${d.dwellH} 小时`, "")}
          ${kpi("透传率", `${d.passthroughPct}%`, "")}
        </div>
        <div class="stats-report-top3">
          ${d.topRisks
            .map(
              (x) =>
                `<div class="stats-report-top3-item"><span class="p ${sevClass(x.sev)}">${escapeHtml(x.sev)}</span><span class="stats-report-top3-text">${escapeHtml(x.t)}</span></div>`
            )
            .join("")}
        </div>
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">流量与趋势</h2>
        <div class="stats-report-trend-bars">
          ${d.trend
            .map((p) => {
              const max = Math.max(...d.trend.map((x) => x.v), 1);
              const px = Math.max(10, Math.round((p.v / max) * 104));
              return `<div class="stats-report-trend-cell"><div class="stats-report-trend-bar" style="height:${px}px"></div><span>${escapeHtml(p.label)}</span><strong>${p.v}</strong></div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">模块与版本</h2>
        ${table(
          ["模块", "问题数", "占比"],
          d.modules.slice(0, 6).map(
            (row) =>
              `<tr><td>${escapeHtml(row.name)}</td><td>${row.n}</td><td>${escapeHtml(row.pct)}</td></tr>`
          )
        )}
        ${table(
          ["版本线", "问题数"],
          d.versions.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.n}</td></tr>`)
        )}
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">局点</h2>
        ${table(
          ["局点", "问题数", "实例数"],
          d.sites.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.issues}</td><td>${row.inst}</td></tr>`)
        )}
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">人力与流程</h2>
        ${table(
          ["组别", "投入问题数", "未闭环", "平均滞留(h)"],
          d.labor.map(
            (row) =>
              `<tr><td>${escapeHtml(row.group)}</td><td>${row.inN}</td><td>${row.hold}</td><td>${row.dwell}</td></tr>`
          )
        )}
        ${table(
          ["阶段", "平均滞留(h)"],
          d.stages.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.h}</td></tr>`)
        )}
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">透传</h2>
        <div class="stats-report-inline-metrics">
          <span>高严重占比 <strong>${d.passthroughPct}%</strong></span>
          <span>质量问题 <strong>${d.qualityIssuePct}%</strong></span>
          <span>非质量问题 <strong>${d.nonQualityIssuePct}%</strong></span>
        </div>
      </div>
      <div class="stats-report-block">
        <h2 class="stats-report-h2">高风险识别</h2>
        ${table(
          ["对象", "信号", "严重度", "建议动作"],
          d.risks.map(
            (row) =>
              `<tr><td>${escapeHtml(row.obj)}</td><td>${escapeHtml(row.signal)}</td><td><span class="p ${sevClass(row.sev)}">${escapeHtml(
                row.sev
              )}</span></td><td>${escapeHtml(row.action)}</td></tr>`
          )
        )}
      </div>
    </section>
`;
}

export function showUploadToast(message, type = "info") {
  const toastContainer = document.getElementById("upload-toast-container") || (() => {
    const container = document.createElement("div");
    container.id = "upload-toast-container";
    document.body.appendChild(container);
    return container;
  })();
  
  const toast = document.createElement("div");
  toast.className = `upload-toast upload-toast--${type}`;
  toast.innerHTML = `<span class="upload-toast-icon">${type === "success" ? "&#10003;" : type === "error" ? "&#10007;" : "&#9432;"}</span><span class="upload-toast-message">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add("upload-toast--fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function renderUploadAnalysisPage() {
  const preview = state.uploadDataPreview;
  const session = state.currentUploadSession;
  const config = state.uploadSessionConfig || {};
  const sessions = state.uploadSessions || [];
  const displayMode = state.uploadDisplayMode || "chart";

  const hasData = preview && preview.sheets && preview.sheets.length > 0;
  // 检查是否有实际选中的数值列（不仅仅是空数组）
  const selectedCols = state.uploadSelectedColumns || {};
  const hasChartData = hasData && Object.values(selectedCols).some(arr => Array.isArray(arr) && arr.length > 0);
  
  const sessionOptions = sessions.map(s => 
    `<option value="${s.id}" ${session && s.id === session.id ? "selected" : ""}>${escapeHtml(s.session_name || s.file_name || "未命名")}</option>`
  ).join("");
  
  return `
    <div class="upload-toolbar">
      <label class="upload-file-btn">
        <input type="file" accept=".xlsx,.xls" id="upload-file-input" style="display:none" />
        <span class="upload-file-btn-text">上传 Excel</span>
      </label>
      <select class="upload-session-select" id="upload-session-select">
        <option value="">选择历史会话</option>
        ${sessionOptions}
      </select>
      <div class="upload-mode-btns">
        <button type="button" class="upload-mode-btn ${displayMode === "last" ? "active" : ""}" data-upload-mode="last">按上次选择</button>
        <button type="button" class="upload-mode-btn ${displayMode === "chart" ? "active" : ""}" data-upload-mode="chart">全部柱状图</button>
        <button type="button" class="upload-mode-btn ${displayMode === "table" ? "active" : ""}" data-upload-mode="table">全部表格</button>
        <button type="button" class="upload-mode-btn ${displayMode === "custom" ? "active" : ""}" data-upload-mode="custom" id="upload-config-btn">自定义配置</button>
      </div>
      ${hasData ? `<button type="button" class="upload-save-btn" id="upload-save-btn">保存到会话</button>` : ""}
      ${session ? `<button type="button" class="upload-delete-btn" id="upload-delete-btn">删除会话</button>` : ""}
    </div>
    
    <section class="upload-page">
      <!-- 数据浏览区（优先显示） -->
      <div class="upload-data-browse">
        <div class="upload-tabs-bar">
          <button type="button" class="upload-tab-btn ${!state.uploadBrowseTab || state.uploadBrowseTab === "overview" ? "active" : ""}" data-upload-browse-tab="overview">概览</button>
          <button type="button" class="upload-tab-btn ${state.uploadBrowseTab === "fields" ? "active" : ""}" data-upload-browse-tab="fields">字段</button>
          <button type="button" class="upload-tab-btn ${state.uploadBrowseTab === "stats" ? "active" : ""}" data-upload-browse-tab="stats">统计</button>
          <button type="button" class="upload-tab-btn ${state.uploadBrowseTab === "preview" ? "active" : ""}" data-upload-browse-tab="preview">预览</button>
        </div>
        <div class="upload-data-content">
          ${!hasData ? `
            <div class="upload-empty-hint">
              <p>请上传 Excel 文件或加载历史会话开始分析</p>
            </div>
          ` : `
            ${renderUploadBrowseContent(preview)}
          `}
        </div>
      </div>
      
      <!-- 图表展示区 -->
      ${hasChartData ? `
        <div class="upload-chart-section">
          <h3 class="upload-section-title">人员工作量分析</h3>
          <div class="upload-chart-container" id="upload-chart-container"></div>
          <div class="upload-table-container" id="upload-table-container" style="display:${displayMode === "table" ? "block" : "none"}">
            ${renderUploadDataTable()}
          </div>
        </div>
      ` : ""}
      
      <!-- 配置版本按钮区 -->
      ${session && session.config_versions && session.config_versions.length > 0 ? `
        <div class="upload-version-bar">
          <span class="upload-version-label">配置版本：</span>
          ${session.config_versions.map(v => 
            `<button type="button" class="upload-version-btn ${v.is_active ? "active" : ""}" data-upload-config-version="${v.id}">${escapeHtml(v.version_name || `V${v.id}`)}</button>`
          ).join("")}
        </div>
      ` : ""}
    </section>
    
    <!-- 配置弹窗 -->
    ${state.uploadShowConfigModal ? renderUploadConfigModal(preview) : ""}
  `;
}

export function renderUploadBrowseContent(preview) {
  const tab = state.uploadBrowseTab || "overview";
  const sheets = preview.sheets || [];
  
  if (tab === "overview") {
    const totalRows = sheets.reduce((sum, s) => sum + (s.row_count || 0), 0);
    const totalCols = sheets.length > 0 ? Math.max(...sheets.map(s => (s.columns || []).length)) : 0;
    return `
      <div class="upload-overview-grid">
        ${renderUploadKpiCard("Sheet数", sheets.length, "个")}
        ${renderUploadKpiCard("总行数", totalRows, "行")}
        ${renderUploadKpiCard("最大列数", totalCols, "列")}
        ${renderUploadKpiCard("文件名", preview.file_name || "未知", "")}
      </div>
      <div class="upload-sheet-list">
        <h4>Sheet 列表</h4>
        <ul>
          ${sheets.map(s => `
            <li>
              <strong>${escapeHtml(s.name)}</strong>
              <span>${s.row_count || 0} 行, ${(s.columns || []).length} 列</span>
              <button type="button" class="upload-sheet-toggle" data-upload-sheet="${escapeAttr(s.name)}">
                ${state.uploadSelectedSheets.includes(s.name) ? "已选" : "选择"}
              </button>
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  }
  
  if (tab === "fields") {
    const selectedSheet = state.uploadSelectedSheets[0] || (sheets[0] && sheets[0].name) || "";
    const sheetData = sheets.find(s => s.name === selectedSheet) || sheets[0];
    const columns = sheetData ? (sheetData.columns || []) : [];
    return `
      <div class="upload-fields-table">
        <table>
          <thead>
            <tr><th>列名</th><th>推断类型</th><th>示例值</th><th>选择</th></tr>
          </thead>
          <tbody>
            ${columns.map(col => `
              <tr>
                <td>${escapeHtml(col.name || col)}</td>
                <td>${escapeHtml(col.type || "文本")}</td>
                <td>${escapeHtml(col.sample || "")}</td>
                <td>
                  <input type="checkbox" class="upload-col-checkbox" data-upload-col="${escapeAttr(col.name || col)}" 
                    ${state.uploadSelectedColumns[selectedSheet]?.includes(col.name || col) ? "checked" : ""} />
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (tab === "stats") {
    const selectedSheet = state.uploadSelectedSheets[0] || (sheets[0] && sheets[0].name) || "";
    const sheetData = sheets.find(s => s.name === selectedSheet) || sheets[0];
    const rawData = preview.raw_data && preview.raw_data[selectedSheet] || [];
    const columns = sheetData ? (sheetData.columns || []) : [];
    
    const numericCols = columns.filter(c => {
      const colName = c.name || c;
      return rawData.length > 0 && typeof rawData[0][colName] === "number";
    });
    
    return `
      <div class="upload-stats-section">
        ${numericCols.length > 0 ? `
          <table class="upload-stats-table">
            <thead><tr><th>数值列</th><th>均值</th><th>最大</th><th>最小</th><th>总和</th></tr></thead>
            <tbody>
              ${numericCols.map(col => {
                const colName = col.name || col;
                const values = rawData.map(r => r[colName]).filter(v => typeof v === "number");
                const sum = values.reduce((a, b) => a + b, 0);
                const avg = values.length > 0 ? sum / values.length : 0;
                const max = Math.max(...values, 0);
                const min = Math.min(...values, 0);
                return `
                  <tr>
                    <td>${escapeHtml(colName)}</td>
                    <td>${avg.toFixed(2)}</td>
                    <td>${max}</td>
                    <td>${min}</td>
                    <td>${sum.toFixed(2)}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        ` : `<p class="upload-stats-empty">无数值列可统计</p>`}
      </div>
    `;
  }
  
  if (tab === "preview") {
    const selectedSheet = state.uploadSelectedSheets[0] || (sheets[0] && sheets[0].name) || "";
    const rawData = preview.raw_data && preview.raw_data[selectedSheet] || [];
    const columns = sheets.find(s => s.name === selectedSheet)?.columns || [];
    
    if (rawData.length === 0) return `<p class="upload-preview-empty">无数据</p>`;
    
    return `
      <div class="upload-preview-table">
        <table>
          <thead>
            <tr>${columns.map(c => `<th>${escapeHtml(c.name || c)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rawData.slice(0, 50).map(row => `
              <tr>${columns.map(c => `<td>${escapeHtml(String(row[c.name || c] || ""))}</td>`).join("")}</tr>
            `).join("")}
          </tbody>
        </table>
        ${rawData.length > 50 ? `<p class="upload-preview-note">仅显示前50行，共 ${rawData.length} 行</p>` : ""}
      </div>
    `;
  }
  
  return "";
}

export function renderUploadDataTable() {
  const preview = state.uploadDataPreview;
  if (!preview) return "";
  
  const aggregatedData = aggregateUploadDataByPerson(preview);
  if (!aggregatedData || aggregatedData.length === 0) return "";
  
  const columns = Object.keys(aggregatedData[0]);
  
  return `
    <table class="upload-result-table">
      <thead>
        <tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${aggregatedData.map(row => `
          <tr>${columns.map(c => `<td>${escapeHtml(String(row[c] || ""))}</td>`).join("")}</tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

export function renderUploadConfigModal(preview) {
  const sheets = preview?.sheets || [];
  const selectedSheets = state.uploadSelectedSheets || [];
  const nameColumn = state.uploadNameColumn || "";
  const avgColumns = state.uploadAvgColumns || [];
  const chartType = state.uploadChartType || "bar";
  const aggregateMode = state.uploadAggregateMode || "sum";
  
  const nameColumnCandidates = [];
  sheets.forEach(s => {
    (s.columns || []).forEach(c => {
      const colName = c.name || c;
      const lowerName = colName.toLowerCase();
      if (lowerName.includes("名称") || lowerName.includes("姓名") || lowerName.includes("名字") || 
          lowerName.includes("name") || lowerName.includes("人员") || lowerName.includes("同学") ||
          lowerName.includes("员工")) {
        if (!nameColumnCandidates.includes(colName)) nameColumnCandidates.push(colName);
      }
    });
  });
  
  // 获取当前选择的数值列数量
  const firstSheetName = sheets.length > 0 ? sheets[0].name : "";
  const selectedNumericCols = state.uploadSelectedColumns?.[firstSheetName] || [];
  
  return `
    <div class="upload-modal-overlay" id="upload-modal-overlay">
      <div class="upload-modal upload-modal--enhanced">
        <div class="upload-modal-head">
          <div class="upload-modal-title-area">
            <h3>📋 配置导入选项</h3>
            <span class="upload-modal-subtitle">设置图表展示参数</span>
          </div>
          <button type="button" class="upload-modal-close" id="upload-modal-close">✕</button>
        </div>
        
        <!-- 当前配置预览 -->
        <div class="upload-config-preview">
          <div class="upload-config-preview-item">
            <span class="upload-config-preview-label">Sheet:</span>
            <span class="upload-config-preview-value">${selectedSheets.length > 0 ? selectedSheets.join(", ") : "未选择"}</span>
          </div>
          <div class="upload-config-preview-item">
            <span class="upload-config-preview-label">人员列:</span>
            <span class="upload-config-preview-value">${nameColumn || "自动识别"}</span>
          </div>
          <div class="upload-config-preview-item">
            <span class="upload-config-preview-label">数值列:</span>
            <span class="upload-config-preview-value">${selectedNumericCols.length} 列已选择</span>
          </div>
          <div class="upload-config-preview-item">
            <span class="upload-config-preview-label">图表:</span>
            <span class="upload-config-preview-value">${chartType === "bar" ? "柱状图" : chartType === "line" ? "折线图" : "饼图"}</span>
          </div>
        </div>
        
        <div class="upload-modal-body">
          <!-- Sheet选择 -->
          <div class="upload-config-section upload-config-section--sheets">
            <div class="upload-config-section-header">
              <span class="upload-config-icon">📊</span>
              <label class="upload-config-label">选择数据 Sheet</label>
            </div>
            <div class="upload-config-sheets">
              ${sheets.map(s => `
                <label class="upload-sheet-checkbox ${selectedSheets.includes(s.name) ? "upload-sheet-checkbox--selected" : ""}">
                  <input type="checkbox" value="${escapeAttr(s.name)}" 
                    class="upload-config-sheet" data-upload-config-sheet="${escapeAttr(s.name)}"
                    ${selectedSheets.includes(s.name) ? "checked" : ""} />
                  <span class="upload-sheet-name">${escapeHtml(s.name)}</span>
                  <span class="upload-sheet-info">${s.row_count || 0}行</span>
                </label>
              `).join("")}
            </div>
          </div>
          
          <!-- 人员字段 -->
          <div class="upload-config-section upload-config-section--field">
            <div class="upload-config-section-header">
              <span class="upload-config-icon">👤</span>
              <label class="upload-config-label">人员字段（横轴分类）</label>
            </div>
            <select class="upload-config-select" id="upload-config-name-column">
              <option value="">自动识别（推荐）</option>
              ${nameColumnCandidates.map(c => `<option value="${escapeAttr(c)}" ${nameColumn === c ? "selected" : ""}>${escapeHtml(c)} ★</option>`).join("")}
              ${sheets.flatMap(s => (s.columns || []).map(c => {
                const colName = c.name || c;
                if (!nameColumnCandidates.includes(colName)) {
                  return `<option value="${escapeAttr(colName)}" ${nameColumn === colName ? "selected" : ""}>${escapeHtml(colName)}</option>`;
                }
                return "";
              })).join("")}
            </select>
            <p class="upload-config-hint">用于图表X轴显示的人员/对象名称</p>
          </div>
          
          <!-- 图表类型 -->
          <div class="upload-config-section upload-config-section--chart">
            <div class="upload-config-section-header">
              <span class="upload-config-icon">📈</span>
              <label class="upload-config-label">图表类型</label>
            </div>
            <div class="upload-chart-type-selector">
              <label class="upload-chart-type-option ${chartType === "bar" ? "upload-chart-type-option--selected" : ""}">
                <input type="radio" name="chart-type" value="bar" ${chartType === "bar" ? "checked" : ""} />
                <span class="upload-chart-type-icon">📊</span>
                <span class="upload-chart-type-name">柱状图</span>
                <span class="upload-chart-type-desc">适合对比分析</span>
              </label>
              <label class="upload-chart-type-option ${chartType === "line" ? "upload-chart-type-option--selected" : ""}">
                <input type="radio" name="chart-type" value="line" ${chartType === "line" ? "checked" : ""} />
                <span class="upload-chart-type-icon">📉</span>
                <span class="upload-chart-type-name">折线图</span>
                <span class="upload-chart-type-desc">适合趋势展示</span>
              </label>
              <label class="upload-chart-type-option ${chartType === "pie" ? "upload-chart-type-option--selected" : ""}">
                <input type="radio" name="chart-type" value="pie" ${chartType === "pie" ? "checked" : ""} />
                <span class="upload-chart-type-icon">🥧</span>
                <span class="upload-chart-type-name">饼图</span>
                <span class="upload-chart-type-desc">适合占比分析</span>
              </label>
            </div>
          </div>
          
          <!-- 汇总模式 -->
          <div class="upload-config-section upload-config-section--mode">
            <div class="upload-config-section-header">
              <span class="upload-config-icon">🔄</span>
              <label class="upload-config-label">数据汇总模式</label>
            </div>
            <select class="upload-config-select" id="upload-config-aggregate-mode">
              <option value="sum" ${aggregateMode === "sum" ? "selected" : ""}>按人名累加（多日数据合计）</option>
              <option value="avg" ${aggregateMode === "avg" ? "selected" : ""}>按人名平均（多日数据平均）</option>
              <option value="single" ${aggregateMode === "single" ? "selected" : ""}>单Sheet展示（不汇总）</option>
            </select>
            <p class="upload-config-hint">当选择多个Sheet时，如何合并数据</p>
          </div>
          
          <!-- 权重计算 -->
          <div class="upload-config-section upload-config-section--weight">
            <div class="upload-config-toggle">
              <label class="upload-config-toggle-label">
                <input type="checkbox" id="upload-config-enable-weighted" ${state.uploadEnableWeightedSum ? "checked" : ""} />
                <span class="upload-config-toggle-switch"></span>
                <span class="upload-config-toggle-text">
                  <span class="upload-config-toggle-title">启用权重计算</span>
                  <span class="upload-config-toggle-desc">计算综合工作量指标</span>
                </span>
              </label>
            </div>
          </div>
          
          ${state.uploadEnableWeightedSum ? `
            <div class="upload-config-section upload-weights-section">
              <div class="upload-config-section-header">
                <span class="upload-config-icon">⚖️</span>
                <label class="upload-config-label">列权重配置</label>
              </div>
              <div class="upload-weights-grid">
                ${(() => {
                  const allColumns = [];
                  sheets.forEach(s => {
                    if (selectedSheets.includes(s.name)) {
                      (s.columns || []).forEach(c => {
                        const colName = c.name || c;
                        const colType = c.type || (typeof c === "object" && c.type === "数值" ? "数值" : "文本");
                        const isNumeric = colType === "数值" || (preview.raw_data && preview.raw_data[s.name] && preview.raw_data[s.name][0] && typeof preview.raw_data[s.name][0][colName] === "number");
                        if (isNumeric && colName !== nameColumn && !allColumns.includes(colName)) {
                          allColumns.push(colName);
                        }
                      });
                    }
                  });
                  const weights = state.uploadColumnWeights || {};
                  return allColumns.map(col => `
                    <div class="upload-weight-row">
                      <span class="upload-weight-col-name">${escapeHtml(col)}</span>
                      <input type="number" class="upload-weight-input" 
                        data-upload-weight-col="${escapeAttr(col)}"
                        value="${weights[col] !== undefined ? weights[col] : 1}"
                        step="0.1" />
                      <span class="upload-weight-unit">权重</span>
                    </div>
                  `).join("");
                })()}
              </div>
              <p class="upload-weights-hint">💡 综合工作量 = Σ(各列值 × 权重)，负数权重表示扣减项</p>
            </div>
          ` : ""}
        </div>
        
        <div class="upload-modal-foot">
          <button type="button" class="upload-modal-cancel" id="upload-modal-cancel-btn">取消</button>
          <button type="button" class="upload-modal-save" id="upload-modal-save-btn">✓ 保存配置</button>
        </div>
      </div>
    </div>
  `;
}

export function aggregateUploadDataByPerson(preview) {
  if (!preview || !preview.raw_data) return [];
  
  const nameColumn = state.uploadNameColumn || findNameColumn(preview);
  if (!nameColumn) {
    console.warn("aggregateUploadDataByPerson: 未找到人员列");
    return [];
  }
  
  const selectedSheets = state.uploadSelectedSheets.length > 0 ? state.uploadSelectedSheets : 
    (preview.sheets || []).map(s => s.name);
  const aggregateMode = state.uploadAggregateMode || "sum";
  
  const personMap = new Map();
  const personCountMap = new Map(); // 用于平均计算
  
  selectedSheets.forEach(sheetName => {
    const rows = preview.raw_data[sheetName] || [];
    rows.forEach(row => {
      const personName = String(row[nameColumn] || "").trim();
      if (!personName) return;
      
      if (!personMap.has(personName)) {
        personMap.set(personName, { 人员: personName });
        personCountMap.set(personName, {});
      }
      
      const personData = personMap.get(personName);
      const countData = personCountMap.get(personName);
      Object.keys(row).forEach(key => {
        if (key === nameColumn) return;
        const value = row[key];
        if (typeof value === "number") {
          if (aggregateMode === "avg") {
            personData[key] = (personData[key] || 0) + value;
            countData[key] = (countData[key] || 0) + 1;
          } else {
            personData[key] = (personData[key] || 0) + value;
          }
        } else if (!personData[key]) {
          personData[key] = value;
        }
      });
    });
  });
  
  // 平均模式下计算平均值
  if (aggregateMode === "avg") {
    personMap.forEach((personData, personName) => {
      const countData = personCountMap.get(personName);
      Object.keys(countData).forEach(key => {
        if (countData[key] > 0) {
          personData[key] = personData[key] / countData[key];
        }
      });
    });
  }
  
  // 加权综合工作量计算
  const enableWeighted = state.uploadEnableWeightedSum || false;
  const columnWeights = state.uploadColumnWeights || {};
  
  if (enableWeighted && Object.keys(columnWeights).length > 0) {
    personMap.forEach(personData => {
      let weightedSum = 0;
      Object.keys(personData).forEach(key => {
        if (typeof personData[key] === "number" && key !== "人员" && key !== "综合工作量") {
          // 如果该列有配置权重则使用，否则默认权重为0（不参与计算）
          const weight = columnWeights[key] !== undefined ? columnWeights[key] : 0;
          weightedSum += personData[key] * weight;
        }
      });
      personData["综合工作量"] = weightedSum;
    });
  } else if (enableWeighted) {
    // 启用了权重但没有配置权重时，默认所有数值列权重为1
    personMap.forEach(personData => {
      let weightedSum = 0;
      Object.keys(personData).forEach(key => {
        if (typeof personData[key] === "number" && key !== "人员") {
          weightedSum += personData[key];
        }
      });
      personData["综合工作量"] = weightedSum;
    });
  }
  
  const result = Array.from(personMap.values());
  
  // 动态查找数值列作为排序字段
  if (result.length > 0) {
    const numericCols = Object.keys(result[0]).filter(k => typeof result[0][k] === "number");
    const sortCol = enableWeighted ? "综合工作量" : (numericCols.length > 0 ? numericCols[0] : "人员");
    result.sort((a, b) => (b[sortCol] || 0) - (a[sortCol] || 0));
  }
  
  return result;
}

export function mountUploadChart() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  
  const el = document.getElementById("upload-chart-container");
  if (!el) return;
  
  // Dispose existing chart
  if (uploadChartInstance) {
    try { uploadChartInstance.dispose(); } catch (_) {}
    uploadChartInstance = null;
  }
  
  // Remove old resize handler
  if (uploadChartResizeHandler) {
    window.removeEventListener("resize", uploadChartResizeHandler);
    uploadChartResizeHandler = null;
  }
  
  const preview = state.uploadDataPreview;
  if (!preview) return;
  
  const aggregatedData = aggregateUploadDataByPerson(preview);
  if (!aggregatedData || aggregatedData.length === 0) return;
  
  const nameColumn = state.uploadNameColumn || findNameColumn(preview);
  const displayMode = state.uploadDisplayMode || "chart";
  
  if (displayMode === "table") {
    el.style.display = "none";
    const tableEl = document.getElementById("upload-table-container");
    if (tableEl) tableEl.style.display = "block";
    return;
  }
  
  el.style.display = "block";
  const tableEl = document.getElementById("upload-table-container");
  if (tableEl) tableEl.style.display = "none";
  
  // Find numeric columns (excluding name column)
  let numericCols = Object.keys(aggregatedData[0]).filter(k => 
    k !== nameColumn && typeof aggregatedData[0][k] === "number"
  );
  
  // 如果启用了权重计算，只显示综合工作量列
  const enableWeighted = state.uploadEnableWeightedSum || false;
  if (enableWeighted && aggregatedData[0]["综合工作量"] !== undefined) {
    numericCols = ["综合工作量"];
  }
  
  const chartType = state.uploadChartType || "bar";
  const xAxisData = aggregatedData.map(d => d[nameColumn] || "未知");
  
  // Create enhanced series with colors
  const series = numericCols.map((col, idx) => ({
    name: col,
    type: chartType,
    data: aggregatedData.map(d => d[col] || 0),
    smooth: chartType === "line",
    itemStyle: {
      color: UPLOAD_CHART_COLORS[idx % UPLOAD_CHART_COLORS.length],
      borderRadius: chartType === "bar" ? [4, 4, 0, 0] : 0,
    },
    emphasis: {
      focus: "series",
      itemStyle: {
        shadowBlur: 10,
        shadowColor: "rgba(0, 0, 0, 0.3)",
      }
    },
    animationDuration: 800,
    animationEasing: "cubicOut",
  }));
  
  // Calculate dynamic height based on data
  const optimalHeight = Math.max(350, Math.min(500, 50 * aggregatedData.length));
  el.style.height = `${optimalHeight}px`;
  
  uploadChartInstance = E.init(el, null, { renderer: "canvas" });
  
  // Enhanced chart options with better UX
  const chartOptions = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(50, 50, 50, 0.9)",
      borderColor: "#333",
      borderWidth: 1,
      padding: [10, 15],
      textStyle: {
        color: "#fff",
        fontSize: 14,
      },
      formatter: function(params) {
        if (!params || params.length === 0) return "";
        const name = params[0].axisValue;
        let html = `<div style="font-weight:600;margin-bottom:8px">${escapeHtml(name)}</div>`;
        params.forEach(p => {
          if (p.value !== undefined) {
            html += `<div style="display:flex;justify-content:space-between;gap:20px">
              <span>${escapeHtml(p.seriesName)}</span>
              <span style="font-weight:600">${p.value.toFixed(2)}</span>
            </div>`;
          }
        });
        return html;
      }
    },
    legend: {
      data: numericCols,
      top: 15,
      type: "scroll",
      textStyle: {
        fontSize: 13,
      },
      pageButtonItemGap: 5,
      pageButtonGap: 10,
    },
    grid: {
      left: "5%",
      right: "5%",
      bottom: "15%",
      top: "60px",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: xAxisData,
      axisLabel: {
        rotate: aggregatedData.length > 10 ? 45 : 0,
        fontSize: 12,
        color: "#666",
        interval: 0,
        overflow: "truncate",
        width: 80,
      },
      axisLine: {
        lineStyle: {
          color: "#ddd",
        }
      },
      axisTick: {
        alignWithLabel: true,
      }
    },
    yAxis: {
      type: "value",
      name: "数值",
      nameTextStyle: {
        fontSize: 12,
        color: "#666",
        padding: [0, 40, 0, 0],
      },
      axisLabel: {
        fontSize: 12,
        color: "#666",
        formatter: function(value) {
          if (value >= 1000) return (value / 1000).toFixed(1) + "k";
          return value.toFixed(0);
        }
      },
      splitLine: {
        lineStyle: {
          color: "#eee",
          type: "dashed",
        }
      }
    },
    series: series,
    animation: true,
    animationDuration: 1000,
    animationEasing: "cubicOut",
  };
  
  // Special options for pie chart
  if (chartType === "pie") {
    const pieData = aggregatedData.map((d, idx) => ({
      name: d[nameColumn] || "未知",
      value: numericCols.length > 0 ? d[numericCols[0]] || 0 : 0,
      itemStyle: {
        color: UPLOAD_CHART_COLORS[idx % UPLOAD_CHART_COLORS.length],
      }
    }));
    
    chartOptions.series = [{
      type: "pie",
      radius: ["35%", "65%"],
      center: ["50%", "55%"],
      data: pieData,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 5,
          shadowColor: "rgba(0, 0, 0, 0.3)",
        },
        label: {
          show: true,
          fontSize: 16,
          fontWeight: "bold",
        }
      },
      label: {
        show: true,
        formatter: "{b}: {c} ({d}%)",
        fontSize: 12,
      },
      labelLine: {
        show: true,
        length: 15,
        length2: 10,
      },
      animationType: "scale",
      animationEasing: "elasticOut",
    }];
    chartOptions.legend = {
      orient: "vertical",
      right: 10,
      top: "middle",
      type: "scroll",
    };
    chartOptions.tooltip = {
      trigger: "item",
      backgroundColor: "rgba(50, 50, 50, 0.9)",
      borderColor: "#333",
      borderWidth: 1,
      padding: [10, 15],
      textStyle: {
        color: "#fff",
        fontSize: 14,
      },
      formatter: "{b}: {c} ({d}%)",
    };
    delete chartOptions.xAxis;
    delete chartOptions.yAxis;
  }
  
  uploadChartInstance.setOption(chartOptions);
  
  // Add resize handler with debounce
  let resizeTimeout = null;
  uploadChartResizeHandler = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (uploadChartInstance) {
        uploadChartInstance.resize();
      }
    }, 100);
  };
  window.addEventListener("resize", uploadChartResizeHandler, { passive: true });
  
  // Add click event for drill-down
  uploadChartInstance.on("click", function(params) {
    if (params.componentType === "series") {
      console.log("Chart clicked:", params.name, params.value);
      // Could add drill-down functionality here
    }
  });
}

export async function fetchUploadSessions() {
  const operator = getCurrentOperator();
  try {
    const res = await fetch(`/api/upload/history?operator_id=${encodeURIComponent(operator.account)}`);
    if (!res.ok) return;
    const data = await res.json();
    state.uploadSessions = data.items || [];
  } catch (e) {
    console.error("fetchUploadSessions error:", e);
  }
}

export async function fetchUploadSessionDetail(sessionId) {
  if (!sessionId || sessionId <= 0) return;
  try {
    const res = await fetch(`/api/upload/session/${sessionId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && data.session) {
      state.currentUploadSession = data.session;
      state.uploadDataPreview = {
        sheets: data.session.available_sheets?.map(name => ({
          name,
          columns: Object.keys(data.session.raw_data?.[name]?.[0] || {}).map(c => ({ name: c })),
          row_count: (data.session.raw_data?.[name] || []).length
        })) || [],
        raw_data: data.session.raw_data || {},
        file_name: data.session.file_name
      };
      state.uploadSessionConfig = data.session.import_options || {};
      state.uploadDisplayMode = data.session.display_mode || "chart";
      state.uploadSelectedSheets = data.session.import_options?.selected_sheets || [];
      state.uploadNameColumn = data.session.import_options?.name_column || "";
    }
  } catch (e) {
    console.error("fetchUploadSessionDetail error:", e);
  }
}

export async function saveUploadSession() {
  const operator = getCurrentOperator();
  const preview = state.uploadDataPreview;
  if (!preview) {
    showUploadToast("请先上传数据", "error");
    return;
  }
  
  state.uploadLoading = true;
  requestRender();
  
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: operator.account,
        operator_name: operator.userName,
        file_name: preview.file_name || "",
        session_name: preview.file_name || "新会话",
        raw_data: preview.raw_data || {},
        available_sheets: (preview.sheets || []).map(s => s.name),
        import_options: {
          selected_sheets: state.uploadSelectedSheets,
          name_column: state.uploadNameColumn,
          avg_columns: state.uploadAvgColumns,
          chart_type: state.uploadChartType,
          aggregate_mode: state.uploadAggregateMode
        },
        display_mode: state.uploadDisplayMode
      })
    });
    state.uploadLoading = false;
    if (!res.ok) {
      showUploadToast("保存失败，请检查数据库连接", "error");
      return;
    }
    const data = await res.json();
    if (data.ok) {
      showUploadToast("保存成功", "success");
      await fetchUploadSessions();
      state.currentUploadSession = { id: data.session_id };
      requestRender();
    }
  } catch (e) {
    console.error("saveUploadSession error:", e);
  }
}

export async function deleteUploadSession() {
  const session = state.currentUploadSession;
  if (!session || !session.id) {
    showUploadToast("请先选择要删除的会话", "error");
    return;
  }
  const operator = getCurrentOperator();

  state.uploadLoading = true;
  requestRender();

  try {
    const res = await fetch(`/api/upload/delete/${session.id}?operator_id=${encodeURIComponent(operator.account)}`, {
      method: "POST"
    });
    state.uploadLoading = false;
    if (!res.ok) {
      showUploadToast("删除失败", "error");
      return;
    }
    const data = await res.json();
    if (data.ok) {
      showUploadToast("删除成功", "success");
      state.currentUploadSession = null;
      state.uploadDataPreview = null;
      await fetchUploadSessions();
      requestRender();
    }
  } catch (e) {
    state.uploadLoading = false;
    showUploadToast("删除失败，请检查网络", "error");
    console.error("deleteUploadSession error:", e);
  }
}

export async function applyConfigVersion(configId) {
  if (!configId) return;
  const operator = getCurrentOperator();

  state.uploadLoading = true;
  requestRender();

  try {
    const res = await fetch(`/api/session/config/apply/${configId}?operator_id=${encodeURIComponent(operator.account)}`, {
      method: "POST"
    });
    state.uploadLoading = false;
    if (!res.ok) {
      showUploadToast("应用配置失败", "error");
      return;
    }
    const data = await res.json();
    if (data.ok && state.currentUploadSession) {
      showUploadToast("配置已应用", "success");
      await fetchUploadSessionDetail(state.currentUploadSession.id);
      requestRender();
    }
  } catch (e) {
    state.uploadLoading = false;
    showUploadToast("应用失败，请检查网络", "error");
    console.error("applyConfigVersion error:", e);
  }
}

export function parseExcelFile(file) {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    showUploadToast("SheetJS未加载，请刷新页面", "error");
    console.error("SheetJS not loaded");
    return;
  }
  
  if (!file) {
    showUploadToast("未选择文件", "error");
    return;
  }
  
  // 检查文件类型
  const fileName = file.name || "";
  if (!fileName.match(/\.(xlsx|xls)$/i)) {
    showUploadToast("请上传Excel文件（.xlsx或.xls格式）", "error");
    console.error("Invalid file type:", fileName);
    return;
  }
  
  state.uploadLoading = true;
  requestRender();
  
  const reader = new FileReader();
  reader.onerror = () => {
    state.uploadLoading = false;
    showUploadToast("文件读取失败，请重试", "error");
    console.error("FileReader error");
  };
  
  reader.onload = (e) => {
    try {
      if (!e.target.result) {
        throw new Error("文件内容为空");
      }
      
      const data = new Uint8Array(e.target.result);
      const workbook = X.read(data, { type: "array" });
      
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error("Excel文件无有效Sheet");
      }
      
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const json = X.utils.sheet_to_json(sheet, { defval: "" });
        
        // 更健壮的列类型识别：检查多行数据来确定列类型
        const columns = json.length > 0 ? Object.keys(json[0]).map(k => {
          // 检查前几行数据来确定列类型
          let isNumeric = false;
          for (let i = 0; i < Math.min(5, json.length); i++) {
            const val = json[i][k];
            if (typeof val === "number" && !isNaN(val)) {
              isNumeric = true;
              break;
            }
          }
          return {
            name: k,
            type: isNumeric ? "数值" : "文本",
            sample: String(json[0][k] || "").slice(0, 20)
          };
        }) : [];
        return {
          name,
          columns,
          row_count: json.length,
          preview_rows: json.slice(0, 5)
        };
      });
      
      const raw_data = {};
      workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        raw_data[name] = X.utils.sheet_to_json(sheet, { defval: "" });
      });
      
      state.uploadDataPreview = {
        file_name: file.name,
        sheets,
        raw_data
      };
      state.uploadSelectedSheets = sheets.length > 0 ? [sheets[0].name] : [];
      state.uploadNameColumn = findNameColumn(state.uploadDataPreview);
      state.uploadBrowseTab = "overview";
      
      // 自动初始化选择的列（第一个 sheet 的数值列）
      const firstSheetName = sheets.length > 0 ? sheets[0].name : "";
      const numericCols = (sheets[0]?.columns || [])
        .filter(c => {
          const colType = typeof c === "object" ? c.type : "";
          return colType === "数值";
        })
        .map(c => typeof c === "object" ? c.name : c);
      
      // 只有当有数值列时才设置
      if (firstSheetName && numericCols.length > 0) {
        state.uploadSelectedColumns = { [firstSheetName]: numericCols };
        console.log("解析的数值列:", numericCols);
      } else {
        state.uploadSelectedColumns = {};
        console.log("未找到数值列");
      }
      
      state.uploadLoading = false;
      
      const totalRows = sheets.reduce((sum, s) => sum + s.row_count, 0);
      showUploadToast(`成功解析：${sheets.length}个Sheet，共${totalRows}行数据`, "success");
      requestRender();
    } catch (err) {
      state.uploadLoading = false;
      const errMsg = err.message || "未知错误";
      showUploadToast(`解析失败：${errMsg}`, "error");
      console.error("parseExcelFile error:", err);
    }
  };
  reader.readAsArrayBuffer(file);
}

export function bindUploadAnalysisPage() {
  // Load sessions on first visit (only once)
  if (!state.uploadSessionsLoaded) {
    state.uploadSessionsLoaded = true;
    fetchUploadSessions().then(() => requestRender());
  }
  
  // File upload
  const fileInput = document.getElementById("upload-file-input");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) parseExcelFile(file);
    });
  }
  
  // Session select
  const sessionSelect = document.getElementById("upload-session-select");
  if (sessionSelect) {
    sessionSelect.addEventListener("change", async (e) => {
      const sessionId = parseInt(e.target.value, 10);
      if (sessionId > 0) {
        await fetchUploadSessionDetail(sessionId);
        requestRender();
      } else {
        state.currentUploadSession = null;
        state.uploadDataPreview = null;
        requestRender();
      }
    });
  }
  
  // Display mode buttons
  document.querySelectorAll("[data-upload-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-upload-mode");
      if (!mode) return;
      state.uploadDisplayMode = mode;
      if (mode === "custom") {
        state.uploadShowConfigModal = true;
      }
      requestRender();
    });
  });
  
  // Browse tabs
  document.querySelectorAll("[data-upload-browse-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-upload-browse-tab");
      if (!tab) return;
      state.uploadBrowseTab = tab;
      requestRender();
    });
  });
  
  // Sheet selection
  document.querySelectorAll("[data-upload-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sheetName = btn.getAttribute("data-upload-sheet");
      if (!sheetName) return;
      const idx = state.uploadSelectedSheets.indexOf(sheetName);
      if (idx >= 0) {
        state.uploadSelectedSheets.splice(idx, 1);
      } else {
        state.uploadSelectedSheets.push(sheetName);
      }
      requestRender();
    });
  });
  
  // Column checkboxes
  document.querySelectorAll(".upload-col-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const colName = cb.getAttribute("data-upload-col");
      const selectedSheet = state.uploadSelectedSheets[0] || "";
      if (!colName || !selectedSheet) return;
      
      if (!state.uploadSelectedColumns[selectedSheet]) {
        state.uploadSelectedColumns[selectedSheet] = [];
      }
      
      const idx = state.uploadSelectedColumns[selectedSheet].indexOf(colName);
      if (cb.checked && idx < 0) {
        state.uploadSelectedColumns[selectedSheet].push(colName);
      } else if (!cb.checked && idx >= 0) {
        state.uploadSelectedColumns[selectedSheet].splice(idx, 1);
      }
      requestRender();
    });
  });
  
  // Config version buttons
  document.querySelectorAll("[data-upload-config-version]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const configId = parseInt(btn.getAttribute("data-upload-config-version"), 10);
      if (configId > 0) {
        await applyConfigVersion(configId);
      }
    });
  });
  
  // Save session button
  const saveBtn = document.getElementById("upload-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", saveUploadSession);
  }
  
  // Delete session button
  const deleteBtn = document.getElementById("upload-delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", deleteUploadSession);
  }
  
  // Modal controls
  const configBtn = document.getElementById("upload-config-btn");
  if (configBtn) {
    configBtn.addEventListener("click", () => {
      state.uploadShowConfigModal = true;
      requestRender();
    });
  }
  
  const modalClose = document.getElementById("upload-modal-close");
  if (modalClose) {
    modalClose.addEventListener("click", () => {
      state.uploadShowConfigModal = false;
      requestRender();
    });
  }
  
  const modalOverlay = document.getElementById("upload-modal-overlay");
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        state.uploadShowConfigModal = false;
        requestRender();
      }
    });
  }
  
  // Modal config inputs
  document.querySelectorAll(".upload-config-sheet").forEach((cb) => {
    cb.addEventListener("change", () => {
      const sheetName = cb.value;
      const idx = state.uploadSelectedSheets.indexOf(sheetName);
      if (cb.checked && idx < 0) {
        state.uploadSelectedSheets.push(sheetName);
      } else if (!cb.checked && idx >= 0) {
        state.uploadSelectedSheets.splice(idx, 1);
      }
      requestRender();
    });
  });
  
  const nameColSelect = document.getElementById("upload-config-name-column");
  if (nameColSelect) {
    nameColSelect.addEventListener("change", () => {
      state.uploadNameColumn = nameColSelect.value;
    });
  }
  
  // 图表类型radio按钮监听
  document.querySelectorAll("input[name='chart-type']").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        state.uploadChartType = radio.value;
        requestRender();
      }
    });
  });
  
  const aggregateModeSelect = document.getElementById("upload-config-aggregate-mode");
  if (aggregateModeSelect) {
    aggregateModeSelect.addEventListener("change", () => {
      state.uploadAggregateMode = aggregateModeSelect.value;
    });
  }
  
  const enableWeightedCb = document.getElementById("upload-config-enable-weighted");
  if (enableWeightedCb) {
    enableWeightedCb.addEventListener("change", () => {
      state.uploadEnableWeightedSum = enableWeightedCb.checked;
      requestRender();
    });
  }
  
  // 权重输入框监听
  document.querySelectorAll(".upload-weight-input").forEach((input) => {
    input.addEventListener("change", () => {
      const colName = input.getAttribute("data-upload-weight-col");
      const weightValue = parseFloat(input.value);
      if (!state.uploadColumnWeights) state.uploadColumnWeights = {};
      state.uploadColumnWeights[colName] = isNaN(weightValue) ? 0 : weightValue;
    });
  });
  
  const modalSave = document.getElementById("upload-modal-save-btn");
  if (modalSave) {
    modalSave.addEventListener("click", () => {
      // 收集所有权重值
      document.querySelectorAll(".upload-weight-input").forEach((input) => {
        const colName = input.getAttribute("data-upload-weight-col");
        const weightValue = parseFloat(input.value);
        if (!state.uploadColumnWeights) state.uploadColumnWeights = {};
        state.uploadColumnWeights[colName] = isNaN(weightValue) ? 0 : weightValue;
      });
      state.uploadShowConfigModal = false;
      state.uploadDisplayMode = "chart";
      requestRender();
    });
  }
  
  const modalCancel = document.getElementById("upload-modal-cancel-btn");
  if (modalCancel) {
    modalCancel.addEventListener("click", () => {
      state.uploadShowConfigModal = false;
      requestRender();
    });
  }
  
  // Mount chart
  mountUploadChart();
}

export function bindStatsReportPage() {
  document.querySelectorAll("[data-stats-report-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-report-period");
      if (!id || state.statsReportPeriod === id) return;
      state.statsReportPeriod = id;
      requestRender();
    });
  });
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

export function renderStatsChartsPage() {
  if (state.statsChartsTab === "passthrough") state.statsChartsTab = "labor";
  const laborFiltersRow = state.statsChartsTab === "labor" ? renderStatsLaborFiltersHtml() : "";
  const ownershipFiltersRow = state.statsChartsTab === "ownership" ? renderStatsOwnershipFiltersHtml() : "";
  const doerFiltersRow = state.statsChartsTab === "doer" ? renderStatsDoerFiltersHtml() : "";
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
      // 预设变化时清除 Doer 数据缓存，触发重新加载
      if (state.statsChartsTab === "doer") {
        state.statsDoerDataLoadedKey = "";
        state.statsDoerDataLoaded = false;
      }
      requestRender();
    });
  });

  function bindStatsLaborDateTrigger(triggerId, inputId, field, fallbackLabel) {
    const trigger = document.getElementById(triggerId);
    const input = document.getElementById(inputId);
    if (!trigger || !input) return;
    trigger.addEventListener("click", () => {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    });
    input.addEventListener("change", () => {
      if (field === "start") state.statsLaborStart = input.value;
      else state.statsLaborEnd = input.value;
      state.statsLaborPreset = "";
      trigger.textContent = input.value || fallbackLabel;
      // 时间变化时清除 Doer 数据缓存，触发重新加载
      if (state.statsChartsTab === "doer") {
        state.statsDoerDataLoadedKey = "";
        state.statsDoerDataLoaded = false;
      }
      requestRender();
    });
  }
  bindStatsLaborDateTrigger("stats-labor-start-trigger", "stats-labor-start-date", "start", "开始日期");
  bindStatsLaborDateTrigger("stats-labor-end-trigger", "stats-labor-end-date", "end", "结束日期");

  document.querySelectorAll("[data-stat-labor-select]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-stat-labor-select");
      if (!k || !STAT_LABOR_SELECT_STATE_KEYS.has(k)) return;
      state[k] = sel.value;
      requestRender();
    });
  });
  document.querySelectorAll("[data-stat-labor-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-stat-labor-field");
      const v = btn.getAttribute("data-stat-labor-value");
      if (!k || !STAT_LABOR_FIELD_STATE_KEYS.has(k) || v == null) return;
      state[k] = v;
      requestRender();
    });
  });

  document.querySelectorAll("[data-stats-ownership-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-stats-ownership-preset");
      if (!id) return;
      applyStatsOwnershipPreset(id);
      requestRender();
    });
  });

  function bindStatsOwnershipDateTrigger(triggerId, inputId, field, fallbackLabel) {
    const trigger = document.getElementById(triggerId);
    const input = document.getElementById(inputId);
    if (!trigger || !input) return;
    trigger.addEventListener("click", () => {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    });
    input.addEventListener("change", () => {
      if (field === "start") state.statsOwnershipStart = input.value;
      else state.statsOwnershipEnd = input.value;
      state.statsOwnershipPreset = "";
      trigger.textContent = input.value || fallbackLabel;
      requestRender();
    });
  }
  bindStatsOwnershipDateTrigger("stats-ownership-start-trigger", "stats-ownership-start-date", "start", "开始日期");
  bindStatsOwnershipDateTrigger("stats-ownership-end-trigger", "stats-ownership-end-date", "end", "结束日期");

  document.querySelectorAll("[data-stats-ownership-select]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-stats-ownership-select");
      if (!k || !STAT_OWNERSHIP_SELECT_KEYS.has(k)) return;
      const raw = sel.value;
      if (k === "statsOwnershipTopSiteN" || k === "statsOwnershipTopInstanceSiteN") state[k] = Number(raw) || 10;
      else state[k] = raw;
      requestRender();
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
      // 阶段变化时清除 Doer 数据缓存，触发重新加载
      state.statsDoerDataLoadedKey = "";
      state.statsDoerDataLoaded = false;
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
  if (state.statsChartsTab === "ownership") {
    requestAnimationFrame(() => {
      mountStatsOwnershipCharts();
    });
  }
  // Doer Tab 切换时触发数据加载
  if (state.statsChartsTab === "doer") {
    loadDoerStatsDataIfNeeded();
  }
}
