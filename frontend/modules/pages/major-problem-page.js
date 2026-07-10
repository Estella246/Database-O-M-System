import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { bindListSearchInput, consumeSkipListLoadingRender } from "../ui/list-search-input.js";
import { bindDateRangePicker, renderDateRangeHtml } from "../ui/date-range-picker-bind.js";
import { bindListPageJumpInput } from "../utils/list-pagination.js";

export const MAJOR_PROBLEM_STATUSES = ["待处理", "处理中", "已解决", "已关闭"];

const MP_PROBLEM_TYPES = [
  "性能问题",
  "可用性问题",
  "安全问题",
  "存储问题",
  "网络问题",
  "兼容性问题",
  "备份问题",
  "监控问题",
];

const MP_ROOT_CAUSE_CATEGORIES = [
  "数据库优化",
  "配置错误",
  "代码缺陷",
  "存储管理",
  "网络配置",
  "版本管理",
  "权限管理",
  "监控配置",
  "资源配置",
  "其他",
];

const MP_FEATURE_CATEGORIES = [
  "查询性能",
  "高可用",
  "安全防护",
  "日志管理",
  "数据同步",
  "兼容性",
  "数据备份",
  "告警机制",
  "数据导入",
  "集群管理",
  "其他",
];

const MP_IMPACT_CATEGORIES = [
  "性能影响",
  "业务中断",
  "安全风险",
  "数据丢失风险",
  "同步延迟",
  "功能受限",
  "备份失败",
  "响应延迟",
  "资源占用",
  "服务中断",
  "其他",
];

export const MAJOR_PROBLEM_PERIODS = [
  { key: "all", label: "全部" },
  { key: "day", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "custom", label: "自定义" },
];

export const MP_SEARCH_DEBOUNCE_MS = 400;
let _mpFetchInProgress = false;

export async function fetchMajorProblemList() {
  // 防止并发调用
  if (_mpFetchInProgress) return;
  _mpFetchInProgress = true;
  
  const op = getCurrentOperator();
  state.majorProblemListLoading = true;
  if (!consumeSkipListLoadingRender()) requestRender();
  try {
    const period = state.majorProblemPeriod || "all";
    const q = state.majorProblemSearch.trim();
    let startParam = "";
    let endParam = "";
    if (period === "custom" && state.majorProblemStart && state.majorProblemEnd) {
      startParam = state.majorProblemStart;
      endParam = state.majorProblemEnd;
    }
    const r = await fetch(
      `${API_BASE_URL}/api/major-problems?operator_id=${encodeURIComponent(op.account)}&period=${encodeURIComponent(period)}&start_date=${encodeURIComponent(startParam)}&end_date=${encodeURIComponent(endParam)}&q=${encodeURIComponent(q)}&page=${state.majorProblemListPage}&page_size=${state.majorProblemListPageSize}`
    );
    if (!r.ok) {
      state.majorProblemList = [];
      state.majorProblemListTotal = 0;
      return;
    }
    const j = await r.json();
    state.majorProblemList = Array.isArray(j.items) ? j.items : [];
    state.majorProblemListTotal = j.total || 0;
  } catch (_) {
    state.majorProblemList = [];
    state.majorProblemListTotal = 0;
  } finally {
    state.majorProblemListLoading = false;
    state.majorProblemListLoaded = true;
    state.majorProblemNeedsRefresh = false;
    _mpFetchInProgress = false;
    requestRender();
  }
}

export async function fetchMajorProblemDetail(id) {
  const op = getCurrentOperator();
  state.majorProblemDetailLoading = true;
  state.majorProblemDetailId = id;
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-problems/${id}?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.majorProblemDetailBundle = null;
      return;
    }
    state.majorProblemDetailBundle = await r.json();
  } catch (_) {
    state.majorProblemDetailBundle = null;
  } finally {
    state.majorProblemDetailLoading = false;
    requestRender();
  }
}

export async function fetchMajorProblemConfig() {
  const op = getCurrentOperator();
  state.majorProblemConfigLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-problems/config/all?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) {
      state.majorProblemConfigList = [];
      return;
    }
    const j = await r.json();
    state.majorProblemConfigList = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.majorProblemConfigList = [];
  } finally {
    state.majorProblemConfigLoading = false;
    state.majorProblemConfigLoaded = true;
    requestRender();
  }
}

