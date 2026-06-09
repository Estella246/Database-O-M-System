import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { syncTicketsFromServer } from "./ticket-core.js";

const MIGRATE_LEGACY_FAILURES_LS_KEY = "migrate_legacy_last_failures_v1";
const REPAIR_LEGACY_BATCH_SIZE = 100;
const REPAIR_LAST_FAIL_TIMEOUT_MS = 60_000;
const REPAIR_LAST_FAIL_BATCH_SIZE = 40;

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

function normalizeFailureItems(items) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const pid = String(it?.process_id || it?.ticket_no || "").trim();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push({
      process_id: pid,
      action: it?.action === "migrate" ? "migrate" : "repair",
      error: String(it?.error || ""),
    });
  }
  return out;
}

function loadStoredMigrateLegacyFailures() {
  try {
    const raw = localStorage.getItem(MIGRATE_LEGACY_FAILURES_LS_KEY);
    if (!raw) return [];
    return normalizeFailureItems(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

function saveStoredMigrateLegacyFailures(items) {
  const normalized = normalizeFailureItems(items);
  state.migrateLegacyLastFailures = normalized;
  try {
    if (normalized.length) {
      localStorage.setItem(MIGRATE_LEGACY_FAILURES_LS_KEY, JSON.stringify(normalized));
    } else {
      localStorage.removeItem(MIGRATE_LEGACY_FAILURES_LS_KEY);
    }
  } catch (_) {
    /* ignore quota */
  }
}

function failuresFromApiErrors(errors, defaultAction) {
  const items = [];
  for (const e of Array.isArray(errors) ? errors : []) {
    const pid = String(e?.process_id || e?.ticket_no || "").trim();
    if (!pid) continue;
    items.push({
      process_id: pid,
      action: e?.action === "migrate" ? "migrate" : defaultAction,
      error: String(e?.error || ""),
    });
  }
  return normalizeFailureItems(items);
}

function recordMigrateLegacyFailures(errors, defaultAction) {
  const incoming = failuresFromApiErrors(errors, defaultAction);
  if (!incoming.length) return;
  saveStoredMigrateLegacyFailures(incoming);
}

function syncMigrateLegacyFailuresFromStorage() {
  state.migrateLegacyLastFailures = loadStoredMigrateLegacyFailures();
}

export function openMigrateLegacyModal() {
  state.migrateLegacyModalOpen = true;
  state.migrateLegacyCandidates = [];
  state.migrateLegacySelectedProcessIds = [];
  state.migrateLegacyCandidatesLoading = true;
  state.migrateLegacyCandidatesError = "";
  state.migrateLegacySearch = "";
  syncMigrateLegacyFailuresFromStorage();
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
  if (Array.isArray(batch.errors)) {
    totals.errors.push(...batch.errors);
  }
}

async function parseJsonResponse(resp) {
  let json = {};
  try {
    json = await resp.json();
  } catch (_) {
    json = {};
  }
  return json;
}

function responseDetail(json, resp) {
  if (json && json.detail != null) {
    return typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail);
  }
  return `HTTP ${resp.status}`;
}

async function postRepairLegacy(body) {
  const resp = await fetch(`${API_BASE_URL}/api/tickets/migrate-legacy/repair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJsonResponse(resp);
  return { ok: resp.ok, json, detail: responseDetail(json, resp) };
}

async function postMigrateLegacy(body) {
  const resp = await fetch(`${API_BASE_URL}/api/tickets/migrate-legacy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJsonResponse(resp);
  return { ok: resp.ok, json, detail: responseDetail(json, resp) };
}

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
    errors: [],
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
      const result = await postRepairLegacy(body);
      if (!result.ok) {
        window.alert(`修复失败：${result.detail}`);
        return;
      }
      mergeRepairSummary(totals, result.json);
      if (!repairAll || !result.json.has_more) {
        break;
      }
      afterLegacyInstanceId = Number(result.json.next_after_legacy_instance_id) || afterLegacyInstanceId;
      if (!afterLegacyInstanceId) {
        break;
      }
    }
    if (totals.errors.length) {
      recordMigrateLegacyFailures(totals.errors, "repair");
    } else if (!totals.failed) {
      saveStoredMigrateLegacyFailures([]);
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
    const result = await postMigrateLegacy(body);
    if (!result.ok) {
      window.alert(`迁入失败：${result.detail}`);
      return;
    }
    if (Array.isArray(result.json.errors) && result.json.errors.length) {
      recordMigrateLegacyFailures(result.json.errors, "migrate");
    } else if (!result.json.failed) {
      saveStoredMigrateLegacyFailures([]);
    }
    closeMigrateLegacyModal();
    window.alert(formatMigrateSummary(result.json));
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`迁入失败：${e && e.message ? e.message : String(e)}`);
  } finally {
    state.migrateLegacySubmitting = false;
    requestRender();
  }
}

