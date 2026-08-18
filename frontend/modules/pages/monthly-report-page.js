/**
 * 现网重大问题月度分析报告 - 5 段式可编辑页（Excel 风格）
 *
 * - 路由 key：report:generate（编辑页）/ report:archive（归档列表）
 * - 数据接口：/api/monthly-report/{ym} (GET/PUT/POST archive)
 * - 5 段：overview / insight / major / improve / links；分段独立编辑保存
 * - 图表：ECharts
 * - 导出：单 HTML（含图表 PNG 内联），可直接粘贴邮件正文
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
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { getCurrentOperator } from "../core/auth.js";

// ---------- 常量 ----------

export const SECTION_KEYS = ["overview", "insight", "major", "improve", "links"];
export const SECTION_LABELS = {
  overview: "一、整体概况",
  insight: "二、问题透视",
  major: "三、重大问题",
  improve: "四、改进诉求",
  links: "五、问题详情&质量改进记录",
};
export const MAJOR_TYPES = [
  { key: "coredump", label: "coredump" },
  { key: "consistency", label: "数据正确性&一致性" },
  { key: "full", label: "满" },
  { key: "hang_slow", label: "hang/慢" },
  { key: "escalation", label: "升级" },
];
// 第一列「重大问题类型」由分组自动填入（rowspan 合并），实际可编辑列为后 9 列
export const MAJOR_COLUMNS = [
  "重大问题类型", "局点", "版本", "问题编号", "问题描述",
  "根因/进展", "问题影响", "问题领域", "模块/特性", "责任XM",
];
// 列宽（百分比，合计 100）：表格固定布局 + 内容换行，避免横向滚动条。
// 局点加宽、问题编号收窄；问题描述与根因/进展等宽且最大；影响/领域/模块/责任XM 等宽。
export const MAJOR_COL_WIDTHS = ["7%", "12%", "6%", "9%", "15%", "15%", "9%", "9%", "9%", "9%"];
// 第四段表格：本月质量改进记录（关联工单 = 问题详情入口）
export const IMPROVE_COLUMNS = ["关联工单", "QI编号", "改进标题", "分类", "领域", "提出人"];
export const IMPROVE_COL_WIDTHS = ["12%", "12%", "26%", "12%", "14%", "24%"];

// 默认模板数据：保证用户首次打开就能看到完整结构与示例
export function defaultSectionData(section) {
  if (section === "overview") {
    return {
      banner_product: "xxxx",
      banner_drafter: "xxx",
      banner_reviewer: "yyy",
      major_events: "本月共发生 0 起重大管理升级与事故。",
      problem_analysis: "本月问题总体特征、分布与趋势分析。",
      risk_modules: "重点风险模块：（请补充模块和特性）",
      quality_feedback: "质量改进识别与反馈：（请补充）",
    };
  }
  if (section === "insight") {
    return {
      kpi: { total_count: 0, known_count: 0, new_count: 0, pansh_count: 0, pansh_total: 0 },
      impact_categories: [
        { name: "可用性", value: 0 },
        { name: "性能", value: 0 },
        { name: "数据正确性", value: 0 },
        { name: "易用性", value: 0 },
        { name: "安全", value: 0 },
      ],
      top_modules: [
        { name: "SQL 引擎", value: 0 },
        { name: "存储引擎", value: 0 },
        { name: "优化器", value: 0 },
        { name: "事务", value: 0 },
        { name: "网络", value: 0 },
        { name: "管控", value: 0 },
        { name: "备份恢复", value: 0 },
        { name: "高可用", value: 0 },
        { name: "安全", value: 0 },
        { name: "其他", value: 0 },
      ],
      top1_breakdown: [
        { name: "示例-子项A", value: 0 },
        { name: "示例-子项B", value: 0 },
      ],
      top2_breakdown: [
        { name: "示例-子项A", value: 0 },
        { name: "示例-子项B", value: 0 },
      ],
    };
  }
  if (section === "major") {
    const types = {};
    MAJOR_TYPES.forEach((t) => { types[t.key] = []; });
    return { types };
  }
  if (section === "improve") {
    return {
      module_distribution: [
        { name: "SQL", value: 0 },
        { name: "存储", value: 0 },
        { name: "优化器", value: 0 },
        { name: "事务", value: 0 },
        { name: "管控", value: 0 },
        { name: "其他", value: 0 },
      ],
      sql_items: [
        { name: "执行计划稳定性", value: 0 },
        { name: "并行查询", value: 0 },
        { name: "索引下推", value: 0 },
      ],
      storage_items: [
        { name: "压缩", value: 0 },
        { name: "回收站", value: 0 },
        { name: "checkpoint 性能", value: 0 },
      ],
      records: [],
    };
  }
  if (section === "links") {
    return { content: "" };
  }
  return {};
}

// ---------- 工具：当前月 ----------

export function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ymToTitle(ym) {
  if (!/^\d{6}$/.test(String(ym))) return "";
  return `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月报`;
}

// ---------- Tab ----------

export function ensureMonthlyReportTab() {
  const key = "report:generate";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "报告生成", closable: true });
  }
  return key;
}

export function ensureMonthlyReportArchiveTab() {
  const key = "report:archive";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "报告归档", closable: true });
  }
  return key;
}

// ---------- 状态辅助 ----------

function setMsg(msg, type = "info") {
  state.monthlyReportMsg = String(msg || "");
  state.monthlyReportMsgType = type;
}

function getSectionData(section) {
  const data = state.monthlyReportData;
  const colMap = {
    overview: "section_overview",
    insight: "section_insight",
    major: "section_major",
    improve: "section_improve",
    links: "section_links",
  };
  const col = colMap[section];
  if (!data || !col) return defaultSectionData(section);
  const raw = data[col];
  if (!raw || (typeof raw === "object" && Object.keys(raw).length === 0)) {
    return defaultSectionData(section);
  }
  return raw;
}

function setSectionDraft(section, value) {
  state.monthlyReportDrafts[section] = value;
}

function getSectionDraft(section) {
  return state.monthlyReportDrafts[section];
}

function activeSectionData(section) {
  const draft = getSectionDraft(section);
  if (draft != null) return draft;
  return getSectionData(section);
}

// ---------- API ----------

function reportOperatorId() {
  return String(getCurrentOperator().account || "").trim();
}

async function apiFetchReport(ym) {
  const op = reportOperatorId();
  const qs = op ? `?operator_id=${encodeURIComponent(op)}` : "";
  const resp = await fetch(`${API_BASE_URL}/api/monthly-report/${encodeURIComponent(ym)}${qs}`);
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiSaveSection(ym, section, data) {
  const resp = await fetch(`${API_BASE_URL}/api/monthly-report/${encodeURIComponent(ym)}/sections`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, data, operator_id: reportOperatorId() }),
  });
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiImportSection(ym, section) {
  const op = reportOperatorId();
  const qs = op ? `?operator_id=${encodeURIComponent(op)}` : "";
  const resp = await fetch(`${API_BASE_URL}/api/monthly-report/${encodeURIComponent(ym)}/import/${encodeURIComponent(section)}${qs}`);
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiArchiveReport(ym, title) {
  const resp = await fetch(`${API_BASE_URL}/api/monthly-report/${encodeURIComponent(ym)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, operator_id: reportOperatorId() }),
  });
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiUnarchiveReport(ym) {
  const op = reportOperatorId();
  const qs = op ? `?operator_id=${encodeURIComponent(op)}` : "";
  const resp = await fetch(`${API_BASE_URL}/api/monthly-report/${encodeURIComponent(ym)}/archive${qs}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

async function apiListReports(status) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const op = reportOperatorId();
  if (op) params.set("operator_id", op);
  const qs = params.toString();
  const url = `${API_BASE_URL}/api/monthly-report${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(await parseApiError(resp));
  return resp.json();
}

// ---------- 数据加载 ----------

export async function loadMonthlyReport(ym) {
  state.monthlyReportLoading = true;
  state.monthlyReportYm = ym;
  state.monthlyReportDrafts = { overview: null, insight: null, major: null, improve: null, links: null };
  state.monthlyReportEditing = { overview: false, insight: false, major: false, improve: false, links: false };
  requestRender();
  try {
    const data = await apiFetchReport(ym);
    state.monthlyReportData = data;
    setMsg("");
  } catch (err) {
    state.monthlyReportData = null;
    setMsg(`加载月度报告失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.monthlyReportLoading = false;
    requestRender();
  }
}

export async function loadMonthlyReportArchives() {
  state.monthlyReportArchiveLoading = true;
  requestRender();
  try {
    const resp = await apiListReports("archived");
    state.monthlyReportArchiveList = resp.items || [];
  } catch (err) {
    state.monthlyReportArchiveList = [];
    setMsg(`加载归档列表失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.monthlyReportArchiveLoading = false;
    requestRender();
  }
}

// ---------- 渲染：工具栏 ----------

function renderToolbar() {
  const ym = state.monthlyReportYm || currentYm();
  const data = state.monthlyReportData;
  const isArchived = data && data.status === "archived";
  const statusBadge = isArchived
    ? `<span class="mr-status mr-status--archived">已归档</span>`
    : `<span class="mr-status mr-status--draft">草稿</span>`;
  return `
    <div class="mr-toolbar">
      <label class="mr-month-label">报告月份
        <input type="month" id="mr-month-input" class="mr-month-input"
               value="${escapeAttr(`${ym.slice(0, 4)}-${ym.slice(4)}`)}" />
      </label>
      ${statusBadge}
      <span class="mr-toolbar-spacer"></span>
      <button type="button" class="action" id="mr-reload-btn">刷新</button>
      <button type="button" class="action" id="mr-export-btn">导出 HTML</button>
      <button type="button" class="action" id="mr-export-xlsx-btn">导出 Excel</button>
      ${isArchived
        ? `<button type="button" class="action" id="mr-unarchive-btn">取消归档</button>`
        : `<button type="button" class="action primary" id="mr-archive-btn">归档为月报</button>`}
    </div>`;
}

function renderBanner() {
  const msg = String(state.monthlyReportMsg || "");
  if (!msg) return "";
  const type = String(state.monthlyReportMsgType || "info");
  return `<div class="mr-banner mr-banner--${escapeAttr(type)}" role="status">${escapeHtml(msg)}</div>`;
}

function renderTitleBanner() {
  const editing = !!state.monthlyReportEditing.overview;
  const saving = !!(state.monthlyReportSaving && state.monthlyReportSaving.overview);
  const isArchived = !!(state.monthlyReportData && state.monthlyReportData.status === "archived");
  const overview = activeSectionData("overview");
  const product = String(overview.banner_product == null ? "xxxx" : overview.banner_product);
  const drafter = String(overview.banner_drafter == null ? "xxx" : overview.banner_drafter);
  const reviewer = String(overview.banner_reviewer == null ? "yyy" : overview.banner_reviewer);
  const ym = String((state.monthlyReportData && state.monthlyReportData.report_month) || "");
  const monthLabel = /^\d{6}$/.test(ym)
    ? `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月`
    : "202x年x月";
  const main = editing
    ? `<input class="mr-title-banner-input mr-title-banner-input--main" data-mr-overview-field="banner_product" value="${escapeAttr(product)}" placeholder="项目名" />现网重大问题月度分析（${escapeHtml(monthLabel)}）`
    : `${escapeHtml(product)}现网重大问题月度分析（${escapeHtml(monthLabel)}）`;
  const sub = editing
    ? `拟制:<input class="mr-title-banner-input" data-mr-overview-field="banner_drafter" value="${escapeAttr(drafter)}" />&nbsp;&nbsp;审核:<input class="mr-title-banner-input" data-mr-overview-field="banner_reviewer" value="${escapeAttr(reviewer)}" />`
    : `拟制:${escapeHtml(drafter)}&nbsp;&nbsp;审核:${escapeHtml(reviewer)}`;
  const actions = isArchived
    ? ""
    : editing
      ? `<button type="button" class="action primary mr-section-save" data-mr-save="overview" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
         <button type="button" class="action mr-section-cancel" data-mr-cancel="overview" ${saving ? "disabled" : ""}>取消</button>`
      : `<button type="button" class="action mr-section-edit" data-mr-edit="overview">编辑</button>`;
  return `
    <div class="mr-title-banner">
      <div class="mr-title-banner-actions">${actions}</div>
      <div class="mr-title-banner-main">${main}</div>
      <div class="mr-title-banner-sub">${sub}</div>
    </div>`;
}

// 支持「导入」的段：从本月工单/质量改进聚合计算后填入草稿。
const IMPORTABLE_SECTIONS = { insight: true, major: true, improve: true };

function renderSectionHeader(section) {
  const editing = !!state.monthlyReportEditing[section];
  const saving = !!state.monthlyReportSaving[section];
  const importing = !!(state.monthlyReportImporting && state.monthlyReportImporting[section]);
  const isArchived = state.monthlyReportData && state.monthlyReportData.status === "archived";
  // 导入按钮置于「编辑本段」左侧；归档或编辑中不展示。
  const importBtn = (!isArchived && !editing && IMPORTABLE_SECTIONS[section])
    ? `<button type="button" class="action mr-section-import" data-mr-import="${section}" ${importing ? "disabled" : ""}>${importing ? "导入中…" : "导入"}</button>`
    : "";
  const editBtn = isArchived
    ? ""
    : editing
      ? `<button type="button" class="action primary mr-section-save" data-mr-save="${section}" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存本段"}</button>
         <button type="button" class="action mr-section-cancel" data-mr-cancel="${section}" ${saving ? "disabled" : ""}>取消</button>`
      : `<button type="button" class="action mr-section-edit" data-mr-edit="${section}">编辑本段</button>`;
  return `
    <div class="mr-section-head">
      <h3 class="mr-section-title">${escapeHtml(SECTION_LABELS[section])}</h3>
      <div class="mr-section-actions">${importBtn}${editBtn}</div>
    </div>`;
}

// ---------- 渲染：第一段 整体概况 ----------

function renderSectionOverview() {
  const editing = !!state.monthlyReportEditing.overview;
  const data = activeSectionData("overview");
  const fields = [
    { key: "major_events", num: "1.1", label: "重大管理升级 & 事故" },
    { key: "problem_analysis", num: "1.2", label: "问题分析" },
    { key: "risk_modules", num: "1.3", label: "风险模块和特性" },
    { key: "quality_feedback", num: "1.4", label: "质量改进识别反馈" },
  ];
  const body = fields.map((f) => {
    const val = String(data[f.key] || "");
    const heading = `<span class="mr-overview-num">${escapeHtml(f.num)}</span> ${escapeHtml(f.label)}`;
    if (editing) {
      return `<div class="mr-overview-block">
        <label class="mr-overview-label">${heading}</label>
        ${renderRichEditable(val, `data-mr-overview-field="${f.key}"`, { cls: "mr-overview-text", placeholder: "请填写…" })}
      </div>`;
    }
    return `<div class="mr-overview-block">
      <div class="mr-overview-label">${heading}</div>
      <div class="mr-overview-readonly">${val.trim() ? renderRichReadonly(val) : '<span class="mr-empty-hint">（暂无）</span>'}</div>
    </div>`;
  }).join("");
  return `
    <section class="mr-section mr-section--overview">
      ${renderSectionHeader("overview")}
      ${editing ? renderRichToolbar() : ""}
      <div class="mr-overview-grid">${body}</div>
    </section>`;
}

// ---------- 渲染：第二段 问题透视 ----------

function renderInsightKpi(kpi) {
  const total = Number(kpi.total_count || 0);
  const known = Number(kpi.known_count || 0);
  const newCnt = Number(kpi.new_count || 0);
  const pansh = Number(kpi.pansh_count || 0);
  const panshTotal = Number(kpi.pansh_total || 0);
  const knownPct = total > 0 ? ((known / total) * 100).toFixed(1) : "0.0";
  const panshPct = panshTotal > 0 ? ((pansh / panshTotal) * 100).toFixed(1) : "0.0";
  return `
    <div class="mr-insight-kpi-row">
      <div class="mr-kpi-card"><div class="mr-kpi-label">问题总数</div><div class="mr-kpi-value">${total}</div></div>
      <div class="mr-kpi-card"><div class="mr-kpi-label">已知质量问题</div><div class="mr-kpi-value">${known}</div></div>
      <div class="mr-kpi-card"><div class="mr-kpi-label">新发现问题</div><div class="mr-kpi-value">${newCnt}</div></div>
      <div class="mr-kpi-card"><div class="mr-kpi-label">已知问题占比</div><div class="mr-kpi-value">${knownPct}%</div></div>
      <div class="mr-kpi-card"><div class="mr-kpi-label">磐石版本涉及</div><div class="mr-kpi-value">${pansh} / ${panshTotal} (${panshPct}%)</div></div>
    </div>`;
}

function renderInsightDataEditor(data) {
  const j = JSON.stringify(data, null, 2);
  return `
    <div class="mr-insight-editor">
      <div class="mr-insight-editor-hint">直接编辑下方 JSON 数据，保存后图表自动刷新。字段：kpi / impact_categories / top_modules / top1_breakdown / top2_breakdown</div>
      <textarea id="mr-insight-json" class="mr-insight-json">${escapeHtml(j)}</textarea>
    </div>`;
}

function renderSectionInsight() {
  const editing = !!state.monthlyReportEditing.insight;
  const data = activeSectionData("insight");
  const kpi = data.kpi || {};
  const charts = `
    <div class="mr-insight-chart-grid">
      <div class="mr-chart-card"><div class="mr-chart-title">Top 问题影响分类</div><div class="mr-chart-host" id="mr-chart-impact"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">Top10 质量模块和特性</div><div class="mr-chart-host" id="mr-chart-top-modules"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">Top1 模块细化分析</div><div class="mr-chart-host" id="mr-chart-top1"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">Top2 模块细化分析</div><div class="mr-chart-host" id="mr-chart-top2"></div></div>
    </div>`;
  return `
    <section class="mr-section mr-section--insight">
      ${renderSectionHeader("insight")}
      ${renderInsightKpi(kpi)}
      ${editing ? renderInsightDataEditor(data) : ""}
      ${charts}
    </section>`;
}

// ---------- 渲染：第三段 重大问题 ----------

function renderSectionMajor() {
  const editing = !!state.monthlyReportEditing.major;
  const data = activeSectionData("major");
  const types = data.types || {};
  const head = MAJOR_COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const opHead = editing ? `<th class="mr-row-op">操作</th>` : "";
  const colGroup = `<colgroup>${MAJOR_COL_WIDTHS.map((w) => `<col style="width:${w}" />`).join("")}${editing ? `<col style="width:52px" />` : ""}</colgroup>`;
  const bodyRows = [];
  MAJOR_TYPES.forEach((t) => {
    const rows = types[t.key] || [];
    if (rows.length === 0) {
      const tds = [`<td class="mr-major-type-cell">${escapeHtml(t.label)}</td>`];
      for (let ci = 1; ci < MAJOR_COLUMNS.length; ci++) {
        tds.push(`<td class="mr-empty-cell">—</td>`);
      }
      if (editing) tds.push(`<td class="mr-row-op"></td>`);
      bodyRows.push(`<tr class="mr-major-row--empty">${tds.join("")}</tr>`);
      return;
    }
    rows.forEach((row, i) => {
      const tds = [];
      if (i === 0) {
        tds.push(`<td class="mr-major-type-cell" rowspan="${rows.length}">${escapeHtml(t.label)}</td>`);
      }
      for (let ci = 1; ci < MAJOR_COLUMNS.length; ci++) {
        const col = MAJOR_COLUMNS[ci];
        const v = String(row[col] != null ? row[col] : "");
        if (editing) {
          tds.push(`<td>${renderRichEditable(v, `data-mr-major="${t.key}" data-mr-row="${i}" data-mr-col="${ci}"`, { cls: "mr-cell-input" })}</td>`);
        } else {
          tds.push(`<td>${renderRichReadonly(v)}</td>`);
        }
      }
      if (editing) {
        tds.push(`<td class="mr-row-op"><button type="button" class="mr-row-del" data-mr-major-del="${t.key}" data-mr-row="${i}">删除</button></td>`);
      }
      bodyRows.push(`<tr>${tds.join("")}</tr>`);
    });
  });
  const addBar = editing
    ? `<div class="mr-major-add-bar">${MAJOR_TYPES.map((t) => `<button type="button" class="action mr-row-add" data-mr-major-add="${t.key}">+ ${escapeHtml(t.label)}</button>`).join("")}</div>`
    : "";
  return `
    <section class="mr-section mr-section--major">
      ${renderSectionHeader("major")}
      ${editing ? renderRichToolbar() : ""}
      ${addBar}
      <div class="mr-major-table-wrap">
        <table class="mr-major-table">
          ${colGroup}
          <thead><tr>${head}${opHead}</tr></thead>
          <tbody>${bodyRows.join("")}</tbody>
        </table>
      </div>
    </section>`;
}

// ---------- 渲染：第四段 改进诉求 ----------

function renderImproveCell(col, row, editing, rowIdx, colIdx) {
  const v = String(row[col] != null ? row[col] : "");
  if (editing) {
    return `<td>${renderRichEditable(v, `data-mr-improve="row" data-mr-row="${rowIdx}" data-mr-col="${colIdx}"`, { cls: "mr-cell-input" })}</td>`;
  }
  if (col === "关联工单" && v.trim()) {
    const href = `/tickets/${encodeURIComponent(v.trim())}`;
    return `<td><a class="mr-links-jump" href="${escapeAttr(href)}" data-mr-ticket-link="${escapeAttr(v.trim())}">${renderRichReadonly(v)}</a></td>`;
  }
  if (col === "QI编号" && v.trim()) {
    const qiId = Number(row._qi_id || 0);
    if (qiId > 0) {
      const href = `/qi/${qiId}`;
      return `<td><a class="mr-links-jump" href="${escapeAttr(href)}" data-mr-qi-link="${qiId}">${renderRichReadonly(v)}</a></td>`;
    }
  }
  return `<td>${renderRichReadonly(v)}</td>`;
}

function renderImproveTable(rows, editing) {
  const head = IMPROVE_COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const opHead = editing ? `<th class="mr-row-op">操作</th>` : "";
  const colGroup = `<colgroup>${IMPROVE_COL_WIDTHS.map((w) => `<col${w ? ` style="width:${w}"` : ""} />`).join("")}${editing ? `<col style="width:52px" />` : ""}</colgroup>`;
  const totalCols = IMPROVE_COLUMNS.length + (editing ? 1 : 0);
  const addBtn = editing
    ? `<button type="button" class="action mr-row-add mr-improve-title-add" data-mr-improve-add="1">+ 新增一行</button>`
    : "";
  const titleRow = `<tr class="mr-improve-title-row"><th colspan="${totalCols}" class="mr-improve-title-cell">本月质量改进记录${addBtn}</th></tr>`;
  let body = "";
  if (!rows.length) {
    body = `<tr><td class="mr-empty-cell" colspan="${totalCols}">本月暂无质量改进记录，可点「导入」从质量改进模块拉取</td></tr>`;
  } else {
    body = rows.map((row, i) => {
      const cells = IMPROVE_COLUMNS.map((col, ci) => renderImproveCell(col, row, editing, i, ci)).join("");
      const opCell = editing
        ? `<td class="mr-row-op"><button type="button" class="mr-row-del" data-mr-improve-del="${i}">删除</button></td>`
        : "";
      return `<tr>${cells}${opCell}</tr>`;
    }).join("");
  }
  return `
    <div class="mr-improve-table-wrap">
      <table class="mr-major-table">
        ${colGroup}
        <thead>
          ${titleRow}
          <tr>${head}${opHead}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderSectionImprove() {
  const editing = !!state.monthlyReportEditing.improve;
  const data = activeSectionData("improve");
  const charts = `
    <div class="mr-improve-chart-grid">
      <div class="mr-chart-card"><div class="mr-chart-title">改进诉求领域占比</div><div class="mr-chart-host" id="mr-chart-improve-mod"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">SQL 领域改进</div><div class="mr-chart-host" id="mr-chart-improve-sql"></div></div>
      <div class="mr-chart-card"><div class="mr-chart-title">存储领域改进</div><div class="mr-chart-host" id="mr-chart-improve-storage"></div></div>
    </div>`;
  return `
    <section class="mr-section mr-section--improve">
      ${renderSectionHeader("improve")}
      ${editing ? renderRichToolbar() : ""}
      ${charts}
      ${renderImproveTable(Array.isArray(data.records) ? data.records : [], editing)}
    </section>`;
}

// ---------- 渲染：第五段 问题详情&质量改进记录 ----------

function renderSectionLinks() {
  const editing = !!state.monthlyReportEditing.links;
  const data = activeSectionData("links");
  const content = String(data.content || "");
  let body;
  if (editing) {
    body = `${renderRichToolbar()}${renderRichEditable(content, "data-mr-links-content", { cls: "mr-overview-text mr-links-edit", placeholder: "请填写问题详情与质量改进记录…" })}`;
  } else if (content.trim()) {
    body = `<div class="mr-overview-readonly">${renderRichReadonly(content)}</div>`;
  } else {
    body = `<div class="mr-empty-hint">暂无内容，点击「编辑本段」可填写。</div>`;
  }
  return `
    <section class="mr-section mr-section--links">
      ${renderSectionHeader("links")}
      ${body}
    </section>`;
}

// ---------- 总入口渲染 ----------

export function renderMonthlyReportPage() {
  if (state.monthlyReportLoading && !state.monthlyReportData) {
    return `<section class="mr-page">${renderToolbar()}<div class="mr-loading">加载中…</div></section>`;
  }
  if (!state.monthlyReportData) {
    return `<section class="mr-page">${renderToolbar()}${renderBanner()}<div class="mr-loading">未能加载报告，请点击刷新。</div></section>`;
  }
  return `
    <section class="mr-page" aria-label="现网重大问题月度分析报告">
      ${renderToolbar()}
      ${renderBanner()}
      ${renderTitleBanner()}
      ${renderSectionOverview()}
      ${renderSectionInsight()}
      ${renderSectionMajor()}
      ${renderSectionImprove()}
      ${renderSectionLinks()}
    </section>`;
}

// ---------- ECharts 渲染 ----------

let chartInstances = {};

function isDarkUiTheme() {
  return typeof document !== "undefined"
    && document.documentElement.getAttribute("data-theme") === "dark";
}

function chartInk() {
  if (isDarkUiTheme()) {
    return {
      text: "#e2e8f0",
      muted: "#94a3b8",
      split: "rgba(148,163,184,0.18)",
    };
  }
  return {
    text: "#2f2b25",
    muted: "#5d5a55",
    split: "rgba(0,0,0,0.08)",
  };
}

function disposeAllCharts() {
  Object.keys(chartInstances).forEach((k) => {
    try { chartInstances[k].dispose(); } catch (_) { /* ignore */ }
  });
  chartInstances = {};
}

