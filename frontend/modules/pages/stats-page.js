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
  STAT_LABOR_DEMO_ROSTER,
  STAT_LABOR_STACK_STAGES,
  STAT_LABOR_PIE_STAGES,
  STAT_LABOR_CHART_COLORS,
  STAT_LABOR_STACK_CHART_COLORS,
  STAT_LABOR_SELECT_STATE_KEYS,
  STAT_LABOR_FIELD_STATE_KEYS,
  STAT_OWNERSHIP_VERSIONS_FULL,
  STAT_OWNERSHIP_VERSIONS_SHORT,
  STAT_OWNERSHIP_BIZ_ENVS,
  STAT_OWNERSHIP_R_LINES,
  STAT_OWNERSHIP_MULTILINE_REF_COLORS,
  STAT_OWNERSHIP_CORE_C,
  STAT_OWNERSHIP_SPC,
  STAT_OWNERSHIP_MODULES_L3,
  STAT_OWNERSHIP_MODULES_L1,
  STAT_OWNERSHIP_SITE_NAMES,
  STAT_OWNERSHIP_SELECT_KEYS,
  statLaborHash,
  statLaborRand,
  statLaborPeopleForGroupFilter,
  statLaborSeriesInt,
  statLaborBarTopRoundPath,
  statLaborSvgBarVertical,
  statLaborSvgMultiLine,
  statLaborSvgLine,
  statLaborSvgStackedBars,
  statLaborSvgPie,
  statLaborPieLegend,
  statLaborStackLegend,
  statOwnershipSplitLineStyle,
  statOwnershipAxisLabel,
  getStatsReportPeriodBounds,
  statReportMix,
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
  buildStatsOwnershipTimeLabels,
  renderUploadKpiCard,
} from "./stats.js";
import { UPLOAD_CHART_COLORS, findNameColumn } from "./upload.js";
import { ensureAdminWhitelistModalOnBody } from "./admin-page.js";

let statsOwnershipChartInstances = {};

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

