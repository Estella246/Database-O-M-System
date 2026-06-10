import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { priorityBadgeClass, categoryBadgeClass, valueBadgeClass, formatReqDate, formatYmdLocal, formatReqDateTime } from "../utils/format.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { bindDateRangePicker, renderDateRangeHtml } from "../ui/date-range-picker-bind.js";
import { renderReqAnalyticsKpiCard, renderReqAnalyticsHorizontalBar } from "./requirement.js";
import { statLaborSvgPie, statLaborPieLegend, statLaborSvgBarVertical, statLaborSvgMultiLine, statLaborSvgStackedBars, STAT_LABOR_CHART_COLORS } from "./stats.js";

export const REQ_STATUSES = ["待分析", "待RAT决策", "开发中", "已经落地"];

export const REQ_STATUS_FORWARD = { "待分析": "待RAT决策", "待RAT决策": "开发中", "开发中": "已经落地" };

export const REQ_STATUS_BACKWARD = { "待RAT决策": "待分析", "开发中": "待RAT决策", "已经落地": "开发中" };

export let _reqSearchDebounceTimer = null;

export const REQ_SEARCH_DEBOUNCE_MS = 400;

export async function fetchReqList() {
  const op = getCurrentOperator();
  state.reqListLoading = true;
  requestRender();
  try {
    const scope = state.reqTab === "mine" ? "mine" : state.reqTab === "assigned" ? "assigned" : "all";
    const q = state.reqSearch.trim();
    const r = await fetch(
      `${API_BASE_URL}/api/requirements?operator_id=${encodeURIComponent(op.account)}&scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}&page=${state.reqListPage}&page_size=${state.reqListPageSize}`
    );
    if (!r.ok) {
      state.reqList = [];
      state.reqListTotal = 0;
      return;
    }
    const j = await r.json();
    state.reqList = Array.isArray(j.items) ? j.items : [];
    state.reqListTotal = j.total || 0;
  } catch (_) {
    state.reqList = [];
    state.reqListTotal = 0;
  } finally {
    state.reqListLoading = false;
    state.reqListLoaded = true;
    requestRender();
  }
}

export async function fetchReqDetail(id) {
  const op = getCurrentOperator();
  state.reqDetailLoading = true;
  state.reqDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/requirements/${id}?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.reqDetailBundle = null;
      return;
    }
    state.reqDetailBundle = await r.json();
  } catch (_) {
    state.reqDetailBundle = null;
  } finally {
    state.reqDetailLoading = false;
    requestRender();
  }
}

export async function fetchReqDetailLogs(id) {
  const op = getCurrentOperator();
  state.reqDetailLogsLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/requirements/${id}/logs?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.reqDetailLogs = [];
      return;
    }
    const j = await r.json();
    state.reqDetailLogs = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.reqDetailLogs = [];
  } finally {
    state.reqDetailLogsLoading = false;
    requestRender();
  }
}

