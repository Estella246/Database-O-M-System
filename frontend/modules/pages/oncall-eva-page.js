/**
 * oncall 评议可视化页面
 *
 * 信息架构：
 *   1. 顶部工具条：周期、tab、刷新
 *   2. 规则口径条（与 oncall-eva.md 一致的权重提示）
 *   3. 主英雄区：
 *      - 左：所选人员的成绩单（总分大字 + 雷达 + 三仪表盘）
 *      - 右：团队排行堆叠柱（点击切换主角）
 *   4. 团队分布矩阵：SLA × 闭环 散点气泡（每点=人，颜色=工单门槛达成）
 *   5. 加分项贡献堆叠条（按账号 × 类目）
 *   6. 排行明细表 + 红黑事件总览
 *   7. 二级 tab：加分项申报、红黑事件录入
 */

import { state } from "../state/state.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { buildPersonOptionsFromAdminUsers } from "../constants/workflow.js";
import { renderWorkflowFlatSelect } from "./ticket.js";
import { bindWorkflowFlatSelect } from "./ticket-page.js";
import {
  getDefaultEvaPeriod,
  formatEvaPeriodLabel,
  buildPeriodOptions,
  ONCALL_EVA_EXTRA_CATEGORIES,
  ONCALL_EVA_PALETTE,
  describeSlaTier,
  describeClosureTier,
  formatHoursDhM,
  formatNumber,
  categoryLabel,
  categoryPerItemCap,
  slaTierKey,
  SLA_TIER_META,
  closureTierKey,
  CLOSURE_TIER_META,
  personDisplayName,
  ticketAchievementPct,
} from "./oncall-eva.js";

const CHART_IDS = [
  "oncall-eva-chart-rank",
  "oncall-eva-chart-radar",
  "oncall-eva-gauge-sla",
  "oncall-eva-gauge-closure",
  "oncall-eva-gauge-ticket",
  "oncall-eva-chart-matrix",
  "oncall-eva-chart-extra",
];

let chartInstances = {};
let resizeBound = false;
let oncallEvaRefreshInFlight = false;
let suppressOncallEvaFetchRenders = false;

/* ===================== 状态与请求 ===================== */

function ensurePeriod() {
  if (!state.oncallEvaPeriod) state.oncallEvaPeriod = getDefaultEvaPeriod();
  return state.oncallEvaPeriod;
}

// 选定主角：无显式选择时取本组得分最高者（items 已按 total_score 降序）；
// 用户点击排行/矩阵切换后按其选择，找不到则回退到榜首。
export function pickFocusedItem(items, selectedAccount) {
  if (!items || !items.length) return null;
  if (!selectedAccount) return items[0];
  return items.find((x) => x.account === selectedAccount) || items[0];
}

function focusedItem() {
  const data = state.oncallEvaScores;
  return pickFocusedItem(data && data.items, state.oncallEvaSelectedAccount);
}

async function fetchConfig() {
  if (state.oncallEvaConfig) return;
  try {
    const r = await fetch(`${API_BASE_URL}/api/oncall-eva/config`);
    if (r.ok) state.oncallEvaConfig = await r.json();
  } catch (_) { /* ignore */ }
}

async function fetchGroups() {
  if (state.oncallEvaGroups && state.oncallEvaGroups.length) return;
  try {
    const operator = getCurrentOperator();
    const qs = operator.account ? `?operator_id=${encodeURIComponent(operator.account)}` : "";
    const r = await fetch(`${API_BASE_URL}/api/oncall-eva/groups${qs}`);
    if (r.ok) state.oncallEvaGroups = (await r.json()).groups || [];
  } catch (_) { /* ignore */ }
}

async function fetchDepartments() {
  // 部门随组别变化，不缓存：每次按当前组别重新拉取该组内的部门
  try {
    const group = state.oncallEvaGroup || "";
    const operator = getCurrentOperator();
    const params = new URLSearchParams();
    if (group) params.set("group_name", group);
    if (operator.account) params.set("operator_id", operator.account);
    const qs = params.toString();
    const r = await fetch(`${API_BASE_URL}/api/oncall-eva/departments${qs ? `?${qs}` : ""}`);
    if (r.ok) state.oncallEvaDepts = (await r.json()).departments || [];
  } catch (_) { /* ignore */ }
}

function maybeRequestRenderAfterFetch() {
  if (!suppressOncallEvaFetchRenders) requestRender();
}

async function fetchScores() {
  const period = ensurePeriod();
  state.oncallEvaScoresLoading = true;
  maybeRequestRenderAfterFetch();
  try {
    const operator = getCurrentOperator();
    const group = state.oncallEvaGroup || "";
    const deptQs = (state.oncallEvaDeptSel || []).map((d) => `&min_dept=${encodeURIComponent(d)}`).join("");
    const url = `${API_BASE_URL}/api/oncall-eva/scores?year=${period.year}&month=${period.month}&operator_id=${encodeURIComponent(operator.account)}${group ? `&group_name=${encodeURIComponent(group)}` : ""}${deptQs}`;
    const r = await fetch(url);
    state.oncallEvaScores = r.ok ? await r.json() : null;
  } catch (_) {
    state.oncallEvaScores = null;
  } finally {
    state.oncallEvaScoresLoading = false;
    maybeRequestRenderAfterFetch();
  }
}

async function fetchExtras() {
  const period = ensurePeriod();
  state.oncallEvaExtrasLoading = true;
  maybeRequestRenderAfterFetch();
  try {
    const operator = getCurrentOperator();
    const qs = operator.account ? `&operator_id=${encodeURIComponent(operator.account)}` : "";
    const r = await fetch(`${API_BASE_URL}/api/oncall-eva/extras?year=${period.year}&month=${period.month}${qs}`);
    state.oncallEvaExtras = r.ok ? ((await r.json()).items || []) : [];
  } catch (_) {
    state.oncallEvaExtras = [];
  } finally {
    state.oncallEvaExtrasLoading = false;
    maybeRequestRenderAfterFetch();
  }
}

async function fetchEvents() {
  const period = ensurePeriod();
  state.oncallEvaEventsLoading = true;
  maybeRequestRenderAfterFetch();
  try {
    const operator = getCurrentOperator();
    const qs = operator.account ? `&operator_id=${encodeURIComponent(operator.account)}` : "";
    const r = await fetch(`${API_BASE_URL}/api/oncall-eva/events?year=${period.year}&month=${period.month}${qs}`);
    state.oncallEvaEvents = r.ok ? ((await r.json()).items || []) : [];
  } catch (_) {
    state.oncallEvaEvents = [];
  } finally {
    state.oncallEvaEventsLoading = false;
    maybeRequestRenderAfterFetch();
  }
}

export async function refreshOncallEvaPage() {
  if (oncallEvaRefreshInFlight) return;
  oncallEvaRefreshInFlight = true;
  state.oncallEvaNeedsRefresh = false;
  ensurePeriod();
  suppressOncallEvaFetchRenders = true;
  try {
    await Promise.all([fetchConfig(), fetchGroups(), fetchDepartments(), fetchScores(), fetchExtras(), fetchEvents()]);
  } finally {
    suppressOncallEvaFetchRenders = false;
    oncallEvaRefreshInFlight = false;
    requestRender();
  }
}

/* ===================== HTML 渲染 ===================== */