function buildPieOption(title, items) {
  const ink = chartInk();
  return {
    backgroundColor: "transparent",
    textStyle: { color: ink.text },
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    // 左右结构：饼图居左、图例竖排居右，避免数据项多时图例与饼图重叠
    legend: {
      orient: "vertical",
      right: 4,
      top: "middle",
      type: "scroll",
      height: "90%",
      textStyle: { color: ink.text },
    },
    series: [{
      name: title,
      type: "pie",
      radius: ["38%", "62%"],
      center: ["36%", "50%"],
      avoidLabelOverlap: true,
      label: { show: true, formatter: "{d}%", color: ink.text },
      data: (items || []).map((d) => ({ name: String(d.name || ""), value: Number(d.value || 0) })),
    }],
  };
}

function buildBarOption(items, opts = {}) {
  const data = (items || []).slice().sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  const ink = chartInk();
  return {
    backgroundColor: "transparent",
    textStyle: { color: ink.text },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 80, right: 24, top: 24, bottom: 24, containLabel: true },
    xAxis: opts.horizontal
      ? {
          type: "value",
          axisLabel: { color: ink.muted },
          splitLine: { lineStyle: { color: ink.split } },
        }
      : {
          type: "category",
          data: data.map((d) => d.name),
          axisLabel: { interval: 0, rotate: 28, color: ink.muted },
        },
    yAxis: opts.horizontal
      ? {
          type: "category",
          data: data.map((d) => d.name).reverse(),
          axisLabel: { color: ink.text },
        }
      : {
          type: "value",
          axisLabel: { color: ink.muted },
          splitLine: { lineStyle: { color: ink.split } },
        },
    series: [{
      type: "bar",
      data: opts.horizontal
        ? data.map((d) => Number(d.value || 0)).reverse()
        : data.map((d) => Number(d.value || 0)),
      barMaxWidth: 28,
      itemStyle: { color: opts.color || "#3f86ff" },
      label: { show: true, position: opts.horizontal ? "right" : "top", color: ink.text },
    }],
  };
}

function mountInsightCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const data = activeSectionData("insight");
  const map = {
    "mr-chart-impact": buildBarOption(data.impact_categories, { color: "#5b8def" }),
    "mr-chart-top-modules": buildBarOption(data.top_modules, { color: "#36c5b0" }),
    "mr-chart-top1": buildBarOption(data.top1_breakdown, { color: "#ff8a3d" }),
    "mr-chart-top2": buildBarOption(data.top2_breakdown, { color: "#a26bff" }),
  };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const inst = E.init(el, null, { renderer: "canvas" });
    inst.setOption(map[id]);
    chartInstances[id] = inst;
  });
}

function mountImproveCharts() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const data = activeSectionData("improve");
  const map = {
    "mr-chart-improve-mod": buildPieOption("领域占比", data.module_distribution),
    "mr-chart-improve-sql": buildBarOption(data.sql_items, { color: "#3fb27f" }),
    "mr-chart-improve-storage": buildBarOption(data.storage_items, { color: "#ec7373" }),
  };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const inst = E.init(el, null, { renderer: "canvas" });
    inst.setOption(map[id]);
    chartInstances[id] = inst;
  });
}

export function mountMonthlyReportCharts() {
  disposeAllCharts();
  mountInsightCharts();
  mountImproveCharts();
}