export function renderRequirementPage() {
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("requirement_create", "readonly", whitelist);
  const canExport = whitelistAllows("requirement_export", "readonly", whitelist);
  const canImport = whitelistAllows("requirement_import", "readonly", whitelist);
  const tabsHtml = `
    <div class="req-tabs">
      <button type="button" class="req-tab ${state.reqTab === "all" ? "active" : ""}" data-req-tab="all">全部需求</button>
      <button type="button" class="req-tab ${state.reqTab === "mine" ? "active" : ""}" data-req-tab="mine">我提出的</button>
      <button type="button" class="req-tab ${state.reqTab === "assigned" ? "active" : ""}" data-req-tab="assigned">我负责的</button>
      <button type="button" class="req-tab ${state.reqTab === "analytics" ? "active" : ""}" data-req-tab="analytics">📊 分析</button>
    </div>`;
  const toolbarRightHtml = `
<div class="req-toolbar-right">
  ${canImport ? `<button type="button" class="action" id="req-download-template-btn">下载模板</button>` : ""}
  ${canImport ? `<button type="button" class="action" id="req-import-btn" ${state.reqImportLoading ? "disabled" : ""}>${state.reqImportLoading ? "导入中…" : "导入"}</button>` : ""}
  ${canExport ? `<button type="button" class="action" id="req-export-btn" ${state.reqExportLoading ? "disabled" : ""}>${state.reqExportLoading ? "导出中…" : "导出"}</button>` : ""}
  ${canCreate ? '<button type="button" class="action primary" id="req-create-btn">新建</button>' : ""}
</div>`;
  if (state.reqTab === "analytics") {
    return `
    <section class="req-wrap" id="req-management-panel">
      <div class="req-toolbar">
        ${tabsHtml}
        ${renderReqAnalyticsFiltersHtml()}
      </div>
      ${renderReqAnalyticsBodyHtml()}
    </section>`;
  }
  const pageSize = Number(state.reqListPageSize) > 0 ? Number(state.reqListPageSize) : 10;
  const totalItems = Number(state.reqListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.reqListPage) || 1), totalPages);
  if (currentPage !== state.reqListPage) state.reqListPage = currentPage;
  const rows = (state.reqList || [])
    .map((it, idx) => {
      const issues = Array.isArray(it.related_issues) ? it.related_issues.join(", ") : "";
      const pClass = priorityBadgeClass(it.priority);
      const cClass = categoryBadgeClass(it.category || "其他");
      const vClass = valueBadgeClass(it.value || "质量加固");
      return `<tr class="req-row" data-req-id="${it.id}">
        <td>${(currentPage - 1) * pageSize + idx + 1}</td>
        <td>${escapeHtml(String(it.requirement_no || ""))}</td>
        <td class="req-title-cell">${escapeHtml(String(it.title || ""))}</td>
        <td>${escapeHtml(String(it.proposer || ""))}</td>
        <td>${escapeHtml(String(it.assignee || ""))}</td>
        <td><span class="p ${pClass}">${it.priority}</span></td>
        <td><span class="cat-tag ${cClass}">${escapeHtml(String(it.category || "其他"))}</span></td>
        <td><span class="val-tag ${vClass}">${escapeHtml(String(it.value || "质量加固"))}</span></td>
        <td>${escapeHtml(String(it.status || ""))}</td>
        <td>${escapeHtml(String(it.planned_version || ""))}</td>
        <td class="req-nowrap">${formatReqDate(it.planned_date)}</td>
      </tr>`;
    })
    .join("");
  const empty = `<tr><td colspan="11" class="req-empty">${state.reqListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  const sizeOptions = [10, 20, 50, 100]
    .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
    .join("");
  const paginationHtml = `
    <div id="req-list-pagination" class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${totalItems} 条，第 ${currentPage}/${totalPages} 页</span>
        <label class="list-pagination-size">
          <span class="list-pagination-size-text">每页</span>
          <select id="req-page-size" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
          <span class="list-pagination-size-suffix">条</span>
        </label>
        <div class="list-pagination-nav">
          <button class="action list-page-btn" type="button" id="req-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="action list-page-btn" type="button" id="req-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
    </div>`;
  return `
    <section class="req-wrap" id="req-management-panel">
      <div class="req-toolbar">
        ${tabsHtml}
        <div class="req-search">
          <input type="search" id="req-search-input" class="req-search-input" placeholder="搜索编号、标题、描述、提出人、责任人、分类、价值等" value="${escapeAttr(state.reqSearch)}" />
        </div>
        ${toolbarRightHtml}
      </div>
      <div class="req-table-card">
        <table class="req-table">
          <thead>
            <tr>
              <th>序号</th><th>需求编号</th><th>标题</th><th>提出人</th><th>责任人</th><th>优先级</th><th>需求分类</th><th>需求价值</th><th>状态</th><th>计划版本</th><th>计划日期</th>
            </tr>
          </thead>
          <tbody>${state.reqList.length ? rows : empty}</tbody>
        </table>
        ${paginationHtml}
      </div>
    </section>`;
}

export const REQ_ANALYTICS_PRESETS = [
  { key: "1w", label: "近1周", days: 7 },
  { key: "1m", label: "近1月", days: 30 },
  { key: "3m", label: "近3月", days: 90 },
  { key: "custom", label: "自定义", days: 0 },
];

export function reqAnalyticsDateBounds() {
  const preset = REQ_ANALYTICS_PRESETS.find((p) => p.key === state.reqAnalyticsPreset);
  const today = new Date();
  let start, end;
  if (preset && preset.days > 0) {
    end = today;
    start = new Date(today);
    start.setDate(start.getDate() - preset.days);
  } else {
    start = state.reqAnalyticsStart ? new Date(state.reqAnalyticsStart) : new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    end = state.reqAnalyticsEnd ? new Date(state.reqAnalyticsEnd) : today;
  }
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

export async function fetchReqAnalytics() {
  const { start, end } = reqAnalyticsDateBounds();
  state.reqAnalyticsLoading = true;
  state.reqAnalyticsData = null;
  requestRender();
  try {
    const params = new URLSearchParams({
      operator_id: state.currentUser || "",
      start_date: formatYmdLocal(start),
      end_date: formatYmdLocal(end),
      precision: state.reqAnalyticsPrecision,
    });
    const resp = await fetch(`/api/requirements/analytics?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      state.reqAnalyticsData = { error: err.detail || `HTTP ${resp.status}` };
    } else {
      state.reqAnalyticsData = await resp.json();
    }
  } catch (e) {
    state.reqAnalyticsData = { error: String(e) };
  } finally {
    state.reqAnalyticsLoading = false;
    requestRender();
  }
}

export function renderReqAnalyticsFiltersHtml() {
  const presetBtns = REQ_ANALYTICS_PRESETS.map((p) => `<button type="button" class="req-tab ${state.reqAnalyticsPreset === p.key ? "active" : ""}" data-req-analytics-preset="${p.key}">${p.label}</button>`).join("");
  const customRow = state.reqAnalyticsPreset === "custom"
    ? `<span class="req-analytics-date-row stats-labor-date-range-wrap">
        ${renderDateRangeHtml({
          id: "req-analytics-custom",
          startYmd: state.reqAnalyticsStart,
          endYmd: state.reqAnalyticsEnd,
          className: "date-range--inline",
        })}
      </span>`
    : "";
  const precBtns = `<span class="req-analytics-prec-row">
    <button type="button" class="req-tab ${state.reqAnalyticsPrecision === "week" ? "active" : ""}" data-req-analytics-prec="week">按周</button>
    <button type="button" class="req-tab ${state.reqAnalyticsPrecision === "month" ? "active" : ""}" data-req-analytics-prec="month">按月</button>
  </span>`;
  return `<div class="req-analytics-filters">${presetBtns}${customRow}${precBtns}</div>`;
}

