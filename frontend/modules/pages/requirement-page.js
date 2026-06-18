import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { priorityBadgeClass, categoryBadgeClass, statusBadgeClass, formatYmdLocal, formatReqDateTime } from "../utils/format.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { bindDateRangePicker, renderDateRangeHtml } from "../ui/date-range-picker-bind.js";
import { renderReqAnalyticsKpiCard, renderReqAnalyticsHorizontalBar } from "./requirement.js";
import { statLaborSvgPie, statLaborPieLegend, statLaborSvgBarVertical, statLaborSvgMultiLine, STAT_LABOR_CHART_COLORS } from "./stats.js";

// 质量改进枚举（与后端 / 迁移 0083 保持一致）
export const REQ_CATEGORIES = ["定位定界", "测试加固", "快速恢复", "需求", "质量加固和改进"];
export const REQ_PRIORITIES = ["高", "中", "低"];
export const REQ_STATUSES = ["待评审", "已实现", "已接纳", "部分接纳", "拒绝"];

// 列表/表单字段列（编号单独首列）
const REQ_COLUMNS = [
  { key: "category", label: "分类", tag: "cat" },
  { key: "represent_issue", label: "代表问题" },
  { key: "domain", label: "所属领域" },
  { key: "module_feature", label: "模块&特性" },
  { key: "description", label: "问题描述" },
  { key: "improvement", label: "改进诉求" },
  { key: "priority", label: "优先级", tag: "p" },
  { key: "proposer", label: "提出人" },
  { key: "proposed_at", label: "提出时间" },
  { key: "status", label: "接纳状态", tag: "st" },
  { key: "planned_version", label: "计划版本" },
];

export let _reqSearchDebounceTimer = null;
export const REQ_SEARCH_DEBOUNCE_MS = 400;

export async function fetchReqList() {
  const op = getCurrentOperator();
  state.reqListLoading = true;
  requestRender();
  try {
    const scope = state.reqTab === "mine" ? "mine" : "all";
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
    state.reqDetailBundle = r.ok ? await r.json() : null;
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
    const j = r.ok ? await r.json() : { items: [] };
    state.reqDetailLogs = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.reqDetailLogs = [];
  } finally {
    state.reqDetailLogsLoading = false;
    requestRender();
  }
}

function reqCellHtml(it, col) {
  const v = String(it[col.key] != null ? it[col.key] : "");
  if (col.tag === "cat") return `<span class="cat-tag ${categoryBadgeClass(v)}">${escapeHtml(v)}</span>`;
  if (col.tag === "p") return `<span class="p ${priorityBadgeClass(v)}">${escapeHtml(v)}</span>`;
  if (col.tag === "st") return `<span class="st-tag ${statusBadgeClass(v)}">${escapeHtml(v)}</span>`;
  return escapeHtml(v);
}

