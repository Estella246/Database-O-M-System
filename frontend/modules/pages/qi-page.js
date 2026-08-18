// 质量改进（QI）5 阶段工作流页面
// 三函数模式：renderQiPage() / renderQiModalsHtml() / bindQiPage()
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { ensureQiTab, ensureQiDetailTab } from "./settings-page.js";
import { whitelistAllows } from "../utils/normalize.js";
import { formatYmdLocal, priorityBadgeClass, categoryBadgeClass } from "../utils/format.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { bindDateRangePicker, renderDateRangeHtml } from "../ui/date-range-picker-bind.js";
import { renderQiKpiCard } from "./qi.js";
import { buildStatsLaborEchartStackedBarOption, buildStatsLaborEchartBarOption, buildStatsLaborEchartPieOption } from "./stats.js";

import { bindRichEditor, bindDutyFieldCascader, dutyCascaderRenderPanel, dutyCascaderSyncTrigger, renderRichToolbarHtml } from "./ticket-page.js";
import { renderCascadeWhitelistControl } from "./ticket.js";
import { attachImageResizer } from "../ui/image-resizer.js";
import { openChartZoomEchart, ensureChartZoomOverlay } from "../ui/svg-chart-zoom.js";
import {
  QI_STAGE_KEYS, QI_STAGE_NAMES_CN, QI_HANDLE_MODE_ROUTE, QI_CLOSE_HANDLE_MODES,
  QI_CATEGORIES, QI_PRIORITIES, QI_ACCEPT_RESULTS, QI_CLOSURE_METHODS, QI_ACCEPTANCE_RESULTS,
  QI_STAGE_FIELDS, QI_PROGRESS_STAGES, QI_STATUS_CN, QI_LIST_COLUMNS,
  QI_ANALYTICS_PRESETS, qiFieldRequired,
} from "../constants/qi.js";

// 模块&特性：多级级联（根=所选领域的 children，领域不重复进路径）；初始空树，领域选中后由布线重根
function moduleFeatureCascaderHtml(prefix, value) {
  const field = { key: "module_feature", inputId: `${prefix}-module_feature`, cascade_options: [] };
  return renderCascadeWhitelistControl(field, value, true);
}

// [OPT-LOAD] 30s 内不重复拉取列表/看板，减少远程 SPA 加载时的串行请求堆积
// 回退：去掉 FETCH_CACHE_MS + _qiListFetchedAt/_qiAnalyticsFetchedAt，恢复 fetchQiList/fetchQiAnalytics 原签名
const FETCH_CACHE_MS = 30000;
let _qiListFetchedAt = 0;
let _qiAnalyticsFetchedAt = 0;

// ===================================================================
// 数据拉取
// ===================================================================
let _qiFilterOptionsLoaded = false;
export async function fetchQiFilterOptions() {
  if (_qiFilterOptionsLoaded) return;
  try {
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/filter-options?operator_id=${encodeURIComponent(op.account)}`);
    if (r.ok) { state.qiFilterOptions = await r.json(); _qiFilterOptionsLoaded = true; requestRender(); }
  } catch (_) { /* 静默失败，下次刷新页面时重试 */ }
}

export async function fetchQiList(force = false) {
  if (!force && _qiListFetchedAt && (Date.now() - _qiListFetchedAt) < FETCH_CACHE_MS) return;
  _qiListFetchedAt = Date.now();
  const op = getCurrentOperator();
  state.qiListLoading = true;
  requestRender();
  try {
    const scope = state.qiTab === "mine" ? "mine" : (state.qiTab === "handled" ? "handled" : "all");
    const q = (state.qiListSearch || "").trim();
    let url = `${API_BASE_URL}/api/qi?operator_id=${encodeURIComponent(op.account)}&scope=${scope}&q=${encodeURIComponent(q)}&page=${state.qiListPage}&page_size=${state.qiListPageSize}`;
    const f = state.qiListFilters || {};
    if (f.stage) url += `&stage=${encodeURIComponent(f.stage)}`;
    if (f.category) url += `&category=${encodeURIComponent(f.category)}`;
    if (f.priority) url += `&priority=${encodeURIComponent(f.priority)}`;
    if (f.domain) url += `&domain=${encodeURIComponent(f.domain)}`;
    if (f.module_feature) url += `&module_feature=${encodeURIComponent(f.module_feature)}`;
    if (f.proposer) url += `&proposer=${encodeURIComponent(f.proposer)}`;
    if (f.related_ticket_no) url += `&related_ticket_no=${encodeURIComponent(f.related_ticket_no)}`;
    if (f.is_overdue) url += `&overdue=${encodeURIComponent(f.is_overdue)}`;
    if (f.start_date) url += `&start_date=${encodeURIComponent(f.start_date)}`;
    if (f.end_date) url += `&end_date=${encodeURIComponent(f.end_date)}`;
    const r = await fetch(url);
    if (!r.ok) { state.qiList = []; state.qiListTotal = 0; return; }
    const j = await r.json();
    state.qiList = Array.isArray(j.items) ? j.items : [];
    state.qiListTotal = j.total || 0;
  } catch (_) { state.qiList = []; state.qiListTotal = 0; }
  finally { state.qiListLoading = false; state.qiListLoaded = true; requestRender(); }
}

export async function fetchQiDetail(id) {
  const op = getCurrentOperator();
  state.qiDetailLoading = true; state.qiDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}?operator_id=${encodeURIComponent(op.account)}`);
    state.qiDetailBundle = r.ok ? await r.json() : null;
  } catch (_) { state.qiDetailBundle = null; }
  finally {
    state.qiDetailLoading = false; state.qiDetailLoaded = true;
    // 详情加载后，用完整 QI 编号更新 tab 标签
    const qiNo = state.qiDetailBundle?.request?.qi_no;
    if (qiNo) {
      const tabKey = `qi-detail:${id}`;
      const tab = state.openTabs.find(t => t.key === tabKey);
      if (tab) tab.label = qiNo;
    }
    requestRender();
  }
}

export async function fetchQiAnalytics(force = false) {
  if (!force && _qiAnalyticsFetchedAt && (Date.now() - _qiAnalyticsFetchedAt) < FETCH_CACHE_MS) return;
  _qiAnalyticsFetchedAt = Date.now();
  state.qiAnalyticsLoading = true; state.qiAnalyticsData = null;
  requestRender();
  try {
    const op = getCurrentOperator();
    const preset = QI_ANALYTICS_PRESETS.find(p => p.key === state.qiAnalyticsPreset);
    const today = new Date();
    // 默认全量（不传日期）；选了预设(days>0)按天数算窗口；自定义传用户选的日期
    if (preset && preset.days > 0) {
      var end = formatYmdLocal(today);
      var start = formatYmdLocal(new Date(today - preset.days * 86400000));
    } else if (state.qiAnalyticsPreset === "custom") {
      var end = state.qiAnalyticsEnd || "";
      var start = state.qiAnalyticsStart || "";
    } else {
      var end = "";
      var start = "";
    }
    const params = new URLSearchParams({ operator_id: op.account || "", start_date: start, end_date: end });
    const stages = (state.qiAnalyticsStages || []).join(",");
    if (stages) params.set("stages", stages);
    if (state.qiAnalyticsStatusFilter) params.set("status_filter", state.qiAnalyticsStatusFilter);
    const resp = await fetch(`${API_BASE_URL}/api/qi/analytics?${params}`);
    state.qiAnalyticsData = resp.ok ? await resp.json() : { error: resp.status };
  } catch (e) { state.qiAnalyticsData = { error: String(e.message || e) }; }
  finally { state.qiAnalyticsLoading = false; requestRender(); }
}

// ===================================================================
// 页面渲染
// ===================================================================
function cellHtml(it, col) {
  const v = String(it[col.key] != null ? it[col.key] : "");
  if (col.tag === "stage") {
    if (it.current_status === "closed") return "已关闭";
    return escapeHtml(QI_STAGE_NAMES_CN[v] || v);
  }
  if (col.tag === "cat") return v ? `<span class="cat-tag ${categoryBadgeClass(v)}">${escapeHtml(v)}</span>` : "";
  if (col.tag === "p") return v ? `<span class="p ${priorityBadgeClass(v)}">${escapeHtml(v)}</span>` : "";
  if (col.key === "created_at" && v) return escapeHtml(String(v).slice(0, 10));
  if (col.key === "current_status") return escapeHtml(QI_STATUS_CN[v] || v);
  if (col.tag === "overdue") {
    if (it.current_status === "closed") return '<span style="color:#94a3b8">--</span>';
    return it.is_overdue ? '<span style="color:#ef4444;font-weight:600">超期</span>' : '<span style="color:#22c55e">正常</span>';
  }
  if (col.stripHtml && v) {
    // 先去标签，再解码 HTML 实体（&nbsp; 等），最后截断
    var stripped = String(v).replace(/<[^>]*>/g, "");
    var el = document.createElement("textarea");
    el.innerHTML = stripped;
    return escapeHtml(el.value.slice(0, 60));
  }
  if (col.key === "title") {
    return `<span class="qi-title-cell" title="${escapeAttr(v)}">${escapeHtml(v)}</span>`;
  }
  return escapeHtml(v);
}

// ===================================================================
// 流程视图（全屏）：流程线 + 阶段表单
// ===================================================================
function flowNodeStatus(stages, stageKey, currentStage) {
  if (stageKey === currentStage) return "current";
  const st = stages.find(s => s.stage_key === stageKey);
  if (st && st.status === "completed") return "done";
  if (st && st.status === "rejected") return "rejected";
  // pending 表示阶段已进入但未完成，视为已到达
  if (st && st.status === "pending") return "done";
  return "future";
}

function renderQiFlowView() {
  const isNew = state.qiFlowViewId === "new";
  const b = state.qiDetailBundle;
  // bundle 为空时自动重新拉取（如从列表切回详情 tab）
  if (!isNew && !b && state.qiFlowViewId && !state.qiDetailLoading && !state.qiDetailLoaded) {
    fetchQiDetail(state.qiFlowViewId);
  }
  if (!isNew && !b) {
    const msg = state.qiDetailLoading ? "加载中…" : (state.qiDetailLoaded ? "加载失败或单据不存在" : "加载中…");
    const back = state.qiDetailLoaded ? `<button type="button" class="action" onclick="history.pushState({},'','/qi');location.reload()">返回列表</button>` : "";
    return `<section class="qi-flow-page" id="qi-flow-panel"><div class="qi-stage-empty">${msg}${back}</div></section>`;
  }
  const r = (b && b.request) || {};
  const stages = (b && b.stages) || [];
  const currentStage = isNew ? "propose" : (r.current_stage || "propose");
  const op = getCurrentOperator();
  const isCreator = !isNew && String(r.creator_id || "") === String(op.account || "");
  const canDelete = !isNew && currentStage === "propose" && isCreator;

  // 顶栏（工单风格）
  const header = `
    <div class="qi-flow-header">
      <button type="button" class="action" id="qi-flow-back">← 返回列表</button>
      <h2 class="qi-flow-title">${escapeHtml(isNew ? "新建质量改进诉求" : (r.qi_no || ""))}</h2>
      <span class="qi-flow-status st-tag">${escapeHtml(isNew ? "新建中" : (QI_STATUS_CN[r.current_status] || r.current_status || ""))}</span>
      ${canDelete ? `<button type="button" class="action danger" id="qi-flow-delete">删除</button>` : ""}
    </div>`;

  // 流程条（对齐工单 flow-bar：ol > li.flow-node > span.flow-dot + span.flow-label）
  const barItems = QI_STAGE_KEYS.map((sk) => {
    const s = stages.find(x => x.stage_key === sk);
    const future = !s || (!(s.status === "completed" || s.status === "rejected") && sk !== currentStage);
    let stateCls = "";
    if (sk === currentStage) stateCls = "current";
    else if (s && s.status === "completed") stateCls = "passed";
    else if (s && s.status === "rejected") stateCls = "rejected";
    const labelHtml = future
      ? `<span class="flow-label">${QI_STAGE_NAMES_CN[sk]}</span>`
      : `<span class="flow-label flow-label--jump"><button type="button" class="flow-step-jump" data-qi-flow-stage="${sk}">${QI_STAGE_NAMES_CN[sk]}</button></span>`;
    return `<li class="flow-node ${stateCls}"><span class="flow-dot"></span>${labelHtml}</li>`;
  }).join("");
  const flowBar = `<ol class="flow-bar" style="grid-template-columns:repeat(5,minmax(0,1fr))">${barItems}</ol>`;

  // 阶段卡片列表（工单 flow-log 风格，未进入的不展示）
  const stageCards = QI_STAGE_KEYS.map(sk => {
    const status = flowNodeStatus(stages, sk, currentStage);
    if (status === "future") return null;
    const isCurrent = sk === currentStage;
    const open = isCurrent || (status === "current") ? " open" : "";
    const logCls = isCurrent ? "flow-log" : "flow-log flow-log-passed";
    const formBody = renderQiFlowStageForm(sk, status, b, isNew);
    const handlerStr = (() => {
      if (sk === "propose") return r.proposer || "";
      if (sk === "acceptance") {
        // 验收阶段：优先取 qi_stage.responsible（转单后），无则回落提出人
        const accSt = stages.find(x => x.stage_key === "acceptance");
        return (accSt && accSt.responsible) || r.proposer || "";
      }
      if (sk === "review") return r.reviewer || "";
      const st = stages.find(x => x.stage_key === sk);
      return (st && st.responsible) || "";
    })();
    return `<details class="${logCls}"${open} data-flow-step="${escapeAttr(sk)}">
      <summary><span>${QI_STAGE_NAMES_CN[sk]}</span>${handlerStr ? `<span class="flow-log-meta">${escapeHtml(handlerStr)}</span>` : ""}</summary>
      <div class="flow-log-body">${formBody}</div></details>`;
  }).filter(Boolean).join("\n");
  const flowLogs = `<div class="flow-logs">${stageCards}</div>`;

  // 操作日志
  const logs = (b && b.logs) || [];
  const logsSection = isNew ? "" : `
    <details class="qi-flow-logs">
      <summary>操作日志（${logs.length}）</summary>
      <table class="req-mini-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>从</th><th>到</th></tr></thead>
        <tbody>${logs.map(l => `<tr><td>${escapeHtml(String(l.created_at||"").slice(0,16))}</td><td>${escapeHtml(l.operator_name||"")}</td><td>${escapeHtml(l.action)}</td><td>${l.from_stage ? QI_STAGE_NAMES_CN[l.from_stage]||l.from_stage : ""}</td><td>${l.to_stage ? QI_STAGE_NAMES_CN[l.to_stage]||l.to_stage : ""}</td></tr>`).join("")}</tbody></table>
    </details>`;

  return `<section class="qi-flow-page" id="qi-flow-panel">
    ${header}
    ${flowBar}
    ${flowLogs}
    ${logsSection}
  </section>`;
}

