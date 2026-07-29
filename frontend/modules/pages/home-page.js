import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import {
  operatorMatchesPersonField,
  formatYmdLocal,
  localYmd,
  nowText,
  sortTicketsByCreatedAtDesc,
  startOfLocalDay,
  ticketCreatorMatchesOperator,
  ticketLocalActivityDateKey,
} from "../utils/format.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { syncDutyRosterExtrasFromServer } from "./duty.js";
import { MS_PER_DAY } from "../constants/theme.js";
import { startOfWeekSunday, heatmapIntensityLevel, formatZhMonthFromYmd, formatZhLongDateFromYmd, parseYmdToDate } from "../utils/date.js";
import {
  STAT_LABOR_CHART_COLORS,
  buildStatsLaborEchartBarOption,
  buildStatsLaborEchartPieOption,
  statOwnershipAxisLabel,
  statOwnershipSplitLineStyle,
  statsTicketDayYmd,
  statsNormalizePersonName,
  statsTicketPersonName,
} from "./stats.js";
import { WORKFLOW_NODES } from "../constants/workflow.js";
import { statsTicketsInRange } from "./stats-page.js";
import { renderDateRangeHtml, shouldSkipDateRangePresetFill } from "../ui/date-range-picker-bind.js";
import { ensureAdminData } from "./admin-page.js";
import { getAllTickets, homeWorkbenchTabUsesMergedTicketBase, filterTicketsByHomeWorkbenchTab } from "./ticket-core.js";
import { heatmapPadCellStyle, heatmapDataCellStyle, HEATMAP_CELL_PX, HEATMAP_COL_PX, HEATMAP_GAP_PX, normalizeHomePersonalQualityScope } from "./home.js";
import { fetchLeaveList, leaveApplicantDefaultDisplay } from "./leave-page.js";

export function resetLeaveCreateForm() {
  state.leaveDraftSegKey = 1;
  state.leaveCreateSegments = [{ key: state.leaveDraftSegKey++, start: "", end: "", reason: "" }];
  state.leaveCreateType = "";
  state.leaveCreateApplicant = leaveApplicantDefaultDisplay();
  state.leaveCreateApplicantAccount = String(getCurrentOperator().account || "").trim();
  state.leaveCreateApprover = "";
  state.leaveCreateCc = "";
  state.leaveCreateSubmitting = false;
}

export async function fetchHomeLeavePendingList() {
  const op = getCurrentOperator();
  state.homeLeavePendingLoading = true;
  requestRender();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/leave/applications?operator_id=${encodeURIComponent(op.account)}&scope=${encodeURIComponent("pending_approval")}&q=`
    );
    if (!r.ok) {
      state.homeLeavePendingItems = [];
      return;
    }
    const j = await r.json();
    state.homeLeavePendingItems = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.homeLeavePendingItems = [];
  } finally {
    state.homeLeavePendingLoading = false;
    requestRender();
  }
}

export function homePersonalWorkloadLabelsValues() {
  ensureHomePersonalRangeInit();
  const a = new Date(`${state.homePersonalStart}T12:00:00`);
  const b = new Date(`${state.homePersonalEnd}T12:00:00`);
  const t0 = a.getTime();
  const t1 = b.getTime();
  const maxPts = 12;
  const labels = [];
  const values = new Array(maxPts).fill(0);
  for (let i = 0; i < maxPts; i += 1) {
    const t = t0 + (i / Math.max(maxPts - 1, 1)) * (t1 - t0);
    const d = new Date(t);
    labels.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`);
  }
  return { labels, values };
}

export function homePersonalWorkloadFromLaborInput() {
  ensureHomePersonalRangeInit();
  const base = homePersonalWorkloadLabelsValues();
  const op = getCurrentOperator();
  const normalizedName = statsNormalizePersonName(op.userName || "");
  const start = parseYmdToDate(state.homePersonalStart);
  const end = parseYmdToDate(state.homePersonalEnd);
  if (!start || !end) return base;
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) return base;

  // 与“统计图表-人力投入统计”同口径：按人员名统计，主页只取当前登录人。
  const rows = statsTicketsInRange(state.homePersonalStart, state.homePersonalEnd);
  const myRows = rows.filter((t) => {
    const person = statsTicketPersonName(t);
    if (normalizedName && person === normalizedName) return true;
    const raw = String(t?.currentHandler || t?.assignee || t?.creatorName || "").trim();
    return operatorMatchesPersonField(raw, op);
  });
  const values = new Array(base.labels.length).fill(0);
  if (!myRows.length) return { labels: base.labels, values };

  const span = Math.max(endMs - startMs, 0);
  myRows.forEach((t) => {
    const ymd = statsTicketDayYmd(t);
    const day = parseYmdToDate(ymd);
    if (!day) return;
    const ms = day.getTime();
    if (ms < startMs || ms > endMs) return;
    const rawIdx = span > 0 ? Math.floor(((ms - startMs) / span) * base.labels.length) : 0;
    const idx = Math.min(base.labels.length - 1, Math.max(0, rawIdx));
    values[idx] += 1;
  });
  return { labels: base.labels, values };
}

