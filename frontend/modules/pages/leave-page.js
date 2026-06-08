import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { operatorMatchesPersonField, formatLeaveIsoDisplay, leaveSegmentDurationHours } from "../utils/format.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { LEAVE_APPLICATION_TYPES } from "../constants/duty.js";
import { runLeaveBatchActions, resetLeaveCreateForm, fetchLeaveDetail } from "./home-page.js";
import {
  syncDutyRosterExtrasFromServer,
  dutyModalUserLabel,
  filterDutyUsersForSuggest,
  renderDutyUserSuggestListHtml,
  getDutySelectableUsers,
} from "./duty.js";
import { renderListPaginationHtml, bindListPagination } from "../utils/list-pagination.js";

export function initLeaveWhitelistDraftFromItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((x) => String(x.account || "").trim())
    .filter(Boolean);
}

export function leaveWhitelistEntryLabel(account, { whitelist = [], adminUsers = [] } = {}) {
  const acc = String(account || "").trim();
  if (!acc) return "";
  const wl = whitelist.find((w) => String(w.account || "") === acc);
  const u = adminUsers.find((x) => String(x.account || "") === acc);
  const name = String(wl?.user_name || u?.user_name || "").trim();
  return name ? `${name} ${acc}` : acc;
}

export function filterLeaveWhitelistUsersForAdd(pool, draftAccounts, filterText) {
  const draft = new Set((draftAccounts || []).map((a) => String(a || "")));
  const users = (Array.isArray(pool) ? pool : []).filter((u) => !draft.has(String(u.account || "")));
  const qq = String(filterText || "").trim();
  if (!qq) return [];
  return filterDutyUsersForSuggest(users, qq, { emptyLimit: 20 });
}

export function updateLeaveCreateSegmentDurationCells() {
  document.querySelectorAll("#leave-app-seg-tbody tr").forEach((tr) => {
    const start = tr.querySelector('[data-leave-seg-field="start"]')?.value || "";
    const end = tr.querySelector('[data-leave-seg-field="end"]')?.value || "";
    const durCell = tr.querySelector(".leave-app-dur-cell");
    if (durCell) durCell.textContent = leaveSegmentDurationHours(start, end);
  });
}

export function leaveApplicantDefaultDisplay() {
  const op = getCurrentOperator();
  const name = String(op.userName || "").trim();
  const acc = String(op.account || "").trim();
  return name ? `${name} ${acc}` : acc;
}

export async function fetchLeaveApproverWhitelist() {
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/leave/approver-whitelist?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) return;
    const j = await r.json();
    state.leaveApproverWhitelist = Array.isArray(j.items) ? j.items : [];
  } catch (_) {}
}

export async function fetchLeaveList() {
  const op = getCurrentOperator();
  state.leaveListLoading = true;
  requestRender();
  try {
    const scope = state.leaveTab === "todo" ? "todo" : "all";
    const q = state.leaveSearch.trim();
    const r = await fetch(
      `${API_BASE_URL}/api/leave/applications?operator_id=${encodeURIComponent(op.account)}&scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}&page=${state.leaveListPage}&page_size=${state.leaveListPageSize}`
    );
    if (!r.ok) {
      state.leaveList = [];
      state.leaveListTotal = 0;
      return;
    }
    const j = await r.json();
    state.leaveList = Array.isArray(j.items) ? j.items : [];
    state.leaveListTotal = Number(j.total) || 0;
  } catch (_) {
    state.leaveList = [];
    state.leaveListTotal = 0;
  } finally {
    state.leaveListLoading = false;
    requestRender();
  }
}

export function renderHomeLeaveWorkbenchTableSection() {
  const items = state.homeLeavePendingItems || [];
  if (state.homeLeavePendingLoading) {
    return `<tbody id="home-leave-table-body"><tr><td colspan="10" class="leave-app-empty">加载中…</td></tr></tbody>`;
  }
  const rows = items
    .map((it, idx) => {
      const spanStart = formatLeaveIsoDisplay(it.span_start);
      const spanEnd = formatLeaveIsoDisplay(it.span_end);
      const hours = it.total_hours != null ? Number(it.total_hours).toFixed(2) : "—";
      const reason = String(it.reasons_concat || "").trim() || "—";
      return `<tr class="leave-app-row home-leave-app-row" data-leave-app-id="${it.id}">
        <td>${idx + 1}</td>
        <td>${escapeHtml(String(it.application_no || ""))}</td>
        <td>${escapeHtml(String(it.status || ""))}</td>
        <td>${escapeHtml(String(it.application_type || ""))}</td>
        <td>${escapeHtml(String(it.applicant_display || ""))}</td>
        <td class="leave-app-nowrap">${escapeHtml(spanStart)}</td>
        <td class="leave-app-nowrap">${escapeHtml(spanEnd)}</td>
        <td>${escapeHtml(hours)}</td>
        <td class="leave-app-reason">${escapeHtml(reason)}</td>
        <td>${escapeHtml(String(it.current_handler_display || "—"))}</td>
      </tr>`;
    })
    .join("");
  const empty = `<tr><td colspan="10" class="leave-app-empty">暂无数据</td></tr>`;
  return `<tbody id="home-leave-table-body">${rows || empty}</tbody>`;
}