function renderToolbar() {
  const period = ensurePeriod();
  const today = getDefaultEvaPeriod();
  const opts = buildPeriodOptions(today.year, today.month, 24)
    .map((p) => {
      const v = `${p.year}-${p.month}`;
      const sel = p.year === period.year && p.month === period.month ? "selected" : "";
      return `<option value="${v}" ${sel}>${formatEvaPeriodLabel(p)}</option>`;
    })
    .join("");
  const tab = state.oncallEvaTab || "scores";
  const curGroup = state.oncallEvaGroup || "";
  const groupOpts = [`<option value="" ${curGroup === "" ? "selected" : ""}>全部组别</option>`]
    .concat(
      (state.oncallEvaGroups || []).map(
        (g) => `<option value="${escapeAttr(g)}" ${curGroup === g ? "selected" : ""}>${escapeHtml(g)}</option>`,
      ),
    )
    .join("");
  const selDepts = state.oncallEvaDepts || [];
  const selSet = state.oncallEvaDeptSel || [];
  const deptOpen = !!state.oncallEvaDeptOpen;
  const deptSummary = selSet.length === 0
    ? "全部部门"
    : selSet.length === 1
      ? selSet[0]
      : `已选 ${selSet.length} 个部门`;
  const deptAllChecked = selSet.length === 0;
  const deptOptionsHtml = selDepts.length
    ? selDepts
        .map(
          (d) => `<label class="filter-opt"><input type="checkbox" data-eva-dept-value="${escapeAttr(d)}" ${selSet.includes(d) ? "checked" : ""}/> ${escapeHtml(d)}</label>`,
        )
        .join("")
    : `<div class="filter-empty">无可选部门</div>`;
  const deptPopHtml = deptOpen
    ? `<div class="filter-pop oeva-dept-pop">
          <label class="filter-opt filter-checkall"><input type="checkbox" id="oeva-dept-all" ${deptAllChecked ? "checked" : ""}/> （全部部门）</label>
          <div class="filter-pop-list">${deptOptionsHtml}</div>
          <div class="filter-pop-actions">
            <button type="button" class="action" id="oeva-dept-reset">重置</button>
            <button type="button" class="action primary" id="oeva-dept-done">完成</button>
          </div>
        </div>`
    : "";
  return `
    <div class="oeva-toolbar">
      <label class="oeva-period">
        <span>评议周期</span>
        <select id="oeva-period">${opts}</select>
      </label>
      <label class="oeva-period">
        <span>组别</span>
        <select id="oeva-group">${groupOpts}</select>
      </label>
      <label class="oeva-period">
        <span>部门</span>
        <span class="oeva-dept-box">
          <button type="button" id="oeva-dept-toggle" class="oeva-dept-toggle ${selSet.length ? "active" : ""}">${escapeHtml(deptSummary)} ⏷</button>
          ${deptPopHtml}
        </span>
      </label>
      <div class="oeva-tabs" role="tablist">
        <button type="button" class="oeva-tab ${tab === "scores" ? "active" : ""}" data-eva-tab="scores">综合视图</button>
        <button type="button" class="oeva-tab ${tab === "extras" ? "active" : ""}" data-eva-tab="extras">加分项申报</button>
        <button type="button" class="oeva-tab ${tab === "events" ? "active" : ""}" data-eva-tab="events">红黑事件</button>
      </div>
      <button type="button" class="action" id="oeva-refresh">刷新</button>
    </div>`;
}

function renderRulesBar() {
  return `
    <div class="oeva-rules">
      <span class="oeva-rules-title">关键指标</span>
      <span class="oeva-rule oeva-rule--sla"><b>SLA · 35%</b> ≤24h→100 / ≤48h→80 / ≤72h→60 / >72h→30</span>
      <span class="oeva-rule oeva-rule--closure"><b>独立闭环 · 30%</b> ≥90%→100 / 70~90% 线性 / <70%→60</span>
      <span class="oeva-rule oeva-rule--ticket"><b>工单量 · 20</b> 门槛=人均×0.8，达成即满分</span>
      <span class="oeva-rule oeva-rule--extra"><b>加分项 · ≤15</b> 单项独立上限，优秀直接拉满</span>
      <span class="oeva-rule oeva-rule--event"><b>红/黑事件</b> 不计权重，单次 ≤5</span>
    </div>`;
}

function renderHeroLeft() {
  const item = focusedItem();
  const data = state.oncallEvaScores;
  if (!item) {
    return `
      <div class="oeva-hero-left">
        <div class="oeva-empty">${state.oncallEvaScoresLoading ? "加载中…" : "暂无评议数据"}</div>
      </div>`;
  }
  const operator = getCurrentOperator();
  const isMine = item.account === operator.account;
  const items = data.items || [];
  const rank = items.findIndex((x) => x.account === item.account) + 1;
  const m = item.metrics || {};
  return `
    <section class="oeva-hero-left" aria-label="个人成绩单">
      <div class="oeva-hero-head">
        <div class="oeva-hero-name">
          <span class="oeva-hero-badge ${isMine ? "is-mine" : ""}">${isMine ? "我的成绩" : "团队成员"}</span>
          <h2>${escapeHtml(personDisplayName(item))}</h2>
          <span class="oeva-hero-rank">排名 #${rank} / ${items.length}</span>
        </div>
        <div class="oeva-hero-total">
          <span class="oeva-hero-total-num">${formatNumber(item.total_score, 1)}</span>
          <span class="oeva-hero-total-unit">分</span>
        </div>
      </div>
      <div class="oeva-hero-breakdown">
        <span class="oeva-chip oeva-chip--sla">SLA <b>${formatNumber(item.sla_score, 1)}</b></span>
        <span class="oeva-chip oeva-chip--closure">闭环 <b>${formatNumber(item.closure_score, 1)}</b></span>
        <span class="oeva-chip oeva-chip--ticket">工单 <b>${formatNumber(item.ticket_score, 1)}</b></span>
        <span class="oeva-chip oeva-chip--extra">加分 <b>${formatNumber(item.extra_score, 1)}</b></span>
        <span class="oeva-chip oeva-chip--event ${item.event_net < 0 ? "is-down" : item.event_net > 0 ? "is-up" : ""}">事件 <b>${item.event_net > 0 ? "+" : ""}${formatNumber(item.event_net, 1)}</b></span>
      </div>
      <div class="oeva-hero-radar" id="oncall-eva-chart-radar"></div>
      <div class="oeva-hero-gauges">
        <div class="oeva-gauge-card">
          <div class="oeva-gauge" id="oncall-eva-gauge-sla"></div>
          <div class="oeva-gauge-foot" title="${escapeAttr(describeSlaTier(m.sla_avg_hours))}">平均 ${formatHoursDhM(m.sla_avg_hours)}</div>
        </div>
        <div class="oeva-gauge-card">
          <div class="oeva-gauge" id="oncall-eva-gauge-closure"></div>
          <div class="oeva-gauge-foot" title="${escapeAttr(describeClosureTier(m.independent_closure_rate))}">独立闭环 ${formatNumber(m.independent_closure_rate, 1)}%</div>
        </div>
        <div class="oeva-gauge-card">
          <div class="oeva-gauge" id="oncall-eva-gauge-ticket"></div>
          <div class="oeva-gauge-foot">完成 ${m.ticket_count ?? 0} / 门槛 ${formatNumber(item.ticket_threshold, 1)}</div>
        </div>
      </div>
    </section>`;
}

