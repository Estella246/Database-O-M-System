import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import {
  PERMISSION_WHITELIST_ITEMS,
  PERMISSION_LEVEL_OPTIONS,
  PERMISSION_STRATEGY_OPTIONS_BY_KEY,
  PERMISSION_WHITELIST_PARENT_MAP,
} from "../constants/permission.js";
import {
  normalizePermissionLevel,
  normalizePermissionLevelForItem,
  getPermissionStrategyOptions,
  getPermissionLevelRank,
} from "../utils/normalize.js";

export function getPermissionWhitelistPageAndDetail(item) {
  const label = String(item?.label || "");
  const segs = label.split("/").map((x) => x.trim()).filter(Boolean);
  return {
    page: segs[0] || label,
    detail: segs.length > 1 ? segs.slice(1).join(" / ") : "-",
  };
}

export function getWhitelistScopeSummaryByItemKey(itemKey, levelByKey) {
  if (itemKey === "home") {
    return "可查看工单范围策略同工单详情";
  }
  return "-";
}

export function getPermissionWhitelistVisibleItems() {
  const hiddenRootKeys = new Set(["ticket_detail", "params_config"]);
  return PERMISSION_WHITELIST_ITEMS.filter((item) => !hiddenRootKeys.has(item.key));
}

export function getPermissionWhitelistDetailText(itemKey, page, detail) {
  if (itemKey === "home") return "可查看工单范围";
  if (itemKey === "home_duty_roster") return "是否展示";
  if (itemKey === "ticket_list") return "可查看工单范围";
  if (detail !== "-") return detail;
  return `是否展示"${page}"页面`;
}

export function getPermissionStrategyText(itemKey, level) {
  const normalized = normalizePermissionLevel(level);
  const strategyOptions = PERMISSION_STRATEGY_OPTIONS_BY_KEY[itemKey] || [];
  const hit = strategyOptions.find(([v]) => v === normalized);
  if (hit) return hit[1];
  const fallbackHit = strategyOptions.find(([v]) => v === "readonly");
  if (fallbackHit) return fallbackHit[1];
  if (strategyOptions.length) return strategyOptions[0][1];
  const levelText = Object.fromEntries(PERMISSION_LEVEL_OPTIONS);
  return levelText[normalized] || normalized;
}

export function getPermissionLevelForItem(itemKey, level) {
  return normalizePermissionLevelForItem(itemKey, level);
}

export function getStrategyOptionsHtml(itemKey, curLevel) {
  const options = getPermissionStrategyOptions(itemKey);
  return options.map((opt) => {
    const selected = curLevel === opt.value ? "selected" : "";
    return `<option value="${opt.value}" ${selected}>${escapeHtml(opt.text)}</option>`;
  }).join("");
}

export function promotePermissionParents(draft, itemKey, targetLevel) {
  const nextDraft = { ...draft };
  const desiredRank = getPermissionLevelRank(targetLevel);
  const queue = [itemKey];
  const visited = new Set();
  while (queue.length) {
    const cur = queue.shift();
    const parents = PERMISSION_WHITELIST_PARENT_MAP[cur] || [];
    parents.forEach((parentKey) => {
      if (visited.has(parentKey)) return;
      visited.add(parentKey);
      const currentRank = getPermissionLevelRank(nextDraft[parentKey]);
      if (currentRank < desiredRank) {
        nextDraft[parentKey] = getPermissionLevelForItem(parentKey, targetLevel);
      }
      queue.push(parentKey);
    });
  }
  return nextDraft;
}

export function getCurrentLevelTextByStrategy(itemKey, level) {
  const resolved = getPermissionLevelForItem(itemKey, level);
  if (itemKey === "home") return "权限策略同工单详情";
  return getPermissionStrategyText(itemKey, resolved);
}

export function buildPermissionWhitelistGroups() {
  const groups = [];
  const byTitle = {};
  PERMISSION_WHITELIST_ITEMS.forEach((item) => {
    const label = String(item.label || "");
    const segs = label.split("/").map((x) => x.trim()).filter(Boolean);
    const groupTitle = segs[0] || label;
    if (!groupTitle) return;
    if (!byTitle[groupTitle]) {
      const group = { title: groupTitle, root: null, children: [] };
      byTitle[groupTitle] = group;
      groups.push(group);
    }
    const group = byTitle[groupTitle];
    if (segs.length <= 1) {
      group.root = item;
    } else {
      group.children.push(item);
    }
  });
  return groups;
}

