/**
 * 质量改进月度总结（改进报告）- 4 段式页
 *
 * - 路由 key：report:improvement（编辑页）/ report:improvement-archive（归档列表）
 * - 数据接口：/api/improvement-report/{ym}（GET/PUT sections/POST archive）+ /import/{section} 聚合
 * - 4 段：overview（整体概况，富文本可编辑）/ overall（整体分析）/ domain（领域分析）/ monthly_new（本月新增表）
 * - 二至四段：导入聚合 → 核对 → 保存；编辑态提供 JSON 微调（与月度报告「问题透视」同法）
 * - 图表：ECharts；导出：单 HTML（图表 PNG 内联）/ Excel（xlsx-js-style 单 sheet 堆叠）
 */
import { state } from "../state/state.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { loadDOMPurify } from "../utils/dompurify-wrapper.js";
import {
  renderRichEditable,
  renderRichReadonly,
  renderRichToolbar,
  richToPlainText,
  sanitizeRichHtml,
  bindRichTextToolbar,
} from "../ui/rich-text.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
// 当前月/标题工具与月度报告共用（ymToTitle 传 suffix 区分「改进报告」文案）

// ---------- 常量 ----------

export const SECTION_KEYS = ["overview", "overall", "domain", "monthly_new"];
export const SECTION_LABELS = {
  overview: "一、整体概况",
  overall: "二、质量改进整体分析",
  domain: "三、质量改进领域分析",
  monthly_new: "四、本月新增改进诉求",
};
// 第四段表格列（负责人=提出人）
export const NEW_REQ_COLUMNS = ["编号", "改进标题", "详细描述", "优先级", "负责领域", "负责人"];
export const NEW_REQ_COL_WIDTHS = ["8ch", "", "", "8ch", "18ch", "20ch"];
// 整体分析 KPI 卡（label → kpi 字段取值函数）
export const OVERALL_KPI_DEFS = [
  { key: "month_new", label: "本月新增诉求数" },
  { key: "accept_rate", label: "整体接纳率(%)", suffix: "%" },
  { key: "closure_rate", label: "闭环率(%)", suffix: "%" },
  { key: "overdue_rate", label: "超期率(%)", suffix: "%" },
  { key: "in_progress", label: "在途诉求" },
  { key: "overdue", label: "超期诉求" },
];
// 领域分析（第三段）图表组：模块&特性 一级/二级 柱状图 + 占比饼图（从领域算起）
export const DOMAIN_CHART_DEFS = [
  { id: "l1-bar", key: "level1", label: "模块&特性分布（一级）", kind: "bar" },
  { id: "l1-pie", key: "level1", label: "模块&特性占比（一级）", kind: "pie" },
  { id: "l2-bar", key: "level2", label: "模块&特性分布（二级）", kind: "bar" },
  { id: "l2-pie", key: "level2", label: "模块&特性占比（二级）", kind: "pie" },
];

// 两级序列任一非空即视为有数据（渲染 / HTML 导出 / Excel 导出三处共用同一判定）
const domainHasData = (d) => (Array.isArray(d.level1) && d.level1.length > 0)
  || (Array.isArray(d.level2) && d.level2.length > 0);

// 默认空骨架：首次打开显示完整结构
export function defaultSectionData(section) {
  if (section === "overview") {
    return {
      one_line: "",
      detail: "",
      ytd: null,
      month: null,
    };
  }
  if (section === "overall") {
    return {
      kpi: {
        summary: "", total: 0, in_progress: 0, overdue: 0, analyzed: 0, accepted: 0,
        closed_done: 0, accept_rate: 0, closure_rate: 0, month_new: 0, overdue_rate: 0,
      },
      domain_pie: [],
      stage_pie: [],
      rf_accept_rate: [],
      rf_overdue_rate: [],
      research_field_stats: [],
    };
  }
  if (section === "domain") {
    return { level1: [], level2: [] };
  }
  if (section === "monthly_new") {
    return { rows: [] };
  }
  return {};
}

// ---------- 工具：当前月 / 报告标题（改进报告自持，不依赖月度报告页） ----------

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ymToTitle(ym) {
  if (!/^\d{6}$/.test(String(ym))) return "";
  return `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月改进报告`;
}

// ---------- Tab ----------

export function ensureImprovementReportTab() {
  const key = "report:improvement";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "改进报告", closable: true });
  }
  return key;
}

export function ensureImprovementReportArchiveTab() {
  const key = "report:improvement-archive";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "改进报告归档", closable: true });
  }
  return key;
}

// ---------- 状态辅助 ----------

function setMsg(msg, type = "info") {
  state.improvementReportMsg = String(msg || "");
  state.improvementReportMsgType = type;
}

const SECTION_COL_MAP = {
  overview: "section_overview",
  overall: "section_overall",
  domain: "section_domain",
  monthly_new: "section_monthly_new",
};

function getSectionData(section) {
  const data = state.improvementReportData;
  const col = SECTION_COL_MAP[section];
  if (!data || !col) return defaultSectionData(section);
  const raw = data[col];
  if (!raw || (typeof raw === "object" && Object.keys(raw).length === 0)) {
    return defaultSectionData(section);
  }
  return raw;
}

function setSectionDraft(section, value) {
  state.improvementReportDrafts[section] = value;
}

function getSectionDraft(section) {
  return state.improvementReportDrafts[section];
}

function activeSectionData(section) {
  const draft = getSectionDraft(section);
  if (draft != null) return draft;
  return getSectionData(section);
}

// ---------- API ----------

// 后端按 operator_id 校验 improvement_report 白名单（默认隐藏，缺省按默认策略 403）
function _operatorIdQuery() {
  const op = getCurrentOperator();
  return `operator_id=${encodeURIComponent(op && op.account ? op.account : "")}`;
}

