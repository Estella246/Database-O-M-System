import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL, fetchPostJsonLongRunning } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { ensureTicketTab, getUrlByKey, syncSingleTicketFromServer } from "./ticket-core.js";
import { prepareTicketDetailEnter } from "./ticket-page.js";

// 重大问题（工单驱动）：工单按事件级别自动流转，配整体状态与进展跟踪。
export const MAJOR_ISSUE_STATUSES = ["进行中", "挂起", "关闭"];

const MAJOR_ISSUE_CLOSE_ROLE_CODES = new Set(["admin", "管理员", "运维组长"]);

export function canCloseMajorIssue() {
  return MAJOR_ISSUE_CLOSE_ROLE_CODES.has(getCurrentRoleCode());
}

export function majorIssueStatusOptions(currentStatus = "") {
  const cur = String(currentStatus || "").trim();
  return MAJOR_ISSUE_STATUSES.filter(
    (s) => s !== "关闭" || canCloseMajorIssue() || cur === "关闭",
  );
}

export const MAJOR_ISSUE_STATUS_TABS = [
  { key: "", label: "全部" },
  { key: "进行中", label: "进行中" },
  { key: "挂起", label: "挂起" },
  { key: "关闭", label: "关闭" },
];

export let _miSearchDebounceTimer = null;
export const MI_SEARCH_DEBOUNCE_MS = 400;
const MI_BACKFILL_BATCH_SIZE = 100;
let _miFetchInProgress = false;