// Top N 裁剪：只截断不合并（页内仅前 N 项，无「其他」；全量在点击放大浮层查看）
function topN(items, n) {
  return (items || []).slice(0, n);
}
// ===================================================================
// 饼图（ECharts，复用统计图表-各阶段问题占比 buildStatsLaborEchartPieOption）
// ===================================================================
const _qiPieCharts = {}; // key → echarts instance

function disposeQiPieCharts() {
  Object.values(_qiPieCharts).forEach(c => { try { c.dispose(); } catch (_) { /* ignore */ } });
  Object.keys(_qiPieCharts).forEach(k => delete _qiPieCharts[k]);
}

function _mountQiPieChart(key, elId, option) {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const paint = (attempt = 0) => {
    const el = document.getElementById(elId);
    if (!el) { if (_qiPieCharts[key]) { try { _qiPieCharts[key].dispose(); } catch (_) {} delete _qiPieCharts[key]; } return; }
    if ((el.clientWidth < 2 || el.clientHeight < 2) && attempt < 10) {
      requestAnimationFrame(() => paint(attempt + 1));
      return;
    }
    if (_qiPieCharts[key]) { try { _qiPieCharts[key].dispose(); } catch (_) {} delete _qiPieCharts[key]; }
    if (!option) {
      el.innerHTML = '<div class="qi-stage-empty">暂无数据</div>';
      return;
    }
    el.innerHTML = "";
    _qiPieCharts[key] = E.init(el, null, { renderer: "canvas" });
    _qiPieCharts[key].setOption(option, { notMerge: true });
    _markQiLegendSuppress(_qiPieCharts[key], el);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => paint(0)));
}

// stage/category 饼图不裁剪；domain/module 饼图页内 Top N 截断（无「其他」合并，全量在放大浮层）
function mountQiPieCharts() {
  const f = state.qiAnalyticsFull;
  if (!f) return;
  _bindQiEchartResize();
  const pieOpt = (items) => {
    const it = topN(items || [], 10);
    if (!it.length) return null;
    return buildStatsLaborEchartPieOption(it);
  };
  _mountQiPieChart("stage-pie", "qi-analytics-echart-stage-pie", pieOpt(f.stage));
  _mountQiPieChart("category-pie", "qi-analytics-echart-category-pie", pieOpt(f.category));
  _mountQiPieChart("domain-pie", "qi-analytics-echart-domain-pie", pieOpt(f.domain));
  _mountQiPieChart("module-pie", "qi-analytics-echart-module-pie", pieOpt(f.modulePie));
}

// 图例交互标记：legend 切显/翻页的点击不应触发放大。echarts 在同一次原生 click 派发里同步发出
// legendselectchanged/legendscroll，但派发顺序与监听注册顺序相关，故 _bindQiCardZoom 的判定推迟一帧再查标记
function _markQiLegendSuppress(chart, el) {
  if (!chart || !el) return;
  chart.on("legendselectchanged", () => { el.__qiLegendHit = true; });
  chart.on("legendscroll", () => { el.__qiLegendHit = true; });
}

// 卡片图表点击放大：拖拽（dataZoom 平移）不触发；图例切显/翻页也不触发
function _bindQiCardZoom(key, boundFlag, open) {
  const card = document.querySelector(`[data-qichart="${key}"]`);
  if (!card || card.dataset[boundFlag]) return;
  card.dataset[boundFlag] = "1";
  const el = card.querySelector(".stat-echart-host");
  if (!el) return;
  el.style.cursor = "zoom-in";
  let downX = 0, downY = 0;
  el.addEventListener("mousedown", (e) => { downX = e.clientX; downY = e.clientY; });
  el.addEventListener("click", (e) => {
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
    setTimeout(() => {
      const legendHit = el.__qiLegendHit;
      el.__qiLegendHit = false;
      if (legendHit) return;
      open();
    }, 0);
  });
}

// 窗口尺寸变化时重绘页内 ECharts（对齐统计页做法），否则 canvas 一直保持初始化时的像素尺寸
let _qiEchartResizeBound = false;
function _bindQiEchartResize() {
  if (_qiEchartResizeBound) return;
  _qiEchartResizeBound = true;
  window.addEventListener(
    "resize",
    () => {
      const live = [...Object.values(_qiPieCharts), ...Object.values(_qiBarCharts)];
      if (_qiSubmissionChart) live.push(_qiSubmissionChart);
      live.forEach((c) => {
        try {
          if (!c.isDisposed()) c.resize();
        } catch (_) {
          // ignore
        }
      });
    },
    { passive: true },
  );
}

// 点击放大（仅领域/模块占比有全量放大，阶段/改进类型全量==页内）
function bindQiPieZoom(key, title, getItems) {
  _bindQiCardZoom(key, "pieZoomBound", () => {
    const items = getItems();
    if (!items || !items.length) return;
    openChartZoomEchart(title, () => buildStatsLaborEchartPieOption(items));
  });
}
function frozenKeys(_stageKey, _curStage) {
  return [];
}

function renderQiFlowStageForm(stageKey, stageStatus, bundle, isNew) {
  let prefix = `qi-stage-${stageKey}`; // 默认前缀，amend/editable 各自 override
  const req = (bundle && bundle.request) || {};
  const stages = (bundle && bundle.stages) || [];
  const st = stages.find(s => s.stage_key === stageKey);
  const vals = (st && st.values) || {};
  const curStage = req.current_stage || stageKey;
  const fk = frozenKeys(stageKey, curStage); // 当前阶段不冻结，走到后面才冻结
  // 计算当前阶段处理人（表头展示用）
  let handlerStr = "";
  if (stageKey === "propose") handlerStr = req.proposer || "";
  else if (stageKey === "acceptance") handlerStr = (st && st.responsible) || req.proposer || "";
  else if (stageKey === "review") handlerStr = req.reviewer || "";
  else if (st) handlerStr = st.responsible || "";
  // 未开始：空态
  if (stageStatus === "future") {
    return `<div class="flow-empty">尚未进入此阶段</div>`;
  }
  // 已完成 / 打回过：关闭前所有阶段均可修改，但仅限该阶段提交人
  if (stageStatus === "done" || stageStatus === "rejected") {
    const isClosed = req.current_status === "closed";
    const lastSubmitter = (st && st.last_submitter) || "";
    const isLastSubmitter = lastSubmitter === getCurrentOperator().account || lastSubmitter.includes(getCurrentOperator().account);
    if (!isClosed && isLastSubmitter) {
      prefix = `qi-amend-${stageKey}`;
      const fields = (QI_STAGE_FIELDS[stageKey] || []).filter(function(f){ return !fk.includes(f.key); });
      const formHtml = fields.map(f => {
        const cur = (!vals[f.key] && isNew && stageKey === "propose" && f.key === "description")
            ? "<p>【问题背景】</p><p>【改进建议】</p>"
            : String(vals[f.key] || "");
        const isRich = f.type === "richtext";
        const cls = `problem-field ${isRich ? "problem-field-rich" : ""}`;
        let ctrl = "";
        if (f.key === "module_feature" && f.type === "cascader") {
          ctrl = moduleFeatureCascaderHtml(prefix, cur);
        } else if (f.type === "select" && f.options) {
          // 存量值不在（静态/异步）选项中时兜底保留为选项，避免 select 静默回落首项改写已存值
          const optVals = (cur && !f.options.includes(cur)) ? f.options.concat([cur]) : f.options;
          // empty_option 字段（如 accept_version）初始渲染即带「--」空选项：未选时不静默回落首个种子
          const emptyOpt = f.empty_option ? '<option value="">--</option>' : '';
          const opts = emptyOpt + optVals.map(v => `<option value="${escapeAttr(v)}" ${v===cur?"selected":""}>${escapeHtml(v)}</option>`).join("");
          ctrl = `<select id="${prefix}-${f.key}" data-current-value="${escapeAttr(cur)}" class="problem-input">${opts}</select>`;
        } else if (f.type === "richtext") {
          const editorId = `${prefix}-${f.key}`;
          ctrl = `<div class="rich-editor" data-rich-editor style="width:100%">${renderRichToolbarHtml({ listLabels: "compact" })}
            <div class="rich-content" id="${editorId}" contenteditable="true" data-placeholder="请输入${escapeHtml(f.label)}...">${cur}</div>
            <input type="hidden" data-rich-key="${f.key}" value="${escapeAttr(cur)}" data-rich-hidden /></div>`;
        } else if (f.type === "textarea") {
          ctrl = `<textarea id="${prefix}-${f.key}" class="problem-input" rows="4">${escapeHtml(cur)}</textarea>`;
        } else if (f.type === "date") {
          const dv = cur ? String(cur).slice(0, 10) : formatYmdLocal(new Date());
          ctrl = `<input type="date" id="${prefix}-${f.key}" class="problem-input" value="${escapeAttr(dv)}" />`;
        } else {
          ctrl = `<input type="text" id="${prefix}-${f.key}" class="problem-input" value="${escapeAttr(cur)}" />`;
        }
        return `<div class="${cls}"><label data-field-label="${f.key}">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${qiFieldRequired(f, vals || {}) ? " *" : ""}</span></label><div>${ctrl}</div></div>`;
      }).join("");
      return `<div class="problem-fill-grid">${formHtml}</div><div class="qi-stage-actions"><button type="button" class="action primary qi-amend-save-btn" data-qi-amend-stage="${stageKey}">保存修改</button></div>`;
    }
    // 否则只读展示（工单 problem-field 风格）
    const fields = (QI_STAGE_FIELDS[stageKey] || []).filter(function(f){ return !fk.includes(f.key); });
    const rows = fields.map(f => {
      const v = vals[f.key];
      const ri = f.type === "richtext";
      const rctrl = ri
        ? `<div class="readonly-value readonly-rich" style="border-radius:10px">${String(v != null ? v : "") || '<span class="readonly-empty">-</span>'}</div>`
        : `<input type="text" value="${escapeAttr(String(v != null ? v : ""))}" readonly disabled class="problem-input" style="border-radius:10px" />`;
      return `<div class="problem-field ${ri ? "problem-field-rich" : ""}"><label data-field-label="${f.key}">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${qiFieldRequired(f, vals || {}) ? " *" : ""}</span></label><div>${rctrl}</div></div>`;
    }).join("");
    const progress = (bundle && bundle.progress_items || []).filter(p => p.stage_key === stageKey);
    const progressHtml = QI_PROGRESS_STAGES.has(stageKey) && progress.length
      ? `<div class="qi-progress-section"><h4>进展子项</h4>${progress.map(p => `<div class="qi-progress-item"><span class="qi-progress-seq">#${p.seq}</span> ${escapeHtml(p.content)} <span class="qi-progress-meta">— ${escapeHtml(p.submitter_name)} ${String(p.created_at||"").slice(0,10)}</span></div>`).join("")}</div>` : "";
    return `<div class="problem-fill-grid">${rows || "暂无数据"}</div>${progressHtml}`;
  }
  // 当前阶段：非处理人只读，处理人可编辑
  const isProposeNew = isNew && stageKey === "propose";
  const isHandler = isNew || !handlerStr || handlerStr.includes(getCurrentOperator().account) || handlerStr.includes(getCurrentOperator().userName);
  if (!isHandler) {
    // 非处理人：只读展示
    const fields = (QI_STAGE_FIELDS[stageKey] || []).filter(function(f){ return !fk.includes(f.key); });
    const rows = fields.map(f => {
      const v = vals[f.key];
      const ri = f.type === "richtext";
      const rctrl = ri
        ? `<div class="readonly-value readonly-rich" style="border-radius:10px">${String(v != null ? v : "") || '<span class="readonly-empty">-</span>'}</div>`
        : `<input type="text" value="${escapeAttr(String(v != null ? v : ""))}" readonly disabled class="problem-input" style="border-radius:10px" />`;
      return `<div class="problem-field ${ri?"problem-field-rich":""}"><label data-field-label="${f.key}">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${qiFieldRequired(f, vals || {}) ? " *" : ""}</span></label><div>${rctrl}</div></div>`;
    }).join("");
    return `<div class="problem-fill-grid">${rows || "暂无数据"}</div>`;
  }
  prefix = isProposeNew ? "qi-new" : `qi-stage-${stageKey}`;
  const fields = (QI_STAGE_FIELDS[stageKey] || []).filter(function(f){ return !fk.includes(f.key); });
  const curVals = bundle ? vals : {};
  const formHtml = fields.map(f => {
    const cur = (!bundle && isProposeNew && f.key === "description")
        ? "<p>【问题背景】</p><p>【改进建议】</p>"
        : (bundle ? String(curVals[f.key] || "") : "");
    const isRich = f.type === "richtext";
    const isFull = isRich || !!f.full;  // 富文本 / 标记 full 的字段占整行（固定行宽）
    const cls = `problem-field ${isFull ? "problem-field-rich" : ""} problem-field--${f.key}`;
    let ctrl = "";
    if (f.key === "module_feature" && f.type === "cascader") {
      ctrl = moduleFeatureCascaderHtml(prefix, cur);
    } else if (f.type === "select" && f.options) {
      // 存量值不在（静态/异步）选项中时兜底保留为选项，避免 select 静默回落首项改写已存值
      const optVals = (cur && !f.options.includes(cur)) ? f.options.concat([cur]) : f.options;
      // empty_option 字段（如 accept_version）初始渲染即带「--」空选项：未选时不静默回落首个种子
      const emptyOpt = f.empty_option ? '<option value="">--</option>' : '';
      const opts = emptyOpt + optVals.map(v => `<option value="${escapeAttr(v)}" ${v===cur?"selected":""}>${escapeHtml(v)}</option>`).join("");
      ctrl = `<select id="${prefix}-${f.key}" data-current-value="${escapeAttr(cur)}" class="problem-input">${opts}</select>`;
    } else if (f.type === "richtext") {
      const editorId = `${prefix}-${f.key}`;
      ctrl = `<div class="rich-editor" data-rich-editor style="width:100%">${renderRichToolbarHtml({ listLabels: "compact" })}
        <div class="rich-content" id="${editorId}" contenteditable="true" data-placeholder="请输入${escapeHtml(f.label)}...">${cur}</div>
        <input type="hidden" data-rich-key="${f.key}" value="${escapeAttr(cur)}" data-rich-hidden /></div>`;
    } else if (f.type === "textarea") {
      ctrl = `<textarea id="${prefix}-${f.key}" class="problem-input" rows="4">${escapeHtml(cur)}</textarea>`;
    } else if (f.type === "date") {
      const dv = cur ? String(cur).slice(0, 10) : formatYmdLocal(new Date());
      ctrl = `<input type="date" id="${prefix}-${f.key}" class="problem-input" value="${escapeAttr(dv)}" />`;
    } else if (f.type === "person") {
      ctrl = `<input type="text" id="${prefix}-${f.key}" class="problem-input qi-person-input" value="${escapeAttr(cur)}" placeholder="输入账号或姓名搜索" autocomplete="off" />`;
    } else {
      ctrl = `<input type="text" id="${prefix}-${f.key}" class="problem-input" value="${escapeAttr(cur)}" />`;
    }
    return `<div class="${cls}"><label data-field-label="${f.key}">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${qiFieldRequired(f, vals || {}) ? " *" : ""}</span></label><div>${ctrl}</div></div>`;
  }).join("");
  const progress = (bundle && bundle.progress_items || []).filter(p => p.stage_key === stageKey);
  const canAddProgress = QI_PROGRESS_STAGES.has(stageKey);
  const progressHtml = progress.length || canAddProgress
    ? `<div class="qi-progress-section">${progress.length ? `<h4>进展子项</h4>${progress.map(p => `<div class="qi-progress-item"><span class="qi-progress-seq">#${p.seq}</span> ${escapeHtml(p.content)} <span class="qi-progress-meta">— ${escapeHtml(p.submitter_name)} ${String(p.created_at||"").slice(0,10)}</span></div>`).join("")}` : ""}${canAddProgress ? `<button type="button" class="action" id="qi-flow-add-progress">+ 新增进展</button>` : ""}</div>` : "";
  const isDraft = req.current_status === "draft";
  const isClosed = req.current_status === "closed";
  const canSubmitDraft = !!(bundle && bundle.can_submit_draft);
  const actionBtns = isHandler && !isClosed
    ? (isNew
      ? `<button type="button" class="action primary" onclick="window._qiFlowSubmit?.('propose')">提交评审</button>`
      : isDraft
      ? (canSubmitDraft
        ? `<button type="button" class="action primary" onclick="window._qiFlowSave?.('${escapeAttr(stageKey)}')">保存</button><button type="button" class="action primary" onclick="window._qiFlowSubmit?.('propose')">提交评审</button>`
        : `<button type="button" class="action primary" onclick="window._qiFlowSave?.('${escapeAttr(stageKey)}')">保存</button>`)
      : `<button type="button" class="action primary" onclick="window._qiFlowSave?.('${escapeAttr(stageKey)}')">保存</button><button type="button" class="action" onclick="window._qiFlowSubmit?.('${escapeAttr(stageKey)}')">提交</button><button type="button" class="action" onclick="window._qiFlowTransfer?.('${escapeAttr(stageKey)}')">转单</button>`)
    : "";
  return `<div class="problem-fill-grid">${formHtml}${progressHtml}</div><div class="qi-stage-actions">${actionBtns}</div>`;
}


