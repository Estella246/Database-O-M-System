import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, fetchPostJsonLongRunning, parseApiError } from "../services/api.js";
import { syncTicketsFromServer, clearTicketFormCache } from "./ticket-core.js";

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
  state.migrateLegacyProgress = "";
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
  if (json.processed) lines.push(`共处理 ${json.processed} 条`);
  const errors = Array.isArray(json.errors) ? json.errors : [];
  if (errors.length) {
    const sample = errors
      .slice(0, 3)
      .map((e) => `${e.legacy_id || "?"}：${e.error || "未知错误"}`)
      .join("\n");
    lines.push(`失败原因：\n${sample}${errors.length > 3 ? "\n…" : ""}`);
  }
  return lines.join("，");
}

function mergeMigrateSummary(totals, batch) {
  totals.migrated += Number(batch.migrated) || 0;
  totals.skipped_existing += Number(batch.skipped_existing) || 0;
  totals.skipped_deleted += Number(batch.skipped_deleted) || 0;
  totals.skipped_not_found += Number(batch.skipped_not_found) || 0;
  totals.failed += Number(batch.failed) || 0;
  totals.processed += Number(batch.processed) || 0;
  const nos = Array.isArray(batch.ticket_nos) ? batch.ticket_nos : [];
  totals.ticket_nos.push(...nos);
  const errs = Array.isArray(batch.errors) ? batch.errors : [];
  totals.errors.push(...errs);
}

const MIGRATE_LEGACY_BATCH_SIZE = 50;
const MIGRATE_PROCESS_IDS_CHUNK = 50;

async function postMigrateLegacy(body) {
  return fetchPostJsonLongRunning(`${API_BASE_URL}/api/tickets/migrate-legacy`, body);
}

async function refreshMigrateLegacySnapshot(operatorAccount) {
  await postMigrateLegacy({
    operator_id: operatorAccount,
    batch_size: 1,
    max_total: 0,
    after_legacy_instance_id: 0,
    refresh_snapshot: true,
  });
}

function formatRepairSummary(json, { rebuildWorkflow = false, backfillFields = false } = {}) {
  const lines = [
    backfillFields
      ? `补全字段完成：${json.repaired || 0} 条（写入 ${json.fields_backfilled || 0} 条）`
      : rebuildWorkflow
        ? `重建流转完成：${json.repaired || 0} 条`
        : `修复完成：更新 ${json.repaired || 0} 条`,
    `未变化 ${json.skipped_unchanged || 0} 条`,
  ];
  if (json.ticket_no_displaced) {
    lines.push(`挪占号工单 ${json.ticket_no_displaced} 条（已按老库 process_id 让位）`);
  }
  if (json.skipped_not_found) lines.push(`老库未找到 ${json.skipped_not_found} 条`);
  if (json.failed) lines.push(`失败 ${json.failed} 条`);
  if (json.processed) lines.push(`共处理 ${json.processed} 条`);
  const errors = Array.isArray(json.errors) ? json.errors : [];
  if (errors.length) {
    const sample = errors
      .slice(0, 3)
      .map((e) => `${e.ticket_no || e.process_id || e.legacy_id || "?"}：${e.error || "未知错误"}`)
      .join("\n");
    lines.push(`失败原因：\n${sample}${errors.length > 3 ? "\n…" : ""}`);
  }
  return lines.join("，");
}

function mergeRepairSummary(totals, batch) {
  totals.repaired += Number(batch.repaired) || 0;
  totals.skipped_unchanged += Number(batch.skipped_unchanged) || 0;
  totals.skipped_not_found += Number(batch.skipped_not_found) || 0;
  totals.failed += Number(batch.failed) || 0;
  totals.processed += Number(batch.processed) || 0;
  totals.ticket_no_displaced += Number(batch.ticket_no_displaced) || 0;
  totals.fields_backfilled = (Number(totals.fields_backfilled) || 0) + (Number(batch.fields_backfilled) || 0);
  const nos = Array.isArray(batch.ticket_nos) ? batch.ticket_nos : [];
  totals.ticket_nos.push(...nos);
  const errs = Array.isArray(batch.errors) ? batch.errors : [];
  totals.errors.push(...errs);
}

const REPAIR_LEGACY_BATCH_SIZE = 100;
const DELETE_LEGACY_BATCH_SIZE = 100;