// 团队分组明细顺序（运维效率 v2 口径：月度闭环/工单门槛按组分别统计）。
const TEAM_GROUP_ORDER = ["ONCALL", "R&D"];

// 把 team.groups 的某字段拼成「ONCALL x · R&D y」；无分组数据返回 null（调用方回退到合计）。
export function teamGroupBreakdown(team, field, fmt = (v) => v) {
  const groups = (team && team.groups) || {};
  const keys = [
    ...TEAM_GROUP_ORDER.filter((g) => Object.prototype.hasOwnProperty.call(groups, g)),
    ...Object.keys(groups).filter((g) => !TEAM_GROUP_ORDER.includes(g)),
  ];
  if (!keys.length) return null;
  return keys.map((g) => `${g} ${fmt(groups[g] ? groups[g][field] : undefined)}`).join(" · ");
}

function renderHeroRight() {
  const data = state.oncallEvaScores;
  if (!data || !(data.items || []).length) {
    return `<section class="oeva-hero-right"><div class="oeva-card-title">综合得分排行</div><div class="oeva-empty">${state.oncallEvaScoresLoading ? "加载中…" : "暂无评议数据"}</div></section>`;
  }
  const team = data.team || {};
  const closureSplit = teamGroupBreakdown(team, "total_tickets", (v) => v ?? "--");
  const thresholdSplit = teamGroupBreakdown(team, "ticket_threshold", (v) => formatNumber(v, 1));
  return `
    <section class="oeva-hero-right" aria-label="团队排行">
      <div class="oeva-team-strip">
        <div class="oeva-team-stat"><span>团队人数</span><b>${team.headcount ?? "--"}</b></div>
        <div class="oeva-team-stat"><span>月度闭环</span><b>${team.total_tickets ?? "--"}</b><em>${escapeHtml(closureSplit || "—")}</em></div>
        <div class="oeva-team-stat"><span>工单门槛</span><b>${formatNumber(team.ticket_threshold, 1)}</b><em>${escapeHtml(thresholdSplit || "人均×0.8")}</em></div>
        <div class="oeva-team-stat"><span>团队均分</span><b>${formatNumber(team.avg_total_score, 1)}</b></div>
      </div>
      <div class="oeva-card-title">综合得分排行（点击切换主角）</div>
      <div class="oeva-rank-chart" id="oncall-eva-chart-rank"></div>
    </section>`;
}

function renderDistributionRow() {
  const data = state.oncallEvaScores;
  if (!data || !(data.items || []).length) return "";
  return `
    <section class="oeva-row oeva-row--two">
      <div class="oeva-card">
        <div class="oeva-card-title">SLA × 独立闭环 矩阵<span class="oeva-card-hint">气泡大小=工单完成数 · 颜色=门槛达成</span></div>
        <div class="oeva-chart" id="oncall-eva-chart-matrix"></div>
      </div>
      <div class="oeva-card">
        <div class="oeva-card-title">加分项贡献（按类目堆叠）</div>
        <div class="oeva-chart" id="oncall-eva-chart-extra"></div>
      </div>
    </section>`;
}