export function renderQiPage() {
  // 流程视图（全屏）：新建或查看已有单
  if (state.qiFlowViewId !== null) {
    return renderQiFlowView();
  }
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("requirement_create", "readonly", whitelist);
  const canExport = whitelistAllows("requirement_export", "readonly", whitelist);
  const canImport = whitelistAllows("requirement_import", "readonly", whitelist);
  const tabsHtml = `
    <div class="req-tabs">
      <button type="button" class="req-tab ${state.qiTab === "all" ? "active" : ""}" data-qi-tab="all">全部</button>
      <button type="button" class="req-tab ${state.qiTab === "mine" ? "active" : ""}" data-qi-tab="mine">我提出的</button>
      <button type="button" class="req-tab ${state.qiTab === "handled" ? "active" : ""}" data-qi-tab="handled">我处理的</button>
    </div>`;
  const toolbarRightHtml = `
  <div class="req-toolbar-right">
    ${canImport ? `<button type="button" class="action" id="qi-download-template-btn">下载模板</button>` : ""}
    ${canImport ? `<button type="button" class="action" id="qi-import-btn" ${state.qiImportLoading ? "disabled" : ""}>${state.qiImportLoading ? "导入中…" : "导入"}</button>` : ""}
    ${canExport ? `<button type="button" class="action" id="qi-export-btn" ${state.qiExportLoading ? "disabled" : ""}>${state.qiExportLoading ? "导出中…" : "导出"}</button>` : ""}
    ${canCreate ? '<button type="button" class="action primary" id="qi-create-btn">新建</button>' : ""}
  </div>`;

  if (state.qiTab === "analytics") {
    return `<section class="req-wrap" id="qi-panel">
      <div class="req-toolbar">${tabsHtml}${renderQiAnalyticsFilters()}</div>
      ${renderQiAnalyticsBody()}</section>`;
  }
  const ps = Math.max(1, Number(state.qiListPageSize) || 10);
  const total = Number(state.qiListTotal) || 0;
  const pages = Math.max(1, Math.ceil(total / ps));
  const rows = (state.qiList || []).map(it => {
    const cells = QI_LIST_COLUMNS.map(c => `<td class="req-col-${c.key}">${cellHtml(it, c)}</td>`).join("");
    return `<tr class="req-row" data-qi-id="${it.id}" data-qi-no="${escapeAttr(it.qi_no || '')}">${cells}</tr>`;
  }).join("");
  const empty = `<tr><td colspan="${QI_LIST_COLUMNS.length}" class="req-empty">${state.qiListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  const sizeOps = [10, 20, 50, 100].map(s => `<option value="${s}" ${s === ps ? "selected" : ""}>${s}</option>`).join("");
  // 筛选配置：哪些列可筛选、筛选类型、选项
  const fo = state.qiFilterOptions || {};
  const QI_FILTER_CONFIG = {
    category: { filterKey: "category", type: "select", options: QI_CATEGORIES },
    domain: { filterKey: "domain", type: "searchable_select", options: fo.domains || [] },
    module_feature: { filterKey: "module_feature", type: "searchable_select", options: fo.module_features || [] },
    priority: { filterKey: "priority", type: "select", options: QI_PRIORITIES },
    proposer: { filterKey: "proposer", type: "searchable_select", options: fo.proposers || [] },
    current_stage: { filterKey: "stage", type: "select", options: QI_STAGE_KEYS, optionLabels: QI_STAGE_NAMES_CN },
    related_ticket_no: { filterKey: "related_ticket_no", type: "text" },
    is_overdue: { filterKey: "is_overdue", type: "select", options: ["true", "false"], optionLabels: { true: "超期", false: "正常" } },
    created_at: { filterKey: "date_range", type: "date_range" },
  };
  const fil = state.qiListFilters || {};
  const _filterActive = (fc) => {
    if (fc.type === "date_range") return !!(fil["start_date"] || fil["end_date"]);
    return !!fil[fc.filterKey];
  };
  const headHtml = QI_LIST_COLUMNS.map(c => {
    const fc = QI_FILTER_CONFIG[c.key];
    if (!fc) return `<th class="req-col-${c.key}">${escapeHtml(c.label)}</th>`;
    const active = _filterActive(fc);
    return `<th class="req-col-${c.key}">${escapeHtml(c.label)} <span class="qi-filter-icon" id="qi-filter-icon-${escapeAttr(fc.filterKey)}" style="cursor:pointer;margin-left:4px;${active?'color:#3b82f6;font-weight:700':''}" title="筛选${escapeAttr(c.label)}">${active ? '▼' : '▽'}</span></th>`;
  }).join("");
  // 各列筛选弹窗
  const filterPopups = Object.values(QI_FILTER_CONFIG).map((fc) => {
    const cur = fc.type === "date_range" ? (fil["start_date"] || fil["end_date"]) : (fil[fc.filterKey] || "");
    let body = "";
    if (fc.type === "date_range") {
      const sd = fil["start_date"] || "";
      const ed = fil["end_date"] || "";
      body = `<div class="qi-filter-date-wrap">
        <div class="qi-filter-date-row"><label>从</label><input type="date" class="qi-filter-date-input" data-filter-key="start_date" value="${escapeAttr(sd)}" /></div>
        <div class="qi-filter-date-row"><label>至</label><input type="date" class="qi-filter-date-input" data-filter-key="end_date" value="${escapeAttr(ed)}" /></div>
        <button type="button" class="qi-filter-apply-btn qi-filter-date-apply" data-filter-key="date_range">确定</button></div>`;
    } else if (fc.type === "searchable_select") {
      const opts = fc.options || [];
      const optsHtml = opts.map(v => {
        const activeCls = cur === v ? ' qi-filter-opt--active' : '';
        return `<div class="qi-filter-opt${activeCls}" data-filter-key="${escapeAttr(fc.filterKey)}" data-filter-value="${escapeAttr(v)}">${escapeHtml(v)}</div>`;
      }).join("");
      body = `<div class="qi-filter-search-wrap"><input type="search" class="qi-filter-search-input" data-filter-key="${escapeAttr(fc.filterKey)}" placeholder="搜索…" autocomplete="off" /></div><div class="qi-filter-options-list" data-filter-key="${escapeAttr(fc.filterKey)}">${optsHtml}</div>`;
    } else if (fc.type === "select") {
      const opts = fc.options || [];
      const labels = fc.optionLabels || {};
      body = opts.map(v => {
        const label = labels[v] || v;
        const activeCls = cur === v ? ' qi-filter-opt--active' : '';
        return `<div class="qi-filter-opt${activeCls}" data-filter-key="${escapeAttr(fc.filterKey)}" data-filter-value="${escapeAttr(v)}">${escapeHtml(label)}</div>`;
      }).join("");
    } else {
      body = `<div class="qi-filter-text-wrap"><input type="text" class="qi-filter-text-input" data-filter-key="${escapeAttr(fc.filterKey)}" value="${escapeAttr(cur)}" placeholder="输入筛选…" /><button type="button" class="qi-filter-apply-btn" data-filter-key="${escapeAttr(fc.filterKey)}">确定</button></div>`;
    }
    const clearBtn = cur ? '<div class="qi-filter-opt qi-filter-opt--clear" data-filter-key="' + escapeAttr(fc.filterKey) + '" data-filter-value="">清除筛选</div>' : '';
    return `<div id="qi-filter-popup-${escapeAttr(fc.filterKey)}" class="qi-filter-popup" hidden>${body}${clearBtn}</div>`;
  }).join("");
  const pag = `
    <div id="qi-list-pagination" class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${total} 条，第 ${state.qiListPage}/${pages} 页</span>
        <label class="list-pagination-size"><span class="list-pagination-size-text">每页</span>
          <select id="qi-page-size" class="list-page-size">${sizeOps}</select><span class="list-pagination-size-suffix">条</span></label>
        <div class="list-pagination-nav">
          <button class="action list-page-btn" type="button" id="qi-page-prev" ${state.qiListPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="action list-page-btn" type="button" id="qi-page-next" ${state.qiListPage >= pages ? "disabled" : ""}>下一页</button></div></div></div>`;
  return `<section class="req-wrap" id="qi-panel">
    <div class="req-toolbar">${tabsHtml}
      <div class="req-search"><input type="search" id="qi-search-input" class="req-search-input" placeholder="搜索编号/标题/提出人/运维单号/分类/领域/模块" value="${escapeAttr(state.qiListSearch)}" /><button type="button" class="action" id="qi-search-btn">搜索</button></div>${toolbarRightHtml}</div>
    <div class="req-table-card"><table class="req-table req-table--full"><thead><tr>${headHtml}</tr></thead><tbody>${state.qiList.length ? rows : empty}</tbody></table>${filterPopups}${pag}</div></section>`;
}

// ===================================================================
// 分析看板渲染
// ===================================================================
function renderQiAnalyticsFilters() {
  const presets = QI_ANALYTICS_PRESETS;
  const activeIdx = Math.max(0, presets.findIndex(p => p.key === state.qiAnalyticsPreset));
  const isCustom = state.qiAnalyticsPreset === "custom";
  // 统计图表同款胶囊分段（圆角轨道 + 滑动白块），比零散 .req-tab 更醒目；保留 data-qi-analytics-preset 绑定
  const presetBtns = presets.map(p => `<button type="button" class="qi-preset-seg-btn" data-qi-analytics-preset="${p.key}" aria-selected="${state.qiAnalyticsPreset === p.key ? "true" : "false"}">${p.label}</button>`).join("");
  const customRow = isCustom
    ? `<span class="req-analytics-date-row">${renderDateRangeHtml({ id: "qi-analytics-custom", startYmd: state.qiAnalyticsStart, endYmd: state.qiAnalyticsEnd, className: "date-range--inline" })}</span>` : "";
  return `<div class="req-analytics-filters"><div class="qi-preset-seg${isCustom ? " qi-preset-seg--custom" : ""}" style="--seg-i:${activeIdx}"><span class="qi-preset-seg-slider"></span><div class="qi-preset-seg-inner">${presetBtns}</div></div>${customRow}</div>`;
}

// 阶段多选筛选（仅作用于 领域/模块分布、领域×用户）
function renderQiAnalyticsStageFilter() {
  const selStages = state.qiAnalyticsStages || [];
  const btns = QI_STAGE_KEYS.map(sk => `<button type="button" class="req-tab${selStages.includes(sk) ? " active" : ""}" data-qi-analytics-stage="${sk}">${QI_STAGE_NAMES_CN[sk]}</button>`).join("");
  const sf = state.qiAnalyticsStatusFilter || "";
  const statusOpts = [
    { v: "", l: "全部" },
    { v: "in_progress", l: "进行中" },
    { v: "closed_reject", l: "不接纳关闭" },
    { v: "closed_done", l: "实施完成关闭" },
  ];
  const sfBtns = statusOpts.map(o => `<button type="button" class="req-tab${sf === o.v ? " active" : ""}" data-qi-analytics-status="${o.v}">${o.l}</button>`).join("");
  return `<div class="req-analytics-stage-filter"><span class="req-analytics-stage-label">阶段筛选<em>（领域/模块·用户）</em></span><span class="req-analytics-stage-btns">${btns}</span>
    <span class="req-analytics-stage-label" style="margin-left:12px">状态</span><span class="req-analytics-stage-btns">${sfBtns}</span></div>`;
}


// ===================================================================
// 提交数堆叠图（ECharts）：数据聚合 + 挂载 + 放大浮层
// 对齐「各阶段人员平均滞留时间」的 ECharts 实现（buildStatsLaborEchartStackedBarOption）
// ===================================================================
let _qiSubmissionChart = null;

function disposeQiSubmissionChart() {
  if (_qiSubmissionChart) {
    try { _qiSubmissionChart.dispose(); } catch (_) { /* ignore */ }
    _qiSubmissionChart = null;
  }
}

// 由 [{domain,user,stage,count}] 聚合出 ECharts 堆叠柱图 option。
// opts.limit：页内 Top N 截断（不合并「其他」）；不传则全量用户（放大浮层用）。
function buildQiSubmissionStackedOption(data, opts = {}) {
  const userTotals = {};
  (data || []).forEach(r => { userTotals[r.user] = (userTotals[r.user] || 0) + r.count; });
  let ranked = Object.entries(userTotals).sort((a, b) => b[1] - a[1]).map(([u, v]) => ({ label: u, value: v }));
  if (!ranked.length) return null;
  if (opts.limit) ranked = topN(ranked, opts.limit);
  const groups = ranked.map(i => i.label);
  const stageLabels = QI_STAGE_KEYS.map(k => QI_STAGE_NAMES_CN[k] || k);
  const labelToKey = {};
  QI_STAGE_KEYS.forEach(k => { labelToKey[QI_STAGE_NAMES_CN[k] || k] = k; });
  const getValues = (gi, label) => {
    const stageKey = labelToKey[label] || label;
    return data
      .filter(r => r.user === groups[gi] && r.stage === stageKey)
      .reduce((s, r) => s + r.count, 0);
  };
  return buildStatsLaborEchartStackedBarOption(groups, stageLabels, getValues);
}

function mountQiSubmissionChart() {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  _bindQiEchartResize();
  const data = (state.qiAnalyticsFull && state.qiAnalyticsFull.userSubRaw) || [];
  const opt = buildQiSubmissionStackedOption(data, { limit: 15 });
  const paint = (attempt = 0) => {
    const el = document.getElementById("qi-analytics-echart-user-sub");
    if (!el) { disposeQiSubmissionChart(); return; }
    const w = el.clientWidth;
    const h = el.clientHeight;
    if ((w < 2 || h < 2) && attempt < 10) {
      requestAnimationFrame(() => paint(attempt + 1));
      return;
    }
    disposeQiSubmissionChart();
    if (!opt) {
      el.innerHTML = '<div class="qi-stage-empty">暂无数据</div>';
      return;
    }
    el.innerHTML = "";
    _qiSubmissionChart = E.init(el, null, { renderer: "canvas" });
    _qiSubmissionChart.setOption(opt, { notMerge: true });
    _markQiLegendSuppress(_qiSubmissionChart, el);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => paint(0)));
}

// 提交数放大浮层：点击图表弹全屏浮层，内嵌全量 ECharts（不截断 Top N）
function bindQiSubmissionZoom() {
  _bindQiCardZoom("user-sub", "zoomBound", () => {
    const data = (state.qiAnalyticsFull && state.qiAnalyticsFull.userSubRaw) || [];
    if (!data.length) return; // 空数据不打开浮层（与其它放大绑定一致）
    openChartZoomEchart("每人各阶段改进单数量", () => buildQiSubmissionStackedOption(data));
  });
}

// ===================================================================
// 非堆积柱状图（ECharts，复用统计图表-人力投入 buildStatsLaborEchartBarOption）
// ===================================================================
const _qiBarCharts = {}; // key → echarts instance

function disposeQiBarCharts() {
  Object.values(_qiBarCharts).forEach(c => { try { c.dispose(); } catch (_) { /* ignore */ } });
  Object.keys(_qiBarCharts).forEach(k => delete _qiBarCharts[k]);
}

// items: [{label, value}]
function _mountQiBarChart(key, elId, option) {
  const E = typeof window !== "undefined" ? window.echarts : undefined;
  if (!E) return;
  const paint = (attempt = 0) => {
    const el = document.getElementById(elId);
    if (!el) { if (_qiBarCharts[key]) { try { _qiBarCharts[key].dispose(); } catch (_) {} delete _qiBarCharts[key]; } return; }
    if ((el.clientWidth < 2 || el.clientHeight < 2) && attempt < 10) {
      requestAnimationFrame(() => paint(attempt + 1));
      return;
    }
    if (_qiBarCharts[key]) { try { _qiBarCharts[key].dispose(); } catch (_) {} delete _qiBarCharts[key]; }
    if (!option) {
      el.innerHTML = '<div class="qi-stage-empty">暂无数据</div>';
      return;
    }
    el.innerHTML = "";
    _qiBarCharts[key] = E.init(el, null, { renderer: "canvas" });
    _qiBarCharts[key].setOption(option, { notMerge: true });
    _markQiLegendSuppress(_qiBarCharts[key], el);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => paint(0)));
}

function mountQiBarCharts() {
  const f = state.qiAnalyticsFull;
  if (!f) return;
  _bindQiEchartResize();
  const mk = (items, aria) => items && items.length
    ? buildStatsLaborEchartBarOption(items.map(i => i.label), items.map(i => i.value), { aria, showValues: true })
    : null;
  _mountQiBarChart("domain-bar", "qi-analytics-echart-domain-bar",
    mk(topN(f.domain || [], 10), "领域分布"));
  _mountQiBarChart("module-bar", "qi-analytics-echart-module-bar",
    mk(topN(f.moduleBar || [], 10), "模块分布"));
  _mountQiBarChart("user-acc", "qi-analytics-echart-user-acc",
    mk(topN(f.userAcc || [], 15), "用户接纳率(%)"));
  // 每人待处理单量（按处理人维度，按阶段堆叠，与阶段筛选联动）
  const hsd = f.handlerStageRaw || [];
  const hTotals = {};
  hsd.forEach(r => { hTotals[r.user] = (hTotals[r.user] || 0) + r.count; });
  const hRanked = Object.entries(hTotals).sort((a, b) => b[1] - a[1]).map(([u, v]) => ({ label: u, value: v }));
  const hGroups = topN(hRanked, 15).map(i => i.label);
  if (hGroups.length) {
    const stageLabels = QI_STAGE_KEYS.map(k => QI_STAGE_NAMES_CN[k] || k);
    const getHValues = (gi, label) => {
      const stageKey = QI_STAGE_KEYS[stageLabels.indexOf(label)] || label;
      return hsd.filter(r => r.user === hGroups[gi] && r.stage === stageKey).reduce((s, r) => s + r.count, 0);
    };
    _mountQiBarChart("user-pending", "qi-analytics-echart-user-pending",
      buildStatsLaborEchartStackedBarOption(hGroups, stageLabels, getHValues));
  } else {
    _mountQiBarChart("user-pending", "qi-analytics-echart-user-pending", null);
  }
  // 在研责任田三图（数据量小不裁剪；空数组 → 挂 null 显示空容器）
  _mountQiBarChart("rf-acc", "qi-analytics-echart-rf-acc", mk(f.rfAcc || [], "责任田接纳率(%)"));
  _mountQiBarChart("rf-closure", "qi-analytics-echart-rf-closure", mk(f.rfClosure || [], "责任田闭环率(%)"));
  _mountQiBarChart("rf-overdue", "qi-analytics-echart-rf-overdue", mk(f.rfOverdue || [], "责任田超期单数"));
  _mountQiBarChart("rf-overdue-rate", "qi-analytics-echart-rf-overdue-rate", mk(f.rfOverdueRate || [], "责任田超期率(%)"));
}

// 点击放大（拖拽 dataZoom 后不触发）
function bindQiBarZoom(key, title, getItems) {
  _bindQiCardZoom(key, "barZoomBound", () => {
    const items = getItems();
    if (!items || !items.length) return;
    openChartZoomEchart(title, () => buildStatsLaborEchartBarOption(
      items.map(i => i.label), items.map(i => i.value), { aria: title, showValues: true }
    ));
  });
}

// 每人待处理单量堆叠图放大（全量，按阶段堆叠）
function bindQiPendingZoom() {
  _bindQiCardZoom("user-pending", "barZoomBound", () => {
    const hsd = (state.qiAnalyticsFull || {}).handlerStageRaw || [];
    if (!hsd.length) return;
    const totals = {};
    hsd.forEach(r => { totals[r.user] = (totals[r.user] || 0) + r.count; });
    const groups = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const stageLabels = QI_STAGE_KEYS.map(k => QI_STAGE_NAMES_CN[k] || k);
    const getValues = (gi, label) => {
      const stageKey = QI_STAGE_KEYS[stageLabels.indexOf(label)] || label;
      return hsd.filter(r => r.user === groups[gi] && r.stage === stageKey).reduce((s, r) => s + r.count, 0);
    };
    openChartZoomEchart("每人待处理单量（按阶段）", () =>
      buildStatsLaborEchartStackedBarOption(groups, stageLabels, getValues));
  });
}

function renderQiAnalyticsBody() {
  if (state.qiAnalyticsLoading) return `<div class="req-analytics-loading">加载中…</div>`;
  const d = state.qiAnalyticsData;
  if (!d) return `<div class="req-analytics-loading">正在加载…</div>`;
  if (d.error) return `<div class="req-analytics-error">加载失败</div>`;
  const kpi = d.kpi || {};
  const kpiRow = `<div class="req-analytics-kpi-grid">
    ${renderQiKpiCard("改进项总数", kpi.total || 0, "")}
    ${renderQiKpiCard("进行中", kpi.in_progress || 0, "")}
    ${renderQiKpiCard("超时", kpi.overtime || 0, "超时率 " + (d.overtime_rate || 0) + "%")}</div>`;
  // 阶段分布 / 改进类型（饼图，ECharts option 构建在 mount 时进行，这里只存数据）
  const sd = d.stage_distribution || {};
  const stageItems = (sd.labels || []).map((l, i) => ({ label: l, value: (sd.values || [])[i] || 0 }));
  const cd = d.category_distribution || {};
  const catItems = (cd.labels || []).map((l, i) => ({ label: l, value: (cd.values || [])[i] || 0 }));
  const distSection = `<section class="req-analytics-section">
    <h2 class="req-analytics-h2">分布总览</h2>
    <div class="req-analytics-dist-grid">
      <div class="req-analytics-block req-analytics-dist-col" style="--stat-card-delay:0.05s"><h3>阶段</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-stage-pie"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" style="--stat-card-delay:0.1s"><h3>改进类型</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-category-pie"></div></div></div>
    </div></section>`;
  // 领域分布（ECharts 柱图 option 构建在 mount 时进行，这里只存数据）
  const dd = d.domain_distribution || {};
  const ddItemsFull = (dd.labels || []).map((l, i) => ({ label: l, value: (dd.values || [])[i] || 0 }))
    .sort((a, b) => b.value - a.value);
  // 模块&特性分布：饼图卡（ECharts）、柱图卡（ECharts）各自独立按领域筛选
  const dmd = d.domain_module_distribution || [];
  const moduleAllDomains = [...new Set(dmd.map(r => r.domain))].sort();
  const selModDomainPie = moduleAllDomains.includes(state.qiAnalyticsModuleDomainPie) ? state.qiAnalyticsModuleDomainPie : "";
  const selModDomainBar = moduleAllDomains.includes(state.qiAnalyticsModuleDomainBar) ? state.qiAnalyticsModuleDomainBar : "";
  const aggModules = (sel) => {
    const agg = {};
    (sel ? dmd.filter(r => r.domain === sel) : dmd)
      .forEach(r => { agg[r.module] = (agg[r.module] || 0) + r.count; });
    return Object.entries(agg).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const mdItemsFullPie = aggModules(selModDomainPie);
  const mdItemsFullBar = aggModules(selModDomainBar);
  const mdItemsBar = topN(mdItemsFullBar, 10);
  const moduleFilterHtml = (attr, sel) => `<label class="req-analytics-domain-row">模块按领域：<select ${attr}>` +
    `<option value="">全部领域</option>` +
    moduleAllDomains.map(dm => `<option value="${escapeAttr(dm)}"${sel === dm ? " selected" : ""}>${escapeHtml(dm)}</option>`).join("") +
    `</select></label>`;
  const moduleDomainFilterPie = moduleFilterHtml("data-qi-analytics-module-domain-pie", selModDomainPie);
  const moduleDomainFilterBar = moduleFilterHtml("data-qi-analytics-module-domain-bar", selModDomainBar);
  // 领域 / 模块 占比饼图（ECharts option 构建在 mount 时进行）
  const dmSection = `<section class="req-analytics-section">
    <h2 class="req-analytics-h2">领域 / 模块分布</h2>
    <div class="req-analytics-dist-grid">
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="domain-pie" style="--stat-card-delay:0.05s"><h3>领域占比</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-domain-pie"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="module-pie" style="--stat-card-delay:0.1s"><h3>模块&特性占比</h3>${moduleDomainFilterPie}<div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-module-pie"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="domain-bar" style="--stat-card-delay:0.15s"><h3>领域</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-domain-bar"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="module-bar" style="--stat-card-delay:0.2s"><h3>模块&特性</h3>${moduleDomainFilterBar}<div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-module-bar"></div></div></div>
    </div></section>`;
  // 领域×用户矩阵 + 柱状图（可按领域筛选；数据已全量在 d，纯前端过滤无需重拉）
  const subRaw = d.user_domain_submission || [];
  const accRaw = d.user_domain_acceptance || [];
  const usdRaw = d.user_stage_distribution || []; // [{domain,user,stage,count}]
  const allDomains = [...new Set([...subRaw.map(r => r.domain), ...accRaw.map(r => r.domain)])].sort();
  // 提交数/接纳数各自独立按领域筛选（互不耦合）；选中领域不在当前数据中→视为不选
  const selDomainSub = allDomains.includes(state.qiAnalyticsDomainSub) ? state.qiAnalyticsDomainSub : "";
  const selDomainAcc = allDomains.includes(state.qiAnalyticsDomainAcc) ? state.qiAnalyticsDomainAcc : "";
  const selDomainPend = allDomains.includes(state.qiAnalyticsDomainPend) ? state.qiAnalyticsDomainPend : "";
  const usdData = selDomainSub ? usdRaw.filter(r => r.domain === selDomainSub) : usdRaw;
  const hsdRaw = d.handler_stage_distribution || [];
  const hsdData = selDomainPend ? hsdRaw.filter(r => r.domain === selDomainPend) : hsdRaw;
  const domainFilterHtml = (attr, sel) => `<label class="req-analytics-domain-row">领域：<select ${attr}>` +
    `<option value="">全部领域</option>` +
    allDomains.map(dm => `<option value="${escapeAttr(dm)}"${sel === dm ? " selected" : ""}>${escapeHtml(dm)}</option>`).join("") +
    `</select></label>`;
  const domainFilterSub = domainFilterHtml("data-qi-analytics-domain-sub", selDomainSub);
  const domainFilterAcc = domainFilterHtml("data-qi-analytics-domain-acc", selDomainAcc);
  const domainFilterPend = domainFilterHtml("data-qi-analytics-domain-pend", selDomainPend);
  // 接纳率 = 接纳数/提交数 百分比（不与阶段筛选联动，用后端全量数据 user_sub_all/user_acc_all；领域筛选仍生效）
  const subAllData = d.user_sub_all || [];
  const accAllData = d.user_acc_all || [];
  const accSubFiltered = selDomainAcc ? subAllData.filter(r => r.domain === selDomainAcc) : subAllData;
  const accAccFiltered = selDomainAcc ? accAllData.filter(r => r.domain === selDomainAcc) : accAllData;
  function userRateItems() {
    const subTotals = {};
    accSubFiltered.forEach(r => { subTotals[r.user] = (subTotals[r.user] || 0) + r.count; });
    const accTotals = {};
    accAccFiltered.forEach(r => { accTotals[r.user] = (accTotals[r.user] || 0) + r.count; });
    // 以提交用户为准（有提交没接纳的用户也显示，率为 0%）
    return Object.keys(subTotals)
      .map(u => {
        const sub = subTotals[u];
        const acc = accTotals[u] || 0;
        return { label: u, value: sub > 0 ? Math.round(acc / sub * 100) : 0 };
      })
      .sort((a, b) => b.value - a.value);
  }
  // 在研责任田：分析阶段后各责任田处理情况（接纳率=接纳/已分析、闭环率=验收通过关单/接纳、超期单数）
  const rfStats = Array.isArray(d.research_field_stats) ? d.research_field_stats : [];
  const rfLabel = r => String(r.name || r.domain || "—");
  function rfRateItems(kind) {
    return rfStats
      .map(r => {
        const denom = kind === "acc" ? Number(r.analyzed) || 0 : Number(r.accepted) || 0;
        const numer = kind === "acc" ? Number(r.accepted) || 0 : Number(r.closed_done) || 0;
        return { label: rfLabel(r), owner: String(r.owner || ""), value: denom > 0 ? Math.round(numer / denom * 100) : 0, denom };
      })
      .filter(r => r.denom > 0)
      .sort((a, b) => b.value - a.value);
  }
  function rfOverdueItems() {
    return rfStats
      .map(r => ({ label: rfLabel(r), owner: String(r.owner || ""), value: Number(r.overdue) || 0 }))
      .filter(r => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }
  // 责任田超期率 =（确认超期+实施超期）/（确认+实施总量），与改进报告口径一致
  function rfOverdueRateItems() {
    return rfStats
      .map(r => {
        const numer = (Number(r.analysis_overdue) || 0) + (Number(r.closure_overdue) || 0);
        const denom = (Number(r.analysis_total) || 0) + (Number(r.closure_total) || 0);
        return { label: rfLabel(r), owner: String(r.owner || ""), value: denom > 0 ? Math.round(numer / denom * 100) : 0, denom };
      })
      .filter(r => r.denom > 0)
      .sort((a, b) => b.value - a.value);
  }
  // 全量数据（供放大浮层重绘全量图：页内恒 Top N 截断，浮层全量）
  state.qiAnalyticsFull = {
    stage: stageItems, category: catItems,
    domain: ddItemsFull, modulePie: mdItemsFullPie, moduleBar: mdItemsFullBar,
    userSubRaw: usdData, userAcc: userRateItems(),
    handlerStageRaw: hsdData,
    rfAcc: rfRateItems("acc"), rfClosure: rfRateItems("closure"), rfOverdue: rfOverdueItems(),
    rfOverdueRate: rfOverdueRateItems(),
  };
  const matrixSection = `<section class="req-analytics-section">
    <h2 class="req-analytics-h2">领域 × 用户</h2>
    <div class="req-analytics-dist-grid">
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="user-sub" style="--stat-card-delay:0.05s"><h3>每人各阶段改进单数量</h3>${domainFilterSub}<div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-user-sub"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="user-acc" style="--stat-card-delay:0.1s"><h3>接纳率(%)</h3>${domainFilterAcc}<div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-user-acc"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="user-pending" style="--stat-card-delay:0.15s"><h3>每人待处理单量（按阶段）</h3>${domainFilterPend}<div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-user-pending"></div></div></div>
    </div></section>`;
  const rfSection = rfStats.length
    ? `<section class="req-analytics-section">
    <h2 class="req-analytics-h2">在研责任田</h2>
    <div class="req-analytics-dist-grid">
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="rf-acc" style="--stat-card-delay:0.05s"><h3>责任田接纳率(%)</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-rf-acc"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="rf-closure" style="--stat-card-delay:0.1s"><h3>责任田闭环率(%)</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-rf-closure"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="rf-overdue" style="--stat-card-delay:0.15s"><h3>责任田超期单数</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-rf-overdue"></div></div></div>
      <div class="req-analytics-block req-analytics-dist-col" data-qichart="rf-overdue-rate" style="--stat-card-delay:0.2s"><h3>责任田超期率(%)</h3><div class="req-analytics-chart-center"><div class="stat-echart-host" id="qi-analytics-echart-rf-overdue-rate"></div></div></div>
    </div></section>`
    : `<section class="req-analytics-section">
    <h2 class="req-analytics-h2">在研责任田</h2>
    <div class="qi-stage-empty">暂无在研责任田：请在「参数配置 → 在研责任田」中维护</div>
  </section>`;
  return `<div class="req-analytics-page">${kpiRow}${distSection}${renderQiAnalyticsStageFilter()}${dmSection}${matrixSection}${rfSection}</div>`;
}

// ===================================================================
// 弹窗渲染
// ===================================================================
// 算字段当前是否必填（基础 required 或条件必填 required_when 满足），用于显示星号
function reqMark(f, bundle) {
  return qiFieldRequired(f, bundle || {}) ? " *" : "";
}

function selectField(id, label, opts, current, mark) {
  const o = opts.map(v => `<option value="${escapeAttr(v)}" ${v === current ? "selected" : ""}>${escapeHtml(v)}</option>`).join("");
  return `<label class="req-field"><span class="req-field-caption">${escapeHtml(label)}<span class="req-mark" data-mark-for="${id}">${mark}</span></span><select id="${id}" class="req-input">${o}</select></label>`;
}

export function stageFormHtml(prefix, stageKey, bundle) {
  const fields = QI_STAGE_FIELDS[stageKey];
  if (!fields) return "";
  const v = (k, dflt) => escapeAttr(String(bundle && bundle[k] != null ? bundle[k] : dflt));
  let html = "";
  for (const f of fields) {
    const cur = bundle ? String(bundle[f.key] || "") : "";
    const mark = reqMark(f, bundle);
    if (f.type === "select" && f.options) {
      html += selectField(`${prefix}-${f.key}`, f.label, f.options, cur, mark);
    } else if (f.type === "richtext") {
      const editorId = `${prefix}-${f.key}`;
      html += `<label class="req-field req-field--full">
        <span class="req-field-label">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${editorId}">${mark}</span></span>
        <div class="rich-editor" data-rich-editor data-editor-id="${editorId}" data-disabled="0">
          ${renderRichToolbarHtml()}
          <div class="rich-content" id="${editorId}" contenteditable="true" data-placeholder="请输入${escapeHtml(f.label)}...">${cur}</div>
          <input type="hidden" data-rich-key="${f.key}" value="${escapeAttr(cur)}" data-rich-hidden />
        </div>
      </label>`;
    } else if (f.type === "textarea") {
      html += `<label class="req-field"><span class="req-field-caption">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${mark}</span></span><textarea id="${prefix}-${f.key}" class="req-textarea" rows="3">${escapeHtml(cur)}</textarea></label>`;
    } else if (f.type === "date") {
      const dv = cur ? String(cur).slice(0, 10) : formatYmdLocal(new Date());
      html += `<label class="req-field"><span class="req-field-caption">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${mark}</span></span><input type="date" id="${prefix}-${f.key}" class="req-input" value="${escapeAttr(dv)}" /></label>`;
    } else if (f.type === "person") {
      html += `<label class="req-field"><span class="req-field-caption">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${mark}</span></span>
        <div class="qi-person-picker" data-person-input="${prefix}-${f.key}">
          <input type="text" id="${prefix}-${f.key}" class="req-input qi-person-input" value="${v(f.key, "")}" placeholder="输入账号或姓名搜索" autocomplete="off" />
          <div class="qi-person-suggest" hidden></div>
        </div></label>`;
    } else {
      html += `<label class="req-field"><span class="req-field-caption">${escapeHtml(f.label)}<span class="req-mark" data-mark-for="${prefix}-${f.key}">${mark}</span></span><input type="text" id="${prefix}-${f.key}" class="req-input" value="${v(f.key, "")}" /></label>`;
    }
  }
  // 注：处理方式按钮由 renderQiFlowStageForm 统一渲染（流程视图），stageFormHtml 只产表单字段
  return html;
}

export function readStageForm(prefix, stageKey) {
  const fields = QI_STAGE_FIELDS[stageKey];
  const vals = {};
  for (const f of fields) {
    if (f.type === "richtext") {
      // 富文本值在 hidden input（bindRichEditor 同步）
      const hidden = document.querySelector(`[data-rich-key="${f.key}"]`);
      vals[f.key] = hidden ? hidden.value : "";
    } else {
      const el = document.getElementById(`${prefix}-${f.key}`);
      vals[f.key] = el ? el.value : "";
    }
  }
  return vals;
}

export function renderQiModalsHtml() {
  // 流程视图模式下，详情/创建/编辑/提交均由流程视图承载，仅保留导入弹窗
  const importOpen = state.qiImportModalOpen
    ? `<div class="perm-modal-mask req-modal-mask" id="qi-import-mask">
        <div class="perm-modal req-modal" role="dialog">
          <div class="perm-modal-head"><h3>批量导入</h3></div>
          <div class="perm-modal-body">
            <input type="file" id="qi-import-file" accept=".xlsx" />
            <div id="qi-import-errors" class="req-import-errors"></div></div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="qi-import-cancel-btn">取消</button>
            <button type="button" class="action primary" id="qi-import-submit-btn">确认导入</button>
          </div></div></div>` : "";
  return importOpen;
}

// ===================================================================
// 事件绑定
// ===================================================================

// ===================================================================
// 事件绑定
// ===================================================================

// 进入/更新流程视图的 URL 与数据
export function navigateQiFlow(viewId) {
  state.qiFlowViewId = viewId;
  state.qiFlowStage = viewId === "new" ? "propose" : "";
  state.qiDetailBundle = null;
  state.qiDetailLoaded = false;
  state.qiDetailLoading = false;
  const url = viewId === "new" ? "/qi/new" : `/qi/${viewId}`;
  // 已有单 → 打开独立 tab
  if (viewId !== "new" && Number.isFinite(viewId)) {
    state.activeKey = ensureQiDetailTab(viewId);
  }
  history.pushState({}, "", url);
  if (viewId !== "new") fetchQiDetail(viewId);
  requestRender();
}

function bindQiFlowView() {
  const isNew = state.qiFlowViewId === "new";
  // 绑定当前阶段表单内的富文本编辑器（支持粘贴/上传图片）
  document.querySelectorAll("#qi-flow-panel [data-rich-editor]").forEach(ed => bindRichEditor(ed));
  // 绑定模块&特性级联选择器（容器级事件委托；#qi-flow-panel 每次渲染重建，委托随之重绑）
  bindDutyFieldCascader(document.getElementById("qi-flow-panel"));
  // 确保用户列表已加载（提出/验收阶段转单人选需要，person picker 搜索也需要）
  if (!state.adminUsers || state.adminUsers.length === 0) {
    fetch(`${API_BASE_URL}/api/admin/users`).then(r => r.json()).then(u => {
      state.adminUsers = Array.isArray(u.items) ? u.items : [];
    }).catch(() => {});
  }
  // 富文本图片点击缩放（虚线框 + 8 手柄）
  document.querySelectorAll("#qi-flow-panel .rich-content").forEach(content => {
    attachImageResizer(content, () => {
      // 缩放后同步 hidden input
      const wrap = content.closest("[data-rich-editor]");
      if (wrap) {
        const hidden = wrap.querySelector("[data-rich-hidden]");
        if (hidden) hidden.value = content.innerHTML.trim();
      }
    });
  });
  // 条件必填星号联动：当前阶段任一字段变化时，重算所有条件必填字段的星号
  const stageKey = isNew ? "propose" : (state.qiFlowStage || state.qiDetailBundle?.request?.current_stage);
  const fields = QI_STAGE_FIELDS[stageKey];
  const prefix = isNew ? "qi-new" : `qi-stage-${stageKey}`;
  const fieldId = (key) => `${prefix}-${key}`;
  const syncMarks = () => {
    if (!fields) return;
    const cur = {};
    for (const f of fields) {
      const el = document.getElementById(fieldId(f.key));
      cur[f.key] = el ? el.value : "";
    }
    for (const f of fields) {
      const mark = qiFieldRequired(f, cur) ? " *" : "";
      const markEl = document.querySelector(`.req-mark[data-mark-for="${prefix}-${f.key}"]`);
      if (markEl && markEl.textContent !== mark) markEl.textContent = mark;
    }
  };
  if (fields) {
    fields.forEach(f => {
      const el = document.getElementById(fieldId(f.key));
      if (el) el.addEventListener("change", syncMarks);
    });
    // 初始化时用 DOM 实际值（select 默认 option 等）重算一次条件必填星号
    syncMarks();
  }
  // 加载责任田树 → 填充领域下拉；模块&特性为级联，根=所选领域的 children（领域不重复进路径）
  function rerootModuleCascader(wrap, childTree, clearValue) {
    if (!wrap) return;
    const scriptEl = wrap.querySelector("script.cascade-tree-data");
    if (scriptEl) scriptEl.textContent = JSON.stringify(childTree || []).replace(/</g, "\\u003c");
    if (clearValue) {
      const hidden = wrap.querySelector("[data-cascade-hidden]");
      if (hidden) hidden.value = "";
      delete wrap.dataset.cascadeNavPath;
    }
    dutyCascaderSyncTrigger(wrap);
    const panel = wrap.querySelector(".cascade-cascader-panel");
    if (panel && !panel.hidden) dutyCascaderRenderPanel(wrap);
  }
  fetch(`${API_BASE_URL}/api/params/duty-field/tree?operator_id=admin`).then(r => r.json()).then(data => {
    const treeNodes = (data && data.nodes) || [];
    const domainNames = treeNodes.map(n => n.label);  // 第一层=领域
    ["qi-new", "qi-stage-propose", "qi-amend-propose"].forEach(function(dp) {
      const domainSel = document.getElementById(dp + "-domain");
      if (!domainSel || domainSel.tagName !== "SELECT") return;
      // 渲染时已把已存领域写入 data-current-value；填充选项后需恢复，否则异步填选项会冲掉已选值（显示 '--'）
      const savedDomain = domainSel.dataset.currentValue || "";
      domainSel.innerHTML = '<option value="">--</option>' + domainNames.map(d => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`).join("");
      if (savedDomain) domainSel.value = savedDomain;
      const applyDomain = (clearValue) => {
        const domainNode = treeNodes.find(n => n.label === domainSel.value);
        const wrap = document.querySelector('#qi-flow-panel .cascade-cascader[data-cascade-field="module_feature"]');
        rerootModuleCascader(wrap, domainNode && domainNode.children, clearValue);
      };
      domainSel.addEventListener("change", () => applyDomain(true));  // 用户切换领域 → 旧模块路径失效，清空
      if (domainSel.value) applyDomain(false);  // 已有记录载入 → 仅重根，保留已存模块路径
    });
  }).catch(() => {});
  // 加载闭环进展配置 → 填充 progress_stage 下拉；动态更新 closure_ticket_no 标签
  fetch(`${API_BASE_URL}/api/qi/config/closure-progress?operator_id=admin`).then(r => r.json()).then(cfg => {
    const progress = (cfg && cfg.progress) || {};
    const closureMethod = (state.qiDetailBundle?.stages || []).find(s => s.stage_key === "analysis")?.values?.closure_method || "";
    const ticketLabel = closureMethod === "需求闭环" ? "需求单号" : "问题单号";
    const versionLabel = closureMethod === "需求闭环" ? "接纳版本" : "解决版本";
    document.querySelectorAll(`[data-field-label="closure_ticket_no"]`).forEach(el => {
      for (const c of el.childNodes) { if (c.nodeType === 3) { c.textContent = ticketLabel; break; } }
    });
    document.querySelectorAll(`[data-field-label="accept_version"]`).forEach(el => {
      for (const c of el.childNodes) { if (c.nodeType === 3) { c.textContent = versionLabel; break; } }
    });
    const stages = progress[closureMethod] || [];
    ["qi-stage-closure", "qi-amend-closure"].forEach(prefix => {
      const sel = document.getElementById(prefix + "-progress_stage");
      if (sel && sel.tagName === "SELECT") {
        sel.innerHTML = '<option value="">--</option>' + stages.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
      }
    });
  }).catch(() => {});
  // 加载解决版本配置 → 填充 accept_version 下拉（必填）。
  // 拉取成功 = 配置全量权威：只列启用项（管理员禁用/删除的版本不再出现，静态兜底不复活配置意图）；
  // 静态兜底（QI_ACCEPT_VERSION_FALLBACK，同 0122 种子）仅用于渲染期先填与拉取失败（.catch）两条路径；
  // 存量值不在选项中时兜底保留为选项（沿用「树外模块」同策略）。
  fetch(`${API_BASE_URL}/api/qi/config/accept-versions?operator_id=admin`).then(r => r.json()).then(cfg => {
    const rows = (cfg && cfg.versions) || [];
    const versions = rows.filter(v => v && v.enabled !== false).map(v => String(v.version)).filter(Boolean);
    ["qi-stage-closure", "qi-amend-closure"].forEach(prefix => {
      const sel = document.getElementById(prefix + "-accept_version");
      if (sel && sel.tagName === "SELECT") {
        // 用户当前已选的值优先（fetch 迟到时不覆盖正在选的项），回落渲染时存量值
        const saved = sel.value || sel.dataset.currentValue || "";
        const opts = versions.slice();
        if (saved && !opts.includes(saved)) opts.push(saved);  // 历史存量值兜底（沿用「树外模块」同策略）
        sel.innerHTML = '<option value="">--</option>' + opts.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
        if (saved) sel.value = saved;
      }
    });
  }).catch(err => console.warn("[qi] 解决版本配置加载失败，使用静态兜底选项", err));
  // 绑定人员选择器（输入联想 + 下拉，数据源 state.adminUsers）
  bindPersonPickers(document.getElementById("qi-flow-panel"));
  // 新建态无需拉详情；已有单且未加载过时拉取（qiDetailLoaded 防止加载失败后重复 fetch 死循环）
  if (!isNew && !state.qiDetailLoaded && state.qiFlowViewId) {
    fetchQiDetail(state.qiFlowViewId);
  }
  // 返回列表：切换到质量改进列表 tab
  document.getElementById("qi-flow-back")?.addEventListener("click", () => {
    state.qiFlowViewId = null;
    state.qiFlowStage = "";
    state.qiDetailBundle = null;
    state.qiDetailLoaded = false;
    state.activeKey = ensureQiTab();
    state.qiNeedsRefresh = true;
    history.pushState({}, "", "/qi");
    requestRender();
  });
  // 流程线节点点击 → 切换阶段表单
  // flow-bar 点击按钮展开对应阶段卡片
  document.querySelectorAll("[data-qi-flow-stage]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sk = btn.getAttribute("data-qi-flow-stage");
      const detail = document.querySelector(`.flow-log[data-flow-step="${sk}"]`);
      if (detail) { detail.open = true; detail.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
  });
  // 删除
  document.getElementById("qi-flow-delete")?.addEventListener("click", async () => {
    const id = state.qiFlowViewId;
    if (!id || isNew || !window.confirm("确定删除此诉求？")) return;
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
    if (!r.ok) { window.alert(`删除失败: ${await r.text()}`); return; }
    state.qiFlowViewId = null;
    history.pushState({}, "", "/qi");
    state.qiNeedsRefresh = true;
    requestRender();
  });
  // 根据表单值解析 handle_mode
  const resolveHandleMode = (sk, vals) => {
    if (sk === "propose") return "提交评审";
    if (sk === "review") return vals.review_result === "通过" ? "评审通过" : "评审不通过";
    if (sk === "analysis") return vals.accept === "是" ? "分析接纳" : "分析不接纳";
    if (sk === "closure") return "提交验收";
    if (sk === "acceptance") return vals.acceptance_pass === "通过" ? "验收通过" : "验收不通过";
    return "";
  };
  // 暴露到 window 供 inline onclick 调用（避免多次 render 导致事件绑定丢失）
  window._qiFlowSave = async (sk) => {
    if (!sk) return;
    const id = state.qiFlowViewId;
    const op = getCurrentOperator();
    if (isNew) { window.alert("请先填写表单并提交"); return; }
    if (!id) return;
    const vals = readStageForm(`qi-stage-${sk}`, sk);
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, stage_key: sk, values: vals }) });
    if (!r.ok) { window.alert(`保存失败: ${(await r.text()).slice(0,200)}`); return; }
    window.alert("已保存");
  };
  window._qiFlowSubmit = async (sk) => {
    const op = getCurrentOperator();
    if (isNew) {
      const vals = readStageForm("qi-new", "propose");
      if (!vals.title) return window.alert("改进标题不能为空");
      if (!vals.related_ticket_no) return window.alert("关联运维系统单号不能为空");
      if (!vals.description) return window.alert("详细描述不能为空");
      if (!vals.reviewer) return window.alert("下一步处理人不能为空");
      if (!vals.priority) return window.alert("优先级不能为空");
      if (!vals.domain) return window.alert("领域不能为空");
      if (!vals.module_feature) return window.alert("模块&特性不能为空");
      const r = await fetch(`${API_BASE_URL}/api/qi`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, ...vals }) });
      if (!r.ok) { window.alert(`创建失败: ${(await r.text()).slice(0,200)}`); return; }
      const j = await r.json();
      state.qiFlowViewId = j.id;
      state.qiFlowStage = "review";
      history.pushState({}, "", `/qi/${j.id}`);
      await fetchQiDetail(j.id);
      return;
    }
    const id = state.qiFlowViewId;
    if (!id || !sk) return;
    const vals = readStageForm(`qi-stage-${sk}`, sk);
    const mode = resolveHandleMode(sk, vals);
    if (!mode) return window.alert("无法确定提交方向，请检查表单填写");
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, stage_key: sk, handle_mode: mode, values: vals }) });
    if (!r.ok) { window.alert(`提交失败: ${(await r.text()).slice(0,200)}`); return; }
    await fetchQiDetail(id);
    if (state.qiDetailBundle?.request?.current_stage) {
      state.qiFlowStage = state.qiDetailBundle.request.current_stage;
    }
  };
  // 转单：弹窗选人（可搜索下拉） → POST transfer → 刷新
  window._qiFlowTransfer = async (sk) => {
    const id = state.qiFlowViewId;
    if (!id || !sk) return;
    const op = getCurrentOperator();
    if (document.getElementById("qi-transfer-modal")) return;
    // person picker 的 id 后缀决定白名单：review→reviewer，analysis→responsible（分析人白名单），closure/propose/acceptance→transfer（不限制）
    const fieldSuffix = (sk === "analysis") ? "responsible" : (sk === "review") ? "reviewer" : "transfer";
    const stageLabel = QI_STAGE_NAMES_CN[sk] || sk;
    // propose/acceptance 无白名单限制，person picker 用 "transfer" 后缀取全部活跃用户
    const container = document.createElement("div");
    container.id = "qi-transfer-modal";
    container.innerHTML = `<div class="perm-modal-mask req-modal-mask" id="qi-transfer-mask"><div class="perm-modal req-modal" role="dialog" style="max-width:420px">
      <div class="perm-modal-head"><h3>转单 · ${escapeHtml(stageLabel)}阶段</h3></div>
      <div class="perm-modal-body">
        <p style="margin:0 0 8px;color:#64748b;font-size:13px">选择新的处理人</p>
        <input type="text" id="qi-transfer-picker-${escapeAttr(fieldSuffix)}" class="problem-input qi-person-input" placeholder="输入工号或姓名搜索…" autocomplete="off" style="width:100%" />
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="qi-transfer-cancel">取消</button>
        <button type="button" class="action primary" id="qi-transfer-confirm" disabled>确认转单</button>
      </div>
    </div></div>`;
    document.body.appendChild(container);
    // 绑定 person picker（复用现有下拉搜索）
    bindPersonPickers(container);
    const input = container.querySelector(".qi-person-input");
    const confirmBtn = container.querySelector("#qi-transfer-confirm");
    let selectedValue = "";
    // person picker 选中后会设 input.value 并触发 change
    input.addEventListener("change", () => {
      selectedValue = input.value.trim();
      confirmBtn.disabled = !selectedValue;
    });
    input.addEventListener("input", () => { selectedValue = ""; confirmBtn.disabled = true; });
    const close = () => {
      if (_qiPersonCurrent?.suggest) { _qiPersonCurrent.suggest.remove(); _qiPersonCurrent = null; }
      container.remove();
    };
    container.querySelector("#qi-transfer-cancel").addEventListener("click", close);
    // 点遮罩不关闭弹窗（避免误触丢失选择），仅取消/转单成功才关闭
    confirmBtn.addEventListener("click", async () => {
      if (!selectedValue) return;
      confirmBtn.disabled = true;
      try {
        const r = await fetch(`${API_BASE_URL}/api/qi/${id}/transfer`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, transfer_to: selectedValue }),
        });
        if (!r.ok) { window.alert(`转单失败: ${(await r.text()).slice(0, 200)}`); confirmBtn.disabled = false; return; }
        close();
        await fetchQiDetail(id);
      } catch (e) { window.alert(`转单失败: ${e.message || e}`); confirmBtn.disabled = false; }
    });
    setTimeout(() => input.focus(), 50);
  };
  // 已完成阶段「保存修改」（amend）
  document.querySelectorAll(".qi-amend-save-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const sk = btn.getAttribute("data-qi-amend-stage");
      const id = state.qiFlowViewId;
      const op = getCurrentOperator();
      if (!id || !sk) return;
      const vals = {};
      const prefix = `qi-amend-${sk}`;
      const fields = QI_STAGE_FIELDS[sk] || [];
      fields.forEach(f => {
        if (f.type === "richtext") {
          const hidden = document.querySelector(`[data-rich-key="${f.key}"]`);
          vals[f.key] = hidden ? hidden.value : "";
        } else {
          const el = document.getElementById(`${prefix}-${f.key}`);
          vals[f.key] = el ? el.value : "";
        }
      });
      try {
        const r = await fetch(`${API_BASE_URL}/api/qi/${id}/save`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, stage_key: sk, values: vals }),
        });
        if (!r.ok) { window.alert(`保存失败: ${(await r.text()).slice(0,200)}`); return; }
        window.alert("保存成功");
        fetchQiDetail(id);
      } catch(e) { window.alert(`保存失败: ${e.message||e}`); }
    });
  });
  // 进展子项新增（分析/闭环当前阶段）
  document.getElementById("qi-flow-add-progress")?.addEventListener("click", async () => {
    const id = state.qiFlowViewId;
    const sk = state.qiFlowStage;
    if (!id || !sk) return;
    const content = window.prompt("进展内容：");
    if (!content) return;
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}/progress-items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, content }) });
    if (!r.ok) { window.alert(`新增失败: ${(await r.text()).slice(0,200)}`); return; }
    await fetchQiDetail(id);
  });
}

