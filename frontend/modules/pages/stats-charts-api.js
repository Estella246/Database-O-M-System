import { state } from "../state/state.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";

export function statsChartsLaborQueryKey() {
  return [
    state.statsLaborStart,
    state.statsLaborEnd,
    state.statsLaborProductLine || "",
  ].join("|");
}

export function statsChartsOwnershipQueryKey() {
  return [
    state.statsOwnershipStart,
    state.statsOwnershipEnd,
    state.statsOwnershipPrecision,
    state.statsOwnershipQuality,
    state.statsOwnershipComponent,
  ].join("|");
}

export function statsChartsDoerQueryKey() {
  return [
    state.statsLaborStart,
    state.statsLaborEnd,
    state.statsDoerIncludeOps,
    state.statsDoerIncludeDev,
  ].join("|");
}

function buildStatsChartsUrl(view) {
  const op = getCurrentOperator();
  const qs = new URLSearchParams();
  qs.set("operator_id", op.account);
  qs.set("view", view);
  if (view === "labor" || view === "doer") {
    qs.set("start_date", state.statsLaborStart);
    qs.set("end_date", state.statsLaborEnd);
  } else {
    qs.set("start_date", state.statsOwnershipStart);
    qs.set("end_date", state.statsOwnershipEnd);
  }
  if (view === "labor") {
    const pl = String(state.statsLaborProductLine || "").trim();
    if (pl) qs.set("product_line", pl);
  }
  if (view === "ownership") {
    qs.set("precision", state.statsOwnershipPrecision || "month");
    qs.set("quality", state.statsOwnershipQuality || "all");
    qs.set("component", state.statsOwnershipComponent || "all");
  }
  if (view === "doer") {
    qs.set("include_ops", state.statsDoerIncludeOps !== false ? "true" : "false");
    qs.set("include_dev", state.statsDoerIncludeDev !== false ? "true" : "false");
  }
  return `${API_BASE_URL}/api/stats/charts?${qs.toString()}`;
}

export function invalidateStatsChartsPayload(view) {
  if (view === "labor" || view === "doer") {
    state.statsChartsLoadedKey.labor = "";
    state.statsChartsLoadedKey.doer = "";
    state.statsChartsPayload.labor = null;
    state.statsChartsPayload.doer = null;
    state.statsDoerDataLoadedKey = "";
    state.statsDoerData = null;
    return;
  }
  if (view === "ownership") {
    state.statsChartsLoadedKey.ownership = "";
    state.statsChartsPayload.ownership = null;
    state.statsChartsPayload.ownershipQualityScoped = null;
  }
}

export function statsChartsQueryKeyForTab(tab) {
  const t = String(tab || "").trim();
  if (t === "ownership") return statsChartsOwnershipQueryKey();
  if (t === "doer") return statsChartsDoerQueryKey();
  return statsChartsLaborQueryKey();
}

export function statsChartsHasDateRange(view) {
  const v = String(view || "").trim();
  if (v === "ownership") {
    return Boolean(state.statsOwnershipStart && state.statsOwnershipEnd);
  }
  return Boolean(state.statsLaborStart && state.statsLaborEnd);
}

export function statsChartsNeedsFetch(view) {
  const v = String(view || "").trim();
  if (!v) return false;
  return state.statsChartsLoadedKey?.[v] !== statsChartsQueryKeyForTab(v);
}

/** 已有时间范围且尚未完成当前 query 的拉取（含首屏 bind 前） */
export function statsChartsShowLoading(view) {
  const v = String(view || "").trim();
  if (!v) return false;
  if (state.statsChartsLoading?.[v]) return true;
  return statsChartsHasDateRange(v) && statsChartsNeedsFetch(v);
}

export async function loadStatsChartsDataIfNeeded(view) {
  const v = String(view || "").trim();
  if (!v) return;
  const key = statsChartsQueryKeyForTab(v);
  if (!state.statsChartsLoadedKey) {
    state.statsChartsLoadedKey = { labor: "", ownership: "", doer: "" };
  }
  if (!state.statsChartsLoading) {
    state.statsChartsLoading = { labor: false, ownership: false, doer: false };
  }
  if (!state.statsChartsPayload) {
    state.statsChartsPayload = { labor: null, ownership: null, ownershipQualityScoped: null, doer: null };
  }
  if (state.statsChartsLoadedKey[v] === key) {
    if (v === "doer" && !state.statsDoerData && state.statsChartsPayload.doer) {
      state.statsDoerData = mapDoerPayloadToLegacy(state.statsChartsPayload.doer);
      state.statsDoerDataLoadedKey = key;
      state.statsDoerDataLoaded = true;
    }
    return;
  }
  if (state.statsChartsLoading[v]) return;
  state.statsChartsLoading[v] = true;
  if (v === "doer") {
    state.statsDoerDataLoading = true;
    state.statsDoerDataLoaded = false;
  }
  requestRender();
  try {
    const resp = await fetch(buildStatsChartsUrl(v));
    if (!resp.ok) throw new Error(String(resp.status));
    const json = await resp.json();
    state.statsChartsPayload[v] = json.payload || null;
    if (v === "ownership") {
      state.statsChartsPayload.ownershipQualityScoped = json.quality_scoped || null;
    }
    state.statsChartsTicketCount[v] = Number(json.ticket_count) || 0;
    state.statsChartsLoadedKey[v] = key;
    if (v === "doer") {
      state.statsDoerData = mapDoerPayloadToLegacy(json.payload);
      state.statsDoerDataLoadedKey = key;
      state.statsDoerDataLoaded = true;
    }
  } catch (err) {
    console.error(`[统计图表] 加载 ${v} 失败:`, err);
    state.statsChartsPayload[v] = null;
    if (v === "ownership") {
      state.statsChartsPayload.ownershipQualityScoped = null;
    }
    state.statsChartsLoadedKey[v] = key;
    if (v === "doer") {
      state.statsDoerData = null;
      state.statsDoerDataLoaded = false;
      state.statsDoerDataLoadedKey = key;
    }
  } finally {
    state.statsChartsLoading[v] = false;
    if (v === "doer") state.statsDoerDataLoading = false;
    requestRender();
    if (v === "ownership" && state.statsChartsPayload.ownership) {
      requestAnimationFrame(() => {
        import("./stats-page.js").then((m) => {
          if (state.activeKey === "stats:charts" && state.statsChartsTab === "ownership") {
            m.mountStatsOwnershipCharts();
          }
        });
      });
    }
  }
}