function renderScoresTable() {
  const data = state.oncallEvaScores;
  if (!data || !data.items) {
    return `<section class="oeva-card"><div class="oeva-empty">${state.oncallEvaScoresLoading ? "加载中…" : "暂无评议数据"}</div></section>`;
  }
  const focusAcc = (focusedItem() || {}).account;
  const rows = data.items
    .map((it, idx) => {
      const m = it.metrics || {};
      const isFocused = it.account === focusAcc;
      return `
        <tr data-eva-row="${escapeAttr(it.account)}" class="${isFocused ? "is-selected" : ""}">
          <td>${idx + 1}</td>
          <td>${escapeHtml(personDisplayName(it))}</td>
          <td title="${escapeAttr(describeSlaTier(m.sla_avg_hours))}">
            <span class="oeva-tier oeva-tier--${slaTierKey(m.sla_avg_hours)}">${formatHoursDhM(m.sla_avg_hours)}</span>
            <span class="oeva-cell-sub">${formatNumber(it.sla_score, 1)} 分</span>
          </td>
          <td title="${escapeAttr(describeClosureTier(m.independent_closure_rate))}">
            <span class="oeva-tier oeva-tier--cl-${closureTierKey(m.independent_closure_rate)}">${formatNumber(m.independent_closure_rate, 1)}%</span>
            <span class="oeva-cell-sub">${formatNumber(it.closure_score, 1)} 分</span>
          </td>
          <td>
            <span class="oeva-progress" style="--pct:${ticketAchievementPct(m, it.ticket_threshold).toFixed(0)}%"><span></span></span>
            <span class="oeva-cell-sub">${m.ticket_count ?? 0} / ${formatNumber(it.ticket_threshold, 1)}</span>
          </td>
          <td>${formatNumber(it.extra_score, 1)}</td>
          <td class="${it.event_net < 0 ? "oeva-net-down" : it.event_net > 0 ? "oeva-net-up" : ""}">${it.event_net > 0 ? "+" : ""}${formatNumber(it.event_net, 1)}</td>
          <td class="oeva-total">${formatNumber(it.total_score, 1)}</td>
        </tr>`;
    })
    .join("");
  return `
    <section class="oeva-card">
      <div class="oeva-card-title">综合得分排行表</div>
      <div class="oeva-table-wrap">
        <table class="oeva-table">
          <thead>
            <tr>
              <th>#</th>
              <th>姓名</th>
              <th>SLA · 35%</th>
              <th>独立闭环 · 30%</th>
              <th>工单达成 · 20</th>
              <th>加分 ≤15</th>
              <th>红黑事件</th>
              <th>总分</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8" class="oeva-empty">暂无评议人员</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function renderEventsSummary() {
  const data = state.oncallEvaScores;
  if (!data || !(data.items || []).length) return "";
  const reds = [];
  const blacks = [];
  data.items.forEach((it) => {
    (it.events?.items || []).forEach((ev) => {
      const row = { user: personDisplayName(it), ...ev };
      if (ev.kind === "red") reds.push(row);
      else if (ev.kind === "black") blacks.push(row);
    });
  });
  if (!reds.length && !blacks.length) return "";
  const renderList = (arr, kind) => {
    if (!arr.length) return `<div class="oeva-empty oeva-empty--mini">无</div>`;
    return arr.map((ev) => `
      <div class="oeva-event-row">
        <span class="oeva-event-tag oeva-event-tag--${kind}">${kind === "red" ? "+" : "-"}${formatNumber(ev.score, 1)}</span>
        <span class="oeva-event-user">${escapeHtml(ev.user)}</span>
        <span class="oeva-event-text">${escapeHtml(ev.summary || "")}</span>
      </div>`).join("");
  };
  return `
    <section class="oeva-row oeva-row--two">
      <div class="oeva-card oeva-card--red">
        <div class="oeva-card-title">红事件 · 共 ${reds.length} 项 / +${formatNumber(reds.reduce((a, b) => a + Number(b.score || 0), 0), 1)}</div>
        <div class="oeva-event-list">${renderList(reds, "red")}</div>
      </div>
      <div class="oeva-card oeva-card--black">
        <div class="oeva-card-title">黑事件 · 共 ${blacks.length} 项 / -${formatNumber(blacks.reduce((a, b) => a + Number(b.score || 0), 0), 1)}</div>
        <div class="oeva-event-list">${renderList(blacks, "black")}</div>
      </div>
    </section>`;
}

/* ----- 加分项 / 红黑事件 子页面 ----- */

function renderExtrasPanel() {
  const operator = getCurrentOperator();
  const whitelist = getCurrentWhitelistSettings();
  const canReview = whitelistAllows("oncall_eva_review", "readonly", whitelist);
  const items = state.oncallEvaExtras || [];
  const mine = items.filter((x) => x.account === operator.account);
  const pending = canReview ? items.filter((x) => x.status === "pending") : [];
  const renderRow = (it, withReview) => `
    <tr>
      <td>${escapeHtml(it.user_name || it.account)}</td>
      <td>${escapeHtml(categoryLabel(it.category))}</td>
      <td>${escapeHtml(it.description || "")}</td>
      <td>${formatNumber(it.declared_score, 1)}${it.is_excellent ? '<span class="oeva-tag-excellent">优秀</span>' : ""}</td>
      <td>${it.evidence_url ? `<a href="${escapeAttr(it.evidence_url)}" target="_blank" rel="noreferrer">链接</a>` : "--"}</td>
      <td><span class="oeva-status oeva-status--${escapeAttr(it.status)}">${escapeHtml(it.status)}</span>${it.reviewer_name ? `<div class="oeva-cell-sub">${escapeHtml(it.reviewer_name)}</div>` : ""}</td>
      ${withReview && it.status === "pending"
        ? `<td>
            <button type="button" class="action primary" data-eva-extra-approve="${it.id}">通过</button>
            <button type="button" class="action" data-eva-extra-excellent="${it.id}">通过(优秀)</button>
            <button type="button" class="action danger" data-eva-extra-reject="${it.id}">驳回</button>
          </td>`
        : withReview ? "<td>--</td>" : ""}
    </tr>`;
  const mineRows = mine.length
    ? mine.map((it) => renderRow(it, false)).join("")
    : `<tr><td colspan="6" class="oeva-empty">暂无申报</td></tr>`;
  const pendingRows = pending.length
    ? pending.map((it) => renderRow(it, true)).join("")
    : `<tr><td colspan="7" class="oeva-empty">暂无待审批</td></tr>`;
  return `
    <section class="oeva-card">
      <div class="oeva-card-title">
        <span>我的加分项申报</span>
        <button type="button" class="action primary" id="oeva-extra-add">＋ 申报加分项</button>
      </div>
      <div class="oeva-table-wrap">
        <table class="oeva-table">
          <thead><tr><th>姓名</th><th>类别</th><th>描述</th><th>申报分</th><th>佐证</th><th>状态</th></tr></thead>
          <tbody>${mineRows}</tbody>
        </table>
      </div>
      ${canReview ? `
        <div class="oeva-card-title oeva-card-title--sub">待审批（${pending.length}）</div>
        <div class="oeva-table-wrap">
          <table class="oeva-table">
            <thead><tr><th>姓名</th><th>类别</th><th>描述</th><th>申报分</th><th>佐证</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${pendingRows}</tbody>
          </table>
        </div>` : ""}
    </section>`;
}

function renderEventsPanel() {
  const whitelist = getCurrentWhitelistSettings();
  const canRecord = whitelistAllows("oncall_eva_review", "readonly", whitelist);
  const items = state.oncallEvaEvents || [];
  const rows = items
    .map((it) => `
      <tr>
        <td><span class="oeva-event-tag oeva-event-tag--${escapeAttr(it.kind)}">${it.kind === "red" ? "红事件" : "黑事件"}</span></td>
        <td>${escapeHtml(it.user_name || it.account)}</td>
        <td>${formatNumber(it.score, 1)}</td>
        <td>${escapeHtml(it.summary || "")}</td>
        <td>${it.evidence_url ? `<a href="${escapeAttr(it.evidence_url)}" target="_blank" rel="noreferrer">链接</a>` : "--"}</td>
        <td>${escapeHtml(it.recorder_name || "")}</td>
        ${canRecord ? `<td><button type="button" class="action danger" data-eva-event-delete="${it.id}">删除</button></td>` : ""}
      </tr>`)
    .join("");
  return `
    <section class="oeva-card">
      <div class="oeva-card-title">
        <span>红黑事件</span>
        ${canRecord ? '<button type="button" class="action primary" id="oeva-event-add">＋ 录入事件</button>' : ""}
      </div>
      <div class="oeva-table-wrap">
        <table class="oeva-table">
          <thead><tr><th>类型</th><th>对象</th><th>分数</th><th>事件描述</th><th>佐证</th><th>记录人</th>${canRecord ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${canRecord ? 7 : 6}" class="oeva-empty">暂无事件</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function canDeclareExtraForOthers() {
  return whitelistAllows("oncall_eva_review", "readonly", getCurrentWhitelistSettings());
}

function oevaPersonLabel(account, users) {
  const acc = String(account || "").trim();
  if (!acc) return "";
  const u = (users || []).find((x) => String(x.account || "").trim() === acc);
  if (!u) return acc;
  const nm = String(u.user_name || u.userName || "").trim();
  return nm ? `${nm} ${acc}` : acc;
}

function oevaAccountFromPersonLabel(raw, users) {
  const q = String(raw || "").trim();
  if (!q) return "";
  const pool = Array.isArray(users) ? users : [];
  const hit = pool.find((u) => {
    const acc = String(u.account || "").trim();
    const nm = String(u.user_name || u.userName || "").trim();
    const lab = nm && acc ? `${nm} ${acc}` : acc || nm;
    return acc === q || lab === q;
  });
  return hit ? String(hit.account || "").trim() : "";
}

function oevaTargetUsersForExtra() {
  const operator = getCurrentOperator();
  if (canDeclareExtraForOthers()) return state.adminUsers || [];
  const self = (state.adminUsers || []).find((u) => u.account === operator.account);
  return self
    ? [self]
    : [{ account: operator.account, user_name: operator.userName || "" }];
}

function renderOevaTargetSelect(selectedAccount, users, editable) {
  const options = buildPersonOptionsFromAdminUsers(users);
  const value = oevaPersonLabel(selectedAccount, users);
  return renderWorkflowFlatSelect(
    { key: "oeva_target", type: "whitelist" },
    value,
    editable && options.length > 0,
    { options, usePlaceholder: true, enableSearch: true },
  );
}

function bindOevaTargetSelect(bodyEl, onAccount, users) {
  if (!bodyEl) return;
  const pool = Array.isArray(users) ? users : (state.adminUsers || []);
  bindWorkflowFlatSelect(bodyEl);
  bodyEl.addEventListener("change", (ev) => {
    const h = ev.target.closest?.("[data-wf-flat-value]");
    if (!h || !bodyEl.contains(h)) return;
    const wrap = h.closest("[data-wf-flat-select]");
    if ((wrap?.getAttribute("data-field-key") || "") !== "oeva_target") return;
    onAccount(oevaAccountFromPersonLabel(h.value, pool));
  });
}

function readOevaTargetAccount(bodyEl, fallbackAccount, users) {
  const wrap = bodyEl?.querySelector?.('[data-field-key="oeva_target"]');
  const label = wrap?.querySelector?.("[data-wf-flat-value]")?.value || "";
  const pool = Array.isArray(users) ? users : (state.adminUsers || []);
  return oevaAccountFromPersonLabel(label, pool) || String(fallbackAccount || "").trim();
}

function renderExtraDraftModal() {
  const draft = state.oncallEvaExtraDraft;
  if (!draft) return "";
  const period = ensurePeriod();
  const users = oevaTargetUsersForExtra();
  const targetCtl = renderOevaTargetSelect(draft.account, users, true);
  const cats = ONCALL_EVA_EXTRA_CATEGORIES
    .map((c) => `<option value="${c.key}" ${draft.category === c.key ? "selected" : ""}>${c.label}（单项 ≤${c.per_item}）</option>`)
    .join("");
  return `
    <div class="perm-modal-mask">
      <div class="perm-modal">
        <div class="perm-modal-head"><h3>申报加分项 · ${formatEvaPeriodLabel(period)}</h3></div>
        <div class="perm-modal-body" id="oeva-extra-draft-body">
          <div class="oeva-form-row">
            <label>对象</label>
            ${targetCtl}
          </div>
          <div class="oeva-form-row">
            <label>类别</label>
            <select id="oeva-draft-category">${cats}</select>
          </div>
          <div class="oeva-form-row">
            <label>描述</label>
            <textarea id="oeva-draft-desc" rows="3" placeholder="本月参与项目 / 具体事项">${escapeHtml(draft.description || "")}</textarea>
          </div>
          <div class="oeva-form-row">
            <label>申报分数</label>
            <input type="number" step="0.5" min="0" id="oeva-draft-score" value="${escapeAttr(draft.declared_score || "")}" />
            <span class="oeva-form-hint">最终得分以单项上限（${categoryPerItemCap(draft.category)}）为准</span>
          </div>
          <div class="oeva-form-row">
            <label>佐证链接</label>
            <input type="text" id="oeva-draft-evidence" value="${escapeAttr(draft.evidence_url || "")}" placeholder="可选，例如 PR / 文档链接" />
          </div>
          ${state.oncallEvaMsg ? `<div class="oeva-form-msg">${escapeHtml(state.oncallEvaMsg)}</div>` : ""}
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="oeva-draft-cancel">取消</button>
          <button type="button" class="action primary" id="oeva-draft-submit">提交申报</button>
        </div>
      </div>
    </div>`;
}

function renderEventDraftModal() {
  const draft = state.oncallEvaEventDraft;
  if (!draft) return "";
  const period = ensurePeriod();
  const users = state.adminUsers || [];
  const targetCtl = renderOevaTargetSelect(draft.account, users, true);
  return `
    <div class="perm-modal-mask">
      <div class="perm-modal">
        <div class="perm-modal-head"><h3>录入红黑事件 · ${formatEvaPeriodLabel(period)}</h3></div>
        <div class="perm-modal-body" id="oeva-event-draft-body">
          <div class="oeva-form-row">
            <label>对象</label>
            ${targetCtl}
          </div>
          <div class="oeva-form-row">
            <label>事件类型</label>
            <label><input type="radio" name="oeva-event-kind" value="red" ${draft.kind !== "black" ? "checked" : ""}/> 红事件 (加分)</label>
            <label><input type="radio" name="oeva-event-kind" value="black" ${draft.kind === "black" ? "checked" : ""}/> 黑事件 (扣分)</label>
          </div>
          <div class="oeva-form-row">
            <label>分数</label>
            <input type="number" step="0.5" min="0" max="5" id="oeva-event-score" value="${escapeAttr(draft.score || "")}" />
            <span class="oeva-form-hint">单次 ≤ 5</span>
          </div>
          <div class="oeva-form-row">
            <label>事件描述</label>
            <textarea id="oeva-event-summary" rows="3" placeholder="关键事件经过">${escapeHtml(draft.summary || "")}</textarea>
          </div>
          <div class="oeva-form-row">
            <label>佐证链接</label>
            <input type="text" id="oeva-event-evidence" value="${escapeAttr(draft.evidence_url || "")}" placeholder="可选" />
          </div>
          ${state.oncallEvaMsg ? `<div class="oeva-form-msg">${escapeHtml(state.oncallEvaMsg)}</div>` : ""}
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="oeva-event-cancel">取消</button>
          <button type="button" class="action primary" id="oeva-event-submit">保存事件</button>
        </div>
      </div>
    </div>`;
}

export function renderOncallEvaPage() {
  ensurePeriod();
  const tab = state.oncallEvaTab || "scores";
  return `
    <section class="oeva-page" aria-label="运维效率">
      ${renderToolbar()}
      ${renderRulesBar()}
      ${tab === "scores" ? `
        <div class="oeva-hero">
          ${renderHeroLeft()}
          ${renderHeroRight()}
        </div>
        ${renderDistributionRow()}
        ${renderScoresTable()}
        ${renderEventsSummary()}
      ` : ""}
      ${tab === "extras" ? renderExtrasPanel() : ""}
      ${tab === "events" ? renderEventsPanel() : ""}
    </section>
    ${renderExtraDraftModal()}
    ${renderEventDraftModal()}`;
}

/* ===================== ECharts 配置 ===================== */

function isDarkUiTheme() {
  return typeof document !== "undefined"
    && document.documentElement.getAttribute("data-theme") === "dark";
}

/** 图表文字/分割线：暗黑主题提高对比度 */
function chartInk() {
  if (isDarkUiTheme()) {
    return {
      text: "#e2e8f0",
      muted: "#94a3b8",
      faint: "#7d8794",
      split: "rgba(148,163,184,0.18)",
      splitStrong: "rgba(148,163,184,0.35)",
      radarArea: ["rgba(88,166,255,0.10)", "rgba(88,166,255,0.04)"],
      gaugeTrack: "rgba(148,163,184,0.28)",
      empty: "#7d8794",
    };
  }
  return {
    text: "#52525B",
    muted: "#71717A",
    faint: "#A8B0BD",
    split: "rgba(0,0,0,0.06)",
    splitStrong: "rgba(0,0,0,0.18)",
    radarArea: ["rgba(245,240,232,0.45)", "rgba(220,212,198,0.18)"],
    gaugeTrack: "rgba(0,0,0,0.08)",
    empty: "#A8B0BD",
  };
}

function disposeAllCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  Object.values(chartInstances).forEach((c) => {
    try { c.dispose(); } catch (_) { /* ignore */ }
  });
  chartInstances = {};
}

