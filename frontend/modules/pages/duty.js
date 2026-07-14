import { DUTY_ROSTER_SECTIONS, DUTY_SPECIAL_ROTATION_SUBTABLES, DUTY_CALENDAR_KINDS, DUTY_CALENDAR_HOME_LABELS, DUTY_CALENDAR_KIND_BY_SECTION_ID, DUTY_ROTATION_KIND_BY_SECTION_ID, DUTY_ALL_ROTATION_KINDS, DUTY_RL_ONCALL_STORAGE_KEY, DUTY_ROTATION_STORAGE_KEY, DUTY_ROTATION_STATUS_ACTIVE, DUTY_ROTATION_STATUS_INACTIVE, DUTY_SHIFT_FULL, DUTY_SHIFT_NIGHT, DUTY_ASSIGNMENTS_STORAGE_KEY, DUTY_HOLIDAY_STORAGE_KEY, DUTY_FIELD_CASCADE_SEP } from "../constants/duty.js";
import { personOptionMatchesKeyword } from "../constants/workflow.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel, normalizeDutyRotationList, normalizeDutyRlOnCallRows, isDutyRosterRlOnlyView, isDutyRosterEditRlOnly, getVisibleDutyRosterSectionsForWhitelist, dutyRosterAnchorValidForWhitelist } from "../utils/normalize.js";
import { operatorMatchesPersonField, formatDutyRlNowZh, formatDutyRlTableDateLabel, formatDutyRotationLastAccept, formatRlTodayBannerPart, dutyRlSlotFilled } from "../utils/format.js";
import { dutyRlLocalDateKey, dutyRlEffectiveDateKey, dutyShiftLabel, buildDutyMonthWeeks, dutyCalendarSyncKey as _dutyCalendarSyncKey, dutyHolidayMonthSyncKey as _dutyHolidayMonthSyncKey } from "../utils/date.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";

export function persistDutyAssignmentsLocal() {
  try {
    window.localStorage.setItem(DUTY_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(state.dutyAssignments));
  } catch (_) {}
}

export function dutyModalUserLabel(u) {
  const acc = String(u.account || "");
  const nm = String(u.user_name || "");
  return nm ? `${nm} (${acc})` : acc;
}

export function dutyUserContactPhone(u) {
  return String(u?.contact_phone || "").trim();
}

export function getDutyAssignmentsForDay(kind, dateKey, dutyAssignments) {
  const bucket = dutyAssignments[kind];
  if (!bucket || !dateKey) return [];
  const arr = bucket[dateKey];
  return Array.isArray(arr) ? arr : [];
}

export function dutyFieldParsePath(p) {
  return String(p || "")
    .split(".")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

export function dutyFieldGetParentArray(tree, parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return tree;
  let arr = tree;
  for (let d = 0; d < parts.length - 1; d++) {
    const n = arr[parts[d]];
    if (!n) return null;
    if (!Array.isArray(n.children)) n.children = [];
    arr = n.children;
  }
  return arr;
}

export function dutyFieldNodeAtPath(tree, parts) {
  const parent = dutyFieldGetParentArray(tree, parts);
  if (!parent) return null;
  return parent[parts[parts.length - 1]] ?? null;
}

/** 收集级联树中所有合法路径（含中间节点，与后端 _duty_field_allowed_path_strings 一致） */
export function dutyCascaderCollectAllPaths(tree, prefix = []) {
  const paths = [];
  const nodes = Array.isArray(tree) ? tree : [];
  for (const node of nodes) {
    const lab = String(node.label || "").trim();
    if (!lab) continue;
    const parts = [...prefix, lab];
    paths.push(parts.join(DUTY_FIELD_CASCADE_SEP));
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length) paths.push(...dutyCascaderCollectAllPaths(children, parts));
  }
  return paths;
}

/** 责任田路径关键字匹配：支持完整路径、分段及空格分词 */
export function dutyCascaderPathMatchesKeyword(path, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  const txt = String(path || "").trim().toLowerCase();
  if (!txt) return false;
  if (txt.includes(kw)) return true;
  const tokens = kw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return txt.includes(kw);
  return tokens.every((t) => txt.includes(t));
}

export function dutyCascaderSearchPanelHtml(tree, keyword, selectedPath = "") {
  const kw = String(keyword || "").trim();
  const all = dutyCascaderCollectAllPaths(tree);
  const matched = kw ? all.filter((p) => dutyCascaderPathMatchesKeyword(p, kw)) : [];
  if (!matched.length) {
    return `<div class="cascade-cascader-search-results"><div class="cascade-cascader-empty">${escapeHtml(kw ? "无匹配项" : "")}</div></div>`;
  }
  const active = String(selectedPath || "").trim();
  const items = matched
    .map((path) => {
      const sel = path === active ? " is-active" : "";
      return `<button type="button" class="cascade-cascader-search-item${sel}" data-cascade-search-pick="${escapeAttr(path)}" tabindex="-1">${escapeHtml(path)}</button>`;
    })
    .join("");
  return `<div class="cascade-cascader-search-results" data-cascade-search-list>${items}</div>`;
}

export function dutyCascaderColumnsData(tree, tempPath) {
  const columns = [];
  let cur = Array.isArray(tree) ? tree : [];
  let d = 0;
  for (;;) {
    if (!cur.length) break;
    columns.push({ depth: d, list: cur, activeLabel: tempPath[d] ?? null });
    const label = tempPath[d];
    if (label == null || label === "") break;
    const node = cur.find((n) => String(n.label || "").trim() === label);
    if (!node || !Array.isArray(node.children) || !node.children.length) break;
    cur = node.children;
    d++;
  }
  return columns;
}

export function dutyCascaderColumnHtml(depth, nodes, activeLabel) {
  const items = (nodes || [])
    .map((node) => {
      const lab = String(node.label || "").trim();
      if (!lab) return "";
      const ch = Array.isArray(node.children) && node.children.length > 0;
      const active = lab === activeLabel ? " is-active" : "";
      const arrow = ch ? '<span class="cascade-cascader-arrow" aria-hidden="true">▸</span>' : "";
      return `<button type="button" class="cascade-cascader-item${active}" data-depth="${depth}" data-label="${escapeAttr(lab)}" data-has-children="${ch ? "1" : "0"}">${escapeHtml(lab)}${arrow}</button>`;
    })
    .filter(Boolean)
    .join("");
  return `<div class="cascade-cascader-col" role="listbox" data-col-depth="${depth}">${items}</div>`;
}

/** 重绘级联列前捕获各列 scrollTop，避免悬停展开或刷新面板时滚回顶部 */
export function dutyCascaderCaptureColumnScroll(colsEl) {
  const scrollByDepth = {};
  if (!colsEl) return scrollByDepth;
  colsEl.querySelectorAll(".cascade-cascader-col").forEach((col) => {
    const depth = col.getAttribute("data-col-depth");
    if (depth != null) scrollByDepth[depth] = col.scrollTop;
  });
  return scrollByDepth;
}

export function dutyCascaderRestoreColumnScroll(colsEl, scrollByDepth) {
  if (!colsEl || !scrollByDepth) return;
  colsEl.querySelectorAll(".cascade-cascader-col").forEach((col) => {
    const depth = col.getAttribute("data-col-depth");
    if (depth != null && Object.prototype.hasOwnProperty.call(scrollByDepth, depth)) {
      col.scrollTop = scrollByDepth[depth];
    }
  });
}

export function persistDutyHolidayLocal() {
  try {
    window.localStorage.setItem(DUTY_HOLIDAY_STORAGE_KEY, JSON.stringify(state.dutyHolidayDays || {}));
  } catch (_) {}
}

export function isDutyRosterRlOnlyScope() {
  return isDutyRosterRlOnlyView(getCurrentWhitelistSettings());
}

export function getVisibleDutyRosterSections() {
  return getVisibleDutyRosterSectionsForWhitelist(getCurrentWhitelistSettings());
}

export function dutyRosterAnchorValid(id) {
  return dutyRosterAnchorValidForWhitelist(id, getCurrentWhitelistSettings());
}