function applyBatchFailuresToPending(pending, batch, failedItems, action) {
  const failedSet = new Set(failedItems.map((x) => x.process_id));
  const kept = pending.filter((item) => {
    if (item.action !== action) return true;
    if (!batch.includes(item.process_id)) return true;
    return failedSet.has(item.process_id);
  });
  return normalizeFailureItems([...kept, ...failedItems]);
}

async function submitRepairLastFailures() {
  if (state.migrateLegacySubmitting) return;
  syncMigrateLegacyFailuresFromStorage();
  let pending = [...state.migrateLegacyLastFailures];
  if (!pending.length) {
    window.alert("无上次失败记录");
    return;
  }
  if (
    !window.confirm(
      `将在 1 分钟内循环重试上次失败的 ${pending.length} 条工单（修复/迁入），是否继续？`,
    )
  ) {
    return;
  }

  const operator = getCurrentOperator();
  state.migrateLegacySubmitting = true;
  requestRender();
  const deadline = Date.now() + REPAIR_LAST_FAIL_TIMEOUT_MS;
  const totals = { repaired: 0, migrated: 0, rounds: 0, timedOut: false };

  try {
    while (Date.now() < deadline && pending.length) {
      const repairIds = pending.filter((x) => x.action === "repair").map((x) => x.process_id);
      const migrateIds = pending.filter((x) => x.action === "migrate").map((x) => x.process_id);

      if (repairIds.length) {
        const batch = repairIds.slice(0, REPAIR_LAST_FAIL_BATCH_SIZE);
        const result = await postRepairLegacy({ operator_id: operator.account, process_ids: batch });
        totals.rounds += 1;
        if (!result.ok) {
          window.alert(`修复失败：${result.detail}`);
          break;
        }
        totals.repaired += Number(result.json.repaired) || 0;
        const failed = failuresFromApiErrors(result.json.errors, "repair");
        pending = applyBatchFailuresToPending(pending, batch, failed, "repair");
      } else if (migrateIds.length) {
        const batch = migrateIds.slice(0, REPAIR_LAST_FAIL_BATCH_SIZE);
        const result = await postMigrateLegacy({ operator_id: operator.account, process_ids: batch });
        totals.rounds += 1;
        if (!result.ok) {
          window.alert(`迁入失败：${result.detail}`);
          break;
        }
        totals.migrated += Number(result.json.migrated) || 0;
        const failed = failuresFromApiErrors(result.json.errors, "migrate");
        pending = applyBatchFailuresToPending(pending, batch, failed, "migrate");
      } else {
        break;
      }

      if (Date.now() >= deadline) {
        totals.timedOut = true;
        break;
      }
    }

    if (Date.now() >= deadline && pending.length) {
      totals.timedOut = true;
    }
    saveStoredMigrateLegacyFailures(pending);

    const lines = [
      `本轮修复 ${totals.repaired} 条`,
      totals.migrated ? `迁入 ${totals.migrated} 条` : "",
      pending.length ? `仍失败 ${pending.length} 条（已保存，可再次点击重试）` : "失败项已全部处理",
      totals.timedOut ? "已达 1 分钟时限" : "",
    ].filter(Boolean);
    window.alert(lines.join("，"));
    await loadMigrateLegacyCandidates();
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`重试失败：${e && e.message ? e.message : String(e)}`);
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
  const lastFailCount = Array.isArray(state.migrateLegacyLastFailures)
    ? state.migrateLegacyLastFailures.length
    : 0;

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
          <button type="button" class="action" id="migrate-legacy-repair-last-btn" ${loading || submitting || lastFailCount === 0 ? "disabled" : ""}>修复上次失败（${lastFailCount}）</button>
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

  document.getElementById("migrate-legacy-repair-last-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    void submitRepairLastFailures();
  });
}