export function disposeOncallEvaCharts() {
  disposeAllCharts();
}

function buildRankBarOption(items, focusAcc) {
  const sorted = items.slice().sort((a, b) => a.total_score - b.total_score);
  const names = sorted.map(personDisplayName);
  const accs = sorted.map((x) => x.account);
  const make = (key, color) => sorted.map((x) => ({
    value: Number(x[key]) || 0,
    itemStyle: x.account === focusAcc ? { color, opacity: 1 } : { color, opacity: 0.55 },
  }));
  const evtBars = sorted.map((x) => {
    const v = Number(x.event_net) || 0;
    return {
      value: v,
      itemStyle: {
        color: v >= 0 ? ONCALL_EVA_PALETTE.red : ONCALL_EVA_PALETTE.black,
        opacity: x.account === focusAcc ? 1 : 0.55,
      },
    };
  });
  // 人数超过可视行数时，加竖向滚动条（dataZoom 锁定缩放、仅滚动），默认停在高分段
  const VISIBLE_ROWS = 12;
  const many = sorted.length > VISIBLE_ROWS;
  const dataZoom = many
    ? [
        { type: "inside", yAxisIndex: 0, zoomLock: true, startValue: sorted.length - VISIBLE_ROWS, endValue: sorted.length - 1 },
        {
          type: "slider", yAxisIndex: 0, zoomLock: true, brushSelect: false, showDetail: false,
          width: 12, right: 6, top: 36, bottom: 40,
          startValue: sorted.length - VISIBLE_ROWS, endValue: sorted.length - 1,
        },
      ]
    : [];
  const ink = chartInk();
  return {
    backgroundColor: "transparent",
    textStyle: { color: ink.text },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const sum = params.reduce((acc, p) => acc + (Number(p.value) || 0), 0);
        return `${params[0]?.axisValue || ""} · 合计 <b>${sum.toFixed(2)}</b><br/>` +
          params.map((p) => `${p.marker}${p.seriesName}: <b>${(Number(p.value) || 0).toFixed(2)}</b>`).join("<br/>");
      },
    },
    legend: { top: 4, textStyle: { fontSize: 11, color: ink.text }, itemHeight: 8, itemGap: 14 },
    grid: { left: 92, right: many ? 34 : 18, top: 36, bottom: 40 },
    xAxis: {
      type: "value",
      name: "得分",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { fontSize: 11, color: ink.muted },
      min: 0,
      max: 120,
      interval: 20,
      axisLabel: { fontSize: 11, color: ink.muted },
      splitLine: { lineStyle: { color: ink.split } },
    },
    dataZoom,
    yAxis: {
      type: "category",
      data: names,
      axisLabel: { fontSize: 11, color: ink.text },
      // 把账号挂到 yAxis category 里供点击事件取用
      triggerEvent: true,
      _accs: accs,
    },
    series: [
      { name: "SLA", type: "bar", stack: "total", data: make("sla_score", ONCALL_EVA_PALETTE.sla), barMaxWidth: 14 },
      { name: "独立闭环", type: "bar", stack: "total", data: make("closure_score", ONCALL_EVA_PALETTE.closure) },
      { name: "工单量", type: "bar", stack: "total", data: make("ticket_score", ONCALL_EVA_PALETTE.ticket) },
      { name: "加分项", type: "bar", stack: "total", data: make("extra_score", ONCALL_EVA_PALETTE.extra) },
      { name: "红黑事件", type: "bar", stack: "total", data: evtBars },
    ],
  };
}