export function homePersonalQueryKey() {
  ensureHomePersonalRangeInit();
  const op = getCurrentOperator();
  return `${op.account}|${state.homePersonalStart}|${state.homePersonalEnd}|${normalizeHomePersonalQualityScope(state.homePersonalPassthroughQuality || "all")}`;
}

/** 工单流转提交后失效个人统计缓存，回到主页时会重新拉 /api/home/personal-stats。 */
export function invalidateHomePersonalStats() {
  state.homePersonalStatsLoadedKey = "";
  state.homePersonalStats = null;
}

export function getHomePersonalStatsOrFallback() {
  const fallback = homePersonalWorkloadLabelsValues();
  const stats = state.homePersonalStats || {};
  const workload = stats.workload || {};
  const sla = stats.sla || {};
  const passthrough = stats.passthrough || {};
  const hasApiWorkload =
    Array.isArray(workload.labels) &&
    workload.labels.length &&
    Array.isArray(workload.values) &&
    workload.values.length === workload.labels.length;
  const laborWorkload = hasApiWorkload ? null : homePersonalWorkloadFromLaborInput();
  const labels = hasApiWorkload
    ? workload.labels
    : Array.isArray(laborWorkload?.labels) && laborWorkload.labels.length
      ? laborWorkload.labels
      : fallback.labels;
  const values = hasApiWorkload
    ? workload.values
    : Array.isArray(laborWorkload?.values) && laborWorkload.values.length === labels.length
      ? laborWorkload.values
      : fallback.values;
  const stages =
    Array.isArray(sla.stages) && sla.stages.length
      ? sla.stages
      : WORKFLOW_NODES.filter((s) => s !== "问题填写");
  const stageValues = Array.isArray(sla.values) && sla.values.length === stages.length ? sla.values : stages.map(() => 0);
  return {
    workload: { labels, values },
    sla: { stages, values: stageValues },
    passthrough: {
      independent: Number(passthrough.independent_closure_count || 0),
      commando: Number(passthrough.commando_count || 0),
    },
  };
}

export async function fetchHomePersonalStats() {
  ensureHomePersonalRangeInit();
  const op = getCurrentOperator();
  const key = homePersonalQueryKey();
  state.homePersonalStatsLoadedKey = key;
  state.homePersonalStatsLoading = true;
  try {
    const qualityScope = normalizeHomePersonalQualityScope(state.homePersonalPassthroughQuality || "all");
    const q = new URLSearchParams({
      operator_id: op.account,
      start_date: state.homePersonalStart,
      end_date: state.homePersonalEnd,
      quality_scope: qualityScope,
    });
    const r = await fetch(`${API_BASE_URL}/api/home/personal-stats?${q.toString()}`);
    if (!r.ok) {
      state.homePersonalStats = null;
      return;
    }
    const j = await r.json();
    state.homePersonalStats = j && typeof j === "object" ? j : null;
  } catch (_) {
    // 后端不可用时回退为零值占位，保持页面可渲染
    state.homePersonalStats = null;
  } finally {
    state.homePersonalStatsLoading = false;
    if (!patchHomePersonalStatsDom()) requestRender();
  }
}

