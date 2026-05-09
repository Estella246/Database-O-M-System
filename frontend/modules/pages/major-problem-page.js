import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";

export const MAJOR_PROBLEM_STATUSES = ["待处理", "处理中", "已解决", "已关闭"];

export const MAJOR_PROBLEM_PERIODS = [
  { key: "all", label: "全部" },
  { key: "day", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "custom", label: "自定义" },
];

export let _mpSearchDebounceTimer = null;
export const MP_SEARCH_DEBOUNCE_MS = 400;

export async function fetchMajorProblemList() {
  const op = getCurrentOperator();
  state.majorProblemListLoading = true;
  requestRender();
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
        ${isActive ? `<input type="date" class="mp-date-input" id="mp-start-date" value="${escapeAttr(state.majorProblemStart)}" /> ~ <input type="date" class="mp-date-input" id="mp-end-date" value="${escapeAttr(state.majorProblemEnd)}" />` : ""}
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

export function renderMajorProblemModalsHtml() {
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
          <div class="perm-modal-foot">
            <button type="button" class="action" id="mp-detail-close-btn">关闭</button>
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
    ? `<div class="perm-modal-mask mp-modal-mask" id="mp-config-mask">
        <div class="perm-modal mp-modal" role="dialog">
          <div class="perm-modal-head"><h3>重大问题配置</h3></div>
          <div class="perm-modal-body mp-config-body">
            <p class="mp-config-tip">配置功能开发中...</p>
          </div>
          <div class="perm-modal-foot">
            <button type="button" class="action" id="mp-config-close-btn">关闭</button>
          </div>
        </div>
      </div>`
    : "";

  return createOpen + detailOpen + exportOpen + configOpen;
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

  const startDateInput = document.getElementById("mp-start-date");
  const endDateInput = document.getElementById("mp-end-date");
  if (startDateInput) {
    startDateInput.addEventListener("change", () => {
      state.majorProblemStart = startDateInput.value;
      state.majorProblemPeriod = "custom";
      state.majorProblemListPage = 1;
      fetchMajorProblemList();
    });
  }
  if (endDateInput) {
    endDateInput.addEventListener("change", () => {
      state.majorProblemEnd = endDateInput.value;
      state.majorProblemPeriod = "custom";
      state.majorProblemListPage = 1;
      fetchMajorProblemList();
    });
  }

  const searchInput = document.getElementById("mp-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const v = searchInput.value;
      clearTimeout(_mpSearchDebounceTimer);
      _mpSearchDebounceTimer = setTimeout(() => {
        state.majorProblemSearch = v;
        state.majorProblemListPage = 1;
        fetchMajorProblemList();
      }, MP_SEARCH_DEBOUNCE_MS);
    });
  }

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
    configBtn.addEventListener("click", () => {
      state.majorProblemConfigModalOpen = true;
      requestRender();
    });
  }

  const configCloseBtn = document.getElementById("mp-config-close-btn");
  if (configCloseBtn) {
    configCloseBtn.addEventListener("click", () => {
      state.majorProblemConfigModalOpen = false;
      requestRender();
    });
  }

  const detailCloseBtn = document.getElementById("mp-detail-close-btn");
  if (detailCloseBtn) {
    detailCloseBtn.addEventListener("click", () => {
      state.majorProblemDetailId = null;
      state.majorProblemDetailBundle = null;
      requestRender();
    });
  }

  const createMask = document.getElementById("mp-create-mask");
  const detailMask = document.getElementById("mp-detail-mask");
  const exportMask = document.getElementById("mp-export-mask");
  const configMask = document.getElementById("mp-config-mask");
  [createMask, detailMask, exportMask, configMask].forEach((mask) => {
    if (mask) {
      mask.addEventListener("click", (e) => {
        if (e.target === mask) {
          state.majorProblemCreateOpen = false;
          state.majorProblemDetailId = null;
          state.majorProblemDetailBundle = null;
          state.majorProblemExportModalOpen = false;
          state.majorProblemConfigModalOpen = false;
          requestRender();
        }
      });
    }
  });
}

async function handleMajorProblemCreateSubmit() {
  const op = getCurrentOperator();
  const reportDate = document.getElementById("mp-create-report-date")?.value?.trim();
  const opsOrderNo = document.getElementById("mp-create-ops-order-no")?.value?.trim() || "";
  const siteName = document.getElementById("mp-create-site-name")?.value?.trim();
  const problemType = document.getElementById("mp-create-problem-type")?.value?.trim();
  const description = document.getElementById("mp-create-description")?.value?.trim();
  const rootCause = document.getElementById("mp-create-root-cause")?.value?.trim() || "";
  const solution = document.getElementById("mp-create-solution")?.value?.trim() || "";
  const rootCauseCategory = document.getElementById("mp-create-root-cause-category")?.value?.trim() || "";
  const featureCategory = document.getElementById("mp-create-feature-category")?.value?.trim() || "";
  const impactCategory = document.getElementById("mp-create-impact-category")?.value?.trim() || "";
  const kernelVersion = document.getElementById("mp-create-kernel-version")?.value?.trim() || "";
  const dtsBugNo = document.getElementById("mp-create-dts-bug-no")?.value?.trim() || "";
  const status = document.getElementById("mp-create-status")?.value?.trim() || "待处理";

  if (!reportDate) {
    alert("通报日期不能为空");
    return;
  }
  if (!siteName) {
    alert("局点名称不能为空");
    return;
  }
  if (!problemType) {
    alert("重大问题类型不能为空");
    return;
  }
  if (!description) {
    alert("问题描述不能为空");
    return;
  }

  try {
    const r = await fetch(`${API_BASE_URL}/api/major-problems`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        report_date: reportDate,
        ops_order_no: opsOrderNo,
        site_name: siteName,
        problem_type: problemType,
        description: description,
        root_cause: rootCause,
        solution: solution,
        root_cause_category: rootCauseCategory,
        feature_category: featureCategory,
        impact_category: impactCategory,
        kernel_version: kernelVersion,
        dts_bug_no: dtsBugNo,
        status: status,
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