function buildRadarOption(item) {
  if (!item) return { series: [] };
  const m = item.metrics || {};
  const slaBase = item.sla_base ?? 0;
  const closureBase = item.closure_base ?? 0;
  const ticketPct = ticketAchievementPct(m, item.ticket_threshold);
  const extraPct = (Number(item.extra_score) || 0) / 15 * 100;
  const eventVal = Number(item.event_net) || 0;
  const eventPct = Math.max(0, Math.min(100, 50 + eventVal * 10));
  const ink = chartInk();
  return {
    backgroundColor: "transparent",
    textStyle: { color: ink.text },
    tooltip: { trigger: "item" },
    radar: {
      indicator: [
        { name: "SLA 基础分", max: 100 },
        { name: "独立闭环 基础分", max: 100 },
        { name: "工单量达成%", max: 100 },
        { name: "加分项使用%", max: 100 },
        { name: "事件平衡", max: 100 },
      ],
      radius: "62%",
      axisName: { fontSize: 11, color: ink.text },
      splitArea: { areaStyle: { color: ink.radarArea } },
      splitLine: { lineStyle: { color: ink.split } },
    },
    series: [{
      type: "radar",
      data: [{
        value: [slaBase, closureBase, ticketPct, extraPct, eventPct],
        name: personDisplayName(item),
        areaStyle: { color: "rgba(79,124,255,0.22)" },
        lineStyle: { color: ONCALL_EVA_PALETTE.sla, width: 2 },
        symbol: "circle",
        symbolSize: 4,
      }],
    }],
  };
}

function buildGaugeOption(value, name, color) {
  const ink = chartInk();
  return {
    backgroundColor: "transparent",
    series: [{
      type: "gauge",
      radius: "92%",
      center: ["50%", "60%"],
      min: 0,
      max: 100,
      startAngle: 210,
      endAngle: -30,
      progress: { show: true, width: 6, itemStyle: { color } },
      axisLine: { lineStyle: { width: 6, color: [[1, ink.gaugeTrack]] } },
      axisTick: { show: false },
      splitLine: { length: 4, lineStyle: { color: ink.splitStrong } },
      axisLabel: { show: false },
      pointer: { length: "55%", width: 3, itemStyle: { color } },
      anchor: { show: true, size: 6, itemStyle: { color } },
      title: { offsetCenter: [0, "58%"], fontSize: 11, color: ink.muted },
      detail: {
        offsetCenter: [0, "10%"],
        fontSize: 22,
        fontWeight: 600,
        formatter: (v) => `${Number(v).toFixed(0)}`,
        color: ink.text,
      },
      data: [{ value: Number(value) || 0, name }],
    }],
  };
}

function buildMatrixOption(items) {
  // x = SLA 平均小时, y = 独立闭环率%, 大小 = 工单数, 颜色 = 工单门槛达成
  const data = items.map((it) => {
    const m = it.metrics || {};
    const x = m.sla_avg_hours == null ? null : Number(m.sla_avg_hours);
    const y = m.independent_closure_rate == null ? null : Number(m.independent_closure_rate);
    const size = Math.max(8, Math.min(48, Number(m.ticket_count || 0) * 2));
    const pct = ticketAchievementPct(m, it.ticket_threshold);
    return {
      name: personDisplayName(it),
      value: [x ?? 0, y ?? 0, size, pct, m.ticket_count || 0, it.account],
      itemStyle: { color: pct >= 100 ? ONCALL_EVA_PALETTE.ticket : pct >= 60 ? ONCALL_EVA_PALETTE.extra : ONCALL_EVA_PALETTE.red },
    };
  });
  const ink = chartInk();
  return {
    backgroundColor: "transparent",
    textStyle: { color: ink.text },
    tooltip: {
      trigger: "item",
      formatter: (p) => `<b>${p.name}</b><br/>SLA 平均: ${Number(p.value[0]).toFixed(2)}h<br/>独立闭环: ${Number(p.value[1]).toFixed(1)}%<br/>工单数: ${p.value[4]}<br/>门槛达成: ${Number(p.value[3]).toFixed(0)}%`,
    },
    grid: { left: 50, right: 18, top: 36, bottom: 36 },
    xAxis: {
      type: "value",
      name: "SLA 平均(h)",
      nameTextStyle: { fontSize: 11, color: ink.muted },
      axisLabel: { color: ink.muted },
      inverse: true, // 越靠左越快
      splitLine: { lineStyle: { color: ink.split } },
    },
    yAxis: {
      type: "value",
      name: "独立闭环率%",
      nameTextStyle: { fontSize: 11, color: ink.muted },
      axisLabel: { color: ink.muted },
      max: 100,
      splitLine: { lineStyle: { color: ink.split } },
    },
    series: [
      // 阈值参考线：24h SLA、90% 闭环
      {
        type: "scatter",
        symbolSize: (val) => val[2],
        data,
        label: { show: true, formatter: (p) => p.name, position: "top", fontSize: 10, color: ink.text },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: ink.splitStrong, type: "dashed" },
          data: [
            { xAxis: 24, label: { formatter: "SLA 24h", position: "end", fontSize: 10, color: ink.muted } },
            { yAxis: 90, label: { formatter: "闭环 90%", position: "end", fontSize: 10, color: ink.muted } },
          ],
        },
      },
    ],
  };
}