export function renderHomePersonalPassthroughQualityToggle() {
  const v = state.homePersonalPassthroughQuality || "all";
  const order = ["all", "quality", "nonQuality"];
  const labels = { all: "全部", quality: "质量", nonQuality: "非质量" };
  const segIdx = Math.max(0, order.indexOf(v));
  const btns = order
    .map((id) => {
      const active = v === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-home-personal-field="passthroughQuality" data-home-personal-value="${escapeAttr(id)}">${escapeHtml(labels[id])}</button>`;
    })
    .join("");
  return `<div class="home-personal-passthrough-seg-wrap">
    <div class="stats-labor-preset-seg home-personal-passthrough-seg" role="tablist" aria-label="问题类型" style="--seg-i:${segIdx}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${btns}</div>
    </div>
  </div>`;
}

export function renderHomePersonalFiltersHtml() {
  ensureHomePersonalRangeInit();
  const presetOrder = ["1d", "1w", "1m", "6m", "1y"];
  const presetLabels = { "1d": "近一天", "1w": "近一周", "1m": "近一月", "6m": "近半年", "1y": "近一年" };
  const segIdx = presetOrder.indexOf(state.homePersonalPreset);
  const hasPreset = segIdx >= 0;
  const segI = hasPreset ? segIdx : 0;
  const customCls = hasPreset ? "" : " stats-labor-preset-seg--custom";
  const presetBtns = presetOrder
    .map((id) => {
      const active = state.homePersonalPreset === id;
      return `<button type="button" class="stats-labor-preset-seg-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-home-personal-preset="${escapeAttr(id)}">${escapeHtml(
        presetLabels[id] || id
      )}</button>`;
    })
    .join("");
  const presetSeg = `<div class="stats-labor-preset-seg${customCls}" role="tablist" aria-label="快捷时间范围" style="--seg-i:${segI}">
      <span class="stats-labor-preset-seg-slider" aria-hidden="true"></span>
      <div class="stats-labor-preset-seg-inner">${presetBtns}</div>
    </div>`;
  return `
    <div class="stats-labor-filters home-personal-filters" aria-label="个人数据筛选">
      <div class="stats-labor-top-row">
        <div class="stats-labor-preset-seg-wrap">${presetSeg}</div>
        <div class="stats-labor-date-range-wrap">
          ${renderDateRangeHtml({
            id: "home-personal",
            startYmd: state.homePersonalStart,
            endYmd: state.homePersonalEnd,
          })}
        </div>
      </div>
    </div>
  `;
}

const HOME_PERSONAL_ECHART_IDS = {
  passthrough: "home-personal-echart-passthrough",
  workload: "home-personal-echart-workload",
  sla: "home-personal-echart-sla",
};

let homePersonalChartInstances = {};
let homePersonalResizeBound = false;
let homePersonalMountGen = 0;

const HOME_PERSONAL_ECHART_TOOLTIP = {
  trigger: "axis",
  backgroundColor: "rgba(255, 252, 244, 0.94)",
  borderColor: "rgba(220, 212, 198, 0.9)",
  textStyle: { color: "#4a453d", fontSize: 12 },
};

function homePersonalEchartsFallbackHtml() {
  if (typeof window !== "undefined" && typeof window.echarts === "undefined") {
    return `<p class="stat-echart-fallback">图表库加载失败，请检查网络后刷新。</p>`;
  }
  return "";
}

function wrapHomePersonalPlotSlot(plotHtml) {
  return `<div class="stats-chart-plot-slot"><div class="stats-chart-plot-slot-inner">${plotHtml}</div></div>`;
}

function buildHomePersonalLineOption(labels, values) {
  const labs = Array.isArray(labels) && labels.length ? labels.map((x) => String(x ?? "")) : ["—"];
  const rawVals = Array.isArray(values) ? values : [];
  const vals = labs.map((_, i) => {
    const n = Number(rawVals[i]);
    return Number.isFinite(n) ? n : 0;
  });
  const stroke = "#ea580c";
  return {
    animation: true,
    animationDuration: 980,
    animationEasing: "cubicOut",
    tooltip: HOME_PERSONAL_ECHART_TOOLTIP,
    grid: { left: 40, right: 12, top: 28, bottom: 32, containLabel: false },
    xAxis: {
      type: "category",
      data: labs,
      boundaryGap: false,
      axisLabel: { ...statOwnershipAxisLabel(), interval: "auto", hideOverlap: true },
    },
    yAxis: {
      type: "value",
      name: "单位：件",
      nameTextStyle: { fontSize: 11, color: "#5c574f" },
      minInterval: 1,
      splitLine: statOwnershipSplitLineStyle(),
      axisLabel: statOwnershipAxisLabel(),
    },
    series: [
      {
        type: "line",
        smooth: 0.28,
        symbol: "circle",
        symbolSize: 6,
        data: vals,
        lineStyle: { width: 2.5, color: stroke },
        itemStyle: { color: stroke },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(234, 88, 12, 0.32)" },
              { offset: 1, color: "rgba(234, 88, 12, 0.02)" },
            ],
          },
        },
      },
    ],
  };
}

function buildHomePersonalChartOptions() {
  const data = getHomePersonalStatsOrFallback();
  const wl = data.workload || { labels: [], values: [] };
  const slaStages = Array.isArray(data.sla?.stages) ? data.sla.stages : [];
  const slaVals = (Array.isArray(data.sla?.values) ? data.sla.values : []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  const pieSlices = [
    { label: "流转独立闭环", value: Math.max(0, Number(data.passthrough?.independent) || 0) },
    { label: "流转至责任田", value: Math.max(0, Number(data.passthrough?.commando) || 0) },
  ];
  const pieOpt = buildStatsLaborEchartPieOption(pieSlices);
  if (pieOpt?.series?.[0]) {
    pieOpt.series[0].radius = ["32%", "54%"];
    pieOpt.series[0].center = ["50%", "42%"];
  }
  if (pieOpt?.legend) {
    pieOpt.legend.textStyle = { ...(pieOpt.legend.textStyle || {}), fontSize: 10 };
  }
  const barLabels = slaStages.length ? slaStages : ["—"];
  const barValues = slaVals.length === barLabels.length ? slaVals : barLabels.map(() => 0);
  const barOpt = buildStatsLaborEchartBarOption(barLabels, barValues, {
    colors: barLabels.map((_, i) => STAT_LABOR_CHART_COLORS[(i + 3) % STAT_LABOR_CHART_COLORS.length]),
    yUnit: "小时",
  });
  if (barOpt?.grid) {
    barOpt.grid = {
      ...barOpt.grid,
      left: 44,
      right: 12,
      top: 32,
      bottom: barOpt.grid.bottom > 48 ? 48 : barOpt.grid.bottom,
    };
  }
  return {
    passthrough: pieOpt,
    workload: buildHomePersonalLineOption(wl.labels, wl.values),
    sla: barOpt,
  };
}

export function disposeHomePersonalCharts() {
  homePersonalMountGen += 1;
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) {
    homePersonalChartInstances = {};
    return;
  }
  Object.keys(homePersonalChartInstances).forEach((k) => {
    try {
      homePersonalChartInstances[k].dispose();
    } catch (_) {
      // ignore
    }
  });
  homePersonalChartInstances = {};
}

export function mountHomePersonalCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E || state.activeKey !== "home") return;
  // 拉取中且尚无可用接口数据时，等 fetch 结束后的 patch 再挂，避免空数据盖住正确结果
  if (state.homePersonalStatsLoading && !state.homePersonalStats) return;

  const gen = ++homePersonalMountGen;
  Object.keys(homePersonalChartInstances).forEach((k) => {
    try {
      homePersonalChartInstances[k].dispose();
    } catch (_) {
      // ignore
    }
  });
  homePersonalChartInstances = {};

  const paint = (attempt = 0) => {
    if (state.activeKey !== "home" || gen !== homePersonalMountGen) return;
    const opts = buildHomePersonalChartOptions();
    let needsRetry = false;
    Object.keys(HOME_PERSONAL_ECHART_IDS).forEach((key) => {
      const el = document.getElementById(HOME_PERSONAL_ECHART_IDS[key]);
      if (!el || !opts[key]) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if ((w < 2 || h < 2) && attempt < 10) {
        needsRetry = true;
        return;
      }
      let chart = homePersonalChartInstances[key];
      if (!chart || chart.isDisposed?.()) {
        chart = E.getInstanceByDom(el) || E.init(el, null, { renderer: "canvas" });
        homePersonalChartInstances[key] = chart;
      }
      try {
        chart.resize();
      } catch (_) {
        // ignore
      }
      chart.setOption(opts[key], { notMerge: true });
    });
    if (needsRetry) requestAnimationFrame(() => paint(attempt + 1));
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => paint(0));
  });
  if (!homePersonalResizeBound) {
    homePersonalResizeBound = true;
    window.addEventListener(
      "resize",
      () => {
        if (state.activeKey !== "home") return;
        Object.values(homePersonalChartInstances).forEach((c) => {
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

export function renderHomePersonalGlassCard(title, toolbarHtml, plotHtml, delayIdx, plotBelowHtml = "", cardMod = "") {
  const d = (delayIdx * 0.05).toFixed(2);
  const mod = String(cardMod || "").trim();
  const cardClass = mod
    ? `stat-glass-card home-personal-glass-card ${mod}`
    : "stat-glass-card home-personal-glass-card";
  const chartInner = `<div class="stat-glass-card-chart stat-chart-enter">
    ${wrapHomePersonalPlotSlot(plotHtml)}
    ${plotBelowHtml || ""}
  </div>`;
  return `<article class="${cardClass}" style="--stat-card-delay:${d}s">
    <div class="stat-glass-card-head">
      <h3 class="stat-glass-card-title">${escapeHtml(title)}</h3>
      <div class="stat-glass-card-toolbar">${toolbarHtml || ""}</div>
    </div>
    ${chartInner}
  </article>`;
}

export function buildHomePersonalStatsCardsHtml() {
  ensureHomePersonalRangeInit();
  const fb = homePersonalEchartsFallbackHtml();
  const host = (id) => `<div class="stat-echart-host home-personal-echart-host" id="${escapeAttr(id)}"></div>${fb}`;
  const slaNote = `<p class="stat-chart-unit-hint">纵轴：各阶段在本时段内本人平均滞留时长，单位：小时</p>`;

  return [
    renderHomePersonalGlassCard(
      "透传率",
      renderHomePersonalPassthroughQualityToggle(),
      host(HOME_PERSONAL_ECHART_IDS.passthrough),
      0,
      "",
      "home-personal-card--passthrough"
    ),
    renderHomePersonalGlassCard(
      "工作量统计",
      "",
      host(HOME_PERSONAL_ECHART_IDS.workload),
      1,
      "",
      "home-personal-card--workload"
    ),
    renderHomePersonalGlassCard(
      "SLA统计",
      "",
      host(HOME_PERSONAL_ECHART_IDS.sla),
      2,
      slaNote,
      "home-personal-card--sla"
    ),
  ].join("");
}

export function renderHomePersonalSectionHtml() {
  return `
    <section class="home-personal-section" aria-label="个人数据">
      <div class="section-title home-personal-title">个人数据</div>
      ${renderHomePersonalFiltersHtml()}
      <div class="stats-labor-sections home-personal-grid">${buildHomePersonalStatsCardsHtml()}</div>
    </section>
  `;
}

/** 个人统计就绪后仅更新图表区，避免进入主页时第二次整页 render。 */
export function patchHomePersonalStatsDom() {
  if (state.activeKey !== "home") return false;
  const grid = document.querySelector(".home-personal-section .home-personal-grid");
  if (!grid) return false;
  disposeHomePersonalCharts();
  grid.innerHTML = buildHomePersonalStatsCardsHtml();
  mountHomePersonalCharts();
  return true;
}

export async function runLeaveBatchActions(ids, action, comment) {
  const op = getCurrentOperator();
  const errors = [];
  for (const id of ids) {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/leave/applications/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account, action, comment: comment || "" }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        errors.push(`#${id}: ${resp.status} ${tx.slice(0, 120)}`);
      }
    } catch (e) {
      errors.push(`#${id}: ${String(e.message || e)}`);
    }
  }
  if (errors.length) {
    window.alert(`部分失败（${errors.length}/${ids.length}）：\n${errors.slice(0, 8).join("\n")}${errors.length > 8 ? "\n…" : ""}`);
  }
  state.leaveBatchSelectedIds = [];
  await fetchLeaveList();
  if (action === "agree" && errors.length < ids.length) {
    await syncDutyRosterExtrasFromServer();
    requestRender();
  }
}

