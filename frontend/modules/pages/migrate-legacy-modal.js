import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { syncTicketsFromServer } from "./ticket-core.js";

function filteredMigrateCandidates() {
  const q = String(state.migrateLegacySearch || "").trim().toLowerCase();
  const items = Array.isArray(state.migrateLegacyCandidates) ? state.migrateLegacyCandidates : [];
  if (!q) return items;
  return items.filter((it) => {
    const hay = [
      it.process_id,
      it.status,
      it.current_node,
      it.description,
      it.legacy_id != null ? String(it.legacy_id) : "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function selectableProcessIds(items) {
  return items.filter((it) => it.selectable && String(it.process_id || "").trim()).map((it) => String(it.process_id));
}

export function openMigrateLegacyModal() {
  state.migrateLegacyModalOpen = true;
  state.migrateLegacyCandidates = [];
  state.migrateLegacySelectedProcessIds = [];
  state.migrateLegacyCandidatesLoading = true;
  state.migrateLegacyCandidatesError = "";
  state.migrateLegacySearch = "";
  requestRender();
  void loadMigrateLegacyCandidates();
}

export function closeMigrateLegacyModal() {
  state.migrateLegacyModalOpen = false;
  state.migrateLegacyCandidatesLoading = false;
  state.migrateLegacySubmitting = false;
  requestRender();
}

export async function loadMigrateLegacyCandidates() {
  const operator = getCurrentOperator();
  state.migrateLegacyCandidatesLoading = true;
  state.migrateLegacyCandidatesError = "";
  requestRender();
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/tickets/migrate-legacy/candidates?operator_id=${encodeURIComponent(operator.account)}&limit=500`,
    );
    if (!resp.ok) {
      state.migrateLegacyCandidatesError = await parseApiError(resp);
      state.migrateLegacyCandidates = [];
      return;
    }
    const json = await resp.json();
    state.migrateLegacyCandidates = Array.isArray(json.items) ? json.items : [];
    state.migrateLegacySelectedProcessIds = selectableProcessIds(state.migrateLegacyCandidates);
  } catch (e) {
    state.migrateLegacyCandidatesError = e && e.message ? e.message : String(e);
    state.migrateLegacyCandidates = [];
  } finally {
    state.migrateLegacyCandidatesLoading = false;
    requestRender();
  }
}

function formatMigrateSummary(json) {
  const lines = [
    `迁入完成：新增 ${json.migrated || 0} 条`,
    `跳过（已迁入）${json.skipped_existing || 0} 条`,
    `跳过（已删除）${json.skipped_deleted || 0} 条`,
  ];
  if (json.skipped_not_found) lines.push(`未找到 ${json.skipped_not_found} 条`);
  if (json.failed) lines.push(`失败 ${json.failed} 条`);
  return lines.join("，");
}

function formatRepairSummary(json) {
  const lines = [
    `修复完成：更新 ${json.repaired || 0} 条`,
    `未变化 ${json.skipped_unchanged || 0} 条`,
  ];
  if (json.skipped_not_found) lines.push(`老库未找到 ${json.skipped_not_found} 条`);
  if (json.failed) lines.push(`失败 ${json.failed} 条`);
  if (json.processed) lines.push(`共处理 ${json.processed} 条`);
  return lines.join("，");
}

function mergeRepairSummary(totals, batch) {
  totals.repaired += Number(batch.repaired) || 0;
  totals.skipped_unchanged += Number(batch.skipped_unchanged) || 0;
  totals.skipped_not_found += Number(batch.skipped_not_found) || 0;
  totals.failed += Number(batch.failed) || 0;
  totals.processed += Number(batch.processed) || 0;
  const nos = Array.isArray(batch.ticket_nos) ? batch.ticket_nos : [];
  totals.ticket_nos.push(...nos);
}

const REPAIR_LEGACY_BATCH_SIZE = 100;

async function submitRepairLegacy(processIds) {
  if (state.migrateLegacySubmitting) return;
  const operator = getCurrentOperator();
  state.migrateLegacySubmitting = true;
  requestRender();
  const totals = {
    repaired: 0,
    skipped_unchanged: 0,
    skipped_not_found: 0,
    failed: 0,
    processed: 0,
    ticket_nos: [],
  };
  let afterLegacyInstanceId = 0;
  const repairAll = !Array.isArray(processIds) || processIds.length === 0;
  try {
    while (true) {
      const body = { operator_id: operator.account };
      if (Array.isArray(processIds) && processIds.length) {
        body.process_ids = processIds;
      } else {
        body.limit = REPAIR_LEGACY_BATCH_SIZE;
        body.after_legacy_instance_id = afterLegacyInstanceId;
      }
      const resp = await fetch(`${API_BASE_URL}/api/tickets/migrate-legacy/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let json = {};
      try {
        json = await resp.json();
      } catch (_) {
        json = {};
      }
      if (!resp.ok) {
        const detail =
          json && json.detail != null
            ? typeof json.detail === "string"
              ? json.detail
              : JSON.stringify(json.detail)
            : `HTTP ${resp.status}`;
        window.alert(`修复失败：${detail}`);
        return;
      }
      mergeRepairSummary(totals, json);
      if (!repairAll || !json.has_more) {
        break;
      }
      afterLegacyInstanceId = Number(json.next_after_legacy_instance_id) || afterLegacyInstanceId;
      if (!afterLegacyInstanceId) {
        break;
      }
    }
    window.alert(formatRepairSummary(totals));
    await loadMigrateLegacyCandidates();
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`修复失败：${e && e.message ? e.message : String(e)}`);
  } finally {
    state.migrateLegacySubmitting = false;
    requestRender();
  }
}