async function apiFetchReport(ym) {
  const resp = await fetch(`${API_BASE_URL}/api/improvement-report/${encodeURIComponent(ym)}?${_operatorIdQuery()}`);
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiSaveSection(ym, section, data) {
  const resp = await fetch(`${API_BASE_URL}/api/improvement-report/${encodeURIComponent(ym)}/sections?${_operatorIdQuery()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, data }),
  });
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiImportSection(ym, section) {
  const resp = await fetch(`${API_BASE_URL}/api/improvement-report/${encodeURIComponent(ym)}/import/${encodeURIComponent(section)}?${_operatorIdQuery()}`);
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiArchiveReport(ym, title) {
  const resp = await fetch(`${API_BASE_URL}/api/improvement-report/${encodeURIComponent(ym)}/archive?${_operatorIdQuery()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiUnarchiveReport(ym) {
  const resp = await fetch(`${API_BASE_URL}/api/improvement-report/${encodeURIComponent(ym)}/archive?${_operatorIdQuery()}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiListReports(status) {
  const url = `${API_BASE_URL}/api/improvement-report?${_operatorIdQuery()}${status ? `&status=${status}` : ""}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

// ---------- 数据加载 ----------

export async function loadImprovementReport(ym) {
  state.improvementReportLoading = true;
  state.improvementReportYm = ym;
  state.improvementReportDrafts = { overview: null, overall: null, domain: null, monthly_new: null };
  state.improvementReportEditing = { overview: false, overall: false, domain: false, monthly_new: false };
  requestRender();
  try {
    const data = await apiFetchReport(ym);
    state.improvementReportData = data;
    setMsg("");
  } catch (err) {
    state.improvementReportData = null;
    setMsg(`加载改进报告失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.improvementReportLoading = false;
    requestRender();
  }
}

export async function loadImprovementReportArchives() {
  state.improvementReportArchiveLoading = true;
  requestRender();
  try {
    const resp = await apiListReports("archived");
    state.improvementReportArchiveList = resp.items || [];
  } catch (err) {
    state.improvementReportArchiveList = [];
    setMsg(`加载归档列表失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.improvementReportArchiveLoading = false;
    requestRender();
  }
}

// ---------- 渲染：工具栏 ----------

function renderToolbar() {
  const ym = state.improvementReportYm || currentYm();
  const data = state.improvementReportData;
  const isArchived = data && data.status === "archived";
  const statusBadge = isArchived
    ? `<span class="mr-status mr-status--archived">已归档</span>`
    : `<span class="mr-status mr-status--draft">草稿</span>`;
  return `
    <div class="mr-toolbar">
      <label class="mr-month-label">报告月份
        <input type="month" id="ir-month-input" class="mr-month-input"
               value="${escapeAttr(`${ym.slice(0, 4)}-${ym.slice(4)}`)}" />
      </label>
      ${statusBadge}
      <span class="mr-toolbar-spacer"></span>
      <button type="button" class="action" id="ir-reload-btn">刷新</button>
      <button type="button" class="action" id="ir-export-btn">导出 HTML</button>
      <button type="button" class="action" id="ir-export-xlsx-btn">导出 Excel</button>
      ${isArchived
        ? `<button type="button" class="action" id="ir-unarchive-btn">取消归档</button>`
        : `<button type="button" class="action primary" id="ir-archive-btn">归档</button>`}
    </div>`;
}

function renderBanner() {
  const msg = String(state.improvementReportMsg || "");
  if (!msg) return "";
  const type = String(state.improvementReportMsgType || "info");
  return `<div class="mr-banner mr-banner--${escapeAttr(type)}" role="status">${escapeHtml(msg)}</div>`;
}

function renderTitleBanner() {
  const ym = String((state.improvementReportData && state.improvementReportData.report_month) || state.improvementReportYm || "");
  const monthLabel = /^\d{6}$/.test(ym)
    ? `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月`
    : "202x年x月";
  return `
    <div class="mr-title-banner ir-title-banner">
      <div class="mr-title-banner-actions"></div>
      <div class="mr-title-banner-main">质量改进报告（${escapeHtml(monthLabel)}）</div>
      <div class="mr-title-banner-sub">质量改进月度总结</div>
    </div>`;
}

// 四段全部支持「导入」：从质量改进数据聚合计算后填入草稿。
const IMPORTABLE_SECTIONS = { overview: true, overall: true, domain: true, monthly_new: true };

function renderSectionHeader(section) {
  const editing = !!state.improvementReportEditing[section];
  const saving = !!(state.improvementReportSaving && state.improvementReportSaving[section]);
  const importing = !!(state.improvementReportImporting && state.improvementReportImporting[section]);
  const isArchived = state.improvementReportData && state.improvementReportData.status === "archived";
  const importBtn = (!isArchived && !editing && IMPORTABLE_SECTIONS[section])
    ? `<button type="button" class="action mr-section-import" data-ir-import="${section}" ${importing ? "disabled" : ""}>${importing ? "导入中…" : "导入"}</button>`
    : "";
  const editBtn = isArchived
    ? ""
    : editing
      ? `<button type="button" class="action primary mr-section-save" data-ir-save="${section}" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存本段"}</button>
         <button type="button" class="action mr-section-cancel" data-ir-cancel="${section}" ${saving ? "disabled" : ""}>取消</button>`
      : `<button type="button" class="action mr-section-edit" data-ir-edit="${section}">编辑本段</button>`;
  return `
    <div class="mr-section-head">
      <h3 class="mr-section-title">${escapeHtml(SECTION_LABELS[section])}</h3>
      <div class="mr-section-actions">${importBtn}${editBtn}</div>
    </div>`;
}

// ---------- 渲染：第一段 整体概况（富文本可编辑） ----------

function renderSectionOverview() {
  const editing = !!state.improvementReportEditing.overview;
  const data = activeSectionData("overview");
  const oneLine = String(data.one_line || "");
  const detail = String(data.detail || "");
  const blocks = [
    { key: "one_line", num: "1.1", label: "一句话进展" },
    { key: "detail", num: "1.2", label: "详细进展" },
  ];
  const body = blocks.map((f) => {
    const val = String(data[f.key] || "");
    const heading = `<span class="mr-overview-num">${escapeHtml(f.num)}</span> ${escapeHtml(f.label)}`;
    if (editing) {
      return `<div class="mr-overview-block">
        <label class="mr-overview-label">${heading}</label>
        ${renderRichEditable(val, `data-ir-overview-field="${f.key}"`, { cls: "mr-overview-text", placeholder: "可点击「导入」自动生成，也可手工填写…" })}
      </div>`;
    }
    return `<div class="mr-overview-block">
      <div class="mr-overview-label">${heading}</div>
      <div class="mr-overview-readonly">${val.trim() ? renderRichReadonly(val) : '<span class="mr-empty-hint">（暂无，可点击「导入」自动生成）</span>'}</div>
    </div>`;
  }).join("");
  return `
    <section class="mr-section mr-section--overview">
      ${renderSectionHeader("overview")}
      ${editing ? renderRichToolbar() : ""}
      <div class="mr-overview-grid">${body}</div>
    </section>`;
}

// ---------- 渲染：第二段 质量改进整体分析 ----------

function renderOverallKpi(kpi) {
  const cards = OVERALL_KPI_DEFS.map((d) => {
    const v = Number(kpi[d.key] || 0);
    return `<div class="mr-kpi-card"><div class="mr-kpi-label">${escapeHtml(d.label)}</div><div class="mr-kpi-value">${v}${d.suffix || ""}</div></div>`;
  }).join("");
  const summary = String(kpi.summary || "");
  return `
    ${summary ? `<div class="mr-overview-readonly ir-kpi-summary">${renderRichReadonly(summary)}</div>` : ""}
    <div class="mr-insight-kpi-row">${cards}</div>`;
}

function renderJsonEditor(section, data, hint) {
  const j = JSON.stringify(data, null, 2);
  return `
    <div class="mr-insight-editor">
      <div class="mr-insight-editor-hint">${escapeHtml(hint)}</div>
      <textarea id="ir-json-${section}" class="mr-insight-json ir-json-textarea">${escapeHtml(j)}</textarea>
    </div>`;
}

function renderSectionOverall() {
  const editing = !!state.improvementReportEditing.overall;
  const data = activeSectionData("overall");
  const charts = `
    <div class="mr-insight-chart-grid">
      <div class="mr-chart-card"><div class="mr-chart-title">改进诉求领域占比</div><div class="mr-chart-host" id="ir-chart-overall-domain"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">改进诉求各阶段占比</div><div class="mr-chart-host" id="ir-chart-overall-stage"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">责任田接纳率(%)</div><div class="mr-chart-host" id="ir-chart-overall-rf-accept"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">责任田超期率(%)</div><div class="mr-chart-host" id="ir-chart-overall-rf-overdue"></div></div>
    </div>`;
  return `
    <section class="mr-section mr-section--insight">
      ${renderSectionHeader("overall")}
      ${renderOverallKpi(data.kpi || {})}
      ${editing ? renderJsonEditor("overall", data, "直接编辑下方 JSON 数据，保存后图表自动刷新。字段：kpi / domain_pie / stage_pie / rf_accept_rate / rf_overdue_rate / research_field_stats") : ""}
      ${charts}
    </section>`;
}

// ---------- 渲染：第三段 质量改进领域分析（模块&特性 一级/二级 柱图+饼图） ----------

function renderSectionDomain() {
  const editing = !!state.improvementReportEditing.domain;
  const data = activeSectionData("domain");
  const hasData = domainHasData(data);
  const body = !hasData
    ? `<div class="mr-empty-hint">暂无模块&特性数据，可点击「导入」按一级/二级模块聚合生成。</div>`
    : `<div class="mr-insight-chart-grid">${DOMAIN_CHART_DEFS.map((d) => `
        <div class="mr-chart-card">
          <div class="mr-chart-title">${escapeHtml(d.label)}</div>
          <div class="mr-chart-host" id="ir-chart-domain-${d.id}"></div>
        </div>`).join("")}</div>`;
  return `
    <section class="mr-section mr-section--domain">
      ${renderSectionHeader("domain")}
      ${editing ? renderJsonEditor("domain", data, "直接编辑下方 JSON 数据，保存后图表自动刷新。字段：level1[]/level2[]（name/value，一级=领域，二级=领域/模块）") : ""}
      ${body}
    </section>`;
}

// ---------- 渲染：第四段 本月新增改进诉求 ----------

function renderNewReqTable(rows) {
  const head = NEW_REQ_COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const colGroup = `<colgroup>${NEW_REQ_COL_WIDTHS.map((w) => `<col${w ? ` style="width:${w}"` : ""} />`).join("")}</colgroup>`;
  let body;
  if (!rows.length) {
    body = `<tr><td class="mr-empty-cell" colspan="${NEW_REQ_COLUMNS.length}">本月暂未新增改进诉求</td></tr>`;
  } else {
    body = rows.map((row) => {
      const cells = [
        String(row.qi_no || ""),
        String(row.title || ""),
        String(row.description || ""),
        String(row.priority || ""),
        String(row.domain || ""),
        String(row.proposer || ""),
      ];
      return `<tr>${cells.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`;
    }).join("");
  }
  return `
    <div class="mr-improve-table-wrap ir-newreq-wrap">
      <table class="mr-major-table">
        ${colGroup}
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="ir-newreq-count">共 ${rows.length} 条</div>
    </div>`;
}

function renderSectionMonthlyNew() {
  const editing = !!state.improvementReportEditing.monthly_new;
  const data = activeSectionData("monthly_new");
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return `
    <section class="mr-section mr-section--monthly-new">
      ${renderSectionHeader("monthly_new")}
      ${editing ? renderJsonEditor("monthly_new", data, "直接编辑下方 JSON 数据，保存后表格自动刷新。字段：rows[]（qi_no/title/description/priority/domain/proposer）") : ""}
      ${renderNewReqTable(rows)}
    </section>`;
}

// ---------- 总入口渲染 ----------

export function renderImprovementReportPage() {
  if (state.improvementReportLoading && !state.improvementReportData) {
    return `<section class="mr-page">${renderToolbar()}<div class="mr-loading">加载中…</div></section>`;
  }
  if (!state.improvementReportData) {
    return `<section class="mr-page">${renderToolbar()}${renderBanner()}<div class="mr-loading">未能加载报告，请点击刷新。</div></section>`;
  }
  return `
    <section class="mr-page" aria-label="质量改进月度总结报告">
      ${renderToolbar()}
      ${renderBanner()}
      ${renderTitleBanner()}
      ${renderSectionOverview()}
      ${renderSectionOverall()}
      ${renderSectionDomain()}
      ${renderSectionMonthlyNew()}
    </section>`;
}

// ---------- ECharts 渲染 ----------

let chartInstances = {};

function disposeAllCharts() {
  Object.keys(chartInstances).forEach((k) => {
    try { chartInstances[k].dispose(); } catch (_) { /* ignore */ }
  });
  chartInstances = {};
}

function buildPieOption(title, items) {
  // 百分比并入图例（名称 xx.x%），关闭扇区外置标签：
  // 领域多、小扇区多时外置 {d}% 会与右侧图例互相遮挡、贴边被裁剪。
  // 饼体左置小半径（center 25% / radius 50%），为右侧竖排图例整列预留横向空间——
  // 窄卡片（第三段每模块 5 图并排 ~270px）下「质量加固和改进 12.6%」类长标签
  // 也不会与扇区重合；图例字号 11 + 紧凑行距，7 项不超出卡片底边。
  const data = (items || []).filter((d) => Number(d.value || 0) > 0)
    .map((d) => ({ name: String(d.name || ""), value: Number(d.value || 0) }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const pctByName = {};
  data.forEach((d) => { pctByName[d.name] = total > 0 ? (d.value * 100) / total : 0; });
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: {
      orient: "vertical", right: 4, top: "middle", type: "scroll", height: "86%",
      itemGap: 6, textStyle: { fontSize: 11 },
      formatter: (name) => (pctByName[name] != null ? `${name}  ${pctByName[name].toFixed(1)}%` : name),
    },
    series: [{
      name: title,
      type: "pie",
      radius: ["30%", "50%"],
      center: ["25%", "50%"],
      avoidLabelOverlap: true,
      label: { show: false },
      labelLine: { show: false },
      data,
    }],
  };
}

function buildBarOption(items, opts = {}) {
  const data = (items || []).slice().sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 80, right: 24, top: 24, bottom: 24, containLabel: true },
    xAxis: { type: "category", data: data.map((d) => d.name), axisLabel: { interval: 0, rotate: 28 } },
    yAxis: { type: "value" },
    series: [{
      type: "bar",
      data: data.map((d) => Number(d.value || 0)),
      barMaxWidth: 28,
      itemStyle: { color: opts.color || "#3f86ff" },
      label: { show: true, position: "top" },
    }],
  };
}

function mountChart(id, option) {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const el = document.getElementById(id);
  if (!el) return;
  const inst = E.init(el, null, { renderer: "canvas" });
  inst.setOption(option);
  chartInstances[id] = inst;
}

function mountOverallCharts() {
  const data = activeSectionData("overall");
  mountChart("ir-chart-overall-domain", buildPieOption("领域占比", data.domain_pie));
  mountChart("ir-chart-overall-stage", buildPieOption("阶段占比", data.stage_pie));
  mountChart("ir-chart-overall-rf-accept", buildBarOption(data.rf_accept_rate, { color: "#36c5b0" }));
  mountChart("ir-chart-overall-rf-overdue", buildBarOption(data.rf_overdue_rate, { color: "#ec7373" }));
}

const DOMAIN_CHART_COLORS = ["#5b8def", "#36c5b0", "#ff8a3d", "#a26bff", "#3fb27f"];

function mountDomainCharts() {
  const data = activeSectionData("domain");
  DOMAIN_CHART_DEFS.forEach((d, di) => {
    const opt = d.kind === "pie"
      ? buildPieOption(d.label, data[d.key])
      : buildBarOption(data[d.key], { color: DOMAIN_CHART_COLORS[di % DOMAIN_CHART_COLORS.length] });
    mountChart(`ir-chart-domain-${d.id}`, opt);
  });
}

export function mountImprovementReportCharts() {
  disposeAllCharts();
  mountOverallCharts();
  mountDomainCharts();
}

// ---------- 编辑/保存 ----------

function startEdit(section) {
  state.improvementReportEditing[section] = true;
  const stored = JSON.parse(JSON.stringify(getSectionData(section)));
  // 旧存量第三段（modules 结构）已不可渲染：进入编辑即按新契约 {level1,level2} 起步，
  // 避免把旧结构原样保存回去（编辑提示语即新契约）
  if (section === "domain" && !Array.isArray(stored.level1) && !Array.isArray(stored.level2)) {
    state.improvementReportDrafts[section] = defaultSectionData("domain");
  } else {
    state.improvementReportDrafts[section] = stored;
  }
  requestRender();
}

function cancelEdit(section) {
  state.improvementReportEditing[section] = false;
  state.improvementReportDrafts[section] = null;
  requestRender();
}

async function saveSection(section) {
  const ym = state.improvementReportYm;
  if (!ym) { setMsg("尚未选择月份。", "error"); requestRender(); return; }
  const draft = getSectionDraft(section);
  if (draft == null) { setMsg("没有变更需要保存。", "info"); requestRender(); return; }
  state.improvementReportSaving[section] = true;
  requestRender();
  try {
    const updated = await apiSaveSection(ym, section, draft);
    state.improvementReportData = updated;
    state.improvementReportEditing[section] = false;
    state.improvementReportDrafts[section] = null;
    setMsg(`「${SECTION_LABELS[section]}」已保存。`, "success");
  } catch (err) {
    setMsg(`保存失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.improvementReportSaving[section] = false;
    requestRender();
  }
}

// 从质量改进数据聚合导入：填入草稿并进入编辑态，由用户核对后再「保存本段」。
async function importSection(section) {
  const ym = state.improvementReportYm;
  if (!ym) { setMsg("尚未选择月份。", "error"); requestRender(); return; }
  if (!state.improvementReportImporting) state.improvementReportImporting = {};
  state.improvementReportImporting[section] = true;
  setMsg(`正在从质量改进数据计算「${SECTION_LABELS[section]}」…`, "info");
  requestRender();
  try {
    const imported = await apiImportSection(ym, section);
    state.improvementReportDrafts[section] = imported;
    state.improvementReportEditing[section] = true;
    setMsg(`已导入「${SECTION_LABELS[section]}」数据，请核对后点击「保存本段」。`, "success");
  } catch (err) {
    setMsg(`导入失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.improvementReportImporting[section] = false;
    requestRender();
  }
}

// ---------- 绑定 ----------

function bindOverviewEditor() {
  document.querySelectorAll("[data-ir-overview-field]").forEach((el) => {
    el.addEventListener("input", (ev) => {
      const field = ev.target.getAttribute("data-ir-overview-field");
      let draft = getSectionDraft("overview");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("overview")));
      draft[field] = ev.target.isContentEditable ? sanitizeRichHtml(ev.target.innerHTML) : ev.target.value;
      setSectionDraft("overview", draft);
    });
  });
}

function bindJsonEditors() {
  SECTION_KEYS.forEach((section) => {
    if (section === "overview") return;
    const ta = document.getElementById(`ir-json-${section}`);
    if (!ta) return;
    ta.addEventListener("input", (ev) => {
      const txt = ev.target.value;
      try {
        const parsed = JSON.parse(txt);
        setSectionDraft(section, parsed);
        ta.classList.remove("mr-json-error");
      } catch (_) {
        ta.classList.add("mr-json-error");
      }
    });
  });
}

function bindSectionButtons() {
  document.querySelectorAll("[data-ir-edit]").forEach((el) => {
    el.addEventListener("click", () => startEdit(el.getAttribute("data-ir-edit")));
  });
  document.querySelectorAll("[data-ir-cancel]").forEach((el) => {
    el.addEventListener("click", () => cancelEdit(el.getAttribute("data-ir-cancel")));
  });
  document.querySelectorAll("[data-ir-save]").forEach((el) => {
    el.addEventListener("click", () => saveSection(el.getAttribute("data-ir-save")));
  });
  document.querySelectorAll("[data-ir-import]").forEach((el) => {
    el.addEventListener("click", () => importSection(el.getAttribute("data-ir-import")));
  });
}

// ---------- 导出 ----------

function monthLabelOf(ym) {
  return /^\d{6}$/.test(String(ym)) ? `${String(ym).slice(0, 4)}年${parseInt(String(ym).slice(4), 10)}月` : String(ym || "");
}

function buildExportHtml() {
  const ym = state.improvementReportYm || currentYm();
  const title = ymToTitle(ym);
  const data = state.improvementReportData || {};
  const overview = data.section_overview || defaultSectionData("overview");
  const overall = data.section_overall || defaultSectionData("overall");
  const domain = data.section_domain || defaultSectionData("domain");
  const monthlyNew = data.section_monthly_new || defaultSectionData("monthly_new");

  const chartImgs = {};
  Object.keys(chartInstances).forEach((id) => {
    try { chartImgs[id] = chartInstances[id].getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }); }
    catch (_) { /* ignore */ }
  });
  const img = (id) => chartImgs[id] ? `<img src="${chartImgs[id]}" alt="${id}" style="max-width:100%;height:auto;border:1px solid #ddd;"/>` : "";
  const cell = (id, width = "25%") => `<td style="vertical-align:top;width:${width};padding:6px;">${img(id)}</td>`;

  const overviewHtml = `
    <table style="border-collapse:collapse;width:100%;">
      <tr><th style="background:#f5f7fa;text-align:left;padding:8px 14px;border:1px solid #ccc;width:1%;white-space:nowrap;color:#4a4640;font-weight:600;">1.1 一句话进展</th><td style="padding:8px;border:1px solid #ccc;white-space:pre-wrap;color:#2f2b25;">${sanitizeRichHtml(String(overview.one_line || ""))}</td></tr>
      <tr><th style="background:#f5f7fa;text-align:left;padding:8px 14px;border:1px solid #ccc;width:1%;white-space:nowrap;color:#4a4640;font-weight:600;">1.2 详细进展</th><td style="padding:8px;border:1px solid #ccc;white-space:pre-wrap;color:#2f2b25;">${sanitizeRichHtml(String(overview.detail || ""))}</td></tr>
    </table>`;

  const kpi = overall.kpi || {};
  const overallHtml = `
    ${kpi.summary ? `<p style="margin:0 0 8px;color:#2f2b25;"><b>综述：</b>${escapeHtml(String(kpi.summary))}</p>` : ""}
    <table style="border-collapse:collapse;width:100%;margin-bottom:12px;">
      <tr>
        ${OVERALL_KPI_DEFS.map((d) => `<td style="border:1px solid #ccc;padding:8px;text-align:center;"><div style="color:#5d5a55;font-size:12px;">${escapeHtml(d.label)}</div><div style="font-size:22px;font-weight:700;color:#2f2b25;">${Number(kpi[d.key] || 0)}${d.suffix || ""}</div></td>`).join("")}
      </tr>
    </table>
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
      <tr>
        ${cell("ir-chart-overall-domain")}${cell("ir-chart-overall-stage")}${cell("ir-chart-overall-rf-accept")}${cell("ir-chart-overall-rf-overdue")}
      </tr>
    </table>`;

  const domainHtml = !domainHasData(domain)
    ? `<div style="color:#999;">暂无模块&特性数据。</div>`
    : `
      <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
        <tr>
          ${DOMAIN_CHART_DEFS.slice(0, 2).map((d) => cell(`ir-chart-domain-${d.id}`, "50%")).join("")}
        </tr>
        <tr>
          ${DOMAIN_CHART_DEFS.slice(2, 4).map((d) => cell(`ir-chart-domain-${d.id}`, "50%")).join("")}
        </tr>
      </table>`;

  const rows = Array.isArray(monthlyNew.rows) ? monthlyNew.rows : [];
  const newReqHtml = `
    <p style="margin:0 0 8px;color:#666;font-size:13px;">共 ${rows.length} 条</p>
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px;">
      <thead><tr>${NEW_REQ_COLUMNS.map((c) => `<th style="border:1px solid #888;padding:6px 8px;background:#f0f3f7;font-weight:600;color:#2f2b25;text-align:left;">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.length
        ? rows.map((r) => `<tr>${[r.qi_no, r.title, r.description, r.priority, r.domain, r.proposer].map((v) => `<td style="border:1px solid #888;padding:6px 8px;color:#2f2b25;text-align:left;vertical-align:top;word-break:break-word;white-space:pre-wrap;">${escapeHtml(String(v == null ? "" : v))}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${NEW_REQ_COLUMNS.length}" style="border:1px solid #888;padding:6px 8px;text-align:center;color:#bbb;">本月暂未新增改进诉求</td></tr>`}</tbody>
    </table>`;

  const bannerHtml = `
  <div style="background:#1a4a78;color:#fff;border-radius:12px;padding:26px 24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:30px;font-weight:700;letter-spacing:1px;line-height:1.4;">质量改进报告（${escapeHtml(monthLabelOf(ym))}）</div>
    <div style="font-size:20px;opacity:.92;margin-top:10px;">质量改进月度总结</div>
  </div>`;
  const section = (t, body) => `
  <div style="background:#fff;border:1px solid #dfe5ec;border-radius:12px;overflow:hidden;margin-bottom:16px;">
    <div style="background:#87ceeb;color:#1a3a52;font-weight:700;font-size:16px;padding:10px 24px;">${escapeHtml(t)}</div>
    <div style="padding:14px 16px 18px;">${body}</div>
  </div>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#222;line-height:1.55;padding:18px;background:#eef1f5;">
  ${bannerHtml}
  ${section(SECTION_LABELS.overview, overviewHtml)}
  ${section(SECTION_LABELS.overall, overallHtml)}
  ${section(SECTION_LABELS.domain, domainHtml)}
  ${section(SECTION_LABELS.monthly_new, newReqHtml)}
  <p style="margin-top:8px;color:#999;font-size:12px;">导出时间：${new Date().toLocaleString("zh-CN")} · 报告月份：${escapeHtml(ym)}</p>
</body></html>`;
}

function exportReportHtml() {
  const ym = state.improvementReportYm || currentYm();
  const html = buildExportHtml();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ymToTitle(ym)}.html`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  setMsg("已导出为 HTML，可直接粘贴邮件正文。", "success");
  requestRender();
}

// 单 sheet 堆叠 4 段（与 HTML 导出排版一致）：横幅 → 一/二/三/四 章节标题 → 各段内容。
function buildExportXlsx() {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) return null;
  const ym = state.improvementReportYm || currentYm();
  const data = state.improvementReportData || {};
  const overview = data.section_overview || defaultSectionData("overview");
  const overall = data.section_overall || defaultSectionData("overall");
  const domain = data.section_domain || defaultSectionData("domain");
  const monthlyNew = data.section_monthly_new || defaultSectionData("monthly_new");

  const COLS = NEW_REQ_COLUMNS.length; // sheet 列宽 = 6

  const thinBorder = {
    top: { style: "thin", color: { rgb: "888888" } },
    bottom: { style: "thin", color: { rgb: "888888" } },
    left: { style: "thin", color: { rgb: "888888" } },
    right: { style: "thin", color: { rgb: "888888" } },
  };
  const STYLES = {
    bannerMain: {
      fill: { fgColor: { rgb: "1A4A78" } },
      font: { color: { rgb: "FFFFFF" }, bold: true, sz: 18 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    bannerSub: {
      fill: { fgColor: { rgb: "1A4A78" } },
      font: { color: { rgb: "FFFFFF" }, sz: 12 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    sectionHead: {
      fill: { fgColor: { rgb: "87CEEB" } },
      font: { color: { rgb: "1A3A52" }, bold: true, sz: 14 },
      alignment: { horizontal: "left", vertical: "center" },
    },
    subTitle: {
      fill: { fgColor: { rgb: "EAF1FB" } },
      font: { bold: true, sz: 12 },
      alignment: { horizontal: "left", vertical: "center" },
      border: thinBorder,
    },
    tableHead: {
      fill: { fgColor: { rgb: "F0F3F7" } },
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: thinBorder,
    },
    tableCell: {
      alignment: { vertical: "top", wrapText: true },
      border: thinBorder,
    },
    kpiLabel: {
      fill: { fgColor: { rgb: "F5F7FA" } },
      font: { color: { rgb: "888888" }, sz: 11 },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    },
    kpiValue: {
      font: { bold: true, sz: 16 },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    },
    overviewLabel: {
      fill: { fgColor: { rgb: "F5F7FA" } },
      font: { bold: true },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
      border: thinBorder,
    },
    overviewValue: {
      alignment: { vertical: "top", wrapText: true },
      border: thinBorder,
    },
  };

  const aoa = [];
  const merges = [];
  const styleOps = [];
  const rowHeights = {};

  const blank = () => new Array(COLS).fill("");
  const recordStyle = (rFrom, cFrom, rTo, cTo, style) => {
    styleOps.push({ s: { r: rFrom, c: cFrom }, e: { r: rTo, c: cTo }, style });
  };
  const pushFullRow = (txt, style, hpx) => {
    const ri = aoa.length;
    const r = blank();
    r[0] = txt;
    aoa.push(r);
    merges.push({ s: { r: ri, c: 0 }, e: { r: ri, c: COLS - 1 } });
    if (style) recordStyle(ri, 0, ri, COLS - 1, style);
    if (hpx) rowHeights[ri] = hpx;
  };

  // 顶部横幅
  pushFullRow(`质量改进报告（${monthLabelOf(ym)}）`, STYLES.bannerMain, 38);
  pushFullRow("质量改进月度总结", STYLES.bannerSub, 22);
  aoa.push(blank());

  // 一、整体概况
  pushFullRow("一、整体概况", STYLES.sectionHead, 26);
  [
    ["1.1 一句话进展", richToPlainText(String(overview.one_line || ""))],
    ["1.2 详细进展", richToPlainText(String(overview.detail || ""))],
  ].forEach(([label, val]) => {
    const ri = aoa.length;
    const r = blank();
    r[0] = label;
    r[2] = val;
    aoa.push(r);
    merges.push({ s: { r: ri, c: 0 }, e: { r: ri, c: 1 } });
    merges.push({ s: { r: ri, c: 2 }, e: { r: ri, c: COLS - 1 } });
    recordStyle(ri, 0, ri, 1, STYLES.overviewLabel);
    recordStyle(ri, 2, ri, COLS - 1, STYLES.overviewValue);
    rowHeights[ri] = 40;
  });
  aoa.push(blank());

  // 二、质量改进整体分析
  pushFullRow("二、质量改进整体分析", STYLES.sectionHead, 26);
  const kpi = overall.kpi || {};
  if (kpi.summary) pushFullRow(`综述：${kpi.summary}`, STYLES.subTitle, 22);
  const kpiLabelRow = blank();
  const kpiValueRow = blank();
  OVERALL_KPI_DEFS.forEach((d, i) => {
    kpiLabelRow[i] = d.label;
    kpiValueRow[i] = `${Number(kpi[d.key] || 0)}${d.suffix || ""}`;
  });
  aoa.push(kpiLabelRow);
  const lr = aoa.length - 1;
  aoa.push(kpiValueRow);
  const vr = aoa.length - 1;
  recordStyle(lr, 0, lr, COLS - 1, STYLES.kpiLabel);
  recordStyle(vr, 0, vr, COLS - 1, STYLES.kpiValue);
  rowHeights[lr] = 22;
  rowHeights[vr] = 30;
  aoa.push(blank());

  // 三、质量改进领域分析（模块&特性 一级/二级两张名称/数值子表）
  pushFullRow("三、质量改进领域分析", STYLES.sectionHead, 26);
  const l1 = Array.isArray(domain.level1) ? domain.level1 : [];
  const l2 = Array.isArray(domain.level2) ? domain.level2 : [];
  if (!domainHasData(domain)) {
    pushFullRow("（暂无模块&特性数据）", STYLES.subTitle, 22);
  }
  // 图表序列导出为名称/数值两列子表（纵向堆叠，COLS=6 时右侧留白）
  const pushKv = (title, items) => {
    pushFullRow(title, STYLES.subTitle, 22);
    const headRi = aoa.length;
    const headRow = blank();
    headRow[0] = "名称";
    headRow[1] = "数值";
    aoa.push(headRow);
    recordStyle(headRi, 0, headRi, 1, STYLES.tableHead);
    const list = (items || []).filter((d) => Number(d.value || 0) > 0);
    if (!list.length) {
      const ri = aoa.length;
      const r = blank();
      r[0] = "（暂无数据）";
      aoa.push(r);
      merges.push({ s: { r: ri, c: 0 }, e: { r: ri, c: 1 } });
      recordStyle(ri, 0, ri, 1, STYLES.tableCell);
    } else {
      list.forEach((d) => {
        const ri = aoa.length;
        const r = blank();
        r[0] = String(d.name || "");
        r[1] = Number(d.value || 0);
        aoa.push(r);
        recordStyle(ri, 0, ri, 1, STYLES.tableCell);
      });
    }
    aoa.push(blank());
  };
  pushKv("模块&特性（一级，领域）", l1);
  pushKv("模块&特性（二级，领域/模块）", l2);

  // 四、本月新增改进诉求（6 列 = sheet 全宽）
  pushFullRow("四、本月新增改进诉求", STYLES.sectionHead, 26);
  const headRi = aoa.length;
  aoa.push(NEW_REQ_COLUMNS.slice());
  recordStyle(headRi, 0, headRi, COLS - 1, STYLES.tableHead);
  const rows = Array.isArray(monthlyNew.rows) ? monthlyNew.rows : [];
  if (!rows.length) {
    const ri = aoa.length;
    const r = blank();
    r[0] = "（本月暂未新增改进诉求）";
    aoa.push(r);
    merges.push({ s: { r: ri, c: 0 }, e: { r: ri, c: COLS - 1 } });
    recordStyle(ri, 0, ri, COLS - 1, STYLES.tableCell);
  } else {
    rows.forEach((rdata) => {
      const ri = aoa.length;
      const r = blank();
      NEW_REQ_COLUMNS.forEach((_, i) => {
        const key = ["qi_no", "title", "description", "priority", "domain", "proposer"][i];
        r[i] = String(rdata[key] == null ? "" : rdata[key]);
      });
      aoa.push(r);
      recordStyle(ri, 0, ri, COLS - 1, STYLES.tableCell);
    });
  }
  pushFullRow(`合计：${rows.length} 条`, STYLES.subTitle, 22);

  // 构建 sheet & 应用样式
  const ws = X.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = new Array(COLS).fill(0).map(() => ({ wch: 18 }));
  ws["!rows"] = [];
  Object.keys(rowHeights).forEach((k) => {
    ws["!rows"][Number(k)] = { hpx: rowHeights[k] };
  });
  styleOps.forEach(({ s, e, style }) => {
    for (let r = s.r; r <= e.r; r++) {
      for (let c = s.c; c <= e.c; c++) {
        const addr = X.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { t: "s", v: "" };
        ws[addr].s = Object.assign({}, ws[addr].s, style);
      }
    }
  });

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "改进报告");
  return wb;
}

function exportReportXlsx() {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    setMsg("SheetJS 未加载，无法导出 Excel。", "error");
    requestRender();
    return;
  }
  const ym = state.improvementReportYm || currentYm();
  const wb = buildExportXlsx();
  if (!wb) {
    setMsg("当前无可导出数据。", "error");
    requestRender();
    return;
  }
  X.writeFile(wb, `${ymToTitle(ym)}.xlsx`);
  setMsg("已导出为 Excel。", "success");
  requestRender();
}

// ---------- 工具栏绑定 ----------

function bindToolbar() {
  const monthInput = document.getElementById("ir-month-input");
  if (monthInput) {
    monthInput.addEventListener("change", (ev) => {
      const v = String(ev.target.value || "").replace("-", "");
      if (/^\d{6}$/.test(v)) loadImprovementReport(v);
    });
  }
  const reload = document.getElementById("ir-reload-btn");
  if (reload) reload.addEventListener("click", () => loadImprovementReport(state.improvementReportYm || currentYm()));
  const exportBtn = document.getElementById("ir-export-btn");
  if (exportBtn) exportBtn.addEventListener("click", () => exportReportHtml());
  const exportXlsxBtn = document.getElementById("ir-export-xlsx-btn");
  if (exportXlsxBtn) exportXlsxBtn.addEventListener("click", () => exportReportXlsx());
  const archiveBtn = document.getElementById("ir-archive-btn");
  if (archiveBtn) {
    archiveBtn.addEventListener("click", async () => {
      const ym = state.improvementReportYm;
      try {
        const updated = await apiArchiveReport(ym, ymToTitle(ym));
        state.improvementReportData = updated;
        SECTION_KEYS.forEach((s) => { state.improvementReportEditing[s] = false; state.improvementReportDrafts[s] = null; });
        setMsg(`已归档为「${ymToTitle(ym)}」。`, "success");
      } catch (err) {
        setMsg(`归档失败：${err && err.message ? err.message : err}`, "error");
      }
      requestRender();
    });
  }
  const unarchiveBtn = document.getElementById("ir-unarchive-btn");
  if (unarchiveBtn) {
    unarchiveBtn.addEventListener("click", async () => {
      const ym = state.improvementReportYm;
      try {
        const updated = await apiUnarchiveReport(ym);
        state.improvementReportData = updated;
        setMsg("已取消归档。", "success");
      } catch (err) {
        setMsg(`取消归档失败：${err && err.message ? err.message : err}`, "error");
      }
      requestRender();
    });
  }
}

export function bindImprovementReportPage() {
  loadDOMPurify();
  bindToolbar();
  bindSectionButtons();
  bindOverviewEditor();
  bindJsonEditors();
  bindRichTextToolbar();
  setTimeout(() => mountImprovementReportCharts(), 0);
}

// ---------- 归档列表页 ----------

export function renderImprovementReportArchivePage() {
  const items = state.improvementReportArchiveList || [];
  const loading = !!state.improvementReportArchiveLoading;
  let body;
  if (loading && !items.length) {
    body = `<div class="mr-loading">加载归档列表中…</div>`;
  } else if (!items.length) {
    body = `<div class="mr-empty-hint">暂无归档报告。在「改进报告」页保存并归档后会显示在这里。</div>`;
  } else {
    body = `
      <table class="mr-archive-table">
        <thead>
          <tr>
            <th>月份</th>
            <th>报告名称</th>
            <th>归档时间</th>
            <th>更新时间</th>
            <th style="width:120px;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it) => {
            const ym = String(it.report_month || "");
            const title = String(it.title || ymToTitle(ym));
            const archived = it.archived_at ? new Date(it.archived_at).toLocaleString("zh-CN") : "—";
            const updated = it.updated_at ? new Date(it.updated_at).toLocaleString("zh-CN") : "—";
            return `<tr>
              <td>${escapeHtml(ym)}</td>
              <td>${escapeHtml(title)}</td>
              <td>${escapeHtml(archived)}</td>
              <td>${escapeHtml(updated)}</td>
              <td><button type="button" class="action mr-archive-open" data-ir-archive-open="${escapeAttr(ym)}">查看</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }
  return `
    <section class="mr-archive-page" aria-label="改进报告归档">
      <div class="mr-toolbar">
        <span class="mr-toolbar-title">改进报告归档</span>
        <span class="mr-toolbar-spacer"></span>
        <button type="button" class="action" id="ir-archive-reload-btn">刷新</button>
      </div>
      ${renderBanner()}
      ${body}
    </section>`;
}

export function bindImprovementReportArchivePage(navigateTo) {
  const reload = document.getElementById("ir-archive-reload-btn");
  if (reload) reload.addEventListener("click", () => loadImprovementReportArchives());
  document.querySelectorAll("[data-ir-archive-open]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const ym = ev.target.getAttribute("data-ir-archive-open");
      if (ym && typeof navigateTo === "function") {
        navigateTo(ym);
      }
    });
  });
}