export async function fetchLeaveDetail(id) {
  const op = getCurrentOperator();
  state.leaveDetailLoading = true;
  state.leaveDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/leave/applications/${id}?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.leaveDetailBundle = null;
      return;
    }
    state.leaveDetailBundle = await r.json();
  } catch (_) {
    state.leaveDetailBundle = null;
  } finally {
    state.leaveDetailLoading = false;
    requestRender();
  }
}

export function buildMyDailyOrderCounts(operator) {
  const fromApi = state.homeOrderHeatmapCounts;
  if (fromApi && typeof fromApi === "object" && !Array.isArray(fromApi)) {
    return new Map(Object.entries(fromApi).map(([k, v]) => [k, Number(v) || 0]));
  }
  const map = new Map();
  getAllTickets().forEach((t) => {
    if (!ticketCreatorMatchesOperator(t, operator)) return;
    const key = ticketLocalActivityDateKey(t);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

export function buildMyHomeHeatmapModel(operator) {
  const end = startOfLocalDay(new Date());
  const start = new Date(end.getTime() - 364 * MS_PER_DAY);
  const startSunday = startOfWeekSunday(start);
  const totalDays = Math.floor((end - startSunday) / MS_PER_DAY) + 1;
  const numWeeks = Math.min(53, Math.max(1, Math.ceil(totalDays / 7)));

  const counts = buildMyDailyOrderCounts(operator);
  let maxInRange = 0;
  let totalOrders = 0;
  const monthTotals = new Map();
  let bestDayKey = "";
  let bestDayCount = 0;

  for (let w = 0; w < numWeeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const dt = new Date(startSunday);
      dt.setDate(startSunday.getDate() + w * 7 + dow);
      if (dt < start || dt > end) continue;
      const key = localYmd(dt);
      const c = counts.get(key) || 0;
      totalOrders += c;
      if (c > maxInRange) maxInRange = c;
      if (c > 0) {
        const mk = key.slice(0, 7);
        monthTotals.set(mk, (monthTotals.get(mk) || 0) + c);
      }
      if (c > bestDayCount) {
        bestDayCount = c;
        bestDayKey = key;
      } else if (c > 0 && c === bestDayCount && key.localeCompare(bestDayKey) > 0) {
        bestDayKey = key;
      }
    }
  }

  let bestMonthKey = "";
  let bestMonthTotal = -1;
  monthTotals.forEach((v, mk) => {
    if (v > bestMonthTotal) {
      bestMonthTotal = v;
      bestMonthKey = mk;
    }
  });

  const weeks = [];
  const monthLabelForWeek = [];
  for (let w = 0; w < numWeeks; w++) {
    const column = [];
    for (let dow = 0; dow < 7; dow++) {
      const dt = new Date(startSunday);
      dt.setDate(startSunday.getDate() + w * 7 + dow);
      if (dt < start || dt > end) column.push({ kind: "pad" });
      else {
        const key = localYmd(dt);
        const c = counts.get(key) || 0;
        column.push({
          kind: "day",
          date: dt,
          key,
          count: c,
          level: heatmapIntensityLevel(c, maxInRange),
        });
      }
    }
    weeks.push(column);
    const monthStartCell = column.find((cell) => cell.kind === "day" && cell.date.getDate() === 1);
    let label = "";
    if (monthStartCell) {
      label = new Intl.DateTimeFormat("zh-CN", { month: "numeric" }).format(monthStartCell.date);
    } else if (w === 0) {
      const firstDay = column.find((c) => c.kind === "day");
      if (firstDay) {
        label = new Intl.DateTimeFormat("zh-CN", { month: "numeric" }).format(firstDay.date);
      }
    }
    monthLabelForWeek.push(label);
  }

  const bestMonthLabel =
    bestMonthKey && bestMonthTotal > 0 ? formatZhMonthFromYmd(`${bestMonthKey}-01`) : "—";
  const bestDayLabel =
    bestDayKey && bestDayCount > 0 ? formatZhLongDateFromYmd(bestDayKey) : "—";

  return {
    weeks,
    monthLabelForWeek,
    totalOrders,
    bestMonthLabel,
    bestDayLabel,
  };
}

export function renderMyHomeHeatmapCard(operator) {
  const m = buildMyHomeHeatmapModel(operator);
  const totalDisp = Number(m.totalOrders || 0).toLocaleString("zh-CN");
  const nw = Math.max(1, Number(m.weeks.length) || 1);
  /** 按周列优先（每周一列、每周 7 格）扁平化，配合 grid-auto-flow:column + 7 行 */
  const flatCells = m.weeks
    .map((col) =>
      col
        .map((cell) => {
          if (cell.kind === "pad") {
            return `<span class="order-heatmap-cell order-heatmap-cell--pad" style="${heatmapPadCellStyle()}" aria-hidden="true"></span>`;
          }
          const lv = cell.level;
          return `<span class="order-heatmap-cell order-heatmap-cell--l${lv}" style="${heatmapDataCellStyle(lv)}" data-date="${escapeAttr(cell.key)}" data-count="${cell.count}" tabindex="-1"></span>`;
        })
        .join("")
    )
    .join("");
  const monthRow = m.monthLabelForWeek
    .map(
      (lab) =>
        `<span class="order-heatmap-month" style="display:block;width:100%;font-size:8px;line-height:1.15;color:#7a756c;text-align:center;white-space:nowrap;overflow:visible">${lab ? escapeHtml(lab) : ""}</span>`
    )
    .join("");
  /** 内联 grid：避免部分浏览器不支持 repeat(var(--n), 12px) 导致整段模板作废、子项退化成行内文本连在一起 */
  const monthsGridStyle = `display:grid;grid-template-columns:repeat(${nw},${HEATMAP_COL_PX}px);column-gap:${HEATMAP_GAP_PX}px;width:max-content;max-width:100%`;
  const heatmapGridStyle = `display:grid;grid-template-rows:repeat(7,${HEATMAP_CELL_PX}px);grid-auto-flow:column;grid-auto-columns:${HEATMAP_COL_PX}px;gap:${HEATMAP_GAP_PX}px;width:max-content;max-width:100%;overflow-x:auto;padding-bottom:4px`;
  const matrixStyle = `display:grid;grid-template-columns:18px max-content;column-gap:${HEATMAP_GAP_PX}px;align-items:start;width:max-content;max-width:100%`;
  const dowsStyle = `display:grid;grid-template-rows:repeat(7,${HEATMAP_CELL_PX}px);row-gap:${HEATMAP_GAP_PX}px;width:18px;font-size:10px;color:#7a756c;line-height:12px`;
  const legendStyle = `display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:12px;font-size:11px;color:#7a756c`;
  const statsStyle = `display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:baseline;gap:12px 20px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(230,224,210,0.65);width:100%;box-sizing:border-box;font-size:11px;color:#7a756c`;
  return `
    <div class="order-heatmap-card">
      <div class="order-heatmap-frame duty-roster-card duty-roster-card--calendar">
        <div class="order-heatmap-head">
          <div class="order-heatmap-head-main order-heatmap-caption">总走单：${escapeHtml(totalDisp)}</div>
        </div>
        <div class="order-heatmap-plot-inner">
          <div class="order-heatmap-plot-stack">
            <div class="order-heatmap-months-row" style="display:flex;align-items:flex-end;gap:${HEATMAP_GAP_PX}px;width:max-content;margin-top:12px;margin-bottom:2px" aria-hidden="true">
              <span class="order-heatmap-months-spacer" style="width:18px;flex-shrink:0"></span>
              <div class="order-heatmap-months" style="${monthsGridStyle}">${monthRow}</div>
            </div>
            <div class="order-heatmap-matrix" style="${matrixStyle}">
              <div class="order-heatmap-dows" style="${dowsStyle}" aria-hidden="true">
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px">一</span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px">三</span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px">五</span>
                <span style="display:flex;align-items:center;justify-content:flex-end;height:12px;padding-right:2px"></span>
              </div>
              <div class="order-heatmap-grid" style="${heatmapGridStyle}">${flatCells}</div>
            </div>
            <div class="order-heatmap-legend order-heatmap-legend--centered" style="${legendStyle}" aria-hidden="true">
              <span>更少</span>
              <span class="order-heatmap-cell order-heatmap-cell--l0" style="${heatmapDataCellStyle(0)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l1" style="${heatmapDataCellStyle(1)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l2" style="${heatmapDataCellStyle(2)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l3" style="${heatmapDataCellStyle(3)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span class="order-heatmap-cell order-heatmap-cell--l4" style="${heatmapDataCellStyle(4)};width:11px;height:11px;min-width:11px;min-height:11px"></span>
              <span>更多</span>
            </div>
          </div>
        </div>
        <div class="order-heatmap-stats" style="${statsStyle}">
          <span class="order-heatmap-caption">最活跃月：${escapeHtml(m.bestMonthLabel)}</span>
          <span class="order-heatmap-caption">最活跃天：${escapeHtml(m.bestDayLabel)}</span>
        </div>
      </div>
      <div id="order-heatmap-tooltip" class="order-heatmap-tooltip" hidden role="tooltip">
        <div class="order-heatmap-tooltip-date"></div>
        <div class="order-heatmap-tooltip-metric"></div>
      </div>
    </div>`;
}

/** 走单热力图就绪后仅更新主页热力区块，避免导航后列表就地补丁跳过整页 render 时热力图一直为空。 */
export function patchMyHomeHeatmapDom() {
  if (state.activeKey !== "home") return false;
  const home = document.getElementById("home-page");
  if (!home) return false;
  home.innerHTML = renderMyHomeHeatmapCard(getCurrentOperator());
  bindMyHomeHeatmap();
  return true;
}

export function bindMyHomeHeatmap() {
  const orphanTip = document.body.querySelector("#order-heatmap-tooltip");
  if (orphanTip) orphanTip.remove();

  const home = document.getElementById("home-page");
  const grid = home?.querySelector(".order-heatmap-grid");
  const tip = document.getElementById("order-heatmap-tooltip");
  if (!home || !grid || !tip) return;
  const dateEl = tip.querySelector(".order-heatmap-tooltip-date");
  const metricEl = tip.querySelector(".order-heatmap-tooltip-metric");
  if (!dateEl || !metricEl) return;

  const positionTipNearCell = (cell) => {
    if (tip.parentElement !== document.body) {
      document.body.appendChild(tip);
    }
    const r = cell.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    tip.style.transform = "none";
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.hidden = false;
    tip.style.visibility = "hidden";
    void tip.offsetWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    let top = r.top - th - gap;
    if (top < margin) {
      top = r.bottom + gap;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - tw - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - th - margin);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = "visible";
  };

  const hide = () => {
    tip.hidden = true;
    tip.style.visibility = "";
  };

  grid.addEventListener(
    "mouseover",
    (e) => {
      const cell = e.target && e.target.closest ? e.target.closest(".order-heatmap-cell[data-date]") : null;
      if (!cell || !grid.contains(cell)) {
        hide();
        return;
      }
      const ymd = cell.getAttribute("data-date") || "";
      const count = Number(cell.getAttribute("data-count") || "0");
      dateEl.textContent = formatZhLongDateFromYmd(ymd);
      metricEl.textContent = `走单量：${Number.isFinite(count) ? count : 0}`;
      positionTipNearCell(cell);
    },
    true
  );

  grid.addEventListener(
    "mouseout",
    (e) => {
      const related = e.relatedTarget;
      if (related && related instanceof Node && grid.contains(related)) return;
      hide();
    },
    true
  );

  if (!window.__yunweiHeatmapScrollHide) {
    window.__yunweiHeatmapScrollHide = () => {
      const t = document.getElementById("order-heatmap-tooltip");
      if (t && !t.hidden) {
        t.hidden = true;
        t.style.visibility = "";
      }
    };
    window.addEventListener("scroll", window.__yunweiHeatmapScrollHide, { passive: true, capture: true });
  }
}

export function getWorkbenchListBaseTickets(operator) {
  const whitelist = getCurrentWhitelistSettings();
  const onlyMyCreated = getWhitelistLevel("ticket_list", whitelist) === "editable";
  const base = onlyMyCreated
    ? getAllTickets().filter((t) => ticketCreatorMatchesOperator(t, operator))
    : getAllTickets();
  return base.filter((t) => String(t.templateCode || "") !== "HOTPATCH");
}

/** 补丁管理列表：仅 HOTPATCH 模板，权限口径与工作台列表一致（ticket_list） */
export function getPatchListBaseTickets(operator) {
  const whitelist = getCurrentWhitelistSettings();
  const onlyMyCreated = getWhitelistLevel("ticket_list", whitelist) === "editable";
  const base = onlyMyCreated
    ? getAllTickets().filter((t) => ticketCreatorMatchesOperator(t, operator))
    : getAllTickets();
  return base.filter((t) => String(t.templateCode || "") === "HOTPATCH");
}

/** 我的主页「待办工单」：HCS 工作台数据集 + 补丁管理 HOTPATCH（与补丁页「待处理」同白名单口径） */
export function getHomePendingWorkbenchBaseTickets(operator) {
  const hcs = getWorkbenchListBaseTickets(operator);
  const patch = getPatchListBaseTickets(operator);
  const seen = new Set(hcs.map((t) => t.orderId));
  const merged = [...hcs];
  for (const t of patch) {
    if (!seen.has(t.orderId)) merged.push(t);
  }
  return sortTicketsByCreatedAtDesc(merged);
}

export { homeWorkbenchTabUsesMergedTicketBase, filterTicketsByHomeWorkbenchTab };

export function applyHomePersonalPreset(preset) {
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
  state.homePersonalPreset = preset;
  state.homePersonalStart = formatYmdLocal(start);
  state.homePersonalEnd = formatYmdLocal(end);
}

export function ensureHomePersonalRangeInit() {
  if (
    shouldSkipDateRangePresetFill(state.dateRangePicker, {
      pickerId: "home-personal",
      start: state.homePersonalStart,
      end: state.homePersonalEnd,
      preset: state.homePersonalPreset,
    })
  ) {
    return;
  }
  if (!state.homePersonalStart || !state.homePersonalEnd) {
    applyHomePersonalPreset(state.homePersonalPreset || "1w");
  }
}

// ---- 待闭环改进建议（主页 qi_closure tab）----
export async function fetchHomeQiClosure() {
  const op = getCurrentOperator();
  state.homeQiClosureLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/qi?operator_id=${encodeURIComponent(op.account)}&handler=${encodeURIComponent(op.account)}&status=in_progress&page_size=200`);
    const j = r.ok ? await r.json() : { items: [] };
    state.homeQiClosure = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.homeQiClosure = []; }
  finally { state.homeQiClosureLoading = false; requestRender(); }
}

export function renderHomeQiClosureSection() {
  const items = Array.isArray(state.homeQiClosure) ? state.homeQiClosure : [];
  const loading = state.homeQiClosureLoading;
  const rows = items.map(it => `<tr class="home-qi-row" data-qi-id="${it.id}">
    <td>${escapeHtml(it.qi_no || "")}</td>
    <td>${escapeHtml(it.title || "")}</td>
    <td>${escapeHtml(it.current_stage_cn || it.current_stage || "")}</td>
    <td>${escapeHtml(it.current_handler || "")}</td>
    <td>${it.stagnant_days != null ? it.stagnant_days + " 天" : "--"}</td>
  </tr>`).join("");
  return `<section class="table-wrap home-workbench-table" id="home-list-panel" aria-live="polite">
    <div class="section-title">待处理改进建议（${items.length}）</div>
    <table class="qi-table req-table--full">
      <thead><tr><th>诉求编号</th><th>诉求标题</th><th>当前阶段</th><th>当前处理人</th><th>滞留</th></tr></thead>
      <tbody>${loading ? '<tr><td colspan="5" class="req-empty">加载中…</td></tr>' : (rows || '<tr><td colspan="5" class="req-empty">暂无待处理改进建议</td></tr>')}</tbody>
    </table></section>`;
}

export function bindHomeQiClosure() {
  document.querySelectorAll(".home-qi-row").forEach(tr => {
    tr.addEventListener("click", () => {
      const id = parseInt(tr.getAttribute("data-qi-id") || "-1", 10);
      if (!Number.isFinite(id) || id < 0) return;
      state.qiFlowViewId = id;
      state.qiDetailBundle = null;
      state.qiDetailLoaded = false;
      state.qiFlowStage = "";
      state.activeKey = "qi:manage";
      history.pushState({}, "", `/qi/${id}`);
      requestRender();
    });
  });
}