function selectedMigratedProcessIds(items) {
  const selected = new Set(state.migrateLegacySelectedProcessIds || []);
  return items
    .filter((it) => {
      const pid = String(it.process_id || "").trim();
      return it.migrated && it.selectable && pid && selected.has(pid);
    })
    .map((it) => String(it.process_id).trim());
}

async function submitRepairLegacy(processIds, { rebuildWorkflow = false, backfillFields = false } = {}) {
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
    ticket_no_displaced: 0,
    fields_backfilled: 0,
    ticket_nos: [],
    errors: [],
  };
  let afterLegacyInstanceId = 0;
  const repairAll = !Array.isArray(processIds) || processIds.length === 0;
  const actionLabel = backfillFields ? "补全字段" : rebuildWorkflow ? "重建流转" : "修复";
  console.info("[migrate-legacy-repair] start", {
    repairAll,
    rebuildWorkflow,
    backfillFields,
    processIds: repairAll ? "all" : processIds,
    batchSize: REPAIR_LEGACY_BATCH_SIZE,
  });
  try {
    while (true) {
      const body = {
        operator_id: operator.account,
        rebuild_workflow: rebuildWorkflow,
        backfill_fields_from_legacy: backfillFields,
      };
      if (backfillFields && repairAll) {
        body.backfill_placeholder_only = true;
      }
      if (Array.isArray(processIds) && processIds.length) {
        body.process_ids = processIds;
      } else {
        body.limit = REPAIR_LEGACY_BATCH_SIZE;
        body.after_legacy_instance_id = afterLegacyInstanceId;
      }
      const json = await fetchPostJsonLongRunning(`${API_BASE_URL}/api/tickets/migrate-legacy/repair`, body);
      mergeRepairSummary(totals, json);
      console.info("[migrate-legacy-repair] batch", {
        rebuildWorkflow,
        backfillFields,
        processed: json.processed,
        repaired: json.repaired,
        failed: json.failed,
        hasMore: json.has_more,
        nextAfter: json.next_after_legacy_instance_id,
      });
      if (!repairAll || !json.has_more) {
        break;
      }
      afterLegacyInstanceId = Number(json.next_after_legacy_instance_id) || afterLegacyInstanceId;
      if (!afterLegacyInstanceId) {
        break;
      }
    }
    console.info("[migrate-legacy-repair] done", { rebuildWorkflow, backfillFields, totals });
    if (rebuildWorkflow || backfillFields) {
      const repairedNos = Array.isArray(totals.ticket_nos) ? totals.ticket_nos : [];
      repairedNos.forEach((no) => clearTicketFormCache(String(no || "").trim()));
    }
    window.alert(formatRepairSummary(totals, { rebuildWorkflow, backfillFields }));
    await loadMigrateLegacyCandidates();
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`${actionLabel}失败：${e && e.message ? e.message : String(e)}`);
  } finally {
    state.migrateLegacySubmitting = false;
    requestRender();
  }
}

function formatDeleteMigratedSummary(json) {
  const lines = [`已删除 ${json.deleted || 0} 条迁入工单`];
  if (json.skipped_not_found) lines.push(`未找到（非已迁）${json.skipped_not_found} 条`);
  if (json.processed) lines.push(`共处理 ${json.processed} 条`);
  return lines.join("，");
}

function mergeDeleteMigratedSummary(totals, batch) {
  totals.deleted += Number(batch.deleted) || 0;
  totals.skipped_not_found += Number(batch.skipped_not_found) || 0;
  totals.processed += Number(batch.processed) || 0;
  const nos = Array.isArray(batch.ticket_nos) ? batch.ticket_nos : [];
  totals.ticket_nos.push(...nos);
}