export function renderLeaveApplicationPage() {
  const whitelist = getCurrentWhitelistSettings();
  const canManageWhitelist = whitelistAllows("leave_whitelist", "readonly", whitelist);
  const canApplyLeave = whitelistAllows("leave_apply", "readonly", whitelist);
  const canDeleteLeave = whitelistAllows("leave_delete", "readonly", whitelist);
  const batchTodo = state.leaveTab === "todo";
  const showRowCheck = batchTodo || canDeleteLeave;
  const pageSize = Number(state.leaveListPageSize) > 0 ? Number(state.leaveListPageSize) : 10;
  const totalItems = Number(state.leaveListTotal) || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(state.leaveListPage) || 1), totalPages);
  if (currentPage !== state.leaveListPage) state.leaveListPage = currentPage;
  const listIds = (state.leaveList || []).map((x) => x.id);
  const sel = state.leaveBatchSelectedIds || [];
  const allSelected = showRowCheck && listIds.length > 0 && listIds.every((id) => sel.includes(id));
  const checkTh = showRowCheck
    ? `<th class="leave-app-col-check"><input type="checkbox" id="leave-batch-select-all" title="全选本页" ${allSelected ? "checked" : ""} /></th>`
    : "";
  const rows = (state.leaveList || [])
    .map((it, idx) => {
      const spanStart = formatLeaveIsoDisplay(it.span_start);
      const spanEnd = formatLeaveIsoDisplay(it.span_end);
      const hours = it.total_hours != null ? Number(it.total_hours).toFixed(2) : "—";
      const reason = String(it.reasons_concat || "").trim() || "—";
      const checkTd = showRowCheck
        ? `<td class="leave-app-col-check"><input type="checkbox" class="leave-app-row-check" data-leave-app-select="${it.id}" ${sel.includes(it.id) ? "checked" : ""} /></td>`
        : "";
      return `<tr class="leave-app-row" data-leave-app-id="${it.id}">
        ${checkTd}
        <td>${(currentPage - 1) * pageSize + idx + 1}</td>
        <td>${escapeHtml(String(it.application_no || ""))}</td>
        <td>${escapeHtml(String(it.status || ""))}</td>
        <td>${escapeHtml(String(it.application_type || ""))}</td>
        <td>${escapeHtml(String(it.applicant_display || ""))}</td>
        <td class="leave-app-nowrap">${escapeHtml(spanStart)}</td>
        <td class="leave-app-nowrap">${escapeHtml(spanEnd)}</td>
        <td>${escapeHtml(hours)}</td>
        <td class="leave-app-reason">${escapeHtml(reason)}</td>
        <td>${escapeHtml(String(it.current_handler_display || "—"))}</td>
      </tr>`;
    })
    .join("");
  const colCount = showRowCheck ? 11 : 10;
  const empty = `<tr><td colspan="${colCount}" class="leave-app-empty">${state.leaveListLoading ? "加载中…" : "暂无数据"}</td></tr>`;
  const paginationHtml = renderListPaginationHtml({
    wrapId: "leave-list-pagination",
    totalItems,
    currentPage,
    totalPages,
    pageSize,
    pageSizeSelectId: "leave-page-size",
    prevId: "leave-page-prev",
    nextId: "leave-page-next",
  });
  return `
    <section class="leave-app-wrap" id="leave-application-panel">
      <div class="leave-app-toolbar">
        <div class="leave-app-tabs">
          <button type="button" class="leave-app-tab ${state.leaveTab === "all" ? "active" : ""}" data-leave-tab="all">所有申请</button>
          <button type="button" class="leave-app-tab ${state.leaveTab === "todo" ? "active" : ""}" data-leave-tab="todo">我的待办</button>
        </div>
        <div class="leave-app-search">
          <input type="search" id="leave-app-search-input" class="leave-app-search-input" placeholder="搜索编号、状态、类型、发起人、时间、时长、理由、处理人等" value="${escapeAttr(state.leaveSearch)}" />
        </div>
        <div class="leave-app-toolbar-right">
          ${batchTodo ? `<button type="button" class="action primary" id="leave-batch-approval-btn">批量审批</button>` : ""}
          ${canDeleteLeave ? '<button type="button" class="action danger" id="leave-batch-delete-btn">删除</button>' : ""}
          ${canManageWhitelist ? `<button type="button" class="action" id="leave-app-whitelist-btn">审批白名单</button>` : ""}
          ${canApplyLeave ? '<button type="button" class="action primary" id="leave-app-apply-btn">申请</button>' : ""}
        </div>
      </div>
      <div class="leave-app-table-card">
        <table class="leave-app-table">
          <thead>
            <tr>
              ${checkTh}
              <th>序号</th><th>申请编号</th><th>申请状态</th><th>申请类型</th><th>发起人</th>
              <th>开始时间</th><th>结束时间</th><th>请假时长/h</th><th>申请理由</th><th>当前处理人</th>
            </tr>
          </thead>
          <tbody>${state.leaveList.length ? rows : empty}</tbody>
        </table>
        ${paginationHtml}
      </div>
    </section>`;
}