function buildExtraStackOption(items) {
  const cats = ONCALL_EVA_EXTRA_CATEGORIES;
  // 仅展示有加分的人员，避免轴空人
  const persons = items.filter((it) => Number(it.extra_score) > 0);
  const names = persons.map(personDisplayName);
  const ink = chartInk();
  if (!names.length) {
    return {
      backgroundColor: "transparent",
      title: { text: "本月暂无加分项录入", left: "center", top: "middle", textStyle: { color: ink.empty, fontSize: 13, fontWeight: 400 } },
    };
  }
  const colors = ["#F59E0B", "#FBBF24", "#FCD34D", "#A78BFA", "#60A5FA", "#94A3B8"];
  const series = cats.map((c, i) => ({
    name: c.label,
    type: "bar",
    stack: "extra",
    barMaxWidth: 22,
    data: persons.map((p) => Number(p.extras?.by_category?.[c.key]?.capped_score || 0)),
    itemStyle: { color: colors[i % colors.length], borderRadius: i === cats.length - 1 ? [4, 4, 0, 0] : 0 },
  }));
  return {
    backgroundColor: "transparent",
    textStyle: { color: ink.text },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 4, textStyle: { fontSize: 11, color: ink.text }, itemHeight: 8, itemGap: 10 },
    grid: { left: 50, right: 18, top: 38, bottom: 36 },
    xAxis: {
      type: "category",
      data: names,
      axisLabel: { fontSize: 11, interval: 0, rotate: names.length > 6 ? 24 : 0, color: ink.muted },
    },
    yAxis: {
      type: "value",
      name: "累计分数",
      nameTextStyle: { fontSize: 11, color: ink.muted },
      axisLabel: { color: ink.muted },
      max: 15,
      splitLine: { lineStyle: { color: ink.split } },
    },
    series,
  };
}

/* ===================== 渲染图表 ===================== */

function renderAllCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  disposeAllCharts();
  const data = state.oncallEvaScores;
  if (!data || !(data.items || []).length) return;
  const items = data.items;
  const focus = focusedItem();
  const focusAcc = focus ? focus.account : "";

  const init = (id, opt) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const inst = E.init(el, null, { renderer: "canvas" });
    inst.setOption(opt);
    chartInstances[id] = inst;
    return inst;
  };

  // 排行榜 — 支持点击切换主角
  const rankInst = init("oncall-eva-chart-rank", buildRankBarOption(items, focusAcc));
  if (rankInst) {
    rankInst.off("click");
    rankInst.on("click", (params) => {
      const idx = params.dataIndex;
      const sorted = items.slice().sort((a, b) => a.total_score - b.total_score);
      const target = sorted[idx];
      if (target) {
        state.oncallEvaSelectedAccount = target.account;
        requestRender();
      }
    });
  }

  // 矩阵 — 点击气泡也切换主角
  const matrixInst = init("oncall-eva-chart-matrix", buildMatrixOption(items));
  if (matrixInst) {
    matrixInst.off("click");
    matrixInst.on("click", (params) => {
      const acc = params?.value?.[5];
      if (acc) {
        state.oncallEvaSelectedAccount = acc;
        requestRender();
      }
    });
  }

  init("oncall-eva-chart-radar", buildRadarOption(focus));
  init("oncall-eva-gauge-sla", buildGaugeOption(focus?.sla_base ?? 0, "SLA 基础分", ONCALL_EVA_PALETTE.sla));
  init("oncall-eva-gauge-closure", buildGaugeOption(focus?.closure_base ?? 0, "独立闭环 基础分", ONCALL_EVA_PALETTE.closure));
  init(
    "oncall-eva-gauge-ticket",
    buildGaugeOption(
      focus ? ticketAchievementPct(focus.metrics, focus.ticket_threshold) : 0,
      "工单达成%",
      ONCALL_EVA_PALETTE.ticket,
    ),
  );
  init("oncall-eva-chart-extra", buildExtraStackOption(items));

  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener(
      "resize",
      () => {
        if (state.activeKey !== "oncall:eva") return;
        Object.values(chartInstances).forEach((c) => {
          try { c.resize(); } catch (_) { /* ignore */ }
        });
      },
      { passive: true },
    );
  }
}

/* ===================== 事件绑定 ===================== */

function bindToolbar() {
  const periodSelect = document.getElementById("oeva-period");
  if (periodSelect) {
    periodSelect.addEventListener("change", () => {
      const [y, m] = periodSelect.value.split("-").map(Number);
      state.oncallEvaPeriod = { year: y, month: m };
      refreshOncallEvaPage();
    });
  }
  const groupSelect = document.getElementById("oeva-group");
  if (groupSelect) {
    groupSelect.addEventListener("change", () => {
      state.oncallEvaGroup = groupSelect.value || "";
      state.oncallEvaDeptSel = [];           // 切组后清空已选部门，部门随组重新拉取
      state.oncallEvaDeptOpen = false;
      state.oncallEvaSelectedAccount = "";  // 切组后重置主角，避免停留在非本组成员
      fetchDepartments().then(() => requestRender());
      fetchScores();
    });
  }
  const deptToggle = document.getElementById("oeva-dept-toggle");
  if (deptToggle) {
    deptToggle.addEventListener("click", () => {
      state.oncallEvaDeptOpen = !state.oncallEvaDeptOpen;
      requestRender();
    });
  }
  const deptAll = document.getElementById("oeva-dept-all");
  if (deptAll) {
    deptAll.addEventListener("change", () => {
      state.oncallEvaDeptSel = [];           // 勾「全部部门」= 清空多选
      state.oncallEvaSelectedAccount = "";
      fetchScores();
    });
  }
  document.querySelectorAll("[data-eva-dept-value]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const d = cb.getAttribute("data-eva-dept-value") || "";
      const cur = new Set(state.oncallEvaDeptSel || []);
      if (cb.checked) cur.add(d); else cur.delete(d);
      state.oncallEvaDeptSel = [...cur];
      state.oncallEvaSelectedAccount = "";  // 改部门后重置主角
      fetchScores();
    });
  });
  const deptReset = document.getElementById("oeva-dept-reset");
  if (deptReset) {
    deptReset.addEventListener("click", () => {
      state.oncallEvaDeptSel = [];
      state.oncallEvaDeptOpen = false;
      state.oncallEvaSelectedAccount = "";
      fetchScores();
    });
  }
  const deptDone = document.getElementById("oeva-dept-done");
  if (deptDone) {
    deptDone.addEventListener("click", () => {
      state.oncallEvaDeptOpen = false;
      requestRender();
    });
  }
  document.querySelectorAll("[data-eva-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.oncallEvaTab = btn.getAttribute("data-eva-tab") || "scores";
      requestRender();
    });
  });
  const refreshBtn = document.getElementById("oeva-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", () => refreshOncallEvaPage());
}