// 分析看板绑定（预设/精度/自定义日期）
function bindQiAnalytics() {
  document.querySelectorAll("[data-qi-analytics-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-qi-analytics-preset");
      if (!k) return;
      state.qiAnalyticsPreset = k;
      state.qiAnalyticsDomainSub = ""; state.qiAnalyticsDomainAcc = ""; state.qiAnalyticsDomainPend = "";  // 切换时间窗口重置领域筛选，避免幽灵筛选跨窗口复活
      state.qiAnalyticsModuleDomainPie = ""; state.qiAnalyticsModuleDomainBar = "";
      state.qiAnalyticsStages = []; state.qiAnalyticsStatusFilter = "";
      fetchQiAnalytics(true);
    });
  });
  // 阶段多选（仅作用于 领域/模块分布、领域×用户）：切换需后端过滤，重拉
  document.querySelectorAll("[data-qi-analytics-stage]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sk = btn.getAttribute("data-qi-analytics-stage");
      if (!sk) return;
      const arr = state.qiAnalyticsStages || [];
      state.qiAnalyticsStages = arr.includes(sk) ? arr.filter(x => x !== sk) : [...arr, sk];
      fetchQiAnalytics(true);
    });
  });
  // 状态筛选（全部/进行中/不接纳关闭/实施完成关闭）：切换需后端过滤，重拉
  document.querySelectorAll("[data-qi-analytics-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.qiAnalyticsStatusFilter = btn.getAttribute("data-qi-analytics-status") || "";
      fetchQiAnalytics(true);
    });
  });
  // 领域×用户：提交数/接纳数各自独立按领域筛选（互不耦合）
  const domainSubSel = document.querySelector("[data-qi-analytics-domain-sub]");
  if (domainSubSel) domainSubSel.addEventListener("change", () => { state.qiAnalyticsDomainSub = domainSubSel.value; requestRender(); });
  const domainAccSel = document.querySelector("[data-qi-analytics-domain-acc]");
  if (domainAccSel) domainAccSel.addEventListener("change", () => { state.qiAnalyticsDomainAcc = domainAccSel.value; requestRender(); });
  // 待处理单量领域筛选（独立于提交数/接纳率）
  const domainPendSel = document.querySelector("[data-qi-analytics-domain-pend]");
  if (domainPendSel) domainPendSel.addEventListener("change", () => { state.qiAnalyticsDomainPend = domainPendSel.value; requestRender(); });
  // 模块&特性 按领域筛选：饼图卡、柱图卡各自独立控制（互不耦合）
  const modPieSel = document.querySelector("[data-qi-analytics-module-domain-pie]");
  if (modPieSel) modPieSel.addEventListener("change", () => { state.qiAnalyticsModuleDomainPie = modPieSel.value; requestRender(); });
  const modBarSel = document.querySelector("[data-qi-analytics-module-domain-bar]");
  if (modBarSel) modBarSel.addEventListener("change", () => { state.qiAnalyticsModuleDomainBar = modBarSel.value; requestRender(); });
  if (state.qiAnalyticsPreset === "custom") {
    bindDateRangePicker({
      id: "qi-analytics-custom",
      getRange: () => ({ start: state.qiAnalyticsStart, end: state.qiAnalyticsEnd }),
      setRange: (start, end) => {
        state.qiAnalyticsStart = start;
        state.qiAnalyticsEnd = end;
        state.qiAnalyticsPreset = "custom";
      },
      onApplied: () => { state.qiAnalyticsDomainSub = ""; state.qiAnalyticsDomainAcc = ""; state.qiAnalyticsDomainPend = ""; state.qiAnalyticsModuleDomainPie = ""; state.qiAnalyticsModuleDomainBar = ""; state.qiAnalyticsStages = []; state.qiAnalyticsStatusFilter = ""; fetchQiAnalytics(true); },
      requestRender,
    });
  }
  // 预建放大浮层（懒创建，首屏即存在且隐藏）
  ensureChartZoomOverlay();
  // 提交数（ECharts）：挂载 + 点击放大浮层
  mountQiSubmissionChart();
  bindQiSubmissionZoom();
  // 非堆积柱状图（ECharts，复用统计图表-人力投入方案）：挂载 + 点击放大
  mountQiBarCharts();
  bindQiBarZoom("domain-bar", "领域分布", () => (state.qiAnalyticsFull || {}).domain || []);
  bindQiBarZoom("module-bar", "模块分布", () => (state.qiAnalyticsFull || {}).moduleBar || []);
  bindQiBarZoom("user-acc", "接纳率(%)", () => (state.qiAnalyticsFull || {}).userAcc || []);
  bindQiBarZoom("rf-acc", "责任田接纳率(%)", () => (state.qiAnalyticsFull || {}).rfAcc || []);
  bindQiBarZoom("rf-closure", "责任田闭环率(%)", () => (state.qiAnalyticsFull || {}).rfClosure || []);
  bindQiBarZoom("rf-overdue", "责任田超期单数", () => (state.qiAnalyticsFull || {}).rfOverdue || []);
  bindQiBarZoom("rf-overdue-rate", "责任田超期率(%)", () => (state.qiAnalyticsFull || {}).rfOverdueRate || []);
  bindQiPendingZoom();
  // 饼图（ECharts，复用统计图表-各阶段问题占比方案）：挂载 + 点击放大（仅领域/模块占比）
  mountQiPieCharts();
  bindQiPieZoom("domain-pie", "领域占比", () => (state.qiAnalyticsFull || {}).domain || []);
  bindQiPieZoom("module-pie", "模块占比", () => (state.qiAnalyticsFull || {}).modulePie || []);
}