export function renderLeaveModalsHtml() {
  const createSegRows = state.leaveCreateSegments
    .map((seg, i) => {
      const dur = leaveSegmentDurationHours(seg.start, seg.end);
      return `<tr data-leave-seg-key="${seg.key}">
        <td>${i + 1}</td>
        <td><input type="datetime-local" class="leave-app-dt" step="1" data-leave-seg-field="start" value="${escapeAttr(seg.start)}" /></td>
        <td><input type="datetime-local" class="leave-app-dt" step="1" data-leave-seg-field="end" value="${escapeAttr(seg.end)}" /></td>
        <td class="leave-app-dur-cell">${escapeHtml(dur)}</td>
        <td><input type="text" class="leave-app-reason-input" data-leave-seg-field="reason" value="${escapeAttr(seg.reason)}" placeholder="事由" /></td>
        <td><button type="button" class="action danger leave-app-seg-del" data-leave-seg-key="${seg.key}" ${state.leaveCreateSegments.length <= 1 ? "disabled" : ""}>删除</button></td>
      </tr>`;
    })
    .join("");
  const typeOpts = LEAVE_APPLICATION_TYPES.map(
    (t) => `<option value="${escapeAttr(t)}" ${state.leaveCreateType === t ? "selected" : ""}>${escapeHtml(t)}</option>`
  ).join("");
  const apprOpts = (state.leaveApproverWhitelist || [])
    .map((w) => {
      const lab = `${String(w.user_name || "").trim()} ${w.account}`.trim();
      return `<option value="${escapeAttr(w.account)}" ${state.leaveCreateApprover === w.account ? "selected" : ""}>${escapeHtml(lab)}</option>`;
    })
    .join("");
  const createOpen = state.leaveCreateOpen
    ? `<div class="perm-modal-mask leave-app-modal-mask" id="leave-app-create-mask">
      <div class="perm-modal leave-app-modal" role="dialog">
        <div class="perm-modal-head"><h3>请假申请</h3></div>
        <div class="perm-modal-body leave-app-create-body">
          <label class="leave-app-field">申请类型（必填）
            <select id="leave-create-type" class="leave-app-select"><option value="">请选择</option>${typeOpts}</select>
          </label>
          <div class="leave-app-seg-toolbar">
            <span class="leave-app-seg-title">时间段（可多条）</span>
            <button type="button" class="action" id="leave-app-add-seg-btn">新增行</button>
          </div>
          <table class="leave-app-seg-table">
            <thead><tr><th>序号</th><th>开始时间</th><th>结束时间</th><th>申请时长/h</th><th>申请事由</th><th>操作</th></tr></thead>
            <tbody id="leave-app-seg-tbody">${createSegRows}</tbody>
          </table>
          <label class="leave-app-field">申请人（必填）
            <input type="text" id="leave-create-applicant" readonly class="leave-app-input" value="${escapeAttr(leaveApplicantDefaultDisplay())}" />
          </label>
          <label class="leave-app-field">审批人（必填，白名单）
            <select id="leave-create-approver" class="leave-app-select"><option value="">请选择</option>${apprOpts}</select>
          </label>
          <label class="leave-app-field">抄送人（选填，多个账号逗号分隔）
            <input type="text" id="leave-create-cc" class="leave-app-input" placeholder="例如：user1,user2" value="${escapeAttr(state.leaveCreateCc)}" />
          </label>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="leave-create-cancel-btn">取消</button>
          <button type="button" class="action primary" id="leave-create-submit-btn">提交</button>
        </div>
      </div></div>`
    : "";
  const wlDraft = state.leaveWhitelistDraftAccounts || [];
  const wlMemberRows = wlDraft
    .map((acc) => {
      const lab = leaveWhitelistEntryLabel(acc, {
        whitelist: state.leaveApproverWhitelist,
        adminUsers: state.adminUsers,
      });
      return `<li class="leave-app-wl-member">
        <span class="leave-app-wl-member-name">${escapeHtml(lab)}</span>
        <button type="button" class="action danger leave-app-wl-member-remove" data-leave-wl-remove="${escapeAttr(acc)}">移除</button>
      </li>`;
    })
    .join("");
  const wlSelectableCount = getDutySelectableUsers().length;
  const wl = state.leaveWhitelistModalOpen
    ? `<div class="perm-modal-mask leave-app-modal-mask" id="leave-app-wl-mask">
    <div class="perm-modal leave-app-modal" role="dialog">
      <div class="perm-modal-head"><h3>审批人白名单</h3></div>
      <div class="perm-modal-body leave-app-wl-body">
        <div class="leave-app-wl-section">
          <div class="leave-app-wl-section-title">当前审批人（${wlDraft.length}）</div>
          <ul class="leave-app-wl-members">${wlMemberRows || `<li class="leave-app-wl-empty">暂无审批人</li>`}</ul>
        </div>
        <div class="leave-app-wl-section">
          <label class="leave-app-field leave-app-wl-add-field">添加审批人
            <div class="duty-modal-user-combo leave-app-wl-combo">
              <input
                type="text"
                id="leave-wl-user-input"
                autocomplete="off"
                placeholder="${wlSelectableCount ? "输入姓名或账号搜索" : "暂无可用人员"}"
                aria-autocomplete="list"
                aria-controls="leave-wl-user-listbox"
                aria-expanded="false"
                role="combobox"
                ${wlSelectableCount ? "" : "disabled"}
              />
              <input type="hidden" id="leave-wl-user-account" value="" />
              <ul id="leave-wl-user-listbox" class="duty-modal-user-suggest leave-app-wl-suggest" role="listbox" hidden></ul>
            </div>
          </label>
          <button type="button" class="action primary leave-app-wl-add-btn" id="leave-wl-add-btn" ${wlSelectableCount ? "" : "disabled"}>添加</button>
        </div>
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="leave-wl-cancel-btn">取消</button>
        <button type="button" class="action primary" id="leave-wl-save-btn">保存</button>
      </div>
    </div></div>`
    : "";
  const detail = state.leaveDetailId
    ? (() => {
        const b = state.leaveDetailBundle;
        const loading = state.leaveDetailLoading;
        const app = b?.application;
        const op = getCurrentOperator();
        const canAct =
          app &&
          app.status === "审批中" &&
          String(app.current_handler_account || "").trim() === String(op.account || "").trim();
        const canDeleteLeave = whitelistAllows("leave_delete", "readonly", getCurrentWhitelistSettings());
        const logRows = (b?.logs || [])
          .map(
            (lg) =>
              `<tr>
            <td>${escapeHtml(String(lg.step_label || ""))}</td>
            <td>${escapeHtml(String(lg.operator_display || ""))}</td>
            <td class="leave-app-nowrap">${escapeHtml(formatLeaveIsoDisplay(lg.created_at))}</td>
            <td>${escapeHtml(String(lg.action || ""))}</td>
            <td class="leave-app-log-comment">${escapeHtml(String(lg.comment || ""))}</td>
          </tr>`
          )
          .join("");
        const segRows = (b?.segments || [])
          .map((s) => {
            const sn = s.seq != null ? Number(s.seq) + 1 : "";
            return `<tr><td>${sn}</td><td>${escapeHtml(formatLeaveIsoDisplay(s.start_at))}</td><td>${escapeHtml(formatLeaveIsoDisplay(s.end_at))}</td><td>${Number(s.duration_hours || 0).toFixed(2)}</td><td>${escapeHtml(String(s.reason || ""))}</td></tr>`;
          })
          .join("");
        const ccLine = (b?.cc_displays || []).map((c) => escapeHtml(c.display)).join("；") || "—";
        const appNo = app ? escapeHtml(String(app.application_no || "")) : "";
        return `<div class="perm-modal-mask leave-app-modal-mask" id="leave-app-detail-mask">
        <div class="perm-modal leave-app-modal leave-app-detail-modal" role="dialog">
          <div class="perm-modal-head"><h3>申请详情 ${appNo}</h3></div>
          <div class="perm-modal-body">
            ${loading ? "<p>加载中…</p>" : ""}
            ${
              app
                ? `<div class="leave-app-detail-meta">
              <p><strong>状态</strong> ${escapeHtml(String(app.status))} · <strong>类型</strong> ${escapeHtml(String(app.application_type))}</p>
              <p><strong>发起人</strong> ${escapeHtml(String(app.applicant_display))} · <strong>审批人</strong> ${escapeHtml(String(app.approver_display))}</p>
              <p><strong>抄送</strong> ${ccLine}</p>
            </div>
            <h4 class="leave-app-subhd">时间段</h4>
            <table class="leave-app-mini-table"><thead><tr><th>序号</th><th>开始</th><th>结束</th><th>时长/h</th><th>事由</th></tr></thead><tbody>${segRows}</tbody></table>`
                : "<p>无法加载</p>"
            }
            ${
              canAct
                ? `<div class="leave-app-actions-block">
              <label class="leave-app-field">审批意见
                <textarea id="leave-detail-comment" class="leave-app-textarea" rows="2" placeholder="拒绝时必填"></textarea>
              </label>
              <div class="leave-app-action-btns">
                <button type="button" class="action danger" data-leave-action="cancel">取消</button>
                <button type="button" class="action danger" data-leave-action="reject">拒绝</button>
                <button type="button" class="action primary" data-leave-action="agree">同意</button>
              </div>
            </div>`
                : ""
            }
            <h4 class="leave-app-subhd">审批日志</h4>
            <table class="leave-app-mini-table leave-app-log-table">
              <thead><tr><th>环节</th><th>操作人</th><th>操作时间</th><th>操作</th><th>评审意见</th></tr></thead>
              <tbody>${logRows || `<tr><td colspan="5" class="leave-app-empty">暂无</td></tr>`}</tbody>
            </table>
          </div>
          <div class="perm-modal-actions">
            ${canDeleteLeave ? '<button type="button" class="action danger" id="leave-detail-delete-btn">删除</button>' : ""}
            <button type="button" class="action" id="leave-detail-close-btn">关闭</button>
          </div>
        </div></div>`;
      })()
    : "";
  const batchN = (state.leaveBatchSelectedIds || []).length;
  const batchApprovalModal = state.leaveBatchApprovalModalOpen
    ? `<div class="perm-modal-mask leave-app-modal-mask" id="leave-batch-approval-mask">
      <div class="perm-modal leave-app-modal" role="dialog">
        <div class="perm-modal-head"><h3>批量审批</h3></div>
        <div class="perm-modal-body leave-app-create-body">
          <p class="leave-app-hint">已选 <strong>${batchN}</strong> 条待办，请选择操作并确认。</p>
          <div class="leave-app-batch-act-row" role="radiogroup" aria-label="审批操作">
            <label class="leave-app-batch-act-opt"><input type="radio" name="leave-batch-act" value="agree" checked /> 同意</label>
            <label class="leave-app-batch-act-opt"><input type="radio" name="leave-batch-act" value="reject" /> 拒绝</label>
            <label class="leave-app-batch-act-opt"><input type="radio" name="leave-batch-act" value="cancel" /> 取消</label>
          </div>
          <label class="leave-app-field">审批意见
            <textarea id="leave-batch-approval-comment" class="leave-app-textarea" rows="3" placeholder="拒绝时必填；同意、取消可选填"></textarea>
          </label>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="leave-batch-approval-cancel-btn">关闭</button>
          <button type="button" class="action primary" id="leave-batch-approval-submit-btn">确定</button>
        </div>
      </div></div>`
    : "";
  return `${createOpen}${detail}${wl}${batchApprovalModal}`;
}