export function formatMiDate(d) {
  if (!d) return "";
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function formatMiDateTime(d) {
  if (!d) return "";
  return String(d).replace("T", " ").slice(0, 16);
}

export function getMiStatusClass(status) {
  const s = String(status || "").trim();
  if (s === "进行中") return "mp-status--processing";
  if (s === "挂起") return "mp-status--pending";
  if (s === "关闭") return "mp-status--closed";
  return "";
}

export async function fetchMajorIssueList() {
  if (_miFetchInProgress) return;
  _miFetchInProgress = true;
  const op = getCurrentOperator();
  state.majorIssueListLoading = true;
  state.majorIssueListError = "";
  requestRender();
  try {
    const status = state.majorIssueStatusFilter || "";
    const q = (state.majorIssueSearch || "").trim();
    const r = await fetch(
      `${API_BASE_URL}/api/major-issues?operator_id=${encodeURIComponent(op.account)}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${state.majorIssueListPage}&page_size=${state.majorIssueListPageSize}`
    );
    if (!r.ok) {
      state.majorIssueList = [];
      state.majorIssueListTotal = 0;
      let detail = "";
      try {
        const err = await r.json();
        detail = String(err.detail || "").trim();
      } catch (_) {}
      state.majorIssueListError = detail || `加载失败（HTTP ${r.status}）`;
      return;
    }
    const j = await r.json();
    state.majorIssueList = Array.isArray(j.items) ? j.items : [];
    state.majorIssueListTotal = j.total || 0;
    state.majorIssueListError = "";
  } catch (e) {
    state.majorIssueList = [];
    state.majorIssueListTotal = 0;
    state.majorIssueListError = e?.message ? `网络错误：${e.message}` : "网络错误";
  } finally {
    state.majorIssueListLoading = false;
    state.majorIssueListLoaded = true;
    state.majorIssueNeedsRefresh = false;
    _miFetchInProgress = false;
    requestRender();
  }
}

export async function fetchMajorIssueProgress(id) {
  const op = getCurrentOperator();
  state.majorIssueProgressLoading = true;
  requestRender();
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-issues/${id}/progress?operator_id=${encodeURIComponent(op.account)}`);
    state.majorIssueProgressList = r.ok ? (await r.json()).items || [] : [];
  } catch (_) {
    state.majorIssueProgressList = [];
  } finally {
    state.majorIssueProgressLoading = false;
    requestRender();
  }
}

function openMajorIssueDetail(id) {
  const item = (state.majorIssueList || []).find((it) => Number(it.id) === Number(id));
  if (!item) return;
  state.majorIssueDetailId = id;
  state.majorIssueDetailBundle = item;
  state.majorIssueProgressOpen = true;
  state.majorIssueProgressHistoryOpen = false;
  state.majorIssueProgressList = [];
  fetchMajorIssueProgress(id);
}

function closeMajorIssueDetail() {
  state.majorIssueDetailId = null;
  state.majorIssueDetailBundle = null;
  state.majorIssueProgressOpen = false;
  state.majorIssueProgressList = [];
}

export function majorIssueBackfillButtonLabel() {
  if (!state.majorIssueBackfillRunning) return "回填";
  const scanned = Number(state.majorIssueBackfillScanned) || 0;
  const total = Number(state.majorIssueBackfillTicketTotal) || 0;
  const inList = Number(state.majorIssueBackfillInList) || 0;
  if (total > 0) {
    return `回填中 ${scanned}/${total} · 列表 ${inList} 条`;
  }
  const progress = String(state.majorIssueBackfillProgress || "").trim();
  return progress || "回填中…";
}

export async function runMajorIssueBackfill() {
  if (state.majorIssueBackfillRunning) return;
  const whitelist = getCurrentWhitelistSettings();
  if (!whitelistAllows("major_problem_create", "readonly", whitelist)) {
    window.alert("无权执行重大问题回填");
    return;
  }
  if (!window.confirm("将按事件级别扫描全部工单并回填重大问题列表，是否继续？")) return;

  const op = getCurrentOperator();
  state.majorIssueBackfillRunning = true;
  state.majorIssueBackfillProgress = "准备回填…";
  state.majorIssueBackfillScanned = 0;
  state.majorIssueBackfillTicketTotal = 0;
  state.majorIssueBackfillInList = 0;
  requestRender();

  const totals = { upserted: 0, removed: 0, processed: 0 };
  let afterTicketId = 0;
  let ticketTotal = 0;
  let firstBatch = true;

  try {
    while (true) {
      state.majorIssueBackfillProgress = ticketTotal > 0
        ? `回填中 ${state.majorIssueBackfillScanned}/${ticketTotal}`
        : "回填中…";
      requestRender();

      const json = await fetchPostJsonLongRunning(`${API_BASE_URL}/api/major-issues/backfill`, {
        operator_id: op.account,
        after_ticket_id: afterTicketId,
        reset_cursor: firstBatch,
        batch_size: MI_BACKFILL_BATCH_SIZE,
      });

      if (firstBatch && Number(json.ticket_total) > 0) {
        ticketTotal = Number(json.ticket_total);
        state.majorIssueBackfillTicketTotal = ticketTotal;
      }
      firstBatch = false;

      totals.processed += Number(json.processed) || 0;
      totals.upserted += Number(json.upserted) || 0;
      totals.removed += Number(json.removed) || 0;
      state.majorIssueBackfillScanned = totals.processed;
      state.majorIssueBackfillInList = Number(json.major_issue_total) || 0;
      state.majorIssueListTotal = state.majorIssueBackfillInList;
      afterTicketId = Number(json.after_ticket_id) || afterTicketId;

      requestRender();

      if (!json.has_more) break;
      if (!(Number(json.processed) > 0)) break;
    }

    state.majorIssueNeedsRefresh = true;
    await fetchMajorIssueList();
    window.alert(
      `回填完成：扫描 ${totals.processed} 张工单，新增/更新 ${totals.upserted} 条，移出 ${totals.removed} 条；列表共 ${state.majorIssueListTotal} 条。`,
    );
  } catch (e) {
    window.alert(`回填失败：${e?.message ? e.message : String(e)}`);
  } finally {
    state.majorIssueBackfillRunning = false;
    state.majorIssueBackfillProgress = "";
    requestRender();
  }
}

export function renderMajorIssuePage() {
  const tabsHtml = MAJOR_ISSUE_STATUS_TABS.map((t) => {
    const active = (state.majorIssueStatusFilter || "") === t.key;
    return `<button type="button" class="mp-period ${active ? "active" : ""}" data-mi-status="${escapeAttr(t.key)}">${escapeHtml(t.label)}</button>`;
  }).join("");

  const pageSize = Number(state.majorIssueListPageSize) > 0 ? Number(state.majorIssueListPageSize) : 20;
  const totalItems = Number(state.majorIssueListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.majorIssueListPage) || 1), totalPages);
  if (currentPage !== state.majorIssueListPage) state.majorIssueListPage = currentPage;

  const rows = (state.majorIssueList || [])
    .map((it, idx) => {
      const progressTxt = it.latest_progress_content
        ? `${escapeHtml(String(it.latest_progress_content))}${it.latest_progress_risk ? `　消减：${escapeHtml(String(it.latest_progress_risk))}` : ""}`
        : "—";
      const ticketNo = String(it.ticket_no || "");
      return `<tr class="mp-row" data-mi-id="${it.id}">
        <td>${(currentPage - 1) * pageSize + idx + 1}</td>
        <td class="mp-nowrap">${formatMiDate(it.report_date)}</td>
        <td><a href="#" class="mi-ticket-link" data-mi-ticket="${escapeAttr(ticketNo)}">${escapeHtml(ticketNo)}</a></td>
        <td>${escapeHtml(String(it.site_name || ""))}</td>
        <td>${escapeHtml(String(it.event_level || ""))}</td>
        <td class="mp-desc-cell">${escapeHtml(String(it.description || ""))}</td>
        <td>${escapeHtml(String(it.ops_analyst || ""))}</td>
        <td>${escapeHtml(String(it.dev_analyst || ""))}</td>
        <td class="mp-desc-cell">${progressTxt}<span class="mi-progress-count">（${Number(it.progress_count) || 0}）</span></td>
        <td><span class="mp-status ${getMiStatusClass(it.status)}">${escapeHtml(String(it.status || ""))}</span></td>
      </tr>`;
    })
    .join("");

  const emptyMsg = state.majorIssueListLoading
    ? "加载中…"
    : state.majorIssueListError || "暂无数据";
  const empty = `<tr><td colspan="10" class="mp-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const sizeOptions = [10, 20, 50, 100]
    .map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`)
    .join("");

  const paginationHtml = `
    <div id="mi-list-pagination" class="list-pagination">
      <div class="list-pagination-bar">
        <span class="list-pagination-summary">共 ${totalItems} 条，第 ${currentPage}/${totalPages} 页</span>
        <label class="list-pagination-size">
          <span class="list-pagination-size-text">每页</span>
          <select id="mi-page-size" class="list-page-size" aria-label="每页条数">${sizeOptions}</select>
          <span class="list-pagination-size-suffix">条</span>
        </label>
        <div class="list-pagination-nav">
          <button class="action list-page-btn" type="button" id="mi-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="action list-page-btn" type="button" id="mi-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
    </div>`;

  return `
    <section class="mp-wrap" id="mi-management-panel">
      <div class="mp-toolbar-top">
        <div class="mp-period-tabs">${tabsHtml}</div>
        <div class="mp-search">
          <input type="search" id="mi-search-input" class="mp-search-input" placeholder="搜索运维单号、局点名称、问题描述、分析人" value="${escapeAttr(state.majorIssueSearch || "")}" />
        </div>
      </div>
      <div class="mp-table-card">
        <table class="mp-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>通报日期</th>
              <th>运维单号</th>
              <th>局点名称</th>
              <th>事件级别</th>
              <th>问题描述</th>
              <th>运维分析人</th>
              <th>开发分析人</th>
              <th>进展&amp;消减措施</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>${state.majorIssueList.length ? rows : empty}</tbody>
        </table>
        ${paginationHtml}
      </div>
    </section>`;
}

export function renderMajorIssueModalsHtml() {
  const b = state.majorIssueDetailBundle;
  if (!state.majorIssueProgressOpen || !b) return "";

  const whitelist = getCurrentWhitelistSettings();
  const canWrite = whitelistAllows("major_problem_create", "readonly", whitelist);

  const statusOptions = majorIssueStatusOptions(b.status).map(
    (s) => `<option value="${escapeAttr(s)}" ${s === String(b.status || "") ? "selected" : ""}>${escapeHtml(s)}</option>`
  ).join("");

  const progressList = state.majorIssueProgressList || [];
  const dayNode = (p, isLatest) => {
    const time = formatMiDateTime(p.progress_at).slice(11);
    return `<div class="mi-day ${isLatest ? "mi-day--latest" : ""}">
        <div class="mi-day-head">
          <span class="mi-day-date">${formatMiDate(p.progress_at)}</span>
          ${isLatest ? `<span class="mi-day-badge">最新</span>` : ""}
          <span class="mi-progress-author">${escapeHtml(String(p.creator_name || ""))}${time ? ` · ${time}` : ""}</span>
        </div>
        <div class="mi-day-body">
          <div class="mi-progress-content">${escapeHtml(String(p.content || ""))}</div>
          ${p.risk_measure ? `<div class="mi-progress-risk"><strong>消减措施：</strong>${escapeHtml(String(p.risk_measure))}</div>` : ""}
        </div>
      </div>`;
  };

  let timeline;
  if (state.majorIssueProgressLoading) {
    timeline = `<div class="mi-progress-empty">加载中…</div>`;
  } else if (!progressList.length) {
    timeline = `<div class="mi-progress-empty">暂无进展记录</div>`;
  } else {
    const [latest, ...history] = progressList;
    const histOpen = !!state.majorIssueProgressHistoryOpen;
    timeline = `<div class="mi-progress-tree">
        ${dayNode(latest, true)}
        ${history.length
          ? `<button type="button" class="mi-progress-toggle" id="mi-progress-toggle">${histOpen ? "收起历史进展" : `展开历史进展（${history.length} 天）`}</button>
             <div class="mi-progress-history"${histOpen ? "" : " hidden"}>${history.map((p) => dayNode(p, false)).join("")}</div>`
          : ""}
      </div>`;
  }

  const addForm = canWrite
    ? `<div class="mi-progress-add">
        <label class="mp-field">进展内容 *
          <textarea id="mi-progress-content" class="mp-textarea" rows="2" placeholder="请输入本次进展"></textarea>
        </label>
        <label class="mp-field">风险消减措施
          <textarea id="mi-progress-risk" class="mp-textarea" rows="2" placeholder="风险消减措施（选填）"></textarea>
        </label>
      </div>`
    : "";

  return `<div class="perm-modal-mask mp-modal-mask" id="mi-detail-mask">
      <div class="perm-modal mp-modal mp-detail-modal" role="dialog">
        <div class="perm-modal-head"><h3>重大问题详情 - ${escapeHtml(String(b.ticket_no || ""))}</h3></div>
        <div class="perm-modal-body mp-detail-body">
          <div class="mp-detail-meta">
            <p><strong>通报日期：</strong>${formatMiDate(b.report_date)}</p>
            <p><strong>运维单号：</strong>${escapeHtml(String(b.ticket_no || ""))}</p>
            <p><strong>局点名称：</strong>${escapeHtml(String(b.site_name || ""))}</p>
            <p><strong>事件级别：</strong>${escapeHtml(String(b.event_level || ""))}</p>
            <p><strong>运维分析人：</strong>${escapeHtml(String(b.ops_analyst || ""))}</p>
            <p><strong>开发分析人：</strong>${escapeHtml(String(b.dev_analyst || ""))}</p>
            <p><strong>状态：</strong>
              ${canWrite
                ? `<select id="mi-status-select" class="mp-input mi-status-select">${statusOptions}</select>`
                : `<span class="mp-status ${getMiStatusClass(b.status)}">${escapeHtml(String(b.status || ""))}</span>`}
            </p>
          </div>
          <div class="mp-detail-desc">
            <h4>问题描述</h4>
            <div class="mp-detail-desc-content">${escapeHtml(String(b.description || "暂无"))}</div>
          </div>
          <div class="mp-detail-desc">
            <h4>进展跟踪</h4>
            <div class="mi-progress-list">${timeline}</div>
            ${addForm}
          </div>
        </div>
        <div class="perm-modal-foot">
          ${canWrite ? `<button type="button" class="action primary" id="mi-progress-add-btn">新增进展</button>` : ""}
          <button type="button" class="action" id="mi-detail-close-btn">关闭</button>
        </div>
      </div>
    </div>`;
}

export function bindMajorIssuePage() {
  const panel = document.getElementById("mi-management-panel");

  if (panel) {
    document.querySelectorAll("[data-mi-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.majorIssueStatusFilter = btn.getAttribute("data-mi-status") || "";
        state.majorIssueListPage = 1;
        fetchMajorIssueList();
      });
    });

    const searchInput = document.getElementById("mi-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const v = searchInput.value;
        clearTimeout(_miSearchDebounceTimer);
        _miSearchDebounceTimer = setTimeout(() => {
          state.majorIssueSearch = v;
          state.majorIssueListPage = 1;
          fetchMajorIssueList();
        }, MI_SEARCH_DEBOUNCE_MS);
      });
    }

    const pageSizeSelect = document.getElementById("mi-page-size");
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener("change", () => {
        state.majorIssueListPageSize = Number(pageSizeSelect.value) || 20;
        state.majorIssueListPage = 1;
        fetchMajorIssueList();
      });
    }
    const prevBtn = document.getElementById("mi-page-prev");
    const nextBtn = document.getElementById("mi-page-next");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (state.majorIssueListPage > 1) {
          state.majorIssueListPage--;
          fetchMajorIssueList();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        const pageSize = Number(state.majorIssueListPageSize) || 20;
        const totalPages = Math.max(1, Math.ceil((state.majorIssueListTotal || 0) / pageSize));
        if (state.majorIssueListPage < totalPages) {
          state.majorIssueListPage++;
          fetchMajorIssueList();
        }
      });
    }

    document.querySelectorAll(".mp-row[data-mi-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = Number(row.getAttribute("data-mi-id"));
        if (id) openMajorIssueDetail(id);
      });
    });

    // 运维单号点击：跳转到工作台中的问题详情（阻止冒泡，避免同时打开进展抽屉）
    document.querySelectorAll(".mi-ticket-link[data-mi-ticket]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ticketNo = link.getAttribute("data-mi-ticket") || "";
        if (ticketNo) gotoWorkbenchTicket(ticketNo);
      });
    });
  }

  // 详情弹窗
  const detailMask = document.getElementById("mi-detail-mask");
  const closeBtn = document.getElementById("mi-detail-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeMajorIssueDetail();
      requestRender();
    });
  }
  if (detailMask) {
    detailMask.addEventListener("click", (e) => {
      if (e.target === detailMask) {
        closeMajorIssueDetail();
        requestRender();
      }
    });
  }

  const statusSelect = document.getElementById("mi-status-select");
  if (statusSelect) {
    statusSelect.addEventListener("change", () => {
      handleMajorIssueStatusChange(statusSelect.value);
    });
  }

  const addBtn = document.getElementById("mi-progress-add-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      handleMajorIssueProgressAdd();
    });
  }

  const histToggle = document.getElementById("mi-progress-toggle");
  if (histToggle) {
    histToggle.addEventListener("click", () => {
      state.majorIssueProgressHistoryOpen = !state.majorIssueProgressHistoryOpen;
      requestRender();
    });
  }
}

function gotoWorkbenchTicket(ticketNo) {
  // 关闭可能打开的进展抽屉，切到该工单的详情页签（与工作台行点击一致）
  closeMajorIssueDetail();
  prepareTicketDetailEnter(ticketNo);
  state.activeKey = ensureTicketTab(ticketNo);
  try {
    history.pushState({}, "", getUrlByKey(state.activeKey));
  } catch (_) {}
  // 工作台列表可能尚未加载，拉一次以便详情页能解析到该工单
  syncSingleTicketFromServer(ticketNo).then(() => requestRender());
  requestRender();
}

async function handleMajorIssueStatusChange(newStatus) {
  const id = state.majorIssueDetailId;
  if (!id) return;
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, status: newStatus }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "状态修改失败");
      return;
    }
    const updated = await r.json();
    if (state.majorIssueDetailBundle) state.majorIssueDetailBundle.status = updated.status;
    state.majorIssueNeedsRefresh = true;
    await fetchMajorIssueList();
    requestRender();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}

async function handleMajorIssueProgressAdd() {
  const id = state.majorIssueDetailId;
  if (!id) return;
  const content = document.getElementById("mi-progress-content")?.value?.trim() || "";
  const risk = document.getElementById("mi-progress-risk")?.value?.trim() || "";
  if (!content) {
    alert("进展内容不能为空");
    return;
  }
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/major-issues/${id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, content, risk_measure: risk }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.detail || "新增进展失败");
      return;
    }
    await fetchMajorIssueProgress(id);
    state.majorIssueNeedsRefresh = true;
    await fetchMajorIssueList();
    requestRender();
  } catch (e) {
    alert("网络错误：" + e.message);
  }
}