export function persistDutyRotationLocal() {
  try {
    const payload = {};
    DUTY_ALL_ROTATION_KINDS.forEach((k) => {
      payload[k] = state.dutyRotationLists[k] || [];
    });
    window.localStorage.setItem(DUTY_ROTATION_STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

export function persistDutyRlOnCallLocal() {
  try {
    window.localStorage.setItem(DUTY_RL_ONCALL_STORAGE_KEY, JSON.stringify(state.dutyRlOnCallRows || []));
  } catch (_) {}
}

export function renderRlPersonTableCell(slot, editing, idx, role) {
  if (editing) {
    if (!dutyRlSlotFilled(slot)) {
      return `<span class="duty-rl-empty-slot">—</span>`;
    }
    return `<div class="duty-rl-edit-slot">
      <div class="duty-rl-edit-name">${escapeHtml(dutyModalUserLabel(slot))}</div>
      <input type="tel" class="duty-rl-phone-edit" data-duty-rl-slot="${role}" data-duty-rl-idx="${idx}" value="${escapeAttr(slot.phone)}" placeholder="手机号" />
    </div>`;
  }
  if (!dutyRlSlotFilled(slot)) return "—";
  const name = String(slot.user_name || "").trim() || "—";
  const acc = String(slot.account || "").trim();
  const phone = String(slot.phone || "").trim() || "—";
  return `<div class="duty-rl-view-slot duty-rl-view-slot--inline">
    <span class="duty-rl-view-name">${escapeHtml(name)}</span>
    <span class="duty-rl-view-sep" aria-hidden="true">·</span>
    <span class="duty-rl-view-account">${escapeHtml(acc)}</span>
    <span class="duty-rl-view-sep" aria-hidden="true">·</span>
    <span class="duty-rl-phone-tag" title="手机号"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>
  </div>`;
}

export function mergeDutyMonthFromServer(kind, year, month, dateMap) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const bucket = { ...(state.dutyAssignments[kind] || {}) };
  Object.keys(bucket).forEach((k) => {
    if (k.startsWith(prefix)) delete bucket[k];
  });
  if (dateMap && typeof dateMap === "object") {
    Object.keys(dateMap).forEach((dk) => {
      const arr = dateMap[dk];
      if (Array.isArray(arr) && arr.length > 0) bucket[dk] = arr;
    });
  }
  state.dutyAssignments[kind] = bucket;
}

export async function syncDutyCalendarMonthsFromServer() {
  const op = getCurrentOperator();
  const seen = new Map();
  DUTY_CALENDAR_KINDS.forEach((k) => {
    const ym = state.dutyCalendarYm[k];
    if (!ym || !ym.year || !ym.month) return;
    const key = `${ym.year}-${ym.month}`;
    if (!seen.has(key)) seen.set(key, { year: ym.year, month: ym.month });
  });
  for (const { year, month } of seen.values()) {
    try {
      const resp = await fetch(
        `${API_BASE_URL}/api/duty/calendar?operator_id=${encodeURIComponent(op.account)}&year=${year}&month=${month}`
      );
      if (!resp.ok) continue;
      const json = await resp.json();
      mergeDutyMonthFromServer("kernel", year, month, json.kernel || {});
      mergeDutyMonthFromServer("control", year, month, json.control || {});
      mergeDutyMonthFromServer("public_cloud", year, month, json.public_cloud || {});
      mergeDutyMonthFromServer("poc", year, month, json.poc || {});
      mergeDutyMonthFromServer("research_version", year, month, json.research_version || {});
    } catch (_) {
      /* 离线时保留本地缓存 */
    }
  }
  persistDutyAssignmentsLocal();
}

export function mergeDutyHolidayMonthFromServer(year, month, dayMap) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const bucket = { ...(state.dutyHolidayDays || {}) };
  Object.keys(bucket).forEach((k) => {
    if (k.startsWith(prefix)) delete bucket[k];
  });
  if (dayMap && typeof dayMap === "object") {
    Object.keys(dayMap).forEach((dk) => {
      const val = String(dayMap[dk] || "").trim();
      if (val === "workday" || val === "weekend_holiday") bucket[dk] = val;
    });
  }
  state.dutyHolidayDays = bucket;
}

export async function syncDutyHolidayMonthFromServer() {
  const op = getCurrentOperator();
  const ym = state.dutyHolidayYm || { year: 0, month: 0 };
  if (!ym.year || !ym.month) return;
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/duty/holidays?operator_id=${encodeURIComponent(op.account)}&year=${ym.year}&month=${ym.month}`
    );
    if (!resp.ok) return;
    const json = await resp.json();
    mergeDutyHolidayMonthFromServer(ym.year, ym.month, json.days || {});
    persistDutyHolidayLocal();
  } catch (_) {
    /* 离线时保留本地缓存 */
  }
}

export async function persistDutyHolidayMonthToServer(year, month) {
  persistDutyHolidayLocal();
  const op = getCurrentOperator();
  const last = new Date(year, month, 0).getDate();
  const bucket = state.dutyHolidayDays || {};
  const days = {};
  for (let d = 1; d <= last; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const val = String(bucket[key] || "").trim();
    if (val === "workday" || val === "weekend_holiday") days[key] = val;
  }
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/holidays`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        year,
        month,
        days,
      }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      window.alert(`节假日配置保存失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    window.alert(`节假日配置保存失败：${String(e.message || e)}`);
    return false;
  }
}

export async function persistDutyCalendarMonthToServer(kind, year, month) {
  persistDutyAssignmentsLocal();
  const op = getCurrentOperator();
  const last = new Date(year, month, 0).getDate();
  const bucket = state.dutyAssignments[kind] || {};
  const days = {};
  for (let d = 1; d <= last; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const arr = bucket[key];
    days[key] = Array.isArray(arr) ? arr : [];
  }
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/calendar`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        kind,
        year,
        month,
        days,
      }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      window.alert(`保存到服务器失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    window.alert(`保存到服务器失败：${String(e.message || e)}`);
    return false;
  }
}

export function isDutyCalendarAdmin() {
  return getCurrentRoleCode() === "管理员";
}

export function canEditRlDutyRosterByWhitelist() {
  return whitelistAllows("duty_roster_edit", "readonly", getCurrentWhitelistSettings());
}

export function canEditFullDutyRosterByWhitelist() {
  if (isDutyRosterRlOnlyScope()) return false;
  const wl = getCurrentWhitelistSettings();
  if (isDutyRosterEditRlOnly(wl)) return false;
  return whitelistAllows("duty_roster_edit", "readonly", wl);
}

export function canEditDutyRosterByWhitelist() {
  return canEditFullDutyRosterByWhitelist();
}

export function canDutyCalendarImport() {
  return canEditFullDutyRosterByWhitelist();
}

export function applyDutyCalendarImportFileChoice(file) {
  if (!file) return { accepted: false, fileName: "" };
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { accepted: false, invalidFormat: true, fileName: "" };
  }
  return { accepted: true, file, fileName: file.name };
}

export function resolveDutyCalendarImportFile(importState, fileInput) {
  return importState?.file || fileInput?.files?.[0] || null;
}

export function renderDutyCalendarImportErrorsHtml(errors) {
  if (!Array.isArray(errors) || !errors.length) return "";
  return errors
    .map(
      (e) =>
        `<div class="duty-import-error-item">第${Number(e.row) || "?"}行 · ${escapeHtml(String(e.field || ""))}：${escapeHtml(String(e.message || ""))}</div>`
    )
    .join("");
}

const DUTY_CALENDAR_KIND_TITLES = {
  kernel: "内核值班表",
  control: "管控值班表",
  public_cloud: "公有云值班表",
  poc: "POC值班表",
  research_version: "在研版本值班表",
};

export function downloadDutyCalendarImportTemplate(kind) {
  const X = typeof window !== "undefined" ? window.XLSX : undefined;
  if (!X) {
    window.alert("SheetJS 未加载");
    return;
  }
  const ym = state.dutyCalendarYm[kind] || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const exampleDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const title = String(DUTY_CALENDAR_KIND_TITLES[kind] || kind).replace(/表$/, "");
  const ws = X.utils.aoa_to_sheet([
    ["日期", "账号", "姓名", "班次"],
    [exampleDate, "", "（示例，请填写真实账号）", "全天"],
  ]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "值班导入");
  X.writeFile(wb, `${title}值班表导入模板.xlsx`);
}

export function dutyRosterExtrasSyncKey() {
  const acc = getCurrentOperator().account || "";
  /** adminLoaded 后再拉一次，避免首屏角色未解析时漏掉「仅管理员」的本地数据迁移 */
  return `${acc}|${state.adminLoaded ? "1" : "0"}`;
}

function rotationListsForPutPayload() {
  const lists = {};
  DUTY_ALL_ROTATION_KINDS.forEach((k) => {
    lists[k] = (state.dutyRotationLists[k] || []).map((row) => ({
      account: String(row.account || "").trim(),
      user_name: String(row.user_name || "").trim(),
      status: row.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_INACTIVE : DUTY_ROTATION_STATUS_ACTIVE,
    }));
  });
  return lists;
}

export async function refreshDutyRotationFromServer() {
  const op = getCurrentOperator();
  const qs = `operator_id=${encodeURIComponent(op.account)}`;
  try {
    const rRot = await fetch(`${API_BASE_URL}/api/duty/rotation?${qs}`);
    if (!rRot.ok) return false;
    const jr = await rRot.json();
    DUTY_ALL_ROTATION_KINDS.forEach((k) => {
      state.dutyRotationLists[k] = normalizeDutyRotationList(Array.isArray(jr[k]) ? jr[k] : []);
    });
    persistDutyRotationLocal();
    return true;
  } catch (_) {
    return false;
  }
}

export async function putDutyRotationToServer(options) {
  const quiet = !!(options && options.quiet);
  const skipResync = !!(options && options.skipResync);
  const op = getCurrentOperator();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/rotation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, lists: rotationListsForPutPayload() }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      if (!quiet) window.alert(`保存到服务器失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    if (!skipResync) {
      await refreshDutyRotationFromServer();
    }
    return true;
  } catch (e) {
    if (!quiet) window.alert(`保存到服务器失败：${String(e.message || e)}`);
    return false;
  }
}