// ---------- 编辑/保存 ----------

function startEdit(section) {
  state.monthlyReportEditing[section] = true;
  state.monthlyReportDrafts[section] = JSON.parse(JSON.stringify(getSectionData(section)));
  requestRender();
}

function cancelEdit(section) {
  state.monthlyReportEditing[section] = false;
  state.monthlyReportDrafts[section] = null;
  requestRender();
}

async function saveSection(section) {
  const ym = state.monthlyReportYm;
  if (!ym) { setMsg("尚未选择月份。", "error"); requestRender(); return; }
  const draft = getSectionDraft(section);
  if (draft == null) { setMsg("没有变更需要保存。", "info"); requestRender(); return; }
  state.monthlyReportSaving[section] = true;
  requestRender();
  try {
    const updated = await apiSaveSection(ym, section, draft);
    state.monthlyReportData = updated;
    state.monthlyReportEditing[section] = false;
    state.monthlyReportDrafts[section] = null;
    setMsg(`「${SECTION_LABELS[section]}」已保存。`, "success");
  } catch (err) {
    setMsg(`保存失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.monthlyReportSaving[section] = false;
    requestRender();
  }
}

// 从本月数据聚合导入：填入草稿并进入编辑态，由用户核对后再「保存本段」。
// insight/major 来自工单；improve 来自「质量改进」(qi_request)。
async function importSection(section) {
  const ym = state.monthlyReportYm;
  if (!ym) { setMsg("尚未选择月份。", "error"); requestRender(); return; }
  if (!state.monthlyReportImporting) state.monthlyReportImporting = {};
  state.monthlyReportImporting[section] = true;
  const fromLabel = section === "improve" ? "质量改进" : "工单";
  setMsg(`正在从 ${ym} 月${fromLabel}计算「${SECTION_LABELS[section]}」…`, "info");
  requestRender();
  try {
    const imported = await apiImportSection(ym, section);
    if (section === "insight") {
      // 磐石版本不计算，保留原有手填值
      const prev = getSectionData("insight");
      const prevKpi = (prev && prev.kpi) || {};
      imported.kpi = imported.kpi || {};
      imported.kpi.pansh_count = Number(prevKpi.pansh_count || 0);
      imported.kpi.pansh_total = Number(prevKpi.pansh_total || 0);
    }
    state.monthlyReportDrafts[section] = imported;
    state.monthlyReportEditing[section] = true;
    setMsg(`已从本月${fromLabel}导入「${SECTION_LABELS[section]}」数据，请核对后点击「保存本段」。`, "success");
  } catch (err) {
    setMsg(`导入失败：${err && err.message ? err.message : err}`, "error");
  } finally {
    state.monthlyReportImporting[section] = false;
    requestRender();
  }
}

// ---------- 绑定 ----------

function bindOverviewEditor() {
  document.querySelectorAll("[data-mr-overview-field]").forEach((el) => {
    el.addEventListener("input", (ev) => {
      const field = ev.target.getAttribute("data-mr-overview-field");
      let draft = getSectionDraft("overview");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("overview")));
      draft[field] = ev.target.isContentEditable ? sanitizeRichHtml(ev.target.innerHTML) : ev.target.value;
      setSectionDraft("overview", draft);
    });
  });
}

function bindInsightEditor() {
  const ta = document.getElementById("mr-insight-json");
  if (!ta) return;
  ta.addEventListener("input", (ev) => {
    const txt = ev.target.value;
    try {
      const parsed = JSON.parse(txt);
      setSectionDraft("insight", parsed);
      ta.classList.remove("mr-json-error");
    } catch (_) {
      ta.classList.add("mr-json-error");
    }
  });
}

function bindMajorEditor() {
  document.querySelectorAll("[data-mr-major]").forEach((el) => {
    el.addEventListener("input", (ev) => {
      const typeKey = ev.target.getAttribute("data-mr-major");
      const rowIdx = Number(ev.target.getAttribute("data-mr-row"));
      const colIdx = Number(ev.target.getAttribute("data-mr-col"));
      let draft = getSectionDraft("major");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("major")));
      if (!draft.types) draft.types = {};
      if (!Array.isArray(draft.types[typeKey])) draft.types[typeKey] = [];
      const row = draft.types[typeKey][rowIdx] || {};
      row[MAJOR_COLUMNS[colIdx]] = sanitizeRichHtml(ev.target.innerHTML);
      draft.types[typeKey][rowIdx] = row;
      setSectionDraft("major", draft);
    });
  });
  document.querySelectorAll("[data-mr-major-add]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const typeKey = ev.target.getAttribute("data-mr-major-add");
      let draft = getSectionDraft("major");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("major")));
      if (!draft.types) draft.types = {};
      if (!Array.isArray(draft.types[typeKey])) draft.types[typeKey] = [];
      const row = {};
      // 第一列「重大问题类型」由分组隐式表达，不写入 row
      for (let i = 1; i < MAJOR_COLUMNS.length; i++) row[MAJOR_COLUMNS[i]] = "";
      draft.types[typeKey].push(row);
      setSectionDraft("major", draft);
      requestRender();
    });
  });
  document.querySelectorAll("[data-mr-major-del]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const typeKey = ev.target.getAttribute("data-mr-major-del");
      const rowIdx = Number(ev.target.getAttribute("data-mr-row"));
      let draft = getSectionDraft("major");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("major")));
      if (Array.isArray(draft.types[typeKey])) {
        draft.types[typeKey].splice(rowIdx, 1);
      }
      setSectionDraft("major", draft);
      requestRender();
    });
  });
}

function bindImproveEditor() {
  document.querySelectorAll("[data-mr-improve='row']").forEach((el) => {
    el.addEventListener("input", (ev) => {
      const rowIdx = Number(ev.target.getAttribute("data-mr-row"));
      const colIdx = Number(ev.target.getAttribute("data-mr-col"));
      let draft = getSectionDraft("improve");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("improve")));
      if (!Array.isArray(draft.records)) draft.records = [];
      const row = draft.records[rowIdx] || {};
      row[IMPROVE_COLUMNS[colIdx]] = sanitizeRichHtml(ev.target.innerHTML);
      draft.records[rowIdx] = row;
      setSectionDraft("improve", draft);
    });
  });
  document.querySelectorAll("[data-mr-improve-add]").forEach((el) => {
    el.addEventListener("click", () => {
      let draft = getSectionDraft("improve");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("improve")));
      if (!Array.isArray(draft.records)) draft.records = [];
      const row = {};
      IMPROVE_COLUMNS.forEach((c) => { row[c] = ""; });
      draft.records.push(row);
      setSectionDraft("improve", draft);
      requestRender();
    });
  });
  document.querySelectorAll("[data-mr-improve-del]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const rowIdx = Number(ev.target.getAttribute("data-mr-improve-del"));
      let draft = getSectionDraft("improve");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("improve")));
      if (Array.isArray(draft.records)) draft.records.splice(rowIdx, 1);
      setSectionDraft("improve", draft);
      requestRender();
    });
  });
  document.querySelectorAll("a.mr-links-jump[href]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      const href = el.getAttribute("href") || "";
      if (!href.startsWith("/")) return;
      ev.preventDefault();
      history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  });
}

function bindLinksEditor() {
  document.querySelectorAll("[data-mr-links-content]").forEach((el) => {
    el.addEventListener("input", (ev) => {
      let draft = getSectionDraft("links");
      if (!draft) draft = JSON.parse(JSON.stringify(getSectionData("links")));
      draft.content = sanitizeRichHtml(ev.target.innerHTML);
      setSectionDraft("links", draft);
    });
  });
}

// ---------- 导出 ----------

function buildExportHtml() {
  const ym = state.monthlyReportYm || currentYm();
  const title = ymToTitle(ym);
  const data = state.monthlyReportData || {};
  const overview = data.section_overview || defaultSectionData("overview");
  const insight = data.section_insight || defaultSectionData("insight");
  const major = data.section_major || defaultSectionData("major");
  const improve = data.section_improve || defaultSectionData("improve");
  const links = data.section_links || defaultSectionData("links");

  // 把当前已渲染的图表导出为 PNG dataURL
  const chartImgs = {};
  Object.keys(chartInstances).forEach((id) => {
    try { chartImgs[id] = chartInstances[id].getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }); }
    catch (_) { /* ignore */ }
  });
  const img = (id) => chartImgs[id] ? `<img src="${chartImgs[id]}" alt="${id}" style="max-width:100%;height:auto;border:1px solid #ddd;"/>` : "";

  const overviewBlocks = [
    ["1.1", "重大管理升级 & 事故", overview.major_events],
    ["1.2", "问题分析", overview.problem_analysis],
    ["1.3", "风险模块和特性", overview.risk_modules],
    ["1.4", "质量改进识别反馈", overview.quality_feedback],
  ].map(([n, k, v]) => `<tr><th style="background:#f5f7fa;text-align:left;padding:8px 14px;border:1px solid #ccc;width:1%;white-space:nowrap;color:#4a4640;font-weight:600;"><span style="color:#3f86ff;font-weight:700;margin-right:6px;">${escapeHtml(n)}</span>${escapeHtml(k)}</th><td style="padding:8px;border:1px solid #ccc;white-space:pre-wrap;color:#2f2b25;">${sanitizeRichHtml(String(v || ""))}</td></tr>`).join("");

  const kpi = insight.kpi || {};
  const kpiHtml = `
    <table style="border-collapse:collapse;width:100%;margin-bottom:12px;">
      <tr>
        <td style="border:1px solid #ccc;padding:8px;text-align:center;"><div style="color:#5d5a55;font-size:12px;">问题总数</div><div style="font-size:22px;font-weight:700;color:#2f2b25;">${Number(kpi.total_count || 0)}</div></td>
        <td style="border:1px solid #ccc;padding:8px;text-align:center;"><div style="color:#5d5a55;font-size:12px;">已知质量问题</div><div style="font-size:22px;font-weight:700;color:#2f2b25;">${Number(kpi.known_count || 0)}</div></td>
        <td style="border:1px solid #ccc;padding:8px;text-align:center;"><div style="color:#5d5a55;font-size:12px;">新发现问题</div><div style="font-size:22px;font-weight:700;color:#2f2b25;">${Number(kpi.new_count || 0)}</div></td>
        <td style="border:1px solid #ccc;padding:8px;text-align:center;"><div style="color:#5d5a55;font-size:12px;">磐石版本涉及</div><div style="font-size:22px;font-weight:700;color:#2f2b25;">${Number(kpi.pansh_count || 0)}/${Number(kpi.pansh_total || 0)}</div></td>
      </tr>
    </table>`;

  const majorHead = MAJOR_COLUMNS.map((c) => `<th style="border:1px solid #888;padding:6px 8px;background:#f0f3f7;font-weight:600;color:#2f2b25;text-align:left;">${escapeHtml(c)}</th>`).join("");
  const majorBodyRows = [];
  let majorTotalCount = 0;
  MAJOR_TYPES.forEach((t) => {
    const rows = (major.types && major.types[t.key]) || [];
    if (rows.length === 0) {
      const tds = [`<td style="border:1px solid #888;padding:6px 8px;font-weight:700;color:#2f2b25;background:#f5f7fa;text-align:center;">${escapeHtml(t.label)}</td>`];
      for (let ci = 1; ci < MAJOR_COLUMNS.length; ci++) {
        tds.push(`<td style="border:1px solid #888;padding:6px 8px;color:#bbb;text-align:center;">—</td>`);
      }
      majorBodyRows.push(`<tr>${tds.join("")}</tr>`);
      return;
    }
    majorTotalCount += rows.length;
    rows.forEach((r, i) => {
      const tds = [];
      if (i === 0) {
        tds.push(`<td style="border:1px solid #888;padding:6px 8px;font-weight:700;color:#2f2b25;background:#f5f7fa;text-align:center;" rowspan="${rows.length}">${escapeHtml(t.label)}</td>`);
      }
      for (let ci = 1; ci < MAJOR_COLUMNS.length; ci++) {
        const col = MAJOR_COLUMNS[ci];
        tds.push(`<td style="border:1px solid #888;padding:6px 8px;color:#2f2b25;text-align:left;vertical-align:middle;word-break:break-word;white-space:pre-wrap;">${sanitizeRichHtml(String(r[col] || ""))}</td>`);
      }
      majorBodyRows.push(`<tr>${tds.join("")}</tr>`);
    });
  });
  const majorColGroup = `<colgroup>${MAJOR_COL_WIDTHS.map((w) => `<col style="width:${w}" />`).join("")}</colgroup>`;
  const majorTablesHtml = `
    <p style="margin:0 0 8px;color:#666;font-size:13px;">共 ${majorTotalCount} 条重大问题</p>
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px;">
      ${majorColGroup}
      <thead><tr>${majorHead}</tr></thead>
      <tbody>${majorBodyRows.join("")}</tbody>
    </table>`;

  const improveRows = Array.isArray(improve.records) ? improve.records : [];
  const improveHead = IMPROVE_COLUMNS.map((c) => `<th style="border:1px solid #888;padding:6px 8px;background:#f0f3f7;font-weight:600;color:#2f2b25;text-align:left;">${escapeHtml(c)}</th>`).join("");
  const improveTitleRow = `<tr><th colspan="${IMPROVE_COLUMNS.length}" style="border:1px solid #888;padding:10px;background:#eaf1fb;text-align:center;font-weight:700;font-size:15px;color:#2f4a78;">本月质量改进记录</th></tr>`;
  const improveBody = improveRows.length
    ? improveRows.map((r) => `<tr>${IMPROVE_COLUMNS.map((c) => `<td style="border:1px solid #888;padding:6px 8px;color:#2f2b25;text-align:left;vertical-align:middle;word-break:break-word;white-space:pre-wrap;">${sanitizeRichHtml(String(r[c] || ""))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${IMPROVE_COLUMNS.length}" style="border:1px solid #888;padding:6px 8px;text-align:center;color:#bbb;">本月暂无质量改进记录</td></tr>`;
  const improveColGroup = `<colgroup>${IMPROVE_COL_WIDTHS.map((w) => `<col${w ? ` style="width:${w}"` : ""} />`).join("")}</colgroup>`;

  const linksContent = String(links.content || "").trim();
  const linksHtml = linksContent
    ? `<p style="white-space:pre-wrap;margin:0;color:#2f2b25;">${sanitizeRichHtml(linksContent)}</p>`
    : `<div style="color:#999;">暂无内容。</div>`;

  // 顶部横幅（与编辑态一致：暗红底、白字、标题居中 + 拟制/审核）
  const monthLabel = /^\d{6}$/.test(ym)
    ? `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月`
    : "202x年x月";
  const product = String(overview.banner_product == null ? "xxxx" : overview.banner_product);
  const drafter = String(overview.banner_drafter == null ? "xxx" : overview.banner_drafter);
  const reviewer = String(overview.banner_reviewer == null ? "yyy" : overview.banner_reviewer);
  const bannerHtml = `
  <div style="background:#8b1a1a;color:#fff;border-radius:12px;padding:26px 24px;text-align:center;margin-bottom:16px;">
    <div style="font-size:30px;font-weight:700;letter-spacing:1px;line-height:1.4;">${escapeHtml(product)}现网重大问题月度分析（${escapeHtml(monthLabel)}）</div>
    <div style="font-size:20px;opacity:.92;margin-top:10px;">拟制:${escapeHtml(drafter)}&nbsp;&nbsp;审核:${escapeHtml(reviewer)}</div>
  </div>`;
  // 段卡片（与编辑态一致：天蓝段头 + 浅色内容区）
  const section = (t, body) => `
  <div style="background:#fff;border:1px solid #dfe5ec;border-radius:12px;overflow:hidden;margin-bottom:16px;">
    <div style="background:#87ceeb;color:#1a3a52;font-weight:700;font-size:16px;padding:10px 24px;">${escapeHtml(t)}</div>
    <div style="padding:14px 16px 18px;">${body}</div>
  </div>`;

  const insightBody = `
  ${kpiHtml}
  <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
    <tr>
      <td style="vertical-align:top;width:25%;padding:6px;"><h4 style="margin:0 0 6px;">Top 问题影响分类</h4>${img("mr-chart-impact")}</td>
      <td style="vertical-align:top;width:25%;padding:6px;"><h4 style="margin:0 0 6px;">Top10 质量模块和特性</h4>${img("mr-chart-top-modules")}</td>
      <td style="vertical-align:top;width:25%;padding:6px;"><h4 style="margin:0 0 6px;">Top1 模块细化</h4>${img("mr-chart-top1")}</td>
      <td style="vertical-align:top;width:25%;padding:6px;"><h4 style="margin:0 0 6px;">Top2 模块细化</h4>${img("mr-chart-top2")}</td>
    </tr>
  </table>`;
  const improveBodyHtml = `
  <table style="border-collapse:collapse;width:100%;">
    <tr>
      <td style="vertical-align:top;width:34%;padding:6px;"><h4 style="margin:0 0 6px;">领域占比</h4>${img("mr-chart-improve-mod")}</td>
      <td style="vertical-align:top;width:33%;padding:6px;"><h4 style="margin:0 0 6px;">SQL 领域改进</h4>${img("mr-chart-improve-sql")}</td>
      <td style="vertical-align:top;width:33%;padding:6px;"><h4 style="margin:0 0 6px;">存储领域改进</h4>${img("mr-chart-improve-storage")}</td>
    </tr>
  </table>
  <table style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px;margin-top:12px;">
    ${improveColGroup}
    <thead>
      ${improveTitleRow}
      <tr>${improveHead}</tr>
    </thead>
    <tbody>${improveBody}</tbody>
  </table>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#222;line-height:1.55;padding:18px;background:#eef1f5;">
  ${bannerHtml}
  ${section("一、整体概况", `<table style="border-collapse:collapse;width:100%;">${overviewBlocks}</table>`)}
  ${section("二、问题透视", insightBody)}
  ${section("三、重大问题", majorTablesHtml)}
  ${section("四、改进诉求", improveBodyHtml)}
  ${section("五、问题详情&质量改进记录", linksHtml)}
  <p style="margin-top:8px;color:#999;font-size:12px;">导出时间：${new Date().toLocaleString("zh-CN")} · 报告月份：${escapeHtml(ym)}</p>
</body></html>`;
}

function exportReportHtml() {
  const ym = state.monthlyReportYm || currentYm();
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

// 单 sheet 堆叠 5 段，整体排版与 HTML 导出一致：
// 顶部红色横幅区 → 一/二/三/四/五 章节标题（合并整行）→ 各段内容表格。
// 颜色/粗体/边框依赖 xlsx-js-style（已替换 SheetJS 社区版，drop-in 兼容）。
function buildExportXlsx() {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) return null;
  const ym = state.monthlyReportYm || currentYm();
  const data = state.monthlyReportData || {};
  const overview = data.section_overview || defaultSectionData("overview");
  const insight = data.section_insight || defaultSectionData("insight");
  const major = data.section_major || defaultSectionData("major");
  const improve = data.section_improve || defaultSectionData("improve");
  const links = data.section_links || defaultSectionData("links");

  const monthLabel = /^\d{6}$/.test(ym)
    ? `${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月`
    : ym;
  const titleLine = `${overview.banner_product || "xxxx"}现网重大问题月度分析（${monthLabel}）`;
  const subLine = `拟制:${overview.banner_drafter || ""}　　审核:${overview.banner_reviewer || ""}`;

  const COLS = MAJOR_COLUMNS.length; // sheet 列宽 = 10

  const thinBorder = {
    top: { style: "thin", color: { rgb: "888888" } },
    bottom: { style: "thin", color: { rgb: "888888" } },
    left: { style: "thin", color: { rgb: "888888" } },
    right: { style: "thin", color: { rgb: "888888" } },
  };
  const STYLES = {
    bannerMain: {
      fill: { fgColor: { rgb: "8B1A1A" } },
      font: { color: { rgb: "FFFFFF" }, bold: true, sz: 18 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    bannerSub: {
      fill: { fgColor: { rgb: "8B1A1A" } },
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
      alignment: { vertical: "center", wrapText: true },
      border: thinBorder,
    },
    typeCell: {
      fill: { fgColor: { rgb: "FAFBFC" } },
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    },
    kpiLabel: {
      fill: { fgColor: { rgb: "F5F7FA" } },
      font: { color: { rgb: "888888" }, sz: 11 },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    },
    kpiValue: {
      font: { bold: true, sz: 18 },
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
    linksContent: {
      alignment: { horizontal: "left", vertical: "top", wrapText: true },
      font: { sz: 12 },
    },
  };

  const aoa = [];
  const merges = [];
  const styleOps = []; // { range, style }
  const rowHeights = {}; // rowIndex -> hpx

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

  // 顶部红色横幅区
  pushFullRow(titleLine, STYLES.bannerMain, 38);
  pushFullRow(subLine, STYLES.bannerSub, 22);
  aoa.push(blank());

  // 一、整体概况
  pushFullRow("一、整体概况", STYLES.sectionHead, 26);
  [
    ["1.1 重大管理升级 & 事故", richToPlainText(overview.major_events)],
    ["1.2 问题分析", richToPlainText(overview.problem_analysis)],
    ["1.3 风险模块和特性", richToPlainText(overview.risk_modules)],
    ["1.4 质量改进识别反馈", richToPlainText(overview.quality_feedback)],
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
    rowHeights[ri] = 36;
  });
  aoa.push(blank());

  // 二、问题透视
  pushFullRow("二、问题透视", STYLES.sectionHead, 26);
  const kpi = insight.kpi || {};
  const kpiData = [
    ["问题总数", Number(kpi.total_count || 0)],
    ["已知质量问题", Number(kpi.known_count || 0)],
    ["新发现问题", Number(kpi.new_count || 0)],
    ["磐石版本涉及", Number(kpi.pansh_count || 0)],
    ["磐石版本总数", Number(kpi.pansh_total || 0)],
  ];
  const kpiLabelRow = blank();
  const kpiValueRow = blank();
  kpiData.forEach(([lab, val], i) => {
    kpiLabelRow[i * 2] = lab;
    kpiValueRow[i * 2] = val;
  });
  aoa.push(kpiLabelRow);
  const lr = aoa.length - 1;
  aoa.push(kpiValueRow);
  const vr = aoa.length - 1;
  for (let i = 0; i < 5; i++) {
    merges.push({ s: { r: lr, c: i * 2 }, e: { r: lr, c: i * 2 + 1 } });
    merges.push({ s: { r: vr, c: i * 2 }, e: { r: vr, c: i * 2 + 1 } });
  }
  recordStyle(lr, 0, lr, COLS - 1, STYLES.kpiLabel);
  recordStyle(vr, 0, vr, COLS - 1, STYLES.kpiValue);
  rowHeights[lr] = 22;
  rowHeights[vr] = 32;
  aoa.push(blank());

  // 同一行并排放多个 name/value 子表，复刻 HTML 端 mr-insight-chart-grid / mr-improve-chart-grid
  // bands: [{ title, items, cFrom, cTo }]，每个 band 内：name 列占 cFrom..cTo-1（合并），value 列占 cTo
  const pushKvBands = (bands) => {
    const subRi = aoa.length;
    const subRow = blank();
    bands.forEach((b) => { subRow[b.cFrom] = b.title; });
    aoa.push(subRow);
    bands.forEach((b) => {
      if (b.cTo > b.cFrom) merges.push({ s: { r: subRi, c: b.cFrom }, e: { r: subRi, c: b.cTo } });
      recordStyle(subRi, b.cFrom, subRi, b.cTo, STYLES.subTitle);
    });
    rowHeights[subRi] = 22;

    const headRi = aoa.length;
    const headRow = blank();
    bands.forEach((b) => {
      headRow[b.cFrom] = "名称";
      headRow[b.cTo] = "数量";
    });
    aoa.push(headRow);
    bands.forEach((b) => {
      if (b.cTo - 1 > b.cFrom) merges.push({ s: { r: headRi, c: b.cFrom }, e: { r: headRi, c: b.cTo - 1 } });
      recordStyle(headRi, b.cFrom, headRi, b.cTo, STYLES.tableHead);
    });

    const maxLen = bands.reduce((m, b) => Math.max(m, (b.items || []).length), 0);
    for (let i = 0; i < maxLen; i++) {
      const ri = aoa.length;
      const r = blank();
      bands.forEach((b) => {
        const it = (b.items || [])[i];
        if (it) {
          r[b.cFrom] = String(it.name || "");
          r[b.cTo] = Number(it.value || 0);
        }
      });
      aoa.push(r);
      bands.forEach((b) => {
        if (b.cTo - 1 > b.cFrom) merges.push({ s: { r: ri, c: b.cFrom }, e: { r: ri, c: b.cTo - 1 } });
        recordStyle(ri, b.cFrom, ri, b.cTo, STYLES.tableCell);
      });
    }
    aoa.push(blank());
  };
  // 2x2 网格：左 0-4 / 右 5-9
  pushKvBands([
    { title: "Top 问题影响分类", items: insight.impact_categories, cFrom: 0, cTo: 4 },
    { title: "Top10 质量模块和特性", items: insight.top_modules, cFrom: 5, cTo: 9 },
  ]);
  pushKvBands([
    { title: "Top1 模块细化", items: insight.top1_breakdown, cFrom: 0, cTo: 4 },
    { title: "Top2 模块细化", items: insight.top2_breakdown, cFrom: 5, cTo: 9 },
  ]);

  // 三、重大问题（10 列 = sheet 全宽）
  pushFullRow("三、重大问题", STYLES.sectionHead, 26);
  const majorHeadRi = aoa.length;
  aoa.push(MAJOR_COLUMNS.slice());
  recordStyle(majorHeadRi, 0, majorHeadRi, COLS - 1, STYLES.tableHead);
  let majorTotal = 0;
  MAJOR_TYPES.forEach((t) => {
    const rows = (major.types && major.types[t.key]) || [];
    if (rows.length === 0) {
      const ri = aoa.length;
      const r = blank();
      r[0] = t.label;
      aoa.push(r);
      merges.push({ s: { r: ri, c: 1 }, e: { r: ri, c: COLS - 1 } });
      recordStyle(ri, 0, ri, 0, STYLES.typeCell);
      recordStyle(ri, 1, ri, COLS - 1, STYLES.tableCell);
      return;
    }
    majorTotal += rows.length;
    const startR = aoa.length;
    rows.forEach((rdata, i) => {
      const ri = aoa.length;
      const r = blank();
      r[0] = i === 0 ? t.label : "";
      for (let ci = 1; ci < COLS; ci++) {
        r[ci] = richToPlainText(rdata[MAJOR_COLUMNS[ci]]);
      }
      aoa.push(r);
      recordStyle(ri, 0, ri, 0, STYLES.typeCell);
      recordStyle(ri, 1, ri, COLS - 1, STYLES.tableCell);
    });
    if (rows.length > 1) {
      merges.push({ s: { r: startR, c: 0 }, e: { r: startR + rows.length - 1, c: 0 } });
    }
  });
  pushFullRow(`合计：${majorTotal} 条`, STYLES.subTitle, 22);
  aoa.push(blank());

  // 四、改进诉求
  pushFullRow("四、改进诉求", STYLES.sectionHead, 26);
  // 1x3 网格：4-3-3（贴合 HTML 端 34/33/33）
  pushKvBands([
    { title: "改进诉求领域占比", items: improve.module_distribution, cFrom: 0, cTo: 3 },
    { title: "SQL 领域改进", items: improve.sql_items, cFrom: 4, cTo: 6 },
    { title: "存储领域改进", items: improve.storage_items, cFrom: 7, cTo: 9 },
  ]);
  // "本月质量改进记录" 标题合并 IMPROVE_COLUMNS 列宽
  const itTitleRi = aoa.length;
  const improveTitleRow = blank();
  improveTitleRow[0] = "本月质量改进记录";
  aoa.push(improveTitleRow);
  merges.push({
    s: { r: itTitleRi, c: 0 },
    e: { r: itTitleRi, c: IMPROVE_COLUMNS.length - 1 },
  });
  recordStyle(itTitleRi, 0, itTitleRi, IMPROVE_COLUMNS.length - 1, STYLES.subTitle);
  rowHeights[itTitleRi] = 22;
  const imHeadRi = aoa.length;
  const improveHead = blank();
  IMPROVE_COLUMNS.forEach((c, i) => { improveHead[i] = c; });
  aoa.push(improveHead);
  recordStyle(imHeadRi, 0, imHeadRi, IMPROVE_COLUMNS.length - 1, STYLES.tableHead);
  const irows = Array.isArray(improve.records) ? improve.records : [];
  if (irows.length === 0) {
    const ri = aoa.length;
    const er = blank();
    er[0] = "（本月暂无质量改进记录）";
    aoa.push(er);
    merges.push({
      s: { r: ri, c: 0 },
      e: { r: ri, c: IMPROVE_COLUMNS.length - 1 },
    });
    recordStyle(ri, 0, ri, IMPROVE_COLUMNS.length - 1, STYLES.tableCell);
  } else {
    irows.forEach((rdata) => {
      const ri = aoa.length;
      const r = blank();
      IMPROVE_COLUMNS.forEach((c, i) => { r[i] = richToPlainText(rdata[c]); });
      aoa.push(r);
      recordStyle(ri, 0, ri, IMPROVE_COLUMNS.length - 1, STYLES.tableCell);
    });
  }
  aoa.push(blank());

  // 五、问题详情&质量改进记录（自由文本）
  pushFullRow("五、问题详情&质量改进记录", STYLES.sectionHead, 26);
  const linksPlain = richToPlainText(links.content) || "（暂无内容）";
  const linkRi = aoa.length;
  const linkRow = blank();
  linkRow[0] = linksPlain;
  aoa.push(linkRow);
  merges.push({ s: { r: linkRi, c: 0 }, e: { r: linkRi, c: COLS - 1 } });
  recordStyle(linkRi, 0, linkRi, COLS - 1, STYLES.linksContent);
  rowHeights[linkRi] = Math.max(60, Math.min(240, linksPlain.split(/\n/).length * 18));

  // 构建 sheet & 应用样式
  const ws = X.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = new Array(COLS).fill(0).map(() => ({ wch: 14 }));
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
  X.utils.book_append_sheet(wb, ws, "月度报告");
  return wb;
}

function exportReportXlsx() {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    setMsg("SheetJS 未加载，无法导出 Excel。", "error");
    requestRender();
    return;
  }
  const ym = state.monthlyReportYm || currentYm();
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
  const monthInput = document.getElementById("mr-month-input");
  if (monthInput) {
    monthInput.addEventListener("change", (ev) => {
      const v = String(ev.target.value || "").replace("-", "");
      if (/^\d{6}$/.test(v)) loadMonthlyReport(v);
    });
  }
  const reload = document.getElementById("mr-reload-btn");
  if (reload) reload.addEventListener("click", () => loadMonthlyReport(state.monthlyReportYm || currentYm()));
  const exportBtn = document.getElementById("mr-export-btn");
  if (exportBtn) exportBtn.addEventListener("click", () => exportReportHtml());
  const exportXlsxBtn = document.getElementById("mr-export-xlsx-btn");
  if (exportXlsxBtn) exportXlsxBtn.addEventListener("click", () => exportReportXlsx());
  const archiveBtn = document.getElementById("mr-archive-btn");
  if (archiveBtn) {
    archiveBtn.addEventListener("click", async () => {
      const ym = state.monthlyReportYm;
      try {
        const updated = await apiArchiveReport(ym, ymToTitle(ym));
        state.monthlyReportData = updated;
        // 退出所有编辑态
        SECTION_KEYS.forEach((s) => { state.monthlyReportEditing[s] = false; state.monthlyReportDrafts[s] = null; });
        setMsg(`已归档为「${ymToTitle(ym)}」。`, "success");
      } catch (err) {
        setMsg(`归档失败：${err && err.message ? err.message : err}`, "error");
      }
      requestRender();
    });
  }
  const unarchiveBtn = document.getElementById("mr-unarchive-btn");
  if (unarchiveBtn) {
    unarchiveBtn.addEventListener("click", async () => {
      const ym = state.monthlyReportYm;
      try {
        const updated = await apiUnarchiveReport(ym);
        state.monthlyReportData = updated;
        setMsg("已取消归档。", "success");
      } catch (err) {
        setMsg(`取消归档失败：${err && err.message ? err.message : err}`, "error");
      }
      requestRender();
    });
  }
}

function bindSectionButtons() {
  document.querySelectorAll("[data-mr-edit]").forEach((el) => {
    el.addEventListener("click", () => startEdit(el.getAttribute("data-mr-edit")));
  });
  document.querySelectorAll("[data-mr-cancel]").forEach((el) => {
    el.addEventListener("click", () => cancelEdit(el.getAttribute("data-mr-cancel")));
  });
  document.querySelectorAll("[data-mr-save]").forEach((el) => {
    el.addEventListener("click", () => saveSection(el.getAttribute("data-mr-save")));
  });
  document.querySelectorAll("[data-mr-import]").forEach((el) => {
    el.addEventListener("click", () => importSection(el.getAttribute("data-mr-import")));
  });
}

export function bindMonthlyReportPage() {
  loadDOMPurify();
  bindToolbar();
  bindSectionButtons();
  bindOverviewEditor();
  bindInsightEditor();
  bindMajorEditor();
  bindImproveEditor();
  bindLinksEditor();
  bindRichTextToolbar();
  // 图表绘制
  setTimeout(() => mountMonthlyReportCharts(), 0);
}

// ---------- 归档列表页 ----------

export function renderMonthlyReportArchivePage() {
  const items = state.monthlyReportArchiveList || [];
  const loading = !!state.monthlyReportArchiveLoading;
  let body;
  if (loading && !items.length) {
    body = `<div class="mr-loading">加载归档列表中…</div>`;
  } else if (!items.length) {
    body = `<div class="mr-empty-hint">暂无归档报告。在「报告生成」页保存并归档后会显示在这里。</div>`;
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
              <td><button type="button" class="action mr-archive-open" data-mr-archive-open="${escapeAttr(ym)}">查看</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }
  return `
    <section class="mr-archive-page" aria-label="月度报告归档">
      <div class="mr-toolbar">
        <span class="mr-toolbar-title">月度报告归档</span>
        <span class="mr-toolbar-spacer"></span>
        <button type="button" class="action" id="mr-archive-reload-btn">刷新</button>
      </div>
      ${renderBanner()}
      ${body}
    </section>`;
}

export function bindMonthlyReportArchivePage(navigateTo) {
  const reload = document.getElementById("mr-archive-reload-btn");
  if (reload) reload.addEventListener("click", () => loadMonthlyReportArchives());
  document.querySelectorAll("[data-mr-archive-open]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const ym = ev.target.getAttribute("data-mr-archive-open");
      if (ym && typeof navigateTo === "function") {
        navigateTo(ym);
      }
    });
  });
}