async function submitDeleteMigrated(processIds) {
  if (state.migrateLegacySubmitting) return;
  const operator = getCurrentOperator();
  state.migrateLegacySubmitting = true;
  requestRender();
  const totals = {
    deleted: 0,
    skipped_not_found: 0,
    processed: 0,
    ticket_nos: [],
  };
  const deleteAll = !Array.isArray(processIds) || processIds.length === 0;
  let afterLegacyInstanceId = 0;
  let needsSnapshot = false;
  console.info("[migrate-legacy-delete] start", {
    deleteAll,
    processIds: deleteAll ? "all" : processIds,
    batchSize: DELETE_LEGACY_BATCH_SIZE,
  });
  try {
    while (true) {
      const body = {
        operator_id: operator.account,
        refresh_snapshot: false,
      };
      if (Array.isArray(processIds) && processIds.length) {
        body.process_ids = processIds;
      } else {
        body.limit = DELETE_LEGACY_BATCH_SIZE;
        body.after_legacy_instance_id = afterLegacyInstanceId;
      }
      const json = await fetchPostJsonLongRunning(
        `${API_BASE_URL}/api/tickets/migrate-legacy/delete-migrated`,
        body,
      );
      mergeDeleteMigratedSummary(totals, json);
      if (json.deleted) needsSnapshot = true;
      console.info("[migrate-legacy-delete] batch", {
        deleted: json.deleted,
        hasMore: json.has_more,
        nextAfter: json.next_after_legacy_instance_id,
      });
      if (!deleteAll || !json.has_more) {
        break;
      }
      afterLegacyInstanceId = Number(json.next_after_legacy_instance_id) || afterLegacyInstanceId;
      if (!afterLegacyInstanceId) {
        break;
      }
    }
    if (needsSnapshot) {
      console.info("[migrate-legacy-delete] snapshot refresh start");
      await refreshMigrateLegacySnapshot(operator.account);
      console.info("[migrate-legacy-delete] snapshot refresh done");
    }
    const deletedNos = Array.isArray(totals.ticket_nos) ? totals.ticket_nos : [];
    deletedNos.forEach((no) => clearTicketFormCache(String(no || "").trim()));
    console.info("[migrate-legacy-delete] done", totals);
    window.alert(formatDeleteMigratedSummary(totals));
    await loadMigrateLegacyCandidates();
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`删除失败：${e && e.message ? e.message : String(e)}`);
  } finally {
    state.migrateLegacySubmitting = false;
    requestRender();
  }
}

async function submitMigrateLegacy(processIds) {
  if (state.migrateLegacySubmitting) return;
  const operator = getCurrentOperator();
  state.migrateLegacySubmitting = true;
  state.migrateLegacyProgress = "准备迁入…";
  requestRender();
  const totals = {
    migrated: 0,
    skipped_existing: 0,
    skipped_deleted: 0,
    skipped_not_found: 0,
    failed: 0,
    processed: 0,
    ticket_nos: [],
    errors: [],
  };
  const migrateAll = !Array.isArray(processIds) || processIds.length === 0;
  let needsSnapshot = false;
  console.info("[migrate-legacy] start", {
    migrateAll,
    batchSize: MIGRATE_LEGACY_BATCH_SIZE,
    processIds: migrateAll ? "all" : processIds,
  });
  try {
    if (migrateAll) {
      let afterLegacyInstanceId = 0;
      while (true) {
        state.migrateLegacyProgress = `迁入中… 已处理 ${totals.processed} 条`;
        requestRender();
        const json = await postMigrateLegacy({
          operator_id: operator.account,
          batch_size: MIGRATE_LEGACY_BATCH_SIZE,
          max_total: MIGRATE_LEGACY_BATCH_SIZE,
          after_legacy_instance_id: afterLegacyInstanceId,
          refresh_snapshot: false,
        });
        mergeMigrateSummary(totals, json);
        if (json.migrated) needsSnapshot = true;
        console.info("[migrate-legacy] batch", {
          processed: json.processed,
          migrated: json.migrated,
          failed: json.failed,
          hasMore: json.has_more,
          nextAfter: json.next_after_legacy_instance_id,
        });
        if (!json.has_more) break;
        afterLegacyInstanceId = Number(json.next_after_legacy_instance_id) || afterLegacyInstanceId;
        if (!afterLegacyInstanceId) break;
      }
    } else {
      const ids = [...new Set(processIds)].filter(Boolean);
      for (let i = 0; i < ids.length; i += MIGRATE_PROCESS_IDS_CHUNK) {
        const chunk = ids.slice(i, i + MIGRATE_PROCESS_IDS_CHUNK);
        const isLast = i + MIGRATE_PROCESS_IDS_CHUNK >= ids.length;
        state.migrateLegacyProgress = `迁入中… ${Math.min(i + chunk.length, ids.length)}/${ids.length}`;
        requestRender();
        const json = await postMigrateLegacy({
          operator_id: operator.account,
          process_ids: chunk,
          refresh_snapshot: false,
        });
        mergeMigrateSummary(totals, json);
        if (json.migrated) needsSnapshot = true;
        console.info("[migrate-legacy] chunk", {
          chunkSize: chunk.length,
          processed: json.processed,
          migrated: json.migrated,
          failed: json.failed,
          isLast,
        });
      }
    }
    if (needsSnapshot) {
      state.migrateLegacyProgress = "重建列表快照…";
      requestRender();
      console.info("[migrate-legacy] snapshot refresh start");
      await refreshMigrateLegacySnapshot(operator.account);
      console.info("[migrate-legacy] snapshot refresh done");
    }
    console.info("[migrate-legacy] done", totals);
    closeMigrateLegacyModal();
    window.alert(formatMigrateSummary(totals));
    await syncTicketsFromServer();
  } catch (e) {
    window.alert(`迁入失败：${e && e.message ? e.message : String(e)}`);
  } finally {
    state.migrateLegacySubmitting = false;
    state.migrateLegacyProgress = "";
    requestRender();
  }
}