export function renderRequirementPage() {
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("requirement_create", "readonly", whitelist);
  const canExport = whitelistAllows("requirement_export", "readonly", whitelist);
  const canImport = whitelistAllows("requirement_import", "readonly", whitelist);
  const tabsHtml = `
    <div class="req-tabs">
      <button type="button" class="req-tab ${state.reqTab === "all" ? "active" : ""}" data-req-tab="all">全部</button>
      <button type="button" class="req-tab ${state.reqTab === "mine" ? "active" : ""}" data-req-tab="mine">我提出的</button>
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
  const colCount = REQ_COLUMNS.length + 1;
  const rows = (state.reqList || [])
    .map((it) => {
      const cells = REQ_COLUMNS.map((c) => `<td class="req-col-${c.key}">${reqCellHtml(it, c)}</td>`).join("");
      return `<tr class="req-row" data-req-id="${it.id}">
        <td class="req-col-no">${escapeHtml(String(it.requirement_no || ""))}</td>
        ${cells}
      </tr>`;
    })
    .join("");
  const empty = `<tr><td colspan="${colCount}" class="req-empty">${state.reqListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  const sizeOptions = [10, 20, 50, 100]
    .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
    .join("");
  const headHtml = `<th class="req-col-no">编号</th>` + REQ_COLUMNS.map((c) => `<th class="req-col-${c.key}">${escapeHtml(c.label)}</th>`).join("");
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
          <input type="search" id="req-search-input" class="req-search-input" placeholder="搜索编号、分类、代表问题、领域、模块、描述、改进诉求、提出人、状态等" value="${escapeAttr(state.reqSearch)}" />
        </div>
        ${toolbarRightHtml}
      </div>
      <div class="req-table-card">
        <table class="req-table req-table--full">
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${state.reqList.length ? rows : empty}</tbody>
        </table>
        ${paginationHtml}
      </div>
    </section>`;
}

// ---------- 分析看板 ----------

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
    start = state.reqAnalyticsStart ? new Date(state.reqAnalyticsStart) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90);
    end = state.reqAnalyticsEnd ? new Date(state.reqAnalyticsEnd) : today;
  }
  return { start, end };
}

export async function fetchReqAnalytics() {
  const { start, end } = reqAnalyticsDateBounds();
  state.reqAnalyticsLoading = true;
  state.reqAnalyticsData = null;
  requestRender();
  try {
    const op = getCurrentOperator();
    const params = new URLSearchParams({
      operator_id: op.account || "",
      start_date: formatYmdLocal(start),
      end_date: formatYmdLocal(end),
      precision: state.reqAnalyticsPrecision,
    });
    const resp = await fetch(`${API_BASE_URL}/api/requirements/analytics?${params}`);
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
        ${renderDateRangeHtml({ id: "req-analytics-custom", startYmd: state.reqAnalyticsStart, endYmd: state.reqAnalyticsEnd, className: "date-range--inline" })}
      </span>`
    : "";
  const precBtns = `<span class="req-analytics-prec-row">
    <button type="button" class="req-tab ${state.reqAnalyticsPrecision === "week" ? "active" : ""}" data-req-analytics-prec="week">按周</button>
    <button type="button" class="req-tab ${state.reqAnalyticsPrecision === "month" ? "active" : ""}" data-req-analytics-prec="month">按月</button>
  </span>`;
  return `<div class="req-analytics-filters">${presetBtns}${customRow}${precBtns}</div>`;
}

export function renderReqAnalyticsBodyHtml() {
  if (state.reqAnalyticsLoading) return `<div class="req-analytics-loading">加载中…</div>`;
  const d = state.reqAnalyticsData;
  if (!d) return `<div class="req-analytics-empty">正在加载数据…</div>`;
  if (d.error) return `<div class="req-analytics-error">加载失败：${escapeHtml(d.error)}</div>`;
  const kpi = d.kpi || {};
  const kpiRow = `
    <div class="req-analytics-kpi-grid">
      ${renderReqAnalyticsKpiCard("质量改进总数", kpi.total || 0, "")}
      ${renderReqAnalyticsKpiCard("已实现", kpi.realized || 0, "接纳状态=已实现")}
      ${renderReqAnalyticsKpiCard("拒绝", kpi.rejected || 0, "接纳状态=拒绝")}
    </div>`;

  const sd = d.status_distribution || {};
  const statusItems = (sd.labels || []).map((l, i) => ({ label: l, value: (sd.values || [])[i] || 0 }));
  const statusPie = statLaborSvgPie(statusItems, { donut: true, aria: "接纳状态分布" });
  const statusLegend = statLaborPieLegend(statusItems);

  const cd = d.category_distribution || {};
  const categoryItems = (cd.labels || []).map((l, i) => ({ label: l, value: (cd.values || [])[i] || 0 }));
  const categoryPie = statLaborSvgPie(categoryItems, { donut: true, aria: "分类分布" });
  const categoryLegend = statLaborPieLegend(categoryItems);

  const distSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">分布总览</h2>
      <div class="req-analytics-dist-grid">
        <div class="req-analytics-dist-col">
          <h3>接纳状态</h3>
          <div class="req-analytics-chart-center">${statusPie}${statusLegend}</div>
        </div>
        <div class="req-analytics-dist-col">
          <h3>分类</h3>
          <div class="req-analytics-chart-center">${categoryPie}${categoryLegend}</div>
        </div>
      </div>
    </div>`;

  const pd = d.priority_distribution || {};
  const prioBar = statLaborSvgBarVertical(pd.labels || [], pd.values || [], { aria: "优先级分布" });
  const prioSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">优先级分布（高/中/低）</h2>
      <div class="req-analytics-chart-row">${prioBar}</div>
    </div>`;

  const tr = d.trend || {};
  const trendLabels = tr.labels || [];
  const trendCreated = tr.created || [];
  const trendMax = Math.max(1, ...trendCreated);
  const trendLine = statLaborSvgMultiLine(trendLabels, [
    { name: "新建", values: trendCreated, stroke: STAT_LABOR_CHART_COLORS[0] },
  ], { aria: "新建趋势", maxHint: trendMax });
  const trendSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">新建趋势</h2>
      <div class="req-analytics-chart-row">${trendLine}</div>
    </div>`;

  const pl = d.person_load || {};
  const proposerBar = renderReqAnalyticsHorizontalBar(pl.top_proposers || [], { aria: "提出人Top10" });
  const personSection = `
    <div class="req-analytics-block">
      <h2 class="req-analytics-h2">提出人 Top10</h2>
      ${proposerBar}
    </div>`;

  return `
    <div class="req-analytics-page">
      ${kpiRow}
      ${distSection}
      ${prioSection}
      ${trendSection}
      ${personSection}
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
      getRange: () => ({ start: state.reqAnalyticsStart, end: state.reqAnalyticsEnd }),
      setRange: (start, end) => {
        state.reqAnalyticsStart = start;
        state.reqAnalyticsEnd = end;
        state.reqAnalyticsPreset = "custom";
      },
      onApplied: () => fetchReqAnalytics(),
      requestRender,
    });
  }
}