export async function putDutyRlOnCallToServer(options) {
  const quiet = !!(options && options.quiet);
  const op = getCurrentOperator();
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/rl-oncall`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, rows: state.dutyRlOnCallRows || [] }),
    });
    if (!resp.ok) {
      const tx = await resp.text();
      if (!quiet) window.alert(`RL 值班表保存失败：${resp.status} ${tx.slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (e) {
    if (!quiet) window.alert(`RL 值班表保存失败：${String(e.message || e)}`);
    return false;
  }
}

export async function syncDutyRosterExtrasFromServer() {
  const op = getCurrentOperator();
  const canEditFull = canEditFullDutyRosterByWhitelist();
  const canEditRl = canEditRlDutyRosterByWhitelist();
  const qs = `operator_id=${encodeURIComponent(op.account)}`;
  try {
    const [rRot, rRl] = await Promise.all([
      fetch(`${API_BASE_URL}/api/duty/rotation?${qs}`),
      fetch(`${API_BASE_URL}/api/duty/rl-oncall?${qs}`),
    ]);

    if (rRot.ok) {
      const jr = await rRot.json();
      const serverEmpty = DUTY_ALL_ROTATION_KINDS.every((k) => !((jr[k] || []).length > 0));
      const localHas = DUTY_ALL_ROTATION_KINDS.some((k) => (state.dutyRotationLists[k] || []).length > 0);
      if (serverEmpty && localHas && canEditFull) {
        await putDutyRotationToServer({ quiet: true, skipResync: true });
      } else if (!serverEmpty || !localHas) {
        DUTY_ALL_ROTATION_KINDS.forEach((k) => {
          state.dutyRotationLists[k] = normalizeDutyRotationList(Array.isArray(jr[k]) ? jr[k] : []);
        });
      }
      persistDutyRotationLocal();
    }

    if (rRl.ok) {
      const jl = await rRl.json();
      const rows = Array.isArray(jl.rows) ? jl.rows : [];
      const serverEmpty = rows.length === 0;
      const localHas = (state.dutyRlOnCallRows || []).length > 0;
      if (serverEmpty && localHas && canEditRl) {
        await putDutyRlOnCallToServer({ quiet: true });
      } else if (!serverEmpty || !localHas) {
        state.dutyRlOnCallRows = normalizeDutyRlOnCallRows(rows);
      }
      persistDutyRlOnCallLocal();
    }
  } catch (_) {
    /* 离线时保留本地缓存 */
  }
}

export async function persistDutyRotationLocalAndServer() {
  persistDutyRotationLocal();
  if (!canEditDutyRosterByWhitelist()) return;
  await putDutyRotationToServer();
}

export function persistDutyRlOnCallLocalAndServer() {
  persistDutyRlOnCallLocal();
  if (!canEditRlDutyRosterByWhitelist()) return;
  void putDutyRlOnCallToServer();
}

export function isDutySelectableAdminUser(u) {
  const a = u?.is_active;
  if (a === false) return false;
  if (a != null && String(a).toLowerCase() === "false") return false;
  if (String(a) === "0") return false;
  return true;
}

export function filterDutyUsersForSuggest(pool, filterText, { emptyLimit = 100 } = {}) {
  const users = Array.isArray(pool) ? pool : [];
  const qq = String(filterText || "").trim();
  if (!qq) return users.slice(0, emptyLimit);
  return users.filter((u) => {
    const acc = String(u.account || "");
    const nm = String(u.user_name || "");
    return (
      personOptionMatchesKeyword(dutyModalUserLabel(u), qq) ||
      personOptionMatchesKeyword(acc, qq) ||
      personOptionMatchesKeyword(nm, qq)
    );
  });
}

export function renderDutyUserSuggestListHtml(users) {
  const filtered = Array.isArray(users) ? users : [];
  if (!filtered.length) {
    return `<li class="duty-modal-user-suggest-empty" role="presentation">无匹配人员</li>`;
  }
  return filtered
    .map((u) => {
      const acc = String(u.account || "");
      return `<li role="option" class="duty-modal-user-suggest-item" data-account="${escapeAttr(acc)}">${escapeHtml(dutyModalUserLabel(u))}</li>`;
    })
    .join("");
}

export function getDutySelectableUsers() {
  return state.adminUsers.filter(isDutySelectableAdminUser);
}

export function countDutyRotationActiveTotal(list) {
  const arr = Array.isArray(list) ? list : [];
  const total = arr.length;
  const active = arr.filter((row) => row?.status !== DUTY_ROTATION_STATUS_INACTIVE).length;
  return { active, total };
}

export function renderDutyRotationTitleWithStat(title, list) {
  const { active, total } = countDutyRotationActiveTotal(list);
  return `${escapeHtml(title)}<span class="duty-roster-stat">在值/总数：${active}/${total}</span>`;
}

export function renderDutyRotationUnit(opts) {
  const { blockId, title, rKind, outer, headingTag, outerClass = "" } = opts;
  const admin = canEditDutyRosterByWhitelist();
  const editing = !!state.dutyRotationEditMode[rKind];
  const list = state.dutyRotationLists[rKind] || [];
  const editBtn = admin
    ? `<button type="button" class="action duty-rot-edit-btn" data-duty-rot-edit="${escapeAttr(rKind)}">${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const noUsers = getDutySelectableUsers().length === 0;
  const rows = list
    .map((row, idx) => {
      const seq = idx + 1;
      const dispName = String(row.user_name || "").trim()
        ? `${String(row.user_name)} (${String(row.account)})`
        : String(row.account);
      const st = row.status === DUTY_ROTATION_STATUS_INACTIVE ? DUTY_ROTATION_STATUS_INACTIVE : DUTY_ROTATION_STATUS_ACTIVE;
      const statusCell = `<span class="duty-rot-status duty-rot-status--${st}"><span class="duty-rot-status-dot" aria-hidden="true"></span>${
        st === DUTY_ROTATION_STATUS_ACTIVE ? "当值" : "置灰"
      }</span>`;
      const lastRaw = row.last_accept_at;
      const lastCell = escapeHtml(formatDutyRotationLastAccept(lastRaw));
      const opCell = editing
        ? `<button type="button" class="action danger duty-rot-remove-btn" data-duty-rot-remove="${escapeAttr(rKind)}" data-duty-rot-idx="${idx}">删除</button>`
        : "";
      return `<tr>
        <td class="duty-rot-col-seq">${seq}</td>
        <td>${escapeHtml(dispName)}</td>
        <td class="duty-rot-col-status">${statusCell}</td>
        <td class="duty-rot-col-last">${lastCell}</td>
        ${editing ? `<td class="duty-rot-col-op">${opCell}</td>` : ""}
      </tr>`;
    })
    .join("");
  const emptyMsg = admin ? "暂无轮值人员，可在编辑模式下添加。" : "暂无轮值人员，请联系管理员维护。";
  const tbodyContent =
    list.length > 0
      ? rows
      : `<tr><td colspan="${editing ? 5 : 4}" class="duty-rot-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const thead = editing
    ? `<thead><tr><th>序号</th><th>姓名</th><th>当值状态</th><th>最近接单时间</th><th>操作</th></tr></thead>`
    : `<thead><tr><th>序号</th><th>姓名</th><th>当值状态</th><th>最近接单时间</th></tr></thead>`;
  const addBlock = editing
    ? `<div class="duty-rot-add">
          <label class="duty-modal-field duty-modal-field--user">添加人员
            <div class="duty-modal-user-combo duty-rot-user-combo" data-duty-rot-combo="${escapeAttr(rKind)}">
              <input
                type="text"
                id="duty-rot-${escapeAttr(rKind)}-input"
                autocomplete="off"
                placeholder="${noUsers ? "暂无可用人员" : "输入姓名或账号搜索"}"
                aria-autocomplete="list"
                aria-controls="duty-rot-${escapeAttr(rKind)}-list"
                aria-expanded="false"
                role="combobox"
                ${noUsers ? "disabled" : ""}
              />
              <input type="hidden" id="duty-rot-${escapeAttr(rKind)}-account" value="" />
              <ul id="duty-rot-${escapeAttr(rKind)}-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
            </div>
          </label>
          <button type="button" class="action primary duty-rot-add-btn" data-duty-rot-add="${escapeAttr(rKind)}">添加至轮值</button>
        </div>`
    : "";
  const blockClass = `duty-roster-block${outerClass ? ` ${outerClass}` : ""}`;
  const titleClass = headingTag === "h3" ? "duty-roster-block-title duty-rot-subtitle" : "duty-roster-block-title";
  return `<${outer} class="${blockClass}" id="${escapeAttr(blockId)}">
          <div class="duty-roster-block-head">
            <${headingTag} class="${titleClass}">${renderDutyRotationTitleWithStat(title, list)}</${headingTag}>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card${editing ? " duty-roster-card--editing" : ""}">
            <div class="duty-rot-table-scroll">
              <table class="duty-roster-table duty-rot-table">
                ${thead}
                <tbody>${tbodyContent}</tbody>
              </table>
            </div>
            ${addBlock}
          </div>
        </${outer}>`;
}

export function renderDutyRotationBlock(sectionId, title, rKind) {
  return renderDutyRotationUnit({
    blockId: sectionId,
    title,
    rKind,
    outer: "section",
    headingTag: "h2",
  });
}

export function renderDutySpecialRotationSection() {
  const subs = DUTY_SPECIAL_ROTATION_SUBTABLES.map((sub) =>
    renderDutyRotationUnit({
      blockId: sub.anchorId,
      title: sub.title,
      rKind: sub.kind,
      outer: "div",
      headingTag: "h3",
      outerClass: "duty-special-rot-sub",
    })
  ).join("");
  const specialLists = DUTY_SPECIAL_ROTATION_SUBTABLES.map((sub) => state.dutyRotationLists[sub.kind] || []);
  const specialStat = countDutyRotationActiveTotal(specialLists.flat());
  return `
        <section class="duty-roster-block duty-special-rotation-wrap" id="duty-special-rotation">
          <h2 class="duty-roster-block-title">${escapeHtml("专项轮值表")}<span class="duty-roster-stat">在值/总数：${specialStat.active}/${specialStat.total}</span></h2>
          <div class="duty-special-rotation-stack">${subs}</div>
        </section>`;
}


export function renderDutyRlOnCallBlock(sectionId, title) {
  const admin = canEditRlDutyRosterByWhitelist();
  const editing = !!state.dutyRlOnCallEditMode;
  const list = [...(state.dutyRlOnCallRows || [])].sort((a, b) => b.duty_date.localeCompare(a.duty_date));
  const todayKey = dutyRlEffectiveDateKey();
  const todayRow = list.find((r) => r.duty_date === todayKey) || null;
  const editBtn = admin
    ? `<button type="button" class="action duty-rl-edit-btn" data-duty-rl-edit>${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const noUsers = getDutySelectableUsers().length === 0;
  const discipline = `
    <div class="duty-rl-discipline">
      <p class="duty-rl-discipline-title">值班纪律及纪律说明：</p>
      <p class="duty-rl-discipline-body">非紧急问题走正常流程，值班时间：当天 9:00～次日 9:00。</p>
    </div>`;
  const todayBanner = `
    <div class="duty-rl-today-banner" role="region" aria-label="当日值班">
      <p class="duty-rl-today-line"><strong>当前时间：</strong>${escapeHtml(formatDutyRlNowZh())}</p>
      <p class="duty-rl-today-line"><strong>主值班：</strong>${formatRlTodayBannerPart(todayRow?.primary)}</p>
      <p class="duty-rl-today-line"><strong>备值班：</strong>${formatRlTodayBannerPart(todayRow?.backup)}</p>
    </div>`;
  const tableRows = list
    .map((row, idx) => {
      const origIdx = (state.dutyRlOnCallRows || []).findIndex((r) => r.duty_date === row.duty_date);
      const i = origIdx >= 0 ? origIdx : idx;
      const dateCell = escapeHtml(formatDutyRlTableDateLabel(row.duty_date));
      const pri = renderRlPersonTableCell(row.primary, editing, i, "primary");
      const bak = renderRlPersonTableCell(row.backup, editing, i, "backup");
      const op = editing
        ? `<button type="button" class="action danger duty-rl-remove-btn" data-duty-rl-idx="${i}">删除</button>`
        : "";
      return `<tr>
        <td class="duty-rl-col-date">${dateCell}</td>
        <td class="duty-rl-col-person">${pri}</td>
        <td class="duty-rl-col-person">${bak}</td>
        ${editing ? `<td class="duty-rot-col-op">${op}</td>` : ""}
      </tr>`;
    })
    .join("");
  const emptyMsg = admin ? "暂无记录，编辑模式下可按日期添加主/备值班。" : "暂无记录，请联系管理员维护。";
  const tbodyContent =
    list.length > 0
      ? tableRows
      : `<tr><td colspan="${editing ? 4 : 3}" class="duty-rot-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const thead = editing
    ? `<thead><tr><th>日期</th><th>主值班</th><th>备值班</th><th>操作</th></tr></thead>`
    : `<thead><tr><th>日期</th><th>主值班</th><th>备值班</th></tr></thead>`;
  const addBlock = editing
    ? `<div class="duty-rl-add-block">
          <p class="duty-rl-add-title">添加记录（须填写手机号；同一日期将覆盖原记录）</p>
          <div class="duty-rl-add-grid">
            <label class="duty-modal-field">值班日期
              <input type="date" id="duty-rl-new-date" class="duty-rl-date-input" value="${escapeAttr(dutyRlLocalDateKey())}" />
            </label>
            <label class="duty-modal-field duty-modal-field--user">主值班
              <div class="duty-modal-user-combo duty-rot-user-combo">
                <input type="text" id="duty-rl-primary-input" autocomplete="off" placeholder="${noUsers ? "暂无可用人员" : "搜索姓名或账号"}" aria-autocomplete="list" aria-controls="duty-rl-primary-list" aria-expanded="false" role="combobox" ${noUsers ? "disabled" : ""} />
                <input type="hidden" id="duty-rl-primary-account" value="" />
                <ul id="duty-rl-primary-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
              </div>
            </label>
            <label class="duty-modal-field">主值班手机
              <input type="tel" id="duty-rl-primary-phone" class="duty-rl-phone-new" placeholder="11 位手机号" />
            </label>
            <label class="duty-modal-field duty-modal-field--user">备值班
              <div class="duty-modal-user-combo duty-rot-user-combo">
                <input type="text" id="duty-rl-backup-input" autocomplete="off" placeholder="可选" aria-autocomplete="list" aria-controls="duty-rl-backup-list" aria-expanded="false" role="combobox" ${noUsers ? "disabled" : ""} />
                <input type="hidden" id="duty-rl-backup-account" value="" />
                <ul id="duty-rl-backup-list" class="duty-modal-user-suggest duty-rot-user-suggest" role="listbox" hidden></ul>
              </div>
            </label>
            <label class="duty-modal-field">备值班手机
              <input type="tel" id="duty-rl-backup-phone" class="duty-rl-phone-new" placeholder="有备值班则必填" />
            </label>
          </div>
          <button type="button" class="action primary" id="duty-rl-add-row-btn">添加</button>
        </div>`
    : "";
  const recentTitle = `<h3 class="duty-rl-recent-title">最近的值班信息</h3>`;
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card${editing ? " duty-roster-card--editing" : ""}">
            ${discipline}
            ${todayBanner}
            ${recentTitle}
            <table class="duty-roster-table duty-rot-table duty-rl-table">
              ${thead}
              <tbody>${tbodyContent}</tbody>
            </table>
            ${addBlock}
          </div>
        </section>`;
}

export function renderDutySubmenuHtml() {
  const parts = [];
  const specialOpen = !!state.dutySpecialSubmenuExpanded;
  getVisibleDutyRosterSections().forEach((s) => {
    if (s.id === "duty-special-rotation") {
      const nested = DUTY_SPECIAL_ROTATION_SUBTABLES.map(
        (sub) =>
          `<button type="button" class="menu-submenu-item menu-submenu-item--duty-nested" role="menuitem" data-duty-anchor="${escapeAttr(sub.anchorId)}">${escapeHtml(sub.title)}</button>`
      ).join("");
      parts.push(
        `<div class="menu-submenu-special-group" role="presentation">
          <div class="menu-submenu-special-row">
            <button type="button" class="menu-submenu-item menu-submenu-item--special-main" role="menuitem" data-duty-anchor="${escapeAttr(s.id)}">${escapeHtml(s.title)}</button>
            <button type="button" class="menu-submenu-expand-btn" data-duty-special-toggle aria-expanded="${specialOpen}" aria-label="展开或收起专项子表">${specialOpen ? "▾" : "▸"}</button>
          </div>
          <div class="menu-submenu-nested-wrap"${specialOpen ? "" : " hidden"}>${nested}</div>
        </div>`
      );
    } else {
      parts.push(
        `<button type="button" class="menu-submenu-item" role="menuitem" data-duty-anchor="${escapeAttr(s.id)}">${escapeHtml(s.title)}</button>`
      );
    }
  });
  return parts.join("");
}

export function dutyAssignmentMatchesCurrentUser(item) {
  const op = getCurrentOperator();
  const rowAcc = String(item.account || "").trim();
  const opAcc = String(op.account || "").trim();
  if (rowAcc && opAcc && rowAcc === opAcc) return true;
  const label = String(item.user_name || item.account || "").trim();
  return operatorMatchesPersonField(label, op);
}

export function renderDutyCalendarBlock(sectionId, title, kind) {
  const ym = state.dutyCalendarYm[kind] || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const weeks = buildDutyMonthWeeks(year, month);
  const admin = canEditDutyRosterByWhitelist();
  const editing = !!state.dutyEditMode[kind];
  const titleZh = `${year}年${month}月`;
  const wkLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const editBtn = admin
    ? `<button type="button" class="action duty-cal-edit-btn" data-duty-cal-edit="${escapeAttr(kind)}">${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const importBtns = admin
    ? `<button type="button" class="action duty-cal-template-btn" data-duty-cal-template="${escapeAttr(kind)}">下载模板</button>
              <button type="button" class="action duty-cal-import-btn" data-duty-cal-import="${escapeAttr(kind)}">导入</button>`
    : "";
  const cellsHtml = weeks
    .map((row) => {
      const tds = row
        .map((cell) => {
          if (!cell) {
            return `<td class="duty-cal-cell duty-cal-cell--empty"></td>`;
          }
          const list = getDutyAssignmentsForDay(kind, cell.key, state.dutyAssignments);
          const hasSelf = list.some((it) => dutyAssignmentMatchesCurrentUser(it));
          const chips = list
            .map((item, idx) => {
              const sh = item.shift === DUTY_SHIFT_NIGHT ? "night" : "full";
              const cls = sh === "night" ? "duty-cal-chip duty-cal-chip--night" : "duty-cal-chip duty-cal-chip--full";
              const name = escapeHtml(String(item.user_name || item.account || ""));
              const tag = escapeHtml(dutyShiftLabel(sh));
              return `<span class="${cls}"><span class="duty-cal-chip-name">${name}</span><span class="duty-cal-chip-shift">${tag}</span></span>`;
            })
            .join("");
          const interactive = admin && editing ? `tabindex="0" role="button" data-duty-cal-cell="${escapeAttr(kind)}" data-duty-cal-date="${escapeAttr(cell.key)}"` : "";
          const cls = `duty-cal-cell${hasSelf ? " duty-cal-cell--self" : ""}${admin && editing ? " duty-cal-cell--interactive" : ""}`;
          return `<td class="${cls}" ${interactive}><span class="duty-cal-daynum">${cell.day}</span><div class="duty-cal-chips">${chips}</div></td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const headRow = `<tr>${wkLabels.map((l) => `<th class="duty-cal-wk">${escapeHtml(l)}</th>`).join("")}</tr>`;
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">
              ${importBtns}
              ${editBtn}
            </div>
          </div>
          <div class="duty-roster-card duty-roster-card--calendar${editing ? " duty-roster-card--editing" : ""}">
            <div class="duty-cal-toolbar">
              <button type="button" class="action duty-cal-nav" data-duty-cal-nav="${escapeAttr(kind)}" data-duty-cal-dir="-1" aria-label="上个月">‹ 上个月</button>
              <span class="duty-cal-month-label">${escapeHtml(titleZh)}</span>
              <button type="button" class="action duty-cal-nav" data-duty-cal-nav="${escapeAttr(kind)}" data-duty-cal-dir="1" aria-label="下个月">下个月 ›</button>
            </div>
            <table class="duty-cal-table">
              <thead>${headRow}</thead>
              <tbody>${cellsHtml}</tbody>
            </table>
          </div>
        </section>`;
}

export function renderDutyHolidayConfigBlock(sectionId, title) {
  const ym = state.dutyHolidayYm || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const weeks = buildDutyMonthWeeks(year, month);
  const admin = canEditDutyRosterByWhitelist();
  const editing = !!state.dutyHolidayEditMode;
  const titleZh = `${year}年${month}月`;
  const wkLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const editBtn = admin
    ? `<button type="button" class="action duty-holiday-edit-btn" data-duty-holiday-edit>${editing ? "完成编辑" : "编辑"}</button>`
    : "";
  const cellsHtml = weeks
    .map((row) => {
      const tds = row
        .map((cell) => {
          if (!cell) return `<td class="duty-cal-cell duty-cal-cell--empty"></td>`;
          const val = String((state.dutyHolidayDays || {})[cell.key] || "").trim();
          const isWorkday = val === "workday";
          const isHoliday = val === "weekend_holiday";
          const tag = isWorkday ? "工作日" : isHoliday ? "周末节假日" : "";
          const extraCls = isWorkday ? " duty-cal-cell--full" : isHoliday ? " duty-cal-cell--night" : "";
          const interactive = admin && editing ? `tabindex="0" role="button" data-duty-holiday-date="${escapeAttr(cell.key)}"` : "";
          const chip = tag ? `<div class="duty-cal-chips"><span class="duty-cal-chip"><span class="duty-cal-chip-name">${escapeHtml(tag)}</span></span></div>` : "";
          return `<td class="duty-cal-cell${extraCls}${admin && editing ? " duty-cal-cell--interactive" : ""}" ${interactive}><span class="duty-cal-daynum">${cell.day}</span>${chip}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const headRow = `<tr>${wkLabels.map((l) => `<th class="duty-cal-wk">${escapeHtml(l)}</th>`).join("")}</tr>`;
  const tip = editing ? "点击日期可在“工作日/周末节假日”之间切换；清空请点击到第三态。" : "";
  const noteHtml = tip ? `<p class="duty-roster-note">${escapeHtml(tip)}</p>` : "";
  return `
        <section class="duty-roster-block" id="${escapeAttr(sectionId)}">
          <div class="duty-roster-block-head">
            <h2 class="duty-roster-block-title">${escapeHtml(title)}</h2>
            <div class="duty-roster-block-actions">${editBtn}</div>
          </div>
          <div class="duty-roster-card duty-roster-card--calendar${editing ? " duty-roster-card--editing" : ""}">
            ${noteHtml}
            <div class="duty-cal-toolbar">
              <button type="button" class="action duty-holiday-nav" data-duty-holiday-nav data-duty-holiday-dir="-1" aria-label="上个月">‹ 上个月</button>
              <span class="duty-cal-month-label">${escapeHtml(titleZh)}</span>
              <button type="button" class="action duty-holiday-nav" data-duty-holiday-nav data-duty-holiday-dir="1" aria-label="下个月">下个月 ›</button>
            </div>
            <table class="duty-cal-table">
              <thead>${headRow}</thead>
              <tbody>${cellsHtml}</tbody>
            </table>
          </div>
        </section>`;
}

export function renderHomeDutyKindChips(list, roleLabel) {
  if (!list.length) return `<span class="home-duty-cell-empty">—</span>`;
  return list
    .map((item) => {
      const sh = item.shift === DUTY_SHIFT_NIGHT ? "night" : "full";
      const cls = sh === "night" ? "duty-cal-chip duty-cal-chip--night" : "duty-cal-chip duty-cal-chip--full";
      const tag = escapeHtml(dutyShiftLabel(sh));
      return `<span class="${cls}"><span class="duty-cal-chip-name">${escapeHtml(roleLabel)}</span><span class="duty-cal-chip-shift">${tag}</span></span>`;
    })
    .join("");
}

export function renderHomeDutyRlUnifiedCell(rlRow, rlPri, rlBak) {
  if (!rlRow || (!rlPri && !rlBak)) return `<span class="home-duty-cell-empty">—</span>`;
  const parts = [];
  if (rlPri) {
    parts.push(
      `<div class="duty-rl-view-slot duty-rl-view-slot--inline home-duty-rl-slot"><span class="duty-rl-view-name">RL值班 · 主值班</span>${homeDutyRlPhoneSuffix(rlRow.primary)}</div>`
    );
  }
  if (rlBak) {
    parts.push(
      `<div class="duty-rl-view-slot duty-rl-view-slot--inline home-duty-rl-slot"><span class="duty-rl-view-name">RL值班 · 备值班</span>${homeDutyRlPhoneSuffix(rlRow.backup)}</div>`
    );
  }
  return `<div class="home-duty-rl-cell">${parts.join("")}</div>`;
}

export function homeDutyRlPhoneSuffix(slot) {
  const phone = String(slot.phone || "").trim();
  if (!phone) return "";
  return `<span class="duty-rl-view-sep" aria-hidden="true">·</span><span class="duty-rl-phone-tag" title="手机号"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>`;
}

export function dutyRlSlotMatchesCurrentUser(slot) {
  if (!dutyRlSlotFilled(slot)) return false;
  return dutyAssignmentMatchesCurrentUser(slot);
}

export function buildHomeDutyCalendarCell(dateKey) {
  const lines = [];
  let hasSelf = false;
  DUTY_CALENDAR_KINDS.forEach((kind) => {
    const list = getDutyAssignmentsForDay(kind, dateKey, state.dutyAssignments).filter((it) => dutyAssignmentMatchesCurrentUser(it));
    if (!list.length) return;
    hasSelf = true;
    lines.push(
      `<div class="home-duty-cal-line home-duty-cal-line--chips"><div class="home-duty-chips-wrap">${renderHomeDutyKindChips(
        list,
        DUTY_CALENDAR_HOME_LABELS[kind] || kind
      )}</div></div>`
    );
  });
  const rlRow = (state.dutyRlOnCallRows || []).find((r) => r.duty_date === dateKey);
  const rlPri = rlRow && dutyRlSlotMatchesCurrentUser(rlRow.primary);
  const rlBak = rlRow && dutyRlSlotMatchesCurrentUser(rlRow.backup);
  if (rlPri || rlBak) {
    hasSelf = true;
    lines.push(`<div class="home-duty-cal-line home-duty-cal-line--rl">${renderHomeDutyRlUnifiedCell(rlRow, rlPri, rlBak)}</div>`);
  }
  const inner = `<div class="duty-cal-chips home-duty-cal-chips">${lines.join("")}</div>`;
  return { hasSelf, inner };
}

export function navigateHomeDutyCalendarMonth(dir) {
  const kYm = state.dutyCalendarYm.kernel;
  if (!kYm) return;
  let { year, month } = kYm;
  month += dir;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  DUTY_CALENDAR_KINDS.forEach((k) => {
    state.dutyCalendarYm[k] = { year, month };
  });
  state.dutyCalendarLoadedKey = "";
}

export function buildHomeDutyCalendarTableBodyHtml(year, month) {
  const weeks = buildDutyMonthWeeks(year, month);
  return weeks
    .map((row) => {
      const tds = row
        .map((cell) => {
          if (!cell) {
            return `<td class="duty-cal-cell duty-cal-cell--empty"></td>`;
          }
          const dateKey = cell.key;
          const { hasSelf, inner } = buildHomeDutyCalendarCell(dateKey);
          const cls = `duty-cal-cell${hasSelf ? " duty-cal-cell--self" : ""}`;
          return `<td class="${cls}"><span class="duty-cal-daynum">${cell.day}</span>${inner}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
}

/** 值班数据就绪后仅更新主页月历表格，避免第二次整页 render。 */
export function patchHomeDutyCalendarDom() {
  if (state.activeKey !== "home") return false;
  const section = document.getElementById("home-duty-info");
  if (!section) return false;
  const ym = state.dutyCalendarYm.kernel || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const monthLabel = section.querySelector(".duty-cal-month-label");
  const tbody = section.querySelector(".home-duty-cal-table tbody");
  if (!monthLabel || !tbody) return false;
  monthLabel.textContent = `${year}年${month}月`;
  tbody.innerHTML = buildHomeDutyCalendarTableBodyHtml(year, month);
  return true;
}

export function renderHomeDutyInfoSectionHtml() {
  const ym = state.dutyCalendarYm.kernel || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const { year, month } = ym;
  const titleZh = `${year}年${month}月`;
  const wkLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const cellsHtml = buildHomeDutyCalendarTableBodyHtml(year, month);
  const headRow = `<tr>${wkLabels.map((l) => `<th class="duty-cal-wk">${escapeHtml(l)}</th>`).join("")}</tr>`;
  return `
    <section class="home-duty-info-section" id="home-duty-info" aria-label="值班信息">
      <div class="section-title home-duty-info-title">值班信息</div>
      <div class="duty-roster-card duty-roster-card--calendar home-duty-unified-card">
        <div class="duty-cal-toolbar">
          <button type="button" class="action duty-cal-nav" data-home-duty-unified-nav data-home-duty-dir="-1" aria-label="上个月">‹ 上个月</button>
          <span class="duty-cal-month-label">${escapeHtml(titleZh)}</span>
          <button type="button" class="action duty-cal-nav" data-home-duty-unified-nav data-home-duty-dir="1" aria-label="下个月">下个月 ›</button>
        </div>
        <div class="home-duty-cal-table-wrap">
          <table class="duty-cal-table home-duty-cal-table">
            <thead>${headRow}</thead>
            <tbody>${cellsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

export function renderDutyDayModalHtml() {
  const m = state.dutyDayModal;
  if (!m) return "";
  const { kind, dateKey } = m;
  const titleMap = {
    kernel: "内核值班表",
    control: "管控值班表",
    public_cloud: "公有云值班表",
    poc: "POC值班表",
    research_version: "在研版本值班表",
  };
  const sectionTitle = titleMap[kind] || kind;
  const users = getDutySelectableUsers();
  const list = getDutyAssignmentsForDay(kind, dateKey, state.dutyAssignments);
  const [y, mo, d] = dateKey.split("-").map((x) => parseInt(x, 10));
  const dateLabel = `${y}年${mo}月${d}日`;
  const noDutyUsers = users.length === 0;
  const rows = list
    .map((item, idx) => {
      const sh = item.shift === DUTY_SHIFT_NIGHT ? DUTY_SHIFT_NIGHT : DUTY_SHIFT_FULL;
      return `<li class="duty-modal-row">
        <span class="duty-modal-row-text">${escapeHtml(String(item.user_name || item.account || ""))}</span>
        <span class="duty-modal-shift-tag ${sh === DUTY_SHIFT_NIGHT ? "duty-modal-shift-tag--night" : "duty-modal-shift-tag--full"}">${escapeHtml(dutyShiftLabel(sh))}</span>
        <button type="button" class="action danger duty-modal-remove" data-duty-modal-remove="${idx}">删除</button>
      </li>`;
    })
    .join("");
  return `
  <div class="perm-modal-mask duty-day-modal-mask" id="duty-day-modal-mask">
    <div class="perm-modal duty-day-modal" role="dialog" aria-modal="true" aria-labelledby="duty-day-modal-title">
      <div class="perm-modal-head">
        <h3 id="duty-day-modal-title">编辑值班 — ${escapeHtml(sectionTitle)} — ${escapeHtml(dateLabel)}</h3>
      </div>
      <div class="perm-modal-body">
        <p class="duty-modal-sub">同一日可添加多名人员；请区分「全天」与「晚班」。</p>
        <ul class="duty-modal-list">${rows || '<li class="duty-modal-empty">当日暂无排班</li>'}</ul>
        <div class="duty-modal-add">
          <label class="duty-modal-field duty-modal-field--user">人员
            <div class="duty-modal-user-combo">
              <input
                type="text"
                id="duty-modal-user-input"
                autocomplete="off"
                placeholder="${noDutyUsers ? "暂无可用人员（请先同步用户管理）" : "输入姓名或账号搜索"}"
                aria-autocomplete="list"
                aria-controls="duty-modal-user-listbox"
                aria-expanded="false"
                role="combobox"
                ${noDutyUsers ? "disabled" : ""}
              />
              <input type="hidden" id="duty-modal-user-account" value="" />
              <ul id="duty-modal-user-listbox" class="duty-modal-user-suggest" role="listbox" hidden></ul>
            </div>
          </label>
          <fieldset class="duty-modal-shifts">
            <legend class="sr-only">班次</legend>
            <label><input type="radio" name="duty-modal-shift" value="${DUTY_SHIFT_FULL}" checked /> 全天</label>
            <label><input type="radio" name="duty-modal-shift" value="${DUTY_SHIFT_NIGHT}" /> 晚班</label>
          </fieldset>
          <button type="button" class="action primary" id="duty-modal-add-btn">添加</button>
        </div>
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="duty-modal-close-btn">关闭</button>
      </div>
    </div>
  </div>`;
}

export function renderDutyCalendarImportModalHtml() {
  const m = state.dutyCalendarImportModal;
  if (!m) return "";
  const { kind, year, month } = m;
  const title = DUTY_CALENDAR_KIND_TITLES[kind] || kind;
  const monthLabel = `${year}年${month}月`;
  return `
  <div class="perm-modal-mask duty-import-modal-mask" id="duty-import-modal-mask">
    <div class="perm-modal duty-import-modal" role="dialog" aria-modal="true" aria-labelledby="duty-import-modal-title">
      <div class="perm-modal-head">
        <h3 id="duty-import-modal-title">导入${escapeHtml(title)} — ${escapeHtml(monthLabel)}</h3>
      </div>
      <div class="perm-modal-body">
        <p class="duty-import-hint">请先下载模板填写排班；导入将覆盖 ${escapeHtml(monthLabel)} 的全部排班。</p>
        <div class="duty-import-upload-area">
          <input type="file" id="duty-import-file" class="duty-import-file-input" accept=".xlsx" />
          <div class="duty-import-upload-hint">
            <span id="duty-import-file-name">${state.dutyCalendarImportFileName || "点击选择 .xlsx 文件"}</span>
          </div>
        </div>
        <div id="duty-import-errors" class="duty-import-errors">${renderDutyCalendarImportErrorsHtml(state.dutyCalendarImportErrors)}</div>
      </div>
      <div class="perm-modal-actions">
        <button type="button" class="action" id="duty-import-cancel-btn">取消</button>
        <button type="button" class="action primary" id="duty-import-submit-btn" ${state.dutyCalendarImportLoading ? "disabled" : ""}>${state.dutyCalendarImportLoading ? "导入中…" : "确认导入"}</button>
      </div>
    </div>
  </div>`;
}

export function renderDutyRosterPage() {
  const blocks = getVisibleDutyRosterSections().map((sec) => {
    if (sec.id === "duty-holiday-config") {
      return renderDutyHolidayConfigBlock(sec.id, sec.title);
    }
    const kind = DUTY_CALENDAR_KIND_BY_SECTION_ID[sec.id];
    if (kind) {
      return renderDutyCalendarBlock(sec.id, sec.title, kind);
    }
    if (sec.id === "duty-special-rotation") {
      return renderDutySpecialRotationSection();
    }
    const rotKind = DUTY_ROTATION_KIND_BY_SECTION_ID[sec.id];
    if (rotKind) {
      return renderDutyRotationBlock(sec.id, sec.title, rotKind);
    }
    if (sec.id === "duty-rl-oncall") {
      return renderDutyRlOnCallBlock(sec.id, sec.title);
    }
    return `
        <section class="duty-roster-block" id="${escapeAttr(sec.id)}">
          <h2 class="duty-roster-block-title">${escapeHtml(sec.title)}</h2>
          <div class="duty-roster-card"><p class="duty-roster-note">该区块尚未配置。</p></div>
        </section>`;
  }).join("");
  return `
      <div class="duty-roster-page">
        ${blocks}
      </div>`;
}

export function bindDutyRotationUserCombo(rKind) {
  const userInput = document.getElementById(`duty-rot-${rKind}-input`);
  const userAccountHidden = document.getElementById(`duty-rot-${rKind}-account`);
  const userList = document.getElementById(`duty-rot-${rKind}-list`);
  if (!userInput || !userAccountHidden || !userList) return;

  function closeRotSuggest() {
    userList.hidden = true;
    userInput.setAttribute("aria-expanded", "false");
  }

  function openRotSuggest(filterText) {
    if (userInput.disabled) return;
    userList.innerHTML = renderDutyUserSuggestListHtml(filterDutyUsersForSuggest(getDutySelectableUsers(), filterText));
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput.addEventListener("focus", () => {
    openRotSuggest(userInput.value);
  });
  userInput.addEventListener("input", () => {
    userAccountHidden.value = "";
    openRotSuggest(userInput.value);
  });
  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeRotSuggest();
  });
  userList.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    closeRotSuggest();
  });
}

export function bindDutyRlUserCombo(role) {
  const userInput = document.getElementById(`duty-rl-${role}-input`);
  const userAccountHidden = document.getElementById(`duty-rl-${role}-account`);
  const userList = document.getElementById(`duty-rl-${role}-list`);
  const phoneInput = document.getElementById(`duty-rl-${role}-phone`);
  if (!userInput || !userAccountHidden || !userList) return;

  function closeRlSuggest() {
    userList.hidden = true;
    userInput.setAttribute("aria-expanded", "false");
  }

  function openRlSuggest(filterText) {
    if (userInput.disabled) return;
    userList.innerHTML = renderDutyUserSuggestListHtml(filterDutyUsersForSuggest(getDutySelectableUsers(), filterText));
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput.addEventListener("focus", () => {
    openRlSuggest(userInput.value);
  });
  userInput.addEventListener("input", () => {
    userAccountHidden.value = "";
    if (phoneInput) phoneInput.value = "";
    openRlSuggest(userInput.value);
  });
  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeRlSuggest();
  });
  userList.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    if (phoneInput && u) phoneInput.value = dutyUserContactPhone(u);
    closeRlSuggest();
  });
}

export function bindDutyRosterPage() {
  const rlOnly = isDutyRosterRlOnlyScope();
  if (!rlOnly) {
    const sk = _dutyCalendarSyncKey(state);
    if (state.dutyCalendarLoadedKey !== sk && !state.dutyCalendarSyncPending) {
      state.dutyCalendarSyncPending = true;
      void syncDutyCalendarMonthsFromServer().then(() => {
        state.dutyCalendarSyncPending = false;
        state.dutyCalendarLoadedKey = sk;
        requestRender();
      });
    }

    const hSk = _dutyHolidayMonthSyncKey(state);
    if (state.dutyHolidayLoadedKey !== hSk && !state.dutyHolidaySyncPending) {
      state.dutyHolidaySyncPending = true;
      void syncDutyHolidayMonthFromServer().then(() => {
        state.dutyHolidaySyncPending = false;
        state.dutyHolidayLoadedKey = hSk;
        requestRender();
      });
    }
  }

  const exSk = dutyRosterExtrasSyncKey();
  if (state.dutyRosterExtrasLoadedKey !== exSk && !state.dutyRosterExtrasSyncPending) {
    state.dutyRosterExtrasSyncPending = true;
    void syncDutyRosterExtrasFromServer().then(() => {
      state.dutyRosterExtrasSyncPending = false;
      state.dutyRosterExtrasLoadedKey = exSk;
      requestRender();
    });
  }

  document.querySelectorAll("[data-duty-cal-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-duty-cal-nav");
      const dir = parseInt(btn.getAttribute("data-duty-cal-dir") || "0", 10);
      if (!kind || !state.dutyCalendarYm[kind]) return;
      let { year, month } = state.dutyCalendarYm[kind];
      month += dir;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      if (month > 12) {
        month = 1;
        year += 1;
      }
      state.dutyCalendarYm[kind] = { year, month };
      state.dutyCalendarLoadedKey = "";
      requestRender();
    });
  });
  document.querySelectorAll("[data-duty-holiday-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = parseInt(btn.getAttribute("data-duty-holiday-dir") || "0", 10);
      let { year, month } = state.dutyHolidayYm || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
      month += dir;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      if (month > 12) {
        month = 1;
        year += 1;
      }
      state.dutyHolidayYm = { year, month };
      state.dutyHolidayLoadedKey = "";
      requestRender();
    });
  });
  document.querySelectorAll("[data-duty-holiday-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dutyHolidayEditMode = !state.dutyHolidayEditMode;
      requestRender();
    });
  });
  document.querySelectorAll("[data-duty-holiday-date]").forEach((cell) => {
    cell.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!state.dutyHolidayEditMode) return;
      const dateKey = cell.getAttribute("data-duty-holiday-date");
      if (!dateKey) return;
      const cur = String((state.dutyHolidayDays || {})[dateKey] || "");
      let next = "";
      if (cur === "workday") next = "weekend_holiday";
      else if (cur === "weekend_holiday") next = "";
      else next = "workday";
      if (!state.dutyHolidayDays) state.dutyHolidayDays = {};
      if (next) state.dutyHolidayDays[dateKey] = next;
      else delete state.dutyHolidayDays[dateKey];
      persistDutyHolidayLocal();
      const [y, mo] = dateKey.split("-").map((x) => parseInt(x, 10));
      await persistDutyHolidayMonthToServer(y, mo);
      requestRender();
    });
  });
  document.querySelectorAll("[data-duty-cal-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-duty-cal-edit");
      if (!kind) return;
      state.dutyEditMode[kind] = !state.dutyEditMode[kind];
      if (!state.dutyEditMode[kind]) state.dutyDayModal = null;
      requestRender();
    });
  });
  document.querySelectorAll("[data-duty-cal-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-duty-cal-template");
      if (!kind) return;
      downloadDutyCalendarImportTemplate(kind);
    });
  });
  document.querySelectorAll("[data-duty-cal-import]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-duty-cal-import");
      if (!kind || !state.dutyCalendarYm[kind]) return;
      const { year, month } = state.dutyCalendarYm[kind];
      state.dutyCalendarImportModal = { kind, year, month };
      state.dutyCalendarImportFile = null;
      state.dutyCalendarImportFileName = "";
      state.dutyCalendarImportErrors = [];
      requestRender();
    });
  });
  document.getElementById("duty-import-cancel-btn")?.addEventListener("click", () => {
    state.dutyCalendarImportModal = null;
    state.dutyCalendarImportFile = null;
    state.dutyCalendarImportFileName = "";
    state.dutyCalendarImportErrors = [];
    requestRender();
  });
  document.getElementById("duty-import-modal-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("duty-import-modal-mask")) {
      state.dutyCalendarImportModal = null;
      state.dutyCalendarImportFile = null;
      state.dutyCalendarImportFileName = "";
      state.dutyCalendarImportErrors = [];
      requestRender();
    }
  });
  const dutyImportFileInput = document.getElementById("duty-import-file");
  const dutyImportFileNameSpan = document.getElementById("duty-import-file-name");
  if (dutyImportFileInput) {
    dutyImportFileInput.addEventListener("change", () => {
      const file = dutyImportFileInput.files?.[0];
      if (!file) return;
      const result = applyDutyCalendarImportFileChoice(file);
      if (result.invalidFormat) {
        window.alert("仅支持 .xlsx 格式文件");
        dutyImportFileInput.value = "";
        state.dutyCalendarImportFile = null;
        state.dutyCalendarImportFileName = "";
        state.dutyCalendarImportErrors = [];
        if (dutyImportFileNameSpan) dutyImportFileNameSpan.textContent = "点击选择 .xlsx 文件";
        return;
      }
      if (result.accepted) {
        state.dutyCalendarImportFile = result.file;
        state.dutyCalendarImportFileName = result.fileName;
        state.dutyCalendarImportErrors = [];
        if (dutyImportFileNameSpan) dutyImportFileNameSpan.textContent = result.fileName;
      }
    });
  }
  document.getElementById("duty-import-submit-btn")?.addEventListener("click", async () => {
    const m = state.dutyCalendarImportModal;
    if (!m || state.dutyCalendarImportLoading) return;
    const fileInput = document.getElementById("duty-import-file");
    const file = resolveDutyCalendarImportFile(
      { file: state.dutyCalendarImportFile },
      fileInput
    );
    if (!file) {
      window.alert("请选择要导入的文件");
      return;
    }
    const op = getCurrentOperator();
    const form = new FormData();
    form.append("file", file, file.name || "import.xlsx");
    form.append("operator_id", op.account);
    form.append("kind", m.kind);
    form.append("year", String(m.year));
    form.append("month", String(m.month));
    state.dutyCalendarImportLoading = true;
    requestRender();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/duty/calendar/import`, {
        method: "POST",
        body: form,
      });
      const text = await resp.text();
      let body = {};
      try {
        body = JSON.parse(text);
      } catch (_) {
        body = { detail: text };
      }
      if (!resp.ok) {
        if (resp.status === 403) {
          window.alert("无导入权限");
        } else if (resp.status === 400 && body.detail) {
          let detail = body.detail;
          try {
            const errObj = typeof detail === "string" ? JSON.parse(detail) : detail;
            if (errObj.errors && Array.isArray(errObj.errors)) {
              state.dutyCalendarImportErrors = errObj.errors;
              return;
            }
          } catch (_) {
            /* fall through */
          }
          window.alert(`导入失败：${typeof detail === "string" ? detail.slice(0, 240) : "校验失败"}`);
        } else {
          window.alert(`导入失败：${String(body.detail || text).slice(0, 240)}`);
        }
        return;
      }
      state.dutyCalendarImportModal = null;
      state.dutyCalendarImportFile = null;
      state.dutyCalendarImportFileName = "";
      state.dutyCalendarImportErrors = [];
      if (fileInput) fileInput.value = "";
      state.dutyCalendarLoadedKey = "";
      await syncDutyCalendarMonthsFromServer();
      window.alert(body.message || "导入成功");
      requestRender();
    } catch (e) {
      window.alert(`导入失败：${String(e.message || e)}`);
    } finally {
      state.dutyCalendarImportLoading = false;
      requestRender();
    }
  });
  document.querySelectorAll("[data-duty-cal-cell]").forEach((cell) => {
    cell.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const kind = cell.getAttribute("data-duty-cal-cell");
      const dateKey = cell.getAttribute("data-duty-cal-date");
      if (!kind || !dateKey) return;
      state.dutyDayModal = { kind, dateKey };
      requestRender();
    });
  });
  const mask = document.getElementById("duty-day-modal-mask");
  const closeBtn = document.getElementById("duty-modal-close-btn");
  const addBtn = document.getElementById("duty-modal-add-btn");
  const modalInner = mask?.querySelector(".duty-day-modal");
  const userInput = document.getElementById("duty-modal-user-input");
  const userAccountHidden = document.getElementById("duty-modal-user-account");
  const userList = document.getElementById("duty-modal-user-listbox");
  const userCombo = document.querySelector(".duty-modal-user-combo");

  function closeDutyUserSuggest() {
    if (userList) userList.hidden = true;
    userInput?.setAttribute("aria-expanded", "false");
  }

  function openDutyUserSuggest(filterText) {
    if (!userInput || !userList || userInput.disabled) return;
    userList.innerHTML = renderDutyUserSuggestListHtml(filterDutyUsersForSuggest(getDutySelectableUsers(), filterText));
    userList.hidden = false;
    userInput.setAttribute("aria-expanded", "true");
  }

  userInput?.addEventListener("focus", () => {
    openDutyUserSuggest(userInput.value);
  });
  userInput?.addEventListener("input", () => {
    if (userAccountHidden) userAccountHidden.value = "";
    openDutyUserSuggest(userInput.value);
  });
  userInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeDutyUserSuggest();
  });
  userList?.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const li = ev.target.closest(".duty-modal-user-suggest-item");
    if (!li || !userAccountHidden || !userInput) return;
    const acc = li.getAttribute("data-account") || "";
    userAccountHidden.value = acc;
    const u = getDutySelectableUsers().find((x) => String(x.account || "") === acc);
    userInput.value = u ? dutyModalUserLabel(u) : acc;
    closeDutyUserSuggest();
  });

  mask?.addEventListener("click", (ev) => {
    if (ev.target === mask) {
      state.dutyDayModal = null;
      requestRender();
    }
  });
  closeBtn?.addEventListener("click", () => {
    state.dutyDayModal = null;
    requestRender();
  });
  modalInner?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (userCombo && userList && !userList.hidden && !userCombo.contains(ev.target)) {
      closeDutyUserSuggest();
    }
  });
  addBtn?.addEventListener("click", async () => {
    const m = state.dutyDayModal;
    if (!m) return;
    let acc = (userAccountHidden?.value || "").trim();
    if (!acc && userInput) {
      const q = (userInput.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) acc = String(exact[0].account || "");
    }
    if (!acc) {
      window.alert("请先搜索并选择人员");
      return;
    }
    const user = state.adminUsers.find((u) => String(u.account || "") === acc);
    const shiftEl = document.querySelector('input[name="duty-modal-shift"]:checked');
    const shift = shiftEl?.value === DUTY_SHIFT_NIGHT ? DUTY_SHIFT_NIGHT : DUTY_SHIFT_FULL;
    if (!state.dutyAssignments[m.kind]) state.dutyAssignments[m.kind] = {};
    if (!state.dutyAssignments[m.kind][m.dateKey]) state.dutyAssignments[m.kind][m.dateKey] = [];
    state.dutyAssignments[m.kind][m.dateKey].push({
      account: acc,
      user_name: String(user?.user_name || ""),
      shift,
    });
    persistDutyAssignmentsLocal();
    const [y, mo] = m.dateKey.split("-").map((x) => parseInt(x, 10));
    await persistDutyCalendarMonthToServer(m.kind, y, mo);
    requestRender();
  });
  document.querySelectorAll(".duty-modal-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const m = state.dutyDayModal;
      if (!m) return;
      const idx = parseInt(btn.getAttribute("data-duty-modal-remove") || "-1", 10);
      const arr = state.dutyAssignments[m.kind]?.[m.dateKey];
      if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
      arr.splice(idx, 1);
      if (arr.length === 0) delete state.dutyAssignments[m.kind][m.dateKey];
      persistDutyAssignmentsLocal();
      const [y, mo] = m.dateKey.split("-").map((x) => parseInt(x, 10));
      await persistDutyCalendarMonthToServer(m.kind, y, mo);
      requestRender();
    });
  });

  document.querySelectorAll("[data-duty-rot-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rk = btn.getAttribute("data-duty-rot-edit");
      if (!rk || !(rk in state.dutyRotationEditMode)) return;
      const entering = !state.dutyRotationEditMode[rk];
      if (entering) {
        await refreshDutyRotationFromServer();
      }
      state.dutyRotationEditMode[rk] = !state.dutyRotationEditMode[rk];
      requestRender();
    });
  });
  document.querySelectorAll(".duty-rot-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rk = btn.getAttribute("data-duty-rot-remove");
      const idx = parseInt(btn.getAttribute("data-duty-rot-idx") || "-1", 10);
      const list = state.dutyRotationLists[rk];
      if (!list || idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      void persistDutyRotationLocalAndServer().then(() => requestRender());
    });
  });
  document.querySelectorAll(".duty-rot-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rk = btn.getAttribute("data-duty-rot-add");
      if (!rk) return;
      const hidden = document.getElementById(`duty-rot-${rk}-account`);
      const input = document.getElementById(`duty-rot-${rk}-input`);
      let acc = (hidden?.value || "").trim();
      if (!acc && input) {
        const q = (input.value || "").trim();
        const pool = getDutySelectableUsers();
        const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
        if (exact.length === 1) acc = String(exact[0].account || "");
      }
      if (!acc) {
        window.alert("请先搜索并选择要加入轮值的人员");
        return;
      }
      const list = state.dutyRotationLists[rk];
      if (!list) return;
      if (list.some((r) => r.account === acc)) {
        window.alert("该人员已在轮值表中");
        return;
      }
      const user = state.adminUsers.find((u) => String(u.account || "") === acc);
      list.push({
        account: acc,
        user_name: String(user?.user_name || ""),
        status: DUTY_ROTATION_STATUS_ACTIVE,
        last_accept_at: "",
      });
      void persistDutyRotationLocalAndServer().then(() => {
        if (hidden) hidden.value = "";
        if (input) input.value = "";
        requestRender();
      });
    });
  });

  document.querySelectorAll("[data-duty-rl-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dutyRlOnCallEditMode = !state.dutyRlOnCallEditMode;
      requestRender();
    });
  });
  document.querySelectorAll(".duty-rl-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-duty-rl-idx") || "-1", 10);
      const list = state.dutyRlOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      persistDutyRlOnCallLocalAndServer();
      requestRender();
    });
  });
  document.querySelectorAll(".duty-rl-phone-edit").forEach((inp) => {
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.getAttribute("data-duty-rl-idx") || "-1", 10);
      const role = inp.getAttribute("data-duty-rl-slot") || "primary";
      const list = state.dutyRlOnCallRows;
      if (!list || idx < 0 || idx >= list.length) return;
      const key = role === "backup" ? "backup" : "primary";
      list[idx][key].phone = (inp.value || "").trim();
      persistDutyRlOnCallLocalAndServer();
    });
  });
  document.getElementById("duty-rl-add-row-btn")?.addEventListener("click", () => {
    const dateEl = document.getElementById("duty-rl-new-date");
    const dateRaw = (dateEl?.value || "").trim().slice(0, 10);
    if (!dateRaw || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      window.alert("请选择有效的值班日期");
      return;
    }
    const pHidden = document.getElementById("duty-rl-primary-account");
    const pInput = document.getElementById("duty-rl-primary-input");
    let pAcc = (pHidden?.value || "").trim();
    if (!pAcc && pInput) {
      const q = (pInput.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) pAcc = String(exact[0].account || "");
    }
    let pPhone = (document.getElementById("duty-rl-primary-phone")?.value || "").trim();
    if (!pPhone && pAcc) {
      const pSel = state.adminUsers.find((u) => String(u.account || "") === pAcc);
      pPhone = dutyUserContactPhone(pSel);
    }
    if (!pAcc) {
      window.alert("请选择主值班人员");
      return;
    }
    if (!pPhone) {
      window.alert("请填写主值班手机号");
      return;
    }
    const bHidden = document.getElementById("duty-rl-backup-account");
    const bInput = document.getElementById("duty-rl-backup-input");
    let bAcc = (bHidden?.value || "").trim();
    if (!bAcc && bInput) {
      const q = (bInput.value || "").trim();
      const pool = getDutySelectableUsers();
      const exact = pool.filter((u) => String(u.account || "") === q || dutyModalUserLabel(u) === q);
      if (exact.length === 1) bAcc = String(exact[0].account || "");
    }
    let bPhone = (document.getElementById("duty-rl-backup-phone")?.value || "").trim();
    if (!bPhone && bAcc) {
      const bSel = state.adminUsers.find((u) => String(u.account || "") === bAcc);
      bPhone = dutyUserContactPhone(bSel);
    }
    if (bAcc && !bPhone) {
      window.alert("已选择备值班人员时，请填写备值班手机号");
      return;
    }
    const pUser = state.adminUsers.find((u) => String(u.account || "") === pAcc);
    const bUser = bAcc ? state.adminUsers.find((u) => String(u.account || "") === bAcc) : null;
    const entry = {
      duty_date: dateRaw,
      primary: {
        account: pAcc,
        user_name: String(pUser?.user_name || ""),
        phone: pPhone,
      },
      backup: bAcc
        ? {
            account: bAcc,
            user_name: String(bUser?.user_name || ""),
            phone: bPhone,
          }
        : { account: "", user_name: "", phone: "" },
    };
    const di = state.dutyRlOnCallRows.findIndex((r) => r.duty_date === dateRaw);
    if (di >= 0) state.dutyRlOnCallRows[di] = entry;
    else state.dutyRlOnCallRows.push(entry);
    persistDutyRlOnCallLocalAndServer();
    if (dateEl) dateEl.value = "";
    if (pHidden) pHidden.value = "";
    if (pInput) pInput.value = "";
    if (document.getElementById("duty-rl-primary-phone")) document.getElementById("duty-rl-primary-phone").value = "";
    if (bHidden) bHidden.value = "";
    if (bInput) bInput.value = "";
    if (document.getElementById("duty-rl-backup-phone")) document.getElementById("duty-rl-backup-phone").value = "";
    requestRender();
  });

  bindDutyRlUserCombo("primary");
  bindDutyRlUserCombo("backup");
  DUTY_ALL_ROTATION_KINDS.forEach((k) => bindDutyRotationUserCombo(k));
}