export function renderMigrateLegacyModalHtml() {
  if (!state.migrateLegacyModalOpen) return "";

  const loading = state.migrateLegacyCandidatesLoading;
  const err = String(state.migrateLegacyCandidatesError || "").trim();
  const submitting = state.migrateLegacySubmitting;
  const progress = String(state.migrateLegacyProgress || "").trim();
  const visible = filteredMigrateCandidates();
  const selectedSet = new Set(state.migrateLegacySelectedProcessIds || []);
  const selectableVisible = selectableProcessIds(visible);
  const selectedRepairIds = selectedMigratedProcessIds(visible);
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
          <p class="migrate-legacy-repair-hint"><strong>修复已迁</strong>：仅校正流程 ID、状态、当前节点。<strong>重建流转</strong>：按老库重建节点与流转日志。<strong>补全占位描述</strong>：从老库回填「Order YW…」占位单的问题描述与各节点空字段（不删流转日志）。迁入全部按每批 ${MIGRATE_LEGACY_BATCH_SIZE} 条提交，单批最长等待 5 分钟。</p>
          ${progress ? `<p class="migrate-legacy-repair-hint migrate-legacy-progress">${escapeHtml(progress)}</p>` : ""}
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
          <div class="migrate-legacy-foot-group migrate-legacy-foot-group--repair">
            <span class="migrate-legacy-foot-label">修复已迁</span>
            <button type="button" class="action" id="migrate-legacy-repair-selected-btn" ${loading || submitting || selectedRepairIds.length === 0 ? "disabled" : ""} title="校正所选已迁工单的流程 ID、状态与当前节点">修复所选（${selectedRepairIds.length}）</button>
            <button type="button" class="action" id="migrate-legacy-repair-all-btn" ${loading || submitting ? "disabled" : ""} title="分批校正全部已迁工单的流程 ID、状态与当前节点">修复全部已迁</button>
            <button type="button" class="action" id="migrate-legacy-rebuild-selected-btn" ${loading || submitting || selectedRepairIds.length === 0 ? "disabled" : ""} title="按老库重建所选已迁工单的节点实例与流转日志">重建流转（${selectedRepairIds.length}）</button>
            <button type="button" class="action" id="migrate-legacy-rebuild-all-btn" ${loading || submitting ? "disabled" : ""} title="分批按老库重建全部已迁工单的流转">重建全部流转</button>
            <button type="button" class="action" id="migrate-legacy-backfill-selected-btn" ${loading || submitting || selectedRepairIds.length === 0 ? "disabled" : ""} title="从老库补全所选工单占位描述与空字段">补全占位描述（${selectedRepairIds.length}）</button>
            <button type="button" class="action" id="migrate-legacy-backfill-all-btn" ${loading || submitting ? "disabled" : ""} title="分批补全全部 title 为 Order YW… 的已迁工单">补全全部占位描述</button>
            <button type="button" class="action danger" id="migrate-legacy-delete-selected-btn" ${loading || submitting || selectedRepairIds.length === 0 ? "disabled" : ""} title="从数据库删除所选已迁工单">删除已迁（${selectedRepairIds.length}）</button>
            <button type="button" class="action danger" id="migrate-legacy-delete-all-btn" ${loading || submitting ? "disabled" : ""} title="分批删除全部已迁工单（legacy_instance_id 非空）">删除全部已迁</button>
          </div>
          <div class="migrate-legacy-foot-group migrate-legacy-foot-group--migrate">
            <button type="button" class="action" id="migrate-legacy-cancel-btn" ${submitting ? "disabled" : ""}>取消</button>
            <button type="button" class="action" id="migrate-legacy-all-btn" ${loading || submitting ? "disabled" : ""}>迁入全部</button>
            <button type="button" class="action primary" id="migrate-legacy-selected-btn" ${loading || submitting || selectedSet.size === 0 ? "disabled" : ""}>迁入所选（${selectedSet.size}）</button>
          </div>
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
        "确认迁入老库全部工单？\n重复迁入会自动跳过已迁工单；逻辑删除的单据会跳过。\n将按每批 50 条分批提交，全部完成后重建列表快照。",
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
        "确认修复全部已迁工单？\n仅按老库校正流程 ID、status、当前节点并刷新列表快照，不重建流转日志。",
      )
    ) {
      return;
    }
    void submitRepairLegacy(null, { rebuildWorkflow: false });
  });

  document.getElementById("migrate-legacy-repair-selected-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    const visible = filteredMigrateCandidates();
    const ids = selectedMigratedProcessIds(visible);
    if (!ids.length) {
      window.alert("请先勾选列表中已迁入的流程 ID（未迁入的工单无需修复）");
      return;
    }
    if (
      !window.confirm(
        `确认修复所选 ${ids.length} 条已迁工单？\n仅校正流程 ID、状态与当前节点。\n${ids.slice(0, 8).join("\n")}${ids.length > 8 ? "\n…" : ""}`,
      )
    ) {
      return;
    }
    void submitRepairLegacy(ids, { rebuildWorkflow: false });
  });

  document.getElementById("migrate-legacy-rebuild-all-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    if (
      !window.confirm(
        "确认重建全部已迁工单的流转？\n将按老库 task 重建节点实例与流转日志，并校正流程 ID、状态与当前节点。",
      )
    ) {
      return;
    }
    void submitRepairLegacy(null, { rebuildWorkflow: true });
  });

  document.getElementById("migrate-legacy-rebuild-selected-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    const visible = filteredMigrateCandidates();
    const ids = selectedMigratedProcessIds(visible);
    if (!ids.length) {
      window.alert("请先勾选列表中已迁入的流程 ID");
      return;
    }
    if (
      !window.confirm(
        `确认重建所选 ${ids.length} 条已迁工单的流转？\n${ids.slice(0, 8).join("\n")}${ids.length > 8 ? "\n…" : ""}`,
      )
    ) {
      return;
    }
    void submitRepairLegacy(ids, { rebuildWorkflow: true });
  });

  document.getElementById("migrate-legacy-backfill-all-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    if (
      !window.confirm(
        "确认补全全部占位描述工单？\n仅处理 title 为「Order YW…」的已迁工单，从老库回填问题描述与各节点空字段，不删除流转日志。",
      )
    ) {
      return;
    }
    void submitRepairLegacy(null, { backfillFields: true });
  });

  document.getElementById("migrate-legacy-backfill-selected-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    const visible = filteredMigrateCandidates();
    const ids = selectedMigratedProcessIds(visible);
    if (!ids.length) {
      window.alert("请先勾选列表中已迁入的流程 ID");
      return;
    }
    if (
      !window.confirm(
        `确认补全所选 ${ids.length} 条工单的占位描述？\n从老库回填问题描述与空字段，不删除流转日志。\n${ids.slice(0, 8).join("\n")}${ids.length > 8 ? "\n…" : ""}`,
      )
    ) {
      return;
    }
    void submitRepairLegacy(ids, { backfillFields: true });
  });

  document.getElementById("migrate-legacy-delete-all-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    if (
      !window.confirm(
        "确认删除全部已迁工单？\n仅删除新平台中 legacy_instance_id 非空的迁入工单，不可恢复；删除后重建列表快照。",
      )
    ) {
      return;
    }
    void submitDeleteMigrated(null);
  });

  document.getElementById("migrate-legacy-delete-selected-btn")?.addEventListener("click", () => {
    if (state.migrateLegacySubmitting) return;
    const visible = filteredMigrateCandidates();
    const ids = selectedMigratedProcessIds(visible);
    if (!ids.length) {
      window.alert("请先勾选列表中已迁入的流程 ID");
      return;
    }
    if (
      !window.confirm(
        `确认删除所选 ${ids.length} 条已迁工单？\n不可恢复。\n${ids.slice(0, 8).join("\n")}${ids.length > 8 ? "\n…" : ""}`,
      )
    ) {
      return;
    }
    void submitDeleteMigrated(ids);
  });
}