export function bindQiPage() {
  // 流程视图绑定（全屏）
  if (state.qiFlowViewId !== null) {
    bindQiFlowView();
    return;
  }
  if (state.qiNeedsRefresh) {
    state.qiNeedsRefresh = false;
    if (state.qiTab === "analytics") { fetchQiAnalytics(true); }
    else { fetchQiFilterOptions(); fetchQiList(true); }
  }
  if (state.qiTab === "analytics") bindQiAnalytics();
  else { disposeQiSubmissionChart(); disposeQiBarCharts(); disposeQiPieCharts(); }
  // Tab 切换
  document.querySelectorAll("[data-qi-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-qi-tab");
      if (!t || t === state.qiTab) return;
      state.qiTab = t; state.qiListPage = 1;
      if (t === "analytics") fetchQiAnalytics(true);
      else fetchQiList(true);
    });
  });
  // 搜索（点击按钮或回车触发）
  const si = document.getElementById("qi-search-input");
  si?.addEventListener("input", (ev) => { state.qiListSearch = ev.target.value; });
  si?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { state.qiListPage = 1; fetchQiList(true); } });
  document.getElementById("qi-search-btn")?.addEventListener("click", () => { state.qiListPage = 1; fetchQiList(true); });
  // 列筛选（通用：select 点击选值 + text 输入框 + searchable_select 搜索下拉 + 清除）
  const filterIcons = document.querySelectorAll(".qi-filter-icon");
  const filterPopups = document.querySelectorAll(".qi-filter-popup");
  filterIcons.forEach(icon => {
    icon.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const idParts = icon.id.replace("qi-filter-icon-", "");
      const popup = document.getElementById(`qi-filter-popup-${idParts}`);
      if (!popup) return;
      // 关闭其他弹窗
      filterPopups.forEach(p => { if (p !== popup) p.hidden = true; });
      popup.hidden = !popup.hidden;
      const r = icon.getBoundingClientRect();
      popup.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom+4}px;z-index:99;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.08);min-width:180px;max-height:320px`;
      // 聚焦 search input 或 text input；重置搜索
      setTimeout(() => {
        const si = popup.querySelector(".qi-filter-search-input");
        if (si) { si.value = ""; si.focus(); si.dispatchEvent(new Event("input", { bubbles: true })); }
        const ti = popup.querySelector(".qi-filter-text-input");
        if (ti) ti.focus();
      }, 50);
    });
  });
  // 搜索下拉：输入时过滤选项
  document.getElementById("qi-panel")?.addEventListener("input", (ev) => {
    const si = ev.target.closest(".qi-filter-search-input");
    if (!si) return;
    const fk = si.getAttribute("data-filter-key");
    const q = (si.value || "").trim().toLowerCase();
    const list = document.querySelector(`.qi-filter-options-list[data-filter-key="${fk}"]`);
    if (!list) return;
    const opts = list.querySelectorAll(".qi-filter-opt");
    opts.forEach(opt => {
      const txt = (opt.textContent || "").toLowerCase();
      opt.style.display = !q || txt.includes(q) ? "" : "none";
    });
  });
  // 弹窗内点击：select 选项 / 清除 / 确定按钮
  document.getElementById("qi-panel")?.addEventListener("click", (ev) => {
    const opt = ev.target.closest(".qi-filter-opt");
    if (opt) {
      const fk = opt.getAttribute("data-filter-key");
      const fv = opt.getAttribute("data-filter-value") || "";
      if (!state.qiListFilters) state.qiListFilters = {};
      if (fk === "date_range") {
        delete state.qiListFilters["start_date"];
        delete state.qiListFilters["end_date"];
      } else {
        state.qiListFilters[fk] = fv;
      }
      state.qiListPage = 1;
      const popup = document.getElementById(`qi-filter-popup-${fk}`);
      if (popup) popup.hidden = true;
      fetchQiList(true);
      return;
    }
    const applyBtn = ev.target.closest(".qi-filter-apply-btn");
    if (applyBtn) {
      const fk = applyBtn.getAttribute("data-filter-key");
      if (fk === "date_range") {
        const sdEl = document.querySelector('.qi-filter-date-input[data-filter-key="start_date"]');
        const edEl = document.querySelector('.qi-filter-date-input[data-filter-key="end_date"]');
        if (!state.qiListFilters) state.qiListFilters = {};
        state.qiListFilters["start_date"] = sdEl ? sdEl.value : "";
        state.qiListFilters["end_date"] = edEl ? edEl.value : "";
        state.qiListPage = 1;
        const popup = document.getElementById("qi-filter-popup-date_range");
        if (popup) popup.hidden = true;
        fetchQiList(true);
        return;
      }
      const ti = document.querySelector(`.qi-filter-text-input[data-filter-key="${fk}"]`);
      const fv = ti ? ti.value.trim() : "";
      if (!state.qiListFilters) state.qiListFilters = {};
      state.qiListFilters[fk] = fv;
      state.qiListPage = 1;
      const popup = document.getElementById(`qi-filter-popup-${fk}`);
      if (popup) popup.hidden = true;
      fetchQiList(true);
      return;
    }
    // 点击弹窗外部关闭所有弹窗
    if (!ev.target.closest(".qi-filter-popup") && !ev.target.closest(".qi-filter-icon")) {
      filterPopups.forEach(p => { p.hidden = true; });
    }
  });
  // 弹窗内 text input 回车提交
  document.getElementById("qi-panel")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const ti = ev.target.closest(".qi-filter-text-input");
      if (ti) {
        ev.preventDefault();
        const fk = ti.getAttribute("data-filter-key");
        const fv = ti.value.trim();
        if (!state.qiListFilters) state.qiListFilters = {};
        state.qiListFilters[fk] = fv;
        state.qiListPage = 1;
        const popup = document.getElementById(`qi-filter-popup-${fk}`);
        if (popup) popup.hidden = true;
        fetchQiList(true);
      }
    }
  });
  // 全局点击关闭弹窗（兜底，委托已在 qi-panel 内处理，这里处理 panel 外的）
  if (!window._qiGlobalFilterClickBound) {
    window._qiGlobalFilterClickBound = true;
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".qi-filter-popup") && !ev.target.closest(".qi-filter-icon")) {
        document.querySelectorAll(".qi-filter-popup").forEach(p => { p.hidden = true; });
      }
    });
  }
  // 分页
  document.getElementById("qi-page-size")?.addEventListener("change", (ev) => { state.qiListPageSize = Number(ev.target.value) || 10; state.qiListPage = 1; fetchQiList(true); });
  document.getElementById("qi-page-prev")?.addEventListener("click", () => { if (state.qiListPage > 1) { state.qiListPage--; fetchQiList(true); } });
  document.getElementById("qi-page-next")?.addEventListener("click", () => { state.qiListPage++; fetchQiList(true); });
  // 行点击 → 在新 tab 打开流程视图
  document.querySelector("#qi-panel .req-table tbody")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.req-row"); if (!tr) return;
    const id = parseInt(tr.getAttribute("data-qi-id") || "-1", 10);
    if (!Number.isFinite(id) || id < 0) return;
    const qiNo = tr.getAttribute("data-qi-no") || "";
    state.activeKey = ensureQiDetailTab(id, qiNo);
    state.qiFlowViewId = id;
    state.qiDetailBundle = null;
    state.qiDetailLoaded = false;
    history.pushState({}, "", `/qi/${id}`);
    if (!state.qiDetailLoaded) fetchQiDetail(id);
    requestRender();
  });
  // 新建
  document.getElementById("qi-create-btn")?.addEventListener("click", () => navigateQiFlow("new"));
  document.getElementById("qi-create-cancel-btn")?.addEventListener("click", () => { state.qiCreateOpen = false; requestRender(); });
  document.getElementById("qi-create-mask")?.addEventListener("click", (ev) => { if (ev.target.id === "qi-create-mask") { state.qiCreateOpen = false; requestRender(); } });
  document.getElementById("qi-create-submit-btn")?.addEventListener("click", async () => {
    const vals = readStageForm("qi-create", "propose");
    if (!vals.title) return window.alert("改进标题不能为空");
    if (!vals.related_ticket_no) return window.alert("关联运维系统单号不能为空");
    if (!vals.description) return window.alert("详细描述不能为空");
    if (!vals.reviewer) return window.alert("下一步处理人不能为空");
    if (!vals.priority) return window.alert("优先级不能为空");
    if (!vals.domain) return window.alert("领域不能为空");
    if (!vals.module_feature) return window.alert("模块&特性不能为空");
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, ...vals }) });
    if (!r.ok) { const t = await r.text(); window.alert(`创建失败: ${t}`); return; }
    state.qiCreateOpen = false; fetchQiList(true);
  });
  // 详情关闭
  const closeDetail = () => { state.qiDetailId = null; state.qiDetailBundle = null; state.qiEditOpen = false; state.qiSubmitStage = ""; requestRender(); };
  document.getElementById("qi-detail-close-btn")?.addEventListener("click", closeDetail);
  document.getElementById("qi-detail-mask")?.addEventListener("click", (ev) => { if (ev.target.id === "qi-detail-mask") closeDetail(); });
  // 编辑
  document.getElementById("qi-detail-edit-btn")?.addEventListener("click", () => { if (!state.qiDetailBundle) return; state.qiEditOpen = true; requestRender(); });
  document.getElementById("qi-edit-cancel-btn")?.addEventListener("click", () => { state.qiEditOpen = false; requestRender(); });
  document.getElementById("qi-edit-submit-btn")?.addEventListener("click", async () => {
    const b = state.qiDetailBundle?.request; if (!b) return;
    const vals = readStageForm("qi-edit", "propose");
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, ...vals }) });
    if (!r.ok) { window.alert(`保存失败: ${await r.text()}`); return; }
    state.qiEditOpen = false; fetchQiDetail(b.id); fetchQiList(true);
  });
  // 删除
  document.getElementById("qi-detail-delete-btn")?.addEventListener("click", async () => {
    if (!state.qiDetailBundle || !window.confirm("确定删除？")) return;
    const id = state.qiDetailBundle.request.id;
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
    if (!r.ok) { window.alert(`删除失败: ${await r.text()}`); return; }
    closeDetail(); fetchQiList(true);
  });
  // 阶段提交按钮
  document.getElementById("qi-stage-submit-btn")?.addEventListener("click", () => {
    const btn = document.getElementById("qi-stage-submit-btn");
    const sk = btn?.getAttribute("data-qi-submit-stage");
    if (sk) { state.qiSubmitStage = sk; requestRender(); }
  });
  // 阶段提交弹窗内的处理方式按钮
  document.getElementById("qi-submit-mask")?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button.qi-handle-btn");
    if (!btn) return;
    const mode = btn.getAttribute("data-qi-handle");
    const sk = state.qiSubmitStage;
    const id = state.qiDetailId;
    if (!sk || !id || !mode) return;
    const vals = readStageForm("qi-submit", sk);
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, stage_key: sk, handle_mode: mode, values: vals }) });
    if (!r.ok) { window.alert(`提交失败: ${await r.text()}`); return; }
    state.qiSubmitStage = ""; fetchQiDetail(id); fetchQiList(true);
  });
  document.getElementById("qi-submit-cancel-btn")?.addEventListener("click", () => { state.qiSubmitStage = ""; requestRender(); });
  document.getElementById("qi-submit-mask")?.addEventListener("click", (ev) => { if (ev.target.id === "qi-submit-mask") { state.qiSubmitStage = ""; requestRender(); } });
  // 进度子项
  document.getElementById("qi-add-progress-btn")?.addEventListener("click", async () => {
    const id = state.qiDetailId; if (!id) return;
    const content = window.prompt("进展内容："); if (!content) return;
    const op = getCurrentOperator();
    const r = await fetch(`${API_BASE_URL}/api/qi/${id}/progress-items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account, content }) });
    if (!r.ok) { window.alert(`新增失败: ${await r.text()}`); return; }
    fetchQiDetail(id);
  });
  // 导出
  document.getElementById("qi-export-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator(); state.qiExportLoading = true; requestRender();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/qi/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operator_id: op.account }) });
      if (!resp.ok) { window.alert("导出失败"); return; }
      const blob = await resp.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `qi_export_${op.account}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } finally { state.qiExportLoading = false; requestRender(); }
  });
  // 导入
  document.getElementById("qi-import-btn")?.addEventListener("click", () => { state.qiImportModalOpen = true; requestRender(); });
  document.getElementById("qi-import-cancel-btn")?.addEventListener("click", () => { state.qiImportModalOpen = false; requestRender(); });
  document.getElementById("qi-import-submit-btn")?.addEventListener("click", async () => {
    const fi = document.getElementById("qi-import-file"); const f = fi?.files?.[0];
    if (!f) { window.alert("请选择文件"); return; }
    const op = getCurrentOperator(); state.qiImportLoading = true; requestRender();
    try {
      const fd = new FormData(); fd.append("file", f); fd.append("operator_id", op.account);
      const r = await fetch(`${API_BASE_URL}/api/qi/import`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) window.alert(`导入失败: ${JSON.stringify(j)}`);
      else { window.alert(j.message || "导入成功"); state.qiImportModalOpen = false; fetchQiList(true); }
    } finally { state.qiImportLoading = false; requestRender(); }
  });
  document.getElementById("qi-download-template-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator();
    const resp = await fetch(`${API_BASE_URL}/api/qi/import-template?operator_id=${encodeURIComponent(op.account)}`);
    if (!resp.ok) return window.alert("下载失败");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "qi_template.xlsx"; a.click(); URL.revokeObjectURL(url);
  });
}

// 人员选择器：事件委托，下拉挂在 body 避免 innerHTML 销毁；候选人名单来自管理员配置
let _qiPersonCurrent = null;
let _reviewerCandidates = null; // 缓存评审人候选名单
let _analystCandidates = null;  // 缓存分析师/责任人候选名单
async function loadCandidates() {
  if (_reviewerCandidates) return _reviewerCandidates;
  try {
    const r = await fetch(`${API_BASE_URL}/api/qi/candidates/reviewer?operator_id=admin`);
    const d = r.ok ? await r.json() : { candidates: [] };
    _reviewerCandidates = d.candidates || [];
  } catch (_) { _reviewerCandidates = []; }
  return _reviewerCandidates;
}
async function loadAnalystCandidates() {
  if (_analystCandidates) return _analystCandidates;
  try {
    const r = await fetch(`${API_BASE_URL}/api/qi/candidates/analyst?operator_id=admin`);
    const d = r.ok ? await r.json() : { candidates: [] };
    _analystCandidates = d.candidates || [];
  } catch (_) { _analystCandidates = []; }
  return _analystCandidates;
}
/** 根据 input id 末尾字段名推断用哪个候选名单 */
function resolveCandidatesLoader(input) {
  const fieldKey = (input.id || "").split("-").pop();
  if (fieldKey === "responsible") {
    // 确认阶段的 responsible 用于选实施人，不限制白名单
    const id = input.id || "";
    if (id.startsWith("qi-stage-analysis") || id.startsWith("qi-amend-analysis")) {
      return Promise.resolve((state.adminUsers || []).filter(u => u.is_active !== false).map(u => ({ account: u.account, user_name: u.user_name, display: `${u.user_name || u.account} ${u.account}` })));
    }
    return loadAnalystCandidates();
  }
  // propose/acceptance 转单：全部活跃用户，不走评审人/分析人白名单
  if (fieldKey === "transfer") {
    return Promise.resolve((state.adminUsers || []).filter(u => u.is_active !== false).map(u => ({ account: u.account, user_name: u.user_name, display: `${u.user_name || u.account} ${u.account}` })));
  }
  return loadCandidates();
}
export function bindPersonPickers(container) {
  if (!container || container.dataset.personBound === "1") return;
  container.dataset.personBound = "1";
  // 移除旧下拉
  if (_qiPersonCurrent?.suggest) { _qiPersonCurrent.suggest.remove(); _qiPersonCurrent = null; }
  // 聚焦事件委托
  container.addEventListener("focusin", (ev) => {
    const input = ev.target.closest(".qi-person-input");
    if (!input) return;
    openPersonSuggest(input);
  });
  container.addEventListener("input", (ev) => {
    const input = ev.target.closest(".qi-person-input");
    if (!input) return;
    renderPersonSuggest(input);
  });
  // 全局 mousedown 关闭
  document.addEventListener("mousedown", (ev) => {
    if (_qiPersonCurrent?.suggest && !_qiPersonCurrent.suggest.contains(ev.target) && !_qiPersonCurrent.input?.contains(ev.target)) {
      _qiPersonCurrent.suggest.remove();
      _qiPersonCurrent = null;
    }
  });
}

function openPersonSuggest(input) {
  if (_qiPersonCurrent?.suggest) _qiPersonCurrent.suggest.remove();
  _qiPersonCurrent = null;
  const suggest = document.createElement("div");
  suggest.className = "qi-person-suggest";
  _qiPersonCurrent = { input, suggest };
  document.body.appendChild(suggest);
  // 定位到输入框下方
  const rect = input.getBoundingClientRect();
  suggest.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom+2}px;width:${rect.width}px;max-height:240px;overflow-y:auto;z-index:10000;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.08);`;
  renderPersonSuggest(input);
}