export function formatMpDate(d) {
  if (!d) return "";
  const s = String(d);
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

export function renderMajorProblemPage() {
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("major_problem_create", "readonly", whitelist);
  const canExport = whitelistAllows("major_problem_export", "readonly", whitelist);
  const canImport = whitelistAllows("major_problem_import", "readonly", whitelist);
  const canConfig = whitelistAllows("major_problem_config", "readonly", whitelist);

  const periodHtml = MAJOR_PROBLEM_PERIODS.map((p) => {
    const isActive = state.majorProblemPeriod === p.key;
    const isCustom = p.key === "custom";
    if (isCustom) {
      return `<span class="mp-period-custom-wrap">
        <button type="button" class="mp-period ${isActive ? "active" : ""}" data-mp-period="${p.key}">${p.label}</button>
        ${isActive ? renderDateRangeHtml({
          id: "major-problem-custom",
          startYmd: state.majorProblemStart,
          endYmd: state.majorProblemEnd,
          className: "date-range--inline",
        }) : ""}
      </span>`;
    }
    return `<button type="button" class="mp-period ${isActive ? "active" : ""}" data-mp-period="${p.key}">${p.label}</button>`;
  }).join("");

  const pageSize = Number(state.majorProblemListPageSize) > 0 ? Number(state.majorProblemListPageSize) : 10;
  const totalItems = Number(state.majorProblemListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.majorProblemListPage) || 1), totalPages);
  if (currentPage !== state.majorProblemListPage) state.majorProblemListPage = currentPage;

  const rows = (state.majorProblemList || [])
    .map((it, idx) => {
      const statusClass = getStatusClass(it.status);
      return `<tr class="mp-row" data-mp-id="${it.id}">
        <td>${(currentPage - 1) * pageSize + idx + 1}</td>
        <td class="mp-nowrap">${formatMpDate(it.report_date)}</td>
        <td>${escapeHtml(String(it.ops_order_no || ""))}</td>
        <td>${escapeHtml(String(it.problem_no || ""))}</td>
        <td>${escapeHtml(String(it.site_name || ""))}</td>
        <td>${escapeHtml(String(it.problem_type || ""))}</td>
        <td class="mp-desc-cell">${escapeHtml(String(it.description || ""))}</td>
        <td class="mp-desc-cell">${escapeHtml(String(it.root_cause || ""))}</td>
        <td class="mp-desc-cell">${escapeHtml(String(it.solution || ""))}</td>
        <td>${escapeHtml(String(it.root_cause_category || ""))}</td>
        <td>${escapeHtml(String(it.feature_category || ""))}</td>
        <td>${escapeHtml(String(it.impact_category || ""))}</td>
        <td>${escapeHtml(String(it.kernel_version || ""))}</td>
        <td>${escapeHtml(String(it.dts_bug_no || ""))}</td>
        <td><span class="mp-status ${statusClass}">${escapeHtml(String(it.status || ""))}</span></td>
      </tr>`;
    })
    .join("");

  const empty = `<tr><td colspan="15" class="mp-empty">${state.majorProblemListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  const sizeOptions = [10, 20, 50, 100]
    .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
    .join("");

  const paginationHtml = `
    <div id="mp-list-pagination" class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${totalItems} 条，第 ${currentPage}/${totalPages} 页</span>
        <label class="list-pagination-size">
          <span class="list-pagination-size-text">每页</span>
          <select id="mp-page-size" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
          <span class="list-pagination-size-suffix">条</span>
        </label>
        <div class="list-pagination-nav">
          <button class="action list-page-btn" type="button" id="mp-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="action list-page-btn" type="button" id="mp-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
        <label class="list-pagination-jump">
          <span class="list-pagination-jump-text">前往</span>
          <input type="number" id="mp-page-jump" class="list-page-jump" min="1" max="${totalPages}" step="1" value="${currentPage}" aria-label="前往第几页" />
          <span class="list-pagination-jump-suffix">页</span>
        </label>
      </div>
    </div>`;

  return `
    <section class="mp-wrap" id="mp-management-panel">
      <div class="mp-toolbar-top">
        <div class="mp-period-tabs">${periodHtml}</div>
        <div class="mp-search">
          <input type="search" id="mp-search-input" class="mp-search-input" placeholder="搜索运维单号、重大问题编号、局点名称、问题描述等" value="${escapeAttr(state.majorProblemSearch)}" />
        </div>
      </div>
      <div class="mp-toolbar">
        <div class="mp-toolbar-right">
          ${canImport ? '<button type="button" class="action" id="mp-import-btn">导入</button>' : ""}
          ${canExport ? '<button type="button" class="action" id="mp-export-btn">导出</button>' : ""}
          ${canCreate ? '<button type="button" class="action primary" id="mp-create-btn">新增</button>' : ""}
          ${canConfig ? '<button type="button" class="action" id="mp-config-btn">配置</button>' : ""}
        </div>
      </div>
      <div class="mp-table-card">
        <table class="mp-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>通报日期</th>
              <th>运维单号</th>
              <th>重大问题编号</th>
              <th>局点名称</th>
              <th>重大问题类型</th>
              <th>问题描述</th>
              <th>问题根因</th>
              <th>解决方案</th>
              <th>根因分类</th>
              <th>特性分类</th>
              <th>影响分类</th>
              <th>内核版本</th>
              <th>dts/bug单号</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>${state.majorProblemList.length ? rows : empty}</tbody>
        </table>
        ${paginationHtml}
      </div>
    </section>`;
}

function getStatusClass(status) {
  const s = String(status || "").trim();
  if (s === "待处理") return "mp-status--pending";
  if (s === "处理中") return "mp-status--processing";
  if (s === "已解决") return "mp-status--resolved";
  if (s === "已关闭") return "mp-status--closed";
  return "";
}

function mpFieldId(prefix, name) {
  return `mp-${prefix}-${name}`;
}

function renderSelectOptions(values, selected, emptyLabel) {
  const sel = String(selected || "").trim();
  const empty = emptyLabel
    ? `<option value="">${escapeHtml(emptyLabel)}</option>`
    : "";
  const opts = values
    .map((v) => `<option value="${escapeAttr(v)}" ${v === sel ? "selected" : ""}>${escapeHtml(v)}</option>`)
    .join("");
  return empty + opts;
}

function renderMajorProblemFormBody(prefix, data = {}) {
  const reportDate = formatMpDate(data.report_date) || formatYmdLocal(new Date());
  const status = String(data.status || "待处理").trim() || "待处理";
  return `
            <label class="mp-field">通报日期 *
              <input type="date" id="${mpFieldId(prefix, "report-date")}" class="mp-input" value="${escapeAttr(reportDate)}" />
            </label>
            <label class="mp-field">运维单号
              <input type="text" id="${mpFieldId(prefix, "ops-order-no")}" class="mp-input" value="${escapeAttr(String(data.ops_order_no || ""))}" placeholder="运维单号（选填）" />
            </label>
            <label class="mp-field">局点名称 *
              <input type="text" id="${mpFieldId(prefix, "site-name")}" class="mp-input" value="${escapeAttr(String(data.site_name || ""))}" placeholder="例如：北京数据中心" />
            </label>
            <label class="mp-field">重大问题类型 *
              <select id="${mpFieldId(prefix, "problem-type")}" class="mp-input">
                ${renderSelectOptions(MP_PROBLEM_TYPES, data.problem_type, "请选择")}
              </select>
            </label>
            <label class="mp-field">问题描述 *
              <textarea id="${mpFieldId(prefix, "description")}" class="mp-textarea" rows="3" placeholder="请输入问题描述">${escapeHtml(String(data.description || ""))}</textarea>
            </label>
            <label class="mp-field">问题根因
              <textarea id="${mpFieldId(prefix, "root-cause")}" class="mp-textarea" rows="2" placeholder="问题根因分析（选填）">${escapeHtml(String(data.root_cause || ""))}</textarea>
            </label>
            <label class="mp-field">解决方案
              <textarea id="${mpFieldId(prefix, "solution")}" class="mp-textarea" rows="2" placeholder="解决方案（选填）">${escapeHtml(String(data.solution || ""))}</textarea>
            </label>
            <label class="mp-field">根因分类
              <select id="${mpFieldId(prefix, "root-cause-category")}" class="mp-input">
                ${renderSelectOptions(MP_ROOT_CAUSE_CATEGORIES, data.root_cause_category, "请选择（选填）")}
              </select>
            </label>
            <label class="mp-field">特性分类
              <select id="${mpFieldId(prefix, "feature-category")}" class="mp-input">
                ${renderSelectOptions(MP_FEATURE_CATEGORIES, data.feature_category, "请选择（选填）")}
              </select>
            </label>
            <label class="mp-field">影响分类
              <select id="${mpFieldId(prefix, "impact-category")}" class="mp-input">
                ${renderSelectOptions(MP_IMPACT_CATEGORIES, data.impact_category, "请选择（选填）")}
              </select>
            </label>
            <label class="mp-field">内核版本
              <input type="text" id="${mpFieldId(prefix, "kernel-version")}" class="mp-input" value="${escapeAttr(String(data.kernel_version || ""))}" placeholder="例如：V5.2.1（选填）" />
            </label>
            <label class="mp-field">dts/bug单号
              <input type="text" id="${mpFieldId(prefix, "dts-bug-no")}" class="mp-input" value="${escapeAttr(String(data.dts_bug_no || ""))}" placeholder="例如：DTS20260501001（选填）" />
            </label>
            <label class="mp-field">状态
              <select id="${mpFieldId(prefix, "status")}" class="mp-input">
                ${renderSelectOptions(MAJOR_PROBLEM_STATUSES, status, "")}
              </select>
            </label>`;
}

function readMajorProblemFormValues(prefix) {
  return {
    reportDate: document.getElementById(mpFieldId(prefix, "report-date"))?.value?.trim() || "",
    opsOrderNo: document.getElementById(mpFieldId(prefix, "ops-order-no"))?.value?.trim() || "",
    siteName: document.getElementById(mpFieldId(prefix, "site-name"))?.value?.trim() || "",
    problemType: document.getElementById(mpFieldId(prefix, "problem-type"))?.value?.trim() || "",
    description: document.getElementById(mpFieldId(prefix, "description"))?.value?.trim() || "",
    rootCause: document.getElementById(mpFieldId(prefix, "root-cause"))?.value?.trim() || "",
    solution: document.getElementById(mpFieldId(prefix, "solution"))?.value?.trim() || "",
    rootCauseCategory: document.getElementById(mpFieldId(prefix, "root-cause-category"))?.value?.trim() || "",
    featureCategory: document.getElementById(mpFieldId(prefix, "feature-category"))?.value?.trim() || "",
    impactCategory: document.getElementById(mpFieldId(prefix, "impact-category"))?.value?.trim() || "",
    kernelVersion: document.getElementById(mpFieldId(prefix, "kernel-version"))?.value?.trim() || "",
    dtsBugNo: document.getElementById(mpFieldId(prefix, "dts-bug-no"))?.value?.trim() || "",
    status: document.getElementById(mpFieldId(prefix, "status"))?.value?.trim() || "待处理",
  };
}

function validateMajorProblemFormValues(values) {
  if (!values.reportDate) {
    alert("通报日期不能为空");
    return false;
  }
  if (!values.siteName) {
    alert("局点名称不能为空");
    return false;
  }
  if (!values.problemType) {
    alert("重大问题类型不能为空");
    return false;
  }
  if (!values.description) {
    alert("问题描述不能为空");
    return false;
  }
  return true;
}

function closeMajorProblemDetail() {
  state.majorProblemDetailId = null;
  state.majorProblemDetailBundle = null;
  state.majorProblemEditOpen = false;
}

export function renderMajorProblemModalsHtml() {
  const whitelist = getCurrentWhitelistSettings();
  const canEdit = whitelistAllows("major_problem_create", "readonly", whitelist);
  const canDelete = whitelistAllows("major_problem_create", "readonly", whitelist);

  const createOpen = state.majorProblemCreateOpen
    ? `<div class="perm-modal-mask mp-modal-mask" id="mp-create-mask">
        <div class="perm-modal mp-modal" role="dialog">
          <div class="perm-modal-head"><h3>新增重大问题</h3></div>
          <div class="perm-modal-body mp-create-body">
            <label class="mp-field">通报日期 *
              <input type="date" id="mp-create-report-date" class="mp-input" value="${escapeAttr(formatYmdLocal(new Date()))}" />
            </label>
            <label class="mp-field">运维单号
              <input type="text" id="mp-create-ops-order-no" class="mp-input" placeholder="运维单号（选填）" />
            </label>
            <label class="mp-field">局点名称 *
              <input type="text" id="mp-create-site-name" class="mp-input" placeholder="例如：北京数据中心" />
            </label>
            <label class="mp-field">重大问题类型 *
              <select id="mp-create-problem-type" class="mp-input">
                <option value="">请选择</option>
                <option value="性能问题">性能问题</option>
                <option value="可用性问题">可用性问题</option>
                <option value="安全问题">安全问题</option>
                <option value="存储问题">存储问题</option>
                <option value="网络问题">网络问题</option>
                <option value="兼容性问题">兼容性问题</option>
                <option value="备份问题">备份问题</option>
                <option value="监控问题">监控问题</option>
              </select>
            </label>
            <label class="mp-field">问题描述 *
              <textarea id="mp-create-description" class="mp-textarea" rows="3" placeholder="请输入问题描述"></textarea>
            </label>
            <label class="mp-field">问题根因
              <textarea id="mp-create-root-cause" class="mp-textarea" rows="2" placeholder="问题根因分析（选填）"></textarea>
            </label>
            <label class="mp-field">解决方案
              <textarea id="mp-create-solution" class="mp-textarea" rows="2" placeholder="解决方案（选填）"></textarea>
            </label>
            <label class="mp-field">根因分类
              <select id="mp-create-root-cause-category" class="mp-input">
                <option value="">请选择（选填）</option>
                <option value="数据库优化">数据库优化</option>
                <option value="配置错误">配置错误</option>
                <option value="代码缺陷">代码缺陷</option>
                <option value="存储管理">存储管理</option>
                <option value="网络配置">网络配置</option>
                <option value="版本管理">版本管理</option>
                <option value="权限管理">权限管理</option>
                <option value="监控配置">监控配置</option>
                <option value="资源配置">资源配置</option>
                <option value="其他">其他</option>
              </select>
            </label>
            <label class="mp-field">特性分类
              <select id="mp-create-feature-category" class="mp-input">
                <option value="">请选择（选填）</option>
                <option value="查询性能">查询性能</option>
                <option value="高可用">高可用</option>
                <option value="安全防护">安全防护</option>
                <option value="日志管理">日志管理</option>
                <option value="数据同步">数据同步</option>
                <option value="兼容性">兼容性</option>
                <option value="数据备份">数据备份</option>
                <option value="告警机制">告警机制</option>
                <option value="数据导入">数据导入</option>
                <option value="集群管理">集群管理</option>
                <option value="其他">其他</option>
              </select>
            </label>
            <label class="mp-field">影响分类
              <select id="mp-create-impact-category" class="mp-input">
                <option value="">请选择（选填）</option>
                <option value="性能影响">性能影响</option>
                <option value="业务中断">业务中断</option>
                <option value="安全风险">安全风险</option>
                <option value="数据丢失风险">数据丢失风险</option>
                <option value="同步延迟">同步延迟</option>
                <option value="功能受限">功能受限</option>
                <option value="备份失败">备份失败</option>
                <option value="响应延迟">响应延迟</option>
                <option value="资源占用">资源占用</option>
                <option value="服务中断">服务中断</option>
                <option value="其他">其他</option>
              </select>
            </label>
            <label class="mp-field">内核版本
              <input type="text" id="mp-create-kernel-version" class="mp-input" placeholder="例如：V5.2.1（选填）" />
            </label>
            <label class="mp-field">dts/bug单号
              <input type="text" id="mp-create-dts-bug-no" class="mp-input" placeholder="例如：DTS20260501001（选填）" />
            </label>
            <label class="mp-field">状态
              <select id="mp-create-status" class="mp-input">
                <option value="待处理">待处理</option>
                <option value="处理中">处理中</option>
                <option value="已解决">已解决</option>
                <option value="已关闭">已关闭</option>
              </select>
            </label>
          </div>
          <div class="perm-modal-foot">
            <button type="button" class="action" id="mp-create-cancel-btn">取消</button>
            <button type="button" class="action primary" id="mp-create-submit-btn">提交</button>
          </div>
        </div>
      </div>`
    : "";

  const detailOpen = state.majorProblemDetailId && state.majorProblemDetailBundle
    ? `<div class="perm-modal-mask mp-modal-mask" id="mp-detail-mask">
        <div class="perm-modal mp-modal mp-detail-modal" role="dialog">
          <div class="perm-modal-head"><h3>重大问题详情 - ${escapeHtml(state.majorProblemDetailBundle.problem_no || "")}</h3></div>
          <div class="perm-modal-body mp-detail-body">
            <div class="mp-detail-meta">
              <p><strong>通报日期：</strong>${formatMpDate(state.majorProblemDetailBundle.report_date)}</p>
              <p><strong>运维单号：</strong>${escapeHtml(state.majorProblemDetailBundle.ops_order_no || "")}</p>
              <p><strong>局点名称：</strong>${escapeHtml(state.majorProblemDetailBundle.site_name || "")}</p>
              <p><strong>重大问题类型：</strong>${escapeHtml(state.majorProblemDetailBundle.problem_type || "")}</p>
              <p><strong>状态：</strong><span class="mp-status ${getStatusClass(state.majorProblemDetailBundle.status)}">${escapeHtml(state.majorProblemDetailBundle.status || "")}</span></p>
              <p><strong>内核版本：</strong>${escapeHtml(state.majorProblemDetailBundle.kernel_version || "")}</p>
              <p><strong>dts/bug单号：</strong>${escapeHtml(state.majorProblemDetailBundle.dts_bug_no || "")}</p>
              <p><strong>创建人：</strong>${escapeHtml(state.majorProblemDetailBundle.creator_name || "")}</p>
              <p><strong>创建时间：</strong>${escapeHtml(String(state.majorProblemDetailBundle.created_at || "").replace("T", " ").slice(0, 19))}</p>
            </div>
            <div class="mp-detail-desc">
              <h4>问题描述</h4>
              <div class="mp-detail-desc-content">${escapeHtml(state.majorProblemDetailBundle.description || "")}</div>
            </div>
            <div class="mp-detail-desc">
              <h4>问题根因</h4>
              <div class="mp-detail-desc-content">${escapeHtml(state.majorProblemDetailBundle.root_cause || "暂无")}</div>
            </div>
            <div class="mp-detail-desc">
              <h4>解决方案</h4>
              <div class="mp-detail-desc-content">${escapeHtml(state.majorProblemDetailBundle.solution || "暂无")}</div>
            </div>
            <div class="mp-detail-meta">
              <p><strong>根因分类：</strong>${escapeHtml(state.majorProblemDetailBundle.root_cause_category || "")}</p>
              <p><strong>特性分类：</strong>${escapeHtml(state.majorProblemDetailBundle.feature_category || "")}</p>
              <p><strong>影响分类：</strong>${escapeHtml(state.majorProblemDetailBundle.impact_category || "")}</p>
            </div>
          </div>
          <div class="perm-modal-foot mp-detail-foot">
            <div class="mp-detail-foot-actions">
              ${canEdit ? '<button type="button" class="action" id="mp-detail-edit-btn">编辑</button>' : ""}
              ${canDelete ? '<button type="button" class="action danger" id="mp-detail-delete-btn">删除</button>' : ""}
            </div>
            <button type="button" class="action" id="mp-detail-close-btn">关闭</button>
          </div>
        </div>
      </div>`
    : "";

  const editOpen =
    state.majorProblemEditOpen && state.majorProblemDetailBundle
      ? `<div class="perm-modal-mask mp-modal-mask" id="mp-edit-mask">
        <div class="perm-modal mp-modal" role="dialog">
          <div class="perm-modal-head"><h3>编辑重大问题 - ${escapeHtml(state.majorProblemDetailBundle.problem_no || "")}</h3></div>
          <div class="perm-modal-body mp-create-body">
            ${renderMajorProblemFormBody("edit", state.majorProblemDetailBundle)}
          </div>
          <div class="perm-modal-foot">
            <button type="button" class="action" id="mp-edit-cancel-btn">取消</button>
            <button type="button" class="action primary" id="mp-edit-submit-btn">保存</button>
          </div>
        </div>
      </div>`
      : "";

  const exportOpen = state.majorProblemExportModalOpen
    ? `<div class="perm-modal-mask mp-modal-mask" id="mp-export-mask">
        <div class="perm-modal mp-modal" role="dialog">
          <div class="perm-modal-head"><h3>导出重大问题</h3></div>
          <div class="perm-modal-body mp-export-body">
            <p class="mp-export-tip">将导出当前筛选条件下的所有数据。</p>
            <p class="mp-export-count">共计 ${state.majorProblemListTotal} 条记录</p>
          </div>
          <div class="perm-modal-foot">
            <button type="button" class="action" id="mp-export-cancel-btn">取消</button>
            <button type="button" class="action primary" id="mp-export-submit-btn">确认导出</button>
          </div>
        </div>
      </div>`
    : "";

  const configOpen = state.majorProblemConfigModalOpen
    ? (() => {
        const configRows = (state.majorProblemConfigList || [])
          .map((cfg, idx) => {
            const isActive = cfg.is_active ? "是" : "否";
            const isRequired = cfg.is_required ? "是" : "否";
            const fieldTypeLabel = getFieldTypeLabel(cfg.field_type);
            return `<tr class="mp-config-row" data-config-id="${cfg.id}">
              <td>${idx + 1}</td>
              <td>${escapeHtml(String(cfg.field_key || ""))}</td>
              <td>${escapeHtml(String(cfg.field_label || ""))}</td>
              <td>${fieldTypeLabel}</td>
              <td>${isRequired}</td>
              <td>${isActive}</td>
              <td>${cfg.sort_order || 0}</td>
              <td>
                <button type="button" class="action mp-config-edit-btn" data-config-id="${cfg.id}">编辑</button>
                <button type="button" class="action danger mp-config-del-btn" data-config-id="${cfg.id}">删除</button>
              </td>
            </tr>`;
          })
          .join("");
        const configEmpty = '<tr><td colspan="8" class="mp-empty">暂无配置</td></tr>';
        return `<div class="perm-modal-mask mp-modal-mask" id="mp-config-mask">
          <div class="perm-modal mp-modal mp-config-modal" role="dialog">
            <div class="perm-modal-head"><h3>自定义字段配置</h3></div>
            <div class="perm-modal-body mp-config-body">
              <div class="mp-config-toolbar">
                <button type="button" class="action primary" id="mp-config-add-btn">新增字段</button>
              </div>
              <div class="mp-config-table-card">
                <table class="mp-config-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>字段Key</th>
                      <th>字段标签</th>
                      <th>字段类型</th>
                      <th>必填</th>
                      <th>启用</th>
                      <th>排序</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>${state.majorProblemConfigList.length ? configRows : configEmpty}</tbody>
                </table>
              </div>
            </div>
            <div class="perm-modal-foot">
              <button type="button" class="action" id="mp-config-close-btn">关闭</button>
            </div>
          </div>
        </div>`;
      })()
    : "";

  const configEditOpen = state.majorProblemConfigEditOpen
    ? (() => {
        const cfg = state.majorProblemConfigDraft || {};
        const typeOptions = [
          { value: "text", label: "文本" },
          { value: "select", label: "下拉选择" },
          { value: "multiselect", label: "多选" },
          { value: "checkbox", label: "复选框" },
          { value: "date", label: "日期" },
          { value: "number", label: "数字" },
        ]
          .map((t) => `<option value="${t.value}" ${cfg.field_type === t.value ? "selected" : ""}>${t.label}</option>`)
          .join("");
        return `<div class="perm-modal-mask mp-modal-mask" id="mp-config-edit-mask">
          <div class="perm-modal mp-modal" role="dialog">
            <div class="perm-modal-head"><h3>${cfg.id ? "编辑字段" : "新增字段"}</h3></div>
            <div class="perm-modal-body mp-config-edit-body">
              <label class="mp-field">字段Key *
                <input type="text" id="mp-config-field-key" class="mp-input" value="${escapeAttr(String(cfg.field_key || ""))}" placeholder="例如：is_risk_issue" ${cfg.id ? "disabled" : ""} />
              </label>
              <label class="mp-field">字段标签 *
                <input type="text" id="mp-config-field-label" class="mp-input" value="${escapeAttr(String(cfg.field_label || ""))}" placeholder="例如：是否风险问题" />
              </label>
              <label class="mp-field">字段类型 *
                <select id="mp-config-field-type" class="mp-input">${typeOptions}</select>
              </label>
              <label class="mp-field">选项值（下拉/多选时使用）
                <textarea id="mp-config-field-options" class="mp-textarea" rows="3" placeholder="JSON格式，例如：[{\"value\":\"P0\",\"label\":\"紧急\"}]">${escapeAttr(String(cfg.field_options_raw || ""))}</textarea>
              </label>
              <label class="mp-field">是否必填
                <input type="checkbox" id="mp-config-is-required" ${cfg.is_required ? "checked" : ""} />
              </label>
              <label class="mp-field">是否启用
                <input type="checkbox" id="mp-config-is-active" ${cfg.is_active ? "checked" : ""} />
              </label>
              <label class="mp-field">排序
                <input type="number" id="mp-config-sort-order" class="mp-input" value="${cfg.sort_order || 0}" min="0" />
              </label>
            </div>
            <div class="perm-modal-foot">
              <button type="button" class="action" id="mp-config-edit-cancel-btn">取消</button>
              <button type="button" class="action primary" id="mp-config-edit-save-btn">保存</button>
            </div>
          </div>
        </div>`;
      })()
    : "";

  return createOpen + detailOpen + editOpen + exportOpen + configOpen + configEditOpen;
}

function getFieldTypeLabel(type) {
  const map = {
    text: "文本",
    select: "下拉选择",
    multiselect: "多选",
    checkbox: "复选框",
    date: "日期",
    number: "数字",
  };
  return map[type] || type;
}

export function formatYmdLocal(d) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function bindMajorProblemPage() {
  const panel = document.getElementById("mp-management-panel");
  if (!panel) return;

  document.querySelectorAll("[data-mp-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-mp-period");
      if (!k) return;
      state.majorProblemPeriod = k;
      state.majorProblemListPage = 1;
      fetchMajorProblemList();
    });
  });

  if (state.majorProblemPeriod === "custom") {
    bindDateRangePicker({
      id: "major-problem-custom",
      getRange: () => ({
        start: state.majorProblemStart,
        end: state.majorProblemEnd,
      }),
      setRange: (start, end) => {
        state.majorProblemStart = start;
        state.majorProblemEnd = end;
        state.majorProblemPeriod = "custom";
      },
      onApplied: () => {
        state.majorProblemListPage = 1;
        fetchMajorProblemList();
      },
      requestRender,
    });
  }

  const searchInput = document.getElementById("mp-search-input");
  bindListSearchInput(searchInput, {
    debounceMs: MP_SEARCH_DEBOUNCE_MS,
    onValue: (v) => {
      state.majorProblemSearch = v;
    },
    onSearch: () => {
      state.majorProblemListPage = 1;
      fetchMajorProblemList();
    },
  });

  const pageSizeSelect = document.getElementById("mp-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      state.majorProblemListPageSize = Number(pageSizeSelect.value) || 10;
      state.majorProblemListPage = 1;
      fetchMajorProblemList();
    });
  }

  const prevBtn = document.getElementById("mp-page-prev");
  const nextBtn = document.getElementById("mp-page-next");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (state.majorProblemListPage > 1) {
        state.majorProblemListPage--;
        fetchMajorProblemList();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const pageSize = Number(state.majorProblemListPageSize) || 10;
      const totalPages = Math.max(1, Math.ceil((state.majorProblemListTotal || 0) / pageSize));
      if (state.majorProblemListPage < totalPages) {
        state.majorProblemListPage++;
        fetchMajorProblemList();
      }
    });
  }
  const pageSize = Number(state.majorProblemListPageSize) || 10;
  const totalPages = Math.max(1, Math.ceil((state.majorProblemListTotal || 0) / pageSize));
  bindListPageJumpInput(document.getElementById("mp-page-jump"), {
    totalPages,
    currentPage: state.majorProblemListPage,
    onPageChange: (page) => {
      state.majorProblemListPage = page;
      fetchMajorProblemList();
    },
  });

  document.querySelectorAll(".mp-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = Number(row.getAttribute("data-mp-id"));
      if (id) {
        fetchMajorProblemDetail(id);
      }
    });
  });

  const createBtn = document.getElementById("mp-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      state.majorProblemCreateOpen = true;
      requestRender();
    });
  }

  const createCancelBtn = document.getElementById("mp-create-cancel-btn");
  const createSubmitBtn = document.getElementById("mp-create-submit-btn");
  if (createCancelBtn) {
    createCancelBtn.addEventListener("click", () => {
      state.majorProblemCreateOpen = false;
      requestRender();
    });
  }
  if (createSubmitBtn) {
    createSubmitBtn.addEventListener("click", () => {
      handleMajorProblemCreateSubmit();
    });
  }

  const exportBtn = document.getElementById("mp-export-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      state.majorProblemExportModalOpen = true;
      requestRender();
    });
  }

  const exportCancelBtn = document.getElementById("mp-export-cancel-btn");
  const exportSubmitBtn = document.getElementById("mp-export-submit-btn");
  if (exportCancelBtn) {
    exportCancelBtn.addEventListener("click", () => {
      state.majorProblemExportModalOpen = false;
      requestRender();
    });
  }
  if (exportSubmitBtn) {
    exportSubmitBtn.addEventListener("click", () => {
      handleMajorProblemExport();
    });
  }

  const importBtn = document.getElementById("mp-import-btn");
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      alert("导入功能开发中，敬请期待！");
    });
  }

  const configBtn = document.getElementById("mp-config-btn");
  if (configBtn) {
    configBtn.addEventListener("click", async () => {
      state.majorProblemConfigModalOpen = true;
      if (!state.majorProblemConfigLoaded) {
        await fetchMajorProblemConfig();
      }
      requestRender();
    });
  }

  const configCloseBtn = document.getElementById("mp-config-close-btn");
  if (configCloseBtn) {
    configCloseBtn.addEventListener("click", () => {
      state.majorProblemConfigModalOpen = false;
      state.majorProblemConfigEditOpen = false;
      requestRender();
    });
  }

  const configAddBtn = document.getElementById("mp-config-add-btn");
  if (configAddBtn) {
    configAddBtn.addEventListener("click", () => {
      state.majorProblemConfigDraft = {
        field_key: "",
        field_label: "",
        field_type: "checkbox",
        field_options: [],
        field_options_raw: "",
        is_required: false,
        is_active: true,
        sort_order: 0,
      };
      state.majorProblemConfigEditOpen = true;
      requestRender();
    });
  }

  document.querySelectorAll(".mp-config-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const configId = Number(btn.getAttribute("data-config-id"));
      const cfg = state.majorProblemConfigList.find((c) => c.id === configId);
      if (cfg) {
        state.majorProblemConfigDraft = {
          ...cfg,
          field_options_raw: JSON.stringify(cfg.field_options || [], null, 2),
        };
        state.majorProblemConfigEditOpen = true;
        requestRender();
      }
    });
  });

  document.querySelectorAll(".mp-config-del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const configId = Number(btn.getAttribute("data-config-id"));
      if (confirm("确定删除该配置字段吗？")) {
        await handleDeleteConfig(configId);
      }
    });
  });

  const configEditCancelBtn = document.getElementById("mp-config-edit-cancel-btn");
  const configEditSaveBtn = document.getElementById("mp-config-edit-save-btn");
  if (configEditCancelBtn) {
    configEditCancelBtn.addEventListener("click", () => {
      state.majorProblemConfigEditOpen = false;
      state.majorProblemConfigDraft = null;
      requestRender();
    });
  }
  if (configEditSaveBtn) {
    configEditSaveBtn.addEventListener("click", async () => {
      await handleConfigEditSave();
    });
  }

  const detailCloseBtn = document.getElementById("mp-detail-close-btn");
  if (detailCloseBtn) {
    detailCloseBtn.addEventListener("click", () => {
      closeMajorProblemDetail();
      requestRender();
    });
  }

  const detailEditBtn = document.getElementById("mp-detail-edit-btn");
  if (detailEditBtn) {
    detailEditBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.majorProblemEditOpen = true;
      requestRender();
    });
  }

  const detailDeleteBtn = document.getElementById("mp-detail-delete-btn");
  if (detailDeleteBtn) {
    detailDeleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleMajorProblemDelete();
    });
  }

  const editCancelBtn = document.getElementById("mp-edit-cancel-btn");
  const editSubmitBtn = document.getElementById("mp-edit-submit-btn");
  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", () => {
      state.majorProblemEditOpen = false;
      requestRender();
    });
  }
  if (editSubmitBtn) {
    editSubmitBtn.addEventListener("click", () => {
      handleMajorProblemEditSubmit();
    });
  }

  const createMask = document.getElementById("mp-create-mask");
  const detailMask = document.getElementById("mp-detail-mask");
  const editMask = document.getElementById("mp-edit-mask");
  const exportMask = document.getElementById("mp-export-mask");
  const configMask = document.getElementById("mp-config-mask");
  const configEditMask = document.getElementById("mp-config-edit-mask");
  if (createMask) {
    createMask.addEventListener("click", (e) => {
      if (e.target === createMask) {
        state.majorProblemCreateOpen = false;
        requestRender();
      }
    });
  }
  if (detailMask) {
    detailMask.addEventListener("click", (e) => {
      if (e.target === detailMask) {
        closeMajorProblemDetail();
        requestRender();
      }
    });
  }
  if (editMask) {
    editMask.addEventListener("click", (e) => {
      if (e.target === editMask) {
        state.majorProblemEditOpen = false;
        requestRender();
      }
    });
  }
  [exportMask, configMask, configEditMask].forEach((mask) => {
    if (mask) {
      mask.addEventListener("click", (e) => {
        if (e.target === mask) {
          state.majorProblemExportModalOpen = false;
          state.majorProblemConfigModalOpen = false;
          state.majorProblemConfigEditOpen = false;
          state.majorProblemConfigDraft = null;
          requestRender();
        }
      });
    }
  });
}

async function handleMajorProblemCreateSubmit() {
  const op = getCurrentOperator();
  const values = readMajorProblemFormValues("create");
  if (!validateMajorProblemFormValues(values)) return;

  try {
    const r = await fetch(`${API_BASE_URL}/api/major-problems`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        report_date: values.reportDate,
        ops_order_no: values.opsOrderNo,
        site_name: values.siteName,
        problem_type: values.problemType,
        description: values.description,
        root_cause: values.rootCause,
        solution: values.solution,
        root_cause_category: values.rootCauseCategory,
        feature_category: values.featureCategory,
        impact_category: values.impactCategory,
        kernel_version: values.kernelVersion,
        dts_bug_no: values.dtsBugNo,
        status: values.status,
      }),
    });
    if (!r.ok) {
      const err = await r.json();
      alert(err.detail || "创建失败");
      return;
    }
    state.majorProblemCreateOpen = false;
    state.majorProblemNeedsRefresh = true;
    fetchMajorProblemList();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleMajorProblemExport() {
  const op = getCurrentOperator();
  const period = state.majorProblemPeriod || "all";
  let startParam = "";
  let endParam = "";
  if (period === "custom" && state.majorProblemStart && state.majorProblemEnd) {
    startParam = state.majorProblemStart;
    endParam = state.majorProblemEnd;
  }
  const q = state.majorProblemSearch.trim();

  try {
    const r = await fetch(
      `${API_BASE_URL}/api/major-problems/export?operator_id=${encodeURIComponent(op.account)}&period=${encodeURIComponent(period)}&start_date=${encodeURIComponent(startParam)}&end_date=${encodeURIComponent(endParam)}&q=${encodeURIComponent(q)}`
    );
    if (!r.ok) {
      const err = await r.json();
      alert(err.detail || "导出失败");
      return;
    }
    const j = await r.json();
    const items = j.items || [];
    if (items.length === 0) {
      alert("没有可导出的数据");
      return;
    }

    const headers = [
      "序号", "通报日期", "运维单号", "重大问题编号", "局点名称", "重大问题类型",
      "问题描述", "问题根因", "解决方案", "根因分类", "特性分类", "影响分类",
      "内核版本", "dts/bug单号", "状态", "创建人", "创建时间"
    ];
    const csvRows = [headers.join(",")];
    items.forEach((it, idx) => {
      const row = [
        idx + 1,
        formatMpDate(it.report_date),
        it.ops_order_no || "",
        it.problem_no || "",
        it.site_name || "",
        it.problem_type || "",
        (it.description || "").replace(/[\n\r,]/g, " "),
        (it.root_cause || "").replace(/[\n\r,]/g, " "),
        (it.solution || "").replace(/[\n\r,]/g, " "),
        it.root_cause_category || "",
        it.feature_category || "",
        it.impact_category || "",
        it.kernel_version || "",
        it.dts_bug_no || "",
        it.status || "",
        it.creator_name || "",
        String(it.created_at || "").replace("T", " ").slice(0, 19),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `重大问题_${formatYmdLocal(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    state.majorProblemExportModalOpen = false;
    requestRender();
  } catch (e) {
    alert("导出失败：" + e.message);
  }
}