export function filterPermissionRows(rows, filters) {
  const selected = filters.selected || {};
  return rows.filter((r) => {
    const roleOk = (selected.role_code || []).length === 0 || selected.role_code.includes(String(r.role_code || ""));
    const plOk = (selected.is_pl || []).length === 0 || selected.is_pl.includes((r.is_pl ? "是" : "否"));
    const nodeOk = (selected.node_key || []).length === 0 || selected.node_key.includes(String(r.node_key || ""));
    const fieldOk = (selected.field_key || []).length === 0 || selected.field_key.includes(String(r.field_key || ""));
    const permOk = (selected.permission_level || []).length === 0 || selected.permission_level.includes(String(r.permission_level || ""));
    return roleOk && nodeOk && fieldOk && permOk && plOk;
  });
}

export function filterUserRows(rows, filters) {
  const selected = filters.selected || {};
  return rows.filter((r) => {
    const accountOk = (selected.account || []).length === 0 || selected.account.includes(String(r.account || ""));
    const nameOk = (selected.user_name || []).length === 0 || selected.user_name.includes(String(r.user_name || ""));
    const roleOk = (selected.role_code || []).length === 0 || selected.role_code.includes(String(r.role_code || ""));
    const groupOk = (selected.group_name || []).length === 0 || selected.group_name.includes(String(r.group_name || ""));
    const plOk = (selected.is_pl || []).length === 0 || selected.is_pl.includes((r.is_pl ? "是" : "否"));
    return accountOk && nameOk && roleOk && groupOk && plOk;
  });
}

export function uniqueColumnValues(rows, key) {
  const set = new Set();
  rows.forEach((r) => {
    if (key === "is_pl") set.add(r.is_pl ? "是" : "否");
    else set.add(String(r[key] || ""));
  });
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function renderUserFilterHeader(label, key, allRows) {
  const selected = state.adminUserFilters.selected[key] || [];
  const values = uniqueColumnValues(allRows, key);
  const isOpen = state.adminUserFilters.openKey === key;
  const search = state.adminUserFilters.search[key] || "";
  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const allChecked = visibleValues.length > 0 && visibleValues.every((v) => selected.includes(v));
  const active = selected.length > 0 ? "active" : "";
  const options = visibleValues
    .map((v) => `<label class="filter-opt"><input type="checkbox" data-user-filter-value="${escapeAttr(v)}" ${selected.includes(v) ? "checked" : ""}/> ${escapeHtml(v)}</label>`)
    .join("");
  return `
    <th class="admin-th-filter">
      <span>${label}</span>
      <button type="button" class="filter-icon ${active}" data-user-filter-open="${key}" title="筛选" aria-label="筛选">⏷</button>
      ${
        isOpen
          ? `<div class="filter-pop">
          <input class="filter-search" type="text" data-user-filter-search="${key}" placeholder="搜索" value="${escapeAttr(search)}" />
          <label class="filter-opt filter-checkall"><input type="checkbox" data-user-filter-checkall="${key}" ${allChecked ? "checked" : ""}/> （全选）</label>
          <div class="filter-pop-list">${options || '<div class="filter-empty">无可选值</div>'}</div>
          <div class="filter-pop-actions">
            <button type="button" class="action" data-user-filter-reset-col="${key}">重置</button>
            <button type="button" class="action primary" data-user-filter-close>完成</button>
          </div>
        </div>`
          : ""
      }
    </th>
  `;
}

export function renderUserTableHead(filteredRows, allRows, showActions) {
  return `<tr>
    ${renderUserFilterHeader("账号", "account", allRows)}
    ${renderUserFilterHeader("姓名", "user_name", allRows)}
    ${renderUserFilterHeader("角色", "role_code", allRows)}
    ${renderUserFilterHeader("小组", "group_name", allRows)}
    ${renderUserFilterHeader("是否PL", "is_pl", allRows)}
    ${showActions ? "<th>操作</th>" : ""}
  </tr>`;
}