export function ensureStatsSkillsTab() {
  const key = "stats:skills";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "工单分析 Skill", closable: true });
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
    const name = candidates[i];
    const normalized = statsNormalizePersonName(name);
    const hit = state.adminUsers.find((u) => {
      const userName = String(u.user_name || "").trim();
      const account = String(u.account || "").trim();
      const userNameNormalized = statsNormalizePersonName(userName);
      return userName === name || account === name || userNameNormalized === normalized || account === normalized;
    });
    if (hit && String(hit.group_name || "").trim()) return String(hit.group_name || "").trim();
  }
  return "未分组";
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
  const lineAnim = { animationDuration: 980, animationEasing: "cubicOut" };
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

  const moduleOfTicket = (t) => {
    const st = statsTicketStage(t);
    if (st.includes("开发")) return "SQL引擎";
    if (st.includes("运维")) return "周边组件";
    return "存储引擎";
  };
  const l3OfTicket = (t) => {
    const st = statsTicketStage(t);
    if (st.includes("审核")) return "事务管理";
    if (st.includes("开发")) return "查询优化";
    if (st.includes("运维")) return "备份恢复";
    return "索引管理";
  };
  const moduleRows = new Map();
  allRows.forEach((t) => {
    const l1 = moduleOfTicket(t);
    const l3 = l3OfTicket(t);
    if (!moduleRows.has(l1)) moduleRows.set(l1, []);
    moduleRows.get(l1).push({ t, l3 });
  });
  const sunData = STAT_OWNERSHIP_MODULES_L1.map((L1) => {
    const rowsL1 = moduleRows.get(L1.label) || [];
    const byL3 = statsCountBy(rowsL1, (x) => x.l3);
    return {
      name: L1.label,
      children: STAT_OWNERSHIP_MODULES_L3.map((m) => {
        const v = byL3.get(m) || 0;
        return {
          name: m,
          value: v,
          children: [
            { name: "P1", value: Math.round(v * 0.2) },
            { name: "P2", value: Math.round(v * 0.5) },
            { name: "P3", value: Math.max(0, v - Math.round(v * 0.2) - Math.round(v * 0.5)) },
          ],
        };
      }),
    };
  });

  const l1Bars = STAT_OWNERSHIP_MODULES_L3.map((m) => ({
    name: m,
    value: allRows.filter((t) => l3OfTicket(t) === m).length,
  }));

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

  const spcKeys = versionsForSeries.map((v) => (v.includes("SPC") ? v : `${v}.SPC`)).slice(0, 5);
  const spcVals = spcKeys.map((v) => Math.max(0, Math.round((byVersion.get(v.replace(".SPC", "")) || 0) * 0.8)));
  const topInstSpcVals = spcKeys.map((v) => Math.max(0, Math.round((byVersion.get(v.replace(".SPC", "")) || 0) * 0.55)));

  const coreKeys = shortVers.map((v) => `${v}.0`);
  const coreVals = coreKeys.map((v) => Math.max(0, Math.round((byVersion.get(v.replace(".0", "")) || 0) * 0.7)));

  const topModLabs = STAT_OWNERSHIP_MODULES_L1.map((x) => x.label);
  const topModVals = topModLabs.map((m) => (moduleRows.get(m) || []).length);

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
          radius: ["18%", "92%"],
          sort: undefined,
          emphasis: { focus: "ancestor" },
          data: sunData,
          label: { rotate: "radial", color: "#3a3834", fontSize: 10 },
          itemStyle: {
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: "rgba(255, 252, 244, 0.85)",
          },
          levels: [
            {},
            { r0: "18%", r: "42%", label: { rotate: "tangential" } },
            { r0: "42%", r: "72%", label: { align: "right" } },
            { r0: "72%", r: "92%", label: { position: "outside", padding: 2 } },
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
        data: l1Bars.map((x) => x.name),
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 22 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: l1Bars.map((x) => x.value),
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
        data: STAT_OWNERSHIP_SPC,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 26, fontSize: 9 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [{ type: "bar", data: spcVals, barWidth: "52%", itemStyle: { borderRadius: [6, 6, 0, 0], color: STAT_LABOR_CHART_COLORS[4] } }],
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
        data: STAT_OWNERSHIP_SPC,
        axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate: 26, fontSize: 9 },
      },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [{ type: "bar", data: topInstSpcVals, barWidth: "52%", itemStyle: { borderRadius: [6, 6, 0, 0], color: STAT_LABOR_CHART_COLORS[3] } }],
    },
    ownCoreBar: {
      ...lineAnim,
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 22, bottom: 48 },
      xAxis: { type: "category", data: STAT_OWNERSHIP_CORE_C, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: coreVals,
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
      xAxis: { type: "category", data: topModLabs, axisLabel: statOwnershipAxisLabel() },
      yAxis: { type: "value", splitLine: statOwnershipSplitLineStyle(), axisLabel: statOwnershipAxisLabel() },
      series: [
        {
          type: "bar",
          data: topModVals,
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
  Object.keys(ids).forEach((key) => {
    const el = document.getElementById(ids[key]);
    if (!el) return;
    const chart = E.init(el, null, { renderer: "canvas" });
    chart.setOption(opts[key]);
    statsOwnershipChartInstances[key] = chart;
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
  const zc = E.getInstanceByDom(host);
  if (zc) zc.dispose();
  const big = E.init(host, null, { renderer: "canvas" });
  const zOpt = JSON.parse(JSON.stringify(opt));
  if (zOpt.legend && typeof zOpt.legend === "object" && !Array.isArray(zOpt.legend)) {
    zOpt.legend.textStyle = { ...(zOpt.legend.textStyle || {}), fontSize: 12 };
  }
  if (zOpt.xAxis && !Array.isArray(zOpt.xAxis) && zOpt.xAxis.axisLabel) {
    zOpt.xAxis.axisLabel.fontSize = (zOpt.xAxis.axisLabel.fontSize || 11) + 1;
  }
  big.setOption(zOpt);
  requestAnimationFrame(() => {
    try {
      big.resize();
    } catch (_) {
      // ignore
    }
  });
  window.__statsOwnershipZoomChart = big;
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
  tableHost.innerHTML = src
    ? `<div class="stat-ownership-table-scroll stat-ownership-table-zoom-inner">${src.outerHTML}</div>`
    : "";
  tableHost.removeAttribute("hidden");
  tableHost.style.display = "block";
  mountStatsChartZoomMaskToBody(mask);
  mask.classList.add("stats-ownership-zoom-mask--open");
  mask.setAttribute("aria-hidden", "false");
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
        ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
      </div>
      <div class="stat-glass-card-head-zoom">${zbtn}</div>
    </div>`
    : `<div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
    </div>`;
  return `<article class="stat-glass-card" style="--stat-card-delay:${d}s">
    ${headHtml}
    <div class="stat-glass-card-chart stat-chart-enter">
      ${innerHtml}
    </div>
  </article>`;
}

export function renderStatsOwnershipVersionCategoryTable() {
  const rows = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => String(t.bizEnv || "").trim() || "未知环境").keys()).slice(0, 8);
  const cols = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => statsTicketVersion(t)).keys()).slice(0, 11);
  const head = `<thead><tr><th class="stat-ownership-th-corner">业务环境 \\ 版本</th>${cols
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
  const rows = ["存储引擎", "SQL引擎", "周边组件"];
  const cols = Array.from(statsCountBy(statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd), (t) => statsTicketVersion(t)).keys()).slice(0, 5);
  const moduleOfTicket = (t) => {
    const st = statsTicketStage(t);
    if (st.includes("开发")) return "SQL引擎";
    if (st.includes("运维")) return "周边组件";
    return "存储引擎";
  };
  const head = `<thead><tr><th class="stat-ownership-th-corner">模块 \\ 版本</th>${cols
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => {
      const tds = cols
        .map((col) => {
          const v = statsTicketsInRange(state.statsOwnershipStart, state.statsOwnershipEnd).filter(
            (t) => moduleOfTicket(t) === row && statsTicketVersion(t) === col
          ).length;
          return `<td>${v}</td>`;
        })
        .join("");
      return `<tr><th scope="row" class="stat-ownership-row-head">${escapeHtml(row)}</th>${tds}</tr>`;
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
  laborPie8: "问题拦截占比",
  laborPie9: "突击队问题流转整体占比",
  laborFd: "问题流转详细占比",
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
    laborPie8: "问题拦截占比",
    laborPie9: "突击队问题流转整体占比",
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

export function renderStatLaborGlassCard(title, toolbarHtml, chartHtml, delayIdx, laborZoomKey) {
  const d = (delayIdx * 0.05).toFixed(2);
  const zbtn = laborZoomKey
    ? `<button type="button" class="stat-chart-zoom-btn" data-stats-labor-zoom="${escapeAttr(laborZoomKey)}" title="放大查看" aria-label="放大查看">⛶</button>`
    : "";
  const chartInner = laborZoomKey
    ? `<div class="stat-glass-card-chart stat-chart-enter"><div id="stats-labor-chart-${escapeAttr(laborZoomKey)}" class="stats-labor-chart-host">${chartHtml}</div></div>`
    : `<div class="stat-glass-card-chart stat-chart-enter">${chartHtml}</div>`;
  const headHtml = zbtn
    ? `<div class="stat-glass-card-head stat-glass-card-head--has-zoom">
      <div class="stat-glass-card-head-main">
        <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
        ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
      </div>
      <div class="stat-glass-card-head-zoom">${zbtn}</div>
    </div>`
    : `<div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      ${toolbarHtml ? `<div class="stat-glass-card-toolbar">${toolbarHtml}</div>` : ""}
    </div>`;
  return `<article class="stat-glass-card" style="--stat-card-delay:${d}s">
    ${headHtml}
    ${chartInner}
  </article>`;
}

export function renderStatsLaborSectionCardsHtml() {
  const rows = statsTicketsInRange(state.statsLaborStart, state.statsLaborEnd);
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
  const chart4 = `${statLaborStackLegend(STAT_LABOR_STACK_STAGES)}${statLaborSvgStackedBars(
    stackGroups,
    STAT_LABOR_STACK_STAGES,
    (gi, key) => (rowsByGroup.get(stackGroups[gi]) || []).filter((t) => statsTicketStage(t) === key && String(t.status || "").toLowerCase() !== "closed").length,
    { aria: "各组未闭环分阶段" }
  )}`;

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
  const chart6 = `${statLaborStackLegend(personDwellStages)}${statLaborSvgStackedBars(
    people6b.length ? people6b : ["—"],
    personDwellStages,
    (gi, key) => {
      const person = people6b[gi];
      const pr = rows.filter((t) => statsTicketPersonName(t) === person);
      const mr = selectedModule === "all" ? pr : pr.filter((t) => statsTicketComponent(t) === selectedModule);
      return mr.filter((t) => statsTicketStage(t) === key).length;
    },
    { aria: "各阶段人员滞留时间" }
  )}<p class="stat-chart-unit-hint">纵轴：按问题单数统计</p>`;

  const stageAll = statsCountBy(rows, (t) => statsTicketStage(t));
  const pie7Slices = STAT_LABOR_PIE_STAGES.map((label) => ({ label, value: stageAll.get(label) || 0 }));
  const chart7 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie7Slices, { aria: "各阶段问题占比" })}</div>${statLaborPieLegend(pie7Slices)}</div>`;

  const q8 = state.statsLaborInterceptQuality;
  const rows8 = rows.filter((t) => (q8 === "all" ? true : q8 === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t)));
  const group8 = statsCountBy(rows8, (t) => statsUserGroupByTicket(t));
  const pie8Slices = [
    { label: "特战队拦截", value: group8.get("特战队") || 0 },
    { label: "尖刀连拦截", value: group8.get("尖刀连") || 0 },
    { label: "突击队拦截", value: group8.get("突击队") || 0 },
  ];
  const chart8 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie8Slices, { aria: "问题拦截占比" })}</div>${statLaborPieLegend(pie8Slices)}</div>`;

  const q9 = state.statsLaborCommandoFlowQuality;
  const rows9 = rows.filter((t) => (q9 === "all" ? true : q9 === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t)));
  const commando = rows9.filter((t) => statsUserGroupByTicket(t) === "突击队");
  const pie9Slices = [
    { label: "流转至特战队", value: commando.filter((t) => statsUserGroupByTicket(t) === "特战队").length },
    { label: "独立闭环", value: commando.filter((t) => String(t.status || "").toLowerCase() === "closed").length },
    { label: "流转至尖刀连", value: commando.filter((t) => statsUserGroupByTicket(t) === "尖刀连").length },
  ];
  const chart9 = `<div class="stat-pie-row"><div class="stat-pie-wrap">${statLaborSvgPie(pie9Slices, { aria: "突击队问题流转占比" })}</div>${statLaborPieLegend(pie9Slices)}</div>`;

  const flowKeys = ["流转至尖刀连", "独立闭环"];
  const selectedFlowGroup = getStatsLaborSelectedGroup("statsLaborFlowDetailGroup");
  const rows10Base = selectedFlowGroup ? rows.filter((t) => statsUserGroupByTicket(t) === selectedFlowGroup) : rows;
  const rows10 = rows10Base.filter((t) => {
    const q = String(state.statsLaborFlowDetailQuality || "all");
    return q === "all" ? true : q === "quality" ? statsTicketIsQuality(t) : !statsTicketIsQuality(t);
  });
  const people10b = Array.from(new Set(rows10.map((t) => statsTicketPersonName(t)).filter((name) => name && name !== "未分配"))).slice(0, 12);
  const chart10 = `${statLaborStackLegend(flowKeys)}${statLaborSvgStackedBars(
    people10b.length ? people10b : ["—"],
    flowKeys,
    (gi, key) => {
      const person = people10b[gi];
      const r = rows10.filter((t) => statsTicketPersonName(t) === person);
      if (key === "独立闭环") return r.filter((t) => String(t.status || "").toLowerCase() === "closed").length;
      return r.filter((t) => statsTicketStage(t).includes("开发") || statsTicketStage(t).includes("运维")).length;
    },
    { aria: "问题流转详细占比" }
  )}`;

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
    renderStatLaborGlassCard("各组未闭环问题数量", renderStatLaborGroupSelect("statsLaborGroupStackGroup", "组别"), chart4, 3, "laborGs"),
    renderStatLaborGlassCard(
      "各阶段问题平均滞留时间",
      `${renderStatLaborGroupSelect("statsLaborAvgDwellGroup", "组别")}${renderStatLaborQualityToggle("statsLaborAvgDwellQuality")}`,
      chart5 + chart5Note,
      4,
      "laborDwell"
    ),
    renderStatLaborGlassCard(
      "各阶段人员平均滞留时间",
      `${renderStatLaborGroupSelect("statsLaborPersonDwellGroup", "组别")}${renderStatLaborModuleToggle("statsLaborPersonDwellModule")}`,
      chart6,
      5,
      "laborPdw"
    ),
    renderStatLaborGlassCard("各阶段问题占比", "", chart7, 6, "laborPie7"),
    renderStatLaborGlassCard("问题拦截占比", renderStatLaborQualityToggle("statsLaborInterceptQuality"), chart8, 7, "laborPie8"),
    renderStatLaborGlassCard("突击队问题流转整体占比", renderStatLaborQualityToggle("statsLaborCommandoFlowQuality"), chart9, 8, "laborPie9"),
    renderStatLaborGlassCard(
      "问题流转详细占比",
      `${renderStatLaborQualityToggle("statsLaborFlowDetailQuality")}${renderStatLaborGroupSelect("statsLaborFlowDetailGroup", "组别")}`,
      chart10,
      9,
      "laborFd"
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
  const byModule = statsCountBy(rows, (t) => {
    const st = statsTicketStage(t);
    if (st.includes("开发")) return "SQL引擎";
    if (st.includes("运维")) return "周边组件";
    return "存储引擎";
  });
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
    .map(([name, cnt]) => ({ name, h: total > 0 ? Math.round((cnt / total) * Math.max(8, dwellH)) : 0 }))
    .slice(0, 6);
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
  const ptDelta = Math.floor(statReportMix(period, 999) * 12);
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
          <span>全量 <strong>${d.passthroughPct}%</strong></span>
          <span>质量问题 <strong>${Math.min(99, d.passthroughPct + ptDelta)}%</strong></span>
          <span>非质量问题 <strong>${Math.max(3, d.passthroughPct - ptDelta)}%</strong></span>
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
  const hasChartData = hasData && state.uploadSelectedColumns && Object.keys(state.uploadSelectedColumns).length > 0;
  
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
  
  return `
    <div class="upload-modal-overlay" id="upload-modal-overlay">
      <div class="upload-modal">
        <div class="upload-modal-head">
          <h3>配置导入选项</h3>
          <button type="button" class="upload-modal-close" id="upload-modal-close">关闭</button>
        </div>
        <div class="upload-modal-body">
          <div class="upload-config-section">
            <label class="upload-config-label">选择 Sheet：</label>
            <div class="upload-config-sheets">
              ${sheets.map(s => `
                <label class="upload-sheet-checkbox">
                  <input type="checkbox" value="${escapeAttr(s.name)}" 
                    class="upload-config-sheet" data-upload-config-sheet="${escapeAttr(s.name)}"
                    ${selectedSheets.includes(s.name) ? "checked" : ""} />
                  <span>${escapeHtml(s.name)}</span>
                </label>
              `).join("")}
            </div>
          </div>
          
          <div class="upload-config-section">
            <label class="upload-config-label">人员字段（横轴）：</label>
            <select class="upload-config-select" id="upload-config-name-column">
              <option value="">自动识别</option>
              ${nameColumnCandidates.map(c => `<option value="${escapeAttr(c)}" ${nameColumn === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
              ${sheets.flatMap(s => (s.columns || []).map(c => {
                const colName = c.name || c;
                if (!nameColumnCandidates.includes(colName)) {
                  return `<option value="${escapeAttr(colName)}" ${nameColumn === colName ? "selected" : ""}>${escapeHtml(colName)}</option>`;
                }
                return "";
              })).join("")}
            </select>
          </div>
          
          <div class="upload-config-section">
            <label class="upload-config-label">图表类型：</label>
            <select class="upload-config-select" id="upload-config-chart-type">
              <option value="bar" ${state.uploadChartType === "bar" ? "selected" : ""}>柱状图</option>
              <option value="line" ${state.uploadChartType === "line" ? "selected" : ""}>折线图</option>
              <option value="pie" ${state.uploadChartType === "pie" ? "selected" : ""}>饼图</option>
            </select>
          </div>
          
          <div class="upload-config-section">
            <label class="upload-config-label">汇总模式：</label>
            <select class="upload-config-select" id="upload-config-aggregate-mode">
              <option value="sum">按人名累加</option>
              <option value="avg">按人名平均</option>
              <option value="single">单Sheet展示</option>
            </select>
          </div>
          
          <div class="upload-config-section">
            <label class="upload-config-label">
              <input type="checkbox" id="upload-config-enable-weighted" ${state.uploadEnableWeightedSum ? "checked" : ""} />
              启用权重计算（综合工作量）
            </label>
          </div>
          
          ${state.uploadEnableWeightedSum ? `
            <div class="upload-config-section upload-weights-section">
              <label class="upload-config-label">列权重配置（支持正负值）：</label>
              <div class="upload-weights-grid">
                ${(() => {
                  const allColumns = [];
                  sheets.forEach(s => {
                    if (selectedSheets.includes(s.name)) {
                      (s.columns || []).forEach(c => {
                        const colName = c.name || c;
                        const colType = c.type || (typeof c === "object" && c.type === "数值" ? "数值" : "文本");
                        // 判断是否为数值类型列
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
              <p class="upload-weights-hint">综合工作量 = Σ(各列值 × 权重)，权重可为负数表示扣减项</p>
            </div>
          ` : ""}
        </div>
        <div class="upload-modal-foot">
          <button type="button" class="upload-modal-cancel" id="upload-modal-cancel-btn">取消</button>
          <button type="button" class="upload-modal-save" id="upload-modal-save-btn">保存配置</button>
        </div>
      </div>
    </div>
  `;
}

export function aggregateUploadDataByPerson(preview) {
  if (!preview || !preview.raw_data) return [];
  
  const nameColumn = state.uploadNameColumn || findNameColumn(preview);
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
  
  state.uploadLoading = true;
  requestRender();
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = X.read(data, { type: "array" });
      
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
      if (sheets.length > 0 && sheets[0].columns) {
        const firstSheetName = sheets[0].name;
        const numericCols = sheets[0].columns
          .filter(c => {
            const colType = typeof c === "object" ? c.type : "";
            return colType === "数值";
          })
          .map(c => typeof c === "object" ? c.name : c);
        state.uploadSelectedColumns = { [firstSheetName]: numericCols };
        console.log("解析的数值列:", numericCols);
      } else {
        state.uploadSelectedColumns = {};
      }
      
      state.uploadLoading = false;
      
      showUploadToast(`成功解析 ${sheets.length} 个Sheet`, "success");
      requestRender();
    } catch (err) {
      state.uploadLoading = false;
      showUploadToast("文件解析失败，请检查格式", "error");
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
    });
  });
  
  const nameColSelect = document.getElementById("upload-config-name-column");
  if (nameColSelect) {
    nameColSelect.addEventListener("change", () => {
      state.uploadNameColumn = nameColSelect.value;
    });
  }
  
  const chartTypeSelect = document.getElementById("upload-config-chart-type");
  if (chartTypeSelect) {
    chartTypeSelect.addEventListener("change", () => {
      state.uploadChartType = chartTypeSelect.value;
    });
  }
  
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

export async function fetchStatsSkillsList() {
  state.statsSkillsLoading = true;
  try {
    const op = getCurrentOperator();
    const q = new URLSearchParams({ operator_id: op.account });
    const r = await fetch(`${API_BASE_URL}/api/stats/skills?${q.toString()}`);
    if (!r.ok) {
      const j = await r.json();
      throw new Error(j.detail || "获取 Skill 列表失败");
    }
    const j = await r.json();
    state.statsSkillsList = j.items || [];
  } catch (e) {
    state.statsSkillsList = [];
    console.error(e);
  }
  state.statsSkillsLoading = false;
}

export function resetStatsSkillsEditForm() {
  state.statsSkillsEditForm = {
    name: "",
    description: "",
    api_base_url: "",
    api_key: "",
    model: "gpt-4o",
    max_tokens: 4096,
    temperature: 0.3,
    system_prompt: "",
    analysis_prompt_template: "",
    input_fields: null,
    output_format: null,
    is_enabled: true,
  };
}

export function openStatsSkillsCreateModal() {
  resetStatsSkillsEditForm();
  state.statsSkillsEditMode = "create";
  state.statsSkillsSelectedId = null;
  state.statsSkillsEditModalOpen = true;
  state.statsSkillsTestResult = null;
  requestRender();
}

export function openStatsSkillsEditModal(skill) {
  state.statsSkillsEditForm = {
    name: skill.name || "",
    description: skill.description || "",
    api_base_url: skill.api_base_url || "",
    api_key: skill.api_key || "",
    model: skill.model || "gpt-4o",
    max_tokens: skill.max_tokens || 4096,
    temperature: skill.temperature || 0.3,
    system_prompt: skill.system_prompt || "",
    analysis_prompt_template: skill.analysis_prompt_template || "",
    input_fields: skill.input_fields || null,
    output_format: skill.output_format || null,
    is_enabled: skill.is_enabled !== false,
  };
  state.statsSkillsEditMode = "edit";
  state.statsSkillsSelectedId = skill.id;
  state.statsSkillsEditModalOpen = true;
  state.statsSkillsTestResult = null;
  requestRender();
}

export async function saveStatsSkillsEdit() {
  const op = getCurrentOperator();
  const form = state.statsSkillsEditForm;
  const payload = {
    operator_id: op.account,
    operator_name: op.userName || "",
    name: form.name,
    description: form.description,
    api_base_url: form.api_base_url,
    api_key: form.api_key,
    model: form.model,
    max_tokens: form.max_tokens,
    temperature: form.temperature,
    system_prompt: form.system_prompt,
    analysis_prompt_template: form.analysis_prompt_template,
    input_fields: form.input_fields,
    output_format: form.output_format,
    is_enabled: form.is_enabled,
  };
  try {
    let r;
    if (state.statsSkillsEditMode === "create") {
      r = await fetch(`${API_BASE_URL}/api/stats/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(`${API_BASE_URL}/api/stats/skills/${state.statsSkillsSelectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    if (!r.ok) {
      const j = await r.json();
      throw new Error(j.detail || "保存失败");
    }
    state.statsSkillsEditModalOpen = false;
    await fetchStatsSkillsList();
    requestRender();
  } catch (e) {
    alert(e.message);
  }
}

export async function deleteStatsSkill(skillId) {
  const op = getCurrentOperator();
  try {
    const q = new URLSearchParams({ operator_id: op.account });
    const r = await fetch(`${API_BASE_URL}/api/stats/skills/${skillId}?${q.toString()}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const j = await r.json();
      throw new Error(j.detail || "删除失败");
    }
    await fetchStatsSkillsList();
    requestRender();
  } catch (e) {
    alert(e.message);
  }
}

export async function testStatsSkillConnect(skillId) {
  const op = getCurrentOperator();
  state.statsSkillsTestLoading = true;
  state.statsSkillsTestResult = null;
  requestRender();
  try {
    const r = await fetch(`${API_BASE_URL}/api/stats/skills/${skillId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account }),
    });
    const j = await r.json();
    state.statsSkillsTestResult = j;
  } catch (e) {
    state.statsSkillsTestResult = { ok: false, detail: e.message };
  }
  state.statsSkillsTestLoading = false;
  requestRender();
}

export async function testStatsSkillEditConnect() {
  const op = getCurrentOperator();
  state.statsSkillsTestLoading = true;
  state.statsSkillsTestResult = null;
  requestRender();
  const form = state.statsSkillsEditForm;
  const payload = {
    operator_id: op.account,
    api_base_url: form.api_base_url,
    api_key: form.api_key,
    model: form.model,
    max_tokens: form.max_tokens,
    temperature: form.temperature,
  };
  try {
    let r;
    if (state.statsSkillsEditMode === "edit" && state.statsSkillsSelectedId) {
      r = await fetch(`${API_BASE_URL}/api/stats/skills/${state.statsSkillsSelectedId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account }),
      });
    } else {
      r = await fetch(`${API_BASE_URL}/api/stats/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          operator_name: "",
          name: "临时测试",
          api_base_url: form.api_base_url,
          api_key: form.api_key,
          model: form.model,
          max_tokens: 16,
          temperature: form.temperature,
          analysis_prompt_template: "测试",
          is_enabled: false,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const tempId = j.item?.id;
        if (tempId) {
          const tr = await fetch(`${API_BASE_URL}/api/stats/skills/${tempId}/test`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operator_id: op.account }),
          });
          const tj = await tr.json();
          state.statsSkillsTestResult = tj;
          await fetch(`${API_BASE_URL}/api/stats/skills/${tempId}?operator_id=${op.account}`, {
            method: "DELETE",
          });
        }
      } else {
        const j = await r.json();
        state.statsSkillsTestResult = { ok: false, detail: j.detail };
      }
    }
    if (!state.statsSkillsTestResult && r && r.ok) {
      const j = await r.json();
      state.statsSkillsTestResult = j;
    }
  } catch (e) {
    state.statsSkillsTestResult = { ok: false, detail: e.message };
  }
  state.statsSkillsTestLoading = false;
  requestRender();
}

export function renderStatsSkillsPage() {
  const items = state.statsSkillsList || [];
  const loading = state.statsSkillsLoading;
  const modalOpen = state.statsSkillsEditModalOpen;
  const editMode = state.statsSkillsEditMode;
  const form = state.statsSkillsEditForm;
  const testResult = state.statsSkillsTestResult;
  const testLoading = state.statsSkillsTestLoading;

  const cardHtml = items
    .map((s) => {
      const badgeClass = s.is_builtin ? "skill-badge--builtin" : s.is_enabled ? "skill-badge--enabled" : "skill-badge--disabled";
      const badgeLabel = s.is_builtin ? "内置" : s.is_enabled ? "启用" : "禁用";
      const editBtn = `<button type="button" class="skill-card-btn" data-skill-edit="${s.id}">编辑</button>`;
      const testBtn = `<button type="button" class="skill-card-btn skill-card-btn--test" data-skill-test="${s.id}">测试连接</button>`;
      const deleteBtn = `<button type="button" class="skill-card-btn skill-card-btn--delete" data-skill-delete="${s.id}">删除</button>`;
      return `
        <div class="skill-card">
          <div class="skill-card-head">
            <span class="skill-card-name">${escapeHtml(s.name || "")}</span>
            <span class="skill-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <div class="skill-card-body">
            <div class="skill-card-meta">
              <span class="skill-card-model">${escapeHtml(s.model || "gpt-4o")}</span>
            </div>
            <div class="skill-card-desc">${escapeHtml(s.description || "")}</div>
          </div>
          <div class="skill-card-actions">
            ${editBtn}
            ${testBtn}
            ${deleteBtn}
          </div>
        </div>
      `;
    })
    .join("");

  const modalHtml = modalOpen
    ? `
      <div class="skill-modal-overlay" id="skill-modal-overlay">
        <div class="skill-modal">
          <div class="skill-modal-head">
            <span class="skill-modal-title">${editMode === "create" ? "新增 Skill" : "编辑 Skill"}</span>
            <button type="button" class="skill-modal-close" id="skill-modal-close">×</button>
          </div>
          <div class="skill-modal-body">
            <div class="skill-modal-section">
              <label class="skill-modal-label">Skill 名称 *</label>
              <input type="text" class="skill-modal-input" id="skill-form-name" value="${escapeAttr(form.name)}" />
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">描述说明</label>
              <textarea class="skill-modal-textarea" id="skill-form-description">${escapeHtml(form.description)}</textarea>
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">API 地址 *</label>
              <input type="text" class="skill-modal-input" id="skill-form-api-base-url" value="${escapeAttr(form.api_base_url)}" placeholder="https://api.openai.com/v1" />
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">API Key *</label>
              <input type="text" class="skill-modal-input" id="skill-form-api-key" value="${escapeAttr(form.api_key)}" />
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">模型名称</label>
              <input type="text" class="skill-modal-input" id="skill-form-model" value="${escapeAttr(form.model)}" placeholder="gpt-4o" />
            </div>
            <div class="skill-modal-row">
              <div class="skill-modal-section skill-modal-section--half">
                <label class="skill-modal-label skill-modal-label-with-tip">
                  Max Tokens
                  <span class="skill-modal-tip-icon" data-skill-tip="max-tokens">?</span>
                  <div class="skill-modal-tip" id="skill-tip-max-tokens">
                    <div class="skill-modal-tip-title">Max Tokens 说明</div>
                    <div class="skill-modal-tip-content">限制模型输出的最大长度（token数）。超过此限制，输出会被截断。</div>
                    <div class="skill-modal-tip-suggest">推荐值：工单分析建议 2000-4096；简单摘要建议 500-1000。</div>
                  </div>
                </label>
                <input type="number" class="skill-modal-input" id="skill-form-max-tokens" value="${form.max_tokens}" />
              </div>
              <div class="skill-modal-section skill-modal-section--half">
                <label class="skill-modal-label skill-modal-label-with-tip">
                  Temperature
                  <span class="skill-modal-tip-icon" data-skill-tip="temperature">?</span>
                  <div class="skill-modal-tip" id="skill-tip-temperature">
                    <div class="skill-modal-tip-title">Temperature 说明</div>
                    <div class="skill-modal-tip-content">控制输出的随机性。值越低越稳定一致，值越高越有创造性。</div>
                    <div class="skill-modal-tip-suggest">推荐值：工单分析建议 0.1-0.3，确保输出稳定可预测。</div>
                  </div>
                </label>
                <input type="number" class="skill-modal-input" id="skill-form-temperature" value="${form.temperature}" step="0.1" />
              </div>
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">系统提示词</label>
              <textarea class="skill-modal-textarea skill-modal-textarea--long" id="skill-form-system-prompt">${escapeHtml(form.system_prompt)}</textarea>
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">分析提示词模板 *</label>
              <textarea class="skill-modal-textarea skill-modal-textarea--long" id="skill-form-template">${escapeHtml(form.analysis_prompt_template)}</textarea>
            </div>
            <div class="skill-modal-section">
              <label class="skill-modal-label">是否启用</label>
              <input type="checkbox" id="skill-form-enabled" ${form.is_enabled ? "checked" : ""} />
            </div>
            <div class="skill-modal-test-row">
              <button type="button" class="skill-modal-btn skill-modal-btn--test" id="skill-test-connect-btn" ${testLoading ? "disabled" : ""}>${testLoading ? "测试中..." : "测试连接"}</button>
              ${testResult ? `<span class="skill-test-result ${testResult.ok ? "skill-test-result--ok" : "skill-test-result--fail"}">${escapeHtml(testResult.detail || (testResult.ok ? "成功" : "失败"))}</span>` : ""}
            </div>
          </div>
          <div class="skill-modal-foot">
            <button type="button" class="skill-modal-btn" id="skill-modal-cancel">取消</button>
            <button type="button" class="skill-modal-btn skill-modal-btn--primary" id="skill-modal-save">保存</button>
          </div>
        </div>
      </div>
    `
    : "";

  return `
    <section class="stats-skills-page" aria-label="工单分析 Skill">
      <div class="stats-skills-toolbar">
        <button type="button" class="action primary" id="skill-create-btn">+ 新增 Skill</button>
      </div>
      <div class="stats-skills-list" id="stats-skills-list" aria-live="polite">
        ${loading ? `<div class="skill-loading">加载中...</div>` : cardHtml || `<div class="skill-empty">暂无 Skill 配置</div>`}
      </div>
      ${modalHtml}
    </section>
  `;
}

export function bindStatsSkillsPage() {
  const createBtn = document.getElementById("skill-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      openStatsSkillsCreateModal();
    });
  }

  document.querySelectorAll("[data-skill-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.getAttribute("data-skill-edit"), 10);
      const skill = state.statsSkillsList.find((s) => s.id === id);
      if (skill) {
        openStatsSkillsEditModal(skill);
      }
    });
  });

  document.querySelectorAll("[data-skill-test]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = parseInt(btn.getAttribute("data-skill-test"), 10);
      await testStatsSkillConnect(id);
    });
  });

  document.querySelectorAll("[data-skill-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = parseInt(btn.getAttribute("data-skill-delete"), 10);
      const skill = state.statsSkillsList.find((s) => s.id === id);
      if (skill && confirm(`确定删除 Skill "${skill.name}"？`)) {
        await deleteStatsSkill(id);
      }
    });
  });

  const modalOverlay = document.getElementById("skill-modal-overlay");
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        state.statsSkillsEditModalOpen = false;
        requestRender();
      }
    });
  }

  const modalClose = document.getElementById("skill-modal-close");
  if (modalClose) {
    modalClose.addEventListener("click", () => {
      state.statsSkillsEditModalOpen = false;
      requestRender();
    });
  }

  const modalCancel = document.getElementById("skill-modal-cancel");
  if (modalCancel) {
    modalCancel.addEventListener("click", () => {
      state.statsSkillsEditModalOpen = false;
      requestRender();
    });
  }

  const modalSave = document.getElementById("skill-modal-save");
  if (modalSave) {
    modalSave.addEventListener("click", async () => {
      const nameInput = document.getElementById("skill-form-name");
      const descInput = document.getElementById("skill-form-description");
      const apiUrlInput = document.getElementById("skill-form-api-base-url");
      const apiKeyInput = document.getElementById("skill-form-api-key");
      const modelInput = document.getElementById("skill-form-model");
      const maxTokensInput = document.getElementById("skill-form-max-tokens");
      const tempInput = document.getElementById("skill-form-temperature");
      const sysPromptInput = document.getElementById("skill-form-system-prompt");
      const templateInput = document.getElementById("skill-form-template");
      const enabledInput = document.getElementById("skill-form-enabled");

      state.statsSkillsEditForm.name = nameInput?.value || "";
      state.statsSkillsEditForm.description = descInput?.value || "";
      state.statsSkillsEditForm.api_base_url = apiUrlInput?.value || "";
      state.statsSkillsEditForm.api_key = apiKeyInput?.value || "";
      state.statsSkillsEditForm.model = modelInput?.value || "gpt-4o";
      state.statsSkillsEditForm.max_tokens = parseInt(maxTokensInput?.value || "4096", 10);
      state.statsSkillsEditForm.temperature = parseFloat(tempInput?.value || "0.3");
      state.statsSkillsEditForm.system_prompt = sysPromptInput?.value || "";
      state.statsSkillsEditForm.analysis_prompt_template = templateInput?.value || "";
      state.statsSkillsEditForm.is_enabled = enabledInput?.checked ?? true;

      await saveStatsSkillsEdit();
    });
  }

  const testConnectBtn = document.getElementById("skill-test-connect-btn");
  if (testConnectBtn) {
    testConnectBtn.addEventListener("click", async () => {
      const apiUrlInput = document.getElementById("skill-form-api-base-url");
      const apiKeyInput = document.getElementById("skill-form-api-key");
      const modelInput = document.getElementById("skill-form-model");
      const maxTokensInput = document.getElementById("skill-form-max-tokens");
      const tempInput = document.getElementById("skill-form-temperature");

      state.statsSkillsEditForm.api_base_url = apiUrlInput?.value || "";
      state.statsSkillsEditForm.api_key = apiKeyInput?.value || "";
      state.statsSkillsEditForm.model = modelInput?.value || "gpt-4o";
      state.statsSkillsEditForm.max_tokens = parseInt(maxTokensInput?.value || "4096", 10);
      state.statsSkillsEditForm.temperature = parseFloat(tempInput?.value || "0.3");

      await testStatsSkillEditConnect();
    });
  }
}