/** 将服务端 Doer payload 映射为现有渲染函数期望的结构 */
export function mapDoerPayloadToLegacy(payload) {
  if (!payload || typeof payload !== "object") return null;
  const mc = payload.monthlyConsult || {};
  const mcBars = mc.barValues || [];
  const mcTotalConsult = mcBars.reduce((a, b) => a + b, 0);
  const mcTotalTickets = (mc.lineValues || []).length
    ? mcBars.reduce((sum, c, i) => {
        const pct = mc.lineValues[i] || 0;
        return sum + (pct > 0 ? Math.round(c / (pct / 100)) : 0);
      }, 0)
    : mcTotalConsult;
  const de = payload.dailyDoerEffectiveness || {};
  const deBars = de.barValues || [];
  const deLines = de.lineValues || [];
  const totalEffective = deBars.reduce((a, b) => a + b, 0);
  const totalUsedDoer = deLines.length
    ? deBars.reduce((sum, eff, i) => {
        const rate = deLines[i] || 0;
        return sum + (rate > 0 ? Math.round(eff / (rate / 100)) : 0);
      }, 0)
    : totalEffective;
  return {
    total: payload.total,
    doerResolved: payload.doerResolved,
    doerHelped: payload.doerHelped,
    doerNoHelp: payload.doerNoHelp,
    noDoer: payload.noDoer,
    urgentHard: payload.urgentHard,
    notFilled: payload.notFilled,
    unknown: payload.unknown,
    usedDoer: payload.usedDoer,
    effective: payload.effective,
    filledTotal: payload.filledTotal,
    includeOps: payload.includeOps,
    includeDev: payload.includeDev,
    usageSlices: payload.usageSlices || [],
    effectivenessSlices: payload.effectivenessSlices || [],
    consultEfficiency: payload.consultEfficiency,
    nonConsultEfficiency: payload.nonConsultEfficiency,
    dailyClosed: payload.dailyClosed,
    dailyDoerUsage: payload.dailyDoerUsage,
    dailyConsult: payload.dailyConsult,
    monthlyConsult: {
      ...mc,
      totalConsult: mcTotalConsult,
      totalTickets: mcTotalTickets || mcTotalConsult,
      avgPct: mcTotalTickets > 0 ? Math.round((mcTotalConsult / mcTotalTickets) * 100) : 0,
    },
    dailyDoerEffectiveness: {
      ...de,
      totalUsedDoer: totalUsedDoer || totalEffective,
      totalEffective,
      avgPct: de.avgRate ?? (totalUsedDoer > 0 ? Math.round((totalEffective / totalUsedDoer) * 100) : 0),
    },
  };
}

export const STATS_DAILY_BACKFILL_BATCH_SIZE = 50;

export async function postStatsDailyBackfillBatch(body) {
  const resp = await fetch(`${API_BASE_URL}/api/stats/charts/backfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await parseApiError(resp));
  }
  return resp.json();
}

export function invalidateAllStatsChartsPayloads() {
  invalidateStatsChartsPayload("labor");
  invalidateStatsChartsPayload("ownership");
  invalidateStatsChartsPayload("doer");
}

/** 分批回填统计日汇总；onProgress / onLog 供 UI 同步进度与日志 */
export async function runStatsDailyBackfill({ onProgress, onLog } = {}) {
  const op = getCurrentOperator();
  let afterTicketId = 0;
  let reset = true;
  let total = 0;
  let done = 0;

  console.info("[stats-daily-backfill] start", { batchSize: STATS_DAILY_BACKFILL_BATCH_SIZE });

  while (true) {
    const json = await postStatsDailyBackfillBatch({
      operator_id: op.account,
      reset,
      after_ticket_id: afterTicketId,
      batch_size: STATS_DAILY_BACKFILL_BATCH_SIZE,
    });
    reset = false;
    total = Number(json.total) || total;
    done = Number(json.done_cumulative) ?? done;
    const logs = Array.isArray(json.logs) ? json.logs : [];
    logs.forEach((line) => {
      const msg = String(line || "").trim();
      if (msg) {
        console.info("[stats-daily-backfill]", msg);
        onLog?.(msg);
      }
    });
    onProgress?.({
      done,
      total,
      processed: Number(json.processed) || 0,
      hasMore: Boolean(json.has_more),
    });
    console.info("[stats-daily-backfill] batch", {
      processed: json.processed,
      done,
      total,
      hasMore: json.has_more,
      nextAfter: json.next_after_ticket_id,
    });
    if (!json.has_more) break;
    afterTicketId = Number(json.next_after_ticket_id) || 0;
    if (!afterTicketId) break;
  }

  invalidateAllStatsChartsPayloads();
  console.info("[stats-daily-backfill] done", { done, total });
  return { done, total };
}