// ---------- 表单（新建/编辑共用字段） ----------

function selectField(id, label, options, current, required) {
  const opts = options.map((o) => `<option value="${escapeAttr(o)}" ${o === current ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
  return `<label class="req-field">${escapeHtml(label)}${required ? " *" : ""}
    <select id="${id}" class="req-input">${opts}</select>
  </label>`;
}

function reqFormBody(prefix, b) {
  const v = (k, dflt = "") => escapeAttr(String(b && b[k] != null ? b[k] : dflt));
  const t = (k) => escapeHtml(String(b && b[k] != null ? b[k] : ""));
  const proposedAt = b && b.proposed_at ? String(b.proposed_at).slice(0, 10) : formatYmdLocal(new Date());
  return `
    ${selectField(`${prefix}-category`, "分类", REQ_CATEGORIES, (b && b.category) || "质量加固和改进", true)}
    <label class="req-field">代表问题
      <input type="text" id="${prefix}-represent" class="req-input" value="${v("represent_issue")}" placeholder="代表性问题，如 工单号/简述" />
    </label>
    <label class="req-field">所属领域
      <input type="text" id="${prefix}-domain" class="req-input" value="${v("domain")}" placeholder="如 存储引擎" />
    </label>
    <label class="req-field">模块&特性
      <input type="text" id="${prefix}-module" class="req-input" value="${v("module_feature")}" placeholder="如 空间管理/回收站" />
    </label>
    <label class="req-field">问题描述
      <textarea id="${prefix}-desc" class="req-textarea" rows="3" placeholder="问题描述">${t("description")}</textarea>
    </label>
    <label class="req-field">改进诉求 *
      <textarea id="${prefix}-improvement" class="req-textarea" rows="3" placeholder="改进诉求">${t("improvement")}</textarea>
    </label>
    ${selectField(`${prefix}-priority`, "优先级", REQ_PRIORITIES, (b && b.priority) || "中", true)}
    <label class="req-field">提出人 *
      <input type="text" id="${prefix}-proposer" class="req-input" value="${v("proposer")}" placeholder="例如：张三 zhangsan" />
    </label>
    <label class="req-field">提出时间
      <input type="date" id="${prefix}-proposed" class="req-input" value="${escapeAttr(proposedAt)}" />
    </label>
    ${selectField(`${prefix}-status`, "接纳状态", REQ_STATUSES, (b && b.status) || "待评审", true)}
    <label class="req-field">计划版本
      <input type="text" id="${prefix}-version" class="req-input" value="${v("planned_version")}" placeholder="例如：V8.2.0" />
    </label>`;
}

function readReqForm(prefix) {
  const val = (id) => (document.getElementById(`${prefix}-${id}`)?.value || "").trim();
  return {
    category: val("category") || "质量加固和改进",
    represent_issue: val("represent"),
    domain: val("domain"),
    module_feature: val("module"),
    description: val("desc"),
    improvement: val("improvement"),
    priority: val("priority") || "中",
    proposer: val("proposer"),
    proposed_at: val("proposed"),
    status: val("status") || "待评审",
    planned_version: val("version"),
  };
}

export function renderRequirementModalsHtml() {
  const whitelist = getCurrentWhitelistSettings();
  const canEdit = whitelistAllows("requirement_create", "readonly", whitelist);

  const createOpen = state.reqCreateOpen
    ? `<div class="perm-modal-mask req-modal-mask" id="req-create-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>新建质量改进</h3></div>
          <div class="perm-modal-body req-create-body">${reqFormBody("req-create", null)}</div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-create-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-create-submit-btn">提交</button>
          </div>
        </div></div>`
    : "";

  const detail = state.reqDetailId
    ? (() => {
        const b = state.reqDetailBundle;
        const loading = state.reqDetailLoading;
        const op = getCurrentOperator();
        const isCreator = b && String(b.creator_id || "").trim() === String(op.account || "").trim();
        const logRows = (state.reqDetailLogs || [])
          .map((lg) => {
            const actionLabel = String(lg.action || "") === "created" ? "创建" : String(lg.action || "") === "status_changed" ? "状态变更" : "编辑更新";
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
          <div class="perm-modal-head"><h3>质量改进详情 ${b ? escapeHtml(String(b.requirement_no || "")) : ""}</h3></div>
          <div class="perm-modal-body">
            ${loading ? "<p>加载中…</p>" : ""}
            ${
              b
                ? `<div class="req-detail-meta">
              <p><strong>分类</strong> <span class="cat-tag ${categoryBadgeClass(b.category || "")}">${escapeHtml(String(b.category || ""))}</span> · <strong>优先级</strong> <span class="p ${priorityBadgeClass(b.priority)}">${escapeHtml(String(b.priority || ""))}</span> · <strong>接纳状态</strong> <span class="st-tag ${statusBadgeClass(b.status || "")}">${escapeHtml(String(b.status || ""))}</span></p>
              <p><strong>代表问题</strong> ${escapeHtml(String(b.represent_issue || "—"))}</p>
              <p><strong>所属领域</strong> ${escapeHtml(String(b.domain || "—"))} · <strong>模块&特性</strong> ${escapeHtml(String(b.module_feature || "—"))} · <strong>计划版本</strong> ${escapeHtml(String(b.planned_version || "—"))}</p>
              <p><strong>提出人</strong> ${escapeHtml(String(b.proposer || "—"))} · <strong>提出时间</strong> ${escapeHtml(String(b.proposed_at || "—").slice(0, 10))}</p>
              <div class="req-detail-desc"><strong>问题描述</strong><div class="req-detail-desc-content">${escapeHtml(String(b.description || ""))}</div></div>
              <div class="req-detail-desc"><strong>改进诉求</strong><div class="req-detail-desc-content">${escapeHtml(String(b.improvement || ""))}</div></div>
              <p><strong>创建人</strong> ${escapeHtml(String(b.creator_name || ""))} · <strong>创建时间</strong> ${formatReqDateTime(b.created_at)}</p>
            </div>
            <div class="req-detail-actions">
              ${canEdit ? `<button type="button" class="action" id="req-detail-edit-btn">编辑</button>` : ""}
              ${isCreator ? `<button type="button" class="action danger" id="req-detail-delete-btn">删除</button>` : ""}
            </div>
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
    ? `<div class="perm-modal-mask req-modal-mask" id="req-edit-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>编辑质量改进</h3></div>
          <div class="perm-modal-body req-create-body">${reqFormBody("req-edit", state.reqDetailBundle)}</div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-edit-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-edit-submit-btn">保存</button>
          </div>
        </div></div>`
    : "";

  const importOpen = state.reqImportModalOpen
    ? `<div class="perm-modal-mask req-modal-mask" id="req-import-mask">
      <div class="perm-modal req-modal req-import-modal" role="dialog">
        <div class="perm-modal-head"><h3>批量导入质量改进</h3></div>
        <div class="perm-modal-body">
          <p class="req-import-hint">请先下载模板，第 2 行起填写数据（模板第 2 行为示例，导入前请改为真实数据或删除），编号留空=新增，填写已有编号=更新。导出文件也可直接再导入。</p>
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

async function submitReqForm(prefix, url, method) {
  const form = readReqForm(prefix);
  if (!form.improvement) { window.alert("改进诉求不能为空"); return false; }
  if (!form.proposer) { window.alert("提出人不能为空"); return false; }
  const op = getCurrentOperator();
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, ...form }),
    });
    if (!r.ok) {
      const t = await r.text();
      window.alert(`${method === "POST" ? "创建" : "保存"}失败：${t.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    window.alert(`提交失败：${String(e.message || e)}`);
    return false;
  }
}

export function bindRequirementPage() {
  if (state.reqNeedsRefresh || (!state.reqListLoaded && !state.reqListLoading)) {
    state.reqNeedsRefresh = false;
    if (state.reqTab === "analytics") {
      if (!state.reqAnalyticsData && !state.reqAnalyticsLoading) fetchReqAnalytics();
    } else {
      fetchReqList();
    }
  }
  if (state.reqTab === "analytics") {
    bindReqAnalyticsPage();
  }

  document.querySelectorAll("[data-req-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-req-tab");
      if (!tab || tab === state.reqTab) return;
      state.reqTab = tab;
      state.reqListPage = 1;
      if (tab === "analytics") {
        if (!state.reqAnalyticsData) fetchReqAnalytics();
        else requestRender();
      } else {
        fetchReqList();
      }
    });
  });

  const searchInp = document.getElementById("req-search-input");
  searchInp?.addEventListener("input", (ev) => {
    state.reqSearch = ev.target.value;
    if (_reqSearchDebounceTimer) clearTimeout(_reqSearchDebounceTimer);
    _reqSearchDebounceTimer = setTimeout(() => {
      state.reqListPage = 1;
      fetchReqList();
    }, REQ_SEARCH_DEBOUNCE_MS);
  });
  searchInp?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      if (_reqSearchDebounceTimer) clearTimeout(_reqSearchDebounceTimer);
      state.reqListPage = 1;
      fetchReqList();
    }
  });

  const pageSizeSelect = document.getElementById("req-page-size");
  pageSizeSelect?.addEventListener("change", () => {
    state.reqListPageSize = Number(pageSizeSelect.value) || 10;
    state.reqListPage = 1;
    fetchReqList();
  });
  document.getElementById("req-page-prev")?.addEventListener("click", () => {
    if (state.reqListPage > 1) { state.reqListPage -= 1; fetchReqList(); }
  });
  document.getElementById("req-page-next")?.addEventListener("click", () => {
    state.reqListPage += 1;
    fetchReqList();
  });

  // 新建
  document.getElementById("req-create-btn")?.addEventListener("click", () => {
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
  document.getElementById("req-create-submit-btn")?.addEventListener("click", async () => {
    const ok = await submitReqForm("req-create", `${API_BASE_URL}/api/requirements`, "POST");
    if (ok) { state.reqCreateOpen = false; await fetchReqList(); }
  });

  // 行点击 → 详情
  document.querySelector("#req-management-panel .req-table tbody")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.req-row");
    if (!tr) return;
    const id = parseInt(tr.getAttribute("data-req-id") || "-1", 10);
    if (!Number.isFinite(id) || id < 0) return;
    state.reqDetailId = id;
    void fetchReqDetail(id);
    void fetchReqDetailLogs(id);
  });
  const closeDetail = () => {
    state.reqDetailId = null;
    state.reqDetailBundle = null;
    state.reqDetailLogs = [];
    state.reqEditOpen = false;
    requestRender();
  };
  document.getElementById("req-detail-close-btn")?.addEventListener("click", closeDetail);
  document.getElementById("req-detail-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-detail-mask")) closeDetail();
  });

  // 编辑
  document.getElementById("req-detail-edit-btn")?.addEventListener("click", () => {
    if (!state.reqDetailBundle) return;
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
  document.getElementById("req-edit-submit-btn")?.addEventListener("click", async () => {
    if (!state.reqDetailBundle) return;
    const id = state.reqDetailBundle.id;
    const ok = await submitReqForm("req-edit", `${API_BASE_URL}/api/requirements/${id}`, "PATCH");
    if (ok) {
      state.reqEditOpen = false;
      await fetchReqDetail(id);
      await fetchReqDetailLogs(id);
      await fetchReqList();
    }
  });

  // 删除
  document.getElementById("req-detail-delete-btn")?.addEventListener("click", async () => {
    if (!state.reqDetailBundle) return;
    if (!window.confirm("确定删除此质量改进？仅创建人可删除。")) return;
    const op = getCurrentOperator();
    try {
      const r = await fetch(`${API_BASE_URL}/api/requirements/${state.reqDetailBundle.id}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`删除失败：${t.slice(0, 200)}`);
        return;
      }
      closeDetail();
      await fetchReqList();
    } catch (e) {
      window.alert(`删除失败：${String(e.message || e)}`);
    }
  });

  // 下载模板
  document.getElementById("req-download-template-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/requirements/import-template?operator_id=${encodeURIComponent(op.account)}`);
      if (!resp.ok) {
        window.alert(resp.status === 403 ? "无导入权限" : `下载模板失败：${(await resp.text()).slice(0, 200)}`);
        return;
      }
      const disposition = resp.headers.get("Content-Disposition") || "";
      const m = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      const filename = m ? decodeURIComponent(m[1].replace(/"/g, "")) : "质量改进导入模板.xlsx";
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

  // 导入
  document.getElementById("req-import-btn")?.addEventListener("click", () => {
    state.reqImportModalOpen = true;
    state.reqImportFileName = "";
    requestRender();
  });
  document.getElementById("req-import-cancel-btn")?.addEventListener("click", () => {
    state.reqImportModalOpen = false;
    requestRender();
  });
  document.getElementById("req-import-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-import-mask")) {
      state.reqImportModalOpen = false;
      requestRender();
    }
  });
  const importFileInput = document.getElementById("req-import-file");
  importFileInput?.addEventListener("change", () => {
    const f = importFileInput.files && importFileInput.files[0];
    state.reqImportFileName = f ? f.name : "";
    const nameEl = document.getElementById("req-import-file-name");
    if (nameEl) nameEl.textContent = state.reqImportFileName || "点击选择或拖拽文件";
  });
  document.getElementById("req-import-submit-btn")?.addEventListener("click", async () => {
    const fileInput = document.getElementById("req-import-file");
    const f = fileInput && fileInput.files && fileInput.files[0];
    if (!f) { window.alert("请先选择文件"); return; }
    const op = getCurrentOperator();
    state.reqImportLoading = true;
    requestRender();
    try {
      const formData = new FormData();
      formData.append("file", f);
      formData.append("operator_id", op.account);
      const resp = await fetch(`${API_BASE_URL}/api/requirements/import`, { method: "POST", body: formData });
      const errBox = document.getElementById("req-import-errors");
      if (!resp.ok) {
        const t = await resp.text();
        let msg = t.slice(0, 400);
        try {
          const j = JSON.parse(t);
          const detail = typeof j.detail === "string" ? JSON.parse(j.detail) : j.detail;
          if (detail && Array.isArray(detail.errors)) {
            msg = detail.errors.map((e) => `第${e.row}行 ${e.field}：${e.message}`).join("\n");
          }
        } catch (_) { /* ignore */ }
        if (errBox) errBox.textContent = msg;
        else window.alert(`导入失败：${msg}`);
        return;
      }
      const j = await resp.json();
      window.alert(j.message || "导入成功");
      state.reqImportModalOpen = false;
      state.reqImportFileName = "";
      await fetchReqList();
    } catch (e) {
      window.alert(`导入失败：${String(e.message || e)}`);
    } finally {
      state.reqImportLoading = false;
      requestRender();
    }
  });

  // 导出
  document.getElementById("req-export-btn")?.addEventListener("click", async () => {
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
        window.alert(resp.status === 403 ? "无导出权限" : `导出失败：${(await resp.text()).slice(0, 200)}`);
        return;
      }
      const disposition = resp.headers.get("Content-Disposition") || "";
      const m = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      const filename = m ? decodeURIComponent(m[1].replace(/"/g, "")) : "质量改进导出.xlsx";
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
}