export function renderStatsChartsTabSegHtml() {
  const tabOrder = ["labor", "ownership", "passthrough"];
  const tabLabels = { labor: "人力投入", ownership: "问题归属", passthrough: "透传分析" };
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
  const laborFiltersRow = state.statsChartsTab === "labor" ? renderStatsLaborFiltersHtml() : "";
  const ownershipFiltersRow = state.statsChartsTab === "ownership" ? renderStatsOwnershipFiltersHtml() : "";
  const laborGrid =
    state.statsChartsTab === "labor"
      ? `${renderStatsLaborZoomModalHtml()}<div class="stats-labor-sections">${renderStatsLaborSectionCardsHtml()}</div>`
      : "";
  const ownershipGrid =
    state.statsChartsTab === "ownership"
      ? `${renderStatsOwnershipZoomModalHtml()}<div class="stats-labor-sections stats-ownership-sections">${renderStatsOwnershipSectionCardsHtml()}</div>`
      : "";
  const bodyHtml = laborGrid || ownershipGrid || "";
  const filtersRow = laborFiltersRow || ownershipFiltersRow;
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
      openStatsOwnershipTableZoom(kind);
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
      },
      true
    );
  }

  document.querySelectorAll("[data-stats-labor-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-stats-labor-zoom");
      if (!key) return;
      requestAnimationFrame(() => openStatsLaborChartZoom(key));
    });
  });
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

  ensureStatsChartZoomMasksOnBody();
  if (state.statsChartsTab === "ownership") {
    requestAnimationFrame(() => {
      mountStatsOwnershipCharts();
    });
  }
}