export function renderReqAnalyticsBodyHtml() {
  if (state.reqAnalyticsLoading) {
    return `<div class="req-analytics-loading">加载中…</div>`;
  }
  const d = state.reqAnalyticsData;
  if (!d) {
    return `<div class="req-analytics-empty">正在加载数据…</div>`;
  }
  if (d.error) {
    return `<div class="req-analytics-error">加载失败：${escapeHtml(d.error)}</div>`;
  }
  const kpi = d.kpi || {};
  const onTimeText = kpi.on_time_rate != null ? `${Math.round(kpi.on_time_rate * 100)}%` : "—";
  const avgPrio = kpi.avg_priority != null ? kpi.avg_priority : "—";
  const kpiRow = `
    <div class="req-analytics-kpi-grid">
      ${renderReqAnalyticsKpiCard("需求总数", kpi.total || 0, "")}
      ${renderReqAnalyticsKpiCard("进行中", kpi.in_progress || 0, "待分析+待RAT决策+开发中")}
      ${renderReqAnalyticsKpiCard("已落地", kpi.landed || 0, `按时落地率 ${onTimeText}`)}
      ${renderReqAnalyticsKpiCard("延期数", kpi.overdue_count || 0, "计划日期已过未落地")}
      ${renderReqAnalyticsKpiCard("平均优先级", avgPrio, "1最高 10最低")}
    </div>`;

  const sd = d.status_distribution || {};
  const statusPie = statLaborSvgPie(
    (sd.labels || []).map((l, i) => ({ label: l, value: (sd.values || [])[i] || 0 })),
    { donut: true, aria: "状态分布" }
  );
  const statusLegend = statLaborPieLegend(
    (sd.labels || []).map((l, i) => ({ label: l, value: (sd.values || [])[i] || 0 }))
  );

  const cd = d.category_distribution || {};
  const categoryPie = statLaborSvgPie(
    (cd.labels || []).map((l, i) => ({ label: l, value: (cd.values || [])[i] || 0 })),
    { donut: true, aria: "需求分类分布" }
  );
  const categoryLegend = statLaborPieLegend(
    (cd.labels || []).map((l, i) => ({ label: l, value: (cd.values || [])[i] || 0 }))
  );

  const vd = d.value_distribution || {};
  const valueItems = (vd.labels || []).map((l, i) => ({ name: l, count: (vd.values || [])[i] || 0 }));
  const valueBar = renderReqAnalyticsHorizontalBar(valueItems, { aria: "需求价值分布" });

  const distSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">分布总览</h2>
      <div class="req-analytics-dist-grid">
        <div class="req-analytics-dist-col">
          <h3>状态分布</h3>
          <div class="req-analytics-chart-center">${statusPie}${statusLegend}</div>
        </div>
        <div class="req-analytics-dist-col">
          <h3>需求分类</h3>
          <div class="req-analytics-chart-center">${categoryPie}${categoryLegend}</div>
        </div>
        <div class="req-analytics-dist-col">
          <h3>需求价值</h3>
          ${valueBar}
        </div>
      </div>
    </div>`;

  const pd = d.priority_distribution || {};
  const prioGroups = pd.groups || [];
  const prioLabels = prioGroups.map((g) => g.label);
  const prioValues = prioGroups.map((g) => g.count);
  const prioBar = statLaborSvgBarVertical(prioLabels, prioValues, { aria: "优先级分布" });
  const prioDetailRows = prioGroups.map((g) => {
    const detail = (g.items || []).map((v, i) => `P${i + (g.label.includes("P1") ? 1 : g.label.includes("P4") ? 4 : 7)}:${v}`).join("  ");
    return `<div class="req-analytics-prio-detail"><strong>${escapeHtml(g.label)}</strong>: ${g.count} 个 (${detail})</div>`;
  }).join("");
  const prioSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">优先级分布</h2>
      <div class="req-analytics-chart-row">${prioBar}</div>
      ${prioDetailRows}
    </div>`;

  const tr = d.trend || {};
  const trendLabels = tr.labels || [];
  const trendCreated = tr.created || [];
  const trendChanged = tr.status_changed || [];
  const trendLanded = tr.landed || [];
  const trendMax = Math.max(1, ...trendCreated, ...trendChanged, ...trendLanded);
  const trendMulti = statLaborSvgMultiLine(trendLabels, [
    { name: "新建", values: trendCreated, stroke: STAT_LABOR_CHART_COLORS[0] },
    { name: "状态变更", values: trendChanged, stroke: STAT_LABOR_CHART_COLORS[4] },
    { name: "已落地", values: trendLanded, stroke: STAT_LABOR_CHART_COLORS[9] },
  ], { aria: "需求趋势", maxHint: trendMax });
  const trendSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">趋势分析</h2>
      <div class="req-analytics-trend-legend">
        <span style="color:${STAT_LABOR_CHART_COLORS[0]}">● 新建</span>
        <span style="color:${STAT_LABOR_CHART_COLORS[4]}">● 状态变更</span>
        <span style="color:${STAT_LABOR_CHART_COLORS[9]}">● 已落地</span>
      </div>
      <div class="req-analytics-chart-row">${trendMulti}</div>
    </div>`;

  const pl = d.person_load || {};
  const proposerBar = renderReqAnalyticsHorizontalBar(pl.top_proposers || [], { aria: "提出人Top10" });
  const assigneeBar = renderReqAnalyticsHorizontalBar(pl.top_assignees || [], { aria: "责任人Top10" });
  const personSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">人员负载</h2>
      <div class="req-analytics-person-grid">
        <div class="req-analytics-person-col"><h3>提出人 Top10</h3>${proposerBar}</div>
        <div class="req-analytics-person-col"><h3>责任人 Top10</h3>${assigneeBar}</div>
      </div>
    </div>`;

  const vp = d.version_plan || {};
  const byVersion = vp.by_version || [];
  const overdueDetails = vp.overdue_details || [];
  let versionSection = "";
  if (byVersion.length > 0) {
    const versionBar = statLaborSvgStackedBars(
      byVersion,
      ["已落地", "进行中", "延期"],
      (gi, key) => {
        const v = byVersion[gi];
        if (key === "已落地") return v.landed;
        if (key === "延期") return v.overdue;
        return v.total - v.landed - v.overdue;
      },
      { aria: "版本计划" }
    );
    const versionTable = `<table class="req-analytics-version-table"><thead><tr><th>版本</th><th>总数</th><th>已落地</th><th>延期</th></tr></thead><tbody>${byVersion.map((v) => `<tr><td>${escapeHtml(v.version)}</td><td>${v.total}</td><td>${v.landed}</td><td class="${v.overdue > 0 ? "req-analytics-overdue" : ""}">${v.overdue}</td></tr>`).join("")}</tbody></table>`;
    versionSection = `
      <div class="req-analytics-block">
        <h2 class="req-analytics-h2">版本计划</h2>
        <div class="req-analytics-chart-row">${versionBar}</div>
        ${versionTable}
      </div>`;
  }
  let overdueSection = "";
  if (overdueDetails.length > 0) {
    const rows = overdueDetails.map((r) => `<tr><td>${escapeHtml(r.requirement_no)}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.planned_date)}</td><td>${escapeHtml(r.status)}</td></tr>`).join("");
    overdueSection = `
      <div class="req-analytics-block">
        <h2 class="req-analytics-h2">延期明细</h2>
        <table class="req-analytics-version-table"><thead><tr><th>需求编号</th><th>标题</th><th>计划日期</th><th>当前状态</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  }

  return `
    <div class="req-analytics-page">
      ${kpiRow}
      ${distSection}
      ${prioSection}
      ${trendSection}
      ${personSection}
      ${versionSection}
      ${overdueSection}
    </div>`;
}

export function bindReqAnalyticsPage() {
  document.querySelectorAll("[data-req-analytics-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-req-analytics-preset");
      if (!k) return;
      state.reqAnalyticsPreset = k;
      fetchReqAnalytics();
    });
  });
  document.querySelectorAll("[data-req-analytics-prec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-req-analytics-prec");
      if (!k) return;
      state.reqAnalyticsPrecision = k;
      fetchReqAnalytics();
    });
  });
  if (state.reqAnalyticsPreset === "custom") {
    bindDateRangePicker({
      id: "req-analytics-custom",
      getRange: () => ({
        start: state.reqAnalyticsStart,
        end: state.reqAnalyticsEnd,
      }),
      setRange: (start, end) => {
        state.reqAnalyticsStart = start;
        state.reqAnalyticsEnd = end;
        state.reqAnalyticsPreset = "custom";
      },
      onApplied: () => {
        fetchReqAnalytics();
      },
      requestRender,
    });
  }
}

export function renderRequirementModalsHtml() {
  const createOpen = state.reqCreateOpen
    ? (() => {
        const issueRows = (state.reqDraftRelatedIssues || [""])
          .map((v, i) => `<div class="req-related-issue-row">
            <input type="text" class="req-input req-related-issue-input" data-req-issue-idx="${i}" value="${escapeAttr(String(v || ""))}" placeholder="工单号或DTS单号" />
            <button type="button" class="action danger req-related-issue-del" data-req-issue-idx="${i}" ${state.reqDraftRelatedIssues.length <= 1 ? "disabled" : ""}>删除</button>
          </div>`)
          .join("");
        return `<div class="perm-modal-mask req-modal-mask" id="req-create-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>新建需求</h3></div>
          <div class="perm-modal-body req-create-body">
            <label class="req-field">需求标题 *
              <input type="text" id="req-create-title" class="req-input" placeholder="请输入需求标题" />
            </label>
            <label class="req-field">详细描述 *
              <textarea id="req-create-desc" class="req-textarea" rows="3" placeholder="请输入详细描述"></textarea>
            </label>
            <label class="req-field">需求提出人 *
              <input type="text" id="req-create-proposer" class="req-input" placeholder="例如：张三 zhangsan" />
            </label>
            <label class="req-field">需求分类 *
              <select id="req-create-category" class="req-input">
                <option value="管控需求">管控需求</option>
                <option value="内核需求">内核需求</option>
                <option value="管控和内核需求">管控和内核需求</option>
                <option value="其他" selected>其他</option>
              </select>
            </label>
            <label class="req-field">需求价值 *
              <select id="req-create-value" class="req-input">
                <option value="质量加固" selected>质量加固</option>
                <option value="性能提升">性能提升</option>
                <option value="竞争力提升">竞争力提升</option>
                <option value="定位能力提升">定位能力提升</option>
                <option value="恢复能力提升">恢复能力提升</option>
                <option value="感知能力提升">感知能力提升</option>
              </select>
            </label>
            <label class="req-field">当前责任人 *
              <input type="text" id="req-create-assignee" class="req-input" placeholder="例如：李四 lisi" />
            </label>
            <div class="req-field">
              <span>关联问题（选填）</span>
              <div id="req-create-issues">${issueRows}</div>
              <button type="button" class="action" id="req-add-issue-btn">+ 添加关联</button>
            </div>
            <label class="req-field">需求单号（选填）
              <input type="text" id="req-create-ext-no" class="req-input" placeholder="外部需求单号" />
            </label>
            <label class="req-field">计划落地版本（选填）
              <input type="text" id="req-create-version" class="req-input" placeholder="例如：V8.2.0" />
            </label>
            <label class="req-field">计划落地日期（选填）
              <input type="date" id="req-create-planned-date" class="req-input" />
            </label>
            <label class="req-field">优先级 *（1最高，10最低）
              <input type="number" id="req-create-priority" class="req-input" min="1" max="10" value="5" />
            </label>
            <label class="req-field">备注
              <textarea id="req-create-remark" class="req-textarea" rows="2" placeholder="备注信息"></textarea>
            </label>
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-create-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-create-submit-btn">提交</button>
          </div>
        </div></div>`;
      })()
    : "";

  const detail = state.reqDetailId
    ? (() => {
        const b = state.reqDetailBundle;
        const loading = state.reqDetailLoading;
        const op = getCurrentOperator();
        const isCreator = b && String(b.creator_id || "").trim() === String(op.account || "").trim();
        const canEdit = isCreator || (b && String(b.assignee || "").includes(op.account || "___"));
        const canDelete = isCreator && b && String(b.status || "").trim() === "待分析";
        const issues = Array.isArray(b?.related_issues) ? b.related_issues.join("，") : "—";
        const logRows = (state.reqDetailLogs || [])
          .map((lg) => {
            const actionLabel = String(lg.action || "") === "created" ? "创建需求" : String(lg.action || "") === "status_changed" ? "状态变更" : "编辑更新";
            const statusChange = lg.from_status && lg.to_status ? `${escapeHtml(lg.from_status)} → ${escapeHtml(lg.to_status)}` : "";
            return `<tr>
              <td>${escapeHtml(formatReqDateTime(lg.created_at))}</td>
              <td>${escapeHtml(String(lg.operator_name || ""))}</td>
              <td>${escapeHtml(actionLabel)}</td>
              <td>${statusChange}</td>
              <td>${escapeHtml(String(lg.comment || ""))}</td>
            </tr>`;
          })
          .join("");
        return `<div class="perm-modal-mask req-modal-mask" id="req-detail-mask">
        <div class="perm-modal req-modal req-detail-modal" role="dialog">
          <div class="perm-modal-head"><h3>需求详情 ${b ? escapeHtml(String(b.requirement_no || "")) : ""}</h3></div>
          <div class="perm-modal-body">
            ${loading ? "<p>加载中…</p>" : ""}
            ${
              b
                ? `<div class="req-detail-meta">
              <p><strong>状态</strong> <span class="p ${priorityBadgeClass(b.priority)}">${escapeHtml(String(b.status || ""))}</span> · <strong>优先级</strong> ${b.priority} · <strong>需求分类</strong> <span class="cat-tag ${categoryBadgeClass(b.category || "其他")}">${escapeHtml(String(b.category || "其他"))}</span> · <strong>需求价值</strong> <span class="val-tag ${valueBadgeClass(b.value || "质量加固")}">${escapeHtml(String(b.value || "质量加固"))}</span></p>
              <p><strong>需求标题</strong> ${escapeHtml(String(b.title || ""))}</p>
              <p><strong>需求提出人</strong> ${escapeHtml(String(b.proposer || ""))} · <strong>当前责任人</strong> ${escapeHtml(String(b.assignee || ""))}</p>
              <p><strong>需求单号</strong> ${escapeHtml(String(b.external_req_no || "—"))} · <strong>计划版本</strong> ${escapeHtml(String(b.planned_version || "—"))} · <strong>计划日期</strong> ${formatReqDate(b.planned_date)}</p>
              <p><strong>关联问题</strong> ${escapeHtml(issues)}</p>
              <div class="req-detail-desc"><strong>详细描述</strong><div class="req-detail-desc-content">${escapeHtml(String(b.description || ""))}</div></div>
              ${String(b.remark || "").trim() ? `<p><strong>备注</strong> ${escapeHtml(String(b.remark || ""))}</p>` : ""}
              <p><strong>创建人</strong> ${escapeHtml(String(b.creator_name || ""))} · <strong>创建时间</strong> ${formatReqDateTime(b.created_at)}</p>
            </div>
            ${
              canEdit
                ? `<div class="req-detail-actions">
              <button type="button" class="action" id="req-detail-edit-btn">编辑</button>
              ${
                REQ_STATUS_FORWARD[String(b.status || "").trim()]
                  ? `<button type="button" class="action primary" data-req-status-forward="${escapeAttr(REQ_STATUS_FORWARD[String(b.status || "").trim()])}">流转至「${REQ_STATUS_FORWARD[String(b.status || "").trim()]}」</button>`
                  : ""
              }
              ${
                REQ_STATUS_BACKWARD[String(b.status || "").trim()]
                  ? `<button type="button" class="action danger" data-req-status-backward="${escapeAttr(REQ_STATUS_BACKWARD[String(b.status || "").trim()])}">回退至「${REQ_STATUS_BACKWARD[String(b.status || "").trim()]}」</button>`
                  : ""
              }
              ${canDelete ? `<button type="button" class="action danger" id="req-detail-delete-btn">删除</button>` : ""}
            </div>`
                : ""
            }
            <h4 class="req-subhd">操作日志</h4>
            <table class="req-mini-table">
              <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>状态变更</th><th>备注</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="5" class="req-empty">暂无</td></tr>`}</tbody>
            </table>`
                : "<p>无法加载</p>"
            }
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-detail-close-btn">关闭</button>
          </div>
        </div></div>`;
      })()
    : "";

  const editOpen = state.reqEditOpen && state.reqDetailBundle
    ? (() => {
        const b = state.reqDetailBundle;
        const issueRows = (state.reqDraftRelatedIssues || [""])
          .map((v, i) => `<div class="req-related-issue-row">
            <input type="text" class="req-input req-related-issue-input" data-req-edit-issue-idx="${i}" value="${escapeAttr(String(v || ""))}" placeholder="工单号或DTS单号" />
            <button type="button" class="action danger req-edit-issue-del" data-req-edit-issue-idx="${i}" ${state.reqDraftRelatedIssues.length <= 1 ? "disabled" : ""}>删除</button>
          </div>`)
          .join("");
        return `<div class="perm-modal-mask req-modal-mask" id="req-edit-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>编辑需求</h3></div>
          <div class="perm-modal-body req-create-body">
            <label class="req-field">需求标题 *
              <input type="text" id="req-edit-title" class="req-input" value="${escapeAttr(String(b.title || ""))}" />
            </label>
            <label class="req-field">详细描述 *
              <textarea id="req-edit-desc" class="req-textarea" rows="3">${escapeHtml(String(b.description || ""))}</textarea>
            </label>
            <label class="req-field">需求提出人 *
              <input type="text" id="req-edit-proposer" class="req-input" value="${escapeAttr(String(b.proposer || ""))}" />
            </label>
            <label class="req-field">需求分类 *
              <select id="req-edit-category" class="req-input">
                <option value="管控需求" ${String(b.category || "") === "管控需求" ? "selected" : ""}>管控需求</option>
                <option value="内核需求" ${String(b.category || "") === "内核需求" ? "selected" : ""}>内核需求</option>
                <option value="管控和内核需求" ${String(b.category || "") === "管控和内核需求" ? "selected" : ""}>管控和内核需求</option>
                <option value="其他" ${String(b.category || "其他") === "其他" ? "selected" : ""}>其他</option>
              </select>
            </label>
            <label class="req-field">需求价值 *
              <select id="req-edit-value" class="req-input">
                <option value="质量加固" ${String(b.value || "质量加固") === "质量加固" ? "selected" : ""}>质量加固</option>
                <option value="性能提升" ${String(b.value || "") === "性能提升" ? "selected" : ""}>性能提升</option>
                <option value="竞争力提升" ${String(b.value || "") === "竞争力提升" ? "selected" : ""}>竞争力提升</option>
                <option value="定位能力提升" ${String(b.value || "") === "定位能力提升" ? "selected" : ""}>定位能力提升</option>
                <option value="恢复能力提升" ${String(b.value || "") === "恢复能力提升" ? "selected" : ""}>恢复能力提升</option>
                <option value="感知能力提升" ${String(b.value || "") === "感知能力提升" ? "selected" : ""}>感知能力提升</option>
              </select>
            </label>
            <label class="req-field">当前责任人 *
              <input type="text" id="req-edit-assignee" class="req-input" value="${escapeAttr(String(b.assignee || ""))}" />
            </label>
            <div class="req-field">
              <span>关联问题</span>
              <div id="req-edit-issues">${issueRows}</div>
              <button type="button" class="action" id="req-edit-add-issue-btn">+ 添加关联</button>
            </div>
            <label class="req-field">需求单号
              <input type="text" id="req-edit-ext-no" class="req-input" value="${escapeAttr(String(b.external_req_no || ""))}" />
            </label>
            <label class="req-field">计划落地版本
              <input type="text" id="req-edit-version" class="req-input" value="${escapeAttr(String(b.planned_version || ""))}" />
            </label>
            <label class="req-field">计划落地日期
              <input type="date" id="req-edit-planned-date" class="req-input" value="${escapeAttr(formatReqDate(b.planned_date))}" />
            </label>
            <label class="req-field">优先级 *（1最高，10最低）
              <input type="number" id="req-edit-priority" class="req-input" min="1" max="10" value="${b.priority || 5}" />
            </label>
            <label class="req-field">备注
              <textarea id="req-edit-remark" class="req-textarea" rows="2">${escapeHtml(String(b.remark || ""))}</textarea>
            </label>
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-edit-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-edit-submit-btn">保存</button>
          </div>
        </div></div>`;
      })()
    : "";

  const importOpen = state.reqImportModalOpen
    ? `<div class="perm-modal-mask req-modal-mask" id="req-import-mask">
      <div class="perm-modal req-modal req-import-modal" role="dialog">
        <div class="perm-modal-head"><h3>批量导入需求</h3></div>
        <div class="perm-modal-body">
          <p class="req-import-hint">请先下载模板，填写需求信息后上传。</p>
          <div class="req-import-upload-area">
            <input type="file" id="req-import-file" class="req-import-file-input" accept=".xlsx" />
            <div class="req-import-upload-hint">
              <span id="req-import-file-name">${state.reqImportFileName || "点击选择或拖拽文件"}</span>
            </div>
          </div>
          <div id="req-import-errors" class="req-import-errors"></div>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="req-import-cancel-btn">取消</button>
          <button type="button" class="action primary" id="req-import-submit-btn" ${state.reqImportLoading ? "disabled" : ""}>${state.reqImportLoading ? "导入中…" : "确认导入"}</button>
        </div>
      </div></div>`
    : "";

  return createOpen + detail + editOpen + importOpen;
}