export function bindLeaveApplicationPage() {
  let _leaveSearchDebounceTimer = null;
  const LEAVE_SEARCH_DEBOUNCE_MS = 300;
  void fetchLeaveApproverWhitelist();
  if (state.leaveNeedsRefresh) {
    state.leaveNeedsRefresh = false;
    void fetchLeaveList();
  }
  document.querySelectorAll("[data-leave-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-leave-tab");
      if (t !== "all" && t !== "todo") return;
      state.leaveTab = t;
      state.leaveListPage = 1;
      state.leaveBatchSelectedIds = [];
      state.leaveBatchApprovalModalOpen = false;
      requestRender();
      void fetchLeaveList();
    });
  });
  document.getElementById("leave-batch-select-all")?.addEventListener("change", (ev) => {
    const on = ev.target.checked;
    const ids = (state.leaveList || []).map((x) => x.id);
    state.leaveBatchSelectedIds = on ? [...ids] : [];
    requestRender();
  });
  document.getElementById("leave-batch-delete-btn")?.addEventListener("click", async () => {
    const ids = [...(state.leaveBatchSelectedIds || [])];
    if (!ids.length) {
      window.alert("请先勾选要删除的申请");
      return;
    }
    if (!window.confirm(`确定删除选中的 ${ids.length} 条申请？此操作不可恢复。`)) return;
    const op = getCurrentOperator();
    const failed = [];
    for (const id of ids) {
      try {
        const resp = await fetch(
          `${API_BASE_URL}/api/leave/applications/${id}?operator_id=${encodeURIComponent(op.account)}`,
          { method: "DELETE" }
        );
        if (!resp.ok) {
          const tx = await resp.text();
          failed.push(`${id}: ${resp.status} ${tx.slice(0, 80)}`);
        }
      } catch (e) {
        failed.push(`${id}: ${String(e.message || e)}`);
      }
    }
    state.leaveBatchSelectedIds = [];
    if (state.leaveDetailId && ids.includes(state.leaveDetailId)) {
      state.leaveDetailId = null;
      state.leaveDetailBundle = null;
    }
    await fetchLeaveList();
    await syncDutyRosterExtrasFromServer();
    requestRender();
    if (failed.length) {
      window.alert(`部分删除失败：\n${failed.slice(0, 5).join("\n")}`);
    }
  });
  document.getElementById("leave-batch-approval-btn")?.addEventListener("click", () => {
    const ids = state.leaveBatchSelectedIds || [];
    if (!ids.length) {
      window.alert("请先勾选待办申请");
      return;
    }
    state.leaveBatchApprovalModalOpen = true;
    requestRender();
  });
  document.getElementById("leave-batch-approval-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-batch-approval-mask")) {
      state.leaveBatchApprovalModalOpen = false;
      requestRender();
    }
  });
  document.getElementById("leave-batch-approval-cancel-btn")?.addEventListener("click", () => {
    state.leaveBatchApprovalModalOpen = false;
    requestRender();
  });
  document.getElementById("leave-batch-approval-submit-btn")?.addEventListener("click", async () => {
    const ids = [...(state.leaveBatchSelectedIds || [])];
    if (!ids.length) {
      window.alert("没有可审批的申请，请重新勾选");
      state.leaveBatchApprovalModalOpen = false;
      requestRender();
      return;
    }
    const act = document.querySelector('input[name="leave-batch-act"]:checked')?.value;
    const comment = (document.getElementById("leave-batch-approval-comment")?.value || "").trim();
    if (act !== "agree" && act !== "reject" && act !== "cancel") return;
    if (act === "reject" && !comment) {
      window.alert("批量拒绝须填写审批意见");
      return;
    }
    const verb = { agree: "同意", reject: "拒绝", cancel: "取消" }[act];
    if (!window.confirm(`确定对选中的 ${ids.length} 条申请执行「${verb}」？`)) return;
    state.leaveBatchApprovalModalOpen = false;
    requestRender();
    await runLeaveBatchActions(ids, act, comment);
  });
  document.querySelector("#leave-application-panel .leave-app-table tbody")?.addEventListener("change", (ev) => {
    const cb = ev.target;
    if (!cb.matches?.("input.leave-app-row-check")) return;
    const id = parseInt(cb.getAttribute("data-leave-app-select") || "-1", 10);
    if (!Number.isFinite(id) || id < 0) return;
    let next = [...(state.leaveBatchSelectedIds || [])];
    if (cb.checked) {
      if (!next.includes(id)) next.push(id);
    } else {
      next = next.filter((x) => x !== id);
    }
    state.leaveBatchSelectedIds = next;
    requestRender();
  });
  const leaveSearchInp = document.getElementById("leave-app-search-input");
  const scheduleLeaveListSearch = () => {
    if (_leaveSearchDebounceTimer) clearTimeout(_leaveSearchDebounceTimer);
    _leaveSearchDebounceTimer = setTimeout(() => {
      _leaveSearchDebounceTimer = null;
      void fetchLeaveList();
    }, LEAVE_SEARCH_DEBOUNCE_MS);
  };
  leaveSearchInp?.addEventListener("input", (ev) => {
    state.leaveSearch = leaveSearchInp.value || "";
    state.leaveListPage = 1;
    state.leaveBatchSelectedIds = [];
    if (ev.isComposing) return;
    scheduleLeaveListSearch();
  });
  leaveSearchInp?.addEventListener("compositionend", () => {
    state.leaveSearch = leaveSearchInp.value || "";
    state.leaveListPage = 1;
    state.leaveBatchSelectedIds = [];
    scheduleLeaveListSearch();
  });
  leaveSearchInp?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    if (_leaveSearchDebounceTimer) {
      clearTimeout(_leaveSearchDebounceTimer);
      _leaveSearchDebounceTimer = null;
    }
    state.leaveSearch = leaveSearchInp.value || "";
    state.leaveListPage = 1;
    state.leaveBatchSelectedIds = [];
    void fetchLeaveList();
  });
  const leavePanel = document.getElementById("leave-application-panel");
  bindListPagination(leavePanel, {
    pageSizeSelectId: "leave-page-size",
    prevId: "leave-page-prev",
    nextId: "leave-page-next",
    onPageSizeChange: (size) => {
      state.leaveListPageSize = size;
      state.leaveListPage = 1;
      state.leaveBatchSelectedIds = [];
      void fetchLeaveList();
    },
    onPrev: () => {
      if (state.leaveListPage > 1) {
        state.leaveListPage--;
        void fetchLeaveList();
      }
    },
    onNext: () => {
      const pageSize = Number(state.leaveListPageSize) || 10;
      const totalItems = Number(state.leaveListTotal) || 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      if (state.leaveListPage < totalPages) {
        state.leaveListPage++;
        void fetchLeaveList();
      }
    },
  });
  document.getElementById("leave-app-apply-btn")?.addEventListener("click", async () => {
    await fetchLeaveApproverWhitelist();
    resetLeaveCreateForm();
    state.leaveCreateOpen = true;
    requestRender();
  });
  document.getElementById("leave-app-whitelist-btn")?.addEventListener("click", async () => {
    await fetchLeaveApproverWhitelist();
    state.leaveWhitelistDraftAccounts = initLeaveWhitelistDraftFromItems(state.leaveApproverWhitelist);
    state.leaveWhitelistModalOpen = true;
    requestRender();
  });
  document.querySelectorAll(".leave-app-row").forEach((tr) => {
    tr.addEventListener("click", (ev) => {
      if (ev.target.closest?.(".leave-app-col-check")) return;
      const id = parseInt(tr.getAttribute("data-leave-app-id") || "-1", 10);
      if (id < 0) return;
      state.leaveDetailId = id;
      state.leaveDetailBundle = null;
      state.leaveDetailLoading = true;
      requestRender();
      void fetchLeaveDetail(id);
    });
  });
  document.getElementById("leave-app-create-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-app-create-mask")) {
      state.leaveCreateOpen = false;
      requestRender();
    }
  });
  document.getElementById("leave-create-cancel-btn")?.addEventListener("click", () => {
    state.leaveCreateOpen = false;
    requestRender();
  });
  document.getElementById("leave-app-add-seg-btn")?.addEventListener("click", () => {
    state.leaveCreateSegments.push({ key: state.leaveDraftSegKey++, start: "", end: "", reason: "" });
    requestRender();
  });
  const leaveSegTbody = document.getElementById("leave-app-seg-tbody");
  const onLeaveSegDatetimeInput = (ev) => {
    const t = ev.target;
    if (!t.matches?.('[data-leave-seg-field="start"]') && !t.matches?.('[data-leave-seg-field="end"]')) return;
    updateLeaveCreateSegmentDurationCells();
  };
  leaveSegTbody?.addEventListener("input", onLeaveSegDatetimeInput);
  leaveSegTbody?.addEventListener("change", onLeaveSegDatetimeInput);
  if (state.leaveCreateOpen) updateLeaveCreateSegmentDurationCells();
  document.querySelectorAll(".leave-app-seg-del").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const k = btn.getAttribute("data-leave-seg-key");
      if (!k || state.leaveCreateSegments.length <= 1) return;
      state.leaveCreateSegments = state.leaveCreateSegments.filter((s) => String(s.key) !== k);
      requestRender();
    });
  });
  document.getElementById("leave-create-type")?.addEventListener("change", () => {
    const el = document.getElementById("leave-create-type");
    state.leaveCreateType = (el?.value || "").trim();
  });
  document.getElementById("leave-create-approver")?.addEventListener("change", () => {
    const el = document.getElementById("leave-create-approver");
    state.leaveCreateApprover = (el?.value || "").trim();
  });
  document.getElementById("leave-create-cc")?.addEventListener("change", () => {
    const el = document.getElementById("leave-create-cc");
    state.leaveCreateCc = (el?.value || "").trim();
  });
  document.getElementById("leave-create-submit-btn")?.addEventListener("click", async () => {
    const typeEl = document.getElementById("leave-create-type");
    const apprEl = document.getElementById("leave-create-approver");
    const ccEl = document.getElementById("leave-create-cc");
    const application_type = (typeEl?.value || "").trim();
    const approver_account = (apprEl?.value || "").trim();
    const ccRaw = (ccEl?.value || "").trim();
    const cc_accounts = ccRaw
      ? ccRaw
          .split(/[,，\s]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
    if (!application_type) {
      window.alert("请选择申请类型");
      return;
    }
    if (!approver_account) {
      window.alert("请选择审批人");
      return;
    }
    const tbody = document.getElementById("leave-app-seg-tbody");
    const trs = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
    const segments = [];
    for (const tr of trs) {
      const start = tr.querySelector('[data-leave-seg-field="start"]')?.value || "";
      const end = tr.querySelector('[data-leave-seg-field="end"]')?.value || "";
      const reason = tr.querySelector('[data-leave-seg-field="reason"]')?.value || "";
      if (!start || !end) {
        window.alert("请填写每条时间段的开始与结束时间");
        return;
      }
      const s = new Date(start);
      const e = new Date(end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        window.alert("结束时间须晚于开始时间");
        return;
      }
      segments.push({ start_at: s.toISOString(), end_at: e.toISOString(), reason: reason.trim() });
    }
    if (!segments.length) {
      window.alert("至少保留一条时间段");
      return;
    }
    const op = getCurrentOperator();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/leave/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: op.account,
          application_type,
          segments,
          approver_account,
          cc_accounts,
        }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        window.alert(`提交失败：${resp.status} ${tx.slice(0, 240)}`);
        return;
      }
      state.leaveCreateOpen = false;
      await fetchLeaveList();
    } catch (e) {
      window.alert(`提交失败：${String(e.message || e)}`);
    }
  });
  document.getElementById("leave-app-detail-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-app-detail-mask")) {
      state.leaveDetailId = null;
      state.leaveDetailBundle = null;
      requestRender();
    }
  });
  document.getElementById("leave-detail-close-btn")?.addEventListener("click", () => {
    state.leaveDetailId = null;
    state.leaveDetailBundle = null;
    requestRender();
  });
  document.getElementById("leave-detail-delete-btn")?.addEventListener("click", async () => {
    const id = state.leaveDetailId;
    if (!id) return;
    if (!window.confirm("确定删除此申请？此操作不可恢复。")) return;
    const op = getCurrentOperator();
    try {
      const resp = await fetch(
        `${API_BASE_URL}/api/leave/applications/${id}?operator_id=${encodeURIComponent(op.account)}`,
        { method: "DELETE" }
      );
      if (!resp.ok) {
        const tx = await resp.text();
        window.alert(`删除失败：${resp.status} ${tx.slice(0, 240)}`);
        return;
      }
      state.leaveDetailId = null;
      state.leaveDetailBundle = null;
      state.leaveBatchSelectedIds = (state.leaveBatchSelectedIds || []).filter((x) => x !== id);
      await fetchLeaveList();
      await syncDutyRosterExtrasFromServer();
      requestRender();
    } catch (e) {
      window.alert(`删除失败：${String(e.message || e)}`);
    }
  });
  document.querySelectorAll("[data-leave-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-leave-action");
      const id = state.leaveDetailId;
      if (!id || !act) return;
      const ta = document.getElementById("leave-detail-comment");
      const comment = (ta?.value || "").trim();
      if (act === "reject" && !comment) {
        window.alert("拒绝时请填写审批意见");
        return;
      }
      const op = getCurrentOperator();
      try {
        const resp = await fetch(`${API_BASE_URL}/api/leave/applications/${id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operator_id: op.account,
            action: act,
            comment,
          }),
        });
        if (!resp.ok) {
          const tx = await resp.text();
          window.alert(`操作失败：${resp.status} ${tx.slice(0, 240)}`);
          return;
        }
        await fetchLeaveDetail(id);
        await fetchLeaveList();
        if (act === "agree") {
          await syncDutyRosterExtrasFromServer();
          requestRender();
        }
      } catch (e) {
        window.alert(`操作失败：${String(e.message || e)}`);
      }
    });
  });
  document.getElementById("leave-app-wl-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("leave-app-wl-mask")) {
      state.leaveWhitelistModalOpen = false;
      state.leaveWhitelistDraftAccounts = [];
      requestRender();
    }
  });
  document.getElementById("leave-wl-cancel-btn")?.addEventListener("click", () => {
    state.leaveWhitelistModalOpen = false;
    state.leaveWhitelistDraftAccounts = [];
    requestRender();
  });
  const leaveWlUserInput = document.getElementById("leave-wl-user-input");
  const leaveWlUserAccount = document.getElementById("leave-wl-user-account");
  const leaveWlUserList = document.getElementById("leave-wl-user-listbox");
  const leaveWlCombo = document.querySelector(".leave-app-wl-combo");
  const leaveWlModalInner = document.getElementById("leave-app-wl-mask")?.querySelector(".leave-app-modal");

  function closeLeaveWlUserSuggest() {
    if (leaveWlUserList) leaveWlUserList.hidden = true;
    leaveWlUserInput?.setAttribute("aria-expanded", "false");
  }

  function openLeaveWlUserSuggest(filterText) {
    if (!leaveWlUserInput || !leaveWlUserList || leaveWlUserInput.disabled) return;
    const filtered = filterLeaveWhitelistUsersForAdd(getDutySelectableUsers(), state.leaveWhitelistDraftAccounts, filterText);
    if (!String(filterText || "").trim()) {
      closeLeaveWlUserSuggest();
      return;
    }
    leaveWlUserList.innerHTML = renderDutyUserSuggestListHtml(filtered);
    leaveWlUserList.hidden = false;
    leaveWlUserInput.setAttribute("aria-expanded", "true");
  }

  leaveWlUserInput?.addEventListener("input", () => {
    if (leaveWlUserAccount) leaveWlUserAccount.value = "";
    openLeaveWlUserSuggest(leaveWlUserInput.value);
  });
  leaveWlUserInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeLeaveWlUserSuggest();
  });
  leaveWlUserList?.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li || !leaveWlUserAccount || !leaveWlUserInput) return;
    const acc = li.getAttribute("data-account") || "";
    leaveWlUserAccount.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    leaveWlUserInput.value = u ? dutyModalUserLabel(u) : acc;
    closeLeaveWlUserSuggest();
  });
  leaveWlModalInner?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (leaveWlCombo && leaveWlUserList && !leaveWlUserList.hidden && !leaveWlCombo.contains(ev.target)) {
      closeLeaveWlUserSuggest();
    }
  });

  function addLeaveWhitelistDraftAccount(acc) {
    const account = String(acc || "").trim();
    if (!account) return false;
    const pool = getDutySelectableUsers();
    if (!pool.some((u) => String(u.account || "") === account)) return false;
    const draft = state.leaveWhitelistDraftAccounts || [];
    if (draft.includes(account)) return false;
    state.leaveWhitelistDraftAccounts = [...draft, account];
    return true;
  }

  document.getElementById("leave-wl-add-btn")?.addEventListener("click", () => {
    let acc = (leaveWlUserAccount?.value || "").trim();
    if (!acc && leaveWlUserInput) {
      const q = (leaveWlUserInput.value || "").trim();
      const pool = filterLeaveWhitelistUsersForAdd(getDutySelectableUsers(), state.leaveWhitelistDraftAccounts, q);
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) acc = String(exact[0].account || "");
    }
    if (!acc) {
      window.alert("请先搜索并选择要添加的审批人");
      return;
    }
    if (!addLeaveWhitelistDraftAccount(acc)) {
      window.alert("该人员已在白名单中或不可用");
      return;
    }
    if (leaveWlUserAccount) leaveWlUserAccount.value = "";
    if (leaveWlUserInput) leaveWlUserInput.value = "";
    closeLeaveWlUserSuggest();
    requestRender();
  });
  document.querySelectorAll("[data-leave-wl-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const acc = btn.getAttribute("data-leave-wl-remove") || "";
      if (!acc) return;
      state.leaveWhitelistDraftAccounts = (state.leaveWhitelistDraftAccounts || []).filter((x) => x !== acc);
      requestRender();
    });
  });
  document.getElementById("leave-wl-save-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator();
    const accounts = [...(state.leaveWhitelistDraftAccounts || [])];
    try {
      const resp = await fetch(`${API_BASE_URL}/api/leave/approver-whitelist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: op.account, accounts }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        window.alert(`保存失败：${resp.status} ${tx.slice(0, 240)}`);
        return;
      }
      state.leaveWhitelistModalOpen = false;
      state.leaveWhitelistDraftAccounts = [];
      await fetchLeaveApproverWhitelist();
      requestRender();
    } catch (e) {
      window.alert(`保存失败：${String(e.message || e)}`);
    }
  });
}