async function handleConfigEditSave() {
  const op = getCurrentOperator();
  const draft = state.majorProblemConfigDraft || {};
  const fieldKey = document.getElementById("mp-config-field-key")?.value?.trim();
  const fieldLabel = document.getElementById("mp-config-field-label")?.value?.trim();
  const fieldType = document.getElementById("mp-config-field-type")?.value?.trim();
  const fieldOptionsRaw = document.getElementById("mp-config-field-options")?.value?.trim() || "";
  const isRequired = document.getElementById("mp-config-is-required")?.checked;
  const isActive = document.getElementById("mp-config-is-active")?.checked;
  const sortOrder = Number(document.getElementById("mp-config-sort-order")?.value) || 0;

  if (!fieldKey) {
    alert("字段Key不能为空");
    return;
  }
  if (!fieldLabel) {
    alert("字段标签不能为空");
    return;
  }

  let fieldOptions = [];
  if (fieldOptionsRaw && (fieldType === "select" || fieldType === "multiselect")) {
    try {
      fieldOptions = JSON.parse(fieldOptionsRaw);
    } catch (e) {
      alert("选项值JSON格式错误");
      return;
    }
  }

  const payload = {
    operator_id: op.account,
    field_key: fieldKey,
    field_label: fieldLabel,
    field_type: fieldType,
    field_options: fieldOptions,
    is_required: isRequired,
    is_active: isActive,
    sort_order: sortOrder,
  };

  try {
    let r;
    if (draft.id) {
      r = await fetch(`${API_BASE_URL}/api/major-problems/config/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      r = await fetch(`${API_BASE_URL}/api/major-problems/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    if (!r.ok) {
      const err = await r.json();
      alert(err.detail || "保存失败");
      return;
    }
    state.majorProblemConfigEditOpen = false;
    state.majorProblemConfigDraft = null;
    await fetchMajorProblemConfig();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleDeleteConfig(configId) {
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-problems/config/${configId}?operator_id=${encodeURIComponent(op.account)}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const err = await r.json();
      alert(err.detail || "删除失败");
      return;
    }
    await fetchMajorProblemConfig();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleMajorProblemEditSubmit() {
  const bundle = state.majorProblemDetailBundle;
  const problemId = bundle?.id || state.majorProblemDetailId;
  if (!problemId) return;

  const values = readMajorProblemFormValues("edit");
  if (!validateMajorProblemFormValues(values)) return;

  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-problems/${problemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        report_date: values.reportDate,
        ops_order_no: values.opsOrderNo,
        site_name: values.siteName,
        problem_type: values.problemType,
        description: values.description,
        root_cause: values.rootCause,
        solution: values.solution,
        root_cause_category: values.rootCauseCategory,
        feature_category: values.featureCategory,
        impact_category: values.impactCategory,
        kernel_version: values.kernelVersion,
        dts_bug_no: values.dtsBugNo,
        status: values.status,
      }),
    });
    if (!r.ok) {
      const err = await r.json();
      alert(err.detail || "保存失败");
      return;
    }
    const updated = await r.json();
    state.majorProblemDetailBundle = updated;
    state.majorProblemEditOpen = false;
    state.majorProblemNeedsRefresh = true;
    await fetchMajorProblemList();
    requestRender();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleMajorProblemDelete() {
  const bundle = state.majorProblemDetailBundle;
  const problemId = bundle?.id || state.majorProblemDetailId;
  if (!problemId || !bundle) return;

  const problemNo = String(bundle.problem_no || "").trim() || String(problemId);
  const siteName = String(bundle.site_name || "").trim();
  const confirmMsg = siteName
    ? `确定删除重大问题「${problemNo}」（${siteName}）吗？此操作不可恢复。`
    : `确定删除重大问题「${problemNo}」吗？此操作不可恢复。`;
  if (!window.confirm(confirmMsg)) return;

  const op = getCurrentOperator();
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/major-problems/${problemId}?operator_id=${encodeURIComponent(op.account)}`,
      { method: "DELETE" }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "删除失败");
      return;
    }
    closeMajorProblemDetail();
    state.majorProblemNeedsRefresh = true;
    await fetchMajorProblemList();
    requestRender();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}