export function bindRequirementPage() {
  if (state.reqNeedsRefresh || (!state.reqListLoaded && !state.reqListLoading)) {
    state.reqNeedsRefresh = false;
    void fetchReqList();
  }
  document.querySelectorAll("[data-req-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-req-tab");
      if (t !== "all" && t !== "mine" && t !== "assigned" && t !== "analytics") return;
      state.reqTab = t;
      state.reqListPage = 1;
      if (t === "analytics") {
        if (!state.reqAnalyticsData) fetchReqAnalytics();
        requestRender();
        bindReqAnalyticsPage();
        return;
      }
      requestRender();
      void fetchReqList();
    });
  });
  const searchInp = document.getElementById("req-search-input");
  const scheduleSearch = () => {
    if (_reqSearchDebounceTimer) clearTimeout(_reqSearchDebounceTimer);
    _reqSearchDebounceTimer = setTimeout(() => {
      _reqSearchDebounceTimer = null;
      void fetchReqList();
    }, REQ_SEARCH_DEBOUNCE_MS);
  };
  searchInp?.addEventListener("input", (ev) => {
    state.reqSearch = searchInp.value || "";
    state.reqListPage = 1;
    if (ev.isComposing) return;
    scheduleSearch();
  });
  searchInp?.addEventListener("compositionend", () => {
    state.reqSearch = searchInp.value || "";
    state.reqListPage = 1;
    scheduleSearch();
  });
  searchInp?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    if (_reqSearchDebounceTimer) {
      clearTimeout(_reqSearchDebounceTimer);
      _reqSearchDebounceTimer = null;
    }
    state.reqSearch = searchInp.value || "";
    state.reqListPage = 1;
    void fetchReqList();
  });
  const pageSizeSelect = document.getElementById("req-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      state.reqListPageSize = Number(pageSizeSelect.value) || 10;
      state.reqListPage = 1;
      void fetchReqList();
    });
  }
  const prevBtn = document.getElementById("req-page-prev");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      const pageSize = Number(state.reqListPageSize) || 10;
      const totalItems = Number(state.reqListTotal) || 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      state.reqListPage = Math.max(1, state.reqListPage - 1);
      void fetchReqList();
    });
  }
  const nextBtn = document.getElementById("req-page-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const pageSize = Number(state.reqListPageSize) || 10;
      const totalItems = Number(state.reqListTotal) || 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      state.reqListPage = Math.min(totalPages, state.reqListPage + 1);
      void fetchReqList();
    });
  }
  document.getElementById("req-create-btn")?.addEventListener("click", () => {
    state.reqDraftRelatedIssues = [""];
    state.reqCreateOpen = true;
    requestRender();
  });
  document.getElementById("req-create-cancel-btn")?.addEventListener("click", () => {
    state.reqCreateOpen = false;
    requestRender();
  });
  document.getElementById("req-create-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-create-mask")) {
      state.reqCreateOpen = false;
      requestRender();
    }
  });
  document.getElementById("req-add-issue-btn")?.addEventListener("click", () => {
    state.reqDraftRelatedIssues.push("");
    requestRender();
  });
  document.querySelectorAll(".req-related-issue-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-req-issue-idx") || "-1", 10);
      if (idx >= 0 && state.reqDraftRelatedIssues.length > 1) {
        state.reqDraftRelatedIssues.splice(idx, 1);
        requestRender();
      }
    });
  });
  document.getElementById("req-create-submit-btn")?.addEventListener("click", async () => {
    const title = (document.getElementById("req-create-title")?.value || "").trim();
    const desc = (document.getElementById("req-create-desc")?.value || "").trim();
    const proposer = (document.getElementById("req-create-proposer")?.value || "").trim();
    const category = (document.getElementById("req-create-category")?.value || "其他").trim();
    const reqValue = (document.getElementById("req-create-value")?.value || "质量加固").trim();
    const assignee = (document.getElementById("req-create-assignee")?.value || "").trim();
    const extNo = (document.getElementById("req-create-ext-no")?.value || "").trim();
    const version = (document.getElementById("req-create-version")?.value || "").trim();
    const plannedDate = (document.getElementById("req-create-planned-date")?.value || "").trim();
    const priority = parseInt(document.getElementById("req-create-priority")?.value || "5", 10);
    const remark = (document.getElementById("req-create-remark")?.value || "").trim();
    document.querySelectorAll(".req-related-issue-input").forEach((inp, i) => {
      state.reqDraftRelatedIssues[i] = inp.value || "";
    });
    const relatedIssues = state.reqDraftRelatedIssues.filter((v) => v.trim());
    if (!title) { window.alert("需求标题不能为空"); return; }
    if (!desc) { window.alert("详细描述不能为空"); return; }
    if (!proposer) { window.alert("需求提出人不能为空"); return; }
    if (!assignee) { window.alert("当前责任人不能为空"); return; }
    if (priority < 1 || priority > 10) { window.alert("优先级须为1-10"); return; }
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          title, description: desc, proposer, assignee, category, value: reqValue,
          related_issues: relatedIssues,
          external_req_no: extNo, planned_version: version,
          planned_date: plannedDate || null,
          priority, remark,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`创建失败：${t.slice(0, 200)}`);
        return;
      }
      state.reqCreateOpen = false;
      await fetchReqList();
    } catch (e) {
      window.alert(`创建失败：${String(e.message || e)}`);
    }
  });
  document.querySelector("#req-management-panel .req-table tbody")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.req-row");
    if (!tr) return;
    const id = parseInt(tr.getAttribute("data-req-id") || "-1", 10);
    if (!Number.isFinite(id) || id < 0) return;
    state.reqDetailId = id;
    void fetchReqDetail(id);
    void fetchReqDetailLogs(id);
  });
  document.getElementById("req-detail-close-btn")?.addEventListener("click", () => {
    state.reqDetailId = null;
    state.reqDetailBundle = null;
    state.reqDetailLogs = [];
    state.reqEditOpen = false;
    requestRender();
  });
  document.getElementById("req-detail-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-detail-mask")) {
      state.reqDetailId = null;
      state.reqDetailBundle = null;
      state.reqDetailLogs = [];
      state.reqEditOpen = false;
      requestRender();
    }
  });
  document.getElementById("req-detail-edit-btn")?.addEventListener("click", () => {
    if (!state.reqDetailBundle) return;
    const b = state.reqDetailBundle;
    state.reqDraftRelatedIssues = Array.isArray(b.related_issues) && b.related_issues.length > 0 ? [...b.related_issues] : [""];
    state.reqEditOpen = true;
    requestRender();
  });
  document.getElementById("req-edit-cancel-btn")?.addEventListener("click", () => {
    state.reqEditOpen = false;
    requestRender();
  });
  document.getElementById("req-edit-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-edit-mask")) {
      state.reqEditOpen = false;
      requestRender();
    }
  });
  document.getElementById("req-edit-add-issue-btn")?.addEventListener("click", () => {
    state.reqDraftRelatedIssues.push("");
    requestRender();
  });
  document.querySelectorAll(".req-edit-issue-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-req-edit-issue-idx") || "-1", 10);
      if (idx >= 0 && state.reqDraftRelatedIssues.length > 1) {
        state.reqDraftRelatedIssues.splice(idx, 1);
        requestRender();
      }
    });
  });
  document.getElementById("req-edit-submit-btn")?.addEventListener("click", async () => {
    if (!state.reqDetailBundle) return;
    const b = state.reqDetailBundle;
    const title = (document.getElementById("req-edit-title")?.value || "").trim();
    const desc = (document.getElementById("req-edit-desc")?.value || "").trim();
    const proposer = (document.getElementById("req-edit-proposer")?.value || "").trim();
    const category = (document.getElementById("req-edit-category")?.value || "其他").trim();
    const reqValue = (document.getElementById("req-edit-value")?.value || "质量加固").trim();
    const assignee = (document.getElementById("req-edit-assignee")?.value || "").trim();
    const extNo = (document.getElementById("req-edit-ext-no")?.value || "").trim();
    const version = (document.getElementById("req-edit-version")?.value || "").trim();
    const plannedDate = (document.getElementById("req-edit-planned-date")?.value || "").trim();
    const priority = parseInt(document.getElementById("req-edit-priority")?.value || "5", 10);
    const remark = (document.getElementById("req-edit-remark")?.value || "").trim();
    document.querySelectorAll(".req-related-issue-input").forEach((inp, i) => {
      state.reqDraftRelatedIssues[i] = inp.value || "";
    });
    const relatedIssues = state.reqDraftRelatedIssues.filter((v) => v.trim());
    if (!title) { window.alert("需求标题不能为空"); return; }
    if (!desc) { window.alert("详细描述不能为空"); return; }
    if (!proposer) { window.alert("需求提出人不能为空"); return; }
    if (!assignee) { window.alert("当前责任人不能为空"); return; }
    if (priority < 1 || priority > 10) { window.alert("优先级须为1-10"); return; }
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          title, description: desc, proposer, assignee, category, value: reqValue,
          related_issues: relatedIssues,
          external_req_no: extNo, planned_version: version,
          planned_date: plannedDate || null,
          priority, remark,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`保存失败：${t.slice(0, 200)}`);
        return;
      }
      state.reqEditOpen = false;
      await fetchReqDetail(b.id);
      await fetchReqDetailLogs(b.id);
      await fetchReqList();
    } catch (e) {
      window.alert(`保存失败：${String(e.message || e)}`);
    }
  });
  document.querySelectorAll("[data-req-status-forward]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.reqDetailBundle) return;
      const newStatus = btn.getAttribute("data-req-status-forward");
      if (!newStatus) return;
      if (!window.confirm(`确定流转至「${newStatus}」？`)) return;
      const op = getCurrentOperator();
      try {
        const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, status: newStatus }),
        });
        if (!r.ok) {
          const t = await r.text();
          window.alert(`流转失败：${t.slice(0, 200)}`);
          return;
        }
        await fetchReqDetail(state.reqDetailBundle.id);
        await fetchReqDetailLogs(state.reqDetailBundle.id);
        await fetchReqList();
      } catch (e) {
        window.alert(`流转失败：${String(e.message || e)}`);
      }
    });
  });
  document.querySelectorAll("[data-req-status-backward]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.reqDetailBundle) return;
      const newStatus = btn.getAttribute("data-req-status-backward");
      if (!newStatus) return;
      if (!window.confirm(`确定回退至「${newStatus}」？`)) return;
      const op = getCurrentOperator();
      try {
        const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, status: newStatus }),
        });
        if (!r.ok) {
          const t = await r.text();
          window.alert(`回退失败：${t.slice(0, 200)}`);
          return;
        }
        await fetchReqDetail(state.reqDetailBundle.id);
        await fetchReqDetailLogs(state.reqDetailBundle.id);
        await fetchReqList();
      } catch (e) {
        window.alert(`回退失败：${String(e.message || e)}`);
      }
    });
  });
  document.getElementById("req-detail-delete-btn")?.addEventListener("click", async () => {
    if (!state.reqDetailBundle) return;
    if (!window.confirm("确定删除此需求？仅「待分析」状态可删除。")) return;
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}?operator_id=${encodeURIComponent(op.account)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`删除失败：${t.slice(0, 200)}`);
        return;
      }
      state.reqDetailId = null;
      state.reqDetailBundle = null;
      state.reqDetailLogs = [];
      await fetchReqList();
    } catch (e) {
      window.alert(`删除失败：${String(e.message || e)}`);
    }
  });
  // 下载模板按钮
  document.getElementById("req-download-template-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/requirements/import-template?operator_id=${encodeURIComponent(op.account)}`);
      if (!resp.ok) {
        const text = await resp.text();
        if (resp.status === 403) {
          window.alert("无导入权限");
        } else {
          window.alert(`下载模板失败：${text.slice(0, 200)}`);
        }
        return;
      }
      const disposition = resp.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"/g, "")) : "需求导入模板.xlsx";

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`下载模板失败：${String(e.message || e)}`);
    }
  });
  // 导入按钮
  document.getElementById("req-import-btn")?.addEventListener("click", () => {
    state.reqImportModalOpen = true;
    state.reqImportFileName = "";
    requestRender();
  });
  // 导出按钮
  document.getElementById("req-export-btn")?.addEventListener("click", async () => {
    if (state.reqExportLoading) return;
    const op = getCurrentOperator();
    state.reqExportLoading = true;
    requestRender();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/requirements/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        if (resp.status === 403) {
          window.alert("无导出权限");
        } else {
          window.alert(`导出失败：${text.slice(0, 200)}`);
        }
        return;
      }
      // 获取文件名
      const disposition = resp.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : "需求导出.xlsx";

      // 下载文件
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`导出失败：${String(e.message || e)}`);
    } finally {
      state.reqExportLoading = false;
      requestRender();
    }
  });
  // 导入弹窗交互
  document.getElementById("req-import-cancel-btn")?.addEventListener("click", () => {
    state.reqImportModalOpen = false;
    state.reqImportFileName = "";
    requestRender();
  });
  document.getElementById("req-import-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-import-mask")) {
      state.reqImportModalOpen = false;
      state.reqImportFileName = "";
      requestRender();
    }
  });
  const importFileInput = document.getElementById("req-import-file");
  const fileNameSpan = document.getElementById("req-import-file-name");
  if (importFileInput) {
    importFileInput.addEventListener("change", () => {
      const file = importFileInput.files?.[0];
      if (file) {
        if (!file.name.toLowerCase().endsWith(".xlsx")) {
          window.alert("仅支持 .xlsx 格式文件");
          importFileInput.value = "";
          if (fileNameSpan) fileNameSpan.textContent = "点击选择或拖拽文件";
          state.reqImportFileName = "";
          return;
        }
        state.reqImportFileName = file.name;
        if (fileNameSpan) fileNameSpan.textContent = file.name;
      }
    });
  }
  document.getElementById("req-import-submit-btn")?.addEventListener("click", async () => {
    const fileInput = document.getElementById("req-import-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      window.alert("请选择文件");
      return;
    }
    const op = getCurrentOperator();
    state.reqImportLoading = true;
    requestRender();
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("operator_id", op.account);
      const resp = await fetch(`${API_BASE_URL}/api/requirements/import`, {
        method: "POST",
        body: formData,
      });
      const text = await resp.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { detail: text };
      }
      if (!resp.ok) {
        if (resp.status === 403) {
          window.alert("无导入权限");
        } else if (body.error_type === "validation_failed" && body.errors) {
          const errorsDiv = document.getElementById("req-import-errors");
          if (errorsDiv) {
            const errorHtml = body.errors.map((e) =>
              `<div class="req-import-error-item">第${e.row}行 · ${e.field}：${escapeHtml(e.message)}</div>`
            ).join("");
            errorsDiv.innerHTML = errorHtml;
          }
        } else {
          window.alert(`导入失败：${body.detail || text.slice(0, 200)}`);
        }
        return;
      }
      state.reqImportModalOpen = false;
      state.reqImportFileName = "";
      state.reqImportLoading = false;
      requestRender();
      window.alert(body.message || "导入成功");
      await fetchReqList();
    } catch (e) {
      window.alert(`导入失败：${String(e.message || e)}`);
    } finally {
      state.reqImportLoading = false;
      requestRender();
    }
  });
  if (state.reqTab === "analytics") {
    bindReqAnalyticsPage();
  }
}