async function submitMigrateLegacy(processIds) {
  if (state.migrateLegacySubmitting) return;
  const operator = getCurrentOperator();
  state.migrateLegacySubmitting = true;
  requestRender();
  try {
    const body = { operator_id: operator.account };
    if (Array.isArray(processIds) && processIds.length) {
      body.process_ids = processIds;
    }
    const resp = await fetch(`${API_BASE_URL}/api/tickets/migrate-legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json = {};
    try {
      json = await resp.json();
    } catch (_) {
      json = {};
    }
    if (!resp.ok) {
      const detail =
        json && json.detail != null
          ? typeof json.detail === "string"
            ? json.detail
            : JSON.stringify(json.detail)
          : `HTTP ${resp.status}`;
      window.alert(`迁入失败：${detail}`);
      return;
    }
    closeMigrateLegacyModal();
    window.alert(formatMigrateSummary(json));
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`迁入失败：${e && e.message ? e.message : String(e)}`);
  } finally {
    state.migrateLegacySubmitting = false;
    requestRender();
  }
}

export function renderMigrateLegacyModalHtml() {
  if (!state.migrateLegacyModalOpen) return "";

  const loading = state.migrateLegacyCandidatesLoading;
  const err = String(state.migrateLegacyCandidatesError || "").trim();
  const submitting = state.migrateLegacySubmitting;
  const visible = filteredMigrateCandidates();
  const selectedSet = new Set(state.migrateLegacySelectedProcessIds || []);
  const selectableVisible = selectableProcessIds(visible);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((pid) => selectedSet.has(pid));

  const rowsHtml = loading
    ? '<tr><td colspan="5" class="migrate-legacy-empty">加载老库工单…</td></tr>'
    : err
      ? `<tr><td colspan="5" class="migrate-legacy-empty migrate-legacy-empty--error">${escapeHtml(err)}</td></tr>`
      : visible.length === 0
        ? '<tr><td colspan="5" class="migrate-legacy-empty">老库无匹配工单</td></tr>'
        : visible
            .map((it) => {
              const pid = String(it.process_id || "").trim();
              const checked = pid && selectedSet.has(pid) ? "checked" : "";
              const disabled = !it.selectable || !pid || submitting ? "disabled" : "";
              const flags = [
                it.migrated ? "已迁入" : "",
                it.is_deleted ? "已删除" : "",
                !pid ? "无流程ID" : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return `<tr class="${it.selectable ? "" : "migrate-legacy-row--disabled"}">
                <td><input type="checkbox" data-migrate-pid="${escapeAttr(pid)}" ${checked} ${disabled} /></td>
                <td>${escapeHtml(pid || "—")}</td>
                <td>${escapeHtml(String(it.status || ""))}</td>
                <td>${escapeHtml(String(it.current_node || ""))}</td>
                <td title="${escapeAttr(String(it.description || ""))}">${escapeHtml(String(it.description || ""))}${flags ? `<span class="migrate-legacy-flag">${escapeHtml(flags)}</span>` : ""}</td>
              </tr>`;
            })
            .join("");

  return `
    <div class="perm-modal-mask migrate-legacy-modal-mask" id="migrate-legacy-modal-mask" role="dialog" aria-modal="true">
      <div class="perm-modal migrate-legacy-modal">
        <div class="perm-modal-head">
          <h3>历史数据迁入</h3>
        </div>
        <div class="perm-modal-body migrate-legacy-body">
          <div class="migrate-legacy-toolbar">
            <input type="search" class="migrate-legacy-search" id="migrate-legacy-search" placeholder="搜索流程 ID / 描述" value="${escapeAttr(state.migrateLegacySearch || "")}" ${submitting ? "disabled" : ""} />
            <label class="migrate-legacy-select-all">
              <input type="checkbox" id="migrate-legacy-select-all" ${allVisibleSelected ? "checked" : ""} ${selectableVisible.length === 0 || submitting ? "disabled" : ""} />
              全选当前列表
            </label>
          </div>
          <div class="migrate-legacy-table-wrap">
            <table class="migrate-legacy-table">
              <thead>
                <tr>
                  <th></th>
                  <th>流程 ID</th>
                  <th>状态</th>
                  <th>当前节点</th>
                  <th>描述</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
        <div class="perm-modal-foot migrate-legacy-foot">
          <button type="button" class="action" id="migrate-legacy-cancel-btn" ${submitting ? "disabled" : ""}>取消</button>
          <button type="button" class="action" id="migrate-legacy-repair-all-btn" ${loading || submitting ? "disabled" : ""}>修复全部已迁</button>
          <button type="button" class="action" id="migrate-legacy-repair-selected-btn" ${loading || submitting || selectedSet.size === 0 ? "disabled" : ""}>修复所选（${selectedSet.size}）</button>
          <button type="button" class="action" id="migrate-legacy-all-btn" ${loading || submitting ? "disabled" : ""}>迁入全部</button>
          <button type="button" class="action primary" id="migrate-legacy-selected-btn" ${loading || submitting || selectedSet.size === 0 ? "disabled" : ""}>迁入所选（${selectedSet.size}）</button>
        </div>
      </div>
    </div>
  `;
}

export function bindMigrateLegacyModal() {
  const mask = document.getElementById("migrate-legacy-modal-mask");
  if (!mask) return;

  mask.addEventListener("click", (ev) => {
    if (ev.target === mask && !state.migrateLegacySubmitting) closeMigrateLegacyModal();
  });

  document.getElementById("migrate-legacy-cancel-btn")?.addEventListener("click", () => {
    if (!state.migrateLegacySubmitting) closeMigrateLegacyModal();
  });

  document.getElementById("migrate-legacy-search")?.addEventListener("input", (ev) => {
    state.migrateLegacySearch = ev.target instanceof HTMLInputElement ? ev.target.value : "";
    requestRender();
  });

  document.getElementById("migrate-legacy-select-all")?.addEventListener("change", (ev) => {
    const checked = ev.target instanceof HTMLInputElement && ev.target.checked;
    const visible = filteredMigrateCandidates();
    const pids = selectableProcessIds(visible);
    const set = new Set(state.migrateLegacySelectedProcessIds || []);
    if (checked) {
      pids.forEach((pid) => set.add(pid));
    } else {
      pids.forEach((pid) => set.delete(pid));
    }
    state.migrateLegacySelectedProcessIds = [...set];
    requestRender();
  });

  mask.querySelectorAll("[data-migrate-pid]").forEach((el) => {
    el.addEventListener("change", () => {
      if (!(el instanceof HTMLInputElement)) return;
      const pid = String(el.getAttribute("data-migrate-pid") || "").trim();
      if (!pid) return;
      const set = new Set(state.migrateLegacySelectedProcessIds || []);
      if (el.checked) set.add(pid);
      else set.delete(pid);
      state.migrateLegacySelectedProcessIds = [...set];
      requestRender();
    });
  });

  document.getElementById("migrate-legacy-all-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    if (
      !window.confirm(
        "确认迁入老库全部工单？\n重复迁入会自动跳过已迁工单；逻辑删除的单据会跳过。",
      )
    ) {
      return;
    }
    void submitMigrateLegacy(null);
  });

  document.getElementById("migrate-legacy-selected-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    const ids = [...new Set(state.migrateLegacySelectedProcessIds || [])].filter(Boolean);
    if (!ids.length) {
      window.alert("请先选择要迁入的流程 ID");
      return;
    }
    if (!window.confirm(`确认迁入所选 ${ids.length} 条工单？\n${ids.slice(0, 8).join("\n")}${ids.length > 8 ? "\n…" : ""}`)) {
      return;
    }
    void submitMigrateLegacy(ids);
  });

  document.getElementById("migrate-legacy-repair-all-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    if (
      !window.confirm(
        "确认修复全部已迁工单？\n将按老库 process_id、status、当前节点更新流程 ID 与列表当前阶段（不重建节点数据）。",
      )
    ) {
      return;
    }
    void submitRepairLegacy(null);
  });

  document.getElementById("migrate-legacy-repair-selected-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    const ids = [...new Set(state.migrateLegacySelectedProcessIds || [])].filter(Boolean);
    if (!ids.length) {
      window.alert("请先选择要修复的流程 ID");
      return;
    }
    if (
      !window.confirm(
        `确认修复所选 ${ids.length} 条已迁工单？\n${ids.slice(0, 8).join("\n")}${ids.length > 8 ? "\n…" : ""}`,
      )
    ) {
      return;
    }
    void submitRepairLegacy(ids);
  });
}