function bindTableRowClick() {
  document.querySelectorAll("[data-eva-row]").forEach((row) => {
    row.addEventListener("click", () => {
      const acc = row.getAttribute("data-eva-row");
      if (!acc) return;
      state.oncallEvaSelectedAccount = acc;
      requestRender();
    });
  });
}

function bindExtraDraft() {
  const addBtn = document.getElementById("oeva-extra-add");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      state.oncallEvaExtraDraft = {
        account: "",
        category: "efficiency",
        description: "",
        declared_score: 0,
        evidence_url: "",
      };
      state.oncallEvaMsg = "";
      requestRender();
    });
  }
  const cancelBtn = document.getElementById("oeva-draft-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { state.oncallEvaExtraDraft = null; state.oncallEvaMsg = ""; requestRender(); });
  const draft = state.oncallEvaExtraDraft;
  if (!draft) return;
  const bodyEl = document.getElementById("oeva-extra-draft-body");
  const extraUsers = oevaTargetUsersForExtra();
  bindOevaTargetSelect(bodyEl, (acc) => { draft.account = acc; }, extraUsers);
  const cat = document.getElementById("oeva-draft-category");
  const desc = document.getElementById("oeva-draft-desc");
  const score = document.getElementById("oeva-draft-score");
  const evidence = document.getElementById("oeva-draft-evidence");
  if (cat) cat.addEventListener("change", () => { draft.category = cat.value; requestRender(); });
  if (desc) desc.addEventListener("input", () => { draft.description = desc.value; });
  if (score) score.addEventListener("input", () => { draft.declared_score = score.value; });
  if (evidence) evidence.addEventListener("input", () => { draft.evidence_url = evidence.value; });
  const submit = document.getElementById("oeva-draft-submit");
  if (submit) {
    submit.addEventListener("click", async () => {
      const operator = getCurrentOperator();
      const period = ensurePeriod();
      const targetAccount = readOevaTargetAccount(bodyEl, draft.account, extraUsers);
      if (!targetAccount) {
        state.oncallEvaMsg = "请选择对象";
        requestRender();
        return;
      }
      if (!draft.description || !String(draft.description).trim()) {
        state.oncallEvaMsg = "描述不能为空";
        requestRender();
        return;
      }
      const r = await fetch(`${API_BASE_URL}/api/oncall-eva/extras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operator.account,
          account: targetAccount,
          period_year: period.year,
          period_month: period.month,
          category: draft.category,
          description: String(draft.description).trim(),
          declared_score: Number(draft.declared_score || 0),
          evidence_url: String(draft.evidence_url || "").trim(),
        }),
      });
      if (r.ok) {
        state.oncallEvaExtraDraft = null;
        state.oncallEvaMsg = "";
        await fetchExtras();
      } else {
        const body = await r.json().catch(() => ({}));
        state.oncallEvaMsg = body.detail || "提交失败";
        requestRender();
      }
    });
  }
}

function bindExtraReview() {
  const operator = getCurrentOperator();
  const review = async (id, status, isExcellent) => {
    const r = await fetch(`${API_BASE_URL}/api/oncall-eva/extras/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: operator.account, status, is_excellent: isExcellent, review_comment: "" }),
    });
    if (r.ok) await Promise.all([fetchExtras(), fetchScores()]);
  };
  document.querySelectorAll("[data-eva-extra-approve]").forEach((b) => {
    b.addEventListener("click", () => review(b.getAttribute("data-eva-extra-approve"), "approved", false));
  });
  document.querySelectorAll("[data-eva-extra-excellent]").forEach((b) => {
    b.addEventListener("click", () => review(b.getAttribute("data-eva-extra-excellent"), "approved", true));
  });
  document.querySelectorAll("[data-eva-extra-reject]").forEach((b) => {
    b.addEventListener("click", () => review(b.getAttribute("data-eva-extra-reject"), "rejected", false));
  });
}

function bindEventDraft() {
  const addBtn = document.getElementById("oeva-event-add");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      state.oncallEvaEventDraft = { account: "", kind: "red", score: 1, summary: "", evidence_url: "" };
      state.oncallEvaMsg = "";
      requestRender();
    });
  }
  const cancelBtn = document.getElementById("oeva-event-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { state.oncallEvaEventDraft = null; state.oncallEvaMsg = ""; requestRender(); });
  const draft = state.oncallEvaEventDraft;
  if (!draft) {
    document.querySelectorAll("[data-eva-event-delete]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-eva-event-delete");
        const operator = getCurrentOperator();
        if (!confirm("确认删除该事件？")) return;
        const r = await fetch(`${API_BASE_URL}/api/oncall-eva/events/${id}?operator_id=${encodeURIComponent(operator.account)}`, { method: "DELETE" });
        if (r.ok) await Promise.all([fetchEvents(), fetchScores()]);
      });
    });
    return;
  }
  const bodyEl = document.getElementById("oeva-event-draft-body");
  bindOevaTargetSelect(bodyEl, (acc) => { draft.account = acc; });
  document.querySelectorAll('input[name="oeva-event-kind"]').forEach((input) => {
    input.addEventListener("change", () => { draft.kind = input.value; });
  });
  const score = document.getElementById("oeva-event-score");
  const summary = document.getElementById("oeva-event-summary");
  const evidence = document.getElementById("oeva-event-evidence");
  if (score) score.addEventListener("input", () => { draft.score = score.value; });
  if (summary) summary.addEventListener("input", () => { draft.summary = summary.value; });
  if (evidence) evidence.addEventListener("input", () => { draft.evidence_url = evidence.value; });
  const submit = document.getElementById("oeva-event-submit");
  if (submit) {
    submit.addEventListener("click", async () => {
      const operator = getCurrentOperator();
      const period = ensurePeriod();
      const targetAccount = readOevaTargetAccount(bodyEl, draft.account);
      if (!targetAccount) { state.oncallEvaMsg = "请选择对象"; requestRender(); return; }
      if (!draft.summary || !String(draft.summary).trim()) { state.oncallEvaMsg = "请填写事件描述"; requestRender(); return; }
      const sc = Number(draft.score || 0);
      if (!(sc > 0 && sc <= 5)) { state.oncallEvaMsg = "分数须在 0~5 之间"; requestRender(); return; }
      const r = await fetch(`${API_BASE_URL}/api/oncall-eva/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operator.account,
          account: targetAccount,
          period_year: period.year,
          period_month: period.month,
          kind: draft.kind || "red",
          score: sc,
          summary: String(draft.summary).trim(),
          evidence_url: String(draft.evidence_url || "").trim(),
        }),
      });
      if (r.ok) {
        state.oncallEvaEventDraft = null;
        state.oncallEvaMsg = "";
        await Promise.all([fetchEvents(), fetchScores()]);
      } else {
        const body = await r.json().catch(() => ({}));
        state.oncallEvaMsg = body.detail || "保存失败";
        requestRender();
      }
    });
  }
}

export function bindOncallEvaPage() {
  bindToolbar();
  bindTableRowClick();
  bindExtraDraft();
  bindExtraReview();
  bindEventDraft();
  if ((state.oncallEvaTab || "scores") === "scores") {
    renderAllCharts();
  } else {
    disposeAllCharts();
  }
  if (state.oncallEvaNeedsRefresh) refreshOncallEvaPage();
}