async function renderPersonSuggest(input) {
  if (!_qiPersonCurrent || _qiPersonCurrent.input !== input) return;
  const suggest = _qiPersonCurrent.suggest;
  const candidates = await resolveCandidatesLoader(input);
  const q = (input.value || "").trim().toLowerCase();
  const matched = q
    ? candidates.filter(u => {
        const acc = String(u.account || "").toLowerCase();
        const nm = String(u.user_name || "").toLowerCase();
        return acc.includes(q) || nm.includes(q);
      }).slice(0, 20)
    : candidates.slice(0, 20);
  if (!matched.length) { suggest.innerHTML = '<div class="qi-person-item" style="color:#94a3b8;cursor:default">无匹配用户</div>'; return; }
  suggest.innerHTML = matched.map(u => {
    const label = `${u.user_name || ""} ${u.account || ""}`.trim();
    return `<div class="qi-person-item" data-label="${escapeAttr(label)}">${escapeHtml(label)}</div>`;
  }).join("");
  // 选中回调
  suggest.querySelectorAll(".qi-person-item").forEach(item => {
    item.addEventListener("mousedown", (ev) => {
      ev.preventDefault(); // 阻止 blur 先触发
      input.value = item.getAttribute("data-label") || "";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      suggest.remove();
      _qiPersonCurrent = null;
    });
  });
}

// ===================================================================
// 质量改进统计分析（独立页面 stats:qi-analytics）
// ===================================================================
export function renderQiAnalyticsPage() {
  return `<section class="req-wrap" id="qi-analytics-panel">
    <div class="req-toolbar">${renderQiAnalyticsFilters()}</div>
    ${renderQiAnalyticsBody()}
  </section>`;
}

export function bindQiAnalyticsPage() {
  if (state.qiAnalyticsNeedsRefresh) {
    state.qiAnalyticsNeedsRefresh = false;
    fetchQiAnalytics(true);
  }
  bindQiAnalytics();
}
